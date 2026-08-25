import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { tmpRepo, run, runCombined, readState, writeState, projectMd, parseBrief, fixturePluginRoot, gitInitWithCommit, expectFail } from "./helpers.mjs";

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
    epic("registered-from-the-archive", { outcome: "unknown", recordedAt: "2026-08-01T00:00:00.000Z", recordedBy: "archive-backfill" }),
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
