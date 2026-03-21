function pad(value) {
  return String(value).padStart(2, "0");
}

export function formatCountdown(remainingMs) {
  const safeRemaining = Math.max(0, remainingMs);
  const totalSeconds = Math.ceil(safeRemaining / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }

  return `${pad(minutes)}:${pad(seconds)}`;
}

export function formatMinutesLabel(minutes) {
  if (!Number.isFinite(minutes)) {
    return "0 分钟";
  }

  return `${Math.max(0, Math.round(minutes))} 分钟`;
}

export function formatClockTime(timestamp) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

export function formatDateTime(timestamp) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

export function getRemainingMs(endAt) {
  return Math.max(0, endAt - Date.now());
}

export function getStartOfToday(timestamp = Date.now()) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function getStartOfWeek(timestamp = Date.now()) {
  const date = new Date(timestamp);
  const day = (date.getDay() + 6) % 7;
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - day);
  return date.getTime();
}
