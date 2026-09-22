// scripts/test/unit/detour-frame-drop.test.mjs
// 4.1's migration of `assert/detour-frame-drop.test.mjs` — the sixteen VALUE-OBSERVING tests,
// moved from the file rung to the unit rung with every assertion unchanged.
//
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
//
// ─────────────── WHAT MOVED, AND WHAT DID NOT ───────────────
//
// Every scenario here is a sequence of verbs whose outcome is read out of the RECORD — the stack,
// an epic's status, the armed/disarmed link, the reconcile flag, a refusal's text — so sixteen of
// the twenty moved. The mechanism that changed:
//
//   `tmpRepo()` + `run(["init"], { cwd })`  →  `memoryEngine(emptyRecord())`
//   `run(args, { cwd })`                    →  `engine(args)`
//   `runCombined(args, { cwd })`            →  `engine.combined(args)`
//   `readState(cwd)`                        →  `engine.store.record()`
//   `fs.readFileSync(stateFile(cwd))`       →  `engine.store.read("state.json").text`
//   `fs.writeFileSync(stateFile(cwd), …)`   →  `mutateRecord(engine, …)` — the record the store
//                                              holds IS the state of record, and `writeRecord()`
//                                              would refuse a hand-moved revision
//
// FOUR STAY ON THE FILE RUNG, and three of them are the same reason:
//
//   * three scenarios need the DRIFT HEAL, which reads `openspec/changes/archive/**` from disk — so
//     the FIXTURE writes a change directory into the repository, and a test-frame write is exactly
//     what the unit rung's run-time counter refuses. (`render` itself is fine in memory; the
//     fixture is not.)
//   * the `saveState`-count invariant READS `detour-stack.mjs`'s source and counts calls in it,
//     which is a source-shape subject with no value to observe.

import assert from "node:assert/strict";
import { emptyRecord, expectFail, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

const readState = (engine) => engine.store.record();
const stateBytes = (engine) => engine.store.read("state.json").text;
const epicOf = (engine, id) => readState(engine).epics.find(e => e.id === id);
const stack = (engine) => readState(engine).detourStack || [];
const frameFor = (engine, id) => stack(engine).find(f => f.pausedEpic === id);

/** The file rung's `fs.writeFileSync(stateFile(cwd), …)`: hand the record straight back to the
 *  store, with no verb in the chain. `writeRecord()` is NOT the equivalent — it refuses a revision
 *  the store did not expect, which is the guard, not the fixture. */
function mutateRecord(engine, edit) {
  edit(engine.store.record());
}

/** `p` paused for detour `d`, with the reconcile gate armed. */
function pushed(engine, p, d, { reconcile = true } = {}) {
  engine(["update-epic", p, "--status", "active"]);
  engine(["push-detour", p, "--detour", d, "--reason", `blocked on ${d}`,
    reconcile ? "--reconcile" : "--no-reconcile"]);
}

function repo(ids = ["p", "d"]) {
  const engine = memoryEngine(emptyRecord());
  for (const id of ids) engine(["add-epic", "--id", id, "--lane", "claude-code"]);
  return engine;
}

// ───────── An epic holding a live frame does not archive through the interactive verb ─────────

unitTest("Scenario: Archiving a parked epic through the interactive verb is refused", () => {
  const engine = repo();
  pushed(engine, "p", "d");
  assert.ok(frameFor(engine, "p"), "fixture: a live frame names p");
  const before = stateBytes(engine);

  const err = expectFail(() => engine(["update-epic", "p", "--status", "archived",
    "--outcome", "killed", "--reason", "abandoned while parked", "--no-deferrals"]));
  assert.ok(err, "the transition into archived is refused");
  const msg = String(err.stderr || err.message);
  assert.match(msg, /'d'|`d`/, "the refusal names the detour the frame spawned");
  assert.match(msg, /drop-detour/, "and the operation that ends the frame — a guard whose message " +
    "names a verb the engine does not have is the defect class this change closes");
  assert.deepEqual(stateBytes(engine), before, "the state of record is byte-identical");
});

unitTest("Scenario: Archiving an epic with no frame is unaffected", () => {
  const engine = repo();
  engine(["update-epic", "d", "--status", "archived", "--outcome", "killed",
    "--reason", "not needed", "--no-deferrals"]);
  assert.equal(epicOf(engine, "d").status, "archived");
});

// ───────── A detour frame is ended by a verb ─────────

unitTest("Scenario: A jammed frame is dropped and the stack is usable again", () => {
  const engine = repo(["base", "dbase", "a", "dx"]);
  pushed(engine, "base", "dbase");
  pushed(engine, "a", "dx");
  engine(["update-epic", "a", "--status", "paused"]);   // the pre-jam shape
  assert.equal(stack(engine).length, 2, "fixture: two frames");

  engine(["drop-detour", "a", "--reason", "abandoned while parked"]);

  const s = stack(engine);
  assert.equal(s.length, 1, "that frame is gone");
  assert.equal(s[0].pausedEpic, "base", "and the frame beneath is now the top");
  engine(["pop-detour", "base"]);
  assert.equal(epicOf(engine, "base").status, "active", "resuming the epic the lower frame pauses succeeds");
  assert.notEqual(epicOf(engine, "a").status, "active", "the dropped epic is never resumed by this operation");
});

unitTest("Scenario: A buried frame is dropped without disturbing the frames above it", () => {
  const engine = repo(["base", "dbase", "a", "dx"]);
  pushed(engine, "base", "dbase");
  pushed(engine, "a", "dx");
  const above = stack(engine)[1];

  engine(["drop-detour", "base", "--reason", "the parent was cancelled"]);

  const s = stack(engine);
  assert.equal(s.length, 1, "the LOWER frame is gone — this is not a last-in-first-out pop");
  assert.deepEqual(s[0], above, "and the upper frame is on the stack unchanged");
});

unitTest("Scenario: Dropping a frame does not resume or revive the epic", () => {
  const engine = repo();
  pushed(engine, "p", "d");
  const activeBefore = readState(engine).active;
  const statusBefore = epicOf(engine, "p").status;

  engine(["drop-detour", "p", "--reason", "not coming back"]);

  assert.equal(epicOf(engine, "p").status, statusBefore, "the status is unchanged");
  assert.equal(readState(engine).active, activeBefore, "and the active pointer did not move");
});

// ───────── Ending an obligation is not answering it ─────────

unitTest("Scenario: A dropped frame's reconcile obligation is ended, not answered", () => {
  const engine = repo();
  pushed(engine, "p", "d");
  // THE PRECONDITION, asserted immediately before the step under test. "No longer reported as owed"
  // is satisfied for free by a fixture where nothing was ever owed
  // (docs/lessons/git-rewinds-restore-tracked-conductor-state's vacuous half).
  const armed = epicOf(engine, "p").links.find(l => l.type === "may-invalidate" && l.epic === "d");
  assert.equal(armed.reconcileOnResume, true, "fixture: the link is ARMED");
  assert.equal(epicOf(engine, "p").reconcileNeeded, true, "fixture: and the obligation is owed");

  engine(["drop-detour", "p", "--reason", "the parent was cancelled"]);

  const p = epicOf(engine, "p");
  assert.equal(p.reconcileNeeded, false, "no longer reported as owing a verdict against that detour");
  const link = p.links.find(l => l.type === "may-invalidate" && l.epic === "d");
  assert.ok(link, "the link is DISARMED, never removed — the evidence an obligation existed survives");
  assert.equal(link.reconcileOnResume, false);
  assert.equal(link.dropped.reason, "the parent was cancelled", "the record shows it DROPPED, with its reason");
  assert.ok(link.dropped.droppedAt);
  assert.equal(link.reconciled, undefined, "and NOT as reconciled — no verdict was written");
});

unitTest("Scenario: A drop leaves an obligation an earlier detour still owes", () => {
  const engine = repo(["p", "d1", "d2"]);
  pushed(engine, "p", "d1");
  engine(["pop-detour", "p"]);           // d1's frame is gone; its verdict is still owed
  pushed(engine, "p", "d2");
  assert.equal(epicOf(engine, "p").reconcileNeeded, true, "fixture: p owes a verdict");
  assert.deepEqual(epicOf(engine, "p").links.filter(l => l.type === "may-invalidate" && l.reconcileOnResume === true)
    .map(l => l.epic).sort(), ["d1", "d2"], "fixture: TWO armed links, the earlier one unanswered");

  engine(["drop-detour", "p", "--reason", "d2 was cancelled"]);

  const p = epicOf(engine, "p");
  assert.equal(p.reconcileNeeded, true,
    "a verdict can still be recorded against the earlier detour — the drop ends the obligation it names and no other");
  assert.equal(p.links.find(l => l.epic === "d1").reconcileOnResume, true, "d1 is untouched");
  assert.equal(p.links.find(l => l.epic === "d2").reconcileOnResume, false, "d2 is disarmed");
});

unitTest("3.6: a render after the drop neither re-arms nor re-clears anything", () => {
  // reconcileArchived() is a THIRD spelling of "is anything still owed" and re-derives the flag on
  // every write path. Asserted rather than inferred, and BOTH halves — the flag AND the absence of
  // the heal's announcement, because a heal clearing an already-false flag would be silent and
  // indistinguishable from one that did nothing.
  const engine = repo();
  pushed(engine, "p", "d");
  // THE DROP'S OWN OUTPUT FIRST, and this is the assertion that distinguishes the two mechanisms.
  // dropDetour() calls render() after its save, so a drop that did NOT clear the flag itself would
  // still end with it false — the heal would clear it, announcing that it did. Asserting only the
  // final value cannot tell the two apart, and a mutation run proved exactly that: removing the
  // recompute left all 17 tests green. The heal's line is the tell.
  const dropOut = engine.combined(["drop-detour", "p", "--reason", "cancelled"]);
  assert.ok(!/cleared the reconcile obligation/.test(dropOut),
    "the drop clears the flag in the SAME write that removes the frame and disarms the link, so the " +
    "heal's exception — an epic owing a reconcile with no armed link and no frame — is never " +
    `reachable between two writes:\n${dropOut}`);
  assert.equal(epicOf(engine, "p").reconcileNeeded, false, "cleared in the same write as the frame removal");

  const out = engine.combined(["render"]);
  assert.equal(epicOf(engine, "p").reconcileNeeded, false, "still false after the heal re-derives it");
  assert.ok(!/cleared the reconcile obligation/.test(out),
    "the heal's own clear never fires: clearing in the SAME write means its precondition — owing, " +
    "no armed link, no frame — is never reachable between two writes");
});

unitTest("Scenario: Removing the epic afterwards is no longer blocked", () => {
  const engine = repo();
  pushed(engine, "p", "d");
  const blocked = engine.combined(["remove-epic", "p"]);
  assert.match(blocked, /frame|reconcile/i, "fixture: the removal IS blocked before the drop");
  assert.ok(epicOf(engine, "p"), "fixture: and the epic is still there");

  engine(["drop-detour", "p", "--reason", "cancelled"]);
  engine(["remove-epic", "p"]);
  assert.equal(epicOf(engine, "p"), undefined,
    "neither a detour-stack reference nor an owed reconcile obligation blocks it any more");
});

// ───────── The two refusals ─────────

unitTest("Scenario: Dropping a frame for an epic that has none is refused", () => {
  const engine = repo();
  const before = stateBytes(engine);
  const err = expectFail(() => engine(["drop-detour", "p", "--reason", "nothing to end"]));
  assert.ok(err);
  assert.match(String(err.stderr || err.message), /no live detour-stack frame/i);
  assert.deepEqual(stateBytes(engine), before, "the state of record is byte-identical");
});

unitTest("Scenario: Dropping a frame without a reason is refused", () => {
  const engine = repo();
  pushed(engine, "p", "d");
  const before = stateBytes(engine);
  assert.ok(expectFail(() => engine(["drop-detour", "p"])), "no --reason at all");
  assert.ok(expectFail(() => engine(["drop-detour", "p", "--reason", "   "])), "a blank one");
  assert.deepEqual(stateBytes(engine), before, "and neither wrote anything");
});

// ───────── 3.9 REGRESSION GUARDS ─────────

unitTest("REGRESSION GUARD: record-reconcile refuses a DROPPED detour through its existing unarmed-link arm", () => {
  // A drop that left the link ARMED would leave the epic able to record a verdict for an obligation
  // nobody answered. The refusal must come from check 2 (`isArmed(link)`) and not from a new arm
  // written for the drop — a second spelling of the same rule is the sibling-site defect.
  const engine = repo();
  pushed(engine, "p", "d");
  engine(["drop-detour", "p", "--reason", "cancelled"]);
  const err = expectFail(() => engine(["record-reconcile", "p", "--detour", "d",
    "--verdict", "valid", "--amendments", "none"]));
  assert.ok(err, "a verdict against a dropped detour is refused");
  assert.match(String(err.stderr || err.message),
    /is not a detour 'p' was paused for with --reconcile/,
    "through check 2's own words — the unarmed-link arm, unchanged");
});

unitTest("REGRESSION GUARD: pop-detour is unchanged for every case that worked before", () => {
  const engine = repo(["p", "d"]);
  pushed(engine, "p", "d");
  // The LIFO assertion still refuses a name that is not on top.
  engine(["add-epic", "--id", "q", "--lane", "claude-code"]);
  assert.ok(expectFail(() => engine(["pop-detour", "q"])), "naming an epic that is not on top is refused");
  // The ordinary pop still resumes, and still arms the reconcile gate.
  const out = engine.combined(["pop-detour", "p"]);
  assert.equal(epicOf(engine, "p").status, "active");
  assert.equal(readState(engine).active, "p");
  assert.match(out, /RECONCILE GATE/, "and still prints the gate for an armed detour");
  // An empty stack still refuses.
  assert.ok(expectFail(() => engine(["pop-detour"])), "an empty stack is still refused");
});

unitTest("REGRESSION GUARD: pop-detour still refuses an epic that ended while parked", () => {
  // The message that used to be the only exit — and that named no verb — now names one. The
  // REFUSAL itself is unchanged behaviour.
  //
  // The prose above used to be the WHOLE assertion: the match was `/ended while parked/`, which the
  // 0.45.0 message satisfies word for word, so the suite could not see whether a verb was named at
  // all. The verb name is asserted below (Gate 2 I-I1).
  const engine = repo();
  pushed(engine, "p", "d");
  mutateRecord(engine, s => { s.epics.find(e => e.id === "p").status = "archived"; });
  const err = expectFail(() => engine(["pop-detour", "p"]));
  assert.ok(err);
  const msg = String(err.stderr || err.message);
  assert.match(msg, /ended while parked/);
  assert.match(msg, /drop-detour p --reason "<why>"/,
    "and the remedy names the verb that ends the frame, with the epic it must be given");
});

unitTest("Scenario: the remove-epic refusal on a detour-stack frame names the verb that ends the pause", () => {
  // The jam's SECOND refusal. `remove-epic` is where a reader arrives after `pop-detour` has told
  // them the epic ended while parked; a remedy naming only "resume or pop" sends them back to the
  // refusal they just came from. Both exits are named, and the drop is proved to be one: following
  // the printed line unblocks the removal.
  const engine = repo();
  pushed(engine, "p", "d");
  engine(["update-epic", "p", "--status", "paused"]);
  const err = expectFail(() => engine(["remove-epic", "p"]));
  assert.ok(err, "a live frame still blocks the removal");
  const msg = String(err.stderr || err.message);
  assert.match(msg, /detour-stack reference/, "through the frame arm, unchanged");
  assert.match(msg, /Resume or pop the detour first \(\/pm:resume\)/, "the coming-back exit, unchanged");
  assert.match(msg, /drop-detour p --reason "<why>"/,
    "and the not-coming-back exit, naming the PAUSED epic the verb takes as its positional");
  // The remedy is printed because it works: run it verbatim and the removal is no longer blocked.
  engine(["drop-detour", "p", "--reason", "not coming back"]);
  engine(["remove-epic", "p"]);
  assert.equal(epicOf(engine, "p"), undefined, "the epic is removable once the pause is ended");
});

unitTest("Scenario: the remove-epic remedy names the paused epic even when the DETOUR is the epic being removed", () => {
  // A frame holds two ids and `drop-detour` takes only one of them. Deriving the remedy from the
  // reference that blocked the removal would print `drop-detour d`, which refuses ("no live detour-stack
  // frame pauses 'd'") — a remedy that does nothing, the defect class the adjacent comment warns about.
  const engine = repo();
  pushed(engine, "p", "d");
  const err = expectFail(() => engine(["remove-epic", "d"]));
  assert.ok(err, "the detour is held by the frame too");
  const msg = String(err.stderr || err.message);
  assert.match(msg, /drop-detour p --reason "<why>"/,
    "the remedy names 'p', the epic the frame pauses — not 'd', which drop-detour would refuse");
  assert.doesNotMatch(msg, /drop-detour d /, "and never the detour id");
});
