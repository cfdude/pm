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

// FILE RUNG because the fixture's first `set-tracker` writes CLAUDE.md, a file the store does not own.
test("set-tracker refuses --remove on the PRIMARY tracker instead of merging or replacing", () => {
  // The primary branch has no remove handler: bare, --remove exited 0 having removed nothing, and
  // with a valid --repo it REPLACED the recorded repo — the opposite of what was asked.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["set-tracker", "--system", "github-issues", "--repo", "o/r"], { cwd });
  const before = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
  for (const args of [["--remove"], ["--role", "primary", "--remove", "--system", "github-issues", "--repo", "x/y"]]) {
    const err = expectFail(() => run(["set-tracker", ...args], { cwd }));
    assert.ok(err, `set-tracker ${args.join(" ")} is refused`);
    assert.match(err.stderr, /--remove removes a SECONDARY tracker/);
  }
  assert.equal(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"), before, "state.json is byte-identical");
  assert.equal(readState(cwd).tracker.repo, "o/r");
});
