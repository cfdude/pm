// scripts/lib/dev-log-report.mjs
// developer-session-log -- the `dev-log` verb: ingest, then report PER SESSION, and the log's inverse.
//
//   dev-log [--session-id <id>] [--since <iso>] [--until <iso>] [--json] [--no-ingest]
//   dev-log --clear [--yes]
//
// `--session-id` names a CLAUDE CODE TRANSCRIPT session. It is not `--session`, which is pm's own session identity
// (epic-session-attribution): two meanings must not share one flag.
//
// WHAT IT JOINS. A message entry holds composition (bytes) only. Token classes and `work` come from the ledger row
// with the same `messageId` and are summed by the same totals builder `spend` uses; a message whose row is gone
// (after `spend --clear`) reports `tokens: not in ledger`. Byte counts are labelled bytes and never converted to
// tokens here.
//
// WARNINGS (design D5) are named constants labelled PROPOSALS, each reported with its evidence and threshold:
//   stale-session  first to last message at least STALE_SESSION_DAYS (Rob's example: seven days, one window)
//   large-context  a message whose input + cacheCreation + cacheRead is at least LARGE_CONTEXT_TOKENS
//   compacted      the transcript recorded a compaction (a `compact_boundary` system entry; shape in shapes-1.1.txt)
//
// THE LOG IS OFF, OR TRACKING IS: it says which switch and names the verb to run first, and opens no path under the
// spend directory or the transcript directory. `--clear` prints its plan and changes nothing without `--yes`.

import os from "node:os";
import { isInitialized } from "./state.mjs";
import { parseFlags, requireFlagValues } from "./add-epic.mjs";
import { die } from "./command-exit.mjs";
import { escapeControls, jsonText } from "./constants.mjs";
import { currentArgv, currentEnv, outStream } from "./invocation.mjs";
import { mainTreeDetached, resolveMainTree, spendDir } from "./spend-tree.mjs";
import { spendEnabled } from "./spend-switch.mjs";
import { devLogEnabled } from "./dev-log.mjs";
import { ingestForReport, readMainState } from "./spend-command.mjs";
import { readLedger, withLedgerLock } from "./spend-ledger.mjs";
import { addTo, emptyTotals } from "./spend-report.mjs";
import { DEVLOG_FILE, devLogSize, readDevLog, removeDevLog } from "./dev-log-capture.mjs";

/** PROPOSALS, not measurements. The large-context figure is anchored on the one measured outlier, which ran about
 *  379K cache-read per message (token-spend assessment section 6); the stale figure is Rob's example. */
export const STALE_SESSION_DAYS = 7;
export const LARGE_CONTEXT_TOKENS = 300000;
const DAY_MS = 24 * 60 * 60 * 1000;

const refuse = (msg) => die(`conductor: ${msg}\n`);

/** The per-message context the large-context rule reads: everything the model was shown. */
export const contextOf = (r) => r.input + r.cacheCreation + r.cacheRead;

const addComposition = (t, e) => {
  t.userText += e.userText || 0; t.attachments += e.attachments || 0; t.images += e.images || 0;
  t.textBytes += e.textBytes || 0; t.thinkingBytes += e.thinkingBytes || 0;
  for (const [k, v] of Object.entries(e.toolResults || {})) t.toolResults[k] = (t.toolResults[k] || 0) + (v || 0);
};
const emptyComposition = () => ({ userText: 0, toolResults: {}, attachments: 0, images: 0, textBytes: 0, thinkingBytes: 0 });

/** The sessions, from the log's entries and the ledger's folded rows. PURE. `filters`: `{sessionId, since, until}`
 *  (ISO strings; `since`/`until` half-open `[since, until)` on a message's own time). */
export function buildSessions({ entries, rows, filters = {} }) {
  const sinceMs = filters.since ? Date.parse(filters.since) : null;
  const untilMs = filters.until ? Date.parse(filters.until) : null;
  const rowById = new Map(rows.map((r) => [r.messageId, r]));
  const snapshots = entries.filter((e) => e.type === "features").sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const compactions = entries.filter((e) => e.type === "compaction");
  const bySession = new Map();
  for (const e of entries) {
    if (e.type !== "message") continue;
    const t = Date.parse(e.at);
    if (!Number.isFinite(t)) continue;
    if ((sinceMs !== null && t < sinceMs) || (untilMs !== null && t >= untilMs)) continue;
    const sid = e.sessionId || "unknown";
    if (filters.sessionId !== undefined && sid !== filters.sessionId) continue;
    if (!bySession.has(sid)) bySession.set(sid, []);
    bySession.get(sid).push(e);
  }
  const sessions = [];
  for (const [sessionId, msgs] of bySession) {
    msgs.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const first = msgs[0].at, last = msgs[msgs.length - 1].at;
    const tokens = emptyTotals();
    const composition = emptyComposition();
    let notInLedger = 0, biggest = null, large = 0;
    for (const m of msgs) {
      addComposition(composition, m);
      const row = rowById.get(m.messageId);
      if (!row) { notInLedger++; continue; }
      addTo(tokens, row);
      const ctx = contextOf(row);
      if (ctx >= LARGE_CONTEXT_TOKENS) { large++; if (!biggest || ctx > biggest.context) biggest = { messageId: m.messageId, at: m.at, context: ctx }; }
    }
    const firstMs = Date.parse(first), lastMs = Date.parse(last);
    const before = snapshots.filter((s) => Date.parse(s.at) <= firstMs);
    const inForce = before.length ? before[before.length - 1] : (snapshots[0] || null);
    const changedDuring = snapshots.filter((s) => Date.parse(s.at) > firstMs && Date.parse(s.at) <= lastMs).map((s) => s.at);
    const warnings = [];
    if (lastMs - firstMs >= STALE_SESSION_DAYS * DAY_MS) {
      warnings.push({ rule: "stale-session", first, last, thresholdDays: STALE_SESSION_DAYS, spanDays: Math.round(((lastMs - firstMs) / DAY_MS) * 10) / 10 });
    }
    if (biggest) warnings.push({ rule: "large-context", messages: large, largest: biggest, threshold: LARGE_CONTEXT_TOKENS });
    const mine = compactions.filter((c) => (c.sessionId || "unknown") === sessionId);
    if (mine.length) warnings.push({ rule: "compacted", count: mine.length, at: mine.map((c) => c.at) });
    sessions.push({
      sessionId, messages: msgs.length, first, last,
      tokens: { ...tokens, notInLedger: notInLedger ? `${notInLedger} message(s): tokens: not in ledger` : null },
      composition,
      features: inForce
        ? { at: inForce.at, capturedAfterSessionStart: Date.parse(inForce.at) > firstMs, features: inForce.features }
        : null,
      featuresChangedDuring: changedDuring,
      warnings,
    });
  }
  sessions.sort((a, b) => Date.parse(a.first) - Date.parse(b.first));
  return sessions;
}

const n = (x) => x.toLocaleString("en-US");
const featuresLine = (f) => Object.entries(f).map(([id, v]) => `${id} ${v.on ? "on" : "off"}${v.on && v.bytes ? ` (${n(v.bytes)} B)` : ""}`).join(", ");

/** The text report, as lines ALREADY escaped: a session id, a tool name and a feature id come from transcript and log
 *  text, so no value reaches a stream raw. */
export function renderDevLog(report) {
  const L = [];
  if (report.off) { L.push(report.off); return L.map(escapeControls); }
  L.push(`developer log: ${report.sessions.length} session(s)${report.filters.sessionId ? ` matching --session-id` : ""}`);
  for (const s of report.sessions) {
    L.push("");
    L.push(`session ${s.sessionId}: ${s.messages} message(s), ${s.first} to ${s.last}`);
    const t = s.tokens;
    L.push(`  tokens: input ${n(t.input)} · cache-write ${n(t.cacheCreation)} · cache-read ${n(t.cacheRead)} · output ${n(t.output)} · work ${n(t.work)}${t.notInLedger ? ` · ${t.notInLedger}` : ""}`);
    const c = s.composition;
    const tools = Object.entries(c.toolResults).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${n(v)}`).join(", ");
    L.push(`  composition (BYTES, not tokens): user text ${n(c.userText)} · attachments ${n(c.attachments)} · images ${c.images} · response text ${n(c.textBytes)} · thinking ${n(c.thinkingBytes)}`);
    L.push(`  tool results (bytes): ${tools || "none"}`);
    L.push(s.features
      ? `  features${s.features.capturedAfterSessionStart ? " (snapshot taken after the session began)" : ""}: ${featuresLine(s.features.features)}`
      : "  features: no snapshot recorded");
    if (s.featuresChangedDuring.length) L.push(`  the features changed during this session (snapshot at ${s.featuresChangedDuring.join(", ")})`);
    for (const w of s.warnings) {
      if (w.rule === "stale-session") L.push(`  WARNING stale-session: ${w.first} to ${w.last} is ${w.spanDays} days (threshold ${w.thresholdDays} days, a proposal) in one context window; start a new session`);
      else if (w.rule === "large-context") L.push(`  WARNING large-context: ${w.messages} message(s) at or above ${n(w.threshold)} tokens of context (a proposal); largest ${n(w.largest.context)} at ${w.largest.at}`);
      else if (w.rule === "compacted") L.push(`  WARNING compacted: the transcript recorded ${w.count} compaction(s) at ${w.at.join(", ")}`);
    }
  }
  return L.map(escapeControls);
}

/** `dev-log` */
export function devLogVerb() {
  if (!isInitialized()) { die("conductor: run /pm:init first\n"); }
  const f = parseFlags(currentArgv().slice(3));
  requireFlagValues("dev-log", f);
  const on = (name) => f[name] === true || (Array.isArray(f[name]) && f[name].length > 0 && f[name].every((v) => v === true));
  const clear = on("clear"), yes = on("yes");
  const reportFlags = ["session-id", "since", "until", "json", "no-ingest"].filter((k) => f[k] !== undefined);
  if (yes && !clear) refuse("dev-log --yes confirms --clear; without it there is nothing to confirm. Nothing was changed.");
  if (clear && reportFlags.length) {
    refuse(`dev-log --clear acts on the whole log and takes only --yes; --${reportFlags.join(", --")} would be ignored, which reads as a narrower operation than it is. Nothing was changed.`);
  }
  const iso = (flag) => {
    if (f[flag] === undefined) return null;
    if (!Number.isFinite(Date.parse(String(f[flag])))) refuse(`dev-log --${flag} needs an ISO-8601 timestamp, not '${escapeControls(String(f[flag]))}'.`);
    return String(f[flag]);
  };
  const since = iso("since"), until = iso("until");

  const tree = resolveMainTree();
  const r = readMainState(tree);
  if (r.reason) refuse(`dev-log could not read the main working tree's state.json (${escapeControls(tree.main)}) — it is ${r.reason}.`);
  const state = r.state;
  const tracking = spendEnabled(state), logOn = devLogEnabled(state);

  if (clear) return runClear(tree, { tracking, yes });
  const json = on("json");
  const emitOff = (message) => {
    const report = { off: message, sessions: [], filters: {} };
    outStream().write(json ? jsonText(report, null, 2) + "\n" : escapeControls(message) + "\n");
  };
  // Which switch is off, and the verb to run first. NO spend or transcript path is opened for either.
  if (!tracking) return emitOff("the developer log needs spend tracking, which is off: run `set-spend-tracking on`, then `set-dev-log on`. Nothing was read.");
  if (!logOn) return emitOff("the developer log is off: run `set-dev-log on`. Nothing was read.");

  const enabledAtMs = Date.parse(state.spendTracking && state.spendTracking.enabledAt);
  if (!Number.isFinite(enabledAtMs)) {
    refuse("state.spendTracking.enabledAt is missing or unreadable, so there is no start to bound an ingest by. Run set-spend-tracking off, then on, to stamp a fresh start. Nothing was ingested.");
  }
  const env = currentEnv();
  const readCtx = { mainRoot: tree.main, env, home: env.HOME || os.homedir() };
  const ingestInfo = ingestForReport({ noIngest: on("no-ingest"), enabled: true, tree, readCtx, enabledAtMs, state });
  const ledger = readLedger(tree.main);
  const log = readDevLog(tree.main);
  const filters = { sessionId: typeof f["session-id"] === "string" ? f["session-id"] : undefined, since, until };
  const sessions = buildSessions({ entries: log.entries, rows: ledger.rows, filters });
  const report = {
    thresholds: { staleSessionDays: STALE_SESSION_DAYS, largeContextTokens: LARGE_CONTEXT_TOKENS, status: "proposals" },
    log: { file: DEVLOG_FILE, exists: log.exists, unreadableLines: log.corrupt },
    ingest: ingestInfo.ran ? { ran: true, devLog: ingestInfo.devLog || null } : { ran: false, reason: ingestInfo.reason },
    filters, sessions,
  };
  if (json) { outStream().write(jsonText(report, null, 2) + "\n"); return; }
  const lines = renderDevLog(report);
  const extra = [];
  if (!ingestInfo.ran) extra.push("", `ingest: ${ingestInfo.reason}`);
  if (log.corrupt) extra.push(`log: ${log.corrupt} unreadable line(s) were skipped`);
  outStream().write([...lines, ...extra.map(escapeControls)].join("\n") + "\n");
}

function runClear(tree, { tracking, yes }) {
  // Refused while tracking is off, touching nothing: with tracking off spend-ledger allows only `spend` and
  // `set-spend-tracking` in the spend directory, so not even a stat of it happens here.
  if (!tracking) refuse("dev-log --clear is refused while spend tracking is off — run `set-spend-tracking on` first. Nothing was changed.");
  const size = devLogSize(tree.main);
  const dir = spendDir(tree.main);
  const lines = [];
  if (size === null) lines.push(`dev-log --clear: nothing to remove in ${dir}`);
  else {
    lines.push(`dev-log --clear would remove from ${dir}:`);
    lines.push(`  ${DEVLOG_FILE} (${n(size)} byte${size === 1 ? "" : "s"})`);
    lines.push("  kept: the ledger rows, cursor, markers and timeline");
  }
  if (!yes) lines.push("Nothing was changed. Re-run with --yes to apply.");
  outStream().write(lines.map(escapeControls).join("\n") + "\n");
  if (!yes) return;
  if (mainTreeDetached(tree.main)) refuse("dev-log --clear is refused: the main working tree's HEAD is detached, and ledger writes are suppressed there. Nothing was changed.");
  const got = withLedgerLock(tree.main, () => removeDevLog(tree.main));
  if (got.busy) refuse("dev-log --clear is refused: an ingest is in progress (ingest.lock is held). Nothing was changed.");
  outStream().write(escapeControls(`dev-log --clear: removed ${got.value ? DEVLOG_FILE : "nothing"}`) + "\n");
}
