// scripts/test/unit/commit-observation.test.mjs
// 4.1's migration of `assert/commit-observation.test.mjs` — 6 of its 10 tests, moved from the file
// rung to the unit rung with every assertion unchanged.
//
// 5.3's ASSERTION TWIN of scripts/test/functional/commit-observation.test.mjs — same id, same
// subject.
//
// THE SUBJECT is the OBSERVATION mechanism: `commit-nudge` decides by reading the reflog anchor and
// the commits after it, never by reading the command text. WHAT THIS HALF OWNS IS THE DECISION MADE
// WHEN NOTHING CAN BE OBSERVED — every invocation in a project that is not a checkout: the hook falls
// back to its advisory rather than going silent, writes no anchor it could not ground, and never
// names a commit it did not see.
//
// ─────────────── WHAT MOVED, AND WHAT DID NOT ───────────────
//
// SIX moved: a commit in a failing call still observed, the advisory's no-sha claim, the retract-detour
// pair (a row that does not exist, and no reason), the "help and undeclared flags write nothing"
// sweep, and gh-137's neighbour — a commit naming the active epic's own change directory is not an
// AUTO-DETOUR. The detour log is store-owned, so `detourLog(cwd)` becomes the store's read, and
// `autoDetourState(cwd)`'s record becomes the record the store is seeded with.
//
// FOUR STAY: the shipped `hooks/hooks.json` registration, the unreadable-state row (raw bytes), the
// corrupt observation record (the fixture WRITES `.conductor/commit-observe.json`, which the store
// does not own — it is not in the ARTIFACT table), and "no anchor is written", whose observable is
// that same unreachable artifact's ABSENCE.
//
//   `tmpRepo()` + `run(["init"], { cwd })`  →  `memoryEngine(emptyRecord())`
//   `autoDetourState(cwd)`                  →  the record it wrote, seeded
//   `detourLog(cwd)`                        →  `store.exists("detours.log") ? store.read(…).text : ""`

import assert from "node:assert/strict";
import { emptyRecord, expectFail, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

const ctxOf = (out) => (out.trim() ? JSON.parse(out).hookSpecificOutput.additionalContext : "");
const nudge = (engine, command) =>
  engine(["commit-nudge"], { input: JSON.stringify({ tool_input: { command } }) });
const detourLog = (engine) =>
  engine.store.exists("detours.log") ? engine.store.read("detours.log").text : "";

/** `autoDetourState()`'s record, verbatim — the fixture's whole content is the record it wrote. */
const autoDetourRecord = (id = "epic-a") => ({
  version: 1, active: id, detourStack: [],
  epics: [{ id, title: id, priority: "P1", status: "in-progress", role: "epic", lane: "claude-code", links: [], reconcileNeeded: false }],
});

unitTest("2.3b a commit in a FAILING call is still observed — the hook runs on both events", () => {
  const engine = memoryEngine(autoDetourRecord());
  // The two registrations exist because a failing Bash call is exactly where a commit most often
  // lands (the test command after it exited non-zero). In this half neither rung can observe a
  // commit, so both must emit the SAME advisory rather than one of them going silent.
  const ok = nudge(engine, 'git commit -m "feat(x): real work"');
  assert.match(ok, /Commit detected|hookSpecificOutput/);
});

unitTest("3.1 a reported commit is stated as landed SINCE the last observation, not proven to be this call's", () => {
  const engine = memoryEngine(autoDetourRecord());
  const ctx = ctxOf(nudge(engine, 'git commit -m "fix: x"'));
  assert.doesNotMatch(ctx, /\b[0-9a-f]{7,40}\b/,
    "with no observation there is no sha, and the advisory claims no more than it can see");
});

unitTest("4.1 retract-detour on a row that does not exist is refused and writes nothing", () => {
  const engine = memoryEngine(emptyRecord());
  const before = detourLog(engine);
  const err = expectFail(() => engine(["retract-detour", "0123456789abcdef0123456789abcdef01234567",
    "--reason", "never happened"]));
  assert.ok(err, "there is no row to retract");
  assert.equal(detourLog(engine), before, "and the trail is untouched");
});

unitTest("4.3 a retraction with no reason is refused", () => {
  const engine = memoryEngine(emptyRecord());
  assert.ok(expectFail(() => engine(["retract-detour", "0123456789abcdef0123456789abcdef01234567"])));
});

unitTest("4.4 help, undeclared flags and an unanswerable tree write nothing", () => {
  const engine = memoryEngine(autoDetourRecord());
  for (const argv of [["retract-detour", "--help"], ["retract-detour", "abc", "--reason", "r", "--bogus"]]) {
    try { engine(argv); } catch { /* refusals are expected */ }
  }
  assert.equal(detourLog(engine), "");
});

unitTest("6.1 a commit touching the active epic's change directory is not an AUTO-DETOUR", () => {
  const engine = memoryEngine({ version: 1, active: "feat-x", detourStack: [], epics: [
    { id: "feat-x", title: "feat-x", priority: "P1", status: "in-progress", role: "epic",
      lane: "openspec", links: [], reconcileNeeded: false }] });
  nudge(engine, 'git commit -m "fix(feat-x): tighten validation"');
  assert.equal(detourLog(engine), "", "naming the active epic is the epic's own work, never a detour");
});
