// scripts/test/disposition-references.test.mjs
// `epic-disposition` — a reference a disposition stores names a real, OTHER epic, or the write is
// refused. Every test is one scenario of
// openspec/changes/operations-ship-their-inverses/specs/epic-disposition/spec.md.
//
// The measured instances, reproduced against 0.45.0: `--carried-to <self>` exited 0 and SATISFIED
// the handoff obligation — the gate that exists to stop a remainder vanishing reported success
// while recording the work as owned by a record that had just ended; `--deferral ":"` stored
// `{epic:"", section:""}`, an assertion asserting nothing; and `--deferral "ghost:sec"` stored a
// pointer to an epic that does not exist. Every sibling that stores an epic id already validated it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { run, readState, tmpRepo, expectFail } from "./helpers.mjs";
import fs from "node:fs";
import path from "node:path";

const stateFile = (cwd) => path.join(cwd, ".conductor", "state.json");
const stateBytes = (cwd) => fs.readFileSync(stateFile(cwd));
const epicOf = (cwd, id) => readState(cwd).epics.find(e => e.id === id);

/** Two claude-code epics — no Gate 2 obligation, so the only thing under test is the reference. */
function repoWithTwo() {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code"], { cwd });
  run(["add-epic", "--id", "other", "--lane", "claude-code"], { cwd });
  return cwd;
}

const archive = (extra) => ["update-epic", "a", "--status", "archived",
  "--outcome", "delivered", "--reason", "shipped", ...extra];

// ───────── Unfinished work at archive records where it went — the receiver is real and other ─────────

test("Scenario: A handoff naming the archiving epic itself is refused", () => {
  const cwd = repoWithTwo();
  const before = stateBytes(cwd);
  const err = expectFail(() => run(archive(["--carried-to", "a", "--no-deferrals"]), { cwd }));
  assert.ok(err, "an epic cannot carry work to itself");
  const msg = String(err.stderr || err.message);
  assert.match(msg, /itself|to itself/, "the refusal says which of the three it is");
  assert.match(msg, /\ba\b/);
  assert.deepEqual(stateBytes(cwd), before, "the state of record is byte-identical");
  assert.equal(epicOf(cwd, "a").status, "queued", "and the epic is not archived");
});

test("Scenario: A handoff naming an epic the record does not hold is refused", () => {
  const cwd = repoWithTwo();
  const before = stateBytes(cwd);
  const err = expectFail(() => run(archive(["--carried-to", "ghost-epic", "--no-deferrals"]), { cwd }));
  assert.ok(err);
  assert.match(String(err.stderr || err.message), /ghost-epic/, "the refusal names the unknown id");
  assert.deepEqual(stateBytes(cwd), before);
});

test("Scenario: A handoff supplied alongside a non-delivered outcome is validated too", () => {
  // The DEMAND binds `delivered` only; the VALIDATION binds wherever the reference is supplied. A
  // receiver named alongside a `killed` is still a claim about where work went, and a false one is
  // no less false for the company it keeps.
  const cwd = repoWithTwo();
  const before = stateBytes(cwd);
  const err = expectFail(() => run(["update-epic", "a", "--status", "archived",
    "--outcome", "killed", "--reason", "abandoned", "--carried-to", "ghost-epic", "--no-deferrals"], { cwd }));
  assert.ok(err);
  assert.deepEqual(stateBytes(cwd), before);
});

test("A handoff naming a real, other epic still archives and reads back", () => {
  const cwd = repoWithTwo();
  run(archive(["--carried-to", "other", "--no-deferrals"]), { cwd });
  const a = epicOf(cwd, "a");
  assert.equal(a.status, "archived");
  assert.equal(a.disposition.carriedTo, "other", "the valid reference is stored unchanged");
});
