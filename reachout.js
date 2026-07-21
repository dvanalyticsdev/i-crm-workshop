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
const enabledToggle = document.getElementById("enabledToggle");
const saveConfigBtn = document.getElementById("saveConfigBtn");
const configMessage = document.getElementById("configMessage");
const addTemplateBtn = document.getElementById("addTemplateBtn");
const templateEditorList = document.getElementById("templateEditorList");
const searchInput = document.getElementById("searchInput");
const pipelineFilter = document.getElementById("pipelineFilter");
const workshopFilter = document.getElementById("workshopFilter");
const campaignFilter = document.getElementById("campaignFilter");
const locationFilter = document.getElementById("locationFilter");
const counselorFilter = document.getElementById("counselorFilter");
const templateSelect = document.getElementById("templateSelect");
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

function applyConfig(nextConfig) {
  config = nextConfig;
  enabledToggle.checked = config.enabled !== false;
  countryCodeInput.value = config.defaultCountryCode || "91";
  authKeyStatus.textContent = config.authKeySet ? "Saved" : "Not set";
  authKeyStatus.className = `cred-status ${config.authKeySet ? "cred-status--ok" : "cred-status--err"}`;
  authKeyInput.value = "";
  renderTemplates();
  renderTemplateSelect();
}

async function loadConfig() {
  const res = await fetch(apiUrl("/api/reachout/config"), { credentials: "same-origin" });
  const json = await res.json();
  if (!res.ok) throw new Error(json.message || `HTTP ${res.status}`);
  applyConfig(json);
}

function blankTemplate(channel = "sms") {
  return {
    id: crypto.randomUUID(),
    name: channel === "sms" ? "New SMS Template" : channel === "whatsapp" ? "New WhatsApp Template" : "New Email Template",
    channel,
    enabled: true,
    msg91TemplateId: "",
    integratedNumber: "",
    templateName: "",
    languageCode: "en",
    fromEmail: "",
    fromName: "DV Analytics",
    domain: "",
    subject: "",
    variableMappings: channel === "sms" ? "VAR1=name" : channel === "whatsapp" ? "body_1=name" : "name=name",
    bodyText: "",
    payloadJson: ""
  };
}

function renderTemplates() {
  const templates = Array.isArray(config?.templates) ? config.templates : [];
  if (!templates.length) {
    templateEditorList.innerHTML = `<div class="log-empty">No templates saved yet.</div>`;
    return;
  }

  templateEditorList.innerHTML = templates.map((template, index) => `
    <details class="card" style="margin-bottom:1rem;" ${index === 0 ? "open" : ""} data-template-id="${escapeHtml(template.id)}">
      <summary style="cursor:pointer;font-weight:800;">${escapeHtml(template.name)} <span style="opacity:.55;">${escapeHtml(template.channel.toUpperCase())}</span></summary>
      <div class="filter-row" style="margin-top:1rem;">
        <div class="filter-item"><label>Name</label><input data-field="name" value="${escapeHtml(template.name)}" /></div>
        <div class="filter-item">
          <label>Channel</label>
          <select data-field="channel">
            <option value="sms" ${template.channel === "sms" ? "selected" : ""}>SMS</option>
            <option value="whatsapp" ${template.channel === "whatsapp" ? "selected" : ""}>WhatsApp</option>
            <option value="email" ${template.channel === "email" ? "selected" : ""}>Email</option>
          </select>
        </div>
        <div class="filter-item"><label>MSG91 Template ID</label><input data-field="msg91TemplateId" value="${escapeHtml(template.msg91TemplateId || "")}" /></div>
        <div class="filter-item"><label>WhatsApp Integrated Number</label><input data-field="integratedNumber" value="${escapeHtml(template.integratedNumber || "")}" /></div>
        <div class="filter-item"><label>WhatsApp Template Name</label><input data-field="templateName" value="${escapeHtml(template.templateName || "")}" /></div>
        <div class="filter-item"><label>Language</label><input data-field="languageCode" value="${escapeHtml(template.languageCode || "en")}" /></div>
        <div class="filter-item"><label>From Email</label><input data-field="fromEmail" value="${escapeHtml(template.fromEmail || "")}" /></div>
        <div class="filter-item"><label>From Name</label><input data-field="fromName" value="${escapeHtml(template.fromName || "")}" /></div>
        <div class="filter-item"><label>Email Domain</label><input data-field="domain" value="${escapeHtml(template.domain || "")}" /></div>
        <div class="filter-item"><label>Email Subject</label><input data-field="subject" value="${escapeHtml(template.subject || "")}" /></div>
      </div>
      <div class="form-group">
        <label>Variable Mappings</label>
        <textarea data-field="variableMappings" rows="3" placeholder="VAR1=name">${escapeHtml(template.variableMappings || "")}</textarea>
        <p class="field-hint">Use one mapping per line. Available lead fields include name, email, phone, workshop, campaign, location, counselor, course.</p>
      </div>
      <div class="form-group">
        <label>Internal Preview Text</label>
        <textarea data-field="bodyText" rows="3" placeholder="Hi {{name}}...">${escapeHtml(template.bodyText || "")}</textarea>
      </div>
      <div class="form-group">
        <label>Advanced MSG91 Payload JSON</label>
        <textarea data-field="payloadJson" rows="4" placeholder='Optional. Use {{name}}, {{phone}}, {{email}} placeholders.'>${escapeHtml(template.payloadJson || "")}</textarea>
      </div>
      <div class="save-bar">
        <label class="enable-row" style="margin-right:auto;"><span class="enable-row__label">Enabled</span><input data-field="enabled" type="checkbox" ${template.enabled !== false ? "checked" : ""} /></label>
        <button type="button" class="btn-danger" data-remove-template="${escapeHtml(template.id)}">Remove</button>
      </div>
    </details>
  `).join("");

  templateEditorList.querySelectorAll("[data-field]").forEach((field) => {
    field.addEventListener("input", () => {
      const card = field.closest("[data-template-id]");
      const template = templates.find((item) => item.id === card.dataset.templateId);
      if (!template) return;
      const key = field.dataset.field;
      template[key] = field.type === "checkbox" ? field.checked : field.value;
      renderTemplateSelect();
    });
  });

  templateEditorList.querySelectorAll("[data-remove-template]").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      config.templates = templates.filter((item) => item.id !== button.dataset.removeTemplate);
      renderTemplates();
      renderTemplateSelect();
      await saveConfig();
    });
  });
}

function renderTemplateSelect() {
  const templates = (config?.templates || []).filter((template) => template.enabled !== false);
  templateSelect.innerHTML = templates.length
    ? templates.map((template) => `<option value="${escapeHtml(template.id)}">${escapeHtml(template.channel.toUpperCase())} - ${escapeHtml(template.name)}</option>`).join("")
    : `<option value="">No enabled templates</option>`;
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

async function sendSelected() {
  const templateId = templateSelect.value;
  if (!templateId || !selectedLeadIds.size) {
    showMessage(sendMessage, "Select a template and at least one lead.", true);
    return;
  }
  sendBtn.disabled = true;
  showMessage(sendMessage, "Sending...");
  try {
    const res = await fetch(apiUrl("/api/reachout/send"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ templateId, leadIds: [...selectedLeadIds] })
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || json.details || `HTTP ${res.status}`);
    sendSummary.textContent = `${json.sent || 0} / ${json.failed || 0}`;
    showMessage(sendMessage, `Attempted ${json.attempted}; sent ${json.sent}, failed ${json.failed}.`, Number(json.failed) > 0);
    await loadLogs();
  } catch (error) {
    showMessage(sendMessage, `Send failed: ${error.message}`, true);
  } finally {
    sendBtn.disabled = false;
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
  logsTableBody.innerHTML = logs.length ? logs.map((log) => `
    <tr>
      <td>${escapeHtml(formatTime(log.sentAt))}</td>
      <td><span class="log-type log-type--${log.type === "success" ? "success" : "error"}">${escapeHtml(log.type)}</span></td>
      <td>${escapeHtml(String(log.channel || "").toUpperCase())}</td>
      <td>${escapeHtml(log.templateName || "-")}</td>
      <td>${escapeHtml(log.leadName || log.leadId || "-")}</td>
      <td>${escapeHtml(log.message || "-")}</td>
    </tr>
  `).join("") : `<tr><td colspan="6" class="log-empty">No sends recorded yet.</td></tr>`;
}

document.querySelectorAll(".toggle-secret-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const input = document.getElementById(btn.dataset.target);
    input.type = input.type === "password" ? "text" : "password";
    btn.textContent = input.type === "password" ? "Show" : "Hide";
  });
});

addTemplateBtn.addEventListener("click", () => {
  config.templates = [...(config.templates || []), blankTemplate("sms")];
  renderTemplates();
  renderTemplateSelect();
});
saveConfigBtn.addEventListener("click", saveConfig);
sendBtn.addEventListener("click", sendSelected);
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
[searchInput, pipelineFilter, workshopFilter, campaignFilter, locationFilter, counselorFilter].forEach((input) => {
  input.addEventListener("input", filterLeadList);
});

await loadConfig();
renderFilters();
filterLeadList();
await loadLogs();
