import { DEFAULT_SETTINGS, STORAGE_KEYS } from "./constants.js";

function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
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

export async function ensureStateInitialized() {
  const defaults = buildDefaultState();
  const current = await chrome.storage.local.get(defaults);
  const normalized = {
    ...defaults,
    ...current,
    [STORAGE_KEYS.SETTINGS]: {
      ...defaults[STORAGE_KEYS.SETTINGS],
      ...(current[STORAGE_KEYS.SETTINGS] ?? {})
    },
    [STORAGE_KEYS.WHITELIST]: Array.isArray(current[STORAGE_KEYS.WHITELIST]) ? current[STORAGE_KEYS.WHITELIST] : [],
    [STORAGE_KEYS.SESSION_HISTORY]: Array.isArray(current[STORAGE_KEYS.SESSION_HISTORY])
      ? current[STORAGE_KEYS.SESSION_HISTORY]
      : [],
    [STORAGE_KEYS.BLOCK_ATTEMPTS]: Array.isArray(current[STORAGE_KEYS.BLOCK_ATTEMPTS])
      ? current[STORAGE_KEYS.BLOCK_ATTEMPTS]
      : [],
    [STORAGE_KEYS.UNLOCK_ATTEMPTS]: Array.isArray(current[STORAGE_KEYS.UNLOCK_ATTEMPTS])
      ? current[STORAGE_KEYS.UNLOCK_ATTEMPTS]
      : [],
    [STORAGE_KEYS.ERROR_LOGS]: Array.isArray(current[STORAGE_KEYS.ERROR_LOGS])
      ? current[STORAGE_KEYS.ERROR_LOGS]
      : [],
    [STORAGE_KEYS.TAB_BLOCK_STATE]:
      current[STORAGE_KEYS.TAB_BLOCK_STATE] && typeof current[STORAGE_KEYS.TAB_BLOCK_STATE] === "object"
        ? current[STORAGE_KEYS.TAB_BLOCK_STATE]
        : {}
  };

  await chrome.storage.local.set(normalized);
  return normalized;
}

export async function readState() {
  return ensureStateInitialized();
}

export async function writeState(partialState) {
  await chrome.storage.local.set(cloneData(partialState));
}

export async function replaceState(nextState) {
  await chrome.storage.local.set(cloneData(nextState));
}

export { cloneData };
