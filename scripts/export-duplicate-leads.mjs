import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { MongoClient } from "mongodb";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const OUTPUT_DIR = path.resolve("outputs", "duplicate-leads-audit");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "duplicate-leads-audit.xlsx");

function normalizePhone(value) {
  return String(value || "").replace(/\D+/g, "").trim();
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function toCsvValue(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

async function loadLeads() {
  const client = new MongoClient(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 15000
  });

  await client.connect();
  try {
    const db = client.db(process.env.MONGODB_DB_NAME || "i-crm-workshop");
    return await db.collection("leads").find({}, {
      projection: {
        _id: 0,
        id: 1,
        name: 1,
        email: 1,
        phone: 1,
        workshop: 1,
        counselor: 1,
        createdAt: 1,
        source: 1,
        metaLeadId: 1
      }
    }).toArray();
  } finally {
    await client.close();
  }
}

function buildDuplicateRows(leads) {
  const phoneGroups = new Map();
  const emailGroups = new Map();

  for (const lead of leads) {
    const phone = normalizePhone(lead.phone);
    const email = normalizeEmail(lead.email);

    if (phone) {
      if (!phoneGroups.has(phone)) phoneGroups.set(phone, []);
      phoneGroups.get(phone).push(lead);
    }
    if (email) {
      if (!emailGroups.has(email)) emailGroups.set(email, []);
      emailGroups.get(email).push(lead);
    }
  }

  const duplicatePhones = new Set(
    [...phoneGroups.entries()]
      .filter(([, items]) => items.length > 1)
      .map(([value]) => value)
  );
  const duplicateEmails = new Set(
    [...emailGroups.entries()]
      .filter(([, items]) => items.length > 1)
      .map(([value]) => value)
  );

  return leads
    .filter((lead) => duplicatePhones.has(normalizePhone(lead.phone)) || duplicateEmails.has(normalizeEmail(lead.email)))
    .map((lead) => {
      const normalizedPhone = normalizePhone(lead.phone);
      const normalizedEmail = normalizeEmail(lead.email);
      const phoneMatches = phoneGroups.get(normalizedPhone) || [];
      const emailMatches = emailGroups.get(normalizedEmail) || [];
      const duplicateType = [
        duplicatePhones.has(normalizedPhone) ? "Phone" : "",
        duplicateEmails.has(normalizedEmail) ? "Email" : ""
      ].filter(Boolean).join(" + ");

      return [
        duplicateType,
        lead.id,
        lead.name,
        lead.phone,
        normalizedPhone,
        lead.email,
        normalizedEmail,
        lead.workshop,
        lead.createdAt,
        lead.counselor,
        lead.source || "",
        lead.metaLeadId || "",
        duplicatePhones.has(normalizedPhone) ? phoneMatches.length : 0,
        duplicateEmails.has(normalizedEmail) ? emailMatches.length : 0
      ];
    })
    .sort((a, b) => {
      const typeCompare = String(a[0]).localeCompare(String(b[0]));
      if (typeCompare !== 0) return typeCompare;
      const phoneCompare = String(a[4]).localeCompare(String(b[4]));
      if (phoneCompare !== 0) return phoneCompare;
      const emailCompare = String(a[6]).localeCompare(String(b[6]));
      if (emailCompare !== 0) return emailCompare;
      return Number(a[1]) - Number(b[1]);
    });
}

async function main() {
  if (!process.env.MONGODB_URI) {
    throw new Error("Missing MONGODB_URI.");
  }

  const leads = await loadLeads();
  const rows = buildDuplicateRows(leads);
  const headers = [
    "Duplicate Type",
    "Lead ID",
    "Name",
    "Phone",
    "Normalized Phone",
    "Email",
    "Normalized Email",
    "Workshop",
    "Created At",
    "Counselor",
    "Source",
    "Meta Lead ID",
    "Phone Group Size",
    "Email Group Size"
  ];

  const csvText = [
    headers.map(toCsvValue).join(","),
    ...rows.map((row) => row.map(toCsvValue).join(","))
  ].join("\n");

  const workbook = await Workbook.fromCSV(csvText, { sheetName: "Duplicate Leads" });
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const output = await SpreadsheetFile.exportXlsx(workbook);
  await output.save(OUTPUT_FILE);

  console.log(JSON.stringify({
    outputFile: OUTPUT_FILE,
    duplicateRows: rows.length
  }, null, 2));
}

await main();
