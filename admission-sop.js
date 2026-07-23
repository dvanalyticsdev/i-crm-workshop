import { bootstrapLocalState, getLeads, getSession, refreshState, startStatePolling } from "./state-sync.js";
import { assignLeads, formatLeadAssignmentResult, trackLeadView } from "./lead-service.js";
import { openActivityHistory } from "./activity-history.js";

const KOLKATA_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const NEW_WINDOW_MS = 48 * 60 * 60 * 1000;
const ACTIVE_WINDOW_DAYS = 15;
const OFFERED_WINDOW_DAYS = 30;
const PAGE_SIZE = 20;

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
  query: ""
};

let selectedBlockedLeadKeys = new Set();
let bulkAssignInFlight = false;
let currentPage = 1;

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
  return getSession()?.role === "admin";
}

function getSessionCounselorName() {
  return String(getSession()?.name || "").trim().toLowerCase();
}

function shouldTreatLeadAsAssigned(counselorName) {
  const normalized = normalize(counselorName);
  return !!normalized && normalized !== "unassigned";
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

function getLatestHistoryTimestamp(lead, config) {
  const explicit = String(lead?.admissionSopLastProgressAt || "").trim();
  if (explicit) return explicit;
  const history = Array.isArray(lead?.[config.activityHistoryField]) ? lead[config.activityHistoryField] : [];
  const sorted = history
    .map((item) => String(item?.at || "").trim())
    .filter(Boolean)
    .sort((left, right) => new Date(right).getTime() - new Date(left).getTime());
  if (sorted[0]) return sorted[0];
  if (lead?.[config.activityUpdatedField]) {
    return String(lead?.updatedAt || lead?.createdAtExact || "").trim() || null;
  }
  return null;
}

function deriveSopState(lead) {
  if (!isAdmissionScopedLead(lead)) return null;
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
  const remainingMs = Number.isFinite(deadlineTs) ? deadlineTs - Date.now() : null;
  const blocked = Number.isFinite(remainingMs) ? remainingMs <= 0 : false;
  const dueSoonThreshold = isNewWindow ? 12 * 60 * 60 * 1000 : (isOffered ? 5 : 3) * 24 * 60 * 60 * 1000;

  return {
    stageKey: isNewWindow ? "new" : (isOffered ? "offered" : "active"),
    stageLabel: isNewWindow ? "New window" : (isOffered ? "Opportunity / Offered" : "Active management"),
    blocked,
    isDueSoon: !blocked && remainingMs !== null && remainingMs <= dueSoonThreshold,
    deadlineAt: Number.isFinite(deadlineTs) ? new Date(deadlineTs).toISOString() : null,
    remainingMs,
    remainingLabel: blocked ? "Blocked" : formatRemainingTime(remainingMs),
    assignedAt,
    progressAt,
    route: config.route
  };
}

function getAdmissionLeadsForView() {
  const all = getLeads().filter((lead) => lead && !lead.isDeleted && isAdmissionScopedLead(lead));
  if (isAdminSession()) return all;
  const counselorName = getSessionCounselorName();
  return all.filter((lead) => normalize(lead?.counselor) === counselorName);
}

function getLeadRowModel(lead) {
  return {
    lead,
    key: [lead?.id, lead?.email, lead?.phone, lead?.createdAt].map((value) => String(value || "")).join("::"),
    name: String(lead?.name || "Unknown").trim(),
    counselor: String(lead?.counselor || "Unassigned").trim() || "Unassigned",
    sectionKey: getAdmissionSectionKey(lead),
    sectionLabel: getAdmissionSectionLabel(lead),
    courseLabel: String(lead?.courseName || lead?.courseCode || lead?.mainAdmissionCoursePitched || lead?.registeredCoursePitched || "").trim() || "Not specified",
    status: getAdmissionStatus(lead) || "No status",
    sop: deriveSopState(lead)
  };
}

function getAllRowModels() {
  return getAdmissionLeadsForView()
    .map(getLeadRowModel)
    .sort((left, right) => {
      const leftBlocked = left.sop?.blocked ? 1 : 0;
      const rightBlocked = right.sop?.blocked ? 1 : 0;
      if (leftBlocked !== rightBlocked) return rightBlocked - leftBlocked;
      const leftRisk = left.sop?.isDueSoon ? 1 : 0;
      const rightRisk = right.sop?.isDueSoon ? 1 : 0;
      if (leftRisk !== rightRisk) return rightRisk - leftRisk;
      const leftRemaining = Number.isFinite(left.sop?.remainingMs) ? left.sop.remainingMs : Number.MAX_SAFE_INTEGER;
      const rightRemaining = Number.isFinite(right.sop?.remainingMs) ? right.sop.remainingMs : Number.MAX_SAFE_INTEGER;
      return leftRemaining - rightRemaining;
    });
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

function getFilteredRows() {
  const query = normalize(filter.query);
  return getAllRowModels().filter((model) => {
    if (filter.bucket !== "all" && getBucketKey(model) !== filter.bucket) return false;
    if (filter.counselor !== "all" && normalize(model.counselor) !== normalize(filter.counselor)) return false;
    if (filter.section !== "all" && model.sectionKey !== filter.section) return false;
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

function ensureValidPage(totalItems) {
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  currentPage = Math.min(Math.max(1, currentPage), totalPages);
  return totalPages;
}

function getActiveCounselors() {
  return [...new Set(getAllRowModels().map((model) => model.counselor).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function renderClock() {
  if (!liveClock) return;
  liveClock.textContent = new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "medium"
  });
}

function renderKpis() {
  const rows = getAllRowModels();
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

function renderFilters() {
  const counselorOptions = isAdminSession()
    ? `<label>
        Counselor
        <select id="sopCounselorFilter">
          <option value="all">All counselors</option>
          ${getActiveCounselors().map((name) => `<option value="${escapeHtml(name)}" ${filter.counselor === name ? "selected" : ""}>${escapeHtml(name)}</option>`).join("")}
        </select>
      </label>`
    : "";


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
      ${counselorOptions}
      <label class="sop-filter-grid__search">
        Search
        <input id="sopQueryFilter" type="search" value="${escapeHtml(filter.query)}" placeholder="Lead, phone, course, counselor..." />
      </label>
    </div>
    ${false && isAdminSession() ? `
      <div class="sop-assign-bar">
        <span class="block-help">Blocked selected: ${blockedSelectedRows.length}</span>
        <select id="sopAssignCounselor">
          <option value="">Assign blocked leads to…</option>
          ${getActiveCounselors().map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("")}
        </select>
        <button type="button" class="btn-primary" id="sopAssignSelectedBtn" ${blockedSelectedRows.length && !bulkAssignInFlight ? "" : "disabled"}>${bulkAssignInFlight ? "Assigning..." : "Reassign Blocked Leads"}</button>
      </div>
    ` : ""}
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
  document.getElementById("sopQueryFilter")?.addEventListener("input", (event) => {
    filter.query = event.target.value;
    currentPage = 1;
    render();
  });
  document.getElementById("sopAssignSelectedBtn")?.addEventListener("click", () => {
    void reassignBlockedLeads();
  });
}

function renderAdminSummary() {
  if (!isAdminSession()) {
    adminSummary.classList.add("hidden");
    adminSummary.innerHTML = "";
    return;
  }

  const byCounselor = new Map();
  getAllRowModels().forEach((model) => {
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

  const rows = [...byCounselor.values()].sort((left, right) => {
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
          ${rows.map((row) => `
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

function renderLeadTable() {
  const rows = getFilteredRows();
  const totalPages = ensureValidPage(rows.length);
  const pageRows = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const pageBlockedRows = pageRows.filter((row) => row.sop?.blocked);
  const pageBlockedKeys = pageBlockedRows.map((row) => row.key);
  selectedBlockedLeadKeys = new Set([...selectedBlockedLeadKeys].filter((key) => pageBlockedKeys.includes(key)));
  const selectedBlockedRows = pageBlockedRows.filter((row) => selectedBlockedLeadKeys.has(row.key));
  const allPageBlockedSelected = pageBlockedKeys.length > 0 && pageBlockedKeys.every((key) => selectedBlockedLeadKeys.has(key));

  leadTable.innerHTML = `
    <div class="section-head">
      <div>
        <h2>${isAdminSession() ? "Admission Reallocation Queue" : "My Admission SOP Queue"}</h2>
        <p class="block-help">${isAdminSession() ? "Blocked leads can be reassigned here. All admission leads remain visible for counselor-wise diagnosis." : "These are your admission-side leads, sorted by urgency and SOP risk."}</p>
      </div>
    </div>
    ${isAdminSession() ? `
      <div class="bulk-select-actions sop-bulk-toolbar">
        <label class="bulk-select-control sop-bulk-toolbar__select-all">
          <input type="checkbox" id="sopSelectAllPageBlocked" ${allPageBlockedSelected ? "checked" : ""} ${pageBlockedKeys.length ? "" : "disabled"} />
          <span>Select All</span>
        </label>
        <span class="selected-count">Selected: ${selectedBlockedRows.length}</span>
        <div class="bulk-admin-tools">
          <input type="text" class="bulk-count-input" placeholder="Count" disabled />
          <button type="button" class="btn-ghost bulk-action-btn" disabled>Select Count</button>
          <select id="sopAssignCounselor" class="bulk-assign-select">
            <option value="">Assign to</option>
            ${getActiveCounselors().map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("")}
          </select>
          <button type="button" class="btn-ghost bulk-action-btn" id="sopAssignSelectedBtn" ${selectedBlockedRows.length && !bulkAssignInFlight ? "" : "disabled"}>${bulkAssignInFlight ? "Assigning..." : "Assign Selected"}</button>
        </div>
      </div>
    ` : ""}
    <div class="table-shell">
      <table class="data-table sop-lead-table">
        <thead>
          <tr>
            ${isAdminSession() ? "<th>Select</th>" : ""}
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
              ${isAdminSession() ? `
                <td>
                  ${model.sop?.blocked ? `
                    <input type="checkbox" data-lead-key="${escapeHtml(model.key)}" ${selectedBlockedLeadKeys.has(model.key) ? "checked" : ""} />
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
                  <button type="button" class="btn-ghost btn-sm" data-history-key="${escapeHtml(model.key)}">Activity History</button>
                  <button type="button" class="btn-ghost btn-sm" data-open-key="${escapeHtml(model.key)}">Open Section</button>
                </div>
              </td>
            </tr>
          `).join("") || `<tr><td colspan="${isAdminSession() ? 10 : 9}" class="empty-state">No admission leads match the current SOP filters.</td></tr>`}
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
      const next = new Set(selectedBlockedLeadKeys);
      if (event.target.checked) {
        next.add(leadKey);
      } else {
        next.delete(leadKey);
      }
      selectedBlockedLeadKeys = next;
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

  document.getElementById("sopAssignSelectedBtn")?.addEventListener("click", () => {
    void reassignBlockedLeads();
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

  leadTable.querySelectorAll("[data-open-key]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = String(button.getAttribute("data-open-key") || "");
      const model = getAllRowModels().find((item) => item.key === key);
      if (!model?.sop?.route) return;
      if (typeof window.__dvNavigateToRoute === "function") {
        void window.__dvNavigateToRoute(model.sop.route);
        return;
      }
      window.location.href = model.sop.route;
    });
  });
}

async function reassignBlockedLeads() {
  if (!isAdminSession() || bulkAssignInFlight) return;
  const counselorSelect = document.getElementById("sopAssignCounselor");
  const counselor = String(counselorSelect?.value || "").trim();
  if (!counselor) {
    showToast("Select a counselor first.", true);
    return;
  }
  const selectedRows = getAllRowModels().filter((row) => selectedBlockedLeadKeys.has(row.key) && row.sop?.blocked);
  if (!selectedRows.length) {
    showToast("Select at least one blocked lead to reassign.", true);
    return;
  }

  bulkAssignInFlight = true;
  renderLeadTable();
  const result = await assignLeads(selectedRows.map((row) => buildLeadRef(row.lead)), counselor);
  bulkAssignInFlight = false;
  if (!result?.ok) {
    renderLeadTable();
    showToast(result?.message || "Failed to reassign blocked leads.", true);
    return;
  }

  const summary = formatLeadAssignmentResult(result, selectedRows.length, counselor);
  selectedBlockedLeadKeys = new Set();
  render();
  showToast(summary.message);
}

function render() {
  renderClock();
  renderKpis();
  renderFilters();
  renderAdminSummary();
  renderLeadTable();
}

await bootstrapLocalState();
await refreshState().catch(() => undefined);
render();
window.__dvMarkRouteViewReady?.();

startStatePolling(() => {
  render();
}, 15000);

window.setInterval(() => {
  render();
}, 30000);
