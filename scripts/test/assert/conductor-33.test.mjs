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
//
// ─────────────── 4.1 SPLIT THIS FILE, AND THIS IS THE FILE-RUNG HALF ───────────────
//
// gh-84/gh-111's tests were sorted by OBSERVABLE (design D6), one test at a time:
//
//   * a test that observes what the RECORD SAYS — a claim, a refusal, `owners`' report,
//     `integrity`'s finding, an activity event — moved to `scripts/test/unit/conductor-33.test.mjs`,
//     where it reads those values back out of an in-memory store instead of paying for a tmpdir, a
//     lock, an fsync and a read-back. That is 39 of this file's 58 tests, and it is where the 5.9 s
//     this file costs the assertion half (worklist-4.1.md) comes from.
//   * what is LEFT HERE is what a memory store cannot answer, and each one is here for a stated
//     reason rather than by default:
//       - `.gitignore` — a repository file, which design D1 deliberately does not put in the store;
//       - `--steal is NOT --force` — the subject is the DISK store's revision guard, and a unit
//         test must never assert a state a real commit would refuse (that guard stays in the disk
//         store by design, so the conflict seam is only reachable there);
//       - `PROJECT.md`'s MTIME — a filesystem property, not a value the store holds;
//       - `readEvents({ dir })` and `purge-logs`' candidate enumeration — a DIRECTORY is their
//         argument and reading it is their subject;
//       - `fs.chmod` on the log directory, and an unreadable `state.json` written as RAW BYTES.
//
// The two halves keep the same ids and the same test names, and NOT ONE ASSERTION CHANGED in
// either direction.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, readState, writeState, expectFail, invokeEngine, injectConflictOnce,
  withAssertInvocation } from "../fixtures/assert-harness.mjs";
import { removeAtExit } from "../fixtures/temp-dir.mjs";

/** A repo with two claimable epics and one archived one. */
function claimRepo() {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "e1", "--lane", "claude-code", "--title", "one"], { cwd });
  run(["add-epic", "--id", "e2", "--lane", "claude-code", "--title", "two"], { cwd });
  return cwd;
}
const stateBytes = (cwd) => fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
const markerPath = (cwd) => path.join(cwd, ".conductor", "session-claim.json");

// ═══════════════ the ONE surface that refuses, at the guard that only exists on disk ═══════════════

test("gh-84: --steal is NOT --force — it must not disable state.json's revision guard", () => {
  // saveState() reads `--force` GLOBALLY off argv. A claim verb spelled `--force` would silently
  // switch off optimistic concurrency on the very write it exists to coordinate: the enforcement
  // half (#83) defeated as a side effect of the cooperative half (#84). Asserted BEHAVIOURALLY,
  // through the conflict-injection seam, rather than by grepping the source for a string.
  const cwd = claimRepo();
  run(["claim", "e1", "--session", "alpha"], { cwd });
  // RE-POINTED BY 5.1: the seam is the shared-`fs` patch, not the NODE_OPTIONS preload — a preload
  // only reaches a process that is STARTED, and the assertion half no longer starts one.
  const restore = injectConflictOnce(path.join(cwd, ".conductor"));
  let fired;
  let err;
  try { err = expectFail(() => run(["claim", "e1", "--session", "beta", "--steal"], { cwd })); }
  finally { fired = restore(); }
  assert.ok(fired,
    "the conflict seam never fired — this test would otherwise pass without a conflict occurring");
  assert.ok(err, "--steal must still hit the revision guard");
  assert.equal(err.status, 9, "and must exit with the retryable CONFLICT_EXIT_CODE, not 1");
});

// ═══════════════ owners, at the filesystem property ═══════════════

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

// ═══════════════ gitignore, per #106 ═══════════════

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

// ═══════════════ the activity log's DIRECTORY-shaped surface (gh-111) ═══════════════

const ALOG = new URL("../../lib/activity-log.mjs", import.meta.url).href;
const AREPORT = new URL("../../lib/activity-report.mjs", import.meta.url).href;

const activityDirOf = (cwd) => path.join(cwd, ".conductor", "activity");
const segmentFiles = (cwd) => {
  try { return fs.readdirSync(activityDirOf(cwd)).filter(n => n.endsWith(".log")).sort(); }
  catch { return []; }
};

function loggingRepo() {
  const cwd = claimRepo();
  run(["set-activity-log", "on"], { cwd });
  return cwd;
}
/** A scratch directory (pm-seg*), scheduled for removal at exit like every fixture directory. */
function scratchDir(prefix) {
  return removeAtExit(fs.mkdtempSync(path.join(fs.realpathSync(path.dirname(tmpRepo())), prefix)));
}

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

test("gh-111: a full segment rotates to a new one rather than growing past a readable size", async () => {
  const { appendEvents, activityDir } = await import(ALOG);
  const { ACTIVITY_SEGMENT_MAX_BYTES } =
    await import(new URL("../../lib/constants.mjs", import.meta.url).href);
  const cwd = tmpRepo();
  // NOT a bare `process.env.CLAUDE_PROJECT_DIR = cwd` around a DIRECT call (G-I4). That shape left
  // `invocation()` on the live process context, so `gitOps()` built the REAL gateway and
  // `appendEvents`'s detach probe ran `git symbolic-ref --quiet HEAD` — a real git process inside
  // the half that runs no git, invisible to review and to 5.2's source scan because no spawn call
  // is written here. The call is driven under an installed invocation instead, with this half's
  // double, which is what every other test in the half already gets through `run()`.
  await withAssertInvocation(cwd, async () => {
    appendEvents([{ at: new Date().toISOString(), kind: "state-write", verb: "x" }]);
    const first = fs.readdirSync(activityDir())[0];
    fs.writeFileSync(path.join(activityDir(), first), "x".repeat(ACTIVITY_SEGMENT_MAX_BYTES + 1));
    await new Promise(r => setTimeout(r, 5));
    appendEvents([{ at: new Date().toISOString(), kind: "state-write", verb: "y" }]);
    const names = fs.readdirSync(activityDir()).sort();
    assert.equal(names.length, 2, "the full segment must be closed, not appended to");
    assert.ok(names[1] > names[0], "ISO names must sort chronologically — retention depends on it");
  });
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

test("activity-log-detour-events-lose-epic: --epic <detour> finds the detour events that name it", async () => {
  // A detour event is ABOUT two epics: the one paused (`epic`) and the one it was paused for
  // (`detour`). Filtering on `epic` alone made `activity --epic <detour>` blind to the push that
  // started the detour's own work.
  const { readEvents } = await import(AREPORT);
  const dir = scratchDir("pm-seg-detour-");
  fs.writeFileSync(path.join(dir, "activity-2026-01-01T00-00-00-000Z.log"), [
    { at: "2026-01-01T00:00:00.000Z", kind: "detour-push", verb: "push-detour", epic: "e1", detour: "d1" },
    { at: "2026-01-01T00:00:01.000Z", kind: "state-write", verb: "v" },
  ].map(e => JSON.stringify(e)).join("\n") + "\n");
  assert.deepEqual(readEvents({ dir, epic: "d1" }).events.map(e => e.kind), ["detour-push"]);
  assert.deepEqual(readEvents({ dir, epic: "e1" }).events.map(e => e.kind), ["detour-push"]);
});

// ─────────────── the READER, whose argument is a directory ───────────────
//
// `readEvents({ dir })` is given a directory and reads it, and `activity` builds its report on top
// of that. So every test whose assertion goes through the REPORT — the out-of-band counts, the
// hand-edit query, `--epic`/`--since` scoping — observes a directory read and stays here. Found by
// attempting the move: these five passed the sorted-by-observable test and then failed the run,
// which is the honest outcome rather than a reason to weaken one of them.

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

test("activity-log-detour-events-lose-epic: set-review-mode logs a repo-wide review-mode event, not a bare state-write", () => {
  // File rung because the verb rewrites CLAUDE.md's rules block — a repository file the store does
  // not own. The event's value is the subject; `activity --json` is how a user reads it back.
  const cwd = loggingRepo();
  run(["set-review-mode", "--mode", "thorough"], { cwd });
  const j = JSON.parse(run(["activity", "--json"], { cwd }));
  assert.deepEqual(j.settings.map(s => [s.kind, s.epic, s.to]), [["review-mode", null, "thorough"]]);
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

test("gh-111: an UNREADABLE state.json — the snapshot is guarded, so the VERB refuses, not the observer", () => {
  // The chokepoint reads state BEFORE dispatch, and the observer must never be what breaks the run.
  // That intent stands. What changed (state-file-refuses-to-guess): loadState() no longer falls
  // back to an empty record on unparseable input, so the verb itself refuses with exit 11. This
  // test used to assert `owners` still answered, which encoded the removed behaviour: an ownership
  // report of a guessed empty record. The observer's part now is that its own guard swallows the
  // refusal, so the process ends with the verb's refusal and no stack trace from the snapshot.
  const cwd = loggingRepo();
  fs.writeFileSync(path.join(cwd, ".conductor", "state.json"), "{ not json at all");
  const r = invokeEngine(["owners"], { cwd });
  assert.equal(r.status, 11, `owners must refuse with the unreadable-state code, got ${r.status}: ${r.stderr}`);
  assert.match(r.stderr, /\.conductor\/state\.json cannot be read/, "stderr carries the refusal");
  assert.doesNotMatch(r.stderr, /\n\s+at /, "no stack trace: neither the observer nor the verb crashed");
  assert.equal(r.stdout, "", "no ownership report of a guessed record");
});

// ─────────────── purge-logs, at the candidate enumeration that reads a directory ───────────────
//
// `candidates()` walks `.conductor/` and `.conductor/activity/` with `fs.statSync` and keeps a
// real `path` per candidate, because its dry-run listing names the file. The REMOVAL half is the
// store's (task 5.3's I2), but the ENUMERATION is a directory read, which is why these three tests
// are here and the selector POLICY below is on the unit rung: a memory store has a record, not a
// directory, so a purge against one would find no candidates and prove nothing.

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
