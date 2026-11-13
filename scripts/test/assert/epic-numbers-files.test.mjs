// scripts/test/assert/epic-numbers-files.test.mjs
// project-boards 8.1 (FILE rung): every REGISTRATION path leaves a numbered epic on disk — add-epic, add-many and both `sync`
// paths (an on-disk OpenSpec change, a Superpowers plan, which read the filesystem) — and the counter is in state.json.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, readState } from "../fixtures/assert-harness.mjs";

test("8.1 add-epic, add-many and both sync paths each leave a distinct positive integer number, and state.json records the counter", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "born-here", "--lane", "openspec"], { cwd });
  const batch = path.join(cwd, "batch.json");
  fs.writeFileSync(batch, JSON.stringify({ epics: [{ id: "batch-born", lane: "claude-code", externalId: "30" }] }));
  run(["add-many", "--from", batch], { cwd });
  fs.mkdirSync(path.join(cwd, "openspec", "changes", "synced-change"), { recursive: true });
  fs.mkdirSync(path.join(cwd, "docs", "superpowers", "plans"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "docs", "superpowers", "plans", "synced-plan.md"), "# A plan\n");
  run(["sync"], { cwd });
  const s = readState(cwd);
  const byId = Object.fromEntries(s.epics.map(e => [e.id, e.number]));
  for (const id of ["born-here", "batch-born", "synced-change", "synced-plan"]) {
    assert.ok(Number.isSafeInteger(byId[id]) && byId[id] > 0, `${id} carries a number (got ${byId[id]})`);
  }
  assert.equal(byId["batch-born"], 30, "its externalId is its number");
  assert.equal(new Set(Object.values(byId)).size, Object.keys(byId).length, "no two epics share a number");
  assert.ok(s.nextEpicNumber > Math.max(...Object.values(byId)), "the counter is persisted past every number held");
});
