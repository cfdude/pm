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
