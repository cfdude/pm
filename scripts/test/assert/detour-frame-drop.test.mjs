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
import { run, runCombined, readState, tmpRepo, expectFail } from "../fixtures/assert-harness.mjs";
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

// ───────── Ending an obligation is not answering it ─────────

test("Scenario: A dropped frame's reconcile obligation is ended, not answered", () => {
  const cwd = repo();
  pushed(cwd, "p", "d");
  // THE PRECONDITION, asserted immediately before the step under test. "No longer reported as owed"
  // is satisfied for free by a fixture where nothing was ever owed
  // (docs/lessons/git-rewinds-restore-tracked-conductor-state's vacuous half).
  const armed = epicOf(cwd, "p").links.find(l => l.type === "may-invalidate" && l.epic === "d");
  assert.equal(armed.reconcileOnResume, true, "fixture: the link is ARMED");
  assert.equal(epicOf(cwd, "p").reconcileNeeded, true, "fixture: and the obligation is owed");

  run(["drop-detour", "p", "--reason", "the parent was cancelled"], { cwd });

  const p = epicOf(cwd, "p");
  assert.equal(p.reconcileNeeded, false, "no longer reported as owing a verdict against that detour");
  const link = p.links.find(l => l.type === "may-invalidate" && l.epic === "d");
  assert.ok(link, "the link is DISARMED, never removed — the evidence an obligation existed survives");
  assert.equal(link.reconcileOnResume, false);
  assert.equal(link.dropped.reason, "the parent was cancelled", "the record shows it DROPPED, with its reason");
  assert.ok(link.dropped.droppedAt);
  assert.equal(link.reconciled, undefined, "and NOT as reconciled — no verdict was written");
});

test("Scenario: A drop leaves an obligation an earlier detour still owes", () => {
  const cwd = repo(["p", "d1", "d2"]);
  pushed(cwd, "p", "d1");
  run(["pop-detour", "p"], { cwd });           // d1's frame is gone; its verdict is still owed
  pushed(cwd, "p", "d2");
  assert.equal(epicOf(cwd, "p").reconcileNeeded, true, "fixture: p owes a verdict");
  assert.deepEqual(epicOf(cwd, "p").links.filter(l => l.type === "may-invalidate" && l.reconcileOnResume === true)
    .map(l => l.epic).sort(), ["d1", "d2"], "fixture: TWO armed links, the earlier one unanswered");

  run(["drop-detour", "p", "--reason", "d2 was cancelled"], { cwd });

  const p = epicOf(cwd, "p");
  assert.equal(p.reconcileNeeded, true,
    "a verdict can still be recorded against the earlier detour — the drop ends the obligation it names and no other");
  assert.equal(p.links.find(l => l.epic === "d1").reconcileOnResume, true, "d1 is untouched");
  assert.equal(p.links.find(l => l.epic === "d2").reconcileOnResume, false, "d2 is disarmed");
});

test("3.6: a render after the drop neither re-arms nor re-clears anything", () => {
  // reconcileArchived() is a THIRD spelling of "is anything still owed" and re-derives the flag on
  // every write path. Asserted rather than inferred, and BOTH halves — the flag AND the absence of
  // the heal's announcement, because a heal clearing an already-false flag would be silent and
  // indistinguishable from one that did nothing.
  const cwd = repo();
  pushed(cwd, "p", "d");
  // THE DROP'S OWN OUTPUT FIRST, and this is the assertion that distinguishes the two mechanisms.
  // dropDetour() calls render() after its save, so a drop that did NOT clear the flag itself would
  // still end with it false — the heal would clear it, announcing that it did. Asserting only the
  // final value cannot tell the two apart, and a mutation run proved exactly that: removing the
  // recompute left all 17 tests green. The heal's line is the tell.
  const dropOut = runCombined(["drop-detour", "p", "--reason", "cancelled"], { cwd });
  assert.ok(!/cleared the reconcile obligation/.test(dropOut),
    "the drop clears the flag in the SAME write that removes the frame and disarms the link, so the " +
    "heal's exception — an epic owing a reconcile with no armed link and no frame — is never " +
    `reachable between two writes:\n${dropOut}`);
  assert.equal(epicOf(cwd, "p").reconcileNeeded, false, "cleared in the same write as the frame removal");

  const out = runCombined(["render"], { cwd });
  assert.equal(epicOf(cwd, "p").reconcileNeeded, false, "still false after the heal re-derives it");
  assert.ok(!/cleared the reconcile obligation/.test(out),
    "the heal's own clear never fires: clearing in the SAME write means its precondition — owing, " +
    "no armed link, no frame — is never reachable between two writes");
});

test("Scenario: Removing the epic afterwards is no longer blocked", () => {
  const cwd = repo();
  pushed(cwd, "p", "d");
  const blocked = runCombined(["remove-epic", "p"], { cwd });
  assert.match(blocked, /frame|reconcile/i, "fixture: the removal IS blocked before the drop");
  assert.ok(epicOf(cwd, "p"), "fixture: and the epic is still there");

  run(["drop-detour", "p", "--reason", "cancelled"], { cwd });
  run(["remove-epic", "p"], { cwd });
  assert.equal(epicOf(cwd, "p"), undefined,
    "neither a detour-stack reference nor an owed reconcile obligation blocks it any more");
});

// ───────── The two refusals ─────────

test("Scenario: Dropping a frame for an epic that has none is refused", () => {
  const cwd = repo();
  const before = stateBytes(cwd);
  const err = expectFail(() => run(["drop-detour", "p", "--reason", "nothing to end"], { cwd }));
  assert.ok(err);
  assert.match(String(err.stderr || err.message), /no live detour-stack frame/i);
  assert.deepEqual(stateBytes(cwd), before, "the state of record is byte-identical");
});

test("Scenario: Dropping a frame without a reason is refused", () => {
  const cwd = repo();
  pushed(cwd, "p", "d");
  const before = stateBytes(cwd);
  assert.ok(expectFail(() => run(["drop-detour", "p"], { cwd })), "no --reason at all");
  assert.ok(expectFail(() => run(["drop-detour", "p", "--reason", "   "], { cwd })), "a blank one");
  assert.deepEqual(stateBytes(cwd), before, "and neither wrote anything");
});

// ───────── 3.9 REGRESSION GUARDS ─────────

test("REGRESSION GUARD: record-reconcile refuses a DROPPED detour through its existing unarmed-link arm", () => {
  // A drop that left the link ARMED would leave the epic able to record a verdict for an obligation
  // nobody answered. The refusal must come from check 2 (`isArmed(link)`) and not from a new arm
  // written for the drop — a second spelling of the same rule is the sibling-site defect.
  const cwd = repo();
  pushed(cwd, "p", "d");
  run(["drop-detour", "p", "--reason", "cancelled"], { cwd });
  const err = expectFail(() => run(["record-reconcile", "p", "--detour", "d",
    "--verdict", "valid", "--amendments", "none"], { cwd }));
  assert.ok(err, "a verdict against a dropped detour is refused");
  assert.match(String(err.stderr || err.message),
    /is not a detour 'p' was paused for with --reconcile/,
    "through check 2's own words — the unarmed-link arm, unchanged");
});

test("REGRESSION GUARD: pop-detour is unchanged for every case that worked before", () => {
  const cwd = repo(["p", "d"]);
  pushed(cwd, "p", "d");
  // The LIFO assertion still refuses a name that is not on top.
  run(["add-epic", "--id", "q", "--lane", "claude-code"], { cwd });
  assert.ok(expectFail(() => run(["pop-detour", "q"], { cwd })), "naming an epic that is not on top is refused");
  // The ordinary pop still resumes, and still arms the reconcile gate.
  const out = runCombined(["pop-detour", "p"], { cwd });
  assert.equal(epicOf(cwd, "p").status, "active");
  assert.equal(readState(cwd).active, "p");
  assert.match(out, /RECONCILE GATE/, "and still prints the gate for an armed detour");
  // An empty stack still refuses.
  assert.ok(expectFail(() => run(["pop-detour"], { cwd })), "an empty stack is still refused");
});

test("REGRESSION GUARD: pop-detour still refuses an epic that ended while parked", () => {
  // The message that used to be the only exit — and that named no verb — now names one. The
  // REFUSAL itself is unchanged behaviour.
  //
  // The prose above used to be the WHOLE assertion: the match was `/ended while parked/`, which the
  // 0.45.0 message satisfies word for word, so the suite could not see whether a verb was named at
  // all. The verb name is asserted below (Gate 2 I-I1).
  const cwd = repo();
  pushed(cwd, "p", "d");
  const s = readState(cwd);
  s.epics.find(e => e.id === "p").status = "archived";
  fs.writeFileSync(stateFile(cwd), JSON.stringify(s, null, 2) + "\n");
  const err = expectFail(() => run(["pop-detour", "p"], { cwd }));
  assert.ok(err);
  const msg = String(err.stderr || err.message);
  assert.match(msg, /ended while parked/);
  assert.match(msg, /drop-detour p --reason "<why>"/,
    "and the remedy names the verb that ends the frame, with the epic it must be given");
});

test("Scenario: the remove-epic refusal on a detour-stack frame names the verb that ends the pause", () => {
  // The jam's SECOND refusal. `remove-epic` is where a reader arrives after `pop-detour` has told
  // them the epic ended while parked; a remedy naming only "resume or pop" sends them back to the
  // refusal they just came from. Both exits are named, and the drop is proved to be one: following
  // the printed line unblocks the removal.
  const cwd = repo();
  pushed(cwd, "p", "d");
  run(["update-epic", "p", "--status", "paused"], { cwd });
  const err = expectFail(() => run(["remove-epic", "p"], { cwd }));
  assert.ok(err, "a live frame still blocks the removal");
  const msg = String(err.stderr || err.message);
  assert.match(msg, /detour-stack reference/, "through the frame arm, unchanged");
  assert.match(msg, /Resume or pop the detour first \(\/pm:resume\)/, "the coming-back exit, unchanged");
  assert.match(msg, /drop-detour p --reason "<why>"/,
    "and the not-coming-back exit, naming the PAUSED epic the verb takes as its positional");
  // The remedy is printed because it works: run it verbatim and the removal is no longer blocked.
  run(["drop-detour", "p", "--reason", "not coming back"], { cwd });
  run(["remove-epic", "p"], { cwd });
  assert.equal(epicOf(cwd, "p"), undefined, "the epic is removable once the pause is ended");
});

test("Scenario: the remove-epic remedy names the paused epic even when the DETOUR is the epic being removed", () => {
  // A frame holds two ids and `drop-detour` takes only one of them. Deriving the remedy from the
  // reference that blocked the removal would print `drop-detour d`, which refuses ("no live detour-stack
  // frame pauses 'd'") — a remedy that does nothing, the defect class the adjacent comment warns about.
  const cwd = repo();
  pushed(cwd, "p", "d");
  const err = expectFail(() => run(["remove-epic", "d"], { cwd }));
  assert.ok(err, "the detour is held by the frame too");
  const msg = String(err.stderr || err.message);
  assert.match(msg, /drop-detour p --reason "<why>"/,
    "the remedy names 'p', the epic the frame pauses — not 'd', which drop-detour would refuse");
  assert.doesNotMatch(msg, /drop-detour d /, "and never the detour id");
});

// ───────── Gate 2 I-M2 — the "ONE saveState" invariant, observable ─────────

/** Block and line comments out, line count preserved. The prose in this module says "saveState"
 *  constantly, so counting the raw source would count sentences. */
function stripComments(src) {
  let out = "", inBlock = false, inLine = false, i = 0;
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (c === "\n") { inLine = false; out += "\n"; i++; continue; }
    if (inBlock) { if (c === "*" && d === "/") { inBlock = false; out += "  "; i += 2; } else { out += " "; i++; } continue; }
    if (inLine) { out += " "; i++; continue; }
    if (c === "/" && d === "*") { inBlock = true; out += "  "; i += 2; continue; }
    if (c === "/" && d === "/") { inLine = true; out += "  "; i += 2; continue; }
    out += c; i++;
  }
  return out;
}

/** One top-level function's body, by its `export function <name>` header through the closing brace
 *  in column 0 — the shape save-report-surface.test.mjs already reads this engine with. */
function functionSource(file, name) {
  const src = fs.readFileSync(new URL(`../../lib/${file}`, import.meta.url).pathname, "utf8");
  const at = src.indexOf(`export function ${name}(`);
  assert.notEqual(at, -1, `${file} still declares ${name}()`);
  const end = src.indexOf("\n}\n", at);
  assert.notEqual(end, -1, `${name}() has a closing brace in column 0`);
  return src.slice(at, end + 2);
}

test("drop-detour writes the whole transition in exactly ONE saveState", () => {
  // THE INVARIANT WAS UNOBSERVABLE (Gate 2 I-M2): a second `saveState` inserted between the link
  // disarm and the `reconcileNeeded` recompute writes exactly the state gate-integrity says the
  // engine cannot produce — owing, link disarmed, no frame — and every behavioural test in this
  // file still passed, because each reads the state only after the verb returns. The rule was held
  // by a comment. It is asserted here, over the source, the way save-report-surface.test.mjs
  // asserts its own.
  const body = functionSource("detour-stack.mjs", "dropDetour");
  // Non-vacuity: a slice that grabbed the wrong function, or a stripper that ate the code, would
  // otherwise pass with a count of one or zero.
  assert.match(body, /verb: "drop-detour"/, "the slice is dropDetour()'s own body");
  assert.ok(body.length > 800, `the slice is the whole body, not a fragment (${body.length} chars)`);
  const code = stripComments(body);
  assert.doesNotMatch(code, /the frame goes/i, "the stripper really strips — this module's prose is gone");
  const calls = code.split("saveState(").length - 1;
  assert.equal(calls, 1,
    `dropDetour() calls saveState() ${calls} time(s); the frame removal, the link disarm and the ` +
    "reconcileNeeded recompute are ONE write or the record can be read half-transitioned");
});
