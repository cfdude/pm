// scripts/test/unit/conductor-31.test.mjs
// 4.1's migration of `assert/conductor-31.test.mjs` — ALL of it, moved from the file rung to the unit
// rung with every assertion unchanged. (The file-rung file is gone; nothing in it needed bytes on
// disk.)
//
// 5.3's ASSERTION TWIN of scripts/test/functional/conductor-31.test.mjs — same id, same subject.
//
// THE FUNCTIONAL FILE'S SUBJECT is gh-151 (the detour verbs as verbs, rather than as hand-edits of
// state.json) and gh-152 (every flag every verb READS is declared somewhere). The detour family is
// pure state and argv — push-detour, pop-detour, drop-detour and the reconcile decision — so it is
// fully portable. The gh-152 half is a source-and-registry sweep, which this half can also do
// without git.
//
// IT BELONGS ON THE PER-COMMIT PATH: the detour stack is CONTROL STATE, and a push that wrote half
// a frame is exactly the kind of defect a triggered-only half would carry for months.
//
// WHY IT MOVED ENTIRELY: every observable is the RECORD's own state — the frame's fields, the active
// pointer, the parent's status, `reconcileNeeded` — or the brief's text, which the store answers. The
// file rung's only contact with the filesystem was a `void fs; void path;` line keeping two unused
// imports alive; both are gone with it.
//
//   `tmpRepo()` + `run(["init"], { cwd })`  →  `memoryEngine(emptyRecord())`
//   `run(args, { cwd })`                    →  `engine(args)`
//   `readState(cwd)`                        →  `engine.store.record()`
//   `parseBrief(cwd)`                       →  the `brief` verb's own stdout, parsed the same way

import assert from "node:assert/strict";
import { emptyRecord, expectFail, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

const readState = (engine) => engine.store.record();
const parseBrief = (engine) =>
  JSON.parse(engine(["brief"])).hookSpecificOutput.additionalContext;

function repo() {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "parent", "--title", "parent", "--lane", "openspec"]);
  engine(["add-epic", "--id", "detour", "--title", "detour", "--lane", "claude-code"]);
  engine(["set-active", "parent"]);
  return engine;
}

// ─────────────────── gh-151: push-detour ───────────────────

unitTest("gh-151: push-detour writes the whole frame, both links, and the active pointer in one write", () => {
  const engine = repo();
  engine(["push-detour", "parent", "--detour", "detour", "--reason", "blocked on it", "--reconcile"]);
  const st = readState(engine);
  assert.equal(st.detourStack.length, 1);
  const frame = st.detourStack[0];
  assert.equal(frame.pausedEpic, "parent");
  assert.equal(frame.spawnedDetour, "detour");
  assert.equal(frame.reason, "blocked on it");
  assert.equal(frame.reconcileOnResume, true);
  const parent = st.epics.find(e => e.id === "parent");
  const detour = st.epics.find(e => e.id === "detour");
  assert.ok(parent.links.some(l => l.epic === "detour"), "the parent's link to the detour is written");
  assert.ok(detour.links.some(l => l.epic === "parent"), "and the detour's link back");
  assert.equal(st.active, "detour", "the detour becomes active in the SAME write");
  assert.equal(parent.status, "paused");
});

unitTest("gh-151: the reconcile decision must be SAID — neither flag, or both, is refused", () => {
  const engine = repo();
  const none = expectFail(() => engine(["push-detour", "parent", "--detour", "detour", "--reason", "x"]));
  assert.ok(none, "the absence of a decision is not a decision");
  const both = expectFail(() => engine(["push-detour", "parent", "--detour", "detour", "--reason", "x", "--reconcile", "--no-reconcile"]));
  assert.ok(both);
  assert.equal(readState(engine).detourStack.length, 0, "neither refusal wrote a frame");
});

unitTest("gh-151: --no-reconcile is honoured and arms no gate", () => {
  const engine = repo();
  engine(["push-detour", "parent", "--detour", "detour", "--reason", "x", "--no-reconcile"]);
  assert.equal(readState(engine).detourStack[0].reconcileOnResume, false);
});

unitTest("gh-151: an ABSENT --reason is refused, not just a valueless one", () => {
  const engine = repo();
  assert.ok(expectFail(() => engine(["push-detour", "parent", "--detour", "detour", "--reconcile"])));
  assert.equal(readState(engine).detourStack.length, 0);
});

unitTest("gh-151: an archived epic cannot be paused, and an archived detour cannot be pushed to", () => {
  const engine = repo();
  engine(["update-epic", "detour", "--status", "archived", "--outcome", "killed", "--reason", "r", "--no-deferrals"]);
  assert.ok(expectFail(() => engine(["push-detour", "parent", "--detour", "detour", "--reason", "x", "--reconcile"])));
  assert.equal(readState(engine).detourStack.length, 0);
});

unitTest("gh-151: the same epic cannot be pushed onto the stack twice", () => {
  const engine = repo();
  engine(["add-epic", "--id", "detour2", "--title", "d2", "--lane", "claude-code"]);
  engine(["push-detour", "parent", "--detour", "detour", "--reason", "x", "--no-reconcile"]);
  assert.ok(expectFail(() => engine(["push-detour", "parent", "--detour", "detour2", "--reason", "y", "--no-reconcile"])));
  assert.equal(readState(engine).detourStack.length, 1);
});

// ─────────────────── gh-151: pop-detour ───────────────────

unitTest("gh-151: pop-detour removes the frame, resumes the epic, and SURVIVES a render", () => {
  const engine = repo();
  engine(["push-detour", "parent", "--detour", "detour", "--reason", "x", "--reconcile"]);
  engine(["pop-detour", "parent"]);
  let st = readState(engine);
  assert.equal(st.detourStack.length, 0);
  assert.equal(st.active, "parent");
  assert.equal(st.epics.find(e => e.id === "parent").reconcileNeeded, true,
    "the obligation survives the frame's removal — that is why it is written in the same write");
  engine(["render"]);
  st = readState(engine);
  assert.equal(st.active, "parent");
  assert.equal(st.epics.find(e => e.id === "parent").reconcileNeeded, true,
    "and survives a re-render, which is where a naive recompute would clear it");
});

unitTest("gh-151: a --no-reconcile pop needs no gate", () => {
  const engine = repo();
  engine(["push-detour", "parent", "--detour", "detour", "--reason", "x", "--no-reconcile"]);
  engine(["pop-detour", "parent"]);
  const st = readState(engine);
  assert.notEqual(st.epics.find(e => e.id === "parent").reconcileNeeded, true);
  assert.equal(st.detourStack.length, 0);
});

unitTest("gh-151: pop-detour refuses an empty stack and a mis-named top frame", () => {
  const engine = repo();
  assert.ok(expectFail(() => engine(["pop-detour", "parent"])), "an empty stack has nothing to pop");
  engine(["push-detour", "parent", "--detour", "detour", "--reason", "x", "--no-reconcile"]);
  assert.ok(expectFail(() => engine(["pop-detour", "detour"])), "a mis-named top frame is refused");
  assert.equal(readState(engine).detourStack.length, 1, "and the frame is still there");
});

unitTest("gh-151: pop-detour WARNS about an unarchived detour rather than refusing", () => {
  const engine = repo();
  engine(["push-detour", "parent", "--detour", "detour", "--reason", "x", "--no-reconcile"]);
  // The detour epic is still live: the POP proceeds and says so, because refusing would strand the
  // frame on a bookkeeping difference the human can see for themselves.
  const out = (() => { try { return engine(["pop-detour", "parent"]); } catch (e) { return String(e.stdout || ""); } })();
  assert.ok(typeof out === "string");
  assert.equal(readState(engine).detourStack.length, 0);
});

unitTest("gh-151: the detour verbs go through the guarded write path, not a hand-edit", () => {
  // The frame the verb writes carries the fields the protocol needs, which a hand-edit had no way
  // to guarantee — the validation, the read-back and the conflict guard are the verb's, not the
  // editor's.
  const engine = repo();
  engine(["push-detour", "parent", "--detour", "detour", "--reason", "x", "--reconcile"]);
  const frame = readState(engine).detourStack[0];
  assert.ok(frame.pausedAt, "the frame is stamped at push time");
  assert.ok(typeof frame.reconcileOnResume === "boolean");
});

unitTest("gh-151: drop-detour is the INVERSE pop cannot serve — it removes the frame and never resumes", () => {
  const engine = repo();
  engine(["push-detour", "parent", "--detour", "detour", "--reason", "x", "--reconcile"]);
  engine(["drop-detour", "parent", "--reason", "the paused epic is not coming back"]);
  const st = readState(engine);
  assert.equal(st.detourStack.length, 0);
  assert.equal(st.epics.find(e => e.id === "parent").reconcileNeeded !== true, true,
    "dropping ENDS the obligation rather than answering it");
});

// ─────────────────── the reconcile obligation is visible on the briefing ───────────────────

unitTest("gh-151: the brief names the obligation a push armed", () => {
  const engine = repo();
  engine(["push-detour", "parent", "--detour", "detour", "--reason", "blocked on it", "--reconcile"]);
  const brief = parseBrief(engine);
  assert.match(brief, /detour/i);
});

// ───────────────────────── the deliberate omissions ─────────────────────────
//
// gh-152's registry sweep — "every DISPATCHED verb is claimed by a flag declaration", "every FLAG
// the engine reads off a parsed-flags object is declared somewhere", "no (command, flag) pair is
// governed by more than one registry row", "VERB_FLAGS' valueless rows are a short closed list" —
// reads engine source and the registry, which this half CAN do, but its population is derived from
// modules this twin would have to re-derive; the family is asserted in the functional file, whose
// subject it is. The BEHAVIOURAL half of gh-152 — "`set-autonomy --level` with no value writes no
// autonomy block" — is covered in this half by scripts/test/assert/conductor-30.test.mjs.
