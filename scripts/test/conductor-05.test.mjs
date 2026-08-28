import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tmpRepo, run, readState, writeState, claudeMd, parseBrief, expectFail, writeBatch } from "./helpers.mjs";

// ─────────────── update-epic --add-story / --story --done (df-update-epic-no-story-toggle-verb) ───────────────

test("update-epic --add-story appends { title, done: false } to a fresh stories[] array", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code"], { cwd });
  run(["update-epic", "a", "--add-story", "First story"], { cwd });
  const epic = readState(cwd).epics.find(e => e.id === "a");
  assert.deepEqual(epic.stories, [{ title: "First story", done: false }]);
});

test("update-epic --add-story appends to an existing stories[] array without disturbing earlier entries", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code"], { cwd });
  run(["update-epic", "a", "--add-story", "First story"], { cwd });
  run(["update-epic", "a", "--add-story", "Second story"], { cwd });
  const epic = readState(cwd).epics.find(e => e.id === "a");
  assert.deepEqual(epic.stories, [
    { title: "First story", done: false },
    { title: "Second story", done: false },
  ]);
});

test("update-epic --add-story rejects an empty/blank title and writes nothing", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code"], { cwd });
  const before = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
  const err = expectFail(() => run(["update-epic", "a", "--add-story", "   "], { cwd }));
  assert.ok(err);
  assert.match(String(err.stderr || err.message), /non-empty title/);
  assert.equal(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"), before);
});

test("update-epic --story <n> --done marks the n-th (1-indexed) story done, leaving others untouched", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code"], { cwd });
  run(["update-epic", "a", "--add-story", "First story"], { cwd });
  run(["update-epic", "a", "--add-story", "Second story"], { cwd });
  run(["update-epic", "a", "--story", "2", "--done"], { cwd });
  const epic = readState(cwd).epics.find(e => e.id === "a");
  assert.deepEqual(epic.stories, [
    { title: "First story", done: false },
    { title: "Second story", done: true },
  ]);
});

test("update-epic --story out of range (including 0, and beyond the array length) is rejected and writes nothing", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code"], { cwd });
  run(["update-epic", "a", "--add-story", "Only story"], { cwd });
  const before = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
  for (const bad of ["0", "2", "-1"]) {
    const err = expectFail(() => run(["update-epic", "a", "--story", bad, "--done"], { cwd }));
    assert.ok(err, `expected --story ${bad} to be rejected`);
    assert.match(String(err.stderr || err.message), /out of range/);
  }
  assert.equal(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"), before);
});

// gh#95 amended this contract: `--story <n>` now takes TWO mutations, `--done` and
// `--wont-do "<reason>"`, so the refusal names both rather than "--done" alone.
test("update-epic --story without a mutation is rejected naming both, and --done without --story is rejected", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code"], { cwd });
  run(["update-epic", "a", "--add-story", "Only story"], { cwd });
  const err1 = expectFail(() => run(["update-epic", "a", "--story", "1"], { cwd }));
  assert.ok(err1);
  assert.match(String(err1.stderr || err1.message), /requires a mutation/);
  assert.match(String(err1.stderr || err1.message), /--done/);
  const err2 = expectFail(() => run(["update-epic", "a", "--done"], { cwd }));
  assert.ok(err2);
  assert.match(String(err2.stderr || err2.message), /requires --story/);
});

test("update-epic rejects an unrecognized flag instead of silently no-op'ing, and writes nothing", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--title", "Original", "--lane", "claude-code"], { cwd });
  const before = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
  const err = expectFail(() => run(["update-epic", "a", "--titel", "Typo'd flag name"], { cwd }));
  assert.ok(err, "expected non-zero exit for an unknown flag");
  assert.match(String(err.stderr || err.message), /unknown flag/);
  assert.equal(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"), before);
  assert.equal(readState(cwd).epics.find(e => e.id === "a").title, "Original");
});

test("rules block always includes the Review mode section, defaulting to standard when never set", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const out = run(["rules"], { cwd });
  assert.match(out, /## Review mode/);
  assert.match(out, /set-review-mode/);
  assert.match(out, /\| `off` \|/);
  assert.match(out, /\| `standard` \|/);
  assert.match(out, /\| `thorough` \|/);
  assert.match(out, /Current mode: \*\*standard\*\*/);
});

test("rules block always includes the Feedback section encouraging /pm:feedback adoption", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const out = run(["rules"], { cwd });
  assert.match(out, /## Feedback/);
  assert.match(out, /\/pm:feedback \[bug\|feature\]/);
  assert.match(out, /want me to file this as feedback/i);
});

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

test("set-gate-guard toggles the opt-in flag and rejects an invalid value", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  assert.equal(readState(cwd).gateGuard, undefined);   // off by default, never written until set
  run(["set-gate-guard", "on"], { cwd });
  assert.equal(readState(cwd).gateGuard, true);
  run(["set-gate-guard", "off"], { cwd });
  assert.equal(readState(cwd).gateGuard, false);
  assert.ok(expectFail(() => run(["set-gate-guard", "bogus"], { cwd })), "invalid value rejected");
});

test("gate-guard blocks by default (no set-gate-guard needed) when the active epic owes a reconcile", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  writeState(cwd, { version: 1, active: "a", detourStack: [], epics: [
    { id: "a", title: "a", priority: "P1", status: "active", role: "epic", lane: "claude-code", links: [], reconcileNeeded: true },
  ]});
  const err = expectFail(() => run(["gate-guard"], { cwd, input: "{}" }));
  assert.ok(err, "expected a block");
  assert.match(String(err.stderr || err.message), /still owes a reconcile/);
});

test("gate-guard blocks (exit non-zero, reason on stderr) when enabled and the active epic owes a reconcile", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["set-gate-guard", "on"], { cwd });
  writeState(cwd, { version: 1, active: "a", detourStack: [], gateGuard: true, epics: [
    { id: "a", title: "a", priority: "P1", status: "active", role: "epic", lane: "claude-code", links: [], reconcileNeeded: true },
  ]});
  const err = expectFail(() => run(["gate-guard"], { cwd, input: "{}" }));
  assert.ok(err, "expected a block");
  assert.match(String(err.stderr || err.message), /still owes a reconcile/);
});

test("gate-guard does not block when enabled but the active epic does not owe a reconcile", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  writeState(cwd, { version: 1, active: "a", detourStack: [], gateGuard: true, epics: [
    { id: "a", title: "a", priority: "P1", status: "active", role: "epic", lane: "claude-code", links: [], reconcileNeeded: false },
  ]});
  run(["gate-guard"], { cwd, input: "{}" });   // does not throw
});

test("gate-guard does not block when explicitly off and the active epic does not owe a reconcile", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["set-gate-guard", "off"], { cwd });
  writeState(cwd, { version: 1, active: "a", detourStack: [], gateGuard: false, epics: [
    { id: "a", title: "a", priority: "P1", status: "active", role: "epic", lane: "claude-code", links: [], reconcileNeeded: false },
  ]});
  run(["gate-guard"], { cwd, input: "{}" });   // does not throw
});

test("gate-guard still blocks on reconcileNeeded even when explicitly set off (reconcile safety overrides the opt-out)", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["set-gate-guard", "off"], { cwd });
  writeState(cwd, { version: 1, active: "a", detourStack: [], gateGuard: false, epics: [
    { id: "a", title: "a", priority: "P1", status: "active", role: "epic", lane: "claude-code", links: [], reconcileNeeded: true },
  ]});
  const err = expectFail(() => run(["gate-guard"], { cwd, input: "{}" }));
  assert.ok(err, "expected a block even with gateGuard explicitly off");
  assert.match(String(err.stderr || err.message), /still owes a reconcile/);
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

test("brief surfaces create-issue drift only for unmirrored active-work epics", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  writeState(cwd, { version: 1, active: null, detourStack: [],
    tracker: { system: "jira", projectKey: "JOB", statusIntent: {} },
    epics: [
      { id: "m1", title: "m1", priority: "P1", status: "queued", role: "epic", lane: "external", links: [] },                       // unmirrored → listed
      { id: "m2", title: "m2", priority: "P1", status: "active", role: "epic", lane: "external", externalId: "JOB-2", links: [] },   // mirrored → excluded
      { id: "done", title: "done", priority: "P1", status: "archived", role: "epic", lane: "external", links: [] },                  // archived → excluded
      { id: "later", title: "later", priority: "P1", status: "planned", role: "epic", lane: "external", links: [] },                 // planned → excluded
      { id: "ghost", title: "ghost", priority: "P1", status: "queued", role: "epic", lane: "openspec", links: [] },                  // missing() openspec → excluded
    ]});
  const brief = parseBrief(cwd);
  assert.match(brief, /TRACKER SYNC \(jira · JOB\)/);
  const syncLine = brief.split("\n").find(l => /not yet in jira/.test(l)) || "";
  assert.match(syncLine, /`m1`/);
  for (const id of ["m2", "done", "later", "ghost"]) assert.doesNotMatch(syncLine, new RegExp(`\`${id}\``));
});

test("no tracker block → no TRACKER SYNC in the brief", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  writeState(cwd, { version: 1, active: null, detourStack: [], epics: [
    { id: "x", title: "x", priority: "P1", status: "queued", role: "epic", lane: "external", links: [] }]});
  assert.doesNotMatch(parseBrief(cwd), /TRACKER SYNC/);
});

test("brief invents no transition drift when all active epics are mirrored", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  writeState(cwd, { version: 1, active: null, detourStack: [],
    tracker: { system: "jira", projectKey: "JOB", statusIntent: { archived: "done" } },
    epics: [{ id: "m", title: "m", priority: "P1", status: "active", role: "epic", lane: "external", externalId: "JOB-1", links: [] }]});
  const brief = parseBrief(cwd);
  assert.doesNotMatch(brief, /not yet in jira/);                       // nothing to create
  // Scope to the TRACKER SYNC block specifically — the brief's SessionStart upgrade nudge
  // (added in 0.13.0) can legitimately inline CHANGELOG bullet text containing words like
  // "drift" for unrelated reasons (e.g. a changelog entry about doc-drift detection), so a
  // whole-brief search for these words is too broad and produces false positives.
  const trackerBlock = brief.split(/\n\n/).find(b => b.startsWith("TRACKER SYNC")) || "";
  assert.doesNotMatch(trackerBlock, /transition pending|out of sync|drift/i); // no fabricated transition drift
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

test("add-many reads a batch from stdin (--from -)", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const batch = JSON.stringify({ epics: [{ id: "s1", lane: "external", priority: "P1" }] });
  run(["add-many", "--from", "-"], { cwd, input: batch });
  assert.ok(readState(cwd).epics.find(e => e.id === "s1"));
});

test("add-many rejects an intra-batch parent cycle", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const batch = writeBatch(cwd, { epics: [
    { id: "x", lane: "external", parent: "y" }, { id: "y", lane: "external", parent: "x" }] });
  assert.ok(expectFail(() => run(["add-many", "--from", batch], { cwd })));
  assert.equal(readState(cwd).epics.length, 0);
});
