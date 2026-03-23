export const DEVELOPMENT_BUILD = true;

export const STORAGE_KEYS = {
  SETTINGS: "settings",
  WHITELIST: "whitelistEntries",
  CURRENT_SESSION: "currentSession",
  SESSION_HISTORY: "sessionHistory",
  BLOCK_ATTEMPTS: "blockAttempts",
  UNLOCK_ATTEMPTS: "unlockAttempts",
  ERROR_LOGS: "errorLogs",
  TAB_BLOCK_STATE: "tabBlockState"
};

export const MESSAGE_TYPES = {
  GET_APP_STATE: "GET_APP_STATE",
  START_SESSION: "START_SESSION",
  GET_OPTIONS_DATA: "GET_OPTIONS_DATA",
  SAVE_OPTIONS: "SAVE_OPTIONS",
  GET_BLOCK_CONTEXT: "GET_BLOCK_CONTEXT",
  GET_UNLOCK_CONTEXT: "GET_UNLOCK_CONTEXT",
  SUBMIT_UNLOCK_ANSWERS: "SUBMIT_UNLOCK_ANSWERS",
  APPLY_UNLOCK_RESULT: "APPLY_UNLOCK_RESULT",
  GET_DASHBOARD_DATA: "GET_DASHBOARD_DATA",
  CLEAR_ERROR_LOGS: "CLEAR_ERROR_LOGS",
  FORCE_DEBUG_EXIT: "FORCE_DEBUG_EXIT"
};

export const ALARM_NAMES = {
  SESSION_END: "focus-session-end",
  TEMP_ALLOW_END: "focus-temp-allow-end"
};

export const SESSION_STATUS = {
  ACTIVE: "active",
  COMPLETED: "completed",
  UNLOCKED: "unlocked"
};

export const QUICK_DURATION_OPTIONS = [30, 60, 120, 180];

export const CUSTOM_DURATION_CAP_OPTIONS = [
  { value: "180", label: "最多 180 分钟", maxMinutes: 180 },
  { value: "360", label: "最多 360 分钟", maxMinutes: 360 },
  { value: "720", label: "最多 720 分钟", maxMinutes: 720 }
];

export const TEMP_ALLOW_MINUTES = 10;
export const UNLOCK_QUESTION_COUNT = 5;
export const DEFAULT_UNLOCK_COOLDOWN_MINUTES = 5;
export const MAX_ERROR_LOGS = 200;

export const PRESET_SITES = [
  { id: "preset-wikipedia", domain: "wikipedia.org", includeSubdomains: true, label: "Wikipedia" },
  { id: "preset-coursera", domain: "coursera.org", includeSubdomains: true, label: "Coursera" },
  { id: "preset-mooc", domain: "mooc.icourse163.org", includeSubdomains: true, label: "中国大学 MOOC" },
  { id: "preset-bilibili", domain: "bilibili.com", includeSubdomains: true, label: "Bilibili" }
];

export const DEFAULT_SETTINGS = {
  theme: "dark",
  customDurationCapOption: CUSTOM_DURATION_CAP_OPTIONS[2].value,
  unlockCooldownEnabled: false,
  unlockCooldownMinutes: DEFAULT_UNLOCK_COOLDOWN_MINUTES,
  devToolsEnabled: DEVELOPMENT_BUILD
};

export const PAGE_PATHS = {
  START_SESSION: "pages/start-session.html",
  OPTIONS: "pages/options.html",
  BLOCK: "pages/block.html",
  DASHBOARD: "pages/dashboard.html",
  UNLOCK: "pages/unlock.html",
  TEMP_ALLOW_REMINDER: "pages/temp-allow-reminder.html"
};

export const THEMES = [
  { value: "dark", label: "暗色" },
  { value: "light", label: "亮色" }
];

export const DASHBOARD_RANGES = [
  { value: "today", label: "今日" },
  { value: "week", label: "本周" },
  { value: "all", label: "全部" }
];

export function getDurationCapOption(value) {
  return CUSTOM_DURATION_CAP_OPTIONS.find((option) => option.value === value) ?? CUSTOM_DURATION_CAP_OPTIONS[0];
}

