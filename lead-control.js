import { registerPageCleanup } from "./page-runtime.js";
import { apiUrl } from "./api-client.js";
import {
  bootstrapLocalState,
  acceptServerState,
  getAllocation as getStoredAllocation,
  getCounselors as getStoredCounselors,
  getLeads as getStoredLeads,
  getSession,
  replaceStateSnapshot,
  saveAllocation as persistAllocation,
  saveLeads as persistLeads,
  startStatePolling,
  syncStateFromLocalAndVerify
} from "./state-sync.js";
await bootstrapLocalState();

const adminImportPanel = document.getElementById("adminImportPanel");
const leadImportFile = document.getElementById("leadImportFile");
const importLeadsBtn = document.getElementById("importLeadsBtn");
const importSummary = document.getElementById("importSummary");
const importMessage = document.getElementById("importMessage");
const allocationRows = document.getElementById("allocationRows");
const saveAllocationBtn = document.getElementById("saveAllocationBtn");
const allocationMessage = document.getElementById("allocationMessage");
const deleteAllLeadsBtn = document.getElementById("deleteAllLeadsBtn");
const deleteLostLeadsBtn = document.getElementById("deleteLostLeadsBtn");
const deleteImportedFileSelect = document.getElementById("deleteImportedFileSelect");
const deleteImportedFileBtn = document.getElementById("deleteImportedFileBtn");
const cleanupMessage = document.getElementById("cleanupMessage");
const exportBackupBtn = document.getElementById("exportBackupBtn");
const restoreBackupFile = document.getElementById("restoreBackupFile");
const restoreBackupBtn = document.getElementById("restoreBackupBtn");
const backupMessage = document.getElementById("backupMessage");
const lsqImportPanel = document.getElementById("lsqImportPanel");
const lsqImportFile = document.getElementById("lsqImportFile");
const lsqCounselorFilter = document.getElementById("lsqCounselorFilter");
const lsqStageFilter = document.getElementById("lsqStageFilter");
const importLsqBtn = document.getElementById("importLsqBtn");
const lsqImportSummary = document.getElementById("lsqImportSummary");
const lsqImportMessage = document.getElementById("lsqImportMessage");
const lsqArchiveTable = document.getElementById("lsqArchiveTable");
const deleteAllLsqLeadsBtn = document.getElementById("deleteAllLsqLeadsBtn");
const deleteArchivedLsqLeadsBtn = document.getElementById("deleteArchivedLsqLeadsBtn");
const deleteLsqImportedFileSelect = document.getElementById("deleteLsqImportedFileSelect");
const deleteLsqImportedFileBtn = document.getElementById("deleteLsqImportedFileBtn");
const lsqCleanupMessage = document.getElementById("lsqCleanupMessage");
const session = getSession();
const isAdmin = session?.role === "admin" || session?.role === "super_admin";
const isSuperAdmin = session?.role === "super_admin";

const DEFAULT_ALLOCATION = [];

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

function isLsqImportedLead(lead) {
  return Boolean(lead?.lsqImported)
    || String(lead?.source || "").trim().toLowerCase().includes("leadsquared");
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

function getAllLeads() {
  const leads = getStoredLeads();
  normalizeLeadFields(leads);
  return leads;
}

function saveAllLeads(leads) {
  return persistLeads(leads);
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

function extractCounselorEmail(record) {
  return String(record?.email || "").trim().toLowerCase();
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

async function getCounselorOptions() {
  const localCounselors = getStoredCounselors();
  if (Array.isArray(localCounselors) && localCounselors.length) {
    return localCounselors
      .map((item) => ({
        name: extractCounselorName(item),
        email: extractCounselorEmail(item)
      }))
      .filter((item) => item.name)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  try {
    const { response, json } = await fetchJsonWithTimeout(apiUrl("/api/state"), {
      method: "GET",
      headers: { Accept: "application/json" }
    }, 4000);

    if (!response.ok) {
      return [];
    }

    return (Array.isArray(json?.counselors) ? json.counselors : [])
      .map((item) => ({
        name: extractCounselorName(item),
        email: extractCounselorEmail(item)
      }))
      .filter((item) => item.name)
      .sort((left, right) => left.name.localeCompare(right.name));
  } catch {
    return [];
  }
}

async function renderLsqCounselorFilter() {
  if (!lsqCounselorFilter) {
    return;
  }

  const currentValue = String(lsqCounselorFilter.value || "all").trim();
  const options = await getCounselorOptions();
  lsqCounselorFilter.innerHTML = [
    `<option value="all">All counselors</option>`,
    ...options.map((item) => `<option value="${escapeHtml(item.email || item.name.toLowerCase())}">${escapeHtml(item.name)}</option>`)
  ].join("");

  const validValues = new Set(["all", ...options.map((item) => item.email || item.name.toLowerCase())]);
  lsqCounselorFilter.value = validValues.has(currentValue) ? currentValue : "all";
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

function validateAllocation(allocation) {
  const cleaned = allocation
    .map((item) => ({
      name: String(item.name || "").trim(),
      percentage: Number(item.percentage || 0)
    }))
    .filter((item) => item.name && item.percentage > 0);

  if (!cleaned.length) {
    return { ok: false, message: "Add at least one counselor with percentage greater than 0." };
  }

  const total = cleaned.reduce((sum, item) => sum + item.percentage, 0);
  if (Math.abs(total - 100) > 0.01) {
    return { ok: false, message: `Total allocation must be 100%. Current total: ${total.toFixed(2)}%.` };
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
        <div class="allocation-row" data-index="${index}">
          <input type="text" class="allocation-name" value="${item.name}" placeholder="Counselor name" />
          <input type="number" class="allocation-percentage" value="${item.percentage}" min="0" max="100" step="0.01" placeholder="%" />
        </div>
      `
    )
    .join("");
}

function readAllocationFromForm() {
  const names = Array.from(document.querySelectorAll(".allocation-name"));
  const percentages = Array.from(document.querySelectorAll(".allocation-percentage"));

  return names.map((nameInput, index) => ({
    name: nameInput.value,
    percentage: percentages[index]?.value || 0
  }));
}

function createCounselorAssignments(totalLeads, allocation) {
  if (!totalLeads) {
    return [];
  }

  if (!allocation.length) {
    return new Array(totalLeads).fill("Unassigned");
  }

  const targets = allocation.map((item) => ({
    name: item.name,
    floor: Math.floor((totalLeads * item.percentage) / 100),
    frac: (totalLeads * item.percentage) / 100 - Math.floor((totalLeads * item.percentage) / 100)
  }));

  let assigned = targets.reduce((sum, item) => sum + item.floor, 0);
  let remaining = totalLeads - assigned;

  targets
    .sort((a, b) => b.frac - a.frac)
    .forEach((item) => {
      if (remaining > 0) {
        item.floor += 1;
        remaining -= 1;
      }
    });

  const balanced = [];
  let active = true;
  while (active) {
    active = false;
    targets.forEach((item) => {
      if (item.floor > 0) {
        balanced.push(item.name);
        item.floor -= 1;
        active = true;
      }
    });
  }

  while (balanced.length < totalLeads) {
    balanced.push(allocation[0].name);
  }

  return balanced.slice(0, totalLeads);
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

function normalizeDuplicatePhone(value) {
  return String(value || "").replace(/\D+/g, "").trim();
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
  const workshop = String(workshopName || "").trim();

  if (!name) {
    return { error: "Name is required." };
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "Valid email is required." };
  }

  if (!workshop) {
    return { error: "Workshop Name is required." };
  }

  const lead = {
    id,
    name,
    email,
    phone: String(pickValue(row, ["phone", "phonenumber", "number", "mobile", "contact"]))
      .trim(),
    workshop,
    status: normalizeLeadStatus(pickValue(row, ["status"])),
    createdAt: toIsoDate(),
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
    importSourceSheets: [String(row.__workshopName || "").trim()].filter(Boolean)
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

function updateImportSummary(total, success, failed) {
  importSummary.innerHTML = `
    <p>Total Leads Imported: ${total}</p>
    <p>Successful Imports: ${success}</p>
    <p>Failed Entries: ${failed}</p>
  `;
}

function updateLsqImportSummary(scanned = 0, created = 0, updated = 0, archived = 0) {
  if (!lsqImportSummary) {
    return;
  }

  lsqImportSummary.innerHTML = `
    <p>Rows Scanned: ${scanned}</p>
    <p>Created CRM Leads: ${created}</p>
    <p>Updated CRM Leads: ${updated}</p>
    <p>Archived / Out of SOP: ${archived}</p>
  `;
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
    updateImportSummary(0, 0, 0);
    return;
  }

  const nextLeads = getAllLeads();
  const leadIndexByEmail = new Map();
  const leadIndexByPhone = new Map();
  nextLeads.forEach((lead, index) => {
    const email = String(lead.email || "").trim().toLowerCase();
    const phone = normalizeDuplicatePhone(lead.phone);
    if (email && !leadIndexByEmail.has(email)) {
      leadIndexByEmail.set(email, index);
    }
    if (phone && !leadIndexByPhone.has(phone)) {
      leadIndexByPhone.set(phone, index);
    }
  });

  const importedRecords = [];
  const failed = [];
  let createdCount = 0;
  let nextId = Math.max(...nextLeads.map((lead) => Number(lead.id) || 0), 0) + 1;

  rows.forEach((row, idx) => {
    const { lead, error } = buildLeadFromImportRow(row, nextId, row.__workshopName, row.__importSourceFile);
    if (error) {
      failed.push(`Row ${idx + 2}: ${error}`);
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
      failed.push(`Row ${idx + 2}: Duplicate ${duplicateReasons.join(" and ")} already exists.`);
      return;
    }

    nextLeads.push(lead);
    importedRecords.push({ index: nextLeads.length - 1, lead });
    leadIndexByEmail.set(lead.email, nextLeads.length - 1);
    if (normalizedPhone) {
      leadIndexByPhone.set(normalizedPhone, nextLeads.length - 1);
    }
    createdCount += 1;
    nextId += 1;
  });

  const recordsNeedingAssignment = importedRecords.filter(({ lead }) => {
    const counselor = String(lead.counselor || "").trim().toLowerCase();
    return !counselor || counselor === "unassigned";
  });

  const assignments = createCounselorAssignments(recordsNeedingAssignment.length, allocationValidation.cleaned);
  const fallbackCounselor = allocationValidation.cleaned[0].name;
  recordsNeedingAssignment.forEach((record, index) => {
    const assignedCounselor = assignments[index] || fallbackCounselor;
    record.lead.counselor = assignedCounselor;
    nextLeads[record.index] = record.lead;
  });

  normalizeLeadFields(nextLeads);
  const importSaveResult = await saveAllLeads(nextLeads);
  if (!importSaveResult || importSaveResult.ok === false) {
    setMessage(importMessage, importSaveResult?.message || "Failed to save imported leads. Please check your connection and try again.", true);
    return;
  }

  const syncResult = await syncStateFromLocalAndVerify();
  if (!syncResult.ok) {
    setMessage(importMessage, syncResult.message || "Backend confirmation failed after import.", true);
    return;
  }

  const assignmentResult = await verifyAssignedCounselorsOnBackend(importedRecords);
  if (!assignmentResult.ok) {
    setMessage(importMessage, assignmentResult.message || "Counselor assignment could not be verified.", true);
    return;
  }

  updateImportSummary(rows.length, importedRecords.length, failed.length);

  if (failed.length) {
    setMessage(importMessage, `Imported with ${failed.length} failures. Example: ${failed[0]}`, true);
  } else {
    const messageParts = [];
    if (createdCount) {
      messageParts.push(`created ${createdCount}`);
    }
    if (recordsNeedingAssignment.length) {
      setMessage(importMessage, "Counselor Assigned Successfully.", false);
    } else {
      setMessage(importMessage, `Import completed: ${messageParts.join(" and ") || "no changes"}.`, false);
    }
  }

  leadImportFile.value = "";
  renderAll();
}

async function handleLsqImport() {
  if (!isSuperAdmin) {
    setMessage(lsqImportMessage, "Only super admin can import LSQ data.", true);
    return;
  }

  const file = lsqImportFile?.files?.[0];
  if (!file) {
    setMessage(lsqImportMessage, "Please select an LSQ .xlsx or .csv file.", true);
    return;
  }

  if (!/\.(xlsx|csv)$/i.test(file.name)) {
    setMessage(lsqImportMessage, "Unsupported LSQ format. Please upload .xlsx or .csv.", true);
    return;
  }

  let rows = [];
  try {
    rows = await parseImportFile(file);
  } catch {
    setMessage(lsqImportMessage, "Could not read LSQ file. Check format and try again.", true);
    return;
  }

  if (!rows.length) {
    setMessage(lsqImportMessage, "No rows found in the LSQ file.", true);
    updateLsqImportSummary(0, 0, 0, 0);
    return;
  }

  setMessage(lsqImportMessage, "Importing LSQ updates...", false);
  const counselorFilter = String(lsqCounselorFilter?.value || "all").trim() || "all";
  const stageFilter = String(lsqStageFilter?.value || "all").trim() || "all";
  const { response, json } = await fetchJsonWithTimeout(apiUrl("/api/admin/lsq-import"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      sourceFileName: file.name,
      counselorFilter,
      stageFilter,
      rows
    })
  }, 60000);

  if (!response.ok || !json?.ok) {
    setMessage(lsqImportMessage, json?.message || "LSQ import failed.", true);
    return;
  }

  if (json?.state) {
    acceptServerState(json.state, response.headers.get("etag"));
  }

  updateLsqImportSummary(
    Number(json?.summary?.scanned) || rows.length,
    Number(json?.summary?.created) || 0,
    Number(json?.summary?.updated) || 0,
    Number(json?.summary?.archived) || 0
  );

  const createdCount = Number(json?.summary?.created) || 0;
  const updatedCount = Number(json?.summary?.updated) || 0;
  const skippedByCounselorFilter = Number(json?.summary?.skippedByCounselorFilter) || 0;
  const skippedByStageFilter = Number(json?.summary?.skippedByStageFilter) || 0;
  const primaryReason = Object.entries(json?.summary?.byReason || {}).sort((left, right) => right[1] - left[1])[0]?.[0] || "";
  setMessage(
    lsqImportMessage,
    `LSQ import completed. Created ${createdCount} and updated ${updatedCount} CRM lead${createdCount + updatedCount === 1 ? "" : "s"} into Main Admission, and archived ${Number(json?.summary?.archived) || 0}.${skippedByCounselorFilter ? ` Skipped ${skippedByCounselorFilter} row${skippedByCounselorFilter === 1 ? "" : "s"} due to counselor filter.` : ""}${skippedByStageFilter ? ` Skipped ${skippedByStageFilter} row${skippedByStageFilter === 1 ? "" : "s"} due to stage filter.` : ""}${primaryReason ? ` Top archive reason: ${primaryReason}.` : ""}`,
    false
  );

  if (lsqImportFile) {
    lsqImportFile.value = "";
  }

  await renderLsqArchiveTable();
}

async function renderLsqArchiveTable() {
  if (!lsqArchiveTable) {
    return;
  }

  if (!isSuperAdmin) {
    lsqArchiveTable.innerHTML = `<p class="block-help">LSQ archive is available only to super admin.</p>`;
    return;
  }

  const { response, json } = await fetchJsonWithTimeout(apiUrl("/api/admin/lsq-archive?limit=120"), {
    method: "GET",
    headers: { Accept: "application/json" }
  }, 10000);

  if (!response.ok || !json?.ok) {
    lsqArchiveTable.innerHTML = `<p class="block-help">Could not load archived LSQ rows right now.</p>`;
    return;
  }

  const rows = Array.isArray(json.rows) ? json.rows : [];
  if (!rows.length) {
    lsqArchiveTable.innerHTML = `<p class="block-help">No LSQ leads have been archived yet.</p>`;
    renderLsqImportedFileOptions([]);
    return;
  }

  renderLsqImportedFileOptions(rows);

  lsqArchiveTable.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Lead</th>
          <th>Course</th>
          <th>LSQ Status</th>
          <th>Archive Reason</th>
          <th>Imported</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((row) => `
          <tr>
            <td>
              <strong>${escapeHtml(row.name || "Unnamed lead")}</strong>
              <div class="table-meta">${escapeHtml(row.email || row.phone || "No contact")}</div>
            </td>
            <td>${escapeHtml(row.courseName || "-")}</td>
            <td>${escapeHtml(row.admissionStatus || row.courseStatus || row.lsq?.leadStage || "-")}</td>
            <td>${escapeHtml(row.reason || "-")}</td>
            <td>${escapeHtml(formatDateTime(row.importedAt))}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function renderLsqImportedFileOptions(archiveRows = []) {
  if (!deleteLsqImportedFileSelect) {
    return;
  }

  const allLeads = getAllLeads();
  const leadFiles = allLeads
    .filter((lead) => isLsqImportedLead(lead))
    .flatMap((lead) => getLeadImportSourceFiles(lead));
  const archiveFiles = (Array.isArray(archiveRows) ? archiveRows : [])
    .map((row) => String(row?.sourceFileName || "").trim())
    .filter(Boolean);
  const fileNames = [...new Set([...leadFiles, ...archiveFiles])].sort((left, right) => left.localeCompare(right));
  const currentValue = String(deleteLsqImportedFileSelect.value || "").trim();

  deleteLsqImportedFileSelect.innerHTML = fileNames.length
    ? [`<option value="">Select LSQ imported file</option>`, ...fileNames.map((fileName) => `<option value="${escapeHtml(fileName)}">${escapeHtml(fileName)}</option>`)].join("")
    : `<option value="">No LSQ imported files found</option>`;

  if (fileNames.includes(currentValue)) {
    deleteLsqImportedFileSelect.value = currentValue;
  }

  if (deleteLsqImportedFileBtn) {
    deleteLsqImportedFileBtn.disabled = !fileNames.length;
  }
}

async function deleteLsqArchiveRows(sourceFileName = "") {
  const query = sourceFileName ? `?sourceFileName=${encodeURIComponent(sourceFileName)}` : "";
  return fetchJsonWithTimeout(apiUrl(`/api/admin/lsq-archive${query}`), {
    method: "DELETE",
    headers: { Accept: "application/json" }
  }, 15000);
}

async function deleteLsqLiveLeads(sourceFileName = "") {
  const query = sourceFileName ? `?sourceFileName=${encodeURIComponent(sourceFileName)}` : "";
  return fetchJsonWithTimeout(apiUrl(`/api/admin/lsq-leads${query}`), {
    method: "DELETE",
    headers: { Accept: "application/json" }
  }, 20000);
}

async function deleteWholeLsqDataset() {
  const allLeads = getAllLeads();
  const removedLeadCount = allLeads.filter((lead) => isLsqImportedLead(lead)).length;

  if (!removedLeadCount) {
    const { response, json } = await deleteLsqArchiveRows();
    if (!response.ok) {
      setMessage(lsqCleanupMessage, json?.message || "Failed to delete archived LSQ leads.", true);
      return;
    }
    setMessage(lsqCleanupMessage, `Deleted ${Number(json?.deletedCount) || 0} archived LSQ lead${Number(json?.deletedCount) === 1 ? "" : "s"}.`, false);
    await renderLsqArchiveTable();
    return;
  }

  const confirmed = window.confirm(`Delete ${removedLeadCount} LSQ lead${removedLeadCount === 1 ? "" : "s"} and all archived LSQ rows? This cannot be undone.`);
  if (!confirmed) {
    return;
  }

  const { response: deleteResponse, json: deleteJson } = await deleteLsqLiveLeads();
  if (!deleteResponse.ok) {
    setMessage(lsqCleanupMessage, deleteJson?.message || "Failed to delete LSQ leads.", true);
    return;
  }
  if (deleteJson?.state) {
    acceptServerState(deleteJson.state, deleteResponse.headers.get("etag"));
  }
  const deletedLeadCount = Number(deleteJson?.deletedCount) || 0;

  const { response, json } = await deleteLsqArchiveRows();
  if (!response.ok) {
    setMessage(lsqCleanupMessage, json?.message || "LSQ leads were deleted, but archive cleanup failed.", true);
    return;
  }

  setMessage(lsqCleanupMessage, `Deleted ${deletedLeadCount} LSQ lead${deletedLeadCount === 1 ? "" : "s"} and ${Number(json?.deletedCount) || 0} archived LSQ row${Number(json?.deletedCount) === 1 ? "" : "s"}.`, false);
  renderAll();
}

async function deleteArchivedLsqLeads() {
  const confirmed = window.confirm("Delete all archived LSQ leads? This cannot be undone.");
  if (!confirmed) {
    return;
  }

  const { response, json } = await deleteLsqArchiveRows();
  if (!response.ok) {
    setMessage(lsqCleanupMessage, json?.message || "Failed to delete archived LSQ leads.", true);
    return;
  }

  setMessage(lsqCleanupMessage, `Deleted ${Number(json?.deletedCount) || 0} archived LSQ lead${Number(json?.deletedCount) === 1 ? "" : "s"}.`, false);
  await renderLsqArchiveTable();
}

async function deleteLsqFileImport() {
  const selectedFile = String(deleteLsqImportedFileSelect?.value || "").trim();
  if (!selectedFile) {
    setMessage(lsqCleanupMessage, "Select an LSQ imported file to delete.", true);
    return;
  }

  const allLeads = getAllLeads();
  const removedLeadCount = allLeads.filter((lead) => (
    isLsqImportedLead(lead) && getLeadImportSourceFiles(lead).includes(selectedFile)
  )).length;

  const confirmed = window.confirm(`Delete LSQ data imported from ${selectedFile}? This removes matching live LSQ leads and archived LSQ rows.`);
  if (!confirmed) {
    return;
  }

  let deletedLeadCount = 0;
  if (removedLeadCount > 0) {
    const { response: deleteResponse, json: deleteJson } = await deleteLsqLiveLeads(selectedFile);
    if (!deleteResponse.ok) {
      setMessage(lsqCleanupMessage, deleteJson?.message || `Failed to delete LSQ leads from ${selectedFile}.`, true);
      return;
    }
    if (deleteJson?.state) {
      acceptServerState(deleteJson.state, deleteResponse.headers.get("etag"));
    }
    deletedLeadCount = Number(deleteJson?.deletedCount) || 0;
  }

  const { response, json } = await deleteLsqArchiveRows(selectedFile);
  if (!response.ok) {
    setMessage(lsqCleanupMessage, json?.message || `LSQ leads were updated, but archive cleanup failed for ${selectedFile}.`, true);
    return;
  }

  setMessage(lsqCleanupMessage, `Deleted ${deletedLeadCount} LSQ lead${deletedLeadCount === 1 ? "" : "s"} and ${Number(json?.deletedCount) || 0} archived LSQ row${Number(json?.deletedCount) === 1 ? "" : "s"} from ${selectedFile}.`, false);
  renderAll();
}

async function deleteWholeLeadDataset() {
  const confirmed = window.confirm("Delete the entire lead dataset? This cannot be undone.");
  if (!confirmed) {
    return;
  }

  const { response, json } = await fetchJsonWithTimeout(apiUrl("/api/state/reset"), {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    }
  }, 4000);

  if (!response.ok) {
    setMessage(cleanupMessage, json?.message || "Backend reset failed.", true);
    return;
  }

  replaceStateSnapshot(json);

  const syncResult = await syncStateFromLocalAndVerify();
  if (!syncResult.ok) {
    setMessage(cleanupMessage, syncResult.message || "Backend confirmation failed after resetting the database.", true);
    return;
  }

  setMessage(cleanupMessage, "Whole lead dataset deleted successfully.", false);
  renderAll();
}

async function deleteImportedFileImport() {
  const selectedFile = String(deleteImportedFileSelect?.value || "").trim();
  if (!selectedFile) {
    setMessage(cleanupMessage, "Select an imported file to delete.", true);
    return;
  }

  const allLeads = getAllLeads();
  const retainedLeads = allLeads.filter((lead) => !getLeadImportSourceFiles(lead).includes(selectedFile));
  const removedCount = allLeads.length - retainedLeads.length;

  if (!removedCount) {
    setMessage(cleanupMessage, `No leads were tagged with ${selectedFile}.`, false);
    return;
  }

  const confirmed = window.confirm(`Delete ${removedCount} lead${removedCount === 1 ? "" : "s"} imported from ${selectedFile}? This cannot be undone.`);
  if (!confirmed) {
    return;
  }

  normalizeLeadFields(retainedLeads);
  const saveResult = await saveAllLeads(retainedLeads);
  if (!saveResult || saveResult.ok === false) {
    setMessage(cleanupMessage, saveResult?.message || `Failed to delete leads from ${selectedFile}.`, true);
    return;
  }

  const syncResult = await syncStateFromLocalAndVerify();
  if (!syncResult.ok) {
    setMessage(cleanupMessage, syncResult.message || `Backend confirmation failed after deleting leads from ${selectedFile}.`, true);
    return;
  }

  setMessage(cleanupMessage, `${removedCount} lead${removedCount === 1 ? "s" : "s"} from ${selectedFile} deleted successfully.`, false);
  renderAll();
}

async function deleteLostLeads() {
  const allLeads = getAllLeads();
  const retainedLeads = allLeads.filter((lead) => !isLostLead(lead));
  const removedCount = allLeads.length - retainedLeads.length;

  if (!removedCount) {
    setMessage(cleanupMessage, "No lost leads found to delete.", false);
    return;
  }

  const confirmed = window.confirm(`Delete ${removedCount} lost lead${removedCount === 1 ? "" : "s"}? This cannot be undone.`);
  if (!confirmed) {
    return;
  }

  normalizeLeadFields(retainedLeads);
  const saveResult = await saveAllLeads(retainedLeads);
  if (!saveResult || saveResult.ok === false) {
    setMessage(cleanupMessage, saveResult?.message || "Failed to delete lost leads.", true);
    return;
  }

  const syncResult = await syncStateFromLocalAndVerify();
  if (!syncResult.ok) {
    setMessage(cleanupMessage, syncResult.message || "Backend confirmation failed after deleting lost leads.", true);
    return;
  }

  setMessage(cleanupMessage, `${removedCount} lost lead${removedCount === 1 ? "s" : "s"} deleted successfully.`, false);
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

  const hydrateAllocationPanel = async () => {
    const names = await getCounselorNamesForAllocation();
    const existing = getAllocation();
    const merged = mergeAllocationNames(names, existing);

    if (!merged.length) {
      renderAllocationRows([]);
      return;
    }

    renderAllocationRows(merged);
  };

  void hydrateAllocationPanel();

  if (!saveAllocationBtn) {
    return;
  }

  saveAllocationBtn.onclick = async () => {
    const nextAllocation = readAllocationFromForm();
    const validation = validateAllocation(nextAllocation);

    if (!validation.ok) {
      setMessage(allocationMessage, validation.message, true);
      return;
    }

    const allocResult = await saveAllocation(validation.cleaned);
    if (!allocResult || allocResult.ok === false) {
      setMessage(allocationMessage, allocResult?.message || "Failed to save allocation. Please check your connection.", true);
      return;
    }
    renderAllocationRows(validation.cleaned);
    setMessage(allocationMessage, "Counselor allocation saved successfully.", false);
  };

  importLeadsBtn.onclick = () => {
    handleLeadImport();
  };

  if (deleteAllLeadsBtn) {
    deleteAllLeadsBtn.addEventListener("click", deleteWholeLeadDataset);
  }

  if (deleteLostLeadsBtn) {
    deleteLostLeadsBtn.addEventListener("click", deleteLostLeads);
  }

  if (deleteImportedFileBtn) {
    deleteImportedFileBtn.addEventListener("click", deleteImportedFileImport);
  }

  if (exportBackupBtn) {
    exportBackupBtn.onclick = () => {
      void downloadManualBackup();
    };
  }

  if (restoreBackupBtn) {
    restoreBackupBtn.onclick = () => {
      void restoreManualBackup();
    };
  }

  if (lsqImportPanel) {
    lsqImportPanel.classList.toggle("hidden", !isSuperAdmin);
  }

  void renderLsqCounselorFilter();

  if (importLsqBtn) {
    importLsqBtn.onclick = () => {
      void handleLsqImport();
    };
  }

  if (deleteAllLsqLeadsBtn) {
    deleteAllLsqLeadsBtn.addEventListener("click", deleteWholeLsqDataset);
  }

  if (deleteArchivedLsqLeadsBtn) {
    deleteArchivedLsqLeadsBtn.addEventListener("click", deleteArchivedLsqLeads);
  }

  if (deleteLsqImportedFileBtn) {
    deleteLsqImportedFileBtn.addEventListener("click", deleteLsqFileImport);
  }

  void renderLsqArchiveTable();

}

function initLeadControlPage() {
  setupAdminPanel();
}

initLeadControlPage();

function renderAll() {
  const allLeads = getAllLeads();
  normalizeLeadFields(allLeads);

  if (deleteImportedFileSelect) {
    const importedFileNames = [...new Set(allLeads.flatMap((lead) => getLeadImportSourceFiles(lead)))].sort((left, right) => left.localeCompare(right));
    const currentValue = deleteImportedFileSelect.value;

    deleteImportedFileSelect.innerHTML = importedFileNames.length
      ? [`<option value="">Select imported file</option>`, ...importedFileNames.map((fileName) => `<option value="${escapeHtml(fileName)}">${escapeHtml(fileName)}</option>`)].join("")
      : `<option value="">No imported files found</option>`;

    if (importedFileNames.includes(currentValue)) {
      deleteImportedFileSelect.value = currentValue;
    }

    if (deleteImportedFileBtn) {
      deleteImportedFileBtn.disabled = !importedFileNames.length;
    }
  }

  void renderLsqCounselorFilter();
  void renderLsqArchiveTable();

}

renderAll();
window.__dvMarkRouteViewReady?.();
const stopStatePolling = startStatePolling(() => {
  renderAll();
});
registerPageCleanup(stopStatePolling);
