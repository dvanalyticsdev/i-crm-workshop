import { bootstrapLocalState, getSession } from "./state-sync.js";
import { apiUrl } from "./api-client.js";
import { toKolkataDateKey } from "./date-utils.js";

await bootstrapLocalState({ skipStateRefresh: true });

const session = getSession();
if (!session || !["super_admin", "admin", "marketing"].includes(session.role)) {
  window.location.href = "index.html";
  throw new Error("Access required.");
}

const integrationSectionNav = document.getElementById("integrationSectionNav");
const timelineSelect = document.getElementById("inflowTimeline");
const startDateInput = document.getElementById("inflowStartDate");
const endDateInput = document.getElementById("inflowEndDate");
const sourceFilter = document.getElementById("inflowSourceFilter");
const campaignFilter = document.getElementById("inflowCampaignFilter");
const workshopNameFilter = document.getElementById("inflowWorkshopNameFilter");
const workshopDateFilter = document.getElementById("inflowWorkshopDateFilter");
const courseNameFilter = document.getElementById("inflowCourseNameFilter");
const workshopNameFilterWrap = document.getElementById("inflowWorkshopNameFilterWrap");
const workshopDateFilterWrap = document.getElementById("inflowWorkshopDateFilterWrap");
const courseNameFilterWrap = document.getElementById("inflowCourseNameFilterWrap");
const refreshButton = document.getElementById("refreshInflowBtn");
const resetButton = document.getElementById("resetInflowBtn");
const clearInflowDataButton = document.getElementById("clearInflowDataBtn");
const message = document.getElementById("leadInflowMessage");
const kpiWrap = document.getElementById("leadInflowKpis");
const sourceRows = document.getElementById("leadInflowSourceRows");
const dayRows = document.getElementById("leadInflowDayRows");

let activeSection = "workshop";
let currentReport = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderIntegrationSectionNav(activeRoute = "lead-inflow.html") {
  if (!integrationSectionNav) return;
  const sections = [
    ["meta-integration.html", "Meta", "Manage Facebook and Instagram lead capture, webhook setup, and lead filters."],
    ["elementor-integration.html", "Elementor", "Manage Elementor webhook intake, form rules, and lead classification."],
    ["lead-flow-control.html", "Lead Flow Control", "Manage workshop counselor rotation for Meta and Elementor leads."],
    ["lead-inflow.html", "Lead Inflow", "Track incoming CRM leads by source, campaign, day, and duplicate inflow."],
    ["mcube-integration.html", "MCUBE", "Manage cloud telephony calling, webhook intake, click-to-call, and CRM call sync."]
  ];

  integrationSectionNav.innerHTML = `
    <div class="card-head">
      <h3>Integration Subsections</h3>
      <p>Use this section to switch between lead sources, routing, inflow reporting, and calling integrations.</p>
    </div>
    <div class="filter-actions" style="display:flex;gap:0.75rem;flex-wrap:wrap;">
      ${sections.map(([route, label]) => `
        <button type="button" class="${activeRoute === route ? "btn-primary" : "btn-ghost"}" data-integration-section="${route}">
          ${escapeHtml(label)}
        </button>
      `).join("")}
    </div>
    <p class="block-help">${escapeHtml(sections.find(([route]) => route === activeRoute)?.[2] || "")}</p>
  `;

  integrationSectionNav.querySelectorAll("[data-integration-section]").forEach((button) => {
    button.addEventListener("click", () => {
      const route = button.getAttribute("data-integration-section");
      if (!route || route === window.location.pathname.split("/").pop()) return;
      if (typeof window.__dvNavigateToRoute === "function") {
        void window.__dvNavigateToRoute(route);
        return;
      }
      window.location.href = route;
    });
  });
}

function setMessage(text, isError = false) {
  message.textContent = text || "";
  message.style.color = isError ? "var(--danger)" : "var(--text-muted)";
}

function setTodayDefaults() {
  const today = toKolkataDateKey();
  startDateInput.value = today;
  endDateInput.value = today;
}

function updateCustomDateState() {
  const isCustom = timelineSelect.value === "custom";
  startDateInput.disabled = !isCustom;
  endDateInput.disabled = !isCustom;
}

function syncSectionTabs() {
  document.querySelectorAll("[data-inflow-section]").forEach((button) => {
    const selected = button.getAttribute("data-inflow-section") === activeSection;
    button.className = selected ? "btn-primary" : "btn-ghost";
    button.setAttribute("aria-selected", selected ? "true" : "false");
  });
  const isAdmission = activeSection === "admission";
  workshopNameFilterWrap?.classList.toggle("hidden", isAdmission);
  workshopDateFilterWrap?.classList.toggle("hidden", isAdmission);
  courseNameFilterWrap?.classList.toggle("hidden", !isAdmission);
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-IN").format(Number(value) || 0);
}

function renderKpis(metrics = {}) {
  const cards = [
    ["Total Inflow", formatNumber(metrics.totalLeads)],
    ["Unique Leads", formatNumber(metrics.uniqueLeads)],
    ["Duplicate Leads", formatNumber(metrics.duplicateLeads)],
    ["Duplicate %", `${Number(metrics.duplicateRate || 0).toFixed(1)}%`],
    ["Top Source", metrics.topSource || "-"],
    ["Highest Inflow Day", metrics.topDay || "-"]
  ];

  kpiWrap.innerHTML = cards.map(([label, value]) => `
    <article class="card kpi-card">
      <p>${escapeHtml(label)}</p>
      <h2>${escapeHtml(value)}</h2>
    </article>
  `).join("");
}

function renderEmptyRow(target, colspan, text) {
  target.innerHTML = `<tr><td colspan="${colspan}" class="empty-table-cell">${escapeHtml(text)}</td></tr>`;
}

function renderRows(report = {}) {
  const sourceData = Array.isArray(report.sourceRows) ? report.sourceRows : [];
  const dayData = Array.isArray(report.dayRows) ? report.dayRows : [];

  if (!sourceData.length) {
    renderEmptyRow(sourceRows, 6, "No source inflow found for the selected filters.");
  } else {
    sourceRows.innerHTML = sourceData.map((row) => `
      <tr>
        <td>${escapeHtml(row.source)}</td>
        <td>${escapeHtml(row.campaign)}</td>
        <td>${formatNumber(row.totalLeads)}</td>
        <td>${formatNumber(row.uniqueLeads)}</td>
        <td>${formatNumber(row.duplicateLeads)}</td>
        <td>${Number(row.duplicateRate || 0).toFixed(1)}%</td>
      </tr>
    `).join("");
  }

  if (!dayData.length) {
    renderEmptyRow(dayRows, 7, "No day-wise inflow found for the selected filters.");
  } else {
    dayRows.innerHTML = dayData.map((row) => `
      <tr>
        <td>${escapeHtml(row.date)}</td>
        <td>${escapeHtml(row.source)}</td>
        <td>${escapeHtml(row.campaign)}</td>
        <td>${formatNumber(row.totalLeads)}</td>
        <td>${formatNumber(row.uniqueLeads)}</td>
        <td>${formatNumber(row.duplicateLeads)}</td>
        <td>${Number(row.duplicateRate || 0).toFixed(1)}%</td>
      </tr>
    `).join("");
  }
}

function syncSelectOptions(select, values = [], allLabel) {
  if (!select) return;
  const previous = select.value || "all";
  select.innerHTML = `
    <option value="all">${escapeHtml(allLabel)}</option>
    ${values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}
  `;
  select.value = [...values, "all"].includes(previous) ? previous : "all";
}

function buildReportUrl(includeFilters = true) {
  const url = new URL(apiUrl("/api/lead-inflow-report"), window.location.origin);
  url.searchParams.set("section", activeSection);
  url.searchParams.set("timelineType", timelineSelect.value);
  if (timelineSelect.value === "custom") {
    url.searchParams.set("startDate", startDateInput.value);
    url.searchParams.set("endDate", endDateInput.value || startDateInput.value);
  }
  if (includeFilters) {
    url.searchParams.set("source", sourceFilter.value || "all");
    url.searchParams.set("campaign", campaignFilter.value || "all");
    if (activeSection === "admission") {
      url.searchParams.set("courseName", courseNameFilter.value || "all");
    } else {
      url.searchParams.set("workshopName", workshopNameFilter.value || "all");
      url.searchParams.set("workshopDate", workshopDateFilter.value || "all");
    }
  }
  return url;
}

function resetSectionFilters() {
  sourceFilter.value = "all";
  campaignFilter.value = "all";
  if (workshopNameFilter) workshopNameFilter.value = "all";
  if (workshopDateFilter) workshopDateFilter.value = "all";
  if (courseNameFilter) courseNameFilter.value = "all";
}

async function loadReport({ preserveFilters = true } = {}) {
  setMessage("Loading lead inflow...");
  refreshButton.disabled = true;
  try {
    const response = await fetch(buildReportUrl(preserveFilters).toString(), {
      credentials: "same-origin",
      headers: { Accept: "application/json" }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) {
      throw new Error(payload?.message || "Could not load lead inflow.");
    }
    currentReport = payload;
    syncSelectOptions(sourceFilter, payload.filters?.sources || [], "All Sources");
    syncSelectOptions(campaignFilter, payload.filters?.campaigns || [], "All Campaigns");
    syncSelectOptions(workshopNameFilter, payload.filters?.workshopNames || [], "Use Filter");
    syncSelectOptions(workshopDateFilter, payload.filters?.workshopDates || [], "Use Filter");
    syncSelectOptions(courseNameFilter, payload.filters?.courseNames || [], "All Courses");
    if (!preserveFilters) {
      resetSectionFilters();
    }
    renderKpis(payload.metrics || {});
    renderRows(payload);
    setMessage(`Showing ${activeSection === "admission" ? "admission" : "workshop"} lead inflow.`);
  } catch (error) {
    currentReport = null;
    renderKpis({});
    renderEmptyRow(sourceRows, 6, "Could not load source inflow.");
    renderEmptyRow(dayRows, 7, "Could not load day-wise inflow.");
    setMessage(error.message || "Could not load lead inflow.", true);
  } finally {
    refreshButton.disabled = false;
  }
}

async function clearInflowData() {
  if (session?.role !== "super_admin" || !clearInflowDataButton) return;
  const confirmed = window.confirm("Clear all saved Lead Inflow data? CRM leads and lead activity records will not be deleted.");
  if (!confirmed) return;

  setMessage("Clearing lead inflow data...");
  clearInflowDataButton.disabled = true;
  try {
    const response = await fetch(apiUrl("/api/lead-inflow-report"), {
      method: "DELETE",
      credentials: "same-origin",
      headers: { Accept: "application/json" }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) {
      throw new Error(payload?.message || "Could not clear lead inflow data.");
    }
    await loadReport({ preserveFilters: false });
    setMessage(`Cleared ${formatNumber(payload.deletedCount)} saved inflow records. CRM leads and activity records were kept.`);
  } catch (error) {
    setMessage(error.message || "Could not clear lead inflow data.", true);
  } finally {
    clearInflowDataButton.disabled = false;
  }
}

function bindEvents() {
  document.querySelectorAll("[data-inflow-section]").forEach((button) => {
    button.addEventListener("click", () => {
      activeSection = button.getAttribute("data-inflow-section") === "admission" ? "admission" : "workshop";
      syncSectionTabs();
      resetSectionFilters();
      void loadReport({ preserveFilters: false });
    });
  });

  timelineSelect.addEventListener("change", () => {
    updateCustomDateState();
    resetSectionFilters();
    void loadReport({ preserveFilters: false });
  });
  startDateInput.addEventListener("change", () => void loadReport());
  endDateInput.addEventListener("change", () => void loadReport());
  sourceFilter.addEventListener("change", () => void loadReport());
  campaignFilter.addEventListener("change", () => void loadReport());
  workshopNameFilter?.addEventListener("change", () => void loadReport());
  workshopDateFilter?.addEventListener("change", () => void loadReport());
  courseNameFilter?.addEventListener("change", () => void loadReport());
  refreshButton.addEventListener("click", () => void loadReport());
  clearInflowDataButton?.addEventListener("click", () => void clearInflowData());
  resetButton.addEventListener("click", () => {
    activeSection = "workshop";
    timelineSelect.value = "today";
    setTodayDefaults();
    updateCustomDateState();
    syncSectionTabs();
    resetSectionFilters();
    void loadReport({ preserveFilters: false });
  });
}

renderIntegrationSectionNav();
setTodayDefaults();
updateCustomDateState();
syncSectionTabs();
bindEvents();
void loadReport({ preserveFilters: false });
