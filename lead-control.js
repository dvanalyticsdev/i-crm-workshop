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
  syncStateFromLocalAndVerify
} from "./state-sync.js";
import { createRenderScheduler, withButtonBusy } from "./ui-feedback.js";
await bootstrapLocalState({ skipStateRefresh: true });

const adminImportPanel = document.getElementById("adminImportPanel");
const leadImportFile = document.getElementById("leadImportFile");
const importLeadsBtn = document.getElementById("importLeadsBtn");
const importSummary = document.getElementById("importSummary");
const importMessage = document.getElementById("importMessage");
const importedFilesList = document.getElementById("importedFilesList");
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
const session = getSession();
const isAdmin = session?.role === "admin" || session?.role === "super_admin";
const isSuperAdmin = session?.role === "super_admin";
let allocationPanelDirty = false;
let importedFileRows = [];

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
  if (!isAdmin || !importedFilesList) {
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
  const raw = String(value || "").trim();
  if (/^\d+(\.\d+)?e\+?\d+$/i.test(raw)) {
    const numeric = Number(raw);
    if (Number.isFinite(numeric)) {
      return String(Math.trunc(numeric)).replace(/\D+/g, "").trim();
    }
  }
  return raw.replace(/\.0+$/, "").replace(/\D+/g, "").trim();
}

function normalizeImportedPhone(value) {
  const normalized = normalizeDuplicatePhone(value);
  if (!normalized) return "";
  if (normalized.length === 10) return normalized;
  if (normalized.length > 10 && normalized.startsWith("91")) return normalized.slice(-10);
  return normalized;
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
  if (!sheetNames.length) {
    return [];
  }

  return sheetNames.flatMap((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      return [];
    }

    return XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false }).map((row) => ({
      ...row,
      __workshopName: sheetName,
      __importSourceFile: file.name
    }));
  });
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
  if (!importedFilesList) {
    return;
  }

  if (!importedFileRows.length) {
    importedFilesList.innerHTML = `<p class="block-help">No imported file data found.</p>`;
    return;
  }

  importedFilesList.innerHTML = `
    <div class="table-shell imported-files-table-wrap">
      <table class="data-table imported-files-table">
        <thead>
          <tr>
            <th>File</th>
            <th>Leads</th>
            <th>Last Import</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${importedFileRows.map((file) => {
            const fileName = String(file.fileName || "").trim();
            const count = Number(file.leadCount) || 0;
            return `
              <tr>
                <td>
                  <strong>${escapeHtml(fileName)}</strong>
                  <div class="table-meta">${escapeHtml(file.sampleLeadName || "Imported leads")}</div>
                </td>
                <td><span class="pill pill--neutral">${count}</span></td>
                <td>${escapeHtml(formatDateTime(file.lastImportedAt || file.lastUpdatedAt || ""))}</td>
                <td>
                  <button type="button" class="btn-ghost btn-sm imported-file-delete-btn" data-file-name="${escapeHtml(fileName)}">
                    Delete file data
                  </button>
                </td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
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
    setMessage(importMessage, `Import finished. ${savedCount} new lead${savedCount === 1 ? "" : "s"} added; ${failed.length + skippedCount} row${failed.length + skippedCount === 1 ? "" : "s"} not imported. First row to review: ${failed[0]}`, true);
  } else if (skippedCount) {
    setMessage(importMessage, `Import finished. ${savedCount} new lead${savedCount === 1 ? "" : "s"} added; ${skippedCount} duplicate row${skippedCount === 1 ? "" : "s"} safely skipped.`, false);
  } else if (assignmentMisses.length) {
    setMessage(importMessage, `Imported ${savedCount}. ${assignmentMisses.length} lead${assignmentMisses.length === 1 ? "" : "s"} stayed Unassigned because no matching routing rule was enabled.`, true);
  } else {
    const messageParts = [];
    if (savedCount) {
      messageParts.push(`created ${savedCount}`);
    }
    if (recordsNeedingAssignment.length) {
      setMessage(importMessage, "Counselor Assigned Successfully.", false);
    } else {
      setMessage(importMessage, `Import completed: ${messageParts.join(" and ") || "no changes"}.`, false);
    }
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
  importedFilesList?.addEventListener("click", (event) => {
    const button = event.target.closest(".imported-file-delete-btn");
    if (!button) {
      return;
    }
    const fileName = button.dataset.fileName || "";
    void handleDeleteImportedFile(fileName, button);
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

}

function initLeadControlPage() {
  setupAdminPanel();
}

initLeadControlPage();

function renderAll() {
  // Lead & Data Control only needs directory/routing state; avoid touching the full lead cache here.
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
  if (importedFilesList) {
    importedFilesList.innerHTML = `<p class="block-help">Could not load imported files.</p>`;
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
