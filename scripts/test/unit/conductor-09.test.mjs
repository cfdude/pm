// scripts/test/unit/conductor-09.test.mjs
// 4.1's migration of `assert/conductor-09.test.mjs` — 17 of its 21 tests, moved from the file rung to
// the unit rung with every assertion unchanged.
//
// 5.3's ASSERTION TWIN of scripts/test/functional/conductor-09.test.mjs — same id, same subject.
//
// THE FUNCTIONAL FILE'S SUBJECT is the reconciler's write-back, the gate-review record and the
// archive gate it feeds, two doc-drift walks over the dispatch table, the pre-commit hook's own
// text, sync's plan filter and the help short-circuit. ONLY TWO THINGS IN IT NEED GIT: every
// `--base-sha/--head-sha` case resolves real commits (`fixtureCommits`), and the three
// `.githooks/pre-commit` tests SPAWN a shell — neither may live in this half (design D5, and the
// spawn guard 5.2 enforces it).
//
// So the twin carries everything else, and for the gate-review family it uses the OTHER evidence
// kind gh-177 added: a Gate 1 pass records the ARTIFACTS it reviewed with no SHA range, which is
// exactly the shape this half can produce. Where a behaviour is reachable only through a resolved
// commit range, the omission is named at the bottom.
//
// ─────────────── WHAT MOVED, AND WHAT DID NOT ───────────────
//
// SEVENTEEN moved: the whole record-reconcile family, the whole record-gate-review family, both
// openspec-archive enforcement tests, and all three `--help` tests — whose detour-log assertion is a
// store read (`store.exists`/`store.read`) rather than a path read, because the log is store-owned.
//
// FOUR STAY: two doc-drift walks that READ `conductor.mjs`, `skills/conductor/SKILL.md` and
// `README.md`; `sync`'s README/INDEX filter, whose fixture writes `docs/superpowers/plans/*.md`; and
// the pre-commit hook's SHAPE, which reads `.githooks/pre-commit` and asserts its runner line by
// exact equality — the source-shape guard the change's own task 5.1 names.
//
//   `tmpRepo()` + `run(["init"], { cwd })`  →  `memoryEngine(emptyRecord())`
//   `run(args, { cwd })`                    →  `engine(args)`
//   `readState(cwd)`                        →  `engine.store.record()`
//   `fs.readFileSync(…/state.json)`         →  `engine.store.read("state.json").text`
//   `fs.existsSync(…/detours.log)`          →  `engine.store.exists("detours.log")`

import assert from "node:assert/strict";
import { emptyRecord, expectFail, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

const readState = (engine) => engine.store.record();

unitTest("record-reconcile writes a structured verdict onto the paused epic's link to the detour, and clears reconcileNeeded", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "paused-epic", "--lane", "claude-code"]);
  engine(["add-epic", "--id", "detour-epic", "--lane", "claude-code"]);
  engine(["set-active", "paused-epic"]);
  engine(["push-detour", "paused-epic", "--detour", "detour-epic", "--reason", "blocked", "--reconcile"]);
  engine(["pop-detour", "paused-epic"]);
  assert.equal(readState(engine).epics.find(e => e.id === "paused-epic").reconcileNeeded, true);

  engine(["record-reconcile", "paused-epic", "--detour", "detour-epic",
    "--verdict", "invalidated", "--amendments", "rewrite story 2;drop story 4"]);

  const epic = readState(engine).epics.find(e => e.id === "paused-epic");
  assert.equal(epic.reconcileNeeded, false);
  const link = epic.links.find(l => l.epic === "detour-epic");
  assert.ok(link, "link to the detour should still exist");
  assert.equal(link.reconciled.verdict, "invalidated");
  assert.deepEqual(link.reconciled.amendments, ["rewrite story 2", "drop story 4"]);
  assert.match(link.reconciled.reconciledAt, /^\d{4}-\d{2}-\d{2}T/);
});
unitTest("record-reconcile NEVER creates a link: a detour the epic was not paused for is refused, and nothing is written", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "paused-epic", "--lane", "claude-code"]);
  engine(["add-epic", "--id", "detour-epic", "--lane", "claude-code"]);
  const before = engine.store.read("state.json").text;

  const err = expectFail(() => engine(["record-reconcile", "paused-epic", "--detour", "detour-epic", "--verdict", "valid"]));
  assert.ok(err, "a verdict against a detour nobody armed is refused");
  assert.match(String(err.stderr || err.message), /owes no reconcile verdict/);
  assert.equal(engine.store.read("state.json").text, before, "nothing was written");
  const epic = readState(engine).epics.find(e => e.id === "paused-epic");
  assert.equal((epic.links || []).some(l => l.epic === "detour-epic"), false, "no link was created");
});
unitTest("record-reconcile rejects an unknown verdict", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "paused-epic", "--lane", "claude-code"]);
  engine(["add-epic", "--id", "detour-epic", "--lane", "claude-code"]);
  assert.ok(expectFail(() => engine(
    ["record-reconcile", "paused-epic", "--detour", "detour-epic", "--verdict", "maybe"], { engine })));
});
unitTest("record-reconcile on an unknown epic id exits non-zero and writes nothing", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "detour-epic", "--lane", "claude-code"]);
  const before = engine.store.read("state.json").text;
  assert.ok(expectFail(() => engine(
    ["record-reconcile", "ghost", "--detour", "detour-epic", "--verdict", "valid"], { engine })));
  assert.equal(engine.store.read("state.json").text, before);
});
unitTest("record-reconcile on an unknown detour id exits non-zero and writes nothing", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "paused-epic", "--lane", "claude-code"]);
  const before = engine.store.read("state.json").text;
  const err = expectFail(() => engine(
    ["record-reconcile", "paused-epic", "--detour", "ghost-detour", "--verdict", "valid"], { engine }));
  assert.ok(err);
  assert.match(String(err.stderr || err.message), /detour epic 'ghost-detour' not found/);
  assert.equal(engine.store.read("state.json").text, before);
});

unitTest("record-gate-review writes a structured verdict for the given gate onto an openspec-lane epic", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "spec-epic", "--lane", "openspec"]);
  // A Gate 1 PASS with ARTIFACT evidence and no SHA range (gh-177) — the evidence kind that needs
  // no repository, and therefore the one this half can produce.
  engine(["record-gate-review", "spec-epic", "--gate", "1", "--verdict", "pass",
    "--artifact", "openspec/changes/x/proposal.md",
    "--reviewer", "fresh-context review of proposal.md"]);

  const epic = readState(engine).epics.find(e => e.id === "spec-epic");
  assert.ok(epic.gateReview);
  assert.equal(epic.gateReview.gate1.verdict, "pass");
  assert.equal(epic.gateReview.gate1.reviewer, "fresh-context review of proposal.md");
  assert.match(epic.gateReview.gate1.reviewedAt, /^\d{4}-\d{2}-\d{2}T/);
});
unitTest("record-gate-review ACCEPTS a non-openspec-lane epic (#163)", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "cc-epic", "--lane", "claude-code"]);
  engine(["record-gate-review", "cc-epic", "--gate", "1", "--verdict", "pass",
    "--artifact", "docs/plan.md"]);
  const epic = readState(engine).epics.find(e => e.id === "cc-epic");
  assert.equal(epic.gateReview.gate1.verdict, "pass");
  assert.deepEqual(epic.gateReview.gate1.artifacts, ["docs/plan.md"]);
});
unitTest("recording a verdict adds NO archive obligation to a non-openspec lane (#163)", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "cc2", "--lane", "claude-code"]);
  engine(["update-epic", "cc2", "--status", "archived", "--outcome", "delivered", "--no-deferrals"]);
  assert.equal(readState(engine).epics.find(e => e.id === "cc2").status, "archived");
});
unitTest("record-gate-review rejects an unknown epic id", () => {
  const engine = memoryEngine(emptyRecord());
  const before = engine.store.read("state.json").text;
  assert.ok(expectFail(() => engine(
    ["record-gate-review", "ghost", "--gate", "1", "--verdict", "pass", "--artifact", "a.md"], { engine })));
  assert.equal(engine.store.read("state.json").text, before);
});
unitTest("record-gate-review rejects an invalid gate number", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "spec-epic", "--lane", "openspec"]);
  const before = engine.store.read("state.json").text;
  assert.ok(expectFail(() => engine(
    ["record-gate-review", "spec-epic", "--gate", "3", "--verdict", "pass", "--artifact", "a.md"], { engine })));
  assert.equal(engine.store.read("state.json").text, before);
});
unitTest("record-gate-review rejects an invalid verdict", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "spec-epic", "--lane", "openspec"]);
  const before = engine.store.read("state.json").text;
  assert.ok(expectFail(() => engine(
    ["record-gate-review", "spec-epic", "--gate", "1", "--verdict", "maybe"], { engine })));
  assert.equal(engine.store.read("state.json").text, before);
});
unitTest("update-epic blocks archiving an openspec-lane epic without a passing gate2 review", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "spec-epic", "--lane", "openspec"]);
  const before = engine.store.read("state.json").text;
  assert.ok(expectFail(() => engine(["update-epic", "spec-epic", "--status", "archived", "--outcome", "delivered", "--no-deferrals"])));
  assert.equal(engine.store.read("state.json").text, before);
});
unitTest("update-epic blocks archiving an openspec-lane epic with a gate2 fail verdict", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "spec-epic", "--lane", "openspec"]);
  // A FAIL verdict needs no evidence (the same asymmetry a passing Gate 2 has, in reverse), so this
  // is reachable without a commit range.
  engine(["record-gate-review", "spec-epic", "--gate", "2", "--verdict", "fail"]);
  assert.ok(expectFail(() => engine(["update-epic", "spec-epic", "--status", "archived", "--outcome", "delivered", "--no-deferrals"])));
});
unitTest("update-epic archiving a non-openspec-lane epic is unaffected by gate-review enforcement", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "cc-epic", "--lane", "claude-code"]);
  engine(["update-epic", "cc-epic", "--status", "archived", "--outcome", "delivered", "--no-deferrals"]);
  assert.equal(readState(engine).epics.find(e => e.id === "cc-epic").status, "archived");
});

// ---------- sync must not register a directory's own index file as a plan (#87) ----------
unitTest("--help on a mutating subcommand prints usage and writes nothing", () => {
  const engine = memoryEngine(emptyRecord());
  const before = engine.store.read("state.json").text;

  const out = engine(["log-detour", "--help"]);
  assert.match(out, /conductor\.mjs log-detour/);
  assert.ok(!out.includes("init|render|brief"),
    "a named verb must get ITS help, not the global usage blob");

  const logged = engine.store.exists("detours.log") ? engine.store.read("detours.log").text.trim() : "";
  assert.equal(logged, "", `--help wrote a detour entry: ${logged}`);
  assert.equal(engine.store.read("state.json").text, before,
    "--help must not mutate state.json either");
});
unitTest("-h is handled the same as --help", () => {
  const engine = memoryEngine(emptyRecord());
  assert.match(engine(["log-detour", "-h"]), /conductor\.mjs log-detour/);
  assert.ok(!engine.store.exists("detours.log") || engine.store.read("detours.log").text.trim() === "");
});
unitTest("a bare invocation with no subcommand prints usage and exits 0", () => {
  const engine = memoryEngine(emptyRecord());
  assert.match(engine([]), /usage: conductor\.mjs/);
});

// ───────────────────────── the deliberate omissions ─────────────────────────
//
// 1. Every `--base-sha/--head-sha` case: the engine RESOLVES each recorded commit at write time, so
//    a range needs real commits (`fixtureCommits` spawns git) — design D5 sends those to the
//    functional half. This twin proves the same gate with the ARTIFACT evidence kind instead.
// 2. "update-epic allows archiving an openspec-lane epic once gate2 has a passing verdict": a
//    passing Gate 2 requires the range, so the positive half of the pair is functional-only. Its
//    refusals above are the half this half can prove.
// 3. The three `.githooks/pre-commit` tests that RUN the hook against a fixture repository SPAWN a
//    shell (`runHookAgainstFixture`), which 5.2's guard refuses in this half by construction. The
//    hook's SHAPE is asserted HERE instead — it is a source read that needs no shell, so D5 puts it
//    on the per-commit path, and the coupling check that requires both halves to move together is
//    satisfied by that rather than worked around.
// 4. THE TWO GATE 2 HOOK-RUN TESTS (G-I1, G-I3), for the same reason and with the same division of
//    labour: a dotfile the runner's glob cannot reach while the index still declares it (the floor's
//    firing direction), and a marker file in the functional half that fails if it is ever picked up
//    (the hook does not run the triggered half). Both drive the REAL hook in a fixture repository, so
//    both spawn and both belong to the functional half. What this half holds instead is the HOOK'S
//    TEXT: the runner line asserted by exact equality — so a second glob cannot survive it — and the
//    floor's derivation asserted NOT to enumerate the functional half or the sweep bucket. Between
//    them, the source-level shape and the running hook are pinned from both sides, which is the
//    division D5's placement rule produces rather than a gap in it.

// ──────────────── the pre-commit hook's SHAPE ────────────────
//
// IT IS NOT HERE, and this note is the record of why rather than a gap: it READS files, so the
// source scan refuses it in this half. What it watches is the gate whose failure mode is silence —
// a hook that stopped invoking the drift script would commit with the two halves unpaired, and a
// hook that took the enrolment check back inline would carry two implementations of one rule — so
// it lives on the FILE rung, where a source read is what the half is for.
