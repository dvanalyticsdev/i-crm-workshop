import { initThemeSystem } from "./theme.js";
import { bootstrapLocalState, getSession, login, refreshSession } from "./state-sync.js";

const SYSTEM_UI_VERSION = "v2.0";
const storedVersion = localStorage.getItem("dv_crm_ui_version");
if (storedVersion !== SYSTEM_UI_VERSION) {
  localStorage.setItem("dv_crm_ui_version", SYSTEM_UI_VERSION);
  localStorage.setItem("show_welcome_intro", "true");
}

await bootstrapLocalState();
initThemeSystem();

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
} else {
  if (localStorage.getItem("show_welcome_intro") === "true") {
    localStorage.removeItem("show_welcome_intro");
    showWelcomePopup();
  }
}

const roleButtons = document.querySelectorAll(".role-btn");
const selectedRoleInput = document.getElementById("selectedRole");
const loginForm = document.getElementById("loginForm");
const loginMessage = document.getElementById("loginMessage");

roleButtons.forEach((button) => {
  button.addEventListener("click", () => {
    roleButtons.forEach((btn) => btn.classList.remove("active"));
    button.classList.add("active");
    selectedRoleInput.value = button.dataset.role;
    loginMessage.textContent = "";
  });
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const role = selectedRoleInput.value;
  const identifier = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value.trim();

  const result = await login({ role, identifier, password });
  if (!result.ok) {
    loginMessage.textContent = result.message || "Invalid credentials for selected role.";
    return;
  }

  const session = result.session || getSession();
  if (!session?.role) {
    loginMessage.textContent = "Login succeeded but the session could not be restored.";
    return;
  }

  window.location.href = result.landing || "index.html";
});

function playWelcomeSound() {
  const play = () => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === "suspended") {
        const resumeOnInteraction = () => {
          ctx.resume().then(() => {
            triggerChime(ctx);
            document.removeEventListener("click", resumeOnInteraction);
            document.removeEventListener("keydown", resumeOnInteraction);
          }).catch(() => undefined);
        };
        document.addEventListener("click", resumeOnInteraction);
        document.addEventListener("keydown", resumeOnInteraction);
        return;
      }
      triggerChime(ctx);
    } catch (e) {
      console.warn("Audio Context failed:", e);
    }
  };
  play();
}

function triggerChime(ctx) {
  const now = ctx.currentTime;
  const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
  notes.forEach((freq, index) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, now + index * 0.12);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.005, now + index * 0.12 + 0.3);
    
    gain.gain.setValueAtTime(0, now + index * 0.12);
    gain.gain.linearRampToValueAtTime(0.12, now + index * 0.12 + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, now + index * 0.12 + 0.6);
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.start(now + index * 0.12);
    osc.stop(now + index * 0.12 + 0.6);
  });
}

function showWelcomePopup() {
  playWelcomeSound();
  
  const overlay = document.createElement("div");
  overlay.className = "welcome-overlay";
  overlay.innerHTML = `
    <div class="welcome-card">
      <div class="welcome-badge">
        <svg viewBox="0 0 24 24" width="36" height="36" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
          <polyline points="2 17 12 22 22 17"></polyline>
          <polyline points="2 12 12 17 22 12"></polyline>
        </svg>
      </div>
      <h2 class="welcome-title">Welcome to the New UI</h2>
      <p class="welcome-text">
        We have upgraded the i-CRM Lead Platform to a clean, minimal, fast, and smooth interface. Enjoy flat panels, thin borders, dual Light & Dark theme support, and optimized speed. We hope you enjoy it!
      </p>
      <button class="btn-primary welcome-btn" id="dismissWelcomeBtn">Explore New UI</button>
    </div>
  `;
  document.body.appendChild(overlay);
  
  setTimeout(() => {
    document.getElementById("dismissWelcomeBtn")?.focus();
  }, 100);
  
  document.getElementById("dismissWelcomeBtn").addEventListener("click", () => {
    overlay.classList.add("fade-out");
    overlay.addEventListener("transitionend", () => {
      overlay.remove();
    }, { once: true });
  });
}

