// scripts/test/assert/conductor-09.test.mjs
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

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, readState, expectFail, ENGINE } from "../fixtures/assert-harness.mjs";

// ──────────────── reconciler structured writeback: record-reconcile ────────────────

test("record-reconcile writes a structured verdict onto the paused epic's link to the detour, and clears reconcileNeeded", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "paused-epic", "--lane", "claude-code"], { cwd });
  run(["add-epic", "--id", "detour-epic", "--lane", "claude-code"], { cwd });
  run(["set-active", "paused-epic"], { cwd });
  run(["push-detour", "paused-epic", "--detour", "detour-epic", "--reason", "blocked", "--reconcile"], { cwd });
  run(["pop-detour", "paused-epic"], { cwd });
  assert.equal(readState(cwd).epics.find(e => e.id === "paused-epic").reconcileNeeded, true);

  run(["record-reconcile", "paused-epic", "--detour", "detour-epic",
    "--verdict", "invalidated", "--amendments", "rewrite story 2;drop story 4"], { cwd });

  const epic = readState(cwd).epics.find(e => e.id === "paused-epic");
  assert.equal(epic.reconcileNeeded, false);
  const link = epic.links.find(l => l.epic === "detour-epic");
  assert.ok(link, "link to the detour should still exist");
  assert.equal(link.reconciled.verdict, "invalidated");
  assert.deepEqual(link.reconciled.amendments, ["rewrite story 2", "drop story 4"]);
  assert.match(link.reconciled.reconciledAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("record-reconcile NEVER creates a link: a detour the epic was not paused for is refused, and nothing is written", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "paused-epic", "--lane", "claude-code"], { cwd });
  run(["add-epic", "--id", "detour-epic", "--lane", "claude-code"], { cwd });
  const before = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");

  const err = expectFail(() => run(["record-reconcile", "paused-epic", "--detour", "detour-epic", "--verdict", "valid"], { cwd }));
  assert.ok(err, "a verdict against a detour nobody armed is refused");
  assert.match(String(err.stderr || err.message), /owes no reconcile verdict/);
  assert.equal(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"), before, "nothing was written");
  const epic = readState(cwd).epics.find(e => e.id === "paused-epic");
  assert.equal((epic.links || []).some(l => l.epic === "detour-epic"), false, "no link was created");
});

test("record-reconcile rejects an unknown verdict", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "paused-epic", "--lane", "claude-code"], { cwd });
  run(["add-epic", "--id", "detour-epic", "--lane", "claude-code"], { cwd });
  assert.ok(expectFail(() => run(
    ["record-reconcile", "paused-epic", "--detour", "detour-epic", "--verdict", "maybe"], { cwd })));
});

test("record-reconcile on an unknown epic id exits non-zero and writes nothing", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "detour-epic", "--lane", "claude-code"], { cwd });
  const before = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
  assert.ok(expectFail(() => run(
    ["record-reconcile", "ghost", "--detour", "detour-epic", "--verdict", "valid"], { cwd })));
  assert.equal(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"), before);
});

test("record-reconcile on an unknown detour id exits non-zero and writes nothing", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "paused-epic", "--lane", "claude-code"], { cwd });
  const before = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
  const err = expectFail(() => run(
    ["record-reconcile", "paused-epic", "--detour", "ghost-detour", "--verdict", "valid"], { cwd }));
  assert.ok(err);
  assert.match(String(err.stderr || err.message), /detour epic 'ghost-detour' not found/);
  assert.equal(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"), before);
});

// ---------- doc drift: SKILL.md "Commands" vs the real dispatch table ----------

/** The dispatch table's keys, extracted from conductor.mjs EXACTLY as the functional file extracts
 *  them — the `}({ … }[cmd]` object literal, re-pointed for the `main(argv, io)` wrapper. Kept
 *  identical so the two halves cannot disagree about what the table holds. */
function dispatchKeys(engineSrc) {
  const dispatchMatch = engineSrc.match(/\(\{\n([\s\S]*?)\n\s*\}\[cmd\]/m);
  assert.ok(dispatchMatch, "could not locate the dispatch table object in conductor.mjs");
  const body = dispatchMatch[1];
  const keys = new Set();
  for (const m of body.matchAll(/^\s*"([a-z-]+)"\s*:/gm)) keys.add(m[1]);
  for (const m of body.matchAll(/^\s*([a-zA-Z][\w-]*)\s*:/gm)) keys.add(m[1]);
  for (const m of body.matchAll(/^\s*([a-zA-Z][\w-]*),?\s*$/gm)) keys.add(m[1]);
  assert.ok(keys.size > 10, `expected many dispatch keys, only extracted ${keys.size}`);
  return keys;
}

test("every dispatch-table subcommand is mentioned somewhere in skills/conductor/SKILL.md", () => {
  const keys = dispatchKeys(fs.readFileSync(ENGINE, "utf8"));
  const skillText = fs.readFileSync(path.join(path.dirname(ENGINE), "..", "skills", "conductor", "SKILL.md"), "utf8");
  const missing = [...keys].filter(k => !skillText.includes(k));
  assert.deepEqual(missing, [],
    `SKILL.md's Commands section (or elsewhere in the doc) is missing a mention of: ${missing.join(", ")}`);
});

test("every dispatch-table subcommand is mentioned somewhere in README.md", () => {
  const keys = dispatchKeys(fs.readFileSync(ENGINE, "utf8"));
  const readmeText = fs.readFileSync(path.join(path.dirname(ENGINE), "..", "README.md"), "utf8");
  const missing = [...keys].filter(k => !readmeText.includes(k));
  assert.deepEqual(missing, [],
    `README.md's Commands section (or elsewhere in the doc) is missing a mention of: ${missing.join(", ")}`);
});

// ──────────────── openspec gate enforcement: record-gate-review ────────────────

test("record-gate-review writes a structured verdict for the given gate onto an openspec-lane epic", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "spec-epic", "--lane", "openspec"], { cwd });
  // A Gate 1 PASS with ARTIFACT evidence and no SHA range (gh-177) — the evidence kind that needs
  // no repository, and therefore the one this half can produce.
  run(["record-gate-review", "spec-epic", "--gate", "1", "--verdict", "pass",
    "--artifact", "openspec/changes/x/proposal.md",
    "--reviewer", "fresh-context review of proposal.md"], { cwd });

  const epic = readState(cwd).epics.find(e => e.id === "spec-epic");
  assert.ok(epic.gateReview);
  assert.equal(epic.gateReview.gate1.verdict, "pass");
  assert.equal(epic.gateReview.gate1.reviewer, "fresh-context review of proposal.md");
  assert.match(epic.gateReview.gate1.reviewedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("record-gate-review ACCEPTS a non-openspec-lane epic (#163)", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "cc-epic", "--lane", "claude-code"], { cwd });
  run(["record-gate-review", "cc-epic", "--gate", "1", "--verdict", "pass",
    "--artifact", "docs/plan.md"], { cwd });
  const epic = readState(cwd).epics.find(e => e.id === "cc-epic");
  assert.equal(epic.gateReview.gate1.verdict, "pass");
  assert.deepEqual(epic.gateReview.gate1.artifacts, ["docs/plan.md"]);
});

test("recording a verdict adds NO archive obligation to a non-openspec lane (#163)", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "cc2", "--lane", "claude-code"], { cwd });
  run(["update-epic", "cc2", "--status", "archived", "--outcome", "delivered", "--no-deferrals"], { cwd });
  assert.equal(readState(cwd).epics.find(e => e.id === "cc2").status, "archived");
});

test("record-gate-review rejects an unknown epic id", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  const before = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
  assert.ok(expectFail(() => run(
    ["record-gate-review", "ghost", "--gate", "1", "--verdict", "pass", "--artifact", "a.md"], { cwd })));
  assert.equal(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"), before);
});

test("record-gate-review rejects an invalid gate number", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "spec-epic", "--lane", "openspec"], { cwd });
  const before = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
  assert.ok(expectFail(() => run(
    ["record-gate-review", "spec-epic", "--gate", "3", "--verdict", "pass", "--artifact", "a.md"], { cwd })));
  assert.equal(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"), before);
});

test("record-gate-review rejects an invalid verdict", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "spec-epic", "--lane", "openspec"], { cwd });
  const before = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
  assert.ok(expectFail(() => run(
    ["record-gate-review", "spec-epic", "--gate", "1", "--verdict", "maybe"], { cwd })));
  assert.equal(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"), before);
});

test("update-epic blocks archiving an openspec-lane epic without a passing gate2 review", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "spec-epic", "--lane", "openspec"], { cwd });
  const before = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
  assert.ok(expectFail(() => run(["update-epic", "spec-epic", "--status", "archived", "--outcome", "delivered", "--no-deferrals"], { cwd })));
  assert.equal(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"), before);
});

test("update-epic blocks archiving an openspec-lane epic with a gate2 fail verdict", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "spec-epic", "--lane", "openspec"], { cwd });
  // A FAIL verdict needs no evidence (the same asymmetry a passing Gate 2 has, in reverse), so this
  // is reachable without a commit range.
  run(["record-gate-review", "spec-epic", "--gate", "2", "--verdict", "fail"], { cwd });
  assert.ok(expectFail(() => run(["update-epic", "spec-epic", "--status", "archived", "--outcome", "delivered", "--no-deferrals"], { cwd })));
});

test("update-epic archiving a non-openspec-lane epic is unaffected by gate-review enforcement", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "cc-epic", "--lane", "claude-code"], { cwd });
  run(["update-epic", "cc-epic", "--status", "archived", "--outcome", "delivered", "--no-deferrals"], { cwd });
  assert.equal(readState(cwd).epics.find(e => e.id === "cc-epic").status, "archived");
});

// ---------- sync must not register a directory's own index file as a plan (#87) ----------

test("sync ignores README.md/INDEX.md in the plans directory — they are not plans", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const plans = path.join(cwd, "docs", "superpowers", "plans");
  fs.mkdirSync(plans, { recursive: true });
  fs.writeFileSync(path.join(plans, "README.md"), "# Superpowers Plans — Active\n\nThis directory holds only active plans.\n");
  fs.writeFileSync(path.join(plans, "INDEX.md"), "# Index\n");
  fs.writeFileSync(path.join(plans, "2026-01-01-real-plan.md"), "# A Real Plan\n\n- [ ] step one\n");

  run(["sync"], { cwd });
  const ids = readState(cwd).epics.map(e => e.id);

  assert.ok(ids.includes("2026-01-01-real-plan"), "a genuine plan must still register");
  assert.ok(!ids.includes("README"), `README.md registered as an epic: ${ids.join(", ")}`);
  assert.ok(!ids.includes("INDEX"), `INDEX.md registered as an epic: ${ids.join(", ")}`);
});

// ---------- a help flag must never have a side effect (#91 family) ----------

test("--help on a mutating subcommand prints usage and writes nothing", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const before = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");

  const out = run(["log-detour", "--help"], { cwd });
  assert.match(out, /conductor\.mjs log-detour/);
  assert.ok(!out.includes("init|render|brief"),
    "a named verb must get ITS help, not the global usage blob");

  const logPath = path.join(cwd, ".conductor", "detours.log");
  const logged = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8").trim() : "";
  assert.equal(logged, "", `--help wrote a detour entry: ${logged}`);
  assert.equal(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"), before,
    "--help must not mutate state.json either");
});

test("-h is handled the same as --help", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  assert.match(run(["log-detour", "-h"], { cwd }), /conductor\.mjs log-detour/);
  const logPath = path.join(cwd, ".conductor", "detours.log");
  assert.ok(!fs.existsSync(logPath) || fs.readFileSync(logPath, "utf8").trim() === "");
});

test("a bare invocation with no subcommand prints usage and exits 0", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  assert.match(run([], { cwd }), /usage: conductor\.mjs/);
});

// ───────────────────────── the deliberate omissions ─────────────────────────
//
// 1. Every `--base-sha/--head-sha` case: the engine RESOLVES each recorded commit at write time, so
//    a range needs real commits (`fixtureCommits` spawns git) — design D5 sends those to the
//    functional half. This twin proves the same gate with the ARTIFACT evidence kind instead.
// 2. "update-epic allows archiving an openspec-lane epic once gate2 has a passing verdict": a
//    passing Gate 2 requires the range, so the positive half of the pair is functional-only. Its
//    refusals above are the half this half can prove.
// 3. The three `.githooks/pre-commit` tests SPAWN a shell (`runHookAgainstFixture`), which 5.2's
//    guard refuses in this half by construction.
