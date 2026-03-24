import { SESSION_STORAGE_KEYS } from "./constants.js";
import { cloneData } from "./storage.js";

const fallbackBuckets = new Map();

function getSessionStorageArea() {
  return chrome.storage?.session ?? null;
}

async function readBucket(key, defaultValue) {
  const storageArea = getSessionStorageArea();

  if (!storageArea) {
    const fallbackValue = fallbackBuckets.has(key) ? fallbackBuckets.get(key) : defaultValue;
    return cloneData(fallbackValue);
  }

  const response = await storageArea.get({
    [key]: cloneData(defaultValue)
  });

  return cloneData(response[key]);
}

async function writeBucket(key, value) {
  const clonedValue = cloneData(value);
  const storageArea = getSessionStorageArea();

  if (!storageArea) {
    fallbackBuckets.set(key, clonedValue);
    return clonedValue;
  }

  await storageArea.set({
    [key]: clonedValue
  });

  return clonedValue;
}

async function updateBucket(key, defaultValue, mutator) {
  const currentValue = await readBucket(key, defaultValue);
  const draftValue = cloneData(currentValue);
  const maybeNextValue = await mutator(draftValue);
  const nextValue = cloneData(maybeNextValue === undefined ? draftValue : maybeNextValue);
  await writeBucket(key, nextValue);
  return nextValue;
}

export async function setTabRestoreTarget(tabId, url) {
  if (!Number.isInteger(tabId) || typeof url !== "string" || !url) {
    return null;
  }

  const nextState = await updateBucket(SESSION_STORAGE_KEYS.TAB_RESTORE_STATE, {}, (state) => {
    state[String(tabId)] = {
      url,
      updatedAt: Date.now()
    };
  });

  return nextState[String(tabId)] ?? null;
}

export async function getTabRestoreTarget(tabId) {
  if (!Number.isInteger(tabId)) {
    return null;
  }

  const state = await readBucket(SESSION_STORAGE_KEYS.TAB_RESTORE_STATE, {});
  return state[String(tabId)]?.url ?? null;
}

export async function clearTabRestoreTargets(tabIds) {
  if (!Array.isArray(tabIds) || !tabIds.length) {
    return;
  }

  await updateBucket(SESSION_STORAGE_KEYS.TAB_RESTORE_STATE, {}, (state) => {
    for (const tabId of tabIds) {
      delete state[String(tabId)];
    }
  });
}

export async function writeUnlockChallenge(sessionId, challenge) {
  if (!sessionId) {
    return null;
  }

  const nextState = await updateBucket(SESSION_STORAGE_KEYS.UNLOCK_PRIVATE_STATE, {}, (state) => {
    state[sessionId] = {
      challenge: cloneData(challenge),
      updatedAt: Date.now()
    };
  });

  return cloneData(nextState[sessionId]?.challenge ?? null);
}

export async function readUnlockChallenge(sessionId) {
  if (!sessionId) {
    return null;
  }

  const state = await readBucket(SESSION_STORAGE_KEYS.UNLOCK_PRIVATE_STATE, {});
  return cloneData(state[sessionId]?.challenge ?? null);
}

export async function clearUnlockChallenge(sessionId) {
  if (!sessionId) {
    return;
  }

  await updateBucket(SESSION_STORAGE_KEYS.UNLOCK_PRIVATE_STATE, {}, (state) => {
    delete state[sessionId];
  });
}
