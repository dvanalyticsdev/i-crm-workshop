import { getSession, refreshSession } from "./state-sync.js";
import {
  clearLeadCreationRequests,
  decideLeadCreationRequest,
  fetchLeadCreationRequests,
  submitLeadCreationRequest
} from "./lead-creation-service.js";

const kpiSection = document.getElementById("leadCreationKpis");
const formPanel = document.getElementById("leadCreationFormPanel");
const form = document.getElementById("leadCreationForm");
const pipelineInput = document.getElementById("leadCreationPipeline");
const workshopWrap = document.getElementById("leadCreationWorkshopWrap");
const courseWrap = document.getElementById("leadCreationCourseWrap");
const submitButton = document.getElementById("submitLeadCreationBtn");
const heading = document.getElementById("leadCreationHeading");
const subheading = document.getElementById("leadCreationSubheading");
const list = document.getElementById("leadCreationList");
const message = document.getElementById("leadCreationMessage");
const refreshButton = document.getElementById("refreshLeadCreationBtn");
const clearButton = document.getElementById("clearLeadCreationBtn");

let requests = [];
let session = getSession() || await refreshSession().catch(() => null);

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function isAdmin() {
  return session?.role === "admin";
}

function formatDate(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "Not available";
  return date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function statusLabel(value) {
  const status = normalize(value) || "pending";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function targetLabel(request) {
  return normalize(request.pipeline) === "main-admission" ? "Main Admission Calling" : "Workshop Calling";
}

function setMessage(text, isError = false) {
  message.textContent = text || "";
  message.style.color = isError ? "var(--danger)" : "var(--success)";
}

function updatePipelineFields() {
  const isAdmission = normalize(pipelineInput?.value) === "main-admission";
  workshopWrap?.classList.toggle("hidden", isAdmission);
  courseWrap?.classList.toggle("hidden", !isAdmission);
}

function renderKpis() {
  const cards = [
    ["Total Requests", requests.length],
    ["Pending", requests.filter((request) => request.status === "pending").length],
    ["Approved", requests.filter((request) => request.status === "approved").length],
    ["Rejected", requests.filter((request) => request.status === "rejected").length]
  ];

  kpiSection.innerHTML = cards.map(([label, value]) => `
    <article class="card kpi-card">
      <p>${escapeHtml(label)}</p>
      <h2>${value}</h2>
    </article>
  `).join("");
}

function renderHeader() {
  formPanel?.classList.toggle("hidden", isAdmin());
  if (isAdmin()) {
    heading.textContent = "Lead Creation Review";
    subheading.textContent = "Approve counselor requests to create workshop or main admission leads.";
    return;
  }

  heading.textContent = "My Lead Requests";
  subheading.textContent = "Track your pending, approved, and rejected lead creation requests.";
}

function renderStatusPill(value) {
  const status = normalize(value) || "pending";
  return `<span class="lead-claim-status lead-claim-status--${escapeHtml(status)}">${escapeHtml(statusLabel(status))}</span>`;
}

function renderActions(request) {
  if (!isAdmin() || request.status !== "pending") {
    return "";
  }

  return `
    <div class="lead-claim-actions">
      <button type="button" class="btn-primary" data-lead-request-decision="approved" data-lead-request-id="${escapeHtml(request.id)}">Approve</button>
      <button type="button" class="btn-delete" data-lead-request-decision="rejected" data-lead-request-id="${escapeHtml(request.id)}">Reject</button>
    </div>
  `;
}

function renderRequests() {
  renderHeader();
  renderKpis();
  if (clearButton) {
    clearButton.disabled = requests.length === 0;
  }

  if (!requests.length) {
    list.innerHTML = `
      <div class="empty-state">
        <h3>No lead creation requests found</h3>
        <p>New requests will appear here.</p>
      </div>
    `;
    return;
  }

  list.innerHTML = `
    <div class="lead-claim-list">
      ${requests.map((request) => `
        <article class="lead-claim-card">
          <div class="lead-claim-card__head">
            <div>
              <span class="lead-browse-pill">${escapeHtml(targetLabel(request))}</span>
              <h3>${escapeHtml(request.name || "Unnamed lead")}</h3>
              <p>${escapeHtml(request.phone || "No phone")} | ${escapeHtml(request.email || "No email")}</p>
            </div>
            <div class="lead-claim-status-stack">${renderStatusPill(request.status)}</div>
          </div>
          <dl class="lead-claim-meta">
            <div><dt>Requested by</dt><dd>${escapeHtml(request.requesterName || request.requesterEmail)}</dd></div>
            <div><dt>${request.pipeline === "main-admission" ? "Course" : "Workshop"}</dt><dd>${escapeHtml(request.courseName || request.workshop || "Not provided")}</dd></div>
            <div><dt>Raised</dt><dd>${escapeHtml(formatDate(request.createdAt))}</dd></div>
            <div><dt>Lead ID</dt><dd>${escapeHtml(request.requestedLeadId || "Not created")}</dd></div>
          </dl>
          ${request.notes ? `<p class="lead-claim-note">Notes: ${escapeHtml(request.notes)}</p>` : ""}
          ${request.rejectionReason ? `<p class="lead-claim-note">Rejection note: ${escapeHtml(request.rejectionReason)}</p>` : ""}
          ${renderActions(request)}
        </article>
      `).join("")}
    </div>
  `;

  list.querySelectorAll("[data-lead-request-decision]").forEach((button) => {
    button.addEventListener("click", () => handleDecision(button));
  });
}

async function loadRequests() {
  setMessage("Loading lead creation requests...");
  const result = await fetchLeadCreationRequests();
  if (!result.ok) {
    setMessage(result.message || "Could not load lead creation requests.", true);
    return;
  }

  requests = Array.isArray(result.requests) ? result.requests : [];
  setMessage("");
  renderRequests();
}

function getFormPayload() {
  return {
    pipeline: pipelineInput.value,
    name: document.getElementById("leadCreationName").value,
    phone: document.getElementById("leadCreationPhone").value,
    email: document.getElementById("leadCreationEmail").value,
    workshop: document.getElementById("leadCreationWorkshop").value,
    courseName: document.getElementById("leadCreationCourse").value,
    source: document.getElementById("leadCreationSource").value,
    notes: document.getElementById("leadCreationNotes").value
  };
}

async function handleSubmit(event) {
  event.preventDefault();
  if (isAdmin()) return;

  submitButton.disabled = true;
  setMessage("Submitting lead creation request...");
  const result = await submitLeadCreationRequest(getFormPayload());
  submitButton.disabled = false;

  if (!result.ok) {
    setMessage(result.message || "Could not submit lead creation request.", true);
    return;
  }

  form.reset();
  updatePipelineFields();
  setMessage("Lead creation request submitted for admin approval.");
  await loadRequests();
}

async function handleDecision(button) {
  const requestId = button.getAttribute("data-lead-request-id");
  const decision = button.getAttribute("data-lead-request-decision");
  let note = "";
  if (decision === "rejected") {
    note = window.prompt("Optional rejection note") || "";
  }

  button.disabled = true;
  setMessage(`${statusLabel(decision)} decision is being saved...`);
  const result = await decideLeadCreationRequest(requestId, decision, note);
  button.disabled = false;

  if (!result.ok) {
    setMessage(result.message || "Could not update lead creation request.", true);
    return;
  }

  setMessage(decision === "approved" ? "Lead request approved and created." : "Lead request rejected.");
  await loadRequests();
}

async function clearRequestsList() {
  if (!requests.length) return;
  const confirmed = window.confirm("Clear your lead creation request list?");
  if (!confirmed) return;

  clearButton.disabled = true;
  setMessage("Clearing lead creation request list...");
  const result = await clearLeadCreationRequests();
  clearButton.disabled = false;

  if (!result.ok) {
    setMessage(result.message || "Could not clear lead creation requests.", true);
    return;
  }

  requests = [];
  setMessage(`Cleared ${result.clearedCount || 0} request${Number(result.clearedCount) === 1 ? "" : "s"}.`);
  renderRequests();
}

pipelineInput?.addEventListener("change", updatePipelineFields);
form?.addEventListener("submit", handleSubmit);
refreshButton?.addEventListener("click", loadRequests);
clearButton?.addEventListener("click", clearRequestsList);

updatePipelineFields();
await loadRequests();
