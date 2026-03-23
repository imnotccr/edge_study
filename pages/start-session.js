import { MESSAGE_TYPES, PAGE_PATHS, QUICK_DURATION_OPTIONS, getDurationCapOption } from "../shared/constants.js";
import { reportPageError, installGlobalErrorHandlers } from "../shared/error-log.js";
import { ERROR_CODES, formatErrorLabel } from "../shared/errors.js";
import { sendRuntimeMessage } from "../shared/api.js";
import { initTheme } from "../shared/theme.js";

const elements = {
  banner: document.querySelector("#startBanner"),
  form: document.querySelector("#startForm"),
  purposeInput: document.querySelector("#purposeInput"),
  quickDurationButtons: document.querySelector("#quickDurationButtons"),
  customDurationInput: document.querySelector("#customDurationInput"),
  capHint: document.querySelector("#capHint")
};

let selectedDuration = null;
let durationCap = getDurationCapOption("720");
let isLocked = false;
const defaultCustomPlaceholder = "输入分钟数";

function showBanner(text, type = "error") {
  elements.banner.textContent = text;
  elements.banner.className = `notice ${type}`;
  elements.banner.classList.remove("hidden");
}

function syncCustomDurationState() {
  const quickDurationSelected = selectedDuration !== null;
  const shouldDisableCustomInput = isLocked || quickDurationSelected;

  elements.customDurationInput.disabled = shouldDisableCustomInput;
  elements.customDurationInput.placeholder = quickDurationSelected
    ? "已选择快捷时长，再点一次可改用自定义"
    : defaultCustomPlaceholder;
}

function renderDurationButtons() {
  elements.quickDurationButtons.innerHTML = "";

  for (const minutes of QUICK_DURATION_OPTIONS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `chip${selectedDuration === minutes ? " selected" : ""}`;
    button.textContent = `${minutes} 分钟`;
    button.dataset.minutes = String(minutes);
    button.disabled = isLocked;
    button.addEventListener("click", () => {
      selectedDuration = selectedDuration === minutes ? null : minutes;

      if (selectedDuration !== null) {
        elements.customDurationInput.value = "";
      }

      syncCustomDurationState();
      renderDurationButtons();
    });
    elements.quickDurationButtons.appendChild(button);
  }
}

function getCurrentDuration() {
  if (selectedDuration) {
    return selectedDuration;
  }

  const customValue = Number(elements.customDurationInput.value);
  return Number.isInteger(customValue) ? customValue : 0;
}

async function loadState() {
  const appState = await sendRuntimeMessage(MESSAGE_TYPES.GET_APP_STATE);
  isLocked = appState.hasActiveSession;
  durationCap = getDurationCapOption(appState.settings.customDurationCapOption);
  elements.capHint.textContent = `当前自定义时长上限：${durationCap.maxMinutes} 分钟。`;
  elements.customDurationInput.max = String(durationCap.maxMinutes);
  renderDurationButtons();
  syncCustomDurationState();

  if (isLocked) {
    elements.purposeInput.disabled = true;
    showBanner(formatErrorLabel({ code: ERROR_CODES.FOCUS_ACTIVE_SESSION_EXISTS, message: "当前已有进行中的专注会话，暂时不能再次开始。" }), "error");
  }
}

elements.customDurationInput.addEventListener("input", () => {
  selectedDuration = null;
  syncCustomDurationState();
  renderDurationButtons();
});

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (isLocked) {
    const error = { code: ERROR_CODES.FOCUS_ACTIVE_SESSION_EXISTS, message: "当前已有进行中的专注会话。" };
    void reportPageError(error, "pages/start-session:submit", { kind: "validation" });
    showBanner(formatErrorLabel(error), "error");
    return;
  }

  const purpose = elements.purposeInput.value.trim();
  const durationMinutes = getCurrentDuration();

  if (!purpose) {
    const error = { code: ERROR_CODES.SESSION_PURPOSE_REQUIRED, message: "请先填写学习目的。" };
    void reportPageError(error, "pages/start-session:submit", { kind: "validation" });
    showBanner(formatErrorLabel(error), "error");
    return;
  }

  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
    const error = { code: ERROR_CODES.SESSION_DURATION_INVALID, message: "请先选择快捷时长，或输入有效的自定义时长。" };
    void reportPageError(error, "pages/start-session:submit", { kind: "validation" });
    showBanner(formatErrorLabel(error), "error");
    return;
  }

  if (durationMinutes > durationCap.maxMinutes) {
    const error = {
      code: ERROR_CODES.SESSION_DURATION_EXCEEDS_CAP,
      message: `当前时长上限为 ${durationCap.maxMinutes} 分钟。`
    };
    void reportPageError(error, "pages/start-session:submit", {
      kind: "validation",
      maxMinutes: durationCap.maxMinutes
    });
    showBanner(formatErrorLabel(error), "error");
    return;
  }

  try {
    await sendRuntimeMessage(MESSAGE_TYPES.START_SESSION, {
      purpose,
      durationMinutes
    });
    showBanner("专注会话已开始，正在跳转到数据汇总页。", "success");
    window.setTimeout(() => {
      window.location.href = chrome.runtime.getURL(PAGE_PATHS.DASHBOARD);
    }, 700);
  } catch (error) {
    showBanner(formatErrorLabel(error), "error");
  }
});

installGlobalErrorHandlers("pages/start-session");
await initTheme();
try {
  await loadState();
} catch (error) {
  showBanner(formatErrorLabel(error), "error");
}
