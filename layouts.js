import { runPageCleanup } from "./page-runtime.js";
import { bindThemeControls, initThemeSystem } from "./theme.js";
import { bootstrapLocalState, getSession, getStateField, logout, refreshSession, refreshState, awaitPendingMutations } from "./state-sync.js";
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
const loadedAssetUrls = new Set(
  Array.from(document.querySelectorAll("script[src]:not([type='module'])"), (script) => script.src)
);

const PAGE_PERMISSION_MAP = {
  "dashboard.html": "dashboard",
  "lead-browse.html": "leadBrowse",
  "pre-workshop.html": "preWorkshop",
  "post-workshop.html": "postWorkshop",
  "task-tracker.html": "taskTracker",
  "lost-leads.html": "lostLeads",
  "monitoring.html": "monitoring"
};

const DEFAULT_PERMISSIONS = {
  dashboard: false,
  leadBrowse: true,
  preWorkshop: true,
  postWorkshop: true,
  taskTracker: true,
  lostLeads: true,
  monitoring: true
};

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

  const generalRoutes = ["dashboard.html", "lead-browse.html", "lost-leads.html", "monitoring.html", "task-tracker.html"];
  const adminRoutes = ["counselor-management.html", "lead-control.html"];

  const routeLabels = {
    "dashboard.html": "Dashboard",
    "lead-browse.html": "Lead Browse",
    "pre-workshop.html": "Workshop",
    "registered-candidates.html": "Admission",
    "task-tracker.html": "Task Tracker",
    "lost-leads.html": "Lost Leads",
    "monitoring.html": "Monitoring",
    "counselor-management.html": "Counselor Management",
    "lead-control.html": "Lead & Data Control",
    "meta-integration.html": "Integration"
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

  const primaryRoutes = ["dashboard.html", "lead-browse.html"];
  const remainingRoutes = generalRoutes.filter((route) => !primaryRoutes.includes(route));

  primaryRoutes.forEach((route) => {
    const link = ensureLink(route, { counselorOnly: route === "task-tracker.html" });
    if (link) {
      navContainer.appendChild(link);
    }
  });

  const workshopLink = ensureLink("pre-workshop.html", {
    activeRoutes: ["post-workshop.html"]
  });
  if (workshopLink) {
    navContainer.appendChild(workshopLink);
  }

  const admissionLink = ensureLink("registered-candidates.html", {
    activeRoutes: ["main-admission-leads.html", "crash-course.html"]
  });
  if (admissionLink) {
    navContainer.appendChild(admissionLink);
  }

  remainingRoutes.forEach((route) => {
    const link = ensureLink(route, { counselorOnly: route === "task-tracker.html" });
    if (link) {
      navContainer.appendChild(link);
    }
  });

  adminRoutes.forEach((route) => {
    const link = ensureLink(route, { bottom: true, adminOnly: true });
    if (link) {
      bottomLinkContainer.appendChild(link);
    }
  });

  const integrationLink = ensureLink("meta-integration.html", {
    bottom: true,
    adminOnly: true,
    activeRoutes: ["elementor-integration.html"]
  });
  if (integrationLink) {
    bottomLinkContainer.appendChild(integrationLink);
  }
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
  const name = String(session?.name || "").trim();
  if (name) {
    return name;
  }

  if (session?.role === "admin") return "Admin";
  if (session?.role === "marketing") return "Marketing";
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

function getCounselorPermissions(session) {
  const counselors = getCounselors();
  const counselor = counselors.find(
    (item) => String(item.email || "").toLowerCase() === String(session.email || "").toLowerCase()
  );

  return {
    ...DEFAULT_PERMISSIONS,
    ...(session.permissions || {}),
    ...(counselor?.permissions || {}),
    // Dashboard remains admin-only even if older counselor records still have it enabled.
    dashboard: false
  };
}

function getFirstAllowedPage(permissions) {
  if (permissions.preWorkshop) return "pre-workshop.html";
  if (permissions.postWorkshop) return "post-workshop.html";
  if (permissions.lostLeads) return "lost-leads.html";
  if (permissions.monitoring) return "monitoring.html";
  return "index.html";
}

function applyRoleVisibility(session) {
  ensureIntegrationSidebarLinks();
  rebuildSidebarSections();
  const adminOnlyElements = document.querySelectorAll("[data-admin-only='true']");
  const counselorOnlyElements = document.querySelectorAll("[data-counselor-only='true']");
  const isAdmin = session.role === "admin";
  const isCounselor = session.role === "counselor";
  const isMarketing = session.role === "marketing";
  adminOnlyElements.forEach((element) => {
    element.classList.toggle("hidden", !isAdmin);
  });
  counselorOnlyElements.forEach((element) => {
    element.classList.toggle("hidden", !isCounselor);
  });
  // Marketing users only need the integration links and universal browse in the sidebar.
  if (isMarketing) {
    document.querySelectorAll(".sidebar-link").forEach((link) => {
      const href = link.getAttribute("href") || "";
      const isIntegrationLink = href === "meta-integration.html" || href === "elementor-integration.html";
      const isUniversalLink = href === "lead-browse.html";
      link.classList.toggle("hidden", !isIntegrationLink && !isUniversalLink);
      if (isIntegrationLink) {
        link.classList.remove("hidden");
      }
      if (isUniversalLink) {
        link.classList.remove("hidden");
      }
    });
  }
}

function enforceAccess(session) {
  // Marketing users: only allowed on integration pages.
  if (session.role === "marketing") {
    if (currentRoute !== "lead-browse.html" && currentRoute !== "meta-integration.html" && currentRoute !== "elementor-integration.html") {
      window.location.href = "meta-integration.html";
      return false;
    }
    return true;
  }

  if (currentRoute === "task-tracker.html" && session.role !== "counselor") {
    window.location.href = session.role === "admin" ? "dashboard.html" : "index.html";
    return false;
  }

  if (
    (currentRoute === "counselor-management.html" || currentRoute === "meta-integration.html" || currentRoute === "elementor-integration.html" || currentRoute === "lead-control.html") &&
    session.role !== "admin"
  ) {
    const fallback =
      session.role === "counselor"
        ? getFirstAllowedPage(getCounselorPermissions(session))
        : "index.html";
    window.location.href = fallback;
    return false;
  }

  if (session.role !== "counselor") {
    return true;
  }

  const permissions = getCounselorPermissions(session);
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
      await logout();
      window.location.href = "index.html";
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

  // Check version on soft navigation
  void checkSystemVersion();

  const navigationToken = ++activeNavigationToken;

  try {
    document.body.classList.add("route-loading");

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

    await refreshState();
    if (navigationToken !== activeNavigationToken) {
      return;
    }

    runPageCleanup();

    const currentMainContent = document.querySelector(".main-content");
    if (!currentMainContent) {
      throw new Error("Missing current .main-content container.");
    }

    currentMainContent.replaceWith(nextMainContent);
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

    if (pushState) {
      window.history.pushState({ route }, "", route);
    }

    window.scrollTo({ top: 0, behavior: "instant" });
    await loadRouteModules(targetDocument, url.href);
  } catch (error) {
    console.error("Soft navigation failed, falling back to a full page load.", error);
    window.location.href = href;
  } finally {
    document.body.classList.remove("route-loading");
  }
}

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
    // Marketing users can only use their visible links.
    if (activeSession?.role === "marketing") {
      const targetRoute = resolveRoute(href).route;
      if (targetRoute !== "lead-browse.html" && targetRoute !== "meta-integration.html" && targetRoute !== "elementor-integration.html") {
        return;
      }
    }
    void navigateToRoute(href);
  });

  window.addEventListener("popstate", () => {
    const route = window.location.pathname.split("/").pop() || "dashboard.html";
    if (!isRoutablePage(route) || route === currentRoute) {
      return;
    }

    void navigateToRoute(route, { pushState: false });
  });
}

async function guardProtectedPages() {
  await bootstrapLocalState();
  initThemeSystem();
  const session = getSession() || await refreshSession().catch(() => null);
  if (!session?.role) {
    window.location.href = "index.html";
    return null;
  }
  return session;
}

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
    bindThemeControls();
    bindClientRouter();
    startPingMonitor();
    injectNotificationBell();
    startNotificationPolling(session);
    startVersionCheck();
  }
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

function dismissToast(toast) {
  toast.classList.remove('show');
  toast.classList.add('fade-out');
  toast.addEventListener('transitionend', () => {
    toast.remove();
  }, { once: true });
}

function startNotificationPolling(session) {
  if (!session || !session.role) return;

  const pollInterval = 6000; // poll every 6s
  let timerId = null;

  async function poll() {
    try {
      // 1. Poll popups (undelivered notifications)
      const popupResp = await fetch('/api/notifications?popup=true', {
        credentials: 'same-origin',
        headers: { 'Accept': 'application/json' }
      });
      if (popupResp.status === 401) {
        clearInterval(timerId);
        return;
      }
      if (popupResp.ok) {
        const popups = await popupResp.json();
        if (Array.isArray(popups) && popups.length > 0) {
          popups.forEach(n => showNotificationPopup(n));
        }
      }

      // 2. Poll full unread list to update bell badge and dropdown items
      const listResp = await fetch('/api/notifications', {
        credentials: 'same-origin',
        headers: { 'Accept': 'application/json' }
      });
      if (listResp.ok) {
        const unreadList = await listResp.json();
        updateBellBadge(unreadList);
      }
    } catch (err) {
      console.warn("Failed to poll notifications:", err);
    }
  }

  timerId = setInterval(poll, pollInterval);
  // Do an initial poll after a short delay
  setTimeout(poll, 1500);
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
      refreshDropdownList();
    }
  });

  clearBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      await fetch('/api/notifications/read', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }
      });
      document.getElementById('bell-badge-count').textContent = '0';
      document.getElementById('bell-badge-count').classList.add('hidden');
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

async function refreshDropdownList() {
  try {
    const resp = await fetch('/api/notifications', {
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    });
    if (resp.ok) {
      const unreadList = await resp.json();
      renderNotificationsList(unreadList);
      updateBellBadge(unreadList);
    }
  } catch (err) {
    console.warn("Failed to refresh notifications list", err);
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
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: [id] })
        });
        item.remove();
        
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

  const count = unreadList.length;
  if (count > 0) {
    badge.textContent = count > 99 ? '99+' : count;
    badge.classList.remove('hidden');
  } else {
    badge.textContent = '0';
    badge.classList.add('hidden');
  }

  const dropdown = document.getElementById('notification-dropdown');
  if (dropdown && !dropdown.classList.contains('hidden')) {
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
      } else if (version !== currentClientVersion && !isUpdateModalShown) {
        showUpdateModal();
      }
    }
  } catch (err) {
    console.warn("Failed to check system version:", err);
  }
}

function showUpdateModal() {
  if (isUpdateModalShown) return;
  isUpdateModalShown = true;

  // Play a premium sound to notify the user
  playNotificationSound();

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
