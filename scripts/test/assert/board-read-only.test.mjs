// scripts/test/assert/board-read-only.test.mjs
// project-boards 1.2 (spec board-export, "board writes nothing"): `board --json` over a record with epics,
// a release and a mission leaves the state file, the rules file and every log under `.conductor/`
// byte-identical. THE FILE RUNG: the observable is BYTES on disk, which the unit rung's guard refuses.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, readState, writeState } from "../fixtures/assert-harness.mjs";

/** Every file under `dir` (relative path -> bytes), skipping nothing: a log the verb appended to would show. */
function tree(dir) {
  const out = {};
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) { if (ent.name !== ".git") walk(p); } else out[path.relative(dir, p)] = fs.readFileSync(p).toString("base64");
    }
  };
  walk(dir);
  return out;
}

test("1.2 board --json leaves the state file, CLAUDE.md and every .conductor/ file byte-identical", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code", "--priority", "P1"], { cwd });
  run(["add-epic", "--id", "b", "--lane", "claude-code", "--priority", "P2"], { cwd });
  const st = readState(cwd);
  st.releases = [{ id: "r1", intent: "first", order: 1, deferred: [] }];
  st.mission = { current: { statement: "Ship it", setAt: "2026-11-01T00:00:00Z", reason: "r" }, milestoneRelease: "r1", criteria: [] };
  writeState(cwd, st);
  const before = tree(cwd);
  const out = run(["board", "--json"], { cwd });
  assert.equal(JSON.parse(out).epics.length, 2);
  run(["board"], { cwd });
  assert.deepEqual(tree(cwd), before, "board is a read: no state file, rules block or log may change");
});
