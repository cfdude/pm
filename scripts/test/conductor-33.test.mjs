// gh-84 — the advisory claim: who owns an epic, and is this repo quiescent.
//
// The thing under test is NOT "does a field get written". It is the set of refusals that make an
// advisory marker mean something, and the set of NON-refusals that keep it advisory. Both halves
// are asserted, because either one alone describes a different feature: refusals without the
// non-refusals is a lock (which #84 rules out by name), and non-refusals without the refusals is
// a comment.
//
// Every negative case also asserts that NOTHING WAS WRITTEN. "Two sessions both claim" must not
// have a silent-corruption reading, and a refusal that left half a claim behind would be exactly
// that.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, runCombined, readState, writeState, expectFail } from "./helpers.mjs";

const REPO = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const INJECT = path.join(REPO, "scripts", "test", "inject-state-conflict.cjs");

/** A repo with two claimable epics and one archived one. */
function claimRepo() {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "e1", "--lane", "claude-code", "--title", "one"], { cwd });
  run(["add-epic", "--id", "e2", "--lane", "claude-code", "--title", "two"], { cwd });
  return cwd;
}
const stateBytes = (cwd) => fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
const claimOf = (cwd, id) => readState(cwd).epics.find(e => e.id === id).claim;
const markerPath = (cwd) => path.join(cwd, ".conductor", "session-claim.json");

/** A claim record as it would look after `minutesAgo` minutes, with the given ttl. Used to
 *  manufacture an EXPIRED claim without sleeping — the alternative is a test that takes two
 *  hours or a production clock seam that only tests use. */
function agedClaim(session, minutesAgo, ttlMinutes) {
  return {
    session,
    claimedAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    ttlMinutes,
  };
}

// ═══════════════ the record ═══════════════

test("gh-84: claim writes {session, claimedAt, ttlMinutes} on the epic", () => {
  const cwd = claimRepo();
  run(["claim", "e1", "--session", "orchestrator"], { cwd });
  const c = claimOf(cwd, "e1");
  assert.equal(c.session, "orchestrator");
  assert.equal(c.ttlMinutes, 120, "the epic default, from constants.mjs");
  assert.ok(Date.parse(c.claimedAt) > 0, "claimedAt must be a real timestamp");
  assert.equal(c.heartbeatAt, undefined,
    "no heartbeat field: a heartbeat nothing beats is claimedAt in a costume, and it would make " +
    "the staleness threshold wrong in both directions");
});

test("gh-84: --ttl is recorded ON the claim, so a later default change cannot reinterpret it", () => {
  const cwd = claimRepo();
  run(["claim", "e1", "--session", "s1", "--ttl", "5"], { cwd });
  assert.equal(claimOf(cwd, "e1").ttlMinutes, 5);
});

test("gh-84: a non-numeric or non-positive --ttl is refused rather than silently defaulted", () => {
  const cwd = claimRepo();
  const before = stateBytes(cwd);
  for (const bad of ["abc", "0", "-3"]) {
    const err = expectFail(() => run(["claim", "e1", "--session", "s1", "--ttl", bad], { cwd }));
    assert.ok(err, `--ttl ${bad} must be refused — a silent fallback records a lifetime nobody asked for`);
  }
  assert.equal(stateBytes(cwd), before, "not one refusal may leave a write behind");
});

test("gh-84: PM_SESSION supplies the identity, and an explicit --session outranks it", () => {
  const cwd = claimRepo();
  run(["claim", "e1"], { cwd, env: { PM_SESSION: "from-env" } });
  assert.equal(claimOf(cwd, "e1").session, "from-env");

  run(["claim", "e2", "--session", "from-flag"], { cwd, env: { PM_SESSION: "from-env" } });
  assert.equal(claimOf(cwd, "e2").session, "from-flag",
    "an orchestrator must be able to act AS a named identity without exporting a variable every " +
    "child process then inherits");
});

test("gh-84: with no identity at all, claim refuses and names both ways to give one", () => {
  const cwd = claimRepo();
  const before = stateBytes(cwd);
  const err = expectFail(() => run(["claim", "e1"], { cwd, env: { PM_SESSION: "" } }));
  assert.ok(err);
  assert.match(String(err.stderr || err.message), /--session/);
  assert.match(String(err.stderr || err.message), /PM_SESSION/);
  assert.equal(stateBytes(cwd), before);
});

// ═══════════════ the ONE surface that refuses ═══════════════

test("gh-84: a second session's claim over a LIVE claim is refused, names the holder, writes nothing", () => {
  const cwd = claimRepo();
  run(["claim", "e1", "--session", "alpha"], { cwd });
  const before = stateBytes(cwd);

  const err = expectFail(() => run(["claim", "e1", "--session", "beta"], { cwd }));
  assert.ok(err, "the second claim must exit non-zero");
  const msg = String(err.stderr || err.message);
  assert.match(msg, /alpha/, "the refusal must name WHO holds it");
  assert.match(msg, /--steal/, "and how to take it deliberately");
  assert.equal(stateBytes(cwd), before,
    "'two sessions both claim' must have no silent-corruption reading — it is not a write at all");
  assert.equal(claimOf(cwd, "e1").session, "alpha");
});

test("gh-84: re-claiming as the SAME session succeeds and extends the TTL — that is the heartbeat", async () => {
  const cwd = claimRepo();
  run(["claim", "e1", "--session", "alpha", "--ttl", "60"], { cwd });
  const first = claimOf(cwd, "e1").claimedAt;
  await new Promise(r => setTimeout(r, 1100));
  run(["claim", "e1", "--session", "alpha", "--ttl", "90"], { cwd });
  const second = claimOf(cwd, "e1");
  assert.ok(Date.parse(second.claimedAt) > Date.parse(first), "claimedAt must move forward");
  assert.equal(second.ttlMinutes, 90);
});

test("gh-84: claiming over an EXPIRED claim succeeds without --steal and REPORTS the takeover", () => {
  const cwd = claimRepo();
  const s = readState(cwd);
  s.epics.find(e => e.id === "e1").claim = agedClaim("dead-session", 200, 120);
  writeState(cwd, s);

  const out = runCombined(["claim", "e1", "--session", "beta"], { cwd });
  assert.equal(claimOf(cwd, "e1").session, "beta");
  assert.match(out, /dead-session/, "a takeover must say whose claim it stepped over");
  assert.match(out, /expired/i);
  assert.doesNotMatch(out, /STOLEN/, "an expired takeover is ordinary, not a steal");
});

test("gh-84: --steal overrides a LIVE claim and says so", () => {
  const cwd = claimRepo();
  run(["claim", "e1", "--session", "alpha"], { cwd });
  const out = runCombined(["claim", "e1", "--session", "beta", "--steal"], { cwd });
  assert.equal(claimOf(cwd, "e1").session, "beta");
  assert.match(out, /STOLEN/, "stealing a live claim must be visibly different from taking an expired one");
  assert.match(out, /alpha/);
});

test("gh-84: --steal is NOT --force — it must not disable state.json's revision guard", () => {
  // saveState() reads `--force` GLOBALLY off argv. A claim verb spelled `--force` would silently
  // switch off optimistic concurrency on the very write it exists to coordinate: the enforcement
  // half (#83) defeated as a side effect of the cooperative half (#84). Asserted BEHAVIOURALLY,
  // through the conflict-injection seam, rather than by grepping the source for a string.
  const cwd = claimRepo();
  run(["claim", "e1", "--session", "alpha"], { cwd });
  const marker = path.join(cwd, ".conductor", "injected.marker");
  const err = expectFail(() => run(["claim", "e1", "--session", "beta", "--steal"], {
    cwd,
    env: {
      NODE_OPTIONS: `--require ${INJECT}`,
      PM_INJECT_CONFLICT_DIR: path.join(cwd, ".conductor"),
      PM_INJECT_CONFLICT_MARKER: marker,
    },
  }));
  assert.ok(fs.existsSync(marker),
    "the conflict seam never fired — this test would otherwise pass without a conflict occurring");
  assert.ok(err, "--steal must still hit the revision guard");
  assert.equal(err.status, 9, "and must exit with the retryable CONFLICT_EXIT_CODE, not 1");
});

test("gh-84: an ARCHIVED epic cannot be claimed", () => {
  const cwd = claimRepo();
  run(["update-epic", "e1", "--status", "archived", "--outcome", "delivered", "--no-deferrals"], { cwd });
  const before = stateBytes(cwd);
  const err = expectFail(() => run(["claim", "e1", "--session", "alpha"], { cwd }));
  assert.ok(err);
  assert.match(String(err.stderr || err.message), /archived/);
  assert.equal(stateBytes(cwd), before);
});

test("gh-84: claiming an epic that does not exist is refused", () => {
  const cwd = claimRepo();
  const before = stateBytes(cwd);
  assert.ok(expectFail(() => run(["claim", "nope", "--session", "alpha"], { cwd })));
  assert.equal(stateBytes(cwd), before);
});

// ═══════════════ what stays ADVISORY ═══════════════

test("gh-84: a claim held by ANOTHER session blocks no other verb — that is what advisory means", () => {
  const cwd = claimRepo();
  run(["claim", "e1", "--session", "alpha"], { cwd });
  // Every one of these is a write to the claimed epic, from a process that is not the holder.
  run(["update-epic", "e1", "--title", "renamed by someone else"], { cwd });
  run(["reorder", "e1", "--before", "e2"], { cwd });
  run(["update-epic", "e1", "--priority", "P0"], { cwd });
  run(["set-active", "e1"], { cwd });
  run(["update-epic", "e1", "--add-story", "written by a stranger"], { cwd });
  const e1 = readState(cwd).epics.find(e => e.id === "e1");
  assert.equal(e1.title, "renamed by someone else",
    "#84 is explicit: make coordination expressible, do NOT make pm refuse to work");
  assert.equal(e1.claim.session, "alpha", "and the claim survives all of it untouched");
});

// ═══════════════ unclaim ═══════════════

test("gh-84: unclaim clears the claim for its holder", () => {
  const cwd = claimRepo();
  run(["claim", "e1", "--session", "alpha"], { cwd });
  run(["unclaim", "e1", "--session", "alpha"], { cwd });
  assert.equal(claimOf(cwd, "e1"), undefined);
});

test("gh-84: unclaiming a LIVE claim you do not hold is refused — that is the move that makes the marker a lie", () => {
  const cwd = claimRepo();
  run(["claim", "e1", "--session", "alpha"], { cwd });
  const before = stateBytes(cwd);
  const err = expectFail(() => run(["unclaim", "e1", "--session", "beta"], { cwd }));
  assert.ok(err);
  assert.match(String(err.stderr || err.message), /alpha/);
  assert.equal(stateBytes(cwd), before, "the holder must not lose its claim to someone else's cleanup");

  const out = runCombined(["unclaim", "e1", "--session", "beta", "--steal"], { cwd });
  assert.equal(claimOf(cwd, "e1"), undefined);
  assert.match(out, /alpha/, "and the override must say whose claim it cleared");
});

test("gh-84: unclaiming something that is not claimed is a no-op that exits 0", () => {
  const cwd = claimRepo();
  const before = stateBytes(cwd);
  const out = runCombined(["unclaim", "e1", "--session", "alpha"], { cwd });
  assert.match(out, /not claimed/);
  assert.equal(stateBytes(cwd), before,
    "a cleanup path that fails when there is nothing to clean up is a cleanup path people stop running");
});

test("gh-84: archiving an epic CLEARS its claim and says so — an ended epic cannot still be owned", () => {
  const cwd = claimRepo();
  run(["claim", "e1", "--session", "alpha"], { cwd });
  const out = runCombined(
    ["update-epic", "e1", "--status", "archived", "--outcome", "delivered", "--no-deferrals"], { cwd });
  assert.equal(claimOf(cwd, "e1"), undefined);
  assert.match(out, /alpha/, "clearing someone's claim must be announced, not silent");
  // CLEARED, not REFUSED: refusing to archive over an advisory marker is pm refusing to work.
  assert.equal(readState(cwd).epics.find(e => e.id === "e1").status, "archived");
});

test("gh-84: remove-epic takes the claim with it — no dangling owner record", () => {
  const cwd = claimRepo();
  run(["claim", "e1", "--session", "alpha"], { cwd });
  run(["remove-epic", "e1"], { cwd });
  assert.equal(readState(cwd).epics.some(e => e.id === "e1"), false);
  const out = run(["owners"], { cwd });
  assert.match(out, /QUIESCENT/, "owners must not report ownership of an epic that is gone");
});

// ═══════════════ the repo-level quiescence marker ═══════════════

test("gh-84: claim --repo writes a SIDECAR, never state.json", () => {
  const cwd = claimRepo();
  const before = stateBytes(cwd);
  run(["claim", "--repo", "--session", "alpha"], { cwd });
  assert.ok(fs.existsSync(markerPath(cwd)));
  assert.equal(stateBytes(cwd), before,
    "the marker answers 'is it safe to write to state.json' — putting it inside state.json, " +
    "where setting and clearing it bump revision and can themselves conflict, inverts its purpose");
  const m = JSON.parse(fs.readFileSync(markerPath(cwd), "utf8"));
  assert.equal(m.session, "alpha");
  assert.equal(m.ttlMinutes, 30, "shorter than an epic claim: a crashed session must not hold it for hours");
});

test("gh-84: a second session's claim --repo over a LIVE marker is refused — the same rule as an epic", () => {
  // Found by mutation: deleting the repo branch's holder check left every other test green,
  // because only `unclaim --repo` was defended. A guard at one call site with its identical
  // sibling untouched is the dominant defect class this repository audits for, and the two
  // branches sit four lines apart in one function.
  const cwd = claimRepo();
  run(["claim", "--repo", "--session", "alpha"], { cwd });
  const before = fs.readFileSync(markerPath(cwd), "utf8");

  const err = expectFail(() => run(["claim", "--repo", "--session", "beta"], { cwd }));
  assert.ok(err, "the second repo claim must exit non-zero");
  assert.match(String(err.stderr || err.message), /alpha/);
  assert.equal(fs.readFileSync(markerPath(cwd), "utf8"), before, "and must write nothing");

  const out = runCombined(["claim", "--repo", "--session", "beta", "--steal"], { cwd });
  assert.equal(JSON.parse(fs.readFileSync(markerPath(cwd), "utf8")).session, "beta");
  assert.match(out, /STOLEN/);
});

test("gh-84: claim --repo over an EXPIRED marker succeeds without --steal", () => {
  const cwd = claimRepo();
  fs.mkdirSync(path.dirname(markerPath(cwd)), { recursive: true });
  fs.writeFileSync(markerPath(cwd), JSON.stringify(agedClaim("dead-orchestrator", 90, 30)));
  const out = runCombined(["claim", "--repo", "--session", "beta"], { cwd });
  assert.equal(JSON.parse(fs.readFileSync(markerPath(cwd), "utf8")).session, "beta");
  assert.match(out, /expired/i);
  assert.doesNotMatch(out, /STOLEN/);
});

test("gh-84: unclaim --repo removes the sidecar; a live one is defended, an absent one is a no-op", () => {
  const cwd = claimRepo();
  const out0 = runCombined(["unclaim", "--repo", "--session", "alpha"], { cwd });
  assert.match(out0, /not set/);

  run(["claim", "--repo", "--session", "alpha"], { cwd });
  assert.ok(expectFail(() => run(["unclaim", "--repo", "--session", "beta"], { cwd })));
  assert.ok(fs.existsSync(markerPath(cwd)), "a live marker must survive someone else's cleanup");

  run(["unclaim", "--repo", "--session", "alpha"], { cwd });
  assert.equal(fs.existsSync(markerPath(cwd)), false);
});

test("gh-84: a corrupt or unreadable marker reads as EXPIRED, never as live", () => {
  // Chosen direction, not incidental: a marker that read as live when unreadable would block
  // every other session forever with no way to reason about when it stops — "worse than none".
  const cwd = claimRepo();
  fs.mkdirSync(path.dirname(markerPath(cwd)), { recursive: true });
  fs.writeFileSync(markerPath(cwd), "{ not json");
  run(["claim", "--repo", "--session", "beta"], { cwd });
  assert.equal(JSON.parse(fs.readFileSync(markerPath(cwd), "utf8")).session, "beta");

  // BOTH unreadable halves, separately. Found by mutation: a version that treated an unusable
  // `ttlMinutes` as an effectively infinite lifetime passed every other test in this file,
  // because only the unreadable `claimedAt` was exercised — and an infinite lifetime is exactly
  // the marker that blocks every other session forever.
  for (const zombie of [
    { session: "zombie-date", claimedAt: "not-a-date", ttlMinutes: 30 },
    { session: "zombie-ttl", claimedAt: new Date().toISOString(), ttlMinutes: "forever" },
    { session: "zombie-neg", claimedAt: new Date().toISOString(), ttlMinutes: -1 },
    { session: "zombie-none", claimedAt: new Date().toISOString() },
  ]) {
    fs.writeFileSync(markerPath(cwd), JSON.stringify(zombie));
    run(["claim", "--repo", "--session", "gamma"], { cwd });
    assert.equal(JSON.parse(fs.readFileSync(markerPath(cwd), "utf8")).session, "gamma",
      `an unreadable marker (${JSON.stringify(zombie)}) must never read as live`);
  }
});

test("gh-84: an epic claim with an unreadable TTL is STALE to owners and to integrity, not live", () => {
  // The same mutant, at the two READING surfaces rather than at the claim verb. Without this,
  // `claimExpiry` could return an effectively infinite date for an unusable ttl and both
  // reports would show permanent live ownership.
  const cwd = claimRepo();
  const s = readState(cwd);
  s.epics.find(e => e.id === "e1").claim =
    { session: "zombie", claimedAt: new Date().toISOString(), ttlMinutes: "forever" };
  writeState(cwd, s);
  assert.match(run(["owners"], { cwd }), /`e1` — STALE by 'zombie'/);
  assert.match(run(["integrity"], { cwd }), /advisory-claim-shape — 1 finding/);
});

test("gh-84: the marker is git-ignored by init AND back-filled by upgrade (#106's rule)", () => {
  const cwd = claimRepo();
  assert.match(fs.readFileSync(path.join(cwd, ".gitignore"), "utf8"), /\.conductor\/session-claim\.json/);

  // A repo whose .gitignore predates the marker: upgrade must back-fill it, exactly as it does
  // for write-conflicts.latch and commit-watch.json.
  const old = tmpRepo();
  run(["init"], { cwd: old });
  fs.writeFileSync(path.join(old, ".gitignore"), ".conductor/detours.log\n");
  run(["upgrade"], { cwd: old });
  assert.match(fs.readFileSync(path.join(old, ".gitignore"), "utf8"), /\.conductor\/session-claim\.json/);
});

// ═══════════════ owners ═══════════════

test("gh-84: owners reports the repo marker and every epic claim, HELD vs STALE", () => {
  const cwd = claimRepo();
  run(["claim", "--repo", "--session", "orchestrator"], { cwd });
  run(["claim", "e1", "--session", "worker-a"], { cwd });
  const s = readState(cwd);
  s.epics.find(e => e.id === "e2").claim = agedClaim("worker-b", 300, 120);
  writeState(cwd, s);

  const out = run(["owners"], { cwd });
  assert.match(out, /repository: BUSY/);
  assert.match(out, /orchestrator/);
  assert.match(out, /`e1` — HELD by 'worker-a'/);
  assert.match(out, /`e2` — STALE by 'worker-b'/);
  assert.match(out, /1 stale marker/, "a stale claim is how a session that died mid-epic looks");
});

test("gh-84: owners says QUIESCENT, and says what quiescent does NOT mean", () => {
  const cwd = claimRepo();
  const out = run(["owners"], { cwd });
  assert.match(out, /QUIESCENT/);
  assert.match(out, /not a lock/,
    "a signal presented as a guarantee is the 'looks like coordination' failure this feature must avoid");
});

test("gh-84: owners --json is machine-readable for an orchestrator", () => {
  const cwd = claimRepo();
  run(["claim", "e1", "--session", "worker-a"], { cwd });
  const j = JSON.parse(run(["owners", "--json"], { cwd }));
  assert.equal(j.quiescent, false);
  assert.equal(j.claims.length, 1);
  assert.equal(j.claims[0].scope, "epic");
  assert.equal(j.claims[0].live, true);

  const clean = JSON.parse(run(["owners", "--json"], { cwd: claimRepo() }));
  assert.equal(clean.quiescent, true);
  assert.deepEqual(clean.claims, []);
});

test("gh-84/gh-111: EVERY verb with an allowlist refuses an undeclared flag, by name", () => {
  // MUTATION SURVIVORS (84-ii, 111-iii). `owners` and `activity` each got a test of their own
  // above, and deleting the check on `claim`, `unclaim` or `purge-logs` still killed nothing —
  // the shape this repository's own audit calls the dominant defect class: a guard covered at one
  // call site while its identical siblings go unexercised. The five are swept together HERE so
  // that adding a sixth verb with an allowlist and forgetting its case is a visible omission in
  // one list rather than a test nobody wrote.
  const cwd = claimRepo();
  const before = stateBytes(cwd);
  for (const argv of [
    ["claim", "e1", "--session", "s", "--bogus"],
    ["unclaim", "e1", "--session", "s", "--bogus"],
    ["owners", "--bogus"],
    ["activity", "--bogus"],
    ["purge-logs", "--keep", "5", "--bogus"],
  ]) {
    const err = expectFail(() => run(argv, { cwd }));
    assert.match(String(err.stderr || err.message),
      new RegExp(`unknown flag --bogus for ${argv[0]}`),
      `\`${argv.join(" ")}\` must be refused by name, not silently ignored`);
  }
  assert.equal(stateBytes(cwd), before, "not one refusal may leave a write behind");
});

test("gh-84: owners refuses a flag it does not declare, instead of ignoring it", () => {
  // MUTATION SURVIVOR (84-i). `owners` read `--json` off `process.argv` and had no allowlist at
  // all, so `owners --jsno` printed the human report and exited 0 — a typo silently answering a
  // different question from the one asked, on the verb an orchestrator uses to decide whether it
  // is safe to write. The allowlist is `flagsFor("owners")`, so it follows the registry rather
  // than a literal, and deleting the check leaves nothing else to notice.
  const cwd = claimRepo();
  const before = stateBytes(cwd);
  const err = expectFail(() => run(["owners", "--jsno"], { cwd }));
  assert.match(String(err.stderr || err.message), /unknown flag --jsno for owners/);
  assert.equal(stateBytes(cwd), before, "a refusal writes nothing");
});

test("gh-84: owners writes NOTHING — the verb an orchestrator points at a repo it does not own", () => {
  const cwd = claimRepo();
  run(["claim", "e1", "--session", "worker-a"], { cwd });
  const before = stateBytes(cwd);
  const mtime = fs.statSync(path.join(cwd, "PROJECT.md")).mtimeMs;
  run(["owners"], { cwd });
  run(["owners", "--json"], { cwd });
  assert.equal(stateBytes(cwd), before);
  assert.equal(fs.statSync(path.join(cwd, "PROJECT.md")).mtimeMs, mtime,
    "owners must not render — #85's exact defect, with the question inverted onto itself");
});

// ═══════════════ integrity: the surface that finds a stale claim unasked ═══════════════

test("gh-84: integrity reports an EXPIRED claim and an archived epic that still holds one", () => {
  const cwd = claimRepo();
  const s = readState(cwd);
  s.epics.find(e => e.id === "e1").claim = agedClaim("dead", 300, 120);
  const e2 = s.epics.find(e => e.id === "e2");
  e2.status = "archived";
  e2.claim = agedClaim("ghost", 1, 120);   // LIVE, on an epic that has ended
  e2.disposition = { outcome: "delivered", recordedBy: "agent", at: new Date().toISOString() };
  writeState(cwd, s);

  const out = run(["integrity"], { cwd });
  assert.match(out, /advisory-claim-shape — 2 finding/);
  assert.match(out, /`e1` — claim by session 'dead' expired/);
  assert.match(out, /`e2` — archived, and still holding a claim by session 'ghost'/);
});

test("gh-84: a clean repo's advisory-claim check RAN and found nothing — silence and absence differ", () => {
  const cwd = claimRepo();
  run(["claim", "e1", "--session", "alpha"], { cwd });
  assert.match(run(["integrity"], { cwd }), /advisory-claim-shape — 0 finding/);
});

// ══════════════════════════════════════════════════════════════════════════════════════════
// gh-111 — the optional activity log, and the reader that ships with it.
//
// The condition this feature had to meet is in the issue's own words: "If the reader is not in
// the same release, this feature should not ship." So the tests below are weighted accordingly —
// the writer's correctness matters, but the ones that decide whether the feature earns its cost
// are the reader's: does `--since` actually scope, and does the out-of-band count mean anything.
// ══════════════════════════════════════════════════════════════════════════════════════════

const ALOG = new URL("../lib/activity-log.mjs", import.meta.url).href;
const AREPORT = new URL("../lib/activity-report.mjs", import.meta.url).href;
const PURGE = new URL("../lib/purge-logs.mjs", import.meta.url).href;

const activityDirOf = (cwd) => path.join(cwd, ".conductor", "activity");
const segmentFiles = (cwd) => {
  try { return fs.readdirSync(activityDirOf(cwd)).filter(n => n.endsWith(".log")).sort(); }
  catch { return []; }
};
const allEvents = (cwd) => segmentFiles(cwd)
  .flatMap(n => fs.readFileSync(path.join(activityDirOf(cwd), n), "utf8").split("\n"))
  .filter(Boolean).map(l => JSON.parse(l));

function loggingRepo() {
  const cwd = claimRepo();
  run(["set-activity-log", "on"], { cwd });
  return cwd;
}
function scratchDir(prefix) {
  return fs.mkdtempSync(path.join(fs.realpathSync(path.dirname(tmpRepo())), prefix));
}

// ─────────────── the round-trip `--since` rests on ───────────────

test("gh-111: segmentStart(segmentName(d)) round-trips exactly — --since is decoration without it", async () => {
  // The two halves live in different modules and undo each other by hand: segmentName replaces
  // `:` and `.` with `-`, segmentStart restores them with a positional regex. A silent mismatch
  // makes segmentStart return null, which makes the `--since` skip a no-op — so the window
  // filter would appear to work while reading every segment, and nothing else would notice.
  const { segmentName } = await import(ALOG);
  const { segmentStart } = await import(AREPORT);
  for (const iso of [
    "2026-08-29T11:05:09.761Z",
    "2026-01-01T00:00:00.000Z",   // all-zero time
    "2026-12-31T23:59:59.999Z",
    "2026-06-15T08:04:02.007Z",   // sub-10ms milliseconds, where a lazy regex loses a digit
  ]) {
    const d = new Date(iso);
    assert.equal(segmentStart(segmentName(d)), d.getTime(), `round-trip failed for ${iso}`);
  }
  assert.equal(segmentStart("not-a-segment.log"), null);
  assert.equal(segmentStart("activity-garbage.log"), null,
    "an unparseable name must return null, never a plausible-looking wrong time");
});

// ─────────────── off by default, and off costs nothing ───────────────

test("gh-111: OFF by default — no directory, no events, and .conductor gains nothing", () => {
  const cwd = claimRepo();
  const snapshot = () => fs.readdirSync(path.join(cwd, ".conductor")).sort().join("|");
  const before = snapshot();
  run(["update-epic", "e1", "--status", "active"], { cwd });
  run(["add-epic", "--id", "e3", "--lane", "superpowers"], { cwd });
  run(["update-epic", "e1", "--title", "x"], { cwd });
  assert.equal(fs.existsSync(activityDirOf(cwd)), false,
    "a feature that is off must not scaffold its own store — every user inherits that cost");
  assert.equal(snapshot(), before);
  assert.match(run(["activity"], { cwd }), /activity log is OFF/,
    "and the reader must say WHY it has nothing, not just report zero");
  assert.equal(fs.existsSync(activityDirOf(cwd)), false, "even the reader must not create it");
});

test("gh-111: set-activity-log needs on|off, and is an added optional field — no migration", () => {
  const cwd = claimRepo();
  assert.ok(expectFail(() => run(["set-activity-log"], { cwd })));
  assert.ok(expectFail(() => run(["set-activity-log", "maybe"], { cwd })));
  run(["set-activity-log", "on"], { cwd });
  assert.equal(readState(cwd).activityLog.enabled, true);
  run(["set-activity-log", "off"], { cwd });
  assert.equal(readState(cwd).activityLog.enabled, false);

  // A state.json written before this capability existed loads unchanged and resolves to OFF —
  // which is the same answer the field's absence already gives. That is the whole reason this
  // needs no MIGRATIONS entry: nothing existing has to be TRANSFORMED to stay valid.
  const old = tmpRepo();
  run(["init"], { cwd: old });
  const s = readState(old);
  delete s.activityLog;
  writeState(old, s);
  run(["upgrade"], { cwd: old });
  assert.equal(readState(old).activityLog, undefined, "upgrade must not switch it on for anybody");
});

// ─────────────── the writer ───────────────

test("gh-111: one chokepoint records the transitions each question needs", () => {
  const cwd = loggingRepo();
  run(["update-epic", "e1", "--status", "active"], { cwd });
  run(["update-epic", "e1", "--lane", "superpowers"], { cwd });
  run(["claim", "e2", "--session", "worker"], { cwd });
  run(["unclaim", "e2", "--session", "worker"], { cwd });
  run(["add-epic", "--id", "e3", "--lane", "openspec"], { cwd });
  run(["remove-epic", "e3"], { cwd });

  const kinds = allEvents(cwd).map(e => e.kind);
  for (const k of ["epic-status", "epic-lane", "epic-claimed", "epic-released",
    "epic-created", "epic-removed", "active"]) {
    assert.ok(kinds.includes(k), `no ${k} event was recorded — the diff missed a transition`);
  }
  const status = allEvents(cwd).find(e => e.kind === "epic-status");
  assert.equal(status.from, "queued");
  assert.equal(status.to, "active");
  assert.equal(status.verb, "update-epic", "the verb that caused it is part of the record");
});

test("gh-111: the session identity on an event is the SAME resolver #84's claim uses", () => {
  const cwd = loggingRepo();
  run(["update-epic", "e1", "--status", "active"], { cwd, env: { PM_SESSION: "orchestrator" } });
  assert.equal(allEvents(cwd).at(-1).session, "orchestrator",
    "'who is doing this' and 'who did this' must not fork into two vocabularies");
});

test("gh-111: a read-only verb records nothing — no revision moved, so there is nothing to say", () => {
  const cwd = loggingRepo();
  const before = allEvents(cwd).length;
  run(["owners"], { cwd });
  run(["integrity"], { cwd });
  run(["brief"], { cwd });
  assert.equal(allEvents(cwd).length, before,
    "a line per read verb would drown the signal the log exists for");
});

// ─────────────── the section that makes it worth its cost ───────────────

test("gh-111: out-of-band is EMPTY across update-epic, which saves state TWICE", () => {
  // saveState() then render()'s save. An event carrying only the final revision would make every
  // intermediate one look like a hand-edit, and the flagship section would be pure noise. The
  // fromRevision/revision RANGE is what makes it a signal.
  const cwd = loggingRepo();
  for (let i = 0; i < 4; i++) run(["update-epic", "e1", "--notes", `n${i}`], { cwd });
  run(["update-epic", "e1", "--status", "active"], { cwd });
  run(["add-epic", "--id", "e4", "--lane", "claude-code"], { cwd });
  const j = JSON.parse(run(["activity", "--json"], { cwd }));
  assert.deepEqual(j.outOfBand.missing, [],
    `an engine write was misreported as out-of-band: ${JSON.stringify(j.outOfBand)}`);
  assert.equal(j.outOfBand.afterLast, 0);
  assert.ok(j.outOfBand.covered >= 6, "and the covered count must be real, not zero");
});

test("gh-111: a HAND-EDIT to state.json IS reported — #110, as a query instead of forensics", () => {
  const cwd = loggingRepo();
  run(["update-epic", "e1", "--status", "active"], { cwd });
  // Exactly what a hand-edit looks like from the engine's side: revisions the file reached that
  // no verb of this engine produced.
  const s = readState(cwd);
  s.revision = s.revision + 3;
  s.epics.find(e => e.id === "e1").priority = "P0";
  writeState(cwd, s);
  run(["update-epic", "e1", "--title", "after the edit"], { cwd });

  const j = JSON.parse(run(["activity", "--json"], { cwd }));
  assert.ok(j.outOfBand.missingCount >= 3,
    `three unaccounted revisions must be reported, got ${JSON.stringify(j.outOfBand)}`);
  assert.match(run(["activity"], { cwd }), /unaccounted for/);
});

test("gh-111: a pathological revision jump is COUNTED exactly and LISTED in bounded form", async () => {
  // The span between the log's earliest fromRevision and its latest revision is controlled by a
  // number a hand-edit can set. That makes this the one loop whose length untrusted input picks,
  // and `--json` would otherwise emit every element — a report about a pathological record must
  // not itself be pathological.
  const { buildReport, formatReport, OUT_OF_BAND_SAMPLE } = await import(AREPORT);
  const ev = (fromRevision, revision) => ({
    at: "2026-01-01T00:00:00.000Z", kind: "state-write", verb: "v", fromRevision, revision });
  const r = buildReport([ev(0, 1), ev(500_000, 500_001)]);
  assert.equal(r.outOfBand.missingCount, 499_999, "the COUNT must stay exact");
  assert.equal(r.outOfBand.missing.length, OUT_OF_BAND_SAMPLE, "the LIST must not");
  // Asserted through the SHIPPED formatter, never a copy of it in the test — a re-implementation
  // here would keep passing after the real one changed.
  const text = formatReport(r);
  assert.match(text, /499999 revision\(s\) INSIDE the logged window are unaccounted for/);
  assert.match(text, /, …/, "and it must say the list is a sample");
});

test("gh-111: revisions after the last recorded event are reported separately", () => {
  const cwd = loggingRepo();
  run(["update-epic", "e1", "--status", "active"], { cwd });
  run(["set-activity-log", "off"], { cwd });
  run(["update-epic", "e1", "--title", "written while blind"], { cwd });
  const j = JSON.parse(run(["activity", "--json"], { cwd }));
  assert.ok(j.outOfBand.afterLast >= 1,
    "a window during which logging was off is worth knowing and is not inferable from state.json");
  assert.equal(j.enabled, false);
});

// ─────────────── rotation, retention, scoping ───────────────

test("gh-111: a full segment rotates to a new one rather than growing past a readable size", async () => {
  const { appendEvents, activityDir } = await import(ALOG);
  const { ACTIVITY_SEGMENT_MAX_BYTES } =
    await import(new URL("../lib/constants.mjs", import.meta.url).href);
  const cwd = tmpRepo();
  const prev = process.env.CLAUDE_PROJECT_DIR;
  process.env.CLAUDE_PROJECT_DIR = cwd;
  try {
    appendEvents([{ at: new Date().toISOString(), kind: "state-write", verb: "x" }]);
    const first = fs.readdirSync(activityDir())[0];
    fs.writeFileSync(path.join(activityDir(), first), "x".repeat(ACTIVITY_SEGMENT_MAX_BYTES + 1));
    await new Promise(r => setTimeout(r, 5));
    appendEvents([{ at: new Date().toISOString(), kind: "state-write", verb: "y" }]);
    const names = fs.readdirSync(activityDir()).sort();
    assert.equal(names.length, 2, "the full segment must be closed, not appended to");
    assert.ok(names[1] > names[0], "ISO names must sort chronologically — retention depends on it");
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_PROJECT_DIR;
    else process.env.CLAUDE_PROJECT_DIR = prev;
  }
});

test("gh-111: retention prunes OLDEST first and never the last remaining segment", async () => {
  const { pruneToCap } = await import(ALOG);
  const dir = scratchDir("pm-seg-");
  const names = ["activity-2026-01-01T00-00-00-000Z.log", "activity-2026-02-01T00-00-00-000Z.log",
    "activity-2026-03-01T00-00-00-000Z.log"];
  for (const n of names) fs.writeFileSync(path.join(dir, n), "x".repeat(1000));
  assert.deepEqual(pruneToCap(dir, 2500), [names[0]], "the oldest goes first");
  // A cap below one segment must NOT empty the directory: it would delete the file about to be
  // written to, and the log would record nothing while reporting that retention worked.
  assert.deepEqual(pruneToCap(dir, 0), [names[1]]);
  assert.equal(fs.readdirSync(dir).length, 1);
});

test("gh-111: --since skips whole segments by NAME, and keeps the one straddling the boundary", async () => {
  const { readEvents } = await import(AREPORT);
  const dir = scratchDir("pm-seg2-");
  const write = (name, ats) => fs.writeFileSync(path.join(dir, name), ats.map(at =>
    JSON.stringify({ at, kind: "state-write", verb: "v", revision: 1, fromRevision: 0 })).join("\n") + "\n");
  write("activity-2026-01-01T00-00-00-000Z.log", ["2026-01-01T00:00:00.000Z", "2026-01-15T00:00:00.000Z"]);
  write("activity-2026-02-01T00-00-00-000Z.log", ["2026-02-01T00:00:00.000Z", "2026-02-20T00:00:00.000Z"]);
  write("activity-2026-03-01T00-00-00-000Z.log", ["2026-03-01T00:00:00.000Z"]);

  const all = readEvents({ dir });
  assert.equal(all.events.length, 5);
  assert.equal(all.segmentsRead, 3);

  const since = readEvents({ dir, since: "2026-02-10T00:00:00.000Z" });
  assert.equal(since.segmentsRead, 2,
    "the January segment is skipped without being opened — that is what timestamped names buy");
  assert.deepEqual(since.events.map(e => e.at),
    ["2026-02-20T00:00:00.000Z", "2026-03-01T00:00:00.000Z"],
    "and the segment STRADDLING the boundary must still be read, or the window is truncated");
});

test("gh-111: unparseable lines are skipped, COUNTED, and reported — not silently dropped", async () => {
  const { readEvents, buildReport, formatReport } = await import(AREPORT);
  const dir = scratchDir("pm-seg3-");
  fs.writeFileSync(path.join(dir, "activity-2026-01-01T00-00-00-000Z.log"),
    JSON.stringify({ at: "2026-01-01T00:00:00.000Z", kind: "state-write", verb: "v" }) + "\n" +
    "{ truncated mid-wri\n");
  const { events, malformed } = readEvents({ dir });
  assert.equal(events.length, 1, "a reader that refuses to read is worse than one that reads N-1");
  assert.equal(malformed, 1, "the count was once a property hung on the returned array, and lost");
  assert.match(formatReport(buildReport(events, { malformed })), /1 unparseable line\(s\)/);
});

test("gh-111: --epic scopes the report to one epic", () => {
  const cwd = loggingRepo();
  run(["update-epic", "e1", "--status", "active"], { cwd });
  run(["update-epic", "e2", "--status", "blocked"], { cwd });
  const j = JSON.parse(run(["activity", "--json", "--epic", "e1"], { cwd }));
  assert.ok(j.pickup.every(p => p.epic === "e1"));
  assert.ok(j.events > 0);
  assert.ok(expectFail(() => run(["activity", "--epic"], { cwd })), "--epic requires a value");
});

test("gh-111: activity refuses a flag it does not declare, instead of printing the report", () => {
  // MUTATION SURVIVOR (111-ii). `activity` had no allowlist at all while both its read-only
  // siblings did, so `activity --bogus` printed the whole report and exited 0 — a typo answering
  // a different question from the one asked. It compounds: `--since`/`--epic` are read through a
  // COMPUTED accessor (`f[name]`), which conductor-31's region scanner cannot see, so on this
  // verb the allowlist is the only thing between an undeclared flag and silence.
  const cwd = loggingRepo();
  const before = stateBytes(cwd);
  const err = expectFail(() => run(["activity", "--bogus"], { cwd }));
  assert.match(String(err.stderr || err.message), /unknown flag --bogus for activity/);
  assert.equal(stateBytes(cwd), before, "a refusal writes nothing");
  // …and the flags it DOES declare still work, so the allowlist is not simply refusing everything.
  run(["activity", "--json"], { cwd });
});

test("gh-111: --since scopes the report AT THE CLI, and a valueless or blank one is refused", () => {
  // MUTATION SURVIVOR (111-i). `--since` was covered only at `readEvents()`, so deleting its
  // `VERB_FLAGS` row killed no test: `--since` stays declared for `changelog`, which satisfies
  // conductor-31's GLOBAL "is this name declared anywhere" scan, and `activity` keeps its claim
  // through `--epic`/`--json`. The verb's own window would have stopped being value-checked with
  // the whole suite green. This exercises the flag through the CLI, which is the only place the
  // row is load-bearing.
  const cwd = loggingRepo();
  run(["update-epic", "e1", "--status", "active"], { cwd });
  const all = JSON.parse(run(["activity", "--json"], { cwd }));
  assert.ok(all.events > 0, "precondition: the log has something in it");
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const none = JSON.parse(run(["activity", "--json", "--since", future], { cwd }));
  assert.equal(none.events, 0, "a window that starts tomorrow holds nothing recorded today");

  for (const argv of [["activity", "--since"], ["activity", "--since", "   "]]) {
    const err = expectFail(() => run(argv, { cwd }));
    assert.match(String(err.stderr || err.message), /--since requires /,
      "a blank window is the same silent drop as a missing one, one step further on");
  }
});

// ─────────────── observability must never break the run it observes ───────────────

test("gh-111: an unwritable log directory does not fail the verb it is observing", () => {
  // The first version of this test chmod'd the DIRECTORY to r-x and proved nothing: a segment
  // already existed, and appending to an existing file needs permission on the FILE, not on its
  // directory — so nothing ever threw and the guard went unexercised. Found by mutation. Both
  // are locked here, and the file's read-only mode is what actually makes appendFileSync fail.
  const cwd = loggingRepo();
  run(["update-epic", "e1", "--priority", "P0"], { cwd });
  const segs = segmentFiles(cwd);
  assert.ok(segs.length, "precondition: a segment exists to be made unwritable");
  for (const n of segs) fs.chmodSync(path.join(activityDirOf(cwd), n), 0o400);
  fs.chmodSync(activityDirOf(cwd), 0o500);
  try {
    run(["update-epic", "e1", "--status", "active"], { cwd });
    assert.equal(readState(cwd).epics.find(e => e.id === "e1").status, "active",
      "the write the log exists to observe must still have landed");
  } finally {
    fs.chmodSync(activityDirOf(cwd), 0o700);
    for (const n of segs) fs.chmodSync(path.join(activityDirOf(cwd), n), 0o600);
  }
});

test("gh-111: an UNREADABLE state.json does not fail the verb either — the snapshot is guarded too", () => {
  // The chokepoint reads state BEFORE dispatch. A repo whose state.json cannot be parsed must
  // still be able to run `init`-adjacent recovery; a throw there would make the observer the
  // reason the repo is stuck.
  const cwd = loggingRepo();
  fs.writeFileSync(path.join(cwd, ".conductor", "state.json"), "{ not json at all");
  // loadState() falls back to defaultState() on unparseable input, so this exercises the path
  // rather than asserting a crash — the assertion is that the verb still completes.
  const out = runCombined(["owners"], { cwd });
  assert.match(out, /QUIESCENT|OWNERS/, `owners must still answer, got: ${out}`);
});

// ─────────────── purge-logs ───────────────

test("gh-111: purge-logs with no selector removes nothing and says why", () => {
  const cwd = loggingRepo();
  run(["update-epic", "e1", "--status", "active"], { cwd });
  const before = segmentFiles(cwd).length;
  assert.ok(before > 0, "precondition: something to purge");
  const err = expectFail(() => run(["purge-logs"], { cwd }));
  assert.ok(err, "\"purge the logs\" has no safe default reading");
  assert.match(String(err.stderr || err.message), /--keep|--over|--older-than/);
  assert.equal(segmentFiles(cwd).length, before);
});

test("gh-111: purge-logs prints the plan and removes nothing without --yes; --yes applies it", () => {
  const cwd = loggingRepo();
  run(["update-epic", "e1", "--status", "active"], { cwd });
  const before = segmentFiles(cwd).length;

  const plan = run(["purge-logs", "--kind", "activity", "--keep", "0"], { cwd });
  assert.match(plan, /would be removed/);
  assert.equal(segmentFiles(cwd).length, before, "a plan is not an action");

  const dry = run(["purge-logs", "--kind", "activity", "--keep", "0", "--dry-run", "--yes"], { cwd });
  assert.match(dry, /--dry-run: nothing was removed/, "--dry-run must outrank --yes, not race it");
  assert.equal(segmentFiles(cwd).length, before);

  const done = run(["purge-logs", "--kind", "activity", "--keep", "0", "--yes"], { cwd });
  assert.match(done, /REMOVED/);
  assert.equal(segmentFiles(cwd).length, 0);
});

test("gh-111: purge-logs selectors — keep, over and older-than, unioned", async () => {
  const { selectForRemoval, parseSize } = await import(PURGE);
  assert.equal(parseSize("1G"), 1024 ** 3);
  assert.equal(parseSize("500K"), 512_000);
  assert.equal(parseSize("nonsense"), null);

  const now = Date.parse("2026-06-01T00:00:00Z");
  const day = 86_400_000;
  // newest first, as candidates() returns them
  const files = [
    { path: "a", size: 100, time: now - 1 * day },
    { path: "b", size: 100, time: now - 30 * day },
    { path: "c", size: 100, time: now - 100 * day },
  ];
  assert.deepEqual(selectForRemoval(files, { keep: 1 }, now).map(f => f.path), ["b", "c"]);
  assert.deepEqual(selectForRemoval(files, { olderThanDays: 90 }, now).map(f => f.path), ["c"]);
  assert.deepEqual(selectForRemoval(files, { over: 150 }, now).map(f => f.path), ["b", "c"],
    "--over trims OLDEST first until the total fits");
  assert.deepEqual(selectForRemoval(files, { keep: 2, olderThanDays: 90 }, now).map(f => f.path), ["c"],
    "two selectors that name the same file must not double-count it");
  assert.deepEqual(selectForRemoval(files, {}, now), [], "no selector marks nothing");
});

test("gh-111: purge-logs reaches the other .conductor logs, and refuses an unknown kind", () => {
  const cwd = claimRepo();
  fs.writeFileSync(path.join(cwd, ".conductor", "write-conflicts.log"), "one\n");
  run(["log-detour", "a minimal fix"], { cwd });
  assert.ok(fs.existsSync(path.join(cwd, ".conductor", "detours.log")));

  assert.ok(expectFail(() => run(["purge-logs", "--kind", "nope", "--keep", "0"], { cwd })));
  run(["purge-logs", "--kind", "all", "--keep", "0", "--yes"], { cwd });
  assert.equal(fs.existsSync(path.join(cwd, ".conductor", "write-conflicts.log")), false);
  assert.equal(fs.existsSync(path.join(cwd, ".conductor", "detours.log")), false);
  assert.ok(fs.existsSync(path.join(cwd, ".conductor", "state.json")),
    "purge-logs touches LOGS — the record of record is not a log");
});

// ─────────────── gitignore, per #106 ───────────────

test("gh-111: .conductor/activity/ is git-ignored by init AND back-filled by upgrade", () => {
  const cwd = claimRepo();
  assert.match(fs.readFileSync(path.join(cwd, ".gitignore"), "utf8"), /\.conductor\/activity\//);
  const old = tmpRepo();
  run(["init"], { cwd: old });
  fs.writeFileSync(path.join(old, ".gitignore"), ".conductor/detours.log\n");
  run(["upgrade"], { cwd: old });
  assert.match(fs.readFileSync(path.join(old, ".gitignore"), "utf8"), /\.conductor\/activity\//);
});

// ─────────────── the diff, as a pure function ───────────────

test("gh-111: diffEvents reports detour push/pop and a gate verdict", async () => {
  const { diffEvents } = await import(ALOG);
  const epic = (over = {}) => ({ id: "e1", status: "active", lane: "openspec", ...over });
  const push = diffEvents(
    { revision: 1, epics: [epic()], detourStack: [] },
    { revision: 2, epics: [epic()], detourStack: [{ epic: "e1", reason: "blocked" }] },
    { verb: "update-epic", at: "2026-01-01T00:00:00.000Z" });
  assert.equal(push.find(e => e.kind === "detour-push").epic, "e1");

  const pop = diffEvents(
    { revision: 2, epics: [epic()], detourStack: [{ epic: "e1" }] },
    { revision: 3, epics: [epic()], detourStack: [] }, { verb: "resume" });
  assert.equal(pop.find(e => e.kind === "detour-pop").epic, "e1");

  const gate = diffEvents(
    { revision: 3, epics: [epic()], detourStack: [] },
    { revision: 4, epics: [epic({ gateReview: { gate2: { verdict: "pass" } } })], detourStack: [] },
    { verb: "record-gate-review" });
  const g = gate.find(e => e.kind === "gate-review");
  assert.equal(g.gate, "gate2");
  assert.equal(g.verdict, "pass");

  // A write that changed nothing interesting still leaves a line, or its revision would read as
  // a hand-edit later.
  const quiet = diffEvents(
    { revision: 4, epics: [epic()], detourStack: [] },
    { revision: 5, epics: [epic({ title: "renamed" })], detourStack: [] }, { verb: "update-epic" });
  assert.deepEqual(quiet.map(e => e.kind), ["state-write"]);
  assert.equal(quiet[0].fromRevision, 4);
  assert.equal(quiet[0].revision, 5);
});
