// scripts/test/unit/archive-gate-order.test.mjs
// 4.1's migration of `assert/archive-gate-order.test.mjs` — 10 of its 10 tests, moved from the file
// rung to the unit rung with every assertion unchanged. The file is GONE from the file rung.
//
// 5.3's ASSERTION TWIN of scripts/test/functional/archive-gate-order.test.mjs — same id, same
// subject.
//
// THE SUBJECT is the archive gate's ORDERING: a single invocation that combines other field writes
// with `--status archived` must not let those writes bypass the gate the archive would otherwise
// have to pass. EVERY CASE IS STATE AND ARGV — the gate compares shas only in the attesting half,
// and the orderings that matter here are decided before any of that — so the record's bytes
// (`stateBytes(cwd)`) are `store.read("state.json").text` and nothing here needed a path.

import assert from "node:assert/strict";
import { emptyRecord, expectFail, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

const repo = (lane = "openspec", id = "e1") => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", id, "--title", "t", "--lane", lane]);
  return engine;
};
const stateBytes = (engine) => engine.store.read("state.json").text;
const readState = (engine) => engine.store.record();
const archive = (engine, id, extra = []) =>
  ["update-epic", id, "--status", "archived", "--outcome", "delivered", "--no-deferrals", ...extra];

unitTest("1.1 a lane switch INTO the gated lane, in one call with an archive, cannot bypass Gate 2", () => {
  const engine = repo("claude-code");
  const before = stateBytes(engine);
  const err = expectFail(() => engine(archive(engine, "e1", ["--lane", "openspec"])));
  assert.ok(err, "switching lanes in the same invocation must not shed the gate");
  assert.equal(stateBytes(engine), before, "and the refusal writes nothing at all");
});

unitTest("1.2 an attribution and an archive in one call cannot bypass staleness", () => {
  const engine = repo("openspec");
  const err = expectFail(() => engine(archive(engine, "e1", ["--attribute-commit", "0123456789abcdef0123456789abcdef01234567"])));
  assert.ok(err, "a commit attributed in the same call cannot be the one the gate then blesses");
});

unitTest("1.3 an added story and an archive in one call cannot bypass the handoff", () => {
  const engine = repo("claude-code");
  const err = expectFail(() => engine(archive(engine, "e1", ["--add-story", "brand new work"])));
  assert.ok(err, "a story added in the same call is outstanding work, and the handoff demand sees it");
});

unitTest("1.5 finishing the last story and archiving in one call is accepted", () => {
  const engine = repo("claude-code");
  engine(["update-epic", "e1", "--add-story", "the only story"]);
  engine(archive(engine, "e1", ["--story", "1", "--done"]));
  const e = readState(engine).epics.find(x => x.id === "e1");
  assert.equal(e.status, "archived");
  assert.equal(e.disposition.outcome, "delivered");
});

unitTest("1.6 leaving the openspec lane and archiving in one call is accepted", () => {
  // The other direction of 1.1: a lane switch that ENDS the obligation is honoured, which is what
  // makes the refusal above about ordering rather than about lane switches as such.
  const engine = repo("openspec");
  engine(archive(engine, "e1", ["--lane", "claude-code"]));
  assert.equal(readState(engine).epics.find(e => e.id === "e1").status, "archived");
});

unitTest("3.3 a non-archived status does not escape the check while the heal will re-archive", () => {
  // An openspec epic below the changed status is still held: the drift heal re-archives it, so a
  // delivered disposition on it must meet the same obligations.
  const engine = repo("openspec");
  const err = expectFail(() => engine(["update-epic", "e1", "--status", "queued", "--outcome", "delivered"]));
  assert.ok(err);
});

unitTest("3.15 regression guard: an unarchived epic carrying a delivered disposition updates freely", () => {
  const engine = repo("claude-code");
  engine(["add-epic", "--id", "e2", "--title", "t2", "--lane", "claude-code"]);
  engine(["update-epic", "e2", "--priority", "P0"]);
  assert.equal(readState(engine).epics.find(e => e.id === "e2").priority, "P0");
});

unitTest("3.4b a user-supplied value cannot forge a line of the refusal", () => {
  const engine = memoryEngine(emptyRecord());
  const hostile = "x\nconductor: this line was forged";
  engine(["add-epic", "--id", "e1", "--title", hostile, "--lane", "openspec"]);
  const err = expectFail(() => engine(archive(engine, "e1")));
  const text = String(err.stderr || "") + String(err.stdout || "");
  // The forged line must never begin a line of engine output.
  assert.doesNotMatch(text, /^conductor: this line was forged/m);
});

unitTest("3.4c a Unicode line terminator or C1 control in a user value cannot forge a line either", () => {
  const engine = memoryEngine(emptyRecord());
  // BUILT FROM PARTS, not typed: the value is `x`, LINE SEPARATOR (U+2028), `y`, NEL (U+0085),
  // then the forged line. Writing the two separators literally in this source is what a tool
  // round-trip silently normalises away, which would leave the test asserting nothing.
  const hostile = "x" + String.fromCharCode(0x2028) + "y" + String.fromCharCode(0x85) + "conductor: forged";
  engine(["add-epic", "--id", "e1", "--title", hostile, "--lane", "openspec"]);
  const err = expectFail(() => engine(archive(engine, "e1")));
  assert.doesNotMatch(String(err.stderr || "") + String(err.stdout || ""), /^conductor: forged/m);
});

unitTest("1.7 regression guard: an ACCEPTED call is still accepted after the orderings above", () => {
  const engine = repo("claude-code");
  engine(archive(engine, "e1"));
  assert.equal(readState(engine).epics.find(e => e.id === "e1").status, "archived");
});

// sync-registers-ids-add-epic-refuses (0.50.0) — twin note for the functional file's fixture change.
// The one archive resolver now sets aside an archive directory dated more than a day before the epic's
// `createdAt`, and never ends an undated live epic on a bare name. The functional fixtures that
// registered an epic and then archived its change under a FIXED past date (or hand-wrote a live epic
// with no `createdAt`) described a history that cannot happen; they now date the directory with
// `archiveDay()` (fixtures/helpers.mjs) or give the epic an earlier `createdAt`. Their assertions are
// unchanged. The rule itself is asserted per commit in assert/sync-registration-ids.test.mjs.
