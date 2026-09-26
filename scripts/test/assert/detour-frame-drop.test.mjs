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
//
// ─────────────── 4.1 SPLIT THIS FILE, AND THIS IS THE FILE-RUNG HALF ───────────────
//
// SIXTEEN of its twenty tests moved to `scripts/test/unit/detour-frame-drop.test.mjs`: every
// scenario there is a sequence of verbs whose outcome is read out of the RECORD — the stack, an
// epic's status, an armed-or-disarmed link, the reconcile flag, a refusal's text. WHAT IS LEFT is
// the four whose subject is a PATH or a SOURCE FILE:
//
//   * three scenarios need the DRIFT HEAL, which reads `openspec/changes/archive/**` from disk, so
//     the FIXTURE writes a change directory into the repository — a test-frame write, which the
//     unit rung's run-time counter refuses by design. (`render` itself is fine in memory; building
//     the fixture is not.)
//   * the `saveState`-count invariant READS `detour-stack.mjs`'s source and counts calls in it:
//     a source-shape subject with no value to observe.
//
// No assertion changed in either direction.

import { test } from "node:test";
import assert from "node:assert/strict";
import { run, readState, tmpRepo, archiveDay } from "../fixtures/assert-harness.mjs";
import fs from "node:fs";
import path from "node:path";

const stateFile = (cwd) => path.join(cwd, ".conductor", "state.json");
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

// ───────── The drift heal, at the disk read that defines it ─────────

test("Scenario: An already-archived parked epic still records its real disposition", () => {
  // The correction path. `/opsx:archive` moves the change on disk, the drift heal flips the epic and
  // stamps `outcome: unknown`, and the agent's record is written by a LATER call to the same verb —
  // the only remaining moment a real disposition can be recorded. A refusal with no scope would
  // block exactly the population this change exists to rescue.
  const cwd = repo();
  pushed(cwd, "p", "d");
  // Reach the healed state the way the heal does: the change directory appears, render() flips it.
  fs.mkdirSync(path.join(cwd, "openspec", "changes", "archive", `${archiveDay()}-p`), { recursive: true });
  fs.writeFileSync(path.join(cwd, "openspec", "changes", "archive", `${archiveDay()}-p`, "proposal.md"), "# archived\n");
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
  fs.mkdirSync(path.join(cwd, "openspec", "changes", "archive", `${archiveDay()}-p`), { recursive: true });
  fs.writeFileSync(path.join(cwd, "openspec", "changes", "archive", `${archiveDay()}-p`, "proposal.md"), "# archived\n");
  run(["render"], { cwd });
  assert.equal(epicOf(cwd, "p").status, "archived",
    "the record must not contradict disk — the heal is deliberately unbound");
  assert.ok(frameFor(cwd, "p"));
});
// ───────── A detour frame is ended by a verb ─────────

test("Scenario: An already-archived epic's frame is droppable", () => {
  const cwd = repo();
  pushed(cwd, "p", "d");
  fs.mkdirSync(path.join(cwd, "openspec", "changes", "archive", `${archiveDay()}-p`), { recursive: true });
  fs.writeFileSync(path.join(cwd, "openspec", "changes", "archive", `${archiveDay()}-p`, "proposal.md"), "# archived\n");
  run(["render"], { cwd });
  assert.equal(epicOf(cwd, "p").status, "archived", "fixture: the jammed state, reached by the heal");

  run(["drop-detour", "p", "--reason", "it ended while parked"], { cwd });
  assert.equal(frameFor(cwd, "p"), undefined,
    "a record already in this state has an exit that does not require contradicting its disposition");
  assert.equal(epicOf(cwd, "p").status, "archived", "and it stays archived");
});

// ───────── Ending an obligation is not answering it ─────────

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
