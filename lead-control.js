import { registerPageCleanup } from "./page-runtime.js";
import { apiUrl } from "./api-client.js";
import {
  CRM_FIXED_COURSE_OPTIONS,
  getCanonicalPublicCourseIdentity
} from "./course-catalog.js";
import {
  bootstrapLocalState,
  acceptServerState,
  getAllocation as getStoredAllocation,
  getCounselors as getStoredCounselors,
  getSession,
  getStateSnapshot,
  replaceStateSnapshot,
  syncStateFromLocalAndVerify,
  getCoursePriorities
} from "./state-sync.js";
import { createRenderScheduler, withButtonBusy } from "./ui-feedback.js";
await bootstrapLocalState({ skipStateRefresh: true });

const adminImportPanel = document.getElementById("adminImportPanel");
const leadImportFile = document.getElementById("leadImportFile");
const importLeadsBtn = document.getElementById("importLeadsBtn");
const importSummary = document.getElementById("importSummary");
const importMessage = document.getElementById("importMessage");
const importedFileSelect = document.getElementById("importedFileSelect");
const importedFileDetails = document.getElementById("importedFileDetails");
const deleteImportedFileBtn = document.getElementById("deleteImportedFileBtn");
const importedFilesMessage = document.getElementById("importedFilesMessage");
const allocationRows = document.getElementById("allocationRows");
const saveAllocationBtn = document.getElementById("saveAllocationBtn");
const allocationMessage = document.getElementById("allocationMessage");
const exportBackupBtn = document.getElementById("exportBackupBtn");
const restoreBackupFile = document.getElementById("restoreBackupFile");
const restoreBackupBtn = document.getElementById("restoreBackupBtn");
const backupMessage = document.getElementById("backupMessage");
const admissionSopToggle = document.getElementById("admissionSopToggle");
const saveSopSettingsBtn = document.getElementById("saveSopSettingsBtn");
const sopToggleStatus = document.getElementById("sopToggleStatus");
const sopSettingsMessage = document.getElementById("sopSettingsMessage");
const leadSearchFile = document.getElementById("leadSearchFile");
const runLeadSearchBtn = document.getElementById("runLeadSearchBtn");
const exportLeadSearchReportBtn = document.getElementById("exportLeadSearchReportBtn");
const leadSearchSummary = document.getElementById("leadSearchSummary");
const leadSearchResults = document.getElementById("leadSearchResults");
const leadSearchMessage = document.getElementById("leadSearchMessage");
const session = getSession();
const isAdmin = session?.role === "admin" || session?.role === "super_admin";
const isSuperAdmin = session?.role === "super_admin";
let allocationPanelDirty = false;
let importedFileRows = [];
let latestLeadSearchReport = null;

const DEFAULT_ALLOCATION = [];
const ROUTING_META_TYPE = "routing-meta";
const ROUTING_COURSES = CRM_FIXED_COURSE_OPTIONS.map((course) => ({
  id: course.id,
  label: course.label
}));
const WORKSHOP_IMPORT_CATEGORIES = [
  { id: "excel", label: "Excel", pattern: /\bexcel\b/i },
  { id: "power-bi", label: "Power BI", pattern: /\bpower\s*bi\b|\bpowerbi\b|\bpbi\b/i },
  { id: "sql", label: "SQL", pattern: /\bsql\b/i },
  { id: "python", label: "Python", pattern: /\bpython\b/i },
  { id: "gen-ai", label: "Gen AI", pattern: /\bgen\s*ai\b|\bgenai\b|\bgenerative\s*ai\b|\bagentic\b/i },
  { id: "cyber-ai", label: "Cyber AI", pattern: /\bcyber\s*ai\b|\bcyberai\b|\bcyber\s*security\b|\bcybersecurity\b|\bapcs\b/i },
  { id: "master-class", label: "Master Class", pattern: /\bmaster\s*class\b|\bmasterclass\b/i }
];

function toIsoDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

function formatDateTime(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "Not available";
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return raw;
  }

  return parsed.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function getLeadImportSourceFiles(lead) {
  if (Array.isArray(lead?.importSourceFiles)) {
    return lead.importSourceFiles.map((name) => String(name || "").trim()).filter(Boolean);
  }

  const fallback = String(lead?.importSourceFile || "").trim();
  return fallback ? [fallback] : [];
}

function getLeadActivityUpdateCount(lead) {
  const workshopUpdates = typeof lead?.workshopActivityTouchedByAssignee === "boolean"
    ? (lead.workshopActivityTouchedByAssignee ? 1 : 0)
    : Array.isArray(lead?.workshopActivityHistory)
      ? lead.workshopActivityHistory.length
      : Number(lead?.preActivityUpdates) || 0;
  const admissionUpdates = typeof lead?.admissionActivityTouchedByAssignee === "boolean"
    ? (lead.admissionActivityTouchedByAssignee ? 1 : 0)
    : Array.isArray(lead?.admissionActivityHistory)
      ? lead.admissionActivityHistory.length
      : Number(lead?.postActivityUpdates) || 0;

  return workshopUpdates + admissionUpdates;
}

function isLostLead(lead) {
  return lead.postStatusUpdated && lead.courseStatus === "Not Interested";
}

function isPostWorkshopLead(lead) {
  return lead.wsStatus === "Interested" && lead.whatsappInvite === "Yes";
}

function normalizeLeadFields(leads) {
  leads.forEach((lead) => {
    lead.name = lead.name || "";
    lead.email = (lead.email || "").toLowerCase();
    lead.normalizedEmail = lead.normalizedEmail || lead.email;
    lead.normalizedPhone = lead.normalizedPhone || normalizeDuplicatePhone(lead.phone);
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
    lead.workshopActivityTouchedByAssignee = typeof lead.workshopActivityTouchedByAssignee === "boolean"
      ? lead.workshopActivityTouchedByAssignee
      : lead.preActivityUpdates > 0;
    lead.admissionActivityTouchedByAssignee = typeof lead.admissionActivityTouchedByAssignee === "boolean"
      ? lead.admissionActivityTouchedByAssignee
      : lead.postActivityUpdates > 0;
    lead.whatsappGroupStatus = lead.whatsappGroupStatus || "";
    lead.leadNotes = Array.isArray(lead.leadNotes) ? lead.leadNotes : [];
  });
}

function normalizeLeadStatus(value) {
  const status = String(value || "").trim();
  if (!status || status.toLowerCase() === "select") {
    return "New";
  }

  return status;
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

async function loadLeadControlDirectory() {
  const { response, json } = await fetchJsonWithTimeout(apiUrl("/api/account-directory"), {
    method: "GET",
    headers: { Accept: "application/json" }
  }, 8000);

  if (!response.ok) {
    throw new Error(json?.message || "Could not load account directory.");
  }

  replaceStateSnapshot({
    ...getStateSnapshot(),
    counselors: Array.isArray(json?.counselors) ? json.counselors : [],
    allocation: Array.isArray(json?.allocation) ? json.allocation : [],
    adminUsers: Array.isArray(json?.adminUsers) ? json.adminUsers : [],
    marketingUsers: Array.isArray(json?.marketingUsers) ? json.marketingUsers : [],
    admissionSopEnabled: json?.admissionSopEnabled !== false,
    coursePriorities: Array.isArray(json?.coursePriorities) ? json.coursePriorities : [],
    updatedAt: json?.updatedAt || new Date().toISOString(),
    clearedAt: json?.clearedAt || null
  });
  applySopSettingsToUi(json || {});
  await hydrateAllocationPanel();
}

async function loadLeadControlWorkshopLeads() {
  const { response, json } = await fetchJsonWithTimeout(apiUrl("/api/leads?monitoringSubsection=workshop-calling"), {
    method: "GET",
    headers: { Accept: "application/json" }
  }, 12000);

  if (!response.ok) {
    throw new Error(json?.message || "Could not load current workshop leads.");
  }

  replaceStateSnapshot({
    ...getStateSnapshot(),
    leads: Array.isArray(json) ? json : []
  });
}

function applySopSettingsToUi(settings = {}) {
  if (!admissionSopToggle) {
    return;
  }
  const enabled = settings.admissionSopEnabled !== false;
  admissionSopToggle.checked = enabled;
  if (sopToggleStatus) {
    sopToggleStatus.textContent = enabled
      ? "SOP enforcement is currently ON."
      : "SOP enforcement is currently OFF.";
  }
}

async function loadSopSettings() {
  if (!isSuperAdmin || !admissionSopToggle) {
    return;
  }
  const { response, json } = await fetchJsonWithTimeout(apiUrl("/api/admin/sop-settings"), {
    method: "GET",
    headers: { Accept: "application/json" }
  }, 8000);
  if (!response.ok || json?.ok === false) {
    throw new Error(json?.message || "Could not load SOP settings.");
  }
  applySopSettingsToUi(json || {});
}

async function saveSopSettings() {
  if (!isSuperAdmin || !admissionSopToggle) {
    return { ok: false, message: "Only Super Admin can update SOP settings." };
  }
  const enabled = admissionSopToggle.checked;
  const { response, json } = await fetchJsonWithTimeout(apiUrl("/api/admin/sop-settings"), {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({ admissionSopEnabled: enabled })
  }, 10000);
  if (!response.ok || json?.ok === false) {
    return { ok: false, message: json?.message || "Failed to save SOP setting." };
  }
  replaceStateSnapshot({
    ...getStateSnapshot(),
    admissionSopEnabled: json.admissionSopEnabled !== false,
    admissionSopEnabledAt: json.admissionSopEnabledAt || null,
    admissionSopUpdatedBy: json.admissionSopUpdatedBy || "",
    updatedAt: json.updatedAt || new Date().toISOString()
  });
  applySopSettingsToUi(json || {});
  return { ok: true };
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

  const { response, json } = await fetchJsonWithTimeout(apiUrl("/api/leads?monitoringSubsection=workshop-calling"), {
    method: "GET",
    headers: { Accept: "application/json" }
  }, 4000);

  if (!response.ok) {
    return { ok: false, message: "Could not confirm counselor assignment from the backend." };
  }

  const backendLeads = Array.isArray(json) ? json : [];
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

async function saveUniversalImportedLeads(leads, allocationWithMeta) {
  const { response, json } = await fetchJsonWithTimeout(apiUrl("/api/leads/universal-import"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    credentials: "same-origin",
    body: JSON.stringify({
      leads,
      allocation: allocationWithMeta
    })
  }, 60000);

  if (!response.ok || json?.ok === false) {
    return { ok: false, message: json?.message || "Failed to save imported leads." };
  }

  if (json?.state) {
    acceptServerState(json.state, response.headers.get("etag"));
  }

  return { ok: true, ...json };
}

async function loadImportedFiles() {
  if (!isAdmin || !importedFileSelect) {
    return;
  }

  const { response, json } = await fetchJsonWithTimeout(apiUrl("/api/leads/import-files"), {
    method: "GET",
    headers: { Accept: "application/json" },
    credentials: "same-origin"
  }, 12000);

  if (!response.ok || json?.ok === false) {
    throw new Error(json?.message || "Failed to load imported files.");
  }

  importedFileRows = Array.isArray(json?.files) ? json.files : [];
  renderImportedFiles();
}

async function deleteImportedFileData(fileName) {
  const normalized = String(fileName || "").trim();
  if (!normalized) {
    return { ok: false, message: "Import file name is required." };
  }

  const { response, json } = await fetchJsonWithTimeout(apiUrl(`/api/leads/import-files/${encodeURIComponent(normalized)}`), {
    method: "DELETE",
    headers: { Accept: "application/json" },
    credentials: "same-origin"
  }, 30000);

  if (!response.ok || json?.ok === false) {
    return { ok: false, message: json?.message || "Failed to delete imported file data." };
  }

  if (json?.state) {
    acceptServerState(json.state, response.headers.get("etag"));
  }

  importedFileRows = importedFileRows.filter((item) => String(item.fileName || "").trim() !== normalized);
  return { ok: true, ...json };
}

async function saveAllocation(allocation) {
  const { response, json } = await fetchJsonWithTimeout(apiUrl("/api/allocation"), {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    credentials: "same-origin",
    body: JSON.stringify(Array.isArray(allocation) ? allocation : [])
  }, 10000);

  if (!response.ok || json?.ok === false) {
    return { ok: false, message: json?.message || "Failed to save routing rules." };
  }

  replaceStateSnapshot({
    ...getStateSnapshot(),
    allocation: Array.isArray(allocation) ? allocation : [],
    updatedAt: json?.updatedAt || new Date().toISOString()
  });
  return { ok: true };
}

function getRawAllocation() {
  const allocation = getStoredAllocation();
  if (!Array.isArray(allocation) || !allocation.length) {
    return structuredClone(DEFAULT_ALLOCATION);
  }

  return allocation;
}

function isRoutingMeta(item) {
  return item?.type === ROUTING_META_TYPE;
}

function getRoutingMeta(allocation = getRawAllocation()) {
  const meta = allocation.find(isRoutingMeta);
  return {
    type: ROUTING_META_TYPE,
    routeCounters: {
      workshop: Number(meta?.routeCounters?.workshop) || 0,
      courses: meta?.routeCounters?.courses && typeof meta.routeCounters.courses === "object"
        ? { ...meta.routeCounters.courses }
        : {}
    }
  };
}

function getAllocation() {
  const allocation = getRawAllocation().filter((item) => !isRoutingMeta(item));
  return allocation
    .map((item) => {
      const coursePermissions = item.coursePermissions && typeof item.coursePermissions === "object"
        ? item.coursePermissions
        : item.admissionCoursePermissions && typeof item.admissionCoursePermissions === "object"
          ? item.admissionCoursePermissions
          : {};
      return {
        name: String(item.name || "").trim(),
        workshopEnabled: item.workshopEnabled !== false && item.roundRobinEnabled !== false,
        coursePermissions: Object.fromEntries(ROUTING_COURSES.map((course) => [
          course.id,
          Boolean(coursePermissions[course.id])
        ]))
      };
    })
    .filter((item) => item.name);
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
    const { response, json } = await fetchJsonWithTimeout(apiUrl("/api/account-directory"), {
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

function mergeAllocationNames(names, existingAllocation) {
  const byName = new Map(
    existingAllocation.map((item) => [String(item.name || "").trim().toLowerCase(), item])
  );

  return names.map((name) => ({
    name,
    workshopEnabled: byName.get(name.toLowerCase())?.workshopEnabled === true,
    coursePermissions: {
      ...(byName.get(name.toLowerCase())?.coursePermissions || {})
    }
  }));
}

function validateAllocation(allocation) {
  const cleaned = allocation
    .map((item) => ({
      name: String(item.name || "").trim(),
      workshopEnabled: item.workshopEnabled === true,
      coursePermissions: Object.fromEntries(ROUTING_COURSES.map((course) => [
        course.id,
        Boolean(item.coursePermissions?.[course.id])
      ]))
    }))
    .filter((item) => item.name);

  if (!cleaned.length) {
    return { ok: false, message: "Add at least one counselor routing rule." };
  }

  const hasAnyRule = cleaned.some((item) => (
    item.workshopEnabled ||
    ROUTING_COURSES.some((course) => item.coursePermissions[course.id])
  ));
  if (!hasAnyRule) {
    return { ok: false, message: "Enable Workshop or at least one course for one counselor." };
  }

  return { ok: true, cleaned };
}

function renderAllocationRows(allocation) {
  if (!allocation.length) {
    allocationRows.innerHTML = `
      <p class="block-help">No counselors found yet. Add counselors in Counselor Management.</p>
    `;
    return;
  }

  allocationRows.innerHTML = allocation
    .map(
      (item, index) => `
        <div class="allocation-row universal-routing-row" data-index="${index}" style="grid-template-columns:minmax(160px,1.2fr) repeat(${ROUTING_COURSES.length + 1}, minmax(86px, auto));align-items:center;overflow-x:auto;">
          <input type="text" class="allocation-name" value="${escapeHtml(item.name)}" placeholder="Counselor name" />
          ${ROUTING_COURSES.map((course) => `
            <label class="routing-toggle" title="${escapeHtml(course.label)}">
              <input type="checkbox" class="allocation-course-toggle" data-course-id="${escapeHtml(course.id)}" ${item.coursePermissions?.[course.id] ? "checked" : ""} />
              <span>${escapeHtml(course.label)}</span>
            </label>
          `).join("")}
          <label class="routing-toggle" title="Workshop leads">
            <input type="checkbox" class="allocation-workshop-toggle" ${item.workshopEnabled ? "checked" : ""} />
            <span>Workshop</span>
          </label>
        </div>
      `
    )
    .join("");
}

function readAllocationFromForm() {
  const names = Array.from(document.querySelectorAll(".allocation-name"));

  return names.map((nameInput) => {
    const row = nameInput.closest(".allocation-row");
    const coursePermissions = {};
    row?.querySelectorAll(".allocation-course-toggle").forEach((input) => {
      const courseId = input.getAttribute("data-course-id");
      if (courseId) {
        coursePermissions[courseId] = input.checked;
      }
    });
    return {
      name: nameInput.value,
      workshopEnabled: Boolean(row?.querySelector(".allocation-workshop-toggle")?.checked),
      coursePermissions
    };
  });
}

async function hydrateAllocationPanel({ force = false } = {}) {
  if (!allocationRows || !isAdmin) {
    return;
  }

  if (allocationPanelDirty && !force) {
    return;
  }

  const names = await getCounselorNamesForAllocation();
  const existing = getAllocation();
  const merged = mergeAllocationNames(names, existing);

  if (!merged.length) {
    renderAllocationRows([]);
    return;
  }

  renderAllocationRows(merged);
}

function getEligibleCounselorsForLead(lead, allocation) {
  if (lead.leadPipeline === "main-admission") {
    const courseId = String(lead.courseId || "").trim();
    return allocation.filter((rule) => Boolean(rule.coursePermissions?.[courseId]));
  }
  return allocation.filter((rule) => rule.workshopEnabled);
}

function assignLeadByRoundRobin(lead, allocation, meta) {
  const eligible = getEligibleCounselorsForLead(lead, allocation);
  if (!eligible.length) {
    return "Unassigned";
  }

  if (lead.leadPipeline === "main-admission") {
    const courseId = String(lead.courseId || "unknown").trim() || "unknown";
    const current = Number(meta.routeCounters.courses[courseId]) || 0;
    const counselor = eligible[current % eligible.length]?.name || "Unassigned";
    meta.routeCounters.courses[courseId] = current + 1;
    return counselor;
  }

  const current = Number(meta.routeCounters.workshop) || 0;
  const counselor = eligible[current % eligible.length]?.name || "Unassigned";
  meta.routeCounters.workshop = current + 1;
  return counselor;
}

function normalizeHeader(key) {
  return String(key || "")
    .trim()
    .toLowerCase()
    .replace(/[_\s-]+/g, "");
}

function pickValue(row, aliases) {
  const entries = Object.entries(row).map(([key, value]) => [normalizeHeader(key), value]);
  const normalizedAliases = aliases.map((alias) => normalizeHeader(alias));

  for (const alias of normalizedAliases) {
    const exactMatch = entries.find(([key]) => key === alias);
    if (exactMatch && String(exactMatch[1]).trim() !== "") {
      return exactMatch[1];
    }
  }

  for (const alias of normalizedAliases) {
    const partialMatch = entries.find(([key]) => key.includes(alias) || alias.includes(key));
    if (partialMatch && String(partialMatch[1]).trim() !== "") {
      return partialMatch[1];
    }
  }

  return "";
}

function isPhoneHeader(key) {
  const normalized = normalizeHeader(key);
  return ["phone", "phonenumber", "number", "mobile", "contact", "contactnumber"].some((alias) => {
    const normalizedAlias = normalizeHeader(alias);
    return normalized === normalizedAlias || normalized.includes(normalizedAlias) || normalizedAlias.includes(normalized);
  });
}

function getImportCellValue(cell, header = "", options = {}) {
  if (!cell) {
    return "";
  }

  if (isPhoneHeader(header)) {
    if (options.rejectScientificPhoneText && /^\d+(\.\d+)?e\+?\d+$/i.test(String(cell.w || cell.v || "").trim())) {
      return String(cell.w || cell.v || "").trim();
    }
    if (cell.t === "n" && Number.isFinite(Number(cell.v))) {
      return String(Math.trunc(Number(cell.v)));
    }
    if (cell.v !== undefined && cell.v !== null && String(cell.v).trim() !== "") {
      return String(cell.v).trim();
    }
  }

  if (cell.w !== undefined && cell.w !== null && String(cell.w).trim() !== "") {
    return String(cell.w).trim();
  }

  if (cell.v !== undefined && cell.v !== null) {
    return cell.v;
  }

  return "";
}

function normalizeCreatedAt(value) {
  if (!value) {
    return toIsoDate();
  }

  const trimmedValue = String(value).trim();
  const serialValue = Number(value);
  const looksLikeSerial = trimmedValue !== "" && /^\d+(\.\d+)?$/.test(trimmedValue) && Number.isFinite(serialValue);

  if ((typeof value === "number" || looksLikeSerial) && typeof XLSX !== "undefined" && XLSX.SSF?.parse_date_code) {
    const parsed = XLSX.SSF.parse_date_code(serialValue);
    if (parsed) {
      const date = new Date(parsed.y, parsed.m - 1, parsed.d);
      if (!Number.isNaN(date.getTime())) {
        return toIsoDate(date);
      }
    }
  }

  const asDate = new Date(value);
  if (!Number.isNaN(asDate.getTime())) {
    return toIsoDate(asDate);
  }

  return toIsoDate();
}

function getYearFromIsoDate(value) {
  const match = String(value || "").match(/^(\d{4})-/);
  return match ? Number(match[1]) : new Date().getFullYear();
}

function normalizeTwoDigitYear(value) {
  const year = Number(value);
  if (!Number.isFinite(year)) return new Date().getFullYear();
  if (year < 100) return 2000 + year;
  return year;
}

function buildIsoDateFromParts(day, month, year) {
  const safeDay = Number(day);
  const safeMonth = Number(month);
  const safeYear = normalizeTwoDigitYear(year);
  const date = new Date(safeYear, safeMonth - 1, safeDay);
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== safeYear ||
    date.getMonth() !== safeMonth - 1 ||
    date.getDate() !== safeDay
  ) {
    return "";
  }
  return toIsoDate(date);
}

function formatWorkshopDateLabel(isoDate) {
  const parsed = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function getMonthNumber(value) {
  const key = String(value || "").trim().toLowerCase().slice(0, 3);
  return {
    jan: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    may: 5,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    oct: 10,
    nov: 11,
    dec: 12
  }[key] || 0;
}

function extractWorkshopDateFromName(value, fallbackYear) {
  const text = String(value || "").trim();
  if (!text) {
    return { cleanName: "", dateKey: "", dateLabel: "", rawDateText: "" };
  }

  const year = Number(fallbackYear) || new Date().getFullYear();
  const matchers = [
    {
      pattern: /\b([0-3]?\d)(?:st|nd|rd|th)?[\s._/-]+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:[\s,._/-]+(\d{2,4}))?\b/i,
      build: (match) => buildIsoDateFromParts(match[1], getMonthNumber(match[2]), match[3] || year)
    },
    {
      pattern: /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)[\s._/-]+([0-3]?\d)(?:st|nd|rd|th)?(?:[\s,._/-]+(\d{2,4}))?\b/i,
      build: (match) => buildIsoDateFromParts(match[2], getMonthNumber(match[1]), match[3] || year)
    },
    {
      pattern: /\b([0-3]?\d)[/-]([01]?\d)(?:[/-](\d{2,4}))?\b/,
      build: (match) => buildIsoDateFromParts(match[1], match[2], match[3] || year)
    }
  ];

  for (const matcher of matchers) {
    const match = text.match(matcher.pattern);
    if (!match) continue;
    const dateKey = matcher.build(match);
    if (!dateKey) continue;
    const cleanName = text
      .replace(match[0], " ")
      .replace(/\b(on|date|dated)\b/gi, " ")
      .replace(/[\s._/-]+$/g, "")
      .replace(/^[\s._/-]+/g, "")
      .replace(/[\s._/-]{2,}/g, " ")
      .trim();
    return {
      cleanName: cleanName || text,
      dateKey,
      dateLabel: formatWorkshopDateLabel(dateKey),
      rawDateText: match[0]
    };
  }

  return { cleanName: text, dateKey: "", dateLabel: "", rawDateText: "" };
}

function normalizeDuplicatePhone(value) {
  let raw = String(value || "").trim();
  
  // Strip common prefix like p:
  raw = raw.replace(/^[a-zA-Z]:/, "").trim();

  // Handle scientific notation string
  if (/^\d+(\.\d+)?[eE][+-]?\d+$/.test(raw)) {
    const num = Number(raw);
    if (Number.isFinite(num)) {
      const str = String(Math.trunc(num));
      if (str.endsWith("00000")) {
        return ""; // Reject due to precision loss
      }
      raw = str;
    }
  }

  return raw.replace(/\.0+$/, "").replace(/\D+/g, "").trim();
}

function normalizeImportedPhone(value) {
  const normalized = normalizeDuplicatePhone(value);
  if (!normalized) return "";
  if (normalized.length === 10) return normalized;
  if (normalized.length === 12 && normalized.startsWith("91")) return normalized.slice(2);
  return "";
}

function getImportDescriptor(row, sheetName = "") {
  return String(pickValue(row, [
    "form",
    "workshop",
    "workshopname",
    "course",
    "coursename",
    "program",
    "programname",
    "sourceform"
  ]) || sheetName || "").trim();
}

function normalizeImportDescriptorText(value) {
  return String(value || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/[()]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isWorkshopImportDescriptor(value) {
  const text = normalizeImportDescriptorText(value).toLowerCase();
  return /\bworkshop\b|\bmaster\s*class\b|\bwebinar\b|\bbootcamp\b/.test(text);
}

function getCourseIdentityFromImport(value) {
  const identity = getCanonicalPublicCourseIdentity(value);
  const matchedFixedCourse = ROUTING_COURSES.find((course) => course.id === identity.id);
  return {
    id: matchedFixedCourse?.id || "",
    label: matchedFixedCourse?.label || ""
  };
}

function getWorkshopCategoryFromImport(value) {
  const descriptor = normalizeImportDescriptorText(value);
  if (!descriptor) return null;
  return WORKSHOP_IMPORT_CATEGORIES.find((category) => category.pattern.test(descriptor)) || null;
}

function mergeImportedLead(existingLead, importedLead) {
  const preservedWorkshopHistory = Array.isArray(existingLead.workshopActivityHistory)
    ? existingLead.workshopActivityHistory
    : [];
  const preservedAdmissionHistory = Array.isArray(existingLead.admissionActivityHistory)
    ? existingLead.admissionActivityHistory
    : [];
  const mergedImportSourceFiles = [...new Set([
    ...getLeadImportSourceFiles(existingLead),
    ...getLeadImportSourceFiles(importedLead)
  ])];
  const mergedImportSourceSheets = [...new Set([
    ...(Array.isArray(existingLead.importSourceSheets) ? existingLead.importSourceSheets : existingLead.importSourceSheet ? [existingLead.importSourceSheet] : []),
    ...(Array.isArray(importedLead.importSourceSheets) ? importedLead.importSourceSheets : importedLead.importSourceSheet ? [importedLead.importSourceSheet] : [])
  ].map((name) => String(name || "").trim()).filter(Boolean))];

  return {
    ...existingLead,
    ...importedLead,
    id: existingLead.id,
    counselor: existingLead.counselor || importedLead.counselor || "Unassigned",
    importSourceFiles: mergedImportSourceFiles,
    importSourceSheets: mergedImportSourceSheets,
    workshopActivityHistory: preservedWorkshopHistory,
    admissionActivityHistory: preservedAdmissionHistory,
    preActivityUpdates: preservedWorkshopHistory.length,
    postActivityUpdates: preservedAdmissionHistory.length,
    workshopActivityTouchedByAssignee: typeof existingLead.workshopActivityTouchedByAssignee === "boolean"
      ? existingLead.workshopActivityTouchedByAssignee
      : preservedWorkshopHistory.length > 0,
    admissionActivityTouchedByAssignee: typeof existingLead.admissionActivityTouchedByAssignee === "boolean"
      ? existingLead.admissionActivityTouchedByAssignee
      : preservedAdmissionHistory.length > 0,
    postStatusUpdated: typeof existingLead.postStatusUpdated === "boolean" ? existingLead.postStatusUpdated : false
  };
}

function buildLeadFromImportRow(row, id, workshopName, sourceFileName) {
  const name = String(pickValue(row, ["studentname", "fullname", "leadname", "name"])).trim();
  const email = String(pickValue(row, ["emailaddress", "emailid", "mail", "email"])).trim().toLowerCase();
  const phone = normalizeImportedPhone(pickValue(row, ["phone", "phonenumber", "number", "mobile", "contact", "contactnumber"]));
  const descriptor = getImportDescriptor(row, workshopName);
  const createdAt = normalizeCreatedAt(pickValue(row, ["created", "createdat", "date", "leadcreated", "createdon"]));
  const isWorkshopLead = isWorkshopImportDescriptor(descriptor);

  if (!name) {
    return { error: "Name is required." };
  }

  if (!phone) {
    return { error: "Phone Number is required." };
  }

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "Valid email is required when provided." };
  }

  if (!descriptor) {
    return { error: "Workshop or Course Name is required." };
  }

  if (!isWorkshopLead) {
    const course = getCourseIdentityFromImport(descriptor);
    if (!course.id) {
      return { error: `Course is not recognized for admission routing: ${descriptor}` };
    }
    return {
      lead: {
        id,
        name,
        email,
        phone,
        normalizedEmail: email,
        normalizedPhone: normalizeDuplicatePhone(phone),
        courseName: course.label,
        courseId: course.id,
        courseCode: course.label,
        leadPipeline: "main-admission",
        publicCourseSegment: course.id === "days7_genai" ? "crash-course" : "standard",
        createdAt,
        createdAtExact: new Date().toISOString(),
        counselor: "Unassigned",
        mainAdmissionDialed: "",
        mainAdmissionCoursePitched: course.label,
        mainAdmissionCourseStatus: "",
        mainAdmissionAdmissionStatus: "",
        mainAdmissionCallStatus: "",
        mainAdmissionActivityUpdated: false,
        mainAdmissionActivityUpdates: 0,
        mainAdmissionActivityTouchedByAssignee: false,
        mainAdmissionActivityHistory: [],
        leadNotes: [],
        importSourceFiles: [String(sourceFileName || "").trim()].filter(Boolean),
        importSourceSheets: [String(workshopName || "").trim()].filter(Boolean),
        importSourceSheet: String(workshopName || "").trim(),
        elementorFormName: descriptor,
        source: "Universal Import",
        leadSource: "Universal Import"
      }
    };
  }

  const parsedWorkshop = extractWorkshopDateFromName(descriptor, getYearFromIsoDate(createdAt));
  const workshopCategory = getWorkshopCategoryFromImport(parsedWorkshop.cleanName || descriptor);
  if (!workshopCategory) {
    return { error: `Workshop category is not recognized: ${descriptor}` };
  }

  const workshop = workshopCategory.label;
  const lead = {
    id,
    name,
    email,
    phone,
    normalizedEmail: email,
    normalizedPhone: normalizeDuplicatePhone(phone),
    workshop,
    workshopName: workshop,
    workshopCategoryId: workshopCategory.id,
    workshopRawName: descriptor,
    workshopDateKey: parsedWorkshop.dateKey,
    workshopDateLabel: parsedWorkshop.dateLabel,
    workshopDateRawText: parsedWorkshop.rawDateText,
    status: normalizeLeadStatus(pickValue(row, ["status"])),
    createdAt,
    createdAtExact: new Date().toISOString(),
    dialed: "",
    callStatus: "",
    wsStatus: "",
    whatsappInvite: "",
    counselor: "Unassigned",
    postDialed: "",
    coursePitched: "",
    courseStatus: "",
    admissionStatus: "",
    postStatusUpdated: false,
    preActivityUpdates: 0,
    postActivityUpdates: 0,
    workshopActivityHistory: [],
    admissionActivityHistory: [],
    workshopActivityTouchedByAssignee: false,
    admissionActivityTouchedByAssignee: false,
    whatsappGroupStatus: "",
    leadNotes: [],
    importSourceFiles: [String(sourceFileName || "").trim()].filter(Boolean),
    importSourceSheets: [String(row.__workshopName || "").trim()].filter(Boolean),
    importSourceSheet: String(row.__workshopName || "").trim(),
    elementorFormName: descriptor,
    source: "Universal Import",
    leadSource: "Universal Import"
  };

  return { lead };
}

async function parseImportFile(file) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetNames = workbook.SheetNames || [];
  const isCsvImport = /\.csv$/i.test(file.name || "");
  if (!sheetNames.length) {
    return [];
  }

  return sheetNames.flatMap((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet || !sheet["!ref"]) {
      return [];
    }

    const range = XLSX.utils.decode_range(sheet["!ref"]);
    const headers = [];
    for (let col = range.s.c; col <= range.e.c; col += 1) {
      const address = XLSX.utils.encode_cell({ r: range.s.r, c: col });
      headers.push(String(getImportCellValue(sheet[address]) || "").trim());
    }

    return Array.from({ length: Math.max(0, range.e.r - range.s.r) }, (_, rowOffset) => {
      const rowIndex = range.s.r + rowOffset + 1;
      const row = {};
      headers.forEach((header, colOffset) => {
        if (!header) {
          return;
        }
        const colIndex = range.s.c + colOffset;
        const address = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
        row[header] = getImportCellValue(sheet[address], header, {
          rejectScientificPhoneText: isCsvImport
        });
      });
      return {
        ...row,
        __workshopName: sheetName,
        __importSourceFile: file.name
      };
    }).filter((row) => Object.entries(row).some(([key, value]) => !key.startsWith("__") && String(value || "").trim() !== ""));
  });
}

function extractLeadSearchContactsFromText(value, context = {}) {
  const text = String(value || "").trim();
  if (!text) return [];
  const phoneCandidates = text.match(/(?:\+?\d[\d\s().-]{7,}\d)/g) || [];
  return phoneCandidates
    .map((phone) => normalizeImportedPhone(phone))
    .filter(Boolean)
    .map((phone) => ({
      phone,
      label: context.label || "",
      source: context.source || ""
    }));
}

async function parseLeadSearchFile(file) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: false });
  const contactsByKey = new Map();

  (workbook.SheetNames || []).forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet || !sheet["!ref"]) return;
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
    rows.forEach((row, rowIndex) => {
      const rowText = (Array.isArray(row) ? row : []).map((cell) => String(cell || "").trim()).filter(Boolean).join(" ");
      (Array.isArray(row) ? row : []).forEach((cell) => {
        extractLeadSearchContactsFromText(cell, {
          label: rowText.slice(0, 120),
          source: `${sheetName} row ${rowIndex + 1}`
        }).forEach((contact) => {
          const key = `phone:${normalizeDuplicatePhone(contact.phone)}`;
          if (key && !contactsByKey.has(key)) {
            contactsByKey.set(key, contact);
          }
        });
      });
    });
  });

  return [...contactsByKey.values()];
}

function renderLeadSearchReport(report = null) {
  const summary = report?.summary || {};
  const missing = Array.isArray(report?.missing) ? report.missing : [];
  const existing = Array.isArray(report?.existing) ? report.existing : [];
  if (leadSearchSummary) {
    leadSearchSummary.innerHTML = `
      <p>Phone numbers found: ${Number(summary.total) || 0}</p>
      <p>Matched CRM leads: ${Number(summary.existing) || 0}</p>
      <p>Not in CRM: ${Number(summary.missing) || 0}</p>
    `;
  }
  if (exportLeadSearchReportBtn) {
    exportLeadSearchReportBtn.disabled = !report || (!existing.length && !missing.length);
  }
  if (!leadSearchResults) return;
  if (!report) {
    leadSearchResults.textContent = "";
    return;
  }
  const missingPreview = missing.slice(0, 12).map((item) => (
    `<li>${escapeHtml(item.phone || "Unknown phone")} <span class="text-muted">${escapeHtml(item.source || "")}</span></li>`
  )).join("");
  const existingPreview = existing.slice(0, 8).map((item) => (
    `<li>${escapeHtml(item.phone || "Unknown phone")} - ${escapeHtml(item.leadName || "Existing lead")} ${item.counselor ? `(${escapeHtml(item.counselor)})` : ""} ${item.section ? `- ${escapeHtml(item.section)}` : ""}</li>`
  )).join("");
  leadSearchResults.innerHTML = `
    ${missing.length ? `<strong>Not in CRM preview</strong><ul>${missingPreview}</ul>` : "<p>All uploaded phone numbers were found in CRM.</p>"}
    ${existing.length ? `<strong>Existing preview</strong><ul>${existingPreview}</ul>` : ""}
  `;
}

function downloadLeadSearchReport() {
  const report = latestLeadSearchReport;
  const existing = Array.isArray(report?.existing) ? report.existing : [];
  const missing = Array.isArray(report?.missing) ? report.missing : [];
  if (!existing.length && !missing.length) {
    setMessage(leadSearchMessage, "Run a file search before exporting.", true);
    return;
  }

  const rows = [
    ...existing.map((item) => ({
      "Uploaded Phone": item.phone || "",
      "CRM Status": "Matched",
      "Lead ID": item.leadId || "",
      "Lead Name": item.leadName || "",
      "CRM Phone": item.crmPhone || item.phone || "",
      "Tagged Counselor": item.counselor || "Unassigned",
      "Section": item.section || "",
      "Course / Workshop": item.courseName || item.workshop || "",
      "Source Row": item.source || ""
    })),
    ...missing.map((item) => ({
      "Uploaded Phone": item.phone || "",
      "CRM Status": "Not in CRM",
      "Lead ID": "",
      "Lead Name": "",
      "CRM Phone": "",
      "Tagged Counselor": "",
      "Section": "",
      "Course / Workshop": "",
      "Source Row": item.source || ""
    }))
  ];

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Lead Search Report");
  const dateKey = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(workbook, `lead-search-report-${dateKey}.xlsx`);
  setMessage(leadSearchMessage, `Exported ${rows.length} report row${rows.length === 1 ? "" : "s"}.`, false);
}

async function handleLeadSearchReport() {
  if (!isAdmin) {
    setMessage(leadSearchMessage, "Only admin can search lead files.", true);
    return;
  }
  const file = leadSearchFile?.files?.[0];
  if (!file) {
    setMessage(leadSearchMessage, "Please select a .xlsx or .csv file.", true);
    return;
  }
  if (!/\.(xlsx|csv)$/i.test(file.name)) {
    setMessage(leadSearchMessage, "Unsupported format. Please upload .xlsx or .csv.", true);
    return;
  }

  let contacts = [];
  try {
    contacts = await parseLeadSearchFile(file);
  } catch {
    setMessage(leadSearchMessage, "Could not read file. Check format and try again.", true);
    return;
  }
  if (!contacts.length) {
    latestLeadSearchReport = null;
    renderLeadSearchReport({ summary: { total: 0, existing: 0, missing: 0 }, existing: [], missing: [] });
    setMessage(leadSearchMessage, "No valid phone numbers were found in this file.", true);
    return;
  }

  const { response, json } = await fetchJsonWithTimeout(apiUrl("/api/leads/search-file/report"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({ contacts, fileName: file.name })
  }, 30000);

  if (!response.ok || json?.ok === false) {
    setMessage(leadSearchMessage, json?.message || "Failed to search file contacts.", true);
    return;
  }
  latestLeadSearchReport = json;
  renderLeadSearchReport(json);
  setMessage(leadSearchMessage, `Search complete. ${json.summary?.missing || 0} phone number${Number(json.summary?.missing) === 1 ? "" : "s"} not found in CRM. Use Export Report to download the matched and not-in-CRM file.`, false);
}

function incrementSummaryBucket(summary, key, amount = 1) {
  summary[key] = (Number(summary[key]) || 0) + amount;
}

function classifyImportIssue(message = "") {
  const text = String(message || "").toLowerCase();
  if (text.includes("duplicate") && text.includes("file")) return "duplicateInFile";
  if (text.includes("already exists in crm")) return "duplicateInCrm";
  if (text.includes("course is not recognized")) return "unknownCourse";
  if (text.includes("workshop category is not recognized")) return "unknownWorkshop";
  if (text.includes("required") || text.includes("valid email")) return "missingData";
  return "other";
}

function buildImportIssueLabel(key) {
  return {
    duplicateInFile: "Repeated inside this file",
    duplicateInCrm: "Already exists in CRM",
    unknownCourse: "Course not in CRM list",
    unknownWorkshop: "Workshop category not in CRM list",
    missingData: "Missing or invalid required data",
    unassigned: "Imported but left unassigned",
    other: "Other rows needing review"
  }[key] || "Rows needing review";
}

function updateImportSummary(summary = {}) {
  const total = Number(summary.totalRows) || 0;
  const success = Number(summary.savedCount) || 0;
  const notImported = Number(summary.notImportedCount) || 0;
  const assignedCount = Math.max(0, success - (Number(summary.unassigned) || 0));
  const reviewItems = [
    "duplicateInFile",
    "duplicateInCrm",
    "unknownCourse",
    "unknownWorkshop",
    "missingData",
    "unassigned",
    "other"
  ]
    .map((key) => [key, Number(summary[key]) || 0])
    .filter(([, count]) => count > 0);

  importSummary.innerHTML = `
    <p>Rows checked: ${total}</p>
    <p>New leads added: ${success}</p>
    <p>Assigned to counselors: ${assignedCount}</p>
    <p>Rows not imported: ${notImported}</p>
    ${reviewItems.length ? `
      <div class="import-summary__details">
        ${reviewItems.map(([key, count]) => `<p>${buildImportIssueLabel(key)}: ${count}</p>`).join("")}
      </div>
    ` : ""}
  `;
}

function renderImportedFiles() {
  if (!importedFileSelect) {
    return;
  }

  if (!importedFileRows.length) {
    importedFileSelect.innerHTML = `<option value="">No imported files found</option>`;
    importedFileSelect.disabled = true;
    if (deleteImportedFileBtn) {
      deleteImportedFileBtn.disabled = true;
    }
    if (importedFileDetails) {
      importedFileDetails.textContent = "Only Universal Lead Import .xlsx/.csv files appear here. LSQ history files are excluded.";
    }
    return;
  }

  const previousValue = importedFileSelect.value;
  importedFileSelect.disabled = false;
  importedFileSelect.innerHTML = `
    <option value="">Select imported file</option>
    ${importedFileRows.map((file) => {
      const fileName = String(file.fileName || "").trim();
      const count = Number(file.leadCount) || 0;
      return `<option value="${escapeHtml(fileName)}">${escapeHtml(fileName)} (${count} leads)</option>`;
    }).join("")}
  `;
  if (previousValue && importedFileRows.some((file) => String(file.fileName || "").trim() === previousValue)) {
    importedFileSelect.value = previousValue;
  }
  updateImportedFileDetails();
}

function updateImportedFileDetails() {
  const fileName = String(importedFileSelect?.value || "").trim();
  const selected = importedFileRows.find((file) => String(file.fileName || "").trim() === fileName);
  if (deleteImportedFileBtn) {
    deleteImportedFileBtn.disabled = !selected;
  }
  if (!importedFileDetails) {
    return;
  }
  if (!selected) {
    importedFileDetails.textContent = "Select an imported Universal Lead Import file to review and delete its leads.";
    return;
  }
  const count = Number(selected.leadCount) || 0;
  const lastImport = formatDateTime(selected.lastImportedAt || selected.lastUpdatedAt || "");
  importedFileDetails.textContent = `${count} lead${count === 1 ? "" : "s"} found. Last import: ${lastImport}.`;
}

async function handleDeleteImportedFile(fileName, button = null) {
  if (!isAdmin) {
    setMessage(importedFilesMessage, "Only admin can delete imported file data.", true);
    return;
  }

  const target = importedFileRows.find((item) => String(item.fileName || "").trim() === String(fileName || "").trim());
  const leadCount = Number(target?.leadCount) || 0;
  const confirmed = window.confirm(`Delete ${leadCount} lead${leadCount === 1 ? "" : "s"} imported from "${fileName}"? This cannot be undone except by restoring a backup.`);
  if (!confirmed) {
    return;
  }

  const result = button
    ? await withButtonBusy(button, "Deleting...", () => deleteImportedFileData(fileName))
    : await deleteImportedFileData(fileName);

  if (!result || result.ok === false) {
    setMessage(importedFilesMessage, result?.message || "Failed to delete imported file data.", true);
    return;
  }

  const deletedCount = Number(result.deletedCount) || 0;
  setMessage(importedFilesMessage, `Deleted ${deletedCount} lead${deletedCount === 1 ? "" : "s"} from ${fileName}.`, false);
  showToast("Imported file data deleted.", false);
  await loadImportedFiles().catch(() => undefined);
}

async function handleLeadImport() {
  if (!isAdmin) {
    setMessage(importMessage, "Only admin can import leads.", true);
    return;
  }

  const file = leadImportFile.files?.[0];
  if (!file) {
    setMessage(importMessage, "Please select a .xlsx or .csv file.", true);
    return;
  }

  if (!/\.(xlsx|csv)$/i.test(file.name)) {
    setMessage(importMessage, "Unsupported format. Please upload .xlsx or .csv.", true);
    return;
  }

  const allocationValidation = validateAllocation(getAllocation());
  if (!allocationValidation.ok) {
    setMessage(importMessage, allocationValidation.message, true);
    return;
  }

  let rows = [];
  try {
    rows = await parseImportFile(file);
  } catch {
    setMessage(importMessage, "Could not read file. Check format and try again.", true);
    return;
  }

  if (!rows.length) {
    setMessage(importMessage, "No rows found in the uploaded file.", true);
    updateImportSummary({ totalRows: 0, savedCount: 0, notImportedCount: 0 });
    return;
  }

  const leadIndexByEmail = new Map();
  const leadIndexByPhone = new Map();

  const importedRecords = [];
  const failed = [];
  const assignmentMisses = [];
  const summaryBuckets = {};
  let createdCount = 0;
  let tempId = Date.now();

  rows.forEach((row, idx) => {
    const { lead, error } = buildLeadFromImportRow(row, tempId, row.__workshopName, row.__importSourceFile);
    if (error) {
      failed.push(`Row ${idx + 2}: ${error}`);
      incrementSummaryBucket(summaryBuckets, classifyImportIssue(error));
      return;
    }

    const duplicateReasons = [];
    if (lead.email && leadIndexByEmail.has(lead.email)) {
      duplicateReasons.push("email address");
    }
    const normalizedPhone = normalizeDuplicatePhone(lead.phone);
    if (normalizedPhone && leadIndexByPhone.has(normalizedPhone)) {
      duplicateReasons.push("phone number");
    }
    if (duplicateReasons.length) {
      const message = `Duplicate ${duplicateReasons.join(" and ")} already exists in this file.`;
      failed.push(`Row ${idx + 2}: ${message}`);
      incrementSummaryBucket(summaryBuckets, classifyImportIssue(message));
      return;
    }

    importedRecords.push({ lead });
    if (lead.email) {
      leadIndexByEmail.set(lead.email, importedRecords.length - 1);
    }
    if (normalizedPhone) {
      leadIndexByPhone.set(normalizedPhone, importedRecords.length - 1);
    }
    createdCount += 1;
    tempId += 1;
  });

  const routingMeta = getRoutingMeta();
  const recordsNeedingAssignment = importedRecords.filter(({ lead }) => {
    const counselor = String(lead.counselor || "").trim().toLowerCase();
    return !counselor || counselor === "unassigned";
  });

  recordsNeedingAssignment.forEach((record) => {
    const assignedCounselor = assignLeadByRoundRobin(record.lead, allocationValidation.cleaned, routingMeta);
    record.lead.counselor = assignedCounselor;
    if (assignedCounselor === "Unassigned") {
      assignmentMisses.push(record.lead.name);
    }
  });

  const importedLeads = importedRecords.map(({ lead }) => lead);
  const importSaveResult = await saveUniversalImportedLeads(importedLeads, [
    ...allocationValidation.cleaned,
    routingMeta
  ]);
  if (!importSaveResult || importSaveResult.ok === false) {
    setMessage(importMessage, importSaveResult?.message || "Failed to save imported leads. Please check your connection and try again.", true);
    return;
  }

  const savedCount = Number(importSaveResult.createdCount) || 0;
  const skippedCount = Number(importSaveResult.skippedCount) || 0;
  const updatedCount = Number(importSaveResult.updatedCount) || 0;
  const serverSkippedLeads = Array.isArray(importSaveResult.skippedLeads) ? importSaveResult.skippedLeads : [];
  serverSkippedLeads.forEach((item) => {
    incrementSummaryBucket(summaryBuckets, classifyImportIssue(item?.reason || ""));
  });
  if (assignmentMisses.length) {
    incrementSummaryBucket(summaryBuckets, "unassigned", assignmentMisses.length);
  }
  updateImportSummary({
    totalRows: rows.length,
    savedCount,
    notImportedCount: failed.length + skippedCount,
    ...summaryBuckets
  });

  if (failed.length) {
    setMessage(importMessage, `Import finished. ${savedCount} new lead${savedCount === 1 ? "" : "s"} added; ${updatedCount} duplicate course${updatedCount === 1 ? "" : "s"} updated; ${failed.length + skippedCount} row${failed.length + skippedCount === 1 ? "" : "s"} not imported.`, true);
  } else if (skippedCount || updatedCount) {
    setMessage(importMessage, `Import finished. ${savedCount} new lead${savedCount === 1 ? "" : "s"} added; ${updatedCount} duplicate course${updatedCount === 1 ? "" : "s"} updated; ${skippedCount} duplicate row${skippedCount === 1 ? "" : "s"} safely skipped.`, false);
  } else if (assignmentMisses.length) {
    setMessage(importMessage, `Imported ${savedCount}. ${assignmentMisses.length} lead${assignmentMisses.length === 1 ? "" : "s"} stayed Unassigned because no matching routing rule was enabled.`, true);
  } else {
    setMessage(importMessage, `Import completed successfully: created ${savedCount} leads.`, false);
  }

  leadImportFile.value = "";
  await loadImportedFiles().catch(() => undefined);
  renderAll();
}

function buildBackupDownloadName(payload) {
  const stamp = String(payload?.exportedAt || new Date().toISOString())
    .replace(/[:.]/g, "-")
    .replace(/Z$/, "Z");
  return `i-crm-backup-${stamp}.json`;
}

async function downloadManualBackup() {
  if (!isAdmin) {
    setMessage(backupMessage, "Only admin can export backups.", true);
    return;
  }

  setMessage(backupMessage, "Preparing backup snapshot...", false);

  const { response, json } = await fetchJsonWithTimeout(apiUrl("/api/admin/backup"), {
    method: "GET",
    headers: {
      Accept: "application/json"
    }
  }, 30000);

  if (!response.ok || !json) {
    setMessage(backupMessage, json?.message || "Failed to export backup snapshot.", true);
    return;
  }

  const fileName = response.headers.get("x-backup-filename") || buildBackupDownloadName(json);
  const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);

  setMessage(backupMessage, `Backup snapshot downloaded successfully as ${fileName}.`, false);
}

async function restoreManualBackup() {
  if (!isAdmin) {
    setMessage(backupMessage, "Only admin can restore backups.", true);
    return;
  }

  const file = restoreBackupFile?.files?.[0];
  if (!file) {
    setMessage(backupMessage, "Select a backup .json file to restore.", true);
    return;
  }

  let payload = null;
  try {
    payload = JSON.parse(await file.text());
  } catch {
    setMessage(backupMessage, "The selected backup file is not valid JSON.", true);
    return;
  }

  const leadCount = Number(payload?.summary?.leads) || 0;
  const confirmed = window.confirm(
    `Restore backup from ${file.name}? This will replace the current CRM database state with the ${leadCount} lead snapshot in that file.`
  );
  if (!confirmed) {
    return;
  }

  setMessage(backupMessage, "Restoring backup snapshot...", false);

  const { response, json } = await fetchJsonWithTimeout(apiUrl("/api/admin/restore"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify(payload)
  }, 60000);

  if (!response.ok || !json?.ok) {
    setMessage(backupMessage, json?.message || "Failed to restore backup snapshot.", true);
    return;
  }

  acceptServerState(json.state, response.headers.get("etag"));

  const syncResult = await syncStateFromLocalAndVerify();
  if (!syncResult.ok) {
    setMessage(backupMessage, syncResult.message || "Backup restored, but backend verification failed afterward.", true);
    return;
  }

  if (restoreBackupFile) {
    restoreBackupFile.value = "";
  }

  const restoredLeadCount = Number(json?.restoredCounts?.leads) || 0;
  const restoredTaskCount = Number(json?.restoredCounts?.tasks) || 0;
  setMessage(backupMessage, `Backup restored successfully. ${restoredLeadCount} leads and ${restoredTaskCount} tasks are now active.`, false);
  showToast("Backup restored successfully.", false);
  renderAll();
}

function buildCustomLeadFromImportRow(row, id, selectedCourseOpt, sourceFileName) {
  const name = String(pickValue(row, ["studentname", "fullname", "leadname", "name"]) || "").trim();
  const email = String(pickValue(row, ["emailaddress", "emailid", "mail", "email"]) || "").trim().toLowerCase();
  const phone = normalizeImportedPhone(pickValue(row, ["phone", "phonenumber", "number", "mobile", "contact", "contactnumber"]));
  const createdAt = normalizeCreatedAt(pickValue(row, ["created", "createdat", "date", "leadcreated", "createdon"]));

  if (!name) {
    return { error: "Name is required." };
  }
  if (!phone) {
    return { error: "Phone Number is required." };
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "Valid email is required when provided." };
  }

  return {
    lead: {
      id,
      name,
      email,
      phone,
      normalizedEmail: email,
      normalizedPhone: normalizeDuplicatePhone(phone),
      courseName: selectedCourseOpt.label,
      courseId: selectedCourseOpt.id,
      courseCode: selectedCourseOpt.label,
      leadPipeline: "main-admission",
      publicCourseSegment: selectedCourseOpt.id === "days7_genai" ? "crash-course" : "standard",
      createdAt,
      createdAtExact: new Date().toISOString(),
      counselor: "Unassigned",
      mainAdmissionDialed: "",
      mainAdmissionCoursePitched: selectedCourseOpt.label,
      mainAdmissionCourseStatus: "",
      mainAdmissionAdmissionStatus: "",
      mainAdmissionCallStatus: "",
      mainAdmissionActivityUpdated: false,
      mainAdmissionActivityUpdates: 0,
      mainAdmissionActivityTouchedByAssignee: false,
      mainAdmissionActivityHistory: [],
      leadNotes: [],
      importSourceFiles: [String(sourceFileName || "").trim()].filter(Boolean),
      importSourceSheets: [String(row.__workshopName || "").trim()].filter(Boolean),
      importSourceSheet: String(row.__workshopName || "").trim(),
      elementorFormName: "Custom Import",
      source: "Custom Import",
      leadSource: "Custom Import"
    }
  };
}

async function handleCustomLeadImport() {
  if (!isAdmin) {
    setMessage(importMessage, "Only admin can import leads.", true);
    return;
  }

  const file = customImportFile.files?.[0];
  if (!file) {
    setMessage(importMessage, "Please select a .xlsx or .csv file for custom import.", true);
    return;
  }

  if (!/\.(xlsx|csv)$/i.test(file.name)) {
    setMessage(importMessage, "Unsupported format. Please upload .xlsx or .csv.", true);
    return;
  }

  const selectedCourseId = customImportCourseSelect.value;
  const courseOpt = CRM_FIXED_COURSE_OPTIONS.find((c) => c.id === selectedCourseId) || { id: "data-analytics-specialist", label: "DAS" };

  const allocationValidation = validateAllocation(getAllocation());
  if (!allocationValidation.ok) {
    setMessage(importMessage, allocationValidation.message, true);
    return;
  }

  let rows = [];
  try {
    rows = await parseImportFile(file);
  } catch {
    setMessage(importMessage, "Could not read file. Check format and try again.", true);
    return;
  }

  if (!rows.length) {
    setMessage(importMessage, "No rows found in the uploaded file.", true);
    updateImportSummary({ totalRows: 0, savedCount: 0, notImportedCount: 0 });
    return;
  }

  const leadIndexByEmail = new Map();
  const leadIndexByPhone = new Map();

  const importedRecords = [];
  const failed = [];
  const assignmentMisses = [];
  const summaryBuckets = {};
  let createdCount = 0;
  let tempId = Date.now();

  rows.forEach((row, idx) => {
    const { lead, error } = buildCustomLeadFromImportRow(row, tempId, courseOpt, file.name);
    if (error) {
      failed.push(`Row ${idx + 2}: ${error}`);
      incrementSummaryBucket(summaryBuckets, classifyImportIssue(error));
      return;
    }

    const duplicateReasons = [];
    if (lead.email && leadIndexByEmail.has(lead.email)) {
      duplicateReasons.push("email address");
    }
    const normalizedPhone = normalizeDuplicatePhone(lead.phone);
    if (normalizedPhone && leadIndexByPhone.has(normalizedPhone)) {
      duplicateReasons.push("phone number");
    }
    if (duplicateReasons.length) {
      const message = `Duplicate ${duplicateReasons.join(" and ")} already exists in this file.`;
      failed.push(`Row ${idx + 2}: ${message}`);
      incrementSummaryBucket(summaryBuckets, classifyImportIssue(message));
      return;
    }

    importedRecords.push({ lead });
    if (lead.email) {
      leadIndexByEmail.set(lead.email, importedRecords.length - 1);
    }
    if (normalizedPhone) {
      leadIndexByPhone.set(normalizedPhone, importedRecords.length - 1);
    }
    createdCount += 1;
    tempId += 1;
  });

  const routingMeta = getRoutingMeta();
  const recordsNeedingAssignment = importedRecords.filter(({ lead }) => {
    const counselor = String(lead.counselor || "").trim().toLowerCase();
    return !counselor || counselor === "unassigned";
  });

  recordsNeedingAssignment.forEach((record) => {
    const assignedCounselor = assignLeadByRoundRobin(record.lead, allocationValidation.cleaned, routingMeta);
    record.lead.counselor = assignedCounselor;
    if (assignedCounselor === "Unassigned") {
      assignmentMisses.push(record.lead.name);
    }
  });

  const importedLeads = importedRecords.map(({ lead }) => lead);
  const importSaveResult = await saveUniversalImportedLeads(importedLeads, [
    ...allocationValidation.cleaned,
    routingMeta
  ]);
  if (!importSaveResult || importSaveResult.ok === false) {
    setMessage(importMessage, importSaveResult?.message || "Failed to save imported leads.", true);
    return;
  }

  const savedCount = Number(importSaveResult.createdCount) || 0;
  const skippedCount = Number(importSaveResult.skippedCount) || 0;
  const updatedCount = Number(importSaveResult.updatedCount) || 0;
  const serverSkippedLeads = Array.isArray(importSaveResult.skippedLeads) ? importSaveResult.skippedLeads : [];
  serverSkippedLeads.forEach((item) => {
    incrementSummaryBucket(summaryBuckets, classifyImportIssue(item?.reason || ""));
  });
  if (assignmentMisses.length) {
    incrementSummaryBucket(summaryBuckets, "unassigned", assignmentMisses.length);
  }
  updateImportSummary({
    totalRows: rows.length,
    savedCount,
    notImportedCount: failed.length + skippedCount,
    ...summaryBuckets
  });

  if (failed.length) {
    setMessage(importMessage, `Import finished. ${savedCount} new lead${savedCount === 1 ? "" : "s"} added; ${updatedCount} duplicate course${updatedCount === 1 ? "" : "s"} updated; ${failed.length + skippedCount} row${failed.length + skippedCount === 1 ? "" : "s"} not imported.`, true);
  } else if (skippedCount || updatedCount) {
    setMessage(importMessage, `Import finished. ${savedCount} new lead${savedCount === 1 ? "" : "s"} added; ${updatedCount} duplicate course${updatedCount === 1 ? "" : "s"} updated; ${skippedCount} duplicate row${skippedCount === 1 ? "" : "s"} safely skipped.`, false);
  } else if (assignmentMisses.length) {
    setMessage(importMessage, `Imported ${savedCount}. ${assignmentMisses.length} lead${assignmentMisses.length === 1 ? "" : "s"} stayed Unassigned because no matching routing rule was enabled.`, true);
  } else {
    setMessage(importMessage, `Import completed successfully: created ${savedCount} leads.`, false);
  }

  customImportFile.value = "";
  await loadImportedFiles().catch(() => undefined);
  renderAll();
}

function renderCoursePriorities() {
  if (!coursePriorityContainer) return;
  const priorities = getCoursePriorities();

  coursePriorityContainer.innerHTML = priorities.map((courseId, idx) => {
    const courseOpt = CRM_FIXED_COURSE_OPTIONS.find((c) => c.id === courseId) || { id: courseId, label: courseId };
    return `
      <div class="priority-row" data-course-id="${courseId}" style="display: flex; justify-content: space-between; align-items: center; padding: var(--space-2) var(--space-3); background: var(--surface-muted); border: 1px solid var(--border); border-radius: var(--radius-md); margin-bottom: var(--space-1);">
        <span style="font-weight: 600; color: var(--text);">${courseOpt.label}</span>
        <div style="display: flex; gap: 6px;">
          <button type="button" class="btn-ghost btn-xs priority-up-btn" data-index="${idx}" ${idx === 0 ? "disabled" : ""} style="padding: 2px 6px;">▲</button>
          <button type="button" class="btn-ghost btn-xs priority-down-btn" data-index="${idx}" ${idx === priorities.length - 1 ? "disabled" : ""} style="padding: 2px 6px;">▼</button>
        </div>
      </div>
    `;
  }).join("");

  coursePriorityContainer.querySelectorAll(".priority-up-btn").forEach((btn) => {
    btn.onclick = (e) => {
      const index = parseInt(e.currentTarget.dataset.index, 10);
      movePriority(index, index - 1);
    };
  });

  coursePriorityContainer.querySelectorAll(".priority-down-btn").forEach((btn) => {
    btn.onclick = (e) => {
      const index = parseInt(e.currentTarget.dataset.index, 10);
      movePriority(index, index + 1);
    };
  });
}

function movePriority(from, to) {
  const priorities = getCoursePriorities();
  if (to < 0 || to >= priorities.length) return;

  const temp = priorities[from];
  priorities[from] = priorities[to];
  priorities[to] = temp;

  replaceStateSnapshot({
    ...getStateSnapshot(),
    coursePriorities: priorities
  });

  renderCoursePriorities();
}

async function saveCoursePriorities() {
  if (!isAdmin) {
    return { ok: false, message: "Only admin can update course priorities." };
  }
  const priorities = getCoursePriorities();

  const { response, json } = await fetchJsonWithTimeout(apiUrl("/api/admin/course-priorities"), {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({ coursePriorities: priorities })
  }, 10000);

  if (!response.ok || json?.ok === false) {
    return { ok: false, message: json?.message || "Failed to save course priorities." };
  }

  replaceStateSnapshot(json.state);
  return { ok: true };
}

function setupAdminPanel() {
  if (!adminImportPanel) {
    return;
  }

  if (!isAdmin) {
    adminImportPanel.classList.add("hidden");
    return;
  }

  void hydrateAllocationPanel({ force: true });
  allocationRows?.addEventListener("input", () => {
    allocationPanelDirty = true;
  });
  allocationRows?.addEventListener("change", () => {
    allocationPanelDirty = true;
  });
  importedFileSelect?.addEventListener("change", () => {
    updateImportedFileDetails();
    setMessage(importedFilesMessage, "", false);
  });
  deleteImportedFileBtn?.addEventListener("click", (event) => {
    const fileName = importedFileSelect?.value || "";
    void handleDeleteImportedFile(fileName, event.currentTarget);
  });

  if (!saveAllocationBtn) {
    return;
  }

  saveAllocationBtn.onclick = async (event) => {
    const nextAllocation = readAllocationFromForm();
    const validation = validateAllocation(nextAllocation);

    if (!validation.ok) {
      setMessage(allocationMessage, validation.message, true);
      return;
    }

    const allocResult = await withButtonBusy(
      event.currentTarget,
      "Saving rules...",
      () => saveAllocation([
        ...validation.cleaned,
        getRoutingMeta()
      ])
    );
    if (!allocResult || allocResult.ok === false) {
      setMessage(allocationMessage, allocResult?.message || "Failed to save routing rules. Please check your connection.", true);
      return;
    }
    allocationPanelDirty = false;
    renderAllocationRows(validation.cleaned);
    setMessage(allocationMessage, "Counselor routing rules saved successfully.", false);
  };

  importLeadsBtn.onclick = (event) => {
    void withButtonBusy(event.currentTarget, "Importing leads...", () => handleLeadImport());
  };

  if (importCustomLeadsBtn) {
    importCustomLeadsBtn.onclick = (event) => {
      void withButtonBusy(event.currentTarget, "Importing custom leads...", () => handleCustomLeadImport());
    };
  }

  if (runLeadSearchBtn) {
    runLeadSearchBtn.onclick = (event) => {
      void withButtonBusy(event.currentTarget, "Searching file...", () => handleLeadSearchReport());
    };
  }

  if (exportLeadSearchReportBtn) {
    exportLeadSearchReportBtn.onclick = (event) => {
      void withButtonBusy(event.currentTarget, "Exporting...", () => downloadLeadSearchReport());
    };
  }

  if (saveCoursePrioritiesBtn) {
    saveCoursePrioritiesBtn.onclick = async (event) => {
      const result = await withButtonBusy(event.currentTarget, "Saving priorities...", () => saveCoursePriorities());
      if (!result || result.ok === false) {
        setMessage(coursePrioritiesMessage, result?.message || "Failed to save course priorities.", true);
        return;
      }
      setMessage(coursePrioritiesMessage, "Course priorities saved successfully.", false);
      showToast("Course priorities saved successfully.", false);
    };
  }

  if (exportBackupBtn) {
    exportBackupBtn.onclick = (event) => {
      void withButtonBusy(event.currentTarget, "Preparing backup...", () => downloadManualBackup());
    };
  }

  if (restoreBackupBtn) {
    restoreBackupBtn.onclick = (event) => {
      void withButtonBusy(event.currentTarget, "Restoring backup...", () => restoreManualBackup());
    };
  }

  if (saveSopSettingsBtn) {
    saveSopSettingsBtn.onclick = async (event) => {
      const result = await withButtonBusy(event.currentTarget, "Saving SOP...", () => saveSopSettings());
      if (!result || result.ok === false) {
        setMessage(sopSettingsMessage, result?.message || "Failed to save SOP setting.", true);
        return;
      }
      setMessage(sopSettingsMessage, "SOP setting saved successfully.", false);
      showToast("SOP setting saved successfully.", false);
    };
  }

  renderCoursePriorities();
}

function initLeadControlPage() {
  setupAdminPanel();
}

initLeadControlPage();

function renderAll() {
  renderCoursePriorities();
}

const scheduleRenderAll = createRenderScheduler(renderAll);

renderAll();
window.__dvMarkRouteViewReady?.();
void loadLeadControlDirectory().then(() => {
  renderAll();
}).catch((error) => {
  console.warn("[lead-control] directory load failed:", error?.message || error);
});
void loadImportedFiles().catch((error) => {
  if (importedFileSelect) {
    importedFileSelect.innerHTML = `<option value="">Could not load imported files</option>`;
    importedFileSelect.disabled = true;
  }
  if (deleteImportedFileBtn) {
    deleteImportedFileBtn.disabled = true;
  }
  console.warn("[lead-control] imported files load failed:", error?.message || error);
});
let leadControlPollingStopped = false;
let leadControlPollingActive = false;
const leadControlPollingId = setInterval(async () => {
  if (leadControlPollingStopped || leadControlPollingActive || document.visibilityState === "hidden") return;
  leadControlPollingActive = true;
  try {
    await loadLeadControlDirectory();
    scheduleRenderAll();
  } catch (error) {
    console.warn("[lead-control] directory polling failed:", error?.message || error);
  } finally {
    leadControlPollingActive = false;
  }
}, 60000);
const stopStatePolling = () => {
  leadControlPollingStopped = true;
  clearInterval(leadControlPollingId);
};
registerPageCleanup(stopStatePolling);
// startStatePolling(scheduleRenderAll
