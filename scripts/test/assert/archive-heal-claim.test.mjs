// scripts/test/assert/archive-heal-claim.test.mjs
// drift-heal-leaves-claim-on-archive (code review 0.43.0, B2). `update-epic --status archived`
// clears an epic's advisory claim; the archive-drift heal (`reconcileArchived`, which is how an
// epic archived by `/opsx:archive` usually reaches `archived`) did not. Integrity then reported the
// leftover claim as one that "predates that rule or was hand-edited" — false on both counts.
//
// FILE RUNG because the heal's trigger is a DIRECTORY on disk: `isArchived()` reads
// `openspec/changes/archive/` directly, which the unit rung may not create.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, runCombined, readState, archiveDay } from "../fixtures/assert-harness.mjs";

function archiveOnDisk(cwd, id) {
  const dir = path.join(cwd, "openspec", "changes", "archive", `${archiveDay()}-${id}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "proposal.md"), "# archived\n");
}

test("the archive-drift heal clears the claim of the epic it archives, and says so", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "p", "--lane", "openspec"], { cwd });
  run(["claim", "p", "--session", "s1"], { cwd });
  assert.ok(readState(cwd).epics.find(e => e.id === "p").claim, "fixture: the epic is claimed");

  archiveOnDisk(cwd, "p");
  const out = runCombined(["render"], { cwd });
  const p = readState(cwd).epics.find(e => e.id === "p");
  assert.equal(p.status, "archived", "fixture: the heal archived it");
  assert.equal(p.claim, undefined, "an archived epic holds no claim, however it was archived");
  assert.match(out, /cleared the advisory claim held by 's1' — 'p' has ended/);

  const integrity = runCombined(["integrity"], { cwd });
  assert.doesNotMatch(integrity, /predates that rule or was hand-edited/);
});

test("the heal leaves the claim of an epic it does not archive alone", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "p", "--lane", "openspec"], { cwd });
  run(["add-epic", "--id", "q", "--lane", "openspec"], { cwd });
  run(["claim", "q", "--session", "s1"], { cwd });
  archiveOnDisk(cwd, "p");
  run(["render"], { cwd });
  assert.equal(readState(cwd).epics.find(e => e.id === "q").claim.session, "s1");
});
