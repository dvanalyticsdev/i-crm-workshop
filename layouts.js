import { runPageCleanup } from "./page-runtime.js";
import { bindThemeControls, initThemeSystem } from "./theme.js";
import { bootstrapLocalState, getSession, getStateField, logout, refreshSession, refreshState, awaitPendingMutations } from "./state-sync.js";
import { startPingMonitor, mountPingPill } from "./ping-monitor.js";

let currentRoute = window.location.pathname.split("/").pop() || "dashboard.html";
let activeSession = null;
let activeNavigationToken = 0;
const loadedAssetUrls = new Set(
  Array.from(document.querySelectorAll("script[src]:not([type='module'])"), (script) => script.src)
);

const PAGE_PERMISSION_MAP = {
  "dashboard.html": "dashboard",
  "pre-workshop.html": "preWorkshop",
  "post-workshop.html": "postWorkshop",
  "task-tracker.html": "taskTracker",
  "lost-leads.html": "lostLeads",
  "monitoring.html": "monitoring"
};

const DEFAULT_PERMISSIONS = {
  dashboard: false,
  preWorkshop: true,
  postWorkshop: true,
  taskTracker: true,
  lostLeads: true,
  monitoring: true
};

function applyActiveSidebarState() {
  const sidebarLinks = document.querySelectorAll(".sidebar-link");
  sidebarLinks.forEach((link) => {
    const isActive = link.getAttribute("href") === currentRoute;
    link.classList.toggle("active", isActive);
  });
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

function hydrateRoleTag(session) {
  const roleTags = document.querySelectorAll("[data-role-tag]");
  const text = session?.role === "admin" ? "Admin" : session?.role === "marketing" ? "Marketing" : "Counselor";
  roleTags.forEach((tag) => {
    tag.textContent = text;
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
  // Hide the entire sidebar for marketing users — they only have meta-integration.html
  if (isMarketing) {
    const sidebar = document.querySelector(".sidebar");
    if (sidebar) sidebar.style.display = "none";
    const mainContent = document.querySelector(".main-content");
    if (mainContent) mainContent.style.marginLeft = "0";
    const layoutRoot = document.querySelector(".layout-root");
    if (layoutRoot) layoutRoot.style.gridTemplateColumns = "1fr";
  }
}

function enforceAccess(session) {
  // Marketing users: only allowed on meta-integration.html
  if (session.role === "marketing") {
    if (currentRoute !== "meta-integration.html") {
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
    (currentRoute === "counselor-management.html" || currentRoute === "meta-integration.html") &&
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
    button.addEventListener("click", async () => {
      await logout();
      window.location.href = "index.html";
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
    hydrateRoleTag(activeSession);
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
    // Marketing users cannot navigate to other pages via the sidebar
    if (activeSession?.role === "marketing") return;
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
    hydrateRoleTag(session);
    bindLogout();
    bindThemeControls();
    bindClientRouter();
    startPingMonitor();
    injectNotificationBell();
    startNotificationPolling(session);
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

  profileContainer.insertBefore(bellWrap, profileContainer.firstChild);

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
