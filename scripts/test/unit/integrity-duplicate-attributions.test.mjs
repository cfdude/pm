// scripts/test/unit/integrity-duplicate-attributions.test.mjs
// integrity-reports-legacy-duplicate-attributions: `integrity` reports an epic whose attributedCommits
// names one commit more than once. Attribution is once-only now, so these predate that rule.

import assert from "node:assert/strict";
import { CHECKS } from "../../lib/integrity.mjs";
import { unitTest } from "../fixtures/unit-harness.mjs";

const check = CHECKS.find(c => c.id === "attributed-commits-hold-duplicates");
const A = "a".repeat(40);
const B = "b".repeat(40);
const epic = (id, attributedCommits) => ({ id, title: id, status: "queued", lane: "claude-code", links: [], attributedCommits });
const run = (...epics) => check.run({ epics });

unitTest("the check is registered", () => {
  assert.ok(check, "attributed-commits-hold-duplicates must be in CHECKS");
});

unitTest("an exact repeat is a finding naming the epic, the counts and the repeated commit", () => {
  const [f, ...rest] = run(epic("dup", [A, B, A]));
  assert.equal(rest.length, 0);
  assert.equal(f.epic, "dup");
  assert.match(f.detail, /3 entries for 2 distinct commit\(s\)/);
  assert.match(f.detail, /aaaaaaaaaaaa x2/);
});

unitTest("a short sha and the full name it abbreviates are one commit", () => {
  const [f] = run(epic("dup", [A.slice(0, 9), A]));
  assert.match(f.detail, /2 entries for 1 distinct/);
});

unitTest("distinct commits, an empty array and a missing array are not findings", () => {
  assert.deepEqual(run(epic("ok", [A, B]), epic("empty", []), { id: "none", title: "none", status: "queued" }), []);
});

unitTest("the finding prints no remedy, because no verb removes one entry", () => {
  const [f] = run(epic("dup", [A, A]));
  assert.doesNotMatch(f.detail, /update-epic|withdraw/);
  assert.match(f.detail, /no remedy to run/);
});
