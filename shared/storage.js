import { DEFAULT_SETTINGS, DEVELOPMENT_BUILD, STORAGE_KEYS } from "./constants.js";

function cloneData(value) {
  if (value === undefined) {
    return undefined;
  }

  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeSettings(settings, defaults) {
  const normalized = {
    ...defaults,
    ...(isPlainObject(settings) ? settings : {})
  };

  normalized.devToolsEnabled = Boolean(DEFAULT_SETTINGS.devToolsEnabled && normalized.devToolsEnabled);
  return normalized;
}

function normalizeTimestamp(value) {
  return Number.isFinite(value) ? value : null;
}

function normalizeUnlockState(unlockState) {
  const normalized = isPlainObject(unlockState) ? unlockState : {};

  return {
    failedCount: Number.isInteger(normalized.failedCount) && normalized.failedCount > 0 ? normalized.failedCount : 0,
    cooldownUntil: normalizeTimestamp(normalized.cooldownUntil),
    pendingChallengeId: typeof normalized.pendingChallengeId === "string" ? normalized.pendingChallengeId : null,
    pendingResultAvailable: Boolean(normalized.pendingResultAvailable)
  };
}

function normalizeCurrentSession(session) {
  if (!isPlainObject(session)) {
    return null;
  }

  const normalized = cloneData(session);
  normalized.unlockState = normalizeUnlockState(session.unlockState);
  return normalized;
}

function normalizeSessionHistory(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .filter(isPlainObject)
    .map((item) => ({
      id: item.id ?? null,
      status: item.status ?? null,
      endReason: item.endReason ?? null,
      purpose: item.purpose ?? "",
      startAt: normalizeTimestamp(item.startAt),
      endAt: normalizeTimestamp(item.endAt),
      actualEndAt: normalizeTimestamp(item.actualEndAt),
      durationMinutes: Number.isFinite(item.durationMinutes) ? item.durationMinutes : 0,
      plannedMinutes: Number.isFinite(item.plannedMinutes) ? item.plannedMinutes : 0
    }));
}

function normalizeBlockAttempts(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .filter(isPlainObject)
    .map((item) => ({
      id: item.id ?? null,
      sessionId: item.sessionId ?? null,
      domain: typeof item.domain === "string" ? item.domain : null,
      attemptAt: normalizeTimestamp(item.attemptAt),
      source: typeof item.source === "string" ? item.source : null
    }))
    .filter((item) => item.domain && item.attemptAt !== null);
}

function normalizeUnlockAttempts(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .filter(isPlainObject)
    .map((item) => ({
      id: item.id ?? null,
      sessionId: item.sessionId ?? null,
      createdAt: normalizeTimestamp(item.createdAt),
      result: typeof item.result === "string" ? item.result : null,
      score: Number.isFinite(item.score) ? item.score : null,
      allowMinutes: Number.isFinite(item.allowMinutes) ? item.allowMinutes : null,
      cooldownUntil: normalizeTimestamp(item.cooldownUntil)
    }))
    .filter((item) => item.createdAt !== null && item.result);
}

function normalizeUnlockQuestionHistory(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .filter(isPlainObject)
    .map((item) => ({
      key: typeof item.key === "string" ? item.key : null,
      createdAt: normalizeTimestamp(item.createdAt)
    }))
    .filter((item) => item.key && item.createdAt !== null);
}

function normalizeTabBlockState(tabBlockState) {
  if (!isPlainObject(tabBlockState)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(tabBlockState)
      .filter(([, value]) => isPlainObject(value))
      .map(([tabId, value]) => [
        tabId,
        {
          domain: typeof value.domain === "string" ? value.domain : null,
          origin: typeof value.origin === "string" ? value.origin : null,
          attemptAt: normalizeTimestamp(value.attemptAt),
          source: typeof value.source === "string" ? value.source : null
        }
      ])
      .filter(([, value]) => value.domain)
  );
}

function buildDefaultState() {
  return {
    [STORAGE_KEYS.SETTINGS]: cloneData(DEFAULT_SETTINGS),
    [STORAGE_KEYS.WHITELIST]: [],
    [STORAGE_KEYS.CURRENT_SESSION]: null,
    [STORAGE_KEYS.SESSION_HISTORY]: [],
    [STORAGE_KEYS.BLOCK_ATTEMPTS]: [],
    [STORAGE_KEYS.UNLOCK_ATTEMPTS]: [],
    [STORAGE_KEYS.UNLOCK_QUESTION_HISTORY]: [],
    [STORAGE_KEYS.ERROR_LOGS]: [],
    [STORAGE_KEYS.TAB_BLOCK_STATE]: {}
  };
}

function normalizeState(state = {}) {
  const defaults = buildDefaultState();

  return {
    [STORAGE_KEYS.SETTINGS]: normalizeSettings(state[STORAGE_KEYS.SETTINGS], defaults[STORAGE_KEYS.SETTINGS]),
    [STORAGE_KEYS.WHITELIST]: Array.isArray(state[STORAGE_KEYS.WHITELIST])
      ? cloneData(state[STORAGE_KEYS.WHITELIST])
      : [],
    [STORAGE_KEYS.CURRENT_SESSION]: normalizeCurrentSession(state[STORAGE_KEYS.CURRENT_SESSION]),
    [STORAGE_KEYS.SESSION_HISTORY]: normalizeSessionHistory(state[STORAGE_KEYS.SESSION_HISTORY]),
    [STORAGE_KEYS.BLOCK_ATTEMPTS]: normalizeBlockAttempts(state[STORAGE_KEYS.BLOCK_ATTEMPTS]),
    [STORAGE_KEYS.UNLOCK_ATTEMPTS]: normalizeUnlockAttempts(state[STORAGE_KEYS.UNLOCK_ATTEMPTS]),
    [STORAGE_KEYS.UNLOCK_QUESTION_HISTORY]: normalizeUnlockQuestionHistory(state[STORAGE_KEYS.UNLOCK_QUESTION_HISTORY]),
    [STORAGE_KEYS.ERROR_LOGS]: DEVELOPMENT_BUILD && Array.isArray(state[STORAGE_KEYS.ERROR_LOGS])
      ? cloneData(state[STORAGE_KEYS.ERROR_LOGS])
      : [],
    [STORAGE_KEYS.TAB_BLOCK_STATE]: normalizeTabBlockState(state[STORAGE_KEYS.TAB_BLOCK_STATE])
  };
}

function buildComparableState(state = {}) {
  return {
    [STORAGE_KEYS.SETTINGS]: isPlainObject(state[STORAGE_KEYS.SETTINGS]) ? state[STORAGE_KEYS.SETTINGS] : null,
    [STORAGE_KEYS.WHITELIST]: state[STORAGE_KEYS.WHITELIST],
    [STORAGE_KEYS.CURRENT_SESSION]: state[STORAGE_KEYS.CURRENT_SESSION] ?? null,
    [STORAGE_KEYS.SESSION_HISTORY]: state[STORAGE_KEYS.SESSION_HISTORY],
    [STORAGE_KEYS.BLOCK_ATTEMPTS]: state[STORAGE_KEYS.BLOCK_ATTEMPTS],
    [STORAGE_KEYS.UNLOCK_ATTEMPTS]: state[STORAGE_KEYS.UNLOCK_ATTEMPTS],
    [STORAGE_KEYS.UNLOCK_QUESTION_HISTORY]: state[STORAGE_KEYS.UNLOCK_QUESTION_HISTORY],
    [STORAGE_KEYS.ERROR_LOGS]: state[STORAGE_KEYS.ERROR_LOGS],
    [STORAGE_KEYS.TAB_BLOCK_STATE]: state[STORAGE_KEYS.TAB_BLOCK_STATE]
  };
}

function isStateEqual(leftState, rightState) {
  return JSON.stringify(leftState) === JSON.stringify(rightState);
}

let stateUpdateQueue = Promise.resolve();

export async function ensureStateInitialized() {
  const current = await chrome.storage.local.get(null);
  const normalized = normalizeState(current);

  if (!isStateEqual(buildComparableState(current), normalized)) {
    await chrome.storage.local.set(cloneData(normalized));
  }

  return cloneData(normalized);
}

export async function readState() {
  const current = await chrome.storage.local.get(null);
  return normalizeState(current);
}

export async function writeState(partialState) {
  await chrome.storage.local.set(cloneData(partialState));
}

export async function replaceState(nextState) {
  const normalized = normalizeState(nextState);
  await chrome.storage.local.set(cloneData(normalized));
  return cloneData(normalized);
}

export async function updateState(mutator) {
  const run = stateUpdateQueue.then(async () => {
    const currentState = await readState();
    const draftState = cloneData(currentState);
    const maybeNextState = await mutator(draftState);
    const normalizedNextState = normalizeState(maybeNextState === undefined ? draftState : maybeNextState);

    if (!isStateEqual(currentState, normalizedNextState)) {
      await chrome.storage.local.set(cloneData(normalizedNextState));
    }

    return cloneData(normalizedNextState);
  });

  stateUpdateQueue = run.catch(() => undefined);
  return run;
}

export { cloneData };
