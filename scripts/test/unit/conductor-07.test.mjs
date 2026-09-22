// scripts/test/unit/conductor-07.test.mjs
// 4.1's migration of `assert/conductor-07.test.mjs` — 18 of its 23 tests, moved from the file rung to
// the unit rung with every assertion unchanged.
//
// ─────────────── WHAT MOVED, AND WHAT DID NOT ───────────────
//
// EIGHTEEN moved: `changesets` on an absent directory, all four `render --diff-summary` cases, the
// two plan-hierarchy tests, all four engine-banner tests, the five timestamp/staleness tests, and
// `verify-state` on a record that was never rendered.
//
// THE INTERESTING PART OF THIS MOVE IS THAT THREE FIXTURES BECAME STORE OPERATIONS RATHER THAN
// DISAPPEARING. `render --diff-summary` and `verify-state` compare an artifact against the record, so
// their fixtures manipulate an ARTIFACT — and every artifact they touch is store-owned:
//
//   `fs.rmSync(PROJECT.md)`              →  `engine.store.remove("PROJECT.md")`
//   `fs.writeFileSync(detours.log, …)`   →  `engine.store.write("detours.log", …)`
//   `fs.appendFileSync(detours.log, …)`  →  `engine.store.append("detours.log", …)`
//   `fs.writeFileSync(PROJECT.md, …)`    →  `engine.store.write("PROJECT.md", …)`
//
// The tests did not change and neither did what they prove; the seam simply already had the operation.
//
// FIVE STAY, and two of them name a SEAM GAP rather than a rule:
//
//   * two `changesets` tests write `.changesets/*.md` — a repository directory the store does not own;
//   * `verify-state`'s hand-edit test forces state.json's MTIME forward with `utimesSync`, because
//     mtime ordering IS the subject of that comparison;
//   * THE OTHER TWO ARE THE FINDING. `verifyState()` reads its stamp with
//     `readJSON(renderStampPath(), null)` and state.json's mtime with `fs.statSync(statePath())` —
//     RAW PATHS, while `render.mjs` WRITES both through the store (`store.mtimeMs(ARTIFACT.RECORD)`,
//     `store.write(ARTIFACT.RENDER_STAMP, …)`). So the writer went through the seam and the reader did
//     not, and a memory-store render leaves verify-state reporting "no render stamp found" while
//     `store.exists("render-stamp.json")` is true. Probed, not inferred. The fix is a two-line seam
//     change in `worktree-hygiene.mjs` (read the stamp and the mtime through `storeOps()`), and it is
//     NOT taken in a per-file migration commit: it changes what an engine VERB reads, which deserves
//     its own commit and its own review rather than a ride on a test move. Recorded in
//     worklist-4.1.md as the batch's finding.
//
//   `tmpRepo()` + `run(["init"], { cwd })`  →  `memoryEngine(emptyRecord())`
//   `run(args, { cwd })`                    →  `engine(args)`
//   `run(args, { cwd, env })`               →  `engine(args, { env })`
//   `runCombined(args, { cwd })`            →  `engine.combined(args)`
//   `invokeEngine(args, { cwd, env })`      →  `engine.result(args, { env })`
//   `readState(cwd)`                        →  `engine.store.record()`
//   `projectMd(cwd)` / `parseBrief(cwd)`    →  `store.read("PROJECT.md").text` / the `brief` verb's stdout
//   `writeState(cwd, s)` (partial edit)     →  GONE: the mutation the test made IS the write

import assert from "node:assert/strict";
import { emptyRecord, expectFail, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

const readState = (engine) => engine.store.record();
const projectMd = (engine) => engine.store.read("PROJECT.md").text;
const parseBrief = (engine) =>
  JSON.parse(engine(["brief"])).hookSpecificOutput.additionalContext;

unitTest("changesets returns an empty list when .changesets doesn't exist", () => {
  const engine = memoryEngine(emptyRecord());
  const out = JSON.parse(engine(["changesets"]));
  assert.deepEqual(out.changesets, []);
});
unitTest("render --diff-summary reports epic-relevant: yes on the very first render (no baseline to compare against)", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["render"]); // `init` renders once, establishing a PROJECT.md baseline
  engine.store.remove("PROJECT.md"); // remove it to simulate a genuine "no prior render"
  const out = engine.combined(["render", "--diff-summary"]);
  assert.match(out, /epic-relevant: yes/);
});
unitTest("render --diff-summary reports epic-relevant: no when the only diff is the 'Last rendered' timestamp", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["render"]);   // `init` renders once, which is the baseline this test needs
  const out = engine.combined(["render", "--diff-summary"]);
  assert.match(out, /epic-relevant: no/);
});
unitTest("render --diff-summary reports epic-relevant: no when the only diff is Recent-detours table rotation", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code"]);
  // Simulate detour-log rotation directly (log-detour requires a real git SHA context this
  // fixture doesn't have) -- append rows to .conductor/detours.log, the file render() reads
  // to build the "Recent detours" table, then re-render.
  engine.store.write("detours.log", "2026-07-01T00:00:00Z\tabc1234\tminimal\ta\tfirst rotation entry\n");
  const out1 = engine.combined(["render", "--diff-summary"]);
  assert.match(out1, /epic-relevant: no/, "first rotation: no other epic-relevant content changed");

  engine.store.append("detours.log", "2026-07-02T00:00:00Z\tdef5678\tminimal\ta\tsecond rotation entry\n");
  const out2 = engine.combined(["render", "--diff-summary"]);
  assert.match(out2, /epic-relevant: no/, "further rotation: still no other epic-relevant content changed");
});
unitTest("render --diff-summary reports epic-relevant: yes when the on-disk PROJECT.md is stale relative to current state", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code"]);
  // add-epic/update-epic/etc already auto-re-render, so PROJECT.md on disk always reflects
  // current state.json by the time this call returns. Capture that as a "stale baseline" (as
  // if it were the last commit), then make a real epic-relevant change, then put the stale
  // baseline back on disk -- simulating a PROJECT.md that hasn't been re-rendered since a real
  // state change landed, which is exactly the case `--diff-summary` needs to catch.
  const staleBaseline = projectMd(engine);
  engine(["add-epic", "--id", "b", "--lane", "claude-code"]); // a real, epic-relevant change
  engine.store.write("PROJECT.md", staleBaseline);
  const out = engine.combined(["render", "--diff-summary"]);
  assert.match(out, /epic-relevant: yes/);
});

// ──────────────── verify-state ────────────────
unitTest("verify-state fails loudly when never rendered (no stamp) but state.json exists", () => {
  const engine = memoryEngine({ version: 1, active: null, detourStack: [], epics: [] });
  const err = expectFail(() => engine(["verify-state"]));
  assert.ok(err);
});
unitTest("plan-hierarchy excludes already-archived children from the plan", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "sprint", "--lane", "claude-code"]);
  engine(["add-epic", "--id", "done-child", "--lane", "claude-code", "--parent", "sprint", "--status", "archived"]);
  engine(["add-epic", "--id", "pending-child", "--lane", "claude-code", "--parent", "sprint"]);
  const out = JSON.parse(engine(["plan-hierarchy", "--parent", "sprint"]));
  const allIds = out.batches.flatMap(b => b.epics.map(e => e.id));
  assert.ok(!allIds.includes("done-child"), "archived child should not appear in the plan");
  assert.ok(allIds.includes("pending-child"), "non-archived child should still appear");
});
unitTest("plan-hierarchy on a parent whose only children are all archived returns an empty batches array", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "sprint2", "--lane", "claude-code"]);
  engine(["add-epic", "--id", "done-only", "--lane", "claude-code", "--parent", "sprint2", "--status", "archived"]);
  const out = JSON.parse(engine(["plan-hierarchy", "--parent", "sprint2"]));
  assert.deepEqual(out.batches, []);
});
unitTest("the engine banner is suppressed by default in a dev/self-hosting context (CLAUDE_PROJECT_DIR set), so it's not noise on every invocation", () => {
  const engine = memoryEngine(emptyRecord());
  // run()/runCombined() always set CLAUDE_PROJECT_DIR=engine (matching real self-hosting
  // usage), so the default here is already the suppressed case -- see the next test for the
  // opt-in override, and the one after for the banner's un-suppressed default elsewhere.
  const r = engine.combined(["render"]);
  assert.doesNotMatch(r, /conductor: engine/);
});
unitTest("PM_VERBOSE_ENGINE_BANNER=1 forces the engine banner back on even when CLAUDE_PROJECT_DIR is set", () => {
  const engine = memoryEngine(emptyRecord());
  const r = engine.combined(["render"], { env: { PM_VERBOSE_ENGINE_BANNER: "1" } });
  assert.match(r, /conductor: engine \S+ @ .*scripts/);
});
unitTest("the engine banner is shown by default when CLAUDE_PROJECT_DIR is NOT set (outside a dev/self-hosting context), so a stale cached engine is still visible there", () => {
  const engine = memoryEngine(emptyRecord());
  // CLAUDE_PROJECT_DIR ABSENT IS THE POINT of this test, so the override is an explicit `undefined`
  // rather than a deleted key: the in-process invocation spreads the caller's env over its own
  // defaults, and an absent key there would be rebuilt from the process's.
  const r = engine.result(["render"], { env: { CLAUDE_PROJECT_DIR: undefined } });
  const combined = (r.stdout || "") + (r.stderr || "");
  assert.match(combined, /conductor: engine \S+ @ .*scripts/);
});
unitTest("the engine banner stays suppressed when both CLAUDE_PROJECT_DIR and PM_QUIET_ENGINE_BANNER are set (explicit suppress, back-compat with the pre-fix default-on behavior)", () => {
  const engine = memoryEngine(emptyRecord());
  const r = engine.combined(["render"], { env: { PM_QUIET_ENGINE_BANNER: "1" } });
  assert.doesNotMatch(r, /conductor: engine/);
});

// ─────────────── timestamps + staleness ───────────────
unitTest("set-active stamps startedAt (ISO string) on first activation, and does not reset it on re-activation", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code"]);
  engine(["add-epic", "--id", "b", "--lane", "claude-code"]);
  engine(["set-active", "a"]);
  const s1 = readState(engine);
  const a1 = s1.epics.find(e => e.id === "a");
  assert.ok(a1.startedAt, "startedAt stamped");
  assert.ok(!Number.isNaN(Date.parse(a1.startedAt)), "startedAt is a valid ISO string");

  engine(["set-active", "b"]);      // demotes a
  engine(["set-active", "a"]);      // re-activate a
  const s2 = readState(engine);
  const a2 = s2.epics.find(e => e.id === "a");
  assert.equal(a2.startedAt, a1.startedAt, "re-activation does not reset startedAt");
});
unitTest("update-epic --status archived stamps completedAt", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code"]);
  engine(["set-active", "a"]);
  engine(["update-epic", "a", "--status", "archived", "--outcome", "delivered", "--no-deferrals"]);
  const s = readState(engine);
  const a = s.epics.find(e => e.id === "a");
  assert.ok(a.completedAt, "completedAt stamped");
  assert.ok(!Number.isNaN(Date.parse(a.completedAt)), "completedAt is a valid ISO string");
});
unitTest("update-epic --status queued (not archived) does not stamp completedAt", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code"]);
  engine(["set-active", "a"]);
  engine(["update-epic", "a", "--status", "queued"]);
  const s = readState(engine);
  assert.equal(s.epics.find(e => e.id === "a").completedAt, undefined);
});
unitTest("PROJECT.md and the brief flag a stale epic (startedAt > 14 days ago, no completedAt)", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code"]);
  engine(["set-active", "a"]);
  const s = readState(engine);
  const staleDate = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
  s.epics.find(e => e.id === "a").startedAt = staleDate;
  engine(["render"]);
  const md = projectMd(engine);
  assert.match(md, /⚠ stale, 20d active/);
  const brief = parseBrief(engine);
  assert.match(brief, /⚠ stale, 20d active/);
});
unitTest("an epic active fewer than 14 days is not flagged stale", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code"]);
  engine(["set-active", "a"]);
  engine(["render"]);
  const md = projectMd(engine);
  assert.doesNotMatch(md, /stale/);
});
unitTest("a completed epic is never flagged stale, even if startedAt is old", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code"]);
  engine(["set-active", "a"]);
  engine(["update-epic", "a", "--status", "archived", "--outcome", "delivered", "--no-deferrals"]);
  const s = readState(engine);
  const a = s.epics.find(e => e.id === "a");
  a.startedAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  engine(["render"]);
  const md = projectMd(engine);
  assert.doesNotMatch(md, /stale/);
});
