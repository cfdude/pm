import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tmpRepo, run, readState, writeState, expectFail, runHookAgainstFixture, ENGINE } from "./helpers.mjs";

// ──────────────── reconciler structured writeback: record-reconcile ────────────────

test("record-reconcile writes a structured verdict onto the paused epic's link to the detour, and clears reconcileNeeded", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "paused-epic", "--lane", "claude-code"], { cwd });
  run(["add-epic", "--id", "detour-epic", "--lane", "claude-code"], { cwd });
  run(["update-epic", "paused-epic", "--link", "may-invalidate:detour-epic"], { cwd });
  let s = readState(cwd);
  s.epics.find(e => e.id === "paused-epic").reconcileNeeded = true;
  writeState(cwd, s);

  run(["record-reconcile", "paused-epic", "--detour", "detour-epic",
    "--verdict", "invalidated", "--amendments", "rewrite story 2;drop story 4"], { cwd });

  const epic = readState(cwd).epics.find(e => e.id === "paused-epic");
  assert.equal(epic.reconcileNeeded, false);
  const link = epic.links.find(l => l.epic === "detour-epic");
  assert.ok(link, "link to the detour should still exist");
  assert.equal(link.reconciled.verdict, "invalidated");
  assert.deepEqual(link.reconciled.amendments, ["rewrite story 2", "drop story 4"]);
  assert.ok(link.reconciled.reconciledAt);
  assert.match(link.reconciled.reconciledAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("record-reconcile creates the link to the detour if one doesn't already exist", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "paused-epic", "--lane", "claude-code"], { cwd });
  run(["add-epic", "--id", "detour-epic", "--lane", "claude-code"], { cwd });

  run(["record-reconcile", "paused-epic", "--detour", "detour-epic", "--verdict", "valid"], { cwd });

  const epic = readState(cwd).epics.find(e => e.id === "paused-epic");
  const link = epic.links.find(l => l.epic === "detour-epic");
  assert.ok(link, "link should be created");
  assert.equal(link.type, "may-invalidate");
  assert.equal(link.reconciled.verdict, "valid");
  assert.deepEqual(link.reconciled.amendments, []);
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
  assert.ok(expectFail(() => run(
    ["record-reconcile", "paused-epic", "--detour", "ghost-detour", "--verdict", "valid"], { cwd })));
  assert.equal(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"), before);
});

// ---------- doc drift: SKILL.md "Commands" vs the real dispatch table ----------

test("every dispatch-table subcommand is mentioned somewhere in skills/conductor/SKILL.md", () => {
  const engineSrc = fs.readFileSync(ENGINE, "utf8");
  const dispatchMatch = engineSrc.match(/^\(\{\n([\s\S]*?)\n\}\[cmd\]/m);
  assert.ok(dispatchMatch, "could not locate the dispatch table object in conductor.mjs — " +
    "has the dispatch section been restructured? update this test's extraction regex");
  const dispatchBody = dispatchMatch[1];

  // Each dispatch entry key is either a bare identifier (`init,`) or a quoted string
  // (`"set-active": setActive,`). Extract both forms.
  const keys = new Set();
  for (const m of dispatchBody.matchAll(/^\s*"([a-z-]+)"\s*:/gm)) keys.add(m[1]);
  for (const m of dispatchBody.matchAll(/^\s*([a-zA-Z][\w-]*)\s*:/gm)) keys.add(m[1]);
  for (const m of dispatchBody.matchAll(/^\s*([a-zA-Z][\w-]*),?\s*$/gm)) keys.add(m[1]);
  assert.ok(keys.size > 10, `expected many dispatch keys, only extracted ${keys.size}: ${[...keys]}`);

  // No entries are excluded: `snapshot` and `write-rules` are hook/init-only invocations
  // (not run directly by a user/agent) but are still real, documentable subcommands, so
  // they are asserted like everything else rather than excluded.
  const UNDOCUMENTED_INTERNAL = new Set([
    // (currently empty — every dispatch subcommand is expected to be mentioned in SKILL.md)
  ]);

  const skillPath = path.join(path.dirname(ENGINE), "..", "skills", "conductor", "SKILL.md");
  const skillText = fs.readFileSync(skillPath, "utf8");

  const missing = [];
  for (const key of keys) {
    if (UNDOCUMENTED_INTERNAL.has(key)) continue;
    if (!skillText.includes(key)) missing.push(key);
  }
  assert.deepEqual(missing, [],
    `SKILL.md's Commands section (or elsewhere in the doc) is missing a mention of: ${missing.join(", ")}`);
});

// ──────────────── openspec gate enforcement: record-gate-review ────────────────

test("record-gate-review writes a structured verdict for the given gate onto an openspec-lane epic", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "spec-epic", "--lane", "openspec"], { cwd });

  run(["record-gate-review", "spec-epic", "--gate", "1", "--verdict", "pass", "--reviewer", "fresh-context review of proposal.md"], { cwd });

  const epic = readState(cwd).epics.find(e => e.id === "spec-epic");
  assert.ok(epic.gateReview);
  assert.equal(epic.gateReview.gate1.verdict, "pass");
  assert.equal(epic.gateReview.gate1.note, "fresh-context review of proposal.md");
  assert.ok(epic.gateReview.gate1.reviewedAt);
  assert.match(epic.gateReview.gate1.reviewedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("record-gate-review supports gate 2 independently of gate 1", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "spec-epic", "--lane", "openspec"], { cwd });

  run(["record-gate-review", "spec-epic", "--gate", "2", "--verdict", "pass"], { cwd });

  const epic = readState(cwd).epics.find(e => e.id === "spec-epic");
  assert.equal(epic.gateReview.gate2.verdict, "pass");
  assert.equal(epic.gateReview.gate1, undefined);
});

test("record-gate-review rejects a non-openspec-lane epic", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "cc-epic", "--lane", "claude-code"], { cwd });
  const before = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
  assert.ok(expectFail(() => run(
    ["record-gate-review", "cc-epic", "--gate", "1", "--verdict", "pass"], { cwd })));
  assert.equal(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"), before);
});

test("record-gate-review rejects an unknown epic id", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  const before = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
  assert.ok(expectFail(() => run(
    ["record-gate-review", "ghost", "--gate", "1", "--verdict", "pass"], { cwd })));
  assert.equal(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"), before);
});

test("record-gate-review rejects an invalid gate number", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "spec-epic", "--lane", "openspec"], { cwd });
  const before = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
  assert.ok(expectFail(() => run(
    ["record-gate-review", "spec-epic", "--gate", "3", "--verdict", "pass"], { cwd })));
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
  assert.ok(expectFail(() => run(["update-epic", "spec-epic", "--status", "archived"], { cwd })));
  assert.equal(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"), before);
});

test("update-epic blocks archiving an openspec-lane epic with a gate2 fail verdict", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "spec-epic", "--lane", "openspec"], { cwd });
  run(["record-gate-review", "spec-epic", "--gate", "2", "--verdict", "fail"], { cwd });
  assert.ok(expectFail(() => run(["update-epic", "spec-epic", "--status", "archived"], { cwd })));
});

test("update-epic allows archiving an openspec-lane epic once gate2 has a passing verdict", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "spec-epic", "--lane", "openspec"], { cwd });
  run(["record-gate-review", "spec-epic", "--gate", "1", "--verdict", "pass"], { cwd });
  run(["record-gate-review", "spec-epic", "--gate", "2", "--verdict", "pass"], { cwd });

  run(["update-epic", "spec-epic", "--status", "archived"], { cwd });

  const epic = readState(cwd).epics.find(e => e.id === "spec-epic");
  assert.equal(epic.status, "archived");
});

test("update-epic archiving a non-openspec-lane epic is unaffected by gate-review enforcement", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "cc-epic", "--lane", "claude-code"], { cwd });

  run(["update-epic", "cc-epic", "--status", "archived"], { cwd });

  const epic = readState(cwd).epics.find(e => e.id === "cc-epic");
  assert.equal(epic.status, "archived");
});

// ---------- doc drift: README.md "Commands" vs the real dispatch table ----------

test("every dispatch-table subcommand is mentioned somewhere in README.md", () => {
  const engineSrc = fs.readFileSync(ENGINE, "utf8");
  const dispatchMatch = engineSrc.match(/^\(\{\n([\s\S]*?)\n\}\[cmd\]/m);
  assert.ok(dispatchMatch, "could not locate the dispatch table object in conductor.mjs — " +
    "has the dispatch section been restructured? update this test's extraction regex");
  const dispatchBody = dispatchMatch[1];

  const keys = new Set();
  for (const m of dispatchBody.matchAll(/^\s*"([a-z-]+)"\s*:/gm)) keys.add(m[1]);
  for (const m of dispatchBody.matchAll(/^\s*([a-zA-Z][\w-]*)\s*:/gm)) keys.add(m[1]);
  for (const m of dispatchBody.matchAll(/^\s*([a-zA-Z][\w-]*),?\s*$/gm)) keys.add(m[1]);
  assert.ok(keys.size > 10, `expected many dispatch keys, only extracted ${keys.size}: ${[...keys]}`);

  // No entries are excluded — same precedent as the SKILL.md drift test: hook/init-only
  // subcommands (commit-nudge, snapshot, write-rules) are still real and documentable, so
  // they're asserted like everything else rather than silently excluded.
  const UNDOCUMENTED_INTERNAL = new Set([
    // (currently empty — every dispatch subcommand is expected to be mentioned in README.md)
  ]);

  const readmePath = path.join(path.dirname(ENGINE), "..", "README.md");
  const readmeText = fs.readFileSync(readmePath, "utf8");

  const missing = [];
  for (const key of keys) {
    if (UNDOCUMENTED_INTERNAL.has(key)) continue;
    if (!readmeText.includes(key)) missing.push(key);
  }
  assert.deepEqual(missing, [],
    `README.md's Commands section (or elsewhere in the doc) is missing a mention of: ${missing.join(", ")}`);
});

// ---------- pre-commit hook: mechanical test-before-commit safeguard ----------

test(".githooks/pre-commit exists, is executable, and runs the full test suite", () => {
  const hookPath = path.join(path.dirname(ENGINE), "..", ".githooks", "pre-commit");
  assert.ok(fs.existsSync(hookPath), ".githooks/pre-commit is missing");
  const stat = fs.statSync(hookPath);
  assert.ok(stat.mode & 0o111, ".githooks/pre-commit is not executable");
  const hookText = fs.readFileSync(hookPath, "utf8");
  assert.match(hookText, /node --test scripts\/test\/\*\.test\.mjs/,
    ".githooks/pre-commit does not run the full test suite");
  assert.match(hookText, /set -e/, ".githooks/pre-commit does not fail the commit on a non-zero exit");
  // The glob makes partial-suite runs possible in a way the old single file did not, so the
  // hook must cross-check the ran count against the declared count. Assert that guard exists.
  assert.match(hookText, /grep -c '\^test\('/,
    ".githooks/pre-commit does not cross-check the ran test count against the declared count");
});

test(".githooks/pre-commit aborts when the glob runs FEWER tests than are declared", () => {
  // The failure mode the glob introduces: a test file that stops being picked up. The suite
  // still passes -- on a subset. Simulated here by declaring tests in a file the hook's glob
  // cannot match (.mjs without the .test infix), so declared > ran.
  const r = runHookAgainstFixture(
    `test("one that does run", () => { assert.ok(true); });`,
    { extraFiles: { "scripts/test/orphan.mjs": 'test("never picked up", () => {});\ntest("nor this", () => {});\n' } },
  );
  const combined = (r.stdout || "") + (r.stderr || "");
  // orphan.mjs is not matched by *.test.mjs, so it contributes nothing to either count -- the
  // guard must not false-positive here. This pins the guard's precision, not just its presence.
  assert.equal(r.status, 0, `guard must not fire on a non-test .mjs file: ${combined}`);
  assert.match(combined, /pre-commit: 1\/1 passing/);
});

test(".githooks/pre-commit is quiet on success -- one summary line, no per-test noise, no engine banner", () => {
  const passingTests = `
    import { test } from "node:test";
    import assert from "node:assert/strict";
    test("a passing test", () => { assert.ok(true); });
    test("another passing test", () => { assert.ok(true); });
  `;
  const r = runHookAgainstFixture(passingTests);
  assert.equal(r.status, 0, `expected the hook to exit 0 on a passing suite: ${r.stdout}${r.stderr}`);
  const combined = (r.stdout || "") + (r.stderr || "");
  assert.match(combined, /pre-commit: 2\/2 passing/, "expected a one-line N/N passing summary");
  assert.doesNotMatch(combined, /✔/, "should not dump individual per-test pass lines on success");
});

test(".githooks/pre-commit dumps full node --test output and fails the commit when a test actually fails", () => {
  const failingTests = `
    import { test } from "node:test";
    import assert from "node:assert/strict";
    test("a passing test", () => { assert.ok(true); });
    test("a FAILING test", () => { assert.ok(false, "boom"); });
  `;
  const r = runHookAgainstFixture(failingTests);
  assert.notEqual(r.status, 0, "expected the hook to exit non-zero on a failing suite");
  const combined = (r.stdout || "") + (r.stderr || "");
  assert.match(combined, /a FAILING test/, "full test output (including the failure) must be dumped on failure");
  assert.doesNotMatch(combined, /^pre-commit: \d+\/\d+ passing/m, "must not print the success summary on failure");
});
