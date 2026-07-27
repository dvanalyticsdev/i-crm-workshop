import { registerPageCleanup } from "./page-runtime.js";
import { acceptServerState, bootstrapLocalState, getSession } from "./state-sync.js";
import { apiUrl } from "./api-client.js";
import { PUBLIC_COURSES } from "./course-catalog.js";

await bootstrapLocalState({ skipStateRefresh: true });

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
const admissionRrCounselorCount = document.getElementById("admissionRrCounselorCount");
const rrCounselorList = document.getElementById("rrCounselorList");
const rrRosterMessage = document.getElementById("rrRosterMessage");
const admissionRrCounselorList = document.getElementById("admissionRrCounselorList");
const admissionRrRosterMessage = document.getElementById("admissionRrRosterMessage");
const resetRrBtn = document.getElementById("resetRrBtn");
const rrMessage = document.getElementById("rrMessage");
let leadFlowCounselors = [];
const COURSE_PERMISSION_OPTIONS = PUBLIC_COURSES.map((course) => ({
  id: course.id,
  label: course.code || course.shortName || course.name,
  name: course.name
}));

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

function isCounselorInAdmissionRotation(counselor) {
  return counselor?.admissionRoundRobinEnabled === true && !counselor?.disabled;
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
  if (!selected.size) return "No courses";
  if (selected.size === COURSE_PERMISSION_OPTIONS.length) return "All courses";
  return COURSE_PERMISSION_OPTIONS
    .filter((course) => selected.has(course.id))
    .map((course) => course.label)
    .join(", ");
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
  const counselors = leadFlowCounselors.filter(isCounselorInWorkshopRotation);
  const admissionCounselors = leadFlowCounselors.filter(isCounselorInAdmissionRotation);
  if (rrCounselorCount) rrCounselorCount.textContent = String(counselors.length);
  if (admissionRrCounselorCount) admissionRrCounselorCount.textContent = String(admissionCounselors.length);

  if (!counselors.length) {
    if (rrNextCounselor) rrNextCounselor.textContent = "No counselors";
    return;
  }

  const idx = (rrIdx % counselors.length + counselors.length) % counselors.length;
  if (rrNextCounselor) rrNextCounselor.textContent = counselors[idx]?.name || "-";
}

function renderWorkshopRotationCounselors() {
  const counselors = leadFlowCounselors;
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

function renderAdmissionRotationCounselors() {
  if (!admissionRrCounselorList) return;

  const counselors = leadFlowCounselors;
  if (!counselors.length) {
    admissionRrCounselorList.innerHTML = '<p class="rr-roster-empty">No counselors found yet. Add counselors in Counselor Management.</p>';
    return;
  }

  admissionRrCounselorList.innerHTML = counselors.map((counselor) => {
    const checked = isCounselorInAdmissionRotation(counselor);
    const courses = normalizeCoursePermissions(counselor.admissionCoursePermissions);
    return `
      <div class="rr-roster-row rr-roster-row--expanded">
        <div class="rr-roster-person">
          <strong>${escapeHtml(counselor.name || "Unnamed Counselor")}</strong>
          <span>${escapeHtml(counselor.email || "No email")}</span>
          <span>${escapeHtml(counselor.branch || "Bangalore")} branch - ${escapeHtml(coursePermissionText(courses))}</span>
          <div class="course-permission-grid">
            ${COURSE_PERMISSION_OPTIONS.map((course) => `
              <label class="course-permission-option" title="${escapeHtml(course.name)}">
                <input
                  type="checkbox"
                  class="admission-course-toggle"
                  data-counselor-id="${escapeHtml(counselor.id || counselor.email || "")}"
                  data-course-id="${escapeHtml(course.id)}"
                  ${courses.includes(course.id) ? "checked" : ""}
                  ${isAdminLike ? "" : "disabled"}
                />
                <span>${escapeHtml(course.label)}</span>
              </label>
            `).join("")}
          </div>
        </div>
        <div class="rr-roster-control">
          <span class="rr-roster-status">${checked ? "In rotation" : "Paused"}</span>
          <label class="switch" aria-label="Toggle ${escapeHtml(counselor.name || "counselor")} in admission round-robin">
            <input type="checkbox" class="rr-counselor-toggle" data-rotation-field="admissionRoundRobinEnabled" data-counselor-id="${escapeHtml(counselor.id || counselor.email || "")}" ${checked ? "checked" : ""} ${isAdminLike ? "" : "disabled"} />
            <span class="switch-slider"></span>
          </label>
        </div>
      </div>
    `;
  }).join("");

  admissionRrCounselorList.querySelectorAll(".rr-counselor-toggle").forEach((toggle) => {
    toggle.addEventListener("change", () => {
      void updateCounselorLeadFlowSetting(
        toggle.getAttribute("data-counselor-id"),
        toggle.checked,
        toggle.getAttribute("data-rotation-field")
      );
    });
  });

  admissionRrCounselorList.querySelectorAll(".admission-course-toggle").forEach((toggle) => {
    toggle.addEventListener("change", () => {
      const counselorId = toggle.getAttribute("data-counselor-id");
      const courseIds = Array.from(admissionRrCounselorList.querySelectorAll(".admission-course-toggle"))
        .filter((item) => item.getAttribute("data-counselor-id") === counselorId && item.checked)
        .map((item) => item.getAttribute("data-course-id"))
        .filter(Boolean);
      void updateCounselorLeadFlowSetting(counselorId, courseIds, "admissionCoursePermissions");
    });
  });
}

function renderRosters() {
  renderWorkshopRotationCounselors();
  renderAdmissionRotationCounselors();
  updateRotationSnapshot(Number(rrIndexDisplay.textContent) || 0);
}

async function updateCounselorLeadFlowSetting(counselorId, enabled, field = "roundRobinEnabled") {
  if (!isAdminLike) return;
  const safeField = String(field || "roundRobinEnabled").trim() || "roundRobinEnabled";
  const isCoursePermissionUpdate = safeField === "admissionCoursePermissions";
  const targetMessage = safeField === "admissionRoundRobinEnabled" || isCoursePermissionUpdate
    ? admissionRrRosterMessage
    : rrRosterMessage;

  showMessage(targetMessage, isCoursePermissionUpdate ? "Saving course permissions..." : "Saving counselor rotation...");

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
        field: safeField,
        [safeField]: isCoursePermissionUpdate ? enabled : !!enabled,
        enabled: isCoursePermissionUpdate ? undefined : !!enabled
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.message || `HTTP ${response.status}`);
    }

    acceptServerState(payload?.state || {});
    await loadCounselors().catch(() => undefined);
    renderRosters();
    showMessage(targetMessage, isCoursePermissionUpdate ? "Course permissions updated." : "Counselor rotation updated.");
  } catch (error) {
    await loadCounselors().catch(() => undefined);
    renderRosters();
    showMessage(targetMessage, error?.message || "Failed to update lead flow settings.", true);
  }
}

async function loadCounselors() {
  const response = await fetch(apiUrl("/api/counselors"), {
    credentials: "same-origin",
    headers: { Accept: "application/json" }
  });
  const payload = await response.json().catch(() => []);
  if (!response.ok) {
    throw new Error(payload?.message || "Failed to load counselors.");
  }
  leadFlowCounselors = Array.isArray(payload) ? payload : [];
  return leadFlowCounselors;
}

function startLeadFlowPolling(onRefresh, intervalMs = 15000) {
  let destroyed = false;
  let activePoll = false;
  async function poll() {
    if (destroyed || activePoll || document.visibilityState === "hidden") {
      return;
    }
    activePoll = true;
    try {
      await loadCounselors();
      await onRefresh();
    } catch (error) {
      console.warn("[lead-flow-control] polling failed:", error?.message || error);
    } finally {
      activePoll = false;
    }
  }
  const timer = window.setInterval(() => {
    void poll();
  }, intervalMs);
  const handleVisibilityChange = () => {
    if (document.visibilityState === "visible") {
      void poll();
    }
  };
  document.addEventListener("visibilitychange", handleVisibilityChange);
  return () => {
    destroyed = true;
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
  };
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
await loadCounselors().catch((error) => showMessage(rrRosterMessage, error.message, true));
const config = await loadMetaConfig();
rrIndexDisplay.textContent = String(Number(config?.roundRobinIndex) || 0);
renderRosters();
window.__dvMarkRouteViewReady?.();

resetRrBtn.addEventListener("click", resetMetaRoundRobin);

const stopPolling = startLeadFlowPolling(() => {
  renderRosters();
}, 15000);

registerPageCleanup(() => {
  stopPolling?.();
});
