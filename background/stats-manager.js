import { STORAGE_KEYS, UNLOCK_QUESTION_HISTORY_RETENTION_DAYS } from "../shared/constants.js";
import { extractDomainFromUrl, extractOriginFromUrl } from "../shared/domain.js";
import { setTabRestoreTarget } from "../shared/session-secrets.js";
import { getStartOfToday, getStartOfWeek } from "../shared/time.js";
import { updateState } from "../shared/storage.js";

const DATA_RETENTION_DAYS = 7;
const DATA_RETENTION_MS = DATA_RETENTION_DAYS * 24 * 60 * 60 * 1000;
const UNLOCK_QUESTION_HISTORY_RETENTION_MS = UNLOCK_QUESTION_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
const TOP_BLOCKED_DOMAIN_LIMIT = 5;
const RECENT_RECORD_LIMIT = 3;

function createId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function getDataRetentionCutoff(now = Date.now()) {
  return now - DATA_RETENTION_MS;
}

function getUnlockQuestionHistoryCutoff(now = Date.now()) {
  return now - UNLOCK_QUESTION_HISTORY_RETENTION_MS;
}

function buildSessionSummary(session) {
  const finishedAt = session.actualEndAt ?? session.endAt ?? Date.now();
  const durationMinutes = Math.max(1, Math.round((finishedAt - session.startAt) / 60000));

  return {
    id: session.id,
    status: session.status,
    endReason: session.endReason ?? session.status,
    purpose: session.purpose,
    startAt: session.startAt,
    endAt: session.endAt,
    actualEndAt: finishedAt,
    durationMinutes,
    plannedMinutes: session.plannedMinutes
  };
}

function pruneState(state, now = Date.now()) {
  const retentionCutoff = getDataRetentionCutoff(now);
  const unlockQuestionHistoryCutoff = getUnlockQuestionHistoryCutoff(now);

  state.sessionHistory = state.sessionHistory.filter((session) => {
    const targetTime = session.actualEndAt ?? session.endAt ?? session.startAt ?? 0;
    return targetTime >= retentionCutoff;
  }).slice(0, RECENT_RECORD_LIMIT);

  state.blockAttempts = state.blockAttempts.filter((attempt) => attempt.attemptAt >= retentionCutoff);
  state.unlockAttempts = state.unlockAttempts.filter((attempt) => attempt.createdAt >= retentionCutoff).slice(0, RECENT_RECORD_LIMIT);
  state[STORAGE_KEYS.UNLOCK_QUESTION_HISTORY] = state[STORAGE_KEYS.UNLOCK_QUESTION_HISTORY].filter(
    (entry) => entry.createdAt >= unlockQuestionHistoryCutoff
  );
  state.errorLogs = state.errorLogs.filter((entry) => entry.createdAt >= retentionCutoff);
}

function buildBlockedDomainSummary(blockAttempts) {
  const domainCountMap = blockAttempts.reduce((accumulator, attempt) => {
    accumulator[attempt.domain] = (accumulator[attempt.domain] ?? 0) + 1;
    return accumulator;
  }, {});

  const items = Object.entries(domainCountMap)
    .sort((left, right) => right[1] - left[1])
    .slice(0, TOP_BLOCKED_DOMAIN_LIMIT)
    .map(([domain, count]) => ({ domain, count }));

  const topItemsCount = items.reduce((sum, item) => sum + item.count, 0);

  return {
    total: blockAttempts.length,
    items,
    otherCount: Math.max(0, blockAttempts.length - topItemsCount)
  };
}

export async function pruneExpiredData() {
  return updateState((state) => {
    pruneState(state);
  });
}

export async function recordBlockAttempt({ tabId, url, source }) {
  const domain = extractDomainFromUrl(url);
  const origin = extractOriginFromUrl(url);

  if (!domain) {
    return null;
  }

  let attempt = null;

  await updateState((state) => {
    const session = state.currentSession;

    if (!session) {
      return state;
    }

    attempt = {
      id: createId("block"),
      sessionId: session.id,
      domain,
      attemptAt: Date.now(),
      source
    };

    state.blockAttempts.unshift(attempt);
    state[STORAGE_KEYS.TAB_BLOCK_STATE][String(tabId)] = {
      domain,
      origin,
      attemptAt: attempt.attemptAt,
      source
    };

    pruneState(state);
  });

  if (attempt && Number.isInteger(tabId)) {
    await setTabRestoreTarget(tabId, url);
  }

  return attempt;
}

export async function recordUnlockAttempt(record) {
  await updateState((state) => {
    state.unlockAttempts.unshift({
      id: createId("unlock"),
      createdAt: Date.now(),
      ...record
    });

    pruneState(state);
  });
}

function getRangeStart(range) {
  if (range === "today") {
    return getStartOfToday();
  }

  if (range === "week") {
    return getStartOfWeek();
  }

  return 0;
}

export async function buildDashboardData(range) {
  const state = await updateState((draftState) => {
    pruneState(draftState);
  });

  const rangeStart = getRangeStart(range);
  const currentSessionSummary = state.currentSession
    ? buildSessionSummary({
        ...state.currentSession,
        actualEndAt: Date.now()
      })
    : null;
  const filteredArchivedSessions = state.sessionHistory.filter((session) => session.startAt >= rangeStart);
  const filteredSessions = currentSessionSummary && currentSessionSummary.startAt >= rangeStart
    ? [currentSessionSummary, ...filteredArchivedSessions]
    : filteredArchivedSessions;
  const displayedSessions = currentSessionSummary && currentSessionSummary.startAt >= rangeStart
    ? [currentSessionSummary, ...filteredArchivedSessions.slice(0, RECENT_RECORD_LIMIT)]
    : filteredArchivedSessions.slice(0, RECENT_RECORD_LIMIT);
  const filteredBlocks = state.blockAttempts.filter((attempt) => attempt.attemptAt >= rangeStart);
  const filteredUnlocks = state.unlockAttempts.filter((attempt) => attempt.createdAt >= rangeStart);
  const filteredErrorLogs = state.errorLogs.filter((entry) => entry.createdAt >= rangeStart);
  const blockedDomainSummary = buildBlockedDomainSummary(filteredBlocks);

  const totalFocusMinutes = filteredSessions.reduce((sum, session) => sum + session.durationMinutes, 0);
  const completedSessions = filteredSessions.filter((session) => session.status !== "active").length;

  return {
    range,
    showErrorLogs: Boolean(state.settings.devToolsEnabled),
    cards: {
      totalFocusMinutes,
      completedSessions,
      blockedCount: filteredBlocks.length,
      unlockCount: filteredUnlocks.length,
      errorCount: filteredErrorLogs.length
    },
    topBlockedDomains: blockedDomainSummary.items,
    topBlockedTotal: blockedDomainSummary.total,
    topBlockedOtherCount: blockedDomainSummary.otherCount,
    topBlockedWindowDays: DATA_RETENTION_DAYS,
    sessions: displayedSessions,
    unlockAttempts: filteredUnlocks.slice(0, RECENT_RECORD_LIMIT),
    errorLogs: filteredErrorLogs.slice(0, 30)
  };
}
