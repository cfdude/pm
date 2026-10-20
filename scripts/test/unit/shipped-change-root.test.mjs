// scripts/test/unit/shipped-change-root.test.mjs
// dehardcode-openspec-change-root-in-instructions, task 1.1 (UNIT twin) — the RENDERED rules block and the
// brief carry no pinned change path, on every platform, with every opt-in on and with none. UNIT rung: the
// block is a pure function of its arguments and the brief is a value over an in-memory record.

import assert from "node:assert/strict";
import { emptyRecord, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";
import { KNOWN_PLATFORMS } from "../../lib/constants.mjs";
import { rulesBlock } from "../../lib/rules.mjs";
import { pinnedPaths } from "../fixtures/change-root-sweep.mjs";

unitTest("1.1 the rules block carries no pinned path on any platform, opt-ins on or off", () => {
  assert.ok(KNOWN_PLATFORMS.length > 0);
  for (const platform of KNOWN_PLATFORMS) {
    for (const [name, block] of [
      ["plain", rulesBlock(null, "standard", [], platform)],
      ["all on", rulesBlock({ system: "github-issues", scope: "a/b" }, "thorough", [{ system: "jira", scope: "X" }], platform, null, true, true)],
    ]) {
      assert.deepEqual(pinnedPaths(block), [], `${platform} (${name})`);
    }
  }
});

unitTest("1.1 the SessionStart brief carries no pinned path", () => {
  const engine = memoryEngine({ ...emptyRecord() });
  const out = JSON.parse(engine(["brief"])).hookSpecificOutput.additionalContext;
  assert.ok(out.length > 0);
  assert.deepEqual(pinnedPaths(out), []);
});
