// scripts/test/unit/drift-coupling.test.mjs
// certification-record-redesign tasks 4.1 and 4.2 (design D4, Gate 1 B3/M5, round 2 I1/I2;
// suite-certification, "Every functional test has an assertion twin sharing its id") — COUPLING TAKES A
// DECLARED TRAILER.
//
// A staged change to a functional file carries its twin in the same commit UNLESS the commit declares,
// with a `Twin-Unchanged: <id> — <reason>` git trailer, that the change leaves what the file tests
// untouched. git decides what is a trailer: the drift script hands the message to
// `git interpret-trailers --parse --no-divider` and `parseTwinExemptions()` reads only the lines git
// returned. So every input below is the OUTPUT of that command, never a raw message — a raw message's
// trailer block is git's rule to apply, and a second parser here is the disagreement the design removes.
//
// UNIT RUNG: every observable is a value a pure function returned. The hooks that feed these functions
// are exercised through real `git commit`s in `functional/conductor-09` (4.3, 4.4).

import assert from "node:assert/strict";
import * as certification from "../certification.mjs";
import { unitTest } from "../fixtures/unit-harness.mjs";

/** The certification functions this file needs, each asserted to exist — a missing one is the RED, and
 *  it should say which one rather than fail as `undefined is not a function`. */
function fn(name) {
  assert.equal(typeof certification[name], "function",
    `certification.mjs exports no ${name}(): coupling with a declared exemption (design D4) cannot be decided without it`);
  return certification[name];
}

// ───────────────────────────── 4.1 parseTwinExemptions() ─────────────────────────────

unitTest("4.1 only Twin-Unchanged trailers are read; every other trailer git returned is ignored", () => {
  const parsed = [
    "Signed-off-by: A <a@example.com>",
    "Twin-Unchanged: alpha — a comment-only edit",
    "Claude-Session: https://example.com/x",
    "Co-authored-by: B <b@example.com>",
  ].join("\n") + "\n";
  assert.deepEqual(fn("parseTwinExemptions")(parsed), [{ id: "alpha", reason: "a comment-only edit" }]);
});

unitTest("4.1 the key is matched as git's %(trailers:key=) matches it — without regard to case", () => {
  // Gate 2 audits with `%(trailers:key=Twin-Unchanged)`, which git matches case-insensitively (measured,
  // git 2.55.0). A check stricter than the audit would refuse a declaration the audit then lists.
  assert.deepEqual(fn("parseTwinExemptions")("twin-unchanged: alpha — r\nTWIN-UNCHANGED: beta — s\n"),
    [{ id: "alpha", reason: "r" }, { id: "beta", reason: "s" }]);
});

unitTest("4.1 a hyphenated id is read whole: the id is the value's FIRST TOKEN, not what precedes the first '-'", () => {
  assert.deepEqual(fn("parseTwinExemptions")("Twin-Unchanged: conductor-09 — r\n"), [{ id: "conductor-09", reason: "r" }]);
});

unitTest("4.1 a reason that itself holds ' - ' is read whole: the split is the FIRST spaced separator after the id", () => {
  assert.deepEqual(fn("parseTwinExemptions")("Twin-Unchanged: conductor-09 - a change - comment only\n"),
    [{ id: "conductor-09", reason: "a change - comment only" }]);
});

unitTest("4.1 each of the three spaced separators splits: ' — ', ' -- ' and ' - '", () => {
  const parse = fn("parseTwinExemptions");
  for (const sep of [" — ", " -- ", " - "]) {
    assert.deepEqual(parse(`Twin-Unchanged: alpha${sep}the reason\n`), [{ id: "alpha", reason: "the reason" }],
      `the separator ${JSON.stringify(sep)} must split the id from the reason`);
  }
});

unitTest("4.1 no spaced separator after the first token: the id is that token and the reason is EMPTY", () => {
  const parse = fn("parseTwinExemptions");
  assert.deepEqual(parse("Twin-Unchanged: conductor-09-r\n"), [{ id: "conductor-09-r", reason: "" }],
    "an unspaced hyphen is part of the id, never a separator");
  assert.deepEqual(parse("Twin-Unchanged: alpha because I said so\n"), [{ id: "alpha", reason: "" }],
    "words after the id with no separator are not a reason");
});

unitTest("4.1 an empty reason is KEPT as empty, so the coupling check can refuse it by name", () => {
  const parse = fn("parseTwinExemptions");
  assert.deepEqual(parse("Twin-Unchanged: alpha\n"), [{ id: "alpha", reason: "" }]);
  assert.deepEqual(parse("Twin-Unchanged: alpha —\n"), [{ id: "alpha", reason: "" }],
    "a separator followed by nothing is an empty reason, not a dropped declaration");
});

unitTest("4.1 one declaration per trailer, in git's order; nothing parsed is nothing declared", () => {
  const parse = fn("parseTwinExemptions");
  assert.deepEqual(parse("Twin-Unchanged: beta — s\nTwin-Unchanged: alpha — r\n"),
    [{ id: "beta", reason: "s" }, { id: "alpha", reason: "r" }]);
  assert.deepEqual(parse(""), [], "git parsed no trailer (a subject-only message, a prose paragraph): no declaration");
});

// ───────────────────────────── 4.2 couplingRefusals() takes exemptions ─────────────────────────────

const F = (id) => `scripts/test/functional/${id}.test.mjs`;
const IDS = { functional: ["alpha", "beta"], assertion: ["alpha", "beta"] };
/** Today's refusal for an undeclared id, in today's shape — the value the check returned before 4.2. */
const undeclared = (id) => ({ id, functional: F(id), assertion: `scripts/test/assert/${id}.test.mjs` });

unitTest("4.2 a declared, staged id passes without its twin", () => {
  assert.deepEqual(fn("couplingRefusals")({
    stagedFiles: [F("alpha")], ...IDS, exemptions: [{ id: "alpha", reason: "a comment-only edit" }],
  }), [], "a Twin-Unchanged declaration with a reason exempts its staged functional file");
});

unitTest("4.2 a declared id whose functional file is NOT staged is refused, naming it — it exempts nothing", () => {
  const refused = fn("couplingRefusals")({
    stagedFiles: [F("alpha"), "scripts/test/assert/alpha.test.mjs"], ...IDS,
    exemptions: [{ id: "beta", reason: "r" }],
  });
  assert.deepEqual(refused, [{ id: "beta", declaration: "not-staged", functional: F("beta") }],
    "a stale or mistyped declaration is a refusal naming the id and the file it claims");
});

unitTest("4.2 a declaration with an EMPTY reason is refused, naming it — Gate 2 has nothing to judge", () => {
  const refused = fn("couplingRefusals")({
    stagedFiles: [F("alpha")], ...IDS, exemptions: [{ id: "alpha", reason: "" }],
  });
  assert.ok(refused.some((r) => r.id === "alpha" && r.declaration === "no-reason"),
    `the empty reason must be refused by name: ${JSON.stringify(refused)}`);
  assert.ok(refused.some((r) => r.id === "alpha" && !r.declaration && r.assertion === "scripts/test/assert/alpha.test.mjs"),
    `and a declaration with no reason exempts nothing, so the unpaired file is refused too: ${JSON.stringify(refused)}`);
});

unitTest("4.2 an undeclared id is refused EXACTLY as before exemptions existed", () => {
  const couplingRefusals = fn("couplingRefusals");
  const staged = [F("alpha"), F("beta"), "scripts/test/assert/beta.test.mjs"];
  const expected = [undeclared("alpha")];
  assert.deepEqual(couplingRefusals({ stagedFiles: staged, ...IDS }), expected, "no exemptions argument: today's refusal");
  assert.deepEqual(couplingRefusals({ stagedFiles: staged, ...IDS, exemptions: [] }), expected, "an empty list: the same");
  assert.deepEqual(couplingRefusals({ stagedFiles: staged, ...IDS, exemptions: [{ id: "beta", reason: "r" }] }), expected,
    "a declaration for ANOTHER staged id exempts only that id");
});

unitTest("4.2 with isMerge, nothing is refused — a merge is not judged by the coupling check", () => {
  // git runs commit-msg, not pre-commit, for a merge, and a merge's staged set is everything the other
  // parent brings in; each of those commits was judged with its own declarations when it was made
  // (commit-msg-probe.log, merge probe 1). A squash has no MERGE_HEAD and is an ordinary commit.
  assert.deepEqual(fn("couplingRefusals")({
    stagedFiles: [F("alpha"), F("beta")], ...IDS, isMerge: true,
    exemptions: [{ id: "gamma", reason: "" }],
  }), [], "neither an unpaired file nor a bad declaration is judged on a merge");
});

unitTest("4.2 the phases: pre-commit runs enrolment, twins and freshness; commit-msg runs coupling; no phase runs all four", () => {
  const phaseChecks = fn("phaseChecks");
  assert.deepEqual(phaseChecks("pre-commit"), ["enrolment", "twins", "record"]);
  assert.deepEqual(phaseChecks("commit-msg"), ["coupling"]);
  // Gate 1 M5: a bare run — what CLAUDE.md tells a contributor to type — performs every check that can
  // be judged from a working tree, so it never reports fewer refusals than the two hooks together.
  assert.deepEqual(phaseChecks(undefined), ["enrolment", "twins", "coupling", "record"]);
  assert.throws(() => phaseChecks("pre-push"), /pre-commit|commit-msg/, "an unknown phase is refused, naming the known ones");
  // And coupling with no message uses NO exemptions: exactly the undeclared refusal.
  assert.deepEqual(fn("couplingRefusals")({ stagedFiles: [F("alpha")], ...IDS, exemptions: undefined }), [undeclared("alpha")]);
});
