import { registerPageCleanup } from "./page-runtime.js";
import {
  bootstrapLocalState,
  getCounselors,
  getLeads as getStoredLeads,
  getSession,
  loadLocalPreference,
  saveLocalPreference,
  startStatePolling
} from "./state-sync.js";

await bootstrapLocalState();

const monitoringSectionNav = document.getElementById("monitoringSectionNav");
const monitoringSubsectionNav = document.getElementById("monitoringSubsectionNav");
const monitoringActiveTitle = document.getElementById("monitoringActiveTitle");
const monitoringActiveDescription = document.getElementById("monitoringActiveDescription");
const monitoringKpiSection = document.getElementById("monitoringKpiSection");
const monitoringActiveTable = document.getElementById("monitoringActiveTable");

const monitoringTimelineSelect = document.getElementById("monitoringTimelineSelect");
const monitoringStartDate = document.getElementById("monitoringStartDate");
const monitoringEndDate = document.getElementById("monitoringEndDate");
const monitoringStartDateWrap = document.getElementById("monitoringStartDateWrap");
const monitoringEndDateWrap = document.getElementById("monitoringEndDateWrap");
const resetMonitoringTimeline = document.getElementById("resetMonitoringTimeline");
const exportMonitoringBtn = document.getElementById("exportMonitoringBtn");
const monitoringExportMessage = document.getElementById("monitoringExportMessage");

const session = getSession();

const TIMELINE_STORAGE_KEY = "dvWorkshopMonitoringTimeline";
const VIEW_STORAGE_KEY = "dvMonitoringActiveView";
const CRASH_SEGMENT = "crash-course";

const VIEW_CONFIG = {
  workshop: {
    label: "Workshop",
    description: "Monitor the workshop-stage pipelines and post-workshop follow-up activity.",
    subsections: {
      "workshop-calling": {
        label: "Workshop Calling",
        title: "Workshop Calling Monitoring",
        description: "Track pre-workshop calling performance, interest response, and WhatsApp group movement."
      },
      "admission-calling": {
        label: "Admission Calling",
        title: "Admission Calling Monitoring",
        description: "Track post-workshop counselor follow-up, conversion progress, and workshop-to-admission movement."
      }
    }
  },
  admission: {
    label: "Admission",
    description: "Monitor direct admission leads, registered candidates, and the 7-Day Crash Course pipeline.",
    subsections: {
      "main-admission": {
        label: "Main Admission",
        title: "Main Admission Monitoring",
        description: "Track direct Meta and website admission enquiries handled outside the workshop calling flow."
      },
      "registered-candidates": {
        label: "Registered Candidates",
        title: "Registered Candidates Monitoring",
        description: "Track the standard public-course registration pipeline and counselor follow-up activity."
      },
      "crash-course": {
        label: "7 Days Crash Course",
        title: "7 Days Crash Course Monitoring",
        description: "Track the isolated 7-Day Crash Course registration pipeline separately from standard registered candidates."
      }
    }
  },
  performance: {
    label: "Performance",
    description: "Track overall and counselor performance using lead movement, PDE activity, and conversion status.",
    subsections: {
      "workshop-performance": {
        label: "Workshop Calling",
        title: "Workshop Calling Performance",
        description: "Track workshop calling performance using pre-workshop activity, dialed status, and workshop interest movement."
      },
      "post-workshop-performance": {
        label: "Post Workshop",
        title: "Post Workshop Performance",
        description: "Track post-workshop admission follow-up using post-workshop PDE activity and admission conversion movement."
      },
      "admission-performance": {
        label: "Admission Calling",
        title: "Admission Calling Performance",
        description: "Track direct admission lead follow-up using main admission PDE activity and admission conversion movement."
      }
    }
  }
};

let timelineFilter = {
  type: "week",
  startDate: "",
  endDate: ""
};

let activeView = {
  group: "workshop",
  subsection: "workshop-calling"
};

timelineFilter = {
  ...timelineFilter,
  ...await loadLocalPreference(TIMELINE_STORAGE_KEY, {})
};

activeView = {
  ...activeView,
  ...await loadLocalPreference(VIEW_STORAGE_KEY, {})
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function toLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseLocalDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const dateOnlyMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
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
  const counselors = getCounselors();
  const match = counselors.find(
    (item) => String(item.email || "").trim().toLowerCase() === sessionEmail
  );

  return String(match?.name || session?.name || "").trim().toLowerCase() || sessionName;
}

function persistTimelineFilter() {
  void saveLocalPreference(TIMELINE_STORAGE_KEY, timelineFilter);
}

function persistActiveView() {
  void saveLocalPreference(VIEW_STORAGE_KEY, activeView);
}

function setExportMessage(text, isError = true) {
  if (!monitoringExportMessage) {
    return;
  }

  monitoringExportMessage.textContent = text;
  monitoringExportMessage.style.color = isError ? "var(--danger)" : "var(--success)";
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

function normalizePublicCourseSegment(value) {
  return normalizeText(value) === CRASH_SEGMENT ? CRASH_SEGMENT : "standard";
}

function normalizeLeadFields(leads) {
  leads.forEach((lead) => {
    lead.name = lead.name || "";
    lead.email = String(lead.email || "").toLowerCase();
    lead.workshop = lead.workshop || "";
    lead.courseName = lead.courseName || "";
    lead.createdAt = lead.createdAt || toLocalDateKey();
    lead.counselor = lead.counselor || "Unassigned";

    lead.dialed = lead.dialed || "";
    lead.callStatus = lead.callStatus || "";
    lead.wsStatus = lead.wsStatus || "";
    lead.whatsappInvite = lead.whatsappInvite || "";
    lead.whatsappGroupStatus = lead.whatsappGroupStatus || "";
    lead.workshopActivityHistory = Array.isArray(lead.workshopActivityHistory) ? lead.workshopActivityHistory : [];
    lead.admissionActivityHistory = Array.isArray(lead.admissionActivityHistory) ? lead.admissionActivityHistory : [];
    lead.registeredCourseActivityHistory = Array.isArray(lead.registeredCourseActivityHistory) ? lead.registeredCourseActivityHistory : [];
    lead.mainAdmissionActivityHistory = Array.isArray(lead.mainAdmissionActivityHistory) ? lead.mainAdmissionActivityHistory : [];

    lead.postDialed = lead.postDialed || "";
    lead.coursePitched = lead.coursePitched || "";
    lead.courseStatus = lead.courseStatus || "";
    lead.admissionStatus = lead.admissionStatus || "";
    lead.postStatusUpdated = typeof lead.postStatusUpdated === "boolean" ? lead.postStatusUpdated : false;

    lead.registeredDialed = lead.registeredDialed || "";
    lead.registeredCourseStatus = lead.registeredCourseStatus || "";
    lead.registeredAdmissionStatus = lead.registeredAdmissionStatus || "";
    lead.registeredCallStatus = lead.registeredCallStatus || "";

    lead.mainAdmissionDialed = lead.mainAdmissionDialed || "";
    lead.mainAdmissionCoursePitched = lead.mainAdmissionCoursePitched || "";
    lead.mainAdmissionCourseStatus = lead.mainAdmissionCourseStatus || "";
    lead.mainAdmissionAdmissionStatus = lead.mainAdmissionAdmissionStatus || "";
    lead.mainAdmissionCallStatus = lead.mainAdmissionCallStatus || "";

    lead.preActivityUpdates = lead.workshopActivityHistory.length;
    lead.postActivityUpdates = lead.admissionActivityHistory.length;
    lead.registeredCourseActivityUpdates = lead.registeredCourseActivityHistory.length;
    lead.mainAdmissionActivityUpdates = lead.mainAdmissionActivityHistory.length;
  });
}

function getAllLeads() {
  const leads = getStoredLeads();
  normalizeLeadFields(leads);
  return leads;
}

function isCourseRegistrationLead(lead) {
  return normalizeText(lead?.leadPipeline) === "course-registration";
}

function isCrashCourseRegistrationLead(lead) {
  return isCourseRegistrationLead(lead)
    && normalizePublicCourseSegment(lead?.publicCourseSegment) === CRASH_SEGMENT;
}

function isStandardRegisteredLead(lead) {
  return isCourseRegistrationLead(lead) && !isCrashCourseRegistrationLead(lead);
}

function isMainAdmissionLead(lead) {
  return normalizeText(lead?.leadPipeline) === "main-admission";
}

function isNonWorkshopPipelineLead(lead) {
  return isCourseRegistrationLead(lead) || isMainAdmissionLead(lead);
}

function isLostLead(lead) {
  return lead.postStatusUpdated && lead.courseStatus === "Not Interested";
}

function getTimelineRange() {
  if (timelineFilter.type === "overall") {
    return null;
  }

  const now = new Date();

  if (timelineFilter.type === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  if (timelineFilter.type === "week") {
    const start = new Date(now);
    start.setDate(start.getDate() - 6);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  if (timelineFilter.type === "recent") {
    const start = new Date(now);
    start.setDate(start.getDate() - 29);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  if (timelineFilter.type === "custom") {
    if (!timelineFilter.startDate || !timelineFilter.endDate) {
      return null;
    }

    const start = parseLocalDate(timelineFilter.startDate);
    if (!start) {
      return null;
    }
    start.setHours(0, 0, 0, 0);
    const end = parseLocalDate(timelineFilter.endDate);
    if (!end) {
      return null;
    }
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  return null;
}

function filterHistoryInRange(history, start, end) {
  return history.filter((entry) => {
    const date = parseLocalDate(entry.at);
    if (!date) {
      return false;
    }
    return date >= start && date <= end;
  });
}

function applyTimelineFilter(leads) {
  const range = getTimelineRange();
  if (!range) {
    return leads;
  }

  const { start, end } = range;

  return leads
    .map((lead) => {
      const workshopInRange = filterHistoryInRange(lead.workshopActivityHistory, start, end);
      const admissionInRange = filterHistoryInRange(lead.admissionActivityHistory, start, end);
      const registeredInRange = filterHistoryInRange(lead.registeredCourseActivityHistory, start, end);
      const mainAdmissionInRange = filterHistoryInRange(lead.mainAdmissionActivityHistory, start, end);

      return {
        ...lead,
        preActivityUpdates: workshopInRange.length,
        postActivityUpdates: admissionInRange.length,
        registeredCourseActivityUpdates: registeredInRange.length,
        mainAdmissionActivityUpdates: mainAdmissionInRange.length
      };
    })
    .filter((lead) =>
      lead.preActivityUpdates > 0
      || lead.postActivityUpdates > 0
      || lead.registeredCourseActivityUpdates > 0
      || lead.mainAdmissionActivityUpdates > 0
    );
}

function bindTimelineControls() {
  monitoringTimelineSelect.value = timelineFilter.type;
  monitoringStartDate.value = timelineFilter.startDate;
  monitoringEndDate.value = timelineFilter.endDate;

  monitoringStartDateWrap.classList.toggle("hidden", timelineFilter.type !== "custom");
  monitoringEndDateWrap.classList.toggle("hidden", timelineFilter.type !== "custom");

  monitoringTimelineSelect.onchange = (event) => {
    timelineFilter.type = event.target.value;
    persistTimelineFilter();
    monitoringStartDateWrap.classList.toggle("hidden", timelineFilter.type !== "custom");
    monitoringEndDateWrap.classList.toggle("hidden", timelineFilter.type !== "custom");
    renderAll();
  };

  monitoringStartDate.onchange = (event) => {
    timelineFilter.startDate = event.target.value;
    persistTimelineFilter();
    renderAll();
  };

  monitoringEndDate.onchange = (event) => {
    timelineFilter.endDate = event.target.value;
    persistTimelineFilter();
    renderAll();
  };

  resetMonitoringTimeline.onclick = () => {
    timelineFilter = {
      type: "week",
      startDate: "",
      endDate: ""
    };
    persistTimelineFilter();
    bindTimelineControls();
    renderAll();
  };
}

function getCoreWorkshopName(workshopName) {
  if (!workshopName) return "";
  const name = String(workshopName).toLowerCase();

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
    return "Cyber AI Workshop 21st June";
  }
  if (name.includes("sql") && name.includes("13")) {
    return "SQL Workshop 13th June";
  }

  return String(workshopName).trim().replace(/[_\s]+(imp|od|ind)$/i, "").trim();
}

function getAdmissionWorkshopName(lead) {
  return String(lead?.admissionWorkshop || lead?.workshop || "").trim();
}

function formatBreakdownEntries(items, key, countField = "") {
  const counts = new Map();

  items.forEach((item) => {
    let value = String(item[key] || "").trim();
    if (key === "workshop") {
      value = getCoreWorkshopName(value);
    }
    if (!value) {
      return;
    }
    const count = countField ? Number(item[countField]) || 0 : 1;
    counts.set(value, (counts.get(value) || 0) + count);
  });

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));
}

function formatAdmissionWorkshopBreakdownEntries(items, countField = "") {
  return formatBreakdownEntries(
    items.map((lead) => ({ ...lead, workshop: getAdmissionWorkshopName(lead) })),
    "workshop",
    countField
  );
}

function renderBreakdownCell(entries, emptyLabel) {
  if (!entries.length) {
    return `<span class="monitoring-breakdown monitoring-breakdown--empty">${escapeHtml(emptyLabel)}</span>`;
  }

  const preview = entries.slice(0, 2);
  const hiddenCount = Math.max(entries.length - preview.length, 0);
  const previewHtml = preview
    .map((entry) => `<span class="monitoring-breakdown__pill">${escapeHtml(entry.name)} (${entry.count})</span>`)
    .join("");
  const detailHtml = entries
    .map((entry) => `<li>${escapeHtml(entry.name)} <strong>${entry.count}</strong></li>`)
    .join("");

  return `
    <div class="monitoring-breakdown">
      <div class="monitoring-breakdown__preview">${previewHtml}</div>
      ${hiddenCount ? `
        <details class="monitoring-breakdown__details">
          <summary>View ${hiddenCount} more</summary>
          <ul>${detailHtml}</ul>
        </details>
      ` : ""}
    </div>
  `;
}

function sortRowsByPriority(rows) {
  return [...rows].sort((a, b) => {
    if (b.activities !== a.activities) {
      return b.activities - a.activities;
    }
    if (b.freshActivities !== a.freshActivities) {
      return b.freshActivities - a.freshActivities;
    }
    return String(a.counselor).localeCompare(String(b.counselor));
  });
}

function getCounselorBuckets(leads) {
  const names = [...new Set(leads.map((lead) => lead.counselor || "Unassigned"))]
    .filter((name) => String(name || "").trim())
    .sort((a, b) => a.localeCompare(b));

  return names.length ? names : ["Unassigned"];
}

function countNewLeads(rawLeads, range) {
  if (!range) {
    return rawLeads.length;
  }

  const { start, end } = range;
  return rawLeads.filter((lead) => {
    const created = parseLocalDate(lead.createdAt);
    if (!created) {
      return false;
    }
    return created >= start && created <= end;
  }).length;
}

function splitFreshAndOldActivities(activityLeads, countField, range) {
  const totalActivities = activityLeads.reduce((sum, lead) => sum + (Number(lead[countField]) || 0), 0);

  if (!range) {
    return {
      activities: totalActivities,
      freshActivities: totalActivities,
      oldLeadActivities: 0
    };
  }

  const { start } = range;
  const freshActivityLeads = activityLeads.filter((lead) => {
    const created = parseLocalDate(lead.createdAt);
    return created && created >= start;
  });
  const oldActivityLeads = activityLeads.filter((lead) => {
    const created = parseLocalDate(lead.createdAt);
    return created && created < start;
  });

  return {
    activities: totalActivities,
    freshActivities: freshActivityLeads.reduce((sum, lead) => sum + (Number(lead[countField]) || 0), 0),
    oldLeadActivities: oldActivityLeads.reduce((sum, lead) => sum + (Number(lead[countField]) || 0), 0)
  };
}

function formatPercent(count, total) {
  if (!total) {
    return "0%";
  }
  const value = (count / total) * 100;
  return `${value.toFixed(value % 1 === 0 ? 0 : 1)}%`;
}

function getLeadKey(lead) {
  return String(
    lead.id
    || lead.leadId
    || lead.phone
    || lead.phoneNumber
    || lead.email
    || `${lead.name || "lead"}-${lead.createdAt || ""}`
  );
}

function wasLeadCreatedInRange(lead, range) {
  if (!range) {
    return true;
  }
  const created = parseLocalDate(lead.createdAt);
  return Boolean(created && created >= range.start && created <= range.end);
}

function wasLeadCreatedBeforeRange(lead, range) {
  if (!range) {
    return false;
  }
  const created = parseLocalDate(lead.createdAt);
  return Boolean(created && created < range.start);
}

function getPerformanceConfig(subsection) {
  if (subsection === "workshop-performance") {
    return {
      leadFilter: (lead) => !isNonWorkshopPipelineLead(lead) && !isLostLead(lead),
      activityField: "preActivityUpdates",
      dialedField: "dialed",
      callStatusField: "callStatus",
      courseStatusField: "wsStatus",
      admissionStatusField: "",
      statusUpdatedField: ""
    };
  }

  if (subsection === "post-workshop-performance") {
    return {
      leadFilter: (lead) => !isNonWorkshopPipelineLead(lead),
      activityField: "postActivityUpdates",
      dialedField: "postDialed",
      callStatusField: "",
      coursePitchedField: "coursePitched",
      courseStatusField: "courseStatus",
      admissionStatusField: "admissionStatus",
      statusUpdatedField: "postStatusUpdated"
    };
  }

  return {
    leadFilter: isMainAdmissionLead,
    activityField: "mainAdmissionActivityUpdates",
    dialedField: "mainAdmissionDialed",
    callStatusField: "mainAdmissionCallStatus",
    coursePitchedField: "mainAdmissionCoursePitched",
    courseStatusField: "mainAdmissionCourseStatus",
    admissionStatusField: "mainAdmissionAdmissionStatus",
    statusUpdatedField: ""
  };
}

function hasPdeActivity(lead, config) {
  const hasFollowUpActivity = (Number(lead[config.activityField]) || 0) > 0
    || lead[config.dialedField] === "Yes"
    || Boolean(config.callStatusField && lead[config.callStatusField])
    || Boolean(config.statusUpdatedField && lead[config.statusUpdatedField] === true);

  if (config.coursePitchedField) {
    return hasFollowUpActivity || normalizeText(lead[config.coursePitchedField]) === "yes";
  }

  return hasFollowUpActivity;
}

function isInterestedPerformanceLead(lead, config) {
  return normalizeText(lead[config.courseStatusField]) === "interested";
}

function isLostPerformanceLead(lead, config) {
  return normalizeText(lead[config.courseStatusField]) === "not interested"
    || normalizeText(lead.leadStatus) === "lost";
}

function isOpportunityPerformanceLead(lead, config) {
  return Boolean(config.admissionStatusField)
    && normalizeText(lead[config.admissionStatusField]) === "opportunity";
}

function isOfferedPerformanceLead(lead, config) {
  return Boolean(config.admissionStatusField)
    && normalizeText(lead[config.admissionStatusField]) === "offered";
}

function getOpportunityDate(lead) {
  return parseLocalDate(
    lead.opportunityAt
    || lead.opportunityDate
    || lead.admissionStatusUpdatedAt
    || lead.registeredAdmissionStatusUpdatedAt
    || lead.mainAdmissionAdmissionStatusUpdatedAt
    || lead.updatedAt
    || lead.createdAt
  );
}

function getOpportunityAgeDays(lead) {
  const opportunityDate = getOpportunityDate(lead);
  if (!opportunityDate) {
    return null;
  }
  const now = new Date();
  now.setHours(23, 59, 59, 999);
  return Math.max(0, Math.floor((now - opportunityDate) / 86400000));
}

function getPerformanceLeadSet(rawLeads, range, config) {
  const scopedRawLeads = rawLeads.filter(config.leadFilter);
  if (!range) {
    return scopedRawLeads;
  }

  const touchedLeads = applyTimelineFilter(scopedRawLeads);
  const touchedByKey = new Map(touchedLeads.map((lead) => [getLeadKey(lead), lead]));
  const leadSet = new Map();

  scopedRawLeads.forEach((lead) => {
    const key = getLeadKey(lead);
    if (wasLeadCreatedInRange(lead, range)) {
      leadSet.set(key, touchedByKey.get(key) || lead);
      return;
    }
    if (touchedByKey.has(key)) {
      leadSet.set(key, touchedByKey.get(key));
    }
  });

  return Array.from(leadSet.values());
}

function buildPerformanceMetrics(leads, range, config) {
  const totalLeads = leads.length;
  const newLeads = leads.filter((lead) => wasLeadCreatedInRange(lead, range)).length;
  const oldLeads = leads.filter((lead) => wasLeadCreatedBeforeRange(lead, range)).length;
  const pdeLeads = leads.filter((lead) => hasPdeActivity(lead, config));
  const newPde = pdeLeads.filter((lead) => wasLeadCreatedInRange(lead, range)).length;
  const oldPde = pdeLeads.filter((lead) => wasLeadCreatedBeforeRange(lead, range)).length;
  const interested = leads.filter((lead) => isInterestedPerformanceLead(lead, config)).length;
  const lost = leads.filter((lead) => isLostPerformanceLead(lead, config)).length;
  const opportunityLeads = leads.filter((lead) => isOpportunityPerformanceLead(lead, config));
  const offered = leads.filter((lead) => isOfferedPerformanceLead(lead, config)).length;
  const untouched = leads.filter((lead) => !hasPdeActivity(lead, config)).length;
  const opportunityUnder15 = opportunityLeads.filter((lead) => {
    const age = getOpportunityAgeDays(lead);
    return age !== null && age <= 15;
  }).length;
  const opportunityOver15 = opportunityLeads.filter((lead) => {
    const age = getOpportunityAgeDays(lead);
    return age !== null && age > 15;
  }).length;

  return {
    totalLeads,
    newLeads,
    oldLeads,
    newPde,
    oldPde,
    totalPde: pdeLeads.length,
    newPdePercent: formatPercent(newPde, newLeads),
    oldPdePercent: formatPercent(oldPde, oldLeads),
    totalPdePercent: formatPercent(pdeLeads.length, totalLeads),
    interested,
    interestedPercent: formatPercent(interested, totalLeads),
    lost,
    lostPercent: formatPercent(lost, totalLeads),
    opportunity: opportunityLeads.length,
    opportunityPercent: formatPercent(opportunityLeads.length, totalLeads),
    offered,
    offeredPercent: formatPercent(offered, totalLeads),
    untouched,
    untouchedPercent: formatPercent(untouched, totalLeads),
    opportunityUnder15,
    opportunityUnder15Percent: formatPercent(opportunityUnder15, opportunityLeads.length),
    opportunityOver15,
    opportunityOver15Percent: formatPercent(opportunityOver15, opportunityLeads.length)
  };
}

function groupLeadsBy(leads, getKey) {
  const groups = new Map();
  leads.forEach((lead) => {
    const key = String(getKey(lead) || "").trim() || "Unassigned";
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(lead);
  });
  return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
}

function buildPerformanceRows(leads, range, config) {
  const rows = [
    {
      type: "Overall",
      name: "All Leads",
      ...buildPerformanceMetrics(leads, range, config)
    }
  ];

  groupLeadsBy(leads, (lead) => lead.counselor || "Unassigned").forEach(([name, counselorLeads]) => {
    rows.push({
      type: "LCE/Counselor",
      name,
      ...buildPerformanceMetrics(counselorLeads, range, config)
    });
  });

  return rows;
}

function buildWorkshopRows(counselors, leads, rawLeads, range) {
  return sortRowsByPriority(counselors.map((counselor) => {
    const counselorLeads = leads.filter((lead) => (lead.counselor || "Unassigned") === counselor);
    const counselorRawLeads = rawLeads.filter((lead) => (lead.counselor || "Unassigned") === counselor);
    const activityLeads = counselorLeads.filter((lead) => (Number(lead.preActivityUpdates) || 0) > 0);
    const activitySummary = splitFreshAndOldActivities(activityLeads, "preActivityUpdates", range);

    return {
      counselor,
      ...activitySummary,
      workshopEntries: formatBreakdownEntries(activityLeads, "workshop", "preActivityUpdates"),
      interested: activityLeads.filter((lead) => lead.wsStatus === "Interested").length,
      notInterested: activityLeads.filter((lead) => lead.wsStatus === "Not Interested").length,
      whatsappJoined: counselorLeads.filter((lead) => lead.whatsappGroupStatus === "Joined").length,
      newLeads: countNewLeads(counselorRawLeads, range)
    };
  }));
}

function buildPostWorkshopRows(counselors, leads, rawLeads, range) {
  return sortRowsByPriority(counselors.map((counselor) => {
    const counselorLeads = leads.filter((lead) => (lead.counselor || "Unassigned") === counselor);
    const counselorRawLeads = rawLeads.filter((lead) => (lead.counselor || "Unassigned") === counselor);
    const activityLeads = counselorLeads.filter((lead) => (Number(lead.postActivityUpdates) || 0) > 0);
    const activitySummary = splitFreshAndOldActivities(activityLeads, "postActivityUpdates", range);

    return {
      counselor,
      ...activitySummary,
      workshopEntries: formatAdmissionWorkshopBreakdownEntries(activityLeads, "postActivityUpdates"),
      interested: activityLeads.filter((lead) => lead.courseStatus === "Interested").length,
      notInterested: counselorLeads.filter((lead) => lead.courseStatus === "Not Interested").length,
      enrolled: activityLeads.filter((lead) => lead.admissionStatus === "Enrolled").length,
      won: activityLeads.filter((lead) => lead.admissionStatus === "Won").length,
      newLeads: countNewLeads(counselorRawLeads, range)
    };
  }));
}

function buildMainAdmissionRows(counselors, leads, rawLeads, range) {
  return sortRowsByPriority(counselors.map((counselor) => {
    const counselorLeads = leads.filter((lead) => (lead.counselor || "Unassigned") === counselor);
    const counselorRawLeads = rawLeads.filter((lead) => (lead.counselor || "Unassigned") === counselor);
    const activityLeads = counselorLeads.filter((lead) => (Number(lead.mainAdmissionActivityUpdates) || 0) > 0);
    const activitySummary = splitFreshAndOldActivities(activityLeads, "mainAdmissionActivityUpdates", range);

    return {
      counselor,
      ...activitySummary,
      courseEntries: formatBreakdownEntries(activityLeads, "courseName", "mainAdmissionActivityUpdates"),
      interested: activityLeads.filter((lead) => lead.mainAdmissionCourseStatus === "Interested").length,
      notInterested: counselorLeads.filter((lead) => lead.mainAdmissionCourseStatus === "Not Interested").length,
      enrolled: activityLeads.filter((lead) => lead.mainAdmissionAdmissionStatus === "Enrolled").length,
      won: activityLeads.filter((lead) => lead.mainAdmissionAdmissionStatus === "Won").length,
      newLeads: countNewLeads(counselorRawLeads, range)
    };
  }));
}

function buildRegisteredRows(counselors, leads, rawLeads, range) {
  return sortRowsByPriority(counselors.map((counselor) => {
    const counselorLeads = leads.filter((lead) => (lead.counselor || "Unassigned") === counselor);
    const counselorRawLeads = rawLeads.filter((lead) => (lead.counselor || "Unassigned") === counselor);
    const activityLeads = counselorLeads.filter((lead) => (Number(lead.registeredCourseActivityUpdates) || 0) > 0);
    const activitySummary = splitFreshAndOldActivities(activityLeads, "registeredCourseActivityUpdates", range);

    return {
      counselor,
      ...activitySummary,
      courseEntries: formatBreakdownEntries(activityLeads, "courseName", "registeredCourseActivityUpdates"),
      newLeads: countNewLeads(counselorRawLeads, range),
      dialed: activityLeads.filter((lead) => lead.registeredDialed === "Yes").length,
      interested: activityLeads.filter((lead) => lead.registeredCourseStatus === "Interested").length,
      notInterested: counselorLeads.filter((lead) => lead.registeredCourseStatus === "Not Interested").length
    };
  }));
}

function buildMetricCards(metrics) {
  monitoringKpiSection.innerHTML = metrics.map((metric) => `
    <article class="card kpi-card">
      <p>${escapeHtml(metric.label)}</p>
      <h2>${escapeHtml(metric.value)}</h2>
    </article>
  `).join("");
}

function renderTable(columns, rows, emptyColspan, tableClass = "") {
  monitoringActiveTable.innerHTML = `
    <div class="table-scroll">
      <table class="${escapeHtml(tableClass)}">
        <thead>
          <tr>
            ${columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${rows.length
            ? rows.map((row) => `
              <tr>
                ${columns.map((column) => `<td>${column.render(row)}</td>`).join("")}
              </tr>
            `).join("")
            : `<tr><td colspan="${emptyColspan}">No monitoring data available.</td></tr>`
          }
        </tbody>
      </table>
    </div>
  `;
}

function getVisibleTableSnapshot() {
  const table = monitoringActiveTable?.querySelector("table");
  if (!table) {
    return { headers: [], rows: [] };
  }

  const headers = Array.from(table.querySelectorAll("thead th"))
    .map((header) => header.textContent.trim())
    .filter(Boolean);
  const rows = Array.from(table.querySelectorAll("tbody tr")).map((row) =>
    Array.from(row.querySelectorAll("td")).map((cell) => cell.textContent.trim())
  );

  return { headers, rows };
}

function getVisibleKpiSnapshot() {
  return Array.from(monitoringKpiSection.querySelectorAll(".kpi-card")).map((card) => ({
    Metric: card.querySelector("p")?.textContent?.trim() || "",
    Value: card.querySelector("h2")?.textContent?.trim() || ""
  }));
}

function getTimelineLabel() {
  if (timelineFilter.type === "overall") return "Overall";
  if (timelineFilter.type === "today") return "Today";
  if (timelineFilter.type === "week") return "Week";
  if (timelineFilter.type === "recent") return "Last 30 Days";
  if (timelineFilter.type === "custom") {
    if (!timelineFilter.startDate || !timelineFilter.endDate) {
      return "Custom Range";
    }
    return `${timelineFilter.startDate} to ${timelineFilter.endDate}`;
  }
  return "Monitoring Report";
}

function exportMonitoringExcel() {
  if (typeof XLSX === "undefined") {
    setExportMessage("Excel export is unavailable because the spreadsheet library did not load.", true);
    return;
  }

  const workbook = XLSX.utils.book_new();
  const summaryRows = [
    { Metric: "Timeline", Value: getTimelineLabel() },
    { Metric: "Section", Value: getActiveSubsectionConfig().title },
    ...getVisibleKpiSnapshot()
  ];
  const summarySheet = XLSX.utils.json_to_sheet(summaryRows);
  XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");

  const activeTable = getVisibleTableSnapshot();
  const activeSheet = XLSX.utils.aoa_to_sheet([activeTable.headers, ...activeTable.rows]);
  XLSX.utils.book_append_sheet(workbook, activeSheet, "Monitoring");

  const fileName = `monitoring-${activeView.group}-${activeView.subsection}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(workbook, fileName);
  setExportMessage("Excel report exported successfully.", false);
}

function getActiveGroupConfig() {
  return VIEW_CONFIG[activeView.group] || VIEW_CONFIG.workshop;
}

function getActiveSubsectionConfig() {
  return getActiveGroupConfig().subsections[activeView.subsection]
    || VIEW_CONFIG.workshop.subsections["workshop-calling"];
}

function renderSectionNav() {
  if (!monitoringSectionNav) {
    return;
  }

  const groups = Object.entries(VIEW_CONFIG);
  const activeGroup = getActiveGroupConfig();

  monitoringSectionNav.innerHTML = `
    <div class="card-head">
      <h3>Monitoring Sections</h3>
      <p>Switch between the main monitoring groups instead of stacking every report on one page.</p>
    </div>
    <div class="filter-actions" style="display:flex;gap:0.75rem;flex-wrap:wrap;">
      ${groups.map(([groupKey, group]) => `
        <button
          type="button"
          class="${activeView.group === groupKey ? "btn-primary" : "btn-ghost"}"
          data-monitoring-group="${groupKey}"
        >
          ${escapeHtml(group.label)}
        </button>
      `).join("")}
    </div>
    <p class="block-help">${escapeHtml(activeGroup.description)}</p>
  `;

  monitoringSectionNav.querySelectorAll("[data-monitoring-group]").forEach((button) => {
    button.onclick = () => {
      const nextGroup = button.getAttribute("data-monitoring-group");
      if (!nextGroup || nextGroup === activeView.group) {
        return;
      }
      const groupConfig = VIEW_CONFIG[nextGroup];
      const firstSubsection = Object.keys(groupConfig.subsections)[0];
      activeView = {
        group: nextGroup,
        subsection: firstSubsection
      };
      persistActiveView();
      renderAll();
    };
  });
}

function renderSubsectionNav() {
  if (!monitoringSubsectionNav) {
    return;
  }

  const activeGroup = getActiveGroupConfig();
  const activeSubsection = getActiveSubsectionConfig();
  const subsections = Object.entries(activeGroup.subsections);

  monitoringSubsectionNav.innerHTML = `
    <div class="card-head">
      <h3>${escapeHtml(activeGroup.label)} Monitoring Views</h3>
      <p>Open one focused monitoring report at a time so the page stays cleaner and easier to read.</p>
    </div>
    <div class="filter-actions" style="display:flex;gap:0.75rem;flex-wrap:wrap;">
      ${subsections.map(([subsectionKey, subsection]) => `
        <button
          type="button"
          class="${activeView.subsection === subsectionKey ? "btn-primary" : "btn-ghost"}"
          data-monitoring-subsection="${subsectionKey}"
        >
          ${escapeHtml(subsection.label)}
        </button>
      `).join("")}
    </div>
    <p class="block-help">${escapeHtml(activeSubsection.description)}</p>
  `;

  monitoringSubsectionNav.querySelectorAll("[data-monitoring-subsection]").forEach((button) => {
    button.onclick = () => {
      const nextSubsection = button.getAttribute("data-monitoring-subsection");
      if (!nextSubsection || nextSubsection === activeView.subsection) {
        return;
      }
      activeView = {
        ...activeView,
        subsection: nextSubsection
      };
      persistActiveView();
      renderAll();
    };
  });
}

function renderWorkshopCallingView(counselors, leads, rawLeads, range) {
  const rows = buildWorkshopRows(counselors, leads, rawLeads, range);
  const totalActivity = rows.reduce((sum, row) => sum + row.activities, 0);
  const newLeads = rows.reduce((sum, row) => sum + row.newLeads, 0);
  const interested = rows.reduce((sum, row) => sum + row.interested, 0);
  const notInterested = rows.reduce((sum, row) => sum + row.notInterested, 0);
  const whatsappJoined = rows.reduce((sum, row) => sum + row.whatsappJoined, 0);
  const freshActivities = rows.reduce((sum, row) => sum + row.freshActivities, 0);
  const oldLeadActivities = rows.reduce((sum, row) => sum + row.oldLeadActivities, 0);

  buildMetricCards([
    { label: "Overall Activity", value: totalActivity },
    { label: "New Leads Received", value: newLeads },
    { label: "Interested Leads", value: interested },
    { label: "Not Interested Leads", value: notInterested },
    { label: "WhatsApp Group Joined", value: whatsappJoined },
    { label: "Fresh Lead Activities", value: freshActivities },
    { label: "Old Lead Activities", value: oldLeadActivities }
  ]);

  renderTable([
    { label: "Counselor Name", render: (row) => escapeHtml(row.counselor) },
    { label: "Total Activities Completed", render: (row) => String(row.activities) },
    { label: "Workshop-wise Activity Breakdown", render: (row) => renderBreakdownCell(row.workshopEntries, "No workshop activity") },
    { label: "Interested Leads", render: (row) => String(row.interested) },
    { label: "Not Interested Leads", render: (row) => String(row.notInterested) },
    { label: "WhatsApp Group Joined", render: (row) => String(row.whatsappJoined) },
    { label: "New Leads Received", render: (row) => String(row.newLeads) },
    { label: "Fresh Lead Activities", render: (row) => String(row.freshActivities) },
    { label: "Old Lead Activities", render: (row) => String(row.oldLeadActivities) }
  ], rows, 9);
}

function renderAdmissionCallingView(counselors, leads, rawLeads, range) {
  const rows = buildPostWorkshopRows(counselors, leads, rawLeads, range);
  const totalActivity = rows.reduce((sum, row) => sum + row.activities, 0);
  const newLeads = rows.reduce((sum, row) => sum + row.newLeads, 0);
  const interested = rows.reduce((sum, row) => sum + row.interested, 0);
  const notInterested = rows.reduce((sum, row) => sum + row.notInterested, 0);
  const enrolled = rows.reduce((sum, row) => sum + row.enrolled, 0);
  const won = rows.reduce((sum, row) => sum + row.won, 0);
  const freshActivities = rows.reduce((sum, row) => sum + row.freshActivities, 0);
  const oldLeadActivities = rows.reduce((sum, row) => sum + row.oldLeadActivities, 0);

  buildMetricCards([
    { label: "Overall Activity", value: totalActivity },
    { label: "New Leads Received", value: newLeads },
    { label: "Interested Leads", value: interested },
    { label: "Not Interested Leads", value: notInterested },
    { label: "Enrolled", value: enrolled },
    { label: "Won", value: won },
    { label: "Fresh Lead Activities", value: freshActivities },
    { label: "Old Lead Activities", value: oldLeadActivities }
  ]);

  renderTable([
    { label: "Counselor Name", render: (row) => escapeHtml(row.counselor) },
    { label: "Total Activities Completed", render: (row) => String(row.activities) },
    { label: "Workshop-wise Activity Breakdown", render: (row) => renderBreakdownCell(row.workshopEntries, "No workshop activity") },
    { label: "Interested Leads", render: (row) => String(row.interested) },
    { label: "Not Interested Leads", render: (row) => String(row.notInterested) },
    { label: "Enrolled", render: (row) => String(row.enrolled) },
    { label: "Won", render: (row) => String(row.won) },
    { label: "New Leads Received", render: (row) => String(row.newLeads) },
    { label: "Fresh Lead Activities", render: (row) => String(row.freshActivities) },
    { label: "Old Lead Activities", render: (row) => String(row.oldLeadActivities) }
  ], rows, 10);
}

function renderMainAdmissionView(counselors, leads, rawLeads, range) {
  const rows = buildMainAdmissionRows(counselors, leads, rawLeads, range);
  const totalActivity = rows.reduce((sum, row) => sum + row.activities, 0);
  const newLeads = rows.reduce((sum, row) => sum + row.newLeads, 0);
  const interested = rows.reduce((sum, row) => sum + row.interested, 0);
  const notInterested = rows.reduce((sum, row) => sum + row.notInterested, 0);
  const enrolled = rows.reduce((sum, row) => sum + row.enrolled, 0);
  const won = rows.reduce((sum, row) => sum + row.won, 0);
  const freshActivities = rows.reduce((sum, row) => sum + row.freshActivities, 0);
  const oldLeadActivities = rows.reduce((sum, row) => sum + row.oldLeadActivities, 0);

  buildMetricCards([
    { label: "Overall Activity", value: totalActivity },
    { label: "New Leads Received", value: newLeads },
    { label: "Interested Leads", value: interested },
    { label: "Not Interested Leads", value: notInterested },
    { label: "Enrolled", value: enrolled },
    { label: "Won", value: won },
    { label: "Fresh Lead Activities", value: freshActivities },
    { label: "Old Lead Activities", value: oldLeadActivities }
  ]);

  renderTable([
    { label: "Counselor Name", render: (row) => escapeHtml(row.counselor) },
    { label: "Total Activities Completed", render: (row) => String(row.activities) },
    { label: "Course-wise Activity Breakdown", render: (row) => renderBreakdownCell(row.courseEntries, "No course activity") },
    { label: "Interested Leads", render: (row) => String(row.interested) },
    { label: "Not Interested Leads", render: (row) => String(row.notInterested) },
    { label: "Enrolled", render: (row) => String(row.enrolled) },
    { label: "Won", render: (row) => String(row.won) },
    { label: "New Leads Received", render: (row) => String(row.newLeads) },
    { label: "Fresh Lead Activities", render: (row) => String(row.freshActivities) },
    { label: "Old Lead Activities", render: (row) => String(row.oldLeadActivities) }
  ], rows, 10);
}

function renderRegisteredView(counselors, leads, rawLeads, range) {
  const rows = buildRegisteredRows(counselors, leads, rawLeads, range);
  const totalActivity = rows.reduce((sum, row) => sum + row.activities, 0);
  const newLeads = rows.reduce((sum, row) => sum + row.newLeads, 0);
  const dialed = rows.reduce((sum, row) => sum + row.dialed, 0);
  const interested = rows.reduce((sum, row) => sum + row.interested, 0);
  const notInterested = rows.reduce((sum, row) => sum + row.notInterested, 0);
  const freshActivities = rows.reduce((sum, row) => sum + row.freshActivities, 0);
  const oldLeadActivities = rows.reduce((sum, row) => sum + row.oldLeadActivities, 0);

  buildMetricCards([
    { label: "Overall Activity", value: totalActivity },
    { label: "Fresh Leads Received", value: newLeads },
    { label: "Dialed Leads", value: dialed },
    { label: "Interested Leads", value: interested },
    { label: "Not Interested Leads", value: notInterested },
    { label: "Fresh Lead Activities", value: freshActivities },
    { label: "Old Lead Activities", value: oldLeadActivities }
  ]);

  renderTable([
    { label: "Counselor Name", render: (row) => escapeHtml(row.counselor) },
    { label: "Overall Activity", render: (row) => String(row.activities) },
    { label: "Course-wise Activity Breakdown", render: (row) => renderBreakdownCell(row.courseEntries, "No course activity") },
    { label: "Fresh Leads Received", render: (row) => String(row.newLeads) },
    { label: "Fresh Lead Activities", render: (row) => String(row.freshActivities) },
    { label: "Old Lead Activities", render: (row) => String(row.oldLeadActivities) },
    { label: "Dialed Leads", render: (row) => String(row.dialed) },
    { label: "Interested Leads", render: (row) => String(row.interested) },
    { label: "Not Interested Leads", render: (row) => String(row.notInterested) }
  ], rows, 9);
}

function getPercentNumber(value) {
  return Number(String(value || "0").replace("%", "")) || 0;
}

function getPerformanceTopRows(rows, metricKey, sortDirection = "desc") {
  const counselorRows = rows.filter((row) => row.type === "LCE/Counselor");
  return [...counselorRows]
    .sort((a, b) => {
      const left = getPercentNumber(a[metricKey]);
      const right = getPercentNumber(b[metricKey]);
      return sortDirection === "asc" ? left - right : right - left;
    })
    .slice(0, 5);
}

function renderPerformanceMetric(count, percent) {
  return `
    <span class="performance-cell-metric">
      <strong>${count}</strong>
      <span>${escapeHtml(percent)}</span>
    </span>
  `;
}

function getTrendKey(date, mode) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  if (mode === "date") {
    return `${year}-${month}-${day}`;
  }
  if (mode === "week") {
    const firstDay = new Date(date);
    firstDay.setDate(date.getDate() - date.getDay());
    return `${firstDay.getFullYear()}-W${String(Math.ceil((((firstDay - new Date(firstDay.getFullYear(), 0, 1)) / 86400000) + 1) / 7)).padStart(2, "0")}`;
  }
  if (mode === "month") {
    return `${year}-${month}`;
  }
  if (mode === "quarter") {
    return `${year}-Q${Math.floor(date.getMonth() / 3) + 1}`;
  }
  return String(year);
}

function buildTrendRows(leads, mode, config) {
  const buckets = new Map();
  leads.forEach((lead) => {
    const created = parseLocalDate(lead.createdAt);
    if (!created) {
      return;
    }
    const key = getTrendKey(created, mode);
    if (!buckets.has(key)) {
      buckets.set(key, {
        label: key,
        total: 0,
        opportunity: 0,
        offered: 0,
        lost: 0
      });
    }
    const bucket = buckets.get(key);
    bucket.total += 1;
    bucket.opportunity += isOpportunityPerformanceLead(lead, config) ? 1 : 0;
    bucket.offered += isOfferedPerformanceLead(lead, config) ? 1 : 0;
    bucket.lost += isLostPerformanceLead(lead, config) ? 1 : 0;
  });

  return Array.from(buckets.values()).sort((a, b) => a.label.localeCompare(b.label)).slice(-8);
}

function renderMiniBar(value, maxValue) {
  const width = maxValue ? Math.max(4, Math.round((value / maxValue) * 100)) : 0;
  return `
    <span class="performance-bar" aria-hidden="true">
      <span style="width:${width}%"></span>
    </span>
    <strong>${value}</strong>
  `;
}

function renderTopPerformancePanel(rows) {
  const panels = [
    { label: "Top PDE %", rows: getPerformanceTopRows(rows, "totalPdePercent").filter((row) => getPercentNumber(row.totalPdePercent) > 0), metric: "totalPdePercent" },
    { label: "Top Opportunity %", rows: getPerformanceTopRows(rows, "opportunityPercent").filter((row) => getPercentNumber(row.opportunityPercent) > 0), metric: "opportunityPercent" },
    { label: "Top Offered %", rows: getPerformanceTopRows(rows, "offeredPercent").filter((row) => getPercentNumber(row.offeredPercent) > 0), metric: "offeredPercent" },
    { label: "Lowest Lost %", rows: getPerformanceTopRows(rows, "lostPercent", "asc"), metric: "lostPercent" }
  ];

  return `
    <section class="performance-summary-grid">
      ${panels.map((panel) => `
        <article class="performance-summary-card">
          <h4>${escapeHtml(panel.label)}</h4>
          ${panel.rows.length ? `
            <ol>
              ${panel.rows.map((row) => `
                <li>
                  <span>${escapeHtml(row.name)}</span>
                  <strong>${escapeHtml(row[panel.metric])}</strong>
                </li>
              `).join("")}
            </ol>
          ` : `<p class="block-help">No movement yet.</p>`}
        </article>
      `).join("")}
    </section>
  `;
}

function renderTrendPanel(leads, config) {
  const modes = [
    ["date", "Date"],
    ["week", "Week"],
    ["month", "Month"],
    ["quarter", "Quarter"],
    ["year", "Year"]
  ];

  return `
    <section class="performance-trend-stack">
      ${modes.map(([mode, label]) => {
        const trendRows = buildTrendRows(leads, mode, config);
        const maxValue = Math.max(0, ...trendRows.flatMap((row) => [row.total, row.opportunity, row.offered, row.lost]));
        return `
          <article class="performance-trend-card">
            <div class="card-head">
              <h4>${escapeHtml(label)} Trend</h4>
              <p>Overall, opportunity, offered, and lost leads.</p>
            </div>
            <div class="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>${escapeHtml(label)}</th>
                    <th>Total</th>
                    <th>Opportunity</th>
                    <th>Offered</th>
                    <th>Lost</th>
                  </tr>
                </thead>
                <tbody>
                  ${trendRows.length ? trendRows.map((row) => `
                    <tr>
                      <td>${escapeHtml(row.label)}</td>
                      <td>${renderMiniBar(row.total, maxValue)}</td>
                      <td>${renderMiniBar(row.opportunity, maxValue)}</td>
                      <td>${renderMiniBar(row.offered, maxValue)}</td>
                      <td>${renderMiniBar(row.lost, maxValue)}</td>
                    </tr>
                  `).join("") : `<tr><td colspan="5">No trend data available.</td></tr>`}
                </tbody>
              </table>
            </div>
          </article>
        `;
      }).join("")}
    </section>
  `;
}

function renderPerformanceTrackingView(rawLeads, range) {
  const config = getPerformanceConfig(activeView.subsection);
  const leads = getPerformanceLeadSet(rawLeads, range, config);
  const rows = buildPerformanceRows(leads, range, config);
  const overall = buildPerformanceMetrics(leads, range, config);

  buildMetricCards([
    { label: "Total Leads", value: overall.totalLeads },
    { label: "New Leads", value: overall.newLeads },
    { label: "Old Leads", value: overall.oldLeads },
    { label: "Total Leads PDE %", value: overall.totalPdePercent },
    { label: "Interested %", value: overall.interestedPercent },
    { label: "Opportunity %", value: overall.opportunityPercent },
    { label: "Offered %", value: overall.offeredPercent },
    { label: "Untouched %", value: overall.untouchedPercent }
  ]);

  const columns = [
    { label: "Level", render: (row) => escapeHtml(row.type) },
    { label: "Counselor", render: (row) => escapeHtml(row.name) },
    { label: "Total", render: (row) => String(row.totalLeads) },
    { label: "New", render: (row) => String(row.newLeads) },
    { label: "Old", render: (row) => String(row.oldLeads) },
    { label: "New PDE", render: (row) => String(row.newPde) },
    { label: "Old PDE", render: (row) => String(row.oldPde) },
    { label: "New PDE %", render: (row) => escapeHtml(row.newPdePercent) },
    { label: "Old PDE %", render: (row) => escapeHtml(row.oldPdePercent) },
    { label: "PDE %", render: (row) => escapeHtml(row.totalPdePercent) },
    { label: "Interested", render: (row) => renderPerformanceMetric(row.interested, row.interestedPercent) },
    { label: "Lost", render: (row) => renderPerformanceMetric(row.lost, row.lostPercent) },
    { label: "Opportunity", render: (row) => renderPerformanceMetric(row.opportunity, row.opportunityPercent) },
    { label: "Offered", render: (row) => renderPerformanceMetric(row.offered, row.offeredPercent) },
    { label: "Untouched", render: (row) => renderPerformanceMetric(row.untouched, row.untouchedPercent) },
    { label: "Opp <=15d", render: (row) => renderPerformanceMetric(row.opportunityUnder15, row.opportunityUnder15Percent) },
    { label: "Opp >15d", render: (row) => renderPerformanceMetric(row.opportunityOver15, row.opportunityOver15Percent) }
  ];

  renderTable(columns, rows, columns.length, "performance-table");
  monitoringActiveTable.insertAdjacentHTML(
    "beforeend",
    `${renderTopPerformancePanel(rows)}${renderTrendPanel(leads, config)}`
  );
}

function renderActiveMonitoringView() {
  const range = getTimelineRange();
  const rawAllLeads = getScopedLeads(getAllLeads());
  const timelineLeads = getScopedLeads(applyTimelineFilter(getAllLeads()));
  const legacyNonMainAdmissionRawLeads = rawAllLeads.filter((lead) => !isMainAdmissionLead(lead));
  const legacyNonMainAdmissionTimelineLeads = timelineLeads.filter((lead) => !isMainAdmissionLead(lead));
  const subsectionConfig = getActiveSubsectionConfig();

  monitoringActiveTitle.textContent = subsectionConfig.title;
  monitoringActiveDescription.textContent = subsectionConfig.description;

  if (activeView.subsection === "workshop-calling") {
    const leads = legacyNonMainAdmissionTimelineLeads.filter((lead) => !isNonWorkshopPipelineLead(lead) && !isLostLead(lead));
    const rawLeads = legacyNonMainAdmissionRawLeads.filter((lead) => !isNonWorkshopPipelineLead(lead) && !isLostLead(lead));
    const counselors = getCounselorBuckets(leads);
    renderWorkshopCallingView(counselors, leads, rawLeads, range);
    return;
  }

  if (activeView.subsection === "admission-calling") {
    const leads = legacyNonMainAdmissionTimelineLeads.filter((lead) => !isNonWorkshopPipelineLead(lead));
    const rawLeads = legacyNonMainAdmissionRawLeads.filter((lead) => !isNonWorkshopPipelineLead(lead));
    const counselors = getCounselorBuckets(leads);
    renderAdmissionCallingView(counselors, leads, rawLeads, range);
    return;
  }

  if (activeView.subsection === "main-admission") {
    const leads = timelineLeads.filter(isMainAdmissionLead);
    const rawLeads = rawAllLeads.filter(isMainAdmissionLead);
    const counselors = getCounselorBuckets(leads);
    renderMainAdmissionView(counselors, leads, rawLeads, range);
    return;
  }

  if (activeView.subsection === "registered-candidates") {
    const leads = timelineLeads.filter(isStandardRegisteredLead);
    const rawLeads = rawAllLeads.filter(isStandardRegisteredLead);
    const counselors = getCounselorBuckets(leads);
    renderRegisteredView(counselors, leads, rawLeads, range);
    return;
  }

  if (activeView.group === "performance") {
    renderPerformanceTrackingView(rawAllLeads, range);
    return;
  }

  const leads = timelineLeads.filter(isCrashCourseRegistrationLead);
  const rawLeads = rawAllLeads.filter(isCrashCourseRegistrationLead);
  const counselors = getCounselorBuckets(leads);
  renderRegisteredView(counselors, leads, rawLeads, range);
}

function ensureValidActiveView() {
  if (!VIEW_CONFIG[activeView.group]) {
    activeView.group = "workshop";
  }

  if (!VIEW_CONFIG[activeView.group].subsections[activeView.subsection]) {
    activeView.subsection = Object.keys(VIEW_CONFIG[activeView.group].subsections)[0];
  }
}

function renderAll() {
  ensureValidActiveView();
  renderSectionNav();
  renderSubsectionNav();
  renderActiveMonitoringView();

  if (exportMonitoringBtn) {
    exportMonitoringBtn.onclick = () => {
      exportMonitoringExcel();
    };
  }
}

bindTimelineControls();
renderAll();
const stopStatePolling = startStatePolling(() => {
  renderAll();
});
registerPageCleanup(stopStatePolling);
