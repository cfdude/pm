// scripts/test/unit/conductor-26.test.mjs
// 4.1's migration of `assert/conductor-26.test.mjs` — 5 of its 6 tests, moved from the file rung to
// the unit rung with every assertion unchanged.
//
// 5.3's ASSERTION TWIN of scripts/test/functional/conductor-26.test.mjs — same id, same subject.
//
// THE SUBJECT is gh#129's commit-time attribution nudge: the clause appended to commit-nudge's
// advisory, and — the half this twin is for — EVERY PLACE IT MUST BE ABSENT. "A nudge naming a wrong
// sha on an append-only array is worse than no nudge at all," so the negative cases are the
// load-bearing ones, and the strongest of them is the one this half lives in.
//
// ALL FOUR SILENT RUNGS ARE REACHABLE HERE WITHOUT A REPOSITORY:
//   (a) no active epic            — record-only;
//   (a2) a detour frame naming a ghost id — record-only;
//   (b) attributedCommits ABSENT  — record-only;
//   (c) UNVERIFIABLE: no watermark yet, so nothing was observed to land — which is EVERY invocation
//       in this half, because there is no HEAD to observe. A sha must never be named: "unverifiable
//       is not a quiet yes".
//
// FIVE moved, and the fixture is the reason each could: `rootWith()` wrote a RECORD and nothing else,
// so the record is what the memory store is seeded with. The ONE that stays is the unreadable-state
// rung — raw bytes that cannot parse, which the memory store holds no way to express.

import assert from "node:assert/strict";
import { memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

const ctxOf = (out) => (out.trim() ? JSON.parse(out).hookSpecificOutput.additionalContext : "");
const nudge = (engine, command) =>
  engine(["commit-nudge"], { input: JSON.stringify({ tool_input: { command } }) });

/** An initialized root with one epic in the given state, no repository above it. */
function rootWith(epic, extra = {}) {
  return memoryEngine({ version: 1, active: epic ? epic.id : null, detourStack: [], epics: epic ? [epic] : [], ...extra });
}

unitTest("gh#129: with no observation, NO sha is named — the unverifiable rung still emits its advisory", () => {
  const engine = rootWith({ id: "epic-a", title: "epic-a", priority: "P1", status: "active", role: "epic",
    lane: "openspec", links: [], reconcileNeeded: false, attributedCommits: [] });
  const ctx = ctxOf(nudge(engine, "git commit -m 'feat(x): real work'"));
  assert.match(ctx, /Commit detected/, "the legacy rung still runs — this is a no-regression check");
  assert.doesNotMatch(ctx, /--attribute-commit/,
    "unverifiable is not a quiet yes: no observation, no sha, no obligation asserted");
});

unitTest("gh#129: no active epic — naming one would be the engine inventing the attribution", () => {
  const engine = rootWith(null);
  assert.doesNotMatch(ctxOf(nudge(engine, "git commit -m x")), /--attribute-commit/);
});

unitTest("gh#129: a detour frame naming an epic the record does not hold produces no command", () => {
  const engine = memoryEngine({
    version: 1, active: null,
    detourStack: [{ pausedEpic: "gone", pausedAt: "2026-08-28T00:00:00Z", reason: "x", spawnedDetour: "ghost-detour", reconcileOnResume: false }],
    epics: [],
  });
  assert.doesNotMatch(ctxOf(nudge(engine, "git commit -m x")), /--attribute-commit/,
    "an id that names no epic must produce no command, not a command against a record that is not there");
});

unitTest("gh#129: an ABSENT attributedCommits array asserts nothing — the epic predates attribution", () => {
  // state.mjs deliberately leaves the array off archive-backfilled epics; asserting an obligation
  // there would convert the staleness gate's one forgiven case into a repo-wide false positive.
  const epic = { id: "epic-a", title: "epic-a", priority: "P1", status: "active", role: "epic",
    lane: "openspec", links: [], reconcileNeeded: false };
  const engine = rootWith(epic);
  assert.equal(Object.hasOwn(engine.store.record().epics[0], "attributedCommits"), false,
    "the fixture must genuinely omit the array, or this test passes for the wrong reason");
  assert.doesNotMatch(ctxOf(nudge(engine, "git commit -m x")), /--attribute-commit/);
});

unitTest("gh#129: a Bash call that merely mentions git commit names no sha, on either rung (gh#104)", () => {
  const engine = rootWith({ id: "epic-a", title: "epic-a", priority: "P1", status: "active", role: "epic",
    lane: "openspec", links: [], reconcileNeeded: false, attributedCommits: [] });
  // With a repository present and a primed watermark the functional file asserts TOTAL silence
  // here. In this half there is no HEAD to observe, so the legacy text rung answers instead — and
  // the obligation this file is about must still be absent from it, which is the gh#104 rule.
  const ctx = ctxOf(nudge(engine, "echo 'run git commit -m ok'"));
  assert.doesNotMatch(ctx, /--attribute-commit/);
  assert.doesNotMatch(ctx, /[0-9a-f]{7,40}/, "no rung may name a commit value it did not observe");
});
