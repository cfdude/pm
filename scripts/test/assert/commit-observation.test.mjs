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

// 4.1 (0.48.0) moved SIX of this file's ten tests to
// `scripts/test/unit/commit-observation.test.mjs`: a commit in a failing call, the advisory's no-sha
// claim, the retract-detour pair, the help/undeclared-flag sweep, and the "naming the active epic is
// not a detour" case — every one of them a value or a store-owned log read.
//
// THE FOUR BELOW STAY, and each names a path the store does not own: the shipped `hooks/hooks.json`
// registration; the unreadable-state row (raw bytes); the corrupt observation record, whose fixture
// WRITES `.conductor/commit-observe.json`; and "no anchor is written", whose observable is that same
// artifact's absence — `commit-observe.json` is not in the store's ARTIFACT table, so there is no
// store sibling to read it through.

test("2.3 hooks.json wires commit-nudge for Bash on PostToolUse and PostToolUseFailure, and on no pre-call event", () => {
  const hooks = JSON.parse(fs.readFileSync(new URL("../../../hooks/hooks.json", import.meta.url), "utf8"));
  const nudgeEntries = JSON.stringify(hooks).match(/commit-nudge/g) || [];
  assert.ok(nudgeEntries.length >= 2, "commit-nudge is registered on both post-call events");
  assert.match(JSON.stringify(hooks), /PostToolUseFailure/);
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

test("2.4 the observation record is not consulted when it is corrupt — the hook degrades", () => {
  const cwd = tmpRepo(); run(["init"], { cwd }); autoDetourState(cwd);
  fs.writeFileSync(observePath(cwd), "{ this is not json");
  assert.doesNotThrow(() => nudge(cwd, "git commit -m x"));
});

// ───────────────────────── the deliberate omissions ─────────────────────────
//
// The observation MECHANISM itself — overlapping observations reported exactly once, the lock and
// its breaking, a rewritten or abandoned commit named rather than logged, the reflog anchor's byte
// behaviour, the retract-detour rows, the AUTO-DETOUR shapes and the detour hint's candidates — all
// require a real repository whose reflog can be read and whose commits can be moved (design D5).
// The decisions taken when nothing can be observed are asserted above, on the per-commit path.

// sync-registers-ids-add-epic-refuses (0.50.0) — twin note for the functional file's fixture change.
// The one archive resolver now sets aside an archive directory dated more than a day before the epic's
// `createdAt`, and never ends an undated live epic on a bare name. The functional fixtures that
// registered an epic and then archived its change under a FIXED past date (or hand-wrote a live epic
// with no `createdAt`) described a history that cannot happen; they now date the directory with
// `archiveDay()` (fixtures/helpers.mjs) or give the epic an earlier `createdAt`. Their assertions are
// unchanged. The rule itself is asserted per commit in assert/sync-registration-ids.test.mjs.
