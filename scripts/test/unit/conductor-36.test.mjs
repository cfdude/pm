// scripts/test/unit/conductor-36.test.mjs
// 4.1's migration of `assert/conductor-36.test.mjs` — ALL of it, moved from the file rung to the unit
// rung with every assertion unchanged. (The file-rung file is gone; nothing in it needed bytes on
// disk.)
//
// 5.3's ASSERTION TWIN of scripts/test/functional/conductor-36.test.mjs — same id, same subject.
//
// THE FUNCTIONAL FILE'S SUBJECT is 0.38.0's "the record says what actually happened": the `::`
// separator for free-text halves (#165a), the deferral-flag-without-archiving refusal (#165b), the
// `set-gate-guard` reader (#159), and verdicts beyond one lane (#163). Only the #163 family and the
// `--withdraw-commit` family need git — they resolve recorded commit values, and `fixtureCommits`
// spawns a repository (design D5).
//
// Everything else is decided from argv and state.json, and it is exactly the surface where a silent
// truncation or a silent no-op would otherwise go unnoticed between functional runs.
//
// WHY IT MOVED ENTIRELY: every observable is a VALUE — a recorded assertion, a refusal's text, what the
// reader PRINTED — and no fixture writes a path. The two "nothing was written" assertions read
// state.json's bytes, which the store answers.
//
//   `tmpRepo()` + `run(["init"], { cwd })`  →  `memoryEngine(emptyRecord())`
//   `run(args, { cwd })`                    →  `engine(args)`
//   `readState(cwd)`                        →  `engine.store.record()`
//   `fs.readFileSync(…/state.json)`         →  `engine.store.read("state.json").text`

import assert from "node:assert/strict";
import { emptyRecord, expectFail, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

const readState = (engine) => engine.store.record();

function refusal(fn) {
  const e = expectFail(fn);
  assert.ok(e, "expected a refusal, got a successful run");
  assert.notEqual(e.status, 0, "a refusal must exit non-zero");
  return (e.stderr || "") + (e.stdout || "");
}

const archived = (engine, id, extra = []) =>
  engine(["update-epic", id, "--status", "archived", "--outcome", "killed", "--reason", "r", ...extra]);

function repoWithEpic(id = "t1", lane = "claude-code") {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", id, "--title", "T", "--lane", lane]);
  return engine;
}
const assertionOf = (engine, id) => readState(engine).epics.find(e => e.id === id).deferralAssertion;

// ═══════════════ #165a — the separator ═══════════════

unitTest("a single colon still splits exactly as it always did", () => {
  const engine = repoWithEpic();
  archived(engine, "t1", ["--declined-deferral", "prose help per flag:not worth ~100 rows"]);
  assert.deepEqual(assertionOf(engine, "t1").declined,
    [{ what: "prose help per flag", reason: "not worth ~100 rows" }]);
});

unitTest("a colon inside <what> is REFUSED, not silently truncated", () => {
  const engine = repoWithEpic();
  const err = refusal(() => archived(engine, "t1",
    ["--declined-deferral", "Set alwaysLoad:false to reclaim RAM:declined because X"]));
  assert.match(err, /ambiguous/i, "the refusal must name the ambiguity");
  assert.match(err, /::/, "and must show the explicit separator");
  assert.equal(readState(engine).epics.find(e => e.id === "t1").deferralAssertion, undefined,
    "a refusal must write nothing at all");
});

unitTest("`::` is the explicit separator and keeps every colon in <what>", () => {
  const engine = repoWithEpic();
  archived(engine, "t1", ["--declined-deferral", "Set alwaysLoad:false to reclaim RAM::declined because X"]);
  assert.deepEqual(assertionOf(engine, "t1").declined,
    [{ what: "Set alwaysLoad:false to reclaim RAM", reason: "declined because X" }]);
});

unitTest("`::` splits on the FIRST `::`, so a reason may contain one", () => {
  const engine = repoWithEpic();
  archived(engine, "t1", ["--declined-deferral", "a:b::because c::d"]);
  assert.deepEqual(assertionOf(engine, "t1").declined, [{ what: "a:b", reason: "because c::d" }]);
});

unitTest("a value with no separator at all is refused rather than recorded reasonless", () => {
  const engine = repoWithEpic();
  const err = refusal(() => archived(engine, "t1", ["--declined-deferral", "no separator here"]));
  assert.match(err, /separator|:/, "the refusal must name what is missing");
});

unitTest("--deferral is UNCHANGED — its left half is an epic id and cannot carry a colon", () => {
  const engine = repoWithEpic();
  engine(["add-epic", "--id", "t2", "--title", "T2", "--lane", "claude-code"]);
  archived(engine, "t1", ["--deferral", "t2:design.md § Deferred: the tricky part"]);
  assert.deepEqual(assertionOf(engine, "t1").deferrals,
    [{ epic: "t2", section: "design.md § Deferred: the tricky part" }],
    "a colon in <section> is part of the section, not an ambiguity");
});

// ═══════════════ #165b — the silent no-op ═══════════════

unitTest("a deferral flag without archiving is REFUSED, not reported as updated", () => {
  const engine = repoWithEpic();
  archived(engine, "t1", ["--no-deferrals"]);
  const before = JSON.stringify(assertionOf(engine, "t1"));
  const err = refusal(() => engine(["update-epic", "t1", "--declined-deferral", "a:b"]));
  assert.match(err, /archiv/i, "the refusal must say when an assertion is recorded");
  assert.match(err, /correct-disposition/,
    "and must name the correction path, which exists and was merely undiscoverable");
  assert.equal(JSON.stringify(assertionOf(engine, "t1")), before, "and must write nothing");
});

unitTest("the correction path still works — this refusal must not close the only door", () => {
  const engine = repoWithEpic();
  archived(engine, "t1", ["--declined-deferral", "wrong what:wrong why"]);
  const first = assertionOf(engine, "t1").assertedAt;
  engine(["update-epic", "t1", "--status", "archived", "--outcome", "killed", "--reason", "r",
       "--correct-disposition", "the what half was wrong",
       "--declined-deferral", "right what:right why"]);
  const after = assertionOf(engine, "t1");
  assert.deepEqual(after.declined, [{ what: "right what", reason: "right why" }]);
  assert.notEqual(after.assertedAt, first, "a correction re-asserts, so the timestamp moves");
});

// ═══════════════ #159 — the missing reader ═══════════════

unitTest("bare `set-gate-guard` REPORTS the state instead of printing usage", () => {
  const engine = repoWithEpic();
  engine(["set-gate-guard", "on"]);
  const out = engine(["set-gate-guard"]);
  assert.match(out, /on/i, "it must say what the flag is");
  assert.doesNotMatch(out, /^usage:/m, "a read is not a usage error");
});

unitTest("the reader states what the value MEANS, and what it cannot tell you", () => {
  const engine = repoWithEpic();
  engine(["set-gate-guard", "on"]);
  const out = engine(["set-gate-guard"]);
  assert.match(out, /reconcile/i, "it must say which obligation the guard enforces");
  assert.match(out, /not|no epic|nothing/i,
    "it must say that 'on' alone does not mean something is currently blocked");
});

unitTest("both values read back, and reading never writes", () => {
  const engine = repoWithEpic();
  engine(["set-gate-guard", "off"]);
  const before = engine.store.read("state.json").text;
  const out = engine(["set-gate-guard"]);
  assert.match(out, /off/i);
  assert.equal(engine.store.read("state.json").text, before,
    "the read surface must not write state");
});

unitTest("an unknown argument is still refused — the reader must not swallow a typo", () => {
  const engine = repoWithEpic();
  const err = refusal(() => engine(["set-gate-guard", "maybe"]));
  assert.match(err, /on\|off/);
});

// ═══════════════ #163 — the ARCHIVE GATE stays openspec-only ═══════════════

unitTest("the ARCHIVE GATE stays openspec-only — recording a verdict must not add an obligation", () => {
  const engine = repoWithEpic("cc", "claude-code");
  engine(["record-gate-review", "cc", "--gate", "1", "--verdict", "pass", "--artifact", "docs/plan.md"]);
  engine(["update-epic", "cc", "--status", "archived", "--outcome", "delivered", "--no-deferrals"]);
  assert.equal(readState(engine).epics.find(e => e.id === "cc").status, "archived");
});

unitTest("an openspec-lane epic still cannot be delivered without a passing Gate 2", () => {
  const engine = repoWithEpic("sp", "openspec");
  assert.ok(expectFail(() => engine(["update-epic", "sp", "--status", "archived", "--outcome", "delivered", "--no-deferrals"])));
});

unitTest("a NON-openspec-lane epic still archives without a verdict — the gate did not spread", () => {
  const engine = repoWithEpic("cc", "claude-code");
  engine(["update-epic", "cc", "--status", "archived", "--outcome", "delivered", "--no-deferrals"]);
  assert.equal(readState(engine).epics.find(e => e.id === "cc").status, "archived");
});

// ───────────────────────── the deliberate omissions ─────────────────────────
//
// 1. The #163 positive cases ("a gate verdict records on a non-openspec lane", "evidence shas record
//    on a non-openspec lane too", "an openspec-lane epic … once gate2 has a passing verdict") each
//    need a REAL commit range: the engine resolves every recorded sha at write time, and a passing
//    Gate 2 demands checkable evidence. `fixtureCommits` spawns a repository, so they are
//    functional-only (design D5). scripts/test/assert/conductor-09.test.mjs exercises the same
//    writer through the ARTIFACT evidence kind, which needs no range.
// 2. Every `--withdraw-commit` case resolves the named sha before deciding, so it is the same
//    shape and stays functional.
