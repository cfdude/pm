// scripts/lib/dev-log.mjs
// developer-session-log -- an opt-in, off-by-default, DEVELOPER-ONLY per-session log: which pm features were on,
// the SHAPE of each request and response, the token breakdown, and context-retention warnings.
//
// PLAIN JSONL, NO DEPENDENCY. Rob suggested a dependency for this; the engine is zero-runtime-dependency and the
// spend ledger already is an append-only JSONL file, so none was needed.
//
// COMPOSITION, NEVER TEXT. A stored entry holds byte COUNTS by kind and identifiers. Tokens and tool names are
// joined from the ledger row with the same message id at report time, never copied. Nothing stored contains a
// prompt, a response, a tool input or a tool output.
//
// CAPTURE IS INGEST'S, AND ONLY INGEST'S. No hook reads or writes `devlog.jsonl`; the ledger stays the one
// transcript reader (spend-ledger.mjs calls the pure collector below from its own read loop).
//
// THE SWITCH requires spend tracking (one reader, one cursor, one main-tree location), is stored in the MAIN
// working tree's state, and is refused in a linked worktree or on a detached main HEAD exactly as
// `set-spend-tracking` is. Turning it off stops capture and deletes nothing.

import { isInitialized, loadState, saveState } from "./state.mjs";
import { reportSave, STATE_UNCHANGED } from "./save-report.mjs";
import { checkedPositionals } from "./argv-surface.mjs";
import { die } from "./command-exit.mjs";
import { escapeControls } from "./constants.mjs";
import { mainTreeDetached, resolveMainTree } from "./spend-tree.mjs";
import { spendEnabled } from "./spend-switch.mjs";
import { buildReport, hookVerbs, readListings } from "./overhead.mjs";
import { matchableLessons } from "./lessons.mjs";

export { DEVLOG_FILE } from "./dev-log-capture.mjs";

/** Is the developer log on in this record? Absent reads as off. The ONE predicate; `isSet` of the opt-in row,
 *  ingest and the reports all ask it. */
export function devLogEnabled(state) {
  return !!(state && state.devLog && state.devLog.enabled === true);
}

/** `set-dev-log <on|off>`. */
export function setDevLog() {
  if (!isInitialized()) { die("conductor: run /pm:init first\n"); }
  const [arg] = checkedPositionals("set-dev-log");
  if (arg !== "on" && arg !== "off") {
    die("usage: conductor.mjs set-dev-log <on|off>\n");
  }
  const state = loadState();
  const tree = resolveMainTree();
  if (tree.linked) {
    die(`conductor: set-dev-log ${arg} is refused in a linked worktree — the switch and the log belong to the main working tree, ${escapeControls(tree.main)}. ` +
      "Run it there. Nothing was changed.\n");
  }
  if (mainTreeDetached(tree.main)) {
    die(`conductor: set-dev-log ${arg} is refused while the main working tree's HEAD is detached — its ledger writes are suppressed there. ` +
      "Check out a branch first. Nothing was changed.\n");
  }
  if (arg === "on" && !spendEnabled(state)) {
    die("conductor: set-dev-log on is refused while spend tracking is off — the log is captured by the spend ledger's own ingest and shares its transcript reader. " +
      "Run `set-spend-tracking on` first. Nothing was changed.\n");
  }
  if (arg === "off" && !devLogEnabled(state)) {
    reportSave({ unchanged: true }, { unchanged: `conductor: the developer log was already off — ${STATE_UNCHANGED}` });
    return;
  }
  // `enabledAt` is written on the FIRST `on` and never moved after that: it bounds what capture ever looks back at.
  const { enabledAt: prevAt, ...prev } = state.devLog || {};
  const keep = typeof prevAt === "string" && Number.isFinite(Date.parse(prevAt));
  const enabledAt = keep ? prevAt : (arg === "on" ? new Date().toISOString() : undefined);
  state.devLog = { ...prev, enabled: arg === "on", ...(enabledAt ? { enabledAt } : {}) };
  const saved = saveState(state);
  reportSave(saved, {
    changed: `conductor: developer log ${arg}${arg === "on"
      ? " — composition entries are captured by `spend`'s ingest into .conductor/spend/devlog.jsonl (counts only, never text)."
      : " — nothing further is captured. What was already recorded is kept; `dev-log --clear --yes` removes it."}`,
    unchanged: `conductor: the developer log was already ${arg} — ${STATE_UNCHANGED}`,
  });
}

// ───────────────────────────── the features snapshot ─────────────────────────────

/** Surfaces whose size follows the record's HISTORY rather than the configuration: they would append a snapshot to
 *  nearly every ingest of an active repository. `overhead` reports them live; the snapshot omits them. */
export const VOLATILE_SURFACES = Object.freeze(["brief", "snapshot"]);

/** Which pm features were on, and what each costs, as of now: each feature's `on` and unconditional bytes, and
 *  the per-surface bytes, all as `overhead` computes them (never an OPT_INS row's `isSet`). Reads the plugin's own
 *  files, so it runs only while the log is on. */
export function featuresSnapshot(state) {
  let lessons = [];
  try { lessons = matchableLessons().map((l) => ({ rule: l.rule, file: l.file })); } catch { /* no corpus is no lesson */ }
  const report = buildReport(state, { listings: readListings(), hooks: hookVerbs(), lessons });
  const stable = report.surfaces.filter((s) => !VOLATILE_SURFACES.includes(s.id) && s.bytes !== null);
  const surfaces = Object.fromEntries(stable.map((s) => [s.id, s.bytes]));
  const features = {};
  for (const [id, f] of Object.entries(report.features)) {
    const own = stable.filter((s) => s.feature === id && !s.conditional && !s.perDispatch);
    features[id] = { on: f.on, bytes: own.reduce((a, s) => a + s.bytes, 0) };
  }
  return { features, surfaces };
}

/** The `devLog` option `ingest` takes: `{ enabledAtMs, snapshot }` when BOTH switches are on in the MAIN tree's
 *  state, else null. The ONE place that decides, so every caller of `ingestForReport` captures or none does. */
export function devLogOptions(state) {
  if (!devLogEnabled(state) || !spendEnabled(state)) return null;
  const enabledAtMs = Date.parse(state.devLog.enabledAt);
  if (!Number.isFinite(enabledAtMs)) return null;
  return { enabledAtMs, snapshot: () => featuresSnapshot(state) };
}
