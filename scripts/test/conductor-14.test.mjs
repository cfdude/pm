// scripts/test/conductor-14.test.mjs
// conductor-tells-the-truth, groups 10–12: tracker direction (two predicates, six governed
// emitters), the freshness watermark + single activation door, and the epic annotation surface.
//
// A NEW file rather than growth of conductor-13: three capabilities land here concurrently and
// the split keeps each one's fixtures readable.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { run, readState, writeState, tmpRepo, expectFail } from "./helpers.mjs";

// ─────────────────────── group 12: epic annotation ───────────────────────
//
// `description` is durable rationale, replaced when set again. `notes` is an append-only trail
// of {at, actor, text}. They are DISTINCT: notes look like activity and a description does not,
// and writing one never touches the other.

test("a description set at creation reads back and leaves notes absent", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "e1", "--lane", "claude-code", "--description", "why this exists"], { cwd });
  const e = readState(cwd).epics.find(x => x.id === "e1");
  assert.equal(e.description, "why this exists");
  assert.equal(e.notes, undefined);
});

test("a note appended at creation carries {at, actor, text}", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "e1", "--lane", "claude-code", "--notes", "first note"], { cwd });
  const e = readState(cwd).epics.find(x => x.id === "e1");
  assert.equal(e.notes.length, 1);
  assert.equal(e.notes[0].text, "first note");
  assert.ok(e.notes[0].actor, "a note entry must record an actor");
  assert.ok(!Number.isNaN(Date.parse(e.notes[0].at)), "a note entry must record when it was written");
});

test("description and notes are independent: each write leaves the other intact", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "e1", "--lane", "claude-code", "--description", "first rationale"], { cwd });
  run(["update-epic", "e1", "--notes", "note one"], { cwd });
  let e = readState(cwd).epics.find(x => x.id === "e1");
  assert.equal(e.description, "first rationale", "appending a note must not touch the description");
  assert.equal(e.notes.length, 1);

  // Setting a description leaves notes unchanged.
  run(["update-epic", "e1", "--description", "second rationale"], { cwd });
  e = readState(cwd).epics.find(x => x.id === "e1");
  assert.equal(e.description, "second rationale", "a description is REPLACED when set again");
  assert.equal(e.notes.length, 1, "replacing the description must not drop a note");
  assert.equal(e.notes[0].text, "note one");

  // Appending a second note preserves the first entry's text verbatim.
  run(["update-epic", "e1", "--notes", "note two"], { cwd });
  e = readState(cwd).epics.find(x => x.id === "e1");
  assert.equal(e.notes.length, 2, "notes APPEND — they never replace");
  assert.equal(e.notes[0].text, "note one", "the earlier entry's text must survive verbatim");
  assert.equal(e.notes[1].text, "note two");

  // Replacing the description afterwards leaves every note present.
  run(["update-epic", "e1", "--description", "third rationale"], { cwd });
  e = readState(cwd).epics.find(x => x.id === "e1");
  assert.equal(e.description, "third rationale");
  assert.deepEqual(e.notes.map(n => n.text), ["note one", "note two"]);
});

test("--notes on add-epic persists rather than exiting zero and writing nothing (#79)", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "e1", "--lane", "claude-code", "--notes", "the payload that used to vanish"], { cwd });
  const e = readState(cwd).epics.find(x => x.id === "e1");
  assert.equal(e.notes[0].text, "the payload that used to vanish");
});

// ─────────────────────── group 10: tracker direction ───────────────────────
//
// TWO resolved values, computed once in constants.mjs and consumed by every emitter:
// `outwardApplies` and `inwardProcedureEmittable`. They are SEPARATE tests — direction alone
// must never turn a section on, or pm emits a command with an unfilled scope placeholder.

const CONSTANTS_14 = new URL("../lib/constants.mjs", import.meta.url).href;

test("direction resolves from the tracker, falling back per vendor without any migration", async () => {
  const { directionOf } = await import(CONSTANTS_14);
  // The fallback is load-bearing INDEPENDENTLY of the migration: /pm:upgrade lags the plugin
  // update by design, so a repo runs this engine for weeks with no `direction` recorded.
  assert.equal(directionOf({ system: "github-issues", repo: "o/n" }), "inward");
  assert.equal(directionOf({ system: "github-issues" }), "inward");
  assert.equal(directionOf({ system: "jira", projectKey: "JOB" }), "outward");
  assert.equal(directionOf({ system: "linear" }), "outward");
  // An explicitly recorded direction always wins over the fallback.
  for (const d of ["inward", "outward", "both"]) {
    assert.equal(directionOf({ system: "jira", projectKey: "JOB", direction: d }), d);
    assert.equal(directionOf({ system: "github-issues", repo: "o/n", direction: d }), d);
  }
  // A secondary tracker is pull-only by definition — it resolves inward whatever its vendor.
  assert.equal(directionOf({ system: "jira", projectKey: "ABC", role: "secondary" }), "inward");
  assert.equal(directionOf(null), null);
  assert.equal(directionOf({}), null);
});

test("the two predicates are SEPARATE: a scope-less inward tracker emits no inward procedure", async () => {
  const { outwardApplies, inwardProcedureEmittable } = await import(CONSTANTS_14);
  const rows = [
    // tracker,                                                   outward, inwardEmittable
    [{ system: "github-issues", repo: "o/n" },                     false,  true],
    // THE case that makes "inward iff direction includes inward" unsafe: direction resolves
    // `inward` and there is still nothing to list, so no inward section may be emitted.
    [{ system: "github-issues" },                                  false,  false],
    [{ system: "github-issues", direction: "inward" },             false,  false],
    [{ system: "github-issues", repo: "o/n", direction: "outward" }, true,  false],
    [{ system: "github-issues", repo: "o/n", direction: "both" },  true,   true],
    [{ system: "jira", projectKey: "JOB" },                        true,   false],
    [{ system: "jira" },                                           true,   false],
    [{ system: "jira", projectKey: "JOB", direction: "inward" },   false,  true],
    [{ system: "jira", direction: "inward" },                      false,  false],
    [{ system: "jira", repo: "o/n", direction: "inward" },         false,  true],
    [{ system: "jira", projectKey: "JOB", direction: "both" },     true,   true],
    [{ system: "linear", projectKey: "L", direction: "both" },     true,   true],
    [null,                                                          false,  false],
  ];
  for (const [tracker, outward, inward] of rows) {
    assert.equal(outwardApplies(tracker), outward, `outwardApplies ${JSON.stringify(tracker)}`);
    assert.equal(inwardProcedureEmittable(tracker), inward, `inwardProcedureEmittable ${JSON.stringify(tracker)}`);
  }
});

test("an inward procedure is emittable repo-wide when ANY configured tracker has one", async () => {
  const { anyInwardProcedureEmittable } = await import(CONSTANTS_14);
  const outwardPrimary = { system: "jira", projectKey: "JOB" };
  assert.equal(anyInwardProcedureEmittable(outwardPrimary, []), false);
  assert.equal(
    anyInwardProcedureEmittable(outwardPrimary, [{ system: "github-issues", repo: "a/b", role: "secondary" }]),
    true, "a secondary tracker is inward by definition, so the repo has an inward procedure");
  assert.equal(anyInwardProcedureEmittable(null, []), false);
});

// ─────────── 10.2 / 10.3: set-tracker --direction, and the merge trap ───────────

test("set-tracker records an explicit --direction on the primary tracker", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["set-tracker", "--system", "jira", "--project", "JOB", "--direction", "inward"], { cwd });
  assert.equal(readState(cwd).tracker.direction, "inward");
});

test("an invalid --direction exits non-zero and leaves state.tracker exactly as it was", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["set-tracker", "--system", "jira", "--project", "JOB", "--direction", "outward"], { cwd });
  const before = JSON.stringify(readState(cwd).tracker);
  const err = expectFail(() => run(["set-tracker", "--direction", "sideways"], { cwd }));
  assert.ok(err, "expected a non-zero exit for an unknown direction");
  assert.match(String(err.stderr || err.message), /--direction/);
  assert.equal(JSON.stringify(readState(cwd).tracker), before, "a rejected direction must write nothing");
});

test("a secondary tracker is pinned to inward — any other direction is refused", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const before = JSON.stringify(readState(cwd).secondaryTrackers);
  const err = expectFail(() => run(
    ["set-tracker", "--role", "secondary", "--system", "jira", "--project", "ABC", "--direction", "outward"], { cwd }));
  assert.ok(err, "a secondary tracker may not be given an outward direction");
  assert.equal(JSON.stringify(readState(cwd).secondaryTrackers), before,
    "state.secondaryTrackers must be untouched by the refusal");
  // The pinned value itself is accepted, so the refusal above is a decision and not a dead path.
  run(["set-tracker", "--role", "secondary", "--system", "jira", "--project", "ABC", "--direction", "inward"], { cwd });
  assert.equal(readState(cwd).secondaryTrackers[0].direction, "inward");
});

// ─────────── 10.4: the six governed emitters — the rules block's two sections ───────────
//
// The 0.26.0 rules block for each un-upgraded tracker shape is checked in under
// scripts/test/fixtures/. `rules.mjs` has not changed since 0.24.0, so these files ARE the
// prior release's output, not a re-derivation of it.

const FIXTURES = new URL("./fixtures/", import.meta.url).pathname;
const baseline = (name) => fs.readFileSync(path.join(FIXTURES, `rules-0.26.0-${name}.txt`), "utf8");

const OUTWARD_HEADING = "## External tracker sync";
const REMINDER_HEADING = "## Sync after completing tracker-linked work";

/** The rules block a tracker shape produces, with no state migration applied. */
function rulesFor(tracker, { secondaryTrackers } = {}) {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const state = readState(cwd);
  if (tracker) state.tracker = tracker;
  if (secondaryTrackers) state.secondaryTrackers = secondaryTrackers;
  writeState(cwd, state);
  return run(["rules"], { cwd });
}

/** Everything the block says BEFORE any tracker section — the part no direction rule may move. */
const preTrackerPart = (block) => {
  const i = block.indexOf("\n## External tracker sync");
  const j = block.indexOf("\n## GitHub issue sync");
  const k = block.indexOf("\n## Inward tracker sync");
  const cuts = [i, j, k].filter(n => n !== -1);
  return cuts.length ? block.slice(0, Math.min(...cuts)) : block.replace(/\n## Sync after completing[\s\S]*$/, "");
};

test("an un-upgraded jira primary is byte-identical to 0.26.0 — outward section, no inward section", () => {
  const block = rulesFor({ system: "jira", projectKey: "JOB" });
  assert.equal(block, baseline("jira-scoped"),
    "a direction-less jira primary must emit exactly what 0.26.0 emitted for it");
  assert.ok(block.includes(OUTWARD_HEADING));
  assert.ok(!block.includes("## GitHub issue sync") && !block.includes("## Inward tracker sync"));
});

test("an un-upgraded github-issues primary with a repo keeps the inward section and no outward one", () => {
  const block = rulesFor({ system: "github-issues", repo: "o/n" });
  const before = baseline("github-scoped");
  assert.equal(preTrackerPart(block), preTrackerPart(before),
    "nothing outside the tracker sections may move on the un-upgraded github path");
  assert.ok(!block.includes(OUTWARD_HEADING), "github-issues resolves inward — no outward section");
  assert.ok(block.includes("## GitHub issue sync (o/n)"), "the inward section must still be emitted");
  assert.ok(before.includes("## GitHub issue sync (o/n)") && !before.includes(OUTWARD_HEADING),
    "the 0.26.0 baseline must show the same two facts, or this test is comparing against nothing");
});

test("direction, not the vendor name, decides which section a tracker gets", () => {
  // The reversal the whole capability exists for: the same vendor, opposite directions.
  const ghOutward = rulesFor({ system: "github-issues", repo: "o/n", direction: "outward" });
  assert.ok(ghOutward.includes(OUTWARD_HEADING), "a github-issues tracker set outward DOES get the outward section");
  assert.ok(!ghOutward.includes("## GitHub issue sync"), "and loses the inward one");

  const both = rulesFor({ system: "github-issues", repo: "o/n", direction: "both" });
  assert.ok(both.includes(OUTWARD_HEADING) && both.includes("## GitHub issue sync (o/n)"),
    "`both` emits both sections");

  const jiraOutward = rulesFor({ system: "jira", projectKey: "JOB", direction: "outward" });
  assert.ok(jiraOutward.includes(OUTWARD_HEADING));
});

// ─────────── 10.5: the inward section is vendor-neutral, and dedups on externalUrl ───────────

test("a scoped non-github tracker set inward gets an inward section naming its own system", () => {
  const block = rulesFor({ system: "jira", projectKey: "JOB", direction: "inward" });
  assert.ok(!block.includes(OUTWARD_HEADING), "an inward tracker gets no outward section");
  assert.ok(block.includes("## Inward tracker sync (jira · JOB)"),
    "the primary slot must emit the vendor-neutral inward section the secondary path already has");
  assert.match(block, /List open items in jira \(JOB\) with your own tooling/);
  assert.ok(!block.includes("gh issue list"), "no vendor-specific command for a non-github tracker");
  assert.match(block, /externalUrl/,
    "dedup must be instructed on externalUrl — issue numbers are unique only within one tracker");
});

test("the github inward section keeps its literal gh command and also dedups on externalUrl", () => {
  const block = rulesFor({ system: "github-issues", repo: "o/n" });
  assert.match(block, /gh issue list --repo o\/n --state open/);
  assert.match(block, /externalUrl/);
  // The 0.26.0 block instructed a bare-externalId dedup here, which collides across repos.
  const before = baseline("github-scoped");
  assert.ok(before.includes("that issue number as `externalId` already"),
    "the baseline must still show the bare-externalId instruction this task replaces");
});

test("a NEW primary tracker defaults to inward — the consequential direction must be chosen", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["set-tracker", "--system", "jira", "--instance", "onvex", "--project", "JOB"], { cwd });
  assert.equal(readState(cwd).tracker.direction, "inward");
  const md = run(["rules"], { cwd });
  assert.ok(!md.includes(OUTWARD_HEADING), "a newly registered tracker gets no outward section");
  assert.ok(md.includes("## Inward tracker sync (jira · JOB)"));
});

test("merging into an EXISTING direction-less tracker never stamps a direction onto it", () => {
  // The merge trap: `setTracker()` merges `{...(state.tracker || {})}`, so a naive
  // `if (!t.direction) t.direction = "inward"` inside the writer would switch outward
  // mirroring OFF for every existing jira repo the first time anyone touched its config.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const state = readState(cwd);
  state.tracker = { system: "jira", projectKey: "JOB", instance: "onvex" };
  writeState(cwd, state);
  const rulesBefore = run(["rules"], { cwd });

  run(["set-tracker", "--intent", "paused:todo"], { cwd });
  const t = readState(cwd).tracker;
  assert.ok(!("direction" in t), "no direction may be written onto a tracker that did not have one");
  assert.deepEqual(t.statusIntent, { paused: "todo" });
  assert.equal(t.system, "jira");
  assert.equal(t.instance, "onvex");
  assert.equal(run(["rules"], { cwd }), rulesBefore,
    "the tracker must keep resolving to the same direction it resolved to before the command ran");
});

test("a NEW secondary tracker is stamped inward; merging into an existing one is not", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["set-tracker", "--role", "secondary", "--system", "github-issues", "--repo", "a/b"], { cwd });
  assert.equal(readState(cwd).secondaryTrackers[0].direction, "inward");

  const state = readState(cwd);
  state.secondaryTrackers = [{ system: "jira", projectKey: "ABC", role: "secondary" }];
  writeState(cwd, state);
  run(["set-tracker", "--role", "secondary", "--system", "jira", "--project", "ABC", "--mechanism", "mcp"], { cwd });
  const entry = readState(cwd).secondaryTrackers[0];
  assert.ok(!("direction" in entry), "merging into an existing secondary entry stamps nothing");
  assert.equal(entry.mechanism, "mcp");
});
