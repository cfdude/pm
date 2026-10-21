// scripts/test/unit/decision-log.test.mjs
// decision-cost-log 1.x -- record-decision append, numbering, every refusal, the tracking-off refusal and the
// withdrawal, over an in-memory record. No file is opened.

import assert from "node:assert/strict";
import { emptyRecord, expectFail, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";
import { EPIC_FLAGS, flagsFor, settableEpicFlags } from "../../lib/constants.mjs";
import { VERB_EFFECTS } from "../../lib/verb-effects.mjs";

const TRACKING = { enabled: true, enabledAt: "2026-10-01T00:00:00.000Z" };
const epic = (id, extra = {}) => ({ id, title: id, priority: "P2", status: "queued", role: "epic", lane: "claude-code", links: [], reconcileNeeded: false, ...extra });
const seeded = ({ tracking = TRACKING, epics = [epic("e1")] } = {}) =>
  memoryEngine({ ...emptyRecord(), epics, ...(tracking ? { spendTracking: tracking } : {}) });
const e1 = (engine, id = "e1") => engine.store.record().epics.find((e) => e.id === id);
const bytes = (engine) => engine.store.read("state.json").text;
const REC = ["record-decision", "e1", "--what", "split the build", "--why", "one agent ran 156 turns", "--since", "2026-10-10T00:00:00Z"];

unitTest("1.1 a decision is appended with its values, until equal to its record time, and numbered 1", () => {
  const engine = seeded();
  engine([...REC, "--alternative", "keep one agent", "--alternative", "split by file", "--phase", "build"]);
  const [d] = e1(engine).decisions;
  assert.deepEqual([d.n, d.what, d.why, d.phase, d.since], [1, "split the build", "one agent ran 156 turns", "build", "2026-10-10T00:00:00Z"]);
  assert.deepEqual(d.alternatives, ["keep one agent", "split by file"]);
  assert.equal(d.until, d.at, "until defaults to the record time");
  assert.ok(Number.isFinite(Date.parse(d.at)));
});

unitTest("1.1 phase and alternatives are optional: phase is null and alternatives empty", () => {
  const engine = seeded();
  engine(REC);
  assert.deepEqual([e1(engine).decisions[0].phase, e1(engine).decisions[0].alternatives], [null, []]);
});

unitTest("1.1 an explicit --until is kept as given", () => {
  const engine = seeded();
  engine([...REC, "--until", "2026-10-12T00:00:00Z"]);
  assert.equal(e1(engine).decisions[0].until, "2026-10-12T00:00:00Z");
});

unitTest("1.1 numbering is per epic, 1-based and never reused: a withdrawn decision's number stays taken", () => {
  const engine = seeded({ epics: [epic("e1"), epic("e2")] });
  engine(REC); engine(REC);
  engine(["record-decision", "e1", "--withdraw", "2", "--reason", "dup"]);
  engine(REC);
  assert.deepEqual(e1(engine).decisions.map((d) => d.n), [1, 2, 3]);
  engine(["record-decision", "e2", "--what", "x", "--why", "y", "--since", "2026-10-10T00:00:00Z"]);
  assert.equal(e1(engine, "e2").decisions[0].n, 1, "a second epic numbers from 1");
});

unitTest("1.1 an archived epic accepts a decision", () => {
  const engine = seeded({ epics: [epic("e1", { status: "archived", disposition: { outcome: "delivered" } })] });
  engine(REC);
  assert.equal(e1(engine).decisions.length, 1);
});

unitTest("1.1 every invalid input is refused naming what is wrong, and state.json is byte-identical", () => {
  const engine = seeded();
  const before = bytes(engine);
  const long = "x".repeat(2001);
  const cases = [
    [["record-decision", "e1", "--why", "y", "--since", "2026-10-10T00:00:00Z"], /--what/],
    [["record-decision", "e1", "--what", "x", "--since", "2026-10-10T00:00:00Z"], /--why/],
    [["record-decision", "e1", "--what", "  ", "--why", "y", "--since", "2026-10-10T00:00:00Z"], /--what/],
    [["record-decision", "e1", "--what", "x", "--why", "y"], /--since/],
    [["record-decision", "e1", "--what", "x", "--why", "y", "--since", "yesterday"], /--since.*ISO/],
    [[...REC, "--until", "2026-10-09T00:00:00Z"], /--until.*before --since/],
    [[...REC, "--until", "2999-01-01T00:00:00Z"], /--until.*in the future/],
    [["record-decision", "e1", "--what", "x", "--why", "y", "--since", "2999-01-01T00:00:00Z"], /--since/],
    [[...REC, "--phase", "spec"], /--phase.*plan\|build\|review\|docs\|release/],
    [["record-decision", "e1", "--what", long, "--why", "y", "--since", "2026-10-10T00:00:00Z"], /2,000/],
    [[...REC, "--alternative", long], /2,000/],
    [[...REC, "--alternative", "  "], /--alternative/],
    [["record-decision", "nope", ...REC.slice(2)], /no epic/],
    [["record-decision", ...REC.slice(2)], /usage|epic/i],
  ];
  for (const [args, re] of cases) {
    const r = engine.result(args);
    assert.notEqual(r.status, 0, args.join(" ").slice(0, 60));
    assert.match(r.stderr, re, args.join(" ").slice(0, 60));
    assert.equal(bytes(engine), before, `nothing written: ${args.join(" ").slice(0, 60)}`);
  }
});

unitTest("1.1 with spend tracking off, recording is refused naming set-spend-tracking on and update-epic --notes, and writes nothing", () => {
  const engine = seeded({ tracking: null });
  const before = bytes(engine);
  const r = engine.result(REC);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /set-spend-tracking on/);
  assert.match(r.stderr, /update-epic e1 --notes/);
  assert.equal(bytes(engine), before);
  const off = seeded({ tracking: { enabled: false, enabledAt: "2026-10-01T00:00:00.000Z" } });
  assert.match(off.result(REC).stderr, /set-spend-tracking on/);
});

unitTest("1.1 the verb is registered: epic-writing (so --session is accepted), engine-written set-only field, flags declared", () => {
  assert.equal(VERB_EFFECTS["record-decision"].epicWriting, true);
  assert.equal(VERB_EFFECTS["record-decision"].effect, "mutates");
  assert.ok(flagsFor("record-decision").includes("session"));
  for (const f of ["what", "why", "since", "until", "alternative", "phase", "withdraw", "reason"]) assert.ok(flagsFor("record-decision").includes(f), f);
  const row = EPIC_FLAGS.find((f) => f.key === "decisions");
  assert.ok(row && row.engineWritten === true);
  assert.match(row.setOnly, /withdraw/);
  assert.equal(settableEpicFlags("update-epic").some((f) => f.flag === "decisions"), false, "not typeable on update-epic");
  assert.notEqual(expectFail(() => seeded()(["update-epic", "e1", "--clear", "decisions"])).status, 0);
});

unitTest("1.1 --session is recorded on the epic by the same save", () => {
  const engine = seeded();
  engine([...REC, "--session", "builder-a"]);
  assert.deepEqual(e1(engine).sessions.map((s) => s.session), ["builder-a"]);
});

// ───────────── 1.2 the withdrawal ─────────────

unitTest("1.2 --withdraw marks the decision withdrawn with the time and reason and keeps it", () => {
  const engine = seeded();
  engine(REC);
  engine(["record-decision", "e1", "--withdraw", "1", "--reason", "duplicate of 2"]);
  const d = e1(engine).decisions[0];
  assert.equal(d.withdrawReason, "duplicate of 2");
  assert.ok(Number.isFinite(Date.parse(d.withdrawnAt)));
  assert.equal(d.what, "split the build", "the record is kept");
});

unitTest("1.2 withdrawing an absent or an already-withdrawn decision is refused and writes nothing", () => {
  const engine = seeded();
  engine(REC);
  engine(["record-decision", "e1", "--withdraw", "1", "--reason", "dup"]);
  const before = bytes(engine);
  for (const [args, re] of [
    [["record-decision", "e1", "--withdraw", "1", "--reason", "again"], /decision 1.*already withdrawn/],
    [["record-decision", "e1", "--withdraw", "9", "--reason", "x"], /no decision 9/],
    [["record-decision", "e1", "--withdraw", "0", "--reason", "x"], /--withdraw/],
    [["record-decision", "e1", "--withdraw", "abc", "--reason", "x"], /--withdraw/],
    [["record-decision", "e1", "--withdraw", "1"], /--reason/],
    [["record-decision", "e1", "--withdraw", "1", "--reason", "  "], /--reason/],
  ]) {
    const r = engine.result(args);
    assert.notEqual(r.status, 0, args.join(" "));
    assert.match(r.stderr, re, args.join(" "));
    assert.equal(bytes(engine), before);
  }
});

unitTest("1.2 --withdraw takes no decision fields; a stray --reason on a record is refused too", () => {
  const engine = seeded();
  engine(REC);
  const before = bytes(engine);
  for (const extra of [["--what", "x"], ["--why", "y"], ["--since", "2026-10-10T00:00:00Z"], ["--phase", "build"], ["--alternative", "a"]]) {
    const r = engine.result(["record-decision", "e1", "--withdraw", "1", "--reason", "r", ...extra]);
    assert.notEqual(r.status, 0, extra[0]);
    assert.match(r.stderr, /--withdraw takes only --reason/);
  }
  const stray = engine.result([...REC, "--reason", "r"]);
  assert.notEqual(stray.status, 0);
  assert.match(stray.stderr, /--reason/);
  assert.equal(bytes(engine), before);
});

unitTest("1.2 withdrawing is accepted with tracking off (it reads no ledger)", () => {
  const engine = seeded();
  engine(REC);
  engine(["update-epic", "e1", "--notes", "keep"]);
  const off = memoryEngine({ ...engine.store.record(), spendTracking: { enabled: false, enabledAt: TRACKING.enabledAt } });
  off(["record-decision", "e1", "--withdraw", "1", "--reason", "gone"]);
  assert.ok(e1(off).decisions[0].withdrawnAt);
});

unitTest("1.2 a fresh init holds no decisions and upgrade records none", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "e1", "--title", "E1", "--lane", "claude-code"]);
  assert.equal("decisions" in e1(engine), false);
});

// ───────────── 2.x cost and render ─────────────

import { costDecisions, renderDecisionLines } from "../../lib/decision-log.mjs";
import { analyze, renderAnalysis } from "../../lib/spend-analysis.mjs";

let seq = 0;
const row = (over = {}) => ({
  messageId: `m${++seq}`, sessionId: "s", agentId: null, actor: "orchestrator", at: "2026-10-10T12:00:00.000Z",
  model: "claude-opus-4-7", tier: "opus", input: 0, cacheCreation: 0, cacheRead: 0, output: 0, thinking: 0, tools: [],
  epic: "e1", role: null, phase: null, round: null, attribution: "window", reason: null, ...over,
});
const dec = (n, over = {}) => ({
  n, what: `decision ${n}`, why: "because", alternatives: [], phase: null,
  since: "2026-10-10T00:00:00Z", until: "2026-10-11T00:00:00Z", at: "2026-10-11T00:00:00.000Z", ...over,
});
const on = { enabled: true, enabledAt: "2026-10-01T00:00:00.000Z" };
const cost = (decisions, attributed, tracking = on) => costDecisions({ decisions, epicId: "e1", attributed, tracking });

unitTest("2.1 the cost is the work and total attributed to the epic inside the window, and follows the rows", () => {
  const rows = [row({ cacheRead: 720_000, output: 30_000 })];
  const [d] = cost([dec(1)], rows);
  assert.deepEqual([d.cost.computed, d.cost.work, d.cost.total], [true, 30_000, 750_000]);
  assert.equal(d.cost.coverage, 1);
  const [d2] = cost([dec(1)], [...rows, row({ output: 5 })]);
  assert.equal(d2.cost.work, 30_005, "a new row in the window is included at the next read");
});

unitTest("2.1 the window is half-open: since is in, until is out; other epics' and out-of-window rows are not counted", () => {
  const rows = [
    row({ at: "2026-10-10T00:00:00.000Z", output: 1 }), row({ at: "2026-10-10T23:59:59.999Z", output: 10 }),
    row({ at: "2026-10-11T00:00:00.000Z", output: 100 }), row({ at: "2026-10-09T23:59:59.999Z", output: 1000 }),
    row({ epic: "e2", output: 10_000 }),
  ];
  assert.equal(cost([dec(1)], rows)[0].cost.work, 11);
});

unitTest("2.1 coverage is the window's attributed share of all spend in the window", () => {
  const rows = [row({ output: 75 }), row({ epic: null, reason: "no-active-epic", output: 25 })];
  assert.equal(cost([dec(1)], rows)[0].cost.coverage, 0.75);
  assert.equal(cost([dec(1)], [])[0].cost.coverage, null, "no spend in the window: no share");
});

unitTest("2.1 a re-attribution re-prices the decision with no write to the record", () => {
  const stored = [dec(1)];
  const before = JSON.stringify(stored);
  const unattributed = row({ epic: null, reason: "invalid-marker", actor: "subagent", agentId: "A", output: 400, invalid: { field: "phase", value: "spec", accepted: ["plan"] } });
  const fixed = { ...unattributed, epic: "e1", reason: null, role: "implement", phase: "build", round: 1, invalid: undefined };
  assert.equal(cost(stored, [unattributed])[0].cost.work, 0);
  assert.equal(cost(stored, [fixed])[0].cost.work, 400);
  assert.equal(JSON.stringify(stored), before, "costs are computed, never stored");
});

unitTest("2.1 costs are never summed across decisions: overlapping windows each carry the shared spend", () => {
  const rows = [row({ output: 100 })];
  const out = cost([dec(1), dec(2, { since: "2026-10-10T06:00:00Z" })], rows);
  assert.deepEqual(out.map((d) => d.cost.work), [100, 100]);
  assert.match(renderDecisionLines(out).join("\n"), /not summed/);
});

unitTest("2.1 a withdrawn decision is listed as withdrawn with no cost; the rest are costed", () => {
  const w = dec(2, { withdrawnAt: "2026-10-12T00:00:00.000Z", withdrawReason: "dup" });
  const out = cost([dec(1), w], [row({ output: 7 })]);
  assert.equal(out[1].withdrawn, true);
  assert.deepEqual(out[1].cost, { computed: false, reason: "withdrawn" });
  assert.equal(out[0].withdrawn, false);
  const text = renderDecisionLines(out).join("\n");
  assert.match(text, /decision 2 \(withdrawn 2026-10-12T00:00:00.000Z: dup\)/);
});

unitTest("2.1 with tracking off the cost is `not computed — spend tracking is off`, in text and in the object", () => {
  for (const tracking of [null, { enabled: false }]) {
    const out = cost([dec(1)], [], tracking);
    assert.deepEqual(out[0].cost, { computed: false, reason: "spend tracking is off" });
    assert.match(renderDecisionLines(out).join("\n"), /cost: not computed — spend tracking is off/);
  }
});

unitTest("2.1 the text says the cost is the epic's spend in the window, not spend the decision caused", () => {
  const text = renderDecisionLines(cost([dec(1)], [row({ output: 1 })])).join("\n");
  assert.match(text, /the epic's attributed spend in the window, not spend caused by the decision alone/);
  assert.match(text, /decision 1: decision 1/);
  assert.match(text, /work 1 · total 1/);
});

unitTest("2.1 stored text is printed through escapeControls", () => {
  const text = renderDecisionLines(cost([dec(1, { what: "a\u001b[31mred", why: "b\nforged: line" })], [])).join("\n");
  assert.doesNotMatch(text, /\u001b/);
  assert.doesNotMatch(text, /\nforged: line/);
});

unitTest("2.1 an unknown epic is refused; an epic with no decisions says so; the flags are declared", () => {
  const engine = memoryEngine({ ...emptyRecord(), epics: [epic("e1")] });
  assert.notEqual(engine.result(["decisions", "nope"]).status, 0);
  assert.match(engine(["decisions", "e1"]), /no decisions recorded for 'e1'/);
  assert.deepEqual(JSON.parse(engine(["decisions", "e1", "--json"])).decisions, []);
  assert.ok(flagsFor("decisions").includes("json") && flagsFor("decisions").includes("no-ingest"));
  assert.equal(VERB_EFFECTS.decisions.detachedNoOp, true);
});

unitTest("2.1 with tracking off, `decisions` lists each decision as not computed", () => {
  const engine = memoryEngine({ ...emptyRecord(), epics: [epic("e1", { decisions: [dec(1), dec(2, { withdrawnAt: "2026-10-12T00:00:00.000Z", withdrawReason: "x" })] })] });
  const text = engine(["decisions", "e1"]);
  assert.match(text, /decision 1: decision 1/);
  assert.match(text, /cost: not computed — spend tracking is off/);
  assert.match(text, /decision 2 \(withdrawn/);
  const j = JSON.parse(engine(["decisions", "e1", "--json"]));
  assert.equal(j.epic, "e1");
  assert.deepEqual(j.decisions.map((d) => [d.n, d.withdrawn]), [[1, false], [2, true]]);
  assert.deepEqual(j.decisions[0].cost, { computed: false, reason: "spend tracking is off" });
  assert.equal(j.decisions[0].what, "decision 1", "the stored fields ride along");
});

// 2.2 the section inside spend-analysis --epic

const inSt = (decisions) => ({ ...emptyRecord(), epics: [epic("e1", decisions ? { decisions } : {})], releases: [] });
const analysis = (decisions, rows = [row({ output: 9 })], tracking = on) =>
  analyze({ attributed: rows, state: inSt(decisions), tracking, ingest: null, scope: { epic: "e1" } });

unitTest("2.2 spend-analysis --epic lists the epic's live decisions with their costs, in n order, text and JSON", () => {
  const out = analysis([dec(2), dec(1)]);
  assert.deepEqual(out.decisions.map((d) => d.n), [1, 2]);
  const text = renderAnalysis(out).join("\n");
  assert.match(text, /Decisions \(2\)/);
  assert.ok(text.indexOf("decision 1:") < text.indexOf("decision 2:"));
  assert.match(text, /work 9 · total 9/);
});

unitTest("2.2 with tracking off the section lists the decisions as not computed", () => {
  const out = analysis([dec(1)], [], { enabled: false });
  out.off = "off";
  assert.deepEqual(out.decisions[0].cost, { computed: false, reason: "spend tracking is off" });
  assert.match(renderAnalysis(out).join("\n"), /cost: not computed — spend tracking is off/);
});

unitTest("2.2 an epic with no decisions shows no Decisions section; a ledger-wide or release scope carries no decisions key", () => {
  assert.doesNotMatch(renderAnalysis(analysis(undefined)).join("\n"), /Decisions \(/);
  assert.deepEqual(analysis(undefined).decisions, []);
  const wide = analyze({ attributed: [row({ output: 1 })], state: inSt([dec(1)]), tracking: on, ingest: null, scope: {} });
  assert.equal("decisions" in wide, false);
});
