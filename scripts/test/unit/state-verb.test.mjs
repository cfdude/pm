// scripts/test/unit/state-verb.test.mjs
// D7's first proof: A STATE VERB, over an in-memory record.
//
// WHAT IT PROVES. A verb's DECISION is separable from its PERSISTENCE. `update-epic` reads the
// record it was handed, decides, and writes the decision back into the same object — with no
// tmpdir, no lock, no temp file, no fsync and no read-back anywhere in the call. The value it
// returns and the values it leaves behind are the observable; the file the engine would have
// written is not.
//
// IT IS ALSO THE RUNG'S OWN SMOKE TEST for the run-time counter: `unitTest()` asserts the
// filesystem was untouched, so a verb that started reaching a path again would fail HERE, at the
// seam, rather than only as a slow suite.

import assert from "node:assert/strict";
import { memoryEngine, recordWithEpic, unitTest } from "../fixtures/unit-harness.mjs";

unitTest("update-epic decides from the record it was handed, and writes back into it", () => {
  const invoke = memoryEngine(recordWithEpic());
  const r = invoke.result(["update-epic", "e1", "--priority", "P1", "--status", "queued"]);
  assert.equal(r.status, 0, `the update must be accepted: ${r.stderr}`);
  assert.equal(r.stderr.includes("conductor: updated"), true,
    `the verb must report the update it made: ${r.stderr}`);

  const after = invoke.store.record();
  assert.equal(after.epics[0].priority, "P1", "the new priority is in the record the caller supplied");
  assert.ok(after.revision > 1, "and the write advanced the revision, exactly as a disk write would");
});

unitTest("a refusal over an in-memory record is the same refusal, and it writes nothing", () => {
  const invoke = memoryEngine(recordWithEpic());
  const r = invoke.result(["update-epic", "no-such-epic", "--priority", "P1"]);
  assert.notEqual(r.status, 0, "an unknown epic must be refused");
  assert.match(r.stderr, /no-such-epic/, "and the refusal must name it");
  assert.deepEqual(invoke.store.record().epics.map(e => e.id), ["e1"],
    "and nothing may have been written — the record still holds exactly what it was seeded with");
  assert.equal(invoke.store.record().revision, 1, "including its revision");
});

unitTest("the same invocation through two records in one process touches neither the other", () => {
  const a = memoryEngine(recordWithEpic({ id: "a", title: "A" }));
  const b = memoryEngine(recordWithEpic({ id: "b", title: "B" }));
  assert.equal(a.result(["update-epic", "a", "--priority", "P0"]).status, 0);
  assert.equal(b.result(["update-epic", "b", "--priority", "P3"]).status, 0);
  assert.deepEqual(a.store.record().epics.map(e => [e.id, e.priority]), [["a", "P0"]]);
  assert.deepEqual(b.store.record().epics.map(e => [e.id, e.priority]), [["b", "P3"]]);
});
