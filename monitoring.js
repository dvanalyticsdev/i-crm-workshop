import { registerPageCleanup } from "./page-runtime.js";
import {
  bootstrapLocalState,
  getSession,
  loadLocalPreference,
  saveLocalPreference
} from "./state-sync.js";
import { apiUrl } from "./api-client.js";
import { formatKolkataDate, getKolkataDayRange, parseKolkataDate as parseLocalDate, toKolkataDateKey } from "./date-utils.js";
import { isCounselorActivityEntry } from "./counselor-activity-filter.js";

await bootstrapLocalState({ skipStateRefresh: true });

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
let monitoringKpiRenderToken = 0;
let monitoringLeads = [];
let monitoringCounselors = [];
let monitoringReport = null;

const TIMELINE_STORAGE_KEY = "dvWorkshopMonitoringTimeline";
const VIEW_STORAGE_KEY = "dvMonitoringActiveView";
const CRASH_SEGMENT = "crash-course";
const MONITORING_ACTIVITY_HISTORY_FIELDS = [
  "workshopActivityHistory",
  "admissionActivityHistory",
  "registeredCourseActivityHistory",
  "mainAdmissionActivityHistory"
];
const MONITORING_COUNTER_LABEL = "Total Leads Touched";
const ADMIN_MONITORING_GROUP = "admin";
const ADMIN_MONITORING_SUBSECTIONS = new Set(["reporting", "lead-assignment"]);
const REPORTING_BUCKETS = ["Enrolled", "PDE", "CNC", "CBL", "NI", "Pending Leads"];
const ASSIGNMENT_COURSE_COLUMNS = [
  {
    key: "apids",
    label: "APIDS",
    patterns: [/apids/i, /industrial\s+data\s+science/i]
  },
  {
    key: "apida",
    label: "APIDA",
    patterns: [/apida/i, /industrial\s+data\s+analytics/i]
  },
  {
    key: "da",
    label: "DA",
    patterns: [/^da$/i, /\bdas\b/i, /data\s+analytics\s+specialist/i]
  },
  {
    key: "aiml",
    label: "AIML",
    patterns: [/\baiml\b/i, /advanced\s+aiml/i]
  },
  {
    key: "days7Genai",
    label: "7 DAYS GEN AI & AGENTIC AI",
    patterns: [/7\s*days/i, /7days/i, /days7/i, /hands[-\s]*on\s+master/i]
  },
  {
    key: "genai",
    label: "GEN AI",
    patterns: [/genai\s*master/i, /gen\s*ai\s*master/i, /master\s+program\s+in\s+gen\s*ai/i, /generative\s+ai/i]
  },
  {
    key: "cyberSecurity",
    label: "CYBER SECURITY",
    patterns: [/cyber/i, /forensics/i, /\bapcs\b/i]
  }
];
const MONITORING_ACTIVITY_OPTIONS = {
  workshopActivityHistory: {
    activityFields: ["dialed", "callStatus", "wsStatus"],
    excludedFields: ["whatsappInvite", "whatsappGroupStatus"]
  },
  admissionActivityHistory: {
    activityFields: ["postDialed", "coursePitched", "courseStatus", "admissionStatus", "postCallStatus", "workshopJoiningStatus"]
  },
  mainAdmissionActivityHistory: {
    activityFields: ["mainAdmissionDialed", "mainAdmissionCoursePitched", "mainAdmissionCourseStatus", "mainAdmissionAdmissionStatus", "mainAdmissionCallStatus"]
  },
  registeredCourseActivityHistory: {
    activityFields: ["registeredDialed", "registeredCoursePitched", "registeredCourseStatus", "registeredAdmissionStatus", "registeredCallStatus"]
  }
};

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
  mcube: {
    label: "MCube",
    description: "Monitor MCube calling volume, connection outcomes, and total talk time across the CRM.",
    subsections: {
      "mcube-main": {
        label: "MCube",
        title: "MCube Monitoring",
        description: "Track total calls, inbound and outbound volume, lead-picked calls, not connected calls, and talk time."
      }
    }
  },
  [ADMIN_MONITORING_GROUP]: {
    label: "Management Reports",
    adminOnly: true,
    description: "Review Main Admission reporting buckets and course-wise lead assignment counts.",
    subsections: {
      reporting: {
        label: "Reporting",
        title: "Reporting",
        description: "Track Main Admission Enrolled, PDE, CNC, CBL, NI, and untouched pending leads by counselor."
      },
      "lead-assignment": {
        label: "Lead Assignment Panel",
        title: "Lead Assignment Panel",
        description: "Review Main Admission counselor-wise lead assignment counts by course."
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

let counselorDirectoryCacheKey = "";
let counselorDirectoryCache = {
  aliasToName: new Map(),
  names: []
};
const mcubeRecordingDurationCache = new Map();
const mcubeRecordingDurationInflight = new Map();
const COUNSELOR_ALIAS_STOP_WORDS = new Set([
  "mr",
  "mrs",
  "ms",
  "miss",
  "dr",
  "md",
  "mohd",
  "mohammed",
  "mohammad",
  "muhammad",
  "ur"
]);

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

function normalizeCounselorAliasKey(value) {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getCounselorAliasTokens(value) {
  return normalizeCounselorAliasKey(value).split(" ").filter(Boolean);
}

function getCounselorAliasKeys(value) {
  const normalized = normalizeCounselorAliasKey(value);
  if (!normalized) {
    return [];
  }

  const tokens = getCounselorAliasTokens(value);
  const filteredTokens = tokens.filter((token) => !COUNSELOR_ALIAS_STOP_WORDS.has(token));
  const keys = new Set([normalized]);

  if (filteredTokens.length) {
    keys.add(filteredTokens.join(" "));
  }

  if (tokens.length >= 2) {
    keys.add(`${tokens[0]} ${tokens[tokens.length - 1]}`);
  }

  if (filteredTokens.length >= 2) {
    keys.add(`${filteredTokens[0]} ${filteredTokens[filteredTokens.length - 1]}`);
  }

  return [...keys].filter(Boolean);
}

function getCounselorFirstName(value) {
  const parts = String(value || "").trim().split(/\s+/).filter(Boolean);
  return normalizeText(parts[0] || "");
}

function getCounselorDirectory() {
  const counselors = monitoringCounselors;
  const cacheKey = JSON.stringify(
    counselors.map((item) => ({
      name: String(item?.name || "").trim(),
      email: String(item?.email || "").trim().toLowerCase()
    }))
  );

  if (cacheKey === counselorDirectoryCacheKey) {
    return counselorDirectoryCache;
  }

  const aliasToName = new Map();
  const aliasCandidates = new Map();
  const names = [];
  const firstNameToNames = new Map();

  const registerAliasCandidate = (alias, name) => {
    const key = normalizeCounselorAliasKey(alias);
    if (!key || !name) {
      return;
    }

    const candidates = aliasCandidates.get(key) || new Set();
    candidates.add(name);
    aliasCandidates.set(key, candidates);
  };

  counselors.forEach((item) => {
    const name = String(item?.name || "").trim();
    const email = String(item?.email || "").trim().toLowerCase();
    const explicitAliases = [
      ...(Array.isArray(item?.aliases) ? item.aliases : []),
      ...(String(item?.alias || "").split(","))
    ]
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    if (name) {
      names.push(name);
      getCounselorAliasKeys(name).forEach((alias) => registerAliasCandidate(alias, name));
      const firstName = getCounselorFirstName(name);
      if (firstName) {
        const current = firstNameToNames.get(firstName) || new Set();
        current.add(name);
        firstNameToNames.set(firstName, current);
      }
    }
    if (email && name) {
      registerAliasCandidate(email, name);
    }
    explicitAliases.forEach((alias) => {
      getCounselorAliasKeys(alias).forEach((key) => registerAliasCandidate(key, name));
    });
  });

  aliasCandidates.forEach((matchedNames, alias) => {
    if (matchedNames.size === 1) {
      aliasToName.set(alias, [...matchedNames][0]);
    }
  });

  firstNameToNames.forEach((matchedNames, firstName) => {
    if (matchedNames.size === 1 && !aliasToName.has(firstName)) {
      aliasToName.set(firstName, [...matchedNames][0]);
    }
  });

  counselorDirectoryCacheKey = cacheKey;
  counselorDirectoryCache = {
    aliasToName,
    names: [...new Set(names)].sort((left, right) => left.localeCompare(right))
  };
  return counselorDirectoryCache;
}

function resolveCounselorName(value, allowRaw = false) {
  const rawValue = String(value || "").trim();
  if (!rawValue) {
    return "";
  }

  const { aliasToName } = getCounselorDirectory();
  const aliasMatch = getCounselorAliasKeys(rawValue)
    .map((alias) => aliasToName.get(alias))
    .find(Boolean);
  if (aliasMatch) {
    return aliasMatch;
  }

  const emailMatch = aliasToName.get(normalizeText(rawValue));
  return emailMatch || (allowRaw ? rawValue : "");
}

function resolveCounselorActivityActor(value) {
  return resolveCounselorName(value);
}

function isCounselorSession() {
  return session?.role === "counselor";
}

function isAdminSession() {
  return session?.role === "admin" || session?.role === "super_admin";
}

function isAdminMonitoringView() {
  return activeView.group === ADMIN_MONITORING_GROUP
    || ADMIN_MONITORING_SUBSECTIONS.has(activeView.subsection);
}

function getCounselorIdentity() {
  if (!isCounselorSession()) {
    return "";
  }

  const sessionName = String(session?.name || "").trim().toLowerCase();
  const sessionEmail = String(session?.email || "").trim().toLowerCase();
  const counselors = monitoringCounselors;
  const match = counselors.find(
    (item) => String(item.email || "").trim().toLowerCase() === sessionEmail
  );

  return normalizeText(resolveCounselorName(match?.name || session?.name || sessionEmail, true)) || sessionName;
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

  return allLeads.filter((lead) =>
    String(lead.counselor || "").trim().toLowerCase() === counselorName
    || MONITORING_ACTIVITY_HISTORY_FIELDS.some((historyField) =>
      Array.isArray(lead?.[historyField])
      && lead[historyField].some((entry) => resolveCounselorActivityActor(entry?.by).toLowerCase() === counselorName)
    )
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
    lead.createdAt = lead.createdAt || toKolkataDateKey();
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
  const leads = Array.isArray(monitoringLeads) ? monitoringLeads : [];
  normalizeLeadFields(leads);
  return leads;
}

async function loadMonitoringData() {
  if (!isAdminMonitoringView()) {
    const reportUrl = new URL(apiUrl("/api/monitoring-report"), window.location.origin);
    reportUrl.searchParams.set("subsection", activeView.subsection);
    reportUrl.searchParams.set("timelineType", timelineFilter.type || "week");
    if (timelineFilter.startDate) reportUrl.searchParams.set("startDate", timelineFilter.startDate);
    if (timelineFilter.endDate) reportUrl.searchParams.set("endDate", timelineFilter.endDate);
    try {
      const response = await fetch(reportUrl.toString(), {
        credentials: "same-origin",
        headers: { Accept: "application/json" }
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.message || "Failed to load monitoring report.");
      }
      monitoringReport = payload;
      monitoringLeads = [];
      monitoringCounselors = [];
      return;
    } catch (error) {
      console.warn("[monitoring] server report failed, falling back to client calculations:", error?.message || error);
      monitoringReport = null;
    }
  } else {
    monitoringReport = null;
  }

  const leadsPath = isAdminMonitoringView()
    ? "/api/leads?scope=assigned-or-touched"
    : `/api/leads?scope=assigned-or-touched&monitoringSubsection=${encodeURIComponent(activeView.subsection)}`;
  const [leadResponse, counselorResponse] = await Promise.all([
    fetch(apiUrl(leadsPath), {
      credentials: "same-origin",
      headers: { Accept: "application/json" }
    }),
    fetch(apiUrl("/api/counselors"), {
      credentials: "same-origin",
      headers: { Accept: "application/json" }
    })
  ]);
  const [leadPayload, counselorPayload] = await Promise.all([
    leadResponse.json().catch(() => []),
    counselorResponse.json().catch(() => [])
  ]);
  if (!leadResponse.ok) {
    throw new Error(leadPayload?.message || "Failed to load monitoring leads.");
  }
  if (!counselorResponse.ok) {
    throw new Error(counselorPayload?.message || "Failed to load monitoring counselors.");
  }
  monitoringLeads = Array.isArray(leadPayload) ? leadPayload : [];
  monitoringCounselors = Array.isArray(counselorPayload) ? counselorPayload : [];
  counselorDirectoryCacheKey = "";
  normalizeLeadFields(monitoringLeads);
}

function startMonitoringPolling(onRefresh, intervalMs = 15000) {
  let destroyed = false;
  let activePoll = false;
  async function poll() {
    if (destroyed || activePoll || document.visibilityState === "hidden") return;
    activePoll = true;
    try {
      await loadMonitoringData();
      await onRefresh();
    } catch (error) {
      console.warn("[monitoring] polling failed:", error?.message || error);
    } finally {
      activePoll = false;
    }
  }
  const timer = window.setInterval(() => {
    void poll();
  }, intervalMs);
  const onVisible = () => {
    if (document.visibilityState === "visible") void poll();
  };
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    destroyed = true;
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisible);
  };
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

  if (timelineFilter.type === "today") {
    const { start, end } = getKolkataDayRange(0);
    return { start, end };
  }

  if (timelineFilter.type === "yesterday") {
    const { start, end } = getKolkataDayRange(-1);
    return { start, end };
  }

  if (timelineFilter.type === "week") {
    const { start } = getKolkataDayRange(-6);
    const { end } = getKolkataDayRange(0);
    return { start, end };
  }

  if (timelineFilter.type === "recent") {
    const { start } = getKolkataDayRange(-29);
    const { end } = getKolkataDayRange(0);
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
    const end = parseLocalDate(timelineFilter.endDate);
    if (!end) {
      return null;
    }
    return {
      start,
      end: new Date(`${toKolkataDateKey(end)}T23:59:59.999+05:30`)
    };
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
    void loadMonitoringData().finally(() => renderAll());
  };

  monitoringStartDate.onchange = (event) => {
    timelineFilter.startDate = event.target.value;
    persistTimelineFilter();
    void loadMonitoringData().finally(() => renderAll());
  };

  monitoringEndDate.onchange = (event) => {
    timelineFilter.endDate = event.target.value;
    persistTimelineFilter();
    void loadMonitoringData().finally(() => renderAll());
  };

  resetMonitoringTimeline.onclick = () => {
    timelineFilter = {
      type: "week",
      startDate: "",
      endDate: ""
    };
    persistTimelineFilter();
    bindTimelineControls();
    void loadMonitoringData().finally(() => renderAll());
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
    counts.set(value, (counts.get(value) || 0) + 1);
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

function formatDerivedBreakdownEntries(items, getLabel, countField = "", emptyLabel = "Unspecified") {
  const counts = new Map();

  items.forEach((item) => {
    const value = String(getLabel(item) || "").trim() || emptyLabel;
    counts.set(value, (counts.get(value) || 0) + 1);
  });

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));
}

function getMainAdmissionBreakdownCourseName(lead) {
  const pitchedCourse = String(lead?.mainAdmissionCoursePitched || "").trim();
  if (pitchedCourse && normalizeText(pitchedCourse) !== "no") {
    return pitchedCourse;
  }

  return String(lead?.courseName || "").trim();
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
    if (b.freshLeadTouches !== a.freshLeadTouches) {
      return b.freshLeadTouches - a.freshLeadTouches;
    }
    return String(a.counselor).localeCompare(String(b.counselor));
  });
}

function getMonitoringCounselorNames(leads = []) {
  const { names } = getCounselorDirectory();
  const fallbackNames = [...new Set(
    leads.flatMap((lead) => [
      resolveCounselorName(lead?.counselor),
      ...MONITORING_ACTIVITY_HISTORY_FIELDS.map((historyField) =>
        Array.isArray(lead?.[historyField])
          ? lead[historyField].map((entry) => resolveCounselorActivityActor(entry?.by))
          : []
      ).flat(),
      ...getHistoryEntriesInRange(lead?.mcubeCallHistory, null).flatMap((entry) => [
        resolveCounselorName(entry?.agentName),
        resolveCounselorName(entry?.counselor)
      ])
    ])
      .flat()
      .filter((name) => name && normalizeText(name) !== "unassigned")
  )].sort((a, b) => a.localeCompare(b));

  if (isCounselorSession()) {
    const counselorName = getCounselorIdentity();
    const matched = [...names, ...fallbackNames].find((name) => normalizeText(name) === counselorName);
    return matched ? [matched] : [];
  }

  const merged = [...new Set([...names, ...fallbackNames])].sort((a, b) => a.localeCompare(b));
  return merged;
}

function getLeadOwnershipDate(lead) {
  return parseLocalDate(
    lead?.leadOwnerTimelineAt
    || lead?.counselorAssignedAt
    || lead?.createdAtExact
    || lead?.createdAt
  );
}

function getMainAdmissionLeadOwnerType(lead = {}) {
  const assignedFromCounselor = String(lead?.assignedFromCounselor || "").trim();
  return normalizeText(lead?.leadOwnerType) === "reassigned"
    || (assignedFromCounselor && normalizeText(assignedFromCounselor) !== "unassigned")
    ? "reassigned"
    : "direct";
}

function getMainAdmissionLeadTimelineDate(lead = {}) {
  const timelineValue = getMainAdmissionLeadOwnerType(lead) === "reassigned"
    ? lead?.leadOwnerTimelineAt
      || lead?.counselorAssignedAt
      || lead?.updatedAt
      || lead?.createdAtExact
      || lead?.createdAt
    : lead?.createdAtExact
      || lead?.createdAt;

  return parseLocalDate(timelineValue);
}

function getManagementReportMainAdmissionLeads(leads = [], range = null) {
  const mainAdmissionLeads = leads.filter(isMainAdmissionLead);
  if (!range) {
    return mainAdmissionLeads;
  }

  return mainAdmissionLeads.filter((lead) => {
    const timelineDate = getMainAdmissionLeadTimelineDate(lead);
    return timelineDate && timelineDate >= range.start && timelineDate <= range.end;
  });
}

function wasLeadCreatedByCounselor(lead, counselor) {
  if (!lead?.leadCreationRequestId && !lead?.requestedBy && !lead?.requestedByEmail) {
    return false;
  }

  const normalizedCounselor = normalizeText(counselor);
  return [lead?.requestedBy, lead?.requestedByEmail]
    .some((value) => normalizeText(resolveCounselorName(value, true)) === normalizedCounselor);
}

function countAssignedLeads(rawLeads, counselor, range = null) {
  const normalizedCounselor = normalizeText(counselor);
  const assignedLeads = rawLeads.filter(
    (lead) =>
      normalizeText(resolveCounselorName(lead?.counselor, true)) === normalizedCounselor &&
      !wasLeadCreatedByCounselor(lead, counselor)
  );

  if (!range) {
    return assignedLeads.length;
  }

  return assignedLeads.filter((lead) => {
    const assignmentDate = getLeadOwnershipDate(lead);
    return assignmentDate && assignmentDate >= range.start && assignmentDate <= range.end;
  }).length;
}

function splitFreshAndOldActivities(activityLeads, countField, range) {
  const totalActivities = activityLeads.length;

  if (!range) {
    return {
      activities: totalActivities,
      freshLeadTouches: activityLeads.length,
      oldLeadTouches: 0
    };
  }

  const { start } = range;
  const freshActivityLeads = activityLeads.filter((lead) => {
    const ownershipDate = getLeadOwnershipDate(lead);
    return ownershipDate && ownershipDate >= start;
  });
  const oldActivityLeads = activityLeads.filter((lead) => {
    const ownershipDate = getLeadOwnershipDate(lead);
    return ownershipDate && ownershipDate < start;
  });

  return {
    activities: totalActivities,
    freshLeadTouches: freshActivityLeads.length,
    oldLeadTouches: oldActivityLeads.length
  };
}

function getHistoryEntriesInRange(history, range) {
  const entries = Array.isArray(history) ? history : [];
  if (!range) {
    return entries;
  }

  return filterHistoryInRange(entries, range.start, range.end);
}

function getMcubeCallEntriesInRange(leads, range) {
  const byKey = new Map();

  leads.forEach((lead) => {
    getHistoryEntriesInRange(lead?.mcubeCallHistory, range).forEach((entry, index) => {
      const leadId = String(lead?.id || "").trim();
      const callId = String(entry?.callId || "").trim();
      const timestamp = String(entry?.at || "").trim();
      const direction = String(entry?.direction || "").trim();
      const status = String(
        entry?.normalizedStatus
        || entry?.disposition
        || entry?.rawStatus
        || entry?.eventType
        || ""
      ).trim();
      const fallbackKey = [
        leadId,
        callId || `history-${index}`,
        timestamp,
        direction,
        status
      ].join("|");
      const entryKey = callId ? `${leadId}|${callId}` : fallbackKey;
      const previous = byKey.get(entryKey);
      const rawFields = entry?.mcubeFields && typeof entry.mcubeFields === "object" ? entry.mcubeFields : {};
      const duration = Math.max(
        normalizeMcubeTalkTimeSeconds(entry?.duration),
        normalizeMcubeTalkTimeSeconds(previous?.duration),
        normalizeMcubeTalkTimeSeconds(rawFields.duration),
        normalizeMcubeTalkTimeSeconds(rawFields.call_duration),
        normalizeMcubeTalkTimeSeconds(rawFields.callDuration),
        normalizeMcubeTalkTimeSeconds(rawFields.talktime),
        normalizeMcubeTalkTimeSeconds(rawFields.talk_time),
        normalizeMcubeTalkTimeSeconds(rawFields.talkTime),
        normalizeMcubeTalkTimeSeconds(rawFields.recording_duration),
        normalizeMcubeTalkTimeSeconds(rawFields.recordingDuration)
      );
      const nextEntry = {
        leadId,
        counselor: String(entry?.counselor || lead?.counselor || "").trim(),
        at: timestamp,
        callId,
        direction,
        normalizedStatus: String(entry?.normalizedStatus || "").trim(),
        disposition: String(entry?.disposition || "").trim(),
        rawStatus: String(entry?.rawStatus || "").trim(),
        eventType: String(entry?.eventType || "").trim(),
        agentName: String(entry?.agentName || "").trim(),
        agentPhone: String(entry?.agentPhone || "").trim(),
        recordingUrl: String(entry?.recordingUrl || "").trim(),
        duration,
        answeredTime: String(entry?.answeredTime || rawFields.answeredtime || rawFields.answered_time || rawFields.answerTime || "").trim(),
        startedAt: String(entry?.startedAt || rawFields.starttime || rawFields.started_at || rawFields.start_time || rawFields.startTime || "").trim(),
        endedAt: String(entry?.endedAt || rawFields.endtime || rawFields.ended_at || rawFields.end_time || rawFields.endTime || "").trim(),
        mcubeFields: rawFields
      };

      if (!previous) {
        byKey.set(entryKey, nextEntry);
        return;
      }

      const previousAt = parseLocalDate(previous.at)?.getTime() || 0;
      const nextAt = parseLocalDate(nextEntry.at)?.getTime() || 0;
      const mergedEntry = {
        leadId: nextEntry.leadId || previous.leadId,
        counselor: nextEntry.counselor || previous.counselor,
        at: nextAt >= previousAt ? (nextEntry.at || previous.at) : (previous.at || nextEntry.at),
        callId: nextEntry.callId || previous.callId,
        direction: nextEntry.direction || previous.direction,
        normalizedStatus: nextEntry.normalizedStatus || previous.normalizedStatus,
        disposition: nextEntry.disposition || previous.disposition,
        rawStatus: nextEntry.rawStatus || previous.rawStatus,
        eventType: nextEntry.eventType || previous.eventType,
        agentName: nextEntry.agentName || previous.agentName,
        agentPhone: nextEntry.agentPhone || previous.agentPhone,
        recordingUrl: nextEntry.recordingUrl || previous.recordingUrl,
        duration,
        answeredTime: nextEntry.answeredTime || previous.answeredTime,
        startedAt: nextEntry.startedAt || previous.startedAt,
        endedAt: nextEntry.endedAt || previous.endedAt,
        mcubeFields: nextEntry.mcubeFields || previous.mcubeFields
      };
      byKey.set(
        entryKey,
        mergedEntry
      );
    });
  });

  return Array.from(byKey.values());
}

function deriveMonitoringMcubeTalkTimeSeconds(entry = {}) {
  const storedDuration = normalizeMcubeTalkTimeSeconds(entry?.duration);
  if (storedDuration > 0) {
    return storedDuration;
  }

  const answeredDuration = normalizeMcubeTalkTimeSeconds(entry?.answeredTime);
  if (answeredDuration > 0) {
    return answeredDuration;
  }

  const startMs = Date.parse(String(entry?.startedAt || "").trim());
  const endMs = Date.parse(String(entry?.endedAt || "").trim());
  if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
    const answeredText = String(entry?.answeredTime || "").trim();
    const offsetMatch = answeredText.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (offsetMatch) {
      const first = Number(offsetMatch[1]);
      const second = Number(offsetMatch[2]);
      const third = Number(offsetMatch[3] || 0);
      const answerOffsetSeconds = offsetMatch[3] ? (first * 3600) + (second * 60) + third : (first * 60) + second;
      return normalizeMcubeTalkTimeSeconds(Math.max(0, Math.round((endMs - startMs) / 1000) - answerOffsetSeconds));
    }

    const answeredMs = Date.parse(answeredText);
    if (Number.isFinite(answeredMs) && endMs > answeredMs) {
      return normalizeMcubeTalkTimeSeconds(Math.round((endMs - answeredMs) / 1000));
    }

    return normalizeMcubeTalkTimeSeconds(Math.round((endMs - startMs) / 1000));
  }

  return 0;
}

function getUsableRecordingUrl(value) {
  const url = String(value || "").trim();
  if (!url) return "";
  if (/^https?:\/\//i.test(url) || url.startsWith("/")) return url;
  return "";
}

function normalizeMcubeTalkTimeSeconds(value) {
  if (value === null || value === undefined || value === "") {
    return 0;
  }

  const numeric = Number(value);
  const seconds = Math.max(0, Number.isFinite(numeric) ? numeric : 0);
  if (!seconds) {
    const text = String(value).trim().toLowerCase();
    const hhmmssMatch = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (hhmmssMatch) {
      const first = Number(hhmmssMatch[1]);
      const second = Number(hhmmssMatch[2]);
      const third = Number(hhmmssMatch[3] || 0);
      const parsed = hhmmssMatch[3] ? (first * 3600) + (second * 60) + third : (first * 60) + second;
      return parsed > 8 * 60 * 60 ? 0 : parsed;
    }

    const compactMatch = text.match(/^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?\s*(?:(\d+)\s*s)?$/);
    if (compactMatch) {
      const hours = Number(compactMatch[1] || 0);
      const minutes = Number(compactMatch[2] || 0);
      const remainingSeconds = Number(compactMatch[3] || 0);
      const parsed = (hours * 3600) + (minutes * 60) + remainingSeconds;
      return parsed > 8 * 60 * 60 ? 0 : parsed;
    }
    return 0;
  }

  // Ignore malformed legacy values that look like timestamps or otherwise impossible call lengths.
  if (seconds > 8 * 60 * 60) {
    return 0;
  }

  return Math.round(seconds);
}

function getMcubeRecordingDurationKey(entry = {}) {
  const callId = String(entry?.callId || "").trim();
  if (callId) {
    return `call:${callId}`;
  }
  const recordingUrl = getUsableRecordingUrl(entry?.recordingUrl);
  if (recordingUrl) {
    return `recording:${recordingUrl}`;
  }
  return "";
}

function getMcubeEntryTalkTimeSeconds(entry = {}) {
  const storedDuration = normalizeMcubeTalkTimeSeconds(entry?.duration);
  if (storedDuration > 0) {
    return storedDuration;
  }

  const cacheKey = getMcubeRecordingDurationKey(entry);
  if (!cacheKey) {
    return deriveMonitoringMcubeTalkTimeSeconds(entry);
  }

  const cachedDuration = normalizeMcubeTalkTimeSeconds(mcubeRecordingDurationCache.get(cacheKey));
  return cachedDuration || deriveMonitoringMcubeTalkTimeSeconds(entry);
}

function primeMcubeRecordingDuration(entry = {}) {
  if (normalizeMcubeTalkTimeSeconds(entry?.duration) > 0) {
    return;
  }

  const recordingUrl = getUsableRecordingUrl(entry?.recordingUrl);
  const cacheKey = getMcubeRecordingDurationKey(entry);
  if (!recordingUrl || !cacheKey || mcubeRecordingDurationCache.has(cacheKey) || mcubeRecordingDurationInflight.has(cacheKey)) {
    return;
  }

  const promise = new Promise((resolve) => {
    const audio = new Audio();
    const finalize = (durationSeconds) => {
      audio.removeAttribute("src");
      audio.load?.();
      mcubeRecordingDurationCache.set(cacheKey, normalizeMcubeTalkTimeSeconds(durationSeconds));
      mcubeRecordingDurationInflight.delete(cacheKey);
      resolve();
      if (activeView?.subsection === "mcube-main") {
        renderAll();
      }
    };

    audio.preload = "metadata";
    audio.addEventListener("loadedmetadata", () => {
      const duration = Math.round(audio.duration || 0);
      finalize(duration);
    }, { once: true });
    audio.addEventListener("error", () => finalize(0), { once: true });
    audio.src = recordingUrl;
  });

  mcubeRecordingDurationInflight.set(cacheKey, promise);
}

function primeMcubeRecordingDurations(entries = []) {
  entries.forEach((entry) => {
    if (didLeadPickMcubeCall(entry)) {
      primeMcubeRecordingDuration(entry);
    }
  });
}

function didLeadPickMcubeCall(entry = {}) {
  const status = normalizeText(
    entry?.normalizedStatus
    || entry?.disposition
    || entry?.rawStatus
    || entry?.eventType
  );

  if (!status) {
    return false;
  }

  return /(answer|answered|connected|completed|success)/i.test(status);
}

function formatTalkTime(totalSeconds) {
  const seconds = normalizeMcubeTalkTimeSeconds(totalSeconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(remainingSeconds).padStart(2, "0")}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${String(remainingSeconds).padStart(2, "0")}s`;
  }
  return `${remainingSeconds}s`;
}

function getCounselorActivityLeadRecords(leads, historyField, counselorName, range) {
  const activityOptions = MONITORING_ACTIVITY_OPTIONS[historyField] || {};
  return leads.reduce((records, lead) => {
    const matchingEntries = getHistoryEntriesInRange(lead?.[historyField], range)
      .filter((entry) =>
        resolveCounselorActivityActor(entry?.by) === counselorName
        && isCounselorActivityEntry(entry, activityOptions)
      );

    if (matchingEntries.length) {
      records.push({
        lead,
        activityCount: 1,
        matchingEntries
      });
    }

    return records;
  }, []);
}

function getLatestHistoryUpdateValue(entries, field) {
  const latestEntry = [...(Array.isArray(entries) ? entries : [])]
    .filter((entry) => entry?.updates && Object.prototype.hasOwnProperty.call(entry.updates, field))
    .sort((left, right) => {
      const leftTime = parseLocalDate(left?.at)?.getTime() || 0;
      const rightTime = parseLocalDate(right?.at)?.getTime() || 0;
      return rightTime - leftTime;
    })[0];

  return String(latestEntry?.updates?.[field] || "").trim();
}

function countLeadsByLatestHistoryUpdate(records, field, expectedValue) {
  const normalizedExpected = normalizeText(expectedValue);
  return records.filter((record) =>
    normalizeText(getLatestHistoryUpdateValue(record.matchingEntries, field)) === normalizedExpected
  ).length;
}

function getLeadKey(lead = {}) {
  return String(lead?.id || lead?._id || lead?.email || lead?.phone || Math.random()).trim();
}

function isFilledCourseValue(value) {
  const normalized = normalizeText(value);
  return Boolean(normalized)
    && normalized !== "no"
    && normalized !== "select"
    && normalized !== "not selected"
    && normalized !== "not specified"
    && normalized !== "na"
    && normalized !== "n/a";
}

function getReportingContexts(lead = {}) {
  return [
    {
      historyField: "mainAdmissionActivityHistory",
      coursePitchedField: "mainAdmissionCoursePitched",
      courseStatusField: "mainAdmissionCourseStatus",
      admissionStatusField: "mainAdmissionAdmissionStatus",
      callStatusField: "mainAdmissionCallStatus"
    }
  ].map((context) => ({
    ...context,
    history: Array.isArray(lead?.[context.historyField]) ? lead[context.historyField] : []
  }));
}

function isAdmissionReportingLead(lead = {}) {
  return isMainAdmissionLead(lead)
    || getReportingContexts(lead).some((context) =>
      context.history.length
      || String(lead?.[context.coursePitchedField] || "").trim()
      || String(lead?.[context.courseStatusField] || "").trim()
      || String(lead?.[context.admissionStatusField] || "").trim()
      || String(lead?.[context.callStatusField] || "").trim()
    );
}

function getReportingEventStatus(field, value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }

  if (field.toLowerCase().includes("admissionstatus") && normalized === "enrolled") {
    return "Enrolled";
  }
  if (field.toLowerCase().includes("callstatus") && normalized === "cnc") {
    return "CNC";
  }
  if (field.toLowerCase().includes("callstatus") && normalized === "cbl") {
    return "CBL";
  }
  if (normalized === "ni" || normalized === "not interested") {
    return "NI";
  }
  return "";
}

function getReportingEventsForLead(lead = {}, range = null) {
  const events = [];

  getReportingContexts(lead).forEach((context) => {
    context.history.forEach((entry) => {
      const eventDate = parseLocalDate(entry?.at);
      if (range && (!eventDate || eventDate < range.start || eventDate > range.end)) {
        return;
      }
      const updates = entry?.updates && typeof entry.updates === "object" ? entry.updates : {};
      Object.entries(updates).forEach(([field, value]) => {
        if (![context.admissionStatusField, context.courseStatusField, context.callStatusField].includes(field)) {
          return;
        }
        const bucket = getReportingEventStatus(field, value);
        if (!bucket) {
          return;
        }
        events.push({
          bucket,
          at: entry?.at || "",
          counselor: resolveCounselorActivityActor(entry?.by)
        });
      });
    });
  });

  return events;
}

function findFirstCoursePitchedEvent(lead = {}) {
  const candidates = [];

  getReportingContexts(lead).forEach((context) => {
    context.history.forEach((entry) => {
      const updates = entry?.updates && typeof entry.updates === "object" ? entry.updates : {};
      if (!Object.prototype.hasOwnProperty.call(updates, context.coursePitchedField)) {
        return;
      }
      if (!isFilledCourseValue(updates[context.coursePitchedField])) {
        return;
      }
      const eventDate = parseLocalDate(entry?.at);
      candidates.push({
        at: entry?.at || "",
        time: eventDate?.getTime() || 0,
        counselor: resolveCounselorActivityActor(entry?.by)
      });
    });
  });

  return candidates.sort((left, right) => left.time - right.time)[0] || null;
}

function getCurrentReportingBucketForLead(lead = {}) {
  const contexts = getReportingContexts(lead);
  if (contexts.some((context) => normalizeText(lead?.[context.admissionStatusField]) === "enrolled")) {
    return "Enrolled";
  }

  const currentStatus = contexts
    .flatMap((context) => [
      [context.callStatusField, lead?.[context.callStatusField]],
      [context.courseStatusField, lead?.[context.courseStatusField]]
    ])
    .map(([field, value]) => getReportingEventStatus(field, value))
    .find((bucket) => ["CNC", "CBL", "NI"].includes(bucket));

  return currentStatus || "";
}

function hasCounselorAdmissionActivity(lead = {}, counselor = "") {
  const normalizedCounselor = normalizeText(counselor);
  return getReportingContexts(lead).some((context) =>
    context.history.some((entry) =>
      normalizeText(resolveCounselorActivityActor(entry?.by)) === normalizedCounselor
      && isCounselorActivityEntry(entry, MONITORING_ACTIVITY_OPTIONS[context.historyField] || {})
    )
  );
}

function getAssignmentCourseValue(lead = {}) {
  return String(
    lead?.mainAdmissionCoursePitched
    || lead?.courseName
    || lead?.courseCode
    || ""
  ).trim();
}

function getAssignmentCourseColumnKey(value) {
  const text = String(value || "").trim();
  if (!isFilledCourseValue(text)) {
    return "";
  }
  if (/pre\s*workshop|post\s*workshop|workshop\s*calling/i.test(text)) {
    return "";
  }

  const matched = ASSIGNMENT_COURSE_COLUMNS.find((column) =>
    column.patterns.some((pattern) => pattern.test(text))
  );
  return matched?.key || "";
}

function getAssignedAdmissionLeadsForCounselor(leads, counselor) {
  const normalizedCounselor = normalizeText(counselor);
  return leads.filter((lead) => {
    if (!isAdmissionReportingLead(lead)) {
      return false;
    }
    if (normalizeText(resolveCounselorName(lead?.counselor, true)) !== normalizedCounselor) {
      return false;
    }
    return true;
  });
}

function buildReportingRows(counselors, leads, range = null) {
  const rows = counselors.map((counselor) => {
    const row = {
      counselor,
      enrolled: 0,
      pde: 0,
      cnc: 0,
      cbl: 0,
      ni: 0,
      pendingLeads: 0
    };
    const countedByBucket = {
      enrolled: new Set(),
      pde: new Set(),
      cnc: new Set(),
      cbl: new Set(),
      ni: new Set()
    };
    const normalizedCounselor = normalizeText(counselor);

    leads.filter(isAdmissionReportingLead).forEach((lead) => {
      const leadKey = getLeadKey(lead);
      const assignedToCounselor = normalizeText(resolveCounselorName(lead?.counselor, true)) === normalizedCounselor;
      const firstPde = findFirstCoursePitchedEvent(lead);
      if (firstPde) {
        const pdeDate = parseLocalDate(firstPde.at);
        if (
          normalizeText(firstPde.counselor) === normalizedCounselor
          && (!range || (pdeDate && pdeDate >= range.start && pdeDate <= range.end))
        ) {
          countedByBucket.pde.add(leadKey);
        }
      } else if (!range && assignedToCounselor && getReportingContexts(lead).some((context) => isFilledCourseValue(lead?.[context.coursePitchedField]))) {
        countedByBucket.pde.add(leadKey);
      }

      const events = getReportingEventsForLead(lead, range)
        .filter((event) => normalizeText(event.counselor) === normalizedCounselor)
        .sort((left, right) => (parseLocalDate(right.at)?.getTime() || 0) - (parseLocalDate(left.at)?.getTime() || 0));
      const latestDisposition = events.find((event) => ["CNC", "CBL", "NI"].includes(event.bucket));
      if (events.some((event) => event.bucket === "Enrolled")) {
        countedByBucket.enrolled.add(leadKey);
      }
      if (latestDisposition?.bucket === "CNC") countedByBucket.cnc.add(leadKey);
      if (latestDisposition?.bucket === "CBL") countedByBucket.cbl.add(leadKey);
      if (latestDisposition?.bucket === "NI") countedByBucket.ni.add(leadKey);

      if (!range && assignedToCounselor) {
        const currentBucket = getCurrentReportingBucketForLead(lead);
        if (currentBucket === "Enrolled") countedByBucket.enrolled.add(leadKey);
        if (currentBucket === "CNC") countedByBucket.cnc.add(leadKey);
        if (currentBucket === "CBL") countedByBucket.cbl.add(leadKey);
        if (currentBucket === "NI") countedByBucket.ni.add(leadKey);
      }
    });

    row.enrolled = countedByBucket.enrolled.size;
    row.pde = countedByBucket.pde.size;
    row.cnc = countedByBucket.cnc.size;
    row.cbl = countedByBucket.cbl.size;
    row.ni = countedByBucket.ni.size;
    row.pendingLeads = getAssignedAdmissionLeadsForCounselor(leads, counselor)
      .filter((lead) => !hasCounselorAdmissionActivity(lead, counselor))
      .length;
    return row;
  });

  return rows
    .filter((row) => Object.values(row).some((value) => typeof value === "number" && value > 0))
    .sort((left, right) => (
      (right.enrolled + right.pde + right.cnc + right.cbl + right.ni + right.pendingLeads)
      - (left.enrolled + left.pde + left.cnc + left.cbl + left.ni + left.pendingLeads)
    ) || String(left.counselor).localeCompare(String(right.counselor)));
}

function buildLeadAssignmentRows(counselors, leads, range = null) {
  const rows = counselors.map((counselor) => {
    const row = {
      counselor,
      total: 0
    };
    ASSIGNMENT_COURSE_COLUMNS.forEach((column) => {
      row[column.key] = 0;
    });

    getAssignedAdmissionLeadsForCounselor(leads, counselor).forEach((lead) => {
      const columnKey = getAssignmentCourseColumnKey(getAssignmentCourseValue(lead));
      if (!columnKey) {
        return;
      }
      row[columnKey] += 1;
      row.total += 1;
    });

    return row;
  });

  return rows
    .filter((row) => row.total > 0)
    .sort((left, right) => right.total - left.total || String(left.counselor).localeCompare(String(right.counselor)));
}

function formatPercent(count, total) {
  if (!total) {
    return "0%";
  }
  const value = (count / total) * 100;
  return `${value.toFixed(value % 1 === 0 ? 0 : 1)}%`;
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

function rowHasMonitoringData(row) {
  return Object.entries(row).some(([key, value]) =>
    key !== "counselor"
    && key !== "talkTimeLabel"
    && typeof value === "number"
    && value > 0
  );
}

function filterVisibleMonitoringRows(rows) {
  if (isCounselorSession()) {
    return rows;
  }

  return rows.filter((row) => rowHasMonitoringData(row));
}

function buildWorkshopRows(counselors, leads, rawLeads, range) {
  return filterVisibleMonitoringRows(sortRowsByPriority(counselors.map((counselor) => {
    const counselorLeads = getCounselorActivityLeadRecords(leads, "workshopActivityHistory", counselor, range);
    const activityLeads = counselorLeads.map((record) => ({
      ...record.lead,
      preActivityUpdates: record.activityCount
    }));
    const activitySummary = splitFreshAndOldActivities(activityLeads, "preActivityUpdates", range);

    return {
      counselor,
      ...activitySummary,
      workshopEntries: formatBreakdownEntries(activityLeads, "workshop", "preActivityUpdates"),
      interested: countLeadsByLatestHistoryUpdate(counselorLeads, "wsStatus", "Interested"),
      notInterested: countLeadsByLatestHistoryUpdate(counselorLeads, "wsStatus", "Not Interested"),
      whatsappJoined: countLeadsByLatestHistoryUpdate(counselorLeads, "whatsappGroupStatus", "Joined"),
      assignedLeads: countAssignedLeads(rawLeads, counselor, range)
    };
  })));
}

function buildPostWorkshopRows(counselors, leads, rawLeads, range) {
  return filterVisibleMonitoringRows(sortRowsByPriority(counselors.map((counselor) => {
    const counselorLeads = getCounselorActivityLeadRecords(leads, "admissionActivityHistory", counselor, range);
    const activityLeads = counselorLeads.map((record) => ({
      ...record.lead,
      postActivityUpdates: record.activityCount
    }));
    const activitySummary = splitFreshAndOldActivities(activityLeads, "postActivityUpdates", range);

    return {
      counselor,
      ...activitySummary,
      workshopEntries: formatAdmissionWorkshopBreakdownEntries(activityLeads, "postActivityUpdates"),
      interested: countLeadsByLatestHistoryUpdate(counselorLeads, "courseStatus", "Interested"),
      notInterested: countLeadsByLatestHistoryUpdate(counselorLeads, "courseStatus", "Not Interested"),
      enrolled: countLeadsByLatestHistoryUpdate(counselorLeads, "admissionStatus", "Enrolled"),
      won: countLeadsByLatestHistoryUpdate(counselorLeads, "admissionStatus", "Won"),
      assignedLeads: countAssignedLeads(rawLeads, counselor, range)
    };
  })));
}

function buildMainAdmissionRows(counselors, leads, rawLeads, range) {
  return filterVisibleMonitoringRows(sortRowsByPriority(counselors.map((counselor) => {
    const counselorLeads = getCounselorActivityLeadRecords(leads, "mainAdmissionActivityHistory", counselor, range);
    const activityLeads = counselorLeads.map((record) => ({
      ...record.lead,
      mainAdmissionActivityUpdates: record.activityCount
    }));
    const activitySummary = splitFreshAndOldActivities(activityLeads, "mainAdmissionActivityUpdates", range);

    return {
      counselor,
      ...activitySummary,
      courseEntries: formatDerivedBreakdownEntries(
        activityLeads,
        getMainAdmissionBreakdownCourseName,
        "mainAdmissionActivityUpdates",
        "Unspecified"
      ),
      interested: countLeadsByLatestHistoryUpdate(counselorLeads, "mainAdmissionCourseStatus", "Interested"),
      notInterested: countLeadsByLatestHistoryUpdate(counselorLeads, "mainAdmissionCourseStatus", "Not Interested"),
      enrolled: countLeadsByLatestHistoryUpdate(counselorLeads, "mainAdmissionAdmissionStatus", "Enrolled"),
      won: countLeadsByLatestHistoryUpdate(counselorLeads, "mainAdmissionAdmissionStatus", "Won"),
      assignedLeads: countAssignedLeads(rawLeads, counselor, range)
    };
  })));
}

function buildRegisteredRows(counselors, leads, rawLeads, range) {
  return filterVisibleMonitoringRows(sortRowsByPriority(counselors.map((counselor) => {
    const counselorLeads = getCounselorActivityLeadRecords(leads, "registeredCourseActivityHistory", counselor, range);
    const activityLeads = counselorLeads.map((record) => ({
      ...record.lead,
      registeredCourseActivityUpdates: record.activityCount
    }));
    const activitySummary = splitFreshAndOldActivities(activityLeads, "registeredCourseActivityUpdates", range);

    return {
      counselor,
      ...activitySummary,
      courseEntries: formatBreakdownEntries(activityLeads, "courseName", "registeredCourseActivityUpdates"),
      assignedLeads: countAssignedLeads(rawLeads, counselor, range),
      dialed: countLeadsByLatestHistoryUpdate(counselorLeads, "registeredDialed", "Yes"),
      interested: countLeadsByLatestHistoryUpdate(counselorLeads, "registeredCourseStatus", "Interested"),
      notInterested: countLeadsByLatestHistoryUpdate(counselorLeads, "registeredCourseStatus", "Not Interested")
    };
  })));
}

function buildMetricCards(metrics) {
  const token = ++monitoringKpiRenderToken;
  window.requestAnimationFrame(() => {
    if (token !== monitoringKpiRenderToken) {
      return;
    }
    monitoringKpiSection.innerHTML = metrics.map((metric) => `
      <article class="card kpi-card">
        <p>${escapeHtml(metric.label)}</p>
        <h2>${escapeHtml(metric.value)}</h2>
      </article>
    `).join("");
  });
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
  if (timelineFilter.type === "yesterday") return "Yesterday";
  if (timelineFilter.type === "week") return "Week";
  if (timelineFilter.type === "recent") return "Last 30 Days";
  if (timelineFilter.type === "custom") {
    const range = getTimelineRange();
    if (!range?.start || !range?.end) {
      return "Custom Range";
    }
    return `${formatKolkataDate(range.start)} to ${formatKolkataDate(range.end)}`;
  }
  return "Monitoring Report";
}

function renderServerBreakdownCell(entries = [], emptyLabel = "No activity") {
  if (!Array.isArray(entries) || !entries.length) {
    return `<span class="monitoring-breakdown monitoring-breakdown--empty">${escapeHtml(emptyLabel)}</span>`;
  }
  const preview = entries.slice(0, 2);
  const hiddenCount = Math.max(entries.length - preview.length, 0);
  return `
    <div class="monitoring-breakdown">
      <div class="monitoring-breakdown__preview">
        ${preview.map((entry) => `<span class="monitoring-breakdown__pill">${escapeHtml(entry.name)} (${Number(entry.count) || 0})</span>`).join("")}
      </div>
      ${hiddenCount ? `
        <details class="monitoring-breakdown__details">
          <summary>View ${hiddenCount} more</summary>
          <ul>${entries.map((entry) => `<li>${escapeHtml(entry.name)} <strong>${Number(entry.count) || 0}</strong></li>`).join("")}</ul>
        </details>
      ` : ""}
    </div>
  `;
}

function getServerReportCell(row, label) {
  const keyByLabel = {
    "Counselor Name": "counselor",
    "Total Activities Completed": "activities",
    "Overall Activity": "activities",
    "Total Leads Touched": "activities",
    "Workshop-wise Activity Breakdown": "entries",
    "Course-wise Activity Breakdown": "entries",
    "Workshop-wise Leads Touched": "entries",
    "Course-wise Leads Touched": "entries",
    "Interested Leads": "interested",
    "Not Interested Leads": "notInterested",
    "WhatsApp Group Joined": "whatsappJoined",
    "Enrolled": "enrolled",
    "Won": "won",
    "Leads Assigned": "assignedLeads",
    "Fresh Leads Touched": "freshLeadTouches",
    "Old Leads Touched": "oldLeadTouches",
    "Dialed Leads": "dialed",
    "Total Calls": "totalCalls",
    "Outbound Calls": "outboundCalls",
    "Inbound Calls": "inboundCalls",
    "Call Picked": "callPicked",
    "Call Not Picked / Not Connected": "callNotPicked",
    "Talk Time": "talkTimeLabel"
  };
  const key = keyByLabel[label] || label;
  if (key === "entries") {
    return renderServerBreakdownCell(row.entries, label.startsWith("Course") ? "No course activity" : "No workshop activity");
  }
  return escapeHtml(row?.[key] ?? "");
}

function renderServerMonitoringReport() {
  if (!monitoringReport) return false;
  const subsectionConfig = getActiveSubsectionConfig();
  monitoringActiveTitle.textContent = subsectionConfig.title;
  monitoringActiveDescription.textContent = subsectionConfig.description;
  buildMetricCards((Array.isArray(monitoringReport.metrics) ? monitoringReport.metrics : []).map((metric) => ({
    label: metric.label,
    value: metric.value
  })));
  const columns = Array.isArray(monitoringReport.columns) ? monitoringReport.columns : [];
  const rows = Array.isArray(monitoringReport.rows) ? monitoringReport.rows : [];
  renderTable(columns.map((label) => ({
    label,
    render: (row) => getServerReportCell(row, label)
  })), rows, Math.max(columns.length, 1));
  return true;
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

  const groups = Object.entries(VIEW_CONFIG)
    .filter(([, group]) => !group.adminOnly || isAdminSession());
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
      void loadMonitoringData().finally(() => renderAll());
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

  if (subsections.length <= 1) {
    monitoringSubsectionNav.innerHTML = "";
    monitoringSubsectionNav.style.display = "none";
    return;
  }

  monitoringSubsectionNav.style.display = "";

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
      void loadMonitoringData().finally(() => renderAll());
    };
  });
}

function renderWorkshopCallingView(counselors, leads, rawLeads, range) {
  const rows = buildWorkshopRows(counselors, leads, rawLeads, range);
  const totalActivity = rows.reduce((sum, row) => sum + row.activities, 0);
  const assignedLeads = rows.reduce((sum, row) => sum + row.assignedLeads, 0);
  const interested = rows.reduce((sum, row) => sum + row.interested, 0);
  const notInterested = rows.reduce((sum, row) => sum + row.notInterested, 0);
  const whatsappJoined = rows.reduce((sum, row) => sum + row.whatsappJoined, 0);
  const freshLeadTouches = rows.reduce((sum, row) => sum + row.freshLeadTouches, 0);
  const oldLeadTouches = rows.reduce((sum, row) => sum + row.oldLeadTouches, 0);

  buildMetricCards([
    { label: MONITORING_COUNTER_LABEL, value: totalActivity },
    { label: "Leads Assigned", value: assignedLeads },
    { label: "Interested Leads", value: interested },
    { label: "Not Interested Leads", value: notInterested },
    { label: "WhatsApp Group Joined", value: whatsappJoined },
    { label: "Fresh Leads Touched", value: freshLeadTouches },
    { label: "Old Leads Touched", value: oldLeadTouches }
  ]);

  renderTable([
    { label: "Counselor Name", render: (row) => escapeHtml(row.counselor) },
    { label: MONITORING_COUNTER_LABEL, render: (row) => String(row.activities) },
    { label: "Workshop-wise Leads Touched", render: (row) => renderBreakdownCell(row.workshopEntries, "No workshop activity") },
    { label: "Interested Leads", render: (row) => String(row.interested) },
    { label: "Not Interested Leads", render: (row) => String(row.notInterested) },
    { label: "WhatsApp Group Joined", render: (row) => String(row.whatsappJoined) },
    { label: "Leads Assigned", render: (row) => String(row.assignedLeads) },
    { label: "Fresh Leads Touched", render: (row) => String(row.freshLeadTouches) },
    { label: "Old Leads Touched", render: (row) => String(row.oldLeadTouches) }
  ], rows, 9);
}

function renderAdmissionCallingView(counselors, leads, rawLeads, range) {
  const rows = buildPostWorkshopRows(counselors, leads, rawLeads, range);
  const totalActivity = rows.reduce((sum, row) => sum + row.activities, 0);
  const assignedLeads = rows.reduce((sum, row) => sum + row.assignedLeads, 0);
  const interested = rows.reduce((sum, row) => sum + row.interested, 0);
  const notInterested = rows.reduce((sum, row) => sum + row.notInterested, 0);
  const enrolled = rows.reduce((sum, row) => sum + row.enrolled, 0);
  const won = rows.reduce((sum, row) => sum + row.won, 0);
  const freshLeadTouches = rows.reduce((sum, row) => sum + row.freshLeadTouches, 0);
  const oldLeadTouches = rows.reduce((sum, row) => sum + row.oldLeadTouches, 0);

  buildMetricCards([
    { label: MONITORING_COUNTER_LABEL, value: totalActivity },
    { label: "Leads Assigned", value: assignedLeads },
    { label: "Interested Leads", value: interested },
    { label: "Not Interested Leads", value: notInterested },
    { label: "Enrolled", value: enrolled },
    { label: "Won", value: won },
    { label: "Fresh Leads Touched", value: freshLeadTouches },
    { label: "Old Leads Touched", value: oldLeadTouches }
  ]);

  renderTable([
    { label: "Counselor Name", render: (row) => escapeHtml(row.counselor) },
    { label: MONITORING_COUNTER_LABEL, render: (row) => String(row.activities) },
    { label: "Workshop-wise Leads Touched", render: (row) => renderBreakdownCell(row.workshopEntries, "No workshop activity") },
    { label: "Interested Leads", render: (row) => String(row.interested) },
    { label: "Not Interested Leads", render: (row) => String(row.notInterested) },
    { label: "Enrolled", render: (row) => String(row.enrolled) },
    { label: "Won", render: (row) => String(row.won) },
    { label: "Leads Assigned", render: (row) => String(row.assignedLeads) },
    { label: "Fresh Leads Touched", render: (row) => String(row.freshLeadTouches) },
    { label: "Old Leads Touched", render: (row) => String(row.oldLeadTouches) }
  ], rows, 10);
}

function renderMainAdmissionView(counselors, leads, rawLeads, range) {
  const rows = buildMainAdmissionRows(counselors, leads, rawLeads, range);
  const totalActivity = rows.reduce((sum, row) => sum + row.activities, 0);
  const assignedLeads = rows.reduce((sum, row) => sum + row.assignedLeads, 0);
  const interested = rows.reduce((sum, row) => sum + row.interested, 0);
  const notInterested = rows.reduce((sum, row) => sum + row.notInterested, 0);
  const enrolled = rows.reduce((sum, row) => sum + row.enrolled, 0);
  const won = rows.reduce((sum, row) => sum + row.won, 0);
  const freshLeadTouches = rows.reduce((sum, row) => sum + row.freshLeadTouches, 0);
  const oldLeadTouches = rows.reduce((sum, row) => sum + row.oldLeadTouches, 0);

  buildMetricCards([
    { label: MONITORING_COUNTER_LABEL, value: totalActivity },
    { label: "Leads Assigned", value: assignedLeads },
    { label: "Interested Leads", value: interested },
    { label: "Not Interested Leads", value: notInterested },
    { label: "Enrolled", value: enrolled },
    { label: "Won", value: won },
    { label: "Fresh Leads Touched", value: freshLeadTouches },
    { label: "Old Leads Touched", value: oldLeadTouches }
  ]);

  renderTable([
    { label: "Counselor Name", render: (row) => escapeHtml(row.counselor) },
    { label: MONITORING_COUNTER_LABEL, render: (row) => String(row.activities) },
    { label: "Course-wise Leads Touched", render: (row) => renderBreakdownCell(row.courseEntries, "No course activity") },
    { label: "Interested Leads", render: (row) => String(row.interested) },
    { label: "Not Interested Leads", render: (row) => String(row.notInterested) },
    { label: "Enrolled", render: (row) => String(row.enrolled) },
    { label: "Won", render: (row) => String(row.won) },
    { label: "Leads Assigned", render: (row) => String(row.assignedLeads) },
    { label: "Fresh Leads Touched", render: (row) => String(row.freshLeadTouches) },
    { label: "Old Leads Touched", render: (row) => String(row.oldLeadTouches) }
  ], rows, 10);
}

function renderRegisteredView(counselors, leads, rawLeads, range) {
  const rows = buildRegisteredRows(counselors, leads, rawLeads, range);
  const totalActivity = rows.reduce((sum, row) => sum + row.activities, 0);
  const assignedLeads = rows.reduce((sum, row) => sum + row.assignedLeads, 0);
  const dialed = rows.reduce((sum, row) => sum + row.dialed, 0);
  const interested = rows.reduce((sum, row) => sum + row.interested, 0);
  const notInterested = rows.reduce((sum, row) => sum + row.notInterested, 0);
  const freshLeadTouches = rows.reduce((sum, row) => sum + row.freshLeadTouches, 0);
  const oldLeadTouches = rows.reduce((sum, row) => sum + row.oldLeadTouches, 0);

  buildMetricCards([
    { label: MONITORING_COUNTER_LABEL, value: totalActivity },
    { label: "Leads Assigned", value: assignedLeads },
    { label: "Dialed Leads", value: dialed },
    { label: "Interested Leads", value: interested },
    { label: "Not Interested Leads", value: notInterested },
    { label: "Fresh Leads Touched", value: freshLeadTouches },
    { label: "Old Leads Touched", value: oldLeadTouches }
  ]);

  renderTable([
    { label: "Counselor Name", render: (row) => escapeHtml(row.counselor) },
    { label: MONITORING_COUNTER_LABEL, render: (row) => String(row.activities) },
    { label: "Course-wise Leads Touched", render: (row) => renderBreakdownCell(row.courseEntries, "No course activity") },
    { label: "Leads Assigned", render: (row) => String(row.assignedLeads) },
    { label: "Fresh Leads Touched", render: (row) => String(row.freshLeadTouches) },
    { label: "Old Leads Touched", render: (row) => String(row.oldLeadTouches) },
    { label: "Dialed Leads", render: (row) => String(row.dialed) },
    { label: "Interested Leads", render: (row) => String(row.interested) },
    { label: "Not Interested Leads", render: (row) => String(row.notInterested) }
  ], rows, 9);
}

function renderReportingView(counselors, rawLeads, range) {
  const rows = buildReportingRows(counselors, rawLeads, range);
  const totals = rows.reduce((summary, row) => {
    summary.enrolled += row.enrolled;
    summary.pde += row.pde;
    summary.cnc += row.cnc;
    summary.cbl += row.cbl;
    summary.ni += row.ni;
    summary.pendingLeads += row.pendingLeads;
    return summary;
  }, {
    enrolled: 0,
    pde: 0,
    cnc: 0,
    cbl: 0,
    ni: 0,
    pendingLeads: 0
  });

  buildMetricCards([
    { label: "Enrolled", value: totals.enrolled },
    { label: "PDE", value: totals.pde },
    { label: "CNC", value: totals.cnc },
    { label: "CBL", value: totals.cbl },
    { label: "NI", value: totals.ni },
    { label: "Pending Leads", value: totals.pendingLeads }
  ]);

  renderTable([
    { label: "Counselor Name", render: (row) => escapeHtml(row.counselor) },
    { label: "Enrolled", render: (row) => String(row.enrolled) },
    { label: "PDE", render: (row) => String(row.pde) },
    { label: "CNC", render: (row) => String(row.cnc) },
    { label: "CBL", render: (row) => String(row.cbl) },
    { label: "NI", render: (row) => String(row.ni) },
    { label: "Pending Leads", render: (row) => String(row.pendingLeads) }
  ], rows, 7);
}

function renderLeadAssignmentView(counselors, rawLeads, range) {
  const rows = buildLeadAssignmentRows(counselors, rawLeads, range);
  const totalAssigned = rows.reduce((sum, row) => sum + row.total, 0);
  const courseTotals = ASSIGNMENT_COURSE_COLUMNS.map((column) => ({
    label: column.label,
    value: rows.reduce((sum, row) => sum + row[column.key], 0)
  }));

  buildMetricCards([
    { label: "Total Assigned", value: totalAssigned },
    ...courseTotals.filter((metric) => metric.value > 0).slice(0, 5)
  ]);

  renderTable([
    { label: "Counselor Name", render: (row) => escapeHtml(row.counselor) },
    ...ASSIGNMENT_COURSE_COLUMNS.map((column) => ({
      label: column.label,
      render: (row) => String(row[column.key] || 0)
    })),
    { label: "Total", render: (row) => String(row.total) }
  ], rows, ASSIGNMENT_COURSE_COLUMNS.length + 2, "lead-assignment-table");
}

function getMcubeCounselorLabel(entry = {}) {
  const counselor = resolveCounselorName(entry?.counselor);
  if (counselor) {
    return counselor;
  }

  const agentName = resolveCounselorName(entry?.agentName);
  if (agentName) {
    return agentName;
  }

  return resolveCounselorName(entry?.agentName, true) || resolveCounselorName(entry?.counselor, true) || "Unassigned";
}

function scopeMcubeCallsForSession(entries) {
  if (!isCounselorSession()) {
    return entries;
  }

  const counselorIdentity = getCounselorIdentity();
  if (!counselorIdentity) {
    return [];
  }

  return entries.filter((entry) => normalizeText(getMcubeCounselorLabel(entry)) === counselorIdentity);
}

function buildMcubeRows(rawLeads, range) {
  const grouped = new Map();

  const calls = scopeMcubeCallsForSession(getMcubeCallEntriesInRange(rawLeads, range));
  primeMcubeRecordingDurations(calls);

  calls.forEach((entry) => {
    const counselor = getMcubeCounselorLabel(entry);
    if (!counselor || normalizeText(counselor) === "unassigned") {
      return;
    }
    const current = grouped.get(counselor) || {
      counselor,
      totalCalls: 0,
      outboundCalls: 0,
      inboundCalls: 0,
      callPicked: 0,
      callNotPicked: 0,
      talkTimeSeconds: 0,
      talkTimeLabel: "0s"
    };

    current.totalCalls += 1;
    if (normalizeText(entry.direction) === "outbound") {
      current.outboundCalls += 1;
    }
    if (normalizeText(entry.direction) === "inbound") {
      current.inboundCalls += 1;
    }
    if (didLeadPickMcubeCall(entry)) {
      current.callPicked += 1;
    } else {
      current.callNotPicked += 1;
    }
    current.talkTimeSeconds += getMcubeEntryTalkTimeSeconds(entry);
    current.talkTimeLabel = formatTalkTime(current.talkTimeSeconds);

    grouped.set(counselor, current);
  });

  return filterVisibleMonitoringRows(
    [...grouped.values()].sort((left, right) => {
      if (right.totalCalls !== left.totalCalls) {
        return right.totalCalls - left.totalCalls;
      }
      return String(left.counselor).localeCompare(String(right.counselor));
    })
  );
}

function renderMcubeView(rawLeads, range) {
  const calls = scopeMcubeCallsForSession(getMcubeCallEntriesInRange(rawLeads, range));
  primeMcubeRecordingDurations(calls);
  const totalCalls = calls.length;
  const outboundCalls = calls.filter((entry) => normalizeText(entry.direction) === "outbound").length;
  const inboundCalls = calls.filter((entry) => normalizeText(entry.direction) === "inbound").length;
  const callPicked = calls.filter((entry) => didLeadPickMcubeCall(entry)).length;
  const callNotPicked = totalCalls - callPicked;
  const totalTalkTime = calls.reduce((sum, entry) => sum + getMcubeEntryTalkTimeSeconds(entry), 0);
  const rows = buildMcubeRows(rawLeads, range);

  buildMetricCards([
    { label: "Total Calls", value: totalCalls },
    { label: "Outbound Calls", value: outboundCalls },
    { label: "Inbound Calls", value: inboundCalls },
    { label: "Call Picked", value: callPicked },
    { label: "Call Not Picked / Not Connected", value: callNotPicked },
    { label: "Total Talk Time", value: formatTalkTime(totalTalkTime) }
  ]);

  renderTable([
    { label: "Counselor Name", render: (row) => escapeHtml(row.counselor) },
    { label: "Total Calls", render: (row) => String(row.totalCalls) },
    { label: "Outbound Calls", render: (row) => String(row.outboundCalls) },
    { label: "Inbound Calls", render: (row) => String(row.inboundCalls) },
    { label: "Call Picked", render: (row) => String(row.callPicked) },
    { label: "Call Not Picked / Not Connected", render: (row) => String(row.callNotPicked) },
    { label: "Talk Time", render: (row) => escapeHtml(row.talkTimeLabel) }
  ], rows, 7);
}

function renderActiveMonitoringView() {
  if (renderServerMonitoringReport()) {
    return;
  }

  const range = getTimelineRange();
  const rawAllLeads = getScopedLeads(getAllLeads());
  const timelineLeads = getScopedLeads(applyTimelineFilter(getAllLeads()));
  const legacyNonMainAdmissionRawLeads = rawAllLeads.filter((lead) => !isMainAdmissionLead(lead));
  const legacyNonMainAdmissionTimelineLeads = timelineLeads.filter((lead) => !isMainAdmissionLead(lead));
  const subsectionConfig = getActiveSubsectionConfig();

  monitoringActiveTitle.textContent = subsectionConfig.title;
  monitoringActiveDescription.textContent = subsectionConfig.description;

  if (activeView.subsection === "reporting") {
    const rawLeads = getManagementReportMainAdmissionLeads(rawAllLeads, range);
    const counselors = getMonitoringCounselorNames(rawLeads);
    renderReportingView(counselors, rawLeads, range);
    return;
  }

  if (activeView.subsection === "lead-assignment") {
    const rawLeads = getManagementReportMainAdmissionLeads(rawAllLeads, range);
    const counselors = getMonitoringCounselorNames(rawLeads);
    renderLeadAssignmentView(counselors, rawLeads, range);
    return;
  }

  if (activeView.subsection === "workshop-calling") {
    const leads = legacyNonMainAdmissionTimelineLeads.filter((lead) => !isNonWorkshopPipelineLead(lead) && !isLostLead(lead));
    const rawLeads = legacyNonMainAdmissionRawLeads.filter((lead) => !isNonWorkshopPipelineLead(lead) && !isLostLead(lead));
    const counselors = getMonitoringCounselorNames(rawLeads);
    renderWorkshopCallingView(counselors, leads, rawLeads, range);
    return;
  }

  if (activeView.subsection === "admission-calling") {
    const leads = legacyNonMainAdmissionTimelineLeads.filter((lead) => !isNonWorkshopPipelineLead(lead));
    const rawLeads = legacyNonMainAdmissionRawLeads.filter((lead) => !isNonWorkshopPipelineLead(lead));
    const counselors = getMonitoringCounselorNames(rawLeads);
    renderAdmissionCallingView(counselors, leads, rawLeads, range);
    return;
  }

  if (activeView.subsection === "main-admission") {
    const leads = timelineLeads.filter(isMainAdmissionLead);
    const rawLeads = rawAllLeads.filter(isMainAdmissionLead);
    const counselors = getMonitoringCounselorNames(rawLeads);
    renderMainAdmissionView(counselors, leads, rawLeads, range);
    return;
  }

  if (activeView.subsection === "registered-candidates") {
    const leads = timelineLeads.filter(isStandardRegisteredLead);
    const rawLeads = rawAllLeads.filter(isStandardRegisteredLead);
    const counselors = getMonitoringCounselorNames(rawLeads);
    renderRegisteredView(counselors, leads, rawLeads, range);
    return;
  }

  if (activeView.subsection === "mcube-main") {
    renderMcubeView(rawAllLeads, range);
    return;
  }

  const leads = timelineLeads.filter(isCrashCourseRegistrationLead);
  const rawLeads = rawAllLeads.filter(isCrashCourseRegistrationLead);
  const counselors = getMonitoringCounselorNames(rawLeads);
  renderRegisteredView(counselors, leads, rawLeads, range);
}

function ensureValidActiveView() {
  if (VIEW_CONFIG[activeView.group]?.adminOnly && !isAdminSession()) {
    activeView.group = "workshop";
    activeView.subsection = "workshop-calling";
  }

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
  window.__dvMarkRouteViewReady?.();

  if (exportMonitoringBtn) {
    exportMonitoringBtn.onclick = () => {
      exportMonitoringExcel();
    };
  }
}

bindTimelineControls();
await loadMonitoringData().catch((error) => {
  console.warn("[monitoring] initial loading failed:", error?.message || error);
});
renderAll();
const stopStatePolling = startMonitoringPolling(() => {
  renderAll();
});
registerPageCleanup(stopStatePolling);
