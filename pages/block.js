import { MESSAGE_TYPES, PAGE_PATHS } from "../shared/constants.js";
import { sendRuntimeMessage } from "../shared/api.js";
import { initTheme } from "../shared/theme.js";
import { formatClockTime, formatCountdown } from "../shared/time.js";

const elements = {
  blockDescription: document.querySelector("#blockDescription"),
  blockedDomainText: document.querySelector("#blockedDomainText"),
  blockPurposeText: document.querySelector("#blockPurposeText"),
  blockRemainingText: document.querySelector("#blockRemainingText"),
  blockEndAtText: document.querySelector("#blockEndAtText"),
  backToOptionsButton: document.querySelector("#backToOptionsButton"),
  unlockFromBlockButton: document.querySelector("#unlockFromBlockButton")
};

let currentSession = null;
let timerId = null;

function renderCountdown() {
  if (!currentSession) {
    elements.blockRemainingText.textContent = "--:--";
    elements.blockEndAtText.textContent = "--:--";
    return;
  }

  const remainingMs = Math.max(0, currentSession.endAt - Date.now());
  elements.blockRemainingText.textContent = formatCountdown(remainingMs);
  elements.blockEndAtText.textContent = formatClockTime(currentSession.endAt);

  if (remainingMs <= 0) {
    void loadContext();
  }
}

async function loadContext() {
  const context = await sendRuntimeMessage(MESSAGE_TYPES.GET_BLOCK_CONTEXT);
  currentSession = context.currentSession;

  if (!context.hasActiveSession || !context.currentSession) {
    elements.blockDescription.textContent = "当前没有进行中的专注会话，拦截状态应该已结束。";
    elements.blockedDomainText.textContent = "--";
    elements.blockPurposeText.textContent = "--";
    renderCountdown();
    return;
  }

  elements.blockedDomainText.textContent = context.blockedInfo?.domain ?? "未知站点";
  elements.blockPurposeText.textContent = context.currentSession.purpose;
  renderCountdown();
}

elements.backToOptionsButton.addEventListener("click", () => {
  window.location.href = chrome.runtime.getURL(PAGE_PATHS.OPTIONS);
});

elements.unlockFromBlockButton.addEventListener("click", () => {
  window.location.href = chrome.runtime.getURL(PAGE_PATHS.UNLOCK);
});

await initTheme();
await loadContext();

timerId = setInterval(() => {
  if (currentSession) {
    renderCountdown();
  }
}, 1000);

window.addEventListener("beforeunload", () => {
  if (timerId) {
    clearInterval(timerId);
  }
});
