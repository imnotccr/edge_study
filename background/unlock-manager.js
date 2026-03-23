import { SESSION_STATUS, TEMP_ALLOW_MINUTES, UNLOCK_QUESTION_COUNT } from "../shared/constants.js";
import { AppError, ERROR_CODES } from "../shared/errors.js";
import { readState, updateState } from "../shared/storage.js";
import { recordUnlockAttempt } from "./stats-manager.js";
import { applyTemporaryAllow, endSession, isSessionActive, isTemporaryAllowActive } from "./session-manager.js";

function createDefaultUnlockState() {
  return {
    failedCount: 0,
    cooldownUntil: null,
    pendingChallenge: null,
    pendingResult: null
  };
}

function ensureUnlockState(session) {
  session.unlockState = {
    ...createDefaultUnlockState(),
    ...(session.unlockState ?? {})
  };

  return session.unlockState;
}

function formatQuestionPrompt(question) {
  if (Number.isInteger(question?.left) && Number.isInteger(question?.right)) {
    return `${question.left} x ${question.right}`;
  }

  return question?.prompt ?? "";
}

function createQuestion() {
  const left = Math.floor(Math.random() * 90) + 10;
  const right = Math.floor(Math.random() * 90) + 10;
  return {
    id: crypto.randomUUID(),
    left,
    right,
    prompt: `${left} x ${right}`,
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
    prompt: formatQuestionPrompt(question)
  }));
}

function getCooldownRemainingMs(unlockState) {
  return Math.max(0, (unlockState?.cooldownUntil ?? 0) - Date.now());
}

function buildTemporaryAllowLockedContext(session) {
  return {
    hasActiveSession: true,
    stage: "temporary-allow",
    currentSession: session,
    cooldownRemainingMs: 0,
    temporaryAllowRemainingMs: Math.max(0, (session.allowAllUntil ?? 0) - Date.now()),
    code: ERROR_CODES.UNLOCK_TEMP_ALLOW_ACTIVE,
    message: "当前已处于临时放行阶段，倒计时结束前不可再次应急解锁。"
  };
}

async function safeRecordUnlockAttempt(record) {
  try {
    await recordUnlockAttempt(record);
  } catch (error) {
    console.warn("unlock attempt log failed", error);
  }
}

export async function getUnlockContext() {
  const state = await updateState((draftState) => {
    if (!isSessionActive(draftState.currentSession) || isTemporaryAllowActive(draftState.currentSession)) {
      return draftState;
    }

    const unlockState = ensureUnlockState(draftState.currentSession);
    const cooldownRemainingMs = getCooldownRemainingMs(unlockState);

    if (!unlockState.pendingResult && cooldownRemainingMs <= 0 && !unlockState.pendingChallenge) {
      unlockState.pendingChallenge = buildChallenge();
      draftState.currentSession.updatedAt = Date.now();
    }
  });
  const session = state.currentSession;

  if (!isSessionActive(session)) {
    return {
      hasActiveSession: false
    };
  }

  if (isTemporaryAllowActive(session)) {
    return buildTemporaryAllowLockedContext(session);
  }

  const unlockState = ensureUnlockState(session);
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

  return {
    hasActiveSession: true,
    stage: "challenge",
    currentSession: session,
    cooldownRemainingMs: 0,
    questions: serializeQuestions(unlockState.pendingChallenge)
  };
}

export async function submitUnlockAnswers({ reason, answers }) {
  const cleanReason = (reason ?? "").trim();

  if (!cleanReason) {
    throw new AppError(ERROR_CODES.UNLOCK_REASON_REQUIRED, "请先填写解锁原因。");
  }

  const normalizedAnswers = (Array.isArray(answers) ? answers : []).map((answer) => Number(answer));
  let response = null;
  let attemptRecord = null;

  await updateState((state) => {
    const session = state.currentSession;

    if (!isSessionActive(session)) {
      throw new AppError(ERROR_CODES.FOCUS_NO_ACTIVE_SESSION, "当前没有进行中的专注会话。");
    }

    if (isTemporaryAllowActive(session)) {
      response = {
        passed: false,
        code: ERROR_CODES.UNLOCK_TEMP_ALLOW_ACTIVE,
        score: 0,
        temporaryAllowRemainingMs: Math.max(0, (session.allowAllUntil ?? 0) - Date.now()),
        message: "当前已处于临时放行阶段，倒计时结束前不可再次应急解锁。"
      };
      return state;
    }

    const unlockState = ensureUnlockState(session);
    const cooldownRemainingMs = getCooldownRemainingMs(unlockState);

    if (cooldownRemainingMs > 0) {
      response = {
        passed: false,
        code: ERROR_CODES.UNLOCK_COOLDOWN_ACTIVE,
        score: 0,
        cooldownRemainingMs,
        message: "当前仍处于冷却时间内。"
      };
      return state;
    }

    const challenge = unlockState.pendingChallenge;

    if (!challenge) {
      throw new AppError(ERROR_CODES.UNLOCK_CHALLENGE_MISSING, "当前没有可用的解锁题目，请刷新后重试。");
    }

    const score = challenge.questions.reduce((sum, question, index) => {
      return sum + (normalizedAnswers[index] === question.answer ? 1 : 0);
    }, 0);

    if (score === challenge.questions.length) {
      unlockState.pendingResult = {
        challengeId: challenge.id,
        reason: cleanReason,
        questionSet: challenge.questions.map((question) => ({
          prompt: formatQuestionPrompt(question),
          answer: question.answer
        })),
        answers: normalizedAnswers,
        score
      };
      unlockState.pendingChallenge = null;
      unlockState.cooldownUntil = null;
      session.updatedAt = Date.now();
      response = {
        passed: true,
        score,
        message: "全部答对，可以选择解锁方式。"
      };
      return state;
    }

    unlockState.failedCount = (unlockState.failedCount ?? 0) + 1;
    unlockState.pendingChallenge = null;

    if (state.settings.unlockCooldownEnabled) {
      unlockState.cooldownUntil = Date.now() + Number(state.settings.unlockCooldownMinutes) * 60 * 1000;
    } else {
      unlockState.cooldownUntil = null;
    }

    session.updatedAt = Date.now();
    attemptRecord = {
      sessionId: session.id,
      reason: cleanReason,
      questionSet: challenge.questions.map((question) => ({ prompt: formatQuestionPrompt(question), answer: question.answer })),
      answers: normalizedAnswers,
      score,
      result: "failed",
      cooldownUntil: unlockState.cooldownUntil
    };
    response = {
      passed: false,
      code: ERROR_CODES.UNLOCK_ANSWERS_INCORRECT,
      score,
      cooldownRemainingMs: getCooldownRemainingMs(unlockState),
      message: "答题未全部正确。"
    };
  });

  if (attemptRecord) {
    await safeRecordUnlockAttempt(attemptRecord);
  }

  return response;
}

export async function applyUnlockResult(result) {
  if (!["temporary_allow", "end_session"].includes(result)) {
    throw new AppError(ERROR_CODES.UNLOCK_RESULT_UNSUPPORTED, "不支持的解锁结果。", { result });
  }

  const state = await readState();
  const session = state.currentSession;

  if (!isSessionActive(session)) {
    throw new AppError(ERROR_CODES.FOCUS_NO_ACTIVE_SESSION, "当前没有进行中的专注会话。");
  }

  if (isTemporaryAllowActive(session)) {
    throw new AppError(ERROR_CODES.UNLOCK_TEMP_ALLOW_ACTIVE, "当前已处于临时放行阶段，倒计时结束前不可再次应急解锁。");
  }

  const pendingResult = ensureUnlockState(session).pendingResult;

  if (!pendingResult) {
    throw new AppError(ERROR_CODES.UNLOCK_PENDING_RESULT_MISSING, "当前没有待确认的解锁结果。");
  }

  if (result === "temporary_allow") {
    await applyTemporaryAllow({ clearPendingResult: true });
    await safeRecordUnlockAttempt({
      sessionId: session.id,
      reason: pendingResult.reason,
      questionSet: pendingResult.questionSet,
      answers: pendingResult.answers,
      score: pendingResult.score,
      result,
      allowMinutes: TEMP_ALLOW_MINUTES
    });

    return {
      result,
      message: `已临时放行全部网站 ${TEMP_ALLOW_MINUTES} 分钟。`
    };
  }

  const archivedSession = await endSession(SESSION_STATUS.UNLOCKED);

  if (!archivedSession) {
    throw new AppError(ERROR_CODES.FOCUS_NO_ACTIVE_SESSION, "当前没有进行中的专注会话。");
  }

  await safeRecordUnlockAttempt({
    sessionId: session.id,
    reason: pendingResult.reason,
    questionSet: pendingResult.questionSet,
    answers: pendingResult.answers,
    score: pendingResult.score,
    result
  });

  return {
    result,
    message: "当前专注会话已结束。"
  };
}

