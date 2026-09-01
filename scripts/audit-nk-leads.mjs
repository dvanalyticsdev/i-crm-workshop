import fs from "node:fs";
import path from "node:path";
import { MongoClient } from "mongodb";

const INPUT_CSV = "C:\\Users\\pushk\\Downloads\\NK Excel Aug 2026.csv";
const OUTPUT_DIR = path.resolve("outputs", "nk-aug-2026-crm-audit");
const REPORT_CSV = path.join(OUTPUT_DIR, "nk-aug-2026-crm-matches.csv");
const SUMMARY_JSON = path.join(OUTPUT_DIR, "nk-aug-2026-crm-summary.json");

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

function normalizeContactValue(value) {
  return String(value || "").trim();
}

function normalizePhone(value) {
  const digits = normalizeContactValue(value).replace(/\D+/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(-10);
  return digits;
}

function normalizeEmail(value) {
  return normalizeContactValue(value).toLowerCase();
}

function sectionForLead(lead = {}) {
  const pipeline = String(lead.leadPipeline || "").trim().toLowerCase();
  if (["main-admission", "admission", "main-admission-calling"].includes(pipeline)) {
    return "Main Admission Section";
  }
  if (pipeline === "course-registration") return "Registered Candidates Section";
  return "Workshop Section";
}

function admissionStatusForLead(lead = {}) {
  return String(
    lead.mainAdmissionAdmissionStatus ||
    lead.registeredAdmissionStatus ||
    lead.admissionStatus ||
    ""
  ).trim() || "not filled";
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

function collectUnique(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function pushMap(map, key, lead) {
  if (!key) return;
  const bucket = map.get(key) || [];
  bucket.push(lead);
  map.set(key, bucket);
}

async function main() {
  const csvText = fs.readFileSync(INPUT_CSV, "utf8").replace(/^\uFEFF/, "");
  const sourceRows = rowsToObjects(parseCsv(csvText)).map((row, index) => ({
    sourceRow: index + 2,
    serialNo: row["SL.No"] || "",
    date: row.Date || "",
    name: row["Full Name"] || "",
    phone: row["Mob No"] || "",
    email: row.Email || "",
    location: row.Location || "",
    education: row.Education || "",
    experience: row.Experience || "",
    normalizedPhone: normalizePhone(row["Mob No"]),
    normalizedEmail: normalizeEmail(row.Email)
  }));

  const phones = collectUnique(sourceRows.map((row) => row.normalizedPhone));
  const emails = collectUnique(sourceRows.map((row) => row.normalizedEmail));
  const conditions = [];
  if (phones.length) conditions.push({ normalizedPhone: { $in: phones } }, { phone: { $in: phones } });
  if (emails.length) conditions.push({ normalizedEmail: { $in: emails } }, { email: { $in: emails } });

  const client = new MongoClient(process.env.MONGODB_URI || "mongodb://127.0.0.1:27018", {
    serverSelectionTimeoutMS: 10000
  });
  await client.connect();
  const db = client.db(process.env.MONGODB_DB_NAME || "i-crm-workshop");

  const projection = {
    _id: 0,
    id: 1,
    name: 1,
    email: 1,
    phone: 1,
    normalizedEmail: 1,
    normalizedPhone: 1,
    counselor: 1,
    leadPipeline: 1,
    workshop: 1,
    workshopName: 1,
    admissionWorkshop: 1,
    courseName: 1,
    courseRawName: 1,
    admissionStatus: 1,
    registeredAdmissionStatus: 1,
    mainAdmissionAdmissionStatus: 1,
    courseStatus: 1,
    registeredCourseStatus: 1,
    mainAdmissionCourseStatus: 1,
    wsStatus: 1,
    callStatus: 1,
    mainAdmissionCallStatus: 1,
    createdAt: 1,
    updatedAt: 1,
    source: 1
  };

  const crmLeads = conditions.length
    ? await db.collection("leads").find({ $or: conditions }, { projection }).toArray()
    : [];
  await client.close();

  const byPhone = new Map();
  const byEmail = new Map();
  for (const lead of crmLeads) {
    pushMap(byPhone, normalizePhone(lead.normalizedPhone || lead.phone), lead);
    pushMap(byEmail, normalizeEmail(lead.normalizedEmail || lead.email), lead);
  }

  const matchedRows = [];
  const unmatchedRows = [];
  const matchedSourceRows = new Set();
  const matchedCrmLeadIds = new Set();

  for (const source of sourceRows) {
    const matches = [
      ...(source.normalizedPhone ? byPhone.get(source.normalizedPhone) || [] : []),
      ...(source.normalizedEmail ? byEmail.get(source.normalizedEmail) || [] : [])
    ];
    const uniqueMatches = [...new Map(matches.map((lead) => [String(lead.id || `${lead.email}:${lead.phone}`), lead])).values()];

    if (!uniqueMatches.length) {
      unmatchedRows.push(source);
      continue;
    }

    matchedSourceRows.add(source.sourceRow);
    for (const lead of uniqueMatches) {
      if (lead.id != null) matchedCrmLeadIds.add(String(lead.id));
      matchedRows.push({
        sourceRow: source.sourceRow,
        serialNo: source.serialNo,
        csvDate: source.date,
        csvName: source.name,
        csvPhone: source.phone,
        csvEmail: source.email,
        matchType: [
          source.normalizedPhone && normalizePhone(lead.normalizedPhone || lead.phone) === source.normalizedPhone ? "phone" : "",
          source.normalizedEmail && normalizeEmail(lead.normalizedEmail || lead.email) === source.normalizedEmail ? "email" : ""
        ].filter(Boolean).join("+"),
        crmLeadId: lead.id || "",
        crmName: lead.name || "",
        crmPhone: lead.phone || "",
        crmEmail: lead.email || "",
        section: sectionForLead(lead),
        leadPipeline: lead.leadPipeline || "",
        counselor: String(lead.counselor || "").trim() || "Unassigned",
        admissionStatus: admissionStatusForLead(lead),
        courseStatus: lead.mainAdmissionCourseStatus || lead.registeredCourseStatus || lead.courseStatus || lead.wsStatus || "",
        workshopOrCourse: lead.courseName || lead.admissionWorkshop || lead.workshop || lead.workshopName || lead.courseRawName || "",
        callStatus: lead.mainAdmissionCallStatus || lead.callStatus || "",
        source: lead.source || "",
        createdAt: lead.createdAt || "",
        updatedAt: lead.updatedAt || ""
      });
    }
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const headers = [
    "sourceRow", "serialNo", "csvDate", "csvName", "csvPhone", "csvEmail", "matchType",
    "crmLeadId", "crmName", "crmPhone", "crmEmail", "section", "leadPipeline",
    "counselor", "admissionStatus", "courseStatus", "workshopOrCourse", "callStatus",
    "source", "createdAt", "updatedAt"
  ];
  fs.writeFileSync(
    REPORT_CSV,
    `${headers.join(",")}\n${matchedRows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")).join("\n")}\n`,
    "utf8"
  );

  const summary = {
    inputCsv: INPUT_CSV,
    reportCsv: REPORT_CSV,
    totalCsvRows: sourceRows.length,
    matchedCsvRows: matchedSourceRows.size,
    unmatchedCsvRows: unmatchedRows.length,
    matchedCrmRecords: matchedRows.length,
    uniqueMatchedCrmLeads: matchedCrmLeadIds.size,
    sectionCounts: Object.fromEntries(
      [...matchedRows.reduce((map, row) => map.set(row.section, (map.get(row.section) || 0) + 1), new Map())]
        .sort((left, right) => left[0].localeCompare(right[0]))
    ),
    admissionStatusCounts: Object.fromEntries(
      [...matchedRows.reduce((map, row) => map.set(row.admissionStatus, (map.get(row.admissionStatus) || 0) + 1), new Map())]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    ),
    counselorCounts: Object.fromEntries(
      [...matchedRows.reduce((map, row) => map.set(row.counselor, (map.get(row.counselor) || 0) + 1), new Map())]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    )
  };

  fs.writeFileSync(SUMMARY_JSON, JSON.stringify(summary, null, 2), "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
