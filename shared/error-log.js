import { MAX_ERROR_LOGS, STORAGE_KEYS } from "./constants.js";
import { normalizeError } from "./errors.js";

function createId() {
  return `error-${crypto.randomUUID()}`;
}

function mergeDetails(normalizedDetails, extraDetails) {
  if (!normalizedDetails && !extraDetails) {
    return null;
  }

  return {
    ...(normalizedDetails ?? {}),
    ...(extraDetails ?? {})
  };
}

async function readErrorLogs() {
  const result = await chrome.storage.local.get({
    [STORAGE_KEYS.ERROR_LOGS]: []
  });

  return Array.isArray(result[STORAGE_KEYS.ERROR_LOGS]) ? result[STORAGE_KEYS.ERROR_LOGS] : [];
}

export async function logErrorEvent({ error, source = "unknown", scope = "unknown", details = null, level = "error" }) {
  try {
    const normalized = normalizeError(error);
    const entry = {
      id: createId(),
      code: normalized.code,
      message: normalized.message,
      source,
      scope,
      level,
      details: mergeDetails(normalized.details, details),
      createdAt: Date.now()
    };
    const errorLogs = await readErrorLogs();

    errorLogs.unshift(entry);
    await chrome.storage.local.set({
      [STORAGE_KEYS.ERROR_LOGS]: errorLogs.slice(0, MAX_ERROR_LOGS)
    });

    return entry;
  } catch (loggingError) {
    console.warn("error log write failed", loggingError);
    return null;
  }
}

export async function clearErrorLogs() {
  await chrome.storage.local.set({
    [STORAGE_KEYS.ERROR_LOGS]: []
  });

  return { cleared: true };
}

export async function reportPageError(errorLike, scope, details = null) {
  return logErrorEvent({
    error: errorLike,
    source: "page",
    scope,
    details
  });
}

export function installGlobalErrorHandlers(scope) {
  if (typeof window === "undefined") {
    return;
  }

  window.addEventListener("error", (event) => {
    void reportPageError(event.error ?? { message: event.message }, scope, {
      kind: "window.error"
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    void reportPageError(event.reason ?? { message: "未处理的 Promise 拒绝。" }, scope, {
      kind: "window.unhandledrejection"
    });
  });
}
