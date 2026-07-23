import { bootstrapLocalState, getSession, getLeads } from "./state-sync.js";
import { apiUrl } from "./api-client.js";

await bootstrapLocalState();

const session = getSession();
if (!session || !["admin", "marketing"].includes(session.role)) {
  window.location.href = "index.html";
  throw new Error("Access required.");
}

const authKeyInput = document.getElementById("authKeyInput");
const authKeyStatus = document.getElementById("authKeyStatus");
const countryCodeInput = document.getElementById("countryCodeInput");
const statusCallbackUrlInput = document.getElementById("statusCallbackUrlInput");
const enabledToggle = document.getElementById("enabledToggle");
const saveConfigBtn = document.getElementById("saveConfigBtn");
const configMessage = document.getElementById("configMessage");
const syncWhatsappBtn = document.getElementById("syncWhatsappBtn");
const numberSelect = document.getElementById("numberSelect");
const searchInput = document.getElementById("searchInput");
const pipelineFilter = document.getElementById("pipelineFilter");
const workshopFilter = document.getElementById("workshopFilter");
const campaignFilter = document.getElementById("campaignFilter");
const locationFilter = document.getElementById("locationFilter");
const counselorFilter = document.getElementById("counselorFilter");
const templateSelect = document.getElementById("templateSelect");
const templateVariablePreview = document.getElementById("templateVariablePreview");
const mediaUrlField = document.getElementById("mediaUrlField");
const mediaUrlInput = document.getElementById("mediaUrlInput");
const saveMediaUrlBtn = document.getElementById("saveMediaUrlBtn");
const mediaFileInput = document.getElementById("mediaFileInput");
const uploadMediaBtn = document.getElementById("uploadMediaBtn");
const mediaPreviewWrap = document.getElementById("mediaPreviewWrap");
const mediaPreviewImage = document.getElementById("mediaPreviewImage");
const mediaPreviewOpenBtn = document.getElementById("mediaPreviewOpenBtn");
const mediaLightboxModal = document.getElementById("mediaLightboxModal");
const mediaLightboxImage = document.getElementById("mediaLightboxImage");
const mediaLightboxCloseBtn = document.getElementById("mediaLightboxCloseBtn");
const selectFilteredBtn = document.getElementById("selectFilteredBtn");
const clearSelectionBtn = document.getElementById("clearSelectionBtn");
const sendBtn = document.getElementById("sendBtn");
const sendMessage = document.getElementById("sendMessage");
const filteredCount = document.getElementById("filteredCount");
const selectedCount = document.getElementById("selectedCount");
const sendSummary = document.getElementById("sendSummary");
const selectPageToggle = document.getElementById("selectPageToggle");
const leadTableBody = document.getElementById("leadTableBody");
const logsTableBody = document.getElementById("logsTableBody");
const clearRecentSendsBtn = document.getElementById("clearRecentSendsBtn");
const logsMessage = document.getElementById("logsMessage");

let config = null;
let selectedLeadIds = new Set();
let filteredLeads = [];

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function showMessage(el, text, isError = false) {
  el.textContent = text;
  el.style.color = isError ? "var(--danger, #ef4444)" : "var(--success, #22c55e)";
}

function renderMediaPreview(url = "") {
  const normalizedUrl = String(url || "").trim();
  const isPreviewable = /^https?:\/\//i.test(normalizedUrl);
  mediaPreviewWrap.hidden = !isPreviewable;
  mediaPreviewOpenBtn.disabled = !isPreviewable;
  if (!isPreviewable) {
    mediaPreviewImage.removeAttribute("src");
    mediaLightboxImage.removeAttribute("src");
    return;
  }

  mediaPreviewImage.src = normalizedUrl;
  mediaLightboxImage.src = normalizedUrl;
}

function openMediaLightbox() {
  if (!mediaLightboxImage.getAttribute("src")) {
    return;
  }
  mediaLightboxModal.classList.remove("hidden");
}

function closeMediaLightbox() {
  mediaLightboxModal.classList.add("hidden");
}

function uniqueOptions(leads, getter) {
  return [...new Set(leads.map(getter).map((value) => String(value || "").trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function getCampaign(lead) {
  return lead.metaCampaignName || lead.metaAdsetName || lead.metaAdName || lead.elementorFormName || lead.importSourceSheet || "";
}

function getLocation(lead) {
  return lead.country || lead.city || lead.branch || lead.location || "";
}

function getPipeline(lead) {
  return lead.leadPipeline || (lead.registeredCourseStatus || lead.registeredAdmissionStatus ? "registered-course" : "workshop");
}

function renderSelect(select, values, current = "") {
  select.innerHTML = `<option value="">All</option>${values.map((value) => (
    `<option value="${escapeHtml(value)}" ${value === current ? "selected" : ""}>${escapeHtml(value)}</option>`
  )).join("")}`;
}

function optionExists(select, value) {
  return [...select.options].some((option) => option.value === value);
}

function applyConfig(nextConfig, preferred = {}) {
  const preferredNumber = preferred.numberValue ?? numberSelect.value;
  const preferredTemplateId = preferred.templateId ?? templateSelect.value;
  config = nextConfig;
  enabledToggle.checked = config.enabled !== false;
  countryCodeInput.value = config.defaultCountryCode || "91";
  statusCallbackUrlInput.value = config.statusCallbackUrl || statusCallbackUrlInput.value || "";
  authKeyStatus.textContent = config.authKeySet ? "Saved" : "Not set";
  authKeyStatus.className = `cred-status ${config.authKeySet ? "cred-status--ok" : "cred-status--err"}`;
  authKeyInput.value = "";
  renderNumberSelect();
  if (preferredNumber && optionExists(numberSelect, preferredNumber)) {
    numberSelect.value = preferredNumber;
  }
  renderTemplateSelect(preferredTemplateId);
}

async function loadConfig() {
  const res = await fetch(apiUrl("/api/reachout/config"), { credentials: "same-origin" });
  const json = await res.json();
  if (!res.ok) throw new Error(json.message || `HTTP ${res.status}`);
  applyConfig(json);
}

function renderNumberSelect() {
  const numbers = Array.isArray(config?.whatsappNumbers) ? config.whatsappNumbers : [];
  numberSelect.innerHTML = numbers.length
    ? numbers.map((number) => {
        const label = `${number.number}${number.label && number.label !== number.number ? ` - ${number.label}` : ""}`;
        return `<option value="${escapeHtml(number.number)}">${escapeHtml(label)}</option>`;
      }).join("")
    : `<option value="">Sync WhatsApp numbers</option>`;
}

function renderTemplateSelect(preferredTemplateId = templateSelect.value) {
  const selectedNumber = numberSelect.value;
  const templates = (config?.templates || [])
    .filter((template) => template.enabled !== false)
    .filter((template) => !selectedNumber || !template.integratedNumber || template.integratedNumber === selectedNumber);
  templateSelect.innerHTML = templates.length
    ? templates.map((template) => `<option value="${escapeHtml(template.id)}">${escapeHtml(template.name || template.templateName)}</option>`).join("")
    : `<option value="">Sync approved templates</option>`;
  if (preferredTemplateId && optionExists(templateSelect, preferredTemplateId)) {
    templateSelect.value = preferredTemplateId;
  }
  renderTemplatePreview();
}

function renderTemplatePreview() {
  const template = (config?.templates || []).find((item) => String(item.id) === templateSelect.value);
  const needsMediaHeader = (template?.componentSchema || []).some((component) => (
    /^header_\d+$/i.test(String(component?.key || ""))
    && ["image", "video", "document"].includes(String(component?.type || "").toLowerCase())
  ));
  templateVariablePreview.value = template?.variableMappings
    ? template.variableMappings.replace(/\s*\n\s*/g, ", ")
    : "No variables";
  mediaUrlField.hidden = !needsMediaHeader;
  mediaUrlInput.value = needsMediaHeader ? (template.defaultHeaderMediaUrl || "") : "";
  saveMediaUrlBtn.disabled = !needsMediaHeader;
  uploadMediaBtn.disabled = !needsMediaHeader;
  renderMediaPreview(needsMediaHeader ? (template.defaultHeaderMediaUrl || "") : "");
  if (!needsMediaHeader) mediaFileInput.value = "";
}

function filterLeadList() {
  const query = searchInput.value.trim().toLowerCase();
  const pipeline = pipelineFilter.value;
  const workshop = workshopFilter.value;
  const campaign = campaignFilter.value;
  const location = locationFilter.value;
  const counselor = counselorFilter.value;

  filteredLeads = getLeads().filter((lead) => {
    const haystack = [lead.name, lead.email, lead.phone, lead.workshop, getCampaign(lead), getLocation(lead), lead.counselor].join(" ").toLowerCase();
    if (query && !haystack.includes(query)) return false;
    if (pipeline && getPipeline(lead) !== pipeline) return false;
    if (workshop && String(lead.workshop || "") !== workshop) return false;
    if (campaign && getCampaign(lead) !== campaign) return false;
    if (location && getLocation(lead) !== location) return false;
    if (counselor && String(lead.counselor || "") !== counselor) return false;
    return true;
  });
  renderLeadTable();
}

function renderFilters() {
  const leads = getLeads();
  renderSelect(pipelineFilter, uniqueOptions(leads, getPipeline), pipelineFilter.value);
  renderSelect(workshopFilter, uniqueOptions(leads, (lead) => lead.workshop), workshopFilter.value);
  renderSelect(campaignFilter, uniqueOptions(leads, getCampaign), campaignFilter.value);
  renderSelect(locationFilter, uniqueOptions(leads, getLocation), locationFilter.value);
  renderSelect(counselorFilter, uniqueOptions(leads, (lead) => lead.counselor), counselorFilter.value);
}

function renderLeadTable() {
  filteredCount.textContent = String(filteredLeads.length);
  selectedLeadIds = new Set([...selectedLeadIds].filter((id) => getLeads().some((lead) => String(lead.id) === id)));
  selectedCount.textContent = String(selectedLeadIds.size);
  selectPageToggle.checked = filteredLeads.length > 0 && filteredLeads.every((lead) => selectedLeadIds.has(String(lead.id)));

  const pageLeads = filteredLeads.slice(0, 200);
  if (!pageLeads.length) {
    leadTableBody.innerHTML = `<tr><td colspan="7" class="log-empty">No leads match the selected filters.</td></tr>`;
    return;
  }

  leadTableBody.innerHTML = pageLeads.map((lead) => {
    const id = String(lead.id);
    return `
      <tr>
        <td><input type="checkbox" data-lead-check="${escapeHtml(id)}" ${selectedLeadIds.has(id) ? "checked" : ""} /></td>
        <td><strong>${escapeHtml(lead.name || "-")}</strong><br><span style="opacity:.6;">${escapeHtml(id)}</span></td>
        <td>${escapeHtml(lead.phone || "-")}</td>
        <td>${escapeHtml(lead.email || "-")}</td>
        <td>${escapeHtml(lead.workshop || "-")}</td>
        <td>${escapeHtml(getCampaign(lead) || "-")}</td>
        <td>${escapeHtml(getLocation(lead) || "-")}</td>
      </tr>
    `;
  }).join("");

  leadTableBody.querySelectorAll("[data-lead-check]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selectedLeadIds.add(checkbox.dataset.leadCheck);
      else selectedLeadIds.delete(checkbox.dataset.leadCheck);
      renderLeadTable();
    });
  });
}

async function saveConfig() {
  saveConfigBtn.disabled = true;
  showMessage(configMessage, "Saving...");
  try {
    const payload = {
      enabled: enabledToggle.checked,
      defaultCountryCode: countryCodeInput.value.trim(),
      whatsappNumbers: config.whatsappNumbers || [],
      templates: config.templates || []
    };
    if (authKeyInput.value.trim()) payload.authKey = authKeyInput.value.trim();
    const res = await fetch(apiUrl("/api/reachout/config"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || `HTTP ${res.status}`);
    applyConfig(json);
    showMessage(configMessage, "ReachOut settings saved.");
  } catch (error) {
    showMessage(configMessage, `Save failed: ${error.message}`, true);
  } finally {
    saveConfigBtn.disabled = false;
  }
}

async function saveTemplateMediaUrl() {
  const templateId = templateSelect.value;
  const mediaUrl = mediaUrlInput.value.trim();
  if (!templateId || mediaUrlField.hidden) {
    showMessage(sendMessage, "Select a media-header template first.", true);
    return;
  }
  if (!/^https:\/\//i.test(mediaUrl)) {
    showMessage(sendMessage, "Enter a public HTTPS media URL before saving.", true);
    return;
  }

  saveMediaUrlBtn.disabled = true;
  showMessage(sendMessage, "Saving media URL...");
  try {
    const updatedTemplates = (config.templates || []).map((template) => (
      String(template.id) === templateId
        ? { ...template, defaultHeaderMediaUrl: mediaUrl }
        : template
    ));
    const payload = {
      enabled: enabledToggle.checked,
      defaultCountryCode: countryCodeInput.value.trim(),
      whatsappNumbers: config.whatsappNumbers || [],
      templates: updatedTemplates
    };
    const res = await fetch(apiUrl("/api/reachout/config"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || `HTTP ${res.status}`);
    applyConfig(json);
    renderMediaPreview(mediaUrl);
    showMessage(sendMessage, "Header media URL saved for this template.");
  } catch (error) {
    showMessage(sendMessage, `Save failed: ${error.message}`, true);
  } finally {
    saveMediaUrlBtn.disabled = false;
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Unable to read the selected image."));
    reader.readAsDataURL(file);
  });
}

async function uploadTemplateMedia() {
  const templateId = templateSelect.value;
  const file = mediaFileInput.files?.[0];
  if (!templateId || mediaUrlField.hidden) {
    showMessage(sendMessage, "Select a media-header template first.", true);
    return;
  }
  if (!file) {
    showMessage(sendMessage, "Choose an image to upload.", true);
    return;
  }
  if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) {
    showMessage(sendMessage, "Upload a JPG, PNG, WEBP, or GIF image.", true);
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    showMessage(sendMessage, "Image must be 5 MB or smaller.", true);
    return;
  }

  uploadMediaBtn.disabled = true;
  showMessage(sendMessage, "Uploading image...");
  try {
    const dataUrl = await readFileAsDataUrl(file);
    const res = await fetch(apiUrl("/api/reachout/media"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        templateId,
        fileName: file.name,
        contentType: file.type,
        dataUrl
      })
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.details || json.message || `HTTP ${res.status}`);
    applyConfig(json, { numberValue: numberSelect.value, templateId });
    mediaUrlInput.value = json.mediaUrl || mediaUrlInput.value;
    renderMediaPreview(mediaUrlInput.value);
    mediaFileInput.value = "";
    showMessage(sendMessage, "Image uploaded and saved for this template.");
  } catch (error) {
    showMessage(sendMessage, `Upload failed: ${error.message}`, true);
  } finally {
    uploadMediaBtn.disabled = false;
  }
}

async function sendSelected() {
  const templateId = templateSelect.value;
  const integratedNumber = numberSelect.value;
  if (!integratedNumber || !templateId || !selectedLeadIds.size) {
    showMessage(sendMessage, "Select a WhatsApp number, template, and at least one lead.", true);
    return;
  }
  if (!mediaUrlField.hidden && !/^https:\/\//i.test(mediaUrlInput.value.trim())) {
    showMessage(sendMessage, "This template needs a public HTTPS header media URL before sending.", true);
    return;
  }
  sendBtn.disabled = true;
  showMessage(sendMessage, "Sending...");
  try {
    const res = await fetch(apiUrl("/api/reachout/send"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        integratedNumber,
        templateId,
        leadIds: [...selectedLeadIds],
        mediaUrl: mediaUrlField.hidden ? "" : mediaUrlInput.value.trim()
      })
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || json.details || `HTTP ${res.status}`);
    const submitted = json.submitted ?? json.sent ?? 0;
    sendSummary.textContent = `${submitted} / ${json.failed || 0}`;
    showMessage(
      sendMessage,
      `Submitted ${submitted} of ${json.attempted || 0} to MSG91. Delivery/read/reply updates can sync back through the webhook callback URL.`,
      Number(json.failed) > 0
    );
    await loadLogs();
  } catch (error) {
    showMessage(sendMessage, `Send failed: ${error.message}`, true);
  } finally {
    sendBtn.disabled = false;
  }
}

async function syncWhatsapp() {
  syncWhatsappBtn.disabled = true;
  showMessage(configMessage, "Syncing WhatsApp numbers and templates from MSG91...");
  try {
    const payload = {};
    if (authKeyInput.value.trim()) payload.authKey = authKeyInput.value.trim();
    const res = await fetch(apiUrl("/api/reachout/whatsapp/sync"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.details || json.message || `HTTP ${res.status}`);
    applyConfig(json);
    showMessage(configMessage, `Synced ${json.syncedNumbers || 0} number(s) and ${json.syncedTemplates || 0} template(s).`);
  } catch (error) {
    showMessage(configMessage, `Sync failed: ${error.message}`, true);
  } finally {
    syncWhatsappBtn.disabled = false;
  }
}

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso || "-";
  }
}

async function loadLogs() {
  const res = await fetch(apiUrl("/api/reachout/logs?limit=60"), { credentials: "same-origin" });
  const json = await res.json();
  const logs = Array.isArray(json.logs) ? json.logs : [];
  const summary = json.summary || {};
  sendSummary.textContent = `${Number(summary.submitted || summary.success || 0)} / ${Number(summary.error || 0)}`;
  logsTableBody.innerHTML = logs.length ? logs.map((log) => `
    <tr>
      <td>${escapeHtml(formatTime(log.sentAt))}</td>
      <td><span class="log-type log-type--${log.type === "error" ? "error" : "success"}">${escapeHtml(log.type === "error" ? "Failed" : "Submitted")}</span></td>
      <td>${escapeHtml(String(log.channel || "").toUpperCase())}</td>
      <td>${escapeHtml(log.templateName || "-")}</td>
      <td>${escapeHtml(log.leadName || log.leadId || "-")}</td>
      <td>${escapeHtml(log.message || "-")}</td>
    </tr>
  `).join("") : `<tr><td colspan="6" class="log-empty">No sends recorded yet.</td></tr>`;
}

async function clearRecentSends() {
  clearRecentSendsBtn.disabled = true;
  showMessage(logsMessage, "Clearing recent sends...");
  try {
    const res = await fetch(apiUrl("/api/reachout/logs"), {
      method: "DELETE",
      credentials: "same-origin"
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || `HTTP ${res.status}`);
    await loadLogs();
    showMessage(logsMessage, `Cleared ${Number(json.deletedCount || 0)} recent send entr${Number(json.deletedCount || 0) === 1 ? "y" : "ies"}.`);
  } catch (error) {
    showMessage(logsMessage, `Clear failed: ${error.message}`, true);
  } finally {
    clearRecentSendsBtn.disabled = false;
  }
}

document.querySelectorAll(".toggle-secret-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const input = document.getElementById(btn.dataset.target);
    input.type = input.type === "password" ? "text" : "password";
    btn.textContent = input.type === "password" ? "Show" : "Hide";
  });
});

saveConfigBtn.addEventListener("click", saveConfig);
syncWhatsappBtn.addEventListener("click", syncWhatsapp);
numberSelect.addEventListener("change", renderTemplateSelect);
templateSelect.addEventListener("change", renderTemplatePreview);
saveMediaUrlBtn.addEventListener("click", saveTemplateMediaUrl);
uploadMediaBtn.addEventListener("click", uploadTemplateMedia);
mediaUrlInput.addEventListener("input", () => {
  renderMediaPreview(mediaUrlInput.value);
});
mediaPreviewOpenBtn.addEventListener("click", openMediaLightbox);
mediaLightboxCloseBtn.addEventListener("click", closeMediaLightbox);
mediaLightboxModal.addEventListener("click", (event) => {
  if (event.target === mediaLightboxModal) {
    closeMediaLightbox();
  }
});
sendBtn.addEventListener("click", sendSelected);
clearRecentSendsBtn.addEventListener("click", clearRecentSends);
selectFilteredBtn.addEventListener("click", () => {
  filteredLeads.forEach((lead) => selectedLeadIds.add(String(lead.id)));
  renderLeadTable();
});
clearSelectionBtn.addEventListener("click", () => {
  selectedLeadIds.clear();
  renderLeadTable();
});
selectPageToggle.addEventListener("change", () => {
  filteredLeads.slice(0, 200).forEach((lead) => {
    const id = String(lead.id);
    if (selectPageToggle.checked) selectedLeadIds.add(id);
    else selectedLeadIds.delete(id);
  });
  renderLeadTable();
});
searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !mediaLightboxModal.classList.contains("hidden")) {
    event.preventDefault();
    closeMediaLightbox();
    return;
  }
  if (event.key !== "Enter") {
    return;
  }
  event.preventDefault();
  filterLeadList();
});
[document].forEach((target) => {
  target.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !mediaLightboxModal.classList.contains("hidden")) {
      event.preventDefault();
      closeMediaLightbox();
    }
  });
});
[pipelineFilter, workshopFilter, campaignFilter, locationFilter, counselorFilter].forEach((input) => {
  input.addEventListener("input", filterLeadList);
});

await loadConfig();
renderFilters();
filterLeadList();
await loadLogs();
window.__dvMarkRouteViewReady?.();
