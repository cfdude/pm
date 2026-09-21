// scripts/test/detached-suppression.test.mjs
// gh#175 group 2 — session bookkeeping is not written into a tree nobody is working in.
//
// The criterion, from the spec: a file the engine writes that is PER-CHECKOUT, ENGINE-OWNED, and a
// record of WORK IN PROGRESS rather than of the project. Five sites meet it and are suppressed;
// three do not and keep writing, each for a stated reason (`write-conflicts` records a fact about
// the repository, `honcho-memories.log` is an outbox whose absence loses work, `render-stamp.json`
// is the project's own rendered output and is TRACKED — it is what the sibling warning is about).
//
// EVERY SCENARIO ASSERTS A POSITIVE HALF. An absence passes just as happily when the hook never
// fired, the repository is uninitialised, the directory is unwritable, or the feature does not
// exist — the vacuous-pass shape this repository has a standing rule against.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { tmpRepo, run, runCombined, readState } from "../fixtures/functional-harness.mjs";

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" });

/** An initialised pm repo with one commit, on a branch. */
function workspace() {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  git(cwd, "init", "-q", "-b", "main");
  git(cwd, "config", "user.email", "t@example.com");
  git(cwd, "config", "user.name", "t");
  git(cwd, "add", "-A");
  git(cwd, "commit", "-q", "-m", "one");
  return cwd;
}
/** The same tree, detached at its own HEAD — what `git checkout --detach --force <tag>` produces. */
function deployed() {
  const cwd = workspace();
  git(cwd, "checkout", "-q", "--detach", git(cwd, "rev-parse", "HEAD").trim());
  return cwd;
}
const at = (cwd, ...p) => path.join(cwd, ".conductor", ...p);
const exists = (cwd, ...p) => fs.existsSync(at(cwd, ...p));

test("the commit observation record is not written in a detached tree, and the hook still runs", () => {
  const cwd = deployed();
  const out = runCombined(["commit-nudge"], { cwd,
    input: JSON.stringify({ hook_event_name: "PostToolUseFailure", tool_name: "Bash", tool_input: { command: "false" } }) });
  assert.doesNotMatch(out, /Error|Traceback/, "the hook completes — absence must not come from a crash");
  assert.ok(!exists(cwd, "commit-observe.json"),
    "the reflog anchor tracks a session's own commits; a tree nobody works in has none to track");
});

test("the observation record IS written on a branch — the control that makes the absence mean something", () => {
  const cwd = workspace();
  runCombined(["commit-nudge"], { cwd,
    input: JSON.stringify({ hook_event_name: "PostToolUseFailure", tool_name: "Bash", tool_input: { command: "false" } }) });
  assert.ok(exists(cwd, "commit-observe.json"),
    "if this did not write either, the suppression test above would pass vacuously");
});

test("the detour log is not written in a detached tree, and the verb still reports", () => {
  const cwd = deployed();
  const out = runCombined(["log-detour", "a thing"], { cwd });
  assert.ok(!exists(cwd, "detours.log"), "a detour interrupts active work; there is none here");
  // Assert the verb's OWN line, not merely `conductor:` — the detached WARNING matches that too,
  // so the weaker form would pass even if the verb crashed right after warning.
  assert.match(out, /NOT logged/, "and it says so, rather than claiming a row it did not write");
  assert.doesNotMatch(out, /^conductor: logged minimal detour$/m,
    "the false-success line must be gone, not merely accompanied by a warning");
});

test("the detour log IS written on a branch", () => {
  const cwd = workspace();
  runCombined(["log-detour", "a thing"], { cwd });
  assert.ok(exists(cwd, "detours.log"));
});

test("the brief snapshot is not written in a detached tree, and snapshot still reports", () => {
  const cwd = deployed();
  const out = runCombined(["snapshot"], { cwd });
  assert.ok(!exists(cwd, "brief.txt"), "a snapshot is for the next session in this tree");
  assert.match(out, /snapshot NOT written/,
    "the verb's own line, and it tells the truth — `conductor:` alone is matched by the warning");
  assert.doesNotMatch(out, /snapshot written before compaction/, "the false line is gone");
});

test("the brief snapshot IS written on a branch", () => {
  const cwd = workspace();
  runCombined(["snapshot"], { cwd });
  assert.ok(exists(cwd, "brief.txt"));
});

test("the session claim is not written in a detached tree", () => {
  const cwd = deployed();
  const out = runCombined(["claim", "--repo", "--session", "s1"], { cwd });
  assert.ok(!exists(cwd, "session-claim.json"),
    "its own comment reads 'THIS session is mid-operation in THIS working tree' — the criterion " +
    "said aloud");
  // This assertion had NO completion half and that is exactly why it missed the verb announcing
  // "repository marked busy by 's1' until null" for a marker it never wrote.
  assert.match(out, /NOT recorded/, "and the verb says so instead of reporting a claim");
  assert.doesNotMatch(out, /marked busy/, "the false-success line is gone");
});

test("a tree git cannot answer about keeps writing — the safe direction", () => {
  // No git repository at all. `unknown` is not detachment, and a false suppression silently
  // disables the trail where a false record is visible and removable.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  runCombined(["snapshot"], { cwd });
  assert.ok(exists(cwd, "brief.txt"),
    "status 128 means git could not say, which must never be read as 'this is a deployment'");
});

test("the state of record is untouched by suppression", () => {
  const cwd = deployed();
  const before = JSON.stringify(readState(cwd));
  runCombined(["commit-nudge"], { cwd });
  runCombined(["snapshot"], { cwd });
  assert.equal(JSON.stringify(readState(cwd)), before,
    "suppression removes bookkeeping, never the record itself");
});

test("the session claim IS written on a branch — the control for its suppression", () => {
  // Added because the suppression assertion above passed BEFORE the suppression existed, which
  // means the absence was proving nothing. This is the half that makes it mean something.
  const cwd = workspace();
  runCombined(["claim", "--repo", "--session", "s1"], { cwd });
  assert.ok(exists(cwd, "session-claim.json"),
    "without this, 'no claim file in a detached tree' is satisfied by the verb never writing one");
});

test("commit-nudge in a detached tree does not fall back to the text heuristic", () => {
  // The record alone is not enough. Suppressing it leaves no anchor ever recorded, so every
  // run reads `no-anchor` / `unverifiable` and drops to unverifiableSubject() — gh#104's text
  // heuristic, where any command merely MENTIONING `git commit` nudges, reaching a state write on
  // the way. Asserted with the exact repro gh#104 was filed on.
  const cwd = deployed();
  const before = JSON.stringify(readState(cwd));
  const out = runCombined(["commit-nudge"], { cwd,
    input: JSON.stringify({ tool_input: { command: 'echo "run git commit -m x later"' } }) });
  assert.doesNotMatch(out, /update epic status|pop a finished detour|--attribute-commit/,
    "no nudge from command TEXT in a tree nobody is working in");
  assert.equal(JSON.stringify(readState(cwd)), before, "and no state write on the way");
});

test("commit-nudge DOES react on a branch — the control", () => {
  const cwd = workspace();
  fs.writeFileSync(path.join(cwd, "g.txt"), "two\n");
  git(cwd, "add", "-A");
  git(cwd, "commit", "-q", "-m", "fix(x): a real commit");
  const out = runCombined(["commit-nudge"], { cwd, input: JSON.stringify({ tool_input: { command: "git commit" } }) });
  assert.match(out, /conductor|commit/i,
    "if the hook said nothing here either, the suppression above would prove nothing");
});

test("the activity log is not written in a detached tree", () => {
  const cwd = deployed();
  runCombined(["set-activity-log", "on"], { cwd });
  runCombined(["add-epic", "--id", "a1", "--title", "t", "--lane", "claude-code", "--priority", "P2"], { cwd });
  assert.ok(!exists(cwd, "activity"),
    "a per-session event trail, and a tree nobody works in has no session to trail");
});

test("the activity log IS written on a branch — the control", () => {
  const cwd = workspace();
  runCombined(["set-activity-log", "on"], { cwd });
  runCombined(["add-epic", "--id", "a1", "--title", "t", "--lane", "claude-code", "--priority", "P2"], { cwd });
  assert.ok(exists(cwd, "activity"),
    "without this the suppression above is satisfied by the log never being written at all");
});

test("--steal does not announce a takeover that did not happen", () => {
  // The sharpest of the three: with a live claim by another session, the verb announced BOTH a
  // takeover and the new claim, and printed the OTHER session's expiry — internally plausible,
  // and therefore unreadable as wrong.
  const cwd = deployed();
  fs.mkdirSync(at(cwd), { recursive: true });
  fs.writeFileSync(at(cwd, "session-claim.json"), JSON.stringify({
    session: "held-by-other", expiresAt: new Date(Date.now() + 3600000).toISOString() }, null, 2));
  const out = runCombined(["claim", "--repo", "--session", "mine", "--steal"], { cwd });
  assert.doesNotMatch(out, /took over|STOLEN/, "nothing was taken over — the marker is unchanged");
  assert.match(out, /NOT recorded/);
  assert.match(JSON.parse(fs.readFileSync(at(cwd, "session-claim.json"), "utf8")).session,
    /held-by-other/, "and the other session's marker survives untouched");
});
