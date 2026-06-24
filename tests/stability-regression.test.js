const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function getNamedFunctionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} should exist`);

  let braceIndex = source.indexOf("{", start);
  assert.notEqual(braceIndex, -1, `${name} should have a body`);

  let depth = 0;
  for (let index = braceIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  assert.fail(`Could not extract ${name}`);
}

function countMatches(source, pattern) {
  return Array.from(source.matchAll(pattern)).length;
}

function getFunctionBody(source, name) {
  const start = source.indexOf(`async function ${name}`);
  assert.notEqual(start, -1, `${name} should exist`);
  const nextFunction = source.indexOf("\nfunction ", start + 1);
  const nextAsyncFunction = source.indexOf("\nasync function ", start + 1);
  const candidates = [nextFunction, nextAsyncFunction].filter((index) => index !== -1);
  const end = candidates.length ? Math.min(...candidates) : source.length;
  return source.slice(start, end);
}

test("Meta active handler names are single-source", () => {
  const server = read("server.js");

  assert.equal(countMatches(server, /async function processMetaWebhookPayload\(/g), 1);
  assert.equal(countMatches(server, /async function assignCounselorRoundRobin\(/g), 1);
});

test("shared state endpoints require a session or role", () => {
  const server = read("server.js");

  assert.match(getFunctionBody(server, "requireSession"), /getSessionFromRequest/);
  assert.match(server, /app\.get\("\/api\/state"[\s\S]*?requireSession/);
  assert.match(server, /app\.put\("\/api\/state"[\s\S]*?requireRole\(req, res, \["admin", "counselor"\]/);
  assert.match(server, /session\.role === "counselor"[\s\S]*?field !== "tasks"/);
  assert.match(server, /app\.put\("\/api\/state\/reset"[\s\S]*?requireRole\(req, res, "admin"\)/);
});

test("admin sessions are invalidated when configured admin credentials change", () => {
  const server = read("server.js");

  assert.match(server, /function buildAdminAuthVersion\(/);
  assert.match(server, /const ADMIN_AUTH_VERSION = buildAdminAuthVersion\(\)/);
  assert.match(server, /cached\.role === "admin" && cached\.adminAuthVersion !== ADMIN_AUTH_VERSION/);
  assert.match(server, /sessionDoc\.adminAuthVersion/);
  assert.match(server, /storedAdminAuthVersion !== ADMIN_AUTH_VERSION/);
  assert.match(server, /normalized\.role === "admin" \? \{ adminAuthVersion: ADMIN_AUTH_VERSION \} : \{\}/);
});

test("lead activity saves use atomic lead-service calls on workshop pages", () => {
  const preWorkshop = read("pre-workshop.js");
  const postWorkshop = read("post-workshop.js");

  assert.match(preWorkshop, /updateLeadActivity as updateLeadActivityOnServer/);
  assert.match(postWorkshop, /updateLeadActivity as updateLeadActivityOnServer/);
  assert.doesNotMatch(getFunctionBody(preWorkshop, "updateLeadActivity"), /saveAllLeads\(allLeads\)/);
  assert.doesNotMatch(getFunctionBody(postWorkshop, "updatePostActivity"), /saveAllLeads\(allLeads\)/);
});

test("bulk delete preserves leads outside the current filtered table", () => {
  const preWorkshop = read("pre-workshop.js");
  const postWorkshop = read("post-workshop.js");

  assert.match(getFunctionBody(preWorkshop, "deleteSelectedLeads"), /const allLeads = getAllLeads\(\)/);
  assert.match(getFunctionBody(postWorkshop, "deleteSelectedLeads"), /const allLeads = getAllLeads\(\)/);
  assert.match(preWorkshop, /buildLeadSelectionKey/);
  assert.match(postWorkshop, /buildLeadSelectionKey/);
});

test("bulk assignment uses full lead identity references", () => {
  const preWorkshop = read("pre-workshop.js");
  const postWorkshop = read("post-workshop.js");
  const leadService = read("lead-service.js");
  const server = read("server.js");

  assert.match(preWorkshop, /buildLeadSelectionRef/);
  assert.match(postWorkshop, /buildLeadSelectionRef/);
  assert.match(leadService, /JSON\.stringify\(\{ leadRefs, counselor \}\)/);
  assert.match(server, /buildLeadIdentityMatchConditions/);
  assert.match(server, /const leadRefs = Array\.isArray\(req\.body\?\.leadRefs\)/);
});

test("lead-control includes smart assignment suggestion panel", () => {
  const leadControlHtml = read("lead-control.html");
  const leadControl = read("lead-control.js");
  const styles = read("styles.css");

  assert.match(leadControlHtml, /applyAllAssignmentSuggestionsBtn/);
  assert.match(leadControl, /function renderAssignmentSuggestionPanel/);
  assert.match(leadControl, /function applyAllAssignmentSuggestions/);
  assert.match(leadControl, /function getOverallLeadBalanceData/);
  assert.match(leadControl, /Total Reassignments/);
  assert.match(leadControl, /isUntouchedLead\(lead\)/);
  assert.match(leadControl, /externalTouchedWorkshopCounts/);
  assert.match(leadControl, /suggestion\.workshopName/);
  assert.match(styles, /\.suggestion-overview/);
  assert.match(leadControl, /validateBalancedSuggestionTargets/);
  assert.match(leadControl, /validateSuggestionOutcome/);
  assert.doesNotMatch(leadControl, /buildBestEffortBalanceData/);
});

test("smart assignment extra-slot planning stays balanced when touched leads force mandatory extras", async () => {
  const leadControl = read("lead-control.js");
  const source = [
    getNamedFunctionSource(leadControl, "assignWorkshopExtraSlots"),
    getNamedFunctionSource(leadControl, "buildCounselorOptionalExtraTargetCandidates")
  ].join("\n\n");

  const factory = new Function(`${source}; return { assignWorkshopExtraSlots, buildCounselorOptionalExtraTargetCandidates };`);
  const { assignWorkshopExtraSlots, buildCounselorOptionalExtraTargetCandidates } = factory();

  const activeCounselors = ["Bhavya", "Margesh", "Shubhashree"];
  const workshopConfigs = [
    {
      workshopName: "W1",
      remainingExtras: 0,
      baseTarget: 1,
      touchedCounts: new Map(activeCounselors.map((name) => [name, 0])),
      mandatoryExtras: new Map([["Bhavya", 1], ["Margesh", 0], ["Shubhashree", 0]])
    },
    {
      workshopName: "W2",
      remainingExtras: 0,
      baseTarget: 1,
      touchedCounts: new Map(activeCounselors.map((name) => [name, 0])),
      mandatoryExtras: new Map([["Bhavya", 1], ["Margesh", 0], ["Shubhashree", 0]])
    },
    ...["W3", "W4", "W5", "W6"].map((workshopName) => ({
      workshopName,
      remainingExtras: 1,
      baseTarget: 1,
      touchedCounts: new Map(activeCounselors.map((name) => [name, 0])),
      mandatoryExtras: new Map(activeCounselors.map((name) => [name, 0]))
    }))
  ];

  const candidates = buildCounselorOptionalExtraTargetCandidates(workshopConfigs, activeCounselors, 6);
  assert.ok(candidates.length > 0, "should produce at least one balanced optional target plan");

  const optionalAssignments = candidates
    .map((candidate) => assignWorkshopExtraSlots(workshopConfigs, activeCounselors, candidate))
    .find(Boolean);

  assert.ok(optionalAssignments, "should find a feasible optional assignment plan");

  const finalExtras = new Map(activeCounselors.map((name) => [name, 0]));
  workshopConfigs.forEach((config) => {
    activeCounselors.forEach((counselorName) => {
      const mandatory = config.mandatoryExtras.get(counselorName) || 0;
      const optional = optionalAssignments.get(config.workshopName)?.get(counselorName) || 0;
      finalExtras.set(counselorName, finalExtras.get(counselorName) + mandatory + optional);
    });
  });

  assert.deepEqual(
    Object.fromEntries(activeCounselors.map((name) => [name, finalExtras.get(name)])),
    {
      Bhavya: 2,
      Margesh: 2,
      Shubhashree: 2
    }
  );
});

test("lead imports reject duplicates instead of merging", () => {
  const leadControl = read("lead-control.js");
  const server = read("server.js");

  assert.match(leadControl, /leadIndexByPhone/);
  assert.match(leadControl, /normalizeDuplicatePhone/);
  assert.match(leadControl, /Duplicate .* already exists/);
  assert.doesNotMatch(getFunctionBody(leadControl, "handleLeadImport"), /mergeImportedLead\(/);
  assert.match(server, /findLeadDuplicateViolation/);
  assert.match(server, /findDuplicateLeadByEmailOrPhone/);
  assert.match(server, /function normalizeLeadPhone/);
  assert.match(server, /Duplicate lead rejected: \$\{duplicateViolation\.field\} already exists\./);
});

test("public course registrations keep master CRM leads and independently refresh registered-section entries", () => {
  const server = read("server.js");
  const courses = read("courses.js");

  assert.match(server, /alreadyRegistered: true/);
  assert.match(server, /You have already registered for this course\./);
  assert.match(server, /isPublicCourseRegistrationLead/);
  assert.match(server, /publicCourseLeadMatchesCourse/);
  assert.match(server, /const masterLead = findDuplicateNonRegisteredLeadByEmailOrPhone/);
  assert.match(server, /const existingRegisteredLead = findDuplicateRegisteredLeadByEmailOrPhone/);
  assert.match(server, /const counselorSourceLead = masterLead \|\| existingRegisteredLead \|\| null/);
  assert.match(server, /const counselorName = String\(counselorSourceLead\?\.counselor \|\| ""\)\.trim\(\) \|\| await assignPublicCourseCounselorRoundRobin/);
  assert.match(server, /const shouldReplaceExistingRegisteredLead = !!existingRegisteredLead && !isSameRegisteredCourse/);
  assert.match(server, /leadsCollection\.deleteOne\(\{ id: \{ \$in: leadIdCandidates \} \}\)/);
  assert.match(server, /tasksCollection\.deleteMany\(\{ leadId: \{ \$in: leadIdCandidates\.map\(\(value\) => String\(value\)\) \} \}\)/);
  assert.match(server, /linked to existing CRM lead/);
  assert.match(server, /updated registered section/);
  assert.match(server, /function isAllowedRegisteredLeadDuplicateGroup/);
  assert.match(server, /function findDuplicateNonRegisteredLeadByEmailOrPhone/);
  assert.match(server, /function findDuplicateRegisteredLeadByEmailOrPhone/);
  assert.match(server, /if \(digits\.length === 12 && digits\.startsWith\("91"\)\)/);
  assert.match(server, /return digits\.slice\(-10\);/);
  assert.match(courses, /if \(data\?\.alreadyRegistered\)/);
  assert.match(courses, /setFormMessage\(data\?\.message \|\| "You have already registered for this course\.", false\)/);
});

test("meta duplicate blocking loads real leads and restore rejects duplicate snapshots", () => {
  const server = read("server.js");

  assert.match(server, /async function getMetaProcessingSnapshot\(\)/);
  assert.match(server, /leads: Array\.isArray\(cachedStateDoc\.leads\)/);
  assert.match(server, /Load Meta processing snapshot \(leads\)/);
  assert.match(server, /findDuplicateLeadByEmailOrPhone\(snapshot\.leads, newLead\)/);
  assert.match(server, /Restore blocked: duplicate \$\{duplicateViolation\.field\} already exists in the backup snapshot\./);
  assert.match(server, /createIndex\(\s*\{ metaLeadId: 1 \}/);
  assert.match(server, /createIndex\(\s*\{ normalizedEmail: 1 \}/);
  assert.match(server, /createIndex\(\s*\{ normalizedPhone: 1 \}/);
  assert.match(server, /function decorateLeadDuplicateKeys/);
});

test("task service uses atomic task endpoints", () => {
  const server = read("server.js");
  const taskService = read("task-service.js");

  assert.match(server, /app\.post\("\/api\/tasks"/);
  assert.match(server, /app\.patch\("\/api\/tasks\/:taskId"/);
  assert.match(server, /app\.delete\("\/api\/tasks\/:taskId"/);
  assert.doesNotMatch(taskService, /saveStoredTasks|saveTasks as saveStoredTasks/);
  assert.match(taskService, /requestJson\("\/api\/tasks"/);
});

test("workshop and admission filters support multiple selected values", () => {
  const preWorkshop = read("pre-workshop.js");
  const postWorkshop = read("post-workshop.js");
  const styles = read("styles.css");

  assert.match(preWorkshop, /function getSelectedFilterValues/);
  assert.match(postWorkshop, /function getSelectedFilterValues/);
  assert.match(preWorkshop, /renderMultiSelectControl/);
  assert.match(postWorkshop, /renderMultiSelectControl/);
  assert.match(preWorkshop, /data-filter-id="\$\{id\}"/);
  assert.match(postWorkshop, /data-filter-id="\$\{id\}"/);
  assert.match(preWorkshop, /SELECT_ALL_FILTER_VALUE/);
  assert.match(postWorkshop, /SELECT_ALL_FILTER_VALUE/);
  assert.match(preWorkshop, /Selected: \$\{selectedCount\}/);
  assert.match(postWorkshop, /Selected: \$\{selectedCount\}/);
  assert.match(styles, /\.multi-filter-menu/);
  assert.doesNotMatch(preWorkshop, /<select[^>]+multiple/);
  assert.doesNotMatch(postWorkshop, /<select[^>]+multiple/);
  assert.match(preWorkshop, /filterIncludesValue\(filter\.workshop, lead\.workshop\)/);
  assert.match(postWorkshop, /filterIncludesValue\(filter\.courseStatus, lead\.courseStatus\)/);
  assert.match(preWorkshop, /BLANK_FILTER_VALUE/);
  assert.match(postWorkshop, /BLANK_FILTER_VALUE/);
  assert.match(preWorkshop, /item === BLANK_FILTER_VALUE \? normalizedValue === ""/);
  assert.match(postWorkshop, /item === BLANK_FILTER_VALUE \? normalizedValue === ""/);
});

test("admission workshop override stays scoped to admission calling", () => {
  const preWorkshop = read("pre-workshop.js");
  const postWorkshop = read("post-workshop.js");
  const postWorkshopHtml = read("post-workshop.html");
  const monitoring = read("monitoring.js");
  const server = read("server.js");

  assert.match(postWorkshopHtml, /modalAdmissionWorkshop/);
  assert.match(postWorkshop, /function getAdmissionWorkshopName/);
  assert.match(postWorkshop, /admissionWorkshop: document\.getElementById\("modalAdmissionWorkshop"\)\.value/);
  assert.match(postWorkshop, /getAdmissionWorkshopName\(lead\)/);
  assert.match(monitoring, /function getAdmissionWorkshopName/);
  assert.match(monitoring, /formatAdmissionWorkshopBreakdown\(activityLeads\)/);
  assert.match(server, /"admissionWorkshop"/);
  assert.doesNotMatch(preWorkshop, /admissionWorkshop/);
});

test("workshop updated filter stays scoped to workshop activity", () => {
  const preWorkshop = getNamedFunctionSource(read("pre-workshop.js"), "getLeadActivityUpdateCount");

  assert.match(preWorkshop, /function getLeadActivityUpdateCount\(lead\)/);
  assert.match(preWorkshop, /workshopActivityHistory/);
  assert.match(preWorkshop, /preActivityUpdates/);
  assert.doesNotMatch(preWorkshop, /admissionActivityHistory/);
  assert.doesNotMatch(preWorkshop, /postActivityUpdates/);
});

test("lead action buttons escape lead ids before binding click handlers", () => {
  const preWorkshop = read("pre-workshop.js");
  const postWorkshop = read("post-workshop.js");
  const leadService = read("lead-service.js");

  assert.match(preWorkshop, /const leadId = escapeHtml\(lead\.id\)/);
  assert.match(postWorkshop, /const leadId = escapeHtml\(lead\.id\)/);
  assert.match(preWorkshop, /data-lead-email="\$\{leadEmail\}"/);
  assert.match(postWorkshop, /data-lead-email="\$\{leadEmail\}"/);
  assert.match(leadService, /leadEmail/);
  assert.doesNotMatch(preWorkshop, /data-lead-id="\$\{lead\.id\}"/);
  assert.doesNotMatch(postWorkshop, /data-lead-id="\$\{lead\.id\}"/);
  assert.match(preWorkshop, /Could not open this lead/);
  assert.match(postWorkshop, /Could not open this lead/);
});

test("admin manual backup and restore controls exist on lead control management", () => {
  const leadControlHtml = read("lead-control.html");
  const leadControl = read("lead-control.js");
  const server = read("server.js");

  assert.match(leadControlHtml, /exportBackupBtn/);
  assert.match(leadControlHtml, /restoreBackupFile/);
  assert.match(leadControlHtml, /restoreBackupBtn/);
  assert.match(leadControl, /function downloadManualBackup\(/);
  assert.match(leadControl, /function restoreManualBackup\(/);
  assert.match(leadControl, /apiUrl\("\/api\/admin\/backup"\)/);
  assert.match(leadControl, /apiUrl\("\/api\/admin\/restore"\)/);
  assert.match(server, /const BACKUP_FORMAT = "dv-crm-manual-backup"/);
  assert.match(server, /app\.get\("\/api\/admin\/backup"/);
  assert.match(server, /app\.post\("\/api\/admin\/restore"/);
  assert.match(server, /buildBackupPayload\(/);
  assert.match(server, /validateBackupPayload\(/);
});

test("activity history endpoint and UI checks", () => {
  const server = read("server.js");
  const preWorkshop = read("pre-workshop.js");
  const postWorkshop = read("post-workshop.js");
  const registered = read("registered-candidates.js");
  const styles = read("styles.css");
  const activityHistory = read("activity-history.js");

  // Server assertions
  assert.match(server, /activityLogsCollection/);
  assert.match(server, /app\.get\("\/api\/activity-logs"/);
  assert.match(server, /async function recordActivity\(/);
  assert.match(server, /async function logBulkLeadChanges\(/);

  // Frontend imports assertions
  assert.match(preWorkshop, /import \{ openActivityHistory \} from "\.\/activity-history\.js"/);
  assert.match(postWorkshop, /import \{ openActivityHistory \} from "\.\/activity-history\.js"/);
  assert.match(registered, /import \{ openActivityHistory \} from "\.\/activity-history\.js"/);

  // Reusable timeline assertions
  assert.match(activityHistory, /export function openActivityHistory\(/);
  assert.match(activityHistory, /fetchActivityLogs\(/);
  assert.match(activityHistory, /activityHistoryModal/);

  // Styles assertions
  assert.match(styles, /\.timeline-modal/);
  assert.match(styles, /\.timeline-track/);
  assert.match(styles, /\.timeline-badge/);
});
