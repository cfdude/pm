// scripts/lib/spend-command.mjs
// token-spend-tracking-per-epic — the `spend` verb: ingest, then report; and the ledger's inverses.
//
//   spend [--epic <id>] [--since <iso>] [--until <iso>] [--json] [--no-ingest]
//   spend --clear [--timeline] [--yes]        spend --rebuild [--yes]
//
// WHAT RUNS WHERE. This is the ONLY reader of Claude Code's transcripts. No hook reaches it, with
// tracking on or off (spec: "No hook reads a transcript"). With tracking OFF it reads no transcript
// either: it reports from whatever the last ingest left and says so.
//
// THE LEDGER BELONGS TO THE MAIN WORKING TREE, and so does the answer to "is tracking on": a linked
// worktree's committed `state.json` is a stale copy, so `spend` run from one reads the MAIN tree's
// state for the switch, `enabledAt` and the epic set (design D3).
//
// EVERY WRITE PRINTS ITS PLAN FIRST. `--clear` and `--rebuild` change nothing without `--yes`: this
// engine is driven by agents and hooks, so a stdin prompt would hang rather than confirm, which is
// the rule purge-logs states for the same reason.

import os from "node:os";
import { isInitialized, loadState } from "./state.mjs";
import { diskStore } from "./store.mjs";
import { parseFlags, requireFlagValues } from "./add-epic.mjs";
import { die } from "./command-exit.mjs";
import { escapeControls, jsonText } from "./constants.mjs";
import { currentArgv, currentEnv, invocation, outStream } from "./invocation.mjs";
import { spendEnabled } from "./spend-tracking.mjs";
import { mainTreeDetached, resolveMainTree, spendDir } from "./spend-tree.mjs";
import {
  clearLedger, clearPlan, ingest, ledgerExists, readLedger, rebuild, rebuildPlan,
} from "./spend-ledger.mjs";
import { attribute } from "./spend-attribution.mjs";
import { buildReport, renderReport } from "./spend-report.mjs";

const refuse = (msg) => die(`conductor: ${msg}\n`);

/** The MAIN tree's record. From the main tree this is just `loadState()`; from a linked worktree it is
 *  the main tree's `state.json`, read through a disk store rooted there. */
function mainState(tree) {
  if (!tree.linked) return loadState();
  const read = diskStore({ ...invocation(), root: tree.main, store: undefined, __store: undefined }).readRecord();
  if (read.kind !== "ok") {
    refuse(`spend could not read the main working tree's state.json (${escapeControls(tree.main)}) — a linked worktree reports from the main tree's record, and it is ${read.kind === "absent" ? "absent" : "unreadable"}.`);
  }
  return read.state;
}

const iso = (flag, value) => {
  if (value === undefined) return null;
  if (!Number.isFinite(Date.parse(String(value)))) refuse(`spend --${flag} needs an ISO-8601 timestamp, not '${escapeControls(String(value))}'.`);
  return String(value);
};

const bytes = (n) => `${n.toLocaleString("en-US")} byte${n === 1 ? "" : "s"}`;

/** `spend` */
export function spend() {
  if (!isInitialized()) { die("conductor: run /pm:init first\n"); }
  const f = parseFlags(currentArgv().slice(3));
  requireFlagValues("spend", f);
  // `--clear` is also `update-epic`'s REPEATABLE flag, and parseFlags() reads repeatability from the
  // registry across every verb, so here it arrives as `[true]`. A valueless flag is on when it was given.
  const on = (name) => f[name] === true || (Array.isArray(f[name]) && f[name].length > 0 && f[name].every((v) => v === true));
  const clear = on("clear"), doRebuild = on("rebuild"), timeline = on("timeline"), yes = on("yes");
  if (clear && doRebuild) refuse("spend --clear and --rebuild are different operations and do not combine. Nothing was changed.");
  if (timeline && !clear) refuse("spend --timeline only qualifies --clear (it removes the timeline as well). Nothing was changed.");
  if (yes && !clear && !doRebuild) refuse("spend --yes confirms --clear or --rebuild; with neither it has nothing to confirm. Nothing was changed.");
  const reportFlags = ["epic", "since", "until", "json", "no-ingest"].filter((k) => f[k] !== undefined);
  if ((clear || doRebuild) && reportFlags.length) {
    refuse(`spend --${clear ? "clear" : "rebuild"} acts on the whole ledger and takes only ${clear ? "--timeline and " : ""}--yes; ` +
      `--${reportFlags.join(", --")} would be ignored, which reads as a narrower operation than it is. Nothing was changed.`);
  }
  const since = iso("since", f.since), until = iso("until", f.until);

  const tree = resolveMainTree();
  const state = mainState(tree);
  const enabled = spendEnabled(state);
  const env = currentEnv();
  const home = env.HOME || os.homedir();
  const readCtx = { mainRoot: tree.main, env, home };

  if (typeof f.epic === "string" && !(state.epics || []).some((e) => e && e.id === f.epic)) {
    refuse(`spend --epic '${escapeControls(f.epic)}' — no epic with that id is registered${tree.linked ? " in the main working tree" : ""}. Nothing was ingested.`);
  }
  const enabledAtMs = Date.parse(state.spendTracking && state.spendTracking.enabledAt);
  if (enabled && !Number.isFinite(enabledAtMs)) {
    refuse("state.spendTracking.enabledAt is missing or unreadable, so there is no start to bound an ingest by. Run set-spend-tracking off, then on, to stamp a fresh start. Nothing was ingested.");
  }

  if (clear) return runClear(tree, { timeline, yes });
  if (doRebuild) return runRebuild(tree, readCtx, { enabled, enabledAtMs, yes });

  // ── ingest, then report ──
  let ingestInfo;
  if (on("no-ingest")) ingestInfo = { ran: false, reason: "--no-ingest: reporting from the existing ledger" };
  else if (!enabled) ingestInfo = { ran: false, reason: "tracking is off: no transcript was read; totals are as of the last ingest" };
  else if (mainTreeDetached(tree.main)) ingestInfo = { ran: false, reason: "did not ingest because the main working tree's HEAD is detached; reporting from what exists" };
  else {
    const r = ingest({ ...readCtx, enabledAtMs });
    ingestInfo = r.busy ? { ran: false, busy: true, reason: "an ingest was already in progress; reporting from the existing ledger" } : r;
  }

  const ledger = readLedger(tree.main);
  const attributed = attribute(ledger.rows, ledger.markers, ledger.timeline, state);
  const report = buildReport({
    attributed, tracking: state.spendTracking, ingest: ingestInfo,
    filters: { epic: typeof f.epic === "string" ? f.epic : undefined, since, until },
  });
  if (on("json")) { outStream().write(jsonText(report, null, 2) + "\n"); return; }
  outStream().write(renderReport(report, { ingestLines: ingestLines(ingestInfo, ledger, tree, enabled) }).join("\n") + "\n");
}

/** What the text report says about the ingest: what it read, where, and why it did not when it did not.
 *  Returned through `lines.map(escapeControls)`, so no value reaches a stream raw. */
function ingestLines(info, ledger, tree, enabled) {
  const lines = [];
  if (info.projectDir) {
    lines.push(`transcripts: ${info.projectDir}${info.projectDirFound ? "" : " — NOT FOUND (nothing to ingest)"}`);
  }
  if (!info.ran) {
    lines.push(`ingest: ${info.reason}`);
    if (!ledgerExists(tree.main)) lines.push(`ledger: none yet in ${spendDir(tree.main)}${enabled ? "" : " (tracking has not been on)"}`);
    return lines.map(escapeControls);
  }
  const skippedParts = [];
  for (const [k, v] of Object.entries(info.skipped)) skippedParts.push(`${k} ${v}`);
  const skipped = skippedParts.map(escapeControls).join(", ");
  lines.push(`ingest: read ${info.files.read} file(s), ${info.files.unchanged} unchanged, ${info.files.skippedBeforeEnabled} older than enabledAt (not opened); +${info.rowsAdded} message(s)` +
    (info.rowsBeforeEnabled ? `, ${info.rowsBeforeEnabled} before enabledAt` : "") + (skipped ? `; skipped entries: ${skipped}` : ""));
  if (ledger.corrupt) lines.push(`ledger: ${ledger.corrupt} unreadable line(s) were skipped`);
  return lines.map(escapeControls);
}

function runClear(tree, { timeline, yes }) {
  const plan = clearPlan(tree.main, { timeline });
  const lines = [];
  const dir = spendDir(tree.main);
  if (!plan.remove.length) lines.push(`spend --clear: nothing to remove in ${dir}`);
  else {
    lines.push(`spend --clear would remove from ${dir}:`);
    for (const x of plan.remove) lines.push(`  ${x.name} (${bytes(x.bytes)})`);
  }
  if (plan.keep.length) lines.push(`  kept: ${plan.keep.join(", ")} — the timeline cannot be rebuilt, so it is never removed implicitly (add --timeline to remove it)`);
  if (timeline) {
    lines.push("  --timeline: the off intervals and the active-epic windows are LOST. Spend made while tracking was off may be credited to epics by marker after a re-ingest, " +
      "and orchestrator spend before the next `set-active` will read as before-timeline.");
  }
  if (!yes) lines.push("Nothing was changed. Re-run with --yes to apply.");
  outStream().write(lines.map(escapeControls).join("\n") + "\n");
  if (!yes) return;
  if (mainTreeDetached(tree.main)) refuse("spend --clear is refused: the main working tree's HEAD is detached, and ledger writes are suppressed there. Nothing was changed.");
  const r = clearLedger(tree.main, { timeline });
  if (r.busy) refuse("spend --clear is refused: an ingest is in progress (ingest.lock is held). Nothing was changed.");
  const done = [];
  done.push(`spend --clear: removed ${r.removed.length ? r.removed.join(", ") : "nothing"}`);
  outStream().write(done.map(escapeControls).join("\n") + "\n");
}

function runRebuild(tree, readCtx, { enabled, enabledAtMs, yes }) {
  if (!enabled) refuse("spend --rebuild is refused while tracking is off: a rebuild reads transcripts, and nothing reads them while it is off. Run set-spend-tracking on first. Nothing was read or changed.");
  const plan = rebuildPlan(readCtx);
  const lines = [];
  lines.push(`spend --rebuild would re-derive ${plan.rederived} message(s) from ${plan.filesOnDisk} transcript file(s) under ${plan.projectDir}`);
  lines.push(`  kept: the timeline, and ${plan.kept} message(s) whose transcript is no longer on disk (Claude Code prunes transcripts; once one is gone the ledger is the only copy)`);
  if (!yes) lines.push("Nothing was changed. Re-run with --yes to apply.");
  outStream().write(lines.map(escapeControls).join("\n") + "\n");
  if (!yes) return;
  if (mainTreeDetached(tree.main)) refuse("spend --rebuild is refused: the main working tree's HEAD is detached, and ledger writes are suppressed there. Nothing was changed.");
  const r = rebuild({ ...readCtx, enabledAtMs });
  if (r.busy) refuse("spend --rebuild is refused: an ingest is in progress (ingest.lock is held). Nothing was changed.");
  const done = [];
  done.push(`spend --rebuild: ${r.rowsAdded} message(s) re-derived from ${r.files.read} file(s); ${r.keptRows} kept because their transcript is gone`);
  outStream().write(done.map(escapeControls).join("\n") + "\n");
}
