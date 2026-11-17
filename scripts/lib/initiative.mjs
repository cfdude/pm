// scripts/lib/initiative.mjs
// `initiative` -- the project's initiatives: multi-release efforts that deliver a valuable capability (change
// release-planning-taxonomy, spec initiative-record).
//
// THE ENGINE NEVER INVENTS AN INITIATIVE. It records what a person or an agent says one is, with where it came from, and keeps
// every ending in an append-only history (design D1, D8). An initiative spans releases, so it is a top-level record and not a
// release field. It is never deleted: ending records a WORK disposition, and deletion would destroy it (gate item 6).
//
//   state.initiatives = [{id, title, capability, status: "open"|"ended", outcome, endedAt, createdAt, source, offMissionReason,
//                         history: [{event: "ended"|"reopened", outcome?, at, reason}],
//                         milestones: [{id: "mN", text, addedAt, reachedAt?, evidence?, history, removedAt?, removeReason?}],
//                         nextMilestone, nonGoals: [...], nextNonGoal}]
//
// VOCABULARY (design D3): every human-readable surface says "initiative milestone". The 0.55.0 mission milestone is a release and
// is untouched.
//
// TWO HALVES, as mission.mjs has: applyInitiative(state, id, f, now) is PURE over a record and returns a refusal or the change, so a
// unit test drives every rule with no disk; initiative() is the verb, which loads, applies, saves and re-renders. A refusal writes
// nothing, and every value is checked before any write.

import { EPIC_ID_FORMAT, escapeControls } from "./constants.mjs";
import { parseFlags, requireFlagValues } from "./add-epic.mjs";
import { checkedPositionals } from "./argv-surface.mjs";
import { isInitialized, loadState, saveState } from "./state.mjs";
import { reportSave, STATE_UNCHANGED } from "./save-report.mjs";
import { render } from "./render.mjs";
import { writeRules, initiativesSectionText } from "./rules.mjs";
import { resolvePlatform } from "./platform.mjs";
import { lineFieldError } from "./epic-summary.mjs";
import {
  INITIATIVE_OUTCOMES, activeMilestones, eventOutcome, findInitiative, initiativeOutcome, initiativesOf, markEnded, markReopened,
  nextMilestoneNumber, primaryEpicCount,
} from "./initiative-record.mjs";
import {
  activeNonGoals, addNonGoals, flagValues, nonGoalsError, parseRemoval, removeNonGoal, removedNonGoals,
} from "./non-goals.mjs";
import { die } from "./command-exit.mjs";
import { currentArgv, errStream, outStream } from "./invocation.mjs";

/** `show` is reserved, as it is for `release` and `mission`. */
const SHOW = "show";

export const TITLE_MAX = 200;
export const CAPABILITY_MAX = 400;
/** The source, the off-mission reason, a milestone's text and its evidence or reason: one line, at most this many characters. */
export const LINE_MAX = 300;
/** The fields `--clear` can unset, by flag spelling, and the record key each removes. */
export const CLEARABLE = { source: "source", "off-mission-reason": "offMissionReason" };

const last = (v) => (Array.isArray(v) ? v[v.length - 1] : v);
const lineErr = (flag, value, max) => lineFieldError({ flag, max }, value);

/** The operation flags that make up a LIFECYCLE call: an ending or a reopening is its own record, alone. */
const LIFECYCLE = ["end", "reopen", "outcome", "reason"];

/** Apply one `initiative <id>` invocation's flags to `state`. Pure: no disk, no output. Returns `{ok: false, message}` and leaves
 *  `state` untouched, or `{ok: true, changed, created, notes}`. `f` is parseFlags()'s result. */
export function applyInitiative(state, id, f, now = new Date().toISOString()) {
  const refuse = (message) => ({ ok: false, message: `${message} Nothing was written.` });
  const has = (k) => f[k] !== undefined;
  const text = (k) => last(f[k]);
  if (id === SHOW) return refuse("`show` is reserved as the read keyword, so it cannot name an initiative.");
  if (typeof id !== "string" || !EPIC_ID_FORMAT.test(id)) {
    return refuse(`initiative id ${escapeControls(JSON.stringify(id))} must match ${EPIC_ID_FORMAT.source} (lowercase letters, digits, \`.\`, \`_\`, \`-\`).`);
  }
  const lifecycle = LIFECYCLE.filter(has);
  const others = ["title", "capability", "source", "off-mission-reason", "clear", "add-milestone", "remove-milestone", "reach-milestone",
    "unreach-milestone", "add-non-goal", "remove-non-goal"].filter(has);

  // ── lifecycle: an ending or a reopening is its own record, so it stands alone ──
  if (lifecycle.length) {
    if (has("end") && has("reopen")) return refuse("--end and --reopen contradict each other: end the initiative or reopen it, not both.");
    if (!has("end") && !has("reopen")) {
      return refuse(`--${lifecycle[0]} serves only --end (with --outcome ${INITIATIVE_OUTCOMES.join("|")}) and --reopen, and neither was given.`);
    }
    if (others.length) {
      return refuse(`--${has("end") ? "end" : "reopen"} is its own record and takes no other operation (got --${others.join(", --")}): ` +
        "one reason, one record. Make the edit in a separate invocation.");
    }
    const init = findInitiative(state, id);
    if (!init) return refuse(`initiative '${escapeControls(id)}' does not exist.`);
    const reason = text("reason");
    if (typeof reason !== "string" || reason.trim() === "") return refuse(`--${has("end") ? "end" : "reopen"} requires --reason "<why>".`);
    const reasonErr = lineErr("reason", reason, 300);
    if (reasonErr) return refuse(`${reasonErr}.`);
    if (has("end")) {
      const outcome = text("outcome");
      if (!INITIATIVE_OUTCOMES.includes(outcome)) {
        return refuse(`--end requires --outcome ${INITIATIVE_OUTCOMES.join("|")} (got ${escapeControls(JSON.stringify(outcome === undefined ? null : outcome))}).`);
      }
      if (init.status === "ended") return refuse(`initiative '${escapeControls(id)}' is already ended (${escapeControls(String(initiativeOutcome(init)))}); reopen it first with --reopen --reason "<why>".`);
      markEnded(init, outcome, now);
      if (!Array.isArray(init.history)) init.history = [];
      init.history.push({ event: "ended", outcome, at: now, reason: reason.trim() });
      return { ok: true, changed: true, created: false, notes: [] };
    }
    if (has("outcome")) return refuse("--outcome belongs to --end.");
    if (init.status !== "ended") return refuse(`initiative '${escapeControls(id)}' is not ended, so there is nothing to reopen.`);
    markReopened(init);
    if (!Array.isArray(init.history)) init.history = [];
    init.history.push({ event: "reopened", at: now, reason: reason.trim() });
    return { ok: true, changed: true, created: false, notes: [] };
  }

  // ── field values, all checked before any write ──
  const existing = findInitiative(state, id);
  if (!existing) {
    if (!has("title")) return refuse(`initiative '${escapeControls(id)}' does not exist: create it with --title "<line>" --capability "<line>" (--title is missing).`);
    if (!has("capability")) return refuse(`initiative '${escapeControls(id)}' does not exist: create it with --title "<line>" --capability "<line>" (--capability is missing).`);
  }
  if (!others.length) {
    return refuse("initiative needs an operation: --title, --capability, --source, --off-mission-reason, --clear <source|off-mission-reason>, " +
      "--add-milestone, --remove-milestone \"mN:<why>\", --reach-milestone \"mN:<evidence>\", --unreach-milestone \"mN:<why>\", " +
      "--add-non-goal, --remove-non-goal \"nN:<why>\", --end --outcome <o> --reason \"<why>\" or --reopen --reason \"<why>\" (or initiative show [<id>] [--history] to read).");
  }
  const checks = [["title", TITLE_MAX], ["capability", CAPABILITY_MAX], ["source", LINE_MAX], ["off-mission-reason", LINE_MAX]];
  for (const [flag, max] of checks) {
    if (!has(flag)) continue;
    const err = lineErr(flag, text(flag), max);
    if (err) return refuse(`${err}.`);
  }
  const cleared = flagValues(f.clear);
  for (const name of cleared) {
    if (typeof name !== "string" || !Object.hasOwn(CLEARABLE, name.trim())) {
      return refuse(`--clear ${escapeControls(JSON.stringify(name))}: the clearable fields are ${Object.keys(CLEARABLE).join(" and ")}.`);
    }
    if (has(name.trim())) return refuse(`--clear ${name.trim()} contradicts --${name.trim()} in the same invocation: set it or unset it, not both.`);
  }
  if (has("add-milestone")) {
    const err = lineErr("add-milestone", text("add-milestone"), LINE_MAX);
    if (err) return refuse(`${err}.`);
  }
  const added = flagValues(f["add-non-goal"]);
  if (added.length) {
    const err = nonGoalsError(added);
    if (err) return refuse(`${err}.`);
  }
  // Every operation needing an existing initiative is parsed here; the lookups against its milestones happen after the create below
  // would have run, because a milestone cannot be named in the same invocation that creates its initiative.
  const removal = {};
  for (const [flag, noun, prefix] of [["remove-milestone", "initiative milestone", "m"], ["reach-milestone", "initiative milestone", "m"],
    ["unreach-milestone", "initiative milestone", "m"], ["remove-non-goal", "non-goal", "n"]]) {
    if (!has(flag)) continue;
    if (Array.isArray(f[flag]) && f[flag].length > 1) return refuse(`--${flag} is not repeatable: one reason, one record.`);
    const r = parseRemoval(last(f[flag]), flag, noun, prefix, flag === "reach-milestone" ? "evidence" : "why");
    if (r.error) return refuse(`${r.error}.`);
    if (flag === "reach-milestone") { const e = lineErr("reach-milestone", r.reason, LINE_MAX); if (e) return refuse(`${e}.`); }
    removal[flag] = r;
  }
  if (!existing && Object.keys(removal).length) {
    return refuse(`${Object.keys(removal).map(k => `--${k}`).join(", ")} names a record of an initiative that does not exist yet.`);
  }

  // Resolve the milestone/non-goal targets against the CURRENT record before writing anything.
  const rec = existing || null;
  const milestone = (mid) => (rec && Array.isArray(rec.milestones) ? rec.milestones.find(m => m && m.id === mid) : undefined);
  for (const flag of ["remove-milestone", "reach-milestone", "unreach-milestone"]) {
    const r = removal[flag];
    if (!r) continue;
    const m = milestone(r.id);
    if (!m) return refuse(`--${flag} names '${escapeControls(r.id)}', which is not an initiative milestone of '${escapeControls(id)}'.`);
    if (m.removedAt) return refuse(`initiative milestone ${escapeControls(r.id)} was already removed (${escapeControls(m.removedAt)}).`);
    if (flag === "reach-milestone" && m.reachedAt) return refuse(`initiative milestone ${escapeControls(r.id)} is already reached (${escapeControls(m.reachedAt)}); use --unreach-milestone "${escapeControls(r.id)}:<why>" first.`);
    if (flag === "unreach-milestone" && !m.reachedAt) return refuse(`initiative milestone ${escapeControls(r.id)} is not reached, so there is nothing to unreach.`);
  }
  if (removal["remove-non-goal"]) {
    const r = removal["remove-non-goal"];
    const hit = activeNonGoals(rec).find(g => g.id === r.id);
    if (!hit) return refuse(`--remove-non-goal names '${escapeControls(r.id)}', which is not an active non-goal of '${escapeControls(id)}'.`);
  }

  // ── writes ──
  const notes = [];
  let created = false;
  let init = existing;
  if (!init) {
    init = { id, title: text("title").trim(), capability: text("capability").trim(), status: "open", outcome: null, endedAt: null,
      createdAt: now, history: [], milestones: [], nextMilestone: 1, nonGoals: [], nextNonGoal: 1 };
    if (!Array.isArray(state.initiatives)) state.initiatives = [];
    state.initiatives.push(init);
    created = true;
  }
  let changed = created;
  const set = (key, v) => { if (init[key] !== v) { init[key] = v; changed = true; } };
  if (!created && has("title")) set("title", text("title").trim());
  if (!created && has("capability")) set("capability", text("capability").trim());
  if (has("source")) set("source", text("source").trim());
  if (has("off-mission-reason")) set("offMissionReason", text("off-mission-reason").trim());
  for (const name of cleared) {
    const key = CLEARABLE[name.trim()];
    if (key in init) { delete init[key]; changed = true; } else notes.push(`initiative '${id}' has no ${name.trim()} set — there was nothing to clear`);
  }
  if (has("add-milestone")) {
    const n = nextMilestoneNumber(init);
    if (!Array.isArray(init.milestones)) init.milestones = [];
    init.milestones.push({ id: `m${n}`, text: text("add-milestone").trim(), addedAt: now, history: [] });
    init.nextMilestone = n + 1;
    notes.push(`added initiative milestone m${n}`);
    changed = true;
  }
  if (removal["remove-milestone"]) {
    const r = removal["remove-milestone"];
    const m = milestone(r.id);
    m.removedAt = now;
    m.removeReason = r.reason;
    changed = true;
  }
  if (removal["reach-milestone"]) {
    const r = removal["reach-milestone"];
    const m = milestone(r.id);
    m.reachedAt = now;
    m.evidence = r.reason;
    if (!Array.isArray(m.history)) m.history = [];
    m.history.push({ event: "reached", at: now, evidence: r.reason });
    changed = true;
  }
  if (removal["unreach-milestone"]) {
    const r = removal["unreach-milestone"];
    const m = milestone(r.id);
    delete m.reachedAt;
    delete m.evidence;
    if (!Array.isArray(m.history)) m.history = [];
    m.history.push({ event: "unreached", at: now, reason: r.reason });
    changed = true;
  }
  if (added.length) { addNonGoals(init, added, now); changed = true; }
  if (removal["remove-non-goal"]) {
    const r = removal["remove-non-goal"];
    removeNonGoal(init, r.id, r.reason, now);
    changed = true;
  }
  return { ok: true, changed, created, notes };
}

/** The lines `initiative show [<id>] [--history]` prints. Pure. `id` undefined lists every initiative. Returns `{lines}` or `{error}`. */
export function initiativeShowLines(state, id, { history = false } = {}) {
  const all = initiativesOf(state);
  if (id === undefined) {
    if (!all.length) return { lines: ["no initiatives"] };
    return { lines: all.map(i => `${i.id} — ${i.status === "ended" ? `ended (${initiativeOutcome(i)})` : "open"} — ${i.title} ` +
      `(${activeMilestones(i).length} active initiative milestone${activeMilestones(i).length === 1 ? "" : "s"}, ${primaryEpicCount(state, i.id)} epic${primaryEpicCount(state, i.id) === 1 ? "" : "s"} as primary)`) };
  }
  const i = findInitiative(state, id);
  if (!i) return { error: `there is no initiative '${escapeControls(id)}': it does not exist.` };
  const L = [];
  L.push(`initiative ${i.id}: ${i.title}`);
  L.push(`  status: ${i.status === "ended" ? `ended (${initiativeOutcome(i)}) ${i.endedAt || ""}`.trim() : "open"}`);
  L.push(`  capability: ${i.capability}`);
  L.push(`  source: ${i.source === undefined ? "none" : i.source}`);
  if (i.offMissionReason !== undefined) L.push(`  off-mission reason: ${i.offMissionReason}`);
  const ms = activeMilestones(i);
  L.push(`  milestones, initiative (${ms.length} active):`);
  if (!ms.length) L.push("    (none)");
  for (const m of ms) L.push(`    ${m.id} — ${m.text}${m.reachedAt ? ` [reached ${m.reachedAt}: ${m.evidence}]` : ""}`);
  const ng = activeNonGoals(i);
  L.push(`  non-goals (${ng.length} active):`);
  if (!ng.length) L.push("    (none)");
  for (const g of ng) L.push(`    ${g.id} — ${g.text}`);
  L.push(`  epics naming it as primary: ${primaryEpicCount(state, i.id)}`);
  if (history) {
    L.push("  history:");
    const rows = [];
    for (const h of Array.isArray(i.history) ? i.history : []) rows.push(`${h.at} — ${h.event}${eventOutcome(h) ? ` (${eventOutcome(h)})` : ""}: ${h.reason}`);
    for (const m of Array.isArray(i.milestones) ? i.milestones : []) {
      for (const h of Array.isArray(m.history) ? m.history : []) rows.push(`${h.at} — milestone ${m.id} ${h.event}: ${h.evidence || h.reason}`);
      if (m.removedAt) rows.push(`${m.removedAt} — milestone ${m.id} removed: ${m.removeReason} (${m.text})`);
    }
    for (const g of removedNonGoals(i)) rows.push(`${g.removedAt} — non-goal ${g.id} removed: ${g.removeReason} (${g.text})`);
    if (!rows.length) rows.push("(none)");
    for (const r of rows) L.push(`    ${r}`);
  }
  return { lines: L };
}

/** `initiative <id> …` | `initiative show [<id>] [--history]`. */
export function initiative() {
  if (!isInitialized()) { die("conductor: run /pm:init first\n"); }
  const argv = currentArgv().slice(3);
  const positionals = checkedPositionals("initiative");
  const read = positionals[0] === SHOW;
  if (read) {
    const f = parseFlags(argv);
    requireFlagValues("initiative", f);
    const stray = Object.keys(f).filter(k => k !== "history");
    if (stray.length) {
      die(`conductor: initiative show is the READ form and takes only an id and --history (got ${escapeControls(stray.map(k => `--${k}`).join(", "))}). \`show\` is reserved. Nothing was written.\n`);
    }
    const shown = initiativeShowLines(loadState(), positionals[1], { history: f.history === true });
    if (shown.error) die(`conductor: ${escapeControls(shown.error)}\n`);
    outStream().write(shown.lines.map(escapeControls).join("\n") + "\n");
    return;
  }
  const id = positionals[0];
  if (id === undefined) {
    die("conductor: initiative requires an initiative id as its first POSITIONAL argument (initiative <id> --title \"<line>\" --capability \"<line>\", or initiative show [<id>] [--history]). Nothing was written.\n");
  }
  if (positionals.length > 1) die(`conductor: initiative takes one initiative id (got ${positionals.length}). Nothing was written.\n`);
  const f = parseFlags(argv);
  requireFlagValues("initiative", f);
  if (f.history !== undefined) die("conductor: --history belongs to initiative show --history. Nothing was written.\n");
  const state = loadState();
  const before = initiativesSectionText(state);
  const r = applyInitiative(state, id, f);
  if (!r.ok) die(`conductor: ${escapeControls(r.message)}\n`);
  for (const n of r.notes) errStream().write(`conductor: ${escapeControls(n)}\n`);
  if (!r.changed) { outStream().write("conductor: initiative unchanged — nothing was written\n"); return; }
  const saved = saveState(state);
  // The `## Initiatives` section follows the record: rewrite the block when its text changed (design D13).
  if (initiativesSectionText(state) !== before) writeRules(resolvePlatform({}, state));
  render();
  reportSave(saved, {
    changed: `conductor: initiative '${escapeControls(id)}' recorded`,
    unchanged: `conductor: initiative '${escapeControls(id)}' already read exactly that — ${STATE_UNCHANGED}`,
  });
}
