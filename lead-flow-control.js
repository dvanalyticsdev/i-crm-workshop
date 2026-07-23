import { registerPageCleanup } from "./page-runtime.js";
import { acceptServerState, bootstrapLocalState, getSession, getCounselors, refreshState, startStatePolling } from "./state-sync.js";
import { apiUrl } from "./api-client.js";

await bootstrapLocalState();

const session = getSession();
if (!session || !["super_admin", "admin", "marketing"].includes(session.role)) {
  window.location.href = "index.html";
  throw new Error("Access required.");
}
const isAdminLike = session.role === "admin" || session.role === "super_admin";

const integrationSectionNav = document.getElementById("integrationSectionNav");
const rrIndexDisplay = document.getElementById("rrIndexDisplay");
const rrNextCounselor = document.getElementById("rrNextCounselor");
const rrCounselorCount = document.getElementById("rrCounselorCount");
const rrCounselorList = document.getElementById("rrCounselorList");
const rrRosterMessage = document.getElementById("rrRosterMessage");
const resetRrBtn = document.getElementById("resetRrBtn");
const rrMessage = document.getElementById("rrMessage");

function showMessage(el, text, isError = false) {
  if (!el) return;
  el.textContent = text;
  el.style.color = isError ? "var(--danger, #ef4444)" : "var(--success, #22c55e)";
  if (text) {
    setTimeout(() => {
      if (el.textContent === text) {
        el.textContent = "";
      }
    }, 5000);
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderIntegrationSectionNav(activeRoute = "lead-flow-control.html") {
  if (!integrationSectionNav) return;

  const sections = [
    {
      route: "meta-integration.html",
      label: "Meta",
      description: "Manage Facebook and Instagram lead capture, webhook setup, and lead filters."
    },
    {
      route: "elementor-integration.html",
      label: "Elementor",
      description: "Manage Elementor webhook intake, form rules, and lead classification."
    },
    {
      route: "lead-flow-control.html",
      label: "Lead Flow Control",
      description: "Manage workshop counselor rotation for Meta and Elementor leads."
    },
    {
      route: "mcube-integration.html",
      label: "MCUBE",
      description: "Manage cloud telephony calling, webhook intake, click-to-call, and CRM call sync."
    }
  ];

  integrationSectionNav.innerHTML = `
    <div class="card-head">
      <h3>Integration Subsections</h3>
      <p>Use this section to switch between lead sources, calling integrations, and lead flow rules.</p>
    </div>
    <div class="filter-actions" style="display:flex;gap:0.75rem;flex-wrap:wrap;">
      ${sections.map((section) => `
        <button
          type="button"
          class="${activeRoute === section.route ? "btn-primary" : "btn-ghost"}"
          data-integration-section="${section.route}"
        >
          ${escapeHtml(section.label)}
        </button>
      `).join("")}
    </div>
    <p class="block-help">${escapeHtml(sections.find((section) => section.route === activeRoute)?.description || "")}</p>
  `;

  integrationSectionNav.querySelectorAll("[data-integration-section]").forEach((button) => {
    button.onclick = () => {
      const route = button.getAttribute("data-integration-section");
      if (route && route !== window.location.pathname.split("/").pop()) {
        if (typeof window.__dvNavigateToRoute === "function") {
          void window.__dvNavigateToRoute(route);
          return;
        }
        window.location.href = route;
      }
    };
  });
}

function isCounselorInWorkshopRotation(counselor) {
  return counselor?.roundRobinEnabled !== false && !counselor?.disabled;
}

async function loadMetaConfig() {
  try {
    const response = await fetch(apiUrl("/api/meta/config"), { credentials: "same-origin" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    showMessage(rrMessage, `Failed to load lead flow state: ${error.message}`, true);
    return null;
  }
}

function updateRotationSnapshot(rrIdx = 0) {
  const counselors = getCounselors().filter(isCounselorInWorkshopRotation);
  rrCounselorCount.textContent = String(counselors.length);

  if (!counselors.length) {
    rrNextCounselor.textContent = "No counselors";
    return;
  }

  const idx = (rrIdx % counselors.length + counselors.length) % counselors.length;
  rrNextCounselor.textContent = counselors[idx]?.name || "-";
}

function renderWorkshopRotationCounselors() {
  const counselors = getCounselors();
  if (!counselors.length) {
    rrCounselorList.innerHTML = '<p class="rr-roster-empty">No counselors found yet. Add counselors in Counselor Management.</p>';
    return;
  }

  rrCounselorList.innerHTML = counselors.map((counselor) => {
    const checked = isCounselorInWorkshopRotation(counselor);
    return `
      <div class="rr-roster-row">
        <div class="rr-roster-person">
          <strong>${escapeHtml(counselor.name || "Unnamed Counselor")}</strong>
          <span>${escapeHtml(counselor.email || "No email")}</span>
          <span>${escapeHtml(counselor.branch || "Bangalore")} branch</span>
        </div>
        <div class="rr-roster-control">
          <span class="rr-roster-status">${checked ? "In rotation" : "Paused"}</span>
          <label class="switch" aria-label="Toggle ${escapeHtml(counselor.name || "counselor")} in workshop round-robin">
            <input type="checkbox" class="rr-counselor-toggle" data-counselor-id="${escapeHtml(counselor.id || counselor.email || "")}" ${checked ? "checked" : ""} ${isAdminLike ? "" : "disabled"} />
            <span class="switch-slider"></span>
          </label>
        </div>
      </div>
    `;
  }).join("");

  rrCounselorList.querySelectorAll(".rr-counselor-toggle").forEach((toggle) => {
    toggle.addEventListener("change", () => {
      void updateCounselorLeadFlowSetting(toggle.getAttribute("data-counselor-id"), toggle.checked);
    });
  });
}

function renderRosters() {
  renderWorkshopRotationCounselors();
  updateRotationSnapshot(Number(rrIndexDisplay.textContent) || 0);
}

async function updateCounselorLeadFlowSetting(counselorId, enabled) {
  if (!isAdminLike) return;

  showMessage(rrRosterMessage, "Saving counselor rotation...");

  try {
    const response = await fetch(apiUrl("/api/counselors/rotation"), {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      credentials: "same-origin",
      body: JSON.stringify({
        counselorId: String(counselorId || "").trim(),
        field: "roundRobinEnabled",
        roundRobinEnabled: !!enabled,
        enabled: !!enabled
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.message || `HTTP ${response.status}`);
    }

    acceptServerState(payload?.state || {});
    renderRosters();
    showMessage(rrRosterMessage, "Counselor rotation updated.");
  } catch (error) {
    await refreshState().catch(() => undefined);
    renderRosters();
    showMessage(rrRosterMessage, error?.message || "Failed to update lead flow settings.", true);
  }
}

async function resetMetaRoundRobin() {
  if (!window.confirm("Reset the Meta lead count to 0? The next Meta workshop lead will go to the first counselor.")) return;
  resetRrBtn.disabled = true;
  showMessage(rrMessage, "Resetting...");
  try {
    const response = await fetch(apiUrl("/api/meta/rr-state/reset"), {
      method: "POST",
      credentials: "same-origin"
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.message || `HTTP ${response.status}`);
    rrIndexDisplay.textContent = "0";
    updateRotationSnapshot(0);
    showMessage(rrMessage, "Meta lead count reset to 0.");
  } catch (error) {
    showMessage(rrMessage, `Reset failed: ${error.message}`, true);
  } finally {
    resetRrBtn.disabled = false;
  }
}

renderIntegrationSectionNav();
const config = await loadMetaConfig();
rrIndexDisplay.textContent = String(Number(config?.roundRobinIndex) || 0);
renderRosters();
window.__dvMarkRouteViewReady?.();

resetRrBtn.addEventListener("click", resetMetaRoundRobin);

const stopPolling = startStatePolling(() => {
  renderRosters();
}, 15000);

registerPageCleanup(() => {
  stopPolling?.();
});
