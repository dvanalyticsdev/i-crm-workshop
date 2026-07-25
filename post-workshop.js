import { registerPageCleanup } from "./page-runtime.js";
import { openActivityHistory } from "./activity-history.js";
import { exportLeadRowsToExcel } from "./lead-export.js";
import { normalizeCrmCourseValue, populateCrmCourseSelect } from "./course-catalog.js";
import {
  bootstrapLocalState,
  getCounselors as getStoredCounselors,
  getLeads as getStoredLeads,
  getSession,
  loadLocalPreference,
  saveLocalPreference,
  startStatePolling
} from "./state-sync.js";
import { createTask, TASK_CATEGORY, toTaskDueDateIso } from "./task-service.js";
import { triggerMcubeClickToCall } from "./mcube-call-service.js";
import {
  addLeadNote,
  assignLeads as assignLeadsOnServer,
  deleteLeads as deleteLeadsOnServer,
  deleteLeadNote,
  formatLeadAssignmentResult,
  trackLeadView,
  updateLeadActivity as updateLeadActivityOnServer
} from "./lead-service.js";

await bootstrapLocalState();

const postKpiSection = document.getElementById("postKpiSection");
const postFilterBar = document.getElementById("postFilterBar");
const postActivityMessage = document.getElementById("postActivityMessage");
const postLeadTableSection = document.getElementById("postLeadTableSection");
const workshopSectionNav = document.getElementById("workshopSectionNav");
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
const isAdmin = session?.role === "admin" || session?.role === "super_admin";
const canUseLeadRowActions = !isAdmin;
const canCreateTasks = session?.role === "counselor";

postFilterBar.classList.add("filter-bar--crm");

const EMPTY_FILTER_VALUE = "__EMPTY_FILTER__";
const EMPTY_FILTER_LABEL = "Use Filter";
const SELECT_ALL_FILTER_VALUE = "__SELECT_ALL__";
const BLANK_FILTER_VALUE = "__BLANK_FILTER__";
const ADMISSION_STATUS_OPTIONS = ["In-Conversation", "Opportunity", "Offered", "Enrolled", "Won"];
const WHATSAPP_ACTIVITY_FILTER_OPTIONS = ["WhatsApp Read", "WhatsApp Clicked", "WhatsApp Replied"];

populateCrmCourseSelect("modalCoursePitched", { includeNo: true });

function getSelectedFilterValues(value) {
  const rawValues = Array.isArray(value) ? value : [value];
  return rawValues
    .map((item) => String(item || "").trim())
    .filter((item) => item && item !== EMPTY_FILTER_VALUE && item !== SELECT_ALL_FILTER_VALUE && item !== "All");
}

function isSelectedFilterValue(value) {
  return getSelectedFilterValues(value).length > 0;
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

function getAdmissionWorkshopName(lead) {
  return String(lead?.admissionWorkshop || lead?.workshop || "").trim();
}

function shortenWorkshopLabel(workshopName) {
  const coreName = getCoreWorkshopName(workshopName);
  const cleaned = coreName.replace(/\bworkshop\b/gi, "").replace(/\s{2,}/g, " ").trim();
  return cleaned || coreName;
}

function extractWorkshopDate(workshopName) {
  const coreName = getCoreWorkshopName(workshopName);
  const match = coreName.match(/(\d{1,2})(?:st|nd|rd|th)\s+([A-Za-z]+)/i);
  if (!match) {
    return null;
  }

  const monthLookup = {
    jan: 0,
    january: 0,
    feb: 1,
    february: 1,
    mar: 2,
    march: 2,
    apr: 3,
    april: 3,
    may: 4,
    jun: 5,
    june: 5,
    jul: 6,
    july: 6,
    aug: 7,
    august: 7,
    sep: 8,
    sept: 8,
    september: 8,
    oct: 9,
    october: 9,
    nov: 10,
    november: 10,
    dec: 11,
    december: 11
  };

  const day = Number(match[1]);
  const monthIndex = monthLookup[String(match[2] || "").toLowerCase()];
  if (!Number.isFinite(day) || monthIndex == null) {
    return null;
  }

  return new Date(2026, monthIndex, day);
}

function getAdmissionWorkshopFilterName(lead) {
  const sourceName = String(lead?.admissionWorkshop || lead?.workshop || lead?.admissionWorkshopName || "").trim();
  const shortened = shortenWorkshopLabel(sourceName);
  return shortened.replace(/\s+\d{1,2}(?:st|nd|rd|th)\s+[A-Za-z]+$/i, "").trim();
}

function getAdmissionWorkshopFilterDate(lead) {
  const explicitDateLabel = String(lead?.admissionWorkshopDateLabel || lead?.workshopDateLabel || "").trim();
  if (explicitDateLabel) {
    return explicitDateLabel;
  }

  const workshopDate = extractWorkshopDate(getAdmissionWorkshopName(lead));
  if (!(workshopDate instanceof Date) || Number.isNaN(workshopDate.getTime())) {
    return "";
  }

  const day = workshopDate.getDate();
  const month = workshopDate.toLocaleDateString("en-IN", { month: "long" });
  const remainder = day % 100;
  let suffix = "th";
  if (remainder < 11 || remainder > 13) {
    if (day % 10 === 1) suffix = "st";
    else if (day % 10 === 2) suffix = "nd";
    else if (day % 10 === 3) suffix = "rd";
  }
  return `${day}${suffix} ${month}`;
}

function getUniqueCoreWorkshops(leads) {
  const coreNames = leads.map((lead) => getCoreWorkshopName(getAdmissionWorkshopName(lead))).filter(Boolean);
  return [...new Set(coreNames)];
}

function getUniqueAdmissionWorkshopNames(leads) {
  return [...new Set(
    leads
      .map((lead) => getAdmissionWorkshopFilterName(lead))
      .filter(Boolean)
  )];
}

function getUniqueAdmissionWorkshopDates(leads) {
  return [...new Set(
    leads
      .map((lead) => getAdmissionWorkshopFilterDate(lead))
      .filter(Boolean)
  )];
}

function getAdmissionWorkshopOptions(leads) {
  return [...new Set(
    leads
      .flatMap((lead) => [lead?.workshop, lead?.admissionWorkshop])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  )].sort((left, right) => left.localeCompare(right));
}

function filterIncludesValue(filterValue, value) {
  const selected = getSelectedFilterValues(filterValue);
  if (!selected.length) {
    return true;
  }

  const normalizedValue = String(value || "").trim();
  return selected.some((item) => (
    item === BLANK_FILTER_VALUE ? normalizedValue === "" : item === normalizedValue
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

function getActivityLabel(activity = {}) {
  return String(
    activity?.activityType
    || activity?.type
    || activity?.eventType
    || activity?.actionType
    || activity?.label
    || ""
  ).trim();
}

function leadMatchesWhatsappActivity(lead, selectedActivities, historyField) {
  const selected = getSelectedFilterValues(selectedActivities);
  if (!selected.length) {
    return true;
  }

  const history = Array.isArray(lead?.[historyField]) ? lead[historyField] : [];
  const latestEntry = getLatestHistoryEntry(history);
  return selected.includes(getActivityLabel(latestEntry));
}

function getEntryTimestamp(value) {
  const candidate = String(
    value?.at
    || value?.timestamp
    || value?.createdAt
    || value?.updatedAt
    || value?.migratedAt
    || value
    || ""
  ).trim();
  if (!candidate) {
    return Number.NaN;
  }
  return new Date(candidate).getTime();
}

function getLatestHistoryEntry(history) {
  if (!Array.isArray(history) || !history.length) {
    return null;
  }

  return history.reduce((latest, entry) => {
    if (!latest) {
      return entry;
    }
    return getEntryTimestamp(entry) >= getEntryTimestamp(latest) ? entry : latest;
  }, null);
}

function getLatestLeadActivityTimestamp(lead) {
  return getEntryTimestamp(getLatestHistoryEntry(lead?.admissionActivityHistory));
}

function getLatestRepeatEnquiryTimestamp(lead) {
  const candidates = [
    getEntryTimestamp(lead?.lastRepeatEnquiryAt),
    getEntryTimestamp(lead?.lastWorkshopMigrationAt)
  ];
  if (Array.isArray(lead?.workshopMigrationHistory) && lead.workshopMigrationHistory.length) {
    candidates.push(...lead.workshopMigrationHistory.map((entry) => getEntryTimestamp(entry)));
  }
  const valid = candidates.filter((value) => Number.isFinite(value));
  return valid.length ? Math.max(...valid) : Number.NaN;
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
  leadOwner: isCounselorSession() ? "direct" : "all",
  workshopName: EMPTY_FILTER_VALUE,
  workshopDate: EMPTY_FILTER_VALUE,
  counselor: EMPTY_FILTER_VALUE,
  activityStatus: EMPTY_FILTER_VALUE,
  whatsappActivity: EMPTY_FILTER_VALUE,
  postDialed: EMPTY_FILTER_VALUE,
  coursePitched: EMPTY_FILTER_VALUE,
  admissionStatus: EMPTY_FILTER_VALUE,
  courseStatus: EMPTY_FILTER_VALUE,
  postCallStatus: EMPTY_FILTER_VALUE,
  workshopJoiningStatus: EMPTY_FILTER_VALUE,
  repeatEnquiryStatus: EMPTY_FILTER_VALUE,
  workshopCallingDialed: EMPTY_FILTER_VALUE,
  workshopCallingCallStatus: EMPTY_FILTER_VALUE,
  workshopCallingWsStatus: EMPTY_FILTER_VALUE,
  workshopCallingWhatsappInvite: EMPTY_FILTER_VALUE,
  workshopCallingWhatsappGroupStatus: EMPTY_FILTER_VALUE
};

const FILTER_STORAGE_KEY = "dvWorkshopAdmissionCallingFilters";
const persistedFilter = await loadLocalPreference(FILTER_STORAGE_KEY, {});

if (persistedFilter.workshopCalling && !persistedFilter.workshopCallingWsStatus) {
  persistedFilter.workshopCallingWsStatus = persistedFilter.workshopCalling;
}

if (persistedFilter.workshop && !persistedFilter.workshopName) {
  persistedFilter.workshopName = persistedFilter.workshop;
}

if (persistedFilter.timeline === "daily") {
  persistedFilter.timeline = "today";
}

Object.keys(DEFAULT_FILTER).forEach((key) => {
  if (persistedFilter[key] === "All" || persistedFilter[key] === "Select" || persistedFilter[key] === EMPTY_FILTER_LABEL) {
    persistedFilter[key] = EMPTY_FILTER_VALUE;
  }
});

let filter = {
  ...DEFAULT_FILTER,
  ...persistedFilter
};
filter.leadOwner = ["all", "direct", "reassigned"].includes(String(filter.leadOwner || "").trim())
  ? String(filter.leadOwner || "").trim()
  : DEFAULT_FILTER.leadOwner;

if (isCounselorSession() && (!persistedFilter.timeline || persistedFilter.timeline === "week")) {
  filter.timeline = "overall";
}

let modalLeadId = null;
let modalLeadEmail = "";
let modalMode = "edit";
let selectedLeadKeys = new Set();
let searchTimeout = null;
let currentPage = 1;
const pageSize = 50;
const activityFields = ["modalPostDialed", "modalCoursePitched", "modalCourseStatus", "modalAdmissionStatus", "modalPostCallStatus", "modalAdmissionWorkshop", "modalWorkshopJoiningStatus", "modalPostActivityNote"];

function setMessage(text, isError = true) {
  if (!postActivityMessage) {
    return;
  }

  postActivityMessage.textContent = text;
  postActivityMessage.style.color = isError ? "var(--danger)" : "var(--success)";
}

function persistFilterState() {
  void saveLocalPreference(FILTER_STORAGE_KEY, filter);
}

function parseDateKey(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function parseLeadOwnerDate(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return parseDateKey(raw);
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getLeadOwnerType(lead) {
  return String(lead?.leadOwnerType || "").trim().toLowerCase() === "reassigned"
    || (String(lead?.assignedFromCounselor || "").trim() && String(lead?.assignedFromCounselor || "").trim().toLowerCase() !== "unassigned")
    ? "reassigned"
    : "direct";
}

function getLeadOwnerTimelineValue(lead) {
  if (getLeadOwnerType(lead) === "reassigned") {
    return String(
      lead?.leadOwnerTimelineAt
      || lead?.counselorAssignedAt
      || lead?.updatedAt
      || lead?.createdAtExact
      || lead?.createdAt
      || ""
    ).trim();
  }

  return String(lead?.createdAtExact || lead?.createdAt || "").trim();
}

function filterByLeadOwner(leads) {
  if (filter.leadOwner === "all") {
    return leads;
  }

  return leads.filter((lead) => {
    const ownerType = getLeadOwnerType(lead);
    return filter.leadOwner === "reassigned"
      ? ownerType === "reassigned"
      : ownerType === "direct";
  });
}

function getLeadOwnerFilterLabel() {
  if (filter.leadOwner === "reassigned") return "Assigned From Someone Else";
  if (filter.leadOwner === "direct") return "Directly Assigned";
  return "All Leads";
}

function formatReadableDate(date) {
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function getRepeatEnquiryCount(lead) {
  const explicitCount = Number.isFinite(Number(lead?.repeatEnquiryCount))
    ? Number(lead.repeatEnquiryCount)
    : 0;
  const workshopReentryCount = Array.isArray(lead?.workshopMigrationHistory)
    ? lead.workshopMigrationHistory.length
    : 0;
  if (explicitCount > 0 || workshopReentryCount > 0) {
    return Math.max(explicitCount, workshopReentryCount);
  }

  return lead?.lastRepeatEnquiryAt || lead?.lastWorkshopMigrationAt ? 1 : 0;
}

function isRepeatEnquiryLead(lead) {
  const repeatAt = getLatestRepeatEnquiryTimestamp(lead);
  if (!Number.isFinite(repeatAt)) {
    return false;
  }

  const latestActivityAt = getLatestLeadActivityTimestamp(lead);
  return !Number.isFinite(latestActivityAt) || repeatAt >= latestActivityAt;
}

function renderRepeatEnquiryBadge(lead) {
  if (!isRepeatEnquiryLead(lead)) {
    return "";
  }

  const repeatCount = getRepeatEnquiryCount(lead);
  const badgeTitle = repeatCount > 1
    ? `Repeat enquiry received ${repeatCount} times`
    : "Repeat enquiry received";
  return `<span class="badge badge-warning" title="${escapeHtml(badgeTitle)}">Repeat Enquiry</span>`;
}

function getTimelineRange(leads) {
  const now = new Date();

  if (filter.timeline === "overall") {
    return null;
  }

  if (filter.timeline === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    return {
      start,
      end,
      label: `Today: ${formatReadableDate(start)}`
    };
  }

  if (filter.timeline === "yesterday") {
    const day = new Date(now);
    day.setDate(day.getDate() - 1);
    const start = new Date(day);
    start.setHours(0, 0, 0, 0);
    const end = new Date(day);
    end.setHours(23, 59, 59, 999);
    return {
      start,
      end,
      label: `Yesterday: ${formatReadableDate(start)}`
    };
  }

  if (filter.timeline === "week") {
    const start = new Date(now);
    start.setDate(start.getDate() - 6);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    return {
      start,
      end,
      label: `Weekly: ${formatReadableDate(start)} - ${formatReadableDate(end)}`
    };
  }

  const customStart = filter.startDate ? parseDateKey(filter.startDate) : null;
  const customEnd = filter.endDate ? parseDateKey(filter.endDate) : null;

  if (!customStart || !customEnd || customStart > customEnd) {
    return { start: null, end: null, label: "Custom: Select a valid date range" };
  }

  return {
    start: customStart,
    end: customEnd,
    label: `Custom: ${formatReadableDate(customStart)} - ${formatReadableDate(customEnd)}`
  };
}

function filterLeadsByTimeline(leads, range) {
  const scopedLeads = filterByLeadOwner(leads);
  if (!range) {
    return scopedLeads;
  }

  if (!range.start || !range.end) {
    return scopedLeads;
  }

  const startTime = range.start.getTime();
  const endTime = range.end.getTime();

  return scopedLeads.filter((lead) => {
    const leadDate = parseLeadOwnerDate(getLeadOwnerTimelineValue(lead));
    if (!leadDate || Number.isNaN(leadDate.getTime())) {
      return false;
    }

    const leadTime = leadDate.getTime();
    return leadTime >= startTime && leadTime <= endTime;
  });
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
  if (typeof lead?.admissionActivityTouchedByAssignee === "boolean") {
    return lead.admissionActivityTouchedByAssignee ? 1 : 0;
  }

  return hasAssigneeActivityHistory(lead?.admissionActivityHistory) ? 1 : 0;
}

function hasAssigneeActivityHistory(history) {
  if (!Array.isArray(history)) {
    return false;
  }

  return history.some((entry) => {
    const updates = entry?.updates;
    if (updates && typeof updates === "object" && Object.keys(updates).length > 0) {
      return true;
    }

    const by = String(entry?.by || "").trim().toLowerCase();
    const source = String(entry?.source || "").trim().toLowerCase();
    return Boolean(by) && !["reachout webhook", "system"].includes(by) && source !== "reachout webhook";
  });
}

function leadMatchesWhatsappActivityFilter(lead) {
  return leadMatchesWhatsappActivity(lead, filter.whatsappActivity, "admissionActivityHistory");
}

function isUntouchedLead(lead) {
  return getLeadActivityUpdateCount(lead) === 0;
}

function normalizeLeadFields(leads) {
  leads.forEach((lead) => {
    lead.dialed = lead.dialed || "";
    lead.callStatus = lead.callStatus || "";
    lead.wsStatus = lead.wsStatus || "";
    lead.whatsappInvite = lead.whatsappInvite || "";

    lead.postDialed = lead.postDialed || "";
    lead.coursePitched = normalizeCrmCourseValue(lead.coursePitched, { allowNo: true, preserveUnknown: true });
    lead.courseStatus = lead.courseStatus || "";
    lead.admissionStatus = lead.admissionStatus || "";
    lead.postCallStatus = lead.postCallStatus || "";
    lead.admissionWorkshop = lead.admissionWorkshop || "";
    lead.admissionWorkshopName = getAdmissionWorkshopFilterName(lead);
    lead.admissionWorkshopDateLabel = getAdmissionWorkshopFilterDate(lead);
    lead.workshopJoiningStatus = lead.workshopJoiningStatus || "";
    lead.postStatusUpdated = typeof lead.postStatusUpdated === "boolean" ? lead.postStatusUpdated : false;
    lead.workshopActivityHistory = Array.isArray(lead.workshopActivityHistory) ? lead.workshopActivityHistory : [];
    lead.admissionActivityHistory = Array.isArray(lead.admissionActivityHistory) ? lead.admissionActivityHistory : [];
    lead.preActivityUpdates = lead.workshopActivityHistory.length
      || (Number.isFinite(Number(lead.preActivityUpdates)) ? Number(lead.preActivityUpdates) : 0);
    lead.postActivityUpdates = lead.admissionActivityHistory.length
      || (Number.isFinite(Number(lead.postActivityUpdates)) ? Number(lead.postActivityUpdates) : 0);
    lead.workshopActivityTouchedByAssignee = typeof lead.workshopActivityTouchedByAssignee === "boolean"
      ? lead.workshopActivityTouchedByAssignee
      : hasAssigneeActivityHistory(lead.workshopActivityHistory);
    lead.admissionActivityTouchedByAssignee = typeof lead.admissionActivityTouchedByAssignee === "boolean"
      ? lead.admissionActivityTouchedByAssignee
      : hasAssigneeActivityHistory(lead.admissionActivityHistory);
    lead.whatsappGroupStatus = lead.whatsappGroupStatus || "";
    lead.leadNotes = Array.isArray(lead.leadNotes) ? lead.leadNotes : [];
  });
}

function isNonWorkshopPipelineLead(lead) {
  return ["course-registration", "main-admission"].includes(String(lead?.leadPipeline || "").trim().toLowerCase());
}

function getAllLeads() {
  const leads = getStoredLeads().filter((lead) => !isNonWorkshopPipelineLead(lead));
  normalizeLeadFields(leads);
  return leads;
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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderWorkshopSectionNav(activeRoute = "post-workshop.html") {
  if (!workshopSectionNav) {
    return;
  }

  const sections = [
    {
      route: "pre-workshop.html",
      label: "Workshop Calling",
      description: "Manage the first-stage workshop outreach and calling activity."
    },
    {
      route: "post-workshop.html",
      label: "Admission Calling",
      description: "Continue follow-ups after workshop engagement and push toward admission conversion."
    }
  ];

  workshopSectionNav.innerHTML = `
    <div class="card-head">
      <h3>Workshop Subsections</h3>
      <p>Open the workshop-stage pages from here instead of keeping both links in the sidebar.</p>
    </div>
    <div class="filter-actions" style="display:flex;gap:0.75rem;flex-wrap:wrap;">
      ${sections.map((section) => `
        <button
          type="button"
          class="${activeRoute === section.route ? "btn-primary" : "btn-ghost"}"
          data-workshop-section="${section.route}"
        >
          ${escapeHtml(section.label)}
        </button>
      `).join("")}
    </div>
    <p class="block-help">${escapeHtml(sections.find((section) => section.route === activeRoute)?.description || "")}</p>
  `;

  workshopSectionNav.querySelectorAll("[data-workshop-section]").forEach((button) => {
    button.onclick = () => {
      const route = button.getAttribute("data-workshop-section");
      if (route && route !== window.location.pathname.split("/").pop()) {
        if (typeof window.__dvNavigateToRoute === "function") {
          void window.__dvNavigateToRoute(route);
          return;
        }
        window.location.href = route;
      }
    };
  });
}

function isLostLead(lead) {
  return lead.postStatusUpdated && lead.courseStatus === "Not Interested";
}

function getAdmissionCallingLeads(allLeads) {
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

function renderKpis(leads) {
  const interested = leads.filter((lead) => lead.courseStatus === "Interested").length;
  const enrolled = leads.filter((lead) => lead.admissionStatus === "Enrolled").length;
  const won = leads.filter((lead) => lead.admissionStatus === "Won").length;

  postKpiSection.innerHTML = `
    <article class="card kpi-card">
      <p>Overall Leads</p>
      <h2>${leads.length}</h2>
    </article>
    <article class="card kpi-card">
      <p>Interested</p>
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
  const workshopNames = getUniqueAdmissionWorkshopNames(leads);
  const workshopDates = getUniqueAdmissionWorkshopDates(leads);
  const counselorOptions = [...new Set(
    leads
      .map((lead) => String(lead.counselor || "").trim())
      .filter((name) => name && name.toLowerCase() !== "unassigned")
  )];
  const workshopCallingDialedOptions = getUniqueValues(leads, "dialed");
  const workshopCallingCallStatusOptions = getUniqueValues(leads, "callStatus");
  const workshopCallingWsStatusOptions = getUniqueValues(leads, "wsStatus");
  const workshopCallingWhatsappInviteOptions = getUniqueValues(leads, "whatsappInvite");
  const postDialedOptions = getUniqueValues(leads, "postDialed");
  const coursePitchedOptions = getUniqueValues(leads, "coursePitched");
  const admissionOptions = ADMISSION_STATUS_OPTIONS;

  postFilterBar.innerHTML = `
    <div class="filter-section">
      <div class="filter-section-title">Timeline</div>
      <div class="filter-row">
        <div class="filter-item">
          <label for="postTimelineSelect">Timeline</label>
          <select id="postTimelineSelect">
            <option value="overall">Overall</option>
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="week">Week</option>
            <option value="custom">Custom Range</option>
          </select>
        </div>
        <div class="filter-item hidden" id="postStartDateWrap">
          <label for="postStartDateInput">Start Date</label>
          <input id="postStartDateInput" type="date" />
        </div>
        <div class="filter-item hidden" id="postEndDateWrap">
          <label for="postEndDateInput">End Date</label>
          <input id="postEndDateInput" type="date" />
        </div>
      </div>
    </div>

    <div class="filter-section">
      <div class="filter-section-title">Lead Search & Ownership</div>
      <div class="filter-row">
        <div class="filter-item filter-item--search">
          <label for="postSearchLeadInput">Search Lead</label>
          <input id="postSearchLeadInput" type="text" placeholder="Name, email, phone, workshop, counselor" />
        </div>
        <div class="filter-item">
          <label for="postLeadOwnerSelect">Lead Owner</label>
          <select id="postLeadOwnerSelect">
            <option value="all">All Leads</option>
            <option value="direct">Directly Assigned</option>
            <option value="reassigned">Assigned From Someone Else</option>
          </select>
        </div>
        ${renderMultiSelectControl({
          id: "postCounselorSelect",
          label: "Counselor",
          options: counselorOptions,
          value: filter.counselor,
          itemClass: isAdmin ? "" : " hidden",
          itemAttrs: 'data-admin-only="true"'
        })}
        ${renderMultiSelectControl({
          id: "postActivityStatusSelect",
          label: "Untouched Leads",
          options: ["Untouched", "Updated"],
          value: filter.activityStatus
        })}
      </div>
    </div>

    <div class="filter-section">
      <div class="filter-section-title">Workshop Filters</div>
      <div class="filter-row">
        ${renderMultiSelectControl({
          id: "postWorkshopNameSelect",
          label: "Workshop Name",
          options: workshopNames,
          value: filter.workshopName
        })}
        ${renderMultiSelectControl({
          id: "postWorkshopDateSelect",
          label: "Workshop Date",
          options: workshopDates,
          value: filter.workshopDate
        })}
        ${renderMultiSelectControl({
          id: "postWorkshopCallingDialedSelect",
          label: "Dialed",
          options: withSelectFilterOption(workshopCallingDialedOptions),
          value: filter.workshopCallingDialed
        })}
        ${renderMultiSelectControl({
          id: "postWorkshopCallingCallStatusSelect",
          label: "Call Status",
          options: withSelectFilterOption(workshopCallingCallStatusOptions),
          value: filter.workshopCallingCallStatus
        })}
        ${renderMultiSelectControl({
          id: "postWorkshopCallingWsStatusSelect",
          label: "Workshop Status",
          options: withSelectFilterOption(workshopCallingWsStatusOptions),
          value: filter.workshopCallingWsStatus
        })}
        ${renderMultiSelectControl({
          id: "postWorkshopCallingWhatsappInviteSelect",
          label: "WhatsApp Invite",
          options: withSelectFilterOption(workshopCallingWhatsappInviteOptions),
          value: filter.workshopCallingWhatsappInvite
        })}
        ${renderMultiSelectControl({
          id: "postWorkshopCallingWhatsappGroupStatusSelect",
          label: "WhatsApp Group Status",
          options: withSelectFilterOption(["Joined", "Not Joined"]),
          value: filter.workshopCallingWhatsappGroupStatus
        })}
        ${renderMultiSelectControl({
          id: "postWorkshopJoiningStatusSelect",
          label: "Workshop Joining Status",
          options: withSelectFilterOption(["Joined", "Not Joined"]),
          value: filter.workshopJoiningStatus
        })}
      </div>
    </div>

    <div class="filter-section">
      <div class="filter-section-title">Admission Filters</div>
      <div class="filter-row">
        ${renderMultiSelectControl({
          id: "postRepeatEnquirySelect",
          label: "Repeat Enquiry",
          options: withSelectFilterOption(["Repeat Enquiry", "First Time"]),
          value: filter.repeatEnquiryStatus
        })}
        ${renderMultiSelectControl({
          id: "postWhatsappActivitySelect",
          label: "WhatsApp Activity",
          options: WHATSAPP_ACTIVITY_FILTER_OPTIONS,
          value: filter.whatsappActivity
        })}
        ${renderMultiSelectControl({
          id: "postDialedSelect",
          label: "Dialed",
          options: withSelectFilterOption(postDialedOptions),
          value: filter.postDialed
        })}
        ${renderMultiSelectControl({
          id: "postCoursePitchedSelect",
          label: "Course Pitched",
          options: withSelectFilterOption(coursePitchedOptions),
          value: filter.coursePitched
        })}
        ${renderMultiSelectControl({
          id: "postCourseStatusSelect",
          label: "Course Status",
          options: withSelectFilterOption(["Interested", "Not Interested"]),
          value: filter.courseStatus
        })}
        ${renderMultiSelectControl({
          id: "postAdmissionStatusSelect",
          label: "Admission",
          options: withSelectFilterOption(admissionOptions),
          value: filter.admissionStatus
        })}
        ${renderMultiSelectControl({
          id: "postCallStatusSelect",
          label: "Call Status",
          options: withSelectFilterOption(["Connected", "CBL", "DNP", "CNC"]),
          value: filter.postCallStatus
        })}
      </div>
    </div>

    <div class="filter-section">
      <div class="filter-section-title">Actions</div>
      <div class="filter-row">
        <div class="filter-item filter-item-cta">
          <label>&nbsp;</label>
          <div class="filter-actions">
            <button id="postResetTimeline" class="btn-ghost" type="button">Reset Timeline</button>
            <button id="exportPostWorkshopLeads" class="btn-primary" type="button">Export Leads</button>
            <button id="postResetFilters" class="btn-ghost" type="button">Reset</button>
          </div>
        </div>
      </div>
    </div>
  `;

  bindMultiFilterOutsideClick();
  bindMultiFilter("postWorkshopCallingDialedSelect", "workshopCallingDialed");
  bindMultiFilter("postWorkshopCallingCallStatusSelect", "workshopCallingCallStatus");
  bindMultiFilter("postWorkshopCallingWsStatusSelect", "workshopCallingWsStatus");
  bindMultiFilter("postWorkshopCallingWhatsappInviteSelect", "workshopCallingWhatsappInvite");
  bindMultiFilter("postWorkshopCallingWhatsappGroupStatusSelect", "workshopCallingWhatsappGroupStatus");
  document.getElementById("postTimelineSelect").value = filter.timeline;
  document.getElementById("postStartDateInput").value = filter.startDate;
  document.getElementById("postEndDateInput").value = filter.endDate;
  document.getElementById("postStartDateWrap").classList.toggle("hidden", filter.timeline !== "custom");
  document.getElementById("postEndDateWrap").classList.toggle("hidden", filter.timeline !== "custom");
  document.getElementById("postSearchLeadInput").value = filter.search;
  document.getElementById("postLeadOwnerSelect").value = filter.leadOwner;
  bindMultiFilter("postCounselorSelect", "counselor");
  bindMultiFilter("postActivityStatusSelect", "activityStatus");
  bindMultiFilter("postRepeatEnquirySelect", "repeatEnquiryStatus");
  bindMultiFilter("postWhatsappActivitySelect", "whatsappActivity");
  bindMultiFilter("postWorkshopNameSelect", "workshopName");
  bindMultiFilter("postWorkshopDateSelect", "workshopDate");
  bindMultiFilter("postDialedSelect", "postDialed");
  bindMultiFilter("postCoursePitchedSelect", "coursePitched");
  bindMultiFilter("postCourseStatusSelect", "courseStatus");
  bindMultiFilter("postAdmissionStatusSelect", "admissionStatus");
  bindMultiFilter("postCallStatusSelect", "postCallStatus");
  bindMultiFilter("postWorkshopJoiningStatusSelect", "workshopJoiningStatus");

  document.getElementById("postTimelineSelect").onchange = (event) => {
    filter.timeline = event.target.value;
    persistFilterState();
    document.getElementById("postStartDateWrap").classList.toggle("hidden", filter.timeline !== "custom");
    document.getElementById("postEndDateWrap").classList.toggle("hidden", filter.timeline !== "custom");
    currentPage = 1;
    renderAll();
  };

  document.getElementById("postStartDateInput").onchange = (event) => {
    filter.startDate = event.target.value;
    persistFilterState();
    currentPage = 1;
    renderAll();
  };

  document.getElementById("postEndDateInput").onchange = (event) => {
    filter.endDate = event.target.value;
    persistFilterState();
    currentPage = 1;
    renderAll();
  };

  document.getElementById("postResetTimeline").onclick = () => {
    filter.timeline = DEFAULT_FILTER.timeline;
    filter.startDate = DEFAULT_FILTER.startDate;
    filter.endDate = DEFAULT_FILTER.endDate;
    persistFilterState();
    currentPage = 1;
    renderAll();
  };

  document.getElementById("postSearchLeadInput").onkeydown = (event) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    filter.search = event.target.value.trim();
    persistFilterState();
      currentPage = 1;
      renderAll();
  };

  document.getElementById("postLeadOwnerSelect").onchange = (event) => {
    filter.leadOwner = event.target.value;
    persistFilterState();
    currentPage = 1;
    renderAll();
  };

  document.getElementById("postResetFilters").onclick = () => {
    filter = { ...DEFAULT_FILTER };
    persistFilterState();
    currentPage = 1;
    void renderAll();
  };

  document.getElementById("exportPostWorkshopLeads").onclick = () => {
    exportFilteredLeads();
  };
}

function getPostWorkshopExportRows() {
  const allLeads = getAllLeads();
  normalizeLeadFields(allLeads);
  const scopedLeads = getScopedLeads(allLeads);
  const admissionLeads = getAdmissionCallingLeads(scopedLeads);
  return filterLeads(admissionLeads);
}

function getPostWorkshopTimelineLabel() {
  if (filter.timeline === "today") return "Today";
  if (filter.timeline === "yesterday") return "Yesterday";
  if (filter.timeline === "week") return "Week";
  if (filter.timeline === "custom") {
    if (filter.startDate || filter.endDate) {
      return `${filter.startDate || "Start"} to ${filter.endDate || "End"}`;
    }
    return "Custom Range";
  }
  return "Overall";
}

function exportFilteredLeads() {
  const filteredLeads = getPostWorkshopExportRows();
  const result = exportLeadRowsToExcel({
    rows: filteredLeads,
    columns: [
      { label: "Lead Import Date", getter: (lead) => lead.createdAt },
      { label: "Name", getter: (lead) => lead.name },
      { label: "Phone Number", getter: (lead) => lead.phone || "-" },
      { label: "Email", getter: (lead) => lead.email },
      { label: "Workshop Name", getter: (lead) => getAdmissionWorkshopName(lead) || "-" },
      { label: "Counselor", getter: (lead) => lead.counselor || "Unassigned" },
      { label: "Repeat Enquiry", getter: (lead) => isRepeatEnquiryLead(lead) ? "Yes" : "No" },
      { label: "Dialed", getter: (lead) => lead.postDialed || "" },
      { label: "Course Pitched", getter: (lead) => lead.coursePitched || "" },
      { label: "Course Status", getter: (lead) => lead.courseStatus || "" },
      { label: "Admission", getter: (lead) => lead.admissionStatus || "" },
      { label: "Call Status", getter: (lead) => lead.postCallStatus || "" },
      { label: "Workshop Joining Status", getter: (lead) => lead.workshopJoiningStatus || "" }
    ],
    fileName: `admission-calling-leads-${new Date().toISOString().slice(0, 10)}.xlsx`,
    sheetName: "Admission Calling",
    summary: [
      ["Section", "Workshop"],
      ["Subsection", "Admission Calling"],
      ["Timeline", getPostWorkshopTimelineLabel()],
      ["Filtered Leads", filteredLeads.length]
    ]
  });

  if (!result.ok) {
    showToast(result.message, true);
    return;
  }

  showToast("Admission Calling leads exported successfully.", false);
}

function filterLeads(leads) {
  let filtered = filterLeadsByTimeline(leads, getTimelineRange(leads));

  if (filter.search) {
    const query = filter.search.toLowerCase();
    filtered = filtered.filter((lead) => {
      const haystack = [
        lead.name,
        lead.email,
        lead.phone,
        getAdmissionWorkshopName(lead),
        lead.counselor
      ]
        .map((value) => String(value || "").toLowerCase())
        .join(" ");

      return haystack.includes(query);
    });
  }

  if (isSelectedFilterValue(filter.workshopName)) {
    filtered = filtered.filter((lead) => filterIncludesValue(filter.workshopName, getAdmissionWorkshopFilterName(lead)));
  }

  if (isSelectedFilterValue(filter.workshopDate)) {
    filtered = filtered.filter((lead) => filterIncludesValue(filter.workshopDate, getAdmissionWorkshopFilterDate(lead)));
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

  if (isSelectedFilterValue(filter.repeatEnquiryStatus)) {
    const selectedRepeatStatuses = getSelectedFilterValues(filter.repeatEnquiryStatus);
    if (selectedRepeatStatuses.length === 1 && selectedRepeatStatuses.includes("Repeat Enquiry")) {
      filtered = filtered.filter((lead) => isRepeatEnquiryLead(lead));
    }
    if (selectedRepeatStatuses.length === 1 && selectedRepeatStatuses.includes("First Time")) {
      filtered = filtered.filter((lead) => !isRepeatEnquiryLead(lead));
    }
  }

  if (isSelectedFilterValue(filter.whatsappActivity)) {
    filtered = filtered.filter((lead) => leadMatchesWhatsappActivityFilter(lead));
  }

  if (isSelectedFilterValue(filter.workshopCallingDialed)) {
    filtered = filtered.filter((lead) => filterIncludesValue(filter.workshopCallingDialed, lead.dialed));
  }

  if (isSelectedFilterValue(filter.workshopCallingCallStatus)) {
    filtered = filtered.filter((lead) => filterIncludesValue(filter.workshopCallingCallStatus, lead.callStatus));
  }

  if (isSelectedFilterValue(filter.workshopCallingWsStatus)) {
    filtered = filtered.filter((lead) => filterIncludesValue(filter.workshopCallingWsStatus, lead.wsStatus));
  }

  if (isSelectedFilterValue(filter.workshopCallingWhatsappInvite)) {
    filtered = filtered.filter((lead) => filterIncludesValue(filter.workshopCallingWhatsappInvite, lead.whatsappInvite));
  }

  if (isSelectedFilterValue(filter.workshopCallingWhatsappGroupStatus)) {
    filtered = filtered.filter((lead) => filterIncludesValue(filter.workshopCallingWhatsappGroupStatus, lead.whatsappGroupStatus));
  }

  if (isSelectedFilterValue(filter.postDialed)) {
    filtered = filtered.filter((lead) => filterIncludesValue(filter.postDialed, lead.postDialed));
  }

  if (isSelectedFilterValue(filter.coursePitched)) {
    filtered = filtered.filter((lead) => filterIncludesValue(filter.coursePitched, lead.coursePitched));
  }

  if (isSelectedFilterValue(filter.courseStatus)) {
    filtered = filtered.filter((lead) => filterIncludesValue(filter.courseStatus, lead.courseStatus));
  }

  if (isSelectedFilterValue(filter.admissionStatus)) {
    filtered = filtered.filter((lead) => filterIncludesValue(filter.admissionStatus, lead.admissionStatus));
  }

  if (isSelectedFilterValue(filter.postCallStatus)) {
    filtered = filtered.filter((lead) => filterIncludesValue(filter.postCallStatus, lead.postCallStatus));
  }

  if (isSelectedFilterValue(filter.workshopJoiningStatus)) {
    filtered = filtered.filter((lead) => filterIncludesValue(filter.workshopJoiningStatus, lead.workshopJoiningStatus));
  }

  return filtered;
}

function renderActivityPanel(lead) {
  const hasActivity = !isUntouchedLead(lead);
  const noteCount = Array.isArray(lead.leadNotes) ? lead.leadNotes.length : 0;
  const leadId = escapeHtml(lead.id);
  const leadEmail = escapeHtml(lead.email || "");
  const leadAttrs = `data-lead-id="${leadId}" data-lead-email="${leadEmail}"`;
  const primaryActions = canUseLeadRowActions
    ? `
        <button class="btn-ghost btn-mcube-call activity-panel__icon-btn" type="button" aria-label="Call" title="Call" ${leadAttrs} ${lead.phone ? "" : "disabled"}><span aria-hidden="true">&#9742;</span></button>
        <button class="btn-update-status${hasActivity ? " btn-update-status--active" : ""} activity-panel__icon-btn" type="button" aria-label="Update" title="Update" ${leadAttrs}><span aria-hidden="true">&#9998;</span></button>
      `
    : "";
  const notesAction = canUseLeadRowActions
    ? `<button class="btn-ghost btn-notes activity-panel__link" type="button" ${leadAttrs}>Notes${noteCount ? ` (${noteCount})` : ""}</button>`
    : "";
  return `
    <div class="activity-panel">
      <div class="activity-panel__primary">
        ${primaryActions}
      </div>
      <div class="activity-panel__secondary">
        <button class="btn-ghost btn-view-details activity-panel__link" type="button" ${leadAttrs}>View Details</button>
        ${canCreateTasks ? `<button class="btn-ghost btn-task activity-panel__link" type="button" ${leadAttrs}>Task</button>` : ""}
        ${notesAction}
        <button class="btn-ghost btn-activity-history activity-panel__link" type="button" ${leadAttrs}>Activity</button>
        ${isAdmin ? `<button class="btn-delete activity-panel__link" type="button" ${leadAttrs}>Delete</button>` : ""}
      </div>
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
  const assignableCounselors = isAdmin ? getAdminAssignmentOptions(leads) : [];
  const bulkToolbar = isAdmin
    ? `
      <div class="bulk-toolbar">
        <label class="bulk-select-control">
          <input id="postBulkSelect" type="checkbox" ${allSelected ? "checked" : ""} />
          <span>Select All</span>
        </label>
        <div class="bulk-select-actions">
          <span class="selected-count">Selected: ${selectedCount}</span>
          <button id="postBulkDelete" class="btn-delete bulk-delete-btn" type="button" ${selectedCount ? "" : "disabled"}>Delete Selected</button>
        </div>
        <div class="bulk-admin-tools">
          <div class="bulk-inline-group">
            <input id="postBulkCountInput" class="bulk-count-input" type="number" min="1" max="${leads.length || 1}" placeholder="Count" />
            <button id="postBulkCountApply" class="btn-ghost bulk-action-btn" type="button" ${leads.length ? "" : "disabled"}>Select Count</button>
          </div>
          <div class="bulk-inline-group">
            <select id="postBulkAssignCounselor" class="bulk-assign-select">
              <option value="">Assign to</option>
              ${assignableCounselors.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}
            </select>
            <button id="postBulkAssignBtn" class="btn-ghost bulk-action-btn" type="button" ${selectedCount ? "" : "disabled"}>Assign Selected</button>
          </div>
        </div>
      </div>
    `
    : "";
  const selectionColumn = isAdmin
    ? `<th class="selection-header">Select</th>`
    : "";
  const tableColspan = isAdmin ? 8 : 7;

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
            <th>Admission Calling Activity</th>
          </tr>
        </thead>
        <tbody>
  `;

  if (!pagedLeads.length) {
    html += `<tr><td colspan="${tableColspan}">No admission calling leads available for current filters.</td></tr>`;
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
        <td><div class="lead-name-cell"><span>${escapeHtml(lead.name)}</span>${renderRepeatEnquiryBadge(lead)}</div></td>
        <td>${escapeHtml(lead.phone || "-")}</td>
        <td>${escapeHtml(lead.email)}</td>
        <td>${escapeHtml(getAdmissionWorkshopName(lead))}</td>
        <td>${escapeHtml(lead.counselor || "Unassigned")}</td>
        <td>${renderActivityPanel(lead)}</td>
      </tr>
    `
      )
      .join("");
  }

  html += `</tbody></table></div>`;
  postLeadTableSection.innerHTML = html;


  document.querySelectorAll(".btn-update-status").forEach((button) => {
    button.onclick = () => {
      const leadId = button.getAttribute("data-lead-id");
      const leadEmail = button.getAttribute("data-lead-email");
      openPostActivityModal(leadId, leadEmail);
    };
  });

  document.querySelectorAll(".btn-mcube-call").forEach((button) => {
    button.onclick = () => {
      const leadId = button.getAttribute("data-lead-id");
      const leadEmail = button.getAttribute("data-lead-email");
      const lead = findLeadByActionIdentity(getAllLeads(), leadId, leadEmail);
      if (!lead) {
        showToast("Could not find this lead. Please refresh and try again.", true);
        return;
      }
      void triggerMcubeClickToCall(lead, button, showToast);
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

  document.querySelectorAll(".btn-view-details").forEach((button) => {
    button.onclick = () => {
      const leadId = button.getAttribute("data-lead-id");
      const leadEmail = button.getAttribute("data-lead-email");
      openPostActivityDetailsModal(leadId, leadEmail);
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

  const bulkSelect = document.getElementById("postBulkSelect");
  if (bulkSelect) {
    bulkSelect.onchange = (event) => {
      toggleAllLeadsSelection(leads, event.target.checked);
      renderAll();
    };
  }

  const bulkDelete = document.getElementById("postBulkDelete");
  if (bulkDelete) {
    bulkDelete.onclick = () => {
      void deleteSelectedLeads(leads).then((deleted) => {
        if (deleted) {
          renderAll();
        }
      });
    };
  }

  const bulkCountApply = document.getElementById("postBulkCountApply");
  const bulkCountInput = document.getElementById("postBulkCountInput");
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

  const bulkAssignBtn = document.getElementById("postBulkAssignBtn");
  const bulkAssignCounselor = document.getElementById("postBulkAssignCounselor");
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
  const container = document.getElementById("postPaginationSection");
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

function setPostActivityModalMode(mode) {
  modalMode = mode;
  const title = document.getElementById("postActivityModalTitle");
  const saveButton = document.getElementById("savePostActivityBtn");

  if (title) {
    title.textContent = mode === "view" ? "Activity Details" : "Update Admission Calling Activity";
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

function populatePostActivityModal(lead) {
  const workshopSelect = document.getElementById("modalAdmissionWorkshop");
  if (workshopSelect) {
    const workshopOptions = getAdmissionWorkshopOptions(getAllLeads());
    const selectedWorkshop = getAdmissionWorkshopName(lead);
    const allOptions = [...workshopOptions];
    if (selectedWorkshop && !allOptions.includes(selectedWorkshop)) {
      allOptions.push(selectedWorkshop);
    }
    workshopSelect.innerHTML = [
      '<option value="">Select workshop</option>',
      ...allOptions.map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`)
    ].join("");
    workshopSelect.value = selectedWorkshop;
  }

  document.getElementById("modalPostDialed").value = lead.postDialed;
  document.getElementById("modalCoursePitched").value = lead.coursePitched;
  document.getElementById("modalCourseStatus").value = lead.courseStatus;
  document.getElementById("modalAdmissionStatus").value = lead.admissionStatus;
  document.getElementById("modalPostCallStatus").value = lead.postCallStatus;
  document.getElementById("modalWorkshopJoiningStatus").value = lead.workshopJoiningStatus;
  const noteInput = document.getElementById("modalPostActivityNote");
  if (noteInput) {
    noteInput.value = "";
  }
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

async function updatePostActivity(leadId, updates, leadEmail = "") {
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

  const workshopActivityCount = Array.isArray(lead.workshopActivityHistory)
    ? lead.workshopActivityHistory.length
    : Number(lead.preActivityUpdates) || 0;
  if (!workshopActivityCount) {
    const confirmed = window.confirm(
      "The lead has not been called for Workshop Calling. Do you still want to update the details?"
    );

    if (!confirmed) {
      return false;
    }
  }

  try {
    const result = await updateLeadActivityOnServer(leadId, {
      stage: "admission",
      updates,
      leadEmail: leadEmail || lead.email || "",
      allowWithoutWorkshopActivity: true
    });
    if (result && result.ok === false) {
      showToast(result.message || "Failed to save activity. Please check your connection and try again.", true);
      return false;
    }

    showToast(
      updates.courseStatus === "Not Interested"
        ? "Lead moved to Lost Leads."
        : "Admission Calling activity saved successfully.",
      false
    );
    return true;
  } catch (err) {
    console.error("[post-workshop] Failed to persist leads:", err);
    showToast("Failed to save activity. Please check your connection and try again.", true);
    return false;
  }
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

  const deleteLeadResult = await deleteLeadsOnServer([buildLeadSelectionRef(allLeads[index])]);
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
  const deleteRefs = allLeads
    .filter((lead) => selectedLeadKeys.has(buildLeadSelectionKey(lead)))
    .map((lead) => buildLeadSelectionRef(lead));
  const removedCount = deleteRefs.length;
  if (!removedCount) {
    return false;
  }

  const deleteSelectedResult = await deleteLeadsOnServer(deleteRefs);
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

function getAdminAssignmentOptions(leads) {
  const counselorNames = getStoredCounselors()
    .map((item) => String(item.name || "").trim())
    .filter(Boolean);
  const assignedCounselors = leads
    .map((lead) => String(lead.counselor || "").trim())
    .filter((name) => name && name.toLowerCase() !== "unassigned");

  return [...new Set(["Unassigned", ...counselorNames, ...assignedCounselors])];
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

  const assignmentSummary = formatLeadAssignmentResult(assignmentResult, updatedCount, targetCounselor);
  setMessage(assignmentSummary.message, assignmentSummary.assignedCount === 0);
  showToast(assignmentSummary.message, assignmentSummary.assignedCount === 0);
  return assignmentSummary.assignedCount > 0;
}

async function savePostActivityModalNote(leadId, leadEmail = "") {
  const noteInput = document.getElementById("modalPostActivityNote");
  const text = noteInput ? noteInput.value.trim() : "";
  if (!text) {
    return true;
  }

  const allLeads = getAllLeads();
  const lead = findLeadByActionIdentity(allLeads, leadId, leadEmail);
  if (!lead) {
    showToast("Activity saved, but the note could not be linked to this lead. Please refresh and try again.", true);
    return false;
  }

  const result = await addLeadNote(leadId, text, leadEmail || lead.email || "");
  if (!result || result.ok === false) {
    showToast(result?.message || "Activity saved, but the note could not be saved.", true);
    return false;
  }

  return true;
}

function openPostActivityModal(leadId, leadEmail = "") {
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

  setPostActivityModalMode("edit");
  populatePostActivityModal(lead);
  document.getElementById("postActivityModal").classList.remove("hidden");
  void trackLeadView(lead.id, lead.email || leadEmail || "");
}

function openPostActivityDetailsModal(leadId, leadEmail = "") {
  const allLeads = getAllLeads();
  const lead = findLeadByActionIdentity(allLeads, leadId, leadEmail);
  if (!lead) {
    showToast("Could not open this lead. Please refresh and try again.", true);
    return;
  }

  modalLeadId = lead.id;
  modalLeadEmail = lead.email || leadEmail || "";
  setPostActivityModalMode("view");
  populatePostActivityModal(lead);
  document.getElementById("postActivityModal").classList.remove("hidden");
  void trackLeadView(lead.id, lead.email || leadEmail || "");
}


function closePostModal() {
  document.getElementById("postActivityModal").classList.add("hidden");
  modalLeadId = null;
  modalLeadEmail = "";
  setPostActivityModalMode("edit");
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
    void trackLeadView(lead.id, lead.email || leadEmail || "");
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
  taskMessage.style.color = isError ? "var(--danger)" : "var(--success)";
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
  taskCategoryInput.value = TASK_CATEGORY.admission;
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
  taskModalTitle.textContent = "Create Admission Task";
  taskModal.classList.remove("hidden");
  void trackLeadView(lead.id, lead.email || "");
}

async function handleTaskSubmit(event) {
  event.preventDefault();

  const leadId = taskLeadIdInput.value;
  const title = taskTitleInput.value.trim();
  const dueDate = toTaskDueDateIso(taskDueDateInput.value);

  if (!leadId || !title || !dueDate) {
    setTaskMessage("Title and due date/time are required.", true);
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
    category: TASK_CATEGORY.admission,
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

function initPostWorkshopPage() {
  const modal = document.getElementById("postActivityModal");
  if (!modal) {
    return;
  }

  document.getElementById("closePostModalBtn").onclick = closePostModal;
  document.getElementById("postActivityForm").onsubmit = async (event) => {
    event.preventDefault();
    if (!modalLeadId) {
      return;
    }

    const saved = await updatePostActivity(modalLeadId, {
      postDialed: document.getElementById("modalPostDialed").value,
      coursePitched: document.getElementById("modalCoursePitched").value,
      courseStatus: document.getElementById("modalCourseStatus").value,
      admissionStatus: document.getElementById("modalAdmissionStatus").value,
      postCallStatus: document.getElementById("modalPostCallStatus").value,
      admissionWorkshop: document.getElementById("modalAdmissionWorkshop").value,
      workshopJoiningStatus: document.getElementById("modalWorkshopJoiningStatus").value,
      postStatusUpdated: true
    }, modalLeadEmail);

    if (!saved) {
      return;
    }

    const noteSaved = await savePostActivityModalNote(modalLeadId, modalLeadEmail);
    if (!noteSaved) {
      return;
    }

    closePostModal();
    renderAll();
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

initPostWorkshopPage();

async function renderAll() {
  renderWorkshopSectionNav();
  const allLeads = getAllLeads();
  normalizeLeadFields(allLeads);

  const scopedLeads = getScopedLeads(allLeads);
  const admissionLeads = getAdmissionCallingLeads(scopedLeads);
  const filteredLeads = filterLeads(admissionLeads);

  renderKpis(filteredLeads);
  const _focusedId = document.activeElement?.id;
  const _selStart = document.activeElement?.selectionStart;
  const _selEnd = document.activeElement?.selectionEnd;
  renderFilters(admissionLeads);
  if (_focusedId) {
    const _el = document.getElementById(_focusedId);
    if (_el) {
      _el.focus();
      if (_selStart != null) _el.setSelectionRange(_selStart, _selEnd);
    }
  }
  renderLeadTable(filteredLeads);
}

void renderAll();
window.__dvMarkRouteViewReady?.();
const stopStatePolling = startStatePolling(() => {
  void renderAll();
});
registerPageCleanup(stopStatePolling);
