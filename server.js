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
const MONGODB_MCUBE_CONFIG_COLLECTION = process.env.MONGODB_MCUBE_CONFIG_COLLECTION || "mcube_config";
const MONGODB_MCUBE_LOGS_COLLECTION = process.env.MONGODB_MCUBE_LOGS_COLLECTION || "mcube_logs";
const MONGODB_REACHOUT_CONFIG_COLLECTION = process.env.MONGODB_REACHOUT_CONFIG_COLLECTION || "reachout_config";
const MONGODB_REACHOUT_LOGS_COLLECTION = process.env.MONGODB_REACHOUT_LOGS_COLLECTION || "reachout_logs";
const MONGODB_REACHOUT_MEDIA_COLLECTION = process.env.MONGODB_REACHOUT_MEDIA_COLLECTION || "reachout_media";
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
const SESSION_COOKIE_NAME = "dvWorkshopSession";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FORWARDED_WEBHOOK_HEADER = "x-dv-webhook-forwarded";
const FORWARDED_WEBHOOK_SIGNATURE_HEADER = "x-dv-webhook-signature";
const META_LEAD_FETCH_TIMEOUT_MS = 20000;
const META_LEAD_FETCH_MAX_ATTEMPTS = 3;
const META_RETRY_JOB_MAX_ATTEMPTS = 10;
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
  { pattern: /\bapids\b|\bindustrial data science\b|\bdata science\b/i, label: "APIDS", key: "apids" },
  { pattern: /\bapida\b|\bindustrial data analytics\b/i, label: "APIDA", key: "apida" },
  { pattern: /\b7\s*days?\b.*\bgen\s*ai\b|\bgen\s*ai\b.*\b7\s*days?\b|\b7days\b|\bdays7[_\s-]*genai\b/i, label: "7DAYS_GENAI", key: "days7_genai" },
  { pattern: /\badvanced\b.*\b(ai\s*\/?\s*ml|aiml)\b|\badv\b.*\b(ai\s*\/?\s*ml|aiml)\b|\baiml\b/i, label: "AIML + GenAI", key: "advanced-aiml-genai-agentic" },
  { pattern: /\bcyber\s*security\b|\bcybersecurity\b|\bcyber\s*ai\b|\bcyberai\b|\bapcs\b|\bforensics\b/i, label: "APCS", key: "apcs" },
  { pattern: /\bdata analytics specialist\b|\bdas\b/i, label: "DAS", key: "data-analytics-specialist" },
  { pattern: /\bmaster\b.*\bgen\s*ai\b|\bgen\s*ai\b.*\bmaster\b|\bgenai\s*master\b|\bagentic\b/i, label: "GenAI Master", key: "master-genai-agentic" }
];

const ADMIN_USER = {
  id: ADMIN_LOGIN_ID,
  password: ADMIN_LOGIN_PASSWORD,
  name: "Admin"
};

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

function buildAdminAuthVersion() {
  return crypto
    .createHash("sha256")
    .update(`${ADMIN_USER.id}:${ADMIN_USER.password}`)
    .digest("hex");
}

const ADMIN_AUTH_VERSION = buildAdminAuthVersion();

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
    await processPendingMetaRetryJobs({ limit: 3 }).catch(() => undefined);
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
let mcubeConfigCollection;
let mcubeLogsCollection;
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
  mcubeConfigCollection = null;
  mcubeLogsCollection = null;
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
    permissions: {
      ...DEFAULT_PERMISSIONS,
      ...(session.permissions || {})
    },
    loginTime: session.loginTime || Date.now()
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
    if (cached.role === "admin" && cached.adminAuthVersion !== ADMIN_AUTH_VERSION) {
      sessionCache.delete(token);
      await sessionCollection.deleteOne({ token }).catch(() => undefined);
      return null;
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

  if (String(sessionDoc.role || "").trim().toLowerCase() === "admin") {
    const storedAdminAuthVersion = String(sessionDoc.adminAuthVersion || "").trim();
    if (!storedAdminAuthVersion || storedAdminAuthVersion !== ADMIN_AUTH_VERSION) {
      await sessionCollection.deleteOne({ token }).catch(() => undefined);
      return null;
    }
  }

  const session = sanitizeSession(sessionDoc);
  setCachedSession(token, session, {
    role: sessionDoc.role,
    adminAuthVersion: sessionDoc.adminAuthVersion
  });
  return { token, session };
}

async function persistSession(res, session) {
  const token = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
  const normalized = sanitizeSession(session);

  await sessionCollection.insertOne({
    token,
    ...normalized,
    ...(normalized.role === "admin" ? { adminAuthVersion: ADMIN_AUTH_VERSION } : {}),
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
  const [state, preferences, metaConfig, metaLogs, metaRetryJobs, mcubeConfig, mcubeLogs] = await Promise.all([
    getStateDoc(),
    preferenceCollection.find({}).toArray(),
    metaConfigCollection.findOne({ _id: META_CONFIG_DOC_ID }),
    metaLogsCollection.find({}).sort({ receivedAt: 1 }).toArray(),
    metaRetryCollection.find({}).sort({ createdAt: 1 }).toArray(),
    mcubeConfigCollection.findOne({ _id: MCUBE_CONFIG_DOC_ID }),
    mcubeLogsCollection.find({}).sort({ receivedAt: 1 }).toArray()
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
      mcubeConfigCollection: MONGODB_MCUBE_CONFIG_COLLECTION,
      mcubeLogsCollection: MONGODB_MCUBE_LOGS_COLLECTION
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
      mcubeLogs: mcubeLogs.length
    },
    snapshot: {
      state: stateDoc,
      preferences: normalizeBackupDocArray(preferences),
      metaConfig: metaConfig ? normalizeBackupDoc(metaConfig, META_CONFIG_DOC_ID) : null,
      metaLogs: normalizeBackupDocArray(metaLogs),
      metaRetryJobs: normalizeBackupDocArray(metaRetryJobs),
      mcubeConfig: mcubeConfig ? normalizeBackupDoc(mcubeConfig, MCUBE_CONFIG_DOC_ID) : null,
      mcubeLogs: normalizeBackupDocArray(mcubeLogs)
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
  const mcubeLogs = normalizeBackupDocArray(snapshot.mcubeLogs);
  const metaConfig = snapshot.metaConfig
    ? normalizeBackupDoc(snapshot.metaConfig, META_CONFIG_DOC_ID)
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
      mcubeConfig,
      mcubeLogs
    }
  };
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
        mcubeConfigCollection = db.collection(MONGODB_MCUBE_CONFIG_COLLECTION);
        mcubeLogsCollection = db.collection(MONGODB_MCUBE_LOGS_COLLECTION);
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
        await tasksCollection.createIndex({ id: 1 }, { unique: true, background: true }).catch(() => undefined);
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
        mcubeConfigCollection = new MockCollection("mcubeConfig");
        mcubeLogsCollection = new MockCollection("mcubeLogs");
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
  const type = rawType === "submitted" || rawType === "success" ? "submitted" : "error";
  const log = { ...entry, type, sentAt: new Date().toISOString() };
  await withMongoRetry(() => reachoutLogsCollection.insertOne(log), { retries: 1, label: "Write ReachOut log" });
  await withMongoRetry(
    () => reachoutConfigCollection.updateOne(
      { _id: REACHOUT_CONFIG_DOC_ID },
      {
        $inc: { [`logSummary.${type}`]: 1 },
        $set: { updatedAt: new Date().toISOString() },
        $setOnInsert: { enabled: true, authKey: process.env.MSG91_AUTH_KEY || "", defaultCountryCode: "91", templates: [], createdAt: new Date().toISOString() }
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
  const agentName = String(payload.agentname || payload.agent_name || payload.agent || payload.executive_name || metadata.counselorName || "").trim();

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
    duration: Number(payload.duration || payload.call_duration || payload.callDuration || 0) || 0,
    startedAt,
    endedAt,
    answeredTime: String(payload.answeredtime || payload.answered_time || payload.answerTime || "").trim(),
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

async function assignMcubeCounselorRoundRobin(counselorSource) {
  const sourceList = Array.isArray(counselorSource)
    ? counselorSource
    : Array.isArray(counselorSource?.counselors)
      ? counselorSource.counselors
      : [];
  const counselors = sourceList.filter(isCounselorInMetaRotation);
  if (!counselors.length) return "Unassigned";

  const result = await withMongoRetry(
    () => mcubeConfigCollection.findOneAndUpdate(
      { _id: MCUBE_CONFIG_DOC_ID },
      { $inc: { roundRobinIndex: 1 } },
      { returnDocument: "after", upsert: true }
    ),
    { retries: 1, label: "Advance MCUBE round robin" }
  );
  const newIdx = Number(result?.roundRobinIndex) || 1;
  const idx = ((newIdx - 1) % counselors.length + counselors.length) % counselors.length;
  return counselors[idx].name;
}

function buildMcubeLead(event, counselorName, nextId) {
  const now = new Date().toISOString();
  const phone = String(event?.phone || "").trim();
  const displayName = phone ? `MCUBE Caller ${phone.slice(-4)}` : `MCUBE Lead ${nextId}`;
  return {
    id: nextId,
    name: displayName,
    email: `mcube-${nextId}@noemail.lead`,
    phone,
    source: "MCUBE",
    leadSource: "MCUBE",
    counselor: counselorName,
    leadPipeline: "workshop",
    createdAt: now,
    updatedAt: now,
    callStatus: "",
    mcubeAutoCreated: true,
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
  const rawProgram = [
    fields.workshop,
    fields.workshop_name,
    fields.workshop_title,
    fields.course,
    fields.course_name,
    fields.program,
    fields.page_url,
    meta.formName
  ].find(Boolean);
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
    whatsappGroupStatus: "",
    leadNotes: [],
    importSourceFiles: ["Meta Lead Ads"],
    importSourceSheets: []
  };
}

function buildElementorLead(fields, meta, counselorName, nextId, options = {}) {
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

async function processMcubeWebhookPayload(req, body) {
  const config = await getMcubeConfig();
  if (!config.enabled || !config.enableEventSync) {
    await saveMcubeLog({ type: "ignored", message: "Integration disabled or event sync turned off." });
    return;
  }

  if (!verifyMcubeWebhookSignature(req.rawBody, req, config.webhookSecret)) {
    await saveMcubeLog({ type: "error", message: "Webhook signature verification failed." });
    return;
  }

  const event = normalizeMcubeEvent(body);
  if (!event.callId && !event.phone && !event.leadId && !event.eventType) {
    await saveMcubeLog({ type: "ignored", message: "Webhook received without usable MCUBE event fields." });
    return;
  }

  let state = await getStateDoc();
  let lead = event.leadId ? findLeadById(state, event.leadId) : null;
  if (!lead && event.phone) {
    lead = findLeadByPhone(state, event.phone);
  }

  if (!lead && config.enableAutoLeadCreate && event.phone) {
    const counselorName = await assignMcubeCounselorRoundRobin(state.counselors);
    const nextId = await getNextMetaLeadId();
    const newLead = buildMcubeLead(event, counselorName, nextId);
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
        message: `Lead ${formatLeadNotificationLabel(newLead)} was created from an MCUBE call event.`,
        sound: true,
        leadId: newLead.id,
        leadName: newLead.name,
        assignedCounselor: newLead.counselor
      });
    }
  }

  if (!lead) {
    await saveMcubeLog({
      type: "ignored",
      message: "No matching lead found for MCUBE event.",
      callId: event.callId,
      phone: event.phone
    });
    return;
  }

  const stageConfig = inferLeadStageForCallUpdate(lead);
  const normalizedStatus = mapMcubeDispositionToCrmStatus(event.disposition || event.eventType);
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
    updatedAt: new Date().toISOString(),
    mcubeCallHistory: nextHistory,
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

  await recordActivity({
    leadId: nextLead.id,
    leadName: nextLead.name,
    counselorName: nextLead.counselor || "",
    activityType: "Call Made",
    actionDescription: `MCUBE ${event.direction || "call"} event recorded${normalizedStatus ? ` with status ${normalizedStatus}` : ""}.`,
    previousValue: String(lead?.[stageConfig.statusField] || "").trim() || null,
    newValue: normalizedStatus || String(event.disposition || "").trim() || null
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

  await saveMcubeLog({
    type: "success",
    message: `MCUBE event processed for ${nextLead.name}${normalizedStatus ? ` (${normalizedStatus})` : ""}.`,
    leadId: nextLead.id,
    leadName: nextLead.name,
    counselor: nextLead.counselor,
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
    if (!activeSession || !["admin", "marketing"].includes(activeSession.session.role)) {
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
    if (!activeSession || !["admin", "marketing"].includes(activeSession.session.role)) {
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
    if (!activeSession || !["admin", "marketing"].includes(activeSession.session.role)) {
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
    if (!activeSession || !["admin", "marketing"].includes(activeSession.session.role)) {
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
    if (!activeSession || activeSession.session.role !== "admin") {
      return res.status(403).json({ message: "Admin access required." });
    }
    await metaLogsCollection.deleteMany({});
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
    if (!activeSession || activeSession.session.role !== "admin") {
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
    if (!activeSession || !["admin", "marketing"].includes(activeSession.session.role)) {
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
    if (!activeSession || !["admin", "marketing"].includes(activeSession.session.role)) {
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
    if (!activeSession || !["admin", "marketing"].includes(activeSession.session.role)) {
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

app.delete("/api/elementor/logs", async (req, res) => {
  try {
    await initMongo();
    const activeSession = await getSessionFromRequest(req);
    if (!activeSession || activeSession.session.role !== "admin") {
      return res.status(403).json({ message: "Admin access required." });
    }
    await elementorLogsCollection.deleteMany({});
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
    if (!activeSession || activeSession.session.role !== "admin") {
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
    if (!activeSession || !["admin", "marketing"].includes(activeSession.session.role)) {
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
    if (!activeSession || !["admin", "marketing"].includes(activeSession.session.role)) {
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
    if (!activeSession || !["admin", "marketing"].includes(activeSession.session.role)) {
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
    if (!activeSession || !["admin", "marketing"].includes(activeSession.session.role)) {
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

app.delete("/api/mcube/logs", async (req, res) => {
  try {
    await initMongo();
    const activeSession = await getSessionFromRequest(req);
    if (!activeSession || activeSession.session.role !== "admin") {
      return res.status(403).json({ message: "Admin access required." });
    }
    await mcubeLogsCollection.deleteMany({});
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
    if (!activeSession || activeSession.session.role !== "admin") {
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

    const leadId = String(req.body?.leadId || "").trim();
    const phone = String(req.body?.phone || "").trim();
    const state = await getStateDoc();
    const lead = leadId ? findLeadById(state, leadId) : (phone ? findLeadByPhone(state, phone) : null);
    const targetPhone = phone || String(lead?.phone || "").trim();
    if (!targetPhone) {
      return res.status(400).json({ message: "A target phone number is required." });
    }

    const counselorName = String(lead?.counselor || session.name || "").trim();
    const counselorDoc = counselorName
      ? (Array.isArray(state?.counselors) ? state.counselors : []).find(
          (item) => String(item?.name || "").trim().toLowerCase() === counselorName.toLowerCase()
        )
      : null;
    const executiveNumber = getMcubeExecutiveNumber(counselorDoc, session, config);
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
    const method = String(config.clickToCallMethod || "POST").trim().toUpperCase() || "POST";
    const endpointUrl = new URL(config.clickToCallPath, config.apiBaseUrl);
    if (method === "GET") {
      Object.entries(requestPayload).forEach(([key, value]) => {
        if (value) {
          endpointUrl.searchParams.set(key, value);
        }
      });
    }
    const endpoint = endpointUrl.toString();
    const response = await fetch(endpoint, {
      method,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/plain;q=0.9"
      },
      ...(method === "GET" ? {} : { body: JSON.stringify(requestPayload) })
    });
    const text = await response.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }

    if (!response.ok) {
      await saveMcubeLog({
        type: "error",
        message: `Click-to-call failed with MCUBE HTTP ${response.status}.`,
        leadId: requestPayload.refid,
        phone: requestPayload.custnumber
      });
      return res.status(502).json({
        message: `MCUBE click-to-call failed with status ${response.status}.`,
        details: parsed?.message || text || "Unknown MCUBE response"
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
        session
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
      endpoint,
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
    return res.json(publicReachoutConfig(config));
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
    return res.json({ ok: true, ...publicReachoutConfig(updated) });
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
    const logs = await reachoutLogsCollection
      .find({}, { projection: { _id: 0, requestPayload: 0, responseBody: 0 } })
      .sort({ sentAt: -1 })
      .limit(limit)
      .toArray();
    const config = await getReachoutConfig();
    return res.json({ logs, summary: publicReachoutConfig(config).logSummary });
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch ReachOut logs.", details: err.message });
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

        await saveReachoutLog({
          type: "submitted",
          channel,
          templateId: template.id,
          templateName: template.name,
          leadId: lead.id,
          leadName: lead.name,
          phone: lead.phone || "",
          email: lead.email || "",
          sentBy: session.name || session.email || session.role,
          responseStatus: response.status
        });
        await recordActivity({
          leadId: lead.id,
          leadName: lead.name,
          counselorName: lead.counselor || "",
          activityType: "ReachOut Message",
          actionDescription: `ReachOut ${channel.toUpperCase()} submitted to MSG91 using ${template.name}.`,
          newValue: lead.phone,
          session
        });
        results.push({ leadId: lead.id, ok: true });
      } catch (error) {
        await saveReachoutLog({
          type: "error",
          channel,
          templateId: template.id,
          templateName: template.name,
          leadId: lead.id,
          leadName: lead.name,
          phone: lead.phone || "",
          email: lead.email || "",
          sentBy: session.name || session.email || session.role,
          message: error.message
        }).catch(() => undefined);
        results.push({ leadId: lead.id, ok: false, message: error.message });
      }
    }

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
      submitted: results.filter((item) => item.ok).length,
      failed: results.filter((item) => !item.ok).length,
      results
    });
  } catch (err) {
    return res.status(500).json({ message: "Failed to send ReachOut messages.", details: err.message });
  }
});

app.post("/api/mcube/webhook", async (req, res) => {
  res.status(200).json({ ok: true });

  try {
    const body = parseMcubeWebhookRequestBody(req) || {};
    await processMcubeWebhookPayload(req, body);
  } catch (err) {
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
      allocationCollection.deleteMany({})
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

    await mcubeConfigCollection.deleteMany({});
    if (snapshot.mcubeConfig) {
      await mcubeConfigCollection.insertOne(snapshot.mcubeConfig);
    }

    await mcubeLogsCollection.deleteMany({});
    if (snapshot.mcubeLogs.length) {
      await mcubeLogsCollection.insertMany(snapshot.mcubeLogs, { ordered: true });
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
        mcubeLogs: snapshot.mcubeLogs.length
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
    const masterLead = findDuplicateNonRegisteredLeadByEmailOrPhone(snapshot.leads, { email, phone });
    const effectiveMasterLead = isCrashCourseRegistration ? null : masterLead;
    const existingRegisteredLead = findDuplicateRegisteredLeadByEmailOrPhoneInSegment(snapshot.leads, { email, phone }, publicCourseSegment);
    const counselorSourceLead = masterLead || existingRegisteredLead || null;
    const effectiveCounselorSourceLead = isCrashCourseRegistration ? (existingRegisteredLead || null) : counselorSourceLead;
    const isSameRegisteredCourse = !!existingRegisteredLead && publicCourseLeadMatchesCourse(existingRegisteredLead, course);

    if (isSameRegisteredCourse) {
      return res.status(200).json({
        ok: true,
        alreadyRegistered: true,
        message: "You have already registered for this course.",
        leadId: existingRegisteredLead.id,
        assignedCounselor: String(existingRegisteredLead.counselor || "").trim() || "Unassigned"
      });
    }

    // const counselorName = String(counselorSourceLead?.counselor || "").trim() || await assignPublicCourseCounselorRoundRobin(snapshot.counselors, publicCourseSegment);
    const counselorName = String(effectiveCounselorSourceLead?.counselor || "").trim() || await assignPublicCourseCounselorRoundRobin(snapshot.counselors, publicCourseSegment);
    const nextId = await getNextMetaLeadId();
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

    if (newLead.counselor) {
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
      message: `Lead: ${formatLeadNotificationLabel(newLead)}. Registered for ${course.name}. Assigned counselor: ${counselorName}${!isCrashCourseRegistration && effectiveMasterLead ? " (linked to existing CRM lead)" : ""}${shouldReplaceExistingRegisteredLead ? " (updated registered section)" : ""}`,
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

async function assignPublicCourseCounselorRoundRobin(counselors = [], segment = PUBLIC_COURSE_DEFAULT_SEGMENT) {
  const routingSegmentConfig = getPublicCourseSegmentConfig(segment);
  const routingConfig = await getPublicCourseRoutingConfig(segment).catch(() => ({ selectedCounselors: [], isConfigured: false }));
  const selectedCounselorSet = new Set(routingConfig.selectedCounselors.map((name) => name.toLowerCase()));
  const eligibleCounselors = (Array.isArray(counselors) ? counselors : [])
    .filter(isCounselorEligibleForCourseRegistrations);
  const activeCounselors = routingConfig.isConfigured
    ? eligibleCounselors.filter((counselor) => selectedCounselorSet.has(String(counselor.name || "").trim().toLowerCase()))
    : eligibleCounselors;
  if (!activeCounselors.length) {
    return "Unassigned";
  }

  const result = await withMongoRetry(
    () => stateCollection.findOneAndUpdate(
      { _id: STATE_DOC_ID },
      { $inc: { [routingSegmentConfig.roundRobinField]: 1 } },
      { returnDocument: "after", upsert: true }
    ),
    { retries: 1, label: "Advance public course round robin" }
  );

  const newIndex = Number(result?.[routingSegmentConfig.roundRobinField]) || 1;
  const counselorIndex = ((newIndex - 1) % activeCounselors.length + activeCounselors.length) % activeCounselors.length;
  return activeCounselors[counselorIndex].name;
}

function shouldTreatLeadAsAssigned(counselorName) {
  const normalized = String(counselorName || "").trim().toLowerCase();
  return !!normalized && normalized !== "unassigned";
}

function buildPublicCourseLead({ name, email, phone, course, counselorName, nextId, country, segment }) {
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
  const workshopMigrationHistory = Array.isArray(existingLead?.workshopMigrationHistory)
    ? structuredClone(existingLead.workshopMigrationHistory)
    : [];

  workshopMigrationHistory.push(buildWorkshopMigrationSnapshot(existingLead));

  const preservedCounselor = String(existingLead?.counselor || incomingLead?.counselor || "").trim();
  const nextLead = {
    ...existingLead,
    ...incomingLead,
    id: existingLead.id,
    counselor: preservedCounselor,
    workshop: String(incomingLead?.workshop || "").trim() || String(existingLead?.workshop || "").trim(),
    admissionWorkshop: String(incomingLead?.workshop || "").trim() || String(existingLead?.admissionWorkshop || existingLead?.workshop || "").trim(),
    source: String(incomingLead?.source || existingLead?.source || "").trim(),
    status: "New",
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

  if (globalMeta) {
    return cacheStateDoc({
      ...globalMeta,
      leads: decorateLeadListForStorage(leads || []),
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
    leads: decorateLeadListForStorage(leads || []),
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
  if (!allowedRoles.includes(session.role)) {
    res.status(403).json({ message: "Access required." });
    return null;
  }

  return session;
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

function canMutateLead(session, state, lead) {
  if (session?.role === "admin") {
    return true;
  }

  if (session?.role !== "counselor") {
    return false;
  }

  const counselorName = getSessionCounselorName(state, session).toLowerCase();
  const leadCounselor = String(lead?.counselor || "").trim().toLowerCase();
  return !!counselorName && leadCounselor === counselorName;
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

function getLeadAssignmentResetPatch(counselor, assignedAt) {
  return {
    counselor,
    counselorAssignedAt: assignedAt,
    workshopActivityTouchedByAssignee: false,
    admissionActivityTouchedByAssignee: false
  };
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
  remarks = null
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
      remarks: remarks ? String(remarks) : null
    };

    await activityLogsCollection.insertOne(logEntry);
  } catch (error) {
    console.error("Failed to record activity log:", error);
  }
}

async function logBulkLeadChanges(oldLeads, newLeads, session) {
  try {
    const oldLeadsMap = new Map();
    oldLeads.forEach(lead => {
      if (lead && lead.id) oldLeadsMap.set(String(lead.id), lead);
    });
    
    for (const lead of newLeads) {
      if (!lead || !lead.id) continue;
      const leadIdStr = String(lead.id);
      const oldLead = oldLeadsMap.get(leadIdStr);
      
      if (!oldLead) {
        // Lead Created
        await recordActivity({
          leadId: lead.id,
          leadName: lead.name,
          counselorName: lead.counselor || "",
          activityType: "Lead Created",
          actionDescription: `Lead imported/created in bulk`,
          newValue: `Name: ${lead.name}, Phone: ${lead.phone}, Email: ${lead.email}`,
          session
        });
        if (lead.counselor) {
          await recordActivity({
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
            await recordActivity({
              leadId: lead.id,
              leadName: lead.name,
              counselorName: newCounselor,
              activityType: "Lead Assigned",
              actionDescription: `Lead assigned to counselor ${newCounselor}`,
              newValue: newCounselor,
              session
            });
          } else {
            await recordActivity({
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
            await recordActivity({
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

function createTaskId() {
  return `task-${crypto.randomUUID()}`;
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
    dueDate: String(task.dueDate || "").trim(),
    createdAt,
    updatedAt: task.updatedAt || createdAt
  };
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

app.post("/api/auth/login", async (req, res) => {
  try {
    const role = String(req.body?.role || "").trim().toLowerCase();
    const identifier = String(req.body?.identifier || "").trim();
    const password = String(req.body?.password || "").trim();

    if (!role || !identifier || !password) {
      return res.status(400).json({ message: "Role, identifier, and password are required." });
    }

    if (role === "admin") {
      if (identifier !== ADMIN_USER.id || password !== ADMIN_USER.password) {
        return res.status(401).json({ message: "Invalid credentials for selected role." });
      }

      const session = await persistSession(res, {
        role,
        name: ADMIN_USER.name,
        email: ADMIN_USER.id,
        permissions: {
          ...DEFAULT_PERMISSIONS,
          dashboard: true,
          preWorkshop: true,
          postWorkshop: true,
          taskTracker: false,
          lostLeads: true,
          monitoring: true
        }
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
        permissions: { metaIntegration: true }
      });

      return res.json({ session, landing: "meta-integration.html" });
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
      ...DEFAULT_PERMISSIONS,
      ...(counselor.permissions || {}),
      dashboard: false
    };

    const session = await persistSession(res, {
      role,
      name: counselor.name,
      email: counselor.email,
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

async function createNotification({ userId, role, type, title, message, sound = false, leadId = null, leadName = null, assignedCounselor = null, fromCounselor = null, toCounselor = null }) {
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
      toCounselor: toCounselor ? String(toCounselor) : null
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
    if (!canMutateLead(session, state, lead)) {
      return res.status(403).json({ message: "Only the assigned counselor can update this lead." });
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
    if (!canMutateLead(session, state, lead)) {
      return res.status(403).json({ message: "Only the assigned counselor can edit notes." });
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
    if (!canMutateLead(session, state, lead)) {
      return res.status(403).json({ message: "Only the assigned counselor can delete notes." });
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
    const matchConditions = buildLiveLeadIdentityMatchConditions(leadRefs);
    if (!matchConditions.length) {
      return res.status(400).json({ message: "Lead references are required." });
    }

    const query = { $or: matchConditions };
    const leadsToDelete = await leadsCollection.find(query).toArray();
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

    const assignmentChangedLeadIds = leadsToUpdate
      .filter((lead) => String(lead.counselor || "").trim().toLowerCase() !== counselor.toLowerCase())
      .map((lead) => lead.id)
      .filter((id) => id !== undefined && id !== null);
    const now = new Date().toISOString();
    const result = await leadsCollection.updateMany(
      updateQuery,
      { $set: { counselor } }
    );

    const matchedCount = Number.isFinite(Number(result.matchedCount))
      ? Number(result.matchedCount)
      : Number(result.modifiedCount) || 0;
    if (!matchedCount) {
      return res.status(409).json({ message: "Leads changed before they could be assigned. Please reload and retry." });
    }

    if (assignmentChangedLeadIds.length) {
      await leadsCollection.updateMany(
        { id: { $in: assignmentChangedLeadIds } },
        { $set: getLeadAssignmentResetPatch(counselor, now) }
      );
    }

    // Trigger notifications for reassigned leads
    const counselorsList = await counselorsCollection.find({}).toArray();
    const counselorEmailByName = new Map();
    counselorsList.forEach(c => {
      if (c.name && c.email) {
        counselorEmailByName.set(c.name.toLowerCase().trim(), c.email.toLowerCase().trim());
      }
    });

    for (const lead of leadsToUpdate) {
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
    return res.json({ ok: true, updatedCount: result.modifiedCount, matchedCount: result.matchedCount, state: buildStateResponse(nextState) });
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
          { $set: getLeadAssignmentResetPatch(claim.requesterName, now) }
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
    } else if (session.role === "admin" || session.role === "marketing") {
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
  const admissionRoutingCourseName = getAdmissionRoutingCourseName(inferredAdmissionCourse, forcedAdmissionCourseIdentity);
  const counselorName = isAdmissionLead
    ? await assignAdmissionCounselorRoundRobin(snapshot.counselors, {
        branch: inferredAdmissionBranch,
        courseName: admissionRoutingCourseName
      })
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
    let shouldBlockDuplicate = true;
    if (isAdmissionLead && !isMainAdmissionLead(duplicateLead)) {
      // Admission and workshop records intentionally coexist so each team keeps its own workflow.
      shouldBlockDuplicate = false;
    } else if (!isAdmissionLead && isMainAdmissionLead(duplicateLead)) {
      // Workshop leads still flow into the established workshop calling setup even if admission has a matching contact.
      shouldBlockDuplicate = false;
    } else if (!isPublicCourseRegistrationLead(duplicateLead) && !isSameWorkshopLead(duplicateLead, newLead)) {
      await replaceWorkshopLeadWithFreshLead(duplicateLead, newLead, {
        source: "Meta",
        metaLeadId: leadgenId,
        formId
      });
      if (retryJobId) {
        await withMongoRetry(
          () => metaRetryCollection.deleteOne({ _id: retryJobId }),
          { retries: 1, label: "Delete migrated Meta retry job" }
        );
      }
      return;
    }

    if (shouldBlockDuplicate) {
      if (retryJobId) {
        await withMongoRetry(
          () => metaRetryCollection.deleteOne({ _id: retryJobId }),
          { retries: 1, label: "Delete duplicate Meta retry job" }
        );
      }
      const duplicateField = normalizeLeadEmail(duplicateLead.email) === normalizeLeadEmail(newLead.email)
        ? "email"
        : "phone";
      await saveMetaLog({
        type: "ignored",
        message: `Duplicate lead blocked by ${duplicateField} match`,
        leadgenId,
        formId,
        leadId: duplicateLead.id
      });
      return;
    }
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

async function processElementorLeadRecord(payload, config) {
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
  const admissionRoutingCourseName = getAdmissionRoutingCourseName(inferredAdmissionCourse, forcedAdmissionCourseIdentity);
  const counselorName = isAdmissionLead
    ? await assignAdmissionCounselorRoundRobin(snapshot.counselors, {
        branch: inferredAdmissionBranch,
        courseName: admissionRoutingCourseName
      })
    : await assignElementorCounselorRoundRobin(snapshot.counselors);
  const nextId = await getNextMetaLeadId();
  const newLead = buildElementorLead(fields, metaInfo, counselorName, nextId, { leadType: effectiveLeadType });
  const duplicateLead = findDuplicateLeadByEmailOrPhone(snapshot.leads, newLead);

  if (duplicateLead) {
    let shouldBlockDuplicate = true;
    if (isAdmissionLead && !isMainAdmissionLead(duplicateLead)) {
      shouldBlockDuplicate = false;
    } else if (!isAdmissionLead && isMainAdmissionLead(duplicateLead)) {
      shouldBlockDuplicate = false;
    } else if (!isPublicCourseRegistrationLead(duplicateLead) && !isSameWorkshopLead(duplicateLead, newLead)) {
      await replaceWorkshopLeadWithFreshLead(duplicateLead, newLead, {
        source: "Elementor"
      });
      await saveElementorLog({
        type: "success",
        message: `Lead migrated into fresh workshop record: ${newLead.name}`,
        formId,
        formName,
        pageUrl,
        leadId: newLead.id,
        leadName: newLead.name,
        counselor: counselorName,
        leadPipeline: newLead.leadPipeline || "workshop"
      });
      return;
    }

    if (shouldBlockDuplicate) {
      const duplicateField = normalizeLeadEmail(duplicateLead.email) === normalizeLeadEmail(newLead.email)
        ? "email"
        : "phone";
      await saveElementorLog({
        type: "ignored",
        message: `Duplicate lead blocked by ${duplicateField} match`,
        formId,
        formName,
        pageUrl,
        leadId: duplicateLead.id
      });
      return;
    }
  }

  const result = await insertElementorLeadIfNew(newLead);

  cachedStateDoc = null;
  cachedStateDocAt = 0;

  if (!result?.modifiedCount && !result?.upsertedCount) {
    await saveElementorLog({
      type: "ignored",
      message: "Duplicate lead (already imported)",
      formId,
      formName,
      pageUrl
    });
    return;
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

  await processElementorLeadRecord(payload, config);
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

module.exports = app;
