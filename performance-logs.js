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
const operationsTable = document.getElementById("performanceOperationsTable");
const pagesTable = document.getElementById("performancePagesTable");
const rolesTable = document.getElementById("performanceRolesTable");
const sectionsTable = document.getElementById("performanceSectionsTable");
const phasesTable = document.getElementById("performancePhasesTable");
const pageSpeedTrendChart = document.getElementById("pageSpeedTrendChart");
const apiSpeedTrendChart = document.getElementById("apiSpeedTrendChart");
const reliabilityTrendChart = document.getElementById("reliabilityTrendChart");
const slowEvents = document.getElementById("performanceSlowEvents");
const failures = document.getElementById("performanceFailures");
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
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  return `${ms}ms`;
}

function formatDate(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "-";
  }
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

function getCanvasTextColor() {
  return getComputedStyle(document.documentElement).getPropertyValue("--text-muted").trim() || "#94a3b8";
}

function getCanvasLineColor(tone) {
  if (tone === "success") return "#00c46a";
  if (tone === "warning") return "#f59e0b";
  return "#f05a28";
}

function getTrendLine(values) {
  const points = values
    .map((value, index) => ({ index, value: Number(value) || 0 }))
    .filter((point) => point.value > 0);
  if (points.length < 2) {
    return values.map(() => null);
  }

  const n = points.length;
  const sumX = points.reduce((sum, point) => sum + point.index, 0);
  const sumY = points.reduce((sum, point) => sum + point.value, 0);
  const sumXY = points.reduce((sum, point) => sum + point.index * point.value, 0);
  const sumXX = points.reduce((sum, point) => sum + point.index * point.index, 0);
  const denominator = n * sumXX - sumX * sumX;
  const slope = denominator ? (n * sumXY - sumX * sumY) / denominator : 0;
  const intercept = (sumY - slope * sumX) / n;
  return values.map((_, index) => Math.max(0, intercept + slope * index));
}

function drawTrendChart(canvas, rows, { valueKey, label, tone = "accent", formatter = formatMs, fixedMax = null } = {}) {
  if (!canvas) return;
  const context = canvas.getContext("2d");
  if (!context) return;

  const width = canvas.clientWidth || canvas.parentElement?.clientWidth || 520;
  const height = Number(canvas.getAttribute("height")) || 220;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  const values = (Array.isArray(rows) ? rows : []).map((row) => Number(row?.[valueKey]) || 0);
  const labels = (Array.isArray(rows) ? rows : []).map((row) => String(row?.day || "").slice(5));
  const pad = { left: 48, right: 16, top: 18, bottom: 34 };
  const chartWidth = Math.max(1, width - pad.left - pad.right);
  const chartHeight = Math.max(1, height - pad.top - pad.bottom);
  const positiveValues = values.filter((value) => value > 0);
  const maxValue = fixedMax || Math.max(...positiveValues, 1);
  const yMax = fixedMax || Math.ceil(maxValue * 1.2);
  const textColor = getCanvasTextColor();
  const lineColor = getCanvasLineColor(tone);
  const gridColor = "rgba(148, 163, 184, 0.18)";

  context.font = "12px 'Plus Jakarta Sans', sans-serif";
  context.strokeStyle = gridColor;
  context.fillStyle = textColor;
  context.lineWidth = 1;

  [0, 0.5, 1].forEach((tick) => {
    const y = pad.top + chartHeight - chartHeight * tick;
    context.beginPath();
    context.moveTo(pad.left, y);
    context.lineTo(width - pad.right, y);
    context.stroke();
    context.fillText(formatter(yMax * tick), 8, y + 4);
  });

  const getX = (index) => pad.left + (values.length <= 1 ? chartWidth : (chartWidth * index) / (values.length - 1));
  const getY = (value) => pad.top + chartHeight - (Math.min(value, yMax) / yMax) * chartHeight;

  context.strokeStyle = lineColor;
  context.lineWidth = 2.5;
  context.beginPath();
  values.forEach((value, index) => {
    if (value <= 0) return;
    const x = getX(index);
    const y = getY(value);
    if (index === values.findIndex((item) => item > 0)) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
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
    if (index === trend.findIndex((item) => item !== null)) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  });
  context.stroke();
  context.setLineDash([]);

  context.fillStyle = textColor;
  const labelStep = Math.max(1, Math.ceil(labels.length / 5));
  labels.forEach((day, index) => {
    if (index % labelStep !== 0 && index !== labels.length - 1) return;
    context.fillText(day, getX(index) - 12, height - 10);
  });

  if (!positiveValues.length) {
    context.fillText(`No ${label || "trend"} data yet`, pad.left, pad.top + 24);
  }
}

function renderTrendCharts(summary) {
  const trends = Array.isArray(summary?.trends) ? summary.trends : [];
  drawTrendChart(pageSpeedTrendChart, trends, {
    valueKey: "pageAvgDurationMs",
    label: "page speed",
    tone: "accent",
    formatter: formatMs
  });
  drawTrendChart(apiSpeedTrendChart, trends, {
    valueKey: "apiAvgDurationMs",
    label: "API speed",
    tone: "warning",
    formatter: formatMs
  });
  drawTrendChart(reliabilityTrendChart, trends, {
    valueKey: "successRate",
    label: "reliability",
    tone: "success",
    formatter: (value) => `${Math.round(Number(value) || 0)}%`,
    fixedMax: 100
  });
}

async function loadPerformanceSummary() {
  const response = await fetch(apiUrl("/api/performance-logs/summary"), {
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
  const pageRows = Array.isArray(summary.pages) ? summary.pages : [];
  const apiRows = Array.isArray(summary.apis) ? summary.apis : [];
  const slowestPage = pageRows[0] || {};
  const slowestApi = apiRows[0] || {};
  const slowestSection = Array.isArray(summary.sections) ? summary.sections[0] || {} : {};

  summaryCards.innerHTML = `
    <article class="performance-card">
      <span class="performance-card__label">User Page Speed</span>
      <strong>${formatMs(slowestPage.avgDurationMs || 0)}</strong>
      <span>${escapeHtml(slowestPage.page || "No page events yet")}</span>
    </article>
    <article class="performance-card">
      <span class="performance-card__label">API Speed</span>
      <strong>${formatMs(slowestApi.avgDurationMs || 0)}</strong>
      <span>${escapeHtml(slowestApi.operation || "No API events yet")}</span>
    </article>
    <article class="performance-card">
      <span class="performance-card__label">Reliability</span>
      <strong>${Number(summary.successRate || 100).toFixed(1)}%</strong>
      <span>${Number(summary.totalEvents || 0)} events logged</span>
    </article>
    <article class="performance-card">
      <span class="performance-card__label">Slowest Section</span>
      <strong>${formatMs(slowestSection.avgDurationMs || 0)}</strong>
      <span>${escapeHtml(slowestSection.name || "-")}</span>
    </article>
  `;

  windowLabel.textContent = `${summary.windowLabel || "Last 14 days"} - generated ${formatDate(summary.generatedAt)}`;
}

function renderOperations(rows = []) {
  operationsTable.innerHTML = `
    <table class="performance-table">
      <thead>
        <tr>
          <th>Operation</th>
          <th>Status</th>
          <th>Avg</th>
          <th>P95</th>
          <th>Max</th>
          <th>Success</th>
          <th>Failures</th>
          <th>Total</th>
        </tr>
      </thead>
      <tbody>
        ${rows.length ? rows.map((row) => `
          <tr>
            <td class="performance-name-cell" title="${escapeHtml(row.operation)}">${escapeHtml(row.operation)}</td>
            <td><span class="badge ${getStatusClass(row.status)}">${escapeHtml(row.status)}</span></td>
            <td>${formatMs(row.avgDurationMs)}</td>
            <td>${formatMs(row.p95DurationMs)}</td>
            <td>${formatMs(row.maxDurationMs)}</td>
            <td>${Number(row.successRate || 0).toFixed(1)}%</td>
            <td>${Number(row.failure || 0)}</td>
            <td>${Number(row.total || 0)}</td>
          </tr>
        `).join("") : `<tr><td colspan="8">No performance events logged yet.</td></tr>`}
      </tbody>
    </table>
  `;
}

function renderMetricTable(container, rows = [], labelKey = "name", emptyText = "No performance events logged yet.") {
  container.innerHTML = `
    <table class="performance-table">
      <thead>
        <tr>
          <th>Name</th>
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
            <td class="performance-name-cell" title="${escapeHtml(row[labelKey] || row.name || row.operation || row.page || row.role || "-")}">${escapeHtml(row[labelKey] || row.name || row.operation || row.page || row.role || "-")}</td>
            <td><span class="badge ${getStatusClass(row.status)}">${escapeHtml(row.status)}</span></td>
            <td>${formatMs(row.avgDurationMs)}</td>
            <td>${formatMs(row.p95DurationMs)}</td>
            <td>${formatMs(row.maxDurationMs)}</td>
            <td>${Number(row.successRate || 0).toFixed(1)}%</td>
            <td>${Number(row.total || 0)}</td>
          </tr>
        `).join("") : `<tr><td colspan="7">${escapeHtml(emptyText)}</td></tr>`}
      </tbody>
    </table>
  `;
}

function renderEventTable(container, rows = [], emptyText) {
  container.innerHTML = `
    <table class="performance-table">
      <thead>
        <tr>
          <th>Time</th>
          <th>Operation</th>
          <th>Page / Section</th>
          <th>Role</th>
          <th>Status</th>
          <th>Duration</th>
        </tr>
      </thead>
      <tbody>
        ${rows.length ? rows.map((row) => `
          <tr>
            <td>${formatDate(row.createdAt)}</td>
            <td class="performance-name-cell" title="${escapeHtml(row.operation || row.route || row.page || "-")}">${escapeHtml(row.operation || row.route || row.page || "-")}</td>
            <td class="performance-name-cell" title="${escapeHtml([row.page, row.section, row.subsection, row.phase].filter(Boolean).join(" / ") || "-")}">${escapeHtml([row.page, row.section, row.subsection, row.phase].filter(Boolean).join(" / ") || "-")}</td>
            <td>${escapeHtml(row.role || "-")}</td>
            <td>${escapeHtml(row.status || (row.success === false ? "failure" : "success"))}</td>
            <td>${formatMs(row.durationMs)}</td>
          </tr>
        `).join("") : `<tr><td colspan="6">${escapeHtml(emptyText)}</td></tr>`}
      </tbody>
    </table>
  `;
}

async function renderPerformanceDashboard() {
  try {
    const summary = await loadPerformanceSummary();
    latestPerformanceSummary = summary;
    renderSummary(summary);
    renderTrendCharts(summary);
    renderOperations(summary.operations || []);
    renderMetricTable(pagesTable, summary.pages || [], "page", "No page experience events logged yet.");
    renderMetricTable(rolesTable, summary.roles || [], "role", "No role events logged yet.");
    renderMetricTable(sectionsTable, summary.sections || [], "name", "No section events logged yet.");
    renderMetricTable(phasesTable, summary.phases || [], "name", "No phase events logged yet.");
    renderEventTable(slowEvents, summary.slowEvents || [], "No slow events logged yet.");
    renderEventTable(failures, summary.recentFailures || [], "No failures logged yet.");
  } catch (error) {
    summaryCards.innerHTML = `<article class="performance-card"><strong>Unable to load</strong><span>${escapeHtml(error.message)}</span></article>`;
    operationsTable.innerHTML = "";
    pagesTable.innerHTML = "";
    rolesTable.innerHTML = "";
    sectionsTable.innerHTML = "";
    phasesTable.innerHTML = "";
    slowEvents.innerHTML = "";
    failures.innerHTML = "";
    renderTrendCharts({ trends: [] });
  }
}

await renderPerformanceDashboard();
window.__dvMarkRouteViewReady?.();
const refreshTimer = window.setInterval(() => {
  void renderPerformanceDashboard();
}, 30000);
const handleChartResize = () => {
  if (latestPerformanceSummary) {
    renderTrendCharts(latestPerformanceSummary);
  }
};
window.addEventListener("resize", handleChartResize);
registerPageCleanup(() => {
  window.clearInterval(refreshTimer);
  window.removeEventListener("resize", handleChartResize);
});
