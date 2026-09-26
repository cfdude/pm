// scripts/test/assert/conductor-14.test.mjs
// 5.3's ASSERTION TWIN of scripts/test/functional/conductor-14.test.mjs — same id, same subject.
//
// THE FUNCTIONAL FILE'S SUBJECT is three things about a tracker: a description/notes are
// independent fields on an epic, DIRECTION (inward vs outward) is what decides which procedure a
// tracker gets rather than the vendor name, and the inward pull's emitted recipe runs as written.
// The first two are pure state, the third is emitted text; only the recipes' execution needs a
// shell, and that is functional-only (it runs through `sh`).
//
// A DIRECTIONAL TRACKER IS A CONSEQUENTIAL THING TO GET WRONG — it decides whether pm tells an agent
// to CREATE issues or to READ them — so this belongs on the per-commit path.
//
// ─────────────── 4.1 SPLIT THIS FILE, AND THIS IS THE FILE-RUNG HALF ───────────────
//
// TWELVE of its seventeen tests moved to `scripts/test/unit/conductor-14.test.mjs` — the four
// description/notes tests, the four `--direction`-by-record tests (whose fixtures install a tracker
// straight into the record), the `externalUpdatedAt` round trip, the two emitted-recipe tests, and the
// two-scope id test.
//
// FIVE STAY, and they are ONE seam edge: every one runs `set-tracker`, which refreshes the managed
// rules block as a side effect (`tracker.mjs:194` → `rules.mjs`'s `writeRules()` → `writeFileSync` on
// CLAUDE.md) — a repository file the store does not own. Same edge as conductor-04, conductor-05 and
// conductor-10.
//
// No assertion changed in either direction.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, readState, expectFail } from "../fixtures/assert-harness.mjs";

const repo = () => { const cwd = tmpRepo(); run(["init"], { cwd }); return cwd; };
const tracker = (cwd) => readState(cwd).tracker;
const stateBytes = (cwd) => fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");

// ─────────────────── direction ───────────────────

test("set-tracker records an explicit --direction on the primary tracker", () => {
  const cwd = repo();
  run(["set-tracker", "--system", "jira", "--direction", "outward"], { cwd });
  assert.equal(tracker(cwd).direction, "outward");
});
test("an invalid --direction exits non-zero and leaves state.tracker exactly as it was", () => {
  const cwd = repo();
  run(["set-tracker", "--system", "jira", "--direction", "outward"], { cwd });
  const before = stateBytes(cwd);
  assert.ok(expectFail(() => run(["set-tracker", "--system", "jira", "--direction", "sideways"], { cwd })));
  assert.equal(stateBytes(cwd), before);
});
test("a NEW primary tracker defaults to inward — the consequential direction must be chosen", () => {
  const cwd = repo();
  run(["set-tracker", "--system", "jira"], { cwd });
  assert.equal(tracker(cwd).direction, "inward");
});
test("a secondary tracker is pinned to inward — any other direction is refused", () => {
  const cwd = repo();
  assert.ok(expectFail(() => run(["set-tracker", "--secondary", "github-issues",
    "--system", "github-issues", "--direction", "outward"], { cwd })));
});
test("setting the primary tracker merges every unnamed field and never writes secondaryTrackers", () => {
  const cwd = repo();
  run(["set-tracker", "--system", "jira", "--project", "ABC"], { cwd });
  run(["set-tracker", "--intent", "paused:todo"], { cwd });  // a well-formed pair: a malformed one is refused now
  const t = tracker(cwd);
  assert.equal(t.system, "jira");
  assert.equal(t.projectKey, "ABC");
  assert.equal(t.secondaryTrackers, undefined);
});
