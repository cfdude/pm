// scripts/test/unit/conductor-05.test.mjs
// 4.1's migration of `assert/conductor-05.test.mjs` — 19 of its 30 tests, moved from the file rung to
// the unit rung with every assertion unchanged.
//
// ─────────────── WHAT MOVED, AND WHAT DID NOT ───────────────
//
// Nineteen moved: the story toggles and their refusals, the rules block's Review-mode and Feedback
// sections, set-gate-guard, all five gate-guard cases (its JSON payload rides the options bag's
// `input`), three brief/tracker-drift tests, and `add-many --from -` — which reads its batch off
// STDIN, so it needs no file at all.
//
// ELEVEN STAY, in three groups:
//
//   * THREE review-mode tests. `set-review-mode` refreshes the managed rules block as a side effect
//     (`review-mode.mjs` → `writeRules()` → `writeFileSync` on CLAUDE.md), which is a repository file
//     the store does not own. Probed rather than assumed: the verb's write is `CLAUDE.md`, and the
//     unit rung's counter names it.
//   * TWO tracker tests, one of which asserts on `claudeMd(cwd)` — CLAUDE.md's managed block — and
//     both of which run `set-tracker`, which writes that same file.
//   * SIX `add-many` tests whose fixture is a BATCH FILE (`writeBatch()` writes `batch.json`).
//
// The mechanism that changed:
//
//   `tmpRepo()` + `run(["init"], { cwd })`  →  `memoryEngine(emptyRecord())`
//   `writeState(cwd, wholeRecord)`          →  a `memoryEngine(wholeRecord)` seed
//   `run(args, { cwd })`                    →  `engine(args)`
//   `run(args, { cwd, input })`             →  `engine(args, { input })`
//   `readState(cwd)`                        →  `engine.store.record()`
//   `fs.readFileSync(…/state.json)`         →  `engine.store.read("state.json").text`
//   `parseBrief(cwd)`                       →  the `brief` verb's own stdout, parsed the same way

import assert from "node:assert/strict";
import { emptyRecord, expectFail, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

const readState = (engine) => engine.store.record();
const parseBrief = (engine) =>
  JSON.parse(engine(["brief"])).hookSpecificOutput.additionalContext;

unitTest("update-epic --add-story appends { title, done: false } to a fresh stories[] array", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code"]);
  engine(["update-epic", "a", "--add-story", "First story"]);
  const epic = readState(engine).epics.find(e => e.id === "a");
  assert.deepEqual(epic.stories, [{ title: "First story", done: false }]);
});
unitTest("update-epic --add-story appends to an existing stories[] array without disturbing earlier entries", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code"]);
  engine(["update-epic", "a", "--add-story", "First story"]);
  engine(["update-epic", "a", "--add-story", "Second story"]);
  const epic = readState(engine).epics.find(e => e.id === "a");
  assert.deepEqual(epic.stories, [
    { title: "First story", done: false },
    { title: "Second story", done: false },
  ]);
});
unitTest("update-epic --add-story rejects an empty/blank title and writes nothing", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code"]);
  const before = engine.store.read("state.json").text;
  const err = expectFail(() => engine(["update-epic", "a", "--add-story", "   "]));
  assert.ok(err);
  assert.match(String(err.stderr || err.message), /non-empty title/);
  assert.equal(engine.store.read("state.json").text, before);
});
unitTest("update-epic --story <n> --done marks the n-th (1-indexed) story done, leaving others untouched", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code"]);
  engine(["update-epic", "a", "--add-story", "First story"]);
  engine(["update-epic", "a", "--add-story", "Second story"]);
  engine(["update-epic", "a", "--story", "2", "--done"]);
  const epic = readState(engine).epics.find(e => e.id === "a");
  assert.deepEqual(epic.stories, [
    { title: "First story", done: false },
    { title: "Second story", done: true },
  ]);
});
unitTest("update-epic --story out of range (including 0, and beyond the array length) is rejected and writes nothing", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code"]);
  engine(["update-epic", "a", "--add-story", "Only story"]);
  const before = engine.store.read("state.json").text;
  for (const bad of ["0", "2", "-1"]) {
    const err = expectFail(() => engine(["update-epic", "a", "--story", bad, "--done"]));
    assert.ok(err, `expected --story ${bad} to be rejected`);
    assert.match(String(err.stderr || err.message), /out of range/);
  }
  assert.equal(engine.store.read("state.json").text, before);
});

// gh#95 amended this contract: `--story <n>` now takes TWO mutations, `--done` and
// `--wont-do "<reason>"`, so the refusal names both rather than "--done" alone.
unitTest("update-epic --story without a mutation is rejected naming both, and --done without --story is rejected", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code"]);
  engine(["update-epic", "a", "--add-story", "Only story"]);
  const err1 = expectFail(() => engine(["update-epic", "a", "--story", "1"]));
  assert.ok(err1);
  assert.match(String(err1.stderr || err1.message), /requires a mutation/);
  assert.match(String(err1.stderr || err1.message), /--done/);
  const err2 = expectFail(() => engine(["update-epic", "a", "--done"]));
  assert.ok(err2);
  assert.match(String(err2.stderr || err2.message), /requires --story/);
});
unitTest("update-epic rejects an unrecognized flag instead of silently no-op'ing, and writes nothing", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--title", "Original", "--lane", "claude-code"]);
  const before = engine.store.read("state.json").text;
  const err = expectFail(() => engine(["update-epic", "a", "--titel", "Typo'd flag name"]));
  assert.ok(err, "expected non-zero exit for an unknown flag");
  assert.match(String(err.stderr || err.message), /unknown flag/);
  assert.equal(engine.store.read("state.json").text, before);
  assert.equal(readState(engine).epics.find(e => e.id === "a").title, "Original");
});
unitTest("rules block always includes the Review mode section, defaulting to standard when never set", () => {
  const engine = memoryEngine(emptyRecord());
  const out = engine(["rules"]);
  assert.match(out, /## Review mode/);
  assert.match(out, /set-review-mode/);
  assert.match(out, /\| `off` \|/);
  assert.match(out, /\| `standard` \|/);
  assert.match(out, /\| `thorough` \|/);
  assert.match(out, /Current mode: \*\*standard\*\*/);
});
unitTest("rules block always includes the Feedback section encouraging /pm:feedback adoption", () => {
  const engine = memoryEngine(emptyRecord());
  const out = engine(["rules"]);
  assert.match(out, /## Feedback/);
  assert.match(out, /\/pm:feedback \[bug\|feature\]/);
  assert.match(out, /want me to file this as feedback/i);
});
unitTest("set-gate-guard toggles the opt-in flag and rejects an invalid value", () => {
  const engine = memoryEngine(emptyRecord());
  assert.equal(readState(engine).gateGuard, undefined);   // off by default, never written until set
  engine(["set-gate-guard", "on"]);
  assert.equal(readState(engine).gateGuard, true);
  engine(["set-gate-guard", "off"]);
  assert.equal(readState(engine).gateGuard, false);
  assert.ok(expectFail(() => engine(["set-gate-guard", "bogus"])), "invalid value rejected");
});
unitTest("gate-guard blocks by default (no set-gate-guard needed) when the active epic owes a reconcile", () => {
    const engine = memoryEngine({ version: 1, active: "a", detourStack: [], epics: [
    { id: "a", title: "a", priority: "P1", status: "active", role: "epic", lane: "claude-code", links: [], reconcileNeeded: true },
  ]});
  const err = expectFail(() => engine(["gate-guard"], { input: "{}" }));
  assert.ok(err, "expected a block");
  assert.match(String(err.stderr || err.message), /still owes a reconcile/);
});
unitTest("gate-guard blocks (exit non-zero, reason on stderr) when enabled and the active epic owes a reconcile", () => {
    const engine = memoryEngine({ version: 1, active: "a", detourStack: [], gateGuard: true, epics: [
    { id: "a", title: "a", priority: "P1", status: "active", role: "epic", lane: "claude-code", links: [], reconcileNeeded: true },
  ]});
  const err = expectFail(() => engine(["gate-guard"], { input: "{}" }));
  assert.ok(err, "expected a block");
  assert.match(String(err.stderr || err.message), /still owes a reconcile/);
});
unitTest("gate-guard does not block when enabled but the active epic does not owe a reconcile", () => {
    const engine = memoryEngine({ version: 1, active: "a", detourStack: [], gateGuard: true, epics: [
    { id: "a", title: "a", priority: "P1", status: "active", role: "epic", lane: "claude-code", links: [], reconcileNeeded: false },
  ]});
  engine(["gate-guard"], { input: "{}" });   // does not throw
});
unitTest("gate-guard does not block when explicitly off and the active epic does not owe a reconcile", () => {
    const engine = memoryEngine({ version: 1, active: "a", detourStack: [], gateGuard: false, epics: [
    { id: "a", title: "a", priority: "P1", status: "active", role: "epic", lane: "claude-code", links: [], reconcileNeeded: false },
  ]});
  engine(["gate-guard"], { input: "{}" });   // does not throw
});
unitTest("gate-guard still blocks on reconcileNeeded even when explicitly set off (reconcile safety overrides the opt-out)", () => {
    const engine = memoryEngine({ version: 1, active: "a", detourStack: [], gateGuard: false, epics: [
    { id: "a", title: "a", priority: "P1", status: "active", role: "epic", lane: "claude-code", links: [], reconcileNeeded: true },
  ]});
  const err = expectFail(() => engine(["gate-guard"], { input: "{}" }));
  assert.ok(err, "expected a block even with gateGuard explicitly off");
  assert.match(String(err.stderr || err.message), /still owes a reconcile/);
});
unitTest("brief surfaces create-issue drift only for unmirrored active-work epics", () => {
    const engine = memoryEngine({ version: 1, active: null, detourStack: [],
    tracker: { system: "jira", projectKey: "JOB", statusIntent: {} },
    epics: [
      { id: "m1", title: "m1", priority: "P1", status: "queued", role: "epic", lane: "external", links: [] },                       // unmirrored → listed
      { id: "m2", title: "m2", priority: "P1", status: "active", role: "epic", lane: "external", externalId: "JOB-2", links: [] },   // mirrored → excluded
      { id: "done", title: "done", priority: "P1", status: "archived", role: "epic", lane: "external", links: [] },                  // archived → excluded
      { id: "later", title: "later", priority: "P1", status: "planned", role: "epic", lane: "external", links: [] },                 // planned → excluded
      { id: "ghost", title: "ghost", priority: "P1", status: "queued", role: "epic", lane: "openspec", links: [] },                  // missing() openspec → excluded
    ]});
  const brief = parseBrief(engine);
  assert.match(brief, /TRACKER SYNC \(jira · JOB\)/);
  const syncLine = brief.split("\n").find(l => /not yet in jira/.test(l)) || "";
  assert.match(syncLine, /`m1`/);
  for (const id of ["m2", "done", "later", "ghost"]) assert.doesNotMatch(syncLine, new RegExp(`\`${id}\``));
});
unitTest("no tracker block → no TRACKER SYNC in the brief", () => {
    const engine = memoryEngine({ version: 1, active: null, detourStack: [], epics: [
    { id: "x", title: "x", priority: "P1", status: "queued", role: "epic", lane: "external", links: [] }]});
  assert.doesNotMatch(parseBrief(engine), /TRACKER SYNC/);
});
unitTest("brief invents no transition drift when all active epics are mirrored", () => {
    const engine = memoryEngine({ version: 1, active: null, detourStack: [],
    tracker: { system: "jira", projectKey: "JOB", statusIntent: { archived: "done" } },
    epics: [{ id: "m", title: "m", priority: "P1", status: "active", role: "epic", lane: "external", externalId: "JOB-1", links: [] }]});
  const brief = parseBrief(engine);
  assert.doesNotMatch(brief, /not yet in jira/);                       // nothing to create
  // Scope to the TRACKER SYNC block specifically — the brief's SessionStart upgrade nudge
  // (added in 0.13.0) can legitimately inline CHANGELOG bullet text containing words like
  // "drift" for unrelated reasons (e.g. a changelog entry about doc-drift detection), so a
  // whole-brief search for these words is too broad and produces false positives.
  const trackerBlock = brief.split(/\n\n/).find(b => b.startsWith("TRACKER SYNC")) || "";
  assert.doesNotMatch(trackerBlock, /transition pending|out of sync|drift/i); // no fabricated transition drift
});
unitTest("add-many reads a batch from stdin (--from -)", () => {
  const engine = memoryEngine(emptyRecord());
  const batch = JSON.stringify({ epics: [{ id: "s1", lane: "external", priority: "P1" }] });
  engine(["add-many", "--from", "-"], { input: batch });
  assert.ok(readState(engine).epics.find(e => e.id === "s1"));
});
