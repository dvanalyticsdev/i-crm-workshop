import { registerPageCleanup } from "./page-runtime.js";
import { apiUrl } from "./api-client.js";
import { openActivityHistory } from "./activity-history.js";
import {
  bootstrapLocalState,
  acceptServerState,
  getAllocation as getStoredAllocation,
  getCounselors as getStoredCounselors,
  getLeads as getStoredLeads,
  getSession,
  loadPersistedValue,
  replaceStateSnapshot,
  saveAllocation as persistAllocation,
  saveLeads as persistLeads,
  savePersistedValue,
  startStatePolling,
  syncStateFromLocalAndVerify
} from "./state-sync.js";
import { createTask, TASK_CATEGORY } from "./task-service.js";
import {
  addLeadNote,
  assignLeads as assignLeadsOnServer,
  deleteLeadNote,
  updateLeadActivity as updateLeadActivityOnServer
} from "./lead-service.js";

await bootstrapLocalState();

const preKpiSection = document.getElementById("preKpiSection");
const preFilterBar = document.getElementById("preFilterBar");
const preLeadTableSection = document.getElementById("preLeadTableSection");
const taskModal = document.getElementById("taskModal");
const taskModalTitle = document.getElementById("taskModalTitle");
const taskForm = document.getElementById("taskForm");
const taskLeadIdInput = document.getElementById("taskLeadId");
const taskCategoryInput = document.getElementById("taskCategory");
const taskLeadNameInput = document.getElementById("taskLeadName");
const taskCounselorInput = document.getElementById("taskCounselor");
const taskTitleInput = document.getElementById("taskTitle");
const taskNotesInput = document.getElementById("taskNotes");
const taskDueDateInput = document.getElementById("taskDueDate");
const taskMessage = document.getElementById("taskMessage");

const session = getSession();
const isAdmin = session?.role === "admin";
const canCreateTasks = session?.role === "counselor";

function extractCounselorName(record) {
  return String(
    record?.name
      ?? record?.counselorName
      ?? record?.fullName
      ?? record?.displayName
      ?? ""
  ).trim();
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 4000) {
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

async function verifyAssignedCounselorsOnBackend(importedRecords) {
  const recordsToVerify = importedRecords
    .map(({ lead }) => ({
      id: String(lead?.id || ""),
      counselor: String(lead?.counselor || "").trim()
    }))
    .filter((record) => record.id && record.counselor && record.counselor.toLowerCase() !== "unassigned");

  if (!recordsToVerify.length) {
    return { ok: true };
  }

  const { response, json } = await fetchJsonWithTimeout(apiUrl("/api/state"), {
    method: "GET",
    headers: { Accept: "application/json" }
  }, 4000);

  if (!response.ok) {
    return { ok: false, message: "Could not confirm counselor assignment from the backend." };
  }

  const backendLeads = Array.isArray(json?.leads) ? json.leads : [];
  const backendById = new Map(backendLeads.map((lead) => [String(lead.id), lead]));

  const mismatchedLead = recordsToVerify.find((record) => {
    const backendLead = backendById.get(record.id);
    const backendCounselor = String(backendLead?.counselor || "").trim();
    return !backendLead || backendCounselor !== record.counselor;
  });

  if (mismatchedLead) {
    return {
      ok: false,
      message: `Backend did not confirm counselor assignment for lead ${mismatchedLead.id}.`
    };
  }

  return { ok: true };
}

async function deleteLead(leadId) {
  const allLeads = getAllLeads();
  const index = allLeads.findIndex((lead) => String(lead.id) === String(leadId));
  if (index === -1) {
    return false;
  }

  const confirmed = window.confirm("Delete this lead? This cannot be undone.");
  if (!confirmed) {
    return false;
  }

  allLeads.splice(index, 1);
  const deleteLeadResult = await saveAllLeads(allLeads);
  if (!deleteLeadResult || deleteLeadResult.ok === false) {
    showToast("Failed to delete lead. Please check your connection and try again.", true);
    return false;
  }
  setMessage("Lead deleted successfully.", false);
  return true;
}

async function deleteSelectedLeads(leads) {
  if (!selectedLeadKeys.size) {
    return false;
  }

  const confirmed = window.confirm(`Delete ${selectedLeadKeys.size} selected lead${selectedLeadKeys.size === 1 ? "" : "s"}? This cannot be undone.`);
  if (!confirmed) {
    return false;
  }

  const allLeads = getAllLeads();
  const remainingLeads = allLeads.filter((lead) => !selectedLeadKeys.has(buildLeadSelectionKey(lead)));
  const removedCount = allLeads.length - remainingLeads.length;
  if (!removedCount) {
    return false;
  }

  const deleteSelectedResult = await saveAllLeads(remainingLeads);
  if (!deleteSelectedResult || deleteSelectedResult.ok === false) {
    showToast("Failed to delete selected leads. Please check your connection and try again.", true);
    return false;
  }
  clearSelectedLeadIds();
  setMessage(`Deleted ${removedCount} selected lead${removedCount === 1 ? "" : "s"}.`, false);
  return true;
}

function clearSelectedLeadIds() {
  selectedLeadKeys = new Set();
}

function buildLeadSelectionRef(lead) {
  return {
    id: String(lead?.id || "").trim(),
    email: String(lead?.email || "").trim().toLowerCase(),
    phone: String(lead?.phone || "").trim(),
    workshop: String(lead?.workshop || "").trim(),
    createdAt: String(lead?.createdAt || "").trim()
  };
}

function buildLeadSelectionKey(lead) {
  const ref = buildLeadSelectionRef(lead);
  return [ref.id, ref.email, ref.phone, ref.workshop, ref.createdAt].join("::");
}

function getSelectableLeadKeys(leads) {
  return leads.map((lead) => buildLeadSelectionKey(lead));
}

function getSelectedLeadCount(leads) {
  const selectableKeys = new Set(getSelectableLeadKeys(leads));
  let count = 0;

  selectedLeadKeys.forEach((leadKey) => {
    if (selectableKeys.has(String(leadKey))) {
      count += 1;
    }
  });

  return count;
}

function syncSelectedLeadIds(leads) {
  const selectableKeys = new Set(getSelectableLeadKeys(leads));
  selectedLeadKeys = new Set([...selectedLeadKeys].filter((leadKey) => selectableKeys.has(String(leadKey))));
}

function toggleLeadSelection(leadKey, isChecked) {
  const next = new Set(selectedLeadKeys);
  if (isChecked) {
    next.add(String(leadKey));
  } else {
    next.delete(String(leadKey));
  }
  selectedLeadKeys = next;
}

function toggleAllLeadsSelection(leads, isChecked) {
  selectedLeadKeys = isChecked ? new Set(getSelectableLeadKeys(leads)) : new Set();
}

function isLeadSelected(lead) {
  return selectedLeadKeys.has(buildLeadSelectionKey(lead));
}

function clampSelectionCount(rawValue, maxCount) {
  const parsed = Number.parseInt(String(rawValue || "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }

  return Math.min(parsed, maxCount);
}

function selectLeadBatch(leads, rawValue) {
  const count = clampSelectionCount(rawValue, leads.length);
  if (!count) {
    return 0;
  }

  selectedLeadKeys = new Set(getSelectableLeadKeys(leads).slice(0, count));
  return count;
}

function getAdminAssignmentOptions() {
  return [...new Set(["Unassigned", ...getActiveCounselorNames()])];
}

async function assignSelectedLeads(leads, counselorName) {
  const leadRefsByKey = new Map(leads.map((lead) => [buildLeadSelectionKey(lead), buildLeadSelectionRef(lead)]));
  const applicableLeadRefs = [...selectedLeadKeys]
    .map((leadKey) => leadRefsByKey.get(String(leadKey)))
    .filter(Boolean);
  if (!applicableLeadRefs.length) {
    showToast("Select at least one lead to assign.", true);
    return false;
  }

  const targetCounselor = String(counselorName || "").trim();
  if (!targetCounselor) {
    showToast("Select a counselor first.", true);
    return false;
  }

  const updatedCount = applicableLeadRefs.length;

  if (!updatedCount) {
    showToast("No leads were updated.", true);
    return false;
  }

  const assignmentResult = await assignLeadsOnServer(applicableLeadRefs, targetCounselor);
  if (!assignmentResult || assignmentResult.ok === false) {
    showToast(assignmentResult?.message || "Failed to assign selected leads. Please check your connection and try again.", true);
    return false;
  }

  showToast(`Assigned ${updatedCount} lead${updatedCount === 1 ? "" : "s"} to ${targetCounselor}.`, false);
  return true;
}

function isCounselorSession() {
  return session?.role === "counselor";
}

function getCounselorIdentity() {
  if (!isCounselorSession()) {
    return "";
  }

  const sessionName = String(session?.name || "").trim().toLowerCase();
  const sessionEmail = String(session?.email || "").trim().toLowerCase();
  const counselors = getStoredCounselors();
  const match = counselors.find(
    (item) => String(item.email || "").trim().toLowerCase() === sessionEmail
  );

  return String(match?.name || session?.name || "").trim().toLowerCase() || sessionName;
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

function getLeadActivityUpdateCount(lead) {
  return Array.isArray(lead?.workshopActivityHistory)
    ? lead.workshopActivityHistory.length
    : Number(lead?.preActivityUpdates) || 0;
}

function isUntouchedLead(lead) {
  return getLeadActivityUpdateCount(lead) === 0;
}

function validateBalancedSuggestionTargets(activeCounselors, targetCounts, totalLeads) {
  if (!activeCounselors.length) {
    return "";
  }

  const totals = activeCounselors.map((name) => Number(targetCounts.get(name) || 0));
  const totalAssigned = totals.reduce((sum, value) => sum + value, 0);
  if (totalAssigned !== totalLeads) {
    return "Balanced target validation failed because the suggested totals do not match the total lead count.";
  }

  const minTarget = Math.min(...totals);
  const maxTarget = Math.max(...totals);
  if (maxTarget - minTarget > 1) {
    return "Balanced target validation failed because the suggested counselor totals are not equal.";
  }

  return "";
}

function validateSuggestionOutcome({ activeCounselors, currentCounts, targetCounts, suggestions }) {
  const projectedCounts = new Map(activeCounselors.map((name) => [name, Number(currentCounts.get(name) || 0)]));

  (Array.isArray(suggestions) ? suggestions : []).forEach((suggestion) => {
    const moveCount = Number(suggestion?.count || 0);
    const from = String(suggestion?.from || "").trim();
    const to = String(suggestion?.to || "").trim();

    if (projectedCounts.has(from)) {
      projectedCounts.set(from, projectedCounts.get(from) - moveCount);
    }
    if (projectedCounts.has(to)) {
      projectedCounts.set(to, projectedCounts.get(to) + moveCount);
    }
  });

  for (const counselorName of activeCounselors) {
    if ((projectedCounts.get(counselorName) || 0) !== (targetCounts.get(counselorName) || 0)) {
      return "Balanced target validation failed because the suggested moves do not reach equal counselor totals.";
    }
  }

  return validateBalancedSuggestionTargets(
    activeCounselors,
    projectedCounts,
    Array.from(projectedCounts.values()).reduce((sum, value) => sum + value, 0)
  );
}

const EMPTY_FILTER_VALUE = "__EMPTY_FILTER__";
const EMPTY_FILTER_LABEL = "Use Filter";
const SELECT_ALL_FILTER_VALUE = "__SELECT_ALL__";
const BLANK_FILTER_VALUE = "__BLANK_FILTER__";

function getSelectedFilterValues(value) {
  const rawValues = Array.isArray(value) ? value : [value];
  return rawValues
    .map((item) => String(item || "").trim())
    .filter((item) => item && item !== EMPTY_FILTER_VALUE && item !== SELECT_ALL_FILTER_VALUE && item !== "All");
}

function isSelectedFilterValue(value) {
  return getSelectedFilterValues(value).length > 0;
}

function normalizeSelectedFilterValue(value, options = null) {
  const selected = getSelectedFilterValues(value);
  const normalized = Array.isArray(options)
    ? selected.filter((item) => options.includes(item))
    : selected;
  return normalized.length ? normalized : EMPTY_FILTER_VALUE;
}

function getCoreWorkshopName(workshopName) {
  if (!workshopName) return "";
  const name = String(workshopName).toLowerCase();
  
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
    return "Cyber AI Workshop 21st June";
  }
  if (name.includes("sql") && name.includes("13")) {
    return "SQL Workshop 13th June";
  }
  
  return String(workshopName).trim().replace(/[_\s]+(imp|od|ind)$/i, "").trim();
}

function getUniqueCoreWorkshops(leads) {
  const coreNames = leads.map((lead) => getCoreWorkshopName(lead.workshop)).filter(Boolean);
  return [...new Set(coreNames)];
}

function filterIncludesValue(filterValue, value) {
  const selected = getSelectedFilterValues(filterValue);
  if (!selected.length) {
    return true;
  }

  const normalizedValue = String(value || "").trim();
  const isWorkshopFilter = (typeof filter !== "undefined" && filterValue === filter.workshop);
  return selected.some((item) => (
    item === BLANK_FILTER_VALUE ? normalizedValue === "" : (isWorkshopFilter ? getCoreWorkshopName(item) === getCoreWorkshopName(normalizedValue) : item === normalizedValue)
  ));
}

function getFilterSummary(value) {
  const selected = getSelectedFilterValues(value);
  if (!selected.length) return EMPTY_FILTER_LABEL;
  if (selected.length <= 2) {
    return selected.map((item) => (item === BLANK_FILTER_VALUE ? "Select" : item)).join(", ");
  }
  return `${selected.length} selected`;
}

function withSelectFilterOption(options) {
  const normalizedOptions = Array.isArray(options)
    ? options.map((option) => String(option || "").trim()).filter(Boolean)
    : [];
  return [...new Set([BLANK_FILTER_VALUE, ...normalizedOptions])];
}

function renderMultiSelectControl({ id, label, options, value, itemClass = "", itemAttrs = "" }) {
  const uniqueOptions = [...new Set(options.map((option) => String(option || "").trim()).filter(Boolean))];
  const selected = new Set(getSelectedFilterValues(value));
  const selectedCount = selected.size;
  const allSelected = uniqueOptions.length > 0 && uniqueOptions.every((option) => selected.has(option));
  const optionHtml = uniqueOptions.length
    ? uniqueOptions.map((option) => {
        const isBlankOption = option === BLANK_FILTER_VALUE;
        const optionLabel = isBlankOption ? "Select" : option;
        const escapedOption = escapeHtml(option);
        const escapedLabel = escapeHtml(optionLabel);
        const checked = selected.has(String(option)) ? " checked" : "";
        const selectedClass = checked ? " multi-filter-option--selected" : "";
        return `
          <label class="multi-filter-option${selectedClass}">
            <input type="checkbox" value="${escapedOption}"${checked} />
            <span>${escapedLabel}</span>
          </label>
        `;
      }).join("")
    : `<div class="multi-filter-empty">No options</div>`;
  const selectAllClass = allSelected ? " multi-filter-option--selected" : "";

  return `
    <div class="filter-item${itemClass}" ${itemAttrs}>
      <label for="${id}Button">${label}</label>
      <div class="multi-filter" data-filter-id="${id}">
        <button id="${id}Button" class="multi-filter-trigger" type="button" aria-expanded="false">
          <span class="multi-filter-trigger__text">${escapeHtml(getFilterSummary(value))}</span>
          <span class="multi-filter-caret" aria-hidden="true">&#9662;</span>
        </button>
        <div class="multi-filter-menu hidden">
          <label class="multi-filter-option multi-filter-select-all${selectAllClass}">
            <input type="checkbox" value="${SELECT_ALL_FILTER_VALUE}" ${allSelected ? "checked" : ""} />
            <span>Select All</span>
          </label>
          ${optionHtml}
          <div class="multi-filter-meta">
            <span class="selected-count">Selected: ${selectedCount}</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

function bindMultiFilter(filterId, filterKey) {
  const root = document.querySelector(`[data-filter-id="${filterId}"]`);
  if (!root) return;
  const button = root.querySelector(".multi-filter-trigger");
  const menu = root.querySelector(".multi-filter-menu");
  if (!button || !menu) return;

  button.onclick = (event) => {
    event.stopPropagation();
    document.querySelectorAll(".multi-filter-menu").forEach((item) => {
      if (item !== menu) item.classList.add("hidden");
    });
    document.querySelectorAll(".multi-filter").forEach((item) => {
      if (item !== root) item.classList.remove("multi-filter--open");
    });
    menu.classList.toggle("hidden");
    root.classList.toggle("multi-filter--open", !menu.classList.contains("hidden"));
    button.setAttribute("aria-expanded", String(!menu.classList.contains("hidden")));
  };

  menu.onclick = (event) => {
    event.stopPropagation();
  };

  menu.querySelectorAll("input[type='checkbox']").forEach((checkbox) => {
    checkbox.onchange = () => {
      const optionValues = Array.from(menu.querySelectorAll("input[type='checkbox']"))
        .map((input) => input.value)
        .filter((inputValue) => inputValue !== SELECT_ALL_FILTER_VALUE);

      if (checkbox.value === SELECT_ALL_FILTER_VALUE) {
        filter[filterKey] = checkbox.checked ? optionValues : EMPTY_FILTER_VALUE;
        persistFilterState();
        currentPage = 1;
        renderAll();
        return;
      }

      const values = Array.from(menu.querySelectorAll("input[type='checkbox']:checked"))
        .filter((input) => input.value !== SELECT_ALL_FILTER_VALUE)
        .map((input) => input.value);
      filter[filterKey] = values.length ? values : EMPTY_FILTER_VALUE;
      persistFilterState();
      currentPage = 1;
      renderAll();
    };
  });
}

function bindMultiFilterOutsideClick() {
  if (window.__dvMultiFilterCloseBound) return;
  window.__dvMultiFilterCloseBound = true;
  document.addEventListener("click", () => {
    document.querySelectorAll(".multi-filter-menu").forEach((menu) => menu.classList.add("hidden"));
    document.querySelectorAll(".multi-filter").forEach((root) => root.classList.remove("multi-filter--open"));
    document.querySelectorAll(".multi-filter-trigger").forEach((button) => {
      button.setAttribute("aria-expanded", "false");
    });
  });
}

const DEFAULT_FILTER = {
  timeline: isCounselorSession() ? "overall" : "week",
  startDate: "",
  endDate: "",
  search: "",
  counselor: EMPTY_FILTER_VALUE,
  activityStatus: EMPTY_FILTER_VALUE,
  workshop: EMPTY_FILTER_VALUE,
  dialed: EMPTY_FILTER_VALUE,
  callStatus: EMPTY_FILTER_VALUE,
  wsStatus: EMPTY_FILTER_VALUE,
  whatsappInvite: EMPTY_FILTER_VALUE,
  whatsappGroupStatus: EMPTY_FILTER_VALUE
};

const FILTER_STORAGE_KEY = "dvWorkshopWorkshopCallingFilters";
const persistedFilter = await loadPersistedValue(FILTER_STORAGE_KEY, {});

Object.keys(DEFAULT_FILTER).forEach((key) => {
  if (persistedFilter[key] === "All" || persistedFilter[key] === "Select" || persistedFilter[key] === EMPTY_FILTER_LABEL) {
    persistedFilter[key] = EMPTY_FILTER_VALUE;
  }
});

let filter = {
  ...DEFAULT_FILTER,
  ...persistedFilter
};

if (isCounselorSession() && (!persistedFilter.timeline || persistedFilter.timeline === "week")) {
  filter.timeline = "overall";
}

const DEFAULT_ALLOCATION = [];

let modalLeadId = null;
let modalLeadEmail = "";
let modalMode = "edit";
let selectedLeadKeys = new Set();
let lastAssignmentSuggestions = [];
let searchTimeout = null;
let currentPage = 1;
const pageSize = 50;

const activityFields = ["modalDialed", "modalCallStatus", "modalWsStatus", "modalWhatsappInvite", "modalWhatsappGroupStatus"];

function toIsoDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function setMessage(element, text, isError = true) {
  element.textContent = text;
  element.style.color = isError ? "var(--danger)" : "var(--success)";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getLeadImportSourceFiles(lead) {
  if (Array.isArray(lead?.importSourceFiles)) {
    return lead.importSourceFiles.map((name) => String(name || "").trim()).filter(Boolean);
  }

  const fallback = String(lead?.importSourceFile || "").trim();
  return fallback ? [fallback] : [];
}

function persistFilterState() {
  void savePersistedValue(FILTER_STORAGE_KEY, filter);
}

function normalizeFilterState(leads) {
  const workshops = getUniqueCoreWorkshops(leads);
  const counselorOptions = getActiveCounselorNames();
  const dialedOptions = getUniqueValues(leads, "dialed");
  const callStatusOptions = getUniqueValues(leads, "callStatus");
  const wsStatusOptions = getUniqueValues(leads, "wsStatus");
  const whatsappInviteOptions = getUniqueValues(leads, "whatsappInvite");

  const nextFilter = {
    ...filter,
    workshop: normalizeSelectedFilterValue(filter.workshop, workshops),
    counselor: normalizeSelectedFilterValue(filter.counselor, counselorOptions),
    activityStatus: normalizeSelectedFilterValue(filter.activityStatus, ["Untouched", "Updated"]),
    dialed: normalizeSelectedFilterValue(filter.dialed, withSelectFilterOption(dialedOptions)),
    callStatus: normalizeSelectedFilterValue(filter.callStatus, withSelectFilterOption(callStatusOptions)),
    wsStatus: normalizeSelectedFilterValue(filter.wsStatus, withSelectFilterOption(wsStatusOptions)),
    whatsappInvite: normalizeSelectedFilterValue(filter.whatsappInvite, withSelectFilterOption(whatsappInviteOptions)),
    whatsappGroupStatus: normalizeSelectedFilterValue(filter.whatsappGroupStatus, withSelectFilterOption(["Joined", "Not Joined"]))
  };

  const changed = JSON.stringify(nextFilter) !== JSON.stringify(filter);
  if (changed) {
    filter = nextFilter;
    persistFilterState();
  }
}

function getDefaultWsStatus(lead) {
  const status = String(lead?.status || "").trim();
  if (status === "Interested" || status === "Converted") {
    return "Interested";
  }

  // New/unspecified leads should not be marked lost by default.
  return "Interested";
}

function normalizeYesNo(value, fallback = "No") {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "yes" || normalized === "y") {
    return "Yes";
  }
  if (normalized === "no" || normalized === "n") {
    return "No";
  }
  return fallback;
}

function normalizeLeadStatus(value) {
  const status = String(value || "").trim();
  if (!status || status.toLowerCase() === "select") {
    return "New";
  }

  return status;
}

function normalizeLeadFields(leads) {
  leads.forEach((lead) => {
    lead.name = lead.name || "";
    lead.email = (lead.email || "").toLowerCase();
    lead.workshop = lead.workshop || "";
    lead.createdAt = lead.createdAt || toIsoDate();
    lead.importSourceFiles = getLeadImportSourceFiles(lead);
    lead.importSourceSheets = Array.isArray(lead.importSourceSheets)
      ? lead.importSourceSheets.map((name) => String(name || "").trim()).filter(Boolean)
      : lead.importSourceSheet
        ? [String(lead.importSourceSheet).trim()].filter(Boolean)
        : [];

    lead.status = normalizeLeadStatus(lead.status);
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
    lead.workshopActivityHistory = Array.isArray(lead.workshopActivityHistory) ? lead.workshopActivityHistory : [];
    lead.admissionActivityHistory = Array.isArray(lead.admissionActivityHistory) ? lead.admissionActivityHistory : [];
    lead.preActivityUpdates = lead.workshopActivityHistory.length
      || (Number.isFinite(Number(lead.preActivityUpdates)) ? Number(lead.preActivityUpdates) : 0);
    lead.postActivityUpdates = lead.admissionActivityHistory.length
      || (Number.isFinite(Number(lead.postActivityUpdates)) ? Number(lead.postActivityUpdates) : 0);
    lead.whatsappGroupStatus = lead.whatsappGroupStatus || "";
    lead.leadNotes = Array.isArray(lead.leadNotes) ? lead.leadNotes : [];
  });
}

function isCourseRegistrationLead(lead) {
  return String(lead?.leadPipeline || "").trim().toLowerCase() === "course-registration";
}

function getAllLeads() {
  const leads = getStoredLeads().filter((lead) => !isCourseRegistrationLead(lead));
  normalizeLeadFields(leads);
  return leads;
}

function saveAllLeads(leads) {
  return persistLeads(leads);
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


function saveAllocation(allocation) {
  return persistAllocation(allocation);
}

function getAllocation() {
  const allocation = getStoredAllocation();
  if (!Array.isArray(allocation) || !allocation.length) {
    return structuredClone(DEFAULT_ALLOCATION);
  }

  return allocation.map((item) => ({
    name: String(item.name || "").trim(),
    percentage: Number(item.percentage || 0)
  }));
}

async function getCounselorNamesForAllocation() {
  const localCounselors = getStoredCounselors();
  if (Array.isArray(localCounselors) && localCounselors.length) {
    return [...new Set(
      localCounselors
        .map((item) => extractCounselorName(item))
        .filter(Boolean)
    )];
  }

  try {
    const { response, json } = await fetchJsonWithTimeout(apiUrl("/api/state"), {
      method: "GET",
      headers: { Accept: "application/json" }
    }, 4000);

    if (!response.ok) {
      return [];
    }

    const payload = json;
    const counselors = Array.isArray(payload?.counselors) ? payload.counselors : [];

    return [...new Set(
      counselors
        .map((item) => extractCounselorName(item))
        .filter(Boolean)
    )];
  } catch {
    return [];
  }
}

function getActiveCounselorNames() {
  let names = getStoredCounselors()
    .map((item) => String(item.name || "").trim())
    .filter(Boolean);

  if (!names.length) {
    names = getAllocation()
      .map((item) => String(item.name || "").trim())
      .filter(Boolean);
  }

  if (!names.length) {
    names = getAllLeads()
      .map((lead) => String(lead.counselor || "").trim())
      .filter((name) => name && name.toLowerCase() !== "unassigned");
  }

  return [...new Set(names)];
}

function syncAllocationWithCounselors() {
  const counselorNames = getActiveCounselorNames();
  const existing = getAllocation();
  const byName = new Map(
    existing.map((item) => [String(item.name || "").trim().toLowerCase(), item])
  );

  const synced = counselorNames.map((name) => {
    const found = byName.get(name.toLowerCase());
    return {
      name,
      percentage: Number(found?.percentage || 0)
    };
  });

  const hasChanged =
    synced.length !== existing.length
    || synced.some((item, index) => {
      const current = existing[index];
      return !current
        || String(current.name || "").trim() !== item.name
        || Number(current.percentage || 0) !== item.percentage;
    });

  if (hasChanged) {
    saveAllocation(synced);
  }

  return synced;
}

async function fetchCounselorNamesFromApi() {
  try {
    const response = await fetch(apiUrl("/api/state"), {
      method: "GET",
      headers: {
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      return [];
    }

    const payload = await response.json();
    if (!Array.isArray(payload?.counselors)) {
      return [];
    }

    return [...new Set(
      payload.counselors
        .map((item) => String(item?.name || "").trim())
        .filter(Boolean)
    )];
  } catch {
    return [];
  }
}

function mergeAllocationNames(names, existingAllocation) {
  const byName = new Map(
    existingAllocation.map((item) => [String(item.name || "").trim().toLowerCase(), Number(item.percentage || 0)])
  );

  return names.map((name) => ({
    name,
    percentage: byName.get(name.toLowerCase()) || 0
  }));
}

function isPostWorkshopLead(lead) {
  return lead.wsStatus === "Interested" && lead.whatsappInvite === "Yes";
}

function isLostLead(lead) {
  return lead.postStatusUpdated && lead.courseStatus === "Not Interested";
}

function getPreWorkshopLeads(allLeads) {
  return allLeads.filter((lead) => !isLostLead(lead));
}

function getUniqueValues(leads, key) {
  return [
    ...new Set(
      leads
        .map((lead) => lead[key])
        .filter((value) => typeof value === "string" && value.trim() !== "")
    )
  ];
}

function getUniqueWorkshops(leads) {
  return [...new Set(leads.map((lead) => lead.workshop))];
}

function filterByTimeline(leads) {
  if (filter.timeline === "overall") {
    return leads;
  }

  if (filter.timeline === "today") {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return leads.filter((lead) => {
      const created = new Date(lead.createdAt);
      created.setHours(0, 0, 0, 0);
      return created.getTime() === today.getTime();
    });
  }

  if (filter.timeline === "yesterday") {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    return leads.filter((lead) => {
      const created = new Date(lead.createdAt);
      created.setHours(0, 0, 0, 0);
      return created.getTime() === yesterday.getTime();
    });
  }

  if (filter.timeline === "week") {
    const end = new Date();
    end.setHours(23, 59, 59, 999);

    const start = new Date();
    start.setDate(start.getDate() - 6);
    start.setHours(0, 0, 0, 0);

    return leads.filter((lead) => {
      const created = new Date(lead.createdAt);
      return created >= start && created <= end;
    });
  }

  if (filter.timeline === "custom") {
    if (!filter.startDate || !filter.endDate) {
      return leads;
    }

    const start = new Date(filter.startDate);
    start.setHours(0, 0, 0, 0);

    const end = new Date(filter.endDate);
    end.setHours(23, 59, 59, 999);

    return leads.filter((lead) => {
      const created = new Date(lead.createdAt);
      return created >= start && created <= end;
    });
  }

  return leads;
}

function filterLeads(leads) {
  let filtered = filterByTimeline(leads);

  if (filter.search) {
    const query = filter.search.toLowerCase();
    filtered = filtered.filter((lead) => {
      const haystack = [
        lead.name,
        lead.email,
        lead.phone,
        lead.workshop,
        lead.counselor
      ]
        .map((value) => String(value || "").toLowerCase())
        .join(" ");

      return haystack.includes(query);
    });
  }

  if (isSelectedFilterValue(filter.counselor)) {
    filtered = filtered.filter((lead) => filterIncludesValue(filter.counselor, lead.counselor));
  }

  const activityStatuses = getSelectedFilterValues(filter.activityStatus);
  if (activityStatuses.length === 1 && activityStatuses.includes("Untouched")) {
    filtered = filtered.filter((lead) => isUntouchedLead(lead));
  }

  if (activityStatuses.length === 1 && activityStatuses.includes("Updated")) {
    filtered = filtered.filter((lead) => !isUntouchedLead(lead));
  }

  if (isSelectedFilterValue(filter.workshop)) {
    filtered = filtered.filter((lead) => filterIncludesValue(filter.workshop, lead.workshop));
  }

  if (isSelectedFilterValue(filter.dialed)) {
    filtered = filtered.filter((lead) => filterIncludesValue(filter.dialed, lead.dialed));
  }

  if (isSelectedFilterValue(filter.callStatus)) {
    filtered = filtered.filter((lead) => filterIncludesValue(filter.callStatus, lead.callStatus));
  }

  if (isSelectedFilterValue(filter.wsStatus)) {
    filtered = filtered.filter((lead) => filterIncludesValue(filter.wsStatus, lead.wsStatus));
  }

  if (isSelectedFilterValue(filter.whatsappInvite)) {
    filtered = filtered.filter((lead) => filterIncludesValue(filter.whatsappInvite, lead.whatsappInvite));
  }

  if (isSelectedFilterValue(filter.whatsappGroupStatus)) {
    filtered = filtered.filter((lead) => filterIncludesValue(filter.whatsappGroupStatus, lead.whatsappGroupStatus));
  }

  return filtered;
}

function renderKpis(leads) {
  const overall = leads.length;

  let html = `
    <article class="card kpi-card">
      <p>Overall Leads</p>
      <h2>${overall}</h2>
    </article>
  `;

  const coreWorkshopCounts = {};
  leads.forEach((lead) => {
    const coreName = getCoreWorkshopName(lead.workshop);
    if (coreName) {
      coreWorkshopCounts[coreName] = (coreWorkshopCounts[coreName] || 0) + 1;
    }
  });

  const coreWorkshops = Object.keys(coreWorkshopCounts).sort((a, b) => a.localeCompare(b));

  coreWorkshops.forEach((coreName) => {
    const count = coreWorkshopCounts[coreName];
    html += `
      <article class="card kpi-card">
        <p>${escapeHtml(coreName)}</p>
        <h2>${count}</h2>
      </article>
    `;
  });

  preKpiSection.innerHTML = html;
}

function renderFilters(leads) {
  const workshops = getUniqueCoreWorkshops(leads);
  const counselorOptions = getActiveCounselorNames();
  const dialedOptions = getUniqueValues(leads, "dialed");
  const callStatusOptions = getUniqueValues(leads, "callStatus");
  const wsStatusOptions = getUniqueValues(leads, "wsStatus");
  const whatsappInviteOptions = getUniqueValues(leads, "whatsappInvite");

  preFilterBar.innerHTML = `
    <div class="filter-row">
      <div class="filter-item">
        <label for="timelineSelect">Timeline</label>
        <select id="timelineSelect">
          <option value="overall">Overall</option>
          <option value="today">Today</option>
          <option value="yesterday">Yesterday</option>
          <option value="week">Week</option>
          <option value="custom">Custom Range</option>
        </select>
      </div>

      <div class="filter-item hidden" id="startDateWrap">
        <label for="startDateInput">Start Date</label>
        <input id="startDateInput" type="date" />
      </div>

      <div class="filter-item hidden" id="endDateWrap">
        <label for="endDateInput">End Date</label>
        <input id="endDateInput" type="date" />
      </div>

      <div class="filter-item">
        <label for="searchLeadInput">Search Lead</label>
        <input id="searchLeadInput" type="text" placeholder="Name, email, phone, workshop, counselor" />
      </div>

      ${renderMultiSelectControl({
        id: "counselorSelect",
        label: "Counselor",
        options: counselorOptions,
        value: filter.counselor,
        itemClass: isAdmin ? "" : " hidden",
        itemAttrs: 'data-admin-only="true"'
      })}

      ${renderMultiSelectControl({
        id: "activityStatusSelect",
        label: "Untouched Leads",
        options: ["Untouched", "Updated"],
        value: filter.activityStatus
      })}

      ${renderMultiSelectControl({
        id: "workshopSelect",
        label: "Workshop Name",
        options: workshops,
        value: filter.workshop
      })}

      ${renderMultiSelectControl({
        id: "dialedSelect",
        label: "Dialed",
        options: withSelectFilterOption(dialedOptions),
        value: filter.dialed
      })}

      ${renderMultiSelectControl({
        id: "callStatusSelect",
        label: "Call Status",
        options: withSelectFilterOption(callStatusOptions),
        value: filter.callStatus
      })}

      ${renderMultiSelectControl({
        id: "wsStatusSelect",
        label: "Workshop Status",
        options: withSelectFilterOption(wsStatusOptions),
        value: filter.wsStatus
      })}

      ${renderMultiSelectControl({
        id: "whatsappInviteSelect",
        label: "WhatsApp Invitation Sent",
        options: withSelectFilterOption(whatsappInviteOptions),
        value: filter.whatsappInvite
      })}

      ${renderMultiSelectControl({
        id: "whatsappGroupStatusSelect",
        label: "WhatsApp Group Status",
        options: withSelectFilterOption(["Joined", "Not Joined"]),
        value: filter.whatsappGroupStatus
      })}

      <div class="filter-item filter-item-cta">
        <label>&nbsp;</label>
        <div class="filter-actions">
          <button id="resetFilters" class="btn-ghost" type="button">Reset</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById("timelineSelect").value = filter.timeline;
  document.getElementById("startDateInput").value = filter.startDate;
  document.getElementById("endDateInput").value = filter.endDate;
  document.getElementById("searchLeadInput").value = filter.search;
  bindMultiFilterOutsideClick();
  bindMultiFilter("counselorSelect", "counselor");
  bindMultiFilter("activityStatusSelect", "activityStatus");
  bindMultiFilter("workshopSelect", "workshop");
  bindMultiFilter("dialedSelect", "dialed");
  bindMultiFilter("callStatusSelect", "callStatus");
  bindMultiFilter("wsStatusSelect", "wsStatus");
  bindMultiFilter("whatsappInviteSelect", "whatsappInvite");
  bindMultiFilter("whatsappGroupStatusSelect", "whatsappGroupStatus");

  document.getElementById("startDateWrap").classList.toggle("hidden", filter.timeline !== "custom");
  document.getElementById("endDateWrap").classList.toggle("hidden", filter.timeline !== "custom");

  document.getElementById("timelineSelect").onchange = (event) => {
    filter.timeline = event.target.value;
    persistFilterState();
    document.getElementById("startDateWrap").classList.toggle("hidden", filter.timeline !== "custom");
    document.getElementById("endDateWrap").classList.toggle("hidden", filter.timeline !== "custom");
    currentPage = 1;
    renderAll();
  };

  document.getElementById("startDateInput").onchange = (event) => {
    filter.startDate = event.target.value;
    persistFilterState();
    currentPage = 1;
    renderAll();
  };

  document.getElementById("endDateInput").onchange = (event) => {
    filter.endDate = event.target.value;
    persistFilterState();
    currentPage = 1;
    renderAll();
  };

  document.getElementById("searchLeadInput").oninput = (event) => {
    filter.search = event.target.value.trim();
    persistFilterState();
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      currentPage = 1;
      renderAll();
    }, 250);
  };


  document.getElementById("resetFilters").onclick = () => {
    filter = { ...DEFAULT_FILTER };
    persistFilterState();
    currentPage = 1;
    renderAll();
  };
}

function renderActivityStatusPanel(lead) {
  const hasActivity = Array.isArray(lead.workshopActivityHistory) && lead.workshopActivityHistory.length > 0;
  const noteCount = Array.isArray(lead.leadNotes) ? lead.leadNotes.length : 0;
  const leadId = escapeHtml(lead.id);
  const leadEmail = escapeHtml(lead.email || "");
  const leadAttrs = `data-lead-id="${leadId}" data-lead-email="${leadEmail}"`;
  return `
    <div class="activity-panel">
      <button class="btn-update-status${hasActivity ? " btn-update-status--active" : ""}" type="button" ${leadAttrs}>Update</button>
      <button class="btn-ghost btn-notes" type="button" ${leadAttrs}>Notes${noteCount ? ` (${noteCount})` : ""}</button>
      ${canCreateTasks ? `<button class="btn-ghost btn-task" type="button" ${leadAttrs}>Task</button>` : ""}
      <button class="btn-ghost btn-activity-history" type="button" ${leadAttrs}>Activity History</button>
      ${isAdmin ? `<button class="btn-delete" type="button" ${leadAttrs}>Delete</button>` : ""}
    </div>
  `;
}

function renderLeadTable(leads) {
  const totalLeads = leads.length;
  const totalPages = Math.ceil(totalLeads / pageSize) || 1;
  if (currentPage > totalPages) {
    currentPage = totalPages;
  }
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalLeads);
  const pagedLeads = leads.slice(startIndex, endIndex);

  syncSelectedLeadIds(leads);
  const selectedCount = isAdmin ? getSelectedLeadCount(leads) : 0;
  const allSelected = isAdmin && pagedLeads.length > 0 && pagedLeads.every(isLeadSelected);
  const assignableCounselors = isAdmin ? getAdminAssignmentOptions() : [];
  const bulkToolbar = isAdmin
    ? `
      <div class="bulk-toolbar">
        <label class="bulk-select-control">
          <input id="preBulkSelect" type="checkbox" ${allSelected ? "checked" : ""} />
          <span>Select All</span>
        </label>
        <div class="bulk-select-actions">
          <span class="selected-count">Selected: ${selectedCount}</span>
          <button id="preBulkDelete" class="btn-delete bulk-delete-btn" type="button" ${selectedCount ? "" : "disabled"}>Delete Selected</button>
        </div>
        <div class="bulk-admin-tools">
          <div class="bulk-inline-group">
            <input id="preBulkCountInput" class="bulk-count-input" type="number" min="1" max="${leads.length || 1}" placeholder="Count" />
            <button id="preBulkCountApply" class="btn-ghost bulk-action-btn" type="button" ${leads.length ? "" : "disabled"}>Select Count</button>
          </div>
          <div class="bulk-inline-group">
            <select id="preBulkAssignCounselor" class="bulk-assign-select">
              <option value="">Assign to</option>
              ${assignableCounselors.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}
            </select>
            <button id="preBulkAssignBtn" class="btn-ghost bulk-action-btn" type="button" ${selectedCount ? "" : "disabled"}>Assign Selected</button>
          </div>
        </div>
      </div>
    `
    : "";
  const selectionColumn = isAdmin
    ? `<th class="selection-header">Select</th>`
    : "";
  const emptyColspan = isAdmin ? 8 : 7;

  let html = `
    ${bulkToolbar}
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            ${selectionColumn}
            <th>Lead Import Date</th>
            <th>Name</th>
            <th>Phone Number</th>
            <th>Email</th>
            <th>Workshop Name</th>
            <th>Counselor</th>
            <th>Activity Status</th>
          </tr>
        </thead>
        <tbody>
  `;

  if (!pagedLeads.length) {
    html += `<tr><td colspan="${emptyColspan}">No leads found for current filters.</td></tr>`;
  } else {
    html += pagedLeads
      .map(
        (lead) => `
      <tr>
        ${isAdmin ? `
        <td>
          <input class="lead-select-checkbox" type="checkbox" data-lead-key="${escapeHtml(buildLeadSelectionKey(lead))}" ${isLeadSelected(lead) ? "checked" : ""} />
        </td>
        ` : ""}
        <td>${escapeHtml(lead.createdAt)}</td>
        <td>${escapeHtml(lead.name)}</td>
        <td>${escapeHtml(lead.phone || "-")}</td>
        <td>${escapeHtml(lead.email)}</td>
        <td>${escapeHtml(lead.workshop)}</td>
        <td>${escapeHtml(lead.counselor || "Unassigned")}</td>
        <td>${renderActivityStatusPanel(lead)}</td>
      </tr>
    `
      )
      .join("");
  }

  html += `</tbody></table></div>`;
  preLeadTableSection.innerHTML = html;


  document.querySelectorAll(".btn-update-status").forEach((button) => {
    button.onclick = () => {
      const leadId = button.getAttribute("data-lead-id");
      const leadEmail = button.getAttribute("data-lead-email");
      openActivityStatusModal(leadId, leadEmail);
    };
  });

  document.querySelectorAll(".btn-notes").forEach((button) => {
    button.onclick = () => {
      const leadId = button.getAttribute("data-lead-id");
      const leadEmail = button.getAttribute("data-lead-email");
      openNotesModal(leadId, leadEmail);
    };
  });

  document.querySelectorAll(".btn-task").forEach((button) => {
    button.onclick = () => {
      const leadId = button.getAttribute("data-lead-id");
      openTaskModal(leadId);
    };
  });

  document.querySelectorAll(".btn-activity-history").forEach((button) => {
    button.onclick = () => {
      const leadId = button.getAttribute("data-lead-id");
      const leadEmail = button.getAttribute("data-lead-email");
      const allLeads = getAllLeads();
      const lead = findLeadByActionIdentity(allLeads, leadId, leadEmail);
      if (lead) {
        openActivityHistory(lead.id, lead.name, lead.email);
      }
    };
  });

  document.querySelectorAll(".btn-delete").forEach((button) => {
    button.onclick = async () => {
      const leadId = button.getAttribute("data-lead-id");
      if (leadId && await deleteLead(leadId)) {
        clearSelectedLeadIds();
        renderAll();
      }
    };
  });

  const bulkSelect = document.getElementById("preBulkSelect");
  if (bulkSelect) {
    bulkSelect.onchange = (event) => {
      toggleAllLeadsSelection(leads, event.target.checked);
      renderAll();
    };
  }

  const bulkDelete = document.getElementById("preBulkDelete");
  if (bulkDelete) {
    bulkDelete.onclick = () => {
      void deleteSelectedLeads(leads).then((deleted) => {
        if (deleted) {
          renderAll();
        }
      });
    };
  }

  const bulkCountApply = document.getElementById("preBulkCountApply");
  const bulkCountInput = document.getElementById("preBulkCountInput");
  if (bulkCountApply && bulkCountInput) {
    bulkCountApply.onclick = () => {
      const selectedBatchCount = selectLeadBatch(leads, bulkCountInput.value);
      if (!selectedBatchCount) {
        showToast("Enter a valid lead count to select.", true);
        return;
      }

      renderAll();
      showToast(`Selected ${selectedBatchCount} lead${selectedBatchCount === 1 ? "" : "s"}.`, false);
    };
  }

  const bulkAssignBtn = document.getElementById("preBulkAssignBtn");
  const bulkAssignCounselor = document.getElementById("preBulkAssignCounselor");
  if (bulkAssignBtn && bulkAssignCounselor) {
    bulkAssignBtn.onclick = () => {
      void assignSelectedLeads(leads, bulkAssignCounselor.value).then((assigned) => {
        if (assigned) {
          renderAll();
        }
      });
    };
  }

  document.querySelectorAll(".lead-select-checkbox").forEach((checkbox) => {
    checkbox.onchange = (event) => {
      const leadKey = checkbox.getAttribute("data-lead-key");
      if (leadKey) {
        toggleLeadSelection(leadKey, event.target.checked);
        renderAll();
      }
    };
  });

  renderPaginationControls(totalLeads);
}

function renderPaginationControls(totalLeads) {
  const container = document.getElementById("prePaginationSection");
  if (!container) return;

  const totalPages = Math.ceil(totalLeads / pageSize) || 1;
  if (totalPages <= 1) {
    container.innerHTML = "";
    return;
  }

  const startRange = totalLeads === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endRange = Math.min(currentPage * pageSize, totalLeads);

  let html = `
    <div class="pagination-info">
      Showing ${startRange}–${endRange} of ${totalLeads} leads
    </div>
    <div class="pagination-buttons">
      <button class="btn-ghost pagination-btn" id="prevPageBtn" ${currentPage === 1 ? "disabled" : ""}>Previous</button>
  `;

  const maxVisiblePages = 5;
  let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
  let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
  if (endPage - startPage + 1 < maxVisiblePages) {
    startPage = Math.max(1, endPage - maxVisiblePages + 1);
  }

  if (startPage > 1) {
    html += `<button class="btn-ghost pagination-btn page-num-btn" data-page="1">1</button>`;
    if (startPage > 2) html += `<span class="pagination-ellipsis">...</span>`;
  }

  for (let i = startPage; i <= endPage; i++) {
    html += `<button class="btn-ghost pagination-btn page-num-btn ${i === currentPage ? "pagination-btn--active" : ""}" data-page="${i}">${i}</button>`;
  }

  if (endPage < totalPages) {
    if (endPage < totalPages - 1) html += `<span class="pagination-ellipsis">...</span>`;
    html += `<button class="btn-ghost pagination-btn page-num-btn" data-page="${totalPages}">${totalPages}</button>`;
  }

  html += `
      <button class="btn-ghost pagination-btn" id="nextPageBtn" ${currentPage === totalPages ? "disabled" : ""}>Next</button>
    </div>
  `;

  container.innerHTML = html;

  const prevBtn = document.getElementById("prevPageBtn");
  if (prevBtn) {
    prevBtn.onclick = () => {
      if (currentPage > 1) {
        currentPage--;
        renderAll();
      }
    };
  }

  const nextBtn = document.getElementById("nextPageBtn");
  if (nextBtn) {
    nextBtn.onclick = () => {
      if (currentPage < totalPages) {
        currentPage++;
        renderAll();
      }
    };
  }

  container.querySelectorAll(".page-num-btn").forEach((button) => {
    button.onclick = (e) => {
      currentPage = Number(e.target.getAttribute("data-page"));
      renderAll();
    };
  });
}

function setActivityModalMode(mode) {
  modalMode = mode;
  const title = document.getElementById("activityModalTitle");
  const saveButton = document.getElementById("saveActivityBtn");

  if (title) {
    title.textContent = mode === "view" ? "Activity Details" : "Update Activity Status";
  }

  if (saveButton) {
    saveButton.classList.toggle("hidden", mode === "view");
  }

  activityFields.forEach((fieldId) => {
    const field = document.getElementById(fieldId);
    if (field) {
      field.disabled = mode === "view";
    }
  });
}

function populateActivityModal(lead) {
  document.getElementById("modalDialed").value = lead.dialed;
  document.getElementById("modalCallStatus").value = lead.callStatus;
  document.getElementById("modalWsStatus").value = lead.wsStatus;
  document.getElementById("modalWhatsappInvite").value = lead.whatsappInvite;
  document.getElementById("modalWhatsappGroupStatus").value = lead.whatsappGroupStatus;
}

function findLeadByActionIdentity(leads, leadId, leadEmail = "") {
  const normalizedId = String(leadId);
  const normalizedEmail = String(leadEmail || "").trim().toLowerCase();
  if (normalizedEmail) {
    const exactLead = leads.find((lead) => (
      String(lead.id) === normalizedId &&
      String(lead.email || "").trim().toLowerCase() === normalizedEmail
    ));
    if (exactLead) return exactLead;
  }

  if (isCounselorSession()) {
    const counselorIdentity = getCounselorIdentity();
    const counselorLead = leads.find((lead) => (
      String(lead.id) === normalizedId &&
      String(lead.counselor || "").trim().toLowerCase() === counselorIdentity
    ));
    if (counselorLead) return counselorLead;
  }

  return leads.find((lead) => String(lead.id) === normalizedId);
}

async function updateLeadActivity(leadId, updates, leadEmail = "") {
  const allLeads = getAllLeads();
  const lead = findLeadByActionIdentity(allLeads, leadId, leadEmail);
  if (!lead) {
    return false;
  }

  if (isCounselorSession()) {
    const owner = String(lead.counselor || "").trim().toLowerCase();
    if (owner !== getCounselorIdentity()) {
      return false;
    }
  }

  try {
    const result = await updateLeadActivityOnServer(leadId, {
      stage: "workshop",
      updates,
      leadEmail: leadEmail || lead.email || ""
    });
    if (result && result.ok === false) {
      showToast(result.message || "Failed to save activity. Please check your connection and try again.", true);
      return false;
    }

    showToast("Workshop Calling activity saved successfully.", false);
    return true;
  } catch (err) {
    console.error("[pre-workshop] Failed to persist leads:", err);
    showToast("Failed to save activity. Please check your connection and try again.", true);
    return false;
  }
}

function openActivityStatusModal(leadId, leadEmail = "") {
  modalLeadId = leadId;
  modalLeadEmail = leadEmail || "";
  const allLeads = getAllLeads();
  const lead = findLeadByActionIdentity(allLeads, leadId, leadEmail);

  if (!lead) {
    showToast("Could not open this lead. Please refresh and try again.", true);
    return;
  }

  if (isCounselorSession()) {
    const owner = String(lead.counselor || "").trim().toLowerCase();
    if (owner !== getCounselorIdentity()) {
      showToast("Only the assigned counselor can update this lead.", true);
      return;
    }
  }

  setActivityModalMode("edit");
  populateActivityModal(lead);
  document.getElementById("activityStatusModal").classList.remove("hidden");
}


function closeActivityStatusModal() {
  document.getElementById("activityStatusModal").classList.add("hidden");
  modalLeadId = null;
  modalLeadEmail = "";
  setActivityModalMode("edit");
}

let notesLeadId = null;
let notesLeadEmail = "";

function canEditLeadNotes(lead) {
  if (isAdmin) return true;
  if (!isCounselorSession()) return false;
  const owner = String(lead?.counselor || "").trim().toLowerCase();
  return owner === getCounselorIdentity();
}

function openNotesModal(leadId, leadEmail = "") {
  notesLeadId = leadId;
  notesLeadEmail = leadEmail || "";
  const allLeads = getAllLeads();
  const lead = findLeadByActionIdentity(allLeads, leadId, leadEmail);
  if (!lead) {
    showToast("Could not open this lead's notes. Please refresh and try again.", true);
    return;
  }

  const notes = Array.isArray(lead.leadNotes) ? lead.leadNotes : [];
  const canEditNotes = canEditLeadNotes(lead);
  const notesListSection = document.getElementById("notesListSection");
  if (notesListSection) {
    notesListSection.innerHTML = notes.length
      ? notes.map((note, idx) => `
        <div class="note-item">
          <span class="note-text">${escapeHtml(note.text)}</span>
          <span class="note-meta">${escapeHtml(note.by || "")}${note.by && note.at ? " \u2013 " : ""}${escapeHtml(note.at || "")}</span>
          ${canEditNotes ? `<button type="button" class="btn-ghost btn-delete-note" data-note-index="${idx}" style="font-size:0.75rem;padding:2px 6px;">Delete</button>` : ""}
        </div>`).join("")
      : `<p class="block-help">${canEditNotes ? "No notes yet. Add one below." : "No notes yet."}</p>`;

    notesListSection.querySelectorAll(".btn-delete-note").forEach((btn) => {
      btn.onclick = () => {
        const idx = Number(btn.getAttribute("data-note-index"));
        void deleteNote(leadId, idx, leadEmail || lead.email || "");
      };
    });
  }

  const newNoteInput = document.getElementById("newNoteInput");
  if (newNoteInput) {
    newNoteInput.value = "";
  }

  const noteInputRow = newNoteInput?.closest(".modal-row");
  if (noteInputRow) {
    noteInputRow.classList.toggle("hidden", !canEditNotes);
  }

  const saveNoteBtn = document.getElementById("saveNoteBtn");
  if (saveNoteBtn) {
    saveNoteBtn.classList.toggle("hidden", !canEditNotes);
  }

  const notesModal = document.getElementById("notesModal");
  if (notesModal) {
    notesModal.classList.remove("hidden");
  }
}

function closeNotesModal() {
  const notesModal = document.getElementById("notesModal");
  if (notesModal) {
    notesModal.classList.add("hidden");
  }
  notesLeadId = null;
  notesLeadEmail = "";
}

async function saveNote() {
  const newNoteInput = document.getElementById("newNoteInput");
  const text = newNoteInput ? newNoteInput.value.trim() : "";
  if (!text || !notesLeadId) {
    return;
  }

  const allLeads = getAllLeads();
  const lead = findLeadByActionIdentity(allLeads, notesLeadId, notesLeadEmail);
  if (!lead) {
    return;
  }
  if (!canEditLeadNotes(lead)) {
    showToast("Only the assigned counselor or admin can edit notes.", true);
    return;
  }

  const noteSaveResult = await addLeadNote(notesLeadId, text, notesLeadEmail || lead.email || "");
  if (!noteSaveResult || noteSaveResult.ok === false) {
    showToast(noteSaveResult?.message || "Failed to save note. Please check your connection and try again.", true);
    return;
  }
  openNotesModal(notesLeadId, notesLeadEmail || lead.email || "");
  showToast("Note saved.", false);
}

async function deleteNote(leadId, noteIndex, leadEmail = "") {
  const allLeads = getAllLeads();
  const lead = findLeadByActionIdentity(allLeads, leadId, leadEmail);
  if (!lead) {
    return;
  }
  if (!canEditLeadNotes(lead)) {
    showToast("Only the assigned counselor or admin can delete notes.", true);
    return;
  }

  const noteDeleteResult = await deleteLeadNote(leadId, noteIndex, leadEmail || lead.email || "");
  if (!noteDeleteResult || noteDeleteResult.ok === false) {
    showToast(noteDeleteResult?.message || "Failed to delete note. Please check your connection and try again.", true);
    return;
  }
  openNotesModal(leadId, leadEmail || lead.email || "");
  showToast("Note deleted.", false);
}

function setTaskMessage(text, isError = true) {
  if (!taskMessage) {
    return;
  }

  taskMessage.textContent = text;
  taskMessage.style.color = isError ? "#b42318" : "#0f766e";
}

function closeTaskModal() {
  if (taskModal) {
    taskModal.classList.add("hidden");
  }
  setTaskMessage("");
}

function openTaskModal(leadId) {
  if (!canCreateTasks) {
    return;
  }

  const availableLeads = isCounselorSession() ? getScopedLeads(getAllLeads()) : getAllLeads();
  const lead = availableLeads.find((item) => String(item.id) === String(leadId));
  if (!lead) {
    return;
  }

  taskLeadIdInput.value = lead.id;
  taskCategoryInput.value = TASK_CATEGORY.workshop;
  taskLeadNameInput.value = lead.name || "";
  taskCounselorInput.value = lead.counselor || "Unassigned";
  const taskLeadPhoneInput = document.getElementById("taskLeadPhone");
  if (taskLeadPhoneInput) {
    taskLeadPhoneInput.value = lead.phone || "-";
  }
  taskTitleInput.value = `Follow up with ${lead.name || "lead"}`;
  taskNotesInput.value = "";
  taskDueDateInput.value = "";
  setTaskMessage("");
  taskModalTitle.textContent = "Create Workshop Task";
  taskModal.classList.remove("hidden");
}

async function handleTaskSubmit(event) {
  event.preventDefault();

  const leadId = taskLeadIdInput.value;
  const title = taskTitleInput.value.trim();
  const dueDate = taskDueDateInput.value;

  if (!leadId || !title || !dueDate) {
    setTaskMessage("Title and due date are required.", true);
    return;
  }

  const allLeads = getAllLeads();
  const lead = allLeads.find((item) => String(item.id) === String(leadId));
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
    category: TASK_CATEGORY.workshop,
    title,
    notes: taskNotesInput.value.trim(),
    dueDate
  });

  if (!taskResult || taskResult.ok === false) {
    setTaskMessage(taskResult?.message || "Failed to save task. Please check your connection and try again.", true);
    return;
  }

  setTaskMessage("Task created and sent to Task Tracker.", false);
  closeTaskModal();
}

function initPreWorkshopPage() {
  const modal = document.getElementById("activityStatusModal");
  if (modal) {
    document.getElementById("closeModalBtn").onclick = closeActivityStatusModal;
    document.getElementById("activityStatusForm").onsubmit = async (event) => {
      event.preventDefault();
      if (!modalLeadId) {
        return;
      }

      const saved = await updateLeadActivity(modalLeadId, {
        dialed: document.getElementById("modalDialed").value,
        callStatus: document.getElementById("modalCallStatus").value,
        wsStatus: document.getElementById("modalWsStatus").value,
        whatsappInvite: document.getElementById("modalWhatsappInvite").value,
        whatsappGroupStatus: document.getElementById("modalWhatsappGroupStatus").value
      }, modalLeadEmail);

      closeActivityStatusModal();
      if (saved) {
        renderAll();
      }
    };
  }

  if (taskModal && taskForm) {
    document.getElementById("closeTaskModalBtn").onclick = closeTaskModal;
    taskForm.onsubmit = handleTaskSubmit;
  }

  const notesModal = document.getElementById("notesModal");
  if (notesModal) {
    document.getElementById("closeNotesModalBtn").onclick = closeNotesModal;
    document.getElementById("saveNoteBtn").onclick = () => {
      void saveNote();
    };
  }

  document.querySelectorAll(".btn-task").forEach((button) => {
    button.addEventListener("click", () => {
      const leadId = button.getAttribute("data-lead-id");
      if (leadId) {
        openTaskModal(leadId);
      }
    });
  });

}

initPreWorkshopPage();

function renderAll() {
  const allLeads = getAllLeads();
  normalizeLeadFields(allLeads);

  const scopedLeads = getScopedLeads(allLeads);
  const preWorkshopLeads = getPreWorkshopLeads(scopedLeads);
  normalizeFilterState(preWorkshopLeads);
  const filteredLeads = filterLeads(preWorkshopLeads);

  renderKpis(filteredLeads);
  const _focusedId = document.activeElement?.id;
  const _selStart = document.activeElement?.selectionStart;
  const _selEnd = document.activeElement?.selectionEnd;
  renderFilters(preWorkshopLeads);
  if (_focusedId) {
    const _el = document.getElementById(_focusedId);
    if (_el) {
      _el.focus();
      if (_selStart != null) _el.setSelectionRange(_selStart, _selEnd);
    }
  }
  renderLeadTable(filteredLeads);
}

renderAll();
const stopStatePolling = startStatePolling(() => {
  renderAll();
});
registerPageCleanup(stopStatePolling);
