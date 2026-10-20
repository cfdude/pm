// scripts/test/unit/spend-guard-liveness.test.mjs
// spend-guard-rules-section-follows-live-limits, task 1.1 — guardLivenessChanged(before, after) is true
// exactly when guardConfigured() differs between two record images. UNIT rung: two values in, a boolean out.

import assert from "node:assert/strict";
import { unitTest } from "../fixtures/unit-harness.mjs";
import { guardConfigured, guardLivenessChanged } from "../../lib/spend-guard.mjs";

const epic = (id, status, spendGuard) => ({ id, status, ...(spendGuard ? { spendGuard } : {}) });
const withEpic = (status, extra = {}) => ({ epics: [epic("e", status, { maxFailedRounds: 2 })], ...extra });

unitTest("1.1 archiving the only epic that holds a limit changes liveness (true -> false)", () => {
  assert.equal(guardLivenessChanged(withEpic("queued"), withEpic("archived")), true);
});

unitTest("1.1 un-archiving it changes liveness the other way (the inverse)", () => {
  assert.equal(guardLivenessChanged(withEpic("archived"), withEpic("untriaged")), true);
});

unitTest("1.1 removing the epic that holds the only limit changes liveness", () => {
  assert.equal(guardLivenessChanged(withEpic("queued"), { epics: [] }), true);
});

unitTest("1.1 a project limit present throughout never changes liveness, whatever the epics do", () => {
  const project = { spendGuard: { maxFailedRounds: 2 } };
  assert.equal(guardLivenessChanged({ ...project, epics: [epic("e", "queued")] }, { ...project, epics: [epic("e", "archived")] }), false);
  assert.equal(guardLivenessChanged({ ...project, epics: [epic("e", "queued")] }, { ...project, epics: [] }), false);
});

unitTest("1.1 a status change that leaves liveness alone is false (queued -> active, still live)", () => {
  assert.equal(guardLivenessChanged(withEpic("queued"), withEpic("active")), false);
});

unitTest("1.1 it is exactly the difference of guardConfigured, including a warnAt-only layer (no limit)", () => {
  const a = { spendGuard: { warnAt: 70 }, epics: [] };
  const b = { spendGuard: { warnAt: 70, maxFailedRounds: 1 }, epics: [] };
  assert.equal(guardConfigured(a), false);
  assert.equal(guardLivenessChanged(a, b), true);
  assert.equal(guardLivenessChanged(a, a), false);
});
