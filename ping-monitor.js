import { apiUrl } from "./api-client.js";

/**
 * ping-monitor.js
 *
 * Measures round-trip latency to /api/ping every PING_INTERVAL_MS.
 * - Renders a colour-coded pill in every topbar-profile header.
 * - Keeps latency informational in the top bar so brief server or routing
 *   spikes do not incorrectly block users on stable connections.
 * - Shows a blocking overlay only after repeated failed pings or a confirmed
 *   browser offline event, which is a much stronger signal of an actual drop.
 */

const PING_INTERVAL_MS        = 8000;   // measure every 8 s (was 5 s — reduced to cut background requests)
const WARN_PING_THRESHOLD_MS  = 300;    // ms — informational only
const PING_REQUEST_TIMEOUT_MS = 8000;   // abort if server doesn't respond in 8 s
const CONSECUTIVE_FAILURES_TO_BLOCK = 2;
const GOOD_STREAK_TO_UNBLOCK  = 2;

let pingTimer     = null;
let blocked       = false;
let goodStreak    = 0;
let failedStreak  = 0;

function emitConnectivityEvent(name, detail = {}) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(name, { detail }));
}

// ─── DOM helpers ──────────────────────────────────────────────────────────────

function getPillEl()    { return document.getElementById("dvPingPill");    }
function getOverlayEl() { return document.getElementById("dvPingOverlay"); }

function setPillState(ping, state) {
  const pill = getPillEl();
  if (!pill) return;
  const dot   = pill.querySelector(".ping-pill__dot");
  const value = pill.querySelector(".ping-pill__value");
  pill.className        = `ping-pill ping-pill--${state}`;
  dot.className         = `ping-pill__dot ping-pill__dot--${state}`;
  value.textContent     = ping !== null ? `${ping} ms` : "…";
  pill.title            = ping !== null ? `Network latency: ${ping} ms` : "Measuring latency…";
}

function setOverlayPing(ping) {
  const valueEl = document.getElementById("dvPingOverlayValue");
  if (valueEl) {
    valueEl.textContent = ping !== null ? `${ping} ms` : "Measuring…";
  }
  const dot = getOverlayEl()?.querySelector(".ping-pill__dot");
  if (dot) {
    dot.className = "ping-pill__dot ping-pill__dot--bad";
  }
}

function setBlockedState(nextBlocked) {
  if (blocked === nextBlocked) return;
  blocked = nextBlocked;
  const overlay = getOverlayEl();
  if (!overlay) return;
  if (nextBlocked) {
    overlay.classList.remove("hidden");
  } else {
    overlay.classList.add("hidden");
  }
}

// ─── Measurement ──────────────────────────────────────────────────────────────

async function measurePing() {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    failedStreak = CONSECUTIVE_FAILURES_TO_BLOCK;
    goodStreak = 0;
    setPillState(null, "bad");
    setBlockedState(true);
    setOverlayPing(null);
    emitConnectivityEvent("dv:network-lost", { reason: "offline" });
    return;
  }

  const start = performance.now();
  let ping  = null;
  let state = "idle";
  let requestFailed = false;
  const wasBlocked = blocked;
  const hadFailures = failedStreak > 0;

  try {
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), PING_REQUEST_TIMEOUT_MS);
    const response   = await fetch(apiUrl("/api/ping"), {
      method:      "GET",
      credentials: "same-origin",
      cache:       "no-store",
      headers:     { Accept: "application/json" },
      signal:      controller.signal
    });
    clearTimeout(timeoutId);

    if (response.ok) {
      ping  = Math.round(performance.now() - start);
      state = ping < WARN_PING_THRESHOLD_MS ? "good" : "warn";
    } else {
      state = "bad";
      requestFailed = true;
    }
  } catch (_err) {
    // Network failure or abort — treat as worst-case latency.
    state = "bad";
    requestFailed = true;
  }

  setPillState(ping, state);

  if (requestFailed) {
    failedStreak++;
    goodStreak = 0;
    emitConnectivityEvent("dv:network-degraded", { failedStreak });
    if (failedStreak >= CONSECUTIVE_FAILURES_TO_BLOCK) {
      setBlockedState(true);
      setOverlayPing(ping);
      emitConnectivityEvent("dv:network-lost", { reason: "ping-failed", failedStreak });
    }
  } else {
    failedStreak = 0;
    goodStreak++;
    if (goodStreak >= GOOD_STREAK_TO_UNBLOCK) {
      setBlockedState(false);
    } else {
      // Still accumulating the required streak — keep overlay if already shown.
      if (blocked) setOverlayPing(ping);
    }

    if (hadFailures || wasBlocked) {
      emitConnectivityEvent("dv:network-recovered", { ping, wasBlocked });
    }
  }
}

// ─── DOM injection ────────────────────────────────────────────────────────────

function buildPillEl() {
  const pill     = document.createElement("div");
  pill.id        = "dvPingPill";
  pill.className = "ping-pill ping-pill--idle";
  pill.title     = "Measuring latency…";
  pill.innerHTML = `
    <span class="ping-pill__dot ping-pill__dot--idle" aria-hidden="true"></span>
    <span class="ping-pill__value">…</span>
  `;
  return pill;
}

function buildOverlayEl() {
  const overlay     = document.createElement("div");
  overlay.id        = "dvPingOverlay";
  overlay.className = "ping-overlay hidden";
  overlay.setAttribute("role", "alertdialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Network connection lost — actions are paused");
  overlay.innerHTML = `
    <div class="ping-overlay__card">
      <div class="ping-overlay__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          <line x1="12" y1="9"  x2="12"    y2="13"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
      </div>
      <h3 class="ping-overlay__title">Network Connection Lost</h3>
      <p class="ping-overlay__desc">
        We couldn't reach the server reliably.<br>
        Actions are temporarily paused until the connection recovers.
      </p>
      <div class="ping-overlay__meter">
        <span class="ping-pill__dot ping-pill__dot--bad" aria-hidden="true"></span>
        <span id="dvPingOverlayValue">Measuring…</span>
      </div>
    </div>
  `;
  return overlay;
}

/**
 * Mount (or re-mount after soft navigation) the pill into the current page's
 * .topbar-profile.  Safe to call multiple times — skips if the pill already
 * exists in the current topbar.
 */
export function mountPingPill() {
  const profile = document.querySelector(".topbar-profile");
  if (!profile) return;

  // Remove any stale pill from a previous soft-nav render.
  const stale = document.getElementById("dvPingPill");
  if (stale && !profile.contains(stale)) {
    stale.remove();
  }

  if (!document.getElementById("dvPingPill")) {
    profile.insertBefore(buildPillEl(), profile.firstChild);
  }

  // Restore visual state to match whatever was last measured.
  // (The overlay persists in <body> so it does not need re-mounting.)
  const pill = getPillEl();
  if (pill && blocked) {
    pill.className = "ping-pill ping-pill--bad";
    const dot = pill.querySelector(".ping-pill__dot");
    if (dot) dot.className = "ping-pill__dot ping-pill__dot--bad";
  }
}

/**
 * Start the ping monitor.  Should be called once after the user is
 * authenticated.  Returns a cleanup function.
 */
export function startPingMonitor() {
  if (typeof document === "undefined" || typeof performance === "undefined") {
    return () => undefined;
  }

  mountPingPill();

  if (!document.getElementById("dvPingOverlay")) {
    document.body.appendChild(buildOverlayEl());
  }

  // First reading immediately so the pill does not show "…" for 5 s.
  void measurePing();

  function tick() {
    if (document.visibilityState !== "hidden") {
      void measurePing();
    }
  }

  pingTimer = setInterval(tick, PING_INTERVAL_MS);

  function handleVisibility() {
    if (document.visibilityState === "visible") {
      void measurePing();
    }
  }

  function handleOnline() {
    void measurePing();
  }

  function handleOffline() {
    failedStreak = CONSECUTIVE_FAILURES_TO_BLOCK;
    goodStreak = 0;
    setPillState(null, "bad");
    setBlockedState(true);
    setOverlayPing(null);
    emitConnectivityEvent("dv:network-lost", { reason: "offline-event" });
  }

  document.addEventListener("visibilitychange", handleVisibility);
  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);

  return () => {
    clearInterval(pingTimer);
    document.removeEventListener("visibilitychange", handleVisibility);
    window.removeEventListener("online", handleOnline);
    window.removeEventListener("offline", handleOffline);
  };
}

/** Returns true when the latency is above the threshold (overlay is shown). */
export function isPingBlocked() {
  return blocked;
}
