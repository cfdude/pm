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

test("2.6 --withdraw-gate-review repeats: both gates withdrawn in one call, two entries", () => {
  const cwd = withVerdicts("w26", { gate1: true, gate2: true });
  const before = epicOf(cwd, "w26").withdrawnGateReviews || [];
  accepted(cwd, ["update-epic", "w26", "--withdraw-gate-review", "1", "--withdraw-gate-review", "2", "--withdrawal-reason", "x"]);
  const e = epicOf(cwd, "w26");
  assert.ok(!("gate1" in e.gateReview) && !("gate2" in e.gateReview), `both gates are absent: ${JSON.stringify(e.gateReview)}`);
  const added = e.withdrawnGateReviews.slice(before.length);
  assert.equal(added.length, 2, "exactly two entries were added");
  assert.deepEqual(added.map(w => w.gate).sort(), [1, 2]);
  assert.ok(added.every(w => w.reason === "x"));
});

test("2.7 re-recording after a withdrawal starts clean, and the withdrawal is kept", () => {
  const cwd = withVerdicts("w27");
  accepted(cwd, ["update-epic", "w27", "--withdraw-gate-review", "2", "--withdrawal-reason", "x"]);
  run(["record-gate-review", "w27", ...PASS2], { cwd });
  const e = epicOf(cwd, "w27");
  assert.equal(e.gateReview.gate2.verdict, "pass");
  assert.ok(!("superseded" in e.gateReview.gate2), "the re-recorded verdict supersedes nothing");
  assert.equal(e.withdrawnGateReviews.length, 1);
  assert.equal(e.withdrawnGateReviews[0].reason, "x");
});

test("2.8 the read-back: a state still carrying the verdict, or lacking the entry, did NOT land", async () => {
  const { missingGateWithdrawals } = await import("../lib/update-epic.mjs");
  const at = "2026-09-14T00:00:00.000Z";
  const asked = [{ gate: 2, reason: "r", withdrawnAt: at }];
  const landed = { epics: [{ id: "e", gateReview: {}, withdrawnGateReviews: [{ gate: 2, entry: {}, reason: "r", withdrawnAt: at }] }] };
  assert.deepEqual(missingGateWithdrawals(landed, "e", asked), []);
  const stillStored = { epics: [{ id: "e", gateReview: { gate2: { verdict: "pass" } },
    withdrawnGateReviews: [{ gate: 2, entry: {}, reason: "r", withdrawnAt: at }] }] };
  assert.deepEqual(missingGateWithdrawals(stillStored, "e", asked), [2], "a verdict still stored did not land");
  const noEntry = { epics: [{ id: "e", gateReview: {} }] };
  assert.deepEqual(missingGateWithdrawals(noEntry, "e", asked), [2], "no withdrawal entry did not land");
  const otherReason = { epics: [{ id: "e", gateReview: {}, withdrawnGateReviews: [{ gate: 2, entry: {}, reason: "old", withdrawnAt: at }] }] };
  assert.deepEqual(missingGateWithdrawals(otherReason, "e", asked), [2], "an entry with another reason is not this one");
  assert.deepEqual(missingGateWithdrawals({ epics: [] }, "e", asked), [2], "an absent epic holds nothing");
});

// ═══════════════ refusals — each supplies every other input valid ═══════════════

/** An openspec-lane epic the archive-drift heal archived with no verdict: registered by `sync`
 *  from a change directory, which is then moved under `archive/` and healed by a second `sync`.
 *  The only producer of an `ungated` Gate 2. */
function healArchived(cwd, id, { beforeArchive } = {}) {
  fs.mkdirSync(path.join(cwd, "openspec", "changes", id), { recursive: true });
  fs.writeFileSync(path.join(cwd, "openspec", "changes", id, "tasks.md"), "# tasks\n\n- [x] a\n");
  run(["sync"], { cwd });
  if (beforeArchive) beforeArchive();
  fs.mkdirSync(path.join(cwd, "openspec", "changes", "archive"), { recursive: true });
  fs.renameSync(path.join(cwd, "openspec", "changes", id),
    path.join(cwd, "openspec", "changes", "archive", `2026-09-14-${id}`));
  run(["sync"], { cwd });
}

test("3.1 --withdrawal-reason with neither withdrawal flag is refused, naming both, before state is read", () => {
  const cwd = withVerdicts("r31");
  const r = refused(cwd, ["update-epic", "r31", "--withdrawal-reason", "x"]);
  assert.match(r.stderr, /--withdraw-gate-review/);
  assert.match(r.stderr, /--withdraw-commit/);
  const early = refused(cwd, ["update-epic", "no-such-epic", "--withdrawal-reason", "x"]);
  assert.doesNotMatch(early.stderr, /not found/, "the refusal runs before the epic is looked up in state");
  assert.match(early.stderr, /--withdraw-gate-review/);
});

test("3.2 --withdraw-gate-review without a reason is refused, naming --withdrawal-reason", () => {
  const cwd = withVerdicts("r32");
  const r = refused(cwd, ["update-epic", "r32", "--withdraw-gate-review", "2"]);
  assert.match(r.stderr, /--withdrawal-reason/);
  assert.doesNotMatch(r.stderr, /unknown flag/);
});

test("3.3 a gate other than 1 or 2 is refused, naming the valid values", () => {
  const cwd = withVerdicts("r33", { gate1: true, gate2: true });
  for (const bad of ["3", "0", "x"]) {
    const r = refused(cwd, ["update-epic", "r33", "--withdraw-gate-review", bad, "--withdrawal-reason", "x"]);
    assert.match(r.stderr, /--withdraw-gate-review must be one of 1\|2/, `gate ${bad}: ${r.stderr}`);
  }
});

test("3.4 the same gate twice in one invocation is refused", () => {
  const cwd = withVerdicts("r34");
  const r = refused(cwd, ["update-epic", "r34", "--withdraw-gate-review", "2", "--withdraw-gate-review", "2", "--withdrawal-reason", "x"]);
  assert.match(r.stderr, /Gate 2 is given twice/);
});

test("3.5 a gate with no stored verdict is refused", () => {
  const cwd = withVerdicts("r35", { gate1: false, gate2: true });
  const r = refused(cwd, ["update-epic", "r35", "--withdraw-gate-review", "1", "--withdrawal-reason", "x"]);
  assert.match(r.stderr, /no Gate 1 verdict to withdraw/);
});

test("3.6 an ungated stamp from the heal is refused — it is cleared by recording a real verdict", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  healArchived(cwd, "r36");
  assert.equal(epicOf(cwd, "r36").gateReview.gate2.verdict, "ungated", "precondition: the heal stamped ungated");
  const r = refused(cwd, ["update-epic", "r36", "--withdraw-gate-review", "2", "--withdrawal-reason", "x"]);
  assert.match(r.stderr, /ungated/);
  assert.match(r.stderr, /cleared by recording a real verdict/);
});
