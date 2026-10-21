// scripts/lib/spend-guard-verbs.mjs
// spend-budget-and-stuck-loop-guard — the three verbs: `set-spend-guard`, `spend-guard` and
// `override-spend-guard`. The decisions are the pure functions in spend-guard.mjs; this file owns argv,
// the state write, the one read of the ledger and the output.
//
// pm is an INSTRUCTION layer. Nothing here dispatches an agent, kills a process or opens a network
// connection; `spend-guard` reads state and (with tracking on) the local spend ledger, and says what to do.
//
// WHICH TREE (D5a). Limits, tallies and overrides come from the `state.json` of the tree the verb runs in
// — the file `record-gate-review`, `set-spend-guard` and `override-spend-guard` write there. Only the
// tracking switch and the ledger come from the MAIN working tree, as `spend` reads them.

import { isInitialized, loadState, saveState } from "./state.mjs";
import { reportSave, STATE_UNCHANGED } from "./save-report.mjs";
import { checkedPositionals } from "./argv-surface.mjs";
import { parseFlags, requireFlagValues } from "./add-epic.mjs";
import { render } from "./render.mjs";
import { rulesBlockShowsSpendGuard, writeRules } from "./rules.mjs";
import { resolvePlatform } from "./platform.mjs";
import { CommandExit, die } from "./command-exit.mjs";
import { currentArgv, currentEnv, errStream, outStream } from "./invocation.mjs";
import {
  KNOWN_LANES, KNOWN_MODELS, SPEND_GUARD_STOP_EXIT_CODE, escapeControls, jsonText,
} from "./constants.mjs";
import { spendEnabled } from "./spend-switch.mjs";
import { resolveMainTree } from "./spend-tree.mjs";
import { ingestForReport, readMainState } from "./spend-command.mjs";
import { readLedger } from "./spend-ledger.mjs";
import { attribute } from "./spend-attribution.mjs";
import { buildReport, emptyTotals } from "./spend-report.mjs";
import {
  GUARD_FIELDS, GUARD_SIGNALS, SIGNAL_ROLE, checkMaxFailedRounds, checkTokenBasis, checkTokenCeiling, checkWarnAt,
  LOW_TOTAL_CEILING_FLOOR,
  guardConfigured, guardLivenessChanged, ledgerRounds, liveOverrides, passAnchor, resolveGuard, rolePair, roundsSignal, escalationRank,
  stopBlock, targetFor, tokenSignal, unrevokedOverrides,
} from "./spend-guard.mjs";
import os from "node:os";

const refuse = (msg) => die(`conductor: ${msg}\n`);
const asArray = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// ─────────────── set-spend-guard: parsing and the pure write ───────────────

const UNSET_FIELD = { "max-failed-rounds": "maxFailedRounds", tokens: "tokenCeiling", "token-basis": "tokenBasis", "warn-at": "warnAt" };
const UNSET_NAMES = [...Object.keys(UNSET_FIELD), "all"];
const FLAG_OF = { maxFailedRounds: "--max-failed-rounds", tokenCeiling: "--tokens", tokenBasis: "--token-basis", warnAt: "--warn-at" };

/** `set-spend-guard`'s parsed flags -> `{ ok: true, ops }` or `{ ok: false, message }` naming the first
 *  refusal. PURE. `epicIds` are the registered ids. Refuses: both `--epic` and `--lane`; an unknown
 *  lane or epic; any value outside its range (the message names it and what is accepted); an unknown
 *  `--unset` field; nothing to set; a field both set and unset in one call. */
export function parseSetSpendGuard(f, epicIds) {
  const epic = f.epic, lane = f.lane;
  if (epic !== undefined && lane !== undefined) {
    return { ok: false, message: "set-spend-guard takes --epic or --lane, not both" };
  }
  if (lane !== undefined && !KNOWN_LANES.includes(lane)) {
    return { ok: false, message: `--lane '${escapeControls(String(lane))}' is not one of ${KNOWN_LANES.join("|")}` };
  }
  if (epic !== undefined && !epicIds.includes(epic)) {
    return { ok: false, message: `--epic '${escapeControls(String(epic))}' — no epic with that id is registered` };
  }
  const sets = {};
  const checks = [
    ["maxFailedRounds", f["max-failed-rounds"], checkMaxFailedRounds],
    ["tokenCeiling", f.tokens, checkTokenCeiling],
    ["tokenBasis", f["token-basis"], checkTokenBasis],
    ["warnAt", f["warn-at"], checkWarnAt],
  ];
  for (const [field, raw, check] of checks) {
    if (raw === undefined) continue;
    const c = check(raw);
    if (!c.ok) return c;
    sets[field] = c.value;
  }
  const unsets = [];
  for (const u of asArray(f.unset)) {
    if (!UNSET_NAMES.includes(u)) {
      return { ok: false, message: `--unset '${escapeControls(String(u))}' is not one of ${UNSET_NAMES.join("|")}` };
    }
    for (const field of u === "all" ? GUARD_FIELDS : [UNSET_FIELD[u]]) if (!unsets.includes(field)) unsets.push(field);
  }
  if (!Object.keys(sets).length && !unsets.length) {
    return {
      ok: false,
      message: "set-spend-guard needs an operation — --max-failed-rounds <n>, --tokens <n>, --token-basis <total|work>, --warn-at <pct> " +
        `or --unset ${UNSET_NAMES.join("|")}. Nothing was written.`,
    };
  }
  const clash = Object.keys(sets).find((k) => unsets.includes(k));
  if (clash) return { ok: false, message: `${FLAG_OF[clash]} is both set and unset in one call — say one or the other` };
  return { ok: true, ops: { epic, lane, sets, unsets } };
}

const snapshot = (state) => JSON.stringify([state.spendGuard, state.laneSpendGuards, (state.epics || []).map((e) => e.spendGuard)]);

/** Apply parsed ops to `state` in place. Returns `{ changed, already, described }`. A layer left with no
 *  field is REMOVED, so it is indistinguishable from one never configured; the lane map likewise. */
export function applyGuardOps(state, ops) {
  const before = snapshot(state);
  const epic = ops.epic ? state.epics.find((e) => e.id === ops.epic) : undefined;
  const container = epic ? epic.spendGuard : ops.lane ? (isObj(state.laneSpendGuards) ? state.laneSpendGuards[ops.lane] : undefined) : state.spendGuard;
  const layer = isObj(container) ? { ...container } : {};
  const already = [];
  const described = [];
  for (const [field, value] of Object.entries(ops.sets)) {
    layer[field] = value;
    described.push(`${field}=${value}`);
  }
  for (const field of ops.unsets) {
    if (layer[field] === undefined) already.push(field);
    else { delete layer[field]; described.push(`unset ${field}`); }
  }
  const empty = Object.keys(layer).length === 0;
  if (epic) {
    if (empty) delete epic.spendGuard; else epic.spendGuard = layer;
  } else if (ops.lane) {
    const lanes = isObj(state.laneSpendGuards) ? { ...state.laneSpendGuards } : {};
    if (empty) delete lanes[ops.lane]; else lanes[ops.lane] = layer;
    if (Object.keys(lanes).length === 0) delete state.laneSpendGuards; else state.laneSpendGuards = lanes;
  } else if (empty) {
    delete state.spendGuard;
  } else {
    state.spendGuard = layer;
  }
  return { changed: snapshot(state) !== before, already, described };
}

/** The one-line warning for a low `total`-basis ceiling, or null. PURE. `state` is the record AFTER the write, so
 *  the basis it resolves is the one the written layer will actually be counted in (a lane or epic that also
 *  set `--token-basis work` in this same call, or one inherited from a layer above, is honoured). */
export function lowCeilingNotice(state, ops) {
  const n = ops.sets.tokenCeiling;
  if (n === undefined || n >= LOW_TOTAL_CEILING_FLOOR) return null;
  const basis = resolveGuard(state, { epicId: ops.epic, lane: ops.lane }).tokenBasis.value;
  if (basis !== "total") return null;
  return escapeControls(
    `conductor: note — a total counts cache-read on every message, so ${n.toLocaleString("en-US")} is low for a total-basis ceiling ` +
    `(${LOW_TOTAL_CEILING_FLOOR.toLocaleString("en-US")} is the GitHub #251 reporter's suggested floor, not a measurement); ` +
    "the value is recorded. To count only input, cache-write and output, add --token-basis work.");
}

/** `set-spend-guard [--epic <id> | --lane <lane>] [--max-failed-rounds <n>] [--tokens <n>]
 *  [--token-basis total|work] [--warn-at <pct>] [--unset max-failed-rounds|tokens|token-basis|warn-at|all]...` — writes the project layer, one
 *  lane's, or one epic's. Every set has its inverse in `--unset`. The managed rules block is refreshed
 *  only when "a limit is configured" flips, because that is the one fact the block carries. */
export function setSpendGuard() {
  if (!isInitialized()) { die("conductor: run /pm:init first\n"); }
  const f = parseFlags(currentArgv().slice(3));
  requireFlagValues("set-spend-guard", f);
  const state = loadState();
  const parsed = parseSetSpendGuard(f, state.epics.map((e) => e.id));
  if (!parsed.ok) die(`conductor: ${parsed.message}\n`);
  const wasConfigured = guardConfigured(state);
  const { changed, already, described } = applyGuardOps(state, parsed.ops);
  const lowNotice = lowCeilingNotice(state, parsed.ops);
  const where = parsed.ops.epic ? `epic ${escapeControls(parsed.ops.epic)}` : parsed.ops.lane ? `lane ${escapeControls(parsed.ops.lane)}` : "project";
  const notes = already.length ? ` (already unset: ${already.join(", ")})` : "";
  if (!changed) {
    outStream().write(`conductor: ${where} spend guard unchanged${notes} — ${STATE_UNCHANGED}\n`);
    if (lowNotice) outStream().write(`${escapeControls(lowNotice)}\n`);
    return;
  }
  const saved = saveState(state);
  if (guardConfigured(state) !== wasConfigured) writeRules(resolvePlatform({}, state));
  render();
  reportSave(saved, {
    changed: `conductor: ${where} spend guard: ${described.join(", ")}${notes}`,
    unchanged: `conductor: ${where} spend guard already held exactly this — ${STATE_UNCHANGED}`,
  });
  if (lowNotice) outStream().write(`${escapeControls(lowNotice)}\n`);
  if (parsed.ops.sets.tokenCeiling !== undefined && !spendEnabled(state)) {
    outStream().write("conductor: note — tokenCeiling is recorded but will not be checked until you run set-spend-tracking on; spend tracking is off, so the guard is counting rounds only.\n");
  }
}

/** Keep the rules block's `## Spend guard` section equal to "a limit is configured" after ANY verb that
 *  wrote state (spend-guard-rules-section-follows-live-limits). `before` is the dispatch wrapper's
 *  snapshot, `after` the one image read once the verb returned. The block is rewritten only when the
 *  section on disk disagrees with `guardConfigured(after)`, which makes it exact on four counts: a verb
 *  that already refreshed (`set-spend-guard`) is not refreshed twice; a write that leaves liveness alone
 *  rewrites nothing; a liveness change a HOOK's self-heal left unreflected is picked up here, by the next
 *  non-hook write; and a repository with no managed block is never given one. A failure is a warning, not
 *  a failed verb: the state write already happened. */
export function refreshSpendGuardSection(before, after) {
  try {
    const platform = resolvePlatform({}, after);
    const shown = rulesBlockShowsSpendGuard(platform);
    const configured = guardConfigured(after);
    if (shown === null || shown === configured) return;
    writeRules(platform);
  } catch (e) {
    const why = guardLivenessChanged(before, after) ? "this write changed whether a spend limit is configured" : "the block on disk disagrees with the configured spend limits";
    errStream().write(`conductor: warning — ${escapeControls(why)}, but the rules block's Spend guard section could not be refreshed (${escapeControls(String(e && e.message))}). Run \`write-rules\` to refresh the rules block.\n`);
  }
}

// ─────────────── the evaluation shared by spend-guard and override-spend-guard ───────────────

const INGEST_BUSY = "an ingest was already in progress";

/** Everything `spend-guard` reports, computed once. Reads the invoking tree's `state` (already loaded by
 *  the caller) and, only while tracking is ON in the main tree, the ledger (after an ingest unless
 *  `noIngest`). Never refuses on a ledger problem: it records the reason and degrades to the recorded
 *  verdicts (D5). The only refusal is an unreadable record in the main tree itself, which `loadState()`
 *  raises as it does everywhere. */
function evaluate(state, epic, { noIngest }) {
  const resolved = resolveGuard(state, { epicId: epic.id });
  const notes = [];
  const tree = resolveMainTree();
  const main = readMainState(tree);
  let tracking, mainState = null;
  if (main.reason) {
    tracking = "unknown";
    notes.push(`spend tracking is unknown: the main working tree's state.json (${escapeControls(tree.main)}) is ${main.reason}, so the ledger was not read`);
  } else {
    mainState = main.state;
    tracking = spendEnabled(mainState) ? "on" : "off";
  }

  // The ledger side and the token total. `ledger.side` null = not computed; `status` is tokenSignal()'s.
  let ledgerSide = null;
  let tokenStatus;
  let ledgerNote;
  let coverage = null;
  let ingestInfo = null;
  if (tracking === "off") {
    ledgerNote = "ledger review rounds were not read because spend tracking is off";
    tokenStatus = { checked: false, kind: "off", why: "spend tracking is off; the guard is counting rounds only" };
  } else if (tracking === "unknown") {
    ledgerNote = "ledger review rounds were not read (tracking unknown)";
    tokenStatus = { checked: false, kind: "unread", why: "the main working tree's state.json could not be read, so the ledger was not read" };
  } else {
    const enabledAtMs = Date.parse(mainState.spendTracking && mainState.spendTracking.enabledAt);
    if (!Number.isFinite(enabledAtMs)) {
      ledgerNote = "ledger review rounds were not read: state.spendTracking.enabledAt is unreadable";
      tokenStatus = { checked: false, kind: "unread", why: "state.spendTracking.enabledAt is missing or unreadable; run set-spend-tracking off, then set-spend-tracking on, to stamp a fresh start" };
    } else {
      try {
        const env = currentEnv();
        const readCtx = { mainRoot: tree.main, env, home: env.HOME || os.homedir() };
        ingestInfo = ingestForReport({ noIngest, enabled: true, tree, readCtx, enabledAtMs, state: mainState });
        const ledger = readLedger(tree.main);
        const attributed = attribute(ledger.rows, ledger.markers, ledger.timeline, mainState);
        const report = buildReport({ attributed, tracking: mainState.spendTracking, ingest: ingestInfo, filters: { epic: epic.id } });
        ledgerSide = ledgerRounds(attributed, epic.id, passAnchor(epic));
        const t = report.epics[epic.id] ? report.epics[epic.id].totals : emptyTotals();
        tokenStatus = {
          checked: true, total: t.total, work: t.work,
          breakdown: { input: t.input, cacheCreation: t.cacheCreation, cacheRead: t.cacheRead, output: t.output, work: t.work, total: t.total },
        };
        coverage = report.coverage.share;
        if (!ingestInfo.ran) {
          notes.push(`the ledger was not refreshed (${ingestInfo.busy ? INGEST_BUSY : ingestInfo.reason}); counts may be stale`);
        }
      } catch (e) {
        if (e instanceof CommandExit) throw e;
        ledgerSide = null;
        ledgerNote = `ledger review rounds were not read: the ledger could not be read (${escapeControls(String(e && e.message))})`;
        tokenStatus = { checked: false, kind: "unread", why: `the ledger could not be read (${escapeControls(String(e && e.message))})` };
      }
    }
  }
  const rounds = roundsSignal(epic, resolved, { side: ledgerSide, note: ledgerNote });
  const tokens = tokenSignal(epic, resolved, tokenStatus);
  const targets = {};
  for (const s of GUARD_SIGNALS) targets[s] = targetFor(epic, s, rolePair(state, epic.id, SIGNAL_ROLE[s]));
  return { resolved, tracking, notes, rounds, tokens, targets, coverage, ingest: ingestInfo };
}

/** The notices about the epic's own record: a gate whose latest verdict is withdrawn (the tally was not undone,
 *  so a withdrawn pass neither restores the streak it ended nor stops anchoring the ledger side and override
 *  liveness), and a gate that carries a verdict recorded before the tally existed (nothing backfills it). */
function withdrawnNotices(epic) {
  const out = [];
  const rounds = isObj(epic.gateRounds) ? epic.gateRounds : {};
  const before = Object.keys(isObj(epic.gateReview) ? epic.gateReview : {}).filter((k) => /^gate\d$/.test(k) && !isObj(rounds[k])).sort();
  if (before.length) {
    out.push(`${before.map((k) => k.replace("gate", "gate ")).join(" and ")} carr${before.length === 1 ? "ies a verdict" : "y verdicts"} recorded before the round tally existed: its recorded fail streak reads 0 and it has no pass anchor — counting starts from the first verdict recorded by this release`);
  }
  const gates = isObj(epic.gateReview) ? epic.gateReview : {};
  const withdrawn = Array.isArray(epic.withdrawnGateReviews) ? epic.withdrawnGateReviews : [];
  const tallies = isObj(epic.gateRounds) ? epic.gateRounds : {};
  for (const key of Object.keys(tallies).sort()) {
    const n = Number(key.replace("gate", ""));
    if (gates[key]) continue;
    const last = [...withdrawn].reverse().find((w) => w && w.gate === n && isObj(w.entry));
    if (!last) continue;
    const verdict = last.entry.verdict;
    out.push(verdict === "pass"
      ? `gate ${n}'s latest verdict, a pass, is withdrawn: the fail streak it ended is not restored, and it still anchors the ledger side and override liveness`
      : `gate ${n}'s latest verdict, a ${escapeControls(String(verdict))}, is withdrawn: its round still counts toward the tally`);
  }
  return out;
}

const limitText = (s) => (s.limit === null ? "none" : `${s.limit} (${s.source})`);

/** The text report. Every line leaves through escapeControls (an epic id and stored text are not ours). */
function reportLines(epic, ev, notices) {
  const lines = [];
  const r = ev.rounds, t = ev.tokens;
  lines.push(`spend-guard — epic ${epic.id} · tracking ${ev.tracking}`);
  const ledgerPart = r.ledger === null ? `ledger not read` : `ledger ${r.ledger}`;
  lines.push(`rounds: ${r.state} — count ${r.count}, limit ${limitText(r)}, baseline ${r.baseline} · recorded ${r.recorded}${r.recordedGate ? ` (${r.recordedGate})` : ""} · ${ledgerPart} · decided by ${r.decidedBy} · pass anchor ${passAnchor(epic) || "none"}`);
  if (r.note) lines.push(`  ${r.note}`);
  if (r.overrideSpent) lines.push("  the latest rounds override is spent: a pass was recorded after it, so its baseline no longer applies");
  if (t.state === "not-checked") lines.push(`tokens: not checked — ${t.reason}`);
  else if (t.state === "not-read") lines.push(`tokens: not read — ${t.reason}`);
  else if (t.limit === null) lines.push(`tokens: no limit set (attributed ${t.count === null ? "n/a" : t.count.toLocaleString("en-US")} ${t.basis})`);
  else {
    lines.push(`tokens: ${t.state} — ${t.count.toLocaleString("en-US")} ${t.basis} attributed, ceiling ${limitText(t)}, baseline ${t.baseline.toLocaleString("en-US")}, warn at ${t.warnAt}%`);
    lines.push(`  coverage: ${ev.coverage === null ? "n/a (no spend in the ledger)" : `${(ev.coverage * 100).toFixed(1)}%`} of ledger tokens are attributed to an epic; unattributed tokens are not charged to this epic`);
  }
  if (t.breakdown) {
    const b = t.breakdown, c = (v) => v.toLocaleString("en-US");
    lines.push(`  basis: ${t.basis} (${t.basisSource}) · input ${c(b.input)} · cache-write ${c(b.cacheCreation)} · cache-read ${c(b.cacheRead)} · output ${c(b.output)} · work ${c(b.work)} · total ${c(b.total)}`);
  }
  if (t.overrideSetAside) lines.push(`  the latest tokens override is set aside: it was recorded in the ${t.overrideSetAside} basis and this epic now counts ${t.basis}, so no baseline applies`);
  const live = [...liveOverrides(epic, "rounds"), ...liveOverrides(epic, "tokens")];
  lines.push(`overrides: ${live.length ? live.map((o) => `${o.signal} baseline ${o.baseline} -> ${o.escalatedTo}`).join("; ") : "none live"}`);
  for (const s of GUARD_SIGNALS) {
    const x = ev.targets[s];
    lines.push(`escalation (${s}): ${x.target} or the user — from ${SIGNAL_ROLE[s]} model ${x.from === null ? "none" : x.from}${x.source ? ` (${x.source})` : ""}${x.why ? `; ${x.why}` : ""}`);
  }
  for (const n of [...ev.notes, ...notices]) lines.push(`note: ${n}`);
  return lines.map(escapeControls);
}

/** `spend-guard <epicId> [--json] [--no-ingest]` — exit 0 while no signal is tripped, 2 (after the STOP
 *  block) while any is. Writes nothing to `state.json`. NEVER wire it into a hook: exit 2 is the hook block. */
export function spendGuard() {
  if (!isInitialized()) { die("conductor: run /pm:init first\n"); }
  const [epicId] = checkedPositionals("spend-guard");
  if (!epicId) die("usage: conductor.mjs spend-guard <epicId> [--json] [--no-ingest]\n");
  const f = parseFlags(currentArgv().slice(3));
  requireFlagValues("spend-guard", f);
  const on = (name) => f[name] === true || (Array.isArray(f[name]) && f[name].length > 0 && f[name].every((v) => v === true));
  const state = loadState();
  const epic = state.epics.find((e) => e.id === epicId);
  if (!epic) refuse(`spend-guard: no epic '${escapeControls(String(epicId))}' is registered. Nothing was read.`);

  const ev = evaluate(state, epic, { noIngest: on("no-ingest") });
  const tripped = GUARD_SIGNALS.filter((s) => ev[s === "rounds" ? "rounds" : "tokens"].state === "tripped");
  const stop = tripped.length
    ? stopBlock(epic.id, Object.fromEntries(tripped.map((s) => [s, s === "rounds" ? ev.rounds : ev.tokens])),
      Object.fromEntries(tripped.map((s) => [s, ev.targets[s]])))
    : [];
  const notices = withdrawnNotices(epic);
  if (on("json")) {
    const sig = (x) => ({ ...x, override: undefined });
    const out = {
      epic: epic.id, stuck: tripped.length > 0,
      signals: { rounds: sig(ev.rounds), tokens: sig(ev.tokens) },
      overrides: Array.isArray(epic.spendGuardOverrides) ? epic.spendGuardOverrides : [],
      escalation: ev.targets, passAnchor: passAnchor(epic), tracking: ev.tracking, coverage: ev.coverage, notes: [...ev.notes, ...notices],
      ...(stop.length ? { stop } : {}),
    };
    outStream().write(jsonText(out, null, 2) + "\n");
  } else {
    const lines = [...reportLines(epic, ev, notices), ...stop];
    outStream().write(lines.map(escapeControls).join("\n") + "\n");
  }
  if (tripped.length) throw new CommandExit(SPEND_GUARD_STOP_EXIT_CODE);
}

// ─────────────── override-spend-guard ───────────────

/** `override-spend-guard <epicId> --signal rounds|tokens --escalated-to user|<model> --reason "<why>"` and
 *  its inverse `override-spend-guard <epicId> --signal <s> --revoke --reason "<why>"`. An override is
 *  accepted only while the signal is tripped (it cannot pre-authorize), must rank at or above the
 *  computed escalation target, and no autonomy grant covers it. */
export function overrideSpendGuard() {
  if (!isInitialized()) { die("conductor: run /pm:init first\n"); }
  const [epicId] = checkedPositionals("override-spend-guard");
  if (!epicId) die("usage: conductor.mjs override-spend-guard <epicId> --signal rounds|tokens --escalated-to user|<model> --reason \"<why>\" | --revoke --reason \"<why>\"\n");
  const f = parseFlags(currentArgv().slice(3));
  requireFlagValues("override-spend-guard", f);
  const revoke = f.revoke === true || (Array.isArray(f.revoke) && f.revoke.length > 0);
  const signal = f.signal;
  if (signal === undefined) refuse(`override-spend-guard needs --signal ${GUARD_SIGNALS.join("|")}. Nothing was written.`);
  if (!GUARD_SIGNALS.includes(signal)) refuse(`--signal '${escapeControls(String(signal))}' is not one of ${GUARD_SIGNALS.join("|")}. Nothing was written.`);
  if (typeof f.reason !== "string" || !f.reason.trim()) refuse("override-spend-guard needs --reason \"<why>\" (non-empty). Nothing was written.");
  const escalatedTo = f["escalated-to"];
  if (revoke && escalatedTo !== undefined) refuse("--escalated-to is refused alongside --revoke: a revoke records no new escalation. Nothing was written.");
  const accepted = ["user", ...KNOWN_MODELS];
  if (!revoke) {
    if (escalatedTo === undefined) refuse(`override-spend-guard needs --escalated-to ${accepted.join("|")}: the record names who took the decision. Nothing was written.`);
    if (!accepted.includes(escalatedTo)) refuse(`--escalated-to '${escapeControls(String(escalatedTo))}' is not one of ${accepted.join("|")}. Nothing was written.`);
  }

  const state = loadState();
  const epic = state.epics.find((e) => e.id === epicId);
  if (!epic) refuse(`override-spend-guard: no epic '${escapeControls(String(epicId))}' is registered. Nothing was written.`);
  const at = new Date().toISOString();

  if (revoke) {
    const unrevoked = unrevokedOverrides(epic, signal);
    const latest = unrevoked[unrevoked.length - 1];
    if (!latest) refuse(`override-spend-guard --revoke: epic '${escapeControls(epicId)}' has no live ${signal} override to revoke. Nothing was written.`);
    latest.revokedAt = at;
    latest.revokeReason = f.reason.trim();
    const saved = saveState(state);
    render();
    reportSave(saved, {
      changed: `conductor: revoked the latest ${signal} override on '${escapeControls(epicId)}' (kept in the record); the guard is re-armed from the previous live override, or from 0`,
      unchanged: `conductor: that revoke was already recorded — ${STATE_UNCHANGED}`,
    });
    return;
  }

  const ev = evaluate(state, epic, { noIngest: false });
  const sig = signal === "rounds" ? ev.rounds : ev.tokens;
  if (signal === "tokens" && ev.tracking !== "on") {
    refuse(`override-spend-guard: the token signal is not checked while spend tracking is ${ev.tracking}, so there is no count to baseline and nothing to override. Nothing was written.`);
  }
  if (sig.state === "not-read") refuse(`override-spend-guard: the ${signal} signal could not be read (${escapeControls(String(sig.reason))}), so it cannot be overridden. Nothing was written.`);
  if (sig.state !== "tripped") {
    refuse(`override-spend-guard: the ${signal} signal is not tripped for '${escapeControls(epicId)}' (${sig.state}), so there is nothing to override — an override is the decision taken AT a stop, never given in advance. Nothing was written.`);
  }
  const target = ev.targets[signal];
  if (escalationRank(escalatedTo) < escalationRank(target.target)) {
    refuse(target.target === "user"
      ? `override-spend-guard: the next escalation is the user's — only --escalated-to user is accepted (${escapeControls(target.why || "")}). Nothing was written.`
      : `override-spend-guard: --escalated-to ${escapeControls(escalatedTo)} ranks below the escalation target; the lowest accepted model is ${escapeControls(target.target)} (or user). A same-tier retry is the loop this guard stops. Nothing was written.`);
  }
  epic.spendGuardOverrides = [
    ...(Array.isArray(epic.spendGuardOverrides) ? epic.spendGuardOverrides : []),
    { signal, ...(signal === "tokens" ? { basis: sig.basis } : {}), baseline: sig.count, escalatedTo, reason: f.reason.trim(), at },
  ];
  const saved = saveState(state);
  render();
  reportSave(saved, {
    changed: `conductor: recorded a ${signal} override on '${escapeControls(epicId)}' (escalated to ${escapeControls(escalatedTo)}, baseline ${sig.count}); the guard trips again after ${sig.limit} more`,
    unchanged: `conductor: that override was already recorded — ${STATE_UNCHANGED}`,
  });
}
