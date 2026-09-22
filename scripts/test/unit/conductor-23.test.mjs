// scripts/test/unit/conductor-23.test.mjs
// 4.1's migration of `assert/conductor-23.test.mjs` — 12 of its 26 tests, moved from the file rung to
// the unit rung with every assertion unchanged.
//
// gh-92 / gh-93 — the epic↔design-document association, and the coverage question it makes
// answerable.
//
// #92: an epic can record the plan it came from (`planPath`) but not the DESIGN DOCUMENT that
// generated it. A Tier-2 design enumerating six implementation chunks produced exactly one
// epic — the chunk that happened to also get a plan file — and the other five were found by
// hand 11 days later, having blocked every release in between. The missing concept is
// MANY-TO-ONE: one document, N epics. Another scan root would have produced one epic per spec,
// which closes when chunk 1 ships.
//
// #93: `verify-specs` — read-only, reports and never repairs, and reports an uncovered document
// as INVENTORY rather than as a defect. A document with no epic may be a note, a reference or an
// abandoned sketch; a check that called every one of them a finding is the noise #138 removed
// from the freshness warning.
//
// The claim this file exists to test, from source-artifacts.mjs' own header: `specPath` costs
// "ONE ROW here plus its `EPIC_FLAGS` entry in constants.mjs" and inherits five behaviours. Two
// of the five write surfaces (`add-epic`, `update-epic`) write their fields BY HAND, so the row
// buys registration on those surfaces and not the write — the exit-0-write-nothing shape of #79.
// Every test below asserts the ROUND TRIP (set it, read it back off disk), never the registry.
//
// ─────────────── WHAT MOVED, AND WHAT DID NOT ───────────────
//
// ELEVEN moved: the three write surfaces' round trips and their two refusals, the two pure
// enumerator tests, the three tombstone/normalization handoffs, and the `--root` and unknown-flag
// refusals.
//
// FIFTEEN STAY, and FOURTEEN of them are one population: `withSpec(cwd, name, body)` writes a design
// document under `docs/superpowers/specs/` for `verify-specs` to FIND — the whole subject of that verb
// is a directory walk, so the fixture has to put files there, INCLUDING the byte-identical read-only
// test, which needs one document to exist before it can prove nothing was written. The fifteenth reads
// `conductor.mjs`'s usage line, and `add-many`'s batch file is the last one's fixture.
//
//   `tmpRepo()` + `seed(cwd, epics)`        →  `memoryEngine({ …record })` / `seed(engine, epics)`
//   `run(args, { cwd })`                    →  `engine(args)`
//   `runCombined(args, { cwd })`            →  `engine.combined(args)`
//   `readState(cwd)`                        →  `engine.store.record()`
//   `fs.readFileSync(stateFile(cwd))`       →  `engine.store.read("state.json").text`

import assert from "node:assert/strict";
import { emptyRecord, expectFail, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

const readState = (engine) => engine.store.record();
const readEpic = (engine, id) => readState(engine).epics.find(e => e.id === id);

/** The file rung's `seed(cwd, epics, extra)`: `init` then a WHOLE-record write. Both collapse into a
 *  seed on this rung, because `init`'s only product here is the record the seed replaces. */
function seed(engine, epics, extra = {}) {
  const s = engine.store.record();
  for (const k of Object.keys(s)) delete s[k];
  Object.assign(s, { version: 1, active: null, detourStack: [], epics, ...extra });
}

function epic(over = {}) {
  return {
    id: "e1", title: "e1", priority: "P1", status: "queued", role: "epic",
    lane: "superpowers", links: [], reconcileNeeded: false, ...over,
  };
}

unitTest("gh-92: add-epic --spec stores specPath — the registry row does not write it", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "chunk-1", "--lane", "superpowers",
    "--spec", "docs/superpowers/specs/2026-08-05-mi-dev-to-prod-workflow-design.md"]);
  assert.equal(readEpic(engine, "chunk-1").specPath,
    "docs/superpowers/specs/2026-08-05-mi-dev-to-prod-workflow-design.md");
});
unitTest("gh-92: a valueless --spec is REFUSED at creation, not stored as boolean true", () => {
  // `--plan` on add-epic silently drops a valueless flag (str() filters it) while update-epic
  // refuses it — an asymmetry inherited, not introduced. `--spec` refuses on BOTH surfaces:
  // exit-0-write-nothing is the #79 shape, and a new field must not ship with it.
  const engine = memoryEngine(emptyRecord());
  const err = expectFail(() => engine(["add-epic", "--id", "e1", "--lane", "superpowers", "--spec"]));
  assert.ok(err, "a valueless --spec must fail, not exit 0 having written nothing");
  assert.match(String(err.stderr), /--spec requires a value/);
  assert.equal(readState(engine).epics.length, 0, "a refused creation must create no epic");
});
unitTest("gh-92: update-epic --spec attaches a design doc to an epic created without one", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "e1", "--lane", "superpowers"]);
  assert.equal(readEpic(engine, "e1").specPath, undefined);
  engine(["update-epic", "e1", "--spec", "docs/superpowers/specs/d.md"]);
  assert.equal(readEpic(engine, "e1").specPath, "docs/superpowers/specs/d.md");
});
unitTest("gh-92: update-epic refuses a valueless --spec instead of persisting a path nothing opens", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "e1", "--lane", "superpowers"]);
  const err = expectFail(() => engine(["update-epic", "e1", "--spec"]));
  assert.ok(err, "a valueless --spec must fail");
  assert.match(String(err.stderr), /--spec requires a value/);
  assert.equal(readEpic(engine, "e1").specPath, undefined);
});
unitTest("gh-92: every epic claiming one document is enumerable, not just the first", async () => {
  // claimedSourceArtifacts() is first-claimant-wins BY DESIGN — naming one epic is all a sync
  // skip message needs. That is the wrong shape for "how many epics cover this document", which
  // is the entire question #93 asks, so the family gets a COUNTING enumerator beside it.
  const { artifactClaimants, claimedSourceArtifacts } = await import("../../lib/source-artifacts.mjs");
  const doc = "docs/superpowers/specs/big-design.md";
  const state = { epics: [
    epic({ id: "chunk-1", specPath: doc }),
    epic({ id: "chunk-2", specPath: `./${doc}` }),
    epic({ id: "chunk-3", specPath: doc }),
  ] };
  assert.deepEqual(artifactClaimants(state).get(doc).map(c => c.epic),
    ["chunk-1", "chunk-2", "chunk-3"],
    "all three claimants, in registration order — a first-wins map cannot answer the coverage question");
  assert.equal(claimedSourceArtifacts(state).get(doc).epic, "chunk-1",
    "the first-wins projection must keep behaving exactly as it did");
});
unitTest("gh-92: a claimant enumerated for one document spans both artifact fields", async () => {
  const { artifactClaimants } = await import("../../lib/source-artifacts.mjs");
  const p = "docs/shared.md";
  const claims = artifactClaimants({ epics: [
    epic({ id: "by-plan", planPath: p }),
    epic({ id: "by-spec", specPath: p }),
  ] }).get(p);
  assert.deepEqual(claims.map(c => c.key), ["planPath", "specPath"],
    "the enumerator reads the family table, so a field added to it is counted by both arms");
});

// ─────────────── #92: the five inherited behaviours, asserted rather than assumed ───────────────
unitTest("gh-92: attaching a spec to an epic clears that path's sync-ignore tombstone", () => {
  const engine = memoryEngine(emptyRecord());
  const doc = "docs/superpowers/specs/d.md";
  seed(engine, [epic({ id: "e1" })], { syncIgnore: [{ path: doc, at: "2026-08-01T00:00:00Z" }] });
  engine(["update-epic", "e1", "--spec", doc]);
  assert.deepEqual(readState(engine).syncIgnore, [],
    "claiming an artifact contradicts a tombstone saying it is not work — the record must not hold both");
});
unitTest("gh-92: remove-epic tombstones the removed epic's specPath and names --spec, not --plan", () => {
  // The instruction the tombstone message prints is the un-ignore path. Hardcoded as `--plan`,
  // it tells the operator to run a command that would attach the design document as a PLAN —
  // the wrong field, and a progress source pointing at a document with no checkboxes.
  const engine = memoryEngine(emptyRecord());
  const doc = "docs/superpowers/specs/d.md";
  seed(engine, [epic({ id: "e1", specPath: doc })]);
  const out = engine.combined(["remove-epic", "e1"]);
  assert.deepEqual(readState(engine).syncIgnore.map(i => i.path), [doc]);
  assert.match(out, /--spec/, "the un-ignore instruction must name the flag that writes THIS field");
  assert.doesNotMatch(out, /--plan/, "a spec tombstone must not tell the operator to attach it as a plan");
});
unitTest("gh-92: a spec path is normalized the way every other artifact path is", () => {
  const engine = memoryEngine(emptyRecord());
  seed(engine, [epic({ id: "e1", specPath: "./docs/superpowers/specs/d.md" })]);
  engine.combined(["remove-epic", "e1"]);
  assert.deepEqual(readState(engine).syncIgnore.map(i => i.path), ["docs/superpowers/specs/d.md"],
    "two spellings of one file must never read as two artifacts");
});

// ─────────────── #93: verify-specs ───────────────
unitTest("gh-93: --root with no value is refused rather than silently falling back to the default", () => {
  const engine = memoryEngine(emptyRecord());
  const err = expectFail(() => engine(["verify-specs", "--root"]));
  assert.ok(err, "a valueless --root must fail");
  assert.match(String(err.stderr), /--root requires a value/);
});
unitTest("gh-93: an unknown flag is refused, naming the flags the verb does take", () => {
  const engine = memoryEngine(emptyRecord());
  const err = expectFail(() => engine(["verify-specs", "--roots", "design"]));
  assert.ok(err);
  assert.match(String(err.stderr), /--roots/);
  assert.match(String(err.stderr), /--root/);
});
