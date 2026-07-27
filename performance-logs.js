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
  summaryCards.innerHTML = `
    <article class="performance-card">
      <span class="performance-card__label">CRM Speed</span>
      <strong>${escapeHtml(summary.status || "Good")}</strong>
      <span>${formatMs(summary.avgDurationMs)} average</span>
    </article>
    <article class="performance-card">
      <span class="performance-card__label">Reliability</span>
      <strong>${Number(summary.successRate || 100).toFixed(1)}%</strong>
      <span>successful events</span>
    </article>
    <article class="performance-card">
      <span class="performance-card__label">Events Logged</span>
      <strong>${Number(summary.totalEvents || 0)}</strong>
      <span>${escapeHtml(summary.windowLabel || "Last 14 days")}</span>
    </article>
    <article class="performance-card">
      <span class="performance-card__label">Slowest Operation</span>
      <strong>${escapeHtml(summary.operations?.[0]?.operation || "-")}</strong>
      <span>${formatMs(summary.operations?.[0]?.avgDurationMs || 0)} average</span>
    </article>
  `;

  windowLabel.textContent = `${summary.windowLabel || "Last 14 days"} - generated ${formatDate(summary.generatedAt)}`;
}

function renderOperations(rows = []) {
  operationsTable.innerHTML = `
    <table>
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
            <td>${escapeHtml(row.operation)}</td>
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

function renderEventTable(container, rows = [], emptyText) {
  container.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Time</th>
          <th>Operation</th>
          <th>Status</th>
          <th>Duration</th>
        </tr>
      </thead>
      <tbody>
        ${rows.length ? rows.map((row) => `
          <tr>
            <td>${formatDate(row.createdAt)}</td>
            <td>${escapeHtml(row.operation || row.route || row.page || "-")}</td>
            <td>${escapeHtml(row.status || (row.success === false ? "failure" : "success"))}</td>
            <td>${formatMs(row.durationMs)}</td>
          </tr>
        `).join("") : `<tr><td colspan="4">${escapeHtml(emptyText)}</td></tr>`}
      </tbody>
    </table>
  `;
}

async function renderPerformanceDashboard() {
  try {
    const summary = await loadPerformanceSummary();
    renderSummary(summary);
    renderOperations(summary.operations || []);
    renderEventTable(slowEvents, summary.slowEvents || [], "No slow events logged yet.");
    renderEventTable(failures, summary.recentFailures || [], "No failures logged yet.");
  } catch (error) {
    summaryCards.innerHTML = `<article class="performance-card"><strong>Unable to load</strong><span>${escapeHtml(error.message)}</span></article>`;
    operationsTable.innerHTML = "";
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
