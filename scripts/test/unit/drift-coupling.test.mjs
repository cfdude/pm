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
