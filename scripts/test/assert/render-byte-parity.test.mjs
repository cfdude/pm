// scripts/test/assert/render-byte-parity.test.mjs
// 1.8 (REGRESSION GUARD) — THE RENDERED ARTIFACT'S BYTES, ACROSS THE SEAM AND ACROSS THE COMMIT.
//
// WHY THIS IS THE CHECK THAT MATTERS. The store seam changed where render()'s inputs come FROM and
// where its output GOES. The failure it can hide best is the one nobody would look for: PROJECT.md's
// bytes changing because the render now reads an injected object instead of a path — a document
// every consumer of this record reads, from a hook to an agent to a human. `engine-invocation`
// states it as a SHALL ("The store the command line builds writes the record the command line has
// always written"), and this file is where it is measured rather than asserted.
//
// THE ONE CHOICE THIS MAKES, and the alternative it does NOT take: `render()` stamps
// `> Last rendered: <now>` from the wall clock, so two renders of the same record are never
// byte-identical as RAW TEXT. The comparison therefore strips that line — using the ENGINE'S OWN
// pattern, the `STAMP_RE` at render.mjs's comparison, not a second copy of it — from BOTH sides,
// and the stamp line's presence and FORMAT are asserted separately so stripping it cannot quietly
// become "the stamp stopped being written". (Injecting a clock is the other way; the stripped
// comparison is the choice this change makes, and it is stated in the spec delta rather than left
// to this file.)
//
// THE CAPTURE IS READ, NEVER REGENERATED. `fixtures/render-parity-project-md.txt` was produced by
// running these same steps on a tree BEFORE the seam landed (commit d833159, the commit immediately
// before 1.2). A test that re-derived its own expectation would compare the engine to itself and
// could catch nothing.
//
// THE RECORD CARRIES A `pmVersion` PLACEHOLDER, filled in at run time from this repository's own
// plugin.json. That is an INPUT being pinned, not an expectation being derived: a record whose
// pmVersion trails the running plugin makes the brief emit a version-currency warning, and the
// warning's text moves on every release — which would turn the capture into a release-time failure
// that has nothing to do with the seam.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { invokeEngine, run, tmpRepo } from "../fixtures/assert-harness.mjs";
import { memoryStore } from "../../lib/store.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..");
const CAPTURE = path.join(REPO, "scripts", "test", "fixtures", "render-parity-project-md.txt");
const RECORD = path.join(REPO, "scripts", "test", "fixtures", "render-parity-state.json");

/** THE ENGINE'S OWN PATTERN, copied from render.mjs's skip-rewrite comparison and asserted below to
 *  still be that pattern — so this file cannot drift from the engine's own idea of what a stamp line
 *  is. (Copied rather than imported because that one is a local inside `render()`.) */
const STAMP_RE = /^> Last rendered: .*$/m;
const STAMP_LINE = /^> Last rendered: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/m;

const stripStamp = (text) => text.replace(STAMP_RE, "");

function fixtureRecord() {
  const version = JSON.parse(fs.readFileSync(path.join(REPO, ".claude-plugin", "plugin.json"), "utf8")).version;
  return JSON.parse(fs.readFileSync(RECORD, "utf8").split("__PM_VERSION__").join(version));
}

test("1.8 the engine's own stamp pattern is still the one this file strips", () => {
  const src = fs.readFileSync(path.join(REPO, "scripts", "lib", "render.mjs"), "utf8");
  assert.ok(src.includes("const STAMP_RE = /^> Last rendered: .*$/m;"),
    "the strip this file performs must be the ENGINE's own pattern; if render.mjs renamed or " +
    "reshaped it, this test has been comparing something the engine does not");
});

test("1.8 the same record renders byte-identically through the disk store, the memory store, and a PRE-SEAM capture", () => {
  const record = fixtureRecord();

  // ── the DISK store: the store the command line builds ──
  const diskRoot = tmpRepo();
  fs.mkdirSync(path.join(diskRoot, ".conductor"), { recursive: true });
  fs.writeFileSync(path.join(diskRoot, ".conductor", "state.json"), JSON.stringify(record, null, 2) + "\n");
  run(["render"], { cwd: diskRoot });
  const onDisk = fs.readFileSync(path.join(diskRoot, "PROJECT.md"), "utf8");

  // ── the MEMORY store: the same record, no path ──
  const memRoot = tmpRepo();
  const memory = memoryStore(record);
  const status = invokeEngine(["render"], { cwd: memRoot, store: memory }).status;
  assert.equal(status, 0, "render through the memory store must succeed");
  const written = memory.read("PROJECT.md");
  assert.equal(written.kind, "ok", "the memory store must have been handed the rendered artifact");
  const inMemory = written.text;

  // ── the PRE-SEAM capture ──
  const captured = fs.readFileSync(CAPTURE, "utf8");

  // THE STAMP IS THE ONLY DIFFERENCE, and it is asserted to be PRESENT and WELL-FORMED on each side
  // before it is stripped — so "the comparison ignores the stamp" cannot decay into "the stamp
  // stopped being written".
  for (const [what, text] of [["the disk render", onDisk], ["the memory render", inMemory], ["the capture", captured]]) {
    assert.match(text, STAMP_LINE, `${what} must carry a well-formed '> Last rendered:' stamp line`);
  }

  assert.equal(stripStamp(inMemory), stripStamp(captured),
    "the memory store's render must be byte-identical to the PRE-SEAM capture once the stamp is " +
    "stripped — a difference here is the seam changing what the command line writes");
  assert.equal(stripStamp(onDisk), stripStamp(inMemory),
    "and the disk store and the memory store must agree with each other, which is the same " +
    "requirement one hop in");
  assert.equal(stripStamp(onDisk), stripStamp(captured),
    "and the disk store must still write exactly what it wrote before the seam existed");

  // THE OUTPUT'S DESTINATION MOVED; its presence on disk did not, for the DISK store, and must not
  // exist at all for the memory store.
  assert.ok(fs.existsSync(path.join(diskRoot, "PROJECT.md")), "the disk store still writes PROJECT.md where it always did");
  assert.ok(!fs.existsSync(path.join(memRoot, "PROJECT.md")), "the memory store writes no PROJECT.md on disk");
});
