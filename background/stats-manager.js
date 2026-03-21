import { STORAGE_KEYS } from "../shared/constants.js";
import { extractDomainFromUrl } from "../shared/domain.js";
import { getStartOfToday, getStartOfWeek } from "../shared/time.js";
import { readState, replaceState } from "../shared/storage.js";

function createId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function getRetentionCutoff(state) {
  const retentionDays = Math.max(1, Number(state.settings.retentionDays) || 1);
  return Date.now() - retentionDays * 24 * 60 * 60 * 1000;
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

function pruneState(state) {
  const cutoff = getRetentionCutoff(state);

  state.sessionHistory = state.sessionHistory.filter((session) => {
    const targetTime = session.actualEndAt ?? session.endAt ?? session.startAt ?? 0;
    return targetTime >= cutoff;
  });

  state.blockAttempts = state.blockAttempts.filter((attempt) => attempt.attemptAt >= cutoff);
  state.unlockAttempts = state.unlockAttempts.filter((attempt) => attempt.createdAt >= cutoff);
  state.errorLogs = state.errorLogs.filter((entry) => entry.createdAt >= cutoff);
}

export async function pruneExpiredData() {
  const state = await readState();
  pruneState(state);
  await replaceState(state);
  return state;
}

export async function recordBlockAttempt({ tabId, url, source }) {
  const domain = extractDomainFromUrl(url);

  if (!domain) {
    return null;
  }

  const state = await readState();
  const session = state.currentSession;

  if (!session) {
    return null;
  }

  const attempt = {
    id: createId("block"),
    sessionId: session.id,
    domain,
    attemptAt: Date.now(),
    source
  };

  state.blockAttempts.unshift(attempt);
  state[STORAGE_KEYS.TAB_BLOCK_STATE][String(tabId)] = {
    domain,
    url,
    attemptAt: attempt.attemptAt,
    source
  };

  pruneState(state);
  await replaceState(state);
  return attempt;
}

export async function recordUnlockAttempt(record) {
  const state = await readState();

  state.unlockAttempts.unshift({
    id: createId("unlock"),
    createdAt: Date.now(),
    ...record
  });

  pruneState(state);
  await replaceState(state);
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
  const state = await readState();
  pruneState(state);
  await replaceState(state);

  const rangeStart = getRangeStart(range);
  const allSessions = [...state.sessionHistory];

  if (state.currentSession) {
    allSessions.unshift(
      buildSessionSummary({
        ...state.currentSession,
        actualEndAt: Date.now()
      })
    );
  }

  const filteredSessions = allSessions.filter((session) => session.startAt >= rangeStart);
  const filteredBlocks = state.blockAttempts.filter((attempt) => attempt.attemptAt >= rangeStart);
  const filteredUnlocks = state.unlockAttempts.filter((attempt) => attempt.createdAt >= rangeStart);
  const filteredErrorLogs = state.errorLogs.filter((entry) => entry.createdAt >= rangeStart);

  const totalFocusMinutes = filteredSessions.reduce((sum, session) => sum + session.durationMinutes, 0);
  const completedSessions = filteredSessions.filter((session) => session.status !== "active").length;
  const blockedCount = filteredBlocks.length;

  const topBlockedMap = filteredBlocks.reduce((accumulator, attempt) => {
    accumulator[attempt.domain] = (accumulator[attempt.domain] ?? 0) + 1;
    return accumulator;
  }, {});

  const topBlockedDomains = Object.entries(topBlockedMap)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)
    .map(([domain, count]) => ({ domain, count }));

  return {
    range,
    showErrorLogs: Boolean(state.settings.devToolsEnabled),
    cards: {
      totalFocusMinutes,
      completedSessions,
      blockedCount,
      unlockCount: filteredUnlocks.length,
      errorCount: filteredErrorLogs.length
    },
    topBlockedDomains,
    sessions: filteredSessions.slice(0, 20),
    unlockAttempts: filteredUnlocks.slice(0, 20),
    errorLogs: filteredErrorLogs.slice(0, 30)
  };
}
