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

const registeredRoutingPanel = document.getElementById("registeredRoutingPanel");
const registeredRoutingOptions = document.getElementById("registeredRoutingOptions");
const saveRegisteredRoutingBtn = document.getElementById("saveRegisteredRoutingBtn");
const clearRegisteredCandidateDataBtn = document.getElementById("clearRegisteredCandidateDataBtn");
const registeredRoutingMessage = document.getElementById("registeredRoutingMessage");
const registeredKpiSection = document.getElementById("registeredKpiSection");
const registeredFilterBar = document.getElementById("registeredFilterBar");
const registeredActivityMessage = document.getElementById("registeredActivityMessage");
const registeredLeadTableSection = document.getElementById("registeredLeadTableSection");
const registeredPaginationSection = document.getElementById("registeredPaginationSection");
const registeredTaskModal = document.getElementById("registeredTaskModal");
const registeredTaskModalTitle = document.getElementById("registeredTaskModalTitle");
const registeredTaskForm = document.getElementById("registeredTaskForm");
const registeredTaskLeadIdInput = document.getElementById("registeredTaskLeadId");
const registeredTaskCategoryInput = document.getElementById("registeredTaskCategory");
const registeredTaskLeadNameInput = document.getElementById("registeredTaskLeadName");
const registeredTaskLeadPhoneInput = document.getElementById("registeredTaskLeadPhone");
const registeredTaskCounselorInput = document.getElementById("registeredTaskCounselor");
const registeredTaskTitleInput = document.getElementById("registeredTaskTitle");
const registeredTaskNotesInput = document.getElementById("registeredTaskNotes");
const registeredTaskDueDateInput = document.getElementById("registeredTaskDueDate");
const registeredTaskMessage = document.getElementById("registeredTaskMessage");

const FILTER_STORAGE_KEY = "dvRegisteredCandidatesFilters";
const PUBLIC_COURSE_ROUTING_ENDPOINT = apiUrl("/api/public-course-routing");
const DEFAULT_FILTER = {
  search: "",
  counselor: "",
  courseName: "",
  registeredDialed: "",
  registeredCourseStatus: "",
  registeredAdmissionStatus: "",
  registeredCallStatus: "",
  activityStatus: ""
};

const persistedFilter = await loadPersistedValue(FILTER_STORAGE_KEY, {});
let filter = { ...DEFAULT_FILTER, ...persistedFilter };
let currentPage = 1;
const pageSize = 50;
let selectedLeadKeys = new Set();
let activeLeadRef = null;
let notesLeadRef = null;
let registeredRoutingConfig = { selectedCounselors: [], isConfigured: false };
let registeredActivityModalMode = "edit";

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
  return String(lead?.leadPipeline || "").trim().toLowerCase() === "course-registration";
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
    lead.registeredDialed = lead.registeredDialed || "";
    lead.registeredCoursePitched = lead.registeredCoursePitched || "";
    lead.registeredCourseStatus = lead.registeredCourseStatus || "";
    lead.registeredAdmissionStatus = lead.registeredAdmissionStatus || "";
    lead.registeredCallStatus = lead.registeredCallStatus || "";
    lead.registeredActivityUpdated = typeof lead.registeredActivityUpdated === "boolean" ? lead.registeredActivityUpdated : false;
    lead.registeredCourseActivityHistory = Array.isArray(lead.registeredCourseActivityHistory) ? lead.registeredCourseActivityHistory : [];
    lead.registeredCourseActivityUpdates = lead.registeredCourseActivityHistory.length
      || (Number.isFinite(Number(lead.registeredCourseActivityUpdates)) ? Number(lead.registeredCourseActivityUpdates) : 0);
    lead.leadNotes = Array.isArray(lead.leadNotes) ? lead.leadNotes : [];
  });
}

function getStoredRegisteredCandidateLeads() {
  const leads = getStoredLeads().filter(isRegisteredCandidateLead);
  normalizeLeadFields(leads);
  return leads;
}

function getAllLeads() {
  return getStoredRegisteredCandidateLeads();
}

function setRoutingMessage(message, isError = false) {
  if (!registeredRoutingMessage) {
    return;
  }

  registeredRoutingMessage.textContent = message;
  registeredRoutingMessage.style.color = isError ? "var(--danger)" : "var(--success)";
}

function getScopedLeads(leads) {
  if (!isCounselorSession()) {
    return leads;
  }

  const counselorIdentity = getCounselorIdentity();
  return leads.filter((lead) => String(lead.counselor || "").trim().toLowerCase() === counselorIdentity);
}

function setMessage(message, isError = false) {
  registeredActivityMessage.textContent = message;
  registeredActivityMessage.style.color = isError ? "var(--danger)" : "var(--success)";
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
  const leads = getAllLeads();
  return leads.find((lead) => buildLeadKey(lead) === buildLeadKey(leadRef)) || null;
}

function getUniqueValues(leads, key) {
  return [...new Set(leads.map((lead) => String(lead[key] || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function getEffectiveRegisteredRoutingSelection(counselorNames) {
  const selectedCounselors = Array.isArray(registeredRoutingConfig.selectedCounselors)
    ? registeredRoutingConfig.selectedCounselors.map((name) => String(name || "").trim()).filter(Boolean)
    : [];
  const selectedCounselorSet = new Set(selectedCounselors.map((name) => name.toLowerCase()));
  const validSelected = counselorNames.filter((name) => selectedCounselorSet.has(String(name || "").trim().toLowerCase()));

  if (registeredRoutingConfig.isConfigured) {
    return validSelected;
  }

  return validSelected.length ? validSelected : counselorNames;
}

function renderRegisteredRoutingPanel() {
  if (!registeredRoutingPanel || !registeredRoutingOptions) {
    return;
  }

  if (!isAdmin) {
    registeredRoutingPanel.classList.add("hidden");
    return;
  }

  registeredRoutingPanel.classList.remove("hidden");
  const counselorNames = getActiveCounselorNames();
  const selectedCounselors = getEffectiveRegisteredRoutingSelection(counselorNames);

  if (!counselorNames.length) {
    registeredRoutingOptions.innerHTML = `<p class="block-help">No counselors are available yet. Add counselors first.</p>`;
    if (saveRegisteredRoutingBtn) saveRegisteredRoutingBtn.disabled = true;
    if (clearRegisteredCandidateDataBtn) clearRegisteredCandidateDataBtn.disabled = false;
    return;
  }

  registeredRoutingOptions.innerHTML = `
    <div class="round-robin-list">
      ${counselorNames.map((name) => `
        <label class="round-robin-option">
          <input
            type="checkbox"
            class="registered-routing-checkbox"
            value="${escapeHtml(name)}"
            ${selectedCounselors.includes(name) ? "checked" : ""}
          />
          <span>${escapeHtml(name)}</span>
        </label>
      `).join("")}
    </div>
    <p class="block-help">Registered candidates are assigned one by one in a repeating round robin order across the selected counselors.</p>
  `;

  if (saveRegisteredRoutingBtn) saveRegisteredRoutingBtn.disabled = false;
  if (clearRegisteredCandidateDataBtn) clearRegisteredCandidateDataBtn.disabled = false;
}

async function loadRegisteredRoutingConfig() {
  if (!isAdmin) {
    return;
  }

  try {
    const response = await fetch(PUBLIC_COURSE_ROUTING_ENDPOINT, {
      method: "GET",
      headers: { Accept: "application/json" }
    });
    const json = await response.json().catch(() => ({}));

    if (!response.ok) {
      setRoutingMessage(json?.message || "Failed to load registered candidate routing.", true);
      return;
    }

    registeredRoutingConfig = {
      selectedCounselors: Array.isArray(json?.selectedCounselors) ? json.selectedCounselors : [],
      isConfigured: Boolean(json?.isConfigured)
    };
    renderRegisteredRoutingPanel();
  } catch {
    setRoutingMessage("Failed to load registered candidate routing.", true);
  }
}

async function saveRegisteredRoutingConfig() {
  const selectedCounselors = Array.from(document.querySelectorAll(".registered-routing-checkbox:checked"))
    .map((input) => String(input.value || "").trim())
    .filter(Boolean);

  if (!selectedCounselors.length) {
    setRoutingMessage("Select at least one counselor for registered candidate routing.", true);
    return;
  }

  try {
    const response = await fetch(PUBLIC_COURSE_ROUTING_ENDPOINT, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({ selectedCounselors, isConfigured: true })
    });
    const json = await response.json().catch(() => ({}));

    if (!response.ok) {
      setRoutingMessage(json?.message || "Failed to save registered candidate routing.", true);
      return;
    }

    registeredRoutingConfig = {
      selectedCounselors: Array.isArray(json?.selectedCounselors) ? json.selectedCounselors : selectedCounselors,
      isConfigured: Boolean(json?.isConfigured ?? true)
    };
    renderRegisteredRoutingPanel();
    setRoutingMessage("Registered candidate routing saved successfully.");
    showToast("Registered candidate routing saved.");
  } catch {
    setRoutingMessage("Failed to save registered candidate routing.", true);
  }
}

async function clearRegisteredCandidateData() {
  const registeredLeads = getStoredRegisteredCandidateLeads();
  const confirmed = window.confirm("Clear only Registered Candidate data and reset its routing setup?");
  if (!confirmed) {
    return;
  }

  const remainingLeads = getStoredLeads().filter((lead) => !isRegisteredCandidateLead(lead));
  const saveResult = await persistLeads(remainingLeads);
  if (!saveResult || saveResult.ok === false) {
    setRoutingMessage(saveResult?.message || "Failed to clear Registered Candidate data.", true);
    return;
  }

  try {
    const response = await fetch(PUBLIC_COURSE_ROUTING_ENDPOINT, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({ selectedCounselors: [], isConfigured: false })
    });
    const json = await response.json().catch(() => ({}));

    if (!response.ok) {
      setRoutingMessage(json?.message || "Registered Candidate leads were cleared, but routing reset failed.", true);
      return;
    }
  } catch {
    setRoutingMessage("Registered Candidate leads were cleared, but routing reset failed.", true);
    return;
  }

  const syncResult = await syncStateFromLocalAndVerify();
  if (!syncResult.ok) {
    setRoutingMessage(syncResult.message || "Registered Candidate data was updated locally, but backend verification failed.", true);
    return;
  }

  registeredRoutingConfig = { selectedCounselors: [], isConfigured: false };
  selectedLeadKeys = new Set();
  currentPage = 1;
  renderRegisteredRoutingPanel();
  renderAll();
  setRoutingMessage(`Cleared ${registeredLeads.length} Registered Candidate lead${registeredLeads.length === 1 ? "" : "s"}.`);
  showToast("Registered Candidate data cleared.");
}

function renderKpis(leads) {
  const interested = leads.filter((lead) => lead.registeredCourseStatus === "Interested").length;
  const enrolled = leads.filter((lead) => lead.registeredAdmissionStatus === "Enrolled").length;
  const won = leads.filter((lead) => lead.registeredAdmissionStatus === "Won").length;

  registeredKpiSection.innerHTML = `
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
  const counselors = getUniqueValues(leads, "counselor");
  const courses = getUniqueValues(leads, "courseName");

  registeredFilterBar.innerHTML = `
    <div class="filter-section">
      <div class="filter-section-title">Registered Candidate Filters</div>
      <div class="filter-row">
        <div class="filter-item">
          <label for="registeredSearchInput">Search Lead</label>
          <input id="registeredSearchInput" type="text" placeholder="Name, email, phone, course, counselor" value="${escapeHtml(filter.search)}" />
        </div>
        ${isAdmin ? `
        <div class="filter-item">
          <label for="registeredCounselorSelect">Counselor</label>
          <select id="registeredCounselorSelect">
            <option value="">All</option>
            ${counselors.map((item) => `<option value="${escapeHtml(item)}" ${filter.counselor === item ? "selected" : ""}>${escapeHtml(item)}</option>`).join("")}
          </select>
        </div>
        ` : ""}
        <div class="filter-item">
          <label for="registeredCourseSelect">Course Name</label>
          <select id="registeredCourseSelect">
            <option value="">All</option>
            ${courses.map((item) => `<option value="${escapeHtml(item)}" ${filter.courseName === item ? "selected" : ""}>${escapeHtml(item)}</option>`).join("")}
          </select>
        </div>
        <div class="filter-item">
          <label for="registeredDialedSelect">Dialed</label>
          <select id="registeredDialedSelect">
            <option value="">All</option>
            <option value="Yes" ${filter.registeredDialed === "Yes" ? "selected" : ""}>Yes</option>
            <option value="No" ${filter.registeredDialed === "No" ? "selected" : ""}>No</option>
          </select>
        </div>
        <div class="filter-item">
          <label for="registeredCourseStatusSelect">Course Status</label>
          <select id="registeredCourseStatusSelect">
            <option value="">All</option>
            <option value="Interested" ${filter.registeredCourseStatus === "Interested" ? "selected" : ""}>Interested</option>
            <option value="Not Interested" ${filter.registeredCourseStatus === "Not Interested" ? "selected" : ""}>Not Interested</option>
          </select>
        </div>
        <div class="filter-item">
          <label for="registeredAdmissionStatusSelect">Admission</label>
          <select id="registeredAdmissionStatusSelect">
            <option value="">All</option>
            <option value="In-Conversation" ${filter.registeredAdmissionStatus === "In-Conversation" ? "selected" : ""}>In-Conversation</option>
            <option value="Enrolled" ${filter.registeredAdmissionStatus === "Enrolled" ? "selected" : ""}>Enrolled</option>
            <option value="Won" ${filter.registeredAdmissionStatus === "Won" ? "selected" : ""}>Won</option>
          </select>
        </div>
        <div class="filter-item">
          <label for="registeredCallStatusSelect">Call Status</label>
          <select id="registeredCallStatusSelect">
            <option value="">All</option>
            <option value="Connected" ${filter.registeredCallStatus === "Connected" ? "selected" : ""}>Connected</option>
            <option value="CBL" ${filter.registeredCallStatus === "CBL" ? "selected" : ""}>CBL</option>
            <option value="DNP" ${filter.registeredCallStatus === "DNP" ? "selected" : ""}>DNP</option>
            <option value="CNC" ${filter.registeredCallStatus === "CNC" ? "selected" : ""}>CNC</option>
          </select>
        </div>
        <div class="filter-item">
          <label for="registeredActivityStatusSelect">Activity Status</label>
          <select id="registeredActivityStatusSelect">
            <option value="">All</option>
            <option value="Untouched" ${filter.activityStatus === "Untouched" ? "selected" : ""}>Untouched</option>
            <option value="Updated" ${filter.activityStatus === "Updated" ? "selected" : ""}>Updated</option>
          </select>
        </div>
        <div class="filter-item filter-item-cta">
          <label>&nbsp;</label>
          <div class="filter-actions">
            <button id="registeredResetFiltersBtn" type="button" class="btn-ghost">Reset</button>
          </div>
        </div>
      </div>
    </div>
  `;

  document.getElementById("registeredSearchInput").oninput = (event) => {
    filter.search = event.target.value.trim();
    persistFilters();
    currentPage = 1;
    renderAll();
  };
  if (isAdmin) {
    document.getElementById("registeredCounselorSelect").onchange = (event) => {
      filter.counselor = event.target.value;
      persistFilters();
      currentPage = 1;
      renderAll();
    };
  }
  document.getElementById("registeredCourseSelect").onchange = (event) => {
    filter.courseName = event.target.value;
    persistFilters();
    currentPage = 1;
    renderAll();
  };
  document.getElementById("registeredDialedSelect").onchange = (event) => {
    filter.registeredDialed = event.target.value;
    persistFilters();
    currentPage = 1;
    renderAll();
  };
  document.getElementById("registeredCourseStatusSelect").onchange = (event) => {
    filter.registeredCourseStatus = event.target.value;
    persistFilters();
    currentPage = 1;
    renderAll();
  };
  document.getElementById("registeredAdmissionStatusSelect").onchange = (event) => {
    filter.registeredAdmissionStatus = event.target.value;
    persistFilters();
    currentPage = 1;
    renderAll();
  };
  document.getElementById("registeredCallStatusSelect").onchange = (event) => {
    filter.registeredCallStatus = event.target.value;
    persistFilters();
    currentPage = 1;
    renderAll();
  };
  document.getElementById("registeredActivityStatusSelect").onchange = (event) => {
    filter.activityStatus = event.target.value;
    persistFilters();
    currentPage = 1;
    renderAll();
  };
  document.getElementById("registeredResetFiltersBtn").onclick = () => {
    filter = { ...DEFAULT_FILTER };
    persistFilters();
    currentPage = 1;
    renderAll();
  };
}

function filterLeads(leads) {
  return leads.filter((lead) => {
    if (filter.search) {
      const haystack = [lead.name, lead.email, lead.phone, lead.courseName, lead.counselor].join(" ").toLowerCase();
      if (!haystack.includes(filter.search.toLowerCase())) return false;
    }
    if (filter.counselor && filter.counselor !== lead.counselor) return false;
    if (filter.courseName && filter.courseName !== lead.courseName) return false;
    if (filter.registeredDialed && filter.registeredDialed !== lead.registeredDialed) return false;
    if (filter.registeredCourseStatus && filter.registeredCourseStatus !== lead.registeredCourseStatus) return false;
    if (filter.registeredAdmissionStatus && filter.registeredAdmissionStatus !== lead.registeredAdmissionStatus) return false;
    if (filter.registeredCallStatus && filter.registeredCallStatus !== lead.registeredCallStatus) return false;
    if (filter.activityStatus === "Untouched" && lead.registeredCourseActivityUpdates > 0) return false;
    if (filter.activityStatus === "Updated" && lead.registeredCourseActivityUpdates === 0) return false;
    return true;
  });
}

function renderActivityPanel(lead) {
  const hasActivity = lead.registeredCourseActivityUpdates > 0;
  const leadKey = escapeHtml(buildLeadKey(lead));
  const noteCount = lead.leadNotes.length;
  return `
    <div class="activity-panel">
      <button type="button" class="btn-update-status${hasActivity ? " btn-update-status--active" : ""}" data-registered-action="update" data-lead-key="${leadKey}">Update</button>
      <button type="button" class="btn-ghost btn-notes" data-registered-action="notes" data-lead-key="${leadKey}">Notes${noteCount ? ` (${noteCount})` : ""}</button>
      ${canCreateTasks ? `<button type="button" class="btn-ghost btn-task" data-registered-action="task" data-lead-key="${leadKey}">Task</button>` : ""}
      <button type="button" class="btn-ghost btn-activity-history" data-registered-action="activity-history" data-lead-key="${leadKey}">Activity History</button>
      ${isAdmin ? `<button type="button" class="btn-delete" data-registered-action="delete" data-lead-key="${leadKey}">Delete</button>` : ""}
    </div>
  `;
}

function renderLeadTable(leads) {
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
        <input id="registeredBulkSelect" type="checkbox" ${pageLeads.length && pageLeads.every((lead) => selectedLeadKeys.has(buildLeadKey(lead))) ? "checked" : ""} />
        <span>Select Page</span>
      </label>
      <div class="bulk-admin-tools">
        <div class="bulk-inline-group">
          <select id="registeredBulkAssignCounselor" class="bulk-assign-select">
            <option value="">Assign to</option>
            ${assignableCounselors.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("")}
          </select>
          <button id="registeredBulkAssignBtn" type="button" class="btn-ghost bulk-action-btn" ${selectedLeadKeys.size ? "" : "disabled"}>Assign Selected</button>
        </div>
      </div>
    </div>
  ` : "";

  registeredLeadTableSection.innerHTML = `
    ${bulkToolbar}
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            ${isAdmin ? "<th>Select</th>" : ""}
            <th>Lead Import Date</th>
            <th>Name</th>
            <th>Phone Number</th>
            <th>Email</th>
            <th>Course Name</th>
            <th>Counselor</th>
            <th>Activity</th>
          </tr>
        </thead>
        <tbody>
          ${pageLeads.length ? pageLeads.map((lead) => `
            <tr>
              ${isAdmin ? `<td><input type="checkbox" class="registered-lead-checkbox" data-lead-key="${escapeHtml(buildLeadKey(lead))}" ${selectedLeadKeys.has(buildLeadKey(lead)) ? "checked" : ""} /></td>` : ""}
              <td>${escapeHtml(lead.createdAt)}</td>
              <td>${escapeHtml(lead.name)}</td>
              <td>${escapeHtml(lead.phone || "-")}</td>
              <td>${escapeHtml(lead.email)}</td>
              <td>${escapeHtml(lead.courseName)}</td>
              <td>${escapeHtml(lead.counselor || "Unassigned")}</td>
              <td>${renderActivityPanel(lead)}</td>
            </tr>
          `).join("") : `<tr><td colspan="${isAdmin ? 8 : 7}">No registered candidates available for current filters.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;

  document.querySelectorAll("[data-registered-action='update']").forEach((button) => {
    button.onclick = () => openActivityModal(button.getAttribute("data-lead-key"));
  });
  document.querySelectorAll("[data-registered-action='notes']").forEach((button) => {
    button.onclick = () => openNotesModal(button.getAttribute("data-lead-key"));
  });
  document.querySelectorAll("[data-registered-action='task']").forEach((button) => {
    button.onclick = () => openTaskModal(button.getAttribute("data-lead-key"));
  });
  document.querySelectorAll("[data-registered-action='activity-history']").forEach((button) => {
    button.onclick = () => {
      const leadKey = button.getAttribute("data-lead-key");
      const lead = getAllLeads().find((item) => buildLeadKey(item) === leadKey);
      if (lead) {
        openActivityHistory(lead.id, lead.name, lead.email);
      }
    };
  });
  document.querySelectorAll("[data-registered-action='delete']").forEach((button) => {
    button.onclick = () => {
      void deleteRegisteredLead(button.getAttribute("data-lead-key"));
    };
  });
  document.querySelectorAll(".registered-lead-checkbox").forEach((checkbox) => {
    checkbox.onchange = () => {
      const key = checkbox.getAttribute("data-lead-key");
      if (!key) return;
      if (checkbox.checked) selectedLeadKeys.add(key);
      else selectedLeadKeys.delete(key);
      renderAll();
    };
  });

  const bulkSelect = document.getElementById("registeredBulkSelect");
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

  const bulkAssignBtn = document.getElementById("registeredBulkAssignBtn");
  const bulkAssignCounselor = document.getElementById("registeredBulkAssignCounselor");
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
    registeredPaginationSection.innerHTML = "";
    return;
  }

  registeredPaginationSection.innerHTML = `
    <button type="button" class="btn-ghost" id="registeredPrevPageBtn" ${currentPage === 1 ? "disabled" : ""}>Previous</button>
    <span>Page ${currentPage} of ${totalPages} • ${totalLeads} leads</span>
    <button type="button" class="btn-ghost" id="registeredNextPageBtn" ${currentPage === totalPages ? "disabled" : ""}>Next</button>
  `;

  document.getElementById("registeredPrevPageBtn").onclick = () => {
    currentPage -= 1;
    renderAll();
  };
  document.getElementById("registeredNextPageBtn").onclick = () => {
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
  document.getElementById("registeredActivityModal").classList.remove("hidden");
}


function setRegisteredActivityModalMode(mode) {
  registeredActivityModalMode = mode === "view" ? "view" : "edit";
  const title = document.getElementById("registeredActivityModalTitle");
  const saveButton = document.getElementById("saveRegisteredActivityBtn");
  const isView = registeredActivityModalMode === "view";

  if (title) {
    title.textContent = isView ? "Activity Details" : "Update Registered Candidate Activity";
  }
  if (saveButton) {
    saveButton.classList.toggle("hidden", isView);
  }
  [
    "modalRegisteredDialed",
    "modalRegisteredCoursePitched",
    "modalRegisteredCourseStatus",
    "modalRegisteredAdmissionStatus",
    "modalRegisteredCallStatus"
  ].forEach((id) => {
    const field = document.getElementById(id);
    if (field) {
      field.disabled = isView;
    }
  });
}

function populateActivityModal(lead) {
  document.getElementById("modalRegisteredDialed").value = lead.registeredDialed;
  document.getElementById("modalRegisteredCoursePitched").value = lead.registeredCoursePitched;
  document.getElementById("modalRegisteredCourseStatus").value = lead.registeredCourseStatus;
  document.getElementById("modalRegisteredAdmissionStatus").value = lead.registeredAdmissionStatus;
  document.getElementById("modalRegisteredCallStatus").value = lead.registeredCallStatus;
}

function closeActivityModal() {
  document.getElementById("registeredActivityModal").classList.add("hidden");
  activeLeadRef = null;
  setRegisteredActivityModalMode("edit");
}

async function saveActivity(event) {
  event.preventDefault();
  const lead = findLeadByRef(activeLeadRef);
  if (!lead) return;

  const result = await updateLeadActivityOnServer(lead.id, {
    stage: "registered-course",
    leadEmail: lead.email || "",
    updates: {
      registeredDialed: document.getElementById("modalRegisteredDialed").value,
      registeredCoursePitched: document.getElementById("modalRegisteredCoursePitched").value,
      registeredCourseStatus: document.getElementById("modalRegisteredCourseStatus").value,
      registeredAdmissionStatus: document.getElementById("modalRegisteredAdmissionStatus").value,
      registeredCallStatus: document.getElementById("modalRegisteredCallStatus").value,
      registeredActivityUpdated: true
    }
  });

  if (!result || result.ok === false) {
    showToast(result?.message || "Failed to save lead activity.", true);
    return;
  }

  closeActivityModal();
  setMessage("Registered candidate activity saved successfully.");
  showToast("Registered candidate activity saved successfully.");
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

  const confirmed = window.confirm("Delete this registered lead? This cannot be undone.");
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
  setMessage("Registered lead deleted successfully.");
  showToast("Registered lead deleted.");
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
  const listSection = document.getElementById("registeredNotesListSection");
  const canEdit = canEditLeadNotes(lead);
  listSection.innerHTML = lead.leadNotes.length
    ? lead.leadNotes.map((note, index) => `
        <div class="note-item">
          <span class="note-text">${escapeHtml(note.text)}</span>
          <span class="note-meta">${escapeHtml(note.by || "")}${note.by && note.at ? " - " : ""}${escapeHtml(note.at || "")}</span>
          ${canEdit ? `<button type="button" class="btn-ghost registered-note-delete-btn" data-note-index="${index}" style="font-size:0.75rem;padding:2px 6px;">Delete</button>` : ""}
        </div>
      `).join("")
    : `<p class="block-help">${canEdit ? "No notes yet. Add one below." : "No notes yet."}</p>`;

  document.getElementById("registeredNewNoteInput").value = "";
  document.getElementById("registeredSaveNoteBtn").classList.toggle("hidden", !canEdit);
  document.getElementById("registeredNewNoteInput").closest(".modal-row").classList.toggle("hidden", !canEdit);
  document.getElementById("registeredNotesModal").classList.remove("hidden");

  document.querySelectorAll(".registered-note-delete-btn").forEach((button) => {
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
  document.getElementById("registeredNotesModal").classList.add("hidden");
  notesLeadRef = null;
}

async function saveNote() {
  const lead = findLeadByRef(notesLeadRef);
  if (!lead) return;
  const text = document.getElementById("registeredNewNoteInput").value.trim();
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
  if (!registeredTaskMessage) {
    return;
  }

  registeredTaskMessage.textContent = message;
  registeredTaskMessage.style.color = isError ? "var(--danger)" : "var(--success)";
}

function closeTaskModal() {
  if (registeredTaskModal) {
    registeredTaskModal.classList.add("hidden");
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

  registeredTaskLeadIdInput.value = lead.id;
  registeredTaskCategoryInput.value = TASK_CATEGORY.registered;
  registeredTaskLeadNameInput.value = lead.name || "";
  registeredTaskLeadPhoneInput.value = lead.phone || "-";
  registeredTaskCounselorInput.value = lead.counselor || "Unassigned";
  registeredTaskTitleInput.value = `Follow up with ${lead.name || "lead"}`;
  registeredTaskNotesInput.value = "";
  registeredTaskDueDateInput.value = "";
  setTaskMessage("");
  registeredTaskModalTitle.textContent = "Create Registered Candidate Task";
  registeredTaskModal.classList.remove("hidden");
}

async function handleTaskSubmit(event) {
  event.preventDefault();

  const leadId = registeredTaskLeadIdInput.value;
  const title = registeredTaskTitleInput.value.trim();
  const dueDate = registeredTaskDueDateInput.value;

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
    category: TASK_CATEGORY.registered,
    title,
    notes: registeredTaskNotesInput.value.trim(),
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
  renderRegisteredRoutingPanel();

  if (!isAdmin) {
    return;
  }

  if (saveRegisteredRoutingBtn) {
    saveRegisteredRoutingBtn.onclick = () => {
      void saveRegisteredRoutingConfig();
    };
  }

  if (clearRegisteredCandidateDataBtn) {
    clearRegisteredCandidateDataBtn.onclick = () => {
      void clearRegisteredCandidateData();
    };
  }

  void loadRegisteredRoutingConfig();
}

function renderAll() {
  const allLeads = getScopedLeads(getAllLeads());
  const filteredLeads = filterLeads(allLeads);
  renderRegisteredRoutingPanel();
  renderKpis(filteredLeads);
  renderFilters(allLeads);
  renderLeadTable(filteredLeads);
}

document.getElementById("registeredActivityForm").onsubmit = saveActivity;
document.getElementById("closeRegisteredModalBtn").onclick = closeActivityModal;
document.getElementById("closeRegisteredNotesModalBtn").onclick = closeNotesModal;
document.getElementById("registeredSaveNoteBtn").onclick = () => {
  void saveNote();
};
if (registeredTaskModal && registeredTaskForm) {
  document.getElementById("closeRegisteredTaskModalBtn").onclick = closeTaskModal;
  registeredTaskForm.onsubmit = handleTaskSubmit;
}

setupRegisteredRoutingPanel();
renderAll();
const stopStatePolling = startStatePolling(() => {
  renderAll();
});
registerPageCleanup(stopStatePolling);
