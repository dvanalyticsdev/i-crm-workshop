import { registerPageCleanup } from "./page-runtime.js";
import { bootstrapLocalState, getSession, getCounselors } from "./state-sync.js";
import { apiUrl } from "./api-client.js";

await bootstrapLocalState();

const session = getSession();
if (!session || !["admin", "marketing"].includes(session.role)) {
  window.location.href = "index.html";
  throw new Error("Access required.");
}

const integrationSectionNav = document.getElementById("integrationSectionNav");
const webhookUrlInput = document.getElementById("webhookUrl");
const copyWebhookUrlBtn = document.getElementById("copyWebhookUrlBtn");
const apiBaseUrlInput = document.getElementById("apiBaseUrlInput");
const clickToCallPathInput = document.getElementById("clickToCallPathInput");
const clickToCallMethodSelect = document.getElementById("clickToCallMethodSelect");
const outboundRefUrlInput = document.getElementById("outboundRefUrlInput");
const defaultExecutiveNumberInput = document.getElementById("defaultExecutiveNumberInput");
const accountTokenInput = document.getElementById("accountTokenInput");
const webhookSecretInput = document.getElementById("webhookSecretInput");
const accountTokenStatus = document.getElementById("accountTokenStatus");
const webhookSecretStatus = document.getElementById("webhookSecretStatus");
const defaultExecutiveNumberStatus = document.getElementById("defaultExecutiveNumberStatus");
const enabledToggle = document.getElementById("enabledToggle");
const enableClickToCallToggle = document.getElementById("enableClickToCallToggle");
const enableEventSyncToggle = document.getElementById("enableEventSyncToggle");
const enableAutoLeadCreateToggle = document.getElementById("enableAutoLeadCreateToggle");
const enableAutoTaskCreationToggle = document.getElementById("enableAutoTaskCreationToggle");
const enableIncomingPopupToggle = document.getElementById("enableIncomingPopupToggle");
const enableRecordingLinksToggle = document.getElementById("enableRecordingLinksToggle");
const enableCallStatusSyncToggle = document.getElementById("enableCallStatusSyncToggle");
const enableNotificationsToggle = document.getElementById("enableNotificationsToggle");
const saveConfigBtn = document.getElementById("saveConfigBtn");
const saveConfigMessage = document.getElementById("saveConfigMessage");
const rrIndexDisplay = document.getElementById("rrIndexDisplay");
const rrNextCounselor = document.getElementById("rrNextCounselor");
const rrCounselorCount = document.getElementById("rrCounselorCount");
const resetRrBtn = document.getElementById("resetRrBtn");
const rrMessage = document.getElementById("rrMessage");
const validateConfigBtn = document.getElementById("validateConfigBtn");
const validateMessage = document.getElementById("validateMessage");
const validationTableBody = document.getElementById("validationTableBody");
const tokenSummaryText = document.getElementById("tokenSummaryText");
const refreshLogsBtn = document.getElementById("refreshLogsBtn");
const clearLogsBtn = document.getElementById("clearLogsBtn");
const logsTableBody = document.getElementById("logsTableBody");
const logTypeFilter = document.getElementById("logTypeFilter");
const logSummarySuccess = document.getElementById("logSummarySuccess");
const logSummaryIgnored = document.getElementById("logSummaryIgnored");
const logSummaryError = document.getElementById("logSummaryError");

let allLogs = [];

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

function looksLikeMcubeToken(value) {
  const text = String(value || "").trim();
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(text) || /^eyJ[A-Za-z0-9_-]{20,}/.test(text);
}

function getMcubeEndpointInputError(apiBaseUrl, clickToCallPath) {
  if (looksLikeMcubeToken(apiBaseUrl)) {
    return "API Base URL looks like the MCUBE account token. Use https://api.mcube.com there.";
  }
  if (looksLikeMcubeToken(clickToCallPath)) {
    return "Click-to-Call Path looks like the MCUBE account token. Use /Restmcube-api/outbound-calls there and put the token only in Account Token.";
  }
  try {
    const url = new URL(apiBaseUrl);
    if (!["http:", "https:"].includes(url.protocol)) {
      return "API Base URL must start with http:// or https://.";
    }
  } catch {
    return "API Base URL must be valid, for example https://api.mcube.com.";
  }
  if (/^https?:\/\//i.test(clickToCallPath)) {
    return "Click-to-Call Path should be only /Restmcube-api/outbound-calls, not a full URL.";
  }
  if (!String(clickToCallPath || "").trim().startsWith("/")) {
    return "Click-to-Call Path must start with /, for example /Restmcube-api/outbound-calls.";
  }
  return "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatTime(iso) {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "medium" });
  } catch {
    return iso;
  }
}

function formatLeadPipeline(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "main-admission") return "Main Admission";
  if (normalized === "course-registration") return "Registered Course";
  if (normalized === "admission") return "Admission";
  if (normalized === "workshop") return "Workshop";
  return value ? String(value) : "-";
}

function renderStack(primary, secondary = "") {
  return `
    <div class="log-stack">
      <span class="log-stack__primary">${escapeHtml(primary || "-")}</span>
      ${secondary ? `<span class="log-stack__secondary">${escapeHtml(secondary)}</span>` : ""}
    </div>
  `;
}

function renderAssignment(log) {
  const counselor = String(log.counselor || "").trim();
  const status = String(log.assignmentStatus || (counselor && counselor.toLowerCase() !== "unassigned" ? "Assigned" : "Unassigned")).trim();
  const isAssigned = status.toLowerCase() === "assigned";
  const label = isAssigned && counselor ? `Assigned to ${counselor}` : "Unassigned";
  const detail = isAssigned ? "Lead owner" : "Admin can assign from Main Admission";
  return renderStack(label, detail);
}

function renderCallHandling(log) {
  const pickedBy = String(log.pickedBy || "").trim();
  const pickedByPhone = String(log.pickedByPhone || "").trim();
  const exactStatus = String(log.callDisposition || log.eventType || log.normalizedStatus || "").trim();
  const normalizedStatus = String(log.normalizedStatus || "").trim();
  const direction = String(log.direction || "").trim();
  const missedStatus = /(cancel|missed|no\s*answer|unanswered|busy|failed|reject|declin|timeout|not\s*reachable|switched\s*off|\bdnp\b|\bcnc\b)/i.test(exactStatus || normalizedStatus);
  const answered = !missedStatus && (log.callAnswered === true || !!pickedBy);
  const primary = exactStatus || (answered ? "Answered" : "Unknown status");
  const outcome = answered
    ? `Picked${pickedBy ? ` by ${pickedBy}` : ""}`
    : "Not picked";
  const details = [
    outcome,
    pickedByPhone ? `Agent: ${pickedByPhone}` : "",
    normalizedStatus && normalizedStatus !== exactStatus ? `CRM status: ${normalizedStatus}` : "",
    direction ? `Direction: ${direction}` : ""
  ].filter(Boolean).join(" | ");
  return renderStack(primary, details);
}

function buildWebhookUrl() {
  return apiUrl("/api/mcube/webhook");
}

function isCounselorInRotation(counselor) {
  return counselor?.roundRobinEnabled !== false && !counselor?.disabled;
}

function setStatusPill(pillId, valueId, ok, label) {
  const pill = document.getElementById(pillId);
  const value = document.getElementById(valueId);
  if (!pill || !value) return;
  pill.className = `status-pill ${ok ? "status-pill--ok" : "status-pill--err"}`;
  value.textContent = label;
}

function renderIntegrationSectionNav(activeRoute = "mcube-integration.html") {
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
      description: "Manage counselor rotation, branch routing, and course-wise lead eligibility."
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
      <p>Switch between lead-source and calling integrations from one shared area.</p>
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
        window.location.href = route;
      }
    };
  });
}

function renderRotationSnapshot(rrIdx = 0) {
  const counselors = getCounselors().filter(isCounselorInRotation);
  rrCounselorCount.textContent = String(counselors.length);
  if (!counselors.length) {
    rrNextCounselor.textContent = "No counselors";
    return;
  }
  const idx = (rrIdx % counselors.length + counselors.length) % counselors.length;
  rrNextCounselor.textContent = counselors[idx]?.name || "-";
}

function normalizeLogSummary(summary = {}) {
  return {
    success: Number(summary?.success) || 0,
    ignored: Number(summary?.ignored) || 0,
    error: Number(summary?.error) || 0
  };
}

function renderLogSummary(summary = {}) {
  const counts = normalizeLogSummary(summary);
  logSummarySuccess.textContent = String(counts.success);
  logSummaryIgnored.textContent = String(counts.ignored);
  logSummaryError.textContent = String(counts.error);
}

async function loadConfig() {
  try {
    const res = await fetch(apiUrl("/api/mcube/config"), { credentials: "same-origin" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    showMessage(saveConfigMessage, `Failed to load config: ${err.message}`, true);
    return null;
  }
}

function applyConfig(config) {
  if (!config) return;

  webhookUrlInput.value = buildWebhookUrl();
  apiBaseUrlInput.value = config.apiBaseUrl || "";
  clickToCallPathInput.value = config.clickToCallPath || "";
  clickToCallMethodSelect.value = config.clickToCallMethod || "POST";
  outboundRefUrlInput.value = config.outboundRefUrl || "1";
  enabledToggle.checked = !!config.enabled;
  enableClickToCallToggle.checked = config.enableClickToCall !== false;
  enableEventSyncToggle.checked = config.enableEventSync !== false;
  enableAutoLeadCreateToggle.checked = config.enableAutoLeadCreate !== false;
  enableAutoTaskCreationToggle.checked = config.enableAutoTaskCreation !== false;
  enableIncomingPopupToggle.checked = config.enableIncomingPopup !== false;
  enableRecordingLinksToggle.checked = config.enableRecordingLinks !== false;
  enableCallStatusSyncToggle.checked = config.enableCallStatusSync !== false;
  enableNotificationsToggle.checked = config.enableNotifications !== false;
  rrIndexDisplay.textContent = String(Number(config.roundRobinIndex) || 0);
  renderRotationSnapshot(Number(config.roundRobinIndex) || 0);

  setStatusPill("statusPillIntegration", "statusValIntegration", !!config.enabled, config.enabled ? "Enabled" : "Disabled");
  setStatusPill("statusPillBaseUrl", "statusValBaseUrl", !!config.apiBaseUrl, config.apiBaseUrl ? "Configured" : "Not set");
  setStatusPill("statusPillToken", "statusValToken", !!config.accountTokenSet, config.accountTokenSet ? "Configured" : "Not set");
  setStatusPill("statusPillWebhook", "statusValWebhook", !!config.webhookSecretSet, config.webhookSecretSet ? "Configured" : "Optional");

  accountTokenStatus.textContent = config.accountTokenSet ? "Saved" : "Not set";
  accountTokenStatus.className = `cred-status ${config.accountTokenSet ? "cred-status--ok" : "cred-status--err"}`;
  webhookSecretStatus.textContent = config.webhookSecretSet ? "Saved" : "Optional";
  webhookSecretStatus.className = `cred-status ${config.webhookSecretSet ? "cred-status--ok" : ""}`;
  defaultExecutiveNumberStatus.textContent = config.defaultExecutiveNumberSet ? "Saved" : "Optional";
  defaultExecutiveNumberStatus.className = `cred-status ${config.defaultExecutiveNumberSet ? "cred-status--ok" : ""}`;

  if (config.tokenSummary) {
    const summary = config.tokenSummary;
    tokenSummaryText.textContent = `Token issuer: ${summary.issuer || "-"}, business ID: ${summary.businessId || "-"}, issued: ${summary.issuedAt || "-"}, expires: ${summary.expiresAt || "-"}.`;
  }
}

async function saveConfig() {
  saveConfigBtn.disabled = true;
  showMessage(saveConfigMessage, "Saving...");

  try {
    const endpointError = getMcubeEndpointInputError(apiBaseUrlInput.value.trim(), clickToCallPathInput.value.trim());
    if (endpointError) {
      throw new Error(endpointError);
    }

    const payload = {
      enabled: enabledToggle.checked,
      apiBaseUrl: apiBaseUrlInput.value.trim(),
      clickToCallPath: clickToCallPathInput.value.trim(),
      clickToCallMethod: clickToCallMethodSelect.value,
      outboundRefUrl: outboundRefUrlInput.value.trim() || "1",
      enableClickToCall: enableClickToCallToggle.checked,
      enableEventSync: enableEventSyncToggle.checked,
      enableAutoLeadCreate: enableAutoLeadCreateToggle.checked,
      enableAutoTaskCreation: enableAutoTaskCreationToggle.checked,
      enableIncomingPopup: enableIncomingPopupToggle.checked,
      enableRecordingLinks: enableRecordingLinksToggle.checked,
      enableCallStatusSync: enableCallStatusSyncToggle.checked,
      enableNotifications: enableNotificationsToggle.checked
    };

    const accountToken = accountTokenInput.value.trim();
    if (accountToken) payload.accountToken = accountToken;
    const webhookSecret = webhookSecretInput.value.trim();
    if (webhookSecret) payload.webhookSecret = webhookSecret;
    const defaultExecutiveNumber = defaultExecutiveNumberInput.value.trim();
    if (defaultExecutiveNumber) payload.defaultExecutiveNumber = defaultExecutiveNumber;

    const res = await fetch(apiUrl("/api/mcube/config"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || `HTTP ${res.status}`);

    accountTokenInput.value = "";
    webhookSecretInput.value = "";
    defaultExecutiveNumberInput.value = "";
    applyConfig(json);
    renderLogSummary(json.logSummary);
    showMessage(saveConfigMessage, "Settings saved successfully.");
  } catch (err) {
    showMessage(saveConfigMessage, `Save failed: ${err.message}`, true);
  } finally {
    saveConfigBtn.disabled = false;
  }
}

function renderValidation(payload) {
  const checks = Array.isArray(payload?.checks) ? payload.checks : [];
  if (!checks.length) {
    validationTableBody.innerHTML = '<tr><td colspan="2" class="log-empty">No checks returned.</td></tr>';
  } else {
    validationTableBody.innerHTML = checks.map((check) => `
      <tr>
        <td>${escapeHtml(check.label || "-")}</td>
        <td><span class="log-type ${check.ok ? "log-type--success" : "log-type--error"}">${check.ok ? "Ready" : "Missing"}</span></td>
      </tr>
    `).join("");
  }

  const summary = payload?.tokenSummary;
  if (!summary) {
    tokenSummaryText.textContent = payload?.message || "Token summary is not available.";
    return;
  }
  tokenSummaryText.textContent = `Token issuer: ${summary.issuer || "-"}, business ID: ${summary.businessId || "-"}, issued: ${summary.issuedAt || "-"}, expires: ${summary.expiresAt || "-"}, expired: ${summary.isExpired ? "Yes" : "No"}.`;
}

async function validateConfig() {
  validateConfigBtn.disabled = true;
  showMessage(validateMessage, "Validating...");
  try {
    const res = await fetch(apiUrl("/api/mcube/test"), {
      method: "POST",
      credentials: "same-origin"
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || `HTTP ${res.status}`);
    renderValidation(json);
    showMessage(validateMessage, "Validation completed.");
  } catch (err) {
    showMessage(validateMessage, `Validation failed: ${err.message}`, true);
  } finally {
    validateConfigBtn.disabled = false;
  }
}

function renderLogs(logs) {
  const filter = logTypeFilter.value || "all";
  const filtered = filter === "all" ? logs : logs.filter((log) => log.type === filter);

  if (!filtered.length) {
    logsTableBody.innerHTML = '<tr><td colspan="7" class="log-empty">No events match the selected filter.</td></tr>';
    return;
  }

  logsTableBody.innerHTML = filtered.map((log) => `
    <tr>
      <td style="white-space:nowrap;font-size:.78rem;opacity:.7;">${escapeHtml(formatTime(log.receivedAt))}</td>
      <td><span class="log-type log-type--${escapeHtml(log.type || "ignored")}">${escapeHtml(log.type || "?")}</span></td>
      <td>${escapeHtml(log.message || "")}</td>
      <td>${renderStack(log.leadName || log.leadId || "-", formatLeadPipeline(log.leadPipeline))}</td>
      <td>${renderAssignment(log)}</td>
      <td>${renderCallHandling(log)}</td>
      <td>${renderStack(log.phone || "-", log.callId ? `Call ID: ${log.callId}` : "")}</td>
    </tr>
  `).join("");
}

async function loadLogs() {
  logsTableBody.innerHTML = '<tr><td colspan="7" class="log-empty">Loading...</td></tr>';
  try {
    const res = await fetch(apiUrl("/api/mcube/logs?limit=50"), { credentials: "same-origin" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    allLogs = Array.isArray(payload?.logs) ? payload.logs : [];
    renderLogSummary(payload?.summary);
    renderLogs(allLogs);
  } catch (err) {
    allLogs = [];
    renderLogSummary();
    logsTableBody.innerHTML = `<tr><td colspan="7" class="log-empty" style="color:var(--danger)">Failed to load logs: ${escapeHtml(err.message)}</td></tr>`;
  }
}

async function clearLogs() {
  if (!window.confirm("Clear all MCUBE logs? This cannot be undone.")) return;
  clearLogsBtn.disabled = true;
  try {
    const res = await fetch(apiUrl("/api/mcube/logs"), {
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
  if (!window.confirm("Reset the MCUBE lead count to 0?")) return;
  resetRrBtn.disabled = true;
  showMessage(rrMessage, "Resetting...");
  try {
    const res = await fetch(apiUrl("/api/mcube/rr-state/reset"), {
      method: "POST",
      credentials: "same-origin"
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || `HTTP ${res.status}`);
    rrIndexDisplay.textContent = "0";
    renderRotationSnapshot(0);
    showMessage(rrMessage, "MCUBE lead count reset.");
  } catch (err) {
    showMessage(rrMessage, `Reset failed: ${err.message}`, true);
  } finally {
    resetRrBtn.disabled = false;
  }
}

document.querySelectorAll(".toggle-secret-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const targetId = btn.dataset.target;
    const input = document.getElementById(targetId);
    if (!input) return;
    const isShowing = input.type === "text";
    input.type = isShowing ? "password" : "text";
    btn.textContent = isShowing ? "Show" : "Hide";
  });
});

[accountTokenInput, webhookSecretInput].forEach((input) => {
  input.readOnly = true;
  const unlockInput = () => {
    input.readOnly = false;
  };
  input.addEventListener("focus", unlockInput, { once: true });
  input.addEventListener("pointerdown", unlockInput, { once: true });
});

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

saveConfigBtn.addEventListener("click", saveConfig);
validateConfigBtn.addEventListener("click", validateConfig);
refreshLogsBtn.addEventListener("click", loadLogs);
clearLogsBtn.addEventListener("click", clearLogs);
resetRrBtn.addEventListener("click", resetRoundRobin);
logTypeFilter.addEventListener("change", () => renderLogs(allLogs));

if (session.role !== "admin") {
  clearLogsBtn.disabled = true;
  resetRrBtn.disabled = true;
}

webhookUrlInput.value = buildWebhookUrl();
renderIntegrationSectionNav();
const config = await loadConfig();
applyConfig(config);
renderLogSummary(config?.logSummary);
await loadLogs();
registerPageCleanup(() => undefined);
