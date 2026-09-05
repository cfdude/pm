import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { tmpRepo, run, runCombined, readState, writeState, projectMd, parseBrief, fixturePluginRoot, gitInitWithCommit, expectFail, stripAlwaysOn, REFRESH_GATE_HEADING } from "./helpers.mjs";

// conductor-tells-the-truth, groups 7–9: the 0.27.0 migration, the archive backfill, and the
// read-only integrity checks. Split from conductor-13/14 for the same reason those were split
// from each other — one file per wave keeps each one's fixtures readable.

const FIXTURES = new URL("./fixtures/", import.meta.url).pathname;

// ─────────────────────── 7.5: a 0.26.0 state file loads unchanged ───────────────────────
//
// The backstop for the whole release, and deliberately the FIRST thing written: every other
// task in this group adds a field, and the one property none of them may break is that a state
// file written by the prior version still loads and behaves as it did. The fixture is checked
// in rather than constructed in the test, because a constructed one drifts with the engine that
// constructs it — the point is a document 0.26.0 could have written.
//
// UN-UPGRADED is the case under test. `/pm:upgrade` lags a plugin update by design (a repo can
// run this engine for weeks before its state is stamped), so "the new engine on old state" is
// not an edge case, it is the ordinary state of every repo between the two commands.

const STATE_0_26_0 = path.join(FIXTURES, "state-0.26.0.json");

/** A repo carrying the checked-in 0.26.0 state, with NO upgrade run against it. */
function repoAt0260() {
  const cwd = tmpRepo();
  fs.mkdirSync(path.join(cwd, ".conductor"), { recursive: true });
  fs.copyFileSync(STATE_0_26_0, path.join(cwd, ".conductor", "state.json"));
  return cwd;
}

/** The block minus the ALWAYS-ON sections — the numbered operating rules, the refresh gate, the
 *  emitted gate procedure and the intake procedure — see conductor-14's identical helper for why
 *  byte-identity is claimed for the tracker sections and not for the whole document, and for why
 *  gh-151 added the operating rules to the list. */
// stripAlwaysOn + its headings are HOISTED to helpers.mjs (#161): both this file and its
// sibling compare against the same 0.26.0 fixtures, so they must strip identically, and
// nothing enforced that while there were two copies. One definition prevents the divergence
// a byte-identity test would only detect.

test("7.5: the checked-in 0.26.0 state carries none of this release's fields", () => {
  const raw = fs.readFileSync(STATE_0_26_0, "utf8");
  const s = JSON.parse(raw);
  assert.equal(s.pmVersion, "0.26.0", "the fixture must be stamped at the prior release");
  assert.equal(s.revision, undefined, "0.26.0 wrote no revision on a state that had never been saved by it");
  assert.equal(s.archiveBackfilledAt, undefined, "the backfill marker cannot pre-date the backfill");
  assert.equal(s.tracker.direction, undefined, "direction is what the migration stamps — the fixture predates it");
  for (const e of s.epics) {
    assert.equal(e.disposition, undefined, `${e.id}: no epic in a 0.26.0 file carries a disposition`);
    assert.equal(e.attributedCommits, undefined, `${e.id}: no epic in a 0.26.0 file carries an attribution array`);
  }
  assert.ok(s.epics.some(e => e.status === "archived"), "the fixture must exercise the archived path");
});

test("7.5: an un-upgraded 0.26.0 state emits byte-identically to 0.26.0 for a jira primary", () => {
  const cwd = repoAt0260();
  const block = run(["rules"], { cwd });
  // BOTH sides through the same strip — see conductor-14's `baseline()`.
  const before = stripAlwaysOn(fs.readFileSync(path.join(FIXTURES, "rules-0.26.0-jira-scoped.txt"), "utf8"));
  assert.equal(stripAlwaysOn(block), before,
    "a direction-less jira primary on un-upgraded state must emit exactly what 0.26.0 emitted");
});

test("7.5: every absent field on un-upgraded 0.26.0 state reads as its documented default", () => {
  const cwd = repoAt0260();
  // Absent disposition reads `unknown` — which is why the Dispositions section, which shows only
  // records carrying a judgment, has nothing to show.
  run(["render"], { cwd });
  const md = projectMd(cwd);
  assert.ok(!md.includes("## Dispositions"),
    "an absent disposition reads unknown with no reason, which is not a recorded judgment");
  // Absent attributedCommits reads UNVERIFIABLE — not `none-attributed`, which is a different
  // claim (see gateStaleness): the epic predates the capability rather than asserting emptiness.
  assert.match(md, /⚠ unverifiable/,
    "a legacy verdict on an epic with no attribution array must render as unverifiable");
  // Absent revision is 0, so the first write this engine performs takes revision 1.
  assert.equal(readState(cwd).revision, undefined, "render must not have written state");
  run(["add-epic", "--id", "new-one", "--lane", "claude-code"], { cwd });
  assert.equal(readState(cwd).revision, 1, "absent revision is 0, so the first write takes 1");
});

test("7.5: an un-upgraded 0.26.0 state briefs without an upgrade nudge for its own version", () => {
  const cwd = repoAt0260();
  const brief = parseBrief(cwd);
  assert.ok(brief.includes("CONDUCTOR STATE"), "the brief must compose against un-upgraded state");
});

// ─────────────────────── 7.1: the 0.27.0 MIGRATIONS entry ───────────────────────
//
// One entry, keyed to the release that introduced it, applied exactly once per repo. A
// MIGRATIONS entry is the one kind of code in this engine that cannot be corrected by shipping
// a fix: it applies, `pmVersion` is stamped, and it never replays — so the properties asserted
// here (it runs, it runs once, and running it twice changes nothing) are the whole safety net.

const stateBytes = (cwd) => fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");

/** Upgrade with the plugin version pinned, so a test can exercise the STAMPED-past-the-entry
 *  case rather than only the replay case the repo's own in-flight version produces. */
function upgradeAt(cwd, version) {
  return runCombined(["upgrade"], { cwd, env: { CLAUDE_PLUGIN_ROOT: fixturePluginRoot(version) } });
}

test("7.1: a 0.26.0 state applies the entries above it, and the second run is a byte-identical no-op", () => {
  const cwd = repoAt0260();
  // TWO entries now sit above 0.26.0 — the 0.27.0 stamp, and the 0.32.0 lift of archive-backfill
  // registration provenance onto the epic (#133). The count is release-specific and moves with
  // every appended entry; what this test pins is that the missing entries apply, apply ONCE,
  // and that a second run is byte-identical.
  const first = upgradeAt(cwd, "0.32.0");
  assert.match(first, /upgraded \(2 migration\(s\)\)/,
    "a 0.26.0-stamped repo is missing exactly the 0.27.0 and 0.32.0 entries");
  assert.equal(readState(cwd).pmVersion, "0.32.0");
  const after = stateBytes(cwd);
  const second = upgradeAt(cwd, "0.32.0");
  assert.match(second, /upgraded \(0 migration\(s\)\)/, "a stamped repo replays nothing");
  assert.equal(stateBytes(cwd), after,
    "the second upgrade must be byte-identical — the no-op-save rule means even `revision` " +
    "must not move, or PROJECT.md and state.json churn on every upgrade for no reason");
});

test("7.1: replaying the entry against its own output changes nothing", () => {
  // The repo's own plugin.json is still at the PRIOR version while this release is in flight,
  // so `stampVersion` leaves pmVersion behind the entry and the entry replays on every upgrade.
  // That is the harsher test of idempotence, and it must hold too: an entry that is only
  // idempotent because it is skipped is not idempotent.
  const cwd = repoAt0260();
  run(["upgrade"], { cwd });
  const after = stateBytes(cwd);
  run(["upgrade"], { cwd });
  assert.equal(stateBytes(cwd), after, "applying the entry to its own output must change nothing");
});

// ─────────────────────── 7.2: the direction stamp preserves behavior ───────────────────────
//
// The stamp records what each tracker ALREADY does; it is not an opportunity to choose. The
// wrong answer here is `both` for a pre-existing non-github primary, and it is wrong in the
// direction that costs something: a jira repo receives only the outward section today, so
// `both` would grant an inward pull no repo has ever had and `/pm:sync` would start registering
// an untriaged epic per open issue in a project nobody asked the conductor to mirror.

/** A repo at 0.26.0 carrying `tracker` (and optionally secondaries), with no upgrade run. */
function repoWithTracker(tracker, secondaryTrackers) {
  const cwd = repoAt0260();
  const state = readState(cwd);
  state.tracker = tracker;
  if (secondaryTrackers) state.secondaryTrackers = secondaryTrackers;
  writeState(cwd, state);
  return cwd;
}

test("7.2: a jira primary is stamped outward and a github-issues primary inward", () => {
  const jira = repoWithTracker({ system: "jira", projectKey: "JOB" });
  upgradeAt(jira, "0.27.0");
  assert.equal(readState(jira).tracker.direction, "outward",
    "a jira tracker receives only the outward section today — `both` would grant an inward " +
    "pull no repo has ever had");
  const gh = repoWithTracker({ system: "github-issues", repo: "o/n" });
  upgradeAt(gh, "0.27.0");
  assert.equal(readState(gh).tracker.direction, "inward");
});

test("7.2: an explicitly configured direction is never overwritten", () => {
  const cwd = repoWithTracker({ system: "jira", projectKey: "JOB", direction: "both" });
  upgradeAt(cwd, "0.27.0");
  assert.equal(readState(cwd).tracker.direction, "both",
    "the guard is on an ABSENT direction — configuration outranks the migration's inference");
});

test("7.2: every secondary is pinned inward, and an explicit one is left alone", () => {
  const cwd = repoWithTracker({ system: "jira", projectKey: "JOB" }, [
    { system: "github-issues", repo: "o/n", role: "secondary" },
    { system: "linear", projectKey: "ENG", role: "secondary", direction: "inward" },
  ]);
  upgradeAt(cwd, "0.27.0");
  const s = readState(cwd);
  assert.deepEqual(s.secondaryTrackers.map(t => t.direction), ["inward", "inward"],
    "the secondary role is pull-only by definition, whatever the vendor");
});

test("7.2: the rules block after the upgrade is identical to the one emitted before it", () => {
  for (const tracker of [{ system: "jira", projectKey: "JOB" }, { system: "github-issues", repo: "o/n" }]) {
    const cwd = repoWithTracker(tracker);
    const before = run(["rules"], { cwd });
    upgradeAt(cwd, "0.27.0");
    const after = run(["rules"], { cwd });
    assert.equal(after, before,
      `${tracker.system}: stamping the direction a tracker already resolves to must change ` +
      "nothing a repo reads — the migration records behavior, it does not alter it");
  }
});

// ──────────── 7.3: every archived epic gets an outcome, regardless of lane ────────────
//
// Lane-scoping this is the tempting implementation and it is wrong on measured data. `delivered`
// is claimed ONLY where a passing Gate 2 exists — the one durable piece of evidence in the
// record that a review actually happened — and `unknown` everywhere else, which is not a hedge
// but the true statement: nobody recorded a disposition.

/** This repository's own state.json, copied into a throwaway repo so the migration can be run
 *  against LIVE data without touching the record. Reading the live file is the point: a
 *  migration verified only against hand-built fixtures is verified against the implementer's
 *  own assumptions about the shapes that exist. */
const REPO = new URL("../..", import.meta.url).pathname;
/** The release before the one whose migration this test exercises. */
const PRE_MIGRATION_VERSION = "0.26.0";
/** The live record with the migration's OWN stamps peeled back off — the pre-migration shape,
 *  reconstructed rather than invented.
 *
 *  Copying live state verbatim worked exactly once. The moment `/pm:upgrade` ran on this
 *  repository the migration stamped all 69 unstamped archived epics, the population this test
 *  needs fell to zero, and the test began asserting "this measures nothing" — permanently, since
 *  no later run can un-stamp them. A live-data fixture whose precondition the operation under
 *  test destroys is a test with a single-use fuse.
 *
 *  Removing only `recordedBy: "migration"` dispositions is faithful, not a fabrication: that
 *  field exists precisely so a later rule can tell an engine-written stamp from a recorded
 *  judgment. Agent-recorded dispositions are left in place, so the other half of what this test
 *  asserts — that the migration never overwrites one — keeps a real population too. */
function repoFromLiveState() {
  const cwd = tmpRepo();
  fs.mkdirSync(path.join(cwd, ".conductor"), { recursive: true });
  const live = JSON.parse(fs.readFileSync(path.join(REPO, ".conductor", "state.json"), "utf8"));
  for (const e of live.epics) {
    if (e.disposition && e.disposition.recordedBy === "migration") delete e.disposition;
  }
  // The version stamp is half the reconstruction. MIGRATIONS are keyed to the release that
  // introduced them and run once; with `pmVersion` already at 0.27.0 the migration is correctly
  // a no-op and nothing would be stamped no matter how many dispositions were peeled off.
  live.pmVersion = PRE_MIGRATION_VERSION;
  fs.writeFileSync(path.join(cwd, ".conductor", "state.json"), JSON.stringify(live, null, 2));
  return cwd;
}
const passingGate2 = (e) => !!(e.gateReview && e.gateReview.gate2 && e.gateReview.gate2.verdict === "pass");

test("7.3: on live data every archived epic ends with an outcome, and `delivered` is exactly the passing-Gate-2 set", () => {
  const cwd = repoFromLiveState();
  const before = readState(cwd);
  const archivedBefore = before.epics.filter(e => e.status === "archived");
  // Asserted RELATIVELY: the populations are read from the data, never transcribed. Measured
  // 2026-08-23 as 69 archived of which 3 carry a passing Gate 2 — quoted as a dated snapshot
  // and asserted nowhere, because both numbers move with every release.
  assert.ok(archivedBefore.length > 0, "the live record must hold archived epics for this to measure anything");
  // PARTITIONED, never asserted at zero. "No live epic carries a disposition" was true when this
  // was written and stopped being true the moment this release archived ITSELF with an
  // agent-recorded `delivered` — the record becoming more complete, which is exactly the rot
  // docs/lessons/hardcoded-live-data-claims-rot describes. What the migration actually promises
  // is stated below as a relation over both halves: it stamps every archived epic that had NO
  // disposition, and never touches one somebody recorded.
  const unstamped = archivedBefore.filter(e => !e.disposition);
  const preExisting = new Map(archivedBefore.filter(e => e.disposition)
    .map(e => [e.id, JSON.stringify(e.disposition)]));
  assert.ok(unstamped.length > 0, "the migration must have a population to stamp, or this measures nothing");
  const lanes = new Set(archivedBefore.map(e => e.lane || "openspec"));
  assert.ok(lanes.size > 1, "the live record must span more than one lane, or lane-agnosticism is untested here");

  upgradeAt(cwd, "0.27.0");
  const archived = readState(cwd).epics.filter(e => e.status === "archived");
  assert.equal(archived.length, archivedBefore.length, "the migration registers and removes nothing");
  for (const e of archived) {
    assert.ok(e.disposition, `${e.id}: every archived epic carries a disposition, whatever its lane`);
    if (preExisting.has(e.id)) {
      assert.equal(JSON.stringify(e.disposition), preExisting.get(e.id),
        `${e.id}: an agent-recorded disposition outranks the stamp and MUST survive the migration`);
      continue;
    }
    assert.equal(e.disposition.recordedBy, "migration");
    assert.equal(e.disposition.outcome, passingGate2(e) ? "delivered" : "unknown",
      `${e.id}: delivered iff a passing Gate 2 exists`);
  }
  const stamped = archived.filter(e => !preExisting.has(e.id));
  const delivered = stamped.filter(e => e.disposition.outcome === "delivered");
  assert.deepEqual(delivered.map(e => e.id).sort(), stamped.filter(passingGate2).map(e => e.id).sort(),
    "the delivered set IS the passing-Gate-2 set — not a superset, not a lane");
  assert.ok(delivered.length < stamped.length,
    "if every archived epic read delivered the stamp would be claiming a review that did not happen");
});

test("7.3: the stamp reaches every lane, and recordedAt prefers the epic's own completedAt", () => {
  const cwd = repoAt0260();
  const state = readState(cwd);
  state.epics.push(
    { id: "old-decision", title: "a decision that ended", priority: "P2", status: "archived",
      role: "epic", lane: "decision", links: [], completedAt: "2026-05-05T05:05:05.000Z" },
    { id: "no-completion", title: "no completion timestamp", priority: "P2", status: "archived",
      role: "epic", lane: "claude-code", links: [] });
  writeState(cwd, state);
  upgradeAt(cwd, "0.27.0");
  const byId = Object.fromEntries(readState(cwd).epics.map(e => [e.id, e]));
  assert.equal(byId["old-decision"].disposition.outcome, "unknown",
    "a non-openspec lane has no Gate 2 to have passed, so `delivered` there would assert something unverified");
  assert.equal(byId["old-decision"].disposition.recordedAt, "2026-05-05T05:05:05.000Z",
    "the migration clock says when this code ran, which is not when the work ended");
  assert.equal(byId["no-completion"].disposition.recordedBy, "migration");
  assert.ok(byId["no-completion"].disposition.recordedAt,
    "with no completedAt to prefer, the migration timestamp is the honest fallback");
  // The archived openspec epic in the fixture carries a passing legacy Gate 2 verdict.
  assert.equal(byId["shipped-change"].disposition.outcome, "delivered");
  // A non-archived epic is not a terminal epic and gets nothing.
  assert.equal(byId["still-queued"].disposition, undefined, "only an ENDED epic records how it ended");
});

// ──────────── 7.4: the three things the migration must NOT do ────────────
//
// Each binds THE MIGRATION and nothing else. The disposition clause in particular must not be
// generalized into a repo-wide never-overwrite rule: that would freeze every migration-stamped
// epic at `unknown` forever, since the interactive verb's whole purpose is to replace a record
// nobody chose.

test("7.4: the migration adds no attribution array to a pre-existing epic", () => {
  const cwd = repoAt0260();
  upgradeAt(cwd, "0.27.0");
  for (const e of readState(cwd).epics) {
    assert.ok(!("attributedCommits" in e),
      `${e.id}: the KEY must be absent, not an empty array. Absent means the epic predates ` +
      "the capability and is unverifiable; an empty array means it was created under the " +
      "capability and asserts that nothing was attributed. A uniformity-minded [] converts " +
      "the staleness gate's one forgiven case into a repo-wide false claim.");
  }
});

test("7.4: the migration never writes the archive-backfill marker", () => {
  const cwd = repoAt0260();
  upgradeAt(cwd, "0.27.0");
  assert.ok(!("archiveBackfilledAt" in readState(cwd)),
    "the backfill is a deliberate, announced action — a migration side effect would suppress " +
    "the announcement of a registration run that never happened");
});

test("7.4: the migration leaves an agent-recorded disposition untouched", () => {
  const cwd = repoAt0260();
  const state = readState(cwd);
  const judged = state.epics.find(e => e.id === "abandoned-plan");
  judged.disposition = { outcome: "killed", reason: "the approach was wrong", recordedAt: "2026-06-01T00:00:00.000Z" };
  writeState(cwd, state);
  upgradeAt(cwd, "0.27.0");
  const after = readState(cwd).epics.find(e => e.id === "abandoned-plan");
  assert.deepEqual(after.disposition,
    { outcome: "killed", reason: "the approach was wrong", recordedAt: "2026-06-01T00:00:00.000Z" },
    "a judgment somebody made outranks a stamp — and re-stamping would break idempotence besides");
});

test("7.4: the interactive verb still replaces a migration stamp AFTER the migration has run", () => {
  const cwd = repoAt0260();
  upgradeAt(cwd, "0.27.0");
  assert.equal(readState(cwd).epics.find(e => e.id === "shipped-change").disposition.recordedBy, "migration");
  run(["update-epic", "shipped-change", "--status", "archived", "--outcome", "delivered", "--no-deferrals"], { cwd });
  const d = readState(cwd).epics.find(e => e.id === "shipped-change").disposition;
  assert.equal(d.outcome, "delivered");
  assert.equal(d.recordedBy, undefined,
    "an agent's record carries no recordedBy — that is the whole discriminator, and this " +
    "assertion fails the moment the migration's never-overwrite rule leaks out of the migration");
});

// ──────────── 7.6: git is the rollback, and the documented sequence is executed ────────────
//
// `.conductor/state.json` is git-tracked in every repo that uses pm, so no bespoke undo verb is
// needed — but "no verb" only works if the sequence is written down, which is why this test
// executes the exact commands the docs give rather than a paraphrase of them.

test("7.6: the documented rollback sequence restores state and re-renders from it", () => {
  const cwd = repoAt0260();
  gitInitWithCommit(cwd);
  execFileSync("git", ["add", "-A"], { cwd });
  execFileSync("git", ["commit", "-q", "-m", "chore: commit state.json before upgrading"], { cwd });

  upgradeAt(cwd, "0.27.0");
  const upgraded = readState(cwd);
  assert.equal(upgraded.pmVersion, "0.27.0");
  assert.ok(upgraded.epics.find(e => e.id === "shipped-change").disposition, "the migration ran");

  // The documented rollback, executed verbatim.
  execFileSync("git", ["restore", ".conductor/state.json"], { cwd });
  run(["render"], { cwd });

  const restored = readState(cwd);
  assert.equal(restored.pmVersion, "0.26.0", "the restored file is the pre-upgrade one");
  assert.equal(restored.epics.find(e => e.id === "shipped-change").disposition, undefined,
    "restoring state undoes the migration's stamps");
  assert.match(projectMd(cwd), /shipped-change/,
    "PROJECT.md re-renders FROM the restored state — it is generated, never hand-edited");
  // Rolling STATE back does not require rolling the ENGINE back: this render was produced by
  // the 0.27.0 engine reading 0.26.0 state, which is the property 7.5 pins.
  assert.ok(!projectMd(cwd).includes("## Dispositions"),
    "the 0.27.0 engine reads the restored 0.26.0 state exactly as 0.26.0 did");
});

test("7.6: the rollback procedure is documented where a user upgrading will read it", () => {
  const upgradeDoc = fs.readFileSync(path.join(REPO, "commands", "upgrade.md"), "utf8");
  const readme = fs.readFileSync(path.join(REPO, "README.md"), "utf8");
  for (const [name, text] of [["commands/upgrade.md", upgradeDoc], ["README.md", readme]]) {
    assert.match(text, /git restore .conductor\/state\.json/,
      `${name}: the restore command must be written out, not described`);
    assert.match(text, /commit[^\n]*state\.json[^\n]*before/i,
      `${name}: a restore discards every uncommitted state change, not only the migration's`);
    assert.match(text, /rolling back state does not require rolling back the engine/i,
      `${name}: the two directions are independent, and an operator who does not know that ` +
      "will downgrade the plugin to undo a state change");
  }
});

// ───────────── 8.1: sync reconciles openspec/changes/archive/ ─────────────
//
// A change archived before the conductor was initialized — or archived in a session where sync
// never ran — was permanently invisible: `reconcileArchived()` only flips epics that already
// exist, and `sync` only walked the ACTIVE changes directory. Registration is sync's job;
// the heal continues to create nothing, which is the seam that keeps a read-mostly self-heal
// from silently growing the epic list on every render.

/** A repo with `total` archived change directories, `withEpic` of which already have an epic. */
function archiveFixture({ total, withEpic, ticked = 1, unticked = 0 } = {}) {
  // Deliberately NOT via `init`: init syncs, and that first sync is itself the backfill run, so
  // a fixture built on top of it would start already marked and could never exercise the
  // first-run branch.
  const cwd = tmpRepo();
  const state = { version: 1, active: null, detourStack: [], epics: [], pmVersion: "0.26.0", platform: "claude-code" };
  for (let i = 0; i < total; i++) {
    const id = `change-${String(i).padStart(2, "0")}`;
    const dir = path.join(cwd, "openspec", "changes", "archive", `2026-08-0${(i % 9) + 1}-${id}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "tasks.md"), "# tasks\n\n" +
      Array.from({ length: ticked }, (_, n) => `- [x] done ${n}\n`).join("") +
      Array.from({ length: unticked }, (_, n) => `- [ ] left ${n}\n`).join(""));
    if (i < withEpic) {
      state.epics.push({ id, title: id, priority: "P2", status: "archived", role: "epic",
        lane: "openspec", links: [], reconcileNeeded: false,
        disposition: { outcome: "delivered", recordedAt: "2026-08-01T00:00:00.000Z" } });
    }
  }
  writeState(cwd, state);
  return cwd;
}

test("8.1: sync registers exactly the archived changes that have no epic, already archived", () => {
  const cwd = archiveFixture({ total: 24, withEpic: 16 });
  const before = readState(cwd).epics.length;
  run(["sync"], { cwd });
  const after = readState(cwd).epics;
  assert.equal(after.length - before, 8, "24 archived directories, 16 already held — 8 registered");
  const registered = after.slice(before);
  for (const e of registered) {
    assert.equal(e.status, "archived",
      "an archived change registers AT archived — the conductor preserves the record without " +
      "pretending the change was ever managed");
    assert.equal(e.lane, "openspec");
  }
});

test("8.1: reconcileArchived() never appends to state.epics", () => {
  const cwd = archiveFixture({ total: 6, withEpic: 0 });
  const before = readState(cwd).epics.length;
  run(["render"], { cwd });   // render's only state write is the heal
  assert.equal(readState(cwd).epics.length, before,
    "the heal flips epics that exist and creates none — registration is sync's job, and a heal " +
    "that registered would grow the epic list from a read-mostly path on every render");
});

test("8.1: a change archived before /pm:init ever ran is not lost", () => {
  const cwd = tmpRepo();
  fs.mkdirSync(path.join(cwd, "openspec", "changes", "archive", "2026-05-01-predates-the-conductor"), { recursive: true });
  run(["init"], { cwd });
  const ids = readState(cwd).epics.map(e => e.id);
  assert.ok(ids.includes("predates-the-conductor"),
    "init syncs, and the first sync is exactly when a change archived before the conductor " +
    "existed must be picked up — otherwise it is invisible forever");
});

// ───────────── 8.2: identity is the date-prefix-stripped change id ─────────────
//
// Literal equality answers this wrongly in BOTH directions: an archive directory carries a date
// prefix its epic does not, and this repository also holds epics whose own ids carry one. Either
// miss makes registration a third way to produce duplicate epics, alongside the over-registration
// behaviors `sync` is already filed for.

test("8.2: a date-prefixed archive directory does not duplicate its existing epic", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  fs.mkdirSync(path.join(cwd, "openspec", "changes", "archive", "2026-08-01-port-domain-health-system"), { recursive: true });
  run(["add-epic", "--id", "port-domain-health-system", "--lane", "openspec"], { cwd });
  run(["sync"], { cwd });
  const ids = readState(cwd).epics.map(e => e.id);
  assert.deepEqual(ids.filter(id => id.endsWith("port-domain-health-system")), ["port-domain-health-system"],
    "one change, one epic — the existing epic is used and no second one is created");
});

test("8.2: an epic whose OWN id is date-prefixed is matched too", () => {
  // This repository holds four such registrations, so it is the live shape, not a hypothetical.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  fs.mkdirSync(path.join(cwd, "openspec", "changes", "archive", "2026-07-21-conductor-mjs-module-split"), { recursive: true });
  run(["add-epic", "--id", "2026-07-21-conductor-mjs-module-split", "--lane", "superpowers"], { cwd });
  run(["sync"], { cwd });
  assert.equal(readState(cwd).epics.filter(e => e.id.endsWith("conductor-mjs-module-split")).length, 1,
    "comparing the stripped archive id against the epic's LITERAL id alone misses this one");
});

test("8.2: re-running sync after a backfill adds nothing and modifies nothing", () => {
  const cwd = archiveFixture({ total: 5, withEpic: 0 });
  run(["sync"], { cwd });
  const after = stateBytes(cwd);
  run(["sync"], { cwd });
  assert.equal(stateBytes(cwd), after, "zero epics added, zero modified — byte-identical");
});

test("8.2: a change registered while active and archived later resolves to ONE epic", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  fs.mkdirSync(path.join(cwd, "openspec", "changes", "live-change"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "openspec", "changes", "live-change", "tasks.md"), "# tasks\n\n- [x] a\n");
  run(["sync"], { cwd });
  assert.equal(readState(cwd).epics.filter(e => e.id === "live-change").length, 1);
  // Now archive it the way openspec does: the directory moves under archive/ with a date prefix.
  fs.mkdirSync(path.join(cwd, "openspec", "changes", "archive"), { recursive: true });
  fs.renameSync(path.join(cwd, "openspec", "changes", "live-change"),
    path.join(cwd, "openspec", "changes", "archive", "2026-08-20-live-change"));
  run(["sync"], { cwd });
  const matches = readState(cwd).epics.filter(e => e.id.endsWith("live-change"));
  assert.equal(matches.length, 1, "the existing epic flips to archived; no second epic appears");
  assert.equal(matches[0].status, "archived");
});

// ───────────── 8.3: a backfilled epic keeps its real counts ─────────────
//
// `epicProgress()` returns `{done: 0, total: 0}` for an archived epic whose task source is gone,
// and suppresses the missing-source warning — correct for an epic the conductor managed, whose
// source legitimately moved. Applied to a backfilled epic it discards the only evidence the
// backfill exists to preserve: a change archived with 12 of its tasks still unticked is the most
// informative row in the whole audit, and registering it as `0/0` keeps the row and throws away
// what makes it worth keeping.

/** Register one archived change from disk with an explicit ticked/unticked split. */
function backfilledFixture(id, { ticked, unticked }) {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const dir = path.join(cwd, "openspec", "changes", "archive", `2026-08-05-${id}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "tasks.md"), "# tasks\n\n" +
    Array.from({ length: ticked }, (_, n) => `- [x] shipped ${n}\n`).join("") +
    Array.from({ length: unticked }, (_, n) => `- [ ] never done ${n}\n`).join(""));
  run(["sync"], { cwd });
  run(["render"], { cwd });
  return cwd;
}
/** The PROJECT.md row for `id`, so the assertion reads the surface a human reads. */
const rowFor = (cwd, id) => projectMd(cwd).split("\n").find(l => l.includes(`\`${id}\``));

test("8.3: an abandoned change registers with its unticked count intact", () => {
  const cwd = backfilledFixture("log-collector-not-applicable", { ticked: 23, unticked: 12 });
  const row = rowFor(cwd, "log-collector-not-applicable");
  assert.match(row, /23\/35/,
    "the counts come from the ARCHIVED artifacts — `0/0` or an em dash here discards the " +
    "evidence that 12 tasks were never done");
  assert.ok(!/—/.test(row.split("|")[6] || ""), "and it is not an em dash");
});

test("8.3: a fully ticked archived change registers as complete and is distinguishable", () => {
  const cwd = backfilledFixture("fully-delivered", { ticked: 21, unticked: 0 });
  assert.match(rowFor(cwd, "fully-delivered"), /21\/21/,
    "complete must read complete, and differently from the abandoned case");
});

test("8.3: an epic the conductor MANAGED keeps its suppressed missing-source behavior", () => {
  // The scope of the fallback is deliberate. `archiveGate()` documents that outstanding work
  // "reads zero for an archived epic whose source is gone", and the interactive verb's handoff
  // demand rests on it. Reading archived artifacts for every archived epic would move that
  // quantity under a gate written against it — a change no task in this group authorizes.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const dir = path.join(cwd, "openspec", "changes", "archive", "2026-08-05-managed-change");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "tasks.md"), "# tasks\n\n- [x] a\n- [ ] the archive instruction\n");
  run(["add-epic", "--id", "managed-change", "--lane", "openspec", "--status", "archived"], { cwd });
  run(["render"], { cwd });
  const row = rowFor(cwd, "managed-change");
  assert.ok(!/1\/2/.test(row),
    "an epic registered through a creation path is not a backfilled one, and its source going " +
    "away at archive time is the documented, suppressed case");
});

// ───────────── 8.4 / 8.5: the stamp is unconditional, and no gate2 is written ─────────────
//
// Unconditional is the requirement, not a convenience: conditioning the stamp on task counts,
// lane, or anything else would reintroduce the engine-side classifier this design rules out —
// and every exemption elsewhere (the integrity checks' scope rule, the archive gate's) keys on
// the stamp being present, so a conditioned stamp is a silent hole in all of them.

/** One repo holding two backfilled changes: one fully ticked, one with 12 tasks never done. */
function twoBackfilledChanges() {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  for (const [id, ticked, unticked] of [["fully-ticked", 9, 0], ["abandoned", 23, 12]]) {
    const dir = path.join(cwd, "openspec", "changes", "archive", `2026-08-05-${id}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "tasks.md"), "# tasks\n\n" +
      Array.from({ length: ticked }, (_, n) => `- [x] a${n}\n`).join("") +
      Array.from({ length: unticked }, (_, n) => `- [ ] b${n}\n`).join(""));
  }
  run(["sync"], { cwd });
  return cwd;
}

test("8.4: every backfilled epic is stamped identically, complete or not", () => {
  const cwd = twoBackfilledChanges();
  const epics = readState(cwd).epics.filter(e => ["fully-ticked", "abandoned"].includes(e.id));
  assert.equal(epics.length, 2);
  for (const e of epics) {
    assert.equal(e.disposition.outcome, "unknown",
      `${e.id}: the backfill was never asked for a disposition, and 'unknown' says exactly that`);
    assert.equal(e.disposition.recordedBy, "archive-backfill",
      `${e.id}: readable as a FIELD — no consumer parses a path name out of a free-text reason`);
  }
  assert.deepEqual(
    { ...epics[0].disposition, recordedAt: null }, { ...epics[1].disposition, recordedAt: null },
    "neither epic is distinguished from the other by whether or how it was stamped");
});

test("8.4: no flag on any command writes recordedBy, and a creation path keeps its own token", () => {
  const cwd = twoBackfilledChanges();
  for (const argv of [["add-epic", "--id", "z", "--lane", "claude-code", "--recorded-by", "archive-backfill"],
                      ["update-epic", "abandoned", "--recorded-by", "archive-backfill"]]) {
    const e = expectFail(() => run(argv, { cwd }));
    assert.ok(e, `${argv[0]} must reject --recorded-by — recordedBy is never agent-writable`);
  }
  // The epic-flag registry is the single declaration of that surface, so the absence is
  // asserted there too rather than only at two command entry points.
  const src = fs.readFileSync(path.join(REPO, "scripts", "lib", "constants.mjs"), "utf8");
  assert.ok(!/key:\s*"recordedBy"/.test(src), "no registry entry may write the recordedBy key");
  // An epic created directly at archived carries its OWN creation token, not the backfill's.
  run(["add-epic", "--id", "made-archived", "--lane", "claude-code", "--status", "archived"], { cwd });
  assert.equal(readState(cwd).epics.find(e => e.id === "made-archived").disposition.recordedBy, "add-epic");
});

test("8.5: a backfilled epic gets no gate2 entry at all, and is never named as an ungated archive", () => {
  const cwd = twoBackfilledChanges();
  for (const e of readState(cwd).epics.filter(x => ["fully-ticked", "abandoned"].includes(x.id))) {
    assert.equal(e.gateReview, undefined,
      `${e.id}: an 'ungated' entry here is a permanent, unclearable condition — its only ` +
      "clearing path is a real passing Gate 2 with a commit range, for work that shipped " +
      "before the conductor existed");
  }
  const brief = parseBrief(cwd);
  for (const id of ["fully-ticked", "abandoned"]) {
    assert.ok(!new RegExp(`ungated[^\\n]*${id}|${id}[^\\n]*ungated`).test(brief),
      `${id}: no backfilled epic is named as an ungated archive`);
  }
});

// ───────────── 8.6: archiveBackfilledAt is a PRESENCE marker ─────────────
//
// Registering history changes a repo's epic counts, and those counts are the input to every
// effectiveness measurement taken from conductor state — so the run that changes them says so.
// Nothing is ever COMPARED against the timestamp: forward-only registration derives from "this
// archived change has no epic", and the field's only behavioral job is deciding whether a run
// announces itself as the historical backfill.

test("8.6: the first backfill announces the count and the ids, and records that it ran", () => {
  const cwd = archiveFixture({ total: 4, withEpic: 1 });
  assert.ok(!("archiveBackfilledAt" in readState(cwd)), "the fixture starts un-backfilled");
  const out = runCombined(["sync"], { cwd });
  assert.match(out, /archive backfill/i, "the historical registration announces itself");
  assert.match(out, /\b3\b/, "the count is stated, so the change in the repo's numbers is attributable");
  for (const id of ["change-01", "change-02", "change-03"]) {
    assert.ok(out.includes(id), `${id}: the ids are named, not just counted`);
  }
  assert.ok(readState(cwd).archiveBackfilledAt, "and the marker is written");
});

test("8.6: a repo already carrying the marker registers nothing and announces nothing", () => {
  const cwd = archiveFixture({ total: 4, withEpic: 1 });
  runCombined(["sync"], { cwd });
  const after = stateBytes(cwd);
  const out = runCombined(["sync"], { cwd });
  assert.ok(!/archive backfill/i.test(out), "history is never re-announced");
  assert.equal(stateBytes(cwd), after, "and never re-registered");
});

test("8.6: a state file with no marker loads unchanged, backfills once, and does not repeat", () => {
  const cwd = repoAt0260();
  fs.mkdirSync(path.join(cwd, "openspec", "changes", "archive", "2026-07-01-historical"), { recursive: true });
  const before = readState(cwd);
  assert.ok(!("archiveBackfilledAt" in before), "0.26.0 wrote no such field");
  const first = runCombined(["sync"], { cwd });
  assert.match(first, /archive backfill/i);
  assert.ok(readState(cwd).epics.some(e => e.id === "historical"));
  const second = runCombined(["sync"], { cwd });
  assert.ok(!/archive backfill/i.test(second));
});

test("8.6: the marker is absent from defaultState, or its presence would stop marking anything", () => {
  const src = fs.readFileSync(path.join(REPO, "scripts", "lib", "state.mjs"), "utf8");
  assert.ok(!src.includes("archiveBackfilledAt"),
    "defaultState() feeds loadState()'s spread, so a key seeded there is present on every " +
    "state ever loaded — and a presence marker that is always present marks nothing");
});

test("8.6: a change archived AFTER the backfill is registered without a backfill announcement", () => {
  const cwd = archiveFixture({ total: 2, withEpic: 0 });
  runCombined(["sync"], { cwd });
  fs.mkdirSync(path.join(cwd, "openspec", "changes", "archive", "2026-08-30-archived-later"), { recursive: true });
  const out = runCombined(["sync"], { cwd });
  assert.ok(readState(cwd).epics.some(e => e.id === "archived-later"),
    "forward reconciliation continues — the marker suppresses the ANNOUNCEMENT, not the work");
  assert.ok(!/archive backfill/i.test(out), "a change archived since is new information, not history");
});

// ───────────── 9.1: the integrity module and its read-only subcommand ─────────────
//
// Read-only is the whole contract. A check that repaired would be a second writer racing the
// paths that produce the records it reads; a check that blocked would turn an audit finding
// into an outage. And a check that finds nothing is still a check that RAN — the report says
// so per check, because a report listing only its non-empty checks is indistinguishable from
// one whose empty checks were quietly removed.

/** A repo whose record carries at least one finding, in the shape the live record holds: a
 *  superpowers-lane epic archived against a plan file with nothing ticked, its disposition the
 *  `unknown` stamp the migration writes. */
function repoWithFindings(epics = []) {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  fs.mkdirSync(path.join(cwd, "docs", "superpowers", "plans"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "docs", "superpowers", "plans", "stalled-plan.md"),
    "# Stalled plan\n\n- [ ] a\n- [ ] b\n- [ ] c\n");
  writeState(cwd, { version: 1, active: null, detourStack: [], platform: "claude-code", epics: [
    { id: "stalled-plan", title: "Stalled plan", priority: "P2", status: "archived", role: "epic",
      lane: "superpowers", planPath: "docs/superpowers/plans/stalled-plan.md", links: [],
      disposition: { outcome: "unknown", recordedAt: "2026-08-01T00:00:00.000Z", recordedBy: "migration" } },
    ...epics,
  ] });
  return cwd;
}

test("9.1: integrity leaves state.json byte-identical and blocks nothing", () => {
  const cwd = repoWithFindings();
  const before = stateBytes(cwd);
  const out = run(["integrity"], { cwd });
  assert.equal(stateBytes(cwd), before,
    "an audit that rendered would write state on the way to telling you it writes none");
  assert.match(out, /INTEGRITY/);
  // It blocks nothing: an ordinary verb still succeeds against the same record.
  run(["render"], { cwd });
});

test("9.1: every check is reported with its count, including the ones that found nothing", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const out = run(["integrity"], { cwd });
  for (const id of ["archived-with-zero-ticked-tasks"]) {
    assert.match(out, new RegExp(`^${id} — \\d+ finding\\(s\\)`, "m"),
      `${id}: a check with no findings must still appear, or "the check measured nothing" is ` +
      "indistinguishable from a check that was quietly removed");
  }
  assert.match(out, /0 finding\(s\) across \d+ check\(s\)/);
});

// ───────────── 9.5: the zero-ticked check, against live data ─────────────
//
// This file's own process has ROOT pointed at this repository (helpers.mjs sets
// CLAUDE_PROJECT_DIR only in the CHILD env, and nothing here mutates the parent), so importing
// the module directly evaluates its checks against this repository's real disk and real git.
// Do not set process.env.CLAUDE_PROJECT_DIR anywhere in this file.
const { runIntegrity, CHECKS } = await import("../lib/integrity.mjs");
const { isAncestor: isAncestorHere, commitDate: commitDateHere } = await import("../lib/git.mjs");

// Several checks below are evaluated against THIS repository's REAL git history, so that
// `git merge-base --is-ancestor` actually answers rather than returning the three-valued `null`
// a synthetic temp repo would produce.
//
// The hashes are DERIVED, never pinned. Five hardcoded ones shipped here first and were wrong in
// a way that only CI could show: each was a feature-branch commit, and a squash-merge leaves
// those unreachable from every branch — alive in the authoring clone's object store, absent from
// every fresh clone at every fetch depth. Deriving from `rev-list --first-parent HEAD` keeps the
// fixture real, and keeps it real after the next squash-merge. CI must still clone with
// `fetch-depth: 0`; a shallow checkout has one commit and the guard below says so.
const HIST = execFileSync("git",
  ["rev-list", "--first-parent", "--abbrev=7", "--abbrev-commit", "-n", "12", "HEAD"],
  { cwd: REPO, encoding: "utf8" }).trim().split("\n").filter(Boolean);
const requireHistory = () => {
  assert.ok(HIST.length >= 9,
    `this clone has ${HIST.length} first-parent commit(s) — these fixtures need real history; ` +
    "a shallow checkout (fetch-depth: 1) makes every ancestry answer null. Set fetch-depth: 0.");
};
// Newest first, so a lower index is a DESCENDANT of a higher one.
const [H_NEWEST, , H_DESC, , H_HEAD, , H_INSIDE, , H_BASE] = HIST;
const liveState = () => JSON.parse(fs.readFileSync(path.join(REPO, ".conductor", "state.json"), "utf8"));
const findingsFor = (id, state) => {
  const c = runIntegrity(state).find(x => x.id === id);
  assert.ok(c, `no check registered as ${id}`);
  return c.findings;
};

test("9.5: on live data the zero-ticked check reports exactly the five identified epics", () => {
  assert.equal(process.env.CLAUDE_PROJECT_DIR || process.cwd(), REPO.replace(/\/$/, ""),
    "the live checks must evaluate against THIS repository, or they measure a temp directory");
  const reported = findingsFor("archived-with-zero-ticked-tasks", liveState()).map(f => f.epic).sort();
  // The SET, not a count. Measured 2026-08-23 at 0/17, 0/99, 0/37, 0/34 and 0/39 respectively.
  // These five are stable only because none of the plan files under docs/superpowers/plans/
  // carries a `<!-- pm:lifecycle -->` declaration today; a marker added later moves a count and
  // must move this list with it.
  assert.deepEqual(reported, [
    "2026-07-14-epic-hierarchy-orchestration",
    "2026-07-21-conductor-mjs-module-split",
    "2026-07-26-edd-harness-agent-behavior-testing",
    "2026-07-29-platform-aware-rules-block",
    "2026-08-18-state-write-conflict-guard",
  ].sort());
  // Two of the five are NOT date-prefixed duplicates of an un-prefixed sibling, so this check
  // has live candidates that are not artifacts of the dual-lane finding.
  const strip = (id) => id.replace(/^\d{4}-\d{2}-\d{2}-/, "");
  const others = new Set(liveState().epics.map(e => e.id));
  const notCollisions = reported.filter(id => !others.has(strip(id)));
  assert.deepEqual(notCollisions.sort(),
    ["2026-07-29-platform-aware-rules-block", "2026-08-18-state-write-conflict-guard"],
    "a check whose every finding is another check's finding measures nothing of its own");
});

test("9.5: the check is gated on total > 0, so an archived epic with no source is not a finding", () => {
  const cwd = repoWithFindings([
    { id: "source-long-gone", title: "x", priority: "P2", status: "archived", role: "epic",
      lane: "openspec", links: [],
      disposition: { outcome: "unknown", recordedAt: "2026-08-01T00:00:00.000Z", recordedBy: "migration" } },
  ]);
  const out = run(["integrity"], { cwd });
  assert.match(out, /archived-with-zero-ticked-tasks — 1 finding/,
    "the epic whose plan file exists with nothing ticked IS a finding");
  assert.ok(!out.includes("source-long-gone"),
    "an archived epic whose source is gone reads 0/0 — a `done === 0` test reports every one of " +
    "them (66 of this repository's 69 archived epics) and says nothing about any of them");
});

// ───────────── 9.2: the scope rule for the completion-shaped checks ─────────────
//
// Two exclusions and nothing else. `unknown` stays IN scope, because it is the value the engine
// stamps when nobody was asked — its reason is a path name, not an explanation of why the work
// did not complete, which is the property the two exclusions actually rest on.

test("9.2: a killed 47-task epic with everything unticked is not a finding; an unknown one is", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  fs.mkdirSync(path.join(cwd, "docs", "superpowers", "plans"), { recursive: true });
  const plan = "# p\n\n" + Array.from({ length: 47 }, (_, n) => `- [ ] t${n}\n`).join("");
  for (const id of ["killed-at-gate-1", "nobody-recorded-one", "registered-from-the-archive"]) {
    fs.writeFileSync(path.join(cwd, "docs", "superpowers", "plans", `${id}.md`), plan);
  }
  const epic = (id, disposition) => ({ id, title: id, priority: "P2", status: "archived",
    role: "epic", lane: "superpowers", planPath: `docs/superpowers/plans/${id}.md`, links: [], disposition });
  writeState(cwd, { version: 1, active: null, detourStack: [], platform: "claude-code", epics: [
    epic("killed-at-gate-1", { outcome: "killed", reason: "no code was ever written", recordedAt: "2026-08-01T00:00:00.000Z" }),
    epic("nobody-recorded-one", { outcome: "unknown", recordedAt: "2026-08-01T00:00:00.000Z", recordedBy: "migration" }),
    // Since 0.32.0 the REGISTRATION provenance sits on the EPIC and is no longer inferred from
    // the disposition stamp — that inference is what an agent's honest disposition destroyed
    // (#133). The stamp stays too: it says the backfill recorded no disposition, a different fact.
    { ...epic("registered-from-the-archive", { outcome: "unknown", recordedAt: "2026-08-01T00:00:00.000Z", recordedBy: "archive-backfill" }),
      registeredBy: "archive-backfill" },
  ] });
  const out = run(["integrity"], { cwd });
  assert.ok(!out.includes("killed-at-gate-1"),
    "a recorded non-delivered disposition already explains the zero — that is the record working");
  assert.ok(!out.includes("registered-from-the-archive"),
    "a backfilled epic's unticked tasks are a property of a record rebuilt from disk");
  assert.ok(out.includes("nobody-recorded-one"),
    "`unknown` is not an explanation of why the work did not complete, so it stays in scope");
});

test("9.2: scoping to `delivered` would empty the candidate set on this repository", () => {
  const state = liveState();
  const archived = state.epics.filter(e => e.status === "archived");
  // After the migration, `delivered` is exactly the archived epics carrying a passing Gate 2.
  const deliverable = archived.filter(e => e.gateReview && e.gateReview.gate2 && e.gateReview.gate2.verdict === "pass");
  assert.ok(deliverable.length > 0 && deliverable.length < archived.length,
    "the delivered set must be a STRICT subset of the archived set, or this proves nothing");
  const ids = new Set(deliverable.map(e => e.id));
  const outside = findingsFor("archived-with-zero-ticked-tasks", state).filter(f => !ids.has(f.epic));
  assert.ok(outside.length > 0,
    "the checks have candidates outside the delivered set — a `delivered`-only scope makes " +
    "every completion-shaped check below inert on the repository whose data this rule cites");
});

// ───────────── 9.6: one change registered under two lanes ─────────────

test("9.6: on live data the dual-lane check reports exactly the four pairs, lanes as recorded", () => {
  const findings = findingsFor("change-registered-under-two-lanes", liveState());
  assert.deepEqual(findings.map(f => f.epic).sort(), [
    "conductor-mjs-module-split", "edd-harness-agent-behavior-testing",
    "epic-hierarchy-orchestration", "platform-parity-mechanism",
  ]);
  const byId = Object.fromEntries(findings.map(f => [f.epic, f.detail]));
  // The lanes are read from state, not assumed uniform: two of the four hold `decision` on the
  // un-prefixed side, not `openspec`.
  assert.match(byId["conductor-mjs-module-split"], /\(openspec\)/);
  assert.match(byId["epic-hierarchy-orchestration"], /\(decision\)/);
  assert.match(byId["edd-harness-agent-behavior-testing"], /\(decision\)/);
  for (const d of Object.values(byId)) assert.match(d, /\(superpowers\)/,
    "every pair is a date-prefixed superpowers registration against an un-prefixed sibling");
});

test("9.6: literal equality would report none of them, and same-lane ids are not a finding", () => {
  const ids = liveState().epics.map(e => e.id);
  assert.equal(ids.length - new Set(ids).size, 0,
    "ZERO ids collide literally — a literal-equality check reports nothing while four pairs exist");
  const cwd = repoWithFindings([
    { id: "same-lane", title: "a", priority: "P2", status: "queued", role: "epic", lane: "openspec", links: [] },
    { id: "2026-08-01-same-lane", title: "b", priority: "P2", status: "queued", role: "epic", lane: "openspec", links: [] },
  ]);
  const out = run(["integrity"], { cwd });
  assert.match(out, /change-registered-under-two-lanes — 0 finding/,
    "the check is about a change held under two LANES, and asserts nothing about intent");
});

// ───────────── 9.7: the dual-lane finding names its known cause ─────────────

test("9.7: every live dual-lane finding cites #64/#69 as the likely cause", () => {
  const findings = findingsFor("change-registered-under-two-lanes", liveState());
  assert.equal(findings.length, 4, "the four live pairs are the population this asserts over");
  for (const f of findings) {
    assert.match(f.detail, /#64\/#69/,
      `${f.epic}: a reader handed a symptom without the known cause has to rediscover it per pair`);
    assert.match(f.detail, /`sync` registering a finished plan file as a second epic/,
      `${f.epic}: the cause is stated, not just referenced by number`);
  }
});

// ───────────── 9.3: a verdict's range does not contain the commits its note cites ─────────────
//
// Evaluated against THIS repository's real git history: all the hashes below exist here, and
// the containment computation is a real `git merge-base --is-ancestor` call. That matters
// because `isAncestor` is three-valued — a hash git has never seen answers `null`, and `null`
// suppresses the finding — so a test run against a temp repo would report nothing and pass for
// entirely the wrong reason.
//
// ZERO live candidates today, and that is not a gap: no verdict in state.json carries structured
// sha fields, because this release introduces them and forbids rewriting the three legacy
// verdicts. The live instance the spec cites exists only as prose in a note, so it is reproduced
// here as a fixture rather than mined from the record.

const PARITY_VERDICT = () => ({
  verdict: "pass", baseSha: H_BASE, headSha: H_HEAD,
  // The real note's shape: it spells out its own range, cites two commits made AFTER that range,
  // and mentions one commit that IS inside it. `defaced` is seven hex characters and an ordinary
  // English word — the token scanner cannot tell it from a hash, and does not have to.
  note: `fresh-context review over ${H_BASE}..${H_HEAD}: 2 Important both fixed in ${H_NEWEST} ` +
    `and confirmed by a scoped re-review; gitignore-filter fix ${H_DESC} separately re-reviewed; ` +
    `the reviewed baseline included ${H_INSIDE} and nothing was defaced.`,
});
const withGateVerdict = (gate2) => ({
  version: 1, active: null, detourStack: [], epics: [
    { id: "platform-parity-mechanism-fixture", title: "x", priority: "P1", status: "archived",
      role: "epic", lane: "openspec", links: [], gateReview: { gate2 } }],
});

test("9.3: the check reports exactly the cited commits the recorded range does not reach", () => {
  requireHistory();
  const findings = findingsFor("verdict-range-omits-cited-commits", withGateVerdict(PARITY_VERDICT()));
  assert.equal(findings.length, 1);
  assert.ok(findings[0].detail.includes(`${H_BASE}..${H_HEAD}`), "the range comes from the FIELDS");
  for (const sha of [H_NEWEST, H_DESC]) {
    assert.ok(findings[0].detail.includes(sha), `${sha} is a descendant of the range and must be reported`);
  }
  assert.ok(!findings[0].detail.includes(H_INSIDE),
    `${H_INSIDE} IS an ancestor of the recorded head — reporting it would mean the ancestry logic " +
    "is inverted or absent, and this assertion is what proves git actually answered`);
  assert.ok(!findings[0].detail.includes("defaced"),
    "an ordinary word that happens to be seven hex characters answers `null` from git, and " +
    "`null` is not evidence of anything");
});

test("9.3: a verdict with no structured range is never mined for one, and none exists live", () => {
  const legacy = { verdict: "pass", reviewedAt: "2026-08-04T00:48:57.279Z", note: PARITY_VERDICT().note };
  assert.deepEqual(findingsFor("verdict-range-omits-cited-commits", withGateVerdict(legacy)), [],
    "parsing a range out of the note is the prose dependency the structured fields removed");
  assert.deepEqual(findingsFor("verdict-range-omits-cited-commits", liveState()), [],
    "zero live candidates — no verdict in this repository carries baseSha/headSha yet");
});

test("9.3: a verdict's own recorded endpoints are never reported as commits it failed to reach", () => {
  // A range whose base is NOT an ancestor of its head — the shape a rebase leaves behind. Without
  // subtracting the FIELD values, the check reports the verdict's own base as a cited commit the
  // range does not contain, which is a nonsense finding about the record's own two hashes.
  requireHistory();
  const reversed = {
    verdict: "pass", baseSha: H_NEWEST, headSha: H_BASE,
    note: `reviewed ${H_NEWEST}..${H_BASE} end to end`,
  };
  assert.equal(isAncestorHere(H_NEWEST, H_BASE), false,
    "the fixture only means something if git says the base is genuinely unreachable from the head");
  assert.deepEqual(findingsFor("verdict-range-omits-cited-commits", withGateVerdict(reversed)), []);
});

// ───────────── 9.4: a gate recorded as bookkeeping rather than as review ─────────────
//
// Both arms are fixture-verified with ZERO live candidates, and each zero has its reason: arm 1
// cannot apply because no epic in this repository carries an attribution array before this
// release, and arm 2 finds nothing because the one live epic holding two gate verdicts recorded
// them 22 minutes apart.

const { gateHasEvidence } = await import("../lib/constants.mjs");
const shiftIso = (iso, ms) => new Date(Date.parse(iso) + ms).toISOString();
const epicWithGates = (over) => ({ version: 1, active: null, detourStack: [], epics: [
  { id: "audited", title: "x", priority: "P1", status: "archived", role: "epic", lane: "openspec",
    links: [], ...over }] });

test("9.4 arm 1: a verdict dated after the epic's merge commit is reported", () => {
  requireHistory();
  const merged = commitDateHere(H_HEAD);
  assert.ok(merged, "the fixture reads a REAL commit date from this repository");
  // UNEVIDENCED, which is the audited shape: those verdicts predate the sha fields entirely.
  // An evidenced verdict with the same timing is exempt — see the exemption test below.
  const state = epicWithGates({
    attributedCommits: [H_BASE, H_HEAD],
    gateReview: { gate2: { verdict: "pass", reviewedAt: shiftIso(merged, 83_000) } },
  });
  const findings = findingsFor("gate-recorded-as-bookkeeping", state);
  assert.equal(findings.length, 1);
  assert.ok(findings[0].detail.includes(`after the epic's merge commit ${H_HEAD}`));
  // Dated BEFORE the merge is the ordinary, correct shape and reports nothing.
  const ok = epicWithGates({
    attributedCommits: [H_BASE, H_HEAD],
    gateReview: { gate2: { verdict: "pass", baseSha: H_BASE, headSha: H_HEAD,
      reviewedAt: shiftIso(merged, -600_000) } },
  });
  assert.deepEqual(findingsFor("gate-recorded-as-bookkeeping", ok), []);
});

test("9.4 arm 1 does not apply where there is no attribution array", () => {
  const state = epicWithGates({
    gateReview: { gate2: { verdict: "pass", baseSha: "d168b1e", headSha: "04c54c8",
      reviewedAt: "2036-01-01T00:00:00.000Z" } },
  });
  assert.deepEqual(findingsFor("gate-recorded-as-bookkeeping", state), [],
    "with no array there is no merge commit to be after — every other reading of it is either " +
    "inert on all live epics or fires on essentially all of them");
});

test("9.4 arm 2: two gates 47 ms apart are reported; hours apart are not", () => {
  const close = epicWithGates({ gateReview: {
    gate1: { verdict: "pass", reviewedAt: "2026-08-04T00:48:57.279Z" },
    gate2: { verdict: "pass", reviewedAt: "2026-08-04T00:48:57.326Z" },
  } });
  const findings = findingsFor("gate-recorded-as-bookkeeping", close);
  assert.equal(findings.length, 1);
  assert.match(findings[0].detail, /47 ms apart/);
  const apart = epicWithGates({ gateReview: {
    gate1: { verdict: "pass", reviewedAt: "2026-07-19T23:17:32.441Z" },
    gate2: { verdict: "pass", reviewedAt: "2026-07-19T23:39:40.827Z" },
  } });
  assert.deepEqual(findingsFor("gate-recorded-as-bookkeeping", apart), [],
    "22 minutes apart is a spec review and an implementation review, which is the live shape");
});

test("9.4 arm 1 exempts an EVIDENCED verdict dated after the last attributed commit", () => {
  requireHistory();
  // The shape the emitted procedure produces EVERY time it is followed: attribute each commit as
  // it is made, then record Gate 2 afterwards. Without the exemption the arm fires on compliance
  // rather than on the defect — which is how this was found, live, on this release's own epic.
  const evidenced = epicWithGates({
    attributedCommits: [H_HEAD],
    gateReview: { gate2: { verdict: "pass", baseSha: H_BASE, headSha: H_HEAD,
      reviewedAt: "2036-01-01T00:00:00.000Z" } },
  });
  assert.deepEqual(findingsFor("gate-recorded-as-bookkeeping", evidenced), [],
    "a verdict that states the range it covered, dated after the last commit in that range, is " +
    "what a real review looks like — not a bookkeeping signature");

  // …and the arm still fires on the audited shape, which is unevidenced by construction: those
  // verdicts predate the sha fields and were written after the squash-merge with no range at all.
  const unevidenced = epicWithGates({
    attributedCommits: [H_HEAD],
    gateReview: { gate2: { verdict: "pass", reviewedAt: "2036-01-01T00:00:00.000Z" } },
  });
  const findings = findingsFor("gate-recorded-as-bookkeeping", unevidenced);
  assert.equal(findings.length, 1, "the signal the arm exists for is unchanged");
  assert.match(findings[0].detail, /post-dates the work it claims to have reviewed/);
});

test("9.4: zero live candidates, and the reason each arm cannot fire is checkable", () => {
  const state = liveState();
  assert.deepEqual(findingsFor("gate-recorded-as-bookkeeping", state), []);
  // Arm 1 needs THREE things: a non-empty attribution array (which names the merge commit), an
  // UNEVIDENCED gate verdict, and a `reviewedAt` after that commit. Stated as a RELATION, not as
  // a live count — the count was 0 when this was first written and the population appeared the
  // moment this release exercised its own attribution and gate obligations, which is exactly the
  // rot docs/lessons/hardcoded-live-data-claims-rot describes. What it exposed was a defect in
  // the arm, not in the record: every verdict recorded by the procedure this release ships is
  // dated after the last commit it covers, so the un-narrowed arm reported compliance.
  for (const e of state.epics) {
    const attributed = Array.isArray(e.attributedCommits) ? e.attributedCommits : [];
    if (!attributed.length) continue;
    const unevidenced = Object.values(e.gateReview || {})
      .filter(g => g && g.reviewedAt && !gateHasEvidence(g));
    assert.deepEqual(unevidenced.map(g => g.reviewedAt), [],
      `arm 1: \`${e.id}\` has attributed commits, so an unevidenced verdict of its own would ` +
      "have to be compared against them — the zero above must come from the comparison, not " +
      "from the arm having no population");
  }
  // Arm 2 stated as a RELATION over however many epics hold two verdicts — the count was 1 when
  // this was written and became 2 when this release recorded both of its own gates. Asserting the
  // count would go red on the record becoming more complete rather than on anything being wrong.
  const twoGates = state.epics.filter(e => e.gateReview && e.gateReview.gate1 && e.gateReview.gate2);
  assert.ok(twoGates.length > 0, "arm 2: at least one live epic must hold two gate verdicts, or the arm has no population");
  for (const e of twoGates) {
    const apart = Math.abs(Date.parse(e.gateReview.gate1.reviewedAt) -
      Date.parse(e.gateReview.gate2.reviewedAt));
    assert.ok(apart > 60_000,
      `arm 2: \`${e.id}\` recorded its two verdicts ${Math.round(apart / 1000)} s apart — a spec ` +
      "review and an implementation review of the same change are never that close together");
  }
});

// ───────────── 9.9: a heal-archived epic that DID pass Gate 2 reads as unknown ─────────────

/** Record two gate verdicts, then move the change on disk so the heal flips the status. The
 *  verdicts are written directly rather than through `record-gate-review` so their timestamps
 *  can be hours apart: two CLI calls land milliseconds apart, which is the very shape the
 *  bookkeeping check reports, and a fixture that tripped a second check could not show that
 *  this one is the only thing reporting it. */
function healArchivedWithGates(cwd, id) {
  fs.mkdirSync(path.join(cwd, "openspec", "changes", id), { recursive: true });
  fs.writeFileSync(path.join(cwd, "openspec", "changes", id, "tasks.md"), "# tasks\n\n- [x] a\n");
  run(["sync"], { cwd });
  const state = readState(cwd);
  Object.assign(state.epics.find(e => e.id === id), { gateReview: {
    gate1: { verdict: "pass", reviewedAt: "2026-08-04T09:00:00.000Z", baseSha: "aaaaaaa", headSha: "bbbbbbb" },
    gate2: { verdict: "pass", reviewedAt: "2026-08-04T17:00:00.000Z", baseSha: "aaaaaaa", headSha: "bbbbbbb" },
  } });
  writeState(cwd, state);
  fs.mkdirSync(path.join(cwd, "openspec", "changes", "archive"), { recursive: true });
  fs.renameSync(path.join(cwd, "openspec", "changes", id),
    path.join(cwd, "openspec", "changes", "archive", `2026-08-05-${id}`));
  run(["sync"], { cwd });
}

test("9.9: the heal-archived epic with a passing Gate 2 is reported, and nothing else reports it", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  healArchivedWithGates(cwd, "reviewed-then-archived");
  const epic = readState(cwd).epics.find(e => e.id === "reviewed-then-archived");
  assert.equal(epic.disposition.recordedBy, "archive-drift-heal", "the heal stamped it");
  assert.equal(epic.gateReview.gate2.verdict, "pass", "and left the real verdict alone");
  const out = run(["integrity"], { cwd });
  assert.match(out, /heal-archived-epic-passed-gate-2 — 1 finding/);
  assert.match(out, /update-epic reviewed-then-archived --status archived --outcome delivered/,
    "the finding names the call that fixes it — the ordinary end of the documented workflow");
  for (const line of out.split("\n").filter(l => /^[a-z-]+ — \d+ finding/.test(l))) {
    if (line.startsWith("heal-archived-epic-passed-gate-2")) continue;
    assert.match(line, /— 0 finding/,
      `${line.split(" ")[0]} also fired, so this fixture cannot show that 9.9 is the only ` +
      "surface on which the mismatch is visible");
  }
});

test("9.9: zero live candidates, because the migration stamps `migration` and not the heal", () => {
  assert.deepEqual(findingsFor("heal-archived-epic-passed-gate-2", liveState()), []);
  const cwd = repoAt0260();
  upgradeAt(cwd, "0.27.0");
  for (const e of readState(cwd).epics.filter(x => x.status === "archived")) {
    assert.notEqual(e.disposition.recordedBy, "archive-drift-heal",
      `${e.id}: a pre-existing archived epic is stamped by the migration, not by the heal`);
  }
});

// ───────────── 9.10: a delivered epic that attributed no commits ─────────────

test("9.10: the empty-array epic is reported and the absent-array epic is not", () => {
  const delivered = { outcome: "delivered", recordedAt: "2026-08-01T00:00:00.000Z" };
  const gate2 = { verdict: "pass", reviewedAt: "2026-08-01T00:00:00.000Z", baseSha: "aaaaaaa", headSha: "bbbbbbb" };
  const epic = (id, over) => ({ id, title: id, priority: "P1", status: "archived", role: "epic",
    lane: "openspec", links: [], disposition: delivered, gateReview: { gate2 }, ...over });
  const findings = findingsFor("delivered-epic-attributed-no-commits", {
    version: 1, active: null, detourStack: [], epics: [
      epic("ignored-the-obligation", { attributedCommits: [] }),
      epic("predates-the-capability", {}),
      epic("did-attribute", { attributedCommits: ["aaaaaaa"] }),
    ] });
  assert.deepEqual(findings.map(f => f.epic), ["ignored-the-obligation"],
    "absent means the epic predates the capability and nothing can be concluded; empty means it " +
    "was created under it and asserts nothing was attributed — collapsing them is the defect");
  assert.match(findings[0].detail, /--attribute-commit/, "the finding names the unmet obligation");
});

test("9.10: zero live candidates, because the migration adds the array to no pre-existing epic", () => {
  assert.deepEqual(findingsFor("delivered-epic-attributed-no-commits", liveState()), []);
  const cwd = repoAt0260();
  upgradeAt(cwd, "0.27.0");
  for (const e of readState(cwd).epics) {
    assert.ok(!("attributedCommits" in e), `${e.id}: every pre-existing epic reads ABSENT, not empty`);
  }
});

// ───────────── 9.11: an openspec epic archived with a passing Gate 2 and no Gate 1 ─────────────

test("9.11: on live data exactly two epics are reported, and neither is excluded by the scope rule", () => {
  const findings = findingsFor("archived-openspec-epic-with-no-gate-1", liveState());
  assert.deepEqual(findings.map(f => f.epic).sort(), ["conductor-mjs-module-split", "platform-parity-mechanism"]);
  // The third passing-Gate-2 epic DOES carry a gate1, which is why it is not here — read from
  // the record rather than assumed, so the check is shown to be discriminating on live data.
  const third = liveState().epics.find(e => e.id === "multi-tracker-primary-secondary-support");
  assert.equal(third.gateReview.gate2.verdict, "pass");
  assert.ok(third.gateReview.gate1, "the one passing-Gate-2 epic that IS gate-1'd must be excluded");
});

test("9.11: the archive proceeds and the missing spec review is a finding, never a refusal", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  fs.mkdirSync(path.join(cwd, "openspec", "changes", "no-spec-review"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "openspec", "changes", "no-spec-review", "tasks.md"), "# tasks\n\n- [x] a\n");
  run(["sync"], { cwd });
  run(["record-gate-review", "no-spec-review", "--gate", "2", "--verdict", "pass",
    "--base-sha", "aaaaaaa", "--head-sha", "bbbbbbb"], { cwd });
  // The archive is ACCEPTED with no gate1 — Gate 1 gates code, and by archive time the code is
  // written, so refusing here would demand a spec review of work that has already shipped.
  run(["update-epic", "no-spec-review", "--status", "archived", "--outcome", "delivered", "--no-deferrals"], { cwd });
  assert.equal(readState(cwd).epics.find(e => e.id === "no-spec-review").status, "archived");
  assert.match(run(["integrity"], { cwd }), /archived-openspec-epic-with-no-gate-1 — 1 finding/);
});

test("9.11: the preconditions are load-bearing — no passing Gate 2, or not openspec-lane, is not a finding", () => {
  const epic = (id, over) => ({ id, title: id, priority: "P1", status: "archived", role: "epic",
    lane: "openspec", links: [],
    disposition: { outcome: "unknown", recordedAt: "2026-08-01T00:00:00.000Z", recordedBy: "migration" }, ...over });
  const pass = { verdict: "pass", reviewedAt: "2026-08-01T00:00:00.000Z", baseSha: "aaaaaaa", headSha: "bbbbbbb" };
  const findings = findingsFor("archived-openspec-epic-with-no-gate-1", {
    version: 1, active: null, detourStack: [], epics: [
      epic("passing-and-ungate1d", { gateReview: { gate2: pass } }),
      // An `ungated` gate2 is the heal's record that NO review happened. Reporting a missing
      // spec review there would be reporting the second half of a condition the ungated-archive
      // notice already carries in full.
      epic("never-reviewed-at-all", { gateReview: { gate2: { verdict: "ungated", reviewedAt: "2026-08-01T00:00:00.000Z" } } }),
      epic("no-verdict-at-all", {}),
      // Another lane cannot record a Gate 1 at all — `record-gate-review` refuses it — so a
      // finding there would be a condition with no clearing path in the engine.
      epic("wrong-lane", { lane: "superpowers", gateReview: { gate2: pass } }),
    ] });
  assert.deepEqual(findings.map(f => f.epic), ["passing-and-ungate1d"]);
});

// ───────────── 9.12: an archive directory that corresponds to no epic ─────────────

test("9.12: an unregistered archive directory is reported, and no epic is created for it", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  fs.mkdirSync(path.join(cwd, "openspec", "changes", "archive", "2026-06-01-never-registered"), { recursive: true });
  const before = readState(cwd).epics.length;
  const out = run(["integrity"], { cwd });
  assert.match(out, /archive-directory-has-no-epic — 1 finding/);
  assert.match(out, /archive\/2026-06-01-never-registered/, "the DIRECTORY is named, since no epic exists to name");
  assert.match(out, /\/pm:sync/, "registration is out of scope here and the finding says who does it");
  assert.equal(readState(cwd).epics.length, before, "the check reports; it does not register");
});

test("9.12: zero live candidates — this repository's one archive directory is registered", () => {
  assert.deepEqual(findingsFor("archive-directory-has-no-epic", liveState()), []);
  const dirs = fs.readdirSync(path.join(REPO, "openspec", "changes", "archive"), { withFileTypes: true })
    .filter(d => d.isDirectory()).map(d => d.name);
  assert.ok(dirs.length > 0,
    "the zero must come from every directory being held, not from there being none to check");
});

// ───────────── 9.13: the ungated-archive notice is a standing condition ─────────────
//
// The deliberate opposite of the write-contention warning. That warning describes a run of
// events that has ENDED, so it is consumed once a session has seen it. An `ungated` verdict
// persists in state.json until a real Gate 2 supersedes it, so a notice that consumed would
// report the condition to one session and hide it from every session after.

/** An epic the heal archived with no verdict from anyone — the only producer of `ungated`. */
function healArchivedUngated(cwd, id) {
  fs.mkdirSync(path.join(cwd, "openspec", "changes", id), { recursive: true });
  fs.writeFileSync(path.join(cwd, "openspec", "changes", id, "tasks.md"), "# tasks\n\n- [x] a\n");
  run(["sync"], { cwd });
  fs.mkdirSync(path.join(cwd, "openspec", "changes", "archive"), { recursive: true });
  fs.renameSync(path.join(cwd, "openspec", "changes", id),
    path.join(cwd, "openspec", "changes", "archive", `2026-08-05-${id}`));
  run(["sync"], { cwd });
}

test("9.13: two consecutive briefings both name the ungated epic, and a real verdict clears it", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  healArchivedUngated(cwd, "archived-unreviewed");
  assert.equal(readState(cwd).epics.find(e => e.id === "archived-unreviewed").gateReview.gate2.verdict, "ungated");

  for (const nth of ["first", "second"]) {
    const brief = parseBrief(cwd);
    assert.match(brief, /UNGATED ARCHIVES/, `${nth} briefing: the condition still holds, so it is still named`);
    assert.ok(brief.includes("archived-unreviewed"), `${nth} briefing names the epic`);
  }
  assert.match(run(["integrity"], { cwd }), /archived-with-no-gate-2-review — 1 finding/,
    "the same condition is named wherever the conductor reports its own integrity");

  // A real passing verdict with its commit range supersedes the bypass entry.
  run(["record-gate-review", "archived-unreviewed", "--gate", "2", "--verdict", "pass",
    "--base-sha", "aaaaaaa", "--head-sha", "bbbbbbb"], { cwd });
  const third = parseBrief(cwd);
  assert.ok(!third.includes("UNGATED ARCHIVES"), "a real verdict clears the notice");
  const gate2 = readState(cwd).epics.find(e => e.id === "archived-unreviewed").gateReview.gate2;
  assert.equal(gate2.verdict, "pass");
  assert.equal(gate2.superseded.verdict, "ungated",
    "the record that this epic was archived ungated survives the review that cleared the notice");
});

test("9.13: the notice is recomputed, never consumed — a delivered briefing does not clear it", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  healArchivedUngated(cwd, "still-ungated");
  const before = stateBytes(cwd);
  parseBrief(cwd);                     // brief() passes consume: true — the contention warning's flag
  assert.equal(stateBytes(cwd), before, "delivering the notice writes nothing");
  assert.match(parseBrief(cwd), /UNGATED ARCHIVES/);
});

test("9.13: no backfilled epic is ever named as an ungated archive", () => {
  const cwd = twoBackfilledChanges();
  const brief = parseBrief(cwd);
  assert.ok(!brief.includes("UNGATED ARCHIVES"),
    "the backfill writes no gate2 at all, which is what keeps a permanent unclearable condition " +
    "from being asserted against every change archived before the conductor existed");
  assert.match(run(["integrity"], { cwd }), /archived-with-no-gate-2-review — 0 finding/);
});

test("9.13: an epic closed killed leaves the ungated notice — its only clearing path can never arrive", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  healArchivedUngated(cwd, "archived-then-killed");
  assert.match(parseBrief(cwd), /UNGATED ARCHIVES/, "precondition: the heal's bypass entry is reported");

  run(["update-epic", "archived-then-killed", "--status", "archived", "--outcome", "killed",
    "--reason", "would have inverted a safety property; no code was ever written",
    "--no-deferrals"], { cwd });

  const gate2 = readState(cwd).epics.find(e => e.id === "archived-then-killed").gateReview.gate2;
  assert.equal(gate2.verdict, "ungated",
    "the record that this epic was archived ungated SURVIVES — the finding is scoped out, not erased");
  assert.ok(!parseBrief(cwd).includes("UNGATED ARCHIVES"),
    "a killed change will never acquire the passing Gate 2 that is this condition's only clearing " +
    "path, so reporting it forever is a permanent unclearable finding");
  assert.match(run(["integrity"], { cwd }), /archived-with-no-gate-2-review — 0 finding/,
    "the brief and the integrity report name the same set, because both read ungatedArchives()");
});

// ───────────── 9.14: the day-one finding set, per check, every finding explained ─────────────

test("9.14: the recorded day-one set names every check and explains every live finding", () => {
  // Resolved rather than hardcoded: this change archives itself, which MOVES the document under
  // `changes/archive/<date>-<id>/`. A literal in-flight path turns the release's own last step
  // into a red suite — the same "the file moved and the check kept reading the old place" shape
  // task 16.1's sweep exists to find.
  const dayOne = [path.join(REPO, "openspec", "changes", "conductor-tells-the-truth",
    "integrity-day-one.md"),
    ...fs.existsSync(path.join(REPO, "openspec", "changes", "archive"))
      ? fs.readdirSync(path.join(REPO, "openspec", "changes", "archive"))
        .filter(d => d.endsWith("conductor-tells-the-truth"))
        .map(d => path.join(REPO, "openspec", "changes", "archive", d, "integrity-day-one.md"))
      : []].find(fs.existsSync);
  assert.ok(dayOne, "the day-one record must be findable in flight OR archived — never neither");
  const doc = fs.readFileSync(dayOne, "utf8");
  const report = runIntegrity(liveState());
  for (const { id, findings } of report) {
    assert.ok(doc.includes(id),
      `${id}: a check missing from the day-one record is a check whose result nobody wrote down`);
    for (const f of findings) {
      assert.ok(!f.epic || doc.includes(f.epic),
        `${id}/${f.epic}: every finding is EXPLAINED in the record, not counted — a finding with ` +
        "no explanation is the counting-alone failure this task exists to end");
    }
  }
  assert.match(doc, new RegExp(`\\*\\*${report.length} checks?, ` +
    `${report.reduce((n, c) => n + c.findings.length, 0)} findings?\\.\\*\\*`),
    "the totals in the record must be the totals the command actually produced");
});

// ───────── dangling epic references — the class, not the one instance reported ─────────
//
// `remove-epic` stripped dangling `links[]` and nulled a removed `active`, and stopped there.
// Group 14 then added THREE more places state holds an epic id — a release's `deferred[]`, an
// archive disposition's `carriedTo`, a deferral assertion's `deferrals[]` — and none of them
// was swept, so removing an epic a release had deferred left `PROJECT.md` rendering a deferral
// pointing at nothing. The reference set is now declared ONCE, in links.mjs, and both the sweep
// and the check below read it, so a fifth reference site cannot be handled by one and missed by
// the other.

const withDanglers = () => ({
  version: 1, active: null, detourStack: [
    { pausedEpic: "gone", reason: "for a detour", spawnedDetour: "also-gone", reconcileOnResume: true },
  ],
  releases: [{ id: "0.27.0", intent: "i", deferred: [{ epic: "gone", reason: "cut", recordedAt: "2026-08-01T00:00:00.000Z" }] }],
  epics: [
    { id: "here", title: "here", priority: "P1", status: "queued", role: "epic", lane: "claude-code",
      links: [{ type: "depends-on", epic: "gone" }],
      disposition: { outcome: "delivered", recordedAt: "2026-08-01T00:00:00.000Z", recordedBy: "agent", carriedTo: "gone" },
      deferralAssertion: { deferrals: [{ epic: "gone", section: "design.md" }], declined: [], assertedAt: "2026-08-01T00:00:00.000Z" } },
  ],
});

test("the dangling-reference check fires on constructed data, naming every holder", () => {
  const findings = findingsFor("dangling-epic-reference", withDanglers());
  const where = findings.map(f => f.detail).join(" | ");
  for (const site of ["links[]", "carriedTo", "deferralAssertion", "deferred[]", "detour"]) {
    assert.match(where, new RegExp(site.replace(/[[\]]/g, "\\$&")),
      `a dangling reference held in ${site} must be reported — ${where}`);
  }
  assert.ok(findings.every(f => /gone/.test(f.detail)), "each finding names the id that does not resolve");
});

test("the dangling-reference check is silent on a record whose references all resolve", () => {
  const st = withDanglers();
  for (const id of ["gone", "also-gone"]) {
    st.epics.push({ id, title: id, priority: "P1", status: "queued", role: "epic", lane: "claude-code", links: [] });
  }
  assert.deepEqual(findingsFor("dangling-epic-reference", st), []);
});

test("this repository's own record holds no dangling epic reference", () => {
  assert.deepEqual(findingsFor("dangling-epic-reference", liveState()).map(f => f.detail), []);
});

