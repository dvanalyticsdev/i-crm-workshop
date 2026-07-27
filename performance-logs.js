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
const slowEvents = document.getElementById("performanceSlowEvents");
const failures = document.getElementById("performanceFailures");

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
    renderSummary(summary);
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
  }
}

await renderPerformanceDashboard();
window.__dvMarkRouteViewReady?.();
const refreshTimer = window.setInterval(() => {
  void renderPerformanceDashboard();
}, 30000);
registerPageCleanup(() => window.clearInterval(refreshTimer));
