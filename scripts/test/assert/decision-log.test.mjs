// scripts/test/assert/decision-log.test.mjs
// decision-cost-log 2.1 -- the FILE rung: `decisions` and the analysis's Decisions section over a real ingest of
// the synthetic transcript tree, and tracking off opening no spend or transcript path.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, invokeEngine, writeState } from "../fixtures/assert-harness.mjs";
import { recordFsPaths, touchedUnder } from "../fixtures/fs-path-recorder.mjs";
import { EXPECTED, buildTranscriptTree, walk } from "../fixtures/spend-transcripts.mjs";

const FRESH = new Date("2026-10-09T12:00:00.000Z");
const ENABLED_AT = "2026-10-01T00:00:00.000Z";
const realRepo = () => fs.realpathSync(tmpRepo());
const spendPath = (cwd, ...p) => path.join(cwd, ".conductor", "spend", ...p);
const statePath = (cwd) => path.join(cwd, ".conductor", "state.json");
const ALL = EXPECTED.main.total + EXPECTED.marked.total + EXPECTED.worktreeMarked.total;

function scene() {
  const cwd = realRepo();
  const cfg = realRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "e1", "--title", "E1", "--lane", "claude-code"], { cwd });
  buildTranscriptTree(cfg, cwd);
  for (const f of walk(cfg)) fs.utimesSync(path.join(cfg, f), FRESH, FRESH);
  run(["set-spend-tracking", "on"], { cwd });
  const s = JSON.parse(fs.readFileSync(statePath(cwd), "utf8"));
  s.spendTracking.enabledAt = ENABLED_AT;
  writeState(cwd, s);
  fs.writeFileSync(spendPath(cwd, "timeline.jsonl"), JSON.stringify({ at: "2026-10-09T09:00:00.000Z", tracking: "on", active: "e1" }) + "\n");
  const env = { CLAUDE_CONFIG_DIR: cfg, HOME: "/no/such/home" };
  const opts = { cwd, env };
  run(["record-decision", "e1", "--what", "split the build", "--why", "one agent ran long", "--since", "2026-10-09T00:00:00Z", "--phase", "build"], opts);
  return { cwd, cfg, env, opts };
}
const decisions = (sc, args = []) => invokeEngine(["decisions", "e1", ...args], { cwd: sc.cwd, env: sc.env });

test("2.1 decisions ingests as spend does and costs the decision from the ledger: work and total in its window", () => {
  const sc = scene();
  const r = decisions(sc, ["--json"]);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.epic, "e1");
  const [d] = out.decisions;
  assert.equal(d.what, "split the build");
  assert.equal(d.cost.computed, true);
  assert.equal(d.cost.total, ALL);
  assert.ok(d.cost.work > 0 && d.cost.work < d.cost.total);
  assert.ok(d.cost.coverage > 0 && d.cost.coverage <= 1);
  assert.match(decisions(sc, ["--no-ingest"]).stdout, /not spend caused by the decision alone/);
});

test("2.1 the cost is never stored: state.json is byte-identical across `decisions`, and holds no cost", () => {
  const sc = scene();
  const before = fs.readFileSync(statePath(sc.cwd));
  decisions(sc);
  assert.deepEqual(Buffer.compare(before, fs.readFileSync(statePath(sc.cwd))), 0);
  assert.doesNotMatch(before.toString(), /"cost"|"work"/);
});

test("2.1 a decision window before the first message costs nothing; a re-run after the window widens would include them", () => {
  const sc = scene();
  run(["record-decision", "e1", "--what", "early", "--why", "y", "--since", "2026-09-01T00:00:00Z", "--until", "2026-09-02T00:00:00Z"], sc.opts);
  const out = JSON.parse(decisions(sc, ["--json", "--no-ingest"]).stdout);
  assert.equal(out.decisions[1].cost.total, 0);
  assert.equal(out.decisions[1].cost.coverage, null);
});

test("2.1 tracking off: decisions are listed as not computed and no spend or transcript path is opened", () => {
  const sc = scene();
  run(["set-spend-tracking", "off"], sc.opts);
  const { result, touched } = recordFsPaths(() => decisions(sc));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /cost: not computed — spend tracking is off/);
  assert.deepEqual(touchedUnder(touched, spendPath(sc.cwd), sc.cfg), []);
  const wd = recordFsPaths(() => invokeEngine(["record-decision", "e1", "--withdraw", "1", "--reason", "gone"], { cwd: sc.cwd, env: sc.env }));
  assert.equal(wd.result.status, 0, wd.result.stderr);
  assert.deepEqual(touchedUnder(wd.touched, spendPath(sc.cwd), sc.cfg), [], "a withdrawal reads no ledger");
  assert.match(decisions(sc).stdout, /decision 1 \(withdrawn/);
});

test("2.2 spend-analysis --epic carries the same Decisions section, text and JSON", () => {
  const sc = scene();
  const r = invokeEngine(["spend-analysis", "--epic", "e1", "--json"], { cwd: sc.cwd, env: sc.env });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.decisions.length, 1);
  assert.equal(out.decisions[0].cost.total, ALL);
  const text = invokeEngine(["spend-analysis", "--epic", "e1", "--no-ingest"], { cwd: sc.cwd, env: sc.env }).stdout;
  assert.match(text, /Decisions \(1\):/);
  assert.match(text, /decision 1: split the build/);
  const none = invokeEngine(["spend-analysis", "--no-ingest"], { cwd: sc.cwd, env: sc.env });
  assert.doesNotMatch(none.stdout, /Decisions \(/);
});

test("2.2 with tracking off spend-analysis --epic lists the decisions as not computed, and opens no spend path", () => {
  const sc = scene();
  run(["set-spend-tracking", "off"], sc.opts);
  const { result, touched } = recordFsPaths(() => invokeEngine(["spend-analysis", "--epic", "e1"], { cwd: sc.cwd, env: sc.env }));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /decision 1: split the build/);
  assert.match(result.stdout, /cost: not computed — spend tracking is off/);
  assert.deepEqual(touchedUnder(touched, spendPath(sc.cwd), sc.cfg), []);
});

test("1.1 a decision survives `spend --clear --yes`: the record is on the epic, only the cost came from the ledger", () => {
  const sc = scene();
  decisions(sc);
  const cleared = invokeEngine(["spend", "--clear", "--yes"], { cwd: sc.cwd, env: sc.env });
  assert.equal(cleared.status, 0, cleared.stderr);
  const out = JSON.parse(decisions(sc, ["--json", "--no-ingest"]).stdout);
  assert.equal(out.decisions.length, 1);
  assert.equal(out.decisions[0].cost.total, 0);
});
