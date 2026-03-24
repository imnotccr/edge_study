import { CUSTOM_DURATION_CAP_OPTIONS, MESSAGE_TYPES, PRESET_SITES, THEMES } from "../shared/constants.js";
import { extractDomainFromUrl, normalizeDomainInput } from "../shared/domain.js";
import { clearErrorLogs, logErrorEvent } from "../shared/error-log.js";
import { AppError, ERROR_CODES, buildErrorResponse } from "../shared/errors.js";
import { ensureStateInitialized, readState, updateState } from "../shared/storage.js";
import { buildDashboardData, pruneExpiredData, recordBlockAttempt } from "./stats-manager.js";
import {
  forceDebugExit,
  getAppState,
  getBlockContext,
  handleAlarm,
  recoverSessionState,
  shouldRecordNavigationBlock,
  startSession
} from "./session-manager.js";
import { applyUnlockResult, getUnlockContext, submitUnlockAnswers } from "./unlock-manager.js";

function assertUniqueDomains(entries) {
  const seen = new Set();

  for (const entry of entries) {
    if (seen.has(entry.domain)) {
      throw new AppError(ERROR_CODES.SETTINGS_DOMAIN_DUPLICATE, `白名单域名重复：${entry.domain}`);
    }

    seen.add(entry.domain);
  }
}

async function saveOptions({ whitelistEntries, settings }) {
  const normalizedWhitelist = whitelistEntries.map((entry) => {
    const normalizedDomain = normalizeDomainInput(entry.domain ?? "");

    if (!normalizedDomain) {
      throw new AppError(ERROR_CODES.SETTINGS_DOMAIN_INVALID, `域名格式无效：${entry.domain ?? ""}`);
    }

    return {
      id: entry.id ?? crypto.randomUUID(),
      domain: normalizedDomain,
      includeSubdomains: Boolean(entry.includeSubdomains),
      source: entry.source ?? "custom",
      createdAt: entry.createdAt ?? Date.now()
    };
  });

  assertUniqueDomains(normalizedWhitelist);

  const durationCapIsValid = CUSTOM_DURATION_CAP_OPTIONS.some(
    (option) => option.value === settings.customDurationCapOption
  );

  if (!durationCapIsValid) {
    throw new AppError(ERROR_CODES.SETTINGS_DURATION_CAP_INVALID, "自定义时长上限配置无效。");
  }

  if (!["dark", "light"].includes(settings.theme)) {
    throw new AppError(ERROR_CODES.SETTINGS_THEME_INVALID, "主题配置无效。");
  }

  const cooldownMinutes = Number(settings.unlockCooldownMinutes);

  if (settings.unlockCooldownEnabled && (!Number.isInteger(cooldownMinutes) || cooldownMinutes <= 0)) {
    throw new AppError(ERROR_CODES.SETTINGS_COOLDOWN_INVALID, "冷却时间必须是大于 0 的整数分钟。");
  }

  const nextState = await updateState((state) => {
    if (state.currentSession) {
      throw new AppError(ERROR_CODES.FOCUS_CONFIGURATION_LOCKED, "专注进行中时不能修改白名单或设置。");
    }

    state.whitelistEntries = normalizedWhitelist;
    state.settings = {
      ...state.settings,
      theme: settings.theme,
      customDurationCapOption: settings.customDurationCapOption,
      unlockCooldownEnabled: Boolean(settings.unlockCooldownEnabled),
      unlockCooldownMinutes: Number.isInteger(cooldownMinutes) && cooldownMinutes > 0 ? cooldownMinutes : 5
    };
  });

  await pruneExpiredData();

  return {
    whitelistEntries: nextState.whitelistEntries,
    settings: nextState.settings
  };
}

async function getOptionsData() {
  const state = await readState();
  return {
    whitelistEntries: state.whitelistEntries,
    settings: state.settings,
    hasActiveSession: Boolean(state.currentSession),
    presets: PRESET_SITES,
    durationCapOptions: CUSTOM_DURATION_CAP_OPTIONS,
    themes: THEMES
  };
}

async function handleMessage(message, sender) {
  switch (message.type) {
    case MESSAGE_TYPES.GET_APP_STATE:
      return getAppState();
    case MESSAGE_TYPES.START_SESSION:
      return startSession(message.payload);
    case MESSAGE_TYPES.GET_OPTIONS_DATA:
      return getOptionsData();
    case MESSAGE_TYPES.SAVE_OPTIONS:
      return saveOptions(message.payload);
    case MESSAGE_TYPES.GET_BLOCK_CONTEXT:
      return getBlockContext(sender.tab?.id ?? -1);
    case MESSAGE_TYPES.GET_UNLOCK_CONTEXT:
      return getUnlockContext();
    case MESSAGE_TYPES.SUBMIT_UNLOCK_ANSWERS:
      return submitUnlockAnswers(message.payload);
    case MESSAGE_TYPES.APPLY_UNLOCK_RESULT:
      return applyUnlockResult(message.payload.result);
    case MESSAGE_TYPES.GET_DASHBOARD_DATA:
      return buildDashboardData(message.payload.range);
    case MESSAGE_TYPES.CLEAR_ERROR_LOGS:
      return clearErrorLogs();
    case MESSAGE_TYPES.FORCE_DEBUG_EXIT:
      return forceDebugExit();
    default:
      throw new AppError(ERROR_CODES.MESSAGE_UNKNOWN_TYPE, "无法识别的消息类型。", {
        type: message?.type ?? null
      });
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  try {
    await ensureStateInitialized();
    await pruneExpiredData();
    await recoverSessionState();
  } catch (error) {
    await logErrorEvent({ error, source: "background", scope: "runtime.onInstalled" });
  }
});

chrome.runtime.onStartup.addListener(async () => {
  try {
    await ensureStateInitialized();
    await pruneExpiredData();
    await recoverSessionState();
  } catch (error) {
    await logErrorEvent({ error, source: "background", scope: "runtime.onStartup" });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((data) => sendResponse({ ok: true, data }))
    .catch(async (error) => {
      await logErrorEvent({
        error,
        source: "background",
        scope: "runtime.onMessage",
        details: { messageType: message?.type ?? null }
      });
      sendResponse(buildErrorResponse(error));
    });
  return true;
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  try {
    await handleAlarm(alarm.name);
  } catch (error) {
    await logErrorEvent({
      error,
      source: "background",
      scope: "alarms.onAlarm",
      details: { alarmName: alarm.name }
    });
  }
});

chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  try {
    if (details.frameId !== 0) {
      return;
    }

    if (!/^https?:/i.test(details.url)) {
      return;
    }

    const shouldRecord = await shouldRecordNavigationBlock(details.url);

    if (!shouldRecord) {
      return;
    }

    await recordBlockAttempt({
      tabId: details.tabId,
      url: details.url,
      source: "navigation"
    });
  } catch (error) {
    await logErrorEvent({
      error,
      source: "background",
      scope: "webNavigation.onBeforeNavigate",
      details: {
        tabId: details.tabId,
        frameId: details.frameId,
        domain: extractDomainFromUrl(details.url)
      }
    });
  }
});
