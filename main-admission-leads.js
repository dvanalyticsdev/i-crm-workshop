import { registerPageCleanup } from "./page-runtime.js";
import { apiUrl } from "./api-client.js";
import { openActivityHistory } from "./activity-history.js";
import {
  bootstrapLocalState,
  getCounselors as getStoredCounselors,
  getLeads as getStoredLeads,
  getSession,
  loadPersistedValue,
  saveLeads as persistLeads,
  savePersistedValue,
  startStatePolling,
  syncStateFromLocalAndVerify
} from "./state-sync.js";
import { createTask, TASK_CATEGORY } from "./task-service.js";
import { addLeadNote, assignLeads as assignLeadsOnServer, deleteLeadNote, updateLeadActivity as updateLeadActivityOnServer } from "./lead-service.js";

await bootstrapLocalState();

const session = getSession();
const isAdmin = session?.role === "admin";
const canCreateTasks = session?.role === "counselor";

const mainAdmissionRoutingPanel = document.getElementById("mainAdmissionRoutingPanel");
const mainAdmissionRoutingOptions = document.getElementById("mainAdmissionRoutingOptions");
const saveMainAdmissionRoutingBtn = document.getElementById("saveMainAdmissionRoutingBtn");
const clearMainAdmissionLeadDataBtn = document.getElementById("clearMainAdmissionLeadDataBtn");
const mainAdmissionRoutingMessage = document.getElementById("mainAdmissionRoutingMessage");
const admissionSectionNav = document.getElementById("admissionSectionNav");
const mainAdmissionSegmentSection = document.getElementById("mainAdmissionSegmentSection");
const mainAdmissionKpiSection = document.getElementById("mainAdmissionKpiSection");
const mainAdmissionFilterBar = document.getElementById("mainAdmissionFilterBar");
const mainAdmissionActivityMessage = document.getElementById("mainAdmissionActivityMessage");
const mainAdmissionLeadTableSection = document.getElementById("mainAdmissionLeadTableSection");
const mainAdmissionPaginationSection = document.getElementById("mainAdmissionPaginationSection");
const mainAdmissionTaskModal = document.getElementById("mainAdmissionTaskModal");
const mainAdmissionTaskModalTitle = document.getElementById("mainAdmissionTaskModalTitle");
const mainAdmissionTaskForm = document.getElementById("mainAdmissionTaskForm");
const mainAdmissionTaskLeadIdInput = document.getElementById("mainAdmissionTaskLeadId");
const mainAdmissionTaskCategoryInput = document.getElementById("mainAdmissionTaskCategory");
const mainAdmissionTaskLeadNameInput = document.getElementById("mainAdmissionTaskLeadName");
const mainAdmissionTaskLeadPhoneInput = document.getElementById("mainAdmissionTaskLeadPhone");
const mainAdmissionTaskCounselorInput = document.getElementById("mainAdmissionTaskCounselor");
const mainAdmissionTaskTitleInput = document.getElementById("mainAdmissionTaskTitle");
const mainAdmissionTaskNotesInput = document.getElementById("mainAdmissionTaskNotes");
const mainAdmissionTaskDueDateInput = document.getElementById("mainAdmissionTaskDueDate");
const mainAdmissionTaskMessage = document.getElementById("mainAdmissionTaskMessage");

const FILTER_STORAGE_KEY = "dvMainAdmissionLeadFilters";
const MAIN_ADMISSION_ROUTING_ENDPOINT = apiUrl("/api/main-admission-routing");
const DEFAULT_SEGMENT = "standard";
const SEGMENT_CONFIG = {
  [DEFAULT_SEGMENT]: {
    key: DEFAULT_SEGMENT,
    label: "Main Admission Leads",
    description: "All incoming admission leads routed outside the workshop calling flow.",
    clearLabel: "Main Admission Lead",
    courseId: ""
  }
};
const DEFAULT_FILTER = {
  search: "",
  counselor: "",
  courseName: "",
  location: "",
  mainAdmissionDialed: "",
  mainAdmissionCourseStatus: "",
  mainAdmissionAdmissionStatus: "",
  mainAdmissionCallStatus: "",
  activityStatus: ""
};

const persistedFilter = await loadPersistedValue(FILTER_STORAGE_KEY, {});
let filter = { ...DEFAULT_FILTER, ...persistedFilter };
let currentPage = 1;
const pageSize = 50;
let selectedLeadKeys = new Set();
let activeLeadRef = null;
let notesLeadRef = null;
let mainAdmissionRoutingConfig = { selectedCounselors: [], isConfigured: false };
let mainAdmissionActivityModalMode = "edit";
let activeSegment = DEFAULT_SEGMENT;

function persistFilters() {
  void savePersistedValue(FILTER_STORAGE_KEY, filter);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function isCounselorSession() {
  return session?.role === "counselor";
}

function getCounselorIdentity() {
  if (!isCounselorSession()) {
    return "";
  }

  const sessionEmail = String(session?.email || "").trim().toLowerCase();
  const counselors = getStoredCounselors();
  const match = counselors.find((item) => String(item.email || "").trim().toLowerCase() === sessionEmail);
  return String(match?.name || session?.name || "").trim().toLowerCase();
}

function isRegisteredCandidateLead(lead) {
  return String(lead?.leadPipeline || "").trim().toLowerCase() === "main-admission";
}

function normalizeSegment(segment) {
  return DEFAULT_SEGMENT;
}

function getSegmentConfig(segment = activeSegment) {
  return SEGMENT_CONFIG[normalizeSegment(segment)];
}

function getLeadSegment(lead) {
  return DEFAULT_SEGMENT;
}

function getActiveCounselorNames() {
  return [...new Set(
    getStoredCounselors()
      .map((item) => String(item.name || "").trim())
      .filter(Boolean)
  )];
}

function normalizeLeadFields(leads) {
  leads.forEach((lead) => {
    lead.counselor = lead.counselor || "Unassigned";
    lead.courseName = String(lead.courseName || "").trim();
    lead.createdAt = lead.createdAt || new Date().toISOString().slice(0, 10);
    lead.mainAdmissionDialed = lead.mainAdmissionDialed || "";
    lead.mainAdmissionCoursePitched = lead.mainAdmissionCoursePitched || "";
    lead.mainAdmissionCourseStatus = lead.mainAdmissionCourseStatus || "";
    lead.mainAdmissionAdmissionStatus = lead.mainAdmissionAdmissionStatus || "";
    lead.mainAdmissionCallStatus = lead.mainAdmissionCallStatus || "";
    lead.mainAdmissionActivityUpdated = typeof lead.mainAdmissionActivityUpdated === "boolean" ? lead.mainAdmissionActivityUpdated : false;
    lead.mainAdmissionActivityHistory = Array.isArray(lead.mainAdmissionActivityHistory) ? lead.mainAdmissionActivityHistory : [];
    lead.mainAdmissionActivityUpdates = lead.mainAdmissionActivityHistory.length
      || (Number.isFinite(Number(lead.mainAdmissionActivityUpdates)) ? Number(lead.mainAdmissionActivityUpdates) : 0);
    lead.leadNotes = Array.isArray(lead.leadNotes) ? lead.leadNotes : [];
  });
}

function getStoredRegisteredCandidateLeads() {
  const leads = getStoredLeads().filter(isRegisteredCandidateLead);
  normalizeLeadFields(leads);
  return leads;
}

function getAllLeads(segment = activeSegment) {
  const normalizedSegment = normalizeSegment(segment);
  return getStoredRegisteredCandidateLeads().filter((lead) => getLeadSegment(lead) === normalizedSegment);
}

function getAllRegisteredCandidateLeads() {
  return getStoredRegisteredCandidateLeads();
}

function setRoutingMessage(message, isError = false) {
  if (!mainAdmissionRoutingMessage) {
    return;
  }

  mainAdmissionRoutingMessage.textContent = message;
  mainAdmissionRoutingMessage.style.color = isError ? "var(--danger)" : "var(--success)";
}

function getScopedLeads(leads) {
  if (!isCounselorSession()) {
    return leads;
  }

  const counselorIdentity = getCounselorIdentity();
  return leads.filter((lead) => String(lead.counselor || "").trim().toLowerCase() === counselorIdentity);
}

function setMessage(message, isError = false) {
  mainAdmissionActivityMessage.textContent = message;
  mainAdmissionActivityMessage.style.color = isError ? "var(--danger)" : "var(--success)";
}

function showToast(message, isError = false) {
  let container = document.getElementById("dvToastContainer");
  if (!container) {
    container = document.createElement("div");
    container.id = "dvToastContainer";
    container.className = "toast-container";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.className = `toast ${isError ? "toast--error" : "toast--success"}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("toast--fade");
    setTimeout(() => toast.remove(), 350);
  }, 3000);
}

function buildLeadRef(lead) {
  return {
    id: String(lead.id || "").trim(),
    email: String(lead.email || "").trim().toLowerCase(),
    phone: String(lead.phone || "").trim(),
    workshop: String(lead.workshop || "").trim(),
    createdAt: String(lead.createdAt || "").trim()
  };
}

function buildLeadKey(lead) {
  const ref = buildLeadRef(lead);
  return [ref.id, ref.email, ref.phone, ref.workshop, ref.createdAt].join("::");
}

function findLeadByRef(leadRef) {
  const leads = getAllRegisteredCandidateLeads();
  return leads.find((lead) => buildLeadKey(lead) === buildLeadKey(leadRef)) || null;
}

function getUniqueValues(leads, key) {
  return [...new Set(leads.map((lead) => String(lead[key] || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function getEffectiveRegisteredRoutingSelection(counselorNames) {
  const selectedCounselors = Array.isArray(mainAdmissionRoutingConfig.selectedCounselors)
    ? mainAdmissionRoutingConfig.selectedCounselors.map((name) => String(name || "").trim()).filter(Boolean)
    : [];
  const selectedCounselorSet = new Set(selectedCounselors.map((name) => name.toLowerCase()));
  const validSelected = counselorNames.filter((name) => selectedCounselorSet.has(String(name || "").trim().toLowerCase()));

  if (mainAdmissionRoutingConfig.isConfigured) {
    return validSelected;
  }

  return validSelected.length ? validSelected : counselorNames;
}

function buildRoutingEndpoint(segment = activeSegment) {
  return `${MAIN_ADMISSION_ROUTING_ENDPOINT}?segment=${encodeURIComponent(normalizeSegment(segment))}`;
}

function renderSegmentSection() {
  if (!mainAdmissionSegmentSection) {
    return;
  }

  mainAdmissionSegmentSection.innerHTML = `
    <div class="card-head">
      <h3>Main Admission Leads</h3>
      <p>Admission-type incoming leads are routed here automatically for direct counselor follow-up.</p>
    </div>
    <p class="block-help">${escapeHtml(getSegmentConfig().description)}</p>
  `;
}

function renderAdmissionSectionNav(activeRoute = "main-admission-leads.html") {
  if (!admissionSectionNav) {
    return;
  }

  const sections = [
    {
      route: "main-admission-leads.html",
      label: "Main Admission Calling",
      description: "Handle direct admission enquiries that bypass the workshop flow."
    },
    {
      route: "registered-candidates.html#standard",
      label: "Main Registered Candidates",
      description: "Manage standard public landing-page registrations except the 7-Day Crash Course."
    },
    {
      route: "registered-candidates.html#crash-course",
      label: "7-Day Crash Course",
      description: "Manage the isolated 7-Day Crash Course registration pipeline."
    }
  ];

  admissionSectionNav.innerHTML = `
    <div class="card-head">
      <h3>Admission Subsections</h3>
      <p>Use this section to switch between the admission-related pages instead of keeping each one in the sidebar.</p>
    </div>
    <div class="filter-actions" style="display:flex;gap:0.75rem;flex-wrap:wrap;">
      ${sections.map((section) => `
        <button
          type="button"
          class="${activeRoute === section.route ? "btn-primary" : "btn-ghost"}"
          data-admission-section="${section.route}"
        >
          ${escapeHtml(section.label)}
        </button>
      `).join("")}
    </div>
    <p class="block-help">${escapeHtml(sections.find((section) => section.route === activeRoute)?.description || "")}</p>
  `;

  admissionSectionNav.querySelectorAll("[data-admission-section]").forEach((button) => {
    button.onclick = () => {
      const route = button.getAttribute("data-admission-section");
      if (route && route !== `${window.location.pathname.split("/").pop()}${window.location.hash}`) {
        window.location.href = route;
      }
    };
  });
}

function renderRegisteredRoutingPanel() {
  if (!mainAdmissionRoutingPanel || !mainAdmissionRoutingOptions) {
    return;
  }

  if (!isAdmin) {
    mainAdmissionRoutingPanel.classList.add("hidden");
    return;
  }

  mainAdmissionRoutingPanel.classList.remove("hidden");
  const segmentConfig = getSegmentConfig();
  const panelTitle = mainAdmissionRoutingPanel.querySelector(".card-head h3");
  const panelDescription = mainAdmissionRoutingPanel.querySelector(".card-head p");
  const panelHelp = mainAdmissionRoutingPanel.querySelector(".block-help");
  if (panelTitle) {
    panelTitle.textContent = `${segmentConfig.label} Routing`;
  }
  if (panelDescription) {
    panelDescription.textContent = "Admission counselor rotation is managed from the Meta Integration page.";
  }
  if (panelHelp) {
    panelHelp.textContent = `Clear Data removes only ${segmentConfig.label} data. Other CRM lead sections stay unchanged.`;
  }
  mainAdmissionRoutingOptions.innerHTML = `<p class="block-help">Open Meta Integration and use the Admission Lead Rotation list to turn counselors on or off.</p>`;
  if (saveMainAdmissionRoutingBtn) saveMainAdmissionRoutingBtn.classList.add("hidden");
  if (clearMainAdmissionLeadDataBtn) clearMainAdmissionLeadDataBtn.disabled = false;
}

async function loadRegisteredRoutingConfig() {
  if (!isAdmin) {
    return;
  }

  try {
    const response = await fetch(buildRoutingEndpoint(), {
      method: "GET",
      headers: { Accept: "application/json" }
    });
    const json = await response.json().catch(() => ({}));

    if (!response.ok) {
      setRoutingMessage(json?.message || "Failed to load main admission lead routing.", true);
      return;
    }

    mainAdmissionRoutingConfig = {
      selectedCounselors: Array.isArray(json?.selectedCounselors) ? json.selectedCounselors : [],
      isConfigured: Boolean(json?.isConfigured)
    };
    renderRegisteredRoutingPanel();
  } catch {
    setRoutingMessage("Failed to load main admission lead routing.", true);
  }
}

async function saveRegisteredRoutingConfig() {
  const selectedCounselors = Array.from(document.querySelectorAll(".registered-routing-checkbox:checked"))
    .map((input) => String(input.value || "").trim())
    .filter(Boolean);

  if (!selectedCounselors.length) {
    setRoutingMessage("Select at least one counselor for main admission lead routing.", true);
    return;
  }

  try {
    const response = await fetch(buildRoutingEndpoint(), {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({ segment: activeSegment, selectedCounselors, isConfigured: true })
    });
    const json = await response.json().catch(() => ({}));

    if (!response.ok) {
      setRoutingMessage(json?.message || "Failed to save main admission lead routing.", true);
      return;
    }

    mainAdmissionRoutingConfig = {
      selectedCounselors: Array.isArray(json?.selectedCounselors) ? json.selectedCounselors : selectedCounselors,
      isConfigured: Boolean(json?.isConfigured ?? true)
    };
    renderRegisteredRoutingPanel();
    setRoutingMessage(`${getSegmentConfig().label} routing saved successfully.`);
    showToast(`${getSegmentConfig().label} routing saved.`);
  } catch {
    setRoutingMessage("Failed to save main admission lead routing.", true);
  }
}

async function clearRegisteredCandidateData() {
  const segmentConfig = getSegmentConfig();
  const registeredLeads = getAllRegisteredCandidateLeads().filter((lead) => getLeadSegment(lead) === activeSegment);
  const confirmed = window.confirm(`Clear only ${segmentConfig.label} data and reset its routing setup?`);
  if (!confirmed) {
    return;
  }

  const remainingLeads = getStoredLeads().filter((lead) => {
    if (!isRegisteredCandidateLead(lead)) {
      return true;
    }
    return getLeadSegment(lead) !== activeSegment;
  });
  const saveResult = await persistLeads(remainingLeads);
  if (!saveResult || saveResult.ok === false) {
    setRoutingMessage(saveResult?.message || "Failed to clear Main Admission Lead data.", true);
    return;
  }

  try {
    const response = await fetch(buildRoutingEndpoint(), {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({ segment: activeSegment, selectedCounselors: [], isConfigured: false })
    });
    const json = await response.json().catch(() => ({}));

    if (!response.ok) {
      setRoutingMessage(json?.message || "Main Admission Leads data was cleared, but routing reset failed.", true);
      return;
    }
  } catch {
    setRoutingMessage("Main Admission Leads data was cleared, but routing reset failed.", true);
    return;
  }

  const syncResult = await syncStateFromLocalAndVerify();
  if (!syncResult.ok) {
    setRoutingMessage(syncResult.message || "Main Admission Lead data was updated locally, but backend verification failed.", true);
    return;
  }

  mainAdmissionRoutingConfig = { selectedCounselors: [], isConfigured: false };
  selectedLeadKeys = new Set();
  currentPage = 1;
  renderRegisteredRoutingPanel();
  renderAll();
  setRoutingMessage(`Cleared ${registeredLeads.length} ${segmentConfig.clearLabel} lead${registeredLeads.length === 1 ? "" : "s"}.`);
  showToast(`${segmentConfig.label} data cleared.`);
}

function renderKpis(leads) {
  const interested = leads.filter((lead) => lead.mainAdmissionCourseStatus === "Interested").length;
  const enrolled = leads.filter((lead) => lead.mainAdmissionAdmissionStatus === "Enrolled").length;
  const won = leads.filter((lead) => lead.mainAdmissionAdmissionStatus === "Won").length;

  mainAdmissionKpiSection.innerHTML = `
    <article class="card kpi-card">
      <p>Overall Leads</p>
      <h2>${leads.length}</h2>
    </article>
    <article class="card kpi-card">
      <p>Interested Leads</p>
      <h2>${interested}</h2>
    </article>
    <article class="card kpi-card">
      <p>Enrolled</p>
      <h2>${enrolled}</h2>
    </article>
    <article class="card kpi-card">
      <p>Won</p>
      <h2>${won}</h2>
    </article>
  `;
}

function renderFilters(leads) {
  const segmentConfig = getSegmentConfig();
  const counselors = getUniqueValues(leads, "counselor");
  const courses = getUniqueValues(leads, "courseName");
  const locations = getUniqueValues(leads, "country");

  mainAdmissionFilterBar.innerHTML = `
    <div class="filter-section">
      <div class="filter-section-title">${escapeHtml(segmentConfig.label)} Filters</div>
      <div class="filter-row">
        <div class="filter-item">
          <label for="mainAdmissionSearchInput">Search Lead</label>
          <input id="mainAdmissionSearchInput" type="text" placeholder="Name, email, phone, course, counselor" value="${escapeHtml(filter.search)}" />
        </div>
        ${isAdmin ? `
        <div class="filter-item">
          <label for="mainAdmissionCounselorSelect">Counselor</label>
          <select id="mainAdmissionCounselorSelect">
            <option value="">All</option>
            ${counselors.map((item) => `<option value="${escapeHtml(item)}" ${filter.counselor === item ? "selected" : ""}>${escapeHtml(item)}</option>`).join("")}
          </select>
        </div>
        ` : ""}
        ${activeSegment === DEFAULT_SEGMENT ? `
        <div class="filter-item">
          <label for="mainAdmissionCourseSelect">Course Name</label>
          <select id="mainAdmissionCourseSelect">
            <option value="">All</option>
            ${courses.map((item) => `<option value="${escapeHtml(item)}" ${filter.courseName === item ? "selected" : ""}>${escapeHtml(item)}</option>`).join("")}
          </select>
        </div>
        ` : ""}
        <div class="filter-item">
          <label for="mainAdmissionLocationSelect">Country</label>
          <select id="mainAdmissionLocationSelect">
            <option value="">All</option>
            ${locations.map((item) => `<option value="${escapeHtml(item)}" ${filter.location === item ? "selected" : ""}>${escapeHtml(item)}</option>`).join("")}
          </select>
        </div>
        <div class="filter-item">
          <label for="mainAdmissionDialedSelect">Dialed</label>
          <select id="mainAdmissionDialedSelect">
            <option value="">All</option>
            <option value="Yes" ${filter.mainAdmissionDialed === "Yes" ? "selected" : ""}>Yes</option>
            <option value="No" ${filter.mainAdmissionDialed === "No" ? "selected" : ""}>No</option>
          </select>
        </div>
        <div class="filter-item">
          <label for="mainAdmissionCourseStatusSelect">Course Status</label>
          <select id="mainAdmissionCourseStatusSelect">
            <option value="">All</option>
            <option value="Interested" ${filter.mainAdmissionCourseStatus === "Interested" ? "selected" : ""}>Interested</option>
            <option value="Not Interested" ${filter.mainAdmissionCourseStatus === "Not Interested" ? "selected" : ""}>Not Interested</option>
          </select>
        </div>
        <div class="filter-item">
          <label for="mainAdmissionAdmissionStatusSelect">Admission</label>
          <select id="mainAdmissionAdmissionStatusSelect">
            <option value="">All</option>
            <option value="In-Conversation" ${filter.mainAdmissionAdmissionStatus === "In-Conversation" ? "selected" : ""}>In-Conversation</option>
            <option value="Enrolled" ${filter.mainAdmissionAdmissionStatus === "Enrolled" ? "selected" : ""}>Enrolled</option>
            <option value="Won" ${filter.mainAdmissionAdmissionStatus === "Won" ? "selected" : ""}>Won</option>
          </select>
        </div>
        <div class="filter-item">
          <label for="mainAdmissionCallStatusSelect">Call Status</label>
          <select id="mainAdmissionCallStatusSelect">
            <option value="">All</option>
            <option value="Connected" ${filter.mainAdmissionCallStatus === "Connected" ? "selected" : ""}>Connected</option>
            <option value="CBL" ${filter.mainAdmissionCallStatus === "CBL" ? "selected" : ""}>CBL</option>
            <option value="DNP" ${filter.mainAdmissionCallStatus === "DNP" ? "selected" : ""}>DNP</option>
            <option value="CNC" ${filter.mainAdmissionCallStatus === "CNC" ? "selected" : ""}>CNC</option>
          </select>
        </div>
        <div class="filter-item">
          <label for="mainAdmissionActivityStatusSelect">Activity Status</label>
          <select id="mainAdmissionActivityStatusSelect">
            <option value="">All</option>
            <option value="Untouched" ${filter.activityStatus === "Untouched" ? "selected" : ""}>Untouched</option>
            <option value="Updated" ${filter.activityStatus === "Updated" ? "selected" : ""}>Updated</option>
          </select>
        </div>
        <div class="filter-item filter-item-cta">
          <label>&nbsp;</label>
          <div class="filter-actions">
            <button id="mainAdmissionResetFiltersBtn" type="button" class="btn-ghost">Reset</button>
          </div>
        </div>
      </div>
    </div>
  `;

  document.getElementById("mainAdmissionSearchInput").oninput = (event) => {
    filter.search = event.target.value.trim();
    persistFilters();
    currentPage = 1;
    renderAll();
  };
  if (isAdmin) {
    document.getElementById("mainAdmissionCounselorSelect").onchange = (event) => {
      filter.counselor = event.target.value;
      persistFilters();
      currentPage = 1;
      renderAll();
    };
  }
  const courseSelect = document.getElementById("mainAdmissionCourseSelect");
  if (courseSelect) {
    courseSelect.onchange = (event) => {
      filter.courseName = event.target.value;
      persistFilters();
      currentPage = 1;
      renderAll();
    };
  } else {
    filter.courseName = "";
  }
  document.getElementById("mainAdmissionLocationSelect").onchange = (event) => {
    filter.location = event.target.value;
    persistFilters();
    currentPage = 1;
    renderAll();
  };
  document.getElementById("mainAdmissionDialedSelect").onchange = (event) => {
    filter.mainAdmissionDialed = event.target.value;
    persistFilters();
    currentPage = 1;
    renderAll();
  };
  document.getElementById("mainAdmissionCourseStatusSelect").onchange = (event) => {
    filter.mainAdmissionCourseStatus = event.target.value;
    persistFilters();
    currentPage = 1;
    renderAll();
  };
  document.getElementById("mainAdmissionAdmissionStatusSelect").onchange = (event) => {
    filter.mainAdmissionAdmissionStatus = event.target.value;
    persistFilters();
    currentPage = 1;
    renderAll();
  };
  document.getElementById("mainAdmissionCallStatusSelect").onchange = (event) => {
    filter.mainAdmissionCallStatus = event.target.value;
    persistFilters();
    currentPage = 1;
    renderAll();
  };
  document.getElementById("mainAdmissionActivityStatusSelect").onchange = (event) => {
    filter.activityStatus = event.target.value;
    persistFilters();
    currentPage = 1;
    renderAll();
  };
  document.getElementById("mainAdmissionResetFiltersBtn").onclick = () => {
    filter = { ...DEFAULT_FILTER };
    persistFilters();
    currentPage = 1;
    renderAll();
  };
}

function filterLeads(leads) {
  return leads.filter((lead) => {
    if (filter.search) {
      const haystack = [lead.name, lead.email, lead.phone, lead.courseName, lead.country, lead.counselor].join(" ").toLowerCase();
      if (!haystack.includes(filter.search.toLowerCase())) return false;
    }
    if (filter.counselor && filter.counselor !== lead.counselor) return false;
    if (activeSegment === DEFAULT_SEGMENT && filter.courseName && filter.courseName !== lead.courseName) return false;
    if (filter.location && filter.location !== (lead.country || "")) return false;
    if (filter.mainAdmissionDialed && filter.mainAdmissionDialed !== lead.mainAdmissionDialed) return false;
    if (filter.mainAdmissionCourseStatus && filter.mainAdmissionCourseStatus !== lead.mainAdmissionCourseStatus) return false;
    if (filter.mainAdmissionAdmissionStatus && filter.mainAdmissionAdmissionStatus !== lead.mainAdmissionAdmissionStatus) return false;
    if (filter.mainAdmissionCallStatus && filter.mainAdmissionCallStatus !== lead.mainAdmissionCallStatus) return false;
    if (filter.activityStatus === "Untouched" && lead.mainAdmissionActivityUpdates > 0) return false;
    if (filter.activityStatus === "Updated" && lead.mainAdmissionActivityUpdates === 0) return false;
    return true;
  });
}

function renderActivityPanel(lead) {
  const hasActivity = lead.mainAdmissionActivityUpdates > 0;
  const leadKey = escapeHtml(buildLeadKey(lead));
  const noteCount = lead.leadNotes.length;
  return `
    <div class="activity-panel">
      <button type="button" class="btn-update-status${hasActivity ? " btn-update-status--active" : ""}" data-main-admission-action="update" data-lead-key="${leadKey}">Update</button>
      <button type="button" class="btn-ghost btn-notes" data-main-admission-action="notes" data-lead-key="${leadKey}">Notes${noteCount ? ` (${noteCount})` : ""}</button>
      ${canCreateTasks ? `<button type="button" class="btn-ghost btn-task" data-main-admission-action="task" data-lead-key="${leadKey}">Task</button>` : ""}
      <button type="button" class="btn-ghost btn-activity-history" data-main-admission-action="activity-history" data-lead-key="${leadKey}">Activity History</button>
      ${isAdmin ? `<button type="button" class="btn-delete" data-main-admission-action="delete" data-lead-key="${leadKey}">Delete</button>` : ""}
    </div>
  `;
}

function renderLeadTable(leads) {
  const isCrashSegment = false;
  const totalPages = Math.ceil(leads.length / pageSize) || 1;
  if (currentPage > totalPages) currentPage = totalPages;
  const pageLeads = leads.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const assignableCounselors = getStoredCounselors()
    .map((item) => String(item.name || "").trim())
    .filter(Boolean)
    .filter((name, index, items) => items.indexOf(name) === index);

  const bulkToolbar = isAdmin ? `
    <div class="bulk-toolbar">
      <label class="bulk-select-control">
        <input id="mainAdmissionBulkSelect" type="checkbox" ${pageLeads.length && pageLeads.every((lead) => selectedLeadKeys.has(buildLeadKey(lead))) ? "checked" : ""} />
        <span>Select Page</span>
      </label>
      <div class="bulk-admin-tools">
        <div class="bulk-inline-group">
          <select id="mainAdmissionBulkAssignCounselor" class="bulk-assign-select">
            <option value="">Assign to</option>
            ${assignableCounselors.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("")}
          </select>
          <button id="mainAdmissionBulkAssignBtn" type="button" class="btn-ghost bulk-action-btn" ${selectedLeadKeys.size ? "" : "disabled"}>Assign Selected</button>
        </div>
      </div>
    </div>
  ` : "";

  mainAdmissionLeadTableSection.innerHTML = `
    ${bulkToolbar}
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            ${isAdmin ? "<th>Select</th>" : ""}
            <th>Lead Import Date</th>
            <th>${isCrashSegment ? "Full Name" : "Name"}</th>
            <th>${isCrashSegment ? "Contact Number" : "Phone Number"}</th>
            <th>${isCrashSegment ? "Mail ID" : "Email"}</th>
            <th>Course Name</th>
            <th>${isCrashSegment ? "Location" : "Country"}</th>
            <th>Counselor</th>
            <th>Activity</th>
          </tr>
        </thead>
        <tbody>
          ${pageLeads.length ? pageLeads.map((lead) => `
            <tr>
              ${isAdmin ? `<td><input type="checkbox" class="main-admission-lead-checkbox" data-lead-key="${escapeHtml(buildLeadKey(lead))}" ${selectedLeadKeys.has(buildLeadKey(lead)) ? "checked" : ""} /></td>` : ""}
              <td>${escapeHtml(lead.createdAt)}</td>
              <td>${escapeHtml(lead.name)}</td>
              <td>${escapeHtml(lead.phone || "-")}</td>
              <td>${escapeHtml(lead.email)}</td>
              <td>${escapeHtml(lead.courseName || "-")}</td>
              <td>${escapeHtml(lead.country || "India")}</td>
              <td>${escapeHtml(lead.counselor || "Unassigned")}</td>
              <td>${renderActivityPanel(lead)}</td>
            </tr>
          `).join("") : `<tr><td colspan="${isAdmin ? 9 : 8}">No main admission leads available for current filters.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;

  document.querySelectorAll("[data-main-admission-action='update']").forEach((button) => {
    button.onclick = () => openActivityModal(button.getAttribute("data-lead-key"));
  });
  document.querySelectorAll("[data-main-admission-action='notes']").forEach((button) => {
    button.onclick = () => openNotesModal(button.getAttribute("data-lead-key"));
  });
  document.querySelectorAll("[data-main-admission-action='task']").forEach((button) => {
    button.onclick = () => openTaskModal(button.getAttribute("data-lead-key"));
  });
  document.querySelectorAll("[data-main-admission-action='activity-history']").forEach((button) => {
    button.onclick = () => {
      const leadKey = button.getAttribute("data-lead-key");
      const lead = getAllLeads().find((item) => buildLeadKey(item) === leadKey);
      if (lead) {
        openActivityHistory(lead.id, lead.name, lead.email);
      }
    };
  });
  document.querySelectorAll("[data-main-admission-action='delete']").forEach((button) => {
    button.onclick = () => {
      void deleteRegisteredLead(button.getAttribute("data-lead-key"));
    };
  });
  document.querySelectorAll(".main-admission-lead-checkbox").forEach((checkbox) => {
    checkbox.onchange = () => {
      const key = checkbox.getAttribute("data-lead-key");
      if (!key) return;
      if (checkbox.checked) selectedLeadKeys.add(key);
      else selectedLeadKeys.delete(key);
      renderAll();
    };
  });

  const bulkSelect = document.getElementById("mainAdmissionBulkSelect");
  if (bulkSelect) {
    bulkSelect.onchange = () => {
      pageLeads.forEach((lead) => {
        const key = buildLeadKey(lead);
        if (bulkSelect.checked) selectedLeadKeys.add(key);
        else selectedLeadKeys.delete(key);
      });
      renderAll();
    };
  }

  const bulkAssignBtn = document.getElementById("mainAdmissionBulkAssignBtn");
  const bulkAssignCounselor = document.getElementById("mainAdmissionBulkAssignCounselor");
  if (bulkAssignBtn && bulkAssignCounselor) {
    bulkAssignBtn.onclick = async () => {
      const targetCounselor = bulkAssignCounselor.value;
      if (!targetCounselor) {
        showToast("Select a counselor first.", true);
        return;
      }

      const refs = leads.filter((lead) => selectedLeadKeys.has(buildLeadKey(lead))).map(buildLeadRef);
      const result = await assignLeadsOnServer(refs, targetCounselor);
      if (!result || result.ok === false) {
        showToast(result?.message || "Failed to assign selected leads.", true);
        return;
      }

      selectedLeadKeys = new Set();
      setMessage(`Assigned ${refs.length} lead${refs.length === 1 ? "" : "s"} to ${targetCounselor}.`);
      showToast(`Assigned ${refs.length} lead${refs.length === 1 ? "" : "s"} to ${targetCounselor}.`);
      renderAll();
    };
  }

  renderPagination(totalPages, leads.length);
}

function renderPagination(totalPages, totalLeads) {
  if (totalPages <= 1) {
    mainAdmissionPaginationSection.innerHTML = "";
    return;
  }

  mainAdmissionPaginationSection.innerHTML = `
    <button type="button" class="btn-ghost" id="mainAdmissionPrevPageBtn" ${currentPage === 1 ? "disabled" : ""}>Previous</button>
    <span>Page ${currentPage} of ${totalPages} • ${totalLeads} leads</span>
    <button type="button" class="btn-ghost" id="mainAdmissionNextPageBtn" ${currentPage === totalPages ? "disabled" : ""}>Next</button>
  `;

  document.getElementById("mainAdmissionPrevPageBtn").onclick = () => {
    currentPage -= 1;
    renderAll();
  };
  document.getElementById("mainAdmissionNextPageBtn").onclick = () => {
    currentPage += 1;
    renderAll();
  };
}

function openActivityModal(leadKey) {
  const lead = getAllLeads().find((item) => buildLeadKey(item) === leadKey);
  if (!lead) return;
  if (isCounselorSession() && String(lead.counselor || "").trim().toLowerCase() !== getCounselorIdentity()) {
    showToast("Only the assigned counselor can update this lead.", true);
    return;
  }

  activeLeadRef = buildLeadRef(lead);
  setRegisteredActivityModalMode("edit");
  populateActivityModal(lead);
  document.getElementById("mainAdmissionActivityModal").classList.remove("hidden");
}


function setRegisteredActivityModalMode(mode) {
  mainAdmissionActivityModalMode = mode === "view" ? "view" : "edit";
  const title = document.getElementById("mainAdmissionActivityModalTitle");
  const saveButton = document.getElementById("saveMainAdmissionActivityBtn");
  const isView = mainAdmissionActivityModalMode === "view";

  if (title) {
    title.textContent = isView ? "Activity Details" : "Update Main Admission Lead Activity";
  }
  if (saveButton) {
    saveButton.classList.toggle("hidden", isView);
  }
  [
    "modalMainAdmissionDialed",
    "modalMainAdmissionCoursePitched",
    "modalMainAdmissionCourseStatus",
    "modalMainAdmissionAdmissionStatus",
    "modalMainAdmissionCallStatus"
  ].forEach((id) => {
    const field = document.getElementById(id);
    if (field) {
      field.disabled = isView;
    }
  });
}

function populateActivityModal(lead) {
  document.getElementById("modalMainAdmissionDialed").value = lead.mainAdmissionDialed;
  document.getElementById("modalMainAdmissionCoursePitched").value = lead.mainAdmissionCoursePitched;
  document.getElementById("modalMainAdmissionCourseStatus").value = lead.mainAdmissionCourseStatus;
  document.getElementById("modalMainAdmissionAdmissionStatus").value = lead.mainAdmissionAdmissionStatus;
  document.getElementById("modalMainAdmissionCallStatus").value = lead.mainAdmissionCallStatus;
}

function closeActivityModal() {
  document.getElementById("mainAdmissionActivityModal").classList.add("hidden");
  activeLeadRef = null;
  setRegisteredActivityModalMode("edit");
}

async function saveActivity(event) {
  event.preventDefault();
  const lead = findLeadByRef(activeLeadRef);
  if (!lead) return;

  const result = await updateLeadActivityOnServer(lead.id, {
    stage: "main-admission",
    leadEmail: lead.email || "",
    updates: {
      mainAdmissionDialed: document.getElementById("modalMainAdmissionDialed").value,
      mainAdmissionCoursePitched: document.getElementById("modalMainAdmissionCoursePitched").value,
      mainAdmissionCourseStatus: document.getElementById("modalMainAdmissionCourseStatus").value,
      mainAdmissionAdmissionStatus: document.getElementById("modalMainAdmissionAdmissionStatus").value,
      mainAdmissionCallStatus: document.getElementById("modalMainAdmissionCallStatus").value,
      mainAdmissionActivityUpdated: true
    }
  });

  if (!result || result.ok === false) {
    showToast(result?.message || "Failed to save lead activity.", true);
    return;
  }

  closeActivityModal();
  setMessage("Main admission lead activity saved successfully.");
  showToast("Main admission lead activity saved successfully.");
  renderAll();
}

async function deleteRegisteredLead(leadKey) {
  if (!isAdmin) {
    return;
  }

  const lead = getAllLeads().find((item) => buildLeadKey(item) === leadKey);
  if (!lead) {
    showToast("Lead not found.", true);
    return;
  }

  const confirmed = window.confirm("Delete this main admission lead? This cannot be undone.");
  if (!confirmed) {
    return;
  }

  const remainingLeads = getStoredLeads().filter((item) => buildLeadKey(item) !== leadKey);
  const saveResult = await persistLeads(remainingLeads);
  if (!saveResult || saveResult.ok === false) {
    showToast(saveResult?.message || "Failed to delete lead.", true);
    return;
  }

  const syncResult = await syncStateFromLocalAndVerify();
  if (!syncResult.ok) {
    showToast(syncResult.message || "Lead deleted locally, but backend verification failed.", true);
    return;
  }

  selectedLeadKeys.delete(leadKey);
  setMessage("Main admission lead deleted successfully.");
  showToast("Main admission lead deleted.");
  renderAll();
}

function canEditLeadNotes(lead) {
  if (isAdmin) return true;
  return String(lead?.counselor || "").trim().toLowerCase() === getCounselorIdentity();
}

function openNotesModal(leadKey) {
  const lead = getAllLeads().find((item) => buildLeadKey(item) === leadKey);
  if (!lead) return;

  notesLeadRef = buildLeadRef(lead);
  const listSection = document.getElementById("mainAdmissionNotesListSection");
  const canEdit = canEditLeadNotes(lead);
  listSection.innerHTML = lead.leadNotes.length
    ? lead.leadNotes.map((note, index) => `
        <div class="note-item">
          <span class="note-text">${escapeHtml(note.text)}</span>
          <span class="note-meta">${escapeHtml(note.by || "")}${note.by && note.at ? " - " : ""}${escapeHtml(note.at || "")}</span>
          ${canEdit ? `<button type="button" class="btn-ghost main-admission-note-delete-btn" data-note-index="${index}" style="font-size:0.75rem;padding:2px 6px;">Delete</button>` : ""}
        </div>
      `).join("")
    : `<p class="block-help">${canEdit ? "No notes yet. Add one below." : "No notes yet."}</p>`;

  document.getElementById("mainAdmissionNewNoteInput").value = "";
  document.getElementById("mainAdmissionSaveNoteBtn").classList.toggle("hidden", !canEdit);
  document.getElementById("mainAdmissionNewNoteInput").closest(".modal-row").classList.toggle("hidden", !canEdit);
  document.getElementById("mainAdmissionNotesModal").classList.remove("hidden");

  document.querySelectorAll(".main-admission-note-delete-btn").forEach((button) => {
    button.onclick = async () => {
      const noteIndex = Number(button.getAttribute("data-note-index"));
      const currentLead = findLeadByRef(notesLeadRef);
      if (!currentLead) return;
      const result = await deleteLeadNote(currentLead.id, noteIndex, currentLead.email || "");
      if (!result || result.ok === false) {
        showToast(result?.message || "Failed to delete note.", true);
        return;
      }
      openNotesModal(leadKey);
      showToast("Note deleted.");
    };
  });
}

function closeNotesModal() {
  document.getElementById("mainAdmissionNotesModal").classList.add("hidden");
  notesLeadRef = null;
}

async function saveNote() {
  const lead = findLeadByRef(notesLeadRef);
  if (!lead) return;
  const text = document.getElementById("mainAdmissionNewNoteInput").value.trim();
  if (!text) return;

  const result = await addLeadNote(lead.id, text, lead.email || "");
  if (!result || result.ok === false) {
    showToast(result?.message || "Failed to save note.", true);
    return;
  }

  openNotesModal(buildLeadKey(lead));
  showToast("Note saved.");
}

function setTaskMessage(message, isError = true) {
  if (!mainAdmissionTaskMessage) {
    return;
  }

  mainAdmissionTaskMessage.textContent = message;
  mainAdmissionTaskMessage.style.color = isError ? "var(--danger)" : "var(--success)";
}

function closeTaskModal() {
  if (mainAdmissionTaskModal) {
    mainAdmissionTaskModal.classList.add("hidden");
  }
  setTaskMessage("");
}

function openTaskModal(leadKey) {
  if (!canCreateTasks) {
    return;
  }

  const lead = getScopedLeads(getAllLeads()).find((item) => buildLeadKey(item) === leadKey);
  if (!lead) {
    return;
  }

  mainAdmissionTaskLeadIdInput.value = lead.id;
  mainAdmissionTaskCategoryInput.value = TASK_CATEGORY.mainAdmission || TASK_CATEGORY.registered;
  mainAdmissionTaskLeadNameInput.value = lead.name || "";
  mainAdmissionTaskLeadPhoneInput.value = lead.phone || "-";
  mainAdmissionTaskCounselorInput.value = lead.counselor || "Unassigned";
  mainAdmissionTaskTitleInput.value = `Follow up with ${lead.name || "lead"}`;
  mainAdmissionTaskNotesInput.value = "";
  mainAdmissionTaskDueDateInput.value = "";
  setTaskMessage("");
  mainAdmissionTaskModalTitle.textContent = "Create Main Admission Lead Task";
  mainAdmissionTaskModal.classList.remove("hidden");
}

async function handleTaskSubmit(event) {
  event.preventDefault();

  const leadId = mainAdmissionTaskLeadIdInput.value;
  const title = mainAdmissionTaskTitleInput.value.trim();
  const dueDate = mainAdmissionTaskDueDateInput.value;

  if (!leadId || !title || !dueDate) {
    setTaskMessage("Title and due date are required.", true);
    return;
  }

  const lead = getAllLeads().find((item) => String(item.id) === String(leadId));
  if (!lead) {
    setTaskMessage("Lead not found.", true);
    return;
  }

  const taskResult = await createTask({
    leadId: lead.id,
    leadName: lead.name,
    leadPhone: lead.phone || "",
    leadCounselor: lead.counselor || "Unassigned",
    counselor: lead.counselor || session?.name || "Unassigned",
    category: TASK_CATEGORY.mainAdmission || TASK_CATEGORY.registered,
    title,
    notes: mainAdmissionTaskNotesInput.value.trim(),
    dueDate
  });

  if (!taskResult || taskResult.ok === false) {
    setTaskMessage(taskResult?.message || "Failed to save task. Please check your connection and try again.", true);
    return;
  }

  setTaskMessage("Task created and sent to Task Tracker.", false);
  closeTaskModal();
  showToast("Task created and sent to Task Tracker.");
}

function setupRegisteredRoutingPanel() {
  renderSegmentSection();
  renderRegisteredRoutingPanel();

  if (!isAdmin) {
    return;
  }

  if (clearMainAdmissionLeadDataBtn) {
    clearMainAdmissionLeadDataBtn.onclick = () => {
      void clearRegisteredCandidateData();
    };
  }
}

function renderAll() {
  renderAdmissionSectionNav();
  renderSegmentSection();
  const allLeads = getScopedLeads(getAllLeads());
  const filteredLeads = filterLeads(allLeads);
  renderRegisteredRoutingPanel();
  renderKpis(filteredLeads);
  renderFilters(allLeads);
  renderLeadTable(filteredLeads);
}

document.getElementById("mainAdmissionActivityForm").onsubmit = saveActivity;
document.getElementById("closeMainAdmissionModalBtn").onclick = closeActivityModal;
document.getElementById("closeMainAdmissionNotesModalBtn").onclick = closeNotesModal;
document.getElementById("mainAdmissionSaveNoteBtn").onclick = () => {
  void saveNote();
};
if (mainAdmissionTaskModal && mainAdmissionTaskForm) {
  document.getElementById("closeMainAdmissionTaskModalBtn").onclick = closeTaskModal;
  mainAdmissionTaskForm.onsubmit = handleTaskSubmit;
}

setupRegisteredRoutingPanel();
renderAll();
const stopStatePolling = startStatePolling(() => {
  renderAll();
});
registerPageCleanup(stopStatePolling);
