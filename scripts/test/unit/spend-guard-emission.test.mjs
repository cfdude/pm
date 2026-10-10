// scripts/test/unit/spend-guard-emission.test.mjs
// spend-budget-and-stuck-loop-guard, tasks 5.1 (the stderr STOP), 5.2 (the brief line and the cap) and
// 5.4 (the opt-in row). UNIT rung: values over an in-memory store. The file-rung half (paths opened,
// CLAUDE.md rewritten) is assert/spend-guard.test.mjs.

import assert from "node:assert/strict";
import { emptyRecord, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";
import { buildBriefParts } from "../../lib/briefing.mjs";
import { fitBrief } from "../../lib/session-cost.mjs";
import { OPT_INS, optInLines } from "../../lib/opt-ins.mjs";
import { KNOWN_PLATFORMS } from "../../lib/constants.mjs";
import { rulesBlock } from "../../lib/rules.mjs";

const epic = (id, extra = {}) => ({ id, title: id, priority: "P2", status: "queued", role: "epic", lane: "claude-code", links: [], reconcileNeeded: false, ...extra });
const seeded = (state = {}, epics = [epic("e1")]) => memoryEngine({ ...emptyRecord(), epics, ...state });
const briefOf = (engine) => JSON.parse(engine(["brief"])).hookSpecificOutput.additionalContext;

// ───────────── 5.1 record-gate-review ─────────────

unitTest("5.1 the fail that reaches the limit is recorded, then the STOP is printed after the success line, with exit 0", () => {
  const engine = seeded({ spendGuard: { maxFailedRounds: 2 } });
  const first = engine.result(["record-gate-review", "e1", "--gate", "1", "--verdict", "fail"]);
  assert.equal(first.status, 0);
  assert.doesNotMatch(first.stderr, /STOP: spend guard/);
  const second = engine.result(["record-gate-review", "e1", "--gate", "1", "--verdict", "fail"]);
  assert.equal(second.status, 0, "the write succeeded, so the exit code is 0");
  const at = (s) => second.stderr.indexOf(s);
  assert.ok(at("recorded gate 1 review 'fail'") !== -1 && at("recorded gate 1 review 'fail'") < at("STOP: spend guard"), second.stderr);
  assert.match(second.stderr, /epic e1 is stuck: rounds 2\/2/);
  assert.equal(engine.store.record().epics[0].gateReview.gate1.verdict, "fail");
  assert.equal(engine.store.record().epics[0].gateRounds.gate1.failStreak, 2);
});

unitTest("5.1 a verdict is never refused because a guard is tripped: a third fail is recorded and the STOP repeats", () => {
  const engine = seeded({ spendGuard: { maxFailedRounds: 1 } });
  for (let i = 0; i < 3; i++) {
    const r = engine.result(["record-gate-review", "e1", "--gate", "1", "--verdict", "fail"]);
    assert.equal(r.status, 0);
    assert.match(r.stderr, /STOP: spend guard/);
  }
  assert.equal(engine.store.record().epics[0].gateRounds.gate1.fails, 3);
});

unitTest("5.1 a pass clears the recorded part: no STOP is printed", () => {
  const engine = seeded({ spendGuard: { maxFailedRounds: 1 } });
  engine.result(["record-gate-review", "e1", "--gate", "1", "--verdict", "fail"]);
  const r = engine.result(["record-gate-review", "e1", "--gate", "1", "--verdict", "pass", "--artifact", "a.md"]);
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.stderr, /STOP: spend guard/);
});

unitTest("5.1 with no limit configured record-gate-review prints no guard text, however many fails are recorded", () => {
  const engine = seeded();
  for (let i = 0; i < 4; i++) {
    const r = engine.result(["record-gate-review", "e1", "--gate", "1", "--verdict", "fail"]);
    assert.doesNotMatch(r.stderr + r.stdout, /spend guard|STOP/i);
  }
  assert.equal(engine.store.record().epics[0].gateRounds.gate1.failStreak, 4, "the counter is recorded regardless");
});

unitTest("5.1 a limit that a live override covers prints no STOP", () => {
  const engine = seeded({ spendGuard: { maxFailedRounds: 2 } }, [epic("e1", {
    gateRounds: { gate1: { fails: 1, passes: 0, failStreak: 1, lastVerdictAt: "2026-10-09T00:00:00.000Z" } },
    spendGuardOverrides: [{ signal: "rounds", baseline: 1, escalatedTo: "opus", reason: "x", at: "2026-10-09T00:00:00.000Z" }],
  })]);
  const r = engine.result(["record-gate-review", "e1", "--gate", "1", "--verdict", "fail"]);
  assert.doesNotMatch(r.stderr, /STOP: spend guard/, "count 2 minus baseline 1 is below the limit");
});

// ───────────── 5.2 the brief ─────────────

const stuckActive = () => seeded({ spendGuard: { maxFailedRounds: 2 }, active: "e1" }, [
  epic("e1", { gateRounds: { gate2: { fails: 2, passes: 0, failStreak: 2, lastVerdictAt: "2026-10-09T00:00:00.000Z" } } }),
]);

unitTest("5.2 a stuck active epic gives one line beginning 'STOP: spend guard —' that names it and the check", () => {
  const lines = briefOf(stuckActive()).split("\n").filter((l) => l.startsWith("STOP: spend guard —"));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /e1 rounds 2\/2/);
  assert.ok(lines[0].includes("spend-guard e1"));
});

unitTest("5.2 an epic that is stuck but not active, or an active one that is healthy, adds no line", () => {
  const notActive = seeded({ spendGuard: { maxFailedRounds: 2 } }, [epic("e1", { gateRounds: { gate2: { failStreak: 2 } } })]);
  assert.doesNotMatch(briefOf(notActive), /spend guard/);
  const healthy = seeded({ spendGuard: { maxFailedRounds: 2 }, active: "e1" }, [epic("e1", { gateRounds: { gate2: { failStreak: 1 } } })]);
  assert.doesNotMatch(briefOf(healthy), /spend guard/);
});

unitTest("5.2 with no limit configured no brief line contains 'spend guard'", () => {
  const engine = seeded({ active: "e1" }, [epic("e1", { gateRounds: { gate1: { failStreak: 5 } } })]);
  assert.doesNotMatch(briefOf(engine), /spend guard/i);
});

unitTest("5.2 the STOP line survives an over-cap brief: it is an obligation, never a shortenable list", () => {
  const state = {
    ...emptyRecord(), active: "e1", spendGuard: { maxFailedRounds: 2 },
    epics: [epic("e1", { gateRounds: { gate2: { failStreak: 2 } } }),
      ...Array.from({ length: 30 }, (_, i) => epic(`other-${i}`, { title: `A long title that fills the next-up list number ${i}` }))],
  };
  const { plain, parts } = buildBriefParts(state);
  const cap = 400;
  assert.ok(Buffer.byteLength(plain) > cap, "the fixture really is over the cap");
  const fitted = fitBrief(parts, { plain, cap });
  assert.equal(fitted.truncated, true);
  assert.ok(fitted.text.split("\n").some((l) => l.startsWith("STOP: spend guard —")), "the line is still there");
});

// ───────────── 5.3 the rules-block section ─────────────

const block = (spend, guard) => rulesBlock(null, "standard", [], "claude-code", null, spend, guard);

unitTest("5.3 with no limit the block is byte-identical to the one a caller omitting the argument gets", () => {
  assert.equal(block(false, false), rulesBlock(null, "standard", [], "claude-code"));
  assert.equal(block(true, false), rulesBlock(null, "standard", [], "claude-code", null, true));
  assert.doesNotMatch(block(true, false), /## Spend guard/);
});

unitTest("5.3 turning the section on adds only the section, immediately after the Spend tracking slot", () => {
  for (const spend of [false, true]) {
    const on = block(spend, true), off = block(spend, false);
    const start = on.indexOf("## Spend guard"), end = on.indexOf("## Release candidate");
    assert.ok(start !== -1 && start < end);
    assert.equal(on.slice(0, start) + on.slice(end), off, `spend=${spend}: nothing else moves`);
    assert.equal(on.split("## Spend guard").length - 1, 1);
  }
  const both = block(true, true);
  assert.ok(both.indexOf("## Spend tracking") < both.indexOf("## Spend guard"), "the guard follows the tracking section");
  const guardOnly = block(false, true);
  assert.ok(guardOnly.indexOf("Current mode:") < guardOnly.indexOf("## Spend guard"), "with tracking off it takes that slot's position");
});

unitTest("5.3 the section carries the check, exit 2 as a STOP, the autonomy sentence, the override and the marker form", () => {
  const b = block(false, true);
  const section = b.slice(b.indexOf("## Spend guard"), b.indexOf("## Release candidate"));
  assert.ok(section.includes("`spend-guard <epic>`"));
  assert.match(section, /exit 2 is a STOP/);
  assert.match(section, /epic-level autonomy does\s+not bypass/);
  assert.match(section, /`override-spend-guard <epic> --signal rounds\|tokens --escalated-to <target> --reason "<why>"`/);
  assert.match(section, /No\s+autonomy grant covers `override-spend-guard`/);
  assert.ok(section.includes("`pm-spend: epic=<id> role=review phase=review round=<n>`"));
});

unitTest("5.3 every platform's block carries the section when a limit is configured, and none when not", () => {
  for (const platform of KNOWN_PLATFORMS) {
    assert.match(rulesBlock(null, "standard", [], platform, null, false, true), /## Spend guard/, platform);
    assert.doesNotMatch(rulesBlock(null, "standard", [], platform, null, false, false), /## Spend guard/, platform);
  }
});

// ───────────── 5.4 the opt-in row ─────────────

unitTest("5.4 a repo without a limit is told about it, with the adopting command", () => {
  const lines = optInLines({ epics: [] });
  const line = lines.find((l) => l.includes("NOT SET: spendGuard"));
  assert.ok(line, JSON.stringify(lines));
  assert.ok(line.includes("set-spend-guard --max-failed-rounds <n>"));
  const row = OPT_INS.find((o) => o.id === "spendGuard");
  assert.deepEqual([row.verb, row.doc], ["set-spend-guard", "set-spend-guard"]);
});

unitTest("5.4 a limit at the project, a lane or a live epic is adopted; a warnAt alone or an archived epic's is not", () => {
  const set = (s) => !optInLines({ epics: [], ...s }).some((l) => l.includes("NOT SET: spendGuard"));
  assert.equal(set({ spendGuard: { maxFailedRounds: 2 } }), true);
  assert.equal(set({ spendGuard: { tokenCeiling: 10 } }), true);
  assert.equal(set({ laneSpendGuards: { openspec: { maxFailedRounds: 2 } } }), true);
  assert.equal(set({ epics: [epic("e1", { spendGuard: { maxFailedRounds: 2 } })] }), true);
  assert.equal(set({ spendGuard: { warnAt: 60 } }), false);
  assert.equal(set({ epics: [epic("e1", { status: "archived", spendGuard: { maxFailedRounds: 2 } })] }), false);
});

unitTest("5.4 a state written by 0.51.0 loads unchanged: every epic reads zero rounds and no limit, and nothing is rewritten", () => {
  const old = { ...emptyRecord(), pmVersion: "0.51.0", epics: [epic("e1", { gateReview: { gate1: { verdict: "fail", reviewedAt: "2026-09-01T00:00:00.000Z" } } })] };
  const engine = memoryEngine(old);
  const before = engine.store.read("state.json").text;
  const r = engine.result(["spend-guard", "e1", "--json"]);
  assert.equal(r.status, 0);
  const j = JSON.parse(r.stdout);
  assert.deepEqual([j.signals.rounds.count, j.signals.rounds.limit, j.signals.tokens.limit, j.stuck], [0, null, null, false]);
  engine.result(["brief"]);
  assert.equal(engine.store.read("state.json").text, before, "no migration, no rewrite");
});
