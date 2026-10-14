// scripts/lib/spend-guard.mjs
// spend-budget-and-stuck-loop-guard — the PURE half: the gate-round tally, the pass anchor, the
// limit cascade, the two signals, the escalation target and the STOP text. Nothing here loads state,
// opens a file, reads a clock or writes anything; the verbs (spend-guard-verbs.mjs) and the few
// emission sites (gate-review-writeback.mjs, briefing.mjs, rules.mjs) own every effect.
//
// pm is an INSTRUCTION layer. Nothing in this file dispatches, kills or throttles anything, and no
// path through it opens a network connection: it counts, compares, and says what to do.

import { MODEL_RANK, escapeControls, orNoRemedy, printedId } from "./constants.mjs";
import { resolveField, resolveProfile } from "./execution-profile.mjs";

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const ms = (iso) => (typeof iso === "string" ? Date.parse(iso) : NaN);

// ─────────────── D1: the per-gate round tally ───────────────

const zeroTally = () => ({ fails: 0, passes: 0, failStreak: 0, lastVerdictAt: null });

/** Fold ONE accepted verdict into `epic.gateRounds.gate<N>`, in place. This is the field's ONLY writer
 *  (called from recordGateReview()); `update-epic --withdraw-gate-review` and the archive-drift heal
 *  deliberately do not touch it. A `fail` adds to `fails` and `failStreak` and leaves `lastPassAt`; a
 *  `pass` adds to `passes`, zeroes the streak and stamps `lastPassAt`. `reviewedAt` is the verdict
 *  entry's own timestamp, so the tally and `gateReview.gate<N>.reviewedAt` agree to the byte. */
export function tallyVerdict(epic, gate, verdict, reviewedAt) {
  const rounds = isObj(epic.gateRounds) ? epic.gateRounds : {};
  const key = `gate${gate}`;
  const prior = isObj(rounds[key]) ? rounds[key] : {};
  const next = { ...zeroTally(), ...prior };
  next.lastVerdictAt = reviewedAt;
  if (verdict === "pass") {
    next.passes += 1;
    next.failStreak = 0;
    next.lastPassAt = reviewedAt;
  } else {
    next.fails += 1;
    next.failStreak += 1;
  }
  epic.gateRounds = { ...rounds, [key]: next };
}

/** The tallies that exist on an epic, as `[[gateKey, tally], …]` in gate order. An epic with no
 *  `gateRounds` yields none: it reads as zero with no anchor and nothing backfills it. */
export function gateTallies(epic) {
  const rounds = epic && isObj(epic.gateRounds) ? epic.gateRounds : {};
  return Object.keys(rounds).sort().filter((k) => isObj(rounds[k])).map((k) => [k, rounds[k]]);
}

/** The highest recorded fail streak across the epic's gates, with the gate that holds it. */
export function recordedStreak(epic) {
  let best = { count: 0, gate: null };
  for (const [k, t] of gateTallies(epic)) {
    const n = Number.isInteger(t.failStreak) && t.failStreak > 0 ? t.failStreak : 0;
    if (n > best.count) best = { count: n, gate: k };
  }
  return best;
}

/** The epic's pass anchor: the latest `gateRounds.gate<N>.lastPassAt` across its gates, or null.
 *  Read by the ledger side of the rounds signal and by override liveness, NEVER from `gateReview`,
 *  whose writer keeps one superseded entry and so forgets a pass after two more verdicts. A withdrawn
 *  pass still anchors (D1): withdrawal writes nothing here. */
export function passAnchor(epic) {
  let best = null;
  for (const [, t] of gateTallies(epic)) {
    const at = ms(t.lastPassAt);
    if (Number.isFinite(at) && (best === null || at > ms(best))) best = t.lastPassAt;
  }
  return best;
}

// ─────────────── D3: the limit cascade ───────────────

export const GUARD_FIELDS = Object.freeze(["maxFailedRounds", "tokenCeiling", "warnAt"]);
export const DEFAULT_WARN_AT = 80;

const positiveInt = (v) => Number.isInteger(v) && v > 0;

/** Each validator returns `{ ok: true, value }` or `{ ok: false, message }`. Strings are accepted
 *  (argv) but must be plain decimal integers. */
function wholeNumber(text) {
  if (typeof text === "number") return text;
  return /^[0-9]+$/.test(String(text)) ? Number(text) : NaN;
}
export function checkMaxFailedRounds(text) {
  const n = wholeNumber(text);
  return positiveInt(n) ? { ok: true, value: n }
    : { ok: false, message: `--max-failed-rounds '${escapeControls(String(text))}' must be a positive whole number` };
}
export function checkTokenCeiling(text) {
  const n = wholeNumber(text);
  return positiveInt(n) && Number.isSafeInteger(n) ? { ok: true, value: n }
    : { ok: false, message: `--tokens '${escapeControls(String(text))}' must be a positive whole number` };
}
export function checkWarnAt(text) {
  const n = wholeNumber(text);
  return Number.isInteger(n) && n >= 1 && n <= 99 ? { ok: true, value: n }
    : { ok: false, message: `--warn-at '${escapeControls(String(text))}' must be a whole number from 1 to 99 (a percentage of the ceiling)` };
}
const CHECKS = { maxFailedRounds: checkMaxFailedRounds, tokenCeiling: checkTokenCeiling, warnAt: checkWarnAt };

/** The layers of the cascade, most specific first. A layer is `{source, spendGuard}` with the RAW
 *  stored object (a hand-edited one may be invalid; resolution checks each field). A detour holds
 *  no inherited layer: nothing here follows a `detourStack` frame. */
function guardLayers(state, epic, lane) {
  const layers = [];
  if (epic) layers.push({ source: "epic", guard: epic.spendGuard });
  const lg = lane && isObj(state.laneSpendGuards) ? state.laneSpendGuards[lane] : undefined;
  if (isObj(lg)) layers.push({ source: `lane:${escapeControls(String(lane))}`, guard: lg });
  layers.push({ source: "project", guard: state.spendGuard });
  return layers;
}

/** Resolve the three fields for an epic (or a lane, or — with neither — the project). `resolveField` is
 *  the execution profile's own, passed in so the two cascades cannot fork. Returns, per field,
 *  `{value, source}` (`value: null, source: null` = no limit; `warnAt` defaults to 80 with source
 *  `default`) and `ignored: [{source, field, value}]` for stored values that failed their check. */
export function resolveGuard(state, { epicId, lane } = {}) {
  const s = state || {};
  const epic = epicId ? (Array.isArray(s.epics) ? s.epics.find((e) => e && e.id === epicId) : undefined) : undefined;
  const useLane = lane || (epic && epic.lane) || undefined;
  const layers = guardLayers(s, epic, useLane);
  const out = { ignored: [] };
  for (const field of GUARD_FIELDS) {
    const dflt = field === "warnAt" ? DEFAULT_WARN_AT : null;
    const r = resolveField(layers, (l) => (isObj(l.guard) ? l.guard[field] : undefined), CHECKS[field], dflt);
    out[field] = { value: r.value, source: field !== "warnAt" && r.value === null ? null : r.source };
    for (const ig of r.ignored || []) out.ignored.push({ source: ig.source, field, value: ig.value });
  }
  return out;
}

/** Is any LIMIT configured — `maxFailedRounds` or `tokenCeiling` valid at the project, at any lane, or
 *  on any epic that is not archived? A `warnAt` alone is not one, and an archived epic's layer does not
 *  count. PURE, from state alone: the rules-block section, the brief and the opt-in row all ask it. */
export function guardConfigured(state) {
  const s = state || {};
  const has = (g) => isObj(g) && (checkMaxFailedRounds(g.maxFailedRounds).ok || checkTokenCeiling(g.tokenCeiling).ok);
  if (has(s.spendGuard)) return true;
  if (isObj(s.laneSpendGuards) && Object.values(s.laneSpendGuards).some(has)) return true;
  return (Array.isArray(s.epics) ? s.epics : []).some((e) => e && e.status !== "archived" && has(e.spendGuard));
}

// ─────────────── D6: overrides ───────────────

export const GUARD_SIGNALS = Object.freeze(["rounds", "tokens"]);

/** The unrevoked overrides for `signal`, oldest first. This is what `--revoke` marks: a revoke is a
 *  recorded decision about an entry, whether or not a later pass has already spent it. */
export function unrevokedOverrides(epic, signal) {
  const all = epic && Array.isArray(epic.spendGuardOverrides) ? epic.spendGuardOverrides : [];
  return all.filter((o) => isObj(o) && o.signal === signal && o.revokedAt === undefined);
}

/** THE ONE LIVENESS PREDICATE (the baseline, the escalation target and the report all read it). An
 *  override is live while it is unrevoked AND, for `rounds`, not spent: a later pass spends it, read
 *  from the epic's pass anchor (absent, or not later than the override's `at`), never from `gateReview`. */
export function liveOverrides(epic, signal) {
  const anchor = signal === "rounds" ? passAnchor(epic) : null;
  return unrevokedOverrides(epic, signal).filter((o) => anchor === null || !(ms(anchor) > ms(o.at)));
}

/** The baseline the signal is measured from: the latest LIVE override's `baseline`, or 0. `spent` says
 *  the epic holds unrevoked overrides that a pass has spent (so the report can say why the baseline is 0). */
export function overrideBaseline(epic, signal) {
  const live = liveOverrides(epic, signal);
  const latest = live[live.length - 1];
  if (!latest) return { baseline: 0, override: null, spent: unrevokedOverrides(epic, signal).length > 0 };
  const baseline = Number.isFinite(latest.baseline) ? latest.baseline : 0;
  return { baseline, override: latest, spent: false };
}

// ─────────────── D2: the signals ───────────────

/** The ledger side of the rounds signal: the DISTINCT `round` values on the epic's attributed
 *  `phase=review` rows timestamped after the pass anchor, minus one, floored at 0 (every row when
 *  there is no anchor). `rows` are `attribute()`'s output; an unattributed row (unknown epic, invalid
 *  marker) carries `epic: null` and contributes nothing. */
export function ledgerRounds(rows, epicId, anchor) {
  const after = anchor === null || anchor === undefined ? -Infinity : ms(anchor);
  const seen = new Set();
  for (const r of rows || []) {
    if (!r || r.epic !== epicId || r.phase !== "review" || r.round === null || r.round === undefined) continue;
    if (ms(r.at) > after) seen.add(r.round);
  }
  return Math.max(0, seen.size - 1);
}

/** The rounds signal, a pure function of the epic's tally, the resolved limit and the live overrides.
 *  `ledger` is `{ side: <number>|null, note?: <string> }`: `side` null = the ledger side was not
 *  computed (tracking off, or not read) and `note` says why. Tripped while `count - baseline` is at or
 *  above the limit; with no limit it never trips. */
export function roundsSignal(epic, resolved, ledger = { side: null }) {
  const streak = recordedStreak(epic);
  const side = ledger && Number.isInteger(ledger.side) ? ledger.side : null;
  const count = Math.max(streak.count, side === null ? 0 : side);
  const decidedBy = side !== null && side > streak.count ? "ledger" : "recorded";
  const limit = resolved.maxFailedRounds.value;
  const { baseline, override, spent } = overrideBaseline(epic, "rounds");
  const tripped = limit !== null && count - baseline >= limit;
  return {
    state: limit === null ? "no-limit" : tripped ? "tripped" : "ok",
    count, limit, source: resolved.maxFailedRounds.source, baseline,
    recorded: streak.count, recordedGate: streak.gate, ledger: side, decidedBy,
    overrideSpent: spent, override,
    ...(ledger && ledger.note ? { note: ledger.note } : {}),
  };
}

/** The recorded-verdicts-only rounds signal — all `record-gate-review` and the brief may ask, since
 *  neither reads the ledger. */
export const recordedRoundsSignal = (epic, resolved) => roundsSignal(epic, resolved, { side: null });

/** The token signal. `status` is `{ checked: false, why }` when it was not (or could not be) computed:
 *  `off` = tracking off (`not-checked`), `unread` = the ledger could not be read (`not-read`). When
 *  checked, `total` is the epic's attributed total; the baseline comes from the latest live override. */
export function tokenSignal(epic, resolved, status) {
  const limit = resolved.tokenCeiling.value;
  const { baseline } = overrideBaseline(epic, "tokens");
  const base = { limit, source: resolved.tokenCeiling.source, baseline, warnAt: resolved.warnAt.value };
  if (limit === null) return { ...base, state: "no-limit", count: status.checked ? status.total : null };
  if (!status.checked) {
    return { ...base, state: status.kind === "unread" ? "not-read" : "not-checked", count: null, reason: status.why };
  }
  const count = status.total;
  if (limit === null) return { ...base, state: "no-limit", count };
  const used = count - baseline;
  const state = used >= limit ? "tripped" : used * 100 >= limit * resolved.warnAt.value ? "warn" : "ok";
  return { ...base, state, count, used };
}

// ─────────────── D7: the escalation target ───────────────

/** The next model above `pair` in `haiku < sonnet < opus < fable`, whatever layer the pair came from
 *  (`default` included), else `user`. `pair` is `{model, source}` or null. Returns
 *  `{ target, from, source, why }`. `fable`, a model outside the ladder, or no model at all give `user`. */
export function escalationTarget(pair) {
  const model = pair && typeof pair.model === "string" ? pair.model : null;
  const source = pair && typeof pair.source === "string" ? pair.source : null;
  const at = model === null ? -1 : MODEL_RANK.indexOf(model);
  if (at === -1) return { target: "user", from: model, source, why: "there was no ranked model to step up from" };
  if (at === MODEL_RANK.length - 1) return { target: "user", from: model, source, why: `${model} is the top tier` };
  return { target: MODEL_RANK[at + 1], from: model, source, why: null };
}

/** Rank of a `--escalated-to` value: `user` outranks every model. -1 for anything else. */
export function escalationRank(value) {
  if (value === "user") return MODEL_RANK.length;
  return MODEL_RANK.indexOf(value);
}

/** The role a signal escalates from (D7): rounds from `review`, tokens from `implement`. */
export const SIGNAL_ROLE = Object.freeze({ rounds: "review", tokens: "implement" });

/** The target for a signal, given the resolved profile's model for that signal's role and the live
 *  overrides: after one live MODEL override for the signal, only `user` is next. */
export function targetFor(epic, signal, rolePair) {
  const t = escalationTarget(rolePair);
  const modelOverride = liveOverrides(epic, signal).some((o) => o.escalatedTo !== "user");
  if (modelOverride && t.target !== "user") {
    return { ...t, target: "user", why: "a model override is already live for this signal, so the next escalation is the user's" };
  }
  return t;
}

// ─────────────── D5: the STOP block ───────────────

/** The STOP block, as lines. Every line leaves through `lines.map(escapeControls)` (the output sweep's
 *  sink), so no caller can forget to escape an epic id or a model name. `signals` is `{rounds?, tokens?}` of
 *  tripped signals only; `targets` maps signal -> targetFor()'s answer. */
export function stopBlock(epicId, signals, targets) {
  const lines = [];
  const names = Object.keys(signals);
  lines.push(`STOP: spend guard — epic ${epicId} is stuck: ${names.map((n) => `${n} ${signals[n].count}/${signals[n].limit}`).join(", ")}.`);
  lines.push("Stop dispatching same-tier retries for this epic. Epic-level autonomy does not bypass this stop, and no autonomy grant covers continuing past it.");
  for (const name of names) {
    const t = targets[name];
    const from = t.from === null ? "no model" : `${t.from}${t.source ? ` (${t.source})` : ""}`;
    lines.push(`- ${name}: escalate to ${t.target} or the user (${SIGNAL_ROLE[name]} model: ${from}${t.why ? `; ${t.why}` : ""}).`);
  }
  lines.push("Hand the target the failure evidence — the last failing findings or tests, the verdicts recorded and the diff — and ask: what is wrong and how do we resolve it?");
  for (const name of names) {
    lines.push(`Then record the decision: override-spend-guard ${epicId} --signal ${name} --escalated-to ${targets[name].target} --reason "<why>"`);
  }
  return lines.map(escapeControls);
}

/** The role's resolved model as escalationTarget() takes it: `{model, source}`, or null. */
export function rolePair(state, epicId, role) {
  const r = resolveProfile(state, { epicId }).model[role];
  return r && r.value && typeof r.value.model === "string" ? { model: r.value.model, source: r.source } : null;
}

/** The STOP block `record-gate-review` prints after an accepted verdict, or `[]`. From `state` alone:
 *  the recorded part of the rounds signal, never the ledger. A limit must be configured for the epic and
 *  the signal tripped on the recorded streak. */
export function recordedStopLines(state, epicId) {
  if (!guardConfigured(state)) return [];
  const epic = (Array.isArray(state.epics) ? state.epics : []).find((e) => e && e.id === epicId);
  if (!epic) return [];
  const sig = recordedRoundsSignal(epic, resolveGuard(state, { epicId }));
  if (sig.state !== "tripped") return [];
  return stopBlock(epicId, { rounds: sig }, { rounds: targetFor(epic, "rounds", rolePair(state, epicId, "review")) });
}

// ─────────────── emission: the brief line and the rules section ───────────────

/** The brief's one guard line for the ACTIVE epic: from `state` alone (the recorded verdicts and live
 *  overrides), never the ledger. Empty unless a limit is configured AND the epic is tripped on its
 *  recorded streak. */
export function briefGuardLines(state, epicId) {
  if (!guardConfigured(state)) return [];
  const epic = (Array.isArray(state.epics) ? state.epics : []).find((e) => e && e.id === epicId);
  if (!epic) return [];
  const sig = recordedRoundsSignal(epic, resolveGuard(state, { epicId }));
  if (sig.state !== "tripped") return [];
  const lines = [];
  const check = orNoRemedy(() => `\`spend-guard ${printedId(epicId)}\``);
  lines.push(`STOP: spend guard — ${epicId} rounds ${sig.count}/${sig.limit} on recorded verdicts. Run ${check}; autonomy does not bypass it.`);
  return lines.map(escapeControls);
}

/** The `## Spend guard` rules-block section (the caller emits it only while a limit is configured). */
export function spendGuardLines() {
  return [
    "## Spend guard",
    "",
    "A spend limit is configured. Before EVERY review or fix dispatch for an epic, run `spend-guard <epic>`.",
    "Exit 0 means go on; exit 2 is a STOP. A STOP is a genuine safety stop that epic-level autonomy does",
    "not bypass: stop dispatching same-tier retries, hand the failure evidence to the escalation target it",
    "names (or the user) and ask what is wrong and how to resolve it, then record the decision with",
    "`override-spend-guard <epic> --signal rounds|tokens --escalated-to <target> --reason \"<why>\"`. No",
    "autonomy grant covers `override-spend-guard`. Never wire `spend-guard` into a hook (exit 2 is a hook block).",
    "",
    "Round counts include review dispatches, so mark each one in the exact form",
    "`pm-spend: epic=<id> role=review phase=review round=<n>` (a marker with any other phase is not counted).",
    "",
  ];
}
