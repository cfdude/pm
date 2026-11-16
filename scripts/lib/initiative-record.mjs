// scripts/lib/initiative-record.mjs
// The READERS of `state.initiatives` (change release-planning-taxonomy, spec initiative-record). A LEAF like
// mission-record.mjs: it imports only constants.mjs and non-goals.mjs, so board.mjs, integrity.mjs, rules.mjs and the verb
// can all read the record without importing the `initiative` verb. Pure over a record; no disk, no output.
//
//   state.initiatives = [{id, title, capability, status: "open"|"ended", outcome, endedAt, createdAt, source,
//                         offMissionReason, history: [{event, outcome?, at, reason}],
//                         milestones: [{id, text, addedAt, reachedAt?, evidence?, history, removedAt?, removeReason?}],
//                         nextMilestone, nonGoals, nextNonGoal}]

import { activeNonGoals } from "./non-goals.mjs";

export const INITIATIVE_OUTCOMES = ["delivered", "abandoned", "superseded"];

const MN = /^m([1-9][0-9]*)$/;

/** Every recorded initiative that is an object with a string id, in creation order. Never mutates. */
export function initiativesOf(state) {
  return (state && Array.isArray(state.initiatives) ? state.initiatives : []).filter(i => i && typeof i === "object" && typeof i.id === "string");
}

/** One initiative by id, or null. */
export const findInitiative = (state, id) => initiativesOf(state).find(i => i.id === id) || null;

/** The initiatives whose status is `open`. */
export const openInitiatives = (state) => initiativesOf(state).filter(i => i.status !== "ended");

/** The active (not removed) initiative milestones of one initiative, in id order. */
export function activeMilestones(init) {
  const num = (id) => { const m = MN.exec(id); return m ? Number(m[1]) : Infinity; };
  return (init && Array.isArray(init.milestones) ? init.milestones : [])
    .filter(m => m && typeof m === "object" && typeof m.id === "string" && !m.removedAt)
    .sort((a, b) => num(a.id) - num(b.id));
}

/** The next milestone number: past every id on record, so an id is never reused. */
export function nextMilestoneNumber(init) {
  let next = init && Number.isInteger(init.nextMilestone) && init.nextMilestone >= 1 ? init.nextMilestone : 1;
  for (const m of init && Array.isArray(init.milestones) ? init.milestones : []) {
    const hit = m && MN.exec(m.id);
    if (hit && Number(hit[1]) >= next) next = Number(hit[1]) + 1;
  }
  return next;
}

/** An initiative's active non-goals, `[{id, text}]`. */
export const initiativeNonGoals = (init) => activeNonGoals(init);

/** The work disposition an ended initiative carries, or null while it is open. Read by destructuring, deliberately: an initiative's
 *  outcome is a WORK disposition of its own, and an epic's outcome is read only through outcomeOf() (the sweep in conductor-13). */
export function initiativeOutcome(init) {
  const { outcome } = init || {};
  return init && init.status === "ended" && typeof outcome === "string" ? outcome : null;
}

/** The outcome a history event recorded, or null. */
export function eventOutcome(event) {
  const { outcome } = event || {};
  return typeof outcome === "string" ? outcome : null;
}

/** Mark an initiative ended / reopened. The two writers of `status`, `outcome` and `endedAt`, so the three stay in step. */
export function markEnded(init, outcome, at) { Object.assign(init, { status: "ended", outcome, endedAt: at }); }
export function markReopened(init) { Object.assign(init, { status: "open", outcome: null, endedAt: null }); }

/** How many epics name `id` as their PRIMARY initiative. */
export function primaryEpicCount(state, id) {
  return (state && Array.isArray(state.epics) ? state.epics : []).filter(e => e && e.initiative === id).length;
}
