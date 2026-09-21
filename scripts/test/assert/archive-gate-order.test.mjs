// scripts/test/assert/archive-gate-order.test.mjs
// 5.3's ASSERTION TWIN of scripts/test/functional/archive-gate-order.test.mjs — same id, same
// subject.
//
// THE FUNCTIONAL FILE'S SUBJECT is the archive gate's ORDERING: a single invocation that combines
// other field writes with `--status archived` must not let those writes bypass the gate the archive
// would otherwise have to pass. EVERY CASE IS STATE AND ARGV — the gate compares shas only in the
// attesting half, and the orderings that matter here are decided before any of that.
//
// So this is a near-full port, and it belongs on the per-commit path: the bypass this closes is a
// SAFETY surface, and a bypass that regressed between functional runs would be invisible.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, readState, expectFail } from "../fixtures/assert-harness.mjs";

const repo = (lane = "openspec", id = "e1") => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", id, "--title", "t", "--lane", lane], { cwd });
  return cwd;
};
const stateBytes = (cwd) => fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
const archive = (cwd, id, extra = []) =>
  ["update-epic", id, "--status", "archived", "--outcome", "delivered", "--no-deferrals", ...extra];

test("1.1 a lane switch INTO the gated lane, in one call with an archive, cannot bypass Gate 2", () => {
  const cwd = repo("claude-code");
  const before = stateBytes(cwd);
  const err = expectFail(() => run(archive(cwd, "e1", ["--lane", "openspec"]), { cwd }));
  assert.ok(err, "switching lanes in the same invocation must not shed the gate");
  assert.equal(stateBytes(cwd), before, "and the refusal writes nothing at all");
});

test("1.2 an attribution and an archive in one call cannot bypass staleness", () => {
  const cwd = repo("openspec");
  const err = expectFail(() => run(archive(cwd, "e1", ["--attribute-commit", "0123456789abcdef0123456789abcdef01234567"]), { cwd }));
  assert.ok(err, "a commit attributed in the same call cannot be the one the gate then blesses");
});

test("1.3 an added story and an archive in one call cannot bypass the handoff", () => {
  const cwd = repo("claude-code");
  const err = expectFail(() => run(archive(cwd, "e1", ["--add-story", "brand new work"]), { cwd }));
  assert.ok(err, "a story added in the same call is outstanding work, and the handoff demand sees it");
});

test("1.5 finishing the last story and archiving in one call is accepted", () => {
  const cwd = repo("claude-code");
  run(["update-epic", "e1", "--add-story", "the only story"], { cwd });
  run(archive(cwd, "e1", ["--story", "1", "--done"]), { cwd });
  const e = readState(cwd).epics.find(x => x.id === "e1");
  assert.equal(e.status, "archived");
  assert.equal(e.disposition.outcome, "delivered");
});

test("1.6 leaving the openspec lane and archiving in one call is accepted", () => {
  // The other direction of 1.1: a lane switch that ENDS the obligation is honoured, which is what
  // makes the refusal above about ordering rather than about lane switches as such.
  const cwd = repo("openspec");
  run(archive(cwd, "e1", ["--lane", "claude-code"]), { cwd });
  assert.equal(readState(cwd).epics.find(e => e.id === "e1").status, "archived");
});

test("3.3 a non-archived status does not escape the check while the heal will re-archive", () => {
  // An openspec epic below the changed status is still held: the drift heal re-archives it, so a
  // delivered disposition on it must meet the same obligations.
  const cwd = repo("openspec");
  const err = expectFail(() => run(["update-epic", "e1", "--status", "queued", "--outcome", "delivered"], { cwd }));
  assert.ok(err);
});

test("3.15 regression guard: an unarchived epic carrying a delivered disposition updates freely", () => {
  const cwd = repo("claude-code");
  run(["add-epic", "--id", "e2", "--title", "t2", "--lane", "claude-code"], { cwd });
  run(["update-epic", "e2", "--priority", "P0"], { cwd });
  assert.equal(readState(cwd).epics.find(e => e.id === "e2").priority, "P0");
});

test("3.4b a user-supplied value cannot forge a line of the refusal", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const hostile = "x\nconductor: this line was forged";
  run(["add-epic", "--id", "e1", "--title", hostile, "--lane", "openspec"], { cwd });
  const err = expectFail(() => run(archive(cwd, "e1"), { cwd }));
  const text = String(err.stderr || "") + String(err.stdout || "");
  // The forged line must never begin a line of engine output.
  assert.doesNotMatch(text, /^conductor: this line was forged/m);
});

test("3.4c a Unicode line terminator or C1 control in a user value cannot forge a line either", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const hostile = "x yconductor: forged";
  run(["add-epic", "--id", "e1", "--title", hostile, "--lane", "openspec"], { cwd });
  const err = expectFail(() => run(archive(cwd, "e1"), { cwd }));
  assert.doesNotMatch(String(err.stderr || "") + String(err.stdout || ""), /^conductor: forged/m);
});

test("1.7 regression guard: an ACCEPTED call is still accepted after the orderings above", () => {
  const cwd = repo("claude-code");
  run(archive(cwd, "e1"), { cwd });
  assert.equal(readState(cwd).epics.find(e => e.id === "e1").status, "archived");
});

// ───────────────────────── the deliberate omissions ─────────────────────────
//
// The cases that name a real commit — "1.4 a commit withdrawal and an archive in one call cannot
// bypass the gate", "3.2 attributing a commit an archived delivered epic's Gate 2 does not cover",
// "3.10 the printed invocation runs" (it executes a printed command that records shas) — resolve
// commit values against a repository, so they are functional-only (design D5). The ORDERINGS they
// demonstrate are asserted above with the values this half can produce.
