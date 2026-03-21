import { SESSION_STATUS, TEMP_ALLOW_MINUTES, UNLOCK_QUESTION_COUNT } from "../shared/constants.js";
import { AppError, ERROR_CODES } from "../shared/errors.js";
import { readState, replaceState } from "../shared/storage.js";
import { recordUnlockAttempt } from "./stats-manager.js";
import { applyTemporaryAllow, endSession, isSessionActive } from "./session-manager.js";

function createQuestion() {
  const left = Math.floor(Math.random() * 90) + 10;
  const right = Math.floor(Math.random() * 90) + 10;
  return {
    id: crypto.randomUUID(),
    left,
    right,
    prompt: `${left} × ${right}`,
    answer: left * right
  };
}

function buildChallenge() {
  const questions = Array.from({ length: UNLOCK_QUESTION_COUNT }, () => createQuestion());

  return {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    questions
  };
}

function serializeQuestions(challenge) {
  return challenge.questions.map((question) => ({
    id: question.id,
    prompt: question.prompt
  }));
}

function getCooldownRemainingMs(unlockState) {
  return Math.max(0, (unlockState?.cooldownUntil ?? 0) - Date.now());
}

export async function getUnlockContext() {
  const state = await readState();
  const session = state.currentSession;

  if (!isSessionActive(session)) {
    return {
      hasActiveSession: false
    };
  }

  const unlockState = session.unlockState ?? {};
  const cooldownRemainingMs = getCooldownRemainingMs(unlockState);

  if (unlockState.pendingResult) {
    return {
      hasActiveSession: true,
      stage: "choice",
      currentSession: session,
      cooldownRemainingMs: 0
    };
  }

  if (cooldownRemainingMs > 0) {
    return {
      hasActiveSession: true,
      stage: "cooldown",
      currentSession: session,
      cooldownRemainingMs,
      code: ERROR_CODES.UNLOCK_COOLDOWN_ACTIVE
    };
  }

  if (!unlockState.pendingChallenge) {
    state.currentSession.unlockState.pendingChallenge = buildChallenge();
    await replaceState(state);
  }

  return {
    hasActiveSession: true,
    stage: "challenge",
    currentSession: state.currentSession,
    cooldownRemainingMs: 0,
    questions: serializeQuestions(state.currentSession.unlockState.pendingChallenge)
  };
}

export async function submitUnlockAnswers({ reason, answers }) {
  const state = await readState();
  const session = state.currentSession;

  if (!isSessionActive(session)) {
    throw new AppError(ERROR_CODES.FOCUS_NO_ACTIVE_SESSION, "当前没有进行中的专注会话。");
  }

  const cleanReason = reason.trim();

  if (!cleanReason) {
    throw new AppError(ERROR_CODES.UNLOCK_REASON_REQUIRED, "请先填写解锁原因。");
  }

  const unlockState = session.unlockState ?? {};
  const cooldownRemainingMs = getCooldownRemainingMs(unlockState);

  if (cooldownRemainingMs > 0) {
    return {
      passed: false,
      code: ERROR_CODES.UNLOCK_COOLDOWN_ACTIVE,
      score: 0,
      cooldownRemainingMs,
      message: "当前仍处于冷却时间内。"
    };
  }

  const challenge = unlockState.pendingChallenge;

  if (!challenge) {
    throw new AppError(ERROR_CODES.UNLOCK_CHALLENGE_MISSING, "当前没有可用的解锁题目，请刷新后重试。");
  }

  const normalizedAnswers = answers.map((answer) => Number(answer));
  const score = challenge.questions.reduce((sum, question, index) => {
    return sum + (normalizedAnswers[index] === question.answer ? 1 : 0);
  }, 0);

  if (score === challenge.questions.length) {
    state.currentSession.unlockState.pendingResult = {
      challengeId: challenge.id,
      reason: cleanReason,
      questionSet: challenge.questions.map((question) => ({
        prompt: question.prompt,
        answer: question.answer
      })),
      answers: normalizedAnswers,
      score
    };
    state.currentSession.unlockState.pendingChallenge = null;
    state.currentSession.unlockState.cooldownUntil = null;
    state.currentSession.updatedAt = Date.now();

    await replaceState(state);

    return {
      passed: true,
      score,
      message: "全部答对，可以选择解锁方式。"
    };
  }

  state.currentSession.unlockState.failedCount = (state.currentSession.unlockState.failedCount ?? 0) + 1;
  state.currentSession.unlockState.pendingChallenge = null;

  if (state.settings.unlockCooldownEnabled) {
    state.currentSession.unlockState.cooldownUntil =
      Date.now() + Number(state.settings.unlockCooldownMinutes) * 60 * 1000;
  } else {
    state.currentSession.unlockState.cooldownUntil = null;
  }

  state.currentSession.updatedAt = Date.now();
  await replaceState(state);

  await recordUnlockAttempt({
    sessionId: session.id,
    reason: cleanReason,
    questionSet: challenge.questions.map((question) => ({ prompt: question.prompt, answer: question.answer })),
    answers: normalizedAnswers,
    score,
    result: "failed",
    cooldownUntil: state.currentSession.unlockState.cooldownUntil
  });

  return {
    passed: false,
    code: ERROR_CODES.UNLOCK_ANSWERS_INCORRECT,
    score,
    cooldownRemainingMs: getCooldownRemainingMs(state.currentSession.unlockState),
    message: "答题未全部正确。"
  };
}

export async function applyUnlockResult(result) {
  const state = await readState();
  const session = state.currentSession;

  if (!isSessionActive(session)) {
    throw new AppError(ERROR_CODES.FOCUS_NO_ACTIVE_SESSION, "当前没有进行中的专注会话。");
  }

  const pendingResult = session.unlockState?.pendingResult;

  if (!pendingResult) {
    throw new AppError(ERROR_CODES.UNLOCK_PENDING_RESULT_MISSING, "当前没有待确认的解锁结果。");
  }

  state.currentSession.unlockState.pendingResult = null;
  state.currentSession.updatedAt = Date.now();
  await replaceState(state);

  if (result === "temporary_allow") {
    await recordUnlockAttempt({
      sessionId: session.id,
      reason: pendingResult.reason,
      questionSet: pendingResult.questionSet,
      answers: pendingResult.answers,
      score: pendingResult.score,
      result,
      allowMinutes: TEMP_ALLOW_MINUTES
    });
    await applyTemporaryAllow();

    return {
      result,
      message: `已临时放行全部网站 ${TEMP_ALLOW_MINUTES} 分钟。`
    };
  }

  if (result === "end_session") {
    await recordUnlockAttempt({
      sessionId: session.id,
      reason: pendingResult.reason,
      questionSet: pendingResult.questionSet,
      answers: pendingResult.answers,
      score: pendingResult.score,
      result
    });
    await endSession(SESSION_STATUS.UNLOCKED);

    return {
      result,
      message: "当前专注会话已结束。"
    };
  }

  throw new AppError(ERROR_CODES.UNLOCK_RESULT_UNSUPPORTED, "不支持的解锁结果。", { result });
}
