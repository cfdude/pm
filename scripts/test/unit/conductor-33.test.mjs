// scripts/test/unit/conductor-33.test.mjs
// 4.1's migration of `assert/conductor-33.test.mjs` — the VALUE-OBSERVING tests of gh-84/gh-111,
// moved from the file rung to the unit rung with every assertion unchanged.
//
// THE FILE SPLIT, AND WHY THAT IS THE HONEST SHAPE RATHER THAN A HALF-MOVE. The subject is the
// advisory claim (gh-84) and the optional activity log with its reader (gh-111), and those two
// halves disagree about what they observe. "Is this repo quiescent", "whose claim is this", "what
// did the log record" are all questions about VALUES, and every one of them is answerable through
// the store: `state.json` via `record()`/`writeRecord()`, the `session-claim.json` sidecar, and the
// `activity/<segment>` artifacts via `list()`/`read()`. What is NOT answerable through the store,
// and therefore stays on the file rung in `assert/conductor-33.test.mjs`:
//
//   * `.gitignore` — a repository file design D1 explicitly does not put in the store;
//   * the conflict-injection seam and an `fs.chmod` on the log directory — the disk store's
//     locking and the OS's permissions are the subject;
//   * an unreadable `state.json` written as RAW BYTES (the memory store holds a record, not bytes);
//   * `readEvents({ dir })` and `purge-logs`' candidate enumeration, which are given a DIRECTORY and
//     read it — a path is their subject, not a convenience;
//   * `PROJECT.md`'s mtime, which is a filesystem property of a file the store owns.
//
// WHAT MOVED, AND WHAT DID NOT. Nothing here changed except the mechanism its values arrive through:
//
//   `tmpRepo()` + `run(["init"], { cwd })`  →  `memoryEngine(emptyRecord())` (the seed IS the
//                                              initialised record; `init` has nothing to add)
//   `run(args, { cwd })`                    →  `engine(args)`
//   `run(args, { cwd, env })`               →  `engine(args, { env })`
//   `runCombined(args, { cwd })`            →  `engine.combined(args)`
//   `readState(cwd)`                        →  `engine.store.record()`
//   `writeState(cwd, s)`                    →  `mutateRecord(engine, …)` — see the helper below
//   `fs.readFileSync(markerPath(cwd))`      →  `engine.store.read("session-claim.json").text`
//   `fs.existsSync(markerPath(cwd))`        →  `engine.store.exists("session-claim.json")`
//   `fs.writeFileSync(markerPath(cwd), …)`  →  `engine.store.write("session-claim.json", …)`
//   `segmentFiles(cwd)` + a read of each   →  `engine.store.list("activity/")` + `store.read(…)`
//
// THE STORE ACCESSOR IS `engine.store`, NOT A MODULE IMPORT, because that is what the seam is for:
// the values come from the sink the invocation was handed, so a verb that stopped writing one of
// these artifacts would fail here rather than in a report nobody runs.
//
// THE SUBJECT IS UNCHANGED (gh-84/gh-111, see the file rung's header for the full statement): the
// advisory claim's refusals AND its non-refusals, the repo-level quiescence marker, `owners`,
// `integrity`'s stale-claim check, and the activity log's writer, reader and diff.

import assert from "node:assert/strict";
import { emptyRecord, expectFail, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

const ALOG = new URL("../../lib/activity-log.mjs", import.meta.url).href;
const AREPORT = new URL("../../lib/activity-report.mjs", import.meta.url).href;
const PURGE = new URL("../../lib/purge-logs.mjs", import.meta.url).href;

/** A repo with two claimable epics. The file rung's `init` + two `add-epic` calls; the seed is the
 *  initialised record, so only the epics have to be made. */
function claimRepo() {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "e1", "--lane", "claude-code", "--title", "one"]);
  engine(["add-epic", "--id", "e2", "--lane", "claude-code", "--title", "two"]);
  return engine;
}

/** The record's bytes, as the disk store would have written them. */
const stateBytes = (engine) => engine.store.read("state.json").text;
const readState = (engine) => engine.store.record();
const claimOf = (engine, id) => readState(engine).epics.find(e => e.id === id).claim;

/** The file rung's `writeState(cwd, s)`, spelled for a test that MANUFACTURES a record — an expired
 *  claim, an unreadable TTL, a revision no verb produced.
 *
 *  THE TWO RUNGS DIFFER HERE AND THE DIFFERENCE IS LOAD-BEARING. On disk, `readState()` hands back a
 *  parsed copy and the test has to write it back. The memory store hands back THE RECORD IT HOLDS,
 *  so the mutation IS the write — and `writeRecord()` is NOT the equivalent of `writeState()`: it
 *  refuses a revision the store did not expect, which is exactly the guard the hand-edit test below
 *  observes. A test that manufactured a record through `writeRecord()` would be testing the guard
 *  instead of the thing it means to manufacture. */
function mutateRecord(engine, edit) {
  edit(engine.store.record());
}

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

unitTest("gh-84: claim writes {session, claimedAt, ttlMinutes} on the epic", () => {
  const engine = claimRepo();
  engine(["claim", "e1", "--session", "orchestrator"]);
  const c = claimOf(engine, "e1");
  assert.equal(c.session, "orchestrator");
  assert.equal(c.ttlMinutes, 120, "the epic default, from constants.mjs");
  assert.ok(Date.parse(c.claimedAt) > 0, "claimedAt must be a real timestamp");
  assert.equal(c.heartbeatAt, undefined,
    "no heartbeat field: a heartbeat nothing beats is claimedAt in a costume, and it would make " +
    "the staleness threshold wrong in both directions");
});

unitTest("gh-84: --ttl is recorded ON the claim, so a later default change cannot reinterpret it", () => {
  const engine = claimRepo();
  engine(["claim", "e1", "--session", "s1", "--ttl", "5"]);
  assert.equal(claimOf(engine, "e1").ttlMinutes, 5);
});

unitTest("gh-84: a non-numeric or non-positive --ttl is refused rather than silently defaulted", () => {
  const engine = claimRepo();
  const before = stateBytes(engine);
  for (const bad of ["abc", "0", "-3"]) {
    const err = expectFail(() => engine(["claim", "e1", "--session", "s1", "--ttl", bad]));
    assert.ok(err, `--ttl ${bad} must be refused — a silent fallback records a lifetime nobody asked for`);
  }
  assert.equal(stateBytes(engine), before, "not one refusal may leave a write behind");
});

unitTest("gh-84: PM_SESSION supplies the identity, and an explicit --session outranks it", () => {
  const engine = claimRepo();
  engine(["claim", "e1"], { env: { PM_SESSION: "from-env" } });
  assert.equal(claimOf(engine, "e1").session, "from-env");

  engine(["claim", "e2", "--session", "from-flag"], { env: { PM_SESSION: "from-env" } });
  assert.equal(claimOf(engine, "e2").session, "from-flag",
    "an orchestrator must be able to act AS a named identity without exporting a variable every " +
    "child process then inherits");
});

unitTest("gh-84: with no identity at all, claim refuses and names both ways to give one", () => {
  const engine = claimRepo();
  const before = stateBytes(engine);
  const err = expectFail(() => engine(["claim", "e1"], { env: { PM_SESSION: "" } }));
  assert.ok(err);
  assert.match(String(err.stderr || err.message), /--session/);
  assert.match(String(err.stderr || err.message), /PM_SESSION/);
  assert.equal(stateBytes(engine), before);
});

// ═══════════════ the ONE surface that refuses ═══════════════

unitTest("gh-84: a second session's claim over a LIVE claim is refused, names the holder, writes nothing", () => {
  const engine = claimRepo();
  engine(["claim", "e1", "--session", "alpha"]);
  const before = stateBytes(engine);

  const err = expectFail(() => engine(["claim", "e1", "--session", "beta"]));
  assert.ok(err, "the second claim must exit non-zero");
  const msg = String(err.stderr || err.message);
  assert.match(msg, /alpha/, "the refusal must name WHO holds it");
  assert.match(msg, /--steal/, "and how to take it deliberately");
  assert.equal(stateBytes(engine), before,
    "'two sessions both claim' must have no silent-corruption reading — it is not a write at all");
  assert.equal(claimOf(engine, "e1").session, "alpha");
});

unitTest("gh-84: re-claiming as the SAME session succeeds and extends the TTL — that is the heartbeat", async () => {
  const engine = claimRepo();
  engine(["claim", "e1", "--session", "alpha", "--ttl", "60"]);
  const first = claimOf(engine, "e1").claimedAt;
  await new Promise(r => setTimeout(r, 1100));
  engine(["claim", "e1", "--session", "alpha", "--ttl", "90"]);
  const second = claimOf(engine, "e1");
  assert.ok(Date.parse(second.claimedAt) > Date.parse(first), "claimedAt must move forward");
  assert.equal(second.ttlMinutes, 90);
});

unitTest("gh-84: claiming over an EXPIRED claim succeeds without --steal and REPORTS the takeover", () => {
  const engine = claimRepo();
  mutateRecord(engine, s => { s.epics.find(e => e.id === "e1").claim = agedClaim("dead-session", 200, 120); });

  const out = engine.combined(["claim", "e1", "--session", "beta"]);
  assert.equal(claimOf(engine, "e1").session, "beta");
  assert.match(out, /dead-session/, "a takeover must say whose claim it stepped over");
  assert.match(out, /expired/i);
  assert.doesNotMatch(out, /STOLEN/, "an expired takeover is ordinary, not a steal");
});

unitTest("gh-84: --steal overrides a LIVE claim and says so", () => {
  const engine = claimRepo();
  engine(["claim", "e1", "--session", "alpha"]);
  const out = engine.combined(["claim", "e1", "--session", "beta", "--steal"]);
  assert.equal(claimOf(engine, "e1").session, "beta");
  assert.match(out, /STOLEN/, "stealing a live claim must be visibly different from taking an expired one");
  assert.match(out, /alpha/);
});

unitTest("gh-84: an ARCHIVED epic cannot be claimed", () => {
  const engine = claimRepo();
  engine(["update-epic", "e1", "--status", "archived", "--outcome", "delivered", "--no-deferrals"]);
  const before = stateBytes(engine);
  const err = expectFail(() => engine(["claim", "e1", "--session", "alpha"]));
  assert.ok(err);
  assert.match(String(err.stderr || err.message), /archived/);
  assert.equal(stateBytes(engine), before);
});

unitTest("gh-84: claiming an epic that does not exist is refused", () => {
  const engine = claimRepo();
  const before = stateBytes(engine);
  assert.ok(expectFail(() => engine(["claim", "nope", "--session", "alpha"])));
  assert.equal(stateBytes(engine), before);
});

// ═══════════════ what stays ADVISORY ═══════════════

unitTest("gh-84: a claim held by ANOTHER session blocks no other verb — that is what advisory means", () => {
  const engine = claimRepo();
  engine(["claim", "e1", "--session", "alpha"]);
  // Every one of these is a write to the claimed epic, from a process that is not the holder.
  engine(["update-epic", "e1", "--title", "renamed by someone else"]);
  // `reorder <id> <id>`: it has no `--before`. This line used to pass one, which reorder never
  // read and silently dropped — the command line check (verb-surface) now refuses it by name.
  engine(["reorder", "e1", "e2"]);
  engine(["update-epic", "e1", "--priority", "P0"]);
  engine(["set-active", "e1"]);
  engine(["update-epic", "e1", "--add-story", "written by a stranger"]);
  const e1 = readState(engine).epics.find(e => e.id === "e1");
  assert.equal(e1.title, "renamed by someone else",
    "#84 is explicit: make coordination expressible, do NOT make pm refuse to work");
  assert.equal(e1.claim.session, "alpha", "and the claim survives all of it untouched");
});

// ═══════════════ unclaim ═══════════════

unitTest("gh-84: unclaim clears the claim for its holder", () => {
  const engine = claimRepo();
  engine(["claim", "e1", "--session", "alpha"]);
  engine(["unclaim", "e1", "--session", "alpha"]);
  assert.equal(claimOf(engine, "e1"), undefined);
});

unitTest("gh-84: unclaiming a LIVE claim you do not hold is refused — that is the move that makes the marker a lie", () => {
  const engine = claimRepo();
  engine(["claim", "e1", "--session", "alpha"]);
  const before = stateBytes(engine);
  const err = expectFail(() => engine(["unclaim", "e1", "--session", "beta"]));
  assert.ok(err);
  assert.match(String(err.stderr || err.message), /alpha/);
  assert.equal(stateBytes(engine), before, "the holder must not lose its claim to someone else's cleanup");

  const out = engine.combined(["unclaim", "e1", "--session", "beta", "--steal"]);
  assert.equal(claimOf(engine, "e1"), undefined);
  assert.match(out, /alpha/, "and the override must say whose claim it cleared");
});

unitTest("gh-84: unclaiming something that is not claimed is a no-op that exits 0", () => {
  const engine = claimRepo();
  const before = stateBytes(engine);
  const out = engine.combined(["unclaim", "e1", "--session", "alpha"]);
  assert.match(out, /not claimed/);
  assert.equal(stateBytes(engine), before,
    "a cleanup path that fails when there is nothing to clean up is a cleanup path people stop running");
});

unitTest("gh-84: archiving an epic CLEARS its claim and says so — an ended epic cannot still be owned", () => {
  const engine = claimRepo();
  engine(["claim", "e1", "--session", "alpha"]);
  const out = engine.combined(
    ["update-epic", "e1", "--status", "archived", "--outcome", "delivered", "--no-deferrals"]);
  assert.equal(claimOf(engine, "e1"), undefined);
  assert.match(out, /alpha/, "clearing someone's claim must be announced, not silent");
  // CLEARED, not REFUSED: refusing to archive over an advisory marker is pm refusing to work.
  assert.equal(readState(engine).epics.find(e => e.id === "e1").status, "archived");
});

unitTest("gh-84: remove-epic takes the claim with it — no dangling owner record", () => {
  const engine = claimRepo();
  engine(["claim", "e1", "--session", "alpha"]);
  engine(["remove-epic", "e1"]);
  assert.equal(readState(engine).epics.some(e => e.id === "e1"), false);
  const out = engine(["owners"]);
  assert.match(out, /QUIESCENT/, "owners must not report ownership of an epic that is gone");
});

// ═══════════════ the repo-level quiescence marker ═══════════════

unitTest("gh-84: claim --repo writes a SIDECAR, never state.json", () => {
  const engine = claimRepo();
  const before = stateBytes(engine);
  engine(["claim", "--repo", "--session", "alpha"]);
  assert.ok(engine.store.exists("session-claim.json"));
  assert.equal(stateBytes(engine), before,
    "the marker answers 'is it safe to write to state.json' — putting it inside state.json, " +
    "where setting and clearing it bump revision and can themselves conflict, inverts its purpose");
  const m = JSON.parse(engine.store.read("session-claim.json").text);
  assert.equal(m.session, "alpha");
  assert.equal(m.ttlMinutes, 30, "shorter than an epic claim: a crashed session must not hold it for hours");
});

unitTest("gh-84: a second session's claim --repo over a LIVE marker is refused — the same rule as an epic", () => {
  // Found by mutation: deleting the repo branch's holder check left every other test green,
  // because only `unclaim --repo` was defended. A guard at one call site with its identical
  // sibling untouched is the dominant defect class this repository audits for, and the two
  // branches sit four lines apart in one function.
  const engine = claimRepo();
  engine(["claim", "--repo", "--session", "alpha"]);
  const before = engine.store.read("session-claim.json").text;

  const err = expectFail(() => engine(["claim", "--repo", "--session", "beta"]));
  assert.ok(err, "the second repo claim must exit non-zero");
  assert.match(String(err.stderr || err.message), /alpha/);
  assert.equal(engine.store.read("session-claim.json").text, before, "and must write nothing");

  const out = engine.combined(["claim", "--repo", "--session", "beta", "--steal"]);
  assert.equal(JSON.parse(engine.store.read("session-claim.json").text).session, "beta");
  assert.match(out, /STOLEN/);
});

unitTest("gh-84: claim --repo over an EXPIRED marker succeeds without --steal", () => {
  const engine = claimRepo();
  engine.store.write("session-claim.json", JSON.stringify(agedClaim("dead-orchestrator", 90, 30)));
  const out = engine.combined(["claim", "--repo", "--session", "beta"]);
  assert.equal(JSON.parse(engine.store.read("session-claim.json").text).session, "beta");
  assert.match(out, /expired/i);
  assert.doesNotMatch(out, /STOLEN/);
});

unitTest("gh-84: unclaim --repo removes the sidecar; a live one is defended, an absent one is a no-op", () => {
  const engine = claimRepo();
  const out0 = engine.combined(["unclaim", "--repo", "--session", "alpha"]);
  assert.match(out0, /not set/);

  engine(["claim", "--repo", "--session", "alpha"]);
  assert.ok(expectFail(() => engine(["unclaim", "--repo", "--session", "beta"])));
  assert.ok(engine.store.exists("session-claim.json"), "a live marker must survive someone else's cleanup");

  engine(["unclaim", "--repo", "--session", "alpha"]);
  assert.equal(engine.store.exists("session-claim.json"), false);
});

unitTest("gh-84: a corrupt or unreadable marker reads as EXPIRED, never as live", () => {
  // Chosen direction, not incidental: a marker that read as live when unreadable would block
  // every other session forever with no way to reason about when it stops — "worse than none".
  const engine = claimRepo();
  engine.store.write("session-claim.json", "{ not json");
  engine(["claim", "--repo", "--session", "beta"]);
  assert.equal(JSON.parse(engine.store.read("session-claim.json").text).session, "beta");

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
    engine.store.write("session-claim.json", JSON.stringify(zombie));
    engine(["claim", "--repo", "--session", "gamma"]);
    assert.equal(JSON.parse(engine.store.read("session-claim.json").text).session, "gamma",
      `an unreadable marker (${JSON.stringify(zombie)}) must never read as live`);
  }
});

unitTest("gh-84: an epic claim with an unreadable TTL is STALE to owners and to integrity, not live", () => {
  // The same mutant, at the two READING surfaces rather than at the claim verb. Without this,
  // `claimExpiry` could return an effectively infinite date for an unusable ttl and both
  // reports would show permanent live ownership.
  const engine = claimRepo();
  mutateRecord(engine, s => {
    s.epics.find(e => e.id === "e1").claim =
      { session: "zombie", claimedAt: new Date().toISOString(), ttlMinutes: "forever" };
  });
  assert.match(engine(["owners"]), /`e1` — STALE by 'zombie'/);
  assert.match(engine(["integrity"]), /advisory-claim-shape — 1 finding/);
});

// ═══════════════ owners ═══════════════

unitTest("gh-84: owners reports the repo marker and every epic claim, HELD vs STALE", () => {
  const engine = claimRepo();
  engine(["claim", "--repo", "--session", "orchestrator"]);
  engine(["claim", "e1", "--session", "worker-a"]);
  mutateRecord(engine, s => { s.epics.find(e => e.id === "e2").claim = agedClaim("worker-b", 300, 120); });

  const out = engine(["owners"]);
  assert.match(out, /repository: BUSY/);
  assert.match(out, /orchestrator/);
  assert.match(out, /`e1` — HELD by 'worker-a'/);
  assert.match(out, /`e2` — STALE by 'worker-b'/);
  assert.match(out, /1 stale marker/, "a stale claim is how a session that died mid-epic looks");
});

unitTest("gh-84: owners says QUIESCENT, and says what quiescent does NOT mean", () => {
  const engine = claimRepo();
  const out = engine(["owners"]);
  assert.match(out, /QUIESCENT/);
  assert.match(out, /not a lock/,
    "a signal presented as a guarantee is the 'looks like coordination' failure this feature must avoid");
});

unitTest("gh-84: owners --json is machine-readable for an orchestrator", () => {
  const engine = claimRepo();
  engine(["claim", "e1", "--session", "worker-a"]);
  const j = JSON.parse(engine(["owners", "--json"]));
  assert.equal(j.quiescent, false);
  assert.equal(j.claims.length, 1);
  assert.equal(j.claims[0].scope, "epic");
  assert.equal(j.claims[0].live, true);

  const clean = JSON.parse(claimRepo()(["owners", "--json"]));
  assert.equal(clean.quiescent, true);
  assert.deepEqual(clean.claims, []);
});

unitTest("gh-84/gh-111: EVERY verb with an allowlist refuses an undeclared flag, by name", () => {
  // MUTATION SURVIVORS (84-ii, 111-iii). `owners` and `activity` each got a test of their own
  // above, and deleting the check on `claim`, `unclaim` or `purge-logs` still killed nothing —
  // the shape this repository's own audit calls the dominant defect class: a guard covered at one
  // call site while its identical siblings go unexercised. The five are swept together HERE so
  // that adding a sixth verb with an allowlist and forgetting its case is a visible omission in
  // one list rather than a test nobody wrote.
  const engine = claimRepo();
  const before = stateBytes(engine);
  for (const argv of [
    ["claim", "e1", "--session", "s", "--bogus"],
    ["unclaim", "e1", "--session", "s", "--bogus"],
    ["owners", "--bogus"],
    ["activity", "--bogus"],
    ["purge-logs", "--keep", "5", "--bogus"],
  ]) {
    const err = expectFail(() => engine(argv));
    assert.match(String(err.stderr || err.message),
      new RegExp(`unknown flag --bogus for ${argv[0]}`),
      `\`${argv.join(" ")}\` must be refused by name, not silently ignored`);
  }
  assert.equal(stateBytes(engine), before, "not one refusal may leave a write behind");
});

unitTest("gh-84: owners refuses a flag it does not declare, instead of ignoring it", () => {
  // MUTATION SURVIVOR (84-i). `owners` read `--json` off `process.argv` and had no allowlist at
  // all, so `owners --jsno` printed the human report and exited 0 — a typo silently answering a
  // different question from the one asked, on the verb an orchestrator uses to decide whether it
  // is safe to write. The allowlist is `flagsFor("owners")`, so it follows the registry rather
  // than a literal, and deleting the check leaves nothing else to notice.
  const engine = claimRepo();
  const before = stateBytes(engine);
  const err = expectFail(() => engine(["owners", "--jsno"]));
  assert.match(String(err.stderr || err.message), /unknown flag --jsno for owners/);
  assert.equal(stateBytes(engine), before, "a refusal writes nothing");
});

// ═══════════════ integrity: the surface that finds a stale claim unasked ═══════════════

unitTest("gh-84: integrity reports an EXPIRED claim and an archived epic that still holds one", () => {
  const engine = claimRepo();
  mutateRecord(engine, s => {
    s.epics.find(e => e.id === "e1").claim = agedClaim("dead", 300, 120);
    const e2 = s.epics.find(e => e.id === "e2");
    e2.status = "archived";
    e2.claim = agedClaim("ghost", 1, 120);   // LIVE, on an epic that has ended
    e2.disposition = { outcome: "delivered", recordedBy: "agent", at: new Date().toISOString() };
  });

  const out = engine(["integrity"]);
  assert.match(out, /advisory-claim-shape — 2 finding/);
  assert.match(out, /`e1` — claim by session 'dead' expired/);
  assert.match(out, /`e2` — archived, and still holding a claim by session 'ghost'/);
});

unitTest("gh-84: a clean repo's advisory-claim check RAN and found nothing — silence and absence differ", () => {
  const engine = claimRepo();
  engine(["claim", "e1", "--session", "alpha"]);
  assert.match(engine(["integrity"]), /advisory-claim-shape — 0 finding/);
});

// ══════════════════════════════════════════════════════════════════════════════════════════
// gh-111 — the optional activity log, and the reader that ships with it.
//
// The condition this feature had to meet is in the issue's own words: "If the reader is not in
// the same release, this feature should not ship." So the tests below are weighted accordingly —
// the writer's correctness matters, but the ones that decide whether the feature earns its cost
// are the reader's: does `--since` actually scope, and does the out-of-band count mean anything.
//
// THE READER'S DIRECTORY-READING TESTS STAY ON THE FILE RUNG. `readEvents({ dir })` and `purge-
// logs`' candidate enumeration are handed a DIRECTORY and read it — the path is the subject, not a
// mechanism — so their tests are in `assert/conductor-33.test.mjs` and this file keeps the ones
// whose observable is a value or a store-owned artifact.
// ══════════════════════════════════════════════════════════════════════════════════════════

/** The activity segments the store holds, in name order. */
const segmentNames = (engine) => engine.store.list("activity/");
const allEvents = (engine) => segmentNames(engine)
  .flatMap(n => engine.store.read(`activity/${n}`).text.split("\n"))
  .filter(Boolean).map(l => JSON.parse(l));

function loggingRepo() {
  const engine = claimRepo();
  engine(["set-activity-log", "on"]);
  return engine;
}

// ─────────────── off by default, and off costs nothing ───────────────

unitTest("gh-111: set-activity-log needs on|off, and is an added optional field — no migration", () => {
  const engine = claimRepo();
  assert.ok(expectFail(() => engine(["set-activity-log"])));
  assert.ok(expectFail(() => engine(["set-activity-log", "maybe"])));
  engine(["set-activity-log", "on"]);
  assert.equal(readState(engine).activityLog.enabled, true);
  engine(["set-activity-log", "off"]);
  assert.equal(readState(engine).activityLog.enabled, false);

  // A state.json written before this capability existed loads unchanged and resolves to OFF —
  // which is the same answer the field's absence already gives. That is the whole reason this
  // needs no MIGRATIONS entry: nothing existing has to be TRANSFORMED to stay valid.
  //
  // THE UPGRADE HALF OF THIS TEST STAYS ON THE FILE RUNG: `upgrade` back-fills `.gitignore`, which
  // is a repository file the store does not own, so its invocation writes a path.
  const fresh = memoryEngine(emptyRecord());
  assert.equal(readState(fresh).activityLog, undefined,
    "an absent field must resolve to OFF, not to a default that switches logging on");
});

// ─────────────── the writer ───────────────

unitTest("gh-111: one chokepoint records the transitions each question needs", () => {
  const engine = loggingRepo();
  engine(["update-epic", "e1", "--status", "active"]);
  engine(["update-epic", "e1", "--lane", "superpowers"]);
  engine(["claim", "e2", "--session", "worker"]);
  engine(["unclaim", "e2", "--session", "worker"]);
  engine(["add-epic", "--id", "e3", "--lane", "openspec"]);
  engine(["remove-epic", "e3"]);

  const kinds = allEvents(engine).map(e => e.kind);
  for (const k of ["epic-status", "epic-lane", "epic-claimed", "epic-released",
    "epic-created", "epic-removed", "active"]) {
    assert.ok(kinds.includes(k), `no ${k} event was recorded — the diff missed a transition`);
  }
  const status = allEvents(engine).find(e => e.kind === "epic-status");
  assert.equal(status.from, "queued");
  assert.equal(status.to, "active");
  assert.equal(status.verb, "update-epic", "the verb that caused it is part of the record");
});

unitTest("gh-111: the session identity on an event is the SAME resolver #84's claim uses", () => {
  const engine = loggingRepo();
  engine(["update-epic", "e1", "--status", "active"], { env: { PM_SESSION: "orchestrator" } });
  assert.equal(allEvents(engine).at(-1).session, "orchestrator",
    "'who is doing this' and 'who did this' must not fork into two vocabularies");
});

unitTest("gh-111: a read-only verb records nothing — no revision moved, so there is nothing to say", () => {
  const engine = loggingRepo();
  const before = allEvents(engine).length;
  engine(["owners"]);
  engine(["integrity"]);
  engine(["brief"]);
  assert.equal(allEvents(engine).length, before,
    "a line per read verb would drown the signal the log exists for");
});

// ─────────────── the section that makes it worth its cost ───────────────

unitTest("gh-111: a pathological revision jump is COUNTED exactly and LISTED in bounded form", async () => {
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

// ─────────────── the round-trip `--since` rests on ───────────────

unitTest("gh-111: segmentStart(segmentName(d)) round-trips exactly — --since is decoration without it", async () => {
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

// ─────────────── scoping ───────────────

unitTest("gh-111: activity refuses a flag it does not declare, instead of printing the report", () => {
  // MUTATION SURVIVOR (111-ii). `activity` had no allowlist at all while both its read-only
  // siblings did, so `activity --bogus` printed the whole report and exited 0 — a typo answering
  // a different question from the one asked. It compounds: `--since`/`--epic` are read through a
  // COMPUTED accessor (`f[name]`), which conductor-31's region scanner cannot see, so on this
  // verb the allowlist is the only thing between an undeclared flag and silence.
  const engine = loggingRepo();
  const before = stateBytes(engine);
  const err = expectFail(() => engine(["activity", "--bogus"]));
  assert.match(String(err.stderr || err.message), /unknown flag --bogus for activity/);
  assert.equal(stateBytes(engine), before, "a refusal writes nothing");
  // …and the flags it DOES declare still work, so the allowlist is not simply refusing everything.
  engine(["activity", "--json"]);
});

// ─────────────── purge-logs' selector POLICY, which reads nothing ───────────────

unitTest("gh-111: purge-logs selectors — keep, over and older-than, unioned", async () => {
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

// ─────────────── the diff, as a pure function ───────────────

unitTest("activity-log-detour-events-lose-epic: detour events name the paused epic, from frames push-detour really writes", async () => {
  // The test this replaces built its frame by hand as `{ epic: "e1" }` — a shape no verb writes —
  // so it passed while every real detour event carried `epic: null`. The frames here come from the
  // verbs themselves, so a reader keyed on the wrong field fails here rather than in a report.
  const { buildReport } = await import(AREPORT);
  const engine = loggingRepo();
  engine(["add-epic", "--id", "d1", "--lane", "claude-code", "--title", "detour"]);
  engine(["update-epic", "e1", "--status", "active"]);
  engine(["push-detour", "e1", "--detour", "d1", "--reason", "blocked", "--no-reconcile"]);
  engine(["pop-detour", "e1"]);
  engine(["push-detour", "e1", "--detour", "d1", "--reason", "blocked again", "--no-reconcile"]);

  const detourEvents = allEvents(engine).filter(e => e.kind.startsWith("detour-"));
  assert.deepEqual(detourEvents.map(e => [e.kind, e.verb, e.epic, e.detour, e.depth]), [
    ["detour-push", "push-detour", "e1", "d1", 1],
    ["detour-pop", "pop-detour", "e1", "d1", 0],
    ["detour-push", "push-detour", "e1", "d1", 1],
  ]);
  // EXACT, not non-empty: e1 was interrupted twice. Counting the pop too reads 4, and a test that
  // only checked byEpic was populated would pass that double count.
  assert.deepEqual(buildReport(allEvents(engine)).detours.byEpic, { e1: 2 });
});

unitTest("activity-log-detour-events-lose-epic: a BURIED drop is a detour-drop naming the dropped frame, not a pop of the top", async () => {
  // drop-detour ENDS a pause; pop-detour RESUMES one. A depth comparison logged the drop as
  // `detour-pop` and named the TOP frame (e2 here), which is not the frame that left.
  const { buildReport, formatReport } = await import(AREPORT);
  const engine = loggingRepo();
  engine(["add-epic", "--id", "e3", "--lane", "claude-code", "--title", "three"]);
  engine(["update-epic", "e1", "--status", "active"]);
  engine(["push-detour", "e1", "--detour", "e2", "--reason", "blocked", "--no-reconcile"]);
  engine(["push-detour", "e2", "--detour", "e3", "--reason", "blocked too", "--no-reconcile"]);
  const before = allEvents(engine).length;
  engine(["drop-detour", "e1", "--reason", "not coming back"]);

  const dropEvents = allEvents(engine).slice(before).filter(e => e.kind.startsWith("detour-"));
  assert.deepEqual(dropEvents.map(e => [e.kind, e.verb, e.epic, e.detour, e.depth]), [
    ["detour-drop", "drop-detour", "e1", "e2", 1],
  ]);
  const r = buildReport(allEvents(engine));
  assert.deepEqual([r.detours.push, r.detours.pop, r.detours.drop, r.detours.removed], [2, 0, 1, 0]);
  assert.deepEqual(r.detours.byEpic, { e1: 1, e2: 1 }, "a drop is not an interruption");
  assert.match(formatReport(r), /2 push\(es\), 0 pop\(s\), 1 drop\(s\)/);
  assert.doesNotMatch(formatReport(r), /removed by another verb/, "the fallback line prints only when non-zero");
});

unitTest("activity-log-detour-events-lose-epic: a frame removed by any other verb is detour-removed, never guessed", async () => {
  // Only pop-detour and drop-detour remove frames today. A verb added later that removes one is
  // still RECORDED by the diff, under a name that does not claim to know which of the two it was.
  const { diffEvents } = await import(ALOG);
  const { buildReport, formatReport } = await import(AREPORT);
  const frame = { pausedEpic: "e1", pausedAt: "2026-01-01T00:00:00.000Z", spawnedDetour: "d1" };
  const ev = diffEvents({ revision: 1, epics: [], detourStack: [frame] },
    { revision: 2, epics: [], detourStack: [] }, { verb: "some-future-verb" });
  assert.deepEqual(ev.map(e => [e.kind, e.epic]), [["detour-removed", "e1"]]);
  assert.match(formatReport(buildReport(ev)), /1 removed by another verb/);
});

unitTest("activity-log-detour-events-lose-epic: a frame naming no paused epic yields epic null, never a throw", async () => {
  const { diffEvents } = await import(ALOG);
  const push = diffEvents(
    { revision: 1, epics: [], detourStack: [] },
    { revision: 2, epics: [], detourStack: [{ reason: "hand-edited" }, null] }, { verb: "v" });
  assert.deepEqual(push.filter(e => e.kind === "detour-push").map(e => [e.epic, e.detour]), [[null, null], [null, null]]);
});

unitTest("gh-111: diffEvents reports a gate verdict, and a quiet write still leaves a line", async () => {
  const { diffEvents } = await import(ALOG);
  const epic = (over = {}) => ({ id: "e1", status: "active", lane: "openspec", ...over });
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
