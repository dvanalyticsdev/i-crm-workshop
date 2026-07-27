import { runPageCleanup } from "./page-runtime.js";
import { bindThemeControls, initThemeSystem } from "./theme.js";
import { bootstrapLocalState, changeOwnPassword, getSession, getStateField, logout, refreshSession, refreshState, awaitPendingMutations } from "./state-sync.js";
import { startPingMonitor, mountPingPill } from "./ping-monitor.js";
const SYSTEM_UI_VERSION = "v2.0";
if (localStorage.getItem("dv_crm_ui_version") !== SYSTEM_UI_VERSION) {
  localStorage.setItem("dv_crm_ui_version", SYSTEM_UI_VERSION);
  try {
    await logout();
  } catch (e) {
    console.warn("Logout failed during version upgrade reset:", e);
  }
  window.location.href = "index.html";
}

let currentRoute = window.location.pathname.split("/").pop() || "dashboard.html";
let activeSession = null;
let activeNavigationToken = 0;
let pendingRouteReadyState = null;
const ROUTE_LOADING_STALE_TIMEOUT_MS = 20000;
const NOTIFICATION_POLL_INTERVAL_MS = 6000;
const NOTIFICATION_LIST_LIMIT = 30;
const NOTIFICATION_LIST_CACHE_MS = 15000;
const ROUTES_WITH_LOCAL_STATE_BOOTSTRAP = new Set([
  "main-admission-leads.html",
  "performance-logs.html"
]);
let notificationPollTimerId = null;
let notificationPollTimeoutId = null;
let notificationListCache = {
  items: null,
  fetchedAt: 0
};
const loadedAssetUrls = new Set(
  Array.from(document.querySelectorAll("script[src]:not([type='module'])"), (script) => script.src)
);

const PAGE_PERMISSION_MAP = {
  "dashboard.html": "dashboard",
  "lead-browse.html": "leadBrowse",
  "claim-raised.html": "claimRaised",
  "lead-creation.html": "leadCreation",
  "admission-sop.html": "admissionSop",
  "pre-workshop.html": "preWorkshop",
  "post-workshop.html": "postWorkshop",
  "registered-candidates.html": "registeredCandidates",
  "main-admission-leads.html": "mainAdmissionLeads",
  "task-tracker.html": "taskTracker",
  "lost-leads.html": "lostLeads",
  "monitoring.html": "monitoring",
  "performance-logs.html": "performanceLogs",
  "counselor-management.html": "counselorManagement",
  "lead-control.html": "leadControl",
  "meta-integration.html": "metaIntegration",
  "elementor-integration.html": "elementorIntegration",
  "mcube-integration.html": "mcubeIntegration",
  "lead-flow-control.html": "leadFlowControl",
  "reachout.html": "reachout"
};

const DEFAULT_PERMISSIONS = {
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
  performanceLogs: false,
  counselorManagement: false,
  leadControl: true,
  metaIntegration: true,
  elementorIntegration: true,
  mcubeIntegration: true,
  leadFlowControl: true,
  reachout: true
};

const SIDEBAR_GROUP_STORAGE_KEY = "dvSidebarGroupState";
const SIDEBAR_GROUPS = [
  {
    id: "home",
    label: "Home",
    routes: ["dashboard.html", "monitoring.html"]
  },
  {
    id: "leads",
    label: "Leads",
    routes: ["lead-browse.html", "claim-raised.html", "lead-creation.html"]
  },
  {
    id: "workflows",
    label: "Workflows",
    routes: ["pre-workshop.html", "registered-candidates.html", "lost-leads.html", "task-tracker.html"]
  },
  {
    id: "sop-tracker",
    label: "SOP Tracker",
    routes: ["admission-sop.html"]
  },
  {
    id: "control-center",
    label: "Control Center",
    routes: ["counselor-management.html", "lead-control.html", "performance-logs.html"]
  },
  {
    id: "channels",
    label: "Channels",
    routes: ["meta-integration.html", "reachout.html"]
  }
];

function revealAppShell() {
  if (window.__dvLoadingOverlayTimer) {
    window.clearInterval(window.__dvLoadingOverlayTimer);
    delete window.__dvLoadingOverlayTimer;
  }
  document.documentElement.classList.remove("app-shell-pending");
  document.querySelector(".app-shell-loading")?.remove();
}

function clearRouteLoadingTimer(mainContent) {
  if (mainContent?.__dvRouteLoadingTimer) {
    window.clearInterval(mainContent.__dvRouteLoadingTimer);
    delete mainContent.__dvRouteLoadingTimer;
  }
  if (mainContent?.__dvRouteLoadingStaleTimer) {
    window.clearTimeout(mainContent.__dvRouteLoadingStaleTimer);
    delete mainContent.__dvRouteLoadingStaleTimer;
  }
}

function clearRouteLoadingViewportBinding(mainContent) {
  if (typeof mainContent?.__dvRouteLoadingSync === "function") {
    mainContent.__dvRouteLoadingSync();
    delete mainContent.__dvRouteLoadingSync;
  }
}

function bindRouteLoadingViewport(mainContent, overlay, contentWindow) {
  if (!mainContent || !overlay || !contentWindow) {
    return;
  }

  clearRouteLoadingViewportBinding(mainContent);

  const syncOverlayBounds = () => {
    const rect = contentWindow.getBoundingClientRect();
    const visibleTop = Math.max(0, rect.top);
    const visibleBottom = Math.min(window.innerHeight, rect.bottom);
    const visibleHeight = Math.max(0, visibleBottom - visibleTop);

    overlay.style.left = `${Math.max(0, rect.left)}px`;
    overlay.style.top = `${visibleTop}px`;
    overlay.style.width = `${Math.max(0, rect.width)}px`;
    overlay.style.height = `${visibleHeight}px`;
    overlay.style.display = visibleHeight > 0 ? "grid" : "none";
  };

  syncOverlayBounds();
  window.addEventListener("scroll", syncOverlayBounds, { passive: true });
  window.addEventListener("resize", syncOverlayBounds);

  mainContent.__dvRouteLoadingSync = () => {
    window.removeEventListener("scroll", syncOverlayBounds);
    window.removeEventListener("resize", syncOverlayBounds);
  };
}

function showRouteLoadingOverlay(mainContent) {
  if (!mainContent) {
    return;
  }

  const { contentWindow } = ensureMainContentStructure(mainContent);
  if (!contentWindow) {
    return;
  }

  clearRouteLoadingTimer(mainContent);
  let overlay = mainContent.querySelector(":scope > .route-loading-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.className = "route-loading-overlay";
    overlay.setAttribute("aria-live", "polite");
    overlay.innerHTML = `
      <div class="app-shell-loading__content">
        <div class="app-shell-loading__dot" aria-hidden="true"></div>
        <div class="app-shell-loading__text">Loading</div>
        <div class="app-shell-loading__timer">0.0s</div>
      </div>
    `;
    mainContent.appendChild(overlay);
  }

  mainContent.classList.add("route-loading");
  bindRouteLoadingViewport(mainContent, overlay, contentWindow);

  const timerElement = overlay.querySelector(".app-shell-loading__timer");
  const startedAt = Number(mainContent.__dvRouteLoadingStartedAt) || Date.now();
  mainContent.__dvRouteLoadingStartedAt = startedAt;
  if (timerElement) {
    timerElement.textContent = `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
  }

  mainContent.__dvRouteLoadingTimer = window.setInterval(() => {
    if (timerElement) {
      timerElement.textContent = `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
    }
  }, 100);
  mainContent.__dvRouteLoadingStaleTimer = window.setTimeout(() => {
    if (!mainContent.isConnected || pendingRouteReadyState) {
      return;
    }
    hideRouteLoadingOverlay(mainContent);
  }, ROUTE_LOADING_STALE_TIMEOUT_MS);
}

function hideRouteLoadingOverlay(mainContent) {
  if (!mainContent) {
    return;
  }

  clearRouteLoadingTimer(mainContent);
  clearRouteLoadingViewportBinding(mainContent);
  delete mainContent.__dvRouteLoadingStartedAt;
  mainContent.classList.remove("route-loading");
  mainContent.querySelector(":scope > .route-loading-overlay")?.remove();
}

function recordRouteNavigationPerformance(route, startedAt, { success = true, message = "" } = {}) {
  const nowValue = typeof performance !== "undefined" ? performance.now() : Date.now();
  const durationMs = Math.max(0, Math.round(nowValue - startedAt));
  try {
    void fetch("/api/performance-logs/client", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        kind: "page",
        operation: `${route}:route-interactive`,
        page: route,
        section: "Route Navigation",
        subsection: "soft-navigation",
        phase: "interactive-ready",
        role: activeSession?.role || "",
        durationMs,
        success,
        message
      })
    });
  } catch {
    // Performance logging should never block navigation.
  }
}

function recoverStaleRouteLoadingOverlay() {
  const mainContent = document.querySelector(".main-content.route-loading");
  if (!mainContent) {
    return;
  }
  if (pendingRouteReadyState) {
    pendingRouteReadyState.resolve?.();
    return;
  }
  hideRouteLoadingOverlay(mainContent);
}

function waitForNextPaint(frameCount = 1) {
  return new Promise((resolve) => {
    const step = (remaining) => {
      window.requestAnimationFrame(() => {
        if (remaining <= 1) {
          resolve();
          return;
        }
        step(remaining - 1);
      });
    };
    step(Math.max(1, Number(frameCount) || 1));
  });
}

function createRouteReadyState(navigationToken) {
  let resolveReady;
  const promise = new Promise((resolve) => {
    resolveReady = resolve;
  });

  pendingRouteReadyState = {
    navigationToken,
    promise,
    resolve: () => {
      if (pendingRouteReadyState?.navigationToken !== navigationToken) {
        return;
      }
      resolveReady?.();
    }
  };
}

function clearRouteReadyState(navigationToken = null) {
  if (!pendingRouteReadyState) {
    return;
  }
  if (navigationToken !== null && pendingRouteReadyState.navigationToken !== navigationToken) {
    return;
  }
  pendingRouteReadyState = null;
}

async function waitForRouteReady(navigationToken, timeoutMs = 15000) {
  if (!pendingRouteReadyState || pendingRouteReadyState.navigationToken !== navigationToken) {
    return;
  }

  await Promise.race([
    pendingRouteReadyState.promise,
    new Promise((resolve) => {
      window.setTimeout(resolve, timeoutMs);
    })
  ]);
}

function ensureMainContentStructure(mainContent) {
  if (!mainContent) {
    return { topbar: null, contentWindow: null };
  }

  const topbar = mainContent.querySelector(":scope > .topbar");
  let contentWindow = mainContent.querySelector(":scope > .main-content-window");

  if (!contentWindow) {
    contentWindow = document.createElement("div");
    contentWindow.className = "main-content-window";

    const childrenToMove = Array.from(mainContent.children).filter((child) => child !== topbar);
    childrenToMove.forEach((child) => contentWindow.appendChild(child));
    mainContent.appendChild(contentWindow);
  }

  return { topbar, contentWindow };
}

function loadSidebarGroupState() {
  try {
    const raw = window.localStorage.getItem(SIDEBAR_GROUP_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveSidebarGroupState(state) {
  try {
    window.localStorage.setItem(SIDEBAR_GROUP_STORAGE_KEY, JSON.stringify(state || {}));
  } catch {
    // Ignore storage failures and continue with in-memory UI state.
  }
}

function getRouteGroupId(route) {
  const group = SIDEBAR_GROUPS.find((item) => item.routes.includes(route));
  return group?.id || null;
}

function setSidebarGroupExpanded(groupElement, expanded) {
  if (!groupElement) {
    return;
  }

  const toggle = groupElement.querySelector(".sidebar-group-toggle");
  const content = groupElement.querySelector(".sidebar-group-content");
  const nextExpanded = !!expanded;
  groupElement.dataset.expanded = nextExpanded ? "true" : "false";
  toggle?.setAttribute("aria-expanded", String(nextExpanded));
  content?.classList.toggle("hidden", !nextExpanded);
}

function syncSidebarGroupState() {
  const storedState = loadSidebarGroupState();
  const activeGroupId = getRouteGroupId(currentRoute);

  document.querySelectorAll(".sidebar-group").forEach((groupElement) => {
    const groupId = groupElement.dataset.groupId;
    const hasVisibleLinks = Array.from(groupElement.querySelectorAll(".sidebar-link")).some(
      (link) => !link.classList.contains("hidden")
    );

    groupElement.classList.toggle("hidden", !hasVisibleLinks);
    if (!hasVisibleLinks) {
      return;
    }

    const shouldExpand = groupId === activeGroupId
      ? true
      : storedState[groupId] !== false;

    setSidebarGroupExpanded(groupElement, shouldExpand);
  });
}

function bindSidebarGroupToggles() {
  document.querySelectorAll(".sidebar-group-toggle").forEach((toggle) => {
    if (toggle.dataset.bound === "true") {
      return;
    }

    toggle.dataset.bound = "true";
    toggle.addEventListener("click", () => {
      const groupElement = toggle.closest(".sidebar-group");
      if (!groupElement) {
        return;
      }

      const nextExpanded = groupElement.dataset.expanded !== "true";
      setSidebarGroupExpanded(groupElement, nextExpanded);

      const storedState = loadSidebarGroupState();
      storedState[groupElement.dataset.groupId] = nextExpanded;
      saveSidebarGroupState(storedState);
    });
  });
}

function applyActiveSidebarState() {
  const sidebarLinks = document.querySelectorAll(".sidebar-link");
  sidebarLinks.forEach((link) => {
    const activeRoutes = String(link.getAttribute("data-active-routes") || "")
      .split(",")
      .map((route) => route.trim())
      .filter(Boolean);
    const isActive = link.getAttribute("href") === currentRoute || activeRoutes.includes(currentRoute);
    link.classList.toggle("active", isActive);
  });
  syncSidebarGroupState();
}

function rebuildSidebarSections() {
  const sidebar = document.querySelector(".sidebar");
  const navContainer = document.querySelector(".sidebar-nav");
  const bottomLinkContainer = document.querySelector(".sidebar-bottom-links");
  if (!sidebar || !navContainer || !bottomLinkContainer) {
    return;
  }

  const allLinks = [
    ...Array.from(navContainer.querySelectorAll(".sidebar-link")),
    ...Array.from(bottomLinkContainer.querySelectorAll(".sidebar-link"))
  ];

  const linkMap = new Map(
    allLinks
      .map((link) => [link.getAttribute("href") || "", link])
      .filter(([href]) => href)
  );

  const routeLabels = {
    "dashboard.html": "Dashboard",
    "lead-browse.html": "Lead Browse",
    "claim-raised.html": "Claim Raised",
    "lead-creation.html": "Lead Creation",
    "admission-sop.html": "Admission SOP",
    "pre-workshop.html": "Workshop",
    "registered-candidates.html": "Admission",
    "task-tracker.html": "Task Tracker",
    "lost-leads.html": "Lost Leads",
    "monitoring.html": "Monitoring",
    "performance-logs.html": "Performance Logs",
    "counselor-management.html": "Counselor Management",
    "lead-control.html": "Lead & Data Control",
    "meta-integration.html": "Integration",
    "reachout.html": "ReachOut Center"
  };

  const ensureLink = (route, options = {}) => {
    const existing = linkMap.get(route);
    if (existing) {
      existing.textContent = routeLabels[route] || existing.textContent;
      if (options.activeRoutes) {
        existing.setAttribute("data-active-routes", options.activeRoutes.join(","));
      }
      return existing;
    }

    const link = document.createElement("a");
    link.href = route;
    link.className = `sidebar-link${options.bottom ? " sidebar-link-bottom" : ""}${options.adminOnly ? " admin-only" : ""}`;
    if (options.adminOnly) {
      link.setAttribute("data-admin-only", "true");
    }
    if (options.superAdminOnly) {
      link.setAttribute("data-super-admin-only", "true");
    }
    if (options.counselorOnly) {
      link.setAttribute("data-counselor-only", "true");
    }
    if (options.activeRoutes) {
      link.setAttribute("data-active-routes", options.activeRoutes.join(","));
    }
    link.textContent = routeLabels[route] || route;
    linkMap.set(route, link);
    return link;
  };

  navContainer.innerHTML = "";
  bottomLinkContainer.innerHTML = "";

  const routeOptions = {
    "pre-workshop.html": {
      activeRoutes: []
    },
    "registered-candidates.html": {
      activeRoutes: ["post-workshop.html", "main-admission-leads.html", "crash-course.html"]
    },
    "task-tracker.html": {
      counselorOnly: true
    },
    "counselor-management.html": {
      adminOnly: true,
      bottom: true
    },
    "lead-control.html": {
      adminOnly: true,
      bottom: true
    },
    "performance-logs.html": {
      bottom: true,
      superAdminOnly: true
    },
    "meta-integration.html": {
      adminOnly: true,
      bottom: true,
      activeRoutes: ["elementor-integration.html", "mcube-integration.html", "lead-flow-control.html"]
    },
    "reachout.html": {
      adminOnly: true,
      bottom: true
    }
  };

  SIDEBAR_GROUPS.forEach((group) => {
    const section = document.createElement("section");
    section.className = "sidebar-group";
    section.dataset.groupId = group.id;

    const groupToggle = document.createElement("button");
    groupToggle.type = "button";
    groupToggle.className = "sidebar-group-toggle";
    groupToggle.setAttribute("aria-expanded", "false");
    groupToggle.innerHTML = `
      <span class="sidebar-group-label">${group.label}</span>
      <span class="sidebar-group-chevron" aria-hidden="true"></span>
    `;

    const content = document.createElement("div");
    content.className = "sidebar-group-content hidden";

    group.routes.forEach((route) => {
      const options = routeOptions[route] || {};
      const link = ensureLink(route, options);
      if (link) {
        content.appendChild(link);
      }
    });

    section.appendChild(groupToggle);
    section.appendChild(content);
    navContainer.appendChild(section);
  });

  bindSidebarGroupToggles();
  syncSidebarGroupState();
}

function ensureIntegrationSidebarLinks() {
  const bottomLinkContainer = document.querySelector(".sidebar-bottom-links");
  if (!bottomLinkContainer) {
    return;
  }

  const ensureLink = (href, label) => {
    let link = bottomLinkContainer.querySelector(`a[href="${href}"]`);
    if (!link) {
      link = document.createElement("a");
      link.href = href;
      link.className = "sidebar-link sidebar-link-bottom admin-only";
      link.setAttribute("data-admin-only", "true");
      link.textContent = label;
      bottomLinkContainer.appendChild(link);
    }
  };

  ensureLink("meta-integration.html", "Integration");
}

const prefetchedRoutes = new Set();

function prefetchRoute(href) {
  const route = String(href || "").trim();
  if (!route || prefetchedRoutes.has(route) || route.startsWith("http") || route.startsWith("#")) {
    return;
  }

  prefetchedRoutes.add(route);

  const link = document.createElement("link");
  link.rel = "prefetch";
  link.as = "document";
  link.href = route;
  document.head.appendChild(link);
}

function warmSidebarRoutes() {
  const sidebarLinks = document.querySelectorAll(".sidebar-link[href]");

  sidebarLinks.forEach((link) => {
    const href = link.getAttribute("href") || "";
    const warm = () => prefetchRoute(href);
    link.addEventListener("pointerenter", warm, { once: true });
    link.addEventListener("focus", warm, { once: true });
  });

  const eagerWarm = () => {
    sidebarLinks.forEach((link) => {
      const href = link.getAttribute("href") || "";
      if (href && href !== currentRoute) {
        prefetchRoute(href);
      }
    });
  };

  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(eagerWarm, { timeout: 1500 });
  } else {
    window.setTimeout(eagerWarm, 800);
  }
}

function getSessionIdentityLabel(session) {
  if (session?.role === "super_admin") return "Super Admin";
  if (session?.role === "admin") return "Admin";
  if (session?.role === "marketing") return "Marketing";

  const name = String(session?.name || "").trim();
  if (name) {
    return name;
  }

  return "Counselor";
}

function streamlineTopbarProfile() {
  const profileContainers = document.querySelectorAll(".topbar-profile");
  profileContainers.forEach((container) => {
    container.querySelectorAll("[data-theme-toggle], [data-logout], .header-menu-wrap").forEach((element) => {
      element.remove();
    });
  });
}

function hydrateRoleTag(session) {
  const roleTags = document.querySelectorAll("[data-role-tag]");
  const text = getSessionIdentityLabel(session);
  roleTags.forEach((tag) => {
    tag.textContent = text;
    tag.setAttribute("title", text);
  });
}

function getCounselors() {
  return getStateField("counselors");
}

function getSessionPermissions(session) {
  const base = {
    ...DEFAULT_PERMISSIONS,
    ...(session.permissions || {})
  };

  if (session?.role === "super_admin") {
    return {
      ...Object.fromEntries(Object.keys(DEFAULT_PERMISSIONS).map((key) => [key, true]))
    };
  }

  if (session?.role === "admin") {
    return {
      ...base,
      performanceLogs: false
    };
  }

  if (session?.role === "counselor") {
    const counselors = getCounselors();
    const counselor = counselors.find(
      (item) => String(item.email || "").toLowerCase() === String(session.email || "").toLowerCase()
    );

    return {
      ...base,
      ...(counselor?.permissions || {}),
      counselorManagement: false,
      leadControl: Boolean(counselor?.permissions?.leadControl),
      metaIntegration: Boolean(counselor?.permissions?.metaIntegration),
      elementorIntegration: Boolean(counselor?.permissions?.elementorIntegration),
      mcubeIntegration: Boolean(counselor?.permissions?.mcubeIntegration),
      leadFlowControl: Boolean(counselor?.permissions?.leadFlowControl),
      reachout: Boolean(counselor?.permissions?.reachout),
      performanceLogs: false
    };
  }

  if (session?.role === "marketing") {
    return {
      ...base,
      counselorManagement: false,
      leadControl: false,
      performanceLogs: false
    };
  }

  return base;
}

function getFirstAllowedPage(permissions) {
  if (permissions.dashboard) return "dashboard.html";
  if (permissions.metaIntegration) return "meta-integration.html";
  if (permissions.preWorkshop) return "pre-workshop.html";
  if (permissions.registeredCandidates) return "registered-candidates.html";
  if (permissions.postWorkshop) return "post-workshop.html";
  if (permissions.lostLeads) return "lost-leads.html";
  if (permissions.monitoring) return "monitoring.html";
  return "index.html";
}

function applyRoleVisibility(session) {
  ensureIntegrationSidebarLinks();
  rebuildSidebarSections();
  const adminOnlyElements = document.querySelectorAll("[data-admin-only='true']");
  const superAdminOnlyElements = document.querySelectorAll("[data-super-admin-only='true']");
  const counselorOnlyElements = document.querySelectorAll("[data-counselor-only='true']");
  const isAdmin = session.role === "admin" || session.role === "super_admin";
  const isSuperAdmin = session.role === "super_admin";
  const isCounselor = session.role === "counselor";
  adminOnlyElements.forEach((element) => {
    element.classList.toggle("hidden", !isAdmin);
  });
  superAdminOnlyElements.forEach((element) => {
    element.classList.toggle("hidden", !isSuperAdmin);
  });
  counselorOnlyElements.forEach((element) => {
    element.classList.toggle("hidden", !isCounselor);
  });
  syncSidebarGroupState();
}

function enforceAccess(session) {
  const permissions = getSessionPermissions(session);
  const permissionKey = PAGE_PERMISSION_MAP[currentRoute];
  if (!permissionKey) {
    return true;
  }

  if (!permissions[permissionKey]) {
    window.location.href = getFirstAllowedPage(permissions);
    return false;
  }

  const links = document.querySelectorAll(".sidebar-link");
  links.forEach((link) => {
    const href = link.getAttribute("href") || "";
    const key = PAGE_PERMISSION_MAP[href];
    if (key && !permissions[key]) {
      link.classList.add("hidden");
    }
  });

  syncSidebarGroupState();

  return true;
}

function bindLogout() {
  const buttons = document.querySelectorAll("[data-logout]");
  buttons.forEach((button) => {
    if (button.dataset.logoutBound === "true") {
      return;
    }

    button.dataset.logoutBound = "true";
    button.addEventListener("click", async () => {
      await logout().catch(() => undefined);
      window.location.href = "index.html?forceLogin=1";
    });
  });
}

function injectHeaderMenu() {
  const profileContainer = document.querySelector(".topbar-profile");
  if (!profileContainer || profileContainer.querySelector("#header-menu-btn")) return;

  const menuWrap = document.createElement("div");
  menuWrap.className = "header-menu-wrap";
  menuWrap.innerHTML = `
    <button type="button" id="header-menu-btn" class="header-menu-btn" aria-label="Open header menu" aria-haspopup="true" aria-expanded="false">
      <span class="header-menu-btn__line" aria-hidden="true"></span>
      <span class="header-menu-btn__line" aria-hidden="true"></span>
      <span class="header-menu-btn__line" aria-hidden="true"></span>
    </button>
    <div id="header-menu-dropdown" class="header-menu-dropdown hidden">
      <div class="header-menu-section">
        <button type="button" class="theme-toggle theme-toggle--menu" data-theme-toggle aria-pressed="false">
          <span class="theme-toggle__stack" aria-hidden="true">
            <span class="theme-toggle__icon theme-toggle__icon--sun" aria-hidden="true">
              <svg viewBox="0 0 24 24" role="presentation" focusable="false">
                <circle cx="12" cy="12" r="4.5"></circle>
                <path d="M12 1.8v2.4M12 19.8v2.4M4.2 4.2l1.7 1.7M18.1 18.1l1.7 1.7M1.8 12h2.4M19.8 12h2.4M4.2 19.8l1.7-1.7M18.1 5.9l1.7-1.7"></path>
              </svg>
            </span>
            <span class="theme-toggle__icon theme-toggle__icon--moon" aria-hidden="true">
              <svg viewBox="0 0 24 24" role="presentation" focusable="false">
                <path d="M20.2 14.7A8.2 8.2 0 0 1 9.3 3.8a8.5 8.5 0 1 0 10.9 10.9Z"></path>
              </svg>
            </span>
          </span>
          <span class="theme-toggle__label" data-theme-label>Light</span>
        </button>
      </div>
      <div class="header-menu-section">
        <button type="button" class="header-menu-action" data-change-password>Change Password</button>
      </div>
      <div class="header-menu-section">
        <button type="button" class="header-menu-action" data-logout>Log out</button>
      </div>
    </div>
  `;

  profileContainer.appendChild(menuWrap);

  const menuButton = menuWrap.querySelector("#header-menu-btn");
  const dropdown = menuWrap.querySelector("#header-menu-dropdown");
  if (!menuButton || !dropdown) return;

  menuButton.addEventListener("click", (event) => {
    event.stopPropagation();
    const isOpen = !dropdown.classList.contains("hidden");
    closeAllDropdowns();
    if (!isOpen) {
      dropdown.classList.remove("hidden");
      menuButton.setAttribute("aria-expanded", "true");
    }
  });

  dropdown.addEventListener("click", (event) => {
    event.stopPropagation();
  });
}

function ensurePasswordModal() {
  if (document.getElementById("headerPasswordModal")) {
    return;
  }

  const modal = document.createElement("div");
  modal.id = "headerPasswordModal";
  modal.className = "modal hidden";
  modal.innerHTML = `
    <div class="modal-content card">
      <h3>Change Password</h3>
      <form id="headerPasswordForm">
        <div class="modal-row">
          <label for="headerCurrentPassword">Current Password</label>
          <input id="headerCurrentPassword" type="password" required />
        </div>
        <div class="modal-row">
          <label for="headerNewPassword">New Password</label>
          <input id="headerNewPassword" type="password" required />
        </div>
        <p id="headerPasswordMessage" class="message" aria-live="polite"></p>
        <div class="modal-actions">
          <button type="submit" class="btn-primary">Update Password</button>
          <button type="button" id="headerPasswordCancel" class="btn-ghost">Cancel</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);

  const closeModal = () => {
    modal.classList.add("hidden");
    modal.querySelector("#headerPasswordForm")?.reset();
    const message = modal.querySelector("#headerPasswordMessage");
    if (message) {
      message.textContent = "";
    }
  };

  modal.querySelector("#headerPasswordCancel")?.addEventListener("click", closeModal);
  modal.querySelector("#headerPasswordForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const currentPassword = modal.querySelector("#headerCurrentPassword")?.value.trim() || "";
    const newPassword = modal.querySelector("#headerNewPassword")?.value.trim() || "";
    const message = modal.querySelector("#headerPasswordMessage");
    const result = await changeOwnPassword({ currentPassword, newPassword });
    if (!result.ok) {
      if (message) {
        message.textContent = result.message || "Failed to change password.";
      }
      return;
    }
    if (message) {
      message.textContent = "Password changed successfully.";
    }
    window.setTimeout(closeModal, 700);
  });
}

function bindHeaderPasswordChange() {
  ensurePasswordModal();
  document.querySelectorAll("[data-change-password]").forEach((button) => {
    if (button.dataset.changePasswordBound === "true") {
      return;
    }

    button.dataset.changePasswordBound = "true";
    button.addEventListener("click", () => {
      document.getElementById("headerPasswordModal")?.classList.remove("hidden");
      closeAllDropdowns();
    });
  });
}

function isRoutablePage(href) {
  return /^[^?#]+\.html(?:[?#].*)?$/i.test(String(href || ""));
}

function resolveRoute(href, baseUrl = window.location.href) {
  const url = new URL(href, baseUrl);
  return {
    route: url.pathname.split("/").pop() || "dashboard.html",
    url
  };
}

function ensureExternalScript(sourceUrl) {
  if (!sourceUrl || loadedAssetUrls.has(sourceUrl)) {
    return Promise.resolve();
  }

  loadedAssetUrls.add(sourceUrl);

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = sourceUrl;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${sourceUrl}`));
    document.head.appendChild(script);
  });
}

async function ensureRouteAssets(targetDocument, targetUrl) {
  const externalScripts = Array.from(targetDocument.querySelectorAll("script[src]:not([type='module'])"));

  for (const script of externalScripts) {
    const source = script.getAttribute("src");
    if (!source) {
      continue;
    }

    await ensureExternalScript(new URL(source, targetUrl).href);
  }
}

async function loadRouteModules(targetDocument, targetUrl) {
  const moduleScripts = Array.from(targetDocument.querySelectorAll("script[type='module'][src]"))
    .map((script) => script.getAttribute("src"))
    .filter((source) => source && !source.endsWith("layouts.js"));

  for (const source of moduleScripts) {
    const moduleUrl = new URL(source, targetUrl);
    moduleUrl.searchParams.set("view", `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await import(moduleUrl.href);
  }
}

async function navigateToRoute(href, options = {}) {
  const { pushState = true } = options;
  const { route, url } = resolveRoute(href);

  if (!activeSession || !isRoutablePage(route) || route === currentRoute) {
    return;
  }

  const navigationStartedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  // Check version on soft navigation
  void checkSystemVersion();

  const navigationToken = ++activeNavigationToken;

  try {
    const currentMainContent = document.querySelector(".main-content");
    if (!currentMainContent) {
      throw new Error("Missing current .main-content container.");
    }

    ensureMainContentStructure(currentMainContent);
    showRouteLoadingOverlay(currentMainContent);

    const response = await fetch(url.href, {
      credentials: "same-origin",
      headers: {
        Accept: "text/html"
      }
    });

    if (!response.ok) {
      throw new Error(`Route request failed with status ${response.status}`);
    }

    const html = await response.text();
    if (navigationToken !== activeNavigationToken) {
      return;
    }

    const parser = new DOMParser();
    const targetDocument = parser.parseFromString(html, "text/html");
    const nextMainContent = targetDocument.querySelector(".main-content");
    if (!nextMainContent) {
      throw new Error(`Missing .main-content in ${route}`);
    }

    const nextStructure = ensureMainContentStructure(nextMainContent);

    await ensureRouteAssets(targetDocument, url.href);
    if (navigationToken !== activeNavigationToken) {
      return;
    }

    // Wait for any queued state mutations to complete before reading back the
    // server state. Without this, a counselor saving an activity and immediately
    // clicking a sidebar link could trigger refreshState() before the PUT
    // response arrives, causing the optimistic update to be overwritten with
    // the pre-mutation server state.
    await awaitPendingMutations();
    if (navigationToken !== activeNavigationToken) {
      return;
    }

    if (!ROUTES_WITH_LOCAL_STATE_BOOTSTRAP.has(route)) {
      await refreshState();
      if (navigationToken !== activeNavigationToken) {
        return;
      }
    }

    runPageCleanup();
    const activeMainContent = document.querySelector(".main-content");
    if (!activeMainContent) {
      throw new Error("Missing current .main-content container.");
    }

    const activeStructure = ensureMainContentStructure(activeMainContent);

    if (nextStructure.topbar && activeStructure.topbar) {
      activeStructure.topbar.replaceWith(nextStructure.topbar);
    } else if (nextStructure.topbar && !activeStructure.topbar) {
      activeMainContent.prepend(nextStructure.topbar);
    }

    if (activeStructure.contentWindow && nextStructure.contentWindow) {
      const routeOverlay = activeStructure.contentWindow.querySelector(".route-loading-overlay");
      const nextNodes = Array.from(nextStructure.contentWindow.childNodes);
      activeStructure.contentWindow.replaceChildren(
        ...nextNodes,
        ...(routeOverlay ? [routeOverlay] : [])
      );
    } else {
      activeMainContent.replaceWith(nextMainContent);
    }

    showRouteLoadingOverlay(activeMainContent);

    document.title = targetDocument.title || document.title;
    document.body.className = targetDocument.body.className;

    currentRoute = route;
    applyRoleVisibility(activeSession);
    const allowed = enforceAccess(activeSession);
    if (!allowed) {
      return;
    }

    applyActiveSidebarState();
    streamlineTopbarProfile();
    hydrateRoleTag(activeSession);
    injectHeaderMenu();
    bindLogout();
    bindThemeControls();
    mountPingPill();
    injectNotificationBell();
    if (isSystemUpdateAvailable) {
      showUpdateAvailablePill({ notify: false });
    }

    if (pushState) {
      window.history.pushState({ route }, "", route);
    }

    createRouteReadyState(navigationToken);
    window.scrollTo({ top: 0, behavior: "instant" });
    await loadRouteModules(targetDocument, url.href);
    await waitForRouteReady(navigationToken);
    await waitForNextPaint(2);
    recordRouteNavigationPerformance(route, navigationStartedAt);
  } catch (error) {
    recordRouteNavigationPerformance(route, navigationStartedAt, {
      success: false,
      message: error?.message || "Soft navigation failed"
    });
    console.error("Soft navigation failed, falling back to a full page load.", error);
    window.location.href = href;
  } finally {
    clearRouteReadyState(navigationToken);
    hideRouteLoadingOverlay(document.querySelector(".main-content"));
    revealAppShell();
  }
}

window.__dvNavigateToRoute = (href, options = {}) => navigateToRoute(href, options);
window.__dvMarkRouteViewReady = () => {
  pendingRouteReadyState?.resolve?.();
};

function bindClientRouter() {
  document.addEventListener("click", (event) => {
    const link = event.target.closest(".sidebar-link[href]");
    if (!link) {
      return;
    }

    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }

    const href = link.getAttribute("href") || "";
    if (!isRoutablePage(href)) {
      return;
    }

    event.preventDefault();
    void navigateToRoute(href);
  });

  window.addEventListener("popstate", () => {
    const route = window.location.pathname.split("/").pop() || "dashboard.html";
    if (!isRoutablePage(route) || route === currentRoute) {
      return;
    }

    void navigateToRoute(route, { pushState: false });
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") {
      return;
    }
    recoverStaleRouteLoadingOverlay();
    if (activeSession) {
      void refreshNotificationSummary();
      const dropdown = document.getElementById('notification-dropdown');
      if (dropdown && !dropdown.classList.contains('hidden')) {
        void refreshDropdownList({ preferCache: true });
      }
    }
  });
}

async function guardProtectedPages() {
  const route = window.location.pathname.split("/").pop() || "dashboard.html";
  const skipStateRefresh = ["main-admission-leads.html", "performance-logs.html"].includes(route);
  await bootstrapLocalState({ skipStateRefresh });
  initThemeSystem();
  ensureMainContentStructure(document.querySelector(".main-content"));
  const session = getSession() || await refreshSession().catch(() => null);
  if (!session?.role) {
    window.location.href = "index.html";
    return null;
  }
  return session;
}

function renderBootstrapFailure(message) {
  const mainContent = document.querySelector(".main-content");
  if (!mainContent) {
    return;
  }

  const { contentWindow } = ensureMainContentStructure(mainContent);
  if (!contentWindow) {
    return;
  }

  contentWindow.innerHTML = `
    <section class="card" style="margin:24px;">
      <div class="card-head">
        <h3>App Load Failed</h3>
        <p>${escapeHtml(message || "The CRM could not finish loading.")}</p>
      </div>
      <p class="block-help">Refresh once, or open <strong>index.html?logout=1</strong> and sign in again.</p>
    </section>
  `;
}

try {
  const session = await guardProtectedPages();
  if (session) {
    activeSession = session;
    applyRoleVisibility(session);
    const allowed = enforceAccess(session);
    if (allowed) {
      applyActiveSidebarState();
      warmSidebarRoutes();
      streamlineTopbarProfile();
      hydrateRoleTag(session);
      injectHeaderMenu();
      bindLogout();
      bindHeaderPasswordChange();
      bindThemeControls();
      bindClientRouter();
      startPingMonitor();
      injectNotificationBell();
      startNotificationPolling(session);
      startVersionCheck();
    }
  }
} catch (error) {
  console.error("Failed to bootstrap protected page.", error);
  renderBootstrapFailure(error?.message || "The CRM could not finish loading.");
} finally {
  revealAppShell();
}

function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    // Play a premium futuristic chime: two tones sliding up
    osc.type = 'sine';
    osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.18);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.18);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(783.99, ctx.currentTime + 0.12); // G5
    gain2.gain.setValueAtTime(0.08, ctx.currentTime + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.38);
    osc2.start(ctx.currentTime + 0.12);
    osc2.stop(ctx.currentTime + 0.38);
  } catch (e) {
    console.warn("AudioContext playback blocked or failed", e);
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function showNotificationPopup(n) {
  if (n?.type === "task_due") {
    showTaskDuePanel(n);
    return;
  }

  let container = document.getElementById('notification-popup-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'notification-popup-container';
    container.className = 'notification-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `notification-toast ${n.role === 'admin' ? 'toast-admin' : 'toast-counselor'}`;
  
  if (n.sound) {
    playNotificationSound();
  }

  toast.innerHTML = `
    <div class="toast-header">
      <span class="toast-title">${escapeHtml(n.title)}</span>
      <button class="toast-close-btn" aria-label="Close">&times;</button>
    </div>
    <div class="toast-body">${escapeHtml(n.message)}</div>
  `;

  container.appendChild(toast);

  // Trigger browser paint for slide-in animation
  requestAnimationFrame(() => {
    toast.classList.add('show');
  });

  const closeBtn = toast.querySelector('.toast-close-btn');
  closeBtn.addEventListener('click', () => dismissToast(toast));

  // Auto dismiss after 7.5 seconds
  let autoDismissTimer = setTimeout(() => dismissToast(toast), 7500);

  // Hover pauses auto-dismiss
  toast.addEventListener('mouseenter', () => clearTimeout(autoDismissTimer));
  toast.addEventListener('mouseleave', () => {
    autoDismissTimer = setTimeout(() => dismissToast(toast), 3000);
  });
}

function formatNotificationDueDate(value) {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function showTaskDuePanel(n) {
  if (n.sound) {
    playNotificationSound();
  }

  const existing = document.getElementById(`task-due-panel-${n.taskId || n.id}`);
  if (existing) {
    existing.classList.remove("hidden");
    return;
  }

  const overlay = document.createElement("div");
  overlay.className = "task-due-overlay";
  overlay.id = `task-due-panel-${n.taskId || n.id}`;
  overlay.innerHTML = `
    <div class="task-due-card" role="dialog" aria-modal="true" aria-labelledby="task-due-title-${n.id}">
      <div class="task-due-card__header">
        <div>
          <p class="task-due-card__eyebrow">Counselor Reminder</p>
          <h3 id="task-due-title-${n.id}">${escapeHtml(n.taskTitle || n.title || "Task Due")}</h3>
        </div>
        <button type="button" class="task-due-card__close" aria-label="Close">&times;</button>
      </div>
      <div class="task-due-card__body">
        <div class="task-due-card__grid">
          <div><span>Lead</span><strong>${escapeHtml(n.leadName || "-")}</strong></div>
          <div><span>Category</span><strong>${escapeHtml(n.taskCategory || "Task")}</strong></div>
          <div><span>Due</span><strong>${escapeHtml(formatNotificationDueDate(n.taskDueDate))}</strong></div>
          <div><span>Counselor</span><strong>${escapeHtml(n.assignedCounselor || "-")}</strong></div>
        </div>
        <div class="task-due-card__notes">
          <span>Notes</span>
          <p>${escapeHtml(n.taskNotes || "No notes added for this task.")}</p>
        </div>
      </div>
      <div class="task-due-card__actions">
        <button type="button" class="btn-primary task-due-open-btn">Open Task Tracker</button>
        <button type="button" class="btn-ghost task-due-dismiss-btn">Dismiss</button>
      </div>
    </div>
  `;

  const closePanel = () => overlay.remove();
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      closePanel();
    }
  });
  overlay.querySelector(".task-due-card__close")?.addEventListener("click", closePanel);
  overlay.querySelector(".task-due-dismiss-btn")?.addEventListener("click", closePanel);
  overlay.querySelector(".task-due-open-btn")?.addEventListener("click", () => {
    window.location.href = "task-tracker.html";
  });

  document.body.appendChild(overlay);
}

function dismissToast(toast) {
  toast.classList.remove('show');
  toast.classList.add('fade-out');
  toast.addEventListener('transitionend', () => {
    toast.remove();
  }, { once: true });
}

function startNotificationPolling(session) {
  if (!session || !session.role) return;

  if (notificationPollTimerId) {
    clearInterval(notificationPollTimerId);
    notificationPollTimerId = null;
  }
  if (notificationPollTimeoutId) {
    clearTimeout(notificationPollTimeoutId);
    notificationPollTimeoutId = null;
  }

  async function poll() {
    if (document.visibilityState === "hidden") {
      return;
    }
    try {
      // 1. Poll popups (undelivered notifications)
      const popupResp = await fetch('/api/notifications?popup=true', {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { 'Accept': 'application/json' }
      });
      if (popupResp.status === 401) {
        clearInterval(notificationPollTimerId);
        notificationPollTimerId = null;
        return;
      }
      if (popupResp.ok) {
        const popups = await popupResp.json();
        if (Array.isArray(popups) && popups.length > 0) {
          popups.forEach(n => showNotificationPopup(n));
        }
      }

      // 2. Poll cheap unread count for the bell badge. The full list loads on demand.
      await refreshNotificationSummary();
    } catch (err) {
      console.warn("Failed to poll notifications:", err);
    }
  }

  notificationPollTimerId = setInterval(poll, NOTIFICATION_POLL_INTERVAL_MS);
  // Do an initial poll after a short delay
  notificationPollTimeoutId = setTimeout(poll, 500);
}

async function refreshNotificationSummary() {
  const summaryResp = await fetch('/api/notifications/summary', {
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { 'Accept': 'application/json' }
  });
  if (summaryResp.ok) {
    const summary = await summaryResp.json();
    updateBellBadge(Number(summary?.unreadCount) || 0);
  }
}

function injectNotificationBell() {
  const profileContainer = document.querySelector('.topbar-profile');
  if (!profileContainer) return;
  
  if (document.getElementById('notification-bell-btn')) return;

  const bellWrap = document.createElement('div');
  bellWrap.className = 'bell-wrap-container';
  bellWrap.style.position = 'relative';

  bellWrap.innerHTML = `
    <button type="button" id="notification-bell-btn" class="bell-btn" aria-label="Notifications" aria-haspopup="true" aria-expanded="false">
      <svg class="bell-icon" viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
        <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
      </svg>
      <span id="bell-badge-count" class="bell-badge hidden">0</span>
    </button>
    
    <div id="notification-dropdown" class="notification-dropdown-menu hidden">
      <div class="dropdown-header">
        <span>Notifications</span>
        <button id="clear-all-notifications" class="clear-all-btn">Clear all</button>
      </div>
      <div id="dropdown-notifications-list" class="dropdown-list">
        <div class="empty-dropdown">No new notifications</div>
      </div>
    </div>
  `;

  const pingPill = document.getElementById("dvPingPill");
  const identityTag = profileContainer.querySelector("[data-role-tag]");
  if (pingPill && pingPill.parentElement === profileContainer) {
    profileContainer.insertBefore(bellWrap, pingPill.nextSibling);
  } else if (identityTag) {
    profileContainer.insertBefore(bellWrap, identityTag);
  } else {
    profileContainer.insertBefore(bellWrap, profileContainer.firstChild);
  }

  const bellBtn = document.getElementById('notification-bell-btn');
  const dropdown = document.getElementById('notification-dropdown');
  const clearBtn = document.getElementById('clear-all-notifications');

  bellBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = !dropdown.classList.contains('hidden');
    closeAllDropdowns();
    if (!isOpen) {
      dropdown.classList.remove('hidden');
      bellBtn.setAttribute('aria-expanded', 'true');
      refreshDropdownList({ preferCache: true });
    }
  });

  clearBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      await fetch('/api/notifications/read', {
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }
      });
      document.getElementById('bell-badge-count').textContent = '0';
      document.getElementById('bell-badge-count').classList.add('hidden');
      notificationListCache = { items: [], fetchedAt: Date.now() };
      document.getElementById('dropdown-notifications-list').innerHTML = `
        <div class="empty-dropdown">No new notifications</div>
      `;
    } catch (err) {
      console.warn("Failed to clear notifications", err);
    }
  });

  document.addEventListener('click', () => {
    closeAllDropdowns();
  });

  dropdown.addEventListener('click', (e) => {
    e.stopPropagation();
  });
}

function closeAllDropdowns() {
  const dropdown = document.getElementById('notification-dropdown');
  const bellBtn = document.getElementById('notification-bell-btn');
  if (dropdown) dropdown.classList.add('hidden');
  if (bellBtn) bellBtn.setAttribute('aria-expanded', 'false');

  const headerMenuDropdown = document.getElementById("header-menu-dropdown");
  const headerMenuBtn = document.getElementById("header-menu-btn");
  if (headerMenuDropdown) headerMenuDropdown.classList.add("hidden");
  if (headerMenuBtn) headerMenuBtn.setAttribute("aria-expanded", "false");
}

async function refreshDropdownList(options = {}) {
  const listContainer = document.getElementById('dropdown-notifications-list');
  const now = Date.now();
  if (options.preferCache && Array.isArray(notificationListCache.items) && now - notificationListCache.fetchedAt < NOTIFICATION_LIST_CACHE_MS) {
    renderNotificationsList(notificationListCache.items);
    return;
  }

  try {
    if (listContainer) {
      listContainer.innerHTML = `<div class="empty-dropdown">Loading notifications...</div>`;
    }
    const resp = await fetch(`/api/notifications?limit=${NOTIFICATION_LIST_LIMIT}`, {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    });
    if (resp.ok) {
      const unreadList = await resp.json();
      notificationListCache = {
        items: Array.isArray(unreadList) ? unreadList : [],
        fetchedAt: Date.now()
      };
      renderNotificationsList(unreadList);
      updateBellBadge(Array.isArray(unreadList) ? unreadList.length : 0);
    }
  } catch (err) {
    console.warn("Failed to refresh notifications list", err);
    if (listContainer) {
      listContainer.innerHTML = `<div class="empty-dropdown">Unable to load notifications</div>`;
    }
  }
}

function renderNotificationsList(unreadList) {
  const listContainer = document.getElementById('dropdown-notifications-list');
  if (!listContainer) return;

  if (!unreadList.length) {
    listContainer.innerHTML = `<div class="empty-dropdown">No new notifications</div>`;
    return;
  }

  listContainer.innerHTML = unreadList.map(n => {
    const timeStr = formatNotificationTime(n.createdAt);
    return `
      <div class="dropdown-item" data-notification-id="${n.id}">
        <div class="dropdown-item-header">
          <span class="dropdown-item-title">${escapeHtml(n.title)}</span>
          <span class="dropdown-item-time">${timeStr}</span>
        </div>
        <div class="dropdown-item-body">${escapeHtml(n.message)}</div>
      </div>
    `;
  }).join('');

  listContainer.querySelectorAll('.dropdown-item').forEach(item => {
    item.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = item.getAttribute('data-notification-id');
      try {
        await fetch('/api/notifications/read', {
          method: 'POST',
          cache: 'no-store',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: [id] })
        });
        item.remove();
        notificationListCache.items = Array.isArray(notificationListCache.items)
          ? notificationListCache.items.filter((notification) => notification.id !== id)
          : null;
        notificationListCache.fetchedAt = Date.now();
        
        const badge = document.getElementById('bell-badge-count');
        if (badge) {
          const currentCount = parseInt(badge.textContent, 10) || 0;
          const nextCount = Math.max(0, currentCount - 1);
          if (nextCount > 0) {
            badge.textContent = nextCount;
          } else {
            badge.textContent = '0';
            badge.classList.add('hidden');
            listContainer.innerHTML = `<div class="empty-dropdown">No new notifications</div>`;
          }
        }
      } catch (err) {
        console.warn("Failed to mark notification as read", err);
      }
    });
  });
}

function updateBellBadge(unreadList) {
  const badge = document.getElementById('bell-badge-count');
  if (!badge) return;

  const count = Array.isArray(unreadList) ? unreadList.length : Number(unreadList) || 0;
  if (count > 0) {
    badge.textContent = count > 99 ? '99+' : count;
    badge.classList.remove('hidden');
  } else {
    badge.textContent = '0';
    badge.classList.add('hidden');
  }

  const dropdown = document.getElementById('notification-dropdown');
  if (Array.isArray(unreadList) && dropdown && !dropdown.classList.contains('hidden')) {
    renderNotificationsList(unreadList);
  }
}

function formatNotificationTime(dateString) {
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch (e) {
    return '';
  }
}

// ─── Version Checker ─────────────────────────────────────────────────────────
let currentClientVersion = null;
let isUpdateModalShown = false;
let isSystemUpdateAvailable = false;

async function checkSystemVersion() {
  try {
    const response = await fetch("/api/version", {
      credentials: "same-origin",
      headers: { "Accept": "application/json" }
    });
    if (response.ok) {
      const data = await response.json();
      const version = data.version;
      if (!currentClientVersion) {
        currentClientVersion = version;
      } else if (version !== currentClientVersion && !isSystemUpdateAvailable) {
        showUpdateAvailablePill();
      }
    }
  } catch (err) {
    console.warn("Failed to check system version:", err);
  }
}

function showUpdateAvailablePill({ notify = true } = {}) {
  const wasAlreadyAvailable = isSystemUpdateAvailable;
  isSystemUpdateAvailable = true;

  if (notify && !wasAlreadyAvailable) {
    // Play a premium sound to notify the user without blocking their current work.
    playNotificationSound();
  }

  const profileContainer = document.querySelector(".topbar-profile");
  if (!profileContainer || document.getElementById("system-update-pill")) {
    return;
  }

  const pill = document.createElement("button");
  pill.type = "button";
  pill.id = "system-update-pill";
  pill.className = "update-available-pill";
  pill.setAttribute("aria-haspopup", "dialog");
  pill.innerHTML = `
    <span class="update-available-pill__dot" aria-hidden="true"></span>
    <span>Update available</span>
  `;
  pill.addEventListener("click", showUpdateModal);

  const notificationBell = profileContainer.querySelector(".bell-wrap-container");
  const identityTag = profileContainer.querySelector("[data-role-tag]");
  if (notificationBell) {
    profileContainer.insertBefore(pill, notificationBell);
  } else if (identityTag) {
    profileContainer.insertBefore(pill, identityTag);
  } else {
    profileContainer.insertBefore(pill, profileContainer.firstChild);
  }
}

function showUpdateModal() {
  if (isUpdateModalShown) return;
  isUpdateModalShown = true;

  const overlay = document.createElement("div");
  overlay.className = "update-modal-overlay";
  overlay.innerHTML = `
    <div class="update-modal-card">
      <div class="update-icon-container">
        <div class="update-icon-pulse"></div>
        <svg class="update-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
        </svg>
      </div>
      <h2>System Update Available</h2>
      <p>A new version of the CRM has been deployed. Please perform a hard refresh to apply the latest updates and avoid data sync conflicts.</p>
      
      <div class="update-instructions">
        <div class="update-instructions-title">Hard Refresh Shortcuts</div>
        <ul class="update-instructions-list">
          <li>
            <span>Windows / Linux</span>
            <kbd class="update-instruction-kbd">Ctrl + Shift + R</kbd>
          </li>
          <li>
            <span>macOS</span>
            <kbd class="update-instruction-kbd">Cmd + Shift + R</kbd>
          </li>
        </ul>
      </div>
      
      <button class="btn-update-reload" id="btn-update-reload">Reload CRM</button>
    </div>
  `;

  document.body.appendChild(overlay);

  const reloadBtn = overlay.querySelector("#btn-update-reload");
  reloadBtn.addEventListener("click", () => {
    const url = new URL(window.location.href);
    url.searchParams.set("v", Date.now().toString());
    window.location.replace(url.toString());
  });
}

function startVersionCheck() {
  // Initial check
  void checkSystemVersion();
  // Poll every 60 seconds
  setInterval(checkSystemVersion, 60000);
  
  // Check when the user refocuses or opens the tab
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void checkSystemVersion();
    }
  });
}
