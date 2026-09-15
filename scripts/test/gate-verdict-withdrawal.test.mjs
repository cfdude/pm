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
