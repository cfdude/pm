// gate-verdict-withdrawal — `update-epic <id> --withdraw-gate-review <1|2> --withdrawal-reason
// "<why>"` moves a recorded verdict out of `gateReview.gateN` into `withdrawnGateReviews[]`, and
// the WITHDRAWN state is reported as withdrawn on every surface, never as absent.
//
// Every refusal here asserts `state.json` BYTE-IDENTICAL and the refusal's CAUSE, never only a
// non-zero exit: an unknown-flag refusal would satisfy an exit-code assertion as well.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import * as constants from "../lib/constants.mjs";
import { ENGINE, EMPTY_CACHE, tmpRepo, run, readState } from "./helpers.mjs";

const stateFile = (cwd) => path.join(cwd, ".conductor", "state.json");
const stateBytes = (cwd) => fs.readFileSync(stateFile(cwd));
const epicOf = (cwd, id) => readState(cwd).epics.find(e => e.id === id);

/** Run the engine WITHOUT throwing, so a test can read the exit code and both streams. */
function attempt(cwd, args) {
  const r = spawnSync("node", [ENGINE, ...args], {
    cwd, encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, PM_CACHE_ROOT: EMPTY_CACHE },
  });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

/** Assert a refusal that wrote nothing, and hand back what it printed. */
function refused(cwd, args) {
  const before = stateBytes(cwd);
  const r = attempt(cwd, args);
  assert.notEqual(r.status, 0, `expected a refusal, got exit 0.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  assert.ok(stateBytes(cwd).equals(before), "a refused invocation must leave state.json byte-identical");
  return r;
}

/** Assert an accepted invocation, and hand back what it printed. */
function accepted(cwd, args) {
  const r = attempt(cwd, args);
  assert.equal(r.status, 0, `expected exit 0.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  return r;
}

// ═══════════════ withdrawnGate(epic, n) — the one definition of the withdrawn state ═══════════════

const withdrawal = (gate, reason, at = "2026-09-14T00:00:00.000Z") =>
  ({ gate, entry: { verdict: "pass", reviewedAt: "2026-09-13T00:00:00.000Z" }, reason, withdrawnAt: at });

test("2.2 withdrawnGate: an absent entry with a withdrawal answers the LATEST withdrawal", () => {
  const e = { id: "e", gateReview: {}, withdrawnGateReviews: [
    withdrawal(2, "first", "2026-09-14T00:00:00.000Z"),
    withdrawal(1, "gate one"),
    withdrawal(2, "second", "2026-09-14T01:00:00.000Z"),
  ] };
  assert.equal(constants.withdrawnGate(e, 2).reason, "second");
  assert.equal(constants.withdrawnGate(e, 1).reason, "gate one");
  assert.equal(constants.withdrawnGate({ id: "e", withdrawnGateReviews: [withdrawal(2, "no gateReview object")] }, 2).reason,
    "no gateReview object", "an epic with no gateReview object at all has no stored verdict");
});

test("2.2 withdrawnGate: a stored pass with a withdrawal in its history is NOT withdrawn", () => {
  const e = { id: "e", gateReview: { gate2: { verdict: "pass", reviewedAt: "x" } }, withdrawnGateReviews: [withdrawal(2, "r")] };
  assert.equal(constants.withdrawnGate(e, 2), null);
});

test("2.2 withdrawnGate: a stored ungated with a withdrawal in its history is NOT withdrawn", () => {
  const e = { id: "e", gateReview: { gate2: { verdict: "ungated", reviewedAt: "x" } }, withdrawnGateReviews: [withdrawal(2, "r")] };
  assert.equal(constants.withdrawnGate(e, 2), null);
});

test("2.2 withdrawnGate: no withdrawal is not withdrawn", () => {
  assert.equal(constants.withdrawnGate({ id: "e" }, 2), null);
  assert.equal(constants.withdrawnGate({ id: "e", gateReview: {}, withdrawnGateReviews: [] }, 1), null);
  assert.equal(constants.withdrawnGate({ id: "e", withdrawnGateReviews: [withdrawal(1, "other gate")] }, 2), null);
});

// ═══════════════ the withdrawal write ═══════════════

const PASS2 = ["--gate", "2", "--verdict", "pass", "--base-sha", "aaaaaaa", "--head-sha", "bbbbbbb"];
const PASS1 = ["--gate", "1", "--verdict", "pass", "--artifact", "openspec/changes/x/proposal.md"];

/** An initialized repository holding one claude-code epic `id` (no task source, so no archive
 *  obligation interferes) carrying the verdicts named. */
function withVerdicts(id = "w", { gate1 = false, gate2 = true, lane = "claude-code" } = {}) {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", id, "--lane", lane], { cwd });
  if (gate1) run(["record-gate-review", id, ...PASS1], { cwd });
  if (gate2) run(["record-gate-review", id, ...PASS2], { cwd });
  return cwd;
}

test("2.3 withdrawing a Gate 2 pass moves the whole entry to withdrawnGateReviews", () => {
  const cwd = withVerdicts("w23");
  const stored = epicOf(cwd, "w23").gateReview.gate2;
  accepted(cwd, ["update-epic", "w23", "--withdraw-gate-review", "2", "--withdrawal-reason", "recorded on the tracker mirror"]);
  const e = epicOf(cwd, "w23");
  assert.ok(!("gate2" in e.gateReview), "gateReview.gate2 is absent after the withdrawal");
  const last = e.withdrawnGateReviews.at(-1);
  assert.equal(last.gate, 2);
  assert.equal(last.reason, "recorded on the tracker mirror");
  assert.ok(!Number.isNaN(Date.parse(last.withdrawnAt)), `withdrawnAt is a timestamp: ${last.withdrawnAt}`);
  assert.deepEqual(last.entry, stored, "the entry is the verdict exactly as it was stored");
});

test("2.4 a Gate 1 carrying superseded moves whole, and nothing is promoted", () => {
  const cwd = withVerdicts("w24", { gate1: true, gate2: false });
  run(["record-gate-review", "w24", "--gate", "1", "--verdict", "fail"], { cwd });
  const stored = epicOf(cwd, "w24").gateReview.gate1;
  assert.ok(stored.superseded, "precondition: the stored Gate 1 carries a superseded entry");
  accepted(cwd, ["update-epic", "w24", "--withdraw-gate-review", "1", "--withdrawal-reason", "x"]);
  const e = epicOf(cwd, "w24");
  assert.ok(!("gate1" in e.gateReview), "the superseded entry is NOT promoted to the stored verdict");
  assert.deepEqual(e.withdrawnGateReviews.at(-1).entry, stored);
  assert.deepEqual(e.withdrawnGateReviews.at(-1).entry.superseded, stored.superseded);
});

test("2.5 withdrawing one gate leaves the other deep-equal", () => {
  const cwd = withVerdicts("w25", { gate1: true, gate2: true });
  const gate2 = epicOf(cwd, "w25").gateReview.gate2;
  accepted(cwd, ["update-epic", "w25", "--withdraw-gate-review", "1", "--withdrawal-reason", "x"]);
  assert.deepEqual(epicOf(cwd, "w25").gateReview.gate2, gate2);
});
