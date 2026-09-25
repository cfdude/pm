// scripts/test/assert/certify-count.test.mjs
// 0.49.0 task 4.4 — THE CERTIFY RUNNER READS ONE SUMMARY FORMAT, and records nothing it cannot count.
//
// `scripts/test/certify.mjs` is the only writer of the certification record, and a record is a claim
// about a PASS over a COUNT. Until 0.49.0 it parsed both reporters (`ℹ` and TAP's `#`) from whatever
// the runner's default was, so the format it read depended on the Node major, and a coloured summary
// (`ESC[34mℹ tests 3`) read as nothing at all. It now forces `--test-reporter=spec` with
// `FORCE_COLOR=0`, parses `^ℹ` only, and records nothing — exiting non-zero — when the count is
// unreadable or zero (suite-certification's "Every run the suite is counted from reads one summary
// format, and a count it cannot read refuses").

import "../fixtures/assert-git-shim.mjs";  // the run-time git counter, installed in THIS process (0.49.0, D3 row 1)
import { test } from "node:test";
import assert from "node:assert/strict";
import * as certify from "../certify.mjs";

const ESC = String.fromCharCode(27);

test("4.4 certify's count parser reads the forced spec summary, and nothing else", () => {
  assert.equal(typeof certify.summaryCount, "function",
    "certify.mjs exports no summaryCount(): its count parser cannot be exercised, so which formats it " +
    "accepts is unknown");
  const spec = "✔ a\n✔ b\n✔ c\nℹ tests 3\nℹ suites 0\nℹ pass 3\nℹ fail 0\n";
  assert.equal(certify.summaryCount(spec, "tests"), 3, "the spec summary's count is read");
  assert.equal(certify.summaryCount(spec, "pass"), 3);
  assert.equal(certify.summaryCount("ok 1 - a\n1..3\n# tests 3\n# pass 3\n# fail 0\n", "tests"), null,
    "a TAP summary is NOT read — one format, and a record from another would count what it cannot vouch for");
  const coloured = `${ESC}[34mℹ tests 3${ESC}[39m\n${ESC}[34mℹ pass 3${ESC}[39m\n`;
  assert.equal(certify.summaryCount(coloured, "tests"), null,
    "a coloured spec summary is NOT read — the runner is started with FORCE_COLOR=0 so it never is one");
});

// ─────────────── Gate 2 I2 — the runner's argv/env and the refusal are exercised, not just the parser ───────────────
//
// A FUNCTION TEST, NOT A TEXT GUARD, because the property is behaviour over values: which argv and env
// the bucket runner is started with, and what `countRefusal()` does with a null, zero, TAP-read or
// coloured count. A text guard in the conductor-09 style would pin the spelling of one line and pass a
// refactor that moved the flag into a variable the runner no longer reads; these assert what the
// runner is actually handed and what is actually refused.

test("I2 the bucket runner is started with --test-reporter=spec and FORCE_COLOR=0, whatever the environment says", () => {
  assert.equal(typeof certify.runnerInvocation, "function", "certify.mjs exports no runnerInvocation()");
  const inv = certify.runnerInvocation(["/x/a.test.mjs", "/x/b.test.mjs"], { FORCE_COLOR: "1", KEEP: "yes" });
  assert.deepEqual(inv.args, ["--test", "--test-reporter=spec", "/x/a.test.mjs", "/x/b.test.mjs"]);
  assert.equal(inv.env.FORCE_COLOR, "0", "colour must be forced OFF even when the caller's environment forces it ON");
  assert.equal(inv.env.KEEP, "yes", "the rest of the environment is passed through");
});

test("I2 countRefusal() records nothing over a null, zero, TAP-read or coloured count, and passes a real one", () => {
  assert.equal(typeof certify.countRefusal, "function", "certify.mjs exports no countRefusal()");
  const counts = (out) => ({ tests: certify.summaryCount(out, "tests"), pass: certify.summaryCount(out, "pass") });
  assert.match(certify.countRefusal("functional half", { tests: null, pass: null }) || "", /could not be read/);
  assert.match(certify.countRefusal("functional half", { tests: 3, pass: null }) || "", /could not be read/);
  assert.match(certify.countRefusal("functional half", { tests: 0, pass: 0 }) || "", /ZERO tests/);
  assert.match(certify.countRefusal("sweeps bucket", counts("# tests 3\n# pass 3\n")) || "", /could not be read/,
    "a TAP summary is unreadable to the runner, so it is refused, not recorded");
  const coloured = `${ESC}[34mℹ tests 3${ESC}[39m\n${ESC}[34mℹ pass 3${ESC}[39m\n`;
  assert.match(certify.countRefusal("sweeps bucket", counts(coloured)) || "", /could not be read/,
    "a coloured summary is unreadable to the runner, so it is refused, not recorded");
  assert.equal(certify.countRefusal("sweeps bucket", counts("ℹ tests 25\nℹ pass 25\n")), null, "a real count is recorded");
});
