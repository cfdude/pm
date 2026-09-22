import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, readState, writeState, claudeMd, parseBrief, expectFail, writeBatch } from "../fixtures/assert-harness.mjs";

// ─────────────── 4.1 SPLIT THIS FILE, AND THIS IS THE FILE-RUNG HALF ───────────────
//
// NINETEEN of its thirty tests moved to `scripts/test/unit/conductor-05.test.mjs` — the story
// toggles and their refusals, the rules block's Review-mode and Feedback sections, set-gate-guard,
// all five gate-guard cases (whose JSON payload rides the options bag's `input`), three
// brief/tracker-drift tests, and `add-many --from -`, which reads its batch off STDIN and so needs
// no file at all.
//
// ELEVEN STAY, in three groups, each for a stated reason:
//
//   * THREE review-mode tests. `set-review-mode` refreshes the managed rules block as a side effect
//     (`review-mode.mjs:31` → `writeRules()` → `writeFileSync` on CLAUDE.md), a repository file the
//     store does not own. PROBED rather than assumed — the unit rung's counter named the path and the
//     operation on the first attempt to move them.
//   * TWO tracker tests: one asserts on `claudeMd(cwd)`, CLAUDE.md's managed block, and both run
//     `set-tracker`, which writes that same file.
//   * SIX `add-many` tests whose fixture is a BATCH FILE (`writeBatch()` writes `batch.json`).
//
// No assertion changed in either direction.

test("set-review-mode sets the active mode and rejects an unknown mode", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["set-review-mode", "--mode", "thorough"], { cwd });
  assert.equal(readState(cwd).reviewMode, "thorough");
  assert.match(run(["rules"], { cwd }), /Current mode: \*\*thorough\*\*/);
  assert.ok(expectFail(() => run(["set-review-mode", "--mode", "bogus"], { cwd })), "bad mode rejected");
  assert.ok(expectFail(() => run(["set-review-mode"], { cwd })), "missing --mode rejected");
});
test("update-epic --review-mode escalates above the repo-global dial but never de-escalates below it", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--title", "Security-sensitive epic", "--lane", "claude-code"], { cwd });

  // Repo dial defaults to "standard". Escalating a single epic to "thorough" is allowed.
  run(["update-epic", "a", "--review-mode", "thorough"], { cwd });
  assert.equal(readState(cwd).epics.find(e => e.id === "a").reviewMode, "thorough");

  // Now raise the repo dial to "thorough" and try to set the epic override to "standard" —
  // that would de-escalate below the (now higher) global dial, so it must be rejected.
  run(["set-review-mode", "--mode", "thorough"], { cwd });
  const err = expectFail(() => run(["update-epic", "a", "--review-mode", "standard"], { cwd }));
  assert.ok(err, "expected rejection of a de-escalating override");
  assert.match(String(err.stderr || err.message), /de-escalate|below/);
  // State must be unchanged by the rejected attempt.
  assert.equal(readState(cwd).epics.find(e => e.id === "a").reviewMode, "thorough");

  // An unknown mode is still rejected outright.
  assert.ok(expectFail(() => run(["update-epic", "a", "--review-mode", "bogus"], { cwd })), "bad mode rejected");
});
test("currentReviewMode(epicId) returns the higher of the repo-global dial and the epic's override", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--title", "Epic A", "--lane", "claude-code"], { cwd });
  run(["add-epic", "--id", "b", "--title", "Epic B", "--lane", "claude-code"], { cwd });

  // Global standard, no override on either epic -> both effectively standard.
  assert.match(run(["rules", "--epic", "a"], { cwd }), /Current mode: \*\*standard\*\*/);

  // Escalate epic 'a' to thorough; epic 'b' stays at the global standard dial.
  run(["update-epic", "a", "--review-mode", "thorough"], { cwd });
  assert.match(run(["rules", "--epic", "a"], { cwd }), /Current mode: \*\*thorough\*\*/);
  assert.match(run(["rules", "--epic", "b"], { cwd }), /Current mode: \*\*standard\*\*/);

  // Raising the global dial past an epic's override makes the global dial win again.
  run(["set-review-mode", "--mode", "thorough"], { cwd });
  run(["set-review-mode", "--mode", "off"], { cwd });
  assert.match(run(["rules", "--epic", "b"], { cwd }), /Current mode: \*\*off\*\*/);
});
test("rules block gains an External tracker sync section only when a tracker is configured", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  assert.doesNotMatch(claudeMd(cwd), /External tracker sync/);     // none after a plain init
  // `--direction outward` is now explicit: a NEW primary tracker defaults to `inward`, the
  // deliberate reversal this release ships. What this test is about is the outward section's
  // content, so it asks for the direction that section belongs to.
  run(["set-tracker", "--system", "jira", "--project", "JOB", "--direction", "outward"], { cwd });
  assert.match(claudeMd(cwd), /External tracker sync/);
  assert.match(claudeMd(cwd), /jira/);
});
test("tracker-linked autonomy addendum appears only when a tracker is configured", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const noTracker = run(["rules"], { cwd });
  assert.doesNotMatch(noTracker, /Epic-level autonomy on tracker-linked epics/);

  run(["set-tracker", "--system", "jira", "--project", "JOB", "--direction", "outward"], { cwd });
  const withTracker = run(["rules"], { cwd });
  assert.match(withTracker, /Epic-level autonomy on tracker-linked epics/);
  assert.match(withTracker, /mid-run drift/i);
  assert.match(withTracker, /non-authoritative/i);
});
test("add-many creates a parent + children atomically; children inherit the parent id", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const batch = writeBatch(cwd, {
    parent: { id: "sprint", title: "Sprint", lane: "external", priority: "P0", status: "queued" },
    epics: [
      { id: "job-1", title: "one", lane: "external", priority: "P0", externalId: "JOB-1" },
      { id: "job-2", title: "two", lane: "external", priority: "P1" },
    ],
  });
  run(["add-many", "--from", batch], { cwd });
  const s = readState(cwd);
  assert.ok(s.epics.find(e => e.id === "sprint"));
  assert.equal(s.epics.find(e => e.id === "job-1").parent, "sprint");
  assert.equal(s.epics.find(e => e.id === "job-2").parent, "sprint");
  assert.equal(s.epics.find(e => e.id === "job-1").externalId, "JOB-1");
});
test("add-many children-only batch leaves parent unset", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const batch = writeBatch(cwd, { epics: [
    { id: "x", lane: "external", priority: "P1" }, { id: "y", lane: "external", priority: "P1" }] });
  run(["add-many", "--from", batch], { cwd });
  const s = readState(cwd);
  assert.ok(s.epics.find(e => e.id === "x") && s.epics.find(e => e.id === "y"));
  assert.equal(s.epics.find(e => e.id === "x").parent, undefined);
});
test("add-many aborts the whole batch on one invalid entry, writing nothing", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const before = readState(cwd).epics.length;
  const batch = writeBatch(cwd, { epics: [
    { id: "good", lane: "external", priority: "P1" },
    { id: "Bad ID", lane: "external" },                 // malformed id
  ]});
  assert.ok(expectFail(() => run(["add-many", "--from", batch], { cwd })), "expected non-zero exit");
  assert.equal(readState(cwd).epics.length, before);     // nothing written — not even 'good'
});
test("add-many rejects a duplicate id within the batch", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const batch = writeBatch(cwd, { epics: [{ id: "dup", lane: "external" }, { id: "dup", lane: "external" }] });
  assert.ok(expectFail(() => run(["add-many", "--from", batch], { cwd })));
  assert.equal(readState(cwd).epics.length, 0);
});
test("add-many rejects a duplicate against an existing epic", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "exists", "--lane", "external"], { cwd });
  const batch = writeBatch(cwd, { epics: [{ id: "exists", lane: "external" }] });
  assert.ok(expectFail(() => run(["add-many", "--from", batch], { cwd })));
  assert.equal(readState(cwd).epics.filter(e => e.id === "exists").length, 1);
});
test("add-many rejects an intra-batch parent cycle", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const batch = writeBatch(cwd, { epics: [
    { id: "x", lane: "external", parent: "y" }, { id: "y", lane: "external", parent: "x" }] });
  assert.ok(expectFail(() => run(["add-many", "--from", batch], { cwd })));
  assert.equal(readState(cwd).epics.length, 0);
});
