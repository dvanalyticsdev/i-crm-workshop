import { registerPageCleanup } from "./page-runtime.js";
import { apiUrl } from "./api-client.js";
import { bootstrapLocalState, getSession } from "./state-sync.js";

await bootstrapLocalState({ skipStateRefresh: true });

const session = getSession();
if (session?.role !== "super_admin") {
  window.location.href = "dashboard.html";
}

const summaryCards = document.getElementById("performanceSummaryCards");
const windowLabel = document.getElementById("performanceWindowLabel");
const pageRoleTable = document.getElementById("performancePageRoleTable");
const activityTable = document.getElementById("performanceActivityTable");
const fastestTable = document.getElementById("performanceFastestTable");
const mediumTable = document.getElementById("performanceMediumTable");
const slowestTable = document.getElementById("performanceSlowestTable");
const trendChart = document.getElementById("overallPerformanceTrendChart");
const rangePreset = document.getElementById("performanceRangePreset");
const refreshButton = document.getElementById("refreshPerformanceLogsBtn");
const clearButton = document.getElementById("clearPerformanceLogsBtn");
let latestPerformanceSummary = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatMs(value) {
  const ms = Math.round(Number(value) || 0);
  if (!ms) return "-";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function formatDate(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function getStatusClass(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "critical") return "badge-danger";
  if (normalized === "slow") return "badge-warning";
  return "badge-success";
}

function getPerformanceQueryString() {
  const params = new URLSearchParams();
  const preset = String(rangePreset?.value || "6h").trim().toLowerCase();
  if (preset.endsWith("h")) {
    params.set("hours", preset.replace("h", ""));
  } else {
    params.set("days", preset);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

async function loadPerformanceSummary() {
  const response = await fetch(apiUrl(`/api/performance-logs/summary${getPerformanceQueryString()}`), {
    credentials: "same-origin",
    headers: { Accept: "application/json" }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.message || "Failed to load performance logs.");
  }
  return payload;
}

function renderSummary(summary) {
  const total = Number(summary.totalEvents || 0);
  const successRate = Number(summary.successRate || 100);
  const failureRate = Math.max(0, 100 - successRate);
  summaryCards.innerHTML = `
    <article class="performance-card">
      <span class="performance-card__label">Overall Performance</span>
      <strong>${Number(summary.overallScore || 0)}/100</strong>
      <span>${escapeHtml(summary.status || "Good")}</span>
    </article>
    <article class="performance-card">
      <span class="performance-card__label">Average Page Loading</span>
      <strong>${formatMs(summary.pageAverageDurationMs || 0)}</strong>
      <span>Across CRM pages</span>
    </article>
    <article class="performance-card">
      <span class="performance-card__label">Logs Recorded</span>
      <strong>${total}</strong>
      <span>${escapeHtml(summary.windowLabel || "Selected window")}</span>
    </article>
    <article class="performance-card">
      <span class="performance-card__label">Success vs Failure</span>
      <strong>${successRate.toFixed(1)}% / ${failureRate.toFixed(1)}%</strong>
      <span>Successful vs failed events</span>
    </article>
  `;
  windowLabel.textContent = `${summary.windowLabel || "Selected window"} - generated ${formatDate(summary.generatedAt)}`;
}

function renderPageRoleTable(rows = []) {
  pageRoleTable.innerHTML = `
    <table class="performance-table performance-table--role-pages">
      <thead>
        <tr>
          <th>Page</th>
          <th>Super Admin / Admin Avg</th>
          <th>Admin Logs</th>
          <th>Counselor Avg</th>
          <th>Counselor Logs</th>
        </tr>
      </thead>
      <tbody>
        ${rows.length ? rows.map((row) => `
          <tr>
            <td class="performance-name-cell" title="${escapeHtml(row.page)}">${escapeHtml(row.page)}</td>
            <td>${formatMs(row.adminAvgDurationMs)}</td>
            <td>${Number(row.adminTotal || 0)}</td>
            <td>${formatMs(row.counselorAvgDurationMs)}</td>
            <td>${Number(row.counselorTotal || 0)}</td>
          </tr>
        `).join("") : `<tr><td colspan="5">No page loading logs recorded for this timeline.</td></tr>`}
      </tbody>
    </table>
  `;
}

function renderActivityTable(rows = []) {
  activityTable.innerHTML = `
    <table class="performance-table">
      <thead>
        <tr>
          <th>Activity</th>
          <th>Status</th>
          <th>Avg</th>
          <th>P95</th>
          <th>Max</th>
          <th>Success</th>
          <th>Total</th>
        </tr>
      </thead>
      <tbody>
        ${rows.length ? rows.map((row) => `
          <tr>
            <td class="performance-name-cell" title="${escapeHtml(row.operation || row.name)}">${escapeHtml(row.operation || row.name)}</td>
            <td><span class="badge ${getStatusClass(row.status)}">${escapeHtml(row.status)}</span></td>
            <td>${formatMs(row.avgDurationMs)}</td>
            <td>${formatMs(row.p95DurationMs)}</td>
            <td>${formatMs(row.maxDurationMs)}</td>
            <td>${Number(row.successRate || 0).toFixed(1)}%</td>
            <td>${Number(row.total || 0)}</td>
          </tr>
        `).join("") : `<tr><td colspan="7">No activity speed logs recorded for this timeline.</td></tr>`}
      </tbody>
    </table>
  `;
}

function renderBucketTable(container, rows = [], emptyText) {
  container.innerHTML = `
    <table class="performance-table performance-table--bucket">
      <thead>
        <tr>
          <th>Name</th>
          <th>Type</th>
          <th>Avg</th>
          <th>Success</th>
          <th>Total</th>
        </tr>
      </thead>
      <tbody>
        ${rows.length ? rows.map((row) => `
          <tr>
            <td class="performance-name-cell" title="${escapeHtml(row.name)}">${escapeHtml(row.name)}</td>
            <td>${escapeHtml(row.type || "-")}</td>
            <td>${formatMs(row.avgDurationMs)}</td>
            <td>${Number(row.successRate || 0).toFixed(1)}%</td>
            <td>${Number(row.total || 0)}</td>
          </tr>
        `).join("") : `<tr><td colspan="5">${escapeHtml(emptyText)}</td></tr>`}
      </tbody>
    </table>
  `;
}

function getCanvasTextColor() {
  return getComputedStyle(document.documentElement).getPropertyValue("--text-muted").trim() || "#94a3b8";
}

function getTrendLine(values) {
  const points = values
    .map((value, index) => ({ index, value: Number(value) || 0 }))
    .filter((point) => point.value > 0);
  if (points.length < 2) return values.map(() => null);
  const n = points.length;
  const sumX = points.reduce((sum, point) => sum + point.index, 0);
  const sumY = points.reduce((sum, point) => sum + point.value, 0);
  const sumXY = points.reduce((sum, point) => sum + point.index * point.value, 0);
  const sumXX = points.reduce((sum, point) => sum + point.index * point.index, 0);
  const denominator = n * sumXX - sumX * sumX;
  const slope = denominator ? (n * sumXY - sumX * sumY) / denominator : 0;
  const intercept = (sumY - slope * sumX) / n;
  return values.map((_, index) => Math.max(0, Math.min(100, intercept + slope * index)));
}

function drawPerformanceTrend(summary) {
  if (!trendChart) return;
  const context = trendChart.getContext("2d");
  if (!context) return;
  const rows = Array.isArray(summary?.trends) ? summary.trends : [];
  const width = trendChart.clientWidth || trendChart.parentElement?.clientWidth || 900;
  const height = Number(trendChart.getAttribute("height")) || 260;
  const ratio = window.devicePixelRatio || 1;
  trendChart.width = Math.round(width * ratio);
  trendChart.height = Math.round(height * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  const pad = { left: 48, right: 18, top: 20, bottom: 36 };
  const chartWidth = Math.max(1, width - pad.left - pad.right);
  const chartHeight = Math.max(1, height - pad.top - pad.bottom);
  const values = rows.map((row) => Number(row.score) || 0);
  const labels = rows.map((row) => String(row.label || row.day || ""));
  const textColor = getCanvasTextColor();
  const gridColor = "rgba(148, 163, 184, 0.18)";
  const lineColor = "#00c46a";

  context.font = "12px 'Plus Jakarta Sans', sans-serif";
  context.strokeStyle = gridColor;
  context.fillStyle = textColor;
  [0, 50, 100].forEach((tick) => {
    const y = pad.top + chartHeight - (tick / 100) * chartHeight;
    context.beginPath();
    context.moveTo(pad.left, y);
    context.lineTo(width - pad.right, y);
    context.stroke();
    context.fillText(`${tick}`, 14, y + 4);
  });

  const getX = (index) => values.length <= 1 ? pad.left + chartWidth / 2 : pad.left + (chartWidth * index) / (values.length - 1);
  const getY = (value) => pad.top + chartHeight - (Math.min(value, 100) / 100) * chartHeight;

  context.strokeStyle = lineColor;
  context.lineWidth = 2.5;
  context.beginPath();
  values.forEach((value, index) => {
    if (value <= 0) return;
    const x = getX(index);
    const y = getY(value);
    if (index === values.findIndex((item) => item > 0)) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.stroke();

  context.fillStyle = lineColor;
  values.forEach((value, index) => {
    if (value <= 0) return;
    context.beginPath();
    context.arc(getX(index), getY(value), 3, 0, Math.PI * 2);
    context.fill();
  });

  const trend = getTrendLine(values);
  context.strokeStyle = "rgba(255, 255, 255, 0.58)";
  context.setLineDash([5, 5]);
  context.lineWidth = 1.5;
  context.beginPath();
  trend.forEach((value, index) => {
    if (value === null) return;
    const x = getX(index);
    const y = getY(value);
    if (index === trend.findIndex((item) => item !== null)) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.stroke();
  context.setLineDash([]);

  context.fillStyle = textColor;
  context.textAlign = "center";
  const labelStep = Math.max(1, Math.ceil(labels.length / 6));
  labels.forEach((label, index) => {
    if (index % labelStep !== 0 && index !== labels.length - 1) return;
    context.fillText(label, getX(index), height - 10);
  });
  context.textAlign = "left";
  if (!values.some((value) => value > 0)) {
    context.fillText("No trend data recorded for this timeline yet.", pad.left, pad.top + 26);
  }
}

async function renderPerformanceDashboard() {
  try {
    const summary = await loadPerformanceSummary();
    latestPerformanceSummary = summary;
    renderSummary(summary);
    renderPageRoleTable(summary.pageRoles || []);
    drawPerformanceTrend(summary);
    renderActivityTable(summary.activities || []);
    renderBucketTable(fastestTable, summary.fastest || [], "No fastest items recorded for this timeline.");
    renderBucketTable(mediumTable, summary.medium || [], "No medium speed items recorded for this timeline.");
    renderBucketTable(slowestTable, summary.slowest || [], "No slow items recorded for this timeline.");
  } catch (error) {
    summaryCards.innerHTML = `<article class="performance-card"><strong>Unable to load</strong><span>${escapeHtml(error.message)}</span></article>`;
    pageRoleTable.innerHTML = "";
    activityTable.innerHTML = "";
    fastestTable.innerHTML = "";
    mediumTable.innerHTML = "";
    slowestTable.innerHTML = "";
    drawPerformanceTrend({ trends: [] });
  }
}

async function clearPerformanceLogs() {
  const confirmed = window.confirm("Clear all performance tracking logs? This only resets performance logs and does not change CRM data.");
  if (!confirmed) return;
  clearButton.disabled = true;
  clearButton.textContent = "Clearing...";
  try {
    const response = await fetch(apiUrl("/api/performance-logs"), {
      method: "DELETE",
      credentials: "same-origin",
      headers: { Accept: "application/json" }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) {
      throw new Error(payload?.message || "Failed to clear performance logs.");
    }
    await renderPerformanceDashboard();
  } catch (error) {
    window.alert(error.message || "Failed to clear performance logs.");
  } finally {
    clearButton.disabled = false;
    clearButton.textContent = "Clear logs";
  }
}

await renderPerformanceDashboard();
window.__dvMarkRouteViewReady?.();
const refreshTimer = window.setInterval(() => {
  void renderPerformanceDashboard();
}, 30000);
const handleRangeChange = () => {
  void renderPerformanceDashboard();
};
const handleChartResize = () => {
  if (latestPerformanceSummary) drawPerformanceTrend(latestPerformanceSummary);
};
rangePreset?.addEventListener("change", handleRangeChange);
refreshButton?.addEventListener("click", () => {
  void renderPerformanceDashboard();
});
clearButton?.addEventListener("click", () => {
  void clearPerformanceLogs();
});
window.addEventListener("resize", handleChartResize);
registerPageCleanup(() => {
  window.clearInterval(refreshTimer);
  rangePreset?.removeEventListener("change", handleRangeChange);
  window.removeEventListener("resize", handleChartResize);
});
