import { getKolkataDayRange, parseKolkataDate, toKolkataDateKey } from "./date-utils.js";

export const COUNSELOR_ACTIVITY_DATE_DEFAULTS = {
  counselorActivityTimeline: "overall",
  counselorActivityStartDate: "",
  counselorActivityEndDate: ""
};

const SYSTEM_ACTORS = new Set(["reachout webhook", "system"]);
const EXCLUDED_ACTIVITY_TYPES = new Set([
  "Lead Created",
  "Lead Assigned",
  "Lead Reassigned",
  "Counselor Changed",
  "Lead Viewed"
]);

function normalize(value) {
  return String(value || "").trim();
}

function hasWhatsAppSignal(value) {
  return /whatsapp|reachout/i.test(normalize(value));
}

function isSystemEntry(entry = {}) {
  const by = normalize(entry.by).toLowerCase();
  const source = normalize(entry.source).toLowerCase();
  return SYSTEM_ACTORS.has(by) || SYSTEM_ACTORS.has(source) || source.includes("webhook");
}

function getEntryTimestamp(value) {
  const candidate = normalize(
    value?.at
    || value?.timestamp
    || value?.createdAt
    || value?.updatedAt
    || value
  );
  if (!candidate) {
    return Number.NaN;
  }
  return new Date(candidate).getTime();
}

function isInRange(timestamp, range) {
  if (!range) {
    return true;
  }
  if (!range.start || !range.end) {
    return true;
  }
  return timestamp >= range.start.getTime() && timestamp <= range.end.getTime();
}

export function getCounselorActivityDateRange(filter = {}) {
  const timeline = normalize(filter.counselorActivityTimeline || "overall");
  if (!timeline || timeline === "overall") {
    return null;
  }

  if (timeline === "today") {
    return getKolkataDayRange(0);
  }

  if (timeline === "yesterday") {
    return getKolkataDayRange(-1);
  }

  if (timeline === "week") {
    const { start } = getKolkataDayRange(-6);
    const { end } = getKolkataDayRange(0);
    return { start, end };
  }

  const start = parseKolkataDate(filter.counselorActivityStartDate);
  const endBase = parseKolkataDate(filter.counselorActivityEndDate);
  if (!start || !endBase || start > endBase) {
    return { start: null, end: null };
  }

  return {
    start,
    end: new Date(`${toKolkataDateKey(endBase)}T23:59:59.999+05:30`)
  };
}

export function isCounselorActivityEntry(entry = {}, options = {}) {
  if (!entry || typeof entry !== "object" || isSystemEntry(entry)) {
    return false;
  }

  const activityType = normalize(entry.activityType || entry.type || entry.eventType || entry.actionType || entry.label);
  const actionDescription = normalize(entry.actionDescription || entry.description);
  if (EXCLUDED_ACTIVITY_TYPES.has(activityType) || hasWhatsAppSignal(activityType) || hasWhatsAppSignal(actionDescription)) {
    return false;
  }

  const updates = entry.updates && typeof entry.updates === "object" ? entry.updates : null;
  if (!updates) {
    return Boolean(activityType || normalize(entry.by));
  }

  const allowedFields = new Set((options.activityFields || []).map(normalize).filter(Boolean));
  const excludedFields = new Set((options.excludedFields || []).map(normalize).filter(Boolean));
  return Object.keys(updates).some((field) => {
    const normalizedField = normalize(field);
    if (!normalizedField || excludedFields.has(normalizedField) || hasWhatsAppSignal(normalizedField)) {
      return false;
    }
    return !allowedFields.size || allowedFields.has(normalizedField);
  });
}

export function leadMatchesCounselorActivityDate(lead, filter, options = {}) {
  const range = getCounselorActivityDateRange(filter);
  if (!range) {
    return true;
  }
  if (!range.start || !range.end) {
    return true;
  }

  const historyFields = Array.isArray(options.historyFields) ? options.historyFields : [];
  const hasHistoryTouch = historyFields.some((field) => {
    const history = Array.isArray(lead?.[field]) ? lead[field] : [];
    return history.some((entry) => {
      if (!isCounselorActivityEntry(entry, options)) {
        return false;
      }
      const timestamp = getEntryTimestamp(entry);
      return Number.isFinite(timestamp) && isInRange(timestamp, range);
    });
  });
  if (hasHistoryTouch) {
    return true;
  }

  if (!options.includeNotes) {
    return false;
  }

  const noteField = options.noteField || "leadNotes";
  const notes = Array.isArray(lead?.[noteField]) ? lead[noteField] : [];
  return notes.some((note) => {
    if (isSystemEntry(note)) {
      return false;
    }
    const timestamp = getEntryTimestamp(note);
    return Number.isFinite(timestamp) && isInRange(timestamp, range);
  });
}

export function renderCounselorActivityDateFilter({ prefix, filter, escapeHtml }) {
  const timeline = normalize(filter.counselorActivityTimeline || "overall");
  const isCustom = timeline === "custom";
  return `
    <div class="filter-item">
      <label for="${prefix}CounselorActivityTimelineSelect">Counselor Activity Date</label>
      <select id="${prefix}CounselorActivityTimelineSelect">
        <option value="overall" ${timeline === "overall" ? "selected" : ""}>Use Filter</option>
        <option value="today" ${timeline === "today" ? "selected" : ""}>Today</option>
        <option value="yesterday" ${timeline === "yesterday" ? "selected" : ""}>Yesterday</option>
        <option value="week" ${timeline === "week" ? "selected" : ""}>Last 7 Days</option>
        <option value="custom" ${timeline === "custom" ? "selected" : ""}>Custom Range</option>
      </select>
    </div>
    <div class="filter-item ${isCustom ? "" : "hidden"}" id="${prefix}CounselorActivityStartDateWrap">
      <label for="${prefix}CounselorActivityStartDate">Activity Start Date</label>
      <input id="${prefix}CounselorActivityStartDate" type="date" value="${escapeHtml(filter.counselorActivityStartDate || "")}" />
    </div>
    <div class="filter-item ${isCustom ? "" : "hidden"}" id="${prefix}CounselorActivityEndDateWrap">
      <label for="${prefix}CounselorActivityEndDate">Activity End Date</label>
      <input id="${prefix}CounselorActivityEndDate" type="date" value="${escapeHtml(filter.counselorActivityEndDate || "")}" />
    </div>
  `;
}

export function bindCounselorActivityDateFilter({ prefix, filter, persist, render, resetPage }) {
  const timelineSelect = document.getElementById(`${prefix}CounselorActivityTimelineSelect`);
  const startDateInput = document.getElementById(`${prefix}CounselorActivityStartDate`);
  const endDateInput = document.getElementById(`${prefix}CounselorActivityEndDate`);
  const startWrap = document.getElementById(`${prefix}CounselorActivityStartDateWrap`);
  const endWrap = document.getElementById(`${prefix}CounselorActivityEndDateWrap`);

  const rerender = () => {
    if (typeof resetPage === "function") {
      resetPage();
    }
    persist();
    render();
  };

  if (timelineSelect) {
    timelineSelect.onchange = (event) => {
      filter.counselorActivityTimeline = event.target.value;
      if (startWrap) startWrap.classList.toggle("hidden", filter.counselorActivityTimeline !== "custom");
      if (endWrap) endWrap.classList.toggle("hidden", filter.counselorActivityTimeline !== "custom");
      rerender();
    };
  }
  if (startDateInput) {
    startDateInput.onchange = (event) => {
      filter.counselorActivityStartDate = event.target.value;
      rerender();
    };
  }
  if (endDateInput) {
    endDateInput.onchange = (event) => {
      filter.counselorActivityEndDate = event.target.value;
      rerender();
    };
  }
}
