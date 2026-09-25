// scripts/test/assert/value-validation.test.mjs
// The add-many half of unit/value-validation.test.mjs: a batch document is a FILE the verb reads
// from disk, so this is the file rung. Same rule, same helper, the third writer: a batch entry's
// `priority` and `externalUpdatedAt` are refused the way `--priority` and `--external-updated-at`
// are, and a batch with one offender creates none of its entries.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, readState, expectFail } from "../fixtures/assert-harness.mjs";

function batch(cwd, epics) {
  const p = path.join(cwd, "batch.json");
  fs.writeFileSync(p, JSON.stringify({ epics }) + "\n");
  return p;
}

test("add-many refuses a batch entry's out-of-vocabulary priority or non-date watermark, and creates nothing", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  for (const bad of [{ priority: "banana" }, { externalId: "1", externalUpdatedAt: "notadate" }]) {
    const from = batch(cwd, [{ id: "ok", lane: "claude-code" }, { id: "bad", lane: "claude-code", ...bad }]);
    const err = expectFail(() => run(["add-many", "--from", from], { cwd }));
    assert.ok(err, `add-many refuses ${JSON.stringify(bad)}`);
    assert.match(err.stderr, /epic 'bad': (priority must be one of|externalUpdatedAt must be an ISO-8601)/);
    assert.deepEqual(readState(cwd).epics.map(e => e.id), [], "and the good entry was not created either");
  }
  run(["add-many", "--from", batch(cwd, [{ id: "ok", lane: "claude-code", priority: "P1",
    externalId: "1", externalUpdatedAt: "2026-09-25T12:00:00.000+0000" }])], { cwd });
  assert.equal(readState(cwd).epics.find(e => e.id === "ok").priority, "P1");
});
