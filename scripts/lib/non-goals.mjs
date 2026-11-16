// scripts/lib/non-goals.mjs
// The ONE non-goal shape, shared by the four records that hold them (change release-planning-taxonomy, spec non-goals,
// design D12): the mission, an initiative, a release and an epic. Never a milestone or a criterion.
//
//   {id: "nN", text, addedAt, removedAt?, removeReason?}
//
// Ids are per record, from a counter on that record (`nextNonGoal`) that only advances, so an id is never reused. A removal
// MARKS the entry and keeps it. Validation is one function so the four records cannot drift apart, and every value is
// checked before any write: one bad value refuses the whole invocation.
//
// READERS are pure over a record and import nothing but constants.mjs and epic-summary.mjs, so board.mjs can read them.

import { escapeControls } from "./constants.mjs";
import { lineFieldError } from "./epic-summary.mjs";

/** A non-goal's text: one line, at most this many characters. */
export const NON_GOAL_MAX = 300;

const ADD = { flag: "add-non-goal", max: NON_GOAL_MAX };
const NN = /^n([1-9][0-9]*)$/;

/** The refusal for one `--add-non-goal` value, or null. `where` prefixes a batch entry's key. Pure. */
export function nonGoalError(value, where) {
  return lineFieldError(ADD, value, where === undefined ? "--add-non-goal" : where);
}

/** The values of a repeatable flag as strings, in order. A valueless occurrence arrives as `true`, which is kept so it is refused. */
export const flagValues = (v) => (v === undefined ? [] : [].concat(v));

/** Every value checked; the first refusal text, or null. */
export function nonGoalsError(values, where) {
  for (const v of values) {
    const err = nonGoalError(v, where);
    if (err) return err;
  }
  return null;
}

/** A record's non-goal list (never null), its counter (at least one past every id) — read without mutating. */
export function nonGoalsOf(rec) {
  const list = rec && Array.isArray(rec.nonGoals) ? rec.nonGoals.filter(g => g && typeof g === "object") : [];
  let next = rec && Number.isInteger(rec.nextNonGoal) && rec.nextNonGoal >= 1 ? rec.nextNonGoal : 1;
  for (const g of list) { const m = NN.exec(g.id); if (m && Number(m[1]) >= next) next = Number(m[1]) + 1; }
  return { list, next };
}

/** The active non-goals as `[{id, text}]`, in id order. */
export function activeNonGoals(rec) {
  const num = (id) => { const m = NN.exec(id); return m ? Number(m[1]) : Infinity; };
  return nonGoalsOf(rec).list
    .filter(g => !g.removedAt && typeof g.id === "string" && typeof g.text === "string")
    .sort((a, b) => num(a.id) - num(b.id))
    .map(g => ({ id: g.id, text: g.text }));
}

/** Append `texts` (already validated) to `rec`, in order. Returns the ids added. */
export function addNonGoals(rec, texts, now) {
  const { list, next } = nonGoalsOf(rec);
  let n = next;
  const ids = [];
  for (const t of texts) {
    const id = `n${n}`;
    list.push({ id, text: t.trim(), addedAt: now });
    ids.push(id);
    n += 1;
  }
  rec.nonGoals = list;
  rec.nextNonGoal = n;
  return ids;
}

/** `<prefix>N:<why>` split at the FIRST colon. `what` names the text half (`why` or `evidence`). Returns `{id, reason}` or `{error}`.
 *  Not repeatable, so one reason never covers two records. */
export function parseRemoval(raw, flag, noun = "non-goal", prefix = "n", what = "why") {
  const shape = `--${flag} "${prefix}N:<${what}>"`;
  const need = what === "evidence" ? "evidence" : "a reason";
  if (typeof raw !== "string" || raw.trim() === "") return { error: `${shape} is the form (it needs the id and ${need})` };
  const at = raw.indexOf(":");
  if (at === -1) return { error: `--${flag} needs ${need}: ${shape}${what === "why" ? ` — a ${noun} removed with no reason is indistinguishable from one nobody decided` : ""}` };
  const id = raw.slice(0, at).trim();
  const reason = raw.slice(at + 1).trim();
  if (id === "") return { error: `${shape} is the form (the id is empty)` };
  if (reason === "") return { error: `--${flag} needs ${need}: ${shape}` };
  return { id, reason };
}

/** Mark one non-goal removed. Returns an error text, or null when it was marked. */
export function removeNonGoal(rec, id, reason, now) {
  const hit = nonGoalsOf(rec).list.find(g => g.id === id);
  if (!hit) return `--remove-non-goal names '${escapeControls(id)}', which is not a non-goal of this record`;
  if (hit.removedAt) return `non-goal ${escapeControls(id)} was already removed (${escapeControls(hit.removedAt)})`;
  hit.removedAt = now;
  hit.removeReason = reason;
  return null;
}

/** The removed ones, for `--history` readers. */
export const removedNonGoals = (rec) => nonGoalsOf(rec).list.filter(g => g.removedAt);
