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
