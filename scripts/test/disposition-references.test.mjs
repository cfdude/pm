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

// ───────── A deferral is registered or explicitly declined — and it names a real epic ─────────

test("Scenario: A deferral naming no epic is refused", () => {
  const cwd = repoWithTwo();
  const before = stateBytes(cwd);
  const err = expectFail(() => run(archive(["--deferral", ":"]), { cwd }));
  assert.ok(err, "an assertion asserting nothing is not the sayable form of 'there are none'");
  assert.match(String(err.stderr || err.message), /empty/i, "the refusal names the empty half");
  assert.deepEqual(stateBytes(cwd), before);
  assert.equal(epicOf(cwd, "a").deferralAssertion, undefined);
});

test("Scenario: A deferral naming an epic the record does not hold is refused", () => {
  const cwd = repoWithTwo();
  const before = stateBytes(cwd);
  const err = expectFail(() => run(archive(["--deferral", "ghost-epic:design.md § Deferred"]), { cwd }));
  assert.ok(err);
  assert.match(String(err.stderr || err.message), /ghost-epic/,
    "refused at the WRITE, not reported afterwards by the read-only integrity check");
  assert.deepEqual(stateBytes(cwd), before);
});

test("Scenario: A deferral naming the archiving epic itself is refused", () => {
  const cwd = repoWithTwo();
  const before = stateBytes(cwd);
  const err = expectFail(() => run(archive(["--deferral", "a:design.md § Deferred"]), { cwd }));
  assert.ok(err);
  assert.match(String(err.stderr || err.message), /itself|to itself/);
  assert.deepEqual(stateBytes(cwd), before);
});

test("Scenario: A deferral section may be empty, and a valid deferral still archives", () => {
  // Only the EPIC half is checked. `declinedPairs()`'s both-halves rule is NOT what is reused here:
  // the artifact-section half may be empty today and this change keeps it that way.
  const cwd = repoWithTwo();
  run(archive(["--deferral", "other:"]), { cwd });
  const a = epicOf(cwd, "a");
  assert.equal(a.status, "archived");
  assert.deepEqual(a.deferralAssertion.deferrals, [{ epic: "other", section: "" }]);
});

test("A deferral naming a different, registered epic archives and reads back", () => {
  const cwd = repoWithTwo();
  run(archive(["--deferral", "other:design.md § Deferred: the tricky part"]), { cwd });
  assert.deepEqual(epicOf(cwd, "a").deferralAssertion.deferrals,
    [{ epic: "other", section: "design.md § Deferred: the tricky part" }]);
});

test("REGRESSION GUARD: --declined-deferral is untouched — both halves, its own ambiguity refusal", () => {
  // The declined half carries a `<what>` that is free text, not an epic id, so none of the three
  // refusals above may reach it. A validation applied to the wrong half is this change's own
  // defect class turned inward.
  const cwd = repoWithTwo();
  run(archive(["--declined-deferral", "ghost-epic::not worth doing"]), { cwd });
  assert.deepEqual(epicOf(cwd, "a").deferralAssertion.declined,
    [{ what: "ghost-epic", reason: "not worth doing" }],
    "a <what> that happens to look like an unknown epic id is still free text");
});
