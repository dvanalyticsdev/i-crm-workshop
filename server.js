require("dotenv").config();
const express    = require("express");
const path       = require("path");
const fs         = require("fs");
const crypto     = require("crypto");
const compress   = require("compression");
const { MongoClient } = require("mongodb");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT_DIR = __dirname;

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || "i-crm-workshop";
const MONGODB_STATE_COLLECTION = process.env.MONGODB_STATE_COLLECTION || "app_state";
const MONGODB_SESSION_COLLECTION = process.env.MONGODB_SESSION_COLLECTION || "user_sessions";
const MONGODB_PREFERENCE_COLLECTION = process.env.MONGODB_PREFERENCE_COLLECTION || "user_preferences";
const MONGODB_META_CONFIG_COLLECTION = process.env.MONGODB_META_CONFIG_COLLECTION || "meta_config";
const MONGODB_META_LOGS_COLLECTION = process.env.MONGODB_META_LOGS_COLLECTION || "meta_logs";
const MONGODB_META_RETRY_COLLECTION = process.env.MONGODB_META_RETRY_COLLECTION || "meta_retry_jobs";
const MONGODB_ELEMENTOR_CONFIG_COLLECTION = process.env.MONGODB_ELEMENTOR_CONFIG_COLLECTION || "elementor_config";
const MONGODB_ELEMENTOR_LOGS_COLLECTION = process.env.MONGODB_ELEMENTOR_LOGS_COLLECTION || "elementor_logs";
const MONGODB_ELEMENTOR_RETRY_COLLECTION = process.env.MONGODB_ELEMENTOR_RETRY_COLLECTION || "elementor_retry_jobs";
const MONGODB_MCUBE_CONFIG_COLLECTION = process.env.MONGODB_MCUBE_CONFIG_COLLECTION || "mcube_config";
const MONGODB_MCUBE_LOGS_COLLECTION = process.env.MONGODB_MCUBE_LOGS_COLLECTION || "mcube_logs";
const MONGODB_MCUBE_RETRY_COLLECTION = process.env.MONGODB_MCUBE_RETRY_COLLECTION || "mcube_retry_jobs";
const MONGODB_REACHOUT_CONFIG_COLLECTION = process.env.MONGODB_REACHOUT_CONFIG_COLLECTION || "reachout_config";
const MONGODB_REACHOUT_LOGS_COLLECTION = process.env.MONGODB_REACHOUT_LOGS_COLLECTION || "reachout_logs";
const MONGODB_REACHOUT_MEDIA_COLLECTION = process.env.MONGODB_REACHOUT_MEDIA_COLLECTION || "reachout_media";
const MONGODB_LSQ_ARCHIVE_COLLECTION = process.env.MONGODB_LSQ_ARCHIVE_COLLECTION || "lsq_archive_leads";
const META_WEBHOOK_FORWARD_URL = String(process.env.META_WEBHOOK_FORWARD_URL || "").trim();
const ADMIN_LOGIN_ID = String(process.env.ADMIN_LOGIN_ID || "").trim();
const ADMIN_LOGIN_PASSWORD = String(process.env.ADMIN_LOGIN_PASSWORD || "").trim();
const STATE_DOC_ID = "global";
const META_CONFIG_DOC_ID = "meta_integration";
const ELEMENTOR_CONFIG_DOC_ID = "elementor_integration";
const MCUBE_CONFIG_DOC_ID = "mcube_integration";
const REACHOUT_CONFIG_DOC_ID = "reachout_center";
const BACKUP_FORMAT = "dv-crm-manual-backup";
const BACKUP_VERSION = 1;
const MAX_META_LOGS = 200;
const MAX_ELEMENTOR_LOGS = 200;
const MAX_MCUBE_LOGS = 200;
const MAX_REACHOUT_LOGS = 500;
const SESSION_SCHEMA_VERSION = "2026-07-23-super-admin-v1";
const SESSION_COOKIE_NAME = "dvWorkshopSession";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FORWARDED_WEBHOOK_HEADER = "x-dv-webhook-forwarded";
const FORWARDED_WEBHOOK_SIGNATURE_HEADER = "x-dv-webhook-signature";
const META_LEAD_FETCH_TIMEOUT_MS = 20000;
const META_LEAD_FETCH_MAX_ATTEMPTS = 3;
const META_RETRY_JOB_MAX_ATTEMPTS = 10;
const ELEMENTOR_RETRY_JOB_MAX_ATTEMPTS = 10;
const MCUBE_RETRY_JOB_MAX_ATTEMPTS = 10;
const PUBLIC_COURSE_DEFAULT_SEGMENT = "standard";
const PUBLIC_COURSE_CRASH_SEGMENT = "crash-course";
const PUBLIC_COURSE_SEGMENT_CONFIG = {
  [PUBLIC_COURSE_DEFAULT_SEGMENT]: {
    routingScope: "public-course-routing",
    routingOwner: "system:public-course-routing",
    roundRobinField: "publicCourseRoundRobinIndex"
  },
  [PUBLIC_COURSE_CRASH_SEGMENT]: {
    routingScope: "public-course-routing:crash-course",
    routingOwner: "system:public-course-routing:crash-course",
    roundRobinField: "publicCourseCrashRoundRobinIndex"
  }
};
const MAIN_ADMISSION_PIPELINE = "main-admission";
const MAIN_ADMISSION_ROUND_ROBIN_FIELD = "mainAdmissionRoundRobinIndex";
const KOLKATA_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const LOST_LEAD_ARCHIVE_AFTER_MS = 24 * 60 * 60 * 1000;
const ADMISSION_SOP_NEW_WINDOW_MS = 48 * 60 * 60 * 1000;
const ADMISSION_SOP_ACTIVE_WINDOW_DAYS = 15;
const ADMISSION_SOP_OFFERED_WINDOW_DAYS = 30;
const PUBLIC_COURSE_CATALOG = [
  { id: "apids", code: "APIDS", name: "Advanced Program in Industrial Data Science & AI", duration: "6-8 Months" },
  { id: "apida", code: "APIDA", name: "Advanced Program in Industrial Data Analytics & AI", duration: "4-5 Months" },
  { id: "advanced-aiml-genai-agentic", code: "AIML + GenAI", name: "Advanced AIML with Gen AI & Agentic AI", duration: "4 Months" },
  { id: "master-genai-agentic", code: "GenAI Master", name: "Master Program in Gen AI & Agentic AI", duration: "3 Months" },
  { id: "data-analytics-specialist", code: "DAS", name: "Data Analytics Specialist", duration: "3 Months" },
  { id: "apcs", code: "APCS", name: "Advanced Program in Cybersecurity & Forensics", duration: "3-4 Months" },
  { id: "days7_genai", code: "7DAYS_GENAI", name: "7 Days Gen AI & Agentic AI Hands-on Master Program", duration: "7 Days" }
];

const COURSE_IDENTITY_RULES = [
  { pattern: /\bapids\b|\bindustrial data science\b|\badvanced program in industrial data science\b|\bdata science\b|\bdata scientist\b/i, label: "APIDS", key: "apids" },
  { pattern: /\bapida\b|\bindustrial data analytics\b|\badvanced program in industrial data analytics\b|\bdata analytics\b|\bdata analyst\b/i, label: "APIDA", key: "apida" },
  { pattern: /\b7\s*days?\b.*\b(gen\s*ai|agentic ai)\b|\b(gen\s*ai|agentic ai)\b.*\b7\s*days?\b|\b7days\b|\bdays7[_\s-]*genai\b|\bgen\s*ai\b.*\bcrash\s*course\b|\bcrash\s*course\b.*\b(gen\s*ai|agentic ai)\b/i, label: "7DAYS_GENAI", key: "days7_genai" },
  { pattern: /\badvanced\b.*\b(ai\s*\/?\s*ml|aiml)\b|\badv\b.*\b(ai\s*\/?\s*ml|aiml)\b|\bai\s*\/?\s*ml\b|\bartificial intelligence\b.*\bmachine learning\b|\baiml\b/i, label: "AIML + GenAI", key: "advanced-aiml-genai-agentic" },
  { pattern: /\bcyber\s*security\b|\bcybersecurity\b|\bcyber\s*ai\b|\bcyberai\b|\bapcs\b|\bforensics\b/i, label: "APCS", key: "apcs" },
  { pattern: /\bdata analytics specialist\b|\bdas\b/i, label: "DAS", key: "data-analytics-specialist" },
  { pattern: /\bmaster\b.*\bgen\s*ai\b|\bgen\s*ai\b.*\bmaster\b|\bgenai\s*master\b|\bagentic\b/i, label: "GenAI Master", key: "master-genai-agentic" }
];

const ADMIN_USER = {
  id: ADMIN_LOGIN_ID,
  password: ADMIN_LOGIN_PASSWORD,
  name: "Admin"
};

const AUTH_CONFIG_OWNER = "system:auth";
const AUTH_CONFIG_SCOPE = "super-admin";
const DEFAULT_SUPER_ADMIN_PASSCODE = "2817";
const PAGE_ACCESS_KEYS = [
  "dashboard",
  "leadBrowse",
  "claimRaised",
  "leadCreation",
  "admissionSop",
  "preWorkshop",
  "postWorkshop",
  "registeredCandidates",
  "mainAdmissionLeads",
  "taskTracker",
  "lostLeads",
  "monitoring",
  "counselorManagement",
  "leadControl",
  "metaIntegration",
  "elementorIntegration",
  "mcubeIntegration",
  "leadFlowControl",
  "reachout"
];
const FULL_PAGE_ACCESS = Object.freeze(Object.fromEntries(PAGE_ACCESS_KEYS.map((key) => [key, true])));
const COUNSELOR_DEFAULT_PAGE_ACCESS = Object.freeze({
  dashboard: true,
  leadBrowse: true,
  claimRaised: true,
  leadCreation: true,
  admissionSop: true,
  preWorkshop: true,
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
  reachout: true,
  postWorkshop: true
});
const MARKETING_DEFAULT_PAGE_ACCESS = Object.freeze({
  ...FULL_PAGE_ACCESS,
  counselorManagement: false,
  leadControl: false
});
const ADMIN_DEFAULT_PAGE_ACCESS = Object.freeze({
  ...FULL_PAGE_ACCESS,
  counselorManagement: true
});

function toKolkataDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function isIsoDateTimeString(value) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(String(value || "").trim());
}

function isDateOnlyString(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim());
}

function parseLeadCreatedTimeCandidate(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (isIsoDateTimeString(raw)) {
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatLeadCreatedDisplay(value) {
  const timestamp = parseLeadCreatedTimeCandidate(value);
  if (timestamp) {
    return new Date(timestamp).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      dateStyle: "medium",
      timeStyle: "short"
    });
  }
  return String(value || "Not available");
}

function buildAdminAuthVersion(password = ADMIN_USER.password) {
  return crypto
    .createHash("sha256")
    .update(`${ADMIN_USER.id}:${String(password || "").trim()}`)
    .digest("hex");
}

const DEFAULT_PERMISSIONS = {
  dashboard: false,
  leadCreation: true,
  preWorkshop: true,
  postWorkshop: true,
  taskTracker: true,
  lostLeads: true,
  monitoring: true
};

// ─── Ping FIRST — absolute minimal path, no auth, no JSON parsing overhead ───
// Registered before all middleware so the latency measurement is as accurate
// as possible and is not inflated by gzip, JSON body parsing, or static file
// lookups.  Keep this response tiny to avoid network serialisation skewing the
// round-trip time reading.
app.get("/api/ping", (_req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end('{"ok":true}');
});

app.get("/api/warm", async (_req, res) => {
  try {
    await initMongo();
    // Touch a tiny read so the Mongo path is exercised without the heavier
    // /api/state payload work.
    await metaConfigCollection.findOne(
      { _id: META_CONFIG_DOC_ID },
      { projection: { _id: 1 } }
    ).catch(() => undefined);
    await Promise.all([
      processPendingMetaRetryJobs({ limit: 3 }).catch(() => undefined),
      processPendingElementorRetryJobs({ limit: 3 }).catch(() => undefined),
      processPendingMcubeRetryJobs({ limit: 3 }).catch(() => undefined)
    ]);
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end('{"ok":true}');
  } catch (error) {
    res.status(500).json({ ok: false, message: "Warmup failed", details: error.message });
  }
});

app.get("/favicon.ico", (_req, res) => {
  res.status(204).end();
});

// Compress all responses ≥ 1 KB — dramatically reduces /api/state payload size.
app.use(compress({ threshold: 1024 }));
app.use("/api/meta/webhook", express.raw({
  type: "*/*",
  limit: "25mb",
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));
app.use("/api/mcube/webhook", express.raw({
  type: "*/*",
  limit: "5mb",
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));
app.use("/api/webhook/elementor-lead", express.urlencoded({
  extended: false,
  limit: "1mb"
}));
app.use(express.json({
  limit: "25mb",
  verify: (req, _res, buf) => {
    // Capture raw body for Meta webhook signature verification.
    if (req.originalUrl && req.originalUrl.startsWith("/api/meta/webhook")) {
      req.rawBody = buf;
    }
  }
}));
app.use(express.static(ROOT_DIR));

let stateCollection;
let sessionCollection;
let preferenceCollection;
let metaConfigCollection;
let metaLogsCollection;
let metaRetryCollection;
let elementorConfigCollection;
let elementorLogsCollection;
let elementorRetryCollection;
let mcubeConfigCollection;
let mcubeLogsCollection;
let mcubeRetryCollection;
let reachoutConfigCollection;
let reachoutLogsCollection;
let reachoutMediaCollection;
let leadsCollection;
let counselorsCollection;
let tasksCollection;
let allocationCollection;
let notificationsCollection;
let activityLogsCollection;
let leadClaimsCollection;
let leadCreationRequestsCollection;
let lsqArchiveCollection;

function logNotificationDebug(message, extra) {
  const payload = extra === undefined ? "" : ` ${JSON.stringify(extra)}`;
  console.log(`[notifications] ${message}${payload}`);
}
let mongoClient;
let mongoInitPromise;
let cachedStateDoc    = null;
let cachedStateDocAt  = 0;
let metaLogWriteCount = 0;
let leadStorageNormalizationPromise = null;
// Re-read from Mongo after 5 s so stale serverless instances pick up writes
// from other instances sooner. Shorter TTL reduces the window in which a
// concurrent GET can return stale data after a PUT on a different instance.
const STATE_CACHE_TTL_MS = 5000;

// In-process session cache — avoids a MongoDB round-trip on every authenticated
// request.  Entries expire after 60 s so a deleted/expired session is noticed
// within a minute without hammering the DB.
const SESSION_CACHE_TTL_MS = 60000;
const sessionCache = new Map(); // token → { session, role, adminAuthVersion, cachedAt }

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientMongoError(error) {
  const message = String(error?.message || "").toLowerCase();
  const name = String(error?.name || "").toLowerCase();

  return name === "mongodbnetworkerror" ||
    name === "mongoserverselectionerror" ||
    message.includes("server selection timed out") ||
    message.includes("connect timed out") ||
    message.includes("secureconnect") ||
    message.includes("socket") ||
    message.includes("connection") ||
    message.includes("econnreset") ||
    message.includes("etimedout");
}

async function resetMongoConnection() {
  mongoClient = null;
  mongoInitPromise = null;
  stateCollection = null;
  sessionCollection = null;
  preferenceCollection = null;
  metaConfigCollection = null;
  metaLogsCollection = null;
  metaRetryCollection = null;
  elementorConfigCollection = null;
  elementorLogsCollection = null;
  elementorRetryCollection = null;
  mcubeConfigCollection = null;
  mcubeLogsCollection = null;
  mcubeRetryCollection = null;
  reachoutConfigCollection = null;
  reachoutLogsCollection = null;
  reachoutMediaCollection = null;
  leadsCollection = null;
  counselorsCollection = null;
  tasksCollection = null;
  allocationCollection = null;
  notificationsCollection = null;
  activityLogsCollection = null;
  leadClaimsCollection = null;
  leadCreationRequestsCollection = null;
}

async function withMongoRetry(operation, { retries = 1, label = "MongoDB operation" } = {}) {
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      await initMongo();
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= retries || !isTransientMongoError(error)) {
        break;
      }

      await resetMongoConnection();
      await wait(250 * (attempt + 1));
    }
  }

  const err = new Error(`${label} failed: ${lastError?.message || "unknown error"}`);
  err.cause = lastError;
  throw err;
}

function getCachedSession(token) {
  const entry = sessionCache.get(token);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > SESSION_CACHE_TTL_MS) {
    sessionCache.delete(token);
    return null;
  }
  return entry;
}

function setCachedSession(token, session, options = {}) {
  sessionCache.set(token, {
    session,
    role: String(options.role || session?.role || "").trim().toLowerCase(),
    sessionSchemaVersion: String(options.sessionSchemaVersion || session?.sessionSchemaVersion || "").trim(),
    adminAuthVersion: String(options.adminAuthVersion || "").trim(),
    cachedAt: Date.now()
  });
}

function evictCachedSession(token) {
  sessionCache.delete(token);
}

function parseCookies(headerValue = "") {
  return headerValue
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .reduce((cookies, entry) => {
      const separatorIndex = entry.indexOf("=");
      if (separatorIndex === -1) {
        return cookies;
      }

      const key = entry.slice(0, separatorIndex).trim();
      const value = entry.slice(separatorIndex + 1).trim();
      cookies[key] = decodeURIComponent(value);
      return cookies;
    }, {});
}

function buildOwnerKey(session) {
  return `${String(session?.role || "guest").trim().toLowerCase()}:${String(session?.email || "anonymous").trim().toLowerCase()}`;
}

function sanitizeSession(session = {}) {
  return {
    role: String(session.role || "").trim(),
    name: String(session.name || "").trim(),
    email: String(session.email || "").trim().toLowerCase(),
    phone: String(session.phone || "").trim(),
    permissions: {
      ...FULL_PAGE_ACCESS,
      ...(session.permissions || {})
    },
    loginTime: session.loginTime || Date.now(),
    sessionSchemaVersion: String(session.sessionSchemaVersion || SESSION_SCHEMA_VERSION).trim()
  };
}

async function getSessionFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie || "");
  const token = String(cookies[SESSION_COOKIE_NAME] || "").trim();
  if (!token) {
    return null;
  }

  // Serve from in-process cache to avoid a MongoDB round-trip on every
  // authenticated API call (e.g. every 15 s state poll hits this path).
  const cached = getCachedSession(token);
  if (cached) {
    if (cached.sessionSchemaVersion !== SESSION_SCHEMA_VERSION) {
      sessionCache.delete(token);
      await sessionCollection.deleteOne({ token }).catch(() => undefined);
      return null;
    }
    if (cached.role === "super_admin") {
      const authConfig = await getAuthConfig();
      const activeAdminAuthVersion = buildAdminAuthVersion(authConfig.superAdminPassword);
      if (cached.adminAuthVersion !== activeAdminAuthVersion) {
        sessionCache.delete(token);
        await sessionCollection.deleteOne({ token }).catch(() => undefined);
        return null;
      }
    }
    return { token, session: cached.session };
  }

  const sessionDoc = await sessionCollection.findOne({
    token,
    expiresAt: { $gt: new Date().toISOString() }
  });

  if (!sessionDoc) {
    return null;
  }

  if (String(sessionDoc.sessionSchemaVersion || "").trim() !== SESSION_SCHEMA_VERSION) {
    await sessionCollection.deleteOne({ token }).catch(() => undefined);
    return null;
  }

  if (String(sessionDoc.role || "").trim().toLowerCase() === "super_admin") {
    const authConfig = await getAuthConfig();
    const activeAdminAuthVersion = buildAdminAuthVersion(authConfig.superAdminPassword);
    const storedAdminAuthVersion = String(sessionDoc.adminAuthVersion || "").trim();
    if (!storedAdminAuthVersion || storedAdminAuthVersion !== activeAdminAuthVersion) {
      sessionCache.delete(token);
      await sessionCollection.deleteOne({ token }).catch(() => undefined);
      return null;
    }
  }

  const session = sanitizeSession(sessionDoc);
  setCachedSession(token, session, {
    role: sessionDoc.role,
    sessionSchemaVersion: sessionDoc.sessionSchemaVersion,
    adminAuthVersion: sessionDoc.adminAuthVersion
  });
  return { token, session };
}

async function persistSession(res, session) {
  const token = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
  const normalized = sanitizeSession(session);
  const authConfig = normalized.role === "super_admin" ? await getAuthConfig() : null;
  const adminAuthVersion = normalized.role === "super_admin"
    ? buildAdminAuthVersion(authConfig?.superAdminPassword)
    : "";

  await sessionCollection.insertOne({
    token,
    ...normalized,
    ...(normalized.role === "super_admin" ? { adminAuthVersion } : {}),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt
  });

  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: SESSION_TTL_MS,
    path: "/"
  });

  return normalized;
}

function normalizeStateDoc(state = {}) {
  return {
    _id: STATE_DOC_ID,
    leads: Array.isArray(state.leads) ? state.leads : [],
    counselors: Array.isArray(state.counselors) ? state.counselors : [],
    adminUsers: Array.isArray(state.adminUsers) ? state.adminUsers : [],
    marketingUsers: Array.isArray(state.marketingUsers) ? state.marketingUsers : [],
    allocation: Array.isArray(state.allocation) ? state.allocation : [],
    tasks: Array.isArray(state.tasks) ? state.tasks : [],
    createdAt: state.createdAt || new Date().toISOString(),
    updatedAt: state.updatedAt || new Date().toISOString(),
    clearedAt: state.clearedAt || null
  };
}

function cacheStateDoc(state) {
  cachedStateDoc = normalizeStateDoc(state);
  cachedStateDocAt = Date.now();
  return cachedStateDoc;
}

function buildStateResponse(state) {
  const normalized = normalizeStateDoc(state);
  return {
    leads: normalized.leads,
    counselors: normalized.counselors,
    adminUsers: normalized.adminUsers,
    marketingUsers: normalized.marketingUsers,
    allocation: normalized.allocation,
    tasks: normalized.tasks,
    updatedAt: normalized.updatedAt || null,
    clearedAt: normalized.clearedAt || null
  };
}

function buildStateEtag(state) {
  return `"${state?.updatedAt || "init"}"`.replace(/\s/g, "_");
}

function buildStateVersionResponse(state) {
  const normalized = normalizeStateDoc(state);
  return {
    updatedAt: normalized.updatedAt || null,
    clearedAt: normalized.clearedAt || null,
    etag: buildStateEtag(normalized),
    counts: {
      leads: Array.isArray(normalized.leads) ? normalized.leads.length : 0,
      counselors: Array.isArray(normalized.counselors) ? normalized.counselors.length : 0,
      adminUsers: Array.isArray(normalized.adminUsers) ? normalized.adminUsers.length : 0,
      tasks: Array.isArray(normalized.tasks) ? normalized.tasks.length : 0,
      allocation: Array.isArray(normalized.allocation) ? normalized.allocation.length : 0
    }
  };
}

function isDashboardExcludedPipeline(lead) {
  return false;
}

function parseDateKeyToTime(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const parsed = new Date(raw).getTime();
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  const [year, month, day] = raw.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day).getTime();
}

function normalizeDashboardDateKey(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return toKolkataDateKey(parsed);
}

function buildDashboardSummary(state) {
  const leads = (Array.isArray(state?.leads) ? state.leads : []).filter((lead) => !isDashboardExcludedPipeline(lead));
  const workshopLeadCount = new Map();
  let latestLeadTimestamp = null;

  leads.forEach((lead) => {
    const dateValue = parseDateKeyToTime(lead?.createdAt || lead?.createdAtExact);
    if (dateValue !== null && (latestLeadTimestamp === null || dateValue > latestLeadTimestamp)) {
      latestLeadTimestamp = dateValue;
    }

    const workshopName = String(
      lead?.workshop ||
      lead?.workshopName ||
      lead?.admissionWorkshop ||
      lead?.courseName ||
      ""
    ).trim();

    if (!workshopName) {
      return;
    }

    workshopLeadCount.set(workshopName, (workshopLeadCount.get(workshopName) || 0) + 1);
  });

  const workshopEntries = Array.from(workshopLeadCount.entries())
    .map(([name, leadCount]) => ({ name, leadCount }))
    .sort((left, right) => right.leadCount - left.leadCount || left.name.localeCompare(right.name));

  return {
    updatedAt: state?.updatedAt || null,
    latestLeadDate: latestLeadTimestamp === null ? null : new Date(latestLeadTimestamp).toISOString(),
    totals: {
      activeWorkshops: workshopEntries.length,
      upcomingWorkshops: 0,
      recentWorkshops: workshopEntries.slice(0, 10).length,
      scopedLeads: leads.length
    },
    leadTimelineRows: leads.map((lead) => ({
      createdAt: normalizeDashboardDateKey(lead?.createdAt || lead?.createdAtExact),
      workshop: String(lead?.workshop || lead?.workshopName || "").trim(),
      admissionWorkshop: String(lead?.admissionWorkshop || lead?.courseName || lead?.workshop || "").trim(),
      stage: inferLeadStageForCallUpdate(lead).stage,
      leadPipeline: String(lead?.leadPipeline || "").trim().toLowerCase(),
      publicCourseSegment: normalizePublicCourseSegment(lead?.publicCourseSegment || getPublicCourseSegment(lead)),
      admissionStatus: String(lead?.admissionStatus || "").trim(),
      registeredAdmissionStatus: String(lead?.registeredAdmissionStatus || "").trim(),
      mainAdmissionAdmissionStatus: String(lead?.mainAdmissionAdmissionStatus || "").trim()
    })).filter((lead) => lead.createdAt),
    workshopBreakdown: workshopEntries.slice(0, 25),
    trend: leads.reduce((accumulator, lead) => {
      const dateKey = normalizeDashboardDateKey(lead?.createdAt || lead?.createdAtExact);
      if (dateKey) {
        accumulator[dateKey] = (accumulator[dateKey] || 0) + 1;
      }
      return accumulator;
    }, {})
  };
}

function buildMonitoringSummary(state) {
  const leads = Array.isArray(state?.leads) ? state.leads : [];
  const counselors = Array.isArray(state?.counselors) ? state.counselors : [];
  const counts = {
    workshopCalling: 0,
    admissionCalling: 0,
    mainAdmission: 0,
    registeredCandidates: 0,
    crashCourse: 0,
    lostLeads: 0
  };

  leads.forEach((lead) => {
    const pipeline = String(lead?.leadPipeline || "").trim().toLowerCase();
    const admissionStatus = String(lead?.admissionStatus || lead?.mainAdmissionAdmissionStatus || lead?.registeredAdmissionStatus || "").trim().toLowerCase();
    if (admissionStatus === "not interested" || admissionStatus === "not joined" || admissionStatus === "closed") {
      counts.lostLeads += 1;
    }
    if (pipeline === MAIN_ADMISSION_PIPELINE) {
      counts.mainAdmission += 1;
      return;
    }
    if (pipeline === "course-registration") {
      if (String(lead?.courseName || "").toLowerCase().includes("7 days")) {
        counts.crashCourse += 1;
      } else {
        counts.registeredCandidates += 1;
      }
      return;
    }
    counts.workshopCalling += 1;
    if (lead?.postStatusUpdated || lead?.admissionStatus || lead?.postDialed || lead?.courseStatus) {
      counts.admissionCalling += 1;
    }
  });

  return {
    updatedAt: state?.updatedAt || null,
    counts,
    activeCounselors: counselors.filter((counselor) => !counselor?.disabled).length
  };
}

function serializeBackupValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => serializeBackupValue(item));
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value && typeof value?.toHexString === "function") {
    return value.toHexString();
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, serializeBackupValue(item)])
    );
  }

  return value;
}

function normalizeBackupDoc(doc = {}, fallbackId = null) {
  const normalized = serializeBackupValue(doc);
  if (fallbackId && !normalized?._id) {
    normalized._id = fallbackId;
  }
  return normalized;
}

function normalizeBackupDocArray(docs = []) {
  return (Array.isArray(docs) ? docs : []).map((doc) => normalizeBackupDoc(doc));
}

async function buildBackupPayload() {
  const [
    state,
    preferences,
    metaConfig,
    metaLogs,
    metaRetryJobs,
    elementorConfig,
    elementorLogs,
    elementorRetryJobs,
    mcubeConfig,
    mcubeLogs,
    mcubeRetryJobs,
    lsqArchiveLeads
  ] = await Promise.all([
    getStateDoc(),
    preferenceCollection.find({}).toArray(),
    metaConfigCollection.findOne({ _id: META_CONFIG_DOC_ID }),
    metaLogsCollection.find({}).sort({ receivedAt: 1 }).toArray(),
    metaRetryCollection.find({}).sort({ createdAt: 1 }).toArray(),
    elementorConfigCollection.findOne({ _id: ELEMENTOR_CONFIG_DOC_ID }),
    elementorLogsCollection.find({}).sort({ receivedAt: 1 }).toArray(),
    elementorRetryCollection.find({}).sort({ createdAt: 1 }).toArray(),
    mcubeConfigCollection.findOne({ _id: MCUBE_CONFIG_DOC_ID }),
    mcubeLogsCollection.find({}).sort({ receivedAt: 1 }).toArray(),
    mcubeRetryCollection.find({}).sort({ createdAt: 1 }).toArray(),
    lsqArchiveCollection.find({}).sort({ importedAt: -1 }).toArray()
  ]);

  const stateDoc = normalizeStateDoc(state);
  const payload = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    database: {
      name: MONGODB_DB_NAME,
      stateCollection: MONGODB_STATE_COLLECTION,
      preferenceCollection: MONGODB_PREFERENCE_COLLECTION,
      metaConfigCollection: MONGODB_META_CONFIG_COLLECTION,
      metaLogsCollection: MONGODB_META_LOGS_COLLECTION,
      metaRetryCollection: MONGODB_META_RETRY_COLLECTION,
      elementorConfigCollection: MONGODB_ELEMENTOR_CONFIG_COLLECTION,
      elementorLogsCollection: MONGODB_ELEMENTOR_LOGS_COLLECTION,
      elementorRetryCollection: MONGODB_ELEMENTOR_RETRY_COLLECTION,
      mcubeConfigCollection: MONGODB_MCUBE_CONFIG_COLLECTION,
      mcubeLogsCollection: MONGODB_MCUBE_LOGS_COLLECTION,
      mcubeRetryCollection: MONGODB_MCUBE_RETRY_COLLECTION,
      lsqArchiveCollection: MONGODB_LSQ_ARCHIVE_COLLECTION
    },
    summary: {
      leads: stateDoc.leads.length,
      counselors: stateDoc.counselors.length,
      marketingUsers: stateDoc.marketingUsers.length,
      allocationRules: stateDoc.allocation.length,
      tasks: stateDoc.tasks.length,
      preferences: preferences.length,
      metaLogs: metaLogs.length,
      metaRetryJobs: metaRetryJobs.length,
      elementorLogs: elementorLogs.length,
      elementorRetryJobs: elementorRetryJobs.length,
      mcubeLogs: mcubeLogs.length,
      mcubeRetryJobs: mcubeRetryJobs.length,
      lsqArchiveLeads: lsqArchiveLeads.length
    },
    snapshot: {
      state: stateDoc,
      preferences: normalizeBackupDocArray(preferences),
      metaConfig: metaConfig ? normalizeBackupDoc(metaConfig, META_CONFIG_DOC_ID) : null,
      metaLogs: normalizeBackupDocArray(metaLogs),
      metaRetryJobs: normalizeBackupDocArray(metaRetryJobs),
      elementorConfig: elementorConfig ? normalizeBackupDoc(elementorConfig, ELEMENTOR_CONFIG_DOC_ID) : null,
      elementorLogs: normalizeBackupDocArray(elementorLogs),
      elementorRetryJobs: normalizeBackupDocArray(elementorRetryJobs),
      mcubeConfig: mcubeConfig ? normalizeBackupDoc(mcubeConfig, MCUBE_CONFIG_DOC_ID) : null,
      mcubeLogs: normalizeBackupDocArray(mcubeLogs),
      mcubeRetryJobs: normalizeBackupDocArray(mcubeRetryJobs),
      lsqArchiveLeads: normalizeBackupDocArray(lsqArchiveLeads)
    }
  };

  return payload;
}

function validateBackupPayload(payload = {}) {
  if (!payload || payload.format !== BACKUP_FORMAT) {
    return { ok: false, message: "Backup file format is not supported." };
  }

  if (Number(payload.version) !== BACKUP_VERSION) {
    return { ok: false, message: "Backup file version is not supported." };
  }

  const snapshot = payload.snapshot;
  if (!snapshot || typeof snapshot !== "object") {
    return { ok: false, message: "Backup snapshot is missing." };
  }

  const state = snapshot.state;
  if (!state || typeof state !== "object") {
    return { ok: false, message: "Backup state is missing." };
  }

  const normalizedState = normalizeStateDoc({
    ...state,
    _id: STATE_DOC_ID
  });

  const preferences = normalizeBackupDocArray(snapshot.preferences);
  const metaLogs = normalizeBackupDocArray(snapshot.metaLogs);
  const metaRetryJobs = normalizeBackupDocArray(snapshot.metaRetryJobs);
  const elementorLogs = normalizeBackupDocArray(snapshot.elementorLogs);
  const elementorRetryJobs = normalizeBackupDocArray(snapshot.elementorRetryJobs);
  const mcubeLogs = normalizeBackupDocArray(snapshot.mcubeLogs);
  const mcubeRetryJobs = normalizeBackupDocArray(snapshot.mcubeRetryJobs);
  const lsqArchiveLeads = normalizeBackupDocArray(snapshot.lsqArchiveLeads);
  const metaConfig = snapshot.metaConfig
    ? normalizeBackupDoc(snapshot.metaConfig, META_CONFIG_DOC_ID)
    : null;
  const elementorConfig = snapshot.elementorConfig
    ? normalizeBackupDoc(snapshot.elementorConfig, ELEMENTOR_CONFIG_DOC_ID)
    : null;
  const mcubeConfig = snapshot.mcubeConfig
    ? normalizeBackupDoc(snapshot.mcubeConfig, MCUBE_CONFIG_DOC_ID)
    : null;

  return {
    ok: true,
    snapshot: {
      state: normalizedState,
      preferences,
      metaConfig,
      metaLogs,
      metaRetryJobs,
      elementorConfig,
      elementorLogs,
      elementorRetryJobs,
      mcubeConfig,
      mcubeLogs,
      mcubeRetryJobs,
      lsqArchiveLeads
    }
  };
}

function normalizeLsqValue(value) {
  return String(value ?? "").trim();
}

function normalizeLsqPhone(value) {
  return normalizeLsqValue(value).replace(/\D+/g, "");
}

function parseLsqDateTime(value) {
  const raw = normalizeLsqValue(value);
  if (!raw) {
    return null;
  }

  const isoMs = Date.parse(raw);
  if (Number.isFinite(isoMs)) {
    return new Date(isoMs).toISOString();
  }

  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2}):(\d{2})\s*([AP]M)$/i);
  if (!match) {
    return null;
  }

  let [, year, month, day, hour, minute, second, meridian] = match;
  let normalizedHour = Number(hour) % 12;
  if (String(meridian).toUpperCase() === "PM") {
    normalizedHour += 12;
  }

  return new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    normalizedHour,
    Number(minute),
    Number(second)
  ).toISOString();
}

function getLsqFirstValue(row = {}, keys = []) {
  for (const key of keys) {
    const value = normalizeLsqValue(row?.[key]);
    if (value) {
      return value;
    }
  }
  return "";
}

function normalizeLsqToken(value) {
  return normalizeLsqValue(value).toLowerCase().replace(/[_-]+/g, " ");
}

function buildLsqSourceSnapshot(row = {}) {
  return {
    prospectId: normalizeLsqValue(row["Prospect ID"]),
    leadNumber: normalizeLsqValue(row["Lead Number"]),
    owner: normalizeLsqValue(row.Owner),
    ownerEmail: normalizeLsqValue(row["Owner Email"]).toLowerCase(),
    leadStage: normalizeLsqValue(row["Lead Stage"]),
    leadOutcome: normalizeLsqValue(row["Lead outcome"]),
    outcome: normalizeLsqValue(row.Outcome),
    subStatus: normalizeLsqValue(row["Sub Status"]),
    offeredAt: normalizeLsqValue(row["Offered At"]),
    tasksOn: normalizeLsqValue(row["Tasks on"]),
    taskNature: normalizeLsqValue(row["Task Nature"]),
    taskType: normalizeLsqValue(row["Task Type"]),
    lastActivity: normalizeLsqValue(row["Last Activity"]),
    lastActivityDate: parseLsqDateTime(row["Last Activity Date"]),
    recentlyModifiedOn: parseLsqDateTime(row["Recently Modified On"]),
    modifiedOn: parseLsqDateTime(row["Modified On"]),
    createdOn: parseLsqDateTime(row["Created On"]),
    program: getLsqFirstValue(row, ["Program", "Course"]),
    leadStageChangedTo: normalizeLsqValue(row["Lead Stage Changed To"])
  };
}

function recordMatchesLsqCounselorFilter(record = {}, counselorFilter = "all") {
  const normalizedFilter = normalizeLsqValue(counselorFilter).toLowerCase();
  if (!normalizedFilter || normalizedFilter === "all") {
    return true;
  }

  const ownerEmail = normalizeLsqValue(record?.sourceSnapshot?.ownerEmail).toLowerCase();
  const ownerName = normalizeLsqValue(record?.sourceSnapshot?.owner).toLowerCase();
  return ownerEmail === normalizedFilter || ownerName === normalizedFilter;
}

function recordMatchesLsqStageFilter(record = {}, stageFilter = "all") {
  const normalizedFilter = normalizeLsqValue(stageFilter).toLowerCase();
  if (!normalizedFilter || normalizedFilter === "all") {
    return true;
  }

  const leadStage = normalizeLsqValue(record?.sourceSnapshot?.leadStage).toLowerCase();
  return leadStage === normalizedFilter;
}

function resolveLsqCounselorName(state = {}, record = {}, counselorFilter = "all") {
  const counselors = Array.isArray(state?.counselors) ? state.counselors : [];
  const ownerEmail = normalizeLsqValue(record?.sourceSnapshot?.ownerEmail).toLowerCase();
  const ownerName = normalizeLsqValue(record?.sourceSnapshot?.owner).toLowerCase();
  const normalizedFilter = normalizeLsqValue(counselorFilter).toLowerCase();

  const byEmail = ownerEmail
    ? counselors.find((item) => normalizeLsqValue(item?.email).toLowerCase() === ownerEmail)
    : null;
  if (byEmail?.name) {
    return String(byEmail.name).trim();
  }

  const byName = ownerName
    ? counselors.find((item) => normalizeLsqValue(item?.name).toLowerCase() === ownerName)
    : null;
  if (byName?.name) {
    return String(byName.name).trim();
  }

  const fuzzyMatches = ownerName
    ? counselors.filter((item) => {
        const candidate = normalizeLsqValue(item?.name).toLowerCase();
        if (!candidate) {
          return false;
        }
        return candidate.includes(ownerName) || ownerName.includes(candidate);
      })
    : [];
  if (fuzzyMatches.length === 1 && fuzzyMatches[0]?.name) {
    return String(fuzzyMatches[0].name).trim();
  }

  if (normalizedFilter && normalizedFilter !== "all") {
    const filteredCounselor = counselors.find((item) => {
      const email = normalizeLsqValue(item?.email).toLowerCase();
      const name = normalizeLsqValue(item?.name).toLowerCase();
      return email === normalizedFilter || name === normalizedFilter;
    });
    if (filteredCounselor?.name) {
      return String(filteredCounselor.name).trim();
    }
  }

  return "Unassigned";
}

function mapLsqAdmissionStatus(row = {}) {
  const tokens = [
    row["Lead Stage"],
    row["Lead outcome"],
    row.Outcome,
    row["Sub Status"],
    row["Last Activity"],
    row["Task Type"]
  ].map(normalizeLsqToken).filter(Boolean).join(" | ");

  if (!tokens) {
    return "";
  }
  if (tokens.includes("offered")) {
    return "Offered";
  }
  if (tokens.includes("opportunity")) {
    return "Opportunity";
  }
  if (tokens.includes("enrolled")) {
    return "Enrolled";
  }
  if (tokens.includes("won") || tokens.includes("joined")) {
    return "Won";
  }
  if (
    tokens.includes("interested")
    || tokens.includes("shared details")
    || tokens.includes("lead called")
    || tokens.includes("phone call")
    || tokens.includes("follow up")
    || tokens.includes("in conversation")
  ) {
    return "In-Conversation";
  }
  return "";
}

function mapLsqCourseStatus(row = {}) {
  const tokens = [
    row["Lead Stage"],
    row["Lead outcome"],
    row.Outcome,
    row["Sub Status"]
  ].map(normalizeLsqToken).filter(Boolean).join(" | ");

  if (!tokens) {
    return "";
  }
  if (
    tokens.includes("dnp")
    || tokens.includes("no response")
    || tokens.includes("not interested")
    || tokens.includes("not shared details")
    || tokens.includes("rejected")
    || tokens.includes("lost")
  ) {
    return "Not Interested";
  }
  if (
    tokens.includes("interested")
    || tokens.includes("shared details")
    || tokens.includes("opportunity")
    || tokens.includes("offered")
    || tokens.includes("enrolled")
    || tokens.includes("won")
  ) {
    return "Interested";
  }
  return "";
}

function buildLsqNormalizedRecord(row = {}, sourceFileName = "") {
  const firstName = normalizeLsqValue(row["First Name"]);
  const lastName = normalizeLsqValue(row["Last Name"]);
  const name = getLsqFirstValue(row, ["Lead Name"]) || [firstName, lastName].filter(Boolean).join(" ");
  const sourceSnapshot = buildLsqSourceSnapshot(row);
  const updatedAt = sourceSnapshot.lastActivityDate
    || sourceSnapshot.recentlyModifiedOn
    || sourceSnapshot.modifiedOn
    || sourceSnapshot.createdOn
    || new Date().toISOString();

  return {
    name,
    email: normalizeLsqValue(row.Email).toLowerCase(),
    phone: normalizeLsqPhone(getLsqFirstValue(row, ["Phone Number", "Mobile Number", "Whatsapp Number"])),
    courseName: sourceSnapshot.program,
    sourceFileName: normalizeLsqValue(sourceFileName),
    city: normalizeLsqValue(row.City),
    state: normalizeLsqValue(row.State),
    country: normalizeLsqValue(row.Country),
    callStatus: getLsqFirstValue(row, ["Task Type", "Task Nature", "Last Activity"]),
    admissionStatus: mapLsqAdmissionStatus(row),
    courseStatus: mapLsqCourseStatus(row),
    dialed: /phone call|call/i.test(
      [row["Last Activity"], row["Task Type"], row["Task Nature"]].map(normalizeLsqValue).join(" ")
    ) ? "Yes" : "",
    updatedAt,
    sourceSnapshot
  };
}

function isLsqClosedOrOutOfScope(record = {}) {
  const statusToken = normalizeLsqToken(record.admissionStatus || record.sourceSnapshot?.leadStage || "");
  const courseToken = normalizeLsqToken(record.courseStatus);
  const rawToken = [
    record.sourceSnapshot?.leadOutcome,
    record.sourceSnapshot?.outcome,
    record.sourceSnapshot?.subStatus,
    record.sourceSnapshot?.leadStage
  ].map(normalizeLsqToken).join(" | ");

  return statusToken.includes("lost")
    || statusToken.includes("rejected")
    || statusToken.includes("closed")
    || courseToken.includes("not interested")
    || rawToken.includes("dnp")
    || rawToken.includes("no response")
    || rawToken.includes("not shared details")
    || rawToken.includes("rejected")
    || rawToken.includes("lost");
}

function evaluateLsqSop(existingLead, record = {}) {
  if (!record.email && !record.phone) {
    return { inSop: false, reason: "Missing email and phone in LSQ row." };
  }
  if (isLsqClosedOrOutOfScope(record)) {
    return { inSop: false, reason: "Lead is closed, rejected, lost, or not interested in LSQ." };
  }

  const progressAt = Date.parse(record.updatedAt || "");
  if (!Number.isFinite(progressAt)) {
    return { inSop: true, reason: "" };
  }

  const now = Date.now();
  const normalizedAdmissionStatus = normalizeLsqToken(record.admissionStatus);
  const windowDays = normalizedAdmissionStatus === "opportunity" || normalizedAdmissionStatus === "offered"
    ? ADMISSION_SOP_OFFERED_WINDOW_DAYS
    : ADMISSION_SOP_ACTIVE_WINDOW_DAYS;

  if (now - progressAt > windowDays * 24 * 60 * 60 * 1000) {
    return { inSop: false, reason: `Lead is outside the ${windowDays}-day SOP activity window.` };
  }

  return { inSop: true, reason: "" };
}

function getLsqLeadStageConfig() {
  return {
    dialedField: "mainAdmissionDialed",
    courseField: "mainAdmissionCoursePitched",
    courseStatusField: "mainAdmissionCourseStatus",
    admissionStatusField: "mainAdmissionAdmissionStatus",
    callStatusField: "mainAdmissionCallStatus",
    updatedFlagField: "mainAdmissionActivityUpdated",
    historyField: "mainAdmissionActivityHistory"
  };
}

function buildLsqUpdatedLead(existingLead, record = {}, counselorName = "") {
  const config = getLsqLeadStageConfig();
  const existingHistory = Array.isArray(existingLead?.[config.historyField]) ? existingLead[config.historyField] : [];
  const nextLead = {
    ...existingLead,
    city: record.city || existingLead.city || "",
    state: record.state || existingLead.state || "",
    country: record.country || existingLead.country || "",
    updatedAt: new Date().toISOString(),
    leadPipeline: MAIN_ADMISSION_PIPELINE,
    publicCourseSegment: "",
    counselor: String(counselorName || existingLead.counselor || "Unassigned").trim() || "Unassigned",
    admissionSopLastProgressAt: record.updatedAt || existingLead.admissionSopLastProgressAt || "",
    lsqLastImportedAt: new Date().toISOString(),
    mainAdmissionActivityUpdates: existingHistory.length + 1,
    lsqSourceSnapshot: {
      ...(existingLead.lsqSourceSnapshot && typeof existingLead.lsqSourceSnapshot === "object" ? existingLead.lsqSourceSnapshot : {}),
      ...record.sourceSnapshot,
      sourceFileName: record.sourceFileName
    }
  };

  if (record.courseName) {
    nextLead.courseName = record.courseName;
    nextLead.courseRawName = record.courseName;
    nextLead[config.courseField] = record.courseName;
  }
  if (record.courseStatus) {
    nextLead[config.courseStatusField] = record.courseStatus;
  }
  if (record.admissionStatus) {
    nextLead[config.admissionStatusField] = record.admissionStatus;
  }
  if (record.callStatus) {
    nextLead[config.callStatusField] = record.callStatus;
  }
  if (record.dialed) {
    nextLead[config.dialedField] = record.dialed;
  }
  nextLead[config.updatedFlagField] = true;

  nextLead[config.historyField] = existingHistory.concat({
    at: new Date().toISOString(),
    source: "LeadSquared Import",
    by: "system:lsq-import",
    updates: {
      [config.courseField]: nextLead[config.courseField] || "",
      [config.courseStatusField]: nextLead[config.courseStatusField] || "",
      [config.admissionStatusField]: nextLead[config.admissionStatusField] || "",
      [config.callStatusField]: nextLead[config.callStatusField] || "",
      [config.dialedField]: nextLead[config.dialedField] || ""
    }
  });

  return decorateLeadForStorage(nextLead);
}

function buildLsqImportedLead(record = {}, nextId, counselorName = "Unassigned") {
  const now = new Date().toISOString();
  const dialed = record.dialed || (/phone call|call/i.test(String(record.callStatus || "").toLowerCase()) ? "Yes" : "");
  const courseName = String(record.courseName || "").trim();
  const callStatus = String(record.callStatus || "").trim();
  const admissionStatus = String(record.admissionStatus || "").trim();
  const courseStatus = String(record.courseStatus || "").trim();
  const importedLead = {
    id: nextId,
    name: String(record.name || "Unknown").trim() || "Unknown",
    email: String(record.email || `lsq-${nextId}@noemail.lead`).trim().toLowerCase(),
    phone: String(record.phone || "").trim(),
    country: String(record.country || "India").trim(),
    state: String(record.state || "").trim(),
    city: String(record.city || "").trim(),
    workshop: "",
    courseName,
    courseRawName: courseName,
    status: "Updated",
    source: "LeadSquared Import",
    leadPipeline: MAIN_ADMISSION_PIPELINE,
    createdAtExact: now,
    createdAt: toKolkataDateKey(),
    counselor: counselorName,
    dialed: "",
    callStatus: "",
    wsStatus: "",
    whatsappInvite: "",
    postDialed: "",
    coursePitched: "",
    courseStatus: "",
    admissionStatus: "",
    admissionWorkshop: "",
    postStatusUpdated: false,
    preActivityUpdates: 0,
    postActivityUpdates: 0,
    workshopActivityHistory: [],
    admissionActivityHistory: [],
    mainAdmissionDialed: dialed,
    mainAdmissionCoursePitched: courseName,
    mainAdmissionCourseStatus: courseStatus,
    mainAdmissionAdmissionStatus: admissionStatus,
    mainAdmissionCallStatus: callStatus,
    mainAdmissionActivityUpdated: true,
    mainAdmissionActivityUpdates: 1,
    mainAdmissionActivityHistory: [{
      at: now,
      source: "LeadSquared Import",
      by: "system:lsq-import",
      updates: {
        mainAdmissionDialed: dialed,
        mainAdmissionCoursePitched: courseName,
        mainAdmissionCourseStatus: courseStatus,
        mainAdmissionAdmissionStatus: admissionStatus,
        mainAdmissionCallStatus: callStatus
      }
    }],
    admissionSopAssignedAt: shouldTreatLeadAsAssigned(counselorName) ? now : null,
    admissionSopLastProgressAt: record.updatedAt || now,
    whatsappGroupStatus: "",
    leadNotes: [],
    importSourceFiles: [record.sourceFileName || "LeadSquared Import"].filter(Boolean),
    importSourceSheets: [],
    lsqImported: true,
    lsqLastImportedAt: now,
    lsqSourceSnapshot: {
      ...(record.sourceSnapshot || {}),
      sourceFileName: record.sourceFileName || ""
    }
  };

  return decorateLeadForStorage(importedLead);
}

function buildLsqArchiveDoc(record = {}, reason = "", existingLead = null) {
  return {
    _id: `archived-lead-${crypto.randomUUID()}`,
    name: String(record.name || existingLead?.name || "").trim(),
    email: String(record.email || existingLead?.email || "").trim().toLowerCase(),
    phone: String(record.phone || existingLead?.phone || "").trim(),
    courseName: String(record.courseName || existingLead?.courseName || existingLead?.courseRawName || "").trim()
  };
}

function normalizeArchivedCourseName(value = "") {
  const rawCourseName = String(value || "").trim();
  if (!rawCourseName) {
    return "";
  }

  const courseIdentity = buildCourseIdentity(rawCourseName, {
    courseName: rawCourseName,
    courseRawName: rawCourseName
  });
  const normalizedCourseName = getAdmissionRoutingCourseName(rawCourseName, courseIdentity);
  return String(normalizedCourseName || rawCourseName).trim();
}

function normalizeArchivedLeadDoc(doc = {}) {
  return {
    _id: String(doc?._id || `archived-lead-${crypto.randomUUID()}`),
    name: String(doc?.name || "").trim(),
    email: String(doc?.email || "").trim().toLowerCase(),
    phone: String(doc?.phone || "").trim(),
    courseName: normalizeArchivedCourseName(doc?.courseName)
  };
}

function normalizeArchivedLeadDocs(docs = []) {
  return (Array.isArray(docs) ? docs : []).map((doc) => normalizeArchivedLeadDoc(doc));
}

function isServerLostLead(lead = {}) {
  const pipeline = String(lead?.leadPipeline || "").trim().toLowerCase();

  if (pipeline === MAIN_ADMISSION_PIPELINE) {
    return Boolean(lead?.mainAdmissionActivityUpdated)
      && String(lead?.mainAdmissionCourseStatus || "").trim() === "Not Interested";
  }

  if (pipeline === "course-registration") {
    return Boolean(lead?.registeredActivityUpdated)
      && String(lead?.registeredCourseStatus || "").trim() === "Not Interested";
  }

  return String(lead?.wsStatus || "").trim() === "Not Interested"
    || (Boolean(lead?.postStatusUpdated) && String(lead?.courseStatus || "").trim() === "Not Interested");
}

function getLostLeadProgramName(lead = {}) {
  const pipeline = String(lead?.leadPipeline || "").trim().toLowerCase();
  if (pipeline === MAIN_ADMISSION_PIPELINE || pipeline === "course-registration") {
    return String(lead?.courseName || lead?.courseCode || "").trim();
  }
  return String(lead?.courseName || lead?.workshop || lead?.courseRawName || "").trim();
}

function getHistoryEntries(history = []) {
  return Array.isArray(history) ? history : [];
}

function getHistoryTimestamp(history = [], matchesNotInterested) {
  const entries = getHistoryEntries(history)
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({
      at: Date.parse(String(entry.at || "").trim()),
      matches: matchesNotInterested(entry)
    }))
    .filter((entry) => Number.isFinite(entry.at));

  const matchingTimes = entries.filter((entry) => entry.matches).map((entry) => entry.at);
  if (matchingTimes.length) {
    return Math.max(...matchingTimes);
  }

  const allTimes = entries.map((entry) => entry.at);
  return allTimes.length ? Math.max(...allTimes) : null;
}

function getLeadArchiveEligibilityTimestamp(lead = {}) {
  const pipeline = String(lead?.leadPipeline || "").trim().toLowerCase();

  if (pipeline === MAIN_ADMISSION_PIPELINE) {
    const historyTime = getHistoryTimestamp(lead?.mainAdmissionActivityHistory, (entry) => (
      String(entry?.updates?.mainAdmissionCourseStatus || "").trim() === "Not Interested"
    ));
    if (historyTime) {
      return historyTime;
    }
  } else if (pipeline === "course-registration") {
    const historyTime = getHistoryTimestamp(lead?.registeredCourseActivityHistory, (entry) => (
      String(entry?.updates?.registeredCourseStatus || "").trim() === "Not Interested"
    ));
    if (historyTime) {
      return historyTime;
    }
  } else if (String(lead?.wsStatus || "").trim() === "Not Interested") {
    const historyTime = getHistoryTimestamp(lead?.workshopActivityHistory, (entry) => (
      String(entry?.updates?.wsStatus || "").trim() === "Not Interested"
      || String(entry?.updates?.workshopStatus || "").trim() === "Not Interested"
    ));
    if (historyTime) {
      return historyTime;
    }
  } else {
    const historyTime = getHistoryTimestamp(lead?.admissionActivityHistory, (entry) => (
      String(entry?.updates?.courseStatus || "").trim() === "Not Interested"
    ));
    if (historyTime) {
      return historyTime;
    }
  }

  const exactTime = Date.parse(String(lead?.updatedAt || lead?.createdAtExact || "").trim());
  if (Number.isFinite(exactTime)) {
    return exactTime;
  }

  return parseDateKeyToTime(lead?.createdAt);
}

function buildArchivedLeadDocFromLiveLead(lead = {}) {
  return normalizeArchivedLeadDoc({
    _id: `archived-lead-${crypto.randomUUID()}`,
    name: lead?.name,
    email: lead?.email,
    phone: lead?.phone,
    courseName: getLostLeadProgramName(lead)
  });
}

async function syncStaleLostLeadsToArchive() {
  const storedLeads = await withMongoRetry(
    () => leadsCollection.find({}).toArray(),
    { retries: 1, label: "Load leads for lost lead archive sync" }
  );
  const leads = decorateLeadListForStorage(storedLeads || []);
  const now = Date.now();
  const staleLostLeads = leads.filter((lead) => {
    if (!isServerLostLead(lead)) {
      return false;
    }
    const lostAt = getLeadArchiveEligibilityTimestamp(lead);
    return Number.isFinite(lostAt) && (now - lostAt) >= LOST_LEAD_ARCHIVE_AFTER_MS;
  });

  if (!staleLostLeads.length) {
    return { movedCount: 0, state: null };
  }

  const archivedDocs = staleLostLeads.map((lead) => buildArchivedLeadDocFromLiveLead(lead));
  const leadIds = staleLostLeads
    .map((lead) => String(lead?.id || "").trim())
    .filter(Boolean);

  if (archivedDocs.length) {
    await lsqArchiveCollection.insertMany(archivedDocs, { ordered: false });
  }
  if (leadIds.length) {
    await leadsCollection.deleteMany({ id: { $in: leadIds } });
  }

  await touchStateUpdatedAt();
  const nextState = await refreshStateAfterAtomicUpdate();
  return { movedCount: staleLostLeads.length, state: nextState };
}

async function initMongo() {
  if (stateCollection) {
    return;
  }

  if (!mongoInitPromise) {
    mongoInitPromise = (async () => {
      try {
        if (!MONGODB_URI) {
          throw new Error("Missing MONGODB_URI in environment.");
        }
        mongoClient = new MongoClient(MONGODB_URI, {
          // Larger pool so concurrent serverless invocations don't queue waiting
          // for a connection. In serverless, avoid forcing warm connections
          // because they can create intermittent TLS/connect stalls.
          maxPoolSize: 10,
          minPoolSize: 0,
          // Fail fast on cold starts rather than hanging for 30 s.
          serverSelectionTimeoutMS: 4000,
          connectTimeoutMS: 4000,
          // Generous socket timeout for high-latency or slow-network writes.
          socketTimeoutMS: 45000,
          maxIdleTimeMS: 30000,
          retryReads: false,
          retryWrites: false
        });
        await mongoClient.connect();
        const db = mongoClient.db(MONGODB_DB_NAME);
        stateCollection      = db.collection(MONGODB_STATE_COLLECTION);
        sessionCollection    = db.collection(MONGODB_SESSION_COLLECTION);
        preferenceCollection = db.collection(MONGODB_PREFERENCE_COLLECTION);
        metaConfigCollection = db.collection(MONGODB_META_CONFIG_COLLECTION);
        metaLogsCollection   = db.collection(MONGODB_META_LOGS_COLLECTION);
        metaRetryCollection  = db.collection(MONGODB_META_RETRY_COLLECTION);
        elementorConfigCollection = db.collection(MONGODB_ELEMENTOR_CONFIG_COLLECTION);
        elementorLogsCollection = db.collection(MONGODB_ELEMENTOR_LOGS_COLLECTION);
        elementorRetryCollection = db.collection(MONGODB_ELEMENTOR_RETRY_COLLECTION);
        mcubeConfigCollection = db.collection(MONGODB_MCUBE_CONFIG_COLLECTION);
        mcubeLogsCollection = db.collection(MONGODB_MCUBE_LOGS_COLLECTION);
        mcubeRetryCollection = db.collection(MONGODB_MCUBE_RETRY_COLLECTION);
        reachoutConfigCollection = db.collection(MONGODB_REACHOUT_CONFIG_COLLECTION);
        reachoutLogsCollection = db.collection(MONGODB_REACHOUT_LOGS_COLLECTION);
        reachoutMediaCollection = db.collection(MONGODB_REACHOUT_MEDIA_COLLECTION);

        leadsCollection      = db.collection("leads");
        counselorsCollection = db.collection("counselors");
        tasksCollection      = db.collection("tasks");
        allocationCollection = db.collection("allocation");
        notificationsCollection = db.collection("notifications");
        activityLogsCollection  = db.collection("activity_logs");
        leadClaimsCollection    = db.collection("lead_claims");
        leadCreationRequestsCollection = db.collection("lead_creation_requests");
        lsqArchiveCollection = db.collection(MONGODB_LSQ_ARCHIVE_COLLECTION);

        // Ensure indexes for activity_logs
        await activityLogsCollection.createIndex({ leadId: 1, timestamp: -1 }, { background: true }).catch(() => undefined);
        await activityLogsCollection.createIndex({ counselorName: 1, timestamp: -1 }, { background: true }).catch(() => undefined);
        await activityLogsCollection.createIndex({ activityType: 1, timestamp: -1 }, { background: true }).catch(() => undefined);
        await activityLogsCollection.createIndex({ performedBy: 1, timestamp: -1 }, { background: true }).catch(() => undefined);
        await activityLogsCollection.createIndex({ timestamp: -1 }, { background: true }).catch(() => undefined);
        await leadClaimsCollection.createIndex({ id: 1 }, { unique: true, background: true }).catch(() => undefined);
        await leadClaimsCollection.createIndex({ status: 1, createdAt: -1 }, { background: true }).catch(() => undefined);
        await leadClaimsCollection.createIndex({ requesterEmail: 1, createdAt: -1 }, { background: true }).catch(() => undefined);
        await leadClaimsCollection.createIndex({ currentOwnerEmail: 1, createdAt: -1 }, { background: true }).catch(() => undefined);
        await leadCreationRequestsCollection.createIndex({ id: 1 }, { unique: true, background: true }).catch(() => undefined);
        await leadCreationRequestsCollection.createIndex({ status: 1, createdAt: -1 }, { background: true }).catch(() => undefined);
        await leadCreationRequestsCollection.createIndex({ requesterEmail: 1, createdAt: -1 }, { background: true }).catch(() => undefined);

        // Ensure indexes
        await sessionCollection.createIndex(
          { token: 1 },
          { unique: true, background: true }
        ).catch(() => undefined);
        await metaLogsCollection.createIndex(
          { receivedAt: -1 },
          { background: true }
        ).catch(() => undefined);
        await elementorLogsCollection.createIndex(
          { receivedAt: -1 },
          { background: true }
        ).catch(() => undefined);
        await mcubeLogsCollection.createIndex(
          { receivedAt: -1 },
          { background: true }
        ).catch(() => undefined);
        await reachoutLogsCollection.createIndex(
          { sentAt: -1 },
          { background: true }
        ).catch(() => undefined);
        await reachoutLogsCollection.createIndex(
          { channel: 1, sentAt: -1 },
          { background: true }
        ).catch(() => undefined);
        await reachoutMediaCollection.createIndex(
          { id: 1 },
          { unique: true, background: true }
        ).catch(() => undefined);
        await reachoutMediaCollection.createIndex(
          { createdAt: -1 },
          { background: true }
        ).catch(() => undefined);
        await metaRetryCollection.createIndex(
          { leadgenId: 1 },
          { unique: true, background: true }
        ).catch(() => undefined);
        await metaRetryCollection.createIndex(
          { nextAttemptAt: 1 },
          { background: true }
        ).catch(() => undefined);
        await elementorRetryCollection.createIndex(
          { dedupeKey: 1 },
          { unique: true, background: true }
        ).catch(() => undefined);
        await elementorRetryCollection.createIndex(
          { nextAttemptAt: 1 },
          { background: true }
        ).catch(() => undefined);
        await mcubeRetryCollection.createIndex(
          { dedupeKey: 1 },
          { unique: true, background: true }
        ).catch(() => undefined);
        await mcubeRetryCollection.createIndex(
          { nextAttemptAt: 1 },
          { background: true }
        ).catch(() => undefined);

        await leadsCollection.createIndex({ id: 1 }, { unique: true, background: true }).catch(() => undefined);
        await leadsCollection.createIndex(
          { metaLeadId: 1 },
          {
            unique: true,
            background: true,
            partialFilterExpression: { metaLeadId: { $exists: true, $type: "string" } }
          }
        ).catch(() => undefined);
        await leadsCollection.dropIndex("normalizedEmail_1").catch(() => undefined);
        await leadsCollection.dropIndex("normalizedPhone_1").catch(() => undefined);
        await leadsCollection.createIndex(
          { normalizedEmail: 1 },
          {
            name: "normalizedEmail_1",
            unique: true,
            background: true,
            partialFilterExpression: {
              normalizedEmail: { $exists: true, $type: "string" },
              $and: [
                { leadPipeline: { $ne: "course-registration" } },
                { leadPipeline: { $ne: MAIN_ADMISSION_PIPELINE } }
              ]
            }
          }
        ).catch(() => undefined);
        await leadsCollection.createIndex(
          { normalizedPhone: 1 },
          {
            name: "normalizedPhone_1",
            unique: true,
            background: true,
            partialFilterExpression: {
              normalizedPhone: { $exists: true, $type: "string" },
              $and: [
                { leadPipeline: { $ne: "course-registration" } },
                { leadPipeline: { $ne: MAIN_ADMISSION_PIPELINE } }
              ]
            }
          }
        ).catch(() => undefined);
        await leadsCollection.createIndex({ email: 1 }, { background: true }).catch(() => undefined);
        await leadsCollection.createIndex({ phone: 1 }, { background: true }).catch(() => undefined);
        await leadsCollection.createIndex({ counselor: 1, createdAt: -1 }, { background: true }).catch(() => undefined);
        await leadsCollection.createIndex({ leadPipeline: 1, createdAt: -1 }, { background: true }).catch(() => undefined);
        await leadsCollection.createIndex({ createdAt: -1 }, { background: true }).catch(() => undefined);
        await leadsCollection.createIndex({ counselor: 1, leadPipeline: 1 }, { background: true }).catch(() => undefined);
        await tasksCollection.createIndex({ id: 1 }, { unique: true, background: true }).catch(() => undefined);
        await tasksCollection.createIndex({ leadId: 1, dueDate: 1 }, { background: true }).catch(() => undefined);
        await tasksCollection.createIndex({ counselor: 1, dueDate: 1 }, { background: true }).catch(() => undefined);
        await counselorsCollection.createIndex({ email: 1 }, { unique: true, background: true }).catch(() => undefined);
        await notificationsCollection.createIndex({ userId: 1, read: 1 }, { background: true }).catch(() => undefined);

        // One-time automatic schema migration
        try {
          const globalDoc = await stateCollection.findOne({ _id: STATE_DOC_ID });
          if (globalDoc && (Array.isArray(globalDoc.leads) || Array.isArray(globalDoc.counselors) || Array.isArray(globalDoc.tasks) || Array.isArray(globalDoc.allocation))) {
            console.log("Migrating database schema to normalized collections...");
            
            if (Array.isArray(globalDoc.leads) && globalDoc.leads.length) {
              const leadsMap = new Map();
              globalDoc.leads.forEach(lead => {
                if (lead && lead.id) leadsMap.set(String(lead.id), lead);
              });
              const uniqueLeads = decorateLeadListForStorage(Array.from(leadsMap.values()));
              await leadsCollection.insertMany(uniqueLeads, { ordered: false }).catch(() => undefined);
            }
            
            if (Array.isArray(globalDoc.counselors) && globalDoc.counselors.length) {
              const counselorsMap = new Map();
              globalDoc.counselors.forEach(counselor => {
                if (counselor && counselor.email) counselorsMap.set(counselor.email.toLowerCase(), counselor);
              });
              const uniqueCounselors = Array.from(counselorsMap.values());
              await counselorsCollection.insertMany(uniqueCounselors, { ordered: false }).catch(() => undefined);
            }
            
            if (Array.isArray(globalDoc.tasks) && globalDoc.tasks.length) {
              const tasksMap = new Map();
              globalDoc.tasks.forEach(task => {
                if (task && task.id) tasksMap.set(String(task.id), task);
              });
              const uniqueTasks = Array.from(tasksMap.values());
              await tasksCollection.insertMany(uniqueTasks, { ordered: false }).catch(() => undefined);
            }
            
            if (Array.isArray(globalDoc.allocation) && globalDoc.allocation.length) {
              await allocationCollection.insertMany(globalDoc.allocation).catch(() => undefined);
            }
            
            await stateCollection.updateOne(
              { _id: STATE_DOC_ID },
              { $unset: { leads: "", counselors: "", tasks: "", allocation: "" } }
            );
            console.log("Database schema migration completed successfully!");
          }
        } catch (migrationError) {
          console.error("Database schema migration failed:", migrationError.message);
        }

        // Always ensure the lead ID sequence is in sync with the actual leads at startup
        await syncLeadSequence().catch(() => undefined);
        await ensureLeadStorageNormalization().catch((error) => {
          console.warn(`Workshop normalization migration skipped: ${error.message}`);
        });
        console.log(`Connected to MongoDB database: ${MONGODB_DB_NAME}`);
      } catch (err) {
        console.warn(`\n⚠️ MongoDB connection failed: ${err.message}`);
        console.warn("⚠️ Falling back to local file-based mock database in the ./tmp/ directory.\n");
        
        const { MockCollection } = require("./mock-db");
        stateCollection      = new MockCollection("state");
        sessionCollection    = new MockCollection("sessions");
        preferenceCollection = new MockCollection("preferences");
        metaConfigCollection = new MockCollection("metaConfig");
        metaLogsCollection   = new MockCollection("metaLogs");
        metaRetryCollection  = new MockCollection("metaRetry");
        elementorConfigCollection = new MockCollection("elementorConfig");
        elementorLogsCollection = new MockCollection("elementorLogs");
        elementorRetryCollection = new MockCollection("elementorRetry");
        mcubeConfigCollection = new MockCollection("mcubeConfig");
        mcubeLogsCollection = new MockCollection("mcubeLogs");
        mcubeRetryCollection = new MockCollection("mcubeRetry");
        reachoutConfigCollection = new MockCollection("reachoutConfig");
        reachoutLogsCollection = new MockCollection("reachoutLogs");
        reachoutMediaCollection = new MockCollection("reachoutMedia");
        leadsCollection      = new MockCollection("leads");
        counselorsCollection = new MockCollection("counselors");
        tasksCollection      = new MockCollection("tasks");
        allocationCollection = new MockCollection("allocation");
        notificationsCollection = new MockCollection("notifications");
        activityLogsCollection  = new MockCollection("activityLogs");
        leadClaimsCollection    = new MockCollection("leadClaims");
        leadCreationRequestsCollection = new MockCollection("leadCreationRequests");
        
        // Sync lead sequence for mock db too
        await syncLeadSequence().catch(() => undefined);
      }
    })();
  }

  await mongoInitPromise;
}

// ─── Meta Integration Helpers ───────────────────────────────────────────────

async function getMetaConfig() {
  const doc = await withMongoRetry(
    () => metaConfigCollection.findOne({ _id: META_CONFIG_DOC_ID }),
    { retries: 1, label: "Load Meta config" }
  );
  const baseConfig = doc || {
    _id: META_CONFIG_DOC_ID,
    enabled: false,
    verifyToken: "",
    appSecret: "",
    pageAccessToken: "",
    pageId: "",
    formIds: [],
    roundRobinIndex: 0
  };

  return {
    ...baseConfig,
    logSummary: {
      success: Number(baseConfig.logSummary?.success) || 0,
      ignored: Number(baseConfig.logSummary?.ignored) || 0,
      error: Number(baseConfig.logSummary?.error) || 0
    }
  };
}

async function saveMetaLog(entry) {
  const log = { ...entry, receivedAt: new Date().toISOString() };
  const type = String(entry?.type || "").trim().toLowerCase();
  const shouldTrackCount = type === "success" || type === "ignored" || type === "error";

  try {
    await withMongoRetry(
      () => metaLogsCollection.insertOne(log),
      { retries: 1, label: "Write Meta webhook log" }
    );

    if (shouldTrackCount) {
      await withMongoRetry(
        () => metaConfigCollection.updateOne(
          { _id: META_CONFIG_DOC_ID },
          {
            $inc: { [`logSummary.${type}`]: 1 },
            $set: { updatedAt: new Date().toISOString() },
            $setOnInsert: {
              enabled: false,
              verifyToken: "",
              appSecret: "",
              pageAccessToken: "",
              pageId: "",
              formIds: [],
              roundRobinIndex: 0,
              createdAt: new Date().toISOString()
            }
          },
          { upsert: true }
        ),
        { retries: 1, label: "Update Meta webhook log summary" }
      );
    }

    metaLogWriteCount += 1;

    // Prune only occasionally so each webhook event does not trigger extra
    // count/sort/delete traffic against MongoDB.
    if (metaLogWriteCount % 25 !== 0) {
      return;
    }

    await withMongoRetry(async () => {
      const count = await metaLogsCollection.countDocuments();
      if (count <= MAX_META_LOGS) {
        return;
      }

      const excess = count - MAX_META_LOGS;
      const oldest = await metaLogsCollection
        .find({}, { projection: { _id: 1 } })
        .sort({ receivedAt: 1 })
        .limit(excess)
        .toArray();
      if (oldest.length) {
        await metaLogsCollection.deleteMany({ _id: { $in: oldest.map((doc) => doc._id) } });
      }
    }, { retries: 1, label: "Prune Meta webhook logs" });
  } catch (error) {
    console.error("Meta log write skipped:", error.message);
  }
}

async function getElementorConfig() {
  const doc = await withMongoRetry(
    () => elementorConfigCollection.findOne({ _id: ELEMENTOR_CONFIG_DOC_ID }),
    { retries: 1, label: "Load Elementor config" }
  );
  const baseConfig = doc || {
    _id: ELEMENTOR_CONFIG_DOC_ID,
    enabled: false,
    allowedFormIds: [],
    workshopFormIds: [],
    admissionFormIds: [],
    workshopFormNames: [],
    admissionFormNames: [],
    workshopPagePatterns: [],
    admissionPagePatterns: [],
    roundRobinIndex: 0
  };

  return {
    ...baseConfig,
    logSummary: {
      success: Number(baseConfig.logSummary?.success) || 0,
      ignored: Number(baseConfig.logSummary?.ignored) || 0,
      error: Number(baseConfig.logSummary?.error) || 0
    }
  };
}

let elementorLogWriteCount = 0;

async function saveElementorLog(entry) {
  const log = { ...entry, receivedAt: new Date().toISOString() };
  const type = String(entry?.type || "").trim().toLowerCase();
  const shouldTrackCount = type === "success" || type === "ignored" || type === "error";

  try {
    await withMongoRetry(
      () => elementorLogsCollection.insertOne(log),
      { retries: 1, label: "Write Elementor webhook log" }
    );

    if (shouldTrackCount) {
      await withMongoRetry(
        () => elementorConfigCollection.updateOne(
          { _id: ELEMENTOR_CONFIG_DOC_ID },
          {
            $inc: { [`logSummary.${type}`]: 1 },
            $set: { updatedAt: new Date().toISOString() },
            $setOnInsert: {
              enabled: false,
              allowedFormIds: [],
              workshopFormIds: [],
              admissionFormIds: [],
              workshopFormNames: [],
              admissionFormNames: [],
              workshopPagePatterns: [],
              admissionPagePatterns: [],
              roundRobinIndex: 0,
              createdAt: new Date().toISOString()
            }
          },
          { upsert: true }
        ),
        { retries: 1, label: "Update Elementor webhook log summary" }
      );
    }

    elementorLogWriteCount += 1;
    if (elementorLogWriteCount % 25 !== 0) {
      return;
    }

    await withMongoRetry(async () => {
      const count = await elementorLogsCollection.countDocuments();
      if (count <= MAX_ELEMENTOR_LOGS) {
        return;
      }

      const excess = count - MAX_ELEMENTOR_LOGS;
      const oldest = await elementorLogsCollection
        .find({}, { projection: { _id: 1 } })
        .sort({ receivedAt: 1 })
        .limit(excess)
        .toArray();
      if (oldest.length) {
        await elementorLogsCollection.deleteMany({ _id: { $in: oldest.map((doc) => doc._id) } });
      }
    }, { retries: 1, label: "Prune Elementor webhook logs" });
  } catch (error) {
    console.error("Elementor log write skipped:", error.message);
  }
}

async function getMcubeConfig() {
  const doc = await withMongoRetry(
    () => mcubeConfigCollection.findOne({ _id: MCUBE_CONFIG_DOC_ID }),
    { retries: 1, label: "Load MCUBE config" }
  );
  const baseConfig = doc || {
    _id: MCUBE_CONFIG_DOC_ID,
    enabled: false,
    apiBaseUrl: "https://api.mcube.com",
    accountToken: "",
    webhookSecret: "",
    clickToCallPath: "/Restmcube-api/outbound-calls",
    clickToCallMethod: "POST",
    outboundRefUrl: "1",
    defaultExecutiveNumber: "",
    enableClickToCall: true,
    enableEventSync: true,
    enableAutoLeadCreate: true,
    enableAutoTaskCreation: true,
    enableIncomingPopup: true,
    enableRecordingLinks: true,
    enableCallStatusSync: true,
    enableNotifications: true,
    roundRobinIndex: 0
  };

  return {
    ...baseConfig,
    logSummary: {
      success: Number(baseConfig.logSummary?.success) || 0,
      ignored: Number(baseConfig.logSummary?.ignored) || 0,
      error: Number(baseConfig.logSummary?.error) || 0
    }
  };
}

let mcubeLogWriteCount = 0;

async function saveMcubeLog(entry) {
  const log = { ...entry, receivedAt: new Date().toISOString() };
  const type = String(entry?.type || "").trim().toLowerCase();
  const shouldTrackCount = type === "success" || type === "ignored" || type === "error";

  try {
    await withMongoRetry(
      () => mcubeLogsCollection.insertOne(log),
      { retries: 1, label: "Write MCUBE log" }
    );

    if (shouldTrackCount) {
      await withMongoRetry(
        () => mcubeConfigCollection.updateOne(
          { _id: MCUBE_CONFIG_DOC_ID },
          {
            $inc: { [`logSummary.${type}`]: 1 },
            $set: { updatedAt: new Date().toISOString() },
            $setOnInsert: {
              enabled: false,
              apiBaseUrl: "https://api.mcube.com",
              accountToken: "",
              webhookSecret: "",
              clickToCallPath: "/Restmcube-api/outbound-calls",
              clickToCallMethod: "POST",
              outboundRefUrl: "1",
              defaultExecutiveNumber: "",
              enableClickToCall: true,
              enableEventSync: true,
              enableAutoLeadCreate: true,
              enableAutoTaskCreation: true,
              enableIncomingPopup: true,
              enableRecordingLinks: true,
              enableCallStatusSync: true,
              enableNotifications: true,
              roundRobinIndex: 0,
              createdAt: new Date().toISOString()
            }
          },
          { upsert: true }
        ),
        { retries: 1, label: "Update MCUBE log summary" }
      );
    }

    mcubeLogWriteCount += 1;
    if (mcubeLogWriteCount % 25 !== 0) {
      return;
    }

    await withMongoRetry(async () => {
      const count = await mcubeLogsCollection.countDocuments();
      if (count <= MAX_MCUBE_LOGS) {
        return;
      }

      const excess = count - MAX_MCUBE_LOGS;
      const oldest = await mcubeLogsCollection
        .find({}, { projection: { _id: 1 } })
        .sort({ receivedAt: 1 })
        .limit(excess)
        .toArray();
      if (oldest.length) {
        await mcubeLogsCollection.deleteMany({ _id: { $in: oldest.map((doc) => doc._id) } });
      }
    }, { retries: 1, label: "Prune MCUBE logs" });
  } catch (error) {
    console.error("MCUBE log write skipped:", error.message);
  }
}

function decodeJwtPayload(token) {
  try {
    const parts = String(token || "").trim().split(".");
    if (parts.length < 2) {
      return null;
    }
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function getDefaultReachoutTemplates() {
  return [];
}

async function getReachoutConfig() {
  const doc = await withMongoRetry(
    () => reachoutConfigCollection.findOne({ _id: REACHOUT_CONFIG_DOC_ID }),
    { retries: 1, label: "Load ReachOut config" }
  );
  const authKey = String(doc?.authKey || process.env.MSG91_AUTH_KEY || "").trim();
  const templates = Array.isArray(doc?.templates)
    ? doc.templates.filter((template) => String(template?.channel || "").trim().toLowerCase() === "whatsapp")
    : getDefaultReachoutTemplates();
  const whatsappNumbers = Array.isArray(doc?.whatsappNumbers)
    ? doc.whatsappNumbers.map(normalizeReachoutWhatsAppNumber).filter((number) => number.number)
    : [];
  return {
    _id: REACHOUT_CONFIG_DOC_ID,
    enabled: doc?.enabled !== false,
    authKey,
    templates,
    whatsappNumbers,
    defaultCountryCode: String(doc?.defaultCountryCode || "91").trim() || "91",
    logSummary: {
      submitted: Number(doc?.logSummary?.submitted ?? doc?.logSummary?.success) || 0,
      success: Number(doc?.logSummary?.success) || 0,
      error: Number(doc?.logSummary?.error) || 0
    }
  };
}

function publicReachoutConfig(config) {
  return {
    enabled: config.enabled !== false,
    authKeySet: !!String(config.authKey || "").trim(),
    defaultCountryCode: String(config.defaultCountryCode || "91").trim() || "91",
    whatsappNumbers: Array.isArray(config.whatsappNumbers) ? config.whatsappNumbers : [],
    templates: (Array.isArray(config.templates) ? config.templates : []).map((template) => ({
      ...template,
      id: String(template.id || ""),
      channel: String(template.channel || "").trim().toLowerCase()
    })),
    logSummary: {
      submitted: Number(config.logSummary?.submitted ?? config.logSummary?.success) || 0,
      success: Number(config.logSummary?.success) || 0,
      error: Number(config.logSummary?.error) || 0
    }
  };
}

function normalizeReachoutWhatsAppNumber(value = {}) {
  const raw = typeof value === "string" ? { number: value } : value;
  const number = String(
    raw.number ||
    raw.integratedNumber ||
    raw.integrated_number ||
    raw.phone ||
    raw.mobile ||
    raw.whatsappNumber ||
    ""
  ).replace(/\D/g, "");
  const label = String(raw.label || raw.clientName || raw.client_name || raw.name || number || "").trim();
  const status = String(raw.status || raw.activation_status || raw.state || "").trim();
  return {
    id: String(raw.id || raw._id || number || crypto.randomUUID()).trim(),
    number,
    label: label || number,
    status
  };
}

function getPublicRequestBaseUrl(req) {
  const proto = String(req.get("x-forwarded-proto") || req.protocol || "https").split(",")[0].trim() || "https";
  const host = String(req.get("x-forwarded-host") || req.get("host") || "").split(",")[0].trim();
  return host ? `${proto}://${host}` : "";
}

function normalizeReachoutMediaUpload(body = {}) {
  const contentType = String(body.contentType || body.type || "").trim().toLowerCase();
  if (!["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"].includes(contentType)) {
    throw new Error("Upload a JPG, PNG, WEBP, or GIF image.");
  }

  const rawData = String(body.data || body.dataUrl || body.base64 || "").trim();
  const base64 = rawData.includes(",") ? rawData.split(",").pop() : rawData;
  if (!base64) {
    throw new Error("Image data is missing.");
  }

  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length) {
    throw new Error("Image data is invalid.");
  }
  if (buffer.length > 5 * 1024 * 1024) {
    throw new Error("Image must be 5 MB or smaller.");
  }

  const extensionByType = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif"
  };
  return {
    id: crypto.randomUUID(),
    fileName: String(body.fileName || body.name || "reachout-header").trim().slice(0, 160),
    contentType: contentType === "image/jpg" ? "image/jpeg" : contentType,
    extension: extensionByType[contentType] || "jpg",
    buffer
  };
}

function bufferFromStoredMediaData(data) {
  if (Buffer.isBuffer(data)) return data;
  if (data?.buffer) return Buffer.from(data.buffer);
  if (Array.isArray(data?.data)) return Buffer.from(data.data);
  if (typeof data === "string") return Buffer.from(data, "base64");
  return Buffer.alloc(0);
}

function sanitizeReachoutTemplate(template = {}) {
  return {
    id: String(template.id || crypto.randomUUID()).trim(),
    name: String(template.name || "Untitled template").trim().slice(0, 120),
    channel: "whatsapp",
    enabled: template.enabled !== false,
    msg91TemplateId: String(template.msg91TemplateId || "").trim(),
    integratedNumber: String(template.integratedNumber || "").trim(),
    templateName: String(template.templateName || "").trim(),
    namespace: String(template.namespace || "").trim(),
    languageCode: String(template.languageCode || "en").trim() || "en",
    fromEmail: String(template.fromEmail || "").trim(),
    fromName: String(template.fromName || "").trim(),
    domain: String(template.domain || "").trim(),
    subject: String(template.subject || "").trim(),
    variableMappings: String(template.variableMappings || "").trim(),
    defaultHeaderMediaUrl: String(template.defaultHeaderMediaUrl || "").trim(),
    componentSchema: Array.isArray(template.componentSchema) ? template.componentSchema : [],
    bodyText: String(template.bodyText || "").trim(),
    payloadJson: String(template.payloadJson || "").trim(),
    updatedAt: new Date().toISOString(),
    createdAt: String(template.createdAt || new Date().toISOString())
  };
}

function collectObjectsDeep(value, predicate, limit = 500, output = []) {
  if (output.length >= limit || value === null || value === undefined) {
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectObjectsDeep(item, predicate, limit, output));
    return output;
  }
  if (typeof value === "object") {
    if (predicate(value)) {
      output.push(value);
    }
    Object.values(value).forEach((item) => collectObjectsDeep(item, predicate, limit, output));
  }
  return output;
}

function normalizeMsg91WhatsAppNumbersPayload(payload) {
  const candidates = collectObjectsDeep(payload, (item) => {
    const number = String(
      item.number ||
      item.integratedNumber ||
      item.integrated_number ||
      item.phone ||
      item.mobile ||
      item.whatsappNumber ||
      ""
    ).replace(/\D/g, "");
    return number.length >= 10;
  });
  const byNumber = new Map();
  candidates.forEach((item) => {
    const normalized = normalizeReachoutWhatsAppNumber(item);
    if (normalized.number && !byNumber.has(normalized.number)) {
      byNumber.set(normalized.number, normalized);
    }
  });
  return [...byNumber.values()];
}

function normalizeMsg91TemplateName(template = {}) {
  return String(
    template.name ||
    template.template_name ||
    template.templateName ||
    template.element_name ||
    template.elementName ||
    template.display_name ||
    ""
  ).trim();
}

function normalizeMsg91TemplateLanguage(template = {}) {
  const language = template.language || template.lang || template.languages;
  if (typeof language === "string") return language.trim() || "en";
  if (Array.isArray(language) && language.length) {
    const first = language[0];
    if (typeof first === "string") return first.trim() || "en";
    return String(first?.code || first?.language || first?.lang || "en").trim() || "en";
  }
  if (language && typeof language === "object") {
    return String(language.code || language.language || language.lang || "en").trim() || "en";
  }
  return "en";
}

function normalizeMsg91TemplateNamespace(template = {}) {
  return String(
    template.namespace ||
    template.name_space ||
    template.template_namespace ||
    template.templateNamespace ||
    template.waba_namespace ||
    ""
  ).trim();
}

function sortWhatsAppComponentKeys(keys = []) {
  return [...keys].sort((left, right) => {
    const order = { header: 0, body: 1, button: 2 };
    const [leftType, leftNumber] = left.split("_");
    const [rightType, rightNumber] = right.split("_");
    return (order[leftType] - order[rightType]) || (Number(leftNumber) - Number(rightNumber));
  });
}

function inferLeadFieldForComponent(key, index = 0) {
  if (/^header/i.test(key)) return "mediaUrl";
  if (/^button/i.test(key)) return "buttonUrl";
  if (index === 0) return "name";
  if (index === 1) return "workshop";
  if (index === 2) return "course";
  if (index === 3) return "campaign";
  return "name";
}

function normalizeWhatsAppComponentType(value, fallback = "text") {
  const type = String(value || fallback || "text").trim().toLowerCase();
  return ["image", "video", "document", "text"].includes(type) ? type : fallback;
}

function normalizeTemplateComponentSchema(template = {}) {
  const schema = new Map();
  const addComponent = (component = {}) => {
    const key = String(component.key || "").trim().toLowerCase();
    if (!/^(header|body|button)_\d+$/.test(key)) return;
    const next = {
      key,
      type: normalizeWhatsAppComponentType(component.type, /^header/i.test(key) ? "image" : "text"),
      subtype: String(component.subtype || "").trim().toLowerCase(),
      example: String(component.example || "").trim(),
      explicitType: Boolean(component.explicitType)
    };
    const existing = schema.get(key);
    if (existing) {
      schema.set(key, {
        ...existing,
        type: next.explicitType ? next.type : (existing.type === "text" && next.type !== "text" ? next.type : existing.type),
        subtype: existing.subtype || next.subtype,
        example: existing.example || next.example
      });
      return;
    }
    schema.set(key, next);
  };
  const getComponentExample = (value = {}) => {
    if (!value || typeof value !== "object") return "";
    return String(
      value.value
      || value.text
      || value.url
      || value.link
      || value.image?.link
      || value.video?.link
      || value.document?.link
      || ""
    ).trim();
  };

  const text = JSON.stringify(template || {});
  const directKeys = [...new Set(Array.from(
    text.matchAll(/\b(header|body|button)[_-]?(\d+)\b/gi),
    (match) => `${match[1].toLowerCase()}_${match[2]}`
  ))];
  directKeys.forEach((key) => addComponent({
    key,
    type: /^header/i.test(key) ? "image" : "text",
    subtype: /^button/i.test(key) ? "url" : ""
  }));

  collectObjectsDeep(template, (item) => {
    Object.entries(item || {}).forEach(([rawKey, rawValue]) => {
      const match = String(rawKey || "").match(/^(header|body|button)[_-]?(\d+)$/i);
      if (!match || !rawValue || typeof rawValue !== "object") return;
      const key = `${match[1].toLowerCase()}_${match[2]}`;
      const rawType = String(rawValue.type || rawValue.format || rawValue.header_type || "").trim().toLowerCase();
      const subtype = String(rawValue.subtype || rawValue.sub_type || "").trim().toLowerCase();
      addComponent({
        key,
        type: normalizeWhatsAppComponentType(rawType, /^header/i.test(key) ? "image" : "text"),
        explicitType: Boolean(rawType),
        subtype: /^button/i.test(key) ? (subtype || "url") : subtype,
        example: getComponentExample(rawValue)
      });
    });
    return false;
  });

  const componentObjects = collectObjectsDeep(template, (item) => {
    const type = String(item.type || item.component_type || item.componentType || "").trim().toLowerCase();
    return ["header", "body", "button", "buttons"].includes(type);
  });

  componentObjects.forEach((component) => {
    const rawType = String(component.type || component.component_type || component.componentType || "").trim().toLowerCase();
    const type = rawType === "buttons" ? "button" : rawType;
    const example = component.example || {};
    const exampleValues = [
      ...(Array.isArray(example.header_handle) ? example.header_handle : []),
      ...(Array.isArray(example.header_text) ? example.header_text : []),
      ...(Array.isArray(example.body_text?.[0]) ? example.body_text[0] : []),
      ...(Array.isArray(example.button_text) ? example.button_text : [])
    ];

    if (type === "header") {
      const format = normalizeWhatsAppComponentType(component.format || component.header_type, "image");
      const count = Math.max((String(component.text || "").match(/\{\{\s*\d+\s*\}\}/g) || []).length, exampleValues.length, 1);
      for (let index = 1; index <= count; index += 1) {
        addComponent({ key: `header_${index}`, type: format, explicitType: true, example: exampleValues[index - 1] || "" });
      }
    }

    if (type === "body") {
      const parameters = Array.isArray(component.parameters) ? component.parameters : [];
      const count = Math.max((String(component.text || "").match(/\{\{\s*\d+\s*\}\}/g) || []).length, exampleValues.length, parameters.length);
      for (let index = 1; index <= count; index += 1) {
        addComponent({ key: `body_${index}`, type: "text", explicitType: true, example: exampleValues[index - 1] || parameters[index - 1]?.value || "" });
      }
    }

    const buttons = Array.isArray(component.buttons) ? component.buttons : (type === "button" ? [component] : []);
    buttons.forEach((button, index) => {
      const subtype = String(button.sub_type || button.subtype || button.type || component.sub_type || component.subtype || "").trim().toLowerCase();
      const url = String(button.url || button.example?.[0] || "").trim();
      if (!subtype.includes("url") && !url.includes("{{")) return;
      addComponent({ key: `button_${index + 1}`, type: "text", explicitType: true, subtype: "url", example: url });
    });
  });

  return sortWhatsAppComponentKeys([...schema.keys()]).map((key) => {
    const { explicitType, ...component } = schema.get(key);
    return component;
  });
}

function inferWhatsAppVariableMappings(template = {}, componentSchema = null) {
  const schema = Array.isArray(componentSchema) ? componentSchema : normalizeTemplateComponentSchema(template);
  if (schema.length) {
    return schema.map((component, index) => {
      const example = String(component.example || "").trim();
      const isMediaHeader = /^header_\d+$/i.test(component.key) && ["image", "video", "document"].includes(String(component.type || "").toLowerCase());
      const value = !isMediaHeader && example && /^https?:\/\//i.test(example)
        ? example
        : inferLeadFieldForComponent(component.key, index);
      return `${component.key}=${value}`;
    }).join("\n");
  }
  const text = JSON.stringify(template || {});
  const placeholderCount = Math.max(
    ...Array.from(text.matchAll(/\{\{\s*(\d+)\s*\}\}/g), (match) => Number(match[1])),
    0
  );
  if (placeholderCount > 0) {
    return Array.from({ length: placeholderCount }, (_item, index) => {
      const key = `body_${index + 1}`;
      return `${key}=${index === 0 ? "name" : index === 1 ? "workshop" : "course"}`;
    }).join("\n");
  }
  return "";
}

function normalizeMsg91WhatsAppTemplatesPayload(payload, integratedNumber) {
  const candidates = collectObjectsDeep(payload, (item) => {
    const name = normalizeMsg91TemplateName(item);
    const status = String(item.status || item.template_status || item.state || "").toLowerCase();
    return !!name && !["rejected", "disabled", "deleted", "paused"].includes(status);
  });
  const byTemplate = new Map();
  candidates.forEach((template) => {
    const templateName = normalizeMsg91TemplateName(template);
    if (!templateName || byTemplate.has(templateName)) {
      return;
    }
    const componentSchema = normalizeTemplateComponentSchema(template);
    byTemplate.set(templateName, sanitizeReachoutTemplate({
      id: String(template.id || template._id || `${integratedNumber}-${templateName}`),
      name: String(template.display_name || template.label || templateName).trim(),
      channel: "whatsapp",
      templateName,
      namespace: normalizeMsg91TemplateNamespace(template),
      languageCode: normalizeMsg91TemplateLanguage(template),
      integratedNumber,
      enabled: true,
      componentSchema,
      variableMappings: inferWhatsAppVariableMappings(template, componentSchema)
    }));
  });
  return [...byTemplate.values()];
}

async function fetchMsg91Json(url, authKey, headers = {}) {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      authkey: authKey,
      auth_key: authKey,
      ...headers
    }
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    throw new Error(typeof payload === "object" ? (payload?.message || payload?.error || `MSG91 HTTP ${response.status}`) : (payload || `MSG91 HTTP ${response.status}`));
  }
  return payload;
}

async function syncReachoutWhatsAppFromMsg91(authKey) {
  const numbersPayload = await fetchMsg91Json(
    "https://control.msg91.com/api/v5/whatsapp/whatsapp-activation/",
    authKey
  );
  const whatsappNumbers = normalizeMsg91WhatsAppNumbersPayload(numbersPayload);
  const templates = [];

  for (const number of whatsappNumbers) {
    const urls = [
      `https://control.msg91.com/api/v5/whatsapp/get-template-plugins/?plugin=clevertap&number=${encodeURIComponent(number.number)}`,
      `https://control.msg91.com/api/v5/whatsapp/get-template-plugins/?plugin-clevertap&number=${encodeURIComponent(number.number)}`,
      `https://control.msg91.com/api/v5/whatsapp/get-templates/?number=${encodeURIComponent(number.number)}`
    ];
    let lastError = null;
    for (const url of urls) {
      try {
        const payload = await fetchMsg91Json(url, authKey);
        const syncedTemplates = normalizeMsg91WhatsAppTemplatesPayload(payload, number.number);
        templates.push(...syncedTemplates);
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError) {
      console.warn(`ReachOut template sync skipped for ${number.number}: ${lastError.message}`);
    }
  }

  const templatesByKey = new Map();
  templates.forEach((template) => {
    const key = `${template.integratedNumber || ""}:${template.templateName || template.name || ""}:${template.languageCode || "en"}`;
    if (!templatesByKey.has(key)) {
      templatesByKey.set(key, template);
    }
  });

  return {
    whatsappNumbers,
    templates: [...templatesByKey.values()]
  };
}

function normalizeMsg91Phone(phone, countryCode = "91") {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `${countryCode}${digits}`;
  return digits;
}

function getLeadReachoutVariables(lead = {}, session = null, extras = {}) {
  return {
    id: lead.id,
    name: lead.name || "",
    email: lead.email || "",
    phone: lead.phone || "",
    workshop: lead.workshop || lead.workshopName || "",
    campaign: lead.metaCampaignName || lead.metaAdsetName || lead.metaAdName || lead.elementorFormName || lead.importSourceSheet || "",
    location: lead.country || lead.city || lead.branch || lead.location || "",
    counselor: lead.counselor || "",
    course: lead.course || lead.registeredCourse || lead.mainAdmissionCourse || "",
    leadPipeline: lead.leadPipeline || "workshop",
    mediaUrl: String(extras.mediaUrl || "").trim(),
    buttonUrl: "https://go.dvanalyticsmds.com/dva01",
    senderName: session?.name || session?.email || session?.role || "CRM"
  };
}

function getReachoutStatusWebhookCallbackUrl(req) {
  const baseUrl = getPublicRequestBaseUrl(req);
  return baseUrl ? `${baseUrl}/api/reachout/whatsapp/webhook` : "/api/reachout/whatsapp/webhook";
}

function normalizeReachoutWebhookStatus(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[_-]+/g, " ");
  if (!normalized) return "updated";
  if (/(click|clicked|url clicked)/i.test(normalized)) return "clicked";
  if (/(reply|replied|inbound|customer message|user message)/i.test(normalized)) return "replied";
  if (/\b(read|seen)\b/i.test(normalized)) return "read";
  if (/\b(open|opened)\b/i.test(normalized)) return "opened";
  if (/(deliver|delivered)/i.test(normalized)) return "delivered";
  if (/(sent|submit|submitted|accepted|queued|dispatch)/i.test(normalized)) return "sent";
  if (/(fail|failed|error|bounce|undeliver|reject|expired)/i.test(normalized)) return "failed";
  return normalized.replace(/\s+/g, "_");
}

function normalizeReachoutStatusCode(value) {
  const code = String(value || "").trim();
  if (!code) return "";
  if (code === "5") return "read";
  if (code === "4") return "delivered";
  if (code === "3") return "sent";
  return "";
}

function normalizeReachoutWebhookEvent(body = {}) {
  const payload = body?.payload && typeof body.payload === "object" ? body.payload : body;
  const lead = payload?.lead && typeof payload.lead === "object" ? payload.lead : {};
  const template = payload?.template && typeof payload.template === "object" ? payload.template : {};
  const message = payload?.message && typeof payload.message === "object" ? payload.message : {};
  let parsedMessages = [];

  if (Array.isArray(payload.messages)) {
    parsedMessages = payload.messages;
  } else if (typeof payload.messages === "string" && payload.messages.trim()) {
    try {
      const parsed = JSON.parse(payload.messages);
      parsedMessages = Array.isArray(parsed) ? parsed : [];
    } catch {
      parsedMessages = [];
    }
  }

  const firstInboundMessage = parsedMessages[0] && typeof parsedMessages[0] === "object" ? parsedMessages[0] : {};
  const inferredClick = Boolean(
    String(payload.link || payload.shortUrl || payload.short_url || "").trim()
    || /clicked/i.test(String(payload.id || "").trim())
  );
  const inferredInboundReply = Boolean(
    String(payload.customerNumber || payload.customer_number || "").trim()
    && (
      String(payload.text || payload.body || "").trim()
      || String(firstInboundMessage?.text?.body || "").trim()
      || parsedMessages.length
    )
  );

  const rawStatus = [
    payload.status,
    payload.eventType,
    payload.event_type,
    payload.messageStatus,
    payload.message_status,
    payload.event,
    payload.eventName,
    payload.type,
    payload.action,
    payload.webhookType,
    body.status,
    body.eventType,
    body.event_type
  ].find((value) => String(value || "").trim()) || "";
  let normalizedStatus = normalizeReachoutWebhookStatus(rawStatus);
  if (!String(rawStatus || "").trim()) {
    if (inferredClick) normalizedStatus = "clicked";
    else if (inferredInboundReply) normalizedStatus = "replied";
    else normalizedStatus = normalizeReachoutStatusCode(payload.statusCode) || normalizedStatus;
  } else if (normalizedStatus === "updated") {
    if (inferredClick) normalizedStatus = "clicked";
    else if (inferredInboundReply) normalizedStatus = "replied";
    else normalizedStatus = normalizeReachoutStatusCode(payload.statusCode) || normalizedStatus;
  }

  return {
    raw: body,
    status: normalizedStatus,
    rawStatus: String(rawStatus || "").trim(),
    leadId: String(payload.leadId || payload.lead_id || lead.id || "").trim(),
    leadEmail: String(payload.leadEmail || payload.lead_email || lead.email || "").trim().toLowerCase(),
    phone: String(
      payload.phone ||
      payload.mobile ||
      payload.to ||
      payload.customerNumber ||
      payload.customer_number ||
      firstInboundMessage?.from ||
      lead.phone ||
      ""
    ).trim(),
    leadName: String(payload.leadName || payload.lead_name || payload.customerName || lead.name || "").trim(),
    counselorName: String(payload.counselorName || payload.counselor_name || lead.counselor || "").trim(),
    templateName: String(payload.templateName || payload.template_name || template.name || template.templateName || "").trim(),
    integratedNumber: String(payload.integratedNumber || payload.integrated_number || message.integratedNumber || "").replace(/\D/g, ""),
    providerMessageId: String(
      payload.id ||
      payload.messageId ||
      payload.message_id ||
      payload.uuid ||
      payload.requestId ||
      message.providerMessageId ||
      message.messageId ||
      firstInboundMessage?.id ||
      ""
    ).trim(),
    replyText: String(
      payload.replyText ||
      payload.reply_text ||
      payload.reply ||
      payload.text ||
      payload.body ||
      payload.reason ||
      payload.message ||
      firstInboundMessage?.text?.body ||
      ""
    ).trim(),
    occurredAt: String(
      payload.clickedAt ||
      payload.statusUpdatedAt ||
      payload.timestamp ||
      payload.ts ||
      payload.requestedAt ||
      payload.occurredAt ||
      payload.occurred_at ||
      body.timestamp ||
      ""
    ).trim(),
    clickedLink: String(payload.link || payload.shortUrl || payload.short_url || "").trim(),
    failureReason: String(payload.reason || payload.cleverTapErrorReason || payload.cleverTapErrorCode || payload.moEngageErrorCode || "").trim(),
    statusCode: String(payload.statusCode || "").trim()
  };
}

function buildReachoutWebhookActivity(normalizedEvent = {}) {
  const templateLabel = normalizedEvent.templateName ? ` using ${normalizedEvent.templateName}` : "";
  const replySuffix = normalizedEvent.replyText ? `: ${normalizedEvent.replyText}` : "";

  switch (normalizedEvent.status) {
    case "sent":
      return {
        activityType: "WhatsApp Sent",
        actionDescription: `WhatsApp message submitted${templateLabel}.`,
        newValue: normalizedEvent.providerMessageId || normalizedEvent.rawStatus || "Submitted"
      };
    case "delivered":
      return {
        activityType: "WhatsApp Delivered",
        actionDescription: `Lead received the WhatsApp message${templateLabel}.`,
        newValue: normalizedEvent.providerMessageId || "Delivered"
      };
    case "read":
      return {
        activityType: "WhatsApp Read",
        actionDescription: `Lead read the WhatsApp message${templateLabel}.`,
        newValue: normalizedEvent.providerMessageId || "Read"
      };
    case "opened":
      return {
        activityType: "WhatsApp Opened",
        actionDescription: `Lead opened the WhatsApp message${templateLabel}.`,
        newValue: normalizedEvent.providerMessageId || "Opened"
      };
    case "replied":
      return {
        activityType: "WhatsApp Replied",
        actionDescription: `Lead replied on WhatsApp${replySuffix}`,
        newValue: normalizedEvent.replyText || normalizedEvent.providerMessageId || "Reply received",
        remarks: normalizedEvent.templateName ? `Template: ${normalizedEvent.templateName}` : null
      };
    case "clicked":
      return {
        activityType: "WhatsApp Clicked",
        actionDescription: `Lead clicked the WhatsApp link${templateLabel}.`,
        newValue: normalizedEvent.clickedLink || normalizedEvent.providerMessageId || "Clicked"
      };
    case "failed":
      return {
        activityType: "WhatsApp Failed",
        actionDescription: `WhatsApp delivery failed${templateLabel}.`,
        newValue: normalizedEvent.failureReason || normalizedEvent.statusCode || normalizedEvent.rawStatus || "Failed"
      };
    default:
      return {
        activityType: "ReachOut Message",
        actionDescription: `WhatsApp status updated${templateLabel}: ${normalizedEvent.rawStatus || normalizedEvent.status || "updated"}.`,
        newValue: normalizedEvent.providerMessageId || normalizedEvent.rawStatus || "Updated"
      };
  }
}

async function isDuplicateReachoutWebhookActivity(leadId, activity = {}, normalizedEvent = {}) {
  if (!activityLogsCollection) {
    return false;
  }

  const activityType = String(activity.activityType || "").trim();
  const normalizedLeadId = String(leadId || "").trim();
  if (!activityType || !normalizedLeadId) {
    return false;
  }

  const dedupeWindowMs = activityType === "WhatsApp Replied" ? 2 * 60 * 1000 : 10 * 60 * 1000;
  const dedupeValues = [
    activity.newValue,
    normalizedEvent.providerMessageId,
    normalizedEvent.replyText,
    normalizedEvent.clickedLink
  ].map((value) => String(value || "").trim()).filter(Boolean);

  const query = {
    leadId: normalizedLeadId,
    activityType,
    performedBy: "ReachOut Webhook",
    timestamp: { $gte: new Date(Date.now() - dedupeWindowMs) }
  };

  if (dedupeValues.length) {
    query.newValue = { $in: [...new Set(dedupeValues)] };
  } else {
    query.actionDescription = String(activity.actionDescription || "").trim();
  }

  const existing = await withMongoRetry(
    () => activityLogsCollection.findOne(query, { sort: { timestamp: -1 } }),
    { retries: 1, label: "Check duplicate ReachOut webhook activity" }
  ).catch(() => null);

  return !!existing;
}

function interpolateReachoutText(text, variables) {
  return String(text || "").replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_match, key) => {
    const value = variables[key];
    return value === undefined || value === null ? "" : String(value);
  });
}

function parseVariableMappings(text, variables) {
  const entries = String(text || "")
    .split(/\r?\n|,/)
    .map((line) => line.trim())
    .filter(Boolean);
  return entries.reduce((acc, line) => {
    const [rawKey, ...rawValueParts] = line.split("=");
    const key = String(rawKey || "").trim();
    const rawValue = rawValueParts.join("=").trim();
    if (!key) return acc;
    if (rawValue.includes("{{")) {
      acc[key] = interpolateReachoutText(rawValue, variables);
    } else if (Object.prototype.hasOwnProperty.call(variables, rawValue)) {
      acc[key] = variables[rawValue] === undefined || variables[rawValue] === null ? "" : String(variables[rawValue]);
    } else {
      acc[key] = rawValue;
    }
    return acc;
  }, {});
}

function cleanWhatsAppComponentValue(value) {
  return String(value || "").trim().replace(/^\*+|\*+$/g, "");
}

function assertPublicHttpsUrl(value, message) {
  if (!/^https:\/\//i.test(String(value || "").trim())) {
    throw new Error(message);
  }
}

function buildWhatsAppComponent(key, value, schemaComponent = null, templateName = "selected template") {
  const componentKey = String(key || "").trim().toLowerCase();
  const componentValue = cleanWhatsAppComponentValue(value);
  const schemaType = normalizeWhatsAppComponentType(schemaComponent?.type, /^header/i.test(componentKey) ? "image" : "text");
  const schemaSubtype = String(schemaComponent?.subtype || "").trim().toLowerCase();
  const mediaTypes = new Set(["image", "video", "document"]);

  if (/^header/i.test(componentKey) && mediaTypes.has(schemaType)) {
    assertPublicHttpsUrl(
      componentValue,
      `Template ${templateName} needs a public HTTPS media URL for ${componentKey}. Re-sync the template or set a valid media URL before sending.`
    );
    return { type: schemaType, value: componentValue };
  }

  if (/^button/i.test(componentKey)) {
    if (schemaSubtype === "url") {
      assertPublicHttpsUrl(
        componentValue,
        `Template ${templateName} needs a valid HTTPS button URL for ${componentKey}.`
      );
    }
    return { subtype: schemaSubtype || "url", type: "text", value: componentValue };
  }

  return { type: "text", value: componentValue };
}

function buildWhatsAppComponents(mappedVariables, componentSchema = [], templateName = "selected template") {
  const cleanValue = (value) => String(value || "").trim().replace(/^\*+|\*+$/g, "");
  const schemaByKey = new Map((Array.isArray(componentSchema) ? componentSchema : [])
    .map((component) => [String(component?.key || "").trim().toLowerCase(), component]));
  return Object.entries(mappedVariables)
    .filter(([key]) => /^(header|body|button)_\d+$/i.test(key))
    .sort(([left], [right]) => {
      const order = { header: 0, body: 1, button: 2 };
      const [leftType, leftNumber] = left.toLowerCase().split("_");
      const [rightType, rightNumber] = right.toLowerCase().split("_");
      return (order[leftType] - order[rightType]) || (Number(leftNumber) - Number(rightNumber));
    })
    .reduce((components, [key, value]) => {
      const componentKey = key.toLowerCase();
      const schemaComponent = schemaByKey.get(componentKey) || null;
      components[componentKey] = buildWhatsAppComponent(componentKey, cleanValue(value), schemaComponent, templateName);
      return components;
    }, {});
}

function ensureSchemaComponentsInMappings(mappedVariables = {}, componentSchema = [], variables = {}) {
  const next = { ...mappedVariables };
  (Array.isArray(componentSchema) ? componentSchema : []).forEach((component, index) => {
    const key = String(component?.key || "").trim().toLowerCase();
    if (!/^(header|body|button)_\d+$/.test(key)) {
      return;
    }
    const isMediaHeader = /^header_\d+$/.test(key) && ["image", "video", "document"].includes(String(component?.type || "").toLowerCase());
    if (isMediaHeader) {
      next[key] = String(variables.mediaUrl || "").trim();
      return;
    }
    if (Object.prototype.hasOwnProperty.call(next, key)) return;
    const example = String(component.example || "").trim();
    const fallbackField = inferLeadFieldForComponent(key, index);
    next[key] = example || variables[fallbackField] || "";
  });
  return next;
}

function buildReachoutEndpoint(channel) {
  if (channel === "whatsapp") return "https://control.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/";
  return "";
}

function buildReachoutPayload({ template, lead, config, session, integratedNumber = "", mediaUrl = "" }) {
  const channel = String(template.channel || "").trim().toLowerCase();
  const variables = getLeadReachoutVariables(lead, session, { mediaUrl });
  const mappedVariables = ensureSchemaComponentsInMappings(
    parseVariableMappings(template.variableMappings, variables),
    template.componentSchema,
    variables
  );
  const phone = normalizeMsg91Phone(lead.phone, config.defaultCountryCode);

  if (template.payloadJson) {
    const rendered = interpolateReachoutText(template.payloadJson, { ...variables, ...mappedVariables, phone, integratedNumber });
    return JSON.parse(rendered);
  }

  if (channel === "whatsapp") {
    if (!phone) throw new Error("Lead phone number is missing.");
    const fromNumber = String(integratedNumber || template.integratedNumber || "").replace(/\D/g, "");
    if (!fromNumber || !template.templateName) {
      throw new Error("WhatsApp integrated number or template name is missing.");
    }
    return {
      integrated_number: fromNumber,
      content_type: "template",
      payload: {
        messaging_product: "whatsapp",
        type: "template",
        template: {
          name: template.templateName,
          language: { code: template.languageCode || "en", policy: "deterministic" },
          ...(template.namespace ? { namespace: template.namespace } : {}),
          to_and_components: [
            {
              to: [phone],
              components: buildWhatsAppComponents(mappedVariables, template.componentSchema, template.templateName || template.name)
            }
          ]
        }
      }
    };
  }

  throw new Error("ReachOut only supports WhatsApp templates.");
}

async function saveReachoutLog(entry) {
  const rawType = String(entry?.type || "error").trim().toLowerCase();
  const type = ["submitted", "success", "partial"].includes(rawType) ? rawType : "error";
  const sentAt = new Date().toISOString();
  const log = { id: String(entry?.id || crypto.randomUUID()), ...entry, type, sentAt: entry?.sentAt || sentAt };
  const summaryIncrements = {
    submitted: Math.max(0, Number(entry?.summaryIncrements?.submitted ?? ((type === "submitted" || type === "partial") ? 1 : 0)) || 0),
    error: Math.max(0, Number(entry?.summaryIncrements?.error ?? (type === "error" ? 1 : 0)) || 0)
  };
  await withMongoRetry(() => reachoutLogsCollection.insertOne(log), { retries: 1, label: "Write ReachOut log" });
  await withMongoRetry(
    () => reachoutConfigCollection.updateOne(
      { _id: REACHOUT_CONFIG_DOC_ID },
      {
        $inc: {
          "logSummary.submitted": summaryIncrements.submitted,
          "logSummary.success": summaryIncrements.submitted,
          "logSummary.error": summaryIncrements.error
        },
        $set: { updatedAt: sentAt },
        $setOnInsert: {
          enabled: true,
          authKey: process.env.MSG91_AUTH_KEY || "",
          defaultCountryCode: "91",
          templates: [],
          createdAt: new Date().toISOString()
        }
      },
      { upsert: true }
    ),
    { retries: 1, label: "Update ReachOut log summary" }
  );
}

function buildMcubeTokenSummary(token) {
  const payload = decodeJwtPayload(token);
  if (!payload) {
    return null;
  }

  const issuedAt = Number(payload?.iat) ? new Date(Number(payload.iat) * 1000).toISOString() : null;
  const expiresAt = Number(payload?.exp_data || payload?.exp)
    ? new Date(Number(payload.exp_data || payload.exp) * 1000).toISOString()
    : null;

  return {
    issuer: String(payload?.iss || "").trim(),
    audience: String(payload?.aud || "").trim(),
    businessId: String(payload?.data?.bid || "").trim(),
    issuedAt,
    expiresAt,
    isExpired: !!expiresAt && Date.parse(expiresAt) <= Date.now()
  };
}

function parseMcubeWebhookBody(rawBody) {
  if (!rawBody) {
    return null;
  }

  if (rawBody && typeof rawBody === "object" && !Buffer.isBuffer(rawBody)) {
    return rawBody;
  }

  const text = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody);
  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    const params = new URLSearchParams(text);
    if (!Array.from(params.keys()).length) {
      return null;
    }
    const result = {};
    for (const [key, value] of params.entries()) {
      result[key] = value;
    }
    return result;
  }
}

function parseMcubeWebhookRequestBody(req) {
  if (Buffer.isBuffer(req.body)) {
    return parseMcubeWebhookBody(req.body);
  }
  if (req.rawBody) {
    return parseMcubeWebhookBody(req.rawBody);
  }
  if (req.body && typeof req.body === "object") {
    return req.body;
  }
  return null;
}

function verifyMcubeWebhookSignature(rawBody, req, secret) {
  if (!secret || !rawBody) {
    return true;
  }

  const candidateHeaders = [
    req.headers["x-mcube-signature"],
    req.headers["x-signature"],
    req.headers["x-webhook-signature"]
  ].filter(Boolean);

  if (!candidateHeaders.length) {
    return false;
  }

  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  return candidateHeaders.some((headerValue) => {
    const raw = String(headerValue || "").trim();
    const normalized = raw.includes("=") ? raw.split("=").pop() : raw;
    try {
      const providedBuf = Buffer.from(normalized, "hex");
      const expectedBuf = Buffer.from(expected, "hex");
      return providedBuf.length === expectedBuf.length && crypto.timingSafeEqual(providedBuf, expectedBuf);
    } catch {
      return false;
    }
  });
}

function normalizeMcubeDirection(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized.includes("in")) return "inbound";
  if (normalized.includes("out")) return "outbound";
  return normalized;
}

function parseMcubeDurationSeconds(value) {
  if (value === null || value === undefined || value === "") return 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return Math.round(numeric);

  const text = String(value).trim();
  const timeMatch = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!timeMatch) return 0;
  const first = Number(timeMatch[1]);
  const second = Number(timeMatch[2]);
  const third = Number(timeMatch[3] || 0);
  return timeMatch[3] ? (first * 3600) + (second * 60) + third : (first * 60) + second;
}

function parseMcubeTimestampMs(value) {
  const text = String(value || "").trim();
  if (!text) return 0;
  const nativeDate = new Date(text);
  if (!Number.isNaN(nativeDate.getTime())) return nativeDate.getTime();

  const match = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!match) return 0;
  const [, day, month, year, hour = "0", minute = "0", second = "0"] = match;
  const parsedDate = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  return Number.isNaN(parsedDate.getTime()) ? 0 : parsedDate.getTime();
}

function isMcubeConnectedDisposition(value = "") {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return false;
  if (/(cancel|missed|no\s*answer|unanswered|busy|failed|reject|declin|timeout|not\s*reachable|switched\s*off|\bdnp\b|\bcnc\b)/i.test(text)) {
    return false;
  }
  return /(answer|answered|connected|success|completed)/i.test(text);
}

function deriveMcubeTalkTimeDuration(payload = {}, startedAt = "", endedAt = "", answeredTime = "") {
  const disposition = String(
    payload.dialstatus ||
    payload.disposition ||
    payload.call_status ||
    payload.callStatus ||
    payload.status ||
    payload.event_type ||
    payload.eventType ||
    ""
  ).trim();
  if (!isMcubeConnectedDisposition(disposition)) {
    return 0;
  }

  const explicitDuration = parseMcubeDurationSeconds(
    payload.duration ||
    payload.call_duration ||
    payload.callDuration ||
    payload.talktime ||
    payload.talk_time ||
    payload.talkTime ||
    payload.recording_duration ||
    payload.recordingDuration
  );
  if (explicitDuration) return explicitDuration;

  const endMs = parseMcubeTimestampMs(endedAt);
  const answerMs = parseMcubeTimestampMs(answeredTime);
  if (endMs && answerMs && endMs > answerMs) {
    return Math.round((endMs - answerMs) / 1000);
  }

  const startMs = parseMcubeTimestampMs(startedAt);
  const answerOffsetSeconds = parseMcubeDurationSeconds(answeredTime);
  if (endMs && startMs && endMs > startMs && answerOffsetSeconds) {
    return Math.max(0, Math.round((endMs - startMs) / 1000) - answerOffsetSeconds);
  }
  if (endMs && startMs && endMs > startMs) {
    return Math.round((endMs - startMs) / 1000);
  }

  return 0;
}

function normalizeMcubeEvent(body = {}) {
  const payload = body?.payload && typeof body.payload === "object" ? body.payload : body;
  const metadata = payload?.metadata && typeof payload.metadata === "object" ? payload.metadata : {};
  const callId = String(payload.callid || payload.call_id || payload.callId || payload.uuid || payload.id || "").trim();
  const customerPhone = String(
    payload.callto ||
    payload.customer_number ||
    payload.customerNumber ||
    payload.custnumber ||
    payload.phone ||
    payload.mobile ||
    payload.to ||
    payload.from ||
    metadata.phone ||
    ""
  ).trim();
  const disposition = String(payload.dialstatus || payload.disposition || payload.call_status || payload.callStatus || payload.status || "").trim();
  const recordingUrl = String(payload.filename || payload.recording_url || payload.recordingUrl || payload.recording || "").trim();
  const startedAt = String(payload.starttime || payload.started_at || payload.start_time || payload.startTime || payload.timestamp || "").trim();
  const endedAt = String(payload.endtime || payload.ended_at || payload.end_time || payload.endTime || "").trim();
  const answeredTime = String(payload.answeredtime || payload.answered_time || payload.answerTime || "").trim();
  const agentName = String(payload.agentname || payload.agent_name || payload.agent || payload.executive_name || metadata.counselorName || "").trim();
  const duration = deriveMcubeTalkTimeDuration(payload, startedAt, endedAt, answeredTime);

  return {
    raw: body,
    eventType: String(payload.event_type || payload.eventType || payload.type || payload.action || payload.status || payload.dialstatus || "").trim(),
    direction: normalizeMcubeDirection(payload.direction || payload.call_direction || payload.callDirection || payload.type),
    disposition,
    callId,
    leadId: String(payload.lead_id || payload.leadId || payload.crm_lead_id || metadata.leadId || metadata.lead_id || "").trim(),
    phone: customerPhone,
    recordingUrl,
    notes: String(payload.notes || payload.remark || payload.remarks || payload.description || "").trim(),
    duration,
    startedAt,
    endedAt,
    answeredTime,
    agentPhone: String(payload.emp_phone || payload.agent_phone || payload.agentPhone || payload.exenumber || "").trim(),
    didNumber: String(payload.clicktocalldid || payload.did || payload.did_number || "").trim(),
    disconnectedBy: String(payload.disconnectedby || payload.disconnected_by || "").trim(),
    groupName: String(payload.groupname || payload.group_name || "").trim(),
    counselorName: agentName,
    counselorEmail: String(payload.agent_email || metadata.counselorEmail || "").trim().toLowerCase(),
    mcubeFields: {
      starttime: String(payload.starttime || "").trim(),
      endtime: String(payload.endtime || "").trim(),
      answeredtime: String(payload.answeredtime || "").trim(),
      callid: String(payload.callid || "").trim(),
      emp_phone: String(payload.emp_phone || "").trim(),
      clicktocalldid: String(payload.clicktocalldid || "").trim(),
      callto: String(payload.callto || "").trim(),
      dialstatus: String(payload.dialstatus || "").trim(),
      filename: String(payload.filename || "").trim(),
      direction: String(payload.direction || "").trim(),
      disconnectedby: String(payload.disconnectedby || "").trim(),
      groupname: String(payload.groupname || "").trim(),
      agentname: String(payload.agentname || "").trim()
    }
  };
}

function mapMcubeDispositionToCrmStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";
  if (/(callback|call\s*back|\bcbl\b)/i.test(normalized)) return "CBL";
  if (/(connected|answered|completed|success)/i.test(normalized)) return "Connected";
  if (/(no\s*answer|unanswered|ringing|timeout|\bcnc\b)/i.test(normalized)) return "CNC";
  if (/(busy|dnp|do\s*not\s*pick|rejected|failed|switched\s*off|not\s*reachable)/i.test(normalized)) return "DNP";
  return String(value || "").trim();
}

function inferLeadStageForCallUpdate(lead = {}) {
  if (isMainAdmissionLead(lead)) {
    return {
      stage: "main-admission",
      dialedField: "mainAdmissionDialed",
      statusField: "mainAdmissionCallStatus"
    };
  }
  if (isPublicCourseRegistrationLead(lead)) {
    return {
      stage: "registered-course",
      dialedField: "registeredDialed",
      statusField: "registeredCallStatus"
    };
  }
  if (String(lead?.leadPipeline || "").trim().toLowerCase() === "admission" || lead?.postStatusUpdated) {
    return {
      stage: "admission",
      dialedField: "postDialed",
      statusField: "postCallStatus"
    };
  }
  return {
    stage: "workshop",
    dialedField: "dialed",
    statusField: "callStatus"
  };
}

function findLeadByPhone(state, phone) {
  const normalizedPhone = normalizeLeadPhone(phone);
  if (!normalizedPhone) {
    return null;
  }
  return (Array.isArray(state?.leads) ? state.leads : []).find(
    (lead) => normalizeLeadPhone(lead?.phone) === normalizedPhone
  ) || null;
}

function getMcubeExecutiveNumber(counselor = {}, session = {}, config = {}) {
  const candidates = [
    counselor?.mcubeExecutiveNumber,
    counselor?.executiveNumber,
    counselor?.phone,
    counselor?.mobile,
    session?.mcubeExecutiveNumber,
    session?.phone,
    config?.defaultExecutiveNumber
  ];
  return String(candidates.find((value) => String(value || "").trim()) || "").trim();
}

function isMcubeVmcEndpoint(endpointUrl) {
  const host = String(endpointUrl?.hostname || "").toLowerCase();
  const pathname = String(endpointUrl?.pathname || "").toLowerCase();
  return host.includes("vmc.in") || pathname.includes("/api/outboundcall");
}

function buildMcubeClickToCallRequest(config = {}, requestPayload = {}, forcedVmc = false) {
  const configuredMethod = String(config.clickToCallMethod || "POST").trim().toUpperCase() || "POST";
  const baseUrl = forcedVmc ? "https://mcube.vmc.in" : config.apiBaseUrl;
  const path = forcedVmc ? "/api/outboundcall" : config.clickToCallPath;
  const endpointUrl = new URL(path, baseUrl);
  const useVmc = forcedVmc || isMcubeVmcEndpoint(endpointUrl);
  const method = useVmc ? "GET" : configuredMethod;
  const params = useVmc
    ? {
        apikey: requestPayload.HTTP_AUTHORIZATION,
        exenumber: requestPayload.exenumber,
        custnumber: requestPayload.custnumber,
        url: requestPayload.refurl
      }
    : requestPayload;
  const body = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (!value) return;
    if (method === "GET") {
      endpointUrl.searchParams.set(key, value);
    } else {
      body.set(key, value);
    }
  });

  return {
    endpoint: endpointUrl.toString(),
    method,
    body: method === "GET" ? null : JSON.stringify(requestPayload),
    contentType: method === "GET" ? "" : "application/json",
    offering: useVmc ? "vmc" : "cloud"
  };
}

function normalizeMcubeDialNumber(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length > 10 && digits.startsWith("91")) return digits.slice(-10);
  return digits;
}

function looksLikeMcubeToken(value) {
  const text = String(value || "").trim();
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(text) || /^eyJ[A-Za-z0-9_-]{20,}/.test(text);
}

function validateMcubeEndpointConfig(config = {}) {
  const apiBaseUrl = String(config.apiBaseUrl || "").trim();
  const clickToCallPath = String(config.clickToCallPath || "").trim();
  const errors = [];

  if (looksLikeMcubeToken(apiBaseUrl)) {
    errors.push("API Base URL looks like an MCUBE account token. Use https://api.mcube.com there.");
  }
  if (looksLikeMcubeToken(clickToCallPath)) {
    errors.push("Click-to-Call Path looks like an MCUBE account token. Use /Restmcube-api/outbound-calls there and put the token only in Account Token.");
  }

  if (apiBaseUrl) {
    try {
      const url = new URL(apiBaseUrl);
      if (!["http:", "https:"].includes(url.protocol)) {
        errors.push("API Base URL must start with http:// or https://.");
      }
    } catch {
      errors.push("API Base URL must be a valid URL, for example https://api.mcube.com.");
    }
  }

  if (clickToCallPath && !clickToCallPath.startsWith("/")) {
    errors.push("Click-to-Call Path must start with /, for example /Restmcube-api/outbound-calls.");
  }
  if (/^https?:\/\//i.test(clickToCallPath)) {
    errors.push("Click-to-Call Path should not be a full URL. Put https://api.mcube.com in API Base URL and /Restmcube-api/outbound-calls in Click-to-Call Path.");
  }

  return errors;
}

function isSuccessfulMcubeClickToCallResponse(parsed, text, offering) {
  const bodyText = String(text || "").trim().toLowerCase();
  const status = String(parsed?.status || "").trim().toLowerCase();
  const message = String(parsed?.msg || parsed?.message || "").trim().toLowerCase();
  const callId = String(parsed?.callid || parsed?.callId || parsed?.called || "").trim();
  if (offering === "cloud") {
    return status === "succ" || status === "success" || !!callId;
  }
  if (offering === "vmc") {
    return message.includes("success") || status === "success" || !!callId;
  }
  return /\b(success|succ)\b/i.test(bodyText);
}

function buildMcubeActivityMetadata(event = {}, extra = {}) {
  return {
    provider: "MCUBE",
    callId: String(event?.callId || extra.callId || "").trim(),
    callDirection: String(event?.direction || extra.callDirection || "").trim(),
    callStatus: String(event?.disposition || extra.callStatus || "").trim(),
    normalizedCallStatus: String(extra.normalizedStatus || "").trim(),
    recordingUrl: String(event?.recordingUrl || extra.recordingUrl || "").trim(),
    agentName: String(event?.counselorName || extra.agentName || "").trim(),
    agentPhone: String(event?.agentPhone || extra.agentPhone || "").trim(),
    customerPhone: String(event?.phone || extra.customerPhone || "").trim(),
    duration: Number(event?.duration || extra.duration || 0) || 0,
    startedAt: String(event?.startedAt || extra.startedAt || "").trim(),
    endedAt: String(event?.endedAt || extra.endedAt || "").trim()
  };
}

function sanitizeMcubeEndpointForLog(endpoint) {
  try {
    const url = new URL(endpoint);
    ["apikey", "apiKey", "HTTP_AUTHORIZATION"].forEach((key) => {
      if (url.searchParams.has(key)) url.searchParams.set(key, "[redacted]");
    });
    return url.toString();
  } catch {
    return String(endpoint || "").replace(/(apikey|apiKey|HTTP_AUTHORIZATION)=([^&]+)/gi, "$1=[redacted]");
  }
}

function buildMcubeAttemptLog(request, response, text) {
  return {
    offering: request?.offering || "",
    method: request?.method || "",
    endpoint: sanitizeMcubeEndpointForLog(request?.endpoint || ""),
    httpStatus: Number(response?.status) || 0,
    response: String(text || "").trim().slice(0, 300) || "[empty]"
  };
}

function describeFailedMcubeAttempts(attempts = []) {
  const parts = attempts.map((attempt) => {
    const responseText = attempt.response === "[empty]" ? "empty response" : `response: ${attempt.response}`;
    const endpointText = attempt.endpoint ? ` at ${attempt.endpoint}` : "";
    return `${attempt.offering || "unknown"} ${attempt.method || ""}${endpointText} returned HTTP ${attempt.httpStatus || "?"} with ${responseText}`.trim();
  }).filter(Boolean);
  return parts.length ? parts.join("; ") : "No MCUBE response details available.";
}

function normalizeMcubePhone(value) {
  return String(value || "").replace(/\D/g, "").slice(-10);
}

function findMcubeAnsweringCounselor(counselorSource, event = {}) {
  const sourceList = Array.isArray(counselorSource)
    ? counselorSource
    : Array.isArray(counselorSource?.counselors)
      ? counselorSource.counselors
      : [];
  const agentName = String(event?.counselorName || "").trim().toLowerCase();
  const agentEmail = String(event?.counselorEmail || "").trim().toLowerCase();
  const agentPhone = normalizeMcubePhone(event?.agentPhone);

  return sourceList.find((counselor) => {
    const name = String(counselor?.name || "").trim().toLowerCase();
    const email = String(counselor?.email || "").trim().toLowerCase();
    const phoneCandidates = [
      counselor?.mcubeExecutiveNumber,
      counselor?.executiveNumber,
      counselor?.phone,
      counselor?.mobile
    ].map(normalizeMcubePhone).filter(Boolean);

    return (agentEmail && email === agentEmail)
      || (agentName && name === agentName)
      || (agentPhone && phoneCandidates.includes(agentPhone));
  }) || null;
}

function didMcubeCallGetPicked(event = {}) {
  const disposition = String(event?.disposition || event?.eventType || "").trim();
  if (disposition) {
    return isMcubeConnectedDisposition(disposition);
  }
  return !!String(event?.answeredTime || "").trim();
}

function getMcubeLeadAssignment(event = {}, counselorSource) {
  if (!didMcubeCallGetPicked(event)) {
    return {
      counselorName: "Unassigned",
      pickedBy: "",
      pickedByPhone: "",
      assignmentNote: "No one picked the MCUBE call. Lead is waiting for admin assignment."
    };
  }

  const matchedCounselor = findMcubeAnsweringCounselor(counselorSource, event);
  const pickedBy = String(event?.counselorName || matchedCounselor?.name || "").trim();
  const assignedCounselorName = String(matchedCounselor?.name || "").trim();
  return {
    counselorName: assignedCounselorName || "Unassigned",
    pickedBy,
    pickedByPhone: String(event?.agentPhone || "").trim(),
    assignmentNote: assignedCounselorName
      ? `Assigned to the CRM counselor who picked the MCUBE call: ${assignedCounselorName}.`
      : "Call was answered, but the MCUBE agent does not match any counselor in the CRM."
  };
}

function buildMcubeLead(event, assignment, nextId) {
  const now = new Date().toISOString();
  const phone = String(event?.phone || "").trim();
  const counselorName = String(assignment?.counselorName || "").trim() || "Unassigned";
  return {
    id: nextId,
    name: "",
    email: "",
    phone,
    source: "MCUBE",
    leadSource: "MCUBE",
    counselor: counselorName,
    leadPipeline: MAIN_ADMISSION_PIPELINE,
    createdAt: now,
    updatedAt: now,
    mainAdmissionDialed: "",
    mainAdmissionCoursePitched: "",
    mainAdmissionCourseStatus: "",
    mainAdmissionAdmissionStatus: "",
    mainAdmissionCallStatus: "",
    mainAdmissionActivityUpdated: false,
    mainAdmissionActivityUpdates: 0,
    mainAdmissionActivityHistory: [],
    admissionSopAssignedAt: shouldTreatLeadAsAssigned(counselorName) ? now : null,
    admissionSopLastProgressAt: null,
    mcubeAutoCreated: true,
    mcubePickedBy: String(assignment?.pickedBy || "").trim(),
    mcubePickedByPhone: String(assignment?.pickedByPhone || "").trim(),
    mcubeAssignmentNote: String(assignment?.assignmentNote || "").trim(),
    mcubeLastEventType: String(event?.eventType || "").trim(),
    mcubeLastCallId: String(event?.callId || "").trim()
  };
}

function isMcubeCallbackStatus(status) {
  return String(status || "").trim().toUpperCase() === "CBL";
}

function verifyWebhookSignature(rawBody, signatureHeader, appSecret) {
  if (!signatureHeader || !appSecret) return false;
  const parts = String(signatureHeader).split("=");
  if (parts.length < 2 || parts[0] !== "sha256") return false;
  try {
    const expected = crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
    const providedBuf = Buffer.from(parts[1], "hex");
    const expectedBuf = Buffer.from(expected, "hex");
    if (providedBuf.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(providedBuf, expectedBuf);
  } catch {
    return false;
  }
}

function signWebhookPayload(rawBody, appSecret) {
  if (!appSecret) return "";
  return `sha256=${crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
}

function parseMetaWebhookBody(rawBody) {
  if (!rawBody) return null;

  const text = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody);
  if (!text.trim()) return null;

  try {
    return JSON.parse(text);
  } catch {
    const firstObject = text.indexOf("{");
    const firstArray = text.indexOf("[");
    const starts = [firstObject, firstArray].filter((index) => index !== -1).sort((a, b) => a - b);
    if (!starts.length) return null;

    const trimmed = text.slice(starts[0]).trim();
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
}

function parseMetaWebhookRequestBody(req) {
  if (Buffer.isBuffer(req.body)) {
    return parseMetaWebhookBody(req.body);
  }
  if (req.rawBody) {
    return parseMetaWebhookBody(req.rawBody);
  }
  if (req.body && typeof req.body === "object") {
    return req.body;
  }
  return null;
}

function normalizeMetaLabel(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const WORKSHOP_MONTH_LOOKUP = {
  jan: "January",
  january: "January",
  feb: "February",
  february: "February",
  mar: "March",
  march: "March",
  apr: "April",
  april: "April",
  may: "May",
  jun: "June",
  june: "June",
  jul: "July",
  july: "July",
  aug: "August",
  august: "August",
  sep: "September",
  sept: "September",
  september: "September",
  oct: "October",
  october: "October",
  nov: "November",
  november: "November",
  dec: "December",
  december: "December"
};

const WORKSHOP_TOPIC_PATTERNS = [
  { pattern: /\bpower\s*bi\b|\bpowerbi\b/i, label: "Power BI", slug: "power-bi" },
  { pattern: /\bcyber\s*security\b|\bcybersecurity\b/i, label: "Cyber Security", slug: "cyber-security" },
  { pattern: /\bcyber\s*ai\b|\bcyberai\b/i, label: "Cyber Security", slug: "cyber-security" },
  { pattern: /\bgen\s*ai\b|\bgenai\b/i, label: "Gen AI", slug: "gen-ai" },
  { pattern: /\bexcel\b/i, label: "Excel", slug: "excel" },
  { pattern: /\bpython\b/i, label: "Python", slug: "python" },
  { pattern: /\bsql\b/i, label: "SQL", slug: "sql" }
];

const WORKSHOP_QUALIFIER_PATTERNS = [
  { pattern: /\bdubai\b/i, label: "Dubai", slug: "dubai" }
];

function toTitleCaseWords(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\b([a-z])/g, (match) => match.toUpperCase());
}

function slugifyWorkshopPart(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatOrdinalDay(day) {
  const normalizedDay = Number(day);
  if (!Number.isFinite(normalizedDay)) {
    return "";
  }

  const remainder = normalizedDay % 100;
  if (remainder >= 11 && remainder <= 13) {
    return `${normalizedDay}th`;
  }

  switch (normalizedDay % 10) {
    case 1:
      return `${normalizedDay}st`;
    case 2:
      return `${normalizedDay}nd`;
    case 3:
      return `${normalizedDay}rd`;
    default:
      return `${normalizedDay}th`;
  }
}

function normalizeWorkshopSourceText(value) {
  return String(value || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2")
    .replace(/\b(\d{1,2})\s+(st|nd|rd|th)\b/gi, "$1$2")
    .replace(/[()]+/g, " ")
    .replace(/[_-]+/g, " ")
    .replace(/\b(workshop|webinar|masterclass|bootcamp|session|image|images|lead|leads|campaign|meta|form)\b/gi, " ")
    .replace(/\b(ind|od|imp)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseWorkshopDateDetails(value) {
  const normalized = normalizeWorkshopSourceText(value);
  const directMatch = normalized.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i);
  if (directMatch) {
    const monthName = WORKSHOP_MONTH_LOOKUP[String(directMatch[2] || "").toLowerCase()];
    const day = Number(directMatch[1]);
    if (monthName && Number.isFinite(day)) {
      return {
        day,
        monthName,
        label: `${formatOrdinalDay(day)} ${monthName}`,
        key: `${monthName.toLowerCase()}-${String(day).padStart(2, "0")}`,
        matchText: directMatch[0]
      };
    }
  }

  const reverseMatch = normalized.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i);
  if (reverseMatch) {
    const monthName = WORKSHOP_MONTH_LOOKUP[String(reverseMatch[1] || "").toLowerCase()];
    const day = Number(reverseMatch[2]);
    if (monthName && Number.isFinite(day)) {
      return {
        day,
        monthName,
        label: `${formatOrdinalDay(day)} ${monthName}`,
        key: `${monthName.toLowerCase()}-${String(day).padStart(2, "0")}`,
        matchText: reverseMatch[0]
      };
    }
  }

  return null;
}

function buildWorkshopIdentity(workshopName) {
  const cleaned = normalizeWorkshopSourceText(workshopName);
  if (!cleaned) {
    return {
      label: "",
      key: "",
      dateLabel: "",
      topicLabel: "",
      topicKey: "",
      dateKey: ""
    };
  }

  const dateDetails = parseWorkshopDateDetails(cleaned);
  let remaining = cleaned;
  if (dateDetails?.matchText) {
    remaining = remaining.replace(dateDetails.matchText, " ").replace(/\s+/g, " ").trim();
  }

  let topicLabel = "";
  let topicSlug = "";
  for (const topic of WORKSHOP_TOPIC_PATTERNS) {
    if (topic.pattern.test(remaining)) {
      topicLabel = topic.label;
      topicSlug = topic.slug;
      remaining = remaining.replace(topic.pattern, " ").replace(/\s+/g, " ").trim();
      break;
    }
  }

  const qualifierLabels = [];
  for (const qualifier of WORKSHOP_QUALIFIER_PATTERNS) {
    if (qualifier.pattern.test(remaining)) {
      qualifierLabels.push(qualifier.label);
      remaining = remaining.replace(qualifier.pattern, " ").replace(/\s+/g, " ").trim();
    }
  }

  const extraQualifier = toTitleCaseWords(remaining);
  if (extraQualifier) {
    qualifierLabels.push(extraQualifier);
  }

  const fallbackLabel = topicLabel || toTitleCaseWords(cleaned);
  const labelParts = [fallbackLabel, dateDetails?.label].filter(Boolean);
  const keyParts = [
    topicSlug || slugifyWorkshopPart(fallbackLabel),
    dateDetails?.key
  ].filter(Boolean);

  return {
    label: labelParts.join(" ").trim(),
    key: keyParts.join("-").trim(),
    dateLabel: dateDetails?.label || "",
    topicLabel: fallbackLabel,
    topicKey: topicSlug || slugifyWorkshopPart(fallbackLabel),
    dateKey: dateDetails?.key || "",
    qualifiers: qualifierLabels
  };
}

function normalizeCourseSourceText(value) {
  return String(value || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/[()]+/g, " ")
    .replace(/\b(adset|asset|ads?|campaign|broad|interest|audience|retargeting|instantform|test|blr|bbsr|odisha|india|ind|od|dubai)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildCourseIdentity(value, lead = {}) {
  const descriptor = normalizeCourseSourceText([
    value,
    lead?.courseId,
    lead?.courseCode,
    lead?.metaAdName,
    lead?.metaAdsetName,
    lead?.metaCampaignName,
    lead?.elementorFormName,
    lead?.elementorPageUrl
  ].filter(Boolean).join(" "));

  if (!descriptor) {
    return {
      label: "",
      key: "",
      rawLabel: ""
    };
  }

  for (const rule of COURSE_IDENTITY_RULES) {
    if (rule.pattern.test(descriptor)) {
      return {
        label: rule.label,
        key: rule.key,
        rawLabel: normalizeMetaLabel(value)
      };
    }
  }

  const fallbackLabel = toTitleCaseWords(descriptor);
  return {
    label: fallbackLabel,
    key: slugifyWorkshopPart(fallbackLabel),
    rawLabel: normalizeMetaLabel(value)
  };
}

function isKnownPublicCourseIdentity(courseIdentity = {}) {
  return Boolean(
    courseIdentity.key
    && PUBLIC_COURSE_CATALOG.some((course) => course.id === courseIdentity.key)
  );
}

function getAdmissionRoutingCourseName(rawCourseName = "", courseIdentity = {}) {
  if (isKnownPublicCourseIdentity(courseIdentity)) {
    return courseIdentity.label || courseIdentity.key || rawCourseName;
  }

  return rawCourseName;
}

function getMetaLeadFieldMap(fieldData = []) {
  const fields = {};
  (fieldData || []).forEach(({ name, values }) => {
    fields[String(name).toLowerCase().replace(/[^a-z0-9]+/g, "_")] = (values || [])[0] ?? "";
  });
  return fields;
}

function getMetaLeadDescriptor(fields = {}, meta = {}) {
  return [
    fields.lead_type,
    fields.type,
    fields.intent,
    fields.pipeline,
    fields.source_type,
    fields.form_type,
    fields.workshop,
    fields.workshop_name,
    fields.workshop_title,
    fields.workshop_topic,
    fields.course,
    fields.course_name,
    fields.program,
    meta.adName,
    meta.adsetName,
    meta.campaignName
  ].map((value) => normalizeMetaLabel(value).toLowerCase()).filter(Boolean).join(" ");
}

function classifyIncomingMetaLead(fields = {}, meta = {}) {
  const descriptor = getMetaLeadDescriptor(fields, meta);
  const hasWorkshopSignal = /\b(workshop|webinar|masterclass|bootcamp|demo class|session)\b/i.test(descriptor);
  const hasCourseCatalogSignal = /\b(apids|apida|apcs|das|aiml|genai|gen ai|7days|7 days)\b/i.test(descriptor);
  const hasAdmissionSignal = /\b(admission|admissions|enroll|enrol|course|program|programme|counselling|counseling|brochure|fees|career|certification|adv ai ml|advanced ai ml|ai ml|data analytics|data science|cybersecurity|cyber security|full stack)\b/i.test(descriptor);

  if (hasCourseCatalogSignal) {
    return "admission";
  }

  if (hasWorkshopSignal) {
    return "workshop";
  }

  return hasAdmissionSignal || descriptor ? "admission" : "workshop";
}

function getElementorFieldMap(body = {}) {
  return Object.entries(body || {}).reduce((fields, [key, value]) => {
    const normalizedKey = String(key || "").toLowerCase().replace(/[^a-z0-9]+/g, "_");
    fields[normalizedKey] = Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "");
    return fields;
  }, {});
}

function normalizeRuleList(values = []) {
  return (Array.isArray(values) ? values : [])
    .map((value) => normalizeMetaLabel(value).toLowerCase())
    .filter(Boolean);
}

function matchNormalizedRule(value, rules = []) {
  const normalizedValue = normalizeMetaLabel(value).toLowerCase();
  if (!normalizedValue) {
    return false;
  }
  return normalizeRuleList(rules).includes(normalizedValue);
}

function matchPatternRule(value, rules = []) {
  const normalizedValue = normalizeMetaLabel(value).toLowerCase();
  if (!normalizedValue) {
    return false;
  }
  return normalizeRuleList(rules).some((rule) => normalizedValue.includes(rule));
}

function getElementorLeadDescriptor(fields = {}, meta = {}) {
  return [
    fields.lead_type,
    fields.type,
    fields.intent,
    fields.pipeline,
    fields.source_type,
    fields.form_type,
    fields.course,
    fields.course_name,
    fields.program,
    fields.page_url,
    fields.form_name,
    meta.formName,
    meta.pageUrl
  ].map((value) => normalizeMetaLabel(value).toLowerCase()).filter(Boolean).join(" ");
}

function classifyIncomingElementorLead(fields = {}, meta = {}, config = {}) {
  if (matchNormalizedRule(meta.formId, config.workshopFormIds) || matchNormalizedRule(meta.formName, config.workshopFormNames)) {
    return "workshop";
  }
  if (matchNormalizedRule(meta.formId, config.admissionFormIds) || matchNormalizedRule(meta.formName, config.admissionFormNames)) {
    return "admission";
  }
  if (matchPatternRule(meta.pageUrl, config.workshopPagePatterns)) {
    return "workshop";
  }
  if (matchPatternRule(meta.pageUrl, config.admissionPagePatterns)) {
    return "admission";
  }

  const descriptor = getElementorLeadDescriptor(fields, meta);
  const hasCrashCourseSignal = /\b(crash course|crash-course)\b/i.test(descriptor);
  const hasWorkshopSignal = /\b(workshop|webinar|masterclass|bootcamp|demo class|session)\b/i.test(descriptor);
  const hasCourseCatalogSignal = /\b(apids|apida|apcs|das|aiml|genai|gen ai|7days|7 days)\b/i.test(descriptor);
  const hasAdmissionSignal = /\b(admission|admissions|enroll|enrol|course|program|programme|counselling|counseling|brochure|fees|career|certification|adv ai ml|advanced ai ml|ai ml|data analytics|data science|cybersecurity|cyber security|full stack)\b/i.test(descriptor);

  if (hasCourseCatalogSignal || hasCrashCourseSignal) {
    return "admission";
  }

  if (hasWorkshopSignal) {
    return "workshop";
  }

  return hasAdmissionSignal || descriptor ? "admission" : "workshop";
}

function inferElementorProgram(fields = {}, meta = {}, leadType = "workshop") {
  const preferredCandidates = [
    fields.course,
    fields.course_name,
    fields.course_title,
    fields.program,
    fields.program_name,
    fields.program_title,
    fields.selected_course,
    fields.select_course,
    fields.course_pitched,
    fields.workshop,
    fields.workshop_name,
    fields.workshop_title,
    fields.workshop_topic
  ].map((value) => normalizeMetaLabel(value)).filter(Boolean);

  const dynamicCandidates = Object.entries(fields || {})
    .filter(([key, value]) => {
      if (!value) {
        return false;
      }
      return /(^|_)(course|program|workshop|training|bootcamp|masterclass|webinar|session|career)(_|$)/i.test(String(key || ""));
    })
    .map(([, value]) => normalizeMetaLabel(value))
    .filter(Boolean);

  const metaCandidates = [
    meta.formName,
    meta.pageUrl,
    fields.page_url
  ].map((value) => normalizeMetaLabel(value)).filter(Boolean);

  const orderedCandidates = [...new Set([...preferredCandidates, ...dynamicCandidates, ...metaCandidates])];
  const canonicalCandidate = orderedCandidates.find((candidate) => isKnownPublicCourseIdentity(buildCourseIdentity(candidate, {
    elementorFormName: meta.formName,
    elementorPageUrl: meta.pageUrl
  })));
  const rawProgram = canonicalCandidate || orderedCandidates[0] || "";
  const normalized = normalizeMetaLabel(rawProgram);

  if (!normalized && leadType === "workshop") {
    return "Elementor Workshop";
  }
  return normalized;
}

function isCounselorInMetaRotation(counselor) {
  return counselor?.roundRobinEnabled !== false && !counselor?.disabled;
}

function isCounselorInAdmissionRotation(counselor) {
  return counselor?.admissionRoundRobinEnabled === true && !counselor?.disabled;
}

const ODISHA_LOCATION_PATTERN = new RegExp([
  "\\bodisha\\b",
  "\\borissa\\b",
  "\\bod\\b",
  "\\bangul\\b",
  "\\bathagarh\\b",
  "\\bbalangir\\b",
  "\\bbolangir\\b",
  "\\bbalasore\\b",
  "\\bbaleswar\\b",
  "\\bbalimela\\b",
  "\\bbarbil\\b",
  "\\bbargarh\\b",
  "\\bbaripada\\b",
  "\\bbasudebpur\\b",
  "\\bbhadrak\\b",
  "\\bbhanjanagar\\b",
  "\\bbhawanipatna\\b",
  "\\bbhubaneswar\\b",
  "\\bbhubaneshwar\\b",
  "\\bbhubneshwar\\b",
  "\\bbbsr\\b",
  "\\bboudh\\b",
  "\\bbrahmapur\\b",
  "\\bberhampur\\b",
  "\\bchandbali\\b",
  "\\bchatrapur\\b",
  "\\bchhatrapur\\b",
  "\\bcuttack\\b",
  "\\bdeogarh\\b",
  "\\bdebgarh\\b",
  "\\bdhenkanal\\b",
  "\\bgajapati\\b",
  "\\bganjam\\b",
  "\\bgunupur\\b",
  "\\bhirakud\\b",
  "\\bjagatsinghpur\\b",
  "\\bjajpur\\b",
  "\\bjaleswar\\b",
  "\\bjeypore\\b",
  "\\bjharsuguda\\b",
  "\\bkalahandi\\b",
  "\\bkantabanji\\b",
  "\\bkendrapara\\b",
  "\\bkendujhar\\b",
  "\\bkeonjhar\\b",
  "\\bkhordha\\b",
  "\\bkhurda\\b",
  "\\bkoraput\\b",
  "\\bmalkangiri\\b",
  "\\bmayurbhanj\\b",
  "\\bnabarangpur\\b",
  "\\bnayagarh\\b",
  "\\bnuapada\\b",
  "\\bparadip\\b",
  "\\bparadeep\\b",
  "\\bparalakhemundi\\b",
  "\\bpatnagarh\\b",
  "\\bphulbani\\b",
  "\\bpuri\\b",
  "\\brayagada\\b",
  "\\brairakhol\\b",
  "\\brajganga?pur\\b",
  "\\brajgangpur\\b",
  "\\brourkela\\b",
  "\\bsambalpur\\b",
  "\\bsubarnapur\\b",
  "\\bsonepur\\b",
  "\\bsorada\\b",
  "\\bsundargarh\\b",
  "\\bsundergarh\\b",
  "\\btalcher\\b",
  "\\btitlagarh\\b",
  "\\bumarkote\\b"
].join("|"), "i");

function normalizeBranchName(value) {
  const raw = String(value || "").trim().toLowerCase().replace(/[_-]+/g, " ");
  if (ODISHA_LOCATION_PATTERN.test(raw)) return "Bhubaneswar";
  if (/\bbangalore\b|\bbengaluru\b|\bblr\b/.test(raw)) return "Bangalore";
  return "";
}

function inferLeadBranchFromText(...parts) {
  return normalizeBranchName(parts.filter(Boolean).join(" ")) || "Bangalore";
}

function normalizeAdmissionCoursePermissionIds(value) {
  const allowedIds = new Set(PUBLIC_COURSE_CATALOG.map((course) => course.id));
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.map((item) => String(item || "").trim()).filter((item) => allowedIds.has(item)))];
}

function courseMatchesPermission(course, courseText) {
  const courseIdentity = buildCourseIdentity(courseText);
  if (isKnownPublicCourseIdentity(courseIdentity)) {
    return courseIdentity.key === course.id;
  }

  const descriptor = normalizeCourseSourceText(courseText).toLowerCase();
  if (!descriptor) return false;
  return [course.id, course.code, course.name]
    .filter(Boolean)
    .some((value) => {
      const normalizedValue = normalizeCourseSourceText(value).toLowerCase();
      return normalizedValue && descriptor === normalizedValue;
    });
}

function isCounselorEligibleForAdmissionLead(counselor, { branch = "", courseName = "" } = {}) {
  if (!isCounselorInAdmissionRotation(counselor)) return false;

  const targetBranch = normalizeBranchName(branch);
  if (targetBranch) {
    const counselorBranch = normalizeBranchName(counselor?.branch);
    if (counselorBranch && counselorBranch !== targetBranch) return false;
  }

  const courseIds = normalizeAdmissionCoursePermissionIds(counselor?.admissionCoursePermissions);
  if (!courseIds.length) return false;
  const allowedCourses = PUBLIC_COURSE_CATALOG.filter((course) => courseIds.includes(course.id));
  return allowedCourses.some((course) => courseMatchesPermission(course, courseName));
}

function getAdmissionCounselorCandidates(counselors = [], options = {}) {
  const activeCounselors = (Array.isArray(counselors) ? counselors : []).filter(isCounselorInAdmissionRotation);
  if (!activeCounselors.length) return [];

  const branchAndCourseMatches = activeCounselors.filter((counselor) => isCounselorEligibleForAdmissionLead(counselor, options));
  if (branchAndCourseMatches.length) return branchAndCourseMatches;

  const courseMatches = activeCounselors.filter((counselor) => isCounselorEligibleForAdmissionLead(counselor, {
    ...options,
    branch: ""
  }));
  if (courseMatches.length) return courseMatches;

  return [];
}

async function getMetaProcessingSnapshot() {
  if (
    cachedStateDoc
    && Array.isArray(cachedStateDoc.counselors)
    && Array.isArray(cachedStateDoc.leads)
  ) {
    return {
      leads: Array.isArray(cachedStateDoc.leads) ? cachedStateDoc.leads : [],
      counselors: Array.isArray(cachedStateDoc.counselors) ? cachedStateDoc.counselors : []
    };
  }

  try {
    const [leads, counselors] = await Promise.all([
      withMongoRetry(
        () => leadsCollection.find({}).toArray(),
        { retries: 1, label: "Load Meta processing snapshot (leads)" }
      ),
      withMongoRetry(
        () => counselorsCollection.find({}).toArray(),
        { retries: 1, label: "Load Meta processing snapshot (counselors)" }
      )
    ]);

    return {
      leads: Array.isArray(leads) ? leads : [],
      counselors: Array.isArray(counselors) ? counselors : []
    };
  } catch (error) {
    if (
      cachedStateDoc
      && Array.isArray(cachedStateDoc.counselors)
      && Array.isArray(cachedStateDoc.leads)
    ) {
      return {
        leads: cachedStateDoc.leads,
        counselors: cachedStateDoc.counselors
      };
    }
    throw error;
  }
}

async function fetchMetaLeadDetails(leadgenId, pageAccessToken) {
  // `page_id` is supplied by the webhook payload, not the lead details endpoint.
  const fields = "field_data,created_time,form_id,ad_id,ad_name,adset_name,campaign_name";
  const graphUrl =
    `https://graph.facebook.com/v21.0/${encodeURIComponent(leadgenId)}` +
    `?fields=${fields}&access_token=${encodeURIComponent(pageAccessToken)}`;
  // native fetch available in Node 18+; fall back to https for older runtimes
  if (typeof fetch === "function") {
    let lastError = null;

    for (let attempt = 1; attempt <= META_LEAD_FETCH_MAX_ATTEMPTS; attempt += 1) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), META_LEAD_FETCH_TIMEOUT_MS);

      try {
        const resp = await fetch(graphUrl, { signal: controller.signal });
        const text = await resp.text();
        let json = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {
          json = null;
        }

        if (!resp.ok || json?.error) {
          const metaMessage = json?.error?.message || text || `Meta API ${resp.status}`;
          throw new Error(`Meta API ${resp.status}: ${metaMessage}`);
        }

        return json;
      } catch (err) {
        const cause = err?.name === "AbortError"
          ? `request timed out after ${Math.round(META_LEAD_FETCH_TIMEOUT_MS / 1000)}s`
          : err?.cause?.code || err?.cause?.message || err?.code || err?.message || "unknown error";
        lastError = new Error(`Meta lead details request failed${attempt > 1 ? " after retry" : ""}: ${cause}`);
        if (attempt < META_LEAD_FETCH_MAX_ATTEMPTS) {
          await wait(750 * attempt);
        }
      } finally {
        clearTimeout(timeoutId);
      }
    }

    throw lastError || new Error("Meta lead details request failed.");
  }
  // https fallback
  return new Promise((resolve, reject) => {
    const https = require("https");
    https.get(graphUrl, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (json.error) return reject(new Error(json.error.message));
          resolve(json);
        } catch (e) { reject(e); }
      });
    }).on("error", reject);
  });
}

function shouldForwardMetaWebhook(req) {
  return !!META_WEBHOOK_FORWARD_URL && String(req.headers?.[FORWARDED_WEBHOOK_HEADER] || "") !== "1";
}

async function forwardMetaWebhook(req, fallbackBody) {
  if (!META_WEBHOOK_FORWARD_URL) {
    throw new Error("META_WEBHOOK_FORWARD_URL is not configured.");
  }

  const rawBody = req.rawBody;
  const body = rawBody && rawBody.length
    ? rawBody
    : Buffer.from(JSON.stringify(fallbackBody || {}), "utf8");
  const config = await getMetaConfig().catch(() => null);
  const forwardedSignature = config?.appSecret
    ? signWebhookPayload(body, config.appSecret)
    : "";
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(META_WEBHOOK_FORWARD_URL, {
      method: "POST",
      headers: {
        "Content-Type": req.headers["content-type"] || "application/json",
        "X-Hub-Signature-256": req.headers["x-hub-signature-256"] || "",
        [FORWARDED_WEBHOOK_HEADER]: "1",
        [FORWARDED_WEBHOOK_SIGNATURE_HEADER]: forwardedSignature
      },
      body,
      signal: controller.signal
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`forward target returned ${response.status}${text ? `: ${text}` : ""}`);
    }
  } catch (error) {
    const reason = error?.name === "AbortError"
      ? "forward request timed out after 10s"
      : error?.message || "unknown forward error";
    throw new Error(reason);
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildMetaLead(fieldData, meta, counselorName, nextId, options = {}) {
  const now = new Date().toISOString();
  const fields = getMetaLeadFieldMap(fieldData);
  const firstName = String(fields.first_name || "").trim();
  const lastName = String(fields.last_name || "").trim();
  const fullName = String(fields.full_name || fields.name || "").trim();
  const name = fullName || (firstName ? `${firstName} ${lastName}`.trim() : "Unknown");
  const email = String(fields.email || fields.email_address || "").trim().toLowerCase();
  const phone = String(fields.phone_number || fields.phone || fields.mobile_phone || fields.mobile || "").trim();
  const inferredProgram = String(
    fields.workshop ||
    fields.workshop_name ||
    fields.workshop_title ||
    fields.workshop_topic ||
    fields.course ||
    fields.course_name ||
    fields.program ||
    normalizeMetaLabel(meta.adsetName || meta.adName || meta.campaignName || "")
  ).trim();
  const leadType = String(options.leadType || "").trim().toLowerCase() === "admission" ? "admission" : "workshop";
  const isAdmissionLead = leadType === "admission";
  const workshop = isAdmissionLead ? "" : inferredProgram;
  const courseName = isAdmissionLead ? inferredProgram : "";
  const courseRawName = courseName;

  const knownKeys = new Set(["full_name", "name", "first_name", "last_name", "email", "email_address", "phone_number", "phone", "mobile_phone", "mobile", "workshop", "workshop_name", "workshop_title", "workshop_topic", "course", "course_name", "program"]);
  const extraEntries = Object.entries(fields).filter(([k]) => !knownKeys.has(k) && fields[k]);
  const metaExtraFields = Object.fromEntries(extraEntries);

  return {
    id: nextId,
    name,
    email: email || `meta-${meta.leadgenId}@noemail.lead`,
    phone,
    workshop,
    courseName,
    courseRawName,
    status: "New",
    source: isAdmissionLead ? "Meta Admission Lead" : "Meta",
    leadPipeline: isAdmissionLead ? MAIN_ADMISSION_PIPELINE : "",
    metaLeadId: String(meta.leadgenId || ""),
    metaFormId: String(meta.formId || ""),
    metaAdId: String(meta.adId || ""),
    metaAdName: String(meta.adName || ""),
    metaAdsetName: String(meta.adsetName || ""),
    metaCampaignName: String(meta.campaignName || ""),
    metaExtraFields,
    createdAtExact: now,
    createdAt: toKolkataDateKey(),
    dialed: "",
    callStatus: "",
    wsStatus: "",
    whatsappInvite: "",
    counselor: counselorName,
    postDialed: "",
    coursePitched: "",
    courseStatus: "",
    admissionStatus: "",
    admissionWorkshop: workshop,
    postStatusUpdated: false,
    preActivityUpdates: 0,
    postActivityUpdates: 0,
    workshopActivityHistory: [],
    admissionActivityHistory: [],
    mainAdmissionDialed: "",
    mainAdmissionCoursePitched: "",
    mainAdmissionCourseStatus: "",
    mainAdmissionAdmissionStatus: "",
    mainAdmissionCallStatus: "",
    mainAdmissionActivityUpdated: false,
    mainAdmissionActivityUpdates: 0,
    mainAdmissionActivityHistory: [],
    admissionSopAssignedAt: isAdmissionLead && shouldTreatLeadAsAssigned(counselorName) ? now : null,
    admissionSopLastProgressAt: null,
    whatsappGroupStatus: "",
    leadNotes: [],
    importSourceFiles: ["Meta Lead Ads"],
    importSourceSheets: []
  };
}

function buildElementorLead(fields, meta, counselorName, nextId, options = {}) {
  const now = new Date().toISOString();
  const name = String(
    fields.full_name ||
    fields.name ||
    [fields.first_name, fields.last_name].filter(Boolean).join(" ")
  ).trim() || "Unknown";
  const email = String(fields.email || fields.email_address || "").trim().toLowerCase();
  const phone = String(fields.phone_number || fields.phone || fields.mobile_phone || fields.mobile || "").trim();
  const leadType = String(options.leadType || "").trim().toLowerCase() === "admission" ? "admission" : "workshop";
  const isAdmissionLead = leadType === "admission";
  const inferredProgram = inferElementorProgram(fields, meta, leadType);
  const workshop = isAdmissionLead ? "" : inferredProgram;
  const courseName = isAdmissionLead ? inferredProgram : "";
  const courseRawName = courseName;
  const knownKeys = new Set([
    "full_name", "name", "first_name", "last_name", "email", "email_address",
    "phone_number", "phone", "mobile_phone", "mobile", "highest_qualification",
    "page_url", "date", "time", "user_agent", "remote_ip", "powered_by",
    "form_id", "form_name", "workshop", "workshop_name", "workshop_title",
    "course", "course_name", "program", "lead_type", "type", "intent", "pipeline"
  ]);
  const extraEntries = Object.entries(fields).filter(([key]) => !knownKeys.has(key) && fields[key]);

  return {
    id: nextId,
    name,
    email: email || `elementor-${nextId}@noemail.lead`,
    phone,
    workshop,
    courseName,
    courseRawName,
    highestQualification: String(fields.highest_qualification || "").trim(),
    status: "New",
    source: isAdmissionLead ? "Elementor Admission Lead" : "Elementor",
    leadPipeline: isAdmissionLead ? MAIN_ADMISSION_PIPELINE : "",
    elementorFormId: String(meta.formId || ""),
    elementorFormName: String(meta.formName || ""),
    elementorPageUrl: String(meta.pageUrl || ""),
    elementorSubmittedDate: String(meta.submittedDate || ""),
    elementorSubmittedTime: String(meta.submittedTime || ""),
    elementorRemoteIp: String(meta.remoteIp || ""),
    elementorUserAgent: String(meta.userAgent || ""),
    elementorExtraFields: {
      ...Object.fromEntries(extraEntries),
      poweredBy: String(fields.powered_by || meta.poweredBy || "").trim()
    },
    createdAtExact: now,
    createdAt: toKolkataDateKey(),
    dialed: "",
    callStatus: "",
    wsStatus: "",
    whatsappInvite: "",
    counselor: counselorName,
    postDialed: "",
    coursePitched: "",
    courseStatus: "",
    admissionStatus: "",
    admissionWorkshop: workshop,
    postStatusUpdated: false,
    preActivityUpdates: 0,
    postActivityUpdates: 0,
    workshopActivityHistory: [],
    admissionActivityHistory: [],
    mainAdmissionDialed: "",
    mainAdmissionCoursePitched: "",
    mainAdmissionCourseStatus: "",
    mainAdmissionAdmissionStatus: "",
    mainAdmissionCallStatus: "",
    mainAdmissionActivityUpdated: false,
    mainAdmissionActivityUpdates: 0,
    mainAdmissionActivityHistory: [],
    admissionSopAssignedAt: isAdmissionLead && shouldTreatLeadAsAssigned(counselorName) ? now : null,
    admissionSopLastProgressAt: null,
    whatsappGroupStatus: "",
    leadNotes: [],
    importSourceFiles: ["Elementor Webhook"],
    importSourceSheets: []
  };
}

// ─── Meta API Routes ──────────────────────────────────────────────────────────

// Webhook verification (GET) — called once by Meta when you register the webhook.
async function assignCounselorRoundRobin(counselorSource) {
  const sourceList = Array.isArray(counselorSource)
    ? counselorSource
    : Array.isArray(counselorSource?.counselors)
      ? counselorSource.counselors
      : [];
  const counselors = sourceList.filter(isCounselorInMetaRotation);
  if (!counselors.length) return "Unassigned";

  const result = await withMongoRetry(
    () => metaConfigCollection.findOneAndUpdate(
      { _id: META_CONFIG_DOC_ID },
      { $inc: { roundRobinIndex: 1 } },
      { returnDocument: "after", upsert: true }
    ),
    { retries: 1, label: "Advance Meta round robin" }
  );
  const newIdx = Number(result?.roundRobinIndex) || 1;
  const idx = ((newIdx - 1) % counselors.length + counselors.length) % counselors.length;
  return counselors[idx].name;
}

async function assignElementorCounselorRoundRobin(counselorSource) {
  const sourceList = Array.isArray(counselorSource)
    ? counselorSource
    : Array.isArray(counselorSource?.counselors)
      ? counselorSource.counselors
      : [];
  const counselors = sourceList.filter(isCounselorInMetaRotation);
  if (!counselors.length) return "Unassigned";

  const result = await withMongoRetry(
    () => elementorConfigCollection.findOneAndUpdate(
      { _id: ELEMENTOR_CONFIG_DOC_ID },
      { $inc: { roundRobinIndex: 1 } },
      { returnDocument: "after", upsert: true }
    ),
    { retries: 1, label: "Advance Elementor round robin" }
  );
  const newIdx = Number(result?.roundRobinIndex) || 1;
  const idx = ((newIdx - 1) % counselors.length + counselors.length) % counselors.length;
  return counselors[idx].name;
}

async function assignAdmissionCounselorRoundRobin(counselorSource, options = {}) {
  const sourceList = Array.isArray(counselorSource)
    ? counselorSource
    : Array.isArray(counselorSource?.counselors)
      ? counselorSource.counselors
      : [];
  const eligibleCounselors = getAdmissionCounselorCandidates(sourceList, options);
  if (!eligibleCounselors.length) return "Unassigned";

  const result = await withMongoRetry(
    () => metaConfigCollection.findOneAndUpdate(
      { _id: META_CONFIG_DOC_ID },
      { $inc: { [MAIN_ADMISSION_ROUND_ROBIN_FIELD]: 1 } },
      { returnDocument: "after", upsert: true }
    ),
    { retries: 1, label: "Advance main admission round robin" }
  );
  const newIdx = Number(result?.[MAIN_ADMISSION_ROUND_ROBIN_FIELD]) || 1;
  const idx = ((newIdx - 1) % eligibleCounselors.length + eligibleCounselors.length) % eligibleCounselors.length;
  return eligibleCounselors[idx].name;
}

async function replaceLeadDocument(lead) {
  await withMongoRetry(
    () => leadsCollection.replaceOne(
      { id: { $in: getLeadIdCandidates(lead?.id) } },
      decorateLeadForStorage(lead),
      { upsert: false }
    ),
    { retries: 1, label: "Replace lead document" }
  );
}

async function createMcubeFollowUpTask(lead, event, session = null) {
  const dueDate = toKolkataDateKey(new Date(Date.now() + 24 * 60 * 60 * 1000));
  const task = normalizeTaskDoc({
    title: `MCUBE callback for ${String(lead?.name || "lead").trim()}`,
    notes: String(event?.notes || event?.disposition || "Callback requested from MCUBE").trim(),
    dueDate,
    counselor: String(lead?.counselor || "").trim() || "Unassigned",
    leadCounselor: String(lead?.counselor || "").trim() || "Unassigned",
    leadId: String(lead?.id || "").trim(),
    leadName: String(lead?.name || "").trim()
  });

  const duplicateTask = await withMongoRetry(
    () => tasksCollection.findOne({
      leadId: task.leadId,
      counselor: task.counselor,
      title: task.title,
      dueDate: task.dueDate
    }),
    { retries: 1, label: "Check MCUBE callback task" }
  );

  if (duplicateTask) {
    return duplicateTask;
  }

  await withMongoRetry(
    () => tasksCollection.insertOne(task),
    { retries: 1, label: "Create MCUBE callback task" }
  );

  await recordActivity({
    leadId: task.leadId,
    leadName: task.leadName,
    counselorName: task.leadCounselor || task.counselor || "",
    activityType: "Follow-Up Added",
    actionDescription: `MCUBE follow-up task created: "${task.title}"`,
    newValue: `Title: ${task.title}, Due: ${task.dueDate}, Notes: ${task.notes || "None"}`,
    session
  });

  return task;
}

async function processMcubeWebhookPayload(req, body, options = {}) {
  const retryJobId = options.retryJobId || null;
  const config = await getMcubeConfig();
  if (!config.enabled || !config.enableEventSync) {
    if (retryJobId) {
      await withMongoRetry(
        () => mcubeRetryCollection.deleteOne({ _id: retryJobId }),
        { retries: 1, label: "Delete skipped MCUBE retry job" }
      ).catch(() => undefined);
    }
    await saveMcubeLog({ type: "ignored", message: "Integration disabled or event sync turned off." });
    return;
  }

  if (!options.skipSignatureVerification && !verifyMcubeWebhookSignature(req.rawBody, req, config.webhookSecret)) {
    await saveMcubeLog({ type: "error", message: "Webhook signature verification failed." });
    return;
  }

  const event = normalizeMcubeEvent(body);
  if (!event.callId && !event.phone && !event.leadId && !event.eventType) {
    if (retryJobId) {
      await withMongoRetry(
        () => mcubeRetryCollection.deleteOne({ _id: retryJobId }),
        { retries: 1, label: "Delete empty MCUBE retry job" }
      ).catch(() => undefined);
    }
    await saveMcubeLog({ type: "ignored", message: "Webhook received without usable MCUBE event fields." });
    return;
  }

  let state = await getStateDoc();
  let lead = event.leadId ? findLeadById(state, event.leadId) : null;
  if (!lead && event.phone) {
    lead = findLeadByPhone(state, event.phone);
  }

  if (!lead && config.enableAutoLeadCreate && event.phone) {
    const assignment = getMcubeLeadAssignment(event, state.counselors);
    const nextId = await getNextMetaLeadId();
    const newLead = buildMcubeLead(event, assignment, nextId);
    await withMongoRetry(
      () => leadsCollection.insertOne(decorateLeadForStorage(newLead)),
      { retries: 1, label: "Create MCUBE lead" }
    );
    await recordActivity({
      leadId: newLead.id,
      leadName: newLead.name,
      counselorName: newLead.counselor || "",
      activityType: "Lead Created",
      actionDescription: `Lead created from MCUBE webhook (${event.eventType || "call event"})`,
      newValue: `Name: ${newLead.name}, Phone: ${newLead.phone}, Section: Main Admission, Assignment: ${assignment.assignmentNote}`
    });
    if (shouldTreatLeadAsAssigned(newLead.counselor)) {
      await recordActivity({
        leadId: newLead.id,
        leadName: newLead.name,
        counselorName: newLead.counselor,
        activityType: "Lead Assigned",
        actionDescription: `Lead initially assigned to counselor ${newLead.counselor}`,
        newValue: newLead.counselor
      });
    }
    lead = newLead;
    cachedStateDoc = null;
    cachedStateDocAt = 0;
    state = await getStateDoc();
    if (config.enableNotifications) {
      await createNotification({
        userId: "admin",
        role: "admin",
        type: "new_mcube_lead",
        title: "MCUBE Lead Created",
        message: `Lead ${formatLeadNotificationLabel(newLead)} was created in Main Admission from an MCUBE call event. ${shouldTreatLeadAsAssigned(newLead.counselor) ? `Assigned to ${newLead.counselor}.` : "Awaiting admin assignment."}`,
        sound: true,
        leadId: newLead.id,
        leadName: newLead.name,
        assignedCounselor: newLead.counselor
      });
    }
  }

  if (!lead) {
    if (retryJobId) {
      await withMongoRetry(
        () => mcubeRetryCollection.deleteOne({ _id: retryJobId }),
        { retries: 1, label: "Delete unmatched MCUBE retry job" }
      ).catch(() => undefined);
    }
    await saveMcubeLog({
      type: "ignored",
      message: "No matching lead found for MCUBE event.",
      callId: event.callId,
      phone: event.phone,
      pickedBy: event.counselorName || "",
      pickedByPhone: event.agentPhone || "",
      callAnswered: didMcubeCallGetPicked(event),
      callDisposition: event.disposition || "",
      direction: event.direction || "",
      eventType: event.eventType
    });
    return;
  }

  const stageConfig = inferLeadStageForCallUpdate(lead);
  const normalizedStatus = mapMcubeDispositionToCrmStatus(event.disposition || event.eventType);
  const assignment = getMcubeLeadAssignment(event, state.counselors);
  const shouldAssignFromPickedCall = !shouldTreatLeadAsAssigned(lead.counselor)
    && shouldTreatLeadAsAssigned(assignment.counselorName);
  const history = Array.isArray(lead.mcubeCallHistory) ? lead.mcubeCallHistory : [];
  const nextHistory = [
    {
      at: new Date().toISOString(),
      callId: event.callId,
      eventType: event.eventType,
      direction: event.direction,
      disposition: event.disposition,
      normalizedStatus,
      duration: event.duration,
      recordingUrl: event.recordingUrl,
      notes: event.notes,
      answeredTime: event.answeredTime,
      agentPhone: event.agentPhone,
      didNumber: event.didNumber,
      agentName: event.counselorName,
      groupName: event.groupName,
      disconnectedBy: event.disconnectedBy,
      rawStatus: event.disposition,
      mcubeFields: event.mcubeFields
    },
    ...history
  ].slice(0, 50);

  const nextLead = decorateLeadForStorage({
    ...lead,
    counselor: shouldAssignFromPickedCall ? assignment.counselorName : lead.counselor,
    updatedAt: new Date().toISOString(),
    mcubeCallHistory: nextHistory,
    mcubePickedBy: assignment.pickedBy || lead.mcubePickedBy || "",
    mcubePickedByPhone: assignment.pickedByPhone || lead.mcubePickedByPhone || "",
    mcubeAssignmentNote: assignment.assignmentNote || lead.mcubeAssignmentNote || "",
    mcubeLastEventType: event.eventType,
    mcubeLastDisposition: event.disposition,
    mcubeLastCallId: event.callId,
    mcubeLastEventAt: new Date().toISOString(),
    mcubeLastDirection: event.direction || "",
    lastCallAt: event.endedAt || event.startedAt || new Date().toISOString(),
    lastCallRecordingUrl: config.enableRecordingLinks ? event.recordingUrl : (lead.lastCallRecordingUrl || "")
  });

  if (event.direction !== "inbound") {
    nextLead[stageConfig.dialedField] = "Yes";
  }
  if (config.enableCallStatusSync && normalizedStatus) {
    nextLead[stageConfig.statusField] = normalizedStatus;
  }

  await replaceLeadDocument(nextLead);

  if (shouldAssignFromPickedCall) {
    await recordActivity({
      leadId: nextLead.id,
      leadName: nextLead.name,
      counselorName: nextLead.counselor,
      activityType: "Lead Assigned",
      actionDescription: `MCUBE answered call matched CRM counselor ${nextLead.counselor}`,
      previousValue: String(lead?.counselor || "").trim() || "Unassigned",
      newValue: nextLead.counselor
    });
  }

  await recordActivity({
    leadId: nextLead.id,
    leadName: nextLead.name,
    counselorName: nextLead.counselor || "",
    activityType: "Call Made",
    actionDescription: `MCUBE ${event.direction || "call"} event recorded${normalizedStatus ? ` with status ${normalizedStatus}` : ""}.`,
    previousValue: String(lead?.[stageConfig.statusField] || "").trim() || null,
    newValue: [
      `MCUBE status: ${event.disposition || normalizedStatus || "-"}`,
      `Direction: ${event.direction || "-"}`,
      event.callId ? `Call ID: ${event.callId}` : "",
      event.recordingUrl && config.enableRecordingLinks ? "Recording available" : ""
    ].filter(Boolean).join(", "),
    callMetadata: buildMcubeActivityMetadata(event, {
      normalizedStatus,
      recordingUrl: config.enableRecordingLinks ? event.recordingUrl : ""
    })
  });

  if (config.enableAutoTaskCreation && isMcubeCallbackStatus(normalizedStatus)) {
    await createMcubeFollowUpTask(nextLead, event);
  }

  if (config.enableNotifications) {
    await createNotification({
      userId: "admin",
      role: "admin",
      type: "mcube_call_event",
      title: "MCUBE Call Updated",
      message: `${formatLeadNotificationLabel(nextLead)} ${normalizedStatus ? `is marked ${normalizedStatus}.` : "has a new call event."}`,
      sound: normalizedStatus === "CBL",
      leadId: nextLead.id,
      leadName: nextLead.name,
      assignedCounselor: nextLead.counselor
    });
  }

  await stateCollection.updateOne(
    { _id: STATE_DOC_ID },
    { $set: { updatedAt: new Date().toISOString() } },
    { upsert: true }
  );
  cachedStateDoc = null;
  cachedStateDocAt = 0;

  if (retryJobId) {
    await withMongoRetry(
      () => mcubeRetryCollection.deleteOne({ _id: retryJobId }),
      { retries: 1, label: "Delete processed MCUBE retry job" }
    ).catch(() => undefined);
  }

  await saveMcubeLog({
    type: "success",
    message: `MCUBE ${retryJobId ? "retried " : ""}event processed for ${nextLead.name}${normalizedStatus ? ` (${normalizedStatus})` : ""}.`,
    leadId: nextLead.id,
    leadName: nextLead.name,
    counselor: nextLead.counselor,
    leadPipeline: nextLead.leadPipeline || "",
    assignmentStatus: shouldTreatLeadAsAssigned(nextLead.counselor) ? "Assigned" : "Unassigned",
    pickedBy: assignment.pickedBy || "",
    pickedByPhone: assignment.pickedByPhone || "",
    callAnswered: didMcubeCallGetPicked(event),
    callDisposition: event.disposition || "",
    normalizedStatus,
    direction: event.direction || "",
    recordingUrl: config.enableRecordingLinks ? event.recordingUrl : "",
    callId: event.callId,
    phone: event.phone,
    eventType: event.eventType
  });
}

async function processMetaWebhookPayload(req, body) {
  const config = await getMetaConfig();

  if (config.appSecret) {
    const sig = req.headers["x-hub-signature-256"] || "";
    const rawBuf = req.rawBody;
    const isForwarded = String(req.headers?.[FORWARDED_WEBHOOK_HEADER] || "") === "1";
    const forwardedSig = req.headers?.[FORWARDED_WEBHOOK_SIGNATURE_HEADER] || "";
    const trustedForward = isForwarded
      && !!rawBuf
      && verifyWebhookSignature(rawBuf, forwardedSig, config.appSecret);
    const trustedDirect = !!rawBuf
      && verifyWebhookSignature(rawBuf, sig, config.appSecret);
    if (!trustedForward && !trustedDirect) {
      await saveMetaLog({
        type: "error",
        message: `Signature verification failed (${isForwarded ? "forwarded" : "direct"} request; rawBody=${rawBuf ? "present" : "missing"})`,
        headers: {
          sig,
          forwarded: isForwarded ? "1" : "0",
          forwardedSignaturePresent: forwardedSig ? "1" : "0",
          contentType: String(req.headers?.["content-type"] || ""),
          rawBodyLength: rawBuf ? String(rawBuf.length) : "0"
        }
      });
      return;
    }
  }

  if (!body || body.object !== "page") {
    await saveMetaLog({ type: "ignored", message: "Non-page event", object: body?.object });
    return;
  }

  if (!config.enabled) {
    await saveMetaLog({ type: "ignored", message: "Integration disabled", object: body?.object });
    return;
  }

  const entries = Array.isArray(body.entry) ? body.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry.changes) ? entry.changes : [];
    for (const change of changes) {
      if (change.field !== "leadgen") continue;
      const value = change.value || {};
      const leadgenId = String(value.leadgen_id || "");
      const formId = String(value.form_id || "");
      const pageId = String(value.page_id || entry.id || "");

      if (!leadgenId) {
        await saveMetaLog({ type: "error", message: "Missing leadgen_id", raw: value });
        continue;
      }

      if (config.pageId && pageId && pageId !== String(config.pageId)) {
        await saveMetaLog({ type: "ignored", message: `Page ID mismatch: got ${pageId}`, leadgenId });
        continue;
      }

      const allowedForms = Array.isArray(config.formIds) ? config.formIds.filter(Boolean) : [];
      if (allowedForms.length && !allowedForms.includes(formId)) {
        await saveMetaLog({ type: "ignored", message: `Form ID ${formId} not in allowed list`, leadgenId });
        continue;
      }

      let metaLead = null;
      try {
        if (!config.pageAccessToken) throw new Error("Page Access Token not configured.");
        metaLead = await fetchMetaLeadDetails(leadgenId, config.pageAccessToken);
      } catch (fetchErr) {
        await enqueueMetaRetryJob({
          leadgenId,
          formId,
          pageId,
          reason: "fetch_lead_details",
          lastError: fetchErr.message
        }).catch(() => undefined);
        await saveMetaLog({
          type: "error",
          message: `Failed to fetch lead details: ${fetchErr.message}`,
          leadgenId,
          formId
        });
        continue;
      }

      try {
        await processMetaLeadRecord({ leadgenId, formId, pageId, metaLead });
      } catch (processErr) {
        await enqueueMetaRetryJob({
          leadgenId,
          formId,
          pageId,
          reason: "process_meta_lead",
          lastError: processErr.message,
          metaLeadSnapshot: metaLead
        }).catch(() => undefined);
        await saveMetaLog({
          type: "error",
          message: `Webhook processing error: ${processErr.message}`,
          leadgenId,
          formId
        });
      }
    }
  }
}

app.get("/api/meta/webhook", async (req, res) => {
  try {
    await initMongo();
    const mode      = String(req.query["hub.mode"] || "");
    const token     = String(req.query["hub.verify_token"] || "");
    const challenge = String(req.query["hub.challenge"] || "");

    if (mode !== "subscribe" || !token) {
      return res.status(400).json({ message: "Invalid verification request." });
    }

    const config = await getMetaConfig();
    if (!config.verifyToken || token !== config.verifyToken) {
      return res.status(403).json({ message: "Verify token mismatch." });
    }

    res.setHeader("Content-Type", "text/plain");
    return res.send(challenge);
  } catch (err) {
    return res.status(500).json({ message: "Webhook verification failed.", details: err.message });
  }
});

// Webhook event receiver (POST) — Meta sends lead events here.
app.post("/api/meta/webhook", async (req, res) => {
  // Respond 200 immediately so Meta doesn't retry; process async.
  res.status(200).json({ ok: true });

  try {
    const body = parseMetaWebhookRequestBody(req) || {};

    if (shouldForwardMetaWebhook(req)) {
      try {
        await forwardMetaWebhook(req, body);
        return;
      } catch (forwardErr) {
        try {
          await saveMetaLog({
            type: "error",
            message: `Webhook forward failed: ${forwardErr.message}. Falling back to local processing.`
          });
        } catch {}
      }
    }

    await processMetaWebhookPayload(req, body);
  } catch (err) {
    // Errors here are internal; Meta already got 200 OK.
    try { await saveMetaLog({ type: "error", message: `Webhook processing error: ${err.message}` }); } catch {}
  }
});

app.use((err, req, res, next) => {
  if (req?.originalUrl?.startsWith("/api/meta/webhook") && err instanceof SyntaxError && req.rawBody) {
    const parsed = parseMetaWebhookBody(req.rawBody);
    if (parsed) {
      if (!res.headersSent) {
        res.status(200).json({ ok: true });
      }

      (async () => {
        try {
          if (shouldForwardMetaWebhook(req)) {
            try {
              await forwardMetaWebhook(req, parsed);
              return;
            } catch (forwardErr) {
              try {
                await saveMetaLog({
                  type: "error",
                  message: `Webhook forward failed: ${forwardErr.message}. Falling back to local processing.`
                });
              } catch {}
            }
          }

          await processMetaWebhookPayload(req, parsed);
        } catch (metaErr) {
          try { await saveMetaLog({ type: "error", message: `Webhook processing error: ${metaErr.message}` }); } catch {}
        }
      })();
      return;
    }
  }

  return next(err);
});

// Get Meta integration config (admin or marketing).
app.get("/api/meta/config", async (req, res) => {
  try {
    await initMongo();
    const activeSession = await getSessionFromRequest(req);
    if (!activeSession || !["super_admin", "admin", "marketing"].includes(activeSession.session.role)) {
      return res.status(403).json({ message: "Access required." });
    }
    const config = await getMetaConfig();
    // Never return the raw app secret or access token to the browser;
    // return masked indicators so the UI can show configured/not configured.
    return res.json({
      enabled:          config.enabled ?? false,
      verifyToken:      config.verifyToken || "",
      appSecretSet:     !!(config.appSecret),
      pageAccessTokenSet: !!(config.pageAccessToken),
      pageId:           config.pageId || "",
      formIds:          Array.isArray(config.formIds) ? config.formIds : [],
      roundRobinIndex:  config.roundRobinIndex ?? 0,
      logSummary: {
        success: Number(config.logSummary?.success) || 0,
        ignored: Number(config.logSummary?.ignored) || 0,
        error: Number(config.logSummary?.error) || 0
      }
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch Meta config.", details: err.message });
  }
});

// Save Meta integration config (admin or marketing).
app.put("/api/meta/config", async (req, res) => {
  try {
    await initMongo();
    const activeSession = await getSessionFromRequest(req);
    if (!activeSession || !["super_admin", "admin", "marketing"].includes(activeSession.session.role)) {
      return res.status(403).json({ message: "Access required." });
    }

    const body = req.body || {};
    const patch = {};

    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
    if (typeof body.verifyToken === "string") patch.verifyToken = String(body.verifyToken).trim();
    // Only update secrets when explicitly provided (non-empty string).
    if (typeof body.appSecret === "string" && body.appSecret.trim()) {
      patch.appSecret = String(body.appSecret).trim();
    }
    if (typeof body.pageAccessToken === "string" && body.pageAccessToken.trim()) {
      patch.pageAccessToken = String(body.pageAccessToken).trim();
    }
    if (typeof body.pageId === "string") patch.pageId = String(body.pageId).trim();
    if (Array.isArray(body.formIds)) {
      patch.formIds = body.formIds.map((f) => String(f).trim()).filter(Boolean);
    }

    const now = new Date().toISOString();
    await metaConfigCollection.updateOne(
      { _id: META_CONFIG_DOC_ID },
      { $set: { ...patch, updatedAt: now }, $setOnInsert: { roundRobinIndex: 0, createdAt: now } },
      { upsert: true }
    );

    const updated = await getMetaConfig();
    return res.json({
      ok: true,
      enabled:            updated.enabled ?? false,
      verifyToken:        updated.verifyToken || "",
      appSecretSet:       !!(updated.appSecret),
      pageAccessTokenSet: !!(updated.pageAccessToken),
      pageId:             updated.pageId || "",
      formIds:            Array.isArray(updated.formIds) ? updated.formIds : [],
      roundRobinIndex:    updated.roundRobinIndex ?? 0,
      logSummary: {
        success: Number(updated.logSummary?.success) || 0,
        ignored: Number(updated.logSummary?.ignored) || 0,
        error: Number(updated.logSummary?.error) || 0
      }
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to save Meta config.", details: err.message });
  }
});

// Get recent webhook logs (admin or marketing).
app.get("/api/meta/logs", async (req, res) => {
  try {
    await initMongo();
    const activeSession = await getSessionFromRequest(req);
    if (!activeSession || !["super_admin", "admin", "marketing"].includes(activeSession.session.role)) {
      return res.status(403).json({ message: "Access required." });
    }
    const limit = Math.min(Number(req.query.limit) || 50, MAX_META_LOGS);
    const logs = await metaLogsCollection
      .find({}, { projection: { _id: 0 } })
      .sort({ receivedAt: -1 })
      .limit(limit)
      .toArray();
    const config = await getMetaConfig();
    return res.json({
      logs,
      summary: {
        success: Number(config.logSummary?.success) || 0,
        ignored: Number(config.logSummary?.ignored) || 0,
        error: Number(config.logSummary?.error) || 0
      }
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch logs.", details: err.message });
  }
});

app.get("/api/meta/retry-jobs", async (req, res) => {
  try {
    await initMongo();
    const activeSession = await getSessionFromRequest(req);
    if (!activeSession || !["super_admin", "admin", "marketing"].includes(activeSession.session.role)) {
      return res.status(403).json({ message: "Access required." });
    }
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const jobs = await metaRetryCollection
      .find({}, {
        projection: {
          _id: 0,
          leadgenId: 1,
          formId: 1,
          pageId: 1,
          reason: 1,
          lastError: 1,
          attempts: 1,
          nextAttemptAt: 1,
          createdAt: 1,
          updatedAt: 1
        }
      })
      .sort({ nextAttemptAt: 1, createdAt: 1 })
      .limit(limit)
      .toArray();
    return res.json({ jobs });
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch retry jobs.", details: err.message });
  }
});

// Clear webhook logs (admin only).
app.delete("/api/meta/logs", async (req, res) => {
  try {
    await initMongo();
    const activeSession = await getSessionFromRequest(req);
    if (!activeSession || !["super_admin", "admin"].includes(activeSession.session.role)) {
      return res.status(403).json({ message: "Admin access required." });
    }
    await Promise.all([
      metaLogsCollection.deleteMany({}),
      metaRetryCollection.deleteMany({})
    ]);
    await metaConfigCollection.updateOne(
      { _id: META_CONFIG_DOC_ID },
      {
        $set: {
          logSummary: { success: 0, ignored: 0, error: 0 },
          updatedAt: new Date().toISOString()
        },
        $setOnInsert: {
          enabled: false,
          verifyToken: "",
          appSecret: "",
          pageAccessToken: "",
          pageId: "",
          formIds: [],
          roundRobinIndex: 0,
          createdAt: new Date().toISOString()
        }
      },
      { upsert: true }
    );
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: "Failed to clear logs.", details: err.message });
  }
});

// Reset round-robin pointer (admin only).
app.post("/api/meta/rr-state/reset", async (req, res) => {
  try {
    await initMongo();
    const activeSession = await getSessionFromRequest(req);
    if (!activeSession || !["super_admin", "admin"].includes(activeSession.session.role)) {
      return res.status(403).json({ message: "Admin access required." });
    }
    await metaConfigCollection.updateOne(
      { _id: META_CONFIG_DOC_ID },
      { $set: { roundRobinIndex: 0, updatedAt: new Date().toISOString() } },
      { upsert: true }
    );
    return res.json({ ok: true, roundRobinIndex: 0 });
  } catch (err) {
    return res.status(500).json({ message: "Failed to reset round-robin.", details: err.message });
  }
});

app.get("/api/elementor/config", async (req, res) => {
  try {
    await initMongo();
    const activeSession = await getSessionFromRequest(req);
    if (!activeSession || !["super_admin", "admin", "marketing"].includes(activeSession.session.role)) {
      return res.status(403).json({ message: "Access required." });
    }

    const config = await getElementorConfig();
    return res.json({
      enabled: config.enabled ?? false,
      allowedFormIds: Array.isArray(config.allowedFormIds) ? config.allowedFormIds : [],
      workshopFormIds: Array.isArray(config.workshopFormIds) ? config.workshopFormIds : [],
      admissionFormIds: Array.isArray(config.admissionFormIds) ? config.admissionFormIds : [],
      workshopFormNames: Array.isArray(config.workshopFormNames) ? config.workshopFormNames : [],
      admissionFormNames: Array.isArray(config.admissionFormNames) ? config.admissionFormNames : [],
      workshopPagePatterns: Array.isArray(config.workshopPagePatterns) ? config.workshopPagePatterns : [],
      admissionPagePatterns: Array.isArray(config.admissionPagePatterns) ? config.admissionPagePatterns : [],
      roundRobinIndex: config.roundRobinIndex ?? 0,
      logSummary: {
        success: Number(config.logSummary?.success) || 0,
        ignored: Number(config.logSummary?.ignored) || 0,
        error: Number(config.logSummary?.error) || 0
      }
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch Elementor config.", details: err.message });
  }
});

app.put("/api/elementor/config", async (req, res) => {
  try {
    await initMongo();
    const activeSession = await getSessionFromRequest(req);
    if (!activeSession || !["super_admin", "admin", "marketing"].includes(activeSession.session.role)) {
      return res.status(403).json({ message: "Access required." });
    }

    const body = req.body || {};
    const listFields = [
      "allowedFormIds",
      "workshopFormIds",
      "admissionFormIds",
      "workshopFormNames",
      "admissionFormNames",
      "workshopPagePatterns",
      "admissionPagePatterns"
    ];
    const patch = {};

    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
    listFields.forEach((field) => {
      if (Array.isArray(body[field])) {
        patch[field] = body[field].map((value) => String(value).trim()).filter(Boolean);
      }
    });

    const now = new Date().toISOString();
    await elementorConfigCollection.updateOne(
      { _id: ELEMENTOR_CONFIG_DOC_ID },
      { $set: { ...patch, updatedAt: now }, $setOnInsert: { roundRobinIndex: 0, createdAt: now } },
      { upsert: true }
    );

    const updated = await getElementorConfig();
    return res.json({
      ok: true,
      enabled: updated.enabled ?? false,
      allowedFormIds: Array.isArray(updated.allowedFormIds) ? updated.allowedFormIds : [],
      workshopFormIds: Array.isArray(updated.workshopFormIds) ? updated.workshopFormIds : [],
      admissionFormIds: Array.isArray(updated.admissionFormIds) ? updated.admissionFormIds : [],
      workshopFormNames: Array.isArray(updated.workshopFormNames) ? updated.workshopFormNames : [],
      admissionFormNames: Array.isArray(updated.admissionFormNames) ? updated.admissionFormNames : [],
      workshopPagePatterns: Array.isArray(updated.workshopPagePatterns) ? updated.workshopPagePatterns : [],
      admissionPagePatterns: Array.isArray(updated.admissionPagePatterns) ? updated.admissionPagePatterns : [],
      roundRobinIndex: updated.roundRobinIndex ?? 0,
      logSummary: {
        success: Number(updated.logSummary?.success) || 0,
        ignored: Number(updated.logSummary?.ignored) || 0,
        error: Number(updated.logSummary?.error) || 0
      }
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to save Elementor config.", details: err.message });
  }
});

app.get("/api/elementor/logs", async (req, res) => {
  try {
    await initMongo();
    const activeSession = await getSessionFromRequest(req);
    if (!activeSession || !["super_admin", "admin", "marketing"].includes(activeSession.session.role)) {
      return res.status(403).json({ message: "Access required." });
    }
    const limit = Math.min(Number(req.query.limit) || 50, MAX_ELEMENTOR_LOGS);
    const logs = await elementorLogsCollection
      .find({}, { projection: { _id: 0 } })
      .sort({ receivedAt: -1 })
      .limit(limit)
      .toArray();
    const config = await getElementorConfig();
    return res.json({
      logs,
      summary: {
        success: Number(config.logSummary?.success) || 0,
        ignored: Number(config.logSummary?.ignored) || 0,
        error: Number(config.logSummary?.error) || 0
      }
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch Elementor logs.", details: err.message });
  }
});

app.get("/api/elementor/retry-jobs", async (req, res) => {
  try {
    await initMongo();
    const activeSession = await getSessionFromRequest(req);
    if (!activeSession || !["super_admin", "admin", "marketing"].includes(activeSession.session.role)) {
      return res.status(403).json({ message: "Access required." });
    }
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const jobs = await elementorRetryCollection
      .find({}, {
        projection: {
          _id: 0,
          formId: 1,
          formName: 1,
          pageUrl: 1,
          reason: 1,
          lastError: 1,
          attempts: 1,
          nextAttemptAt: 1,
          createdAt: 1,
          updatedAt: 1
        }
      })
      .sort({ nextAttemptAt: 1, createdAt: 1 })
      .limit(limit)
      .toArray();
    return res.json({ jobs });
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch Elementor retry jobs.", details: err.message });
  }
});

app.delete("/api/elementor/logs", async (req, res) => {
  try {
    await initMongo();
    const activeSession = await getSessionFromRequest(req);
    if (!activeSession || !["super_admin", "admin"].includes(activeSession.session.role)) {
      return res.status(403).json({ message: "Admin access required." });
    }
    await Promise.all([
      elementorLogsCollection.deleteMany({}),
      elementorRetryCollection.deleteMany({})
    ]);
    await elementorConfigCollection.updateOne(
      { _id: ELEMENTOR_CONFIG_DOC_ID },
      {
        $set: {
          logSummary: { success: 0, ignored: 0, error: 0 },
          updatedAt: new Date().toISOString()
        },
        $setOnInsert: {
          enabled: false,
          allowedFormIds: [],
          workshopFormIds: [],
          admissionFormIds: [],
          workshopFormNames: [],
          admissionFormNames: [],
          workshopPagePatterns: [],
          admissionPagePatterns: [],
          roundRobinIndex: 0,
          createdAt: new Date().toISOString()
        }
      },
      { upsert: true }
    );
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: "Failed to clear Elementor logs.", details: err.message });
  }
});

app.post("/api/elementor/rr-state/reset", async (req, res) => {
  try {
    await initMongo();
    const activeSession = await getSessionFromRequest(req);
    if (!activeSession || !["super_admin", "admin"].includes(activeSession.session.role)) {
      return res.status(403).json({ message: "Admin access required." });
    }
    await elementorConfigCollection.updateOne(
      { _id: ELEMENTOR_CONFIG_DOC_ID },
      { $set: { roundRobinIndex: 0, updatedAt: new Date().toISOString() } },
      { upsert: true }
    );
    return res.json({ ok: true, roundRobinIndex: 0 });
  } catch (err) {
    return res.status(500).json({ message: "Failed to reset Elementor round-robin.", details: err.message });
  }
});

app.get("/api/mcube/config", async (req, res) => {
  try {
    await initMongo();
    const activeSession = await getSessionFromRequest(req);
    if (!activeSession || !["super_admin", "admin", "marketing"].includes(activeSession.session.role)) {
      return res.status(403).json({ message: "Access required." });
    }

    const config = await getMcubeConfig();
    const tokenSummary = buildMcubeTokenSummary(config.accountToken);
    return res.json({
      enabled: !!config.enabled,
      apiBaseUrl: String(config.apiBaseUrl || "").trim(),
      accountTokenSet: !!String(config.accountToken || "").trim(),
      webhookSecretSet: !!String(config.webhookSecret || "").trim(),
      clickToCallPath: String(config.clickToCallPath || "").trim(),
      clickToCallMethod: String(config.clickToCallMethod || "POST").trim().toUpperCase(),
      outboundRefUrl: String(config.outboundRefUrl || "1").trim() || "1",
      defaultExecutiveNumberSet: !!String(config.defaultExecutiveNumber || "").trim(),
      enableClickToCall: config.enableClickToCall !== false,
      enableEventSync: config.enableEventSync !== false,
      enableAutoLeadCreate: config.enableAutoLeadCreate !== false,
      enableAutoTaskCreation: config.enableAutoTaskCreation !== false,
      enableIncomingPopup: config.enableIncomingPopup !== false,
      enableRecordingLinks: config.enableRecordingLinks !== false,
      enableCallStatusSync: config.enableCallStatusSync !== false,
      enableNotifications: config.enableNotifications !== false,
      roundRobinIndex: Number(config.roundRobinIndex) || 0,
      tokenSummary,
      logSummary: {
        success: Number(config.logSummary?.success) || 0,
        ignored: Number(config.logSummary?.ignored) || 0,
        error: Number(config.logSummary?.error) || 0
      }
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch MCUBE config.", details: err.message });
  }
});

app.put("/api/mcube/config", async (req, res) => {
  try {
    await initMongo();
    const activeSession = await getSessionFromRequest(req);
    if (!activeSession || !["super_admin", "admin", "marketing"].includes(activeSession.session.role)) {
      return res.status(403).json({ message: "Access required." });
    }

    const body = req.body || {};
    const patch = {};
    const booleanFields = [
      "enabled",
      "enableClickToCall",
      "enableEventSync",
      "enableAutoLeadCreate",
      "enableAutoTaskCreation",
      "enableIncomingPopup",
      "enableRecordingLinks",
      "enableCallStatusSync",
      "enableNotifications"
    ];

    booleanFields.forEach((field) => {
      if (typeof body[field] === "boolean") {
        patch[field] = body[field];
      }
    });

    if (typeof body.apiBaseUrl === "string") patch.apiBaseUrl = String(body.apiBaseUrl).trim();
    if (typeof body.clickToCallPath === "string") patch.clickToCallPath = String(body.clickToCallPath).trim();
    if (typeof body.clickToCallMethod === "string") patch.clickToCallMethod = String(body.clickToCallMethod).trim().toUpperCase() || "POST";
    if (typeof body.outboundRefUrl === "string") patch.outboundRefUrl = String(body.outboundRefUrl).trim() || "1";
    if (typeof body.defaultExecutiveNumber === "string" && body.defaultExecutiveNumber.trim()) patch.defaultExecutiveNumber = String(body.defaultExecutiveNumber).trim();
    if (typeof body.accountToken === "string" && body.accountToken.trim()) patch.accountToken = String(body.accountToken).trim();
    if (typeof body.webhookSecret === "string" && body.webhookSecret.trim()) patch.webhookSecret = String(body.webhookSecret).trim();

    const currentConfig = await getMcubeConfig();
    const endpointErrors = validateMcubeEndpointConfig({ ...currentConfig, ...patch });
    if (endpointErrors.length) {
      return res.status(400).json({ message: endpointErrors.join(" ") });
    }

    const now = new Date().toISOString();
    await mcubeConfigCollection.updateOne(
      { _id: MCUBE_CONFIG_DOC_ID },
      { $set: { ...patch, updatedAt: now }, $setOnInsert: { roundRobinIndex: 0, createdAt: now } },
      { upsert: true }
    );

    const updated = await getMcubeConfig();
    const tokenSummary = buildMcubeTokenSummary(updated.accountToken);
    return res.json({
      ok: true,
      enabled: !!updated.enabled,
      apiBaseUrl: String(updated.apiBaseUrl || "").trim(),
      accountTokenSet: !!String(updated.accountToken || "").trim(),
      webhookSecretSet: !!String(updated.webhookSecret || "").trim(),
      clickToCallPath: String(updated.clickToCallPath || "").trim(),
      clickToCallMethod: String(updated.clickToCallMethod || "POST").trim().toUpperCase(),
      outboundRefUrl: String(updated.outboundRefUrl || "1").trim() || "1",
      defaultExecutiveNumberSet: !!String(updated.defaultExecutiveNumber || "").trim(),
      enableClickToCall: updated.enableClickToCall !== false,
      enableEventSync: updated.enableEventSync !== false,
      enableAutoLeadCreate: updated.enableAutoLeadCreate !== false,
      enableAutoTaskCreation: updated.enableAutoTaskCreation !== false,
      enableIncomingPopup: updated.enableIncomingPopup !== false,
      enableRecordingLinks: updated.enableRecordingLinks !== false,
      enableCallStatusSync: updated.enableCallStatusSync !== false,
      enableNotifications: updated.enableNotifications !== false,
      roundRobinIndex: Number(updated.roundRobinIndex) || 0,
      tokenSummary,
      logSummary: {
        success: Number(updated.logSummary?.success) || 0,
        ignored: Number(updated.logSummary?.ignored) || 0,
        error: Number(updated.logSummary?.error) || 0
      }
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to save MCUBE config.", details: err.message });
  }
});

app.post("/api/mcube/test", async (req, res) => {
  try {
    await initMongo();
    const activeSession = await getSessionFromRequest(req);
    if (!activeSession || !["super_admin", "admin", "marketing"].includes(activeSession.session.role)) {
      return res.status(403).json({ message: "Access required." });
    }

    const config = await getMcubeConfig();
    const tokenSummary = buildMcubeTokenSummary(config.accountToken);
    const checks = [
      { label: "Integration enabled", ok: !!config.enabled },
      { label: "API base URL set", ok: !!String(config.apiBaseUrl || "").trim() },
      { label: "Account token set", ok: !!String(config.accountToken || "").trim() },
      { label: "Click-to-call path set", ok: !!String(config.clickToCallPath || "").trim() },
      { label: "Outbound path matches MCUBE docs", ok: String(config.clickToCallPath || "").trim() === "/Restmcube-api/outbound-calls" },
      { label: "Outbound refurl set", ok: !!String(config.outboundRefUrl || "1").trim() },
      { label: "Event sync enabled", ok: config.enableEventSync !== false }
    ];

    return res.json({
      ok: true,
      tokenSummary,
      checks,
      message: "This validates the local MCUBE configuration and token structure. It does not verify the token against a live MCUBE endpoint from this environment."
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to validate MCUBE config.", details: err.message });
  }
});

app.get("/api/mcube/logs", async (req, res) => {
  try {
    await initMongo();
    const activeSession = await getSessionFromRequest(req);
    if (!activeSession || !["super_admin", "admin", "marketing"].includes(activeSession.session.role)) {
      return res.status(403).json({ message: "Access required." });
    }
    const limit = Math.min(Number(req.query.limit) || 50, MAX_MCUBE_LOGS);
    const logs = await mcubeLogsCollection
      .find({}, { projection: { _id: 0 } })
      .sort({ receivedAt: -1 })
      .limit(limit)
      .toArray();
    const config = await getMcubeConfig();
    return res.json({
      logs,
      summary: {
        success: Number(config.logSummary?.success) || 0,
        ignored: Number(config.logSummary?.ignored) || 0,
        error: Number(config.logSummary?.error) || 0
      }
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch MCUBE logs.", details: err.message });
  }
});

app.get("/api/mcube/retry-jobs", async (req, res) => {
  try {
    await initMongo();
    const activeSession = await getSessionFromRequest(req);
    if (!activeSession || !["super_admin", "admin", "marketing"].includes(activeSession.session.role)) {
      return res.status(403).json({ message: "Access required." });
    }
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const jobs = await mcubeRetryCollection
      .find({}, {
        projection: {
          _id: 0,
          jobType: 1,
          leadId: 1,
          leadName: 1,
          phone: 1,
          callId: 1,
          eventType: 1,
          reason: 1,
          lastError: 1,
          attempts: 1,
          nextAttemptAt: 1,
          createdAt: 1,
          updatedAt: 1
        }
      })
      .sort({ nextAttemptAt: 1, createdAt: 1 })
      .limit(limit)
      .toArray();
    return res.json({ jobs });
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch MCUBE retry jobs.", details: err.message });
  }
});

app.delete("/api/mcube/logs", async (req, res) => {
  try {
    await initMongo();
    const activeSession = await getSessionFromRequest(req);
    if (!activeSession || !["super_admin", "admin"].includes(activeSession.session.role)) {
      return res.status(403).json({ message: "Admin access required." });
    }
    await Promise.all([
      mcubeLogsCollection.deleteMany({}),
      mcubeRetryCollection.deleteMany({})
    ]);
    await mcubeConfigCollection.updateOne(
      { _id: MCUBE_CONFIG_DOC_ID },
      {
        $set: {
          logSummary: { success: 0, ignored: 0, error: 0 },
          updatedAt: new Date().toISOString()
        },
        $setOnInsert: {
          enabled: false,
          apiBaseUrl: "https://api.mcube.com",
          accountToken: "",
          webhookSecret: "",
          clickToCallPath: "/Restmcube-api/outbound-calls",
          clickToCallMethod: "POST",
          outboundRefUrl: "1",
          defaultExecutiveNumber: "",
          enableClickToCall: true,
          enableEventSync: true,
          enableAutoLeadCreate: true,
          enableAutoTaskCreation: true,
          enableIncomingPopup: true,
          enableRecordingLinks: true,
          enableCallStatusSync: true,
          enableNotifications: true,
          roundRobinIndex: 0,
          createdAt: new Date().toISOString()
        }
      },
      { upsert: true }
    );
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: "Failed to clear MCUBE logs.", details: err.message });
  }
});

app.post("/api/mcube/rr-state/reset", async (req, res) => {
  try {
    await initMongo();
    const activeSession = await getSessionFromRequest(req);
    if (!activeSession || !["super_admin", "admin"].includes(activeSession.session.role)) {
      return res.status(403).json({ message: "Admin access required." });
    }
    await mcubeConfigCollection.updateOne(
      { _id: MCUBE_CONFIG_DOC_ID },
      { $set: { roundRobinIndex: 0, updatedAt: new Date().toISOString() } },
      { upsert: true }
    );
    return res.json({ ok: true, roundRobinIndex: 0 });
  } catch (err) {
    return res.status(500).json({ message: "Failed to reset MCUBE round-robin.", details: err.message });
  }
});

app.get("/api/mcube/lookup", async (req, res) => {
  try {
    const session = await requireSession(req, res);
    if (!session) return;

    const phone = String(req.query.phone || "").trim();
    if (!phone) {
      return res.status(400).json({ message: "Phone is required." });
    }

    const state = await getStateDoc();
    const lead = findLeadByPhone(state, phone);
    return res.json({
      ok: true,
      found: !!lead,
      lead: lead
        ? {
            id: lead.id,
            name: lead.name,
            counselor: lead.counselor,
            phone: lead.phone,
            email: lead.email,
            leadPipeline: lead.leadPipeline || "workshop"
          }
        : null
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to lookup lead.", details: err.message });
  }
});

app.post("/api/mcube/click-to-call", async (req, res) => {
  try {
    const session = await requireRole(req, res, ["admin", "counselor"]);
    if (!session) return;

    const config = await getMcubeConfig();
    if (!config.enabled || config.enableClickToCall === false) {
      return res.status(400).json({ message: "MCUBE click-to-call is disabled." });
    }
    if (!config.apiBaseUrl || !config.clickToCallPath || !config.accountToken) {
      return res.status(400).json({ message: "MCUBE API base URL, token, or click-to-call path is missing." });
    }
    const endpointErrors = validateMcubeEndpointConfig(config);
    if (endpointErrors.length) {
      return res.status(400).json({ message: `MCUBE click-to-call configuration is invalid. ${endpointErrors.join(" ")}` });
    }

    const leadId = String(req.body?.leadId || "").trim();
    const phone = String(req.body?.phone || "").trim();
    const state = await getStateDoc();
    const lead = leadId ? findLeadById(state, leadId) : (phone ? findLeadByPhone(state, phone) : null);
    const targetPhone = normalizeMcubeDialNumber(phone || lead?.phone || "");
    if (!targetPhone) {
      return res.status(400).json({ message: "A target phone number is required." });
    }

    const counselorName = String(lead?.counselor || session.name || "").trim();
    const counselorDoc = counselorName
      ? (Array.isArray(state?.counselors) ? state.counselors : []).find(
          (item) => String(item?.name || "").trim().toLowerCase() === counselorName.toLowerCase()
        )
      : null;
    const executiveNumber = normalizeMcubeDialNumber(getMcubeExecutiveNumber(counselorDoc, session, config));
    if (!executiveNumber) {
      return res.status(400).json({ message: "MCUBE executive number is missing for this counselor/session." });
    }

    const requestPayload = {
      HTTP_AUTHORIZATION: config.accountToken,
      exenumber: executiveNumber,
      custnumber: targetPhone,
      refurl: String(req.body?.refurl || config.outboundRefUrl || "1").trim() || "1",
      refid: String(req.body?.refid || lead?.id || leadId || "").trim()
    };
    const primaryRequest = buildMcubeClickToCallRequest(config, requestPayload);
    let activeRequest = primaryRequest;
    const attempts = [];
    let response = await fetch(activeRequest.endpoint, {
      method: activeRequest.method,
      headers: {
        ...(activeRequest.contentType ? { "Content-Type": activeRequest.contentType } : {}),
        Accept: "application/json, text/plain;q=0.9"
      },
      ...(activeRequest.body ? { body: activeRequest.body } : {})
    });
    let text = await response.text();
    attempts.push(buildMcubeAttemptLog(activeRequest, response, text));
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }

    const mcubeAccepted = response.ok && isSuccessfulMcubeClickToCallResponse(parsed, text, activeRequest.offering);

    if (!mcubeAccepted) {
      await saveMcubeLog({
        type: "error",
        message: response.ok
          ? "Click-to-call was not accepted by MCUBE."
          : `Click-to-call failed with MCUBE HTTP ${response.status}.`,
        leadId: requestPayload.refid,
        leadName: String(lead?.name || req.body?.leadName || "").trim(),
        counselor: counselorName,
        leadPipeline: lead?.leadPipeline || "",
        assignmentStatus: shouldTreatLeadAsAssigned(counselorName) ? "Assigned" : "Unassigned",
        callDisposition: "DISPATCH_FAILED",
        normalizedStatus: "DISPATCH_FAILED",
        direction: "outbound",
        eventType: "click-to-call",
        phone: requestPayload.custnumber,
        mcubeResponse: parsed || text || "",
        mcubeAttempts: attempts
      });
      if (lead) {
        await recordActivity({
          leadId: lead.id,
          leadName: lead.name,
          counselorName: lead.counselor || session.name || "",
          activityType: "Call Made",
          actionDescription: "MCUBE click-to-call failed.",
          newValue: describeFailedMcubeAttempts(attempts),
          session,
          callMetadata: buildMcubeActivityMetadata({}, {
            callDirection: "outbound",
            callStatus: "DISPATCH_FAILED",
            customerPhone: requestPayload.custnumber,
            agentPhone: requestPayload.exenumber
          })
        });
      }
      const attemptSummary = describeFailedMcubeAttempts(attempts);
      const setupHint = response.status === 404
        ? `MCUBE returned 404 for the configured ${activeRequest.offering} endpoint. Please confirm the saved API Base URL, Click-to-Call Path, and account token with MCUBE.`
        : "";
      return res.status(502).json({
        message: response.ok ? "MCUBE did not confirm that the call was created." : `MCUBE click-to-call failed with status ${response.status}.`,
        details: parsed?.message || text || attemptSummary,
        setupHint,
        attemptedOffering: activeRequest.offering,
        attempts
      });
    }

    if (lead) {
      await recordActivity({
        leadId: lead.id,
        leadName: lead.name,
        counselorName: lead.counselor || session.name || "",
        activityType: "Call Made",
        actionDescription: "MCUBE click-to-call triggered from CRM.",
        newValue: `Phone: ${requestPayload.custnumber}`,
        session,
        callMetadata: buildMcubeActivityMetadata({}, {
          callDirection: "outbound",
          callStatus: "DISPATCHED",
          customerPhone: requestPayload.custnumber,
          agentPhone: requestPayload.exenumber
        })
      });
      await stateCollection.updateOne(
        { _id: STATE_DOC_ID },
        { $set: { updatedAt: new Date().toISOString() } },
        { upsert: true }
      );
      cachedStateDoc = null;
      cachedStateDocAt = 0;
    }

    await saveMcubeLog({
      type: "success",
      message: `Click-to-call dispatched${lead?.name ? ` for ${lead.name}` : ""}.`,
      leadId: requestPayload.refid,
      leadName: String(lead?.name || req.body?.leadName || "").trim(),
      counselor: counselorName,
      leadPipeline: lead?.leadPipeline || "",
      assignmentStatus: shouldTreatLeadAsAssigned(counselorName) ? "Assigned" : "Unassigned",
      callDisposition: "DISPATCHED",
      normalizedStatus: "DISPATCHED",
      direction: "outbound",
      eventType: "click-to-call",
      phone: requestPayload.custnumber,
      outboundPayload: {
        HTTP_AUTHORIZATION: "[redacted]",
        exenumber: requestPayload.exenumber,
        custnumber: requestPayload.custnumber,
        refurl: requestPayload.refurl,
        refid: requestPayload.refid
      }
    });

    return res.json({
      ok: true,
      endpoint: activeRequest.endpoint,
      offering: activeRequest.offering,
      response: parsed || text || null
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to trigger MCUBE click-to-call.", details: err.message });
  }
});

app.get("/api/reachout/config", async (req, res) => {
  try {
    await initMongo();
    const session = await requireRole(req, res, ["admin", "marketing"]);
    if (!session) return;
    const config = await getReachoutConfig();
    return res.json({ ...publicReachoutConfig(config), statusCallbackUrl: getReachoutStatusWebhookCallbackUrl(req) });
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch ReachOut config.", details: err.message });
  }
});

app.put("/api/reachout/config", async (req, res) => {
  try {
    await initMongo();
    const session = await requireRole(req, res, ["admin", "marketing"]);
    if (!session) return;

    const body = req.body || {};
    const existing = await getReachoutConfig();
    const patch = {
      enabled: typeof body.enabled === "boolean" ? body.enabled : existing.enabled !== false,
      defaultCountryCode: String(body.defaultCountryCode || existing.defaultCountryCode || "91").replace(/\D/g, "") || "91",
      whatsappNumbers: Array.isArray(body.whatsappNumbers)
        ? body.whatsappNumbers.map(normalizeReachoutWhatsAppNumber).filter((number) => number.number)
        : existing.whatsappNumbers,
      templates: Array.isArray(body.templates)
        ? body.templates.map(sanitizeReachoutTemplate).filter((template) => template.templateName)
        : existing.templates
    };
    if (typeof body.authKey === "string" && body.authKey.trim()) {
      patch.authKey = String(body.authKey).trim();
    }

    const now = new Date().toISOString();
    await reachoutConfigCollection.updateOne(
      { _id: REACHOUT_CONFIG_DOC_ID },
      { $set: { ...patch, updatedAt: now }, $setOnInsert: { createdAt: now, logSummary: { success: 0, error: 0 } } },
      { upsert: true }
    );

    const updated = await getReachoutConfig();
    return res.json({ ok: true, ...publicReachoutConfig(updated), statusCallbackUrl: getReachoutStatusWebhookCallbackUrl(req) });
  } catch (err) {
    return res.status(500).json({ message: "Failed to save ReachOut config.", details: err.message });
  }
});

app.get("/api/reachout/media/:id", async (req, res) => {
  try {
    await initMongo();
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(404).end();
    const media = await withMongoRetry(
      () => reachoutMediaCollection.findOne({ id }),
      { retries: 1, label: "Load ReachOut media" }
    );
    if (!media?.data) return res.status(404).end();
    const buffer = bufferFromStoredMediaData(media.data);
    if (!buffer.length) return res.status(404).end();
    res.setHeader("Content-Type", media.contentType || "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    return res.end(buffer);
  } catch (err) {
    return res.status(500).json({ message: "Failed to load ReachOut media.", details: err.message });
  }
});

app.post("/api/reachout/media", async (req, res) => {
  try {
    await initMongo();
    const session = await requireRole(req, res, ["admin", "marketing"]);
    if (!session) return;

    const templateId = String(req.body?.templateId || "").trim();
    if (!templateId) {
      return res.status(400).json({ message: "Template is required before uploading media." });
    }
    const upload = normalizeReachoutMediaUpload(req.body || {});
    const now = new Date().toISOString();
    const baseUrl = getPublicRequestBaseUrl(req);
    if (!baseUrl) {
      return res.status(400).json({ message: "Unable to create a public CRM media URL for this request." });
    }
    const mediaUrl = `${baseUrl}/api/reachout/media/${encodeURIComponent(upload.id)}`;
    const mediaDoc = {
      id: upload.id,
      fileName: upload.fileName,
      contentType: upload.contentType,
      extension: upload.extension,
      data: upload.buffer,
      uploadedBy: session.email || session.name || session.role,
      createdAt: now
    };

    await withMongoRetry(
      () => reachoutMediaCollection.insertOne(mediaDoc),
      { retries: 1, label: "Save ReachOut media" }
    );

    const config = await getReachoutConfig();
    const templates = (Array.isArray(config.templates) ? config.templates : []).map((template) => (
      String(template.id) === templateId
        ? sanitizeReachoutTemplate({ ...template, defaultHeaderMediaUrl: mediaUrl })
        : sanitizeReachoutTemplate(template)
    ));
    await reachoutConfigCollection.updateOne(
      { _id: REACHOUT_CONFIG_DOC_ID },
      { $set: { templates, updatedAt: now } },
      { upsert: true }
    );
    const updated = await getReachoutConfig();
    return res.json({ ok: true, mediaUrl, ...publicReachoutConfig(updated) });
  } catch (err) {
    return res.status(400).json({ message: "Failed to upload ReachOut media.", details: err.message });
  }
});

app.post("/api/reachout/whatsapp/sync", async (req, res) => {
  try {
    await initMongo();
    const session = await requireRole(req, res, ["admin", "marketing"]);
    if (!session) return;

    const config = await getReachoutConfig();
    const authKey = String(req.body?.authKey || config.authKey || "").trim();
    if (!authKey) {
      return res.status(400).json({ message: "MSG91 auth key is required before syncing WhatsApp templates." });
    }

    const synced = await syncReachoutWhatsAppFromMsg91(authKey);
    const existingMediaUrls = new Map((Array.isArray(config.templates) ? config.templates : []).map((template) => [
      `${template.integratedNumber || ""}:${template.templateName || template.name || ""}:${template.languageCode || "en"}`,
      String(template.defaultHeaderMediaUrl || "").trim()
    ]));
    synced.templates = synced.templates.map((template) => {
      const key = `${template.integratedNumber || ""}:${template.templateName || template.name || ""}:${template.languageCode || "en"}`;
      return {
        ...template,
        defaultHeaderMediaUrl: existingMediaUrls.get(key) || template.defaultHeaderMediaUrl || ""
      };
    });
    const now = new Date().toISOString();
    await reachoutConfigCollection.updateOne(
      { _id: REACHOUT_CONFIG_DOC_ID },
      {
        $set: {
          authKey,
          whatsappNumbers: synced.whatsappNumbers,
          templates: synced.templates,
          defaultCountryCode: config.defaultCountryCode || "91",
          enabled: config.enabled !== false,
          updatedAt: now
        },
        $setOnInsert: { createdAt: now, logSummary: { success: 0, error: 0 } }
      },
      { upsert: true }
    );

    const updated = await getReachoutConfig();
    return res.json({
      ok: true,
      syncedNumbers: synced.whatsappNumbers.length,
      syncedTemplates: synced.templates.length,
      ...publicReachoutConfig(updated)
    });
  } catch (err) {
    return res.status(502).json({ message: "Failed to sync MSG91 WhatsApp templates.", details: err.message });
  }
});

app.get("/api/reachout/logs", async (req, res) => {
  try {
    await initMongo();
    const session = await requireRole(req, res, ["admin", "marketing"]);
    if (!session) return;
    const limit = Math.min(Number(req.query.limit) || 80, MAX_REACHOUT_LOGS);
    const rawLogs = await reachoutLogsCollection
      .find({}, { projection: { _id: 0, requestPayload: 0, responseBody: 0 } })
      .sort({ sentAt: -1 })
      .limit(limit)
      .toArray();
    const config = await getReachoutConfig();
    return res.json({ logs: rawLogs.map(formatReachoutLogForClient), summary: publicReachoutConfig(config).logSummary });
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch ReachOut logs.", details: err.message });
  }
});

app.delete("/api/reachout/logs", async (req, res) => {
  try {
    await initMongo();
    const session = await requireRole(req, res, ["admin", "marketing"]);
    if (!session) return;

    const result = await withMongoRetry(
      () => reachoutLogsCollection.deleteMany({}),
      { retries: 1, label: "Clear ReachOut logs" }
    );
    await withMongoRetry(
      () => reachoutConfigCollection.updateOne(
        { _id: REACHOUT_CONFIG_DOC_ID },
        {
          $set: {
            "logSummary.submitted": 0,
            "logSummary.success": 0,
            "logSummary.error": 0,
            updatedAt: new Date().toISOString()
          }
        },
        { upsert: true }
      ),
      { retries: 1, label: "Reset ReachOut log summary" }
    );

    return res.json({ ok: true, deletedCount: Number(result?.deletedCount || 0) });
  } catch (err) {
    return res.status(500).json({ message: "Failed to clear ReachOut logs.", details: err.message });
  }
});

app.post("/api/reachout/send", async (req, res) => {
  try {
    await initMongo();
    const session = await requireRole(req, res, ["admin", "marketing"]);
    if (!session) return;

    const config = await getReachoutConfig();
    if (config.enabled === false) {
      return res.status(400).json({ message: "ReachOut Center is disabled." });
    }
    if (!String(config.authKey || "").trim()) {
      return res.status(400).json({ message: "MSG91 auth key is not configured." });
    }

    const templateId = String(req.body?.templateId || "").trim();
    const integratedNumber = String(req.body?.integratedNumber || "").replace(/\D/g, "");
    const mediaUrl = String(req.body?.mediaUrl || "").trim();
    const leadIds = Array.isArray(req.body?.leadIds) ? req.body.leadIds.map((id) => String(id).trim()).filter(Boolean) : [];
    const template = (Array.isArray(config.templates) ? config.templates : []).find((item) => String(item.id) === templateId);
    if (!template || template.enabled === false) {
      return res.status(400).json({ message: "Please select an enabled ReachOut template." });
    }
    if (String(template.channel || "").trim().toLowerCase() !== "whatsapp") {
      return res.status(400).json({ message: "ReachOut now supports WhatsApp templates only." });
    }
    if (!integratedNumber) {
      return res.status(400).json({ message: "Please select a WhatsApp number." });
    }
    if (!leadIds.length) {
      return res.status(400).json({ message: "Please select at least one lead." });
    }

    const state = await getStateDoc();
    const leadSet = new Set(leadIds);
    const leads = (Array.isArray(state.leads) ? state.leads : []).filter((lead) => leadSet.has(String(lead.id)));
    if (!leads.length) {
      return res.status(404).json({ message: "No matching leads were found." });
    }

    const channel = String(template.channel || "").trim().toLowerCase();
    const endpoint = buildReachoutEndpoint(channel);
    if (!endpoint) {
      return res.status(400).json({ message: "Unsupported ReachOut channel." });
    }
    const results = [];
    const batchId = crypto.randomUUID();

    for (const lead of leads.slice(0, 250)) {
      let requestPayload = null;
      try {
        requestPayload = buildReachoutPayload({
          template,
          lead,
          config,
          session,
          integratedNumber,
          mediaUrl: mediaUrl || template.defaultHeaderMediaUrl || ""
        });
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            authkey: config.authKey
          },
          body: JSON.stringify(requestPayload)
        });
        const text = await response.text();
        let parsed = null;
        try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
        if (!response.ok) {
          throw new Error(parsed?.message || parsed?.error || text || `MSG91 HTTP ${response.status}`);
        }
        const providerMessageId = String(
          parsed?.id ||
          parsed?.messageId ||
          parsed?.message_id ||
          parsed?.requestId ||
          parsed?.data?.id ||
          parsed?.data?.messageId ||
          ""
        ).trim();
        await recordActivity({
          leadId: lead.id,
          leadName: lead.name,
          counselorName: lead.counselor || "",
          activityType: "ReachOut Message",
          actionDescription: `ReachOut ${channel.toUpperCase()} submitted to MSG91 using ${template.name}.`,
          newValue: lead.phone,
          session
        });
        results.push({
          leadId: String(lead.id || ""),
          leadName: lead.name || "",
          phone: lead.phone || "",
          email: lead.email || "",
          ok: true,
          providerMessageId
        });
      } catch (error) {
        results.push({
          leadId: String(lead.id || ""),
          leadName: lead.name || "",
          phone: lead.phone || "",
          email: lead.email || "",
          ok: false,
          message: error.message
        });
      }
    }

    const submittedCount = results.filter((item) => item.ok).length;
    const failedCount = results.filter((item) => !item.ok).length;
    await saveReachoutLog({
      id: batchId,
      kind: "batch",
      type: submittedCount > 0 && failedCount > 0 ? "partial" : (submittedCount > 0 ? "submitted" : "error"),
      channel,
      templateId: template.id,
      templateName: template.name,
      integratedNumber,
      sentBy: session.name || session.email || session.role,
      attempted: results.length,
      submitted: submittedCount,
      failed: failedCount,
      audienceCount: results.length,
      message: `${submittedCount} submitted, ${failedCount} failed.`,
      leads: results.map((item) => normalizeReachoutBatchLead({
        leadId: item.leadId,
        leadName: item.leadName,
        phone: item.phone,
        email: item.email,
        status: item.ok ? "submitted" : "error",
        submittedAt: new Date().toISOString(),
        errorMessage: item.message || "",
        providerMessageId: item.providerMessageId || "",
        lastEventStatus: item.ok ? "submitted" : "failed",
        lastEventAt: new Date().toISOString(),
        events: item.ok ? {} : { failed: true }
      })),
      summaryIncrements: {
        submitted: submittedCount,
        error: failedCount
      }
    });

    await stateCollection.updateOne(
      { _id: STATE_DOC_ID },
      { $set: { updatedAt: new Date().toISOString() } },
      { upsert: true }
    );
    cachedStateDoc = null;
    cachedStateDocAt = 0;

    return res.json({
      ok: true,
      attempted: results.length,
      submitted: submittedCount,
      failed: failedCount,
      batchId,
      results
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to send ReachOut messages.", details: err.message });
  }
});

app.post("/api/reachout/whatsapp/webhook", async (req, res) => {
  try {
    await initMongo();
    const normalized = normalizeReachoutWebhookEvent(req.body || {});
    const state = await getStateDoc();
    const lead =
      (normalized.leadId ? findLeadByIdentity(state, normalized.leadId, normalized.leadEmail) : null)
      || ((Array.isArray(state?.leads) ? state.leads : []).find((item) => (
        normalized.leadEmail && String(item?.email || "").trim().toLowerCase() === normalized.leadEmail
      )) || null)
      || (normalized.phone ? findLeadByPhone(state, normalized.phone) : null);

    if (!lead) {
      return res.status(202).json({
        ok: true,
        matched: false,
        message: "Webhook received but no matching lead was found."
      });
    }

    const activity = buildReachoutWebhookActivity(normalized);
    const isDuplicate = await isDuplicateReachoutWebhookActivity(lead.id, activity, normalized);
    if (isDuplicate) {
      return res.json({
        ok: true,
        matched: true,
        duplicate: true,
        leadId: String(lead.id || ""),
        status: normalized.status
      });
    }

    await recordActivity({
      leadId: lead.id,
      leadName: lead.name || normalized.leadName,
      counselorName: lead.counselor || normalized.counselorName || "",
      activityType: activity.activityType,
      actionDescription: activity.actionDescription,
      newValue: activity.newValue || normalized.phone || "",
      remarks: activity.remarks || null,
      session: { role: "system", name: "ReachOut Webhook" }
    });
    await updateReachoutBatchLogForEvent(lead, normalized).catch(() => null);

    const historyEvent = {
      at: new Date().toISOString(),
      source: "ReachOut Webhook",
      activityType: activity.activityType,
      description: activity.actionDescription,
      newValue: activity.newValue || normalized.phone || "",
      remarks: activity.remarks || null,
      by: "ReachOut Webhook"
    };
    const isMainAdmissionLead = String(lead?.leadPipeline || "").trim().toLowerCase() === "main-admission";
    const historyField = isMainAdmissionLead ? "mainAdmissionActivityHistory" : "admissionActivityHistory";
    const countField = isMainAdmissionLead ? "mainAdmissionActivityUpdates" : "postActivityUpdates";
    const existingHistory = Array.isArray(lead?.[historyField]) ? lead[historyField] : [];
    await leadsCollection.updateOne(
      { id: { $in: getLeadIdCandidates(lead.id) } },
      {
        $push: { [historyField]: historyEvent },
        $set: {
          [countField]: existingHistory.length + 1
        }
      }
    );

    return res.json({
      ok: true,
      matched: true,
      leadId: String(lead.id || ""),
      status: normalized.status
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to process ReachOut webhook.", details: err.message });
  }
});

app.get("/api/activity-history/lead-ids", async (req, res) => {
  try {
    const session = await requireRole(req, res, ["admin", "counselor"]);
    if (!session) return;

    await initMongo();
    const rawTypes = String(req.query?.activityTypes || "").trim();
    const activityTypes = rawTypes
      .split(",")
      .map((item) => String(item || "").trim())
      .filter(Boolean);

    if (!activityTypes.length) {
      return res.json({ ok: true, leadIds: [] });
    }

    const leadIds = await withMongoRetry(
      () => activityLogsCollection.distinct("leadId", {
        activityType: { $in: activityTypes }
      }),
      { retries: 1, label: "Fetch lead ids by activity types" }
    );

    return res.json({
      ok: true,
      leadIds: Array.isArray(leadIds) ? leadIds.map((item) => String(item || "").trim()).filter(Boolean) : []
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch activity lead ids", details: error.message });
  }
});

app.post("/api/mcube/webhook", async (req, res) => {
  res.status(200).json({ ok: true });

  try {
    const body = parseMcubeWebhookRequestBody(req) || {};
    await processMcubeWebhookPayload(req, body);
  } catch (err) {
    const rawPayload = parseMcubeWebhookRequestBody(req) || {};
    const normalized = normalizeMcubeEvent(rawPayload);
    await enqueueMcubeRetryJob({
      jobType: "webhook-event",
      dedupeKey: [
        "webhook-event",
        String(normalized.callId || "").trim() || "-",
        String(normalized.phone || "").trim() || "-",
        String(normalized.eventType || "").trim() || "-"
      ].join("|"),
      payload: rawPayload,
      leadId: normalized.leadId || "",
      phone: normalized.phone || "",
      callId: normalized.callId || "",
      eventType: normalized.eventType || "",
      reason: "process-webhook-event",
      lastError: err?.message || "unknown error"
    }).catch(() => undefined);
    try {
      await saveMcubeLog({ type: "error", message: `MCUBE webhook processing error: ${err.message || "unknown error"}` });
    } catch {}
  }
});

app.post("/api/webhook/elementor-lead", async (req, res) => {
  res.status(200).json({ success: true });

  try {
    const payload = req.body && typeof req.body === "object" ? req.body : {};
    await processElementorWebhookPayload(payload);
  } catch (err) {
    const payload = req.body && typeof req.body === "object" ? req.body : {};
    const fields = getElementorFieldMap(payload);
    await enqueueElementorRetryJob({
      payload,
      formId: String(fields.form_id || "").trim(),
      formName: String(fields.form_name || "").trim(),
      pageUrl: String(fields.page_url || "").trim(),
      reason: "process-webhook-event",
      lastError: err?.message || "unknown error"
    }).catch(() => undefined);
    try {
      await saveElementorLog({
        type: "error",
        message: `Webhook processing error: ${err.message || "unknown error"}`
      });
    } catch {}
  }
});

app.get("/api/admin/backup", async (req, res) => {
  try {
    await initMongo();
    const session = await requireRole(req, res, "admin");
    if (!session) return;

    const payload = await buildBackupPayload();
    const filename = `i-crm-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("X-Backup-Filename", filename);
    return res.json(payload);
  } catch (error) {
    return res.status(500).json({ message: "Failed to export backup", details: error.message });
  }
});

app.post("/api/admin/restore", async (req, res) => {
  try {
    await initMongo();
    const session = await requireRole(req, res, "admin");
    if (!session) return;

    const validation = validateBackupPayload(req.body || {});
    if (!validation.ok) {
      return res.status(400).json({ message: validation.message });
    }

    const restoredAt = new Date().toISOString();
    const snapshot = validation.snapshot;
    snapshot.state.updatedAt = restoredAt;

    if (Array.isArray(snapshot.state.leads)) {
      const duplicateViolation = findLeadDuplicateViolation(snapshot.state.leads, []);
      if (duplicateViolation) {
        return res.status(409).json({
          message: `Restore blocked: duplicate ${duplicateViolation.field} already exists in the backup snapshot.`,
          field: duplicateViolation.field,
          leadId: duplicateViolation.lead?.id || null
        });
      }
    }

    await Promise.all([
      leadsCollection.deleteMany({}),
      counselorsCollection.deleteMany({}),
      tasksCollection.deleteMany({}),
      allocationCollection.deleteMany({}),
      lsqArchiveCollection.deleteMany({})
    ]);

    if (Array.isArray(snapshot.state.leads) && snapshot.state.leads.length) {
      await leadsCollection.insertMany(decorateLeadListForStorage(snapshot.state.leads));
      await syncLeadSequence().catch(() => undefined);
    }
    if (Array.isArray(snapshot.state.counselors) && snapshot.state.counselors.length) {
      await counselorsCollection.insertMany(snapshot.state.counselors);
    }
    if (Array.isArray(snapshot.state.tasks) && snapshot.state.tasks.length) {
      await tasksCollection.insertMany(snapshot.state.tasks);
    }
    if (Array.isArray(snapshot.state.allocation) && snapshot.state.allocation.length) {
      await allocationCollection.insertMany(snapshot.state.allocation);
    }
    if (Array.isArray(snapshot.lsqArchiveLeads) && snapshot.lsqArchiveLeads.length) {
      await lsqArchiveCollection.insertMany(snapshot.lsqArchiveLeads, { ordered: true });
    }

    const metadata = {
      _id: STATE_DOC_ID,
      createdAt: snapshot.state.createdAt || restoredAt,
      updatedAt: restoredAt,
      clearedAt: snapshot.state.clearedAt || null,
      marketingUsers: Array.isArray(snapshot.state.marketingUsers) ? snapshot.state.marketingUsers : []
    };
    await stateCollection.replaceOne(
      { _id: STATE_DOC_ID },
      metadata,
      { upsert: true }
    );

    await preferenceCollection.deleteMany({});
    if (snapshot.preferences.length) {
      await preferenceCollection.insertMany(snapshot.preferences, { ordered: true });
    }

    await metaConfigCollection.deleteMany({});
    if (snapshot.metaConfig) {
      await metaConfigCollection.insertOne(snapshot.metaConfig);
    }

    await metaLogsCollection.deleteMany({});
    if (snapshot.metaLogs.length) {
      await metaLogsCollection.insertMany(snapshot.metaLogs, { ordered: true });
    }

    await metaRetryCollection.deleteMany({});
    if (snapshot.metaRetryJobs.length) {
      await metaRetryCollection.insertMany(snapshot.metaRetryJobs, { ordered: true });
    }

    await elementorConfigCollection.deleteMany({});
    if (snapshot.elementorConfig) {
      await elementorConfigCollection.insertOne(snapshot.elementorConfig);
    }

    await elementorLogsCollection.deleteMany({});
    if (snapshot.elementorLogs.length) {
      await elementorLogsCollection.insertMany(snapshot.elementorLogs, { ordered: true });
    }

    await elementorRetryCollection.deleteMany({});
    if (snapshot.elementorRetryJobs.length) {
      await elementorRetryCollection.insertMany(snapshot.elementorRetryJobs, { ordered: true });
    }

    await mcubeConfigCollection.deleteMany({});
    if (snapshot.mcubeConfig) {
      await mcubeConfigCollection.insertOne(snapshot.mcubeConfig);
    }

    await mcubeLogsCollection.deleteMany({});
    if (snapshot.mcubeLogs.length) {
      await mcubeLogsCollection.insertMany(snapshot.mcubeLogs, { ordered: true });
    }

    await mcubeRetryCollection.deleteMany({});
    if (snapshot.mcubeRetryJobs.length) {
      await mcubeRetryCollection.insertMany(snapshot.mcubeRetryJobs, { ordered: true });
    }

    metaLogWriteCount = 0;
    mcubeLogWriteCount = 0;
    sessionCache.clear();
    const nextState = cacheStateDoc({
      ...metadata,
      leads: snapshot.state.leads || [],
      counselors: snapshot.state.counselors || [],
      tasks: snapshot.state.tasks || [],
      allocation: snapshot.state.allocation || []
    });
    res.setHeader("ETag", buildStateEtag(nextState));

    return res.json({
      ok: true,
      restoredAt,
      restoredCounts: {
        leads: nextState.leads.length,
        counselors: nextState.counselors.length,
        marketingUsers: nextState.marketingUsers.length,
        allocationRules: nextState.allocation.length,
        tasks: nextState.tasks.length,
        preferences: snapshot.preferences.length,
        metaLogs: snapshot.metaLogs.length,
        metaRetryJobs: snapshot.metaRetryJobs.length,
        elementorLogs: snapshot.elementorLogs.length,
        elementorRetryJobs: snapshot.elementorRetryJobs.length,
        mcubeLogs: snapshot.mcubeLogs.length,
        mcubeRetryJobs: snapshot.mcubeRetryJobs.length,
        lsqArchiveLeads: snapshot.lsqArchiveLeads.length
      },
      state: buildStateResponse(nextState)
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to restore backup", details: error.message });
  }
});

app.use("/api", async (_req, res, next) => {
  try {
    await initMongo();
    next();
  } catch (error) {
    res.status(500).json({ message: "Database connection failed", details: error.message });
  }
});

app.post("/api/public-course-registrations", async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const phone = String(req.body?.phone || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const country = String(req.body?.country || "").trim();
    const course = findPublicCourseDefinition(req.body?.courseId);

    if (!name || !phone || !email || !course) {
      return res.status(400).json({ message: "Name, phone, email, and a valid course are required." });
    }

    const snapshot = await getStateDoc();
    const publicCourseSegment = getPublicCourseSegment(course);
    const isCrashCourseRegistration = publicCourseSegment === PUBLIC_COURSE_CRASH_SEGMENT;
    const existingLead = findDuplicateLeadByEmailOrPhone(snapshot.leads, { email, phone });
    const masterLead = findDuplicateNonRegisteredLeadByEmailOrPhone(snapshot.leads, { email, phone });
    const effectiveMasterLead = isCrashCourseRegistration ? null : masterLead;
    const existingRegisteredLead = findDuplicateRegisteredLeadByEmailOrPhoneInSegment(snapshot.leads, { email, phone }, publicCourseSegment);
    const isSameRegisteredCourse = !!existingRegisteredLead && publicCourseLeadMatchesCourse(existingRegisteredLead, course);

    const counselorName = "Unassigned";
    const nextId = existingLead?.id || await getNextMetaLeadId();
    const newLead = buildPublicCourseLead({
      name,
      email,
      phone,
      course,
      counselorName,
      nextId,
      country,
      segment: publicCourseSegment
    });

    if (existingLead) {
      const updatedLead = await updateExistingIntegrationLead(existingLead, newLead, {
        source: "Public Registration"
      });

      await createNotification({
        userId: "admin",
        role: "admin",
        type: "public_course_registration_update",
        title: "Existing Lead Registered Again",
        message: `Lead: ${formatLeadNotificationLabel(updatedLead)}. Registered again for ${course.name}. Existing record retained.`,
        sound: true,
        leadId: updatedLead.id,
        leadName: updatedLead.name,
        assignedCounselor: updatedLead.counselor || "Unassigned"
      });

      if (shouldTreatLeadAsAssigned(updatedLead.counselor)) {
        const escapedName = updatedLead.counselor.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
        const counselorDoc = await counselorsCollection.findOne({
          name: { $regex: new RegExp(`^${escapedName}$`, "i") }
        });
        if (counselorDoc?.email) {
          await createNotification({
            userId: counselorDoc.email,
            role: "counselor",
            type: "public_course_registration_update",
            title: "Existing Lead Registered Again",
            message: `${formatLeadNotificationLabel(updatedLead)} registered again for ${course.code}. Existing lead record was updated.`,
            sound: true,
            leadId: updatedLead.id,
            leadName: updatedLead.name,
            assignedCounselor: updatedLead.counselor
          });
        }
      }

      return res.status(200).json({
        ok: true,
        updatedExisting: true,
        alreadyRegistered: isSameRegisteredCourse,
        message: isSameRegisteredCourse
          ? "Registration was already present on the existing lead."
          : "Registration linked to the existing lead.",
        leadId: updatedLead.id,
        assignedCounselor: String(updatedLead.counselor || "").trim() || "Unassigned"
      });
    }

    const shouldReplaceExistingRegisteredLead = !!existingRegisteredLead && !isSameRegisteredCourse;

    if (shouldReplaceExistingRegisteredLead) {
      const leadIdCandidates = getLeadIdCandidates(existingRegisteredLead.id);
      await withMongoRetry(
        () => leadsCollection.deleteOne({ id: { $in: leadIdCandidates } }),
        { retries: 1, label: "Remove replaced registered lead before course registration insert" }
      );
      await withMongoRetry(
        () => tasksCollection.deleteMany({ leadId: { $in: leadIdCandidates.map((value) => String(value)) } }),
        { retries: 1, label: "Remove replaced registered lead tasks before course registration insert" }
      );
    }

    await withMongoRetry(
      () => leadsCollection.insertOne(decorateLeadForStorage(newLead)),
      { retries: 1, label: "Create public course registration lead" }
    );

    await recordActivity({
      leadId: newLead.id,
      leadName: newLead.name,
      counselorName: newLead.counselor || "",
      activityType: "Lead Created",
      actionDescription: `Lead created via public registration for course ${course.title || course.id}`,
      newValue: `Name: ${newLead.name}, Phone: ${newLead.phone}, Email: ${newLead.email}`
    });

    if (shouldTreatLeadAsAssigned(newLead.counselor)) {
      await recordActivity({
        leadId: newLead.id,
        leadName: newLead.name,
        counselorName: newLead.counselor,
        activityType: "Lead Assigned",
        actionDescription: `Lead initially assigned to counselor ${newLead.counselor}`,
        newValue: newLead.counselor
      });
    }

    const now = new Date().toISOString();
    await stateCollection.updateOne(
      { _id: STATE_DOC_ID },
      { $set: { updatedAt: now } },
      { upsert: true }
    );
    cachedStateDoc = null;
    cachedStateDocAt = 0;

    await createNotification({
      userId: "admin",
      role: "admin",
      type: "public_course_registration",
      title: "New Course Registration",
      message: `Lead: ${formatLeadNotificationLabel(newLead)}. Registered for ${course.name}. Awaiting manual counselor assignment.${!isCrashCourseRegistration && effectiveMasterLead ? " (linked to existing CRM lead)" : ""}${shouldReplaceExistingRegisteredLead ? " (updated registered section)" : ""}`,
      sound: true,
      leadId: nextId,
      leadName: newLead.name,
      assignedCounselor: counselorName
    });

    if (counselorName && counselorName.toLowerCase() !== "unassigned") {
      const escapedName = counselorName.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
      const counselorDoc = await counselorsCollection.findOne({
        name: { $regex: new RegExp(`^${escapedName}$`, "i") }
      });

      if (counselorDoc?.email) {
        await createNotification({
          userId: counselorDoc.email,
          role: "counselor",
          type: "public_course_registration",
          title: "New Registered Candidate",
          message: `You received new registered candidate ${formatLeadNotificationLabel(newLead)} for ${course.code}.`,
          sound: true,
          leadId: nextId,
          leadName: newLead.name,
          assignedCounselor: counselorName
        });
      }
    }

    return res.status(201).json({
      ok: true,
      message: "Registration received.",
      leadId: nextId,
      assignedCounselor: counselorName
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to create course registration lead", details: error.message });
  }
});

app.get("/api/public-course-routing", async (req, res) => {
  try {
    const session = await requireRole(req, res, "admin");
    if (!session) return;

    const segment = normalizePublicCourseSegment(req.query?.segment);
    const config = await getPublicCourseRoutingConfig(segment);
    return res.json({ ok: true, segment, ...config });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch public course routing", details: error.message });
  }
});

app.put("/api/public-course-routing", async (req, res) => {
  try {
    const session = await requireRole(req, res, "admin");
    if (!session) return;

    const segment = normalizePublicCourseSegment(req.query?.segment || req.body?.segment);
    const config = getPublicCourseSegmentConfig(segment);

    const selectedCounselors = Array.isArray(req.body?.selectedCounselors)
      ? req.body.selectedCounselors.map((name) => String(name || "").trim()).filter(Boolean)
      : [];
    const isConfigured = typeof req.body?.isConfigured === "boolean"
      ? req.body.isConfigured
      : selectedCounselors.length > 0;

    const now = new Date().toISOString();
    await preferenceCollection.updateOne(
      { ownerKey: config.routingOwner, scope: config.routingScope },
      {
        $set: {
          value: { selectedCounselors, isConfigured },
          updatedAt: now
        },
        $setOnInsert: {
          ownerKey: config.routingOwner,
          scope: config.routingScope,
          createdAt: now
        }
      },
      { upsert: true }
    );

    return res.json({ ok: true, segment, selectedCounselors, isConfigured });
  } catch (error) {
    return res.status(500).json({ message: "Failed to save public course routing", details: error.message });
  }
});

function sanitizeState(payload = {}) {
  const next = {};

  if (Array.isArray(payload.leads)) {
    next.leads = payload.leads;
  }
  if (Array.isArray(payload.counselors)) {
    next.counselors = payload.counselors;
  }
  if (Array.isArray(payload.adminUsers)) {
    next.adminUsers = payload.adminUsers;
  }
  if (Array.isArray(payload.marketingUsers)) {
    next.marketingUsers = payload.marketingUsers;
  }
  if (Array.isArray(payload.allocation)) {
    next.allocation = payload.allocation;
  }
  if (Array.isArray(payload.tasks)) {
    next.tasks = payload.tasks;
  }

  return next;
}

function getCounselorIdentityKey(counselor = {}) {
  const id = String(counselor?.id || "").trim().toLowerCase();
  if (id) return `id:${id}`;

  const email = String(counselor?.email || "").trim().toLowerCase();
  if (email) return `email:${email}`;

  return "";
}

function preserveCounselorRoutingFields(nextCounselors = [], existingCounselors = []) {
  const existingByKey = new Map();
  (Array.isArray(existingCounselors) ? existingCounselors : []).forEach((counselor) => {
    const key = getCounselorIdentityKey(counselor);
    if (key) existingByKey.set(key, counselor);
  });

  return (Array.isArray(nextCounselors) ? nextCounselors : []).map((counselor) => {
    const existing = existingByKey.get(getCounselorIdentityKey(counselor));
    if (!existing) return counselor;

    return {
      ...counselor,
      roundRobinEnabled: existing.roundRobinEnabled,
      admissionRoundRobinEnabled: existing.admissionRoundRobinEnabled,
      admissionCoursePermissions: normalizeAdmissionCoursePermissionIds(existing.admissionCoursePermissions)
    };
  });
}

function normalizeLeadContactValue(value) {
  return String(value || "").trim();
}

function normalizePublicCourseSegment(segment) {
  return String(segment || "").trim().toLowerCase() === PUBLIC_COURSE_CRASH_SEGMENT
    ? PUBLIC_COURSE_CRASH_SEGMENT
    : PUBLIC_COURSE_DEFAULT_SEGMENT;
}

function getPublicCourseSegmentConfig(segment) {
  return PUBLIC_COURSE_SEGMENT_CONFIG[normalizePublicCourseSegment(segment)];
}

function getPublicCourseSegment(course) {
  const courseId = String(course?.courseId || course?.id || "").trim();
  return courseId === "days7_genai"
    ? PUBLIC_COURSE_CRASH_SEGMENT
    : PUBLIC_COURSE_DEFAULT_SEGMENT;
}

function findPublicCourseDefinition(courseId) {
  return PUBLIC_COURSE_CATALOG.find((course) => course.id === String(courseId || "").trim()) || null;
}

async function getPublicCourseRoutingConfig(segment = PUBLIC_COURSE_DEFAULT_SEGMENT) {
  const config = getPublicCourseSegmentConfig(segment);
  const preference = await preferenceCollection.findOne({
    ownerKey: config.routingOwner,
    scope: config.routingScope
  });

  const selectedCounselors = Array.isArray(preference?.value?.selectedCounselors)
    ? preference.value.selectedCounselors.map((name) => String(name || "").trim()).filter(Boolean)
    : [];
  const isConfigured = typeof preference?.value?.isConfigured === "boolean"
    ? preference.value.isConfigured
    : selectedCounselors.length > 0;

  return {
    selectedCounselors,
    isConfigured
  };
}

function isCounselorEligibleForCourseRegistrations(counselor) {
  return !!counselor && !counselor.disabled;
}

async function assignPublicCourseCounselorRoundRobin(_counselors = [], _segment = PUBLIC_COURSE_DEFAULT_SEGMENT) {
  return "Unassigned";
}

function shouldTreatLeadAsAssigned(counselorName) {
  const normalized = String(counselorName || "").trim().toLowerCase();
  return !!normalized && normalized !== "unassigned";
}

function buildPublicCourseLead({ name, email, phone, course, counselorName, nextId, country, segment }) {
  const now = new Date().toISOString();
  return {
    id: nextId,
    name: String(name || "").trim(),
    email: String(email || "").trim().toLowerCase(),
    phone: String(phone || "").trim(),
    country: String(country || "India").trim(),
    workshop: "",
    courseId: course.id,
    courseName: course.name,
    courseCode: course.code,
    courseDuration: course.duration,
    status: "New",
    source: "Public Course Registration",
    leadPipeline: "course-registration",
    publicCourseSegment: normalizePublicCourseSegment(segment),
    createdAtExact: now,
    createdAt: toKolkataDateKey(),
    counselor: counselorName,
    registeredDialed: "",
    registeredCoursePitched: "",
    registeredCourseStatus: "",
    registeredAdmissionStatus: "",
    registeredCallStatus: "",
    registeredActivityUpdated: false,
    registeredCourseActivityUpdates: 0,
    registeredCourseActivityHistory: [],
    admissionSopAssignedAt: shouldTreatLeadAsAssigned(counselorName) ? now : null,
    admissionSopLastProgressAt: null,
    leadNotes: [],
    importSourceFiles: ["Public Course Landing Page"],
    importSourceSheets: []
  };
}

function isPublicCourseRegistrationLead(lead) {
  return String(lead?.leadPipeline || "").trim().toLowerCase() === "course-registration";
}

function isMainAdmissionLead(lead) {
  return String(lead?.leadPipeline || "").trim().toLowerCase() === MAIN_ADMISSION_PIPELINE;
}

function isCrashCourseRegistrationLead(lead) {
  return isPublicCourseRegistrationLead(lead)
    && normalizePublicCourseSegment(lead?.publicCourseSegment || getPublicCourseSegment(lead)) === PUBLIC_COURSE_CRASH_SEGMENT;
}

function isAdmissionSopScopedLead(lead) {
  return isMainAdmissionLead(lead) || isPublicCourseRegistrationLead(lead);
}

function getKolkataShiftedDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return new Date(date.getTime() + KOLKATA_OFFSET_MS);
}

function getKolkataWeekday(value) {
  const shifted = getKolkataShiftedDate(value);
  return shifted ? shifted.getUTCDay() : null;
}

function getNextKolkataMidnightTs(value) {
  const shifted = getKolkataShiftedDate(value);
  if (!shifted) {
    return null;
  }
  const nextMidnightUtc = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate() + 1,
    0,
    0,
    0,
    0
  );
  return nextMidnightUtc - KOLKATA_OFFSET_MS;
}

function addNonSundayWorkingMs(startValue, durationMs) {
  const startTs = new Date(startValue).getTime();
  let remaining = Math.max(0, Number(durationMs) || 0);
  if (!Number.isFinite(startTs) || remaining <= 0) {
    return Number.isFinite(startTs) ? startTs : null;
  }

  let cursor = startTs;
  while (remaining > 0) {
    const nextBoundary = getNextKolkataMidnightTs(cursor);
    if (!Number.isFinite(nextBoundary) || nextBoundary <= cursor) {
      return cursor + remaining;
    }
    const segmentEnd = cursor + remaining < nextBoundary ? cursor + remaining : nextBoundary;
    const segmentDuration = segmentEnd - cursor;
    if (getKolkataWeekday(cursor) !== 0) {
      remaining -= segmentDuration;
    }
    cursor = segmentEnd;
  }

  return cursor;
}

function addNonSundayWorkingDays(startValue, days) {
  return addNonSundayWorkingMs(startValue, Math.max(0, Number(days) || 0) * 24 * 60 * 60 * 1000);
}

function getNonSundayElapsedMs(startValue, endValue = Date.now()) {
  const startTs = new Date(startValue).getTime();
  const endTs = new Date(endValue).getTime();
  if (!Number.isFinite(startTs) || !Number.isFinite(endTs) || endTs <= startTs) {
    return 0;
  }

  let total = 0;
  let cursor = startTs;
  while (cursor < endTs) {
    const nextBoundary = getNextKolkataMidnightTs(cursor);
    const segmentEnd = !Number.isFinite(nextBoundary) || nextBoundary <= cursor
      ? endTs
      : Math.min(endTs, nextBoundary);
    if (getKolkataWeekday(cursor) !== 0) {
      total += segmentEnd - cursor;
    }
    cursor = segmentEnd;
  }
  return total;
}

function formatRemainingWorkingTime(ms) {
  const remainingMs = Math.max(0, Number(ms) || 0);
  const totalMinutes = Math.ceil(remainingMs / 60000);
  const totalHours = totalMinutes / 60;
  if (totalHours < 24) {
    return `${Math.max(0, Math.ceil(totalHours))}h`;
  }
  const totalDays = totalHours / 24;
  if (totalDays < 10) {
    return `${totalDays.toFixed(1)}d`;
  }
  return `${Math.ceil(totalDays)}d`;
}

function getAdmissionSopTrackingConfig(lead) {
  if (isMainAdmissionLead(lead)) {
    return {
      scope: "main-admission",
      admissionStatusField: "mainAdmissionAdmissionStatus",
      activityUpdatedField: "mainAdmissionActivityUpdated",
      activityHistoryField: "mainAdmissionActivityHistory",
      route: "main-admission-leads.html",
      sectionLabel: "Main Admission"
    };
  }
  if (isPublicCourseRegistrationLead(lead)) {
    return {
      scope: normalizePublicCourseSegment(lead?.publicCourseSegment || getPublicCourseSegment(lead)) === PUBLIC_COURSE_CRASH_SEGMENT
        ? "crash-course"
        : "registered-candidates",
      admissionStatusField: "registeredAdmissionStatus",
      activityUpdatedField: "registeredActivityUpdated",
      activityHistoryField: "registeredCourseActivityHistory",
      route: "registered-candidates.html",
      sectionLabel: normalizePublicCourseSegment(lead?.publicCourseSegment || getPublicCourseSegment(lead)) === PUBLIC_COURSE_CRASH_SEGMENT
        ? "Crash Course"
        : "Registered Candidates"
    };
  }
  return null;
}

function normalizeAdmissionSopStatus(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function getAdmissionSopAnchorAt(lead, trackingConfig) {
  const explicit = String(lead?.admissionSopLastProgressAt || "").trim();
  if (explicit) {
    return explicit;
  }

  const history = Array.isArray(lead?.[trackingConfig?.activityHistoryField]) ? lead[trackingConfig.activityHistoryField] : [];
  const latestEntry = history
    .map((entry) => String(entry?.at || "").trim())
    .filter(Boolean)
    .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0];
  if (latestEntry) {
    return latestEntry;
  }

  const hasActivity = Boolean(lead?.[trackingConfig?.activityUpdatedField]);
  if (hasActivity) {
    return String(lead?.updatedAt || lead?.createdAtExact || "").trim() || null;
  }

  return null;
}

function resolveAdmissionSopBaseTimestamp(lead) {
  const candidates = [
    lead?.admissionSopAssignedAt,
    lead?.counselorAssignedAt,
    lead?.createdAtExact,
    lead?.updatedAt
  ].map((value) => String(value || "").trim()).filter(Boolean);

  for (const candidate of candidates) {
    const parsed = new Date(candidate).getTime();
    if (Number.isFinite(parsed)) {
      return candidate;
    }
  }

  const createdAt = String(lead?.createdAt || "").trim();
  if (isDateOnlyString(createdAt)) {
    return `${createdAt}T00:00:00+05:30`;
  }

  if (createdAt) {
    const parsed = new Date(createdAt).getTime();
    if (Number.isFinite(parsed)) {
      return createdAt;
    }
  }

  return null;
}

function deriveAdmissionSopState(lead, nowValue = Date.now()) {
  if (!isAdmissionSopScopedLead(lead)) {
    return null;
  }

  const trackingConfig = getAdmissionSopTrackingConfig(lead);
  if (!trackingConfig) {
    return null;
  }

  const counselor = String(lead?.counselor || "").trim();
  const assignedAt = resolveAdmissionSopBaseTimestamp(lead);
  const currentStatus = String(lead?.[trackingConfig.admissionStatusField] || "").trim();
  const normalizedStatus = normalizeAdmissionSopStatus(currentStatus);
  const progressAnchorAt = getAdmissionSopAnchorAt(lead, trackingConfig);
  const hasStartedProgress = Boolean(progressAnchorAt);
  const isWon = normalizedStatus === "won" || normalizedStatus === "enrolled";
  const isOfferedStage = normalizedStatus === "opportunity" || normalizedStatus === "offered";
  const isAssigned = counselor && counselor.toLowerCase() !== "unassigned";
  const nowTs = new Date(nowValue).getTime();

  if (!isAssigned) {
    return {
      scope: trackingConfig.scope,
      sectionLabel: trackingConfig.sectionLabel,
      route: trackingConfig.route,
      stageKey: "unassigned",
      stageLabel: "Unassigned",
      blocked: false,
      isDueSoon: false,
      countdownLabel: "",
      assignedAt,
      lastProgressAt: progressAnchorAt,
      deadlineAt: null,
      remainingMs: null
    };
  }

  if (isWon) {
    return {
      scope: trackingConfig.scope,
      sectionLabel: trackingConfig.sectionLabel,
      route: trackingConfig.route,
      stageKey: "won",
      stageLabel: currentStatus || "Won / Enrolled",
      blocked: false,
      isDueSoon: false,
      countdownLabel: "No expiry",
      assignedAt,
      lastProgressAt: progressAnchorAt,
      deadlineAt: null,
      remainingMs: null
    };
  }

  const anchorAt = hasStartedProgress ? progressAnchorAt : assignedAt;
  if (!anchorAt) {
    return {
      scope: trackingConfig.scope,
      sectionLabel: trackingConfig.sectionLabel,
      route: trackingConfig.route,
      stageKey: "unassigned",
      stageLabel: "Awaiting assignment",
      blocked: false,
      isDueSoon: false,
      countdownLabel: "",
      assignedAt: null,
      lastProgressAt: progressAnchorAt,
      deadlineAt: null,
      remainingMs: null
    };
  }

  const deadlineTs = hasStartedProgress
    ? (isOfferedStage
        ? addNonSundayWorkingDays(anchorAt, ADMISSION_SOP_OFFERED_WINDOW_DAYS)
        : addNonSundayWorkingDays(anchorAt, ADMISSION_SOP_ACTIVE_WINDOW_DAYS))
    : addNonSundayWorkingMs(anchorAt, ADMISSION_SOP_NEW_WINDOW_MS);
  const remainingMs = Number.isFinite(deadlineTs) ? deadlineTs - nowTs : null;
  const blocked = Number.isFinite(remainingMs) ? remainingMs <= 0 : false;
  const elapsedMs = getNonSundayElapsedMs(anchorAt, nowTs);
  const dueSoonThresholdMs = hasStartedProgress
    ? ((isOfferedStage ? 5 : 3) * 24 * 60 * 60 * 1000)
    : (12 * 60 * 60 * 1000);
  const stageKey = !hasStartedProgress
    ? "new"
    : (isOfferedStage ? "offered" : "active");
  const baseLabel = !hasStartedProgress
    ? "New window"
    : (isOfferedStage ? "Opportunity / Offered" : "Active management");

  return {
    scope: trackingConfig.scope,
    sectionLabel: trackingConfig.sectionLabel,
    route: trackingConfig.route,
    stageKey,
    stageLabel: baseLabel,
    blocked,
    isDueSoon: !blocked && elapsedMs >= 0 && remainingMs !== null && remainingMs <= dueSoonThresholdMs,
    countdownLabel: blocked ? "Blocked" : formatRemainingWorkingTime(remainingMs),
    assignedAt,
    lastProgressAt: progressAnchorAt,
    deadlineAt: Number.isFinite(deadlineTs) ? new Date(deadlineTs).toISOString() : null,
    remainingMs: Number.isFinite(remainingMs) ? remainingMs : null
  };
}

function publicCourseLeadMatchesCourse(lead, course) {
  const courseId = String(course?.id || "").trim();
  const courseCode = String(course?.code || "").trim().toLowerCase();
  const courseName = String(course?.name || "").trim().toLowerCase();

  if (!courseId && !courseCode && !courseName) {
    return false;
  }

  return String(lead?.courseId || "").trim() === courseId
    || String(lead?.courseCode || "").trim().toLowerCase() === courseCode
    || String(lead?.courseName || "").trim().toLowerCase() === courseName;
}

function normalizeLeadPhone(value) {
  const digits = normalizeLeadContactValue(value).replace(/\D+/g, "");
  if (digits.length === 12 && digits.startsWith("91")) {
    return digits.slice(-10);
  }
  return digits;
}

function normalizeLeadEmail(value) {
  return normalizeLeadContactValue(value).toLowerCase();
}

function decorateLeadDuplicateKeys(lead = {}) {
  const normalizedEmail = normalizeLeadEmail(lead?.email);
  const normalizedPhone = normalizeLeadPhone(lead?.phone);
  const nextLead = { ...lead };
  const metaLeadId = normalizeLeadContactValue(lead?.metaLeadId);

  if (normalizedEmail) {
    nextLead.normalizedEmail = normalizedEmail;
  } else {
    delete nextLead.normalizedEmail;
  }

  if (normalizedPhone) {
    nextLead.normalizedPhone = normalizedPhone;
  } else {
    delete nextLead.normalizedPhone;
  }

  if (metaLeadId) {
    nextLead.metaLeadId = metaLeadId;
  } else {
    delete nextLead.metaLeadId;
  }

  return nextLead;
}

function decorateLeadWorkshopFields(lead = {}) {
  const nextLead = { ...lead };
  const workshopIdentity = buildWorkshopIdentity(lead?.workshop);
  const admissionWorkshopIdentity = buildWorkshopIdentity(lead?.admissionWorkshop);

  if (workshopIdentity.label) {
    nextLead.workshop = workshopIdentity.label;
    nextLead.workshopKey = workshopIdentity.key;
    nextLead.workshopName = workshopIdentity.topicLabel;
    nextLead.workshopNameKey = workshopIdentity.topicKey;
    nextLead.workshopDateLabel = workshopIdentity.dateLabel;
    nextLead.workshopDateKey = workshopIdentity.dateKey;
  } else {
    nextLead.workshop = String(lead?.workshop || "").trim();
    delete nextLead.workshopKey;
    delete nextLead.workshopName;
    delete nextLead.workshopNameKey;
    delete nextLead.workshopDateLabel;
    delete nextLead.workshopDateKey;
  }

  if (admissionWorkshopIdentity.label) {
    nextLead.admissionWorkshop = admissionWorkshopIdentity.label;
    nextLead.admissionWorkshopKey = admissionWorkshopIdentity.key;
    nextLead.admissionWorkshopName = admissionWorkshopIdentity.topicLabel;
    nextLead.admissionWorkshopNameKey = admissionWorkshopIdentity.topicKey;
    nextLead.admissionWorkshopDateLabel = admissionWorkshopIdentity.dateLabel;
    nextLead.admissionWorkshopDateKey = admissionWorkshopIdentity.dateKey;
  } else {
    nextLead.admissionWorkshop = String(lead?.admissionWorkshop || "").trim();
    delete nextLead.admissionWorkshopKey;
    delete nextLead.admissionWorkshopName;
    delete nextLead.admissionWorkshopNameKey;
    delete nextLead.admissionWorkshopDateLabel;
    delete nextLead.admissionWorkshopDateKey;
  }

  return nextLead;
}

function decorateLeadCourseFields(lead = {}) {
  const nextLead = { ...lead };
  const courseIdentity = buildCourseIdentity(lead?.courseName, lead);
  const rawCourseName = normalizeMetaLabel(lead?.courseRawName || lead?.courseName);

  if (courseIdentity.label) {
    nextLead.courseName = courseIdentity.label;
    nextLead.courseKey = courseIdentity.key;
    nextLead.courseRawName = rawCourseName || courseIdentity.rawLabel || courseIdentity.label;
  } else {
    nextLead.courseName = String(lead?.courseName || "").trim();
    delete nextLead.courseKey;
    if (rawCourseName) {
      nextLead.courseRawName = rawCourseName;
    } else {
      delete nextLead.courseRawName;
    }
  }

  return nextLead;
}

function decorateLeadForStorage(lead = {}) {
  return decorateLeadDuplicateKeys(decorateLeadCourseFields(decorateLeadWorkshopFields(lead)));
}

function decorateLeadListForStorage(leads = []) {
  return (Array.isArray(leads) ? leads : []).map((lead) => decorateLeadForStorage(lead));
}

function hasLeadStorageDecorationChanges(lead = {}) {
  return JSON.stringify(decorateLeadForStorage(lead)) !== JSON.stringify(lead);
}

async function normalizeStoredLeadsCollection() {
  const storedLeads = await withMongoRetry(
    () => leadsCollection.find({}).toArray(),
    { retries: 1, label: "Load leads for workshop normalization" }
  );

  const replacements = (Array.isArray(storedLeads) ? storedLeads : [])
    .filter((lead) => lead && lead.id && hasLeadStorageDecorationChanges(lead))
    .map((lead) => ({
      id: String(lead.id),
      replacement: decorateLeadForStorage(lead)
    }));

  if (!replacements.length) {
    return 0;
  }

  if (typeof leadsCollection.bulkWrite === "function") {
    await withMongoRetry(
      () => leadsCollection.bulkWrite(
        replacements.map(({ id, replacement }) => ({
          replaceOne: {
            filter: { id },
            replacement,
            upsert: false
          }
        })),
        { ordered: false }
      ),
      { retries: 1, label: "Normalize stored workshop labels" }
    );
  } else {
    for (const { id, replacement } of replacements) {
      await withMongoRetry(
        () => leadsCollection.replaceOne({ id }, replacement, { upsert: false }),
        { retries: 1, label: "Normalize stored workshop label" }
      );
    }
  }

  await stateCollection.updateOne(
    { _id: STATE_DOC_ID },
    { $set: { updatedAt: new Date().toISOString() } },
    { upsert: true }
  ).catch(() => undefined);

  cachedStateDoc = null;
  cachedStateDocAt = 0;
  return replacements.length;
}

async function ensureLeadStorageNormalization() {
  if (leadStorageNormalizationPromise) {
    return leadStorageNormalizationPromise;
  }

  leadStorageNormalizationPromise = (async () => {
    try {
      return await normalizeStoredLeadsCollection();
    } finally {
      leadStorageNormalizationPromise = null;
    }
  })();

  return leadStorageNormalizationPromise;
}

function normalizeWorkshopName(workshopName) {
  const identity = buildWorkshopIdentity(workshopName);
  return identity.key || String(workshopName || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function isSameWorkshopLead(existingLead, incomingLead) {
  const existingKey = String(existingLead?.workshopKey || normalizeWorkshopName(existingLead?.workshop)).trim();
  const incomingKey = String(incomingLead?.workshopKey || normalizeWorkshopName(incomingLead?.workshop)).trim();
  return existingKey === incomingKey;
}

function buildWorkshopMigrationSnapshot(lead = {}) {
  return {
    migratedAt: new Date().toISOString(),
    id: String(lead.id || "").trim(),
    workshop: String(lead.workshop || "").trim(),
    admissionWorkshop: String(lead.admissionWorkshop || "").trim(),
    status: String(lead.status || "").trim(),
    source: String(lead.source || "").trim(),
    counselor: String(lead.counselor || "").trim(),
    createdAt: String(lead.createdAt || "").trim(),
    dialed: String(lead.dialed || "").trim(),
    callStatus: String(lead.callStatus || "").trim(),
    wsStatus: String(lead.wsStatus || "").trim(),
    whatsappInvite: String(lead.whatsappInvite || "").trim(),
    postDialed: String(lead.postDialed || "").trim(),
    postCallStatus: String(lead.postCallStatus || "").trim(),
    coursePitched: String(lead.coursePitched || "").trim(),
    courseStatus: String(lead.courseStatus || "").trim(),
    admissionStatus: String(lead.admissionStatus || "").trim(),
    workshopJoiningStatus: String(lead.workshopJoiningStatus || "").trim(),
    whatsappGroupStatus: String(lead.whatsappGroupStatus || "").trim(),
    preActivityUpdates: Number(lead.preActivityUpdates) || 0,
    postActivityUpdates: Number(lead.postActivityUpdates) || 0,
    workshopActivityHistory: Array.isArray(lead.workshopActivityHistory) ? structuredClone(lead.workshopActivityHistory) : [],
    admissionActivityHistory: Array.isArray(lead.admissionActivityHistory) ? structuredClone(lead.admissionActivityHistory) : [],
    leadNotes: Array.isArray(lead.leadNotes) ? structuredClone(lead.leadNotes) : []
  };
}

function buildFreshWorkshopLead(existingLead, incomingLead, options = {}) {
  const now = new Date();
  const createdAt = toKolkataDateKey(now);
  const createdAtExact = now.toISOString();
  const workshopMigrationHistory = Array.isArray(existingLead?.workshopMigrationHistory)
    ? structuredClone(existingLead.workshopMigrationHistory)
    : [];

  workshopMigrationHistory.push(buildWorkshopMigrationSnapshot(existingLead));

  const preservedCounselor = String(existingLead?.counselor || incomingLead?.counselor || "").trim();
  const nextLead = {
    ...existingLead,
    ...incomingLead,
    id: existingLead.id,
    name: String(existingLead?.name || incomingLead?.name || "").trim() || "Unknown",
    email: String(existingLead?.email || incomingLead?.email || "").trim().toLowerCase(),
    phone: String(existingLead?.phone || incomingLead?.phone || "").trim(),
    counselor: preservedCounselor,
    workshop: String(incomingLead?.workshop || "").trim() || String(existingLead?.workshop || "").trim(),
    admissionWorkshop: String(incomingLead?.workshop || "").trim() || String(existingLead?.admissionWorkshop || existingLead?.workshop || "").trim(),
    source: String(incomingLead?.source || existingLead?.source || "").trim(),
    status: "New",
    createdAtExact,
    createdAt,
    dialed: "",
    callStatus: "",
    wsStatus: "",
    whatsappInvite: "",
    postDialed: "",
    postCallStatus: "",
    coursePitched: "",
    courseStatus: "",
    admissionStatus: "",
    workshopJoiningStatus: "",
    postStatusUpdated: false,
    preActivityUpdates: 0,
    postActivityUpdates: 0,
    workshopActivityHistory: [],
    admissionActivityHistory: [],
    whatsappGroupStatus: "",
    leadNotes: [],
    workshopMigrationHistory,
    lastWorkshopMigrationAt: now.toISOString(),
    lastWorkshopMigrationSource: String(options.source || incomingLead?.source || existingLead?.source || "").trim()
  };

  return decorateLeadForStorage(nextLead);
}

function hasMeaningfulLeadUpdateValue(value) {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === "object") {
    return Object.keys(value).length > 0;
  }
  return true;
}

function buildProtectedIntegrationLeadUpdate(existingLead, incomingLead) {
  const nextLead = { ...existingLead };
  const mergeableFields = [
    "courseName",
    "courseRawName",
    "courseKey",
    "courseId",
    "courseCode",
    "courseDuration",
    "country",
    "publicCourseSegment",
    "workshop",
    "workshopKey",
    "workshopName",
    "workshopNameKey",
    "workshopDateLabel",
    "workshopDateKey",
    "admissionWorkshop",
    "admissionWorkshopKey",
    "admissionWorkshopName",
    "admissionWorkshopNameKey",
    "admissionWorkshopDateLabel",
    "admissionWorkshopDateKey",
    "highestQualification",
    "metaLeadId",
    "metaFormId",
    "metaAdId",
    "metaAdName",
    "metaAdsetName",
    "metaCampaignName",
    "metaExtraFields",
    "elementorFormId",
    "elementorFormName",
    "elementorPageUrl",
    "elementorSubmittedDate",
    "elementorSubmittedTime",
    "elementorRemoteIp",
    "elementorUserAgent",
    "elementorExtraFields",
    "importSourceFiles",
    "importSourceSheets"
  ];

  mergeableFields.forEach((key) => {
    const value = incomingLead?.[key];
    if (!hasMeaningfulLeadUpdateValue(value)) {
      return;
    }
    nextLead[key] = value;
  });

  nextLead.id = existingLead.id;
  nextLead.name = String(existingLead?.name || incomingLead?.name || "").trim() || "Unknown";
  nextLead.email = String(existingLead?.email || incomingLead?.email || "").trim().toLowerCase();
  nextLead.phone = String(existingLead?.phone || incomingLead?.phone || "").trim();
  nextLead.createdAt = String(existingLead?.createdAt || incomingLead?.createdAt || "").trim();
  nextLead.counselor = String(existingLead?.counselor || "").trim();
  nextLead.leadPipeline = String(existingLead?.leadPipeline || "").trim();
  nextLead.source = String(existingLead?.source || "").trim();
  nextLead.status = String(existingLead?.status || "").trim();

  return decorateLeadForStorage(nextLead);
}

function buildDuplicateLeadGroups(leads = []) {
  const list = Array.isArray(leads) ? leads.filter(Boolean) : [];
  const idToLead = new Map();
  const idToTokens = new Map();
  const tokenToIds = new Map();

  list.forEach((lead) => {
    const id = String(lead?.id || "").trim();
    if (!id) {
      return;
    }
    idToLead.set(id, lead);

    const tokens = [];
    const email = normalizeLeadEmail(lead?.email);
    const phone = normalizeLeadPhone(lead?.phone);
    if (email) tokens.push(`email:${email}`);
    if (phone) tokens.push(`phone:${phone}`);
    idToTokens.set(id, tokens);
    tokens.forEach((token) => {
      if (!tokenToIds.has(token)) {
        tokenToIds.set(token, new Set());
      }
      tokenToIds.get(token).add(id);
    });
  });

  const adjacency = new Map();
  idToLead.forEach((_lead, id) => adjacency.set(id, new Set()));
  tokenToIds.forEach((ids) => {
    const members = [...ids];
    if (members.length < 2) {
      return;
    }
    members.forEach((id) => {
      const neighbors = adjacency.get(id) || new Set();
      members.forEach((otherId) => {
        if (otherId !== id) {
          neighbors.add(otherId);
        }
      });
      adjacency.set(id, neighbors);
    });
  });

  const visited = new Set();
  const groups = [];
  const sortLeads = (items) => items.sort((left, right) => {
    const leftDate = new Date(left?.createdAt || 0).getTime() || 0;
    const rightDate = new Date(right?.createdAt || 0).getTime() || 0;
    if (leftDate !== rightDate) return leftDate - rightDate;
    return String(left?.id || "").localeCompare(String(right?.id || ""));
  });

  adjacency.forEach((neighbors, startId) => {
    if (visited.has(startId) || neighbors.size < 1) {
      return;
    }
    const queue = [startId];
    const componentIds = new Set();
    visited.add(startId);
    while (queue.length) {
      const currentId = queue.shift();
      componentIds.add(currentId);
      (adjacency.get(currentId) || []).forEach((neighborId) => {
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          queue.push(neighborId);
        }
      });
    }

    if (componentIds.size < 2) {
      return;
    }

    const componentLeads = sortLeads(
      [...componentIds]
        .map((id) => idToLead.get(id))
        .filter(Boolean)
    );
    const sharedEmails = new Set();
    const sharedPhones = new Set();
    tokenToIds.forEach((ids, token) => {
      const overlap = [...ids].filter((id) => componentIds.has(id));
      if (overlap.length < 2) {
        return;
      }
      if (token.startsWith("email:")) {
        sharedEmails.add(token.slice("email:".length));
      } else if (token.startsWith("phone:")) {
        sharedPhones.add(token.slice("phone:".length));
      }
    });

    groups.push({
      groupId: componentLeads.map((lead) => String(lead.id)).join("__"),
      sharedEmails: [...sharedEmails],
      sharedPhones: [...sharedPhones],
      leadIds: componentLeads.map((lead) => String(lead.id)),
      leads: componentLeads
    });
  });

  return groups.sort((left, right) => {
    const leftTime = new Date(left?.leads?.[0]?.createdAt || 0).getTime() || 0;
    const rightTime = new Date(right?.leads?.[0]?.createdAt || 0).getTime() || 0;
    return rightTime - leftTime;
  });
}

async function getLeadCreatedMetadataMap(leadIds = []) {
  const ids = [...new Set((Array.isArray(leadIds) ? leadIds : []).map((value) => String(value || "").trim()).filter(Boolean))];
  const metadataMap = new Map();
  if (!ids.length || !activityLogsCollection) {
    return metadataMap;
  }

  const logs = await withMongoRetry(
    () => activityLogsCollection.find({
      leadId: { $in: ids },
      activityType: "Lead Created"
    }).sort({ timestamp: 1 }).toArray(),
    { retries: 1, label: "Load lead creation activity logs" }
  ).catch(() => []);

  (Array.isArray(logs) ? logs : []).forEach((log) => {
    const leadId = String(log?.leadId || "").trim();
    if (!leadId || metadataMap.has(leadId)) {
      return;
    }
    const timestamp = String(log?.timestamp || "").trim();
    metadataMap.set(leadId, {
      timestamp,
      display: formatLeadCreatedDisplay(timestamp) || "",
      sortTime: parseLeadCreatedTimeCandidate(timestamp) || 0
    });
  });

  return metadataMap;
}

async function getLeadAssignmentMetadataMap(leads = []) {
  const normalizedLeads = Array.isArray(leads) ? leads : [];
  const ids = [...new Set(
    normalizedLeads
      .map((lead) => String(lead?.id || "").trim())
      .filter(Boolean)
  )];
  const metadataMap = new Map();
  if (!ids.length || !activityLogsCollection) {
    return metadataMap;
  }

  const logs = await withMongoRetry(
    () => activityLogsCollection.find({
      leadId: { $in: ids },
      activityType: { $in: ["Lead Assigned", "Lead Reassigned"] }
    }).sort({ timestamp: -1 }).toArray(),
    { retries: 1, label: "Load lead assignment activity logs" }
  ).catch(() => []);

  const currentCounselorByLeadId = new Map(
    normalizedLeads.map((lead) => [
      String(lead?.id || "").trim(),
      String(lead?.counselor || "").trim().toLowerCase()
    ])
  );

  (Array.isArray(logs) ? logs : []).forEach((log) => {
    const leadId = String(log?.leadId || "").trim();
    if (!leadId || metadataMap.has(leadId)) {
      return;
    }

    const currentCounselor = currentCounselorByLeadId.get(leadId) || "";
    const nextCounselor = String(log?.newValue || log?.counselorName || "").trim();
    if (currentCounselor && nextCounselor && nextCounselor.toLowerCase() !== currentCounselor) {
      return;
    }

    const previousCounselor = String(log?.previousValue || "").trim();
    const assignedAt = String(log?.timestamp || "").trim();
    const isTransferredFromCounselor = (
      String(log?.activityType || "").trim() === "Lead Reassigned" &&
      previousCounselor &&
      previousCounselor.toLowerCase() !== "unassigned"
    );

    metadataMap.set(leadId, {
      ownerType: isTransferredFromCounselor ? "reassigned" : "direct",
      sourceCounselor: isTransferredFromCounselor ? previousCounselor : "",
      assignedAt
    });
  });

  return metadataMap;
}

function resolveLeadCreatedMetadata(lead = {}, createdMetadataMap = new Map()) {
  const leadId = String(lead?.id || "").trim();
  const activityCreated = createdMetadataMap.get(leadId) || null;
  if (activityCreated?.timestamp) {
    return activityCreated;
  }

  const exact = String(lead?.createdAtExact || "").trim();
  const exactSortTime = parseLeadCreatedTimeCandidate(exact);
  if (exactSortTime) {
    return {
      timestamp: exact,
      display: formatLeadCreatedDisplay(exact),
      sortTime: exactSortTime
    };
  }

  const createdAt = String(lead?.createdAt || "").trim();
  if (isIsoDateTimeString(createdAt)) {
    return {
      timestamp: createdAt,
      display: formatLeadCreatedDisplay(createdAt),
      sortTime: parseLeadCreatedTimeCandidate(createdAt) || 0
    };
  }

  return {
    timestamp: createdAt,
    display: createdAt || "Not available",
    sortTime: 0
  };
}

function mergeUniqueStringArrays(...values) {
  return [...new Set(values.flatMap((value) => Array.isArray(value) ? value : []).map((item) => String(item || "").trim()).filter(Boolean))];
}

function mergeLeadActivityArrays(...values) {
  const merged = values.flatMap((value) => Array.isArray(value) ? value : []);
  return merged
    .filter(Boolean)
    .sort((left, right) => {
      const leftTime = new Date(left?.timestamp || left?.updatedAt || 0).getTime() || 0;
      const rightTime = new Date(right?.timestamp || right?.updatedAt || 0).getTime() || 0;
      return leftTime - rightTime;
    });
}

function buildMergedLeadFromDuplicates(keeperLead, duplicateLeads = []) {
  const duplicates = Array.isArray(duplicateLeads) ? duplicateLeads.filter(Boolean) : [];
  const nextLead = structuredClone(keeperLead || {});
  const firstValue = (...candidates) => candidates.find((value) => hasMeaningfulLeadUpdateValue(value));

  nextLead.leadNotes = mergeLeadActivityArrays(nextLead.leadNotes, ...duplicates.map((lead) => lead?.leadNotes));
  nextLead.workshopActivityHistory = mergeLeadActivityArrays(nextLead.workshopActivityHistory, ...duplicates.map((lead) => lead?.workshopActivityHistory));
  nextLead.admissionActivityHistory = mergeLeadActivityArrays(nextLead.admissionActivityHistory, ...duplicates.map((lead) => lead?.admissionActivityHistory));
  nextLead.registeredCourseActivityHistory = mergeLeadActivityArrays(nextLead.registeredCourseActivityHistory, ...duplicates.map((lead) => lead?.registeredCourseActivityHistory));
  nextLead.mainAdmissionActivityHistory = mergeLeadActivityArrays(nextLead.mainAdmissionActivityHistory, ...duplicates.map((lead) => lead?.mainAdmissionActivityHistory));
  nextLead.importSourceFiles = mergeUniqueStringArrays(nextLead.importSourceFiles, ...duplicates.map((lead) => lead?.importSourceFiles));
  nextLead.importSourceSheets = mergeUniqueStringArrays(nextLead.importSourceSheets, ...duplicates.map((lead) => lead?.importSourceSheets));
  nextLead.metaExtraFields = {
    ...(duplicates.map((lead) => lead?.metaExtraFields).filter((value) => value && typeof value === "object").reduce((accumulator, value) => ({ ...accumulator, ...value }), {})),
    ...(nextLead.metaExtraFields && typeof nextLead.metaExtraFields === "object" ? nextLead.metaExtraFields : {})
  };
  nextLead.elementorExtraFields = {
    ...(duplicates.map((lead) => lead?.elementorExtraFields).filter((value) => value && typeof value === "object").reduce((accumulator, value) => ({ ...accumulator, ...value }), {})),
    ...(nextLead.elementorExtraFields && typeof nextLead.elementorExtraFields === "object" ? nextLead.elementorExtraFields : {})
  };

  [
    "courseName",
    "courseRawName",
    "courseKey",
    "courseId",
    "courseCode",
    "courseDuration",
    "country",
    "publicCourseSegment",
    "workshop",
    "workshopKey",
    "workshopName",
    "workshopNameKey",
    "workshopDateLabel",
    "workshopDateKey",
    "admissionWorkshop",
    "admissionWorkshopKey",
    "admissionWorkshopName",
    "admissionWorkshopNameKey",
    "admissionWorkshopDateLabel",
    "admissionWorkshopDateKey",
    "highestQualification",
    "metaLeadId",
    "metaFormId",
    "metaAdId",
    "metaAdName",
    "metaAdsetName",
    "metaCampaignName",
    "elementorFormId",
    "elementorFormName",
    "elementorPageUrl",
    "elementorSubmittedDate",
    "elementorSubmittedTime",
    "elementorRemoteIp",
    "elementorUserAgent"
  ].forEach((field) => {
    nextLead[field] = firstValue(nextLead[field], ...duplicates.map((lead) => lead?.[field])) ?? nextLead[field];
  });

  nextLead.mergedLeadIds = mergeUniqueStringArrays(nextLead.mergedLeadIds, duplicates.map((lead) => lead?.id));
  nextLead.lastMergedAt = new Date().toISOString();
  nextLead.duplicateLeadCount = nextLead.mergedLeadIds.length;
  nextLead.name = String(keeperLead?.name || "").trim();
  nextLead.email = String(keeperLead?.email || "").trim().toLowerCase();
  nextLead.phone = String(keeperLead?.phone || "").trim();
  nextLead.counselor = String(keeperLead?.counselor || "").trim();
  nextLead.leadPipeline = String(keeperLead?.leadPipeline || "").trim();
  nextLead.source = String(keeperLead?.source || "").trim();
  nextLead.status = String(keeperLead?.status || "").trim();
  nextLead.createdAt = String(keeperLead?.createdAt || "").trim();

  return decorateLeadForStorage(nextLead);
}

function getDuplicateLeadSectionKey(lead = {}) {
  const pipeline = String(lead?.leadPipeline || "").trim().toLowerCase();
  if (pipeline === "course-registration") {
    return String(lead?.publicCourseSegment || "").trim().toLowerCase() === PUBLIC_COURSE_CRASH_SEGMENT
      ? "crash-course"
      : "registered-candidates";
  }
  if (pipeline === MAIN_ADMISSION_PIPELINE) {
    return "main-admission";
  }
  return "workshop";
}

function chooseDuplicateKeeperLead(groupLeads = [], createdMetadataMap = new Map(), options = {}) {
  const disallowedSections = new Set(
    (Array.isArray(options?.disallowedKeeperSections) ? options.disallowedKeeperSections : [])
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean)
  );
  const preferNonRegistered = options?.preferNonRegisteredKeeper === true;
  const preferWorkshop = options?.preferWorkshopKeeper === true;

  const rankedLeads = (Array.isArray(groupLeads) ? groupLeads : [])
    .map((lead) => ({
      lead,
      section: getDuplicateLeadSectionKey(lead),
      created: resolveLeadCreatedMetadata(lead, createdMetadataMap)
    }))
    .sort((left, right) => {
      if (preferWorkshop) {
        const leftWorkshop = left.section === "workshop" ? 0 : 1;
        const rightWorkshop = right.section === "workshop" ? 0 : 1;
        if (leftWorkshop !== rightWorkshop) {
          return leftWorkshop - rightWorkshop;
        }
      }
      if (preferNonRegistered) {
        const leftRegistered = ["registered-candidates", "crash-course"].includes(left.section) ? 1 : 0;
        const rightRegistered = ["registered-candidates", "crash-course"].includes(right.section) ? 1 : 0;
        if (leftRegistered !== rightRegistered) {
          return leftRegistered - rightRegistered;
        }
      }
      const leftSort = Number(left.created?.sortTime) || 0;
      const rightSort = Number(right.created?.sortTime) || 0;
      if (leftSort && rightSort && leftSort !== rightSort) {
        return leftSort - rightSort;
      }
      return String(left.lead?.id || "").localeCompare(String(right.lead?.id || ""));
    });

  const allowedRankedLeads = rankedLeads.filter((entry) => !disallowedSections.has(entry.section));
  return (allowedRankedLeads[0] || rankedLeads[0] || {}).lead || null;
}

async function performDuplicateLeadMerge(keeperLead, duplicateLeads = [], session = null, actionDescription = "Admin merged duplicate leads into this record") {
  const mergedLead = buildMergedLeadFromDuplicates(keeperLead, duplicateLeads);
  const duplicateDocumentIdCandidates = [...new Set(
    duplicateLeads.flatMap((lead) => getLeadIdCandidates(lead?.id))
  )];
  const duplicateReferenceIdCandidates = [...new Set(
    duplicateDocumentIdCandidates.map((value) => String(value))
  )];

  try {
    await withMongoRetry(
      () => leadsCollection.deleteMany({ id: { $in: duplicateDocumentIdCandidates } }),
      { retries: 1, label: "Delete merged duplicate leads" }
    );
  } catch (error) {
    throw new Error(`Could not remove duplicate lead records before merge: ${error.message}`);
  }

  try {
    await replaceLeadDocument(mergedLead);
  } catch (error) {
    throw new Error(`Could not update the keeper lead after duplicate removal: ${error.message}`);
  }

  try {
    await withMongoRetry(
      () => tasksCollection.updateMany(
        { leadId: { $in: duplicateReferenceIdCandidates } },
        {
          $set: {
            leadId: String(mergedLead.id || ""),
            leadName: String(mergedLead.name || ""),
            leadPhone: String(mergedLead.phone || ""),
            leadCounselor: String(mergedLead.counselor || ""),
            counselor: String(mergedLead.counselor || "")
          }
        }
      ),
      { retries: 1, label: "Reassign merged lead tasks" }
    );
  } catch (error) {
    throw new Error(`Duplicate lead records were removed, but task reassignment failed: ${error.message}`);
  }

  try {
    await withMongoRetry(
      () => activityLogsCollection.updateMany(
        { leadId: { $in: duplicateReferenceIdCandidates } },
        {
          $set: {
            leadId: String(mergedLead.id || ""),
            leadName: String(mergedLead.name || ""),
            counselorName: String(mergedLead.counselor || "")
          }
        }
      ),
      { retries: 1, label: "Reassign merged lead activity logs" }
    );
  } catch (error) {
    throw new Error(`Duplicate lead records were removed, but activity history reassignment failed: ${error.message}`);
  }

  await recordActivity({
    leadId: mergedLead.id,
    leadName: mergedLead.name,
    counselorName: mergedLead.counselor || "",
    activityType: "Lead Merged",
    actionDescription,
    previousValue: duplicateLeads.map((lead) => `${lead.name || "Unknown"} (${lead.id})`).join(", "),
    newValue: `${mergedLead.name || "Unknown"} (${mergedLead.id})`,
    session
  });

  return mergedLead;
}

async function updateExistingIntegrationLead(existingLead, incomingLead, options = {}) {
  const nextLead = buildProtectedIntegrationLeadUpdate(existingLead, incomingLead);
  const previousRepeatCount = Number.isFinite(Number(existingLead?.repeatEnquiryCount))
    ? Number(existingLead.repeatEnquiryCount)
    : 0;
  const sourceLabel = String(options.source || "Integration").trim() || "Integration";
  const existingRepeatSources = Array.isArray(existingLead?.repeatEnquirySources)
    ? existingLead.repeatEnquirySources.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  const now = new Date().toISOString();
  nextLead.repeatEnquiryCount = previousRepeatCount + 1;
  nextLead.lastRepeatEnquiryAt = now;
  nextLead.lastRepeatEnquirySource = sourceLabel;
  nextLead.repeatEnquirySources = [...new Set([...existingRepeatSources, sourceLabel])];
  await replaceLeadDocument(nextLead);

  const previousCourse = String(existingLead?.courseName || existingLead?.workshop || existingLead?.admissionWorkshop || "").trim();
  const nextCourse = String(nextLead?.courseName || nextLead?.workshop || nextLead?.admissionWorkshop || "").trim();
  await recordActivity({
    leadId: nextLead.id,
    leadName: nextLead.name,
    counselorName: nextLead.counselor || "",
    activityType: "Lead Updated",
    actionDescription: `${sourceLabel} enquiry received again for existing lead${nextCourse && nextCourse !== previousCourse ? ` and course updated to ${nextCourse}` : ""}`,
    previousValue: previousCourse || "Existing lead retained",
    newValue: nextCourse || previousCourse || "Existing lead retained"
  });

  await stateCollection.updateOne(
    { _id: STATE_DOC_ID },
    { $set: { updatedAt: now } },
    { upsert: true }
  );

  cachedStateDoc = null;
  cachedStateDocAt = 0;
  return nextLead;
}

function buildLeadOwnerMap(leads, field) {
  const owners = new Map();
  (Array.isArray(leads) ? leads : []).forEach((lead) => {
    const id = String(lead?.id || "").trim();
    const value = field === "email"
      ? normalizeLeadEmail(lead?.email)
      : normalizeLeadPhone(lead?.phone);
    if (!id || !value) {
      return;
    }

    if (!owners.has(value)) {
      owners.set(value, new Set());
    }
    owners.get(value).add(id);
  });
  return owners;
}

function sameLeadOwnerSet(left, right) {
  if (!(left instanceof Set) || !(right instanceof Set) || left.size !== right.size) {
    return false;
  }

  for (const item of left) {
    if (!right.has(item)) {
      return false;
    }
  }

  return true;
}

function isAllowedRegisteredLeadDuplicateGroup(leads, owners) {
  if (!(owners instanceof Set) || owners.size !== 2) {
    return false;
  }

  const groupedLeads = [...owners]
    .map((ownerId) => (Array.isArray(leads) ? leads : []).find((lead) => String(lead?.id || "").trim() === ownerId))
    .filter(Boolean);

  if (groupedLeads.length !== 2) {
    return false;
  }

  const mainAdmissionCount = groupedLeads.filter((lead) => isMainAdmissionLead(lead)).length;
  if (mainAdmissionCount === 1) {
    return true;
  }

  const registeredCount = groupedLeads.filter((lead) => isPublicCourseRegistrationLead(lead)).length;
  if (registeredCount === 1) {
    return true;
  }

  if (registeredCount === 2) {
    const segments = new Set(groupedLeads.map((lead) => normalizePublicCourseSegment(lead?.publicCourseSegment || getPublicCourseSegment(lead))));
    return segments.size === 2;
  }

  return false;
}

function findLeadDuplicateViolation(nextLeads, currentLeads = []) {
  const currentById = new Map(
    (Array.isArray(currentLeads) ? currentLeads : []).map((lead) => [String(lead?.id || "").trim(), lead])
  );
  const nextEmailOwners = buildLeadOwnerMap(nextLeads, "email");
  const nextPhoneOwners = buildLeadOwnerMap(nextLeads, "phone");
  const currentEmailOwners = buildLeadOwnerMap(currentLeads, "email");
  const currentPhoneOwners = buildLeadOwnerMap(currentLeads, "phone");

  for (const lead of Array.isArray(nextLeads) ? nextLeads : []) {
    const id = String(lead?.id || "").trim();
    if (!id) {
      continue;
    }

    const previousLead = currentById.get(id) || null;
    const email = normalizeLeadEmail(lead?.email);
    const phone = normalizeLeadPhone(lead?.phone);

    if (email) {
      const nextOwners = nextEmailOwners.get(email);
      if (nextOwners && nextOwners.size > 1) {
        if (isAllowedRegisteredLeadDuplicateGroup(nextLeads, nextOwners)) {
          continue;
        }
        const currentOwners = currentEmailOwners.get(email);
        const isUnchangedLegacyDuplicate = previousLead
          && normalizeLeadEmail(previousLead.email) === email
          && sameLeadOwnerSet(nextOwners, currentOwners);
        if (!isUnchangedLegacyDuplicate) {
          return { field: "email", value: email, lead };
        }
      }
    }

    if (phone) {
      const nextOwners = nextPhoneOwners.get(phone);
      if (nextOwners && nextOwners.size > 1) {
        if (isAllowedRegisteredLeadDuplicateGroup(nextLeads, nextOwners)) {
          continue;
        }
        const currentOwners = currentPhoneOwners.get(phone);
        const isUnchangedLegacyDuplicate = previousLead
          && normalizeLeadPhone(previousLead.phone) === phone
          && sameLeadOwnerSet(nextOwners, currentOwners);
        if (!isUnchangedLegacyDuplicate) {
          return { field: "phone", value: phone, lead };
        }
      }
    }
  }

  return null;
}

function findDuplicateLeadByEmailOrPhone(leads, incomingLead) {
  const incomingEmail = normalizeLeadEmail(incomingLead?.email);
  const incomingPhone = normalizeLeadPhone(incomingLead?.phone);
  return (Array.isArray(leads) ? leads : []).find((lead) => {
    const matchesEmail = incomingEmail && normalizeLeadEmail(lead?.email) === incomingEmail;
    const matchesPhone = incomingPhone && normalizeLeadPhone(lead?.phone) === incomingPhone;
    return matchesEmail || matchesPhone;
  }) || null;
}

function findDuplicateLeadByPhone(leads, incomingLead) {
  const incomingPhone = normalizeLeadPhone(incomingLead?.phone);
  if (!incomingPhone) {
    return null;
  }
  return (Array.isArray(leads) ? leads : []).find(
    (lead) => normalizeLeadPhone(lead?.phone) === incomingPhone
  ) || null;
}

function buildElementorSubmissionDuplicateKey(lead = {}) {
  const submittedDate = normalizeMetaLabel(lead?.elementorSubmittedDate);
  const submittedTime = normalizeMetaLabel(lead?.elementorSubmittedTime);
  if (!submittedDate && !submittedTime) {
    return "";
  }

  const formId = normalizeMetaLabel(lead?.elementorFormId);
  const formName = normalizeMetaLabel(lead?.elementorFormName);
  const pageUrl = normalizeMetaLabel(lead?.elementorPageUrl);
  const normalizedEmail = normalizeLeadEmail(lead?.email);
  const normalizedPhone = normalizeLeadPhone(lead?.phone);
  const courseToken = String(
    lead?.courseKey
    || buildCourseIdentity(lead?.courseRawName || lead?.courseName, lead)?.key
    || normalizeCourseSourceText(lead?.courseRawName || lead?.courseName || "")
  ).trim().toLowerCase();

  if ((!normalizedEmail && !normalizedPhone) || (!formId && !formName && !pageUrl)) {
    return "";
  }

  return [
    formId,
    formName,
    pageUrl,
    submittedDate,
    submittedTime,
    normalizedEmail,
    normalizedPhone,
    courseToken
  ].join("|");
}

function findDuplicateElementorLeadBySubmission(leads, incomingLead) {
  const incomingKey = buildElementorSubmissionDuplicateKey(incomingLead);
  if (!incomingKey) {
    return null;
  }

  return (Array.isArray(leads) ? leads : []).find((lead) => {
    if (!String(lead?.source || "").toLowerCase().includes("elementor")) {
      return false;
    }
    return buildElementorSubmissionDuplicateKey(lead) === incomingKey;
  }) || null;
}

function findDuplicateNonRegisteredLeadByEmailOrPhone(leads, incomingLead) {
  return (Array.isArray(leads) ? leads : []).find((lead) => {
    if (isPublicCourseRegistrationLead(lead)) {
      return false;
    }
    return !!findDuplicateLeadByEmailOrPhone([lead], incomingLead);
  }) || null;
}

function findDuplicateRegisteredLeadByEmailOrPhone(leads, incomingLead) {
  return (Array.isArray(leads) ? leads : []).find((lead) => {
    if (!isPublicCourseRegistrationLead(lead)) {
      return false;
    }
    return !!findDuplicateLeadByEmailOrPhone([lead], incomingLead);
  }) || null;
}

function findDuplicateRegisteredLeadByEmailOrPhoneInSegment(leads, incomingLead, segment = PUBLIC_COURSE_DEFAULT_SEGMENT) {
  const targetSegment = normalizePublicCourseSegment(segment);
  return (Array.isArray(leads) ? leads : []).find((lead) => {
    if (!isPublicCourseRegistrationLead(lead)) {
      return false;
    }
    const leadSegment = normalizePublicCourseSegment(lead?.publicCourseSegment || getPublicCourseSegment(lead));
    if (leadSegment !== targetSegment) {
      return false;
    }
    return !!findDuplicateLeadByEmailOrPhone([lead], incomingLead);
  }) || null;
}

async function replaceWorkshopLeadWithFreshLead(existingLead, incomingLead, options = {}) {
  const nextLead = buildFreshWorkshopLead(existingLead, incomingLead, options);
  const leadIdCandidates = getLeadIdCandidates(existingLead?.id);

  await withMongoRetry(
    () => leadsCollection.replaceOne(
      { id: { $in: leadIdCandidates } },
      nextLead,
      { upsert: false }
    ),
    { retries: 1, label: "Replace migrated workshop lead" }
  );

  await withMongoRetry(
    () => tasksCollection.deleteMany({ leadId: { $in: leadIdCandidates.map((value) => String(value)) } }),
    { retries: 1, label: "Remove migrated workshop lead tasks" }
  );

  await recordActivity({
    leadId: nextLead.id,
    leadName: nextLead.name,
    counselorName: nextLead.counselor || "",
    activityType: "Lead Re-entered",
    actionDescription: `Lead moved from ${String(existingLead?.workshop || "Unknown workshop").trim() || "Unknown workshop"} to ${String(nextLead.workshop || "Unknown workshop").trim() || "Unknown workshop"} and reset as a fresh workshop lead`,
    previousValue: String(existingLead?.workshop || "").trim() || "None",
    newValue: String(nextLead.workshop || "").trim() || "None"
  });

  if (options.metaLeadId) {
    await saveMetaLog({
      type: "updated",
      message: `Duplicate lead migrated to new workshop ${nextLead.workshop || "Unknown workshop"}`,
      leadgenId: options.metaLeadId,
      formId: options.formId,
      leadId: nextLead.id
    });
  }

  const now = new Date().toISOString();
  await stateCollection.updateOne(
    { _id: STATE_DOC_ID },
    { $set: { updatedAt: now } },
    { upsert: true }
  );

  cachedStateDoc = null;
  cachedStateDocAt = 0;

  return decorateLeadForStorage(nextLead);
}

async function getStateDoc() {
  // Return the in-memory cache only when it is still fresh.
  // This ensures that writes from other server instances (e.g. on Vercel) are picked up
  // within STATE_CACHE_TTL_MS without requiring a full process restart.
  if (cachedStateDoc && (Date.now() - cachedStateDocAt) < STATE_CACHE_TTL_MS) {
    return cachedStateDoc;
  }

  void ensureLeadStorageNormalization().catch(() => undefined);

  const globalMeta = await withMongoRetry(
    () => stateCollection.findOne({ _id: STATE_DOC_ID }),
    { retries: 1, label: "Load state metadata" }
  );

  const [leads, counselors, tasks, allocation] = await Promise.all([
    withMongoRetry(() => leadsCollection.find({}).toArray(), { retries: 1, label: "Load leads" }),
    withMongoRetry(() => counselorsCollection.find({}).toArray(), { retries: 1, label: "Load counselors" }),
    withMongoRetry(() => tasksCollection.find({}).toArray(), { retries: 1, label: "Load tasks" }),
    withMongoRetry(() => allocationCollection.find({}).toArray(), { retries: 1, label: "Load allocation" })
  ]);
  const decoratedLeads = decorateLeadListForStorage(leads || []);
  const assignmentMetadataMap = await getLeadAssignmentMetadataMap(decoratedLeads);
  const enrichedLeads = decoratedLeads.map((lead) => {
    const leadId = String(lead?.id || "").trim();
    const assignmentMetadata = assignmentMetadataMap.get(leadId) || null;
    const explicitOwnerType = String(lead?.leadOwnerType || "").trim().toLowerCase();
    const explicitSourceCounselor = String(lead?.assignedFromCounselor || "").trim();
    const explicitTimelineAt = String(lead?.leadOwnerTimelineAt || lead?.counselorAssignedAt || "").trim();
    const ownerType = explicitOwnerType || assignmentMetadata?.ownerType || "direct";
    const sourceCounselor = explicitSourceCounselor || assignmentMetadata?.sourceCounselor || "";
    const timelineAt = explicitTimelineAt || assignmentMetadata?.assignedAt || "";

    return {
      ...lead,
      leadOwnerType: ownerType === "reassigned" ? "reassigned" : "direct",
      assignedFromCounselor: sourceCounselor,
      leadOwnerTimelineAt: timelineAt
    };
  });

  if (globalMeta) {
    return cacheStateDoc({
      ...globalMeta,
      leads: enrichedLeads,
      counselors: counselors || [],
      tasks: tasks || [],
      allocation: allocation || []
    });
  }

  const initialMeta = {
    _id: STATE_DOC_ID,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    clearedAt: null
  };

  await withMongoRetry(
    () => stateCollection.insertOne(initialMeta),
    { retries: 1, label: "Create initial state metadata" }
  );

  return cacheStateDoc({
    ...initialMeta,
    leads: enrichedLeads,
    counselors: counselors || [],
    tasks: tasks || [],
    allocation: allocation || []
  });
}

async function requireSession(req, res) {
  const activeSession = await getSessionFromRequest(req);
  if (!activeSession?.session?.role) {
    res.status(401).json({ message: "No active session." });
    return null;
  }

  return activeSession.session;
}

async function requireRole(req, res, roles) {
  const session = await requireSession(req, res);
  if (!session) {
    return null;
  }

  const allowedRoles = Array.isArray(roles) ? roles : [roles];
  const sessionRole = String(session.role || "").trim().toLowerCase();
  const normalizedAllowed = allowedRoles.map((role) => String(role || "").trim().toLowerCase());
  const isAllowed = normalizedAllowed.includes(sessionRole)
    || (sessionRole === "super_admin" && normalizedAllowed.includes("admin"));

  if (!isAllowed) {
    res.status(403).json({ message: "Access required." });
    return null;
  }

  return session;
}

async function requireSuperAdmin(req, res) {
  const session = await requireSession(req, res);
  if (!session) {
    return null;
  }

  if (String(session.role || "").trim().toLowerCase() !== "super_admin") {
    res.status(403).json({ message: "Super admin access required." });
    return null;
  }

  return session;
}

function normalizePagePermissions(permissions = {}, fallback = FULL_PAGE_ACCESS) {
  return PAGE_ACCESS_KEYS.reduce((accumulator, key) => {
    const defaultValue = Boolean(fallback?.[key]);
    accumulator[key] = Object.prototype.hasOwnProperty.call(permissions || {}, key)
      ? Boolean(permissions[key])
      : defaultValue;
    return accumulator;
  }, {});
}

async function getAuthConfig() {
  const config = await preferenceCollection.findOne({
    ownerKey: AUTH_CONFIG_OWNER,
    scope: AUTH_CONFIG_SCOPE
  }).catch(() => null);

  return {
    superAdminPassword: String(config?.value?.superAdminPassword || ADMIN_USER.password || "").trim(),
    superAdminPasscode: String(config?.value?.superAdminPasscode || DEFAULT_SUPER_ADMIN_PASSCODE).trim()
  };
}

async function saveAuthConfig(config = {}) {
  const now = new Date().toISOString();
  await preferenceCollection.updateOne(
    { ownerKey: AUTH_CONFIG_OWNER, scope: AUTH_CONFIG_SCOPE },
    {
      $set: {
        value: {
          superAdminPassword: String(config.superAdminPassword || ADMIN_USER.password || "").trim(),
          superAdminPasscode: String(config.superAdminPasscode || DEFAULT_SUPER_ADMIN_PASSCODE).trim()
        },
        updatedAt: now
      },
      $setOnInsert: {
        ownerKey: AUTH_CONFIG_OWNER,
        scope: AUTH_CONFIG_SCOPE,
        createdAt: now
      }
    },
    { upsert: true }
  );
}

function normalizeReachoutBatchLead(entry = {}) {
  const rawEvents = entry?.events && typeof entry.events === "object" ? entry.events : {};
  return {
    leadId: String(entry.leadId || "").trim(),
    leadName: String(entry.leadName || "").trim(),
    phone: String(entry.phone || "").trim(),
    email: String(entry.email || "").trim().toLowerCase(),
    status: String(entry.status || "submitted").trim().toLowerCase(),
    submittedAt: String(entry.submittedAt || entry.sentAt || new Date().toISOString()).trim(),
    errorMessage: String(entry.errorMessage || entry.message || "").trim(),
    providerMessageId: String(entry.providerMessageId || "").trim(),
    lastEventStatus: String(entry.lastEventStatus || entry.status || "submitted").trim().toLowerCase(),
    lastEventAt: String(entry.lastEventAt || entry.submittedAt || entry.sentAt || new Date().toISOString()).trim(),
    replyText: String(entry.replyText || "").trim(),
    clickedLink: String(entry.clickedLink || "").trim(),
    failureReason: String(entry.failureReason || entry.errorMessage || entry.message || "").trim(),
    events: {
      delivered: rawEvents.delivered === true,
      read: rawEvents.read === true,
      clicked: rawEvents.clicked === true,
      replied: rawEvents.replied === true,
      opened: rawEvents.opened === true,
      failed: rawEvents.failed === true
    }
  };
}

function buildReachoutBatchReport(log = {}) {
  const leads = Array.isArray(log.leads) ? log.leads.map(normalizeReachoutBatchLead) : [];
  const submitted = Number(log.submitted) || leads.filter((lead) => lead.status !== "error").length;
  const failed = Number(log.failed) || leads.filter((lead) => lead.status === "error").length;
  return {
    audience: Number(log.audienceCount) || Number(log.attempted) || leads.length,
    submitted,
    failed,
    delivered: leads.filter((lead) => lead.events.delivered).length,
    read: leads.filter((lead) => lead.events.read).length,
    clicked: leads.filter((lead) => lead.events.clicked).length,
    replied: leads.filter((lead) => lead.events.replied).length,
    opened: leads.filter((lead) => lead.events.opened).length
  };
}

function getReachoutBatchLogType(report = {}) {
  if (Number(report.submitted || 0) > 0 && Number(report.failed || 0) > 0) return "partial";
  if (Number(report.submitted || 0) > 0) return "submitted";
  return "error";
}

function formatReachoutLogForClient(log = {}) {
  const leads = Array.isArray(log.leads)
    ? log.leads.map(normalizeReachoutBatchLead)
    : (log.leadId || log.leadName || log.phone || log.email ? [normalizeReachoutBatchLead({
      leadId: log.leadId,
      leadName: log.leadName,
      phone: log.phone,
      email: log.email,
      status: log.type === "error" ? "error" : "submitted",
      submittedAt: log.sentAt,
      errorMessage: log.message || "",
      lastEventStatus: log.type === "error" ? "failed" : "submitted",
      lastEventAt: log.sentAt,
      events: log.type === "error" ? { failed: true } : {}
    })] : []);
  const base = {
    id: String(log.id || log._id || crypto.randomUUID()),
    kind: String(log.kind || (Array.isArray(log.leads) ? "batch" : "legacy")).trim(),
    sentAt: String(log.sentAt || log.createdAt || new Date().toISOString()),
    type: String(log.type || "submitted").trim().toLowerCase(),
    channel: String(log.channel || "").trim().toLowerCase(),
    templateId: String(log.templateId || "").trim(),
    templateName: String(log.templateName || "").trim(),
    integratedNumber: String(log.integratedNumber || "").replace(/\D/g, ""),
    sentBy: String(log.sentBy || "").trim(),
    attempted: Number(log.attempted) || leads.length,
    submitted: Number(log.submitted) || leads.filter((lead) => lead.status !== "error").length,
    failed: Number(log.failed) || leads.filter((lead) => lead.status === "error").length,
    audienceCount: Number(log.audienceCount) || Number(log.attempted) || leads.length,
    message: String(log.message || "").trim(),
    leads
  };
  const report = buildReachoutBatchReport(base);
  return {
    ...base,
    type: getReachoutBatchLogType(report),
    report
  };
}

async function findReachoutBatchLogForEvent(lead = {}, normalizedEvent = {}) {
  const leadId = String(lead?.id || normalizedEvent?.leadId || "").trim();
  const templateName = String(normalizedEvent?.templateName || "").trim();
  const integratedNumber = String(normalizedEvent?.integratedNumber || "").replace(/\D/g, "");
  const providerMessageId = String(normalizedEvent?.providerMessageId || "").trim();
  const phone = String(normalizedEvent?.phone || lead?.phone || "").trim();
  const queries = [];

  if (providerMessageId) {
    queries.push({ kind: "batch", "leads.providerMessageId": providerMessageId });
  }
  if (leadId && templateName && integratedNumber) {
    queries.push({ kind: "batch", "leads.leadId": leadId, templateName, integratedNumber });
  }
  if (leadId && templateName) {
    queries.push({ kind: "batch", "leads.leadId": leadId, templateName });
  }
  if (leadId && integratedNumber) {
    queries.push({ kind: "batch", "leads.leadId": leadId, integratedNumber });
  }
  if (leadId) {
    queries.push({ kind: "batch", "leads.leadId": leadId });
  }
  if (phone && templateName) {
    queries.push({ kind: "batch", "leads.phone": phone, templateName });
  }

  for (const query of queries) {
    const log = await withMongoRetry(
      () => reachoutLogsCollection.findOne(query, { sort: { sentAt: -1 } }),
      { retries: 1, label: "Find ReachOut batch log" }
    );
    if (log) {
      return log;
    }
  }
  return null;
}

async function updateReachoutBatchLogForEvent(lead = {}, normalizedEvent = {}) {
  const existing = await findReachoutBatchLogForEvent(lead, normalizedEvent);
  if (!existing) {
    return null;
  }

  const leadIdCandidates = new Set(getLeadIdCandidates(lead.id).map((value) => String(value).trim()).filter(Boolean));
  const normalizedPhone = String(normalizedEvent.phone || lead.phone || "").trim();
  const normalizedEmail = String(normalizedEvent.leadEmail || lead.email || "").trim().toLowerCase();
  let changed = false;
  const nextLeads = (Array.isArray(existing.leads) ? existing.leads : []).map((entry) => {
    const current = normalizeReachoutBatchLead(entry);
    const sameLead =
      (current.providerMessageId && normalizedEvent.providerMessageId && current.providerMessageId === normalizedEvent.providerMessageId)
      || (current.leadId && leadIdCandidates.has(current.leadId))
      || (normalizedPhone && current.phone === normalizedPhone)
      || (normalizedEmail && current.email === normalizedEmail);
    if (!sameLead) {
      return current;
    }

    const next = {
      ...current,
      providerMessageId: current.providerMessageId || normalizedEvent.providerMessageId || "",
      lastEventStatus: String(normalizedEvent.status || current.lastEventStatus || current.status || "submitted").trim().toLowerCase(),
      lastEventAt: String(normalizedEvent.occurredAt || new Date().toISOString()).trim(),
      replyText: normalizedEvent.replyText || current.replyText,
      clickedLink: normalizedEvent.clickedLink || current.clickedLink,
      failureReason: normalizedEvent.failureReason || current.failureReason,
      events: { ...current.events }
    };

    switch (next.lastEventStatus) {
      case "delivered":
        next.events.delivered = true;
        break;
      case "read":
        next.events.delivered = true;
        next.events.read = true;
        break;
      case "opened":
        next.events.opened = true;
        break;
      case "clicked":
        next.events.clicked = true;
        break;
      case "replied":
        next.events.replied = true;
        break;
      case "failed":
        next.events.failed = true;
        if (next.status !== "error") {
          next.status = "error";
        }
        break;
      default:
        break;
    }

    if (JSON.stringify(next) !== JSON.stringify(current)) {
      changed = true;
    }
    return next;
  });

  if (!changed) {
    return existing;
  }

  const submitted = nextLeads.filter((item) => item.status !== "error").length;
  const failed = nextLeads.filter((item) => item.status === "error").length;
  const nextReport = buildReachoutBatchReport({
    attempted: Number(existing.attempted) || nextLeads.length,
    audienceCount: Number(existing.audienceCount) || nextLeads.length,
    submitted,
    failed,
    leads: nextLeads
  });

  await withMongoRetry(
    () => reachoutLogsCollection.updateOne(
      { _id: existing._id },
      {
        $set: {
          leads: nextLeads,
          submitted,
          failed,
          audienceCount: Number(existing.audienceCount) || nextLeads.length,
          attempted: Number(existing.attempted) || nextLeads.length,
          type: getReachoutBatchLogType(nextReport),
          report: nextReport,
          updatedAt: new Date().toISOString()
        }
      }
    ),
    { retries: 1, label: "Update ReachOut batch log" }
  );

  return { ...existing, leads: nextLeads, report: nextReport };
}

function canManageRoles(session) {
  return session?.role === "super_admin";
}

function getSessionPagePermissions(session = {}) {
  const role = String(session.role || "").trim().toLowerCase();
  if (role === "super_admin") {
    return normalizePagePermissions(FULL_PAGE_ACCESS, FULL_PAGE_ACCESS);
  }
  if (role === "admin") {
    return normalizePagePermissions(session.permissions || {}, ADMIN_DEFAULT_PAGE_ACCESS);
  }
  if (role === "marketing") {
    return normalizePagePermissions(session.permissions || {}, MARKETING_DEFAULT_PAGE_ACCESS);
  }
  if (role === "counselor") {
    return normalizePagePermissions(session.permissions || {}, COUNSELOR_DEFAULT_PAGE_ACCESS);
  }
  return normalizePagePermissions({}, {});
}

function getLeadIdCandidates(leadId) {
  const raw = String(leadId || "").trim();
  const candidates = [raw];
  const numeric = Number(raw);
  if (raw && Number.isFinite(numeric)) {
    candidates.push(numeric);
  }

  return [...new Set(candidates)];
}

function buildLeadIdentityMatchConditions(leadRefs) {
  return leadRefs
    .map((ref) => {
      const id = String(ref?.id || "").trim();
      if (!id) {
        return null;
      }

      const condition = {
        "lead.id": { $in: getLeadIdCandidates(id) }
      };
      const email = String(ref?.email || "").trim().toLowerCase();
      const phone = String(ref?.phone || "").trim();
      const workshop = String(ref?.workshop || "").trim();
      const createdAt = String(ref?.createdAt || "").trim();

      if (email) {
        condition["lead.email"] = email;
      }
      if (phone) {
        condition["lead.phone"] = phone;
      }
      if (workshop) {
        condition["lead.workshop"] = workshop;
      }
      if (createdAt) {
        condition["lead.createdAt"] = createdAt;
      }

      return condition;
    })
    .filter(Boolean);
}

function buildLiveLeadIdentityMatchConditions(leadRefs) {
  return leadRefs
    .map((ref) => {
      const id = String(ref?.id || "").trim();
      if (!id) {
        return null;
      }

      const condition = { id: { $in: getLeadIdCandidates(id) } };
      const email = String(ref?.email || "").trim().toLowerCase();
      const phone = String(ref?.phone || "").trim();
      const workshop = String(ref?.workshop || "").trim();
      const createdAt = String(ref?.createdAt || "").trim();

      if (email) condition.email = email;
      if (phone) condition.phone = phone;
      if (workshop) condition.workshop = workshop;
      if (createdAt) condition.createdAt = createdAt;

      return condition;
    })
    .filter(Boolean);
}

function buildLiveLeadIdQuery(leadRefs = [], leadIds = []) {
  const ids = [
    ...(Array.isArray(leadIds) ? leadIds : []),
    ...(Array.isArray(leadRefs) ? leadRefs.map((ref) => ref?.id) : [])
  ]
    .flatMap((leadId) => getLeadIdCandidates(leadId))
    .filter((leadId) => String(leadId || "").trim());

  return ids.length ? { id: { $in: [...new Set(ids)] } } : null;
}

function findLeadById(state, leadId) {
  const candidates = new Set(getLeadIdCandidates(leadId).map((value) => String(value)));
  return (Array.isArray(state?.leads) ? state.leads : []).find(
    (lead) => candidates.has(String(lead?.id))
  ) || null;
}

function findLeadByIdentity(state, leadId, leadEmail = "") {
  const leads = Array.isArray(state?.leads) ? state.leads : [];
  const candidates = new Set(getLeadIdCandidates(leadId).map((value) => String(value)));
  const email = String(leadEmail || "").trim().toLowerCase();

  if (email) {
    const match = leads.find(
      (lead) => candidates.has(String(lead?.id)) &&
        String(lead?.email || "").trim().toLowerCase() === email
    );
    if (match) {
      return match;
    }
  }

  return leads.find((lead) => candidates.has(String(lead?.id))) || null;
}

function getSessionCounselorName(state, session) {
  if (session?.role !== "counselor") {
    return "";
  }

  const sessionEmail = String(session?.email || "").trim().toLowerCase();
  const sessionName = String(session?.name || "").trim();
  const counselors = Array.isArray(state?.counselors) ? state.counselors : [];
  const match = counselors.find(
    (item) => String(item.email || "").trim().toLowerCase() === sessionEmail
  );

  return String(match?.name || sessionName || "").trim();
}

function getLeadMutationRestrictionMessage(session, state, lead) {
  if (session?.role === "admin") {
    return "";
  }

  if (session?.role !== "counselor") {
    return "Only the assigned counselor can update this lead.";
  }

  const counselorName = getSessionCounselorName(state, session).toLowerCase();
  const leadCounselor = String(lead?.counselor || "").trim().toLowerCase();
  if (!counselorName || leadCounselor !== counselorName) {
    return "Only the assigned counselor can update this lead.";
  }

  const sopState = deriveAdmissionSopState(lead);
  if (sopState?.blocked) {
    return "This admission lead is blocked by the SOP timer and must be reassigned by an admin before further edits.";
  }

  return "";
}

function canMutateLead(session, state, lead) {
  return !getLeadMutationRestrictionMessage(session, state, lead);
}

function canViewLeadActivity(session, state, lead) {
  if (session?.role === "admin") {
    return true;
  }
  if (session?.role === "counselor") {
    const counselorName = getSessionCounselorName(state, session).toLowerCase();
    const leadCounselor = String(lead?.counselor || "").trim().toLowerCase();
    return !!counselorName && leadCounselor === counselorName;
  }
  return false;
}

function getLeadAssignmentResetPatch(lead, counselor, assignedAt) {
  const previousCounselor = String(lead?.counselor || "").trim();
  const hasPreviousCounselor = previousCounselor && previousCounselor.toLowerCase() !== "unassigned";
  const patch = {
    counselor,
    counselorAssignedAt: assignedAt,
    assignedFromCounselor: hasPreviousCounselor ? previousCounselor : "",
    leadOwnerType: hasPreviousCounselor ? "reassigned" : "direct",
    leadOwnerTimelineAt: assignedAt,
    workshopActivityTouchedByAssignee: false,
    admissionActivityTouchedByAssignee: false,
    registeredActivityTouchedByAssignee: false,
    mainAdmissionActivityTouchedByAssignee: false
  };

  if (!isAdmissionSopScopedLead(lead)) {
    return patch;
  }

  patch.admissionSopAssignedAt = assignedAt;
  const trackingConfig = getAdmissionSopTrackingConfig(lead);
  const hasProgress = Boolean(getAdmissionSopAnchorAt(lead, trackingConfig));
  patch.admissionSopLastProgressAt = hasProgress ? assignedAt : null;
  return patch;
}

const PROTECTED_ASSIGNMENT_ADMISSION_STATUSES = new Set(["inconversation", "enrolled", "won"]);
const PROTECTED_ASSIGNMENT_WORKSHOP_STATUSES = new Set(["interested"]);

function normalizeAssignmentAdmissionStatus(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeAssignmentWorkshopStatus(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function getLeadBulkAssignmentSkipReason(lead) {
  const hasProtectedWorkshopStatus = [
    lead?.courseStatus,
    lead?.wsStatus
  ].some((status) => PROTECTED_ASSIGNMENT_WORKSHOP_STATUSES.has(normalizeAssignmentWorkshopStatus(status)));
  if (hasProtectedWorkshopStatus) {
    return "workshopInterested";
  }

  const hasProtectedAdmissionStatus = [
    lead?.admissionStatus,
    lead?.registeredAdmissionStatus,
    lead?.mainAdmissionAdmissionStatus
  ].some((status) => PROTECTED_ASSIGNMENT_ADMISSION_STATUSES.has(normalizeAssignmentAdmissionStatus(status)));
  if (hasProtectedAdmissionStatus) {
    return "admissionProtected";
  }

  return null;
}

function isLeadProtectedFromBulkAssignment(lead) {
  return Boolean(getLeadBulkAssignmentSkipReason(lead));
}

function getLeadActivityAssigneePatch(stage, session) {
  if (session?.role !== "counselor") {
    return {};
  }

  if (stage === "workshop") {
    return { workshopActivityTouchedByAssignee: true };
  }
  if (stage === "admission") {
    return { admissionActivityTouchedByAssignee: true };
  }
  if (stage === "registered-course") {
    return { registeredActivityTouchedByAssignee: true };
  }
  if (stage === "main-admission") {
    return { mainAdmissionActivityTouchedByAssignee: true };
  }
  return {};
}

async function recordActivity({
  leadId,
  leadName,
  counselorName,
  activityType,
  actionDescription,
  previousValue = null,
  newValue = null,
  session = null,
  remarks = null,
  callMetadata = null
}) {
  try {
    if (!activityLogsCollection) {
      console.warn("activityLogsCollection not initialized yet.");
      return;
    }
    const now = new Date();
    const userRole = session ? session.role : "system";
    const performedBy = session ? (session.name || session.email || session.role) : "System";
    
    // YYYY-MM-DD
    const dateStr = now.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).split('/').reverse().join('-');
    // HH:MM:SS AM/PM
    const timeStr = now.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour12: true, hour: "2-digit", minute: "2-digit", second: "2-digit" });

    const logEntry = {
      activityType,
      leadId: String(leadId),
      leadName: String(leadName || ""),
      counselorName: String(counselorName || ""),
      performedBy,
      userRole,
      actionDescription,
      previousValue: previousValue !== null ? String(previousValue) : null,
      newValue: newValue !== null ? String(newValue) : null,
      timestamp: now,
      date: dateStr,
      time: timeStr,
      remarks: remarks ? String(remarks) : null,
      callMetadata: callMetadata && typeof callMetadata === "object" ? callMetadata : null,
      recordingUrl: callMetadata?.recordingUrl ? String(callMetadata.recordingUrl) : ""
    };

    await activityLogsCollection.insertOne(logEntry);
  } catch (error) {
    console.error("Failed to record activity log:", error);
  }
}

function buildActivityLogEntry({
  leadId,
  leadName,
  counselorName,
  activityType,
  actionDescription,
  previousValue = null,
  newValue = null,
  session = null,
  remarks = null,
  callMetadata = null
}) {
  const now = new Date();
  const userRole = session ? session.role : "system";
  const performedBy = session ? (session.name || session.email || session.role) : "System";
  const dateStr = now.toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).split('/').reverse().join('-');
  const timeStr = now.toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour12: true,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

  return {
    activityType,
    leadId: String(leadId),
    leadName: String(leadName || ""),
    counselorName: String(counselorName || ""),
    performedBy,
    userRole,
    actionDescription,
    previousValue: previousValue !== null ? String(previousValue) : null,
    newValue: newValue !== null ? String(newValue) : null,
    timestamp: now,
    date: dateStr,
    time: timeStr,
    remarks: remarks ? String(remarks) : null,
    callMetadata: callMetadata && typeof callMetadata === "object" ? callMetadata : null,
    recordingUrl: callMetadata?.recordingUrl ? String(callMetadata.recordingUrl) : ""
  };
}

async function recordActivities(entries = []) {
  try {
    if (!activityLogsCollection || !Array.isArray(entries) || !entries.length) {
      return;
    }
    await activityLogsCollection.insertMany(entries.map((entry) => buildActivityLogEntry(entry)), { ordered: false });
  } catch (error) {
    console.error("Failed to record bulk activity logs:", error);
  }
}

async function logBulkLeadChanges(oldLeads, newLeads, session) {
  try {
    const oldLeadsMap = new Map();
    const activityEntries = [];
    oldLeads.forEach(lead => {
      if (lead && lead.id) oldLeadsMap.set(String(lead.id), lead);
    });
    
    for (const lead of newLeads) {
      if (!lead || !lead.id) continue;
      const leadIdStr = String(lead.id);
      const oldLead = oldLeadsMap.get(leadIdStr);
      
      if (!oldLead) {
        // Lead Created
        activityEntries.push({
          leadId: lead.id,
          leadName: lead.name,
          counselorName: lead.counselor || "",
          activityType: "Lead Created",
          actionDescription: `Lead imported/created in bulk`,
          newValue: `Name: ${lead.name}, Phone: ${lead.phone}, Email: ${lead.email}`,
          session
        });
        if (lead.counselor) {
          activityEntries.push({
            leadId: lead.id,
            leadName: lead.name,
            counselorName: lead.counselor,
            activityType: "Lead Assigned",
            actionDescription: `Lead initially assigned to counselor ${lead.counselor}`,
            newValue: lead.counselor,
            session
          });
        }
      } else {
        // Check if counselor changed
        const oldCounselor = String(oldLead.counselor || "").trim();
        const newCounselor = String(lead.counselor || "").trim();
        if (oldCounselor !== newCounselor) {
          if (!oldCounselor && newCounselor) {
            activityEntries.push({
              leadId: lead.id,
              leadName: lead.name,
              counselorName: newCounselor,
              activityType: "Lead Assigned",
              actionDescription: `Lead assigned to counselor ${newCounselor}`,
              newValue: newCounselor,
              session
            });
          } else {
            activityEntries.push({
              leadId: lead.id,
              leadName: lead.name,
              counselorName: newCounselor,
              activityType: "Counselor Changed",
              actionDescription: `Lead counselor reassigned from ${oldCounselor || "Unassigned"} to ${newCounselor || "Unassigned"}`,
              previousValue: oldCounselor || "Unassigned",
              newValue: newCounselor || "Unassigned",
              session
            });
          }
        }
        
        // Check status fields
        const statusFields = [
          { key: "callStatus", label: "Workshop Call Status" },
          { key: "wsStatus", label: "Workshop Status" },
          { key: "postCallStatus", label: "Admission Call Status" },
          { key: "admissionStatus", label: "Admission Status" },
          { key: "registeredCallStatus", label: "Registered Candidate Call Status" }
        ];
        for (const field of statusFields) {
          const oldVal = String(oldLead[field.key] || "").trim();
          const newVal = String(lead[field.key] || "").trim();
          if (oldVal !== newVal) {
            activityEntries.push({
              leadId: lead.id,
              leadName: lead.name,
              counselorName: newCounselor || lead.counselor || "",
              activityType: "Status Changed",
              actionDescription: `${field.label} changed from ${oldVal || "None"} to ${newVal || "None"}`,
              previousValue: oldVal || "None",
              newValue: newVal || "None",
              session
            });
          }
        }
      }
    }

    await recordActivities(activityEntries);
  } catch (error) {
    console.error("Error in logBulkLeadChanges:", error);
  }
}

function sanitizeLeadPatch(updates = {}, allowedFields = []) {
  const patch = {};
  allowedFields.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(updates, field)) {
      patch[field] = updates[field];
    }
  });
  return patch;
}

function isReplaceableLeadContactValue(field, value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  if (field === "name") {
    return /^mcube\s+(caller|lead)(\s+\S+)?$/i.test(String(value ?? "").trim());
  }

  if (field === "email") {
    return /^mcube-[^@\s]+@noemail\.lead$/i.test(normalized);
  }

  return false;
}

function sanitizeFillMissingContactPatch(lead = {}, updates = {}) {
  const patch = {};
  ["name", "email", "phone"].forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(updates, field)) {
      return;
    }

    const nextValue = String(updates[field] ?? "").trim();
    if (!nextValue || !isReplaceableLeadContactValue(field, lead[field])) {
      return;
    }

    patch[field] = field === "email" ? nextValue.toLowerCase() : nextValue;
  });
  return patch;
}

const MAIN_ADMISSION_DETAIL_FIELDS = new Set(["name", "email", "phone", "courseName"]);

function getLeadExtraFieldBucketName(lead = {}) {
  if (lead.metaExtraFields && typeof lead.metaExtraFields === "object") {
    return "metaExtraFields";
  }
  if (lead.elementorExtraFields && typeof lead.elementorExtraFields === "object") {
    return "elementorExtraFields";
  }
  return String(lead.source || "").trim().toLowerCase().includes("elementor")
    ? "elementorExtraFields"
    : "metaExtraFields";
}

function sanitizeMainAdmissionDetailsPatch(lead = {}, body = {}) {
  const fields = body?.fields && typeof body.fields === "object" ? body.fields : {};
  const extraFields = body?.extraFields && typeof body.extraFields === "object" ? body.extraFields : {};
  const setPatch = {};
  const contactPatch = sanitizeFillMissingContactPatch(lead, fields);

  Object.entries(fields).forEach(([field, value]) => {
    if (!MAIN_ADMISSION_DETAIL_FIELDS.has(field)) {
      return;
    }

    if (["name", "email", "phone"].includes(field)) {
      return;
    }

    const nextValue = String(value ?? "").trim();
    setPatch[field] = field === "email" ? nextValue.toLowerCase() : nextValue;
  });

  Object.assign(setPatch, contactPatch);

  const extraBucket = getLeadExtraFieldBucketName(lead);
  Object.entries(extraFields).forEach(([field, value]) => {
    const key = String(field || "").trim();
    if (!key || key.includes(".") || key.startsWith("$")) {
      return;
    }
    setPatch[`${extraBucket}.${key}`] = String(value ?? "").trim();
  });

  return setPatch;
}

function createTaskId() {
  return `task-${crypto.randomUUID()}`;
}

function parseTaskDueDateValue(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const parsedDateOnly = new Date(`${raw}T09:00:00+05:30`);
    return Number.isNaN(parsedDateOnly.getTime()) ? null : parsedDateOnly;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeTaskDueDateValue(value) {
  const parsed = parseTaskDueDateValue(value);
  return parsed ? parsed.toISOString() : String(value || "").trim();
}

function normalizeTaskDoc(task = {}) {
  const createdAt = task.createdAt || new Date().toISOString();
  const category = task.category === "admission"
    ? "admission"
    : task.category === "registered"
      ? "registered"
      : task.category === "main-admission"
        ? "main-admission"
        : "workshop";

  return {
    id: String(task.id || createTaskId()),
    leadId: String(task.leadId || ""),
    leadName: String(task.leadName || "").trim(),
    leadPhone: String(task.leadPhone || "").trim(),
    leadCounselor: String(task.leadCounselor || "").trim(),
    counselor: String(task.counselor || "").trim(),
    category,
    title: String(task.title || "Follow up").trim(),
    notes: String(task.notes || "").trim(),
    dueDate: normalizeTaskDueDateValue(task.dueDate),
    createdAt,
    updatedAt: task.updatedAt || createdAt,
    reminderSentAt: task.reminderSentAt || null
  };
}

function getTaskCategoryLabel(category) {
  if (category === "admission") return "Admission Calling";
  if (category === "registered") return "Registered Candidates";
  if (category === "main-admission") return "Main Admission Leads";
  return "Workshop Calling";
}

async function createDueTaskNotificationsForSession(session, state) {
  if (!session || session.role !== "counselor") {
    return;
  }

  const counselorName = String(getSessionCounselorName(state, session) || session.name || "").trim().toLowerCase();
  const counselorEmail = String(session.email || "").trim().toLowerCase();
  if (!counselorName || !counselorEmail) {
    return;
  }

  const now = Date.now();
  const dueTasks = (Array.isArray(state?.tasks) ? state.tasks : []).filter((task) => {
    const taskCounselor = String(task?.leadCounselor || task?.counselor || "").trim().toLowerCase();
    if (taskCounselor !== counselorName) {
      return false;
    }
    if (task?.reminderSentAt) {
      return false;
    }

    const dueAt = parseTaskDueDateValue(task?.dueDate);
    return !!dueAt && dueAt.getTime() <= now;
  });

  for (const task of dueTasks) {
    const reminderSentAt = new Date().toISOString();
    const updateResult = await tasksCollection.updateOne(
      {
        id: task.id,
        $or: [
          { reminderSentAt: null },
          { reminderSentAt: "" },
          { reminderSentAt: { $exists: false } }
        ]
      },
      { $set: { reminderSentAt, updatedAt: reminderSentAt } }
    );

    if (!updateResult.modifiedCount) {
      continue;
    }

    await createNotification({
      userId: counselorEmail,
      role: "counselor",
      type: "task_due",
      title: "Task Due Now",
      message: `${task.title || "Follow up"} is due for ${task.leadName || "this lead"}.`,
      sound: true,
      leadId: task.leadId,
      leadName: task.leadName,
      assignedCounselor: task.leadCounselor || task.counselor || "",
      taskId: task.id,
      taskTitle: task.title || "Follow up",
      taskNotes: task.notes || "",
      taskDueDate: task.dueDate || "",
      taskCategory: getTaskCategoryLabel(task.category)
    });
  }
}

function findTaskById(state, taskId) {
  const id = String(taskId || "").trim();
  return (Array.isArray(state?.tasks) ? state.tasks : []).find(
    (task) => String(task?.id || "") === id
  ) || null;
}

function canMutateTask(session, state, task) {
  if (session?.role === "admin") {
    return true;
  }

  if (session?.role !== "counselor") {
    return false;
  }

  const counselorName = getSessionCounselorName(state, session).toLowerCase();
  const leadCounselor = String(task?.leadCounselor || "").trim().toLowerCase();
  const taskCounselor = String(task?.counselor || "").trim().toLowerCase();
  return !!counselorName && (leadCounselor === counselorName || taskCounselor === counselorName);
}

function buildLeadArrayFilter(leadId, leadEmail = "") {
  const filter = { "lead.id": { $in: getLeadIdCandidates(leadId) } };
  const email = String(leadEmail || "").trim().toLowerCase();
  if (email) {
    filter["lead.email"] = email;
  }
  return filter;
}

function buildLeadSetPatch(leadId, updates = {}, leadEmail = "") {
  const setPatch = { updatedAt: new Date().toISOString() };
  Object.entries(updates).forEach(([field, value]) => {
    setPatch[`leads.$[lead].${field}`] = value;
  });
  return {
    update: { $set: setPatch },
    options: { arrayFilters: [buildLeadArrayFilter(leadId, leadEmail)] }
  };
}

async function refreshStateAfterAtomicUpdate() {
  cachedStateDoc = null;
  cachedStateDocAt = 0;
  return getStateDoc();
}

async function loadFreshLeadsForDuplicateReview() {
  const leads = await withMongoRetry(
    () => leadsCollection.find({}).toArray(),
    { retries: 1, label: "Load fresh leads for duplicate review" }
  );
  return decorateLeadListForStorage(leads || []);
}

app.post("/api/auth/login", async (req, res) => {
  try {
    const role = String(req.body?.role || "").trim().toLowerCase();
    const identifier = String(req.body?.identifier || "").trim();
    const password = String(req.body?.password || "").trim();
    const passcode = String(req.body?.passcode || "").trim();

    if (!role || !identifier || !password) {
      return res.status(400).json({ message: "Role, identifier, and password are required." });
    }

    if (role === "admin") {
      const state = await getStateDoc();
      const authConfig = await getAuthConfig();

      if (identifier === ADMIN_USER.id && password === authConfig.superAdminPassword) {
        if (!passcode) {
          return res.status(428).json({
            message: "Passcode is required.",
            requiresPasscode: true
          });
        }
        if (passcode !== authConfig.superAdminPasscode) {
          return res.status(401).json({ message: "Invalid passcode.", requiresPasscode: true });
        }

        const session = await persistSession(res, {
          role: "super_admin",
          name: ADMIN_USER.name,
          email: ADMIN_USER.id,
          permissions: FULL_PAGE_ACCESS
        });

        return res.json({
          session,
          landing: "dashboard.html"
        });
      }

      const adminUsers = Array.isArray(state.adminUsers) ? state.adminUsers : [];
      const normalizedIdentifier = identifier.toLowerCase();
      const adminUser = adminUsers.find((item) => {
        const phone = String(item.phone || "").trim().toLowerCase();
        const email = String(item.email || "").trim().toLowerCase();
        return String(item.password || "") === password
          && (phone === normalizedIdentifier || email === normalizedIdentifier);
      });

      if (!adminUser) {
        return res.status(401).json({ message: "Invalid credentials for selected role." });
      }

      const session = await persistSession(res, {
        role: "admin",
        name: adminUser.name,
        email: adminUser.email || `admin:${String(adminUser.phone || "").trim()}`,
        phone: adminUser.phone || "",
        permissions: normalizePagePermissions(adminUser.permissions || {}, ADMIN_DEFAULT_PAGE_ACCESS)
      });

      return res.json({
        session,
        landing: "dashboard.html"
      });
    }

    if (role === "marketing") {
      const state = await getStateDoc();
      const marketingUsers = Array.isArray(state.marketingUsers) ? state.marketingUsers : [];
      const email = identifier.toLowerCase();
      const marketingUser = marketingUsers.find(
        (item) => String(item.email || "").trim().toLowerCase() === email && String(item.password || "") === password
      );

      if (!marketingUser) {
        if (!marketingUsers.length) {
          return res.status(404).json({
            message: "Marketing credentials are not available. Make sure marketing user records exist in the shared database."
          });
        }
        return res.status(401).json({ message: "Invalid credentials for selected role." });
      }

      const session = await persistSession(res, {
        role,
        name: marketingUser.name,
        email: marketingUser.email,
        phone: marketingUser.phone || "",
        permissions: normalizePagePermissions(marketingUser.permissions || {}, MARKETING_DEFAULT_PAGE_ACCESS)
      });

      return res.json({ session, landing: "dashboard.html" });
    }

    if (role !== "counselor") {
      return res.status(400).json({ message: "Unsupported role." });
    }

    const state = await getStateDoc();
    const counselors = Array.isArray(state.counselors) ? state.counselors : [];
    const email = identifier.toLowerCase();
    const counselor = counselors.find(
      (item) => String(item.email || "").trim().toLowerCase() === email && String(item.password || "") === password
    );

    if (!counselor) {
      if (!counselors.length) {
        return res.status(404).json({
          message: "Counselor credentials are not available on this deployment. Check Vercel MONGODB_URI and make sure counselor records exist in the shared database."
        });
      }

      return res.status(401).json({ message: "Invalid credentials for selected role." });
    }

    const permissions = {
      ...COUNSELOR_DEFAULT_PAGE_ACCESS,
      ...(counselor.permissions || {})
    };

    const session = await persistSession(res, {
      role,
      name: counselor.name,
      email: counselor.email,
      phone: counselor.phone || "",
      permissions
    });

    const landing = permissions.preWorkshop
      ? "pre-workshop.html"
      : permissions.postWorkshop
        ? "post-workshop.html"
        : permissions.lostLeads
          ? "lost-leads.html"
          : permissions.monitoring
            ? "monitoring.html"
            : "index.html";

    return res.json({ session, landing });
  } catch (error) {
    return res.status(500).json({ message: "Login failed", details: error.message });
  }
});

app.get("/api/auth/session", async (req, res) => {
  try {
    const activeSession = await getSessionFromRequest(req);
    if (!activeSession) {
      return res.status(401).json({ message: "No active session." });
    }

    return res.json(activeSession.session);
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch session", details: error.message });
  }
});

app.post("/api/auth/logout", async (req, res) => {
  try {
    const cookies = parseCookies(req.headers.cookie || "");
    const token = String(cookies[SESSION_COOKIE_NAME] || "").trim();
    if (token) {
      evictCachedSession(token);
      await sessionCollection.deleteOne({ token });
    }

    res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ message: "Logout failed", details: error.message });
  }
});

app.get("/api/admin/lsq-archive", async (req, res) => {
  try {
    const session = await requireSuperAdmin(req, res);
    if (!session) return;

    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const rows = await lsqArchiveCollection.find({}).limit(limit).toArray();
    return res.json({ ok: true, rows: normalizeArchivedLeadDocs(rows) });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch LSQ archive leads", details: error.message });
  }
});

app.delete("/api/admin/lsq-archive", async (req, res) => {
  try {
    const session = await requireSuperAdmin(req, res);
    if (!session) return;

    const sourceFileName = normalizeLsqValue(req.query?.sourceFileName);
    const query = sourceFileName ? { sourceFileName } : {};
    const result = await lsqArchiveCollection.deleteMany(query);
    return res.json({
      ok: true,
      deletedCount: Number(result?.deletedCount) || 0,
      sourceFileName: sourceFileName || ""
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to delete LSQ archive leads", details: error.message });
  }
});

app.get("/api/lost-leads/archive", async (req, res) => {
  try {
    const session = await requireSession(req, res);
    if (!session) return;

    const syncResult = await syncStaleLostLeadsToArchive();
    const limit = Math.min(Math.max(Number(req.query.limit) || 500, 1), 2000);
    const rows = await lsqArchiveCollection.find({}).limit(limit).toArray();
    const response = {
      ok: true,
      movedCount: Number(syncResult?.movedCount) || 0,
      rows: normalizeArchivedLeadDocs(rows)
    };

    if (syncResult?.state) {
      res.setHeader("ETag", buildStateEtag(syncResult.state));
      response.state = buildStateResponse(syncResult.state);
    }

    return res.json(response);
  } catch (error) {
    return res.status(500).json({ message: "Failed to load archived leads", details: error.message });
  }
});

app.delete("/api/lost-leads/archive/:archiveId", async (req, res) => {
  try {
    const session = await requireSuperAdmin(req, res);
    if (!session) return;

    const archiveId = String(req.params.archiveId || "").trim();
    if (!archiveId) {
      return res.status(400).json({ message: "Archive id is required." });
    }

    const result = await lsqArchiveCollection.deleteOne({ _id: archiveId });
    return res.json({
      ok: true,
      deletedCount: Number(result?.deletedCount) || 0
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to delete archived lead", details: error.message });
  }
});

app.delete("/api/lost-leads/:leadId", async (req, res) => {
  try {
    const session = await requireSuperAdmin(req, res);
    if (!session) return;

    const leadId = String(req.params.leadId || "").trim();
    if (!leadId) {
      return res.status(400).json({ message: "Lead id is required." });
    }

    const result = await leadsCollection.deleteOne({ id: leadId });
    await touchStateUpdatedAt();
    const nextState = await refreshStateAfterAtomicUpdate();
    res.setHeader("ETag", buildStateEtag(nextState));
    return res.json({
      ok: true,
      deletedCount: Number(result?.deletedCount) || 0,
      state: buildStateResponse(nextState)
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to delete lost lead", details: error.message });
  }
});

app.delete("/api/admin/lsq-leads", async (req, res) => {
  try {
    const session = await requireSuperAdmin(req, res);
    if (!session) return;

    const sourceFileName = normalizeLsqValue(req.query?.sourceFileName);
    const query = sourceFileName
      ? {
          lsqImported: true,
          $or: [
            { importSourceFiles: sourceFileName },
            { importSourceFile: sourceFileName },
            { "lsqSourceSnapshot.sourceFileName": sourceFileName }
          ]
        }
      : { lsqImported: true };

    const result = await leadsCollection.deleteMany(query);
    await touchStateUpdatedAt();
    const nextState = await refreshStateAfterAtomicUpdate();
    res.setHeader("ETag", buildStateEtag(nextState));
    return res.json({
      ok: true,
      deletedCount: Number(result?.deletedCount) || 0,
      sourceFileName: sourceFileName || "",
      state: buildStateResponse(nextState)
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to delete LSQ leads", details: error.message });
  }
});

app.post("/api/admin/lsq-import", async (req, res) => {
  try {
    const session = await requireSuperAdmin(req, res);
    if (!session) return;

    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const sourceFileName = normalizeLsqValue(req.body?.sourceFileName);
    if (!rows.length) {
      return res.status(400).json({ message: "LSQ import rows are required." });
    }
    const counselorFilter = normalizeLsqValue(req.body?.counselorFilter || "all").toLowerCase() || "all";
    const stageFilter = normalizeLsqValue(req.body?.stageFilter || "all").toLowerCase() || "all";

    const state = await getStateDoc();
    const dedupedRecords = new Map();

    rows.forEach((row) => {
      if (!row || typeof row !== "object") {
        return;
      }
      const record = buildLsqNormalizedRecord(row, sourceFileName);
      const dedupeKey = record.email || record.phone || record.sourceSnapshot?.leadNumber || record.sourceSnapshot?.prospectId;
      if (!dedupeKey) {
        return;
      }

      const previous = dedupedRecords.get(dedupeKey);
      const previousTime = Date.parse(previous?.updatedAt || "") || 0;
      const nextTime = Date.parse(record.updatedAt || "") || 0;
      if (!previous || nextTime >= previousTime) {
        dedupedRecords.set(dedupeKey, record);
      }
    });

    const summary = {
      scanned: rows.length,
      deduped: dedupedRecords.size,
      updated: 0,
      created: 0,
      archived: 0,
      skippedByCounselorFilter: 0,
      skippedByStageFilter: 0,
      byReason: {}
    };
    const archivedDocs = [];

    for (const record of dedupedRecords.values()) {
      if (!recordMatchesLsqCounselorFilter(record, counselorFilter)) {
        summary.skippedByCounselorFilter += 1;
        continue;
      }
      if (!recordMatchesLsqStageFilter(record, stageFilter)) {
        summary.skippedByStageFilter += 1;
        continue;
      }

      const existingLead = findDuplicateLeadByEmailOrPhone(state.leads, {
        email: record.email,
        phone: record.phone
      });
      const counselorName = resolveLsqCounselorName(state, record, counselorFilter);
      const sopDecision = evaluateLsqSop(existingLead, record);

      if (!sopDecision.inSop) {
        const archiveDoc = buildLsqArchiveDoc(record, sopDecision.reason, existingLead);
        archivedDocs.push(archiveDoc);
        summary.archived += 1;
        summary.byReason[sopDecision.reason] = (summary.byReason[sopDecision.reason] || 0) + 1;
        continue;
      }

      let nextLead = null;
      let wasCreated = false;
      if (existingLead) {
        nextLead = buildLsqUpdatedLead(existingLead, record, counselorName);
        await replaceLeadDocument(nextLead);
        summary.updated += 1;
      } else {
        const nextId = await getNextMetaLeadId();
        nextLead = buildLsqImportedLead(record, nextId, counselorName);
        await withMongoRetry(
          () => leadsCollection.insertOne(nextLead),
          { retries: 1, label: "Create LSQ imported lead" }
        );
        summary.created += 1;
        wasCreated = true;
      }

      await recordActivity({
        leadId: nextLead.id,
        leadName: nextLead.name,
        counselorName: nextLead.counselor || "",
        activityType: wasCreated ? "Lead Created" : "Lead Updated",
        actionDescription: `${wasCreated ? "Lead created" : "Lead updated"} from LeadSquared import${record.admissionStatus ? ` with ${record.admissionStatus} status` : ""}`,
        previousValue: existingLead?.lsqLastImportedAt || (wasCreated ? "Created from LSQ import" : "No previous LSQ import"),
        newValue: record.updatedAt || new Date().toISOString(),
        session
      });
    }

    if (archivedDocs.length) {
      await lsqArchiveCollection.insertMany(archivedDocs, { ordered: false });
    }

    await stateCollection.updateOne(
      { _id: STATE_DOC_ID },
      { $set: { updatedAt: new Date().toISOString() } },
      { upsert: true }
    );

    const nextState = await refreshStateAfterAtomicUpdate();
    res.setHeader("ETag", buildStateEtag(nextState));
    return res.json({
      ok: true,
      summary,
      archivedSample: normalizeBackupDocArray(archivedDocs.slice(0, 20)),
      state: buildStateResponse(nextState)
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to import LSQ leads", details: error.message });
  }
});

app.post("/api/auth/change-password", async (req, res) => {
  try {
    const activeSession = await getSessionFromRequest(req);
    if (!activeSession?.session) {
      return res.status(401).json({ message: "No active session." });
    }

    const currentPassword = String(req.body?.currentPassword || "").trim();
    const newPassword = String(req.body?.newPassword || "").trim();
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "Current password and new password are required." });
    }

    const session = activeSession.session;
    if (session.role === "super_admin") {
      const authConfig = await getAuthConfig();
      if (currentPassword !== authConfig.superAdminPassword) {
        return res.status(401).json({ message: "Current password is incorrect." });
      }
      await saveAuthConfig({
        ...authConfig,
        superAdminPassword: newPassword
      });
      return res.json({ ok: true });
    }

    const state = await getStateDoc();
    const now = new Date().toISOString();

    if (session.role === "admin") {
      const adminUsers = Array.isArray(state.adminUsers) ? state.adminUsers : [];
      const nextAdminUsers = adminUsers.map((user) => ({ ...user }));
      const index = nextAdminUsers.findIndex((user) => String(user.phone || "").trim() === String(session.phone || "").trim());
      if (index === -1 || String(nextAdminUsers[index].password || "") !== currentPassword) {
        return res.status(401).json({ message: "Current password is incorrect." });
      }
      nextAdminUsers[index].password = newPassword;
      await stateCollection.updateOne(
        { _id: STATE_DOC_ID },
        { $set: { adminUsers: nextAdminUsers, updatedAt: now } },
        { upsert: true }
      );
    } else if (session.role === "marketing") {
      const marketingUsers = Array.isArray(state.marketingUsers) ? state.marketingUsers : [];
      const nextMarketingUsers = marketingUsers.map((user) => ({ ...user }));
      const index = nextMarketingUsers.findIndex((user) => String(user.email || "").trim().toLowerCase() === String(session.email || "").trim().toLowerCase());
      if (index === -1 || String(nextMarketingUsers[index].password || "") !== currentPassword) {
        return res.status(401).json({ message: "Current password is incorrect." });
      }
      nextMarketingUsers[index].password = newPassword;
      await stateCollection.updateOne(
        { _id: STATE_DOC_ID },
        { $set: { marketingUsers: nextMarketingUsers, updatedAt: now } },
        { upsert: true }
      );
    } else if (session.role === "counselor") {
      const counselors = Array.isArray(state.counselors) ? state.counselors : [];
      const nextCounselors = counselors.map((user) => ({ ...user }));
      const index = nextCounselors.findIndex((user) => String(user.email || "").trim().toLowerCase() === String(session.email || "").trim().toLowerCase());
      if (index === -1 || String(nextCounselors[index].password || "") !== currentPassword) {
        return res.status(401).json({ message: "Current password is incorrect." });
      }
      nextCounselors[index].password = newPassword;
      await counselorsCollection.deleteMany({});
      if (nextCounselors.length) {
        await counselorsCollection.insertMany(nextCounselors);
      }
      await stateCollection.updateOne(
        { _id: STATE_DOC_ID },
        { $set: { updatedAt: now } },
        { upsert: true }
      );
    } else {
      return res.status(400).json({ message: "Unsupported role." });
    }

    cachedStateDoc = null;
    cachedStateDocAt = 0;
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ message: "Failed to change password", details: error.message });
  }
});

app.get("/api/preferences/:scope", async (req, res) => {
  try {
    const activeSession = await getSessionFromRequest(req);
    if (!activeSession) {
      return res.status(401).json({ message: "No active session." });
    }

    const scope = String(req.params.scope || "").trim();
    if (!scope) {
      return res.status(400).json({ message: "Preference scope is required." });
    }

    const preference = await preferenceCollection.findOne({
      ownerKey: buildOwnerKey(activeSession.session),
      scope
    });

    return res.json({ value: preference?.value ?? null });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch preference", details: error.message });
  }
});

app.put("/api/preferences/:scope", async (req, res) => {
  try {
    const activeSession = await getSessionFromRequest(req);
    if (!activeSession) {
      return res.status(401).json({ message: "No active session." });
    }

    const scope = String(req.params.scope || "").trim();
    if (!scope) {
      return res.status(400).json({ message: "Preference scope is required." });
    }

    const now = new Date().toISOString();
    const ownerKey = buildOwnerKey(activeSession.session);
    const value = req.body?.value ?? null;

    await preferenceCollection.updateOne(
      { ownerKey, scope },
      {
        $set: {
          value,
          updatedAt: now
        },
        $setOnInsert: {
          ownerKey,
          scope,
          createdAt: now
        }
      },
      { upsert: true }
    );

    return res.json({ ok: true, value });
  } catch (error) {
    return res.status(500).json({ message: "Failed to save preference", details: error.message });
  }
});

app.get("/api/admin/duplicate-leads", async (req, res) => {
  try {
    const session = await requireRole(req, res, "admin");
    if (!session) return;

    const leads = await loadFreshLeadsForDuplicateReview();
    const createdMetadataMap = await getLeadCreatedMetadataMap((leads || []).map((lead) => lead?.id));
    const groups = buildDuplicateLeadGroups(leads || []).map((group) => ({
      groupId: group.groupId,
      sharedEmails: group.sharedEmails,
      sharedPhones: group.sharedPhones,
      leadIds: group.leadIds,
      leads: group.leads
        .map((lead) => {
          const created = resolveLeadCreatedMetadata(lead, createdMetadataMap);
          return {
            id: lead.id,
            name: lead.name,
            email: lead.email,
            phone: lead.phone,
            counselor: lead.counselor || "Unassigned",
            leadPipeline: lead.leadPipeline || "",
            source: lead.source || "",
            status: lead.status || "",
            createdAt: lead.createdAt || "",
            createdAtExact: lead.createdAtExact || "",
            createdAtDisplay: created.display,
            createdAtSort: created.sortTime,
            courseName: lead.courseName || "",
            workshop: lead.workshop || "",
            publicCourseSegment: lead.publicCourseSegment || ""
          };
        })
        .sort((left, right) => {
          const leftSort = Number(left.createdAtSort) || 0;
          const rightSort = Number(right.createdAtSort) || 0;
          if (leftSort && rightSort && leftSort !== rightSort) {
            return leftSort - rightSort;
          }
          return String(left.id || "").localeCompare(String(right.id || ""));
        })
    }));

    return res.json({ ok: true, groups });
  } catch (error) {
    return res.status(500).json({ message: "Failed to load duplicate leads", details: error.message });
  }
});

app.post("/api/admin/duplicate-leads/merge", async (req, res) => {
  try {
    const session = await requireRole(req, res, "admin");
    if (!session) return;

    const keeperLeadId = String(req.body?.keeperLeadId || "").trim();
    const duplicateLeadIds = [...new Set(
      (Array.isArray(req.body?.duplicateLeadIds) ? req.body.duplicateLeadIds : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )].filter((id) => id !== keeperLeadId);

    if (!keeperLeadId || !duplicateLeadIds.length) {
      return res.status(400).json({ message: "A keeper lead and at least one duplicate lead are required." });
    }

    const allLeads = await loadFreshLeadsForDuplicateReview();
    const keeperLead = allLeads.find((lead) => String(lead?.id || "").trim() === keeperLeadId);
    const duplicateLeads = duplicateLeadIds
      .map((id) => allLeads.find((lead) => String(lead?.id || "").trim() === id))
      .filter(Boolean);

    if (!keeperLead) {
      return res.status(404).json({ message: "Keeper lead not found." });
    }
    if (!duplicateLeads.length) {
      return res.status(404).json({ message: "Duplicate leads not found." });
    }

    const mergedLead = await performDuplicateLeadMerge(
      keeperLead,
      duplicateLeads,
      session,
      "Admin merged duplicate leads into this record"
    );
    await touchStateUpdatedAt();
    const nextState = await refreshStateAfterAtomicUpdate();
    return res.json({ ok: true, lead: mergedLead, state: buildStateResponse(nextState) });
  } catch (error) {
    return res.status(500).json({ message: "Failed to merge duplicate leads", details: error.message });
  }
});

app.post("/api/admin/duplicate-leads/merge-all", async (req, res) => {
  try {
    const session = await requireRole(req, res, "admin");
    if (!session) return;

    const leads = await loadFreshLeadsForDuplicateReview();
    const createdMetadataMap = await getLeadCreatedMetadataMap((leads || []).map((lead) => lead?.id));
    const groups = buildDuplicateLeadGroups(leads || []);
    let mergedGroups = 0;
    const failedGroups = [];
    const disallowedKeeperSections = [...new Set(
      (Array.isArray(req.body?.disallowedKeeperSections) ? req.body.disallowedKeeperSections : [])
        .map((value) => String(value || "").trim().toLowerCase())
        .filter(Boolean)
    )];
    const preferNonRegisteredKeeper = req.body?.preferNonRegisteredKeeper === true;
    const preferWorkshopKeeper = req.body?.preferWorkshopKeeper === true;

    for (const group of groups) {
      if ((group.leads || []).length < 2) {
        continue;
      }

      const keeperLead = chooseDuplicateKeeperLead(group.leads, createdMetadataMap, {
        disallowedKeeperSections,
        preferNonRegisteredKeeper,
        preferWorkshopKeeper
      });
      const duplicateLeads = (group.leads || []).filter((lead) => String(lead?.id || "") !== String(keeperLead?.id || ""));
      if (!keeperLead || !duplicateLeads.length) {
        failedGroups.push({
          groupId: group.groupId,
          reason: "No valid keeper lead could be selected for this group."
        });
        continue;
      }

      try {
        await performDuplicateLeadMerge(
          keeperLead,
          duplicateLeads,
          session,
          "Admin merged duplicate leads into the bulk-selected keeper"
        );
        mergedGroups += 1;
      } catch (error) {
        failedGroups.push({
          groupId: group.groupId,
          keeperLeadId: String(keeperLead?.id || ""),
          reason: error?.message || "Unknown merge failure"
        });
      }
    }

    await touchStateUpdatedAt();
    const nextState = await refreshStateAfterAtomicUpdate();
    return res.json({
      ok: true,
      mergedGroups,
      failedGroups,
      state: buildStateResponse(nextState)
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to merge all duplicate leads", details: error.message });
  }
});

async function createNotification({ userId, role, type, title, message, sound = false, leadId = null, leadName = null, assignedCounselor = null, fromCounselor = null, toCounselor = null, taskId = null, taskTitle = null, taskNotes = null, taskDueDate = null, taskCategory = null }) {
  try {
    await initMongo();
    logNotificationDebug("createNotification called", { userId, role, type, title });

    const notification = {
      id: `n-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
      userId: String(userId).toLowerCase().trim(),
      role,
      type,
      title,
      message,
      sound: !!sound,
      createdAt: new Date().toISOString(),
      read: false,
      delivered: false,
      leadId: leadId ? String(leadId) : null,
      leadName: leadName ? String(leadName) : null,
      assignedCounselor: assignedCounselor ? String(assignedCounselor) : null,
      fromCounselor: fromCounselor ? String(fromCounselor) : null,
      toCounselor: toCounselor ? String(toCounselor) : null,
      taskId: taskId ? String(taskId) : null,
      taskTitle: taskTitle ? String(taskTitle) : null,
      taskNotes: taskNotes ? String(taskNotes) : null,
      taskDueDate: taskDueDate ? String(taskDueDate) : null,
      taskCategory: taskCategory ? String(taskCategory) : null
    };

    if (!notificationsCollection) {
      throw new Error("Notifications collection is not initialized.");
    }

    await withMongoRetry(
      () => notificationsCollection.insertOne(notification),
      { retries: 1, label: "Create notification record" }
    );

    logNotificationDebug("Notification inserted successfully", { id: notification.id, userId: notification.userId });
    return notification;
  } catch (error) {
    console.error("[notifications] Error in createNotification:", error);
    console.error("Failed to create notification:", error.message);
  }
}

function formatLeadNotificationLabel(lead) {
  const leadName = String(lead?.name || "").trim() || "Unknown lead";
  const workshopName = String(lead?.workshop || "").trim();
  return workshopName
    ? `${leadName} (${workshopName})`
    : leadName;
}

function getSessionViewerLabel(session) {
  const name = String(session?.name || "").trim();
  if (name) return name;

  const email = String(session?.email || "").trim();
  if (email) return email;

  const role = String(session?.role || "").trim();
  return role ? role.charAt(0).toUpperCase() + role.slice(1) : "Someone";
}

function findCounselorByName(state, counselorName) {
  const target = String(counselorName || "").trim().toLowerCase();
  if (!target || target === "unassigned") {
    return null;
  }

  const counselors = Array.isArray(state?.counselors) ? state.counselors : [];
  return counselors.find((item) => String(item?.name || "").trim().toLowerCase() === target) || null;
}

function getCounselorEmailByName(state, counselorName) {
  const counselor = findCounselorByName(state, counselorName);
  return String(counselor?.email || "").trim().toLowerCase();
}

function normalizeClaimDecision(value) {
  const decision = String(value || "").trim().toLowerCase();
  if (decision === "approve" || decision === "approved") return "approved";
  if (decision === "reject" || decision === "rejected") return "rejected";
  return "";
}

function normalizeLeadClaimDoc(claim = {}) {
  return {
    id: String(claim.id || "").trim(),
    status: String(claim.status || "pending").trim().toLowerCase() || "pending",
    adminStatus: String(claim.adminStatus || "pending").trim().toLowerCase() || "pending",
    ownerStatus: String(claim.ownerStatus || "pending").trim().toLowerCase() || "pending",
    leadId: String(claim.leadId || "").trim(),
    leadName: String(claim.leadName || "").trim(),
    leadEmail: String(claim.leadEmail || "").trim().toLowerCase(),
    leadPhone: String(claim.leadPhone || "").trim(),
    leadWorkshop: String(claim.leadWorkshop || "").trim(),
    leadCreatedAt: String(claim.leadCreatedAt || "").trim(),
    currentOwnerName: String(claim.currentOwnerName || "").trim(),
    currentOwnerEmail: String(claim.currentOwnerEmail || "").trim().toLowerCase(),
    requesterName: String(claim.requesterName || "").trim(),
    requesterEmail: String(claim.requesterEmail || "").trim().toLowerCase(),
    reason: String(claim.reason || "").trim(),
    createdAt: claim.createdAt || new Date().toISOString(),
    updatedAt: claim.updatedAt || claim.createdAt || new Date().toISOString(),
    adminDecidedAt: claim.adminDecidedAt || null,
    adminDecidedBy: claim.adminDecidedBy || null,
    ownerDecidedAt: claim.ownerDecidedAt || null,
    ownerDecidedBy: claim.ownerDecidedBy || null,
    completedAt: claim.completedAt || null,
    rejectedAt: claim.rejectedAt || null,
    rejectionReason: claim.rejectionReason || null
  };
}

function serializeLeadClaim(claim = {}) {
  const normalized = normalizeLeadClaimDoc(claim);
  delete normalized._id;
  return normalized;
}

function isClaimVisibleToSession(claim, session) {
  if (session?.role === "admin") return true;
  if (session?.role !== "counselor") return false;

  const email = String(session?.email || "").trim().toLowerCase();
  const name = String(session?.name || "").trim().toLowerCase();
  return email && (
    String(claim.requesterEmail || "").trim().toLowerCase() === email ||
    String(claim.currentOwnerEmail || "").trim().toLowerCase() === email
  ) || name && String(claim.currentOwnerName || "").trim().toLowerCase() === name;
}

function normalizeLeadCreationPipeline(value) {
  const pipeline = String(value || "").trim().toLowerCase();
  return pipeline === MAIN_ADMISSION_PIPELINE || pipeline === "admission" || pipeline === "main-admission-calling"
    ? MAIN_ADMISSION_PIPELINE
    : "workshop";
}

function normalizeLeadCreationRequestDoc(request = {}) {
  const pipeline = normalizeLeadCreationPipeline(request.pipeline || request.leadPipeline);
  return {
    id: String(request.id || "").trim(),
    status: String(request.status || "pending").trim().toLowerCase() || "pending",
    pipeline,
    name: String(request.name || "").trim(),
    email: String(request.email || "").trim().toLowerCase(),
    phone: String(request.phone || "").trim(),
    workshop: String(request.workshop || "").trim(),
    courseName: String(request.courseName || request.course || "").trim(),
    source: String(request.source || "").trim(),
    notes: String(request.notes || "").trim(),
    requesterName: String(request.requesterName || "").trim(),
    requesterEmail: String(request.requesterEmail || "").trim().toLowerCase(),
    requestedLeadId: request.requestedLeadId ? String(request.requestedLeadId).trim() : null,
    createdAt: request.createdAt || new Date().toISOString(),
    updatedAt: request.updatedAt || request.createdAt || new Date().toISOString(),
    decidedAt: request.decidedAt || null,
    decidedBy: request.decidedBy || null,
    rejectionReason: request.rejectionReason || null,
    clearedByAdmin: !!request.clearedByAdmin,
    clearedByRequester: !!request.clearedByRequester
  };
}

function serializeLeadCreationRequest(request = {}) {
  const normalized = normalizeLeadCreationRequestDoc(request);
  delete normalized._id;
  return normalized;
}

function isLeadCreationRequestVisibleToSession(request, session) {
  if (session?.role === "admin") {
    return !request.clearedByAdmin;
  }
  if (session?.role !== "counselor") {
    return false;
  }

  const email = String(session?.email || "").trim().toLowerCase();
  return !!email && request.requesterEmail === email && !request.clearedByRequester;
}

function getLeadCreationTargetLabel(request = {}) {
  return normalizeLeadCreationPipeline(request.pipeline) === MAIN_ADMISSION_PIPELINE
    ? "Main Admission Calling"
    : "Workshop Calling";
}

function buildApprovedLeadFromCreationRequest(request = {}, nextId, approvedAt = new Date().toISOString()) {
  const normalized = normalizeLeadCreationRequestDoc(request);
  const isAdmission = normalized.pipeline === MAIN_ADMISSION_PIPELINE;
  const createdAt = toKolkataDateKey(new Date(approvedAt));
  const baseLead = {
    id: nextId,
    name: normalized.name,
    email: normalized.email,
    phone: normalized.phone,
    source: normalized.source || "Counselor Lead Creation Request",
    createdAtExact: approvedAt,
    createdAt,
    counselor: normalized.requesterName || "Unassigned",
    leadCreationRequestId: normalized.id,
    requestedBy: normalized.requesterName || normalized.requesterEmail,
    requestedByEmail: normalized.requesterEmail,
    approvedAt,
    approvedBy: normalized.decidedBy || "Admin",
    leadNotes: normalized.notes
      ? [{ text: normalized.notes, at: approvedAt, by: normalized.requesterName || normalized.requesterEmail }]
      : [],
    importSourceFiles: ["Lead Creation Request"],
    importSourceSheets: []
  };

  if (isAdmission) {
    return decorateLeadForStorage({
      ...baseLead,
      leadPipeline: MAIN_ADMISSION_PIPELINE,
      courseName: normalized.courseName,
      admissionSopAssignedAt: shouldTreatLeadAsAssigned(baseLead.counselor) ? approvedAt : null,
      admissionSopLastProgressAt: null,
      mainAdmissionDialed: "",
      mainAdmissionCoursePitched: "",
      mainAdmissionCourseStatus: "",
      mainAdmissionAdmissionStatus: "",
      mainAdmissionCallStatus: "",
      mainAdmissionActivityUpdated: false,
      mainAdmissionActivityUpdates: 0,
      mainAdmissionActivityHistory: []
    });
  }

  return decorateLeadForStorage({
    ...baseLead,
    leadPipeline: "",
    workshop: normalized.workshop,
    admissionWorkshop: normalized.workshop,
    status: "New",
    dialed: "",
    callStatus: "",
    wsStatus: "",
    whatsappInvite: "",
    postDialed: "",
    postCallStatus: "",
    coursePitched: "",
    courseStatus: "",
    admissionStatus: "",
    workshopJoiningStatus: "",
    whatsappGroupStatus: "",
    postStatusUpdated: false,
    preActivityUpdates: 0,
    postActivityUpdates: 0,
    workshopActivityHistory: [],
    admissionActivityHistory: []
  });
}

function findLeadCreationDuplicate(leads = [], incomingLead = {}) {
  const isAdmission = isMainAdmissionLead(incomingLead);
  return (Array.isArray(leads) ? leads : []).find((lead) => {
    if (isAdmission) {
      return isMainAdmissionLead(lead) && !!findDuplicateLeadByEmailOrPhone([lead], incomingLead);
    }
    return !isMainAdmissionLead(lead) && !isPublicCourseRegistrationLead(lead) && !!findDuplicateLeadByEmailOrPhone([lead], incomingLead);
  }) || null;
}

async function touchStateUpdatedAt(now = new Date().toISOString()) {
  await stateCollection.updateOne(
    { _id: STATE_DOC_ID },
    { $set: { updatedAt: now } },
    { upsert: true }
  );
  cachedStateDoc = null;
  cachedStateDocAt = 0;
}

function isCounselorLeadViewNotificationEligible(session) {
  const role = String(session?.role || "").trim().toLowerCase();
  return role === "counselor";
}

app.post("/api/leads/:leadId/view", async (req, res) => {
  try {
    const session = await requireSession(req, res);
    if (!session) return;

    const leadId = req.params.leadId;
    const leadEmail = String(req.body?.leadEmail || "").trim().toLowerCase();
    const state = await getStateDoc();
    const lead = findLeadByIdentity(state, leadId, leadEmail);

    if (!lead) {
      return res.status(404).json({ message: "Lead not found." });
    }

    if (!isCounselorLeadViewNotificationEligible(session)) {
      return res.json({ ok: true, notified: false, message: "Lead view notifications are only sent for counselor viewers." });
    }

    const assignedCounselor = String(lead.counselor || "").trim();
    const counselor = findCounselorByName(state, assignedCounselor);
    const counselorEmail = String(counselor?.email || "").trim().toLowerCase();

    if (!counselorEmail) {
      return res.json({ ok: true, notified: false, message: "Lead has no assigned counselor with a notification account." });
    }

    const viewerEmail = String(session.email || "").trim().toLowerCase();
    if (viewerEmail && viewerEmail === counselorEmail) {
      return res.json({ ok: true, notified: false, message: "Viewer is the assigned counselor." });
    }

    const viewerLabel = getSessionViewerLabel(session);
    const leadLabel = formatLeadNotificationLabel(lead);

    await createNotification({
      userId: counselorEmail,
      role: "counselor",
      type: "lead_viewed",
      title: "Lead Being Viewed",
      message: `${viewerLabel} is currently viewing your lead ${leadLabel}.`,
      sound: true,
      leadId: lead.id,
      leadName: lead.name,
      assignedCounselor
    });

    await recordActivity({
      leadId: lead.id,
      leadName: lead.name,
      counselorName: assignedCounselor,
      activityType: "Lead Viewed",
      actionDescription: `${viewerLabel} opened this lead in Lead Browse`,
      session
    });

    return res.json({ ok: true, notified: true });
  } catch (error) {
    return res.status(500).json({ message: "Failed to record lead view", details: error.message });
  }
});

app.get("/api/notifications", async (req, res) => {
  try {
    await initMongo();
    const activeSession = await getSessionFromRequest(req);
    if (!activeSession) {
      return res.status(401).json({ message: "No active session." });
    }

    const session = activeSession.session;
    const userId = session.role === "admin" ? "admin" : session.email.toLowerCase().trim();
    const isPopupOnly = req.query.popup === "true";
    const state = await getStateDoc();

    if (isPopupOnly) {
      await createDueTaskNotificationsForSession(session, state);
    }

    if (isPopupOnly) {
      const notifications = await notificationsCollection
        .find({ userId, read: false, delivered: false })
        .sort({ createdAt: 1 })
        .toArray();

      if (notifications.length > 0) {
        const ids = notifications.map(n => n.id);
        await notificationsCollection.updateMany(
          { id: { $in: ids } },
          { $set: { delivered: true } }
      );
    }
      return res.json(notifications);
    } else {
      const notifications = await notificationsCollection
        .find({ userId, read: false })
        .sort({ createdAt: -1 })
        .limit(30)
        .toArray();
      return res.json(notifications);
    }
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch notifications", details: error.message });
  }
});

app.post("/api/notifications/read", async (req, res) => {
  try {
    await initMongo();
    const activeSession = await getSessionFromRequest(req);
    if (!activeSession) {
      return res.status(401).json({ message: "No active session." });
    }

    const session = activeSession.session;
    const userId = session.role === "admin" ? "admin" : session.email.toLowerCase().trim();

    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const query = { userId, read: false };
    if (ids.length) {
      query.id = { $in: ids };
    }

    await notificationsCollection.updateMany(query, { $set: { read: true } });
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ message: "Failed to mark notifications as read", details: error.message });
  }
});

app.patch("/api/main-admission-leads/:leadId/details", async (req, res) => {
  try {
    const session = await requireRole(req, res, ["admin", "counselor"]);
    if (!session) return;

    const leadId = req.params.leadId;
    const leadEmail = String(req.body?.leadEmail || "").trim().toLowerCase();
    const state = await getStateDoc();
    const lead = findLeadByIdentity(state, leadId, leadEmail);

    if (!lead) {
      return res.status(404).json({ message: "Lead not found." });
    }
    if (!isMainAdmissionLead(lead)) {
      return res.status(400).json({ message: "Lead details can be edited only from Main Admission Leads." });
    }
    const mutationRestriction = getLeadMutationRestrictionMessage(session, state, lead);
    if (mutationRestriction) {
      return res.status(403).json({ message: mutationRestriction });
    }

    const patch = sanitizeMainAdmissionDetailsPatch(lead, req.body || {});
    if (!Object.keys(patch).length) {
      return res.status(400).json({ message: "No valid lead detail fields provided." });
    }

    const candidateLead = structuredClone({ ...lead });
    Object.entries(patch).forEach(([field, value]) => {
      if (field.includes(".")) {
        const [bucket, key] = field.split(".");
        candidateLead[bucket] = candidateLead[bucket] && typeof candidateLead[bucket] === "object"
          ? { ...candidateLead[bucket] }
          : {};
        candidateLead[bucket][key] = value;
      } else {
        candidateLead[field] = value;
      }
    });

    const duplicateLead = findDuplicateLeadByEmailOrPhone(
      (Array.isArray(state.leads) ? state.leads : []).filter((item) => String(item?.id) !== String(lead.id)),
      candidateLead
    );
    if (duplicateLead) {
      return res.status(409).json({ message: "Another lead already uses this email or phone." });
    }

    const decoratedCandidate = decorateLeadForStorage(candidateLead);
    const normalizedPatch = {};
    ["normalizedEmail", "normalizedPhone", "courseKey", "courseRawName"].forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(decoratedCandidate, field)) {
        normalizedPatch[field] = decoratedCandidate[field];
      }
    });

    const now = new Date().toISOString();
    const query = { id: { $in: getLeadIdCandidates(leadId) } };
    if (leadEmail) {
      query.email = leadEmail;
    }

    const result = await leadsCollection.updateOne(query, {
      $set: {
        ...patch,
        ...normalizedPatch,
        updatedAt: now
      }
    });

    if (!result.modifiedCount) {
      return res.status(409).json({ message: "Lead changed before the details could be saved. Please reload and retry." });
    }

    await stateCollection.updateOne(
      { _id: STATE_DOC_ID },
      { $set: { updatedAt: now } },
      { upsert: true }
    );

    await recordActivity({
      leadId: lead.id,
      leadName: candidateLead.name || lead.name,
      counselorName: candidateLead.counselor || lead.counselor || "",
      activityType: "Lead Details Updated",
      actionDescription: "Main Admission lead details updated",
      session
    });

    const nextState = await refreshStateAfterAtomicUpdate();
    const updatedLead = findLeadByIdentity(nextState, leadId, patch.email || leadEmail);
    res.setHeader("ETag", buildStateEtag(nextState));
    return res.json({ ok: true, lead: updatedLead, state: buildStateResponse(nextState) });
  } catch (error) {
    return res.status(500).json({ message: "Failed to update lead details", details: error.message });
  }
});

app.post("/api/leads/:leadId/activity", async (req, res) => {
  try {
    const session = await requireRole(req, res, ["admin", "counselor"]);
    if (!session) return;

    const leadId = req.params.leadId;
    const leadEmail = String(req.body?.leadEmail || "").trim().toLowerCase();
    const stage = String(req.body?.stage || "").trim().toLowerCase();
    const updates = req.body?.updates || {};
    const state = await getStateDoc();
    const lead = findLeadByIdentity(state, leadId, leadEmail);

    if (!lead) {
      return res.status(404).json({ message: "Lead not found." });
    }
    const mutationRestriction = getLeadMutationRestrictionMessage(session, state, lead);
    if (mutationRestriction) {
      return res.status(403).json({ message: mutationRestriction });
    }

    const config = stage === "admission"
      ? {
          source: "Admission Calling",
          historyField: "admissionActivityHistory",
          countField: "postActivityUpdates",
          allowedFields: [
            "postDialed",
            "coursePitched",
            "courseStatus",
            "admissionStatus",
            "admissionWorkshop",
            "postCallStatus",
            "workshopJoiningStatus",
            "postStatusUpdated"
          ]
        }
        : stage === "workshop"
        ? {
            source: "Workshop Calling",
            historyField: "workshopActivityHistory",
            countField: "preActivityUpdates",
            allowedFields: [
              "dialed",
              "callStatus",
              "wsStatus",
              "whatsappInvite",
              "whatsappGroupStatus"
            ]
          }
        : stage === "registered-course"
          ? {
              source: "Post Workshop Registered Candidate",
              historyField: "registeredCourseActivityHistory",
              countField: "registeredCourseActivityUpdates",
              allowedFields: [
                "registeredDialed",
                "registeredCoursePitched",
                "registeredCourseStatus",
                "registeredAdmissionStatus",
                "registeredCallStatus",
                "registeredActivityUpdated"
              ]
            }
        : stage === "main-admission"
          ? {
              source: "Main Admission Leads",
              historyField: "mainAdmissionActivityHistory",
              countField: "mainAdmissionActivityUpdates",
              allowedFields: [
                "mainAdmissionDialed",
                "mainAdmissionCoursePitched",
                "mainAdmissionCourseStatus",
                "mainAdmissionAdmissionStatus",
                "mainAdmissionCallStatus",
                "mainAdmissionActivityUpdated"
              ]
            }
        : null;

    if (!config) {
      return res.status(400).json({ message: "Activity stage must be workshop, admission, registered-course, or main-admission." });
    }

    if (stage === "admission" && !req.body?.allowWithoutWorkshopActivity) {
      const workshopActivityCount = Array.isArray(lead.workshopActivityHistory)
        ? lead.workshopActivityHistory.length
        : Number(lead.preActivityUpdates) || 0;
      if (!workshopActivityCount) {
        return res.status(409).json({ message: "Workshop activity has not been completed for this lead." });
      }
    }

    const patch = sanitizeLeadPatch(updates, config.allowedFields);
    if (!Object.keys(patch).length) {
      return res.status(400).json({ message: "No valid activity fields provided." });
    }

    if (stage === "admission") {
      patch.postStatusUpdated = true;
    }

    const history = Array.isArray(lead[config.historyField]) ? lead[config.historyField] : [];
    const nextCount = history.length + 1;
    const event = {
      at: new Date().toISOString(),
      source: config.source,
      updates: patch,
      by: session.name || session.email || session.role
    };
    const query = { id: { $in: getLeadIdCandidates(leadId) } };
    if (leadEmail) {
      query.email = String(leadEmail).trim().toLowerCase();
    }
    const update = {
      $set: {
        ...patch,
        ...getLeadActivityAssigneePatch(stage, session),
        [config.countField]: nextCount
      },
      $push: {
        [config.historyField]: event
      }
    };

    if (stage === "registered-course" || stage === "main-admission") {
      update.$set.admissionSopLastProgressAt = event.at;
      if (!String(lead?.admissionSopAssignedAt || "").trim()) {
        update.$set.admissionSopAssignedAt = event.at;
      }
    }

    const result = await leadsCollection.updateOne(query, update);

    if (result.modifiedCount) {
      for (const field of Object.keys(patch)) {
        const oldVal = String(lead[field] || "").trim();
        const newVal = String(patch[field] || "").trim();
        if (oldVal !== newVal) {
          let activityType = "Status Changed";
          let actionDescription = `Field '${field}' updated from '${oldVal || "None"}' to '${newVal || "None"}'`;
          
          if (field === "dialed" || field === "postDialed" || field === "registeredDialed" || field === "mainAdmissionDialed") {
            if (newVal === "Yes") {
              activityType = "Call Made";
              actionDescription = `Call marked as Dialed (stage: ${stage})`;
            }
          } else if (field === "callStatus" || field === "postCallStatus" || field === "registeredCallStatus" || field === "mainAdmissionCallStatus") {
            activityType = "Call Made";
            actionDescription = `Call made, status changed to: ${newVal}`;
          } else if (field === "whatsappInvite") {
            if (newVal === "Yes") {
              activityType = "WhatsApp Sent";
              actionDescription = `WhatsApp invitation sent`;
            }
          } else if (field === "coursePitched" || field === "registeredCoursePitched" || field === "mainAdmissionCoursePitched") {
            activityType = "Course Discussed";
            actionDescription = `Course pitched status: ${newVal}`;
          } else if (field === "courseStatus" || field === "registeredCourseStatus" || field === "mainAdmissionCourseStatus") {
            activityType = "Course Discussed";
            actionDescription = `Course status changed to: ${newVal}`;
          } else if (field === "admissionStatus" || field === "registeredAdmissionStatus" || field === "mainAdmissionAdmissionStatus") {
            if (newVal === "Joined") {
              activityType = "Lead Converted";
              actionDescription = `Lead converted: admission completed!`;
            } else if (newVal === "Not Interested" || newVal === "Not Joined" || newVal === "Closed") {
              activityType = "Lead Closed";
              actionDescription = `Lead closed: status changed to ${newVal}`;
            } else {
              activityType = "Status Changed";
              actionDescription = `Admission status updated to: ${newVal}`;
            }
          } else if (field === "wsStatus") {
            if (newVal === "Interested") {
              activityType = "Status Changed";
              actionDescription = `Workshop Status updated: Interested`;
            } else if (newVal === "Not Interested") {
              activityType = "Lead Closed";
              actionDescription = `Workshop Status updated: Not Interested`;
            }
          } else if (field === "whatsappGroupStatus") {
            activityType = "Status Changed";
            actionDescription = `WhatsApp group status changed to: ${newVal}`;
          }
          
          await recordActivity({
            leadId: lead.id,
            leadName: lead.name,
            counselorName: lead.counselor || "",
            activityType,
            actionDescription,
            previousValue: oldVal || "None",
            newValue: newVal || "None",
            session
          });
        }
      }
      await stateCollection.updateOne(
        { _id: STATE_DOC_ID },
        { $set: { updatedAt: new Date().toISOString() } },
        { upsert: true }
      );
    }

    if (!result.modifiedCount) {
      return res.status(409).json({ message: "Lead changed before the activity could be saved. Please reload and retry." });
    }

    const nextState = await refreshStateAfterAtomicUpdate();
    const updatedLead = findLeadByIdentity(nextState, leadId, leadEmail);
    res.setHeader("ETag", buildStateEtag(nextState));
    return res.json({ ok: true, lead: updatedLead, state: buildStateResponse(nextState) });
  } catch (error) {
    return res.status(500).json({ message: "Failed to update lead activity", details: error.message });
  }
});

app.post("/api/leads/:leadId/notes", async (req, res) => {
  try {
    const session = await requireRole(req, res, ["admin", "counselor"]);
    if (!session) return;

    const leadId = req.params.leadId;
    const leadEmail = String(req.body?.leadEmail || "").trim().toLowerCase();
    const text = String(req.body?.text || "").trim();
    if (!text) {
      return res.status(400).json({ message: "Note text is required." });
    }

    const state = await getStateDoc();
    const lead = findLeadByIdentity(state, leadId, leadEmail);
    if (!lead) {
      return res.status(404).json({ message: "Lead not found." });
    }
    const mutationRestriction = getLeadMutationRestrictionMessage(session, state, lead);
    if (mutationRestriction) {
      return res.status(403).json({ message: mutationRestriction });
    }

    const note = {
      text,
      at: toKolkataDateKey(),
      by: session.name || "Unknown"
    };
    const query = { id: { $in: getLeadIdCandidates(leadId) } };
    if (leadEmail) {
      query.email = String(leadEmail).trim().toLowerCase();
    }
    const result = await leadsCollection.updateOne(
      query,
      { $push: { leadNotes: note } }
    );
    if (result.modifiedCount) {
      await recordActivity({
        leadId: lead.id,
        leadName: lead.name,
        counselorName: lead.counselor || "",
        activityType: "Notes Added",
        actionDescription: `Added note: "${text}"`,
        newValue: text,
        session
      });
      await stateCollection.updateOne(
        { _id: STATE_DOC_ID },
        { $set: { updatedAt: new Date().toISOString() } },
        { upsert: true }
      );
    }

    if (!result.modifiedCount) {
      return res.status(409).json({ message: "Lead changed before the note could be saved. Please reload and retry." });
    }

    const nextState = await refreshStateAfterAtomicUpdate();
    const updatedLead = findLeadByIdentity(nextState, leadId, leadEmail);
    res.setHeader("ETag", buildStateEtag(nextState));
    return res.json({ ok: true, lead: updatedLead, state: buildStateResponse(nextState) });
  } catch (error) {
    return res.status(500).json({ message: "Failed to save note", details: error.message });
  }
});

app.delete("/api/leads/:leadId/notes/:noteIndex", async (req, res) => {
  try {
    const session = await requireRole(req, res, ["admin", "counselor"]);
    if (!session) return;

    const leadId = req.params.leadId;
    const leadEmail = String(req.query?.leadEmail || "").trim().toLowerCase();
    const noteIndex = Number(req.params.noteIndex);
    const state = await getStateDoc();
    const lead = findLeadByIdentity(state, leadId, leadEmail);
    if (!lead) {
      return res.status(404).json({ message: "Lead not found." });
    }
    const mutationRestriction = getLeadMutationRestrictionMessage(session, state, lead);
    if (mutationRestriction) {
      return res.status(403).json({ message: mutationRestriction });
    }

    const notes = Array.isArray(lead.leadNotes) ? lead.leadNotes : [];
    if (!Number.isInteger(noteIndex) || noteIndex < 0 || noteIndex >= notes.length) {
      return res.status(400).json({ message: "Valid note index is required." });
    }

    const nextNotes = notes.filter((_, index) => index !== noteIndex);
    const query = { id: { $in: getLeadIdCandidates(leadId) } };
    if (leadEmail) {
      query.email = String(leadEmail).trim().toLowerCase();
    }
    const result = await leadsCollection.updateOne(
      query,
      { $set: { leadNotes: nextNotes } }
    );
    if (result.modifiedCount) {
      const deletedNoteText = notes[noteIndex]?.text || "";
      await recordActivity({
        leadId: lead.id,
        leadName: lead.name,
        counselorName: lead.counselor || "",
        activityType: "Notes Deleted",
        actionDescription: `Deleted note: "${deletedNoteText}"`,
        previousValue: deletedNoteText,
        session
      });
      await stateCollection.updateOne(
        { _id: STATE_DOC_ID },
        { $set: { updatedAt: new Date().toISOString() } },
        { upsert: true }
      );
    }
    if (!result.modifiedCount) {
      return res.status(409).json({ message: "Lead changed before the note could be deleted. Please reload and retry." });
    }

    const nextState = await refreshStateAfterAtomicUpdate();
    const updatedLead = findLeadByIdentity(nextState, leadId, leadEmail);
    res.setHeader("ETag", buildStateEtag(nextState));
    return res.json({ ok: true, lead: updatedLead, state: buildStateResponse(nextState) });
  } catch (error) {
    return res.status(500).json({ message: "Failed to delete note", details: error.message });
  }
});

app.delete("/api/leads", async (req, res) => {
  try {
    const session = await requireRole(req, res, "admin");
    if (!session) return;

    const leadRefs = Array.isArray(req.body?.leadRefs) ? req.body.leadRefs : [];
    const identityMatchConditions = buildLiveLeadIdentityMatchConditions(leadRefs);
    const identityQuery = identityMatchConditions.length ? { $or: identityMatchConditions } : null;
    const idQuery = buildLiveLeadIdQuery(leadRefs);
    if (!identityQuery && !idQuery) {
      return res.status(400).json({ message: "Lead references are required." });
    }

    let query = identityQuery || idQuery;
    let leadsToDelete = await leadsCollection.find(query).toArray();
    if (!leadsToDelete.length && identityQuery && idQuery) {
      leadsToDelete = await leadsCollection.find(idQuery).toArray();
      query = idQuery;
    }

    if (!leadsToDelete.length) {
      return res.status(404).json({ message: "No matching leads were deleted." });
    }

    const result = await leadsCollection.deleteMany(query);
    if (!result.deletedCount) {
      return res.status(409).json({ message: "Leads changed before they could be deleted. Please reload and retry." });
    }

    const deletedLeadIds = leadsToDelete
      .map((lead) => String(lead?.id || "").trim())
      .filter(Boolean);
    if (deletedLeadIds.length) {
      await tasksCollection.deleteMany({ leadId: { $in: deletedLeadIds } });
    }

    for (const lead of leadsToDelete) {
      await recordActivity({
        leadId: lead.id,
        leadName: lead.name,
        counselorName: lead.counselor || "",
        activityType: "Lead Deleted",
        actionDescription: `Lead deleted from CRM: ${formatLeadNotificationLabel(lead)}`,
        previousValue: lead.workshop || lead.courseName || lead.source || "",
        session
      });
    }

    const now = new Date().toISOString();
    await stateCollection.updateOne(
      { _id: STATE_DOC_ID },
      { $set: { updatedAt: now } },
      { upsert: true }
    );

    const nextState = await refreshStateAfterAtomicUpdate();
    res.setHeader("ETag", buildStateEtag(nextState));
    return res.json({ ok: true, deletedCount: result.deletedCount, state: buildStateResponse(nextState) });
  } catch (error) {
    return res.status(500).json({ message: "Failed to delete leads", details: error.message });
  }
});

async function assignLeadsHandler(req, res) {
  try {
    const session = await requireRole(req, res, "admin");
    if (!session) return;

    const leadRefs = Array.isArray(req.body?.leadRefs) ? req.body.leadRefs : [];
    const leadIds = Array.isArray(req.body?.leadIds) ? req.body.leadIds : [];
    const counselor = String(req.body?.counselor || "").trim();
    if ((!leadRefs.length && !leadIds.length) || !counselor) {
      return res.status(400).json({ message: "Lead references and counselor are required." });
    }

    const idQuery = buildLiveLeadIdQuery(leadRefs, leadIds);
    const identityMatchConditions = buildLiveLeadIdentityMatchConditions(leadRefs);
    const identityQuery = identityMatchConditions.length ? { $or: identityMatchConditions } : null;
    const query = idQuery || identityQuery;

    if (!query) {
      return res.status(400).json({ message: "Lead references are required." });
    }

    let leadsToUpdate = await leadsCollection.find(query).toArray();
    let updateQuery = query;
    if (!leadsToUpdate.length && idQuery && identityQuery) {
      leadsToUpdate = await leadsCollection.find(identityQuery).toArray();
      updateQuery = identityQuery;
    }

    if (!leadsToUpdate.length) {
      return res.status(404).json({ message: "No matching leads were assigned." });
    }

    const protectedLeads = [];
    const blockedSameCounselorLeads = [];
    const assignableLeads = [];
    let skippedProtectedCount = 0;
    let skippedInterestedCount = 0;
    let skippedBlockedSameCounselorCount = 0;

    leadsToUpdate.forEach((lead) => {
      const skipReason = getLeadBulkAssignmentSkipReason(lead);
      if (!skipReason) {
        const sopState = deriveAdmissionSopState(lead);
        const isBlockedSameCounselor = Boolean(
          sopState?.blocked &&
          isAdmissionSopScopedLead(lead) &&
          String(lead?.counselor || "").trim().toLowerCase() === counselor.toLowerCase()
        );
        if (isBlockedSameCounselor) {
          blockedSameCounselorLeads.push(lead);
          skippedBlockedSameCounselorCount += 1;
        } else {
          assignableLeads.push(lead);
        }
        return;
      }

      protectedLeads.push(lead);
      if (skipReason === "workshopInterested") {
        skippedInterestedCount += 1;
      } else {
        skippedProtectedCount += 1;
      }
    });

    if (!assignableLeads.length) {
      const now = new Date().toISOString();
      await stateCollection.updateOne(
        { _id: STATE_DOC_ID },
        { $set: { updatedAt: now } },
        { upsert: true }
      );

      const nextState = await refreshStateAfterAtomicUpdate();
      res.setHeader("ETag", buildStateEtag(nextState));
      return res.json({
        ok: true,
        updatedCount: 0,
        matchedCount: 0,
        assignedCount: 0,
        skippedProtectedCount,
        skippedInterestedCount,
        skippedBlockedSameCounselorCount,
        state: buildStateResponse(nextState)
      });
    }

    const assignableLeadIds = assignableLeads
      .map((lead) => lead.id)
      .filter((id) => id !== undefined && id !== null);
    const assignmentChangedLeads = assignableLeads
      .filter((lead) => String(lead.counselor || "").trim().toLowerCase() !== counselor.toLowerCase());
    const now = new Date().toISOString();
    const result = await leadsCollection.updateMany(
      { id: { $in: assignableLeadIds } },
      { $set: { counselor } }
    );

    const matchedCount = Number.isFinite(Number(result.matchedCount))
      ? Number(result.matchedCount)
      : Number(result.modifiedCount) || 0;
    if (!matchedCount) {
      return res.status(409).json({ message: "Leads changed before they could be assigned. Please reload and retry." });
    }

    if (assignmentChangedLeads.length) {
      for (const lead of assignmentChangedLeads) {
        await leadsCollection.updateOne(
          { id: { $in: getLeadIdCandidates(lead.id) } },
          { $set: getLeadAssignmentResetPatch(lead, counselor, now) }
        );
      }
    }

    // Trigger notifications for reassigned leads
    const counselorsList = await counselorsCollection.find({}).toArray();
    const counselorEmailByName = new Map();
    counselorsList.forEach(c => {
      if (c.name && c.email) {
        counselorEmailByName.set(c.name.toLowerCase().trim(), c.email.toLowerCase().trim());
      }
    });

    for (const lead of assignableLeads) {
      const oldCounselor = String(lead.counselor || "").trim();
      const newCounselor = String(counselor).trim();
      const leadLabel = formatLeadNotificationLabel(lead);
      
      if (oldCounselor.toLowerCase() !== newCounselor.toLowerCase()) {
        const hasOldCounselor = oldCounselor && oldCounselor.toLowerCase() !== "unassigned";
        await recordActivity({
          leadId: lead.id,
          leadName: lead.name,
          counselorName: newCounselor,
          activityType: hasOldCounselor ? "Lead Reassigned" : "Lead Assigned",
          actionDescription: hasOldCounselor
            ? `Lead counselor reassigned from ${oldCounselor} to ${newCounselor}`
            : `Lead assigned to counselor ${newCounselor}`,
          previousValue: oldCounselor || "Unassigned",
          newValue: newCounselor,
          session
        });

        const oldCounselorEmail = counselorEmailByName.get(oldCounselor.toLowerCase());
        const newCounselorEmail = counselorEmailByName.get(newCounselor.toLowerCase());

        if (oldCounselorEmail && oldCounselor.toLowerCase() !== "unassigned") {
          await createNotification({
            userId: oldCounselorEmail,
            role: "counselor",
            type: "lead_transferred_from",
            title: "Lead Transferred",
            message: `Lead ${leadLabel} has been transferred to ${newCounselor}.`,
            sound: true,
            leadId: lead.id,
            leadName: lead.name,
            toCounselor: newCounselor
          });
        }

        if (newCounselorEmail && newCounselor.toLowerCase() !== "unassigned") {
          const hasOldCounselor = oldCounselor && oldCounselor.toLowerCase() !== "unassigned";
          await createNotification({
            userId: newCounselorEmail,
            role: "counselor",
            type: "lead_transferred_to",
            title: hasOldCounselor ? "Lead Transferred to You" : "New Lead Received",
            message: hasOldCounselor
              ? `You received lead ${leadLabel} from ${oldCounselor}.`
              : `You received new lead ${leadLabel}.`,
            sound: true,
            leadId: lead.id,
            leadName: lead.name,
            fromCounselor: hasOldCounselor ? oldCounselor : null
          });
        }
      }
    }

    await stateCollection.updateOne(
      { _id: STATE_DOC_ID },
      { $set: { updatedAt: now } },
      { upsert: true }
    );

    const nextState = await refreshStateAfterAtomicUpdate();
    res.setHeader("ETag", buildStateEtag(nextState));
    return res.json({
      ok: true,
      updatedCount: result.modifiedCount,
      matchedCount: result.matchedCount,
      assignedCount: matchedCount,
      skippedProtectedCount,
      skippedInterestedCount,
      skippedBlockedSameCounselorCount,
      state: buildStateResponse(nextState)
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to assign leads", details: error.message });
  }
}

app.patch("/api/leads/assignment", assignLeadsHandler);
app.post("/api/leads/assignment", assignLeadsHandler);

app.get("/api/lead-creation-requests", async (req, res) => {
  try {
    const session = await requireRole(req, res, ["admin", "counselor"]);
    if (!session) return;

    const requests = await leadCreationRequestsCollection.find({}).sort({ createdAt: -1 }).toArray();
    const visibleRequests = (Array.isArray(requests) ? requests : [])
      .map(serializeLeadCreationRequest)
      .filter((request) => isLeadCreationRequestVisibleToSession(request, session))
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));

    return res.json({ ok: true, requests: visibleRequests });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch lead creation requests", details: error.message });
  }
});

app.delete("/api/lead-creation-requests", async (req, res) => {
  try {
    const session = await requireRole(req, res, ["admin", "counselor"]);
    if (!session) return;

    const now = new Date().toISOString();
    const query = session.role === "admin"
      ? { clearedByAdmin: { $ne: true } }
      : { requesterEmail: String(session.email || "").trim().toLowerCase(), clearedByRequester: { $ne: true } };
    const patch = session.role === "admin"
      ? { clearedByAdmin: true, adminClearedAt: now, updatedAt: now }
      : { clearedByRequester: true, requesterClearedAt: now, updatedAt: now };

    const result = await leadCreationRequestsCollection.updateMany(query, { $set: patch });
    return res.json({ ok: true, clearedCount: result.modifiedCount || 0 });
  } catch (error) {
    return res.status(500).json({ message: "Failed to clear lead creation requests", details: error.message });
  }
});

app.post("/api/lead-creation-requests", async (req, res) => {
  try {
    const session = await requireRole(req, res, "counselor");
    if (!session) return;

    const state = await getStateDoc();
    const requesterName = getSessionCounselorName(state, session);
    const requesterEmail = String(session.email || "").trim().toLowerCase();
    const pipeline = normalizeLeadCreationPipeline(req.body?.pipeline || req.body?.leadPipeline);
    const name = String(req.body?.name || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const phone = String(req.body?.phone || "").trim();
    const workshop = String(req.body?.workshop || "").trim();
    const courseName = String(req.body?.courseName || req.body?.course || "").trim();
    const source = String(req.body?.source || "").trim();
    const notes = String(req.body?.notes || "").trim();

    if (!requesterName || !requesterEmail) {
      return res.status(403).json({ message: "Counselor account details are required to request lead creation." });
    }
    if (!name || !phone) {
      return res.status(400).json({ message: "Lead name and phone are required." });
    }
    if (pipeline === "workshop" && !workshop) {
      return res.status(400).json({ message: "Workshop name is required for workshop calling requests." });
    }
    if (pipeline === MAIN_ADMISSION_PIPELINE && !courseName) {
      return res.status(400).json({ message: "Course name is required for main admission calling requests." });
    }

    const pendingRequests = await leadCreationRequestsCollection.find({
      requesterEmail,
      status: "pending"
    }).toArray();
    const duplicatePending = (Array.isArray(pendingRequests) ? pendingRequests : []).find((request) => {
      const normalized = normalizeLeadCreationRequestDoc(request);
      const sameEmail = email && normalized.email === email;
      const samePhone = normalizeLeadPhone(normalized.phone) && normalizeLeadPhone(normalized.phone) === normalizeLeadPhone(phone);
      return normalized.pipeline === pipeline && (sameEmail || samePhone);
    });
    if (duplicatePending) {
      return res.status(409).json({ message: "You already have a pending lead creation request for this contact." });
    }

    const now = new Date().toISOString();
    const requestDoc = normalizeLeadCreationRequestDoc({
      id: `lead-request-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
      status: "pending",
      pipeline,
      name,
      email,
      phone,
      workshop,
      courseName,
      source,
      notes,
      requesterName,
      requesterEmail,
      createdAt: now,
      updatedAt: now
    });

    await leadCreationRequestsCollection.insertOne(requestDoc);
    await createNotification({
      userId: "admin",
      role: "admin",
      type: "lead_creation_requested",
      title: "Lead Creation Request",
      message: `${requesterName} requested a new ${getLeadCreationTargetLabel(requestDoc)} lead for ${name}.`,
      sound: true,
      leadName: name,
      toCounselor: requesterName
    });

    return res.status(201).json({ ok: true, request: serializeLeadCreationRequest(requestDoc) });
  } catch (error) {
    return res.status(500).json({ message: "Failed to submit lead creation request", details: error.message });
  }
});

app.patch("/api/lead-creation-requests/:requestId/decision", async (req, res) => {
  try {
    const session = await requireRole(req, res, "admin");
    if (!session) return;

    const requestId = String(req.params.requestId || "").trim();
    const decision = normalizeClaimDecision(req.body?.decision);
    const note = String(req.body?.note || "").trim();
    if (!requestId || !decision) {
      return res.status(400).json({ message: "Request and decision are required." });
    }

    const existingRequest = await leadCreationRequestsCollection.findOne({ id: requestId });
    if (!existingRequest) {
      return res.status(404).json({ message: "Lead creation request not found." });
    }

    const requestDoc = normalizeLeadCreationRequestDoc(existingRequest);
    if (requestDoc.status !== "pending") {
      return res.status(409).json({ message: "This lead creation request has already been closed." });
    }

    const now = new Date().toISOString();
    const updates = {
      status: decision,
      decidedAt: now,
      decidedBy: session.name || session.email || session.role,
      updatedAt: now,
      ...(decision === "rejected" ? { rejectionReason: note || null } : {})
    };

    let newLead = null;
    if (decision === "approved") {
      const nextId = await getNextMetaLeadId();
      const leadDraft = buildApprovedLeadFromCreationRequest({ ...requestDoc, ...updates }, nextId, now);
      const state = await getStateDoc();
      const duplicateLead = findLeadCreationDuplicate(state.leads, leadDraft);
      if (duplicateLead) {
        return res.status(409).json({
          message: "A matching lead already exists in this calling section.",
          leadId: duplicateLead.id || null
        });
      }

      await withMongoRetry(
        () => leadsCollection.insertOne(leadDraft),
        { retries: 1, label: "Create approved lead request" }
      );
      await recordActivity({
        leadId: leadDraft.id,
        leadName: leadDraft.name,
        counselorName: leadDraft.counselor || "",
        activityType: "Lead Created",
        actionDescription: `Lead created after admin approval for ${getLeadCreationTargetLabel(requestDoc)}`,
        newValue: `Name: ${leadDraft.name}, Phone: ${leadDraft.phone}, Email: ${leadDraft.email}`,
        session
      });
      if (leadDraft.counselor && leadDraft.counselor.toLowerCase() !== "unassigned") {
        await recordActivity({
          leadId: leadDraft.id,
          leadName: leadDraft.name,
          counselorName: leadDraft.counselor,
          activityType: "Lead Assigned",
          actionDescription: `Lead initially assigned to requester ${leadDraft.counselor}`,
          newValue: leadDraft.counselor,
          session
        });
      }
      updates.requestedLeadId = String(leadDraft.id);
      newLead = leadDraft;
      await touchStateUpdatedAt(now);
    }

    await leadCreationRequestsCollection.updateOne(
      { id: requestId },
      { $set: updates }
    );

    await createNotification({
      userId: requestDoc.requesterEmail,
      role: "counselor",
      type: decision === "approved" ? "lead_creation_approved" : "lead_creation_rejected",
      title: decision === "approved" ? "Lead Request Approved" : "Lead Request Rejected",
      message: decision === "approved"
        ? `Your lead creation request for ${requestDoc.name} was approved.`
        : `Your lead creation request for ${requestDoc.name} was rejected.`,
      sound: true,
      leadId: newLead?.id || null,
      leadName: requestDoc.name,
      assignedCounselor: requestDoc.requesterName
    });

    const response = {
      ok: true,
      request: serializeLeadCreationRequest({ ...requestDoc, ...updates })
    };
    if (newLead) {
      const nextState = await refreshStateAfterAtomicUpdate();
      res.setHeader("ETag", buildStateEtag(nextState));
      response.state = buildStateResponse(nextState);
      response.lead = newLead;
    }

    return res.json(response);
  } catch (error) {
    return res.status(500).json({ message: "Failed to update lead creation request", details: error.message });
  }
});

app.get("/api/lead-claims", async (req, res) => {
  try {
    const session = await requireRole(req, res, ["admin", "counselor"]);
    if (!session) return;

    const claims = await leadClaimsCollection.find({}).sort({ createdAt: -1 }).toArray();
    const visibleClaims = (Array.isArray(claims) ? claims : [])
      .map(serializeLeadClaim)
      .filter((claim) => isClaimVisibleToSession(claim, session))
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));

    return res.json({ ok: true, claims: visibleClaims });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch lead claims", details: error.message });
  }
});

app.delete("/api/lead-claims", async (req, res) => {
  try {
    const session = await requireRole(req, res, "admin");
    if (!session) return;

    const result = await leadClaimsCollection.deleteMany({});
    return res.json({ ok: true, deletedCount: result.deletedCount || 0 });
  } catch (error) {
    return res.status(500).json({ message: "Failed to clear lead claims", details: error.message });
  }
});

app.post("/api/lead-claims", async (req, res) => {
  try {
    const session = await requireRole(req, res, "counselor");
    if (!session) return;

    const leadId = String(req.body?.leadId || "").trim();
    const leadEmail = String(req.body?.leadEmail || "").trim().toLowerCase();
    const reason = String(req.body?.reason || "").trim();

    if (!leadId || !reason) {
      return res.status(400).json({ message: "Lead and formal claim reason are required." });
    }
    if (reason.length < 12) {
      return res.status(400).json({ message: "Please enter a more detailed formal reason for this claim." });
    }

    const state = await getStateDoc();
    const lead = findLeadByIdentity(state, leadId, leadEmail);
    if (!lead) {
      return res.status(404).json({ message: "Lead not found." });
    }

    const requesterName = getSessionCounselorName(state, session);
    const requesterEmail = String(session.email || "").trim().toLowerCase();
    const currentOwnerName = String(lead.counselor || "").trim();
    const currentOwnerEmail = getCounselorEmailByName(state, currentOwnerName);

    if (!requesterName || !requesterEmail) {
      return res.status(403).json({ message: "Counselor account details are required to raise a claim." });
    }
    if (!currentOwnerName || currentOwnerName.toLowerCase() === "unassigned") {
      return res.status(400).json({ message: "Claims can only be raised for leads assigned to another counselor." });
    }
    if (currentOwnerName.toLowerCase() === requesterName.toLowerCase() || currentOwnerEmail === requesterEmail) {
      return res.status(400).json({ message: "You already hold this lead." });
    }

    const existingClaims = await leadClaimsCollection.find({}).toArray();
    const duplicateClaim = (Array.isArray(existingClaims) ? existingClaims : []).find((claim) => {
      const normalized = normalizeLeadClaimDoc(claim);
      return normalized.status === "pending" &&
        normalized.leadId === String(lead.id || "").trim() &&
        normalized.requesterEmail === requesterEmail;
    });

    if (duplicateClaim) {
      return res.status(409).json({ message: "You already have a pending claim for this lead." });
    }

    const now = new Date().toISOString();
    const claim = normalizeLeadClaimDoc({
      id: `claim-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
      leadId: lead.id,
      leadName: lead.name || "",
      leadEmail: lead.email || "",
      leadPhone: lead.phone || "",
      leadWorkshop: lead.workshop || lead.courseName || lead.coursePitched || "",
      leadCreatedAt: lead.createdAt || "",
      currentOwnerName,
      currentOwnerEmail,
      requesterName,
      requesterEmail,
      reason,
      createdAt: now,
      updatedAt: now
    });

    await leadClaimsCollection.insertOne(claim);

    await createNotification({
      userId: "admin",
      role: "admin",
      type: "lead_claim_raised",
      title: "Lead Claim Raised",
      message: `${requesterName} requested ${formatLeadNotificationLabel(lead)} from ${currentOwnerName}.`,
      sound: true,
      leadId: lead.id,
      leadName: lead.name,
      fromCounselor: currentOwnerName,
      toCounselor: requesterName
    });

    if (currentOwnerEmail) {
      await createNotification({
        userId: currentOwnerEmail,
        role: "counselor",
        type: "lead_claim_against",
        title: "Lead Claim Approval Needed",
        message: `${requesterName} has raised a claim for your lead ${formatLeadNotificationLabel(lead)}.`,
        sound: true,
        leadId: lead.id,
        leadName: lead.name,
        fromCounselor: currentOwnerName,
        toCounselor: requesterName
      });
    }

    await recordActivity({
      leadId: lead.id,
      leadName: lead.name,
      counselorName: currentOwnerName,
      activityType: "Lead Claim Raised",
      actionDescription: `${requesterName} raised a claim request for this lead`,
      newValue: reason,
      session
    });

    return res.status(201).json({ ok: true, claim: serializeLeadClaim(claim) });
  } catch (error) {
    return res.status(500).json({ message: "Failed to raise lead claim", details: error.message });
  }
});

app.patch("/api/lead-claims/:claimId/decision", async (req, res) => {
  try {
    const session = await requireRole(req, res, ["admin", "counselor"]);
    if (!session) return;

    const claimId = String(req.params.claimId || "").trim();
    const decision = normalizeClaimDecision(req.body?.decision);
    const note = String(req.body?.note || "").trim();

    if (!claimId || !decision) {
      return res.status(400).json({ message: "Claim and decision are required." });
    }

    const existingClaim = await leadClaimsCollection.findOne({ id: claimId });
    if (!existingClaim) {
      return res.status(404).json({ message: "Claim request not found." });
    }

    const state = await getStateDoc();
    const claim = normalizeLeadClaimDoc(existingClaim);
    if (claim.status !== "pending") {
      return res.status(409).json({ message: "This claim request has already been closed." });
    }

    const now = new Date().toISOString();
    const updates = { updatedAt: now };
    const actorLabel = session.name || session.email || session.role;

    if (session.role === "admin") {
      updates.adminStatus = decision;
      updates.adminDecidedAt = now;
      updates.adminDecidedBy = actorLabel;
    } else {
      const ownerEmail = String(claim.currentOwnerEmail || "").trim().toLowerCase();
      const sessionEmail = String(session.email || "").trim().toLowerCase();
      const ownerName = String(claim.currentOwnerName || "").trim().toLowerCase();
      const sessionCounselorName = getSessionCounselorName(state, session).toLowerCase();
      if (
        (!ownerEmail || ownerEmail !== sessionEmail) &&
        (!ownerName || ownerName !== sessionCounselorName)
      ) {
        return res.status(403).json({ message: "Only the counselor currently holding the lead can approve this claim." });
      }
      updates.ownerStatus = decision;
      updates.ownerDecidedAt = now;
      updates.ownerDecidedBy = actorLabel;
    }

    if (decision === "rejected") {
      updates.status = "rejected";
      updates.rejectedAt = now;
      updates.rejectionReason = note || null;
    }

    const nextAdminStatus = updates.adminStatus || claim.adminStatus;
    const nextOwnerStatus = updates.ownerStatus || claim.ownerStatus;
    const shouldTransfer = decision === "approved" && nextAdminStatus === "approved" && nextOwnerStatus === "approved";
    let transferredLead = null;

    if (shouldTransfer) {
      const lead = findLeadByIdentity(state, claim.leadId, claim.leadEmail);
      if (!lead) {
        return res.status(404).json({ message: "The claimed lead no longer exists." });
      }

      const currentLeadOwner = String(lead.counselor || "").trim();
      if (currentLeadOwner.toLowerCase() !== claim.currentOwnerName.toLowerCase()) {
        updates.status = "rejected";
        updates.rejectedAt = now;
        updates.rejectionReason = "Lead owner changed before both approvals were completed.";
      } else {
        const result = await leadsCollection.updateOne(
          { id: { $in: getLeadIdCandidates(claim.leadId) }, counselor: currentLeadOwner },
          { $set: getLeadAssignmentResetPatch(lead, claim.requesterName, now) }
        );

        if (!result.modifiedCount && !result.matchedCount) {
          return res.status(409).json({ message: "Lead changed before the claim could be completed. Please reload and retry." });
        }

        updates.status = "approved";
        updates.completedAt = now;
        transferredLead = lead;
        await touchStateUpdatedAt(now);

        await recordActivity({
          leadId: lead.id,
          leadName: lead.name,
          counselorName: claim.requesterName,
          activityType: "Lead Claim Approved",
          actionDescription: `Lead reassigned from ${claim.currentOwnerName} to ${claim.requesterName} after admin and owner approval`,
          previousValue: claim.currentOwnerName,
          newValue: claim.requesterName,
          remarks: claim.reason,
          session
        });
      }
    }

    await leadClaimsCollection.updateOne(
      { id: claimId },
      { $set: updates }
    );

    const nextClaim = serializeLeadClaim({
      ...claim,
      ...updates
    });

    if (decision === "rejected") {
      await createNotification({
        userId: claim.requesterEmail,
        role: "counselor",
        type: "lead_claim_rejected",
        title: "Lead Claim Rejected",
        message: `Your claim for ${claim.leadName || "a lead"} was rejected.`,
        sound: true,
        leadId: claim.leadId,
        leadName: claim.leadName,
        fromCounselor: claim.currentOwnerName,
        toCounselor: claim.requesterName
      });
    } else if (nextClaim.status === "approved") {
      await Promise.all([
        createNotification({
          userId: claim.requesterEmail,
          role: "counselor",
          type: "lead_claim_approved",
          title: "Lead Claim Approved",
          message: `${claim.leadName || "Lead"} has been transferred to you.`,
          sound: true,
          leadId: claim.leadId,
          leadName: claim.leadName,
          fromCounselor: claim.currentOwnerName,
          toCounselor: claim.requesterName
        }),
        claim.currentOwnerEmail ? createNotification({
          userId: claim.currentOwnerEmail,
          role: "counselor",
          type: "lead_claim_completed",
          title: "Lead Claim Completed",
          message: `${claim.leadName || "Lead"} has been transferred to ${claim.requesterName}.`,
          sound: true,
          leadId: claim.leadId,
          leadName: claim.leadName,
          fromCounselor: claim.currentOwnerName,
          toCounselor: claim.requesterName
        }) : Promise.resolve()
      ]);
    }

    const response = { ok: true, claim: nextClaim };
    if (transferredLead || nextClaim.status === "approved") {
      const nextState = await refreshStateAfterAtomicUpdate();
      res.setHeader("ETag", buildStateEtag(nextState));
      response.state = buildStateResponse(nextState);
    }

    return res.json(response);
  } catch (error) {
    return res.status(500).json({ message: "Failed to update lead claim", details: error.message });
  }
});

app.post("/api/tasks", async (req, res) => {
  try {
    const session = await requireRole(req, res, ["admin", "counselor"]);
    if (!session) return;

    const task = normalizeTaskDoc({
      ...(req.body || {}),
      counselor: req.body?.counselor || session.name || ""
    });
    const state = await getStateDoc();

    if (session.role === "counselor" && !canMutateTask(session, state, task)) {
      return res.status(403).json({ message: "Counselors can only create tasks assigned to themselves." });
    }

    const result = await tasksCollection.insertOne(task);

    if (!result.insertedId) {
      return res.status(409).json({ message: "Task could not be created. Please reload and retry." });
    }

    await recordActivity({
      leadId: task.leadId,
      leadName: task.leadName,
      counselorName: task.leadCounselor || task.counselor || "",
      activityType: "Follow-Up Added",
      actionDescription: `Follow-up task created: "${task.title}" (Due: ${task.dueDate})`,
      newValue: `Title: ${task.title}, Due: ${task.dueDate}, Notes: ${task.notes || "None"}`,
      session
    });

    const now = new Date().toISOString();
    await stateCollection.updateOne(
      { _id: STATE_DOC_ID },
      { $set: { updatedAt: now } },
      { upsert: true }
    );

    const nextState = await refreshStateAfterAtomicUpdate();
    res.setHeader("ETag", buildStateEtag(nextState));
    return res.json({ ok: true, task, state: buildStateResponse(nextState) });
  } catch (error) {
    return res.status(500).json({ message: "Failed to create task", details: error.message });
  }
});

app.patch("/api/tasks/:taskId", async (req, res) => {
  try {
    const session = await requireRole(req, res, ["admin", "counselor"]);
    if (!session) return;

    const taskId = String(req.params.taskId || "").trim();
    const state = await getStateDoc();
    const existingTask = findTaskById(state, taskId);
    if (!existingTask) {
      return res.status(404).json({ message: "Task not found." });
    }
    if (!canMutateTask(session, state, existingTask)) {
      return res.status(403).json({ message: "You can only update your assigned tasks." });
    }

    const allowedFields = ["title", "notes", "dueDate"];
    const updates = sanitizeLeadPatch(req.body || {}, allowedFields);
    if (!Object.keys(updates).length) {
      return res.status(400).json({ message: "No valid task fields provided." });
    }
    if (Object.prototype.hasOwnProperty.call(updates, "dueDate")) {
      updates.dueDate = normalizeTaskDueDateValue(updates.dueDate);
      updates.reminderSentAt = null;
    }
    updates.updatedAt = new Date().toISOString();

    const result = await tasksCollection.updateOne(
      { id: taskId },
      { $set: updates }
    );

    if (!result.modifiedCount) {
      return res.status(409).json({ message: "Task changed before it could be updated. Please reload and retry." });
    }

    const now = new Date().toISOString();
    await stateCollection.updateOne(
      { _id: STATE_DOC_ID },
      { $set: { updatedAt: now } },
      { upsert: true }
    );

    const nextState = await refreshStateAfterAtomicUpdate();
    const task = findTaskById(nextState, taskId);
    res.setHeader("ETag", buildStateEtag(nextState));
    return res.json({ ok: true, task, state: buildStateResponse(nextState) });
  } catch (error) {
    return res.status(500).json({ message: "Failed to update task", details: error.message });
  }
});

app.delete("/api/tasks/:taskId", async (req, res) => {
  try {
    const session = await requireRole(req, res, ["admin", "counselor"]);
    if (!session) return;

    const taskId = String(req.params.taskId || "").trim();
    const state = await getStateDoc();
    const existingTask = findTaskById(state, taskId);
    if (!existingTask) {
      return res.status(404).json({ message: "Task not found." });
    }
    if (!canMutateTask(session, state, existingTask)) {
      return res.status(403).json({ message: "You can only remove your assigned tasks." });
    }

    const result = await tasksCollection.deleteOne({ id: taskId });

    if (!result.deletedCount) {
      return res.status(409).json({ message: "Task changed before it could be removed. Please reload and retry." });
    }

    const isCompleted = req.query.completed === "true";
    const activityType = isCompleted ? "Follow-Up Completed" : "Follow-Up Removed";
    const actionDescription = isCompleted
      ? `Follow-up task completed: "${existingTask.title}"`
      : `Follow-up task removed: "${existingTask.title}"`;

    await recordActivity({
      leadId: existingTask.leadId,
      leadName: existingTask.leadName,
      counselorName: existingTask.leadCounselor || existingTask.counselor || "",
      activityType,
      actionDescription,
      previousValue: `Title: ${existingTask.title}, Due: ${existingTask.dueDate}`,
      session
    });

    const now = new Date().toISOString();
    await stateCollection.updateOne(
      { _id: STATE_DOC_ID },
      { $set: { updatedAt: now } },
      { upsert: true }
    );

    const nextState = await refreshStateAfterAtomicUpdate();
    res.setHeader("ETag", buildStateEtag(nextState));
    return res.json({ ok: true, state: buildStateResponse(nextState) });
  } catch (error) {
    return res.status(500).json({ message: "Failed to remove task", details: error.message });
  }
});

app.get("/api/state", async (req, res) => {
  try {
    const session = await requireSession(req, res);
    if (!session) return;

    const state = await getStateDoc();
    // Use updatedAt as a cheap ETag so clients can send If-None-Match and get
    // a 304 Not Modified when nothing has changed — avoiding re-transferring
    // the full (potentially 200 KB) payload on every 15 s poll.
    const etag = buildStateEtag(state);
    res.setHeader("ETag", etag);
    res.setHeader("Cache-Control", "no-cache"); // allow conditional GET, no blind caching
    if (req.headers["if-none-match"] === etag) {
      return res.status(304).end();
    }
    res.json(buildStateResponse(state));
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch state", details: error.message });
  }
});

app.get("/api/state/version", async (req, res) => {
  try {
    const session = await requireSession(req, res);
    if (!session) return;

    const state = await getStateDoc();
    const version = buildStateVersionResponse(state);
    res.setHeader("ETag", version.etag);
    res.setHeader("Cache-Control", "no-cache");
    if (req.headers["if-none-match"] === version.etag) {
      return res.status(304).end();
    }
    return res.json(version);
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch state version", details: error.message });
  }
});

app.get("/api/dashboard-summary", async (req, res) => {
  try {
    const session = await requireSession(req, res);
    if (!session) return;

    const state = await getStateDoc();
    return res.json(buildDashboardSummary(state));
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch dashboard summary", details: error.message });
  }
});

app.get("/api/monitoring-summary", async (req, res) => {
  try {
    const session = await requireSession(req, res);
    if (!session) return;

    const state = await getStateDoc();
    return res.json(buildMonitoringSummary(state));
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch monitoring summary", details: error.message });
  }
});

app.put("/api/state", async (req, res) => {
  try {
    const session = await requireRole(req, res, ["admin", "counselor"]);
    if (!session) return;

    const sanitized = sanitizeState(req.body || {});
    if (!Object.keys(sanitized).length) {
      return res.status(400).json({ message: "No valid state fields provided." });
    }

    if (session.role === "counselor") {
      const invalidFields = Object.keys(sanitized).filter((field) => field !== "tasks");
      if (invalidFields.length) {
        return res.status(403).json({ message: "Counselors can only update tasks through the shared state route." });
      }
    }

    if (
      ["counselors", "adminUsers", "marketingUsers", "allocation"].some((field) => Array.isArray(sanitized[field]))
      && !canManageRoles(session)
    ) {
      return res.status(403).json({ message: "You do not have permission to change role and access settings." });
    }

    const currentState = await getStateDoc();
    if (Array.isArray(sanitized.leads)) {
      const duplicateViolation = findLeadDuplicateViolation(sanitized.leads, currentState.leads);
      if (duplicateViolation) {
        return res.status(409).json({
          message: `Duplicate lead rejected: ${duplicateViolation.field} already exists.`,
          field: duplicateViolation.field,
          leadId: duplicateViolation.lead?.id || null
        });
      }
    }
    const preparedLeads = Array.isArray(sanitized.leads)
      ? decorateLeadListForStorage(sanitized.leads)
      : null;
    const expectedEtag = String(req.headers["if-match"] || "").trim();
    const currentEtag = buildStateEtag(currentState);

    if (expectedEtag && expectedEtag !== currentEtag) {
      return res.status(412).json({
        message: "State changed on the server. Reload the latest data and retry your update.",
        updatedAt: currentState.updatedAt || null
      });
    }

    const now = new Date().toISOString();
    if (Array.isArray(sanitized.leads)) {
      const currentLeads = Array.isArray(currentState.leads) ? currentState.leads : [];
      await logBulkLeadChanges(currentLeads, preparedLeads, session);
      await leadsCollection.deleteMany({});
      if (preparedLeads.length) {
        await leadsCollection.insertMany(preparedLeads);
        await syncLeadSequence().catch(() => undefined);
      }
    }
    if (Array.isArray(sanitized.counselors)) {
      await counselorsCollection.deleteMany({});
      if (sanitized.counselors.length) await counselorsCollection.insertMany(sanitized.counselors);
    }
    if (Array.isArray(sanitized.tasks)) {
      await tasksCollection.deleteMany({});
      if (sanitized.tasks.length) await tasksCollection.insertMany(sanitized.tasks);
    }
    if (Array.isArray(sanitized.allocation)) {
      await allocationCollection.deleteMany({});
      if (sanitized.allocation.length) await allocationCollection.insertMany(sanitized.allocation);
    }

    const updatePatch = { updatedAt: now };
    if (Array.isArray(sanitized.adminUsers)) {
      updatePatch.adminUsers = sanitized.adminUsers;
    }
    if (Array.isArray(sanitized.marketingUsers)) {
      updatePatch.marketingUsers = sanitized.marketingUsers;
    }
    await stateCollection.updateOne(
      { _id: STATE_DOC_ID },
      { $set: updatePatch },
      { upsert: true }
    );

    cachedStateDoc = null;
    cachedStateDocAt = 0;

    const nextState = await getStateDoc();
    res.setHeader("ETag", buildStateEtag(nextState));
    return res.json(buildStateResponse(nextState));
  } catch (error) {
    return res.status(500).json({ message: "Failed to update state", details: error.message });
  }
});

app.put("/api/state/reset", async (req, res) => {
  try {
    const session = await requireRole(req, res, "admin");
    if (!session) return;

    const now = new Date().toISOString();
    await Promise.all([
      leadsCollection.deleteMany({}),
      allocationCollection.deleteMany({}),
      tasksCollection.deleteMany({})
    ]);

    await stateCollection.updateOne(
      { _id: STATE_DOC_ID },
      {
        $set: {
          updatedAt: now,
          clearedAt: now
        }
      },
      { upsert: true }
    );

    cachedStateDoc = null;
    cachedStateDocAt = 0;
    const nextState = await getStateDoc();

    return res.json(buildStateResponse(nextState));
  } catch (error) {
    return res.status(500).json({ message: "Failed to reset state", details: error.message });
  }
});

app.get("/api/leads", async (req, res) => {
  try {
    const session = await requireSession(req, res);
    if (!session) return;

    const state = await getStateDoc();
    res.json(Array.isArray(state.leads) ? state.leads : []);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch leads", details: error.message });
  }
});

function escapeRegExp(string) {
  return String(string || "").replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

app.get("/api/activity-logs", async (req, res) => {
  try {
    const session = await requireSession(req, res);
    if (!session) return;

    const state = await getStateDoc();
    const query = {};

    const targetLeadId = String(req.query.leadId || "").trim();
    let leadIdsToQuery = null;

    if (targetLeadId) {
      const lead = findLeadByIdentity(state, targetLeadId);
      if (!lead) {
        leadIdsToQuery = [targetLeadId];
      } else {
        const relatedIds = [lead.id];
        const email = String(lead.email || "").trim().toLowerCase();
        const phone = String(lead.phone || "").trim();
        const allLeads = Array.isArray(state?.leads) ? state.leads : [];
        allLeads.forEach((otherLead) => {
          if (otherLead && otherLead.id && otherLead.id !== lead.id) {
            const otherEmail = String(otherLead.email || "").trim().toLowerCase();
            const otherPhone = String(otherLead.phone || "").trim();
            const emailMatch = email && otherEmail && email === otherEmail;
            const phoneMatch = phone && otherPhone && phone === otherPhone;
            if (emailMatch || phoneMatch) {
              relatedIds.push(otherLead.id);
            }
          }
        });
        leadIdsToQuery = [...new Set(relatedIds.map((id) => String(id)))];
      }
    }

    // 1. Enforce counselor scoping permissions
    if (session.role === "counselor") {
      const counselorName = getSessionCounselorName(state, session);
      if (targetLeadId) {
        const lead = findLeadByIdentity(state, targetLeadId);
        if (!lead || !canViewLeadActivity(session, state, lead)) {
          return res.status(403).json({ message: "Access denied. You can only view activity logs of leads assigned to you." });
        }
        query.leadId = { $in: leadIdsToQuery };
      } else {
        query.$or = [
          { counselorName: { $regex: new RegExp("^" + escapeRegExp(counselorName) + "$", "i") } },
          { performedBy: { $regex: new RegExp("^" + escapeRegExp(session.name || session.email || "") + "$", "i") } }
        ];
      }
    } else if (session.role === "super_admin" || session.role === "admin" || session.role === "marketing") {
      if (targetLeadId) {
        query.leadId = { $in: leadIdsToQuery };
      }
    } else {
      return res.status(403).json({ message: "Access denied." });
    }

    // 2. Parse extra filters
    const { startDate, endDate, counselorName, activityType, performedBy, search } = req.query;

    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = String(startDate);
      if (endDate) query.date.$lte = String(endDate);
    }

    if (counselorName) {
      query.counselorName = { $regex: new RegExp("^" + escapeRegExp(String(counselorName).trim()) + "$", "i") };
    }

    if (activityType) {
      query.activityType = String(activityType).trim();
    }

    if (performedBy) {
      query.performedBy = { $regex: new RegExp(escapeRegExp(String(performedBy).trim()), "i") };
    }

    if (search) {
      const escapedSearch = escapeRegExp(String(search).trim());
      query.$and = query.$and || [];
      query.$and.push({
        $or: [
          { actionDescription: { $regex: new RegExp(escapedSearch, "i") } },
          { leadName: { $regex: new RegExp(escapedSearch, "i") } },
          { remarks: { $regex: new RegExp(escapedSearch, "i") } }
        ]
      });
    }

    // 3. Pagination
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const logs = await activityLogsCollection
      .find(query)
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    const total = await activityLogsCollection.countDocuments(query);

    res.json({
      logs,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch activity logs", details: error.message });
  }
});

app.put("/api/leads", async (req, res) => {
  try {
    const session = await requireRole(req, res, ["admin", "counselor"]);
    if (!session) return;

    if (!Array.isArray(req.body)) {
      return res.status(400).json({ message: "Leads payload must be an array." });
    }

    const currentState = await getStateDoc();
    const duplicateViolation = findLeadDuplicateViolation(req.body, currentState.leads);
    if (duplicateViolation) {
      return res.status(409).json({
        message: `Duplicate lead rejected: ${duplicateViolation.field} already exists.`,
        field: duplicateViolation.field,
        leadId: duplicateViolation.lead?.id || null
      });
    }
     const preparedLeads = decorateLeadListForStorage(req.body);
     const currentLeads = Array.isArray(currentState.leads) ? currentState.leads : [];
     await logBulkLeadChanges(currentLeads, preparedLeads, session);
     const now = new Date().toISOString();
     await leadsCollection.deleteMany({});
     if (preparedLeads.length) {
       await leadsCollection.insertMany(preparedLeads);
       await syncLeadSequence().catch(() => undefined);
     }
    await stateCollection.updateOne(
      { _id: STATE_DOC_ID },
      { $set: { updatedAt: now } },
      { upsert: true }
    );
    cachedStateDoc = null;
    cachedStateDocAt = 0;
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ message: "Failed to save leads", details: error.message });
  }
});

app.get("/api/counselors", async (req, res) => {
  try {
    const session = await requireSession(req, res);
    if (!session) return;

    const state = await getStateDoc();
    res.json(Array.isArray(state.counselors) ? state.counselors : []);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch counselors", details: error.message });
  }
});

app.put("/api/counselors", async (req, res) => {
  try {
    const session = await requireRole(req, res, "admin");
    if (!session) return;

    if (!Array.isArray(req.body)) {
      return res.status(400).json({ message: "Counselors payload must be an array." });
    }

    const currentState = await getStateDoc();
    const nextCounselors = preserveCounselorRoutingFields(req.body, currentState.counselors);
    const now = new Date().toISOString();
    await counselorsCollection.deleteMany({});
    if (nextCounselors.length) {
      await counselorsCollection.insertMany(nextCounselors);
    }
    await stateCollection.updateOne(
      { _id: STATE_DOC_ID },
      { $set: { updatedAt: now } },
      { upsert: true }
    );
    cachedStateDoc = null;
    cachedStateDocAt = 0;
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ message: "Failed to save counselors", details: error.message });
  }
});

app.put("/api/admin-users", async (req, res) => {
  try {
    const session = await requireRole(req, res, "admin");
    if (!session) return;

    if (!Array.isArray(req.body)) {
      return res.status(400).json({ message: "Admin users payload must be an array." });
    }

    const now = new Date().toISOString();
    await stateCollection.updateOne(
      { _id: STATE_DOC_ID },
      {
        $set: {
          adminUsers: req.body,
          updatedAt: now
        }
      },
      { upsert: true }
    );

    cachedStateDoc = null;
    cachedStateDocAt = 0;
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ message: "Failed to save admin users", details: error.message });
  }
});

app.put("/api/marketing-users", async (req, res) => {
  try {
    const session = await requireRole(req, res, "admin");
    if (!session) return;

    if (!Array.isArray(req.body)) {
      return res.status(400).json({ message: "Marketing users payload must be an array." });
    }

    const now = new Date().toISOString();
    await stateCollection.updateOne(
      { _id: STATE_DOC_ID },
      {
        $set: {
          marketingUsers: req.body,
          updatedAt: now
        }
      },
      { upsert: true }
    );

    cachedStateDoc = null;
    cachedStateDocAt = 0;
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ message: "Failed to save marketing users", details: error.message });
  }
});

app.put("/api/counselors/rotation", async (req, res) => {
  try {
    const session = await requireRole(req, res, "admin");
    if (!session) return;

    const counselorId = String(req.body?.counselorId || "").trim();
    const field = String(req.body?.field || "roundRobinEnabled").trim();
    const enabled = typeof req.body?.enabled === "boolean" ? req.body.enabled : null;
    const allowedFields = new Set(["roundRobinEnabled", "admissionRoundRobinEnabled", "admissionCoursePermissions"]);

    if (!counselorId) {
      return res.status(400).json({ message: "Counselor ID is required." });
    }
    if (!allowedFields.has(field)) {
      return res.status(400).json({ message: "Unsupported rotation field." });
    }
    if (field !== "admissionCoursePermissions" && enabled == null) {
      return res.status(400).json({ message: "Enabled flag is required." });
    }
    if (field === "admissionCoursePermissions" && !Array.isArray(req.body?.admissionCoursePermissions)) {
      return res.status(400).json({ message: "Course permissions must be an array." });
    }

    const counselors = await withMongoRetry(
      () => counselorsCollection.find({}).toArray(),
      { retries: 1, label: "Load counselors for rotation update" }
    );

    const existingCounselor = (Array.isArray(counselors) ? counselors : []).find((counselor) => {
      const id = String(counselor?.id || counselor?.email || "").trim();
      return id === counselorId;
    });

    if (!existingCounselor) {
      return res.status(404).json({ message: "Counselor not found." });
    }

    const nextCounselor = {
      ...existingCounselor,
      [field]: field === "admissionCoursePermissions"
        ? normalizeAdmissionCoursePermissionIds(req.body.admissionCoursePermissions)
        : enabled
    };

    await withMongoRetry(
      () => counselorsCollection.replaceOne(
        { email: String(existingCounselor.email || "").trim().toLowerCase() },
        nextCounselor,
        { upsert: false }
      ),
      { retries: 1, label: "Update counselor rotation" }
    );

    const now = new Date().toISOString();
    await stateCollection.updateOne(
      { _id: STATE_DOC_ID },
      { $set: { updatedAt: now } },
      { upsert: true }
    );

    cachedStateDoc = null;
    cachedStateDocAt = 0;
    const nextState = await getStateDoc();
    res.setHeader("ETag", buildStateEtag(nextState));
    return res.json({
      ok: true,
      counselor: nextCounselor,
      state: buildStateResponse(nextState)
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to update counselor rotation", details: error.message });
  }
});

app.get("/api/allocation", async (req, res) => {
  try {
    const session = await requireSession(req, res);
    if (!session) return;

    const state = await getStateDoc();
    res.json(Array.isArray(state.allocation) ? state.allocation : []);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch allocation", details: error.message });
  }
});

app.put("/api/allocation", async (req, res) => {
  try {
    const session = await requireRole(req, res, "admin");
    if (!session) return;

    if (!Array.isArray(req.body)) {
      return res.status(400).json({ message: "Allocation payload must be an array." });
    }

    const currentState = await getStateDoc();
    const now = new Date().toISOString();
    await allocationCollection.deleteMany({});
    if (req.body.length) {
      await allocationCollection.insertMany(req.body);
    }
    await stateCollection.updateOne(
      { _id: STATE_DOC_ID },
      { $set: { updatedAt: now } },
      { upsert: true }
    );
    cachedStateDoc = null;
    cachedStateDocAt = 0;
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ message: "Failed to save allocation", details: error.message });
  }
});

app.get("/api/version", (_req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  const version = process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_URL || "local-development";
  res.json({ version });
});

app.get("/", (_req, res) => {
  res.sendFile(path.join(ROOT_DIR, "index.html"));
});

app.get("/dashboard", (_req, res) => {
  res.sendFile(path.join(ROOT_DIR, "dashboard.html"));
});

app.get("/meta-integration", (_req, res) => {
  res.sendFile(path.join(ROOT_DIR, "meta-integration.html"));
});

app.get("/elementor-integration", (_req, res) => {
  res.sendFile(path.join(ROOT_DIR, "elementor-integration.html"));
});

app.get("/mcube-integration", (_req, res) => {
  res.sendFile(path.join(ROOT_DIR, "mcube-integration.html"));
});

app.get("/reachout", (_req, res) => {
  res.sendFile(path.join(ROOT_DIR, "reachout.html"));
});

app.get("/crash-course", (_req, res) => {
  res.sendFile(path.join(ROOT_DIR, "crash-course.html"));
});

app.get("/crash%20course", (_req, res) => {
  res.sendFile(path.join(ROOT_DIR, "crash-course.html"));
});

async function start() {
  await initMongo();

  app.listen(PORT, () => {
    console.log(`DV Workshop platform is running at http://localhost:${PORT}`);
    console.log(`Mongo dataset: ${MONGODB_DB_NAME}.${MONGODB_STATE_COLLECTION}`);
  });
}

if (require.main === module) {
  start().catch((error) => {
    console.error("Server startup failed:", error.message);
    process.exit(1);
  });
}

async function syncLeadSequence() {
  try {
    const maxLeadDoc = await leadsCollection.find({}, { projection: { id: 1 } })
      .sort({ id: -1 })
      .limit(1)
      .toArray();
    const maxLeadId = maxLeadDoc.length > 0 ? (Number(maxLeadDoc[0].id) || 0) : 0;
    if (maxLeadId > 0) {
      await withMongoRetry(
        () => metaConfigCollection.updateOne(
          { _id: META_CONFIG_DOC_ID },
          { $max: { leadSequence: maxLeadId } },
          { upsert: true }
        ),
        { retries: 1, label: "Sync Meta lead sequence to max ID" }
      );
    }
  } catch (error) {
    console.error("Failed to sync lead sequence:", error.message);
  }
}

async function getNextMetaLeadId() {
  await syncLeadSequence();
  const result = await withMongoRetry(
    () => metaConfigCollection.findOneAndUpdate(
      { _id: META_CONFIG_DOC_ID },
      { $inc: { leadSequence: 1 } },
      { returnDocument: "after", upsert: true }
    ),
    { retries: 1, label: "Advance Meta lead sequence" }
  );

  const nextId = Number(result?.leadSequence) || 0;
  return nextId > 0 ? nextId : Date.now();
}

function getMetaRetryBackoffMs(attempts) {
  if (attempts <= 1) return 60 * 1000;
  if (attempts <= 3) return 3 * 60 * 1000;
  if (attempts <= 6) return 10 * 60 * 1000;
  return 30 * 60 * 1000;
}

function getIntegrationRetryBackoffMs(attempts) {
  if (attempts <= 1) return 60 * 1000;
  if (attempts <= 3) return 3 * 60 * 1000;
  if (attempts <= 6) return 10 * 60 * 1000;
  return 30 * 60 * 1000;
}

async function enqueueMetaRetryJob({
  leadgenId,
  formId,
  pageId,
  reason,
  lastError,
  metaLeadSnapshot = null
}) {
  if (!leadgenId) {
    return;
  }

  const now = new Date();
  await withMongoRetry(
    () => metaRetryCollection.updateOne(
      { leadgenId: String(leadgenId) },
      {
        $set: {
          formId: String(formId || ""),
          pageId: String(pageId || ""),
          reason: String(reason || "unknown"),
          lastError: String(lastError || ""),
          metaLeadSnapshot: metaLeadSnapshot || null,
          updatedAt: now.toISOString(),
          nextAttemptAt: new Date(now.getTime() + 60 * 1000).toISOString()
        },
        $setOnInsert: {
          leadgenId: String(leadgenId),
          attempts: 0,
          createdAt: now.toISOString()
        }
      },
      { upsert: true }
    ),
    { retries: 1, label: "Queue Meta retry job" }
  );
}

async function insertMetaLeadIfNew(leadgenId, newLead) {
  return withMongoRetry(async () => {
    const duplicate = await leadsCollection.findOne({ metaLeadId: String(leadgenId) });
    if (duplicate) {
      return { modifiedCount: 0, upsertedCount: 0 };
    }
    try {
      await leadsCollection.insertOne(decorateLeadForStorage(newLead));
      await recordActivity({
        leadId: newLead.id,
        leadName: newLead.name,
        counselorName: newLead.counselor || "",
        activityType: "Lead Created",
        actionDescription: `Lead created from Meta Webhook (Leadgen ID: ${leadgenId})`,
        newValue: `Name: ${newLead.name}, Phone: ${newLead.phone}, Email: ${newLead.email}`
      });
      if (shouldTreatLeadAsAssigned(newLead.counselor)) {
        await recordActivity({
          leadId: newLead.id,
          leadName: newLead.name,
          counselorName: newLead.counselor,
          activityType: "Lead Assigned",
          actionDescription: `Lead initially assigned to counselor ${newLead.counselor}`,
          newValue: newLead.counselor
        });
      }
    } catch (error) {
      if (Number(error?.code) === 11000) {
        return { modifiedCount: 0, upsertedCount: 0 };
      }
      throw error;
    }
    const now = new Date().toISOString();
    await stateCollection.updateOne(
      { _id: STATE_DOC_ID },
      { $set: { updatedAt: now } },
      { upsert: true }
    );
    return { modifiedCount: 1, upsertedCount: 1 };
  }, { retries: 1, label: "Create Meta lead" });
}

async function processMetaLeadRecord({ leadgenId, formId, pageId, metaLead, retryJobId = null }) {
  const snapshot = await getMetaProcessingSnapshot();
  const metaInfo = {
    leadgenId,
    formId,
    adId: metaLead.ad_id,
    adName: metaLead.ad_name,
    adsetName: metaLead.adset_name,
    campaignName: metaLead.campaign_name
  };
  const metaFields = getMetaLeadFieldMap(metaLead.field_data);
  const leadType = classifyIncomingMetaLead(metaFields, metaInfo);
  const inferredAdmissionBranch = inferLeadBranchFromText(
    metaFields.city,
    metaFields.branch,
    metaFields.location,
    metaFields.state,
    metaFields.centre,
    metaFields.center,
    metaFields.preferred_city,
    metaFields.preferred_location,
    metaFields.preferred_state,
    metaFields.address,
    metaFields.page_url,
    metaInfo.adName,
    metaInfo.adsetName,
    metaInfo.campaignName
  );
  const inferredAdmissionCourse = String(
    metaFields.course ||
    metaFields.course_name ||
    metaFields.program ||
    metaFields.workshop ||
    metaFields.workshop_name ||
    metaFields.workshop_title ||
    metaFields.workshop_topic ||
    metaInfo.adsetName ||
    metaInfo.adName ||
    metaInfo.campaignName ||
    ""
  ).trim();
  const forcedAdmissionCourseIdentity = buildCourseIdentity(inferredAdmissionCourse, {
    metaAdName: metaInfo.adName,
    metaAdsetName: metaInfo.adsetName,
    metaCampaignName: metaInfo.campaignName
  });
  const isAdmissionLead = leadType === "admission" || isKnownPublicCourseIdentity(forcedAdmissionCourseIdentity);
  const effectiveLeadType = isAdmissionLead ? "admission" : leadType;
  const counselorName = isAdmissionLead
    ? "Unassigned"
    : await assignCounselorRoundRobin(snapshot.counselors);
  const nextId = await getNextMetaLeadId();
  const newLead = buildMetaLead(
    metaLead.field_data,
    metaInfo,
    counselorName,
    nextId,
    { leadType: effectiveLeadType }
  );
  const duplicateLead = findDuplicateLeadByEmailOrPhone(snapshot.leads, newLead);
  if (duplicateLead) {
    if (retryJobId) {
      await withMongoRetry(
        () => metaRetryCollection.deleteOne({ _id: retryJobId }),
        { retries: 1, label: "Delete duplicate Meta retry job" }
      );
    }
    const updatedLead = await updateExistingIntegrationLead(duplicateLead, newLead, {
      source: "Meta"
    });
    const duplicateField = normalizeLeadEmail(duplicateLead.email) === normalizeLeadEmail(newLead.email)
      ? "email"
      : "phone";
    await saveMetaLog({
      type: "updated",
      message: `Duplicate lead updated by ${duplicateField} match`,
      leadgenId,
      formId,
      leadId: updatedLead.id
    });
    return;
  }

  const result = await insertMetaLeadIfNew(leadgenId, newLead);

  cachedStateDoc   = null;
  cachedStateDocAt = 0;

  if (!result?.modifiedCount && !result?.upsertedCount) {
    if (retryJobId) {
      await withMongoRetry(
        () => metaRetryCollection.deleteOne({ _id: retryJobId }),
        { retries: 1, label: "Delete duplicate Meta retry job" }
      );
    }
    await saveMetaLog({ type: "ignored", message: "Duplicate lead (already imported)", leadgenId });
    return;
  }

  if (retryJobId) {
    await withMongoRetry(
      () => metaRetryCollection.deleteOne({ _id: retryJobId }),
      { retries: 1, label: "Delete processed Meta retry job" }
    );
  }

  await saveMetaLog({
    type: "success",
    message: `${retryJobId ? "Retried l" : "L"}ead created: ${newLead.name} → ${counselorName}`,
    leadgenId,
    formId,
    leadId: nextId,
    leadName: newLead.name,
    counselor: counselorName,
    leadPipeline: newLead.leadPipeline || "workshop",
    campaignName: newLead.metaCampaignName
  });

  await createNotification({
    userId: "admin",
    role: "admin",
    type: isAdmissionLead ? "new_main_admission_lead" : "new_meta_lead",
    title: isAdmissionLead ? "Main Admission Lead Received" : "Lead Received",
    message: `Lead: ${formatLeadNotificationLabel(newLead)}. ${shouldTreatLeadAsAssigned(counselorName) ? `Assigned counselor: ${counselorName}` : "Awaiting manual counselor assignment."}`,
    sound: true,
    leadId: nextId,
    leadName: newLead.name,
    assignedCounselor: counselorName
  });

  if (shouldTreatLeadAsAssigned(counselorName)) {
    const escapedName = counselorName.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
    const counselorDoc = await counselorsCollection.findOne({
      name: { $regex: new RegExp(`^${escapedName}$`, "i") }
    });
    if (counselorDoc && counselorDoc.email) {
      await createNotification({
        userId: counselorDoc.email,
        role: "counselor",
        type: isAdmissionLead ? "new_main_admission_lead" : "new_lead",
        title: isAdmissionLead ? "New Main Admission Lead" : "New Lead Received",
        message: `You received new lead ${formatLeadNotificationLabel(newLead)}.`,
        sound: true,
        leadId: nextId,
        leadName: newLead.name
      });
    }
  }
}

async function insertElementorLeadIfNew(newLead) {
  return withMongoRetry(async () => {
    try {
      await leadsCollection.insertOne(decorateLeadForStorage(newLead));
      await recordActivity({
        leadId: newLead.id,
        leadName: newLead.name,
        counselorName: newLead.counselor || "",
        activityType: "Lead Created",
        actionDescription: `Lead created from Elementor webhook (Form: ${newLead.elementorFormName || newLead.elementorFormId || "Unknown"})`,
        newValue: `Name: ${newLead.name}, Phone: ${newLead.phone}, Email: ${newLead.email}`
      });
      if (shouldTreatLeadAsAssigned(newLead.counselor)) {
        await recordActivity({
          leadId: newLead.id,
          leadName: newLead.name,
          counselorName: newLead.counselor,
          activityType: "Lead Assigned",
          actionDescription: `Lead initially assigned to counselor ${newLead.counselor}`,
          newValue: newLead.counselor
        });
      }
    } catch (error) {
      if (Number(error?.code) === 11000) {
        return { modifiedCount: 0, upsertedCount: 0 };
      }
      throw error;
    }

    const now = new Date().toISOString();
    await stateCollection.updateOne(
      { _id: STATE_DOC_ID },
      { $set: { updatedAt: now } },
      { upsert: true }
    );
    return { modifiedCount: 1, upsertedCount: 1 };
  }, { retries: 1, label: "Create Elementor lead" });
}

async function enqueueElementorRetryJob({
  payload,
  formId,
  formName,
  pageUrl,
  reason,
  lastError
}) {
  const now = new Date();
  const dedupeKey = [
    String(formId || "").trim() || "-",
    String(formName || "").trim() || "-",
    String(pageUrl || "").trim() || "-",
    String(payload?.email || payload?.email_address || "").trim().toLowerCase() || "-",
    String(payload?.phone_number || payload?.phone || payload?.mobile_phone || payload?.mobile || "").trim() || "-"
  ].join("|");

  await withMongoRetry(
    () => elementorRetryCollection.updateOne(
      { dedupeKey },
      {
        $set: {
          formId: String(formId || ""),
          formName: String(formName || ""),
          pageUrl: String(pageUrl || ""),
          reason: String(reason || "unknown"),
          lastError: String(lastError || ""),
          payload: payload && typeof payload === "object" ? payload : {},
          updatedAt: now.toISOString(),
          nextAttemptAt: new Date(now.getTime() + 60 * 1000).toISOString()
        },
        $setOnInsert: {
          dedupeKey,
          attempts: 0,
          createdAt: now.toISOString()
        }
      },
      { upsert: true }
    ),
    { retries: 1, label: "Queue Elementor retry job" }
  );
}

async function processElementorLeadRecord(payload, config, options = {}) {
  const retryJobId = options.retryJobId || null;
  const fields = getElementorFieldMap(payload);
  const formId = String(fields.form_id || "").trim();
  const formName = String(fields.form_name || "").trim();
  const pageUrl = String(fields.page_url || "").trim();
  const email = String(fields.email || fields.email_address || "").trim().toLowerCase();
  const phone = String(fields.phone_number || fields.phone || fields.mobile_phone || fields.mobile || "").trim();

  if (!email && !phone) {
    await saveElementorLog({
      type: "error",
      message: "Lead skipped because both email and phone are missing.",
      formId,
      formName,
      pageUrl
    });
    return;
  }

  const snapshot = await getMetaProcessingSnapshot();
  const metaInfo = {
    formId,
    formName,
    pageUrl,
    submittedDate: String(fields.date || "").trim(),
    submittedTime: String(fields.time || "").trim(),
    remoteIp: String(fields.remote_ip || "").trim(),
    userAgent: String(fields.user_agent || "").trim(),
    poweredBy: String(fields.powered_by || "").trim()
  };
  const leadType = classifyIncomingElementorLead(fields, metaInfo, config);
  const inferredAdmissionBranch = inferLeadBranchFromText(
    fields.city,
    fields.branch,
    fields.location,
    fields.state,
    fields.centre,
    fields.center,
    fields.preferred_city,
    fields.preferred_location,
    fields.preferred_state,
    fields.address,
    metaInfo.pageUrl,
    metaInfo.formName
  );
  const inferredAdmissionCourse = String(
    inferElementorProgram(fields, metaInfo, leadType) ||
    fields.course ||
    fields.course_name ||
    fields.program ||
    fields.workshop ||
    fields.workshop_name ||
    metaInfo.formName ||
    metaInfo.pageUrl ||
    ""
  ).trim();
  const forcedAdmissionCourseIdentity = buildCourseIdentity(inferredAdmissionCourse, {
    elementorFormName: metaInfo.formName,
    elementorPageUrl: metaInfo.pageUrl
  });
  const isAdmissionLead = leadType === "admission" || isKnownPublicCourseIdentity(forcedAdmissionCourseIdentity);
  const effectiveLeadType = isAdmissionLead ? "admission" : leadType;
  const counselorName = isAdmissionLead
    ? "Unassigned"
    : await assignElementorCounselorRoundRobin(snapshot.counselors);
  const nextId = await getNextMetaLeadId();
  const newLead = buildElementorLead(fields, metaInfo, counselorName, nextId, { leadType: effectiveLeadType });
  const duplicateLead = findDuplicateLeadByEmailOrPhone(snapshot.leads, newLead);

  if (duplicateLead) {
    if (retryJobId) {
      await withMongoRetry(
        () => elementorRetryCollection.deleteOne({ _id: retryJobId }),
        { retries: 1, label: "Delete duplicate Elementor retry job" }
      );
    }
    const updatedLead = await updateExistingIntegrationLead(duplicateLead, newLead, {
      source: "Elementor"
    });
    const duplicateField = normalizeLeadEmail(duplicateLead.email) === normalizeLeadEmail(newLead.email)
      ? "email"
      : "phone";
    await saveElementorLog({
      type: "updated",
      message: `Duplicate lead updated by ${duplicateField} match`,
      formId,
      formName,
      pageUrl,
      leadId: updatedLead.id
    });
    return;
  }

  const result = await insertElementorLeadIfNew(newLead);

  cachedStateDoc = null;
  cachedStateDocAt = 0;

  if (!result?.modifiedCount && !result?.upsertedCount) {
    if (retryJobId) {
      await withMongoRetry(
        () => elementorRetryCollection.deleteOne({ _id: retryJobId }),
        { retries: 1, label: "Delete duplicate Elementor retry job" }
      );
    }
    await saveElementorLog({
      type: "ignored",
      message: "Duplicate lead (already imported)",
      formId,
      formName,
      pageUrl
    });
    return;
  }

  if (retryJobId) {
    await withMongoRetry(
      () => elementorRetryCollection.deleteOne({ _id: retryJobId }),
      { retries: 1, label: "Delete processed Elementor retry job" }
    );
  }

  await saveElementorLog({
    type: "success",
    message: `Lead created: ${newLead.name} → ${counselorName}`,
    formId,
    formName,
    pageUrl,
    leadId: nextId,
    leadName: newLead.name,
    counselor: counselorName,
    leadPipeline: newLead.leadPipeline || "workshop"
  });

  await createNotification({
    userId: "admin",
    role: "admin",
    type: isAdmissionLead ? "new_main_admission_lead" : "new_elementor_lead",
    title: isAdmissionLead ? "Main Admission Lead Received" : "Elementor Lead Received",
    message: `Lead: ${formatLeadNotificationLabel(newLead)}. ${shouldTreatLeadAsAssigned(counselorName) ? `Assigned counselor: ${counselorName}` : "Awaiting manual counselor assignment."}`,
    sound: true,
    leadId: nextId,
    leadName: newLead.name,
    assignedCounselor: counselorName
  });

  if (shouldTreatLeadAsAssigned(counselorName)) {
    const escapedName = counselorName.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
    const counselorDoc = await counselorsCollection.findOne({
      name: { $regex: new RegExp(`^${escapedName}$`, "i") }
    });
    if (counselorDoc?.email) {
      await createNotification({
        userId: counselorDoc.email,
        role: "counselor",
        type: isAdmissionLead ? "new_main_admission_lead" : "new_lead",
        title: isAdmissionLead ? "New Main Admission Lead" : "New Lead Received",
        message: `You received new lead ${formatLeadNotificationLabel(newLead)}.`,
        sound: true,
        leadId: nextId,
        leadName: newLead.name
      });
    }
  }
}

async function processElementorWebhookPayload(payload) {
  const config = await getElementorConfig();
  const fields = getElementorFieldMap(payload);
  const formId = String(fields.form_id || "").trim();
  const formName = String(fields.form_name || "").trim();
  const pageUrl = String(fields.page_url || "").trim();

  if (!config.enabled) {
    await saveElementorLog({
      type: "ignored",
      message: "Integration disabled",
      formId,
      formName,
      pageUrl
    });
    return;
  }

  const allowedFormIds = Array.isArray(config.allowedFormIds) ? config.allowedFormIds.filter(Boolean) : [];
  if (allowedFormIds.length && !allowedFormIds.includes(formId)) {
    await saveElementorLog({
      type: "ignored",
      message: `Form ID ${formId || "unknown"} not in allowed list`,
      formId,
      formName,
      pageUrl
    });
    return;
  }

  try {
    await processElementorLeadRecord(payload, config);
  } catch (error) {
    await enqueueElementorRetryJob({
      payload,
      formId,
      formName,
      pageUrl,
      reason: "process-lead-record",
      lastError: error?.message || "unknown error"
    }).catch(() => undefined);
    throw error;
  }
}

async function processPendingMetaRetryJobs({ limit = 3 } = {}) {
  const nowIso = new Date().toISOString();
  const jobs = await withMongoRetry(
    () => metaRetryCollection
      .find(
        {
          nextAttemptAt: { $lte: nowIso },
          attempts: { $lt: META_RETRY_JOB_MAX_ATTEMPTS }
        }
      )
      .sort({ nextAttemptAt: 1, createdAt: 1 })
      .limit(limit)
      .toArray(),
    { retries: 1, label: "Load Meta retry jobs" }
  );

  if (!jobs.length) {
    return;
  }

  const config = await getMetaConfig();
  if (!config.enabled || !config.pageAccessToken) {
    return;
  }

  for (const job of jobs) {
    try {
      const metaLead = job.metaLeadSnapshot || await fetchMetaLeadDetails(job.leadgenId, config.pageAccessToken);
      await processMetaLeadRecord({
        leadgenId: job.leadgenId,
        formId: job.formId,
        pageId: job.pageId,
        metaLead,
        retryJobId: job._id
      });
    } catch (error) {
      const attempts = Number(job.attempts || 0) + 1;
      await withMongoRetry(
        () => metaRetryCollection.updateOne(
          { _id: job._id },
          {
            $set: {
              attempts,
              lastError: String(error?.message || "unknown error"),
              updatedAt: new Date().toISOString(),
              nextAttemptAt: new Date(Date.now() + getMetaRetryBackoffMs(attempts)).toISOString()
            }
          }
        ),
        { retries: 1, label: "Update Meta retry job" }
      ).catch(() => undefined);
    }
  }
}

async function enqueueMcubeRetryJob({
  jobType,
  dedupeKey,
  payload = {},
  leadId = "",
  leadName = "",
  phone = "",
  callId = "",
  eventType = "",
  reason,
  lastError
}) {
  const now = new Date();
  const safeKey = String(dedupeKey || "").trim();
  if (!safeKey) return;

  await withMongoRetry(
    () => mcubeRetryCollection.updateOne(
      { dedupeKey: safeKey },
      {
        $set: {
          jobType: String(jobType || "mcube"),
          payload: payload && typeof payload === "object" ? payload : {},
          leadId: String(leadId || ""),
          leadName: String(leadName || ""),
          phone: String(phone || ""),
          callId: String(callId || ""),
          eventType: String(eventType || ""),
          reason: String(reason || "unknown"),
          lastError: String(lastError || ""),
          updatedAt: now.toISOString(),
          nextAttemptAt: new Date(now.getTime() + 60 * 1000).toISOString()
        },
        $setOnInsert: {
          dedupeKey: safeKey,
          attempts: 0,
          createdAt: now.toISOString()
        }
      },
      { upsert: true }
    ),
    { retries: 1, label: "Queue MCUBE retry job" }
  );
}

async function processPendingElementorRetryJobs({ limit = 3 } = {}) {
  const nowIso = new Date().toISOString();
  const jobs = await withMongoRetry(
    () => elementorRetryCollection
      .find({
        nextAttemptAt: { $lte: nowIso },
        attempts: { $lt: ELEMENTOR_RETRY_JOB_MAX_ATTEMPTS }
      })
      .sort({ nextAttemptAt: 1, createdAt: 1 })
      .limit(limit)
      .toArray(),
    { retries: 1, label: "Load Elementor retry jobs" }
  );

  if (!jobs.length) return;

  const config = await getElementorConfig();
  if (!config.enabled) return;

  for (const job of jobs) {
    try {
      await processElementorLeadRecord(job.payload || {}, config, { retryJobId: job._id });
    } catch (error) {
      const attempts = Number(job.attempts || 0) + 1;
      await withMongoRetry(
        () => elementorRetryCollection.updateOne(
          { _id: job._id },
          {
            $set: {
              attempts,
              lastError: String(error?.message || "unknown error"),
              updatedAt: new Date().toISOString(),
              nextAttemptAt: new Date(Date.now() + getIntegrationRetryBackoffMs(attempts)).toISOString()
            }
          }
        ),
        { retries: 1, label: "Update Elementor retry job" }
      ).catch(() => undefined);
    }
  }
}

async function processPendingMcubeRetryJobs({ limit = 3 } = {}) {
  const nowIso = new Date().toISOString();
  const jobs = await withMongoRetry(
    () => mcubeRetryCollection
      .find({
        nextAttemptAt: { $lte: nowIso },
        attempts: { $lt: MCUBE_RETRY_JOB_MAX_ATTEMPTS }
      })
      .sort({ nextAttemptAt: 1, createdAt: 1 })
      .limit(limit)
      .toArray(),
    { retries: 1, label: "Load MCUBE retry jobs" }
  );

  if (!jobs.length) return;

  const config = await getMcubeConfig();
  if (!config.enabled) return;

  for (const job of jobs) {
    try {
      if (job.jobType === "webhook-event") {
        await processMcubeWebhookPayload({ rawBody: null, headers: {} }, job.payload || {}, {
          skipSignatureVerification: true,
          retryJobId: job._id
        });
        continue;
      }

      await withMongoRetry(
        () => mcubeRetryCollection.deleteOne({ _id: job._id }),
        { retries: 1, label: "Delete unsupported MCUBE retry job" }
      );
    } catch (error) {
      const attempts = Number(job.attempts || 0) + 1;
      await withMongoRetry(
        () => mcubeRetryCollection.updateOne(
          { _id: job._id },
          {
            $set: {
              attempts,
              lastError: String(error?.message || "unknown error"),
              updatedAt: new Date().toISOString(),
              nextAttemptAt: new Date(Date.now() + getIntegrationRetryBackoffMs(attempts)).toISOString()
            }
          }
        ),
        { retries: 1, label: "Update MCUBE retry job" }
      ).catch(() => undefined);
    }
  }
}

module.exports = app;
