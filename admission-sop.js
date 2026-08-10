import { registerPageCleanup } from "./page-runtime.js";
import { apiUrl } from "./api-client.js";
import { bootstrapLocalState, getCounselors, getLeads, getSession, refreshState } from "./state-sync.js";
import { assignLeads, deleteLeads, formatLeadAssignmentResult, takeSopLead, trackLeadView, unblockSopLeads } from "./lead-service.js";
import { openActivityHistory } from "./activity-history.js";
import { isCounselorActivityEntry } from "./counselor-activity-filter.js";

const KOLKATA_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const NEW_WINDOW_MS = 48 * 60 * 60 * 1000;
const ACTIVE_WINDOW_DAYS = 15;
const OFFERED_WINDOW_DAYS = 30;
const PAGE_SIZE = 20;
const SOP_ACTIVITY_OPTIONS_BY_HISTORY_FIELD = {
  mainAdmissionActivityHistory: {
    activityFields: ["mainAdmissionDialed", "mainAdmissionCoursePitched", "mainAdmissionCourseStatus", "mainAdmissionAdmissionStatus", "mainAdmissionCallStatus"]
  },
  registeredCourseActivityHistory: {
    activityFields: ["registeredDialed", "registeredCoursePitched", "registeredCourseStatus", "registeredAdmissionStatus", "registeredCallStatus"]
  }
};

const kpiGrid = document.getElementById("sopKpiGrid");
const filterCard = document.getElementById("sopFilterCard");
const adminSummary = document.getElementById("sopAdminSummary");
const leadTable = document.getElementById("sopLeadTable");
const liveClock = document.getElementById("sopLiveClock");
const pagination = document.getElementById("sopPagination");

const filter = {
  bucket: "all",
  counselor: "all",
  section: "all",
  course: "all",
  query: ""
};

let selectedBlockedLeadKeys = new Set();
let currentPage = 1;
let scopedAdmissionSopLeads = null;
let scopedAdmissionSopCounselors = null;
let scopedAdmissionSopActive = false;
let draftSopQuery = filter.query;

function showToast(message, isError = false) {
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
  setTimeout(() => toast.remove(), 3600);
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

function isAdminSession() {
  const role = String(getSession()?.role || "").trim().toLowerCase();
  return role === "admin" || role === "super_admin";
}

function isSuperAdminSession() {
  return String(getSession()?.role || "").trim().toLowerCase() === "super_admin";
}

function canViewAllAdmissionLeads() {
  const role = String(getSession()?.role || "").trim().toLowerCase();
  return isAdminSession() || role === "manager";
}

function isManagerSession() {
  return String(getSession()?.role || "").trim().toLowerCase() === "manager";
}

function getSessionCounselorName() {
  return String(getSession()?.name || "").trim().toLowerCase();
}

function canManagerTakeLead(model) {
  return isManagerSession()
    && Boolean(model?.sop?.blocked)
    && normalize(model?.counselor) !== getSessionCounselorName();
}

function shouldTreatLeadAsAssigned(counselorName) {
  const normalized = normalize(counselorName);
  return !!normalized && normalized !== "unassigned";
}

function getAdmissionSopSourceLeads() {
  return Array.isArray(scopedAdmissionSopLeads) ? scopedAdmissionSopLeads : getLeads();
}

function getAdmissionSopCounselors() {
  return Array.isArray(scopedAdmissionSopCounselors) ? scopedAdmissionSopCounselors : getCounselors();
}

async function loadScopedAdmissionSopData() {
  try {
    const response = await fetch(apiUrl("/api/leads/scoped?section=admission-sop"), {
      credentials: "same-origin",
      headers: { Accept: "application/json" }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.message || "Admission SOP scoped loading failed.");
    }
    scopedAdmissionSopLeads = Array.isArray(payload?.leads) ? payload.leads : [];
    scopedAdmissionSopCounselors = Array.isArray(payload?.counselors) ? payload.counselors : [];
    scopedAdmissionSopActive = true;
    return true;
  } catch (error) {
    console.warn("[admission-sop] Scoped loading failed, falling back to full state:", error?.message || error);
    scopedAdmissionSopLeads = null;
    scopedAdmissionSopCounselors = null;
    scopedAdmissionSopActive = false;
    await refreshState();
    return false;
  }
}

function startAdmissionSopPolling(onRefresh, intervalMs = 15000) {
  let destroyed = false;
  let activePoll = false;

  async function poll() {
    if (destroyed || activePoll || document.visibilityState === "hidden") {
      return;
    }
    activePoll = true;
    try {
      if (scopedAdmissionSopActive) {
        await loadScopedAdmissionSopData();
      } else {
        await refreshState();
      }
      await onRefresh();
    } catch (error) {
      console.warn("[admission-sop] polling failed:", error?.message || error);
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

function isCourseRegistrationLead(lead) {
  return normalize(lead?.leadPipeline) === "course-registration";
}

function isMainAdmissionLead(lead) {
  return normalize(lead?.leadPipeline) === "main-admission";
}

function isAdmissionScopedLead(lead) {
  return isCourseRegistrationLead(lead) || isMainAdmissionLead(lead);
}

function normalizePublicCourseSegment(value) {
  return normalize(value || "standard") || "standard";
}

function getAdmissionSectionLabel(lead) {
  if (isMainAdmissionLead(lead)) return "Main Admission";
  return normalizePublicCourseSegment(lead?.publicCourseSegment) === "crash-course"
    ? "Crash Course"
    : "Registered Candidates";
}

function getAdmissionSectionKey(lead) {
  if (isMainAdmissionLead(lead)) return "main-admission";
  return normalizePublicCourseSegment(lead?.publicCourseSegment) === "crash-course"
    ? "crash-course"
    : "registered-candidates";
}

function getAdmissionStatus(lead) {
  return String(
    lead?.mainAdmissionAdmissionStatus ||
    lead?.registeredAdmissionStatus ||
    ""
  ).trim();
}

function normalizeAdmissionStatus(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function getTrackingConfig(lead) {
  if (isMainAdmissionLead(lead)) {
    return {
      activityUpdatedField: "mainAdmissionActivityUpdated",
      activityHistoryField: "mainAdmissionActivityHistory",
      route: "main-admission-leads.html"
    };
  }
  if (isCourseRegistrationLead(lead)) {
    return {
      activityUpdatedField: "registeredActivityUpdated",
      activityHistoryField: "registeredCourseActivityHistory",
      route: "registered-candidates.html"
    };
  }
  return null;
}

function resolveLeadBaseTimestamp(lead) {
  const candidates = [
    lead?.admissionSopAssignedAt,
    lead?.counselorAssignedAt,
    lead?.createdAtExact,
    lead?.updatedAt
  ].map((value) => String(value || "").trim()).filter(Boolean);

  for (const candidate of candidates) {
    const parsed = new Date(candidate).getTime();
    if (Number.isFinite(parsed)) {
      return candidate;
    }
  }

  const createdAt = String(lead?.createdAt || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(createdAt)) {
    return `${createdAt}T00:00:00+05:30`;
  }

  if (createdAt) {
    const parsed = new Date(createdAt).getTime();
    if (Number.isFinite(parsed)) {
      return createdAt;
    }
  }

  return null;
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
  if (!Number.isFinite(startTs) || remaining <= 0) return Number.isFinite(startTs) ? startTs : null;
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

function formatRemainingTime(ms) {
  const remainingMs = Math.max(0, Number(ms) || 0);
  const totalHours = remainingMs / (60 * 60 * 1000);
  if (totalHours < 24) return `${Math.max(0, Math.ceil(totalHours))}h`;
  const totalDays = totalHours / 24;
  if (totalDays < 10) return `${totalDays.toFixed(1)}d`;
  return `${Math.ceil(totalDays)}d`;
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return date.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function isLeadSquaredImportedLead(lead) {
  return Boolean(lead?.lsqImported)
    || normalize(lead?.source).includes("leadsquared")
    || Boolean(lead?.lsqSourceSnapshot);
}

function getLatestHistoryTimestamp(lead, config) {
  const explicit = String(lead?.admissionSopLastProgressAt || "").trim();
  if (explicit && isLeadSquaredImportedLead(lead)) return explicit;

  const history = Array.isArray(lead?.[config.activityHistoryField]) ? lead[config.activityHistoryField] : [];
  const activityOptions = SOP_ACTIVITY_OPTIONS_BY_HISTORY_FIELD[config.activityHistoryField] || {};
  const sorted = history
    .filter((item) => isCounselorActivityEntry(item, activityOptions))
    .map((item) => String(item?.at || "").trim())
    .filter(Boolean)
    .sort((left, right) => new Date(right).getTime() - new Date(left).getTime());
  if (sorted[0]) return sorted[0];
  return null;
}

function deriveSopState(lead) {
  if (!isAdmissionScopedLead(lead)) return null;
  if (isLeadSquaredImportedLead(lead) || lead?.sopExcluded) return null;
  const config = getTrackingConfig(lead);
  if (!config) return null;

  const counselor = String(lead?.counselor || "").trim();
  const assignedAt = resolveLeadBaseTimestamp(lead);
  const progressAt = getLatestHistoryTimestamp(lead, config);
  const status = getAdmissionStatus(lead);
  const normalizedStatus = normalizeAdmissionStatus(status);
  const isWon = normalizedStatus === "won" || normalizedStatus === "enrolled";
  const isOffered = normalizedStatus === "opportunity" || normalizedStatus === "offered";
  const isAssigned = shouldTreatLeadAsAssigned(counselor);

  if (!isAssigned) {
    return {
      stageKey: "unassigned",
      stageLabel: "Unassigned",
      blocked: false,
      isDueSoon: false,
      deadlineAt: null,
      remainingMs: null,
      remainingLabel: "",
      assignedAt,
      progressAt,
      route: config.route
    };
  }

  if (isWon) {
    return {
      stageKey: "won",
      stageLabel: status || "Won / Enrolled",
      blocked: false,
      isDueSoon: false,
      deadlineAt: null,
      remainingMs: null,
      remainingLabel: "No expiry",
      assignedAt,
      progressAt,
      route: config.route
    };
  }

  const isNewWindow = !progressAt;
  const anchorAt = isNewWindow ? assignedAt : progressAt;
  if (!anchorAt) {
    return {
      stageKey: "unassigned",
      stageLabel: "Awaiting assignment",
      blocked: false,
      isDueSoon: false,
      deadlineAt: null,
      remainingMs: null,
      remainingLabel: "",
      assignedAt,
      progressAt,
      route: config.route
    };
  }

  const deadlineTs = isNewWindow
    ? addNonSundayWorkingMs(anchorAt, NEW_WINDOW_MS)
    : (isOffered ? addNonSundayWorkingDays(anchorAt, OFFERED_WINDOW_DAYS) : addNonSundayWorkingDays(anchorAt, ACTIVE_WINDOW_DAYS));
  const overrideDeadlineTs = new Date(String(lead?.admissionSopDeadlineOverrideAt || "")).getTime();
  const effectiveDeadlineTs = Number.isFinite(overrideDeadlineTs) ? overrideDeadlineTs : deadlineTs;
  const remainingMs = Number.isFinite(effectiveDeadlineTs) ? effectiveDeadlineTs - Date.now() : null;
  const blocked = Number.isFinite(remainingMs) ? remainingMs <= 0 : false;
  const dueSoonThreshold = isNewWindow ? 12 * 60 * 60 * 1000 : (isOffered ? 5 : 3) * 24 * 60 * 60 * 1000;

  return {
    stageKey: isNewWindow ? "new" : (isOffered ? "offered" : "active"),
    stageLabel: isNewWindow ? "New window" : (isOffered ? "Opportunity / Offered" : "Active management"),
    blocked,
    isDueSoon: !blocked && remainingMs !== null && remainingMs <= dueSoonThreshold,
    deadlineAt: Number.isFinite(effectiveDeadlineTs) ? new Date(effectiveDeadlineTs).toISOString() : null,
    remainingMs,
    remainingLabel: blocked ? "Blocked" : formatRemainingTime(remainingMs),
    assignedAt,
    progressAt,
    route: config.route
  };
}

function getAdmissionLeadsForView() {
  const all = getAdmissionSopSourceLeads().filter((lead) => (
    lead
    && !lead.isDeleted
    && isAdmissionScopedLead(lead)
    && !isLeadSquaredImportedLead(lead)
    && !lead.sopExcluded
  ));
  if (canViewAllAdmissionLeads()) return all;
  const counselorName = getSessionCounselorName();
  return all.filter((lead) => normalize(lead?.counselor) === counselorName);
}

function buildStableAdmissionRowKey(lead, sectionKey) {
  return [
    lead?.id,
    lead?.createdAtExact,
    lead?.admissionSopAssignedAt,
    lead?.counselorAssignedAt,
    lead?.email,
    lead?.phone,
    lead?.name,
    lead?.courseName,
    lead?.courseCode,
    lead?.mainAdmissionCoursePitched,
    lead?.registeredCoursePitched,
    sectionKey,
    lead?.createdAt
  ].map((value) => String(value || "").trim()).join("::");
}

function getLeadRowModel(lead) {
  const sectionKey = getAdmissionSectionKey(lead);
  return {
    lead,
    key: buildStableAdmissionRowKey(lead, sectionKey),
    name: String(lead?.name || "Unknown").trim(),
    counselor: String(lead?.counselor || "Unassigned").trim() || "Unassigned",
    sectionKey,
    sectionLabel: getAdmissionSectionLabel(lead),
    courseLabel: String(lead?.courseName || lead?.courseCode || lead?.mainAdmissionCoursePitched || lead?.registeredCoursePitched || "").trim() || "Not specified",
    status: getAdmissionStatus(lead) || "No status",
    sop: deriveSopState(lead)
  };
}

function getAllRowModels() {
  return getAdmissionLeadsForView()
    .map((lead, sourceIndex) => ({
      ...getLeadRowModel(lead),
      sourceIndex
    }))
    .sort((left, right) => {
      const leftBlocked = left.sop?.blocked ? 1 : 0;
      const rightBlocked = right.sop?.blocked ? 1 : 0;
      if (leftBlocked !== rightBlocked) return rightBlocked - leftBlocked;
      const leftRisk = left.sop?.isDueSoon ? 1 : 0;
      const rightRisk = right.sop?.isDueSoon ? 1 : 0;
      if (leftRisk !== rightRisk) return rightRisk - leftRisk;
      const leftRemaining = Number.isFinite(left.sop?.remainingMs) ? left.sop.remainingMs : Number.MAX_SAFE_INTEGER;
      const rightRemaining = Number.isFinite(right.sop?.remainingMs) ? right.sop.remainingMs : Number.MAX_SAFE_INTEGER;
      if (leftRemaining !== rightRemaining) return leftRemaining - rightRemaining;
      return left.sourceIndex - right.sourceIndex;
    })
    .map((model) => ({
      ...model,
      key: `${String(model.key || "")}::src-${model.sourceIndex}`
    }));
}

function getBucketKey(model) {
  if (model.sop?.blocked) return "blocked";
  if (model.sop?.stageKey === "won") return "won";
  if (model.sop?.stageKey === "unassigned") return "unassigned";
  if (model.sop?.isDueSoon) return "risk";
  if (model.sop?.stageKey === "new") return "new";
  if (model.sop?.stageKey === "offered") return "offered";
  return "active";
}

function getFilteredRowsFromRows(rows) {
  const query = normalize(filter.query);
  return rows.filter((model) => {
    if (filter.bucket !== "all" && getBucketKey(model) !== filter.bucket) return false;
    if (filter.counselor !== "all" && normalize(model.counselor) !== normalize(filter.counselor)) return false;
    if (filter.section !== "all" && model.sectionKey !== filter.section) return false;
    if (filter.course !== "all" && model.courseLabel !== filter.course) return false;
    if (!query) return true;

    const haystack = [
      model.name,
      model.counselor,
      model.sectionLabel,
      model.courseLabel,
      model.status,
      model.lead?.phone,
      model.lead?.email
    ].map((value) => normalize(value)).join(" ");
    return haystack.includes(query);
  });
}

function getFilteredRows() {
  return getFilteredRowsFromRows(getAllRowModels());
}

function getSelectableBlockedRowKeys(rows) {
  return rows
    .filter((row) => row.sop?.blocked)
    .map((row) => String(row.pageSelectionKey || row.key || "").trim())
    .filter(Boolean);
}

function getSelectedBlockedLeadCount(rows) {
  const selectableKeys = new Set(getSelectableBlockedRowKeys(rows));
  let count = 0;

  selectedBlockedLeadKeys.forEach((leadKey) => {
    if (selectableKeys.has(String(leadKey))) {
      count += 1;
    }
  });

  return count;
}

function syncSelectedBlockedLeadKeys(rows) {
  const selectableKeys = new Set(getSelectableBlockedRowKeys(rows));
  selectedBlockedLeadKeys = new Set(
    [...selectedBlockedLeadKeys].filter((leadKey) => selectableKeys.has(String(leadKey)))
  );
}

function toggleBlockedLeadSelection(leadKey, isChecked) {
  const next = new Set(selectedBlockedLeadKeys);
  if (isChecked) {
    next.add(String(leadKey));
  } else {
    next.delete(String(leadKey));
  }
  selectedBlockedLeadKeys = next;
}

function toggleAllBlockedLeadSelection(rows, isChecked) {
  selectedBlockedLeadKeys = isChecked ? new Set(getSelectableBlockedRowKeys(rows)) : new Set();
}

function clampSelectionCount(rawValue, maxCount) {
  const parsed = Number.parseInt(String(rawValue || "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.min(parsed, Math.max(0, Number(maxCount) || 0));
}

function selectBlockedLeadBatch(rows, rawValue) {
  const selectableKeys = getSelectableBlockedRowKeys(rows);
  const count = clampSelectionCount(rawValue, selectableKeys.length);
  if (!count) {
    return 0;
  }

  selectedBlockedLeadKeys = new Set(selectableKeys.slice(0, count));
  return count;
}

function ensureValidPage(totalItems) {
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  currentPage = Math.min(Math.max(1, currentPage), totalPages);
  return totalPages;
}

function getCurrentPageRowModels(rows) {
  const pageStartIndex = (currentPage - 1) * PAGE_SIZE;
  return rows
    .slice(pageStartIndex, pageStartIndex + PAGE_SIZE)
    .map((row, index) => ({
      ...row,
      pageSelectionKey: `page-row-${pageStartIndex + index}`
    }));
}

function getActiveCounselors(rows = getAllRowModels()) {
  return [...new Set(rows.map((model) => model.counselor).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function getActiveCourses(rows = getAllRowModels()) {
  return [...new Set(rows.map((model) => model.courseLabel).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function getAssignableCounselors() {
  return [...new Set(
    getAdmissionSopCounselors()
      .map((item) => String(item?.name || "").trim())
      .filter(Boolean)
  )].sort((left, right) => left.localeCompare(right));
}

function renderClock() {
  if (!liveClock) return;
  liveClock.textContent = new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "medium"
  });
}

function renderKpis(rows = getFilteredRows()) {
  const metrics = [
    { label: "Admission Leads", value: rows.length, tone: "neutral" },
    { label: "New Window", value: rows.filter((row) => row.sop?.stageKey === "new" && !row.sop?.blocked).length, tone: "neutral" },
    { label: "At Risk", value: rows.filter((row) => row.sop?.isDueSoon && !row.sop?.blocked).length, tone: "warning" },
    { label: "Blocked", value: rows.filter((row) => row.sop?.blocked).length, tone: "danger" },
    { label: "Won / Enrolled", value: rows.filter((row) => row.sop?.stageKey === "won").length, tone: "success" }
  ];

  kpiGrid.innerHTML = metrics.map((metric) => `
    <article class="card sop-kpi-card sop-kpi-card--${metric.tone}">
      <span class="sop-kpi-card__label">${escapeHtml(metric.label)}</span>
      <strong class="sop-kpi-card__value">${metric.value}</strong>
    </article>
  `).join("");
}

function renderFilters(rows = getAllRowModels()) {
  const counselorOptions = canViewAllAdmissionLeads()
    ? `<label>
        Counselor
        <select id="sopCounselorFilter">
          <option value="all">All counselors</option>
          ${getActiveCounselors(rows).map((name) => `<option value="${escapeHtml(name)}" ${filter.counselor === name ? "selected" : ""}>${escapeHtml(name)}</option>`).join("")}
        </select>
      </label>`
    : "";
  const courseOptions = `<label>
        Course
        <select id="sopCourseFilter">
          <option value="all">All courses</option>
          ${getActiveCourses(rows).map((name) => `<option value="${escapeHtml(name)}" ${filter.course === name ? "selected" : ""}>${escapeHtml(name)}</option>`).join("")}
        </select>
      </label>`;


  filterCard.innerHTML = `
    <div class="sop-filter-grid">
      <label>
        Bucket
        <select id="sopBucketFilter">
          <option value="all" ${filter.bucket === "all" ? "selected" : ""}>All buckets</option>
          <option value="new" ${filter.bucket === "new" ? "selected" : ""}>New window</option>
          <option value="active" ${filter.bucket === "active" ? "selected" : ""}>Active management</option>
          <option value="offered" ${filter.bucket === "offered" ? "selected" : ""}>Opportunity / Offered</option>
          <option value="risk" ${filter.bucket === "risk" ? "selected" : ""}>Close to blocked</option>
          <option value="blocked" ${filter.bucket === "blocked" ? "selected" : ""}>Blocked</option>
          <option value="won" ${filter.bucket === "won" ? "selected" : ""}>Won / Enrolled</option>
          <option value="unassigned" ${filter.bucket === "unassigned" ? "selected" : ""}>Unassigned</option>
        </select>
      </label>
      <label>
        Section
        <select id="sopSectionFilter">
          <option value="all">All sections</option>
          <option value="main-admission" ${filter.section === "main-admission" ? "selected" : ""}>Main Admission</option>
          <option value="registered-candidates" ${filter.section === "registered-candidates" ? "selected" : ""}>Registered Candidates</option>
          <option value="crash-course" ${filter.section === "crash-course" ? "selected" : ""}>Crash Course</option>
        </select>
      </label>
      ${courseOptions}
      ${counselorOptions}
      <label class="sop-filter-grid__search">
        Search
        <input id="sopQueryFilter" type="search" value="${escapeHtml(draftSopQuery)}" placeholder="Lead, phone, course, counselor..." />
      </label>
      <div class="sop-filter-grid__actions">
        <button type="button" class="btn-ghost" id="sopResetFiltersBtn">Reset Filters</button>
      </div>
    </div>
  `;

  document.getElementById("sopBucketFilter")?.addEventListener("change", (event) => {
    filter.bucket = event.target.value;
    currentPage = 1;
    render();
  });
  document.getElementById("sopSectionFilter")?.addEventListener("change", (event) => {
    filter.section = event.target.value;
    currentPage = 1;
    render();
  });
  document.getElementById("sopCounselorFilter")?.addEventListener("change", (event) => {
    filter.counselor = event.target.value;
    currentPage = 1;
    render();
  });
  document.getElementById("sopCourseFilter")?.addEventListener("change", (event) => {
    filter.course = event.target.value;
    currentPage = 1;
    render();
  });
  const queryInput = document.getElementById("sopQueryFilter");
  queryInput?.addEventListener("input", (event) => {
    draftSopQuery = event.target.value;
  });
  queryInput?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    draftSopQuery = event.target.value;
    filter.query = draftSopQuery;
    currentPage = 1;
    render();
  });
  document.getElementById("sopResetFiltersBtn")?.addEventListener("click", () => {
    filter.bucket = "all";
    filter.counselor = "all";
    filter.section = "all";
    filter.course = "all";
    filter.query = "";
    draftSopQuery = "";
    currentPage = 1;
    render();
  });
}

function renderAdminSummary(rows = getAllRowModels()) {
  if (!isAdminSession()) {
    adminSummary.classList.add("hidden");
    adminSummary.innerHTML = "";
    return;
  }

  const byCounselor = new Map();
  rows.forEach((model) => {
    const entry = byCounselor.get(model.counselor) || {
      counselor: model.counselor,
      total: 0,
      risk: 0,
      blocked: 0
    };
    entry.total += 1;
    if (model.sop?.isDueSoon && !model.sop?.blocked) entry.risk += 1;
    if (model.sop?.blocked) entry.blocked += 1;
    byCounselor.set(model.counselor, entry);
  });

  const counselorRows = [...byCounselor.values()].sort((left, right) => {
    if (right.blocked !== left.blocked) return right.blocked - left.blocked;
    if (right.risk !== left.risk) return right.risk - left.risk;
    return left.counselor.localeCompare(right.counselor);
  });

  adminSummary.classList.remove("hidden");
  adminSummary.innerHTML = `
    <div class="section-head">
      <div>
        <h2>Counselor Bottlenecks</h2>
        <p class="block-help">Use this counselor-wise view to spot blocked queues and near-expiry admission leads before reassignment.</p>
      </div>
    </div>
    <div class="table-shell">
      <table class="data-table sop-admin-table">
        <thead>
          <tr>
            <th>Counselor</th>
            <th>Total Admission Leads</th>
            <th>Close To Block</th>
            <th>Blocked</th>
          </tr>
        </thead>
        <tbody>
          ${counselorRows.map((row) => `
            <tr>
              <td>${escapeHtml(row.counselor)}</td>
              <td>${row.total}</td>
              <td>${row.risk}</td>
              <td>${row.blocked}</td>
            </tr>
          `).join("") || `<tr><td colspan="4" class="empty-state">No counselor data available.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

function getSopBadgeClass(model) {
  if (model.sop?.blocked) return "pill pill--danger";
  if (model.sop?.isDueSoon) return "pill pill--warning";
  if (model.sop?.stageKey === "won") return "pill pill--success";
  return "pill pill--neutral";
}

function buildLeadRef(lead) {
  return {
    id: String(lead?.id || "").trim(),
    email: String(lead?.email || "").trim().toLowerCase(),
    phone: String(lead?.phone || "").trim(),
    workshop: String(lead?.workshop || "").trim(),
    createdAt: String(lead?.createdAt || "").trim()
  };
}

function getLeadTabStage(model = {}) {
  return model.sectionKey === "registered-candidates" || model.sectionKey === "crash-course"
    ? "registered-course"
    : "main-admission";
}

function buildLeadTabUrl(model = {}) {
  const lead = model.lead || {};
  const params = new URLSearchParams({
    leadId: String(lead?.id || "").trim(),
    leadEmail: String(lead?.email || "").trim().toLowerCase(),
    stage: getLeadTabStage(model)
  });
  return `lead-tab.html?${params.toString()}`;
}

function cacheLeadTabSnapshot(model = {}) {
  const lead = model.lead;
  if (!lead) return;
  const stage = getLeadTabStage(model);
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

function renderLeadTable(rows = getFilteredRows()) {
  const totalPages = ensureValidPage(rows.length);
  const pageRows = getCurrentPageRowModels(rows);
  const pageBlockedRows = pageRows.filter((row) => row.sop?.blocked);
  const pageBlockedKeys = pageBlockedRows.map((row) => row.pageSelectionKey);
  selectedBlockedLeadKeys = new Set([...selectedBlockedLeadKeys].filter((key) => pageBlockedKeys.includes(key)));
  const selectedBlockedRows = pageBlockedRows.filter((row) => selectedBlockedLeadKeys.has(row.pageSelectionKey));
  const allPageBlockedSelected = pageBlockedKeys.length > 0 && pageBlockedKeys.every((key) => selectedBlockedLeadKeys.has(key));

  leadTable.innerHTML = `
    <div class="section-head">
      <div>
        <h2>${canViewAllAdmissionLeads() ? "Admission Reallocation Queue" : "My Admission SOP Queue"}</h2>
        <p class="block-help">${canViewAllAdmissionLeads() ? (isAdminSession() ? "Blocked leads can be bulk assigned or deleted here. All admission leads remain visible for counselor-wise diagnosis." : "Blocked leads can be bulk assigned here. All admission leads remain visible for counselor-wise diagnosis.") : "These are your admission-side leads, sorted by urgency and SOP risk."}</p>
      </div>
    </div>
    ${canViewAllAdmissionLeads() ? `
      <div class="bulk-select-actions sop-bulk-toolbar">
        <label class="bulk-select-control sop-bulk-toolbar__select-all">
          <input type="checkbox" id="sopSelectAllPageBlocked" ${allPageBlockedSelected ? "checked" : ""} ${pageBlockedKeys.length ? "" : "disabled"} />
          <span>Select All</span>
        </label>
        <span class="selected-count">Selected: ${selectedBlockedRows.length}</span>
        <div class="bulk-admin-tools">
          <input type="number" id="sopBulkCountInput" class="bulk-count-input" min="1" max="${pageBlockedRows.length || 1}" placeholder="Count" ${pageBlockedRows.length ? "" : "disabled"} />
          <button type="button" class="btn-ghost bulk-action-btn" id="sopBulkCountApply" ${pageBlockedRows.length ? "" : "disabled"}>Select Count</button>
          <select id="sopBulkAssignCounselor" class="bulk-assign-select">
            <option value="">Assign to</option>
            ${getAssignableCounselors().map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("")}
          </select>
          <button type="button" class="btn-ghost bulk-action-btn" id="sopBulkAssignBtn" ${selectedBlockedRows.length ? "" : "disabled"}>Assign Selected</button>
          ${isSuperAdminSession() ? `
            <input type="number" id="sopUnblockDaysInput" class="bulk-count-input" min="1" max="365" placeholder="Days" ${selectedBlockedRows.length ? "" : "disabled"} />
            <button type="button" class="btn-ghost bulk-action-btn" id="sopBulkUnblockBtn" ${selectedBlockedRows.length ? "" : "disabled"}>Unblock Selected</button>
          ` : ""}
          ${isAdminSession() ? `<button type="button" class="btn-delete bulk-delete-btn" id="sopBulkDeleteBtn" ${selectedBlockedRows.length ? "" : "disabled"}>Delete Selected</button>` : ""}
        </div>
      </div>
    ` : ""}
    <div class="table-shell">
      <table class="data-table sop-lead-table">
        <thead>
          <tr>
            ${canViewAllAdmissionLeads() ? "<th>Select</th>" : ""}
            <th>Lead</th>
            <th>Section</th>
            <th>Counselor</th>
            <th>SOP Bucket</th>
            <th>Admission Status</th>
            <th>Deadline</th>
            <th>Remaining</th>
            <th>Last Progress</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${pageRows.map((model) => `
            <tr>
              ${canViewAllAdmissionLeads() ? `
                <td>
                  ${model.sop?.blocked ? `
                    <input type="checkbox" data-lead-key="${escapeHtml(model.pageSelectionKey)}" ${selectedBlockedLeadKeys.has(model.pageSelectionKey) ? "checked" : ""} />
                  ` : `<span class="block-help">—</span>`}
                </td>
              ` : ""}
              <td>
                <strong>${escapeHtml(model.name)}</strong>
                <div class="table-meta">${escapeHtml(model.lead?.phone || "No phone")}</div>
                <div class="table-meta">${escapeHtml(model.courseLabel)}</div>
              </td>
              <td>${escapeHtml(model.sectionLabel)}</td>
              <td>${escapeHtml(model.counselor)}</td>
              <td><span class="${getSopBadgeClass(model)}">${escapeHtml(model.sop?.blocked ? "Blocked" : model.sop?.stageLabel || "Unknown")}</span></td>
              <td>${escapeHtml(model.status)}</td>
              <td>${model.sop?.deadlineAt ? escapeHtml(formatDateTime(model.sop.deadlineAt)) : '<span class="block-help">No deadline</span>'}</td>
              <td>${escapeHtml(model.sop?.remainingLabel || "")}</td>
              <td>${model.sop?.progressAt ? escapeHtml(formatDateTime(model.sop.progressAt)) : '<span class="block-help">No activity yet</span>'}</td>
              <td>
                <div class="table-actions">
                  ${canManagerTakeLead(model) ? `<button type="button" class="btn-primary btn-sm" data-take-sop-key="${escapeHtml(model.key)}">Take Lead</button>` : ""}
                  <button type="button" class="btn-primary btn-sm" data-open-tab-key="${escapeHtml(model.key)}" data-lead-tab-url="${escapeHtml(buildLeadTabUrl(model))}">Open Tab</button>
                  <button type="button" class="btn-ghost btn-sm" data-history-key="${escapeHtml(model.key)}">Activity History</button>
                </div>
              </td>
            </tr>
          `).join("") || `<tr><td colspan="${canViewAllAdmissionLeads() ? 10 : 9}" class="empty-state">No admission leads match the current SOP filters.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;

  if (!pageRows.length) {
    pagination.innerHTML = "";
  } else {
    const pageStart = (currentPage - 1) * PAGE_SIZE + 1;
    const pageEnd = Math.min(rows.length, currentPage * PAGE_SIZE);
    pagination.innerHTML = `
      <span class="pagination-info">Showing ${pageStart}-${pageEnd} of ${rows.length}</span>
      <div class="pagination-buttons">
        <button type="button" class="btn-ghost pagination-btn" id="sopPrevPage" ${currentPage <= 1 ? "disabled" : ""}>Prev</button>
        <span class="pagination-info">Page ${currentPage} of ${totalPages}</span>
        <button type="button" class="btn-ghost pagination-btn" id="sopNextPage" ${currentPage >= totalPages ? "disabled" : ""}>Next</button>
      </div>
    `;
    document.getElementById("sopPrevPage")?.addEventListener("click", () => {
      currentPage = Math.max(1, currentPage - 1);
      renderLeadTable();
    });
    document.getElementById("sopNextPage")?.addEventListener("click", () => {
      currentPage = Math.min(totalPages, currentPage + 1);
      renderLeadTable();
    });
  }

  leadTable.querySelectorAll("input[type='checkbox'][data-lead-key]").forEach((checkbox) => {
    checkbox.addEventListener("change", (event) => {
      const leadKey = String(event.target.getAttribute("data-lead-key") || "");
      toggleBlockedLeadSelection(leadKey, event.target.checked);
      renderLeadTable();
    });
  });

  document.getElementById("sopSelectAllPageBlocked")?.addEventListener("change", (event) => {
    const next = new Set(selectedBlockedLeadKeys);
    if (event.target.checked) {
      pageBlockedKeys.forEach((key) => next.add(key));
    } else {
      pageBlockedKeys.forEach((key) => next.delete(key));
    }
    selectedBlockedLeadKeys = next;
    renderLeadTable();
  });

  document.getElementById("sopBulkDeleteBtn")?.addEventListener("click", () => {
    void deleteSelectedBlockedLeads();
  });
  document.getElementById("sopBulkCountApply")?.addEventListener("click", () => {
    const countValue = String(document.getElementById("sopBulkCountInput")?.value || "").trim();
    const selectedBatchCount = selectBlockedLeadBatch(pageRows, countValue);
    if (!selectedBatchCount) {
      showToast("Enter a valid blocked lead count to select.", true);
      return;
    }

    renderLeadTable();
    showToast(`Selected ${selectedBatchCount} blocked lead${selectedBatchCount === 1 ? "" : "s"}.`, false);
  });
  document.getElementById("sopBulkAssignBtn")?.addEventListener("click", () => {
    const counselor = String(document.getElementById("sopBulkAssignCounselor")?.value || "").trim();
    void assignSelectedBlockedLeads(counselor);
  });
  document.getElementById("sopBulkUnblockBtn")?.addEventListener("click", () => {
    const days = Number(document.getElementById("sopUnblockDaysInput")?.value || 0);
    void unblockSelectedBlockedLeads(days);
  });

  leadTable.querySelectorAll("[data-open-tab-key]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = String(button.getAttribute("data-open-tab-key") || "");
      const model = getAllRowModels().find((item) => item.key === key);
      const targetUrl = button.getAttribute("data-lead-tab-url");
      if (!model || !targetUrl) {
        showToast("Could not open this lead tab. Please refresh and try again.", true);
        return;
      }
      cacheLeadTabSnapshot(model);
      window.open(targetUrl, "_blank", "noopener");
      void trackLeadView(model.lead.id, model.lead.email || "");
    });
  });

  leadTable.querySelectorAll("[data-take-sop-key]").forEach((button) => {
    button.addEventListener("click", async () => {
      const key = String(button.getAttribute("data-take-sop-key") || "");
      const model = getAllRowModels().find((item) => item.key === key);
      if (!model?.lead) {
        showToast("Could not find this lead. Please refresh and try again.", true);
        return;
      }

      button.disabled = true;
      button.textContent = "Taking...";
      const result = await takeSopLead(model.lead.id, model.lead.email || "");
      if (!result?.ok) {
        button.disabled = false;
        button.textContent = "Take Lead";
        showToast(result?.message || "Could not take this SOP lead.", true);
        return;
      }

      await loadScopedAdmissionSopData().catch(() => refreshState().catch(() => undefined));
      render();
      showToast(result.message || "Lead assigned to you.");
    });
  });

  leadTable.querySelectorAll("[data-history-key]").forEach((button) => {
    button.addEventListener("click", async () => {
      const key = String(button.getAttribute("data-history-key") || "");
      const model = getAllRowModels().find((item) => item.key === key);
      if (!model) return;
      await trackLeadView(model.lead.id, model.lead.email || "").catch(() => undefined);
      openActivityHistory(model.lead.id, model.lead.name || "Lead", model.lead.email || "");
    });
  });
}

async function deleteSelectedBlockedLeads() {
  if (!isAdminSession()) return;
  const selectedRows = getCurrentPageRowModels(getFilteredRows())
    .filter((row) => selectedBlockedLeadKeys.has(row.pageSelectionKey) && row.sop?.blocked);
  if (!selectedRows.length) {
    showToast("Select at least one blocked lead to delete.", true);
    return;
  }

  const confirmed = window.confirm(`Delete ${selectedRows.length} selected blocked lead${selectedRows.length === 1 ? "" : "s"}? This cannot be undone.`);
  if (!confirmed) {
    return;
  }

  const result = await deleteLeads(selectedRows.map((row) => buildLeadRef(row.lead)));
  if (!result?.ok) {
    showToast(result?.message || "Failed to delete selected blocked leads.", true);
    return;
  }

  selectedBlockedLeadKeys = new Set();
  await loadScopedAdmissionSopData().catch(() => refreshState().catch(() => undefined));
  render();
  showToast(`Deleted ${selectedRows.length} blocked lead${selectedRows.length === 1 ? "" : "s"}.`);
}

async function assignSelectedBlockedLeads(counselorName) {
  if (!isAdminSession() && !isManagerSession()) return;

  const selectedRows = getCurrentPageRowModels(getFilteredRows())
    .filter((row) => selectedBlockedLeadKeys.has(row.pageSelectionKey) && row.sop?.blocked);
  if (!selectedRows.length) {
    showToast("Select at least one blocked lead to assign.", true);
    return;
  }

  const targetCounselor = String(counselorName || "").trim();
  if (!targetCounselor) {
    showToast("Select a counselor first.", true);
    return;
  }

  const assignmentResult = await assignLeads(
    selectedRows.map((row) => buildLeadRef(row.lead)),
    targetCounselor
  );
  if (!assignmentResult || assignmentResult.ok === false) {
    showToast(assignmentResult?.message || "Failed to assign selected blocked leads. Please try again.", true);
    return;
  }

  const assignmentSummary = formatLeadAssignmentResult(assignmentResult, selectedRows.length, targetCounselor);
  selectedBlockedLeadKeys = new Set();
  await loadScopedAdmissionSopData().catch(() => refreshState().catch(() => undefined));
  render();
  showToast(assignmentSummary.message, assignmentSummary.assignedCount === 0);
}

async function unblockSelectedBlockedLeads(days) {
  if (!isSuperAdminSession()) return;

  const selectedRows = getCurrentPageRowModels(getFilteredRows())
    .filter((row) => selectedBlockedLeadKeys.has(row.pageSelectionKey) && row.sop?.blocked);
  if (!selectedRows.length) {
    showToast("Select at least one blocked lead to unblock.", true);
    return;
  }

  const customDays = Math.round(Number(days) || 0);
  if (!customDays || customDays < 1 || customDays > 365) {
    showToast("Enter custom deadline days between 1 and 365.", true);
    return;
  }

  const confirmed = window.confirm(`Unblock ${selectedRows.length} selected lead${selectedRows.length === 1 ? "" : "s"} with a ${customDays} day SOP deadline?`);
  if (!confirmed) {
    return;
  }

  const result = await unblockSopLeads(
    selectedRows.map((row) => buildLeadRef(row.lead)),
    customDays
  );
  if (!result?.ok) {
    showToast(result?.message || "Failed to unblock selected SOP leads.", true);
    return;
  }

  selectedBlockedLeadKeys = new Set();
  await loadScopedAdmissionSopData().catch(() => refreshState().catch(() => undefined));
  render();
  showToast(`Unblocked ${result.updatedCount || selectedRows.length} lead${Number(result.updatedCount || selectedRows.length) === 1 ? "" : "s"} with a ${customDays} day deadline.`);
}

function render() {
  renderClock();
  const allRows = getAllRowModels();
  const filteredRows = getFilteredRowsFromRows(allRows);
  renderFilters(allRows);
  renderAdminSummary(allRows);
  renderLeadTable(filteredRows);
  window.__dvMarkRouteViewReady?.();
  renderKpis(filteredRows);
}

await bootstrapLocalState({ skipStateRefresh: true });
await loadScopedAdmissionSopData();
render();

const stopAdmissionSopPolling = startAdmissionSopPolling(() => {
  render();
}, 15000);
registerPageCleanup(stopAdmissionSopPolling);

window.setInterval(() => {
  render();
}, 30000);

