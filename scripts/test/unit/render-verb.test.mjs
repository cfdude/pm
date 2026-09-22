// scripts/test/unit/render-verb.test.mjs
// D7's second proof: A RENDER VERB, over an in-memory record.
//
// WHAT IT PROVES. `render()` reaches its pre-image, its stamp and its output through the store, so
// with an in-memory store it produces the artifact's TEXT and puts it in the object it was handed —
// and the run-time counter proves it did no filesystem work on the way. That is the property task
// 1.3 exists for: an output-only move would have left the render verb reading `PROJECT.md` and
// `detours.log` and state.json's mtime off disk, and this test would fail on the first two reads.
//
// THE BYTES THEMSELVES ARE NOT ASSERTED HERE. Byte parity across the seam is task 1.8's subject and
// it needs a capture on disk, so it lives on the FILE rung (assert/render-byte-parity.test.mjs).
// This is the rung's proof that a render over the memory store is a render at all.

import assert from "node:assert/strict";
import { memoryEngine, recordWithEpic, unitTest } from "../fixtures/unit-harness.mjs";

unitTest("render produces the artifact into the store, and writes no path", () => {
  const invoke = memoryEngine(recordWithEpic({ title: "Rendered" }));
  const r = invoke.result(["render"]);
  assert.equal(r.status, 0, `render must succeed over a memory store: ${r.stderr}`);

  const artifact = invoke.store.read("PROJECT.md");
  assert.equal(artifact.kind, "ok", "the store must have been handed the rendered artifact");
  assert.match(artifact.text, /^# PROJECT — Conductor Index$/m, "it is the document PROJECT.md is");
  assert.match(artifact.text, /^\| P2 \| `e1` \| claude-code \| epic \| queued \|/m, "and it carries the record's own values");
  assert.match(artifact.text, /^> Last rendered: .*$/m, "including the stamp line");
});

unitTest("a second render of an unchanged record is a no-op that reports itself as one", () => {
  const invoke = memoryEngine(recordWithEpic());
  invoke.result(["render"]);
  const first = invoke.store.read("PROJECT.md").text;
  const second = invoke.result(["render"]);
  assert.equal(second.status, 0);
  assert.match(second.stderr, /PROJECT\.md unchanged \(skipped rewrite\)/,
    "the skip-rewrite decision must be answered by the STORE's pre-image, not by a path read");
  assert.equal(invoke.store.read("PROJECT.md").text, first, "and the artifact must be the one it already had");
});

unitTest("render's detour table reads the log through the store, not through a path", () => {
  // `detours.log` is store-OWNED and the render reads it on EVERY call. Before task 1.3 that read
  // went through the module-scope path, so this test would have performed filesystem work — and the
  // counter would have said so rather than the suite merely being slow.
  const invoke = memoryEngine(recordWithEpic());
  invoke.store.append("detours.log",
    ["2026-01-01T00:00:00.000Z", "abc1234", "MINIMAL", "e1", "a one-line note"].join("\t") + "\n");
  const r = invoke.result(["render"]);
  assert.equal(r.status, 0, `render must succeed: ${r.stderr}`);
  const text = invoke.store.read("PROJECT.md").text;
  assert.match(text, /abc1234/, "the logged row must appear");
  assert.match(text, /a one-line note/, "with its note");
});
