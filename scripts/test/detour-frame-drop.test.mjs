// scripts/test/detour-frame-drop.test.mjs
// `gate-integrity` — pausing an epic for a detour gains the inverse it never shipped, and the
// interactive archive verb stops creating the jam. Every test is one scenario of
// openspec/changes/operations-ship-their-inverses/specs/gate-integrity/spec.md.
//
// THE MEASURED JAM, reproduced against the 0.45.0 engine: push two frames, archive the epic the top
// frame names (exit 0 — no archive path consults the stack), and then `pop-detour` exits 1 ("it
// ended while parked… End the frame by removing the epic's pause deliberately" — a remedy naming
// no verb), `remove-epic` exits 1 (the frame is an unstrippable reference), and `pop-detour` on the
// lower frame exits 1 on LIFO. EVERY FRAME BENEATH IS STUCK. The only exit was to restore the epic
// to `paused` and resume it, leaving an epic at a live status carrying a terminal disposition.

import { test } from "node:test";
import assert from "node:assert/strict";
import { run, runCombined, readState, tmpRepo, expectFail } from "./helpers.mjs";
import fs from "node:fs";
import path from "node:path";

const stateFile = (cwd) => path.join(cwd, ".conductor", "state.json");
const stateBytes = (cwd) => fs.readFileSync(stateFile(cwd));
const epicOf = (cwd, id) => readState(cwd).epics.find(e => e.id === id);
const stack = (cwd) => readState(cwd).detourStack || [];
const frameFor = (cwd, id) => stack(cwd).find(f => f.pausedEpic === id);

/** `p` paused for detour `d`, with the reconcile gate armed. */
function pushed(cwd, p, d, { reconcile = true } = {}) {
  run(["update-epic", p, "--status", "active"], { cwd });
  run(["push-detour", p, "--detour", d, "--reason", `blocked on ${d}`,
    reconcile ? "--reconcile" : "--no-reconcile"], { cwd });
}

function repo(ids = ["p", "d"]) {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  for (const id of ids) run(["add-epic", "--id", id, "--lane", "claude-code"], { cwd });
  return cwd;
}

// ───────── An epic holding a live frame does not archive through the interactive verb ─────────

test("Scenario: Archiving a parked epic through the interactive verb is refused", () => {
  const cwd = repo();
  pushed(cwd, "p", "d");
  assert.ok(frameFor(cwd, "p"), "fixture: a live frame names p");
  const before = stateBytes(cwd);

  const err = expectFail(() => run(["update-epic", "p", "--status", "archived",
    "--outcome", "killed", "--reason", "abandoned while parked", "--no-deferrals"], { cwd }));
  assert.ok(err, "the transition into archived is refused");
  const msg = String(err.stderr || err.message);
  assert.match(msg, /'d'|`d`/, "the refusal names the detour the frame spawned");
  assert.match(msg, /drop-detour/, "and the operation that ends the frame — a guard whose message " +
    "names a verb the engine does not have is the defect class this change closes");
  assert.deepEqual(stateBytes(cwd), before, "the state of record is byte-identical");
});

test("Scenario: Archiving an epic with no frame is unaffected", () => {
  const cwd = repo();
  run(["update-epic", "d", "--status", "archived", "--outcome", "killed",
    "--reason", "not needed", "--no-deferrals"], { cwd });
  assert.equal(epicOf(cwd, "d").status, "archived");
});

test("Scenario: An already-archived parked epic still records its real disposition", () => {
  // The correction path. `/opsx:archive` moves the change on disk, the drift heal flips the epic and
  // stamps `outcome: unknown`, and the agent's record is written by a LATER call to the same verb —
  // the only remaining moment a real disposition can be recorded. A refusal with no scope would
  // block exactly the population this change exists to rescue.
  const cwd = repo();
  pushed(cwd, "p", "d");
  // Reach the healed state the way the heal does: the change directory appears, render() flips it.
  fs.mkdirSync(path.join(cwd, "openspec", "changes", "archive", "2026-09-01-p"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "openspec", "changes", "archive", "2026-09-01-p", "proposal.md"), "# archived\n");
  run(["render"], { cwd });
  assert.equal(epicOf(cwd, "p").status, "archived", "fixture: the heal archived a parked epic");
  assert.ok(frameFor(cwd, "p"), "fixture: and the frame survived — the state this change rescues");

  run(["update-epic", "p", "--status", "archived", "--outcome", "abandoned",
    "--reason", "ended while parked", "--no-deferrals"], { cwd });
  const p = epicOf(cwd, "p");
  assert.equal(p.disposition.outcome, "abandoned", "the real disposition is recorded");
  assert.ok(frameFor(cwd, "p"), "and the frame is still there, for drop-detour to end");
});

test("Scenario: The drift heal still archives a parked epic", () => {
  const cwd = repo();
  pushed(cwd, "p", "d");
  fs.mkdirSync(path.join(cwd, "openspec", "changes", "archive", "2026-09-01-p"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "openspec", "changes", "archive", "2026-09-01-p", "proposal.md"), "# archived\n");
  run(["render"], { cwd });
  assert.equal(epicOf(cwd, "p").status, "archived",
    "the record must not contradict disk — the heal is deliberately unbound");
  assert.ok(frameFor(cwd, "p"));
});
// ───────── A detour frame is ended by a verb ─────────

test("Scenario: A jammed frame is dropped and the stack is usable again", () => {
  const cwd = repo(["base", "dbase", "a", "dx"]);
  pushed(cwd, "base", "dbase");
  pushed(cwd, "a", "dx");
  run(["update-epic", "a", "--status", "paused"], { cwd });   // the pre-jam shape
  assert.equal(stack(cwd).length, 2, "fixture: two frames");

  run(["drop-detour", "a", "--reason", "abandoned while parked"], { cwd });

  const s = stack(cwd);
  assert.equal(s.length, 1, "that frame is gone");
  assert.equal(s[0].pausedEpic, "base", "and the frame beneath is now the top");
  run(["pop-detour", "base"], { cwd });
  assert.equal(epicOf(cwd, "base").status, "active", "resuming the epic the lower frame pauses succeeds");
  assert.notEqual(epicOf(cwd, "a").status, "active", "the dropped epic is never resumed by this operation");
});

test("Scenario: A buried frame is dropped without disturbing the frames above it", () => {
  const cwd = repo(["base", "dbase", "a", "dx"]);
  pushed(cwd, "base", "dbase");
  pushed(cwd, "a", "dx");
  const above = stack(cwd)[1];

  run(["drop-detour", "base", "--reason", "the parent was cancelled"], { cwd });

  const s = stack(cwd);
  assert.equal(s.length, 1, "the LOWER frame is gone — this is not a last-in-first-out pop");
  assert.deepEqual(s[0], above, "and the upper frame is on the stack unchanged");
});

test("Scenario: Dropping a frame does not resume or revive the epic", () => {
  const cwd = repo();
  pushed(cwd, "p", "d");
  const activeBefore = readState(cwd).active;
  const statusBefore = epicOf(cwd, "p").status;

  run(["drop-detour", "p", "--reason", "not coming back"], { cwd });

  assert.equal(epicOf(cwd, "p").status, statusBefore, "the status is unchanged");
  assert.equal(readState(cwd).active, activeBefore, "and the active pointer did not move");
});

test("Scenario: An already-archived epic's frame is droppable", () => {
  const cwd = repo();
  pushed(cwd, "p", "d");
  fs.mkdirSync(path.join(cwd, "openspec", "changes", "archive", "2026-09-01-p"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "openspec", "changes", "archive", "2026-09-01-p", "proposal.md"), "# archived\n");
  run(["render"], { cwd });
  assert.equal(epicOf(cwd, "p").status, "archived", "fixture: the jammed state, reached by the heal");

  run(["drop-detour", "p", "--reason", "it ended while parked"], { cwd });
  assert.equal(frameFor(cwd, "p"), undefined,
    "a record already in this state has an exit that does not require contradicting its disposition");
  assert.equal(epicOf(cwd, "p").status, "archived", "and it stays archived");
});
