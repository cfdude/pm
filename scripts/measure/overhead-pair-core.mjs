// scripts/measure/overhead-pair-core.mjs
// pm-overhead-calibration-and-feature-switches B4 -- the PURE half of the reduced calibration pair.
// DEV TOOLING, outside the engine. Everything here takes values and returns values: no file, no child
// process, no `claude`. The REAL run (it spends model tokens) is overhead-pair.mjs, which is in no test
// bucket by design; this module and an injected runner are what the default test tier covers (the mocked
// twin of that real run, per the split-real-from-mocked rule).
//
// THE PROTOCOL is section 2 of docs/measurement/2026-10-pm-overhead-baseline.md, reduced to 1 pm-off run
// and 1 pm-on run, under a 100k stop per run and a 150k ceiling for the pair.

import { foldRows, parseEntry, rowTotal, sourceInfo } from "../lib/spend-reader.mjs";
import { firstMessage } from "./overhead-survey-core.mjs";

export const PROMPT = "Reply with the single word ok.";
export const ARMS = Object.freeze(["pm-off", "pm-on"]);
/** The hard caps. `pair` is also the CEILING a real run must be told explicitly and may never exceed. */
export const CAPS = Object.freeze({ perRun: 100000, pair: 150000 });

/** The settings a fixture's `.claude/settings.local.json` holds, key for key as evals/fixtures.py builds
 *  them: user memory excluded by ABSOLUTE path, auto-memory off, every installed pm switched off (in BOTH
 *  arms: the pm-on arm gets its pm from `--plugin-dir`, and an installed pm left on would double the
 *  hooks there and leak into pm-off), and an InstructionsLoaded recorder as positive proof of isolation.
 *  Not `--bare`, not `--setting-sources` (both silently break the measurement). The arm only selects what
 *  the run adds on the command line, so the two arms' settings are identical by construction. */
export function fixtureSettings(arm, home, pmIds, recorderPath = null) {
  if (!ARMS.includes(arm)) throw new Error(`unknown arm: ${arm}`);
  const h = String(home).replace(/\/+$/, "");
  const settings = {
    claudeMdExcludes: [`${h}/.claude/CLAUDE.md`, `${h}/.claude/SHIP-REAL-SOFTWARE.md`, `${h}/.claude/rules/**`],
    autoMemoryEnabled: false,
    enabledPlugins: Object.fromEntries([...pmIds].sort().map((id) => [id, false])),
  };
  if (recorderPath) {
    settings.hooks = { InstructionsLoaded: [{ hooks: [{ type: "command", command: `node "${recorderPath}"` }] }] };
  }
  return settings;
}

/** The recorder fixtureSettings points at: one `memory_type<TAB>file_path` line per instruction file
 *  loaded. Failures are swallowed (an observability hook must never break the run it observes). */
export const RECORDER_SOURCE = [
  "let s = '';",
  "process.stdin.on('data', (d) => (s += d)).on('end', () => {",
  "  try {",
  "    const j = JSON.parse(s);",
  "    const fs = require('node:fs');",
  "    const path = require('node:path');",
  "    fs.appendFileSync(path.join(__dirname, 'instructions-loaded.log'), `${j.memory_type}\\t${j.file_path}\\n`);",
  "  } catch { /* observability only */ }",
  "});",
  "",
].join("\n");

/** Ids of every enabled USER-scope pm in `claude plugin list --json`, by NAME component exactly `pm`
 *  (`pm-worktree@x` is another plugin). Computed from the live listing, never hardcoded. */
export function pmIdsFromPluginList(entries) {
  if (!Array.isArray(entries)) return [];
  return entries
    .filter((e) => e && String(e.id || "").split("@")[0] === "pm" && e.enabled && e.scope === "user")
    .map((e) => String(e.id)).sort();
}

/** Whether the NEXT run may start. `spent` already includes `last`; the next run is estimated as the last
 *  (pm-off) run's total plus pm's own estimated overhead. Stops when the last run passed the per-run cap,
 *  or when the estimated next run would take the pair past its ceiling. */
export function nextRunAllowed(spent, last, caps, pmEstimate) {
  if (!last) return { allowed: true, reason: null };
  if (last.total > caps.perRun) return { allowed: false, reason: "run-cap" };
  if (spent + last.total + pmEstimate > caps.pair) return { allowed: false, reason: "pair-cap" };
  return { allowed: true, reason: null };
}

/** The whole orchestration over an INJECTED `runner(arm) -> result`. pm-off runs first (the smaller run:
 *  its total sets the estimate for the next). Nothing runs after a stop, and a run whose pm brief hook is
 *  not what its arm requires (present in pm-on, absent in pm-off) voids the pair and stops it. */
export async function runPair({ runner, caps = CAPS, pmEstimate }) {
  const runs = [];
  let spent = 0;
  let last = null;
  for (const arm of ARMS) {
    const gate = nextRunAllowed(spent, last, caps, pmEstimate);
    if (!gate.allowed) return { runs, spent, stopped: { before: arm, reason: gate.reason }, void: null };
    const r = await runner(arm);
    const run = { arm, ...r };
    runs.push(run);
    spent += Number.isFinite(r.total) ? r.total : 0;
    last = run;
    if (r.briefPresent !== (arm === "pm-on")) {
      return { runs, spent, stopped: { before: ARMS[ARMS.indexOf(arm) + 1] || null, reason: "void" }, void: { arm, reason: "brief-hook-mismatch" } };
    }
    if (r.instructionsUserScope > 0) {
      return { runs, spent, stopped: { before: ARMS[ARMS.indexOf(arm) + 1] || null, reason: "void" }, void: { arm, reason: "user-memory-loaded" } };
    }
  }
  return { runs, spent, stopped: null, void: null };
}

/** The spend of a whole run: every assistant message in the transcript (folded per message id, sidechains
 *  included), not the first alone. */
export function runTotalOfLines(lines) {
  const src = sourceInfo("p/s.jsonl");
  const rows = [];
  for (const l of lines) {
    const p = parseEntry(l, src);
    if (p.row) rows.push(p.row);
  }
  return foldRows(rows).reduce((s, r) => s + rowTotal(r), 0);
}

/** One run's record from its transcript lines: the first message's counts, the run's whole spend. */
export function runRecord(lines) {
  const first = firstMessage(lines);
  return { ...first, total: runTotalOfLines(lines) };
}

/** The delta between the two arms. `promptDelta` is on the total prompt (input + cacheCreation +
 *  cacheRead of the FIRST message); `archivedMethodDelta` on `input + cacheCreation` alone, the archived
 *  pm-overhead-baseline method. `ratio` is the measured total-prompt delta over the verb's estimate. */
export function pairSummary(off, on, pmEstimate) {
  const prompt = (r) => r.input + r.cacheCreation + r.cacheRead;
  const archived = (r) => r.input + r.cacheCreation;
  const promptDelta = prompt(on) - prompt(off);
  return {
    promptDelta,
    archivedMethodDelta: archived(on) - archived(off),
    pmEstimate,
    ratio: pmEstimate > 0 ? Math.round((promptDelta / pmEstimate) * 1000) / 1000 : null,
    sameModel: off.model === on.model,
  };
}

/** The argv `claude` is spawned with. Built-in tools stay ON (the skill and command listings are part of
 *  pm's cost); `--strict-mcp-config` cuts the shared MCP base identically in both arms; only pm-on adds
 *  `--plugin-dir`, and always the SAME checkout. */
export function claudeArgs(arm, checkout) {
  if (!ARMS.includes(arm)) throw new Error(`unknown arm: ${arm}`);
  const base = ["-p", PROMPT, "--output-format", "json", "--strict-mcp-config"];
  return arm === "pm-on" ? [...base, "--plugin-dir", checkout] : base;
}

/** `--ceiling <tokens>` is REQUIRED for a real run: there is no default, so a run can never start under
 *  a cap nobody typed. It may be lowered, never raised past the pair's hard cap. `--prepare-only` builds
 *  the fixtures and prints pm's estimate without spawning `claude`, so it needs no ceiling. */
export function parsePairArgs(argv) {
  const o = { ceiling: null, out: null, prepareOnly: false, keepTranscripts: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--prepare-only") { o.prepareOnly = true; continue; }
    if (a === "--keep-transcripts") { o.keepTranscripts = true; continue; }
    if (a === "--ceiling" || a === "--out") {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) return { error: `${a} needs a value` };
      i += 1;
      if (a === "--out") { o.out = v; continue; }
      if (!/^\d+$/.test(v)) return { error: `--ceiling must be a whole number of tokens, got ${v}` };
      o.ceiling = Number(v);
      continue;
    }
    return { error: `unknown argument ${a}` };
  }
  if (!o.prepareOnly) {
    if (o.ceiling === null) return { error: "a real run needs an explicit --ceiling <tokens> (at most 150000); it spends model tokens" };
    if (o.ceiling < 1 || o.ceiling > CAPS.pair) return { error: `--ceiling must be between 1 and ${CAPS.pair}, got ${o.ceiling}` };
  }
  return o;
}
