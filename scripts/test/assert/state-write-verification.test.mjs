// scripts/test/assert/state-write-verification.test.mjs
// 5.3's ASSERTION TWIN of scripts/test/functional/state-write-verification.test.mjs — same id, same
// subject.
//
// THE FUNCTIONAL FILE'S SUBJECT is gh#140: a write that REPORTED success must be readable back, and
// the decision must not mistake a benign race for a lost update. `persistFailure()` is the whole
// judgment and is a PURE FUNCTION of four values, and `missingAttributions()` is the other half —
// which recorded shas did not reach the disk. NEITHER TOUCHES GIT.
//
// So this is a full port of the pure half, plus the in-process integration of the two that the
// functional file drove through a spawned verb. These are the assertions that make "reported
// success" mean something, and they belong on the per-commit path.

import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpRepo, run, readState, writeState } from "../fixtures/assert-harness.mjs";
import { persistFailure } from "../../lib/state.mjs";
import { missingAttributions } from "../../lib/update-epic.mjs";

// ───────────────────────── persistFailure: the four-value judgment ─────────────────────────

test("140: bytes that match are not a failure", () => {
  assert.equal(persistFailure({ expectedBytes: "x", diskBytes: "x", expectedRevision: 3, diskRevision: 3 }), null);
});

test("140: a NEWER revision on disk is a supersession, not this write's failure", () => {
  // A read back B's bytes after A's write landed and was legitimately superseded. Calling that
  // "your write did not persist" turns a benign race into an error — the outcome saveState's
  // `onConflict: "skip"` policy exists to avoid.
  assert.equal(persistFailure({ expectedBytes: "mine", diskBytes: "theirs", expectedRevision: 3, diskRevision: 4 }), null);
});

test("140: bytes that differ at the SAME revision are a failure", () => {
  const msg = persistFailure({ expectedBytes: "mine", diskBytes: "theirs", expectedRevision: 3, diskRevision: 3 });
  assert.ok(msg, "a mismatch at the revision this write just published means the bytes never arrived");
  assert.match(msg, /revision 3/);
});

test("140: bytes that differ at an OLDER revision are a failure — the write never landed", () => {
  assert.ok(persistFailure({ expectedBytes: "mine", diskBytes: "theirs", expectedRevision: 3, diskRevision: 2 }));
});

test("140: an unreadable file after a write that reported success is a failure", () => {
  const msg = persistFailure({ expectedBytes: "mine", diskBytes: null, expectedRevision: 3, diskRevision: null });
  assert.match(msg, /could not be read back at all/);
});

// ───────────────────────── missingAttributions: what did not reach the disk ─────────────────────────

const stateWith = (shas) => ({ version: 1, active: null, detourStack: [],
  epics: [{ id: "e", title: "e", priority: "P1", status: "queued", role: "epic", lane: "claude-code",
    links: [], attributedCommits: shas }] });

test("140: missingAttributions names exactly the shas absent from the record on disk", () => {
  assert.deepEqual(missingAttributions(stateWith(["a", "b"]), "e", ["a", "b", "c"]), ["c"]);
  assert.deepEqual(missingAttributions(stateWith(["a", "b"]), "e", ["a", "b"]), []);
});

test("140: an epic that vanished, or an array that did, counts as everything missing", () => {
  assert.deepEqual(missingAttributions(stateWith(["a"]), "ghost", ["a"]), ["a"]);
  const noArray = { version: 1, active: null, detourStack: [],
    epics: [{ id: "e", title: "e", priority: "P1", status: "queued", role: "epic", lane: "claude-code", links: [] }] };
  assert.deepEqual(missingAttributions(noArray, "e", ["a"]), ["a"]);
});

// ───────────────────────── the integration: a reported write is readable back ─────────────────────────

test("140: an ordinary save verifies and returns ok", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "e1", "--lane", "claude-code"], { cwd });
  assert.deepEqual(readState(cwd).epics.map(e => e.id), ["e1"],
    "the write the verb reported is on disk, read back by a second reader");
});

test("140: --attribute-commit reports success only when the sha is on disk afterwards", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "e1", "--lane", "claude-code"], { cwd });
  // The VALUE is resolved against a repository first, so this half cannot exercise the accept
  // path (design D5). What it CAN prove is the negative half: a value the clone cannot resolve is
  // refused and NOTHING is recorded, so a failed resolution never leaves a phantom attribution.
  const before = JSON.stringify(readState(cwd));
  assert.throws(() => run(["update-epic", "e1", "--attribute-commit", "not-a-sha"], { cwd }));
  assert.equal(JSON.stringify(readState(cwd)), before);
});

test("140: a state written with an attribution reads back through both surfaces", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  writeState(cwd, stateWith(["deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"]).epics.length
    ? { version: 1, active: null, detourStack: [],
        epics: [{ id: "e", title: "e", priority: "P1", status: "queued", role: "epic",
          lane: "claude-code", links: [], attributedCommits: ["deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"] }] }
    : {});
  run(["render"], { cwd });
  assert.deepEqual(readState(cwd).epics[0].attributedCommits, ["deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"]);
});
