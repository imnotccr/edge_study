import { DASHBOARD_RANGES, MESSAGE_TYPES } from "../shared/constants.js";
import { installGlobalErrorHandlers } from "../shared/error-log.js";
import { formatErrorLabel } from "../shared/errors.js";
import { sendRuntimeMessage } from "../shared/api.js";
import { initTheme } from "../shared/theme.js";
import { formatDateTime, formatMinutesLabel } from "../shared/time.js";

const PIE_COLORS = ["#34c98a", "#61d9a6", "#8de8c0", "#b8f2d8", "#ffd166", "#8ecdf8"];
const DOT_SEPARATOR = " · ";

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

function createTextElement(tagName, className, text) {
  const element = document.createElement(tagName);
  element.className = className;
  element.textContent = text;
  return element;
}

function createListItem(title, subtitle, extraSubtitle = "") {
  const row = document.createElement("div");
  row.className = "list-item";

  const wrapper = document.createElement("div");
  wrapper.appendChild(createTextElement("div", "title", title));
  wrapper.appendChild(createTextElement("div", "subtitle", subtitle));

  if (extraSubtitle) {
    wrapper.appendChild(createTextElement("div", "subtitle", extraSubtitle));
  }

  row.appendChild(wrapper);
  return row;
}

function renderRangeButtons() {
  elements.rangeButtons.replaceChildren();

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

function buildChartSegments(items, totalCount) {
  let currentPercent = 0;

  return items
    .map((item) => {
      const percent = totalCount > 0 ? (item.count / totalCount) * 100 : 0;
      const nextPercent = currentPercent + percent;
      const segment = `${item.color} ${currentPercent.toFixed(2)}% ${nextPercent.toFixed(2)}%`;
      currentPercent = nextPercent;
      return segment;
    })
    .join(", ");
}

function formatShare(count, totalCount) {
  if (!totalCount) {
    return "0";
  }

  const percentage = (count / totalCount) * 100;
  return percentage >= 10 ? String(Math.round(percentage)) : percentage.toFixed(1).replace(/\.0$/, "");
}

function renderTopBlockedDomains(items, totalCount, otherCount, windowDays) {
  elements.topBlockedList.replaceChildren();

  if (!totalCount) {
    elements.topBlockedList.appendChild(createEmptyState(`最近 ${windowDays} 天还没有被拦截记录。`));
    return;
  }

  const chartItems = items.map((item, index) => ({
    ...item,
    color: PIE_COLORS[index % PIE_COLORS.length]
  }));

  if (otherCount > 0) {
    chartItems.push({
      domain: "其他域名",
      count: otherCount,
      color: PIE_COLORS[chartItems.length % PIE_COLORS.length],
      isOther: true
    });
  }

  const chartBackground = `conic-gradient(${buildChartSegments(chartItems, totalCount)})`;
  const layout = document.createElement("div");
  layout.className = "blocked-chart-layout";

  const visual = document.createElement("div");
  visual.className = "blocked-chart-visual";

  const chart = document.createElement("div");
  chart.className = "blocked-chart";
  chart.style.setProperty("--chart-background", chartBackground);

  const center = document.createElement("div");
  center.className = "blocked-chart-center";
  center.appendChild(createTextElement("strong", "blocked-chart-total", String(totalCount)));
  center.appendChild(createTextElement("span", "blocked-chart-caption", `最近 ${windowDays} 天拦截`));
  chart.appendChild(center);

  const note = createTextElement(
    "p",
    "blocked-chart-note",
    `占比按最近 ${windowDays} 天所有拦截记录计算。`
  );
  visual.append(chart, note);

  const legendList = document.createElement("div");
  legendList.className = "blocked-chart-list";

  for (const item of chartItems) {
    const shareLabel = formatShare(item.count, totalCount);
    const row = document.createElement("div");
    row.className = "blocked-chart-row";

    const swatch = document.createElement("span");
    swatch.className = "blocked-chart-swatch";
    swatch.style.setProperty("--swatch", item.color);

    const copy = document.createElement("div");
    copy.className = "blocked-chart-copy";
    copy.appendChild(createTextElement("div", "blocked-chart-domain", item.domain));
    copy.appendChild(createTextElement("div", "blocked-chart-meta", `${item.count} 次${DOT_SEPARATOR}${shareLabel}%`));

    row.append(swatch, copy);
    legendList.appendChild(row);
  }

  layout.append(visual, legendList);
  elements.topBlockedList.appendChild(layout);
}

function renderSessions(items) {
  elements.sessionHistoryList.replaceChildren();

  if (!items.length) {
    elements.sessionHistoryList.appendChild(createEmptyState("当前范围内还没有专注会话记录。"));
    return;
  }

  for (const item of items) {
    elements.sessionHistoryList.appendChild(
      createListItem(
        item.purpose,
        `${formatMinutesLabel(item.durationMinutes)}${DOT_SEPARATOR}${formatDateTime(item.startAt)}${DOT_SEPARATOR}${item.endReason}`
      )
    );
  }
}

function renderUnlocks(items) {
  elements.unlockHistoryList.replaceChildren();

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
    elements.unlockHistoryList.appendChild(
      createListItem(
        labels[item.result] ?? item.result,
        `${item.reason}${DOT_SEPARATOR}${formatDateTime(item.createdAt)}`
      )
    );
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

  elements.errorLogList.replaceChildren();

  if (!items.length) {
    elements.errorLogList.appendChild(createEmptyState("当前范围内还没有错误日志。"));
    return;
  }

  for (const item of items) {
    const detailsText = formatDetails(item.details);
    elements.errorLogList.appendChild(
      createListItem(
        `[${item.code}] ${item.message}`,
        `${item.source}${DOT_SEPARATOR}${item.scope}${DOT_SEPARATOR}${formatDateTime(item.createdAt)}`,
        detailsText
      )
    );
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
    renderTopBlockedDomains(
      data.topBlockedDomains,
      data.topBlockedTotal,
      data.topBlockedOtherCount,
      data.topBlockedWindowDays
    );
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
