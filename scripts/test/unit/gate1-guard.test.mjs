// scripts/test/unit/gate1-guard.test.mjs
// openspec-gate1-guard-on-apply, the VALUE rung: the predicate over an INJECTED list of change directories
// (no disk). The verb-level half is scripts/test/assert/gate1-activation-guard.test.mjs.

import assert from "node:assert/strict";
import { unitTest } from "../fixtures/unit-harness.mjs";

const GUARD = new URL("../../lib/gate1-guard.mjs", import.meta.url).href;
const epic = (over = {}) => ({ id: "feat", lane: "openspec", status: "queued", ...over });
const on = ["feat"];

unitTest("gate1ActivationGap: openspec-lane + change on disk + no passing Gate 1 is a gap, named by cause", async () => {
  const { gate1ActivationGap } = await import(GUARD);
  assert.match(gate1ActivationGap(epic(), on), /no Gate 1/);
  assert.match(gate1ActivationGap(epic({ gateReview: { gate1: { verdict: "fail" } } }), on), /'fail', not pass/);
  assert.match(gate1ActivationGap(epic({ withdrawnGateReviews: [{ gate: 1, reason: "r" }] }), on), /withdrawn/);
  // a lane-less epic is openspec-lane (isOpenspecLane), so it is held to the same demand
  assert.match(gate1ActivationGap({ id: "feat", status: "queued" }, on), /no Gate 1/);
});

unitTest("gate1ActivationGap: pass, waiver, no change on disk, and other lanes are all clear; a stale pass is NOT refused", async () => {
  const { gate1ActivationGap } = await import(GUARD);
  assert.equal(gate1ActivationGap(epic({ gateReview: { gate1: { verdict: "pass", artifactDigests: [{ path: "x", sha256: "old" }] } } }), on), null);
  assert.equal(gate1ActivationGap(epic({ gate1Waived: "doc-only" }), on), null);
  assert.equal(gate1ActivationGap(epic(), []), null, "pre-propose");
  assert.equal(gate1ActivationGap(epic({ lane: "superpowers" }), on), null);
  assert.notEqual(gate1ActivationGap(epic({ gate1Waived: "   " }), on), null, "a blank waiver counts for nothing");
});

unitTest("gate1ActivationRefusal names the SAME remedy gateRemedy prints, plus the waiver line; creating swaps it", async () => {
  const { gate1ActivationRefusal } = await import(GUARD);
  const m = gate1ActivationRefusal(epic(), { changeIds: on });
  assert.match(m, /`record-gate-review feat --gate 1 --verdict pass --artifact <path>`/);
  assert.match(m, /`update-epic feat --status active --gate1-waived "<why Gate 1 does not apply>"`/);
  const c = gate1ActivationRefusal(epic(), { creating: true, changeIds: on });
  assert.match(c, /Register it at another status/);
  assert.doesNotMatch(c, /--gate1-waived/);
  assert.equal(gate1ActivationRefusal(epic({ gate1Waived: "x" }), { changeIds: on }), null);
});
