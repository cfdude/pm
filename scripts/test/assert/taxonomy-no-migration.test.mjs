// release-planning-taxonomy 8.2 / V.4 (FILE rung): no MIGRATIONS entry is keyed to 0.56.0, because every new key is additive. The
// behavioural half (a 0.55.0-shaped record loads and every read verb succeeds on it) is unit/taxonomy-backward-compat.test.mjs.

import "../fixtures/assert-git-shim.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { engineCode } from "../fixtures/source-code.mjs";

test("8.2 no MIGRATIONS entry is keyed to 0.56.0", () => {
  const src = engineCode("scripts/lib/migrations.mjs");
  assert.doesNotMatch(src, /release:\s*"0\.56\.0"/);
  assert.match(src, /release:\s*"0\.55\.0"/, "the table is the one that holds the 0.55.0 entry, so this is not a vacuous read");
});
