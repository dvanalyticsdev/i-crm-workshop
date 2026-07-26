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
const exportBackupBtn = document.getElementById("exportBackupBtn");
const restoreBackupFile = document.getElementById("restoreBackupFile");
const restoreBackupBtn = document.getElementById("restoreBackupBtn");
const backupMessage = document.getElementById("backupMessage");
const session = getSession();
const isAdmin = session?.role === "admin" || session?.role === "super_admin";

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

}

function initLeadControlPage() {
  setupAdminPanel();
}

initLeadControlPage();

function renderAll() {
  const allLeads = getAllLeads();
  normalizeLeadFields(allLeads);
}

renderAll();
window.__dvMarkRouteViewReady?.();
const stopStatePolling = startStatePolling(() => {
  renderAll();
});
registerPageCleanup(stopStatePolling);
