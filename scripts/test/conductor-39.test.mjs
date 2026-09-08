// The clock — `createdAt`, `touchedAt`, and the re-runnable recovery that populates the first
// one from local history.
//
// Two fields and one verb, and the reason they share a file is that the interesting property is
// the SEAM between them: the recovery writes `createdAt` across a whole archive in one save, and
// the last-touched stamp must not fire on any of it. Split across two files that property is
// asserted by neither.
//
// Change: record-answers-for-itself, task groups 1 and 2.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  tmpRepo, run, runCombined, readState, writeState, fixturePluginRoot,
} from "./helpers.mjs";

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
const stateBytes = (cwd) => fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
const epicOf = (cwd, id) => readState(cwd).epics.find(e => e.id === id);

// ─────────────────────────── 1. the clock ───────────────────────────

test("1.1: a newly registered epic carries createdAt, and no later mutation rewrites it", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--title", "A", "--lane", "claude-code", "--priority", "P1"], { cwd });

  const born = epicOf(cwd, "a");
  assert.match(born.createdAt || "", ISO,
    "every creation routes through pushEpic(), so an epic with no createdAt means the sink " +
    "did not stamp it");

  run(["update-epic", "a", "--title", "A renamed"], { cwd });
  const after = epicOf(cwd, "a");
  assert.equal(after.title, "A renamed");
  assert.equal(after.createdAt, born.createdAt,
    "createdAt records when pm learned of the work — a mutation is not a re-registration");
});

test("1.1: an epic written without createdAt reads as unknown, never as a date", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  // Exactly the shape 0.39.0 wrote: no createdAt, no touchedAt.
  writeState(cwd, {
    version: 1, active: null, detourStack: [], epics: [
      { id: "legacy", title: "Legacy", priority: "P1", status: "queued", role: "epic",
        lane: "claude-code", links: [], reconcileNeeded: false },
    ],
  });
  run(["update-epic", "legacy", "--title", "Legacy renamed"], { cwd });

  const e = epicOf(cwd, "legacy");
  assert.equal(Object.prototype.hasOwnProperty.call(e, "createdAt"), false,
    "absence means unknown. A mutation must not back-fill a registration date it does not " +
    "know — that would substitute the current time for a fact nobody recorded");
});

test("1.2: a save that changes nothing stamps nothing — no touch, no revision bump, same bytes", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--title", "A", "--lane", "claude-code", "--priority", "P1"], { cwd });

  const before = stateBytes(cwd);
  const beforeRevision = readState(cwd).revision;
  // Setting a field to the value it already holds: the state that reaches saveState is identical
  // to the file on disk, so the whole-body comparison must short-circuit before anything is
  // stamped. A stamp applied ahead of that comparison defeats it for EVERY verb.
  run(["update-epic", "a", "--title", "A"], { cwd });

  assert.equal(stateBytes(cwd), before,
    "state.json must be byte-identical after a no-op save — this is the state-write-guard " +
    "contract, and a per-record touch stamp applied before the identity comparison breaks it");
  assert.equal(readState(cwd).revision, beforeRevision);
});

test("1.3: a save that writes advances touchedAt only on the epics whose content changed", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--title", "A", "--lane", "claude-code", "--priority", "P1"], { cwd });
  run(["add-epic", "--id", "b", "--title", "B", "--lane", "claude-code", "--priority", "P1"], { cwd });

  const aBefore = epicOf(cwd, "a").touchedAt;
  const bBefore = epicOf(cwd, "b").touchedAt;
  assert.match(aBefore || "", ISO, "a newly created epic has no disk pre-image, so it is touched");
  assert.match(bBefore || "", ISO);
  // Registering `b` did not change `a`, so `a` must not have been re-stamped by that save.
  assert.equal(epicOf(cwd, "a").touchedAt, aBefore);

  run(["update-epic", "a", "--priority", "P0"], { cwd });

  const aAfter = epicOf(cwd, "a");
  const bAfter = epicOf(cwd, "b");
  assert.ok(aAfter.touchedAt > aBefore,
    `the changed epic's touchedAt must advance (was ${aBefore}, now ${aAfter.touchedAt})`);
  assert.equal(bAfter.touchedAt, bBefore,
    "an epic the save did not change is not touched by it — the comparison is per record, " +
    "against the disk pre-image, not a whole-file boolean");
  assert.equal(aAfter.createdAt, epicOf(cwd, "a").createdAt);
});

test("1.3: a removal does not report every later epic as touched (matched by id, not position)", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  for (const id of ["a", "b", "c"]) {
    run(["add-epic", "--id", id, "--title", id.toUpperCase(), "--lane", "claude-code", "--priority", "P1"], { cwd });
  }
  const cBefore = epicOf(cwd, "c").touchedAt;

  runCombined(["remove-epic", "a"], { cwd });

  assert.equal(epicOf(cwd, "c").touchedAt, cBefore,
    "remove-epic filters the array, so every record after the removed one shifts position. " +
    "An index-matched comparison would report all of them as changed and stamp them.");
});

test("1.6: a 0.39.0 state.json loads, renders and passes integrity with neither field present", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  writeState(cwd, {
    version: 1, active: null, detourStack: [], pmVersion: "0.39.0", epics: [
      { id: "old-a", title: "Old A", priority: "P1", status: "queued", role: "epic",
        lane: "claude-code", links: [], reconcileNeeded: false },
      { id: "old-b", title: "Old B", priority: "P2", status: "queued", role: "epic",
        lane: "superpowers", links: [], reconcileNeeded: false },
    ],
  });

  run(["render"], { cwd });
  const out = runCombined(["integrity"], { cwd });
  assert.doesNotMatch(out, /createdAt|touchedAt/,
    "absence is the documented default for both fields; an integrity check must not report it");

  for (const e of readState(cwd).epics) {
    assert.equal(Object.prototype.hasOwnProperty.call(e, "createdAt"), false,
      "reading and rendering must not back-fill a date");
    assert.equal(Object.prototype.hasOwnProperty.call(e, "touchedAt"), false,
      "render changed no epic, so no epic was touched");
  }
});

// ───────────── 2. history recovery — a re-runnable verb, not a migration body ─────────────

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" });

/** Run the recovery and PROVE IT RAN.
 *
 *  Every degradation case below asserts an ABSENCE, and an absence assertion passes just as
 *  happily when the verb does not exist at all — an unknown subcommand prints usage, exits 1, and
 *  `runCombined` swallows both. Requiring the verb's own summary line is what separates "the
 *  recovery looked and found no evidence" from "nothing happened". */
function recover(cwd) {
  const out = runCombined(["recover-created-at"], { cwd });
  assert.match(out, /recover-created-at: \d+ recovered/,
    "the verb emitted no summary, so it did not run to completion — every absence assertion " +
    `below it would be vacuous. Output was: ${JSON.stringify(out)}`);
  return out;
}

/** An initialized repo whose `.conductor/state.json` is TRACKED, with one commit per epic so
 *  each id has a distinct introducing commit to be recovered from.
 *
 *  The state is written directly rather than through `add-epic` on purpose: `add-epic` now
 *  stamps `createdAt` at creation, and a recovery that never has an absent date to fill is a
 *  vacuous test. This fixture is a 0.39.0 archive as it exists on disk today. */
function trackedHistoryRepo(ids = ["one", "two"]) {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  git(cwd, "init", "-q");
  git(cwd, "config", "user.email", "test@example.com");
  git(cwd, "config", "user.name", "Test");
  git(cwd, "add", "-A");
  git(cwd, "commit", "-q", "-m", "chore: baseline");

  const epics = [];
  for (const id of ids) {
    epics.push({ id, title: id, priority: "P1", status: "queued", role: "epic",
                 lane: "claude-code", links: [], reconcileNeeded: false });
    writeState(cwd, { version: 1, active: null, detourStack: [], pmVersion: "0.39.0", epics: [...epics] });
    git(cwd, "add", "-A");
    git(cwd, "commit", "-q", "-m", `chore: register ${id}`);
  }
  return cwd;
}

test("2.1: the verb recovers a real date for an id whose introducing commit is in the history", () => {
  const cwd = trackedHistoryRepo(["one", "two"]);
  const introduced = git(cwd, "log", "-S", '"id": "one"', "--reverse", "--format=%cI", "--",
    ".conductor/state.json").split("\n").filter(Boolean)[0];
  assert.match(introduced || "", ISO, "fixture sanity: git must be able to see the introducing commit");

  recover(cwd);

  assert.equal(epicOf(cwd, "one").createdAt, introduced,
    "the date is the introducing commit's, not the run time");
  assert.match(epicOf(cwd, "two").createdAt || "", ISO);
  assert.notEqual(epicOf(cwd, "one").createdAt, epicOf(cwd, "two").createdAt,
    "two epics introduced by two commits do not share a date");
});

test("2.2: degradation — no git repository yields ABSENT, not an error and not a date", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  writeState(cwd, { version: 1, active: null, detourStack: [], epics: [
    { id: "x", title: "x", priority: "P1", status: "queued", role: "epic", lane: "claude-code",
      links: [], reconcileNeeded: false }] });

  const out = recover(cwd);
  assert.doesNotMatch(out, /Error|Traceback|ENOENT/);
  assert.equal(Object.prototype.hasOwnProperty.call(epicOf(cwd, "x"), "createdAt"), false,
    "no repository means no evidence — absence is the honest answer");
});

test("2.2: degradation — an untracked state file yields ABSENT", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  git(cwd, "init", "-q");
  git(cwd, "config", "user.email", "test@example.com");
  git(cwd, "config", "user.name", "Test");
  fs.writeFileSync(path.join(cwd, "README.md"), "# t\n");
  git(cwd, "add", "README.md");
  git(cwd, "commit", "-q", "-m", "chore: baseline");
  // state.json exists but was never committed, so no commit ever introduced the id.
  writeState(cwd, { version: 1, active: null, detourStack: [], epics: [
    { id: "x", title: "x", priority: "P1", status: "queued", role: "epic", lane: "claude-code",
      links: [], reconcileNeeded: false }] });

  recover(cwd);
  assert.equal(Object.prototype.hasOwnProperty.call(epicOf(cwd, "x"), "createdAt"), false);
});

test("2.2: degradation — a shallow history that does not reach the introducing commit yields ABSENT", () => {
  const origin = trackedHistoryRepo(["one", "two"]);
  // A depth-1 clone sees only the tip. `one` was introduced two commits back, so its
  // introducing commit is genuinely outside this checkout's history — the market-intelligence
  // case, reproduced.
  const shallow = tmpRepo();
  fs.rmSync(shallow, { recursive: true, force: true });
  execFileSync("git", ["clone", "-q", "--depth", "1", `file://${origin}`, shallow], { encoding: "utf8" });

  recover(shallow);
  const e = epicOf(shallow, "one");
  assert.equal(Object.prototype.hasOwnProperty.call(e, "createdAt"), false,
    "a checkout with less history recovers less — and must not fabricate the difference");
});

test("2.2: degradation — an id absent from the history yields ABSENT", () => {
  const cwd = trackedHistoryRepo(["one"]);
  const s = readState(cwd);
  s.epics.push({ id: "never-committed", title: "n", priority: "P1", status: "queued",
                 role: "epic", lane: "claude-code", links: [], reconcileNeeded: false });
  writeState(cwd, s);

  recover(cwd);
  assert.match(epicOf(cwd, "one").createdAt || "", ISO, "the recoverable one is still recovered");
  assert.equal(Object.prototype.hasOwnProperty.call(epicOf(cwd, "never-committed"), "createdAt"), false);
});

test("2.3: re-running never overwrites a date already present", () => {
  const cwd = trackedHistoryRepo(["one", "two"]);
  recover(cwd);
  const first = readState(cwd).epics.map(e => [e.id, e.createdAt]);

  recover(cwd);
  assert.deepEqual(readState(cwd).epics.map(e => [e.id, e.createdAt]), first,
    "idempotent: a second run must not move a recovered date");
});

test("2.3: an absent date is re-attempted and recovered once the checkout has the history", () => {
  const origin = trackedHistoryRepo(["one", "two"]);
  const shallow = tmpRepo();
  fs.rmSync(shallow, { recursive: true, force: true });
  execFileSync("git", ["clone", "-q", "--depth", "1", `file://${origin}`, shallow], { encoding: "utf8" });

  recover(shallow);
  assert.equal(Object.prototype.hasOwnProperty.call(epicOf(shallow, "one"), "createdAt"), false,
    "precondition: the shallow checkout cannot see the introducing commit");

  // The checkout catches up. Absence must stay RE-ATTEMPTABLE — freezing it here is what a
  // one-shot migration keyed to pmVersion would do, and it is why this is a verb.
  execFileSync("git", ["fetch", "-q", "--unshallow"], { cwd: shallow, encoding: "utf8" });
  recover(shallow);
  assert.match(epicOf(shallow, "one").createdAt || "", ISO,
    "a later run in a checkout with more history recovers what the earlier run could not");
});

test("2.4: an epic in an undefined status is handled like any other and is NOT repaired", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  git(cwd, "init", "-q");
  git(cwd, "config", "user.email", "test@example.com");
  git(cwd, "config", "user.name", "Test");
  git(cwd, "add", "-A");
  git(cwd, "commit", "-q", "-m", "chore: baseline");
  writeState(cwd, { version: 1, active: null, detourStack: [], pmVersion: "0.39.0", epics: [
    // `done` is not in KNOWN_STATUSES. Six repositories on this machine carry it.
    { id: "legacy-done", title: "Legacy done", priority: "P1", status: "done", role: "epic",
      lane: "claude-code", links: [], reconcileNeeded: false }] });
  git(cwd, "add", "-A");
  git(cwd, "commit", "-q", "-m", "chore: register legacy-done");

  recover(cwd);

  const e = epicOf(cwd, "legacy-done");
  assert.match(e.createdAt || "", ISO, "a malformed record is still a record and still gets its date");
  assert.equal(e.status, "done",
    "the recovery transforms; it does not repair. Which status this should be is a judgment " +
    "about what happened to the work, and nothing here may guess it");
});

test("2.5: the 0.40.0 migration recovers dates and leaves touchedAt ABSENT on pre-existing epics", () => {
  // The fixture already stamps and commits `pmVersion: "0.39.0"`, so the 0.40.0 entry is the
  // only one this repo is missing.
  const cwd = trackedHistoryRepo(["one", "two"]);

  const out = runCombined(["upgrade"], { cwd, env: { CLAUDE_PLUGIN_ROOT: fixturePluginRoot("0.40.0") } });
  assert.match(out, /upgraded \(1 migration\(s\)\)/,
    "a 0.39.0-stamped repo is missing exactly the 0.40.0 entry");

  for (const e of readState(cwd).epics) {
    assert.match(e.createdAt || "", ISO, `${e.id} should have been recovered`);
    assert.equal(Object.prototype.hasOwnProperty.call(e, "touchedAt"), false,
      "the migration writes createdAt across the whole archive in ONE save. Without excluding " +
      "the timekeeping fields from the per-record comparison, every epic in every repository " +
      "reads 'last touched: upgrade day'");
  }
});

test("2.5: a standalone re-run of the recovery is not a touch either", () => {
  const cwd = trackedHistoryRepo(["one", "two"]);

  recover(cwd);
  for (const e of readState(cwd).epics) {
    assert.match(e.createdAt || "", ISO);
    assert.equal(Object.prototype.hasOwnProperty.call(e, "touchedAt"), false,
      "the same write on a different day is still a recovery, not a touch");
  }
});

test("2.5: a record whose only delta is a recovered date does not shift its existing touchedAt", () => {
  const cwd = trackedHistoryRepo(["one"]);
  // An epic that HAS been touched before, and has no createdAt yet — the mixed population the
  // fleet actually carries.
  const s = readState(cwd);
  s.epics[0].touchedAt = "2020-01-01T00:00:00.000Z";
  writeState(cwd, s);

  recover(cwd);
  const e = epicOf(cwd, "one");
  assert.match(e.createdAt || "", ISO);
  assert.equal(e.touchedAt, "2020-01-01T00:00:00.000Z",
    "recovering a registration date is not a touch, so an existing touchedAt is left alone");
});

test("2.6/2.8: the verb reads only local history — no network, argv array never a shell string", () => {
  const src = fs.readFileSync(
    path.join(path.dirname(new URL(import.meta.url).pathname), "..", "lib", "created-at.mjs"), "utf8");
  assert.doesNotMatch(src, /\bexecSync\b/,
    "epic ids are read from a state file that may predate id validation, so the invocation " +
    "must be an argv array (git.mjs:141-142)");
  assert.doesNotMatch(src, /https?:|node:https?|fetch\(/,
    "the engine never opens a network connection");
  assert.doesNotMatch(src, /"(fetch|clone|pull|ls-remote|remote)"/,
    "local object database only — no git subcommand that contacts a remote");
});
