import { MESSAGE_TYPES, PAGE_PATHS } from "../shared/constants.js";
import { reportPageError, installGlobalErrorHandlers } from "../shared/error-log.js";
import { ERROR_CODES, formatErrorLabel } from "../shared/errors.js";
import { sendRuntimeMessage } from "../shared/api.js";
import { initTheme } from "../shared/theme.js";
import { formatCountdown } from "../shared/time.js";

const RESULT_LABELS = {
  temporary_allow: "临时放行 10 分钟",
  end_session: "结束本次专注"
};

const elements = {
  notice: document.querySelector("#unlockNotice"),
  unlockSessionCard: document.querySelector("#unlockSessionCard"),
  unlockPurposeText: document.querySelector("#unlockPurposeText"),
  unlockRemainingText: document.querySelector("#unlockRemainingText"),
  unlockChallengeCard: document.querySelector("#unlockChallengeCard"),
  unlockReasonInput: document.querySelector("#unlockReasonInput"),
  unlockReasonField: document.querySelector("#unlockReasonInput")?.closest(".field"),
  questionList: document.querySelector("#questionList"),
  submitUnlockButton: document.querySelector("#submitUnlockButton"),
  unlockCooldownCard: document.querySelector("#unlockCooldownCard"),
  cooldownRemainingText: document.querySelector("#cooldownRemainingText"),
  unlockChoiceCard: document.querySelector("#unlockChoiceCard"),
  temporaryAllowButton: document.querySelector("#temporaryAllowButton"),
  endSessionButton: document.querySelector("#endSessionButton"),
  unlockSuccessCard: document.querySelector("#unlockSuccessCard"),
  unlockSuccessDescription: document.querySelector("#unlockSuccessDescription"),
  unlockResultTypeText: document.querySelector("#unlockResultTypeText"),
  unlockRelatedPageText: document.querySelector("#unlockRelatedPageText"),
  returnToRelatedPageButton: document.querySelector("#returnToRelatedPageButton"),
  goToDashboardButton: document.querySelector("#goToDashboardButton")
};

let unlockContext = null;
let blockContext = null;
let successState = null;
let sessionTimer = null;
let cooldownTimer = null;

function showNotice(text, type = "error") {
  elements.notice.textContent = text;
  elements.notice.className = `notice ${type}`;
  elements.notice.classList.remove("hidden");
}

function clearNotice() {
  elements.notice.className = "notice hidden";
  elements.notice.textContent = "";
}

function clearReasonValidationFeedback() {
  elements.unlockReasonField?.classList.remove("shake-warning");
  elements.unlockReasonInput?.classList.remove("invalid");
  elements.unlockReasonInput?.removeAttribute("aria-invalid");
}

function triggerReasonValidationFeedback() {
  clearReasonValidationFeedback();

  if (!elements.unlockReasonField || !elements.unlockReasonInput) {
    return;
  }

  void elements.unlockReasonField.offsetWidth;
  elements.unlockReasonField.classList.add("shake-warning");
  elements.unlockReasonInput.classList.add("invalid");
  elements.unlockReasonInput.setAttribute("aria-invalid", "true");
  elements.unlockReasonInput.focus({ preventScroll: true });
}
function getRelatedPageLabel(url) {
  if (!url) {
    return "当前没有可返回的原始页面";
  }

  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function renderQuestionList(questions) {
  elements.questionList.innerHTML = "";

  for (const [index, question] of questions.entries()) {
    const item = document.createElement("div");
    item.className = "list-item";
    item.innerHTML = `
      <div>
        <div class="title">第 ${index + 1} 题 · ${question.prompt}</div>
        <div class="subtitle">请输入准确答案后一次性提交。</div>
      </div>
      <input class="input unlock-answer-input" data-answer-index="${index}" type="text" inputmode="numeric" autocomplete="off" placeholder="答案" style="max-width: 150px;" />
    `;
    elements.questionList.appendChild(item);
  }
}

function renderSessionInfo() {
  const session = unlockContext?.currentSession;

  if (!session) {
    elements.unlockPurposeText.textContent = "--";
    elements.unlockRemainingText.textContent = "--:--";
    return;
  }

  elements.unlockPurposeText.textContent = session.purpose;
  elements.unlockRemainingText.textContent = formatCountdown(Math.max(0, session.endAt - Date.now()));
}

function renderSuccessState() {
  const visible = Boolean(successState);
  elements.unlockSuccessCard.classList.toggle("hidden", !visible);

  if (!visible) {
    return;
  }

  elements.unlockSuccessDescription.textContent = successState.message;
  elements.unlockResultTypeText.textContent = successState.typeLabel;
  elements.unlockRelatedPageText.textContent = successState.relatedPageLabel;
  elements.returnToRelatedPageButton.classList.toggle("hidden", !successState.relatedUrl);
}

function renderStage() {
  const stage = unlockContext?.stage;
  const hasActiveSession = unlockContext?.hasActiveSession;
  const showingSuccess = Boolean(successState);

  elements.unlockChallengeCard.classList.toggle("hidden", showingSuccess || stage !== "challenge");
  elements.unlockCooldownCard.classList.toggle("hidden", showingSuccess || stage !== "cooldown");
  elements.unlockChoiceCard.classList.toggle("hidden", showingSuccess || stage !== "choice");
  renderSuccessState();

  if (showingSuccess) {
    return;
  }

  if (stage === "temporary-allow") {
    clearNotice();
    showNotice(
      formatErrorLabel({
        code: unlockContext.code ?? ERROR_CODES.UNLOCK_TEMP_ALLOW_ACTIVE,
        message: unlockContext.message ?? "当前已处于临时放行阶段，倒计时结束前不可再次应急解锁。"
      }),
      "error"
    );
    return;
  }

  if (!hasActiveSession) {
    showNotice(formatErrorLabel({ code: ERROR_CODES.FOCUS_NO_ACTIVE_SESSION, message: "当前没有进行中的专注会话。" }), "error");
    elements.unlockChallengeCard.classList.add("hidden");
    elements.unlockCooldownCard.classList.add("hidden");
    elements.unlockChoiceCard.classList.add("hidden");
    return;
  }

  clearNotice();

  if (stage === "challenge") {
    renderQuestionList(unlockContext.questions ?? []);
  }

  if (stage === "cooldown") {
    elements.cooldownRemainingText.textContent = formatCountdown(unlockContext.cooldownRemainingMs);
    showNotice(
      formatErrorLabel({ code: unlockContext.code ?? ERROR_CODES.UNLOCK_COOLDOWN_ACTIVE, message: "当前仍处于冷却时间内。" }),
      "error"
    );
  }
}

elements.unlockReasonInput?.addEventListener("input", () => {
  if (elements.unlockReasonInput.value.trim()) {
    clearReasonValidationFeedback();
  }
});

elements.questionList.addEventListener("input", (event) => {
  if (!(event.target instanceof HTMLInputElement) || !event.target.matches("[data-answer-index]")) {
    return;
  }

  event.target.value = event.target.value.replace(/\D+/g, "");
});
async function loadContext() {
  const [nextUnlockContext, nextBlockContext] = await Promise.all([
    sendRuntimeMessage(MESSAGE_TYPES.GET_UNLOCK_CONTEXT),
    sendRuntimeMessage(MESSAGE_TYPES.GET_BLOCK_CONTEXT)
  ]);

  unlockContext = nextUnlockContext;
  blockContext = nextBlockContext;
  renderSessionInfo();
  renderStage();
}

async function submitAnswers() {
  const reason = elements.unlockReasonInput.value.trim();
  const answers = Array.from(elements.questionList.querySelectorAll("[data-answer-index]"))
    .sort((left, right) => Number(left.dataset.answerIndex) - Number(right.dataset.answerIndex))
    .map((input) => input.value.trim());

  if (!reason) {
    triggerReasonValidationFeedback();
    const error = { code: ERROR_CODES.UNLOCK_REASON_REQUIRED, message: "请先填写解锁原因。" };
    void reportPageError(error, "pages/unlock:submit", { kind: "validation" });
    showNotice(formatErrorLabel(error), "error");
    return;
  }

  clearReasonValidationFeedback();

  if (answers.some((answer) => answer === "")) {
    const error = { code: ERROR_CODES.UNLOCK_ANSWERS_INCOMPLETE, message: "请完整填写 5 道题的答案。" };
    void reportPageError(error, "pages/unlock:submit", { kind: "validation" });
    showNotice(formatErrorLabel(error), "error");
    return;
  }

  try {
    const result = await sendRuntimeMessage(MESSAGE_TYPES.SUBMIT_UNLOCK_ANSWERS, {
      reason,
      answers
    });

    if (result.passed) {
      showNotice(result.message, "success");
    } else {
      showNotice(formatErrorLabel(result), "error");
    }

    await loadContext();
  } catch (error) {
    showNotice(formatErrorLabel(error), "error");
  }
}

async function applyResult(result) {
  try {
    const response = await sendRuntimeMessage(MESSAGE_TYPES.APPLY_UNLOCK_RESULT, { result });
    const relatedUrl = blockContext?.blockedInfo?.url ?? null;

    successState = {
      result,
      typeLabel: RESULT_LABELS[result] ?? result,
      message: response.message,
      relatedUrl,
      relatedPageLabel: getRelatedPageLabel(relatedUrl)
    };

    if (result === "end_session") {
      unlockContext = {
        hasActiveSession: false,
        currentSession: null,
        stage: null
      };
    } else if (unlockContext) {
      unlockContext = {
        ...unlockContext,
        stage: null
      };
    }

    renderSessionInfo();
    renderStage();
    showNotice(response.message, "success");
  } catch (error) {
    showNotice(formatErrorLabel(error), "error");
  }
}

elements.submitUnlockButton.addEventListener("click", submitAnswers);

elements.temporaryAllowButton.addEventListener("click", () => {
  void applyResult("temporary_allow");
});

elements.endSessionButton.addEventListener("click", () => {
  void applyResult("end_session");
});

elements.returnToRelatedPageButton.addEventListener("click", () => {
  if (successState?.relatedUrl) {
    window.location.href = successState.relatedUrl;
    return;
  }

  window.location.href = chrome.runtime.getURL(PAGE_PATHS.DASHBOARD);
});

elements.goToDashboardButton.addEventListener("click", () => {
  window.location.href = chrome.runtime.getURL(PAGE_PATHS.DASHBOARD);
});

installGlobalErrorHandlers("pages/unlock");
await initTheme();
try {
  await loadContext();
} catch (error) {
  showNotice(formatErrorLabel(error), "error");
}

sessionTimer = setInterval(() => {
  renderSessionInfo();
}, 1000);

cooldownTimer = setInterval(() => {
  if (unlockContext?.stage !== "cooldown") {
    return;
  }

  unlockContext.cooldownRemainingMs = Math.max(0, unlockContext.cooldownRemainingMs - 1000);
  elements.cooldownRemainingText.textContent = formatCountdown(unlockContext.cooldownRemainingMs);

  if (unlockContext.cooldownRemainingMs <= 0) {
    void loadContext();
  }
}, 1000);

window.addEventListener("beforeunload", () => {
  if (sessionTimer) {
    clearInterval(sessionTimer);
  }

  if (cooldownTimer) {
    clearInterval(cooldownTimer);
  }
});

