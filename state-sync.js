import { apiUrl } from "./api-client.js";

const EMPTY_STATE = {
  leads: [],
  counselors: [],
  adminUsers: [],
  marketingUsers: [],
  allocation: [],
  tasks: []
};

let currentState = cloneValue(EMPTY_STATE);
let currentSession = null;
let bootstrapPromise = null;
let pendingStateUpdate = Promise.resolve();
const preferenceCache = new Map();
let lastStateRefreshAt = 0;
let lastSuccessfulMutationAt = 0;
let lastStateETag = null; // tracks the ETag returned by the last GET /api/state
// How long (ms) after a confirmed server write to suppress polling so a stale
// serverless-instance cache cannot revert a lead that was just updated.
const MUTATION_POLL_COOLDOWN_MS = 8000;
// Monotonically increasing counter — incremented each time an optimistic update
// is applied. Used to prevent an older PUT's server response from overwriting
// a newer optimistic state that was applied while the PUT was in flight.
let optimisticSeq = 0;
// How many times to retry a failed PUT before giving up.
const MAX_PUT_RETRIES = 3;
// Timeout for state mutation PUT requests. Longer than the read timeout to
// accommodate high-latency connections and larger JSON bodies.
const PUT_TIMEOUT_MS = 20000;
const HIDDEN_TAB_WARM_INTERVAL_MS = 45000;
const stateSubscribers = new Set();
const LEAD_UPDATE_BROADCAST_KEY = "dvLeadUpdatesBroadcast";
const LEAD_UPDATE_BROADCAST_CHANNEL = "dv-lead-updates";
let leadUpdateBroadcastChannel = null;

function notifyStateSubscribers() {
  const snapshot = getStateSnapshot();

  stateSubscribers.forEach((subscriber) => {
    try {
      subscriber(snapshot);
    } catch (error) {
      console.error("Failed to notify a state subscriber.", error);
    }
  });
}

function cloneValue(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}

function normalizeState(snapshot = {}) {
  return {
    leads: Array.isArray(snapshot?.leads) ? snapshot.leads : [],
    counselors: Array.isArray(snapshot?.counselors) ? snapshot.counselors : [],
    adminUsers: Array.isArray(snapshot?.adminUsers) ? snapshot.adminUsers : [],
    marketingUsers: Array.isArray(snapshot?.marketingUsers) ? snapshot.marketingUsers : [],    
    allocation: Array.isArray(snapshot?.allocation) ? snapshot.allocation : [],
    tasks: Array.isArray(snapshot?.tasks) ? snapshot.tasks : [],
    coursePriorities: Array.isArray(snapshot?.coursePriorities) ? snapshot.coursePriorities : [],
    updatedAt: snapshot?.updatedAt || null,
    clearedAt: snapshot?.clearedAt || null
  };
}

function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  return fetch(url, {
    ...options,
    credentials: "same-origin",
    signal: controller.signal
  }).finally(() => clearTimeout(timeoutId));
}

async function fetchJson(url, options = {}, timeoutMs = 10000) {
  const response = await fetchWithTimeout(apiUrl(url), options, timeoutMs);
  const contentType = response.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  const payload = isJson ? await response.json() : null;
  return { response, payload };
}

async function warmBackend() {
  const { response } = await fetchJson("/api/warm", {
    method: "GET",
    headers: { Accept: "application/json" }
  }, 10000);

  if (!response.ok) {
    throw new Error(`Warm request failed with HTTP ${response.status}`);
  }
}

function setCurrentState(snapshot) {
  currentState = normalizeState(snapshot);
  lastStateRefreshAt = Date.now();
  notifyStateSubscribers();
  return getStateSnapshot();
}

export function getStateSnapshot() {
  return cloneValue(currentState);
}

export function getStateField(field) {
  return cloneValue(currentState?.[field] ?? []);
}

export function getLeads() {
  return getStateField("leads");
}

export function getCounselors() {
  return getStateField("counselors");
}

export function getAdminUsers() {
  return getStateField("adminUsers");
}

export function getAllocation() {
  return getStateField("allocation");
}

export function getTasks() {
  return getStateField("tasks");
}

export function getCoursePriorities() {
  const val = getStateField("coursePriorities");
  return Array.isArray(val) && val.length ? val : [
    "days7_genai",
    "advanced-aiml-genai-agentic",
    "apcs",
    "apida",
    "apids",
    "forward-deployed-engineer",
    "master-genai-agentic",
    "data-analytics-specialist"
  ];
}

export function replaceStateSnapshot(snapshot) {
  return setCurrentState(snapshot);
}

export function acceptServerState(snapshot, etag = null) {
  if (etag) {
    lastStateETag = etag;
  }

  return setCurrentState(snapshot);
}

export function acceptLeadUpdates(leads, etag = null, updatedAt = null) {
  const nextLeads = (Array.isArray(leads) ? leads : [leads])
    .filter((lead) => lead && lead.id !== undefined && lead.id !== null);
  if (!nextLeads.length) {
    return getStateSnapshot();
  }

  if (etag) {
    lastStateETag = etag;
  }

  const byId = new Map(nextLeads.map((lead) => [String(lead.id), lead]));
  const currentLeads = Array.isArray(currentState.leads) ? currentState.leads : [];
  const seen = new Set();
  const mergedLeads = currentLeads.map((lead) => {
    const key = String(lead?.id);
    const patch = byId.get(key);
    if (!patch) {
      return lead;
    }
    seen.add(key);
    return { ...lead, ...patch };
  });

  nextLeads.forEach((lead) => {
    const key = String(lead.id);
    if (!seen.has(key)) {
      mergedLeads.push(lead);
    }
  });

  return setCurrentState({
    ...currentState,
    leads: mergedLeads,
    updatedAt: updatedAt || currentState.updatedAt
  });
}

export function broadcastLeadUpdates(leads, etag = null, updatedAt = null) {
  const nextLeads = (Array.isArray(leads) ? leads : [leads])
    .filter((lead) => lead && lead.id !== undefined && lead.id !== null);
  if (!nextLeads.length || typeof window === "undefined") {
    return;
  }

  const message = {
    leads: nextLeads,
    etag,
    updatedAt,
    sentAt: Date.now()
  };

  try {
    if (leadUpdateBroadcastChannel) {
      leadUpdateBroadcastChannel.postMessage(message);
    }
  } catch (_error) {
    // Storage fallback below still covers browsers where BroadcastChannel fails.
  }

  try {
    window.localStorage?.setItem(LEAD_UPDATE_BROADCAST_KEY, JSON.stringify(message));
  } catch (_error) {
    // Cross-tab sync is best effort; normal polling remains the fallback.
  }
}

function acceptBroadcastLeadUpdate(message = {}) {
  const leads = Array.isArray(message?.leads) ? message.leads : [];
  if (!leads.length) {
    return;
  }

  acceptLeadUpdates(leads, message?.etag || null, message?.updatedAt || null);
}

function initLeadUpdateBroadcastListener() {
  if (typeof window === "undefined") {
    return;
  }

  try {
    if ("BroadcastChannel" in window) {
      leadUpdateBroadcastChannel = new BroadcastChannel(LEAD_UPDATE_BROADCAST_CHANNEL);
      leadUpdateBroadcastChannel.onmessage = (event) => {
        acceptBroadcastLeadUpdate(event.data);
      };
    }
  } catch (_error) {
    leadUpdateBroadcastChannel = null;
  }

  window.addEventListener("storage", (event) => {
    if (event.key !== LEAD_UPDATE_BROADCAST_KEY || !event.newValue) {
      return;
    }

    try {
      acceptBroadcastLeadUpdate(JSON.parse(event.newValue));
    } catch (_error) {
      // Ignore malformed storage events; polling will recover the state.
    }
  });
}

initLeadUpdateBroadcastListener();

export async function refreshState() {
  const headers = { Accept: "application/json" };
  // Send the ETag from the previous response so the server can return 304 when
  // the state has not changed, saving the full payload transfer on every poll.
  if (lastStateETag) {
    headers["If-None-Match"] = lastStateETag;
  }

  const { response, payload } = await fetchJson("/api/state", {
    method: "GET",
    headers
  });

  // 304 Not Modified — state unchanged, keep what we have.
  if (response.status === 304) {
    lastStateRefreshAt = Date.now();
    return getStateSnapshot();
  }

  if (!response.ok) {
    throw new Error(payload?.message || "Failed to fetch state.");
  }

  // Capture the new ETag for the next conditional request.
  const etag = response.headers.get("etag");
  if (etag) lastStateETag = etag;

  return setCurrentState(payload);
}

async function refreshStateVersion() {
  const headers = { Accept: "application/json" };
  if (lastStateETag) {
    headers["If-None-Match"] = lastStateETag;
  }

  const { response, payload } = await fetchJson("/api/state/version", {
    method: "GET",
    headers
  });

  if (response.status === 304) {
    lastStateRefreshAt = Date.now();
    return {
      changed: false,
      updatedAt: currentState?.updatedAt || null
    };
  }

  if (!response.ok) {
    throw new Error(payload?.message || "Failed to fetch state version.");
  }

  const etag = response.headers.get("etag");
  const nextUpdatedAt = payload?.updatedAt || null;
  const changed = Boolean(etag && etag !== lastStateETag)
    || Boolean(nextUpdatedAt && nextUpdatedAt !== currentState?.updatedAt);

  if (etag) {
    lastStateETag = etag;
  }

  currentState = {
    ...currentState,
    updatedAt: nextUpdatedAt || currentState?.updatedAt || null,
    clearedAt: payload?.clearedAt ?? currentState?.clearedAt ?? null,
    admissionSopEnabled: payload?.admissionSopEnabled !== false,
    admissionSopEnabledAt: payload?.admissionSopEnabledAt ?? currentState?.admissionSopEnabledAt ?? null,
    admissionSopUpdatedBy: payload?.admissionSopUpdatedBy ?? currentState?.admissionSopUpdatedBy ?? ""
  };

  return {
    changed,
    updatedAt: nextUpdatedAt
  };
}

export async function updateStateFields(fields) {
  const nextFields = Object.fromEntries(
    Object.entries(fields || {}).filter(([, value]) => Array.isArray(value))
  );

  if (!Object.keys(nextFields).length) {
    return { ok: false, message: "No valid state fields provided." };
  }

  // Stamp this optimistic update with a monotonically increasing sequence number.
  // When the PUT response eventually arrives we only apply setCurrentState if no
  // newer optimistic update has been applied in the meantime — this prevents PUT#1's
  // response from overwriting a note/task that was applied optimistically while PUT#1
  // was still in flight.
  const mySeq = ++optimisticSeq;

  // Apply optimistically so subsequent reads and subscribers see the change immediately,
  // without waiting for the server round-trip. This eliminates the delay between a
  // counselor saving an activity and the table reflecting the update.
  setCurrentState({ ...currentState, ...nextFields });

  pendingStateUpdate = pendingStateUpdate.then(async () => {
    // Retry the PUT up to MAX_PUT_RETRIES times on transient network failures before
    // reverting optimistic state. On high-latency connections (>300 ms) transient
    // failures are common and a single attempt is not sufficient.
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_PUT_RETRIES; attempt++) {
      try {
        // keepalive: true ensures the browser sends this request to completion
        // even if the user navigates away or reloads the page before the response
        // arrives. Without this, page navigation mid-write silently drops the PUT.
        // Browsers reject keepalive requests whose body exceeds 64 KB — check the
        // serialised size directly instead of relying on new Request() which does
        // NOT throw synchronously for oversized bodies in Chrome/Edge.
        const body = JSON.stringify(nextFields);
        const useKeepalive = body.length < 60 * 1024; // conservative threshold below 64 KB
        const fetchOptions = {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            ...(lastStateETag ? { "If-Match": lastStateETag } : {})
          },
          body,
          ...(useKeepalive ? { keepalive: true } : {})
        };
        const { response, payload } = await fetchJson("/api/state", fetchOptions, PUT_TIMEOUT_MS);

        if (response.ok) {
          const etag = response.headers.get("etag");
          if (etag) {
            lastStateETag = etag;
          }
          // Only replace in-memory state with the server response if no newer
          // optimistic update has been applied after this one. If a newer update
          // is already in memory we must not overwrite it with an older snapshot.
          if (optimisticSeq === mySeq) {
            setCurrentState(payload);
          }
          // Record the time of this confirmed server write so the polling loop can
          // skip refreshState() during the cooldown window. This prevents a stale
          // in-memory cache on another Vercel serverless instance from overwriting
          // the update we just confirmed was persisted to MongoDB.
          lastSuccessfulMutationAt = Date.now();
          return { ok: true, payload: getStateSnapshot() };
        }

        if (response.status === 412) {
          try {
            await refreshState();
            // Re-apply the intended field update on top of the freshly loaded
            // authoritative state before retrying with the new ETag.
            setCurrentState({ ...currentState, ...nextFields });
            continue;
          } catch (refreshError) {
            return {
              ok: false,
              message: refreshError?.message || payload?.message || "State changed on the server. Reload the latest data and retry your update."
            };
          }
        }

        // 4xx errors are definitive failures — do not retry.
        if (response.status >= 400 && response.status < 500) {
          void refreshState().catch(() => undefined);
          return { ok: false, message: payload?.message || "Failed to update state." };
        }

        // 5xx — server-side error, retry after backoff.
        lastError = new Error(payload?.message || `Server error ${response.status}`);
      } catch (err) {
        // Network failure (timeout, abort, DNS, etc.) — retry.
        lastError = err;
      }

      if (attempt < MAX_PUT_RETRIES) {
        // Exponential backoff: 2 s, 4 s between retries.
        await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
      }
    }

    // All retries exhausted — revert to the authoritative server state so the UI
    // reflects what is actually persisted rather than showing an optimistic lie.
    void refreshState().catch(() => undefined);
    return { ok: false, message: lastError?.message || "Failed to update state after retries." };
  }).catch((error) => {
    // On network failure refresh to restore correct server state.
    void refreshState().catch(() => undefined);
    return { ok: false, message: error?.message || "Failed to update state." };
  });

  return pendingStateUpdate;
}

/**
 * Wait for all queued mutations to complete, then read back from the server
 * to confirm durable persistence.  Waits for the mutation poll-cooldown window
 * to expire first so we don't accidentally hit a stale serverless-instance
 * cache and mistake old data for the freshly written state.
 */
export async function syncStateFromLocalAndVerify() {
  try {
    await pendingStateUpdate;

    // If a mutation was confirmed recently, wait for the server-side cache TTL
    // (5 s) to expire before reading back.  This ensures the GET hits MongoDB
    // directly rather than a stale in-memory cache on a different serverless
    // instance that hasn't seen the write yet.
    const msSinceMutation = Date.now() - lastSuccessfulMutationAt;
    const SERVER_CACHE_TTL_MS = 5000;
    if (lastSuccessfulMutationAt > 0 && msSinceMutation < SERVER_CACHE_TTL_MS) {
      await new Promise((resolve) => setTimeout(resolve, SERVER_CACHE_TTL_MS - msSinceMutation + 200));
    }

    await refreshState();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error?.message || "Unable to confirm the backend update."
    };
  }
}

/**
 * Resolves once all currently-queued state mutation PUTs have settled.
 * Use this in navigation handlers to prevent a soft-nav refreshState() from
 * overwriting optimistic state that is still being written to the server.
 */
export async function awaitPendingMutations() {
  return pendingStateUpdate;
}

export async function refreshSession() {
  const { response, payload } = await fetchJson("/api/auth/session", {
    method: "GET",
    headers: {
      Accept: "application/json"
    }
  });

  if (response.status === 401) {
    currentSession = null;
    return null;
  }

  if (!response.ok) {
    throw new Error(payload?.message || "Failed to fetch session.");
  }

  currentSession = payload;
  return getSession();
}

export function getSession() {
  return currentSession ? cloneValue(currentSession) : null;
}

export async function login({ role, identifier, password, passcode = "" }) {
  const { response, payload } = await fetchJson("/api/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({ role, identifier, password, passcode })
  }, 20000);

  if (!response.ok) {
    return {
      ok: false,
      message: payload?.message || "Login failed.",
      requiresPasscode: payload?.requiresPasscode === true
    };
  }

  currentSession = payload?.session || null;
  return {
    ok: true,
    session: getSession(),
    landing: payload?.landing || "index.html"
  };
}

export async function logout() {
  await fetchWithTimeout("/api/auth/logout", {
    method: "POST",
    headers: {
      Accept: "application/json"
    }
  });

  currentSession = null;
  preferenceCache.clear();
}

export async function changeOwnPassword({ currentPassword, newPassword }) {
  const { response, payload } = await fetchJson("/api/auth/change-password", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({ currentPassword, newPassword })
  });

  if (!response.ok) {
    return { ok: false, message: payload?.message || "Failed to change password." };
  }

  return { ok: true };
}

export async function bootstrapLocalState(options = {}) {
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      const skipStateRefresh = options?.skipStateRefresh === true;
      const shouldRefreshState = !skipStateRefresh && (!lastStateRefreshAt || (Date.now() - lastStateRefreshAt) > 1500);

      await Promise.all([
        shouldRefreshState ? refreshState().catch(() => getStateSnapshot()) : Promise.resolve(getStateSnapshot()),
        refreshSession().catch(() => null)
      ]);
    })().finally(() => {
      bootstrapPromise = null;
    });
  }

  return bootstrapPromise;
}

export async function loadPersistedValue(key, fallback) {
  const scope = encodeURIComponent(String(key || "").trim());
  if (!scope) {
    return cloneValue(fallback);
  }

  if (preferenceCache.has(scope)) {
    return cloneValue(preferenceCache.get(scope));
  }

  const { response, payload } = await fetchJson(`/api/preferences/${scope}`, {
    method: "GET",
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    return cloneValue(fallback);
  }

  const value = payload?.value ?? cloneValue(fallback);
  preferenceCache.set(scope, cloneValue(value));
  return cloneValue(value);
}

export async function savePersistedValue(key, value) {
  const scope = encodeURIComponent(String(key || "").trim());
  if (!scope) {
    return { ok: false, message: "Preference scope is required." };
  }

  preferenceCache.set(scope, cloneValue(value));

  const { response, payload } = await fetchJson(`/api/preferences/${scope}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({ value })
  });

  if (!response.ok) {
    return { ok: false, message: payload?.message || "Failed to save preference." };
  }

  return { ok: true, value: payload?.value ?? value };
}

export async function loadLocalPreference(key, fallback) {
  const scope = String(key || "").trim();
  if (!scope || typeof window === "undefined" || !window.localStorage) {
    return cloneValue(fallback);
  }

  try {
    const rawValue = window.localStorage.getItem(`dvLocalPreference:${scope}`);
    if (rawValue == null) {
      return cloneValue(fallback);
    }
    return JSON.parse(rawValue);
  } catch (error) {
    console.warn("Failed to load local preference:", error);
    return cloneValue(fallback);
  }
}

export async function saveLocalPreference(key, value) {
  const scope = String(key || "").trim();
  if (!scope || typeof window === "undefined" || !window.localStorage) {
    return { ok: false, message: "Local preference scope is required." };
  }

  try {
    window.localStorage.setItem(`dvLocalPreference:${scope}`, JSON.stringify(value));
    return { ok: true, value };
  } catch (error) {
    console.warn("Failed to save local preference:", error);
    return { ok: false, message: "Failed to save local preference." };
  }
}

export async function saveLeads(leads) {
  return updateStateFields({ leads });
}

export async function saveCounselors(counselors) {
  const nextCounselors = Array.isArray(counselors) ? counselors : [];
  setCurrentState({ ...currentState, counselors: nextCounselors });

  try {
    const { response, payload } = await fetchJson("/api/counselors", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(nextCounselors)
    }, PUT_TIMEOUT_MS);

    if (!response.ok) {
      void refreshState().catch(() => undefined);
      return { ok: false, message: payload?.message || "Failed to save counselors." };
    }

    lastSuccessfulMutationAt = Date.now();
    await refreshState().catch(() => undefined);
    return { ok: true, payload: getStateSnapshot() };
  } catch (error) {
    void refreshState().catch(() => undefined);
    return { ok: false, message: error?.message || "Failed to save counselors." };
  }
}

export async function saveAdminUsers(adminUsers) {
  const nextAdminUsers = Array.isArray(adminUsers) ? adminUsers : [];
  setCurrentState({ ...currentState, adminUsers: nextAdminUsers });

  try {
    const { response, payload } = await fetchJson("/api/admin-users", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(nextAdminUsers)
    }, PUT_TIMEOUT_MS);

    if (!response.ok) {
      void refreshState().catch(() => undefined);
      return { ok: false, message: payload?.message || "Failed to save admin users." };
    }

    lastSuccessfulMutationAt = Date.now();
    await refreshState().catch(() => undefined);
    return { ok: true, payload: getStateSnapshot() };
  } catch (error) {
    void refreshState().catch(() => undefined);
    return { ok: false, message: error?.message || "Failed to save admin users." };
  }
}

export function getMarketingUsers() {
  return getStateField("marketingUsers");
}

export async function saveMarketingUsers(marketingUsers) {
  const nextMarketingUsers = Array.isArray(marketingUsers) ? marketingUsers : [];
  setCurrentState({ ...currentState, marketingUsers: nextMarketingUsers });

  try {
    const { response, payload } = await fetchJson("/api/marketing-users", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(nextMarketingUsers)
    }, PUT_TIMEOUT_MS);

    if (!response.ok) {
      void refreshState().catch(() => undefined);
      return { ok: false, message: payload?.message || "Failed to save marketing users." };
    }

    lastSuccessfulMutationAt = Date.now();
    await refreshState().catch(() => undefined);
    return { ok: true, payload: getStateSnapshot() };
  } catch (error) {
    void refreshState().catch(() => undefined);
    return { ok: false, message: error?.message || "Failed to save marketing users." };
  }
}

export async function saveAllocation(allocation) {
  const nextAllocation = Array.isArray(allocation) ? allocation : [];
  setCurrentState({ ...currentState, allocation: nextAllocation });

  try {
    const { response, payload } = await fetchJson("/api/allocation", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(nextAllocation)
    }, PUT_TIMEOUT_MS);

    if (!response.ok) {
      void refreshState().catch(() => undefined);
      return { ok: false, message: payload?.message || "Failed to save allocation." };
    }

    lastSuccessfulMutationAt = Date.now();
    await refreshState().catch(() => undefined);
    return { ok: true, payload: getStateSnapshot() };
  } catch (error) {
    void refreshState().catch(() => undefined);
    return { ok: false, message: error?.message || "Failed to save allocation." };
  }
}

export async function saveTasks(tasks) {
  return updateStateFields({ tasks });
}

export function startStatePolling(onRefresh, intervalMs = 15000) {
  if (typeof onRefresh !== "function") {
    return () => undefined;
  }

  stateSubscribers.add(onRefresh);

  let pollTimer = null;
  let activePoll = false;
  let destroyed = false;
  let lastWarmAt = 0;

  async function doPoll() {
    if (destroyed || activePoll) {
      return;
    }
    activePoll = true;
    try {
      // Capture the current pending-update promise so we can detect if new mutations
      // are queued while we are waiting.
      const pendingAtStart = pendingStateUpdate;
      await pendingAtStart;

      // If more mutations were queued while we were waiting, skip this poll cycle.
      // A stale GET response must not overwrite writes that are still in flight.
      if (pendingStateUpdate !== pendingAtStart) {
        return;
      }

      // If a mutation was confirmed recently, skip this poll.  On Vercel the
      // serverless function that handles GET /api/state may be a different
      // instance from the one that processed the PUT, and its in-memory cache
      // can still hold the pre-update state for up to SERVER_CACHE_TTL (10 s).
      // Suppressing polls for MUTATION_POLL_COOLDOWN_MS (20 s) ensures we
      // never hand a stale cache response back to the client and undo a lead
      // activity update that was already confirmed by the server.
      if (Date.now() - lastSuccessfulMutationAt < MUTATION_POLL_COOLDOWN_MS) {
        return;
      }

      const version = await refreshStateVersion();
      if (version.changed || !currentState?.updatedAt) {
        await refreshState();
      }
    } catch (_e) {
      // Ignore transient network errors — the next poll or navigation will recover.
    } finally {
      activePoll = false;
    }
  }

  function schedulePoll() {
    if (destroyed) {
      return;
    }
    pollTimer = setTimeout(() => {
      if (document.visibilityState !== "hidden") {
        void doPoll();
      } else if (Date.now() - lastWarmAt >= HIDDEN_TAB_WARM_INTERVAL_MS) {
        lastWarmAt = Date.now();
        void warmBackend().catch(() => undefined);
      }
      schedulePoll();
    }, intervalMs);
  }

  function handleVisibilityChange() {
    if (destroyed || document.visibilityState !== "visible") {
      return;
    }
    // Immediately refresh when the user tabs back so they always see current data.
    clearTimeout(pollTimer);
    doPoll().finally(() => {
      if (!destroyed) {
        schedulePoll();
      }
    });
  }

  function handleReconnect() {
    if (destroyed || typeof document === "undefined" || document.visibilityState === "hidden") {
      return;
    }

    clearTimeout(pollTimer);
    doPoll().finally(() => {
      if (!destroyed) {
        schedulePoll();
      }
    });
  }

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", handleVisibilityChange);
  }
  if (typeof window !== "undefined") {
    window.addEventListener("online", handleReconnect);
    window.addEventListener("dv:network-recovered", handleReconnect);
  }

  schedulePoll();

  return () => {
    destroyed = true;
    stateSubscribers.delete(onRefresh);
    clearTimeout(pollTimer);
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("online", handleReconnect);
      window.removeEventListener("dv:network-recovered", handleReconnect);
    }
  };
}
