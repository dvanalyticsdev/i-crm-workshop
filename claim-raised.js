import { getSession, refreshSession } from "./state-sync.js";
import { clearLeadClaims, decideLeadClaim, fetchLeadClaims } from "./lead-claim-service.js";

const kpiSection = document.getElementById("claimRaisedKpis");
const heading = document.getElementById("claimRaisedHeading");
const subheading = document.getElementById("claimRaisedSubheading");
const list = document.getElementById("claimRaisedList");
const message = document.getElementById("claimRaisedMessage");
const refreshButton = document.getElementById("refreshClaimsBtn");
const clearButton = document.getElementById("clearClaimsBtn");

let claims = [];
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

function formatDate(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "Not available";
  return date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function statusLabel(value) {
  const status = normalize(value) || "pending";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function setMessage(text, isError = false) {
  message.textContent = text || "";
  message.style.color = isError ? "var(--danger)" : "var(--success)";
}

function isAdmin() {
  return session?.role === "admin";
}

function isCurrentOwnerClaim(claim) {
  return session?.role === "counselor" && (
    normalize(claim.currentOwnerEmail) === normalize(session.email) ||
    normalize(claim.currentOwnerName) === normalize(session.name)
  );
}

function isRequesterClaim(claim) {
  return session?.role === "counselor" && normalize(claim.requesterEmail) === normalize(session.email);
}

function canDecideClaim(claim) {
  if (claim.status !== "pending") return false;
  if (isAdmin()) return claim.adminStatus === "pending";
  return isCurrentOwnerClaim(claim) && claim.ownerStatus === "pending";
}

function renderKpis() {
  const pending = claims.filter((claim) => claim.status === "pending").length;
  const approved = claims.filter((claim) => claim.status === "approved").length;
  const rejected = claims.filter((claim) => claim.status === "rejected").length;
  const needsAction = claims.filter(canDecideClaim).length;

  const cards = [
    ["Total Claims", claims.length],
    ["Pending", pending],
    ["Approved", approved],
    ["Rejected", rejected],
    ["Needs My Action", needsAction]
  ];

  kpiSection.innerHTML = cards.map(([label, value]) => `
    <article class="card kpi-card">
      <p>${escapeHtml(label)}</p>
      <h2>${value}</h2>
    </article>
  `).join("");
}

function renderHeader() {
  if (isAdmin()) {
    heading.textContent = "Claim Raised";
    subheading.textContent = "Approve or reject counselor requests to claim leads assigned to another counselor.";
    clearButton?.classList.remove("hidden");
    return;
  }

  heading.textContent = "My Lead Claims";
  subheading.textContent = "Track claims you initiated and review claims raised against your leads.";
  clearButton?.classList.add("hidden");
}

function renderStatusPill(label, value) {
  const status = normalize(value) || "pending";
  return `<span class="lead-claim-status lead-claim-status--${escapeHtml(status)}">${escapeHtml(label)}: ${escapeHtml(statusLabel(status))}</span>`;
}

function renderClaimActions(claim) {
  if (!canDecideClaim(claim)) {
    return "";
  }

  const actor = isAdmin() ? "admin" : "owner";
  return `
    <div class="lead-claim-actions">
      <button type="button" class="btn-primary" data-claim-decision="approved" data-claim-id="${escapeHtml(claim.id)}" data-claim-actor="${actor}">Approve</button>
      <button type="button" class="btn-delete" data-claim-decision="rejected" data-claim-id="${escapeHtml(claim.id)}" data-claim-actor="${actor}">Reject</button>
    </div>
  `;
}

function renderClaimRole(claim) {
  if (isAdmin()) return "Admin review";
  if (isRequesterClaim(claim)) return "Raised by you";
  if (isCurrentOwnerClaim(claim)) return "Raised against your lead";
  return "Claim";
}

function renderClaims() {
  renderHeader();
  renderKpis();
  if (clearButton) {
    clearButton.disabled = !isAdmin() || claims.length === 0;
  }

  if (!claims.length) {
    list.innerHTML = `
      <div class="empty-state">
        <h3>No claim requests found</h3>
        <p>New lead claim requests will appear here.</p>
      </div>
    `;
    return;
  }

  list.innerHTML = `
    <div class="lead-claim-list">
      ${claims.map((claim) => `
        <article class="lead-claim-card">
          <div class="lead-claim-card__head">
            <div>
              <span class="lead-browse-pill">${escapeHtml(renderClaimRole(claim))}</span>
              <h3>${escapeHtml(claim.leadName || "Unnamed lead")}</h3>
              <p>${escapeHtml(claim.leadPhone || claim.leadEmail || "No contact")} | ${escapeHtml(claim.leadWorkshop || "No course/workshop")}</p>
            </div>
            <div class="lead-claim-status-stack">
              ${renderStatusPill("Claim", claim.status)}
              ${renderStatusPill("Admin", claim.adminStatus)}
              ${renderStatusPill("Lead holder", claim.ownerStatus)}
            </div>
          </div>
          <dl class="lead-claim-meta">
            <div><dt>Requested by</dt><dd>${escapeHtml(claim.requesterName || claim.requesterEmail)}</dd></div>
            <div><dt>Current holder</dt><dd>${escapeHtml(claim.currentOwnerName || "Unassigned")}</dd></div>
            <div><dt>Raised</dt><dd>${escapeHtml(formatDate(claim.createdAt))}</dd></div>
            <div><dt>Reason</dt><dd>${escapeHtml(claim.reason)}</dd></div>
          </dl>
          ${claim.rejectionReason ? `<p class="lead-claim-note">Rejection note: ${escapeHtml(claim.rejectionReason)}</p>` : ""}
          ${renderClaimActions(claim)}
        </article>
      `).join("")}
    </div>
  `;

  list.querySelectorAll("[data-claim-decision]").forEach((button) => {
    button.addEventListener("click", () => handleDecision(button));
  });
}

async function loadClaims() {
  setMessage("Loading claim requests...");
  const result = await fetchLeadClaims();
  if (!result.ok) {
    setMessage(result.message || "Could not load claim requests.", true);
    return;
  }

  claims = Array.isArray(result.claims) ? result.claims : [];
  setMessage("");
  renderClaims();
}

async function handleDecision(button) {
  const claimId = button.getAttribute("data-claim-id");
  const decision = button.getAttribute("data-claim-decision");
  const claim = claims.find((item) => item.id === claimId);
  if (!claim) return;

  let note = "";
  if (decision === "rejected") {
    note = window.prompt("Optional rejection note") || "";
  }

  button.disabled = true;
  setMessage(`${statusLabel(decision)} decision is being saved...`);
  const result = await decideLeadClaim(claimId, decision, note);
  button.disabled = false;

  if (!result.ok) {
    setMessage(result.message || "Could not update claim request.", true);
    return;
  }

  setMessage(decision === "approved" ? "Claim approval saved." : "Claim rejected.");
  await loadClaims();
}

async function clearClaimsList() {
  if (!isAdmin() || !claims.length) return;

  const confirmed = window.confirm("Clear all lead claim requests from this list?");
  if (!confirmed) return;

  clearButton.disabled = true;
  setMessage("Clearing claim requests...");
  const result = await clearLeadClaims();

  if (!result.ok) {
    clearButton.disabled = false;
    setMessage(result.message || "Could not clear claim requests.", true);
    return;
  }

  claims = [];
  setMessage(`Cleared ${result.deletedCount || 0} claim request${Number(result.deletedCount) === 1 ? "" : "s"}.`);
  renderClaims();
}

refreshButton?.addEventListener("click", loadClaims);
clearButton?.addEventListener("click", clearClaimsList);

await loadClaims();
window.__dvMarkRouteViewReady?.();
