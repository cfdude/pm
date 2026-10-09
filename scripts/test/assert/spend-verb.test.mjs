// scripts/test/assert/spend-verb.test.mjs
// token-spend-tracking-per-epic, group 4 (4.2, 4.3, 3.5's `spend` half) — the `spend` verb end to end
// over the synthetic transcript tree, and the inverse of every ledger write. FILE rung: bytes on disk.
// Linked-worktree and detached scenarios use a hand-written git gateway (this half runs no real git).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, invokeEngine, expectFail, writeState } from "../fixtures/assert-harness.mjs";
import { fakeGit } from "../fixtures/fake-git.mjs";
import { EXPECTED, buildTranscriptTree, walk } from "../fixtures/spend-transcripts.mjs";

const FRESH = new Date("2026-10-09T12:00:00.000Z");
const ENABLED_AT = "2026-10-01T00:00:00.000Z";
/** A scratch directory spelled as the OS spells it for real (see spend-timeline.test.mjs). */
const realRepo = () => fs.realpathSync(tmpRepo());
const spendPath = (cwd, ...p) => path.join(cwd, ".conductor", "spend", ...p);
const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const stateOf = (cwd) => readJson(path.join(cwd, ".conductor", "state.json"));
const ledgerFiles = (cwd) => walk(spendPath(cwd)).filter((f) => f !== "ingest.lock");
const ledgerBytes = (cwd) => Object.fromEntries(ledgerFiles(cwd).map((f) => [f, fs.readFileSync(spendPath(cwd, f), "utf8")]));

/** A repo with tracking on from ENABLED_AT, a timeline putting e1 active before every fixture message,
 *  and the fixture transcript tree. `env` is what to pass to every call. */
function scene({ on = true } = {}) {
  const cwd = realRepo();
  const cfg = realRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "e1", "--title", "E1", "--lane", "claude-code"], { cwd });
  const paths = buildTranscriptTree(cfg, cwd);
  for (const f of walk(cfg)) fs.utimesSync(path.join(cfg, f), FRESH, FRESH);
  if (on) {
    run(["set-spend-tracking", "on"], { cwd });
    const s = stateOf(cwd);
    s.spendTracking.enabledAt = ENABLED_AT;
    writeState(cwd, s);
    fs.writeFileSync(spendPath(cwd, "timeline.jsonl"),
      JSON.stringify({ at: "2026-10-09T09:00:00.000Z", tracking: "on", active: "e1" }) + "\n");
  }
  const env = { CLAUDE_CONFIG_DIR: cfg, HOME: "/no/such/home" };
  return { cwd, cfg, paths, env, opts: { cwd, env } };
}
const json = (sc, ...args) => JSON.parse(run(["spend", "--json", ...args], sc.opts));

/** A gateway describing a main tree and (optionally) one linked worktree; `detached` lists trees. */
function gateway({ main, linked = null, detached = [] }) {
  const rec = (p, b) => `worktree ${p}\0HEAD 0123456789abcdef\0branch refs/heads/${b}\0\0`;
  return {
    ...fakeGit({ noRepository: true }),
    worktreeList: () => rec(main, "main") + (linked ? rec(linked, "wt") : ""),
    headRef: (at) => {
      if (detached.includes(at)) throw Object.assign(new Error("detached"), { status: 1 });
      return Buffer.alloc(0);
    },
  };
}

// ───────────────────────────── 4.2 ingest, then report ─────────────────────────────

test("4.2 spend ingests, then reports per-epic totals: the orchestrator, a marked sub-agent and its worktree session", () => {
  const sc = scene();
  const r = json(sc);
  assert.deepEqual(Object.keys(r).sort(), ["cost", "coverage", "epics", "ingest", "tracking", "unattributed"]);
  const e1 = r.epics.e1;
  assert.equal(e1.totals.total, EXPECTED.main.total + EXPECTED.marked.total + EXPECTED.worktreeMarked.total);
  assert.equal(e1.byActor.orchestrator.total, EXPECTED.main.total);
  assert.equal(e1.byActor.subagent.total, EXPECTED.marked.total + EXPECTED.worktreeMarked.total);
  assert.equal(e1.byRole.review.total, EXPECTED.marked.total + EXPECTED.worktreeMarked.total);
  assert.equal(e1.byRound["2"].total, EXPECTED.marked.total + EXPECTED.worktreeMarked.total);
  assert.deepEqual(Object.keys(e1.agents), ["MARKED"], "the worktree session folds into its agent");
  assert.deepEqual([e1.agents.MARKED.role, e1.agents.MARKED.phase, e1.agents.MARKED.round], ["review", "review", 2]);
  assert.equal(e1.byTier.opus.total, e1.totals.total);
  assert.equal(r.unattributed.totals.total, EXPECTED.unmarked.total + EXPECTED.worktreeOrphan.total);
  assert.equal(r.unattributed.byReason["unmarked-subagent"].total, r.unattributed.totals.total);
  assert.equal(r.coverage.total, EXPECTED.all);
  assert.equal(r.tracking.enabled, true);
  assert.equal(r.ingest.ran, true);
  assert.equal(r.cost.computed, false);
});

test("4.2 the text report names the transcript directory it read, the unattributed line, coverage and the cost line", () => {
  const sc = scene();
  const out = run(["spend"], sc.opts);
  assert.ok(out.includes(path.join(sc.cfg, "projects")), "names the transcript directory it read");
  assert.match(out, /epic e1: 1,624 tokens/);
  assert.match(out, /unattributed: 46 tokens/);
  assert.match(out, /coverage: 97\.2% of 1,670 tokens attributed to an epic/);
  assert.match(out, /cost: not computed — tokens are the measure/);
});

test("4.2 --no-ingest reports from the existing ledger and reads no transcript", () => {
  const sc = scene();
  run(["spend", "--no-ingest"], sc.opts);
  assert.equal(fs.existsSync(spendPath(sc.cwd, "rows.jsonl")), false, "nothing was ingested");
  json(sc);                                                  // now ingest
  const before = ledgerBytes(sc.cwd);
  fs.appendFileSync(sc.paths.main, JSON.stringify({
    type: "assistant", timestamp: "2026-10-09T10:09:00.000Z",
    message: { id: "grown", model: "claude-opus-4-7", content: [], usage: { input_tokens: 1, output_tokens: 1 } },
  }) + "\n");
  const r = json(sc, "--no-ingest");
  assert.equal(r.ingest.ran, false);
  assert.deepEqual(ledgerBytes(sc.cwd), before);
  assert.equal(r.coverage.total, EXPECTED.all);
  assert.equal(json(sc).coverage.total, EXPECTED.all + 2, "the next ingesting run sees the growth");
});

test("4.2 spend while off reports without ingesting, and says tracking is off and totals are as of the last ingest", () => {
  const sc = scene();
  json(sc);
  const before = ledgerBytes(sc.cwd);
  run(["set-spend-tracking", "off"], sc.opts);
  const afterOff = ledgerBytes(sc.cwd);
  fs.appendFileSync(sc.paths.main, JSON.stringify({
    type: "assistant", timestamp: "2026-10-09T10:09:00.000Z",
    message: { id: "grown", model: "claude-opus-4-7", content: [], usage: { input_tokens: 9, output_tokens: 9 } },
  }) + "\n");
  const out = run(["spend"], sc.opts);
  assert.match(out, /tracking OFF/);
  assert.match(out, /tracking is off: no transcript was read; totals are as of the last ingest/);
  assert.deepEqual(ledgerBytes(sc.cwd), afterOff, "no row, cursor or marker was added");
  assert.deepEqual(Object.fromEntries(Object.entries(afterOff).filter(([k]) => k !== "timeline.jsonl")),
    Object.fromEntries(Object.entries(before).filter(([k]) => k !== "timeline.jsonl")));
});

test("4.2 Spend made while tracking was off is reported as tracking-off, not credited to an epic", () => {
  const sc = scene();
  fs.writeFileSync(spendPath(sc.cwd, "timeline.jsonl"), [
    { at: "2026-10-09T09:00:00.000Z", tracking: "on", active: "e1" },
    { at: "2026-10-09T10:00:03.500Z", tracking: "off" },
    { at: "2026-10-09T10:00:30.000Z", tracking: "on", active: "e1" },
  ].map((e) => JSON.stringify(e)).join("\n") + "\n");
  const r = json(sc);
  assert.ok(r.unattributed.byReason["tracking-off"].total > 0);
  // m1 (seconds 1-3) is before the off entry; m2/m3 (4-7) fall inside the off interval, and so does
  // the marked sub-agent's activity (seconds 11-12)... which ends before 10:00:30 resumes tracking.
  assert.ok(r.epics.e1.totals.total < EXPECTED.all - EXPECTED.unmarked.total - EXPECTED.worktreeOrphan.total);
});

test("4.2 An unknown epic is refused, naming the id, and nothing is ingested", () => {
  const sc = scene();
  const err = expectFail(() => run(["spend", "--epic", "nope"], sc.opts));
  assert.match(err.stderr, /nope/);
  assert.equal(fs.existsSync(spendPath(sc.cwd, "rows.jsonl")), false, "it ingested nothing");
});

test("4.2 Filtering by epic and window: --epic, --since and --until (half-open) narrow the sum", () => {
  const sc = scene();
  const all = json(sc, "--epic", "e1");
  const mid = json(sc, "--epic", "e1", "--no-ingest", "--since", "2026-10-09T10:00:05Z", "--until", "2026-10-09T10:00:11Z");
  assert.ok(mid.epics.e1.totals.total > 0 && mid.epics.e1.totals.total < all.epics.e1.totals.total);
  // m2 is stamped second 5 (included at --since), the sub-agent's s1 at second 11 (excluded at --until)
  assert.equal(mid.epics.e1.agents.MARKED, undefined);
  expectFail(() => run(["spend", "--since", "not-a-date"], sc.opts));
});

test("4.2 The config directory override is honoured: with HOME pointing nowhere, the fixture is still read", () => {
  const sc = scene();
  const r = json(sc);
  assert.equal(r.coverage.total, EXPECTED.all);
  assert.ok(r.ingest.projectDir.startsWith(path.join(sc.cfg, "projects")));
});

test("4.2 No transcript directory is not an error: exit 0, no row, the directory it looked for is named", () => {
  const sc = scene();
  const empty = realRepo();
  const out = run(["spend"], { cwd: sc.cwd, env: { CLAUDE_CONFIG_DIR: empty, HOME: "/no/such/home" } });
  assert.match(out, /NOT FOUND/);
  assert.ok(out.includes(path.join(empty, "projects")));
  assert.equal(fs.existsSync(spendPath(sc.cwd, "rows.jsonl")), false);
});

test("4.2 spend never writes state.json and never modifies a transcript", () => {
  const sc = scene();
  const stateBefore = fs.readFileSync(path.join(sc.cwd, ".conductor", "state.json"), "utf8");
  const snap = () => Object.fromEntries(walk(sc.cfg).map((f) => [f, fs.statSync(path.join(sc.cfg, f)).mtimeMs + ":" + fs.readFileSync(path.join(sc.cfg, f), "utf8")]));
  const before = snap();
  run(["spend"], sc.opts);
  run(["spend"], sc.opts);
  assert.equal(fs.readFileSync(path.join(sc.cwd, ".conductor", "state.json"), "utf8"), stateBefore);
  assert.deepEqual(snap(), before);
});

test("4.2 spend --help lists exactly the declared flags", () => {
  const out = run(["spend", "--help"], { cwd: tmpRepo() });
  for (const flag of ["--epic", "--since", "--until", "--json", "--no-ingest", "--clear", "--rebuild", "--timeline", "--yes"]) {
    assert.ok(out.includes(flag), `help names ${flag}`);
  }
  assert.doesNotMatch(out, /--bogus/);
});

// ───────────────────────────── linked and detached trees ─────────────────────────────

/** A linked worktree whose state.json is the main tree's as of NOW (so it predates e9). */
function linkedOf(main) {
  const linked = realRepo();
  fs.mkdirSync(path.join(linked, ".conductor"), { recursive: true });
  fs.copyFileSync(path.join(main, ".conductor", "state.json"), path.join(linked, ".conductor", "state.json"));
  return linked;
}

test("4.2 spend in a linked worktree reads the main tree's state and writes the main tree's ledger", () => {
  const sc = scene();
  const linked = linkedOf(sc.cwd);
  run(["add-epic", "--id", "e9", "--title", "E9", "--lane", "claude-code"], { cwd: sc.cwd });   // after the branch
  assert.equal(stateOf(linked).epics.some((e) => e.id === "e9"), false);
  const git = gateway({ main: sc.cwd, linked });
  const fromMain = JSON.parse(invokeEngine(["spend", "--json", "--epic", "e9"], { cwd: sc.cwd, env: sc.env, git }).stdout);
  const r = invokeEngine(["spend", "--json", "--epic", "e9"], { cwd: linked, env: sc.env, git });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).epics, fromMain.epics);
  assert.equal(JSON.parse(r.stdout).tracking.enabledAt, ENABLED_AT, "the switch and enabledAt come from the main tree");
  assert.equal(fs.existsSync(spendPath(linked)), false, "the linked worktree has no ledger of its own");
  assert.ok(fs.existsSync(spendPath(sc.cwd, "rows.jsonl")));
});

test("4.2 A linked worktree reads the same transcripts as the main tree: the encoded path is the main tree's", () => {
  const sc = scene();
  const linked = linkedOf(sc.cwd);
  const git = gateway({ main: sc.cwd, linked });
  const r = JSON.parse(invokeEngine(["spend", "--json"], { cwd: linked, env: sc.env, git }).stdout);
  assert.equal(r.coverage.total, EXPECTED.all);
});

test("3.5 Spend data is not written in a detached tree: spend reports what exists and says it did not ingest", () => {
  const sc = scene();
  const before = walk(spendPath(sc.cwd));
  const git = gateway({ main: sc.cwd, detached: [sc.cwd] });
  const r = invokeEngine(["spend"], { cwd: sc.cwd, env: sc.env, git });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /did not ingest because the main working tree's HEAD is detached/);
  assert.deepEqual(walk(spendPath(sc.cwd)), before, "no file under .conductor/spend/ was created");
  const ok = invokeEngine(["spend", "--json"], { cwd: sc.cwd, env: sc.env, git: gateway({ main: sc.cwd }) });
  assert.equal(JSON.parse(ok.stdout).ingest.ran, true, "the control: on a branch it ingests");
});

test("3.5 A detached linked worktree does not stop ingest: the main tree is on a branch", () => {
  const sc = scene();
  const linked = linkedOf(sc.cwd);
  const git = gateway({ main: sc.cwd, linked, detached: [linked] });
  const r = invokeEngine(["spend", "--json"], { cwd: linked, env: sc.env, git });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).ingest.ran, true);
  assert.ok(fs.existsSync(spendPath(sc.cwd, "rows.jsonl")));
});

test("3.5 --clear and --rebuild are refused in a detached main tree, changing nothing", () => {
  const sc = scene();
  json(sc);
  const before = ledgerBytes(sc.cwd);
  const git = gateway({ main: sc.cwd, detached: [sc.cwd] });
  for (const flag of ["--clear", "--rebuild"]) {
    const r = invokeEngine(["spend", flag, "--yes"], { cwd: sc.cwd, env: sc.env, git });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /detached/);
  }
  assert.deepEqual(ledgerBytes(sc.cwd), before);
});

// ───────────────────────────── 4.3 the inverses ─────────────────────────────

test("4.3 Clear without --yes prints the files it would remove and changes nothing", () => {
  const sc = scene();
  json(sc);
  const before = ledgerBytes(sc.cwd);
  const out = run(["spend", "--clear"], sc.opts);
  assert.match(out, /would remove/);
  for (const f of ["rows.jsonl", "cursor.json", "markers.json"]) assert.ok(out.includes(f), f);
  assert.match(out, /kept: timeline\.jsonl/);
  assert.match(out, /Nothing was changed/);
  assert.deepEqual(ledgerBytes(sc.cwd), before);
});

test("4.3 Clear keeps the timeline unless asked: rows, cursor and markers are gone after --clear --yes", () => {
  const sc = scene();
  json(sc);
  const timeline = fs.readFileSync(spendPath(sc.cwd, "timeline.jsonl"), "utf8");
  run(["spend", "--clear", "--yes"], sc.opts);
  assert.deepEqual(ledgerFiles(sc.cwd), ["timeline.jsonl"]);
  assert.equal(fs.readFileSync(spendPath(sc.cwd, "timeline.jsonl"), "utf8"), timeline);
});

test("4.3 Clearing the timeline says what it forgets, and only --yes removes it", () => {
  const sc = scene();
  json(sc);
  const plan = run(["spend", "--clear", "--timeline"], sc.opts);
  assert.match(plan, /off intervals and the active-epic windows are LOST/);
  assert.match(plan, /credited to epics by marker after a re-ingest/);
  assert.ok(fs.existsSync(spendPath(sc.cwd, "timeline.jsonl")));
  run(["spend", "--clear", "--timeline", "--yes"], sc.opts);
  assert.deepEqual(ledgerFiles(sc.cwd), []);
});

test("4.3 After a clear, the next ingest re-derives the same totals from the transcripts", () => {
  const sc = scene();
  const first = json(sc);
  run(["spend", "--clear", "--yes"], sc.opts);
  assert.deepEqual(json(sc).epics, first.epics);
});

test("4.3 Rebuild reproduces the same totals when no transcript has changed", () => {
  const sc = scene();
  const first = json(sc);
  const out = run(["spend", "--rebuild", "--yes"], sc.opts);
  assert.match(out, /re-derived/);
  assert.deepEqual(json(sc, "--no-ingest").epics, first.epics);
  assert.equal(json(sc, "--no-ingest").coverage.total, first.coverage.total);
});

test("4.3 Rebuild without --yes prints its plan and changes nothing", () => {
  const sc = scene();
  json(sc);
  const before = ledgerBytes(sc.cwd);
  const out = run(["spend", "--rebuild"], sc.opts);
  assert.match(out, /would re-derive/);
  assert.match(out, /Nothing was changed/);
  assert.deepEqual(ledgerBytes(sc.cwd), before);
});

test("4.3 Rebuild keeps what it cannot re-derive: rows whose transcript is gone stay, and the plan counts them", () => {
  const sc = scene();
  json(sc);
  fs.rmSync(sc.paths.unmarked);                             // Claude Code pruned this transcript
  fs.rmSync(sc.paths.unmarkedMeta);
  const plan = run(["spend", "--rebuild"], sc.opts);
  assert.match(plan, /kept: the timeline, and 1 message\(s\) whose transcript is no longer on disk/);
  const out = run(["spend", "--rebuild", "--yes"], sc.opts);
  assert.match(out, /1 kept because their transcript is gone/);
  const r = json(sc, "--no-ingest");
  assert.equal(r.coverage.total, EXPECTED.all, "the pruned transcript's tokens are still in the ledger");
  assert.equal(r.unattributed.totals.total, EXPECTED.unmarked.total + EXPECTED.worktreeOrphan.total);
});

test("4.3 Rebuild while off is refused: it reads no transcript and changes nothing", () => {
  const sc = scene();
  json(sc);
  run(["set-spend-tracking", "off"], sc.opts);
  const before = ledgerBytes(sc.cwd);
  const err = expectFail(() => run(["spend", "--rebuild", "--yes"], sc.opts));
  assert.match(err.stderr, /refused while tracking is off/);
  assert.deepEqual(ledgerBytes(sc.cwd), before);
});

test("4.3 Conflicting operations are refused and change nothing", () => {
  const sc = scene();
  json(sc);
  const before = ledgerBytes(sc.cwd);
  expectFail(() => run(["spend", "--clear", "--rebuild"], sc.opts));
  expectFail(() => run(["spend", "--clear", "--rebuild", "--yes"], sc.opts));
  expectFail(() => run(["spend", "--timeline", "--yes"], sc.opts));
  expectFail(() => run(["spend", "--yes"], sc.opts));
  expectFail(() => run(["spend", "--clear", "--epic", "e1", "--yes"], sc.opts));
  assert.deepEqual(ledgerBytes(sc.cwd), before);
});

test("4.3 --clear and --rebuild refuse while an ingest holds the lock, and change nothing", () => {
  const sc = scene();
  json(sc);
  const before = ledgerBytes(sc.cwd);
  fs.writeFileSync(spendPath(sc.cwd, "ingest.lock"), "{}");
  expectFail(() => run(["spend", "--clear", "--yes"], sc.opts));
  expectFail(() => run(["spend", "--rebuild", "--yes"], sc.opts));
  assert.deepEqual(ledgerBytes(sc.cwd), before);
  const busy = JSON.parse(run(["spend", "--json"], sc.opts));
  assert.deepEqual([busy.ingest.ran, busy.ingest.busy], [false, true], "spend reports from the existing ledger, saying an ingest was in progress");
  assert.match(busy.ingest.reason, /ingest was already in progress/);
});
