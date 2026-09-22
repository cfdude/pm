// scripts/test/unit/disposition-references.test.mjs
// 4.1's migration of `assert/disposition-references.test.mjs` — 11 of its 11 tests, moved from the
// file rung to the unit rung with every assertion unchanged. The file is GONE from the file rung.
//
// `epic-disposition` — a reference a disposition stores names a real, OTHER epic, or the write is
// refused. Every test is one scenario of
// openspec/changes/operations-ship-their-inverses/specs/epic-disposition/spec.md.
//
// WHY THE WHOLE FILE MOVED. Its subject is the VALIDATION of a reference at the write: three refusal
// shapes, their two positive counterparts, and the declined half that must stay untouched. Every
// observable is the refusal text or a value in the record — `stateBytes(cwd)` (the fixture's word for
// "byte-identical") becomes `store.read("state.json").text`, and `epicOf(cwd, id)` becomes the same
// lookup against `engine.store.record()`. No fixture here writes anything but the record.
//
// The measured instances, reproduced against 0.45.0: `--carried-to <self>` exited 0 and SATISFIED
// the handoff obligation — the gate that exists to stop a remainder vanishing reported success
// while recording the work as owned by a record that had just ended; `--deferral ":"` stored
// `{epic:"", section:""}`, an assertion asserting nothing; and `--deferral "ghost:sec"` stored a
// pointer to an epic that does not exist. Every sibling that stores an epic id already validated it.
//
//   `tmpRepo()` + `run(["init"], { cwd })`  →  `memoryEngine(emptyRecord())`
//   `readState(cwd)`                        →  `engine.store.record()`
//   `stateBytes(cwd)`                       →  `engine.store.read("state.json").text`

import assert from "node:assert/strict";
import { emptyRecord, expectFail, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

const stateBytes = (engine) => engine.store.read("state.json").text;
const epicOf = (engine, id) => engine.store.record().epics.find(e => e.id === id);

/** Two claude-code epics — no Gate 2 obligation, so the only thing under test is the reference. */
function repoWithTwo() {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code"]);
  engine(["add-epic", "--id", "other", "--lane", "claude-code"]);
  return engine;
}

const archive = (extra) => ["update-epic", "a", "--status", "archived",
  "--outcome", "delivered", "--reason", "shipped", ...extra];

// ───────── Unfinished work at archive records where it went — the receiver is real and other ─────────

unitTest("Scenario: A handoff naming the archiving epic itself is refused", () => {
  const engine = repoWithTwo();
  const before = stateBytes(engine);
  const err = expectFail(() => engine(archive(["--carried-to", "a", "--no-deferrals"])));
  assert.ok(err, "an epic cannot carry work to itself");
  const msg = String(err.stderr || err.message);
  assert.match(msg, /itself|to itself/, "the refusal says which of the three it is");
  assert.match(msg, /\ba\b/);
  assert.equal(stateBytes(engine), before, "the state of record is byte-identical");
  assert.equal(epicOf(engine, "a").status, "queued", "and the epic is not archived");
});

unitTest("Scenario: A handoff naming an epic the record does not hold is refused", () => {
  const engine = repoWithTwo();
  const before = stateBytes(engine);
  const err = expectFail(() => engine(archive(["--carried-to", "ghost-epic", "--no-deferrals"])));
  assert.ok(err);
  assert.match(String(err.stderr || err.message), /ghost-epic/, "the refusal names the unknown id");
  assert.equal(stateBytes(engine), before);
});

unitTest("Scenario: A handoff supplied alongside a non-delivered outcome is validated too", () => {
  // The DEMAND binds `delivered` only; the VALIDATION binds wherever the reference is supplied. A
  // receiver named alongside a `killed` is still a claim about where work went, and a false one is
  // no less false for the company it keeps.
  const engine = repoWithTwo();
  const before = stateBytes(engine);
  const err = expectFail(() => engine(["update-epic", "a", "--status", "archived",
    "--outcome", "killed", "--reason", "abandoned", "--carried-to", "ghost-epic", "--no-deferrals"]));
  assert.ok(err);
  assert.equal(stateBytes(engine), before);
});

unitTest("A handoff naming a real, other epic still archives and reads back", () => {
  const engine = repoWithTwo();
  engine(archive(["--carried-to", "other", "--no-deferrals"]));
  const a = epicOf(engine, "a");
  assert.equal(a.status, "archived");
  assert.equal(a.disposition.carriedTo, "other", "the valid reference is stored unchanged");
});

// ───────── A deferral is registered or explicitly declined — and it names a real epic ─────────

unitTest("Scenario: A deferral naming no epic is refused", () => {
  const engine = repoWithTwo();
  const before = stateBytes(engine);
  const err = expectFail(() => engine(archive(["--deferral", ":"])));
  assert.ok(err, "an assertion asserting nothing is not the sayable form of 'there are none'");
  assert.match(String(err.stderr || err.message), /empty/i, "the refusal names the empty half");
  assert.equal(stateBytes(engine), before);
  assert.equal(epicOf(engine, "a").deferralAssertion, undefined);
});

unitTest("Scenario: A deferral naming an epic the record does not hold is refused", () => {
  const engine = repoWithTwo();
  const before = stateBytes(engine);
  const err = expectFail(() => engine(archive(["--deferral", "ghost-epic:design.md § Deferred"])));
  assert.ok(err);
  assert.match(String(err.stderr || err.message), /ghost-epic/,
    "refused at the WRITE, not reported afterwards by the read-only integrity check");
  assert.equal(stateBytes(engine), before);
});

unitTest("Scenario: A deferral naming the archiving epic itself is refused", () => {
  const engine = repoWithTwo();
  const before = stateBytes(engine);
  const err = expectFail(() => engine(archive(["--deferral", "a:design.md § Deferred"])));
  assert.ok(err);
  assert.match(String(err.stderr || err.message), /itself|to itself/);
  assert.equal(stateBytes(engine), before);
});

unitTest("Scenario: A deferral section may be empty, and a valid deferral still archives", () => {
  // Only the EPIC half is checked. `declinedPairs()`'s both-halves rule is NOT what is reused here:
  // the artifact-section half may be empty today and this change keeps it that way.
  const engine = repoWithTwo();
  engine(archive(["--deferral", "other:"]));
  const a = epicOf(engine, "a");
  assert.equal(a.status, "archived");
  assert.deepEqual(a.deferralAssertion.deferrals, [{ epic: "other", section: "" }]);
});

unitTest("A deferral naming a different, registered epic archives and reads back", () => {
  const engine = repoWithTwo();
  engine(archive(["--deferral", "other:design.md § Deferred: the tricky part"]));
  assert.deepEqual(epicOf(engine, "a").deferralAssertion.deferrals,
    [{ epic: "other", section: "design.md § Deferred: the tricky part" }]);
});

unitTest("REGRESSION GUARD: --declined-deferral is untouched — both halves, its own ambiguity refusal", () => {
  // The declined half carries a `<what>` that is free text, not an epic id, so none of the three
  // refusals above may reach it. A validation applied to the wrong half is this change's own
  // defect class turned inward.
  const engine = repoWithTwo();
  engine(archive(["--declined-deferral", "ghost-epic::not worth doing"]));
  assert.deepEqual(epicOf(engine, "a").deferralAssertion.declined,
    [{ what: "ghost-epic", reason: "not worth doing" }],
    "a <what> that happens to look like an unknown epic id is still free text");
});
