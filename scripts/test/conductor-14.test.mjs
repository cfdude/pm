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
import { spawnSync } from "node:child_process";
import { ENGINE, EMPTY_CACHE, run, runCombined, readState, writeState, projectMd, parseBrief, tmpRepo, expectFail, claudeMd } from "./helpers.mjs";

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
  // Scope-lessness governs the PRIMARY slot only — tracker-sync spec:115-117 says in as many
  // words that the requirement "MUST NOT be generalized to them". Running a secondary through
  // `inwardProcedureEmittable` did exactly that, and `trackerScope` reads `repo` and IGNORES
  // `projectKey` for github-issues — so a secondary registered as
  // `--system github-issues --project ABC` (which registration accepts) had rules.mjs emitting
  // its whole sync section while the completion-sync reminder, the brief and sync's own
  // message all suppressed. Two emitters, same question, opposite answers.
  assert.equal(
    anyInwardProcedureEmittable(null, [{ system: "github-issues", projectKey: "ABC", role: "secondary" }]),
    true, "a REGISTERED secondary has an inward procedure — rules.mjs emits its section on " +
    "exactly the guard `st && st.system`, and this predicate must give that same answer");
  assert.equal(anyInwardProcedureEmittable(null, [{ projectKey: "ABC" }]), false,
    "an entry with no system is not a registered tracker — that is rules.mjs's own `continue`");
});

test("a projectKey-scoped github-issues SECONDARY gets one answer from every emitter", () => {
  // The whole repo-level surface, read at once: whatever the predicate says, all four emitters
  // must say. This is #109's shape at the sibling site, so it is checked end-to-end and not
  // only at the predicate.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["set-tracker", "--role", "secondary", "--system", "github-issues", "--project", "ABC"], { cwd });
  run(["add-epic", "--id", "mirrored", "--lane", "claude-code", "--external-id", "7",
    "--external-url", "https://example.test/ABC/7"], { cwd });
  const rules = claudeMd(cwd);
  assert.match(rules, /## Secondary tracker sync \(github-issues · ABC\)/,
    "rules.mjs emits the secondary section for this repo");
  assert.match(rules, /## Sync after completing tracker-linked work/,
    "the completion-sync reminder must agree with the section that precedes it");
  // "Every command pm emits must run as written": the primary's repo-only scope rule applied to
  // a secondary made mirroredEpicIdPrefix() return null, and the recipe line the agent is told
  // to run "as written" rendered `add-epic --id null-<issue-number>`.
  assert.match(rules, /add-epic --id gh-abc-<issue-number>/,
    "the emitted registration line must carry a real derived id prefix, never `null-`");
  assert.doesNotMatch(rules, /--id null-/, "no emitted command may carry a null scope");
  const brief = parseBrief(cwd);
  assert.match(brief, /never re-read since mirroring/,
    "the brief's freshness line keys on the same predicate");
  assert.match(runCombined(["sync"], { cwd }), /inward tracker sync is YOURS/,
    "sync's own message keys on it too");
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
/** The checked-in 0.26.0 output, put through the SAME always-on strip as the block under test.
 *  Both sides, or the comparison is between a stripped document and an unstripped one. The
 *  refresh-gate/gate-procedure/intake replaces are no-ops here (0.26.0 emitted none of them);
 *  the operating-rules one is what actually bites, and gh-151 is why it has to — see
 *  stripAlwaysOn below. */
const baseline = (name) =>
  stripAlwaysOn(fs.readFileSync(path.join(FIXTURES, `rules-0.26.0-${name}.txt`), "utf8"));

const OUTWARD_HEADING = "## External tracker sync";
const REFRESH_GATE_HEADING = "## Re-read the source before an epic becomes the work";

const GATE_PROCEDURE_HEADING = "## The gate procedure — required task items";
const INTAKE_HEADING = "## Intake — triage an ask against the whole backlog BEFORE registering it";

/** A block with the ALWAYS-ON sections removed — the ones no tracker configuration turns on or
 *  off. Three of them now: the provenance-keyed refresh gate, the gate procedure pm emits as
 *  numbered required task items, and the intake procedure (gh-112), which fires when an ask
 *  arrives and is therefore governed by no tracker configuration either.
 *
 *  Byte-identity against 0.26.0 is claimed for the SYNC SECTIONS on these paths — what direction
 *  governs — not for the whole document. This release also ADDS instruction that no tracker
 *  configuration turns on or off. Comparing whole blocks would forbid the release from adding
 *  any instruction at all, which is not what the direction requirement pins. */
const OPERATING_RULES_HEADING = "## PM Conductor — operating rules";
const REPORTING_HEADING = "## Reporting — pm owns what is recorded and what is said; you own how you say it";
const HELP_HEADING = "## Getting help with pm — two channels, and which one can lie";
const stripAlwaysOn = (block) => block
  .replace(new RegExp(`\\n*${REFRESH_GATE_HEADING}[\\s\\S]*?(?=\\n<!-- END pm-conductor rules -->)`), "")
  // The numbered operating rules are always-on for the same reason the three sections below are:
  // no tracker configuration turns them on, off, or into something else. Stripped since gh-151,
  // which replaced rule 1's "PUSH the current epic onto the detour stack in
  // `.conductor/state.json`" — a HAND-EDIT the engine now has a verb for — and amended rules 3
  // and 4 to match. Pinning this section byte-for-byte against 0.26.0 would forbid the release
  // from correcting instruction that has nothing to do with tracker direction, which is exactly
  // the over-claim this helper's own comment warns about. Stripped FIRST so it consumes up to
  // the gate-procedure heading, which the next replace then removes in turn.
  .replace(new RegExp(`${OPERATING_RULES_HEADING}[\\s\\S]*?(?=## )`), "")
  // #158's help pointer: always-on for exactly the reason this helper documents — no tracker
  // configuration turns it on, off, or into something else. Placed here for READABILITY, matching
  // where the section sits in the rendered block — NOT because the position is load-bearing. An
  // earlier version of this comment claimed the chain would break if this replace moved later;
  // Gate 2 moved it to the end and every test still passed, because each replace is anchored at
  // its own heading and non-greedy. Correcting it rather than leaving a constraint nobody has.
  .replace(new RegExp(`${HELP_HEADING}[\\s\\S]*?(?=## )`), "")
  .replace(new RegExp(`${GATE_PROCEDURE_HEADING}[\\s\\S]*?(?=## )`), "")
  .replace(new RegExp(`${INTAKE_HEADING}[\\s\\S]*?(?=## )`), "")
  // gh-90 adds the reporting section: always-on for the same reason, and stripped for the same
  // reason — no tracker configuration turns it on, off, or into something else, and pinning it
  // byte-for-byte against 0.26.0 would forbid the release from adding it at all.
  .replace(new RegExp(`${REPORTING_HEADING}[\\s\\S]*?(?=## )`), "");
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
  assert.equal(stripAlwaysOn(block), baseline("jira-scoped"),
    "a direction-less jira primary must emit exactly what 0.26.0 emitted for it");
  assert.ok(block.includes(OUTWARD_HEADING));
  assert.ok(!block.includes("## GitHub issue sync") && !block.includes("## Inward tracker sync"));
});

test("an un-upgraded github-issues primary with a repo keeps the inward section and no outward one", () => {
  const block = rulesFor({ system: "github-issues", repo: "o/n" });
  const before = baseline("github-scoped");
  assert.equal(preTrackerPart(stripAlwaysOn(block)), preTrackerPart(before),
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

// ─────────── 10.6: a scope-less tracker emits no inward section, on either path ───────────

test("a github-issues tracker with no repo emits neither section, migrated or not", () => {
  for (const tracker of [{ system: "github-issues" }, { system: "github-issues", direction: "inward" }]) {
    const block = rulesFor(tracker);
    assert.ok(!block.includes(OUTWARD_HEADING), `outward section leaked for ${JSON.stringify(tracker)}`);
    assert.ok(!block.includes("## GitHub issue sync") && !block.includes("## Inward tracker sync"),
      `inward section leaked for ${JSON.stringify(tracker)}`);
  }
  // Same two facts in 0.26.0's output, so the assertion above is a comparison and not a wish.
  const before = baseline("github-scopeless");
  assert.ok(!before.includes(OUTWARD_HEADING) && !before.includes("## GitHub issue sync"));
});

test("adding a scope to a scope-less inward tracker is what turns the inward section on", () => {
  const without = rulesFor({ system: "jira", direction: "inward" });
  assert.ok(!without.includes("## Inward tracker sync"), "no scope, no inward section");
  const with_ = rulesFor({ system: "jira", direction: "inward", projectKey: "JOB" });
  assert.ok(with_.includes("## Inward tracker sync (jira · JOB)"), "a scope turns it on");
});

test("no emitted block ever names an unfilled scope placeholder, for ANY tracker shape", () => {
  // The rule the scope test exists to protect: pm may not emit a command line it cannot run.
  // An interpolated `undefined`/`null`, or a literal placeholder left unsubstituted, is that
  // failure — and it is invisible unless something enumerates the shapes.
  const systems = ["github-issues", "jira"];
  const scopes = [{}, { repo: "o/n" }, { projectKey: "JOB" }];
  const directions = [undefined, "inward", "outward", "both"];
  for (const system of systems) {
    for (const scope of scopes) {
      for (const direction of directions) {
        const tracker = { system, ...scope, ...(direction ? { direction } : {}) };
        const block = rulesFor(tracker);
        const label = JSON.stringify(tracker);
        for (const bad of ["undefined", "<scope>", "<repo>", "<projectKey>", "( · )", "()"]) {
          assert.ok(!block.includes(bad), `${label} emitted a block containing ${JSON.stringify(bad)}`);
        }
        // An inward section must never appear without the scope it needs to list against.
        if (block.includes("## Inward tracker sync") || block.includes("## GitHub issue sync")) {
          assert.ok(scope.repo || (system !== "github-issues" && scope.projectKey),
            `${label} emitted an inward section with nothing to list`);
        }
      }
    }
  }
});

// ─────────── 10.7: the completion-sync reminder (deliberate emitted-output change #1) ───────────

test("the completion-sync reminder is emitted only where an inward procedure actually exists", () => {
  const outwardOnly = rulesFor({ system: "jira", projectKey: "JOB", direction: "outward" });
  assert.ok(!outwardOnly.includes(REMINDER_HEADING), "an outward-only repo has nothing to re-sync inward");

  // The scope-less github case: today's engine emits the reminder for ANY github-issues
  // primary and points at "the writeback steps above" that the same block never emitted.
  const scopeless = rulesFor({ system: "github-issues" });
  assert.ok(!scopeless.includes(REMINDER_HEADING),
    "a scope-less inward primary gets no reminder — there is no inward procedure to point at");
  assert.ok(baseline("github-scopeless").includes(REMINDER_HEADING),
    "0.26.0 DID emit it here — this absence is the deliberate repair, not a no-op");

  const scoped = rulesFor({ system: "github-issues", repo: "o/n" });
  assert.ok(scoped.includes(REMINDER_HEADING), "a scoped inward primary keeps the reminder");
  assert.ok(scoped.includes("## GitHub issue sync (o/n)"),
    "and every writeback step the reminder references is emitted in the same block");

  // A secondary tracker is inward by definition, so it earns the reminder on its own.
  const outwardPlusSecondary = rulesFor(
    { system: "jira", projectKey: "JOB", direction: "outward" },
    { secondaryTrackers: [{ system: "github-issues", repo: "a/b", role: "secondary" }] });
  assert.ok(outwardPlusSecondary.includes(REMINDER_HEADING));
});

test("the scope-less github path changes in exactly one way, and it is the reminder", () => {
  const before = baseline("github-scopeless");
  const now = rulesFor({ system: "github-issues" });
  const stripReminder = (b) => b.replace(/\n*## Sync after completing tracker-linked work[\s\S]*?(?=\n<!-- END pm-conductor rules -->)/, "");
  assert.equal(stripReminder(stripAlwaysOn(now)), stripReminder(before),
    "with the reminder removed from both sides, the un-upgraded scope-less github block is " +
    "byte-identical to 0.26.0's — any second difference is a regression, not a repair");
  assert.notEqual(stripAlwaysOn(now), before,
    "…and the reminder really did go, so the comparison is not vacuous");
});

// ─────────── 10.8: the brief's TRACKER SYNC block, governed by direction ───────────

/** A brief built from a fixture repo carrying `tracker` and some unmirrored queued epics. */
function briefFor(tracker, { secondaryTrackers, epics } = {}) {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const state = readState(cwd);
  if (tracker) state.tracker = tracker;
  if (secondaryTrackers) state.secondaryTrackers = secondaryTrackers;
  state.epics = epics || [
    { id: "q1", title: "Q1", priority: "P1", status: "queued", role: "epic", lane: "claude-code", links: [] },
    { id: "q2", title: "Q2", priority: "P1", status: "queued", role: "epic", lane: "claude-code", links: [] },
  ];
  writeState(cwd, state);
  const out = run(["brief"], { cwd });
  return out.trim() ? JSON.parse(out).hookSpecificOutput.additionalContext : "";
}

test("an inward tracker with unmirrored epics demands no outward action, and the same fixture set outward does", () => {
  const base = { system: "github-issues", repo: "o/n" };
  const inward = briefFor({ ...base, direction: "inward" });
  assert.ok(!inward.includes("not yet in github-issues"),
    "a repo whose rules block has no outward procedure must not be told to create issues");

  // Presence on the IDENTICAL fixture is what proves the absence was a decision rather than a
  // dead code path — #109's root cause was a suite whose only TRACKER SYNC tests used jira.
  const outward = briefFor({ ...base, direction: "outward" });
  assert.match(outward, /not yet in github-issues — create issues \+ record keys/);
  assert.match(outward, /`q1`/);
});

test("an un-upgraded github-issues repo stops being told to create issues it never could", () => {
  // The live bug: cfdude/pm's brief demanded outward action for 29 epics under a rules block
  // carrying no outward instructions at all.
  const brief = briefFor({ system: "github-issues", repo: "cfdude/pm" });
  assert.ok(!brief.includes("not yet in github-issues"));
  const rules = rulesFor({ system: "github-issues", repo: "cfdude/pm" });
  assert.ok(!rules.includes(OUTWARD_HEADING),
    "the two emitters must agree — the brief's silence matches the rules block's");
});

// ─────────── 10.9: the sync nudge (deliberate emitted-output change #2) ───────────

test("the sync nudge is emitted only where an inward procedure exists", () => {
  const outwardOnly = briefFor({ system: "jira", projectKey: "JOB", direction: "outward" });
  assert.ok(!outwardOnly.includes("consider `/pm:sync`"),
    "an outward-only tracker cannot produce new inward items, so there is nothing to nudge for");

  const withSecondary = briefFor(
    { system: "jira", projectKey: "JOB", direction: "outward" },
    { secondaryTrackers: [{ system: "github-issues", repo: "a/b", role: "secondary" }] });
  assert.match(withSecondary, /consider `\/pm:sync`/);

  const scopeless = briefFor({ system: "github-issues" });
  assert.ok(!scopeless.includes("consider `/pm:sync`"),
    "a scope-less inward tracker names nothing to list, so the nudge instructs an action the " +
    "repo has no procedure for");
});

// ─────────── 10.10: the emitter-coherence matrix ───────────

test("rules block and brief agree about outward action for every direction and system", () => {
  for (const system of ["github-issues", "jira"]) {
    const scope = system === "github-issues" ? { repo: "o/n" } : { projectKey: "JOB" };
    for (const direction of ["inward", "outward", "both"]) {
      const tracker = { system, ...scope, direction };
      const rulesOutward = rulesFor(tracker).includes(OUTWARD_HEADING);
      const briefOutward = briefFor(tracker).includes("create issues + record keys");
      assert.equal(rulesOutward, briefOutward,
        `${JSON.stringify(tracker)}: rules block outward=${rulesOutward}, brief outward=${briefOutward}`);
    }
  }
});

test("the scope-less case makes every inward-dependent emitter false together", () => {
  const tracker = { system: "github-issues" };            // direction resolves inward, no scope
  const block = rulesFor(tracker);
  const brief = briefFor(tracker);
  assert.ok(!block.includes("## GitHub issue sync") && !block.includes("## Inward tracker sync"),
    "no inward section");
  assert.ok(!brief.includes("never re-read since mirroring"), "no freshness line");
  assert.ok(!brief.includes("consider `/pm:sync`"), "no sync nudge");
  assert.ok(!block.includes(REMINDER_HEADING), "no completion-sync reminder");
  assert.ok(!block.includes("gh issue list"), "and /pm:sync is instructed to read nothing external");
});

test("no emitter recomputes direction from system, repo or direction locally", () => {
  // The structural half of the fix. #109 was not a wrong line — it was the SAME question
  // answered in two places, so the two answers drifted. Every emitter now reads the resolved
  // values from constants.mjs; an emitter that names the vendor or reads `.direction` itself is
  // a second answer waiting to disagree with the first.
  const LIB = new URL("../lib/", import.meta.url).pathname;
  const EMITTERS = ["rules.mjs", "briefing.mjs", "subcommands.mjs", "render.mjs"];
  for (const name of EMITTERS) {
    const src = fs.readFileSync(path.join(LIB, name), "utf8");
    const code = src.split("\n")
      .filter(l => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/*"))
      .join("\n");
    assert.ok(!code.includes('"github-issues"'),
      `${name} names the github-issues vendor in code — phrasing goes through usesGhIssueList, ` +
      "and section choice through outwardApplies/inwardProcedureEmittable");
    assert.ok(!/\.direction\b/.test(code),
      `${name} reads a tracker's .direction itself — direction resolves in constants.mjs only`);
  }
  // Non-vacuity: the predicates the emitters must be using really are exported from there.
  const constants = fs.readFileSync(path.join(LIB, "constants.mjs"), "utf8");
  for (const fn of ["outwardApplies", "inwardProcedureEmittable", "anyInwardProcedureEmittable", "usesGhIssueList"]) {
    assert.ok(constants.includes(`export const ${fn}`) || constants.includes(`export function ${fn}`),
      `constants.mjs must export ${fn}`);
  }
});

// ─────────── 10.11: what /pm:sync instructs is decided by direction ───────────

/** Everything `sync` tells the agent for this tracker shape: the rules block it reads plus
 *  sync's own confirmation line. */
function syncInstructions(tracker) {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const state = readState(cwd);
  state.tracker = tracker;
  writeState(cwd, state);
  return run(["rules"], { cwd }) + "\n" + runCombined(["sync"], { cwd });
}

test("sync in an outward-only repo instructs no step that reads or lists from the tracker", () => {
  const text = syncInstructions({ system: "jira", projectKey: "JOB", direction: "outward" });
  for (const readStep of ["gh issue list", "List open items in", "list open items in"]) {
    assert.ok(!text.includes(readStep), `an outward-only repo was instructed to ${readStep}`);
  }
  assert.match(text, /registered local OpenSpec\/Superpowers sources only/,
    "and it says so, rather than leaving the absence to be inferred");
});

test("sync in an inward repo instructs the pull and the watermark comparison", () => {
  const text = syncInstructions({ system: "github-issues", repo: "o/n", direction: "inward" });
  assert.match(text, /gh issue list --repo o\/n/, "list open items");
  assert.match(text, /externalUrl/, "register the unmirrored ones without duplicating");
  assert.match(text, /externalUpdatedAt/, "compare each linked item's timestamp against the watermark");
});

// ─────────── 11.1: the freshness watermark ───────────

test("externalUpdatedAt is accepted by every epic-writing surface and reads back", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code", "--external-id", "7",
       "--external-url", "https://x.test/7", "--external-updated-at", "2026-08-20T10:00:00Z"], { cwd });
  assert.equal(readState(cwd).epics.find(e => e.id === "a").externalUpdatedAt, "2026-08-20T10:00:00Z");

  run(["update-epic", "a", "--external-updated-at", "2026-08-23T09:30:00Z"], { cwd });
  assert.equal(readState(cwd).epics.find(e => e.id === "a").externalUpdatedAt, "2026-08-23T09:30:00Z");

  // The bulk path carries it identically — a batch key derived from the same registry entry.
  const batch = path.join(cwd, "batch.json");
  fs.writeFileSync(batch, JSON.stringify({ epics: [
    { id: "b", lane: "claude-code", externalId: "8", externalUrl: "https://x.test/8",
      externalUpdatedAt: "2026-08-21T11:00:00Z" },
  ] }));
  run(["add-many", "--from", batch], { cwd });
  assert.equal(readState(cwd).epics.find(e => e.id === "b").externalUpdatedAt, "2026-08-21T11:00:00Z");
});

test("the emitted list step contains no watermark write — listing cannot advance it", () => {
  const block = rulesFor({ system: "github-issues", repo: "o/n", direction: "inward" });
  const listStep = block.split("\n").find(l => l.includes("gh issue list"));
  assert.ok(listStep, "the inward section must still emit a list step");
  assert.ok(!listStep.includes("--external-updated-at"),
    "the LIST step must not write a watermark — seeing an item in a list response is not " +
    "reading it, and a list-driven stamp would erase the drift sync exists to find");
  assert.match(block.replace(/\n\s+/g, " "), /listing alone must never advance the watermark/,
    "and the block says so outright");
});

// ─────────── 10.12: the emitted registration recipe runs as written ───────────

/** The emitted `add-epic` recipe, turned into argv with ONLY its documented placeholders
 *  filled in. Nothing is invented: whatever the block says is exactly what gets run. */
function emittedRegistration(block, { number, url, title, updatedAt }) {
  const line = block.split("\n").find(l => l.includes("`add-epic --id "));
  assert.ok(line, "the rules block must emit an add-epic recipe carrying a derived --id");
  const cmd = line.slice(line.indexOf("`") + 1, line.lastIndexOf("`"));
  const filled = cmd
    .replace(/<issue-number>/g, String(number))
    .replace(/"<issue-title>"/g, "TITLE")
    .replace(/<issue-url>/g, url)
    .replace(/<issue-updated-at>/g, updatedAt || "2026-08-23T09:30:00Z")
    // `<lane>` is a documented placeholder like the others: the recipe takes it from lane
    // routing rather than hardcoding one, so filling it is the agent's step, not an invention.
    .replace(/<lane>/g, "claude-code");
  return filled.trim().split(/\s+/);
}

test("the emitted registration recipe executes verbatim, and the same item yields the same id", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const state = readState(cwd);
  state.tracker = { system: "github-issues", repo: "cfdude/pm", direction: "inward" };
  writeState(cwd, state);
  const block = run(["rules"], { cwd });
  const argv = emittedRegistration(block, { number: 109, url: "https://github.com/cfdude/pm/issues/109" });
  assert.ok(argv.includes("--id"), "the recipe must supply the required --id it used to omit");

  run(argv, { cwd });                                     // exits 0 …
  const created = readState(cwd).epics.filter(e => e.externalId === "109");
  assert.equal(created.length, 1, "…and the epic exists");
  const id = created[0].id;

  // A second session follows the same recipe for the same item: same id, refused as a
  // duplicate — never a second epic under a differently invented slug.
  const err = expectFail(() => run(argv, { cwd }));
  assert.ok(err, "the second run must be refused");
  const after = readState(cwd).epics.filter(e => e.externalId === "109");
  assert.equal(after.length, 1);
  assert.equal(after[0].id, id, "the derived id is stable across runs");
});

test("the derived id carries the tracker's scope, so issue #42 in two repos does not collide", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const state = readState(cwd);
  state.secondaryTrackers = [
    { system: "github-issues", repo: "acme/market-intelligence", role: "secondary" },
    { system: "github-issues", repo: "acme/risk-engine", role: "secondary" },
  ];
  writeState(cwd, state);
  const block = run(["rules"], { cwd });
  const a = emittedRegistration(block.slice(block.indexOf("## Secondary tracker sync (github-issues · acme/market-intelligence")),
    { number: 42, url: "https://github.com/acme/market-intelligence/issues/42" });
  const b = emittedRegistration(block.slice(block.indexOf("## Secondary tracker sync (github-issues · acme/risk-engine")),
    { number: 42, url: "https://github.com/acme/risk-engine/issues/42" });
  run(a, { cwd });
  run(b, { cwd });
  const ids = readState(cwd).epics.filter(e => e.externalId === "42").map(e => e.id);
  assert.equal(ids.length, 2, "two distinct epics — externalId alone is not a duplicate test");
  assert.notEqual(ids[0], ids[1]);
});

// ─────────── 10.13: a mirrored item's lane comes from lane routing ───────────

test("the emitted recipe takes the lane from lane routing, not a hardcoded claude-code", () => {
  const block = rulesFor({ system: "github-issues", repo: "cfdude/pm", direction: "inward" });
  assert.ok(!block.includes("--lane claude-code"),
    "a hardcoded lane silently decides, for every mirrored item, whether the work leaves any " +
    "spec, plan or gate record");
  assert.match(block, /suggest-lane/, "the recipe must name lane routing as the source");
  assert.match(block.replace(/\n\s+/g, " "), /record .*why|reason/i,
    "and permit an override with a stated reason recorded on the epic");
});

test("the routed recipe still runs as written once its lane placeholder is filled", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const state = readState(cwd);
  state.tracker = { system: "github-issues", repo: "cfdude/pm", direction: "inward" };
  writeState(cwd, state);
  const argv = emittedRegistration(run(["rules"], { cwd }),
    { number: 114, url: "https://github.com/cfdude/pm/issues/114" });
  run(argv, { cwd });
  const epic = readState(cwd).epics.find(e => e.externalId === "114");
  assert.ok(epic, "the recipe with a routed lane still exits zero and creates the epic");
  assert.ok(epic.lane, "and the epic carries whatever lane routing supplied");
});

// ─────────── 10.14: the two MODIFIED tracker-sync behaviors ───────────

test("setting the primary tracker merges every unnamed field and never writes secondaryTrackers", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["set-tracker", "--system", "jira", "--instance", "onvex", "--project", "JOB",
       "--mechanism", "mcp", "--intent", "active:in-progress", "--direction", "outward"], { cwd });
  run(["set-tracker", "--role", "secondary", "--system", "github-issues", "--repo", "a/b"], { cwd });
  const before = JSON.stringify(readState(cwd).secondaryTrackers);

  run(["set-tracker", "--intent", "paused:todo"], { cwd });
  const t = readState(cwd).tracker;
  assert.equal(t.system, "jira");
  assert.equal(t.instance, "onvex");
  assert.equal(t.projectKey, "JOB");
  assert.equal(t.mechanism, "mcp");
  assert.equal(t.direction, "outward", "an explicitly chosen direction survives a merge");
  assert.deepEqual(t.statusIntent, { active: "in-progress", paused: "todo" });
  assert.equal(JSON.stringify(readState(cwd).secondaryTrackers), before,
    "the primary write must not touch state.secondaryTrackers");
});

test("issue #42 in two secondary repos registers as two DISTINCT epics", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const state = readState(cwd);
  state.secondaryTrackers = [
    { system: "github-issues", repo: "acme/market-intelligence", role: "secondary" },
    { system: "github-issues", repo: "acme/risk-engine", role: "secondary" },
  ];
  writeState(cwd, state);
  const block = run(["rules"], { cwd });
  for (const [repo, url] of [
    ["acme/market-intelligence", "https://github.com/acme/market-intelligence/issues/42"],
    ["acme/risk-engine", "https://github.com/acme/risk-engine/issues/42"],
  ]) {
    const section = block.slice(block.indexOf(`## Secondary tracker sync (github-issues · ${repo}`));
    run(emittedRegistration(section, { number: 42, url }), { cwd });
  }
  const mirrored = readState(cwd).epics.filter(e => e.externalId === "42");
  assert.equal(mirrored.length, 2, "externalId alone must not read as a duplicate across trackers");
  assert.equal(new Set(mirrored.map(e => e.id)).size, 2);
  assert.equal(new Set(mirrored.map(e => e.externalUrl)).size, 2);
  assert.match(block, /when both sides carry one/,
    "and the block states the nuance: a URL-less legacy epic must not falsely block a distinct one");
});

// ─────────── 11.6: the refresh block is opt-out; the reconcile block is not ───────────

/** Run the PreToolUse gate-guard hook and report whether it blocked (exit 2). */
function guardBlocks(cwd) {
  const r = spawnSync("node", [ENGINE, "gate-guard"], {
    cwd, env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, PM_CACHE_ROOT: EMPTY_CACHE },
    encoding: "utf8", input: JSON.stringify({ tool_input: {} }),
  });
  return { blocked: r.status === 2, message: (r.stderr || "") };
}

function repoWithActiveEpic(extra) {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const state = readState(cwd);
  state.epics = [{ id: "a", title: "A", priority: "P1", status: "active", role: "epic",
    lane: "claude-code", links: [], ...extra }];
  state.active = "a";
  writeState(cwd, state);
  return cwd;
}

test("the tracker-refresh block honors the gate-guard setting", () => {
  const cwd = repoWithActiveEpic({ externalId: "7", trackerRefreshNeeded: true });
  run(["set-gate-guard", "on"], { cwd });
  const on = guardBlocks(cwd);
  assert.equal(on.blocked, true, "with the guard ON, an outstanding tracker refresh blocks");
  assert.match(on.message, /refresh/i);

  run(["set-gate-guard", "off"], { cwd });
  assert.equal(guardBlocks(cwd).blocked, false,
    "with the guard OFF it must not block — an agent that is offline, unauthenticated, or " +
    "facing a deleted upstream item has to be able to proceed honestly rather than record a " +
    "blind `unchanged`");
});

test("turning the guard off does not weaken the unconditional reconcile block", () => {
  for (const setting of ["on", "off"]) {
    const cwd = repoWithActiveEpic({ reconcileNeeded: true });
    run(["set-gate-guard", setting], { cwd });
    const r = guardBlocks(cwd);
    assert.equal(r.blocked, true, `reconcile must block with the guard ${setting}`);
    assert.match(r.message, /reconcile/i);
  }
});

// ─────────── 11.2 / 11.3: one activation door, and the refresh obligation behind it ───────────

test("a batch entry at active status becomes the single active epic and demotes the other", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "old", "--lane", "claude-code", "--status", "active"], { cwd });
  const batch = path.join(cwd, "b.json");
  fs.writeFileSync(batch, JSON.stringify({ epics: [
    { id: "fresh", lane: "claude-code", status: "active" },
  ] }));
  run(["add-many", "--from", batch], { cwd });
  const s = readState(cwd);
  assert.equal(s.active, "fresh", "add-many never called activate(), so it set no active pointer");
  assert.equal(s.epics.find(e => e.id === "fresh").status, "active");
  assert.equal(s.epics.find(e => e.id === "old").status, "queued",
    "the single-active invariant binds bulk creation too");
});

test("every activation path sets the refresh obligation identically, keyed on provenance", () => {
  const linked = { externalId: "7", externalUrl: "https://x.test/7" };

  // 1. set-active
  let cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code", "--external-id", "7",
       "--external-url", "https://x.test/7"], { cwd });
  run(["set-active", "a"], { cwd });
  assert.equal(readState(cwd).epics.find(e => e.id === "a").trackerRefreshNeeded, true, "set-active");

  // 2. update-epic --status active
  cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code", "--external-id", "7",
       "--external-url", "https://x.test/7"], { cwd });
  run(["update-epic", "a", "--status", "active"], { cwd });
  assert.equal(readState(cwd).epics.find(e => e.id === "a").trackerRefreshNeeded, true, "update-epic");

  // 3. add-epic created active WITHOUT a fresh read
  cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code", "--status", "active",
       "--external-id", "7", "--external-url", "https://x.test/7"], { cwd });
  assert.equal(readState(cwd).epics.find(e => e.id === "a").trackerRefreshNeeded, true, "add-epic");

  // 4. add-many
  cwd = tmpRepo();
  run(["init"], { cwd });
  const batch = path.join(cwd, "b.json");
  fs.writeFileSync(batch, JSON.stringify({ epics: [
    { id: "a", lane: "claude-code", status: "active", ...linked },
  ] }));
  run(["add-many", "--from", batch], { cwd });
  assert.equal(readState(cwd).epics.find(e => e.id === "a").trackerRefreshNeeded, true, "add-many");
});

test("an epic created active in the same command that read the item owes nothing", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code", "--status", "active",
       "--external-id", "7", "--external-url", "https://x.test/7",
       "--external-updated-at", "2026-08-23T09:30:00Z"], { cwd });
  const e = readState(cwd).epics.find(x => x.id === "a");
  assert.ok(!e.trackerRefreshNeeded, "the agent just read the item — an immediate re-read is noise");
});

test("provenance, never direction, decides the obligation", () => {
  // An epic with no external id owes no TRACKER refresh whatever the repo's direction is; an
  // epic with one owes it even under `outward`, because a linked item accumulates third-party
  // context regardless of which way it was born.
  for (const direction of ["inward", "outward", "both"]) {
    const cwd = tmpRepo();
    run(["init"], { cwd });
    run(["set-tracker", "--system", "jira", "--project", "JOB", "--direction", direction], { cwd });
    run(["add-epic", "--id", "local", "--lane", "openspec"], { cwd });
    run(["add-epic", "--id", "linked", "--lane", "claude-code", "--external-id", "7",
         "--external-url", "https://x.test/7"], { cwd });
    run(["set-active", "local"], { cwd });
    assert.ok(!readState(cwd).epics.find(e => e.id === "local").trackerRefreshNeeded,
      `local-origin epic owes nothing under ${direction}`);
    run(["set-active", "linked"], { cwd });
    assert.equal(readState(cwd).epics.find(e => e.id === "linked").trackerRefreshNeeded, true,
      `tracker-linked epic owes a re-read under ${direction}`);
  }
});

// ─────────── 11.5: recording a refresh verdict advances the watermark ───────────

function linkedActiveRepo() {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code", "--external-id", "7",
       "--external-url", "https://x.test/7"], { cwd });
  run(["set-active", "a"], { cwd });
  return cwd;
}

test("a material-change verdict records the judgment, advances the watermark, and clears the debt", () => {
  const cwd = linkedActiveRepo();
  assert.equal(readState(cwd).epics.find(e => e.id === "a").trackerRefreshNeeded, true);
  run(["record-tracker-refresh", "a", "--verdict", "material-change",
       "--summary", "a third party narrowed the ask", "--external-updated-at", "2026-08-23T09:30:00Z"], { cwd });
  const e = readState(cwd).epics.find(x => x.id === "a");
  assert.equal(e.trackerRefresh.verdict, "material-change");
  assert.equal(e.trackerRefresh.summary, "a third party narrowed the ask");
  assert.ok(!Number.isNaN(Date.parse(e.trackerRefresh.recordedAt)), "when it was recorded");
  assert.equal(e.trackerRefresh.externalUpdatedAt, "2026-08-23T09:30:00Z");
  assert.equal(e.externalUpdatedAt, "2026-08-23T09:30:00Z", "the watermark itself advances");
  assert.ok(!e.trackerRefreshNeeded, "and the obligation is cleared");
});

test("a verdict with no watermark is refused, writing nothing", () => {
  const cwd = linkedActiveRepo();
  const before = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
  const err = expectFail(() => run(["record-tracker-refresh", "a", "--verdict", "unchanged"], { cwd }));
  assert.ok(err, "a verdict can never be recorded without advancing the watermark");
  assert.match(String(err.stderr || err.message), /--external-updated-at/);
  assert.equal(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"), before,
    "state.json must be byte-identical after the refusal");
});

test("a verdict on an epic with no external origin is refused, writing nothing", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "local", "--lane", "openspec"], { cwd });
  const before = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
  const err = expectFail(() => run(["record-tracker-refresh", "local", "--verdict", "unchanged",
    "--external-updated-at", "2026-08-23T09:30:00Z"], { cwd }));
  assert.ok(err);
  assert.match(String(err.stderr || err.message), /external/i);
  assert.equal(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"), before);
});

test("an unknown verdict is refused by name", () => {
  const cwd = linkedActiveRepo();
  const err = expectFail(() => run(["record-tracker-refresh", "a", "--verdict", "probably-fine",
    "--external-updated-at", "2026-08-23T09:30:00Z"], { cwd }));
  assert.ok(err);
  assert.match(String(err.stderr || err.message), /unchanged\|material-change|unchanged, material-change/);
});

// ─────────── 11.4: the refresh debt survives a compaction, on both surfaces ───────────

test("a tracker-linked active epic shows its refresh debt in the brief and PROJECT.md", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code", "--external-id", "7",
       "--external-url", "https://x.test/7"], { cwd });
  run(["set-active", "a"], { cwd });
  assert.match(parseBrief(cwd), /refresh/i, "the brief must re-teach the debt to a compacted session");
  assert.match(projectMd(cwd), /refresh/i, "and the rendered record must carry it too");
});

test("a local-origin active epic owes no tracker refresh and gets the local instruction", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "local", "--lane", "superpowers"], { cwd });
  run(["set-active", "local"], { cwd });
  const state = readState(cwd);
  assert.ok(!state.epics.find(e => e.id === "local").trackerRefreshNeeded);
  assert.ok(!parseBrief(cwd).match(/owes a tracker refresh/i),
    "an epic with no external origin must not be told to re-read a tracker item");
  // The local re-read is INSTRUCTION and records nothing in state — it lives in the rules block.
  const rules = run(["rules"], { cwd });
  assert.match(rules, /re-read its local source|plan document/i);
  assert.match(rules, /nothing is recorded in state|records nothing/i);
});

// ─────────── 12.2: update-epic --lane and --plan ───────────
//
// A lane was settable only at creation, so a mis-routed epic could be corrected in exactly one
// way: remove it and register it again, losing its start time, its gate verdicts, its links and
// its stories. `--lane` is validated against KNOWN_LANES by the SAME list creation validates
// against, so the two surfaces cannot admit different lanes.
//
// "list position unchanged" is read as the epic's position in `state.epics[]` — the stored list.
// It cannot mean RENDERED order: resolveEpics() sorts by priority then laneRank then id, so
// changing a lane necessarily moves an epic in the rendered table by construction. The stored
// list is what an in-place field write must not disturb.

test("changing a lane is an in-place field write — nothing else about the epic moves", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "first", "--lane", "claude-code"], { cwd });
  run(["add-epic", "--id", "e1", "--lane", "openspec", "--title", "keep me"], { cwd });
  run(["add-epic", "--id", "last", "--lane", "claude-code"], { cwd });
  run(["update-epic", "e1", "--link", "depends-on:first", "--add-story", "s one"], { cwd });
  run(["set-active", "e1"], { cwd });
  run(["record-gate-review", "e1", "--gate", "1", "--verdict", "pass",
       "--base-sha", "aaa", "--head-sha", "bbb"], { cwd });

  const before = readState(cwd);
  const idxBefore = before.epics.findIndex(e => e.id === "e1");
  const b = before.epics[idxBefore];

  run(["update-epic", "e1", "--lane", "superpowers"], { cwd });

  const after = readState(cwd);
  const idxAfter = after.epics.findIndex(e => e.id === "e1");
  const a = after.epics[idxAfter];
  assert.equal(a.lane, "superpowers", "the lane must actually change");
  assert.equal(idxAfter, idxBefore, "the epic's position in state.epics[] must not move");
  assert.equal(a.startedAt, b.startedAt, "start time must survive a lane change");
  assert.deepEqual(a.gateReview, b.gateReview, "a recorded gate verdict must survive a lane change");
  assert.deepEqual(a.links, b.links, "links must survive a lane change");
  assert.deepEqual(a.stories, b.stories, "stories must survive a lane change");
  assert.equal(a.title, "keep me");
});

test("an invalid lane exits non-zero naming the valid lanes, with the epic unchanged", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "e1", "--lane", "claude-code"], { cwd });
  const before = readState(cwd).epics.find(e => e.id === "e1");
  const err = expectFail(() => run(["update-epic", "e1", "--lane", "sideways"], { cwd }));
  assert.ok(err, "an unknown lane must not exit 0");
  const msg = String(err.stderr || err.message);
  for (const l of ["openspec", "superpowers", "claude-code", "decision", "external"]) {
    assert.ok(msg.includes(l), `the refusal must name '${l}' as a valid lane`);
  }
  assert.deepEqual(readState(cwd).epics.find(e => e.id === "e1"), before, "nothing may be written");
});

test("--plan attaches a plan to an epic created without one, and refuses a valueless flag", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "e1", "--lane", "superpowers"], { cwd });
  assert.equal(readState(cwd).epics.find(e => e.id === "e1").planPath, undefined);
  run(["update-epic", "e1", "--plan", "docs/superpowers/plans/p.md"], { cwd });
  assert.equal(readState(cwd).epics.find(e => e.id === "e1").planPath, "docs/superpowers/plans/p.md");
  // A valueless --plan arrives as boolean true; storing it would put `true` in planPath.
  const err = expectFail(() => run(["update-epic", "e1", "--plan"], { cwd }));
  assert.ok(err, "--plan with no value must be refused, never stored as `true`");
  assert.equal(readState(cwd).epics.find(e => e.id === "e1").planPath, "docs/superpowers/plans/p.md");
});

// ─────────── 12.3: --clear-links, and a valueless --link that refuses ───────────
//
// `--link` REPLACES the links array, and a VALUELESS `--link` arrives as `[true]` (it is a
// repeatable flag), which parseLinkFlags filters down to `[]` — so the one spelling an agent
// reaches for to empty the array silently empties it while looking like a typo, and the one
// spelling that says "empty it" did not exist. Clearing is now a NAMED flag; the valueless form
// is refused.

test("--clear-links empties the links and touches nothing else about the epic", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "other", "--lane", "claude-code"], { cwd });
  run(["add-epic", "--id", "e1", "--lane", "openspec", "--title", "keep me", "--priority", "P1"], { cwd });
  run(["update-epic", "e1", "--link", "depends-on:other", "--add-story", "s one"], { cwd });
  run(["record-gate-review", "e1", "--gate", "2", "--verdict", "pass",
       "--base-sha", "aaa", "--head-sha", "bbb"], { cwd });
  run(["update-epic", "e1", "--status", "paused"], { cwd });
  const b = readState(cwd).epics.find(e => e.id === "e1");
  assert.equal(b.links.length, 1, "the fixture must actually have a link to clear");

  run(["update-epic", "e1", "--clear-links"], { cwd });
  const a = readState(cwd).epics.find(e => e.id === "e1");
  assert.deepEqual(a.links, [], "--clear-links empties the array");
  assert.equal(a.title, "keep me");
  assert.equal(a.status, "paused");
  assert.equal(a.priority, "P1");
  assert.deepEqual(a.stories, b.stories);
  assert.deepEqual(a.gateReview, b.gateReview);
});

test("--link with no value is refused rather than silently emptying the array", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "other", "--lane", "claude-code"], { cwd });
  run(["add-epic", "--id", "e1", "--lane", "claude-code"], { cwd });
  run(["update-epic", "e1", "--link", "depends-on:other"], { cwd });
  const err = expectFail(() => run(["update-epic", "e1", "--link"], { cwd }));
  assert.ok(err, "a valueless --link must exit non-zero, not empty the links");
  const msg = String(err.stderr || err.message);
  assert.ok(msg.includes("--link"), "the refusal must name the flag");
  assert.ok(msg.includes("--clear-links"), "and point at the flag that DOES clear links");
  assert.equal(readState(cwd).epics.find(e => e.id === "e1").links.length, 1,
    "the links must survive the refusal untouched");
});

test("the clearing form is named in update-epic's usage line and in commands/epic.md", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const err = expectFail(() => run(["update-epic"], { cwd }));
  assert.ok(String(err.stderr || err.message).includes("--clear-links"),
    "the usage line must name --clear-links");
  const doc = fs.readFileSync(path.join(path.dirname(ENGINE), "..", "commands", "epic.md"), "utf8");
  const start = doc.indexOf("## Write-back — `update-epic`");
  const next = doc.indexOf("\n## ", start + 1);
  assert.ok(doc.slice(start, next === -1 ? doc.length : next).includes("--clear-links"),
    "commands/epic.md's update-epic section must name --clear-links");
});

// ─────────── 12.4: a misplaced --id is DIAGNOSED, never answered with a usage dump (#71) ───────────
//
// `update-epic`'s id is POSITIONAL and stays that way. `--id my-epic` therefore leaves argv[0]
// starting with `--`, the id resolves undefined, and the command printed its whole usage line —
// which names ~25 flags and does not mention that `--id` is the problem. Two DISTINCT
// diagnoses now: a misplaced `--id`, and no id in any form.

test("update-epic --id is diagnosed by name, not answered with a bare usage dump (#71)", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "my-epic", "--lane", "claude-code"], { cwd });
  const err = expectFail(() => run(["update-epic", "--id", "my-epic", "--priority", "P1"], { cwd }));
  if (err === null) {
    // The accepted-as-an-alias branch the task also permits: it must have performed the update.
    assert.equal(readState(cwd).epics.find(e => e.id === "my-epic").priority, "P1");
    return;
  }
  const msg = String(err.stderr || err.message);
  assert.ok(msg.includes("--id"), "the message must name --id as the problem");
  assert.ok(msg.includes("update-epic <id>"), "and show the positional form that works");
  assert.equal(readState(cwd).epics.find(e => e.id === "my-epic").priority, "P?",
    "a refusal writes nothing");
});

test("update-epic with no id in any form says the id is required positionally", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const err = expectFail(() => run(["update-epic", "--priority", "P1"], { cwd }));
  assert.ok(err, "no id at all must exit non-zero");
  const msg = String(err.stderr || err.message);
  assert.ok(msg.includes("update-epic <id>"), "the message must show the positional form");
  assert.match(msg, /positional/i, "and say the id is required positionally");
  assert.ok(!msg.includes("--id"),
    "this case must NOT be diagnosed as a misplaced --id — the two are different mistakes");
});

// ─────────── 12.5: a backlog epic's description reaches the rendered record ───────────
//
// The Epics table carries an epic's id, lane, role, status, progress and links — not its title
// and not a word of why it exists. A backlog epic registered months ago is therefore an id and
// nothing else on the surface a human reads, and the rationale that justified registering it is
// recoverable only by opening `.conductor/state.json`.

test("a backlog epic's description is recoverable from PROJECT.md alone", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "someday-thing", "--lane", "claude-code", "--status", "later",
       "--title", "Rework the importer",
       "--description", "the CSV path silently drops rows over 64KB"], { cwd });
  const md = projectMd(cwd);
  assert.ok(md.includes("the CSV path silently drops rows over 64KB"),
    "the rationale must be readable without opening state.json");
  assert.ok(md.includes("Rework the importer"), "and the title alongside it");
  assert.ok(md.includes("someday-thing"));
});

test("a planned epic is backlog too, and a described active epic is not listed there", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "road", "--lane", "superpowers", "--status", "planned",
       "--title", "Roadmap item", "--description", "why this is on the roadmap"], { cwd });
  run(["add-epic", "--id", "now", "--lane", "claude-code", "--status", "active",
       "--title", "In flight", "--description", "active work, not backlog"], { cwd });
  const md = projectMd(cwd);
  const start = md.indexOf("## Backlog");
  assert.notEqual(start, -1, "a backlog section must exist once there is backlog to show");
  const next = md.indexOf("\n## ", start + 1);
  const section = md.slice(start, next === -1 ? md.length : next);
  assert.ok(section.includes("why this is on the roadmap"), "a planned epic belongs to the backlog");
  assert.ok(!section.includes("active work, not backlog"),
    "an active epic is not backlog and must not be listed there");
});

test("no backlog section is rendered when there is no backlog", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "now", "--lane", "claude-code", "--status", "queued"], { cwd });
  assert.ok(!projectMd(cwd).includes("## Backlog"),
    "an empty section is noise — it is omitted like every other conditional section");
});

// ─────────── 11.7: the freshness line — locally computable, and nothing more ───────────
//
// "How many linked items have NEWER remote activity" is a network call the engine is forbidden
// to make. The honest population is the one whose content has never been read since it was
// mirrored: an external id present, no watermark. It is emitted only where an inward procedure
// is emittable AND the count is greater than zero.

/** A repo with `n` tracker-linked epics carrying no watermark, under `tracker`/`secondaries`. */
function neverReReadRepo(n, { tracker, secondaries } = {}) {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  for (let i = 1; i <= n; i++) {
    run(["add-epic", "--id", `linked-${i}`, "--lane", "claude-code",
         "--external-id", String(i), "--external-url", `https://x.test/${i}`], { cwd });
  }
  const state = readState(cwd);
  if (tracker) state.tracker = tracker;
  if (secondaries) state.secondaryTrackers = secondaries;
  writeState(cwd, state);
  return cwd;
}

const FRESHNESS = /(\d+) tracker-linked epic\(s\) never re-read since mirroring/;

test("three never-re-read epics produce the line, and it names the count it found", () => {
  const cwd = neverReReadRepo(3, { tracker: { system: "github-issues", repo: "o/n" } });
  const m = parseBrief(cwd).match(FRESHNESS);
  assert.ok(m, "an inward repo with unread linked epics must report the freshness debt");
  assert.equal(m[1], "3", "the line names the count actually found");
});

test("the line disappears once every linked epic carries a watermark", () => {
  const cwd = neverReReadRepo(3, { tracker: { system: "github-issues", repo: "o/n" } });
  for (let i = 1; i <= 3; i++) {
    run(["update-epic", `linked-${i}`, "--external-updated-at", "2026-08-23T09:30:00Z"], { cwd });
  }
  assert.ok(!FRESHNESS.test(parseBrief(cwd)),
    "a watermark on every linked epic leaves nothing to report");
});

test("an outward-only repo gets no freshness line — there is no inward procedure to run", () => {
  const cwd = neverReReadRepo(3, { tracker: { system: "jira", projectKey: "JOB", direction: "outward" } });
  assert.ok(!FRESHNESS.test(parseBrief(cwd)));
});

test("no brief, under ANY tracker configuration, claims anything about remote activity", () => {
  // The engine performs no network I/O and never will, so a count of items with newer remote
  // activity is a claim it cannot support. This scans the emitted text rather than the code, so
  // it fails on the phrasing regardless of which surface introduced it.
  const FORBIDDEN = [
    /remote activity/i, /newer remote/i, /newer upstream/i, /changed upstream/i,
    /updated remotely/i, /have newer/i, /out of date in/i,
  ];
  const shapes = [
    undefined,
    { system: "github-issues", repo: "o/n" },
    { system: "github-issues" },
    { system: "jira", projectKey: "JOB" },
    { system: "jira", projectKey: "JOB", direction: "inward" },
    { system: "jira", projectKey: "JOB", direction: "both" },
    { system: "linear", repo: "o/n", direction: "outward" },
  ];
  for (const tracker of shapes) {
    const cwd = neverReReadRepo(2, { tracker });
    const brief = parseBrief(cwd);
    for (const re of FORBIDDEN) {
      assert.ok(!re.test(brief),
        `the brief for ${JSON.stringify(tracker)} claims remote knowledge (${re}) the engine cannot have`);
    }
  }
});

// ─────────── 10.10 (extended): the coherence matrix's secondary-only case ───────────
//
// Every fixture in the original matrix carries a PRIMARY tracker, which is how a split between
// two inward-gated emitters survived it. A secondary-only repo has an emittable inward procedure
// with `state.tracker` absent — and the sync nudge gated on `inwardHere && trackerCount > 0`
// while the freshness line was pushed into a block rendered only `if (tracker && …)`. Same
// predicate, opposite truth values: #109's shape at two different emitters.

test("a secondary-only inward repo keeps every inward-gated emitter in agreement", () => {
  const secondaries = [{ system: "github-issues", repo: "o/second", role: "secondary", direction: "inward" }];
  const cwd = neverReReadRepo(3, { secondaries });
  const brief = parseBrief(cwd);
  const nudge = brief.includes("consider `/pm:sync`");
  const freshness = FRESHNESS.test(brief);
  assert.equal(nudge, freshness,
    "the sync nudge and the freshness line read the same predicate — they cannot disagree");
  assert.ok(nudge, "a secondary tracker with a scope DOES have an emittable inward procedure");
  // And the rules block agrees: the secondary inward section is emitted for the same repo.
  assert.ok(run(["rules"], { cwd }).includes("## Secondary tracker sync (github-issues · o/second)"));
});
