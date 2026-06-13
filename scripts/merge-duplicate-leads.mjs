import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { MongoClient } from "mongodb";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const OUTPUT_DIR = path.resolve("outputs", "duplicate-merge");
const BACKUP_FILE = path.join(OUTPUT_DIR, "leads-before-merge.json");
const SUMMARY_FILE = path.join(OUTPUT_DIR, "duplicate-merge-summary.json");
const REPORT_FILE = path.join(OUTPUT_DIR, "duplicate-merge-report.xlsx");
const STATE_DOC_ID = "global";

function normalizePhone(value) {
  return String(value || "").replace(/\D+/g, "").trim();
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeText(value) {
  return String(value || "").trim();
}

function counselorIsAssigned(value) {
  const counselor = normalizeText(value).toLowerCase();
  return counselor && counselor !== "unassigned";
}

function getWorkshopHistoryCount(lead) {
  if (Array.isArray(lead?.workshopActivityHistory)) {
    return lead.workshopActivityHistory.length;
  }
  return Number(lead?.preActivityUpdates) || 0;
}

function getAdmissionHistoryCount(lead) {
  if (Array.isArray(lead?.admissionActivityHistory)) {
    return lead.admissionActivityHistory.length;
  }
  return Number(lead?.postActivityUpdates) || 0;
}

function getActivityScore(lead) {
  return getWorkshopHistoryCount(lead)
    + getAdmissionHistoryCount(lead)
    + (Array.isArray(lead?.leadNotes) ? lead.leadNotes.length : 0);
}

function parseCreatedAt(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? Number.MAX_SAFE_INTEGER : date.getTime();
}

function createAdjacency(leads) {
  const phoneMap = new Map();
  const emailMap = new Map();

  for (const lead of leads) {
    const id = String(lead.id);
    const phone = normalizePhone(lead.phone);
    const email = normalizeEmail(lead.email);
    if (phone) {
      if (!phoneMap.has(phone)) phoneMap.set(phone, []);
      phoneMap.get(phone).push(id);
    }
    if (email) {
      if (!emailMap.has(email)) emailMap.set(email, []);
      emailMap.get(email).push(id);
    }
  }

  const adjacency = new Map(leads.map((lead) => [String(lead.id), new Set()]));
  const connectGroup = (group) => {
    if (group.length < 2) return;
    for (const id of group) {
      const edges = adjacency.get(id);
      for (const otherId of group) {
        if (otherId !== id) edges.add(otherId);
      }
    }
  };

  for (const group of phoneMap.values()) connectGroup(group);
  for (const group of emailMap.values()) connectGroup(group);

  return { adjacency, phoneMap, emailMap };
}

function buildDuplicateClusters(leads) {
  const { adjacency, phoneMap, emailMap } = createAdjacency(leads);
  const byId = new Map(leads.map((lead) => [String(lead.id), lead]));
  const visited = new Set();
  const clusters = [];

  for (const lead of leads) {
    const startId = String(lead.id);
    if (visited.has(startId)) continue;

    const queue = [startId];
    const componentIds = [];
    visited.add(startId);

    while (queue.length) {
      const currentId = queue.shift();
      componentIds.push(currentId);
      for (const nextId of adjacency.get(currentId) || []) {
        if (!visited.has(nextId)) {
          visited.add(nextId);
          queue.push(nextId);
        }
      }
    }

    if (componentIds.length > 1) {
      const componentLeads = componentIds
        .map((id) => byId.get(id))
        .filter(Boolean);
      clusters.push({
        leads: componentLeads,
        duplicatePhones: [...new Set(componentLeads.map((item) => normalizePhone(item.phone)).filter(Boolean))]
          .filter((phone) => (phoneMap.get(phone) || []).length > 1),
        duplicateEmails: [...new Set(componentLeads.map((item) => normalizeEmail(item.email)).filter(Boolean))]
          .filter((email) => (emailMap.get(email) || []).length > 1)
      });
    }
  }

  return clusters;
}

function uniqueByJson(items) {
  const seen = new Set();
  const result = [];
  for (const item of Array.isArray(items) ? items : []) {
    const key = JSON.stringify(item || {});
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}

function mergeStringArrayValues(...sources) {
  return [...new Set(
    sources.flatMap((value) => Array.isArray(value) ? value : [value])
      .map((item) => String(item || "").trim())
      .filter(Boolean)
  )];
}

function chooseMasterLead(leads) {
  return [...leads].sort((left, right) => {
    const activityCompare = getActivityScore(right) - getActivityScore(left);
    if (activityCompare !== 0) return activityCompare;

    const leftAssigned = counselorIsAssigned(left.counselor) ? 1 : 0;
    const rightAssigned = counselorIsAssigned(right.counselor) ? 1 : 0;
    if (rightAssigned !== leftAssigned) return rightAssigned - leftAssigned;

    const createdCompare = parseCreatedAt(left.createdAt) - parseCreatedAt(right.createdAt);
    if (createdCompare !== 0) return createdCompare;

    return (Number(left.id) || 0) - (Number(right.id) || 0);
  })[0];
}

function fillFirstNonEmpty(target, candidates, field) {
  if (normalizeText(target[field])) return target[field];
  for (const candidate of candidates) {
    if (normalizeText(candidate[field])) {
      return candidate[field];
    }
  }
  return target[field] || "";
}

function buildMergedLead(cluster, mergedAt) {
  const master = chooseMasterLead(cluster.leads);
  const donors = cluster.leads.filter((lead) => String(lead.id) !== String(master.id));
  const ordered = [master, ...donors];

  const merged = { ...master };
  merged.name = fillFirstNonEmpty(merged, ordered, "name");
  merged.email = fillFirstNonEmpty(merged, ordered, "email");
  merged.phone = fillFirstNonEmpty(merged, ordered, "phone");
  merged.workshop = fillFirstNonEmpty(merged, ordered, "workshop");
  merged.status = fillFirstNonEmpty(merged, ordered, "status");
  merged.source = fillFirstNonEmpty(merged, ordered, "source");
  merged.metaLeadId = fillFirstNonEmpty(merged, ordered, "metaLeadId");
  merged.metaFormId = fillFirstNonEmpty(merged, ordered, "metaFormId");
  merged.metaAdId = fillFirstNonEmpty(merged, ordered, "metaAdId");
  merged.metaAdName = fillFirstNonEmpty(merged, ordered, "metaAdName");
  merged.metaAdsetName = fillFirstNonEmpty(merged, ordered, "metaAdsetName");
  merged.metaCampaignName = fillFirstNonEmpty(merged, ordered, "metaCampaignName");
  merged.admissionWorkshop = fillFirstNonEmpty(merged, ordered, "admissionWorkshop");

  if (!counselorIsAssigned(merged.counselor)) {
    const counselorSource = ordered.find((lead) => counselorIsAssigned(lead.counselor));
    if (counselorSource) merged.counselor = counselorSource.counselor;
  }

  const workshopHistory = uniqueByJson(ordered.flatMap((lead) => lead.workshopActivityHistory || []))
    .sort((a, b) => String(a?.at || "").localeCompare(String(b?.at || "")));
  const admissionHistory = uniqueByJson(ordered.flatMap((lead) => lead.admissionActivityHistory || []))
    .sort((a, b) => String(a?.at || "").localeCompare(String(b?.at || "")));
  const notes = uniqueByJson(ordered.flatMap((lead) => lead.leadNotes || []))
    .sort((a, b) => String(a?.at || "").localeCompare(String(b?.at || "")));

  merged.workshopActivityHistory = workshopHistory;
  merged.admissionActivityHistory = admissionHistory;
  merged.leadNotes = notes;
  merged.preActivityUpdates = workshopHistory.length;
  merged.postActivityUpdates = admissionHistory.length;
  merged.postStatusUpdated = ordered.some((lead) => !!lead.postStatusUpdated);

  if (!normalizeText(merged.whatsappGroupStatus)) {
    const joinedLead = ordered.find((lead) => normalizeText(lead.whatsappGroupStatus).toLowerCase() === "joined");
    const notJoinedLead = ordered.find((lead) => normalizeText(lead.whatsappGroupStatus).toLowerCase() === "not joined");
    merged.whatsappGroupStatus = joinedLead?.whatsappGroupStatus || notJoinedLead?.whatsappGroupStatus || "";
  }

  if (!normalizeText(merged.whatsappInvite)) {
    const inviteLead = ordered.find((lead) => normalizeText(lead.whatsappInvite).toLowerCase() === "yes");
    merged.whatsappInvite = inviteLead?.whatsappInvite || merged.whatsappInvite || "";
  }

  merged.importSourceFiles = mergeStringArrayValues(...ordered.map((lead) => lead.importSourceFiles || []));
  merged.importSourceSheets = mergeStringArrayValues(...ordered.map((lead) => lead.importSourceSheets || []));
  merged.mergedLeadIds = ordered.map((lead) => lead.id);
  merged.mergedCounselors = mergeStringArrayValues(...ordered.map((lead) => lead.counselor));
  merged.duplicateWorkshops = mergeStringArrayValues(...ordered.map((lead) => lead.workshop));
  merged.mergedMetaLeadIds = mergeStringArrayValues(...ordered.map((lead) => lead.metaLeadId));
  merged.lastMergedAt = mergedAt;

  const normalizedEmail = normalizeEmail(merged.email);
  const normalizedPhone = normalizePhone(merged.phone);
  if (normalizedEmail) {
    merged.normalizedEmail = normalizedEmail;
  } else {
    delete merged.normalizedEmail;
  }
  if (normalizedPhone) {
    merged.normalizedPhone = normalizedPhone;
  } else {
    delete merged.normalizedPhone;
  }

  return { master, donors, merged };
}

function findRemainingDuplicates(leads) {
  const phoneMap = new Map();
  const emailMap = new Map();

  for (const lead of leads) {
    const phone = normalizePhone(lead.phone);
    const email = normalizeEmail(lead.email);
    if (phone) {
      if (!phoneMap.has(phone)) phoneMap.set(phone, []);
      phoneMap.get(phone).push(lead.id);
    }
    if (email) {
      if (!emailMap.has(email)) emailMap.set(email, []);
      emailMap.get(email).push(lead.id);
    }
  }

  return {
    phoneGroups: [...phoneMap.entries()].filter(([, ids]) => ids.length > 1),
    emailGroups: [...emailMap.entries()].filter(([, ids]) => ids.length > 1)
  };
}

function toCsvValue(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

async function writeAuditWorkbook(rows) {
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
    "Merged Created At",
    "Duplicate Phones",
    "Duplicate Emails"
  ];

  const csvText = [
    headers.map(toCsvValue).join(","),
    ...rows.map((row) => row.map(toCsvValue).join(","))
  ].join("\n");

  const workbook = await Workbook.fromCSV(csvText, { sheetName: "Merge Report" });
  const output = await SpreadsheetFile.exportXlsx(workbook);
  await output.save(REPORT_FILE);
}

async function resolveBackupPath() {
  try {
    await fs.access(BACKUP_FILE);
    return path.join(
      OUTPUT_DIR,
      `leads-before-merge-rerun-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
    );
  } catch {
    return BACKUP_FILE;
  }
}

async function main() {
  if (!process.env.MONGODB_URI) {
    throw new Error("Missing MONGODB_URI.");
  }

  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const client = new MongoClient(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 15000
  });
  await client.connect();

  try {
    const db = client.db(process.env.MONGODB_DB_NAME || "i-crm-workshop");
    const leadsCollection = db.collection("leads");
    const stateCollection = db.collection(process.env.MONGODB_STATE_COLLECTION || "app_state");
    const metaConfigCollection = db.collection(process.env.MONGODB_META_CONFIG_COLLECTION || "meta_config");

    const leads = await leadsCollection.find({}).toArray();
    const backupPath = await resolveBackupPath();
    await fs.writeFile(backupPath, JSON.stringify(leads, null, 2), "utf8");

    const clusters = buildDuplicateClusters(leads);
    const mergedAt = new Date().toISOString();
    const leadIdsToDrop = new Set();
    const replacementById = new Map();
    const reportRows = [];
    const summary = [];

    for (const [index, cluster] of clusters.entries()) {
      const { master, donors, merged } = buildMergedLead(cluster, mergedAt);
      replacementById.set(String(master.id), merged);
      donors.forEach((lead) => leadIdsToDrop.add(String(lead.id)));

      summary.push({
        cluster: index + 1,
        keptLeadId: master.id,
        mergedLeadIds: donors.map((lead) => lead.id),
        keptCounselor: merged.counselor || "",
        mergedCounselors: merged.mergedCounselors,
        duplicatePhones: cluster.duplicatePhones,
        duplicateEmails: cluster.duplicateEmails
      });

      for (const donor of donors) {
        reportRows.push([
          index + 1,
          "Merged into master",
          master.id,
          donor.id,
          merged.counselor || "",
          donor.counselor || "",
          merged.workshop || "",
          donor.workshop || "",
          merged.email || "",
          donor.email || "",
          merged.phone || "",
          donor.phone || "",
          merged.createdAt || "",
          donor.createdAt || "",
          cluster.duplicatePhones.join(" | "),
          cluster.duplicateEmails.join(" | ")
        ]);
      }
    }

    const cleanedLeads = leads
      .filter((lead) => !leadIdsToDrop.has(String(lead.id)))
      .map((lead) => replacementById.get(String(lead.id)) || lead)
      .map((lead) => {
        const normalizedEmail = normalizeEmail(lead.email);
        const normalizedPhone = normalizePhone(lead.phone);
        const nextLead = { ...lead };
        const metaLeadId = normalizeText(lead.metaLeadId);
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
      });

    const remaining = findRemainingDuplicates(cleanedLeads);
    if (remaining.phoneGroups.length || remaining.emailGroups.length) {
      throw new Error(`Cleanup aborted because duplicates still remain in-memory (phone groups: ${remaining.phoneGroups.length}, email groups: ${remaining.emailGroups.length}).`);
    }

    await leadsCollection.deleteMany({});
    if (cleanedLeads.length) {
      await leadsCollection.insertMany(cleanedLeads, { ordered: true });
    }

    await leadsCollection.createIndex(
      { metaLeadId: 1 },
      {
        unique: true,
        background: true,
        partialFilterExpression: { metaLeadId: { $exists: true, $type: "string" } }
      }
    ).catch(() => undefined);
    await leadsCollection.createIndex(
      { normalizedEmail: 1 },
      {
        unique: true,
        background: true,
        partialFilterExpression: { normalizedEmail: { $exists: true, $type: "string" } }
      }
    );
    await leadsCollection.createIndex(
      { normalizedPhone: 1 },
      {
        unique: true,
        background: true,
        partialFilterExpression: { normalizedPhone: { $exists: true, $type: "string" } }
      }
    );

    await stateCollection.updateOne(
      { _id: STATE_DOC_ID },
      { $set: { updatedAt: mergedAt } },
      { upsert: true }
    );

    const maxLeadId = cleanedLeads.reduce((max, lead) => Math.max(max, Number(lead.id) || 0), 0);
    if (maxLeadId > 0) {
      await metaConfigCollection.updateOne(
        { _id: "meta_integration" },
        { $max: { leadSequence: maxLeadId } },
        { upsert: true }
      ).catch(() => undefined);
    }

    await writeAuditWorkbook(reportRows);
    await fs.writeFile(SUMMARY_FILE, JSON.stringify({
      mergedAt,
      originalLeadCount: leads.length,
      cleanedLeadCount: cleanedLeads.length,
      duplicateClustersMerged: clusters.length,
      duplicateRowsRemoved: leadIdsToDrop.size,
      summary
    }, null, 2), "utf8");

    const verificationLeads = await leadsCollection.find({}, {
      projection: { _id: 0, id: 1, normalizedEmail: 1, normalizedPhone: 1 }
    }).toArray();
    const verification = findRemainingDuplicates(verificationLeads);
    if (verification.phoneGroups.length || verification.emailGroups.length) {
      throw new Error(`Post-write verification failed (phone groups: ${verification.phoneGroups.length}, email groups: ${verification.emailGroups.length}).`);
    }

    console.log(JSON.stringify({
      backupFile: backupPath,
      summaryFile: SUMMARY_FILE,
      reportFile: REPORT_FILE,
      originalLeadCount: leads.length,
      cleanedLeadCount: cleanedLeads.length,
      duplicateClustersMerged: clusters.length,
      duplicateRowsRemoved: leadIdsToDrop.size,
      remainingPhoneDuplicateGroups: verification.phoneGroups.length,
      remainingEmailDuplicateGroups: verification.emailGroups.length
    }, null, 2));
  } finally {
    await client.close();
  }
}

await main();
