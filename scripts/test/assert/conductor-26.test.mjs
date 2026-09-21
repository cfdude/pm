// scripts/test/assert/conductor-26.test.mjs
// 5.3's ASSERTION TWIN of scripts/test/functional/conductor-26.test.mjs — same id, same subject.
//
// THE FUNCTIONAL FILE'S SUBJECT is gh#129's commit-time attribution nudge: the clause appended to
// commit-nudge's advisory, and — the half this twin is for — EVERY PLACE IT MUST BE ABSENT. "A nudge
// naming a wrong sha on an append-only array is worse than no nudge at all," so the negative cases
// are the load-bearing ones, and the strongest of them is the one this half lives in.
//
// ALL FOUR SILENT RUNGS ARE REACHABLE HERE WITHOUT A REPOSITORY:
//   (a) no active epic            — record-only;
//   (a2) a detour frame naming a ghost id — record-only;
//   (b) attributedCommits ABSENT  — record-only;
//   (c) UNVERIFIABLE: no watermark yet, so nothing was observed to land — which is EVERY invocation
//       in this half, because there is no HEAD to observe. A sha must never be named: "unverifiable
//       is not a quiet yes".

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, writeState, expectFail } from "../fixtures/assert-harness.mjs";

const ctxOf = (out) => (out.trim() ? JSON.parse(out).hookSpecificOutput.additionalContext : "");
const nudge = (cwd, command) => run(["commit-nudge"], { cwd, input: JSON.stringify({ tool_input: { command } }) });

/** An initialized root with one epic in the given state, no repository above it. */
function rootWith(epic, extra = {}) {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  writeState(cwd, { version: 1, active: epic ? epic.id : null, detourStack: [], epics: epic ? [epic] : [], ...extra });
  return cwd;
}

test("gh#129: with no observation, NO sha is named — the unverifiable rung still emits its advisory", () => {
  const cwd = rootWith({ id: "epic-a", title: "epic-a", priority: "P1", status: "active", role: "epic",
    lane: "openspec", links: [], reconcileNeeded: false, attributedCommits: [] });
  const ctx = ctxOf(nudge(cwd, "git commit -m 'feat(x): real work'"));
  assert.match(ctx, /Commit detected/, "the legacy rung still runs — this is a no-regression check");
  assert.doesNotMatch(ctx, /--attribute-commit/,
    "unverifiable is not a quiet yes: no observation, no sha, no obligation asserted");
});

test("gh#129: no active epic — naming one would be the engine inventing the attribution", () => {
  const cwd = rootWith(null);
  assert.doesNotMatch(ctxOf(nudge(cwd, "git commit -m x")), /--attribute-commit/);
});

test("gh#129: a detour frame naming an epic the record does not hold produces no command", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  writeState(cwd, {
    version: 1, active: null,
    detourStack: [{ pausedEpic: "gone", pausedAt: "2026-08-28T00:00:00Z", reason: "x", spawnedDetour: "ghost-detour", reconcileOnResume: false }],
    epics: [],
  });
  assert.doesNotMatch(ctxOf(nudge(cwd, "git commit -m x")), /--attribute-commit/,
    "an id that names no epic must produce no command, not a command against a record that is not there");
});

test("gh#129: an ABSENT attributedCommits array asserts nothing — the epic predates attribution", () => {
  // state.mjs deliberately leaves the array off archive-backfilled epics; asserting an obligation
  // there would convert the staleness gate's one forgiven case into a repo-wide false positive.
  const epic = { id: "epic-a", title: "epic-a", priority: "P1", status: "active", role: "epic",
    lane: "openspec", links: [], reconcileNeeded: false };
  const cwd = rootWith(epic);
  assert.equal(Object.hasOwn(JSON.parse(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8")).epics[0], "attributedCommits"), false,
    "the fixture must genuinely omit the array, or this test passes for the wrong reason");
  assert.doesNotMatch(ctxOf(nudge(cwd, "git commit -m x")), /--attribute-commit/);
});

test("gh#129: a Bash call that merely mentions git commit names no sha, on either rung (gh#104)", () => {
  const cwd = rootWith({ id: "epic-a", title: "epic-a", priority: "P1", status: "active", role: "epic",
    lane: "openspec", links: [], reconcileNeeded: false, attributedCommits: [] });
  // With a repository present and a primed watermark the functional file asserts TOTAL silence
  // here. In this half there is no HEAD to observe, so the legacy text rung answers instead — and
  // the obligation this file is about must still be absent from it, which is the gh#104 rule.
  const ctx = ctxOf(nudge(cwd, "echo 'run git commit -m ok'"));
  assert.doesNotMatch(ctx, /--attribute-commit/);
  assert.doesNotMatch(ctx, /[0-9a-f]{7,40}/, "no rung may name a commit value it did not observe");
});

test("gh#129: the unreadable-state rung refuses with exit 2 and writes nothing", () => {
  const cwd = rootWith({ id: "epic-a", title: "epic-a", priority: "P1", status: "active", role: "epic",
    lane: "openspec", links: [], reconcileNeeded: false, attributedCommits: [] });
  fs.writeFileSync(path.join(cwd, ".conductor", "state.json"), "{ not json");
  const refused = expectFail(() => nudge(cwd, "git commit -m x"));
  assert.equal(refused && refused.status, 2);
});

// ───────────────────────── the deliberate omissions ─────────────────────────
//
// The functional file's two POSITIVE cases — "a real commit under an active epic names the exact
// attribute-commit line", and the empty-vs-non-empty catch-up rule — require a commit the hook can
// OBSERVE have landed, which is a real repository (design D5). The catch-up rule's own silence case
// (an epic that has attributed something) is the same observation gate, so it is functional-only
// too; every rung where the answer must be NO OBLIGATION is above.
