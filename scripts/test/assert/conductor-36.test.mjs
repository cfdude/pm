// scripts/test/assert/conductor-36.test.mjs
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

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, readState, expectFail } from "../fixtures/assert-harness.mjs";

function refusal(fn) {
  const e = expectFail(fn);
  assert.ok(e, "expected a refusal, got a successful run");
  assert.notEqual(e.status, 0, "a refusal must exit non-zero");
  return (e.stderr || "") + (e.stdout || "");
}

const archived = (cwd, id, extra = []) =>
  run(["update-epic", id, "--status", "archived", "--outcome", "killed", "--reason", "r", ...extra], { cwd });

function repoWithEpic(id = "t1", lane = "claude-code") {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", id, "--title", "T", "--lane", lane], { cwd });
  return cwd;
}
const assertionOf = (cwd, id) => readState(cwd).epics.find(e => e.id === id).deferralAssertion;

// ═══════════════ #165a — the separator ═══════════════

test("a single colon still splits exactly as it always did", () => {
  const cwd = repoWithEpic();
  archived(cwd, "t1", ["--declined-deferral", "prose help per flag:not worth ~100 rows"]);
  assert.deepEqual(assertionOf(cwd, "t1").declined,
    [{ what: "prose help per flag", reason: "not worth ~100 rows" }]);
});

test("a colon inside <what> is REFUSED, not silently truncated", () => {
  const cwd = repoWithEpic();
  const err = refusal(() => archived(cwd, "t1",
    ["--declined-deferral", "Set alwaysLoad:false to reclaim RAM:declined because X"]));
  assert.match(err, /ambiguous/i, "the refusal must name the ambiguity");
  assert.match(err, /::/, "and must show the explicit separator");
  assert.equal(readState(cwd).epics.find(e => e.id === "t1").deferralAssertion, undefined,
    "a refusal must write nothing at all");
});

test("`::` is the explicit separator and keeps every colon in <what>", () => {
  const cwd = repoWithEpic();
  archived(cwd, "t1", ["--declined-deferral", "Set alwaysLoad:false to reclaim RAM::declined because X"]);
  assert.deepEqual(assertionOf(cwd, "t1").declined,
    [{ what: "Set alwaysLoad:false to reclaim RAM", reason: "declined because X" }]);
});

test("`::` splits on the FIRST `::`, so a reason may contain one", () => {
  const cwd = repoWithEpic();
  archived(cwd, "t1", ["--declined-deferral", "a:b::because c::d"]);
  assert.deepEqual(assertionOf(cwd, "t1").declined, [{ what: "a:b", reason: "because c::d" }]);
});

test("a value with no separator at all is refused rather than recorded reasonless", () => {
  const cwd = repoWithEpic();
  const err = refusal(() => archived(cwd, "t1", ["--declined-deferral", "no separator here"]));
  assert.match(err, /separator|:/, "the refusal must name what is missing");
});

test("--deferral is UNCHANGED — its left half is an epic id and cannot carry a colon", () => {
  const cwd = repoWithEpic();
  run(["add-epic", "--id", "t2", "--title", "T2", "--lane", "claude-code"], { cwd });
  archived(cwd, "t1", ["--deferral", "t2:design.md § Deferred: the tricky part"]);
  assert.deepEqual(assertionOf(cwd, "t1").deferrals,
    [{ epic: "t2", section: "design.md § Deferred: the tricky part" }],
    "a colon in <section> is part of the section, not an ambiguity");
});

// ═══════════════ #165b — the silent no-op ═══════════════

test("a deferral flag without archiving is REFUSED, not reported as updated", () => {
  const cwd = repoWithEpic();
  archived(cwd, "t1", ["--no-deferrals"]);
  const before = JSON.stringify(assertionOf(cwd, "t1"));
  const err = refusal(() => run(["update-epic", "t1", "--declined-deferral", "a:b"], { cwd }));
  assert.match(err, /archiv/i, "the refusal must say when an assertion is recorded");
  assert.match(err, /correct-disposition/,
    "and must name the correction path, which exists and was merely undiscoverable");
  assert.equal(JSON.stringify(assertionOf(cwd, "t1")), before, "and must write nothing");
});

test("the correction path still works — this refusal must not close the only door", () => {
  const cwd = repoWithEpic();
  archived(cwd, "t1", ["--declined-deferral", "wrong what:wrong why"]);
  const first = assertionOf(cwd, "t1").assertedAt;
  run(["update-epic", "t1", "--status", "archived", "--outcome", "killed", "--reason", "r",
       "--correct-disposition", "the what half was wrong",
       "--declined-deferral", "right what:right why"], { cwd });
  const after = assertionOf(cwd, "t1");
  assert.deepEqual(after.declined, [{ what: "right what", reason: "right why" }]);
  assert.notEqual(after.assertedAt, first, "a correction re-asserts, so the timestamp moves");
});

// ═══════════════ #159 — the missing reader ═══════════════

test("bare `set-gate-guard` REPORTS the state instead of printing usage", () => {
  const cwd = repoWithEpic();
  run(["set-gate-guard", "on"], { cwd });
  const out = run(["set-gate-guard"], { cwd });
  assert.match(out, /on/i, "it must say what the flag is");
  assert.doesNotMatch(out, /^usage:/m, "a read is not a usage error");
});

test("the reader states what the value MEANS, and what it cannot tell you", () => {
  const cwd = repoWithEpic();
  run(["set-gate-guard", "on"], { cwd });
  const out = run(["set-gate-guard"], { cwd });
  assert.match(out, /reconcile/i, "it must say which obligation the guard enforces");
  assert.match(out, /not|no epic|nothing/i,
    "it must say that 'on' alone does not mean something is currently blocked");
});

test("both values read back, and reading never writes", () => {
  const cwd = repoWithEpic();
  run(["set-gate-guard", "off"], { cwd });
  const before = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
  const out = run(["set-gate-guard"], { cwd });
  assert.match(out, /off/i);
  assert.equal(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"), before,
    "the read surface must not write state");
});

test("an unknown argument is still refused — the reader must not swallow a typo", () => {
  const cwd = repoWithEpic();
  const err = refusal(() => run(["set-gate-guard", "maybe"], { cwd }));
  assert.match(err, /on\|off/);
});

// ═══════════════ #163 — the ARCHIVE GATE stays openspec-only ═══════════════

test("the ARCHIVE GATE stays openspec-only — recording a verdict must not add an obligation", () => {
  const cwd = repoWithEpic("cc", "claude-code");
  run(["record-gate-review", "cc", "--gate", "1", "--verdict", "pass", "--artifact", "docs/plan.md"], { cwd });
  run(["update-epic", "cc", "--status", "archived", "--outcome", "delivered", "--no-deferrals"], { cwd });
  assert.equal(readState(cwd).epics.find(e => e.id === "cc").status, "archived");
});

test("an openspec-lane epic still cannot be delivered without a passing Gate 2", () => {
  const cwd = repoWithEpic("sp", "openspec");
  assert.ok(expectFail(() => run(["update-epic", "sp", "--status", "archived", "--outcome", "delivered", "--no-deferrals"], { cwd })));
});

test("a NON-openspec-lane epic still archives without a verdict — the gate did not spread", () => {
  const cwd = repoWithEpic("cc", "claude-code");
  run(["update-epic", "cc", "--status", "archived", "--outcome", "delivered", "--no-deferrals"], { cwd });
  assert.equal(readState(cwd).epics.find(e => e.id === "cc").status, "archived");
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
