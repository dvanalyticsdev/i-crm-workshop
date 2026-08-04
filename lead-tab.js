import { apiUrl } from "./api-client.js";
import {
  CRM_FIXED_COURSE_OPTIONS,
  getCanonicalPublicCourseIdentity,
  normalizeCrmCourseValue
} from "./course-catalog.js";
import { openActivityHistory } from "./activity-history.js";
import {
  addLeadNote,
  deleteLeadNote,
  deleteLeads,
  trackLeadView,
  updateLeadActivity,
  updateMainAdmissionLeadDetails
} from "./lead-service.js";
import { triggerMcubeClickToCall } from "./mcube-call-service.js";
import { registerPageCleanup } from "./page-runtime.js";
import { bootstrapLocalState, getSession } from "./state-sync.js";
import { createTask, TASK_CATEGORY, toTaskDueDateIso } from "./task-service.js";
import { formatKolkataDisplay, formatKolkataDateTime } from "./date-utils.js";

await bootstrapLocalState({ skipStateRefresh: true });

const session = getSession();
const isAdmin = session?.role === "admin" || session?.role === "super_admin";
const isCounselor = session?.role === "counselor";

const pageTitle = document.getElementById("leadTabPageTitle");
const pageSubtitle = document.getElementById("leadTabPageSubtitle");
const messageEl = document.getElementById("leadTabMessage");
const sidebarEl = document.getElementById("leadTabSidebar");
const actionsEl = document.getElementById("leadTabActions");
const tabsEl = document.getElementById("leadTabTabs");
const panelEl = document.getElementById("leadTabPanel");
const activityModal = document.getElementById("leadTabActivityModal");
const activityForm = document.getElementById("leadTabActivityForm");
const taskModal = document.getElementById("leadTabTaskModal");
const taskForm = document.getElementById("leadTabTaskForm");
const taskMessage = document.getElementById("leadTabTaskMessage");

const params = new URLSearchParams(window.location.search);
const requestedLeadId = String(params.get("leadId") || "").trim();
const requestedLeadEmail = String(params.get("leadEmail") || "").trim().toLowerCase();
const requestedStage = String(params.get("stage") || "").trim().toLowerCase();

let activeLead = null;
let activeStage = requestedStage;
let counselors = [];
let activeTab = "details";
let detailsEditMode = false;
const leadCacheKey = `dvLeadTabCache:${requestedLeadId}:${requestedLeadEmail || "no-email"}:${requestedStage || "auto"}`;

function renderIcon(name) {
  const icons = {
    phone: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7A2 2 0 0 1 22 16.9Z"/></svg>`,
    activity: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
    task: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 11l2 2 4-4"/><path d="M20 6v14H4V6"/><path d="M8 6V4h8v2"/></svg>`,
    notes: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"/></svg>`,
    history: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg>`,
    edit: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
    save: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></svg>`,
    close: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
    delete: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>`
  };
  return icons[name] || "";
}

function renderActionButton({ action, icon, label, variant = "ghost", disabled = false, text = "" }) {
  const labelText = escapeHtml(label);
  const visibleText = text ? `<span class="lead-tab-action-label">${escapeHtml(text)}</span>` : "";
  return `<button type="button" class="lead-tab-icon-btn lead-tab-icon-btn--${escapeHtml(variant)}" data-lead-tab-action="${escapeHtml(action)}" title="${labelText}" aria-label="${labelText}"${disabled ? " disabled" : ""}>${renderIcon(icon)}${visibleText}</button>`;
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

function getCoreWorkshopName(workshopName) {
  if (!workshopName) return "";
  const normalizedWorkshopName = String(workshopName)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2")
    .replace(/\b(\d{1,2})\s+(st|nd|rd|th)\b/gi, "$1$2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[_\s]+(imp|od|ind)$/i, "")
    .trim();
  const name = normalizedWorkshopName.toLowerCase();

  if (name.includes("gen") && name.includes("11")) {
    return "Gen AI Workshop 11th June";
  }
  if (name.includes("python") && name.includes("20")) {
    return "Python Workshop 20th June";
  }
  if (name.includes("powe") && name.includes("27")) {
    return "Power BI Workshop 27th June";
  }
  if (name.includes("cyber") && name.includes("21")) {
    return "Cyber Security Workshop 21st June";
  }
  if (name.includes("sql") && name.includes("13")) {
    return "SQL Workshop 13th June";
  }

  return normalizedWorkshopName;
}

function shortenWorkshopLabel(workshopName) {
  const coreName = getCoreWorkshopName(workshopName);
  const cleaned = coreName.replace(/\bworkshop\b/gi, "").replace(/\s{2,}/g, " ").trim();
  return cleaned || coreName;
}

function getLeadWorkshopName(lead) {
  const sourceName = String(lead?.workshop || lead?.workshopName || "").trim();
  const shortened = shortenWorkshopLabel(sourceName);
  return shortened.replace(/\s+\d{1,2}(?:st|nd|rd|th)\s+[A-Za-z]+$/i, "").trim();
}

function getLeadWorkshopDisplay(lead) {
  const normalizedAdmissionWorkshop = getLeadWorkshopName({ workshop: lead?.admissionWorkshop || "" });
  if (normalizedAdmissionWorkshop) return normalizedAdmissionWorkshop;
  return String(lead?.workshopName || getLeadWorkshopName(lead) || lead?.workshop || "").trim();
}

function getLeadProgramLabel(lead, fallback = "Lead workspace", stage = activeStage) {
  const safeStage = String(stage || "").trim().toLowerCase();
  if (safeStage === "workshop") {
    return String(getLeadWorkshopDisplay(lead) || lead?.courseName || fallback).trim();
  }
  return String(lead?.courseName || getLeadWorkshopDisplay(lead) || fallback).trim();
}

function formatDateTime(value) {
  return formatKolkataDateTime(value, "-");
}

function setMessage(message, isError = false) {
  messageEl.textContent = message;
  messageEl.style.color = isError ? "var(--danger)" : "var(--success)";
}

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
  window.setTimeout(() => {
    toast.classList.add("toast--fade");
    window.setTimeout(() => toast.remove(), 300);
  }, 2800);
}

async function runWithButtonBusy(button, label, action) {
  if (!button) {
    return action();
  }
  const previous = button.textContent;
  button.disabled = true;
  button.classList.add("is-loading");
  button.textContent = label;
  try {
    return await action();
  } finally {
    button.disabled = false;
    button.classList.remove("is-loading");
    button.textContent = previous;
  }
}

function getCounselorIdentity() {
  if (!isCounselor) return "";
  const email = String(session?.email || "").trim().toLowerCase();
  const counselor = counselors.find((item) => String(item.email || "").trim().toLowerCase() === email);
  return String(counselor?.name || session?.name || "").trim().toLowerCase();
}

function readLeadTabCache() {
  try {
    const raw = localStorage.getItem(leadCacheKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (Date.now() - Number(parsed.cachedAt || 0) > 2 * 60 * 1000) {
      localStorage.removeItem(leadCacheKey);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeLeadTabCache({ lead, stage, counselors: cachedCounselors = [] } = {}) {
  if (!lead) return;
  try {
    localStorage.setItem(leadCacheKey, JSON.stringify({
      cachedAt: Date.now(),
      lead,
      stage,
      counselors: Array.isArray(cachedCounselors) ? cachedCounselors : []
    }));
  } catch {
    // Ignore cache write errors.
  }
}

function canUseCounselorActions(lead) {
  return isCounselor && String(lead?.counselor || "").trim().toLowerCase() === getCounselorIdentity();
}

function getLeadExtraFields(lead) {
  if (lead?.metaExtraFields && typeof lead.metaExtraFields === "object") return lead.metaExtraFields;
  if (lead?.elementorExtraFields && typeof lead.elementorExtraFields === "object") return lead.elementorExtraFields;
  return {};
}

function getLeadWhatsappNumber(lead) {
  const extraFields = getLeadExtraFields(lead);
  const keys = ["whatsapp_phone_number", "whatsapp_number", "whatsapp_phone", "whatsapp", "wa_number", "wa_phone", "mobile_whatsapp"];
  for (const key of keys) {
    const value = String(extraFields[key] || "").trim();
    if (value) return value;
  }
  return "";
}

function getLeadLocation(lead) {
  const extraFields = getLeadExtraFields(lead);
  const candidates = [extraFields.city, extraFields.current_city, extraFields.city_name, extraFields.town, extraFields.location, lead.country];
  for (const value of candidates) {
    const normalized = String(value || "").trim();
    if (normalized) return normalized;
  }
  return "India";
}

function getLeadSource(lead) {
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
  ].map(normalizeText).filter(Boolean).join(" ");

  if (/\b(instagram|insta|ig)\b/.test(sourceSignals)) return "Instagram Lead";
  if (/\b(facebook|fb)\b/.test(sourceSignals)) return "Facebook Lead";
  if (normalizeText(lead.elementorPageUrl) || /\b(elementor|website|web|landing page|site)\b/.test(sourceSignals)) return "Website Lead";
  if (/\b(meta)\b/.test(sourceSignals)) return "Meta Lead";
  return String(lead.source || "").trim() || "Unknown";
}

function normalizeLeadFields(leads) {
  leads.forEach((lead) => {
    lead.counselor = lead.counselor || "Unassigned";
    const canonicalCourse = getCanonicalPublicCourseIdentity([
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
    lead.courseRawName = String(lead.courseRawName || lead.courseName || "").trim();
    lead.courseName = canonicalCourse.label || String(lead.courseName || "").trim();
    lead.workshop = String(lead.workshop || "").trim();
    lead.workshopName = String(lead.workshopName || getLeadWorkshopName(lead)).trim();
    lead.admissionWorkshop = String(lead.admissionWorkshop || "").trim();
    lead.coursePitched = normalizeCrmCourseValue(lead.coursePitched, { allowNo: true, preserveUnknown: true });
    lead.mainAdmissionCoursePitched = normalizeCrmCourseValue(lead.mainAdmissionCoursePitched, { allowNo: true, preserveUnknown: true });
    lead.registeredCoursePitched = normalizeCrmCourseValue(lead.registeredCoursePitched, { allowNo: true, preserveUnknown: true });
    lead.leadNotes = Array.isArray(lead.leadNotes) ? lead.leadNotes : [];
    lead.mainAdmissionActivityHistory = Array.isArray(lead.mainAdmissionActivityHistory) ? lead.mainAdmissionActivityHistory : [];
    lead.registeredActivityHistory = Array.isArray(lead.registeredActivityHistory) ? lead.registeredActivityHistory : [];
    lead.workshopActivityHistory = Array.isArray(lead.workshopActivityHistory) ? lead.workshopActivityHistory : [];
    lead.admissionActivityHistory = Array.isArray(lead.admissionActivityHistory) ? lead.admissionActivityHistory : [];
    lead.metaExtraFields = lead.metaExtraFields && typeof lead.metaExtraFields === "object" ? lead.metaExtraFields : {};
    lead.elementorExtraFields = lead.elementorExtraFields && typeof lead.elementorExtraFields === "object" ? lead.elementorExtraFields : {};
  });
}

function inferStage(lead) {
  const pipeline = normalizeText(lead?.leadPipeline || "");
  if (pipeline === "main-admission") return "main-admission";
  if (pipeline === "course-registration") return "registered-course";
  if (
    String(lead?.postDialed || "").trim()
    || String(lead?.courseStatus || "").trim()
    || String(lead?.admissionStatus || "").trim()
    || String(lead?.postCallStatus || "").trim()
    || Boolean(lead?.postStatusUpdated)
  ) {
    return "admission";
  }
  return "workshop";
}

function getStageConfig(stage) {
  const safeStage = stage || "workshop";
  const sharedCourseOptions = CRM_FIXED_COURSE_OPTIONS.map((course) => `<option value="${escapeHtml(course.label)}">${escapeHtml(course.label)}</option>`).join("");
  return {
    workshop: {
      label: "Workshop Calling",
      taskCategory: TASK_CATEGORY.workshop,
      updateStage: "workshop",
      historyField: "workshopActivityHistory",
      renderActivityForm: (lead) => `
        <h3>Update Workshop Calling Activity</h3>
        <div class="modal-row"><label for="leadTabDialed">Dialed</label><select id="leadTabDialed"><option value="">Select</option><option value="Yes">Yes</option><option value="No">No</option></select></div>
        <div class="modal-row"><label for="leadTabCallStatus">Call Status</label><select id="leadTabCallStatus"><option value="">Select</option><option value="Connected">Connected</option><option value="CBL">CBL</option><option value="DNP">DNP</option><option value="CNC">CNC</option></select></div>
        <div class="modal-row"><label for="leadTabWsStatus">Workshop Status</label><select id="leadTabWsStatus"><option value="">Select</option><option value="Interested">Interested</option><option value="Not Interested">Not Interested</option></select></div>
        <div class="modal-row"><label for="leadTabWhatsappInvite">WhatsApp Invitation</label><select id="leadTabWhatsappInvite"><option value="">Select</option><option value="Yes">Yes</option><option value="No">No</option></select></div>
        <div class="modal-row"><label for="leadTabWhatsappGroupStatus">WhatsApp Group Status</label><select id="leadTabWhatsappGroupStatus"><option value="">Select</option><option value="Joined">Joined</option><option value="Not Joined">Not Joined</option></select></div>
        <div class="modal-row modal-row-span-2"><label for="leadTabActivityNote">Add Note</label><textarea id="leadTabActivityNote" rows="3" placeholder="Optional note for this update"></textarea></div>
        <div class="modal-actions"><button type="submit" class="btn-primary">Save</button><button type="button" id="leadTabCloseActivityModalBtn" class="btn-ghost">Cancel</button></div>
      `,
      populateActivityForm: (lead) => {
        document.getElementById("leadTabDialed").value = lead.dialed || "";
        document.getElementById("leadTabCallStatus").value = lead.callStatus || "";
        document.getElementById("leadTabWsStatus").value = lead.wsStatus || "";
        document.getElementById("leadTabWhatsappInvite").value = lead.whatsappInvite || "";
        document.getElementById("leadTabWhatsappGroupStatus").value = lead.whatsappGroupStatus || "";
        document.getElementById("leadTabActivityNote").value = "";
      },
      collectUpdates: () => ({
        dialed: document.getElementById("leadTabDialed").value,
        callStatus: document.getElementById("leadTabCallStatus").value,
        wsStatus: document.getElementById("leadTabWsStatus").value,
        whatsappInvite: document.getElementById("leadTabWhatsappInvite").value,
        whatsappGroupStatus: document.getElementById("leadTabWhatsappGroupStatus").value
      }),
      getStatusBadges: (lead) => [lead.callStatus, lead.wsStatus, lead.whatsappInvite && `Invite: ${lead.whatsappInvite}`, lead.whatsappGroupStatus].filter(Boolean)
    },
    admission: {
      label: "Admission Calling",
      taskCategory: TASK_CATEGORY.admission,
      updateStage: "admission",
      historyField: "admissionActivityHistory",
      renderActivityForm: () => `
        <h3>Update Admission Calling Activity</h3>
        <div class="modal-row"><label for="leadTabPostDialed">Dialed</label><select id="leadTabPostDialed"><option value="">Select</option><option value="Yes">Yes</option><option value="No">No</option></select></div>
        <div class="modal-row"><label for="leadTabCoursePitched">Course Pitched</label><select id="leadTabCoursePitched"><option value="">Select</option>${sharedCourseOptions}</select></div>
        <div class="modal-row"><label for="leadTabCourseStatus">Course Status</label><select id="leadTabCourseStatus"><option value="">Select</option><option value="Interested">Interested</option><option value="Not Interested">Not Interested</option></select></div>
        <div class="modal-row"><label for="leadTabAdmissionStatus">Admission</label><select id="leadTabAdmissionStatus"><option value="">Select</option><option value="In-Conversation">In-Conversation</option><option value="Opportunity">Opportunity</option><option value="Offered">Offered</option><option value="Enrolled">Enrolled</option><option value="Won">Won</option></select></div>
        <div class="modal-row"><label for="leadTabPostCallStatus">Call Status</label><select id="leadTabPostCallStatus"><option value="">Select</option><option value="Connected">Connected</option><option value="CBL">CBL</option><option value="DNP">DNP</option><option value="CNC">CNC</option></select></div>
        <div class="modal-row"><label for="leadTabAdmissionWorkshop">Workshop Name</label><input id="leadTabAdmissionWorkshop" type="text" /></div>
        <div class="modal-row"><label for="leadTabWorkshopJoiningStatus">Workshop Joining Status</label><select id="leadTabWorkshopJoiningStatus"><option value="">Select</option><option value="Joined">Joined</option><option value="Not Joined">Not Joined</option></select></div>
        <div class="modal-row modal-row-span-2"><label for="leadTabActivityNote">Add Note</label><textarea id="leadTabActivityNote" rows="3" placeholder="Optional note for this update"></textarea></div>
        <div class="modal-actions"><button type="submit" class="btn-primary">Save</button><button type="button" id="leadTabCloseActivityModalBtn" class="btn-ghost">Cancel</button></div>
      `,
      populateActivityForm: (lead) => {
        document.getElementById("leadTabPostDialed").value = lead.postDialed || "";
        document.getElementById("leadTabCoursePitched").value = lead.coursePitched || "";
        document.getElementById("leadTabCourseStatus").value = lead.courseStatus || "";
        document.getElementById("leadTabAdmissionStatus").value = lead.admissionStatus || "";
        document.getElementById("leadTabPostCallStatus").value = lead.postCallStatus || "";
        document.getElementById("leadTabAdmissionWorkshop").value = lead.admissionWorkshop || lead.workshop || "";
        document.getElementById("leadTabWorkshopJoiningStatus").value = lead.workshopJoiningStatus || "";
        document.getElementById("leadTabActivityNote").value = "";
      },
      collectUpdates: () => ({
        postDialed: document.getElementById("leadTabPostDialed").value,
        coursePitched: document.getElementById("leadTabCoursePitched").value,
        courseStatus: document.getElementById("leadTabCourseStatus").value,
        admissionStatus: document.getElementById("leadTabAdmissionStatus").value,
        postCallStatus: document.getElementById("leadTabPostCallStatus").value,
        admissionWorkshop: document.getElementById("leadTabAdmissionWorkshop").value.trim(),
        workshopJoiningStatus: document.getElementById("leadTabWorkshopJoiningStatus").value,
        postStatusUpdated: true
      }),
      getStatusBadges: (lead) => [lead.courseStatus, lead.admissionStatus, lead.postCallStatus, lead.workshopJoiningStatus].filter(Boolean)
    },
    "registered-course": {
      label: "Registered Candidates",
      taskCategory: TASK_CATEGORY.registered,
      updateStage: "registered-course",
      historyField: "registeredActivityHistory",
      renderActivityForm: () => `
        <h3>Update Registered Candidate Activity</h3>
        <div class="modal-row"><label for="leadTabRegisteredDialed">Dialed</label><select id="leadTabRegisteredDialed"><option value="">Select</option><option value="Yes">Yes</option><option value="No">No</option></select></div>
        <div class="modal-row"><label for="leadTabRegisteredCoursePitched">Course Pitched</label><select id="leadTabRegisteredCoursePitched"><option value="">Select</option>${sharedCourseOptions}</select></div>
        <div class="modal-row"><label for="leadTabRegisteredCourseStatus">Course Status</label><select id="leadTabRegisteredCourseStatus"><option value="">Select</option><option value="Interested">Interested</option><option value="Not Interested">Not Interested</option></select></div>
        <div class="modal-row"><label for="leadTabRegisteredAdmissionStatus">Admission</label><select id="leadTabRegisteredAdmissionStatus"><option value="">Select</option><option value="In-Conversation">In-Conversation</option><option value="Opportunity">Opportunity</option><option value="Offered">Offered</option><option value="Enrolled">Enrolled</option><option value="Won">Won</option></select></div>
        <div class="modal-row"><label for="leadTabRegisteredCallStatus">Call Status</label><select id="leadTabRegisteredCallStatus"><option value="">Select</option><option value="Connected">Connected</option><option value="CBL">CBL</option><option value="DNP">DNP</option><option value="CNC">CNC</option></select></div>
        <div class="modal-row modal-row-span-2"><label for="leadTabActivityNote">Add Note</label><textarea id="leadTabActivityNote" rows="3" placeholder="Optional note for this update"></textarea></div>
        <div class="modal-actions"><button type="submit" class="btn-primary">Save</button><button type="button" id="leadTabCloseActivityModalBtn" class="btn-ghost">Cancel</button></div>
      `,
      populateActivityForm: (lead) => {
        document.getElementById("leadTabRegisteredDialed").value = lead.registeredDialed || "";
        document.getElementById("leadTabRegisteredCoursePitched").value = lead.registeredCoursePitched || "";
        document.getElementById("leadTabRegisteredCourseStatus").value = lead.registeredCourseStatus || "";
        document.getElementById("leadTabRegisteredAdmissionStatus").value = lead.registeredAdmissionStatus || "";
        document.getElementById("leadTabRegisteredCallStatus").value = lead.registeredCallStatus || "";
        document.getElementById("leadTabActivityNote").value = "";
      },
      collectUpdates: () => ({
        registeredDialed: document.getElementById("leadTabRegisteredDialed").value,
        registeredCoursePitched: document.getElementById("leadTabRegisteredCoursePitched").value,
        registeredCourseStatus: document.getElementById("leadTabRegisteredCourseStatus").value,
        registeredAdmissionStatus: document.getElementById("leadTabRegisteredAdmissionStatus").value,
        registeredCallStatus: document.getElementById("leadTabRegisteredCallStatus").value,
        registeredActivityUpdated: true
      }),
      getStatusBadges: (lead) => [lead.registeredCourseStatus, lead.registeredAdmissionStatus, lead.registeredCallStatus].filter(Boolean)
    },
    "main-admission": {
      label: "Main Admission Leads",
      taskCategory: TASK_CATEGORY.mainAdmission,
      updateStage: "main-admission",
      historyField: "mainAdmissionActivityHistory",
      renderActivityForm: () => `
        <h3>Update Main Admission Lead Activity</h3>
        <div class="modal-row"><label for="leadTabMainDialed">Dialed</label><select id="leadTabMainDialed"><option value="">Select</option><option value="Yes">Yes</option><option value="No">No</option></select></div>
        <div class="modal-row"><label for="leadTabMainCoursePitched">Course Pitched</label><select id="leadTabMainCoursePitched"><option value="">Select</option>${sharedCourseOptions}</select></div>
        <div class="modal-row"><label for="leadTabMainCourseStatus">Course Status</label><select id="leadTabMainCourseStatus"><option value="">Select</option><option value="Interested">Interested</option><option value="Not Interested">Not Interested</option></select></div>
        <div class="modal-row"><label for="leadTabMainAdmissionStatus">Admission</label><select id="leadTabMainAdmissionStatus"><option value="">Select</option><option value="In-Conversation">In-Conversation</option><option value="Opportunity">Opportunity</option><option value="Offered">Offered</option><option value="Enrolled">Enrolled</option><option value="Won">Won</option></select></div>
        <div class="modal-row"><label for="leadTabMainCallStatus">Call Status</label><select id="leadTabMainCallStatus"><option value="">Select</option><option value="Connected">Connected</option><option value="CBL">CBL</option><option value="DNP">DNP</option><option value="CNC">CNC</option></select></div>
        <div class="modal-row modal-row-span-2"><label for="leadTabActivityNote">Add Note</label><textarea id="leadTabActivityNote" rows="3" placeholder="Optional note for this update"></textarea></div>
        <div class="modal-actions"><button type="submit" class="btn-primary">Save</button><button type="button" id="leadTabCloseActivityModalBtn" class="btn-ghost">Cancel</button></div>
      `,
      populateActivityForm: (lead) => {
        document.getElementById("leadTabMainDialed").value = lead.mainAdmissionDialed || "";
        document.getElementById("leadTabMainCoursePitched").value = lead.mainAdmissionCoursePitched || "";
        document.getElementById("leadTabMainCourseStatus").value = lead.mainAdmissionCourseStatus || "";
        document.getElementById("leadTabMainAdmissionStatus").value = lead.mainAdmissionAdmissionStatus || "";
        document.getElementById("leadTabMainCallStatus").value = lead.mainAdmissionCallStatus || "";
        document.getElementById("leadTabActivityNote").value = "";
      },
      collectUpdates: () => ({
        mainAdmissionDialed: document.getElementById("leadTabMainDialed").value,
        mainAdmissionCoursePitched: document.getElementById("leadTabMainCoursePitched").value,
        mainAdmissionCourseStatus: document.getElementById("leadTabMainCourseStatus").value,
        mainAdmissionAdmissionStatus: document.getElementById("leadTabMainAdmissionStatus").value,
        mainAdmissionCallStatus: document.getElementById("leadTabMainCallStatus").value,
        mainAdmissionActivityUpdated: true
      }),
      getStatusBadges: (lead) => [lead.mainAdmissionCourseStatus, lead.mainAdmissionAdmissionStatus, lead.mainAdmissionCallStatus].filter(Boolean)
    }
  }[safeStage] || null;
}

function renderNotFound(message) {
  document.title = "Lead Not Found";
  pageTitle.textContent = "Lead Not Found";
  pageSubtitle.textContent = message;
  sidebarEl.innerHTML = `<div class="lead-tab-empty-state"><h3>Lead unavailable</h3><p>${escapeHtml(message)}</p></div>`;
  actionsEl.innerHTML = "";
  tabsEl.innerHTML = "";
  panelEl.innerHTML = "";
}

async function fetchLeadTabPayload() {
  const params = new URLSearchParams();
  if (requestedLeadEmail) {
    params.set("leadEmail", requestedLeadEmail);
  }
  if (requestedStage) {
    params.set("stage", requestedStage);
  }
  const query = params.toString() ? `?${params.toString()}` : "";
  const response = await fetch(apiUrl(`/api/leads/${encodeURIComponent(requestedLeadId)}/tab${query}`), {
    credentials: "same-origin",
    headers: { Accept: "application/json" }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.message || "Failed to load lead.");
  }
  return payload;
}

function applyLeadPayload({ lead, stage, counselors: payloadCounselors = [] } = {}) {
  if (!lead) return false;
  counselors = Array.isArray(payloadCounselors) && payloadCounselors.length ? payloadCounselors : counselors;
  normalizeLeadFields([lead]);
  activeLead = lead;
  activeStage = requestedStage || stage || inferStage(lead);
  writeLeadTabCache({ lead, stage: activeStage, counselors });
  return true;
}

function canEditLeadDetails() {
  if (activeStage !== "main-admission") return false;
  if (isAdmin) return true;
  return canUseCounselorActions(activeLead);
}

function buildLeadDetailSections(lead) {
  const extraFields = getLeadExtraFields(lead);
  const whatsappPhone = getLeadWhatsappNumber(lead);
  const city = String(extraFields.city || "").trim();
  const state = String(extraFields.state || "").trim();
  const extraFieldEntries = Object.entries(extraFields)
    .filter(([key]) => !["whatsapp_phone_number", "whatsapp_number", "whatsapp_phone", "whatsapp", "wa_number", "wa_phone", "mobile_whatsapp", "city", "state"].includes(String(key || "").trim().toLowerCase()))
    .filter(([, value]) => String(value ?? "").trim());

  return [
    {
      title: "CRM Details",
      items: [
        { label: "CRM ID", value: lead.id },
        { label: "Lead Created Date", value: formatKolkataDisplay(lead.createdAt, "-") },
        { label: "Lead Source", value: getLeadSource(lead) },
        { label: "Stage", value: getStageConfig(activeStage)?.label || activeStage }
      ]
    },
    {
      title: "Contact Details",
      editable: activeStage === "main-admission",
      items: [
        { label: "Name", value: lead.name, scope: "lead", field: "name" },
        { label: "Phone Number", value: lead.phone, scope: "lead", field: "phone" },
        { label: "WhatsApp Phone Number", value: whatsappPhone, scope: "extra", field: "whatsapp_phone_number" },
        { label: "Email", value: lead.email, scope: "lead", field: "email" },
        { label: "Location", value: getLeadLocation(lead), scope: "extra", field: "city" },
        { label: "State", value: state, scope: "extra", field: "state" }
      ]
    },
    {
      title: "Course & Assignment",
      editable: activeStage === "main-admission",
      items: [
        { label: "Course Name", value: lead.courseName, scope: "lead", field: "courseName" },
        { label: "Counselor", value: lead.counselor || "Unassigned" },
        { label: "Workshop", value: getLeadWorkshopDisplay(lead) || "-" }
      ]
    },
    {
      title: "Latest Status",
      items: getLatestStatusItems(lead)
    },
    extraFieldEntries.length ? {
      title: "Lead Qualification Details",
      editable: activeStage === "main-admission",
      items: extraFieldEntries.map(([key, value]) => ({ label: formatFieldLabel(key), value, scope: "extra", field: key }))
    } : null
  ].filter(Boolean);
}

function getLatestStatusItems(lead) {
  const statusItems = [];
  if (activeStage === "main-admission") {
    statusItems.push(
      { label: "Dialed", value: lead.mainAdmissionDialed },
      { label: "Course Pitched", value: lead.mainAdmissionCoursePitched },
      { label: "Course Status", value: lead.mainAdmissionCourseStatus },
      { label: "Admission", value: lead.mainAdmissionAdmissionStatus },
      { label: "Call Status", value: lead.mainAdmissionCallStatus }
    );
  } else if (activeStage === "registered-course") {
    statusItems.push(
      { label: "Dialed", value: lead.registeredDialed },
      { label: "Course Pitched", value: lead.registeredCoursePitched },
      { label: "Course Status", value: lead.registeredCourseStatus },
      { label: "Admission", value: lead.registeredAdmissionStatus },
      { label: "Call Status", value: lead.registeredCallStatus }
    );
  } else if (activeStage === "admission") {
    statusItems.push(
      { label: "Dialed", value: lead.postDialed },
      { label: "Course Pitched", value: lead.coursePitched },
      { label: "Course Status", value: lead.courseStatus },
      { label: "Admission", value: lead.admissionStatus },
      { label: "Call Status", value: lead.postCallStatus }
    );
  } else {
    statusItems.push(
      { label: "Dialed", value: lead.dialed },
      { label: "Workshop Status", value: lead.wsStatus },
      { label: "Call Status", value: lead.callStatus },
      { label: "WhatsApp Invite", value: lead.whatsappInvite },
      { label: "WhatsApp Group", value: lead.whatsappGroupStatus }
    );
  }
  return statusItems.filter((item) => String(item.value ?? "").trim());
}

function renderEditableDetailValue(lead, item) {
  if (!item?.scope || !item?.field) {
    return formatDetailValue(item?.value);
  }
  const value = String(item.scope === "lead" ? (lead?.[item.field] ?? "") : (getLeadExtraFields(lead)[item.field] ?? ""));
  if (item.scope === "lead" && item.field === "courseName") {
    const normalizedCourseValue = normalizeCrmCourseValue(value, { preserveUnknown: true });
    return `
      <select class="main-admission-details-input" data-detail-scope="${escapeHtml(item.scope)}" data-detail-field="${escapeHtml(item.field)}">
        <option value="">Select</option>
        ${CRM_FIXED_COURSE_OPTIONS.map((course) => `<option value="${escapeHtml(course.label)}" ${normalizedCourseValue === course.label ? "selected" : ""}>${escapeHtml(course.label)}</option>`).join("")}
      </select>
    `;
  }
  return `<input class="main-admission-details-input" type="${item.field === "email" ? "email" : "text"}" value="${escapeHtml(value)}" data-detail-scope="${escapeHtml(item.scope)}" data-detail-field="${escapeHtml(item.field)}" />`;
}

function renderSidebar() {
  const stageConfig = getStageConfig(activeStage);
  const badges = stageConfig?.getStatusBadges(activeLead) || [];
  sidebarEl.innerHTML = `
    <div class="lead-tab-summary">
      <div class="lead-tab-summary__hero">
        <span class="lead-tab-summary__eyebrow">${escapeHtml(stageConfig?.label || "Lead")}</span>
        <h2>${escapeHtml(activeLead.name || "Lead")}</h2>
        <p>${escapeHtml(getLeadProgramLabel(activeLead))}</p>
      </div>
      <div class="lead-tab-summary__meta">
        <div><strong>Phone</strong><span>${formatDetailValue(activeLead.phone)}</span></div>
        <div><strong>Email</strong><span>${formatDetailValue(activeLead.email)}</span></div>
        <div><strong>Location</strong><span>${formatDetailValue(getLeadLocation(activeLead))}</span></div>
        <div><strong>Counselor</strong><span>${formatDetailValue(activeLead.counselor || "Unassigned")}</span></div>
      </div>
      <div class="lead-tab-status-grid">${badges.map((badge) => `<span class="badge">${escapeHtml(badge)}</span>`).join("")}</div>
      <div class="lead-tab-summary__footer">
        <span><strong>Notes</strong> ${activeLead.leadNotes.length}</span>
        <span><strong>Source</strong> ${escapeHtml(getLeadSource(activeLead))}</span>
      </div>
    </div>
  `;
}

function renderActions() {
  const buttons = [];
  if (canUseCounselorActions(activeLead)) {
    buttons.push(renderActionButton({ action: "call", icon: "phone", label: "Call Lead", variant: "primary", disabled: !activeLead.phone }));
    buttons.push(renderActionButton({ action: "update", icon: "activity", label: "Update Activity", variant: "ghost" }));
    buttons.push(renderActionButton({ action: "task", icon: "task", label: "Create Task", variant: "ghost" }));
  }
  if (!isAdmin) {
    buttons.push(renderActionButton({ action: "notes", icon: "notes", label: "Notes", variant: activeTab === "notes" ? "primary" : "ghost" }));
  }
  buttons.push(renderActionButton({ action: "history", icon: "history", label: "Open Full Activity History", variant: "ghost", text: "Full History" }));
  if (isAdmin) {
    buttons.push(renderActionButton({ action: "delete", icon: "delete", label: "Delete Lead", variant: "danger" }));
  }
  actionsEl.innerHTML = `
    <div class="lead-tab-action-row">${buttons.join("")}</div>
    ${!isAdmin && !canUseCounselorActions(activeLead) ? `<p class="block-help">You can review this lead, but only the assigned counselor can call or update it.</p>` : ""}
  `;
}

function getTabs() {
  return [{ key: "details", label: "Lead Details" }, { key: "history", label: "Activity History" }];
}

function renderTabs() {
  const tabs = getTabs();
  if (!tabs.some((tab) => tab.key === activeTab) && activeTab !== "notes") {
    activeTab = tabs[0].key;
  }
  tabsEl.innerHTML = tabs.map((tab) => `<button type="button" class="lead-tab-tab ${activeTab === tab.key ? "lead-tab-tab--active" : ""}" data-lead-tab-switch="${escapeHtml(tab.key)}">${escapeHtml(tab.label)}</button>`).join("");
}

function renderDetailsPanel() {
  const sections = buildLeadDetailSections(activeLead);
  const canEdit = canEditLeadDetails();
  return `
    <div class="lead-tab-section-head">
      <div>
        <h3>${escapeHtml(activeLead.name || "Lead")} Details</h3>
        <p class="block-help">${escapeHtml(getStageConfig(activeStage)?.label || "Lead")} | CRM ${escapeHtml(activeLead.id || "-")}</p>
      </div>
      ${canEdit ? `<div class="main-admission-details-modal__actions">${detailsEditMode ? `${renderActionButton({ action: "save-details", icon: "save", label: "Save details", variant: "primary", text: "Save" })}${renderActionButton({ action: "cancel-details", icon: "close", label: "Cancel editing", variant: "ghost", text: "Cancel" })}` : `${renderActionButton({ action: "edit-details", icon: "edit", label: "Edit details", variant: "ghost", text: "Edit" })}`}</div>` : ""}
    </div>
    <div class="main-admission-details-grid">
      ${sections.map((section) => `
        <section class="main-admission-details-card">
          <h4>${escapeHtml(section.title)}</h4>
          <dl class="main-admission-details-list">
            ${section.items.map((item) => `<div class="main-admission-details-item"><dt>${escapeHtml(item.label)}</dt><dd>${detailsEditMode && section.editable ? renderEditableDetailValue(activeLead, item) : formatDetailValue(item.value)}</dd></div>`).join("")}
          </dl>
        </section>
      `).join("")}
    </div>
  `;
}

function renderNotesPanel() {
  const canEdit = canUseCounselorActions(activeLead);
  return `
    <div class="lead-tab-section-head"><div><h3>Notes</h3><p class="block-help">Notes saved for this lead.</p></div></div>
    <div class="lead-tab-notes">
      ${activeLead.leadNotes.length ? activeLead.leadNotes.map((note, index) => `
        <article class="lead-tab-note-item">
          <p>${escapeHtml(note.text || "")}</p>
          <div class="lead-tab-note-meta"><span>${escapeHtml(note.by || "Unknown")}</span><span>${escapeHtml(formatKolkataDateTime(note.at || "", ""))}</span></div>
          ${canEdit ? `<button type="button" class="btn-ghost lead-tab-note-delete" data-note-index="${index}">Delete</button>` : ""}
        </article>
      `).join("") : `<div class="lead-tab-empty-state"><p>No notes yet.</p></div>`}
    </div>
    ${canEdit ? `<div class="lead-tab-note-editor"><label for="leadTabNewNoteInput">Add Note</label><textarea id="leadTabNewNoteInput" rows="4" placeholder="Write a note for this lead"></textarea><div class="lead-tab-note-editor__actions"><button type="button" class="btn-primary" data-lead-tab-action="save-note">Save Note</button></div></div>` : ""}
  `;
}

function renderHistoryPanel() {
  const historyField = getStageConfig(activeStage)?.historyField || "mainAdmissionActivityHistory";
  const history = [...(Array.isArray(activeLead[historyField]) ? activeLead[historyField] : [])]
    .sort((a, b) => new Date(String(b?.at || b?.timestamp || b?.createdAt || 0)).getTime() - new Date(String(a?.at || a?.timestamp || a?.createdAt || 0)).getTime())
    .slice(0, 8);
  return `
    <div class="lead-tab-section-head">
      <div><h3>Activity History</h3><p class="block-help">Recent actions for this lead.</p></div>
      ${renderActionButton({ action: "history", icon: "history", label: "Open Full Activity History", variant: "ghost", text: "Full History" })}
    </div>
    <div class="lead-tab-history lead-tab-timeline">
      ${history.length ? renderEmbeddedTimeline(history) : `<div class="lead-tab-empty-state"><p>No activity history found yet.</p></div>`}
    </div>
  `;
}

function getActivityType(entry = {}) {
  return String(entry?.activityType || entry?.type || entry?.eventType || "Activity").trim() || "Activity";
}

function getActivityDescription(entry = {}) {
  return String(entry?.actionDescription || entry?.description || entry?.note || "Activity recorded").trim() || "Activity recorded";
}

function getTimelineIcon(type) {
  if (type.includes("Call")) return renderIcon("phone");
  if (type.includes("Note")) return renderIcon("notes");
  if (type.includes("Follow-Up")) return renderIcon("task");
  if (type.includes("WhatsApp") || type.includes("ReachOut")) return renderIcon("activity");
  if (type.includes("Assigned") || type.includes("Reassigned") || type.includes("Counselor")) return renderIcon("edit");
  return renderIcon("history");
}

function getTimelineTypeClass(type) {
  if (["Lead Converted", "Lead Closed", "Notes Deleted", "WhatsApp Failed"].includes(type)) return type.includes("Closed") || type.includes("Deleted") || type.includes("Failed") ? "timeline-type-danger" : "timeline-type-success";
  if (type.includes("Call") || type.includes("WhatsApp") || type.includes("ReachOut")) return "timeline-type-comm";
  if (type.includes("Follow-Up")) return "timeline-type-task";
  if (type.includes("Note")) return "timeline-type-note";
  if (type.includes("Created")) return "timeline-type-create";
  if (type.includes("Assigned") || type.includes("Counselor")) return "timeline-type-assign";
  return "timeline-type-default";
}

function renderEmbeddedTimeline(history) {
  return `
    <div class="timeline-track lead-tab-timeline-track">
      ${history.map((entry) => {
        const type = getActivityType(entry);
        const at = entry?.at || entry?.timestamp || entry?.createdAt || "";
        const by = String(entry?.by || entry?.performedBy || entry?.user || "").trim();
        const role = String(entry?.role || entry?.userRole || "").trim();
        const previousValue = String(entry?.previousValue || "").trim();
        const newValue = String(entry?.newValue || "").trim();
        return `
          <div class="timeline-item lead-tab-timeline-item">
            <div class="timeline-badge ${getTimelineTypeClass(type)}" title="${escapeHtml(type)}">${getTimelineIcon(type)}</div>
            <div class="timeline-card lead-tab-timeline-card">
              <div class="timeline-card-header">
                <span class="timeline-card-title">${escapeHtml(getActivityDescription(entry))}</span>
                <span class="lead-tab-activity-type">${escapeHtml(type)}</span>
              </div>
              <div class="timeline-metadata">
                ${by ? `<span>By: <strong>${escapeHtml(by)}</strong>${role ? ` (${escapeHtml(role)})` : ""}</span><span>&bull;</span>` : ""}
                <span>${escapeHtml(formatDateTime(at))}</span>
              </div>
              ${previousValue || newValue ? `
                <div class="timeline-diff-block">
                  ${previousValue ? `<div><span class="diff-label">Previous:</span> <span class="diff-val">${escapeHtml(previousValue)}</span></div>` : ""}
                  ${newValue ? `<div><span class="diff-label">New:</span> <span class="diff-val">${escapeHtml(newValue)}</span></div>` : ""}
                </div>
              ` : ""}
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderPanel() {
  if (activeTab === "notes" && !isAdmin) {
    panelEl.innerHTML = renderNotesPanel();
    return;
  }
  if (activeTab === "history") {
    panelEl.innerHTML = renderHistoryPanel();
    return;
  }
  panelEl.innerHTML = renderDetailsPanel();
}

function renderWorkspace() {
  const stageConfig = getStageConfig(activeStage);
  document.title = activeLead.name ? `${activeLead.name} | ${stageConfig?.label || "Lead Tab"}` : "Lead Tab";
  pageTitle.textContent = activeLead.name || "Lead Tab";
  pageSubtitle.textContent = `${stageConfig?.label || "Lead"} | ${activeLead.counselor || "Unassigned"} | ${getLeadProgramLabel(activeLead, "Lead")}`;
  renderSidebar();
  renderActions();
  renderTabs();
  renderPanel();
}

function collectDetailUpdates() {
  const fields = {};
  const extraFields = {};
  panelEl.querySelectorAll("[data-detail-scope][data-detail-field]").forEach((input) => {
    const scope = input.getAttribute("data-detail-scope");
    const field = input.getAttribute("data-detail-field");
    if (!scope || !field || input.disabled) return;
    const value = String(input.value || "").trim();
    if (scope === "lead") {
      fields[field] = field === "email" ? value.toLowerCase() : field === "courseName" ? normalizeCrmCourseValue(value) : value;
    } else {
      extraFields[field] = value;
    }
  });
  return { fields, extraFields };
}

async function handleSaveDetails(button) {
  if (!canEditLeadDetails()) return;
  const updates = collectDetailUpdates();
  const result = await runWithButtonBusy(button, "Saving...", () => updateMainAdmissionLeadDetails(activeLead.id, {
    leadEmail: activeLead.email || "",
    fields: updates.fields,
    extraFields: updates.extraFields
  }));
  if (!result || result.ok === false) {
    showToast(result?.message || "Failed to save lead details.", true);
    return;
  }
  activeLead = result.lead || activeLead;
  normalizeLeadFields([activeLead]);
  detailsEditMode = false;
  renderWorkspace();
  showToast("Lead details saved.");
}

async function openActivityModal() {
  if (!canUseCounselorActions(activeLead)) {
    showToast("Only the assigned counselor can update this lead.", true);
    return;
  }
  const stageConfig = getStageConfig(activeStage);
  activityForm.innerHTML = stageConfig.renderActivityForm(activeLead);
  stageConfig.populateActivityForm(activeLead);
  document.getElementById("leadTabCloseActivityModalBtn").onclick = closeActivityModal;
  activityModal.classList.remove("hidden");
}

function closeActivityModal() {
  activityModal.classList.add("hidden");
}

function openTaskModal() {
  if (!canUseCounselorActions(activeLead)) {
    showToast("Only the assigned counselor can create a task for this lead.", true);
    return;
  }
  document.getElementById("leadTabTaskLeadName").value = activeLead.name || "";
  document.getElementById("leadTabTaskLeadPhone").value = activeLead.phone || "";
  document.getElementById("leadTabTaskCounselor").value = activeLead.counselor || "";
  document.getElementById("leadTabTaskTitle").value = `Follow up with ${activeLead.name || "lead"}`;
  document.getElementById("leadTabTaskNotes").value = "";
  document.getElementById("leadTabTaskDueDate").value = "";
  taskMessage.textContent = "";
  taskModal.classList.remove("hidden");
}

function closeTaskModal() {
  taskModal.classList.add("hidden");
  taskMessage.textContent = "";
}

async function handleSaveNote(button) {
  if (!canUseCounselorActions(activeLead)) return;
  const text = String(document.getElementById("leadTabNewNoteInput")?.value || "").trim();
  if (!text) {
    showToast("Enter a note before saving.", true);
    return;
  }
  const result = await runWithButtonBusy(button, "Saving...", () => addLeadNote(activeLead.id, text, activeLead.email || ""));
  if (!result || result.ok === false) {
    showToast(result?.message || "Failed to save note.", true);
    return;
  }
  activeLead = result.lead || activeLead;
  normalizeLeadFields([activeLead]);
  renderWorkspace();
  showToast("Note saved.");
}

async function handleDeleteNote(index, button) {
  if (!canUseCounselorActions(activeLead)) return;
  const result = await runWithButtonBusy(button, "Deleting...", () => deleteLeadNote(activeLead.id, index, activeLead.email || ""));
  if (!result || result.ok === false) {
    showToast(result?.message || "Failed to delete note.", true);
    return;
  }
  activeLead = result.lead || activeLead;
  normalizeLeadFields([activeLead]);
  renderWorkspace();
  showToast("Note deleted.");
}

async function handleDeleteLead(button) {
  if (!isAdmin) return;
  const confirmed = window.confirm(`Delete ${activeLead.name || "this lead"} permanently? This cannot be undone.`);
  if (!confirmed) return;
  const result = await runWithButtonBusy(button, "Deleting...", () => deleteLeads([{
    id: String(activeLead.id || "").trim(),
    email: String(activeLead.email || "").trim().toLowerCase(),
    phone: String(activeLead.phone || "").trim(),
    workshop: String(activeLead.workshop || "").trim(),
    createdAt: String(activeLead.createdAt || "").trim()
  }]));
  if (!result || result.ok === false) {
    showToast(result?.message || "Failed to delete lead.", true);
    return;
  }
  showToast("Lead deleted.");
  window.setTimeout(() => {
    window.location.href = "dashboard.html";
  }, 400);
}

actionsEl.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-lead-tab-action]");
  if (!button || !activeLead) return;
  const action = button.getAttribute("data-lead-tab-action");
  if (action === "call") {
    await triggerMcubeClickToCall(activeLead, button, showToast);
    return;
  }
  if (action === "update") {
    await openActivityModal();
    return;
  }
  if (action === "task") {
    openTaskModal();
    return;
  }
  if (action === "notes") {
    activeTab = "notes";
    detailsEditMode = false;
    renderWorkspace();
    return;
  }
  if (action === "history") {
    openActivityHistory(activeLead.id, activeLead.name, activeLead.email || "");
    return;
  }
  if (action === "delete") {
    await handleDeleteLead(button);
  }
});

tabsEl.addEventListener("click", (event) => {
  const button = event.target.closest("[data-lead-tab-switch]");
  if (!button) return;
  activeTab = String(button.getAttribute("data-lead-tab-switch") || "details");
  detailsEditMode = false;
  renderWorkspace();
});

panelEl.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-lead-tab-action]");
  if (button) {
    const action = button.getAttribute("data-lead-tab-action");
    if (action === "edit-details") {
      detailsEditMode = true;
      renderWorkspace();
      return;
    }
    if (action === "cancel-details") {
      detailsEditMode = false;
      renderWorkspace();
      return;
    }
    if (action === "save-details") {
      await handleSaveDetails(button);
      return;
    }
    if (action === "save-note") {
      await handleSaveNote(button);
      return;
    }
    if (action === "history") {
      openActivityHistory(activeLead.id, activeLead.name, activeLead.email || "");
      return;
    }
  }
  const deleteButton = event.target.closest("[data-note-index]");
  if (deleteButton) {
    await handleDeleteNote(Number(deleteButton.getAttribute("data-note-index")), deleteButton);
  }
});

activityForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!activeLead || !canUseCounselorActions(activeLead)) return;
  const stageConfig = getStageConfig(activeStage);
  const submitButton = event.submitter;
  const updates = stageConfig.collectUpdates();
  const result = await runWithButtonBusy(submitButton, "Saving...", () => updateLeadActivity(activeLead.id, {
    stage: stageConfig.updateStage,
    leadEmail: activeLead.email || "",
    updates,
    allowWithoutWorkshopActivity: stageConfig.updateStage === "admission"
  }));
  if (!result || result.ok === false) {
    showToast(result?.message || "Failed to save activity.", true);
    return;
  }
  let latestLead = result.lead || activeLead;
  const noteText = String(document.getElementById("leadTabActivityNote")?.value || "").trim();
  if (noteText) {
    const noteResult = await addLeadNote(activeLead.id, noteText, activeLead.email || "");
    if (!noteResult || noteResult.ok === false) {
      showToast(noteResult?.message || "Activity saved, but note could not be saved.", true);
      return;
    }
    latestLead = noteResult.lead || latestLead;
  }
  activeLead = latestLead;
  normalizeLeadFields([activeLead]);
  closeActivityModal();
  renderWorkspace();
  showToast("Lead activity saved.");
});

taskForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!activeLead || !canUseCounselorActions(activeLead)) {
    taskMessage.textContent = "Only the assigned counselor can create a task.";
    taskMessage.style.color = "var(--danger)";
    return;
  }
  const title = String(document.getElementById("leadTabTaskTitle").value || "").trim();
  const dueDate = String(document.getElementById("leadTabTaskDueDate").value || "").trim();
  if (!title || !dueDate) {
    taskMessage.textContent = "Task title and due date are required.";
    taskMessage.style.color = "var(--danger)";
    return;
  }
  const submitButton = event.submitter;
  const result = await runWithButtonBusy(submitButton, "Creating...", () => createTask({
    leadId: activeLead.id,
    leadName: activeLead.name || "",
    leadPhone: activeLead.phone || "",
    leadCounselor: activeLead.counselor || "Unassigned",
    counselor: activeLead.counselor || session?.name || "Unassigned",
    category: getStageConfig(activeStage)?.taskCategory || TASK_CATEGORY.workshop,
    title,
    notes: String(document.getElementById("leadTabTaskNotes").value || "").trim(),
    dueDate: toTaskDueDateIso(dueDate)
  }));
  if (!result || result.ok === false) {
    taskMessage.textContent = result?.message || "Failed to create task.";
    taskMessage.style.color = "var(--danger)";
    return;
  }
  taskMessage.textContent = "Task created successfully.";
  taskMessage.style.color = "var(--success)";
  showToast("Task created.");
  window.setTimeout(closeTaskModal, 500);
});

document.getElementById("leadTabCloseTaskModalBtn").addEventListener("click", closeTaskModal);

registerPageCleanup(() => {
  closeActivityModal();
  closeTaskModal();
});

const cachedLeadPayload = readLeadTabCache();
if (cachedLeadPayload?.lead) {
  counselors = Array.isArray(cachedLeadPayload.counselors) ? cachedLeadPayload.counselors : [];
  applyLeadPayload(cachedLeadPayload);
  renderWorkspace();
}

try {
  const payload = await fetchLeadTabPayload();
  if (!applyLeadPayload(payload)) {
    renderNotFound("This lead was not found.");
  } else {
    renderWorkspace();
    void trackLeadView(activeLead.id, activeLead.email || "");
  }
} catch (error) {
  if (activeLead) {
    setMessage("Showing cached lead data. Live refresh failed.", true);
  } else {
    renderNotFound(error?.message || "This lead was not found.");
  }
}
