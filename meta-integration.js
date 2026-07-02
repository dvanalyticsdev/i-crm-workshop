import { registerPageCleanup } from "./page-runtime.js";
import { bootstrapLocalState, getSession, getCounselors, saveCounselors, startStatePolling } from "./state-sync.js";
import { apiUrl } from "./api-client.js";

await bootstrapLocalState();

const session = getSession();
if (!session || !["admin", "marketing"].includes(session.role)) {
  window.location.href = "index.html";
  throw new Error("Access required.");
}

// ── DOM refs ─────────────────────────────────────────────────────────────────

const integrationStatusBadge  = null; // replaced by status pills
const webhookUrlInput          = document.getElementById("webhookUrl");
const copyWebhookUrlBtn        = document.getElementById("copyWebhookUrlBtn");
const verifyTokenInput         = document.getElementById("verifyTokenInput");
const generateVerifyTokenBtn   = document.getElementById("generateVerifyTokenBtn");
const pageIdInput              = document.getElementById("pageIdInput");
const formIdsList              = document.getElementById("formIdsList");
const addFormIdBtn             = document.getElementById("addFormIdBtn");
const appSecretInput           = document.getElementById("appSecretInput");
const appSecretStatus          = document.getElementById("appSecretStatus");
const pageAccessTokenInput     = document.getElementById("pageAccessTokenInput");
const pageAccessTokenStatus    = document.getElementById("pageAccessTokenStatus");
const enabledToggle            = document.getElementById("enabledToggle");
const saveConfigBtn            = document.getElementById("saveConfigBtn");
const saveConfigMessage        = document.getElementById("saveConfigMessage");
const rrIndexDisplay           = document.getElementById("rrIndexDisplay");
const rrNextCounselor          = document.getElementById("rrNextCounselor");
const rrCounselorCount         = document.getElementById("rrCounselorCount");
const rrCounselorList          = document.getElementById("rrCounselorList");
const rrRosterMessage          = document.getElementById("rrRosterMessage");
const resetRrBtn               = document.getElementById("resetRrBtn");
const rrMessage                = document.getElementById("rrMessage");
const refreshLogsBtn           = document.getElementById("refreshLogsBtn");
const clearLogsBtn             = document.getElementById("clearLogsBtn");
const logsTableBody            = document.getElementById("logsTableBody");
const logTypeFilter            = document.getElementById("logTypeFilter");
const logSummarySuccess        = document.getElementById("logSummarySuccess");
const logSummaryIgnored        = document.getElementById("logSummaryIgnored");
const logSummaryError          = document.getElementById("logSummaryError");
const retryQueueCount          = document.getElementById("retryQueueCount");
const retryQueueWrap           = document.getElementById("retryQueueWrap");

// Raw log data (used for client-side filtering).
let allLogs = [];
let logSummary = { success: 0, ignored: 0, error: 0 };
let retryJobs = [];

// ── Helpers ───────────────────────────────────────────────────────────────────

function showMessage(el, text, isError = false) {
  if (!el) return;
  el.textContent = text;
  el.style.color = isError ? "var(--danger, #ef4444)" : "var(--success, #22c55e)";
  if (text) {
    setTimeout(() => { if (el.textContent === text) el.textContent = ""; }, 5000);
  }
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatTime(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "medium" });
  } catch {
    return iso;
  }
}

function generateToken(length = 32) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => chars[b % chars.length]).join("");
}

function buildWebhookUrl() {
  return apiUrl("/api/meta/webhook");
}

function isCounselorInMetaRotation(counselor) {
  return counselor?.roundRobinEnabled !== false && !counselor?.disabled;
}

// ── Config load / render ──────────────────────────────────────────────────────

async function loadConfig() {
  try {
    const res = await fetch(apiUrl("/api/meta/config"), { credentials: "same-origin" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    showMessage(saveConfigMessage, `Failed to load config: ${err.message}`, true);
    return null;
  }
}

function setStatusPill(pillId, valueId, ok, label) {
  const pill  = document.getElementById(pillId);
  const value = document.getElementById(valueId);
  if (!pill || !value) return;
  pill.className  = `status-pill ${ok ? "status-pill--ok" : "status-pill--err"}`;
  value.textContent = label;
}

function applyConfig(config) {
  if (!config) return;

  // Status pills
  setStatusPill("statusPillIntegration", "statusValIntegration",
    config.enabled, config.enabled ? "Enabled" : "Disabled");
  setStatusPill("statusPillAppSecret", "statusValAppSecret",
    config.appSecretSet, config.appSecretSet ? "Configured" : "Not set");
  setStatusPill("statusPillToken", "statusValToken",
    config.pageAccessTokenSet, config.pageAccessTokenSet ? "Configured" : "Not set");
  setStatusPill("statusPillVerifyToken", "statusValVerifyToken",
    !!(config.verifyToken), config.verifyToken ? "Set" : "Not set");

  enabledToggle.checked = !!config.enabled;
  verifyTokenInput.value = config.verifyToken || "";
  pageIdInput.value      = config.pageId || "";
  webhookUrlInput.value  = buildWebhookUrl();

  // Credential status chips
  if (config.appSecretSet) {
    appSecretStatus.textContent = "✓ Saved";
    appSecretStatus.className   = "cred-status cred-status--ok";
  } else {
    appSecretStatus.textContent = "Not set";
    appSecretStatus.className   = "cred-status cred-status--err";
  }
  if (config.pageAccessTokenSet) {
    pageAccessTokenStatus.textContent = "✓ Saved";
    pageAccessTokenStatus.className   = "cred-status cred-status--ok";
  } else {
    pageAccessTokenStatus.textContent = "Not set";
    pageAccessTokenStatus.className   = "cred-status cred-status--err";
  }

  // Form IDs
  renderFormIds(Array.isArray(config.formIds) ? config.formIds : []);

  // Round-robin
  const rrIdx = Number(config.roundRobinIndex) || 0;
  rrIndexDisplay.textContent = rrIdx;
  updateRRDisplay(rrIdx);
}

function updateRRDisplay(rrIdx) {
  const counselors = getCounselors().filter(isCounselorInMetaRotation);
  if (rrCounselorCount) rrCounselorCount.textContent = counselors.length;
  if (!counselors.length) {
    rrNextCounselor.textContent = "No counselors";
    return;
  }
  const idx = (rrIdx % counselors.length + counselors.length) % counselors.length;
  rrNextCounselor.textContent = counselors[idx]?.name || "—";
}

// ── Form IDs list ─────────────────────────────────────────────────────────────

function renderRoundRobinCounselors() {
  if (!rrCounselorList) return;

  const counselors = getCounselors();
  if (!counselors.length) {
    rrCounselorList.innerHTML = '<p class="rr-roster-empty">No counselors found yet. Add counselors in Counselor Management.</p>';
    return;
  }

  rrCounselorList.innerHTML = counselors.map((counselor) => {
    const checked = isCounselorInMetaRotation(counselor);
    const status = checked ? "In rotation" : "Paused";
    return `
      <div class="rr-roster-row">
        <div class="rr-roster-person">
          <strong>${escapeHtml(counselor.name || "Unnamed Counselor")}</strong>
          <span>${escapeHtml(counselor.email || "No email")}</span>
        </div>
        <div class="rr-roster-control">
          <span class="rr-roster-status">${status}</span>
          <label class="switch" aria-label="Toggle ${escapeHtml(counselor.name || "counselor")} in Meta round-robin">
            <input type="checkbox" class="rr-counselor-toggle" data-counselor-id="${escapeHtml(counselor.id || counselor.email || "")}" ${checked ? "checked" : ""} ${session.role === "admin" ? "" : "disabled"} />
            <span class="switch-slider"></span>
          </label>
        </div>
      </div>
    `;
  }).join("");

  rrCounselorList.querySelectorAll(".rr-counselor-toggle").forEach((toggle) => {
    toggle.addEventListener("change", () => {
      const counselorId = toggle.getAttribute("data-counselor-id");
      void updateCounselorRoundRobinStatus(counselorId, toggle.checked);
    });
  });
}

async function updateCounselorRoundRobinStatus(counselorId, enabled) {
  if (session.role !== "admin") return;

  const counselors = getCounselors();
  const nextCounselors = counselors.map((counselor) => {
    const id = String(counselor.id || counselor.email || "");
    if (id !== String(counselorId || "")) return counselor;
    return {
      ...counselor,
      roundRobinEnabled: enabled
    };
  });

  showMessage(rrRosterMessage, "Saving counselor rotation...");
  const result = await saveCounselors(nextCounselors);
  if (!result || result.ok === false) {
    showMessage(rrRosterMessage, result?.message || "Failed to update counselor rotation.", true);
    renderRoundRobinCounselors();
    return;
  }

  renderRoundRobinCounselors();
  updateRRDisplay(Number(rrIndexDisplay.textContent) || 0);
  showMessage(rrRosterMessage, "Counselor rotation updated.");
}

function renderFormIds(ids) {
  formIdsList.innerHTML = "";
  ids.forEach((id) => addFormIdRow(id));
}

function addFormIdRow(value = "") {
  const row = document.createElement("div");
  row.className = "form-id-row";
  row.innerHTML = `
    <input type="text" class="form-id-input" placeholder="e.g. 1234567890123456" value="${escapeHtml(value)}" />
    <button type="button" class="remove-form-id-btn" aria-label="Remove">✕</button>
  `;
  row.querySelector(".remove-form-id-btn").addEventListener("click", () => row.remove());
  formIdsList.appendChild(row);
}

function getFormIds() {
  return Array.from(formIdsList.querySelectorAll(".form-id-input"))
    .map((el) => el.value.trim())
    .filter(Boolean);
}

// ── Save config ───────────────────────────────────────────────────────────────

async function saveConfig() {
  saveConfigBtn.disabled = true;
  showMessage(saveConfigMessage, "Saving…");

  const payload = {
    enabled:          enabledToggle.checked,
    verifyToken:      verifyTokenInput.value.trim(),
    pageId:           pageIdInput.value.trim(),
    formIds:          getFormIds()
  };

  const appSecret = appSecretInput.value.trim();
  if (appSecret) payload.appSecret = appSecret;

  const pat = pageAccessTokenInput.value.trim();
  if (pat) payload.pageAccessToken = pat;

  try {
    const res = await fetch(apiUrl("/api/meta/config"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || `HTTP ${res.status}`);

    // Clear secret fields after successful save (they're now stored server-side).
    appSecretInput.value       = "";
    pageAccessTokenInput.value = "";

    applyConfig(json);
    showMessage(saveConfigMessage, "Settings saved successfully.");
  } catch (err) {
    showMessage(saveConfigMessage, `Save failed: ${err.message}`, true);
  } finally {
    saveConfigBtn.disabled = false;
  }
}

// ── Logs ──────────────────────────────────────────────────────────────────────

async function loadLogs() {
  logsTableBody.innerHTML = '<tr><td colspan="5" class="log-empty">Loading…</td></tr>';
  try {
    const [logsRes, retryRes] = await Promise.all([
      fetch(apiUrl("/api/meta/logs?limit=50"), { credentials: "same-origin" }),
      fetch(apiUrl("/api/meta/retry-jobs?limit=50"), { credentials: "same-origin" })
    ]);
    if (!logsRes.ok) throw new Error(`HTTP ${logsRes.status}`);
    if (!retryRes.ok) throw new Error(`HTTP ${retryRes.status}`);

    const payload = await logsRes.json();
    const retryPayload = await retryRes.json();
    allLogs = Array.isArray(payload?.logs) ? payload.logs : [];
    logSummary = normalizeLogSummary(payload?.summary);
    retryJobs = Array.isArray(retryPayload?.jobs) ? retryPayload.jobs : [];
    renderLogSummary(logSummary);
    renderRetryQueue(retryJobs);
    renderLogs(allLogs);
  } catch (err) {
    allLogs = [];
    logSummary = normalizeLogSummary();
    retryJobs = [];
    renderLogSummary(logSummary);
    renderRetryQueue(retryJobs, err.message);
    logsTableBody.innerHTML = `<tr><td colspan="5" class="log-empty" style="color:var(--danger)">Failed to load logs: ${escapeHtml(err.message)}</td></tr>`;
  }
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
  if (logSummarySuccess) logSummarySuccess.textContent = String(counts.success);
  if (logSummaryIgnored) logSummaryIgnored.textContent = String(counts.ignored);
  if (logSummaryError) logSummaryError.textContent = String(counts.error);
}

function renderRetryQueue(jobs, errorMessage = "") {
  if (retryQueueCount) {
    retryQueueCount.textContent = `${jobs.length} active`;
  }

  if (!retryQueueWrap) {
    return;
  }

  if (errorMessage) {
    retryQueueWrap.innerHTML = `<div class="retry-panel__empty" style="color:var(--danger)">Failed to load pending errors: ${escapeHtml(errorMessage)}</div>`;
    return;
  }

  if (!jobs.length) {
    retryQueueWrap.innerHTML = '<div class="retry-panel__empty">No pending errors. When a failed lead is retried successfully, it disappears from this list and shows up in Success logs.</div>';
    return;
  }

  retryQueueWrap.innerHTML = `
    <table class="retry-table">
      <thead>
        <tr>
          <th>Lead ID</th>
          <th>Status</th>
          <th>Attempts</th>
          <th>Next Retry</th>
          <th>Last Error</th>
        </tr>
      </thead>
      <tbody>
        ${jobs.map((job) => `
          <tr>
            <td>${escapeHtml(job.leadgenId || "—")}</td>
            <td><span class="retry-badge">Pending Retry</span></td>
            <td>${escapeHtml(String(job.attempts || 0))}</td>
            <td>${escapeHtml(formatTime(job.nextAttemptAt))}</td>
            <td>${escapeHtml(job.lastError || job.reason || "—")}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function renderLogs(logs) {
  const filter = logTypeFilter?.value || "all";
  const filtered = filter === "all" ? logs : logs.filter((l) => l.type === filter);

  if (!filtered.length) {
    logsTableBody.innerHTML = '<tr><td colspan="5" class="log-empty">No events match the selected filter.</td></tr>';
    return;
  }
  logsTableBody.innerHTML = filtered.map((log) => {
    const typeClass = `log-type--${log.type || "ignored"}`;
    const leadInfo = log.leadName
      ? `${escapeHtml(log.leadName)} <span style="opacity:.5">→</span> ${escapeHtml(log.counselor || "")}`
      : log.leadgenId
        ? `ID: ${escapeHtml(log.leadgenId)}`
        : "—";
    return `
      <tr>
        <td style="white-space:nowrap;font-size:.78rem;opacity:.7;">${escapeHtml(formatTime(log.receivedAt))}</td>
        <td><span class="log-type ${typeClass}">${escapeHtml(log.type || "?")}</span></td>
        <td>${escapeHtml(log.message || "")}</td>
        <td>${leadInfo}</td>
        <td>${escapeHtml(log.campaignName || "—")}</td>
      </tr>
    `;
  }).join("");
}

async function clearLogs() {
  if (!window.confirm("Clear all webhook logs? This cannot be undone.")) return;
  clearLogsBtn.disabled = true;
  try {
    const res = await fetch(apiUrl("/api/meta/logs"), {
      method: "DELETE",
      credentials: "same-origin"
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    allLogs = [];
    logSummary = normalizeLogSummary();
    retryJobs = [];
    renderLogSummary(logSummary);
    renderRetryQueue(retryJobs);
    renderLogs([]);
  } catch (err) {
    showMessage(rrMessage, `Failed to clear logs: ${err.message}`, true);
  } finally {
    clearLogsBtn.disabled = false;
  }
}

// ── Round-robin reset ─────────────────────────────────────────────────────────

async function resetRoundRobin() {
  if (!window.confirm("Reset the Meta lead count to 0? The next Meta lead will be assigned to the first counselor.")) return;
  resetRrBtn.disabled = true;
  showMessage(rrMessage, "Resetting…");
  try {
    const res = await fetch(apiUrl("/api/meta/rr-state/reset"), {
      method: "POST",
      credentials: "same-origin"
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || `HTTP ${res.status}`);
    rrIndexDisplay.textContent = 0;
    updateRRDisplay(0);
    showMessage(rrMessage, "Meta lead count reset to 0.");
  } catch (err) {
    showMessage(rrMessage, `Reset failed: ${err.message}`, true);
  } finally {
    resetRrBtn.disabled = false;
  }
}

// ── Secret field visibility toggles ──────────────────────────────────────────

document.querySelectorAll(".toggle-secret-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const targetId = btn.dataset.target;
    const input    = document.getElementById(targetId);
    if (!input) return;
    const isShowing = input.type === "text";
    input.type = isShowing ? "password" : "text";
    btn.textContent = isShowing ? "Show" : "Hide";
  });
});

// Keep secret inputs from being treated like login password fields by browsers/password managers.
[appSecretInput, pageAccessTokenInput].forEach((input) => {
  if (!input) return;
  input.readOnly = true;
  const unlockInput = () => {
    input.readOnly = false;
  };
  input.addEventListener("focus", unlockInput, { once: true });
  input.addEventListener("pointerdown", unlockInput, { once: true });
});

// ── Event bindings ────────────────────────────────────────────────────────────

copyWebhookUrlBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(webhookUrlInput.value);
    copyWebhookUrlBtn.textContent = "Copied!";
    setTimeout(() => { copyWebhookUrlBtn.textContent = "Copy"; }, 2000);
  } catch {
    webhookUrlInput.select();
  }
});

generateVerifyTokenBtn.addEventListener("click", () => {
  verifyTokenInput.value = generateToken(32);
});

addFormIdBtn.addEventListener("click", () => addFormIdRow());

saveConfigBtn.addEventListener("click", saveConfig);

resetRrBtn.addEventListener("click", resetRoundRobin);

refreshLogsBtn.addEventListener("click", loadLogs);

clearLogsBtn.addEventListener("click", clearLogs);

if (logTypeFilter) {
  logTypeFilter.addEventListener("change", () => renderLogs(allLogs));
}

// ── Init ──────────────────────────────────────────────────────────────────────

webhookUrlInput.value = buildWebhookUrl();

const config = await loadConfig();
applyConfig(config);
renderRoundRobinCounselors();
await loadLogs();

const stopPolling = startStatePolling(() => {
  // Refresh RR display if counselor list changes.
  const rrIdx = Number(rrIndexDisplay.textContent) || 0;
  updateRRDisplay(rrIdx);
  renderRoundRobinCounselors();
}, 15000);

registerPageCleanup(() => {
  stopPolling?.();
});
