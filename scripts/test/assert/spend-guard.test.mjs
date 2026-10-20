// scripts/test/assert/spend-guard.test.mjs
// spend-budget-and-stuck-loop-guard, tasks 3.4 (FILE), 4.1, 5.1, 5.2 and 5.3 (FILE) — the guard over a
// fixture ledger under a temp CLAUDE_CONFIG_DIR, the "opened no ledger file" assertions, and the
// CLAUDE.md the guard rewrites. FILE rung: bytes on disk and the paths the engine touches. Linked-worktree
// and detached scenarios use a hand-written git gateway (this half runs no real git).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, invokeEngine, writeState } from "../fixtures/assert-harness.mjs";
import { fakeGit } from "../fixtures/fake-git.mjs";
import { recordFsPaths, touchedUnder } from "../fixtures/fs-path-recorder.mjs";

const ENABLED_AT = "2026-10-01T00:00:00.000Z";
const realRepo = () => fs.realpathSync(tmpRepo());
const spendPath = (cwd, ...p) => path.join(cwd, ".conductor", "spend", ...p);
const statePath = (cwd) => path.join(cwd, ".conductor", "state.json");
const stateOf = (cwd) => JSON.parse(fs.readFileSync(statePath(cwd), "utf8"));
const claudeMd = (cwd) => fs.readFileSync(path.join(cwd, "CLAUDE.md"), "utf8");
const BASE = Date.parse("2026-10-09T09:00:00.000Z");
const at = (minutes) => new Date(BASE + minutes * 60000).toISOString();

/** A repo with epic e1 (and optionally more), a round limit, and tracking on from ENABLED_AT. */
function scene({ on = false, limit = 2, tokens = null, epics = ["e1"] } = {}) {
  const cwd = realRepo();
  const cfg = realRepo();
  run(["init"], { cwd });
  for (const id of epics) run(["add-epic", "--id", id, "--title", id.toUpperCase(), "--lane", "claude-code"], { cwd });
  if (limit) run(["set-spend-guard", "--max-failed-rounds", String(limit)], { cwd });
  if (tokens) run(["set-spend-guard", "--tokens", String(tokens)], { cwd });
  if (on) {
    run(["set-spend-tracking", "on"], { cwd });
    const s = stateOf(cwd);
    s.spendTracking.enabledAt = ENABLED_AT;
    writeState(cwd, s);
  }
  const env = { CLAUDE_CONFIG_DIR: cfg, HOME: "/no/such/home" };
  return { cwd, cfg, env, opts: { cwd, env } };
}

/** Write a hand-built ledger: one sub-agent per `rounds` entry, each marked `epic/review/<n>`. `rows` is
 *  `[{ agent, at, output, marker }]`; `marker: false` leaves the agent unmarked. */
function ledger(sc, rows) {
  const dir = spendPath(sc.cwd);
  fs.mkdirSync(dir, { recursive: true });
  const markers = {};
  const lines = rows.map((r, i) => {
    if (r.marker !== false && r.marker !== undefined) markers[r.agent] = r.marker;
    return JSON.stringify({
      messageId: `m${i}`, sessionId: "s1", agentId: r.agent, actor: "subagent", source: "subagent", at: r.at,
      model: "claude-opus-4-7", tier: "opus", input: r.input ?? 0, cacheCreation: r.cacheCreation ?? 0, cacheRead: r.cacheRead ?? 0, output: r.output ?? 10, thinking: 0, tools: [],
    });
  });
  fs.writeFileSync(path.join(dir, "rows.jsonl"), lines.join("\n") + "\n");
  fs.writeFileSync(path.join(dir, "markers.json"), JSON.stringify(markers));
}
const review = (epic, round) => ({ epic, role: "review", phase: "review", round });
const reviewRows = (rounds, epic = "e1", start = 0) => rounds.map((n, i) => ({ agent: `A${start + i}-${n}`, at: at(start + i + 1), marker: review(epic, n) }));

const guard = (sc, ...args) => invokeEngine(["spend-guard", "e1", ...args], sc.opts);
const guardJson = (sc, ...args) => {
  const r = guard(sc, "--json", ...args);
  return { status: r.status, j: JSON.parse(r.stdout), stderr: r.stderr };
};

function gateway({ main, linked = null, detached = [] }) {
  const rec = (p, b) => `worktree ${p}\0HEAD 0123456789abcdef\0branch refs/heads/${b}\0\0`;
  return {
    ...fakeGit({ noRepository: true }),
    worktreeList: () => rec(main, "main") + (linked ? rec(linked, "wt") : ""),
    headRef: (p) => {
      if (detached.includes(p)) throw Object.assign(new Error("detached"), { status: 1 });
      return Buffer.alloc(0);
    },
  };
}
const withGit = (git, cwd, args, extra = {}) => invokeEngine(args, { cwd, git, ...extra });

// ───────────────────────────── 3.4 tracking off reads nothing ─────────────────────────────

test("3.4 With tracking off, spend-guard opens no path under the spend directory or the transcript directory", () => {
  const sc = scene({ on: false, tokens: 1000 });
  for (const args of [["spend-guard", "e1"], ["spend-guard", "e1", "--json"], ["spend-guard", "missing"]]) {
    const { result, touched } = recordFsPaths(() => withGit(fakeGit({ noRepository: true }), sc.cwd, args, { env: sc.env }));
    assert.ok([0, 1].includes(result.status), `${args.join(" ")}: ${result.stderr}`);
    assert.deepEqual(touchedUnder(touched, spendPath(sc.cwd), sc.cwd + "/.conductor/spend"), [], `${args.join(" ")}: no spend path`);
    assert.deepEqual(touchedUnder(touched, sc.cfg, fs.realpathSync(sc.cfg)), [], `${args.join(" ")}: no transcript path`);
    assert.ok(touched.length > 0, "the recorder saw the verb work, so an empty answer is not vacuous");
  }
  const r = guard(sc);
  assert.match(r.stdout, /tokens: not checked — spend tracking is off; the guard is counting rounds only/);
  assert.match(r.stdout, /ledger review rounds were not read because spend tracking is off/);
});

test("3.4 An unknown epic is refused with exit 1 naming the id, and reads no ledger file", () => {
  const sc = scene({ on: true });
  ledger(sc, reviewRows([1, 2, 3]));
  const { result, touched } = recordFsPaths(() => invokeEngine(["spend-guard", "missing"], sc.opts));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /no epic 'missing'/);
  assert.deepEqual(touchedUnder(touched, spendPath(sc.cwd), sc.cwd + "/.conductor/spend"), []);
});

// ───────────────────────────── 3.4 / 4.2 the ledger side ─────────────────────────────

test("4.2 Unrecorded review rounds trip the guard on the ledger alone, and the report says which side decided", () => {
  const sc = scene({ on: true, limit: 2 });
  ledger(sc, reviewRows([1, 2, 3]));
  const { status, j } = guardJson(sc, "--no-ingest");
  assert.equal(status, 2);
  assert.equal(j.signals.rounds.ledger, 2);
  assert.equal(j.signals.rounds.recorded, 0);
  assert.equal(j.signals.rounds.decidedBy, "ledger");
  assert.equal(j.signals.rounds.state, "tripped");
  assert.equal(j.tracking, "on");
  assert.ok(j.notes.some((n) => /not refreshed.*--no-ingest.*may be stale/.test(n)), JSON.stringify(j.notes));
  assert.match(guard(sc, "--no-ingest").stdout, /^STOP: spend guard — epic e1 is stuck: rounds 2\/2/m);
});

test("4.2 A recorded pass ends the ledger side too: rows after it count from zero", () => {
  const sc = scene({ on: true, limit: 2 });
  run(["record-gate-review", "e1", "--gate", "1", "--verdict", "pass", "--artifact", "openspec/changes/x/proposal.md"], sc.opts);
  const anchor = stateOf(sc.cwd).epics[0].gateRounds.gate1.lastPassAt;
  const before = (m) => new Date(Date.parse(anchor) - m * 60000).toISOString();
  const after = (m) => new Date(Date.parse(anchor) + m * 60000).toISOString();
  ledger(sc, [
    { agent: "B1", at: before(30), marker: review("e1", 1) }, { agent: "B2", at: before(20), marker: review("e1", 2) },
    { agent: "B3", at: before(10), marker: review("e1", 3) }, { agent: "B4", at: after(10), marker: review("e1", 1) },
  ]);
  const { status, j } = guardJson(sc, "--no-ingest");
  assert.equal(status, 0);
  assert.equal(j.signals.rounds.ledger, 0, "only the one row after the pass counts, and one distinct round is 0");
  assert.equal(j.signals.rounds.count, 0);
});

test("4.2 A marker naming an unknown epic or an invalid phase contributes nothing", () => {
  const sc = scene({ on: true, limit: 2 });
  ledger(sc, [
    { agent: "G1", at: at(1), marker: review("ghost", 1) }, { agent: "G2", at: at(2), marker: review("ghost", 2) },
    { agent: "G3", at: at(3), marker: { epic: "e1", role: "review", phase: "gate-1", round: 1 } },
    { agent: "G4", at: at(4), marker: { epic: "e1", role: "review", phase: "gate-1", round: 2 } },
    { agent: "G5", at: at(5), marker: { epic: "e1", role: "review", phase: "review", round: 1 } },
  ]);
  const { status, j } = guardJson(sc, "--no-ingest");
  assert.equal(status, 0);
  assert.equal(j.signals.rounds.ledger, 0);
});

test("3.4 A held ingest lock: the existing ledger is read, may trip, and the report says it did not ingest", () => {
  const sc = scene({ on: true, limit: 2 });
  ledger(sc, reviewRows([1, 2, 3]));
  fs.writeFileSync(spendPath(sc.cwd, "ingest.lock"), "{}");
  // Stamp the mtime from Date.now(): under the CI shifted clock a real-time mtime reads as ancient and the engine breaks it.
  fs.utimesSync(spendPath(sc.cwd, "ingest.lock"), new Date(Date.now()), new Date(Date.now()));
  const r = guard(sc);
  assert.equal(r.status, 2);
  assert.match(r.stdout, /did not ingest|not refreshed \(an ingest was already in progress\); counts may be stale/);
  assert.match(r.stdout, /an ingest was already in progress/);
  assert.match(r.stdout, /ledger 2/);
  assert.match(r.stdout, /STOP: spend guard/);
});

test("3.4 A detached main HEAD: both signals are computed from the existing ledger and it says why it did not ingest", () => {
  const sc = scene({ on: true, limit: 2 });
  ledger(sc, reviewRows([1, 2, 3]));
  const r = withGit(gateway({ main: sc.cwd, detached: [sc.cwd] }), sc.cwd, ["spend-guard", "e1", "--json"], { env: sc.env });
  assert.equal(r.status, 2);
  const j = JSON.parse(r.stdout);
  assert.ok(j.notes.some((n) => /HEAD is detached.*may be stale/.test(n)), JSON.stringify(j.notes));
  assert.equal(j.signals.rounds.ledger, 2);
  assert.equal(fs.existsSync(spendPath(sc.cwd, "cursor.json")), false, "a detached tree writes no ledger file");
});

test("3.4 With ingest on and nothing to read, an existing ledger is left as it was", () => {
  const sc = scene({ on: true, limit: 2 });
  ledger(sc, reviewRows([1, 2, 3]));
  const rows = fs.readFileSync(spendPath(sc.cwd, "rows.jsonl"), "utf8");
  const r = guard(sc, "--json");
  assert.equal(r.status, 2);
  assert.equal(fs.readFileSync(spendPath(sc.cwd, "rows.jsonl"), "utf8"), rows);
  assert.equal(JSON.parse(r.stdout).signals.rounds.ledger, 2);
});

// ───────────────────────────── 3.4 the ledger cannot be read ─────────────────────────────

test("3.4 An unreadable enabledAt: the token signal reads not-read with the remedy, the verb exits 0, never 1", () => {
  const sc = scene({ on: true, limit: 3, tokens: 1000 });
  const s = stateOf(sc.cwd);
  s.spendTracking.enabledAt = "not a date";
  writeState(sc.cwd, s);
  run(["record-gate-review", "e1", "--gate", "1", "--verdict", "fail"], sc.opts);
  const { status, j } = guardJson(sc);
  assert.equal(status, 0);
  assert.equal(j.signals.tokens.state, "not-read");
  assert.match(j.signals.tokens.reason, /set-spend-tracking off.*set-spend-tracking on/);
  assert.equal(j.signals.rounds.ledger, null);
  // and the recorded-verdict check still applies:
  run(["record-gate-review", "e1", "--gate", "1", "--verdict", "fail"], sc.opts);
  run(["record-gate-review", "e1", "--gate", "1", "--verdict", "fail"], sc.opts);
  assert.equal(guardJson(sc).status, 2);
});

test("3.4 From a linked worktree whose main tree's record is unreadable: tracking unknown, ledger not-read, STOP and exit 2", () => {
  const sc = scene({ on: false, limit: 2, tokens: 1000 });
  run(["record-gate-review", "e1", "--gate", "1", "--verdict", "fail"], sc.opts);
  run(["record-gate-review", "e1", "--gate", "1", "--verdict", "fail"], sc.opts);
  const main = realRepo();
  fs.mkdirSync(path.join(main, ".conductor"), { recursive: true });
  fs.writeFileSync(statePath(main), "{ this is not json");
  const git = gateway({ main, linked: sc.cwd });
  const r = withGit(git, sc.cwd, ["spend-guard", "e1", "--json"], { env: sc.env });
  assert.equal(r.status, 2, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.tracking, "unknown");
  assert.equal(j.signals.tokens.state, "not-read");
  assert.equal(j.signals.rounds.ledger, null);
  assert.ok(j.notes.some((n) => n.includes(main) && /state\.json/.test(n) && /unreadable/.test(n)), JSON.stringify(j.notes));
  const text = withGit(git, sc.cwd, ["spend-guard", "e1"], { env: sc.env });
  assert.match(text.stdout, /tracking unknown/);
  assert.doesNotMatch(text.stdout, /tracking off/);
});

test("3.4 From a linked worktree, guard state is the worktree's own and the tracking switch is the main tree's", () => {
  const main = scene({ on: true, limit: null });
  ledger(main, reviewRows([1, 2, 3]));
  const linked = realRepo();
  fs.mkdirSync(path.join(linked, ".conductor"), { recursive: true });
  const s = stateOf(main.cwd);
  s.spendGuard = { maxFailedRounds: 2 };                       // a limit only the worktree's record holds
  fs.writeFileSync(statePath(linked), JSON.stringify(s, null, 2));
  const git = gateway({ main: main.cwd, linked });
  const r = withGit(git, linked, ["spend-guard", "e1", "--json", "--no-ingest"], { env: main.env });
  assert.equal(r.status, 2, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.signals.rounds.limit, 2, "the limit comes from the worktree's state.json");
  assert.equal(j.tracking, "on", "the switch comes from the main tree");
  assert.equal(j.signals.rounds.ledger, 2, "the ledger is the main tree's");
  assert.equal(fs.existsSync(spendPath(linked)), false, "the linked worktree has no ledger of its own");
});

// ───────────────────────────── 4.1 the token signal ─────────────────────────────

function tokenRows(total, unattributed = 0) {
  const rows = [{ agent: "T1", at: at(1), output: total, marker: review("e1", 1) }];
  if (unattributed) rows.push({ agent: "U1", at: at(2), output: unattributed, marker: false });
  return rows;
}

test("4.1 The token signal: OK below the warning share, WARN past it (exit 0), tripped at the ceiling (exit 2)", () => {
  const sc = scene({ on: true, limit: null, tokens: 1000 });
  for (const [total, state, status] of [[700, "ok", 0], [850, "warn", 0], [1000, "tripped", 2]]) {
    ledger(sc, tokenRows(total));
    const { status: got, j } = guardJson(sc, "--no-ingest");
    assert.equal(j.signals.tokens.state, state, `${total} tokens`);
    assert.equal(j.signals.tokens.count, total);
    assert.equal(got, status, `${total} tokens exits ${status}`);
  }
});

test("4.1 Unattributed spend is shown as coverage, not charged to the epic", () => {
  const sc = scene({ on: true, limit: null, tokens: 1000 });
  ledger(sc, tokenRows(600, 400));
  const r = guard(sc, "--no-ingest");
  assert.equal(r.status, 0);
  assert.match(r.stdout, /coverage: 60\.0% of ledger tokens are attributed to an epic; unattributed tokens are not charged/);
  const j = JSON.parse(guard(sc, "--json", "--no-ingest").stdout);
  assert.equal(j.signals.tokens.count, 600);
  assert.equal(j.coverage, 0.6);
});

test("4.1 A tokens override baselines at the attributed total, and the guard trips again after another ceiling", () => {
  const sc = scene({ on: true, limit: null, tokens: 1000 });
  ledger(sc, tokenRows(1000));
  assert.equal(guard(sc, "--no-ingest").status, 2);
  const ov = invokeEngine(["override-spend-guard", "e1", "--signal", "tokens", "--escalated-to", "opus", "--reason", "opus looked"], sc.opts);
  assert.equal(ov.status, 0, ov.stderr);
  assert.equal(stateOf(sc.cwd).epics[0].spendGuardOverrides[0].baseline, 1000);
  assert.equal(guard(sc, "--no-ingest").status, 0);
  ledger(sc, tokenRows(2000));
  assert.equal(guard(sc, "--no-ingest").status, 2);
});

// ───────────────────────── gh-cfdude-pm-251: the token basis, end to end through the verbs ─────────────────────────

/** One marked row of e1 with an explicit class split: `work` = input + cache-write + output, `total` adds cache-read. */
const classRows = ({ input = 0, cacheCreation = 0, cacheRead = 0, output = 0 }) =>
  [{ agent: "B1", at: at(1), input, cacheCreation, cacheRead, output, marker: review("e1", 1) }];
const workScene = (ceiling = 1000) => {
  const sc = scene({ on: true, limit: null, tokens: ceiling });
  const r = invokeEngine(["set-spend-guard", "--token-basis", "work"], sc.opts);
  assert.equal(r.status, 0, r.stderr);
  return sc;
};

test("gh-251 A work-basis guard trips on work tokens and ignores cache-read, through spend-guard", () => {
  const sc = workScene(1000);
  ledger(sc, classRows({ input: 100, cacheCreation: 200, output: 400, cacheRead: 9000 }));
  const below = guardJson(sc, "--no-ingest");
  assert.deepEqual([below.j.signals.tokens.basis, below.j.signals.tokens.count, below.j.signals.tokens.state, below.status], ["work", 700, "ok", 0],
    "9000 cache-read tokens would trip a total basis; the work basis counts 700");
  ledger(sc, classRows({ input: 100, cacheCreation: 300, output: 600, cacheRead: 9000 }));
  const at1000 = guardJson(sc, "--no-ingest");
  assert.deepEqual([at1000.j.signals.tokens.count, at1000.j.signals.tokens.state, at1000.status], [1000, "tripped", 2]);
});

test("gh-251 The text form names the basis, its source and all six counts", () => {
  const sc = workScene(1000);
  ledger(sc, classRows({ input: 100, cacheCreation: 200, output: 400, cacheRead: 9000 }));
  const out = guard(sc, "--no-ingest").stdout;
  assert.match(out, /tokens: ok — 700 work attributed, ceiling 1000 \(project\)/);
  assert.match(out, /basis: work \(project\) · input 100 · cache-write 200 · cache-read 9,000 · output 400 · work 700 · total 9,700/);
});

test("gh-251 A basis change sets the override aside and the text says which basis it was recorded in", () => {
  const sc = scene({ on: true, limit: null, tokens: 1000 });
  ledger(sc, classRows({ input: 100, cacheCreation: 200, output: 400, cacheRead: 9000 }));
  assert.equal(guard(sc, "--no-ingest").status, 2, "tripped on the total basis");
  const ov = invokeEngine(["override-spend-guard", "e1", "--signal", "tokens", "--escalated-to", "opus", "--reason", "x"], sc.opts);
  assert.equal(ov.status, 0, ov.stderr);
  assert.equal(guard(sc, "--no-ingest").status, 0, "the total-basis baseline applies while the basis is unchanged");
  assert.doesNotMatch(guard(sc, "--no-ingest").stdout, /set aside/);
  const sw = invokeEngine(["set-spend-guard", "--token-basis", "work"], sc.opts);
  assert.equal(sw.status, 0, sw.stderr);
  const out = guard(sc, "--no-ingest").stdout;
  assert.match(out, /the latest tokens override is set aside: it was recorded in the total basis and this epic now counts work, so no baseline applies/);
  assert.match(out, /tokens: ok — 700 work attributed/, "no baseline was subtracted from the work count");
});

test("4.1 --no-ingest performs no ingest: a transcript that grew is not read", () => {
  const sc = scene({ on: true, limit: null, tokens: 1000 });
  const proj = path.join(sc.cfg, "projects");
  fs.mkdirSync(proj, { recursive: true });
  const { result, touched } = recordFsPaths(() => invokeEngine(["spend-guard", "e1", "--no-ingest"], sc.opts));
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(touchedUnder(touched, sc.cfg, fs.realpathSync(sc.cfg)), [], "no transcript path was opened");
});

// ───────────────────────────── 5.1 / 5.2 the hot paths ─────────────────────────────

const HOOKS = [
  ["brief", "SessionStart"], ["snapshot", "PreCompact"], ["commit-nudge", "PostToolUse"],
  ["gate-guard", "PreToolUse"], ["lesson-advice", "PreToolUse"],
];
const payload = (event) => JSON.stringify({ hook_event_name: event, tool_name: "Bash", tool_input: { command: "ls" }, session_id: "s1" });

function hotPaths(sc) {
  const out = {};
  for (const [hook, event] of HOOKS) {
    const { result, touched } = recordFsPaths(() => withGit(fakeGit({ noRepository: true }), sc.cwd,
      [hook, "--platform", "claude-code"], { env: sc.env, input: payload(event) }));
    assert.equal(result.status, 0, `${hook} ran: ${result.stderr}`);
    out[hook] = {
      result,
      spend: touchedUnder(touched, spendPath(sc.cwd), sc.cwd + "/.conductor/spend"),
      transcripts: touchedUnder(touched, sc.cfg, fs.realpathSync(sc.cfg)),
      all: touched.length,
    };
  }
  return out;
}

test("5.2 The SessionStart, PreCompact and PreToolUse hooks open no spend or transcript path, with tracking on and a limit set", () => {
  const sc = scene({ on: true, limit: 1, tokens: 1000 });
  run(["record-gate-review", "e1", "--gate", "1", "--verdict", "fail"], sc.opts);
  ledger(sc, reviewRows([1, 2, 3]));
  for (const [hook, s] of Object.entries(hotPaths(sc))) {
    assert.deepEqual(s.spend, [], `${hook}: no ledger file read, written or probed`);
    assert.deepEqual(s.transcripts, [], `${hook}: no transcript opened`);
    assert.ok(s.all > 0, `${hook}: the recorder saw the hook work`);
  }
});

test("5.2 With no limit configured the hooks pay nothing: no spend path, and no guard text in the brief or the PreToolUse output", () => {
  const sc = scene({ on: true, limit: null });
  run(["record-gate-review", "e1", "--gate", "1", "--verdict", "fail"], sc.opts);
  run(["set-active", "e1"], sc.opts);
  const seen = hotPaths(sc);
  for (const [hook, s] of Object.entries(seen)) {
    assert.deepEqual(s.spend, [], `${hook}: no spend path`);
    assert.deepEqual(s.transcripts, [], `${hook}: no transcript path`);
    assert.doesNotMatch(s.result.stdout, /spend guard/i, `${hook}: no guard text`);
  }
});

test("5.2 A stuck active epic puts one STOP line in the brief, from state alone", () => {
  const sc = scene({ on: true, limit: 1 });
  run(["set-active", "e1"], sc.opts);
  run(["record-gate-review", "e1", "--gate", "2", "--verdict", "fail"], sc.opts);
  const seen = hotPaths(sc);
  const ctx = JSON.parse(seen.brief.result.stdout).hookSpecificOutput.additionalContext;
  const lines = ctx.split("\n").filter((l) => l.startsWith("STOP: spend guard —"));
  assert.equal(lines.length, 1, ctx);
  assert.match(lines[0], /e1 rounds 1\/1/);
  assert.ok(lines[0].includes("`spend-guard e1`"));
  assert.doesNotMatch(seen["gate-guard"].result.stdout, /spend guard/i, "the PreToolUse hook does no guard work");
});

test("5.1 record-gate-review prints the STOP after the success line when the verdict reaches the limit, exits 0, and reads no ledger", () => {
  const sc = scene({ on: true, limit: 2, tokens: 1000 });
  ledger(sc, reviewRows([1, 2, 3, 4]));
  const first = invokeEngine(["record-gate-review", "e1", "--gate", "1", "--verdict", "fail"], sc.opts);
  assert.equal(first.status, 0);
  assert.doesNotMatch(first.stderr, /STOP: spend guard/);
  const { result, touched } = recordFsPaths(() => invokeEngine(["record-gate-review", "e1", "--gate", "1", "--verdict", "fail"], sc.opts));
  assert.equal(result.status, 0, "the verdict write succeeded, so the exit is 0");
  assert.ok(result.stderr.indexOf("recorded gate 1 review") !== -1 && result.stderr.indexOf("recorded gate 1 review") < result.stderr.indexOf("STOP: spend guard"),
    "the STOP follows the success line");
  assert.match(result.stderr, /epic e1 is stuck: rounds 2\/2/);
  assert.equal(stateOf(sc.cwd).epics[0].gateReview.gate1.verdict, "fail", "the verdict was recorded");
  assert.deepEqual(touchedUnder(touched, spendPath(sc.cwd), sc.cwd + "/.conductor/spend"), []);
  assert.deepEqual(touchedUnder(touched, sc.cfg, fs.realpathSync(sc.cfg)), []);
  const healed = invokeEngine(["record-gate-review", "e1", "--gate", "1", "--verdict", "pass", "--artifact", "a.md"], sc.opts);
  assert.equal(healed.status, 0);
  assert.doesNotMatch(healed.stderr, /STOP: spend guard/, "a pass clears the recorded part");
});

// ───────────────────────────── 5.3 CLAUDE.md ─────────────────────────────

test("5.3 CLAUDE.md gains the Spend guard section on the first limit and loses it with the last", () => {
  const cwd = realRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "e1", "--title", "E1", "--lane", "claude-code"], { cwd });
  assert.doesNotMatch(claudeMd(cwd), /## Spend guard/);
  run(["set-spend-guard", "--warn-at", "50"], { cwd });
  assert.doesNotMatch(claudeMd(cwd), /## Spend guard/, "a warnAt alone is not a limit");
  run(["set-spend-guard", "--max-failed-rounds", "2"], { cwd });
  const md = claudeMd(cwd);
  assert.match(md, /## Spend guard/);
  assert.ok(md.includes("`spend-guard <epic>`"));
  assert.ok(md.indexOf("## Spend guard") > md.indexOf("Current mode:") && md.indexOf("## Spend guard") < md.indexOf("## Release candidate"),
    "with tracking off it takes the Spend tracking slot's position");
  run(["set-spend-guard", "--unset", "max-failed-rounds"], { cwd });
  assert.doesNotMatch(claudeMd(cwd), /## Spend guard/, "unsetting the last limit removes the section");
});

test("5.3 With tracking on the section follows ## Spend tracking, and an archived epic's layer does not count", () => {
  const cwd = realRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "e1", "--title", "E1", "--lane", "claude-code"], { cwd });
  run(["set-spend-tracking", "on"], { cwd });
  run(["set-spend-guard", "--epic", "e1", "--tokens", "5000"], { cwd });
  const md = claudeMd(cwd);
  assert.ok(md.indexOf("## Spend tracking") !== -1 && md.indexOf("## Spend guard") > md.indexOf("## Spend tracking"));
  assert.ok(md.indexOf("## Spend guard") < md.indexOf("## Release candidate"));
  run(["update-epic", "e1", "--status", "archived", "--outcome", "delivered", "--no-deferrals"], { cwd });
  run(["write-rules"], { cwd });
  assert.doesNotMatch(claudeMd(cwd), /## Spend guard/, "an archived epic's layer is not a configured limit");
});

test("5.3 A lane layer counts, and the section is the same text whichever layer set it", () => {
  const cwd = realRepo();
  run(["init"], { cwd });
  run(["set-spend-guard", "--lane", "openspec", "--tokens", "2000000"], { cwd });
  const md = claudeMd(cwd);
  assert.match(md, /## Spend guard/);
  assert.match(md, /No\s+autonomy grant covers `override-spend-guard`/);
  assert.ok(md.includes("`pm-spend: epic=<id> role=review phase=review round=<n>`"));
});
