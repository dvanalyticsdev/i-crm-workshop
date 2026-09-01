import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { MongoClient } from "mongodb";

const INPUT_CSV = "C:\\Users\\pushk\\Downloads\\NK Excel Aug 2026.csv";
const OUTPUT_DIR = path.resolve("outputs", "nk-aug-2026-crm-audit");
const WRITE = process.argv.includes("--write");
const COUNSELORS = ["Ankita", "Kritika", "Venkat", "Anuj"];
const SOURCE = "Organic";
const MAIN_ADMISSION_PIPELINE = "main-admission";
const META_CONFIG_DOC_ID = "meta_integration";
const STATE_DOC_ID = "global";

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === "\"") {
      if (inQuotes && next === "\"") {
        cell += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => String(value || "").trim())) rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }

  row.push(cell);
  if (row.some((value) => String(value || "").trim())) rows.push(row);
  return rows;
}

function rowsToObjects(rows) {
  const headers = rows[0].map((header) => String(header || "").trim());
  return rows.slice(1).map((row) => Object.fromEntries(
    headers.map((header, index) => [header, String(row[index] || "").trim()])
  ));
}

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
  if (digits.length === 10) return `91${digits}`;
  return clean(value);
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

function sourceRowsFromCsv() {
  const csvText = fs.readFileSync(INPUT_CSV, "utf8").replace(/^\uFEFF/, "");
  return rowsToObjects(parseCsv(csvText)).map((row, index) => {
    const phone = clean(row["Mob No"]);
    const email = normalizeEmail(row.Email);
    return {
      sourceRow: index + 2,
      serialNo: clean(row["SL.No"]),
      csvDate: clean(row.Date),
      name: clean(row["Full Name"]) || email || phone,
      phone,
      email,
      location: clean(row.Location),
      education: clean(row.Education),
      experience: clean(row.Experience),
      normalizedPhone: normalizePhone(phone),
      normalizedEmail: email
    };
  });
}

function collectUnique(values) {
  return [...new Set(values.map((value) => clean(value)).filter(Boolean))];
}

function pushMap(map, key, lead) {
  if (!key) return;
  const bucket = map.get(key) || [];
  bucket.push(lead);
  map.set(key, bucket);
}

function buildFindConditions(sourceRows) {
  const phones = collectUnique(sourceRows.map((row) => row.normalizedPhone));
  const emails = collectUnique(sourceRows.map((row) => row.normalizedEmail));
  const conditions = [];
  if (phones.length) conditions.push({ normalizedPhone: { $in: phones } }, { phone: { $in: phones } });
  if (emails.length) conditions.push({ normalizedEmail: { $in: emails } }, { email: { $in: emails } });
  return conditions;
}

function getMatches(source, byPhone, byEmail) {
  const matches = [
    ...(source.normalizedPhone ? byPhone.get(source.normalizedPhone) || [] : []),
    ...(source.normalizedEmail ? byEmail.get(source.normalizedEmail) || [] : [])
  ];
  return [...new Map(matches.map((lead) => [String(lead.id || `${lead.email}:${lead.phone}`), lead])).values()];
}

function activityLogEntry({ lead, activityType, actionDescription, previousValue = null, newValue = null, now }) {
  const date = new Date(now);
  const dateStr = date.toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).split("/").reverse().join("-");
  const timeStr = date.toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour12: true,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

  return {
    activityType,
    leadId: String(lead.id),
    leadName: clean(lead.name),
    counselorName: clean(lead.counselor),
    performedBy: "Codex",
    userRole: "system",
    actionDescription,
    previousValue,
    newValue,
    timestamp: date,
    date: dateStr,
    time: timeStr,
    remarks: null,
    callMetadata: null,
    recordingUrl: ""
  };
}

async function syncLeadSequence(db) {
  const maxLeadDoc = await db.collection("leads").find({}, { projection: { id: 1 } })
    .sort({ id: -1 })
    .limit(1)
    .next();
  const maxLeadId = Number(maxLeadDoc?.id) || 0;
  if (maxLeadId > 0) {
    await db.collection("meta_config").updateOne(
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

function buildMainAdmissionLead(source, id, counselor, now) {
  return {
    id,
    name: source.name,
    email: source.email,
    phone: displayPhone(source.phone),
    normalizedEmail: source.normalizedEmail,
    normalizedPhone: source.normalizedPhone,
    source: SOURCE,
    leadSource: SOURCE,
    leadPipeline: MAIN_ADMISSION_PIPELINE,
    counselor,
    counselorAssignedAt: now,
    leadOwnerTimelineAt: now,
    leadOwnerType: "direct",
    assignedFromCounselor: "",
    admissionSopAssignedAt: now,
    admissionSopLastProgressAt: null,
    admissionSopDeadlineOverrideAt: "",
    courseName: "",
    location: source.location,
    education: source.education,
    experience: source.experience,
    status: "New",
    mainAdmissionDialed: "",
    mainAdmissionCoursePitched: "",
    mainAdmissionCourseStatus: "",
    mainAdmissionAdmissionStatus: "",
    mainAdmissionCallStatus: "",
    mainAdmissionActivityUpdated: false,
    mainAdmissionActivityUpdates: 0,
    mainAdmissionActivityTouchedByAssignee: false,
    mainAdmissionActivityHistory: [],
    leadNotes: [],
    importSourceFiles: ["NK Excel Aug 2026.csv"],
    importSourceSheets: [],
    importedBy: "Codex",
    importedAt: now,
    createdAt: toKolkataDateKey(new Date(now)),
    createdAtExact: now,
    updatedAt: now,
    nkSourceRow: source.sourceRow,
    nkSerialNo: source.serialNo,
    nkCsvDate: source.csvDate
  };
}

function buildArchivedLeadPatch(source, lead, counselor, now) {
  return {
    source: SOURCE,
    leadSource: SOURCE,
    leadPipeline: MAIN_ADMISSION_PIPELINE,
    counselor,
    counselorAssignedAt: now,
    leadOwnerTimelineAt: now,
    leadOwnerType: "reassigned",
    assignedFromCounselor: clean(lead.counselor) || "Archived Leads",
    admissionSopAssignedAt: now,
    admissionSopLastProgressAt: null,
    admissionSopDeadlineOverrideAt: "",
    mainAdmissionDialed: "",
    mainAdmissionCoursePitched: "",
    mainAdmissionCourseStatus: "",
    mainAdmissionAdmissionStatus: "",
    mainAdmissionCallStatus: "",
    mainAdmissionActivityUpdated: false,
    mainAdmissionActivityUpdates: 0,
    mainAdmissionActivityTouchedByAssignee: false,
    mainAdmissionActivityHistory: [],
    updatedAt: now,
    nkReactivatedFromArchiveAt: now,
    nkSourceRow: source.sourceRow,
    nkSerialNo: source.serialNo,
    nkCsvDate: source.csvDate
  };
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

async function main() {
  const sourceRows = sourceRowsFromCsv();
  const conditions = buildFindConditions(sourceRows);
  const client = new MongoClient(process.env.MONGODB_URI || "mongodb://127.0.0.1:27018", {
    serverSelectionTimeoutMS: 10000
  });
  await client.connect();
  const db = client.db(process.env.MONGODB_DB_NAME || "i-crm-workshop");
  const leadsCollection = db.collection("leads");

  const projection = {
    _id: 0,
    id: 1,
    name: 1,
    email: 1,
    phone: 1,
    normalizedEmail: 1,
    normalizedPhone: 1,
    counselor: 1
  };
  const crmLeads = conditions.length
    ? await leadsCollection.find({ $or: conditions }, { projection }).toArray()
    : [];

  const byPhone = new Map();
  const byEmail = new Map();
  for (const lead of crmLeads) {
    pushMap(byPhone, normalizePhone(lead.normalizedPhone || lead.phone), lead);
    pushMap(byEmail, normalizeEmail(lead.normalizedEmail || lead.email), lead);
  }

  const missingSources = [];
  const archivedMatches = [];
  const untouchedExistingMatches = [];
  for (const source of sourceRows) {
    const matches = getMatches(source, byPhone, byEmail);
    if (!matches.length) {
      missingSources.push(source);
      continue;
    }
    for (const lead of matches) {
      if (clean(lead.counselor).toLowerCase() === "archived leads") {
        archivedMatches.push({ source, lead });
      } else {
        untouchedExistingMatches.push({ source, lead });
      }
    }
  }

  const now = new Date().toISOString();
  const plannedRows = [];
  missingSources.forEach((source, index) => {
    plannedRows.push({
      action: "create",
      sourceRow: source.sourceRow,
      csvName: source.name,
      csvPhone: source.phone,
      csvEmail: source.email,
      crmLeadId: "",
      previousCounselor: "",
      nextCounselor: COUNSELORS[index % COUNSELORS.length]
    });
  });
  archivedMatches.forEach(({ source, lead }, index) => {
    plannedRows.push({
      action: "reactivate-archived",
      sourceRow: source.sourceRow,
      csvName: source.name,
      csvPhone: source.phone,
      csvEmail: source.email,
      crmLeadId: lead.id,
      previousCounselor: clean(lead.counselor),
      nextCounselor: COUNSELORS[(missingSources.length + index) % COUNSELORS.length]
    });
  });

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const planPath = path.join(OUTPUT_DIR, `nk-aug-2026-update-plan-${now.replace(/[:.]/g, "-")}.csv`);
  const headers = ["action", "sourceRow", "csvName", "csvPhone", "csvEmail", "crmLeadId", "previousCounselor", "nextCounselor"];
  fs.writeFileSync(
    planPath,
    `${headers.join(",")}\n${plannedRows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")).join("\n")}\n`,
    "utf8"
  );

  const summary = {
    mode: WRITE ? "write" : "dry-run",
    inputCsv: INPUT_CSV,
    totalCsvRows: sourceRows.length,
    existingCrmRecordsMatched: crmLeads.length,
    existingNonArchivedMatchesLeftUntouched: untouchedExistingMatches.length,
    missingLeadsToCreate: missingSources.length,
    archivedCrmLeadsToReactivate: archivedMatches.length,
    totalRecordsToAssign: plannedRows.length,
    targetCounselorCounts: Object.fromEntries(
      plannedRows.reduce((map, row) => map.set(row.nextCounselor, (map.get(row.nextCounselor) || 0) + 1), new Map())
    ),
    source: SOURCE,
    leadPipeline: MAIN_ADMISSION_PIPELINE,
    assignedAt: now,
    planPath
  };
  console.log(JSON.stringify(summary, null, 2));

  if (!WRITE) {
    await client.close();
    return;
  }

  const backupPath = path.join(OUTPUT_DIR, `nk-aug-2026-before-update-${now.replace(/[:.]/g, "-")}.json`);
  const archivedLeadIds = archivedMatches.map(({ lead }) => lead.id).filter((id) => id != null);
  const archivedBackups = archivedLeadIds.length
    ? await leadsCollection.find({ id: { $in: archivedLeadIds } }).toArray()
    : [];
  fs.writeFileSync(backupPath, JSON.stringify({
    at: now,
    archivedBackups,
    plannedCreates: missingSources
  }, null, 2), "utf8");

  const ids = await reserveLeadIds(db, missingSources.length);
  const newLeads = missingSources.map((source, index) => (
    buildMainAdmissionLead(source, ids[index], COUNSELORS[index % COUNSELORS.length], now)
  ));
  if (newLeads.length) {
    await leadsCollection.insertMany(newLeads, { ordered: false });
  }

  let updatedArchived = 0;
  for (const { source, lead } of archivedMatches) {
    const counselor = COUNSELORS[(missingSources.length + updatedArchived) % COUNSELORS.length];
    const patch = buildArchivedLeadPatch(source, lead, counselor, now);
    const result = await leadsCollection.updateOne({ id: lead.id }, { $set: patch });
    updatedArchived += result.modifiedCount || 0;
  }

  const activityEntries = [
    ...newLeads.flatMap((lead) => [
      activityLogEntry({
        lead,
        activityType: "Lead Created",
        actionDescription: "Lead created from NK Excel Aug 2026.csv as main admission organic lead",
        newValue: `Name: ${lead.name}, Phone: ${lead.phone || "-"}, Email: ${lead.email || "-"}, Source: ${SOURCE}`,
        now
      }),
      activityLogEntry({
        lead,
        activityType: "Lead Assigned",
        actionDescription: `Lead assigned to counselor ${lead.counselor}`,
        newValue: lead.counselor,
        now
      })
    ]),
    ...archivedMatches.map(({ lead }, index) => {
      const counselor = COUNSELORS[(missingSources.length + index) % COUNSELORS.length];
      return activityLogEntry({
        lead: { ...lead, counselor },
        activityType: "Lead Assigned",
        actionDescription: `Archived lead reactivated as main admission organic lead and assigned to counselor ${counselor}`,
        previousValue: "Archived Leads",
        newValue: counselor,
        now
      });
    })
  ];
  if (activityEntries.length) {
    await db.collection("activity_logs").insertMany(activityEntries, { ordered: false });
  }

  await db.collection("state").updateOne(
    { _id: STATE_DOC_ID },
    { $set: { updatedAt: now } },
    { upsert: true }
  );

  const verification = await leadsCollection.aggregate([
    {
      $match: {
        source: SOURCE,
        leadSource: SOURCE,
        leadPipeline: MAIN_ADMISSION_PIPELINE,
        counselorAssignedAt: now,
        counselor: { $in: COUNSELORS },
        mainAdmissionActivityUpdates: 0
      }
    },
    { $group: { _id: "$counselor", count: { $sum: 1 } } },
    { $sort: { _id: 1 } }
  ]).toArray();

  console.log(JSON.stringify({
    mode: "write-complete",
    insertedNewLeads: newLeads.length,
    updatedArchivedLeads: updatedArchived,
    activityLogsInserted: activityEntries.length,
    backupPath,
    verification
  }, null, 2));

  await client.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
