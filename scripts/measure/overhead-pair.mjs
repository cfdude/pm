// scripts/measure/overhead-pair.mjs
// pm-overhead-calibration-and-feature-switches B4 -- the REAL reduced calibration pair. THIS SPAWNS `claude`
// AND SPENDS MODEL TOKENS. It is in NO test bucket: the default tier covers the same logic through the mocked
// twin (scripts/test/unit/overhead-pair.test.mjs over overhead-pair-core.mjs and an injected runner). Do not
// import this file from a test.
//
//   node scripts/measure/overhead-pair.mjs --ceiling <tokens> [--out <file>] [--keep-transcripts]
//   node scripts/measure/overhead-pair.mjs --prepare-only        (builds fixtures, prints pm's estimate, no model run)
//
// A real run REFUSES to start without an explicit --ceiling (at most 150000). Any single run past 100000
// tokens is killed. pm-off runs first; pm-on runs only if the estimated next run still fits the ceiling.
//
// ONE pm TREE for the whole pm-on arm: pm-on runs with `--plugin-dir <this checkout>` (the installed pm is
// disabled in BOTH arms), and `init` and `overhead --json` run from that same scripts/conductor.mjs. The
// result records the checkout's sha so the doc can say whether it is before or after the intake shrink.
//
// MEMORY: the process is capped at 4 GB RSS by a watchdog. Transcripts of a one-word prompt are small.

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { encodeProjectPath, transcriptRoot } from "../lib/spend-reader.mjs";
import {
  CAPS, RECORDER_SOURCE, claudeArgs, fixtureSettings, pairSummary, parsePairArgs, pmIdsFromPluginList, runPair,
  runRecord, runTotalOfLines,
} from "./overhead-pair-core.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ENGINE = path.join(REPO, "scripts", "conductor.mjs");
const RSS_CAP_BYTES = 4 * 1024 ** 3;
const POLL_MS = 1000;
const RUN_TIMEOUT_MS = 10 * 60 * 1000;

const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });

function startRssWatchdog() {
  const t = setInterval(() => {
    if (process.memoryUsage.rss() > RSS_CAP_BYTES) { process.stderr.write("overhead-pair: RSS passed the 4 GB cap; exiting\n"); process.exit(3); }
  }, 250);
  t.unref();
}

function listPmIds() {
  const r = sh("claude", ["plugin", "list", "--json"], { cwd: os.tmpdir() });
  if (r.status !== 0) return [];
  try { return pmIdsFromPluginList(JSON.parse(r.stdout)); } catch { return []; }
}

/** A throwaway git repo with the isolation settings. pm-on additionally gets `init` from THIS checkout's engine. */
function makeFixture(arm, pmIds) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `pm-cal-${arm === "pm-on" ? "on" : "off"}-`)));
  const g = sh("git", ["init", "-q"], { cwd: dir });
  if (g.status !== 0) throw new Error(`git init failed in ${dir}`);
  const claudeDir = path.join(dir, ".claude");
  fs.mkdirSync(claudeDir, { recursive: true });
  const recorder = path.join(claudeDir, "record-instructions.cjs");
  fs.writeFileSync(recorder, RECORDER_SOURCE);
  fs.writeFileSync(path.join(claudeDir, "settings.local.json"), `${JSON.stringify(fixtureSettings(arm, os.homedir(), pmIds, recorder), null, 2)}\n`);
  if (arm === "pm-on") {
    const i = sh("node", [ENGINE, "init", "--platform", "claude-code"], { cwd: dir });
    if (i.status !== 0) throw new Error(`pm init failed in ${dir}: ${i.stderr || i.stdout}`);
  }
  return dir;
}

/** `overhead --json` from THIS checkout's engine, run in the pm-on fixture: total.estimatedTokens. */
function pmEstimateOf(dir) {
  const r = sh("node", [ENGINE, "overhead", "--json"], { cwd: dir });
  if (r.status !== 0) throw new Error(`overhead --json failed: ${r.stderr || r.stdout}`);
  const at = r.stdout.indexOf("{");
  const n = JSON.parse(r.stdout.slice(at)).total.estimatedTokens;
  if (!Number.isFinite(n)) throw new Error("overhead --json carried no total.estimatedTokens");
  return n;
}

const transcriptDirOf = (fixture) => path.join(transcriptRoot(process.env, os.homedir()), encodeProjectPath(fixture));
const jsonlIn = (dir) => { try { return fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")); } catch { return []; } };
const readLines = (file) => fs.readFileSync(file, "utf8").split("\n").filter(Boolean);

/** One real `claude -p` run in `fixture`. A watcher kills it the moment its transcript passes the per-run cap. */
async function realRun(arm, fixture, { model = null, killAt = CAPS.perRun } = {}) {
  const dir = transcriptDirOf(fixture);
  const child = spawn("claude", claudeArgs(arm, REPO, model), { cwd: fixture, env: { ...process.env, HONCHO_ENABLED: "false" }, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  child.stdout.on("data", (d) => { stdout += d; });
  child.stderr.on("data", () => {});
  let aborted = null;
  const watch = setInterval(() => {
    const files = jsonlIn(dir);
    if (files.length !== 1) return;
    try {
      if (runTotalOfLines(readLines(path.join(dir, files[0]))) > killAt) { aborted = "run-cap"; child.kill("SIGTERM"); }
    } catch { /* the file is being written; try next tick */ }
  }, POLL_MS);
  const timeout = setTimeout(() => { aborted = aborted || "timeout"; child.kill("SIGTERM"); }, RUN_TIMEOUT_MS);
  const code = await new Promise((resolve) => child.on("close", resolve));
  clearInterval(watch);
  clearTimeout(timeout);

  let sessionId = null;
  try { sessionId = JSON.parse(stdout).session_id || null; } catch { /* keep null; the lone transcript is used */ }
  const files = jsonlIn(dir);
  const file = sessionId && files.includes(`${sessionId}.jsonl`) ? `${sessionId}.jsonl` : (files.length === 1 ? files[0] : null);
  if (!file) throw new Error(`${arm}: expected exactly one transcript in ${dir}, found ${files.length} (claude exited ${code})`);
  const rec = runRecord(readLines(path.join(dir, file)));
  if (rec.skip) throw new Error(`${arm}: the transcript holds no assistant message (${rec.skip})`);
  let userScope = 0;
  try {
    userScope = fs.readFileSync(path.join(fixture, ".claude", "instructions-loaded.log"), "utf8")
      .split("\n").filter((l) => l.startsWith("User\t")).length;
  } catch { /* no log: the hook did not fire */ }
  return { ...rec, aborted, exitCode: code, instructionsUserScope: userScope };
}

/** The throwaway transcript directories of the two fixtures, removed so the survey never counts them. */
function removeTranscriptDir(fixture) {
  const dir = transcriptDirOf(fixture);
  if (!/-pm-cal-(on|off)-[A-Za-z0-9]+$/.test(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

async function main() {
  const args = parsePairArgs(process.argv.slice(2));
  if (args.error) { process.stderr.write(`overhead-pair: ${args.error}\n`); process.exit(2); }
  startRssWatchdog();
  const pmIds = listPmIds();
  if (pmIds.length === 0) {
    process.stderr.write("overhead-pair: no enabled user-scope pm found in `claude plugin list --json`; refusing to run (an installed pm left on would double the hooks in pm-on and leak into pm-off)\n");
    process.exit(2);
  }
  const fixtures = {};
  try {
    fixtures["pm-on"] = makeFixture("pm-on", pmIds);
    fixtures["pm-off"] = makeFixture("pm-off", pmIds);
    const pmEstimate = pmEstimateOf(fixtures["pm-on"]);
    if (args.prepareOnly) {
      process.stdout.write(`overhead-pair: prepared; pm estimate ${pmEstimate} tokens; installed pm ids switched off: ${pmIds.join(", ")}; no model run\n`);
      return;
    }
    const caps = { perRun: CAPS.perRun, pair: args.ceiling };
    const outcome = await runPair({ runner: (arm, ctx) => realRun(arm, fixtures[arm], { model: args.model, killAt: ctx.killAt }), caps, pmEstimate });
    const off = outcome.runs.find((r) => r.arm === "pm-off");
    const on = outcome.runs.find((r) => r.arm === "pm-on");
    const sha = sh("git", ["rev-parse", "HEAD"], { cwd: REPO }).stdout.trim();
    const dirty = sh("git", ["status", "--porcelain"], { cwd: REPO }).stdout.trim().length > 0;
    const result = {
      date: new Date().toISOString(),
      claudeCode: sh("claude", ["--version"]).stdout.trim(),
      pmVersion: JSON.parse(fs.readFileSync(path.join(REPO, ".claude-plugin", "plugin.json"), "utf8")).version,
      pmTreeSha: sha, pmTreeDirty: dirty, caps, pmEstimate,
      runs: outcome.runs, spent: outcome.spent, stopped: outcome.stopped, void: outcome.void,
      summary: off && on ? pairSummary(off, on, pmEstimate) : null,
    };
    const outFile = path.resolve(args.out || path.join(REPO, "docs", "measurement", ".raw", "overhead-pair-result.json"));
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, `${JSON.stringify(result, null, 2)}\n`);
    process.stdout.write(`overhead-pair: ${outcome.runs.length} run(s), ${outcome.spent} tokens spent of ${caps.pair}` +
      `${outcome.stopped ? `, stopped before ${outcome.stopped.before} (${outcome.stopped.reason})` : ""}` +
      `${outcome.void ? `, VOID (${outcome.void.reason})` : ""}\n  result: ${outFile}\n`);
  } finally {
    for (const arm of Object.keys(fixtures)) {
      if (!args.keepTranscripts) removeTranscriptDir(fixtures[arm]);
      fs.rmSync(fixtures[arm], { recursive: true, force: true });
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { process.stderr.write(`overhead-pair: ${e.message}\n`); process.exit(1); });
}
