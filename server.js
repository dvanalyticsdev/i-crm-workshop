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
const META_WEBHOOK_FORWARD_URL = String(process.env.META_WEBHOOK_FORWARD_URL || "").trim();
const STATE_DOC_ID = "global";
const META_CONFIG_DOC_ID = "meta_integration";
const BACKUP_FORMAT = "dv-crm-manual-backup";
const BACKUP_VERSION = 1;
const MAX_META_LOGS = 200;
const SESSION_COOKIE_NAME = "dvWorkshopSession";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FORWARDED_WEBHOOK_HEADER = "x-dv-webhook-forwarded";
const META_LEAD_FETCH_TIMEOUT_MS = 20000;
const META_LEAD_FETCH_MAX_ATTEMPTS = 3;
const META_RETRY_JOB_MAX_ATTEMPTS = 10;

const ADMIN_USER = {
  id: "dvanalytics@W@2010",
  password: "dv@dataanalytics@2010W",
  name: "Admin"
};

const DEFAULT_PERMISSIONS = {
  dashboard: false,
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
let leadsCollection;
let counselorsCollection;
let tasksCollection;
let allocationCollection;
let notificationsCollection;
let mongoClient;
let mongoInitPromise;
let cachedStateDoc    = null;
let cachedStateDocAt  = 0;
let metaLogWriteCount = 0;
// Re-read from Mongo after 5 s so stale serverless instances pick up writes
// from other instances sooner. Shorter TTL reduces the window in which a
// concurrent GET can return stale data after a PUT on a different instance.
const STATE_CACHE_TTL_MS = 5000;

// In-process session cache — avoids a MongoDB round-trip on every authenticated
// request.  Entries expire after 60 s so a deleted/expired session is noticed
// within a minute without hammering the DB.
const SESSION_CACHE_TTL_MS = 60000;
const sessionCache = new Map(); // token → { session, cachedAt }

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
  leadsCollection = null;
  counselorsCollection = null;
  tasksCollection = null;
  allocationCollection = null;
  notificationsCollection = null;
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
  return entry.session;
}

function setCachedSession(token, session) {
  sessionCache.set(token, { session, cachedAt: Date.now() });
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
    return { token, session: cached };
  }

  const sessionDoc = await sessionCollection.findOne({
    token,
    expiresAt: { $gt: new Date().toISOString() }
  });

  if (!sessionDoc) {
    return null;
  }

  const session = sanitizeSession(sessionDoc);
  setCachedSession(token, session);
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
  const [state, preferences, metaConfig, metaLogs, metaRetryJobs] = await Promise.all([
    getStateDoc(),
    preferenceCollection.find({}).toArray(),
    metaConfigCollection.findOne({ _id: META_CONFIG_DOC_ID }),
    metaLogsCollection.find({}).sort({ receivedAt: 1 }).toArray(),
    metaRetryCollection.find({}).sort({ createdAt: 1 }).toArray()
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
      metaRetryCollection: MONGODB_META_RETRY_COLLECTION
    },
    summary: {
      leads: stateDoc.leads.length,
      counselors: stateDoc.counselors.length,
      marketingUsers: stateDoc.marketingUsers.length,
      allocationRules: stateDoc.allocation.length,
      tasks: stateDoc.tasks.length,
      preferences: preferences.length,
      metaLogs: metaLogs.length,
      metaRetryJobs: metaRetryJobs.length
    },
    snapshot: {
      state: stateDoc,
      preferences: normalizeBackupDocArray(preferences),
      metaConfig: metaConfig ? normalizeBackupDoc(metaConfig, META_CONFIG_DOC_ID) : null,
      metaLogs: normalizeBackupDocArray(metaLogs),
      metaRetryJobs: normalizeBackupDocArray(metaRetryJobs)
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
  const metaConfig = snapshot.metaConfig
    ? normalizeBackupDoc(snapshot.metaConfig, META_CONFIG_DOC_ID)
    : null;

  return {
    ok: true,
    snapshot: {
      state: normalizedState,
      preferences,
      metaConfig,
      metaLogs,
      metaRetryJobs
    }
  };
}

async function initMongo() {
  if (stateCollection) {
    return;
  }

  if (!MONGODB_URI) {
    throw new Error("Missing MONGODB_URI in environment.");
  }

  if (!mongoInitPromise) {
    mongoInitPromise = (async () => {
      mongoClient = new MongoClient(MONGODB_URI, {
        // Larger pool so concurrent serverless invocations don't queue waiting
        // for a connection. In serverless, avoid forcing warm connections
        // because they can create intermittent TLS/connect stalls.
        maxPoolSize: 10,
        minPoolSize: 0,
        // Fail fast on cold starts rather than hanging for 30 s.
        serverSelectionTimeoutMS: 8000,
        connectTimeoutMS: 8000,
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

      leadsCollection      = db.collection("leads");
      counselorsCollection = db.collection("counselors");
      tasksCollection      = db.collection("tasks");
      allocationCollection = db.collection("allocation");
      notificationsCollection = db.collection("notifications");

      // Ensure indexes
      await sessionCollection.createIndex(
        { token: 1 },
        { unique: true, background: true }
      ).catch(() => undefined);
      await metaLogsCollection.createIndex(
        { receivedAt: -1 },
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
            const uniqueLeads = Array.from(leadsMap.values());
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
    })().catch(async (error) => {
      await resetMongoConnection();
      throw error;
    });
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

function normalizeMetaLabel(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isCounselorInMetaRotation(counselor) {
  return counselor?.roundRobinEnabled !== false && !counselor?.disabled;
}

async function getMetaProcessingSnapshot() {
  if (cachedStateDoc && Array.isArray(cachedStateDoc.counselors)) {
    return {
      counselors: Array.isArray(cachedStateDoc.counselors) ? cachedStateDoc.counselors : []
    };
  }

  try {
    // Counselors are stored in their own collection after the schema migration
    // (they were $unset from stateCollection). Query counselorsCollection directly.
    const counselors = await withMongoRetry(
      () => counselorsCollection.find({}).toArray(),
      { retries: 1, label: "Load Meta processing snapshot (counselors)" }
    );

    return {
      counselors: Array.isArray(counselors) ? counselors : []
    };
  } catch (error) {
    if (cachedStateDoc && Array.isArray(cachedStateDoc.counselors)) {
      return {
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
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(META_WEBHOOK_FORWARD_URL, {
      method: "POST",
      headers: {
        "Content-Type": req.headers["content-type"] || "application/json",
        "X-Hub-Signature-256": req.headers["x-hub-signature-256"] || "",
        [FORWARDED_WEBHOOK_HEADER]: "1"
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

function buildMetaLead(fieldData, meta, counselorName, nextId) {
  const fields = {};
  (fieldData || []).forEach(({ name, values }) => {
    fields[String(name).toLowerCase().replace(/[^a-z0-9]+/g, "_")] = (values || [])[0] ?? "";
  });

  const firstName = String(fields.first_name || "").trim();
  const lastName = String(fields.last_name || "").trim();
  const fullName = String(fields.full_name || fields.name || "").trim();
  const name = fullName || (firstName ? `${firstName} ${lastName}`.trim() : "Unknown");
  const email = String(fields.email || fields.email_address || "").trim().toLowerCase();
  const phone = String(fields.phone_number || fields.phone || fields.mobile_phone || fields.mobile || "").trim();
  const workshop = String(
    fields.workshop ||
    fields.workshop_name ||
    fields.workshop_title ||
    fields.workshop_topic ||
    fields.course ||
    fields.course_name ||
    fields.program ||
    normalizeMetaLabel(meta.adsetName || meta.adName || meta.campaignName || "")
  ).trim();

  const knownKeys = new Set(["full_name", "name", "first_name", "last_name", "email", "email_address", "phone_number", "phone", "mobile_phone", "mobile", "workshop", "workshop_name", "workshop_title", "workshop_topic", "course", "course_name", "program"]);
  const extraEntries = Object.entries(fields).filter(([k]) => !knownKeys.has(k) && fields[k]);
  const metaExtraFields = Object.fromEntries(extraEntries);

  return {
    id: nextId,
    name,
    email: email || `meta-${meta.leadgenId}@noemail.lead`,
    phone,
    workshop,
    status: "New",
    source: "Meta",
    metaLeadId: String(meta.leadgenId || ""),
    metaFormId: String(meta.formId || ""),
    metaAdId: String(meta.adId || ""),
    metaAdName: String(meta.adName || ""),
    metaAdsetName: String(meta.adsetName || ""),
    metaCampaignName: String(meta.campaignName || ""),
    metaExtraFields,
    createdAt: new Date().toISOString().slice(0, 10),
    dialed: "",
    callStatus: "",
    wsStatus: "",
    whatsappInvite: "",
    counselor: counselorName,
    postDialed: "",
    coursePitched: "",
    courseStatus: "",
    admissionStatus: "",
    postStatusUpdated: false,
    preActivityUpdates: 0,
    postActivityUpdates: 0,
    workshopActivityHistory: [],
    admissionActivityHistory: [],
    whatsappGroupStatus: "",
    leadNotes: [],
    importSourceFiles: ["Meta Lead Ads"],
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

async function processMetaWebhookPayload(req, body) {
  const config = await getMetaConfig();

  if (config.appSecret) {
    const sig = req.headers["x-hub-signature-256"] || "";
    const rawBuf = req.rawBody;
    if (!rawBuf || !verifyWebhookSignature(rawBuf, sig, config.appSecret)) {
      await saveMetaLog({ type: "error", message: "Signature verification failed", headers: { sig } });
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
    const body = req.body || {};

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

    await Promise.all([
      leadsCollection.deleteMany({}),
      counselorsCollection.deleteMany({}),
      tasksCollection.deleteMany({}),
      allocationCollection.deleteMany({})
    ]);

    if (Array.isArray(snapshot.state.leads) && snapshot.state.leads.length) {
      await leadsCollection.insertMany(snapshot.state.leads);
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

    metaLogWriteCount = 0;
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
        metaRetryJobs: snapshot.metaRetryJobs.length
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

function normalizeLeadContactValue(value) {
  return String(value || "").trim();
}

function normalizeLeadEmail(value) {
  return normalizeLeadContactValue(value).toLowerCase();
}

function buildLeadOwnerMap(leads, field) {
  const owners = new Map();
  (Array.isArray(leads) ? leads : []).forEach((lead) => {
    const id = String(lead?.id || "").trim();
    const value = field === "email"
      ? normalizeLeadEmail(lead?.email)
      : normalizeLeadContactValue(lead?.phone);
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
    const phone = normalizeLeadContactValue(lead?.phone);

    if (email) {
      const nextOwners = nextEmailOwners.get(email);
      if (nextOwners && nextOwners.size > 1) {
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
        const currentOwners = currentPhoneOwners.get(phone);
        const isUnchangedLegacyDuplicate = previousLead
          && normalizeLeadContactValue(previousLead.phone) === phone
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
  const incomingPhone = normalizeLeadContactValue(incomingLead?.phone);
  return (Array.isArray(leads) ? leads : []).find((lead) => {
    const matchesEmail = incomingEmail && normalizeLeadEmail(lead?.email) === incomingEmail;
    const matchesPhone = incomingPhone && normalizeLeadContactValue(lead?.phone) === incomingPhone;
    return matchesEmail || matchesPhone;
  }) || null;
}

async function getStateDoc() {
  // Return the in-memory cache only when it is still fresh.
  // This ensures that writes from other server instances (e.g. on Vercel) are picked up
  // within STATE_CACHE_TTL_MS without requiring a full process restart.
  if (cachedStateDoc && (Date.now() - cachedStateDocAt) < STATE_CACHE_TTL_MS) {
    return cachedStateDoc;
  }

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
      leads: leads || [],
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
    leads: leads || [],
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
  const category = task.category === "admission" ? "admission" : "workshop";

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
    fs.appendFileSync("c:\\DV Projects\\i-crm-workshop\\server-debug.log", `[${new Date().toISOString()}] createNotification called: ${JSON.stringify({ userId, role, type, title })}\n`);
    
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
      fs.appendFileSync("c:\\DV Projects\\i-crm-workshop\\server-debug.log", `[${new Date().toISOString()}] Warning: notificationsCollection is undefined!\n`);
    }

    const inserted = await withMongoRetry(
      () => notificationsCollection.insertOne(notification),
      { retries: 1, label: "Create notification record" }
    );
    
    fs.appendFileSync("c:\\DV Projects\\i-crm-workshop\\server-debug.log", `[${new Date().toISOString()}] Notification inserted successfully: ${JSON.stringify(inserted)}\n`);
    return notification;
  } catch (error) {
    fs.appendFileSync("c:\\DV Projects\\i-crm-workshop\\server-debug.log", `[${new Date().toISOString()}] Error in createNotification: ${error.stack}\n`);
    console.error("Failed to create notification:", error.message);
  }
}

app.get("/api/notifications", async (req, res) => {
  try {
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
        : null;

    if (!config) {
      return res.status(400).json({ message: "Activity stage must be workshop or admission." });
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
        [config.countField]: nextCount
      },
      $push: {
        [config.historyField]: event
      }
    };

    const result = await leadsCollection.updateOne(query, update);

    if (result.modifiedCount) {
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
      at: new Date().toISOString().slice(0, 10),
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

app.patch("/api/leads/assignment", async (req, res) => {
  try {
    const session = await requireRole(req, res, "admin");
    if (!session) return;

    const leadRefs = Array.isArray(req.body?.leadRefs) ? req.body.leadRefs : [];
    const leadIds = Array.isArray(req.body?.leadIds) ? req.body.leadIds : [];
    const counselor = String(req.body?.counselor || "").trim();
    if ((!leadRefs.length && !leadIds.length) || !counselor) {
      return res.status(400).json({ message: "Lead references and counselor are required." });
    }

    const matchConditions = leadRefs.map((ref) => {
      const id = String(ref?.id || "").trim();
      if (!id) return null;
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
    }).filter(Boolean);

    const query = matchConditions.length
      ? { $or: matchConditions }
      : { id: { $in: [...new Set(leadIds.flatMap((leadId) => getLeadIdCandidates(leadId)))] } };

    const leadsToUpdate = await leadsCollection.find(query).toArray();

    const result = await leadsCollection.updateMany(
      query,
      { $set: { counselor } }
    );

    if (!result.modifiedCount) {
      return res.status(404).json({ message: "No matching leads were assigned." });
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
      
      if (oldCounselor.toLowerCase() !== newCounselor.toLowerCase()) {
        const oldCounselorEmail = counselorEmailByName.get(oldCounselor.toLowerCase());
        const newCounselorEmail = counselorEmailByName.get(newCounselor.toLowerCase());

        if (oldCounselorEmail && oldCounselor.toLowerCase() !== "unassigned") {
          await createNotification({
            userId: oldCounselorEmail,
            role: "counselor",
            type: "lead_transferred_from",
            title: "Lead Transferred",
            message: `Lead ${lead.name} has been transferred to ${newCounselor}.`,
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
              ? `You received lead ${lead.name} from ${oldCounselor}.`
              : `You received new lead ${lead.name}.`,
            sound: true,
            leadId: lead.id,
            leadName: lead.name,
            fromCounselor: hasOldCounselor ? oldCounselor : null
          });
        }
      }
    }

    const now = new Date().toISOString();
    await stateCollection.updateOne(
      { _id: STATE_DOC_ID },
      { $set: { updatedAt: now } },
      { upsert: true }
    );

    const nextState = await refreshStateAfterAtomicUpdate();
    res.setHeader("ETag", buildStateEtag(nextState));
    return res.json({ ok: true, updatedCount: result.modifiedCount, state: buildStateResponse(nextState) });
  } catch (error) {
    return res.status(500).json({ message: "Failed to assign leads", details: error.message });
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
      await leadsCollection.deleteMany({});
      if (sanitized.leads.length) {
        await leadsCollection.insertMany(sanitized.leads);
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
    const now = new Date().toISOString();
    await leadsCollection.deleteMany({});
    if (req.body.length) {
      await leadsCollection.insertMany(req.body);
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
    const now = new Date().toISOString();
    await counselorsCollection.deleteMany({});
    if (req.body.length) {
      await counselorsCollection.insertMany(req.body);
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

app.get("/", (_req, res) => {
  res.sendFile(path.join(ROOT_DIR, "index.html"));
});

app.get("/dashboard", (_req, res) => {
  res.sendFile(path.join(ROOT_DIR, "dashboard.html"));
});

app.get("/meta-integration", (_req, res) => {
  res.sendFile(path.join(ROOT_DIR, "meta-integration.html"));
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
    await leadsCollection.insertOne(newLead);
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
  const counselorName = await assignCounselorRoundRobin(snapshot.counselors);
  const nextId = await getNextMetaLeadId();
  const newLead = buildMetaLead(
    metaLead.field_data,
    {
      leadgenId,
      formId,
      adId: metaLead.ad_id,
      adName: metaLead.ad_name,
      adsetName: metaLead.adset_name,
      campaignName: metaLead.campaign_name
    },
    counselorName,
    nextId
  );
  const duplicateLead = findDuplicateLeadByEmailOrPhone(snapshot.leads, newLead);
  if (duplicateLead) {
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
    campaignName: newLead.metaCampaignName
  });

  await createNotification({
    userId: "admin",
    role: "admin",
    type: "new_meta_lead",
    title: "Lead Received",
    message: `Lead: ${newLead.name}. Assigned counselor: ${counselorName}`,
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
    if (counselorDoc && counselorDoc.email) {
      await createNotification({
        userId: counselorDoc.email,
        role: "counselor",
        type: "new_lead",
        title: "New Lead Received",
        message: `You received new lead ${newLead.name}.`,
        sound: true,
        leadId: nextId,
        leadName: newLead.name
      });
    }
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

module.exports = app;
