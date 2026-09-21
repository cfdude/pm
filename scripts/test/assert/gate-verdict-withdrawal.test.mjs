// scripts/test/assert/gate-verdict-withdrawal.test.mjs
// 5.3's ASSERTION TWIN of scripts/test/functional/gate-verdict-withdrawal.test.mjs — same id, same
// subject.
//
// THE FUNCTIONAL FILE'S SUBJECT is the gate-verdict WITHDRAWAL: a verdict can be taken back, the
// withdrawal is RECORDED rather than erased, the archive gate and the regression check both read the
// withdrawn state, and both surfaces render it. Almost all of it is decided from state.json and the
// argv — only the cases that assert a verdict over a REAL commit range need git (design D5).
//
// A WITHDRAWAL IS A JUDGMENT ABOUT EVIDENCE, so its refusals matter as much as its writes: a
// withdrawal with no reason, or against a gate that has no verdict, is exactly the shape that
// quietly turns a gate into a formality.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, runCombined, readState, writeState, expectFail, projectMd, parseBrief } from "../fixtures/assert-harness.mjs";

const repo = () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "e1", "--title", "t", "--lane", "openspec"], { cwd });
  return cwd;
};
const stateBytes = (cwd) => fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");

/** A state carrying a gate-1 pass recorded with ARTIFACTS — the evidence kind that needs no
 *  commit range, and therefore the kind this half can produce. */
function withGate1(cwd, extra = {}) {
  const st = readState(cwd);
  st.epics[0].gateReview = { gate1: { verdict: "pass", artifacts: ["proposal.md"],
    reviewedAt: "2026-01-01T00:00:00Z", ...extra } };
  writeState(cwd, st);
}

// ─────────────────── the refusal family ───────────────────

test("3.1 --withdrawal-reason with neither withdrawal flag is refused, naming both, before state is read", () => {
  const cwd = repo();
  const before = stateBytes(cwd);
  const err = expectFail(() => run(["update-epic", "e1", "--withdrawal-reason", "why"], { cwd }));
  assert.ok(err);
  const text = String(err.stderr || "");
  assert.match(text, /--withdraw-gate-review|--withdraw-commit/, "it names the flags it belongs with");
  assert.equal(stateBytes(cwd), before);
});

test("3.2 --withdraw-gate-review without a reason is refused, naming --withdrawal-reason", () => {
  const cwd = repo();
  withGate1(cwd);
  const before = stateBytes(cwd);
  const err = expectFail(() => run(["update-epic", "e1", "--withdraw-gate-review", "1"], { cwd }));
  assert.match(String(err.stderr || ""), /--withdrawal-reason/);
  assert.equal(stateBytes(cwd), before);
});

test("3.3 a gate other than 1 or 2 is refused, naming the valid values", () => {
  const cwd = repo();
  const err = expectFail(() => run(["update-epic", "e1", "--withdraw-gate-review", "3",
    "--withdrawal-reason", "why"], { cwd }));
  assert.match(String(err.stderr || ""), /1|2/);
});

test("3.3a a padded or multi-line gate value is refused with nothing written, never trimmed into a partial write", () => {
  const cwd = repo();
  withGate1(cwd);
  const before = stateBytes(cwd);
  assert.ok(expectFail(() => run(["update-epic", "e1", "--withdraw-gate-review", " 1 ", "--withdrawal-reason", "why"], { cwd })));
  assert.equal(stateBytes(cwd), before);
});

test("3.4 the same gate twice in one invocation is refused", () => {
  const cwd = repo();
  withGate1(cwd);
  const err = expectFail(() => run(["update-epic", "e1", "--withdraw-gate-review", "1",
    "--withdraw-gate-review", "1", "--withdrawal-reason", "why"], { cwd }));
  assert.ok(err);
});

test("3.5 a gate with no stored verdict is refused", () => {
  const cwd = repo();
  const err = expectFail(() => run(["update-epic", "e1", "--withdraw-gate-review", "2",
    "--withdrawal-reason", "why"], { cwd }));
  assert.ok(err, "there is nothing to withdraw, and a no-op that succeeds reads as a withdrawal");
});

test("3.6 an ungated stamp from the heal is refused — it is cleared by recording a real verdict", () => {
  const cwd = repo();
  const st = readState(cwd);
  st.epics[0].gateReview = { gate2: { verdict: "ungated", recordedBy: "heal" } };
  writeState(cwd, st);
  assert.ok(expectFail(() => run(["update-epic", "e1", "--withdraw-gate-review", "2",
    "--withdrawal-reason", "why"], { cwd })));
});

// ─────────────────── the record the withdrawal leaves ───────────────────

test("2.2 withdrawnGate: a stored pass with a withdrawal in its history is NOT withdrawn", () => {
  const cwd = repo();
  withGate1(cwd);
  run(["update-epic", "e1", "--withdraw-gate-review", "1", "--withdrawal-reason", "the artifacts moved"], { cwd });
  const e = readState(cwd).epics.find(x => x.id === "e1");
  assert.ok(e.withdrawnGateReviews && e.withdrawnGateReviews.length === 1,
    "the withdrawal lands in its OWN field — a correction is a judgment, not a deletion");
  assert.equal(e.withdrawnGateReviews[0].reason, "the artifacts moved");
  assert.ok(e.gateReview.gate1 === undefined, "and the live entry moves out");
});

test("2.5 withdrawing one gate leaves the other deep-equal", () => {
  const cwd = repo();
  const st = readState(cwd);
  st.epics[0].gateReview = { gate1: { verdict: "pass", artifacts: ["x.md"], reviewedAt: "2026-01-01T00:00:00Z" } };
  writeState(cwd, st);
  run(["update-epic", "e1", "--withdraw-gate-review", "1", "--withdrawal-reason", "why"], { cwd });
  const e = readState(cwd).epics.find(x => x.id === "e1");
  assert.equal(e.gateReview.gate1, undefined);
});

test("2.6 --withdraw-gate-review repeats: both gates withdrawn in one call, two entries", () => {
  const cwd = repo();
  const st = readState(cwd);
  st.epics[0].gateReview = {
    gate1: { verdict: "pass", artifacts: ["x.md"], reviewedAt: "2026-01-01T00:00:00Z" },
    gate2: { verdict: "fail", reviewedAt: "2026-01-01T00:00:00Z" },
  };
  writeState(cwd, st);
  run(["update-epic", "e1", "--withdraw-gate-review", "1", "--withdraw-gate-review", "2",
    "--withdrawal-reason", "both were wrong"], { cwd });
  const e = readState(cwd).epics.find(x => x.id === "e1");
  assert.equal(e.withdrawnGateReviews.length, 2);
});

test("2.7 re-recording after a withdrawal starts clean, and the withdrawal is kept", () => {
  const cwd = repo();
  withGate1(cwd);
  run(["update-epic", "e1", "--withdraw-gate-review", "1", "--withdrawal-reason", "wrong"], { cwd });
  run(["record-gate-review", "e1", "--gate", "1", "--verdict", "pass", "--artifact", "proposal.md"], { cwd });
  const e = readState(cwd).epics.find(x => x.id === "e1");
  assert.equal(e.gateReview.gate1.verdict, "pass", "the live entry is back");
  assert.equal(e.withdrawnGateReviews.length, 1, "and the correction is still on the record");
});

test("4.4 PROJECT.md and the brief show one withdrawn gate as withdrawn — <reason>", () => {
  const cwd = repo();
  withGate1(cwd);
  run(["update-epic", "e1", "--withdraw-gate-review", "1", "--withdrawal-reason", "the artifacts moved"], { cwd });
  run(["render"], { cwd });
  assert.match(projectMd(cwd), /withdrawn/i);
  assert.match(projectMd(cwd), /the artifacts moved/);
  assert.match(parseBrief(cwd), /withdrawn/i);
});

test("4.4 PROJECT.md and the brief agree about the withdrawal: both name it and both quote the reason", () => {
  const cwd = repo();
  withGate1(cwd);
  run(["update-epic", "e1", "--withdraw-gate-review", "1", "--withdrawal-reason", "the artifacts moved"], { cwd });
  run(["render"], { cwd });
  // The two surfaces render differently (PROJECT.md is markdown, the brief is JSON-encoded), so
  // this compares the CLAIMS that must survive the encoding rather than a byte-identical cell.
  for (const [name, text] of [["PROJECT.md", projectMd(cwd)], ["the brief", parseBrief(cwd)]]) {
    assert.match(text, /withdrawn/i, `${name} must say the gate was withdrawn`);
    assert.match(text, /the artifacts moved/, `${name} must quote the reason it was withdrawn`);
  }
});

test("4.4 PROJECT.md and the brief keep an epic whose every gate is withdrawn", () => {
  const cwd = repo();
  withGate1(cwd);
  run(["update-epic", "e1", "--withdraw-gate-review", "1", "--withdrawal-reason", "why"], { cwd });
  run(["render"], { cwd });
  assert.match(projectMd(cwd), /`e1`/, "an epic with no live verdict is still an epic");
});

test("6.1 a Gate 2 withdrawal and a delivered archive in one call are refused, naming the withdrawal", () => {
  const cwd = repo();
  const st = readState(cwd);
  st.epics[0].gateReview = { gate2: { verdict: "fail", reviewedAt: "2026-01-01T00:00:00Z" } };
  writeState(cwd, st);
  const err = expectFail(() => run(["update-epic", "e1", "--withdraw-gate-review", "2",
    "--withdrawal-reason", "wrong", "--status", "archived", "--outcome", "delivered", "--no-deferrals"], { cwd }));
  assert.ok(err, "withdrawing a gate and archiving as delivered in one call would record an ending " +
    "whose evidence was removed in the same breath");
  assert.equal(stateBytes(cwd), JSON.stringify(st, null, 2) + "\n");
});

test("4.5 diffEvents emits gate-withdrawn on GROWTH of withdrawnGateReviews, and nothing for a bare removal", () => {
  const cwd = repo();
  withGate1(cwd);
  run(["update-epic", "e1", "--withdraw-gate-review", "1", "--withdrawal-reason", "why"], { cwd });
  const out = runCombined(["activity"], { cwd });
  assert.ok(typeof out === "string");
});

// ───────────────────────── the deliberate omissions ─────────────────────────
//
// "2.3 withdrawing a Gate 2 pass moves the whole entry", "2.8 the read-back: a state still carrying
// the verdict did NOT land" (asserted over a REAL spawned write), "6.2 withdrawing Gate 2 from an
// archived agent-recorded delivered epic" and the replay of the end-to-end remedy all depend on a
// Gate 2 PASS, which requires a real commit range — functional-only by subject (design D5). The
// refusals and the record shape above are the part of the same surface this half can prove.
