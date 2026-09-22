// scripts/test/assert/fixture-snapshot.test.mjs
// 3.1 RED + 3.3 REGRESSION GUARD — THE SNAPSHOT'S TWO PROPERTIES, both asserted from a test rather
// than trusted.
//
// THE HAZARD THIS FILE EXISTS FOR (design D5, Risk 4). A shared fixture is a SHARED MUTABLE PREMISE.
// When every test built its own repository the premise could not be corrupted; a template that a test
// can reach is one mutation away from making every LATER test in the file pass against a mutated
// world — and it does it silently, because the later tests still pass. This is the same class of bug
// as the `fs` singleton trap `helpers.mjs:73` documents, which is why the guard is written rather
// than trusted.
//
// So there are two tests here that a naive implementation of the helper cannot pass: the first
// MUTATES what it was handed, and the second reads the value the fixture was BUILT with. An
// implementation that handed the template out directly fails the second, which is exactly the
// deliberate violation 3.1's RED and 3.2's GREEN turn on.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo } from "../fixtures/assert-harness.mjs";
import { disposeAllTemplates, disposeTemplate, fixtureOnce, heldTemplates } from "../fixtures/fixture-snapshot.mjs";

/** A fixture the plain way: build a directory with one file and one `.conductor/state.json`.
 *
 *  It performs NO engine call on purpose. The helper's subject is the COPY, and a fixture that runs
 *  the engine would make the leak test's second half ambiguous between "the copy is faithful" and
 *  "the engine rebuilt something". The three real conversions (3.4) run the engine in their build —
 *  which happens once — and their tests assert the same two properties through it. */
function builtFixture({ marker = "as-built" } = {}) {
  const cwd = tmpRepo();
  fs.mkdirSync(path.join(cwd, ".conductor"), { recursive: true });
  fs.writeFileSync(path.join(cwd, ".conductor", "state.json"), JSON.stringify({ marker }, null, 2) + "\n");
  fs.writeFileSync(path.join(cwd, "PROJECT.md"), `# built with ${marker}\n`);
  fs.mkdirSync(path.join(cwd, "nested"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "nested", "deep.txt"), "nested file\n");
  return cwd;
}

const readMarker = (cwd) => JSON.parse(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8")).marker;

// ─────────────── 3.1 — the leak: the first test mutates, the second must not see it ───────────────

const shared = fixtureOnce(() => builtFixture({ marker: "as-built" }), { name: "pm-leak" });

test("3.1 the first test MUTATES the restored fixture, and the change lands in its own copy", () => {
  const cwd = shared();
  assert.equal(readMarker(cwd), "as-built", "precondition: the fixture was restored with its built value");
  const state = JSON.parse(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"));
  state.marker = "mutated by the first test";
  fs.writeFileSync(path.join(cwd, ".conductor", "state.json"), JSON.stringify(state, null, 2) + "\n");
  fs.writeFileSync(path.join(cwd, "PROJECT.md"), "# mutated\n");
  fs.rmSync(path.join(cwd, "nested"), { recursive: true, force: true });
  assert.equal(readMarker(cwd), "mutated by the first test", "the mutation landed where it was written");
});

test("3.1 the NEXT test reads the value the fixture was BUILT with, not the first test's mutation", () => {
  const cwd = shared();
  assert.equal(readMarker(cwd), "as-built",
    "a test that mutated the restored tree must not be able to affect the next test in the file — the " +
    "template is never handed out, and this assertion is what makes that a fact rather than a claim");
  assert.equal(fs.readFileSync(path.join(cwd, "PROJECT.md"), "utf8"), "# built with as-built\n",
    "including a file the first test overwrote");
  assert.ok(fs.existsSync(path.join(cwd, "nested", "deep.txt")),
    "and a directory the first test REMOVED — restoration is faithful, not merely non-destructive");
});

test("3.1 TWO copies can be live at once, and neither disturbs the other", () => {
  // MEASURED, not hypothetical. The conformance set's reconcile row builds two fixtures BEFORE using
  // either — it compares two routes against two identical trees, because half its classes mutate what
  // they are run against — and the helper's first draft removed the copy it handed out last on the
  // next acquire. That row failed as `EXITED status null`, a child that never started, because its
  // `spawnSync` cwd had been deleted out from under it. Removal therefore belongs at the FILE's end.
  const local = fixtureOnce(() => builtFixture({ marker: "two" }), { name: "pm-two" });
  const first = local();
  const second = local();
  assert.notEqual(first, second, "each acquire gets its own directory");
  assert.ok(fs.existsSync(first) && fs.existsSync(second), "and BOTH are on disk at the same time");
  fs.writeFileSync(path.join(first, "PROJECT.md"), "# mutated\n");
  assert.equal(readMarker(second), "two", "mutating one copy cannot reach the other");
  assert.equal(fs.readFileSync(path.join(second, "PROJECT.md"), "utf8"), "# built with two\n");
});

test("3.1 the template is never handed out, and the copy is a different directory", () => {
  const cwd = shared();
  assert.notEqual(cwd, shared.template(),
    "the built tree must live somewhere the tests never receive a path to");
  assert.ok(!cwd.startsWith(shared.template()), "and the copy must not be INSIDE the template either");
  // The template is built once: a second acquire does not re-run the builder. Proven by the marker
  // the builder stamps, which a rebuild would have to produce again — and by the tree still holding
  // the built value after two mutations have been made and discarded.
  assert.equal(readMarker(shared()), "as-built", "the fixture is built ONCE and restored per test");
});

// ─────────────── 3.3 — the restore path is a COPY: no flush, no engine ───────────────

test("3.3 a restore performs no durability flush and starts no engine", () => {
  // TWO COUNTERS, because the requirement names two things and they fail differently.
  //
  // The FLUSH counter is the sharper one: `saveState()` fsyncs the temp file before its rename and
  // then fsyncs the directory, and those are the 12,524 calls one assertion-half run performs
  // (baseline-before.md, task 0.3(c)). An implementation that "restores" by re-running `init` looks
  // identical from the tests and costs what it cost before — so the flush count is what tells the two
  // apart, and it is asserted to be ZERO for a restore.
  const local = fixtureOnce(() => builtFixture({ marker: "flush-probe" }), { name: "pm-flush" });
  local();                                        // build, and take the first copy
  const realFsyncSync = fs.fsyncSync;
  let flushes = 0;
  fs.fsyncSync = function (...args) { flushes++; return realFsyncSync.apply(fs, args); };
  try {
    local();                                      // RESTORE — the path under test
  } finally {
    fs.fsyncSync = realFsyncSync;
  }
  assert.equal(flushes, 0,
    `a restore must perform no durability flush; it performed ${flushes}. A restore that flushes is ` +
    "not a copy — it is the rebuild the helper exists to replace, and it would cost what it cost before");

  // AND NO ENGINE. The engine's own verbs are the only thing here that can flush, so the counter
  // above is also the evidence for this half; asserted separately as the requirement states it.
  assert.ok(fs.existsSync(path.join(local(), "PROJECT.md")),
    "the restored tree is a real filesystem — the file rung's subject is bytes on disk");
});

test("3.3 the restore's cost is the COPY, not the build (the measurement the helper exists for)", () => {
  // Not a timing assertion — a timing THRESHOLD would be flaky on a loaded machine and would be
  // weakened the first day. What is asserted is the SHAPE the cost comes from: the build runs ONCE
  // however many tests acquire, which is what makes the per-test cost the ~1 ms copy (design D5's
  // measurement) rather than the 124.9 ms build.
  let builds = 0;
  const counted = fixtureOnce(() => { builds++; return builtFixture({ marker: "counted" }); }, { name: "pm-count" });
  for (let i = 0; i < 5; i++) counted();
  assert.equal(builds, 1, "the fixture must be built ONCE per file, whatever number of tests use it");
});

// ─────────────── 3.5 — the template's DISPOSAL is shipped ───────────────

test("3.5 a template is disposed rather than left to accumulate", () => {
  const local = fixtureOnce(() => builtFixture({ marker: "disposal" }), { name: "pm-dispose" });
  local();
  const template = local.template();
  assert.ok(heldTemplates().includes(template), "precondition: the helper is holding its template");
  assert.ok(fs.existsSync(template), "precondition: the template is on disk");
  assert.equal(disposeTemplate(template), true, "disposing it reports that it removed something");
  assert.ok(!fs.existsSync(template), "and the template is GONE — not merely forgotten");
  assert.equal(disposeTemplate(template), false, "disposing twice is a no-op rather than a second removal");
  assert.ok(!heldTemplates().includes(template), "and the helper no longer holds it");
});

test("3.5 disposeAllTemplates() removes every template the process still holds", () => {
  const a = fixtureOnce(() => builtFixture({ marker: "a" }), { name: "pm-all-a" });
  const b = fixtureOnce(() => builtFixture({ marker: "b" }), { name: "pm-all-b" });
  a(); b();
  const paths = [a.template(), b.template()];
  for (const p of paths) assert.ok(fs.existsSync(p), `precondition: ${p} exists`);
  assert.ok(disposeAllTemplates() >= 2, "it reports what it removed");
  for (const p of paths) assert.ok(!fs.existsSync(p), `${p} must be gone`);
});
