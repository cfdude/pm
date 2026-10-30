// scripts/test/unit/overhead-pair.test.mjs
// pm-overhead-calibration-and-feature-switches B4 -- the MOCKED TWIN of the reduced calibration pair. UNIT
// rung: the pure parts plus the whole orchestration over an INJECTED runner. The REAL run (it spawns
// `claude` and spends model tokens) is scripts/measure/overhead-pair.mjs and is in no test bucket; nothing
// here imports it.

import assert from "node:assert/strict";
import { unitTest } from "../fixtures/unit-harness.mjs";
import {
  ARMS, CAPS, PROMPT, claudeArgs, fixtureSettings, nextRunAllowed, pairSummary, parsePairArgs,
  pmIdsFromPluginList, runPair, runRecord, runTotalOfLines,
} from "../../measure/overhead-pair-core.mjs";

const HOME = "/Users/someone";

unitTest("B4 fixtureSettings: the evals keys, absolute paths, installed pm off in BOTH arms", () => {
  const off = fixtureSettings("pm-off", HOME, ["pm@cfdude-plugins"], "/tmp/f/.claude/record.cjs");
  const on = fixtureSettings("pm-on", HOME, ["pm@cfdude-plugins"], "/tmp/f/.claude/record.cjs");
  assert.deepEqual(off, on, "the arm must not change the settings: only the command line differs");
  assert.deepEqual(off.claudeMdExcludes, [
    "/Users/someone/.claude/CLAUDE.md", "/Users/someone/.claude/SHIP-REAL-SOFTWARE.md", "/Users/someone/.claude/rules/**",
  ]);
  for (const p of off.claudeMdExcludes) assert.ok(p.startsWith("/"), p);
  assert.equal(off.autoMemoryEnabled, false);
  assert.deepEqual(off.enabledPlugins, { "pm@cfdude-plugins": false });
  assert.deepEqual(off.hooks.InstructionsLoaded[0].hooks[0], { type: "command", command: 'node "/tmp/f/.claude/record.cjs"' });
  assert.deepEqual(Object.keys(off).sort(), ["autoMemoryEnabled", "claudeMdExcludes", "enabledPlugins", "hooks"]);
});

unitTest("B4 fixtureSettings: no recorder, no hooks key; a trailing slash on home is tolerated; an unknown arm throws", () => {
  assert.equal("hooks" in fixtureSettings("pm-on", `${HOME}/`, []), false);
  assert.equal(fixtureSettings("pm-on", `${HOME}/`, []).claudeMdExcludes[0], "/Users/someone/.claude/CLAUDE.md");
  assert.throws(() => fixtureSettings("both", HOME, []), /unknown arm/);
});

unitTest("B4 pmIdsFromPluginList: enabled user-scope pm only, by exact name, from the live listing", () => {
  const list = [
    { id: "pm@cfdude-plugins", enabled: true, scope: "user" },
    { id: "pm@other-market", enabled: true, scope: "user" },
    { id: "pm-worktree@x", enabled: true, scope: "user" },
    { id: "pm@disabled", enabled: false, scope: "user" },
    { id: "pm@project-scoped", enabled: true, scope: "project" },
    { id: "honcho@cfdude-plugins", enabled: true, scope: "user" },
  ];
  assert.deepEqual(pmIdsFromPluginList(list), ["pm@cfdude-plugins", "pm@other-market"]);
  assert.deepEqual(pmIdsFromPluginList(null), []);
  assert.deepEqual(pmIdsFromPluginList([]), []);
});

unitTest("B4 nextRunAllowed: the first run is always allowed", () => {
  assert.deepEqual(nextRunAllowed(0, null, CAPS, 14585), { allowed: true, reason: null });
});

unitTest("B4 nextRunAllowed: a last run over the per-run cap stops the pair", () => {
  assert.deepEqual(nextRunAllowed(100001, { total: 100001 }, CAPS, 100), { allowed: false, reason: "run-cap" });
  assert.equal(nextRunAllowed(100000, { total: 100000 }, { perRun: 100000, pair: 10 ** 9 }, 0).allowed, true);
});

unitTest("B4 nextRunAllowed: the estimated next run must fit the pair ceiling; spent already includes the last run", () => {
  // next run ~ last (60k) + pm estimate (14.6k) = 74.6k; spent 60k -> 134.6k fits 150k.
  assert.equal(nextRunAllowed(60000, { total: 60000 }, CAPS, 14600).allowed, true);
  // last 68k: 68k + (68k + 14.6k) = 150.6k > 150k -> stop.
  assert.deepEqual(nextRunAllowed(68000, { total: 68000 }, CAPS, 14600), { allowed: false, reason: "pair-cap" });
  // exactly at the ceiling is allowed (not strictly greater).
  assert.equal(nextRunAllowed(67700, { total: 67700 }, CAPS, 14600).allowed, true);
});

unitTest("B4 nextRunAllowed honours a lowered ceiling", () => {
  assert.equal(nextRunAllowed(60000, { total: 60000 }, { perRun: 100000, pair: 100000 }, 14600).allowed, false);
});

const result = (over = {}) => ({ model: "m", input: 2, cacheCreation: 50000, cacheRead: 100, output: 5, total: 50107, briefPresent: false, instructionsUserScope: 0, ...over });

unitTest("B4 mocked twin: pm-off runs first, then pm-on, and nothing is skipped when both fit", async () => {
  const order = [];
  const runner = async (arm) => { order.push(arm); return result({ briefPresent: arm === "pm-on", total: 50000 }); };
  const out = await runPair({ runner, caps: CAPS, pmEstimate: 14600 });
  assert.deepEqual(order, ["pm-off", "pm-on"]);
  assert.equal(out.stopped, null);
  assert.equal(out.void, null);
  assert.equal(out.spent, 100000);
  assert.deepEqual(out.runs.map((r) => r.arm), ARMS);
});

unitTest("B4 mocked twin: the stop fires BETWEEN runs and nothing runs after it (pair cap)", async () => {
  const order = [];
  const runner = async (arm) => { order.push(arm); return result({ briefPresent: false, total: 70000 }); };
  const out = await runPair({ runner, caps: CAPS, pmEstimate: 14600 });
  assert.deepEqual(order, ["pm-off"], "pm-on must not start once the estimate would pass 150k");
  assert.deepEqual(out.stopped, { before: "pm-on", reason: "pair-cap" });
  assert.equal(out.runs.length, 1);
});

unitTest("B4 mocked twin: a pm-off run past the per-run cap stops the pair before pm-on", async () => {
  const order = [];
  const runner = async (arm) => { order.push(arm); return result({ total: 120000 }); };
  const out = await runPair({ runner, caps: CAPS, pmEstimate: 1 });
  assert.deepEqual(order, ["pm-off"]);
  assert.equal(out.stopped.reason, "run-cap");
});

unitTest("B4 mocked twin: a pm-off run that SHOWS pm's brief hook voids the pair and pm-on never runs", async () => {
  const order = [];
  const runner = async (arm) => { order.push(arm); return result({ briefPresent: true, total: 1000 }); };
  const out = await runPair({ runner, caps: CAPS, pmEstimate: 14600 });
  assert.deepEqual(order, ["pm-off"]);
  assert.deepEqual(out.void, { arm: "pm-off", reason: "brief-hook-mismatch" });
});

unitTest("B4 mocked twin: a pm-on run WITHOUT the brief hook voids the pair", async () => {
  const runner = async () => result({ briefPresent: false, total: 1000 });
  const out = await runPair({ runner, caps: CAPS, pmEstimate: 14600 });
  assert.equal(out.runs.length, 2);
  assert.deepEqual(out.void, { arm: "pm-on", reason: "brief-hook-mismatch" });
});

unitTest("B4 mocked twin: a run that loaded user-scope memory voids the pair", async () => {
  const runner = async (arm) => result({ briefPresent: arm === "pm-on", total: 1000, instructionsUserScope: 1 });
  const out = await runPair({ runner, caps: CAPS, pmEstimate: 14600 });
  assert.deepEqual(out.void, { arm: "pm-off", reason: "user-memory-loaded" });
  assert.equal(out.runs.length, 1);
});

unitTest("B4 mocked twin: a runner that throws propagates and no later run starts", async () => {
  const order = [];
  const runner = async (arm) => { order.push(arm); throw new Error("boom"); };
  await assert.rejects(runPair({ runner, caps: CAPS, pmEstimate: 1 }), /boom/);
  assert.deepEqual(order, ["pm-off"]);
});

// ---------- transcript totals and the summary ----------

const asst = (id, input, cc, cr, out, extra = {}) => JSON.stringify({
  type: "assistant", timestamp: "2026-10-29T10:00:00.000Z", entrypoint: "sdk-cli", ...extra,
  message: { id, model: "claude-opus-4-7", content: [{ type: "text", text: "SECRET" }],
    usage: { input_tokens: input, cache_creation_input_tokens: cc, cache_read_input_tokens: cr, output_tokens: out } },
});

unitTest("B4 runTotalOfLines sums EVERY assistant message (folded by id), not the first alone", () => {
  const lines = [asst("a", 2, 1000, 0, 10), asst("a", 2, 1000, 0, 30), asst("b", 3, 0, 1000, 20)];
  assert.equal(runTotalOfLines(lines), (2 + 1000 + 30) + (3 + 1000 + 20));
});

unitTest("B4 runRecord pairs the first message's counts with the whole run's total", () => {
  const rec = runRecord([asst("a", 2, 1000, 0, 30), asst("b", 3, 0, 1000, 20)]);
  assert.equal(rec.input, 2);
  assert.equal(rec.cacheCreation, 1000);
  assert.equal(rec.total, 1032 + 1023);
  assert.equal(rec.model, "claude-opus-4-7");
});

unitTest("B4 pairSummary: the delta on the total prompt, separately on the archived input + cacheCreation, and the ratio", () => {
  const off = { input: 2, cacheCreation: 40000, cacheRead: 0, model: "m" };
  const on = { input: 2, cacheCreation: 52000, cacheRead: 3000, model: "m" };
  assert.deepEqual(pairSummary(off, on, 14000), {
    promptDelta: 15000, archivedMethodDelta: 12000, pmEstimate: 14000, ratio: 1.071, sameModel: true,
  });
  assert.equal(pairSummary(off, { ...on, model: "n" }, 0).ratio, null);
  assert.equal(pairSummary(off, { ...on, model: "n" }, 0).sameModel, false);
});

// ---------- the command line ----------

unitTest("B4 claudeArgs: both arms share the base; only pm-on adds --plugin-dir, always the same checkout", () => {
  const off = claudeArgs("pm-off", "/repo");
  const on = claudeArgs("pm-on", "/repo");
  assert.deepEqual(off, ["-p", PROMPT, "--output-format", "json", "--strict-mcp-config"]);
  assert.deepEqual(on, [...off, "--plugin-dir", "/repo"]);
  assert.equal(off.includes("--tools"), false, "built-in tools stay ON: the skill and command listings are part of pm's cost");
  assert.equal(off.includes("--bare"), false);
});

unitTest("B4 parsePairArgs: a real run REFUSES without an explicit --ceiling", () => {
  assert.match(parsePairArgs([]).error, /--ceiling/);
  assert.match(parsePairArgs(["--out", "x.json"]).error, /--ceiling/);
});

unitTest("B4 parsePairArgs: the ceiling is a whole number within 1..150000", () => {
  assert.equal(parsePairArgs(["--ceiling", "150000"]).ceiling, 150000);
  assert.equal(parsePairArgs(["--ceiling", "90000"]).ceiling, 90000);
  assert.match(parsePairArgs(["--ceiling", "150001"]).error, /between 1 and 150000/);
  assert.match(parsePairArgs(["--ceiling", "0"]).error, /between/);
  assert.match(parsePairArgs(["--ceiling", "12k"]).error, /whole number/);
  assert.match(parsePairArgs(["--ceiling"]).error, /needs a value/);
  assert.match(parsePairArgs(["--ceiling", "--out"]).error, /needs a value/);
});

unitTest("B4 parsePairArgs: --prepare-only spawns no model run, so it needs no ceiling; unknown flags are refused", () => {
  assert.equal(parsePairArgs(["--prepare-only"]).prepareOnly, true);
  assert.match(parsePairArgs(["--bogus"]).error, /--bogus/);
  assert.equal(parsePairArgs(["--ceiling", "100000", "--keep-transcripts"]).keepTranscripts, true);
});

unitTest("B4 the caps are the ones Rob set", () => {
  assert.deepEqual({ ...CAPS }, { perRun: 100000, pair: 150000 });
});
