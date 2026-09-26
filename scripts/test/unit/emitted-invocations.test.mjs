// scripts/test/unit/emitted-invocations.test.mjs
// The UNIT-rung half of scripts/test/functional/emitted-invocations.test.mjs's assertion twin (the
// file-rung half is scripts/test/assert/emitted-invocations.test.mjs, which reads the shipped docs).
//
// The functional file's PRINTER_FIXTURES reaches every printed-invocation template; this carries the
// per-commit half of the ones whose observable is a VALUE — an exit status and a printed line — which
// is the unit rung's by CONTRIBUTING's rule, whatever its speed.

import assert from "node:assert/strict";
import { emptyRecord, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

// The one-item-one-epic refusal (tracker-item-dedup-bypassed) prints `update-epic <holder> --clear
// external-url`. Run exactly as printed, it must be accepted and must free the item.
unitTest("the tracker-item refusal's printed remedy runs as written and frees the item", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "th", "--lane", "claude-code", "--external-url", "https://x.test/1"]);
  const refused = engine.result(["add-epic", "--id", "t2", "--lane", "claude-code", "--external-url", "https://x.test/1"]);
  assert.notEqual(refused.status, 0);
  const printed = /`(update-epic [^`]+)`/.exec(refused.stderr);
  assert.ok(printed, `the refusal prints its remedy:\n${refused.stderr}`);
  engine(printed[1].split(" "));
  engine(["add-epic", "--id", "t2", "--lane", "claude-code", "--external-url", "https://x.test/1"]);
  assert.equal(engine.store.record().epics.find(e => e.id === "t2").externalUrl, "https://x.test/1");
});
