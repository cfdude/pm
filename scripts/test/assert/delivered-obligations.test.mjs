// scripts/test/assert/delivered-obligations.test.mjs
// 5.3's ASSERTION TWIN of scripts/test/functional/delivered-obligations.test.mjs — same id, same
// subject.
//
// THE FUNCTIONAL FILE'S SUBJECT is `deliveredObligations(epic, {carriedTo})` — THE one definition of
// the two obligations a `delivered` outcome carries. It is in the functional half because TWO of its
// six cases ask git whether a Gate 2's `headSha` REACHES the epic's attributed commits (the
// `isAncestor` walk), and it evaluated the function in a CHILD process because the root used to be
// resolved at module load.
//
// IN THIS HALF THE FUNCTION IS CALLED IN-PROCESS WITH THE INVOCATION SET, and the two ancestry cases
// are replaced by their git-free halves: the Gate 2 demand's MISSING case and the handoff demand,
// which are decided entirely from the record. The ancestry split is what the functional half is for
// (design D5); "deliveredObligations is the one definition both callers share" is what this half can
// prove on every commit.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeGit } from "../fixtures/fake-git.mjs";
import { setInvocation, installedInvocation } from "../../lib/invocation.mjs";
import { deliveredObligations } from "../../lib/archive-gate.mjs";
import { tmpRepo } from "../fixtures/assert-harness.mjs";

/** `deliveredObligations(epic, opts)` computed in-process, with THIS half's double as the gateway.
 *  The previous invocation is restored afterwards, so a direct lib call here cannot leak a context
 *  into the next test in the shared process. */
function obligations(epic, opts) {
  const cwd = tmpRepo();
  const before = installedInvocation();
  try {
    setInvocation({
      cwd, root: cwd, argv: ["node", "conductor.mjs"], env: { ...process.env, CLAUDE_PROJECT_DIR: cwd },
      stdin: { read: () => "", isTTY: false },
      stdout: { write: () => true }, stderr: { write: () => true },
      // The no-repository world (design D5): every git question answers 128, so the ancestry walk
      // reports "cannot answer" rather than a fabricated freshness.
      git: fakeGit({ noRepository: true }),
    });
    return deliveredObligations(epic, opts);
  } finally {
    setInvocation(before ?? { cwd, root: cwd, argv: [], env: process.env, stdin: { read: () => "", isTTY: false },
      stdout: { write: () => true }, stderr: { write: () => true } });
  }
}

const epic = (fields) => ({ id: "e", title: "e", priority: "P1", status: "archived", role: "epic", links: [], ...fields });

test("met: a lane with no Gate 2 obligation and no outstanding work fails nothing", () => {
  const met = epic({ lane: "claude-code", stories: [{ title: "done", done: true }] });
  assert.deepEqual(obligations(met, {}), []);
});

test("no Gate 2: the Gate 2 demand fails, with its finding as the detail", () => {
  const out = obligations(epic({ lane: "openspec" }), {});
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, "gate2");
  assert.match(out[0].detail, /missing a passing Gate 2/);
  assert.doesNotMatch(out[0].detail, /record-gate-review/, "the gate's remedy is not part of the finding");
  assert.deepEqual(out[0].items, []);
});

test("outstanding story: the handoff demand fails, carrying the titles as items and never in the detail", () => {
  const record = epic({ lane: "claude-code", stories: [{ title: "shipped", done: true }, { title: "left behind", done: false }] });
  const out = obligations(record, {});
  assert.deepEqual(out.map(o => o.kind), ["handoff"]);
  assert.deepEqual(out[0].items, [{ n: 2, title: "left behind" }]);
  assert.ok(!out[0].detail.includes("left behind"), "a user-supplied title is data, not part of the detail");
  assert.deepEqual(obligations(record, { carriedTo: "z" }), [], "a named receiver meets the handoff demand");
});

test("both failing: Gate 2 comes first", () => {
  const out = obligations(epic({ lane: "openspec", stories: [{ title: "left", done: false }] }), {});
  assert.deepEqual(out.map(o => o.kind), ["gate2", "handoff"]);
});

test("a non-delivered outcome is not tested: the same record reports identically", () => {
  const base = { lane: "openspec", stories: [{ title: "left", done: false }] };
  const delivered = obligations(epic({ ...base, disposition: { outcome: "delivered", recordedAt: "2026-09-14T00:00:00.000Z" } }), {});
  const superseded = obligations(epic({ ...base, disposition: { outcome: "superseded", reason: "r", recordedAt: "2026-09-14T00:00:00.000Z" } }), {});
  assert.deepEqual(superseded, delivered);
  assert.equal(superseded.length, 2);
});

// ───────────────────────── the deliberate omissions ─────────────────────────
//
// The functional file's "met" and "stale" cases both turn on whether a Gate 2's `headSha` REACHES the
// epic's attributed commits, which is `git merge-base --is-ancestor` — git's own behaviour, and this
// half's world has no repository to answer it (design D5). The functional file keeps them, evaluated
// against a real fixture repository.
