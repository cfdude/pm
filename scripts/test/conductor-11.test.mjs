import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tmpRepo, run, writeState, gitRepo, commitFiles, detourLog } from "./helpers.mjs";

// ───────── gh#65 / gh#68: the auto-detour hook must confirm a commit actually landed HERE ─────────
// PostToolUse fires when the Bash tool RETURNS, which is not the same as "a commit landed in
// this repo". Three observed divergences, all producing a false detours.log entry attributed
// to this repo's STALE HEAD: the commit was rejected by pre-commit (gh#65), it was backgrounded
// and is still running (gh#68), or it landed in a different repo entirely (gh#65 bug 2).
//
// WHY EACH TEST BELOW LANDS THE COMMIT AT THE END. `detourLog()` returns "" for a missing file,
// so a bare `doesNotMatch(detourLog(cwd), /AUTO-DETOUR/)` also passes when the hook never ran
// at all -- wrong `isInitialized()` state, a command string that misses the /git\s+commit/
// regex, anything. That is a vacuous pass: the assertion cannot tell "the guard fired" from
// "nothing happened." So each test ends by landing the same commit and asserting the entry now
// APPEARS, which proves the fixture and command were capable of logging all along and only the
// HEAD mismatch suppressed them.

/** Assert `command` produces no detour entry in `cwd`, and prove that is the GUARD's doing
 *  rather than a coincidence.
 *
 *  Two controls are needed, and a mutation test proved both are load-bearing. Disabling the
 *  guard initially left 4 of these 5 tests still passing, because gitRepo()'s baseline commit
 *  touches FOUR files (.conductor/render-stamp.json, .conductor/state.json, CLAUDE.md,
 *  PROJECT.md) and looksLikeUnloggedMinimalDetour() rejects anything over three. The negative
 *  assertions were therefore passing on the file-count rule, not on the guard at all.
 *
 *  So: first make HEAD genuinely auto-log-eligible (one file, chore-prefixed), and only then
 *  assert suppression. Finally land the real subject to prove the fixture can log. */
function assertSuppressedThenLands(cwd, command, subject) {
  // Make HEAD auto-log ELIGIBLE with a subject different from the one under test, so that
  // without the guard the hook really would write a (wrong) entry.
  commitFiles(cwd, { "prior.txt": "1" }, "chore: an unrelated prior commit");

  run(["commit-nudge"], { cwd, input: JSON.stringify({ tool_input: { command } }) });
  assert.doesNotMatch(detourLog(cwd), /AUTO-DETOUR/,
    "a commit that did not land here must not be logged");

  // Positive control: same command, but now HEAD really does hold it.
  commitFiles(cwd, { "landed.txt": "1" }, subject);
  run(["commit-nudge"], { cwd, input: JSON.stringify({ tool_input: { command } }) });
  assert.match(detourLog(cwd), /AUTO-DETOUR/,
    "control failed: this fixture never logs, so the negative assertion above proved nothing");
}

test("commit-nudge does not log when the commit was rejected and never landed (gh#65)", () => {
  const cwd = tmpRepo(); run(["init"], { cwd }); gitRepo(cwd);
  // HEAD is "chore: baseline". The rejected commit never became an object.
  assertSuppressedThenLands(cwd,
    'git commit -m "fix: rejected by pre-commit, never landed"',
    "fix: rejected by pre-commit, never landed");
});

test("commit-nudge does not log when the commit is still running in the background (gh#68)", () => {
  const cwd = tmpRepo(); run(["init"], { cwd }); gitRepo(cwd);
  // Same observable state as a rejected commit: the hook fires while `git commit` is still
  // running, so HEAD has not advanced yet and still holds "chore: baseline".
  assertSuppressedThenLands(cwd,
    'git commit -q -m "chore: still running"',
    "chore: still running");
});

test("commit-nudge does not attribute a commit that landed in a DIFFERENT repo (gh#65 bug 2)", () => {
  const cwd = tmpRepo(); run(["init"], { cwd }); gitRepo(cwd);
  // A separate repo standing in for a paired repo / submodule. Note gitRepo() cannot be used
  // here: it assumes /pm:init already scaffolded files, and its baseline commit throws
  // ("nothing to commit") in the empty dir tmpRepo() returns.
  const other = tmpRepo();
  execFileSync("git", ["init", "-q"], { cwd: other });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: other });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: other });
  commitFiles(other, { "paired.txt": "1" }, "fix: belongs to the paired repo");
  // The commit succeeded -- in `other`. This repo's HEAD is untouched, so nothing may be logged.
  assertSuppressedThenLands(cwd,
    'git commit -m "fix: belongs to the paired repo"',
    "fix: belongs to the paired repo");
  assert.doesNotMatch(detourLog(cwd), /paired\.txt/,
    "the other repo's file must never appear in this repo's trail");
});

test("commit-nudge does not log a DETOUR-COMMIT when the commit never landed (gh#65)", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  writeState(cwd, {
    version: 1, active: "paused-a", detourStack: [
      { pausedEpic: "paused-a", pausedAt: "2026-07-15T00:00:00Z", reason: "x", spawnedDetour: "detour-1", reconcileOnResume: false },
    ],
    epics: [
      { id: "paused-a", title: "paused-a", priority: "P1", status: "paused", role: "epic", lane: "claude-code", links: [], reconcileNeeded: false },
      { id: "detour-1", title: "detour-1", priority: "P1", status: "active", role: "epic", lane: "claude-code", links: [], reconcileNeeded: false },
    ],
  });
  gitRepo(cwd);
  const cmd = 'git commit -m "fix: this one was rejected too"';
  // As in assertSuppressedThenLands: give HEAD a small, differently-subjected commit first, or
  // the file-count rule suppresses the entry for us and the assertion proves nothing. (The
  // DETOUR-COMMIT path does not consult looksLikeUnloggedMinimalDetour, but keeping the two
  // fixtures identical means one less way for these tests to diverge silently.)
  commitFiles(cwd, { "prior.txt": "1" }, "chore: an unrelated prior commit");
  run(["commit-nudge"], { cwd, input: JSON.stringify({ tool_input: { command: cmd } }) });
  assert.doesNotMatch(detourLog(cwd), /DETOUR-COMMIT/,
    "the detour trail must not record a commit that never landed either");

  // Positive control, as above: inside a detour the landed commit takes the DETOUR-COMMIT path
  // rather than AUTO-DETOUR, so assert on that specifically.
  commitFiles(cwd, { "landed.txt": "1" }, "fix: this one was rejected too");
  run(["commit-nudge"], { cwd, input: JSON.stringify({ tool_input: { command: cmd } }) });
  assert.match(detourLog(cwd), /DETOUR-COMMIT/,
    "control failed: this fixture never records a DETOUR-COMMIT, so the assertion above proved nothing");
});

test("commit-nudge still logs a genuine landed commit (the guard must not silence the real case)", () => {
  const cwd = tmpRepo(); run(["init"], { cwd }); gitRepo(cwd);
  commitFiles(cwd, { "a.txt": "1" }, "fix: a real landed detour");
  run(["commit-nudge"], { cwd, input: JSON.stringify({
    tool_input: { command: 'git commit -m "fix: a real landed detour"' } }) });
  assert.match(detourLog(cwd), /AUTO-DETOUR/);
  assert.match(detourLog(cwd), /a real landed detour/);
});

// ── C1: every commit in this repo has a BODY, and the guard was suppressing all of them ──
// `git log -1 --format=%s` returns only the first line, but the `-m` capture uses [^"]* which
// spans newlines and swallows the whole message. Comparing those directly can never match for a
// commit with a body -- so the guard silently killed commit-nudge for the common case: no
// nudge, no DETOUR-COMMIT trail, and no archived-epic self-heal. Five task reviews missed it
// because every positive control here used a single-line -m.

test("commit-nudge still logs a landed commit whose message has a BODY (C1)", () => {
  const cwd = tmpRepo(); run(["init"], { cwd }); gitRepo(cwd);
  const subject = "fix: a landed detour with a body";
  const message = `${subject}\n\nSome explanatory body.\nClaude-Session: https://example.com/x`;
  commitFiles(cwd, { "a.txt": "1" }, message);
  run(["commit-nudge"], { cwd, input: JSON.stringify({
    tool_input: { command: `git commit -m "${message}"` } }) });
  assert.match(detourLog(cwd), /AUTO-DETOUR/,
    "a multi-line commit message must not silently disable the hook");
  assert.match(detourLog(cwd), /a landed detour with a body/);
});

test("commit-nudge does not suppress a -F commit, which has no -m to parse at all (C1)", () => {
  const cwd = tmpRepo(); run(["init"], { cwd }); gitRepo(cwd);
  commitFiles(cwd, { "a.txt": "1" }, "fix: built by a heredoc");
  // NOTE this reaches the unverifiable rung via the EMPTY-SUBJECT branch, not via shellBuilt --
  // `-F -` has no `-m`, so the regex never matches. Named accordingly after a review found the
  // original name ("shell-assembled message") claimed a code path this input never touches; the
  // shellBuilt rung is covered by the `-m "$(...)"` test below.
  const out = run(["commit-nudge"], { cwd, input: JSON.stringify({
    tool_input: { command: `git commit -q -F - <<'MSG'\nfix: built by a heredoc\nMSG` } }) });
  assert.ok(out.includes("hookSpecificOutput"),
    "a message we cannot read must not silence the hook");
});

test("commit-nudge treats a heredoc-assembled -m message as UNVERIFIABLE via shellBuilt (C1)", () => {
  const cwd = tmpRepo(); run(["init"], { cwd }); gitRepo(cwd);
  commitFiles(cwd, { "a.txt": "1" }, "fix: assembled by a command substitution");
  // This IS the shellBuilt path: there is a -m, and what it captures is shell source rather
  // than the text git received. HEAD holds a different string, so without shellBuilt this
  // would be wrongly contradicted and the hook silenced.
  const out = run(["commit-nudge"], { cwd, input: JSON.stringify({
    tool_input: { command: `git commit -m "$(cat <<'EOF'\nfix: assembled by a command substitution\nEOF\n)"` } }) });
  assert.ok(out.includes("hookSpecificOutput"),
    "a -m whose value the shell built must take the unverifiable rung, not be contradicted");
});

test("commit-nudge treats -m \"$(...)\" as UNVERIFIABLE rather than a mismatch (C1)", () => {
  const cwd = tmpRepo(); run(["init"], { cwd }); gitRepo(cwd);
  commitFiles(cwd, { "a.txt": "1" }, "fix: from a subshell");
  const out = run(["commit-nudge"], { cwd, input: JSON.stringify({
    tool_input: { command: 'git commit -m "$(cat /tmp/msg.txt)"' } }) });
  assert.ok(out.includes("hookSpecificOutput"),
    "a $(...) message is shell source, not the commit subject -- must not be treated as contradicted");
});

test("a trailing space in -m does not suppress a landed commit (C1)", () => {
  const cwd = tmpRepo(); run(["init"], { cwd }); gitRepo(cwd);
  commitFiles(cwd, { "a.txt": "1" }, "fix: trailing space case");
  run(["commit-nudge"], { cwd, input: JSON.stringify({
    tool_input: { command: 'git commit -m "fix: trailing space case "' } }) });
  assert.match(detourLog(cwd), /AUTO-DETOUR/, "the parsed subject must be trimmed like %s is");
});
