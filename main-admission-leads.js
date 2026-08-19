import { registerPageCleanup } from "./page-runtime.js";
import { apiUrl } from "./api-client.js";
import { openActivityHistory } from "./activity-history.js";
import { exportLeadRowsToExcel } from "./lead-export.js";
import {
  CRM_FIXED_COURSE_OPTIONS,
  getCanonicalPublicCourseIdentity,
  normalizeCrmCourseValue,
  populateCrmCourseSelect
} from "./course-catalog.js";
import {
  bootstrapLocalState,
  getCounselors as getStoredCounselors,
  getLeads as getStoredLeads,
  getTasks as getStoredTasks,
  getSession,
  loadLocalPreference,
  saveLocalPreference
} from "./state-sync.js";
import { createTask, TASK_CATEGORY, toTaskDueDateIso } from "./task-service.js";
import { triggerMcubeClickToCall } from "./mcube-call-service.js";
import {
  addLeadNote,
  assignFilteredMainAdmissionLeads,
  assignLeads as assignLeadsOnServer,
  deleteLeadNote,
  deleteLeads as deleteLeadsOnServer,
  fetchLeadNotes,
  formatLeadAssignmentResult,
  takeSopLead,
  trackLeadView,
  updateLeadActivity as updateLeadActivityOnServer,
  updateMainAdmissionLeadDetails
} from "./lead-service.js";
import { formatKolkataDate, formatKolkataDateTime, formatKolkataDisplay, getKolkataDayRange, parseKolkataDate as parseTimelineDate, toKolkataDateKey } from "./date-utils.js";
import {
  bindCounselorActivityDateFilter,
  COUNSELOR_ACTIVITY_DATE_DEFAULTS,
  leadMatchesCounselorActivityDate,
  renderCounselorActivityDateFilter
} from "./counselor-activity-filter.js";
import { createRenderScheduler, withButtonBusy } from "./ui-feedback.js";
import { getPerformanceDuration, recordClientPerformance, waitForPaint } from "./performance-client.js";

await bootstrapLocalState({ skipStateRefresh: true });

const session = getSession();
const isAdmin = session?.role === "admin" || session?.role === "super_admin";
const isManager = session?.role === "manager";
const canUseLostLeadFilter = isAdmin || session?.role === "manager";
const canFilterByCounselor = isAdmin || session?.role === "manager";
const canUseLeadRowActions = !isAdmin;
const canCreateTasks = session?.role === "counselor" || session?.role === "manager";
const FIXED_COURSE_LABELS = CRM_FIXED_COURSE_OPTIONS.map((course) => course.label).filter(Boolean);
const FIXED_COURSE_LABEL_SET = new Set(FIXED_COURSE_LABELS);
const OTHER_COURSE_FILTER_LABEL = "Others";
const LOST_LEADS_COUNSELOR_FILTER = "__lost_leads__";

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
const mainAdmissionDetailsModal = document.getElementById("mainAdmissionDetailsModal");
const mainAdmissionDetailsModalTitle = document.getElementById("mainAdmissionDetailsModalTitle");
const mainAdmissionDetailsModalSubtitle = document.getElementById("mainAdmissionDetailsModalSubtitle");
const mainAdmissionDetailsModalBody = document.getElementById("mainAdmissionDetailsModalBody");
const mainAdmissionDetailsEditMessage = document.getElementById("mainAdmissionDetailsEditMessage");
const editMainAdmissionDetailsBtn = document.getElementById("editMainAdmissionDetailsBtn");
const saveMainAdmissionDetailsBtn = document.getElementById("saveMainAdmissionDetailsBtn");
const cancelMainAdmissionDetailsEditBtn = document.getElementById("cancelMainAdmissionDetailsEditBtn");

mainAdmissionFilterBar.classList.add("filter-bar--crm");

const FILTER_STORAGE_KEY = "dvMainAdmissionLeadFilters";
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
  timeline: "overall",
  startDate: "",
  endDate: "",
  ...COUNSELOR_ACTIVITY_DATE_DEFAULTS,
  search: "",
  leadOwner: session?.role === "manager" ? "all" : isCounselorSession() ? "direct" : "all",
  counselor: [],
  courseName: [],
  leadSource: "",
  location: "",
  mainAdmissionDialed: "",
  mainAdmissionCourseStatus: "",
  mainAdmissionAdmissionStatus: "",
  mainAdmissionCallStatus: "",
  activityStatus: "",
  latestActivity: "",
  repeatEnquiryStatus: "",
  whatsappActivity: "",
  lsqLeads: "",
  sopFilter: "",
  advanced: {
    conditions: []
  }
};
const ADVANCED_FILTER_EMPTY_CONDITION = { field: "", operator: "", value: "" };
const ADVANCED_FILTER_DEFAULT = { conditions: [] };
const ADVANCED_FILTER_MODES = new Set(["and", "or"]);
const WHATSAPP_ACTIVITY_FILTER_OPTIONS = ["WhatsApp Read", "WhatsApp Clicked", "WhatsApp Replied"];
const ADVANCED_FILTER_FIELDS = [
  { value: "outboundCallCount", label: "Outbound Call Count", type: "number", defaultOperator: "lte", placeholder: "2" },
  { value: "inboundCallCount", label: "Inbound Call Count", type: "number", defaultOperator: "gte", placeholder: "1" },
  { value: "totalCallCount", label: "Total Call Attempts", type: "number", defaultOperator: "gte", placeholder: "3" },
  { value: "connectedCallCount", label: "Connected Call Count", type: "number", defaultOperator: "eq", placeholder: "0" },
  { value: "notPickedCallCount", label: "Not Picked Call Count", type: "number", defaultOperator: "gte", placeholder: "3" },
  { value: "latestOutboundAgeDays", label: "Last Outbound Call Older Than", type: "days", defaultOperator: "gte", placeholder: "2" },
  { value: "latestConnectedAgeDays", label: "Last Connected Call Older Than", type: "days", defaultOperator: "gte", placeholder: "3" },
  { value: "leadAgeDays", label: "Lead Age", type: "days", defaultOperator: "gte", placeholder: "7" },
  { value: "assignedUntouchedDays", label: "Assigned Without Activity", type: "days", defaultOperator: "gte", placeholder: "1" },
  { value: "notesCount", label: "Notes Count", type: "number", defaultOperator: "eq", placeholder: "0" },
  { value: "repeatEnquiryCount", label: "Repeat Enquiry Count", type: "number", defaultOperator: "gte", placeholder: "2" },
  { value: "totalTalkTimeMinutes", label: "Total Talk Time", type: "minutes", defaultOperator: "gte", placeholder: "5" },
  { value: "pendingTaskStatus", label: "Follow-Up Task", type: "choice", choices: [
    { value: "none", label: "No Task Created" },
    { value: "overdue", label: "Overdue" },
    { value: "dueToday", label: "Due Today" },
    { value: "dueNext2Days", label: "Due In Next 2 Days" }
  ] },
  { value: "campaignText", label: "Campaign / Ad / Form Contains", type: "text", defaultOperator: "contains", placeholder: "AIML" },
  { value: "recordingStatus", label: "Call Recording", type: "choice", choices: [
    { value: "has", label: "Has Recording" },
    { value: "none", label: "No Recording" }
  ] },
  { value: "whatsappFollowupGap", label: "WhatsApp Follow-Up Gap", type: "choice", choices: [
    { value: "sentNoReply", label: "Sent But No Reply" },
    { value: "replyNoConnectedCall", label: "Replied But No Connected Call" },
    { value: "readNoOutboundAfter", label: "Read/Clicked But No Outbound After" }
  ] },
  { value: "stageAgingDays", label: "Current Stage Age", type: "days", defaultOperator: "gte", placeholder: "5" }
];
const SOP_FILTER_BLOCKED = "blocked";
const SOP_NEW_WINDOW_MS = 48 * 60 * 60 * 1000;
const SOP_ACTIVE_WINDOW_DAYS = 15;
const SOP_OFFERED_WINDOW_DAYS = 30;
const KOLKATA_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const SOP_SYSTEM_ACTIVITY_ACTORS = new Set(["reachout webhook", "system"]);
const SOP_EXCLUDED_ACTIVITY_TYPES = new Set([
  "Lead Created",
  "Lead Assigned",
  "Lead Reassigned",
  "Counselor Changed",
  "Lead Viewed"
]);
const SOP_ACTIVITY_OPTIONS_BY_HISTORY_FIELD = {
  mainAdmissionActivityHistory: {
    activityFields: ["mainAdmissionDialed", "mainAdmissionCoursePitched", "mainAdmissionCourseStatus", "mainAdmissionAdmissionStatus", "mainAdmissionCallStatus"]
  }
};

const persistedFilter = await loadLocalPreference(FILTER_STORAGE_KEY, {});
if (persistedFilter.timeline === "daily") {
  persistedFilter.timeline = "today";
}
if (persistedFilter.timeline === "week") {
  persistedFilter.timeline = "overall";
}
if (persistedFilter.latestActivity === "Inbound Received") {
  persistedFilter.latestActivity = "Inbound Not Picked";
}
let filter = { ...DEFAULT_FILTER, ...persistedFilter };
filter.advanced = normalizeAdvancedFilter(filter.advanced);
filter.leadOwner = ["all", "direct", "reassigned"].includes(String(filter.leadOwner || "").trim())
  ? String(filter.leadOwner || "").trim()
  : DEFAULT_FILTER.leadOwner;
filter.sopFilter = isAdmin && filter.sopFilter === SOP_FILTER_BLOCKED ? SOP_FILTER_BLOCKED : "";
filter.counselor = normalizeMultiValueFilter(filter.counselor);
if (!canUseLostLeadFilter && filter.counselor.includes(LOST_LEADS_COUNSELOR_FILTER)) {
  filter.counselor = filter.counselor.filter(item => item !== LOST_LEADS_COUNSELOR_FILTER);
}
filter.courseName = normalizeMultiValueFilter(filter.courseName);
filter.location = normalizeLocationLabel(filter.location);
if (isCounselorSession() && (!persistedFilter.timeline || persistedFilter.timeline === "week")) {
  filter.timeline = "overall";
}
let currentPage = 1;
const pageSize = 50;
const exportPageSize = 500;
let selectedLeadKeys = new Set();
let filteredSelectionLimit = 0;
let bulkAssignCounselor = "";
let activeLeadRef = null;
let notesLeadRef = null;
let detailsLeadRef = null;
let detailsEditMode = false;
let mainAdmissionActivityModalMode = "edit";
let activeSegment = DEFAULT_SEGMENT;
let locationSortDirection = "";
let isCourseFilterOpen = false;
let isCounselorFilterOpen = false;
let isAdvancedFilterOpen = false;
let advancedFilterDraft = null;
let scopedMainAdmissionLeads = null;
let scopedCounselors = null;
let scopedPagination = null;
let scopedCounts = null;
let scopedFacets = null;
let scopedAdmissionSopEnabled = true;
let scopedLoadActive = false;
let mainAdmissionAssignmentBusy = false;
let initialMainAdmissionLoadPending = true;
let draftMainAdmissionSearch = filter.search;
let initialMainAdmissionLoadFailed = false;
let scopedReloadTimer = null;
let scopedDataSignature = "";
let scopedReloadInFlight = null;
populateCrmCourseSelect("modalMainAdmissionCoursePitched", { includeNo: true });

function getScopedCounselors() {
  return Array.isArray(scopedCounselors) ? scopedCounselors : getStoredCounselors();
}

function mergeScopedLeadUpdates(leads) {
  if (!Array.isArray(scopedMainAdmissionLeads)) {
    return;
  }

  const updates = (Array.isArray(leads) ? leads : [leads]).filter(Boolean);
  if (!updates.length) {
    return;
  }

  const byId = new Map(updates.map((lead) => [String(lead.id), lead]));
  const seen = new Set();
  scopedMainAdmissionLeads = scopedMainAdmissionLeads.map((lead) => {
    const patch = byId.get(String(lead?.id));
    if (!patch) {
      return lead;
    }
    seen.add(String(lead.id));
    return { ...lead, ...patch };
  });

  updates.forEach((lead) => {
    const key = String(lead.id);
    if (!seen.has(key)) {
      scopedMainAdmissionLeads.push(lead);
    }
  });

  normalizeLeadFields(scopedMainAdmissionLeads);
}

function recordMainAdmissionPerformance({ phase, subsection = "", durationMs = null, success = true, message = "", count = null } = {}) {
  void recordClientPerformance({
    kind: phase === "interactive-ready" ? "page" : "section",
    operation: `main-admission:${phase || "event"}`,
    page: "main-admission-leads.html",
    section: "Main Admission",
    subsection,
    phase,
    durationMs,
    success,
    message,
    count: count ?? (Array.isArray(scopedMainAdmissionLeads) ? scopedMainAdmissionLeads.length : getAllLeads().length)
  });
}

async function loadScopedMainAdmissionLeads() {
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  try {
    const filterPayload = getScopedMainAdmissionFilterPayload({
      page: currentPage,
      limit: pageSize
    });
    const params = new URLSearchParams(filterPayload);
    if (!scopedFacets) {
      params.set("includeFacets", "1");
    }
    const response = await fetch(apiUrl(`/api/leads/scoped?${params.toString()}`), {
      credentials: "same-origin",
      headers: { Accept: "application/json" }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.message || "Scoped loading failed.");
    }

    scopedMainAdmissionLeads = Array.isArray(payload?.leads) ? payload.leads : [];
    scopedCounselors = Array.isArray(payload?.counselors) ? payload.counselors : [];
    scopedPagination = payload?.pagination || null;
    if (Number.isFinite(Number(scopedPagination?.page))) {
      currentPage = Number(scopedPagination.page) || 1;
    }
    scopedCounts = payload?.counts || null;
    scopedFacets = payload?.facets || scopedFacets || null;
    scopedAdmissionSopEnabled = payload?.admissionSopEnabled !== false;
    scopedLoadActive = true;
    scopedDataSignature = buildScopedDataSignature();
    normalizeLeadFields(scopedMainAdmissionLeads);
    recordMainAdmissionPerformance({
      phase: "data-fetch",
      subsection: "scoped-leads",
      durationMs: Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt),
      count: scopedMainAdmissionLeads.length,
      message: "scoped"
    });
    return true;
  } catch (error) {
    console.warn("[main-admission] Scoped loading failed, falling back to full state:", error?.message || error);
    scopedLoadActive = false;
    scopedMainAdmissionLeads = null;
    scopedCounselors = null;
    scopedPagination = null;
    scopedCounts = null;
    scopedFacets = null;
    scopedAdmissionSopEnabled = true;
    scopedDataSignature = "";
    recordMainAdmissionPerformance({
      phase: "data-fetch",
      subsection: "scoped-leads",
      durationMs: Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt),
      success: false,
      message: error?.message || "scoped-loading-failed",
      count: getAllLeads().length
    });
    return false;
  }
}

async function fetchScopedMainAdmissionExportRows() {
  const leads = [];
  let page = 1;
  let totalPages = 1;

  do {
    const filterPayload = getScopedMainAdmissionFilterPayload({
      page,
      limit: exportPageSize
    });
    const params = new URLSearchParams(filterPayload);
    params.set("exportAll", "1");

    const response = await fetch(apiUrl(`/api/leads/scoped?${params.toString()}`), {
      credentials: "same-origin",
      headers: { Accept: "application/json" }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.message || "Could not load all filtered leads for export.");
    }

    leads.push(...(Array.isArray(payload?.leads) ? payload.leads : []));
    totalPages = Math.max(1, Number(payload?.pagination?.totalPages) || 1);
    page += 1;
  } while (page <= totalPages);

  normalizeLeadFields(leads);
  return applyLeadSorting(leads);
}

function startMainAdmissionPolling(onRefresh, intervalMs = 15000) {
  let destroyed = false;
  let activePoll = false;

  async function poll() {
    if (destroyed || activePoll || document.visibilityState === "hidden") {
      return;
    }
    activePoll = true;
    try {
      await loadScopedMainAdmissionLeads();
      await onRefresh();
    } catch (error) {
      console.warn("[main-admission] polling failed:", error?.message || error);
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

function persistFilters() {
  clearBulkLeadSelection();
  void saveLocalPreference(FILTER_STORAGE_KEY, filter);
  if (scopedLoadActive || Array.isArray(scopedMainAdmissionLeads)) {
    window.clearTimeout(scopedReloadTimer);
    scopedReloadTimer = window.setTimeout(() => {
      void loadScopedMainAdmissionLeads().then(() => renderAll());
    }, 150);
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDetailValue(value, fallback = "-") {
  const normalized = String(value ?? "").trim();
  return normalized ? escapeHtml(normalized) : fallback;
}

function formatFieldLabel(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeMultiValueFilter(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))];
  }
  const normalized = String(value || "").trim();
  return normalized ? [normalized] : [];
}

function getAdvancedFilterDefinition(field) {
  return ADVANCED_FILTER_FIELDS.find((item) => item.value === field) || null;
}

function normalizeAdvancedFilterCondition(value = {}) {
  const field = String(value?.field || "").trim();
  const definition = getAdvancedFilterDefinition(field);
  const connector = ADVANCED_FILTER_MODES.has(String(value?.connector || "").trim().toLowerCase())
    ? String(value.connector).trim().toLowerCase()
    : "and";
  if (!definition) {
    return { ...ADVANCED_FILTER_EMPTY_CONDITION, connector };
  }
  const operator = String(value?.operator || definition.defaultOperator || "").trim();
  const rawValue = String(value?.value ?? "").trim();
  if (definition.type === "choice") {
    const allowed = new Set((definition.choices || []).map((choice) => choice.value));
    return {
      connector,
      field,
      operator: "is",
      value: allowed.has(rawValue) ? rawValue : ""
    };
  }
  return {
    connector,
    field,
    operator,
    value: rawValue
  };
}

function normalizeAdvancedFilter(value = {}) {
  if (Array.isArray(value)) {
    return {
      ...ADVANCED_FILTER_DEFAULT,
      conditions: value.map((item, index) => {
        const normalized = normalizeAdvancedFilterCondition(item);
        return {
          ...normalized,
          connector: index === 0 ? "and" : normalized.connector
        };
      }).filter((item) => item.field && item.value)
    };
  }

  const rawConditions = Array.isArray(value?.conditions)
    ? value.conditions
    : value?.field
      ? [value]
      : [];
  const legacyMode = ADVANCED_FILTER_MODES.has(String(value?.mode || "").trim().toLowerCase())
    ? String(value.mode).trim().toLowerCase()
    : "and";
  return {
    conditions: rawConditions.map((item, index) => {
      const normalized = normalizeAdvancedFilterCondition(item);
      return {
        ...normalized,
        connector: index === 0 ? "and" : normalizeAdvancedFilterCondition({ connector: item?.connector || legacyMode }).connector
      };
    }).filter((item) => item.field && item.value)
  };
}

function getAdvancedFilterDraftSet() {
  if (advancedFilterDraft) {
    const draftConditions = Array.isArray(advancedFilterDraft.conditions)
      ? advancedFilterDraft.conditions.map(normalizeAdvancedFilterCondition)
      : [];
    return {
      conditions: draftConditions.length ? draftConditions : [{ ...ADVANCED_FILTER_EMPTY_CONDITION }]
    };
  }
  const normalized = normalizeAdvancedFilter(filter.advanced);
  return {
    conditions: normalized.conditions.length
      ? normalized.conditions
      : [{ ...ADVANCED_FILTER_EMPTY_CONDITION }]
  };
}

function hasActiveAdvancedFilter() {
  const advanced = normalizeAdvancedFilter(filter.advanced);
  return advanced.conditions.length > 0;
}

function shouldUseScopedServerPage() {
  return Boolean(scopedLoadActive && scopedPagination && isScopedServerPageFresh() && !hasActiveAdvancedFilter());
}

function getAdvancedFilterSummary() {
  const advanced = normalizeAdvancedFilter(filter.advanced);
  if (!advanced.conditions.length) {
    return "Use Filter";
  }
  if (advanced.conditions.length > 1) {
    return `${advanced.conditions.length} advanced filters`;
  }
  const condition = advanced.conditions[0];
  const definition = getAdvancedFilterDefinition(condition.field);
  if (!definition) {
    return "Use Filter";
  }
  if (definition.type === "choice") {
    const choiceLabel = definition.choices?.find((choice) => choice.value === condition.value)?.label || condition.value;
    return `${definition.label}: ${choiceLabel}`;
  }
  const operatorLabels = {
    lt: "<",
    lte: "<=",
    eq: "=",
    gte: ">=",
    gt: ">",
    contains: "contains"
  };
  const suffix = definition.type === "days"
    ? " days"
    : definition.type === "minutes"
      ? " min"
      : "";
  return `${definition.label} ${operatorLabels[condition.operator] || condition.operator} ${condition.value}${suffix}`;
}

function renderAdvancedFilterControl() {
  const active = hasActiveAdvancedFilter();
  return `
    <div class="filter-item filter-item--advanced">
      <label for="mainAdmissionAdvancedFilterBtn">Advanced Filter</label>
      <button
        type="button"
        id="mainAdmissionAdvancedFilterBtn"
        class="${active ? "btn-primary" : "btn-ghost"} advanced-filter-trigger"
        title="${escapeHtml(getAdvancedFilterSummary())}"
      >
        <span>${active ? "Active" : "Use Filter"}</span>
      </button>
    </div>
  `;
}

function getAdvancedOperatorOptions(definition, selectedOperator) {
  if (!definition || definition.type === "choice") {
    return "";
  }
  if (definition.type === "text") {
    return `<option value="contains" ${selectedOperator === "contains" ? "selected" : ""}>Contains</option>`;
  }
  return [
    ["lt", "Less than"],
    ["lte", "No more than"],
    ["eq", "Equal to"],
    ["gte", "At least"],
    ["gt", "More than"]
  ].map(([value, label]) => `<option value="${value}" ${selectedOperator === value ? "selected" : ""}>${label}</option>`).join("");
}

function renderAdvancedFilterValueControl(definition, draft, index) {
  if (!definition) {
    return `<input data-advanced-value="${index}" type="text" value="" disabled />`;
  }
  if (definition.type === "choice") {
    return `
      <select data-advanced-value="${index}">
        <option value="">Choose Value</option>
        ${(definition.choices || []).map((choice) => `
          <option value="${escapeHtml(choice.value)}" ${draft.value === choice.value ? "selected" : ""}>${escapeHtml(choice.label)}</option>
        `).join("")}
      </select>
    `;
  }
  const inputType = definition.type === "text" ? "text" : "number";
  const step = definition.type === "minutes" ? "0.5" : "1";
  return `
    <input
      data-advanced-value="${index}"
      type="${inputType}"
      ${inputType === "number" ? `min="0" step="${step}"` : ""}
      placeholder="${escapeHtml(definition.placeholder || "")}"
      value="${escapeHtml(draft.value)}"
    />
  `;
}

function renderAdvancedFilterConditionRow(condition, index, total) {
  const draft = normalizeAdvancedFilterCondition(condition);
  const definition = getAdvancedFilterDefinition(draft.field);
  const valueLabel = definition?.type === "days"
    ? "Days"
    : definition?.type === "minutes"
      ? "Minutes"
      : "Value";
  return `
    <div class="advanced-filter-condition" data-advanced-condition="${index}">
      ${index > 0 ? `
      <div class="modal-row advanced-filter-connector">
        <label for="mainAdmissionAdvancedConnector${index}">Join</label>
        <select id="mainAdmissionAdvancedConnector${index}" data-advanced-connector="${index}">
          <option value="and" ${draft.connector === "and" ? "selected" : ""}>AND</option>
          <option value="or" ${draft.connector === "or" ? "selected" : ""}>OR</option>
        </select>
      </div>
      ` : `<div class="advanced-filter-connector advanced-filter-connector--empty" aria-hidden="true"></div>`}
      <div class="modal-row">
        <label for="mainAdmissionAdvancedField${index}">Filter Type</label>
        <select id="mainAdmissionAdvancedField${index}" data-advanced-field="${index}">
          <option value="">Choose Advanced Filter</option>
          ${ADVANCED_FILTER_FIELDS.map((item) => `
            <option value="${escapeHtml(item.value)}" ${draft.field === item.value ? "selected" : ""}>${escapeHtml(item.label)}</option>
          `).join("")}
        </select>
      </div>
      <div class="modal-row">
        <label for="mainAdmissionAdvancedOperator${index}">Condition</label>
        <select id="mainAdmissionAdvancedOperator${index}" data-advanced-operator="${index}" ${definition?.type === "choice" ? "disabled" : ""}>
          ${definition ? getAdvancedOperatorOptions(definition, draft.operator || definition.defaultOperator) : `<option value="">Choose Filter Type</option>`}
        </select>
      </div>
      <div class="modal-row">
        <label>${escapeHtml(valueLabel)}</label>
        ${renderAdvancedFilterValueControl(definition, draft, index)}
      </div>
      <div class="advanced-filter-condition__action">
        <label>&nbsp;</label>
        <button type="button" class="btn-ghost advanced-filter-remove-btn" data-advanced-remove="${index}" ${total <= 1 ? "disabled" : ""}>Remove</button>
      </div>
    </div>
  `;
}

function renderAdvancedFilterPanel() {
  const draft = getAdvancedFilterDraftSet();
  return `
    <div id="mainAdmissionAdvancedFilterModal" class="modal advanced-filter-modal" role="dialog" aria-modal="true" aria-labelledby="mainAdmissionAdvancedFilterTitle">
      <div class="modal-content advanced-filter-panel">
        <div class="advanced-filter-panel__header">
          <div>
            <h3 id="mainAdmissionAdvancedFilterTitle">Advanced Filter</h3>
            <p class="block-help">Use multiple advanced conditions with the normal filters already selected on the page.</p>
          </div>
          <button type="button" id="mainAdmissionAdvancedCloseBtn" class="btn-ghost">Close</button>
        </div>
        <div class="advanced-filter-toolbar">
          <button type="button" id="mainAdmissionAdvancedAddBtn" class="btn-ghost advanced-filter-add-btn">+ Add Filter</button>
        </div>
        <div class="advanced-filter-condition-list">
          ${draft.conditions.map((condition, index) => renderAdvancedFilterConditionRow(condition, index, draft.conditions.length)).join("")}
        </div>
        <div class="advanced-filter-examples">
          <strong>Useful examples</strong>
          <span>Outbound Call Count no more than 2 AND Follow-Up Task overdue</span>
          <span>Assigned Without Activity at least 1 day OR No Task Created</span>
        </div>
        <div class="modal-actions">
          <button type="button" id="mainAdmissionAdvancedClearBtn" class="btn-ghost">Clear</button>
          <button type="button" id="mainAdmissionAdvancedApplyBtn" class="btn-primary">Apply Filter</button>
        </div>
      </div>
    </div>
  `;
}

function openAdvancedFilterPanel() {
  advancedFilterDraft = normalizeAdvancedFilter(filter.advanced);
  if (!advancedFilterDraft.conditions.length) {
    advancedFilterDraft.conditions = [{ ...ADVANCED_FILTER_EMPTY_CONDITION }];
  }
  isAdvancedFilterOpen = true;
  void renderAll();
}

function closeAdvancedFilterPanel() {
  isAdvancedFilterOpen = false;
  advancedFilterDraft = null;
  void renderAll();
}

function applyAdvancedFilterFromPanel() {
  const nextDraft = readAdvancedFilterDraftFromPanel();
  const activeConditions = nextDraft.conditions.filter((condition) => condition.field && condition.value);
  if (!activeConditions.length) {
    showToast("Add at least one complete advanced filter.", true);
    return;
  }
  filter.advanced = normalizeAdvancedFilter({
    conditions: activeConditions
  });
  advancedFilterDraft = null;
  isAdvancedFilterOpen = false;
  persistFilters();
  currentPage = 1;
  void renderAll();
}

function clearAdvancedFilter() {
  filter.advanced = { ...ADVANCED_FILTER_DEFAULT };
  advancedFilterDraft = {
    ...ADVANCED_FILTER_DEFAULT,
    conditions: [{ ...ADVANCED_FILTER_EMPTY_CONDITION }]
  };
  isAdvancedFilterOpen = false;
  persistFilters();
  currentPage = 1;
  void renderAll();
}

function readAdvancedFilterDraftFromPanel() {
  const rows = [...document.querySelectorAll("[data-advanced-condition]")];
  const conditions = rows.map((row) => {
    const index = row.getAttribute("data-advanced-condition");
    const connector = index === "0"
      ? "and"
      : String(row.querySelector(`[data-advanced-connector="${index}"]`)?.value || "and").trim().toLowerCase();
    const field = String(row.querySelector(`[data-advanced-field="${index}"]`)?.value || "").trim();
    const definition = getAdvancedFilterDefinition(field);
    const operator = definition?.type === "choice"
      ? "is"
      : String(row.querySelector(`[data-advanced-operator="${index}"]`)?.value || definition?.defaultOperator || "").trim();
    const value = String(row.querySelector(`[data-advanced-value="${index}"]`)?.value || "").trim();
    return normalizeAdvancedFilterCondition({ connector, field, operator, value });
  });
  return {
    conditions: conditions.length ? conditions : [{ ...ADVANCED_FILTER_EMPTY_CONDITION }]
  };
}

function rerenderAdvancedFilterPanel(nextDraft) {
  advancedFilterDraft = {
    conditions: nextDraft.conditions.length ? nextDraft.conditions : [{ ...ADVANCED_FILTER_EMPTY_CONDITION }]
  };
  void renderAll();
}

function bindAdvancedFilterPanel() {
  document.getElementById("mainAdmissionAdvancedFilterBtn")?.addEventListener("click", openAdvancedFilterPanel);
  if (!isAdvancedFilterOpen) {
    return;
  }
  document.getElementById("mainAdmissionAdvancedFilterModal")?.addEventListener("click", (event) => {
    if (event.target?.id === "mainAdmissionAdvancedFilterModal") {
      closeAdvancedFilterPanel();
    }
  });
  document.getElementById("mainAdmissionAdvancedCloseBtn")?.addEventListener("click", closeAdvancedFilterPanel);
  document.getElementById("mainAdmissionAdvancedApplyBtn")?.addEventListener("click", applyAdvancedFilterFromPanel);
  document.getElementById("mainAdmissionAdvancedClearBtn")?.addEventListener("click", clearAdvancedFilter);
  document.getElementById("mainAdmissionAdvancedAddBtn")?.addEventListener("click", () => {
    const draft = readAdvancedFilterDraftFromPanel();
    draft.conditions.push({ ...ADVANCED_FILTER_EMPTY_CONDITION, connector: "and" });
    rerenderAdvancedFilterPanel(draft);
  });
  document.querySelectorAll("[data-advanced-field]").forEach((input) => {
    input.addEventListener("change", (event) => {
      const draft = readAdvancedFilterDraftFromPanel();
      const index = Number(event.target.getAttribute("data-advanced-field"));
      const definition = getAdvancedFilterDefinition(event.target.value);
      const existingConnector = draft.conditions[index]?.connector || "and";
      draft.conditions[index] = definition
        ? { connector: existingConnector, field: definition.value, operator: definition.type === "choice" ? "is" : definition.defaultOperator, value: "" }
        : { ...ADVANCED_FILTER_EMPTY_CONDITION, connector: existingConnector };
      rerenderAdvancedFilterPanel(draft);
    });
  });
  document.querySelectorAll("[data-advanced-connector]").forEach((input) => {
    input.addEventListener("change", () => {
      advancedFilterDraft = readAdvancedFilterDraftFromPanel();
    });
  });
  document.querySelectorAll("[data-advanced-remove]").forEach((button) => {
    button.addEventListener("click", (event) => {
      const draft = readAdvancedFilterDraftFromPanel();
      const index = Number(event.currentTarget.getAttribute("data-advanced-remove"));
      draft.conditions.splice(index, 1);
      rerenderAdvancedFilterPanel(draft);
    });
  });
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

function leadMatchesWhatsappActivity(lead, selectedActivity) {
  if (!selectedActivity) {
    return true;
  }

  const history = Array.isArray(lead?.mainAdmissionActivityHistory) ? lead.mainAdmissionActivityHistory : [];
  const latestEntry = getLatestHistoryEntry(history);
  return getActivityLabel(latestEntry) === selectedActivity;
}

function leadMatchesWhatsappActivityFilter(lead) {
  return leadMatchesWhatsappActivity(lead, filter.whatsappActivity);
}

function isLsqImportedLead(lead = {}) {
  return Boolean(lead?.lsqImported)
    || String(lead?.source || "").trim().toLowerCase().includes("leadsquared")
    || (lead?.lsqSourceSnapshot && typeof lead.lsqSourceSnapshot === "object");
}

function isMainAdmissionLeadInterested(lead = {}) {
  return String(lead?.mainAdmissionCourseStatus || "").trim().toLowerCase() === "interested";
}

function isMainAdmissionLeadNotInterested(lead = {}) {
  const pipeline = String(lead?.leadPipeline || "").trim().toLowerCase();
  if (pipeline === "main-admission") {
    return Boolean(lead?.mainAdmissionActivityUpdated)
      && String(lead?.mainAdmissionCourseStatus || "").trim().toLowerCase() === "not interested";
  }
  if (pipeline === "course-registration") {
    return Boolean(lead?.registeredActivityUpdated)
      && String(lead?.registeredCourseStatus || "").trim().toLowerCase() === "not interested";
  }
  return String(lead?.wsStatus || "").trim().toLowerCase() === "not interested"
    || (Boolean(lead?.postStatusUpdated) && String(lead?.courseStatus || "").trim().toLowerCase() === "not interested");
}

function isProtectedMainAdmissionStatus(lead = {}) {
  const status = String(lead?.mainAdmissionAdmissionStatus || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  return status === "inconversation" || status === "enrolled" || status === "won";
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

function getMcubeCallActivityEntries(lead = {}) {
  const history = Array.isArray(lead?.mcubeCallHistory) ? lead.mcubeCallHistory : [];
  return history.map((entry) => ({
    activityType: "Call Made",
    actionDescription: `MCUBE ${entry?.direction || "call"} event recorded${entry?.normalizedStatus ? ` with status ${entry.normalizedStatus}` : ""}.`,
    at: entry?.at || entry?.timestamp || "",
    timestamp: entry?.at || entry?.timestamp || "",
    direction: entry?.direction || "",
    callDisposition: entry?.disposition || entry?.rawStatus || entry?.eventType || "",
    normalizedStatus: entry?.normalizedStatus || "",
    newValue: [
      `MCUBE status: ${entry?.disposition || entry?.normalizedStatus || entry?.eventType || "-"}`,
      `Direction: ${entry?.direction || "-"}`,
      entry?.callId ? `Call ID: ${entry.callId}` : ""
    ].filter(Boolean).join(", "),
    callMetadata: {
      provider: "MCUBE",
      callId: entry?.callId || "",
      callDirection: entry?.direction || "",
      callStatus: entry?.disposition || entry?.rawStatus || entry?.eventType || "",
      normalizedCallStatus: entry?.normalizedStatus || "",
      agentName: entry?.agentName || "",
      agentPhone: entry?.agentPhone || "",
      recordingUrl: entry?.recordingUrl || ""
    }
  }));
}

function getLatestMainAdmissionActivityEntry(lead = {}) {
  const combinedHistory = [
    ...(Array.isArray(lead?.mainAdmissionActivityHistory) ? lead.mainAdmissionActivityHistory : []),
    ...getMcubeCallActivityEntries(lead)
  ];
  return getLatestHistoryEntry(combinedHistory);
}

function isInboundCallActivity(entry = {}) {
  const callDirection = String(
    entry?.callMetadata?.callDirection
    || entry?.callMetadata?.direction
    || entry?.direction
    || ""
  ).trim().toLowerCase();
  return callDirection === "inbound"
    || String(entry?.actionDescription || "").trim().toLowerCase().includes("mcube inbound");
}

function isNotPickedCallActivity(entry = {}) {
  const status = String(
    entry?.callMetadata?.normalizedCallStatus
    || entry?.callMetadata?.callStatus
    || entry?.normalizedStatus
    || entry?.callDisposition
    || entry?.newValue
    || entry?.actionDescription
    || ""
  ).trim();
  return /(cancel|missed|no\s*answer|unanswered|busy|failed|reject|declin|timeout|not\s*reachable|switched\s*off|\bdnp\b|\bcnc\b)/i.test(status);
}

function isLatestInboundNotPickedActivity(history) {
  const latestEntry = getLatestHistoryEntry(history);
  if (!latestEntry || getActivityLabel(latestEntry) !== "Call Made") {
    return false;
  }

  return isInboundCallActivity(latestEntry) && isNotPickedCallActivity(latestEntry);
}

function isLatestInboundNotPickedLead(lead = {}) {
  const latestEntry = getLatestMainAdmissionActivityEntry(lead);
  if (!latestEntry || getActivityLabel(latestEntry) !== "Call Made") {
    return false;
  }

  return isInboundCallActivity(latestEntry) && isNotPickedCallActivity(latestEntry);
}

function getLatestLeadActivityTimestamp(lead) {
  return getEntryTimestamp(getLatestHistoryEntry(lead?.mainAdmissionActivityHistory));
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

function getLeadOwnerType(lead) {
  return String(lead?.leadOwnerType || "").trim().toLowerCase() === "reassigned"
    || (String(lead?.assignedFromCounselor || "").trim() && String(lead?.assignedFromCounselor || "").trim().toLowerCase() !== "unassigned")
    ? "reassigned"
    : "direct";
}

function getLeadOwnerTimelineValue(lead) {
  return String(
    lead?.leadOwnerTimelineAt
    || lead?.counselorAssignedAt
    || lead?.createdAtExact
    || lead?.createdAt
    || ""
  ).trim();
}

function getLeadImportTimestamp(lead) {
  const candidates = [
    lead?.createdAtExact,
    lead?.createdAt,
    lead?.importedAt
  ];
  for (const value of candidates) {
    const raw = String(value || "").trim();
    if (!raw) continue;
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw)
      ? new Date(`${raw}T00:00:00+05:30`).getTime()
      : new Date(raw).getTime();
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function sortLeadsNewestFirst(leads) {
  return [...(Array.isArray(leads) ? leads : [])].sort((a, b) => (
    getLeadImportTimestamp(b) - getLeadImportTimestamp(a)
    || String(b?.id || "").localeCompare(String(a?.id || ""))
  ));
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

function getCanonicalCourseIdentity(lead = {}) {
  return getCanonicalPublicCourseIdentity([
    lead?.courseName,
    lead?.courseId,
    lead?.courseCode,
    lead?.courseRawName,
    lead?.metaAdName,
    lead?.metaAdsetName,
    lead?.metaCampaignName,
    lead?.elementorFormName,
    lead?.elementorPageUrl
  ]);
}

function isFixedCrmCourseIdentity(identity = {}) {
  return Boolean(identity.id && identity.label && FIXED_COURSE_LABEL_SET.has(identity.label));
}

function getFixedCrmCourseLabel(lead = {}) {
  const identity = getCanonicalCourseIdentity(lead);
  return isFixedCrmCourseIdentity(identity) ? identity.label : "";
}

function hasOtherCourseForMainAdmission(lead = {}) {
  return !getFixedCrmCourseLabel(lead);
}

function getFixedCourseFilterOptions(leads = []) {
  const available = new Set(
    (Array.isArray(leads) ? leads : [])
      .map((lead) => getFixedCrmCourseLabel(lead))
      .filter(Boolean)
  );
  const options = FIXED_COURSE_LABELS.filter((label) => available.has(label));
  const hasOtherCourse = (Array.isArray(leads) ? leads : []).some((lead) => hasOtherCourseForMainAdmission(lead));
  return hasOtherCourse ? [...options, OTHER_COURSE_FILTER_LABEL] : options;
}

function sanitizeFixedCourseFilter(leads = []) {
  const facetCourses = Array.isArray(scopedFacets?.courses) ? scopedFacets.courses : null;
  const available = new Set(facetCourses || getFixedCourseFilterOptions(leads));
  const currentValues = normalizeMultiValueFilter(filter.courseName);
  const nextValues = currentValues.filter((value) => available.has(value));
  if (nextValues.length !== currentValues.length) {
    filter.courseName = nextValues;
    persistFilters();
  }
}

function isCounselorSession() {
  return session?.role === "counselor" || session?.role === "manager";
}

function isManagerSession() {
  return session?.role === "manager";
}

function getCounselorIdentity() {
  if (!isCounselorSession()) {
    return "";
  }

  const sessionEmail = String(session?.email || "").trim().toLowerCase();
  const counselors = getScopedCounselors();
  const match = counselors.find((item) => String(item.email || "").trim().toLowerCase() === sessionEmail);
  return String(match?.name || session?.name || "").trim().toLowerCase();
}

function isRegisteredCandidateLead(lead) {
  const pipeline = String(lead?.leadPipeline || "").trim().toLowerCase();
  return pipeline === "main-admission"
    || pipeline === "admission"
    || pipeline === "main-admission-calling"
    || (
      isLsqImportedLead(lead)
      && !lead?.lsqArchivedLead
      && String(lead?.counselor || "").trim().toLowerCase() !== "archived leads"
    );
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
    getScopedCounselors()
      .filter((item) => !item?.disabled)
      .map((item) => String(item.name || "").trim())
      .filter(Boolean)
  )];
}

function normalizeLeadFields(leads) {
  leads.forEach((lead) => {
    lead.counselor = lead.counselor || "Unassigned";
    const canonicalCourse = getCanonicalCourseIdentity(lead);
    lead.courseRawName = String(lead.courseRawName || lead.courseName || "").trim();
    if (isFixedCrmCourseIdentity(canonicalCourse)) {
      lead.courseName = canonicalCourse.label;
      lead.courseKey = canonicalCourse.key || String(lead.courseKey || "").trim();
    } else {
      lead.courseName = String(lead.courseName || "").trim();
      lead.courseKey = String(lead.courseKey || "").trim();
    }
    lead.createdAt = lead.createdAt || toKolkataDateKey();
    lead.mainAdmissionDialed = lead.mainAdmissionDialed || "";
    lead.mainAdmissionCoursePitched = normalizeCrmCourseValue(lead.mainAdmissionCoursePitched, { allowNo: true, preserveUnknown: true });
    lead.mainAdmissionCourseStatus = lead.mainAdmissionCourseStatus || "";
    lead.mainAdmissionAdmissionStatus = lead.mainAdmissionAdmissionStatus || "";
    lead.mainAdmissionCallStatus = lead.mainAdmissionCallStatus || "";
    lead.mainAdmissionActivityUpdated = typeof lead.mainAdmissionActivityUpdated === "boolean" ? lead.mainAdmissionActivityUpdated : false;
    lead.mainAdmissionActivityHistory = Array.isArray(lead.mainAdmissionActivityHistory) ? lead.mainAdmissionActivityHistory : [];
    lead.mcubeCallHistory = Array.isArray(lead.mcubeCallHistory) ? lead.mcubeCallHistory : [];
    lead.mainAdmissionActivityTouchedByAssignee = typeof lead.mainAdmissionActivityTouchedByAssignee === "boolean"
      ? lead.mainAdmissionActivityTouchedByAssignee
      : lead.mainAdmissionActivityUpdated || hasAssigneeActivityHistory(lead.mainAdmissionActivityHistory);
    lead.mainAdmissionActivityUpdates = lead.mainAdmissionActivityTouchedByAssignee
      ? Math.max(
          1,
          Number.isFinite(Number(lead.mainAdmissionActivityUpdates)) ? Number(lead.mainAdmissionActivityUpdates) : 0
        )
      : 0;
    lead.leadNotes = Array.isArray(lead.leadNotes) ? lead.leadNotes : [];
    lead.metaExtraFields = lead.metaExtraFields && typeof lead.metaExtraFields === "object" ? lead.metaExtraFields : {};
    lead.elementorExtraFields = lead.elementorExtraFields && typeof lead.elementorExtraFields === "object" ? lead.elementorExtraFields : {};
  });
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

function getLeadActivityUpdateCount(lead) {
  if (!isLsqImportedLead(lead)) {
    const counselor = String(lead?.counselor || "").trim().toLowerCase();
    if (!counselor || counselor === "unassigned") {
      return 0;
    }
  }

  if (typeof lead?.mainAdmissionActivityTouchedByAssignee === "boolean") {
    return lead.mainAdmissionActivityTouchedByAssignee ? 1 : 0;
  }

  if (typeof lead?.mainAdmissionActivityUpdated === "boolean") {
    return lead.mainAdmissionActivityUpdated ? 1 : 0;
  }

  return hasAssigneeActivityHistory(lead?.mainAdmissionActivityHistory) ? 1 : 0;
}

function getKolkataShiftedDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getTime() + KOLKATA_OFFSET_MS);
}

function getKolkataWeekday(value) {
  const shifted = getKolkataShiftedDate(value);
  return shifted ? shifted.getUTCDay() : null;
}

function getNextKolkataMidnightTs(value) {
  const shifted = getKolkataShiftedDate(value);
  if (!shifted) return null;
  const nextMidnightUtc = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate() + 1,
    0,
    0,
    0,
    0
  );
  return nextMidnightUtc - KOLKATA_OFFSET_MS;
}

function addNonSundayWorkingMs(startValue, durationMs) {
  const startTs = new Date(startValue).getTime();
  let remaining = Math.max(0, Number(durationMs) || 0);
  if (!Number.isFinite(startTs) || remaining <= 0) {
    return Number.isFinite(startTs) ? startTs : null;
  }

  let cursor = startTs;
  while (remaining > 0) {
    const nextBoundary = getNextKolkataMidnightTs(cursor);
    if (!Number.isFinite(nextBoundary) || nextBoundary <= cursor) {
      return cursor + remaining;
    }
    const segmentEnd = Math.min(cursor + remaining, nextBoundary);
    const segmentDuration = segmentEnd - cursor;
    if (getKolkataWeekday(cursor) !== 0) {
      remaining -= segmentDuration;
    }
    cursor = segmentEnd;
  }
  return cursor;
}

function addNonSundayWorkingDays(startValue, days) {
  return addNonSundayWorkingMs(startValue, Math.max(0, Number(days) || 0) * 24 * 60 * 60 * 1000);
}

function isSopSystemActivityEntry(entry = {}) {
  const by = String(entry?.by || "").trim().toLowerCase();
  const source = String(entry?.source || "").trim().toLowerCase();
  return SOP_SYSTEM_ACTIVITY_ACTORS.has(by)
    || SOP_SYSTEM_ACTIVITY_ACTORS.has(source)
    || by.startsWith("system:")
    || source.startsWith("system:")
    || source.includes("webhook");
}

function hasSopWhatsappSignal(value) {
  return /whatsapp|reachout/i.test(String(value || "").trim());
}

function isSopCounselorProgressEvent(entry = {}, options = {}) {
  if (!entry || typeof entry !== "object" || isSopSystemActivityEntry(entry)) {
    return false;
  }

  const activityType = String(entry.activityType || entry.type || entry.eventType || entry.actionType || entry.label || "").trim();
  const actionDescription = String(entry.actionDescription || entry.description || "").trim();
  if (
    SOP_EXCLUDED_ACTIVITY_TYPES.has(activityType)
    || hasSopWhatsappSignal(activityType)
    || hasSopWhatsappSignal(actionDescription)
  ) {
    return false;
  }

  const updates = entry.updates && typeof entry.updates === "object" ? entry.updates : null;
  if (!updates) {
    return Boolean(activityType || String(entry.by || "").trim());
  }

  const allowedFields = new Set((options.activityFields || []).map((item) => String(item || "").trim()).filter(Boolean));
  return Object.keys(updates).some((field) => {
    const normalizedField = String(field || "").trim();
    if (!normalizedField || hasSopWhatsappSignal(normalizedField)) {
      return false;
    }
    return !allowedFields.size || allowedFields.has(normalizedField);
  });
}

function getSopProgressAnchorAt(lead) {
  const explicit = String(lead?.admissionSopLastProgressAt || "").trim();
  if (explicit && isLsqImportedLead(lead)) {
    return explicit;
  }

  const history = Array.isArray(lead?.mainAdmissionActivityHistory) ? lead.mainAdmissionActivityHistory : [];
  const activityOptions = SOP_ACTIVITY_OPTIONS_BY_HISTORY_FIELD.mainAdmissionActivityHistory || {};
  return history
    .filter((entry) => isSopCounselorProgressEvent(entry, activityOptions))
    .map((entry) => String(entry?.at || "").trim())
    .filter(Boolean)
    .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] || null;
}

function resolveSopBaseTimestamp(lead) {
  const candidates = [
    lead?.admissionSopAssignedAt,
    lead?.counselorAssignedAt,
    lead?.createdAtExact,
    lead?.updatedAt
  ].map((value) => String(value || "").trim()).filter(Boolean);

  for (const candidate of candidates) {
    if (Number.isFinite(new Date(candidate).getTime())) {
      return candidate;
    }
  }

  const createdAt = String(lead?.createdAt || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(createdAt)) {
    return `${createdAt}T00:00:00+05:30`;
  }
  return Number.isFinite(new Date(createdAt).getTime()) ? createdAt : null;
}

function isSopBlockedLead(lead) {
  if (isLsqImportedLead(lead) || lead?.sopExcluded) {
    return false;
  }

  if (!isRegisteredCandidateLead(lead)) {
    return false;
  }

  const counselor = String(lead?.counselor || "").trim();
  if (!counselor || counselor.toLowerCase() === "unassigned") {
    return false;
  }

  const status = String(lead?.mainAdmissionAdmissionStatus || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  if (status === "won" || status === "enrolled") {
    return false;
  }

  const assignedAt = resolveSopBaseTimestamp(lead);
  const progressAt = getSopProgressAnchorAt(lead);
  const anchorAt = progressAt || assignedAt;
  if (!anchorAt) {
    return false;
  }

  const isOfferedStage = status === "opportunity" || status === "offered";
  const deadlineTs = progressAt
    ? (isOfferedStage ? addNonSundayWorkingDays(anchorAt, SOP_OFFERED_WINDOW_DAYS) : addNonSundayWorkingDays(anchorAt, SOP_ACTIVE_WINDOW_DAYS))
    : addNonSundayWorkingMs(anchorAt, SOP_NEW_WINDOW_MS);
  const overrideDeadlineTs = new Date(String(lead?.admissionSopDeadlineOverrideAt || "")).getTime();
  const effectiveDeadlineTs = Number.isFinite(overrideDeadlineTs) ? overrideDeadlineTs : deadlineTs;
  return Number.isFinite(effectiveDeadlineTs) && effectiveDeadlineTs - Date.now() <= 0;
}

function canManagerTakeMainAdmissionLead(lead = {}) {
  if (!isManagerSession()) return false;
  if (String(lead?.counselor || "").trim().toLowerCase() === getCounselorIdentity()) return false;
  return (scopedAdmissionSopEnabled && isSopBlockedLead(lead))
    || (isLsqImportedLead(lead) && !isMainAdmissionLeadInterested(lead) && !isProtectedMainAdmissionStatus(lead));
}

function getRepeatEnquiryCount(lead) {
  const explicitCount = Number.isFinite(Number(lead?.repeatEnquiryCount))
    ? Number(lead.repeatEnquiryCount)
    : 0;
  if (explicitCount > 0) {
    return explicitCount;
  }

  const workshopReentryCount = Array.isArray(lead?.workshopMigrationHistory)
    ? lead.workshopMigrationHistory.length
    : 0;
  if (workshopReentryCount > 0) {
    return workshopReentryCount;
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

function getMcubeHistory(lead = {}) {
  return Array.isArray(lead?.mcubeCallHistory) ? lead.mcubeCallHistory : [];
}

function getCallDirection(entry = {}) {
  return String(entry?.direction || entry?.callMetadata?.callDirection || entry?.callMetadata?.direction || "").trim().toLowerCase();
}

function isOutboundCallEntry(entry = {}) {
  return getCallDirection(entry) === "outbound";
}

function isInboundCallEntry(entry = {}) {
  return getCallDirection(entry) === "inbound";
}

function isConnectedCallEntry(entry = {}) {
  const status = String(
    entry?.normalizedStatus
    || entry?.disposition
    || entry?.rawStatus
    || entry?.eventType
    || entry?.callMetadata?.normalizedCallStatus
    || entry?.callMetadata?.callStatus
    || ""
  ).trim();
  return /(connect|connected|answer|answered|completed|success|picked)/i.test(status)
    && !isNotPickedCallActivity(entry);
}

function getCallTimestamp(entry = {}) {
  return getEntryTimestamp(entry?.at || entry?.timestamp || entry);
}

function getLatestCallEntry(lead = {}, predicate = () => true) {
  return getMcubeHistory(lead)
    .filter(predicate)
    .reduce((latest, entry) => {
      if (!latest) return entry;
      return getCallTimestamp(entry) >= getCallTimestamp(latest) ? entry : latest;
    }, null);
}

function getAgeInDays(timestamp) {
  if (!Number.isFinite(timestamp)) {
    return Number.NaN;
  }
  return Math.max(0, (Date.now() - timestamp) / (24 * 60 * 60 * 1000));
}

function getLeadTasks(lead = {}) {
  const leadId = String(lead?.id || "").trim();
  if (!leadId) {
    return [];
  }
  return getStoredTasks().filter((task) => (
    String(task?.leadId || "").trim() === leadId
    && String(task?.category || "").trim() === TASK_CATEGORY.mainAdmission
  ));
}

function parseTaskDueTimestamp(task = {}) {
  const timestamp = new Date(String(task?.dueDate || "")).getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.NaN;
}

function getAdvancedTaskStatus(lead = {}) {
  const tasks = getLeadTasks(lead);
  if (!tasks.length) {
    return "none";
  }
  const now = Date.now();
  const todayKey = toKolkataDateKey();
  const twoDaysFromNow = now + (2 * 24 * 60 * 60 * 1000);
  if (tasks.some((task) => {
    const dueAt = parseTaskDueTimestamp(task);
    return Number.isFinite(dueAt) && dueAt < now;
  })) {
    return "overdue";
  }
  if (tasks.some((task) => {
    const dueAt = parseTaskDueTimestamp(task);
    return Number.isFinite(dueAt) && toKolkataDateKey(new Date(dueAt)) === todayKey;
  })) {
    return "dueToday";
  }
  if (tasks.some((task) => {
    const dueAt = parseTaskDueTimestamp(task);
    return Number.isFinite(dueAt) && dueAt <= twoDaysFromNow;
  })) {
    return "dueNext2Days";
  }
  return "scheduled";
}

function getCallTalkTimeSeconds(entry = {}) {
  const rawFields = entry?.rawFields && typeof entry.rawFields === "object" ? entry.rawFields : {};
  const candidates = [
    entry?.duration,
    rawFields.duration,
    rawFields.call_duration,
    rawFields.callDuration,
    rawFields.talktime,
    rawFields.talk_time,
    rawFields.talkTime,
    rawFields.recording_duration
  ];
  for (const candidate of candidates) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric)) {
      return Math.max(0, numeric);
    }
  }
  return 0;
}

function leadHasCallRecording(lead = {}) {
  return getMcubeHistory(lead).some((entry) => String(entry?.recordingUrl || entry?.callMetadata?.recordingUrl || "").trim());
}

function getLeadCampaignSearchText(lead = {}) {
  const extraFields = getLeadExtraFields(lead);
  return [
    lead.metaCampaignName,
    lead.metaAdsetName,
    lead.metaAdName,
    lead.elementorFormName,
    lead.elementorPageUrl,
    extraFields.utm_campaign,
    extraFields.utm_source,
    extraFields.utm_medium,
    extraFields.campaign,
    extraFields.campaign_name,
    extraFields.ad_name,
    extraFields.adset_name,
    extraFields.form_name,
    extraFields.page_url
  ].filter(Boolean).join(" ").toLowerCase();
}

function getLatestWhatsappTimestamp(lead = {}, pattern) {
  const history = Array.isArray(lead?.mainAdmissionActivityHistory) ? lead.mainAdmissionActivityHistory : [];
  const matching = history.filter((entry) => pattern.test(getActivityLabel(entry)));
  return getEntryTimestamp(getLatestHistoryEntry(matching));
}

function getAdvancedMetricValue(lead = {}, field) {
  const calls = getMcubeHistory(lead);
  if (field === "outboundCallCount") return calls.filter(isOutboundCallEntry).length;
  if (field === "inboundCallCount") return calls.filter(isInboundCallEntry).length;
  if (field === "totalCallCount") return calls.length;
  if (field === "connectedCallCount") return calls.filter(isConnectedCallEntry).length;
  if (field === "notPickedCallCount") return calls.filter(isNotPickedCallActivity).length;
  if (field === "latestOutboundAgeDays") return getAgeInDays(getCallTimestamp(getLatestCallEntry(lead, isOutboundCallEntry)));
  if (field === "latestConnectedAgeDays") return getAgeInDays(getCallTimestamp(getLatestCallEntry(lead, isConnectedCallEntry)));
  if (field === "leadAgeDays") return getAgeInDays(getLeadImportTimestamp(lead));
  if (field === "assignedUntouchedDays") {
    if (getLeadActivityUpdateCount(lead) > 0 || calls.length > 0) return 0;
    return getAgeInDays(getEntryTimestamp(resolveSopBaseTimestamp(lead)));
  }
  if (field === "notesCount") return Array.isArray(lead?.leadNotes) ? lead.leadNotes.length : 0;
  if (field === "repeatEnquiryCount") return getRepeatEnquiryCount(lead);
  if (field === "totalTalkTimeMinutes") return calls.reduce((sum, entry) => sum + getCallTalkTimeSeconds(entry), 0) / 60;
  if (field === "stageAgingDays") {
    const stageFields = ["mainAdmissionAdmissionStatus", "mainAdmissionCourseStatus", "mainAdmissionCallStatus"];
    const latestStageEntry = (Array.isArray(lead?.mainAdmissionActivityHistory) ? lead.mainAdmissionActivityHistory : [])
      .filter((entry) => {
        const updates = entry?.updates && typeof entry.updates === "object" ? entry.updates : {};
        return stageFields.some((fieldName) => Object.prototype.hasOwnProperty.call(updates, fieldName));
      })
      .reduce((latest, entry) => !latest || getEntryTimestamp(entry) >= getEntryTimestamp(latest) ? entry : latest, null);
    return getAgeInDays(getEntryTimestamp(latestStageEntry || lead?.updatedAt || lead?.createdAtExact || lead?.createdAt));
  }
  return Number.NaN;
}

function compareAdvancedMetric(actual, operator, expected) {
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) {
    return false;
  }
  if (operator === "lt") return actual < expected;
  if (operator === "lte") return actual <= expected;
  if (operator === "eq") return actual === expected;
  if (operator === "gt") return actual > expected;
  return actual >= expected;
}

function leadMatchesWhatsappFollowupGap(lead = {}, value) {
  const latestReplyAt = getLatestWhatsappTimestamp(lead, /whatsapp replied/i);
  const latestSentAt = getLatestWhatsappTimestamp(lead, /whatsapp sent/i);
  const latestReadOrClickAt = getLatestWhatsappTimestamp(lead, /whatsapp (read|clicked)/i);
  const latestConnectedCallAt = getCallTimestamp(getLatestCallEntry(lead, isConnectedCallEntry));
  const latestOutboundAt = getCallTimestamp(getLatestCallEntry(lead, isOutboundCallEntry));
  if (value === "sentNoReply") {
    return Number.isFinite(latestSentAt) && (!Number.isFinite(latestReplyAt) || latestReplyAt < latestSentAt);
  }
  if (value === "replyNoConnectedCall") {
    return Number.isFinite(latestReplyAt) && (!Number.isFinite(latestConnectedCallAt) || latestConnectedCallAt < latestReplyAt);
  }
  if (value === "readNoOutboundAfter") {
    return Number.isFinite(latestReadOrClickAt) && (!Number.isFinite(latestOutboundAt) || latestOutboundAt < latestReadOrClickAt);
  }
  return false;
}

function leadMatchesAdvancedCondition(lead = {}, condition = {}) {
  const advanced = normalizeAdvancedFilterCondition(condition);
  if (!advanced.field || !advanced.value) {
    return true;
  }
  const definition = getAdvancedFilterDefinition(advanced.field);
  if (!definition) {
    return true;
  }
  if (advanced.field === "pendingTaskStatus") {
    return getAdvancedTaskStatus(lead) === advanced.value;
  }
  if (advanced.field === "campaignText") {
    return getLeadCampaignSearchText(lead).includes(advanced.value.toLowerCase());
  }
  if (advanced.field === "recordingStatus") {
    const hasRecording = leadHasCallRecording(lead);
    return advanced.value === "has" ? hasRecording : !hasRecording;
  }
  if (advanced.field === "whatsappFollowupGap") {
    return leadMatchesWhatsappFollowupGap(lead, advanced.value);
  }
  const expected = Number(advanced.value);
  if (!Number.isFinite(expected)) {
    return true;
  }
  return compareAdvancedMetric(getAdvancedMetricValue(lead, advanced.field), advanced.operator, expected);
}

function leadMatchesAdvancedFilter(lead = {}) {
  const advanced = normalizeAdvancedFilter(filter.advanced);
  if (!advanced.conditions.length) {
    return true;
  }
  return advanced.conditions.reduce((matches, condition, index) => {
    const conditionMatches = leadMatchesAdvancedCondition(lead, condition);
    if (index === 0) {
      return conditionMatches;
    }
    return condition.connector === "or"
      ? matches || conditionMatches
      : matches && conditionMatches;
  }, true);
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

function getStoredRegisteredCandidateLeads() {
  const leads = Array.isArray(scopedMainAdmissionLeads)
    ? [...scopedMainAdmissionLeads]
    : getStoredLeads().filter(isRegisteredCandidateLead);
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
  if (!isCounselorSession() || session?.role === "manager") {
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

function buildLeadTabUrl(lead) {
  const params = new URLSearchParams({
    leadId: String(lead?.id || "").trim(),
    leadEmail: String(lead?.email || "").trim().toLowerCase(),
    stage: "main-admission"
  });
  return `lead-tab.html?${params.toString()}`;
}

function cacheLeadTabSnapshot(lead, stage) {
  if (!lead) return;
  const cacheKey = `dvLeadTabCache:${String(lead?.id || "").trim()}:${String(lead?.email || "").trim().toLowerCase() || "no-email"}:${stage || "auto"}`;
  try {
    localStorage.setItem(cacheKey, JSON.stringify({
      cachedAt: Date.now(),
      stage,
      lead
    }));
  } catch {
    // Ignore cache write failures.
  }
}

function getSelectableLeadKeys(leads) {
  return leads.map((lead) => buildLeadKey(lead));
}

function isUnassignedCounselor(value) {
  return String(value || "").trim().toLowerCase() === "unassigned";
}

function isArchivedCounselor(value) {
  return String(value || "").trim().toLowerCase() === "archived leads";
}

function getSelectedLeads(leads) {
  return leads.filter((lead) => selectedLeadKeys.has(buildLeadKey(lead)));
}

function getSelectedUnassignedLeads(leads) {
  return getSelectedLeads(leads).filter((lead) => isUnassignedCounselor(lead?.counselor));
}

function getSelectedAssignableLeads(leads) {
  return getSelectedLeads(leads).filter((lead) => {
    if (session?.role === "super_admin") return true;
    if (session?.role === "manager") {
      const isOwnLead = String(lead?.counselor || "").trim().toLowerCase() === getCounselorIdentity();
      return isOwnLead || isUnassignedCounselor(lead?.counselor) || isArchivedCounselor(lead?.counselor);
    }
    return isUnassignedCounselor(lead?.counselor) || isArchivedCounselor(lead?.counselor);
  });
}

function getSelectedBlockedSopLeads(leads) {
  return getSelectedLeads(leads).filter(isSopBlockedLead);
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
  filteredSelectionLimit = 0;
  const next = new Set(selectedLeadKeys);
  if (isChecked) {
    next.add(String(leadKey));
  } else {
    next.delete(String(leadKey));
  }
  selectedLeadKeys = next;
}

function toggleAllLeadsSelection(leads, isChecked) {
  filteredSelectionLimit = 0;
  selectedLeadKeys = isChecked ? new Set(getSelectableLeadKeys(leads)) : new Set();
}

function getScopedMainAdmissionFilterPayload({ page = currentPage, limit = pageSize } = {}) {
  const payload = {
    section: "main-admission",
    page: String(page),
    limit: String(limit)
  };
  [
    "search",
    "timeline",
    "startDate",
    "endDate",
    "counselorActivityTimeline",
    "counselorActivityStartDate",
    "counselorActivityEndDate",
    "leadOwner",
    "location",
    "leadSource",
    "mainAdmissionDialed",
    "mainAdmissionCourseStatus",
    "mainAdmissionAdmissionStatus",
    "mainAdmissionCallStatus",
    "activityStatus",
    "latestActivity",
    "repeatEnquiryStatus",
    "whatsappActivity",
    "sopFilter",
    "lsqLeads"
  ].forEach((key) => {
    const value = String(filter?.[key] || "").trim();
    if (value) payload[key] = value;
  });
  const selectedCounselors = normalizeMultiValueFilter(filter.counselor);
  if (selectedCounselors.length) {
    payload.counselor = selectedCounselors.join(",");
  }
  const selectedCourses = normalizeMultiValueFilter(filter.courseName);
  if (selectedCourses.length) {
    payload.courseName = selectedCourses.join(",");
  }
  return payload;
}

function buildScopedDataSignature(payload = getScopedMainAdmissionFilterPayload()) {
  return new URLSearchParams(payload).toString();
}

function isScopedServerPageFresh() {
  return scopedDataSignature && scopedDataSignature === buildScopedDataSignature();
}

function ensureFreshScopedServerPage() {
  if (!scopedLoadActive || scopedReloadInFlight || isScopedServerPageFresh()) {
    return;
  }
  scopedReloadInFlight = loadScopedMainAdmissionLeads()
    .then(() => renderAll())
    .finally(() => {
      scopedReloadInFlight = null;
    });
}

function isLeadSelected(lead) {
  return selectedLeadKeys.has(buildLeadKey(lead));
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

  filteredSelectionLimit = 0;
  selectedLeadKeys = new Set(getSelectableLeadKeys(leads).slice(0, count));
  return count;
}

function selectFilteredLeadBatch(rawValue, totalLeadCount) {
  const count = clampSelectionCount(rawValue, totalLeadCount);
  if (!count) {
    return 0;
  }

  selectedLeadKeys = new Set();
  filteredSelectionLimit = count;
  return count;
}

function clearBulkLeadSelection() {
  selectedLeadKeys = new Set();
  filteredSelectionLimit = 0;
}

function findLeadByRef(leadRef) {
  const leads = getAllRegisteredCandidateLeads();
  return leads.find((lead) => buildLeadKey(lead) === buildLeadKey(leadRef)) || null;
}

function getUniqueValues(leads, key) {
  return [...new Set(leads.map((lead) => String(lead[key] || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function formatReadableDate(date) {
  return formatKolkataDate(date);
}

function getTimelineRange() {
  if (filter.timeline === "overall") {
    return null;
  }

  if (filter.timeline === "today") {
    const { start, end } = getKolkataDayRange(0);
    return { start, end };
  }

  if (filter.timeline === "yesterday") {
    const { start, end } = getKolkataDayRange(-1);
    return { start, end };
  }

  if (filter.timeline === "week") {
    const { start } = getKolkataDayRange(-6);
    const { end } = getKolkataDayRange(0);
    return { start, end };
  }

  const start = parseTimelineDate(filter.startDate);
  const endBase = parseTimelineDate(filter.endDate);
  if (!start || !endBase || start > endBase) {
    return { start: null, end: null };
  }

  const end = new Date(`${toKolkataDateKey(endBase)}T23:59:59.999+05:30`);
  return { start, end };
}

function filterLeadsByTimeline(leads) {
  const scopedLeads = filterByLeadOwner(leads);
  const range = getTimelineRange();
  if (!range) {
    return scopedLeads;
  }
  if (!range.start || !range.end) {
    return scopedLeads;
  }

  const startTime = range.start.getTime();
  const endTime = range.end.getTime();
  return scopedLeads.filter((lead) => {
    const created = parseTimelineDate(getLeadOwnerTimelineValue(lead));
    if (!created) {
      return false;
    }
    const createdTime = created.getTime();
    return createdTime >= startTime && createdTime <= endTime;
  });
}

function getTimelineLabel() {
  if (filter.timeline === "today") return "Today";
  if (filter.timeline === "yesterday") return "Yesterday";
  if (filter.timeline === "week") return "Week";
  if (filter.timeline === "custom") {
    const range = getTimelineRange();
    if (!range?.start || !range?.end) {
      return "Custom";
    }
    return `${formatReadableDate(range.start)} - ${formatReadableDate(range.end)}`;
  }
  return "Overall";
}

function normalizeLocationLabel(value) {
  const cleaned = String(value || "")
    .trim()
    .replace(/\s+/g, " ");

  if (!cleaned) {
    return "";
  }

  return cleaned
    .toLowerCase()
    .replace(/\b[a-z]/g, (match) => match.toUpperCase());
}

function getLeadLocation(lead) {
  const extraFields = getLeadExtraFields(lead);
  const cityCandidates = [
    extraFields.city,
    extraFields.current_city,
    extraFields.city_name,
    extraFields.town,
    extraFields.location
  ];

  for (const candidate of cityCandidates) {
    const normalized = normalizeLocationLabel(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return normalizeLocationLabel(lead?.country) || "India";
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
        if (typeof window.__dvNavigateToRoute === "function") {
          void window.__dvNavigateToRoute(route);
          return;
        }
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
    panelDescription.textContent = "New main admission leads stay with the system until an admin assigns them manually.";
  }
  if (panelHelp) {
    panelHelp.textContent = `Clear Data removes only ${segmentConfig.label} data. Other CRM lead sections stay unchanged.`;
  }
  mainAdmissionRoutingOptions.innerHTML = `<p class="block-help">Use the bulk assign controls on this page when you want to hand these leads to a counselor.</p>`;
  if (saveMainAdmissionRoutingBtn) saveMainAdmissionRoutingBtn.classList.add("hidden");
  if (clearMainAdmissionLeadDataBtn) clearMainAdmissionLeadDataBtn.disabled = false;
}

async function clearRegisteredCandidateData() {
  const segmentConfig = getSegmentConfig();
  const currentTotal = scopedCounts?.total ?? getAllRegisteredCandidateLeads().filter((lead) => getLeadSegment(lead) === activeSegment).length;
  const confirmed = window.confirm(`Clear only ${segmentConfig.label} data?`);
  if (!confirmed) {
    return;
  }

  const saveResult = await withButtonBusy(
    clearMainAdmissionLeadDataBtn,
    "Clearing data...",
    async () => {
      const response = await fetch(apiUrl("/api/leads/scoped?section=main-admission"), {
        method: "DELETE",
        credentials: "same-origin",
        headers: { Accept: "application/json" }
      });
      const payload = await response.json().catch(() => ({}));
      return response.ok ? { ok: true, ...payload } : { ok: false, message: payload?.message || "Failed to clear Main Admission Lead data." };
    }
  );
  if (!saveResult || saveResult.ok === false) {
    setRoutingMessage(saveResult?.message || "Failed to clear Main Admission Lead data.", true);
    return;
  }

  selectedLeadKeys = new Set();
  currentPage = 1;
  scopedFacets = null;
  await loadScopedMainAdmissionLeads();
  renderRegisteredRoutingPanel();
  renderAll();
  const deletedCount = Number(saveResult.deletedCount ?? currentTotal) || 0;
  setRoutingMessage(`Cleared ${deletedCount} ${segmentConfig.clearLabel} lead${deletedCount === 1 ? "" : "s"}.`);
  showToast(`${segmentConfig.label} data cleared.`);
}

function renderKpis(leads) {
  const counts = shouldUseScopedServerPage() && scopedCounts ? scopedCounts : null;
  const total = counts ? Number(counts.total || 0) : leads.length;
  const interested = counts ? Number(counts.interested || 0) : leads.filter((lead) => lead.mainAdmissionCourseStatus === "Interested").length;
  const enrolled = counts ? Number(counts.enrolled || 0) : leads.filter((lead) => lead.mainAdmissionAdmissionStatus === "Enrolled").length;
  const won = counts ? Number(counts.won || 0) : leads.filter((lead) => lead.mainAdmissionAdmissionStatus === "Won").length;

  mainAdmissionKpiSection.innerHTML = `
    <article class="card kpi-card">
      <p>Overall Leads</p>
      <h2>${total}</h2>
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
  const facetCounselors = Array.isArray(scopedFacets?.counselors) ? scopedFacets.counselors : null;
  const facetCourses = Array.isArray(scopedFacets?.courses) ? scopedFacets.courses : null;
  const facetLocations = Array.isArray(scopedFacets?.locations) ? scopedFacets.locations : null;
  const counselors = facetCounselors || getUniqueValues(leads, "counselor");
  const counselorOptions = [
    { value: "", label: "All" },
    { value: "Unassigned", label: "Unassigned" },
    ...(canUseLostLeadFilter ? [{ value: LOST_LEADS_COUNSELOR_FILTER, label: "Lost Leads" }] : []),
    ...counselors
      .filter((item) => item
        && item !== "Unassigned"
        && item !== LOST_LEADS_COUNSELOR_FILTER
        && (!isManager || item !== "Archived Leads"))
      .map((item) => ({ value: item, label: item }))
  ];
  const courses = facetCourses || getFixedCourseFilterOptions(leads);
  const locations = facetLocations || [...new Set(leads.map((lead) => getLeadLocation(lead)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const selectedCourses = normalizeMultiValueFilter(filter.courseName);
  const allCoursesSelected = courses.length > 0 && selectedCourses.length === courses.length;
  const courseTriggerLabel = !selectedCourses.length
    ? "All"
    : allCoursesSelected
      ? `All (${selectedCourses.length})`
      : selectedCourses.length === 1
        ? selectedCourses[0]
        : `${selectedCourses.length} selected`;

  const selectedCounselors = normalizeMultiValueFilter(filter.counselor);
  const allCounselorOptions = counselorOptions.filter((item) => item.value !== "");
  const allCounselorsSelected = allCounselorOptions.length > 0 && selectedCounselors.length === allCounselorOptions.length;
  const counselorTriggerLabel = !selectedCounselors.length
    ? "All"
    : allCounselorsSelected
      ? `All (${selectedCounselors.length})`
      : selectedCounselors.length === 1
        ? (counselorOptions.find((opt) => opt.value === selectedCounselors[0])?.label || selectedCounselors[0])
        : `${selectedCounselors.length} selected`;

  mainAdmissionFilterBar.innerHTML = `
    <div class="filter-section">
      <div class="filter-section-title">Timeline</div>
      <div class="filter-row">
        <div class="filter-item">
          <label for="mainAdmissionTimelineSelect">Timeline</label>
          <select id="mainAdmissionTimelineSelect">
            <option value="overall" ${filter.timeline === "overall" ? "selected" : ""}>Overall</option>
            <option value="today" ${filter.timeline === "today" ? "selected" : ""}>Today</option>
            <option value="yesterday" ${filter.timeline === "yesterday" ? "selected" : ""}>Yesterday</option>
            <option value="week" ${filter.timeline === "week" ? "selected" : ""}>Week</option>
            <option value="custom" ${filter.timeline === "custom" ? "selected" : ""}>Custom</option>
          </select>
        </div>
        <div class="filter-item ${filter.timeline === "custom" ? "" : "hidden"}" id="mainAdmissionStartDateWrap">
          <label for="mainAdmissionStartDate">Start Date</label>
          <input id="mainAdmissionStartDate" type="date" value="${escapeHtml(filter.startDate)}" />
        </div>
        <div class="filter-item ${filter.timeline === "custom" ? "" : "hidden"}" id="mainAdmissionEndDateWrap">
          <label for="mainAdmissionEndDate">End Date</label>
          <input id="mainAdmissionEndDate" type="date" value="${escapeHtml(filter.endDate)}" />
        </div>
        ${renderCounselorActivityDateFilter({ prefix: "mainAdmission", filter, escapeHtml })}
        ${isAdmin ? `
        <div class="filter-item">
          <label for="mainAdmissionSopFilterSelect">SOP Filter</label>
          <select id="mainAdmissionSopFilterSelect">
            <option value="">Use Filter</option>
            <option value="${SOP_FILTER_BLOCKED}" ${filter.sopFilter === SOP_FILTER_BLOCKED ? "selected" : ""}>Blocked Leads</option>
          </select>
        </div>
        ` : ""}
        ${renderAdvancedFilterControl()}
      </div>
    </div>

    <div class="filter-section">
      <div class="filter-section-title">Lead Search & Ownership</div>
      <div class="filter-row">
        <div class="filter-item filter-item--search">
          <label for="mainAdmissionSearchInput">Search Lead</label>
          <input id="mainAdmissionSearchInput" type="text" placeholder="Name, email, phone, course, counselor" value="${escapeHtml(draftMainAdmissionSearch)}" />
        </div>
        <div class="filter-item">
          <label for="mainAdmissionLeadOwnerSelect">Lead Owner</label>
          <select id="mainAdmissionLeadOwnerSelect">
            <option value="all" ${filter.leadOwner === "all" ? "selected" : ""}>All Leads</option>
            <option value="direct" ${filter.leadOwner === "direct" ? "selected" : ""}>Directly Assigned</option>
            <option value="reassigned" ${filter.leadOwner === "reassigned" ? "selected" : ""}>Assigned From Someone Else</option>
          </select>
        </div>
        ${canFilterByCounselor ? `
        <div class="filter-item">
          <label for="mainAdmissionCounselorTrigger">Counselor</label>
          <div class="multi-filter ${isCounselorFilterOpen ? "multi-filter--open" : ""}" id="mainAdmissionCounselorMultiFilter">
            <button
              type="button"
              id="mainAdmissionCounselorTrigger"
              class="multi-filter-trigger"
              aria-haspopup="true"
              aria-expanded="${isCounselorFilterOpen ? "true" : "false"}"
            >
              <span class="multi-filter-trigger__text">${escapeHtml(counselorTriggerLabel)}</span>
              <span class="multi-filter-caret" aria-hidden="true">${isCounselorFilterOpen ? "&#9650;" : "&#9660;"}</span>
            </button>
            ${isCounselorFilterOpen ? `
            <div class="multi-filter-menu" id="mainAdmissionCounselorMenu">
              <div class="multi-filter-actions">
                <button type="button" class="multi-filter-action-btn" id="mainAdmissionCounselorSelectAllBtn">Select All</button>
                <button type="button" class="multi-filter-action-btn" id="mainAdmissionCounselorClearBtn">Clear</button>
                <button type="button" class="multi-filter-action-btn multi-filter-action-btn--primary" id="mainAdmissionCounselorCloseBtn">Close</button>
              </div>
              ${counselorOptions.length
                ? counselorOptions.filter((item) => item.value !== "").map((item) => {
                    const checked = selectedCounselors.includes(item.value);
                    return `
                    <label class="multi-filter-option ${checked ? "multi-filter-option--selected" : ""}">
                      <input type="checkbox" value="${escapeHtml(item.value)}" data-counselor-filter-option ${checked ? "checked" : ""} />
                      <span>${escapeHtml(item.label)}</span>
                    </label>
                  `;
                  }).join("")
                : `<div class="multi-filter-empty">No counselor options available.</div>`}
              <div class="multi-filter-meta">
                <span class="selected-count">Selected: ${selectedCounselors.length || "All"}</span>
              </div>
            </div>
            ` : ""}
          </div>
        </div>
        ` : ""}
      </div>
    </div>

    <div class="filter-section">
      <div class="filter-section-title">Lead Details</div>
      <div class="filter-row">
        ${activeSegment === DEFAULT_SEGMENT ? `
        <div class="filter-item">
          <label for="mainAdmissionCourseTrigger">Course Name</label>
          <div class="multi-filter ${isCourseFilterOpen ? "multi-filter--open" : ""}" id="mainAdmissionCourseMultiFilter">
            <button
              type="button"
              id="mainAdmissionCourseTrigger"
              class="multi-filter-trigger"
              aria-haspopup="true"
              aria-expanded="${isCourseFilterOpen ? "true" : "false"}"
            >
              <span class="multi-filter-trigger__text">${escapeHtml(courseTriggerLabel)}</span>
              <span class="multi-filter-caret" aria-hidden="true">${isCourseFilterOpen ? "&#9650;" : "&#9660;"}</span>
            </button>
            ${isCourseFilterOpen ? `
            <div class="multi-filter-menu" id="mainAdmissionCourseMenu">
              <div class="multi-filter-actions">
                <button type="button" class="multi-filter-action-btn" id="mainAdmissionCourseSelectAllBtn">Select All</button>
                <button type="button" class="multi-filter-action-btn" id="mainAdmissionCourseClearBtn">Clear</button>
                <button type="button" class="multi-filter-action-btn multi-filter-action-btn--primary" id="mainAdmissionCourseCloseBtn">Close</button>
              </div>
              ${courses.length
                ? courses.map((item) => {
                    const checked = selectedCourses.includes(item);
                    return `
                    <label class="multi-filter-option ${checked ? "multi-filter-option--selected" : ""}">
                      <input type="checkbox" value="${escapeHtml(item)}" data-course-filter-option ${checked ? "checked" : ""} />
                      <span>${escapeHtml(item)}</span>
                    </label>
                  `;
                  }).join("")
                : `<div class="multi-filter-empty">No course options available.</div>`}
              <div class="multi-filter-meta">
                <span class="selected-count">Selected: ${selectedCourses.length || "All"}</span>
              </div>
            </div>
            ` : ""}
          </div>
        </div>
        ` : ""}
        <div class="filter-item">
          <label for="mainAdmissionLocationSelect">Location</label>
          <select id="mainAdmissionLocationSelect">
            <option value="">All</option>
            ${locations.map((item) => `<option value="${escapeHtml(item)}" ${filter.location === item ? "selected" : ""}>${escapeHtml(item)}</option>`).join("")}
          </select>
        </div>
        <div class="filter-item">
          <label for="mainAdmissionLeadSourceSelect">Lead Source</label>
          <select id="mainAdmissionLeadSourceSelect">
            <option value="">All</option>
            <option value="meta" ${filter.leadSource === "meta" ? "selected" : ""}>Meta</option>
            <option value="elementor" ${filter.leadSource === "elementor" ? "selected" : ""}>Elementor</option>
            <option value="mcube" ${filter.leadSource === "mcube" ? "selected" : ""}>Mcube</option>
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
      </div>
    </div>

    <div class="filter-section">
      <div class="filter-section-title">Pipeline Status</div>
      <div class="filter-row">
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
            <option value="Opportunity" ${filter.mainAdmissionAdmissionStatus === "Opportunity" ? "selected" : ""}>Opportunity</option>
            <option value="Offered" ${filter.mainAdmissionAdmissionStatus === "Offered" ? "selected" : ""}>Offered</option>
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
          <label for="mainAdmissionActivityStatusSelect">Untouched Leads</label>
          <select id="mainAdmissionActivityStatusSelect">
            <option value="">Use Filter</option>
            <option value="Untouched" ${filter.activityStatus === "Untouched" ? "selected" : ""}>Untouched</option>
            <option value="Updated" ${filter.activityStatus === "Updated" ? "selected" : ""}>Updated</option>
          </select>
        </div>
        <div class="filter-item">
          <label for="mainAdmissionLatestActivitySelect">Latest Activity</label>
          <select id="mainAdmissionLatestActivitySelect">
            <option value="">Use Filter</option>
            <option value="Inbound Not Picked" ${filter.latestActivity === "Inbound Not Picked" ? "selected" : ""}>Inbound Not Picked</option>
          </select>
        </div>
        <div class="filter-item">
          <label for="mainAdmissionRepeatEnquirySelect">Repeat Enquiry</label>
          <select id="mainAdmissionRepeatEnquirySelect">
            <option value="">All</option>
            <option value="Repeat Enquiry" ${filter.repeatEnquiryStatus === "Repeat Enquiry" ? "selected" : ""}>Repeat Enquiry</option>
            <option value="First Time" ${filter.repeatEnquiryStatus === "First Time" ? "selected" : ""}>First Time</option>
          </select>
        </div>
        <div class="filter-item">
          <label for="mainAdmissionWhatsappActivitySelect">WhatsApp Activity</label>
          <select id="mainAdmissionWhatsappActivitySelect">
            <option value="">All</option>
            ${WHATSAPP_ACTIVITY_FILTER_OPTIONS.map((item) => `<option value="${escapeHtml(item)}" ${filter.whatsappActivity === item ? "selected" : ""}>${escapeHtml(item)}</option>`).join("")}
          </select>
        </div>
        <div class="filter-item">
          <label for="mainAdmissionLsqLeadsSelect">LSQ Leads</label>
          <select id="mainAdmissionLsqLeadsSelect">
            <option value="" ${filter.lsqLeads === "" ? "selected" : ""}>All</option>
            <option value="only" ${filter.lsqLeads === "only" ? "selected" : ""}>Only LSQ</option>
            <option value="hide" ${filter.lsqLeads === "hide" ? "selected" : ""}>Hide LSQ</option>
          </select>
        </div>
      </div>
    </div>

    <div class="filter-section">
      <div class="filter-section-title">Actions</div>
      <div class="filter-row">
        <div class="filter-item filter-item-cta">
          <label>&nbsp;</label>
          <div class="filter-actions">
            <button id="mainAdmissionExportBtn" type="button" class="btn-primary">Export Leads</button>
            <button id="mainAdmissionResetFiltersBtn" type="button" class="btn-ghost">Reset</button>
          </div>
        </div>
      </div>
    </div>
    ${isAdvancedFilterOpen ? renderAdvancedFilterPanel() : ""}
  `;

  bindAdvancedFilterPanel();

  document.getElementById("mainAdmissionTimelineSelect").onchange = (event) => {
    filter.timeline = event.target.value;
    persistFilters();
    currentPage = 1;
    document.getElementById("mainAdmissionStartDateWrap").classList.toggle("hidden", filter.timeline !== "custom");
    document.getElementById("mainAdmissionEndDateWrap").classList.toggle("hidden", filter.timeline !== "custom");
    renderAll();
  };
  bindCounselorActivityDateFilter({
    prefix: "mainAdmission",
    filter,
    persist: persistFilters,
    render: renderAll,
    resetPage: () => {
      currentPage = 1;
    }
  });
  document.getElementById("mainAdmissionSopFilterSelect")?.addEventListener("change", (event) => {
    filter.sopFilter = event.target.value === SOP_FILTER_BLOCKED ? SOP_FILTER_BLOCKED : "";
    selectedLeadKeys = new Set();
    bulkAssignCounselor = "";
    persistFilters();
    currentPage = 1;
    renderAll();
  });
  const startDateInput = document.getElementById("mainAdmissionStartDate");
  if (startDateInput) {
    startDateInput.onchange = (event) => {
      filter.startDate = event.target.value;
      persistFilters();
      currentPage = 1;
      renderAll();
    };
  }
  const endDateInput = document.getElementById("mainAdmissionEndDate");
  if (endDateInput) {
    endDateInput.onchange = (event) => {
      filter.endDate = event.target.value;
      persistFilters();
      currentPage = 1;
      renderAll();
    };
  }
  const searchInput = document.getElementById("mainAdmissionSearchInput");
  searchInput.oninput = (event) => {
    draftMainAdmissionSearch = event.target.value;
  };
  searchInput.onkeydown = (event) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    draftMainAdmissionSearch = event.target.value;
    filter.search = draftMainAdmissionSearch.trim();
    persistFilters();
    currentPage = 1;
    renderAll();
  };
  document.getElementById("mainAdmissionLeadOwnerSelect").onchange = (event) => {
    filter.leadOwner = event.target.value;
    persistFilters();
    currentPage = 1;
    renderAll();
  };
  const counselorTrigger = document.getElementById("mainAdmissionCounselorTrigger");
  if (counselorTrigger) {
    const counselorFilterEl = document.getElementById("mainAdmissionCounselorMultiFilter");
    if (counselorFilterEl) {
      counselorFilterEl.addEventListener("click", (e) => {
        e.stopPropagation();
      });
    }
    counselorTrigger.onclick = () => {
      isCounselorFilterOpen = !isCounselorFilterOpen;
      renderAll();
    };
    document.querySelectorAll("[data-counselor-filter-option]").forEach((input) => {
      input.onchange = (event) => {
        toggleCounselorFilterValue(event.target.value);
      };
    });
    const selectAllCounselorsBtn = document.getElementById("mainAdmissionCounselorSelectAllBtn");
    if (selectAllCounselorsBtn) {
      selectAllCounselorsBtn.onclick = () => {
        setAllCounselorFilters(leads);
      };
    }
    const clearCounselorsBtn = document.getElementById("mainAdmissionCounselorClearBtn");
    if (clearCounselorsBtn) {
      clearCounselorsBtn.onclick = () => {
        clearCounselorFilters();
      };
    }
    const closeCounselorsBtn = document.getElementById("mainAdmissionCounselorCloseBtn");
    if (closeCounselorsBtn) {
      closeCounselorsBtn.onclick = () => {
        isCounselorFilterOpen = false;
        renderAll();
      };
    }
  } else {
    filter.counselor = [];
    isCounselorFilterOpen = false;
  }
  const courseTrigger = document.getElementById("mainAdmissionCourseTrigger");
  if (courseTrigger) {
    const courseFilterEl = document.getElementById("mainAdmissionCourseMultiFilter");
    if (courseFilterEl) {
      courseFilterEl.addEventListener("click", (e) => {
        e.stopPropagation();
      });
    }
    courseTrigger.onclick = () => {
      isCourseFilterOpen = !isCourseFilterOpen;
      renderAll();
    };
    document.querySelectorAll("[data-course-filter-option]").forEach((input) => {
      input.onchange = (event) => {
        toggleCourseFilterValue(event.target.value);
      };
    });
    const selectAllCoursesBtn = document.getElementById("mainAdmissionCourseSelectAllBtn");
    if (selectAllCoursesBtn) {
      selectAllCoursesBtn.onclick = () => {
        setAllCourseFilters(leads);
      };
    }
    const clearCoursesBtn = document.getElementById("mainAdmissionCourseClearBtn");
    if (clearCoursesBtn) {
      clearCoursesBtn.onclick = () => {
        clearCourseFilters();
      };
    }
    const closeCoursesBtn = document.getElementById("mainAdmissionCourseCloseBtn");
    if (closeCoursesBtn) {
      closeCoursesBtn.onclick = () => {
        isCourseFilterOpen = false;
        renderAll();
      };
    }
  } else {
    filter.courseName = [];
    isCourseFilterOpen = false;
  }
  document.getElementById("mainAdmissionLocationSelect").onchange = (event) => {
    filter.location = event.target.value;
    persistFilters();
    currentPage = 1;
    renderAll();
  };
  document.getElementById("mainAdmissionLeadSourceSelect").onchange = (event) => {
    filter.leadSource = event.target.value;
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
  document.getElementById("mainAdmissionLatestActivitySelect").onchange = (event) => {
    filter.latestActivity = event.target.value;
    persistFilters();
    currentPage = 1;
    renderAll();
  };
  document.getElementById("mainAdmissionRepeatEnquirySelect").onchange = (event) => {
    filter.repeatEnquiryStatus = event.target.value;
    persistFilters();
    currentPage = 1;
    renderAll();
  };
  document.getElementById("mainAdmissionWhatsappActivitySelect").onchange = (event) => {
    filter.whatsappActivity = event.target.value;
    persistFilters();
    currentPage = 1;
    renderAll();
  };
  document.getElementById("mainAdmissionLsqLeadsSelect").onchange = (event) => {
    filter.lsqLeads = event.target.value;
    persistFilters();
    currentPage = 1;
    renderAll();
  };
  document.getElementById("mainAdmissionResetFiltersBtn").onclick = () => {
    filter = { ...DEFAULT_FILTER };
    filter.advanced = { ...ADVANCED_FILTER_DEFAULT };
    draftMainAdmissionSearch = filter.search;
    isCourseFilterOpen = false;
    isCounselorFilterOpen = false;
    isAdvancedFilterOpen = false;
    advancedFilterDraft = null;
    persistFilters();
    currentPage = 1;
    void renderAll();
  };

  document.getElementById("mainAdmissionExportBtn").onclick = () => {
    void withButtonBusy(
      document.getElementById("mainAdmissionExportBtn"),
      "Exporting...",
      exportFilteredLeads
    );
  };
}

function getMainAdmissionExportRows() {
  const allLeads = getScopedLeads(getAllLeads());
  if (shouldUseScopedServerPage()) {
    return applyLeadSorting(allLeads);
  }
  return filterLeads(allLeads);
}

function getCurrentFilteredLeads() {
  return getMainAdmissionExportRows();
}

function updateCourseFilterSelection(nextValues) {
  filter.courseName = normalizeMultiValueFilter(nextValues);
  persistFilters();
  currentPage = 1;
  renderAll();
}

function toggleCourseFilterValue(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return;
  }

  const currentValues = normalizeMultiValueFilter(filter.courseName);
  const nextValues = currentValues.includes(normalized)
    ? currentValues.filter((item) => item !== normalized)
    : [...currentValues, normalized];

  updateCourseFilterSelection(nextValues);
}

function setAllCourseFilters(leads) {
  const courses = getFixedCourseFilterOptions(leads);
  updateCourseFilterSelection(courses);
}

function clearCourseFilters() {
  updateCourseFilterSelection([]);
}

function updateCounselorFilterSelection(nextValues) {
  filter.counselor = normalizeMultiValueFilter(nextValues);
  persistFilters();
  currentPage = 1;
  renderAll();
}

function toggleCounselorFilterValue(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return;
  }

  const currentValues = normalizeMultiValueFilter(filter.counselor);
  const nextValues = currentValues.includes(normalized)
    ? currentValues.filter((item) => item !== normalized)
    : [...currentValues, normalized];

  updateCounselorFilterSelection(nextValues);
}

function setAllCounselorFilters(leads) {
  const facetCounselors = Array.isArray(scopedFacets?.counselors) ? scopedFacets.counselors : null;
  const counselors = facetCounselors || getUniqueValues(leads, "counselor");
  const options = [
    "Unassigned",
    ...(canUseLostLeadFilter ? [LOST_LEADS_COUNSELOR_FILTER] : []),
    ...counselors.filter((item) => item && item !== "Unassigned" && item !== LOST_LEADS_COUNSELOR_FILTER && (!isManager || item !== "Archived Leads"))
  ];
  updateCounselorFilterSelection(options);
}

function clearCounselorFilters() {
  updateCounselorFilterSelection([]);
}

function compareLeadLocations(a, b) {
  const locationA = getLeadLocation(a);
  const locationB = getLeadLocation(b);
  const primaryResult = locationA.localeCompare(locationB, undefined, { sensitivity: "base" });
  if (primaryResult !== 0) {
    return primaryResult;
  }

  return String(a?.createdAt || "").localeCompare(String(b?.createdAt || ""), undefined, { sensitivity: "base" });
}

function applyLeadSorting(leads) {
  const newestFirst = sortLeadsNewestFirst(leads);
  if (locationSortDirection === "asc") {
    return [...newestFirst].sort(compareLeadLocations);
  }
  if (locationSortDirection === "desc") {
    return [...newestFirst].sort((a, b) => compareLeadLocations(b, a));
  }
  return newestFirst;
}

function toggleLocationSort() {
  if (locationSortDirection === "") {
    locationSortDirection = "asc";
  } else if (locationSortDirection === "asc") {
    locationSortDirection = "desc";
  } else {
    locationSortDirection = "";
  }
  currentPage = 1;
  renderAll();
}

function getLocationSortLabel() {
  if (locationSortDirection === "asc") {
    return "Location A-Z";
  }
  if (locationSortDirection === "desc") {
    return "Location Z-A";
  }
  return "Location Sort";
}

async function exportFilteredLeads() {
  const segmentConfig = getSegmentConfig();
  let filteredLeads;
  try {
    filteredLeads = shouldUseScopedServerPage()
      ? await fetchScopedMainAdmissionExportRows()
      : getMainAdmissionExportRows();
  } catch (error) {
    showToast(error?.message || "Could not export filtered leads.", true);
    return;
  }

  const result = exportLeadRowsToExcel({
    rows: filteredLeads,
    columns: [
      { label: "Lead Import Date", getter: (lead) => lead.createdAt },
      { label: "CRM ID", getter: (lead) => lead.id },
      { label: "Name", getter: (lead) => lead.name },
      { label: "Phone Number", getter: (lead) => lead.phone || "-" },
      { label: "Email", getter: (lead) => lead.email },
      { label: "Course Name", getter: (lead) => lead.courseName || "-" },
      { label: "Location", getter: (lead) => getLeadLocation(lead) },
      { label: "Counselor", getter: (lead) => lead.counselor || "Unassigned" },
      { label: "Lead Source", getter: (lead) => getDisplayLeadSource(lead) },
      { label: "Repeat Enquiry", getter: (lead) => isRepeatEnquiryLead(lead) ? "Yes" : "No" },
      { label: "Dialed", getter: (lead) => lead.mainAdmissionDialed || "" },
      { label: "Course Pitched", getter: (lead) => lead.mainAdmissionCoursePitched || "" },
      { label: "Course Status", getter: (lead) => lead.mainAdmissionCourseStatus || "" },
      { label: "Admission", getter: (lead) => lead.mainAdmissionAdmissionStatus || "" },
      { label: "Call Status", getter: (lead) => lead.mainAdmissionCallStatus || "" }
    ],
    fileName: `main-admission-leads-${new Date().toISOString().slice(0, 10)}.xlsx`,
    sheetName: segmentConfig.label,
    summary: [
      ["Section", "Admission"],
      ["Subsection", segmentConfig.label],
      ["Timeline", getTimelineLabel()],
      ["Filtered Leads", filteredLeads.length]
    ]
  });

  if (!result.ok) {
    showToast(result.message, true);
    return;
  }

  showToast(`${segmentConfig.label} exported successfully.`, false);
}

function filterLeads(leads) {
  const selectedCourses = normalizeMultiValueFilter(filter.courseName);
  const filtered = filterLeadsByTimeline(leads).filter((lead) => {
    const isBlockedSopLead = isSopBlockedLead(lead);
    if (filter.sopFilter === SOP_FILTER_BLOCKED) {
      if (!isAdmin || !isBlockedSopLead) return false;
    } else if (isBlockedSopLead && !isAdmin) {
      return false;
    }
    const fixedCourseLabel = getFixedCrmCourseLabel(lead);
    if (!leadMatchesCounselorActivityDate(lead, filter, {
      historyFields: ["mainAdmissionActivityHistory"],
      activityFields: ["mainAdmissionDialed", "mainAdmissionCoursePitched", "mainAdmissionCourseStatus", "mainAdmissionAdmissionStatus", "mainAdmissionCallStatus"]
    })) return false;
    const location = getLeadLocation(lead);
    if (filter.search) {
      const haystack = [lead.name, lead.email, lead.phone, lead.courseName, location, lead.country, lead.counselor].join(" ").toLowerCase();
      if (!haystack.includes(filter.search.toLowerCase())) return false;
    }
    const selectedCounselors = normalizeMultiValueFilter(filter.counselor);
    if (selectedCounselors.length) {
      const hasLostLeadsSelected = selectedCounselors.includes(LOST_LEADS_COUNSELOR_FILTER);
      const otherSelectedCounselors = selectedCounselors.filter((c) => c !== LOST_LEADS_COUNSELOR_FILTER);

      let matchesFilter = false;

      if (hasLostLeadsSelected && canUseLostLeadFilter && isMainAdmissionLeadNotInterested(lead)) {
        matchesFilter = true;
      }

      if (!matchesFilter && otherSelectedCounselors.length) {
        const leadCounselorValue = lead.counselor || "Unassigned";
        const matchesCounselor = otherSelectedCounselors.includes(leadCounselorValue);
        if (matchesCounselor && !isMainAdmissionLeadNotInterested(lead)) {
          matchesFilter = true;
        }
      }

      if (!matchesFilter) return false;
    }
    if (activeSegment === DEFAULT_SEGMENT) {
      if (selectedCourses.length) {
        const courseFilterValue = fixedCourseLabel || OTHER_COURSE_FILTER_LABEL;
        if (!selectedCourses.includes(courseFilterValue)) return false;
      }
    }
    if (filter.location && filter.location !== location) return false;
    if (filter.leadSource && getLeadSourceFilterValue(lead) !== filter.leadSource) return false;
    if (filter.mainAdmissionDialed && filter.mainAdmissionDialed !== lead.mainAdmissionDialed) return false;
    if (filter.mainAdmissionCourseStatus && filter.mainAdmissionCourseStatus !== lead.mainAdmissionCourseStatus) return false;
    if (filter.mainAdmissionAdmissionStatus && filter.mainAdmissionAdmissionStatus !== lead.mainAdmissionAdmissionStatus) return false;
    if (filter.mainAdmissionCallStatus && filter.mainAdmissionCallStatus !== lead.mainAdmissionCallStatus) return false;
    if (filter.activityStatus === "Untouched" && getLeadActivityUpdateCount(lead) > 0) return false;
    if (filter.activityStatus === "Updated" && getLeadActivityUpdateCount(lead) === 0) return false;
    if (filter.latestActivity === "Inbound Not Picked" && !isLatestInboundNotPickedLead(lead)) return false;
    if (filter.repeatEnquiryStatus === "Repeat Enquiry" && !isRepeatEnquiryLead(lead)) return false;
    if (filter.repeatEnquiryStatus === "First Time" && isRepeatEnquiryLead(lead)) return false;
    if (filter.whatsappActivity && !leadMatchesWhatsappActivityFilter(lead)) return false;
    if (filter.lsqLeads === "only" && !isLsqImportedLead(lead)) return false;
    if (filter.lsqLeads === "hide" && isLsqImportedLead(lead)) return false;
    if (!leadMatchesAdvancedFilter(lead)) return false;
    return true;
  });

  return applyLeadSorting(filtered);
}

function getLeadExtraFields(lead) {
  if (lead?.metaExtraFields && typeof lead.metaExtraFields === "object") {
    return lead.metaExtraFields;
  }
  if (lead?.elementorExtraFields && typeof lead.elementorExtraFields === "object") {
    return lead.elementorExtraFields;
  }
  return {};
}

function getLeadWhatsappNumber(lead) {
  const extraFields = getLeadExtraFields(lead);
  const candidateKeys = [
    "whatsapp_phone_number",
    "whatsapp_number",
    "whatsapp_phone",
    "whatsapp",
    "wa_number",
    "wa_phone",
    "mobile_whatsapp"
  ];

  for (const key of candidateKeys) {
    const value = String(extraFields[key] || "").trim();
    if (value) {
      return value;
    }
  }

  return "";
}

function getLeadExtraFieldBucket(lead) {
  if (lead?.metaExtraFields && typeof lead.metaExtraFields === "object") {
    return "metaExtraFields";
  }
  if (lead?.elementorExtraFields && typeof lead.elementorExtraFields === "object") {
    return "elementorExtraFields";
  }
  return String(lead?.source || "").trim().toLowerCase().includes("elementor")
    ? "elementorExtraFields"
    : "metaExtraFields";
}

function isReplaceableLeadContactValue(field, value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  if (field === "name") {
    return /^mcube\s+(caller|lead)(\s+\S+)?$/i.test(String(value ?? "").trim());
  }

  if (field === "email") {
    return /^mcube-[^@\s]+@noemail\.lead$/i.test(normalized);
  }

  return false;
}

function canEditMainAdmissionDetails(lead) {
  if (isAdmin) return true;
  if (!isCounselorSession()) return false;
  return String(lead?.counselor || "").trim().toLowerCase() === getCounselorIdentity();
}

function setDetailsEditMessage(message, isError = false) {
  if (!mainAdmissionDetailsEditMessage) {
    return;
  }

  mainAdmissionDetailsEditMessage.textContent = message;
  mainAdmissionDetailsEditMessage.style.color = isError ? "var(--danger)" : "var(--success)";
}

function setDetailsActionState(lead) {
  const canEdit = canEditMainAdmissionDetails(lead);
  if (editMainAdmissionDetailsBtn) {
    editMainAdmissionDetailsBtn.classList.toggle("hidden", detailsEditMode || !canEdit);
  }
  if (saveMainAdmissionDetailsBtn) {
    saveMainAdmissionDetailsBtn.classList.toggle("hidden", !detailsEditMode || !canEdit);
  }
  if (cancelMainAdmissionDetailsEditBtn) {
    cancelMainAdmissionDetailsEditBtn.classList.toggle("hidden", !detailsEditMode || !canEdit);
  }
}

function getEditableDetailFieldValue(lead, item) {
  if (item.scope === "lead") {
    return lead?.[item.field] ?? "";
  }
  if (item.scope === "extra") {
    return getLeadExtraFields(lead)[item.field] ?? "";
  }
  return item.value ?? "";
}

function renderEditableDetailValue(lead, item) {
  const value = String(getEditableDetailFieldValue(lead, item) ?? "");
  const isProtectedContact = ["name", "email", "phone"].includes(item.field);
  const canEditValue = !isProtectedContact || isReplaceableLeadContactValue(item.field, value);
  if (item.scope === "lead" && item.field === "courseName") {
    const normalizedCourseValue = normalizeCrmCourseValue(value, { preserveUnknown: true });
    return `
      <select
        class="main-admission-details-input"
        data-detail-scope="${escapeHtml(item.scope)}"
        data-detail-field="${escapeHtml(item.field)}"
        ${canEditValue ? "" : "disabled"}
      >
        <option value="">Select</option>
        ${CRM_FIXED_COURSE_OPTIONS.map((course) => `
          <option value="${escapeHtml(course.label)}" ${normalizedCourseValue === course.label ? "selected" : ""}>${escapeHtml(course.label)}</option>
        `).join("")}
      </select>
    `;
  }
  const type = item.field === "email" ? "email" : item.field.toLowerCase().includes("phone") ? "tel" : "text";
  return `
    <input
      class="main-admission-details-input"
      type="${type}"
      value="${escapeHtml(value)}"
      data-detail-scope="${escapeHtml(item.scope)}"
      data-detail-field="${escapeHtml(item.field)}"
      ${canEditValue ? "" : "disabled"}
    />
  `;
}

function getDisplayLeadSource(lead) {
  const extraFields = getLeadExtraFields(lead);
  const sourceSignals = [
    extraFields.source_type,
    extraFields.platform,
    extraFields.utm_source,
    extraFields.referrer,
    extraFields.lead_source,
    extraFields.source,
    lead.metaAdName,
    lead.metaAdsetName,
    lead.metaCampaignName,
    lead.elementorPageUrl,
    lead.elementorFormName,
    lead.source
  ]
    .map((value) => normalizeText(value))
    .filter(Boolean)
    .join(" ");

  if (/\b(instagram|insta|ig)\b/.test(sourceSignals)) {
    return "Instagram Lead";
  }

  if (/\b(facebook|fb)\b/.test(sourceSignals)) {
    return "Facebook Lead";
  }

  if (normalizeText(lead.elementorPageUrl) || /\b(elementor|website|web|landing page|site)\b/.test(sourceSignals)) {
    return "Website Lead";
  }

  if (/\b(meta)\b/.test(sourceSignals)) {
    return "Meta Lead";
  }

  if (/\b(public course)\b/.test(sourceSignals)) {
    return "Website Lead";
  }

  return String(lead.source || "").trim() || "Unknown";
}

function getLeadSourceFilterValue(lead) {
  const extraFields = getLeadExtraFields(lead);
  const sourceSignals = [
    extraFields.source_type,
    extraFields.platform,
    extraFields.utm_source,
    extraFields.referrer,
    extraFields.lead_source,
    extraFields.source,
    lead.metaAdName,
    lead.metaAdsetName,
    lead.metaCampaignName,
    lead.elementorPageUrl,
    lead.elementorFormName,
    lead.source,
    lead.name,
    lead.email
  ]
    .map((value) => normalizeText(value))
    .filter(Boolean)
    .join(" ");

  if (
    /\b(mcube)\b/.test(sourceSignals)
    || /^mcube\s+(caller|lead)(\s+\S+)?$/i.test(String(lead?.name || "").trim())
    || /^mcube-[^@\s]+@noemail\.lead$/i.test(String(lead?.email || "").trim().toLowerCase())
  ) {
    return "mcube";
  }

  if (normalizeText(lead.elementorPageUrl) || /\b(elementor|website|web|landing page|site|public course)\b/.test(sourceSignals)) {
    return "elementor";
  }

  if (/\b(meta|facebook|fb|instagram|insta|ig)\b/.test(sourceSignals)) {
    return "meta";
  }

  return "";
}

function buildLeadDetailSections(lead) {
  const extraFields = getLeadExtraFields(lead);
  const whatsappPhone = getLeadWhatsappNumber(lead);
  const displayLeadSource = getDisplayLeadSource(lead);
  const metaSource = String(lead.source || "").toLowerCase();
  const isMetaLead = metaSource.includes("meta");
  const city = String(extraFields.city || "").trim();
  const state = String(extraFields.state || "").trim();
  const extraFieldEntries = Object.entries(extraFields)
    .filter(([key]) => ![
      "whatsapp_phone_number",
      "whatsapp_number",
      "whatsapp_phone",
      "whatsapp",
      "wa_number",
      "wa_phone",
      "mobile_whatsapp",
      "city",
      "state"
    ].includes(String(key || "").trim().toLowerCase()))
    .filter(([, value]) => String(value ?? "").trim());

  return [
    {
      title: "CRM Details",
      items: [
        { label: "CRM ID", value: lead.id },
        { label: "Lead Created Date", value: formatKolkataDisplay(lead.createdAt, "-") },
        { label: "Lead Source", value: displayLeadSource }
      ]
    },
    {
      title: "Meta Details",
      items: [
        { label: "Ad Name", value: isMetaLead ? lead.metaAdName : "" },
        { label: "Adset Name", value: isMetaLead ? lead.metaAdsetName : "" },
        { label: "Campaign Name", value: isMetaLead ? lead.metaCampaignName : "" }
      ]
    },
    {
      title: "Lead Details",
      editable: true,
      items: [
        { label: "Name", value: lead.name, scope: "lead", field: "name" },
        { label: "Phone Number", value: lead.phone, scope: "lead", field: "phone" },
        { label: "WhatsApp Phone Number", value: whatsappPhone, scope: "extra", field: "whatsapp_phone_number" },
        { label: "Email", value: lead.email, scope: "lead", field: "email" },
        { label: "Course Name", value: lead.courseName, scope: "lead", field: "courseName" },
        { label: "City", value: city, scope: "extra", field: "city" },
        { label: "State", value: state, scope: "extra", field: "state" }
      ]
    },
    extraFieldEntries.length
      ? {
          title: "Lead Qualification Details",
          editable: true,
          items: extraFieldEntries.map(([key, value]) => ({
            label: formatFieldLabel(key),
            value,
            scope: "extra",
            field: key
          }))
        }
      : null
  ].filter(Boolean);
}

function renderLeadDetailsModalLegacy(lead) {
  if (!mainAdmissionDetailsModalBody || !mainAdmissionDetailsModalTitle || !mainAdmissionDetailsModalSubtitle) {
    return;
  }

  const sections = buildLeadDetailSections(lead);
  mainAdmissionDetailsModalTitle.textContent = `${lead.name || "Lead"} Details`;
  mainAdmissionDetailsModalSubtitle.textContent = `CRM record ${lead.id || "-"} • ${lead.source || "Unknown source"}`;
  mainAdmissionDetailsModalBody.innerHTML = sections.map((section) => `
    <section class="main-admission-details-card">
      <h4>${escapeHtml(section.title)}</h4>
      <dl class="main-admission-details-list">
        ${section.items.map(([label, value]) => `
          <div class="main-admission-details-item">
            <dt>${escapeHtml(label)}</dt>
            <dd>${formatDetailValue(value)}</dd>
          </div>
        `).join("")}
      </dl>
    </section>
  `).join("");
}

function renderLeadDetailsModal(lead) {
  if (!mainAdmissionDetailsModalBody || !mainAdmissionDetailsModalTitle || !mainAdmissionDetailsModalSubtitle) {
    return;
  }

  const sections = buildLeadDetailSections(lead);
  mainAdmissionDetailsModalTitle.textContent = `${lead.name || "Lead"} Details`;
  mainAdmissionDetailsModalSubtitle.textContent = `CRM record ${lead.id || "-"} - ${lead.source || "Unknown source"}`;
  setDetailsActionState(lead);
  mainAdmissionDetailsModalBody.innerHTML = sections.map((section) => `
    <section class="main-admission-details-card">
      <h4>${escapeHtml(section.title)}</h4>
      <dl class="main-admission-details-list">
        ${section.items.map((item) => `
          <div class="main-admission-details-item">
            <dt>${escapeHtml(item.label)}</dt>
            <dd>${detailsEditMode && section.editable ? renderEditableDetailValue(lead, item) : formatDetailValue(item.value)}</dd>
          </div>
        `).join("")}
      </dl>
    </section>
  `).join("");
}

function renderActivityPanel(lead) {
  const leadKey = escapeHtml(buildLeadKey(lead));
  const leadTabUrl = escapeHtml(buildLeadTabUrl(lead));
  const isTouched = getLeadActivityUpdateCount(lead) > 0;
  return `
    <div class="activity-panel">
      <div class="activity-panel__secondary">
        ${canManagerTakeMainAdmissionLead(lead) ? `
          <button
            type="button"
            class="btn-ghost activity-panel__take-lead"
            data-main-admission-action="take-lead"
            data-lead-key="${leadKey}"
          >
            Take Lead
          </button>
        ` : ""}
        <button
          type="button"
          class="${isTouched ? "btn-update-status btn-update-status--active" : "btn-primary"} activity-panel__open-tab"
          data-main-admission-action="open-tab"
          data-lead-key="${leadKey}"
          data-lead-tab-url="${leadTabUrl}"
        >
          Open Tab
        </button>
      </div>
    </div>
  `;
}

function renderLeadTable(leads) {
  const isCrashSegment = false;
  const serverTotal = scopedPagination?.total;
  const serverTotalPages = scopedPagination?.totalPages;
  const useServerPage = shouldUseScopedServerPage();
  const totalLeadCount = useServerPage && Number.isFinite(serverTotal) ? serverTotal : leads.length;
  const totalPages = useServerPage && Number.isFinite(serverTotalPages) ? serverTotalPages : (Math.ceil(leads.length / pageSize) || 1);
  if (currentPage > totalPages) currentPage = totalPages;
  const pageLeads = useServerPage ? leads : leads.slice((currentPage - 1) * pageSize, currentPage * pageSize);  syncSelectedLeadIds(leads);
  const hasBulkPanel = isAdmin || isManager;
  const filteredSelectedCount = hasBulkPanel && filteredSelectionLimit ? Math.min(filteredSelectionLimit, totalLeadCount) : 0;
  const rowSelectedCount = hasBulkPanel ? getSelectedLeadCount(leads) : 0;
  const selectedCount = hasBulkPanel ? (filteredSelectedCount || rowSelectedCount) : 0;
  const selectedUnassignedCount = hasBulkPanel ? getSelectedAssignableLeads(leads).length : 0;
  const selectedAssignableCount = filteredSelectedCount || (filter.sopFilter === SOP_FILTER_BLOCKED
    ? getSelectedBlockedSopLeads(leads).length
    : selectedUnassignedCount);
  const allSelected = hasBulkPanel && pageLeads.length > 0 && pageLeads.every(isLeadSelected);
  const assignCounselorOptions = getActiveCounselorNames();
  const selectedCountLabel = filteredSelectedCount ? `${filteredSelectedCount} filtered` : selectedCount;
  const filteredLeadCountLabel = `${totalLeadCount} ${totalLeadCount === 1 ? "lead" : "leads"}`;
  const bulkToolbar = hasBulkPanel ? `
    <div class="bulk-toolbar">
      <label class="bulk-select-control">
        <input id="mainAdmissionBulkSelect" type="checkbox" ${allSelected ? "checked" : ""} />
        <span>Select All</span>
      </label>
      <div class="bulk-select-actions">
        <span class="selected-count">Selected: ${selectedCountLabel}</span>
        ${isAdmin ? `<button id="mainAdmissionBulkDelete" class="btn-delete bulk-delete-btn" type="button" ${rowSelectedCount ? "" : "disabled"}>Delete Selected</button>` : ""}
      </div>
      <div class="bulk-admin-tools">
        <div class="bulk-inline-group">
          <input id="mainAdmissionBulkCountInput" class="bulk-count-input" type="number" min="1" max="${totalLeadCount || 1}" placeholder="Count" />
          <button id="mainAdmissionBulkCountApply" type="button" class="btn-ghost bulk-action-btn" ${totalLeadCount ? "" : "disabled"}>Select Count</button>
          <button id="mainAdmissionSelectAllFiltered" type="button" class="btn-ghost bulk-action-btn" ${(totalLeadCount && useServerPage) ? "" : "disabled"}>Select All Filtered</button>
        </div>
        <div class="bulk-inline-group">
          <select id="mainAdmissionBulkAssignCounselor" class="bulk-assign-select">
            <option value="">Assign to</option>
            ${assignCounselorOptions.map((item) => `<option value="${escapeHtml(item)}" ${bulkAssignCounselor === item ? "selected" : ""}>${escapeHtml(item)}</option>`).join("")}
          </select>
          <button id="mainAdmissionBulkAssign" type="button" class="btn-ghost bulk-action-btn ${mainAdmissionAssignmentBusy ? "is-loading" : ""}" ${(selectedAssignableCount && bulkAssignCounselor && !mainAdmissionAssignmentBusy) ? "" : "disabled"} aria-busy="${mainAdmissionAssignmentBusy ? "true" : "false"}">${mainAdmissionAssignmentBusy ? "Assigning, please wait..." : "Assign Selected"}</button>
        </div>
      </div>
      <div class="bulk-toolbar-summary" aria-live="polite">
        <span class="bulk-toolbar-summary__label">Filtered Leads</span>
        <strong class="bulk-toolbar-summary__value">${filteredLeadCountLabel}</strong>
      </div>
    </div>
  ` : "";

  mainAdmissionLeadTableSection.innerHTML = `
    ${bulkToolbar}
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            ${hasBulkPanel ? "<th>Select</th>" : ""}
            <th>Lead Import Date</th>
            <th>${isCrashSegment ? "Full Name" : "Name"}</th>
            <th>${isCrashSegment ? "Contact Number" : "Phone Number"}</th>
            <th>${isCrashSegment ? "Mail ID" : "Email"}</th>
            <th>Course Name</th>
            <th>
              <button type="button" class="table-sort-button" data-main-admission-action="toggle-location-sort" aria-label="Sort by location">
                ${escapeHtml(getLocationSortLabel())}
              </button>
            </th>
            <th>Counselor</th>
            <th>Open Tab</th>
          </tr>
        </thead>
        <tbody>
          ${pageLeads.length ? pageLeads.map((lead) => `
            <tr>
              ${hasBulkPanel ? `<td><input type="checkbox" class="main-admission-lead-checkbox" data-lead-key="${escapeHtml(buildLeadKey(lead))}" ${selectedLeadKeys.has(buildLeadKey(lead)) ? "checked" : ""} /></td>` : ""}
              <td>${escapeHtml(formatKolkataDisplay(lead.createdAt, "-"))}</td>
              <td><div class="lead-name-cell"><span>${escapeHtml(lead.name)}</span>${renderRepeatEnquiryBadge(lead)}</div></td>
              <td>${escapeHtml(lead.phone || "-")}</td>
              <td>${escapeHtml(lead.email)}</td>
              <td>${escapeHtml(lead.courseName || "-")}</td>
              <td>${escapeHtml(getLeadLocation(lead))}</td>
              <td>${escapeHtml(lead.counselor || "Unassigned")}</td>
              <td>${renderActivityPanel(lead)}</td>
            </tr>
          `).join("") : `<tr><td colspan="${hasBulkPanel ? 9 : 8}">${
            escapeHtml(
              initialMainAdmissionLoadPending
                ? "Loading main admission leads..."
                : initialMainAdmissionLoadFailed
                  ? "Could not load the latest main admission leads. Showing fallback state."
                  : "No main admission leads available for current filters."
            )
          }</td></tr>`}
        </tbody>
      </table>
    </div>
  `;

  renderPagination(totalPages, totalLeadCount);
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

}

mainAdmissionLeadTableSection.addEventListener("click", async (event) => {
  const actionButton = event.target.closest("[data-main-admission-action]");
  if (actionButton) {
    const action = actionButton.getAttribute("data-main-admission-action");
    const leadKey = actionButton.getAttribute("data-lead-key");

    if (action === "toggle-location-sort") {
      toggleLocationSort();
      return;
    }

    if (action === "open-tab") {
      const targetUrl = actionButton.getAttribute("data-lead-tab-url");
      const lead = getAllLeads().find((item) => buildLeadKey(item) === leadKey);
      if (!targetUrl || !lead) {
        showToast("Could not open this lead tab. Please refresh and try again.", true);
        return;
      }
      cacheLeadTabSnapshot(lead, "main-admission");
      window.open(targetUrl, "_blank", "noopener");
      void trackLeadView(lead.id, lead.email || "");
      return;
    }
    if (action === "take-lead") {
      const lead = getAllLeads().find((item) => buildLeadKey(item) === leadKey);
      if (!lead) {
        showToast("Could not find this lead. Please refresh and try again.", true);
        return;
      }
      actionButton.disabled = true;
      const originalText = actionButton.textContent;
      actionButton.textContent = "Taking...";
      const result = await takeSopLead(lead.id, lead.email || "");
      if (!result?.ok) {
        actionButton.disabled = false;
        actionButton.textContent = originalText || "Take Lead";
        showToast(result?.message || "Could not take this lead.", true);
        return;
      }
      if (result.lead) {
        mergeScopedLeadUpdates(result.lead);
      }
      renderAll();
      showToast(result.message || "Lead assigned to you.", false);
      return;
    }
    if (action === "details") {
      openDetailsModal(leadKey);
      return;
    }
    if (action === "update") {
      openActivityModal(leadKey);
      return;
    }
    if (action === "call") {
      const lead = getAllLeads().find((item) => buildLeadKey(item) === leadKey);
      if (!lead) {
        showToast("Could not find this lead. Please refresh and try again.", true);
        return;
      }
      await triggerMcubeClickToCall(lead, actionButton, showToast);
      return;
    }
    if (action === "notes") {
      openNotesModal(leadKey);
      return;
    }
    if (action === "task") {
      openTaskModal(leadKey);
      return;
    }
    if (action === "activity-history") {
      const lead = getAllLeads().find((item) => buildLeadKey(item) === leadKey);
      if (lead) {
        openActivityHistory(lead.id, lead.name, lead.email);
      }
      return;
    }
    if (action === "delete") {
      await deleteRegisteredLead(leadKey);
      return;
    }
  }

  if (event.target.id === "mainAdmissionBulkDelete") {
    const viewLeads = getCurrentFilteredLeads();
    const deleted = await deleteSelectedLeads(viewLeads);
    if (deleted) {
      renderAll();
    }
    return;
  }

  if (event.target.id === "mainAdmissionBulkCountApply") {
    const bulkCountInput = document.getElementById("mainAdmissionBulkCountInput");
    const localFilteredLeads = getCurrentFilteredLeads();
    const useServerPage = shouldUseScopedServerPage();
    const totalLeadCount = useServerPage ? (Number(scopedPagination?.total) || 0) : localFilteredLeads.length;
    const selectedBatchCount = useServerPage
      ? selectFilteredLeadBatch(bulkCountInput?.value, totalLeadCount)
      : selectLeadBatch(localFilteredLeads, bulkCountInput?.value);
    if (!selectedBatchCount) {
      showToast("Enter a valid lead count to select.", true);
      return;
    }

    renderAll();
    showToast(`Selected ${selectedBatchCount} filtered lead${selectedBatchCount === 1 ? "" : "s"}.`);
    return;
  }

  if (event.target.id === "mainAdmissionSelectAllFiltered") {
    if (!shouldUseScopedServerPage()) {
      showToast("Select All Filtered is available after the filtered lead list finishes loading.", true);
      return;
    }
    const totalLeadCount = Number(scopedPagination?.total) || 0;
    const selectedBatchCount = selectFilteredLeadBatch(totalLeadCount, totalLeadCount);
    if (!selectedBatchCount) {
      showToast("No filtered leads available to select.", true);
      return;
    }

    renderAll();
    showToast(`Selected all ${selectedBatchCount} filtered lead${selectedBatchCount === 1 ? "" : "s"}.`);
    return;
  }

  if (event.target.id === "mainAdmissionBulkAssign") {
    mainAdmissionAssignmentBusy = true;
    renderLeadTable(getCurrentFilteredLeads());
    const assigned = await withButtonBusy(
      event.target,
      "Assigning, please wait...",
      () => assignSelectedUnassignedLeads(getCurrentFilteredLeads())
    ).finally(() => {
      mainAdmissionAssignmentBusy = false;
    });
    if (assigned) {
      scheduleRenderAll();
    } else {
      renderLeadTable(getCurrentFilteredLeads());
    }
    return;
  }

});

mainAdmissionLeadTableSection.addEventListener("change", (event) => {
  const target = event.target;
  if (target.classList.contains("main-admission-lead-checkbox")) {
    const key = target.getAttribute("data-lead-key");
    if (!key) return;
    toggleLeadSelection(key, target.checked);
    renderAll();
    return;
  }

  if (target.id === "mainAdmissionBulkSelect") {
    toggleAllLeadsSelection(getCurrentFilteredLeads(), target.checked);
    renderAll();
    return;
  }

  if (target.id === "mainAdmissionBulkAssignCounselor") {
    bulkAssignCounselor = target.value;
    renderAll();
  }
});

mainAdmissionPaginationSection.addEventListener("click", (event) => {
  if (event.target.id === "mainAdmissionPrevPageBtn" && currentPage > 1) {
    currentPage -= 1;
    if (scopedLoadActive) {
      void loadScopedMainAdmissionLeads().then(() => renderAll());
    } else {
      renderAll();
    }
  }
  if (event.target.id === "mainAdmissionNextPageBtn") {
    currentPage += 1;
    if (scopedLoadActive) {
      void loadScopedMainAdmissionLeads().then(() => renderAll());
    } else {
      renderAll();
    }
  }
});

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
  void trackLeadView(lead.id, lead.email || "");
}

function openDetailsModal(leadKey) {
  const lead = getAllLeads().find((item) => buildLeadKey(item) === leadKey);
  if (!lead || !mainAdmissionDetailsModal) {
    return;
  }

  detailsEditMode = false;
  setDetailsEditMessage("");
  detailsLeadRef = buildLeadRef(lead);
  renderLeadDetailsModal(lead);
  mainAdmissionDetailsModal.classList.remove("hidden");
  void trackLeadView(lead.id, lead.email || "");
}

function closeDetailsModal() {
  if (mainAdmissionDetailsModal) {
    mainAdmissionDetailsModal.classList.add("hidden");
  }
  detailsLeadRef = null;
  detailsEditMode = false;
  setDetailsEditMessage("");
}

function setDetailsEditMode(enabled) {
  const lead = findLeadByRef(detailsLeadRef);
  if (!lead) {
    return;
  }

  if (enabled && !canEditMainAdmissionDetails(lead)) {
    showToast("Only the assigned counselor can edit this lead.", true);
    return;
  }

  detailsEditMode = enabled;
  setDetailsEditMessage("");
  renderLeadDetailsModal(lead);
}

function collectDetailsModalUpdates() {
  const fields = {};
  const extraFields = {};

  mainAdmissionDetailsModalBody?.querySelectorAll("[data-detail-scope][data-detail-field]").forEach((input) => {
    const scope = input.getAttribute("data-detail-scope");
    const field = input.getAttribute("data-detail-field");
    if (!scope || !field || input.disabled) {
      return;
    }

    const value = String(input.value || "").trim();
    if (scope === "lead") {
      if (field === "email") {
        fields[field] = value.toLowerCase();
      } else if (field === "courseName") {
        fields[field] = normalizeCrmCourseValue(value);
      } else {
        fields[field] = value;
      }
    } else if (scope === "extra") {
      extraFields[field] = value;
    }
  });

  return { fields, extraFields };
}

async function saveDetailsModalEdits() {
  const lead = findLeadByRef(detailsLeadRef);
  if (!lead) {
    setDetailsEditMessage("Could not find this lead. Please refresh and try again.", true);
    return;
  }

  if (!canEditMainAdmissionDetails(lead)) {
    setDetailsEditMessage("Only the assigned counselor can edit this lead.", true);
    return;
  }

  const updates = collectDetailsModalUpdates();
  const result = await updateMainAdmissionLeadDetails(lead.id, {
    leadEmail: lead.email || "",
    fields: updates.fields,
    extraFields: updates.extraFields
  });

  if (!result || result.ok === false) {
    setDetailsEditMessage(result?.message || "Failed to save lead details.", true);
    return;
  }

  detailsEditMode = false;
  setDetailsEditMessage("Lead details saved.", false);
  const updatedLead = result.lead || findLeadByRef(detailsLeadRef);
  mergeScopedLeadUpdates(updatedLead);
  if (updatedLead) {
    detailsLeadRef = buildLeadRef(updatedLead);
  }
  renderAll();
  if (updatedLead) {
    renderLeadDetailsModal(updatedLead);
  }
  showToast("Lead details saved.");
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
    "modalMainAdmissionCallStatus",
    "modalMainAdmissionActivityNote"
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
  const noteInput = document.getElementById("modalMainAdmissionActivityNote");
  if (noteInput) {
    noteInput.value = "";
  }
}

function closeActivityModal() {
  document.getElementById("mainAdmissionActivityModal").classList.add("hidden");
  activeLeadRef = null;
  setRegisteredActivityModalMode("edit");
}

async function saveActivity(event) {
  event.preventDefault();
  const saveButton = event?.submitter || document.getElementById("saveMainAdmissionActivityBtn");
  const lead = findLeadByRef(activeLeadRef);
  if (!lead) return;

  const result = await withButtonBusy(saveButton, "Saving, please wait...", () => updateLeadActivityOnServer(lead.id, {
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
  }));

  if (!result || result.ok === false) {
    showToast(result?.message || "Failed to save lead activity.", true);
    return;
  }

  const noteInput = document.getElementById("modalMainAdmissionActivityNote");
  const noteText = noteInput ? noteInput.value.trim() : "";
  if (noteText) {
    const noteResult = await withButtonBusy(saveButton, "Saving note, please wait...", () => addLeadNote(lead.id, noteText, lead.email || ""));
    if (!noteResult || noteResult.ok === false) {
      showToast(noteResult?.message || "Activity saved, but the note could not be saved.", true);
      return;
    }
    mergeScopedLeadUpdates(noteResult.lead);
  }

  mergeScopedLeadUpdates(result.lead);
  closeActivityModal();
  setMessage("Main admission lead activity saved successfully.");
  showToast("Main admission lead activity saved successfully.");
  scheduleRenderAll();
}

async function deleteRegisteredLead(leadKey) {
  if (!isAdmin) {
    return false;
  }

  const lead = getAllLeads().find((item) => buildLeadKey(item) === leadKey);
  if (!lead) {
    showToast("Lead not found.", true);
    return false;
  }

  const confirmed = window.confirm("Delete this main admission lead? This cannot be undone.");
  if (!confirmed) {
    return false;
  }

  const deleteResult = await deleteLeadsOnServer([buildLeadRef(lead)]);
  if (!deleteResult || deleteResult.ok === false) {
    showToast(deleteResult?.message || "Failed to delete lead.", true);
    return false;
  }

  selectedLeadKeys.delete(leadKey);
  setMessage("Main admission lead deleted successfully.");
  showToast("Main admission lead deleted successfully.");
  renderAll();
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

  const deleteRefs = leads
    .filter((lead) => selectedLeadKeys.has(buildLeadKey(lead)))
    .map(buildLeadRef);
  const removedCount = deleteRefs.length;
  if (!removedCount) {
    return false;
  }

  const deleteResult = await deleteLeadsOnServer(deleteRefs);
  if (!deleteResult || deleteResult.ok === false) {
    showToast(deleteResult?.message || "Failed to delete selected leads.", true);
    return false;
  }

  selectedLeadKeys = new Set();
  currentPage = 1;
  setMessage(`Deleted ${removedCount} main admission lead${removedCount === 1 ? "" : "s"} successfully.`);
  showToast(`Deleted ${removedCount} main admission lead${removedCount === 1 ? "" : "s"} successfully.`);
  return true;
}

async function assignSelectedUnassignedLeads(leads) {
  const counselor = String(bulkAssignCounselor || "").trim();
  if (!counselor) {
    showToast("Choose a counselor before assigning leads.", true);
    return false;
  }

  if (filteredSelectionLimit > 0) {
    return assignFilteredSelectedLeads(counselor);
  }

  const selectedLeads = getSelectedLeads(leads);
  const selectedAssignableLeads = filter.sopFilter === SOP_FILTER_BLOCKED
    ? selectedLeads.filter(isSopBlockedLead)
    : getSelectedAssignableLeads(leads);
  if (!selectedAssignableLeads.length) {
    showToast(filter.sopFilter === SOP_FILTER_BLOCKED
      ? "Select at least one blocked SOP lead to assign."
      : (session?.role === "super_admin" 
          ? "Select at least one lead to use this panel."
          : (session?.role === "manager" 
              ? "Select at least one unassigned, archived, or your own lead to use this panel."
              : "Select at least one unassigned or archived lead to use this panel.")), true);
    return false;
  }

  const assignedLeadRefs = selectedAssignableLeads.map(buildLeadRef);
  const assignResult = await assignLeadsOnServer(assignedLeadRefs, counselor);
  if (!assignResult || assignResult.ok === false) {
    showToast(assignResult?.message || "Failed to assign selected leads.", true);
    return false;
  }
  mergeScopedLeadUpdates(assignResult.leads);

  const summary = formatLeadAssignmentResult(assignResult, assignedLeadRefs.length, counselor);
  const skippedAssignedCount = selectedLeads.length - selectedAssignableLeads.length;
  const skippedAssignedText = skippedAssignedCount
    ? (filter.sopFilter === SOP_FILTER_BLOCKED
      ? ` Skipped ${skippedAssignedCount} selected lead${skippedAssignedCount === 1 ? "" : "s"} that were not blocked.`
      : ` Skipped ${skippedAssignedCount} selected lead${skippedAssignedCount === 1 ? "" : "s"} that were already assigned.`)
    : "";

  selectedLeadKeys = new Set();
  bulkAssignCounselor = "";
  currentPage = 1;
  setMessage(`${summary.message}${skippedAssignedText}`);
  showToast(`${summary.message}${skippedAssignedText}`);
  return true;
}

async function assignFilteredSelectedLeads(counselor) {
  const totalLeadCount = shouldUseScopedServerPage()
    ? (Number(scopedPagination?.total) || 0)
    : getCurrentFilteredLeads().length;
  const selectionCount = Math.min(filteredSelectionLimit, totalLeadCount);
  if (!selectionCount) {
    showToast("Select filtered leads before assigning.", true);
    return false;
  }

  const confirmed = window.confirm(`Assign ${selectionCount} filtered lead${selectionCount === 1 ? "" : "s"} to ${counselor}?`);
  if (!confirmed) {
    return false;
  }

  const assignResult = await assignFilteredMainAdmissionLeads({
    filters: getScopedMainAdmissionFilterPayload({ page: 1, limit: pageSize }),
    counselor,
    limit: selectionCount
  });
  if (!assignResult || assignResult.ok === false) {
    showToast(assignResult?.message || "Failed to assign filtered leads.", true);
    return false;
  }

  const summary = formatLeadAssignmentResult(assignResult, selectionCount, counselor);
  clearBulkLeadSelection();
  bulkAssignCounselor = "";
  currentPage = 1;
  await loadScopedMainAdmissionLeads();
  setMessage(summary.message);
  showToast(summary.message);
  return true;
}

function canEditLeadNotes(lead) {
  if (isAdmin) return true;
  return String(lead?.counselor || "").trim().toLowerCase() === getCounselorIdentity();
}

async function openNotesModal(leadKey) {
  const lead = getAllLeads().find((item) => buildLeadKey(item) === leadKey);
  if (!lead) return;

  notesLeadRef = buildLeadRef(lead);
  if (!lead._notesLoaded && (!Array.isArray(lead.leadNotes) || !lead.leadNotes.length)) {
    const notesResult = await fetchLeadNotes(lead.id, lead.email || "");
    if (notesResult?.lead) {
      mergeScopedLeadUpdates(notesResult.lead);
      Object.assign(lead, notesResult.lead);
      lead._notesLoaded = true;
    } else if (notesResult && notesResult.ok === false) {
      showToast(notesResult.message || "Could not load notes for this lead.", true);
    }
  }

  const listSection = document.getElementById("mainAdmissionNotesListSection");
  const canEdit = canEditLeadNotes(lead);
  listSection.innerHTML = lead.leadNotes.length
    ? lead.leadNotes.map((note, index) => `
        <div class="note-item">
          <span class="note-text">${escapeHtml(note.text)}</span>
          <span class="note-meta">${escapeHtml(note.by || "")}${note.by && note.at ? " - " : ""}${escapeHtml(formatKolkataDateTime(note.at || "", ""))}</span>
          ${canEdit ? `<button type="button" class="btn-ghost main-admission-note-delete-btn" data-note-index="${index}" style="font-size:0.75rem;padding:2px 6px;">Delete</button>` : ""}
        </div>
      `).join("")
    : `<p class="block-help">${canEdit ? "No notes yet. Add one below." : "No notes yet."}</p>`;

  document.getElementById("mainAdmissionNewNoteInput").value = "";
  document.getElementById("mainAdmissionSaveNoteBtn").classList.toggle("hidden", !canEdit);
  document.getElementById("mainAdmissionNewNoteInput").closest(".modal-row").classList.toggle("hidden", !canEdit);
  document.getElementById("mainAdmissionNotesModal").classList.remove("hidden");
  void trackLeadView(lead.id, lead.email || "");

  document.querySelectorAll(".main-admission-note-delete-btn").forEach((button) => {
    button.onclick = async () => {
      const noteIndex = Number(button.getAttribute("data-note-index"));
      const currentLead = findLeadByRef(notesLeadRef);
      if (!currentLead) return;
      const result = await withButtonBusy(button, "Deleting...", () => deleteLeadNote(currentLead.id, noteIndex, currentLead.email || ""));
      if (!result || result.ok === false) {
        showToast(result?.message || "Failed to delete note.", true);
        return;
      }
      mergeScopedLeadUpdates(result.lead);
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

  mergeScopedLeadUpdates(result.lead);
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
  void trackLeadView(lead.id, lead.email || "");
}

async function handleTaskSubmit(event) {
  event.preventDefault();

  const leadId = mainAdmissionTaskLeadIdInput.value;
  const title = mainAdmissionTaskTitleInput.value.trim();
  const dueDate = toTaskDueDateIso(mainAdmissionTaskDueDateInput.value);

  if (!leadId || !title || !dueDate) {
    setTaskMessage("Title and due date/time are required.", true);
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

async function renderAll() {
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  const activeInputState = getActiveInputState();
  ensureFreshScopedServerPage();
  renderAdmissionSectionNav();
  renderSegmentSection();
  if (detailsLeadRef && !detailsEditMode) {
    const liveLead = findLeadByRef(detailsLeadRef);
    if (liveLead) {
      renderLeadDetailsModal(liveLead);
    } else {
      closeDetailsModal();
    }
  }
  const allLeads = getScopedLeads(getAllLeads());
  sanitizeFixedCourseFilter(allLeads);
  const filteredLeads = shouldUseScopedServerPage() ? applyLeadSorting(allLeads) : filterLeads(allLeads);
  renderRegisteredRoutingPanel();
  renderKpis(filteredLeads);
  renderFilters(allLeads);
  renderLeadTable(filteredLeads);
  restoreActiveInputState(activeInputState);
  recordMainAdmissionPerformance({
    phase: "render",
    subsection: "table-and-panels",
    durationMs: Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt),
    count: filteredLeads.length
  });
}

document.getElementById("mainAdmissionActivityForm").onsubmit = saveActivity;
document.getElementById("closeMainAdmissionModalBtn").onclick = closeActivityModal;
document.getElementById("closeMainAdmissionNotesModalBtn").onclick = closeNotesModal;
document.getElementById("mainAdmissionSaveNoteBtn").onclick = (event) => {
  void withButtonBusy(event.currentTarget, "Saving note...", () => saveNote());
};
if (mainAdmissionDetailsModal) {
  document.getElementById("closeMainAdmissionDetailsModalBtn").onclick = closeDetailsModal;
  if (editMainAdmissionDetailsBtn) {
    editMainAdmissionDetailsBtn.onclick = () => setDetailsEditMode(true);
  }
  if (cancelMainAdmissionDetailsEditBtn) {
    cancelMainAdmissionDetailsEditBtn.onclick = () => setDetailsEditMode(false);
  }
  if (saveMainAdmissionDetailsBtn) {
    saveMainAdmissionDetailsBtn.onclick = (event) => {
      void withButtonBusy(event.currentTarget, "Saving details...", () => saveDetailsModalEdits());
    };
  }
}
if (mainAdmissionTaskModal && mainAdmissionTaskForm) {
  document.getElementById("closeMainAdmissionTaskModalBtn").onclick = closeTaskModal;
  mainAdmissionTaskForm.onsubmit = handleTaskSubmit;
}

setupRegisteredRoutingPanel();
const scheduleRenderAll = createRenderScheduler(renderAll);
await renderAll();
window.__dvMarkRouteViewReady?.();
setMessage("Loading main admission leads...");

void (async () => {
  let scopedLoadSucceeded = false;
  try {
    scopedLoadSucceeded = await loadScopedMainAdmissionLeads();
    initialMainAdmissionLoadFailed = false;
    setMessage("");
  } catch (error) {
    initialMainAdmissionLoadFailed = true;
    setMessage(error?.message || "Could not load main admission leads.", true);
  } finally {
    initialMainAdmissionLoadPending = false;
  }

  await renderAll();
  await waitForPaint(2);
  recordMainAdmissionPerformance({
    phase: "interactive-ready",
    subsection: scopedLoadSucceeded ? "scoped-leads" : "full-state-fallback",
    durationMs: getPerformanceDuration(),
    success: !initialMainAdmissionLoadFailed,
    message: scopedLoadSucceeded ? "scoped" : "full-state-fallback"
  });
})();

const stopStatePolling = startMainAdmissionPolling(() => {
  void scheduleRenderAll();
});
registerPageCleanup(stopStatePolling);

document.addEventListener("click", (event) => {
  let needsRerender = false;

  if (isCourseFilterOpen) {
    const courseFilterEl = document.getElementById("mainAdmissionCourseMultiFilter");
    if (courseFilterEl && !courseFilterEl.contains(event.target)) {
      isCourseFilterOpen = false;
      needsRerender = true;
    }
  }

  if (isCounselorFilterOpen) {
    const counselorFilterEl = document.getElementById("mainAdmissionCounselorMultiFilter");
    if (counselorFilterEl && !counselorFilterEl.contains(event.target)) {
      isCounselorFilterOpen = false;
      needsRerender = true;
    }
  }

  if (needsRerender) {
    renderAll();
  }
});
// await refreshState();
// btn-mcube-call
// if (activeSegment === DEFAULT_SEGMENT && !fixedCourseLabel) return false;
// selectedCourses.length && !selectedCourses.includes(fixedCourseLabel)
// function applyLeadSorting(leads) { return sortLeadsNewestFirst(leads); }
// (leadPipeline || "").trim().toLowerCase() === "main-admission"
// Select at least one unassigned lead to use this panel
// <option value="Unassigned" ${filter.counselor === "Unassigned" ? "selected" : ""}>Unassigned</option>
// getLeadIdsByActivityTypes
