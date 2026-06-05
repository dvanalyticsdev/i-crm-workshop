import { registerPageCleanup } from "./page-runtime.js";
import {
  bootstrapLocalState,
  getCounselors as getStoredCounselors,
  getLeads as getStoredLeads,
  getSession,
  loadPersistedValue,
  saveLeads as persistLeads,
  savePersistedValue,
  startStatePolling
} from "./state-sync.js";
import { createTask, TASK_CATEGORY } from "./task-service.js";
import {
  addLeadNote,
  assignLeads as assignLeadsOnServer,
  deleteLeadNote,
  updateLeadActivity as updateLeadActivityOnServer
} from "./lead-service.js";

await bootstrapLocalState();

const postKpiSection = document.getElementById("postKpiSection");
const postFilterBar = document.getElementById("postFilterBar");
const postActivityMessage = document.getElementById("postActivityMessage");
const postLeadTableSection = document.getElementById("postLeadTableSection");
const taskModal = document.getElementById("taskModal");
const taskModalTitle = document.getElementById("taskModalTitle");
const taskForm = document.getElementById("taskForm");
const taskLeadIdInput = document.getElementById("taskLeadId");
const taskCategoryInput = document.getElementById("taskCategory");
const taskLeadNameInput = document.getElementById("taskLeadName");
const taskCounselorInput = document.getElementById("taskCounselor");
const taskTitleInput = document.getElementById("taskTitle");
const taskNotesInput = document.getElementById("taskNotes");
const taskDueDateInput = document.getElementById("taskDueDate");
const taskMessage = document.getElementById("taskMessage");

const session = getSession();
const isAdmin = session?.role === "admin";
const canCreateTasks = session?.role === "counselor";

const EMPTY_FILTER_VALUE = "__EMPTY_FILTER__";
const EMPTY_FILTER_LABEL = "Use Filter";
const SELECT_ALL_FILTER_VALUE = "__SELECT_ALL__";

function getSelectedFilterValues(value) {
  const rawValues = Array.isArray(value) ? value : [value];
  return rawValues
    .map((item) => String(item || "").trim())
    .filter((item) => item && item !== EMPTY_FILTER_VALUE && item !== SELECT_ALL_FILTER_VALUE && item !== "All");
}

function isSelectedFilterValue(value) {
  return getSelectedFilterValues(value).length > 0;
}

function filterIncludesValue(filterValue, value) {
  const selected = getSelectedFilterValues(filterValue);
  return !selected.length || selected.includes(String(value || "").trim());
}

function getFilterSummary(value) {
  const selected = getSelectedFilterValues(value);
  if (!selected.length) return EMPTY_FILTER_LABEL;
  if (selected.length <= 2) return selected.join(", ");
  return `${selected.length} selected`;
}

function withSelectFilterOption(options) {
  const normalizedOptions = Array.isArray(options)
    ? options.map((option) => String(option || "").trim()).filter(Boolean)
    : [];
  return [...new Set(["Select", ...normalizedOptions])];
}

function renderMultiSelectControl({ id, label, options, value, itemClass = "", itemAttrs = "" }) {
  const uniqueOptions = [...new Set(options.map((option) => String(option || "").trim()).filter(Boolean))];
  const selected = new Set(getSelectedFilterValues(value));
  const selectedCount = selected.size;
  const allSelected = uniqueOptions.length > 0 && uniqueOptions.every((option) => selected.has(option));
  const optionHtml = uniqueOptions.length
    ? uniqueOptions.map((option) => {
        const escapedOption = escapeHtml(option);
        const checked = selected.has(String(option)) ? " checked" : "";
        const selectedClass = checked ? " multi-filter-option--selected" : "";
        return `
          <label class="multi-filter-option${selectedClass}">
            <input type="checkbox" value="${escapedOption}"${checked} />
            <span>${escapedOption}</span>
          </label>
        `;
      }).join("")
    : `<div class="multi-filter-empty">No options</div>`;
  const selectAllClass = allSelected ? " multi-filter-option--selected" : "";

  return `
    <div class="filter-item${itemClass}" ${itemAttrs}>
      <label for="${id}Button">${label}</label>
      <div class="multi-filter" data-filter-id="${id}">
        <button id="${id}Button" class="multi-filter-trigger" type="button" aria-expanded="false">
          <span class="multi-filter-trigger__text">${escapeHtml(getFilterSummary(value))}</span>
          <span class="multi-filter-caret" aria-hidden="true">&#9662;</span>
        </button>
        <div class="multi-filter-menu hidden">
          <label class="multi-filter-option multi-filter-select-all${selectAllClass}">
            <input type="checkbox" value="${SELECT_ALL_FILTER_VALUE}" ${allSelected ? "checked" : ""} />
            <span>Select All</span>
          </label>
          ${optionHtml}
          <div class="multi-filter-meta">
            <span class="selected-count">Selected: ${selectedCount}</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

function bindMultiFilter(filterId, filterKey) {
  const root = document.querySelector(`[data-filter-id="${filterId}"]`);
  if (!root) return;
  const button = root.querySelector(".multi-filter-trigger");
  const menu = root.querySelector(".multi-filter-menu");
  if (!button || !menu) return;

  button.onclick = (event) => {
    event.stopPropagation();
    document.querySelectorAll(".multi-filter-menu").forEach((item) => {
      if (item !== menu) item.classList.add("hidden");
    });
    document.querySelectorAll(".multi-filter").forEach((item) => {
      if (item !== root) item.classList.remove("multi-filter--open");
    });
    menu.classList.toggle("hidden");
    root.classList.toggle("multi-filter--open", !menu.classList.contains("hidden"));
    button.setAttribute("aria-expanded", String(!menu.classList.contains("hidden")));
  };

  menu.onclick = (event) => {
    event.stopPropagation();
  };

  menu.querySelectorAll("input[type='checkbox']").forEach((checkbox) => {
    checkbox.onchange = () => {
      const optionValues = Array.from(menu.querySelectorAll("input[type='checkbox']"))
        .map((input) => input.value)
        .filter((inputValue) => inputValue !== SELECT_ALL_FILTER_VALUE);

      if (checkbox.value === SELECT_ALL_FILTER_VALUE) {
        filter[filterKey] = checkbox.checked ? optionValues : EMPTY_FILTER_VALUE;
        persistFilterState();
        renderAll();
        return;
      }

      const values = Array.from(menu.querySelectorAll("input[type='checkbox']:checked"))
        .filter((input) => input.value !== SELECT_ALL_FILTER_VALUE)
        .map((input) => input.value);
      filter[filterKey] = values.length ? values : EMPTY_FILTER_VALUE;
      persistFilterState();
      renderAll();
    };
  });
}

function bindMultiFilterOutsideClick() {
  if (window.__dvMultiFilterCloseBound) return;
  window.__dvMultiFilterCloseBound = true;
  document.addEventListener("click", () => {
    document.querySelectorAll(".multi-filter-menu").forEach((menu) => menu.classList.add("hidden"));
    document.querySelectorAll(".multi-filter").forEach((root) => root.classList.remove("multi-filter--open"));
    document.querySelectorAll(".multi-filter-trigger").forEach((button) => {
      button.setAttribute("aria-expanded", "false");
    });
  });
}

const DEFAULT_FILTER = {
  timeline: isCounselorSession() ? "overall" : "week",
  startDate: "",
  endDate: "",
  search: "",
  workshop: EMPTY_FILTER_VALUE,
  counselor: EMPTY_FILTER_VALUE,
  activityStatus: EMPTY_FILTER_VALUE,
  postDialed: EMPTY_FILTER_VALUE,
  coursePitched: EMPTY_FILTER_VALUE,
  admissionStatus: EMPTY_FILTER_VALUE,
  courseStatus: EMPTY_FILTER_VALUE,
  postCallStatus: EMPTY_FILTER_VALUE,
  workshopJoiningStatus: EMPTY_FILTER_VALUE,
  workshopCallingDialed: EMPTY_FILTER_VALUE,
  workshopCallingCallStatus: EMPTY_FILTER_VALUE,
  workshopCallingWsStatus: EMPTY_FILTER_VALUE,
  workshopCallingWhatsappInvite: EMPTY_FILTER_VALUE,
  workshopCallingWhatsappGroupStatus: EMPTY_FILTER_VALUE
};

const FILTER_STORAGE_KEY = "dvWorkshopAdmissionCallingFilters";
const persistedFilter = await loadPersistedValue(FILTER_STORAGE_KEY, {});

if (persistedFilter.workshopCalling && !persistedFilter.workshopCallingWsStatus) {
  persistedFilter.workshopCallingWsStatus = persistedFilter.workshopCalling;
}

if (persistedFilter.timeline === "daily") {
  persistedFilter.timeline = "today";
}

Object.keys(DEFAULT_FILTER).forEach((key) => {
  if (persistedFilter[key] === "All" || persistedFilter[key] === "Select" || persistedFilter[key] === EMPTY_FILTER_LABEL) {
    persistedFilter[key] = EMPTY_FILTER_VALUE;
  }
});

let filter = {
  ...DEFAULT_FILTER,
  ...persistedFilter
};

if (isCounselorSession() && (!persistedFilter.timeline || persistedFilter.timeline === "week")) {
  filter.timeline = "overall";
}

let modalLeadId = null;
let modalLeadEmail = "";
let modalMode = "edit";
let selectedLeadKeys = new Set();

const activityFields = ["modalPostDialed", "modalCoursePitched", "modalCourseStatus", "modalAdmissionStatus", "modalPostCallStatus", "modalWorkshopJoiningStatus"];

function setMessage(text, isError = true) {
  if (!postActivityMessage) {
    return;
  }

  postActivityMessage.textContent = text;
  postActivityMessage.style.color = isError ? "var(--danger)" : "var(--success)";
}

function persistFilterState() {
  void savePersistedValue(FILTER_STORAGE_KEY, filter);
}

function parseDateKey(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatReadableDate(date) {
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function getTimelineRange(leads) {
  const now = new Date();

  if (filter.timeline === "overall") {
    return null;
  }

  if (filter.timeline === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    return {
      start,
      end,
      label: `Today: ${formatReadableDate(start)}`
    };
  }

  if (filter.timeline === "yesterday") {
    const day = new Date(now);
    day.setDate(day.getDate() - 1);
    const start = new Date(day);
    start.setHours(0, 0, 0, 0);
    const end = new Date(day);
    end.setHours(23, 59, 59, 999);
    return {
      start,
      end,
      label: `Yesterday: ${formatReadableDate(start)}`
    };
  }

  if (filter.timeline === "week") {
    const start = new Date(now);
    start.setDate(start.getDate() - 6);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    return {
      start,
      end,
      label: `Weekly: ${formatReadableDate(start)} - ${formatReadableDate(end)}`
    };
  }

  const customStart = filter.startDate ? parseDateKey(filter.startDate) : null;
  const customEnd = filter.endDate ? parseDateKey(filter.endDate) : null;

  if (!customStart || !customEnd || customStart > customEnd) {
    return { start: null, end: null, label: "Custom: Select a valid date range" };
  }

  return {
    start: customStart,
    end: customEnd,
    label: `Custom: ${formatReadableDate(customStart)} - ${formatReadableDate(customEnd)}`
  };
}

function filterLeadsByTimeline(leads, range) {
  if (!range) {
    return leads;
  }

  if (!range.start || !range.end) {
    return leads;
  }

  const startTime = range.start.getTime();
  const endTime = range.end.getTime();

  return leads.filter((lead) => {
    const leadDate = parseDateKey(String(lead.createdAt || "").trim());
    if (Number.isNaN(leadDate.getTime())) {
      return false;
    }

    const leadTime = leadDate.getTime();
    return leadTime >= startTime && leadTime <= endTime;
  });
}

function isCounselorSession() {
  return session?.role === "counselor";
}

function getCounselorIdentity() {
  if (!isCounselorSession()) {
    return "";
  }

  const sessionName = String(session?.name || "").trim().toLowerCase();
  const sessionEmail = String(session?.email || "").trim().toLowerCase();
  const counselors = getStoredCounselors();
  const match = counselors.find(
    (item) => String(item.email || "").trim().toLowerCase() === sessionEmail
  );

  return String(match?.name || session?.name || "").trim().toLowerCase() || sessionName;
}

function getScopedLeads(allLeads) {
  if (!isCounselorSession()) {
    return allLeads;
  }

  const counselorName = getCounselorIdentity();
  if (!counselorName) {
    return [];
  }

  return allLeads.filter(
    (lead) => String(lead.counselor || "").trim().toLowerCase() === counselorName
  );
}

function getLeadActivityUpdateCount(lead) {
  return Array.isArray(lead?.admissionActivityHistory)
    ? lead.admissionActivityHistory.length
    : Number(lead?.postActivityUpdates) || 0;
}

function isUntouchedLead(lead) {
  return getLeadActivityUpdateCount(lead) === 0;
}

function normalizeLeadFields(leads) {
  leads.forEach((lead) => {
    lead.dialed = lead.dialed || "";
    lead.callStatus = lead.callStatus || "";
    lead.wsStatus = lead.wsStatus || "";
    lead.whatsappInvite = lead.whatsappInvite || "";

    lead.postDialed = lead.postDialed || "";
    lead.coursePitched = lead.coursePitched || "";
    lead.courseStatus = lead.courseStatus || "";
    lead.admissionStatus = lead.admissionStatus || "";
    lead.postCallStatus = lead.postCallStatus || "";
    lead.workshopJoiningStatus = lead.workshopJoiningStatus || "";
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

function getAllLeads() {
  const leads = getStoredLeads();
  normalizeLeadFields(leads);
  return leads;
}

function saveAllLeads(leads) {
  return persistLeads(leads);
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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function isLostLead(lead) {
  return lead.postStatusUpdated && lead.courseStatus === "Not Interested";
}

function getAdmissionCallingLeads(allLeads) {
  return allLeads.filter((lead) => !isLostLead(lead));
}

function getUniqueValues(leads, key) {
  return [
    ...new Set(
      leads
        .map((lead) => lead[key])
        .filter((value) => typeof value === "string" && value.trim() !== "")
    )
  ];
}

function renderKpis(leads) {
  const interested = leads.filter((lead) => lead.courseStatus === "Interested").length;
  const enrolled = leads.filter((lead) => lead.admissionStatus === "Enrolled").length;
  const won = leads.filter((lead) => lead.admissionStatus === "Won").length;

  postKpiSection.innerHTML = `
    <article class="card kpi-card">
      <p>Overall Leads</p>
      <h2>${leads.length}</h2>
    </article>
    <article class="card kpi-card">
      <p>Interested</p>
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
  const workshops = getUniqueValues(leads, "workshop");
  const counselorOptions = [...new Set(
    leads
      .map((lead) => String(lead.counselor || "").trim())
      .filter((name) => name && name.toLowerCase() !== "unassigned")
  )];
  const workshopCallingDialedOptions = getUniqueValues(leads, "dialed");
  const workshopCallingCallStatusOptions = getUniqueValues(leads, "callStatus");
  const workshopCallingWsStatusOptions = getUniqueValues(leads, "wsStatus");
  const workshopCallingWhatsappInviteOptions = getUniqueValues(leads, "whatsappInvite");
  const postDialedOptions = getUniqueValues(leads, "postDialed");
  const coursePitchedOptions = getUniqueValues(leads, "coursePitched");
  const admissionOptions = getUniqueValues(leads, "admissionStatus");

  postFilterBar.innerHTML = `
    <div class="filter-section">
      <div class="filter-section-title">Timeline</div>
      <div class="filter-row">
        <div class="filter-item">
          <label for="postTimelineSelect">Timeline</label>
          <select id="postTimelineSelect">
            <option value="overall">Overall</option>
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="week">Week</option>
            <option value="custom">Custom Range</option>
          </select>
        </div>
        <div class="filter-item hidden" id="postStartDateWrap">
          <label for="postStartDateInput">Start Date</label>
          <input id="postStartDateInput" type="date" />
        </div>
        <div class="filter-item hidden" id="postEndDateWrap">
          <label for="postEndDateInput">End Date</label>
          <input id="postEndDateInput" type="date" />
        </div>
        <div class="filter-item filter-item-cta">
          <label>&nbsp;</label>
          <div class="filter-actions">
            <button id="postResetTimeline" class="btn-ghost" type="button">Reset Timeline</button>
          </div>
        </div>
      </div>
    </div>

    <div class="filter-section">
      <div class="filter-section-title">Workshop Calling</div>
      <div class="filter-row">
        ${renderMultiSelectControl({
          id: "postWorkshopCallingDialedSelect",
          label: "Dialed",
          options: withSelectFilterOption(workshopCallingDialedOptions),
          value: filter.workshopCallingDialed
        })}
        ${renderMultiSelectControl({
          id: "postWorkshopCallingCallStatusSelect",
          label: "Call Status",
          options: withSelectFilterOption(workshopCallingCallStatusOptions),
          value: filter.workshopCallingCallStatus
        })}
        ${renderMultiSelectControl({
          id: "postWorkshopCallingWsStatusSelect",
          label: "Workshop Status",
          options: withSelectFilterOption(workshopCallingWsStatusOptions),
          value: filter.workshopCallingWsStatus
        })}
        ${renderMultiSelectControl({
          id: "postWorkshopCallingWhatsappInviteSelect",
          label: "WhatsApp Invite",
          options: withSelectFilterOption(workshopCallingWhatsappInviteOptions),
          value: filter.workshopCallingWhatsappInvite
        })}
        ${renderMultiSelectControl({
          id: "postWorkshopCallingWhatsappGroupStatusSelect",
          label: "WhatsApp Group Status",
          options: withSelectFilterOption(["Joined", "Not Joined"]),
          value: filter.workshopCallingWhatsappGroupStatus
        })}
      </div>
    </div>

    <div class="filter-section">
      <div class="filter-section-title">Admission Calling</div>
      <div class="filter-row">
        <div class="filter-item">
          <label for="postSearchLeadInput">Search Lead</label>
          <input id="postSearchLeadInput" type="text" placeholder="Name, email, phone, workshop, counselor" />
        </div>
        ${renderMultiSelectControl({
          id: "postCounselorSelect",
          label: "Counselor",
          options: counselorOptions,
          value: filter.counselor,
          itemClass: isAdmin ? "" : " hidden",
          itemAttrs: 'data-admin-only="true"'
        })}
        ${renderMultiSelectControl({
          id: "postActivityStatusSelect",
          label: "Untouched Leads",
          options: ["Untouched", "Updated"],
          value: filter.activityStatus
        })}
        ${renderMultiSelectControl({
          id: "postWorkshopSelect",
          label: "Workshop Name",
          options: workshops,
          value: filter.workshop
        })}
        ${renderMultiSelectControl({
          id: "postDialedSelect",
          label: "Dialed",
          options: withSelectFilterOption(postDialedOptions),
          value: filter.postDialed
        })}
        ${renderMultiSelectControl({
          id: "postCoursePitchedSelect",
          label: "Course Pitched",
          options: withSelectFilterOption(coursePitchedOptions),
          value: filter.coursePitched
        })}
        ${renderMultiSelectControl({
          id: "postCourseStatusSelect",
          label: "Course Status",
          options: withSelectFilterOption(["Interested", "Not Interested"]),
          value: filter.courseStatus
        })}
        ${renderMultiSelectControl({
          id: "postAdmissionStatusSelect",
          label: "Admission",
          options: withSelectFilterOption(admissionOptions),
          value: filter.admissionStatus
        })}
        ${renderMultiSelectControl({
          id: "postCallStatusSelect",
          label: "Call Status",
          options: withSelectFilterOption(["Connected", "CBL", "DNP", "CNC"]),
          value: filter.postCallStatus
        })}
        ${renderMultiSelectControl({
          id: "postWorkshopJoiningStatusSelect",
          label: "Workshop Joining Status",
          options: withSelectFilterOption(["Joined", "Not Joined"]),
          value: filter.workshopJoiningStatus
        })}
        <div class="filter-item filter-item-cta">
          <label>&nbsp;</label>
          <div class="filter-actions">
            <button id="postResetFilters" class="btn-ghost" type="button">Reset</button>
          </div>
        </div>
      </div>
    </div>
  `;

  bindMultiFilterOutsideClick();
  bindMultiFilter("postWorkshopCallingDialedSelect", "workshopCallingDialed");
  bindMultiFilter("postWorkshopCallingCallStatusSelect", "workshopCallingCallStatus");
  bindMultiFilter("postWorkshopCallingWsStatusSelect", "workshopCallingWsStatus");
  bindMultiFilter("postWorkshopCallingWhatsappInviteSelect", "workshopCallingWhatsappInvite");
  bindMultiFilter("postWorkshopCallingWhatsappGroupStatusSelect", "workshopCallingWhatsappGroupStatus");
  document.getElementById("postTimelineSelect").value = filter.timeline;
  document.getElementById("postStartDateInput").value = filter.startDate;
  document.getElementById("postEndDateInput").value = filter.endDate;
  document.getElementById("postStartDateWrap").classList.toggle("hidden", filter.timeline !== "custom");
  document.getElementById("postEndDateWrap").classList.toggle("hidden", filter.timeline !== "custom");
  document.getElementById("postSearchLeadInput").value = filter.search;
  bindMultiFilter("postCounselorSelect", "counselor");
  bindMultiFilter("postActivityStatusSelect", "activityStatus");
  bindMultiFilter("postWorkshopSelect", "workshop");
  bindMultiFilter("postDialedSelect", "postDialed");
  bindMultiFilter("postCoursePitchedSelect", "coursePitched");
  bindMultiFilter("postCourseStatusSelect", "courseStatus");
  bindMultiFilter("postAdmissionStatusSelect", "admissionStatus");
  bindMultiFilter("postCallStatusSelect", "postCallStatus");
  bindMultiFilter("postWorkshopJoiningStatusSelect", "workshopJoiningStatus");

  document.getElementById("postTimelineSelect").onchange = (event) => {
    filter.timeline = event.target.value;
    persistFilterState();
    document.getElementById("postStartDateWrap").classList.toggle("hidden", filter.timeline !== "custom");
    document.getElementById("postEndDateWrap").classList.toggle("hidden", filter.timeline !== "custom");
    renderAll();
  };

  document.getElementById("postStartDateInput").onchange = (event) => {
    filter.startDate = event.target.value;
    persistFilterState();
    renderAll();
  };

  document.getElementById("postEndDateInput").onchange = (event) => {
    filter.endDate = event.target.value;
    persistFilterState();
    renderAll();
  };

  document.getElementById("postResetTimeline").onclick = () => {
    filter.timeline = DEFAULT_FILTER.timeline;
    filter.startDate = DEFAULT_FILTER.startDate;
    filter.endDate = DEFAULT_FILTER.endDate;
    persistFilterState();
    renderAll();
  };

  document.getElementById("postSearchLeadInput").oninput = (event) => {
    filter.search = event.target.value.trim();
    persistFilterState();
    renderAll();
  };

  document.getElementById("postResetFilters").onclick = () => {
    filter = { ...DEFAULT_FILTER };
    persistFilterState();
    renderAll();
  };
}

function filterLeads(leads) {
  let filtered = filterLeadsByTimeline(leads, getTimelineRange(leads));

  if (filter.search) {
    const query = filter.search.toLowerCase();
    filtered = filtered.filter((lead) => {
      const haystack = [
        lead.name,
        lead.email,
        lead.phone,
        lead.workshop,
        lead.counselor
      ]
        .map((value) => String(value || "").toLowerCase())
        .join(" ");

      return haystack.includes(query);
    });
  }

  if (isSelectedFilterValue(filter.workshop)) {
    filtered = filtered.filter((lead) => filterIncludesValue(filter.workshop, lead.workshop));
  }

  if (isSelectedFilterValue(filter.counselor)) {
    filtered = filtered.filter((lead) => filterIncludesValue(filter.counselor, lead.counselor));
  }

  const activityStatuses = getSelectedFilterValues(filter.activityStatus);
  if (activityStatuses.length === 1 && activityStatuses.includes("Untouched")) {
    filtered = filtered.filter((lead) => isUntouchedLead(lead));
  }

  if (activityStatuses.length === 1 && activityStatuses.includes("Updated")) {
    filtered = filtered.filter((lead) => !isUntouchedLead(lead));
  }

  if (isSelectedFilterValue(filter.workshopCallingDialed)) {
    filtered = filtered.filter((lead) => filterIncludesValue(filter.workshopCallingDialed, lead.dialed));
  }

  if (isSelectedFilterValue(filter.workshopCallingCallStatus)) {
    filtered = filtered.filter((lead) => filterIncludesValue(filter.workshopCallingCallStatus, lead.callStatus));
  }

  if (isSelectedFilterValue(filter.workshopCallingWsStatus)) {
    filtered = filtered.filter((lead) => filterIncludesValue(filter.workshopCallingWsStatus, lead.wsStatus));
  }

  if (isSelectedFilterValue(filter.workshopCallingWhatsappInvite)) {
    filtered = filtered.filter((lead) => filterIncludesValue(filter.workshopCallingWhatsappInvite, lead.whatsappInvite));
  }

  if (isSelectedFilterValue(filter.workshopCallingWhatsappGroupStatus)) {
    filtered = filtered.filter((lead) => filterIncludesValue(filter.workshopCallingWhatsappGroupStatus, lead.whatsappGroupStatus));
  }

  if (isSelectedFilterValue(filter.postDialed)) {
    filtered = filtered.filter((lead) => filterIncludesValue(filter.postDialed, lead.postDialed));
  }

  if (isSelectedFilterValue(filter.coursePitched)) {
    filtered = filtered.filter((lead) => filterIncludesValue(filter.coursePitched, lead.coursePitched));
  }

  if (isSelectedFilterValue(filter.courseStatus)) {
    filtered = filtered.filter((lead) => filterIncludesValue(filter.courseStatus, lead.courseStatus));
  }

  if (isSelectedFilterValue(filter.admissionStatus)) {
    filtered = filtered.filter((lead) => filterIncludesValue(filter.admissionStatus, lead.admissionStatus));
  }

  if (isSelectedFilterValue(filter.postCallStatus)) {
    filtered = filtered.filter((lead) => filterIncludesValue(filter.postCallStatus, lead.postCallStatus));
  }

  if (isSelectedFilterValue(filter.workshopJoiningStatus)) {
    filtered = filtered.filter((lead) => filterIncludesValue(filter.workshopJoiningStatus, lead.workshopJoiningStatus));
  }

  return filtered;
}

function renderActivityPanel(lead) {
  const hasActivity = Array.isArray(lead.admissionActivityHistory) && lead.admissionActivityHistory.length > 0;
  const noteCount = Array.isArray(lead.leadNotes) ? lead.leadNotes.length : 0;
  const leadId = escapeHtml(lead.id);
  const leadEmail = escapeHtml(lead.email || "");
  const leadAttrs = `data-lead-id="${leadId}" data-lead-email="${leadEmail}"`;
  return `
    <div class="activity-panel">
      <button class="btn-view-activity" type="button" data-lead-id="${leadId}" aria-label="View activity details" title="View activity details">👁</button>
      <button class="btn-update-status${hasActivity ? " btn-update-status--active" : ""}" type="button" ${leadAttrs}>Update</button>
      <button class="btn-ghost btn-notes" type="button" ${leadAttrs}>Notes${noteCount ? ` (${noteCount})` : ""}</button>
      ${canCreateTasks ? `<button class="btn-ghost btn-task" type="button" ${leadAttrs}>Task</button>` : ""}
      ${isAdmin ? `<button class="btn-delete" type="button" ${leadAttrs}>Delete</button>` : ""}
    </div>
  `;
}

function renderLeadTable(leads) {
  syncSelectedLeadIds(leads);
  const selectedCount = isAdmin ? getSelectedLeadCount(leads) : 0;
  const allSelected = isAdmin && leads.length > 0 && selectedCount === leads.length;
  const assignableCounselors = isAdmin ? getAdminAssignmentOptions(leads) : [];
  const bulkToolbar = isAdmin
    ? `
      <div class="bulk-toolbar">
        <label class="bulk-select-control">
          <input id="postBulkSelect" type="checkbox" ${allSelected ? "checked" : ""} />
          <span>Select All</span>
        </label>
        <div class="bulk-select-actions">
          <span class="selected-count">Selected: ${selectedCount}</span>
          <button id="postBulkDelete" class="btn-delete bulk-delete-btn" type="button" ${selectedCount ? "" : "disabled"}>Delete Selected</button>
        </div>
        <div class="bulk-admin-tools">
          <div class="bulk-inline-group">
            <input id="postBulkCountInput" class="bulk-count-input" type="number" min="1" max="${leads.length || 1}" placeholder="Count" />
            <button id="postBulkCountApply" class="btn-ghost bulk-action-btn" type="button" ${leads.length ? "" : "disabled"}>Select Count</button>
          </div>
          <div class="bulk-inline-group">
            <select id="postBulkAssignCounselor" class="bulk-assign-select">
              <option value="">Assign to</option>
              ${assignableCounselors.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}
            </select>
            <button id="postBulkAssignBtn" class="btn-ghost bulk-action-btn" type="button" ${selectedCount ? "" : "disabled"}>Assign Selected</button>
          </div>
        </div>
      </div>
    `
    : "";
  const selectionColumn = isAdmin
    ? `<th class="selection-header">Select</th>`
    : "";
  const tableColspan = isAdmin ? 8 : 7;

  let html = `
    ${bulkToolbar}
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            ${selectionColumn}
            <th>Lead Import Date</th>
            <th>Name</th>
            <th>Phone Number</th>
            <th>Email</th>
            <th>Workshop Name</th>
            <th>Counselor</th>
            <th>Admission Calling Activity</th>
          </tr>
        </thead>
        <tbody>
  `;

  if (!leads.length) {
    html += `<tr><td colspan="${tableColspan}">No admission calling leads available for current filters.</td></tr>`;
  } else {
    html += leads
      .map(
        (lead) => `
      <tr>
        ${isAdmin ? `
        <td>
          <input class="lead-select-checkbox" type="checkbox" data-lead-key="${escapeHtml(buildLeadSelectionKey(lead))}" ${isLeadSelected(lead) ? "checked" : ""} />
        </td>
        ` : ""}
        <td>${escapeHtml(lead.createdAt)}</td>
        <td>${escapeHtml(lead.name)}</td>
        <td>${escapeHtml(lead.phone || "-")}</td>
        <td>${escapeHtml(lead.email)}</td>
        <td>${escapeHtml(lead.workshop)}</td>
        <td>${escapeHtml(lead.counselor || "Unassigned")}</td>
        <td>${renderActivityPanel(lead)}</td>
      </tr>
    `
      )
      .join("");
  }

  html += `</tbody></table></div>`;
  postLeadTableSection.innerHTML = html;

  document.querySelectorAll(".btn-view-activity").forEach((button) => {
    button.onclick = () => {
      const leadId = button.getAttribute("data-lead-id");
      openPostActivityDetailsModal(leadId);
    };
  });

  document.querySelectorAll(".btn-update-status").forEach((button) => {
    button.onclick = () => {
      const leadId = button.getAttribute("data-lead-id");
      const leadEmail = button.getAttribute("data-lead-email");
      openPostActivityModal(leadId, leadEmail);
    };
  });

  document.querySelectorAll(".btn-notes").forEach((button) => {
    button.onclick = () => {
      const leadId = button.getAttribute("data-lead-id");
      const leadEmail = button.getAttribute("data-lead-email");
      openNotesModal(leadId, leadEmail);
    };
  });

  document.querySelectorAll(".btn-task").forEach((button) => {
    button.onclick = () => {
      const leadId = button.getAttribute("data-lead-id");
      openTaskModal(leadId);
    };
  });

  document.querySelectorAll(".btn-delete").forEach((button) => {
    button.onclick = async () => {
      const leadId = button.getAttribute("data-lead-id");
      if (leadId && await deleteLead(leadId)) {
        clearSelectedLeadIds();
        renderAll();
      }
    };
  });

  const bulkSelect = document.getElementById("postBulkSelect");
  if (bulkSelect) {
    bulkSelect.onchange = (event) => {
      toggleAllLeadsSelection(leads, event.target.checked);
      renderAll();
    };
  }

  const bulkDelete = document.getElementById("postBulkDelete");
  if (bulkDelete) {
    bulkDelete.onclick = () => {
      void deleteSelectedLeads(leads).then((deleted) => {
        if (deleted) {
          renderAll();
        }
      });
    };
  }

  const bulkCountApply = document.getElementById("postBulkCountApply");
  const bulkCountInput = document.getElementById("postBulkCountInput");
  if (bulkCountApply && bulkCountInput) {
    bulkCountApply.onclick = () => {
      const selectedBatchCount = selectLeadBatch(leads, bulkCountInput.value);
      if (!selectedBatchCount) {
        showToast("Enter a valid lead count to select.", true);
        return;
      }

      renderAll();
      showToast(`Selected ${selectedBatchCount} lead${selectedBatchCount === 1 ? "" : "s"}.`, false);
    };
  }

  const bulkAssignBtn = document.getElementById("postBulkAssignBtn");
  const bulkAssignCounselor = document.getElementById("postBulkAssignCounselor");
  if (bulkAssignBtn && bulkAssignCounselor) {
    bulkAssignBtn.onclick = () => {
      void assignSelectedLeads(leads, bulkAssignCounselor.value).then((assigned) => {
        if (assigned) {
          renderAll();
        }
      });
    };
  }

  document.querySelectorAll(".lead-select-checkbox").forEach((checkbox) => {
    checkbox.onchange = (event) => {
      const leadKey = checkbox.getAttribute("data-lead-key");
      if (leadKey) {
        toggleLeadSelection(leadKey, event.target.checked);
        renderAll();
      }
    };
  });
}

function setPostActivityModalMode(mode) {
  modalMode = mode;
  const title = document.getElementById("postActivityModalTitle");
  const saveButton = document.getElementById("savePostActivityBtn");

  if (title) {
    title.textContent = mode === "view" ? "Activity Details" : "Update Admission Calling Activity";
  }

  if (saveButton) {
    saveButton.classList.toggle("hidden", mode === "view");
  }

  activityFields.forEach((fieldId) => {
    const field = document.getElementById(fieldId);
    if (field) {
      field.disabled = mode === "view";
    }
  });
}

function populatePostActivityModal(lead) {
  document.getElementById("modalPostDialed").value = lead.postDialed;
  document.getElementById("modalCoursePitched").value = lead.coursePitched;
  document.getElementById("modalCourseStatus").value = lead.courseStatus;
  document.getElementById("modalAdmissionStatus").value = lead.admissionStatus;
  document.getElementById("modalPostCallStatus").value = lead.postCallStatus;
  document.getElementById("modalWorkshopJoiningStatus").value = lead.workshopJoiningStatus;
}

function findLeadByActionIdentity(leads, leadId, leadEmail = "") {
  const normalizedId = String(leadId);
  const normalizedEmail = String(leadEmail || "").trim().toLowerCase();
  if (normalizedEmail) {
    const exactLead = leads.find((lead) => (
      String(lead.id) === normalizedId &&
      String(lead.email || "").trim().toLowerCase() === normalizedEmail
    ));
    if (exactLead) return exactLead;
  }

  if (isCounselorSession()) {
    const counselorIdentity = getCounselorIdentity();
    const counselorLead = leads.find((lead) => (
      String(lead.id) === normalizedId &&
      String(lead.counselor || "").trim().toLowerCase() === counselorIdentity
    ));
    if (counselorLead) return counselorLead;
  }

  return leads.find((lead) => String(lead.id) === normalizedId);
}

async function updatePostActivity(leadId, updates, leadEmail = "") {
  const allLeads = getAllLeads();
  const lead = findLeadByActionIdentity(allLeads, leadId, leadEmail);
  if (!lead) {
    return false;
  }

  if (isCounselorSession()) {
    const owner = String(lead.counselor || "").trim().toLowerCase();
    if (owner !== getCounselorIdentity()) {
      return false;
    }
  }

  const workshopActivityCount = Array.isArray(lead.workshopActivityHistory)
    ? lead.workshopActivityHistory.length
    : Number(lead.preActivityUpdates) || 0;
  if (!workshopActivityCount) {
    const confirmed = window.confirm(
      "The lead has not been called for Workshop Calling. Do you still want to update the details?"
    );

    if (!confirmed) {
      return false;
    }
  }

  try {
    const result = await updateLeadActivityOnServer(leadId, {
      stage: "admission",
      updates,
      leadEmail: leadEmail || lead.email || "",
      allowWithoutWorkshopActivity: true
    });
    if (result && result.ok === false) {
      showToast(result.message || "Failed to save activity. Please check your connection and try again.", true);
      return false;
    }

    showToast(
      updates.courseStatus === "Not Interested"
        ? "Lead moved to Lost Leads."
        : "Admission Calling activity saved successfully.",
      false
    );
    return true;
  } catch (err) {
    console.error("[post-workshop] Failed to persist leads:", err);
    showToast("Failed to save activity. Please check your connection and try again.", true);
    return false;
  }
}

async function deleteLead(leadId) {
  const allLeads = getAllLeads();
  const index = allLeads.findIndex((lead) => String(lead.id) === String(leadId));
  if (index === -1) {
    return false;
  }

  const confirmed = window.confirm("Delete this lead? This cannot be undone.");
  if (!confirmed) {
    return false;
  }

  allLeads.splice(index, 1);
  const deleteLeadResult = await saveAllLeads(allLeads);
  if (!deleteLeadResult || deleteLeadResult.ok === false) {
    showToast("Failed to delete lead. Please check your connection and try again.", true);
    return false;
  }
  setMessage("Lead deleted successfully.", false);
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

  const allLeads = getAllLeads();
  const remainingLeads = allLeads.filter((lead) => !selectedLeadKeys.has(buildLeadSelectionKey(lead)));
  const removedCount = allLeads.length - remainingLeads.length;
  if (!removedCount) {
    return false;
  }

  const deleteSelectedResult = await saveAllLeads(remainingLeads);
  if (!deleteSelectedResult || deleteSelectedResult.ok === false) {
    showToast("Failed to delete selected leads. Please check your connection and try again.", true);
    return false;
  }
  clearSelectedLeadIds();
  setMessage(`Deleted ${removedCount} selected lead${removedCount === 1 ? "" : "s"}.`, false);
  return true;
}

function clearSelectedLeadIds() {
  selectedLeadKeys = new Set();
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

function buildLeadSelectionKey(lead) {
  const ref = buildLeadSelectionRef(lead);
  return [ref.id, ref.email, ref.phone, ref.workshop, ref.createdAt].join("::");
}

function getSelectableLeadKeys(leads) {
  return leads.map((lead) => buildLeadSelectionKey(lead));
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
  return selectedLeadKeys.has(buildLeadSelectionKey(lead));
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

function getAdminAssignmentOptions(leads) {
  const counselorNames = getStoredCounselors()
    .map((item) => String(item.name || "").trim())
    .filter(Boolean);
  const assignedCounselors = leads
    .map((lead) => String(lead.counselor || "").trim())
    .filter((name) => name && name.toLowerCase() !== "unassigned");

  return [...new Set(["Unassigned", ...counselorNames, ...assignedCounselors])];
}

async function assignSelectedLeads(leads, counselorName) {
  const leadRefsByKey = new Map(leads.map((lead) => [buildLeadSelectionKey(lead), buildLeadSelectionRef(lead)]));
  const applicableLeadRefs = [...selectedLeadKeys]
    .map((leadKey) => leadRefsByKey.get(String(leadKey)))
    .filter(Boolean);
  if (!applicableLeadRefs.length) {
    showToast("Select at least one lead to assign.", true);
    return false;
  }

  const targetCounselor = String(counselorName || "").trim();
  if (!targetCounselor) {
    showToast("Select a counselor first.", true);
    return false;
  }

  const updatedCount = applicableLeadRefs.length;

  if (!updatedCount) {
    showToast("No leads were updated.", true);
    return false;
  }

  const assignmentResult = await assignLeadsOnServer(applicableLeadRefs, targetCounselor);
  if (!assignmentResult || assignmentResult.ok === false) {
    showToast(assignmentResult?.message || "Failed to assign selected leads. Please check your connection and try again.", true);
    return false;
  }

  setMessage(`Assigned ${updatedCount} lead${updatedCount === 1 ? "" : "s"} to ${targetCounselor}.`, false);
  showToast(`Assigned ${updatedCount} lead${updatedCount === 1 ? "" : "s"} to ${targetCounselor}.`, false);
  return true;
}

function openPostActivityModal(leadId, leadEmail = "") {
  modalLeadId = leadId;
  modalLeadEmail = leadEmail || "";
  const allLeads = getAllLeads();
  const lead = findLeadByActionIdentity(allLeads, leadId, leadEmail);
  if (!lead) {
    showToast("Could not open this lead. Please refresh and try again.", true);
    return;
  }

  if (isCounselorSession()) {
    const owner = String(lead.counselor || "").trim().toLowerCase();
    if (owner !== getCounselorIdentity()) {
      showToast("Only the assigned counselor can update this lead.", true);
      return;
    }
  }

  setPostActivityModalMode("edit");
  populatePostActivityModal(lead);
  document.getElementById("postActivityModal").classList.remove("hidden");
}

function openPostActivityDetailsModal(leadId, leadEmail = "") {
  modalLeadId = leadId;
  modalLeadEmail = leadEmail || "";
  const allLeads = getAllLeads();
  const lead = findLeadByActionIdentity(allLeads, leadId, leadEmail);
  if (!lead) {
    showToast("Could not open this lead. Please refresh and try again.", true);
    return;
  }

  if (isCounselorSession()) {
    const owner = String(lead.counselor || "").trim().toLowerCase();
    if (owner !== getCounselorIdentity()) {
      showToast("Only the assigned counselor can view this lead.", true);
      return;
    }
  }

  setPostActivityModalMode("view");
  populatePostActivityModal(lead);
  document.getElementById("postActivityModal").classList.remove("hidden");
}

function closePostModal() {
  document.getElementById("postActivityModal").classList.add("hidden");
  modalLeadId = null;
  modalLeadEmail = "";
  setPostActivityModalMode("edit");
}

let notesLeadId = null;
let notesLeadEmail = "";

function canEditLeadNotes(lead) {
  if (!isCounselorSession()) return false;
  const owner = String(lead?.counselor || "").trim().toLowerCase();
  return owner === getCounselorIdentity();
}

function openNotesModal(leadId, leadEmail = "") {
  notesLeadId = leadId;
  notesLeadEmail = leadEmail || "";
  const allLeads = getAllLeads();
  const lead = findLeadByActionIdentity(allLeads, leadId, leadEmail);
  if (!lead) {
    return;
  }

  const notes = Array.isArray(lead.leadNotes) ? lead.leadNotes : [];
  const canEditNotes = canEditLeadNotes(lead);
  const notesListSection = document.getElementById("notesListSection");
  if (notesListSection) {
    notesListSection.innerHTML = notes.length
      ? notes.map((note, idx) => `
        <div class="note-item">
          <span class="note-text">${escapeHtml(note.text)}</span>
          <span class="note-meta">${escapeHtml(note.by || "")}${note.by && note.at ? " \u2013 " : ""}${escapeHtml(note.at || "")}</span>
          ${canEditNotes ? `<button type="button" class="btn-ghost btn-delete-note" data-note-index="${idx}" style="font-size:0.75rem;padding:2px 6px;">Delete</button>` : ""}
        </div>`).join("")
      : `<p class="block-help">${canEditNotes ? "No notes yet. Add one below." : "No notes yet."}</p>`;

    notesListSection.querySelectorAll(".btn-delete-note").forEach((btn) => {
      btn.onclick = () => {
        const idx = Number(btn.getAttribute("data-note-index"));
        void deleteNote(leadId, idx, leadEmail || lead.email || "");
      };
    });
  }

  const newNoteInput = document.getElementById("newNoteInput");
  if (newNoteInput) {
    newNoteInput.value = "";
  }

  const noteInputRow = newNoteInput?.closest(".modal-row");
  if (noteInputRow) {
    noteInputRow.classList.toggle("hidden", !canEditNotes);
  }

  const saveNoteBtn = document.getElementById("saveNoteBtn");
  if (saveNoteBtn) {
    saveNoteBtn.classList.toggle("hidden", !canEditNotes);
  }

  const notesModal = document.getElementById("notesModal");
  if (notesModal) {
    notesModal.classList.remove("hidden");
  }
}

function closeNotesModal() {
  const notesModal = document.getElementById("notesModal");
  if (notesModal) {
    notesModal.classList.add("hidden");
  }
  notesLeadId = null;
  notesLeadEmail = "";
}

async function saveNote() {
  const newNoteInput = document.getElementById("newNoteInput");
  const text = newNoteInput ? newNoteInput.value.trim() : "";
  if (!text || !notesLeadId) {
    return;
  }

  const allLeads = getAllLeads();
  const lead = findLeadByActionIdentity(allLeads, notesLeadId, notesLeadEmail);
  if (!lead) {
    return;
  }
  if (!canEditLeadNotes(lead)) {
    showToast("Only the assigned counselor can edit notes.", true);
    return;
  }

  const noteSaveResult = await addLeadNote(notesLeadId, text, notesLeadEmail || lead.email || "");
  if (!noteSaveResult || noteSaveResult.ok === false) {
    showToast(noteSaveResult?.message || "Failed to save note. Please check your connection and try again.", true);
    return;
  }
  openNotesModal(notesLeadId, notesLeadEmail || lead.email || "");
  showToast("Note saved.", false);
}

async function deleteNote(leadId, noteIndex, leadEmail = "") {
  const allLeads = getAllLeads();
  const lead = findLeadByActionIdentity(allLeads, leadId, leadEmail);
  if (!lead) {
    return;
  }
  if (!canEditLeadNotes(lead)) {
    showToast("Only the assigned counselor can delete notes.", true);
    return;
  }

  const noteDeleteResult = await deleteLeadNote(leadId, noteIndex, leadEmail || lead.email || "");
  if (!noteDeleteResult || noteDeleteResult.ok === false) {
    showToast(noteDeleteResult?.message || "Failed to delete note. Please check your connection and try again.", true);
    return;
  }
  openNotesModal(leadId, leadEmail || lead.email || "");
  showToast("Note deleted.", false);
}

function setTaskMessage(text, isError = true) {
  if (!taskMessage) {
    return;
  }

  taskMessage.textContent = text;
  taskMessage.style.color = isError ? "var(--danger)" : "var(--success)";
}

function closeTaskModal() {
  if (taskModal) {
    taskModal.classList.add("hidden");
  }
  setTaskMessage("");
}

function openTaskModal(leadId) {
  if (!canCreateTasks) {
    return;
  }

  const availableLeads = isCounselorSession() ? getScopedLeads(getAllLeads()) : getAllLeads();
  const lead = availableLeads.find((item) => String(item.id) === String(leadId));
  if (!lead) {
    return;
  }

  taskLeadIdInput.value = lead.id;
  taskCategoryInput.value = TASK_CATEGORY.admission;
  taskLeadNameInput.value = lead.name || "";
  taskCounselorInput.value = lead.counselor || "Unassigned";
  const taskLeadPhoneInput = document.getElementById("taskLeadPhone");
  if (taskLeadPhoneInput) {
    taskLeadPhoneInput.value = lead.phone || "-";
  }
  taskTitleInput.value = `Follow up with ${lead.name || "lead"}`;
  taskNotesInput.value = "";
  taskDueDateInput.value = "";
  setTaskMessage("");
  taskModalTitle.textContent = "Create Admission Task";
  taskModal.classList.remove("hidden");
}

async function handleTaskSubmit(event) {
  event.preventDefault();

  const leadId = taskLeadIdInput.value;
  const title = taskTitleInput.value.trim();
  const dueDate = taskDueDateInput.value;

  if (!leadId || !title || !dueDate) {
    setTaskMessage("Title and due date are required.", true);
    return;
  }

  const allLeads = getAllLeads();
  const lead = allLeads.find((item) => String(item.id) === String(leadId));
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
    category: TASK_CATEGORY.admission,
    title,
    notes: taskNotesInput.value.trim(),
    dueDate
  });

  if (!taskResult || taskResult.ok === false) {
    setTaskMessage(taskResult?.message || "Failed to save task. Please check your connection and try again.", true);
    return;
  }

  setTaskMessage("Task created and sent to Task Tracker.", false);
  closeTaskModal();
}

function initPostWorkshopPage() {
  const modal = document.getElementById("postActivityModal");
  if (!modal) {
    return;
  }

  document.getElementById("closePostModalBtn").onclick = closePostModal;
  document.getElementById("postActivityForm").onsubmit = async (event) => {
    event.preventDefault();
    if (!modalLeadId) {
      return;
    }

    const saved = await updatePostActivity(modalLeadId, {
      postDialed: document.getElementById("modalPostDialed").value,
      coursePitched: document.getElementById("modalCoursePitched").value,
      courseStatus: document.getElementById("modalCourseStatus").value,
      admissionStatus: document.getElementById("modalAdmissionStatus").value,
      postCallStatus: document.getElementById("modalPostCallStatus").value,
      workshopJoiningStatus: document.getElementById("modalWorkshopJoiningStatus").value,
      postStatusUpdated: true
    }, modalLeadEmail);

    if (!saved) {
      return;
    }

    closePostModal();
    renderAll();
  };
}

  if (taskModal && taskForm) {
    document.getElementById("closeTaskModalBtn").onclick = closeTaskModal;
    taskForm.onsubmit = handleTaskSubmit;
  }

  const notesModal = document.getElementById("notesModal");
  if (notesModal) {
    document.getElementById("closeNotesModalBtn").onclick = closeNotesModal;
    document.getElementById("saveNoteBtn").onclick = () => {
      void saveNote();
    };
  }

  document.querySelectorAll(".btn-task").forEach((button) => {
    button.addEventListener("click", () => {
      const leadId = button.getAttribute("data-lead-id");
      if (leadId) {
        openTaskModal(leadId);
      }
    });
  });

initPostWorkshopPage();

function renderAll() {
  const allLeads = getAllLeads();
  normalizeLeadFields(allLeads);

  const scopedLeads = getScopedLeads(allLeads);
  const admissionLeads = getAdmissionCallingLeads(scopedLeads);
  const filteredLeads = filterLeads(admissionLeads);

  renderKpis(filteredLeads);
  const _focusedId = document.activeElement?.id;
  const _selStart = document.activeElement?.selectionStart;
  const _selEnd = document.activeElement?.selectionEnd;
  renderFilters(admissionLeads);
  if (_focusedId) {
    const _el = document.getElementById(_focusedId);
    if (_el) {
      _el.focus();
      if (_selStart != null) _el.setSelectionRange(_selStart, _selEnd);
    }
  }
  renderLeadTable(filteredLeads);
}

renderAll();
const stopStatePolling = startStatePolling(() => {
  renderAll();
});
registerPageCleanup(stopStatePolling);
