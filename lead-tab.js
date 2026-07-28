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

function formatDateTime(value) {
  const raw = String(value || "").trim();
  if (!raw) return "-";
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
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
  const query = requestedLeadEmail ? `?leadEmail=${encodeURIComponent(requestedLeadEmail)}` : "";
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
  activeStage = stage || requestedStage || inferStage(lead);
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
        { label: "Lead Created Date", value: lead.createdAt },
        { label: "Lead Source", value: getLeadSource(lead) },
        { label: "Stage", value: getStageConfig(activeStage)?.label || activeStage }
      ]
    },
    {
      title: "Lead Details",
      editable: activeStage === "main-admission",
      items: [
        { label: "Name", value: lead.name, scope: "lead", field: "name" },
        { label: "Phone Number", value: lead.phone, scope: "lead", field: "phone" },
        { label: "WhatsApp Phone Number", value: whatsappPhone, scope: "extra", field: "whatsapp_phone_number" },
        { label: "Email", value: lead.email, scope: "lead", field: "email" },
        { label: "Course Name", value: lead.courseName, scope: "lead", field: "courseName" },
        { label: "Location", value: getLeadLocation(lead) },
        { label: "Counselor", value: lead.counselor || "Unassigned" },
        { label: "Workshop", value: lead.admissionWorkshop || lead.workshop || "-" },
        { label: "City", value: city, scope: "extra", field: "city" },
        { label: "State", value: state, scope: "extra", field: "state" }
      ]
    },
    extraFieldEntries.length ? {
      title: "Lead Qualification Details",
      editable: activeStage === "main-admission",
      items: extraFieldEntries.map(([key, value]) => ({ label: formatFieldLabel(key), value, scope: "extra", field: key }))
    } : null
  ].filter(Boolean);
}

function renderEditableDetailValue(lead, item) {
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
        <p>${escapeHtml(activeLead.courseName || activeLead.workshop || "Lead workspace")}</p>
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
    buttons.push(`<button type="button" class="btn-primary" data-lead-tab-action="call"${activeLead.phone ? "" : " disabled"}>Call Lead</button>`);
    buttons.push(`<button type="button" class="btn-update-status" data-lead-tab-action="update">Update Activity</button>`);
    buttons.push(`<button type="button" class="btn-ghost btn-task" data-lead-tab-action="task">Create Task</button>`);
  }
  buttons.push(`<button type="button" class="btn-ghost" data-lead-tab-action="history">Open Full Activity History</button>`);
  if (isAdmin) {
    buttons.push(`<button type="button" class="btn-ghost btn-delete" data-lead-tab-action="delete">Delete Lead</button>`);
  }
  actionsEl.innerHTML = `
    <div class="lead-tab-action-row">${buttons.join("")}</div>
    ${!isAdmin && !canUseCounselorActions(activeLead) ? `<p class="block-help">You can review this lead, but only the assigned counselor can call or update it.</p>` : ""}
  `;
}

function getTabs() {
  return isAdmin
    ? [{ key: "details", label: "Lead Details" }, { key: "history", label: "Activity History" }]
    : [{ key: "details", label: "Lead Details" }, { key: "notes", label: "Notes" }, { key: "history", label: "Activity History" }];
}

function renderTabs() {
  const tabs = getTabs();
  if (!tabs.some((tab) => tab.key === activeTab)) {
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
      ${canEdit ? `<div class="main-admission-details-modal__actions">${detailsEditMode ? `<button type="button" class="btn-primary" data-lead-tab-action="save-details">Save</button><button type="button" class="btn-ghost" data-lead-tab-action="cancel-details">Cancel</button>` : `<button type="button" class="btn-ghost" data-lead-tab-action="edit-details">Edit</button>`}</div>` : ""}
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
          <div class="lead-tab-note-meta"><span>${escapeHtml(note.by || "Unknown")}</span><span>${escapeHtml(note.at || "")}</span></div>
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
      <button type="button" class="btn-ghost" data-lead-tab-action="history">Open Full Activity History</button>
    </div>
    <div class="lead-tab-history">
      ${history.length ? history.map((entry) => `
        <article class="lead-tab-history-item">
          <div class="lead-tab-history-item__head"><strong>${escapeHtml(entry?.activityType || entry?.type || entry?.eventType || "Activity")}</strong><span>${escapeHtml(formatDateTime(entry?.at || entry?.timestamp || entry?.createdAt || ""))}</span></div>
          <p>${escapeHtml(entry?.actionDescription || entry?.description || entry?.note || "Activity recorded")}</p>
        </article>
      `).join("") : `<div class="lead-tab-empty-state"><p>No activity history found yet.</p></div>`}
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
  pageSubtitle.textContent = `${stageConfig?.label || "Lead"} | ${activeLead.counselor || "Unassigned"} | ${activeLead.courseName || activeLead.workshop || "Lead"}`;
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
