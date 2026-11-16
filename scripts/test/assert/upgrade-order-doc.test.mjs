// scripts/test/assert/upgrade-order-doc.test.mjs
// gh-cfdude-pm-262 task 7.1 (FILE rung): step 4 of commands/upgrade.md says to run `openspec update` BEFORE /pm:upgrade, previews with
// --dry-run, keeps the engine-never-runs-it fact, and names the residual and missing lines; the brief's HOLD no longer tells the reader to wait.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "../fixtures/assert-harness.mjs";
import { engineCode } from "../fixtures/source-code.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const upgrade = fs.readFileSync(path.join(ROOT, "commands", "upgrade.md"), "utf8");
const step4 = upgrade.slice(upgrade.indexOf("4. **Act on any OpenSpec drift line"), upgrade.indexOf("5. **Commit what the upgrade just rewrote"));

test("7.1 step 4 puts `openspec update` before /pm:upgrade and previews it with --dry-run", () => {
  assert.ok(step4.length > 200, "step 4 located");
  assert.match(step4, /Run `openspec update` FIRST, then `\/pm:upgrade`/);
  assert.match(step4, /openspec update --dry-run/);
});

test("7.1 step 4 keeps the engine-never-runs-it fact, and drops the wait-and-copy-aside instructions", () => {
  assert.match(step4, /pm's ENGINE never runs\s+`openspec update`/);
  assert.doesNotMatch(step4, /Do not run `openspec update` yet/);
  assert.doesNotMatch(step4, /Copy `\.claude\/skills\/openspec-\*`/);
});

test("7.1 step 4 names the residual and the missing line", () => {
  assert.match(step4, /OpenSpec addenda RESIDUAL/);
  assert.match(step4, /OpenSpec addenda MISSING/);
});

test("7.1 the engine's HOLD line no longer tells the reader to wait", async () => {
  const src = engineCode("scripts/lib/tool-currency.mjs");
  assert.doesNotMatch(src, /HOLD until/);
  assert.match(src, /HOLD — .*in flight: review before running/s);
});
