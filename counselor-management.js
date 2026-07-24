import { registerPageCleanup } from "./page-runtime.js";
import {
  bootstrapLocalState,
  getAdminUsers as getStoredAdminUsers,
  getAllocation as getStoredAllocation,
  getCounselors as getStoredCounselors,
  getSession,
  getLeads as getStoredLeads,
  getMarketingUsers as getStoredMarketingUsers,
  saveAdminUsers as persistAdminUsers,
  saveAllocation as persistAllocation,
  saveCounselors as persistCounselors,
  saveLeads as persistLeads,
  saveMarketingUsers as persistMarketingUsers,
  startStatePolling,
  syncStateFromLocalAndVerify
} from "./state-sync.js";
import { PUBLIC_COURSES } from "./course-catalog.js";

await bootstrapLocalState();

const DEFAULT_PERMISSIONS = {
  dashboard: false,
  preWorkshop: true,
  postWorkshop: true,
  lostLeads: true,
  monitoring: true
};
const ADMIN_DEFAULT_PERMISSIONS = {
  dashboard: true,
  leadBrowse: true,
  claimRaised: true,
  leadCreation: true,
  admissionSop: true,
  preWorkshop: true,
  postWorkshop: true,
  registeredCandidates: true,
  mainAdmissionLeads: true,
  taskTracker: true,
  lostLeads: true,
  monitoring: true,
  counselorManagement: true,
  leadControl: true,
  metaIntegration: true,
  elementorIntegration: true,
  mcubeIntegration: true,
  leadFlowControl: true,
  reachout: true
};
const COUNSELOR_PERMISSION_OPTIONS = [
  { key: "preWorkshop", label: "Workshop Calling" },
  { key: "postWorkshop", label: "Admission Calling" },
  { key: "lostLeads", label: "Lost Leads" },
  { key: "monitoring", label: "Monitoring" }
];
const ADMIN_PERMISSION_OPTIONS = [
  { key: "dashboard", label: "Dashboard" },
  { key: "preWorkshop", label: "Workshop Calling" },
  { key: "postWorkshop", label: "Admission Calling" },
  { key: "registeredCandidates", label: "Registered Candidates" },
  { key: "mainAdmissionLeads", label: "Main Admission Leads" },
  { key: "lostLeads", label: "Lost Leads" },
  { key: "monitoring", label: "Monitoring" },
  { key: "leadControl", label: "Lead & Data Control" },
  { key: "metaIntegration", label: "Meta Integration" },
  { key: "elementorIntegration", label: "Elementor Integration" },
  { key: "mcubeIntegration", label: "MCUBE Integration" },
  { key: "leadFlowControl", label: "Lead Flow Control" },
  { key: "reachout", label: "ReachOut" },
  { key: "leadBrowse", label: "Lead Browse" },
  { key: "claimRaised", label: "Claim Raised" },
  { key: "leadCreation", label: "Lead Creation" },
  { key: "admissionSop", label: "SOP Tracker" },
  { key: "taskTracker", label: "Task Tracker" },
  { key: "counselorManagement", label: "Counselor Management" }
];
const BRANCH_OPTIONS = ["Bangalore", "Bhubaneswar"];
const DEFAULT_BRANCH = "Bangalore";
const COURSE_PERMISSION_OPTIONS = PUBLIC_COURSES.map((course) => ({
  id: course.id,
  label: course.code || course.shortName || course.name,
  name: course.name
}));

const counselorForm = document.getElementById("counselorForm");
const counselorFormMessage = document.getElementById("counselorFormMessage");
const counselorList = document.getElementById("counselorList");
const counselorSearchInput = document.getElementById("counselorSearchInput");
const adminSearchInput = document.getElementById("adminSearchInput");
const marketingSearchInput = document.getElementById("marketingSearchInput");
const managementSummarySection = document.getElementById("managementSummarySection");
const adminPermissionsGrid = document.getElementById("adminPermissionsGrid");
const adminCreateCard = document.getElementById("adminCreateCard");
const userDetailsModal = document.getElementById("userDetailsModal");
const userDetailsTitle = document.getElementById("userDetailsTitle");
const userDetailsSubtitle = document.getElementById("userDetailsSubtitle");
const userDetailsBody = document.getElementById("userDetailsBody");
const userDetailsActions = document.getElementById("userDetailsActions");
const passwordChangeModal = document.getElementById("passwordChangeModal");
const passwordChangeForm = document.getElementById("passwordChangeForm");
const passwordChangeTitle = document.getElementById("passwordChangeTitle");
const passwordChangeUserType = document.getElementById("passwordChangeUserType");
const passwordChangeUserId = document.getElementById("passwordChangeUserId");
const passwordChangeUserName = document.getElementById("passwordChangeUserName");
const passwordChangeNewPassword = document.getElementById("passwordChangeNewPassword");
const passwordChangeMessage = document.getElementById("passwordChangeMessage");
const userEditModal = document.getElementById("userEditModal");
const userEditForm = document.getElementById("userEditForm");
const userEditTitle = document.getElementById("userEditTitle");
const userEditType = document.getElementById("userEditType");
const userEditId = document.getElementById("userEditId");
const userEditName = document.getElementById("userEditName");
const userEditEmail = document.getElementById("userEditEmail");
const userEditEmailRow = document.getElementById("userEditEmailRow");
const userEditPhone = document.getElementById("userEditPhone");
const userEditPhoneRow = document.getElementById("userEditPhoneRow");
const userEditBranch = document.getElementById("userEditBranch");
const userEditBranchRow = document.getElementById("userEditBranchRow");
const userEditPermissionsRow = document.getElementById("userEditPermissionsRow");
const editPermissionsGrid = document.getElementById("editPermissionsGrid");
const userEditMessage = document.getElementById("userEditMessage");
let counselorSearchTerm = "";
let adminSearchTerm = "";
let marketingSearchTerm = "";
let activeDetailsUser = null;
const activeSession = getSession();
const isSuperAdminSession = activeSession?.role === "super_admin";

if (adminCreateCard) {
  adminCreateCard.classList.toggle("hidden", !isSuperAdminSession);
}

function setPasswordChangeMessage(text, isError = true) {
  if (!passwordChangeMessage) {
    return;
  }

  passwordChangeMessage.textContent = text;
  passwordChangeMessage.style.color = isError ? "var(--danger)" : "var(--success)";
}

function closePasswordChangeModal() {
  if (!passwordChangeModal || !passwordChangeForm) {
    return;
  }

  passwordChangeForm.reset();
  passwordChangeUserType.value = "";
  passwordChangeUserId.value = "";
  passwordChangeUserName.value = "";
  setPasswordChangeMessage("");
  passwordChangeModal.classList.add("hidden");
}

function closeUserDetailsModal() {
  if (!userDetailsModal) {
    return;
  }

  activeDetailsUser = null;
  userDetailsModal.classList.add("hidden");
}

function setUserEditMessage(text, isError = true) {
  if (!userEditMessage) {
    return;
  }

  userEditMessage.textContent = text;
  userEditMessage.style.color = isError ? "var(--danger)" : "var(--success)";
}

function getSelectedEditPermissions() {
  const fallback = userEditType.value === "admin"
    ? ADMIN_DEFAULT_PERMISSIONS
    : DEFAULT_PERMISSIONS;
  return getSelectedPermissionMap("editPermission", fallback);
}

function renderPermissionOptions(container, options, inputName, selectedPermissions = {}) {
  if (!container) {
    return;
  }

  container.innerHTML = options.map((option) => `
    <label class="permission-option">
      <input
        type="checkbox"
        name="${escapeHtml(inputName)}"
        value="${escapeHtml(option.key)}"
        ${selectedPermissions[option.key] ? "checked" : ""}
      />
      ${escapeHtml(option.label)}
    </label>
  `).join("");
}

function getSelectedPermissionMap(inputName, fallback = {}) {
  const selectedKeys = new Set(
    Array.from(document.querySelectorAll(`input[name='${inputName}']:checked`))
      .map((item) => String(item.value || "").trim())
      .filter(Boolean)
  );

  return Object.keys(fallback).reduce((accumulator, key) => {
    accumulator[key] = selectedKeys.has(key);
    return accumulator;
  }, {});
}

function normalizeBranch(value, fallback = DEFAULT_BRANCH) {
  const match = BRANCH_OPTIONS.find((branch) => branch.toLowerCase() === String(value || "").trim().toLowerCase());
  return match || fallback;
}

function normalizeCoursePermissions(value) {
  if (!Array.isArray(value)) {
    return COURSE_PERMISSION_OPTIONS.map((course) => course.id);
  }

  const allowed = new Set(COURSE_PERMISSION_OPTIONS.map((course) => course.id));
  return [...new Set(value.map((item) => String(item || "").trim()).filter((item) => allowed.has(item)))];
}

function coursePermissionText(courseIds) {
  const selected = new Set(normalizeCoursePermissions(courseIds));
  if (!selected.size) {
    return "No courses";
  }
  if (selected.size === COURSE_PERMISSION_OPTIONS.length) {
    return "All courses";
  }

  return COURSE_PERMISSION_OPTIONS
    .filter((course) => selected.has(course.id))
    .map((course) => course.label)
    .join(", ");
}

function closeUserEditModal() {
  if (!userEditModal || !userEditForm) {
    return;
  }

  userEditForm.reset();
  userEditType.value = "";
  userEditId.value = "";
  setUserEditMessage("");
  userEditEmailRow.classList.remove("hidden");
  userEditEmail.required = true;
  userEditPhoneRow.classList.add("hidden");
  userEditBranchRow.classList.add("hidden");
  userEditPermissionsRow.classList.add("hidden");
  if (editPermissionsGrid) {
    editPermissionsGrid.innerHTML = "";
  }
  userEditModal.classList.add("hidden");
}

function openUserEditModal({ userType, user }) {
  if (!userEditModal || !user) {
    return;
  }

  userEditType.value = userType;
  userEditId.value = user.id || "";
  userEditName.value = user.name || "";
  userEditEmail.value = user.email || "";
  setUserEditMessage("");

  const isCounselor = userType === "counselor";
  const isAdmin = userType === "admin";
  userEditTitle.textContent = isCounselor ? "Edit Counselor" : "Edit Marketing User";
  if (isAdmin) {
    userEditTitle.textContent = "Edit Admin";
  }
  userEditEmailRow.classList.toggle("hidden", isAdmin);
  userEditEmail.required = !isAdmin;
  userEditPhoneRow.classList.toggle("hidden", !(isCounselor || isAdmin));
  userEditBranchRow.classList.toggle("hidden", !isCounselor);
  userEditPermissionsRow.classList.toggle("hidden", !(isCounselor || isAdmin));

  if (isCounselor) {
    userEditPhone.value = user.phone || "";
    userEditBranch.value = normalizeBranch(user.branch);
    const permissions = {
      ...DEFAULT_PERMISSIONS,
      ...(user.permissions || {})
    };
    renderPermissionOptions(editPermissionsGrid, COUNSELOR_PERMISSION_OPTIONS, "editPermission", permissions);
  } else if (isAdmin) {
    userEditPhone.value = user.phone || "";
    userEditBranch.value = "";
    userEditEmail.value = user.email || "";
    const permissions = {
      ...ADMIN_DEFAULT_PERMISSIONS,
      ...(user.permissions || {})
    };
    renderPermissionOptions(editPermissionsGrid, ADMIN_PERMISSION_OPTIONS, "editPermission", permissions);
  } else {
    userEditPhone.value = "";
    userEditBranch.value = "";
    if (editPermissionsGrid) {
      editPermissionsGrid.innerHTML = "";
    }
  }

  userEditModal.classList.remove("hidden");
}

function openPasswordChangeModal({ userType, userId, name }) {
  if (!passwordChangeModal) {
    return;
  }

  passwordChangeUserType.value = userType;
  passwordChangeUserId.value = userId;
  passwordChangeUserName.value = name || "";
  passwordChangeTitle.textContent = userType === "marketing"
    ? "Change Marketing User Password"
    : userType === "admin"
      ? "Change Admin Password"
      : "Change Counselor Password";
  passwordChangeNewPassword.value = "";
  setPasswordChangeMessage("");
  passwordChangeModal.classList.remove("hidden");
}

function setMessage(text, isError = true) {
  counselorFormMessage.textContent = text;
  counselorFormMessage.style.color = isError ? "var(--danger)" : "var(--success)";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getCounselors() {
  return getStoredCounselors().map((item) => ({
    ...item,
    email: String(item.email || "").toLowerCase(),
    branch: normalizeBranch(item.branch),
    admissionCoursePermissions: normalizeCoursePermissions(item.admissionCoursePermissions),
    permissions: {
      ...DEFAULT_PERMISSIONS,
      ...(item.permissions || {})
    }
  }));
}

function saveCounselors(counselors) {
  return persistCounselors(counselors);
}

function getLeads() {
  return getStoredLeads();
}

function getAdminUsers() {
  return getStoredAdminUsers().map((item) => ({
    ...item,
    phone: String(item.phone || "").trim(),
    permissions: {
      ...ADMIN_DEFAULT_PERMISSIONS,
      ...(item.permissions || {})
    }
  }));
}

function saveAdminUsers(adminUsers) {
  return persistAdminUsers(adminUsers);
}

function saveLeads(leads) {
  return persistLeads(leads);
}

function getAllocation() {
  return getStoredAllocation();
}

function saveAllocation(allocation) {
  return persistAllocation(allocation);
}

async function syncAllocationWithCounselors(counselors) {
  const counselorNames = [...new Set(
    counselors
      .map((item) => String(item.name || "").trim())
      .filter(Boolean)
  )];

  const existing = getAllocation();
  const byName = new Map(
    existing.map((item) => [String(item.name || "").trim().toLowerCase(), Number(item.percentage || 0)])
  );

  const next = counselorNames.map((name) => ({
    name,
    percentage: byName.get(name.toLowerCase()) || 0
  }));

  await saveAllocation(next);
}

function rebalanceAllocation(items) {
  if (!items.length) {
    return [];
  }

  const total = items.reduce((sum, item) => sum + Number(item.percentage || 0), 0);
  if (total <= 0) {
    const even = 100 / items.length;
    return items.map((item) => ({
      name: item.name,
      percentage: Number(even.toFixed(2))
    }));
  }

  let normalized = items.map((item) => ({
    name: item.name,
    percentage: Number((((Number(item.percentage || 0) / total) * 100).toFixed(2)))
  }));

  const roundedTotal = normalized.reduce((sum, item) => sum + item.percentage, 0);
  const delta = Number((100 - roundedTotal).toFixed(2));
  if (normalized.length && delta !== 0) {
    normalized[normalized.length - 1].percentage = Number(
      (normalized[normalized.length - 1].percentage + delta).toFixed(2)
    );
  }

  return normalized;
}

async function removeCounselor(counselorId) {
  const counselors = getCounselors();
  const target = counselors.find((item) => item.id === counselorId);
  if (!target) {
    setMessage("Counselor not found.", true);
    return;
  }

  const confirmed = window.confirm(`Remove counselor ${target.name}?`);
  if (!confirmed) {
    return;
  }

  const nextCounselors = counselors.filter((item) => item.id !== counselorId);
  const saveCounselorResult = await saveCounselors(nextCounselors);
  if (!saveCounselorResult || saveCounselorResult.ok === false) {
    setMessage(saveCounselorResult?.message || "Failed to save counselor changes. Please check your connection.", true);
    return;
  }
  await syncAllocationWithCounselors(nextCounselors);

  const leads = getLeads();
  let changed = false;
  const updatedLeads = leads.map((lead) => {
    if (String(lead.counselor || "").toLowerCase() === target.name.toLowerCase()) {
      changed = true;
      return {
        ...lead,
        counselor: "Unassigned"
      };
    }
    return lead;
  });
  if (changed) {
    const saveLeadsResult = await saveLeads(updatedLeads);
    if (!saveLeadsResult || saveLeadsResult.ok === false) {
      setMessage(saveLeadsResult?.message || "Counselor removed but failed to unassign leads. Please reload and retry.", true);
      return;
    }
  }

  const allocation = getAllocation();
  const filteredAllocation = allocation.filter(
    (item) => String(item.name || "").toLowerCase() !== target.name.toLowerCase()
  );
  if (filteredAllocation.length !== allocation.length) {
    const saveAllocResult = await saveAllocation(rebalanceAllocation(filteredAllocation));
    if (!saveAllocResult || saveAllocResult.ok === false) {
      setMessage(saveAllocResult?.message || "Counselor removed but failed to update allocation. Please reload and retry.", true);
      return;
    }
  }

  const syncResult = await syncStateFromLocalAndVerify();
  if (!syncResult.ok) {
    setMessage(syncResult.message || `Backend confirmation failed after removing counselor ${target.name}.`, true);
    return;
  }

  setMessage(`Counselor ${target.name} removed successfully.`, false);
  renderCounselorList();
}

function permissionText(permissions) {
  const names = [];
  [...COUNSELOR_PERMISSION_OPTIONS, ...ADMIN_PERMISSION_OPTIONS].forEach((option) => {
    if (permissions?.[option.key] && !names.includes(option.label)) {
      names.push(option.label);
    }
  });
  return names.length ? names.join(", ") : "No access";
}

function renderPermissionBadges(permissions) {
  const items = [];
  [...COUNSELOR_PERMISSION_OPTIONS, ...ADMIN_PERMISSION_OPTIONS].forEach((option) => {
    if (permissions?.[option.key] && !items.includes(option.label)) {
      items.push(option.label);
    }
  });

  return items.length
    ? `<div class="permission-badge-row">${items.map((item) => `<span class="permission-badge">${escapeHtml(item)}</span>`).join("")}</div>`
    : `<span class="management-muted">No access</span>`;
}

function buildDetailsRows(details) {
  return details.map(([label, value]) => `
    <div class="management-details-item">
      <dt>${escapeHtml(label)}</dt>
      <dd>${escapeHtml(value || "-")}</dd>
    </div>
  `).join("");
}

function openUserDetailsModal({ userType, user }) {
  if (!userDetailsModal || !user) {
    return;
  }

  activeDetailsUser = { userType, userId: user.id };
  const isCounselor = userType === "counselor";
  const isAdmin = userType === "admin";
  userDetailsTitle.textContent = user.name || "User";
  userDetailsSubtitle.textContent = isCounselor
    ? "Counselor account details, assigned access, and quick management actions."
    : isAdmin
      ? "Admin account details and quick management actions."
      : "Marketing account details and quick management actions.";

  const detailsMarkup = isCounselor
    ? [
        {
          title: "Profile",
          rows: [
            ["Name", user.name],
            ["Email", user.email],
            ["Phone Number", user.phone],
            ["Branch Location", normalizeBranch(user.branch)]
          ]
        },
        {
          title: "Lead Permissions",
          rows: [
            ["Page Access", permissionText(user.permissions || DEFAULT_PERMISSIONS)],
            ["Course Eligibility", coursePermissionText(user.admissionCoursePermissions)]
          ]
        }
      ]
    : isAdmin
      ? [
          {
            title: "Profile",
            rows: [
              ["Name", user.name],
              ["Phone Number", user.phone]
            ]
          },
          {
            title: "Page Access",
            rows: [
              ["Allowed Pages", permissionText(user.permissions || ADMIN_DEFAULT_PERMISSIONS)]
            ]
          }
        ]
      : [
        {
          title: "Profile",
          rows: [
            ["Name", user.name],
            ["Email", user.email]
          ]
        }
      ];

  userDetailsBody.innerHTML = detailsMarkup.map((section) => `
    <section class="management-details-card">
      <h4>${escapeHtml(section.title)}</h4>
      <dl class="management-details-list">
        ${buildDetailsRows(section.rows)}
      </dl>
      ${section.title === "Lead Permissions" && isCounselor ? renderPermissionBadges(user.permissions || DEFAULT_PERMISSIONS) : ""}
      ${section.title === "Page Access" && isAdmin ? renderPermissionBadges(user.permissions || ADMIN_DEFAULT_PERMISSIONS) : ""}
    </section>
  `).join("");

  userDetailsActions.innerHTML = `
    <button type="button" class="btn-primary" id="userDetailsEditBtn">Edit</button>
    <button type="button" class="btn-ghost" id="userDetailsPasswordBtn">Change Password</button>
    <button type="button" class="btn-ghost" id="userDetailsRemoveBtn">Remove</button>
  `;

  document.getElementById("userDetailsEditBtn")?.addEventListener("click", () => {
    closeUserDetailsModal();
    openUserEditModal({ userType, user });
  });
  document.getElementById("userDetailsPasswordBtn").onclick = () => {
    closeUserDetailsModal();
    openPasswordChangeModal({
      userType,
      userId: user.id,
      name: user.name
    });
  };
  document.getElementById("userDetailsRemoveBtn").onclick = () => {
    closeUserDetailsModal();
    if (isCounselor) {
      void removeCounselor(user.id);
    } else if (isAdmin) {
      void removeAdminUser(user.id);
    } else {
      void removeMarketingUser(user.id);
    }
  };

  userDetailsModal.classList.remove("hidden");
}

function renderManagementSummary() {
  if (!managementSummarySection) {
    return;
  }

  const counselors = getCounselors();
  const admins = getAdminUsers();
  const marketingUsers = getMarketingUsers();
  const workshopAccess = counselors.filter((item) => item.permissions?.preWorkshop).length;
  const monitoringAccess = counselors.filter((item) => item.permissions?.monitoring).length;

  managementSummarySection.innerHTML = `
    <article class="card management-summary-card">
      <p>Total Admins</p>
      <h2>${admins.length}</h2>
    </article>
    <article class="card management-summary-card">
      <p>Total Counselors</p>
      <h2>${counselors.length}</h2>
    </article>
    <article class="card management-summary-card">
      <p>Total Marketing Users</p>
      <h2>${marketingUsers.length}</h2>
    </article>
    <article class="card management-summary-card">
      <p>Workshop Access Enabled</p>
      <h2>${workshopAccess}</h2>
    </article>
    <article class="card management-summary-card">
      <p>Monitoring Access Enabled</p>
      <h2>${monitoringAccess}</h2>
    </article>
  `;
}

function renderCounselorList() {
  const counselors = getCounselors();
  const filteredCounselors = counselors.filter((counselor) => {
    if (!counselorSearchTerm) {
      return true;
    }

    const haystack = [
      counselor.name,
      counselor.email,
      counselor.phone,
      counselor.branch,
      coursePermissionText(counselor.admissionCoursePermissions),
      permissionText(counselor.permissions || DEFAULT_PERMISSIONS)
    ].join(" ").toLowerCase();
    return haystack.includes(counselorSearchTerm);
  });

  counselorList.innerHTML = `
    ${filteredCounselors.length
      ? `<div class="management-name-list">
          ${filteredCounselors.map((counselor) => `
            <button
              type="button"
              class="management-name-card open-counselor-details-btn"
              data-counselor-id="${counselor.id}"
            >
              <span class="management-name-card__title">${escapeHtml(counselor.name)}</span>
              <span class="management-name-card__meta">${escapeHtml(counselor.email)}</span>
              <span class="management-name-card__meta">${escapeHtml(normalizeBranch(counselor.branch))} branch</span>
            </button>
          `).join("")}
        </div>`
      : `<p class="management-empty-state">No counselors match the current search.</p>`
    }
  `;

  document.querySelectorAll(".open-counselor-details-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const counselorId = button.getAttribute("data-counselor-id");
      const counselor = counselors.find((item) => item.id === counselorId);
      if (!counselor) {
        return;
      }
      openUserDetailsModal({ userType: "counselor", user: counselor });
    });
  });
}

function getSelectedPermissions() {
  return getSelectedPermissionMap("permission", DEFAULT_PERMISSIONS);
}

counselorForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const name = document.getElementById("counselorName").value.trim();
  const email = document.getElementById("counselorEmail").value.trim().toLowerCase();
  const phone = document.getElementById("counselorPhone").value.trim();
  const branch = normalizeBranch(document.getElementById("counselorBranch").value, "");
  const password = document.getElementById("counselorPassword").value.trim();
  const permissions = getSelectedPermissions();

  if (!name || !email || !phone || !branch || !password) {
    setMessage("All counselor fields are required.", true);
    return;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setMessage("Enter a valid counselor email address.", true);
    return;
  }

  if (!Object.values(permissions).some(Boolean)) {
    setMessage("Select at least one access permission.", true);
    return;
  }

  const counselors = getCounselors();
  if (counselors.some((item) => item.email === email)) {
    setMessage("A counselor with this email already exists.", true);
    return;
  }

  counselors.push({
    id: `c-${Date.now()}`,
    name,
    email,
    phone,
    branch,
    password,
    roundRobinEnabled: true,
    admissionRoundRobinEnabled: false,
    admissionCoursePermissions: COURSE_PERMISSION_OPTIONS.map((course) => course.id),
    permissions
  });

  await saveCounselors(counselors);
  await syncAllocationWithCounselors(counselors);

  const syncResult = await syncStateFromLocalAndVerify();
  if (!syncResult.ok) {
    setMessage(syncResult.message || "Backend confirmation failed after saving the counselor.", true);
    return;
  }

  counselorForm.reset();

  // restore default checked state for convenience
  document.querySelectorAll("input[name='permission']").forEach((item) => {
    item.checked = true;
  });

  setMessage("Counselor created successfully.", false);
  renderCounselorList();
});

renderCounselorList();
renderManagementSummary();
renderPermissionOptions(
  adminPermissionsGrid,
  ADMIN_PERMISSION_OPTIONS,
  "adminPermission",
  ADMIN_DEFAULT_PERMISSIONS
);
const stopStatePolling = startStatePolling(() => {
  renderManagementSummary();
  renderCounselorList();
  renderMarketingList();
});
registerPageCleanup(stopStatePolling);

// ── Marketing Users ───────────────────────────────────────────────────────────

renderManagementSummary = ((original) => function wrappedRenderManagementSummary() {
  original();
  renderAdminList();
})(renderManagementSummary);

const adminForm = document.getElementById("adminForm");
const adminFormMessage = document.getElementById("adminFormMessage");
const adminList = document.getElementById("adminList");

function setAdminMessage(text, isError = true) {
  if (!adminFormMessage) {
    return;
  }
  adminFormMessage.textContent = text;
  adminFormMessage.style.color = isError ? "var(--danger)" : "var(--success)";
}

async function removeAdminUser(userId) {
  const users = getAdminUsers();
  const target = users.find((item) => item.id === userId);
  if (!target) return;

  const confirmed = window.confirm(`Remove admin ${target.name}?`);
  if (!confirmed) return;

  const next = users.filter((item) => item.id !== userId);
  const result = await saveAdminUsers(next);
  if (!result || result.ok === false) {
    setAdminMessage(result?.message || "Failed to remove admin.", true);
    return;
  }

  const syncResult = await syncStateFromLocalAndVerify();
  if (!syncResult.ok) {
    setAdminMessage(syncResult.message || "Backend confirmation failed.", true);
    return;
  }

  setAdminMessage(`${target.name} removed successfully.`, false);
  renderAdminList();
}

function renderAdminList() {
  if (!adminList) {
    return;
  }
  const users = getAdminUsers();
  const filteredUsers = users.filter((user) => {
    if (!adminSearchTerm) {
      return true;
    }
    return [user.name, user.phone].join(" ").toLowerCase().includes(adminSearchTerm);
  });

  adminList.innerHTML = filteredUsers.length
    ? `<div class="management-name-list">
        ${filteredUsers.map((user) => `
          <button type="button" class="management-name-card open-admin-details-btn" data-user-id="${user.id}">
            <span class="management-name-card__title">${escapeHtml(user.name)}</span>
            <span class="management-name-card__meta">${escapeHtml(user.phone)}</span>
          </button>
        `).join("")}
      </div>`
    : `<p class="management-empty-state">No admins match the current search.</p>`;

  document.querySelectorAll(".open-admin-details-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const user = users.find((item) => item.id === button.getAttribute("data-user-id"));
      if (user) {
        openUserDetailsModal({ userType: "admin", user });
      }
    });
  });
}

if (adminForm) {
  adminForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!isSuperAdminSession) {
      setAdminMessage("Only the superadmin can create new admins.", true);
      return;
    }

    const name = document.getElementById("adminName").value.trim();
    const phone = document.getElementById("adminPhone").value.trim();
    const password = document.getElementById("adminPassword").value.trim();
    const permissions = getSelectedPermissionMap("adminPermission", ADMIN_DEFAULT_PERMISSIONS);
    if (!name || !phone || !password) {
      setAdminMessage("Name, phone number, and password are required.", true);
      return;
    }

    const users = getAdminUsers();
    if (users.some((user) => user.phone === phone)) {
      setAdminMessage("An admin with this phone number already exists.", true);
      return;
    }

    users.push({
      id: `a-${Date.now()}`,
      name,
      phone,
      password,
      permissions
    });

    const result = await saveAdminUsers(users);
    if (!result || result.ok === false) {
      setAdminMessage(result?.message || "Failed to save admin user.", true);
      return;
    }

    const syncResult = await syncStateFromLocalAndVerify();
    if (!syncResult.ok) {
      setAdminMessage(syncResult.message || "Backend confirmation failed.", true);
      return;
    }

    adminForm.reset();
    renderPermissionOptions(
      adminPermissionsGrid,
      ADMIN_PERMISSION_OPTIONS,
      "adminPermission",
      ADMIN_DEFAULT_PERMISSIONS
    );
    setAdminMessage("Admin created successfully.", false);
    renderAdminList();
  });
}

const marketingForm = document.getElementById("marketingForm");
const marketingFormMessage = document.getElementById("marketingFormMessage");
const marketingList = document.getElementById("marketingList");

function setMarketingMessage(text, isError = true) {
  marketingFormMessage.textContent = text;
  marketingFormMessage.style.color = isError ? "var(--danger)" : "var(--success)";
}

function getMarketingUsers() {
  return getStoredMarketingUsers().map((item) => ({
    ...item,
    email: String(item.email || "").toLowerCase()
  }));
}

function saveMarketingUsers(users) {
  return persistMarketingUsers(users);
}

async function removeMarketingUser(userId) {
  const users = getMarketingUsers();
  const target = users.find((item) => item.id === userId);
  if (!target) return;

  const confirmed = window.confirm(`Remove marketing user ${target.name}?`);
  if (!confirmed) return;

  const next = users.filter((item) => item.id !== userId);
  const result = await saveMarketingUsers(next);
  if (!result || result.ok === false) {
    setMarketingMessage(result?.message || "Failed to remove marketing user.", true);
    return;
  }

  const syncResult = await syncStateFromLocalAndVerify();
  if (!syncResult.ok) {
    setMarketingMessage(syncResult.message || "Backend confirmation failed.", true);
    return;
  }

  setMarketingMessage(`${target.name} removed successfully.`, false);
  renderMarketingList();
}

function renderMarketingList() {
  const users = getMarketingUsers();
  const filteredUsers = users.filter((user) => {
    if (!marketingSearchTerm) {
      return true;
    }

    const haystack = [user.name, user.email].join(" ").toLowerCase();
    return haystack.includes(marketingSearchTerm);
  });

  if (!users.length) {
    marketingList.innerHTML = "<p style=\"opacity:0.5;font-size:0.85rem;\">No marketing users yet.</p>";
    return;
  }

  marketingList.innerHTML = `
    ${filteredUsers.length
      ? `<div class="management-name-list">
          ${filteredUsers.map((u) => `
            <button
              type="button"
              class="management-name-card open-marketing-details-btn"
              data-user-id="${u.id}"
            >
              <span class="management-name-card__title">${escapeHtml(u.name)}</span>
              <span class="management-name-card__meta">${escapeHtml(u.email)}</span>
            </button>
          `).join("")}
        </div>`
      : `<p class="management-empty-state">No marketing users match the current search.</p>`
    }
  `;

  document.querySelectorAll(".open-marketing-details-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-user-id");
      const user = users.find((item) => item.id === id);
      if (!user) {
        return;
      }
      openUserDetailsModal({ userType: "marketing", user });
    });
  });
}

marketingForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const name = document.getElementById("marketingName").value.trim();
  const email = document.getElementById("marketingEmail").value.trim().toLowerCase();
  const password = document.getElementById("marketingPassword").value.trim();

  if (!name || !email || !password) {
    setMarketingMessage("All fields are required.", true);
    return;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setMarketingMessage("Enter a valid email address.", true);
    return;
  }

  const users = getMarketingUsers();
  if (users.some((u) => u.email === email)) {
    setMarketingMessage("A marketing user with this email already exists.", true);
    return;
  }

  users.push({ id: `m-${Date.now()}`, name, email, password });

  const result = await saveMarketingUsers(users);
  if (!result || result.ok === false) {
    setMarketingMessage(result?.message || "Failed to save marketing user.", true);
    return;
  }

  const syncResult = await syncStateFromLocalAndVerify();
  if (!syncResult.ok) {
    setMarketingMessage(syncResult.message || "Backend confirmation failed.", true);
    return;
  }

  marketingForm.reset();
  setMarketingMessage("Marketing user created successfully.", false);
  renderMarketingList();
});

if (passwordChangeForm) {
  passwordChangeForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const userType = passwordChangeUserType.value;
    const userId = passwordChangeUserId.value;
    const newPassword = passwordChangeNewPassword.value.trim();

    if (!userType || !userId || !newPassword) {
      setPasswordChangeMessage("Enter a new password to continue.", true);
      return;
    }

    if (userType === "counselor") {
      const counselors = getCounselors();
      const target = counselors.find((item) => item.id === userId);
      if (!target) {
        setPasswordChangeMessage("Counselor not found.", true);
        return;
      }

      const nextCounselors = counselors.map((item) => (
        item.id === userId
          ? { ...item, password: newPassword }
          : item
      ));
      const result = await saveCounselors(nextCounselors);
      if (!result || result.ok === false) {
        setPasswordChangeMessage(result?.message || "Failed to change counselor password.", true);
        return;
      }
    } else if (userType === "admin") {
      const users = getAdminUsers();
      const target = users.find((item) => item.id === userId);
      if (!target) {
        setPasswordChangeMessage("Admin not found.", true);
        return;
      }

      const nextUsers = users.map((item) => (
        item.id === userId
          ? { ...item, password: newPassword }
          : item
      ));
      const result = await saveAdminUsers(nextUsers);
      if (!result || result.ok === false) {
        setPasswordChangeMessage(result?.message || "Failed to change admin password.", true);
        return;
      }
    } else if (userType === "marketing") {
      const users = getMarketingUsers();
      const target = users.find((item) => item.id === userId);
      if (!target) {
        setPasswordChangeMessage("Marketing user not found.", true);
        return;
      }

      const nextUsers = users.map((item) => (
        item.id === userId
          ? { ...item, password: newPassword }
          : item
      ));
      const result = await saveMarketingUsers(nextUsers);
      if (!result || result.ok === false) {
        setPasswordChangeMessage(result?.message || "Failed to change marketing user password.", true);
        return;
      }
    } else {
      setPasswordChangeMessage("Unsupported account type.", true);
      return;
    }

    const syncResult = await syncStateFromLocalAndVerify();
    if (!syncResult.ok) {
      setPasswordChangeMessage(syncResult.message || "Backend confirmation failed after changing the password.", true);
      return;
    }

    closePasswordChangeModal();
    if (userType === "marketing") {
      setMarketingMessage("Password changed successfully.", false);
      renderMarketingList();
    } else if (userType === "admin") {
      setAdminMessage("Password changed successfully.", false);
      renderAdminList();
    } else {
      setMessage("Password changed successfully.", false);
      renderCounselorList();
    }
  });

  document.getElementById("closePasswordChangeModalBtn").onclick = closePasswordChangeModal;
}

if (userEditForm) {
  userEditForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const userType = userEditType.value;
    const id = userEditId.value;
    const name = userEditName.value.trim();
    const email = userEditEmail.value.trim().toLowerCase();
    const phone = userEditPhone.value.trim();
    const branch = normalizeBranch(userEditBranch.value, "");

    if (!userType || !id || !name || (userType !== "admin" && !email)) {
      setUserEditMessage("All required fields must be filled.", true);
      return;
    }

    if (userType !== "admin" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setUserEditMessage("Enter a valid email address.", true);
      return;
    }

    if (userType === "counselor") {
      if (!phone) {
        setUserEditMessage("Phone number is required for counselors.", true);
        return;
      }
      if (!branch) {
        setUserEditMessage("Branch location is required for counselors.", true);
        return;
      }

      const permissions = getSelectedEditPermissions();
      if (!Object.values(permissions).some(Boolean)) {
        setUserEditMessage("Select at least one access permission.", true);
        return;
      }

      const counselors = getCounselors();
      if (counselors.some((item) => item.id !== id && item.email === email)) {
        setUserEditMessage("Another counselor already uses this email.", true);
        return;
      }

      const nextCounselors = counselors.map((item) => (
        item.id === id
          ? { ...item, name, email, phone, branch, permissions }
          : item
      ));

      const result = await saveCounselors(nextCounselors);
      if (!result || result.ok === false) {
        setUserEditMessage(result?.message || "Failed to save counselor changes.", true);
        return;
      }
    } else if (userType === "admin") {
      if (!phone) {
        setUserEditMessage("Phone number is required for admins.", true);
        return;
      }

      const permissions = getSelectedEditPermissions();
      if (!Object.values(permissions).some(Boolean)) {
        setUserEditMessage("Select at least one access permission.", true);
        return;
      }

      const users = getAdminUsers();
      if (users.some((item) => item.id !== id && item.phone === phone)) {
        setUserEditMessage("Another admin already uses this phone number.", true);
        return;
      }

      const nextUsers = users.map((item) => (
        item.id === id
          ? { ...item, name, phone, permissions }
          : item
      ));

      const result = await saveAdminUsers(nextUsers);
      if (!result || result.ok === false) {
        setUserEditMessage(result?.message || "Failed to save admin changes.", true);
        return;
      }
    } else if (userType === "marketing") {
      const users = getMarketingUsers();
      if (users.some((item) => item.id !== id && item.email === email)) {
        setUserEditMessage("Another marketing user already uses this email.", true);
        return;
      }

      const nextUsers = users.map((item) => (
        item.id === id
          ? { ...item, name, email }
          : item
      ));

      const result = await saveMarketingUsers(nextUsers);
      if (!result || result.ok === false) {
        setUserEditMessage(result?.message || "Failed to save marketing user changes.", true);
        return;
      }
    } else {
      setUserEditMessage("Unsupported account type.", true);
      return;
    }

    const syncResult = await syncStateFromLocalAndVerify();
    if (!syncResult.ok) {
      setUserEditMessage(syncResult.message || "Backend confirmation failed after saving changes.", true);
      return;
    }

    closeUserEditModal();
    if (userType === "marketing") {
      setMarketingMessage("Marketing user updated successfully.", false);
      renderMarketingList();
    } else if (userType === "admin") {
      setAdminMessage("Admin updated successfully.", false);
      renderAdminList();
    } else {
      setMessage("Counselor updated successfully.", false);
      renderCounselorList();
    }
  });

  document.getElementById("closeUserEditModalBtn").onclick = closeUserEditModal;
}

const closeUserDetailsModalBtn = document.getElementById("closeUserDetailsModalBtn");
if (closeUserDetailsModalBtn) {
  closeUserDetailsModalBtn.onclick = closeUserDetailsModal;
}

renderMarketingList();
renderManagementSummary();
window.__dvMarkRouteViewReady?.();

if (counselorSearchInput) {
  counselorSearchInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    counselorSearchTerm = String(event.target.value || "").trim().toLowerCase();
    renderCounselorList();
  });
}

if (marketingSearchInput) {
  marketingSearchInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    marketingSearchTerm = String(event.target.value || "").trim().toLowerCase();
    renderMarketingList();
  });
}
