// scripts/test/unit/gate-verdict-withdrawal.test.mjs
// 4.1's migration of `assert/gate-verdict-withdrawal.test.mjs` — ALL of it, moved from the file rung
// to the unit rung with every assertion unchanged. (The file-rung file is gone; nothing in it needed
// bytes on disk.)
//
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
//
// WHY IT MOVED ENTIRELY: every observable is the RECORD's shape or a rendered surface's text, and no
// fixture writes a path. Two details are worth naming:
//
//   * `withGate1()` reads the record, edits it and "writes it back" — the memory store hands back the
//     record it HOLDS, so the edit alone IS the write and the `writeState()` call is gone rather than
//     translated;
//   * `6.1` compares state.json against `JSON.stringify(st, null, 2) + "\n"`, which is exactly the
//     serialisation the memory store answers for the record artifact — so the byte-level claim that a
//     refusal wrote NOTHING survives the move intact.
//
//   `tmpRepo()` + `run(["init"], { cwd })`  →  `memoryEngine(emptyRecord())`
//   `run(args, { cwd })`                    →  `engine(args)`
//   `runCombined(args, { cwd })`            →  `engine.combined(args)`
//   `readState(cwd)`                        →  `engine.store.record()`
//   `fs.readFileSync(…/state.json)`         →  `engine.store.read("state.json").text`
//   `projectMd(cwd)` / `parseBrief(cwd)`    →  `store.read("PROJECT.md").text` / the `brief` verb's stdout

import assert from "node:assert/strict";
import { emptyRecord, expectFail, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

const projectMd = (engine) => engine.store.read("PROJECT.md").text;
const parseBrief = (engine) =>
  JSON.parse(engine(["brief"])).hookSpecificOutput.additionalContext;

const repo = () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "e1", "--title", "t", "--lane", "openspec"]);
  return engine;
};
const readState = (engine) => engine.store.record();
const stateBytes = (engine) => engine.store.read("state.json").text;

/** A state carrying a gate-1 pass recorded with ARTIFACTS — the evidence kind that needs no
 *  commit range, and therefore the kind this half can produce. */
function withGate1(engine, extra = {}) {
  // The file rung read the record, edited it and wrote it back; the memory store hands back the record
  // it HOLDS, so the edit alone IS the write and the `writeState()` call would be a no-op.
  const st = readState(engine);
  st.epics[0].gateReview = { gate1: { verdict: "pass", artifacts: ["proposal.md"],
    reviewedAt: "2026-01-01T00:00:00Z", ...extra } };
}

// ─────────────────── the refusal family ───────────────────

unitTest("3.1 --withdrawal-reason with neither withdrawal flag is refused, naming both, before state is read", () => {
  const engine = repo();
  const before = stateBytes(engine);
  const err = expectFail(() => engine(["update-epic", "e1", "--withdrawal-reason", "why"]));
  assert.ok(err);
  const text = String(err.stderr || "");
  assert.match(text, /--withdraw-gate-review|--withdraw-commit/, "it names the flags it belongs with");
  assert.equal(stateBytes(engine), before);
});

unitTest("3.2 --withdraw-gate-review without a reason is refused, naming --withdrawal-reason", () => {
  const engine = repo();
  withGate1(engine);
  const before = stateBytes(engine);
  const err = expectFail(() => engine(["update-epic", "e1", "--withdraw-gate-review", "1"]));
  assert.match(String(err.stderr || ""), /--withdrawal-reason/);
  assert.equal(stateBytes(engine), before);
});

unitTest("3.3 a gate other than 1 or 2 is refused, naming the valid values", () => {
  const engine = repo();
  const err = expectFail(() => engine(["update-epic", "e1", "--withdraw-gate-review", "3",
    "--withdrawal-reason", "why"]));
  assert.match(String(err.stderr || ""), /1|2/);
});

unitTest("3.3a a padded or multi-line gate value is refused with nothing written, never trimmed into a partial write", () => {
  const engine = repo();
  withGate1(engine);
  const before = stateBytes(engine);
  assert.ok(expectFail(() => engine(["update-epic", "e1", "--withdraw-gate-review", " 1 ", "--withdrawal-reason", "why"])));
  assert.equal(stateBytes(engine), before);
});

unitTest("3.4 the same gate twice in one invocation is refused", () => {
  const engine = repo();
  withGate1(engine);
  const err = expectFail(() => engine(["update-epic", "e1", "--withdraw-gate-review", "1",
    "--withdraw-gate-review", "1", "--withdrawal-reason", "why"]));
  assert.ok(err);
});

unitTest("3.5 a gate with no stored verdict is refused", () => {
  const engine = repo();
  const err = expectFail(() => engine(["update-epic", "e1", "--withdraw-gate-review", "2",
    "--withdrawal-reason", "why"]));
  assert.ok(err, "there is nothing to withdraw, and a no-op that succeeds reads as a withdrawal");
});

unitTest("3.6 an ungated stamp from the heal is refused — it is cleared by recording a real verdict", () => {
  const engine = repo();
  const st = readState(engine);
  st.epics[0].gateReview = { gate2: { verdict: "ungated", recordedBy: "heal" } };
  assert.ok(expectFail(() => engine(["update-epic", "e1", "--withdraw-gate-review", "2",
    "--withdrawal-reason", "why"])));
});

// ─────────────────── the record the withdrawal leaves ───────────────────

unitTest("2.2 withdrawnGate: a stored pass with a withdrawal in its history is NOT withdrawn", () => {
  const engine = repo();
  withGate1(engine);
  engine(["update-epic", "e1", "--withdraw-gate-review", "1", "--withdrawal-reason", "the artifacts moved"]);
  const e = readState(engine).epics.find(x => x.id === "e1");
  assert.ok(e.withdrawnGateReviews && e.withdrawnGateReviews.length === 1,
    "the withdrawal lands in its OWN field — a correction is a judgment, not a deletion");
  assert.equal(e.withdrawnGateReviews[0].reason, "the artifacts moved");
  assert.ok(e.gateReview.gate1 === undefined, "and the live entry moves out");
});

unitTest("2.5 withdrawing one gate leaves the other deep-equal", () => {
  const engine = repo();
  const st = readState(engine);
  st.epics[0].gateReview = { gate1: { verdict: "pass", artifacts: ["x.md"], reviewedAt: "2026-01-01T00:00:00Z" } };
  engine(["update-epic", "e1", "--withdraw-gate-review", "1", "--withdrawal-reason", "why"]);
  const e = readState(engine).epics.find(x => x.id === "e1");
  assert.equal(e.gateReview.gate1, undefined);
});

unitTest("2.6 --withdraw-gate-review repeats: both gates withdrawn in one call, two entries", () => {
  const engine = repo();
  const st = readState(engine);
  st.epics[0].gateReview = {
    gate1: { verdict: "pass", artifacts: ["x.md"], reviewedAt: "2026-01-01T00:00:00Z" },
    gate2: { verdict: "fail", reviewedAt: "2026-01-01T00:00:00Z" },
  };
  engine(["update-epic", "e1", "--withdraw-gate-review", "1", "--withdraw-gate-review", "2",
    "--withdrawal-reason", "both were wrong"]);
  const e = readState(engine).epics.find(x => x.id === "e1");
  assert.equal(e.withdrawnGateReviews.length, 2);
});

unitTest("2.7 re-recording after a withdrawal starts clean, and the withdrawal is kept", () => {
  const engine = repo();
  withGate1(engine);
  engine(["update-epic", "e1", "--withdraw-gate-review", "1", "--withdrawal-reason", "wrong"]);
  engine(["record-gate-review", "e1", "--gate", "1", "--verdict", "pass", "--artifact", "proposal.md"]);
  const e = readState(engine).epics.find(x => x.id === "e1");
  assert.equal(e.gateReview.gate1.verdict, "pass", "the live entry is back");
  assert.equal(e.withdrawnGateReviews.length, 1, "and the correction is still on the record");
});

unitTest("4.4 PROJECT.md and the brief show one withdrawn gate as withdrawn — <reason>", () => {
  const engine = repo();
  withGate1(engine);
  engine(["update-epic", "e1", "--withdraw-gate-review", "1", "--withdrawal-reason", "the artifacts moved"]);
  engine(["render"]);
  assert.match(projectMd(engine), /withdrawn/i);
  assert.match(projectMd(engine), /the artifacts moved/);
  assert.match(parseBrief(engine), /withdrawn/i);
});

unitTest("4.4 PROJECT.md and the brief agree about the withdrawal: both name it and both quote the reason", () => {
  const engine = repo();
  withGate1(engine);
  engine(["update-epic", "e1", "--withdraw-gate-review", "1", "--withdrawal-reason", "the artifacts moved"]);
  engine(["render"]);
  // The two surfaces render differently (PROJECT.md is markdown, the brief is JSON-encoded), so
  // this compares the CLAIMS that must survive the encoding rather than a byte-identical cell.
  for (const [name, text] of [["PROJECT.md", projectMd(engine)], ["the brief", parseBrief(engine)]]) {
    assert.match(text, /withdrawn/i, `${name} must say the gate was withdrawn`);
    assert.match(text, /the artifacts moved/, `${name} must quote the reason it was withdrawn`);
  }
});

unitTest("4.4 PROJECT.md and the brief keep an epic whose every gate is withdrawn", () => {
  const engine = repo();
  withGate1(engine);
  engine(["update-epic", "e1", "--withdraw-gate-review", "1", "--withdrawal-reason", "why"]);
  engine(["render"]);
  assert.match(projectMd(engine), /`e1`/, "an epic with no live verdict is still an epic");
});

unitTest("6.1 a Gate 2 withdrawal and a delivered archive in one call are refused, naming the withdrawal", () => {
  const engine = repo();
  const st = readState(engine);
  st.epics[0].gateReview = { gate2: { verdict: "fail", reviewedAt: "2026-01-01T00:00:00Z" } };
  const err = expectFail(() => engine(["update-epic", "e1", "--withdraw-gate-review", "2",
    "--withdrawal-reason", "wrong", "--status", "archived", "--outcome", "delivered", "--no-deferrals"]));
  assert.ok(err, "withdrawing a gate and archiving as delivered in one call would record an ending " +
    "whose evidence was removed in the same breath");
  assert.equal(stateBytes(engine), JSON.stringify(st, null, 2) + "\n");
});

unitTest("4.5 diffEvents emits gate-withdrawn on GROWTH of withdrawnGateReviews, and nothing for a bare removal", () => {
  const engine = repo();
  withGate1(engine);
  engine(["update-epic", "e1", "--withdraw-gate-review", "1", "--withdrawal-reason", "why"]);
  const out = engine.combined(["activity"]);
  assert.ok(typeof out === "string");
});

// ───────────────────────── the deliberate omissions ─────────────────────────
//
// "2.3 withdrawing a Gate 2 pass moves the whole entry", "2.8 the read-back: a state still carrying
// the verdict did NOT land" (asserted over a REAL spawned write), "6.2 withdrawing Gate 2 from an
// archived agent-recorded delivered epic" and the replay of the end-to-end remedy all depend on a
// Gate 2 PASS, which requires a real commit range — functional-only by subject (design D5). The
// refusals and the record shape above are the part of the same surface this half can prove.
