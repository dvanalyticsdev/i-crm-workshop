import { registerPageCleanup } from "./page-runtime.js";
import { apiUrl } from "./api-client.js";
import { acceptServerState, bootstrapLocalState, getCounselors, getLeads as getStoredLeads, getSession, loadLocalPreference, saveLeads as persistLeads, saveLocalPreference, startStatePolling } from "./state-sync.js";
import { openActivityHistory } from "./activity-history.js";

await bootstrapLocalState();

const lostKpiSection = document.getElementById("lostKpiSection");
const lostSubsectionButtons = document.getElementById("lostSubsectionButtons");
const lostLeadCard = document.getElementById("lostLeadCard");
const lostLeadTableSection = document.getElementById("lostLeadTableSection");
const lostLeadPagination = document.getElementById("lostLeadPagination");
const archivedLeadSection = document.getElementById("archivedLeadSection");
const archivedLeadTableSection = document.getElementById("archivedLeadTableSection");
const archivedLeadPagination = document.getElementById("archivedLeadPagination");
const lostSearchInput = document.getElementById("lostSearchInput");
const lostCourseFilter = document.getElementById("lostCourseFilter");
const resetLostSearch = document.getElementById("resetLostSearch");
const deleteAllLostLeadsBtn = document.getElementById("deleteAllLostLeadsBtn");
const deleteAllArchivedLeadsBtn = document.getElementById("deleteAllArchivedLeadsBtn");

const session = getSession();
const SEARCH_STORAGE_KEY = "dvWorkshopLostLeadSearch";
const PAGE_SIZE = 100;

let searchQuery = String(await loadLocalPreference(SEARCH_STORAGE_KEY, "") || "");
let archivedLeads = [];
let archivedLeadTotalCount = 0;
let activeSubsection = "lost";
let lostPage = 1;
let archivedPage = 1;
let selectedCourseFilter = "all";
let bulkDeleteInFlight = false;

if (lostSearchInput) {
  lostSearchInput.value = searchQuery;
}

function isCounselorSession() {
  return session?.role === "counselor";
}

function canViewArchivedLeads() {
  return !isCounselorSession();
}

function isSuperAdminSession() {
  return session?.role === "super_admin";
}

function getCounselorIdentity() {
  if (!isCounselorSession()) {
    return "";
  }

  const sessionName = String(session?.name || "").trim().toLowerCase();
  const sessionEmail = String(session?.email || "").trim().toLowerCase();
  const counselors = getCounselors();
  const match = counselors.find(
    (item) => String(item.email || "").trim().toLowerCase() === sessionEmail
  );

  return String(match?.name || session?.name || "").trim().toLowerCase() || sessionName;
}

function persistSearchQuery() {
  void saveLocalPreference(SEARCH_STORAGE_KEY, searchQuery);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function toLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getScopedLeads(allLeads) {
  if (!isCounselorSession()) {
    return allLeads;
  }

  const counselorName = getCounselorIdentity();
  if (!counselorName) {
    return [];
  }

  return allLeads.filter(
    (lead) => String(lead.counselor || "").trim().toLowerCase() === counselorName
  );
}

function normalizeLeadFields(leads) {
  leads.forEach((lead) => {
    lead.name = lead.name || "";
    lead.email = (lead.email || "").toLowerCase();
    lead.workshop = lead.workshop || "";
    lead.createdAt = lead.createdAt || toLocalDateKey();

    lead.dialed = lead.dialed || "";
    lead.callStatus = lead.callStatus || "";
    lead.wsStatus = lead.wsStatus || "";
    lead.whatsappInvite = lead.whatsappInvite || "";
    lead.counselor = lead.counselor || "Unassigned";

    lead.postDialed = lead.postDialed || "";
    lead.coursePitched = lead.coursePitched || "";
    lead.courseStatus = lead.courseStatus || "";
    lead.admissionStatus = lead.admissionStatus || "";
    lead.postStatusUpdated = typeof lead.postStatusUpdated === "boolean" ? lead.postStatusUpdated : false;
    lead.courseName = lead.courseName || "";
    lead.registeredCourseStatus = lead.registeredCourseStatus || "";
    lead.registeredAdmissionStatus = lead.registeredAdmissionStatus || "";
    lead.registeredActivityUpdated = typeof lead.registeredActivityUpdated === "boolean" ? lead.registeredActivityUpdated : false;
    lead.mainAdmissionCourseStatus = lead.mainAdmissionCourseStatus || "";
    lead.mainAdmissionAdmissionStatus = lead.mainAdmissionAdmissionStatus || "";
    lead.mainAdmissionActivityUpdated = typeof lead.mainAdmissionActivityUpdated === "boolean" ? lead.mainAdmissionActivityUpdated : false;
    lead.workshopActivityHistory = Array.isArray(lead.workshopActivityHistory) ? lead.workshopActivityHistory : [];
    lead.admissionActivityHistory = Array.isArray(lead.admissionActivityHistory) ? lead.admissionActivityHistory : [];
    lead.registeredCourseActivityHistory = Array.isArray(lead.registeredCourseActivityHistory) ? lead.registeredCourseActivityHistory : [];
    lead.mainAdmissionActivityHistory = Array.isArray(lead.mainAdmissionActivityHistory) ? lead.mainAdmissionActivityHistory : [];
    lead.preActivityUpdates = lead.workshopActivityHistory.length
      || (Number.isFinite(Number(lead.preActivityUpdates)) ? Number(lead.preActivityUpdates) : 0);
    lead.postActivityUpdates = lead.admissionActivityHistory.length
      || (Number.isFinite(Number(lead.postActivityUpdates)) ? Number(lead.postActivityUpdates) : 0);
    lead.registeredCourseActivityUpdates = lead.registeredCourseActivityHistory.length
      || (Number.isFinite(Number(lead.registeredCourseActivityUpdates)) ? Number(lead.registeredCourseActivityUpdates) : 0);
    lead.mainAdmissionActivityUpdates = lead.mainAdmissionActivityHistory.length
      || (Number.isFinite(Number(lead.mainAdmissionActivityUpdates)) ? Number(lead.mainAdmissionActivityUpdates) : 0);
    lead.whatsappGroupStatus = lead.whatsappGroupStatus || "";
    lead.leadNotes = Array.isArray(lead.leadNotes) ? lead.leadNotes : [];
  });
}

function getAllLeads() {
  const leads = getStoredLeads();
  normalizeLeadFields(leads);
  return leads;
}

function saveAllLeads(leads) {
  return persistLeads(leads);
}

function normalizeCourseFilterValue(value) {
  const raw = String(value || "").trim();
  return raw || "all";
}

function getCourseFilterLabel(value) {
  return normalizeCourseFilterValue(value) === "all"
    ? "all course names"
    : String(value || "").trim();
}

function getAvailableSubsections() {
  return canViewArchivedLeads()
    ? [
        { key: "lost", label: "Lost Leads", help: "Review active lost leads that can still be restored." },
        { key: "archived", label: "Archived Leads", help: "Review archived leads in compact 100-row pages." }
      ]
    : [
        { key: "lost", label: "Lost Leads", help: "Review active lost leads that can still be restored." }
      ];
}

function clampPage(page, totalItems) {
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  return Math.min(Math.max(Number(page) || 1, 1), totalPages);
}

function getPageSlice(rows = [], page = 1) {
  const safePage = clampPage(page, rows.length);
  const startIndex = (safePage - 1) * PAGE_SIZE;
  return {
    page: safePage,
    totalPages: Math.max(1, Math.ceil(rows.length / PAGE_SIZE)),
    totalItems: rows.length,
    rows: rows.slice(startIndex, startIndex + PAGE_SIZE),
    startIndex: rows.length ? startIndex + 1 : 0,
    endIndex: Math.min(startIndex + PAGE_SIZE, rows.length)
  };
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });

    const contentType = response.headers.get("content-type") || "";
    const json = contentType.includes("application/json")
      ? await response.json().catch(() => null)
      : null;

    return { response, json };
  } finally {
    clearTimeout(timeoutId);
  }
}

function notifyDeletePermissionDenied() {
  window.alert("Only super admin can delete lost or archived leads.");
}

function setBulkDeleteButtonState(isBusy) {
  [deleteAllLostLeadsBtn, deleteAllArchivedLeadsBtn].forEach((button) => {
    if (!button) {
      return;
    }

    if (!button.dataset.defaultLabel) {
      button.dataset.defaultLabel = button.textContent || "";
    }

    button.disabled = isBusy;
    button.textContent = isBusy ? "Deleting..." : button.dataset.defaultLabel;
  });
}

async function restoreLead(leadId) {
  const allLeads = getAllLeads();
  const index = allLeads.findIndex((lead) => String(lead.id) === String(leadId));
  if (index === -1) {
    return;
  }

  const restoreTarget = getLostSource(allLeads[index]);
  const confirmed = window.confirm(`Restore this lead back to ${restoreTarget}?`);
  if (!confirmed) {
    return;
  }

  const lead = allLeads[index];
  const pipeline = String(lead?.leadPipeline || "").trim().toLowerCase();

  if (pipeline === "main-admission") {
    allLeads[index] = {
      ...lead,
      mainAdmissionCourseStatus: "",
      mainAdmissionActivityUpdated: false
    };
  } else if (pipeline === "course-registration") {
    allLeads[index] = {
      ...lead,
      registeredCourseStatus: "",
      registeredActivityUpdated: false
    };
  } else if (lead.wsStatus === "Not Interested") {
    allLeads[index] = {
      ...lead,
      wsStatus: ""
    };
  } else {
    allLeads[index] = {
      ...lead,
      courseStatus: "",
      postStatusUpdated: false
    };
  }

  const restoreResult = await saveAllLeads(allLeads);
  if (!restoreResult || restoreResult.ok === false) {
    window.alert("Failed to restore lead. Please check your connection and try again.");
    return;
  }
  renderAll();
}

async function deleteLostLead(leadId, leadName = "") {
  if (!isSuperAdminSession()) {
    notifyDeletePermissionDenied();
    return;
  }

  const confirmed = window.confirm(`Delete ${leadName || "this lost lead"} permanently? This cannot be undone.`);
  if (!confirmed) {
    return;
  }

  try {
    const { response, json } = await fetchJsonWithTimeout(apiUrl(`/api/lost-leads/${encodeURIComponent(String(leadId || "").trim())}`), {
      method: "DELETE",
      headers: { Accept: "application/json" }
    }, 15000);

    if (!response.ok || !json?.ok) {
      window.alert(json?.message || "Failed to delete lost lead.");
      return;
    }

    if (json?.state) {
      acceptServerState(json.state, response.headers.get("etag"));
    }

    await refreshArchivedLeads();
    renderAll();
  } catch (error) {
    window.alert(error?.name === "AbortError"
      ? "Deleting the lost lead timed out. Please try again."
      : "Could not delete the lost lead. Please check your connection and try again.");
  }
}

async function deleteArchivedLead(archiveId, leadName = "") {
  if (!isSuperAdminSession()) {
    notifyDeletePermissionDenied();
    return;
  }

  const confirmed = window.confirm(`Delete ${leadName || "this archived lead"} permanently? This cannot be undone.`);
  if (!confirmed) {
    return;
  }

  try {
    const { response, json } = await fetchJsonWithTimeout(apiUrl(`/api/lost-leads/archive/${encodeURIComponent(String(archiveId || "").trim())}`), {
      method: "DELETE",
      headers: { Accept: "application/json" }
    }, 15000);

    if (!response.ok || !json?.ok) {
      window.alert(json?.message || "Failed to delete archived lead.");
      return;
    }

    archivedLeads = archivedLeads.filter((lead) => String(lead?._id || "") !== String(archiveId || ""));
    archivedLeadTotalCount = Math.max(0, archivedLeadTotalCount - 1);
    renderAll();
  } catch (error) {
    window.alert(error?.name === "AbortError"
      ? "Deleting the archived lead timed out. Please try again."
      : "Could not delete the archived lead. Please check your connection and try again.");
  }
}

async function deleteAllLostLeads() {
  if (!isSuperAdminSession()) {
    notifyDeletePermissionDenied();
    return;
  }

  if (bulkDeleteInFlight) {
    return;
  }

  const courseName = normalizeCourseFilterValue(selectedCourseFilter);
  const scopeLabel = courseName === "all"
    ? "all lost leads"
    : `all lost leads for ${courseName}`;
  const confirmed = window.confirm(`Delete ${scopeLabel} permanently? This cannot be undone.`);
  if (!confirmed) {
    return;
  }

  bulkDeleteInFlight = true;
  setBulkDeleteButtonState(true);

  try {
    const query = courseName === "all" ? "" : `?courseName=${encodeURIComponent(courseName)}`;
    const { response, json } = await fetchJsonWithTimeout(apiUrl(`/api/lost-leads${query}`), {
      method: "DELETE",
      headers: { Accept: "application/json" }
    }, 20000);

    if (!response.ok || !json?.ok) {
      window.alert(json?.message || "Failed to delete lost leads.");
      return;
    }

    if (json?.state) {
      acceptServerState(json.state, response.headers.get("etag"));
    }

    await refreshArchivedLeads();
    lostPage = 1;
    renderAll();
  } catch (error) {
    window.alert(error?.name === "AbortError"
      ? "Deleting lost leads timed out. Please try again."
      : "Could not delete lost leads. Please check your connection and try again.");
  } finally {
    bulkDeleteInFlight = false;
    setBulkDeleteButtonState(false);
  }
}

async function deleteAllArchivedLeads() {
  if (!isSuperAdminSession()) {
    notifyDeletePermissionDenied();
    return;
  }

  if (bulkDeleteInFlight) {
    return;
  }

  const courseName = normalizeCourseFilterValue(selectedCourseFilter);
  const scopeLabel = courseName === "all"
    ? "all archived leads"
    : `all archived leads for ${courseName}`;
  const confirmed = window.confirm(`Delete ${scopeLabel} permanently? This cannot be undone.`);
  if (!confirmed) {
    return;
  }

  bulkDeleteInFlight = true;
  setBulkDeleteButtonState(true);

  try {
    const query = courseName === "all" ? "" : `?courseName=${encodeURIComponent(courseName)}`;
    const { response, json } = await fetchJsonWithTimeout(apiUrl(`/api/lost-leads/archive${query}`), {
      method: "DELETE",
      headers: { Accept: "application/json" }
    }, 20000);

    if (!response.ok || !json?.ok) {
      window.alert(json?.message || "Failed to delete archived leads.");
      return;
    }

    const deletedCourseName = normalizeCourseFilterValue(courseName);
    archivedLeads = deletedCourseName === "all"
      ? []
      : archivedLeads.filter((lead) => String(lead?.courseName || "").trim() !== deletedCourseName);
    archivedLeadTotalCount = deletedCourseName === "all"
      ? 0
      : Math.max(0, archivedLeadTotalCount - (Number(json?.deletedCount) || 0));
    archivedPage = 1;
    renderAll();
  } catch (error) {
    window.alert(error?.name === "AbortError"
      ? "Deleting archived leads timed out. Please try again."
      : "Could not delete archived leads. Please check your connection and try again.");
  } finally {
    bulkDeleteInFlight = false;
    setBulkDeleteButtonState(false);
  }
}

function isLostLead(lead) {
  const pipeline = String(lead?.leadPipeline || "").trim().toLowerCase();

  if (pipeline === "main-admission") {
    return lead.mainAdmissionActivityUpdated && lead.mainAdmissionCourseStatus === "Not Interested";
  }

  if (pipeline === "course-registration") {
    return lead.registeredActivityUpdated && lead.registeredCourseStatus === "Not Interested";
  }

  return lead.wsStatus === "Not Interested"
    || (lead.postStatusUpdated && lead.courseStatus === "Not Interested");
}

function getLostSource(lead) {
  const pipeline = String(lead?.leadPipeline || "").trim().toLowerCase();

  if (pipeline === "main-admission" && lead.mainAdmissionActivityUpdated && lead.mainAdmissionCourseStatus === "Not Interested") {
    return "Main Admission Leads";
  }

  if (pipeline === "course-registration" && lead.registeredActivityUpdated && lead.registeredCourseStatus === "Not Interested") {
    return String(lead.publicCourseSegment || "").trim().toLowerCase() === "crash-course"
      ? "7-Day Crash Course"
      : "Registered Candidates";
  }

  if (lead.wsStatus === "Not Interested") {
    return "Workshop Calling";
  }

  if (lead.postStatusUpdated && lead.courseStatus === "Not Interested") {
    return "Admission Calling";
  }

  return "Unknown";
}

function getLostProgramName(lead) {
  const pipeline = String(lead?.leadPipeline || "").trim().toLowerCase();
  if (pipeline === "main-admission" || pipeline === "course-registration") {
    return String(lead.courseName || lead.courseCode || "").trim() || "-";
  }
  return String(lead.workshop || "").trim() || "-";
}

async function refreshArchivedLeads() {
  if (!archivedLeadTableSection || !canViewArchivedLeads()) {
    archivedLeads = [];
    archivedLeadTotalCount = 0;
    return;
  }

  try {
    const { response, json } = await fetchJsonWithTimeout(apiUrl("/api/lost-leads/archive?limit=10000"), {
      method: "GET",
      headers: { Accept: "application/json" }
    }, 15000);

    if (!response.ok || !json?.ok) {
      archivedLeads = [];
      archivedLeadTotalCount = 0;
      return;
    }

    if (json?.state) {
      acceptServerState(json.state, response.headers.get("etag"));
    }

    archivedLeads = Array.isArray(json?.rows) ? json.rows : [];
    archivedLeadTotalCount = Number.isFinite(Number(json?.totalCount))
      ? Number(json.totalCount)
      : archivedLeads.length;
  } catch {
    archivedLeads = [];
    archivedLeadTotalCount = 0;
  }
}

function renderKpi(lostLeads, archivedRows) {
  lostKpiSection.innerHTML = `
    <article class="card kpi-card">
      <p>Active Lost Leads</p>
      <h2>${lostLeads.length}</h2>
    </article>
    <article class="card kpi-card">
      <p>Archived Leads</p>
      <h2>${archivedLeadTotalCount}</h2>
    </article>
  `;
}

function renderCourseFilterOptions(lostLeads, archivedRows) {
  if (!lostCourseFilter) {
    return;
  }

  const courseNames = [...new Set([
    ...lostLeads.map((lead) => getLostProgramName(lead)),
    ...archivedRows.map((lead) => String(lead?.courseName || "").trim())
  ].map((value) => String(value || "").trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));

  const nextValue = courseNames.includes(selectedCourseFilter) ? selectedCourseFilter : "all";
  lostCourseFilter.innerHTML = [
    `<option value="all">All course names</option>`,
    ...courseNames.map((courseName) => `<option value="${escapeHtml(courseName)}">${escapeHtml(courseName)}</option>`)
  ].join("");
  lostCourseFilter.value = nextValue;
  selectedCourseFilter = nextValue;
}

function renderSubsectionNav() {
  if (!lostSubsectionButtons) {
    return;
  }

  const subsections = getAvailableSubsections();
  if (!subsections.some((item) => item.key === activeSubsection)) {
    activeSubsection = "lost";
  }

  lostSubsectionButtons.innerHTML = subsections.map((section) => `
    <button
      type="button"
      class="${section.key === activeSubsection ? "btn-primary" : "btn-ghost"}"
      data-lost-subsection="${escapeHtml(section.key)}"
    >${escapeHtml(section.label)}</button>
  `).join("");

  lostSubsectionButtons.querySelectorAll("[data-lost-subsection]").forEach((button) => {
    button.onclick = () => {
      const nextSection = String(button.getAttribute("data-lost-subsection") || "lost").trim();
      activeSubsection = nextSection === "archived" && canViewArchivedLeads() ? "archived" : "lost";
      renderSectionVisibility();
      renderAll();
    };
  });
}

function renderSectionVisibility() {
  const showArchived = activeSubsection === "archived" && canViewArchivedLeads();
  if (lostLeadCard) {
    lostLeadCard.hidden = showArchived;
  }
  if (archivedLeadSection) {
    archivedLeadSection.hidden = !showArchived;
  }
}

function renderPagination(container, pageData, sectionKey) {
  if (!container) {
    return;
  }

  if (!pageData.totalItems) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = `
    <div class="table-footer" style="display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap;padding-top:1rem;">
      <p class="block-help" style="margin:0;">Showing ${pageData.startIndex}-${pageData.endIndex} of ${pageData.totalItems} leads</p>
      <div style="display:flex;align-items:center;gap:0.75rem;">
        <button type="button" class="btn-ghost" data-page-action="prev" data-page-section="${escapeHtml(sectionKey)}" ${pageData.page <= 1 ? "disabled" : ""}>Previous</button>
        <span class="block-help" style="margin:0;">Page ${pageData.page} of ${pageData.totalPages}</span>
        <button type="button" class="btn-ghost" data-page-action="next" data-page-section="${escapeHtml(sectionKey)}" ${pageData.page >= pageData.totalPages ? "disabled" : ""}>Next</button>
      </div>
    </div>
  `;

  container.querySelectorAll("[data-page-action]").forEach((button) => {
    button.onclick = () => {
      const action = button.getAttribute("data-page-action");
      const targetSection = button.getAttribute("data-page-section");
      if (targetSection === "archived") {
        archivedPage = action === "next" ? archivedPage + 1 : archivedPage - 1;
      } else {
        lostPage = action === "next" ? lostPage + 1 : lostPage - 1;
      }
      renderAll();
    };
  });
}

function renderLostTable(lostLeads) {
  const isAdmin = session?.role === "admin" || session?.role === "super_admin";
  const isSuperAdmin = isSuperAdminSession();
  const pageData = getPageSlice(lostLeads, lostPage);
  lostPage = pageData.page;
  let html = `
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Lead Import Date</th>
            <th>Name</th>
            <th>Phone Number</th>
            <th>Email</th>
            <th>Program</th>
            <th>Counselor</th>
            <th>Lost Stage</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
  `;

  if (!pageData.rows.length) {
    html += `<tr><td colspan="8">No lost leads found.</td></tr>`;
  } else {
    html += pageData.rows
      .map(
        (lead) => `
      <tr>
        <td>${escapeHtml(lead.createdAt)}</td>
        <td>${escapeHtml(lead.name)}</td>
        <td>${escapeHtml(lead.phone || "-")}</td>
        <td>${escapeHtml(lead.email)}</td>
        <td>${escapeHtml(getLostProgramName(lead))}</td>
        <td>${escapeHtml(lead.counselor || "Unassigned")}</td>
        <td>${escapeHtml(getLostSource(lead))}</td>
        <td>
          <div class="activity-panel">
            <button class="btn-ghost btn-activity-history" type="button" data-lead-id="${escapeHtml(lead.id)}" data-lead-email="${escapeHtml(lead.email)}" data-lead-name="${escapeHtml(lead.name)}">Activity History</button>
            ${isAdmin ? `<button class="btn-ghost btn-restore-lead" type="button" data-lead-id="${lead.id}">Restore</button>` : ""}
            ${isSuperAdmin ? `<button class="btn-delete btn-delete-lost-lead" type="button" data-lead-id="${escapeHtml(lead.id)}" data-lead-name="${escapeHtml(lead.name)}">Delete</button>` : ""}
          </div>
        </td>
      </tr>
    `
      )
      .join("");
  }

  html += `</tbody></table></div>`;
  lostLeadTableSection.innerHTML = html;
  renderPagination(lostLeadPagination, pageData, "lost");

  document.querySelectorAll(".btn-activity-history").forEach((button) => {
    button.onclick = () => {
      const leadId = button.getAttribute("data-lead-id");
      const leadEmail = button.getAttribute("data-lead-email");
      const allLeads = getAllLeads();
      const lead = allLeads.find(
        (item) => String(item.id) === String(leadId) || (leadEmail && String(item.email).toLowerCase() === String(leadEmail).toLowerCase())
      );
      if (lead) {
        openActivityHistory(lead.id, lead.name, lead.email);
      }
    };
  });

  if (isAdmin) {
    document.querySelectorAll(".btn-restore-lead").forEach((button) => {
      button.onclick = () => {
        const leadId = button.getAttribute("data-lead-id");
        if (leadId) {
          void restoreLead(leadId);
        }
      };
    });
  }

  if (isSuperAdmin) {
    document.querySelectorAll(".btn-delete-lost-lead").forEach((button) => {
      button.onclick = () => {
        const leadId = button.getAttribute("data-lead-id");
        const leadName = button.getAttribute("data-lead-name") || "";
        if (leadId) {
          void deleteLostLead(leadId, leadName);
        }
      };
    });
  }
}

function renderArchivedTable(rows) {
  if (!archivedLeadTableSection || !canViewArchivedLeads()) {
    return;
  }

  const pageData = getPageSlice(rows, archivedPage);
  archivedPage = pageData.page;
  let html = `
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Phone Number</th>
            <th>Email</th>
            <th>Course Name</th>
            ${isSuperAdminSession() ? "<th>Actions</th>" : ""}
          </tr>
        </thead>
        <tbody>
  `;

  if (!pageData.rows.length) {
    html += `<tr><td colspan="${isSuperAdminSession() ? "5" : "4"}">No archived leads found.</td></tr>`;
  } else {
    html += pageData.rows.map((lead) => `
      <tr>
        <td>${escapeHtml(lead.name || "-")}</td>
        <td>${escapeHtml(lead.phone || "-")}</td>
        <td>${escapeHtml(lead.email || "-")}</td>
        <td>${escapeHtml(lead.courseName || "-")}</td>
        ${isSuperAdminSession() ? `<td><button type="button" class="btn-delete btn-delete-archived-lead" data-archive-id="${escapeHtml(lead._id || "")}" data-lead-name="${escapeHtml(lead.name || "")}">Delete</button></td>` : ""}
      </tr>
    `).join("");
  }

  html += `</tbody></table></div>`;
  archivedLeadTableSection.innerHTML = html;
  renderPagination(archivedLeadPagination, pageData, "archived");

  if (isSuperAdminSession()) {
    archivedLeadTableSection.querySelectorAll(".btn-delete-archived-lead").forEach((button) => {
      button.onclick = () => {
        const archiveId = button.getAttribute("data-archive-id");
        const leadName = button.getAttribute("data-lead-name") || "";
        if (archiveId) {
          void deleteArchivedLead(archiveId, leadName);
        }
      };
    });
  }
}

function renderAll() {
  const allLeads = getAllLeads();
  const scopedLeads = getScopedLeads(allLeads);
  const allLostLeads = scopedLeads.filter((lead) => isLostLead(lead));
  const allArchivedLeads = [...archivedLeads];
  renderCourseFilterOptions(allLostLeads, allArchivedLeads);
  let lostLeads = [...allLostLeads];
  let filteredArchivedLeads = [...allArchivedLeads];

  if (searchQuery) {
    const query = searchQuery.toLowerCase();
    lostLeads = lostLeads.filter((lead) => {
      const haystack = [
        lead.name,
        lead.email,
        lead.phone,
        getLostProgramName(lead),
        lead.counselor
      ]
        .map((value) => String(value || "").toLowerCase())
        .join(" ");

      return haystack.includes(query);
    });

    filteredArchivedLeads = filteredArchivedLeads.filter((lead) => {
      const haystack = [
        lead.name,
        lead.email,
        lead.phone,
        lead.courseName
      ]
        .map((value) => String(value || "").toLowerCase())
        .join(" ");

      return haystack.includes(query);
    });
  }

  if (normalizeCourseFilterValue(selectedCourseFilter) !== "all") {
    lostLeads = lostLeads.filter((lead) => getLostProgramName(lead) === selectedCourseFilter);
    filteredArchivedLeads = filteredArchivedLeads.filter((lead) => String(lead?.courseName || "").trim() === selectedCourseFilter);
  }

  lostPage = clampPage(lostPage, lostLeads.length);
  archivedPage = clampPage(archivedPage, filteredArchivedLeads.length);
  renderSubsectionNav();
  renderSectionVisibility();
  renderKpi(lostLeads, canViewArchivedLeads() ? filteredArchivedLeads : []);
  renderLostTable(lostLeads);
  if (canViewArchivedLeads()) {
    renderArchivedTable(filteredArchivedLeads);
  }
}

if (lostSearchInput) {
  lostSearchInput.onkeydown = (event) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    searchQuery = String(lostSearchInput.value || "").trim();
    lostPage = 1;
    archivedPage = 1;
    persistSearchQuery();
    renderAll();
  };
}

if (resetLostSearch) {
  resetLostSearch.onclick = () => {
    searchQuery = "";
    selectedCourseFilter = "all";
    if (lostSearchInput) {
      lostSearchInput.value = "";
    }
    if (lostCourseFilter) {
      lostCourseFilter.value = "all";
    }
    lostPage = 1;
    archivedPage = 1;
    persistSearchQuery();
    renderAll();
  };
}

if (lostCourseFilter) {
  lostCourseFilter.onchange = () => {
    selectedCourseFilter = normalizeCourseFilterValue(lostCourseFilter.value);
    lostPage = 1;
    archivedPage = 1;
    renderAll();
  };
}

if (deleteAllLostLeadsBtn) {
  deleteAllLostLeadsBtn.onclick = () => {
    void deleteAllLostLeads();
  };
}

if (deleteAllArchivedLeadsBtn) {
  deleteAllArchivedLeadsBtn.onclick = () => {
    void deleteAllArchivedLeads();
  };
}

await refreshArchivedLeads();
renderAll();
window.__dvMarkRouteViewReady?.();
const stopStatePolling = startStatePolling(() => {
  void refreshArchivedLeads().then(() => {
    renderAll();
  });
});
registerPageCleanup(stopStatePolling);
