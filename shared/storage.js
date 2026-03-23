import { DEFAULT_SETTINGS, STORAGE_KEYS } from "./constants.js";

function cloneData(value) {
  if (value === undefined) {
    return undefined;
  }

  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function buildDefaultState() {
  return {
    [STORAGE_KEYS.SETTINGS]: cloneData(DEFAULT_SETTINGS),
    [STORAGE_KEYS.WHITELIST]: [],
    [STORAGE_KEYS.CURRENT_SESSION]: null,
    [STORAGE_KEYS.SESSION_HISTORY]: [],
    [STORAGE_KEYS.BLOCK_ATTEMPTS]: [],
    [STORAGE_KEYS.UNLOCK_ATTEMPTS]: [],
    [STORAGE_KEYS.ERROR_LOGS]: [],
    [STORAGE_KEYS.TAB_BLOCK_STATE]: {}
  };
}

function normalizeSettings(settings, defaults) {
  const normalized = {
    ...defaults,
    ...(isPlainObject(settings) ? settings : {})
  };

  normalized.devToolsEnabled = Boolean(DEFAULT_SETTINGS.devToolsEnabled && normalized.devToolsEnabled);
  return normalized;
}

function normalizeState(state = {}) {
  const defaults = buildDefaultState();

  return {
    [STORAGE_KEYS.SETTINGS]: normalizeSettings(state[STORAGE_KEYS.SETTINGS], defaults[STORAGE_KEYS.SETTINGS]),
    [STORAGE_KEYS.WHITELIST]: Array.isArray(state[STORAGE_KEYS.WHITELIST])
      ? cloneData(state[STORAGE_KEYS.WHITELIST])
      : [],
    [STORAGE_KEYS.CURRENT_SESSION]: isPlainObject(state[STORAGE_KEYS.CURRENT_SESSION])
      ? cloneData(state[STORAGE_KEYS.CURRENT_SESSION])
      : null,
    [STORAGE_KEYS.SESSION_HISTORY]: Array.isArray(state[STORAGE_KEYS.SESSION_HISTORY])
      ? cloneData(state[STORAGE_KEYS.SESSION_HISTORY])
      : [],
    [STORAGE_KEYS.BLOCK_ATTEMPTS]: Array.isArray(state[STORAGE_KEYS.BLOCK_ATTEMPTS])
      ? cloneData(state[STORAGE_KEYS.BLOCK_ATTEMPTS])
      : [],
    [STORAGE_KEYS.UNLOCK_ATTEMPTS]: Array.isArray(state[STORAGE_KEYS.UNLOCK_ATTEMPTS])
      ? cloneData(state[STORAGE_KEYS.UNLOCK_ATTEMPTS])
      : [],
    [STORAGE_KEYS.ERROR_LOGS]: Array.isArray(state[STORAGE_KEYS.ERROR_LOGS])
      ? cloneData(state[STORAGE_KEYS.ERROR_LOGS])
      : [],
    [STORAGE_KEYS.TAB_BLOCK_STATE]: isPlainObject(state[STORAGE_KEYS.TAB_BLOCK_STATE])
      ? cloneData(state[STORAGE_KEYS.TAB_BLOCK_STATE])
      : {}
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
