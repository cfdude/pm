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
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, runCombined, readState, writeState } from "../fixtures/assert-harness.mjs";

const PLANS = ["docs", "superpowers", "plans"];
const rel = (name) => ["docs", "superpowers", "plans", name].join("/");

function withPlan(cwd, name, body = "# Plan\n- [ ] a\n") {
  fs.mkdirSync(path.join(cwd, ...PLANS), { recursive: true });
  fs.writeFileSync(path.join(cwd, ...PLANS, name), body);
  return rel(name);
}

function epic(over = {}) {
  return {
    id: "e1", title: "e1", priority: "P1", status: "queued", role: "epic",
    lane: "superpowers", links: [], reconcileNeeded: false, ...over,
  };
}

function seed(cwd, epics, extra = {}) {
  run(["init"], { cwd });
  writeState(cwd, { version: 1, active: null, detourStack: [], epics, ...extra });
}

const ids = (cwd) => readState(cwd).epics.map(e => e.id).sort();

// ─────────── rung 1: the association, which is the whole point of #64/#69 ───────────

test("gh-69: sync skips a plan already claimed by an epic's planPath, whatever the epic is called", () => {
  const cwd = tmpRepo();
  const p = withPlan(cwd, "2026-08-01-big-refactor.md");
  // The epic id shares NOTHING with the plan filename — the `eval-measures-worktree` →
  // `edd-measures-installed-plugin-not-worktree` case, where no normalization rule recovers one
  // from the other and only a recorded association can.
  seed(cwd, [epic({ id: "totally-different-name", planPath: p })]);
  const out = runCombined(["sync"], { cwd });
  assert.deepEqual(ids(cwd), ["totally-different-name"],
    "the claimed plan must not become a second epic");
  assert.match(out, /claimed by epic 'totally-different-name'/);
});

test("gh-64: the claim is status-blind — an ARCHIVED epic's plan is not re-offered as new work", () => {
  const cwd = tmpRepo();
  const p = withPlan(cwd, "2026-08-03-platform-parity-mechanism.md");
  seed(cwd, [epic({ id: "platform-parity-mechanism", status: "archived", lane: "openspec", planPath: p })]);
  const out = runCombined(["sync"], { cwd });
  assert.deepEqual(ids(cwd), ["platform-parity-mechanism"],
    "a shipped plan must stop being re-offered — the done-signal #69 asks for");
  // WHICH rung answered is the assertion, not merely that nothing was registered. This fixture
  // uses the real live pair, whose names also satisfy the date-prefix rung — so without this,
  // deleting the claim check entirely leaves the test green. Found by mutation-testing the
  // helper: it survived here while failing three other tests.
  assert.match(out, /claimed by epic 'platform-parity-mechanism'/,
    "the CLAIM must be what suppressed it — a name match is the fallback, not the mechanism");
});

test("gh-64: the claim is lane-blind — a decision-lane epic may hold a superpowers plan", () => {
  const cwd = tmpRepo();
  const p = withPlan(cwd, "2026-07-14-epic-hierarchy-orchestration.md");
  seed(cwd, [epic({ id: "epic-hierarchy-orchestration", lane: "decision", planPath: p })]);
  const out = runCombined(["sync"], { cwd });
  assert.deepEqual(ids(cwd), ["epic-hierarchy-orchestration"],
    "two of this repo's four live dual-lane pairs hold `decision` on the un-prefixed side");
  assert.match(out, /claimed by epic 'epic-hierarchy-orchestration'/,
    "same reason as the status-blind case — pin the rung, not just the outcome");
});

test("a plan no epic claims is still registered — the ladder must not suppress real backlog", () => {
  const cwd = tmpRepo();
  withPlan(cwd, "2026-08-01-genuinely-new.md", "# Genuinely New\n- [ ] a\n");
  seed(cwd, [epic({ id: "unrelated", planPath: rel("2026-07-01-other.md") })]);
  run(["sync"], { cwd });
  const e = readState(cwd).epics.find(x => x.id === "2026-08-01-genuinely-new");
  assert.ok(e, "an unclaimed, unmatched plan is real backlog and must register");
  assert.equal(e.planPath, rel("2026-08-01-genuinely-new.md"));
  assert.equal(e.lane, "superpowers");
});

test("a claim spelled './docs/...' is the same artifact as 'docs/...'", () => {
  const cwd = tmpRepo();
  withPlan(cwd, "2026-08-20-leading-dot.md");
  // Nothing stops an operator typing the path with a `./` prefix (tab-completion produces it),
  // and `update-epic --plan` stores whatever it is given. Two spellings of one file reading as
  // two artifacts puts the phantom straight back — the same bug through the front door.
  // Caught by mutation-testing normalizeArtifactPath to the identity function: it SURVIVED the
  // suite as first written.
  seed(cwd, [epic({ id: "dotted", planPath: "./docs/superpowers/plans/2026-08-20-leading-dot.md" })]);
  const out = runCombined(["sync"], { cwd });
  assert.deepEqual(ids(cwd), ["dotted"]);
  assert.match(out, /claimed by epic 'dotted'/);
});

test("a tombstone written with one spelling suppresses the other", () => {
  const cwd = tmpRepo();
  const p = withPlan(cwd, "2026-08-21-dotted-phantom.md");
  seed(cwd, [epic({ id: "2026-08-21-dotted-phantom", planPath: `./${p}` })]);
  run(["remove-epic", "2026-08-21-dotted-phantom"], { cwd });
  assert.deepEqual(readState(cwd).syncIgnore.map(i => i.path), [p],
    "the tombstone is stored normalized, or sync's lookup misses it");
  run(["sync"], { cwd });
  assert.deepEqual(ids(cwd), []);
});

// ─────────── rung 4: the recovery path for epics registered before `--plan` existed ───────────

test("gh-64: a date-prefixed plan matching an epic id is NOT registered, and both exits are named", () => {
  const cwd = tmpRepo();
  const p = withPlan(cwd, "2026-07-21-conductor-mjs-module-split.md");
  seed(cwd, [epic({ id: "conductor-mjs-module-split", lane: "openspec", planPath: undefined })]);
  const out = runCombined(["sync"], { cwd });
  assert.deepEqual(ids(cwd), ["conductor-mjs-module-split"],
    "this is exactly the shape of all four dual-lane pairs the integrity check reports");
  // Both exits, because the match is a NAME collision and may be coincidental. Offering only
  // the association exit would have an operator point an epic's progress source at an unrelated
  // plan, which then reads 0/N forever.
  assert.match(out, /update-epic conductor-mjs-module-split --plan docs\/superpowers\/plans\/2026-07-21-conductor-mjs-module-split\.md/);
  assert.match(out, new RegExp(`add-epic --id 2026-07-21-conductor-mjs-module-split .*--plan ${p.replace(/[/.]/g, "\\$&")}`));
});

test("the name-match rung never fires when some epic already claims the plan", () => {
  const cwd = tmpRepo();
  const p = withPlan(cwd, "2026-07-21-conductor-mjs-module-split.md");
  seed(cwd, [
    epic({ id: "conductor-mjs-module-split", lane: "openspec" }),
    epic({ id: "someone-else", planPath: p }),
  ]);
  const out = runCombined(["sync"], { cwd });
  assert.match(out, /claimed by epic 'someone-else'/);
  assert.doesNotMatch(out, /update-epic conductor-mjs-module-split --plan/,
    "an existing claim is the answer; instructing a second association would create a fork");
});

test("the name-match rung never offers an epic that already claims a DIFFERENT plan", () => {
  const cwd = tmpRepo();
  const first = withPlan(cwd, "2026-08-01-recurring-audit.md");
  withPlan(cwd, "2026-09-01-recurring-audit.md");
  // Two date-prefixed plans sharing a stem — the reachable case. Rung 1 fires only when THIS
  // plan is claimed, so an epic holding the OTHER one still matched by name, and the emitted
  // instruction would have repointed its progress source at this file, silently discarding a
  // recorded association. It falls through to registration instead: a visible epic a human can
  // remove beats a silent overwrite of a real association.
  seed(cwd, [epic({ id: "2026-08-01-recurring-audit", planPath: first })]);
  const out = runCombined(["sync"], { cwd });
  assert.doesNotMatch(out, /update-epic 2026-08-01-recurring-audit --plan/,
    "never instruct an operator to overwrite an association the record already holds");
  assert.ok(ids(cwd).includes("2026-09-01-recurring-audit"),
    "and do not suppress it either — an epic that already claims something answers nothing about this plan");
});

// ─────────── rung 3: the tombstone — removal that survives the next sync ───────────

test("gh-64: remove-epic tombstones the removed epic's plan, and sync does not resurrect it", () => {
  const cwd = tmpRepo();
  const p = withPlan(cwd, "2026-08-14-phantom.md");
  seed(cwd, [epic({ id: "2026-08-14-phantom", status: "untriaged", planPath: p })]);
  const removed = runCombined(["remove-epic", "2026-08-14-phantom"], { cwd });
  assert.match(removed, /sync-ignore/, "the removal must say it left a tombstone");
  assert.deepEqual(readState(cwd).syncIgnore.map(i => i.path), [p]);
  const out = runCombined(["sync"], { cwd });
  assert.deepEqual(ids(cwd), [], "removal used to buy you only until the next sync");
  assert.match(out, /sync-ignore/);
});

test("gh-64: --cascade tombstones EVERY removed epic's plan, not just the named one", () => {
  const cwd = tmpRepo();
  const pa = withPlan(cwd, "2026-08-14-parent-plan.md");
  const pb = withPlan(cwd, "2026-08-15-child-plan.md");
  seed(cwd, [
    epic({ id: "par", planPath: pa }),
    epic({ id: "kid", parent: "par", planPath: pb }),
  ]);
  run(["remove-epic", "par", "--cascade"], { cwd });
  assert.deepEqual(readState(cwd).syncIgnore.map(i => i.path).sort(), [pa, pb].sort(),
    "a guard applied to the named epic and not to its cascaded descendants is the absent-edit defect");
  run(["sync"], { cwd });
  assert.deepEqual(ids(cwd), []);
});

test("removing an epic that claims no plan writes no tombstone", () => {
  const cwd = tmpRepo();
  seed(cwd, [epic({ id: "no-plan" })]);
  run(["remove-epic", "no-plan"], { cwd });
  const st = readState(cwd);
  assert.ok(!st.syncIgnore || st.syncIgnore.length === 0,
    "an ignore list that accumulates entries for epics with no artifact is noise");
});

// ─────────── un-ignore: associating a plan is the explicit statement that it is real ───────────

test("update-epic --plan clears a tombstone on that path", () => {
  const cwd = tmpRepo();
  const p = withPlan(cwd, "2026-08-14-phantom.md");
  seed(cwd, [epic({ id: "2026-08-14-phantom", planPath: p }), epic({ id: "real" })]);
  run(["remove-epic", "2026-08-14-phantom"], { cwd });
  assert.equal(readState(cwd).syncIgnore.length, 1);
  run(["update-epic", "real", "--plan", p], { cwd });
  assert.deepEqual(readState(cwd).syncIgnore, [],
    "attaching a plan says it is real work — the contrary tombstone must go");
});

test("add-epic --plan clears a tombstone on that path", () => {
  const cwd = tmpRepo();
  const p = withPlan(cwd, "2026-08-14-phantom.md");
  seed(cwd, [epic({ id: "2026-08-14-phantom", planPath: p })]);
  run(["remove-epic", "2026-08-14-phantom"], { cwd });
  run(["add-epic", "--id", "reborn", "--lane", "superpowers", "--plan", p], { cwd });
  assert.deepEqual(readState(cwd).syncIgnore, []);
});

test("add-many clears a tombstone on a batch entry's planPath", () => {
  const cwd = tmpRepo();
  const p = withPlan(cwd, "2026-08-14-phantom.md");
  seed(cwd, [epic({ id: "2026-08-14-phantom", planPath: p })]);
  run(["remove-epic", "2026-08-14-phantom"], { cwd });
  const batch = path.join(cwd, "batch.json");
  fs.writeFileSync(batch, JSON.stringify({ epics: [{ id: "bulk", lane: "superpowers", planPath: p }] }));
  run(["add-many", "--from", batch], { cwd });
  assert.deepEqual(readState(cwd).syncIgnore, [],
    "the bulk creation path is the sibling call site most easily left unedited");
});

// ─────────── back-compat: nothing existing must be transformed ───────────

test("a tombstone's removedEpic is historical and must not be reported as a dangling reference", async () => {
  const cwd = tmpRepo();
  const p = withPlan(cwd, "2026-08-22-gone.md");
  seed(cwd, [epic({ id: "2026-08-22-gone", planPath: p })]);
  run(["remove-epic", "2026-08-22-gone"], { cwd });
  const st = readState(cwd);
  assert.equal(st.syncIgnore[0].removedEpic, "2026-08-22-gone", "provenance is the entry's point");
  // It dangles by construction — the epic is gone, that is WHY the tombstone exists. Registering
  // it in epicReferences() would make every tombstone a permanent finding and have remove-epic's
  // own sweep strip the provenance. This pins that decision so a later maintainer who adds it
  // fails here rather than in a user's briefing.
  const { runIntegrity } = await import("../../lib/integrity.mjs");
  const dangling = runIntegrity(st).find(c => c.id === "dangling-epic-reference");
  assert.deepEqual(dangling.findings, []);
});

// ─────────── the family: #92's specPath must fit this shape, not invent a second one ───────────

test("every source-artifact field is a registered EPIC_FLAGS key on all three write surfaces", async () => {
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
test("every settable epic field is declared clearable or declares why it is not", async () => {
  const { settableEpicFlags, nullableEpicFlags } = await import("../../lib/constants.mjs");
  const settable = settableEpicFlags("update-epic");
  assert.ok(settable.length >= 15,
    `the settable projection yielded ${settable.length} rows — it is broken, not the registry`);
  for (const row of settable) {
    const declared = row.nullable === true || typeof row.setOnly === "string";
    assert.ok(declared,
      `--${row.flag} writes '${row.key}' and declares neither \`nullable: true\` nor a ` +
      "`setOnly` reason. Absence of a marker is what this sweep exists to catch: an undeclared " +
      "field ships with no clearing path and nothing says that was a decision.");
  }
  // And the CLEARABLE LIST a user reads is the registry's, not a hand-kept copy of it.
  //
  // SCOPED TO THE `--clear <field>` ROW, and that is the whole point. Asserting each nullable flag
  // is named SOMEWHERE in commands/epic.md passes on the flag table alone — every one of these
  // flags has its own row there because it can be SET — so the enumeration inside the `--clear`
  // row could go stale without a single assertion moving. Both directions, because the
  // one-directional version misses a flag that LOSES `nullable: true` while the doc keeps
  // offering it.
  const doc = fs.readFileSync(path.join(new URL("../../..", import.meta.url).pathname,
    "commands", "epic.md"), "utf8");
  const clearRow = doc.split("\n").find(l => l.includes("`--clear <field>`"));
  assert.ok(clearRow && clearRow.length > 200,
    "the `--clear <field>` row was not located in commands/epic.md — the table moved, and this " +
    "sweep is now checking nothing");
  const { settableEpicFlags: settableFor } = await import("../../lib/constants.mjs");
  for (const row of nullableEpicFlags("update-epic")) {
    assert.ok(new RegExp(`\`${row.flag}\``).test(clearRow),
      `--${row.flag} is declared nullable and the \`--clear <field>\` row in commands/epic.md ` +
      "does not list it, so the document offers a smaller clearable set than the engine accepts");
  }
  for (const row of settableFor("update-epic").filter(r => typeof r.setOnly === "string")) {
    assert.ok(!new RegExp(`\`${row.flag}\``).test(clearRow),
      `--${row.flag} is declared SET-ONLY and the \`--clear <field>\` row lists it as clearable — ` +
      "the document promises a clear the engine refuses by name");
  }
});

test("a state file written before syncIgnore existed loads and syncs unchanged", () => {
  const cwd = tmpRepo();
  const p = withPlan(cwd, "2026-08-01-old.md");
  // No `syncIgnore` key at all — the absent case is the default, not a migration.
  seed(cwd, [epic({ id: "old-epic", planPath: p })]);
  assert.ok(!("syncIgnore" in readState(cwd)));
  run(["sync"], { cwd });
  assert.deepEqual(ids(cwd), ["old-epic"]);
});
