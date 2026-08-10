import { registerPageCleanup } from "./page-runtime.js";
import { apiUrl } from "./api-client.js";
import { openActivityHistory } from "./activity-history.js";
import { exportLeadRowsToExcel } from "./lead-export.js";
import {
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
} from "./state-sync.js";
import { createTask, TASK_CATEGORY, toTaskDueDateIso } from "./task-service.js";
import { triggerMcubeClickToCall } from "./mcube-call-service.js";
import { addLeadNote, deleteLeadNote, deleteLeads as deleteLeadsOnServer, trackLeadView, updateLeadActivity as updateLeadActivityOnServer } from "./lead-service.js";
import { formatKolkataDate, formatKolkataDateTime, formatKolkataDisplay, getKolkataDayRange, parseKolkataDate as parseTimelineDate, toKolkataDateKey } from "./date-utils.js";
import {
  bindCounselorActivityDateFilter,
  COUNSELOR_ACTIVITY_DATE_DEFAULTS,
  leadMatchesCounselorActivityDate,
  renderCounselorActivityDateFilter
} from "./counselor-activity-filter.js";
import { createRenderScheduler, withButtonBusy } from "./ui-feedback.js";

await bootstrapLocalState({ skipStateRefresh: true });

const session = getSession();
const isAdmin = session?.role === "admin" || session?.role === "super_admin";
const canUseLeadRowActions = !isAdmin;
const canCreateTasks = session?.role === "counselor" || session?.role === "manager";

const registeredRoutingPanel = document.getElementById("registeredRoutingPanel");
const registeredRoutingOptions = document.getElementById("registeredRoutingOptions");
const saveRegisteredRoutingBtn = document.getElementById("saveRegisteredRoutingBtn");
const clearRegisteredCandidateDataBtn = document.getElementById("clearRegisteredCandidateDataBtn");
const registeredRoutingMessage = document.getElementById("registeredRoutingMessage");
const admissionSectionNav = document.getElementById("admissionSectionNav");
const registeredSegmentSection = document.getElementById("registeredSegmentSection");
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

registeredFilterBar.classList.add("filter-bar--crm");

const FILTER_STORAGE_KEY = "dvRegisteredCandidatesFilters";
const PUBLIC_COURSE_ROUTING_ENDPOINT = apiUrl("/api/public-course-routing");
const DEFAULT_SEGMENT = "standard";
const CRASH_SEGMENT = "crash-course";
const SEGMENT_CONFIG = {
  [DEFAULT_SEGMENT]: {
    key: DEFAULT_SEGMENT,
    label: "Main Registered Candidates",
    description: "All standard public landing-page registrations except the 7-Day Crash Course.",
    clearLabel: "Registered Candidate",
    courseId: ""
  },
  [CRASH_SEGMENT]: {
    key: CRASH_SEGMENT,
    label: "7-Day Crash Course",
    description: "Dedicated subsection for the 7 Days Gen AI & Agentic AI Hands-on Master Program.",
    clearLabel: "7-Day Crash Course",
    courseId: "days7_genai"
  }
};
const DEFAULT_FILTER = {
  timeline: isCounselorSession() ? "overall" : "week",
  startDate: "",
  endDate: "",
  ...COUNSELOR_ACTIVITY_DATE_DEFAULTS,
  search: "",
  leadOwner: isCounselorSession() ? "direct" : "all",
  counselor: "",
  courseName: "",
  location: "",
  registeredDialed: "",
  registeredCourseStatus: "",
  registeredAdmissionStatus: "",
  registeredCallStatus: "",
  activityStatus: "",
  latestActivity: "",
  repeatEnquiryStatus: "",
  whatsappActivity: ""
};
const WHATSAPP_ACTIVITY_FILTER_OPTIONS = ["WhatsApp Read", "WhatsApp Clicked", "WhatsApp Replied"];

const persistedFilter = await loadLocalPreference(FILTER_STORAGE_KEY, {});
if (persistedFilter.timeline === "daily") {
  persistedFilter.timeline = "today";
}
if (persistedFilter.latestActivity === "Inbound Received") {
  persistedFilter.latestActivity = "Inbound Not Picked";
}
let filter = { ...DEFAULT_FILTER, ...persistedFilter };
filter.leadOwner = ["all", "direct", "reassigned"].includes(String(filter.leadOwner || "").trim())
  ? String(filter.leadOwner || "").trim()
  : DEFAULT_FILTER.leadOwner;
if (isCounselorSession() && (!persistedFilter.timeline || persistedFilter.timeline === "week")) {
  filter.timeline = "overall";
}
let currentPage = 1;
const pageSize = 50;
let selectedLeadKeys = new Set();
let activeLeadRef = null;
let notesLeadRef = null;
let registeredRoutingConfig = { selectedCounselors: [], isConfigured: false };
let registeredActivityModalMode = "edit";
let activeSegment = normalizeSegment(window.location.hash.replace(/^#/, "")) || DEFAULT_SEGMENT;
let scopedRegisteredCandidateLeads = null;
let scopedRegisteredCandidateCounselors = null;
let scopedRegisteredPagination = null;
let scopedRegisteredCounts = null;
let scopedRegisteredFacets = null;
let scopedRegisteredCandidateActive = false;
let draftRegisteredSearch = filter.search;
let scopedRegisteredReloadTimer = null;
populateCrmCourseSelect("modalRegisteredCoursePitched", { includeNo: true });

function persistFilters() {
  void saveLocalPreference(FILTER_STORAGE_KEY, filter);
  if (scopedRegisteredCandidateActive || Array.isArray(scopedRegisteredCandidateLeads)) {
    window.clearTimeout(scopedRegisteredReloadTimer);
    scopedRegisteredReloadTimer = window.setTimeout(() => {
      void loadScopedRegisteredCandidates().then(() => renderAll());
    }, 150);
  }
}

function getRegisteredCandidateSourceLeads() {
  return Array.isArray(scopedRegisteredCandidateLeads) ? scopedRegisteredCandidateLeads : getStoredLeads();
}

function getRegisteredCandidateCounselors() {
  return Array.isArray(scopedRegisteredCandidateCounselors) ? scopedRegisteredCandidateCounselors : getStoredCounselors();
}

function mergeScopedRegisteredLeadUpdates(leads) {
  if (!Array.isArray(scopedRegisteredCandidateLeads)) {
    return;
  }
  const updates = (Array.isArray(leads) ? leads : [leads]).filter(Boolean);
  if (!updates.length) {
    return;
  }
  const byId = new Map(updates.map((lead) => [String(lead.id), lead]));
  const seen = new Set();
  scopedRegisteredCandidateLeads = scopedRegisteredCandidateLeads.map((lead) => {
    const patch = byId.get(String(lead?.id));
    if (!patch) return lead;
    seen.add(String(lead.id));
    return { ...lead, ...patch };
  });
  updates.forEach((lead) => {
    const key = String(lead.id);
    if (!seen.has(key) && isRegisteredCandidateLead(lead)) {
      scopedRegisteredCandidateLeads.push(lead);
    }
  });
  normalizeLeadFields(scopedRegisteredCandidateLeads);
}

function removeScopedRegisteredLeads(leads) {
  if (!Array.isArray(scopedRegisteredCandidateLeads)) {
    return;
  }
  const ids = new Set((Array.isArray(leads) ? leads : [leads]).filter(Boolean).map((lead) => String(lead.id)));
  if (!ids.size) {
    return;
  }
  scopedRegisteredCandidateLeads = scopedRegisteredCandidateLeads.filter((lead) => !ids.has(String(lead?.id)));
}

async function loadScopedRegisteredCandidates() {
  try {
    const params = new URLSearchParams({
      section: "registered-candidates",
      segment: activeSegment,
      page: String(currentPage),
      limit: String(pageSize)
    });
    if (!scopedRegisteredFacets) {
      params.set("includeFacets", "1");
    }
    [
      "search",
      "timeline",
      "startDate",
      "endDate",
      "counselorActivityTimeline",
      "counselorActivityStartDate",
      "counselorActivityEndDate",
      "leadOwner",
      "counselor",
      "location",
      "registeredDialed",
      "registeredCourseStatus",
      "registeredAdmissionStatus",
      "registeredCallStatus",
      "activityStatus",
      "latestActivity",
      "repeatEnquiryStatus",
      "whatsappActivity"
    ].forEach((key) => {
      const value = String(filter?.[key] || "").trim();
      if (value) params.set(key, value);
    });
    if (activeSegment === DEFAULT_SEGMENT && filter.courseName) {
      params.set("courseName", filter.courseName);
    }
    const response = await fetch(apiUrl(`/api/leads/scoped?${params.toString()}`), {
      credentials: "same-origin",
      headers: { Accept: "application/json" }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.message || "Registered Candidates scoped loading failed.");
    }
    scopedRegisteredCandidateLeads = Array.isArray(payload?.leads) ? payload.leads : [];
    scopedRegisteredCandidateCounselors = Array.isArray(payload?.counselors) ? payload.counselors : [];
    scopedRegisteredPagination = payload?.pagination || null;
    scopedRegisteredCounts = payload?.counts || null;
    scopedRegisteredFacets = payload?.facets || scopedRegisteredFacets || null;
    scopedRegisteredCandidateActive = true;
    normalizeLeadFields(scopedRegisteredCandidateLeads);
    return true;
  } catch (error) {
    console.warn("[registered-candidates] Scoped loading failed, falling back to full state:", error?.message || error);
    scopedRegisteredCandidateLeads = null;
    scopedRegisteredCandidateCounselors = null;
    scopedRegisteredPagination = null;
    scopedRegisteredCounts = null;
    scopedRegisteredFacets = null;
    scopedRegisteredCandidateActive = false;
    return false;
  }
}

function startRegisteredCandidatePolling(onRefresh, intervalMs = 15000) {
  let destroyed = false;
  let activePoll = false;

  async function poll() {
    if (destroyed || activePoll || document.visibilityState === "hidden") {
      return;
    }
    activePoll = true;
    try {
      await loadScopedRegisteredCandidates();
      await onRefresh();
    } catch (error) {
      console.warn("[registered-candidates] polling failed:", error?.message || error);
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

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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

  const history = Array.isArray(lead?.registeredCourseActivityHistory) ? lead.registeredCourseActivityHistory : [];
  const latestEntry = getLatestHistoryEntry(history);
  return getActivityLabel(latestEntry) === selectedActivity;
}

function leadMatchesWhatsappActivityFilter(lead) {
  return leadMatchesWhatsappActivity(lead, filter.whatsappActivity);
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

function getLatestLeadActivityTimestamp(lead) {
  return getEntryTimestamp(getLatestHistoryEntry(lead?.registeredCourseActivityHistory));
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
  return session?.role === "counselor" || session?.role === "manager";
}

function getCounselorIdentity() {
  if (!isCounselorSession()) {
    return "";
  }

  const sessionEmail = String(session?.email || "").trim().toLowerCase();
  const counselors = getRegisteredCandidateCounselors();
  const match = counselors.find((item) => String(item.email || "").trim().toLowerCase() === sessionEmail);
  return String(match?.name || session?.name || "").trim().toLowerCase();
}

function isRegisteredCandidateLead(lead) {
  return String(lead?.leadPipeline || "").trim().toLowerCase() === "course-registration";
}

function normalizeSegment(segment) {
  return String(segment || "").trim().toLowerCase() === CRASH_SEGMENT ? CRASH_SEGMENT : DEFAULT_SEGMENT;
}

function getSegmentConfig(segment = activeSegment) {
  return SEGMENT_CONFIG[normalizeSegment(segment)];
}

function getLeadSegment(lead) {
  const publicCourseSegment = String(lead?.publicCourseSegment || "").trim().toLowerCase();
  if (publicCourseSegment === CRASH_SEGMENT) {
    return CRASH_SEGMENT;
  }

  return String(lead?.courseId || "").trim() === SEGMENT_CONFIG[CRASH_SEGMENT].courseId
    ? CRASH_SEGMENT
    : DEFAULT_SEGMENT;
}

function getActiveCounselorNames() {
  return [...new Set(
    getRegisteredCandidateCounselors()
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
    lead.createdAt = lead.createdAt || toKolkataDateKey();
    lead.registeredDialed = lead.registeredDialed || "";
    lead.registeredCoursePitched = normalizeCrmCourseValue(lead.registeredCoursePitched, { allowNo: true, preserveUnknown: true });
    lead.registeredCourseStatus = lead.registeredCourseStatus || "";
    lead.registeredAdmissionStatus = lead.registeredAdmissionStatus || "";
    lead.registeredCallStatus = lead.registeredCallStatus || "";
    lead.registeredActivityUpdated = typeof lead.registeredActivityUpdated === "boolean" ? lead.registeredActivityUpdated : false;
    lead.registeredCourseActivityHistory = Array.isArray(lead.registeredCourseActivityHistory) ? lead.registeredCourseActivityHistory : [];
    lead.registeredActivityTouchedByAssignee = typeof lead.registeredActivityTouchedByAssignee === "boolean"
      ? lead.registeredActivityTouchedByAssignee
      : lead.registeredActivityUpdated || hasAssigneeActivityHistory(lead.registeredCourseActivityHistory);
    lead.registeredCourseActivityUpdates = lead.registeredActivityTouchedByAssignee
      ? Math.max(
          1,
          Number.isFinite(Number(lead.registeredCourseActivityUpdates)) ? Number(lead.registeredCourseActivityUpdates) : 0
        )
      : 0;
    lead.leadNotes = Array.isArray(lead.leadNotes) ? lead.leadNotes : [];
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
  if (lead?.lsqImported !== true) {
    const counselor = String(lead?.counselor || "").trim().toLowerCase();
    if (!counselor || counselor === "unassigned") {
      return 0;
    }
  }

  if (typeof lead?.registeredActivityTouchedByAssignee === "boolean") {
    return lead.registeredActivityTouchedByAssignee ? 1 : 0;
  }

  if (typeof lead?.registeredActivityUpdated === "boolean") {
    return lead.registeredActivityUpdated ? 1 : 0;
  }

  return hasAssigneeActivityHistory(lead?.registeredCourseActivityHistory) ? 1 : 0;
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
  const leads = getRegisteredCandidateSourceLeads().filter(isRegisteredCandidateLead);
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
  if (!registeredRoutingMessage) {
    return;
  }

  registeredRoutingMessage.textContent = message;
  registeredRoutingMessage.style.color = isError ? "var(--danger)" : "var(--success)";
}

function getScopedLeads(leads) {
  if (!isCounselorSession() || session?.role === "manager") {
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

function buildLeadTabUrl(lead) {
  const params = new URLSearchParams({
    leadId: String(lead?.id || "").trim(),
    leadEmail: String(lead?.email || "").trim().toLowerCase(),
    stage: "registered-course"
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

function buildRoutingEndpoint(segment = activeSegment) {
  return `${PUBLIC_COURSE_ROUTING_ENDPOINT}?segment=${encodeURIComponent(normalizeSegment(segment))}`;
}

function renderSegmentSection() {
  if (!registeredSegmentSection) {
    return;
  }
  registeredSegmentSection.innerHTML = "";
  registeredSegmentSection.classList.add("hidden");
}

function renderAdmissionSectionNav(activeRoute = "registered-candidates.html") {
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
      route: "registered-candidates.html",
      segment: DEFAULT_SEGMENT,
      label: "Main Registered Candidates",
      description: "Manage standard public landing-page registrations except the 7-Day Crash Course."
    },
    {
      route: "registered-candidates.html",
      segment: CRASH_SEGMENT,
      label: "7-Day Crash Course",
      description: "Manage the isolated 7-Day Crash Course registration pipeline."
    }
  ];

  const activeDescription = activeSegment === CRASH_SEGMENT
    ? sections.find((section) => section.segment === CRASH_SEGMENT)?.description
    : sections.find((section) => section.segment === DEFAULT_SEGMENT)?.description;

  admissionSectionNav.innerHTML = `
    <div class="card-head">
      <h3>Admission Subsections</h3>
      <p>Use this section to switch between admission-related pages and registered-candidate pipelines.</p>
    </div>
    <div class="filter-actions" style="display:flex;gap:0.75rem;flex-wrap:wrap;">
      ${sections.map((section) => `
        <button
          type="button"
          class="${(section.route === "main-admission-leads.html" && activeRoute === section.route) || (section.segment && activeSegment === section.segment) ? "btn-primary" : "btn-ghost"}"
          data-admission-section="${section.route}"
          ${section.segment ? `data-admission-segment="${section.segment}"` : ""}
        >
          ${escapeHtml(section.label)}
        </button>
      `).join("")}
    </div>
    <p class="block-help">${escapeHtml(activeDescription || "")}</p>
  `;

  admissionSectionNav.querySelectorAll("[data-admission-section]").forEach((button) => {
    button.onclick = () => {
      const route = button.getAttribute("data-admission-section");
      const segment = button.getAttribute("data-admission-segment");
      if (segment) {
        const nextSegment = normalizeSegment(segment);
        if (nextSegment === activeSegment) {
          return;
        }
        activeSegment = nextSegment;
        window.location.hash = nextSegment;
        selectedLeadKeys = new Set();
        currentPage = 1;
        setRoutingMessage("");
        void loadRegisteredRoutingConfig();
        renderAll();
        return;
      }
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

function renderRegisteredRoutingPanel() {
  if (!registeredRoutingPanel || !registeredRoutingOptions) {
    return;
  }

  if (!isAdmin) {
    registeredRoutingPanel.classList.add("hidden");
    return;
  }

  registeredRoutingPanel.classList.remove("hidden");
  const segmentConfig = getSegmentConfig();
  const panelTitle = registeredRoutingPanel.querySelector(".card-head h3");
  const panelDescription = registeredRoutingPanel.querySelector(".card-head p");
  const panelHelp = registeredRoutingPanel.querySelector(".block-help");
  if (panelTitle) {
    panelTitle.textContent = `${segmentConfig.label} Routing`;
  }
  if (panelDescription) {
    panelDescription.textContent = `Choose which counselors receive ${segmentConfig.label.toLowerCase()} registrations. New registrations are assigned in round robin order only.`;
  }
  if (panelHelp) {
    panelHelp.textContent = `Clear Data removes only ${segmentConfig.label} leads and resets this routing setup. Other CRM lead sections stay unchanged.`;
  }
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
    const response = await fetch(buildRoutingEndpoint(), {
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
    const response = await withButtonBusy(saveRegisteredRoutingBtn, "Saving routing...", () => fetch(buildRoutingEndpoint(), {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({ segment: activeSegment, selectedCounselors, isConfigured: true })
    }));
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
    setRoutingMessage(`${getSegmentConfig().label} routing saved successfully.`);
    showToast(`${getSegmentConfig().label} routing saved.`);
  } catch {
    setRoutingMessage("Failed to save registered candidate routing.", true);
  }
}

async function clearRegisteredCandidateData() {
  const segmentConfig = getSegmentConfig();
  const currentTotal = scopedRegisteredCounts?.total ?? getAllRegisteredCandidateLeads().filter((lead) => getLeadSegment(lead) === activeSegment).length;
  const confirmed = window.confirm(`Clear only ${segmentConfig.label} data and reset its routing setup?`);
  if (!confirmed) {
    return;
  }

  const saveResult = await withButtonBusy(
    clearRegisteredCandidateDataBtn,
    "Clearing data...",
    async () => {
      const params = new URLSearchParams({
        section: "registered-candidates",
        segment: activeSegment
      });
      const response = await fetch(apiUrl(`/api/leads/scoped?${params.toString()}`), {
        method: "DELETE",
        credentials: "same-origin",
        headers: { Accept: "application/json" }
      });
      const payload = await response.json().catch(() => ({}));
      return response.ok ? { ok: true, ...payload } : { ok: false, message: payload?.message || "Failed to clear Registered Candidate data." };
    }
  );
  if (!saveResult || saveResult.ok === false) {
    setRoutingMessage(saveResult?.message || "Failed to clear Registered Candidate data.", true);
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
      setRoutingMessage(json?.message || "Registered Candidate leads were cleared, but routing reset failed.", true);
      return;
    }
  } catch {
    setRoutingMessage("Registered Candidate leads were cleared, but routing reset failed.", true);
    return;
  }

  registeredRoutingConfig = { selectedCounselors: [], isConfigured: false };
  selectedLeadKeys = new Set();
  currentPage = 1;
  scopedRegisteredFacets = null;
  await loadScopedRegisteredCandidates();
  renderRegisteredRoutingPanel();
  renderAll();
  const deletedCount = Number(saveResult.deletedCount ?? currentTotal) || 0;
  setRoutingMessage(`Cleared ${deletedCount} ${segmentConfig.clearLabel} lead${deletedCount === 1 ? "" : "s"}.`);
  showToast(`${segmentConfig.label} data cleared.`);
}

function renderKpis(leads) {
  const counts = scopedRegisteredCandidateActive && scopedRegisteredCounts ? scopedRegisteredCounts : null;
  const total = counts ? Number(counts.total || 0) : leads.length;
  const interested = counts ? Number(counts.interested || 0) : leads.filter((lead) => lead.registeredCourseStatus === "Interested").length;
  const enrolled = counts ? Number(counts.enrolled || 0) : leads.filter((lead) => lead.registeredAdmissionStatus === "Enrolled").length;
  const won = counts ? Number(counts.won || 0) : leads.filter((lead) => lead.registeredAdmissionStatus === "Won").length;

  registeredKpiSection.innerHTML = `
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
  const facetCounselors = Array.isArray(scopedRegisteredFacets?.counselors) ? scopedRegisteredFacets.counselors : null;
  const facetCourses = Array.isArray(scopedRegisteredFacets?.courses) ? scopedRegisteredFacets.courses : null;
  const facetLocations = Array.isArray(scopedRegisteredFacets?.locations) ? scopedRegisteredFacets.locations : null;
  const counselors = facetCounselors || getUniqueValues(leads, "counselor");
  const courses = facetCourses || getUniqueValues(leads, "courseName");
  const locations = facetLocations || getUniqueValues(leads, "country");

  registeredFilterBar.innerHTML = `
    <div class="filter-section">
      <div class="filter-section-title">Timeline</div>
      <div class="filter-row">
        <div class="filter-item">
          <label for="registeredTimelineSelect">Timeline</label>
          <select id="registeredTimelineSelect">
            <option value="overall" ${filter.timeline === "overall" ? "selected" : ""}>Overall</option>
            <option value="today" ${filter.timeline === "today" ? "selected" : ""}>Today</option>
            <option value="yesterday" ${filter.timeline === "yesterday" ? "selected" : ""}>Yesterday</option>
            <option value="week" ${filter.timeline === "week" ? "selected" : ""}>Week</option>
            <option value="custom" ${filter.timeline === "custom" ? "selected" : ""}>Custom</option>
          </select>
        </div>
        <div class="filter-item ${filter.timeline === "custom" ? "" : "hidden"}" id="registeredStartDateWrap">
          <label for="registeredStartDate">Start Date</label>
          <input id="registeredStartDate" type="date" value="${escapeHtml(filter.startDate)}" />
        </div>
        <div class="filter-item ${filter.timeline === "custom" ? "" : "hidden"}" id="registeredEndDateWrap">
          <label for="registeredEndDate">End Date</label>
          <input id="registeredEndDate" type="date" value="${escapeHtml(filter.endDate)}" />
        </div>
        ${renderCounselorActivityDateFilter({ prefix: "registered", filter, escapeHtml })}
      </div>
    </div>

    <div class="filter-section">
      <div class="filter-section-title">Lead Search & Ownership</div>
      <div class="filter-row">
        <div class="filter-item filter-item--search">
          <label for="registeredSearchInput">Search Lead</label>
          <input id="registeredSearchInput" type="text" placeholder="Name, email, phone, course, counselor" value="${escapeHtml(draftRegisteredSearch)}" />
        </div>
        <div class="filter-item">
          <label for="registeredLeadOwnerSelect">Lead Owner</label>
          <select id="registeredLeadOwnerSelect">
            <option value="all" ${filter.leadOwner === "all" ? "selected" : ""}>All Leads</option>
            <option value="direct" ${filter.leadOwner === "direct" ? "selected" : ""}>Directly Assigned</option>
            <option value="reassigned" ${filter.leadOwner === "reassigned" ? "selected" : ""}>Assigned From Someone Else</option>
          </select>
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
      </div>
    </div>

    <div class="filter-section">
      <div class="filter-section-title">Lead Details</div>
      <div class="filter-row">
        ${activeSegment === DEFAULT_SEGMENT ? `
        <div class="filter-item">
          <label for="registeredCourseSelect">Course Name</label>
          <select id="registeredCourseSelect">
            <option value="">All</option>
            ${courses.map((item) => `<option value="${escapeHtml(item)}" ${filter.courseName === item ? "selected" : ""}>${escapeHtml(item)}</option>`).join("")}
          </select>
        </div>
        ` : ""}
        <div class="filter-item">
          <label for="registeredLocationSelect">${activeSegment === CRASH_SEGMENT ? "Location" : "Country"}</label>
          <select id="registeredLocationSelect">
            <option value="">All</option>
            ${locations.map((item) => `<option value="${escapeHtml(item)}" ${filter.location === item ? "selected" : ""}>${escapeHtml(item)}</option>`).join("")}
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
      </div>
    </div>

    <div class="filter-section">
      <div class="filter-section-title">Pipeline Status</div>
      <div class="filter-row">
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
            <option value="Opportunity" ${filter.registeredAdmissionStatus === "Opportunity" ? "selected" : ""}>Opportunity</option>
            <option value="Offered" ${filter.registeredAdmissionStatus === "Offered" ? "selected" : ""}>Offered</option>
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
          <label for="registeredActivityStatusSelect">Untouched Leads</label>
          <select id="registeredActivityStatusSelect">
            <option value="">Use Filter</option>
            <option value="Untouched" ${filter.activityStatus === "Untouched" ? "selected" : ""}>Untouched</option>
            <option value="Updated" ${filter.activityStatus === "Updated" ? "selected" : ""}>Updated</option>
          </select>
        </div>
        <div class="filter-item">
          <label for="registeredLatestActivitySelect">Latest Activity</label>
          <select id="registeredLatestActivitySelect">
            <option value="">Use Filter</option>
            <option value="Inbound Not Picked" ${filter.latestActivity === "Inbound Not Picked" ? "selected" : ""}>Inbound Not Picked</option>
          </select>
        </div>
        <div class="filter-item">
          <label for="registeredWhatsappActivitySelect">WhatsApp Activity</label>
          <select id="registeredWhatsappActivitySelect">
            <option value="">All</option>
            ${WHATSAPP_ACTIVITY_FILTER_OPTIONS.map((item) => `<option value="${escapeHtml(item)}" ${filter.whatsappActivity === item ? "selected" : ""}>${escapeHtml(item)}</option>`).join("")}
          </select>
        </div>
        <div class="filter-item">
          <label for="registeredRepeatEnquirySelect">Repeat Enquiry</label>
          <select id="registeredRepeatEnquirySelect">
            <option value="">All</option>
            <option value="Repeat Enquiry" ${filter.repeatEnquiryStatus === "Repeat Enquiry" ? "selected" : ""}>Repeat Enquiry</option>
            <option value="First Time" ${filter.repeatEnquiryStatus === "First Time" ? "selected" : ""}>First Time</option>
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
            <button id="registeredExportBtn" type="button" class="btn-primary">Export Leads</button>
            <button id="registeredResetFiltersBtn" type="button" class="btn-ghost">Reset</button>
          </div>
        </div>
      </div>
    </div>
  `;

  document.getElementById("registeredTimelineSelect").onchange = (event) => {
    filter.timeline = event.target.value;
    persistFilters();
    currentPage = 1;
    document.getElementById("registeredStartDateWrap").classList.toggle("hidden", filter.timeline !== "custom");
    document.getElementById("registeredEndDateWrap").classList.toggle("hidden", filter.timeline !== "custom");
    renderAll();
  };
  bindCounselorActivityDateFilter({
    prefix: "registered",
    filter,
    persist: persistFilters,
    render: renderAll,
    resetPage: () => {
      currentPage = 1;
    }
  });
  const startDateInput = document.getElementById("registeredStartDate");
  if (startDateInput) {
    startDateInput.onchange = (event) => {
      filter.startDate = event.target.value;
      persistFilters();
      currentPage = 1;
      renderAll();
    };
  }
  const endDateInput = document.getElementById("registeredEndDate");
  if (endDateInput) {
    endDateInput.onchange = (event) => {
      filter.endDate = event.target.value;
      persistFilters();
      currentPage = 1;
      renderAll();
    };
  }
  const searchInput = document.getElementById("registeredSearchInput");
  searchInput.oninput = (event) => {
    draftRegisteredSearch = event.target.value;
  };
  searchInput.onkeydown = (event) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    draftRegisteredSearch = event.target.value;
    filter.search = draftRegisteredSearch.trim();
    persistFilters();
    currentPage = 1;
    renderAll();
  };
  document.getElementById("registeredLeadOwnerSelect").onchange = (event) => {
    filter.leadOwner = event.target.value;
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
  const courseSelect = document.getElementById("registeredCourseSelect");
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
  document.getElementById("registeredLocationSelect").onchange = (event) => {
    filter.location = event.target.value;
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
  document.getElementById("registeredLatestActivitySelect").onchange = (event) => {
    filter.latestActivity = event.target.value;
    persistFilters();
    currentPage = 1;
    renderAll();
  };
  document.getElementById("registeredWhatsappActivitySelect").onchange = (event) => {
    filter.whatsappActivity = event.target.value;
    persistFilters();
    currentPage = 1;
    renderAll();
  };
  document.getElementById("registeredRepeatEnquirySelect").onchange = (event) => {
    filter.repeatEnquiryStatus = event.target.value;
    persistFilters();
    currentPage = 1;
    renderAll();
  };
  document.getElementById("registeredResetFiltersBtn").onclick = () => {
    filter = { ...DEFAULT_FILTER };
    draftRegisteredSearch = filter.search;
    persistFilters();
    currentPage = 1;
    renderAll();
  };

  document.getElementById("registeredExportBtn").onclick = () => {
    exportFilteredLeads();
  };
}

function getRegisteredExportRows() {
  const allLeads = getScopedLeads(getAllLeads());
  return filterLeads(allLeads);
}

function exportFilteredLeads() {
  const segmentConfig = getSegmentConfig();
  const filteredLeads = getRegisteredExportRows();
  const result = exportLeadRowsToExcel({
    rows: filteredLeads,
    columns: [
      { label: "Lead Import Date", getter: (lead) => lead.createdAt },
      { label: "CRM ID", getter: (lead) => lead.id },
      { label: activeSegment === CRASH_SEGMENT ? "Full Name" : "Name", getter: (lead) => lead.name },
      { label: activeSegment === CRASH_SEGMENT ? "Contact Number" : "Phone Number", getter: (lead) => lead.phone || "-" },
      { label: activeSegment === CRASH_SEGMENT ? "Mail ID" : "Email", getter: (lead) => lead.email },
      { label: "Course Name", getter: (lead) => lead.courseName || "-" },
      { label: activeSegment === CRASH_SEGMENT ? "Location" : "Country", getter: (lead) => lead.country || "India" },
      { label: "Counselor", getter: (lead) => lead.counselor || "Unassigned" },
      { label: "Repeat Enquiry", getter: (lead) => isRepeatEnquiryLead(lead) ? "Yes" : "No" },
      { label: "Dialed", getter: (lead) => lead.registeredDialed || "" },
      { label: "Course Pitched", getter: (lead) => lead.registeredCoursePitched || "" },
      { label: "Course Status", getter: (lead) => lead.registeredCourseStatus || "" },
      { label: "Admission", getter: (lead) => lead.registeredAdmissionStatus || "" },
      { label: "Call Status", getter: (lead) => lead.registeredCallStatus || "" }
    ],
    fileName: `${segmentConfig.key}-leads-${new Date().toISOString().slice(0, 10)}.xlsx`,
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
  const filtered = filterLeadsByTimeline(leads).filter((lead) => {
    if (!leadMatchesCounselorActivityDate(lead, filter, {
      historyFields: ["registeredCourseActivityHistory"],
      activityFields: ["registeredDialed", "registeredCoursePitched", "registeredCourseStatus", "registeredAdmissionStatus", "registeredCallStatus"]
    })) return false;
    if (filter.search) {
      const haystack = [lead.name, lead.email, lead.phone, lead.courseName, lead.country, lead.counselor].join(" ").toLowerCase();
      if (!haystack.includes(filter.search.toLowerCase())) return false;
    }
    if (filter.counselor && filter.counselor !== lead.counselor) return false;
    if (activeSegment === DEFAULT_SEGMENT && filter.courseName && filter.courseName !== lead.courseName) return false;
    if (filter.location && filter.location !== (lead.country || "")) return false;
    if (filter.registeredDialed && filter.registeredDialed !== lead.registeredDialed) return false;
    if (filter.registeredCourseStatus && filter.registeredCourseStatus !== lead.registeredCourseStatus) return false;
    if (filter.registeredAdmissionStatus && filter.registeredAdmissionStatus !== lead.registeredAdmissionStatus) return false;
    if (filter.registeredCallStatus && filter.registeredCallStatus !== lead.registeredCallStatus) return false;
    if (filter.activityStatus === "Untouched" && getLeadActivityUpdateCount(lead) > 0) return false;
    if (filter.activityStatus === "Updated" && getLeadActivityUpdateCount(lead) === 0) return false;
    if (filter.latestActivity === "Inbound Not Picked" && !isLatestInboundNotPickedActivity(lead?.registeredCourseActivityHistory)) return false;
    if (filter.whatsappActivity && !leadMatchesWhatsappActivityFilter(lead)) return false;
    if (filter.repeatEnquiryStatus === "Repeat Enquiry" && !isRepeatEnquiryLead(lead)) return false;
    if (filter.repeatEnquiryStatus === "First Time" && isRepeatEnquiryLead(lead)) return false;
    return true;
  });

  return sortLeadsNewestFirst(filtered);
}

function renderActivityPanel(lead) {
  const leadKey = escapeHtml(buildLeadKey(lead));
  const leadTabUrl = escapeHtml(buildLeadTabUrl(lead));
  const isTouched = getLeadActivityUpdateCount(lead) > 0;
  return `
    <div class="activity-panel">
      <div class="activity-panel__secondary">
        <button type="button" class="${isTouched ? "btn-update-status btn-update-status--active" : "btn-primary"} activity-panel__open-tab" data-registered-action="open-tab" data-lead-key="${leadKey}" data-lead-tab-url="${leadTabUrl}">Open Tab</button>
      </div>
    </div>
  `;
}

function renderLeadTable(leads) {
  const isCrashSegment = activeSegment === CRASH_SEGMENT;
  const serverTotal = scopedRegisteredPagination?.total;
  const serverTotalPages = scopedRegisteredPagination?.totalPages;
  const totalLeadCount = Number.isFinite(serverTotal) ? serverTotal : leads.length;
  const totalPages = Number.isFinite(serverTotalPages) ? serverTotalPages : (Math.ceil(leads.length / pageSize) || 1);
  if (currentPage > totalPages) currentPage = totalPages;
  const pageLeads = scopedRegisteredCandidateActive && scopedRegisteredPagination ? leads : leads.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  syncSelectedLeadIds(leads);
  const selectedCount = isAdmin ? getSelectedLeadCount(leads) : 0;
  const allSelected = isAdmin && pageLeads.length > 0 && pageLeads.every(isLeadSelected);

  const bulkToolbar = isAdmin ? `
    <div class="bulk-toolbar">
      <label class="bulk-select-control">
        <input id="registeredBulkSelect" type="checkbox" ${allSelected ? "checked" : ""} />
        <span>Select All</span>
      </label>
      <div class="bulk-select-actions">
        <span class="selected-count">Selected: ${selectedCount}</span>
        <button id="registeredBulkDelete" class="btn-delete bulk-delete-btn" type="button" ${selectedCount ? "" : "disabled"}>Delete Selected</button>
      </div>
      <div class="bulk-admin-tools">
        <div class="bulk-inline-group">
          <input id="registeredBulkCountInput" class="bulk-count-input" type="number" min="1" max="${leads.length || 1}" placeholder="Count" />
          <button id="registeredBulkCountApply" type="button" class="btn-ghost bulk-action-btn" ${leads.length ? "" : "disabled"}>Select Count</button>
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
            <th>${isCrashSegment ? "Full Name" : "Name"}</th>
            <th>${isCrashSegment ? "Contact Number" : "Phone Number"}</th>
            <th>${isCrashSegment ? "Mail ID" : "Email"}</th>
            <th>Course Name</th>
            <th>${isCrashSegment ? "Location" : "Country"}</th>
            <th>Counselor</th>
            <th>Open Tab</th>
          </tr>
        </thead>
        <tbody>
          ${pageLeads.length ? pageLeads.map((lead) => `
            <tr>
              ${isAdmin ? `<td><input type="checkbox" class="registered-lead-checkbox" data-lead-key="${escapeHtml(buildLeadKey(lead))}" ${selectedLeadKeys.has(buildLeadKey(lead)) ? "checked" : ""} /></td>` : ""}
              <td>${escapeHtml(formatKolkataDisplay(lead.createdAt, "-"))}</td>
              <td><div class="lead-name-cell"><span>${escapeHtml(lead.name)}</span>${renderRepeatEnquiryBadge(lead)}</div></td>
              <td>${escapeHtml(lead.phone || "-")}</td>
              <td>${escapeHtml(lead.email)}</td>
              <td>${escapeHtml(lead.courseName || "-")}</td>
              <td>${escapeHtml(lead.country || "India")}</td>
              <td>${escapeHtml(lead.counselor || "Unassigned")}</td>
              <td>${renderActivityPanel(lead)}</td>
            </tr>
          `).join("") : `<tr><td colspan="${isAdmin ? 9 : 8}">No registered candidates available for current filters.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;

  document.querySelectorAll("[data-registered-action='open-tab']").forEach((button) => {
    button.onclick = () => {
      const targetUrl = button.getAttribute("data-lead-tab-url");
      const leadKey = button.getAttribute("data-lead-key");
      const lead = getAllLeads().find((item) => buildLeadKey(item) === leadKey);
      if (!targetUrl || !lead) {
        showToast("Could not open this lead tab. Please refresh and try again.", true);
        return;
      }
      cacheLeadTabSnapshot(lead, "registered-course");
      window.open(targetUrl, "_blank", "noopener");
      void trackLeadView(lead.id, lead.email || "");
    };
  });
  document.querySelectorAll(".registered-lead-checkbox").forEach((checkbox) => {
    checkbox.onchange = () => {
      const key = checkbox.getAttribute("data-lead-key");
      if (!key) return;
      toggleLeadSelection(key, checkbox.checked);
      renderAll();
    };
  });

  const bulkSelect = document.getElementById("registeredBulkSelect");
  if (bulkSelect) {
    bulkSelect.onchange = () => {
      toggleAllLeadsSelection(leads, bulkSelect.checked);
      renderAll();
    };
  }

  const bulkDelete = document.getElementById("registeredBulkDelete");
  if (bulkDelete) {
    bulkDelete.onclick = () => {
      void deleteSelectedLeads(leads).then((deleted) => {
        if (deleted) {
          renderAll();
        }
      });
    };
  }

  const bulkCountApply = document.getElementById("registeredBulkCountApply");
  const bulkCountInput = document.getElementById("registeredBulkCountInput");
  if (bulkCountApply && bulkCountInput) {
    bulkCountApply.onclick = () => {
      const selectedBatchCount = selectLeadBatch(leads, bulkCountInput.value);
      if (!selectedBatchCount) {
        showToast("Enter a valid lead count to select.", true);
        return;
      }

      renderAll();
      showToast(`Selected ${selectedBatchCount} lead${selectedBatchCount === 1 ? "" : "s"}.`);
    };
  }

  renderPagination(totalPages, totalLeadCount);
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
    if (scopedRegisteredCandidateActive) {
      void loadScopedRegisteredCandidates().then(() => renderAll());
    } else {
      renderAll();
    }
  };
  document.getElementById("registeredNextPageBtn").onclick = () => {
    currentPage += 1;
    if (scopedRegisteredCandidateActive) {
      void loadScopedRegisteredCandidates().then(() => renderAll());
    } else {
      renderAll();
    }
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
  void trackLeadView(lead.id, lead.email || "");
}

function openActivityDetailsModal(leadKey) {
  const lead = getAllLeads().find((item) => buildLeadKey(item) === leadKey);
  if (!lead) return;

  activeLeadRef = buildLeadRef(lead);
  setRegisteredActivityModalMode("view");
  populateActivityModal(lead);
  document.getElementById("registeredActivityModal").classList.remove("hidden");
  void trackLeadView(lead.id, lead.email || "");
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
    "modalRegisteredCallStatus",
    "modalRegisteredActivityNote"
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
  const noteInput = document.getElementById("modalRegisteredActivityNote");
  if (noteInput) {
    noteInput.value = "";
  }
}

function closeActivityModal() {
  document.getElementById("registeredActivityModal").classList.add("hidden");
  activeLeadRef = null;
  setRegisteredActivityModalMode("edit");
}

async function saveActivity(event) {
  event.preventDefault();
  const saveButton = event?.submitter || document.getElementById("saveRegisteredActivityBtn");
  const lead = findLeadByRef(activeLeadRef);
  if (!lead) return;

  const result = await withButtonBusy(saveButton, "Saving, please wait...", () => updateLeadActivityOnServer(lead.id, {
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
  }));

  if (!result || result.ok === false) {
    showToast(result?.message || "Failed to save lead activity.", true);
    return;
  }
  mergeScopedRegisteredLeadUpdates(result.lead || result.leads);

  const noteInput = document.getElementById("modalRegisteredActivityNote");
  const noteText = noteInput ? noteInput.value.trim() : "";
  if (noteText) {
    const noteResult = await withButtonBusy(saveButton, "Saving note, please wait...", () => addLeadNote(lead.id, noteText, lead.email || ""));
    if (!noteResult || noteResult.ok === false) {
      showToast(noteResult?.message || "Activity saved, but the note could not be saved.", true);
      return;
    }
    mergeScopedRegisteredLeadUpdates(noteResult.lead || noteResult.leads);
  }

  closeActivityModal();
  setMessage("Registered candidate activity saved successfully.");
  showToast("Registered candidate activity saved successfully.");
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

  const confirmed = window.confirm("Delete this registered lead? This cannot be undone.");
  if (!confirmed) {
    return false;
  }

  const deleteResult = await deleteLeadsOnServer([buildLeadRef(lead)]);
  if (!deleteResult || deleteResult.ok === false) {
    showToast(deleteResult?.message || "Failed to delete lead.", true);
    return false;
  }

  selectedLeadKeys.delete(leadKey);
  removeScopedRegisteredLeads(lead);
  setMessage("Registered lead deleted successfully.");
  showToast("Registered lead deleted successfully.");
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

  const leadsToDelete = leads.filter((lead) => selectedLeadKeys.has(buildLeadKey(lead)));
  const deleteRefs = leadsToDelete.map(buildLeadRef);
  const removedCount = deleteRefs.length;
  if (!removedCount) {
    return false;
  }

  const deleteResult = await deleteLeadsOnServer(deleteRefs);
  if (!deleteResult || deleteResult.ok === false) {
    showToast(deleteResult?.message || "Failed to delete selected leads.", true);
    return false;
  }

  removeScopedRegisteredLeads(leadsToDelete);
  selectedLeadKeys = new Set();
  currentPage = 1;
  setMessage(`Deleted ${removedCount} registered lead${removedCount === 1 ? "" : "s"} successfully.`);
  showToast(`Deleted ${removedCount} registered lead${removedCount === 1 ? "" : "s"} successfully.`);
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
  const listSection = document.getElementById("registeredNotesListSection");
  const canEdit = canEditLeadNotes(lead);
  listSection.innerHTML = lead.leadNotes.length
    ? lead.leadNotes.map((note, index) => `
        <div class="note-item">
          <span class="note-text">${escapeHtml(note.text)}</span>
          <span class="note-meta">${escapeHtml(note.by || "")}${note.by && note.at ? " - " : ""}${escapeHtml(formatKolkataDateTime(note.at || "", ""))}</span>
          ${canEdit ? `<button type="button" class="btn-ghost registered-note-delete-btn" data-note-index="${index}" style="font-size:0.75rem;padding:2px 6px;">Delete</button>` : ""}
        </div>
      `).join("")
    : `<p class="block-help">${canEdit ? "No notes yet. Add one below." : "No notes yet."}</p>`;

  document.getElementById("registeredNewNoteInput").value = "";
  document.getElementById("registeredSaveNoteBtn").classList.toggle("hidden", !canEdit);
  document.getElementById("registeredNewNoteInput").closest(".modal-row").classList.toggle("hidden", !canEdit);
  document.getElementById("registeredNotesModal").classList.remove("hidden");
  void trackLeadView(lead.id, lead.email || "");

  document.querySelectorAll(".registered-note-delete-btn").forEach((button) => {
    button.onclick = async () => {
      const noteIndex = Number(button.getAttribute("data-note-index"));
      const currentLead = findLeadByRef(notesLeadRef);
      if (!currentLead) return;
      const result = await withButtonBusy(button, "Deleting...", () => deleteLeadNote(currentLead.id, noteIndex, currentLead.email || ""));
      if (!result || result.ok === false) {
        showToast(result?.message || "Failed to delete note.", true);
        return;
      }
      mergeScopedRegisteredLeadUpdates(result.lead || result.leads);
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
  mergeScopedRegisteredLeadUpdates(result.lead || result.leads);

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
  void trackLeadView(lead.id, lead.email || "");
}

async function handleTaskSubmit(event) {
  event.preventDefault();

  const leadId = registeredTaskLeadIdInput.value;
  const title = registeredTaskTitleInput.value.trim();
  const dueDate = toTaskDueDateIso(registeredTaskDueDateInput.value);

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
  const allLeads = getScopedLeads(getAllLeads());
  const filteredLeads = filterLeads(allLeads);
  renderRegisteredRoutingPanel();
  renderFilters(allLeads);
  renderLeadTable(filteredLeads);
  restoreActiveInputState(activeInputState);
  window.__dvMarkRouteViewReady?.();
  renderKpis(filteredLeads);
}

document.getElementById("registeredActivityForm").onsubmit = saveActivity;
document.getElementById("closeRegisteredModalBtn").onclick = closeActivityModal;
document.getElementById("closeRegisteredNotesModalBtn").onclick = closeNotesModal;
document.getElementById("registeredSaveNoteBtn").onclick = (event) => {
  void withButtonBusy(event.currentTarget, "Saving note...", () => saveNote());
};
if (registeredTaskModal && registeredTaskForm) {
  document.getElementById("closeRegisteredTaskModalBtn").onclick = closeTaskModal;
  registeredTaskForm.onsubmit = handleTaskSubmit;
}

setupRegisteredRoutingPanel();
const scheduleRenderAll = createRenderScheduler(renderAll);
await loadScopedRegisteredCandidates();
void renderAll();
const stopStatePolling = startRegisteredCandidatePolling(() => {
  void scheduleRenderAll();
});
registerPageCleanup(stopStatePolling);
// /api/leads/scoped?section=registered-candidates
// btn-mcube-call
