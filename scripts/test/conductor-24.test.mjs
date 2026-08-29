// scripts/test/conductor-24.test.mjs
//
// commit-nudge: OBSERVE the repository, do not parse the command string.
//
// Three issues, one hook, one root cause. gh#104 (the nudge fires on any Bash command whose
// TEXT contains "git commit"), gh#91 (an AUTO-DETOUR is logged with no active epic to detour
// FROM), and the local `autodetour-parser-misses-am-and-f` epic (`-am`, `-F` and editor commits
// never reach the `-m` parser at all) are all consequences of deciding "did a commit happen?"
// from a string the shell was handed rather than from the repository the commit would land in.
//
// A commit is a fact about the repository: HEAD moved, and the reflog says the move was a
// commit. That question has an answer for EVERY commit form, including the ones nobody has
// invented yet, so this file asserts BOTH directions on purpose — every false-positive shape
// must stay silent, and every real commit form must still be noticed. A fix that only proves
// the noise stopped is half a fix: a missed commit is silent, and silence is the failure mode
// the nudge exists to prevent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { run, tmpRepo, writeState, gitRepo, commitFiles, detourLog, autoDetourState } from "./helpers.mjs";

const WATCH = (cwd) => path.join(cwd, ".conductor", "commit-watch.json");
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const head = (cwd) => git(cwd, "rev-parse", "HEAD");

/** Fire the hook exactly as the PostToolUse harness does, and return its stdout. */
function nudge(cwd, command) {
  return run(["commit-nudge"], { cwd, input: JSON.stringify({ tool_input: { command } }) });
}

/** Prime the HEAD watermark the way the field does: the hook runs on EVERY Bash tool call, so
 *  by the time an interesting command arrives the previous call has already recorded where HEAD
 *  was. A fixture that skips this is testing the cold-start rung, not the steady state. */
function prime(cwd) {
  nudge(cwd, "ls -la");
}

/** A fixture with a detour in flight, so the DETOUR-COMMIT branch is the one under test. */
function detourState(cwd) {
  writeState(cwd, {
    version: 1, active: "paused-a", detourStack: [
      { pausedEpic: "paused-a", pausedAt: "2026-08-28T00:00:00Z", reason: "x", spawnedDetour: "detour-1", reconcileOnResume: false },
    ],
    epics: [
      { id: "paused-a", title: "paused-a", priority: "P1", status: "paused", role: "epic", lane: "claude-code", links: [], reconcileNeeded: false },
      { id: "detour-1", title: "detour-1", priority: "P1", status: "active", role: "epic", lane: "claude-code", links: [], reconcileNeeded: false },
    ],
  });
}

/** A fixture with an ACTIVE epic and no detour — the AUTO-DETOUR branch's precondition. */
function activeEpicState(cwd) {
  writeState(cwd, {
    version: 1, active: "epic-a", detourStack: [],
    epics: [{ id: "epic-a", title: "epic-a", priority: "P1", status: "active", role: "epic", lane: "claude-code", links: [], reconcileNeeded: false }],
  });
}

// ─────────────────── direction 1: shapes that must NOT fire ───────────────────

test("gh#104: a command that merely MENTIONS git commit produces no nudge at all", () => {
  const cwd = tmpRepo(); run(["init"], { cwd }); gitRepo(cwd); activeEpicState(cwd);
  prime(cwd);
  const out = nudge(cwd, 'echo "this string mentions git commit but executes nothing"');
  assert.equal(out, "",
    "HEAD did not move, so no commit happened — the hook must assert nothing at all");
  assert.doesNotMatch(detourLog(cwd), /AUTO-DETOUR|DETOUR-COMMIT/);
});

test("gh#104: an rg search for the phrase 'git commit' produces no nudge", () => {
  const cwd = tmpRepo(); run(["init"], { cwd }); gitRepo(cwd); activeEpicState(cwd);
  prime(cwd);
  assert.equal(nudge(cwd, `rg -n "git commit" docs/`), "");
});

test("a REJECTED commit produces no nudge and no DETOUR-COMMIT, in any flag form", () => {
  const cwd = tmpRepo(); run(["init"], { cwd }); gitRepo(cwd); detourState(cwd);
  prime(cwd);
  // The parser epic's story 1: `-am` parsed to subject:"" and short-circuited the old guard, so
  // a rejected -am commit wrote a false DETOUR-COMMIT line. HEAD never moved for any of these.
  for (const cmd of [
    'git commit -m "fix: rejected by pre-commit"',
    'git commit -am "fix: rejected by pre-commit"',
    `git commit -q -F - <<'MSG'\nfix: rejected by pre-commit\nMSG`,
    "git commit --amend --no-edit",
  ]) {
    assert.equal(nudge(cwd, cmd), "", `a rejected commit must stay silent: ${cmd}`);
  }
  assert.equal(detourLog(cwd), "", "no rejected commit may reach the detour trail");
});

test("a HEAD move that is NOT a commit — checkout, reset — produces no nudge", () => {
  const cwd = tmpRepo(); run(["init"], { cwd }); gitRepo(cwd); activeEpicState(cwd);
  commitFiles(cwd, { "a.txt": "1" }, "fix: something earlier");
  prime(cwd);
  git(cwd, "reset", "-q", "--hard", "HEAD~1");     // HEAD is back on "chore: baseline"
  // Deliberately adversarial: the command text names a commit, and the subject it names MATCHES
  // the subject now at HEAD, so every string-level check the old hook had says "landed". Only
  // the reflog — which says `reset`, not `commit` — can tell that nothing was created.
  const out = nudge(cwd, 'git commit -m "chore: baseline"');
  assert.equal(out, "", "HEAD moved, but the reflog says reset — that is not a commit");
  assert.doesNotMatch(detourLog(cwd), /AUTO-DETOUR/);
});

test("gh#91: a landed minimal-shaped commit with NO active epic is not logged as a detour", () => {
  const cwd = tmpRepo(); run(["init"], { cwd }); gitRepo(cwd);
  writeState(cwd, { version: 1, active: null, detourStack: [], epics: [] });
  prime(cwd);
  commitFiles(cwd, { "a.txt": "1" }, "chore(pm): upgrade conductor to 0.31.0");
  const out = nudge(cwd, 'git commit -m "chore(pm): upgrade conductor to 0.31.0"');
  assert.ok(out.includes("hookSpecificOutput"),
    "the commit is real, so the hook must still run to completion and nudge");
  assert.doesNotMatch(detourLog(cwd), /AUTO-DETOUR/,
    "a detour is an interruption of an ACTIVE epic; with none there is nothing to detour from");
});

// ─────────────────── direction 2: real commits that must STILL fire ───────────────────

test("gh#91 control: the same commit WITH an active epic still auto-logs", () => {
  const cwd = tmpRepo(); run(["init"], { cwd }); gitRepo(cwd); activeEpicState(cwd);
  prime(cwd);
  commitFiles(cwd, { "a.txt": "1" }, "chore: tidy an unrelated helper");
  nudge(cwd, 'git commit -m "chore: tidy an unrelated helper"');
  assert.match(detourLog(cwd), /AUTO-DETOUR/,
    "control failed: this fixture never auto-logs, so the gh#91 assertion proved nothing");
});

test("every commit FORM is noticed, because none of them is parsed", () => {
  // -am, -F, an editor commit with no message flag at all, and a message carrying an escaped
  // quote. The old parser produced "" for the first three (unverifiable) and a TRUNCATED string
  // for the last (wrongly contradicted, hook silently disabled — the parser epic's story 3).
  const forms = [
    ["fix: from dash-am", 'git commit -am "fix: from dash-am"'],
    ["fix: from a heredoc", `git commit -q -F - <<'MSG'\nfix: from a heredoc\nMSG`],
    ["fix: from the editor", "git commit"],
    ['fix: say \\"hi\\" politely', 'git commit -m "fix: say \\"hi\\" politely"'],
  ];
  for (const [subject, cmd] of forms) {
    const cwd = tmpRepo(); run(["init"], { cwd }); gitRepo(cwd); activeEpicState(cwd);
    prime(cwd);
    commitFiles(cwd, { "a.txt": "1" }, subject.replace(/\\"/g, '"'));
    const out = nudge(cwd, cmd);
    assert.ok(out.includes("hookSpecificOutput"), `a landed commit must be noticed: ${cmd}`);
    assert.match(detourLog(cwd), /AUTO-DETOUR/, `and recorded: ${cmd}`);
  }
});

test("a commit landing during a call whose text never says 'git commit' is still noticed", () => {
  const cwd = tmpRepo(); run(["init"], { cwd }); gitRepo(cwd); activeEpicState(cwd);
  prime(cwd);
  commitFiles(cwd, { "a.txt": "1" }, "fix: committed by a wrapper script");
  const out = nudge(cwd, "./scripts/release.sh");
  assert.ok(out.includes("hookSpecificOutput"),
    "observation closes the false NEGATIVE the text check had: a commit is a commit");
});

test("a BACKGROUNDED commit is caught on the next tool call rather than lost (gh#68)", () => {
  const cwd = tmpRepo(); run(["init"], { cwd }); gitRepo(cwd); activeEpicState(cwd);
  prime(cwd);
  // The hook fires while `git commit` is still running: HEAD has not moved yet.
  assert.equal(nudge(cwd, 'git commit -m "fix: still running" &'), "",
    "nothing has landed yet, so nothing may be asserted yet");
  commitFiles(cwd, { "a.txt": "1" }, "fix: still running");   // the background commit completes
  const out = nudge(cwd, "ls");
  assert.ok(out.includes("hookSpecificOutput"),
    "the watermark is stale by exactly one commit, so the very next call notices it");
  assert.match(detourLog(cwd), /still running/);
  // The entry describes the COMMIT, not the call that happened to notice it. gitShortSha() and
  // headChangedFiles() both read HEAD, so a delayed notice is still attributed correctly —
  // assert it rather than trust it, since this is the one place that could silently drift.
  assert.match(detourLog(cwd), new RegExp(`\\t${git(cwd, "rev-parse", "--short", "HEAD")}\\t`),
    "the logged sha must be the commit's, not a stale or unrelated one");
});

// ─────────────────── the watermark itself, and how this degrades ───────────────────

test("the HEAD watermark is persisted on EVERY invocation, including silent ones", () => {
  // Mutation guard for the persist. Delete it and every later call sees a stale (or absent)
  // baseline, which pins the hook on the cold-start rung forever — invisible to any test that
  // only ever calls the hook once.
  const cwd = tmpRepo(); run(["init"], { cwd }); gitRepo(cwd);
  nudge(cwd, "ls");                       // silent: nothing landed
  assert.ok(fs.existsSync(WATCH(cwd)), "a silent call must still record where HEAD was");
  assert.equal(JSON.parse(fs.readFileSync(WATCH(cwd), "utf8")).head, head(cwd));
  commitFiles(cwd, { "a.txt": "1" }, "fix: a later commit");
  nudge(cwd, "ls");
  assert.equal(JSON.parse(fs.readFileSync(WATCH(cwd), "utf8")).head, head(cwd),
    "and must move the watermark forward as HEAD moves");
});

test("the watermark is recorded even for a command that never mentions a commit (gh#104)", () => {
  // The trap this guards: leaving the /git\s+commit/ text check ahead of the observation would
  // make gh#104's own repro the only thing that ever primes the cache.
  const cwd = tmpRepo(); run(["init"], { cwd }); gitRepo(cwd);
  nudge(cwd, "echo hello");
  assert.equal(JSON.parse(fs.readFileSync(WATCH(cwd), "utf8")).head, head(cwd));
});

test("a corrupt watermark file degrades to the pre-observation path instead of throwing", () => {
  const cwd = tmpRepo(); run(["init"], { cwd }); gitRepo(cwd); activeEpicState(cwd);
  fs.writeFileSync(WATCH(cwd), "{ this is not json");
  commitFiles(cwd, { "a.txt": "1" }, "fix: a real commit");
  const out = nudge(cwd, 'git commit -m "fix: a real commit"');
  assert.ok(out.includes("hookSpecificOutput"),
    "an unreadable watermark must never disable the hook, and must never crash it");
  assert.equal(JSON.parse(fs.readFileSync(WATCH(cwd), "utf8")).head, head(cwd),
    "and the corrupt file is replaced with a usable value, so the repo self-heals onto the observed path");
});

// ─────────────────── the COLD-START rung: no watermark exists yet ───────────────────
// One invocation per repository lands here — the first hook run after the plugin is updated —
// and it still uses the old subject-vs-HEAD parse. Both flag-form defects in the
// `autodetour-parser-misses-am-and-f` epic are therefore fixed there too rather than only
// being routed around, because that rung is where a repo's FIRST commit can land.

test("cold start: a rejected -am commit is suppressed, not waved through on an empty subject", () => {
  const cwd = tmpRepo(); run(["init"], { cwd }); autoDetourState(cwd); gitRepo(cwd);
  commitFiles(cwd, { "prior.txt": "1" }, "chore: an unrelated prior commit");
  // No prime(): no watermark, so this is the parse rung. `-am` used to match nothing, giving
  // subject "" — which short-circuited the HEAD comparison and logged the prior commit under a
  // subject that was never committed.
  const out = nudge(cwd, 'git commit -am "fix: rejected, never landed"');
  assert.equal(out, "", "HEAD holds a different subject, so this -am commit did not land");
  assert.equal(detourLog(cwd), "");
});

test("cold start: an escaped quote inside -m does not suppress a commit that DID land", () => {
  const cwd = tmpRepo(); run(["init"], { cwd }); autoDetourState(cwd); gitRepo(cwd);
  commitFiles(cwd, { "a.txt": "1" }, 'fix: say "hi" politely');
  // `[^"]*` truncated the capture at the first \" and produced `fix: say \`, which HEAD then
  // contradicted — a landed commit silently dropped, the worse of the two failure directions.
  const out = nudge(cwd, 'git commit -m "fix: say \\"hi\\" politely"');
  assert.ok(out.includes("hookSpecificOutput"), "a landed commit must not be contradicted by its own escaping");
  assert.match(detourLog(cwd), /AUTO-DETOUR/);
});

test("reflogs disabled: the hook falls back rather than going permanently silent", () => {
  // `core.logAllRefUpdates=false` makes `git reflog` exit 0 with NO output, so the move cannot be
  // classified. That is a cannot-answer, and treating it as "no commit" would silently disable
  // the hook for the whole repository — the worst available failure.
  const cwd = tmpRepo(); run(["init"], { cwd }); autoDetourState(cwd); gitRepo(cwd);
  // The config alone is NOT enough — git keeps appending to a HEAD reflog that already exists,
  // so a test that only sets it silently exercises the observed path instead. Remove the logs
  // too, which is the state a fresh clone or `git reflog expire --expire-unreachable=now` leaves.
  git(cwd, "config", "core.logAllRefUpdates", "false");
  fs.rmSync(path.join(cwd, ".git", "logs"), { recursive: true, force: true });
  prime(cwd);
  commitFiles(cwd, { "a.txt": "1" }, "fix: landed with no reflog to read");
  const out = nudge(cwd, 'git commit -m "fix: landed with no reflog to read"');
  assert.ok(out.includes("hookSpecificOutput"),
    "with no reflog the subject-vs-HEAD fallback must carry the commit through");
  assert.match(detourLog(cwd), /AUTO-DETOUR/);
});

test("a reflog whose top entry is not HEAD cannot classify the move, so it falls back", () => {
  // The top reflog entry can describe an OLDER position — an expired or pruned entry, a reflog
  // written by a git that stopped logging. Here the surviving top entry is a `checkout`, which
  // would classify a commit that really landed as "not a commit" and silence the hook: a false
  // NEGATIVE, the direction that fails silently. Only comparing the entry's sha against HEAD
  // catches it.
  const cwd = tmpRepo(); run(["init"], { cwd }); autoDetourState(cwd); gitRepo(cwd);
  git(cwd, "checkout", "-q", "-b", "side");
  prime(cwd);
  commitFiles(cwd, { "a.txt": "1" }, "fix: real, but its reflog entry is gone");
  git(cwd, "reflog", "delete", "HEAD@{0}");      // top entry is now the earlier `checkout`
  const out = nudge(cwd, 'git commit -m "fix: real, but its reflog entry is gone"');
  assert.ok(out.includes("hookSpecificOutput"),
    "an unclassifiable move is UNVERIFIABLE, not a denial — the fallback must carry it through");
  assert.match(detourLog(cwd), /AUTO-DETOUR/);
});

test("an UNBORN HEAD is a position, not a failure: the initial commit is noticed", () => {
  const cwd = tmpRepo(); run(["init"], { cwd }); autoDetourState(cwd);
  git(cwd, "init", "-q");
  git(cwd, "config", "user.email", "test@example.com");
  git(cwd, "config", "user.name", "Test");
  prime(cwd);                                   // records the unborn position
  assert.equal(JSON.parse(fs.readFileSync(WATCH(cwd), "utf8")).head, "",
    "a repo with no commits has a real, comparable HEAD position");
  commitFiles(cwd, { "a.txt": "1" }, "fix: the very first commit");
  const out = nudge(cwd, "git commit");
  assert.ok(out.includes("hookSpecificOutput"),
    "`commit (initial)` is a commit, and the move off UNBORN is observable");
});

test("commit-nudge stays dormant before /pm:init and writes no watermark", () => {
  const cwd = tmpRepo();
  assert.equal(nudge(cwd, 'git commit -m "fix: x"'), "");
  assert.equal(fs.existsSync(WATCH(cwd)), false,
    "an uninitialized repo must not grow a .conductor/ file from a hook that is meant to be dormant");
});

test("the watermark file is git-ignored in every pm-managed repo", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  assert.match(fs.readFileSync(path.join(cwd, ".gitignore"), "utf8"), /^\.conductor\/commit-watch\.json$/m,
    "an engine-written file nobody ignores is #106 all over again");
});
