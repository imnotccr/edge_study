export const ERROR_CODES = Object.freeze({
  UNKNOWN: "SYSTEM_001",
  MESSAGE_UNKNOWN_TYPE: "CORE_001",
  TRANSPORT_FAILED: "CORE_002",
  FOCUS_CONFIGURATION_LOCKED: "FOCUS_001",
  FOCUS_ACTIVE_SESSION_EXISTS: "FOCUS_002",
  FOCUS_NO_ACTIVE_SESSION: "FOCUS_003",
  SESSION_PURPOSE_REQUIRED: "SESSION_001",
  SESSION_DURATION_INVALID: "SESSION_002",
  SESSION_DURATION_EXCEEDS_CAP: "SESSION_003",
  SETTINGS_DOMAIN_INVALID: "SETTINGS_001",
  SETTINGS_DURATION_CAP_INVALID: "SETTINGS_002",
  SETTINGS_THEME_INVALID: "SETTINGS_003",
  SETTINGS_COOLDOWN_INVALID: "SETTINGS_005",
  SETTINGS_DOMAIN_DUPLICATE: "SETTINGS_006",
  UNLOCK_REASON_REQUIRED: "UNLOCK_001",
  UNLOCK_CHALLENGE_MISSING: "UNLOCK_002",
  UNLOCK_PENDING_RESULT_MISSING: "UNLOCK_003",
  UNLOCK_RESULT_UNSUPPORTED: "UNLOCK_004",
  UNLOCK_ANSWERS_INCORRECT: "UNLOCK_005",
  UNLOCK_COOLDOWN_ACTIVE: "UNLOCK_006",
  UNLOCK_ANSWERS_INCOMPLETE: "UNLOCK_007",
  UNLOCK_TEMP_ALLOW_ACTIVE: "UNLOCK_008"
});

export class AppError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
  }
}

export function normalizeError(error) {
  if (error instanceof AppError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details ?? null
    };
  }

  if (error && typeof error === "object" && typeof error.message === "string") {
    return {
      code: typeof error.code === "string" ? error.code : ERROR_CODES.UNKNOWN,
      message: error.message,
      details: error.details ?? null
    };
  }

  return {
    code: ERROR_CODES.UNKNOWN,
    message: "发生了未预期的系统错误。",
    details: null
  };
}

export function buildErrorResponse(error) {
  const normalized = normalizeError(error);
  return {
    ok: false,
    error: normalized.message,
    code: normalized.code,
    details: normalized.details
  };
}

export function formatErrorLabel(errorLike) {
  if (!errorLike) {
    return `[${ERROR_CODES.UNKNOWN}] 发生了未预期的系统错误。`;
  }

  const code = errorLike.code ?? ERROR_CODES.UNKNOWN;
  const message = errorLike.message ?? errorLike.error ?? "发生了未预期的系统错误。";
  return `[${code}] ${message}`;
}
