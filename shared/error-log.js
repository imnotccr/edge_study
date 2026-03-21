import { MAX_ERROR_LOGS } from "./constants.js";
import { normalizeError } from "./errors.js";
import { readState, replaceState } from "./storage.js";

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

export async function logErrorEvent({ error, source = "unknown", scope = "unknown", details = null, level = "error" }) {
  try {
    const state = await readState();
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

    state.errorLogs.unshift(entry);
    state.errorLogs = state.errorLogs.slice(0, MAX_ERROR_LOGS);
    await replaceState(state);
    return entry;
  } catch (loggingError) {
    console.warn("error log write failed", loggingError);
    return null;
  }
}

export async function clearErrorLogs() {
  const state = await readState();
  state.errorLogs = [];
  await replaceState(state);
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
