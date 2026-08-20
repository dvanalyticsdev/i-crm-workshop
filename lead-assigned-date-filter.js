import { getKolkataDayRange, parseKolkataDate, toKolkataDateKey } from "./date-utils.js";

export const LEAD_ASSIGNED_DATE_DEFAULTS = {
  assignedTimeline: "overall",
  assignedStartDate: "",
  assignedEndDate: ""
};

function normalize(value) {
  return String(value || "").trim();
}

export function getLeadAssignedDateRange(filter = {}) {
  const timeline = normalize(filter.assignedTimeline || "overall");
  if (!timeline || timeline === "overall") return null;
  if (timeline === "today") return getKolkataDayRange(0);
  if (timeline === "yesterday") return getKolkataDayRange(-1);
  if (timeline === "week") {
    const { start } = getKolkataDayRange(-6);
    const { end } = getKolkataDayRange(0);
    return { start, end };
  }

  const start = parseKolkataDate(filter.assignedStartDate);
  const endBase = parseKolkataDate(filter.assignedEndDate);
  if (!start || !endBase || start > endBase) {
    return { start: null, end: null };
  }
  return {
    start,
    end: new Date(`${toKolkataDateKey(endBase)}T23:59:59.999+05:30`)
  };
}

export function getLeadAssignedDateValue(lead = {}) {
  const assigned = normalize(lead.leadOwnerTimelineAt || lead.counselorAssignedAt);
  if (assigned) return assigned;
  const counselor = normalize(lead.counselor).toLowerCase();
  if (!counselor || counselor === "unassigned") return "";
  return normalize(lead.createdAtExact || lead.createdAt);
}

export function leadMatchesAssignedDate(lead = {}, filter = {}) {
  const range = getLeadAssignedDateRange(filter);
  if (!range) return true;
  if (!range.start || !range.end) return true;

  const value = getLeadAssignedDateValue(lead);
  const date = parseKolkataDate(value);
  if (!date) return false;
  const timestamp = date.getTime();
  return timestamp >= range.start.getTime() && timestamp <= range.end.getTime();
}

export function getLeadAssignedDateLabel(filter = {}, formatDate = (value) => String(value || "")) {
  const timeline = normalize(filter.assignedTimeline || "overall");
  if (timeline === "today") return "Today";
  if (timeline === "yesterday") return "Yesterday";
  if (timeline === "week") return "Last 7 Days";
  if (timeline === "custom") {
    const range = getLeadAssignedDateRange(filter);
    if (!range?.start || !range?.end) return "Custom";
    return `${formatDate(range.start)} - ${formatDate(range.end)}`;
  }
  return "Overall";
}

export function renderLeadAssignedDateFilter({ prefix, filter, escapeHtml }) {
  const timeline = normalize(filter.assignedTimeline || "overall");
  const isCustom = timeline === "custom";
  return `
    <div class="filter-item">
      <label for="${prefix}AssignedTimelineSelect">Lead Assigned Date</label>
      <select id="${prefix}AssignedTimelineSelect">
        <option value="overall" ${timeline === "overall" ? "selected" : ""}>Use Filter</option>
        <option value="today" ${timeline === "today" ? "selected" : ""}>Today</option>
        <option value="yesterday" ${timeline === "yesterday" ? "selected" : ""}>Yesterday</option>
        <option value="week" ${timeline === "week" ? "selected" : ""}>Last 7 Days</option>
        <option value="custom" ${timeline === "custom" ? "selected" : ""}>Custom Range</option>
      </select>
    </div>
    <div class="filter-item ${isCustom ? "" : "hidden"}" id="${prefix}AssignedStartDateWrap">
      <label for="${prefix}AssignedStartDate">Assigned Start Date</label>
      <input id="${prefix}AssignedStartDate" type="date" value="${escapeHtml(filter.assignedStartDate || "")}" />
    </div>
    <div class="filter-item ${isCustom ? "" : "hidden"}" id="${prefix}AssignedEndDateWrap">
      <label for="${prefix}AssignedEndDate">Assigned End Date</label>
      <input id="${prefix}AssignedEndDate" type="date" value="${escapeHtml(filter.assignedEndDate || "")}" />
    </div>
  `;
}

export function bindLeadAssignedDateFilter({ prefix, filter, persist, render, resetPage }) {
  const timelineSelect = document.getElementById(`${prefix}AssignedTimelineSelect`);
  const startDateInput = document.getElementById(`${prefix}AssignedStartDate`);
  const endDateInput = document.getElementById(`${prefix}AssignedEndDate`);
  const startWrap = document.getElementById(`${prefix}AssignedStartDateWrap`);
  const endWrap = document.getElementById(`${prefix}AssignedEndDateWrap`);

  const rerender = () => {
    if (typeof resetPage === "function") resetPage();
    persist();
    render();
  };

  if (timelineSelect) {
    timelineSelect.onchange = (event) => {
      filter.assignedTimeline = event.target.value;
      if (startWrap) startWrap.classList.toggle("hidden", filter.assignedTimeline !== "custom");
      if (endWrap) endWrap.classList.toggle("hidden", filter.assignedTimeline !== "custom");
      rerender();
    };
  }
  if (startDateInput) {
    startDateInput.onchange = (event) => {
      filter.assignedStartDate = event.target.value;
      rerender();
    };
  }
  if (endDateInput) {
    endDateInput.onchange = (event) => {
      filter.assignedEndDate = event.target.value;
      rerender();
    };
  }
}
