import { initThemeSystem } from "./theme.js";
import { bootstrapLocalState, getSession, login, refreshSession } from "./state-sync.js";

function revealAuthShell() {
  if (window.__dvLoadingOverlayTimer) {
    window.clearInterval(window.__dvLoadingOverlayTimer);
    delete window.__dvLoadingOverlayTimer;
  }
  document.documentElement.classList.remove("app-shell-pending");
  document.querySelector(".app-shell-loading")?.remove();
}

const SYSTEM_UI_VERSION = "v2.0";
const storedVersion = localStorage.getItem("dv_crm_ui_version");
if (storedVersion !== SYSTEM_UI_VERSION) {
  localStorage.setItem("dv_crm_ui_version", SYSTEM_UI_VERSION);
}

initThemeSystem();
revealAuthShell();

void bootstrapLocalState().catch(() => undefined);

const existingSession = await refreshSession().catch(() => null);
if (existingSession?.role) {
  window.location.href = existingSession.role === "admin"
    ? "dashboard.html"
    : existingSession.role === "marketing"
      ? "meta-integration.html"
      : existingSession.permissions?.preWorkshop
        ? "pre-workshop.html"
        : existingSession.permissions?.postWorkshop
          ? "post-workshop.html"
          : existingSession.permissions?.lostLeads
            ? "lost-leads.html"
            : existingSession.permissions?.monitoring
              ? "monitoring.html"
              : "index.html";
}

const roleButtons = document.querySelectorAll(".role-btn");
const selectedRoleInput = document.getElementById("selectedRole");
const loginForm = document.getElementById("loginForm");
const loginMessage = document.getElementById("loginMessage");
const passcodeRow = document.getElementById("passcodeRow");
const passcodeInput = document.getElementById("passcode");
let awaitingSuperAdminPasscode = false;

function togglePasscodePrompt(visible) {
  awaitingSuperAdminPasscode = visible;
  passcodeRow?.classList.toggle("hidden", !visible);
  if (!visible && passcodeInput) {
    passcodeInput.value = "";
  }
}

roleButtons.forEach((button) => {
  button.addEventListener("click", () => {
    roleButtons.forEach((btn) => btn.classList.remove("active"));
    button.classList.add("active");
    selectedRoleInput.value = button.dataset.role;
    loginMessage.textContent = "";
    togglePasscodePrompt(false);
  });
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const role = selectedRoleInput.value;
  const identifier = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value.trim();
  const passcode = passcodeInput?.value.trim() || "";

  const result = await login({ role, identifier, password, passcode });
  if (!result.ok) {
    if (result.requiresPasscode && role === "admin") {
      togglePasscodePrompt(true);
    }
    loginMessage.textContent = result.message || "Invalid credentials for selected role.";
    return;
  }

  const session = result.session || getSession();
  if (!session?.role) {
    loginMessage.textContent = "Login succeeded but the session could not be restored.";
    return;
  }

  togglePasscodePrompt(false);
  window.location.href = result.landing || "index.html";
});


