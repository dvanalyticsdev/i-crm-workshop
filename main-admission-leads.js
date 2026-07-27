import { registerPageCleanup } from "./page-runtime.js";
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
  deleteLeadNote,
  deleteLeads as deleteLeadsOnServer,
  formatLeadAssignmentResult,
  trackLeadView,
  updateLeadActivity as updateLeadActivityOnServer,
  updateMainAdmissionLeadDetails
} from "./lead-service.js";

await bootstrapLocalState();

const session = getSession();
const isAdmin = session?.role === "admin" || session?.role === "super_admin";
const canUseLeadRowActions = !isAdmin;
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
  timeline: isCounselorSession() ? "overall" : "week",
  startDate: "",
  endDate: "",
  search: "",
  leadOwner: isCounselorSession() ? "direct" : "all",
  counselor: "",
  courseName: [],
  location: "",
  mainAdmissionDialed: "",
  mainAdmissionCourseStatus: "",
  mainAdmissionAdmissionStatus: "",
  mainAdmissionCallStatus: "",
  activityStatus: "",
  repeatEnquiryStatus: "",
  whatsappActivity: "",
  lsqLeads: ""
};
const WHATSAPP_ACTIVITY_FILTER_OPTIONS = ["WhatsApp Read", "WhatsApp Clicked", "WhatsApp Replied"];

const persistedFilter = await loadLocalPreference(FILTER_STORAGE_KEY, {});
if (persistedFilter.timeline === "daily") {
  persistedFilter.timeline = "today";
}
let filter = { ...DEFAULT_FILTER, ...persistedFilter };
filter.leadOwner = ["all", "direct", "reassigned"].includes(String(filter.leadOwner || "").trim())
  ? String(filter.leadOwner || "").trim()
  : DEFAULT_FILTER.leadOwner;
filter.courseName = normalizeMultiValueFilter(filter.courseName);
filter.location = normalizeLocationLabel(filter.location);
if (isCounselorSession() && (!persistedFilter.timeline || persistedFilter.timeline === "week")) {
  filter.timeline = "overall";
}
let currentPage = 1;
const pageSize = 50;
let selectedLeadKeys = new Set();
let bulkAssignCounselor = "";
let activeLeadRef = null;
let notesLeadRef = null;
let detailsLeadRef = null;
let detailsEditMode = false;
let mainAdmissionActivityModalMode = "edit";
let activeSegment = DEFAULT_SEGMENT;
let locationSortDirection = "";
let isCourseFilterOpen = false;
populateCrmCourseSelect("modalMainAdmissionCoursePitched", { includeNo: true });

function persistFilters() {
  void saveLocalPreference(FILTER_STORAGE_KEY, filter);
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

function toLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

function getCanonicalCourseIdentity(lead = {}) {
  return getCanonicalPublicCourseIdentity([
    lead?.courseRawName,
    lead?.courseName,
    lead?.courseId,
    lead?.courseCode,
    lead?.metaAdName,
    lead?.metaAdsetName,
    lead?.metaCampaignName,
    lead?.elementorFormName,
    lead?.elementorPageUrl
  ]);
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
    lead.courseName = canonicalCourse.label || String(lead.courseName || "").trim();
    lead.courseKey = canonicalCourse.key || String(lead.courseKey || "").trim();
    lead.createdAt = lead.createdAt || toLocalDateKey();
    lead.mainAdmissionDialed = lead.mainAdmissionDialed || "";
    lead.mainAdmissionCoursePitched = normalizeCrmCourseValue(lead.mainAdmissionCoursePitched, { allowNo: true, preserveUnknown: true });
    lead.mainAdmissionCourseStatus = lead.mainAdmissionCourseStatus || "";
    lead.mainAdmissionAdmissionStatus = lead.mainAdmissionAdmissionStatus || "";
    lead.mainAdmissionCallStatus = lead.mainAdmissionCallStatus || "";
    lead.mainAdmissionActivityUpdated = typeof lead.mainAdmissionActivityUpdated === "boolean" ? lead.mainAdmissionActivityUpdated : false;
    lead.mainAdmissionActivityHistory = Array.isArray(lead.mainAdmissionActivityHistory) ? lead.mainAdmissionActivityHistory : [];
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
  if (typeof lead?.mainAdmissionActivityTouchedByAssignee === "boolean") {
    return lead.mainAdmissionActivityTouchedByAssignee ? 1 : 0;
  }

  if (typeof lead?.mainAdmissionActivityUpdated === "boolean") {
    return lead.mainAdmissionActivityUpdated ? 1 : 0;
  }

  return hasAssigneeActivityHistory(lead?.mainAdmissionActivityHistory) ? 1 : 0;
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

function getSelectableLeadKeys(leads) {
  return leads.map((lead) => buildLeadKey(lead));
}

function isUnassignedCounselor(value) {
  return String(value || "").trim().toLowerCase() === "unassigned";
}

function getSelectedLeads(leads) {
  return leads.filter((lead) => selectedLeadKeys.has(buildLeadKey(lead)));
}

function getSelectedUnassignedLeads(leads) {
  return getSelectedLeads(leads).filter((lead) => isUnassignedCounselor(lead?.counselor));
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

  selectedLeadKeys = new Set(getSelectableLeadKeys(leads).slice(0, count));
  return count;
}

function findLeadByRef(leadRef) {
  const leads = getAllRegisteredCandidateLeads();
  return leads.find((lead) => buildLeadKey(lead) === buildLeadKey(leadRef)) || null;
}

function getUniqueValues(leads, key) {
  return [...new Set(leads.map((lead) => String(lead[key] || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function parseTimelineDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const dateOnlyMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

function formatReadableDate(date) {
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function getTimelineRange() {
  const now = new Date();

  if (filter.timeline === "overall") {
    return null;
  }

  if (filter.timeline === "today") {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    return { start, end };
  }

  if (filter.timeline === "yesterday") {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59, 999);
    return { start, end };
  }

  if (filter.timeline === "week") {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    return { start, end };
  }

  const start = parseTimelineDate(filter.startDate);
  const endBase = parseTimelineDate(filter.endDate);
  if (!start || !endBase || start > endBase) {
    return { start: null, end: null };
  }

  const end = new Date(endBase.getFullYear(), endBase.getMonth(), endBase.getDate(), 23, 59, 59, 999);
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
  const registeredLeads = getAllRegisteredCandidateLeads().filter((lead) => getLeadSegment(lead) === activeSegment);
  const confirmed = window.confirm(`Clear only ${segmentConfig.label} data?`);
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

  const syncResult = await syncStateFromLocalAndVerify();
  if (!syncResult.ok) {
    setRoutingMessage(syncResult.message || "Main Admission Lead data was updated locally, but backend verification failed.", true);
    return;
  }

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
  const locations = [...new Set(leads.map((lead) => getLeadLocation(lead)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const selectedCourses = normalizeMultiValueFilter(filter.courseName);
  const allCoursesSelected = courses.length > 0 && selectedCourses.length === courses.length;
  const courseTriggerLabel = !selectedCourses.length
    ? "All"
    : allCoursesSelected
      ? `All (${selectedCourses.length})`
      : selectedCourses.length === 1
        ? selectedCourses[0]
        : `${selectedCourses.length} selected`;

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
      </div>
    </div>

    <div class="filter-section">
      <div class="filter-section-title">Lead Search & Ownership</div>
      <div class="filter-row">
        <div class="filter-item filter-item--search">
          <label for="mainAdmissionSearchInput">Search Lead</label>
          <input id="mainAdmissionSearchInput" type="text" placeholder="Name, email, phone, course, counselor" value="${escapeHtml(filter.search)}" />
        </div>
        <div class="filter-item">
          <label for="mainAdmissionLeadOwnerSelect">Lead Owner</label>
          <select id="mainAdmissionLeadOwnerSelect">
            <option value="all" ${filter.leadOwner === "all" ? "selected" : ""}>All Leads</option>
            <option value="direct" ${filter.leadOwner === "direct" ? "selected" : ""}>Directly Assigned</option>
            <option value="reassigned" ${filter.leadOwner === "reassigned" ? "selected" : ""}>Assigned From Someone Else</option>
          </select>
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
  `;

  document.getElementById("mainAdmissionTimelineSelect").onchange = (event) => {
    filter.timeline = event.target.value;
    persistFilters();
    currentPage = 1;
    document.getElementById("mainAdmissionStartDateWrap").classList.toggle("hidden", filter.timeline !== "custom");
    document.getElementById("mainAdmissionEndDateWrap").classList.toggle("hidden", filter.timeline !== "custom");
    renderAll();
  };
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
  document.getElementById("mainAdmissionSearchInput").onkeydown = (event) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    filter.search = event.target.value.trim();
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
  if (isAdmin) {
    document.getElementById("mainAdmissionCounselorSelect").onchange = (event) => {
      filter.counselor = event.target.value;
      persistFilters();
      currentPage = 1;
      renderAll();
    };
  }
  const courseTrigger = document.getElementById("mainAdmissionCourseTrigger");
  if (courseTrigger) {
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
    isCourseFilterOpen = false;
    persistFilters();
    currentPage = 1;
    void renderAll();
  };

  document.getElementById("mainAdmissionExportBtn").onclick = () => {
    exportFilteredLeads();
  };
}

function getMainAdmissionExportRows() {
  const allLeads = getScopedLeads(getAllLeads());
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
  const courses = getUniqueValues(leads, "courseName");
  updateCourseFilterSelection(courses);
}

function clearCourseFilters() {
  updateCourseFilterSelection([]);
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
  if (locationSortDirection !== "asc" && locationSortDirection !== "desc") {
    return leads;
  }

  const sorted = [...leads].sort(compareLeadLocations);
  return locationSortDirection === "desc" ? sorted.reverse() : sorted;
}

function getLocationSortLabel() {
  if (locationSortDirection === "asc") {
    return "Location ↑";
  }
  if (locationSortDirection === "desc") {
    return "Location ↓";
  }
  return "Location ↕";
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

function exportFilteredLeads() {
  const segmentConfig = getSegmentConfig();
  const filteredLeads = getMainAdmissionExportRows();
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
    const location = getLeadLocation(lead);
    if (filter.search) {
      const haystack = [lead.name, lead.email, lead.phone, lead.courseName, location, lead.country, lead.counselor].join(" ").toLowerCase();
      if (!haystack.includes(filter.search.toLowerCase())) return false;
    }
    if (filter.counselor && filter.counselor !== lead.counselor) return false;
    if (activeSegment === DEFAULT_SEGMENT) {
      if (selectedCourses.length && !selectedCourses.includes(lead.courseName)) return false;
    }
    if (filter.location && filter.location !== location) return false;
    if (filter.mainAdmissionDialed && filter.mainAdmissionDialed !== lead.mainAdmissionDialed) return false;
    if (filter.mainAdmissionCourseStatus && filter.mainAdmissionCourseStatus !== lead.mainAdmissionCourseStatus) return false;
    if (filter.mainAdmissionAdmissionStatus && filter.mainAdmissionAdmissionStatus !== lead.mainAdmissionAdmissionStatus) return false;
    if (filter.mainAdmissionCallStatus && filter.mainAdmissionCallStatus !== lead.mainAdmissionCallStatus) return false;
    if (filter.activityStatus === "Untouched" && getLeadActivityUpdateCount(lead) > 0) return false;
    if (filter.activityStatus === "Updated" && getLeadActivityUpdateCount(lead) === 0) return false;
    if (filter.repeatEnquiryStatus === "Repeat Enquiry" && !isRepeatEnquiryLead(lead)) return false;
    if (filter.repeatEnquiryStatus === "First Time" && isRepeatEnquiryLead(lead)) return false;
    if (filter.whatsappActivity && !leadMatchesWhatsappActivityFilter(lead)) return false;
    if (filter.lsqLeads === "only" && !isLsqImportedLead(lead)) return false;
    if (filter.lsqLeads === "hide" && isLsqImportedLead(lead)) return false;
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
        { label: "Lead Created Date", value: lead.createdAt },
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
  const hasActivity = getLeadActivityUpdateCount(lead) > 0;
  const leadKey = escapeHtml(buildLeadKey(lead));
  const noteCount = lead.leadNotes.length;
  const primaryActions = canUseLeadRowActions
    ? `
        <button
          type="button"
          class="btn-ghost btn-mcube-call activity-panel__icon-btn"
          data-main-admission-action="call"
          data-lead-key="${leadKey}"
          aria-label="Call"
          title="Call"
          ${lead.phone ? "" : "disabled"}
        >
          <span aria-hidden="true">&#9742;</span>
        </button>
        <button
          type="button"
          class="btn-update-status${hasActivity ? " btn-update-status--active" : ""} activity-panel__icon-btn"
          data-main-admission-action="update"
          data-lead-key="${leadKey}"
          aria-label="Update"
          title="Update"
        >
          <span aria-hidden="true">&#9998;</span>
        </button>
      `
    : "";
  const notesAction = canUseLeadRowActions
    ? `<button type="button" class="btn-ghost btn-notes activity-panel__link" data-main-admission-action="notes" data-lead-key="${leadKey}">Notes${noteCount ? ` (${noteCount})` : ""}</button>`
    : "";
  return `
    <div class="activity-panel">
      <div class="activity-panel__primary">
        ${primaryActions}
      </div>
      <div class="activity-panel__secondary">
        <button type="button" class="btn-ghost activity-panel__link" data-main-admission-action="details" data-lead-key="${leadKey}">View Details</button>
        ${canCreateTasks ? `<button type="button" class="btn-ghost btn-task activity-panel__link" data-main-admission-action="task" data-lead-key="${leadKey}">Task</button>` : ""}
        ${notesAction}
        <button type="button" class="btn-ghost btn-activity-history activity-panel__link" data-main-admission-action="activity-history" data-lead-key="${leadKey}">Activity</button>
        ${isAdmin ? `<button type="button" class="btn-delete activity-panel__link" data-main-admission-action="delete" data-lead-key="${leadKey}">Delete</button>` : ""}
      </div>
    </div>
  `;
}

function renderLeadTable(leads) {
  const isCrashSegment = false;
  const totalPages = Math.ceil(leads.length / pageSize) || 1;
  if (currentPage > totalPages) currentPage = totalPages;
  const pageLeads = leads.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  syncSelectedLeadIds(leads);
  const selectedCount = isAdmin ? getSelectedLeadCount(leads) : 0;
  const selectedUnassignedCount = isAdmin ? getSelectedUnassignedLeads(leads).length : 0;
  const allSelected = isAdmin && pageLeads.length > 0 && pageLeads.every(isLeadSelected);
  const assignCounselorOptions = getActiveCounselorNames();
  const bulkToolbar = isAdmin ? `
    <div class="bulk-toolbar">
      <label class="bulk-select-control">
        <input id="mainAdmissionBulkSelect" type="checkbox" ${allSelected ? "checked" : ""} />
        <span>Select All</span>
      </label>
      <div class="bulk-select-actions">
        <span class="selected-count">Selected: ${selectedCount}</span>
        <button id="mainAdmissionBulkDelete" class="btn-delete bulk-delete-btn" type="button" ${selectedCount ? "" : "disabled"}>Delete Selected</button>
      </div>
      <div class="bulk-admin-tools">
        <div class="bulk-inline-group">
          <input id="mainAdmissionBulkCountInput" class="bulk-count-input" type="number" min="1" max="${leads.length || 1}" placeholder="Count" />
          <button id="mainAdmissionBulkCountApply" type="button" class="btn-ghost bulk-action-btn" ${leads.length ? "" : "disabled"}>Select Count</button>
        </div>
        <div class="bulk-inline-group">
          <select id="mainAdmissionBulkAssignCounselor" class="bulk-assign-select">
            <option value="">Assign to</option>
            ${assignCounselorOptions.map((item) => `<option value="${escapeHtml(item)}" ${bulkAssignCounselor === item ? "selected" : ""}>${escapeHtml(item)}</option>`).join("")}
          </select>
          <button id="mainAdmissionBulkAssign" type="button" class="btn-ghost bulk-action-btn" ${(selectedUnassignedCount && bulkAssignCounselor) ? "" : "disabled"}>Assign Selected</button>
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
            <th>
              <button
                type="button"
                class="table-sort-button"
                id="mainAdmissionLocationSortBtn"
                aria-label="Sort by location"
              >
                ${getLocationSortLabel()}
              </button>
            </th>
            <th>Counselor</th>
            <th>Activity</th>
          </tr>
        </thead>
        <tbody>
          ${pageLeads.length ? pageLeads.map((lead) => `
            <tr>
              ${isAdmin ? `<td><input type="checkbox" class="main-admission-lead-checkbox" data-lead-key="${escapeHtml(buildLeadKey(lead))}" ${selectedLeadKeys.has(buildLeadKey(lead)) ? "checked" : ""} /></td>` : ""}
              <td>${escapeHtml(lead.createdAt)}</td>
              <td><div class="lead-name-cell"><span>${escapeHtml(lead.name)}</span>${renderRepeatEnquiryBadge(lead)}</div></td>
              <td>${escapeHtml(lead.phone || "-")}</td>
              <td>${escapeHtml(lead.email)}</td>
              <td>${escapeHtml(lead.courseName || "-")}</td>
              <td>${escapeHtml(getLeadLocation(lead))}</td>
              <td>${escapeHtml(lead.counselor || "Unassigned")}</td>
              <td>${renderActivityPanel(lead)}</td>
            </tr>
          `).join("") : `<tr><td colspan="${isAdmin ? 9 : 8}">No main admission leads available for current filters.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;

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

}

mainAdmissionLeadTableSection.addEventListener("click", async (event) => {
  const actionButton = event.target.closest("[data-main-admission-action]");
  if (actionButton) {
    const action = actionButton.getAttribute("data-main-admission-action");
    const leadKey = actionButton.getAttribute("data-lead-key");

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

  if (event.target.closest("#mainAdmissionLocationSortBtn")) {
    toggleLocationSort();
    return;
  }

  if (event.target.id === "mainAdmissionBulkCountApply") {
    const bulkCountInput = document.getElementById("mainAdmissionBulkCountInput");
    const selectedBatchCount = selectLeadBatch(getCurrentFilteredLeads(), bulkCountInput?.value);
    if (!selectedBatchCount) {
      showToast("Enter a valid lead count to select.", true);
      return;
    }

    renderAll();
    showToast(`Selected ${selectedBatchCount} lead${selectedBatchCount === 1 ? "" : "s"}.`);
    return;
  }

  if (event.target.id === "mainAdmissionBulkAssign") {
    const assigned = await assignSelectedUnassignedLeads(getCurrentFilteredLeads());
    if (assigned) {
      renderAll();
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
    renderAll();
  }
  if (event.target.id === "mainAdmissionNextPageBtn") {
    currentPage += 1;
    renderAll();
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

  const noteInput = document.getElementById("modalMainAdmissionActivityNote");
  const noteText = noteInput ? noteInput.value.trim() : "";
  if (noteText) {
    const noteResult = await addLeadNote(lead.id, noteText, lead.email || "");
    if (!noteResult || noteResult.ok === false) {
      showToast(noteResult?.message || "Activity saved, but the note could not be saved.", true);
      return;
    }
  }

  closeActivityModal();
  setMessage("Main admission lead activity saved successfully.");
  showToast("Main admission lead activity saved successfully.");
  renderAll();
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

  const selectedLeads = getSelectedLeads(leads);
  const selectedUnassignedLeads = selectedLeads.filter((lead) => isUnassignedCounselor(lead?.counselor));
  if (!selectedUnassignedLeads.length) {
    showToast("Select at least one unassigned lead to use this panel.", true);
    return false;
  }

  const assignedLeadRefs = selectedUnassignedLeads.map(buildLeadRef);
  const assignResult = await assignLeadsOnServer(assignedLeadRefs, counselor);
  if (!assignResult || assignResult.ok === false) {
    showToast(assignResult?.message || "Failed to assign selected leads.", true);
    return false;
  }

  const summary = formatLeadAssignmentResult(assignResult, assignedLeadRefs.length, counselor);
  const skippedAssignedCount = selectedLeads.length - selectedUnassignedLeads.length;
  const skippedAssignedText = skippedAssignedCount
    ? ` Skipped ${skippedAssignedCount} selected lead${skippedAssignedCount === 1 ? "" : "s"} that were already assigned.`
    : "";

  selectedLeadKeys = new Set();
  bulkAssignCounselor = "";
  currentPage = 1;
  setMessage(`${summary.message}${skippedAssignedText}`);
  showToast(`${summary.message}${skippedAssignedText}`);
  return true;
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
  void trackLeadView(lead.id, lead.email || "");

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
  const activeInputState = getActiveInputState();
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
  const filteredLeads = filterLeads(allLeads);
  renderRegisteredRoutingPanel();
  renderKpis(filteredLeads);
  renderFilters(allLeads);
  renderLeadTable(filteredLeads);
  restoreActiveInputState(activeInputState);
}

document.getElementById("mainAdmissionActivityForm").onsubmit = saveActivity;
document.getElementById("closeMainAdmissionModalBtn").onclick = closeActivityModal;
document.getElementById("closeMainAdmissionNotesModalBtn").onclick = closeNotesModal;
document.getElementById("mainAdmissionSaveNoteBtn").onclick = () => {
  void saveNote();
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
    saveMainAdmissionDetailsBtn.onclick = () => {
      void saveDetailsModalEdits();
    };
  }
}
if (mainAdmissionTaskModal && mainAdmissionTaskForm) {
  document.getElementById("closeMainAdmissionTaskModalBtn").onclick = closeTaskModal;
  mainAdmissionTaskForm.onsubmit = handleTaskSubmit;
}

setupRegisteredRoutingPanel();
void renderAll();
window.__dvMarkRouteViewReady?.();
const stopStatePolling = startStatePolling(() => {
  void renderAll();
});
registerPageCleanup(stopStatePolling);
