const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
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
  assert.match(preWorkshop, /value="\$\{EMPTY_FILTER_VALUE\}"/);
  assert.match(postWorkshop, /value="\$\{EMPTY_FILTER_VALUE\}"/);
  assert.match(styles, /\.multi-filter-menu/);
  assert.doesNotMatch(preWorkshop, /<select[^>]+multiple/);
  assert.doesNotMatch(postWorkshop, /<select[^>]+multiple/);
  assert.match(preWorkshop, /filterIncludesValue\(filter\.workshop, lead\.workshop\)/);
  assert.match(postWorkshop, /filterIncludesValue\(filter\.courseStatus, lead\.courseStatus\)/);
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
