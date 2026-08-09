import { registerPageCleanup } from "./page-runtime.js";
import { apiUrl } from "./api-client.js";
import {
  bootstrapLocalState,
  getAdminUsers as getStoredAdminUsers,
  getAllocation as getStoredAllocation,
  getCounselors as getStoredCounselors,
  getStateSnapshot,
  getSession,
  replaceStateSnapshot,
  saveAdminUsers as persistAdminUsers,
  saveAllocation as persistAllocation,
  saveCounselors as persistCounselors,
  syncStateFromLocalAndVerify
} from "./state-sync.js";
import { PUBLIC_COURSES } from "./course-catalog.js";

await bootstrapLocalState({ skipStateRefresh: true });

async function loadAccountDirectory() {
  const response = await fetch(apiUrl("/api/account-directory"), {
    credentials: "same-origin",
    headers: { Accept: "application/json" }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.message || "Failed to load account directory.");
  }
  replaceStateSnapshot({
    ...getStateSnapshot(),
    counselors: Array.isArray(payload?.counselors) ? payload.counselors : [],
    adminUsers: Array.isArray(payload?.adminUsers) ? payload.adminUsers : [],
    marketingUsers: Array.isArray(payload?.marketingUsers) ? payload.marketingUsers : [],
    allocation: Array.isArray(payload?.allocation) ? payload.allocation : [],
    updatedAt: payload?.updatedAt || null,
    clearedAt: payload?.clearedAt || null
  });
}

await loadAccountDirectory().catch(async (error) => {
  console.warn("[counselor-management] Account directory loading failed, falling back to full state:", error?.message || error);
  await bootstrapLocalState().catch(() => undefined);
});

const COUNSELOR_FALLBACK_PERMISSIONS = {
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
  counselorManagement: false,
  leadControl: true,
  metaIntegration: true,
  elementorIntegration: true,
  mcubeIntegration: true,
  leadFlowControl: true,
  reachout: true
};

const ADMIN_FALLBACK_PERMISSIONS = {
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
  { key: "taskTracker", label: "Task Tracker" }
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

const ROLE_PANEL_CONFIG = {
  counselor: {
    label: "Counselor",
    options: COUNSELOR_PERMISSION_OPTIONS,
    fallback: COUNSELOR_FALLBACK_PERMISSIONS
  },
  admin: {
    label: "Admin",
    options: ADMIN_PERMISSION_OPTIONS,
    fallback: ADMIN_FALLBACK_PERMISSIONS
  }
};

const EVERYONE_PERMISSION_TARGET = "__everyone__";

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
const adminForm = document.getElementById("adminForm");
const adminFormMessage = document.getElementById("adminFormMessage");
const adminList = document.getElementById("adminList");
const adminSearchInput = document.getElementById("adminSearchInput");
const managementSummarySection = document.getElementById("managementSummarySection");
const adminManagementSection = document.getElementById("adminManagementSection");
const adminCreateCard = document.getElementById("adminCreateCard");
const permissionControlSection = document.getElementById("permissionControlSection");
const permissionRoleSelect = document.getElementById("permissionRoleSelect");
const permissionUserSelect = document.getElementById("permissionUserSelect");
const permissionPanelHint = document.getElementById("permissionPanelHint");
const accessControlGrid = document.getElementById("accessControlGrid");
const permissionPanelMessage = document.getElementById("permissionPanelMessage");
const loadFallbackPermissionsBtn = document.getElementById("loadFallbackPermissionsBtn");
const clearSavedPermissionsBtn = document.getElementById("clearSavedPermissionsBtn");
const savePermissionPanelBtn = document.getElementById("savePermissionPanelBtn");
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
const userEditMessage = document.getElementById("userEditMessage");

let counselorSearchTerm = "";
let adminSearchTerm = "";
let activeDetailsUser = null;
let selectedPermissionRole = permissionRoleSelect?.value || "counselor";
let selectedPermissionUserId = "";
let permissionDraftLoadedFromFallback = false;

const activeSession = getSession();
const isSuperAdminSession = activeSession?.role === "super_admin";

if (adminManagementSection) {
  adminManagementSection.classList.toggle("hidden", !isSuperAdminSession);
}

if (adminCreateCard) {
  adminCreateCard.classList.toggle("hidden", !isSuperAdminSession);
}

if (permissionControlSection) {
  permissionControlSection.classList.toggle("hidden", !isSuperAdminSession);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function setCounselorMessage(text, isError = true) {
  if (!counselorFormMessage) {
    return;
  }
  counselorFormMessage.textContent = text;
  counselorFormMessage.style.color = isError ? "var(--danger)" : "var(--success)";
}

function setAdminMessage(text, isError = true) {
  if (!adminFormMessage) {
    return;
  }
  adminFormMessage.textContent = text;
  adminFormMessage.style.color = isError ? "var(--danger)" : "var(--success)";
}

function setPermissionPanelMessage(text, isError = true) {
  if (!permissionPanelMessage) {
    return;
  }
  permissionPanelMessage.textContent = text;
  permissionPanelMessage.style.color = isError ? "var(--danger)" : "var(--success)";
}

function setPasswordChangeMessage(text, isError = true) {
  if (!passwordChangeMessage) {
    return;
  }
  passwordChangeMessage.textContent = text;
  passwordChangeMessage.style.color = isError ? "var(--danger)" : "var(--success)";
}

function setUserEditMessage(text, isError = true) {
  if (!userEditMessage) {
    return;
  }
  userEditMessage.textContent = text;
  userEditMessage.style.color = isError ? "var(--danger)" : "var(--success)";
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

function clonePermissions(permissions) {
  if (!permissions || typeof permissions !== "object") {
    return null;
  }
  return Object.fromEntries(
    Object.entries(permissions).map(([key, value]) => [key, Boolean(value)])
  );
}

function getCounselors() {
  return getStoredCounselors().map((item) => ({
    ...item,
    email: String(item.email || "").toLowerCase(),
    role: String(item.role || "counselor").trim().toLowerCase() === "manager" ? "manager" : "counselor",
    branch: normalizeBranch(item.branch),
    admissionCoursePermissions: normalizeCoursePermissions(item.admissionCoursePermissions),
    permissions: clonePermissions(item.permissions)
  }));
}

function getAdminUsers() {
  return getStoredAdminUsers().map((item) => ({
    ...item,
    phone: String(item.phone || "").trim(),
    permissions: clonePermissions(item.permissions)
  }));
}

function getAllocation() {
  return getStoredAllocation();
}

function saveCounselors(counselors) {
  return persistCounselors(counselors);
}

function saveAdminUsers(adminUsers) {
  return persistAdminUsers(adminUsers);
}

function saveAllocation(allocation) {
  return persistAllocation(allocation);
}

function getRoleConfig(role) {
  return ROLE_PANEL_CONFIG[role] || ROLE_PANEL_CONFIG.counselor;
}

function getRoleAccounts(role) {
  return role === "admin" ? getAdminUsers() : getCounselors();
}

function getUserByRoleAndId(role, userId) {
  return getRoleAccounts(role).find((item) => item.id === userId) || null;
}

function isEveryonePermissionTarget(userId) {
  return String(userId || "") === EVERYONE_PERMISSION_TARGET;
}

function getRawPermissions(user) {
  return user?.permissions && typeof user.permissions === "object"
    ? clonePermissions(user.permissions)
    : null;
}

function getEffectivePermissions(role, user) {
  const fallback = getRoleConfig(role).fallback;
  const rawPermissions = getRawPermissions(user);
  return {
    ...fallback,
    ...(rawPermissions || {})
  };
}

function hasSavedPermissionOverride(user) {
  const rawPermissions = getRawPermissions(user);
  return Boolean(rawPermissions && Object.keys(rawPermissions).length);
}

function permissionText(role, user) {
  const effectivePermissions = getEffectivePermissions(role, user);
  const options = getRoleConfig(role).options;
  const names = options
    .filter((option) => effectivePermissions[option.key])
    .map((option) => option.label);
  return names.length ? names.join(", ") : "No access";
}

function renderPermissionBadges(role, user) {
  const effectivePermissions = getEffectivePermissions(role, user);
  const options = getRoleConfig(role).options;
  const items = options
    .filter((option) => effectivePermissions[option.key])
    .map((option) => option.label);

  return items.length
    ? `<div class="permission-badge-row">${items.map((item) => `<span class="permission-badge">${escapeHtml(item)}</span>`).join("")}</div>`
    : `<span class="management-muted">No access</span>`;
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

function setPermissionPanelActionsDisabled(disabled) {
  [loadFallbackPermissionsBtn, clearSavedPermissionsBtn, savePermissionPanelBtn].forEach((button) => {
    if (button) {
      button.disabled = Boolean(disabled);
    }
  });
}

function renderPermissionPanelEmptyEditor(message) {
  if (!accessControlGrid) {
    return;
  }

  accessControlGrid.innerHTML = `
    <div class="permission-panel-empty-state">
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

function getSelectedPermissionMap(inputName, fallback) {
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

function buildDetailsRows(details) {
  return details.map(([label, value]) => `
    <div class="management-details-item">
      <dt>${escapeHtml(label)}</dt>
      <dd>${escapeHtml(value || "-")}</dd>
    </div>
  `).join("");
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

  const normalized = items.map((item) => ({
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
  userEditModal.classList.add("hidden");
}

function openUserEditModal({ userType, user }) {
  if (!userEditModal || !user) {
    return;
  }

  if (userType === "admin" && !isSuperAdminSession) {
    setAdminMessage("You do not have permission to edit admin accounts.", true);
    return;
  }

  userEditType.value = userType;
  userEditId.value = user.id || "";
  userEditName.value = user.name || "";
  userEditEmail.value = user.email || "";
  setUserEditMessage("");

  const isCounselor = userType === "counselor";
  const isAdmin = userType === "admin";
  userEditTitle.textContent = isCounselor ? "Edit Counselor" : "Edit Admin";
  userEditEmailRow.classList.toggle("hidden", isAdmin);
  userEditEmail.required = !isAdmin;
  userEditPhoneRow.classList.toggle("hidden", !(isCounselor || isAdmin));
  userEditBranchRow.classList.toggle("hidden", !isCounselor);

  if (isCounselor) {
    userEditPhone.value = user.phone || "";
    userEditBranch.value = normalizeBranch(user.branch);
  } else if (isAdmin) {
    userEditPhone.value = user.phone || "";
    userEditBranch.value = "";
  }

  userEditModal.classList.remove("hidden");
}

function openPasswordChangeModal({ userType, userId, name }) {
  if (!passwordChangeModal) {
    return;
  }

  if (userType === "admin" && !isSuperAdminSession) {
    setAdminMessage("You do not have permission to change admin passwords.", true);
    return;
  }

  passwordChangeUserType.value = userType;
  passwordChangeUserId.value = userId;
  passwordChangeUserName.value = name || "";
  passwordChangeTitle.textContent = userType === "admin"
    ? "Change Admin Password"
    : "Change Counselor Password";
  passwordChangeNewPassword.value = "";
  setPasswordChangeMessage("");
  passwordChangeModal.classList.remove("hidden");
}

async function removeCounselor(counselorId) {
  const counselors = getCounselors();
  const target = counselors.find((item) => item.id === counselorId);
  if (!target) {
    setCounselorMessage("Counselor not found.", true);
    return;
  }

  const confirmed = window.confirm(`Remove counselor ${target.name}?`);
  if (!confirmed) {
    return;
  }

  const nextCounselors = counselors.filter((item) => item.id !== counselorId);
  const saveCounselorResult = await saveCounselors(nextCounselors);
  if (!saveCounselorResult || saveCounselorResult.ok === false) {
    setCounselorMessage(saveCounselorResult?.message || "Failed to save counselor changes. Please check your connection.", true);
    return;
  }
  await syncAllocationWithCounselors(nextCounselors);

  const allocation = getAllocation();
  const filteredAllocation = allocation.filter(
    (item) => String(item.name || "").toLowerCase() !== target.name.toLowerCase()
  );
  if (filteredAllocation.length !== allocation.length) {
    const saveAllocResult = await saveAllocation(rebalanceAllocation(filteredAllocation));
    if (!saveAllocResult || saveAllocResult.ok === false) {
      setCounselorMessage(saveAllocResult?.message || "Counselor removed but failed to update allocation. Please reload and retry.", true);
      return;
    }
  }

  const syncResult = await syncStateFromLocalAndVerify();
  if (!syncResult.ok) {
    setCounselorMessage(syncResult.message || `Backend confirmation failed after removing counselor ${target.name}.`, true);
    return;
  }

  setCounselorMessage(`Counselor ${target.name} removed successfully.`, false);
  renderCounselorList();
  renderPermissionControlPanel();
}

async function toggleManagerRole(counselorId) {
  const counselors = getCounselors();
  const target = counselors.find((item) => item.id === counselorId);
  if (!target) {
    setCounselorMessage("Counselor not found.", true);
    return;
  }

  const promote = target.role !== "manager";
  const confirmed = window.confirm(`${promote ? "Promote" : "Move"} ${target.name} ${promote ? "to Manager" : "back to Counselor"}?`);
  if (!confirmed) {
    return;
  }

  const nextCounselors = counselors.map((item) => (
    item.id === counselorId
      ? { ...item, role: promote ? "manager" : "counselor" }
      : item
  ));
  const result = await saveCounselors(nextCounselors);
  if (!result || result.ok === false) {
    setCounselorMessage(result?.message || "Failed to update counselor role.", true);
    return;
  }

  const syncResult = await syncStateFromLocalAndVerify();
  if (!syncResult.ok) {
    setCounselorMessage(syncResult.message || "Backend confirmation failed after updating role.", true);
    return;
  }

  setCounselorMessage(`${target.name} is now a ${promote ? "Manager" : "Counselor"}.`, false);
  renderCounselorList();
  renderPermissionControlPanel();
}

async function removeAdminUser(userId) {
  if (!isSuperAdminSession) {
    setAdminMessage("You do not have permission to remove admin accounts.", true);
    return;
  }

  const users = getAdminUsers();
  const target = users.find((item) => item.id === userId);
  if (!target) {
    return;
  }

  const confirmed = window.confirm(`Remove admin ${target.name}?`);
  if (!confirmed) {
    return;
  }

  const nextUsers = users.filter((item) => item.id !== userId);
  const result = await saveAdminUsers(nextUsers);
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
  renderPermissionControlPanel();
}

function openUserDetailsModal({ userType, user }) {
  if (!userDetailsModal || !user) {
    return;
  }

  if (userType === "admin" && !isSuperAdminSession) {
    setAdminMessage("You do not have permission to view admin account details.", true);
    return;
  }

  activeDetailsUser = { userType, userId: user.id };
  const isCounselor = userType === "counselor";
  const accountRole = isCounselor && user.role === "manager" ? "Manager" : isCounselor ? "Counselor" : "Admin";
  const roleLabel = accountRole;
  const sourceLabel = hasSavedPermissionOverride(user) ? "Saved override" : "Current fallback";

  userDetailsTitle.textContent = user.name || "User";
  userDetailsSubtitle.textContent = isCounselor
    ? "Counselor account details, fallback behavior, and quick actions."
    : "Admin account details, fallback behavior, and quick actions.";

  const detailsMarkup = isCounselor
    ? [
        {
          title: "Profile",
          rows: [
            ["Name", user.name],
            ["Role", accountRole],
            ["Email", user.email],
            ["Phone Number", user.phone],
            ["Branch Location", normalizeBranch(user.branch)]
          ]
        },
        {
          title: "Page Access",
          rows: [
            ["Source", sourceLabel],
            ["Allowed Pages", permissionText("counselor", user)],
            ["Course Eligibility", coursePermissionText(user.admissionCoursePermissions)]
          ]
        }
      ]
    : [
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
            ["Source", sourceLabel],
            ["Allowed Pages", permissionText("admin", user)]
          ]
        }
      ];

  userDetailsBody.innerHTML = detailsMarkup.map((section) => `
    <section class="management-details-card">
      <h4>${escapeHtml(section.title)}</h4>
      <dl class="management-details-list">
        ${buildDetailsRows(section.rows)}
      </dl>
      ${section.title === "Page Access" ? renderPermissionBadges(isCounselor ? "counselor" : "admin", user) : ""}
    </section>
  `).join("");

  userDetailsActions.innerHTML = `
    <button type="button" class="btn-primary" id="userDetailsEditBtn">Edit ${escapeHtml(roleLabel)}</button>
    ${isCounselor ? `<button type="button" class="btn-ghost" id="userDetailsRoleBtn">${user.role === "manager" ? "Move to Counselor" : "Promote to Manager"}</button>` : ""}
    <button type="button" class="btn-ghost" id="userDetailsPasswordBtn">Change Password</button>
    <button type="button" class="btn-ghost" id="userDetailsRemoveBtn">Remove</button>
  `;

  document.getElementById("userDetailsEditBtn")?.addEventListener("click", () => {
    closeUserDetailsModal();
    openUserEditModal({ userType, user });
  });
  document.getElementById("userDetailsPasswordBtn")?.addEventListener("click", () => {
    closeUserDetailsModal();
    openPasswordChangeModal({
      userType,
      userId: user.id,
      name: user.name
    });
  });
  document.getElementById("userDetailsRoleBtn")?.addEventListener("click", () => {
    closeUserDetailsModal();
    void toggleManagerRole(user.id);
  });
  document.getElementById("userDetailsRemoveBtn")?.addEventListener("click", () => {
    closeUserDetailsModal();
    if (isCounselor) {
      void removeCounselor(user.id);
    } else {
      void removeAdminUser(user.id);
    }
  });

  userDetailsModal.classList.remove("hidden");
}

function renderManagementSummary() {
  if (!managementSummarySection) {
    return;
  }

  const counselors = getCounselors();
  const admins = getAdminUsers();
  const managerCount = counselors.filter((item) => item.role === "manager").length;
  const branchCounts = BRANCH_OPTIONS.map((branch) => ({
    branch,
    count: counselors.filter((item) => normalizeBranch(item.branch) === branch).length
  }));

  managementSummarySection.innerHTML = `
    ${isSuperAdminSession ? `
      <article class="card management-summary-card">
        <p>Total Admins</p>
        <h2>${admins.length}</h2>
      </article>
    ` : ""}
    <article class="card management-summary-card">
      <p>Total Counselors</p>
      <h2>${counselors.length}</h2>
    </article>
    <article class="card management-summary-card">
      <p>Managers</p>
      <h2>${managerCount}</h2>
    </article>
    ${branchCounts.map((item) => `
      <article class="card management-summary-card">
        <p>${escapeHtml(item.branch)} Counselors</p>
        <h2>${item.count}</h2>
      </article>
    `).join("")}
  `;
}

function renderCounselorList() {
  if (!counselorList) {
    return;
  }

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
      counselor.role === "manager" ? "manager" : "counselor",
      coursePermissionText(counselor.admissionCoursePermissions),
      permissionText("counselor", counselor)
    ].join(" ").toLowerCase();
    return haystack.includes(counselorSearchTerm);
  });

  counselorList.innerHTML = filteredCounselors.length
    ? `<div class="management-name-list">
        ${filteredCounselors.map((counselor) => `
          <button
            type="button"
            class="management-name-card open-counselor-details-btn"
            data-counselor-id="${escapeHtml(counselor.id)}"
          >
            <span class="management-name-card__title">${escapeHtml(counselor.name)}</span>
            <span class="management-name-card__meta">${counselor.role === "manager" ? "Manager" : "Counselor"}</span>
            <span class="management-name-card__meta">${escapeHtml(counselor.email)}</span>
            <span class="management-name-card__meta">${escapeHtml(normalizeBranch(counselor.branch))} branch</span>
          </button>
        `).join("")}
      </div>`
    : `<p class="management-empty-state">No counselors match the current search.</p>`;

  document.querySelectorAll(".open-counselor-details-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const counselor = counselors.find((item) => item.id === button.getAttribute("data-counselor-id"));
      if (counselor) {
        openUserDetailsModal({ userType: "counselor", user: counselor });
      }
    });
  });
}

function renderAdminList() {
  if (!adminList) {
    return;
  }

  if (!isSuperAdminSession) {
    adminList.innerHTML = "";
    return;
  }

  const users = getAdminUsers();
  const filteredUsers = users.filter((user) => {
    if (!adminSearchTerm) {
      return true;
    }
    return [user.name, user.phone, permissionText("admin", user)].join(" ").toLowerCase().includes(adminSearchTerm);
  });

  adminList.innerHTML = filteredUsers.length
    ? `<div class="management-name-list">
        ${filteredUsers.map((user) => `
          <button type="button" class="management-name-card open-admin-details-btn" data-user-id="${escapeHtml(user.id)}">
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

function getPermissionPanelDraft() {
  const fallback = getRoleConfig(selectedPermissionRole).fallback;
  return getSelectedPermissionMap("accessControlPermission", fallback);
}

function getEnabledPermissionLabels(role, permissions) {
  return getRoleConfig(role).options
    .filter((option) => permissions?.[option.key])
    .map((option) => option.label);
}

function getSharedSavedPermissions(role, accounts) {
  const config = getRoleConfig(role);
  if (!accounts.length) {
    return null;
  }

  const accountsWithOverrides = accounts.filter((item) => hasSavedPermissionOverride(item));
  if (!accountsWithOverrides.length) {
    return null;
  }

  const firstPermissions = getRawPermissions(accountsWithOverrides[0]) || {};
  const firstSignature = JSON.stringify(firstPermissions);
  const allMatch = accountsWithOverrides.every((item) => {
    const permissions = getRawPermissions(item) || {};
    return JSON.stringify(permissions) === firstSignature;
  });

  if (!allMatch) {
    return {
      mixed: true,
      permissions: null,
      savedOverrideCount: accountsWithOverrides.length,
      totalCount: accounts.length
    };
  }

  return {
    mixed: false,
    permissions: Object.keys(firstPermissions).length ? firstPermissions : null,
    savedOverrideCount: accountsWithOverrides.length,
    totalCount: accounts.length
  };
}

function renderPermissionControlPanel(forceFallbackDraft = false) {
  if (!isSuperAdminSession || !permissionRoleSelect || !permissionUserSelect || !accessControlGrid) {
    return;
  }

  const config = getRoleConfig(selectedPermissionRole);
  const accounts = getRoleAccounts(selectedPermissionRole);
  if (!accounts.length) {
    selectedPermissionUserId = "";
    permissionUserSelect.innerHTML = `<option value="">No ${config.label.toLowerCase()} yet</option>`;
    permissionPanelHint.textContent = `Create a ${config.label.toLowerCase()} first, then assign saved access here if needed.`;
    renderPermissionPanelEmptyEditor(`No ${config.label.toLowerCase()} accounts available for access updates yet.`);
    setPermissionPanelActionsDisabled(true);
    return;
  }

  setPermissionPanelActionsDisabled(false);

  if (!accounts.some((item) => item.id === selectedPermissionUserId) && !isEveryonePermissionTarget(selectedPermissionUserId)) {
    selectedPermissionUserId = EVERYONE_PERMISSION_TARGET;
    permissionDraftLoadedFromFallback = false;
  }

  permissionUserSelect.innerHTML = [
    `<option value="${EVERYONE_PERMISSION_TARGET}" ${isEveryonePermissionTarget(selectedPermissionUserId) ? "selected" : ""}>Everyone</option>`,
    ...accounts.map((item) => `
    <option value="${escapeHtml(item.id)}" ${item.id === selectedPermissionUserId ? "selected" : ""}>
      ${escapeHtml(item.name || item.email || item.phone || item.id)}
    </option>
  `)
  ].join("");

  if (isEveryonePermissionTarget(selectedPermissionUserId)) {
    const sharedSaved = getSharedSavedPermissions(selectedPermissionRole, accounts);
    const draftPermissions = forceFallbackDraft
      ? { ...config.fallback }
      : sharedSaved?.permissions || {};
    renderPermissionOptions(accessControlGrid, config.options, "accessControlPermission", draftPermissions);

    if (forceFallbackDraft) {
      permissionPanelHint.textContent = `The ${config.label.toLowerCase()} fallback has been loaded into the editor for everyone, but it will only become an explicit saved access list after you click Save Access.`;
      permissionDraftLoadedFromFallback = true;
    } else if (sharedSaved?.mixed) {
      permissionPanelHint.textContent = `These ${config.label.toLowerCase()} accounts currently have mixed saved overrides. The editor stays blank until you save a new shared access list for everyone.`;
      permissionDraftLoadedFromFallback = false;
    } else if (sharedSaved?.permissions) {
      permissionPanelHint.textContent = `Everyone in this ${config.label.toLowerCase()} role is currently using the same saved access override.`;
      permissionDraftLoadedFromFallback = false;
    } else {
      permissionPanelHint.textContent = `Choose Everyone when you want to apply the same explicit page access to all ${config.label.toLowerCase()} accounts at once, or pick one account for a user-specific override.`;
      permissionDraftLoadedFromFallback = false;
    }
    return;
  }

  const selectedUser = getUserByRoleAndId(selectedPermissionRole, selectedPermissionUserId);
  const savedPermissions = getRawPermissions(selectedUser);
  const draftPermissions = forceFallbackDraft
    ? getEffectivePermissions(selectedPermissionRole, selectedUser)
    : savedPermissions || {};

  renderPermissionOptions(accessControlGrid, config.options, "accessControlPermission", draftPermissions);

  if (forceFallbackDraft) {
    permissionPanelHint.textContent = `${config.label} currently uses fallback access. The fallback has been loaded into the editor, but it will not replace current behavior until you click Save Access.`;
    permissionDraftLoadedFromFallback = true;
  } else if (savedPermissions) {
    permissionPanelHint.textContent = `${config.label} currently uses a saved access override. Edit the list below and save when you want to update it.`;
    permissionDraftLoadedFromFallback = false;
  } else {
    permissionPanelHint.textContent = `${config.label} currently has no saved access override. The app is still using existing fallback access until Super Admin saves an explicit list here.`;
    permissionDraftLoadedFromFallback = false;
  }
}

async function savePermissionOverride() {
  if (!isSuperAdminSession) {
    setPermissionPanelMessage("Only Super Admin can save page access overrides.", true);
    return;
  }

  const config = getRoleConfig(selectedPermissionRole);
  const permissions = getPermissionPanelDraft();
  if (!Object.values(permissions).some(Boolean)) {
    setPermissionPanelMessage("Select at least one page before saving an override.", true);
    return;
  }

  const accounts = getRoleAccounts(selectedPermissionRole);
  const applyToEveryone = isEveryonePermissionTarget(selectedPermissionUserId);
  const selectedUser = applyToEveryone
    ? null
    : getUserByRoleAndId(selectedPermissionRole, selectedPermissionUserId);
  if (!applyToEveryone && !selectedUser) {
    setPermissionPanelMessage(`Select a ${config.label.toLowerCase()} account first.`, true);
    return;
  }

  const nextAccounts = accounts.map((item) => {
    if (applyToEveryone || item.id === selectedUser.id) {
      return { ...item, permissions };
    }
    return item;
  });

  const result = selectedPermissionRole === "admin"
    ? await saveAdminUsers(nextAccounts)
    : await saveCounselors(nextAccounts);

  if (!result || result.ok === false) {
    setPermissionPanelMessage(result?.message || "Failed to save access override.", true);
    return;
  }

  const syncResult = await syncStateFromLocalAndVerify();
  if (!syncResult.ok) {
    setPermissionPanelMessage(syncResult.message || "Backend confirmation failed after saving access.", true);
    return;
  }

  permissionDraftLoadedFromFallback = false;
  setPermissionPanelMessage(
    applyToEveryone
      ? `Saved explicit ${config.label.toLowerCase()} access for everyone in this role.`
      : `Saved explicit ${config.label.toLowerCase()} access for ${selectedUser.name}.`,
    false
  );
  renderManagementSummary();
  renderCounselorList();
  renderAdminList();
  renderPermissionControlPanel();
}

async function clearPermissionOverride() {
  if (!isSuperAdminSession) {
    setPermissionPanelMessage("Only Super Admin can restore fallback access.", true);
    return;
  }

  const config = getRoleConfig(selectedPermissionRole);
  const accounts = getRoleAccounts(selectedPermissionRole);
  const applyToEveryone = isEveryonePermissionTarget(selectedPermissionUserId);
  const selectedUser = applyToEveryone
    ? null
    : getUserByRoleAndId(selectedPermissionRole, selectedPermissionUserId);
  if (!applyToEveryone && !selectedUser) {
    setPermissionPanelMessage(`Select a ${config.label.toLowerCase()} account first.`, true);
    return;
  }

  const nextAccounts = accounts.map((item) => {
    if (!applyToEveryone && item.id !== selectedUser.id) {
      return item;
    }
    const nextItem = { ...item };
    delete nextItem.permissions;
    return nextItem;
  });

  const result = selectedPermissionRole === "admin"
    ? await saveAdminUsers(nextAccounts)
    : await saveCounselors(nextAccounts);

  if (!result || result.ok === false) {
    setPermissionPanelMessage(result?.message || "Failed to restore fallback access.", true);
    return;
  }

  const syncResult = await syncStateFromLocalAndVerify();
  if (!syncResult.ok) {
    setPermissionPanelMessage(syncResult.message || "Backend confirmation failed after restoring fallback access.", true);
    return;
  }

  setPermissionPanelMessage(
    applyToEveryone
      ? `Everyone in the ${config.label.toLowerCase()} role is now using fallback access again.`
      : `${selectedUser.name} is now using fallback access again.`,
    false
  );
  permissionDraftLoadedFromFallback = false;
  renderManagementSummary();
  renderCounselorList();
  renderAdminList();
  renderPermissionControlPanel();
}

if (counselorForm) {
  counselorForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const name = document.getElementById("counselorName").value.trim();
    const email = document.getElementById("counselorEmail").value.trim().toLowerCase();
    const phone = document.getElementById("counselorPhone").value.trim();
    const branch = normalizeBranch(document.getElementById("counselorBranch").value, "");
    const password = document.getElementById("counselorPassword").value.trim();

    if (!name || !email || !phone || !branch || !password) {
      setCounselorMessage("All counselor fields are required.", true);
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setCounselorMessage("Enter a valid counselor email address.", true);
      return;
    }

    const counselors = getCounselors();
    if (counselors.some((item) => item.email === email)) {
      setCounselorMessage("A counselor with this email already exists.", true);
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
      admissionCoursePermissions: COURSE_PERMISSION_OPTIONS.map((course) => course.id)
    });

    const result = await saveCounselors(counselors);
    if (!result || result.ok === false) {
      setCounselorMessage(result?.message || "Failed to save counselor.", true);
      return;
    }

    await syncAllocationWithCounselors(counselors);

    const syncResult = await syncStateFromLocalAndVerify();
    if (!syncResult.ok) {
      setCounselorMessage(syncResult.message || "Backend confirmation failed after saving the counselor.", true);
      return;
    }

    counselorForm.reset();
    setCounselorMessage("Counselor created successfully. Fallback access will apply until Super Admin saves an override.", false);
    renderManagementSummary();
    renderCounselorList();
    renderPermissionControlPanel();
  });
}

if (adminForm) {
  adminForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!isSuperAdminSession) {
      setAdminMessage("You do not have permission to create admin accounts.", true);
      return;
    }

    const name = document.getElementById("adminName").value.trim();
    const phone = document.getElementById("adminPhone").value.trim();
    const password = document.getElementById("adminPassword").value.trim();

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
      password
    });

    const result = await saveAdminUsers(users);
    if (!result || result.ok === false) {
      setAdminMessage(result?.message || "Failed to save admin user.", true);
      return;
    }

    const syncResult = await syncStateFromLocalAndVerify();
    if (!syncResult.ok) {
      setAdminMessage(syncResult.message || "Backend confirmation failed after saving the admin.", true);
      return;
    }

    adminForm.reset();
    setAdminMessage("Admin created successfully. Fallback access will apply until Super Admin saves an override.", false);
    renderManagementSummary();
    renderAdminList();
    renderPermissionControlPanel();
  });
}

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
        item.id === userId ? { ...item, password: newPassword } : item
      ));
      const result = await saveCounselors(nextCounselors);
      if (!result || result.ok === false) {
        setPasswordChangeMessage(result?.message || "Failed to change counselor password.", true);
        return;
      }
    } else if (userType === "admin") {
      if (!isSuperAdminSession) {
        setPasswordChangeMessage("You do not have permission to change admin passwords.", true);
        return;
      }

      const users = getAdminUsers();
      const target = users.find((item) => item.id === userId);
      if (!target) {
        setPasswordChangeMessage("Admin not found.", true);
        return;
      }

      const nextUsers = users.map((item) => (
        item.id === userId ? { ...item, password: newPassword } : item
      ));
      const result = await saveAdminUsers(nextUsers);
      if (!result || result.ok === false) {
        setPasswordChangeMessage(result?.message || "Failed to change admin password.", true);
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
    if (userType === "admin") {
      setAdminMessage("Password changed successfully.", false);
      renderAdminList();
    } else {
      setCounselorMessage("Password changed successfully.", false);
      renderCounselorList();
    }
  });
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

      const counselors = getCounselors();
      if (counselors.some((item) => item.id !== id && item.email === email)) {
        setUserEditMessage("Another counselor already uses this email.", true);
        return;
      }

      const nextCounselors = counselors.map((item) => (
        item.id === id
          ? { ...item, name, email, phone, branch }
          : item
      ));

      const result = await saveCounselors(nextCounselors);
      if (!result || result.ok === false) {
        setUserEditMessage(result?.message || "Failed to save counselor changes.", true);
        return;
      }
    } else if (userType === "admin") {
      if (!isSuperAdminSession) {
        setUserEditMessage("You do not have permission to edit admin accounts.", true);
        return;
      }
      if (!phone) {
        setUserEditMessage("Phone number is required for admins.", true);
        return;
      }

      const users = getAdminUsers();
      if (users.some((item) => item.id !== id && item.phone === phone)) {
        setUserEditMessage("Another admin already uses this phone number.", true);
        return;
      }

      const nextUsers = users.map((item) => (
        item.id === id
          ? { ...item, name, phone }
          : item
      ));

      const result = await saveAdminUsers(nextUsers);
      if (!result || result.ok === false) {
        setUserEditMessage(result?.message || "Failed to save admin changes.", true);
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
    if (userType === "admin") {
      setAdminMessage("Admin updated successfully.", false);
      renderAdminList();
    } else {
      setCounselorMessage("Counselor updated successfully.", false);
      renderCounselorList();
    }
    renderManagementSummary();
    renderPermissionControlPanel();
  });
}

if (permissionRoleSelect) {
  permissionRoleSelect.addEventListener("change", (event) => {
    selectedPermissionRole = String(event.target.value || "counselor");
    selectedPermissionUserId = "";
    permissionDraftLoadedFromFallback = false;
    setPermissionPanelMessage("");
    renderPermissionControlPanel();
  });
}

if (permissionUserSelect) {
  permissionUserSelect.addEventListener("change", (event) => {
    selectedPermissionUserId = String(event.target.value || "");
    permissionDraftLoadedFromFallback = false;
    setPermissionPanelMessage("");
    renderPermissionControlPanel();
  });
}

loadFallbackPermissionsBtn?.addEventListener("click", () => {
  setPermissionPanelMessage("");
  renderPermissionControlPanel(true);
});

clearSavedPermissionsBtn?.addEventListener("click", () => {
  void clearPermissionOverride();
});

savePermissionPanelBtn?.addEventListener("click", () => {
  void savePermissionOverride();
});

document.getElementById("closePasswordChangeModalBtn")?.addEventListener("click", closePasswordChangeModal);
document.getElementById("closeUserEditModalBtn")?.addEventListener("click", closeUserEditModal);
document.getElementById("closeUserDetailsModalBtn")?.addEventListener("click", closeUserDetailsModal);

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

if (adminSearchInput) {
  adminSearchInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    adminSearchTerm = String(event.target.value || "").trim().toLowerCase();
    renderAdminList();
  });
}

function renderAccountDirectory() {
  renderManagementSummary();
  renderCounselorList();
  renderAdminList();
  renderPermissionControlPanel();
}

renderAccountDirectory();

const directoryPollTimer = window.setInterval(() => {
  if (document.visibilityState === "hidden") {
    return;
  }
  void loadAccountDirectory()
    .then(renderAccountDirectory)
    .catch((error) => console.warn("[counselor-management] directory polling failed:", error?.message || error));
}, 15000);

const stopStatePolling = () => window.clearInterval(directoryPollTimer);

registerPageCleanup(stopStatePolling);
window.__dvMarkRouteViewReady?.();
