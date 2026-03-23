import { MESSAGE_TYPES, PAGE_PATHS } from "../shared/constants.js";
import { formatErrorLabel } from "../shared/errors.js";
import { sendRuntimeMessage } from "../shared/api.js";
import { initTheme } from "../shared/theme.js";
import { formatClockTime, formatCountdown } from "../shared/time.js";

const elements = {
  reminderDescription: document.querySelector("#reminderDescription"),
  reminderStatusBadge: document.querySelector("#reminderStatusBadge"),
  reminderCountdownText: document.querySelector("#reminderCountdownText"),
  reminderPurposeText: document.querySelector("#reminderPurposeText"),
  reminderEndAtText: document.querySelector("#reminderEndAtText"),
  openDashboardButton: document.querySelector("#openDashboardButton")
};

let appState = null;
let countdownTimer = null;
let closeTimer = null;

function scheduleClose() {
  if (closeTimer) {
    return;
  }

  closeTimer = window.setTimeout(() => {
    window.close();
  }, 1500);
}

function clearCloseTimer() {
  if (!closeTimer) {
    return;
  }

  window.clearTimeout(closeTimer);
  closeTimer = null;
}

function renderEndedState(description, status = "已结束") {
  elements.reminderStatusBadge.textContent = status;
  elements.reminderStatusBadge.className = "status-badge success";
  elements.reminderDescription.textContent = description;
  elements.reminderCountdownText.textContent = "00:00";
  elements.reminderPurposeText.textContent = "--";
  elements.reminderEndAtText.textContent = "--:--";
  scheduleClose();
}

function renderActiveState(session) {
  clearCloseTimer();
  const remainingMs = Math.max(0, (session.allowAllUntil ?? 0) - Date.now());

  elements.reminderStatusBadge.textContent = "临时放行";
  elements.reminderStatusBadge.className = "status-badge warning";
  elements.reminderDescription.textContent = "倒计时结束后会自动恢复拦截。";
  elements.reminderCountdownText.textContent = formatCountdown(remainingMs);
  elements.reminderPurposeText.textContent = session.purpose;
  elements.reminderEndAtText.textContent = formatClockTime(session.allowAllUntil);

  if (remainingMs <= 0) {
    renderEndedState("临时放行已结束，扩展会自动恢复拦截。", "恢复中");
  }
}

function renderAppState(nextState) {
  appState = nextState;
  const session = nextState.currentSession;
  const temporaryAllowActive = Boolean(session && (session.allowAllUntil ?? 0) > Date.now());

  if (!nextState.hasActiveSession || !temporaryAllowActive) {
    renderEndedState("临时放行已结束，提醒窗口即将自动关闭。");
    return;
  }

  renderActiveState(session);
}

async function loadAppState() {
  try {
    const nextState = await sendRuntimeMessage(MESSAGE_TYPES.GET_APP_STATE);
    renderAppState(nextState);
  } catch (error) {
    renderEndedState(formatErrorLabel(error), "异常");
  }
}

elements.openDashboardButton.addEventListener("click", async () => {
  await chrome.tabs.create({ url: chrome.runtime.getURL(PAGE_PATHS.DASHBOARD) });
});

chrome.storage.onChanged.addListener(() => {
  void loadAppState();
});

await initTheme();
await loadAppState();

countdownTimer = window.setInterval(() => {
  const session = appState?.currentSession;
  const temporaryAllowActive = Boolean(session && (session.allowAllUntil ?? 0) > Date.now());

  if (!temporaryAllowActive) {
    renderEndedState("临时放行已结束，提醒窗口即将自动关闭。");
    return;
  }

  renderActiveState(session);
}, 1000);

window.addEventListener("beforeunload", () => {
  if (countdownTimer) {
    window.clearInterval(countdownTimer);
  }

  if (closeTimer) {
    window.clearTimeout(closeTimer);
  }
});
