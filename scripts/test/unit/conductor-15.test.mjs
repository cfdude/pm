// scripts/test/unit/conductor-15.test.mjs
// 4.1's migration of `assert/conductor-15.test.mjs` — 2 of its 17 tests, moved from the file rung to
// the unit rung with every assertion unchanged.
//
// 5.3's ASSERTION TWIN of scripts/test/functional/conductor-15.test.mjs — same id, same subject.
//
// ─────────────── WHAT MOVED, AND WHAT DID NOT ───────────────
//
// TWO moved: the 9.1 pair — `integrity` leaves the record byte-identical and blocks nothing, and it
// reports EVERY check with its count, including the ones that found nothing. Both are decided
// entirely from the record, and the report is what the verb prints.
//
// FIFTEEN STAY, and the reason is the FIXTURE rather than the subject: the migration family reads
// `fixtures/state-0.26.0.json` — a CHECKED-IN 0.26.0 record on disk, which is the whole point of a
// migration test — and the backfill family writes `openspec/changes/archive/<date>-<id>/tasks.md`,
// which is what sync reads. Both are fixtures whose content is a PATH, and the 0.26.0 fixture could
// not be a hand-built object without inventing what "as 0.26.0 wrote it" means.
//
//   `tmpRepo()` + `run(["init"], { cwd })`  →  `memoryEngine(emptyRecord())`
//   `stateBytes(cwd)`                       →  `engine.store.read("state.json").text`

import assert from "node:assert/strict";
import { emptyRecord, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

const stateBytes = (engine) => engine.store.read("state.json").text;

// ─────────────────── 9.1: integrity is a read ───────────────────

unitTest("9.1: integrity leaves state.json byte-identical and blocks nothing", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "e1", "--lane", "claude-code"]);
  const before = stateBytes(engine);
  engine(["integrity"]);
  assert.equal(stateBytes(engine), before);
});

unitTest("9.1: every check is reported with its count, including the ones that found nothing", () => {
  const engine = memoryEngine(emptyRecord());
  const out = engine(["integrity"]);
  const lines = out.split("\n").filter(l => / — \d+ finding\(s\)/.test(l));
  assert.ok(lines.length >= 5, `the report names each check and its count; found ${lines.length} lines`);
});
