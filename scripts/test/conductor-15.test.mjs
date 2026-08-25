import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { tmpRepo, run, runCombined, readState, writeState, projectMd, parseBrief, fixturePluginRoot, gitInitWithCommit } from "./helpers.mjs";

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

const REFRESH_GATE_HEADING = "## Re-read the source before an epic becomes the work";
/** The block minus the always-on refresh-gate section this release adds — see conductor-14's
 *  identical helper for why byte-identity is claimed for the tracker sections and not for the
 *  whole document. */
const stripRefreshGate = (block) =>
  block.replace(new RegExp(`\\n*${REFRESH_GATE_HEADING}[\\s\\S]*?(?=\\n<!-- END pm-conductor rules -->)`), "");

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
  const before = fs.readFileSync(path.join(FIXTURES, "rules-0.26.0-jira-scoped.txt"), "utf8");
  assert.equal(stripRefreshGate(block), before,
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

test("7.1: a 0.26.0 state applies exactly one migration, and the second run is a byte-identical no-op", () => {
  const cwd = repoAt0260();
  const first = upgradeAt(cwd, "0.27.0");
  assert.match(first, /upgraded \(1 migration\(s\)\)/,
    "the 0.27.0 entry must be the one migration a 0.26.0-stamped repo is missing");
  assert.equal(readState(cwd).pmVersion, "0.27.0");
  const after = stateBytes(cwd);
  const second = upgradeAt(cwd, "0.27.0");
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
function repoFromLiveState() {
  const cwd = tmpRepo();
  fs.mkdirSync(path.join(cwd, ".conductor"), { recursive: true });
  fs.copyFileSync(path.join(REPO, ".conductor", "state.json"), path.join(cwd, ".conductor", "state.json"));
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
  assert.equal(archivedBefore.filter(e => e.disposition).length, 0,
    "no live epic carries a disposition before the migration, so the stamp below is the migration's");
  const lanes = new Set(archivedBefore.map(e => e.lane || "openspec"));
  assert.ok(lanes.size > 1, "the live record must span more than one lane, or lane-agnosticism is untested here");

  upgradeAt(cwd, "0.27.0");
  const archived = readState(cwd).epics.filter(e => e.status === "archived");
  assert.equal(archived.length, archivedBefore.length, "the migration registers and removes nothing");
  for (const e of archived) {
    assert.ok(e.disposition, `${e.id}: every archived epic carries a disposition, whatever its lane`);
    assert.equal(e.disposition.recordedBy, "migration");
    assert.equal(e.disposition.outcome, passingGate2(e) ? "delivered" : "unknown",
      `${e.id}: delivered iff a passing Gate 2 exists`);
  }
  const delivered = archived.filter(e => e.disposition.outcome === "delivered");
  assert.deepEqual(delivered.map(e => e.id).sort(), archived.filter(passingGate2).map(e => e.id).sort(),
    "the delivered set IS the passing-Gate-2 set — not a superset, not a lane");
  assert.ok(delivered.length < archived.length,
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
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const state = readState(cwd);
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
