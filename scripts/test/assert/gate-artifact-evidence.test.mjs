// scripts/test/assert/gate-artifact-evidence.test.mjs
// 5.3's ASSERTION TWIN of scripts/test/functional/gate-artifact-evidence.test.mjs — same id, same
// subject.
//
// THE FUNCTIONAL FILE'S SUBJECT is gh#191: 0.41.0 added `--artifact` as Gate 1's evidence form and
// updated the WRITER and the RENDERER, while `integrity`'s `gate-recorded-as-bookkeeping` check — a
// third reader, one call away — kept the range-only definition and reported a correctly-run Gate 1
// as bookkeeping.
//
// `runIntegrity` READS FILES AND SPAWNS NOTHING, so the check is this half's to exercise on every
// commit. The only thing the functional file needed git for was a REAL commit value the arm could
// ask a date about; here the double answers that, and the value is taken FROM THE CAPTURE rather
// than typed — a literal sha would be a value no case in `fixtures/git-gateway-capture.json` holds,
// and the fake would throw rather than quietly answer.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeGit, loadCapture } from "../fixtures/fake-git.mjs";
import { setInvocation, installedInvocation } from "../../lib/invocation.mjs";
import { runIntegrity } from "../../lib/integrity.mjs";
import { tmpRepo } from "../fixtures/assert-harness.mjs";

/** One commit value the frozen capture holds an answer for, read from the capture itself. */
const CAPTURE = loadCapture();
const A_COMMIT = CAPTURE.operations.committerDate.cases[0].args[0];

/** Run integrity over `state` in-process, with this half's double as the gateway. */
function findingsFor(id, state) {
  const cwd = tmpRepo();
  const before = installedInvocation();
  try {
    setInvocation({
      cwd, root: cwd, argv: ["node", "conductor.mjs"], env: { ...process.env, CLAUDE_PROJECT_DIR: cwd },
      stdin: { read: () => "", isTTY: false },
      stdout: { write: () => true }, stderr: { write: () => true },
      // THE ARG-KEYED DOUBLE, not the no-repository one: this check asks git for a commit's DATE,
      // so the world it needs is the captured one — every argument here is a sha the capture holds
      // a case for, and no argument is a path, so the root list is empty.
      git: fakeGit({ roots: [] }),
    });
    const c = runIntegrity(state).find(x => x.id === id);
    assert.ok(c, `no check registered as ${id}`);
    // A check that could not run has no findings to compare; an empty list must never pass for one.
    assert.ok(!c.unavailable, `${id} could not run: ${c.unavailable}`);
    return c.findings;
  } finally {
    setInvocation(before ?? { cwd, root: cwd, argv: [], env: process.env, stdin: { read: () => "", isTTY: false },
      stdout: { write: () => true }, stderr: { write: () => true } });
  }
}

const epic = (gate1) => ({
  version: 1, active: null, detourStack: [], epics: [{
    id: "spec-epic", title: "t", priority: "P1", status: "queued", role: "epic",
    lane: "openspec", links: [], attributedCommits: [A_COMMIT], gateReview: { gate1 },
  }],
});

test("gh-191: a Gate 1 carrying ARTIFACT evidence is exempt from the bookkeeping arm", () => {
  const st = epic({
    verdict: "pass", reviewedAt: new Date(Date.now() + 86400000).toISOString(),
    artifacts: ["openspec/changes/x/proposal.md", "openspec/changes/x/specs/y/spec.md"],
    reviewer: "two fresh-context lenses",
  });
  assert.deepEqual(findingsFor("gate-recorded-as-bookkeeping", st), [],
    "artifacts ARE checkable evidence — the arm's own comment says a verdict carrying evidence is " +
    "exempt, and that exemption is what keeps it from firing on compliance");
});

test("gh-191: a verdict carrying NEITHER range nor artifacts still reports", () => {
  const st = epic({ verdict: "pass", reviewedAt: new Date(Date.now() + 86400000).toISOString() });
  assert.equal(findingsFor("gate-recorded-as-bookkeeping", st).length, 1,
    "the arm exists for verdicts with no evidence of any kind, written after the fact to satisfy " +
    "a gate — widening the exemption must not disarm it");
});

test("gh-191: an EMPTY artifact array is not evidence", () => {
  const st = epic({ verdict: "pass", reviewedAt: new Date(Date.now() + 86400000).toISOString(), artifacts: [] });
  assert.equal(findingsFor("gate-recorded-as-bookkeeping", st).length, 1,
    "a present-but-empty array is the shape a careless writer produces; it asserts nothing and " +
    "must not buy an exemption");
});

test("gh-191: the range exemption is unchanged", () => {
  const st = epic({
    verdict: "pass", reviewedAt: new Date(Date.now() + 86400000).toISOString(),
    baseSha: A_COMMIT, headSha: A_COMMIT,
  });
  assert.deepEqual(findingsFor("gate-recorded-as-bookkeeping", st), [],
    "Gate 2's evidence form keeps working exactly as before");
});

import { readFileSync } from "node:fs";

test("findingsFor refuses a check that could not run — an empty list never passes for it", () => {
  const src = readFileSync(new URL(import.meta.url), "utf8");
  assert.match(src, /assert\.ok\(!c\.unavailable/, "the helper asserts the check ran");
});
