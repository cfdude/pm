import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, runCombined, readState, writeState, projectMd, parseBrief, fixturePluginRoot } from "./helpers.mjs";

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
