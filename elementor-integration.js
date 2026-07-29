import { registerPageCleanup } from "./page-runtime.js";
import { bootstrapLocalState, getSession } from "./state-sync.js";
import { apiUrl } from "./api-client.js";
import { formatKolkataDateTime } from "./date-utils.js";

await bootstrapLocalState({ skipStateRefresh: true });

const session = getSession();
if (!session || !["super_admin", "admin", "marketing"].includes(session.role)) {
  window.location.href = "index.html";
  throw new Error("Access required.");
}
const isAdminLike = session.role === "admin" || session.role === "super_admin";

const webhookUrlInput = document.getElementById("webhookUrl");
const integrationSectionNav = document.getElementById("integrationSectionNav");
const copyWebhookUrlBtn = document.getElementById("copyWebhookUrlBtn");
const enabledToggle = document.getElementById("enabledToggle");
const saveConfigBtn = document.getElementById("saveConfigBtn");
const saveConfigMessage = document.getElementById("saveConfigMessage");
const rrIndexDisplay = document.getElementById("rrIndexDisplay");
const rrNextCounselor = document.getElementById("rrNextCounselor");
const rrCounselorCount = document.getElementById("rrCounselorCount");
const admissionRrCounselorCount = document.getElementById("admissionRrCounselorCount");
const resetRrBtn = document.getElementById("resetRrBtn");
const rrMessage = document.getElementById("rrMessage");
const refreshLogsBtn = document.getElementById("refreshLogsBtn");
const clearLogsBtn = document.getElementById("clearLogsBtn");
const logsTableBody = document.getElementById("logsTableBody");
const logTypeFilter = document.getElementById("logTypeFilter");
const logSummarySuccess = document.getElementById("logSummarySuccess");
const logSummaryIgnored = document.getElementById("logSummaryIgnored");
const logSummaryError = document.getElementById("logSummaryError");
const retryQueueCount = document.getElementById("retryQueueCount");
const retryQueueWrap = document.getElementById("retryQueueWrap");

const listRefs = {
  allowedFormIds: document.getElementById("allowedFormIdsList"),
  workshopFormIds: document.getElementById("workshopFormIdsList"),
  admissionFormIds: document.getElementById("admissionFormIdsList"),
  workshopFormNames: document.getElementById("workshopFormNamesList"),
  admissionFormNames: document.getElementById("admissionFormNamesList"),
  workshopPagePatterns: document.getElementById("workshopPagePatternsList"),
  admissionPagePatterns: document.getElementById("admissionPagePatternsList")
};

const addButtons = [
  ["addAllowedFormIdBtn", "allowedFormIds", "Allowed Form ID"],
  ["addWorkshopFormIdBtn", "workshopFormIds", "Workshop Form ID"],
  ["addAdmissionFormIdBtn", "admissionFormIds", "Admission Form ID"],
  ["addWorkshopFormNameBtn", "workshopFormNames", "Workshop Form Name"],
  ["addAdmissionFormNameBtn", "admissionFormNames", "Admission Form Name"],
  ["addWorkshopPagePatternBtn", "workshopPagePatterns", "Workshop URL Pattern"],
  ["addAdmissionPagePatternBtn", "admissionPagePatterns", "Admission URL Pattern"]
];

let allLogs = [];
let retryJobs = [];
let integrationCounselors = [];

function showMessage(el, text, isError = false) {
  if (!el) return;
  el.textContent = text;
  el.style.color = isError ? "var(--danger, #ef4444)" : "var(--success, #22c55e)";
  if (text) {
    setTimeout(() => {
      if (el.textContent === text) {
        el.textContent = "";
      }
    }, 5000);
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatTime(iso) {
  if (!iso) return "—";
  try {
    return formatKolkataDateTime(iso, iso);
  } catch {
    return iso;
  }
}

function setStatusPill(pillId, valueId, ok, label) {
  const pill = document.getElementById(pillId);
  const value = document.getElementById(valueId);
  if (!pill || !value) return;
  pill.className = `status-pill ${ok ? "status-pill--ok" : "status-pill--err"}`;
  value.textContent = label;
}

function buildWebhookUrl() {
  return apiUrl("/api/webhook/elementor-lead");
}

function isCounselorInWorkshopRotation(counselor) {
  return counselor?.roundRobinEnabled !== false && !counselor?.disabled;
}

function isCounselorInAdmissionRotation(counselor) {
  return counselor?.admissionRoundRobinEnabled === true && !counselor?.disabled;
}

function renderIntegrationSectionNav(activeRoute = "elementor-integration.html") {
  if (!integrationSectionNav) {
    return;
  }

  const sections = [
    {
      route: "meta-integration.html",
      label: "Meta",
      description: "Manage Facebook and Instagram lead capture, webhook setup, and lead filters."
    },
    {
      route: "elementor-integration.html",
      label: "Elementor",
      description: "Manage Elementor webhook intake, form rules, and lead classification."
    },
    {
      route: "lead-flow-control.html",
      label: "Lead Flow Control",
      description: "Manage workshop counselor rotation for Meta and Elementor leads."
    },
    {
      route: "lead-inflow.html",
      label: "Lead Inflow",
      description: "Track incoming CRM leads by source, campaign, day, and duplicate inflow."
    },
    {
      route: "mcube-integration.html",
      label: "MCUBE",
      description: "Manage cloud telephony calling, webhook intake, click-to-call, and CRM call sync."
    }
  ];

  integrationSectionNav.innerHTML = `
    <div class="card-head">
      <h3>Integration Subsections</h3>
      <p>Use this section to switch between the connected lead sources instead of keeping each one in the sidebar.</p>
    </div>
    <div class="filter-actions" style="display:flex;gap:0.75rem;flex-wrap:wrap;">
      ${sections.map((section) => `
        <button
          type="button"
          class="${activeRoute === section.route ? "btn-primary" : "btn-ghost"}"
          data-integration-section="${section.route}"
        >
          ${escapeHtml(section.label)}
        </button>
      `).join("")}
    </div>
    <p class="block-help">${escapeHtml(sections.find((section) => section.route === activeRoute)?.description || "")}</p>
  `;

  integrationSectionNav.querySelectorAll("[data-integration-section]").forEach((button) => {
    button.onclick = () => {
      const route = button.getAttribute("data-integration-section");
      if (route && route !== window.location.pathname.split("/").pop()) {
        if (typeof window.__dvNavigateToRoute === "function") {
          void window.__dvNavigateToRoute(route);
          return;
        }
        window.location.href = route;
      }
    };
  });
}

function addRuleRow(container, placeholder, value = "") {
  const row = document.createElement("div");
  row.className = "form-id-row";
  row.innerHTML = `
    <input type="text" class="form-id-input" placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(value)}" />
    <button type="button" class="remove-form-id-btn" aria-label="Remove">×</button>
  `;
  row.querySelector(".remove-form-id-btn").addEventListener("click", () => row.remove());
  container.appendChild(row);
}

function renderRuleList(key, values = []) {
  const container = listRefs[key];
  if (!container) return;
  container.innerHTML = "";
  values.forEach((value) => addRuleRow(container, key, value));
}

function collectRuleList(key) {
  const container = listRefs[key];
  if (!container) return [];
  return Array.from(container.querySelectorAll(".form-id-input"))
    .map((input) => input.value.trim())
    .filter(Boolean);
}

function normalizeLogSummary(summary = {}) {
  return {
    success: Number(summary?.success) || 0,
    ignored: Number(summary?.ignored) || 0,
    error: Number(summary?.error) || 0
  };
}

function renderLogSummary(summary) {
  const counts = normalizeLogSummary(summary);
  logSummarySuccess.textContent = String(counts.success);
  logSummaryIgnored.textContent = String(counts.ignored);
  logSummaryError.textContent = String(counts.error);
}

function renderRetryQueue(jobs, errorMessage = "") {
  if (retryQueueCount) retryQueueCount.textContent = `${jobs.length} active`;
  if (!retryQueueWrap) return;
  if (errorMessage) {
    retryQueueWrap.innerHTML = `<div class="retry-panel__empty" style="color:var(--danger)">Failed to load pending errors: ${escapeHtml(errorMessage)}</div>`;
    return;
  }
  if (!jobs.length) {
    retryQueueWrap.innerHTML = '<div class="retry-panel__empty">No pending errors. When a failed submission is retried successfully, it disappears from this list and shows up in Success logs.</div>';
    return;
  }
  retryQueueWrap.innerHTML = `
    <table class="retry-table">
      <thead>
        <tr>
          <th>Form / Page</th>
          <th>Status</th>
          <th>Attempts</th>
          <th>Next Retry</th>
          <th>Last Error</th>
        </tr>
      </thead>
      <tbody>
        ${jobs.map((job) => `
          <tr>
            <td>${escapeHtml([job.formName || job.formId || "-", job.pageUrl || "-"].join(" / "))}</td>
            <td><span class="retry-badge">Pending Retry</span></td>
            <td>${escapeHtml(String(job.attempts || 0))}</td>
            <td>${escapeHtml(formatTime(job.nextAttemptAt))}</td>
            <td>${escapeHtml(job.lastError || job.reason || "-")}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function updateRotationSnapshot(rrIdx = 0) {
  const counselors = integrationCounselors;
  const workshopCounselors = counselors.filter(isCounselorInWorkshopRotation);
  const admissionCounselors = counselors.filter(isCounselorInAdmissionRotation);
  rrCounselorCount.textContent = String(workshopCounselors.length);
  if (admissionRrCounselorCount) {
    admissionRrCounselorCount.textContent = String(admissionCounselors.length);
  }

  if (!workshopCounselors.length) {
    rrNextCounselor.textContent = "No counselors";
    return;
  }

  const idx = (rrIdx % workshopCounselors.length + workshopCounselors.length) % workshopCounselors.length;
  rrNextCounselor.textContent = workshopCounselors[idx]?.name || "—";
}

async function loadCounselors() {
  const response = await fetch(apiUrl("/api/counselors"), {
    credentials: "same-origin",
    headers: { Accept: "application/json" }
  });
  const payload = await response.json().catch(() => []);
  if (!response.ok) {
    throw new Error(payload?.message || "Failed to load counselors.");
  }
  integrationCounselors = Array.isArray(payload) ? payload : [];
  return integrationCounselors;
}

async function loadConfig() {
  try {
    const res = await fetch(apiUrl("/api/elementor/config"), { credentials: "same-origin" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    showMessage(saveConfigMessage, `Failed to load config: ${err.message}`, true);
    return null;
  }
}

function applyConfig(config) {
  if (!config) return;

  enabledToggle.checked = !!config.enabled;
  webhookUrlInput.value = buildWebhookUrl();
  rrIndexDisplay.textContent = String(Number(config.roundRobinIndex) || 0);
  updateRotationSnapshot(Number(config.roundRobinIndex) || 0);

  renderRuleList("allowedFormIds", config.allowedFormIds || []);
  renderRuleList("workshopFormIds", config.workshopFormIds || []);
  renderRuleList("admissionFormIds", config.admissionFormIds || []);
  renderRuleList("workshopFormNames", config.workshopFormNames || []);
  renderRuleList("admissionFormNames", config.admissionFormNames || []);
  renderRuleList("workshopPagePatterns", config.workshopPagePatterns || []);
  renderRuleList("admissionPagePatterns", config.admissionPagePatterns || []);

  setStatusPill(
    "statusPillIntegration",
    "statusValIntegration",
    !!config.enabled,
    config.enabled ? "Enabled" : "Disabled"
  );
  setStatusPill(
    "statusPillAllowedForms",
    "statusValAllowedForms",
    !(config.allowedFormIds || []).length || !!(config.allowedFormIds || []).length,
    (config.allowedFormIds || []).length ? `${config.allowedFormIds.length} configured` : "All forms"
  );
  setStatusPill(
    "statusPillWorkshopRules",
    "statusValWorkshopRules",
    !!((config.workshopFormIds || []).length || (config.workshopFormNames || []).length || (config.workshopPagePatterns || []).length),
    ((config.workshopFormIds || []).length || (config.workshopFormNames || []).length || (config.workshopPagePatterns || []).length)
      ? "Configured"
      : "Fallback only"
  );
  setStatusPill(
    "statusPillAdmissionRules",
    "statusValAdmissionRules",
    !!((config.admissionFormIds || []).length || (config.admissionFormNames || []).length || (config.admissionPagePatterns || []).length),
    ((config.admissionFormIds || []).length || (config.admissionFormNames || []).length || (config.admissionPagePatterns || []).length)
      ? "Configured"
      : "Fallback only"
  );
}

async function saveConfig() {
  saveConfigBtn.disabled = true;
  showMessage(saveConfigMessage, "Saving…");

  try {
    const payload = {
      enabled: enabledToggle.checked,
      allowedFormIds: collectRuleList("allowedFormIds"),
      workshopFormIds: collectRuleList("workshopFormIds"),
      admissionFormIds: collectRuleList("admissionFormIds"),
      workshopFormNames: collectRuleList("workshopFormNames"),
      admissionFormNames: collectRuleList("admissionFormNames"),
      workshopPagePatterns: collectRuleList("workshopPagePatterns"),
      admissionPagePatterns: collectRuleList("admissionPagePatterns")
    };

    const res = await fetch(apiUrl("/api/elementor/config"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || `HTTP ${res.status}`);

    applyConfig(json);
    showMessage(saveConfigMessage, "Settings saved successfully.");
  } catch (err) {
    showMessage(saveConfigMessage, `Save failed: ${err.message}`, true);
  } finally {
    saveConfigBtn.disabled = false;
  }
}

function renderLogs(logs) {
  const filter = logTypeFilter.value || "all";
  const filtered = filter === "all" ? logs : logs.filter((log) => log.type === filter);

  if (!filtered.length) {
    logsTableBody.innerHTML = '<tr><td colspan="5" class="log-empty">No events match the selected filter.</td></tr>';
    return;
  }

  logsTableBody.innerHTML = filtered.map((log) => {
    const typeClass = `log-type--${log.type || "ignored"}`;
    const leadInfo = log.leadName
      ? `${escapeHtml(log.leadName)} <span style="opacity:.5">→</span> ${escapeHtml(log.counselor || "")}`
      : "—";
    const formInfo = [log.formName || log.formId || "—", log.pageUrl || "—"].join(" / ");
    return `
      <tr>
        <td style="white-space:nowrap;font-size:.78rem;opacity:.7;">${escapeHtml(formatTime(log.receivedAt))}</td>
        <td><span class="log-type ${typeClass}">${escapeHtml(log.type || "?")}</span></td>
        <td>${escapeHtml(log.message || "")}</td>
        <td>${leadInfo}</td>
        <td>${escapeHtml(formInfo)}</td>
      </tr>
    `;
  }).join("");
}

async function loadLogs() {
  logsTableBody.innerHTML = '<tr><td colspan="5" class="log-empty">Loading…</td></tr>';
  try {
    const res = await fetch(apiUrl("/api/elementor/logs?limit=50"), { credentials: "same-origin" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    allLogs = Array.isArray(payload?.logs) ? payload.logs : [];
    renderLogSummary(payload?.summary);
    renderLogs(allLogs);
  } catch (err) {
    allLogs = [];
    renderLogSummary();
    logsTableBody.innerHTML = `<tr><td colspan="5" class="log-empty" style="color:var(--danger)">Failed to load logs: ${escapeHtml(err.message)}</td></tr>`;
  }
}

async function clearLogs() {
  if (!window.confirm("Clear all Elementor webhook logs? This cannot be undone.")) return;
  clearLogsBtn.disabled = true;
  try {
    const res = await fetch(apiUrl("/api/elementor/logs"), {
      method: "DELETE",
      credentials: "same-origin"
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    allLogs = [];
    renderLogSummary();
    renderLogs([]);
  } catch (err) {
    showMessage(rrMessage, `Failed to clear logs: ${err.message}`, true);
  } finally {
    clearLogsBtn.disabled = false;
  }
}

async function resetRoundRobin() {
  if (!window.confirm("Reset the Elementor lead count to 0? The next workshop lead will go to the first counselor in rotation.")) return;
  resetRrBtn.disabled = true;
  showMessage(rrMessage, "Resetting…");
  try {
    const res = await fetch(apiUrl("/api/elementor/rr-state/reset"), {
      method: "POST",
      credentials: "same-origin"
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || `HTTP ${res.status}`);
    rrIndexDisplay.textContent = "0";
    updateRotationSnapshot(0);
    showMessage(rrMessage, "Elementor lead count reset to 0.");
  } catch (err) {
    showMessage(rrMessage, `Reset failed: ${err.message}`, true);
  } finally {
    resetRrBtn.disabled = false;
  }
}

loadLogs = async function loadLogsWithRetryQueue() {
  logsTableBody.innerHTML = '<tr><td colspan="5" class="log-empty">Loading...</td></tr>';
  try {
    const [logsRes, retryRes] = await Promise.all([
      fetch(apiUrl("/api/elementor/logs?limit=50"), { credentials: "same-origin" }),
      fetch(apiUrl("/api/elementor/retry-jobs?limit=50"), { credentials: "same-origin" })
    ]);
    if (!logsRes.ok) throw new Error(`HTTP ${logsRes.status}`);
    if (!retryRes.ok) throw new Error(`HTTP ${retryRes.status}`);
    const payload = await logsRes.json();
    const retryPayload = await retryRes.json();
    allLogs = Array.isArray(payload?.logs) ? payload.logs : [];
    retryJobs = Array.isArray(retryPayload?.jobs) ? retryPayload.jobs : [];
    renderLogSummary(payload?.summary);
    renderRetryQueue(retryJobs);
    renderLogs(allLogs);
  } catch (err) {
    allLogs = [];
    retryJobs = [];
    renderLogSummary();
    renderRetryQueue(retryJobs, err.message);
    logsTableBody.innerHTML = `<tr><td colspan="5" class="log-empty" style="color:var(--danger)">Failed to load logs: ${escapeHtml(err.message)}</td></tr>`;
  }
};

clearLogs = async function clearLogsWithRetryQueue() {
  if (!window.confirm("Clear all Elementor webhook logs? This cannot be undone.")) return;
  clearLogsBtn.disabled = true;
  try {
    const res = await fetch(apiUrl("/api/elementor/logs"), {
      method: "DELETE",
      credentials: "same-origin"
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    allLogs = [];
    retryJobs = [];
    renderLogSummary();
    renderRetryQueue(retryJobs);
    renderLogs([]);
  } catch (err) {
    showMessage(rrMessage, `Failed to clear logs: ${err.message}`, true);
  } finally {
    clearLogsBtn.disabled = false;
  }
};

copyWebhookUrlBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(webhookUrlInput.value);
    copyWebhookUrlBtn.textContent = "Copied!";
    setTimeout(() => {
      copyWebhookUrlBtn.textContent = "Copy";
    }, 2000);
  } catch {
    webhookUrlInput.select();
  }
});

addButtons.forEach(([buttonId, key, label]) => {
  const button = document.getElementById(buttonId);
  if (!button) return;
  button.addEventListener("click", () => addRuleRow(listRefs[key], label));
});

saveConfigBtn.addEventListener("click", saveConfig);
refreshLogsBtn.addEventListener("click", loadLogs);
clearLogsBtn.addEventListener("click", clearLogs);
resetRrBtn.addEventListener("click", resetRoundRobin);
logTypeFilter.addEventListener("change", () => renderLogs(allLogs));

if (!isAdminLike) {
  clearLogsBtn.disabled = true;
  resetRrBtn.disabled = true;
}

webhookUrlInput.value = buildWebhookUrl();

renderIntegrationSectionNav();
await loadCounselors().catch((error) => showMessage(rrMessage, error.message, true));
const config = await loadConfig();
applyConfig(config);
await loadLogs();
window.__dvMarkRouteViewReady?.();
registerPageCleanup(() => undefined);
