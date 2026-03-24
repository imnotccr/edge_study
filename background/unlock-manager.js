import {
  SESSION_STATUS,
  STORAGE_KEYS,
  TEMP_ALLOW_MINUTES,
  UNLOCK_QUESTION_COUNT,
  UNLOCK_QUESTION_HISTORY_RETENTION_DAYS
} from "../shared/constants.js";
import { AppError, ERROR_CODES } from "../shared/errors.js";
import { clearUnlockChallenge, readUnlockChallenge, writeUnlockChallenge } from "../shared/session-secrets.js";
import { readState, updateState } from "../shared/storage.js";
import { recordUnlockAttempt } from "./stats-manager.js";
import { applyTemporaryAllow, endSession, isSessionActive, isTemporaryAllowActive } from "./session-manager.js";

const UNLOCK_QUESTION_MIN_OPERAND = 10;
const UNLOCK_QUESTION_MAX_OPERAND = 99;
const UNLOCK_QUESTION_HISTORY_RETENTION_MS = UNLOCK_QUESTION_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000;

function createDefaultUnlockState() {
  return {
    failedCount: 0,
    cooldownUntil: null,
    pendingChallengeId: null,
    pendingResultAvailable: false
  };
}

function ensureUnlockState(session) {
  session.unlockState = {
    ...createDefaultUnlockState(),
    failedCount: Number.isInteger(session.unlockState?.failedCount) && session.unlockState.failedCount > 0
      ? session.unlockState.failedCount
      : 0,
    cooldownUntil: typeof session.unlockState?.cooldownUntil === "number"
      ? session.unlockState.cooldownUntil
      : null,
    pendingChallengeId: typeof session.unlockState?.pendingChallengeId === "string"
      ? session.unlockState.pendingChallengeId
      : null,
    pendingResultAvailable: Boolean(session.unlockState?.pendingResultAvailable)
  };

  return session.unlockState;
}

function formatQuestionPrompt(question) {
  if (Number.isInteger(question?.left) && Number.isInteger(question?.right)) {
    return `${question.left} x ${question.right}`;
  }

  return question?.prompt ?? "";
}

function createQuestionKey(left, right) {
  return `${Math.min(left, right)}x${Math.max(left, right)}`;
}

function createQuestion(left, right) {
  const shouldSwapOperands = left !== right && Math.random() >= 0.5;
  const displayLeft = shouldSwapOperands ? right : left;
  const displayRight = shouldSwapOperands ? left : right;

  return {
    id: crypto.randomUUID(),
    key: createQuestionKey(left, right),
    left: displayLeft,
    right: displayRight,
    prompt: `${displayLeft} x ${displayRight}`,
    answer: left * right
  };
}

function getQuestionHistoryCutoff(now = Date.now()) {
  return now - UNLOCK_QUESTION_HISTORY_RETENTION_MS;
}

function pruneQuestionHistoryEntries(questionHistory, now = Date.now()) {
  const cutoff = getQuestionHistoryCutoff(now);
  return (Array.isArray(questionHistory) ? questionHistory : []).filter((entry) => entry.createdAt >= cutoff);
}

function buildRecentQuestionKeySet(questionHistory, now = Date.now()) {
  return new Set(pruneQuestionHistoryEntries(questionHistory, now).map((entry) => entry.key));
}

function mergeQuestionHistoryEntries(questionHistory, questions, now = Date.now()) {
  const entriesByKey = new Map();

  for (const entry of pruneQuestionHistoryEntries(questionHistory, now)) {
    const currentCreatedAt = entriesByKey.get(entry.key) ?? 0;
    entriesByKey.set(entry.key, Math.max(currentCreatedAt, entry.createdAt));
  }

  for (const question of questions) {
    entriesByKey.set(question.key ?? createQuestionKey(question.left, question.right), now);
  }

  return Array.from(entriesByKey.entries())
    .map(([key, createdAt]) => ({ key, createdAt }))
    .sort((left, right) => right.createdAt - left.createdAt);
}

function buildAvailableQuestionPool(recentQuestionKeys) {
  const pool = [];

  for (let left = UNLOCK_QUESTION_MIN_OPERAND; left <= UNLOCK_QUESTION_MAX_OPERAND; left += 1) {
    for (let right = left; right <= UNLOCK_QUESTION_MAX_OPERAND; right += 1) {
      const key = createQuestionKey(left, right);

      if (recentQuestionKeys.has(key)) {
        continue;
      }

      pool.push({ left, right });
    }
  }

  return pool;
}

function selectRandomQuestions(questionHistory, now = Date.now()) {
  const recentQuestionKeys = buildRecentQuestionKeySet(questionHistory, now);
  const pool = buildAvailableQuestionPool(recentQuestionKeys);

  if (pool.length < UNLOCK_QUESTION_COUNT) {
    throw new AppError(
      ERROR_CODES.UNLOCK_CHALLENGE_MISSING,
      "最近 7 天内已用题目过多，暂时无法生成新的不重复题目，请稍后再试。"
    );
  }

  const questions = [];

  while (questions.length < UNLOCK_QUESTION_COUNT) {
    const randomIndex = Math.floor(Math.random() * pool.length);
    const [selection] = pool.splice(randomIndex, 1);
    questions.push(createQuestion(selection.left, selection.right));
  }

  return questions;
}

function buildChallenge(questionHistory, now = Date.now()) {
  return {
    id: crypto.randomUUID(),
    createdAt: now,
    questions: selectRandomQuestions(questionHistory, now)
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

async function ensureChallengeState() {
  let challenge = null;

  const state = await updateState(async (draftState) => {
    if (!isSessionActive(draftState.currentSession) || isTemporaryAllowActive(draftState.currentSession)) {
      return draftState;
    }

    const unlockState = ensureUnlockState(draftState.currentSession);
    const cooldownRemainingMs = getCooldownRemainingMs(unlockState);

    if (unlockState.pendingResultAvailable || cooldownRemainingMs > 0) {
      return draftState;
    }

    challenge = unlockState.pendingChallengeId ? await readUnlockChallenge(draftState.currentSession.id) : null;

    if (challenge?.id === unlockState.pendingChallengeId) {
      return draftState;
    }

    const now = Date.now();
    challenge = buildChallenge(draftState[STORAGE_KEYS.UNLOCK_QUESTION_HISTORY], now);
    unlockState.pendingChallengeId = challenge.id;
    draftState[STORAGE_KEYS.UNLOCK_QUESTION_HISTORY] = mergeQuestionHistoryEntries(
      draftState[STORAGE_KEYS.UNLOCK_QUESTION_HISTORY],
      challenge.questions,
      now
    );
    draftState.currentSession.updatedAt = now;
    await writeUnlockChallenge(draftState.currentSession.id, challenge);
  });

  return { state, challenge };
}

export async function getUnlockContext() {
  let { state, challenge } = await ensureChallengeState();
  let session = state.currentSession;

  if (!isSessionActive(session)) {
    return {
      hasActiveSession: false
    };
  }

  if (isTemporaryAllowActive(session)) {
    return buildTemporaryAllowLockedContext(session);
  }

  let unlockState = ensureUnlockState(session);
  const cooldownRemainingMs = getCooldownRemainingMs(unlockState);

  if (unlockState.pendingResultAvailable) {
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

  let activeChallenge = challenge?.id === unlockState.pendingChallengeId
    ? challenge
    : await readUnlockChallenge(session.id);

  if (!activeChallenge || activeChallenge.id !== unlockState.pendingChallengeId) {
    await clearUnlockChallenge(session.id);
    ({ state, challenge } = await ensureChallengeState());
    session = state.currentSession;

    if (!isSessionActive(session)) {
      return {
        hasActiveSession: false
      };
    }

    if (isTemporaryAllowActive(session)) {
      return buildTemporaryAllowLockedContext(session);
    }

    unlockState = ensureUnlockState(session);
    activeChallenge = challenge;
  }

  if (!activeChallenge || activeChallenge.id !== unlockState.pendingChallengeId) {
    throw new AppError(ERROR_CODES.UNLOCK_CHALLENGE_MISSING, "当前没有可用的解锁题目，请刷新后重试。");
  }

  return {
    hasActiveSession: true,
    stage: "challenge",
    currentSession: session,
    cooldownRemainingMs: 0,
    questions: serializeQuestions(activeChallenge)
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
  let challengeSessionId = null;

  await updateState(async (state) => {
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

    const challenge = unlockState.pendingChallengeId ? await readUnlockChallenge(session.id) : null;

    if (!challenge || challenge.id !== unlockState.pendingChallengeId) {
      unlockState.pendingChallengeId = null;
      session.updatedAt = Date.now();
      throw new AppError(ERROR_CODES.UNLOCK_CHALLENGE_MISSING, "当前没有可用的解锁题目，请刷新后重试。");
    }

    const incorrectIndexes = challenge.questions.reduce((indexes, question, index) => {
      if (normalizedAnswers[index] !== question.answer) {
        indexes.push(index);
      }

      return indexes;
    }, []);

    const score = challenge.questions.length - incorrectIndexes.length;
    challengeSessionId = session.id;

    if (score === challenge.questions.length) {
      unlockState.pendingResultAvailable = true;
      unlockState.pendingChallengeId = null;
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
    unlockState.pendingChallengeId = null;

    if (state.settings.unlockCooldownEnabled) {
      unlockState.cooldownUntil = Date.now() + Number(state.settings.unlockCooldownMinutes) * 60 * 1000;
    } else {
      unlockState.cooldownUntil = null;
    }

    session.updatedAt = Date.now();
    attemptRecord = {
      sessionId: session.id,
      score,
      result: "failed",
      cooldownUntil: unlockState.cooldownUntil
    };
    response = {
      passed: false,
      code: ERROR_CODES.UNLOCK_ANSWERS_INCORRECT,
      score,
      incorrectIndexes,
      cooldownRemainingMs: getCooldownRemainingMs(unlockState),
      message: "答题未全部正确。"
    };
  });

  if (challengeSessionId) {
    await clearUnlockChallenge(challengeSessionId);
  }

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

  const pendingResultAvailable = ensureUnlockState(session).pendingResultAvailable;

  if (!pendingResultAvailable) {
    throw new AppError(ERROR_CODES.UNLOCK_PENDING_RESULT_MISSING, "当前没有待确认的解锁结果。");
  }

  await clearUnlockChallenge(session.id);

  if (result === "temporary_allow") {
    await applyTemporaryAllow({ clearPendingResult: true });
    await safeRecordUnlockAttempt({
      sessionId: session.id,
      score: UNLOCK_QUESTION_COUNT,
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
    score: UNLOCK_QUESTION_COUNT,
    result
  });

  return {
    result,
    message: "当前专注会话已结束。"
  };
}
