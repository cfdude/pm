// scripts/test/unit/overhead-survey.test.mjs
// pm-overhead-calibration-and-feature-switches B1 -- the survey CORE. UNIT rung: every function takes
// strings or rows and returns a value; nothing here names a path. The fixture lines are SYNTHETIC and
// shaped like the entries observed on 2026-10-29. No real transcript is copied into the repository.

import assert from "node:assert/strict";
import { unitTest } from "../fixtures/unit-harness.mjs";
import {
  AGGREGATE_KEYS, BRIEF_HOOK, aggregate, createScanner, firstMessage, projectClass, exclusionReason,
} from "../../measure/overhead-survey-core.mjs";

const BRIEF_CMD = 'node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" brief --platform claude-code';
const HONCHO_CMD = 'node "${CLAUDE_PLUGIN_ROOT}/scripts/session-start.mjs"';

const line = (o) => JSON.stringify(o);
const hook = ({ source = "startup", command = BRIEF_CMD, exitCode = 0, entrypoint = "cli" } = {}) => line({
  type: "attachment", entrypoint, timestamp: "2026-10-29T10:00:00.000Z",
  attachment: { type: "hook_success", hookName: `SessionStart:${source}`, command, exitCode,
    content: "SECRET-BRIEF-TEXT", stdout: "SECRET-STDOUT" },
});
const assistant = ({ id = "m1", out = 10, input = 2, cc = 1000, cr = 300, model = "claude-opus-4-7",
  entry = {}, text = "SECRET-PROMPT-TEXT" } = {}) => line({
  type: "assistant", entrypoint: "cli", timestamp: "2026-10-29T10:00:01.000Z", sessionId: "sess-SECRET-ID", ...entry,
  message: { id, model, content: [{ type: "text", text }],
    usage: { input_tokens: input, cache_creation_input_tokens: cc, cache_read_input_tokens: cr, output_tokens: out } },
});
const user = () => line({ type: "user", entrypoint: "cli", message: { role: "user", content: "SECRET-USER-TEXT" } });

unitTest("B1 BRIEF_HOOK matches pm's brief command and nothing else", () => {
  assert.match(BRIEF_CMD, BRIEF_HOOK);
  assert.match('node "/x/scripts/conductor.mjs" brief', BRIEF_HOOK);
  assert.doesNotMatch(HONCHO_CMD, BRIEF_HOOK);
  assert.doesNotMatch('node "x/scripts/conductor.mjs" briefing-other --platform y', BRIEF_HOOK);
  assert.doesNotMatch('node "x/scripts/conductor.mjs" snapshot --platform claude-code', BRIEF_HOOK);
});

unitTest("B1 a startup session with pm's hook: counts, model, brief present, start and entrypoint", () => {
  const r = firstMessage([hook(), assistant({ input: 2, cc: 86283, cr: 29574, out: 7 })]);
  assert.deepEqual(r, {
    model: "claude-opus-4-7", input: 2, cacheCreation: 86283, cacheRead: 29574, output: 7,
    briefPresent: true, start: "startup", entrypoint: "cli",
  });
});

unitTest("B1 a clear session carries no brief by design; an sdk-py session has no hook attachment at all", () => {
  const clear = firstMessage([hook({ source: "clear", command: HONCHO_CMD }), assistant()]);
  assert.equal(clear.briefPresent, false);
  assert.equal(clear.start, "clear");
  const py = firstMessage([assistant({ entry: { entrypoint: "sdk-py" } })]);
  assert.equal(py.briefPresent, false);
  assert.equal(py.start, "none");
  assert.equal(py.entrypoint, "sdk-py");
});

unitTest("B1 the start enum is closed and the entrypoint enum is closed", () => {
  assert.equal(firstMessage([hook({ source: "resume" }), assistant()]).start, "resume");
  assert.equal(firstMessage([hook({ source: "compact" }), assistant()]).start, "compact");
  assert.equal(firstMessage([hook({ source: "weird-SECRET" }), assistant()]).start, "other");
  assert.equal(firstMessage([hook({ entrypoint: "sdk-cli" }), assistant({ entry: { entrypoint: "sdk-cli" } })]).entrypoint, "sdk-cli");
  assert.equal(firstMessage([assistant({ entry: { entrypoint: "vscode-SECRET" } })]).entrypoint, "other");
  assert.equal(firstMessage([assistant({ entry: { entrypoint: undefined } })]).entrypoint, "other");
});

unitTest("B1 a sidechain assistant entry is skipped; the first MAIN-chain message is the one counted", () => {
  const r = firstMessage([
    hook(), assistant({ id: "side", cc: 5, entry: { isSidechain: true } }), assistant({ id: "main", cc: 4242 }),
  ]);
  assert.equal(r.cacheCreation, 4242);
});

unitTest("B1 fragments of one message id fold to the entry with the greatest output", () => {
  const r = firstMessage([
    hook(), assistant({ id: "m1", out: 3, cc: 900 }), assistant({ id: "m1", out: 40, cc: 900 }),
    assistant({ id: "m1", out: 12, cc: 900 }), assistant({ id: "m2", out: 99, cc: 1 }),
  ]);
  assert.equal(r.output, 40);
  assert.equal(r.cacheCreation, 900);
});

unitTest("B1 a brief hook AFTER the first message does not count", () => {
  const r = firstMessage([assistant(), user(), hook()]);
  assert.equal(r.briefPresent, false);
  assert.equal(r.start, "none");
});

unitTest("B1 a non-zero exitCode does not count as the brief being present", () => {
  const r = firstMessage([hook({ exitCode: 1 }), assistant()]);
  assert.equal(r.briefPresent, false);
  assert.equal(r.start, "startup");
});

unitTest("B1 a hook that is not a hook_success attachment, or not SessionStart, does not count", () => {
  const notSession = line({ type: "attachment", attachment: { type: "hook_success", hookName: "PostToolUse:Bash", command: BRIEF_CMD, exitCode: 0 } });
  const notSuccess = line({ type: "attachment", attachment: { type: "hook_failure", hookName: "SessionStart:startup", command: BRIEF_CMD, exitCode: 0 } });
  assert.equal(firstMessage([notSession, notSuccess, assistant()]).briefPresent, false);
});

unitTest("B1 a session with no main-chain assistant message is skipped with a closed reason", () => {
  assert.deepEqual(firstMessage([hook(), user()]), { skip: "no-assistant-message" });
  assert.deepEqual(firstMessage([]), { skip: "no-assistant-message" });
  assert.deepEqual(firstMessage([assistant({ entry: { isSidechain: true } })]), { skip: "no-assistant-message" });
});

unitTest("B1 the scanner reports done once the first message is folded, and bytes after it are never needed", () => {
  const s = createScanner();
  assert.equal(s.push(hook()), false);
  assert.equal(s.push(assistant({ id: "m1", out: 5 })), false);
  assert.equal(s.push(assistant({ id: "m1", out: 9 })), false);
  assert.equal(s.push(user()), true);
  assert.equal(s.result().output, 9);
  // Pushing garbage afterwards changes nothing: the result is already settled.
  s.push("}{ not json at all \u0000\u0001");
  assert.equal(s.result().output, 9);
});

unitTest("B1 malformed lines are ignored before the first message", () => {
  const r = firstMessage(["not json", hook(), "{", assistant()]);
  assert.equal(r.briefPresent, true);
});

unitTest("B1 an oversize line before the first message voids the session rather than guessing", () => {
  const s = createScanner();
  s.pushOversize();
  s.push(assistant());
  s.push(user());
  assert.deepEqual(s.result(), { skip: "oversize-line" });
});

unitTest("B1 the first message's text is never part of the result", () => {
  const r = firstMessage([hook(), assistant()]);
  assert.doesNotMatch(JSON.stringify(r), /SECRET/);
});

unitTest("B1 projectClass excludes Highway by name, path and the four employer-hosted repos", () => {
  const out = [
    "-Users-robsherman-Documents-Repos-highway-llm",
    "-Users-robsherman-Documents-Repos-Highway-AI-thing",
    "-Users-robsherman-Documents-Highway-competitive-analysis",
    "-Users-robsherman-Documents-Repos-claude-chatbot",
    "-Users-robsherman-Documents-Repos-mortgage-closer",
    "-Users-robsherman-Servers-bitbucket-mcp",
    "-Users-robsherman-Servers-zendesk-mcp",
    "-Users-robsherman-Servers-zendesk-mcp--claude-worktrees-agent-abc",
    "-Users-robsherman-Highway-competitive-analysis",
  ];
  for (const d of out) assert.equal(projectClass(d), "excluded", d);
  const inc = [
    "-Users-robsherman-Documents-Repos-pm",
    "-Users-robsherman-Documents-Repos-pm--claude-worktrees-agent-a37",
    "--tmp-claude-501-foo",
    "-Users-robsherman-Servers-snowflake-mcp-server",
    "-Users-robsherman-Documents-Repos-claude-chatbot-lookalike-no",
  ];
  assert.equal(projectClass(inc[0]), "included");
  assert.equal(projectClass(inc[1]), "included");
  assert.equal(projectClass(inc[2]), "included");
  assert.equal(projectClass(inc[3]), "included");
});

unitTest("B1 exclusionReason names a closed reason, and null for an included project", () => {
  assert.equal(exclusionReason("-Users-x-Documents-Highway-y"), "highway");
  assert.equal(exclusionReason("-Users-x-Documents-Repos-highway-llm"), "highway");
  assert.equal(exclusionReason("-Users-x-Documents-Repos-mortgage-closer"), "employer-repo");
  assert.equal(exclusionReason("-Users-x-Documents-Repos-pm"), null);
});

// ---------- aggregate ----------

const row = (project, brief, model, input, cc, cr, over = {}) => ({
  project, briefPresent: brief, model, input, cacheCreation: cc, cacheRead: cr,
  start: "startup", entrypoint: "cli", ...over,
});

unitTest("B1 aggregate keeps only the headline population and counts every other class by reason", () => {
  const rows = [
    row("p1", true, "m", 2, 100, 10),
    row("p1", true, "m", 2, 100, 10, { start: "clear" }),
    row("p1", true, "m", 2, 100, 10, { start: "resume" }),
    row("p1", false, "m", 2, 100, 10, { entrypoint: "sdk-py", start: "none" }),
    row("p1", false, "m", 2, 100, 10, { entrypoint: "other", start: "none" }),
  ];
  const a = aggregate(rows, { skipped: { "no-assistant-message": 3 }, excludedProjects: { highway: 4, "employer-repo": 1 } });
  const n = a.groups.reduce((s, g) => s + g.n, 0);
  assert.equal(n, 1);
  assert.deepEqual(a.excluded.byReason, {
    "entrypoint-sdk-py": 1, "entrypoint-other": 1, "start-clear": 1, "start-resume": 1,
    "project-highway": 4, "project-employer-repo": 1, "no-assistant-message": 3,
  });
  assert.equal(a.population.headlineSessions, 1);
});

unitTest("B1 aggregate computes median, p10, p90, min, max per briefPresent x model, on the total prompt too", () => {
  const rows = [];
  for (let i = 1; i <= 10; i += 1) rows.push(row("p", true, "m", i, i * 10, i * 100));
  const g = aggregate(rows).groups[0];
  assert.equal(g.briefPresent, true);
  assert.equal(g.model, "m");
  assert.equal(g.n, 10);
  assert.deepEqual(g.input, { median: 5.5, p10: 1, p90: 9, min: 1, max: 10 });
  assert.deepEqual(g.total, { median: 5.5 * 111, p10: 111, p90: 999, min: 111, max: 1110 });
  assert.deepEqual(g.inputPlusCacheCreation, { median: 5.5 * 11, p10: 11, p90: 99, min: 11, max: 110 });
});

unitTest("B1 within-project delta: median over projects holding both sides on one model of on-minus-off medians", () => {
  const rows = [
    // project a: on total 1000 (x2), off total 400 (x2) -> delta 600
    row("a", true, "m", 0, 1000, 0), row("a", true, "m", 0, 1000, 0), row("a", false, "m", 0, 400, 0), row("a", false, "m", 0, 400, 0),
    // project b: delta 200
    row("b", true, "m", 0, 700, 0), row("b", false, "m", 0, 500, 0),
    // project c: delta 1000
    row("c", true, "m", 0, 1500, 0), row("c", false, "m", 0, 500, 0),
    // project d: only on -> contributes nothing
    row("d", true, "m", 0, 9999, 0),
    // project e: both sides but DIFFERENT models -> contributes nothing
    row("e", true, "m", 0, 9999, 0), row("e", false, "other-m", 0, 1, 0),
  ];
  const w = aggregate(rows).withinProject;
  assert.equal(w.overall.pairs, 3);
  assert.equal(w.overall.projects, 3);
  assert.equal(w.overall.medianDeltaTotal, 600);
  assert.equal(w.overall.medianDeltaInputPlusCacheCreation, 600);
  assert.equal(w.byModel.length, 1);
  assert.equal(w.byModel[0].model, "m");
});

unitTest("B1 within-project reports how many pairs hold at least 5 sessions on each side", () => {
  const rows = [];
  for (let i = 0; i < 5; i += 1) { rows.push(row("a", true, "m", 0, 10, 0)); rows.push(row("a", false, "m", 0, 5, 0)); }
  rows.push(row("b", true, "m", 0, 10, 0), row("b", false, "m", 0, 5, 0));
  const w = aggregate(rows).withinProject;
  assert.equal(w.overall.pairs, 2);
  assert.equal(w.overall.pairsWithAtLeast5PerSide, 1);
});

unitTest("B1 with no project holding both sides the delta is null, not zero", () => {
  const w = aggregate([row("a", true, "m", 0, 10, 0)]).withinProject;
  assert.equal(w.overall.pairs, 0);
  assert.equal(w.overall.medianDeltaTotal, null);
});

unitTest("B1 the serialised aggregate's keys are an allowlist and no fixture string appears in it", () => {
  const rows = [
    row("SECRET-PROJECT-1", true, "claude-opus-4-7", 2, 100, 10), row("SECRET-PROJECT-1", false, "claude-opus-4-7", 2, 50, 10),
    row("SECRET-PROJECT-2", true, "claude-opus-4-7", 2, 120, 10), row("SECRET-PROJECT-2", false, "claude-opus-4-7", 2, 60, 10),
  ];
  const a = aggregate(rows, { skipped: {}, excludedProjects: { highway: 2 } });
  const json = JSON.stringify(a);
  assert.doesNotMatch(json, /SECRET/);
  const keys = new Set();
  JSON.stringify(a, (k, v) => { if (k !== "" && !/^\d+$/.test(k)) keys.add(k); return v; });
  // reason keys under excluded.byReason are data, not schema: drop them before the allowlist compare.
  for (const r of Object.keys(a.excluded.byReason)) keys.delete(r);
  for (const k of keys) assert.ok(AGGREGATE_KEYS.includes(k), `unlisted key in the aggregate: ${k}`);
});

unitTest("B1 an odd model id cannot smuggle text into the aggregate", () => {
  const a = aggregate([row("p", true, "weird model with spaces and SECRET text", 1, 1, 1)]);
  assert.equal(a.groups[0].model, "other");
});
