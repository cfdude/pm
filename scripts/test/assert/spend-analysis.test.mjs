// scripts/test/assert/spend-analysis.test.mjs
// token-spend-analysis-and-recommendations 1.1 -- the FILE rung of the verb: the analysis over the synthetic
// transcript tree under a temp CLAUDE_CONFIG_DIR, state.json byte-identical, and tracking off opening no spend
// or transcript path.

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

function scene({ on = true } = {}) {
  const cwd = realRepo();
  const cfg = realRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "e1", "--title", "E1", "--lane", "claude-code"], { cwd });
  buildTranscriptTree(cfg, cwd);
  for (const f of walk(cfg)) fs.utimesSync(path.join(cfg, f), FRESH, FRESH);
  if (on) {
    run(["set-spend-tracking", "on"], { cwd });
    const s = JSON.parse(fs.readFileSync(statePath(cwd), "utf8"));
    s.spendTracking.enabledAt = ENABLED_AT;
    writeState(cwd, s);
    fs.writeFileSync(spendPath(cwd, "timeline.jsonl"), JSON.stringify({ at: "2026-10-09T09:00:00.000Z", tracking: "on", active: "e1" }) + "\n");
  }
  return { cwd, cfg, env: { CLAUDE_CONFIG_DIR: cfg, HOME: "/no/such/home" } };
}
const analysis = (sc, args = []) => invokeEngine(["spend-analysis", ...args], { cwd: sc.cwd, env: sc.env });

test("1.1 spend-analysis ingests as spend does, then analyses the attributed ledger and writes no state", () => {
  const sc = scene();
  const before = fs.readFileSync(statePath(sc.cwd));
  const r = analysis(sc, ["--json", "--epic", "e1"]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(Buffer.compare(before, fs.readFileSync(statePath(sc.cwd))), 0, "state.json is byte-identical");
  const out = JSON.parse(r.stdout);
  assert.deepEqual(Object.keys(out).sort(), ["agents", "breakdown", "coverage", "cost", "flags", "ingest", "scope", "tools", "tracking", "trend", "unattributed"].sort());
  assert.equal(out.breakdown.totals.total, EXPECTED.main.total + EXPECTED.marked.total + EXPECTED.worktreeMarked.total);
  assert.deepEqual(out.agents.map((a) => [a.agentId, a.messages]), [["MARKED", 3]], "the marked sub-agent and its worktree session share one agent id");
  assert.ok(out.tools.byTool.some((t) => t.tool === "Bash" && t.count >= 1), "tool names come from the stored rows");
  assert.equal(out.cost.computed, false);
  const text = analysis(sc, ["--no-ingest"]).stdout;
  assert.match(text, /spend-analysis — the whole ledger/);
  assert.match(text, /tokens are not apportioned to tools/);
});

test("1.1 --no-ingest opens no transcript path", () => {
  const sc = scene();
  analysis(sc);
  fs.rmSync(sc.cfg, { recursive: true, force: true });
  const { result, touched } = recordFsPaths(() => analysis(sc, ["--no-ingest", "--json"]));
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(touchedUnder(touched, sc.cfg, path.join(sc.cfg, "projects")), []);
});

test("1.1 tracking off says so, names set-spend-tracking on, and opens no path under the spend directory or the transcripts", () => {
  const sc = scene({ on: false });
  fs.mkdirSync(spendPath(sc.cwd), { recursive: true });
  const { result, touched } = recordFsPaths(() => analysis(sc));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /spend tracking is off[\s\S]*set-spend-tracking on/);
  assert.deepEqual(touchedUnder(touched, spendPath(sc.cwd), sc.cfg), []);
});

test("1.1 tracking just turned on with an empty ledger: --no-ingest exits 0 saying there are no rows", () => {
  const sc = scene();
  const r = analysis(sc, ["--no-ingest"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /the ledger holds no rows to analyse/);
});

test("1.1 a refused scope ingests nothing: no ledger file appears", () => {
  const sc = scene();
  for (const args of [["--epic", "nope"], ["--release", "nope"], ["--epic", "e1", "--release", "r"]]) {
    const r = analysis(sc, args);
    assert.notEqual(r.status, 0, args.join(" "));
  }
  assert.deepEqual(walk(spendPath(sc.cwd)).filter((f) => f !== "timeline.jsonl"), []);
});
