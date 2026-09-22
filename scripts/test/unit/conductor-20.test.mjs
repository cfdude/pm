// scripts/test/unit/conductor-20.test.mjs
// 4.1's migration of `assert/conductor-20.test.mjs` — 2 of its 19 tests, moved from the file rung to
// the unit rung with every assertion unchanged.
//
// gh-64 / gh-66 / gh-69 — `sync` dedups a plan file on the plan's FILENAME-DERIVED id instead
// of on a recorded epic↔plan association, so any epic whose plan is named differently from its
// id is re-registered as a fresh untriaged epic on every sync, forever. Reported four times
// across three repos; an operator hand-deleted the same phantom four times in one day.
//
// The fix is a resolution ladder in sync, in this order, per plan file on disk:
//   1. the path is CLAIMED by some epic's source-artifact field (`planPath`) → skip, name it
//   2. the plan's filename-derived id is already an epic id                  → skip (unchanged)
//   3. the path carries a sync-ignore tombstone                              → skip, name it
//   4. an epic's id equals the plan id with its date prefix stripped         → skip, INSTRUCT
//   5. otherwise                                                             → register
//
// Rung 1 is the durable fix and is status-blind by construction: an archived epic still holds
// its `planPath`, which is the done-signal #69 asks for without inferring completion from
// anything. Rung 3 is the residue — `remove-epic` leaves the tombstone, so a removal survives
// the next sync rather than lasting until it. Rung 4 is the recovery path for the epics that
// predate `update-epic --plan` (shipped 0.27.0) and therefore claim nothing yet; it must offer
// BOTH exits, because a same-stripped-name collision can be coincidental and pointing an epic's
// progress source at an unrelated plan would report `0/N` forever.
//
// ─────────────── WHAT MOVED, AND WHY SO FEW ───────────────
//
// TWO moved, and both are tests whose fixture needs no plan file: the tombstone-free removal, and
// the registry sweep.
//
// SEVENTEEN STAY, and SIXTEEN are one population: `withPlan(cwd, name, body)` puts a real file under
// `docs/superpowers/plans/` — and a plan FILE on disk is precisely what the resolution ladder resolves
// ABOUT, so every rung of it needs one. The seventeenth reads the `--clear <field>` row out of
// `commands/epic.md`. This is the file where the four seam edges leave the least: the ladder IS a
// directory walk, and this rung has no directory.
//
//   `tmpRepo()` + `run(["init"], { cwd })`  →  `memoryEngine(emptyRecord())`
//   `seed(cwd, epics, extra)`               →  `seed(engine, epics, extra)`
//   `run(args, { cwd })`                    →  `engine(args)`
//   `readState(cwd)`                        →  `engine.store.record()`

import assert from "node:assert/strict";
import { emptyRecord, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

const readState = (engine) => engine.store.record();
const ids = (engine) => readState(engine).epics.map(e => e.id).sort();

function epic(over = {}) {
  return {
    id: "e1", title: "e1", priority: "P1", status: "queued", role: "epic",
    lane: "superpowers", links: [], reconcileNeeded: false, ...over,
  };
}

/** The file rung's `seed(cwd, epics, extra)`: `init` then a WHOLE-record write, both of which collapse
 *  into the record the memory store holds. */
function seed(engine, epics, extra = {}) {
  const s = engine.store.record();
  for (const k of Object.keys(s)) delete s[k];
  Object.assign(s, { version: 1, active: null, detourStack: [], epics, ...extra });
}

unitTest("removing an epic that claims no plan writes no tombstone", () => {
  const engine = memoryEngine(emptyRecord());
  seed(engine, [epic({ id: "no-plan" })]);
  engine(["remove-epic", "no-plan"]);
  const st = readState(engine);
  assert.ok(!st.syncIgnore || st.syncIgnore.length === 0,
    "an ignore list that accumulates entries for epics with no artifact is noise");
});

// ─────────── un-ignore: associating a plan is the explicit statement that it is real ───────────
unitTest("every source-artifact field is a registered EPIC_FLAGS key on all three write surfaces", async () => {
  const { EPIC_SOURCE_ARTIFACTS } = await import("../../lib/source-artifacts.mjs");
  const { EPIC_FLAGS } = await import("../../lib/constants.mjs");
  assert.ok(EPIC_SOURCE_ARTIFACTS.length >= 1);
  for (const a of EPIC_SOURCE_ARTIFACTS) {
    const reg = EPIC_FLAGS.find(f => f.key === a.key);
    assert.ok(reg, `source artifact '${a.key}' is not a registered epic flag — nothing can write it`);
    assert.equal(reg.flag, a.flag, `'${a.key}' names --${a.flag} in its skip instruction but EPIC_FLAGS says --${reg.flag}`);
    // All three, because the claim clearing lives in pushEpic (add-epic, add-many, sync) and in
    // update-epic. An artifact field settable at creation but not afterwards is exactly the
    // #66 blocker that kept #64/#69 unfixable: the association could not be populated for the
    // epics that already existed.
    for (const cmd of ["add-epic", "update-epic", "add-many"]) {
      assert.ok(reg.commands.includes(cmd),
        `--${a.flag} must be settable on ${cmd}, or the association is unreachable for some epics`);
    }
  }
});

// ─────────── the SIBLING sweep: what can be SET can be UNSET, or says why not ───────────
//
// A SIBLING of the sweep above rather than a widening of it, deliberately. That one asserts
// every source-artifact field appears on all three of add-epic/update-epic/add-many, which two
// NULLABLE fields fail BY DESIGN — `notes` is ["add-epic","update-epic"] and `review-mode` is
// ["update-epic"] alone — and it is driven by a different registry (EPIC_SOURCE_ARTIFACTS).
// Widening it was cited as the fix for gh-66 and is not implementable; this is what that
// citation was correcting toward.
//
// DECLARATION-level on purpose. The FUNCTIONAL half — that `--clear <flag>` actually removes the
// field from the record — is exercised per nullable row in nullable-clearing.test.mjs, against a
// fixture that SETS the field first so it cannot pass against an implementation that does
// nothing. What this sweep adds is the other direction: a settable field that silently declares
// neither markers, and a nullable field that no user-facing document names.
