import {
  ALARM_NAMES,
  DEVELOPMENT_BUILD,
  SESSION_STATUS,
  TEMP_ALLOW_MINUTES,
  getDurationCapOption
} from "../shared/constants.js";
import { isUrlAllowed } from "../shared/domain.js";
import { AppError, ERROR_CODES } from "../shared/errors.js";
import { getRemainingMs } from "../shared/time.js";
import { readState, replaceState } from "../shared/storage.js";
import { applyFocusRules, clearFocusRules, scanAndBlockExistingTabs } from "./rules-manager.js";

function createId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function createDefaultUnlockState() {
  return {
    failedCount: 0,
    cooldownUntil: null,
    pendingChallenge: null,
    pendingResult: null
  };
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

function buildArchivedSession(session, endReason) {
  return {
    ...session,
    status: endReason === SESSION_STATUS.UNLOCKED ? SESSION_STATUS.UNLOCKED : SESSION_STATUS.COMPLETED,
    endReason,
    actualEndAt: Date.now(),
    updatedAt: Date.now()
  };
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

export async function getAppState() {
  const state = await readState();
  return {
    developmentBuild: DEVELOPMENT_BUILD,
    hasActiveSession: isSessionActive(state.currentSession),
    canEditConfiguration: !isSessionActive(state.currentSession),
    settings: state.settings,
    whitelistCount: state.whitelistEntries.length,
    currentSession: buildSessionView(state.currentSession)
  };
}

export async function startSession({ purpose, durationMinutes }) {
  const state = await readState();

  if (isSessionActive(state.currentSession)) {
    throw new AppError(ERROR_CODES.FOCUS_ACTIVE_SESSION_EXISTS, "当前已有进行中的专注会话。");
  }

  const cleanPurpose = validateStartInput(purpose, durationMinutes, state.settings);
  const now = Date.now();

  state.currentSession = {
    id: createId("session"),
    status: SESSION_STATUS.ACTIVE,
    purpose: cleanPurpose,
    startAt: now,
    endAt: now + durationMinutes * 60 * 1000,
    plannedMinutes: durationMinutes,
    whitelistSnapshot: [...state.whitelistEntries],
    allowAllUntil: null,
    unlockState: createDefaultUnlockState(),
    createdAt: now,
    updatedAt: now
  };
  state.tabBlockState = {};

  await replaceState(state);
  await applyFocusRules(state.currentSession);
  await syncAlarms(state.currentSession);
  await scanAndBlockExistingTabs(state.currentSession);

  return buildSessionView(state.currentSession);
}

export async function endSession(endReason = SESSION_STATUS.COMPLETED) {
  const state = await readState();

  if (!isSessionActive(state.currentSession)) {
    return null;
  }

  const archivedSession = buildArchivedSession(state.currentSession, endReason);
  state.sessionHistory.unshift({
    id: archivedSession.id,
    status: archivedSession.status,
    endReason: archivedSession.endReason,
    purpose: archivedSession.purpose,
    startAt: archivedSession.startAt,
    endAt: archivedSession.endAt,
    actualEndAt: archivedSession.actualEndAt,
    durationMinutes: Math.max(1, Math.round((archivedSession.actualEndAt - archivedSession.startAt) / 60000)),
    plannedMinutes: archivedSession.plannedMinutes
  });
  state.currentSession = null;
  state.tabBlockState = {};

  await replaceState(state);
  await clearFocusRules();
  await syncAlarms(null);

  return archivedSession;
}

export async function applyTemporaryAllow() {
  const state = await readState();

  if (!isSessionActive(state.currentSession)) {
    throw new AppError(ERROR_CODES.FOCUS_NO_ACTIVE_SESSION, "当前没有进行中的专注会话。");
  }

  const now = Date.now();
  const allowUntil = Math.min(state.currentSession.endAt, now + TEMP_ALLOW_MINUTES * 60 * 1000);
  state.currentSession.allowAllUntil = allowUntil;
  state.currentSession.updatedAt = now;

  await replaceState(state);
  await clearFocusRules();
  await syncAlarms(state.currentSession);

  return buildSessionView(state.currentSession);
}

export async function recoverSessionState() {
  const state = await readState();
  const session = state.currentSession;

  if (!isSessionActive(session)) {
    await clearFocusRules();
    await syncAlarms(null);
    return null;
  }

  const now = Date.now();

  if (now >= session.endAt) {
    await endSession(SESSION_STATUS.COMPLETED);
    return null;
  }

  if ((session.allowAllUntil ?? 0) <= now) {
    state.currentSession.allowAllUntil = null;
  }

  if ((session.unlockState?.cooldownUntil ?? 0) <= now) {
    state.currentSession.unlockState.cooldownUntil = null;
  }

  await replaceState(state);

  if (isTemporaryAllowActive(state.currentSession)) {
    await clearFocusRules();
  } else {
    await applyFocusRules(state.currentSession);
  }

  await syncAlarms(state.currentSession);
  return buildSessionView(state.currentSession);
}

export async function handleAlarm(alarmName) {
  if (alarmName === ALARM_NAMES.TEMP_ALLOW_END) {
    const state = await readState();

    if (!isSessionActive(state.currentSession)) {
      return;
    }

    if (Date.now() >= state.currentSession.endAt) {
      await endSession(SESSION_STATUS.COMPLETED);
      return;
    }

    state.currentSession.allowAllUntil = null;
    state.currentSession.updatedAt = Date.now();
    await replaceState(state);
    await applyFocusRules(state.currentSession);
    await syncAlarms(state.currentSession);
    return;
  }

  if (alarmName === ALARM_NAMES.SESSION_END) {
    await endSession(SESSION_STATUS.COMPLETED);
  }
}

export async function forceDebugExit() {
  return endSession("debug");
}

export async function getBlockContext(tabId) {
  const state = await readState();
  const session = buildSessionView(state.currentSession);
  const blockedInfo = state.tabBlockState[String(tabId)] ?? null;

  return {
    hasActiveSession: Boolean(session),
    blockedInfo,
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
