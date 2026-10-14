// scripts/test/unit/spend-guard-verbs.test.mjs
// spend-budget-and-stuck-loop-guard, tasks 2.2, 3.4 and 3.5 — the three verbs over an in-memory record.
// UNIT rung: every observable is a refusal, an exit code, a printed value or a value the record holds.
//
// RUNG NOTE (as in set-profile.test.mjs): a `set-spend-guard` that makes "a limit is configured" flip
// rewrites CLAUDE.md, a repository file, and the unit rung's counter refuses any filesystem write. So
// the FIRST limit and the LAST unset are on the file rung (assert/spend-guard.test.mjs). Here the record
// is seeded with a project limit already set, so every set/unset below leaves "configured" true and
// writes only the record.

import assert from "node:assert/strict";
import { emptyRecord, expectFail, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";
import { applyGuardOps, parseSetSpendGuard } from "../../lib/spend-guard-verbs.mjs";

const T = (n) => `2026-10-09T0${n}:00:00.000Z`;
const epic = (id, extra = {}) => ({ id, title: id, priority: "P2", status: "queued", role: "epic", lane: "openspec", links: [], reconcileNeeded: false, ...extra });
const seeded = ({ state = {}, epics = [epic("e1")] } = {}) => memoryEngine({ ...emptyRecord(), epics, ...state });
const rec = (engine) => engine.store.record();
const e1 = (engine) => rec(engine).epics.find((e) => e.id === "e1");
const text = (engine) => engine.store.read("state.json").text;
const guardJson = (engine, extra = []) => JSON.parse(engine.result(["spend-guard", "e1", "--json", ...extra]).stdout);
const IDS = ["e1"];

// ───────────── 2.2 parsing ─────────────

unitTest("2.2 every invalid call is refused naming the offending value and what is accepted", () => {
  const bad = (f) => parseSetSpendGuard(f, IDS);
  assert.match(bad({ "max-failed-rounds": "0" }).message, /--max-failed-rounds '0' must be a positive whole number/);
  assert.match(bad({ tokens: "-5" }).message, /--tokens '-5' must be a positive whole number/);
  assert.match(bad({ "warn-at": "100" }).message, /--warn-at '100' must be a whole number from 1 to 99/);
  assert.match(bad({ "warn-at": "0" }).message, /1 to 99/);
  assert.match(bad({ "max-failed-rounds": "2.5" }).message, /whole number/);
  assert.match(bad({ lane: "nope", tokens: "5" }).message, /--lane 'nope' is not one of openspec\|superpowers/);
  assert.match(bad({ epic: "missing", tokens: "5" }).message, /--epic 'missing'/);
  assert.match(bad({ epic: "e1", lane: "openspec", tokens: "5" }).message, /--epic or --lane, not both/);
  assert.match(bad({ epic: "e1" }).message, /needs an operation/);
  assert.match(bad({ unset: "model" }).message, /--unset 'model' is not one of max-failed-rounds\|tokens\|warn-at\|all/);
  assert.match(bad({ tokens: "5", unset: ["tokens"] }).message, /--tokens is both set and unset/);
  assert.equal(bad({ tokens: "5", unset: ["warn-at"] }).ok, true, "a different field is not a clash");
});

unitTest("2.2 a good call parses into ops, and 'all' expands to every field", () => {
  const r = parseSetSpendGuard({ lane: "openspec", tokens: "2000000", unset: "all" }, IDS);
  assert.equal(r.ok, false, "tokens set and unset-all clash");
  const ok = parseSetSpendGuard({ "max-failed-rounds": "3", "warn-at": "70" }, IDS);
  assert.deepEqual(ok.ops.sets, { maxFailedRounds: 3, warnAt: 70 });
  assert.deepEqual(parseSetSpendGuard({ unset: ["all"] }, IDS).ops.unsets, ["maxFailedRounds", "tokenCeiling", "warnAt"]);
});

// ───────────── 2.2 the pure write ─────────────

unitTest("2.2 setting at each layer lands in its own place", () => {
  const s = { epics: [epic("e1")] };
  const op = (f) => parseSetSpendGuard(f, IDS).ops;
  applyGuardOps(s, op({ "max-failed-rounds": "3" }));
  applyGuardOps(s, op({ lane: "openspec", tokens: "2000000" }));
  applyGuardOps(s, op({ epic: "e1", "max-failed-rounds": "1" }));
  assert.deepEqual(s.spendGuard, { maxFailedRounds: 3 });
  assert.deepEqual(s.laneSpendGuards, { openspec: { tokenCeiling: 2000000 } });
  assert.deepEqual(s.epics[0].spendGuard, { maxFailedRounds: 1 });
});

unitTest("2.2 an unset removes that field from that layer only, and an emptied layer disappears", () => {
  const s = { spendGuard: { maxFailedRounds: 3, warnAt: 70 }, laneSpendGuards: { openspec: { tokenCeiling: 9 } }, epics: [epic("e1", { spendGuard: { maxFailedRounds: 1 } })] };
  const op = (f) => parseSetSpendGuard(f, IDS).ops;
  assert.equal(applyGuardOps(s, op({ epic: "e1", unset: "max-failed-rounds" })).changed, true);
  assert.equal("spendGuard" in s.epics[0], false, "the emptied epic layer is removed from the record");
  assert.deepEqual(s.spendGuard, { maxFailedRounds: 3, warnAt: 70 }, "the project layer is untouched");
  applyGuardOps(s, op({ lane: "openspec", unset: "all" }));
  assert.equal("laneSpendGuards" in s, false, "an emptied lane map is removed");
  applyGuardOps(s, op({ unset: "all" }));
  assert.equal("spendGuard" in s, false);
});

unitTest("2.2 an unset of an absent field changes nothing and says which", () => {
  const s = { epics: [epic("e1")] };
  const r = applyGuardOps(s, parseSetSpendGuard({ lane: "openspec", unset: "tokens" }, IDS).ops);
  assert.deepEqual([r.changed, r.already], [false, ["tokenCeiling"]]);
  assert.equal("laneSpendGuards" in s, false);
});

// ───────────── 2.2 through the engine ─────────────

unitTest("2.2 every refusal through the engine writes nothing and exits non-zero", () => {
  const engine = seeded({ state: { spendGuard: { maxFailedRounds: 3 } } });
  const before = text(engine);
  for (const args of [
    ["--max-failed-rounds", "0"], ["--tokens", "-5"], ["--warn-at", "100"], ["--lane", "nope", "--tokens", "5"],
    ["--epic", "missing", "--tokens", "5"], ["--epic", "e1", "--lane", "openspec", "--tokens", "5"], ["--epic", "e1"], [],
  ]) {
    const err = expectFail(() => engine(["set-spend-guard", ...args]));
    assert.ok(err.stderr.length > 0, args.join(" "));
    assert.equal(text(engine), before, `${args.join(" ")} wrote nothing`);
  }
});

unitTest("2.2 an unset of an absent field exits 0, says nothing changed, and writes nothing", () => {
  const engine = seeded({ state: { spendGuard: { maxFailedRounds: 3 } } });
  const before = text(engine);
  const out = engine.combined(["set-spend-guard", "--lane", "openspec", "--unset", "tokens"]);
  assert.match(out, /unchanged \(already unset: tokenCeiling\)/);
  assert.equal(text(engine), before);
});

unitTest("2.2 an epic value overrides the project value, and unsetting it falls through", () => {
  const engine = seeded({ state: { spendGuard: { maxFailedRounds: 3 } }, epics: [epic("e1"), epic("e2")] });
  engine(["set-spend-guard", "--epic", "e1", "--max-failed-rounds", "1"]);
  const rounds = (id) => JSON.parse(engine.result(["spend-guard", id, "--json"]).stdout).signals.rounds;
  assert.deepEqual([rounds("e1").limit, rounds("e1").source], [1, "epic"]);
  assert.deepEqual([rounds("e2").limit, rounds("e2").source], [3, "project"]);
  engine(["set-spend-guard", "--epic", "e1", "--unset", "max-failed-rounds"]);
  assert.deepEqual([rounds("e1").limit, rounds("e1").source], [3, "project"]);
  assert.equal("spendGuard" in e1(engine), false, "epic.spendGuard is absent from the record");
});

unitTest("2.2 a lane value applies to that lane's epics only", () => {
  const engine = seeded({ state: { spendGuard: { maxFailedRounds: 3 } }, epics: [epic("e1"), epic("e3", { lane: "superpowers" })] });
  engine(["set-spend-guard", "--lane", "openspec", "--tokens", "2000000"]);
  const tokens = (id) => JSON.parse(engine.result(["spend-guard", id, "--json"]).stdout).signals.tokens;
  assert.deepEqual([tokens("e1").limit, tokens("e1").source], [2000000, "lane:openspec"]);
  assert.deepEqual([tokens("e3").limit, tokens("e3").source], [null, null]);
});

unitTest("2.2 a ceiling set while tracking is off is recorded and the output says it will not be checked", () => {
  const engine = seeded({ state: { spendGuard: { maxFailedRounds: 3 } } });
  const out = engine.combined(["set-spend-guard", "--tokens", "1000000"]);
  assert.equal(rec(engine).spendGuard.tokenCeiling, 1000000);
  assert.match(out, /will not be checked until you run set-spend-tracking on/);
});

// ───────────── 3.4 spend-guard ─────────────

const stuck = (extra = {}) => seeded({
  state: { spendGuard: { maxFailedRounds: 3 } },
  epics: [epic("e1", { gateRounds: { gate1: { fails: 3, passes: 0, failStreak: 3, lastVerdictAt: T(1) } }, ...extra })],
});

unitTest("3.4 a healthy epic exits 0 and prints each signal's count and limit", () => {
  const engine = seeded({ state: { spendGuard: { maxFailedRounds: 3, tokenCeiling: 100 } }, epics: [epic("e1", { gateRounds: { gate1: { failStreak: 1 } } })] });
  const r = engine.result(["spend-guard", "e1"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /rounds: ok — count 1, limit 3 \(project\)/);
  assert.match(r.stdout, /tokens: not checked — spend tracking is off; the guard is counting rounds only/);
  assert.doesNotMatch(r.stdout, /STOP/);
});

unitTest("3.4 a stuck epic prints the STOP block and exits 2", () => {
  const r = stuck().result(["spend-guard", "e1"]);
  assert.equal(r.status, 2);
  assert.match(r.stdout, /STOP: spend guard — epic e1 is stuck: rounds 3\/3/);
  assert.ok(r.stdout.includes('override-spend-guard e1 --signal rounds --escalated-to fable --reason "<why>"'));
});

unitTest("3.4 the JSON form is one object with the documented keys, and its exit code follows the same rule", () => {
  const r = stuck().result(["spend-guard", "e1", "--json"]);
  assert.equal(r.status, 2);
  const j = JSON.parse(r.stdout);
  assert.deepEqual(Object.keys(j).filter((k) => ["epic", "stuck", "signals", "overrides", "escalation", "tracking"].includes(k)).sort(),
    ["epic", "escalation", "overrides", "signals", "stuck", "tracking"]);
  assert.equal(j.stuck, true);
  for (const s of ["rounds", "tokens"]) {
    for (const k of ["state", "count", "limit", "source", "baseline"]) assert.ok(k in j.signals[s], `${s}.${k}`);
  }
  assert.equal(j.tracking, "off");
  assert.equal(j.escalation.rounds.target, "fable");
  const ok = seeded({ state: { spendGuard: { maxFailedRounds: 3 } } }).result(["spend-guard", "e1", "--json"]);
  assert.equal(ok.status, 0);
  assert.equal(JSON.parse(ok.stdout).stuck, false);
});

unitTest("3.4 an unknown epic is refused with exit 1 naming the id", () => {
  const r = seeded().result(["spend-guard", "missing"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no epic 'missing'/);
});

unitTest("3.4 spend-guard writes nothing to the record", () => {
  const engine = stuck();
  const before = text(engine);
  engine.result(["spend-guard", "e1"]);
  engine.result(["spend-guard", "e1", "--json"]);
  assert.equal(text(engine), before);
});

unitTest("3.4 with no ceiling and tracking off the token line says there is no limit, not 'not checked'", () => {
  const out = stuck().result(["spend-guard", "e1"]).stdout;
  assert.match(out, /tokens: no limit set/);
});

unitTest("3.4 a withdrawn pass is flagged, not undone, and still anchors", () => {
  const engine = seeded({
    state: { spendGuard: { maxFailedRounds: 3 } },
    epics: [epic("e1", {
      gateRounds: { gate1: { fails: 3, passes: 1, failStreak: 0, lastVerdictAt: T(2), lastPassAt: T(2) } },
      gateReview: {},
      withdrawnGateReviews: [{ gate: 1, entry: { verdict: "pass", reviewedAt: T(2) }, reason: "x", withdrawnAt: T(3) }],
    })],
  });
  const j = JSON.parse(engine.result(["spend-guard", "e1", "--json"]).stdout);
  assert.equal(j.signals.rounds.count, 0, "the streak it ended is not restored");
  assert.ok(j.notes.some((n) => /gate 1's latest verdict, a pass, is withdrawn.*not restored.*still anchors the ledger side and override liveness/.test(n)), JSON.stringify(j.notes));
  assert.match(engine.result(["spend-guard", "e1"]).stdout, /note: gate 1's latest verdict, a pass, is withdrawn/);
});

unitTest("3.4 an epic recorded before this release reads zero, says no pass anchor, and never trips", () => {
  const engine = seeded({
    state: { spendGuard: { maxFailedRounds: 1 } },
    epics: [epic("e1", { gateReview: { gate1: { verdict: "fail", reviewedAt: T(1), superseded: { verdict: "fail", reviewedAt: T(1) } } } })],
  });
  const j = JSON.parse(engine.result(["spend-guard", "e1", "--json"]).stdout);
  assert.deepEqual([j.signals.rounds.count, j.signals.rounds.recorded, j.stuck], [0, 0, false]);
  assert.equal(j.passAnchor, null, "no pass anchor");
  assert.ok(j.notes.some((n) => /gate 1 carries a verdict recorded before the round tally existed.*recorded fail streak reads 0.*no pass anchor.*counting starts from the first verdict recorded by this release/.test(n)), JSON.stringify(j.notes));
  const text = engine.result(["spend-guard", "e1"]).stdout;
  assert.match(text, /pass anchor none/);
  assert.match(text, /counting starts from the first verdict recorded by this release/);
});

unitTest("3.4 an epic whose gates are all tallied carries no 'before the tally' note, and the report names its pass anchor", () => {
  const engine = seeded({
    state: { spendGuard: { maxFailedRounds: 3 } },
    epics: [epic("e1", {
      gateReview: { gate1: { verdict: "pass", reviewedAt: T(2) } },
      gateRounds: { gate1: { fails: 0, passes: 1, failStreak: 0, lastVerdictAt: T(2), lastPassAt: T(2) } },
    })],
  });
  const j = JSON.parse(engine.result(["spend-guard", "e1", "--json"]).stdout);
  assert.deepEqual(j.notes, []);
  assert.equal(j.passAnchor, T(2));
  assert.match(engine.result(["spend-guard", "e1"]).stdout, new RegExp(`pass anchor ${T(2)}`));
});

// ───────────── 3.5 override-spend-guard ─────────────

const OV = (engine, ...a) => engine.result(["override-spend-guard", "e1", ...a]);
const sonnetReview = { model: { review: { model: "sonnet", effort: "medium" } } };

unitTest("3.5 overriding a tripped rounds signal records the baseline and the model, and re-arms the guard", () => {
  const engine = stuck(sonnetReview);
  const r = OV(engine, "--signal", "rounds", "--escalated-to", "opus", "--reason", "opus diagnosed the fixture");
  assert.equal(r.status, 0, r.stderr);
  const o = e1(engine).spendGuardOverrides;
  assert.equal(o.length, 1);
  assert.deepEqual([o[0].signal, o[0].baseline, o[0].escalatedTo, o[0].reason], ["rounds", 3, "opus", "opus diagnosed the fixture"]);
  assert.match(o[0].at, /^\d{4}-\d\d-\d\dT/);
  assert.equal(engine.result(["spend-guard", "e1"]).status, 0, "not tripped again");
  e1(engine).gateRounds.gate1.failStreak = 6;
  assert.equal(engine.result(["spend-guard", "e1"]).status, 2, "tripped again at 6");
});

unitTest("3.5 the model that failed cannot override itself: the lowest accepted model is named", () => {
  const engine = stuck(sonnetReview);
  const before = text(engine);
  const r = OV(engine, "--signal", "rounds", "--escalated-to", "sonnet", "--reason", "retry");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /lowest accepted model is opus/);
  assert.equal(text(engine), before);
});

unitTest("3.5 a second model override must go to the user", () => {
  const engine = stuck({ ...sonnetReview, spendGuardOverrides: [{ signal: "rounds", baseline: 0, escalatedTo: "opus", reason: "x", at: T(1) }] });
  const before = text(engine);
  const r = OV(engine, "--signal", "rounds", "--escalated-to", "fable", "--reason", "again");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /next escalation is the user's/);
  assert.equal(text(engine), before);
  assert.equal(OV(engine, "--signal", "rounds", "--escalated-to", "user", "--reason", "a person looked").status, 0);
  assert.equal(e1(engine).spendGuardOverrides.length, 2);
});

unitTest("3.5 an override cannot pre-authorize: an untripped signal is refused and nothing is written", () => {
  const engine = seeded({ state: { spendGuard: { maxFailedRounds: 3 } } });
  const before = text(engine);
  const r = OV(engine, "--signal", "rounds", "--escalated-to", "user", "--reason", "in advance");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /nothing to override/);
  assert.equal(text(engine), before);
});

unitTest("3.5 a tokens override needs the ledger: refused while tracking is off", () => {
  const engine = seeded({ state: { spendGuard: { tokenCeiling: 10 } } });
  const before = text(engine);
  const r = OV(engine, "--signal", "tokens", "--escalated-to", "user", "--reason", "x");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /token signal is not checked while spend tracking is off/);
  assert.equal(text(engine), before);
});

unitTest("3.5 required fields: a missing or blank reason, a bad or missing --escalated-to, a bad signal", () => {
  const engine = stuck(sonnetReview);
  const before = text(engine);
  for (const args of [
    ["--signal", "rounds", "--escalated-to", "opus"],
    ["--signal", "rounds", "--escalated-to", "opus", "--reason", "   "],
    ["--signal", "rounds", "--reason", "x"],
    ["--signal", "rounds", "--escalated-to", "gpt", "--reason", "x"],
    ["--escalated-to", "opus", "--reason", "x"],
    ["--signal", "latency", "--escalated-to", "opus", "--reason", "x"],
  ]) {
    const r = OV(engine, ...args);
    assert.equal(r.status, 1, args.join(" "));
    assert.equal(text(engine), before);
  }
});

unitTest("3.5 revoking marks the latest live override and keeps it, and the guard is re-armed at once", () => {
  const engine = stuck({ ...sonnetReview, spendGuardOverrides: [{ signal: "rounds", baseline: 3, escalatedTo: "opus", reason: "x", at: T(1) }] });
  assert.equal(engine.result(["spend-guard", "e1"]).status, 0, "the override holds the guard open");
  const r = OV(engine, "--signal", "rounds", "--revoke", "--reason", "it was not diagnosed");
  assert.equal(r.status, 0, r.stderr);
  const o = e1(engine).spendGuardOverrides;
  assert.equal(o.length, 1, "kept in the record");
  assert.match(o[0].revokedAt, /^\d{4}-/);
  assert.equal(o[0].revokeReason, "it was not diagnosed");
  assert.equal(engine.result(["spend-guard", "e1"]).status, 2);
});

unitTest("3.5 a revoke with nothing live is refused; --escalated-to is refused alongside --revoke", () => {
  const engine = stuck(sonnetReview);
  const before = text(engine);
  const none = OV(engine, "--signal", "tokens", "--revoke", "--reason", "x");
  assert.equal(none.status, 1);
  assert.match(none.stderr, /no live tokens override/);
  const both = OV(engine, "--signal", "rounds", "--revoke", "--escalated-to", "opus", "--reason", "x");
  assert.equal(both.status, 1);
  assert.match(both.stderr, /--escalated-to is refused alongside --revoke/);
  assert.equal(text(engine), before);
});

unitTest("3.5 a revoke falls back to the previous live override's baseline", () => {
  const engine = stuck({ ...sonnetReview, spendGuardOverrides: [
    { signal: "rounds", baseline: 1, escalatedTo: "opus", reason: "a", at: T(1) },
    { signal: "rounds", baseline: 3, escalatedTo: "user", reason: "b", at: T(2) },
  ] });
  OV(engine, "--signal", "rounds", "--revoke", "--reason", "undo the second");
  const j = JSON.parse(engine.result(["spend-guard", "e1", "--json"]).stdout);
  assert.equal(j.signals.rounds.baseline, 1);
  assert.equal(j.overrides.length, 2, "both entries are still in the record");
});
