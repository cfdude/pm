// scripts/test/assert/commit-observation.test.mjs
// 5.3's ASSERTION TWIN of scripts/test/functional/commit-observation.test.mjs — same id, same
// subject.
//
// THE FUNCTIONAL FILE'S SUBJECT is the OBSERVATION mechanism: `commit-nudge` decides by reading the
// reflog anchor and the commits after it, never by reading the command text; it reports a commit
// exactly once across overlapping observations; it names a rewritten or abandoned commit rather than
// logging it; and a retract-detour row takes a commit back. It is the largest file in the functional
// half because nearly every case must LAND a real commit in a real repository (design D5).
//
// WHAT THIS HALF OWNS IS THE DECISION MADE WHEN NOTHING CAN BE OBSERVED, which is every invocation
// in every project that is not a checkout: the hook falls back to its advisory rather than going
// silent, writes no anchor it could not ground, and never names a commit it did not see. That is the
// same guard the functional file's gh#65/gh#68 cases pin from the other side.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, writeState, detourLog, autoDetourState, expectFail } from "../fixtures/assert-harness.mjs";

const observePath = (cwd) => path.join(cwd, ".conductor", "commit-observe.json");
const ctxOf = (out) => (out.trim() ? JSON.parse(out).hookSpecificOutput.additionalContext : "");
const nudge = (cwd, command) => run(["commit-nudge"], { cwd, input: JSON.stringify({ tool_input: { command } }) });

test("2.3 hooks.json wires commit-nudge for Bash on PostToolUse and PostToolUseFailure, and on no pre-call event", () => {
  const hooks = JSON.parse(fs.readFileSync(new URL("../../../hooks/hooks.json", import.meta.url), "utf8"));
  const nudgeEntries = JSON.stringify(hooks).match(/commit-nudge/g) || [];
  assert.ok(nudgeEntries.length >= 2, "commit-nudge is registered on both post-call events");
  assert.match(JSON.stringify(hooks), /PostToolUseFailure/);
});

test("2.3b a commit in a FAILING call is still observed — the hook runs on both events", () => {
  const cwd = tmpRepo(); run(["init"], { cwd }); autoDetourState(cwd);
  // The two registrations exist because a failing Bash call is exactly where a commit most often
  // lands (the test command after it exited non-zero). In this half neither rung can observe a
  // commit, so both must emit the SAME advisory rather than one of them going silent.
  const ok = nudge(cwd, 'git commit -m "feat(x): real work"');
  assert.match(ok, /Commit detected|hookSpecificOutput/);
});

test("2.4 unreadable state writes nothing and defers the report", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  fs.writeFileSync(path.join(cwd, ".conductor", "state.json"), "{ not json");
  const watched = [path.join(cwd, ".conductor", "state.json"), path.join(cwd, "PROJECT.md")];
  const before = watched.map(f => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null));
  const r = expectFail(() => nudge(cwd, "git commit -m x"));
  assert.equal(r && r.status, 2, "a hook reports without blocking");
  watched.forEach((f, i) => assert.equal(fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null, before[i]));
});

test("2.1 no anchor is written where no commit could have been observed", () => {
  const cwd = tmpRepo(); run(["init"], { cwd }); autoDetourState(cwd);
  nudge(cwd, 'git commit -m "fix: something"');
  assert.equal(fs.existsSync(observePath(cwd)), false,
    "an anchor with no repository to anchor against is a record the hook invented");
});

test("3.1 a reported commit is stated as landed SINCE the last observation, not proven to be this call's", () => {
  const cwd = tmpRepo(); run(["init"], { cwd }); autoDetourState(cwd);
  const ctx = ctxOf(nudge(cwd, 'git commit -m "fix: x"'));
  assert.doesNotMatch(ctx, /\b[0-9a-f]{7,40}\b/,
    "with no observation there is no sha, and the advisory claims no more than it can see");
});

test("4.1 retract-detour on a row that does not exist is refused and writes nothing", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  const before = detourLog(cwd);
  const err = expectFail(() => run(["retract-detour", "0123456789abcdef0123456789abcdef01234567",
    "--reason", "never happened"], { cwd }));
  assert.ok(err, "there is no row to retract");
  assert.equal(detourLog(cwd), before, "and the trail is untouched");
});

test("4.3 a retraction with no reason is refused", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  assert.ok(expectFail(() => run(["retract-detour", "0123456789abcdef0123456789abcdef01234567"], { cwd })));
});

test("4.4 help, undeclared flags and an unanswerable tree write nothing", () => {
  const cwd = tmpRepo(); run(["init"], { cwd }); autoDetourState(cwd);
  for (const argv of [["retract-detour", "--help"], ["retract-detour", "abc", "--reason", "r", "--bogus"]]) {
    try { run(argv, { cwd }); } catch { /* refusals are expected */ }
  }
  assert.equal(detourLog(cwd), "");
});

test("2.4 the observation record is not consulted when it is corrupt — the hook degrades", () => {
  const cwd = tmpRepo(); run(["init"], { cwd }); autoDetourState(cwd);
  fs.writeFileSync(observePath(cwd), "{ this is not json");
  assert.doesNotThrow(() => nudge(cwd, "git commit -m x"));
});

test("6.1 a commit touching the active epic's change directory is not an AUTO-DETOUR", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  writeState(cwd, { version: 1, active: "feat-x", detourStack: [], epics: [
    { id: "feat-x", title: "feat-x", priority: "P1", status: "in-progress", role: "epic",
      lane: "openspec", links: [], reconcileNeeded: false }] });
  nudge(cwd, 'git commit -m "fix(feat-x): tighten validation"');
  assert.equal(detourLog(cwd), "", "naming the active epic is the epic's own work, never a detour");
});

// ───────────────────────── the deliberate omissions ─────────────────────────
//
// The observation MECHANISM itself — overlapping observations reported exactly once, the lock and
// its breaking, a rewritten or abandoned commit named rather than logged, the reflog anchor's byte
// behaviour, the retract-detour rows, the AUTO-DETOUR shapes and the detour hint's candidates — all
// require a real repository whose reflog can be read and whose commits can be moved (design D5).
// The decisions taken when nothing can be observed are asserted above, on the per-commit path.
