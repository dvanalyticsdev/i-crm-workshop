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
import {
  assignLeads as assignLeadsOnServer
} from "./lead-service.js";

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
const applyAllAssignmentSuggestionsBtn = document.getElementById("applyAllAssignmentSuggestionsBtn");
const assignmentSuggestionSummary = document.getElementById("assignmentSuggestionSummary");
const assignmentSuggestionList = document.getElementById("assignmentSuggestionList");
const assignmentSuggestionMessage = document.getElementById("assignmentSuggestionMessage");

const session = getSession();
const isAdmin = session?.role === "admin";

let lastAssignmentSuggestions = [];
const DEFAULT_ALLOCATION = [];

function toIsoDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
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

function getLeadImportSourceFiles(lead) {
  if (Array.isArray(lead?.importSourceFiles)) {
    return lead.importSourceFiles.map((name) => String(name || "").trim()).filter(Boolean);
  }

  const fallback = String(lead?.importSourceFile || "").trim();
  return fallback ? [fallback] : [];
}

function getLeadActivityUpdateCount(lead) {
  const workshopUpdates = Array.isArray(lead?.workshopActivityHistory)
    ? lead.workshopActivityHistory.length
    : Number(lead?.preActivityUpdates) || 0;
  const admissionUpdates = Array.isArray(lead?.admissionActivityHistory)
    ? lead.admissionActivityHistory.length
    : Number(lead?.postActivityUpdates) || 0;

  return workshopUpdates + admissionUpdates;
}

function isUntouchedLead(lead) {
  return getLeadActivityUpdateCount(lead) === 0;
}

function isLostLead(lead) {
  return lead.postStatusUpdated && lead.courseStatus === "Not Interested";
}

function isPostWorkshopLead(lead) {
  return lead.wsStatus === "Interested" && lead.whatsappInvite === "Yes";
}

function isNonWorkshopPipelineLead(lead) {
  return ["course-registration", "main-admission"].includes(String(lead?.leadPipeline || "").trim().toLowerCase());
}

function getPreWorkshopLeads(allLeads) {
  return allLeads.filter((lead) => !isNonWorkshopPipelineLead(lead) && !isLostLead(lead));
}

function getUniqueWorkshops(leads) {
  return [...new Set(leads.map((lead) => lead.workshop))];
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

function assignWorkshopExtraSlots(workshopConfigs, activeCounselors, counselorExtraTargets) {
  const workshopCount = workshopConfigs.length;
  const counselorCount = activeCounselors.length;
  const source = 0;
  const sink = 1 + workshopCount + counselorCount;
  const graphSize = sink + 1;
  const capacity = Array.from({ length: graphSize }, () => new Array(graphSize).fill(0));

  workshopConfigs.forEach((config, workshopIndex) => {
    const workshopNode = 1 + workshopIndex;
    capacity[source][workshopNode] = config.remainingExtras;

    activeCounselors.forEach((counselorName, counselorIndex) => {
      const counselorNode = 1 + workshopCount + counselorIndex;
      const touchedCount = config.touchedCounts.get(counselorName) || 0;
      if (touchedCount <= config.baseTarget) {
        capacity[workshopNode][counselorNode] = 1;
      }
    });
  });

  activeCounselors.forEach((counselorName, counselorIndex) => {
    const counselorNode = 1 + workshopCount + counselorIndex;
    capacity[counselorNode][sink] = counselorExtraTargets.get(counselorName) || 0;
  });

  const residual = capacity.map((row) => [...row]);
  let maxFlow = 0;

  while (true) {
    const parent = new Array(graphSize).fill(-1);
    parent[source] = source;
    const queue = [source];

    while (queue.length && parent[sink] === -1) {
      const node = queue.shift();
      for (let next = 0; next < graphSize; next += 1) {
        if (parent[next] === -1 && residual[node][next] > 0) {
          parent[next] = node;
          queue.push(next);
        }
      }
    }

    if (parent[sink] === -1) {
      break;
    }

    let flow = Number.POSITIVE_INFINITY;
    for (let node = sink; node !== source; node = parent[node]) {
      flow = Math.min(flow, residual[parent[node]][node]);
    }

    for (let node = sink; node !== source; node = parent[node]) {
      residual[parent[node]][node] -= flow;
      residual[node][parent[node]] += flow;
    }

    maxFlow += flow;
  }

  const requiredFlow = workshopConfigs.reduce((sum, config) => sum + config.remainingExtras, 0);
  if (maxFlow !== requiredFlow) {
    return null;
  }

  const optionalAssignments = new Map();
  workshopConfigs.forEach((config, workshopIndex) => {
    const optionalMap = new Map();
    activeCounselors.forEach((counselorName, counselorIndex) => {
      const workshopNode = 1 + workshopIndex;
      const counselorNode = 1 + workshopCount + counselorIndex;
      optionalMap.set(counselorName, capacity[workshopNode][counselorNode] - residual[workshopNode][counselorNode]);
    });
    optionalAssignments.set(config.workshopName, optionalMap);
  });

  return optionalAssignments;
}

function buildCounselorOptionalExtraTargetCandidates(workshopConfigs, activeCounselors, totalWorkshopExtras) {
  if (!activeCounselors.length) {
    return [];
  }

  const mandatoryExtraTotals = new Map(activeCounselors.map((name) => [name, 0]));
  workshopConfigs.forEach((config) => {
    activeCounselors.forEach((counselorName) => {
      mandatoryExtraTotals.set(
        counselorName,
        (mandatoryExtraTotals.get(counselorName) || 0) + (config.mandatoryExtras.get(counselorName) || 0)
      );
    });
  });

  const baseExtraTarget = Math.floor(totalWorkshopExtras / activeCounselors.length);
  const extraTargetRemainder = totalWorkshopExtras % activeCounselors.length;
  const maxExtraTarget = baseExtraTarget + (extraTargetRemainder > 0 ? 1 : 0);
  if ([...mandatoryExtraTotals.values()].some((count) => count > maxExtraTarget)) {
    return [];
  }

  const requiredHighCounselors = [];
  const optionalHighCounselors = [];
  activeCounselors.forEach((counselorName) => {
    const mandatoryCount = mandatoryExtraTotals.get(counselorName) || 0;
    if (mandatoryCount > baseExtraTarget) {
      requiredHighCounselors.push(counselorName);
    } else {
      optionalHighCounselors.push(counselorName);
    }
  });

  if (requiredHighCounselors.length > extraTargetRemainder) {
    return [];
  }

  const extraHighSlots = extraTargetRemainder - requiredHighCounselors.length;
  const candidates = [];
  const sortedOptionalHighCounselors = [...optionalHighCounselors].sort((left, right) => {
    const mandatoryDelta = (mandatoryExtraTotals.get(right) || 0) - (mandatoryExtraTotals.get(left) || 0);
    if (mandatoryDelta !== 0) {
      return mandatoryDelta;
    }
    return left.localeCompare(right);
  });

  function visit(index, chosen) {
    if (chosen.length === extraHighSlots) {
      const highCounselors = new Set([...requiredHighCounselors, ...chosen]);
      const optionalTargets = new Map();
      activeCounselors.forEach((counselorName) => {
        const finalExtraTarget = highCounselors.has(counselorName) ? baseExtraTarget + 1 : baseExtraTarget;
        optionalTargets.set(
          counselorName,
          Math.max(0, finalExtraTarget - (mandatoryExtraTotals.get(counselorName) || 0))
        );
      });
      candidates.push(optionalTargets);
      return;
    }

    if (index >= sortedOptionalHighCounselors.length) {
      return;
    }

    const remaining = sortedOptionalHighCounselors.length - index;
    const needed = extraHighSlots - chosen.length;
    if (remaining < needed) {
      return;
    }

    chosen.push(sortedOptionalHighCounselors[index]);
    visit(index + 1, chosen);
    chosen.pop();
    visit(index + 1, chosen);
  }

  visit(0, []);
  return candidates;
}

function validateBalancedSuggestionTargets(activeCounselors, targetCounts, totalLeads) {
  if (!activeCounselors.length) {
    return "";
  }

  const totals = activeCounselors.map((name) => Number(targetCounts.get(name) || 0));
  const totalAssigned = totals.reduce((sum, value) => sum + value, 0);
  if (totalAssigned !== totalLeads) {
    return "Balanced target validation failed because the suggested totals do not match the total lead count.";
  }

  const minTarget = Math.min(...totals);
  const maxTarget = Math.max(...totals);
  if (maxTarget - minTarget > 1) {
    return "Balanced target validation failed because the suggested counselor totals are not equal.";
  }

  return "";
}

function validateSuggestionOutcome({ activeCounselors, currentCounts, targetCounts, suggestions }) {
  const projectedCounts = new Map(activeCounselors.map((name) => [name, Number(currentCounts.get(name) || 0)]));

  (Array.isArray(suggestions) ? suggestions : []).forEach((suggestion) => {
    const moveCount = Number(suggestion?.count || 0);
    const from = String(suggestion?.from || "").trim();
    const to = String(suggestion?.to || "").trim();

    if (projectedCounts.has(from)) {
      projectedCounts.set(from, projectedCounts.get(from) - moveCount);
    }
    if (projectedCounts.has(to)) {
      projectedCounts.set(to, projectedCounts.get(to) + moveCount);
    }
  });

  for (const counselorName of activeCounselors) {
    if ((projectedCounts.get(counselorName) || 0) !== (targetCounts.get(counselorName) || 0)) {
      return "Balanced target validation failed because the suggested moves do not reach equal counselor totals.";
    }
  }

  return validateBalancedSuggestionTargets(
    activeCounselors,
    projectedCounts,
    Array.from(projectedCounts.values()).reduce((sum, value) => sum + value, 0)
  );
}

function getOverallLeadBalanceData(leads) {
  const activeCounselors = getActiveCounselorNames().sort((left, right) => left.localeCompare(right));
  const assignableLeads = leads.filter((lead) => !isLostLead(lead));
  const workshops = getUniqueWorkshops(assignableLeads).filter(Boolean).sort((left, right) => left.localeCompare(right));

  if (!assignableLeads.length || !activeCounselors.length) {
    return {
      activeCounselors,
      assignableLeads,
      workshops,
      currentCounts: new Map(),
      currentWorkshopCounts: new Map(),
      targetCounts: new Map(),
      targetWorkshopCounts: new Map(),
      suggestions: [],
      totalLeads: assignableLeads.length,
      totalSuggestedMoves: 0,
      isFeasible: true,
      issue: ""
    };
  }

  const currentCounts = new Map(activeCounselors.map((name) => [name, 0]));
  const currentWorkshopCounts = new Map();
  const touchedWorkshopCounts = new Map();
  const externalTouchedWorkshopCounts = new Map();

  workshops.forEach((workshopName) => {
    currentWorkshopCounts.set(workshopName, new Map(activeCounselors.map((name) => [name, 0])));
    touchedWorkshopCounts.set(workshopName, new Map(activeCounselors.map((name) => [name, 0])));
    externalTouchedWorkshopCounts.set(workshopName, 0);
  });

  assignableLeads.forEach((lead) => {
    const counselor = String(lead.counselor || "Unassigned").trim() || "Unassigned";
    const workshopName = String(lead.workshop || "").trim();

    if (!currentWorkshopCounts.has(workshopName)) {
      return;
    }

    if (currentCounts.has(counselor)) {
      currentCounts.set(counselor, currentCounts.get(counselor) + 1);
      const workshopCountMap = currentWorkshopCounts.get(workshopName);
      workshopCountMap.set(counselor, (workshopCountMap.get(counselor) || 0) + 1);

      if (!isUntouchedLead(lead)) {
        const touchedCountMap = touchedWorkshopCounts.get(workshopName);
        touchedCountMap.set(counselor, (touchedCountMap.get(counselor) || 0) + 1);
      }
    } else if (!isUntouchedLead(lead)) {
      externalTouchedWorkshopCounts.set(
        workshopName,
        (externalTouchedWorkshopCounts.get(workshopName) || 0) + 1
      );
    }
  });

  const targetCounts = new Map(activeCounselors.map((name) => [name, 0]));
  const targetWorkshopCounts = new Map();
  const workshopConfigs = [];
  let totalWorkshopExtras = 0;

  for (const workshopName of workshops) {
    const workshopLeads = assignableLeads.filter((lead) => String(lead.workshop || "").trim() === workshopName);
    const baseTarget = Math.floor(workshopLeads.length / activeCounselors.length);
    const remainder = workshopLeads.length % activeCounselors.length;
    const touchedCounts = touchedWorkshopCounts.get(workshopName) || new Map();
    const externalTouchedCount = externalTouchedWorkshopCounts.get(workshopName) || 0;
    const mandatoryExtras = new Map();
    let mandatoryCount = 0;

    if (externalTouchedCount > 0) {
      return {
        activeCounselors,
        assignableLeads,
        workshops,
        currentCounts,
        currentWorkshopCounts,
        targetCounts,
        targetWorkshopCounts,
        suggestions: [],
        totalLeads: assignableLeads.length,
        totalSuggestedMoves: 0,
        isFeasible: false,
        issue: `${workshopName} has touched leads outside the active counselor team, so perfect balancing is not possible without moving touched records.`
      };
    }

    for (const counselorName of activeCounselors) {
      const touchedCount = touchedCounts.get(counselorName) || 0;
      if (touchedCount > baseTarget + 1) {
        return {
          activeCounselors,
          assignableLeads,
          workshops,
          currentCounts,
          currentWorkshopCounts,
          targetCounts,
          targetWorkshopCounts,
          suggestions: [],
          totalLeads: assignableLeads.length,
          totalSuggestedMoves: 0,
          isFeasible: false,
          issue: `${workshopName} cannot be balanced evenly because touched leads already exceed the per-counselor target.`
        };
      }

      const requiredExtra = touchedCount > baseTarget ? 1 : 0;
      mandatoryExtras.set(counselorName, requiredExtra);
      mandatoryCount += requiredExtra;
    }

    if (mandatoryCount > remainder) {
      return {
        activeCounselors,
        assignableLeads,
        workshops,
        currentCounts,
        currentWorkshopCounts,
        targetCounts,
        targetWorkshopCounts,
        suggestions: [],
        totalLeads: assignableLeads.length,
        totalSuggestedMoves: 0,
        isFeasible: false,
        issue: `${workshopName} cannot be balanced evenly because touched leads lock too many counselors above the base target.`
      };
    }

    workshopConfigs.push({
      workshopName,
      workshopLeads,
      baseTarget,
      remainder,
      touchedCounts,
      mandatoryExtras,
      remainingExtras: remainder - mandatoryCount
    });
    totalWorkshopExtras += remainder;
  }

  const optionalAssignmentTargetCandidates = buildCounselorOptionalExtraTargetCandidates(
    workshopConfigs,
    activeCounselors,
    totalWorkshopExtras
  );
  const optionalAssignments = optionalAssignmentTargetCandidates
    .map((counselorExtraTargets) => assignWorkshopExtraSlots(workshopConfigs, activeCounselors, counselorExtraTargets))
    .find(Boolean);

  if (!optionalAssignments) {
    return {
      activeCounselors,
      assignableLeads,
      workshops,
      currentCounts,
      currentWorkshopCounts,
      targetCounts,
      targetWorkshopCounts,
      suggestions: [],
      totalLeads: assignableLeads.length,
      totalSuggestedMoves: 0,
      isFeasible: false,
      issue: "Unable to find a rebalance plan that keeps workshop counts and overall totals equal while preserving touched leads."
    };
  }

  workshopConfigs.forEach((config) => {
    const workshopTargetMap = new Map();
    activeCounselors.forEach((counselorName) => {
      const targetCount = config.baseTarget
        + (config.mandatoryExtras.get(counselorName) || 0)
        + (optionalAssignments.get(config.workshopName)?.get(counselorName) || 0);
      workshopTargetMap.set(counselorName, targetCount);
      targetCounts.set(counselorName, (targetCounts.get(counselorName) || 0) + targetCount);
    });
    targetWorkshopCounts.set(config.workshopName, workshopTargetMap);
  });

  const targetValidationIssue = validateBalancedSuggestionTargets(activeCounselors, targetCounts, assignableLeads.length);
  if (targetValidationIssue) {
    return {
      activeCounselors,
      assignableLeads,
      workshops,
      currentCounts,
      currentWorkshopCounts,
      targetCounts,
      targetWorkshopCounts,
      suggestions: [],
      totalLeads: assignableLeads.length,
      totalSuggestedMoves: 0,
      isFeasible: false,
      issue: targetValidationIssue
    };
  }

  const suggestions = [];

  workshops.forEach((workshopName) => {
    const workshopLeads = assignableLeads.filter((lead) => String(lead.workshop || "").trim() === workshopName);
    const currentWorkshopMap = currentWorkshopCounts.get(workshopName) || new Map();
    const targetWorkshopMap = targetWorkshopCounts.get(workshopName) || new Map();
    const donorQueues = new Map();
    const donors = [];
    const receivers = [];

    activeCounselors.forEach((counselorName) => {
      const currentCount = currentWorkshopMap.get(counselorName) || 0;
      const targetCount = targetWorkshopMap.get(counselorName) || 0;
      const untouchedLeads = workshopLeads
        .filter((lead) => (
          String(lead.counselor || "Unassigned").trim() === counselorName &&
          isUntouchedLead(lead)
        ))
        .sort((left, right) => String(left.createdAt || "").localeCompare(String(right.createdAt || "")))
        .map((lead) => buildLeadSelectionRef(lead));

      if (currentCount > targetCount) {
        const movableCount = Math.min(currentCount - targetCount, untouchedLeads.length);
        donorQueues.set(counselorName, untouchedLeads);
        donors.push({ name: counselorName, available: movableCount });
      }

      if (targetCount > currentCount) {
        receivers.push({ name: counselorName, needed: targetCount - currentCount });
      }
    });

    [...new Set(
      workshopLeads
        .map((lead) => String(lead.counselor || "Unassigned").trim() || "Unassigned")
        .filter((counselorName) => counselorName && !activeCounselors.includes(counselorName))
    )]
      .forEach((counselorName) => {
        const untouchedLeads = workshopLeads
          .filter((lead) => (
            (String(lead.counselor || "Unassigned").trim() || "Unassigned") === counselorName &&
            isUntouchedLead(lead)
          ))
          .sort((left, right) => String(left.createdAt || "").localeCompare(String(right.createdAt || "")))
          .map((lead) => buildLeadSelectionRef(lead));

        if (untouchedLeads.length) {
          donorQueues.set(counselorName, untouchedLeads);
          donors.push({ name: counselorName, available: untouchedLeads.length });
        }
      });

    donors.sort((left, right) => right.available - left.available || left.name.localeCompare(right.name));
    receivers.sort((left, right) => right.needed - left.needed || left.name.localeCompare(right.name));

    receivers.forEach((receiver) => {
      donors.forEach((donor) => {
        if (!receiver.needed || !donor.available) {
          return;
        }

        const moveCount = Math.min(receiver.needed, donor.available);
        const leadRefs = (donorQueues.get(donor.name) || []).splice(0, moveCount);
        if (!leadRefs.length) {
          return;
        }

        suggestions.push({
          workshopName,
          from: donor.name,
          to: receiver.name,
          count: leadRefs.length,
          leadRefs
        });
        donor.available -= leadRefs.length;
        receiver.needed -= leadRefs.length;
      });
    });
  });

  const totalSuggestedMoves = suggestions.reduce((sum, suggestion) => sum + suggestion.count, 0);
  const outcomeValidationIssue = validateSuggestionOutcome({
    activeCounselors,
    currentCounts,
    targetCounts,
    suggestions
  });
  if (outcomeValidationIssue) {
    return {
      activeCounselors,
      assignableLeads,
      workshops,
      currentCounts,
      currentWorkshopCounts,
      targetCounts,
      targetWorkshopCounts,
      suggestions: [],
      totalLeads: assignableLeads.length,
      totalSuggestedMoves: 0,
      isFeasible: false,
      issue: outcomeValidationIssue
    };
  }

  for (const workshopName of workshops) {
    const currentWorkshopMap = currentWorkshopCounts.get(workshopName) || new Map();
    const targetWorkshopMap = targetWorkshopCounts.get(workshopName) || new Map();

    for (const counselorName of activeCounselors) {
      const currentCount = currentWorkshopMap.get(counselorName) || 0;
      const targetCount = targetWorkshopMap.get(counselorName) || 0;
      if (currentCount > targetCount) {
        const movableCount = assignableLeads.filter((lead) => (
          String(lead.workshop || "").trim() === workshopName &&
          String(lead.counselor || "Unassigned").trim() === counselorName &&
          isUntouchedLead(lead)
        )).length;
        if (movableCount < currentCount - targetCount) {
          return {
            activeCounselors,
            assignableLeads,
            workshops,
            currentCounts,
            currentWorkshopCounts,
            targetCounts,
            targetWorkshopCounts,
            suggestions: [],
            totalLeads: assignableLeads.length,
            totalSuggestedMoves: 0,
            isFeasible: false,
            issue: `${workshopName} cannot be fully balanced because there are not enough untouched leads available to move.`
          };
        }
      }
    }
  }

  return {
    activeCounselors,
    assignableLeads,
    workshops,
    currentCounts,
    currentWorkshopCounts,
    targetCounts,
    targetWorkshopCounts,
    suggestions,
    totalLeads: assignableLeads.length,
    totalSuggestedMoves,
    isFeasible: true,
    issue: ""
  };
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

function renderAssignmentSuggestionPanel(preWorkshopLeads) {
  if (!assignmentSuggestionSummary || !assignmentSuggestionList) {
    return;
  }

  const balanceData = getOverallLeadBalanceData(preWorkshopLeads);
  lastAssignmentSuggestions = balanceData.suggestions;

  if (applyAllAssignmentSuggestionsBtn) {
    applyAllAssignmentSuggestionsBtn.disabled = !balanceData.suggestions.length;
  }

  if (!balanceData.activeCounselors.length) {
    assignmentSuggestionSummary.innerHTML = `<p class="block-help">Add active counselors to generate balancing suggestions.</p>`;
    assignmentSuggestionList.innerHTML = "";
    return;
  }

  assignmentSuggestionSummary.innerHTML = `
    <div class="suggestion-overview">
      <article class="suggestion-overview-stat">
        <span>Total Leads</span>
        <strong>${balanceData.totalLeads}</strong>
      </article>
      <article class="suggestion-overview-stat">
        <span>Total Counselors</span>
        <strong>${balanceData.activeCounselors.length}</strong>
      </article>
      <article class="suggestion-overview-stat">
        <span>Total Reassignments</span>
        <strong>${balanceData.totalSuggestedMoves}</strong>
      </article>
    </div>
    <div class="suggestion-summary-grid">
      ${balanceData.activeCounselors.map((name) => `
        <article class="suggestion-stat">
          <span>${escapeHtml(name)}</span>
          <strong>${balanceData.currentCounts.get(name) || 0}</strong>
          <small>Target ${balanceData.targetCounts.get(name) || 0}</small>
        </article>
      `).join("")}
    </div>
  `;

  if (!balanceData.totalLeads) {
    assignmentSuggestionList.innerHTML = `<p class="block-help">No leads are available to rebalance.</p>`;
    return;
  }

  const issueNote = balanceData.issue
    ? `<p class="block-help">${escapeHtml(balanceData.issue)}</p>`
    : "";

  if (!balanceData.isFeasible) {
    assignmentSuggestionList.innerHTML = issueNote || `<p class="block-help">Perfect balance is blocked by touched leads.</p>`;
    return;
  }

  if (!balanceData.suggestions.length) {
    assignmentSuggestionList.innerHTML = issueNote || `<p class="block-help">Overall counselor load is already perfectly balanced.</p>`;
    return;
  }

  assignmentSuggestionList.innerHTML = issueNote + balanceData.suggestions
    .map((suggestion, index) => `
      <article class="suggestion-item">
        <div>
          <h5>${suggestion.count} lead${suggestion.count === 1 ? "" : "s"}</h5>
          <p>${escapeHtml(suggestion.workshopName)}: ${escapeHtml(suggestion.from)} to ${escapeHtml(suggestion.to)}</p>
        </div>
        <button type="button" class="btn-ghost apply-suggestion-btn" data-suggestion-index="${index}">Apply</button>
      </article>
    `)
    .join("");

  document.querySelectorAll(".apply-suggestion-btn").forEach((button) => {
    button.onclick = () => {
      const suggestionIndex = Number(button.getAttribute("data-suggestion-index"));
      void applyAssignmentSuggestionByIndex(suggestionIndex);
    };
  });
}

async function applyAssignmentSuggestionByIndex(index) {
  const suggestion = lastAssignmentSuggestions[index];
  if (!suggestion) {
    return;
  }

  const result = await assignLeadsOnServer(suggestion.leadRefs, suggestion.to);
  if (!result || result.ok === false) {
    setMessage(assignmentSuggestionMessage, result?.message || "Failed to apply the assignment suggestion.", true);
    showToast(result?.message || "Failed to apply the assignment suggestion.", true);
    return;
  }

  setMessage(assignmentSuggestionMessage, `Moved ${suggestion.count} lead${suggestion.count === 1 ? "" : "s"} from ${suggestion.from} to ${suggestion.to}.`, false);
  showToast(`Moved ${suggestion.count} lead${suggestion.count === 1 ? "" : "s"} to ${suggestion.to}.`, false);
  renderAll();
}

async function applyAllAssignmentSuggestions() {
  if (!lastAssignmentSuggestions.length) {
    return;
  }

  let movedCount = 0;
  const suggestions = [...lastAssignmentSuggestions];
  for (const suggestion of suggestions) {
    const result = await assignLeadsOnServer(suggestion.leadRefs, suggestion.to);
    if (!result || result.ok === false) {
      setMessage(assignmentSuggestionMessage, result?.message || "Stopped while applying assignment suggestions.", true);
      showToast(result?.message || "Stopped while applying assignment suggestions.", true);
      renderAll();
      return;
    }
    movedCount += suggestion.count;
  }

  setMessage(assignmentSuggestionMessage, `Applied ${suggestions.length} suggestion${suggestions.length === 1 ? "" : "s"} and reassigned ${movedCount} lead${movedCount === 1 ? "" : "s"}.`, false);
  showToast(`Reassigned ${movedCount} lead${movedCount === 1 ? "" : "s"} using smart suggestions.`, false);
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

  if (applyAllAssignmentSuggestionsBtn) {
    applyAllAssignmentSuggestionsBtn.onclick = () => {
      void applyAllAssignmentSuggestions();
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

  const preWorkshopLeads = getPreWorkshopLeads(allLeads);
  renderAssignmentSuggestionPanel(preWorkshopLeads);
}

renderAll();
const stopStatePolling = startStatePolling(() => {
  renderAll();
});
registerPageCleanup(stopStatePolling);
