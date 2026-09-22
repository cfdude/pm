// scripts/test/unit/append-log-verb.test.mjs
// D7's third proof: AN APPEND-ONLY LOG VERB, over an in-memory record.
//
// WHAT IT PROVES. The append-only record writes go through the store (task 1.4), so a log verb's
// observable — the LINE it emitted, and the line it left in the log — is reachable with no file
// anywhere. `honcho-memory` is the verb chosen because it is the smallest one that both prints and
// appends: its whole contract is "emit this exact line, and keep a local copy", and both halves are
// values.
//
// THE LOG IS A STORE ARTIFACT, NOT A PATH, which is what the second assertion is about: the line
// lands in the object the test supplied, so a unit test can assert on the log's CONTENTS without
// reading one.

import assert from "node:assert/strict";
import { memoryEngine, recordWithEpic, unitTest } from "../fixtures/unit-harness.mjs";

unitTest("honcho-memory prints the line it appends, and both survive in the store", () => {
  const invoke = memoryEngine(recordWithEpic());
  const r = invoke(["honcho-memory", "push", "e1", "paused for a detour"]);
  assert.equal(r.status, 0, `the verb must succeed: ${r.stderr}`);

  const printed = r.stdout.trim();
  assert.match(printed, /paused e1/, "the emitted line names the action and the epic");

  const log = invoke.store.read("honcho-memories.log");
  assert.equal(log.kind, "ok", "the log is a store artifact the verb appended to");
  assert.ok(log.text.includes(printed),
    "the appended copy holds the same line the verb printed — the two halves cannot disagree");
  assert.match(log.text, /^\d{4}-\d{2}-\d{2}T.*\t/m, "with the timestamp the append records");
});

unitTest("two appends accumulate, and the second does not replace the first", () => {
  const invoke = memoryEngine(recordWithEpic());
  invoke(["honcho-memory", "push", "e1", "first"]);
  invoke(["honcho-memory", "pop", "e1", "second"]);
  const lines = invoke.store.read("honcho-memories.log").text.split("\n").filter(Boolean);
  assert.equal(lines.length, 2, "an append-only log accumulates rather than rotating");
  assert.match(lines[0], /first/);
  assert.match(lines[1], /second/);
});
