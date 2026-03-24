import {
  ALARM_NAMES,
  DEVELOPMENT_BUILD,
  PAGE_PATHS,
  SESSION_STATUS,
  TEMP_ALLOW_MINUTES,
  getDurationCapOption
} from "../shared/constants.js";
import { isUrlAllowed } from "../shared/domain.js";
import { AppError, ERROR_CODES } from "../shared/errors.js";
import { clearTabRestoreTargets, clearUnlockChallenge, getTabRestoreTarget } from "../shared/session-secrets.js";
import { getRemainingMs } from "../shared/time.js";
import { readState, updateState } from "../shared/storage.js";
import { applyFocusRules, clearFocusRules, scanAndBlockExistingTabs } from "./rules-manager.js";

const TEMP_ALLOW_REMINDER_WINDOW = {
  WIDTH: 320,
  HEIGHT: 260,
  TOP_OFFSET: 88,
  EDGE_MARGIN: 20
};

let tempAllowReminderWindowId = null;

function createId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function createDefaultUnlockState() {
  return {
    failedCount: 0,
    cooldownUntil: null,
    pendingChallengeId: null,
    pendingResultAvailable: false
  };
}

function ensureUnlockState(session) {
  if (!session) {
    return createDefaultUnlockState();
  }

  session.unlockState = {
    ...createDefaultUnlockState(),
    failedCount: Number.isInteger(session.unlockState?.failedCount) && session.unlockState.failedCount > 0
      ? session.unlockState.failedCount
      : 0,
    cooldownUntil: typeof session.unlockState?.cooldownUntil === "number"
      ? session.unlockState.cooldownUntil
      : null,
    pendingChallengeId: typeof session.unlockState?.pendingChallengeId === "string"
      ? session.unlockState.pendingChallengeId
      : null,
    pendingResultAvailable: Boolean(session.unlockState?.pendingResultAvailable)
  };

  return session.unlockState;
}

function buildSessionView(session) {
  if (!session) {
    return null;
  }

  return {
    ...session,
    remainingMs: getRemainingMs(session.endAt),
    temporaryAllowRemainingMs: Math.max(0, (session.allowAllUntil ?? 0) - Date.now())
  };
}

function buildTempAllowReminderPosition(windowInfo) {
  const width = TEMP_ALLOW_REMINDER_WINDOW.WIDTH;
  const height = TEMP_ALLOW_REMINDER_WINDOW.HEIGHT;
  const left = Number.isInteger(windowInfo?.left) && Number.isInteger(windowInfo?.width)
    ? Math.max(0, windowInfo.left + windowInfo.width - width - TEMP_ALLOW_REMINDER_WINDOW.EDGE_MARGIN)
    : 64;
  const top = Number.isInteger(windowInfo?.top)
    ? Math.max(0, windowInfo.top + TEMP_ALLOW_REMINDER_WINDOW.TOP_OFFSET)
    : 96;

  return {
    width,
    height,
    left,
    top
  };
}

function getTempAllowReminderUrl() {
  return chrome.runtime.getURL(PAGE_PATHS.TEMP_ALLOW_REMINDER);
}

function isTempAllowReminderTab(tab) {
  return typeof tab?.url === "string" && tab.url.startsWith(getTempAllowReminderUrl());
}

async function findTempAllowReminderWindow() {
  try {
    if (Number.isInteger(tempAllowReminderWindowId)) {
      try {
        const existing = await chrome.windows.get(tempAllowReminderWindowId, { populate: true });

        if (existing?.tabs?.some((tab) => isTempAllowReminderTab(tab))) {
          return existing;
        }
      } catch {
        tempAllowReminderWindowId = null;
      }
    }

    const tabs = await chrome.tabs.query({});
    const reminderTab = tabs.find((tab) => isTempAllowReminderTab(tab));

    if (!reminderTab?.windowId) {
      return null;
    }

    const reminderWindow = await chrome.windows.get(reminderTab.windowId, { populate: true });
    tempAllowReminderWindowId = reminderWindow.id ?? null;
    return reminderWindow;
  } catch {
    tempAllowReminderWindowId = null;
    return null;
  }
}

async function ensureTempAllowReminderWindow() {
  const reminderUrl = getTempAllowReminderUrl();
  const existingWindow = await findTempAllowReminderWindow();
  let lastFocusedWindow = null;

  try {
    lastFocusedWindow = await chrome.windows.getLastFocused({ populate: false });
  } catch {
    lastFocusedWindow = null;
  }

  const position = buildTempAllowReminderPosition(lastFocusedWindow);

  if (existingWindow?.id) {
    tempAllowReminderWindowId = existingWindow.id;

    try {
      await chrome.windows.update(existingWindow.id, {
        state: "normal",
        drawAttention: true,
        ...position
      });
    } catch {
      // Ignore reposition failures and keep the existing reminder window.
    }

    return existingWindow.id;
  }

  try {
    const createdWindow = await chrome.windows.create({
      url: reminderUrl,
      type: "popup",
      focused: false,
      ...position
    });

    tempAllowReminderWindowId = createdWindow.id ?? null;
    return tempAllowReminderWindowId;
  } catch {
    tempAllowReminderWindowId = null;
    return null;
  }
}

async function closeTempAllowReminderWindow() {
  const existingWindow = await findTempAllowReminderWindow();

  if (!existingWindow?.id) {
    tempAllowReminderWindowId = null;
    return;
  }

  try {
    await chrome.windows.remove(existingWindow.id);
  } catch {
    // The reminder window may already be closed.
  }

  tempAllowReminderWindowId = null;
}

function buildArchivedSession(session, endReason) {
  return {
    ...session,
    status: endReason === SESSION_STATUS.UNLOCKED ? SESSION_STATUS.UNLOCKED : SESSION_STATUS.COMPLETED,
    endReason,
    actualEndAt: Date.now(),
    updatedAt: Date.now()
  };
}

function buildSessionHistoryEntry(session) {
  return {
    id: session.id,
    status: session.status,
    endReason: session.endReason,
    purpose: session.purpose,
    startAt: session.startAt,
    endAt: session.endAt,
    actualEndAt: session.actualEndAt,
    durationMinutes: Math.max(1, Math.round((session.actualEndAt - session.startAt) / 60000)),
    plannedMinutes: session.plannedMinutes
  };
}

function isRestorableBlockedUrl(url) {
  return typeof url === "string" && /^https?:/i.test(url);
}

async function restoreBlockedTabs(tabBlockState) {
  const blockPageUrl = chrome.runtime.getURL(PAGE_PATHS.BLOCK);

  for (const [tabId, blockedInfo] of Object.entries(tabBlockState ?? {})) {
    const numericTabId = Number(tabId);
    const restoreUrl = Number.isInteger(numericTabId) ? await getTabRestoreTarget(numericTabId) : null;
    const originalUrl = restoreUrl ?? blockedInfo?.origin ?? null;

    if (!Number.isInteger(numericTabId) || !isRestorableBlockedUrl(originalUrl)) {
      continue;
    }

    try {
      const tab = await chrome.tabs.get(numericTabId);

      if (!tab?.url?.startsWith(blockPageUrl)) {
        continue;
      }

      await chrome.tabs.update(numericTabId, {
        url: originalUrl
      });
    } catch {
      // The tab may have been closed or reused; skip restoring it.
    }
  }
}

function validateStartInput(purpose, durationMinutes, settings) {
  const trimmedPurpose = purpose.trim();

  if (!trimmedPurpose) {
    throw new AppError(ERROR_CODES.SESSION_PURPOSE_REQUIRED, "学习目的不能为空。");
  }

  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
    throw new AppError(ERROR_CODES.SESSION_DURATION_INVALID, "请选择有效的专注时长。");
  }

  const capOption = getDurationCapOption(settings.customDurationCapOption);

  if (durationMinutes > capOption.maxMinutes) {
    throw new AppError(
      ERROR_CODES.SESSION_DURATION_EXCEEDS_CAP,
      `当前自定义时长上限为 ${capOption.maxMinutes} 分钟。`,
      { maxMinutes: capOption.maxMinutes }
    );
  }

  return trimmedPurpose;
}

export function isSessionActive(session) {
  return Boolean(session && session.status === SESSION_STATUS.ACTIVE);
}

export function isTemporaryAllowActive(session) {
  return isSessionActive(session) && (session.allowAllUntil ?? 0) > Date.now();
}

async function syncAlarms(session) {
  await chrome.alarms.clear(ALARM_NAMES.SESSION_END);
  await chrome.alarms.clear(ALARM_NAMES.TEMP_ALLOW_END);

  if (!session) {
    return;
  }

  await chrome.alarms.create(ALARM_NAMES.SESSION_END, {
    when: session.endAt
  });

  if ((session.allowAllUntil ?? 0) > Date.now()) {
    await chrome.alarms.create(ALARM_NAMES.TEMP_ALLOW_END, {
      when: session.allowAllUntil
    });
  }
}

export async function getAppState() {
  const state = await readState();
  return {
    developmentBuild: DEVELOPMENT_BUILD,
    hasActiveSession: isSessionActive(state.currentSession),
    canEditConfiguration: !isSessionActive(state.currentSession),
    settings: {
      ...state.settings,
      devToolsEnabled: Boolean(DEVELOPMENT_BUILD && state.settings.devToolsEnabled)
    },
    whitelistCount: state.whitelistEntries.length,
    currentSession: buildSessionView(state.currentSession)
  };
}

export async function startSession({ purpose, durationMinutes }) {
  let startedSession = null;

  const state = await updateState((draftState) => {
    if (isSessionActive(draftState.currentSession)) {
      throw new AppError(ERROR_CODES.FOCUS_ACTIVE_SESSION_EXISTS, "当前已有进行中的专注会话。");
    }

    const cleanPurpose = validateStartInput(purpose, durationMinutes, draftState.settings);
    const now = Date.now();

    draftState.currentSession = {
      id: createId("session"),
      status: SESSION_STATUS.ACTIVE,
      purpose: cleanPurpose,
      startAt: now,
      endAt: now + durationMinutes * 60 * 1000,
      plannedMinutes: durationMinutes,
      whitelistSnapshot: [...draftState.whitelistEntries],
      allowAllUntil: null,
      unlockState: createDefaultUnlockState(),
      createdAt: now,
      updatedAt: now
    };
    draftState.tabBlockState = {};
    startedSession = buildSessionView(draftState.currentSession);
  });

  await applyFocusRules(state.currentSession);
  await syncAlarms(state.currentSession);
  await closeTempAllowReminderWindow();
  await scanAndBlockExistingTabs(state.currentSession);

  return startedSession ?? buildSessionView(state.currentSession);
}

export async function endSession(endReason = SESSION_STATUS.COMPLETED) {
  let archivedSession = null;
  let blockedTabsToRestore = {};

  await updateState((state) => {
    if (!isSessionActive(state.currentSession)) {
      return state;
    }

    archivedSession = buildArchivedSession(state.currentSession, endReason);
    blockedTabsToRestore = { ...state.tabBlockState };
    state.sessionHistory.unshift(buildSessionHistoryEntry(archivedSession));
    state.currentSession = null;
    state.tabBlockState = {};
  });

  if (!archivedSession) {
    return null;
  }

  await clearFocusRules();
  await syncAlarms(null);
  await restoreBlockedTabs(blockedTabsToRestore);
  await closeTempAllowReminderWindow();
  await clearTabRestoreTargets(Object.keys(blockedTabsToRestore));
  await clearUnlockChallenge(archivedSession.id);

  return archivedSession;
}

export async function applyTemporaryAllow({ clearPendingResult = false } = {}) {
  let sessionView = null;
  let blockedTabsToRestore = {};

  const state = await updateState((draftState) => {
    if (!isSessionActive(draftState.currentSession)) {
      throw new AppError(ERROR_CODES.FOCUS_NO_ACTIVE_SESSION, "当前没有进行中的专注会话。");
    }

    const now = Date.now();
    const allowUntil = Math.min(draftState.currentSession.endAt, now + TEMP_ALLOW_MINUTES * 60 * 1000);

    blockedTabsToRestore = { ...draftState.tabBlockState };
    draftState.currentSession.allowAllUntil = allowUntil;

    if (clearPendingResult) {
      ensureUnlockState(draftState.currentSession).pendingResultAvailable = false;
    }

    draftState.currentSession.updatedAt = now;
    draftState.tabBlockState = {};
    sessionView = buildSessionView(draftState.currentSession);
  });

  await clearFocusRules();
  await syncAlarms(state.currentSession);
  await restoreBlockedTabs(blockedTabsToRestore);
  await ensureTempAllowReminderWindow();
  await clearTabRestoreTargets(Object.keys(blockedTabsToRestore));

  return sessionView ?? buildSessionView(state.currentSession);
}

export async function recoverSessionState() {
  const currentState = await readState();
  const session = currentState.currentSession;

  if (!isSessionActive(session)) {
    await clearFocusRules();
    await syncAlarms(null);
    await closeTempAllowReminderWindow();
    return null;
  }

  const now = Date.now();
  const hadTemporaryAllowWindow = (session.allowAllUntil ?? 0) > 0;

  if (now >= session.endAt) {
    await endSession(SESSION_STATUS.COMPLETED);
    return null;
  }

  const nextState = await updateState((state) => {
    if (!isSessionActive(state.currentSession)) {
      return state;
    }

    let didChange = false;
    const unlockState = ensureUnlockState(state.currentSession);

    if ((state.currentSession.allowAllUntil ?? 0) <= now && state.currentSession.allowAllUntil !== null) {
      state.currentSession.allowAllUntil = null;
      didChange = true;
    }

    if ((unlockState.cooldownUntil ?? 0) <= now && unlockState.cooldownUntil !== null) {
      unlockState.cooldownUntil = null;
      didChange = true;
    }

    if (didChange) {
      state.currentSession.updatedAt = now;
    }
  });

  if (!isSessionActive(nextState.currentSession)) {
    await clearFocusRules();
    await syncAlarms(null);
    await closeTempAllowReminderWindow();
    return null;
  }

  if (isTemporaryAllowActive(nextState.currentSession)) {
    await clearFocusRules();
    await ensureTempAllowReminderWindow();
  } else {
    await applyFocusRules(nextState.currentSession);
    await closeTempAllowReminderWindow();

    if (hadTemporaryAllowWindow) {
      await scanAndBlockExistingTabs(nextState.currentSession);
    }
  }

  await syncAlarms(nextState.currentSession);
  return buildSessionView(nextState.currentSession);
}

export async function handleAlarm(alarmName) {
  if (alarmName === ALARM_NAMES.TEMP_ALLOW_END) {
    const state = await readState();

    if (!isSessionActive(state.currentSession)) {
      await closeTempAllowReminderWindow();
      return;
    }

    if (Date.now() >= state.currentSession.endAt) {
      await endSession(SESSION_STATUS.COMPLETED);
      return;
    }

    const nextState = await updateState((draftState) => {
      if (!isSessionActive(draftState.currentSession)) {
        return draftState;
      }

      draftState.currentSession.allowAllUntil = null;
      draftState.currentSession.updatedAt = Date.now();
    });

    if (!isSessionActive(nextState.currentSession)) {
      await closeTempAllowReminderWindow();
      return;
    }

    await applyFocusRules(nextState.currentSession);
    await scanAndBlockExistingTabs(nextState.currentSession);
    await syncAlarms(nextState.currentSession);
    await closeTempAllowReminderWindow();
    return;
  }

  if (alarmName === ALARM_NAMES.SESSION_END) {
    await endSession(SESSION_STATUS.COMPLETED);
  }
}

export async function forceDebugExit() {
  if (!DEVELOPMENT_BUILD) {
    throw new AppError(ERROR_CODES.FOCUS_CONFIGURATION_LOCKED, "当前版本未启用调试快速退出。");
  }

  return endSession("debug");
}

export async function getBlockContext(tabId) {
  const state = await readState();
  const session = buildSessionView(state.currentSession);
  const blockedInfo = state.tabBlockState[String(tabId)] ?? null;
  const returnUrl = Number.isInteger(tabId) ? await getTabRestoreTarget(tabId) : null;

  return {
    hasActiveSession: Boolean(session),
    blockedInfo: blockedInfo
      ? {
          ...blockedInfo,
          returnUrl: returnUrl ?? blockedInfo.origin ?? null
        }
      : null,
    currentSession: session
  };
}

export async function shouldRecordNavigationBlock(url) {
  const state = await readState();
  const session = state.currentSession;

  if (!isSessionActive(session) || isTemporaryAllowActive(session)) {
    return false;
  }

  return !isUrlAllowed(url, session.whitelistSnapshot);
}
