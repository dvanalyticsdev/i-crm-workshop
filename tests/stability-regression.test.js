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

  const paramsEnd = source.indexOf(")", start);
  assert.notEqual(paramsEnd, -1, `${name} should have parameters`);

  let braceIndex = source.indexOf("{", paramsEnd);
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

function getConstDeclaration(source, name) {
  const start = source.indexOf(`const ${name} = [`);
  assert.notEqual(start, -1, `${name} should exist`);
  const end = source.indexOf("\n];", start);
  assert.notEqual(end, -1, `${name} should have an array declaration`);
  return source.slice(start, end + 3);
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
  const leadService = read("lead-service.js");
  const server = read("server.js");

  assert.match(preWorkshop, /deleteLeads as deleteLeadsOnServer/);
  assert.match(postWorkshop, /deleteLeads as deleteLeadsOnServer/);
  assert.match(getFunctionBody(preWorkshop, "deleteLead"), /deleteLeadsOnServer\(\[buildLeadSelectionRef/);
  assert.match(getFunctionBody(postWorkshop, "deleteLead"), /deleteLeadsOnServer\(\[buildLeadSelectionRef/);
  assert.match(getFunctionBody(preWorkshop, "deleteSelectedLeads"), /deleteLeadsOnServer\(deleteRefs\)/);
  assert.match(getFunctionBody(postWorkshop, "deleteSelectedLeads"), /deleteLeadsOnServer\(deleteRefs\)/);
  assert.doesNotMatch(getFunctionBody(preWorkshop, "deleteSelectedLeads"), /saveAllLeads/);
  assert.doesNotMatch(getFunctionBody(postWorkshop, "deleteSelectedLeads"), /saveAllLeads/);
  assert.match(leadService, /export function deleteLeads/);
  assert.match(server, /app\.delete\("\/api\/leads"/);
  assert.match(server, /buildLiveLeadIdentityMatchConditions/);
  assert.match(server, /const idQuery = buildLiveLeadIdQuery\(leadRefs\)/);
  assert.match(server, /leadsToDelete = await leadsCollection\.find\(idQuery\)\.toArray\(\)/);
  assert.match(server, /tasksCollection\.deleteMany\(\{ leadId: \{ \$in: deletedLeadIds \} \}\)/);
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
  assert.match(server, /buildLiveLeadIdQuery/);
  assert.match(server, /const leadRefs = Array\.isArray\(req\.body\?\.leadRefs\)/);
  assert.match(server, /app\.patch\("\/api\/leads\/assignment", assignLeadsHandler\)/);
  assert.match(server, /app\.post\("\/api\/leads\/assignment", assignLeadsHandler\)/);
  assert.match(server, /result\.matchedCount/);
});

test("bulk assignment skips protected admission-status leads", () => {
  const mainAdmissionLeads = read("main-admission-leads.js");
  const registeredCandidates = read("registered-candidates.js");
  const preWorkshop = read("pre-workshop.js");
  const postWorkshop = read("post-workshop.js");
  const leadControl = read("lead-control.js");
  const leadService = read("lead-service.js");
  const server = read("server.js");

  assert.match(server, /PROTECTED_ASSIGNMENT_ADMISSION_STATUSES = new Set\(\["inconversation", "enrolled", "won"\]\)/);
  assert.match(server, /function isLeadProtectedFromBulkAssignment\(lead\)/);
  assert.match(server, /lead\?\.admissionStatus/);
  assert.match(server, /lead\?\.registeredAdmissionStatus/);
  assert.match(server, /lead\?\.mainAdmissionAdmissionStatus/);
  assert.match(getFunctionBody(server, "assignLeadsHandler"), /const protectedLeads = leadsToUpdate\.filter\(isLeadProtectedFromBulkAssignment\)/);
  assert.match(getFunctionBody(server, "assignLeadsHandler"), /const assignableLeads = leadsToUpdate\.filter\(\(lead\) => !isLeadProtectedFromBulkAssignment\(lead\)\)/);
  assert.match(getFunctionBody(server, "assignLeadsHandler"), /skippedProtectedCount/);
  assert.match(getFunctionBody(server, "assignLeadsHandler"), /for \(const lead of assignableLeads\)/);
  assert.match(leadService, /export function formatLeadAssignmentResult/);
  assert.match(leadService, /Skipped \$\{skippedProtectedCount\} admission/);
  assert.match(mainAdmissionLeads, /formatLeadAssignmentResult/);
  assert.match(registeredCandidates, /formatLeadAssignmentResult/);
  assert.match(preWorkshop, /formatLeadAssignmentResult/);
  assert.match(postWorkshop, /formatLeadAssignmentResult/);
  assert.match(leadControl, /formatLeadAssignmentResult/);
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

test("workshop re-entries migrate existing CRM leads into a fresh new-workshop state", () => {
  const server = read("server.js");

  assert.match(server, /function normalizeWorkshopName\(/);
  assert.match(server, /function isSameWorkshopLead\(/);
  assert.match(server, /function buildWorkshopMigrationSnapshot\(/);
  assert.match(server, /function buildFreshWorkshopLead\(/);
  assert.match(server, /async function replaceWorkshopLeadWithFreshLead\(/);
  assert.match(server, /workshopMigrationHistory/);
  assert.match(server, /leadNotes: \[\]/);
  assert.match(server, /workshopActivityHistory: \[\]/);
  assert.match(server, /admissionActivityHistory: \[\]/);
  assert.match(server, /tasksCollection\.deleteMany\(\{ leadId: \{ \$in: leadIdCandidates\.map\(\(value\) => String\(value\)\) \} \}\)/);
  assert.match(server, /activityType: "Lead Re-entered"/);
  assert.match(server, /Lead moved from \$\{String\(existingLead\?\.workshop \|\| "Unknown workshop"\)/);
});

test("public course registrations keep master CRM leads and independently refresh registered-section entries", () => {
  const server = read("server.js");
  const courses = read("courses.js");
  const registeredCandidates = read("registered-candidates.js");

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
  assert.match(server, /const isConfigured = typeof preference\?\.value\?\.isConfigured === "boolean"/);
  assert.match(server, /const activeCounselors = routingConfig\.isConfigured/);
  assert.match(courses, /if \(data\?\.alreadyRegistered\)/);
  assert.match(courses, /setFormMessage\(data\?\.message \|\| "You have already registered for this course\.", false\)/);
  assert.match(registeredCandidates, /let registeredRoutingConfig = \{ selectedCounselors: \[\], isConfigured: false \};/);
  assert.match(registeredCandidates, /if \(registeredRoutingConfig\.isConfigured\) \{\s*return validSelected;\s*\}/);
});

test("meta duplicate handling migrates new-workshop re-entries and restore still rejects invalid duplicate snapshots", () => {
  const server = read("server.js");

  assert.match(server, /async function getMetaProcessingSnapshot\(\)/);
  assert.match(server, /leads: Array\.isArray\(cachedStateDoc\.leads\)/);
  assert.match(server, /Load Meta processing snapshot \(leads\)/);
  assert.match(server, /findDuplicateLeadByEmailOrPhone\(snapshot\.leads, newLead\)/);
  assert.match(server, /!isPublicCourseRegistrationLead\(duplicateLead\) && !isSameWorkshopLead\(duplicateLead, newLead\)/);
  assert.match(server, /await replaceWorkshopLeadWithFreshLead\(duplicateLead, newLead, \{/);
  assert.match(server, /Delete migrated Meta retry job/);
  assert.match(server, /Duplicate lead blocked by \$\{duplicateField\} match/);
  assert.match(server, /Restore blocked: duplicate \$\{duplicateViolation\.field\} already exists in the backup snapshot\./);
  assert.match(server, /createIndex\(\s*\{ metaLeadId: 1 \}/);
  assert.match(server, /createIndex\(\s*\{ normalizedEmail: 1 \}/);
  assert.match(server, /createIndex\(\s*\{ normalizedPhone: 1 \}/);
  assert.match(server, /function decorateLeadDuplicateKeys/);
});

test("forwarded Meta webhooks carry an internal signature and do not rely only on the original Meta header", () => {
  const server = read("server.js");

  assert.match(server, /const FORWARDED_WEBHOOK_SIGNATURE_HEADER = "x-dv-webhook-signature"/);
  assert.match(server, /function signWebhookPayload\(rawBody, appSecret\)/);
  assert.match(server, /app\.use\("\/api\/meta\/webhook", express\.raw\(/);
  assert.match(server, /function parseMetaWebhookRequestBody\(req\)/);
  assert.match(server, /\[FORWARDED_WEBHOOK_SIGNATURE_HEADER\]: forwardedSignature/);
  assert.match(server, /const forwardedSig = req\.headers\?\.\[FORWARDED_WEBHOOK_SIGNATURE_HEADER\] \|\| ""/);
  assert.match(server, /const trustedForward = isForwarded/);
  assert.match(server, /Signature verification failed \(\$\{isForwarded \? "forwarded" : "direct"\} request; rawBody=\$\{rawBuf \? "present" : "missing"\}\)/);
  assert.match(server, /if \(!trustedForward && !trustedDirect\)/);
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

test("system update notice is a non-blocking header pill until clicked", () => {
  const layouts = read("layouts.js");
  const styles = read("styles.css");

  assert.match(layouts, /let isSystemUpdateAvailable = false/);
  assert.match(getFunctionBody(layouts, "checkSystemVersion"), /showUpdateAvailablePill\(\)/);
  assert.doesNotMatch(getFunctionBody(layouts, "checkSystemVersion"), /showUpdateModal\(\)/);
  assert.match(layouts, /id = "system-update-pill"/);
  assert.match(layouts, /pill\.addEventListener\("click", showUpdateModal\)/);
  assert.match(layouts, /showUpdateAvailablePill\(\{ notify: false \}\)/);
  assert.match(styles, /\.update-available-pill/);
  assert.match(styles, /\.update-modal-overlay/);
});

test("screen filters are browser-local and not shared through server preferences", () => {
  const stateSync = read("state-sync.js");
  const localPreferencePages = [
    "dashboard.js",
    "lost-leads.js",
    "monitoring.js",
    "pre-workshop.js",
    "post-workshop.js",
    "registered-candidates.js",
    "main-admission-leads.js"
  ];

  assert.match(stateSync, /export async function loadLocalPreference/);
  assert.match(stateSync, /export async function saveLocalPreference/);
  assert.match(stateSync, /window\.localStorage\.getItem\(`dvLocalPreference:\$\{scope\}`\)/);
  assert.match(stateSync, /window\.localStorage\.setItem\(`dvLocalPreference:\$\{scope\}`/);

  localPreferencePages.forEach((file) => {
    const source = read(file);
    assert.match(source, /loadLocalPreference/);
    assert.match(source, /saveLocalPreference/);
    assert.doesNotMatch(source, /loadPersistedValue/);
    assert.doesNotMatch(source, /savePersistedValue/);
  });
});

test("workshop and admission filters support multiple selected values", () => {
  const preWorkshop = read("pre-workshop.js");
  const postWorkshop = read("post-workshop.js");
  const mainAdmission = read("main-admission-leads.js");
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
  assert.match(preWorkshop, /filterIncludesValue\(filter\.workshopName, getLeadWorkshopName\(lead\)\)/);
  assert.match(postWorkshop, /filterIncludesValue\(filter\.courseStatus, lead\.courseStatus\)/);
  assert.match(preWorkshop, /BLANK_FILTER_VALUE/);
  assert.match(postWorkshop, /BLANK_FILTER_VALUE/);
  assert.match(preWorkshop, /item === BLANK_FILTER_VALUE \? normalizedValue === ""/);
  assert.match(postWorkshop, /item === BLANK_FILTER_VALUE \? normalizedValue === ""/);
  assert.match(postWorkshop, /postWhatsappActivitySelect/);
  assert.match(postWorkshop, /getLeadIdsByActivityTypes/);
  assert.match(postWorkshop, /WhatsApp Read/);
  assert.match(postWorkshop, /leadMatchesWhatsappActivityFilter\(lead\)/);
  assert.match(mainAdmission, /mainAdmissionWhatsappActivitySelect/);
  assert.match(mainAdmission, /getLeadIdsByActivityTypes/);
  assert.match(mainAdmission, /WhatsApp Read/);
  assert.match(mainAdmission, /leadMatchesWhatsappActivityFilter\(lead\)/);
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
  assert.match(monitoring, /formatAdmissionWorkshopBreakdownEntries\(activityLeads, "postActivityUpdates"\)/);
  assert.match(server, /"admissionWorkshop"/);
  assert.doesNotMatch(preWorkshop, /admissionWorkshop/);
});

test("workshop updated filter stays scoped to workshop activity", () => {
  const preWorkshop = getNamedFunctionSource(read("pre-workshop.js"), "getLeadActivityUpdateCount");

  assert.match(preWorkshop, /function getLeadActivityUpdateCount\(lead\)/);
  assert.match(preWorkshop, /workshopActivityTouchedByAssignee/);
  assert.match(preWorkshop, /workshopActivityHistory/);
  assert.match(preWorkshop, /preActivityUpdates/);
  assert.doesNotMatch(preWorkshop, /admissionActivityHistory/);
  assert.doesNotMatch(preWorkshop, /postActivityUpdates/);
});

test("lead transfers reset updated state for the new assignee", () => {
  const server = read("server.js");
  const preWorkshop = read("pre-workshop.js");
  const postWorkshop = read("post-workshop.js");
  const leadControl = read("lead-control.js");

  assert.match(server, /function getLeadAssignmentResetPatch\(counselor, assignedAt\)/);
  assert.match(server, /workshopActivityTouchedByAssignee: false/);
  assert.match(server, /admissionActivityTouchedByAssignee: false/);
  assert.match(server, /getLeadAssignmentResetPatch\(counselor, now\)/);
  assert.match(server, /getLeadAssignmentResetPatch\(claim\.requesterName, now\)/);
  assert.match(server, /function getLeadActivityAssigneePatch\(stage, session\)/);
  assert.match(server, /workshopActivityTouchedByAssignee: true/);
  assert.match(server, /admissionActivityTouchedByAssignee: true/);

  assert.match(preWorkshop, /workshopActivityTouchedByAssignee/);
  assert.match(preWorkshop, /const hasActivity = !isUntouchedLead\(lead\)/);
  assert.match(postWorkshop, /admissionActivityTouchedByAssignee/);
  assert.match(postWorkshop, /const hasActivity = !isUntouchedLead\(lead\)/);
  assert.match(leadControl, /workshopActivityTouchedByAssignee/);
  assert.match(leadControl, /admissionActivityTouchedByAssignee/);
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

test("lead claim workflow requires admin and current owner approval before transfer", () => {
  const server = read("server.js");
  const leadBrowseHtml = read("lead-browse.html");
  const leadBrowse = read("lead-browse.js");
  const claimRaisedHtml = read("claim-raised.html");
  const claimRaised = read("claim-raised.js");
  const leadClaimService = read("lead-claim-service.js");
  const layouts = read("layouts.js");

  assert.match(server, /leadClaimsCollection/);
  assert.match(server, /app\.post\("\/api\/lead-claims"/);
  assert.match(server, /app\.get\("\/api\/lead-claims"/);
  assert.match(server, /app\.delete\("\/api\/lead-claims"/);
  assert.match(server, /app\.patch\("\/api\/lead-claims\/:claimId\/decision"/);
  assert.match(server, /nextAdminStatus === "approved" && nextOwnerStatus === "approved"/);
  assert.match(server, /leadsCollection\.updateOne\([\s\S]*getLeadAssignmentResetPatch\(claim\.requesterName, now\)/);
  assert.match(server, /currentLeadOwner\.toLowerCase\(\) !== claim\.currentOwnerName\.toLowerCase\(\)/);
  assert.match(server, /Only the counselor currently holding the lead can approve this claim/);

  assert.match(leadBrowse, /canRaiseClaimForLead/);
  assert.match(leadBrowse, /data-claim-lead/);
  assert.match(leadBrowse, /raiseLeadClaim/);
  assert.match(leadBrowseHtml, /Formal reason/);
  assert.match(claimRaisedHtml, /Claim Raised/);
  assert.match(claimRaisedHtml, /clearClaimsBtn/);
  assert.match(claimRaised, /decideLeadClaim/);
  assert.match(claimRaised, /clearLeadClaims/);
  assert.match(claimRaised, /Raised against your lead/);
  assert.match(leadClaimService, /fetchLeadClaims/);
  assert.match(leadClaimService, /clearLeadClaims/);
  assert.match(leadClaimService, /decideLeadClaim/);
  assert.match(layouts, /claim-raised\.html/);
});

test("lead creation requests require counselor submission and admin approval before insert", () => {
  const server = read("server.js");
  const leadCreationHtml = read("lead-creation.html");
  const leadCreation = read("lead-creation.js");
  const leadCreationService = read("lead-creation-service.js");
  const layouts = read("layouts.js");

  assert.match(server, /leadCreationRequestsCollection/);
  assert.match(server, /app\.post\("\/api\/lead-creation-requests"/);
  assert.match(server, /requireRole\(req, res, "counselor"\)/);
  assert.match(server, /app\.patch\("\/api\/lead-creation-requests\/:requestId\/decision"/);
  assert.match(server, /requireRole\(req, res, "admin"\)/);
  assert.match(server, /buildApprovedLeadFromCreationRequest/);
  assert.match(server, /leadsCollection\.insertOne\(leadDraft\)/);
  assert.match(server, /leadPipeline: MAIN_ADMISSION_PIPELINE/);
  assert.match(server, /getLeadCreationTargetLabel/);
  assert.match(server, /clearedByRequester: true/);
  assert.match(server, /clearedByAdmin: true/);

  assert.match(leadCreationHtml, /<h1>Lead Creation<\/h1>/);
  assert.match(leadCreationHtml, /leadCreationPipeline/);
  assert.match(leadCreationHtml, /Main Admission Calling/);
  assert.match(leadCreation, /submitLeadCreationRequest/);
  assert.match(leadCreation, /decideLeadCreationRequest/);
  assert.match(leadCreation, /clearLeadCreationRequests/);
  assert.match(leadCreation, /formPanel\?\.classList\.toggle\("hidden", isAdmin\(\)\)/);
  assert.match(leadCreationService, /\/api\/lead-creation-requests/);
  assert.match(layouts, /lead-creation\.html/);
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
  assert.match(read("lost-leads.js"), /import \{ openActivityHistory \} from "\.\/activity-history\.js"/);
  assert.match(read("task-tracker.js"), /import \{ openActivityHistory \} from "\.\/activity-history\.js"/);

  // Server query unification assertions
  assert.match(server, /leadIdsToQuery/);

  // Reusable timeline assertions
  assert.match(activityHistory, /export function openActivityHistory\(/);
  assert.match(activityHistory, /fetchActivityLogs\(/);
  assert.match(activityHistory, /activityHistoryModal/);

  // Styles assertions
  assert.match(styles, /\.timeline-modal/);
  assert.match(styles, /\.timeline-track/);
  assert.match(styles, /\.timeline-badge/);
});

test("activity update panels can save notes into activity history", () => {
  const preWorkshopHtml = read("pre-workshop.html");
  const postWorkshopHtml = read("post-workshop.html");
  const registeredCandidatesHtml = read("registered-candidates.html");
  const mainAdmissionLeadsHtml = read("main-admission-leads.html");
  const preWorkshop = read("pre-workshop.js");
  const postWorkshop = read("post-workshop.js");
  const registeredCandidates = read("registered-candidates.js");
  const mainAdmissionLeads = read("main-admission-leads.js");
  const server = read("server.js");

  assert.match(preWorkshopHtml, /modalActivityNote/);
  assert.match(postWorkshopHtml, /modalPostActivityNote/);
  assert.match(registeredCandidatesHtml, /modalRegisteredActivityNote/);
  assert.match(mainAdmissionLeadsHtml, /modalMainAdmissionActivityNote/);
  assert.match(getFunctionBody(preWorkshop, "saveActivityModalNote"), /addLeadNote\(leadId, text/);
  assert.match(getFunctionBody(postWorkshop, "savePostActivityModalNote"), /addLeadNote\(leadId, text/);
  assert.match(getFunctionBody(registeredCandidates, "saveActivity"), /modalRegisteredActivityNote/);
  assert.match(getFunctionBody(registeredCandidates, "saveActivity"), /addLeadNote\(lead\.id, noteText/);
  assert.match(getFunctionBody(mainAdmissionLeads, "saveActivity"), /modalMainAdmissionActivityNote/);
  assert.match(getFunctionBody(mainAdmissionLeads, "saveActivity"), /addLeadNote\(lead\.id, noteText/);
  assert.match(server, /activityType: "Notes Added"/);
  assert.match(server, /actionDescription: `Added note: "\$\{text\}"`/);
});

test("incoming Meta leads route admission traffic into Main Admission Leads", () => {
  const server = read("server.js");
  const mainAdmissionHtml = read("main-admission-leads.html");
  const mainAdmission = read("main-admission-leads.js");
  const taskService = read("task-service.js");
  const taskTracker = read("task-tracker.js");

  assert.match(server, /const MAIN_ADMISSION_PIPELINE = "main-admission"/);
  assert.match(server, /const ODISHA_LOCATION_PATTERN = new RegExp/);
  assert.ok(server.includes('"\\\\bodisha\\\\b"'));
  assert.ok(server.includes('"\\\\bcuttack\\\\b"'));
  assert.ok(server.includes('"\\\\brourkela\\\\b"'));
  assert.match(server, /return normalizeBranchName\(parts\.filter\(Boolean\)\.join\(" "\)\) \|\| "Bangalore"/);
  assert.match(server, /function getAdmissionCounselorCandidates/);
  assert.match(server, /const branchAndCourseMatches = activeCounselors\.filter/);
  assert.match(server, /if \(branchAndCourseMatches\.length\) return branchAndCourseMatches/);
  assert.match(server, /if \(courseMatches\.length\) return courseMatches/);
  assert.match(server, /return activeCounselors/);
  assert.match(server, /function classifyIncomingMetaLead/);
  assert.match(server, /adv ai ml/);
  assert.match(server, /genai/);
  assert.match(server, /return hasAdmissionSignal \|\| descriptor \? "admission" : "workshop"/);
  assert.match(server, /leadPipeline: isAdmissionLead \? MAIN_ADMISSION_PIPELINE : ""/);
  assert.match(server, /stage === "main-admission"/);
  assert.match(server, /mainAdmissionActivityHistory/);
  assert.match(server, /Admission and workshop records intentionally coexist/);
  assert.match(mainAdmissionHtml, /<h1>Main Admission Leads<\/h1>/);
  assert.match(mainAdmissionHtml, /mainAdmissionLeadTableSection/);
  assert.match(mainAdmission, /leadPipeline \|\| ""\)\.trim\(\)\.toLowerCase\(\) === "main-admission"/);
  assert.match(mainAdmission, /stage: "main-admission"/);
  assert.match(mainAdmission, /TASK_CATEGORY\.mainAdmission/);
  assert.match(mainAdmission, /New main admission leads stay with the system until an admin assigns them manually/);
  assert.match(taskService, /mainAdmission: "main-admission"/);
  assert.match(taskTracker, /mainAdmissionTaskSection/);
});

test("Integration exposes lead flow control subsection", () => {
  const metaHtml = read("meta-integration.html");
  const metaJs = read("meta-integration.js");
  const leadFlowHtml = read("lead-flow-control.html");
  const leadFlowJs = read("lead-flow-control.js");

  assert.match(metaJs, /lead-flow-control\.html/);
  assert.match(leadFlowHtml, /Lead Flow Control/);
  assert.match(leadFlowHtml, /Workshop admission rotation/);
  assert.match(leadFlowHtml, /Main admission lead rotation/);
  assert.match(leadFlowJs, /function isCounselorInAdmissionRotation/);
  assert.match(leadFlowJs, /admissionRoundRobinEnabled === true/);
  assert.match(leadFlowJs, /admissionCoursePermissions/);
  assert.match(leadFlowJs, /data-rotation-field/);
  assert.match(leadFlowJs, /isCoursePermissionUpdate/);
  assert.match(metaHtml, /lead-flow-control\.html/);
});

test("admission course permission matching uses catalog course ids", () => {
  const server = read("server.js");

  assert.match(server, /key: "advanced-aiml-genai-agentic"/);
  assert.match(server, /key: "master-genai-agentic"/);
  assert.match(server, /key: "days7_genai"/);
  assert.match(server, /key: "apcs"/);
  assert.match(server, /isKnownPublicCourseIdentity\(courseIdentity\)[\s\S]*?return courseIdentity\.key === course\.id/);
  assert.doesNotMatch(server, /key: "advanced-ai-ml"/);
  assert.doesNotMatch(server, /key: "7-days-gen-ai"/);
  assert.doesNotMatch(server, /key: "cyber-security"/);
  assert.match(server, /if \(!descriptor\) return false;/);
  assert.match(server, /if \(!Array\.isArray\(value\)\) \{\s*return \[\];\s*\}/);
  assert.match(server, /if \(courseMatches\.length\) return courseMatches;\s*return \[\];/);
  assert.ok(server.includes("apids|apida|apcs|das|aiml|genai|gen ai|7days|7 days"));
  assert.match(server, /if \(hasCourseCatalogSignal\) \{\s*return "admission";\s*\}/);
  assert.match(server, /function isKnownPublicCourseIdentity/);
  assert.match(server, /leadType === "admission" \|\| isKnownPublicCourseIdentity\(forcedAdmissionCourseIdentity\)/);
  assert.match(server, /function getAdmissionRoutingCourseName/);
  assert.match(server, /const admissionRoutingCourseName = getAdmissionRoutingCourseName\(inferredAdmissionCourse, forcedAdmissionCourseIdentity\)/);
  assert.match(server, /courseName: admissionRoutingCourseName/);
  assert.doesNotMatch(server, /\[course\.id, course\.code, course\.name, courseIdentity\.label\]/);
  assert.doesNotMatch(getNamedFunctionSource(server, "courseMatchesPermission"), /descriptor\.includes/);
  assert.match(server, /\{ leadType: effectiveLeadType \}/);
  assert.ok(server.includes('"\\\\bod\\\\b"'));
});

test("admission course matcher keeps every catalog course isolated", () => {
  const server = read("server.js");
  const source = [
    getConstDeclaration(server, "PUBLIC_COURSE_CATALOG"),
    getConstDeclaration(server, "COURSE_IDENTITY_RULES"),
    getNamedFunctionSource(server, "normalizeMetaLabel"),
    getNamedFunctionSource(server, "toTitleCaseWords"),
    getNamedFunctionSource(server, "slugifyWorkshopPart"),
    getNamedFunctionSource(server, "normalizeCourseSourceText"),
    getNamedFunctionSource(server, "buildCourseIdentity"),
    getNamedFunctionSource(server, "isKnownPublicCourseIdentity"),
    getNamedFunctionSource(server, "courseMatchesPermission")
  ].join("\n");

  const { catalog, matches } = new Function(`${source}; return {
    catalog: PUBLIC_COURSE_CATALOG,
    matches: (courseId, text) => courseMatchesPermission(PUBLIC_COURSE_CATALOG.find((course) => course.id === courseId), text)
  };`)();

  const signals = {
    apids: "DV_APIDS - OD_052026",
    apida: "DV_APIDA_Retarget",
    "advanced-aiml-genai-agentic": "DV_AIML + GenAI campaign",
    "master-genai-agentic": "DV_GenAI Master campaign",
    "data-analytics-specialist": "DV_DAS campaign",
    apcs: "DV_APCS campaign",
    days7_genai: "DV_7DAYS_GENAI campaign"
  };

  for (const [expectedCourseId, signal] of Object.entries(signals)) {
    for (const course of catalog) {
      assert.equal(
        matches(course.id, signal),
        course.id === expectedCourseId,
        `${signal} should ${course.id === expectedCourseId ? "" : "not "}match ${course.id}`
      );
    }
  }
});

test("full counselor saves preserve lead flow routing permissions", () => {
  const server = read("server.js");

  assert.match(server, /function preserveCounselorRoutingFields/);
  assert.match(server, /roundRobinEnabled: existing\.roundRobinEnabled/);
  assert.match(server, /admissionRoundRobinEnabled: existing\.admissionRoundRobinEnabled/);
  assert.match(server, /admissionCoursePermissions: normalizeAdmissionCoursePermissionIds\(existing\.admissionCoursePermissions\)/);
  assert.match(server, /const nextCounselors = preserveCounselorRoutingFields\(req\.body, currentState\.counselors\)/);
  assert.match(server, /counselorsCollection\.insertMany\(nextCounselors\)/);
});

test("main admission leads stay out of legacy workshop and registered sections", () => {
  const dashboard = read("dashboard.js");
  const preWorkshop = read("pre-workshop.js");
  const postWorkshop = read("post-workshop.js");
  const leadControl = read("lead-control.js");
  const monitoring = read("monitoring.js");

  assert.match(dashboard, /\["course-registration", "main-admission"\]/);
  assert.match(preWorkshop, /function isNonWorkshopPipelineLead/);
  assert.match(postWorkshop, /function isNonWorkshopPipelineLead/);
  assert.match(leadControl, /function isNonWorkshopPipelineLead/);
  assert.match(monitoring, /function isMainAdmissionLead/);
  assert.match(monitoring, /filter\(\(lead\) => !isMainAdmissionLead\(lead\)\)/);
});

test("lost leads include not interested statuses across all lead pipelines", () => {
  const lostLeads = read("lost-leads.js");

  assert.match(lostLeads, /lead\.mainAdmissionActivityUpdated && lead\.mainAdmissionCourseStatus === "Not Interested"/);
  assert.match(lostLeads, /lead\.registeredActivityUpdated && lead\.registeredCourseStatus === "Not Interested"/);
  assert.match(lostLeads, /lead\.wsStatus === "Not Interested"/);
  assert.match(lostLeads, /lead\.postStatusUpdated && lead\.courseStatus === "Not Interested"/);
  assert.match(lostLeads, /return "Main Admission Leads"/);
  assert.match(lostLeads, /\? "7-Day Crash Course"/);
  assert.match(lostLeads, /: "Registered Candidates"/);
  assert.match(lostLeads, /return "Workshop Calling"/);
  assert.match(lostLeads, /return "Admission Calling"/);
});

test("MCUBE inbound document sample maps to CRM call event fields", () => {
  const server = read("server.js");
  const source = [
    getNamedFunctionSource(server, "normalizeMcubeDirection"),
    getNamedFunctionSource(server, "parseMcubeDurationSeconds"),
    getNamedFunctionSource(server, "parseMcubeTimestampMs"),
    getNamedFunctionSource(server, "deriveMcubeTalkTimeDuration"),
    getNamedFunctionSource(server, "normalizeMcubeEvent")
  ].join("\n\n");
  const factory = new Function(`${source}; return { normalizeMcubeEvent };`);
  const { normalizeMcubeEvent } = factory();

  const event = normalizeMcubeEvent({
    starttime: "2023-10-12 11:49:57",
    callid: "80889767291697091597",
    emp_phone: "8767316316",
    clicktocalldid: "8035053336",
    callto: "7816999444",
    dialstatus: "ANSWER",
    filename: "https://s3.ap-south-1.amazonaws.com/app.mcube.com/recordings/2023/10/6011/87673163161697091597.wav",
    direction: "inbound",
    endtime: "2023-10-12 11:50:28",
    disconnectedby: "Customer",
    answeredtime: "00:00:04",
    groupname: "Integration",
    agentname: "Test"
  });

  assert.equal(event.callId, "80889767291697091597");
  assert.equal(event.phone, "7816999444");
  assert.equal(event.disposition, "ANSWER");
  assert.equal(event.recordingUrl, "https://s3.ap-south-1.amazonaws.com/app.mcube.com/recordings/2023/10/6011/87673163161697091597.wav");
  assert.equal(event.direction, "inbound");
  assert.equal(event.startedAt, "2023-10-12 11:49:57");
  assert.equal(event.endedAt, "2023-10-12 11:50:28");
  assert.equal(event.duration, 27);
  assert.equal(event.agentPhone, "8767316316");
  assert.equal(event.didNumber, "8035053336");
  assert.equal(event.answeredTime, "00:00:04");
  assert.equal(event.groupName, "Integration");
  assert.equal(event.counselorName, "Test");
  assert.equal(event.mcubeFields.callto, "7816999444");
});

test("MCUBE outbound click-to-call uses documented payload fields", () => {
  const server = read("server.js");
  const routeStart = server.indexOf('app.post("/api/mcube/click-to-call"');
  const routeEnd = server.indexOf('app.get("/api/reachout/config"', routeStart);
  const clickToCallRoute = server.slice(routeStart, routeEnd);
  const clickToCallBuilder = getNamedFunctionSource(server, "buildMcubeClickToCallRequest");

  assert.match(server, /apiBaseUrl: "https:\/\/api\.mcube\.com"/);
  assert.match(server, /clickToCallPath: "\/Restmcube-api\/outbound-calls"/);
  assert.match(server, /outboundRefUrl: "1"/);
  assert.match(server, /HTTP_AUTHORIZATION: config\.accountToken/);
  assert.match(server, /exenumber: executiveNumber/);
  assert.match(server, /custnumber: targetPhone/);
  assert.match(server, /refurl: String\(req\.body\?\.refurl \|\| config\.outboundRefUrl \|\| "1"\)/);
  assert.match(server, /refid: String\(req\.body\?\.refid \|\| lead\?\.id \|\| leadId \|\| ""\)/);
  assert.doesNotMatch(server, /Authorization: `Bearer \$\{config\.accountToken\}`/);
  assert.match(clickToCallBuilder, /JSON\.stringify\(requestPayload\)/);
  assert.match(clickToCallBuilder, /contentType: method === "GET" \? "" : "application\/json"/);
  assert.match(clickToCallRoute, /\.\.\.\(activeRequest\.contentType \? \{ "Content-Type": activeRequest\.contentType \} : \{\}\)/);
  assert.doesNotMatch(clickToCallRoute, /body: JSON\.stringify\(requestPayload\)/);
  assert.match(clickToCallBuilder, /apikey: requestPayload\.HTTP_AUTHORIZATION/);
  assert.match(clickToCallBuilder, /url: requestPayload\.refurl/);
  assert.doesNotMatch(clickToCallRoute, /buildMcubeClickToCallRequest\(config, requestPayload, true\)/);
  assert.match(server, /function normalizeMcubeDialNumber/);
  assert.match(clickToCallRoute, /const targetPhone = normalizeMcubeDialNumber/);
  assert.match(clickToCallRoute, /const executiveNumber = normalizeMcubeDialNumber/);
  assert.match(server, /function isSuccessfulMcubeClickToCallResponse/);
  assert.match(server, /function buildMcubeAttemptLog/);
  assert.match(server, /function buildMcubeActivityMetadata/);
  assert.match(server, /function describeFailedMcubeAttempts/);
  assert.match(server, /function looksLikeMcubeToken/);
  assert.match(server, /function validateMcubeEndpointConfig/);
  assert.match(server, /sanitizeMcubeEndpointForLog/);
  assert.match(server, /endpointText/);
  assert.match(clickToCallRoute, /const mcubeAccepted = response\.ok && isSuccessfulMcubeClickToCallResponse/);
  assert.match(clickToCallRoute, /validateMcubeEndpointConfig\(config\)/);
  assert.match(clickToCallRoute, /attempts\.push\(buildMcubeAttemptLog/);
  assert.match(clickToCallRoute, /mcubeAttempts: attempts/);
  assert.match(clickToCallRoute, /callMetadata: buildMcubeActivityMetadata/);
  assert.match(clickToCallRoute, /MCUBE did not confirm that the call was created/);
  assert.match(server, /MCUBE executive number is missing/);
});

test("MCUBE config rejects token-like click-to-call endpoint values", () => {
  const server = read("server.js");
  const mcubeIntegration = read("mcube-integration.js");
  const saveRouteStart = server.indexOf('app.put("/api/mcube/config"');
  const saveRouteEnd = server.indexOf('app.post("/api/mcube/test"', saveRouteStart);
  const saveRoute = server.slice(saveRouteStart, saveRouteEnd);

  assert.match(server, /Click-to-Call Path looks like an MCUBE account token/);
  assert.match(server, /Use \/Restmcube-api\/outbound-calls there/);
  assert.match(server, /Click-to-Call Path must start with \//);
  assert.match(server, /Click-to-Call Path should not be a full URL/);
  assert.match(saveRoute, /validateMcubeEndpointConfig\(\{ \.\.\.currentConfig, \.\.\.patch \}\)/);
  assert.match(saveRoute, /return res\.status\(400\)\.json\(\{ message: endpointErrors\.join\(" "\) \}\)/);
  assert.match(mcubeIntegration, /function getMcubeEndpointInputError/);
  assert.match(mcubeIntegration, /Click-to-Call Path looks like the MCUBE account token/);
});

test("MCUBE auto-created leads assign only when a picked call matches a CRM counselor", () => {
  const server = read("server.js");
  const source = [
    getNamedFunctionSource(server, "normalizeMcubePhone"),
    getNamedFunctionSource(server, "findMcubeAnsweringCounselor"),
    getNamedFunctionSource(server, "didMcubeCallGetPicked"),
    getNamedFunctionSource(server, "getMcubeLeadAssignment")
  ].join("\n\n");
  const factory = new Function(`${source}; return { getMcubeLeadAssignment };`);
  const { getMcubeLeadAssignment } = factory();
  const counselors = [
    { name: "Bhavya", email: "bhavya@example.com", mcubeExecutiveNumber: "8767316316" },
    { name: "Shubhashree", email: "shu@example.com", phone: "9988776655" }
  ];

  assert.equal(
    getMcubeLeadAssignment({ disposition: "CANCEL", agentPhone: "8767316316", counselorName: "Bhavya" }, counselors).counselorName,
    "Unassigned"
  );
  assert.equal(
    getMcubeLeadAssignment({ disposition: "CANCEL", answeredTime: "00:00:04", agentPhone: "8767316316", counselorName: "Bhavya" }, counselors).counselorName,
    "Unassigned"
  );
  assert.equal(
    getMcubeLeadAssignment({ disposition: "ANSWER", agentPhone: "1111111111", counselorName: "External Agent" }, counselors).counselorName,
    "Unassigned"
  );
  assert.equal(
    getMcubeLeadAssignment({ disposition: "ANSWER", agentPhone: "8767316316", counselorName: "Bhavya" }, counselors).counselorName,
    "Bhavya"
  );
  assert.doesNotMatch(server, /assignMcubeCounselorRoundRobin/);
});

test("MCUBE auto-created lead contact placeholders are replaceable only when synthetic", () => {
  const server = read("server.js");
  const buildMcubeLead = getNamedFunctionSource(server, "buildMcubeLead");
  const contactPatch = getNamedFunctionSource(server, "sanitizeFillMissingContactPatch");
  const replaceableValue = getNamedFunctionSource(server, "isReplaceableLeadContactValue");

  assert.match(buildMcubeLead, /name:\s*""/);
  assert.match(buildMcubeLead, /email:\s*""/);
  assert.doesNotMatch(buildMcubeLead, /MCUBE Caller/);
  assert.doesNotMatch(buildMcubeLead, /@noemail\.lead/);
  assert.match(contactPatch, /isReplaceableLeadContactValue\(field, lead\[field\]\)/);
  assert.match(replaceableValue, /\^mcube\\s\+\(caller\|lead\)/);
  assert.match(replaceableValue, /@noemail\\\.lead/);
});

test("MCUBE logs show exact call status before picked interpretation", () => {
  const mcubeIntegration = read("mcube-integration.js");
  const mcubeHtml = read("mcube-integration.html");
  const activityHistory = read("activity-history.js");
  const renderCallHandling = getNamedFunctionSource(mcubeIntegration, "renderCallHandling");

  assert.match(mcubeHtml, /<th>Call Status<\/th>/);
  assert.match(renderCallHandling, /const exactStatus = String\(log\.callDisposition \|\| log\.eventType \|\| log\.normalizedStatus/);
  assert.match(renderCallHandling, /const primary = exactStatus/);
  assert.match(renderCallHandling, /outcome,/);
  assert.match(activityHistory, /function renderCallMetadata/);
  assert.match(activityHistory, /function getUsableRecordingUrl/);
  assert.match(activityHistory, /timeline-recording-link/);
  assert.match(activityHistory, /Call Recording/);
});

test("MCUBE click-to-call dispatch logs are marked outbound", () => {
  const server = read("server.js");

  assert.match(server, /message: `Click-to-call dispatched/);
  assert.match(server, /callDisposition: "DISPATCHED"/);
  assert.match(server, /callDisposition: "DISPATCH_FAILED"/);
  assert.match(server, /direction: "outbound"/);
  assert.match(server, /eventType: "click-to-call"/);
  assert.match(server, /setupHint/);
  assert.match(server, /configured \$\{activeRequest\.offering\} endpoint/);
});

test("counselor lead list rows expose MCUBE click-to-call buttons", () => {
  const service = read("mcube-call-service.js");
  const pages = [
    "pre-workshop.js",
    "post-workshop.js",
    "registered-candidates.js",
    "main-admission-leads.js",
    "lead-browse.js"
  ];

  assert.match(service, /apiUrl\("\/api\/mcube\/click-to-call"\)/);
  assert.match(service, /body: JSON\.stringify\(\{ leadId, phone, leadName \}\)/);
  assert.match(service, /payload\?\.attempts/);
  pages.forEach((file) => {
    const source = read(file);
    assert.match(source, /triggerMcubeClickToCall/);
    assert.match(source, /btn-mcube-call/);
  });
});

test("ReachOut templates do not respawn default seeded templates after removal", () => {
  const server = read("server.js");
  const defaultReachoutTemplates = getNamedFunctionSource(server, "getDefaultReachoutTemplates");

  assert.match(defaultReachoutTemplates, /return \[\];/);
  assert.doesNotMatch(defaultReachoutTemplates, /Workshop Reminder|WhatsApp Follow-up|Admission Email/);
  assert.match(server, /doc\.templates\.filter\(\(template\) => String\(template\?\.channel/);
  assert.match(server, /: getDefaultReachoutTemplates\(\)/);
});

test("ReachOut is simplified to synced WhatsApp number and template sending", () => {
  const server = read("server.js");
  const reachoutHtml = read("reachout.html");
  const reachout = read("reachout.js");

  assert.match(server, /app\.post\("\/api\/reachout\/whatsapp\/sync"/);
  assert.match(server, /app\.post\("\/api\/reachout\/whatsapp\/webhook"/);
  assert.match(server, /whatsappNumbers/);
  assert.match(server, /ReachOut now supports WhatsApp templates only/);
  assert.match(server, /statusCallbackUrl/);
  assert.match(server, /integratedNumber = String\(req\.body\?\.integratedNumber/);
  assert.match(server, /to_and_components/);
  assert.match(server, /get-template-plugins/);
  assert.doesNotMatch(getNamedFunctionSource(server, "buildReachoutEndpoint"), /api\/v5\/flow|email\/send/);

  assert.match(reachoutHtml, /syncWhatsappBtn/);
  assert.match(reachoutHtml, /numberSelect/);
  assert.match(reachoutHtml, /templateSelect/);
  assert.match(reachoutHtml, /mediaUrlInput/);
  assert.match(reachoutHtml, /saveMediaUrlBtn/);
  assert.match(reachoutHtml, /mediaFileInput/);
  assert.match(reachoutHtml, /uploadMediaBtn/);
  assert.match(reachoutHtml, /statusCallbackUrlInput/);
  assert.match(reachoutHtml, /reachout-media-control/);
  assert.doesNotMatch(reachoutHtml, /Add Template|SMS, WhatsApp, and email|MSG91 Template ID|From Email|Email Domain/);
  assert.match(reachout, /syncWhatsapp/);
  assert.match(reachout, /integratedNumber,\s*templateId,\s*leadIds/);
  assert.match(reachout, /needsMediaHeader/);
  assert.match(reachout, /saveTemplateMediaUrl/);
  assert.match(reachout, /uploadTemplateMedia/);
  assert.match(reachout, /statusCallbackUrlInput/);
  assert.match(reachout, /apiUrl\("\/api\/reachout\/media"\)/);
  assert.match(reachout, /defaultHeaderMediaUrl: mediaUrl/);
  assert.doesNotMatch(reachout, /blankTemplate|data-remove-template|New SMS Template|New Email Template/);
});

test("ReachOut labels MSG91 accepted WhatsApp API calls as submitted, not delivered", () => {
  const server = read("server.js");
  const reachoutHtml = read("reachout.html");
  const reachout = read("reachout.js");

  assert.match(server, /type: "submitted"/);
  assert.match(server, /submitted: results\.filter\(\(item\) => item\.ok\)\.length/);
  assert.match(server, /submitted to MSG91/);
  assert.match(server, /doc\?\.logSummary\?\.submitted \?\? doc\?\.logSummary\?\.success/);
  assert.match(reachoutHtml, /Submitted \/ Failed/);
  assert.match(reachoutHtml, /Delivery, read, and reply events can now flow back into lead activity history/);
  assert.match(reachout, /Submitted \$\{submitted\} of \$\{json\.attempted \|\| 0\} to MSG91\. Delivery\/read\/reply updates can sync back through the webhook callback URL\./);
  assert.match(reachout, /log\.type === "error" \? "Failed" : "Submitted"/);
});

test("ReachOut WhatsApp payload uses MSG91 component value shape for media and URL buttons", () => {
  const server = read("server.js");

  assert.match(server, /messaging_product: "whatsapp"/);
  assert.match(server, /\.\.\.\(template\.namespace \? \{ namespace: template\.namespace \} : \{\}\)/);
  assert.match(server, /return \{ type: schemaType, value: componentValue \}/);
  assert.match(server, /return \{ subtype: schemaSubtype \|\| "url", type: "text", value: componentValue \}/);
  assert.match(server, /return \{ type: "text", value: componentValue \}/);
  assert.match(server, /Template \$\{templateName\} needs a public HTTPS media URL/);
  assert.match(server, /mediaUrl = ""/);
  assert.match(server, /variables\.mediaUrl/);
  assert.match(server, /defaultHeaderMediaUrl/);
  assert.match(server, /app\.post\("\/api\/reachout\/media"/);
  assert.match(server, /app\.get\("\/api\/reachout\/media\/:id"/);
  assert.match(server, /bufferFromStoredMediaData/);
  assert.match(server, /MONGODB_REACHOUT_MEDIA_COLLECTION/);
  assert.match(server, /Template \$\{templateName\} needs a valid HTTPS button URL/);
  assert.match(server, /namespace: normalizeMsg91TemplateNamespace\(template\)/);
});

test("ReachOut sync stores generic component schema for current and future WhatsApp templates", () => {
  const server = read("server.js");

  assert.match(server, /function normalizeTemplateComponentSchema/);
  assert.match(server, /const isMediaHeader = .*header_\\d\+\$/);
  assert.match(server, /value\.image\?\.link/);
  assert.match(server, /explicitType: Boolean\(rawType\)/);
  assert.match(server, /example: existing\.example \|\| next\.example/);
  assert.match(server, /componentSchema,\s*variableMappings: inferWhatsAppVariableMappings\(template, componentSchema\)/);
  assert.match(server, /componentSchema: Array\.isArray\(template\.componentSchema\)/);
  assert.match(server, /ensureSchemaComponentsInMappings/);
  assert.match(server, /template\.componentSchema/);
  assert.doesNotMatch(server, /header_1: "https:\/\/files\.msg91\.com\/514340\/uvtvfscf"/);
});
