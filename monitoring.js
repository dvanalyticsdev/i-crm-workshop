import { registerPageCleanup } from "./page-runtime.js";
import { bootstrapLocalState, getCounselors, getLeads as getStoredLeads, getSession, loadPersistedValue, savePersistedValue, startStatePolling } from "./state-sync.js";

await bootstrapLocalState();

const monitoringKpiSection = document.getElementById("monitoringKpiSection");
const preMonitoringTable = document.getElementById("preMonitoringTable");
const postMonitoringTable = document.getElementById("postMonitoringTable");
const registeredMonitoringTable = document.getElementById("registeredMonitoringTable");

const monitoringTimelineSelect = document.getElementById("monitoringTimelineSelect");
const monitoringStartDate = document.getElementById("monitoringStartDate");
const monitoringEndDate = document.getElementById("monitoringEndDate");
const monitoringStartDateWrap = document.getElementById("monitoringStartDateWrap");
const monitoringEndDateWrap = document.getElementById("monitoringEndDateWrap");
const resetMonitoringTimeline = document.getElementById("resetMonitoringTimeline");
const exportMonitoringBtn = document.getElementById("exportMonitoringBtn");
const monitoringExportMessage = document.getElementById("monitoringExportMessage");

const session = getSession();

let timelineFilter = {
  type: "week",
  startDate: "",
  endDate: ""
};

const MONITORING_REFERENCE_DATE = new Date(2026, 6, 17);

const TIMELINE_STORAGE_KEY = "dvWorkshopMonitoringTimeline";

timelineFilter = {
  ...timelineFilter,
  ...await loadPersistedValue(TIMELINE_STORAGE_KEY, {})
};

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
  void savePersistedValue(TIMELINE_STORAGE_KEY, timelineFilter);
}

function setExportMessage(text, isError = true) {
  if (!monitoringExportMessage) {
    return;
  }

  monitoringExportMessage.textContent = text;
  monitoringExportMessage.style.color = isError ? "var(--danger)" : "var(--success)";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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

function normalizeLeadFields(leads) {
  leads.forEach((lead) => {
    lead.name = lead.name || "";
    lead.email = (lead.email || "").toLowerCase();
    lead.workshop = lead.workshop || "";
    lead.createdAt = lead.createdAt || new Date().toISOString().slice(0, 10);

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
    lead.registeredCourseActivityHistory = Array.isArray(lead.registeredCourseActivityHistory) ? lead.registeredCourseActivityHistory : [];
    lead.registeredDialed = lead.registeredDialed || "";
    lead.registeredCourseStatus = lead.registeredCourseStatus || "";
    lead.registeredAdmissionStatus = lead.registeredAdmissionStatus || "";
    lead.registeredCallStatus = lead.registeredCallStatus || "";
    lead.whatsappGroupStatus = lead.whatsappGroupStatus || "";
    lead.preActivityUpdates = new Set(
      lead.workshopActivityHistory
        .map((entry) => (entry.at ? new Date(entry.at).toISOString().slice(0, 10) : null))
        .filter(Boolean)
    ).size;
    lead.postActivityUpdates = new Set(
      lead.admissionActivityHistory
        .map((entry) => (entry.at ? new Date(entry.at).toISOString().slice(0, 10) : null))
        .filter(Boolean)
    ).size;
    lead.registeredCourseActivityUpdates = new Set(
      lead.registeredCourseActivityHistory
        .map((entry) => (entry.at ? new Date(entry.at).toISOString().slice(0, 10) : null))
        .filter(Boolean)
    ).size;
  });
}

function isCourseRegistrationLead(lead) {
  return String(lead?.leadPipeline || "").trim().toLowerCase() === "course-registration";
}

function isMainAdmissionLead(lead) {
  return String(lead?.leadPipeline || "").trim().toLowerCase() === "main-admission";
}

function isNonWorkshopPipelineLead(lead) {
  return isCourseRegistrationLead(lead) || isMainAdmissionLead(lead);
}

function getAllLeads() {
  const leads = getStoredLeads();
  normalizeLeadFields(leads);
  return leads;
}

function getTimelineRange() {
  if (timelineFilter.type === "overall") {
    return null;
  }

  const now = new Date(MONITORING_REFERENCE_DATE);

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

    const start = new Date(timelineFilter.startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(timelineFilter.endDate);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  return null;
}

function applyTimelineFilter(leads) {
  const range = getTimelineRange();

  // "overall" — return all leads with their full activity counts unchanged
  if (!range) {
    return leads;
  }

  const { start, end } = range;

  return leads
    .map((lead) => {
      const workshopHistory = Array.isArray(lead.workshopActivityHistory) ? lead.workshopActivityHistory : [];
      const admissionHistory = Array.isArray(lead.admissionActivityHistory) ? lead.admissionActivityHistory : [];
      const registeredHistory = Array.isArray(lead.registeredCourseActivityHistory) ? lead.registeredCourseActivityHistory : [];

      const workshopInRange = workshopHistory.filter((entry) => {
        const d = new Date(entry.at);
        return d >= start && d <= end;
      });
      const admissionInRange = admissionHistory.filter((entry) => {
        const d = new Date(entry.at);
        return d >= start && d <= end;
      });
      const registeredInRange = registeredHistory.filter((entry) => {
        const d = new Date(entry.at);
        return d >= start && d <= end;
      });

      return {
        ...lead,
        preActivityUpdates: new Set(workshopInRange.map((e) => new Date(e.at).toISOString().slice(0, 10))).size,
        postActivityUpdates: new Set(admissionInRange.map((e) => new Date(e.at).toISOString().slice(0, 10))).size,
        registeredCourseActivityUpdates: new Set(registeredInRange.map((e) => new Date(e.at).toISOString().slice(0, 10))).size
      };
    })
    .filter((lead) => lead.preActivityUpdates > 0 || lead.postActivityUpdates > 0 || lead.registeredCourseActivityUpdates > 0);
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

function isPostWorkshopLead(lead) {
  return lead.wsStatus === "Interested" && lead.whatsappInvite === "Yes";
}

function isLostLead(lead) {
  return lead.postStatusUpdated && lead.courseStatus === "Not Interested";
}

function getPreLeads(allLeads) {
  return allLeads.filter((lead) => !isNonWorkshopPipelineLead(lead) && !isLostLead(lead));
}

function getPostLeads(allLeads) {
  return allLeads.filter((lead) => !isNonWorkshopPipelineLead(lead));
}

function getRegisteredCandidateLeads(allLeads) {
  return allLeads.filter((lead) => isCourseRegistrationLead(lead));
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

function formatBreakdown(items, key, options = {}) {
  const { exclude = [] } = options;
  const counts = new Map();

  items.forEach((item) => {
    let value = String(item[key] || "").trim();
    if (key === "workshop") {
      value = getCoreWorkshopName(value);
    }
    if (!value || exclude.includes(value)) {
      return;
    }

    counts.set(value, (counts.get(value) || 0) + 1);
  });

  if (!counts.size) {
    return "-";
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `${name} (${count})`)
    .join(", ");
}

function formatBreakdownEntries(items, key, options = {}) {
  const { exclude = [] } = options;
  const counts = new Map();

  items.forEach((item) => {
    let value = String(item[key] || "").trim();
    if (key === "workshop") {
      value = getCoreWorkshopName(value);
    }
    if (!value || exclude.includes(value)) {
      return;
    }

    counts.set(value, (counts.get(value) || 0) + 1);
  });

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));
}

function formatAdmissionWorkshopBreakdown(items, options = {}) {
  const normalizedItems = items.map((lead) => ({
    ...lead,
    workshop: getAdmissionWorkshopName(lead)
  }));

  return formatBreakdown(normalizedItems, "workshop", options);
}

function formatAdmissionWorkshopBreakdownEntries(items, options = {}) {
  const normalizedItems = items.map((lead) => ({
    ...lead,
    workshop: getAdmissionWorkshopName(lead)
  }));

  return formatBreakdownEntries(normalizedItems, "workshop", options);
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

function getCounselorBuckets(allLeads) {
  const names = [...new Set(allLeads.map((lead) => lead.counselor || "Unassigned"))]
    .filter((name) => name && name.trim())
    .sort((a, b) => a.localeCompare(b));

  return names.length ? names : ["Unassigned"];
}

function buildPreRows(counselors, preLeads, rawAllLeads, range) {
  return sortRowsByPriority(counselors.map((counselor) => {
    const leads = preLeads.filter((lead) => (lead.counselor || "Unassigned") === counselor);
    const rawLeads = rawAllLeads.filter((lead) => (lead.counselor || "Unassigned") === counselor);
    const activityLeads = leads.filter((lead) => (Number(lead.preActivityUpdates) || 0) > 0);
    const activities = activityLeads.reduce((sum, lead) => sum + (Number(lead.preActivityUpdates) || 0), 0);
    const interested = activityLeads.filter((lead) => lead.wsStatus === "Interested").length;
    const notInterested = activityLeads.filter((lead) => lead.wsStatus === "Not Interested").length;
    const whatsappJoined = leads.filter((lead) => lead.whatsappGroupStatus === "Joined").length;

    let newLeads, freshActivities, oldLeadActivities;
    if (!range) {
      newLeads = rawLeads.length;
      freshActivities = activities;
      oldLeadActivities = 0;
    } else {
      const { start, end } = range;
      newLeads = rawLeads.filter((lead) => {
        const created = new Date(lead.createdAt);
        return created >= start && created <= end;
      }).length;
      const freshActivityLeads = activityLeads.filter((lead) => new Date(lead.createdAt) >= start);
      freshActivities = freshActivityLeads.reduce((sum, lead) => sum + (Number(lead.preActivityUpdates) || 0), 0);
      const oldActivityLeads = activityLeads.filter((lead) => new Date(lead.createdAt) < start);
      oldLeadActivities = oldActivityLeads.reduce((sum, lead) => sum + (Number(lead.preActivityUpdates) || 0), 0);
    }

    return {
      counselor,
      activities,
      workshopEntries: formatBreakdownEntries(activityLeads, "workshop"),
      interested,
      notInterested,
      whatsappJoined,
      newLeads,
      freshActivities,
      oldLeadActivities
    };
  }));
}

function buildPostRows(counselors, postLeads, rawAllLeads, range) {
  return sortRowsByPriority(counselors.map((counselor) => {
    const leads = postLeads.filter((lead) => (lead.counselor || "Unassigned") === counselor);
    const rawLeads = rawAllLeads.filter((lead) => (lead.counselor || "Unassigned") === counselor);
    const activityLeads = leads.filter((lead) => (Number(lead.postActivityUpdates) || 0) > 0);
    const activities = activityLeads.reduce((sum, lead) => sum + (Number(lead.postActivityUpdates) || 0), 0);
    const workshops = formatAdmissionWorkshopBreakdown(activityLeads);
    const interested = activityLeads.filter((lead) => lead.courseStatus === "Interested").length;
    const notInterested = leads.filter((lead) => lead.courseStatus === "Not Interested").length;
    const enrolled = activityLeads.filter((lead) => lead.admissionStatus === "Enrolled").length;
    const won = activityLeads.filter((lead) => lead.admissionStatus === "Won").length;

    let newLeads, freshActivities, oldLeadActivities;
    if (!range) {
      newLeads = rawLeads.length;
      freshActivities = activities;
      oldLeadActivities = 0;
    } else {
      const { start, end } = range;
      newLeads = rawLeads.filter((lead) => {
        const created = new Date(lead.createdAt);
        return created >= start && created <= end;
      }).length;
      const freshActivityLeads = activityLeads.filter((lead) => new Date(lead.createdAt) >= start);
      freshActivities = freshActivityLeads.reduce((sum, lead) => sum + (Number(lead.postActivityUpdates) || 0), 0);
      const oldActivityLeads = activityLeads.filter((lead) => new Date(lead.createdAt) < start);
      oldLeadActivities = oldActivityLeads.reduce((sum, lead) => sum + (Number(lead.postActivityUpdates) || 0), 0);
    }

    return {
      counselor,
      activities,
      workshops,
      workshopEntries: formatAdmissionWorkshopBreakdownEntries(activityLeads),
      interested,
      notInterested,
      enrolled,
      won,
      newLeads,
      freshActivities,
      oldLeadActivities
    };
  }));
}

function buildRegisteredRows(counselors, registeredLeads, rawAllLeads, range) {
  return sortRowsByPriority(counselors.map((counselor) => {
    const leads = registeredLeads.filter((lead) => (lead.counselor || "Unassigned") === counselor);
    const rawLeads = rawAllLeads.filter((lead) => (lead.counselor || "Unassigned") === counselor);
    const activityLeads = leads.filter((lead) => (Number(lead.registeredCourseActivityUpdates) || 0) > 0);
    const activities = activityLeads.reduce((sum, lead) => sum + (Number(lead.registeredCourseActivityUpdates) || 0), 0);
    const dialed = activityLeads.filter((lead) => lead.registeredDialed === "Yes").length;
    const interested = activityLeads.filter((lead) => lead.registeredCourseStatus === "Interested").length;
    const notInterested = leads.filter((lead) => lead.registeredCourseStatus === "Not Interested").length;

    let newLeads;
    let freshActivities;
    let oldLeadActivities;
    if (!range) {
      newLeads = rawLeads.length;
      freshActivities = activities;
      oldLeadActivities = 0;
    } else {
      const { start, end } = range;
      newLeads = rawLeads.filter((lead) => {
        const created = new Date(lead.createdAt);
        return created >= start && created <= end;
      }).length;
      const freshActivityLeads = activityLeads.filter((lead) => new Date(lead.createdAt) >= start);
      freshActivities = freshActivityLeads.reduce((sum, lead) => sum + (Number(lead.registeredCourseActivityUpdates) || 0), 0);
      const oldActivityLeads = activityLeads.filter((lead) => new Date(lead.createdAt) < start);
      oldLeadActivities = oldActivityLeads.reduce((sum, lead) => sum + (Number(lead.registeredCourseActivityUpdates) || 0), 0);
    }

    return {
      counselor,
      activities,
      courseEntries: formatBreakdownEntries(activityLeads, "courseName"),
      newLeads,
      freshActivities,
      oldLeadActivities,
      dialed,
      interested,
      notInterested
    };
  }));
}

function renderPreMonitoringTable(container, rows) {
  const html = `
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Counselor Name</th>
            <th>Total Activities Completed</th>
            <th>Workshop-wise Activity Breakdown</th>
            <th>Interested Leads</th>
            <th>Not Interested Leads</th>
            <th>WhatsApp Group Joined</th>
            <th>New Leads Received</th>
            <th>Fresh Lead Activities</th>
            <th>Old Lead Activities</th>
          </tr>
        </thead>
        <tbody>
          ${
            rows.length
              ? rows
                  .map(
                    (row) => `
                    <tr>
                      <td>${escapeHtml(row.counselor)}</td>
                      <td>${row.activities}</td>
                      <td>${renderBreakdownCell(row.workshopEntries, "No workshop activity")}</td>
                      <td>${row.interested}</td>
                      <td>${row.notInterested}</td>
                      <td>${row.whatsappJoined}</td>
                      <td>${row.newLeads}</td>
                      <td>${row.freshActivities}</td>
                      <td>${row.oldLeadActivities}</td>
                    </tr>
                  `
                  )
                  .join("")
              : `<tr><td colspan="9">No monitoring data available.</td></tr>`
          }
        </tbody>
      </table>
    </div>
  `;

  container.innerHTML = html;
}

function renderPostMonitoringTable(container, rows) {
  const html = `
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Counselor Name</th>
            <th>Total Activities Completed</th>
            <th>Workshop-wise Activity Breakdown</th>
            <th>Interested Leads</th>
            <th>Not Interested Leads</th>
            <th>Enrolled</th>
            <th>Won</th>
            <th>New Leads Received</th>
            <th>Fresh Lead Activities</th>
            <th>Old Lead Activities</th>
          </tr>
        </thead>
        <tbody>
          ${
            rows.length
              ? rows
                  .map(
                    (row) => `
                    <tr>
                      <td>${escapeHtml(row.counselor)}</td>
                      <td>${row.activities}</td>
                      <td>${renderBreakdownCell(row.workshopEntries, "No workshop activity")}</td>
                      <td>${row.interested}</td>
                      <td>${row.notInterested}</td>
                      <td>${row.enrolled}</td>
                      <td>${row.won}</td>
                      <td>${row.newLeads}</td>
                      <td>${row.freshActivities}</td>
                      <td>${row.oldLeadActivities}</td>
                    </tr>
                  `
                  )
                  .join("")
              : `<tr><td colspan="10">No monitoring data available.</td></tr>`
          }
        </tbody>
      </table>
    </div>
  `;

  container.innerHTML = html;
}

function renderRegisteredMonitoringTable(container, rows) {
  const html = `
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Counselor Name</th>
            <th>Overall Activity</th>
            <th>Course-wise Activity Breakdown</th>
            <th>Fresh Leads Received</th>
            <th>Fresh Lead Activities</th>
            <th>Old Lead Activities</th>
            <th>Dialed Leads</th>
            <th>Interested Leads</th>
            <th>Not Interested Leads</th>
          </tr>
        </thead>
        <tbody>
          ${
            rows.length
              ? rows
                  .map(
                    (row) => `
                    <tr>
                      <td>${escapeHtml(row.counselor)}</td>
                      <td>${row.activities}</td>
                      <td>${renderBreakdownCell(row.courseEntries, "No course activity")}</td>
                      <td>${row.newLeads}</td>
                      <td>${row.freshActivities}</td>
                      <td>${row.oldLeadActivities}</td>
                      <td>${row.dialed}</td>
                      <td>${row.interested}</td>
                      <td>${row.notInterested}</td>
                    </tr>
                  `
                  )
                  .join("")
              : `<tr><td colspan="9">No monitoring data available.</td></tr>`
          }
        </tbody>
      </table>
    </div>
  `;

  container.innerHTML = html;
}

function getTimelineLabel() {
  if (timelineFilter.type === "overall") {
    return "Overall";
  }

  if (timelineFilter.type === "today") {
    return "Today";
  }

  if (timelineFilter.type === "week") {
    return "Week";
  }

  if (timelineFilter.type === "recent") {
    return "Last 30 Days";
  }

  if (timelineFilter.type === "custom") {
    if (!timelineFilter.startDate || !timelineFilter.endDate) {
      return "Custom Range";
    }

    return `${timelineFilter.startDate} to ${timelineFilter.endDate}`;
  }

  return "Monitoring Report";
}

function getVisibleKpiSnapshot() {
  return Array.from(monitoringKpiSection.querySelectorAll(".kpi-card")).map((card) => ({
    Metric: card.querySelector("p")?.textContent?.trim() || "",
    Value: card.querySelector("h2")?.textContent?.trim() || ""
  }));
}

function getVisibleTableSnapshot(container) {
  const table = container?.querySelector("table");
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

function exportMonitoringExcel() {
  if (typeof XLSX === "undefined") {
    setExportMessage("Excel export is unavailable because the spreadsheet library did not load.", true);
    return;
  }

  const workbook = XLSX.utils.book_new();
  const summaryRows = [
    { Metric: "Timeline", Value: getTimelineLabel() },
    ...getVisibleKpiSnapshot()
  ];

  const summarySheet = XLSX.utils.json_to_sheet(summaryRows);
  XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");

  const workshopTable = getVisibleTableSnapshot(preMonitoringTable);
  const workshopSheet = XLSX.utils.aoa_to_sheet([workshopTable.headers, ...workshopTable.rows]);
  XLSX.utils.book_append_sheet(workbook, workshopSheet, "Workshop Monitoring");

  const admissionTable = getVisibleTableSnapshot(postMonitoringTable);
  const admissionSheet = XLSX.utils.aoa_to_sheet([admissionTable.headers, ...admissionTable.rows]);
  XLSX.utils.book_append_sheet(workbook, admissionSheet, "Admission Monitoring");

  const registeredTable = getVisibleTableSnapshot(registeredMonitoringTable);
  const registeredSheet = XLSX.utils.aoa_to_sheet([registeredTable.headers, ...registeredTable.rows]);
  XLSX.utils.book_append_sheet(workbook, registeredSheet, "Registered Candidates");

  const fileName = `monitoring-report-${timelineFilter.type}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(workbook, fileName);
  setExportMessage("Excel report exported successfully.", false);
}

function renderKpis(allLeads, preLeads, postLeads, registeredLeads, rawAllLeads, range) {
  const preActivity = preLeads.reduce((sum, lead) => sum + (Number(lead.preActivityUpdates) || 0), 0);
  const postActivity = postLeads.reduce((sum, lead) => sum + (Number(lead.postActivityUpdates) || 0), 0);
  const registeredActivity = registeredLeads.reduce((sum, lead) => sum + (Number(lead.registeredCourseActivityUpdates) || 0), 0);
  const overallActivity = preActivity + postActivity + registeredActivity;

  let totalNewLeads, totalFreshActivities, totalOldTouched;
  if (!range) {
    totalNewLeads = rawAllLeads.length;
    totalFreshActivities = "-";
    totalOldTouched = "-";
  } else {
    const { start, end } = range;
    totalNewLeads = rawAllLeads.filter((lead) => {
      const created = new Date(lead.createdAt);
      return created >= start && created <= end;
    }).length;
    const freshLeads = allLeads.filter((lead) => new Date(lead.createdAt) >= start);
    totalFreshActivities = freshLeads.reduce(
      (sum, lead) => sum + (Number(lead.preActivityUpdates) || 0) + (Number(lead.postActivityUpdates) || 0) + (Number(lead.registeredCourseActivityUpdates) || 0),
      0
    );
    const oldLeadsInRange = allLeads.filter((lead) => new Date(lead.createdAt) < start);
    totalOldTouched = oldLeadsInRange.reduce(
      (sum, lead) => sum + (Number(lead.preActivityUpdates) || 0) + (Number(lead.postActivityUpdates) || 0) + (Number(lead.registeredCourseActivityUpdates) || 0),
      0
    );
  }

  monitoringKpiSection.innerHTML = `
    <article class="card kpi-card">
      <p>Overall Activity</p>
      <h2>${overallActivity}</h2>
    </article>
    <article class="card kpi-card">
      <p>Workshop Calling Activity</p>
      <h2>${preActivity}</h2>
    </article>
    <article class="card kpi-card">
      <p>Admission Calling Activity</p>
      <h2>${postActivity}</h2>
    </article>
    <article class="card kpi-card">
      <p>Registered Candidate Activity</p>
      <h2>${registeredActivity}</h2>
    </article>
    <article class="card kpi-card">
      <p>New Leads Received</p>
      <h2>${totalNewLeads}</h2>
    </article>
    <article class="card kpi-card">
      <p>Fresh Lead Activities</p>
      <h2>${totalFreshActivities}</h2>
    </article>
    <article class="card kpi-card">
      <p>Old Lead Activities</p>
      <h2>${totalOldTouched}</h2>
    </article>
  `;
}

function renderAll() {
  const range = getTimelineRange();
  const rawAllLeads = getScopedLeads(getAllLeads()).filter((lead) => !isMainAdmissionLead(lead));
  const timelineLeads = applyTimelineFilter(getAllLeads()).filter((lead) => !isMainAdmissionLead(lead));
  const allLeads = getScopedLeads(timelineLeads);
  const preLeads = getPreLeads(allLeads);
  const postLeads = getPostLeads(allLeads);
  const registeredLeads = getRegisteredCandidateLeads(allLeads);
  const rawPreLeads = rawAllLeads.filter((lead) => !isNonWorkshopPipelineLead(lead) && !isLostLead(lead));
  const rawPostLeads = rawAllLeads.filter((lead) => !isNonWorkshopPipelineLead(lead));
  const rawRegisteredLeads = rawAllLeads.filter(isCourseRegistrationLead);
  const counselors = getCounselorBuckets(allLeads);

  renderKpis(allLeads, preLeads, postLeads, registeredLeads, rawAllLeads, range);

  const preRows = buildPreRows(counselors, preLeads, rawPreLeads, range);
  renderPreMonitoringTable(preMonitoringTable, preRows);

  const postRows = buildPostRows(counselors, postLeads, rawPostLeads, range);
  renderPostMonitoringTable(postMonitoringTable, postRows);

  const registeredRows = buildRegisteredRows(counselors, registeredLeads, rawRegisteredLeads, range);
  renderRegisteredMonitoringTable(registeredMonitoringTable, registeredRows);

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
