// scripts/test/assert/sync-registration-ids.test.mjs
// sync-registers-ids-add-epic-refuses (0.50.0). The FILE rung: every test here builds real
// directories under openspec/changes/ or docs/superpowers/plans/, which is what sync reads.
//
// Defect 1 — every path that registers an epic applies add-epic's own id rule, from ONE validator.
// Before this, sync and the archive backfill tested only "no whitespace or control character", so a
// change directory `x|y` became an epic `x|y` (a pipe splits PROJECT.md's Epics table) that add-epic
// itself would have refused.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, invokeEngine } from "../fixtures/assert-harness.mjs";

const readState = (cwd) => JSON.parse(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"));
const mkdirs = (cwd, ...rel) => { for (const r of rel) fs.mkdirSync(path.join(cwd, r), { recursive: true }); };
const initRepo = () => { const cwd = tmpRepo(); run(["init"], { cwd }); return cwd; };

test("sync registers only ids add-epic accepts, names every skip, and counts the skips in its final line", () => {
  const cwd = initRepo();
  mkdirs(cwd, "openspec/changes/x|y", "openspec/changes/.hidden", "openspec/changes/good-change",
    "openspec/changes/archive/2026-01-01-a|b", "docs/superpowers/plans");
  fs.writeFileSync(path.join(cwd, "docs/superpowers/plans/p|q.md"), "# p\n");
  fs.writeFileSync(path.join(cwd, "docs/superpowers/plans/MASTER-plan.md"), "# master\n");
  const r = invokeEngine(["sync"], { cwd });
  assert.equal(r.status, 0, r.stderr);
  const ids = readState(cwd).epics.map(e => e.id);
  assert.ok(ids.includes("good-change"), "a well-formed change still registers");
  for (const bad of ["x|y", ".hidden", "a|b", "p|q", "MASTER-plan"]) {
    assert.ok(!ids.includes(bad), `'${bad}' is refused by add-epic, so sync must not store it`);
  }
  assert.match(r.stderr, /sync skipped change 'x\|y' — its name is not a valid epic id/);
  assert.match(r.stderr, /sync skipped change '\.hidden' — its name is not a valid epic id/);
  assert.match(r.stderr, /sync skipped archive directory '2026-01-01-a\|b' — its name is not a valid epic id/);
  assert.match(r.stderr, /sync skipped plan 'p\|q\.md' — its name is not a valid epic id/);
  // The uppercase plan gets a RUNNABLE registration: its lowercased stem passes the rule.
  assert.match(r.stderr, /sync skipped plan 'MASTER-plan\.md'[^\n]*`add-epic --id master-plan --lane superpowers --plan docs\/superpowers\/plans\/MASTER-plan\.md`/);
  assert.match(r.stderr, /conductor: synced \(1 new epic\(s\) added as untriaged; 5 skipped/, `the final line counts the skips:\n${r.stderr}`);
});

test("pushEpic, the one creation sink, refuses every id add-epic refuses", async () => {
  const { pushEpic, InvalidEpicIdError } = await import(new URL("../../lib/state.mjs", import.meta.url));
  for (const id of ["x|y", ".hidden", "MASTER-ok", "has space", ""]) {
    const state = { epics: [] };
    assert.throws(() => pushEpic(state, { id, title: "t", lane: "claude-code", links: [] }), InvalidEpicIdError, `refuses ${JSON.stringify(id)}`);
    assert.equal(state.epics.length, 0);
  }
});

test("add-epic, add-many and sync share ONE validator — no creation site tests the format itself", () => {
  const lib = (f) => fs.readFileSync(new URL(`../../lib/${f}`, import.meta.url), "utf8");
  for (const f of ["add-epic.mjs", "add-many.mjs", "subcommands.mjs"]) {
    assert.doesNotMatch(lib(f), /EPIC_ID_FORMAT\.test\(/, `${f} must call STORABLE_EPIC_ID, not test the regex itself`);
    assert.match(lib(f), /STORABLE_EPIC_ID\(/, `${f} calls the shared validator`);
  }
  assert.match(lib("constants.mjs"), /export const STORABLE_EPIC_ID = \(id\) =>\s*typeof id === "string" && EPIC_ID_FORMAT\.test\(id\)/);
});
