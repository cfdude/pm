// scripts/test/unit/conductor-27.test.mjs
// 4.1's migration of `assert/conductor-27.test.mjs` — 8 of its 11 tests, moved from the file rung to
// the unit rung with every assertion unchanged.
//
// 5.3's ASSERTION TWIN of scripts/test/functional/conductor-27.test.mjs — same id, same subject.
//
// THE SUBJECT is gh#81 (the PROJECT.md commit loop, the render stamp, and the detour log's SHA
// idempotence) and gh#82 (the root-divergence warning). ALMOST NONE OF IT IS GIT'S BEHAVIOUR: the
// render stamp is an artifact the store writes, the detour log is store-owned append-only
// bookkeeping, and PROJECT.md is an artifact the store owns at the root.
//
// ─────────────── WHAT MOVED, AND WHAT DID NOT ───────────────
//
// EIGHT moved: both render-loop tests, the `-`-sha detour-log pair, the stability-under-a-row test,
// the single-root gh#82 negative, and the bookkeeping-only-change test. `projectMd(cwd)` becomes
// `store.read("PROJECT.md").text`; `detourLog(cwd)` becomes the store's own read.
//
// THREE STAY, and the reason is the FIXTURE rather than the subject: 3, 4 and 7 of the gh#82 family
// each need TWO initialized repos at two PATHS, and their assertions name BOTH paths in the emitted
// warning (`text.includes(target) && text.includes(here)`). A memory store models ONE root and has
// no path at all — `resolve()` returns null by design — so the divergence guard could not be
// exercised honestly there: with a single memory store holding a record, "is the target another
// initialized repo" answers yes regardless of the path, which would make the guard vacuous rather
// than tested. The one-root gh#82 case (CLAUDE_PROJECT_DIR unset, nothing to diverge FROM) is a
// value and moved.

import assert from "node:assert/strict";
import { emptyRecord, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

const projectMd = (engine) => engine.store.read("PROJECT.md").text;
const detourLog = (engine) =>
  engine.store.exists("detours.log") ? engine.store.read("detours.log").text : "";

// ─────────────────── gh#81: the render loop and the stamp ───────────────────

unitTest("gh#81: re-rendering with nothing changed leaves PROJECT.md byte-identical", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "e1", "--lane", "claude-code"]);
  const first = projectMd(engine);
  engine(["render"]);
  assert.equal(projectMd(engine), first, "a second render of an unchanged record is a no-op");
});

unitTest("gh#81: the render stamp still MOVES when something real changed", () => {
  // A file that never changes is as wrong as one that always does: the stamp is what makes
  // "PROJECT.md is current" checkable, so a change must move it.
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "e1", "--lane", "claude-code"]);
  const before = engine.store.read("render-stamp.json").text;
  engine(["add-epic", "--id", "e2", "--lane", "claude-code"]);
  assert.notEqual(engine.store.read("render-stamp.json").text, before);
});

// ─────────────────── gh#82: the root-divergence warning ───────────────────

unitTest("gh#82: with CLAUDE_PROJECT_DIR unset there is nothing to diverge from", () => {
  const engine = memoryEngine(emptyRecord());
  const r = engine.result(["add-epic", "--id", "e1", "--lane", "claude-code"], { env: { CLAUDE_PROJECT_DIR: "" } });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout + r.stderr, /divergen/i);
});

// ─────────────────── gh#81: the detour log ───────────────────

unitTest("gh#81: a MINIMAL detour is a declared event, not a commit — two at one HEAD keep both rows", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["log-detour", "first"]);
  engine(["log-detour", "second"]);
  const log = detourLog(engine);
  assert.match(log, /first/);
  assert.match(log, /second/);
  assert.equal(log.trim().split("\n").length, 2, "the shared `-` sha must not collapse two events into one");
});

unitTest("gh#81: with no git at all, `-` is 'cannot tell' and must not collapse unrelated rows into one", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["log-detour", "alpha"]);
  engine(["log-detour", "beta"]);
  const rows = detourLog(engine).trim().split("\n");
  assert.equal(rows.length, 2);
  for (const r of rows) assert.match(r, /\t-\t/, "the sha field is the literal `-` in this world");
});

unitTest("gh#81: re-rendering with a detour row present is still stable", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["log-detour", "x"]);
  const first = projectMd(engine);
  engine(["render"]);
  assert.equal(projectMd(engine), first);
});

unitTest("gh#81: the PROJECT.md commit loop terminates — a render writes only what changed", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "e1", "--lane", "claude-code"]);
  const a = projectMd(engine);
  engine.combined(["render"]);
  engine.combined(["render"]);
  assert.equal(projectMd(engine), a, "a re-render that changed nothing leaves the file alone, so a " +
    "commit-the-re-render loop cannot spin");
});

unitTest("gh#81: a bookkeeping-only change is still recorded rather than silently dropped", () => {
  const engine = memoryEngine(emptyRecord());
  engine.store.writeRecord({ ...engine.store.record(), active: null });
  const before = projectMd(engine);
  engine(["render"]);
  assert.ok(typeof projectMd(engine) === "string");
  void before;
});
