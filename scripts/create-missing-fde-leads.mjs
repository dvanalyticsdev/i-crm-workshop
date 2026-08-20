import fs from "fs";
import path from "path";
import process from "process";
import { MongoClient } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

const ROWS_PATH = process.env.FDE_ROWS_PATH || "/tmp/fde_full_rows.json";
const EXPECTED_MISSING = Number(process.env.EXPECTED_MISSING || 11);
const WRITE = process.argv.includes("--write");
const COUNSELORS = ["Kritika", "Anuj", "Venkat", "Ankita"];
const WORKSHOP = "Fde 20th August";
const WORKSHOP_NAME = "Fde";
const WORKSHOP_DATE_LABEL = "20th August";
const META_CONFIG_DOC_ID = "meta_integration";
const STATE_DOC_ID = "global";

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeEmail(value) {
  return clean(value).toLowerCase();
}

function normalizePhone(value) {
  const digits = clean(value).replace(/\D+/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(-10);
  return digits;
}

function displayPhone(value) {
  const digits = clean(value).replace(/\D+/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  return clean(value);
}

function parseExcelDate(value) {
  const text = clean(value);
  const match = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (!match) {
    return { createdAt: "", createdAtExact: "" };
  }
  const month = Number(match[1]);
  const day = Number(match[2]);
  const yearRaw = Number(match[3]);
  const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
  const createdAt = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const createdAtExact = new Date(Date.UTC(year, month - 1, day, 6, 30, 0, 0)).toISOString();
  return { createdAt, createdAtExact };
}

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

function activityLogEntry({ lead, activityType, actionDescription, newValue }) {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).split("/").reverse().join("-");
  const timeStr = now.toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour12: true,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

  return {
    activityType,
    leadId: String(lead.id),
    leadName: String(lead.name || ""),
    counselorName: String(lead.counselor || ""),
    performedBy: "System",
    userRole: "system",
    actionDescription,
    previousValue: null,
    newValue: newValue == null ? null : String(newValue),
    timestamp: now,
    date: dateStr,
    time: timeStr,
    remarks: null,
    callMetadata: null,
    recordingUrl: ""
  };
}

async function syncLeadSequence(db) {
  const leads = db.collection("leads");
  const metaConfig = db.collection("meta_config");
  const maxLeadDoc = await leads.find({}, { projection: { id: 1 } })
    .sort({ id: -1 })
    .limit(1)
    .next();
  const maxLeadId = Number(maxLeadDoc?.id) || 0;
  if (maxLeadId > 0) {
    await metaConfig.updateOne(
      { _id: META_CONFIG_DOC_ID },
      { $max: { leadSequence: maxLeadId } },
      { upsert: true }
    );
  }
}

async function reserveLeadIds(db, count) {
  if (!count) return [];
  await syncLeadSequence(db);
  const result = await db.collection("meta_config").findOneAndUpdate(
    { _id: META_CONFIG_DOC_ID },
    { $inc: { leadSequence: count } },
    { returnDocument: "after", upsert: true }
  );
  const endId = Number(result?.leadSequence) || 0;
  const startId = endId - count + 1;
  return Array.from({ length: count }, (_, index) => startId + index);
}

function buildDuplicateQuery(row) {
  const metaLeadId = clean(row.id);
  const email = normalizeEmail(row.email);
  const phone = normalizePhone(row.phone_number);
  const or = [];
  if (metaLeadId) or.push({ metaLeadId });
  if (email) or.push({ normalizedEmail: email });
  if (phone) or.push({ normalizedPhone: phone });
  return or.length ? { $or: or } : null;
}

function buildLead(row, id, counselor, now) {
  const { createdAt, createdAtExact } = parseExcelDate(row.created_time);
  const email = normalizeEmail(row.email);
  const phone = displayPhone(row.phone_number);
  const normalizedPhone = normalizePhone(row.phone_number);
  const metaLeadId = clean(row.id);
  const name = clean(row.full_name) || email || phone || `FDE Lead ${id}`;

  return {
    id,
    name,
    email,
    phone,
    normalizedEmail: email,
    normalizedPhone,
    source: "Meta",
    leadSource: "Meta",
    metaLeadId,
    metaCreatedTime: clean(row.created_time),
    metaAdId: clean(row.ad_id),
    metaAdName: clean(row.ad_name),
    metaAdsetId: clean(row.adset_id),
    metaAdsetName: clean(row.adset_name),
    metaCampaignId: clean(row.campaign_id),
    metaCampaignName: clean(row.campaign_name),
    metaFormId: clean(row.form_id),
    metaFormName: clean(row.form_name),
    metaIsOrganic: /^true$/i.test(clean(row.is_organic)),
    platform: clean(row.platform),
    city: clean(row.city),
    state: clean(row.state),
    qualification: clean(row["your_highest_qualification?_(e.g.,_b.tech/b.e.,_bba/mba,_b.sc.,_b.com.,_b.a.,_bca/mca,_....)"]),
    currentProfile: clean(row["what_best_describes_you_currently?"]),
    leadPipeline: "workshop",
    workshop: WORKSHOP,
    workshopKey: "fde-2026-08-20",
    workshopName: WORKSHOP_NAME,
    workshopNameKey: "fde",
    workshopDateLabel: WORKSHOP_DATE_LABEL,
    workshopDateKey: "2026-08-20",
    admissionWorkshop: WORKSHOP,
    admissionWorkshopKey: "fde-2026-08-20",
    admissionWorkshopName: WORKSHOP_NAME,
    admissionWorkshopNameKey: "fde",
    admissionWorkshopDateLabel: WORKSHOP_DATE_LABEL,
    admissionWorkshopDateKey: "2026-08-20",
    courseName: "FDE",
    counselor,
    status: "New",
    dialed: "",
    callStatus: "",
    wsStatus: "",
    whatsappInvite: "",
    whatsappGroupStatus: "",
    postDialed: "",
    postCallStatus: "",
    coursePitched: "",
    courseStatus: "",
    admissionStatus: "",
    workshopActivityUpdated: false,
    workshopActivityUpdates: 0,
    workshopActivityTouchedByAssignee: false,
    workshopActivityHistory: [],
    leadNotes: [],
    importSourceFiles: ["FDE_workshop_leads.xlsx"],
    importSourceSheets: ["FDE_workshop_leads"],
    importedBy: "Codex",
    importedAt: now,
    createdAt: createdAt || toKolkataDateKey(new Date()),
    createdAtExact: createdAtExact || now,
    updatedAt: now
  };
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is missing");
  const rows = JSON.parse(fs.readFileSync(ROWS_PATH, "utf8"));
  if (!Array.isArray(rows)) throw new Error(`${ROWS_PATH} must contain an array`);

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || "i-crm-workshop");
  const leads = db.collection("leads");

  const metaLeadIds = [...new Set(rows.map((row) => clean(row.id)).filter(Boolean))];
  const emails = [...new Set(rows.map((row) => normalizeEmail(row.email)).filter(Boolean))];
  const phones = [...new Set(rows.map((row) => normalizePhone(row.phone_number)).filter(Boolean))];
  const existingRows = await leads.find({
    $or: [
      { metaLeadId: { $in: metaLeadIds } },
      { normalizedEmail: { $in: emails } },
      { normalizedPhone: { $in: phones } }
    ]
  }, { projection: { id: 1, name: 1, counselor: 1, metaLeadId: 1, normalizedEmail: 1, normalizedPhone: 1 } }).toArray();
  const existingMetaLeadIds = new Set(existingRows.map((lead) => clean(lead.metaLeadId)).filter(Boolean));
  const existingEmails = new Set(existingRows.map((lead) => normalizeEmail(lead.normalizedEmail)).filter(Boolean));
  const existingPhones = new Set(existingRows.map((lead) => normalizePhone(lead.normalizedPhone)).filter(Boolean));
  const missingRows = rows.filter((row) => {
    const metaLeadId = clean(row.id);
    const rowEmail = normalizeEmail(row.email);
    const rowPhone = normalizePhone(row.phone_number);
    return !(metaLeadId && existingMetaLeadIds.has(metaLeadId))
      && !(rowEmail && existingEmails.has(rowEmail))
      && !(rowPhone && existingPhones.has(rowPhone));
  });
  const matchedRows = rows.length - missingRows.length;

  const now = new Date().toISOString();
  const report = {
    rows: rows.length,
    matched: matchedRows,
    missing: missingRows.length,
    missingContacts: missingRows.map((row) => ({
      metaLeadId: clean(row.id),
      name: clean(row.full_name),
      phone: clean(row.phone_number),
      email: normalizeEmail(row.email),
      city: clean(row.city),
      state: clean(row.state)
    }))
  };

  console.log(JSON.stringify({ mode: WRITE ? "write" : "dry-run", ...report }, null, 2));

  if (missingRows.length !== EXPECTED_MISSING) {
    throw new Error(`Expected ${EXPECTED_MISSING} missing rows, found ${missingRows.length}. Aborting.`);
  }

  if (!WRITE) {
    await client.close();
    return;
  }

  const ids = await reserveLeadIds(db, missingRows.length);
  const newLeads = missingRows.map((row, index) => buildLead(row, ids[index], COUNSELORS[index % COUNSELORS.length], now));
  const backupDir = path.join(process.cwd(), "outputs", "fde-missing-leads-create");
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `created-${now.replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(newLeads, null, 2));

  const result = await leads.insertMany(newLeads, { ordered: false });
  const activityEntries = newLeads.flatMap((lead) => [
    activityLogEntry({
      lead,
      activityType: "Lead Created",
      actionDescription: "Lead created from FDE_workshop_leads.xlsx missing lead import",
      newValue: `Name: ${lead.name}, Phone: ${lead.phone || "-"}, Email: ${lead.email || "-"}, Workshop: ${WORKSHOP}`
    }),
    activityLogEntry({
      lead,
      activityType: "Lead Assigned",
      actionDescription: `Lead initially assigned to counselor ${lead.counselor}`,
      newValue: lead.counselor
    })
  ]);
  if (activityEntries.length) {
    await db.collection("activity_logs").insertMany(activityEntries, { ordered: false });
  }
  await db.collection("state").updateOne(
    { _id: STATE_DOC_ID },
    { $set: { updatedAt: new Date().toISOString() } },
    { upsert: true }
  );

  const postMatched = await leads.countDocuments({
    $or: newLeads.flatMap((lead) => [
      lead.metaLeadId ? { metaLeadId: lead.metaLeadId } : null,
      lead.normalizedEmail ? { normalizedEmail: lead.normalizedEmail } : null,
      lead.normalizedPhone ? { normalizedPhone: lead.normalizedPhone } : null
    ].filter(Boolean))
  });
  const fdeCount = await leads.countDocuments({
    leadPipeline: "workshop",
    workshop: WORKSHOP,
    workshopName: WORKSHOP_NAME,
    workshopDateLabel: WORKSHOP_DATE_LABEL
  });

  console.log(JSON.stringify({
    inserted: result.insertedCount,
    insertedIds: newLeads.map((lead) => lead.id),
    counselors: newLeads.map((lead) => ({ id: lead.id, name: lead.name, counselor: lead.counselor })),
    backupPath,
    postMatchedForInsertedContacts: postMatched,
    fdeWorkshopCount: fdeCount
  }, null, 2));
  await client.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
