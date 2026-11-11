// scripts/lib/mission.mjs
// `mission` -- the project's recorded mission, its mission milestone and the exit criteria (change project-boards,
// spec project-mission).
//
// THE ENGINE NEVER WRITES A STATEMENT IT WAS NOT GIVEN. It records what a person or an agent says the mission is, with
// the reason, and keeps every replaced statement in an append-only history (design D6). `mission` spans releases, so it
// is a top-level record and not a release field:
//   state.mission = {current: {statement, setAt, reason} | null,
//                    history: [{statement, setAt, reason, endedAt, endReason}],
//                    milestoneRelease: id | null,
//                    criteria: [{id, text, check, needsHuman, addedAt, removedAt?, removeReason?}],
//                    nextCriterion: n}
//
// VOCABULARY (design D7): every human-readable surface says "mission milestone". "milestone" alone already means a
// Superpowers plan's stories here.
//
// TWO HALVES, as board.mjs has: applyMission(state, f, now) is PURE over a record and returns a refusal or the change,
// so a unit test drives every rule with no disk; mission() is the verb, which loads, applies, saves, and rewrites the
// managed rules block when the `## Mission` section's text changed. A refusal writes nothing.

import { escapeControls, findRelease } from "./constants.mjs";
import { activeCriteria, missionOf } from "./mission-record.mjs";
import { parseFlags, requireFlagValues } from "./add-epic.mjs";
import { checkedPositionals } from "./argv-surface.mjs";
import { isInitialized, loadState, saveState } from "./state.mjs";
import { reportSave, STATE_UNCHANGED } from "./save-report.mjs";
import { render } from "./render.mjs";
import { writeRules, missionSectionText } from "./rules.mjs";
import { resolvePlatform } from "./platform.mjs";
import { die } from "./command-exit.mjs";
import { currentArgv, errStream, outStream } from "./invocation.mjs";

/** The statement: one line, at most this many characters. */
export const STATEMENT_MAX = 300;
/** A criterion's text and check: one line, at most this many characters. */
export const CRITERION_MAX = 300;
/** `show` is reserved, as it is for `release`. */
const SHOW = "show";

const NEWLINE = new RegExp("[\\r\\n" + String.fromCharCode(0x2028, 0x2029) + "]");

/** One line of at most `max` characters, or the refusal text. */
function lineError(flag, value, max) {
  if (typeof value !== "string" || value.trim() === "") return `--${flag} requires one line of at most ${max} characters`;
  if (flag !== "reason" && (value.includes("<!--") || value.includes("-->"))) return `--${flag} must not contain \`<!--\` or \`-->\` (it is written into CLAUDE.md's managed block, where a comment marker would break it)`;
  if (NEWLINE.test(value)) return `--${flag} must be one line of at most ${max} characters (it contains a newline)`;
  if ([...value].length > max) return `--${flag} must be one line of at most ${max} characters (got ${[...value].length})`;
  return null;
}

const str = (v) => (typeof v === "string" ? v : Array.isArray(v) ? v[v.length - 1] : undefined);

/** Apply one `mission` invocation's flags to `state`. Pure: no disk, no output. Returns `{ok: false, message}` and leaves
 *  `state` untouched, or `{ok: true, changed, notes}` with the record updated. `f` is parseFlags()'s result. */
export function applyMission(state, f, now = new Date().toISOString()) {
  const refuse = (message) => ({ ok: false, message: `${message} Nothing was written.` });
  const has = (k) => f[k] !== undefined;
  const statement = str(f.statement);
  const reason = str(f.reason);
  const reasoned = ["statement", "end", "remove-criterion"].filter(has);
  const operations = [...reasoned, ...["milestone", "clear-milestone", "add-criterion"].filter(has)];
  if ((has("check") || has("needs-human")) && !has("add-criterion")) {
    return refuse("--check and --needs-human apply only to --add-criterion.");
  }
  if (!operations.length) {
    return refuse("mission needs an operation: --statement \"<text>\" --reason \"<why>\", --end --reason \"<why>\", " +
      "--milestone <releaseId>, --clear-milestone, --add-criterion \"<text>\" [--check \"<how>\" | --needs-human], " +
      "or --remove-criterion <cN> --reason \"<why>\" (or `mission show [--history]` to read it).");
  }
  if (reasoned.length > 1) {
    return refuse(`--reason serves exactly one of --statement, --end and --remove-criterion, and this invocation gave ` +
      `--${reasoned.join(" and --")}. One reason, one record.`);
  }
  if (has("reason") && !reasoned.length) {
    return refuse("--reason serves exactly one of --statement, --end and --remove-criterion, and none was given.");
  }
  if (reasoned.length && (reason === undefined || reason.trim() === "")) {
    return refuse(`--${reasoned[0]} requires --reason "<why>".`);
  }
  if (has("milestone") && has("clear-milestone")) {
    return refuse("--milestone and --clear-milestone contradict each other: set the mission milestone or clear it, not both.");
  }
  if (has("check") && has("needs-human")) {
    return refuse("--check and --needs-human cannot be given together: a criterion either has a mechanical check or needs a human-supplied number.");
  }
  if (has("statement")) {
    const err = lineError("statement", statement, STATEMENT_MAX);
    if (err) return refuse(`${err}.`);
  }
  if (has("reason") && lineError("reason", reason, 400)) return refuse(`${lineError("reason", reason, 400)}.`);

  const m = missionOf(state);
  const notes = [];
  let changed = false;

  if (has("statement")) {
    if (m.current && m.current.statement === statement.trim()) {
      notes.push("the mission statement already reads exactly that — nothing changed");
    } else {
      if (m.current) m.history.push({ ...m.current, endedAt: now, endReason: reason.trim() });
      m.current = { statement: statement.trim(), setAt: now, reason: reason.trim() };
      changed = true;
    }
  }
  if (has("end")) {
    if (!m.current) return refuse("there is no current mission to end.");
    m.history.push({ ...m.current, endedAt: now, endReason: reason.trim() });
    m.current = null;
    changed = true;
  }
  if (has("milestone")) {
    const id = str(f.milestone);
    if (typeof id !== "string" || !findRelease(state, id)) {
      return refuse(`--milestone names '${escapeControls(id)}', which is not a declared release. Declare it first with \`release <id> --intent "<what it is for>"\`.`);
    }
    if (m.milestoneRelease !== id) { m.milestoneRelease = id; changed = true; }
    else notes.push(`the mission milestone is already '${escapeControls(id)}' — nothing changed`);
  }
  if (has("clear-milestone")) {
    if (m.milestoneRelease !== null) { m.milestoneRelease = null; changed = true; }
    else notes.push("there is no mission milestone to clear — nothing changed");
  }
  if (has("add-criterion")) {
    const text = str(f["add-criterion"]);
    const err = lineError("add-criterion", text, CRITERION_MAX);
    if (err) return refuse(`${err}.`);
    const check = has("check") ? str(f.check) : undefined;
    if (has("check")) {
      const cerr = lineError("check", check, CRITERION_MAX);
      if (cerr) return refuse(`${cerr}.`);
    }
    const id = `c${m.nextCriterion}`;
    m.criteria.push({ id, text: text.trim(), check: check === undefined ? null : check.trim(), needsHuman: has("needs-human"), addedAt: now });
    m.nextCriterion += 1;
    notes.push(`added criterion ${id}`);
    changed = true;
  }
  if (has("remove-criterion")) {
    const id = str(f["remove-criterion"]);
    const c = m.criteria.find(x => x && x.id === id);
    if (!c) return refuse(`--remove-criterion names '${escapeControls(id)}', which is not a criterion of this mission milestone.`);
    if (c.removedAt) return refuse(`criterion ${escapeControls(id)} was already removed (${escapeControls(c.removedAt)}).`);
    c.removedAt = now;
    c.removeReason = reason.trim();
    changed = true;
  }
  if (changed) state.mission = m;
  return { ok: true, changed, notes };
}

/** The lines `mission show` prints, and `--history` extends. Pure. */
export function missionShowLines(state, { history = false } = {}) {
  const m = missionOf(state);
  if (!m.current && !m.history.length && !m.criteria.length && m.milestoneRelease === null) return ["no mission"];
  const L = [];
  L.push(m.current ? `mission: ${m.current.statement}` : "mission: none (ended or never set)");
  if (m.current) L.push(`  set ${m.current.setAt} — ${m.current.reason}`);
  L.push(`mission milestone: ${m.milestoneRelease === null ? "none" : m.milestoneRelease}`);
  const active = activeCriteria(m);
  L.push(`criteria (${active.length} active):`);
  if (!active.length) L.push("  (none)");
  for (const c of active) {
    L.push(`  ${c.id} — ${c.text}${c.check ? ` [check: ${c.check}]` : ""}${c.needsHuman ? " [needs a human]" : ""}`);
  }
  L.push(`history: ${m.history.length} earlier statement${m.history.length === 1 ? "" : "s"}`);
  if (history) {
    for (const h of m.history) L.push(`  ${h.endedAt} — "${h.statement}" ended: ${h.endReason}`);
    for (const c of m.criteria.filter(x => x && x.removedAt)) L.push(`  ${c.removedAt} — criterion ${c.id} removed: ${c.removeReason} (${c.text})`);
  }
  return L;
}

/** `mission [show [--history]] | mission --statement … `. */
export function mission() {
  if (!isInitialized()) { die("conductor: run /pm:init first\n"); }
  const argv = currentArgv().slice(3);
  // A positional other than the reserved `show` was silently dropped (checkedPositionals, argv-surface.mjs).
  const [positional] = checkedPositionals("mission");
  if (positional !== undefined && positional !== SHOW) {
    die(`conductor: mission takes the read keyword \`show\` or flags only, not '${escapeControls(positional)}'. Nothing was written.\n`);
  }
  const read = argv[0] === SHOW;
  const f = parseFlags(read ? argv.slice(1) : argv);
  requireFlagValues("mission", f);
  if (read) {
    const stray = Object.keys(f).filter(k => k !== "history");
    if (stray.length) {
      die(`conductor: mission show is the READ form and takes only --history (got ${escapeControls(stray.map(k => `--${k}`).join(", "))}). \`show\` is reserved. Nothing was written.\n`);
    }
    const shown = missionShowLines(loadState(), { history: f.history === true });
    outStream().write(shown.map(escapeControls).join("\n") + "\n");
    return;
  }
  if (f.history !== undefined) { die("conductor: --history belongs to `mission show --history`. Nothing was written.\n"); }
  const state = loadState();
  const before = missionSectionText(state);
  const r = applyMission(state, f);
  if (!r.ok) { die(`conductor: ${escapeControls(r.message)}\n`); }
  for (const n of r.notes) errStream().write(`conductor: ${escapeControls(n)}\n`);
  if (!r.changed) {
    outStream().write("conductor: mission unchanged — nothing was written\n");
    return;
  }
  const saved = saveState(state);
  // The `## Mission` section follows the record: rewrite the block when its text changed (design D15).
  if (missionSectionText(state) !== before) writeRules(resolvePlatform({}, state));
  render();
  reportSave(saved, {
    changed: "conductor: mission recorded",
    unchanged: `conductor: the mission already read exactly that — ${STATE_UNCHANGED}`,
  });
}

