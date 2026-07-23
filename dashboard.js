import { registerPageCleanup } from "./page-runtime.js";
import { onThemeChange, readThemePalette } from "./theme.js";
import { apiUrl } from "./api-client.js";
import { bootstrapLocalState, getSession, loadLocalPreference, saveLocalPreference, startStatePolling } from "./state-sync.js";

await bootstrapLocalState();

const trendRangeText = document.getElementById("trendRangeText");
const pieRangeText = document.getElementById("pieRangeText");

const timelinePreset = document.getElementById("timelinePreset");
const customRangeFields = document.getElementById("customRangeFields");
const startDateInput = document.getElementById("startDate");
const endDateInput = document.getElementById("endDate");
const activeRangeLabel = document.getElementById("activeRangeLabel");

const activeWorkshopsEl = document.getElementById("activeWorkshops");
const upcomingWorkshopsEl = document.getElementById("upcomingWorkshops");
const recentWorkshopsEl = document.getElementById("recentWorkshops");
const scopedLeadsEl = document.getElementById("scopedLeads");

const session = getSession();
if (!session || !session.role) {
  window.location.href = "index.html";
}

const TIMELINE_STORAGE_KEY = "dvWorkshopDashboardTimeline";
const DEFAULT_TIMELINE_STATE = {
  preset: "weekly",
  startDate: "",
  endDate: ""
};
const REFERENCE_TODAY = new Date();
const RECENT_WINDOW_DAYS = 30;
let dashboardSummary = {
  leadTimelineRows: [],
  updatedAt: null
};
const MONTH_LOOKUP = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11
};

const persistedTimelineState = {
  ...DEFAULT_TIMELINE_STATE,
  ...await loadLocalPreference(TIMELINE_STORAGE_KEY, {})
};

timelinePreset.value = persistedTimelineState.preset || DEFAULT_TIMELINE_STATE.preset;
startDateInput.value = persistedTimelineState.startDate || "";
endDateInput.value = persistedTimelineState.endDate || "";
customRangeFields.classList.toggle("hidden", timelinePreset.value !== "custom");

function persistTimelineState() {
  void saveLocalPreference(TIMELINE_STORAGE_KEY, {
    preset: timelinePreset.value,
    startDate: startDateInput.value,
    endDate: endDateInput.value
  });
}

async function loadDashboardSummary() {
  // Server summary already excludes ["course-registration", "main-admission"].
  const response = await fetch(apiUrl("/api/dashboard-summary"), {
    credentials: "same-origin",
    headers: { Accept: "application/json" }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.message || "Failed to load dashboard summary.");
  }
  dashboardSummary = {
    leadTimelineRows: Array.isArray(payload?.leadTimelineRows) ? payload.leadTimelineRows : [],
    updatedAt: payload?.updatedAt || null
  };
  return dashboardSummary;
}

function getLeads() {
  return Array.isArray(dashboardSummary?.leadTimelineRows) ? dashboardSummary.leadTimelineRows : [];
}

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateKey(dateKey) {
  const [year, month, day] = String(dateKey || "").split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function formatReadableDate(date) {
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function getLatestLeadDate(leads) {
  if (!leads.length) {
    return new Date(REFERENCE_TODAY);
  }

  return leads
    .map((lead) => parseDateKey(lead.createdAt))
    .sort((a, b) => a - b)
    .at(-1);
}

function getDateSequence(startDate, endDate) {
  const dates = [];
  const cursor = new Date(startDate);
  while (cursor <= endDate) {
    dates.push(toDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function getQuarterBounds(referenceDate) {
  const quarterStartMonth = Math.floor(referenceDate.getMonth() / 3) * 3;
  const start = new Date(referenceDate.getFullYear(), quarterStartMonth, 1);
  const end = new Date(referenceDate.getFullYear(), quarterStartMonth + 3, 0);
  return { start, end };
}

function getTimelineRange(leads) {
  const preset = timelinePreset.value;
  const referenceDate = getLatestLeadDate(leads);
  const start = new Date(referenceDate);
  const end = new Date(referenceDate);

  if (preset === "overall") {
    if (!leads.length) {
      return {
        start,
        end,
        label: "Overall: All available lead data"
      };
    }

    const dates = leads.map((lead) => parseDateKey(lead.createdAt)).sort((a, b) => a - b);
    return {
      start: dates[0],
      end: dates[dates.length - 1],
      label: "Overall: All available lead data"
    };
  }

  if (preset === "daily") {
    return {
      start,
      end,
      label: `Daily: ${formatReadableDate(start)}`
    };
  }

  if (preset === "weekly") {
    start.setDate(end.getDate() - 6);
    return {
      start,
      end,
      label: `Weekly: ${formatReadableDate(start)} - ${formatReadableDate(end)}`
    };
  }

  if (preset === "monthly") {
    const monthStart = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1);
    const monthEnd = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 0);
    return {
      start: monthStart,
      end: monthEnd,
      label: `Monthly: ${monthStart.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}`
    };
  }

  if (preset === "quarterly") {
    const quarter = getQuarterBounds(referenceDate);
    const quarterIndex = Math.floor(referenceDate.getMonth() / 3) + 1;
    return {
      start: quarter.start,
      end: quarter.end,
      label: `Quarterly: Q${quarterIndex} ${referenceDate.getFullYear()}`
    };
  }

  const customStart = startDateInput.value ? parseDateKey(startDateInput.value) : null;
  const customEnd = endDateInput.value ? parseDateKey(endDateInput.value) : null;

  if (!customStart || !customEnd || customStart > customEnd) {
    return {
      start: null,
      end: null,
      label: "Custom: Select a valid date range"
    };
  }

  return {
    start: customStart,
    end: customEnd,
    label: `Custom: ${formatReadableDate(customStart)} - ${formatReadableDate(customEnd)}`
  };
}

function filterLeadsByTimeline(leads, range) {
  if (!range.start || !range.end) {
    return [];
  }

  const startTime = range.start.getTime();
  const endTime = range.end.getTime();

  return leads.filter((lead) => {
    const leadTime = parseDateKey(lead.createdAt).getTime();
    return leadTime >= startTime && leadTime <= endTime;
  });
}

let trendChart;
let workshopBreakdownChart;

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

function getWorkshopSummaryIdentity(lead) {
  const fallbackName = getCoreWorkshopName(lead?.workshop);
  return {
    key: String(lead?.workshopKey || fallbackName).trim().toLowerCase(),
    label: String(lead?.workshop || fallbackName).trim()
  };
}

function extractWorkshopDate(workshopName) {
  const coreName = getCoreWorkshopName(workshopName);
  const match = coreName.match(/(\d{1,2})(?:st|nd|rd|th)\s+([A-Za-z]+)/i);
  if (!match) {
    return null;
  }

  const day = Number(match[1]);
  const monthIndex = MONTH_LOOKUP[String(match[2] || "").toLowerCase()];
  if (!Number.isFinite(day) || monthIndex == null) {
    return null;
  }

  return new Date(REFERENCE_TODAY.getFullYear(), monthIndex, day);
}

function getWorkshopBucket(workshopDate) {
  if (!(workshopDate instanceof Date) || Number.isNaN(workshopDate.getTime())) {
    return "recent";
  }

  const today = new Date(REFERENCE_TODAY);
  today.setHours(0, 0, 0, 0);
  const recentCutoff = new Date(today);
  recentCutoff.setDate(recentCutoff.getDate() - RECENT_WINDOW_DAYS);

  if (workshopDate > today) {
    return "upcoming";
  }
  if (workshopDate >= recentCutoff) {
    return "recent";
  }
  return "archived";
}

function buildWorkshopSummary(leads) {
  const workshopMap = new Map();

  leads.forEach((lead) => {
    const identity = getWorkshopSummaryIdentity(lead);
    if (!identity.key || !identity.label) {
      return;
    }

    const existing = workshopMap.get(identity.key) || {
      name: identity.label,
      workshopDate: extractWorkshopDate(identity.label),
      leadCount: 0
    };
    existing.leadCount += 1;
    workshopMap.set(identity.key, existing);
  });

  const workshops = Array.from(workshopMap.values());
  const sections = {
    upcoming: [],
    recent: [],
    archived: []
  };

  workshops.forEach((workshop) => {
    sections[getWorkshopBucket(workshop.workshopDate)].push(workshop);
  });

  sections.upcoming.sort((a, b) => a.workshopDate - b.workshopDate || b.leadCount - a.leadCount);
  sections.recent.sort((a, b) => b.workshopDate - a.workshopDate || b.leadCount - a.leadCount);
  sections.archived.sort((a, b) => b.workshopDate - a.workshopDate || b.leadCount - a.leadCount);

  return {
    workshops,
    sections
  };
}

function buildKpis(leads) {
  const summary = buildWorkshopSummary(leads);
  const activeWorkshops = summary.sections.upcoming.length + summary.sections.recent.length;

  activeWorkshopsEl.textContent = activeWorkshops;
  upcomingWorkshopsEl.textContent = summary.sections.upcoming.length;
  recentWorkshopsEl.textContent = summary.sections.recent.length;
  scopedLeadsEl.textContent = leads.length;
}

function getChartBreakdown(workshops) {
  const ranked = [...workshops].sort((a, b) => b.leadCount - a.leadCount);
  const topItems = ranked.slice(0, 8);
  const otherCount = ranked.slice(8).reduce((sum, item) => sum + item.leadCount, 0);

  const labels = topItems.map((item) => item.name);
  const values = topItems.map((item) => item.leadCount);
  if (otherCount) {
    labels.push("Others");
    values.push(otherCount);
  }

  return { labels, values };
}

function renderCharts(leads, range) {
  const trendCanvas = document.getElementById("newLeadsTrendChart");
  const breakdownCanvas = document.getElementById("workshopBreakdownChart");
  const palette = readThemePalette();

  const trendDates = range.start && range.end ? getDateSequence(range.start, range.end) : [];
  const trendCountMap = new Map();
  leads.forEach((lead) => {
    trendCountMap.set(lead.createdAt, (trendCountMap.get(lead.createdAt) || 0) + 1);
  });

  const trendCounts = trendDates.map((day) => trendCountMap.get(day) || 0);
  const workshopSummary = buildWorkshopSummary(leads);
  const chartBreakdown = getChartBreakdown(workshopSummary.workshops);

  if (trendChart) {
    trendChart.destroy();
  }
  if (workshopBreakdownChart) {
    workshopBreakdownChart.destroy();
  }

  trendChart = new Chart(trendCanvas, {
    type: "line",
    data: {
      labels: trendDates.map((day) => day.slice(5)),
      datasets: [
        {
          label: "New Leads",
          data: trendCounts,
          borderColor: palette.chartLine,
          backgroundColor: palette.chartFill,
          tension: 0.35,
          pointRadius: 4,
          pointHoverRadius: 5,
          fill: true
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        }
      },
      scales: {
        y: {
          ticks: { precision: 0 },
          beginAtZero: true,
          grid: {
            color: palette.chartGrid
          }
        },
        x: {
          grid: {
            display: false
          }
        }
      }
    }
  });

  workshopBreakdownChart = new Chart(breakdownCanvas, {
    type: "bar",
    data: {
      labels: chartBreakdown.labels,
      datasets: [
        {
          label: "Leads",
          data: chartBreakdown.values,
          backgroundColor: chartBreakdown.labels.map((_, index) => palette.chartSeries[index % palette.chartSeries.length]),
          borderRadius: 8,
          borderSkipped: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: "y",
      plugins: {
        legend: {
          display: false
        }
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: { precision: 0 },
          grid: {
            color: palette.chartGrid
          }
        },
        y: {
          grid: {
            display: false
          }
        }
      }
    }
  });

  trendRangeText.textContent = range.label;
  pieRangeText.textContent = `${range.label} | Top workshops`;
}

function hydrate(leads) {
  const range = getTimelineRange(leads);
  const filteredLeads = filterLeadsByTimeline(leads, range);

  activeRangeLabel.textContent = `${range.label} | Leads in range: ${filteredLeads.length}`;
  buildKpis(filteredLeads);
  renderCharts(filteredLeads, range);
}

await loadDashboardSummary();
hydrate(getLeads());
window.__dvMarkRouteViewReady?.();
const stopThemeListener = onThemeChange(() => {
  hydrate(getLeads());
});
const stopStatePolling = startStatePolling(async () => {
  await loadDashboardSummary().catch(() => undefined);
  hydrate(getLeads());
});
registerPageCleanup(() => {
  stopThemeListener();
  stopStatePolling();
  if (trendChart) {
    trendChart.destroy();
    trendChart = null;
  }
  if (workshopBreakdownChart) {
    workshopBreakdownChart.destroy();
    workshopBreakdownChart = null;
  }
});

timelinePreset.addEventListener("change", () => {
  const showCustom = timelinePreset.value === "custom";
  customRangeFields.classList.toggle("hidden", !showCustom);
  persistTimelineState();
  hydrate(getLeads());
});

startDateInput.addEventListener("change", () => {
  persistTimelineState();
  hydrate(getLeads());
});

endDateInput.addEventListener("change", () => {
  persistTimelineState();
  hydrate(getLeads());
});
