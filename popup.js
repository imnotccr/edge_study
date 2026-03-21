import { MESSAGE_TYPES, PAGE_PATHS } from "./shared/constants.js";
import { formatErrorLabel } from "./shared/errors.js";
import { sendRuntimeMessage, openExtensionPage } from "./shared/api.js";
import { initTheme } from "./shared/theme.js";
import { formatClockTime, formatCountdown } from "./shared/time.js";

const elements = {
  popupHint: document.querySelector("#popupHint"),
  statusBadge: document.querySelector("#statusBadge"),
  purposeText: document.querySelector("#purposeText"),
  remainingText: document.querySelector("#remainingText"),
  endAtText: document.querySelector("#endAtText"),
  whitelistCountText: document.querySelector("#whitelistCountText"),
  startButton: document.querySelector("#startButton"),
  unlockButton: document.querySelector("#unlockButton"),
  optionsButton: document.querySelector("#optionsButton"),
  dashboardButton: document.querySelector("#dashboardButton"),
  debugCard: document.querySelector("#debugCard"),
  debugExitButton: document.querySelector("#debugExitButton"),
  popupMessage: document.querySelector("#popupMessage")
};

let appState = null;
let countdownTimer = null;

function setMessage(text, isError = false) {
  elements.popupMessage.textContent = text;
  elements.popupMessage.style.color = isError ? "var(--accent)" : "var(--muted)";
}

function renderCountdown() {
  const session = appState?.currentSession;

  if (!session) {
    elements.remainingText.textContent = "--:--";
    elements.endAtText.textContent = "--:--";
    return;
  }

  const remainingMs = Math.max(0, session.endAt - Date.now());
  const temporaryAllowRemainingMs = Math.max(0, (session.allowAllUntil ?? 0) - Date.now());
  elements.remainingText.textContent = formatCountdown(remainingMs);
  elements.endAtText.textContent = formatClockTime(session.endAt);

  if (temporaryAllowRemainingMs > 0) {
    elements.statusBadge.textContent = `临时放行中 · ${formatCountdown(temporaryAllowRemainingMs)}`;
    elements.statusBadge.className = "status-badge warning";
  }

  if (remainingMs <= 0) {
    void loadAppState();
  }
}

function renderAppState(nextState) {
  appState = nextState;
  const session = nextState.currentSession;
  const hasSession = Boolean(session);
  const temporaryAllowActive = hasSession && (session.allowAllUntil ?? 0) > Date.now();

  elements.whitelistCountText.textContent = String(nextState.whitelistCount);
  elements.unlockButton.disabled = !hasSession;
  elements.startButton.disabled = hasSession;
  elements.debugCard.classList.toggle(
    "hidden",
    !(nextState.developmentBuild || nextState.settings.devToolsEnabled)
  );

  if (!hasSession) {
    elements.popupHint.textContent = "当前没有进行中的专注会话。";
    elements.statusBadge.textContent = "未开始";
    elements.statusBadge.className = "status-badge";
    elements.purposeText.textContent = "暂无";
    elements.remainingText.textContent = "--:--";
    elements.endAtText.textContent = "--:--";
    return;
  }

  elements.popupHint.textContent = temporaryAllowActive
    ? "当前处于临时放行阶段，到时会自动恢复拦截。"
    : "专注进行中，非白名单网站会被拦截。";
  elements.statusBadge.textContent = temporaryAllowActive ? "临时放行中" : "专注中";
  elements.statusBadge.className = temporaryAllowActive ? "status-badge warning" : "status-badge active";
  elements.purposeText.textContent = session.purpose;
  renderCountdown();
}

async function loadAppState() {
  try {
    const nextState = await sendRuntimeMessage(MESSAGE_TYPES.GET_APP_STATE);
    renderAppState(nextState);
    setMessage("");
  } catch (error) {
    setMessage(formatErrorLabel(error), true);
  }
}

function startCountdownTimer() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
  }

  countdownTimer = setInterval(() => {
    if (appState?.currentSession) {
      renderCountdown();
    }
  }, 1000);
}

elements.startButton.addEventListener("click", async () => {
  await openExtensionPage(PAGE_PATHS.START_SESSION);
});

elements.unlockButton.addEventListener("click", async () => {
  if (!appState?.currentSession) {
    return;
  }

  await openExtensionPage(PAGE_PATHS.UNLOCK);
});

elements.optionsButton.addEventListener("click", async () => {
  await openExtensionPage(PAGE_PATHS.OPTIONS);
});

elements.dashboardButton.addEventListener("click", async () => {
  await openExtensionPage(PAGE_PATHS.DASHBOARD);
});

elements.debugExitButton.addEventListener("click", async () => {
  try {
    await sendRuntimeMessage(MESSAGE_TYPES.FORCE_DEBUG_EXIT);
    setMessage("已执行快速退出。", false);
    await loadAppState();
  } catch (error) {
    setMessage(formatErrorLabel(error), true);
  }
});

chrome.storage.onChanged.addListener(() => {
  void loadAppState();
});

await initTheme();
await loadAppState();
startCountdownTimer();
