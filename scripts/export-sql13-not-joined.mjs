import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { MongoClient } from "mongodb";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const WORKSHOP_PATTERNS = [/sql/i, /13/i];
const GROUP_JOINED_VALUE = "joined";
const OUTPUT_DIR = path.resolve("outputs", "sql13-not-joined");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "sql-13th-june-not-joined-leads.xlsx");

function matchesSql13Workshop(name) {
  const value = String(name || "").trim();
  return value && WORKSHOP_PATTERNS.every((pattern) => pattern.test(value));
}

function normalizeGroupStatus(value) {
  return String(value || "").trim();
}

function toCsvValue(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

async function loadFilteredLeads() {
  const client = new MongoClient(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 15000,
  });

  await client.connect();

  try {
    const db = client.db(process.env.MONGODB_DB_NAME || "i-crm-workshop");
    const leads = await db.collection("leads").find(
      {},
      {
        projection: {
          _id: 0,
          id: 1,
          name: 1,
          phone: 1,
          email: 1,
          workshop: 1,
          createdAt: 1,
          counselor: 1,
          wsStatus: 1,
          whatsappInvite: 1,
          whatsappGroupStatus: 1,
          callStatus: 1,
          dialed: 1,
        },
      }
    ).toArray();

    return leads
      .filter((lead) => matchesSql13Workshop(lead.workshop))
      .filter((lead) => normalizeGroupStatus(lead.whatsappGroupStatus).toLowerCase() !== GROUP_JOINED_VALUE)
      .sort((a, b) => {
        const workshopCompare = String(a.workshop || "").localeCompare(String(b.workshop || ""));
        if (workshopCompare !== 0) return workshopCompare;
        const createdCompare = String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
        if (createdCompare !== 0) return createdCompare;
        return String(a.name || "").localeCompare(String(b.name || ""));
      });
  } finally {
    await client.close();
  }
}

async function buildWorkbook(leads) {
  const headers = [
    "Lead ID",
    "Name",
    "Phone",
    "Email",
    "Workshop",
    "Created At",
    "Counselor",
    "Workshop Status",
    "WhatsApp Invite",
    "WhatsApp Group Status",
    "Call Status",
    "Dialed",
  ];

  const rows = leads.map((lead) => [
    lead.id,
    lead.name,
    lead.phone,
    lead.email,
    lead.workshop,
    lead.createdAt,
    lead.counselor,
    lead.wsStatus,
    lead.whatsappInvite,
    normalizeGroupStatus(lead.whatsappGroupStatus) || "Blank",
    lead.callStatus,
    lead.dialed,
  ]);

  const csvText = [
    headers.map(toCsvValue).join(","),
    ...rows.map((row) => row.map(toCsvValue).join(",")),
  ].join("\n");

  const workbook = await Workbook.fromCSV(csvText, { sheetName: "SQL 13 June Leads" });
  return workbook;
}

async function verifyWorkbook(workbook, expectedCount) {
  const table = await workbook.inspect({
    kind: "table",
    range: "SQL 13 June Leads!A1:L10",
    include: "values",
    tableMaxRows: 10,
    tableMaxCols: 12,
  });

  const text = String(table?.ndjson || "");
  if (!text.includes("Lead ID") || !text.includes("WhatsApp Group Status")) {
    throw new Error("Workbook verification failed: expected headers are missing.");
  }

  if (expectedCount === 0) {
    return;
  }

  const rendered = await workbook.render({ sheetName: "SQL 13 June Leads", range: "A1:L15", scale: 1.5 });
  if (!rendered) {
    throw new Error("Workbook verification failed: render did not return an image.");
  }
}

async function main() {
  if (!process.env.MONGODB_URI) {
    throw new Error("Missing MONGODB_URI.");
  }

  const leads = await loadFilteredLeads();
  const workbook = await buildWorkbook(leads);

  await verifyWorkbook(workbook, leads.length);
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const output = await SpreadsheetFile.exportXlsx(workbook);
  await output.save(OUTPUT_FILE);

  const countsByWorkshop = leads.reduce((acc, lead) => {
    const key = String(lead.workshop || "Unknown");
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  console.log(JSON.stringify({
    outputFile: OUTPUT_FILE,
    total: leads.length,
    countsByWorkshop,
  }, null, 2));
}

await main();
