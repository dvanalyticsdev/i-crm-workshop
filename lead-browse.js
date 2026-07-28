import { registerPageCleanup } from "./page-runtime.js";
import { getSession } from "./state-sync.js";
import { trackLeadView } from "./lead-service.js";
import { raiseLeadClaim } from "./lead-claim-service.js";
import { openActivityHistory } from "./activity-history.js";
import { apiUrl } from "./api-client.js";

const PAGE_SIZE = 25;
const controls = document.getElementById("leadBrowseControls");
const tableSection = document.getElementById("leadBrowseTableSection");
const pagination = document.getElementById("leadBrowsePagination");
const modal = document.getElementById("leadBrowseDetailsModal");
const modalTitle = document.getElementById("leadBrowseDetailsTitle");
const modalSubtitle = document.getElementById("leadBrowseDetailsSubtitle");
const modalBody = document.getElementById("leadBrowseDetailsBody");
const closeModalButton = document.getElementById("closeLeadBrowseDetailsBtn");
const activityHistoryButton = document.getElementById("leadBrowseActivityHistoryBtn");
const claimModal = document.getElementById("leadClaimModal");
const claimForm = document.getElementById("leadClaimForm");
const claimLeadTitle = document.getElementById("leadClaimLeadTitle");
const claimLeadMeta = document.getElementById("leadClaimLeadMeta");
const claimReasonInput = document.getElementById("leadClaimReason");
const claimMessage = document.getElementById("leadClaimMessage");
const cancelClaimButton = document.getElementById("cancelLeadClaimBtn");
const cancelClaimButtonSecondary = document.getElementById("cancelLeadClaimBtnSecondary");

const filter = {
  category: "workshop",
  admissionSection: "all",
  query: "",
  counselor: "",
  status: ""
};

let currentPage = 1;
let latestLeadKey = "";
let activeClaimLeadKey = "";
let duplicateGroups = [];
let duplicateGroupsLoading = false;
let duplicateGroupsLoaded = false;
let leadBrowseLeads = [];
let initialLeadBrowseLoadPending = true;
let initialLeadBrowseLoadFailed = false;
const selectedDuplicateKeeperByGroup = new Map();
const duplicateMergeOptions = {
  preferWorkshopKeeper: true,
  preferNonRegisteredKeeper: true,
  disallowedKeeperSections: []
};

function showLeadBrowseToast(message, isError = false) {
  let container = document.querySelector(".toast-container");
  if (!container) {
    container = document.createElement("div");
    container.className = "toast-container";
    document.body.appendChild(container);
  }
  const toast = document.createElement("div");
  toast.className = `toast ${isError ? "toast--error" : "toast--success"}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function getLeadKey(lead) {
  return [lead?.id, lead?.email, lead?.phone, lead?.leadPipeline, lead?.createdAt].map((value) => String(value || "")).join("::");
}

function getPipeline(lead) {
  return normalize(lead?.leadPipeline || "workshop") || "workshop";
}

function isRegisteredAdmissionLead(lead) {
  return getPipeline(lead) === "course-registration";
}

function isMainAdmissionLead(lead) {
  return getPipeline(lead) === "main-admission";
}

function isWorkshopLead(lead) {
  return !isRegisteredAdmissionLead(lead) && !isMainAdmissionLead(lead);
}

function isPreWorkshopLead(lead) {
  return isWorkshopLead(lead) && !hasAdmissionActivity(lead);
}

function isSidebarAdmissionLead(lead) {
  return isRegisteredAdmissionLead(lead) || isMainAdmissionLead(lead);
}

function hasAdmissionActivity(lead) {
  return Boolean(
    lead?.postStatusUpdated ||
    lead?.courseStatus ||
    lead?.admissionStatus ||
    lead?.postCallStatus ||
    lead?.admissionWorkshop ||
    Number(lead?.postActivityUpdates || 0) > 0 ||
    (Array.isArray(lead?.admissionActivityHistory) && lead.admissionActivityHistory.length > 0)
  );
}

function getAdmissionSection(lead) {
  if (isMainAdmissionLead(lead)) return "main-admission";
  if (isRegisteredAdmissionLead(lead)) {
    return normalize(lead?.publicCourseSegment) === "crash-course" ? "crash-course" : "registered-candidates";
  }
  return "admission-calling";
}

function getCategoryLabel(lead) {
  if (isMainAdmissionLead(lead)) return "Main Admission";
  if (isRegisteredAdmissionLead(lead)) {
    return normalize(lead?.publicCourseSegment) === "crash-course" ? "Crash Course" : "Registered Candidate";
  }
  return hasAdmissionActivity(lead) ? "Post Workshop" : "Pre Workshop";
}

function getStatusLabel(lead) {
  return lead?.mainAdmissionAdmissionStatus ||
    lead?.registeredAdmissionStatus ||
    lead?.admissionStatus ||
    lead?.courseStatus ||
    lead?.wsStatus ||
    lead?.callStatus ||
    "No status";
}

function getCoreWorkshopName(workshopName) {
  if (!workshopName) return "";
  const normalizedWorkshopName = String(workshopName)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2")
    .replace(/\b(\d{1,2})\s+(st|nd|rd|th)\b/gi, "$1$2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[_\s]+(imp|od|ind)$/i, "")
    .trim();
  const name = normalizedWorkshopName.toLowerCase();

  if (name.includes("gen") && name.includes("11")) {
    return "Gen AI Workshop 11th June";
  }
  if (name.includes("python") && name.includes("20")) {
    return "Python Workshop 20th June";
  }
  if (name.includes("powe") && name.includes("27")) {
    return "Power BI Workshop 27th June";
  }
  if (name.includes("cyber") && name.includes("21")) {
    return "Cyber Security Workshop 21st June";
  }
  if (name.includes("sql") && name.includes("13")) {
    return "SQL Workshop 13th June";
  }

  return normalizedWorkshopName;
}

function shortenWorkshopLabel(workshopName) {
  const coreName = getCoreWorkshopName(workshopName);
  const cleaned = coreName.replace(/\bworkshop\b/gi, "").replace(/\s{2,}/g, " ").trim();
  return cleaned || coreName;
}

function getLeadWorkshopName(lead) {
  const sourceName = String(lead?.workshop || lead?.workshopName || "").trim();
  const shortened = shortenWorkshopLabel(sourceName);
  return shortened.replace(/\s+\d{1,2}(?:st|nd|rd|th)\s+[A-Za-z]+$/i, "").trim();
}

function getLeadWorkshopDisplay(lead) {
  const normalizedAdmissionWorkshop = getLeadWorkshopName({ workshop: lead?.admissionWorkshop || "" });
  if (normalizedAdmissionWorkshop) return normalizedAdmissionWorkshop;
  return String(lead?.workshopName || getLeadWorkshopName(lead) || lead?.workshop || "").trim();
}

function getCourseLabel(lead) {
  if (isPreWorkshopLead(lead)) {
    return getLeadWorkshopDisplay(lead) || lead?.courseName || "Not specified";
  }
  return lead?.courseName || lead?.coursePitched || lead?.mainAdmissionCoursePitched || lead?.registeredCoursePitched || getLeadWorkshopDisplay(lead) || "Not specified";
}

function getCreatedAt(lead) {
  const raw = lead?.createdAt || lead?.updatedAt || "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return String(raw || "Not available");
  return date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function getAllLeads() {
  return leadBrowseLeads.filter((lead) => lead && !lead.isDeleted);
}

async function loadLeadBrowseData() {
  const response = await fetch(apiUrl("/api/leads"), {
    credentials: "same-origin",
    headers: { Accept: "application/json" }
  });
  const payload = await response.json().catch(() => []);
  if (!response.ok) {
    throw new Error(payload?.message || "Failed to load leads.");
  }
  leadBrowseLeads = Array.isArray(payload) ? payload : [];
  return leadBrowseLeads;
}

function startLeadBrowsePolling(onRefresh, intervalMs = 15000) {
  let destroyed = false;
  let activePoll = false;

  async function poll() {
    if (destroyed || activePoll || document.visibilityState === "hidden") {
      return;
    }
    activePoll = true;
    try {
      await loadLeadBrowseData();
      await onRefresh();
    } catch (error) {
      console.warn("[lead-browse] polling failed:", error?.message || error);
    } finally {
      activePoll = false;
    }
  }

  const timer = window.setInterval(() => {
    void poll();
  }, intervalMs);
  const handleVisibilityChange = () => {
    if (document.visibilityState === "visible") {
      void poll();
    }
  };
  document.addEventListener("visibilitychange", handleVisibilityChange);

  return () => {
    destroyed = true;
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
  };
}

function getSessionCounselorName() {
  const session = getSession();
  return String(session?.name || "").trim();
}

function isAdminSession() {
  return ["admin", "super_admin"].includes(getSession()?.role);
}

function canRaiseClaimForLead(lead) {
  const session = getSession();
  if (session?.role !== "counselor") return false;

  const counselorName = getSessionCounselorName().toLowerCase();
  const leadCounselor = normalize(lead?.counselor || "");
  return !!counselorName &&
    !!leadCounselor &&
    leadCounselor !== "unassigned" &&
    leadCounselor !== counselorName;
}

function getCategoryLeads(leads) {
  if (filter.category === "duplicates") {
    return [];
  }
  if (filter.category === "workshop") {
    return leads.filter(isWorkshopLead);
  }

  return leads.filter((lead) => {
    if (!isSidebarAdmissionLead(lead)) return false;
    if (filter.admissionSection === "all") return true;
    return getAdmissionSection(lead) === filter.admissionSection;
  });
}

function getUniqueValues(leads, getter) {
  return [...new Set(leads.map(getter).map((value) => String(value || "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

function getFilteredLeads() {
  if (filter.category === "duplicates") {
    return [];
  }
  const categoryLeads = getCategoryLeads(getAllLeads());
  const query = normalize(filter.query);
  const counselor = normalize(filter.counselor);
  const status = normalize(filter.status);

  return categoryLeads.filter((lead) => {
    if (counselor && normalize(lead.counselor || "Unassigned") !== counselor) return false;
    if (status && normalize(getStatusLabel(lead)) !== status) return false;
    if (!query) return true;

    const haystack = [
      lead.name,
      lead.email,
      lead.phone,
      lead.workshop,
      lead.courseName,
      lead.source,
      lead.counselor,
      getStatusLabel(lead)
    ].map((value) => normalize(value)).join(" ");

    return haystack.includes(query);
  });
}

function getFilteredDuplicateGroups() {
  const query = normalize(filter.query);
  const groups = Array.isArray(duplicateGroups) ? duplicateGroups : [];
  if (!query) {
    return groups;
  }
  return groups.filter((group) => {
    const haystack = [
      ...(group.sharedEmails || []),
      ...(group.sharedPhones || []),
      ...((group.leads || []).flatMap((lead) => [
        lead.name,
        lead.email,
        lead.phone,
        lead.counselor,
        lead.source,
        lead.courseName,
        lead.workshop,
        lead.leadPipeline
      ]))
    ].map((value) => normalize(value)).join(" ");
    return haystack.includes(query);
  });
}

async function fetchDuplicateGroups() {
  if (!isAdminSession()) {
    duplicateGroups = [];
    duplicateGroupsLoaded = false;
    return;
  }
  duplicateGroupsLoading = true;
  renderTable();
  try {
    const response = await fetch(apiUrl("/api/admin/duplicate-leads"), {
      method: "GET",
      credentials: "same-origin",
      headers: {
        Accept: "application/json"
      }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.message || "Failed to load duplicate leads.");
    }
    duplicateGroups = Array.isArray(payload?.groups) ? payload.groups : [];
    duplicateGroupsLoaded = true;
  } catch (error) {
    duplicateGroups = [];
    duplicateGroupsLoaded = true;
    showLeadBrowseToast(error.message || "Could not load duplicate leads.", true);
  } finally {
    duplicateGroupsLoading = false;
    if (filter.category === "duplicates") {
      renderTable();
    }
  }
}

function shouldAutoRefreshDuplicateCategory() {
  return false;
}

async function mergeDuplicateGroup(group) {
  const keeperLeadId = selectedDuplicateKeeperByGroup.get(group.groupId) || String(group?.leads?.[0]?.id || "");
  const duplicateLeadIds = (group.leads || []).map((lead) => String(lead.id || "")).filter((id) => id && id !== keeperLeadId);
  if (!keeperLeadId || !duplicateLeadIds.length) {
    showLeadBrowseToast("Select a keeper lead before merging.", true);
    return;
  }

  const response = await fetch(apiUrl("/api/admin/duplicate-leads/merge"), {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({ keeperLeadId, duplicateLeadIds })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.details || payload?.message || "Failed to merge duplicate leads.");
  }
  await loadLeadBrowseData().catch(() => undefined);
  await fetchDuplicateGroups();
  showLeadBrowseToast("Duplicate leads merged successfully.");
}

async function mergeAllDuplicateGroupsByOldest() {
  const response = await fetch(apiUrl("/api/admin/duplicate-leads/merge-all"), {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify(duplicateMergeOptions)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.details || payload?.message || "Failed to merge duplicate leads.");
  }
  await loadLeadBrowseData().catch(() => undefined);
  await fetchDuplicateGroups();
  const mergedCount = Number(payload?.mergedGroups) || 0;
  const failedCount = Array.isArray(payload?.failedGroups) ? payload.failedGroups.length : 0;
  showLeadBrowseToast(
    failedCount
      ? `Merged ${mergedCount} group(s). ${failedCount} group(s) still need manual review.`
      : `Merged ${mergedCount} duplicate group(s) into the selected keeper strategy.`
  );
  if (failedCount) {
    console.warn("Duplicate merge-all failures:", payload.failedGroups);
  }
}

function renderControls() {
  const categoryLeads = getCategoryLeads(getAllLeads());
  const counselors = getUniqueValues(categoryLeads, (lead) => lead.counselor || "Unassigned");
  const statuses = getUniqueValues(categoryLeads, getStatusLabel);

  controls.innerHTML = `
    <div class="lead-browse-tabs" role="tablist" aria-label="Lead categories">
      <button type="button" class="${filter.category === "workshop" ? "btn-primary" : "btn-ghost"}" data-category="workshop">Workshop Leads</button>
      <button type="button" class="${filter.category === "admission" ? "btn-primary" : "btn-ghost"}" data-category="admission">Admission Leads</button>
      ${isAdminSession() ? `<button type="button" class="${filter.category === "duplicates" ? "btn-primary" : "btn-ghost"}" data-category="duplicates">Duplicate Leads</button>` : ""}
    </div>
    <div class="lead-browse-filters">
      ${filter.category === "admission" ? `
        <label>
          Section
          <select id="leadBrowseAdmissionSection">
            <option value="all" ${filter.admissionSection === "all" ? "selected" : ""}>All Admission Sections</option>
            <option value="registered-candidates" ${filter.admissionSection === "registered-candidates" ? "selected" : ""}>Registered Candidates</option>
            <option value="crash-course" ${filter.admissionSection === "crash-course" ? "selected" : ""}>Crash Course</option>
            <option value="main-admission" ${filter.admissionSection === "main-admission" ? "selected" : ""}>Main Admission Leads</option>
          </select>
        </label>
      ` : ""}
      <label>
        Search
        <input id="leadBrowseSearch" type="search" value="${escapeHtml(filter.query)}" placeholder="${filter.category === "duplicates" ? "Name, phone, email, counselor..." : "Name, phone, email, course..."}" />
      </label>
      ${filter.category !== "duplicates" ? `<label>
        Counselor
        <select id="leadBrowseCounselor">
          <option value="">All Counselors</option>
          ${counselors.map((name) => `<option value="${escapeHtml(name)}" ${filter.counselor === name ? "selected" : ""}>${escapeHtml(name)}</option>`).join("")}
        </select>
      </label>
      <label>
        Status
        <select id="leadBrowseStatus">
          <option value="">All Statuses</option>
          ${statuses.map((status) => `<option value="${escapeHtml(status)}" ${filter.status === status ? "selected" : ""}>${escapeHtml(status)}</option>`).join("")}
        </select>
      </label>
      ` : ""}
      ${isAdminSession() && filter.category === "duplicates" ? `
        <div class="lead-browse-duplicate-actions">
          <label>
            Keeper Preference
            <select id="leadBrowseDuplicateKeeperPreference">
              <option value="prefer-workshop" ${duplicateMergeOptions.preferWorkshopKeeper ? "selected" : ""}>Prefer workshop lead</option>
              <option value="prefer-non-registered" ${!duplicateMergeOptions.preferWorkshopKeeper && duplicateMergeOptions.preferNonRegisteredKeeper ? "selected" : ""}>Prefer non-registered lead</option>
              <option value="oldest-only" ${!duplicateMergeOptions.preferWorkshopKeeper && !duplicateMergeOptions.preferNonRegisteredKeeper ? "selected" : ""}>Only oldest-created lead</option>
            </select>
          </label>
          <label>
            Do Not Keep
            <select id="leadBrowseDuplicateDisallowedSection">
              <option value="">Allow all sections</option>
              <option value="registered-candidates" ${duplicateMergeOptions.disallowedKeeperSections.includes("registered-candidates") ? "selected" : ""}>Do not keep Registered Candidate</option>
              <option value="crash-course" ${duplicateMergeOptions.disallowedKeeperSections.includes("crash-course") ? "selected" : ""}>Do not keep Crash Course</option>
              <option value="main-admission" ${duplicateMergeOptions.disallowedKeeperSections.includes("main-admission") ? "selected" : ""}>Do not keep Main Admission</option>
            </select>
          </label>
          <button type="button" class="btn-primary" id="leadBrowseMergeAllDuplicatesBtn">Merge All By Oldest Lead</button>
        </div>
      ` : ""}
    </div>
  `;

  controls.querySelectorAll("[data-category]").forEach((button) => {
    button.addEventListener("click", () => {
      filter.category = button.getAttribute("data-category");
      filter.counselor = "";
      filter.status = "";
      currentPage = 1;
      render();
      if (filter.category === "duplicates" && !duplicateGroupsLoaded) {
        void fetchDuplicateGroups();
      }
    });
  });

  const admissionSection = document.getElementById("leadBrowseAdmissionSection");
  if (admissionSection) {
    admissionSection.addEventListener("change", (event) => {
      filter.admissionSection = event.target.value;
      currentPage = 1;
      render();
    });
  }

  document.getElementById("leadBrowseSearch").addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    filter.query = event.target.value;
    currentPage = 1;
    render();
  });
  document.getElementById("leadBrowseCounselor")?.addEventListener("change", (event) => {
    filter.counselor = event.target.value;
    currentPage = 1;
    render();
  });
  document.getElementById("leadBrowseStatus")?.addEventListener("change", (event) => {
    filter.status = event.target.value;
    currentPage = 1;
    render();
  });
  document.getElementById("leadBrowseMergeAllDuplicatesBtn")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = "Merging...";
    try {
      await mergeAllDuplicateGroupsByOldest();
    } catch (error) {
      showLeadBrowseToast(error.message || "Could not merge duplicate leads.", true);
    } finally {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  });
  document.getElementById("leadBrowseDuplicateKeeperPreference")?.addEventListener("change", (event) => {
    const value = event.target.value;
    duplicateMergeOptions.preferWorkshopKeeper = value === "prefer-workshop";
    duplicateMergeOptions.preferNonRegisteredKeeper = value === "prefer-workshop" || value === "prefer-non-registered";
  });
  document.getElementById("leadBrowseDuplicateDisallowedSection")?.addEventListener("change", (event) => {
    const value = String(event.target.value || "").trim();
    duplicateMergeOptions.disallowedKeeperSections = value ? [value] : [];
  });
}

function getActiveInputState() {
  const active = document.activeElement;
  if (!active?.id) return null;
  return {
    id: active.id,
    selectionStart: typeof active.selectionStart === "number" ? active.selectionStart : null,
    selectionEnd: typeof active.selectionEnd === "number" ? active.selectionEnd : null
  };
}

function restoreActiveInputState(state) {
  if (!state?.id) return;
  const input = document.getElementById(state.id);
  if (!input) return;
  input.focus();
  if (state.selectionStart !== null && typeof input.setSelectionRange === "function") {
    input.setSelectionRange(state.selectionStart, state.selectionEnd ?? state.selectionStart);
  }
}

function renderTable() {
  if (filter.category === "duplicates") {
    renderDuplicateGroups();
    return;
  }
  const leads = getFilteredLeads();
  const totalPages = Math.max(1, Math.ceil(leads.length / PAGE_SIZE));
  currentPage = Math.min(currentPage, totalPages);
  const pageLeads = leads.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  if (!pageLeads.length) {
    const emptyStateTitle = initialLeadBrowseLoadPending
      ? "Loading leads"
      : initialLeadBrowseLoadFailed
        ? "Could not load leads"
        : "No leads found";
    const emptyStateText = initialLeadBrowseLoadPending
      ? "Fetching the latest lead data now."
      : initialLeadBrowseLoadFailed
        ? "Please refresh once the connection or server is stable."
        : "Adjust the current filters to browse a wider set of leads.";
    tableSection.innerHTML = `
      <div class="empty-state">
        <h3>${escapeHtml(emptyStateTitle)}</h3>
        <p>${escapeHtml(emptyStateText)}</p>
      </div>
    `;
    pagination.innerHTML = "";
    return;
  }

  tableSection.innerHTML = `
    <div class="table-scroll">
      <table class="lead-table">
        <thead>
          <tr>
            <th>Lead</th>
            <th>Phone</th>
            <th>Counselor</th>
            <th>Section</th>
            <th>Course / Workshop</th>
            <th>Status</th>
            <th>Created</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${pageLeads.map((lead) => `
            ${(() => {
              const leadKey = escapeHtml(getLeadKey(lead));
              return `
            <tr>
              <td>
                <strong>${escapeHtml(lead.name || "Unnamed lead")}</strong>
                <span>${escapeHtml(lead.email || "No email")}</span>
              </td>
              <td>${escapeHtml(lead.phone || "Not available")}</td>
              <td>${escapeHtml(lead.counselor || "Unassigned")}</td>
              <td><span class="lead-browse-pill">${escapeHtml(getCategoryLabel(lead))}</span></td>
              <td>${escapeHtml(getCourseLabel(lead))}</td>
              <td>${escapeHtml(getStatusLabel(lead))}</td>
              <td>${escapeHtml(getCreatedAt(lead))}</td>
              <td>
                <div class="lead-browse-row-actions">
                  <button type="button" class="btn-ghost" data-view-lead="${leadKey}">View</button>
                  <button type="button" class="btn-ghost" data-history-lead="${leadKey}">Activity</button>
                  ${canRaiseClaimForLead(lead) ? `<button type="button" class="btn-primary" data-claim-lead="${leadKey}">Claim</button>` : ""}
                </div>
              </td>
            </tr>
              `;
            })()}
          `).join("")}
        </tbody>
      </table>
    </div>
  `;

  tableSection.querySelectorAll("[data-view-lead]").forEach((button) => {
    button.addEventListener("click", () => openDetails(button.getAttribute("data-view-lead")));
  });
  tableSection.querySelectorAll("[data-history-lead]").forEach((button) => {
    button.addEventListener("click", () => openLeadActivityHistory(button.getAttribute("data-history-lead")));
  });
  tableSection.querySelectorAll("[data-claim-lead]").forEach((button) => {
    button.addEventListener("click", () => openClaimModal(button.getAttribute("data-claim-lead")));
  });

  pagination.innerHTML = `
    <button type="button" class="btn-ghost" id="leadBrowsePrev" ${currentPage <= 1 ? "disabled" : ""}>Prev</button>
    <span>Page ${currentPage} of ${totalPages}</span>
    <button type="button" class="btn-ghost" id="leadBrowseNext" ${currentPage >= totalPages ? "disabled" : ""}>Next</button>
  `;

  document.getElementById("leadBrowsePrev")?.addEventListener("click", () => {
    currentPage = Math.max(1, currentPage - 1);
    render();
  });
  document.getElementById("leadBrowseNext")?.addEventListener("click", () => {
    currentPage = Math.min(totalPages, currentPage + 1);
    render();
  });
}

function renderDuplicateGroups() {
  if (duplicateGroupsLoading) {
    tableSection.innerHTML = `
      <div class="empty-state">
        <h3>Loading duplicate leads</h3>
        <p>Fetching duplicate groups for admin review.</p>
      </div>
    `;
    pagination.innerHTML = "";
    return;
  }

  const groups = getFilteredDuplicateGroups();
  if (!groups.length) {
    tableSection.innerHTML = `
      <div class="empty-state">
        <h3>No duplicate leads found</h3>
        <p>${duplicateGroupsLoaded ? "The system currently has no duplicate lead groups to merge." : "Open this section to scan the CRM for duplicate leads."}</p>
      </div>
    `;
    pagination.innerHTML = "";
    return;
  }

  tableSection.innerHTML = groups.map((group) => {
    const defaultKeeper = selectedDuplicateKeeperByGroup.get(group.groupId) || String(group?.leads?.[0]?.id || "");
    selectedDuplicateKeeperByGroup.set(group.groupId, defaultKeeper);
    return `
      <section class="card duplicate-group-card" data-duplicate-group="${escapeHtml(group.groupId)}">
        <div class="duplicate-group-card__header">
          <div>
            <h3>Duplicate Group</h3>
            <p>${escapeHtml(
              [
                group.sharedEmails?.length ? `Email: ${group.sharedEmails.join(", ")}` : "",
                group.sharedPhones?.length ? `Phone: ${group.sharedPhones.join(", ")}` : ""
              ].filter(Boolean).join(" | ") || "Matched by shared contact details"
            )}</p>
          </div>
          <button type="button" class="btn-primary" data-merge-group="${escapeHtml(group.groupId)}">Merge Into Selected Keeper</button>
        </div>
        <div class="table-scroll">
          <table class="lead-table">
            <thead>
              <tr>
                <th>Keep</th>
                <th>Lead</th>
                <th>Counselor</th>
                <th>Section</th>
                <th>Course / Workshop</th>
                <th>Source</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              ${(group.leads || []).map((lead) => `
                <tr>
                  <td>
                    <label>
                      <input type="radio" name="duplicate-keeper-${escapeHtml(group.groupId)}" value="${escapeHtml(String(lead.id || ""))}" ${String(lead.id || "") === defaultKeeper ? "checked" : ""} />
                      Keep
                    </label>
                  </td>
                  <td>
                    <strong>${escapeHtml(lead.name || "Unnamed lead")}</strong>
                    <span>${escapeHtml(lead.email || "No email")} | ${escapeHtml(lead.phone || "No phone")}</span>
                  </td>
                  <td>${escapeHtml(lead.counselor || "Unassigned")}</td>
                  <td><span class="lead-browse-pill">${escapeHtml(getCategoryLabel(lead))}</span></td>
                  <td>${escapeHtml(getCourseLabel(lead))}</td>
                  <td>${escapeHtml(lead.source || "Unknown")}</td>
                  <td>${escapeHtml(lead.createdAtDisplay || getCreatedAt(lead))}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }).join("");

  pagination.innerHTML = "";

  tableSection.querySelectorAll("[data-duplicate-group]").forEach((container) => {
    const groupId = container.getAttribute("data-duplicate-group");
    container.querySelectorAll(`input[name="duplicate-keeper-${groupId}"]`).forEach((input) => {
      input.addEventListener("change", () => {
        selectedDuplicateKeeperByGroup.set(groupId, input.value);
      });
    });
  });
  tableSection.querySelectorAll("[data-merge-group]").forEach((button) => {
    button.addEventListener("click", async () => {
      const groupId = button.getAttribute("data-merge-group");
      const group = groups.find((item) => item.groupId === groupId);
      if (!group) {
        showLeadBrowseToast("Duplicate group not found. Please refresh and try again.", true);
        return;
      }
      const originalLabel = button.textContent;
      button.disabled = true;
      button.textContent = "Merging...";
      try {
        await mergeDuplicateGroup(group);
      } catch (error) {
        showLeadBrowseToast(error.message || "Could not merge duplicate leads.", true);
      } finally {
        button.disabled = false;
        button.textContent = originalLabel;
      }
    });
  });
}

function setClaimMessage(text, isError = false) {
  if (!claimMessage) return;
  claimMessage.textContent = text || "";
  claimMessage.style.color = isError ? "var(--danger)" : "var(--success)";
}

function openClaimModal(leadKey) {
  const lead = findLeadByKey(leadKey);
  if (!lead || !claimModal || !claimForm) return;

  activeClaimLeadKey = leadKey;
  claimLeadTitle.textContent = lead.name || "Unnamed lead";
  claimLeadMeta.textContent = `Currently assigned to ${lead.counselor || "Unassigned"} | ${getCourseLabel(lead)}`;
  claimReasonInput.value = "";
  setClaimMessage("");
  claimModal.classList.remove("hidden");
  claimReasonInput.focus();
}

function closeClaimModal() {
  activeClaimLeadKey = "";
  claimModal?.classList.add("hidden");
  if (claimForm) {
    claimForm.reset();
  }
  setClaimMessage("");
}

function findLeadByKey(leadKey) {
  return getAllLeads().find((lead) => getLeadKey(lead) === leadKey) || null;
}

function renderDetailItem(label, value) {
  return `
    <div class="lead-browse-detail-item">
      <dt>${escapeHtml(label)}</dt>
      <dd>${escapeHtml(value || "Not available")}</dd>
    </div>
  `;
}

async function openDetails(leadKey) {
  const lead = findLeadByKey(leadKey);
  if (!lead) return;

  latestLeadKey = leadKey;
  modalTitle.textContent = lead.name || "Lead Details";
  modalSubtitle.textContent = `${getCategoryLabel(lead)} | Assigned to ${lead.counselor || "Unassigned"}`;
  modalBody.innerHTML = [
    ["Name", lead.name],
    ["Email", lead.email],
    ["Phone", lead.phone],
    ["Counselor", lead.counselor || "Unassigned"],
    ["Section", getCategoryLabel(lead)],
    ["Course / Workshop", getCourseLabel(lead)],
    ["Workshop", lead.workshop],
    ["Admission Workshop", lead.admissionWorkshop],
    ["Source", lead.source],
    ["City / Branch", lead.city || lead.branch || lead.country],
    ["Workshop Call Status", lead.callStatus],
    ["Workshop Status", lead.wsStatus],
    ["Admission Call Status", lead.postCallStatus || lead.mainAdmissionCallStatus || lead.registeredCallStatus],
    ["Course Status", lead.courseStatus || lead.mainAdmissionCourseStatus || lead.registeredCourseStatus],
    ["Admission Status", lead.admissionStatus || lead.mainAdmissionAdmissionStatus || lead.registeredAdmissionStatus],
    ["Created", getCreatedAt(lead)]
  ].map(([label, value]) => renderDetailItem(label, value)).join("");

  modal.classList.remove("hidden");

  const result = await trackLeadView(lead.id, lead.email || "");
  if (!result.ok) {
    console.warn("Lead view notification failed:", result.message);
  }
}

async function openLeadActivityHistory(leadKey) {
  const lead = findLeadByKey(leadKey);
  if (!lead) return;

  latestLeadKey = leadKey;
  openActivityHistory(lead.id, lead.name || "Lead", lead.email || "");

  const result = await trackLeadView(lead.id, lead.email || "");
  if (!result.ok) {
    console.warn("Lead view notification failed:", result.message);
  }
}

function closeDetails() {
  latestLeadKey = "";
  modal.classList.add("hidden");
}

function render() {
  const activeInputState = getActiveInputState();
  renderControls();
  renderTable();
  restoreActiveInputState(activeInputState);
}

closeModalButton?.addEventListener("click", closeDetails);
activityHistoryButton?.addEventListener("click", () => {
  if (latestLeadKey) {
    void openLeadActivityHistory(latestLeadKey);
  }
});
modal?.addEventListener("click", (event) => {
  if (event.target === modal) closeDetails();
});
cancelClaimButton?.addEventListener("click", closeClaimModal);
cancelClaimButtonSecondary?.addEventListener("click", closeClaimModal);
claimModal?.addEventListener("click", (event) => {
  if (event.target === claimModal) closeClaimModal();
});
claimForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const lead = findLeadByKey(activeClaimLeadKey);
  const reason = String(claimReasonInput?.value || "").trim();
  if (!lead) {
    setClaimMessage("This lead is no longer available. Please refresh and try again.", true);
    return;
  }
  if (reason.length < 12) {
    setClaimMessage("Please enter a detailed formal reason for this claim.", true);
    return;
  }

  const submitButton = claimForm.querySelector("button[type='submit']");
  if (submitButton) submitButton.disabled = true;
  setClaimMessage("Submitting claim request...");
  const result = await raiseLeadClaim({
    leadId: lead.id,
    leadEmail: lead.email || "",
    reason
  });
  if (submitButton) submitButton.disabled = false;

  if (!result.ok) {
    setClaimMessage(result.message || "Could not submit claim request.", true);
    return;
  }

  setClaimMessage("Claim request submitted for approval.");
  window.setTimeout(closeClaimModal, 700);
});

render();
window.__dvMarkRouteViewReady?.();

void (async () => {
  try {
    await loadLeadBrowseData();
    initialLeadBrowseLoadFailed = false;
  } catch (error) {
    initialLeadBrowseLoadFailed = true;
    showLeadBrowseToast(error.message || "Could not load leads.", true);
  } finally {
    initialLeadBrowseLoadPending = false;
  }

  if (isAdminSession()) {
    void fetchDuplicateGroups();
  }
  render();
})();

const stopLeadBrowsePolling = startLeadBrowsePolling(() => {
  if (latestLeadKey && !findLeadByKey(latestLeadKey)) {
    closeDetails();
  }
  if (isAdminSession() && filter.category === "duplicates") {
    if (!shouldAutoRefreshDuplicateCategory()) {
      return;
    }
    void fetchDuplicateGroups();
  }
  render();
}, 15000);
registerPageCleanup(stopLeadBrowsePolling);
