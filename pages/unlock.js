import { MESSAGE_TYPES, PAGE_PATHS } from "../shared/constants.js";
import { reportPageError, installGlobalErrorHandlers } from "../shared/error-log.js";
import { ERROR_CODES, formatErrorLabel } from "../shared/errors.js";
import { sendRuntimeMessage } from "../shared/api.js";
import { initTheme } from "../shared/theme.js";
import { formatCountdown } from "../shared/time.js";

const elements = {
  notice: document.querySelector("#unlockNotice"),
  unlockSessionCard: document.querySelector("#unlockSessionCard"),
  unlockPurposeText: document.querySelector("#unlockPurposeText"),
  unlockRemainingText: document.querySelector("#unlockRemainingText"),
  unlockChallengeCard: document.querySelector("#unlockChallengeCard"),
  unlockReasonInput: document.querySelector("#unlockReasonInput"),
  questionList: document.querySelector("#questionList"),
  submitUnlockButton: document.querySelector("#submitUnlockButton"),
  unlockCooldownCard: document.querySelector("#unlockCooldownCard"),
  cooldownRemainingText: document.querySelector("#cooldownRemainingText"),
  unlockChoiceCard: document.querySelector("#unlockChoiceCard"),
  temporaryAllowButton: document.querySelector("#temporaryAllowButton"),
  endSessionButton: document.querySelector("#endSessionButton")
};

let unlockContext = null;
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
      <input class="input" data-answer-index="${index}" type="number" step="1" placeholder="答案" style="max-width: 150px;" />
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

function renderStage() {
  const stage = unlockContext?.stage;
  const hasActiveSession = unlockContext?.hasActiveSession;

  elements.unlockChallengeCard.classList.toggle("hidden", stage !== "challenge");
  elements.unlockCooldownCard.classList.toggle("hidden", stage !== "cooldown");
  elements.unlockChoiceCard.classList.toggle("hidden", stage !== "choice");

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

async function loadContext() {
  unlockContext = await sendRuntimeMessage(MESSAGE_TYPES.GET_UNLOCK_CONTEXT);
  renderSessionInfo();
  renderStage();
}

async function submitAnswers() {
  const reason = elements.unlockReasonInput.value.trim();
  const answers = Array.from(elements.questionList.querySelectorAll("[data-answer-index]"))
    .sort((left, right) => Number(left.dataset.answerIndex) - Number(right.dataset.answerIndex))
    .map((input) => input.value.trim());

  if (!reason) {
    const error = { code: ERROR_CODES.UNLOCK_REASON_REQUIRED, message: "请先填写解锁原因。" };
    void reportPageError(error, "pages/unlock:submit", { kind: "validation" });
    showNotice(formatErrorLabel(error), "error");
    return;
  }

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
    showNotice(response.message, "success");
    window.setTimeout(() => {
      window.location.href = chrome.runtime.getURL(PAGE_PATHS.DASHBOARD);
    }, 800);
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
