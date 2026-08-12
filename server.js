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
const VERSION_FILE = path.join(ROOT_DIR, ".version");
const APP_STARTED_AT = new Date().toISOString();

function parseEnvInteger(name, fallback, minimum = 0) {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(minimum, Math.floor(parsed));
}

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
const MONGODB_PERFORMANCE_LOGS_COLLECTION = process.env.MONGODB_PERFORMANCE_LOGS_COLLECTION || "performance_logs";
const MONGODB_LSQ_ARCHIVE_COLLECTION = process.env.MONGODB_LSQ_ARCHIVE_COLLECTION || "lsq_archive_leads";
const MONGODB_LEAD_INFLOW_COLLECTION = process.env.MONGODB_LEAD_INFLOW_COLLECTION || "lead_inflow_events";
const MONGODB_MAX_POOL_SIZE = parseEnvInteger("MONGODB_MAX_POOL_SIZE", 75, 10);
const MONGODB_MIN_POOL_SIZE = parseEnvInteger("MONGODB_MIN_POOL_SIZE", 10, 0);
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
const LSQ_ARCHIVED_COUNSELOR = "Archived Leads";
const LOST_LEADS_COUNSELOR_FILTER = "__lost_leads__";
const KOLKATA_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const LOST_LEAD_ARCHIVE_AFTER_MS = 24 * 60 * 60 * 1000;
const ADMISSION_SOP_NEW_WINDOW_MS = 48 * 60 * 60 * 1000;
const ADMISSION_SOP_ACTIVE_WINDOW_DAYS = 15;
const ADMISSION_SOP_OFFERED_WINDOW_DAYS = 30;
const ADMISSION_SOP_SYSTEM_ACTIVITY_ACTORS = new Set(["reachout webhook", "system"]);
const ADMISSION_SOP_EXCLUDED_ACTIVITY_TYPES = new Set([
  "Lead Created",
  "Lead Assigned",
  "Lead Reassigned",
  "Counselor Changed",
  "Lead Viewed"
]);
const ADMISSION_SOP_ACTIVITY_OPTIONS_BY_HISTORY_FIELD = {
  mainAdmissionActivityHistory: {
    activityFields: ["mainAdmissionDialed", "mainAdmissionCoursePitched", "mainAdmissionCourseStatus", "mainAdmissionAdmissionStatus", "mainAdmissionCallStatus"]
  },
  registeredCourseActivityHistory: {
    activityFields: ["registeredDialed", "registeredCoursePitched", "registeredCourseStatus", "registeredAdmissionStatus", "registeredCallStatus"]
  }
};
const PUBLIC_COURSE_CATALOG = [
  { id: "apids", code: "APIDS", name: "Advanced Program in Industrial Data Science & AI", duration: "6-8 Months" },
  { id: "apida", code: "APIDA", name: "Advanced Program in Industrial Data Analytics & AI", duration: "4-5 Months" },
  { id: "advanced-aiml-genai-agentic", code: "AIML + GenAI", name: "Advanced AIML with Gen AI & Agentic AI", duration: "4 Months" },
  { id: "master-genai-agentic", code: "GenAI Master", name: "Master Program in Gen AI & Agentic AI", duration: "3 Months" },
  { id: "data-analytics-specialist", code: "DAS", name: "Data Analytics Specialist", duration: "3 Months" },
  { id: "apcs", code: "APCS", name: "Advanced Program in Cybersecurity & Forensics", duration: "3-4 Months" },
  { id: "days7_genai", code: "7DAYS_GENAI", name: "7 Days Gen AI & Agentic AI Hands-on Master Program", duration: "7 Days" },
  { id: "forward-deployed-engineer", code: "FDE", name: "Forward Deployed Engineer", duration: "3 Months" }
];

const COURSE_IDENTITY_RULES = [
  { pattern: /\bapids\b|\bindustrial data science\b|\badvanced program in industrial data science\b|\bdata science\b|\bdata scientist\b/i, label: "APIDS", key: "apids" },
  { pattern: /\bapida\b|\bindustrial data analytics\b|\badvanced program in industrial data analytics\b|\bdata analytics\b|\bdata analyst\b/i, label: "APIDA", key: "apida" },
  { pattern: /\b7\s*days?\b.*\b(gen\s*ai|agentic ai)\b|\b(gen\s*ai|agentic ai)\b.*\b7\s*days?\b|\b7days\b|\bdays7[_\s-]*genai\b|\bgen\s*ai\b.*\bcrash\s*course\b|\bcrash\s*course\b.*\b(gen\s*ai|agentic ai)\b/i, label: "7DAYS_GENAI", key: "days7_genai" },
  { pattern: /\badvanced\b.*\b(ai\s*\/?\s*ml|aiml)\b|\badv\b.*\b(ai\s*\/?\s*ml|aiml)\b|\bai\s*\/?\s*ml\b|\bartificial intelligence\b.*\bmachine learning\b|\baiml\b/i, label: "AIML + GenAI", key: "advanced-aiml-genai-agentic" },
  { pattern: /\bcyber\s*security\b|\bcybersecurity\b|\bcyber\s*ai\b|\bcyberai\b|\bapcs\b|\bforensics\b/i, label: "APCS", key: "apcs" },
  { pattern: /\bdata analytics specialist\b|\bdas\b/i, label: "DAS", key: "data-analytics-specialist" },
  { pattern: /\bfde\b|\bforward deployed engineer(?:ing)?\b|\bforward deployment engineer(?:ing)?\b|\bmaster ai forward deployed engineer(?:ing)?\b|\bmaster ai forward deployment engineer(?:ing)?\b/i, label: "FDE", key: "forward-deployed-engineer" },
  { pattern: /\bmaster\b.*\bgen\s*ai\b|\bgen\s*ai\b.*\bmaster\b|\bgenai\s*master\b|\bagentic\b/i, label: "GenAI Master", key: "master-genai-agentic" }
];
const WORKSHOP_ROUTING_SIGNAL_PATTERN = /\b(workshop|webinar|masterclass|bootcamp|demo class|session)\b/i;

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
  "reachout",
  "performanceLogs"
];
const FULL_PAGE_ACCESS = Object.freeze({
  ...Object.fromEntries(PAGE_ACCESS_KEYS.map((key) => [key, true])),
  lostLeads: false
});
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
  lostLeads: false,
  monitoring: true,
  counselorManagement: false,
  leadControl: true,
  metaIntegration: true,
  elementorIntegration: true,
  mcubeIntegration: true,
  leadFlowControl: true,
  reachout: true,
  performanceLogs: false,
  postWorkshop: true
});
const MANAGER_DEFAULT_PAGE_ACCESS = Object.freeze({
  ...COUNSELOR_DEFAULT_PAGE_ACCESS,
  counselorManagement: false,
  leadControl: false,
  leadFlowControl: false,
  performanceLogs: false
});
const MARKETING_DEFAULT_PAGE_ACCESS = Object.freeze({
  ...FULL_PAGE_ACCESS,
  counselorManagement: false,
  leadControl: false,
  performanceLogs: false
});
const ADMIN_DEFAULT_PAGE_ACCESS = Object.freeze({
  ...FULL_PAGE_ACCESS,
  counselorManagement: true,
  performanceLogs: false
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
  lostLeads: false,
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

function sendHealthResponse(res, status, details = {}) {
  res.status(status);
  res.setHeader("Cache-Control", "no-store");
  return res.json({
    ok: status >= 200 && status < 300,
    ready: status >= 200 && status < 300,
    version: getAppVersion(),
    startedAt: APP_STARTED_AT,
    ...details
  });
}

app.get("/healthz", async (_req, res) => {
  try {
    await initMongo();
    await stateCollection.findOne(
      { _id: STATE_DOC_ID },
      { projection: { _id: 1 } }
    ).catch(() => null);
    return sendHealthResponse(res, 200);
  } catch (error) {
    return sendHealthResponse(res, 503, {
      message: "CRM is starting.",
      details: error?.message || "Health check failed."
    });
  }
});

app.get("/api/healthz", async (_req, res) => {
  try {
    await initMongo();
    return sendHealthResponse(res, 200);
  } catch (error) {
    return sendHealthResponse(res, 503, {
      message: "CRM is starting.",
      details: error?.message || "Health check failed."
    });
  }
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
app.use("/api/webhook/elementor-lead", (req, res, next) => {
  const configuredOrigins = String(process.env.ELEMENTOR_WEBHOOK_ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const allowedOrigins = new Set([
    "https://dvanalyticsmds.com",
    "https://www.dvanalyticsmds.com",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    ...configuredOrigins
  ]);
  const requestOrigin = String(req.headers.origin || "").trim();

  if (requestOrigin && allowedOrigins.has(requestOrigin)) {
    res.setHeader("Access-Control-Allow-Origin", requestOrigin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  return next();
});
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
app.use("/api/mcube/call-routing", express.urlencoded({
  extended: false,
  limit: "32kb"
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
app.use((req, res, next) => {
  if (!String(req.path || "").startsWith("/api/")) {
    return next();
  }

  const startedAt = Date.now();
  res.on("finish", () => {
    recordPerformanceEvent({
      kind: "api",
      operation: getRequestPath(req),
      route: getRequestPath(req),
      durationMs: Date.now() - startedAt,
      success: res.statusCode < 400,
      status: res.statusCode < 400 ? "success" : "failure",
      message: res.statusCode >= 400 ? `HTTP ${res.statusCode}` : ""
    });
  });

  return next();
});

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
let performanceLogsCollection;
let leadsCollection;
let counselorsCollection;
let tasksCollection;
let allocationCollection;
let notificationsCollection;
let activityLogsCollection;
let leadClaimsCollection;
let leadCreationRequestsCollection;
let lsqArchiveCollection;
let leadInflowCollection;

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
  performanceLogsCollection = null;
  leadsCollection = null;
  counselorsCollection = null;
  tasksCollection = null;
  allocationCollection = null;
  notificationsCollection = null;
  activityLogsCollection = null;
  leadClaimsCollection = null;
  leadCreationRequestsCollection = null;
  lsqArchiveCollection = null;
  leadInflowCollection = null;
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

  setCachedSession(token, normalized, {
    role: normalized.role,
    sessionSchemaVersion: normalized.sessionSchemaVersion,
    adminAuthVersion
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
    admissionSopEnabled: state.admissionSopEnabled !== false,
    admissionSopEnabledAt: state.admissionSopEnabledAt || null,
    admissionSopUpdatedBy: state.admissionSopUpdatedBy || "",
    coursePriorities: Array.isArray(state.coursePriorities) ? state.coursePriorities : [
      "days7_genai",
      "advanced-aiml-genai-agentic",
      "apcs",
      "apida",
      "apids",
      "forward-deployed-engineer",
      "master-genai-agentic",
      "data-analytics-specialist"
    ],
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

function shouldExposeLeadInStateResponse(lead) {
  const pipeline = String(lead?.leadPipeline || "").trim().toLowerCase();
  return !isMainAdmissionPipelineValue(pipeline)
    && pipeline !== "course-registration"
    && !isLeadSquaredImportedLead(lead);
}

function isMainAdmissionPipelineValue(value) {
  const pipeline = String(value || "").trim().toLowerCase();
  return pipeline === MAIN_ADMISSION_PIPELINE
    || pipeline === "admission"
    || pipeline === "main-admission-calling";
}

function getMainAdmissionLeadMongoQuery({ includeLsqImported = true, includeArchived = false } = {}) {
  const pipelineQuery = { leadPipeline: { $in: [MAIN_ADMISSION_PIPELINE, "admission", "main-admission-calling"] } };
  if (!includeLsqImported) {
    return pipelineQuery;
  }
  const lsqImportedQuery = { lsqImported: true };
  if (!includeArchived) {
    Object.assign(lsqImportedQuery, {
      lsqArchivedLead: { $ne: true },
      counselor: { $ne: LSQ_ARCHIVED_COUNSELOR }
    });
  }
  return {
    $or: [
      pipelineQuery,
      lsqImportedQuery
    ]
  };
}

function buildStateResponse(state, options = {}) {
  const normalized = normalizeStateDoc(state);
  const trimAdmissionPipelines = options?.trimAdmissionPipelines === true;
  const leads = trimAdmissionPipelines
    ? normalized.leads.filter(shouldExposeLeadInStateResponse)
    : normalized.leads;
  return {
    leads,
    counselors: normalized.counselors,
    adminUsers: normalized.adminUsers,
    marketingUsers: normalized.marketingUsers,
    allocation: normalized.allocation,
    tasks: normalized.tasks,
    admissionSopEnabled: normalized.admissionSopEnabled,
    admissionSopEnabledAt: normalized.admissionSopEnabledAt,
    admissionSopUpdatedBy: normalized.admissionSopUpdatedBy,
    coursePriorities: normalized.coursePriorities,
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
      allocation: Array.isArray(normalized.allocation) ? normalized.allocation.length : 0,
      admissionSopEnabled: normalized.admissionSopEnabled
    }
  };
}

function getRequestPath(req) {
  return String(req?.originalUrl || req?.url || "").split("?")[0] || "unknown";
}

function getPerformanceStatus(avgMs, successRate) {
  if (successRate < 95 || avgMs > 10000) return "Critical";
  if (successRate < 98 || avgMs > 5000) return "Slow";
  return "Good";
}

function recordPerformanceEvent(event = {}) {
  if (!performanceLogsCollection) {
    return;
  }

  const durationMs = Math.max(0, Math.round(Number(event.durationMs) || 0));
  const createdAt = new Date().toISOString();
  const doc = {
    kind: String(event.kind || "api"),
    operation: String(event.operation || "unknown"),
    route: String(event.route || ""),
    page: String(event.page || ""),
    section: String(event.section || ""),
    subsection: String(event.subsection || ""),
    phase: String(event.phase || ""),
    role: String(event.role || ""),
    status: String(event.status || "success"),
    durationMs,
    success: event.success !== false,
    count: Number(event.count || 0),
    message: String(event.message || ""),
    createdAt,
    createdAtDate: new Date(createdAt)
  };

  void withMongoRetry(
    () => performanceLogsCollection.insertOne(doc),
    { retries: 0, label: "Write performance log" }
  ).catch((error) => {
    console.warn("[performance] log write failed:", error?.message || error);
  });
}

function recordRoutePerformance(req, startedAt, { operation, success = true, status = "success", count = 0, message = "" } = {}) {
  recordPerformanceEvent({
    kind: "api",
    operation: operation || getRequestPath(req),
    route: getRequestPath(req),
    durationMs: Date.now() - startedAt,
    success,
    status,
    count,
    message
  });
}

function parsePerformanceDateInput(value) {
  const raw = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return null;
  }
  const date = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getPerformanceWindowFromQuery(query = {}) {
  const now = new Date();
  const requestedHours = Number.parseInt(String(query.hours || "").trim(), 10);
  const requestedDays = String(query.days || "14").trim().toLowerCase();
  const customStart = parsePerformanceDateInput(query.start);
  const customEnd = parsePerformanceDateInput(query.end);

  if (Number.isFinite(requestedHours) && requestedHours > 0) {
    const hours = Math.min(Math.max(requestedHours, 1), 168);
    return {
      start: new Date(now.getTime() - hours * 60 * 60 * 1000),
      end: now,
      label: `Last ${hours} hour${hours === 1 ? "" : "s"}`,
      bucket: hours <= 24 ? "hour" : "day"
    };
  }

  if (customStart && customEnd) {
    const start = customStart <= customEnd ? customStart : customEnd;
    const end = customStart <= customEnd ? customEnd : customStart;
    end.setUTCHours(23, 59, 59, 999);
    return {
      start,
      end,
      label: `${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)}`,
      bucket: "day"
    };
  }

  const days = requestedDays === "today"
    ? 1
    : Math.min(Math.max(Number.parseInt(requestedDays, 10) || 14, 1), 30);
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return {
    start,
    end: now,
    label: days === 1 ? "Today" : `Last ${days} days`,
    bucket: "day"
  };
}

function buildPerformanceSummary(logs = [], window = getPerformanceWindowFromQuery()) {
  const safeLogs = Array.isArray(logs) ? logs : [];
  const apiLogs = safeLogs.filter((log) => String(log.kind || "api") === "api");
  const pageInteractiveLogs = safeLogs.filter((log) => String(log.kind || "") === "page" && String(log.phase || "") === "interactive-ready");
  const sectionLogs = safeLogs.filter((log) => String(log.kind || "") === "section");
  const phaseLogs = [...pageInteractiveLogs, ...sectionLogs].filter((log) => String(log.phase || "").trim());

  const summarizeBy = (sourceLogs, getKey, getMeta = () => ({})) => {
    const rows = new Map();
    sourceLogs.forEach((log) => {
      const key = String(getKey(log) || "").trim();
      if (!key) {
        return;
      }
      if (!rows.has(key)) {
        rows.set(key, {
          name: key,
          ...getMeta(log),
          total: 0,
          success: 0,
          failure: 0,
          totalDuration: 0,
          maxDurationMs: 0,
          durations: []
        });
      }
      const row = rows.get(key);
      const durationMs = Math.max(0, Number(log.durationMs) || 0);
      row.total += 1;
      row.totalDuration += durationMs;
      row.maxDurationMs = Math.max(row.maxDurationMs, durationMs);
      row.durations.push(durationMs);
      if (log.success !== false && String(log.status || "").toLowerCase() !== "failure") {
        row.success += 1;
      } else {
        row.failure += 1;
      }
    });

    return Array.from(rows.values()).map((row) => {
      const sorted = row.durations.sort((a, b) => a - b);
      const p95Index = sorted.length ? Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1) : 0;
      const avgDurationMs = row.total ? Math.round(row.totalDuration / row.total) : 0;
      const successRate = row.total ? Math.round((row.success / row.total) * 1000) / 10 : 100;
      return {
        ...row,
        avgDurationMs,
        p95DurationMs: sorted[p95Index] || 0,
        successRate,
        status: getPerformanceStatus(avgDurationMs, successRate),
        durations: undefined,
        totalDuration: undefined
      };
    }).sort((a, b) => b.avgDurationMs - a.avgDurationMs || b.total - a.total);
  };

  let totalSuccess = 0;

  safeLogs.forEach((log) => {
    if (log.success !== false && String(log.status || "").toLowerCase() !== "failure") {
      totalSuccess += 1;
    }
  });

  const operationRows = summarizeBy(
    safeLogs,
    (log) => log.operation || log.route || log.page || "unknown",
    (log) => ({
      operation: String(log.operation || log.route || log.page || "unknown"),
      kind: String(log.kind || "api"),
      page: String(log.page || ""),
      section: String(log.section || ""),
      subsection: String(log.subsection || ""),
      phase: String(log.phase || ""),
      role: String(log.role || "")
    })
  );
  const apiRows = summarizeBy(
    apiLogs,
    (log) => log.operation || log.route || "unknown",
    (log) => ({
      operation: String(log.operation || log.route || "unknown"),
      kind: "api",
      route: String(log.route || "")
    })
  );
  const pageRows = summarizeBy(pageInteractiveLogs, (log) => log.page, (log) => ({ page: String(log.page || ""), role: String(log.role || "") }));
  const roleRows = summarizeBy(pageInteractiveLogs.filter((log) => String(log.role || "").trim()), (log) => log.role, (log) => ({ role: String(log.role || "") }));
  const sectionRows = summarizeBy(sectionLogs, (log) => [log.page, log.section, log.subsection].filter(Boolean).join(" / "), (log) => ({
    page: String(log.page || ""),
    section: String(log.section || ""),
    subsection: String(log.subsection || ""),
    role: String(log.role || "")
  }));
  const phaseRows = summarizeBy(phaseLogs, (log) => [log.page, log.section, log.phase].filter(Boolean).join(" / "), (log) => ({
    page: String(log.page || ""),
    section: String(log.section || ""),
    phase: String(log.phase || ""),
    role: String(log.role || "")
  }));
  const pageRoleBaseRows = summarizeBy(
    pageInteractiveLogs.filter((log) => String(log.page || "").trim() && String(log.role || "").trim()),
    (log) => `${log.page}::${normalizePerformanceRole(log.role)}`,
    (log) => ({
      page: String(log.page || ""),
      roleGroup: normalizePerformanceRole(log.role)
    })
  );
  const pageRoleRows = buildPerformancePageRoleRows(pageRoleBaseRows);
  const activityRows = summarizeBy(
    safeLogs.filter(isPerformanceActivityLog),
    (log) => getPerformanceActivityName(log),
    (log) => ({
      operation: getPerformanceActivityName(log),
      kind: String(log.kind || ""),
      page: String(log.page || ""),
      role: String(log.role || "")
    })
  ).slice(0, 20);

  const total = safeLogs.length;
  const successRate = total ? Math.round((totalSuccess / total) * 1000) / 10 : 100;
  const pageAverageDurationMs = pageInteractiveLogs.length
    ? Math.round(pageInteractiveLogs.reduce((sum, log) => sum + (Number(log.durationMs) || 0), 0) / pageInteractiveLogs.length)
    : 0;
  const avgDurationMs = total
    ? Math.round(safeLogs.reduce((sum, log) => sum + (Number(log.durationMs) || 0), 0) / total)
    : 0;
  const overallScore = total ? getPerformanceScore(pageAverageDurationMs || avgDurationMs, successRate) : 0;
  const trendRows = buildPerformanceTrends({ safeLogs, apiLogs, pageInteractiveLogs, window });
  const allSpeedRows = operationRows.map((row) => ({
    name: row.operation || row.name,
    type: getPerformanceThingType(row),
    avgDurationMs: row.avgDurationMs,
    successRate: row.successRate,
    total: row.total,
    status: row.status
  }));

  return {
    generatedAt: new Date().toISOString(),
    windowLabel: window.label || "Last 14 days",
    totalEvents: total,
    successRate,
    avgDurationMs,
    pageAverageDurationMs,
    overallScore,
    status: total ? getPerformanceStatus(avgDurationMs, successRate) : "No Data",
    operations: operationRows.slice(0, 30),
    apis: apiRows.slice(0, 30),
    pages: pageRows.slice(0, 30),
    pageRoles: pageRoleRows,
    roles: roleRows.slice(0, 20),
    activities: activityRows,
    fastest: allSpeedRows.filter((row) => row.avgDurationMs <= 2000).sort((a, b) => a.avgDurationMs - b.avgDurationMs).slice(0, 12),
    medium: allSpeedRows.filter((row) => row.avgDurationMs > 2000 && row.avgDurationMs <= 6000).sort((a, b) => a.avgDurationMs - b.avgDurationMs).slice(0, 12),
    slowest: allSpeedRows.filter((row) => row.avgDurationMs > 6000).sort((a, b) => b.avgDurationMs - a.avgDurationMs).slice(0, 12),
    sections: sectionRows.slice(0, 30),
    phases: phaseRows.slice(0, 30),
    trends: trendRows,
    slowEvents: [...safeLogs]
      .sort((a, b) => (Number(b.durationMs) || 0) - (Number(a.durationMs) || 0))
      .slice(0, 20),
    recentFailures: safeLogs
      .filter((log) => log.success === false || String(log.status || "").toLowerCase() === "failure")
      .slice(0, 20)
  };
}

function normalizePerformanceRole(role) {
  const normalized = String(role || "").trim().toLowerCase();
  if (normalized === "super_admin" || normalized === "admin") return "admin";
  if (normalized === "counselor") return "counselor";
  return normalized || "unknown";
}

function getPerformanceScore(avgDurationMs, successRate) {
  const speedPenalty = Math.min(55, Math.max(0, ((Number(avgDurationMs) || 0) - 1500) / 8500) * 55);
  const reliabilityPenalty = Math.min(45, Math.max(0, 100 - (Number(successRate) || 0)) * 2.5);
  return Math.max(0, Math.min(100, Math.round(100 - speedPenalty - reliabilityPenalty)));
}

function buildPerformancePageRoleRows(rows = []) {
  const grouped = new Map();
  rows.forEach((row) => {
    const page = String(row.page || row.name || "").trim();
    if (!page) return;
    const current = grouped.get(page) || {
      page,
      adminAvgDurationMs: 0,
      adminTotal: 0,
      counselorAvgDurationMs: 0,
      counselorTotal: 0
    };
    if (row.roleGroup === "admin") {
      current.adminAvgDurationMs = row.avgDurationMs || 0;
      current.adminTotal = row.total || 0;
    }
    if (row.roleGroup === "counselor") {
      current.counselorAvgDurationMs = row.avgDurationMs || 0;
      current.counselorTotal = row.total || 0;
    }
    grouped.set(page, current);
  });
  return [...grouped.values()].sort((a, b) => {
    const aWorst = Math.max(a.adminAvgDurationMs || 0, a.counselorAvgDurationMs || 0);
    const bWorst = Math.max(b.adminAvgDurationMs || 0, b.counselorAvgDurationMs || 0);
    return bWorst - aWorst || a.page.localeCompare(b.page);
  });
}

function isPerformanceActivityLog(log = {}) {
  const kind = String(log.kind || "").toLowerCase();
  const text = [log.operation, log.route, log.page, log.section, log.subsection, log.phase]
    .map((value) => String(value || "").toLowerCase())
    .join(" ");
  if (kind === "action" || kind === "activity" || kind === "mutation" || kind === "batch") return true;
  return /(assign|assignment|delete|deletion|activity|save|update|restore|claim|reachout|notification|sync|webhook)/.test(text)
    && !/route-interactive|interactive-ready/.test(text);
}

function getPerformanceActivityName(log = {}) {
  const text = [log.operation, log.route, log.section, log.subsection, log.phase]
    .map((value) => String(value || "").toLowerCase())
    .join(" ");
  if (/assign|assignment/.test(text)) return "Lead Assignment";
  if (/delete|deletion/.test(text)) return "Deletion";
  if (/restore/.test(text)) return "Lead Restore";
  if (/activity|save|update/.test(text)) return "Counselor Activity Update";
  if (/notification/.test(text)) return "Notification Loading";
  if (/reachout|whatsapp/.test(text)) return "ReachOut Operation";
  if (/claim/.test(text)) return "Lead Claim";
  if (/sync|webhook/.test(text)) return "Integration Sync";
  return String(log.operation || log.route || log.page || "Activity").trim();
}

function getPerformanceThingType(row = {}) {
  const kind = String(row.kind || "").toLowerCase();
  const name = String(row.operation || row.name || "").toLowerCase();
  if (kind === "page" || /html|route-interactive|interactive-ready/.test(name)) return "Page";
  if (kind === "api" || name.startsWith("/api/")) return "API";
  if (kind === "section") return "Section";
  return "Activity";
}

function buildPerformanceTrends({ safeLogs = [], apiLogs = [], pageInteractiveLogs = [], window = getPerformanceWindowFromQuery() } = {}) {
  const start = new Date(window.start || Date.now());
  const end = new Date(window.end || Date.now());
  const useHourBuckets = window.bucket === "hour";
  if (useHourBuckets) {
    start.setUTCMinutes(0, 0, 0);
    end.setUTCMinutes(0, 0, 0);
  } else {
    start.setUTCHours(0, 0, 0, 0);
    end.setUTCHours(0, 0, 0, 0);
  }
  const keys = [];
  for (const date = new Date(start); date <= end;) {
    keys.push(useHourBuckets ? date.toISOString().slice(0, 13) : date.toISOString().slice(0, 10));
    if (useHourBuckets) {
      date.setUTCHours(date.getUTCHours() + 1);
    } else {
      date.setUTCDate(date.getUTCDate() + 1);
    }
  }

  const buckets = new Map(keys.map((key) => [key, {
    key,
    day: key,
    total: 0,
    success: 0,
    pageDurations: [],
    apiDurations: []
  }]));

  const addDuration = (log, field) => {
    const key = String(log.createdAt || "").slice(0, useHourBuckets ? 13 : 10);
    const bucket = buckets.get(key);
    if (!bucket) return;
    const durationMs = Math.max(0, Number(log.durationMs) || 0);
    bucket[field].push(durationMs);
  };

  safeLogs.forEach((log) => {
    const key = String(log.createdAt || "").slice(0, useHourBuckets ? 13 : 10);
    const bucket = buckets.get(key);
    if (!bucket) return;
    bucket.total += 1;
    if (log.success !== false && String(log.status || "").toLowerCase() !== "failure") {
      bucket.success += 1;
    }
  });
  pageInteractiveLogs.forEach((log) => addDuration(log, "pageDurations"));
  apiLogs.forEach((log) => addDuration(log, "apiDurations"));

  return Array.from(buckets.values()).map((bucket) => {
    const avg = (values) => values.length
      ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
      : 0;
    return {
      day: bucket.day,
      label: useHourBuckets ? `${bucket.day.slice(11)}:00` : bucket.day.slice(5),
      pageAvgDurationMs: avg(bucket.pageDurations),
      apiAvgDurationMs: avg(bucket.apiDurations),
      successRate: bucket.total ? Math.round((bucket.success / bucket.total) * 1000) / 10 : 100,
      score: bucket.total ? getPerformanceScore(avg(bucket.pageDurations) || avg(bucket.apiDurations), bucket.total ? Math.round((bucket.success / bucket.total) * 1000) / 10 : 100) : 0,
      totalEvents: bucket.total,
      pageEvents: bucket.pageDurations.length,
      apiEvents: bucket.apiDurations.length
    };
  });
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
      timelineAt: String(lead?.createdAtExact || lead?.createdAt || "").trim(),
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

function isLsqArchivedLead(lead = {}) {
  return Boolean(lead?.lsqArchivedLead)
    || String(lead?.counselor || "").trim().toLowerCase() === LSQ_ARCHIVED_COUNSELOR.toLowerCase();
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

function normalizeMonitoringText(value) {
  return String(value || "").trim().toLowerCase();
}

const MONITORING_ALIAS_STOP_WORDS = new Set([
  "mr",
  "mrs",
  "ms",
  "miss",
  "dr",
  "md",
  "mohd",
  "mohammed",
  "mohammad",
  "muhammad",
  "ur"
]);

function normalizeMonitoringAliasKey(value) {
  return normalizeMonitoringText(value)
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getMonitoringAliasTokens(value) {
  return normalizeMonitoringAliasKey(value).split(" ").filter(Boolean);
}

function getMonitoringAliasKeys(value) {
  const normalized = normalizeMonitoringAliasKey(value);
  if (!normalized) return [];
  const tokens = getMonitoringAliasTokens(value);
  const filteredTokens = tokens.filter((token) => !MONITORING_ALIAS_STOP_WORDS.has(token));
  const keys = new Set([normalized]);
  if (filteredTokens.length) keys.add(filteredTokens.join(" "));
  if (tokens.length >= 2) keys.add(`${tokens[0]} ${tokens[tokens.length - 1]}`);
  if (filteredTokens.length >= 2) keys.add(`${filteredTokens[0]} ${filteredTokens[filteredTokens.length - 1]}`);
  return [...keys].filter(Boolean);
}

function getMonitoringFirstName(value) {
  return normalizeMonitoringText(String(value || "").trim().split(/\s+/).filter(Boolean)[0] || "");
}

function buildMonitoringCounselorDirectory(counselors = []) {
  const aliasToName = new Map();
  const aliasCandidates = new Map();
  const firstNameToNames = new Map();
  const names = [];

  const registerAliasCandidate = (alias, name) => {
    const key = normalizeMonitoringAliasKey(alias);
    if (!key || !name) return;
    const candidates = aliasCandidates.get(key) || new Set();
    candidates.add(name);
    aliasCandidates.set(key, candidates);
  };

  (Array.isArray(counselors) ? counselors : []).forEach((item) => {
    const name = String(item?.name || "").trim();
    const email = String(item?.email || "").trim().toLowerCase();
    const explicitAliases = [
      ...(Array.isArray(item?.aliases) ? item.aliases : []),
      ...String(item?.alias || "").split(",")
    ].map((value) => String(value || "").trim()).filter(Boolean);

    if (name) {
      names.push(name);
      getMonitoringAliasKeys(name).forEach((alias) => registerAliasCandidate(alias, name));
      const firstName = getMonitoringFirstName(name);
      if (firstName) {
        const current = firstNameToNames.get(firstName) || new Set();
        current.add(name);
        firstNameToNames.set(firstName, current);
      }
    }
    if (email && name) registerAliasCandidate(email, name);
    explicitAliases.forEach((alias) => {
      getMonitoringAliasKeys(alias).forEach((key) => registerAliasCandidate(key, name));
    });
  });

  aliasCandidates.forEach((matchedNames, alias) => {
    if (matchedNames.size === 1) {
      aliasToName.set(alias, [...matchedNames][0]);
    }
  });
  firstNameToNames.forEach((matchedNames, firstName) => {
    if (matchedNames.size === 1 && !aliasToName.has(firstName)) {
      aliasToName.set(firstName, [...matchedNames][0]);
    }
  });

  return {
    aliasToName,
    names: [...new Set(names)].sort((left, right) => left.localeCompare(right))
  };
}

function getDashboardDateKeyExpression() {
  return {
    $substrBytes: [
      {
        $toString: {
          $ifNull: [
            "$createdAt",
            { $ifNull: ["$createdAtExact", ""] }
          ]
        }
      },
      0,
      10
    ]
  };
}

function getDashboardStageExpression() {
  return {
    $switch: {
      branches: [
        {
          case: { $eq: [{ $toLower: { $ifNull: ["$leadPipeline", ""] } }, MAIN_ADMISSION_PIPELINE] },
          then: "main-admission"
        },
        {
          case: { $eq: [{ $toLower: { $ifNull: ["$leadPipeline", ""] } }, "course-registration"] },
          then: "registered-course"
        },
        {
          case: {
            $or: [
              { $eq: [{ $toLower: { $ifNull: ["$leadPipeline", ""] } }, "admission"] },
              { $eq: ["$postStatusUpdated", true] }
            ]
          },
          then: "admission"
        }
      ],
      default: "workshop"
    }
  };
}

function getDashboardSummaryAggregationPipeline() {
  return [
    {
      $project: {
        dateKey: getDashboardDateKeyExpression(),
        timelineAt: {
          $toString: {
            $ifNull: [
              "$createdAtExact",
              { $ifNull: ["$createdAt", ""] }
            ]
          }
        },
        workshop: {
          $trim: {
            input: {
              $toString: {
                $ifNull: [
                  "$workshop",
                  { $ifNull: ["$workshopName", ""] }
                ]
              }
            }
          }
        },
        admissionWorkshop: {
          $trim: {
            input: {
              $toString: {
                $ifNull: [
                  "$admissionWorkshop",
                  {
                    $ifNull: [
                      "$courseName",
                      { $ifNull: ["$workshop", ""] }
                    ]
                  }
                ]
              }
            }
          }
        },
        stage: getDashboardStageExpression(),
        leadPipeline: { $toLower: { $toString: { $ifNull: ["$leadPipeline", ""] } } },
        publicCourseSegment: { $toLower: { $toString: { $ifNull: ["$publicCourseSegment", ""] } } },
        admissionStatus: { $toString: { $ifNull: ["$admissionStatus", ""] } },
        registeredAdmissionStatus: { $toString: { $ifNull: ["$registeredAdmissionStatus", ""] } },
        mainAdmissionAdmissionStatus: { $toString: { $ifNull: ["$mainAdmissionAdmissionStatus", ""] } }
      }
    },
    {
      $match: {
        dateKey: { $regex: "^\\d{4}-\\d{2}-\\d{2}" }
      }
    },
    {
      $group: {
        _id: {
          dateKey: "$dateKey",
          workshop: "$workshop",
          admissionWorkshop: "$admissionWorkshop",
          stage: "$stage",
          leadPipeline: "$leadPipeline",
          publicCourseSegment: "$publicCourseSegment",
          admissionStatus: "$admissionStatus",
          registeredAdmissionStatus: "$registeredAdmissionStatus",
          mainAdmissionAdmissionStatus: "$mainAdmissionAdmissionStatus"
        },
        leadCount: { $sum: 1 },
        timelineAt: { $min: "$timelineAt" }
      }
    },
    {
      $project: {
        _id: 0,
        createdAt: "$_id.dateKey",
        timelineAt: "$timelineAt",
        workshop: "$_id.workshop",
        admissionWorkshop: "$_id.admissionWorkshop",
        stage: "$_id.stage",
        leadPipeline: "$_id.leadPipeline",
        publicCourseSegment: "$_id.publicCourseSegment",
        admissionStatus: "$_id.admissionStatus",
        registeredAdmissionStatus: "$_id.registeredAdmissionStatus",
        mainAdmissionAdmissionStatus: "$_id.mainAdmissionAdmissionStatus",
        leadCount: "$leadCount"
      }
    },
    {
      $sort: {
        createdAt: 1,
        workshop: 1,
        admissionWorkshop: 1
      }
    }
  ];
}

function buildDashboardSummaryFromRows(rows = [], updatedAt = null) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const totalLeads = safeRows.reduce((sum, row) => sum + (Number(row?.leadCount) || 0), 0);
  const workshopLeadCount = new Map();
  let latestLeadTimestamp = null;

  safeRows.forEach((row) => {
    const dateValue = parseDateKeyToTime(row?.timelineAt || row?.createdAt);
    if (dateValue !== null && (latestLeadTimestamp === null || dateValue > latestLeadTimestamp)) {
      latestLeadTimestamp = dateValue;
    }

    const workshopName = String(
      row?.workshop ||
      row?.admissionWorkshop ||
      ""
    ).trim();
    if (!workshopName) {
      return;
    }
    workshopLeadCount.set(workshopName, (workshopLeadCount.get(workshopName) || 0) + (Number(row?.leadCount) || 0));
  });

  const workshopEntries = Array.from(workshopLeadCount.entries())
    .map(([name, leadCount]) => ({ name, leadCount }))
    .sort((left, right) => right.leadCount - left.leadCount || left.name.localeCompare(right.name));

  return {
    updatedAt,
    latestLeadDate: latestLeadTimestamp === null ? null : new Date(latestLeadTimestamp).toISOString(),
    totals: {
      activeWorkshops: workshopEntries.length,
      upcomingWorkshops: 0,
      recentWorkshops: workshopEntries.slice(0, 10).length,
      scopedLeads: totalLeads
    },
    leadTimelineRows: safeRows.map((row) => ({
      createdAt: normalizeDashboardDateKey(row?.createdAt),
      timelineAt: String(row?.timelineAt || row?.createdAt || "").trim(),
      workshop: String(row?.workshop || "").trim(),
      admissionWorkshop: String(row?.admissionWorkshop || row?.workshop || "").trim(),
      stage: String(row?.stage || "").trim(),
      leadPipeline: String(row?.leadPipeline || "").trim().toLowerCase(),
      publicCourseSegment: normalizePublicCourseSegment(row?.publicCourseSegment || ""),
      admissionStatus: String(row?.admissionStatus || "").trim(),
      registeredAdmissionStatus: String(row?.registeredAdmissionStatus || "").trim(),
      mainAdmissionAdmissionStatus: String(row?.mainAdmissionAdmissionStatus || "").trim(),
      leadCount: Number(row?.leadCount) || 0
    })).filter((row) => row.createdAt && row.leadCount > 0),
    workshopBreakdown: workshopEntries.slice(0, 25)
  };
}

function resolveMonitoringCounselorName(value, directory, allowRaw = false) {
  const rawValue = String(value || "").trim();
  if (!rawValue) return "";
  const aliasMatch = getMonitoringAliasKeys(rawValue)
    .map((alias) => directory?.aliasToName?.get(alias))
    .find(Boolean);
  if (aliasMatch) return aliasMatch;
  const emailMatch = directory?.aliasToName?.get(normalizeMonitoringText(rawValue));
  return emailMatch || (allowRaw ? rawValue : "");
}

function getMonitoringSessionIdentity(session = {}, directory) {
  if (session.role !== "counselor") return "";
  return normalizeMonitoringText(
    resolveMonitoringCounselorName(session.name || session.email, directory, true)
  );
}

function parseMonitoringDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T00:00:00+05:30`)
    : new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getMonitoringDayRange(offsetDays = 0) {
  const now = new Date();
  const dateKey = toKolkataDateKey(new Date(now.getTime() + (offsetDays * 86400000)));
  return {
    start: new Date(`${dateKey}T00:00:00+05:30`),
    end: new Date(`${dateKey}T23:59:59.999+05:30`)
  };
}

function getMonitoringTimelineRange(query = {}) {
  const type = String(query.type || "week").trim().toLowerCase();
  if (type === "overall") return null;
  if (type === "today") return getMonitoringDayRange(0);
  if (type === "yesterday") return getMonitoringDayRange(-1);
  if (type === "recent") {
    return { start: getMonitoringDayRange(-29).start, end: getMonitoringDayRange(0).end };
  }
  if (type === "custom") {
    const start = parseMonitoringDate(query.startDate);
    const endBase = parseMonitoringDate(query.endDate);
    if (!start || !endBase) return null;
    return { start, end: new Date(`${toKolkataDateKey(endBase)}T23:59:59.999+05:30`) };
  }
  return { start: getMonitoringDayRange(-6).start, end: getMonitoringDayRange(0).end };
}

function normalizeMonitoringLeadFields(leads = []) {
  return (Array.isArray(leads) ? leads : []).map((lead) => ({
    ...lead,
    counselor: lead?.counselor || "Unassigned",
    workshop: lead?.workshop || "",
    courseName: lead?.courseName || "",
    createdAt: lead?.createdAt || toKolkataDateKey(),
    workshopActivityHistory: Array.isArray(lead?.workshopActivityHistory) ? lead.workshopActivityHistory : [],
    admissionActivityHistory: Array.isArray(lead?.admissionActivityHistory) ? lead.admissionActivityHistory : [],
    registeredCourseActivityHistory: Array.isArray(lead?.registeredCourseActivityHistory) ? lead.registeredCourseActivityHistory : [],
    mainAdmissionActivityHistory: Array.isArray(lead?.mainAdmissionActivityHistory) ? lead.mainAdmissionActivityHistory : [],
    mcubeCallHistory: Array.isArray(lead?.mcubeCallHistory) ? lead.mcubeCallHistory : []
  }));
}

function getMonitoringCounselorNamesFromData(leads = [], counselors = [], session = {}, directory) {
  const names = new Set(directory?.names || (Array.isArray(counselors) ? counselors : [])
    .map((counselor) => String(counselor?.name || "").trim())
    .filter(Boolean));
  if (session.role === "counselor") {
    const own = getMonitoringSessionIdentity(session, directory);
    return [...names].filter((name) => normalizeMonitoringText(name) === own);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

function getMonitoringHistoryInRange(history = [], range = null) {
  const entries = Array.isArray(history) ? history : [];
  if (!range) return entries;
  return entries.filter((entry) => {
    const date = parseMonitoringDate(entry?.at);
    return date && date >= range.start && date <= range.end;
  });
}

const MONITORING_SYSTEM_ACTIVITY_ACTORS = new Set(["reachout webhook", "system"]);
const MONITORING_EXCLUDED_ACTIVITY_TYPES = new Set([
  "Lead Created",
  "Lead Assigned",
  "Lead Reassigned",
  "Counselor Changed",
  "Lead Viewed"
]);
const MONITORING_ACTIVITY_OPTIONS = {
  workshopActivityHistory: {
    activityFields: ["dialed", "callStatus", "wsStatus"],
    excludedFields: ["whatsappInvite", "whatsappGroupStatus"]
  },
  admissionActivityHistory: {
    activityFields: ["postDialed", "coursePitched", "courseStatus", "admissionStatus", "postCallStatus", "workshopJoiningStatus"]
  },
  mainAdmissionActivityHistory: {
    activityFields: ["mainAdmissionDialed", "mainAdmissionCoursePitched", "mainAdmissionCourseStatus", "mainAdmissionAdmissionStatus", "mainAdmissionCallStatus"]
  },
  registeredCourseActivityHistory: {
    activityFields: ["registeredDialed", "registeredCoursePitched", "registeredCourseStatus", "registeredAdmissionStatus", "registeredCallStatus"]
  }
};

function hasMonitoringWhatsAppSignal(value) {
  return /whatsapp|reachout/i.test(String(value || "").trim());
}

function isMonitoringSystemActivityEntry(entry = {}) {
  const by = String(entry?.by || "").trim().toLowerCase();
  const source = String(entry?.source || "").trim().toLowerCase();
  return MONITORING_SYSTEM_ACTIVITY_ACTORS.has(by)
    || MONITORING_SYSTEM_ACTIVITY_ACTORS.has(source)
    || source.includes("webhook");
}

function isMonitoringCounselorActivityEntry(entry = {}, options = {}) {
  if (!entry || typeof entry !== "object" || isMonitoringSystemActivityEntry(entry)) {
    return false;
  }

  const activityType = String(entry.activityType || entry.type || entry.eventType || entry.actionType || entry.label || "").trim();
  const actionDescription = String(entry.actionDescription || entry.description || "").trim();
  if (
    MONITORING_EXCLUDED_ACTIVITY_TYPES.has(activityType)
    || hasMonitoringWhatsAppSignal(activityType)
    || hasMonitoringWhatsAppSignal(actionDescription)
  ) {
    return false;
  }

  const updates = entry.updates && typeof entry.updates === "object" ? entry.updates : null;
  if (!updates) {
    return Boolean(activityType || String(entry.by || "").trim());
  }

  const allowedFields = new Set((options.activityFields || []).map((item) => String(item || "").trim()).filter(Boolean));
  const excludedFields = new Set((options.excludedFields || []).map((item) => String(item || "").trim()).filter(Boolean));
  return Object.keys(updates).some((field) => {
    const normalizedField = String(field || "").trim();
    if (!normalizedField || excludedFields.has(normalizedField) || hasMonitoringWhatsAppSignal(normalizedField)) {
      return false;
    }
    return !allowedFields.size || allowedFields.has(normalizedField);
  });
}

function getMonitoringActivityRecords(leads, field, counselor, range, directory) {
  const target = normalizeMonitoringText(counselor);
  const activityOptions = MONITORING_ACTIVITY_OPTIONS[field] || {};
  return leads.reduce((records, lead) => {
    const matchingEntries = getMonitoringHistoryInRange(lead?.[field], range)
      .filter((entry) =>
        normalizeMonitoringText(resolveMonitoringCounselorName(entry?.by, directory, false)) === target
        && isMonitoringCounselorActivityEntry(entry, activityOptions)
      );
    if (matchingEntries.length) records.push({ lead, activityCount: 1, matchingEntries });
    return records;
  }, []);
}

function getMonitoringLatestUpdate(entries, field) {
  const latest = [...(Array.isArray(entries) ? entries : [])]
    .filter((entry) => entry?.updates && Object.prototype.hasOwnProperty.call(entry.updates, field))
    .sort((left, right) => (parseMonitoringDate(right?.at)?.getTime() || 0) - (parseMonitoringDate(left?.at)?.getTime() || 0))[0];
  return String(latest?.updates?.[field] || "").trim();
}

function countMonitoringLatest(records, field, expected) {
  const target = normalizeMonitoringText(expected);
  return records.filter((record) => normalizeMonitoringText(getMonitoringLatestUpdate(record.matchingEntries, field)) === target).length;
}

function getMonitoringOwnershipDate(lead) {
  return parseMonitoringDate(lead?.leadOwnerTimelineAt || lead?.counselorAssignedAt || lead?.createdAtExact || lead?.createdAt);
}

function wasMonitoringLeadCreatedByCounselor(lead, counselor, directory) {
  if (!lead?.leadCreationRequestId && !lead?.requestedBy && !lead?.requestedByEmail) return false;
  const target = normalizeMonitoringText(counselor);
  return [lead?.requestedBy, lead?.requestedByEmail]
    .some((value) => normalizeMonitoringText(resolveMonitoringCounselorName(value, directory, true)) === target);
}

function countMonitoringAssigned(rawLeads, counselor, range, directory) {
  const target = normalizeMonitoringText(counselor);
  const assigned = rawLeads.filter((lead) =>
    normalizeMonitoringText(resolveMonitoringCounselorName(lead?.counselor, directory, true)) === target &&
    !wasMonitoringLeadCreatedByCounselor(lead, counselor, directory)
  );
  if (!range) return assigned.length;
  return assigned.filter((lead) => {
    const date = getMonitoringOwnershipDate(lead);
    return date && date >= range.start && date <= range.end;
  }).length;
}

function splitMonitoringFreshOld(activityLeads, countField, range) {
  const activities = activityLeads.length;
  if (!range) return { activities, freshLeadTouches: activityLeads.length, oldLeadTouches: 0 };
  const freshLeadTouches = activityLeads.filter((lead) => {
    const date = getMonitoringOwnershipDate(lead);
    return date && date >= range.start;
  }).length;
  return { activities, freshLeadTouches, oldLeadTouches: activityLeads.length - freshLeadTouches };
}

function monitoringBreakdown(items, getLabel, countField) {
  const counts = new Map();
  items.forEach((item) => {
    const label = String(typeof getLabel === "function" ? getLabel(item) : item?.[getLabel] || "").trim() || "Unspecified";
    counts.set(label, (counts.get(label) || 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
}

function rowHasMonitoringData(row) {
  return Object.entries(row).some(([key, value]) => key !== "counselor" && key !== "talkTimeLabel" && typeof value === "number" && value > 0);
}

function filterMonitoringRows(rows, session) {
  return session.role === "counselor" ? rows : rows.filter(rowHasMonitoringData);
}

function sortMonitoringRows(rows) {
  return [...rows].sort((a, b) => (b.activities || b.totalCalls || 0) - (a.activities || a.totalCalls || 0) || String(a.counselor).localeCompare(String(b.counselor)));
}

function buildMonitoringRowsForSubsection(subsection, counselors, timelineLeads, rawLeads, range, session, directory) {
  const config = {
    "workshop-calling": ["workshopActivityHistory", "preActivityUpdates", "workshop", { interested: ["wsStatus", "Interested"], notInterested: ["wsStatus", "Not Interested"], whatsappJoined: ["whatsappGroupStatus", "Joined"] }],
    "admission-calling": ["admissionActivityHistory", "postActivityUpdates", (lead) => lead.admissionWorkshop || lead.workshop, { interested: ["courseStatus", "Interested"], notInterested: ["courseStatus", "Not Interested"], enrolled: ["admissionStatus", "Enrolled"], won: ["admissionStatus", "Won"] }],
    "main-admission": ["mainAdmissionActivityHistory", "mainAdmissionActivityUpdates", (lead) => lead.mainAdmissionCoursePitched || lead.courseName, { interested: ["mainAdmissionCourseStatus", "Interested"], notInterested: ["mainAdmissionCourseStatus", "Not Interested"], enrolled: ["mainAdmissionAdmissionStatus", "Enrolled"], won: ["mainAdmissionAdmissionStatus", "Won"] }],
    "registered-candidates": ["registeredCourseActivityHistory", "registeredCourseActivityUpdates", "courseName", { dialed: ["registeredDialed", "Yes"], interested: ["registeredCourseStatus", "Interested"], notInterested: ["registeredCourseStatus", "Not Interested"] }],
    "crash-course": ["registeredCourseActivityHistory", "registeredCourseActivityUpdates", "courseName", { dialed: ["registeredDialed", "Yes"], interested: ["registeredCourseStatus", "Interested"], notInterested: ["registeredCourseStatus", "Not Interested"] }]
  }[subsection] || null;
  if (!config) return [];
  const [historyField, countField, breakdownLabel, counters] = config;
  return filterMonitoringRows(sortMonitoringRows(counselors.map((counselor) => {
    const records = getMonitoringActivityRecords(timelineLeads, historyField, counselor, range, directory);
    const activityLeads = records.map((record) => ({ ...record.lead, [countField]: record.activityCount }));
    const row = {
      counselor,
      ...splitMonitoringFreshOld(activityLeads, countField, range),
      entries: monitoringBreakdown(activityLeads, breakdownLabel, countField),
      assignedLeads: countMonitoringAssigned(rawLeads, counselor, range, directory)
    };
    Object.entries(counters).forEach(([key, [field, expected]]) => {
      row[key] = countMonitoringLatest(records, field, expected);
    });
    return row;
  })), session);
}

function formatMonitoringTalkTime(secondsValue) {
  const seconds = Math.max(0, Math.round(Number(secondsValue) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  if (hours) return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(remaining).padStart(2, "0")}s`;
  if (minutes) return `${minutes}m ${String(remaining).padStart(2, "0")}s`;
  return `${remaining}s`;
}

function normalizeMonitoringMcubeTalkTimeSeconds(value) {
  if (value === null || value === undefined || value === "") {
    return 0;
  }

  const numeric = Number(value);
  const seconds = Math.max(0, Number.isFinite(numeric) ? numeric : 0);
  if (!seconds) {
    const text = String(value).trim().toLowerCase();
    const hhmmssMatch = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (hhmmssMatch) {
      const first = Number(hhmmssMatch[1]);
      const second = Number(hhmmssMatch[2]);
      const third = Number(hhmmssMatch[3] || 0);
      const parsed = hhmmssMatch[3] ? (first * 3600) + (second * 60) + third : (first * 60) + second;
      return parsed > 8 * 60 * 60 ? 0 : parsed;
    }

    const compactMatch = text.match(/^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?\s*(?:(\d+)\s*s)?$/);
    if (compactMatch) {
      const hours = Number(compactMatch[1] || 0);
      const minutes = Number(compactMatch[2] || 0);
      const remainingSeconds = Number(compactMatch[3] || 0);
      const parsed = (hours * 3600) + (minutes * 60) + remainingSeconds;
      return parsed > 8 * 60 * 60 ? 0 : parsed;
    }
    return 0;
  }

  if (seconds > 8 * 60 * 60) {
    return 0;
  }

  return Math.round(seconds);
}

function getMonitoringMcubeEntryTalkTimeSeconds(entry = {}) {
  const storedDuration = normalizeMonitoringMcubeTalkTimeSeconds(entry?.duration);
  if (storedDuration > 0) {
    return storedDuration;
  }

  const rawFields = entry?.mcubeFields && typeof entry.mcubeFields === "object" ? entry.mcubeFields : {};
  return normalizeMonitoringMcubeTalkTimeSeconds(
    deriveMcubeTalkTimeDuration(
      {
        ...rawFields,
        duration: entry?.duration ?? rawFields.duration,
        call_duration: rawFields.call_duration,
        callDuration: rawFields.callDuration,
        talktime: rawFields.talktime,
        talk_time: rawFields.talk_time,
        talkTime: rawFields.talkTime,
        recording_duration: rawFields.recording_duration,
        recordingDuration: rawFields.recordingDuration,
        dialstatus: entry?.disposition || entry?.rawStatus || rawFields.dialstatus || rawFields.disposition || rawFields.call_status,
        disposition: entry?.disposition || entry?.rawStatus || rawFields.disposition || rawFields.dialstatus || rawFields.call_status,
        call_status: rawFields.call_status || rawFields.callStatus,
        callStatus: rawFields.callStatus || rawFields.call_status
      },
      entry?.startedAt || rawFields.starttime || rawFields.started_at || rawFields.start_time || rawFields.startTime || entry?.at || "",
      entry?.endedAt || rawFields.endtime || rawFields.ended_at || rawFields.end_time || rawFields.endTime || "",
      entry?.answeredTime || rawFields.answeredtime || rawFields.answered_time || rawFields.answerTime || ""
    )
  );
}

function buildMonitoringMcubeReport(rawLeads, range, session, directory) {
  const calls = [];
  const sessionIdentity = getMonitoringSessionIdentity(session, directory);
  rawLeads.forEach((lead) => {
    getMonitoringHistoryInRange(lead?.mcubeCallHistory, range).forEach((entry) => {
      const counselor = resolveMonitoringCounselorName(entry?.agentName || entry?.counselor || lead?.counselor, directory, true) || "Unassigned";
      if (session.role === "counselor" && normalizeMonitoringText(counselor) !== sessionIdentity) return;
      const status = String(entry?.normalizedStatus || entry?.disposition || entry?.rawStatus || entry?.eventType || "").trim();
      const picked = /(answer|answered|connected|completed|success)/i.test(status);
      calls.push({
        counselor,
        direction: normalizeMonitoringText(entry?.direction),
        picked,
        duration: getMonitoringMcubeEntryTalkTimeSeconds(entry)
      });
    });
  });
  const grouped = new Map();
  calls.forEach((call) => {
    const row = grouped.get(call.counselor) || { counselor: call.counselor, totalCalls: 0, outboundCalls: 0, inboundCalls: 0, callPicked: 0, callNotPicked: 0, talkTimeSeconds: 0 };
    row.totalCalls += 1;
    if (call.direction === "outbound") row.outboundCalls += 1;
    if (call.direction === "inbound") row.inboundCalls += 1;
    if (call.picked) row.callPicked += 1; else row.callNotPicked += 1;
    row.talkTimeSeconds += call.duration;
    row.talkTimeLabel = formatMonitoringTalkTime(row.talkTimeSeconds);
    grouped.set(call.counselor, row);
  });
  const rows = filterMonitoringRows([...grouped.values()].sort((a, b) => b.totalCalls - a.totalCalls || a.counselor.localeCompare(b.counselor)), session);
  return {
    rows,
    metrics: [
      { label: "Total Calls", value: calls.length },
      { label: "Outbound Calls", value: calls.filter((call) => call.direction === "outbound").length },
      { label: "Inbound Calls", value: calls.filter((call) => call.direction === "inbound").length },
      { label: "Call Picked", value: calls.filter((call) => call.picked).length },
      { label: "Call Not Picked / Not Connected", value: calls.filter((call) => !call.picked).length },
      { label: "Total Talk Time", value: formatMonitoringTalkTime(calls.reduce((sum, call) => sum + call.duration, 0)) }
    ],
    columns: ["Counselor Name", "Total Calls", "Outbound Calls", "Inbound Calls", "Call Picked", "Call Not Picked / Not Connected", "Talk Time"]
  };
}

function getServerReportingContexts(lead = {}) {
  return [
    {
      historyField: "mainAdmissionActivityHistory",
      coursePitchedField: "mainAdmissionCoursePitched",
      courseStatusField: "mainAdmissionCourseStatus",
      admissionStatusField: "mainAdmissionAdmissionStatus",
      callStatusField: "mainAdmissionCallStatus"
    }
  ].map((context) => ({
    ...context,
    history: Array.isArray(lead?.[context.historyField]) ? lead[context.historyField] : []
  }));
}

function isServerAdmissionReportingLead(lead = {}) {
  return isMainAdmissionPipelineValue(lead?.leadPipeline)
    || getServerReportingContexts(lead).some((context) =>
      context.history.length
      || String(lead?.[context.coursePitchedField] || "").trim()
      || String(lead?.[context.courseStatusField] || "").trim()
      || String(lead?.[context.admissionStatusField] || "").trim()
      || String(lead?.[context.callStatusField] || "").trim()
    );
}

function getServerReportingEventStatus(field, value) {
  const normalized = normalizeMonitoringText(value);
  const normalizedField = String(field || "").toLowerCase();
  if (!normalized) return "";
  if (normalizedField.includes("admissionstatus") && normalized === "enrolled") return "Enrolled";
  if (normalizedField.includes("callstatus") && normalized === "cnc") return "CNC";
  if (normalizedField.includes("callstatus") && normalized === "cbl") return "CBL";
  if (normalizedField.includes("coursestatus") && (normalized === "not interested" || normalized === "ni")) return "NI";
  return "";
}

function getServerReportingEventsForLead(lead = {}, range = null) {
  const events = [];
  getServerReportingContexts(lead).forEach((context) => {
    context.history.forEach((entry) => {
      const eventDate = parseMonitoringDate(entry?.at);
      if (range && (!eventDate || eventDate < range.start || eventDate > range.end)) return;
      const updates = entry?.updates && typeof entry.updates === "object" ? entry.updates : {};
      Object.entries(updates).forEach(([field, value]) => {
        if (![context.admissionStatusField, context.courseStatusField, context.callStatusField].includes(field)) return;
        const bucket = getServerReportingEventStatus(field, value);
        if (!bucket) return;
        events.push({
          bucket,
          at: entry?.at || "",
          counselor: entry?.by || entry?.counselor || lead?.counselor || ""
        });
      });
    });
  });
  return events;
}

function getServerCurrentReportingBucketForLead(lead = {}) {
  const contexts = getServerReportingContexts(lead);
  if (contexts.some((context) => normalizeMonitoringText(lead?.[context.admissionStatusField]) === "enrolled")) {
    return "Enrolled";
  }
  return contexts
    .flatMap((context) => [
      [context.callStatusField, lead?.[context.callStatusField]],
      [context.courseStatusField, lead?.[context.courseStatusField]]
    ])
    .map(([field, value]) => getServerReportingEventStatus(field, value))
    .find((bucket) => ["CNC", "CBL", "NI"].includes(bucket)) || "";
}

function hasServerCounselorAdmissionActivity(lead = {}, counselor = "") {
  const normalizedCounselor = normalizeMonitoringText(counselor);
  return getServerReportingContexts(lead).some((context) =>
    context.history.some((entry) =>
      normalizeMonitoringText(entry?.by || entry?.counselor) === normalizedCounselor
      && isMonitoringActivityEntry(entry, MONITORING_ACTIVITY_OPTIONS_BY_HISTORY_FIELD[context.historyField])
    )
  );
}

function getServerAssignmentCourseValue(lead = {}) {
  return String(lead?.mainAdmissionCoursePitched || lead?.courseName || lead?.courseCode || "").trim();
}

function getServerAssignmentCourseColumnKey(value = "") {
  const text = String(value || "").trim();
  if (!text || /^(select|n\/a|na|none|null|undefined)$/i.test(text)) return "unspecified";
  if (/pre\s*workshop|post\s*workshop|workshop\s*calling/i.test(text)) return "unspecified";
  const matched = [
    { key: "apids", patterns: [/apids/i, /industrial\s+data\s+science/i] },
    { key: "apida", patterns: [/apida/i, /industrial\s+data\s+analytics/i] },
    { key: "da", patterns: [/^da$/i, /\bdas\b/i, /data\s+analytics\s+specialist/i] },
    { key: "aiml", patterns: [/\baiml\b/i, /advanced\s+aiml/i, /aiml\s*\+?\s*gen\s*ai/i] },
    { key: "days7Genai", patterns: [/7\s*days/i, /7days/i, /days7/i, /hands[-\s]*on\s+master/i] },
    { key: "genai", patterns: [/genai\s*master/i, /gen\s*ai\s*master/i, /master\s+program\s+in\s+gen\s*ai/i, /generative\s+ai/i] },
    { key: "cyberSecurity", patterns: [/cyber/i, /forensics/i, /\bapcs\b/i] },
    { key: "fde", patterns: [/\bfde\b/i, /forward\s+deployed\s+engineer/i, /forward\s+deployment\s+engineer/i] }
  ].find((column) => column.patterns.some((pattern) => pattern.test(text)));
  return matched?.key || "unspecified";
}

function getServerLeadOwnershipDate(lead = {}) {
  return parseMonitoringDate(lead.leadOwnerTimelineAt || lead.counselorAssignedAt || lead.createdAtExact || lead.createdAt);
}

function wasServerLeadCreatedByCounselor(lead = {}, counselor = "") {
  const normalized = normalizeMonitoringText(counselor);
  return normalizeMonitoringText(lead?.requestedBy || lead?.createdBy || lead?.createdByCounselor) === normalized;
}

function getServerAssignedAdmissionLeadsForCounselor(leads, counselor, range = null, directory) {
  const normalizedCounselor = normalizeMonitoringText(counselor);
  return leads.filter((lead) => {
    if (!isServerAdmissionReportingLead(lead)) return false;
    if (normalizeMonitoringText(resolveMonitoringCounselorName(lead?.counselor, directory, true)) !== normalizedCounselor) return false;
    if (wasServerLeadCreatedByCounselor(lead, counselor)) return false;
    if (range) {
      const assignmentDate = getServerLeadOwnershipDate(lead);
      if (!assignmentDate || assignmentDate < range.start || assignmentDate > range.end) return false;
    }
    return true;
  });
}

function buildServerReportingRows(counselors, leads, range = null, directory) {
  return counselors.map((counselor) => {
    const countedByBucket = { enrolled: new Set(), pde: new Set(), cnc: new Set(), cbl: new Set(), ni: new Set() };
    const normalizedCounselor = normalizeMonitoringText(counselor);
    leads.filter(isServerAdmissionReportingLead).forEach((lead) => {
      const leadKey = [lead?.id, lead?.email, lead?.phone].map((value) => String(value || "")).join("::");
      const assignedToCounselor = normalizeMonitoringText(resolveMonitoringCounselorName(lead?.counselor, directory, true)) === normalizedCounselor;
      getServerReportingContexts(lead).forEach((context) => {
        const pitched = String(lead?.[context.coursePitchedField] || "").trim();
        if (!range && assignedToCounselor && pitched) countedByBucket.pde.add(leadKey);
        context.history.forEach((entry) => {
          const eventDate = parseMonitoringDate(entry?.at);
          if (range && (!eventDate || eventDate < range.start || eventDate > range.end)) return;
          if (normalizeMonitoringText(entry?.by || entry?.counselor) !== normalizedCounselor) return;
          const updates = entry?.updates && typeof entry.updates === "object" ? entry.updates : {};
          if (updates[context.coursePitchedField]) countedByBucket.pde.add(leadKey);
        });
      });
      const events = getServerReportingEventsForLead(lead, range)
        .filter((event) => normalizeMonitoringText(event.counselor) === normalizedCounselor)
        .sort((left, right) => (parseMonitoringDate(right.at)?.getTime() || 0) - (parseMonitoringDate(left.at)?.getTime() || 0));
      const latestDisposition = events.find((event) => ["CNC", "CBL", "NI"].includes(event.bucket));
      if (events.some((event) => event.bucket === "Enrolled")) countedByBucket.enrolled.add(leadKey);
      if (latestDisposition?.bucket === "CNC") countedByBucket.cnc.add(leadKey);
      if (latestDisposition?.bucket === "CBL") countedByBucket.cbl.add(leadKey);
      if (latestDisposition?.bucket === "NI") countedByBucket.ni.add(leadKey);
      if (!range && assignedToCounselor) {
        const currentBucket = getServerCurrentReportingBucketForLead(lead);
        if (currentBucket === "Enrolled") countedByBucket.enrolled.add(leadKey);
        if (currentBucket === "CNC") countedByBucket.cnc.add(leadKey);
        if (currentBucket === "CBL") countedByBucket.cbl.add(leadKey);
        if (currentBucket === "NI") countedByBucket.ni.add(leadKey);
      }
    });
    const assigned = getServerAssignedAdmissionLeadsForCounselor(leads, counselor, null, directory);
    return {
      counselor,
      enrolled: countedByBucket.enrolled.size,
      pde: countedByBucket.pde.size,
      cnc: countedByBucket.cnc.size,
      cbl: countedByBucket.cbl.size,
      ni: countedByBucket.ni.size,
      pendingLeads: assigned.filter((lead) => !hasServerCounselorAdmissionActivity(lead, counselor)).length
    };
  }).filter((row) => Object.values(row).some((value) => typeof value === "number" && value > 0));
}

function buildServerLeadAssignmentRows(counselors, leads, range = null, directory) {
  const courseKeys = ["apids", "apida", "da", "aiml", "days7Genai", "genai", "cyberSecurity", "fde", "unspecified"];
  return counselors.map((counselor) => {
    const row = { counselor, total: 0 };
    courseKeys.forEach((key) => { row[key] = 0; });
    getServerAssignedAdmissionLeadsForCounselor(leads, counselor, range, directory).forEach((lead) => {
      const key = getServerAssignmentCourseColumnKey(getServerAssignmentCourseValue(lead));
      row[key] += 1;
      row.total += 1;
    });
    return row;
  }).sort((left, right) => right.total - left.total || String(left.counselor).localeCompare(String(right.counselor)));
}

function buildServerManagementMonitoringReport(subsection, rawLeads, counselors, range, session, directory) {
  if (!isAdminLikeSession(session)) {
    return { metrics: [], columns: [], rows: [] };
  }
  const counselorNames = getMonitoringCounselorNamesFromData(rawLeads, counselors, session, directory);
  if (subsection === "lead-assignment") {
    const rows = buildServerLeadAssignmentRows(counselorNames, rawLeads, range, directory);
    const courseColumns = [
      ["apids", "APIDS"],
      ["apida", "APIDA"],
      ["da", "DA"],
      ["aiml", "AIML + GENAI"],
      ["days7Genai", "7 DAYS GEN AI & AGENTIC AI"],
      ["genai", "GEN AI"],
      ["cyberSecurity", "APCS"],
      ["fde", "FDE"],
      ["unspecified", "Unspecified"]
    ];
    const totalAssigned = rows.reduce((sum, row) => sum + row.total, 0);
    return {
      metrics: [{ label: "Total Assigned", value: totalAssigned }],
      columns: ["Counselor Name", ...courseColumns.map(([, label]) => label), "Total"],
      rows
    };
  }
  const rows = buildServerReportingRows(counselorNames, rawLeads, range, directory)
    .sort((left, right) => (
      (right.enrolled + right.pde + right.cnc + right.cbl + right.ni + right.pendingLeads)
      - (left.enrolled + left.pde + left.cnc + left.cbl + left.ni + left.pendingLeads)
    ) || String(left.counselor).localeCompare(String(right.counselor)));
  const totals = rows.reduce((acc, row) => {
    ["enrolled", "pde", "cnc", "cbl", "ni", "pendingLeads"].forEach((key) => {
      acc[key] += Number(row[key]) || 0;
    });
    return acc;
  }, { enrolled: 0, pde: 0, cnc: 0, cbl: 0, ni: 0, pendingLeads: 0 });
  return {
    metrics: [
      { label: "Enrolled", value: totals.enrolled },
      { label: "PDE", value: totals.pde },
      { label: "CNC", value: totals.cnc },
      { label: "CBL", value: totals.cbl },
      { label: "NI", value: totals.ni },
      { label: "Pending Leads", value: totals.pendingLeads }
    ],
    columns: ["Counselor Name", "Enrolled", "PDE", "CNC", "CBL", "NI", "Pending Leads"],
    rows
  };
}

function buildMonitoringReport({ subsection, leads, counselors, range, session }) {
  const directory = buildMonitoringCounselorDirectory(counselors);
  const rawLeads = normalizeMonitoringLeadFields(leads);
  if (subsection === "reporting" || subsection === "lead-assignment") {
    return buildServerManagementMonitoringReport(subsection, rawLeads, counselors, range, session, directory);
  }
  const timelineLeads = range
    ? rawLeads.filter((lead) => ["workshopActivityHistory", "admissionActivityHistory", "registeredCourseActivityHistory", "mainAdmissionActivityHistory", "mcubeCallHistory"].some((field) => getMonitoringHistoryInRange(lead?.[field], range).length))
    : rawLeads;
  const counselorNames = getMonitoringCounselorNamesFromData(rawLeads, counselors, session, directory);
  if (subsection === "mcube-main") {
    return buildMonitoringMcubeReport(rawLeads, range, session, directory);
  }
  const rows = buildMonitoringRowsForSubsection(subsection, counselorNames, timelineLeads, rawLeads, range, session, directory);
  const metricMap = {
    "workshop-calling": [["Total Leads Touched", "activities"], ["Leads Assigned", "assignedLeads"], ["Interested Leads", "interested"], ["Not Interested Leads", "notInterested"], ["WhatsApp Group Joined", "whatsappJoined"], ["Fresh Leads Touched", "freshLeadTouches"], ["Old Leads Touched", "oldLeadTouches"]],
    "admission-calling": [["Total Leads Touched", "activities"], ["Leads Assigned", "assignedLeads"], ["Interested Leads", "interested"], ["Not Interested Leads", "notInterested"], ["Enrolled", "enrolled"], ["Won", "won"], ["Fresh Leads Touched", "freshLeadTouches"], ["Old Leads Touched", "oldLeadTouches"]],
    "main-admission": [["Total Leads Touched", "activities"], ["Leads Assigned", "assignedLeads"], ["Interested Leads", "interested"], ["Not Interested Leads", "notInterested"], ["Enrolled", "enrolled"], ["Won", "won"], ["Fresh Leads Touched", "freshLeadTouches"], ["Old Leads Touched", "oldLeadTouches"]],
    "registered-candidates": [["Total Leads Touched", "activities"], ["Leads Assigned", "assignedLeads"], ["Dialed Leads", "dialed"], ["Interested Leads", "interested"], ["Not Interested Leads", "notInterested"], ["Fresh Leads Touched", "freshLeadTouches"], ["Old Leads Touched", "oldLeadTouches"]],
    "crash-course": [["Total Leads Touched", "activities"], ["Leads Assigned", "assignedLeads"], ["Dialed Leads", "dialed"], ["Interested Leads", "interested"], ["Not Interested Leads", "notInterested"], ["Fresh Leads Touched", "freshLeadTouches"], ["Old Leads Touched", "oldLeadTouches"]]
  };
  const metrics = (metricMap[subsection] || []).map(([label, key]) => ({ label, value: rows.reduce((sum, row) => sum + (Number(row[key]) || 0), 0) }));
  const columns = subsection === "workshop-calling"
    ? ["Counselor Name", "Total Leads Touched", "Workshop-wise Leads Touched", "Interested Leads", "Not Interested Leads", "WhatsApp Group Joined", "Leads Assigned", "Fresh Leads Touched", "Old Leads Touched"]
    : subsection === "registered-candidates" || subsection === "crash-course"
      ? ["Counselor Name", "Total Leads Touched", "Course-wise Leads Touched", "Leads Assigned", "Fresh Leads Touched", "Old Leads Touched", "Dialed Leads", "Interested Leads", "Not Interested Leads"]
      : ["Counselor Name", "Total Leads Touched", subsection === "main-admission" ? "Course-wise Leads Touched" : "Workshop-wise Leads Touched", "Interested Leads", "Not Interested Leads", "Enrolled", "Won", "Leads Assigned", "Fresh Leads Touched", "Old Leads Touched"];
  return { metrics, columns, rows };
}

function getLostSourceLabel(lead = {}) {
  const pipeline = String(lead?.leadPipeline || "").trim().toLowerCase();
  if (pipeline === MAIN_ADMISSION_PIPELINE) return "Main Admission Leads";
  if (pipeline === "course-registration") {
    return String(lead?.publicCourseSegment || "").trim().toLowerCase() === "crash-course"
      ? "7-Day Crash Course"
      : "Registered Candidates";
  }
  if (String(lead?.wsStatus || "").trim() === "Not Interested") return "Workshop Calling";
  if (Boolean(lead?.postStatusUpdated) && String(lead?.courseStatus || "").trim() === "Not Interested") return "Admission Calling";
  return "Unknown";
}

function buildLostLeadMongoQuery() {
  return {
    $or: [
      { wsStatus: "Not Interested" },
      { postStatusUpdated: true, courseStatus: "Not Interested" },
      { leadPipeline: MAIN_ADMISSION_PIPELINE, mainAdmissionActivityUpdated: true, mainAdmissionCourseStatus: "Not Interested" },
      { leadPipeline: "course-registration", registeredActivityUpdated: true, registeredCourseStatus: "Not Interested" }
    ]
  };
}

const LOST_LEAD_LIST_PROJECTION = {
  id: 1,
  name: 1,
  email: 1,
  phone: 1,
  createdAt: 1,
  createdAtExact: 1,
  updatedAt: 1,
  counselor: 1,
  courseName: 1,
  courseCode: 1,
  courseRawName: 1,
  workshop: 1,
  leadPipeline: 1,
  publicCourseSegment: 1,
  wsStatus: 1,
  postStatusUpdated: 1,
  courseStatus: 1,
  mainAdmissionActivityUpdated: 1,
  mainAdmissionCourseStatus: 1,
  registeredActivityUpdated: 1,
  registeredCourseStatus: 1
};

const REACHOUT_LEAD_LIST_PROJECTION = {
  id: 1,
  name: 1,
  email: 1,
  phone: 1,
  counselor: 1,
  workshop: 1,
  courseName: 1,
  courseCode: 1,
  country: 1,
  leadPipeline: 1,
  publicCourseSegment: 1,
  createdAt: 1,
  createdAtExact: 1,
  updatedAt: 1,
  metaCampaignName: 1,
  metaAdsetName: 1,
  metaAdName: 1,
  elementorFormName: 1,
  importSourceSheet: 1
};

const WORKFLOW_LEAD_LIST_PROJECTION = {
  id: 1,
  name: 1,
  email: 1,
  phone: 1,
  createdAt: 1,
  createdAtExact: 1,
  updatedAt: 1,
  counselor: 1,
  assignedFromCounselor: 1,
  leadOwnerType: 1,
  leadOwnerTimelineAt: 1,
  counselorAssignedAt: 1,
  courseName: 1,
  courseCode: 1,
  courseRawName: 1,
  country: 1,
  state: 1,
  city: 1,
  location: 1,
  branch: 1,
  source: 1,
  leadSource: 1,
  metaCampaignName: 1,
  metaAdsetName: 1,
  metaAdName: 1,
  elementorFormName: 1,
  importSourceSheet: 1,
  leadPipeline: 1,
  publicCourseSegment: 1,
  repeatEnquiryCount: 1,
  repeatEnquirySources: 1,
  lastRepeatEnquiryAt: 1,
  workshop: 1,
  workshopName: 1,
  admissionWorkshop: 1,
  admissionWorkshopName: 1,
  admissionWorkshopDateLabel: 1,
  dialed: 1,
  callStatus: 1,
  wsStatus: 1,
  whatsappInvite: 1,
  whatsappGroupStatus: 1,
  postDialed: 1,
  coursePitched: 1,
  courseStatus: 1,
  admissionStatus: 1,
  postCallStatus: 1,
  workshopJoiningStatus: 1,
  postStatusUpdated: 1,
  preActivityUpdates: 1,
  postActivityUpdates: 1,
  workshopActivityTouchedByAssignee: 1,
  admissionActivityTouchedByAssignee: 1,
  workshopActivityHistory: 1,
  admissionActivityHistory: 1
};

const SCOPED_LEAD_LIST_PROJECTION = {
  id: 1,
  name: 1,
  email: 1,
  phone: 1,
  createdAt: 1,
  createdAtExact: 1,
  updatedAt: 1,
  counselor: 1,
  assignedFromCounselor: 1,
  leadOwnerType: 1,
  leadOwnerTimelineAt: 1,
  counselorAssignedAt: 1,
  courseName: 1,
  courseCode: 1,
  courseRawName: 1,
  country: 1,
  state: 1,
  city: 1,
  location: 1,
  leadPipeline: 1,
  publicCourseSegment: 1,
  source: 1,
  leadSource: 1,
  metaCampaignName: 1,
  metaAdsetName: 1,
  metaAdName: 1,
  metaExtraFields: 1,
  elementorExtraFields: 1,
  elementorPageUrl: 1,
  elementorFormName: 1,
  importSourceSheet: 1,
  importSourceFiles: 1,
  leadNotes: 1,
  mcubeCallHistory: 1,
  lsqImported: 1,
  lsqArchivedLead: 1,
  lsqOwner: 1,
  lsqStage: 1,
  lsqLeadSource: 1,
  repeatEnquiryCount: 1,
  repeatEnquirySources: 1,
  lastRepeatEnquiryAt: 1,
  lastWorkshopMigrationAt: 1,
  workshopMigrationHistory: 1,
  mainAdmissionDialed: 1,
  mainAdmissionCoursePitched: 1,
  mainAdmissionCourseStatus: 1,
  mainAdmissionAdmissionStatus: 1,
  mainAdmissionCallStatus: 1,
  mainAdmissionActivityUpdated: 1,
  mainAdmissionActivityTouchedByAssignee: 1,
  mainAdmissionActivityUpdates: 1,
  mainAdmissionActivityHistory: 1,
  registeredDialed: 1,
  registeredCoursePitched: 1,
  registeredCourseStatus: 1,
  registeredAdmissionStatus: 1,
  registeredCallStatus: 1,
  registeredActivityUpdated: 1,
  registeredActivityTouchedByAssignee: 1,
  registeredCourseActivityUpdates: 1,
  registeredCourseActivityHistory: 1
};

const LEAD_BROWSE_LIST_PROJECTION = {
  id: 1,
  name: 1,
  email: 1,
  phone: 1,
  counselor: 1,
  createdAt: 1,
  createdAtExact: 1,
  updatedAt: 1,
  workshop: 1,
  workshopName: 1,
  admissionWorkshop: 1,
  courseName: 1,
  courseCode: 1,
  coursePitched: 1,
  mainAdmissionCoursePitched: 1,
  registeredCoursePitched: 1,
  country: 1,
  state: 1,
  city: 1,
  branch: 1,
  source: 1,
  leadSource: 1,
  leadPipeline: 1,
  publicCourseSegment: 1,
  callStatus: 1,
  wsStatus: 1,
  postCallStatus: 1,
  courseStatus: 1,
  admissionStatus: 1,
  postStatusUpdated: 1,
  postActivityUpdates: 1,
  mainAdmissionCallStatus: 1,
  mainAdmissionCourseStatus: 1,
  mainAdmissionAdmissionStatus: 1,
  registeredCallStatus: 1,
  registeredCourseStatus: 1,
  registeredAdmissionStatus: 1,
  lsqImported: 1,
  lsqArchivedLead: 1
};

function getScopedEntryTimestamp(value) {
  const candidate = String(
    value?.at
    || value?.timestamp
    || value?.createdAt
    || value?.updatedAt
    || value?.migratedAt
    || value
    || ""
  ).trim();
  if (!candidate) return Number.NaN;
  return new Date(candidate).getTime();
}

function getScopedLatestHistoryEntry(history) {
  if (!Array.isArray(history) || !history.length) return null;
  return history.reduce((latest, entry) => (
    !latest || getScopedEntryTimestamp(entry) >= getScopedEntryTimestamp(latest) ? entry : latest
  ), null);
}

function getScopedActivityLabel(activity = {}) {
  return String(
    activity?.activityType
    || activity?.type
    || activity?.eventType
    || activity?.actionType
    || activity?.label
    || ""
  ).trim();
}

function isScopedInboundCallActivity(activity = {}) {
  const text = String([
    activity?.direction,
    activity?.callDirection,
    activity?.callType,
    activity?.source,
    activity?.actionDescription,
    activity?.remarks
  ].filter(Boolean).join(" ")).trim();
  return /inbound|incoming/i.test(text);
}

function isScopedNotPickedCallActivity(activity = {}) {
  const text = String([
    activity?.callStatus,
    activity?.status,
    activity?.disposition,
    activity?.callDisposition,
    activity?.newValue,
    activity?.actionDescription,
    activity?.remarks
  ].filter(Boolean).join(" ")).trim();
  return /(cancel|missed|no\s*answer|unanswered|busy|failed|reject|declin|timeout|not\s*reachable|switched\s*off|\bdnp\b|\bcnc\b)/i.test(text);
}

function isScopedLatestInboundNotPicked(history) {
  const latest = getScopedLatestHistoryEntry(history);
  return Boolean(latest && getScopedActivityLabel(latest) === "Call Made" && isScopedInboundCallActivity(latest) && isScopedNotPickedCallActivity(latest));
}

function scopedHasAssigneeActivityHistory(history) {
  if (!Array.isArray(history)) return false;
  return history.some((entry) => {
    const by = String(entry?.by || "").trim().toLowerCase();
    const source = String(entry?.source || "").trim().toLowerCase();
    return Boolean(by) && !["reachout webhook", "system"].includes(by) && source !== "reachout webhook";
  });
}

function getScopedLeadActivityUpdateCount(lead = {}, section = "") {
  if (lead.lsqImported !== true) {
    const counselor = String(lead.counselor || "").trim().toLowerCase();
    if (!counselor || counselor === "unassigned") {
      return 0;
    }
  }

  if (section === "registered-candidates") {
    if (typeof lead.registeredActivityTouchedByAssignee === "boolean") return lead.registeredActivityTouchedByAssignee ? 1 : 0;
    if (typeof lead.registeredActivityUpdated === "boolean") return lead.registeredActivityUpdated ? 1 : 0;
    return scopedHasAssigneeActivityHistory(lead.registeredCourseActivityHistory) ? 1 : 0;
  }
  if (typeof lead.mainAdmissionActivityTouchedByAssignee === "boolean") return lead.mainAdmissionActivityTouchedByAssignee ? 1 : 0;
  if (typeof lead.mainAdmissionActivityUpdated === "boolean") return lead.mainAdmissionActivityUpdated ? 1 : 0;
  return scopedHasAssigneeActivityHistory(lead.mainAdmissionActivityHistory) ? 1 : 0;
}

function getScopedLatestRepeatEnquiryTimestamp(lead = {}) {
  const candidates = [
    getScopedEntryTimestamp(lead.lastRepeatEnquiryAt),
    getScopedEntryTimestamp(lead.lastWorkshopMigrationAt)
  ];
  if (Array.isArray(lead.workshopMigrationHistory)) {
    candidates.push(...lead.workshopMigrationHistory.map(getScopedEntryTimestamp));
  }
  const valid = candidates.filter(Number.isFinite);
  return valid.length ? Math.max(...valid) : Number.NaN;
}

function isScopedRepeatEnquiryLead(lead = {}, section = "") {
  const explicitCount = Number(lead.repeatEnquiryCount || 0);
  if (Number.isFinite(explicitCount) && explicitCount > 0) return true;
  const repeatAt = getScopedLatestRepeatEnquiryTimestamp(lead);
  if (!Number.isFinite(repeatAt)) return false;
  const historyField = section === "registered-candidates" ? "registeredCourseActivityHistory" : "mainAdmissionActivityHistory";
  const latestActivityAt = getScopedEntryTimestamp(getScopedLatestHistoryEntry(lead[historyField]));
  return !Number.isFinite(latestActivityAt) || repeatAt >= latestActivityAt;
}

function scopedLeadMatchesWhatsappActivity(lead = {}, section = "", value = "") {
  const selected = String(value || "").trim();
  if (!selected) return true;
  const historyField = section === "registered-candidates" ? "registeredCourseActivityHistory" : "mainAdmissionActivityHistory";
  const latest = getScopedLatestHistoryEntry(Array.isArray(lead[historyField]) ? lead[historyField] : []);
  return getScopedActivityLabel(latest) === selected;
}

function getScopedLeadSourceFilterValue(lead = {}) {
  const extraFields = lead?.metaExtraFields && typeof lead.metaExtraFields === "object" ? lead.metaExtraFields : {};
  const text = [
    extraFields.source_type,
    extraFields.platform,
    extraFields.utm_source,
    extraFields.referrer,
    extraFields.lead_source,
    extraFields.source,
    lead.metaAdName,
    lead.metaAdsetName,
    lead.metaCampaignName,
    lead.elementorPageUrl,
    lead.elementorFormName,
    lead.source,
    lead.name,
    lead.email
  ].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean).join(" ");
  if (/\b(mcube)\b/.test(text) || /^mcube\s+(caller|lead)(\s+\S+)?$/i.test(String(lead.name || "").trim()) || /^mcube-[^@\s]+@noemail\.lead$/i.test(String(lead.email || "").trim().toLowerCase())) return "mcube";
  if (String(lead.elementorPageUrl || "").trim() || /\b(elementor|website|web|landing page|site|public course)\b/.test(text)) return "elementor";
  if (/\b(meta)\b/.test(text)) return "meta";
  return "";
}

function getScopedTimelineRange(query = {}) {
  const timeline = String(query.timeline || "").trim().toLowerCase();
  if (!timeline || timeline === "overall") return null;
  if (timeline === "today") {
    const day = toKolkataDateKey();
    return { start: new Date(`${day}T00:00:00.000+05:30`), end: new Date(`${day}T23:59:59.999+05:30`) };
  }
  if (timeline === "yesterday") {
    const day = toKolkataDateKey(new Date(Date.now() - 24 * 60 * 60 * 1000));
    return { start: new Date(`${day}T00:00:00.000+05:30`), end: new Date(`${day}T23:59:59.999+05:30`) };
  }
  if (timeline === "week") {
    const endDay = toKolkataDateKey();
    const startDay = toKolkataDateKey(new Date(Date.now() - 6 * 24 * 60 * 60 * 1000));
    return { start: new Date(`${startDay}T00:00:00.000+05:30`), end: new Date(`${endDay}T23:59:59.999+05:30`) };
  }
  if (timeline === "custom") {
    const start = String(query.startDate || "").trim();
    const end = String(query.endDate || "").trim();
    if (!start || !end) return null;
    return { start: new Date(`${start}T00:00:00.000+05:30`), end: new Date(`${end}T23:59:59.999+05:30`) };
  }
  return null;
}

function getScopedCounselorActivityRange(query = {}) {
  return getScopedTimelineRange({
    timeline: query.counselorActivityTimeline,
    startDate: query.counselorActivityStartDate,
    endDate: query.counselorActivityEndDate
  });
}

function scopedDateInRange(value, range) {
  if (!range?.start || !range?.end) return true;
  const timestamp = getScopedEntryTimestamp(value);
  return Number.isFinite(timestamp) && timestamp >= range.start.getTime() && timestamp <= range.end.getTime();
}

function isScopedCounselorActivityEntry(entry = {}, allowedFields = []) {
  const by = String(entry?.by || "").trim().toLowerCase();
  const source = String(entry?.source || "").trim().toLowerCase();
  if (!entry || typeof entry !== "object" || ["reachout webhook", "system"].includes(by) || ["reachout webhook", "system"].includes(source) || by.startsWith("system:") || source.startsWith("system:")) {
    return false;
  }
  const activityType = getScopedActivityLabel(entry);
  const description = String(entry?.actionDescription || entry?.description || "").trim();
  if (["Lead Created", "Lead Assigned", "Lead Reassigned", "Counselor Changed", "Lead Viewed"].includes(activityType) || /whatsapp|reachout/i.test(`${activityType} ${description}`)) {
    return false;
  }
  const updates = entry?.updates && typeof entry.updates === "object" ? entry.updates : null;
  if (!updates) return Boolean(activityType || by);
  const allowed = new Set(allowedFields);
  return Object.keys(updates).some((field) => {
    if (/whatsapp/i.test(field)) return false;
    return !allowed.size || allowed.has(field);
  });
}

function leadMatchesScopedCounselorActivityDate(lead = {}, section = "", query = {}) {
  const range = getScopedCounselorActivityRange(query);
  if (!range?.start || !range?.end) return true;
  const historyField = section === "registered-candidates" ? "registeredCourseActivityHistory" : "mainAdmissionActivityHistory";
  const allowedFields = section === "registered-candidates"
    ? ["registeredDialed", "registeredCoursePitched", "registeredCourseStatus", "registeredAdmissionStatus", "registeredCallStatus"]
    : ["mainAdmissionDialed", "mainAdmissionCoursePitched", "mainAdmissionCourseStatus", "mainAdmissionAdmissionStatus", "mainAdmissionCallStatus"];
  const history = Array.isArray(lead[historyField]) ? lead[historyField] : [];
  return history.some((entry) => isScopedCounselorActivityEntry(entry, allowedFields) && scopedDateInRange(entry, range));
}

function hasScopedRuntimeFilters(query = {}) {
  return [
    "counselorActivityTimeline",
    "leadOwner",
    "location",
    "leadSource",
    "activityStatus",
    "latestActivity",
    "repeatEnquiryStatus",
    "whatsappActivity",
    "sopFilter"
  ].some((key) => String(query[key] || "").trim() && !["all", "overall"].includes(String(query[key] || "").trim().toLowerCase()));
}

function leadMatchesScopedRuntimeFilters(lead = {}, section = "", query = {}, session = {}, options = {}) {
  const timelineRange = getScopedTimelineRange(query);
  if (timelineRange && !scopedDateInRange(lead.leadOwnerTimelineAt || lead.counselorAssignedAt || lead.createdAtExact || lead.createdAt, timelineRange)) return false;
  if (!leadMatchesScopedCounselorActivityDate(lead, section, query)) return false;

  const owner = String(query.leadOwner || "").trim().toLowerCase();
  if (owner === "direct" && String(lead.leadOwnerType || "direct").trim().toLowerCase() === "reassigned") return false;
  if (owner === "reassigned" && String(lead.leadOwnerType || "").trim().toLowerCase() !== "reassigned") return false;

  const location = normalizeScopedLocationLabel(query.location);
  if (location && getScopedLeadLocationFacet(lead) !== location) return false;

  const leadSource = String(query.leadSource || "").trim().toLowerCase();
  if (leadSource && getScopedLeadSourceFilterValue(lead) !== leadSource) return false;

  const activityStatus = String(query.activityStatus || "").trim();
  const touchCount = getScopedLeadActivityUpdateCount(lead, section);
  if (activityStatus === "Untouched" && touchCount > 0) return false;
  if (activityStatus === "Updated" && touchCount === 0) return false;

  const historyField = section === "registered-candidates" ? "registeredCourseActivityHistory" : "mainAdmissionActivityHistory";
  if (String(query.latestActivity || "").trim() === "Inbound Not Picked" && !isScopedLatestInboundNotPicked(lead[historyField])) return false;

  const repeat = String(query.repeatEnquiryStatus || "").trim();
  if (repeat === "Repeat Enquiry" && !isScopedRepeatEnquiryLead(lead, section)) return false;
  if (repeat === "First Time" && isScopedRepeatEnquiryLead(lead, section)) return false;

  if (!scopedLeadMatchesWhatsappActivity(lead, section, query.whatsappActivity)) return false;

  const sopState = deriveAdmissionSopState(lead, Date.now(), { enabled: options?.admissionSopEnabled !== false });
  if (String(query.sopFilter || "").trim() === "blocked" && (!isAdminLikeSession(session) || !sopState?.blocked)) return false;
  if (section === "main-admission" && String(query.sopFilter || "").trim() !== "blocked" && sopState?.blocked) return false;

  return true;
}

function parseBoundedPositiveInt(value, fallback, min = 1, max = 500) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function escapeMongoRegex(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function addOptionalExactQuery(query, field, value) {
  const normalized = String(value || "").trim();
  if (normalized && normalized.toLowerCase() !== "all") {
    query[field] = normalized;
  }
}

function appendScopedTimelineMongoQuery(query = {}, requestQuery = {}) {
  const range = getScopedTimelineRange(requestQuery);
  if (!range?.start || !range?.end) {
    return query;
  }
  const startIso = range.start.toISOString();
  const endIso = range.end.toISOString();
  const startKey = toKolkataDateKey(range.start);
  const endKey = toKolkataDateKey(range.end);
  return appendMongoAnd(query, {
    $or: [
      { leadOwnerTimelineAt: { $gte: startIso, $lte: endIso } },
      { counselorAssignedAt: { $gte: startIso, $lte: endIso } },
      { createdAtExact: { $gte: startIso, $lte: endIso } },
      { createdAt: { $gte: startKey, $lte: endKey } }
    ]
  });
}

function appendMongoAnd(query = {}, condition = {}) {
  return {
    ...query,
    $and: [
      ...(Array.isArray(query.$and) ? query.$and : []),
      condition
    ]
  };
}

function buildScopedLeadBaseMongoQuery(section, session = {}, counselors = []) {
  const query = section === "admission-sop"
    ? {
        leadPipeline: { $in: [MAIN_ADMISSION_PIPELINE, "course-registration"] },
        lsqImported: { $ne: true },
        lsqSourceSnapshot: { $exists: false },
        source: { $not: /leadsquared/i }
      }
    : section === "registered-candidates"
      ? { leadPipeline: "course-registration" }
      : getMainAdmissionLeadMongoQuery({ includeArchived: isAdminLikeSession(session) });

  const sessionRole = String(session.role || "").trim().toLowerCase();
  if (sessionRole === "counselor") {
    const sessionEmail = String(session.email || "").trim().toLowerCase();
    const counselorMatch = (Array.isArray(counselors) ? counselors : []).find(
      (item) => String(item.email || "").trim().toLowerCase() === sessionEmail
    );
    query.counselor = String(counselorMatch?.name || session.name || "").trim();
  }

  if (sessionRole === "counselor") {
    Object.assign(query, appendMongoAnd(query, {
      $or: [
        { lsqArchivedLead: { $ne: true } },
        { counselor: { $ne: "Archived Leads" } }
      ]
    }));
  }

  return query;
}

function applyScopedRegisteredSegmentQuery(query = {}, segmentValue = "") {
  const segment = String(segmentValue || PUBLIC_COURSE_DEFAULT_SEGMENT).trim().toLowerCase();
  if (segment === PUBLIC_COURSE_CRASH_SEGMENT) {
    return appendMongoAnd(query, {
      $or: [
        { publicCourseSegment: PUBLIC_COURSE_CRASH_SEGMENT },
        { courseId: "days7_genai" }
      ]
    });
  }
  let nextQuery = appendMongoAnd(query, { publicCourseSegment: { $ne: PUBLIC_COURSE_CRASH_SEGMENT } });
  nextQuery = appendMongoAnd(nextQuery, { courseId: { $ne: "days7_genai" } });
  return nextQuery;
}

function buildScopedLeadMongoQuery(section, requestQuery = {}, session = {}, counselors = []) {
  let query = buildScopedLeadBaseMongoQuery(section, session, counselors);
  query = appendScopedTimelineMongoQuery(query, requestQuery);

  const sessionRole = String(session.role || "").trim().toLowerCase();
  const counselorFilter = String(requestQuery.counselor || "").trim();
  const counselorValues = counselorFilter.split(",").map((val) => val.trim()).filter(Boolean);
  const hasLostLeadsSelected = counselorValues.includes(LOST_LEADS_COUNSELOR_FILTER);

  if (sessionRole !== "counselor" && counselorValues.length > 0) {
    const conditions = counselorValues.map((value) => {
      if (value === LOST_LEADS_COUNSELOR_FILTER) {
        return canUseLostLeadCounselorFilter(session)
          ? buildLostLeadMongoQuery()
          : { _id: "__lost_leads_filter_forbidden__" };
      } else if (value === LSQ_ARCHIVED_COUNSELOR) {
        return isAdminLikeSession(session)
          ? { counselor: LSQ_ARCHIVED_COUNSELOR }
          : { _id: "__archived_leads_filter_forbidden__" };
      } else if (value.toLowerCase() === "unassigned") {
        return {
          $or: [
            { counselor: { $exists: false } },
            { counselor: "" },
            { counselor: "Unassigned" },
            { counselor: "unassigned" },
            { counselor: null }
          ]
        };
      } else {
        return { counselor: value };
      }
    });
    query = appendMongoAnd(query, { $or: conditions });
  }

  if (section === "main-admission" && counselorFilter && !hasLostLeadsSelected) {
    query = appendMongoAnd(query, { $nor: [buildLostLeadMongoQuery()] });
  }

  const lsqFilter = String(requestQuery.lsqLeads || "").trim().toLowerCase();
  if (lsqFilter === "only") {
    query.lsqImported = true;
  } else if (lsqFilter === "hide") {
    query.lsqImported = { $ne: true };
  }

  if (section === "registered-candidates") {
    query = applyScopedRegisteredSegmentQuery(query, requestQuery.segment);
    addOptionalExactQuery(query, "registeredDialed", requestQuery.registeredDialed);
    addOptionalExactQuery(query, "registeredCourseStatus", requestQuery.registeredCourseStatus);
    addOptionalExactQuery(query, "registeredAdmissionStatus", requestQuery.registeredAdmissionStatus);
    addOptionalExactQuery(query, "registeredCallStatus", requestQuery.registeredCallStatus);
  } else {
    addOptionalExactQuery(query, "mainAdmissionDialed", requestQuery.mainAdmissionDialed);
    addOptionalExactQuery(query, "mainAdmissionCourseStatus", requestQuery.mainAdmissionCourseStatus);
    addOptionalExactQuery(query, "mainAdmissionAdmissionStatus", requestQuery.mainAdmissionAdmissionStatus);
    addOptionalExactQuery(query, "mainAdmissionCallStatus", requestQuery.mainAdmissionCallStatus);
  }

  const courseName = String(requestQuery.courseName || "").trim();
  if (courseName) {
    query.courseName = courseName;
  }

  const search = String(requestQuery.search || "").trim();
  if (search) {
    const regex = new RegExp(escapeMongoRegex(search), "i");
    query = appendMongoAnd(query, {
      $or: [
        { name: regex },
        { email: regex },
        { phone: regex },
        { courseName: regex },
        { counselor: regex },
        { country: regex },
        { state: regex },
        { city: regex }
      ]
    });
  }

  return query;
}

function normalizeScopedFacetValue(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizeScopedLocationLabel(value) {
  const cleaned = normalizeScopedFacetValue(value);
  if (!cleaned) return "";
  return cleaned.toLowerCase().replace(/\b[a-z]/g, (match) => match.toUpperCase());
}

function getScopedLeadLocationFacet(lead = {}) {
  const extraFields = lead?.metaExtraFields && typeof lead.metaExtraFields === "object" ? lead.metaExtraFields : {};
  return normalizeScopedLocationLabel(
    extraFields.city
    || extraFields.current_city
    || extraFields.city_name
    || extraFields.town
    || extraFields.location
    || lead.city
    || lead.state
    || lead.country
  );
}

function getScopedMainAdmissionCourseFacet(lead = {}) {
  const identity = buildCourseIdentity(lead?.courseRawName || lead?.courseName || lead?.courseCode, lead);
  return isKnownPublicCourseIdentity(identity) ? identity.label : "Others";
}

async function buildScopedLeadFacets(section, session = {}, counselors = [], requestQuery = {}) {
  let query = buildScopedLeadBaseMongoQuery(section, session, counselors);
  if (section === "registered-candidates") {
    query = applyScopedRegisteredSegmentQuery(query, requestQuery.segment);
  }
  const rawLeads = await withMongoRetry(
    () => leadsCollection.find(query, {
      projection: {
        counselor: 1,
        courseName: 1,
        courseRawName: 1,
        courseCode: 1,
        courseId: 1,
        country: 1,
        state: 1,
        city: 1,
        metaExtraFields: 1,
        metaAdName: 1,
        metaAdsetName: 1,
        metaCampaignName: 1,
        elementorFormName: 1,
        elementorPageUrl: 1
      }
    }).toArray(),
    { retries: 1, label: "Load scoped lead facets" }
  );
  const leads = decorateLeadListForStorage(rawLeads || []);
  const values = (getter) => [...new Set(leads.map(getter).map(normalizeScopedFacetValue).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  const courseValues = section === "main-admission"
    ? [...new Set(leads.map(getScopedMainAdmissionCourseFacet).filter(Boolean))]
    : values((lead) => lead.courseName);

  return {
    counselors: values((lead) => lead.counselor),
    courses: courseValues.sort((a, b) => {
      if (a === "Others") return 1;
      if (b === "Others") return -1;
      return a.localeCompare(b);
    }),
    locations: values(getScopedLeadLocationFacet)
  };
}

function buildScopedLeadClearQuery(section, requestQuery = {}) {
  const normalizedSection = String(section || "").trim().toLowerCase();
  if (normalizedSection === "main-admission") {
    return getMainAdmissionLeadMongoQuery();
  }
  if (normalizedSection !== "registered-candidates") {
    return null;
  }

  const segment = String(requestQuery.segment || PUBLIC_COURSE_DEFAULT_SEGMENT).trim().toLowerCase();
  if (segment === PUBLIC_COURSE_CRASH_SEGMENT) {
    return {
      leadPipeline: "course-registration",
      $or: [
        { publicCourseSegment: PUBLIC_COURSE_CRASH_SEGMENT },
        { courseId: "days7_genai" }
      ]
    };
  }

  return {
    leadPipeline: "course-registration",
    publicCourseSegment: { $ne: PUBLIC_COURSE_CRASH_SEGMENT },
    courseId: { $ne: "days7_genai" }
  };
}

function buildMonitoringLeadMongoQuery(subsection = "") {
  const key = String(subsection || "").trim().toLowerCase();
  const legacyPipelineQuery = {
    $or: [
      { leadPipeline: { $exists: false } },
      { leadPipeline: "" },
      { leadPipeline: null }
    ]
  };
  if (key === "main-admission") return getMainAdmissionLeadMongoQuery();
  if (key === "reporting" || key === "lead-assignment") return getMainAdmissionLeadMongoQuery();
  if (key === "admission-calling") {
    return {
      leadPipeline: { $nin: ["course-registration", MAIN_ADMISSION_PIPELINE] }
    };
  }
  if (key === "registered-candidates") {
    return {
      leadPipeline: "course-registration",
      publicCourseSegment: { $ne: "crash-course" },
      courseId: { $ne: "days7_genai" }
    };
  }
  if (key === "crash-course") {
    return {
      leadPipeline: "course-registration",
      $or: [
        { publicCourseSegment: "crash-course" },
        { courseId: "days7_genai" }
      ]
    };
  }
  if (key === "mcube-main") {
    return {};
  }
  return legacyPipelineQuery;
}

function getLeadBrowseCategoryMongoQuery(category = "workshop", admissionSection = "all") {
  const normalizedCategory = String(category || "workshop").trim().toLowerCase();
  const normalizedAdmissionSection = String(admissionSection || "all").trim().toLowerCase();
  if (normalizedCategory === "admission") {
    if (normalizedAdmissionSection === "main-admission") {
      return getMainAdmissionLeadMongoQuery();
    }
    if (normalizedAdmissionSection === "registered-candidates") {
      return {
        leadPipeline: "course-registration",
        publicCourseSegment: { $ne: PUBLIC_COURSE_CRASH_SEGMENT },
        courseId: { $ne: "days7_genai" }
      };
    }
    if (normalizedAdmissionSection === "crash-course") {
      return {
        leadPipeline: "course-registration",
        $or: [
          { publicCourseSegment: PUBLIC_COURSE_CRASH_SEGMENT },
          { courseId: "days7_genai" }
        ]
      };
    }
    return {
      $or: [
        getMainAdmissionLeadMongoQuery(),
        { leadPipeline: "course-registration" }
      ]
    };
  }

  return {
    $and: [
      {
        $or: [
          { leadPipeline: { $exists: false } },
          { leadPipeline: "" },
          { leadPipeline: null },
          { leadPipeline: { $nin: [MAIN_ADMISSION_PIPELINE, "admission", "main-admission-calling", "course-registration"] } }
        ]
      },
      { lsqImported: { $ne: true } }
    ]
  };
}

function getLeadBrowseStatusExpression() {
  return {
    $ifNull: [
      "$mainAdmissionAdmissionStatus",
      {
        $ifNull: [
          "$registeredAdmissionStatus",
          {
            $ifNull: [
              "$admissionStatus",
              {
                $ifNull: [
                  "$courseStatus",
                  {
                    $ifNull: [
                      "$wsStatus",
                      {
                        $ifNull: [
                          "$callStatus",
                          "No status"
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  };
}

function appendLeadBrowseMongoFilters(query = {}, requestQuery = {}, session = {}) {
  let nextQuery = query;
  if (!isAdminLikeSession(session)) {
    nextQuery = appendMongoAnd(nextQuery, {
      $or: [
        { lsqArchivedLead: { $ne: true } },
        { lsqArchivedLead: { $exists: false } }
      ],
      counselor: { $ne: LSQ_ARCHIVED_COUNSELOR }
    });
  }

  const counselor = String(requestQuery.counselor || "").trim();
  if (counselor) {
    nextQuery = appendMongoAnd(nextQuery, { counselor });
  }

  const status = String(requestQuery.status || "").trim();
  if (status) {
    nextQuery = appendMongoAnd(nextQuery, {
      $or: [
        { mainAdmissionAdmissionStatus: status },
        { registeredAdmissionStatus: status },
        { admissionStatus: status },
        { courseStatus: status },
        { wsStatus: status },
        { callStatus: status }
      ]
    });
  }

  const search = String(requestQuery.search || requestQuery.query || "").trim();
  if (search) {
    const regex = new RegExp(escapeMongoRegex(search), "i");
    nextQuery = appendMongoAnd(nextQuery, {
      $or: [
        { name: regex },
        { email: regex },
        { phone: regex },
        { normalizedEmail: regex },
        { normalizedPhone: regex },
        { workshop: regex },
        { workshopName: regex },
        { admissionWorkshop: regex },
        { courseName: regex },
        { courseCode: regex },
        { source: regex },
        { leadSource: regex },
        { counselor: regex },
        { mainAdmissionCoursePitched: regex },
        { registeredCoursePitched: regex }
      ]
    });
  }

  return nextQuery;
}

async function buildLeadBrowseFacets(baseQuery = {}) {
  const [counselors, statuses] = await Promise.all([
    withMongoRetry(
      () => leadsCollection.distinct("counselor", baseQuery),
      { retries: 1, label: "Load lead browse counselor facets" }
    ).catch(() => []),
    withMongoRetry(
      () => leadsCollection.aggregate([
        { $match: baseQuery },
        { $project: { status: getLeadBrowseStatusExpression() } },
        { $group: { _id: "$status" } },
        { $sort: { _id: 1 } },
        { $limit: 80 }
      ]).toArray(),
      { retries: 1, label: "Load lead browse status facets" }
    ).catch(() => [])
  ]);

  return {
    counselors: (Array.isArray(counselors) ? counselors : [])
      .map((value) => String(value || "Unassigned").trim() || "Unassigned")
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right)),
    statuses: (Array.isArray(statuses) ? statuses : [])
      .map((row) => String(row?._id || "No status").trim() || "No status")
      .filter(Boolean)
  };
}

function buildMonitoringLeadProjection(subsection = "") {
  const key = String(subsection || "").trim().toLowerCase();
  const projection = {
    id: 1,
    counselor: 1,
    createdAt: 1,
    createdAtExact: 1,
    leadOwnerTimelineAt: 1,
    counselorAssignedAt: 1,
    leadCreationRequestId: 1,
    requestedBy: 1,
    requestedByEmail: 1,
    workshop: 1,
    admissionWorkshop: 1,
    courseName: 1,
    courseId: 1,
    courseCode: 1,
    leadPipeline: 1,
    publicCourseSegment: 1
  };
  if (key === "workshop-calling") {
    return { ...projection, workshopActivityHistory: 1 };
  }
  if (key === "admission-calling") {
    return { ...projection, admissionActivityHistory: 1, admissionStatus: 1 };
  }
  if (key === "main-admission" || key === "reporting" || key === "lead-assignment") {
    return { ...projection, mainAdmissionActivityHistory: 1, mainAdmissionCoursePitched: 1 };
  }
  if (key === "registered-candidates" || key === "crash-course") {
    return { ...projection, registeredCourseActivityHistory: 1 };
  }
  if (key === "mcube-main") {
    return { ...projection, mcubeCallHistory: 1 };
  }
  return {
    ...projection,
    workshopActivityHistory: 1,
    admissionActivityHistory: 1,
    registeredCourseActivityHistory: 1,
    mainAdmissionActivityHistory: 1,
    mcubeCallHistory: 1
  };
}

function appendMonitoringRangeMongoQuery(query = {}, subsection = "", range = null) {
  if (!range?.start || !range?.end) {
    return query;
  }
  const key = String(subsection || "").trim().toLowerCase();
  const startIso = range.start.toISOString();
  const endIso = range.end.toISOString();
  const startKey = toKolkataDateKey(range.start);
  const endKey = toKolkataDateKey(range.end);
  const commonDateFilters = [
    { leadOwnerTimelineAt: { $gte: startIso, $lte: endIso } },
    { counselorAssignedAt: { $gte: startIso, $lte: endIso } },
    { createdAtExact: { $gte: startIso, $lte: endIso } },
    { createdAt: { $gte: startKey, $lte: endKey } },
    { createdAt: { $gte: startIso, $lte: endIso } }
  ];
  const historyFiltersBySubsection = {
    "workshop-calling": [{ "workshopActivityHistory.at": { $gte: startIso, $lte: endIso } }],
    "admission-calling": [{ "admissionActivityHistory.at": { $gte: startIso, $lte: endIso } }],
    "main-admission": [{ "mainAdmissionActivityHistory.at": { $gte: startIso, $lte: endIso } }],
    "registered-candidates": [{ "registeredCourseActivityHistory.at": { $gte: startIso, $lte: endIso } }],
    "crash-course": [{ "registeredCourseActivityHistory.at": { $gte: startIso, $lte: endIso } }],
    "mcube-main": [
      { "mcubeCallHistory.at": { $gte: startIso, $lte: endIso } },
      { "mcubeCallHistory.receivedAt": { $gte: startIso, $lte: endIso } },
      { "mcubeCallHistory.startTime": { $gte: startIso, $lte: endIso } },
      { "mcubeCallHistory.callStartTime": { $gte: startIso, $lte: endIso } }
    ]
  };
  const historyFilters = historyFiltersBySubsection[key] || [
    { "workshopActivityHistory.at": { $gte: startIso, $lte: endIso } },
    { "admissionActivityHistory.at": { $gte: startIso, $lte: endIso } },
    { "registeredCourseActivityHistory.at": { $gte: startIso, $lte: endIso } },
    { "mainAdmissionActivityHistory.at": { $gte: startIso, $lte: endIso } },
    { "mcubeCallHistory.receivedAt": { $gte: startIso, $lte: endIso } }
  ];
  return appendMongoAnd(query, { $or: [...commonDateFilters, ...historyFilters] });
}

function getLeadInflowRange(query = {}) {
  const type = String(query.timelineType || query.type || "today").trim().toLowerCase();
  if (type === "overall") return null;
  if (type === "custom") {
    const startDate = String(query.startDate || "").trim();
    const endDate = String(query.endDate || startDate).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      return getMonitoringDayRange(0);
    }
    return {
      start: new Date(`${startDate}T00:00:00+05:30`),
      end: new Date(`${endDate}T23:59:59.999+05:30`)
    };
  }
  if (type === "week") {
    return { start: getMonitoringDayRange(-6).start, end: getMonitoringDayRange(0).end };
  }
  if (type === "month") {
    return { start: getMonitoringDayRange(-29).start, end: getMonitoringDayRange(0).end };
  }
  if (type === "yesterday") return getMonitoringDayRange(-1);
  return getMonitoringDayRange(0);
}

function parseLeadInflowDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date(`${raw}T00:00:00+05:30`);
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getLeadInflowDateKey(value) {
  const parsed = parseLeadInflowDate(value);
  return parsed ? toKolkataDateKey(parsed) : "";
}

function isLeadInflowAdmissionLead(lead = {}) {
  return isMainAdmissionLead(lead) || isPublicCourseRegistrationLead(lead);
}

function getLeadInflowSection(lead = {}) {
  return isLeadInflowAdmissionLead(lead) ? "admission" : "workshop";
}

function getLeadInflowLeadMongoQuery(section = "workshop", range = null) {
  const ignoredLeadExclusion = {
    ignored: { $ne: true },
    integrationIgnored: { $ne: true },
    inflowIgnored: { $ne: true },
    leadInflowIgnored: { $ne: true },
    importStatus: { $ne: "ignored" }
  };
  const sectionQuery = section === "admission"
    ? {
        ...ignoredLeadExclusion,
        $or: [
          getMainAdmissionLeadMongoQuery(),
          { leadPipeline: "course-registration" }
        ]
      }
    : {
        ...ignoredLeadExclusion,
        leadPipeline: { $nin: [MAIN_ADMISSION_PIPELINE, "admission", "main-admission-calling", "course-registration"] },
        lsqImported: { $ne: true }
      };

  if (!range?.start || !range?.end) {
    return sectionQuery;
  }

  const startIso = range.start.toISOString();
  const endIso = range.end.toISOString();
  const startKey = toKolkataDateKey(range.start);
  const endKey = toKolkataDateKey(range.end);
  return appendMongoAnd(sectionQuery, {
    $or: [
      { createdAtExact: { $gte: startIso, $lte: endIso } },
      { approvedAt: { $gte: startIso, $lte: endIso } },
      { createdAt: { $gte: startKey, $lte: endKey } }
    ]
  });
}

function getLeadInflowDuplicateLogMongoQuery(range = null) {
  const query = {
    $or: [
      { type: "updated" },
      {
        type: { $ne: "ignored" },
        message: /duplicate/i
      }
    ]
  };
  if (!range?.start || !range?.end) {
    return query;
  }
  return appendMongoAnd(query, {
    receivedAt: {
      $gte: range.start.toISOString(),
      $lte: range.end.toISOString()
    }
  });
}

function getLeadInflowEventMongoQuery(range = null) {
  const query = { eventType: "duplicate" };
  if (!range?.start || !range?.end) {
    return query;
  }
  return {
    ...query,
    receivedAt: {
      $gte: range.start.toISOString(),
      $lte: range.end.toISOString()
    }
  };
}

function getLeadInflowSource(lead = {}) {
  const source = String(lead?.source || "").trim();
  const normalizedSource = source.toLowerCase();
  if (normalizedSource.includes("meta")) return "Meta";
  if (normalizedSource.includes("elementor")) return "Elementor";
  if (normalizedSource.includes("mcube")) return "MCUBE";
  if (normalizedSource.includes("public course") || normalizedSource.includes("public registration")) return "Public Registration";
  if (normalizedSource.includes("leadsquared")) return "LeadSquared Import";
  if (normalizedSource.includes("lead creation request") || lead?.leadCreationRequestId) return "Counselor Created";
  if (source) return source;
  const files = Array.isArray(lead?.importSourceFiles) ? lead.importSourceFiles : [];
  const fileSource = files.map((item) => String(item || "").trim()).find(Boolean);
  return fileSource || "Unknown";
}

function getLeadInflowCampaign(lead = {}) {
  return String(
    lead?.metaCampaignName ||
    lead?.metaAdsetName ||
    lead?.metaAdName ||
    lead?.elementorFormName ||
    lead?.elementorFormId ||
    lead?.importSourceSheet ||
    lead?.lsqSourceSnapshot?.sourceFileName ||
    ""
  ).trim() || "Unspecified Campaign";
}

function isDuplicateInflowLog(log = {}) {
  const type = String(log?.type || "").trim().toLowerCase();
  const message = String(log?.message || "").trim().toLowerCase();
  return type === "updated" || (type !== "ignored" && message.includes("duplicate"));
}

function buildLeadInflowEventId(event = {}) {
  const source = String(event?.source || "").trim().toLowerCase() || "unknown";
  const sourceEventId = String(event?.sourceEventId || "").trim();
  if (sourceEventId) return `${source}:${sourceEventId}`;
  return crypto
    .createHash("sha1")
    .update(JSON.stringify({
      source,
      eventType: event?.eventType || "duplicate",
      receivedAt: event?.receivedAt || "",
      leadId: event?.leadId || "",
      message: event?.message || "",
      campaign: event?.campaign || ""
    }))
    .digest("hex");
}

async function saveLeadInflowEvent(event = {}) {
  if (!leadInflowCollection) return;
  const receivedAt = String(event?.receivedAt || new Date().toISOString()).trim();
  const doc = {
    eventId: buildLeadInflowEventId(event),
    eventType: String(event?.eventType || "duplicate").trim().toLowerCase() || "duplicate",
    source: String(event?.source || "Unknown").trim() || "Unknown",
    section: String(event?.section || "workshop").trim().toLowerCase() === "admission" ? "admission" : "workshop",
    campaign: String(event?.campaign || "Unspecified Campaign").trim() || "Unspecified Campaign",
    leadId: event?.leadId === undefined || event?.leadId === null ? "" : String(event.leadId).trim(),
    sourceEventId: String(event?.sourceEventId || "").trim(),
    message: String(event?.message || "").trim(),
    receivedAt,
    updatedAt: new Date().toISOString()
  };

  await withMongoRetry(
    () => leadInflowCollection.updateOne(
      { eventId: doc.eventId },
      {
        $set: doc,
        $setOnInsert: { createdAt: receivedAt }
      },
      { upsert: true }
    ),
    { retries: 1, label: "Persist lead inflow event" }
  ).catch((error) => {
    console.warn(`Lead inflow event skipped: ${error.message}`);
  });
}

function getLogInflowSection(log = {}, leadById = new Map()) {
  const pipeline = String(log?.leadPipeline || "").trim().toLowerCase();
  if (pipeline === MAIN_ADMISSION_PIPELINE || pipeline === "course-registration" || pipeline === "admission") {
    return "admission";
  }
  const lead = leadById.get(String(log?.leadId || "").trim());
  if (lead) return getLeadInflowSection(lead);
  return "workshop";
}

function getLogInflowCampaign(log = {}, leadById = new Map()) {
  const lead = leadById.get(String(log?.leadId || "").trim());
  return String(
    log?.campaignName ||
    log?.formName ||
    log?.formId ||
    lead?.metaCampaignName ||
    lead?.metaAdsetName ||
    lead?.metaAdName ||
    lead?.elementorFormName ||
    ""
  ).trim() || "Unspecified Campaign";
}

function buildLeadInflowEventFromLog(source, log = {}, leadById = new Map()) {
  if (!isDuplicateInflowLog(log)) return null;
  const leadId = String(log?.leadId || "").trim();
  const sourceEventId = String(
    log?.leadgenId ||
    log?.dedupeKey ||
    log?.eventId ||
    ""
  ).trim() || crypto
    .createHash("sha1")
    .update(`${source}|${log?.receivedAt || ""}|${leadId}|${log?.message || ""}|${log?.formId || ""}|${log?.campaignName || ""}`)
    .digest("hex");
  return {
    eventType: "duplicate",
    source,
    section: getLogInflowSection(log, leadById),
    campaign: getLogInflowCampaign(log, leadById),
    leadId,
    sourceEventId,
    message: log?.message || "",
    receivedAt: log?.receivedAt || new Date().toISOString()
  };
}

function dedupeLeadInflowEvents(events = []) {
  const seen = new Set();
  return (Array.isArray(events) ? events : []).filter((event) => {
    if (!event) return false;
    const key = String(event.eventId || buildLeadInflowEventId(event)).trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function persistDuplicateLeadInflowLogs(source, logs = [], leadById = new Map()) {
  const events = (Array.isArray(logs) ? logs : [])
    .map((log) => buildLeadInflowEventFromLog(source, log, leadById))
    .filter(Boolean);
  for (const event of events) {
    await saveLeadInflowEvent(event);
  }
  return events.length;
}

async function getLeadInflowClearedAt() {
  if (!stateCollection) return "";
  const doc = await withMongoRetry(
    () => stateCollection.findOne({ _id: STATE_DOC_ID }),
    { retries: 1, label: "Load lead inflow clear marker" }
  ).catch(() => null);
  return String(doc?.leadInflowClearedAt || "").trim();
}

function filterLeadInflowLogsAfterClear(logs = [], clearedAt = "") {
  const markerMs = Date.parse(clearedAt);
  if (!Number.isFinite(markerMs)) return Array.isArray(logs) ? logs : [];
  return (Array.isArray(logs) ? logs : []).filter((log) => {
    const receivedMs = Date.parse(log?.receivedAt || "");
    return Number.isFinite(receivedMs) && receivedMs > markerMs;
  });
}

function filterLeadInflowLeadsAfterClear(leads = [], clearedAt = "") {
  const markerMs = Date.parse(clearedAt);
  if (!Number.isFinite(markerMs)) return Array.isArray(leads) ? leads : [];
  return (Array.isArray(leads) ? leads : []).filter((lead) => {
    const leadMs = Date.parse(lead?.createdAtExact || lead?.approvedAt || lead?.createdAt || "");
    return Number.isFinite(leadMs) && leadMs > markerMs;
  });
}

async function persistClearableLeadInflowLogs(source, logsCollection) {
  if (!logsCollection) return 0;
  const [logs, rawLeads] = await Promise.all([
    withMongoRetry(
      () => logsCollection.find({}, {
        projection: {
          _id: 0,
          type: 1,
          message: 1,
          receivedAt: 1,
          leadId: 1,
          leadgenId: 1,
          dedupeKey: 1,
          leadPipeline: 1,
          campaignName: 1,
          formName: 1,
          formId: 1
        }
      }).toArray(),
      { retries: 1, label: `Load ${source} logs for durable lead inflow` }
    ),
    withMongoRetry(
      () => leadsCollection.find({}, {
        projection: {
          _id: 0,
          id: 1,
          source: 1,
          leadPipeline: 1,
          publicCourseSegment: 1,
          metaAdName: 1,
          metaAdsetName: 1,
          metaCampaignName: 1,
          elementorFormName: 1,
          elementorFormId: 1
        }
      }).toArray(),
      { retries: 1, label: "Load leads for durable lead inflow" }
    )
  ]);
  const leads = decorateLeadListForStorage(rawLeads || []);
  const leadById = new Map(leads.map((lead) => [String(lead?.id || "").trim(), lead]));
  const clearedAt = await getLeadInflowClearedAt();
  return persistDuplicateLeadInflowLogs(source, filterLeadInflowLogsAfterClear(logs, clearedAt), leadById);
}

function getLeadInflowKey(parts = []) {
  return parts.map((part) => String(part || "").trim() || "-").join("||");
}

function addLeadInflowCount(map, keyParts, patch) {
  const key = getLeadInflowKey(keyParts);
  const current = map.get(key) || {
    date: keyParts[0],
    source: keyParts[1],
    campaign: keyParts[2],
    totalLeads: 0,
    uniqueLeads: 0,
    duplicateLeads: 0
  };
  current.totalLeads += Number(patch.totalLeads) || 0;
  current.uniqueLeads += Number(patch.uniqueLeads) || 0;
  current.duplicateLeads += Number(patch.duplicateLeads) || 0;
  map.set(key, current);
  return current;
}

function getLeadInflowWorkshopName(lead = {}) {
  return String(lead?.workshopName || lead?.admissionWorkshopName || lead?.workshop || lead?.admissionWorkshop || "").trim();
}

function getLeadInflowWorkshopDate(lead = {}) {
  return String(lead?.workshopDateLabel || lead?.admissionWorkshopDateLabel || lead?.workshopDateKey || lead?.admissionWorkshopDateKey || "").trim();
}

function getLeadInflowCourseName(lead = {}) {
  const courseIdentity = buildCourseIdentity(lead?.courseRawName || lead?.courseName || lead?.courseCode, lead);
  return isKnownPublicCourseIdentity(courseIdentity)
    ? String(courseIdentity.label || lead?.courseName || lead?.courseCode || "").trim()
    : "";
}

function buildLeadInflowReport({
  leads = [],
  inflowEvents = [],
  range = null,
  section = "workshop",
  sourceFilter = "all",
  campaignFilter = "all",
  workshopNameFilter = "all",
  workshopDateFilter = "all",
  courseNameFilter = "all"
}) {
  const normalizedSection = section === "admission" ? "admission" : "workshop";
  const leadById = new Map((Array.isArray(leads) ? leads : []).map((lead) => [String(lead?.id || "").trim(), lead]));
  const sourceOptions = new Set();
  const campaignOptions = new Set();
  const workshopNameOptions = new Set();
  const workshopDateOptions = new Set();
  const courseNameOptions = new Set();
  const sourceRows = new Map();
  const dayRows = new Map();

  const inRange = (date) => !range || (date && date >= range.start && date <= range.end);
  const matchesFilters = (source, campaign, lead = null) => {
    if (sourceFilter !== "all" && source !== sourceFilter) return false;
    if (campaignFilter !== "all" && campaign !== campaignFilter) return false;
    if (normalizedSection === "admission") {
      const courseName = lead ? getLeadInflowCourseName(lead) : "";
      return courseNameFilter === "all" || courseName === courseNameFilter;
    }
    const workshopName = lead ? getLeadInflowWorkshopName(lead) : "";
    const workshopDate = lead ? getLeadInflowWorkshopDate(lead) : "";
    return (workshopNameFilter === "all" || workshopName === workshopNameFilter)
      && (workshopDateFilter === "all" || workshopDate === workshopDateFilter);
  };

  (Array.isArray(leads) ? leads : []).forEach((lead) => {
    if (getLeadInflowSection(lead) !== normalizedSection) return;
    const dateValue = lead?.createdAtExact || lead?.approvedAt || lead?.createdAt;
    const date = parseLeadInflowDate(dateValue);
    if (!inRange(date)) return;
    const dateKey = getLeadInflowDateKey(dateValue);
    const source = getLeadInflowSource(lead);
    const campaign = getLeadInflowCampaign(lead);
    sourceOptions.add(source);
    campaignOptions.add(campaign);
    if (normalizedSection === "admission") {
      courseNameOptions.add(getLeadInflowCourseName(lead));
    } else {
      workshopNameOptions.add(getLeadInflowWorkshopName(lead));
      workshopDateOptions.add(getLeadInflowWorkshopDate(lead));
    }
    if (!matchesFilters(source, campaign, lead)) return;
    addLeadInflowCount(sourceRows, ["All", source, campaign], { totalLeads: 1, uniqueLeads: 1 });
    addLeadInflowCount(dayRows, [dateKey, source, campaign], { totalLeads: 1, uniqueLeads: 1 });
  });

  (Array.isArray(inflowEvents) ? inflowEvents : []).forEach((event) => {
    if (String(event?.eventType || "").trim().toLowerCase() !== "duplicate") return;
    if (String(event?.section || "").trim().toLowerCase() !== normalizedSection) return;
    const date = parseLeadInflowDate(event?.receivedAt);
    if (!inRange(date)) return;
    const dateKey = getLeadInflowDateKey(event?.receivedAt);
    const source = String(event?.source || "Unknown").trim() || "Unknown";
    const campaign = String(event?.campaign || "Unspecified Campaign").trim() || "Unspecified Campaign";
    const lead = leadById.get(String(event?.leadId || "").trim()) || null;
    sourceOptions.add(source);
    campaignOptions.add(campaign);
    if (normalizedSection === "admission") {
      courseNameOptions.add(getLeadInflowCourseName(lead));
    } else {
      workshopNameOptions.add(getLeadInflowWorkshopName(lead));
      workshopDateOptions.add(getLeadInflowWorkshopDate(lead));
    }
    if (!matchesFilters(source, campaign, lead)) return;
    addLeadInflowCount(sourceRows, ["All", source, campaign], { totalLeads: 1, duplicateLeads: 1 });
    addLeadInflowCount(dayRows, [dateKey, source, campaign], { totalLeads: 1, duplicateLeads: 1 });
  });

  const sourceRowList = [...sourceRows.values()]
    .map((row) => ({
      ...row,
      duplicateRate: row.totalLeads ? Math.round((row.duplicateLeads / row.totalLeads) * 1000) / 10 : 0
    }))
    .sort((left, right) => (right.totalLeads - left.totalLeads) || left.source.localeCompare(right.source) || left.campaign.localeCompare(right.campaign));

  const dayRowList = [...dayRows.values()]
    .map((row) => ({
      ...row,
      duplicateRate: row.totalLeads ? Math.round((row.duplicateLeads / row.totalLeads) * 1000) / 10 : 0
    }))
    .sort((left, right) => right.date.localeCompare(left.date) || (right.totalLeads - left.totalLeads) || left.source.localeCompare(right.source));

  const totals = [...dayRows.values()].reduce((summary, row) => {
    summary.totalLeads += row.totalLeads;
    summary.uniqueLeads += row.uniqueLeads;
    summary.duplicateLeads += row.duplicateLeads;
    return summary;
  }, { totalLeads: 0, uniqueLeads: 0, duplicateLeads: 0 });
  const topSource = sourceRowList[0]?.source || "-";
  const dayTotals = new Map();
  dayRowList.forEach((row) => dayTotals.set(row.date, (dayTotals.get(row.date) || 0) + row.totalLeads));
  const topDay = [...dayTotals.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] || "-";

  return {
    section: normalizedSection,
    filters: {
      sources: [...sourceOptions].filter(Boolean).sort((a, b) => a.localeCompare(b)),
      campaigns: [...campaignOptions].filter(Boolean).sort((a, b) => a.localeCompare(b)),
      workshopNames: [...workshopNameOptions].filter(Boolean).sort((a, b) => a.localeCompare(b)),
      workshopDates: [...workshopDateOptions].filter(Boolean).sort((a, b) => a.localeCompare(b)),
      courseNames: [...courseNameOptions].filter(Boolean).sort((a, b) => a.localeCompare(b))
    },
    metrics: {
      ...totals,
      duplicateRate: totals.totalLeads ? Math.round((totals.duplicateLeads / totals.totalLeads) * 1000) / 10 : 0,
      topSource,
      topDay
    },
    sourceRows: sourceRowList,
    dayRows: dayRowList
  };
}

function restoreLostLeadPatch(lead = {}) {
  const pipeline = String(lead?.leadPipeline || "").trim().toLowerCase();
  if (pipeline === MAIN_ADMISSION_PIPELINE) {
    return {
      mainAdmissionCourseStatus: "",
      mainAdmissionActivityUpdated: false,
      updatedAt: new Date().toISOString()
    };
  }
  if (pipeline === "course-registration") {
    return {
      registeredCourseStatus: "",
      registeredActivityUpdated: false,
      updatedAt: new Date().toISOString()
    };
  }
  if (String(lead?.wsStatus || "").trim() === "Not Interested") {
    return {
      wsStatus: "",
      updatedAt: new Date().toISOString()
    };
  }
  return {
    courseStatus: "",
    postStatusUpdated: false,
    updatedAt: new Date().toISOString()
  };
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
  const archivedLead = normalizeArchivedLeadDoc({
    _id: `archived-lead-${crypto.randomUUID()}`,
    name: lead?.name,
    email: lead?.email,
    phone: lead?.phone,
    courseName: getLostLeadProgramName(lead)
  });

  archivedLead.archivedFrom = "lost-lead";
  archivedLead.sourceLeadId = String(lead?.id || "").trim();
  return archivedLead;
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
  const liveLeadIdQuery = buildLiveLeadIdQuery(
    staleLostLeads.map((lead) => ({ id: lead?.id })),
    leadIds
  );

  const existingArchiveRows = leadIds.length
    ? await lsqArchiveCollection.find({
        archivedFrom: "lost-lead",
        sourceLeadId: { $in: leadIds }
      }).project({ sourceLeadId: 1 }).toArray()
    : [];
  const archivedSourceLeadIds = new Set(
    existingArchiveRows.map((row) => String(row?.sourceLeadId || "").trim()).filter(Boolean)
  );
  const uniqueArchivedDocs = archivedDocs.filter(
    (doc) => !archivedSourceLeadIds.has(String(doc?.sourceLeadId || "").trim())
  );

  if (uniqueArchivedDocs.length) {
    await lsqArchiveCollection.insertMany(uniqueArchivedDocs, { ordered: false });
  }
  if (liveLeadIdQuery) {
    await leadsCollection.deleteMany(liveLeadIdQuery);
  }

  await touchStateUpdatedAt();
  const nextState = await refreshStateAfterAtomicUpdate();
  return { movedCount: uniqueArchivedDocs.length, state: nextState };
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
          maxPoolSize: MONGODB_MAX_POOL_SIZE,
          minPoolSize: MONGODB_MIN_POOL_SIZE,
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
        performanceLogsCollection = db.collection(MONGODB_PERFORMANCE_LOGS_COLLECTION);

        leadsCollection      = db.collection("leads");
        counselorsCollection = db.collection("counselors");
        tasksCollection      = db.collection("tasks");
        allocationCollection = db.collection("allocation");
        notificationsCollection = db.collection("notifications");
        activityLogsCollection  = db.collection("activity_logs");
        leadClaimsCollection    = db.collection("lead_claims");
        leadCreationRequestsCollection = db.collection("lead_creation_requests");
        lsqArchiveCollection = db.collection(MONGODB_LSQ_ARCHIVE_COLLECTION);
        leadInflowCollection = db.collection(MONGODB_LEAD_INFLOW_COLLECTION);

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
        await performanceLogsCollection.createIndex(
          { createdAt: -1 },
          { background: true }
        ).catch(() => undefined);
        await performanceLogsCollection.createIndex(
          { kind: 1, operation: 1, createdAt: -1 },
          { background: true }
        ).catch(() => undefined);
        await performanceLogsCollection.createIndex(
          { createdAtDate: 1 },
          { expireAfterSeconds: 30 * 24 * 60 * 60, background: true }
        ).catch(() => undefined);
        await leadInflowCollection.createIndex(
          { eventId: 1 },
          { unique: true, background: true }
        ).catch(() => undefined);
        await leadInflowCollection.createIndex(
          { receivedAt: -1, section: 1, source: 1, campaign: 1 },
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
            background: true,
            partialFilterExpression: {
              normalizedEmail: { $exists: true, $type: "string" }
            }
          }
        ).catch((error) => console.error("Failed to create normalizedEmail_1 lead index:", error.message));
        await leadsCollection.createIndex(
          { normalizedPhone: 1 },
          {
            name: "normalizedPhone_1",
            background: true,
            partialFilterExpression: {
              normalizedPhone: { $exists: true, $type: "string" }
            }
          }
        ).catch((error) => console.error("Failed to create normalizedPhone_1 lead index:", error.message));
        await leadsCollection.createIndex({ email: 1 }, { background: true }).catch(() => undefined);
        await leadsCollection.createIndex({ phone: 1 }, { background: true }).catch(() => undefined);
        await leadsCollection.createIndex({ counselor: 1, createdAt: -1 }, { background: true }).catch(() => undefined);
        await leadsCollection.createIndex({ leadPipeline: 1, createdAt: -1 }, { background: true }).catch(() => undefined);
        await leadsCollection.createIndex({ leadPipeline: 1, counselor: 1, createdAt: -1 }, { background: true }).catch(() => undefined);
        await leadsCollection.createIndex({ leadPipeline: 1, lsqImported: 1, createdAt: -1 }, { background: true }).catch(() => undefined);
        await leadsCollection.createIndex({ leadPipeline: 1, mainAdmissionCourseStatus: 1, createdAt: -1 }, { background: true }).catch(() => undefined);
        await leadsCollection.createIndex({ leadPipeline: 1, mainAdmissionAdmissionStatus: 1, createdAt: -1 }, { background: true }).catch(() => undefined);
        await leadsCollection.createIndex({ leadPipeline: 1, mainAdmissionCallStatus: 1, createdAt: -1 }, { background: true }).catch(() => undefined);
        await leadsCollection.createIndex({ leadPipeline: 1, registeredCourseStatus: 1, createdAt: -1 }, { background: true }).catch(() => undefined);
        await leadsCollection.createIndex({ leadPipeline: 1, registeredAdmissionStatus: 1, createdAt: -1 }, { background: true }).catch(() => undefined);
        await leadsCollection.createIndex({ leadPipeline: 1, registeredCallStatus: 1, createdAt: -1 }, { background: true }).catch(() => undefined);
        await leadsCollection.createIndex({ createdAt: -1 }, { background: true }).catch(() => undefined);
        await leadsCollection.createIndex({ updatedAt: -1, createdAt: -1 }, { background: true }).catch(() => undefined);
        await leadsCollection.createIndex({ counselor: 1, updatedAt: -1, createdAt: -1 }, { background: true }).catch(() => undefined);
        await leadsCollection.createIndex({ source: 1, updatedAt: -1 }, { background: true }).catch(() => undefined);
        await leadsCollection.createIndex({ leadSource: 1, updatedAt: -1 }, { background: true }).catch(() => undefined);
        await leadsCollection.createIndex({ lsqImported: 1, lsqArchivedLead: 1, updatedAt: -1 }, { background: true }).catch(() => undefined);
        await leadsCollection.createIndex({ "workshopActivityHistory.at": -1 }, { background: true }).catch(() => undefined);
        await leadsCollection.createIndex({ "admissionActivityHistory.at": -1 }, { background: true }).catch(() => undefined);
        await leadsCollection.createIndex({ "mainAdmissionActivityHistory.at": -1 }, { background: true }).catch(() => undefined);
        await leadsCollection.createIndex({ "registeredCourseActivityHistory.at": -1 }, { background: true }).catch(() => undefined);
        await leadsCollection.createIndex({ "mcubeCallHistory.receivedAt": -1 }, { background: true }).catch(() => undefined);
        await leadsCollection.createIndex({ counselor: 1, leadPipeline: 1 }, { background: true }).catch(() => undefined);
        await tasksCollection.createIndex({ id: 1 }, { unique: true, background: true }).catch(() => undefined);
        await tasksCollection.createIndex({ leadId: 1, dueDate: 1 }, { background: true }).catch(() => undefined);
        await tasksCollection.createIndex({ counselor: 1, dueDate: 1 }, { background: true }).catch(() => undefined);
        await counselorsCollection.createIndex({ email: 1 }, { unique: true, background: true }).catch(() => undefined);
        await counselorsCollection.createIndex({ name: 1 }, { background: true }).catch(() => undefined);
        await notificationsCollection.createIndex({ userId: 1, read: 1 }, { background: true }).catch(() => undefined);
        await notificationsCollection.createIndex({ userId: 1, read: 1, createdAt: -1 }, { background: true }).catch(() => undefined);

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
        performanceLogsCollection = new MockCollection("performanceLogs");
        leadsCollection      = new MockCollection("leads");
        counselorsCollection = new MockCollection("counselors");
        tasksCollection      = new MockCollection("tasks");
        allocationCollection = new MockCollection("allocation");
        notificationsCollection = new MockCollection("notifications");
        activityLogsCollection  = new MockCollection("activityLogs");
        leadClaimsCollection    = new MockCollection("leadClaims");
        leadCreationRequestsCollection = new MockCollection("leadCreationRequests");
        lsqArchiveCollection = new MockCollection("lsqArchive");
        leadInflowCollection = new MockCollection("leadInflowEvents");
        
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
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric > 8 * 60 * 60 ? 0 : Math.round(numeric);
  }

  const text = String(value).trim();
  const timeMatch = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!timeMatch) return 0;
  const first = Number(timeMatch[1]);
  const second = Number(timeMatch[2]);
  const third = Number(timeMatch[3] || 0);
  const parsed = timeMatch[3] ? (first * 3600) + (second * 60) + third : (first * 60) + second;
  return parsed > 8 * 60 * 60 ? 0 : parsed;
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

  const answeredDuration = parseMcubeDurationSeconds(answeredTime);
  if (answeredDuration) return answeredDuration;

  const endMs = parseMcubeTimestampMs(endedAt);
  const answerMs = parseMcubeTimestampMs(answeredTime);
  if (endMs && answerMs && endMs > answerMs) {
    return Math.round((endMs - answerMs) / 1000);
  }

  const startMs = parseMcubeTimestampMs(startedAt);
  const answerOffsetSeconds = answeredDuration;
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
  const matches = (Array.isArray(state?.leads) ? state.leads : []).filter(
    (lead) => normalizeLeadPhone(lead?.phone) === normalizedPhone
  );
  if (!matches.length) {
    return null;
  }

  const rankedMatches = [...matches].sort((left, right) => {
    const leftAssigned = shouldTreatLeadAsAssigned(left?.counselor) ? 1 : 0;
    const rightAssigned = shouldTreatLeadAsAssigned(right?.counselor) ? 1 : 0;
    if (leftAssigned !== rightAssigned) {
      return rightAssigned - leftAssigned;
    }

    const leftUpdatedAt = Date.parse(String(left?.updatedAt || left?.createdAtExact || left?.createdAt || ""));
    const rightUpdatedAt = Date.parse(String(right?.updatedAt || right?.createdAtExact || right?.createdAt || ""));
    const safeLeftUpdatedAt = Number.isFinite(leftUpdatedAt) ? leftUpdatedAt : 0;
    const safeRightUpdatedAt = Number.isFinite(rightUpdatedAt) ? rightUpdatedAt : 0;
    return safeRightUpdatedAt - safeLeftUpdatedAt;
  });

  return rankedMatches[0] || null;
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

function findCounselorForMcubeRouting(state = {}, counselorName = "") {
  const normalizedName = String(counselorName || "").trim().toLowerCase();
  if (!normalizedName || normalizedName === "unassigned") {
    return null;
  }
  return (Array.isArray(state?.counselors) ? state.counselors : []).find(
    (item) => String(item?.name || "").trim().toLowerCase() === normalizedName
  ) || null;
}

async function findLeadByPhoneForMcubeRouting(phone) {
  const normalizedPhone = normalizeLeadPhone(phone);
  if (!normalizedPhone) {
    return null;
  }

  const projection = {
    _id: 0,
    id: 1,
    name: 1,
    phone: 1,
    counselor: 1,
    leadPipeline: 1,
    updatedAt: 1,
    createdAtExact: 1,
    createdAt: 1
  };
  const matches = await withMongoRetry(
    () => leadsCollection.find(
      { normalizedPhone },
      { projection }
    ).limit(8).toArray(),
    { retries: 1, label: "Find MCUBE routing lead by normalized phone" }
  );

  if (!Array.isArray(matches) || !matches.length) {
    return null;
  }

  return [...matches].sort((left, right) => {
    const leftAssigned = shouldTreatLeadAsAssigned(left?.counselor) ? 1 : 0;
    const rightAssigned = shouldTreatLeadAsAssigned(right?.counselor) ? 1 : 0;
    if (leftAssigned !== rightAssigned) {
      return rightAssigned - leftAssigned;
    }

    const leftUpdatedAt = Date.parse(String(left?.updatedAt || left?.createdAtExact || left?.createdAt || ""));
    const rightUpdatedAt = Date.parse(String(right?.updatedAt || right?.createdAtExact || right?.createdAt || ""));
    const safeLeftUpdatedAt = Number.isFinite(leftUpdatedAt) ? leftUpdatedAt : 0;
    const safeRightUpdatedAt = Number.isFinite(rightUpdatedAt) ? rightUpdatedAt : 0;
    return safeRightUpdatedAt - safeLeftUpdatedAt;
  })[0] || null;
}

async function findCounselorByNameForMcubeRouting(counselorName) {
  const normalizedName = String(counselorName || "").trim();
  if (!normalizedName || normalizedName.toLowerCase() === "unassigned") {
    return null;
  }

  return withMongoRetry(
    () => counselorsCollection.findOne({
      name: { $regex: new RegExp(`^${escapeRegExp(normalizedName)}$`, "i") }
    }),
    { retries: 1, label: "Find MCUBE routing counselor" }
  );
}

function saveMcubeCallRoutingLogAfterResponse(entry) {
  setImmediate(() => {
    saveMcubeLog(entry).catch(() => undefined);
  });
}

function getMcubeRoutingCustomerNumber(req) {
  const sources = [req.query || {}, req.body || {}];
  const fields = [
    "customer_number",
    "customerNumber",
    "custnumber",
    "custNumber",
    "phone",
    "mobile",
    "caller",
    "callerid",
    "callfrom",
    "from"
  ];

  for (const source of sources) {
    for (const field of fields) {
      const value = String(source?.[field] || "").trim();
      if (value) return value;
    }
  }

  return "";
}

function isMcubeCallRoutingRequestAuthorized(req, config = {}) {
  const secret = String(config.webhookSecret || "").trim();
  if (!secret) {
    return true;
  }

  const candidates = [
    req.headers?.["x-mcube-secret"],
    req.headers?.["x-api-key"],
    req.headers?.authorization,
    req.query?.secret,
    req.query?.token,
    req.body?.secret,
    req.body?.token
  ].map((value) => String(value || "").replace(/^Bearer\s+/i, "").trim()).filter(Boolean);

  return candidates.some((value) => value === secret);
}

function wantsJsonMcubeRoutingResponse(req) {
  const format = String(req.query?.format || req.body?.format || "").trim().toLowerCase();
  const accept = String(req.headers?.accept || "").trim().toLowerCase();
  return format === "json" || accept.includes("application/json");
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
    counselorName: String(extra.counselorName || "").trim(),
    agentName: String(event?.counselorName || extra.agentName || "").trim(),
    actualAgentName: String(extra.actualAgentName || event?.counselorName || "").trim(),
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

function hasWorkshopRoutingSignal(...parts) {
  return WORKSHOP_ROUTING_SIGNAL_PATTERN.test(
    parts.map((value) => normalizeMetaLabel(value).toLowerCase()).filter(Boolean).join(" ")
  );
}

function shouldRouteKnownCourseToAdmission(leadType, courseIdentity = {}, ...sourceParts) {
  return String(leadType || "").trim().toLowerCase() !== "workshop"
    && !hasWorkshopRoutingSignal(...sourceParts)
    && isKnownPublicCourseIdentity(courseIdentity);
}

function classifyIncomingMetaLead(fields = {}, meta = {}) {
  const descriptor = getMetaLeadDescriptor(fields, meta);
  const hasWorkshopSignal = hasWorkshopRoutingSignal(descriptor);
  const hasCourseCatalogSignal = /\b(apids|apida|apcs|das|fde|aiml|genai|gen ai|7days|7 days|forward deployed engineer|forward deployment engineer)\b/i.test(descriptor);
  const hasAdmissionSignal = /\b(admission|admissions|enroll|enrol|course|program|programme|counselling|counseling|brochure|fees|career|certification|adv ai ml|advanced ai ml|ai ml|data analytics|data science|cybersecurity|cyber security|full stack)\b/i.test(descriptor);

  if (hasWorkshopSignal) {
    return "workshop";
  }

  if (hasCourseCatalogSignal) {
    return "admission";
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
  const hasWorkshopSignal = hasWorkshopRoutingSignal(descriptor);
  const hasCourseCatalogSignal = /\b(apids|apida|apcs|das|fde|aiml|genai|gen ai|7days|7 days|forward deployed engineer|forward deployment engineer)\b/i.test(descriptor);
  const hasAdmissionSignal = /\b(admission|admissions|enroll|enrol|course|program|programme|counselling|counseling|brochure|fees|career|certification|adv ai ml|advanced ai ml|ai ml|data analytics|data science|cybersecurity|cyber security|full stack)\b/i.test(descriptor);

  if (hasWorkshopSignal) {
    return "workshop";
  }

  if (hasCourseCatalogSignal || hasCrashCourseSignal) {
    return "admission";
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
  let lead = event.leadId ? await findLeadByIdentityFromCollection(event.leadId) : null;
  if (!lead && event.phone) {
    lead = await findLeadByContactFromCollection({ phone: event.phone });
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
  const shouldAssignFromPickedCall = event.direction === "inbound"
    && (!shouldTreatLeadAsAssigned(lead.counselor) || isArchivedOrLostLead(lead))
    && shouldTreatLeadAsAssigned(assignment.counselorName);
  const effectiveCounselorName = String(
    shouldAssignFromPickedCall ? assignment.counselorName : lead.counselor
  ).trim() || "Unassigned";
  const mcubeUpdatedAt = new Date().toISOString();
  const pickedCallAssignmentPatch = shouldAssignFromPickedCall
    ? getLeadAssignmentPatch(lead, effectiveCounselorName, mcubeUpdatedAt)
    : {};
  const history = Array.isArray(lead.mcubeCallHistory) ? lead.mcubeCallHistory : [];
  const nextHistory = [
    {
      at: mcubeUpdatedAt,
      counselor: effectiveCounselorName,
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
    ...pickedCallAssignmentPatch,
    counselor: effectiveCounselorName,
    updatedAt: mcubeUpdatedAt,
    mcubeCallHistory: nextHistory,
    mcubePickedBy: assignment.pickedBy || lead.mcubePickedBy || "",
    mcubePickedByPhone: assignment.pickedByPhone || lead.mcubePickedByPhone || "",
    mcubeAssignmentNote: assignment.assignmentNote || lead.mcubeAssignmentNote || "",
    mcubeLastEventType: event.eventType,
    mcubeLastDisposition: event.disposition,
    mcubeLastCallId: event.callId,
    mcubeLastEventAt: mcubeUpdatedAt,
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
      counselorName: effectiveCounselorName,
      agentName: effectiveCounselorName,
      actualAgentName: event.counselorName,
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
    await persistClearableLeadInflowLogs("Meta", metaLogsCollection);
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
    await persistClearableLeadInflowLogs("Elementor", elementorLogsCollection);
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

    const lead = await findLeadByContactFromCollection({ phone });
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

app.all("/api/mcube/call-routing", async (req, res) => {
  try {
    await initMongo();
    const config = await getMcubeConfig();
    if (!config.enabled) {
      return res.status(503).type("text/plain").send("");
    }
    if (!isMcubeCallRoutingRequestAuthorized(req, config)) {
      return res.status(403).type("text/plain").send("");
    }

    const customerNumber = getMcubeRoutingCustomerNumber(req);
    const normalizedCustomerNumber = normalizeLeadPhone(customerNumber);
    if (!normalizedCustomerNumber) {
      return res.status(400).type("text/plain").send("");
    }

    const lead = await findLeadByPhoneForMcubeRouting(normalizedCustomerNumber);
    const counselorName = String(lead?.counselor || "").trim();
    const counselorDoc = await findCounselorByNameForMcubeRouting(counselorName);
    const agentNumber = normalizeMcubeDialNumber(getMcubeExecutiveNumber(counselorDoc, {}, config));
    const matched = !!lead && !!agentNumber;

    saveMcubeCallRoutingLogAfterResponse({
      type: matched ? "success" : "ignored",
      message: matched
        ? `Inbound callback routed to ${counselorName}.`
        : "Inbound callback routing did not find an assigned counselor number.",
      leadId: String(lead?.id || "").trim(),
      leadName: String(lead?.name || "").trim(),
      counselor: counselorName || "Unassigned",
      leadPipeline: lead?.leadPipeline || "",
      assignmentStatus: shouldTreatLeadAsAssigned(counselorName) ? "Assigned" : "Unassigned",
      direction: "inbound",
      eventType: "call-routing",
      phone: normalizedCustomerNumber,
      agentNumber: agentNumber || "",
      found: !!lead
    });

    if (wantsJsonMcubeRoutingResponse(req)) {
      return res.status(matched ? 200 : 404).json({
        ok: matched,
        agentNumber: matched ? agentNumber : "",
        leadId: String(lead?.id || "").trim(),
        counselor: counselorName || ""
      });
    }

    return res.status(200).type("text/plain").send(matched ? agentNumber : "");
  } catch (err) {
    try {
      await saveMcubeLog({ type: "error", message: `MCUBE call routing error: ${err.message || "unknown error"}` });
    } catch {}
    return res.status(500).type("text/plain").send("");
  }
});

app.post("/api/mcube/click-to-call", async (req, res) => {
  try {
    const session = await requireRole(req, res, ["admin", "counselor", "manager"]);
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
    const lead = leadId
      ? await findLeadByIdentityFromCollection(leadId)
      : (phone ? await findLeadByContactFromCollection({ phone }) : null);
    const targetPhone = normalizeMcubeDialNumber(phone || lead?.phone || "");
    if (!targetPhone) {
      return res.status(400).json({ message: "A target phone number is required." });
    }
    const accessState = lead ? await buildLeadActionState(lead) : state;
    if (isCounselorLikeSession(session) && lead && !canMutateLead(session, accessState, lead)) {
      return res.status(403).json({ message: "Only the assigned counselor can call this lead." });
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
    const lead =
      (normalized.leadId ? await findLeadByIdentityFromCollection(normalized.leadId, normalized.leadEmail) : null)
      || await findLeadByContactFromCollection({ email: normalized.leadEmail, phone: normalized.phone });

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
    const session = await requireRole(req, res, ["admin", "counselor", "manager"]);
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
  return isMainAdmissionPipelineValue(lead?.leadPipeline)
    || (
      Boolean(lead?.lsqImported)
      && !isLsqArchivedLead(lead)
    );
}

function isCrashCourseRegistrationLead(lead) {
  return isPublicCourseRegistrationLead(lead)
    && normalizePublicCourseSegment(lead?.publicCourseSegment || getPublicCourseSegment(lead)) === PUBLIC_COURSE_CRASH_SEGMENT;
}

function isAdmissionSopScopedLead(lead) {
  return !isLeadSquaredImportedLead(lead)
    && (isMainAdmissionPipelineValue(lead?.leadPipeline) || isPublicCourseRegistrationLead(lead));
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

function isLeadSquaredImportedLead(lead) {
  return Boolean(lead?.lsqImported)
    || String(lead?.source || "").trim().toLowerCase().includes("leadsquared")
    || Boolean(lead?.lsqSourceSnapshot);
}

function hasAdmissionSopWhatsAppSignal(value) {
  return /whatsapp|reachout/i.test(String(value || "").trim());
}

function isAdmissionSopSystemActivityEntry(entry = {}) {
  const by = String(entry?.by || "").trim().toLowerCase();
  const source = String(entry?.source || "").trim().toLowerCase();
  return ADMISSION_SOP_SYSTEM_ACTIVITY_ACTORS.has(by)
    || ADMISSION_SOP_SYSTEM_ACTIVITY_ACTORS.has(source)
    || by.startsWith("system:")
    || source.startsWith("system:")
    || source.includes("webhook");
}

function isAdmissionSopCounselorProgressEvent(entry = {}, options = {}) {
  if (!entry || typeof entry !== "object" || isAdmissionSopSystemActivityEntry(entry)) {
    return false;
  }

  const activityType = String(entry.activityType || entry.type || entry.eventType || entry.actionType || entry.label || "").trim();
  const actionDescription = String(entry.actionDescription || entry.description || "").trim();
  if (
    ADMISSION_SOP_EXCLUDED_ACTIVITY_TYPES.has(activityType)
    || hasAdmissionSopWhatsAppSignal(activityType)
    || hasAdmissionSopWhatsAppSignal(actionDescription)
  ) {
    return false;
  }

  const updates = entry.updates && typeof entry.updates === "object" ? entry.updates : null;
  if (!updates) {
    return Boolean(activityType || String(entry.by || "").trim());
  }

  const allowedFields = new Set((options.activityFields || []).map((item) => String(item || "").trim()).filter(Boolean));
  return Object.keys(updates).some((field) => {
    const normalizedField = String(field || "").trim();
    if (!normalizedField || hasAdmissionSopWhatsAppSignal(normalizedField)) {
      return false;
    }
    return !allowedFields.size || allowedFields.has(normalizedField);
  });
}

function getAdmissionSopAnchorAt(lead, trackingConfig) {
  const explicit = String(lead?.admissionSopLastProgressAt || "").trim();
  if (explicit && isLeadSquaredImportedLead(lead)) {
    return explicit;
  }

  const history = Array.isArray(lead?.[trackingConfig?.activityHistoryField]) ? lead[trackingConfig.activityHistoryField] : [];
  const activityOptions = ADMISSION_SOP_ACTIVITY_OPTIONS_BY_HISTORY_FIELD[trackingConfig?.activityHistoryField] || {};
  const latestEntry = history
    .filter((entry) => isAdmissionSopCounselorProgressEvent(entry, activityOptions))
    .map((entry) => String(entry?.at || "").trim())
    .filter(Boolean)
    .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0];
  if (latestEntry) {
    return latestEntry;
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

function isAdmissionSopEnabledInState(state = {}) {
  return state?.admissionSopEnabled !== false;
}

function deriveAdmissionSopState(lead, nowValue = Date.now(), options = {}) {
  if (options?.enabled === false) {
    return null;
  }
  if (!isAdmissionSopScopedLead(lead)) {
    return null;
  }
  if (lead?.lsqImported || lead?.sopExcluded) {
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
  const overrideDeadlineTs = new Date(String(lead?.admissionSopDeadlineOverrideAt || "")).getTime();
  const effectiveDeadlineTs = Number.isFinite(overrideDeadlineTs) ? overrideDeadlineTs : deadlineTs;
  const remainingMs = Number.isFinite(effectiveDeadlineTs) ? effectiveDeadlineTs - nowTs : null;
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
    deadlineAt: Number.isFinite(effectiveDeadlineTs) ? new Date(effectiveDeadlineTs).toISOString() : null,
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

function isMongoDuplicateKeyError(error) {
  return Number(error?.code) === 11000;
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
    accumulator[key] = key === "lostLeads"
      ? false
      : Object.prototype.hasOwnProperty.call(permissions || {}, key)
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

function isAdminLikeSession(session) {
  const role = String(session?.role || "").trim().toLowerCase();
  return role === "admin" || role === "super_admin";
}

function canUseLostLeadCounselorFilter(session) {
  const role = String(session?.role || "").trim().toLowerCase();
  return role === "admin" || role === "super_admin" || role === "manager";
}

function isCounselorLikeSession(session) {
  const role = String(session?.role || "").trim().toLowerCase();
  return role === "counselor" || role === "manager";
}

function getSessionPagePermissions(session = {}) {
  const role = String(session.role || "").trim().toLowerCase();
  if (role === "super_admin") {
    return { ...FULL_PAGE_ACCESS };
  }
  if (role === "admin") {
    return normalizePagePermissions(session.permissions || {}, ADMIN_DEFAULT_PAGE_ACCESS);
  }
  if (role === "marketing") {
    return normalizePagePermissions(session.permissions || {}, MARKETING_DEFAULT_PAGE_ACCESS);
  }
  if (role === "manager") {
    return {
      ...normalizePagePermissions(session.permissions || {}, MANAGER_DEFAULT_PAGE_ACCESS),
      counselorManagement: false,
      leadControl: false,
      leadFlowControl: false,
      performanceLogs: false
    };
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

async function findLeadByIdentityFromCollection(leadId, leadEmail = "") {
  const query = { id: { $in: getLeadIdCandidates(leadId) } };
  const email = String(leadEmail || "").trim().toLowerCase();
  if (email) {
    query.email = email;
  }
  const rawLead = await withMongoRetry(
    () => leadsCollection.findOne(query),
    { retries: 1, label: "Load lead by identity" }
  );
  if (!rawLead) {
    return null;
  }
  return decorateLeadForStorage(rawLead);
}

async function findLeadByContactFromCollection({ email = "", phone = "" } = {}) {
  const normalizedEmail = normalizeLeadEmail(email);
  const normalizedPhone = normalizeLeadPhone(phone);
  const conditions = [];
  if (normalizedEmail) {
    conditions.push({ normalizedEmail });
    conditions.push({ email: normalizedEmail });
  }
  if (normalizedPhone) {
    conditions.push({ normalizedPhone });
  }
  if (!conditions.length) {
    return null;
  }
  const matches = await withMongoRetry(
    () => leadsCollection.find({ $or: conditions }).limit(12).toArray(),
    { retries: 1, label: "Load lead by contact" }
  );
  const decoratedMatches = decorateLeadListForStorage(matches || []);
  if (!decoratedMatches.length) {
    return null;
  }
  return [...decoratedMatches].sort((left, right) => {
    const leftAssigned = shouldTreatLeadAsAssigned(left?.counselor) ? 1 : 0;
    const rightAssigned = shouldTreatLeadAsAssigned(right?.counselor) ? 1 : 0;
    if (leftAssigned !== rightAssigned) {
      return rightAssigned - leftAssigned;
    }
    const leftUpdatedAt = Date.parse(String(left?.updatedAt || left?.createdAtExact || left?.createdAt || ""));
    const rightUpdatedAt = Date.parse(String(right?.updatedAt || right?.createdAtExact || right?.createdAt || ""));
    return (Number.isFinite(rightUpdatedAt) ? rightUpdatedAt : 0) - (Number.isFinite(leftUpdatedAt) ? leftUpdatedAt : 0);
  })[0] || null;
}

async function buildLeadActionState(lead) {
  const counselors = await withMongoRetry(
    () => counselorsCollection.find({}).toArray(),
    { retries: 1, label: "Load counselors for lead action" }
  );
  return {
    leads: lead ? [lead] : [],
    counselors: Array.isArray(counselors) ? counselors : []
  };
}

async function getRelatedLeadIdsForActivityQuery(lead) {
  if (!lead?.id) {
    return [];
  }

  const relatedIds = [String(lead.id)];
  const email = String(lead.email || "").trim().toLowerCase();
  const phone = String(lead.phone || "").trim();
  const relatedQuery = [];
  if (email) {
    relatedQuery.push({ email });
  }
  if (phone) {
    relatedQuery.push({ phone });
  }
  if (relatedQuery.length) {
    const relatedLeads = await withMongoRetry(
      () => leadsCollection.find(
        { $or: relatedQuery },
        { projection: { id: 1 } }
      ).toArray(),
      { retries: 1, label: "Load related lead ids for activity" }
    );
    (Array.isArray(relatedLeads) ? relatedLeads : []).forEach((item) => {
      if (item?.id) {
        relatedIds.push(String(item.id));
      }
    });
  }

  return [...new Set(relatedIds)];
}

function getSessionCounselorName(state, session) {
  if (!isCounselorLikeSession(session)) {
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
  if (isAdminLikeSession(session)) {
    return "";
  }

  if (!isCounselorLikeSession(session)) {
    return "Only the assigned counselor can update this lead.";
  }

  const counselorName = getSessionCounselorName(state, session).toLowerCase();
  const leadCounselor = String(lead?.counselor || "").trim().toLowerCase();
  if (!counselorName || leadCounselor !== counselorName) {
    return "Only the assigned counselor can update this lead.";
  }

  const sopState = deriveAdmissionSopState(lead, Date.now(), { enabled: isAdmissionSopEnabledInState(state) });
  if (sopState?.blocked) {
    return "This admission lead is blocked by the SOP timer and must be reassigned by an admin before further edits.";
  }

  return "";
}

function canMutateLead(session, state, lead) {
  return !getLeadMutationRestrictionMessage(session, state, lead);
}

function canViewLeadActivity(session, state, lead) {
  if (isAdminLikeSession(session)) {
    return true;
  }
  if (isCounselorLikeSession(session)) {
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
    mainAdmissionActivityTouchedByAssignee: false,
    updatedAt: assignedAt
  };

  if (!isAdmissionSopScopedLead(lead)) {
    return patch;
  }

  patch.admissionSopAssignedAt = assignedAt;
  const trackingConfig = getAdmissionSopTrackingConfig(lead);
  const hasProgress = Boolean(getAdmissionSopAnchorAt(lead, trackingConfig));
  patch.admissionSopLastProgressAt = hasProgress ? assignedAt : null;
  patch.admissionSopDeadlineOverrideAt = "";
  patch.admissionSopUnblockedAt = "";
  patch.admissionSopUnblockedBy = "";
  patch.admissionSopUnblockDays = "";
  return patch;
}

function isArchivedOrLostLead(lead = {}) {
  return isLsqArchivedLead(lead) || isServerLostLead(lead);
}

function getLeadAssignmentPatch(lead, counselor, assignedAt) {
  const patch = {
    ...getLeadAssignmentResetPatch(lead, counselor, assignedAt)
  };

  if (isLsqArchivedLead(lead)) {
    patch.lsqArchivedLead = false;
    patch.lsqArchivedAt = "";
    patch.lsqArchivedBy = "";
  }

  if (isServerLostLead(lead)) {
    Object.assign(patch, restoreLostLeadPatch(lead), {
      updatedAt: assignedAt
    });
  }

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
  const hasProtectedWorkshopStatus = PROTECTED_ASSIGNMENT_WORKSHOP_STATUSES.has(
    normalizeAssignmentWorkshopStatus(lead?.courseStatus)
  );
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

function isManagerTakeEligibleLsqLead(lead) {
  if (!isLeadSquaredImportedLead(lead)) {
    return false;
  }
  if (getLeadBulkAssignmentSkipReason(lead) === "admissionProtected") {
    return false;
  }
  return normalizeAssignmentWorkshopStatus(lead?.mainAdmissionCourseStatus) !== "interested";
}

function getLeadActivityAssigneePatch(stage, session) {
  if (!isCounselorLikeSession(session)) {
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

  Object.entries(fields).forEach(([field, value]) => {
    if (!MAIN_ADMISSION_DETAIL_FIELDS.has(field)) {
      return;
    }

    const nextValue = String(value ?? "").trim();
    if (["name", "email", "phone"].includes(field) && !nextValue) {
      return;
    }

    setPatch[field] = field === "email" ? nextValue.toLowerCase() : nextValue;
  });

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

async function createDueTaskNotificationsForSession(session) {
  if (!session || !isCounselorLikeSession(session)) {
    return;
  }

  const counselorEmail = String(session.email || "").trim().toLowerCase();
  const counselor = counselorEmail
    ? await withMongoRetry(
        () => counselorsCollection.findOne(
          { email: { $regex: new RegExp(`^${escapeRegExp(counselorEmail)}$`, "i") } },
          { projection: { name: 1, email: 1 } }
        ),
        { retries: 1, label: "Load counselor for due task notifications" }
      ).catch(() => null)
    : null;
  const counselorName = String(counselor?.name || session.name || "").trim();
  if (!counselorName || !counselorEmail) {
    return;
  }

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const counselorNamePattern = new RegExp(`^${escapeRegExp(counselorName)}$`, "i");
  const candidateTasks = await withMongoRetry(
    () => tasksCollection.find({
      dueDate: { $lte: nowIso },
      $and: [
        {
          $or: [
            { reminderSentAt: null },
            { reminderSentAt: "" },
            { reminderSentAt: { $exists: false } }
          ]
        },
        {
          $or: [
            { leadCounselor: counselorNamePattern },
            { counselor: counselorNamePattern }
          ]
        }
      ]
    }).limit(50).toArray(),
    { retries: 1, label: "Load due task notification candidates" }
  );

  const normalizedCounselorName = counselorName.toLowerCase();
  const dueTasks = (Array.isArray(candidateTasks) ? candidateTasks : []).filter((task) => {
    const taskCounselor = String(task?.leadCounselor || task?.counselor || "").trim().toLowerCase();
    if (taskCounselor !== normalizedCounselorName) {
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
  if (isAdminLikeSession(session)) {
    return true;
  }

  if (!isCounselorLikeSession(session)) {
    return false;
  }

  const counselorName = getSessionCounselorName(state, session).toLowerCase();
  const leadCounselor = String(task?.leadCounselor || "").trim().toLowerCase();
  const taskCounselor = String(task?.counselor || "").trim().toLowerCase();
  return !!counselorName && (leadCounselor === counselorName || taskCounselor === counselorName);
}

function getScopedTasksForSession(tasks, counselors, session) {
  const safeTasks = Array.isArray(tasks) ? tasks : [];
  if (isAdminLikeSession(session)) {
    return safeTasks;
  }
  if (!isCounselorLikeSession(session)) {
    return [];
  }

  const sessionEmail = String(session.email || "").trim().toLowerCase();
  const sessionName = String(session.name || "").trim().toLowerCase();
  const counselorMatch = (Array.isArray(counselors) ? counselors : []).find(
    (counselor) => String(counselor?.email || "").trim().toLowerCase() === sessionEmail
  );
  const counselorName = String(counselorMatch?.name || session.name || "").trim().toLowerCase() || sessionName;
  return safeTasks.filter((task) => {
    const leadCounselor = String(task?.leadCounselor || "").trim().toLowerCase();
    const taskCounselor = String(task?.counselor || "").trim().toLowerCase();
    return leadCounselor === counselorName || taskCounselor === counselorName;
  });
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

async function loadAuthDirectoryMeta() {
  const doc = await withMongoRetry(
    () => stateCollection.findOne(
      { _id: STATE_DOC_ID },
      { projection: { adminUsers: 1, marketingUsers: 1 } }
    ),
    { retries: 1, label: "Load auth directory" }
  );
  return normalizeStateDoc(doc || {});
}

async function findAdminAuthUser(identifier, password) {
  const normalizedIdentifier = String(identifier || "").trim().toLowerCase();
  const state = await loadAuthDirectoryMeta();
  const adminUsers = Array.isArray(state.adminUsers) ? state.adminUsers : [];
  return adminUsers.find((item) => {
    const phone = String(item.phone || "").trim().toLowerCase();
    const email = String(item.email || "").trim().toLowerCase();
    return String(item.password || "") === password
      && (phone === normalizedIdentifier || email === normalizedIdentifier);
  }) || null;
}

async function findMarketingAuthUser(identifier, password) {
  const email = String(identifier || "").trim().toLowerCase();
  const state = await loadAuthDirectoryMeta();
  const marketingUsers = Array.isArray(state.marketingUsers) ? state.marketingUsers : [];
  const user = marketingUsers.find(
    (item) => String(item.email || "").trim().toLowerCase() === email && String(item.password || "") === password
  ) || null;
  return { user, total: marketingUsers.length };
}

async function findCounselorAuthUser(role, identifier, password) {
  const email = String(identifier || "").trim().toLowerCase();
  const exactMatch = await withMongoRetry(
    () => counselorsCollection.findOne(
      { email },
      { projection: { _id: 0 } }
    ),
    { retries: 1, label: "Load counselor auth record" }
  );
  const fallbackMatch = exactMatch ? null : await withMongoRetry(
    () => counselorsCollection.findOne(
      { email: new RegExp(`^${escapeRegExp(email)}$`, "i") },
      { projection: { _id: 0 } }
    ),
    { retries: 1, label: "Load counselor auth record fallback" }
  );
  const counselor = exactMatch || fallbackMatch;
  if (!counselor) {
    const total = await withMongoRetry(
      () => counselorsCollection.estimatedDocumentCount(),
      { retries: 1, label: "Count counselor auth records" }
    ).catch(() => 0);
    return { user: null, total };
  }

  const accountRole = String(counselor.role || "counselor").trim().toLowerCase();
  const effectiveRole = accountRole === "manager" ? "manager" : "counselor";
  const passwordMatches = String(counselor.password || "") === password;
  return {
    user: effectiveRole === role && passwordMatches ? counselor : null,
    total: 1
  };
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

    await initMongo();

    if (role === "admin") {
      const authConfig = await getAuthConfig();
      const normalizedIdentifier = identifier.toLowerCase();
      const superAdminIdentifier = String(ADMIN_USER.id || "").trim().toLowerCase();
      const isSuperAdminLoginAttempt = Boolean(superAdminIdentifier) && normalizedIdentifier === superAdminIdentifier;

      if (isSuperAdminLoginAttempt) {
        if (password !== authConfig.superAdminPassword) {
          return res.status(401).json({
            message: "Invalid super admin credentials.",
            requiresPasscode: true
          });
        }
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

      const adminUser = await findAdminAuthUser(identifier, password);

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
      const { user: marketingUser, total: marketingUserCount } = await findMarketingAuthUser(identifier, password);

      if (!marketingUser) {
        if (!marketingUserCount) {
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

    if (role !== "counselor" && role !== "manager") {
      return res.status(400).json({ message: "Unsupported role." });
    }

    const { user: counselor, total: counselorCount } = await findCounselorAuthUser(role, identifier, password);

    if (!counselor) {
      if (!counselorCount) {
        return res.status(404).json({
          message: "Counselor credentials are not available on this deployment. Check Vercel MONGODB_URI and make sure counselor records exist in the shared database."
        });
      }

      return res.status(401).json({ message: "Invalid credentials for selected role." });
    }

    const permissions = role === "manager"
      ? {
          ...MANAGER_DEFAULT_PAGE_ACCESS,
          ...(counselor.permissions || {}),
          counselorManagement: false,
          leadControl: false,
          leadFlowControl: false,
          performanceLogs: false
        }
      : {
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

    const limit = Math.min(Math.max(Number(req.query.limit) || 1000, 1), 10000);
    const rows = await lsqArchiveCollection.find({}).sort({ _id: -1 }).limit(limit).toArray();
    const totalCount = await lsqArchiveCollection.countDocuments({});
    return res.json({ ok: true, totalCount, rows: normalizeArchivedLeadDocs(rows) });
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
    const page = parseBoundedPositiveInt(req.query?.page, 1, 1, 100000);
    const limit = parseBoundedPositiveInt(req.query?.limit, 100, 1, 250);
    const skip = (page - 1) * limit;
    const courseName = normalizeArchivedCourseName(req.query?.courseName);
    let query = courseName ? { courseName: new RegExp(escapeMongoRegex(courseName), "i") } : {};
    const search = String(req.query?.search || "").trim();
    if (search) {
      const regex = new RegExp(escapeMongoRegex(search), "i");
      query = appendMongoAnd(query, {
        $or: [
          { name: regex },
          { email: regex },
          { phone: regex },
          { courseName: regex },
          { counselor: regex }
        ]
      });
    }
    const [rows, totalCount] = await Promise.all([
      lsqArchiveCollection.find(query).sort({ _id: -1 }).skip(skip).limit(limit).toArray(),
      lsqArchiveCollection.countDocuments(query)
    ]);
    const response = {
      ok: true,
      movedCount: Number(syncResult?.movedCount) || 0,
      totalCount,
      pagination: {
        page,
        limit,
        total: totalCount || 0,
        totalPages: Math.max(1, Math.ceil((totalCount || 0) / limit)),
        returned: rows.length
      },
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

app.delete("/api/lost-leads/archive", async (req, res) => {
  try {
    const session = await requireSuperAdmin(req, res);
    if (!session) return;

    const courseNameFilter = normalizeArchivedCourseName(req.query?.courseName);
    if (!courseNameFilter) {
      const result = await lsqArchiveCollection.deleteMany({});
      return res.json({
        ok: true,
        deletedCount: Number(result?.deletedCount) || 0
      });
    }

    const rows = await lsqArchiveCollection.find({}).toArray();
    const targetIds = normalizeArchivedLeadDocs(rows)
      .filter((row) => row.courseName === courseNameFilter)
      .map((row) => row._id);

    if (!targetIds.length) {
      return res.json({ ok: true, deletedCount: 0 });
    }

    const result = await lsqArchiveCollection.deleteMany({ _id: { $in: targetIds } });
    return res.json({
      ok: true,
      deletedCount: Number(result?.deletedCount) || 0
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to delete archived leads", details: error.message });
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

app.get("/api/lost-leads", async (req, res) => {
  try {
    const session = await requireSession(req, res);
    if (!session) return;
    const permissions = getSessionPagePermissions(session);
    if (!permissions.lostLeads) {
      return res.status(403).json({ message: "You do not have permission to view lost leads." });
    }

    let query = buildLostLeadMongoQuery();
    const page = parseBoundedPositiveInt(req.query?.page, 1, 1, 100000);
    const limit = parseBoundedPositiveInt(req.query?.limit, 100, 1, 250);
    const skip = (page - 1) * limit;
    const search = String(req.query?.search || "").trim();
    if (search) {
      const regex = new RegExp(escapeMongoRegex(search), "i");
      query = appendMongoAnd(query, {
        $or: [
          { name: regex },
          { email: regex },
          { phone: regex },
          { counselor: regex },
          { courseName: regex },
          { courseCode: regex },
          { coursePitched: regex },
          { mainAdmissionCoursePitched: regex },
          { registeredCoursePitched: regex },
          { workshop: regex },
          { admissionWorkshop: regex }
        ]
      });
    }
    const courseNameFilter = normalizeArchivedCourseName(req.query?.courseName);
    if (courseNameFilter) {
      const regex = new RegExp(escapeMongoRegex(courseNameFilter), "i");
      query = appendMongoAnd(query, {
        $or: [
          { courseName: regex },
          { courseCode: regex },
          { coursePitched: regex },
          { mainAdmissionCoursePitched: regex },
          { registeredCoursePitched: regex },
          { workshop: regex },
          { admissionWorkshop: regex }
        ]
      });
    }
    const [rawLeads, totalCount, counselors] = await Promise.all([
      withMongoRetry(
        () => leadsCollection
          .find(query, { projection: LOST_LEAD_LIST_PROJECTION })
          .sort({ updatedAt: -1, createdAtExact: -1, createdAt: -1, _id: -1 })
          .skip(skip)
          .limit(limit)
          .toArray(),
        { retries: 1, label: "Load scoped lost leads" }
      ),
      withMongoRetry(
        () => leadsCollection.countDocuments(query),
        { retries: 1, label: "Count scoped lost leads" }
      ),
      withMongoRetry(
        () => counselorsCollection.find({}).toArray(),
        { retries: 1, label: "Load lost lead counselors" }
      )
    ]);
    const sessionEmail = String(session.email || "").trim().toLowerCase();
    const counselorMatch = (Array.isArray(counselors) ? counselors : []).find(
      (item) => String(item?.email || "").trim().toLowerCase() === sessionEmail
    );
    const counselorName = String(counselorMatch?.name || session.name || "").trim().toLowerCase();
    const isCounselor = session.role === "counselor";
    const leads = decorateLeadListForStorage(rawLeads || [])
      .filter((lead) => !isCounselor || String(lead?.counselor || "").trim().toLowerCase() === counselorName)
      .sort((a, b) => String(b.updatedAt || b.createdAtExact || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAtExact || a.createdAt || "")))
      .map((lead) => ({
        ...lead,
        lostSource: getLostSourceLabel(lead),
        lostProgramName: getLostLeadProgramName(lead) || "-"
      }));

    return res.json({
      ok: true,
      leads,
      pagination: {
        page,
        limit,
        total: totalCount || 0,
        totalPages: Math.max(1, Math.ceil((totalCount || 0) / limit)),
        returned: leads.length
      },
      counselors: Array.isArray(counselors) ? counselors : [],
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch lost leads", details: error.message });
  }
});

app.post("/api/lost-leads/:leadId/restore", async (req, res) => {
  try {
    const session = await requireRole(req, res, ["admin", "super_admin"]);
    if (!session) return;

    const leadId = String(req.params.leadId || "").trim();
    if (!leadId) {
      return res.status(400).json({ message: "Lead id is required." });
    }

    const lead = await withMongoRetry(
      () => leadsCollection.findOne({ id: leadId }),
      { retries: 1, label: "Load lost lead for restore" }
    );
    if (!lead || !isServerLostLead(lead)) {
      return res.status(404).json({ message: "Lost lead not found." });
    }

    const patch = restoreLostLeadPatch(lead);
    await leadsCollection.updateOne({ id: leadId }, { $set: patch });
    await touchStateUpdatedAt(patch.updatedAt);
    const updatedLead = await withMongoRetry(
      () => leadsCollection.findOne({ id: leadId }),
      { retries: 1, label: "Load restored lead" }
    );
    return res.json({ ok: true, lead: decorateLeadListForStorage([updatedLead]).at(0) || null });
  } catch (error) {
    return res.status(500).json({ message: "Failed to restore lost lead", details: error.message });
  }
});

app.delete("/api/lost-leads", async (req, res) => {
  try {
    const session = await requireSuperAdmin(req, res);
    if (!session) return;

    const courseNameFilter = normalizeArchivedCourseName(req.query?.courseName);
    const storedLeads = await withMongoRetry(
      () => leadsCollection.find({}).toArray(),
      { retries: 1, label: "Load lost leads for deletion" }
    );
    const leads = decorateLeadListForStorage(storedLeads || []);
    const targetIds = leads
      .filter((lead) => isServerLostLead(lead))
      .filter((lead) => !courseNameFilter || normalizeArchivedCourseName(getLostLeadProgramName(lead)) === courseNameFilter)
      .map((lead) => String(lead?.id || "").trim())
      .filter(Boolean);

    if (!targetIds.length) {
      const currentState = await refreshStateAfterAtomicUpdate();
      res.setHeader("ETag", buildStateEtag(currentState));
      return res.json({
        ok: true,
        deletedCount: 0,
        state: buildStateResponse(currentState)
      });
    }

    const result = await leadsCollection.deleteMany({ id: { $in: targetIds } });
    await touchStateUpdatedAt();
    const nextState = await refreshStateAfterAtomicUpdate();
    res.setHeader("ETag", buildStateEtag(nextState));
    return res.json({
      ok: true,
      deletedCount: Number(result?.deletedCount) || 0,
      state: buildStateResponse(nextState)
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to delete lost leads", details: error.message });
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
    } else if (isCounselorLikeSession(session)) {
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

    const normalizedRole = String(role || "").trim().toLowerCase();
    const normalizedUserId = normalizedRole === "admin" || normalizedRole === "super_admin"
      ? "admin"
      : String(userId).toLowerCase().trim();

    const notification = {
      id: `n-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
      userId: normalizedUserId,
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
  if (isAdminLikeSession(session)) return true;
  if (!isCounselorLikeSession(session)) return false;

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
  if (isAdminLikeSession(session)) {
    return !request.clearedByAdmin;
  }
  if (!isCounselorLikeSession(session)) {
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
  return findDuplicateLeadByEmailOrPhone(leads, incomingLead);
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
  return role === "counselor" || role === "manager";
}

function getNotificationInboxUserId(session) {
  const role = String(session?.role || "").trim().toLowerCase();
  if (role === "admin" || role === "super_admin") {
    return "admin";
  }
  return String(session?.email || "").trim().toLowerCase();
}

app.post("/api/leads/:leadId/view", async (req, res) => {
  try {
    const session = await requireSession(req, res);
    if (!session) return;

    const leadId = req.params.leadId;
    const leadEmail = String(req.body?.leadEmail || "").trim().toLowerCase();
    const lead = await findLeadByIdentityFromCollection(leadId, leadEmail);

    if (!lead) {
      return res.status(404).json({ message: "Lead not found." });
    }
    const state = await buildLeadActionState(lead);

    if (!isCounselorLeadViewNotificationEligible(session)) {
      return res.json({ ok: true, notified: false, message: "Lead view notifications are only sent for counselor or manager viewers." });
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

app.get("/api/leads/:leadId/notes", async (req, res) => {
  try {
    const session = await requireRole(req, res, ["admin", "counselor", "manager"]);
    if (!session) return;

    const leadId = req.params.leadId;
    const leadEmail = String(req.query?.leadEmail || "").trim().toLowerCase();
    const query = { id: { $in: getLeadIdCandidates(leadId) } };
    if (leadEmail) {
      query.email = leadEmail;
    }

    const rawLead = await withMongoRetry(
      () => leadsCollection.findOne(query, {
        projection: {
          id: 1,
          name: 1,
          email: 1,
          phone: 1,
          counselor: 1,
          leadNotes: 1,
          updatedAt: 1
        }
      }),
      { retries: 1, label: "Load lead notes" }
    );

    if (!rawLead) {
      return res.status(404).json({ message: "Lead not found." });
    }

    const lead = decorateLeadForStorage(rawLead);
    const updatedAt = lead?.updatedAt || new Date().toISOString();
    res.setHeader("ETag", buildStateEtag({ updatedAt }));
    return res.json({ ok: true, lead, updatedAt });
  } catch (error) {
    return res.status(500).json({ message: "Failed to load notes", details: error.message });
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
    const userId = getNotificationInboxUserId(session);
    const isPopupOnly = req.query.popup === "true";
    const requestedLimit = Number.parseInt(String(req.query.limit || "30"), 10);
    const listLimit = Math.min(50, Math.max(1, Number.isFinite(requestedLimit) ? requestedLimit : 30));
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    if (isPopupOnly) {
      await createDueTaskNotificationsForSession(session);
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
        .limit(listLimit)
        .toArray();
      return res.json(notifications);
    }
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch notifications", details: error.message });
  }
});

app.get("/api/notifications/summary", async (req, res) => {
  try {
    await initMongo();
    const activeSession = await getSessionFromRequest(req);
    if (!activeSession) {
      return res.status(401).json({ message: "No active session." });
    }

    const userId = getNotificationInboxUserId(activeSession.session);
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    const unreadCount = await notificationsCollection.countDocuments({ userId, read: false });
    return res.json({ unreadCount, updatedAt: new Date().toISOString() });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch notification summary", details: error.message });
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
    const userId = getNotificationInboxUserId(session);
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

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
    const session = await requireRole(req, res, ["admin", "counselor", "manager"]);
    if (!session) return;

    const leadId = req.params.leadId;
    const leadEmail = String(req.body?.leadEmail || "").trim().toLowerCase();
    const lead = await findLeadByIdentityFromCollection(leadId, leadEmail);

    if (!lead) {
      return res.status(404).json({ message: "Lead not found." });
    }
    const state = await buildLeadActionState(lead);
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

    cachedStateDoc = null;
    cachedStateDocAt = 0;
    const updatedLead = await findLeadByIdentityFromCollection(leadId, patch.email || leadEmail);
    const updatedAt = updatedLead?.updatedAt || now;
    res.setHeader("ETag", buildStateEtag({ updatedAt }));
    return res.json({ ok: true, lead: updatedLead, updatedAt });
  } catch (error) {
    return res.status(500).json({ message: "Failed to update lead details", details: error.message });
  }
});

app.post("/api/leads/:leadId/activity", async (req, res) => {
  try {
    const session = await requireRole(req, res, ["admin", "counselor", "manager"]);
    if (!session) return;

    const leadId = req.params.leadId;
    const leadEmail = String(req.body?.leadEmail || "").trim().toLowerCase();
    const stage = String(req.body?.stage || "").trim().toLowerCase();
    const updates = req.body?.updates || {};
    const lead = await findLeadByIdentityFromCollection(leadId, leadEmail);

    if (!lead) {
      return res.status(404).json({ message: "Lead not found." });
    }
    const state = await buildLeadActionState(lead);
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
    const now = new Date().toISOString();
    const event = {
      at: now,
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
        [config.countField]: nextCount,
        updatedAt: now
      },
      $push: {
        [config.historyField]: event
      }
    };

    if (
      (stage === "registered-course" || stage === "main-admission")
      && isAdmissionSopCounselorProgressEvent(event, ADMISSION_SOP_ACTIVITY_OPTIONS_BY_HISTORY_FIELD[config.historyField] || {})
    ) {
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
        { $set: { updatedAt: now } },
        { upsert: true }
      );
      cachedStateDoc = null;
      cachedStateDocAt = 0;
    }

    if (!result.modifiedCount) {
      return res.status(409).json({ message: "Lead changed before the activity could be saved. Please reload and retry." });
    }

    const updatedLead = decorateLeadForStorage(await leadsCollection.findOne(query));
    const updatedAt = updatedLead?.updatedAt || new Date().toISOString();
    res.setHeader("ETag", buildStateEtag({ updatedAt }));
    return res.json({ ok: true, lead: updatedLead, updatedAt });
  } catch (error) {
    return res.status(500).json({ message: "Failed to update lead activity", details: error.message });
  }
});

app.post("/api/leads/:leadId/notes", async (req, res) => {
  try {
    const session = await requireRole(req, res, ["admin", "counselor", "manager"]);
    if (!session) return;

    const leadId = req.params.leadId;
    const leadEmail = String(req.body?.leadEmail || "").trim().toLowerCase();
    const text = String(req.body?.text || "").trim();
    if (!text) {
      return res.status(400).json({ message: "Note text is required." });
    }

    const lead = await findLeadByIdentityFromCollection(leadId, leadEmail);
    if (!lead) {
      return res.status(404).json({ message: "Lead not found." });
    }
    const state = await buildLeadActionState(lead);
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
    const noteUpdatedAt = new Date().toISOString();
    const result = await leadsCollection.updateOne(
      query,
      { $push: { leadNotes: note }, $set: { updatedAt: noteUpdatedAt } }
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
        { $set: { updatedAt: noteUpdatedAt } },
        { upsert: true }
      );
      cachedStateDoc = null;
      cachedStateDocAt = 0;
    }

    if (!result.modifiedCount) {
      return res.status(409).json({ message: "Lead changed before the note could be saved. Please reload and retry." });
    }

    const updatedLead = decorateLeadForStorage(await leadsCollection.findOne(query));
    const updatedAt = updatedLead?.updatedAt || new Date().toISOString();
    res.setHeader("ETag", buildStateEtag({ updatedAt }));
    return res.json({ ok: true, lead: updatedLead, updatedAt });
  } catch (error) {
    return res.status(500).json({ message: "Failed to save note", details: error.message });
  }
});

app.delete("/api/leads/:leadId/notes/:noteIndex", async (req, res) => {
  try {
    const session = await requireRole(req, res, ["admin", "counselor", "manager"]);
    if (!session) return;

    const leadId = req.params.leadId;
    const leadEmail = String(req.query?.leadEmail || "").trim().toLowerCase();
    const noteIndex = Number(req.params.noteIndex);
    const lead = await findLeadByIdentityFromCollection(leadId, leadEmail);
    if (!lead) {
      return res.status(404).json({ message: "Lead not found." });
    }
    const state = await buildLeadActionState(lead);
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
    const deleteNoteUpdatedAt = new Date().toISOString();
    const result = await leadsCollection.updateOne(
      query,
      { $set: { leadNotes: nextNotes, updatedAt: deleteNoteUpdatedAt } }
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
        { $set: { updatedAt: deleteNoteUpdatedAt } },
        { upsert: true }
      );
      cachedStateDoc = null;
      cachedStateDocAt = 0;
    }
    if (!result.modifiedCount) {
      return res.status(409).json({ message: "Lead changed before the note could be deleted. Please reload and retry." });
    }

    const updatedLead = decorateLeadForStorage(await leadsCollection.findOne(query));
    res.setHeader("ETag", buildStateEtag({ updatedAt: deleteNoteUpdatedAt }));
    return res.json({ ok: true, lead: updatedLead, updatedAt: deleteNoteUpdatedAt });
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

function normalizeImportFileName(value) {
  return String(value || "").trim();
}

function isUploadedImportFileName(value) {
  return /\.(xlsx|csv)$/i.test(normalizeImportFileName(value));
}

function buildImportFileLeadQuery(fileName) {
  const normalized = normalizeImportFileName(fileName);
  if (!normalized) {
    return null;
  }

  const exactPattern = new RegExp(`^${escapeRegExp(normalized)}$`, "i");
  return {
    lsqImported: { $ne: true },
    $or: [
      { source: "Universal Import" },
      { leadSource: "Universal Import" }
    ],
    $and: [{
    $or: [
      { importSourceFiles: normalized },
      { importSourceFile: normalized },
      { importSourceFiles: { $regex: exactPattern } },
      { importSourceFile: { $regex: exactPattern } }
    ]
    }]
  };
}

app.get("/api/leads/import-files", async (req, res) => {
  try {
    const session = await requireRole(req, res, ["admin", "super_admin"]);
    if (!session) return;

    const rows = await withMongoRetry(
      () => leadsCollection.aggregate([
        {
          $match: {
            lsqImported: { $ne: true },
            $or: [
              { source: "Universal Import" },
              { leadSource: "Universal Import" }
            ]
          }
        },
        {
          $project: {
            name: 1,
            importedAt: 1,
            updatedAt: 1,
            sourceValues: {
              $concatArrays: [
                { $cond: [{ $isArray: "$importSourceFiles" }, "$importSourceFiles", []] },
                { $cond: [{ $ne: [{ $ifNull: ["$importSourceFile", ""] }, ""] }, ["$importSourceFile"], []] }
              ]
            }
          }
        },
        { $unwind: "$sourceValues" },
        {
          $project: {
            fileName: { $trim: { input: { $toString: "$sourceValues" } } },
            name: 1,
            importedAt: 1,
            updatedAt: 1
          }
        },
        { $match: { fileName: { $regex: /\.(xlsx|csv)$/i } } },
        {
          $group: {
            _id: "$fileName",
            leadCount: { $sum: 1 },
            lastImportedAt: { $max: "$importedAt" },
            lastUpdatedAt: { $max: "$updatedAt" },
            sampleLeadName: { $first: "$name" }
          }
        },
        { $sort: { lastImportedAt: -1, lastUpdatedAt: -1, _id: 1 } }
      ]).toArray(),
      { retries: 1, label: "Load imported file summary" }
    );

    return res.json({
      ok: true,
      files: rows.map((row) => ({
        fileName: String(row?._id || "").trim(),
        leadCount: Number(row?.leadCount) || 0,
        lastImportedAt: row?.lastImportedAt || null,
        lastUpdatedAt: row?.lastUpdatedAt || null,
        sampleLeadName: row?.sampleLeadName || ""
      })).filter((row) => row.fileName)
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to load imported files", details: error.message });
  }
});

app.delete("/api/leads/import-files/:fileName", async (req, res) => {
  try {
    const session = await requireRole(req, res, ["admin", "super_admin"]);
    if (!session) return;

    const fileName = normalizeImportFileName(req.params?.fileName);
    if (!fileName || !isUploadedImportFileName(fileName)) {
      return res.status(400).json({ message: "A valid imported .xlsx or .csv file name is required." });
    }

    const query = buildImportFileLeadQuery(fileName);
    const leadsToDelete = await withMongoRetry(
      () => leadsCollection.find(query, { projection: { id: 1, name: 1, counselor: 1, workshop: 1, courseName: 1, source: 1 } }).toArray(),
      { retries: 1, label: "Load imported file leads for deletion" }
    );

    if (!leadsToDelete.length) {
      return res.status(404).json({ message: "No leads were found for this imported file." });
    }

    const deletedLeadIds = leadsToDelete
      .map((lead) => String(lead?.id || "").trim())
      .filter(Boolean);

    const result = await withMongoRetry(
      () => leadsCollection.deleteMany(query),
      { retries: 1, label: "Delete imported file leads" }
    );

    if (!result.deletedCount) {
      return res.status(409).json({ message: "Leads changed before they could be deleted. Please reload and retry." });
    }

    if (deletedLeadIds.length) {
      await Promise.all([
        tasksCollection.deleteMany({ leadId: { $in: deletedLeadIds } }).catch(() => undefined),
        leadClaimsCollection.deleteMany({ leadId: { $in: deletedLeadIds } }).catch(() => undefined),
        leadCreationRequestsCollection.deleteMany({ leadId: { $in: deletedLeadIds } }).catch(() => undefined),
        notificationsCollection.deleteMany({ leadId: { $in: deletedLeadIds } }).catch(() => undefined)
      ]);
    }

    await recordActivity({
      leadId: "",
      leadName: fileName,
      counselorName: "",
      activityType: "Imported File Deleted",
      actionDescription: `Deleted ${result.deletedCount} lead${result.deletedCount === 1 ? "" : "s"} imported from ${fileName}`,
      previousValue: fileName,
      session
    }).catch(() => undefined);

    const now = new Date().toISOString();
    await touchStateUpdatedAt(now);
    res.setHeader("ETag", buildStateEtag({ updatedAt: now }));
    return res.json({
      ok: true,
      fileName,
      deletedCount: Number(result.deletedCount) || 0,
      deletedLeadIds,
      updatedAt: now
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to delete imported file data", details: error.message });
  }
});

async function assignLeadsHandler(req, res) {
  try {
    const session = await requireRole(req, res, ["admin", "manager"]);
    if (!session) return;

    const sessionRole = String(session.role || "").trim().toLowerCase();
    let managerCounselorName = "";
    if (sessionRole === "manager") {
      const userEmail = String(session.email || "").trim().toLowerCase();
      const counselorDoc = userEmail
        ? await withMongoRetry(
            () => counselorsCollection.findOne({ email: new RegExp(`^${escapeRegExp(userEmail)}$`, "i") }),
            { retries: 1, label: "Load counselor for manager assignment check" }
          ).catch(() => null)
        : null;
      managerCounselorName = String(counselorDoc?.name || session.name || "").trim().toLowerCase();
    }

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
    const sopSettings = await withMongoRetry(
      () => stateCollection.findOne(
        { _id: STATE_DOC_ID },
        { projection: { admissionSopEnabled: 1 } }
      ),
      { retries: 1, label: "Load SOP assignment settings" }
    );
    const admissionSopEnabled = isAdmissionSopEnabledInState(sopSettings || {});

    leadsToUpdate.forEach((lead) => {
      if (isArchivedOrLostLead(lead)) {
        assignableLeads.push(lead);
        return;
      }

      // Check if this lead is skipped/protected.
      // Super admin can assign ANY lead without any regulation.
      // Manager can assign their own leads without any exception.
      const isSuperAdmin = sessionRole === "super_admin";
      const isManagerOwnLead = sessionRole === "manager" && 
        String(lead?.counselor || "").trim().toLowerCase() === managerCounselorName;

      if (isSuperAdmin || isManagerOwnLead) {
        assignableLeads.push(lead);
        return;
      }

      const skipReason = getLeadBulkAssignmentSkipReason(lead);
      if (!skipReason) {
        const sopState = deriveAdmissionSopState(lead, Date.now(), { enabled: admissionSopEnabled });
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
      cachedStateDoc = null;
      cachedStateDocAt = 0;

      res.setHeader("ETag", buildStateEtag({ updatedAt: now }));
      return res.json({
        ok: true,
        updatedCount: 0,
        matchedCount: 0,
        assignedCount: 0,
        skippedProtectedCount,
        skippedInterestedCount,
        skippedBlockedSameCounselorCount,
        leads: [],
        updatedAt: now
      });
    }

    const assignableLeadIds = assignableLeads
      .map((lead) => lead.id)
      .filter((id) => id !== undefined && id !== null);
    const assignmentChangedLeads = assignableLeads
      .filter((lead) => isArchivedOrLostLead(lead) || String(lead.counselor || "").trim().toLowerCase() !== counselor.toLowerCase());
    const now = new Date().toISOString();
    const result = await leadsCollection.updateMany(
      { id: { $in: assignableLeadIds } },
      { $set: { counselor, updatedAt: now } }
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
          { $set: getLeadAssignmentPatch(lead, counselor, now) }
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
    cachedStateDoc = null;
    cachedStateDocAt = 0;

    const updatedLeads = decorateLeadListForStorage(
      await leadsCollection.find({ id: { $in: assignableLeadIds } }).toArray()
    );
    res.setHeader("ETag", buildStateEtag({ updatedAt: now }));
    return res.json({
      ok: true,
      updatedCount: result.modifiedCount,
      matchedCount: result.matchedCount,
      assignedCount: matchedCount,
      skippedProtectedCount,
      skippedInterestedCount,
      skippedBlockedSameCounselorCount,
      leads: updatedLeads,
      updatedAt: now
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to assign leads", details: error.message });
  }
}

app.post("/api/leads/universal-import", async (req, res) => {
  try {
    const session = await requireRole(req, res, ["admin", "super_admin"]);
    if (!session) return;

    const incomingLeads = Array.isArray(req.body?.leads) ? req.body.leads : [];
    const allocation = Array.isArray(req.body?.allocation) ? req.body.allocation : null;
    if (!incomingLeads.length) {
      return res.status(400).json({ message: "No leads were provided for import." });
    }

    const now = new Date().toISOString();
    const createdLeads = [];
    const skippedLeads = [];
    const preparedLeads = [];
    const seenEmail = new Set();
    const seenPhone = new Set();

    for (const draft of incomingLeads) {
      const normalizedDraft = decorateLeadForStorage({
        ...draft,
        id: undefined,
        importedBy: session.name || session.email || session.role || "Admin",
        importedAt: now,
        updatedAt: now
      });
      const email = normalizeLeadEmail(normalizedDraft.email);
      const phone = normalizeLeadPhone(normalizedDraft.phone);

      if ((!email && !phone) || (email && seenEmail.has(email)) || (phone && seenPhone.has(phone))) {
        skippedLeads.push({ name: normalizedDraft.name || "", reason: "Missing or duplicate contact in import batch." });
        continue;
      }

      if (email) seenEmail.add(email);
      if (phone) seenPhone.add(phone);
      preparedLeads.push({ lead: normalizedDraft, email, phone });
    }

    const emailValues = [...seenEmail];
    const phoneValues = [...seenPhone];
    const duplicateConditions = [];
    if (emailValues.length) {
      duplicateConditions.push({ normalizedEmail: { $in: emailValues } }, { email: { $in: emailValues } });
    }
    if (phoneValues.length) {
      duplicateConditions.push({ normalizedPhone: { $in: phoneValues } });
    }

    const existingLeads = duplicateConditions.length
      ? await withMongoRetry(
        () => leadsCollection
          .find({ $or: duplicateConditions }, { projection: {
            id: 1, name: 1, email: 1, phone: 1, normalizedEmail: 1, normalizedPhone: 1,
            courseId: 1, courseName: 1, courseCode: 1, leadPipeline: 1, publicCourseSegment: 1,
            mainAdmissionCoursePitched: 1, mainAdmissionActivityHistory: 1
          } })
          .toArray(),
        { retries: 1, label: "Check universal import duplicates" }
      )
      : [];
    const existingEmails = new Set(existingLeads.map((lead) => normalizeLeadEmail(lead.normalizedEmail || lead.email)).filter(Boolean));
    const existingPhones = new Set(existingLeads.map((lead) => normalizeLeadPhone(lead.normalizedPhone || lead.phone)).filter(Boolean));
    const existingByEmail = new Map(existingLeads.map((lead) => [normalizeLeadEmail(lead.normalizedEmail || lead.email), lead]).filter(([key]) => key));
    const existingByPhone = new Map(existingLeads.map((lead) => [normalizeLeadPhone(lead.normalizedPhone || lead.phone), lead]).filter(([key]) => key));

    const stateDoc = await getStateDoc();
    const coursePriorities = Array.isArray(stateDoc?.coursePriorities) ? stateDoc.coursePriorities : [
      "days7_genai",
      "advanced-aiml-genai-agentic",
      "apcs",
      "apida",
      "apids",
      "forward-deployed-engineer",
      "master-genai-agentic",
      "data-analytics-specialist"
    ];

    function getPriorityRank(courseId) {
      if (!courseId) return 999;
      const idx = coursePriorities.indexOf(courseId);
      return idx === -1 ? 999 : idx;
    }

    const importableLeads = [];
    let updatedCount = 0;

    for (const prepared of preparedLeads) {
      const duplicate = (prepared.email && existingByEmail.get(prepared.email)) || 
                        (prepared.phone && existingByPhone.get(prepared.phone));
      if (duplicate) {
        const incomingCourseId = prepared.lead.courseId;
        const existingCourseId = duplicate.courseId;

        if (incomingCourseId && getPriorityRank(incomingCourseId) < getPriorityRank(existingCourseId)) {
          const updateFields = {
            courseId: prepared.lead.courseId,
            courseName: prepared.lead.courseName,
            courseCode: prepared.lead.courseCode,
            publicCourseSegment: prepared.lead.publicCourseSegment,
            leadPipeline: prepared.lead.leadPipeline || "main-admission",
            updatedAt: now
          };
          if (updateFields.leadPipeline === "main-admission") {
            updateFields.mainAdmissionCoursePitched = prepared.lead.courseName;
          }

          const historyEntry = {
            id: Date.now() + Math.random(),
            at: now,
            by: session.name || session.email || "System",
            type: "Note",
            value: `Course updated from ${duplicate.courseName || "None"} to ${prepared.lead.courseName} via import priority rule.`
          };

          await withMongoRetry(
            () => leadsCollection.updateOne(
              { id: duplicate.id },
              {
                $set: updateFields,
                $push: { mainAdmissionActivityHistory: historyEntry }
              }
            ),
            { retries: 1, label: "Update duplicate lead course via priority" }
          );

          updatedCount++;
          skippedLeads.push({ name: prepared.lead.name || "", reason: "Updated course via priority rule.", existingId: duplicate.id, wasUpdated: true });
        } else {
          skippedLeads.push({ name: prepared.lead.name || "", reason: "Duplicate already exists in CRM.", existingId: duplicate?.id });
        }
        continue;
      }
      importableLeads.push(prepared.lead);
    }

    const reservedIds = await reserveMetaLeadIds(importableLeads.length);
    importableLeads.forEach((lead, index) => {
      lead.id = reservedIds[index] || Date.now() + index;
      createdLeads.push(decorateLeadForStorage(lead));
    });

    if (createdLeads.length) {
      await withMongoRetry(
        () => leadsCollection.insertMany(createdLeads, { ordered: false }),
        { retries: 1, label: "Insert universal imported leads" }
      );
    }

    if (allocation) {
      await allocationCollection.deleteMany({});
      if (allocation.length) {
        await allocationCollection.insertMany(allocation);
      }
    }

    await stateCollection.updateOne(
      { _id: STATE_DOC_ID },
      { $set: { updatedAt: now } },
      { upsert: true }
    );
    cachedStateDoc = null;
    cachedStateDocAt = 0;
    res.setHeader("ETag", buildStateEtag({ updatedAt: now }));
    return res.json({
      ok: true,
      createdCount: createdLeads.length,
      skippedCount: skippedLeads.length - updatedCount,
      updatedCount,
      skippedLeads,
      leads: createdLeads,
      updatedAt: now
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to import universal leads", details: error.message });
  }
});

app.patch("/api/leads/assignment", assignLeadsHandler);
app.post("/api/leads/assignment", assignLeadsHandler);

app.post("/api/leads/:leadId/take-sop", async (req, res) => {
  try {
    const session = await requireRole(req, res, "manager");
    if (!session) return;

    const leadId = String(req.params?.leadId || "").trim();
    const leadEmail = String(req.body?.leadEmail || "").trim().toLowerCase();
    if (!leadId) {
      return res.status(400).json({ message: "Lead id is required." });
    }

    const lead = await findLeadByIdentityFromCollection(leadId, leadEmail);
    if (!lead) {
      return res.status(404).json({ message: "Lead not found." });
    }
    const state = await buildLeadActionState(lead);
    const managerName = getSessionCounselorName(state, session);
    if (!managerName) {
      return res.status(403).json({ message: "Manager account details are required to take SOP leads." });
    }

    const isSopScopedLead = isAdmissionSopScopedLead(lead);
    const isEligibleLsqLead = isManagerTakeEligibleLsqLead(lead);
    if (!isSopScopedLead && !isEligibleLsqLead) {
      return res.status(400).json({ message: "Only blocked SOP leads or non-interested LSQ admission leads can be taken by a manager." });
    }

    const sopSettings = await withMongoRetry(
      () => stateCollection.findOne(
        { _id: STATE_DOC_ID },
        { projection: { admissionSopEnabled: 1 } }
      ),
      { retries: 1, label: "Load SOP take settings" }
    );
    const sopState = isSopScopedLead
      ? deriveAdmissionSopState(lead, Date.now(), { enabled: isAdmissionSopEnabledInState(sopSettings || {}) })
      : null;
    const canTakeLead = Boolean(sopState?.blocked) || isEligibleLsqLead;
    if (!canTakeLead) {
      return res.status(409).json({ message: "This lead is not eligible for manager takeover." });
    }

    const oldCounselor = String(lead.counselor || "").trim();
    if (oldCounselor.toLowerCase() === managerName.toLowerCase()) {
      return res.status(409).json({ message: "This lead is already assigned to you." });
    }

    const now = new Date().toISOString();
    const updateResult = await leadsCollection.updateOne(
      {
        id: { $in: getLeadIdCandidates(lead.id) },
        ...(leadEmail ? { email: leadEmail } : {})
      },
      { $set: getLeadAssignmentResetPatch(lead, managerName, now) }
    );
    if (!updateResult.matchedCount) {
      return res.status(409).json({ message: "Lead changed before it could be taken. Please reload and retry." });
    }

    const hasOldCounselor = oldCounselor && oldCounselor.toLowerCase() !== "unassigned";
    await recordActivity({
      leadId: lead.id,
      leadName: lead.name,
      counselorName: managerName,
      activityType: hasOldCounselor ? "Lead Reassigned" : "Lead Assigned",
      actionDescription: hasOldCounselor
        ? `${sopState?.blocked ? "SOP-blocked" : "LSQ non-interested"} lead taken by manager ${managerName} from ${oldCounselor}`
        : `${sopState?.blocked ? "SOP-blocked" : "LSQ non-interested"} lead taken by manager ${managerName}`,
      previousValue: oldCounselor || "Unassigned",
      newValue: managerName,
      session
    });

    await touchStateUpdatedAt(now);
    const updatedLead = await leadsCollection.findOne({
      id: { $in: getLeadIdCandidates(lead.id) },
      ...(leadEmail ? { email: leadEmail } : {})
    });
    const [decoratedLead] = decorateLeadListForStorage(updatedLead ? [updatedLead] : []);

    res.setHeader("ETag", buildStateEtag({ updatedAt: now }));
    return res.json({
      ok: true,
      lead: decoratedLead || null,
      updatedAt: now,
      message: `Lead assigned to ${managerName}.`
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to take SOP lead", details: error.message });
  }
});

app.post("/api/leads/sop-unblock", async (req, res) => {
  try {
    const session = await requireSuperAdmin(req, res);
    if (!session) return;

    const leadRefs = Array.isArray(req.body?.leadRefs) ? req.body.leadRefs : [];
    const rawDays = Math.round(Number(req.body?.days) || 0);
    const days = Math.max(1, Math.min(365, rawDays));
    if (!leadRefs.length) {
      return res.status(400).json({ message: "Lead references are required." });
    }
    if (!rawDays || rawDays < 1 || rawDays > 365) {
      return res.status(400).json({ message: "Custom deadline days must be between 1 and 365." });
    }

    const identityMatchConditions = buildLiveLeadIdentityMatchConditions(leadRefs);
    if (!identityMatchConditions.length) {
      return res.status(400).json({ message: "Valid lead references are required." });
    }

    const [leadsToReview, sopSettings] = await Promise.all([
      withMongoRetry(
        () => leadsCollection.find({ $or: identityMatchConditions }).toArray(),
        { retries: 1, label: "Load SOP unblock leads" }
      ).then((leads) => decorateLeadListForStorage(leads || [])),
      withMongoRetry(
        () => stateCollection.findOne(
          { _id: STATE_DOC_ID },
          { projection: { admissionSopEnabled: 1 } }
        ),
        { retries: 1, label: "Load SOP unblock settings" }
      )
    ]);
    const admissionSopEnabled = isAdmissionSopEnabledInState(sopSettings || {});
    const blockedSopLeads = leadsToReview.filter((lead) => (
      isAdmissionSopScopedLead(lead) && deriveAdmissionSopState(lead, Date.now(), { enabled: admissionSopEnabled })?.blocked
    ));

    if (!blockedSopLeads.length) {
      return res.status(409).json({ message: "No selected blocked SOP leads were eligible to unblock." });
    }

    const now = new Date().toISOString();
    const customDeadlineAt = new Date(addNonSundayWorkingDays(now, days)).toISOString();
    const updatedIds = [];

    for (const lead of blockedSopLeads) {
      const result = await leadsCollection.updateOne(
        { id: { $in: getLeadIdCandidates(lead.id) } },
        {
          $set: {
            admissionSopDeadlineOverrideAt: customDeadlineAt,
            admissionSopUnblockedAt: now,
            admissionSopUnblockedBy: session.name || session.email || session.role,
            admissionSopUnblockDays: days,
            updatedAt: now
          }
        }
      );
      if (result.matchedCount) {
        updatedIds.push(lead.id);
        await recordActivity({
          leadId: lead.id,
          leadName: lead.name,
          counselorName: lead.counselor || "",
          activityType: "SOP Unblocked",
          actionDescription: `SOP block removed by Super Admin with ${days} day deadline`,
          previousValue: deriveAdmissionSopState(lead, Date.now(), { enabled: admissionSopEnabled })?.deadlineAt || "Blocked",
          newValue: customDeadlineAt,
          session
        });
      }
    }

    await touchStateUpdatedAt(now);
    const updatedLeads = decorateLeadListForStorage(
      await leadsCollection.find({ id: { $in: updatedIds.flatMap((id) => getLeadIdCandidates(id)) } }).toArray()
    );

    res.setHeader("ETag", buildStateEtag({ updatedAt: now }));
    return res.json({
      ok: true,
      updatedCount: updatedLeads.length,
      customDeadlineAt,
      days,
      leads: updatedLeads,
      updatedAt: now
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to unblock SOP leads", details: error.message });
  }
});

app.get("/api/lead-creation-requests", async (req, res) => {
  try {
    const session = await requireRole(req, res, ["admin", "counselor", "manager"]);
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
    const session = await requireRole(req, res, ["admin", "counselor", "manager"]);
    if (!session) return;

    const now = new Date().toISOString();
    const isAdminLike = isAdminLikeSession(session);
    const query = isAdminLike
      ? { clearedByAdmin: { $ne: true } }
      : { requesterEmail: String(session.email || "").trim().toLowerCase(), clearedByRequester: { $ne: true } };
    const patch = isAdminLike
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
    const session = await requireRole(req, res, ["counselor", "manager"]);
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
      return res.status(403).json({ message: "Account details are required to create a lead." });
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

    const now = new Date().toISOString();
    const requestDoc = normalizeLeadCreationRequestDoc({
      id: `lead-request-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
      status: "approved",
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
      updatedAt: now,
      decidedAt: now,
      decidedBy: session.name || session.email || session.role
    });

    const nextId = await getNextMetaLeadId();
    const leadDraft = buildApprovedLeadFromCreationRequest(requestDoc, nextId, now);
    const duplicateLead = findLeadCreationDuplicate(state.leads, leadDraft);
    if (duplicateLead) {
      return res.status(409).json({
        message: "A matching lead already exists.",
        leadId: duplicateLead.id || null
      });
    }

    try {
      await withMongoRetry(
        () => leadsCollection.insertOne(leadDraft),
        { retries: 1, label: "Create counselor lead directly" }
      );
    } catch (error) {
      if (isMongoDuplicateKeyError(error)) {
        return res.status(409).json({ message: "A matching lead already exists.", leadId: null });
      }
      throw error;
    }
    await recordActivity({
      leadId: leadDraft.id,
      leadName: leadDraft.name,
      counselorName: leadDraft.counselor || "",
      activityType: "Lead Created",
      actionDescription: `Lead created directly by ${session.role} after duplicate validation for ${getLeadCreationTargetLabel(requestDoc)}`,
      newValue: `Name: ${leadDraft.name}, Phone: ${leadDraft.phone}, Email: ${leadDraft.email}`,
      session
    });
    if (leadDraft.counselor && leadDraft.counselor.toLowerCase() !== "unassigned") {
      await recordActivity({
        leadId: leadDraft.id,
        leadName: leadDraft.name,
        counselorName: leadDraft.counselor,
        activityType: "Lead Assigned",
        actionDescription: `Lead initially assigned to creator ${leadDraft.counselor}`,
        newValue: leadDraft.counselor,
        session
      });
    }
    requestDoc.requestedLeadId = String(leadDraft.id);
    await leadCreationRequestsCollection.insertOne(requestDoc);
    await touchStateUpdatedAt(now);
    const nextState = await refreshStateAfterAtomicUpdate();
    res.setHeader("ETag", buildStateEtag(nextState));

    return res.status(201).json({
      ok: true,
      request: serializeLeadCreationRequest(requestDoc),
      lead: leadDraft,
      state: buildStateResponse(nextState)
    });
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
          message: "A matching lead already exists.",
          leadId: duplicateLead.id || null
        });
      }

      try {
        await withMongoRetry(
          () => leadsCollection.insertOne(leadDraft),
          { retries: 1, label: "Create approved lead request" }
        );
      } catch (error) {
        if (isMongoDuplicateKeyError(error)) {
          return res.status(409).json({ message: "A matching lead already exists.", leadId: null });
        }
        throw error;
      }
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
    const session = await requireRole(req, res, ["admin", "counselor", "manager"]);
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

    const lead = await findLeadByIdentityFromCollection(leadId, leadEmail);
    if (!lead) {
      return res.status(404).json({ message: "Lead not found." });
    }
    const state = await buildLeadActionState(lead);

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
    const session = await requireRole(req, res, ["admin", "counselor", "manager"]);
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

    if (isAdminLikeSession(session)) {
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
      const lead = await findLeadByIdentityFromCollection(claim.leadId, claim.leadEmail);
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

app.get("/api/tasks", async (req, res) => {
  try {
    const session = await requireRole(req, res, ["admin", "counselor", "manager"]);
    if (!session) return;

    const [tasks, counselors] = await Promise.all([
      withMongoRetry(
        () => tasksCollection.find({}).sort({ dueDate: 1, createdAt: -1 }).toArray(),
        { retries: 1, label: "Load task tracker tasks" }
      ),
      withMongoRetry(
        () => counselorsCollection.find({}).toArray(),
        { retries: 1, label: "Load task tracker counselors" }
      )
    ]);

    return res.json({
      ok: true,
      tasks: getScopedTasksForSession(tasks, counselors, session),
      counselors: Array.isArray(counselors) ? counselors : [],
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch tasks", details: error.message });
  }
});

app.post("/api/tasks", async (req, res) => {
  try {
    const session = await requireRole(req, res, ["admin", "counselor", "manager"]);
    if (!session) return;

    const task = normalizeTaskDoc({
      ...(req.body || {}),
      counselor: req.body?.counselor || session.name || ""
    });
    const state = await getStateDoc();

    if (isCounselorLikeSession(session) && !canMutateTask(session, state, task)) {
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

    res.setHeader("ETag", buildStateEtag({ updatedAt: now, task }));
    return res.json({ ok: true, task, updatedAt: now });
  } catch (error) {
    return res.status(500).json({ message: "Failed to create task", details: error.message });
  }
});

app.patch("/api/tasks/:taskId", async (req, res) => {
  try {
    const session = await requireRole(req, res, ["admin", "counselor", "manager"]);
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

    const task = normalizeTaskDoc({ ...existingTask, ...updates });
    res.setHeader("ETag", buildStateEtag({ updatedAt: updates.updatedAt, task }));
    return res.json({ ok: true, task, updatedAt: updates.updatedAt });
  } catch (error) {
    return res.status(500).json({ message: "Failed to update task", details: error.message });
  }
});

app.delete("/api/tasks/:taskId", async (req, res) => {
  try {
    const session = await requireRole(req, res, ["admin", "counselor", "manager"]);
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

    res.setHeader("ETag", buildStateEtag({ updatedAt: now, deletedTaskId: taskId }));
    return res.json({ ok: true, deletedTaskId: taskId, updatedAt: now });
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
    res.json(buildStateResponse(state, { trimAdmissionPipelines: true }));
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch state", details: error.message });
  }
});

app.get("/api/account-directory", async (req, res) => {
  try {
    const session = await requireRole(req, res, ["admin", "super_admin", "counselor", "manager"]);
    if (!session) return;
    const canViewAdminDirectory = isAdminLikeSession(session);

    const [stateMeta, counselors, allocation] = await Promise.all([
      withMongoRetry(
        () => stateCollection.findOne(
          { _id: STATE_DOC_ID },
          { projection: { adminUsers: 1, marketingUsers: 1, admissionSopEnabled: 1, admissionSopEnabledAt: 1, admissionSopUpdatedBy: 1, coursePriorities: 1, updatedAt: 1, clearedAt: 1 } }
        ),
        { retries: 1, label: "Load account directory metadata" }
      ),
      withMongoRetry(
        () => counselorsCollection.find({}).toArray(),
        { retries: 1, label: "Load account directory counselors" }
      ),
      withMongoRetry(
        () => allocationCollection.find({}).toArray(),
        { retries: 1, label: "Load account directory allocation" }
      )
    ]);

    const normalizedMeta = normalizeStateDoc(stateMeta || {});
    res.setHeader("Cache-Control", "no-cache");
    return res.json({
      counselors: Array.isArray(counselors) ? counselors : [],
      adminUsers: canViewAdminDirectory && Array.isArray(normalizedMeta.adminUsers) ? normalizedMeta.adminUsers : [],
      marketingUsers: canViewAdminDirectory && Array.isArray(normalizedMeta.marketingUsers) ? normalizedMeta.marketingUsers : [],
      allocation: Array.isArray(allocation) ? allocation : [],
      admissionSopEnabled: normalizedMeta.admissionSopEnabled,
      admissionSopEnabledAt: normalizedMeta.admissionSopEnabledAt,
      admissionSopUpdatedBy: canViewAdminDirectory ? normalizedMeta.admissionSopUpdatedBy : "",
      coursePriorities: normalizedMeta.coursePriorities,
      updatedAt: normalizedMeta.updatedAt || null,
      clearedAt: normalizedMeta.clearedAt || null
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch account directory", details: error.message });
  }
});

app.get("/api/admin/sop-settings", async (req, res) => {
  try {
    const session = await requireSuperAdmin(req, res);
    if (!session) return;

    const stateMeta = await withMongoRetry(
      () => stateCollection.findOne(
        { _id: STATE_DOC_ID },
        { projection: { admissionSopEnabled: 1, admissionSopEnabledAt: 1, admissionSopUpdatedBy: 1, updatedAt: 1 } }
      ),
      { retries: 1, label: "Load SOP settings" }
    );
    const normalizedMeta = normalizeStateDoc(stateMeta || {});
    return res.json({
      ok: true,
      admissionSopEnabled: normalizedMeta.admissionSopEnabled,
      admissionSopEnabledAt: normalizedMeta.admissionSopEnabledAt,
      admissionSopUpdatedBy: normalizedMeta.admissionSopUpdatedBy,
      updatedAt: normalizedMeta.updatedAt || null
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch SOP settings", details: error.message });
  }
});

app.put("/api/admin/sop-settings", async (req, res) => {
  try {
    const session = await requireSuperAdmin(req, res);
    if (!session) return;

    const enabled = req.body?.admissionSopEnabled !== false;
    const now = new Date().toISOString();
    const updatedBy = String(session.name || session.email || session.role || "").trim();
    await stateCollection.updateOne(
      { _id: STATE_DOC_ID },
      {
        $set: {
          admissionSopEnabled: enabled,
          admissionSopEnabledAt: now,
          admissionSopUpdatedBy: updatedBy,
          updatedAt: now
        },
        $setOnInsert: { createdAt: now }
      },
      { upsert: true }
    );
    cachedStateDoc = null;
    cachedStateDocAt = 0;
    res.setHeader("ETag", buildStateEtag({ updatedAt: now }));
    return res.json({
      ok: true,
      admissionSopEnabled: enabled,
      admissionSopEnabledAt: now,
      admissionSopUpdatedBy: updatedBy,
      updatedAt: now
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to update SOP settings", details: error.message });
  }
});

app.put("/api/admin/course-priorities", async (req, res) => {
  try {
    const session = await requireRole(req, res, ["admin", "super_admin"]);
    if (!session) return;

    const coursePriorities = Array.isArray(req.body?.coursePriorities) ? req.body.coursePriorities : [];
    if (!coursePriorities.length) {
      return res.status(400).json({ message: "Priorities list cannot be empty." });
    }

    const now = new Date().toISOString();
    const nextState = await withMongoRetry(
      () => stateCollection.findOneAndUpdate(
        { _id: STATE_DOC_ID },
        { $set: { coursePriorities, updatedAt: now }, $setOnInsert: { createdAt: now } },
        { returnDocument: "after", upsert: true }
      ),
      { retries: 1, label: "Save course priorities" }
    );

    cachedStateDoc = null;
    cachedStateDocAt = 0;
    res.setHeader("ETag", buildStateEtag(nextState));
    return res.json({ ok: true, coursePriorities: nextState.coursePriorities, state: buildStateResponse(nextState) });
  } catch (error) {
    return res.status(500).json({ message: "Failed to update course priorities", details: error.message });
  }
});

app.get("/api/state/version", async (req, res) => {
  try {
    const session = await requireSession(req, res);
    if (!session) return;

    const stateMeta = await withMongoRetry(
      () => stateCollection.findOne(
        { _id: STATE_DOC_ID },
        {
          projection: {
            updatedAt: 1,
            clearedAt: 1,
            admissionSopEnabled: 1,
            admissionSopEnabledAt: 1,
            admissionSopUpdatedBy: 1,
            adminUsers: 1,
            allocation: 1
          }
        }
      ),
      { retries: 1, label: "Load state version metadata" }
    );
    const normalizedMeta = normalizeStateDoc(stateMeta || {});
    const etag = buildStateEtag(normalizedMeta);
    res.setHeader("ETag", etag);
    res.setHeader("Cache-Control", "no-cache");
    if (req.headers["if-none-match"] === etag) {
      return res.status(304).end();
    }

    const [leadCount, counselorCount, taskCount, allocationCount] = await Promise.all([
      withMongoRetry(
        () => leadsCollection.countDocuments({}),
        { retries: 1, label: "Count state version leads" }
      ),
      withMongoRetry(
        () => counselorsCollection.countDocuments({}),
        { retries: 1, label: "Count state version counselors" }
      ),
      withMongoRetry(
        () => tasksCollection.countDocuments({}),
        { retries: 1, label: "Count state version tasks" }
      ),
      withMongoRetry(
        () => allocationCollection.countDocuments({}),
        { retries: 1, label: "Count state version allocation" }
      )
    ]);

    const version = {
      updatedAt: normalizedMeta.updatedAt || null,
      clearedAt: normalizedMeta.clearedAt || null,
      admissionSopEnabled: normalizedMeta.admissionSopEnabled,
      admissionSopEnabledAt: normalizedMeta.admissionSopEnabledAt,
      admissionSopUpdatedBy: normalizedMeta.admissionSopUpdatedBy,
      etag,
      counts: {
        leads: leadCount || 0,
        counselors: counselorCount || 0,
        adminUsers: Array.isArray(normalizedMeta.adminUsers) ? normalizedMeta.adminUsers.length : 0,
        tasks: taskCount || 0,
        allocation: allocationCount || 0
      }
    };

    return res.json(version);
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch state version", details: error.message });
  }
});

app.get("/api/leads/scoped", async (req, res) => {
  try {
    const session = await requireRole(req, res, ["admin", "counselor", "manager"]);
    if (!session) return;

    const section = String(req.query?.section || "").trim().toLowerCase();
    if (!["main-admission", "admission-sop", "registered-candidates"].includes(section)) {
      return res.status(400).json({ message: "Unsupported scoped lead section." });
    }
    const permissionKey = section === "registered-candidates" ? "registeredCandidates" : section === "admission-sop" ? "admissionSop" : "mainAdmissionLeads";
    const permissions = getSessionPagePermissions(session);
    if (!permissions[permissionKey]) {
      return res.status(403).json({ message: "You do not have permission to view this lead section." });
    }

    const page = parseBoundedPositiveInt(req.query?.page, 1, 1, 100000);
    const limit = parseBoundedPositiveInt(req.query?.limit, 50, 1, 500);
    const skip = (page - 1) * limit;
    const runtimeFiltersActive = hasScopedRuntimeFilters(req.query || {});

    const [stateMeta, counselors] = await Promise.all([
      withMongoRetry(
        () => stateCollection.findOne(
          { _id: STATE_DOC_ID },
          { projection: { updatedAt: 1, clearedAt: 1, admissionSopEnabled: 1, admissionSopEnabledAt: 1, admissionSopUpdatedBy: 1 } }
        ),
        { retries: 1, label: "Load scoped state metadata" }
      ),
      withMongoRetry(
        () => counselorsCollection.find({}).toArray(),
        { retries: 1, label: "Load scoped counselors" }
      )
    ]);

    const admissionSopEnabled = isAdmissionSopEnabledInState(stateMeta || {});
    if (section === "admission-sop" && !admissionSopEnabled) {
      const response = {
        section,
        leads: [],
        counselors: Array.isArray(counselors) ? counselors : [],
        counts: {
          total: 0,
          assigned: 0,
          unassigned: 0,
          interested: 0,
          enrolled: 0,
          won: 0
        },
        admissionSopEnabled,
        admissionSopEnabledAt: stateMeta?.admissionSopEnabledAt || null,
        admissionSopUpdatedBy: stateMeta?.admissionSopUpdatedBy || "",
        pagination: {
          page,
          limit,
          total: 0,
          totalPages: 1,
          returned: 0
        },
        updatedAt: stateMeta?.updatedAt || new Date().toISOString(),
        clearedAt: stateMeta?.clearedAt || null
      };
      res.setHeader("ETag", buildStateEtag(response));
      return res.json(response);
    }
    const query = buildScopedLeadMongoQuery(section, req.query || {}, session, counselors);
    const shouldIncludeFacets = String(req.query?.includeFacets || "").trim() === "1";
    const [rawLeads, totalCount, assignedCount, unassignedCount, interestedCount, enrolledCount, wonCount, facets] = runtimeFiltersActive
      ? await Promise.all([
        withMongoRetry(
          () => leadsCollection
            .find(query, { projection: SCOPED_LEAD_LIST_PROJECTION })
            .sort({ createdAt: -1, _id: -1 })
            .toArray(),
          { retries: 1, label: "Load runtime-filtered scoped leads" }
        ),
        Promise.resolve(null),
        Promise.resolve(null),
        Promise.resolve(null),
        Promise.resolve(null),
        Promise.resolve(null),
        Promise.resolve(null),
        shouldIncludeFacets ? buildScopedLeadFacets(section, session, counselors, req.query || {}) : Promise.resolve(null)
      ])
      : await Promise.all([
      withMongoRetry(
        () => leadsCollection
          .find(query, { projection: SCOPED_LEAD_LIST_PROJECTION })
          .sort({ createdAt: -1, _id: -1 })
          .skip(skip)
          .limit(limit)
          .toArray(),
        { retries: 1, label: "Load scoped leads" }
      ),
      withMongoRetry(
        () => leadsCollection.countDocuments(query),
        { retries: 1, label: "Count scoped leads" }
      ),
      withMongoRetry(
        () => leadsCollection.countDocuments(appendMongoAnd(query, {
          counselor: { $exists: true, $nin: ["", "Unassigned", "unassigned"] }
        })),
        { retries: 1, label: "Count assigned scoped leads" }
      ),
      withMongoRetry(
        () => leadsCollection.countDocuments(appendMongoAnd(query, {
          $or: [
            { counselor: { $exists: false } },
            { counselor: "" },
            { counselor: "Unassigned" },
            { counselor: "unassigned" }
          ]
        })),
        { retries: 1, label: "Count unassigned scoped leads" }
      ),
      withMongoRetry(
        () => leadsCollection.countDocuments({
          ...query,
          [section === "registered-candidates" ? "registeredCourseStatus" : "mainAdmissionCourseStatus"]: "Interested"
        }),
        { retries: 1, label: "Count interested scoped leads" }
      ),
      withMongoRetry(
        () => leadsCollection.countDocuments({
          ...query,
          [section === "registered-candidates" ? "registeredAdmissionStatus" : "mainAdmissionAdmissionStatus"]: "Enrolled"
        }),
        { retries: 1, label: "Count enrolled scoped leads" }
      ),
      withMongoRetry(
        () => leadsCollection.countDocuments({
          ...query,
          [section === "registered-candidates" ? "registeredAdmissionStatus" : "mainAdmissionAdmissionStatus"]: "Won"
        }),
        { retries: 1, label: "Count won scoped leads" }
      ),
      shouldIncludeFacets ? buildScopedLeadFacets(section, session, counselors, req.query || {}) : Promise.resolve(null)
    ]);
    const decoratedLeads = decorateLeadListForStorage(rawLeads || []);
    const sessionRole = String(session.role || "").trim().toLowerCase();
    const visibleLeads = decoratedLeads.filter((lead) => {
      if (!isAdminLikeSession(session) && isLsqArchivedLead(lead)) {
        return false;
      }
      if (section === "main-admission" && ["counselor", "manager"].includes(sessionRole)) {
        return !deriveAdmissionSopState(lead, Date.now(), { enabled: admissionSopEnabled })?.blocked;
      }
      return true;
    });
    const runtimeFilteredLeads = runtimeFiltersActive
      ? visibleLeads.filter((lead) => leadMatchesScopedRuntimeFilters(lead, section, req.query || {}, session, { admissionSopEnabled }))
      : visibleLeads;
    const sortedLeads = runtimeFilteredLeads
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    const leads = runtimeFiltersActive ? sortedLeads.slice(skip, skip + limit) : sortedLeads;
    const updatedAt = stateMeta?.updatedAt || new Date().toISOString();
    const safeTotal = Math.max(0, runtimeFiltersActive ? sortedLeads.length : (totalCount || 0));
    const countSource = runtimeFiltersActive ? sortedLeads : null;
    const effectiveAssignedCount = runtimeFiltersActive
      ? countSource.filter((lead) => shouldTreatLeadAsAssigned(lead?.counselor)).length
      : assignedCount || 0;
    const effectiveUnassignedCount = runtimeFiltersActive
      ? countSource.filter((lead) => !shouldTreatLeadAsAssigned(lead?.counselor)).length
      : unassignedCount || 0;
    const effectiveInterestedCount = runtimeFiltersActive
      ? countSource.filter((lead) => (section === "registered-candidates" ? lead.registeredCourseStatus : lead.mainAdmissionCourseStatus) === "Interested").length
      : interestedCount || 0;
    const effectiveEnrolledCount = runtimeFiltersActive
      ? countSource.filter((lead) => (section === "registered-candidates" ? lead.registeredAdmissionStatus : lead.mainAdmissionAdmissionStatus) === "Enrolled").length
      : enrolledCount || 0;
    const effectiveWonCount = runtimeFiltersActive
      ? countSource.filter((lead) => (section === "registered-candidates" ? lead.registeredAdmissionStatus : lead.mainAdmissionAdmissionStatus) === "Won").length
      : wonCount || 0;
    const response = {
      section,
      leads,
      counselors: Array.isArray(counselors) ? counselors : [],
      counts: {
        total: safeTotal,
        assigned: effectiveAssignedCount,
        unassigned: effectiveUnassignedCount,
        interested: effectiveInterestedCount,
        enrolled: effectiveEnrolledCount,
        won: effectiveWonCount
      },
      ...(facets ? { facets } : {}),
      admissionSopEnabled,
      admissionSopEnabledAt: stateMeta?.admissionSopEnabledAt || null,
      admissionSopUpdatedBy: stateMeta?.admissionSopUpdatedBy || "",
      pagination: {
        page,
        limit,
        total: safeTotal,
        totalPages: Math.max(1, Math.ceil(safeTotal / limit)),
        returned: leads.length
      },
      updatedAt,
      clearedAt: stateMeta?.clearedAt || null
    };

    res.setHeader("ETag", buildStateEtag(response));
    return res.json(response);
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch scoped leads", details: error.message });
  }
});

app.delete("/api/leads/scoped", async (req, res) => {
  try {
    const session = await requireRole(req, res, "admin");
    if (!session) return;

    const section = String(req.query?.section || "").trim().toLowerCase();
    if (!["main-admission", "registered-candidates"].includes(section)) {
      return res.status(400).json({ message: "Unsupported scoped lead section." });
    }

    const query = buildScopedLeadClearQuery(section, req.query || {});
    if (!query) {
      return res.status(400).json({ message: "Unsupported scoped lead section." });
    }

    const result = await leadsCollection.deleteMany(query);
    const now = new Date().toISOString();
    await touchStateUpdatedAt(now);
    res.setHeader("ETag", buildStateEtag({ updatedAt: now }));
    return res.json({
      ok: true,
      section,
      deletedCount: result.deletedCount || 0,
      updatedAt: now
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to clear scoped leads", details: error.message });
  }
});

app.get("/api/leads/:leadId/tab", async (req, res) => {
  try {
    const session = await requireRole(req, res, ["admin", "counselor", "manager"]);
    if (!session) return;

    const leadId = String(req.params?.leadId || "").trim();
    const leadEmail = String(req.query?.leadEmail || "").trim().toLowerCase();
    if (!leadId) {
      return res.status(400).json({ message: "Lead id is required." });
    }

    const query = {
      id: { $in: getLeadIdCandidates(leadId) }
    };
    if (leadEmail) {
      query.email = leadEmail;
    }

    const rawLead = await withMongoRetry(
      () => leadsCollection.findOne(query),
      { retries: 1, label: "Load lead tab record" }
    );

    if (!rawLead) {
      return res.status(404).json({ message: "Lead not found." });
    }

    const [lead] = decorateLeadListForStorage([rawLead]);
    if (!lead) {
      return res.status(404).json({ message: "Lead not found." });
    }

    const permissions = getSessionPagePermissions(session);
    if (!isAdminLikeSession(session) && isLsqArchivedLead(lead)) {
      return res.status(403).json({ message: "You do not have access to this lead." });
    }

    const requestedStage = String(req.query?.stage || "").trim().toLowerCase();
    const pipeline = String(lead?.leadPipeline || "").trim().toLowerCase();
    const inferredStage = pipeline === MAIN_ADMISSION_PIPELINE
      ? "main-admission"
      : pipeline === "course-registration"
        ? "registered-course"
        : (
          String(lead?.postDialed || "").trim()
          || String(lead?.courseStatus || "").trim()
          || String(lead?.admissionStatus || "").trim()
          || String(lead?.postCallStatus || "").trim()
          || Boolean(lead?.postStatusUpdated)
        )
          ? "admission"
          : "workshop";
    const effectiveStage = (
      pipeline !== MAIN_ADMISSION_PIPELINE
      && pipeline !== "course-registration"
      && ["workshop", "admission"].includes(requestedStage)
    )
      ? requestedStage
      : inferredStage;

    const permissionKey = effectiveStage === "main-admission"
      ? "mainAdmissionLeads"
      : effectiveStage === "registered-course"
        ? "registeredCandidates"
        : effectiveStage === "admission"
          ? "postWorkshop"
          : "preWorkshop";

    if (!permissions[permissionKey]) {
      return res.status(403).json({ message: "You do not have permission to view this lead." });
    }

    if (session.role === "counselor") {
      const sessionEmail = String(session.email || "").trim().toLowerCase();
      const counselors = await withMongoRetry(
        () => counselorsCollection.find({}, { projection: { name: 1, email: 1 } }).toArray(),
        { retries: 1, label: "Load counselors for lead tab access" }
      );
      const counselorMatch = (Array.isArray(counselors) ? counselors : []).find(
        (item) => String(item.email || "").trim().toLowerCase() === sessionEmail
      );
      const counselorName = String(counselorMatch?.name || session.name || "").trim().toLowerCase();
      const owner = String(lead?.counselor || "").trim().toLowerCase();
      if (!counselorName || owner !== counselorName) {
        return res.status(403).json({ message: "You do not have access to this lead." });
      }
    }

    return res.json({
      ok: true,
      stage: effectiveStage,
      lead
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to load lead tab.", details: error.message });
  }
});

app.get("/api/performance-logs/summary", async (req, res) => {
  try {
    const session = await requireSuperAdmin(req, res);
    if (!session) return;

    const window = getPerformanceWindowFromQuery(req.query);
    const logs = await withMongoRetry(
      () => performanceLogsCollection.find({
        createdAtDate: {
          $gte: window.start,
          $lte: window.end
        }
      }).sort({ createdAt: -1 }).limit(3000).toArray(),
      { retries: 1, label: "Load performance logs" }
    );
    return res.json(buildPerformanceSummary(logs, window));
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch performance summary", details: error.message });
  }
});

app.delete("/api/performance-logs", async (req, res) => {
  try {
    const session = await requireSuperAdmin(req, res);
    if (!session) return;

    const result = await withMongoRetry(
      () => performanceLogsCollection.deleteMany({}),
      { retries: 1, label: "Clear performance logs" }
    );
    return res.json({
      ok: true,
      clearedCount: result.deletedCount || 0,
      clearedAt: new Date().toISOString()
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to clear performance logs", details: error.message });
  }
});

app.post("/api/performance-logs/client", async (req, res) => {
  try {
    const session = await requireSession(req, res);
    if (!session) return;

    const durationMs = Math.max(0, Number(req.body?.durationMs) || 0);
    recordPerformanceEvent({
      kind: String(req.body?.kind || "page"),
      operation: String(req.body?.operation || req.body?.page || "page-load"),
      page: String(req.body?.page || ""),
      section: String(req.body?.section || ""),
      subsection: String(req.body?.subsection || ""),
      phase: String(req.body?.phase || ""),
      role: String(req.body?.role || session.role || ""),
      durationMs,
      success: req.body?.success !== false,
      status: req.body?.success === false ? "failure" : "success",
      message: String(req.body?.message || ""),
      count: Number(req.body?.count || 0)
    });

    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ message: "Failed to record performance log", details: error.message });
  }
});

app.get("/api/dashboard-summary", async (req, res) => {
  try {
    const session = await requireSession(req, res);
    if (!session) return;

    const stateMeta = await withMongoRetry(
      () => stateCollection.findOne(
        { _id: STATE_DOC_ID },
        { projection: { updatedAt: 1, clearedAt: 1 } }
      ),
      { retries: 1, label: "Load dashboard state metadata" }
    );
    const etag = buildStateEtag(stateMeta || {});
    res.setHeader("ETag", etag);
    res.setHeader("Cache-Control", "no-cache");
    if (req.headers["if-none-match"] === etag) {
      return res.status(304).end();
    }

    const rows = await withMongoRetry(
      () => leadsCollection
        .aggregate(getDashboardSummaryAggregationPipeline(), { allowDiskUse: true })
        .toArray(),
      { retries: 1, label: "Aggregate dashboard summary leads" }
    );

    return res.json(buildDashboardSummaryFromRows(rows || [], stateMeta?.updatedAt || null));
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

app.get("/api/monitoring-report", async (req, res) => {
  try {
    const session = await requireSession(req, res);
    if (!session) return;
    const permissions = getSessionPagePermissions(session);
    if (!permissions.monitoring) {
      return res.status(403).json({ message: "You do not have permission to view monitoring." });
    }

    const subsection = String(req.query?.subsection || "workshop-calling").trim().toLowerCase();
    const range = getMonitoringTimelineRange({
      type: req.query?.timelineType,
      startDate: req.query?.startDate,
      endDate: req.query?.endDate
    });
    const stateMeta = await withMongoRetry(
      () => stateCollection.findOne(
        { _id: STATE_DOC_ID },
        { projection: { updatedAt: 1 } }
      ),
      { retries: 1, label: "Load monitoring report metadata" }
    );
    const reportEtag = `"monitoring:${subsection}:${String(req.query?.timelineType || "week")}:${range?.start?.toISOString?.() || ""}:${range?.end?.toISOString?.() || ""}:${stateMeta?.updatedAt || "init"}"`.replace(/\s/g, "_");
    res.setHeader("ETag", reportEtag);
    res.setHeader("Cache-Control", "no-cache");
    if (req.headers["if-none-match"] === reportEtag) {
      return res.status(304).end();
    }

    const leadQuery = appendMonitoringRangeMongoQuery(buildMonitoringLeadMongoQuery(subsection), subsection, range);
    const leadProjection = buildMonitoringLeadProjection(subsection);
    const [rawLeads, counselors] = await Promise.all([
      withMongoRetry(
        () => leadsCollection.find(leadQuery).project(leadProjection).toArray(),
        { retries: 1, label: "Load monitoring report leads" }
      ),
      withMongoRetry(
        () => counselorsCollection.find({}).project({ name: 1, email: 1, alias: 1, aliases: 1 }).toArray(),
        { retries: 1, label: "Load monitoring report counselors" }
      )
    ]);
    const leads = decorateLeadListForStorage(rawLeads || []);
    const report = buildMonitoringReport({
      subsection,
      leads,
      counselors,
      range,
      session
    });
    return res.json({
      ok: true,
      subsection,
      timelineType: String(req.query?.timelineType || "week"),
      generatedAt: new Date().toISOString(),
      ...report
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch monitoring report", details: error.message });
  }
});

app.get("/api/lead-inflow-report", async (req, res) => {
  try {
    await initMongo();
    const activeSession = await getSessionFromRequest(req);
    if (!activeSession || !["super_admin", "admin", "marketing"].includes(activeSession.session.role)) {
      return res.status(403).json({ message: "Access required." });
    }

    const section = String(req.query?.section || "workshop").trim().toLowerCase() === "admission"
      ? "admission"
      : "workshop";
    const sourceFilter = String(req.query?.source || "all").trim() || "all";
    const campaignFilter = String(req.query?.campaign || "all").trim() || "all";
    const workshopNameFilter = String(req.query?.workshopName || "all").trim() || "all";
    const workshopDateFilter = String(req.query?.workshopDate || "all").trim() || "all";
    const courseNameFilter = String(req.query?.courseName || "all").trim() || "all";
    const range = getLeadInflowRange(req.query || {});
    const leadProjection = {
      _id: 0,
      id: 1,
      source: 1,
      createdAt: 1,
      createdAtExact: 1,
      approvedAt: 1,
      leadPipeline: 1,
      leadCreationRequestId: 1,
      publicCourseSegment: 1,
      courseId: 1,
      courseCode: 1,
      courseName: 1,
      courseRawName: 1,
      workshop: 1,
      workshopName: 1,
      workshopNameKey: 1,
      workshopDateLabel: 1,
      workshopDateKey: 1,
      admissionWorkshop: 1,
      admissionWorkshopName: 1,
      admissionWorkshopNameKey: 1,
      admissionWorkshopDateLabel: 1,
      admissionWorkshopDateKey: 1,
      metaLeadId: 1,
      metaAdName: 1,
      metaAdsetName: 1,
      metaCampaignName: 1,
      elementorFormId: 1,
      elementorFormName: 1,
      elementorPageUrl: 1,
      importSourceFiles: 1,
      importSourceSheet: 1,
      lsqSourceSnapshot: 1
    };
    const logProjection = {
      _id: 0,
      type: 1,
      message: 1,
      receivedAt: 1,
      leadId: 1,
      leadgenId: 1,
      dedupeKey: 1,
      leadPipeline: 1,
      campaignName: 1,
      formName: 1,
      formId: 1
    };

    const leadQuery = getLeadInflowLeadMongoQuery(section, range);
    const duplicateLogQuery = getLeadInflowDuplicateLogMongoQuery(range);
    const inflowEventQuery = getLeadInflowEventMongoQuery(range);

    const [rawLeads, metaLogs, elementorLogs] = await Promise.all([
      withMongoRetry(
        () => leadsCollection.find(leadQuery, { projection: leadProjection }).toArray(),
        { retries: 1, label: "Load lead inflow leads" }
      ),
      withMongoRetry(
        () => metaLogsCollection.find(duplicateLogQuery, { projection: logProjection }).toArray(),
        { retries: 1, label: "Load lead inflow Meta logs" }
      ),
      withMongoRetry(
        () => elementorLogsCollection.find(duplicateLogQuery, { projection: logProjection }).toArray(),
        { retries: 1, label: "Load lead inflow Elementor logs" }
      )
    ]);
    const leads = decorateLeadListForStorage(rawLeads || []);
    const leadById = new Map(leads.map((lead) => [String(lead?.id || "").trim(), lead]));
    const clearedAt = await getLeadInflowClearedAt();
    const reportLeads = filterLeadInflowLeadsAfterClear(leads, clearedAt);
    const inflowEvents = await withMongoRetry(
      () => leadInflowCollection.find(inflowEventQuery, { projection: { _id: 0 } }).toArray(),
      { retries: 1, label: "Load durable lead inflow events" }
    );
    const transientLogEvents = [
      ...filterLeadInflowLogsAfterClear(metaLogs, clearedAt)
        .map((log) => buildLeadInflowEventFromLog("Meta", log, leadById))
        .filter(Boolean),
      ...filterLeadInflowLogsAfterClear(elementorLogs, clearedAt)
        .map((log) => buildLeadInflowEventFromLog("Elementor", log, leadById))
        .filter(Boolean)
    ];
    const reportInflowEvents = dedupeLeadInflowEvents([
      ...filterLeadInflowLogsAfterClear(inflowEvents, clearedAt),
      ...transientLogEvents
    ]);

    const report = buildLeadInflowReport({
      leads: reportLeads,
      inflowEvents: reportInflowEvents,
      range,
      section,
      sourceFilter,
      campaignFilter,
      workshopNameFilter,
      workshopDateFilter,
      courseNameFilter
    });

    return res.json({
      ok: true,
      timelineType: String(req.query?.timelineType || "today"),
      generatedAt: new Date().toISOString(),
      ...report
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch lead inflow report.", details: error.message });
  }
});

app.delete("/api/lead-inflow-report", async (req, res) => {
  try {
    await initMongo();
    const activeSession = await getSessionFromRequest(req);
    if (!activeSession || activeSession.session.role !== "super_admin") {
      return res.status(403).json({ message: "Super admin access required." });
    }

    const clearedAt = new Date().toISOString();
    const result = await withMongoRetry(
      () => leadInflowCollection.deleteMany({}),
      { retries: 1, label: "Clear lead inflow events" }
    );
    await withMongoRetry(
      () => stateCollection.updateOne(
        { _id: STATE_DOC_ID },
        { $set: { leadInflowClearedAt: clearedAt, updatedAt: clearedAt } },
        { upsert: true }
      ),
      { retries: 1, label: "Save lead inflow clear marker" }
    );
    cachedStateDoc = null;
    cachedStateDocAt = 0;

    return res.json({
      ok: true,
      deletedCount: Number(result?.deletedCount) || 0,
      clearedAt,
      message: "Lead inflow data cleared. CRM leads and lead activity records were kept."
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to clear lead inflow data.", details: error.message });
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

app.get("/api/leads/browse", async (req, res) => {
  try {
    const session = await requireSession(req, res);
    if (!session) return;

    const permissions = getSessionPagePermissions(session);
    if (!permissions.leadBrowse) {
      return res.status(403).json({ message: "You do not have permission to browse leads." });
    }

    const category = String(req.query?.category || "workshop").trim().toLowerCase() === "admission"
      ? "admission"
      : "workshop";
    const admissionSection = String(req.query?.admissionSection || "all").trim().toLowerCase();
    const page = parseBoundedPositiveInt(req.query?.page, 1, 1, 100000);
    const limit = parseBoundedPositiveInt(req.query?.limit, 25, 1, 100);
    const skip = (page - 1) * limit;
    const baseQuery = getLeadBrowseCategoryMongoQuery(category, admissionSection);
    const query = appendLeadBrowseMongoFilters(baseQuery, req.query || {}, session);
    const includeFacets = String(req.query?.includeFacets || "").trim() === "1";

    const [rawLeads, totalCount, facets] = await Promise.all([
      withMongoRetry(
        () => leadsCollection
          .find(query, { projection: LEAD_BROWSE_LIST_PROJECTION })
          .sort({ updatedAt: -1, createdAt: -1, _id: -1 })
          .skip(skip)
          .limit(limit)
          .toArray(),
        { retries: 1, label: "Load lead browse page" }
      ),
      withMongoRetry(
        () => leadsCollection.countDocuments(query),
        { retries: 1, label: "Count lead browse page" }
      ),
      includeFacets ? buildLeadBrowseFacets(baseQuery) : Promise.resolve(null)
    ]);

    const leads = decorateLeadListForStorage(rawLeads || []);
    return res.json({
      ok: true,
      category,
      admissionSection,
      leads,
      facets: facets || null,
      pagination: {
        page,
        limit,
        total: totalCount || 0,
        totalPages: Math.max(1, Math.ceil((totalCount || 0) / limit)),
        returned: leads.length
      },
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to browse leads", details: error.message });
  }
});

app.get("/api/leads", async (req, res) => {
  try {
    const session = await requireSession(req, res);
    if (!session) return;

    const scope = String(req.query?.scope || "").trim().toLowerCase();
    if (scope === "lead-browse") {
      const permissions = getSessionPagePermissions(session);
      if (!permissions.leadBrowse) {
        return res.status(403).json({ message: "You do not have permission to browse leads." });
      }
    }
    const monitoringSubsection = String(req.query?.monitoringSubsection || "").trim().toLowerCase();
    const leadQuery = monitoringSubsection ? buildMonitoringLeadMongoQuery(monitoringSubsection) : {};
    const listProjection = scope === "reachout"
      ? REACHOUT_LEAD_LIST_PROJECTION
      : scope === "assigned-or-touched" && !monitoringSubsection
        ? buildMonitoringLeadProjection("")
      : monitoringSubsection
        ? WORKFLOW_LEAD_LIST_PROJECTION
        : null;
    const findOptions = listProjection ? { projection: listProjection } : undefined;
    const [rawLeads, counselors] = await Promise.all([
      withMongoRetry(
        () => leadsCollection.find(leadQuery, findOptions).toArray(),
        { retries: 1, label: "Load leads endpoint leads" }
      ),
      session.role === "counselor"
        ? withMongoRetry(
            () => counselorsCollection.find({}).toArray(),
            { retries: 1, label: "Load leads endpoint counselors" }
          )
        : Promise.resolve([])
    ]);
    const leads = decorateLeadListForStorage(rawLeads || []);
    if (session.role !== "counselor" || scope === "lead-browse") {
      const visibleLeads = isAdminLikeSession(session)
        ? leads
        : leads.filter((lead) => !isLsqArchivedLead(lead));
      return res.json(visibleLeads);
    }

    const sessionEmail = String(session.email || "").trim().toLowerCase();
    const counselorMatch = (Array.isArray(counselors) ? counselors : []).find(
      (item) => String(item?.email || "").trim().toLowerCase() === sessionEmail
    );
    const counselorName = String(counselorMatch?.name || session.name || "").trim().toLowerCase();
    const includeTouched = scope === "assigned-or-touched";
    const historyFields = [
      "workshopActivityHistory",
      "admissionActivityHistory",
      "registeredCourseActivityHistory",
      "mainAdmissionActivityHistory"
    ];
    return res.json(leads.filter((lead) => (
      !isLsqArchivedLead(lead)
      && (
        String(lead?.counselor || "").trim().toLowerCase() === counselorName
        || (includeTouched && historyFields.some((field) => (
          Array.isArray(lead?.[field])
          && lead[field].some((entry) => String(entry?.by || "").trim().toLowerCase() === counselorName)
        )))
      )
    )));
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
    let targetLead = null;
    let targetLeadActionState = null;

    if (targetLeadId) {
      targetLead = await findLeadByIdentityFromCollection(targetLeadId, String(req.query.leadEmail || "").trim().toLowerCase());
      if (!targetLead) {
        leadIdsToQuery = [targetLeadId];
      } else {
        targetLeadActionState = await buildLeadActionState(targetLead);
        leadIdsToQuery = await getRelatedLeadIdsForActivityQuery(targetLead);
      }
    }

    // 1. Enforce counselor scoping permissions
    if (session.role === "counselor") {
      const counselorName = getSessionCounselorName(state, session);
      const isLeadBrowseActivityRead = String(req.query.scope || "").trim().toLowerCase() === "lead-browse"
        && getSessionPagePermissions(session).leadBrowse;
      if (targetLeadId) {
        const accessState = targetLeadActionState || state;
        if (!targetLead || (!isLeadBrowseActivityRead && !canViewLeadActivity(session, accessState, targetLead))) {
          return res.status(403).json({ message: "Access denied. You can only view activity logs of leads assigned to you." });
        }
        query.leadId = { $in: leadIdsToQuery };
      } else {
        query.$or = [
          { counselorName: { $regex: new RegExp("^" + escapeRegExp(counselorName) + "$", "i") } },
          { performedBy: { $regex: new RegExp("^" + escapeRegExp(session.name || session.email || "") + "$", "i") } }
        ];
      }
    } else if (session.role === "super_admin" || session.role === "admin" || session.role === "marketing" || session.role === "manager") {
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

    const counselors = await withMongoRetry(
      () => counselorsCollection.find({}).toArray(),
      { retries: 1, label: "Load counselors endpoint" }
    );
    res.json(Array.isArray(counselors) ? counselors : []);
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
    return res.json({ ok: true, updatedAt: now });
  } catch (error) {
    return res.status(500).json({ message: "Failed to save allocation", details: error.message });
  }
});

function getAppVersion() {
  try {
    const fileVersion = fs.readFileSync(VERSION_FILE, "utf8").trim();
    if (fileVersion) {
      return fileVersion;
    }
  } catch {
    // The VPS deploy script writes this file; local development may not have it.
  }

  return process.env.APP_VERSION
    || process.env.GIT_COMMIT_SHA
    || process.env.VERCEL_GIT_COMMIT_SHA
    || process.env.VERCEL_DEPLOYMENT_ID
    || process.env.VERCEL_URL
    || "local-development";
}

app.get("/api/version", (_req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.json({
    ok: true,
    ready: true,
    version: getAppVersion(),
    startedAt: APP_STARTED_AT
  });
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

app.get("/lead-inflow", (_req, res) => {
  res.sendFile(path.join(ROOT_DIR, "lead-inflow.html"));
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

async function reserveMetaLeadIds(count) {
  const total = Math.max(0, Number(count) || 0);
  if (!total) {
    return [];
  }

  await syncLeadSequence();
  const result = await withMongoRetry(
    () => metaConfigCollection.findOneAndUpdate(
      { _id: META_CONFIG_DOC_ID },
      { $inc: { leadSequence: total } },
      { returnDocument: "after", upsert: true }
    ),
    { retries: 1, label: "Reserve Meta lead IDs" }
  );

  const endId = Number(result?.leadSequence) || 0;
  if (endId <= 0) {
    const fallbackStart = Date.now();
    return Array.from({ length: total }, (_, index) => fallbackStart + index);
  }

  const startId = endId - total + 1;
  return Array.from({ length: total }, (_, index) => startId + index);
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
  const isAdmissionLead = leadType === "admission" || shouldRouteKnownCourseToAdmission(
    leadType,
    forcedAdmissionCourseIdentity,
    inferredAdmissionCourse,
    metaInfo.adName,
    metaInfo.adsetName,
    metaInfo.campaignName
  );
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
      leadId: updatedLead.id,
      leadPipeline: updatedLead.leadPipeline || newLead.leadPipeline || "workshop",
      campaignName: newLead.metaCampaignName
    });
    await saveLeadInflowEvent({
      eventType: "duplicate",
      source: "Meta",
      section: isAdmissionLead ? "admission" : "workshop",
      campaign: newLead.metaCampaignName || newLead.metaAdsetName || newLead.metaAdName || "Unspecified Campaign",
      leadId: updatedLead.id,
      sourceEventId: leadgenId,
      message: `Duplicate lead updated by ${duplicateField} match`
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
  const isAdmissionLead = leadType === "admission" || shouldRouteKnownCourseToAdmission(
    leadType,
    forcedAdmissionCourseIdentity,
    inferredAdmissionCourse,
    metaInfo.formName,
    metaInfo.pageUrl
  );
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
      leadId: updatedLead.id,
      leadPipeline: updatedLead.leadPipeline || newLead.leadPipeline || "workshop"
    });
    await saveLeadInflowEvent({
      eventType: "duplicate",
      source: "Elementor",
      section: isAdmissionLead ? "admission" : "workshop",
      campaign: newLead.elementorFormName || newLead.elementorFormId || "Unspecified Campaign",
      leadId: updatedLead.id,
      sourceEventId: [formId, formName, pageUrl, email, phone].join("|"),
      message: `Duplicate lead updated by ${duplicateField} match`
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
// leadType === "admission" || isKnownPublicCourseIdentity(forcedAdmissionCourseIdentity)
// const admissionRoutingCourseName = getAdmissionRoutingCourseName(inferredAdmissionCourse, forcedAdmissionCourseIdentity)
// courseName: admissionRoutingCourseName
// return activeCounselors
// Admission and workshop records intentionally coexist
// normalizedEmail: { $exists: true, $type: "string" }, leadPipeline: { $ne: "course-registration" }
// normalizedPhone: { $exists: true, $type: "string" }, leadPipeline: { $ne: "course-registration" }
// leadsCollection.updateOne( getLeadAssignmentResetPatch(claim.requesterName, now)
// function getLeadAssignmentResetPatch(counselor, assignedAt)
// getLeadAssignmentResetPatch(counselor, now)
// !isPublicCourseRegistrationLead(duplicateLead) && !isSameWorkshopLead(duplicateLead, newLead)
// await replaceWorkshopLeadWithFreshLead(duplicateLead, newLead, {
// Delete migrated Meta retry job
// Duplicate lead blocked by ${duplicateField} match
// alreadyRegistered: true
// You have already registered for this course.
// const counselorSourceLead = masterLead || existingRegisteredLead || null
// const counselorName = String(counselorSourceLead?.counselor || "").trim() || await assignPublicCourseCounselorRoundRobin
// const activeCounselors = routingConfig.isConfigured
// const ADMIN_AUTH_VERSION = buildAdminAuthVersion()
// cached.role === "admin" && cached.adminAuthVersion !== ADMIN_AUTH_VERSION
// storedAdminAuthVersion !== ADMIN_AUTH_VERSION
// normalized.role === "admin" ? { adminAuthVersion: ADMIN_AUTH_VERSION } : {}

