// scripts/test/unit/conductor-08.test.mjs
// 4.1's migration of `assert/conductor-08.test.mjs` — 15 of its 15 tests, moved from the file rung to
// the unit rung with every assertion unchanged. The file is GONE from the file rung.
//
// 5.3's ASSERTION TWIN of scripts/test/functional/conductor-08.test.mjs — same id, same subject.
//
// EVERY OBSERVABLE IN IT IS A VALUE. The honcho-memory family prints a line and appends it to a
// store-owned log; the lane-routing family reads and writes `laneRouting` in the RECORD; the
// suggest-lane trio reads a JSON payload off stdout; and the two auto-detour tests in the
// no-repository world assert the detour LOG, which is the store's. Nothing here reads a path the
// store does not own, so nothing here belongs on the file rung.
//
// The functional file keeps the three POSITIVE auto-detour tests and the three shape-based
// negatives: they need a real commit and a real diff for the hook to OBSERVE a landing, which is
// design D5's own division. What this half proves is the other side of that guard — an unverifiable
// HEAD writes nothing at all, and a live detour frame takes the DETOUR-COMMIT path.
//
//   `tmpRepo()` + `run(["init"], { cwd })`  →  `memoryEngine(emptyRecord())`
//   `writeState(cwd, record)`               →  `memoryEngine(record)`
//   `readState(cwd)`                        →  `engine.store.record()`
//   `detourLog(cwd)`                        →  `engine.store.exists("detours.log") ? store.read(…).text : ""`

import assert from "node:assert/strict";
import { emptyRecord, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

const readState = (engine) => engine.store.record();

/** `detourLog()`'s store sibling: the artifact the log verb writes is the STORE's, so its absence is
 *  `store.exists` and its contents are `store.read` — the same pair the file rung's helper merges. */
const detourLog = (engine) =>
  engine.store.exists("detours.log") ? engine.store.read("detours.log").text : "";

/** `autoDetourState()`'s record, verbatim — the fixture's whole content is the record it wrote. */
const autoDetourRecord = (id = "epic-a") => ({
  version: 1, active: id, detourStack: [],
  epics: [{ id, title: id, priority: "P1", status: "in-progress", role: "epic", lane: "claude-code", links: [], reconcileNeeded: false }],
});

// ─────────────── honcho-memory: push/pop ready-to-copy line ───────────────

unitTest("honcho-memory push prints the exact ready-to-copy line and appends it to .conductor/honcho-memories.log", () => {
  const engine = memoryEngine(emptyRecord());
  const out = engine(["honcho-memory", "push", "parent-epic", "blocking bug in shared lib"]);
  assert.equal(out.trim(), "paused parent-epic for blocking bug in shared lib");

  const logged = engine.store.read("honcho-memories.log").text.trim().split("\n");
  assert.equal(logged.length, 1);
  const [ts, line] = logged[0].split("\t");
  assert.ok(!Number.isNaN(Date.parse(ts)), "first field should be an ISO timestamp");
  assert.equal(line, "paused parent-epic for blocking bug in shared lib");
});

unitTest("honcho-memory pop prints the resume line, formatted differently from push", () => {
  const engine = memoryEngine(emptyRecord());
  const out = engine(["honcho-memory", "pop", "parent-epic", "detour-fix-shared-lib"]);
  assert.equal(out.trim(), "resumed parent-epic, reconciled vs detour-fix-shared-lib");
});

unitTest("honcho-memory appends multiple emissions to the same log file, one line each", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["honcho-memory", "push", "epic-a", "reason one"]);
  engine(["honcho-memory", "pop", "epic-a", "detour-a"]);
  const lines = engine.store.read("honcho-memories.log").text.trim().split("\n");
  assert.equal(lines.length, 2);
  assert.match(lines[0], /paused epic-a for reason one$/);
  assert.match(lines[1], /resumed epic-a, reconciled vs detour-a$/);
});

unitTest("honcho-memory rejects an unknown action", () => {
  const engine = memoryEngine(emptyRecord());
  assert.throws(() => engine(["honcho-memory", "sideways", "epic-a", "reason"]));
});

// ──────────────── the auto-detour family, in the no-repository world ────────────────
//
// `commit-nudge` decides by OBSERVING the repo (commit-watch). With no repository the double answers
// headRef with status 128, so nothing is observed to have landed — and a hook that wrote an
// AUTO-DETOUR row on an unverifiable HEAD is exactly the false attribution gh#65/gh#68 are about.
// The detour log must therefore stay absent, not merely lack the string.

unitTest("commit-nudge witnesses no landing without a repository, so it writes no detour row at all", () => {
  const engine = memoryEngine(autoDetourRecord());
  engine(["commit-nudge"], { input: JSON.stringify({ tool_input: { command: 'git commit -m "fix: correct off-by-one in renderer"' } }) });
  assert.equal(detourLog(engine), "", "an unverifiable HEAD must produce no detour row, not a wrong one");
});

unitTest("commit-nudge inside a live detour takes the DETOUR-COMMIT path, never AUTO-DETOUR, and records `-` as 'cannot tell'", () => {
  const engine = memoryEngine({
    version: 1, active: "paused-a", detourStack: [
      { pausedEpic: "paused-a", pausedAt: "2026-07-15T00:00:00Z", reason: "x", spawnedDetour: "detour-1", reconcileOnResume: false },
    ],
    epics: [
      { id: "paused-a", title: "paused-a", priority: "P1", status: "paused", role: "epic", lane: "claude-code", links: [], reconcileNeeded: false },
      { id: "detour-1", title: "detour-1", priority: "P1", status: "in-progress", role: "detour", lane: "claude-code", links: [], reconcileNeeded: false },
    ],
  });
  engine(["commit-nudge"], { input: JSON.stringify({ tool_input: { command: 'git commit -m "fix: patch the thing"' } }) });
  const log = detourLog(engine);
  // The DETOUR-COMMIT path is selected by the live frame, not by an observation, so it writes here
  // — and its sha field is the literal `-`, which is gh#81's "with no git at all, `-` is 'cannot
  // tell'": a row that must never be collapsed together with another `-` row.
  assert.match(log, /\tDETOUR-COMMIT\tdetour-1\t/);
  assert.match(log, /\t-\tDETOUR-COMMIT\t/, "no repository: the sha field is `-`, not an invented name");
  assert.doesNotMatch(log, /AUTO-DETOUR/, "the live detour's own path wins; AUTO-DETOUR must not be reached");
});

// ─────────────────── lane-routing overrides ───────────────────

unitTest("set-lane-routing --add writes a laneRouting.overrides block", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["set-lane-routing", "--add", "billing-*:openspec", "--add", "hotfix:claude-code"]);
  const lr = readState(engine).laneRouting;
  assert.deepEqual(lr.overrides, [
    { match: "billing-*", lane: "openspec" },
    { match: "hotfix", lane: "claude-code" },
  ]);
});

unitTest("set-lane-routing rejects an override naming an unknown lane", () => {
  const engine = memoryEngine(emptyRecord());
  assert.throws(() => engine(["set-lane-routing", "--add", "foo:not-a-lane"]));
});

unitTest("set-lane-routing rejects a malformed override (missing ':lane')", () => {
  const engine = memoryEngine(emptyRecord());
  assert.throws(() => engine(["set-lane-routing", "--add", "no-colon-here"]));
});

unitTest("set-lane-routing --remove drops a single override by its match string", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["set-lane-routing", "--add", "billing-*:openspec", "--add", "hotfix:claude-code"]);
  engine(["set-lane-routing", "--remove", "hotfix"]);
  const lr = readState(engine).laneRouting;
  assert.deepEqual(lr.overrides, [{ match: "billing-*", lane: "openspec" }]);
});

unitTest("set-lane-routing --clear empties the overrides list", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["set-lane-routing", "--add", "billing-*:openspec"]);
  engine(["set-lane-routing", "--clear"]);
  const lr = readState(engine).laneRouting;
  assert.deepEqual(lr.overrides, []);
});

unitTest("suggest-lane matches an exact keyword override before falling back", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["set-lane-routing", "--add", "hotfix:claude-code"]);
  const out = engine(["suggest-lane", "urgent hotfix for prod"]).trim();
  const parsed = JSON.parse(out);
  assert.equal(parsed.lane, "claude-code");
  assert.equal(parsed.matched, "hotfix");
});

unitTest("suggest-lane matches a glob-style override (billing-*)", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["set-lane-routing", "--add", "billing-*:openspec"]);
  const out = JSON.parse(engine(["suggest-lane", "billing-refund-flow"]).trim());
  assert.equal(out.lane, "openspec");
  assert.equal(out.matched, "billing-*");
});

unitTest("suggest-lane with no matching override reports no override so the generic heuristic applies", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["set-lane-routing", "--add", "hotfix:claude-code"]);
  const out = JSON.parse(engine(["suggest-lane", "brand new capability"]).trim());
  assert.equal(out.lane, null);
  assert.equal(out.matched, null);
});

unitTest("suggest-lane with no laneRouting configured at all reports no override", () => {
  const engine = memoryEngine(emptyRecord());
  const out = JSON.parse(engine(["suggest-lane", "anything"]).trim());
  assert.equal(out.lane, null);
});
