// scripts/test/unit/execution-profile-lists.test.mjs
// execution-profile-layered-settings 1.1 — the closed lists, declared once in constants.mjs.
// UNIT RUNG: the observable is a value the engine module exports.

import assert from "node:assert/strict";
import { unitTest } from "../fixtures/unit-harness.mjs";

const CONSTANTS = new URL("../../lib/constants.mjs", import.meta.url).href;

unitTest("the execution profile's closed lists are exactly the spec's", async () => {
  const c = await import(CONSTANTS);
  assert.deepEqual(c.KNOWN_MODELS, ["fable", "opus", "sonnet", "haiku"]);
  assert.deepEqual(c.KNOWN_EFFORTS, ["low", "medium", "high", "xhigh", "max", "ultracode"]);
  assert.deepEqual(c.MODELS_WITHOUT_EFFORT, ["haiku"]);
  assert.deepEqual(c.KNOWN_JOB_ROLES, ["implement", "test", "review"]);
  assert.deepEqual(c.KNOWN_VERBOSITY_LEVELS, ["quiet", "verbose"]);
});

unitTest("every model that takes no effort is a known model", async () => {
  const c = await import(CONSTANTS);
  for (const m of c.MODELS_WITHOUT_EFFORT) assert.ok(c.KNOWN_MODELS.includes(m), m);
});
