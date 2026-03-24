import { DEVELOPMENT_BUILD, MAX_ERROR_LOGS, STORAGE_KEYS } from "./constants.js";
import { normalizeError } from "./errors.js";

const REDACTED_DETAIL_KEYS = new Set([
  "answer",
  "answers",
  "challenge",
  "challengeId",
  "href",
  "origin",
  "pendingChallenge",
  "pendingResult",
  "question",
  "questionSet",
  "reason",
  "returnUrl",
  "url"
]);

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

function sanitizeDetails(value, parentKey = "") {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDetails(item, parentKey));
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => {
        if (REDACTED_DETAIL_KEYS.has(key)) {
          return [key, "[redacted]"];
        }

        return [key, sanitizeDetails(entryValue, key)];
      })
    );
  }

  if (typeof value === "string" && REDACTED_DETAIL_KEYS.has(parentKey)) {
    return "[redacted]";
  }

  return value;
}

async function readErrorLogs() {
  const result = await chrome.storage.local.get({
    [STORAGE_KEYS.ERROR_LOGS]: []
  });

  return Array.isArray(result[STORAGE_KEYS.ERROR_LOGS]) ? result[STORAGE_KEYS.ERROR_LOGS] : [];
}

export async function logErrorEvent({ error, source = "unknown", scope = "unknown", details = null, level = "error" }) {
  if (!DEVELOPMENT_BUILD) {
    return null;
  }

  try {
    const normalized = normalizeError(error);
    const entry = {
      id: createId(),
      code: normalized.code,
      message: normalized.message,
      source,
      scope,
      level,
      details: sanitizeDetails(mergeDetails(normalized.details, details)),
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
