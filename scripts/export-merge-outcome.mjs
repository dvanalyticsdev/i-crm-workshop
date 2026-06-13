import fs from "node:fs/promises";
import path from "node:path";
import { MongoClient } from "mongodb";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";
import "dotenv/config";

const OUTPUT_DIR = path.resolve("outputs", "duplicate-merge");
const BACKUP_FILE = path.join(OUTPUT_DIR, "leads-before-merge.json");
const SUMMARY_FILE = path.join(OUTPUT_DIR, "duplicate-merge-summary.json");
const REPORT_FILE = path.join(OUTPUT_DIR, "duplicate-merge-report.xlsx");

function toCsvValue(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

async function main() {
  const backup = JSON.parse(await fs.readFile(BACKUP_FILE, "utf8"));

  const client = new MongoClient(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 15000
  });
  await client.connect();

  try {
    const db = client.db(process.env.MONGODB_DB_NAME || "i-crm-workshop");
    const cleanedLeads = await db.collection("leads").find({}, {
      projection: {
        _id: 0,
        id: 1,
        name: 1,
        email: 1,
        phone: 1,
        workshop: 1,
        counselor: 1,
        createdAt: 1,
        mergedLeadIds: 1,
        mergedCounselors: 1,
        duplicateWorkshops: 1
      }
    }).toArray();

    const backupById = new Map(backup.map((lead) => [String(lead.id), lead]));
    const mergedClusters = cleanedLeads
      .filter((lead) => Array.isArray(lead.mergedLeadIds) && lead.mergedLeadIds.length > 1)
      .sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));

    const rows = [];
    const summary = [];

    for (const [index, master] of mergedClusters.entries()) {
      const mergedIds = master.mergedLeadIds.map((id) => String(id));
      const donors = mergedIds.slice(1).map((id) => backupById.get(id)).filter(Boolean);
      summary.push({
        cluster: index + 1,
        keptLeadId: master.id,
        mergedLeadIds: donors.map((lead) => lead.id),
        keptCounselor: master.counselor || "",
        mergedCounselors: Array.isArray(master.mergedCounselors) ? master.mergedCounselors : [],
        duplicateWorkshops: Array.isArray(master.duplicateWorkshops) ? master.duplicateWorkshops : []
      });

      for (const donor of donors) {
        rows.push([
          index + 1,
          "Merged into master",
          master.id,
          donor.id,
          master.counselor || "",
          donor.counselor || "",
          master.workshop || "",
          donor.workshop || "",
          master.email || "",
          donor.email || "",
          master.phone || "",
          donor.phone || "",
          master.createdAt || "",
          donor.createdAt || ""
        ]);
      }
    }

    const headers = [
      "Cluster",
      "Action",
      "Kept Lead ID",
      "Merged Lead ID",
      "Kept Counselor",
      "Merged Counselor",
      "Kept Workshop",
      "Merged Workshop",
      "Kept Email",
      "Merged Email",
      "Kept Phone",
      "Merged Phone",
      "Kept Created At",
      "Merged Created At"
    ];

    const csvText = [
      headers.map(toCsvValue).join(","),
      ...rows.map((row) => row.map(toCsvValue).join(","))
    ].join("\n");

    const workbook = await Workbook.fromCSV(csvText, { sheetName: "Merge Report" });
    const output = await SpreadsheetFile.exportXlsx(workbook);
    await output.save(REPORT_FILE);

    await fs.writeFile(SUMMARY_FILE, JSON.stringify({
      originalLeadCount: backup.length,
      cleanedLeadCount: cleanedLeads.length,
      duplicateClustersMerged: mergedClusters.length,
      duplicateRowsRemoved: backup.length - cleanedLeads.length,
      summary
    }, null, 2), "utf8");

    console.log(JSON.stringify({
      originalLeadCount: backup.length,
      cleanedLeadCount: cleanedLeads.length,
      duplicateClustersMerged: mergedClusters.length,
      duplicateRowsRemoved: backup.length - cleanedLeads.length,
      reportFile: REPORT_FILE,
      summaryFile: SUMMARY_FILE
    }, null, 2));
  } finally {
    await client.close();
  }
}

await main();
