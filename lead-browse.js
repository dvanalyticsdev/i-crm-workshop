import { getLeads, getSession, refreshState, startStatePolling } from "./state-sync.js";
import { trackLeadView } from "./lead-service.js";
import { raiseLeadClaim } from "./lead-claim-service.js";
import { openActivityHistory } from "./activity-history.js";

const PAGE_SIZE = 25;
const controls = document.getElementById("leadBrowseControls");
const kpiSection = document.getElementById("leadBrowseKpis");
const tableSection = document.getElementById("leadBrowseTableSection");
const pagination = document.getElementById("leadBrowsePagination");
const modal = document.getElementById("leadBrowseDetailsModal");
const modalTitle = document.getElementById("leadBrowseDetailsTitle");
const modalSubtitle = document.getElementById("leadBrowseDetailsSubtitle");
const modalBody = document.getElementById("leadBrowseDetailsBody");
const closeModalButton = document.getElementById("closeLeadBrowseDetailsBtn");
const activityHistoryButton = document.getElementById("leadBrowseActivityHistoryBtn");
const claimModal = document.getElementById("leadClaimModal");
const claimForm = document.getElementById("leadClaimForm");
const claimLeadTitle = document.getElementById("leadClaimLeadTitle");
const claimLeadMeta = document.getElementById("leadClaimLeadMeta");
const claimReasonInput = document.getElementById("leadClaimReason");
const claimMessage = document.getElementById("leadClaimMessage");
const cancelClaimButton = document.getElementById("cancelLeadClaimBtn");
const cancelClaimButtonSecondary = document.getElementById("cancelLeadClaimBtnSecondary");

const filter = {
  category: "workshop",
  admissionSection: "all",
  query: "",
  counselor: "",
  status: ""
};

let currentPage = 1;
let latestLeadKey = "";
let activeClaimLeadKey = "";

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

function getLeadKey(lead) {
  return [lead?.id, lead?.email, lead?.phone, lead?.leadPipeline, lead?.createdAt].map((value) => String(value || "")).join("::");
}

function getPipeline(lead) {
  return normalize(lead?.leadPipeline || "workshop") || "workshop";
}

function isRegisteredAdmissionLead(lead) {
  return getPipeline(lead) === "course-registration";
}

function isMainAdmissionLead(lead) {
  return getPipeline(lead) === "main-admission";
}

function isWorkshopLead(lead) {
  return !isRegisteredAdmissionLead(lead) && !isMainAdmissionLead(lead);
}

function hasAdmissionActivity(lead) {
  return Boolean(
    lead?.postStatusUpdated ||
    lead?.courseStatus ||
    lead?.admissionStatus ||
    lead?.postCallStatus ||
    lead?.admissionWorkshop ||
    Number(lead?.postActivityUpdates || 0) > 0 ||
    (Array.isArray(lead?.admissionActivityHistory) && lead.admissionActivityHistory.length > 0)
  );
}

function isAdmissionLead(lead) {
  return isRegisteredAdmissionLead(lead) || isMainAdmissionLead(lead) || isWorkshopLead(lead);
}

function getAdmissionSection(lead) {
  if (isMainAdmissionLead(lead)) return "main-admission";
  if (isRegisteredAdmissionLead(lead)) {
    return normalize(lead?.publicCourseSegment) === "crash-course" ? "crash-course" : "registered-candidates";
  }
  return "admission-calling";
}

function getCategoryLabel(lead) {
  if (isMainAdmissionLead(lead)) return "Main Admission";
  if (isRegisteredAdmissionLead(lead)) return "Registered Candidate";
  if (filter.category === "admission" || hasAdmissionActivity(lead)) return "Admission Calling";
  return "Workshop";
}

function getStatusLabel(lead) {
  return lead?.mainAdmissionAdmissionStatus ||
    lead?.registeredAdmissionStatus ||
    lead?.admissionStatus ||
    lead?.courseStatus ||
    lead?.wsStatus ||
    lead?.callStatus ||
    "No status";
}

function getCourseLabel(lead) {
  return lead?.courseName || lead?.coursePitched || lead?.mainAdmissionCoursePitched || lead?.registeredCoursePitched || lead?.workshop || "Not specified";
}

function getCreatedAt(lead) {
  const raw = lead?.createdAt || lead?.updatedAt || "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return String(raw || "Not available");
  return date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function getAllLeads() {
  return getLeads().filter((lead) => lead && !lead.isDeleted);
}

function getSessionCounselorName() {
  const session = getSession();
  return String(session?.name || "").trim();
}

function canRaiseClaimForLead(lead) {
  const session = getSession();
  if (session?.role !== "counselor") return false;

  const counselorName = getSessionCounselorName().toLowerCase();
  const leadCounselor = normalize(lead?.counselor || "");
  return !!counselorName &&
    !!leadCounselor &&
    leadCounselor !== "unassigned" &&
    leadCounselor !== counselorName;
}

function getCategoryLeads(leads) {
  if (filter.category === "workshop") {
    return leads.filter(isWorkshopLead);
  }

  return leads.filter((lead) => {
    if (!isAdmissionLead(lead)) return false;
    if (filter.admissionSection === "all") return true;
    return getAdmissionSection(lead) === filter.admissionSection;
  });
}

function getUniqueValues(leads, getter) {
  return [...new Set(leads.map(getter).map((value) => String(value || "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

function getFilteredLeads() {
  const categoryLeads = getCategoryLeads(getAllLeads());
  const query = normalize(filter.query);
  const counselor = normalize(filter.counselor);
  const status = normalize(filter.status);

  return categoryLeads.filter((lead) => {
    if (counselor && normalize(lead.counselor || "Unassigned") !== counselor) return false;
    if (status && normalize(getStatusLabel(lead)) !== status) return false;
    if (!query) return true;

    const haystack = [
      lead.name,
      lead.email,
      lead.phone,
      lead.workshop,
      lead.courseName,
      lead.source,
      lead.counselor,
      getStatusLabel(lead)
    ].map((value) => normalize(value)).join(" ");

    return haystack.includes(query);
  });
}

function renderKpis() {
  const leads = getAllLeads();
  const workshopCount = leads.filter(isWorkshopLead).length;
  const admissionCount = leads.filter(isAdmissionLead).length;
  const assignedCount = leads.filter((lead) => normalize(lead.counselor) && normalize(lead.counselor) !== "unassigned").length;
  const visibleCount = getFilteredLeads().length;

  kpiSection.innerHTML = [
    ["Workshop Leads", workshopCount],
    ["Admission Leads", admissionCount],
    ["Assigned Leads", assignedCount],
    ["Current View", visibleCount]
  ].map(([label, value]) => `
    <article class="card kpi-card">
      <p>${escapeHtml(label)}</p>
      <h2>${value}</h2>
    </article>
  `).join("");
}

function renderControls() {
  const categoryLeads = getCategoryLeads(getAllLeads());
  const counselors = getUniqueValues(categoryLeads, (lead) => lead.counselor || "Unassigned");
  const statuses = getUniqueValues(categoryLeads, getStatusLabel);

  controls.innerHTML = `
    <div class="lead-browse-tabs" role="tablist" aria-label="Lead categories">
      <button type="button" class="${filter.category === "workshop" ? "btn-primary" : "btn-ghost"}" data-category="workshop">Workshop Leads</button>
      <button type="button" class="${filter.category === "admission" ? "btn-primary" : "btn-ghost"}" data-category="admission">Admission Leads</button>
    </div>
    <div class="lead-browse-filters">
      ${filter.category === "admission" ? `
        <label>
          Section
          <select id="leadBrowseAdmissionSection">
            <option value="all" ${filter.admissionSection === "all" ? "selected" : ""}>All Admission Sections</option>
            <option value="admission-calling" ${filter.admissionSection === "admission-calling" ? "selected" : ""}>Admission Calling</option>
            <option value="registered-candidates" ${filter.admissionSection === "registered-candidates" ? "selected" : ""}>Registered Candidates</option>
            <option value="crash-course" ${filter.admissionSection === "crash-course" ? "selected" : ""}>Crash Course</option>
            <option value="main-admission" ${filter.admissionSection === "main-admission" ? "selected" : ""}>Main Admission Leads</option>
          </select>
        </label>
      ` : ""}
      <label>
        Search
        <input id="leadBrowseSearch" type="search" value="${escapeHtml(filter.query)}" placeholder="Name, phone, email, course..." />
      </label>
      <label>
        Counselor
        <select id="leadBrowseCounselor">
          <option value="">All Counselors</option>
          ${counselors.map((name) => `<option value="${escapeHtml(name)}" ${filter.counselor === name ? "selected" : ""}>${escapeHtml(name)}</option>`).join("")}
        </select>
      </label>
      <label>
        Status
        <select id="leadBrowseStatus">
          <option value="">All Statuses</option>
          ${statuses.map((status) => `<option value="${escapeHtml(status)}" ${filter.status === status ? "selected" : ""}>${escapeHtml(status)}</option>`).join("")}
        </select>
      </label>
    </div>
  `;

  controls.querySelectorAll("[data-category]").forEach((button) => {
    button.addEventListener("click", () => {
      filter.category = button.getAttribute("data-category");
      filter.counselor = "";
      filter.status = "";
      currentPage = 1;
      render();
    });
  });

  const admissionSection = document.getElementById("leadBrowseAdmissionSection");
  if (admissionSection) {
    admissionSection.addEventListener("change", (event) => {
      filter.admissionSection = event.target.value;
      currentPage = 1;
      render();
    });
  }

  document.getElementById("leadBrowseSearch").addEventListener("input", (event) => {
    filter.query = event.target.value;
    currentPage = 1;
    render();
  });
  document.getElementById("leadBrowseCounselor").addEventListener("change", (event) => {
    filter.counselor = event.target.value;
    currentPage = 1;
    render();
  });
  document.getElementById("leadBrowseStatus").addEventListener("change", (event) => {
    filter.status = event.target.value;
    currentPage = 1;
    render();
  });
}

function renderTable() {
  const leads = getFilteredLeads();
  const totalPages = Math.max(1, Math.ceil(leads.length / PAGE_SIZE));
  currentPage = Math.min(currentPage, totalPages);
  const pageLeads = leads.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  if (!pageLeads.length) {
    tableSection.innerHTML = `
      <div class="empty-state">
        <h3>No leads found</h3>
        <p>Adjust the current filters to browse a wider set of leads.</p>
      </div>
    `;
    pagination.innerHTML = "";
    return;
  }

  tableSection.innerHTML = `
    <div class="table-scroll">
      <table class="lead-table">
        <thead>
          <tr>
            <th>Lead</th>
            <th>Phone</th>
            <th>Counselor</th>
            <th>Section</th>
            <th>Course / Workshop</th>
            <th>Status</th>
            <th>Created</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${pageLeads.map((lead) => `
            ${(() => {
              const leadKey = escapeHtml(getLeadKey(lead));
              return `
            <tr>
              <td>
                <strong>${escapeHtml(lead.name || "Unnamed lead")}</strong>
                <span>${escapeHtml(lead.email || "No email")}</span>
              </td>
              <td>${escapeHtml(lead.phone || "Not available")}</td>
              <td>${escapeHtml(lead.counselor || "Unassigned")}</td>
              <td><span class="lead-browse-pill">${escapeHtml(getCategoryLabel(lead))}</span></td>
              <td>${escapeHtml(getCourseLabel(lead))}</td>
              <td>${escapeHtml(getStatusLabel(lead))}</td>
              <td>${escapeHtml(getCreatedAt(lead))}</td>
              <td>
                <div class="lead-browse-row-actions">
                  <button type="button" class="btn-ghost" data-view-lead="${leadKey}">View</button>
                  <button type="button" class="btn-ghost" data-history-lead="${leadKey}">Activity</button>
                  ${canRaiseClaimForLead(lead) ? `<button type="button" class="btn-primary" data-claim-lead="${leadKey}">Claim</button>` : ""}
                </div>
              </td>
            </tr>
              `;
            })()}
          `).join("")}
        </tbody>
      </table>
    </div>
  `;

  tableSection.querySelectorAll("[data-view-lead]").forEach((button) => {
    button.addEventListener("click", () => openDetails(button.getAttribute("data-view-lead")));
  });
  tableSection.querySelectorAll("[data-history-lead]").forEach((button) => {
    button.addEventListener("click", () => openLeadActivityHistory(button.getAttribute("data-history-lead")));
  });
  tableSection.querySelectorAll("[data-claim-lead]").forEach((button) => {
    button.addEventListener("click", () => openClaimModal(button.getAttribute("data-claim-lead")));
  });

  pagination.innerHTML = `
    <button type="button" class="btn-ghost" id="leadBrowsePrev" ${currentPage <= 1 ? "disabled" : ""}>Prev</button>
    <span>Page ${currentPage} of ${totalPages}</span>
    <button type="button" class="btn-ghost" id="leadBrowseNext" ${currentPage >= totalPages ? "disabled" : ""}>Next</button>
  `;

  document.getElementById("leadBrowsePrev")?.addEventListener("click", () => {
    currentPage = Math.max(1, currentPage - 1);
    render();
  });
  document.getElementById("leadBrowseNext")?.addEventListener("click", () => {
    currentPage = Math.min(totalPages, currentPage + 1);
    render();
  });
}

function setClaimMessage(text, isError = false) {
  if (!claimMessage) return;
  claimMessage.textContent = text || "";
  claimMessage.style.color = isError ? "var(--danger)" : "var(--success)";
}

function openClaimModal(leadKey) {
  const lead = findLeadByKey(leadKey);
  if (!lead || !claimModal || !claimForm) return;

  activeClaimLeadKey = leadKey;
  claimLeadTitle.textContent = lead.name || "Unnamed lead";
  claimLeadMeta.textContent = `Currently assigned to ${lead.counselor || "Unassigned"} | ${getCourseLabel(lead)}`;
  claimReasonInput.value = "";
  setClaimMessage("");
  claimModal.classList.remove("hidden");
  claimReasonInput.focus();
}

function closeClaimModal() {
  activeClaimLeadKey = "";
  claimModal?.classList.add("hidden");
  if (claimForm) {
    claimForm.reset();
  }
  setClaimMessage("");
}

function findLeadByKey(leadKey) {
  return getAllLeads().find((lead) => getLeadKey(lead) === leadKey) || null;
}

function renderDetailItem(label, value) {
  return `
    <div class="lead-browse-detail-item">
      <dt>${escapeHtml(label)}</dt>
      <dd>${escapeHtml(value || "Not available")}</dd>
    </div>
  `;
}

async function openDetails(leadKey) {
  const lead = findLeadByKey(leadKey);
  if (!lead) return;

  latestLeadKey = leadKey;
  modalTitle.textContent = lead.name || "Lead Details";
  modalSubtitle.textContent = `${getCategoryLabel(lead)} | Assigned to ${lead.counselor || "Unassigned"}`;
  modalBody.innerHTML = [
    ["Name", lead.name],
    ["Email", lead.email],
    ["Phone", lead.phone],
    ["Counselor", lead.counselor || "Unassigned"],
    ["Section", getCategoryLabel(lead)],
    ["Course / Workshop", getCourseLabel(lead)],
    ["Workshop", lead.workshop],
    ["Admission Workshop", lead.admissionWorkshop],
    ["Source", lead.source],
    ["City / Branch", lead.city || lead.branch || lead.country],
    ["Workshop Call Status", lead.callStatus],
    ["Workshop Status", lead.wsStatus],
    ["Admission Call Status", lead.postCallStatus || lead.mainAdmissionCallStatus || lead.registeredCallStatus],
    ["Course Status", lead.courseStatus || lead.mainAdmissionCourseStatus || lead.registeredCourseStatus],
    ["Admission Status", lead.admissionStatus || lead.mainAdmissionAdmissionStatus || lead.registeredAdmissionStatus],
    ["Created", getCreatedAt(lead)]
  ].map(([label, value]) => renderDetailItem(label, value)).join("");

  modal.classList.remove("hidden");

  const result = await trackLeadView(lead.id, lead.email || "");
  if (!result.ok) {
    console.warn("Lead view notification failed:", result.message);
  }
}

async function openLeadActivityHistory(leadKey) {
  const lead = findLeadByKey(leadKey);
  if (!lead) return;

  latestLeadKey = leadKey;
  openActivityHistory(lead.id, lead.name || "Lead", lead.email || "");

  const result = await trackLeadView(lead.id, lead.email || "");
  if (!result.ok) {
    console.warn("Lead view notification failed:", result.message);
  }
}

function closeDetails() {
  latestLeadKey = "";
  modal.classList.add("hidden");
}

function render() {
  renderKpis();
  renderControls();
  renderTable();
}

closeModalButton?.addEventListener("click", closeDetails);
activityHistoryButton?.addEventListener("click", () => {
  if (latestLeadKey) {
    void openLeadActivityHistory(latestLeadKey);
  }
});
modal?.addEventListener("click", (event) => {
  if (event.target === modal) closeDetails();
});
cancelClaimButton?.addEventListener("click", closeClaimModal);
cancelClaimButtonSecondary?.addEventListener("click", closeClaimModal);
claimModal?.addEventListener("click", (event) => {
  if (event.target === claimModal) closeClaimModal();
});
claimForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const lead = findLeadByKey(activeClaimLeadKey);
  const reason = String(claimReasonInput?.value || "").trim();
  if (!lead) {
    setClaimMessage("This lead is no longer available. Please refresh and try again.", true);
    return;
  }
  if (reason.length < 12) {
    setClaimMessage("Please enter a detailed formal reason for this claim.", true);
    return;
  }

  const submitButton = claimForm.querySelector("button[type='submit']");
  if (submitButton) submitButton.disabled = true;
  setClaimMessage("Submitting claim request...");
  const result = await raiseLeadClaim({
    leadId: lead.id,
    leadEmail: lead.email || "",
    reason
  });
  if (submitButton) submitButton.disabled = false;

  if (!result.ok) {
    setClaimMessage(result.message || "Could not submit claim request.", true);
    return;
  }

  setClaimMessage("Claim request submitted for approval.");
  window.setTimeout(closeClaimModal, 700);
});

await refreshState().catch(() => undefined);
render();

startStatePolling(() => {
  if (latestLeadKey && !findLeadByKey(latestLeadKey)) {
    closeDetails();
  }
  render();
}, 15000);
