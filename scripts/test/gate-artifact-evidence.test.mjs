// scripts/test/gate-artifact-evidence.test.mjs
// gh#191 — 0.41.0 added `--artifact` as Gate 1's evidence form (gh#177) and updated the WRITER and
// the RENDERER. `integrity`'s `gate-recorded-as-bookkeeping` check is a third READER of the same
// field, one call away, and kept the range-only definition — so it never skipped an artifact-only
// verdict and reported a correctly-run Gate 1 as bookkeeping.
//
// It fired on the FIRST real use: the Gate 1 for `detached-head-is-not-a-workspace`, two lenses,
// six Criticals closed, verdict recorded straight after the commit that closed them.
//
// THE ARM'S PREMISE INVERTS FOR GATE 1. Its own comment says "a verdict CARRYING checkable
// evidence is exempt, and that exemption is what keeps this arm from firing on compliance", and
// reasons that a real review is dated after the last commit it names. For GATE 2 the loop is
// commit → review, so the premise holds. For a GATE 1 recorded with artifacts the loop is write →
// commit → review → FIX THE FINDINGS → commit the fixes → record, so the verdict necessarily
// post-dates the last attributed commit. Recording it earlier would mean recording a verdict for
// artifacts nobody had corrected yet.
//
// The fix is ONE call site, not a predicate rewrite. `gateHasEvidence` means "carries a checkable
// COMMIT RANGE" and two of its four callers dereference `entry.headSha` on the next line —
// widening it would hand them `undefined`, which is the same defect one layer down. This check
// asks a different question: "does this verdict carry evidence of a real review AT ALL".

import "./hermetic-git.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { runIntegrity } from "../lib/integrity.mjs";
import { ROOT } from "../lib/constants.mjs";

// REAL commits of the repository the engine reads (gates-bind-to-verified-evidence 4.7 / Gate 2 m7):
// the arms here ask git for a commit's date, and a stored `HEAD` or fake `aaaaaaa` is now never
// handed to git at all, so a literal would disarm the check this file exists to exercise.
const HEAD_SHA = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
const PARENT_SHA = execFileSync("git", ["rev-parse", "HEAD~1"], { cwd: ROOT, encoding: "utf8" }).trim();

const findingsFor = (id, state) => {
  const c = runIntegrity(state).find(x => x.id === id);
  assert.ok(c, `no check registered as ${id}`);
  return c.findings;
};

const epic = (gate1) => ({
  version: 1, active: null, detourStack: [], epics: [{
    id: "spec-epic", title: "t", priority: "P1", status: "queued", role: "epic",
    lane: "openspec", links: [], attributedCommits: [HEAD_SHA], gateReview: { gate1 },
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
  const st = epic({
    verdict: "pass", reviewedAt: new Date(Date.now() + 86400000).toISOString(),
  });
  const found = findingsFor("gate-recorded-as-bookkeeping", st);
  assert.equal(found.length, 1,
    "the arm exists for verdicts with no evidence of any kind, written after the fact to satisfy " +
    "a gate — widening the exemption must not disarm it");
});

test("gh-191: an EMPTY artifact array is not evidence", () => {
  const st = epic({
    verdict: "pass", reviewedAt: new Date(Date.now() + 86400000).toISOString(), artifacts: [],
  });
  assert.equal(findingsFor("gate-recorded-as-bookkeeping", st).length, 1,
    "a present-but-empty array is the shape a careless writer produces; it asserts nothing and " +
    "must not buy an exemption");
});

test("gh-191: the range exemption is unchanged", () => {
  const st = epic({
    verdict: "pass", reviewedAt: new Date(Date.now() + 86400000).toISOString(),
    baseSha: PARENT_SHA, headSha: HEAD_SHA,
  });
  assert.deepEqual(findingsFor("gate-recorded-as-bookkeeping", st), [],
    "Gate 2's evidence form keeps working exactly as before");
});
