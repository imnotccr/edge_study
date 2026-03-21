import { DASHBOARD_RANGES, MESSAGE_TYPES } from "../shared/constants.js";
import { installGlobalErrorHandlers } from "../shared/error-log.js";
import { formatErrorLabel } from "../shared/errors.js";
import { sendRuntimeMessage } from "../shared/api.js";
import { initTheme } from "../shared/theme.js";
import { formatDateTime, formatMinutesLabel } from "../shared/time.js";

const elements = {
  notice: document.querySelector("#dashboardNotice"),
  rangeButtons: document.querySelector("#rangeButtons"),
  focusMinutesText: document.querySelector("#focusMinutesText"),
  completedSessionsText: document.querySelector("#completedSessionsText"),
  blockedCountText: document.querySelector("#blockedCountText"),
  unlockCountText: document.querySelector("#unlockCountText"),
  topBlockedList: document.querySelector("#topBlockedList"),
  sessionHistoryList: document.querySelector("#sessionHistoryList"),
  unlockHistoryList: document.querySelector("#unlockHistoryList"),
  errorLogSection: document.querySelector("#errorLogSection"),
  clearErrorLogsButton: document.querySelector("#clearErrorLogsButton"),
  errorLogList: document.querySelector("#errorLogList")
};

let currentRange = "today";

function showNotice(text, type = "error") {
  elements.notice.textContent = text;
  elements.notice.className = `notice ${type}`;
  elements.notice.classList.remove("hidden");
}

function clearNotice() {
  elements.notice.textContent = "";
  elements.notice.className = "notice hidden";
}

function renderRangeButtons() {
  elements.rangeButtons.innerHTML = "";

  for (const range of DASHBOARD_RANGES) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `filter-chip${range.value === currentRange ? " active" : ""}`;
    button.textContent = range.label;
    button.addEventListener("click", () => {
      currentRange = range.value;
      renderRangeButtons();
      void loadDashboard();
    });
    elements.rangeButtons.appendChild(button);
  }
}

function createEmptyState(text) {
  const element = document.createElement("div");
  element.className = "notice";
  element.textContent = text;
  return element;
}

function renderTopBlockedDomains(items) {
  elements.topBlockedList.innerHTML = "";

  if (!items.length) {
    elements.topBlockedList.appendChild(createEmptyState("当前范围内还没有被拦截记录。"));
    return;
  }

  for (const item of items) {
    const row = document.createElement("div");
    row.className = "list-item";
    row.innerHTML = `
      <div>
        <div class="title">${item.domain}</div>
        <div class="subtitle">被拦截 ${item.count} 次</div>
      </div>
    `;
    elements.topBlockedList.appendChild(row);
  }
}

function renderSessions(items) {
  elements.sessionHistoryList.innerHTML = "";

  if (!items.length) {
    elements.sessionHistoryList.appendChild(createEmptyState("当前范围内还没有专注会话记录。"));
    return;
  }

  for (const item of items) {
    const row = document.createElement("div");
    row.className = "list-item";
    row.innerHTML = `
      <div>
        <div class="title">${item.purpose}</div>
        <div class="subtitle">${formatMinutesLabel(item.durationMinutes)} · ${formatDateTime(item.startAt)} · ${item.endReason}</div>
      </div>
    `;
    elements.sessionHistoryList.appendChild(row);
  }
}

function renderUnlocks(items) {
  elements.unlockHistoryList.innerHTML = "";

  if (!items.length) {
    elements.unlockHistoryList.appendChild(createEmptyState("当前范围内还没有解锁记录。"));
    return;
  }

  const labels = {
    temporary_allow: "临时放行 10 分钟",
    end_session: "结束本次专注",
    failed: "答题失败"
  };

  for (const item of items) {
    const row = document.createElement("div");
    row.className = "list-item";
    row.innerHTML = `
      <div>
        <div class="title">${labels[item.result] ?? item.result}</div>
        <div class="subtitle">${item.reason} · ${formatDateTime(item.createdAt)}</div>
      </div>
    `;
    elements.unlockHistoryList.appendChild(row);
  }
}

function formatDetails(details) {
  if (!details || typeof details !== "object") {
    return "";
  }

  const raw = JSON.stringify(details);
  return raw.length > 160 ? `${raw.slice(0, 160)}...` : raw;
}

function renderErrorLogs(items, visible) {
  elements.errorLogSection.classList.toggle("hidden", !visible);

  if (!visible) {
    return;
  }

  elements.errorLogList.innerHTML = "";

  if (!items.length) {
    elements.errorLogList.appendChild(createEmptyState("当前范围内还没有错误日志。"));
    return;
  }

  for (const item of items) {
    const row = document.createElement("div");
    row.className = "list-item";
    const detailsText = formatDetails(item.details);
    row.innerHTML = `
      <div>
        <div class="title">[${item.code}] ${item.message}</div>
        <div class="subtitle">${item.source} · ${item.scope} · ${formatDateTime(item.createdAt)}</div>
        ${detailsText ? `<div class="subtitle">${detailsText}</div>` : ""}
      </div>
    `;
    elements.errorLogList.appendChild(row);
  }
}

async function loadDashboard() {
  try {
    const data = await sendRuntimeMessage(MESSAGE_TYPES.GET_DASHBOARD_DATA, { range: currentRange });
    clearNotice();
    elements.focusMinutesText.textContent = formatMinutesLabel(data.cards.totalFocusMinutes);
    elements.completedSessionsText.textContent = String(data.cards.completedSessions);
    elements.blockedCountText.textContent = String(data.cards.blockedCount);
    elements.unlockCountText.textContent = String(data.cards.unlockCount);
    renderTopBlockedDomains(data.topBlockedDomains);
    renderSessions(data.sessions);
    renderUnlocks(data.unlockAttempts);
    renderErrorLogs(data.errorLogs, data.showErrorLogs);
  } catch (error) {
    showNotice(formatErrorLabel(error), "error");
  }
}

elements.clearErrorLogsButton.addEventListener("click", async () => {
  try {
    await sendRuntimeMessage(MESSAGE_TYPES.CLEAR_ERROR_LOGS);
    showNotice("错误日志已清空。", "success");
    await loadDashboard();
  } catch (error) {
    showNotice(formatErrorLabel(error), "error");
  }
});

chrome.storage.onChanged.addListener(() => {
  void loadDashboard();
});

installGlobalErrorHandlers("pages/dashboard");
await initTheme();
renderRangeButtons();
await loadDashboard();
