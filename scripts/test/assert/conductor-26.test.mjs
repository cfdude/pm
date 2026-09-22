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

// 4.1 (0.48.0) moved FIVE of this file's six tests to
// `scripts/test/unit/conductor-26.test.mjs`: the four SILENT RUNGS (no active epic, a detour frame
// naming a ghost id, an ABSENT attributedCommits array, and the unverifiable rung) plus the gh#104
// case where a Bash call merely mentions `git commit`. Every one of them is a record and a payload.
// THE ONE BELOW STAYS because it needs an unreadable record — raw bytes that cannot parse, which the
// memory store cannot hold; it answers "unreadable" only through `shapeProblem()`.

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
