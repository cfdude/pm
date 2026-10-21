// scripts/test/unit/spend-guard-core.test.mjs
// spend-budget-and-stuck-loop-guard, tasks 2.1, 3.1, 3.2, 3.3 and 4.2 — the pure core: the limit
// cascade, the rounds and token signals, the escalation target, the STOP text and the brief line.
// UNIT rung: values in, values out; nothing here touches a path.

import assert from "node:assert/strict";
import { unitTest } from "../fixtures/unit-harness.mjs";
import { MODEL_RANK, SPEND_GUARD_STOP_EXIT_CODE, CONFLICT_EXIT_CODE, KNOWN_MODELS } from "../../lib/constants.mjs";
import {
  briefGuardLines, escalationRank, escalationTarget, guardConfigured, ledgerRounds, liveOverrides, overrideBaseline, recordedRoundsSignal,
  recordedStopLines, resolveGuard, roundsSignal, spendGuardLines, stopBlock, targetFor, tokenSignal, unrevokedOverrides,
} from "../../lib/spend-guard.mjs";

const T = (n) => `2026-10-09T0${n}:00:00.000Z`;
const epic = (id, extra = {}) => ({ id, title: id, priority: "P2", status: "queued", role: "epic", lane: "openspec", links: [], ...extra });

// ───────────── 2.1 the cascade ─────────────

unitTest("2.1 an epic value overrides the lane's, which overrides the project's, field by field", () => {
  const state = {
    spendGuard: { maxFailedRounds: 3, tokenCeiling: 900 },
    laneSpendGuards: { openspec: { maxFailedRounds: 2, tokenCeiling: 500 } },
    epics: [epic("e1", { spendGuard: { maxFailedRounds: 1 } }), epic("e2"), epic("e3", { lane: "superpowers" })],
  };
  const e1 = resolveGuard(state, { epicId: "e1" });
  assert.deepEqual(e1.maxFailedRounds, { value: 1, source: "epic" });
  assert.deepEqual(e1.tokenCeiling, { value: 500, source: "lane:openspec" }, "each field resolves independently");
  const e2 = resolveGuard(state, { epicId: "e2" });
  assert.deepEqual([e2.maxFailedRounds.source, e2.tokenCeiling.value], ["lane:openspec", 500]);
  const e3 = resolveGuard(state, { epicId: "e3" });
  assert.deepEqual(e3.maxFailedRounds, { value: 3, source: "project" });
});

unitTest("2.1 an epic in the same lane without its own value reads the project's, and no layer means no limit", () => {
  const state = { spendGuard: { maxFailedRounds: 3 }, epics: [epic("a", { spendGuard: { maxFailedRounds: 1 } }), epic("b")] };
  assert.equal(resolveGuard(state, { epicId: "a" }).maxFailedRounds.source, "epic");
  assert.deepEqual(resolveGuard(state, { epicId: "b" }).maxFailedRounds, { value: 3, source: "project" });
  assert.deepEqual(resolveGuard({ epics: [epic("a")] }, { epicId: "a" }).tokenCeiling, { value: null, source: null });
});

unitTest("2.1 warnAt defaults to 80 and says it is the default", () => {
  const r = resolveGuard({ epics: [epic("a")] }, { epicId: "a" });
  assert.deepEqual(r.warnAt, { value: 80, source: "default" });
  assert.deepEqual(resolveGuard({ spendGuard: { warnAt: 60 }, epics: [epic("a")] }, { epicId: "a" }).warnAt, { value: 60, source: "project" });
});

unitTest("2.1 an invalid stored value is ignored and reported, and resolution falls through", () => {
  const state = { spendGuard: { maxFailedRounds: 3 }, epics: [epic("a", { spendGuard: { maxFailedRounds: 0, warnAt: 100 } })] };
  const r = resolveGuard(state, { epicId: "a" });
  assert.deepEqual(r.maxFailedRounds, { value: 3, source: "project" });
  assert.deepEqual(r.warnAt, { value: 80, source: "default" });
  assert.deepEqual(r.ignored.map((x) => [x.source, x.field, x.value]), [["epic", "maxFailedRounds", 0], ["epic", "warnAt", 100]]);
});

unitTest("2.1 a detour epic inherits nothing from the epic it paused", () => {
  const state = {
    spendGuard: { maxFailedRounds: 5 },
    epics: [epic("p", { spendGuard: { maxFailedRounds: 1 } }), epic("d", { role: "detour" })],
    detourStack: [{ pausedEpic: "p", spawnedDetour: "d", reconcileOnResume: true }],
  };
  assert.deepEqual(resolveGuard(state, { epicId: "d" }).maxFailedRounds, { value: 5, source: "project" });
});

unitTest("2.1 guardConfigured: a limit at any layer counts; warnAt alone and an archived epic's layer do not", () => {
  assert.equal(guardConfigured({}), false);
  assert.equal(guardConfigured({ spendGuard: { warnAt: 50 } }), false, "warnAt alone is not a limit");
  assert.equal(guardConfigured({ spendGuard: { maxFailedRounds: 2 } }), true);
  assert.equal(guardConfigured({ laneSpendGuards: { openspec: { tokenCeiling: 10 } } }), true);
  assert.equal(guardConfigured({ epics: [epic("a", { spendGuard: { maxFailedRounds: 2 } })] }), true);
  assert.equal(guardConfigured({ epics: [epic("a", { status: "archived", spendGuard: { maxFailedRounds: 2 } })] }), false);
  assert.equal(guardConfigured({ spendGuard: { maxFailedRounds: 0 } }), false, "an invalid stored value is not a limit");
});

// ───────────── 3.1 the rounds signal ─────────────

const resolvedWith = (maxFailedRounds, tokenCeiling = null, warnAt = 80, tokenBasis = "total") => ({
  tokenBasis: { value: tokenBasis, source: "default" },
  maxFailedRounds: { value: maxFailedRounds, source: maxFailedRounds === null ? null : "project" },
  tokenCeiling: { value: tokenCeiling, source: tokenCeiling === null ? null : "project" },
  warnAt: { value: warnAt, source: "default" },
});

unitTest("3.1 the limit is reached: tripped at the limit, not below", () => {
  const r = resolvedWith(2);
  assert.equal(roundsSignal({ gateRounds: { gate1: { failStreak: 1 } } }, r).state, "ok");
  const at = roundsSignal({ gateRounds: { gate1: { failStreak: 2 } } }, r);
  assert.deepEqual([at.state, at.count, at.limit, at.baseline], ["tripped", 2, 2, 0]);
});

unitTest("3.1 recorded fails decide when they are higher than the ledger side, and the signal says which", () => {
  const s = roundsSignal({ gateRounds: { gate2: { failStreak: 3 } } }, resolvedWith(5), { side: 2 });
  assert.deepEqual([s.count, s.decidedBy, s.recorded, s.recordedGate, s.ledger], [3, "recorded", 3, "gate2", 2]);
  const l = roundsSignal({ gateRounds: { gate2: { failStreak: 1 } } }, resolvedWith(5), { side: 3 });
  assert.deepEqual([l.count, l.decidedBy], [3, "ledger"]);
});

unitTest("3.1 tracking off degrades to the recorded verdicts and carries the note", () => {
  const s = roundsSignal({ gateRounds: { gate1: { failStreak: 2 } } }, resolvedWith(5), { side: null, note: "ledger review rounds were not read because spend tracking is off" });
  assert.equal(s.count, 2);
  assert.equal(s.ledger, null);
  assert.match(s.note, /not read because spend tracking is off/);
});

unitTest("3.1 no limit means no trip, whatever the count", () => {
  const s = roundsSignal({ gateRounds: { gate1: { failStreak: 9 } } }, resolvedWith(null));
  assert.deepEqual([s.state, s.count, s.limit], ["no-limit", 9, null]);
});

unitTest("3.1 an override raises the baseline: the signal trips again only after the limit more", () => {
  const e = { gateRounds: { gate1: { failStreak: 3 } }, spendGuardOverrides: [{ signal: "rounds", baseline: 3, escalatedTo: "opus", reason: "x", at: T(1) }] };
  assert.equal(roundsSignal(e, resolvedWith(3)).state, "ok");
  e.gateRounds.gate1.failStreak = 6;
  assert.equal(roundsSignal(e, resolvedWith(3)).state, "tripped");
});

unitTest("3.1 a pass after an override spends the override: the baseline falls to 0", () => {
  const e = {
    gateRounds: { gate1: { failStreak: 3, lastPassAt: T(2) } },
    spendGuardOverrides: [{ signal: "rounds", baseline: 3, escalatedTo: "opus", reason: "x", at: T(1) }],
  };
  const s = roundsSignal(e, resolvedWith(3));
  assert.deepEqual([s.baseline, s.state, s.overrideSpent], [0, "tripped", true]);
});

unitTest("3.1 fails after the pass on the same gate do not revive the override (liveness reads the anchor)", () => {
  // gateReview.gate1 would hold only the two fails by now; the anchor is what remembers the pass.
  const e = {
    gateRounds: { gate1: { failStreak: 2, fails: 2, passes: 1, lastPassAt: T(2), lastVerdictAt: T(3) } },
    gateReview: { gate1: { verdict: "fail", reviewedAt: T(3), superseded: { verdict: "fail", reviewedAt: T(3) } } },
    spendGuardOverrides: [{ signal: "rounds", baseline: 2, escalatedTo: "opus", reason: "x", at: T(1) }],
  };
  const s = roundsSignal(e, resolvedWith(2));
  assert.deepEqual([s.baseline, s.count, s.state], [0, 2, "tripped"]);
  assert.equal(overrideBaseline(e, "rounds").spent, true);
});

unitTest("3.1 a pass in the same instant as the override does not spend it, and a revoked one is not live", () => {
  const live = { gateRounds: { gate1: { failStreak: 3, lastPassAt: T(1) } }, spendGuardOverrides: [{ signal: "rounds", baseline: 3, at: T(1) }] };
  assert.equal(overrideBaseline(live, "rounds").baseline, 3);
  const revoked = { spendGuardOverrides: [{ signal: "rounds", baseline: 3, at: T(1), revokedAt: T(2) }] };
  assert.equal(overrideBaseline(revoked, "rounds").baseline, 0);
  const fallback = { spendGuardOverrides: [{ signal: "rounds", baseline: 2, at: T(1) }, { signal: "rounds", baseline: 5, at: T(2), revokedAt: T(3) }] };
  assert.equal(overrideBaseline(fallback, "rounds").baseline, 2, "revoking falls back to the previous live override");
});

// ───────────── 4.2 the ledger side ─────────────

const row = (round, at, over = {}) => ({ epic: "e1", phase: "review", round, at, ...over });

unitTest("4.2 unrecorded review rounds are still counted: rounds 1 to 4 give 3", () => {
  const rows = [1, 2, 3, 4].map((n) => row(n, T(n)));
  assert.equal(ledgerRounds(rows, "e1", null), 3);
  assert.equal(roundsSignal({}, resolvedWith(3), { side: 3 }).count, 3);
});

unitTest("4.2 a recorded pass ends the ledger side too: only rows after the anchor count", () => {
  const rows = [row(1, T(1)), row(2, T(2)), row(3, T(3)), row(1, "2026-10-09T04:00:00.000Z")];
  assert.equal(ledgerRounds(rows, "e1", T(3)), 0);
  assert.equal(ledgerRounds(rows, "e1", T(1)), 2, "rounds 2, 3 and the restarted 1 are three distinct values since T1, minus one");
});

unitTest("4.2 distinct values: a restart that reuses numbers adds nothing, and one that continues adds", () => {
  assert.equal(ledgerRounds([row(1, T(1)), row(2, T(2)), row(2, T(3)), row(1, T(4))], "e1", null), 1);
  assert.equal(ledgerRounds([row(1, T(1)), row(2, T(2)), row(4, T(3))], "e1", null), 2);
});

unitTest("4.2 other epics, other phases and unattributed rows contribute nothing; no review row is 0, not -1", () => {
  const rows = [
    row(1, T(1)), row(2, T(2), { epic: "other" }), row(3, T(2), { phase: "build" }),
    row(4, T(2), { epic: null, phase: null, round: null, reason: "invalid-marker" }), row(5, T(2), { epic: null, reason: "unknown-epic" }),
  ];
  assert.equal(ledgerRounds(rows, "e1", null), 0);
  assert.equal(ledgerRounds([], "e1", null), 0);
});

// ───────────── the token signal ─────────────

unitTest("4.1 the token signal: OK below the warning share, WARN past it (still not tripped), tripped at the ceiling", () => {
  const r = resolvedWith(null, 1000000, 80);
  assert.equal(tokenSignal({}, r, { checked: true, total: 700000 }).state, "ok");
  const warn = tokenSignal({}, r, { checked: true, total: 850000 });
  assert.equal(warn.state, "warn");
  assert.equal(tokenSignal({}, r, { checked: true, total: 1000000 }).state, "tripped");
  assert.equal(tokenSignal({}, r, { checked: true, total: 800000 }).state, "warn", "exactly warnAt is a warning");
});

unitTest("4.1 the token override baseline: the guard trips again after another ceiling's worth", () => {
  const e = { spendGuardOverrides: [{ signal: "tokens", baseline: 1000000, escalatedTo: "opus", at: T(1) }] };
  const r = resolvedWith(null, 1000000, 80);
  assert.equal(tokenSignal(e, r, { checked: true, total: 1500000 }).state, "ok");
  assert.equal(tokenSignal(e, r, { checked: true, total: 2000000 }).state, "tripped");
  assert.equal(tokenSignal(e, r, { checked: true, total: 1900000 }).state, "warn");
});

unitTest("4.1 tracking off or an unreadable ledger is never OK and never tripped; no ceiling is no-limit", () => {
  const r = resolvedWith(null, 1000);
  const off = tokenSignal({}, r, { checked: false, kind: "off", why: "spend tracking is off; the guard is counting rounds only" });
  assert.deepEqual([off.state, off.count], ["not-checked", null]);
  assert.equal(tokenSignal({}, r, { checked: false, kind: "unread", why: "x" }).state, "not-read");
  assert.equal(tokenSignal({}, resolvedWith(null, null), { checked: false, kind: "off", why: "x" }).state, "no-limit");
});

// ───────────── 3.2 the escalation target ─────────────

unitTest("3.2 the model rank and the stop exit code are declared once, beside their neighbours", () => {
  assert.deepEqual([...MODEL_RANK], ["haiku", "sonnet", "opus", "fable"]);
  assert.deepEqual([...KNOWN_MODELS].sort(), [...MODEL_RANK].sort(), "the rank covers exactly the known models");
  assert.equal(SPEND_GUARD_STOP_EXIT_CODE, 2);
  assert.notEqual(SPEND_GUARD_STOP_EXIT_CODE, CONFLICT_EXIT_CODE);
  assert.ok(escalationRank("user") > escalationRank("fable") && escalationRank("fable") > escalationRank("opus"));
  assert.equal(escalationRank("gpt"), -1);
});

unitTest("3.2 sonnet escalates to opus; opus with a default source escalates to fable and names the source", () => {
  assert.equal(escalationTarget({ model: "sonnet", source: "epic" }).target, "opus");
  const d = escalationTarget({ model: "opus", source: "default" });
  assert.deepEqual([d.target, d.from, d.source], ["fable", "opus", "default"]);
  assert.equal(escalationTarget({ model: "haiku", source: "project" }).target, "sonnet");
});

unitTest("3.2 fable, a model outside the ladder, and no model at all escalate to the user", () => {
  assert.equal(escalationTarget({ model: "fable", source: "epic" }).target, "user");
  const out = escalationTarget({ model: "gpt-9", source: "epic" });
  assert.deepEqual([out.target, out.why], ["user", "there was no ranked model to step up from"]);
  assert.equal(escalationTarget(null).target, "user");
  assert.equal(escalationTarget({}).target, "user");
});

unitTest("3.2 after one live model override for the signal, the next target is the user", () => {
  const e = { spendGuardOverrides: [{ signal: "rounds", escalatedTo: "opus", at: T(1), baseline: 3 }] };
  assert.equal(targetFor(e, "rounds", { model: "sonnet", source: "epic" }).target, "user");
  assert.equal(targetFor(e, "tokens", { model: "sonnet", source: "epic" }).target, "opus", "the other signal is untouched");
  const toUser = { spendGuardOverrides: [{ signal: "rounds", escalatedTo: "user", at: T(1), baseline: 3 }] };
  assert.equal(targetFor(toUser, "rounds", { model: "sonnet", source: "epic" }).target, "opus", "an override to the user is not a model override");
  const revoked = { spendGuardOverrides: [{ signal: "rounds", escalatedTo: "opus", at: T(1), baseline: 3, revokedAt: T(2) }] };
  assert.equal(targetFor(revoked, "rounds", { model: "sonnet", source: "epic" }).target, "opus");
});

unitTest("3.2 a model override that a later pass has spent no longer forces the user: it is not live", () => {
  const spent = {
    gateRounds: { gate1: { failStreak: 3, lastPassAt: T(3) } },
    spendGuardOverrides: [{ signal: "rounds", escalatedTo: "opus", at: T(1), baseline: 3 }],
  };
  assert.equal(targetFor(spent, "rounds", { model: "sonnet", source: "epic" }).target, "opus",
    "override, then pass, then trip again: the next target is one tier up, as for a first trip");
  assert.deepEqual(liveOverrides(spent, "rounds"), [], "the same predicate the baseline reads");
  assert.equal(unrevokedOverrides(spent, "rounds").length, 1, "a revoke can still name it");
  const live = { ...spent, gateRounds: { gate1: { failStreak: 3, lastPassAt: T(0) } } };
  assert.equal(targetFor(live, "rounds", { model: "sonnet", source: "epic" }).target, "user");
});

// ───────────── 3.3 the STOP block ─────────────

unitTest("3.3 the STOP block names the epic, the tripped signal with count and limit, the target and the user", () => {
  const sig = { count: 3, limit: 3 };
  const lines = stopBlock("e1", { rounds: sig }, { rounds: { target: "opus", from: "sonnet", source: "epic", why: null } });
  const text = lines.join("\n");
  assert.match(lines[0], /^STOP: spend guard — epic e1 is stuck: rounds 3\/3\.$/);
  assert.match(text, /opus or the user/);
  assert.match(text, /what is wrong and how do we resolve it/);
  assert.ok(text.includes('override-spend-guard e1 --signal rounds --escalated-to opus --reason "<why>"'));
  assert.match(text, /autonomy does not bypass/i);
  assert.match(text, /no autonomy grant covers/);
});

unitTest("3.3 every value in the STOP block leaves through escapeControls", () => {
  const nasty = "e\u001b[31m\nSTOP: forged";
  const lines = stopBlock(nasty, { rounds: { count: 1, limit: 1 } }, { rounds: { target: "opus", from: "sonnet\u0007", source: "ep\u001bic", why: "w\u0001hy" } });
  for (const l of lines) assert.doesNotMatch(l, /[\u0000-\u0009\u000b-\u001f\u007f]/, "no raw control character reaches a line");
  assert.equal(lines.filter((l) => l.startsWith("STOP: ")).length, 1, "a forged line break cannot start a second STOP line");
});

unitTest("3.3 a rounds and a tokens trip are both listed", () => {
  const lines = stopBlock("e1", { rounds: { count: 2, limit: 2 }, tokens: { count: 900, limit: 800 } },
    { rounds: { target: "fable", from: "opus", source: "default", why: null }, tokens: { target: "user", from: "fable", source: "epic", why: "fable is the top tier" } });
  assert.match(lines[0], /rounds 2\/2, tokens 900\/800/);
  assert.ok(lines.some((l) => l.includes("--signal tokens --escalated-to user")));
});

// ───────────── 5.x the brief line, the record-gate-review block and the rules section ─────────────

const stuckState = () => ({
  spendGuard: { maxFailedRounds: 2 },
  epics: [epic("e1", { gateRounds: { gate2: { failStreak: 2 } } })],
});

unitTest("5.2 a stuck active epic gives one STOP line, from state alone; the pass anchor and overrides are honoured", () => {
  const lines = briefGuardLines(stuckState(), "e1");
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^STOP: spend guard — e1 rounds 2\/2/);
  assert.ok(lines[0].includes("`spend-guard e1`"));
  const overridden = stuckState();
  overridden.epics[0].spendGuardOverrides = [{ signal: "rounds", baseline: 2, escalatedTo: "opus", at: T(1) }];
  assert.deepEqual(briefGuardLines(overridden, "e1"), []);
});

unitTest("5.2 with no limit configured the brief helper returns no lines, however many fails are recorded", () => {
  const s = { epics: [epic("e1", { gateRounds: { gate1: { failStreak: 5 } } })] };
  assert.deepEqual(briefGuardLines(s, "e1"), []);
  assert.deepEqual(briefGuardLines(stuckState(), "ghost"), []);
  assert.deepEqual(recordedStopLines(s, "e1"), []);
});

unitTest("5.1 the record-gate-review block is the STOP block for the recorded part only", () => {
  const lines = recordedStopLines(stuckState(), "e1");
  assert.match(lines[0], /epic e1 is stuck: rounds 2\/2/);
  assert.match(lines.join("\n"), /fable or the user/, "the review role defaults to opus, so the target is fable");
  const healthy = stuckState();
  healthy.epics[0].gateRounds.gate2.failStreak = 1;
  assert.deepEqual(recordedStopLines(healthy, "e1"), []);
});

unitTest("5.3 the Spend guard section carries the check, exit 2, the autonomy sentence, the override and the marker form", () => {
  const text = spendGuardLines().join("\n");
  assert.match(text, /^## Spend guard/);
  assert.ok(text.includes("`spend-guard <epic>`"));
  assert.match(text, /exit 2 is a STOP/);
  assert.match(text, /autonomy does\s+not bypass/);
  assert.match(text, /`override-spend-guard <epic> --signal rounds\|tokens --escalated-to <target> --reason "<why>"`/);
  assert.match(text, /No\s+autonomy grant covers `override-spend-guard`/);
  assert.ok(text.includes("`pm-spend: epic=<id> role=review phase=review round=<n>`"));
});

// ───────────── gh-cfdude-pm-251: the token basis ─────────────

import { LOW_TOTAL_CEILING_FLOOR, tokenBaseline, checkTokenBasis } from "../../lib/spend-guard.mjs";

const COUNTS = { checked: true, total: 1131152, work: 7487, breakdown: { input: 10, cacheCreation: 5366, cacheRead: 1123665, output: 2111, work: 7487, total: 1131152 } };

unitTest("2.1 an absent basis reads as total (default), and nothing is rewritten", () => {
  const state = { spendGuard: { tokenCeiling: 300000000 }, epics: [{ id: "E", lane: "openspec" }] };
  const before = JSON.stringify(state);
  const r = resolveGuard(state, { epicId: "E" });
  assert.deepEqual(r.tokenBasis, { value: "total", source: "default" });
  assert.equal(JSON.stringify(state), before);
});

unitTest("2.1 a lane can count work while the project counts total", () => {
  const state = {
    spendGuard: { tokenCeiling: 300000000 },
    laneSpendGuards: { openspec: { tokenBasis: "work", tokenCeiling: 20000000 } },
    epics: [{ id: "A", lane: "openspec" }, { id: "B", lane: "superpowers" }],
  };
  const a = resolveGuard(state, { epicId: "A" }), b = resolveGuard(state, { epicId: "B" });
  assert.deepEqual([a.tokenBasis.value, a.tokenBasis.source, a.tokenCeiling.value], ["work", "lane:openspec", 20000000]);
  assert.deepEqual([b.tokenBasis.value, b.tokenBasis.source, b.tokenCeiling.value, b.tokenCeiling.source], ["total", "default", 300000000, "project"]);
});

unitTest("2.1 an invalid stored basis is ignored and reported, falling through to the default", () => {
  const r = resolveGuard({ spendGuard: { tokenBasis: "cached", tokenCeiling: 5 }, epics: [] }, {});
  assert.equal(r.tokenBasis.value, "total");
  assert.deepEqual(r.ignored.map((i) => i.field), ["tokenBasis"]);
  assert.equal(checkTokenBasis("cached").ok, false);
  assert.match(checkTokenBasis("cached").message, /--token-basis 'cached' must be one of total\|work/);
});

unitTest("2.1 a basis alone is not a limit", () => {
  assert.equal(guardConfigured({ spendGuard: { tokenBasis: "work" }, epics: [] }), false);
  assert.equal(guardConfigured({ spendGuard: { tokenBasis: "work", tokenCeiling: 5 }, epics: [] }), true);
});

unitTest("2.2 a work basis ignores cache-read; a total basis counts it", () => {
  const work = tokenSignal({}, resolvedWith(null, 1000000, 80, "work"), COUNTS);
  assert.deepEqual([work.state, work.count, work.basis], ["ok", 7487, "work"]);
  const total = tokenSignal({}, resolvedWith(null, 1000000, 80, "total"), COUNTS);
  assert.deepEqual([total.state, total.count], ["tripped", 1131152]);
});

unitTest("2.3 the signal carries basis and the six-count breakdown only when checked", () => {
  const on = tokenSignal({}, resolvedWith(null, 1000000, 80, "work"), COUNTS);
  assert.deepEqual(Object.keys(on.breakdown).sort(), ["cacheCreation", "cacheRead", "input", "output", "total", "work"]);
  assert.equal(on.basisSource, "default");
  const off = tokenSignal({}, resolvedWith(null, 1000000), { checked: false, kind: "off", why: "x" });
  assert.equal("breakdown" in off, false);
  assert.equal(off.basis, "total");
});

unitTest("2.5 a tokens override applies only in the basis it was recorded in; an older one never revives; 0.52 entries read as total", () => {
  const at = (n) => `2026-10-09T0${n}:00:00.000Z`;
  const mk = (...os) => ({ spendGuardOverrides: os.map((o, i) => ({ signal: "tokens", escalatedTo: "user", at: at(i + 1), ...o })) });
  const single = tokenBaseline(mk({ basis: "total", baseline: 900 }), "work");
  assert.deepEqual([single.baseline, single.setAside], [0, "total"]);
  const older = tokenBaseline(mk({ basis: "work", baseline: 5 }, { basis: "total", baseline: 900 }), "work");
  assert.deepEqual([older.baseline, older.setAside], [0, "total"], "the older work override does not revive");
  const legacy = tokenBaseline(mk({ baseline: 900 }), "total");
  assert.deepEqual([legacy.baseline, legacy.setAside], [900, null]);
  const sig = tokenSignal(mk({ basis: "total", baseline: 900 }), resolvedWith(null, 1000, 80, "work"), { checked: true, total: 5000, work: 950 });
  assert.deepEqual([sig.baseline, sig.overrideSetAside, sig.state], [0, "total", "warn"]);
  assert.equal(tokenBaseline({}, "work").setAside, null);
});

unitTest("2.4 the floor is a named constant of 10,000,000", () => {
  assert.equal(LOW_TOTAL_CEILING_FLOOR, 10000000);
});
