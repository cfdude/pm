// scripts/lib/mission-record.mjs
// The READERS of `state.mission` (change project-boards): the record with every key present, the active criteria, the
// SessionStart brief's one mission line and the `render` verb's mission lines. A LEAF (it imports only constants.mjs), so
// briefing.mjs and render.mjs can read the mission without importing the `mission` verb, which imports the rules writer
// and render. Pure over a record; no disk, no output.

import { escapeControls } from "./constants.mjs";

/** The mission record with every key present, never mutating its argument. */
export function missionOf(state) {
  const m = state && state.mission && typeof state.mission === "object" ? state.mission : {};
  return {
    current: m.current && typeof m.current === "object" ? m.current : null,
    history: Array.isArray(m.history) ? m.history : [],
    milestoneRelease: typeof m.milestoneRelease === "string" ? m.milestoneRelease : null,
    criteria: Array.isArray(m.criteria) ? m.criteria : [],
    nextCriterion: Number.isInteger(m.nextCriterion) && m.nextCriterion >= 1 ? m.nextCriterion : 1,
  };
}

/** The active criteria, in id order. */
export const activeCriteria = (m) => m.criteria.filter(c => c && !c.removedAt);

/** The SessionStart brief's one mission line, or "" with no current mission. At most BRIEF_LINE_MAX bytes: the statement is
 *  cut with an ellipsis so the whole line stays within it. Pure. */
export const BRIEF_LINE_MAX = 200;
export function missionBriefLine(state) {
  const m = missionOf(state);
  if (!m.current || typeof m.current.statement !== "string") return "";
  const bytes = (s) => Buffer.byteLength(s, "utf8");
  const ms = m.milestoneRelease === null ? "none" : escapeControls(m.milestoneRelease).slice(0, 40);
  const head = "MISSION: ";
  const tail = ` (mission milestone: ${ms})`;
  const room = BRIEF_LINE_MAX - bytes(head) - bytes(tail);
  let statement = escapeControls(m.current.statement);
  if (bytes(statement) > room) {
    const cps = [...statement];
    while (cps.length && bytes(cps.join("")) + 3 > room) cps.pop();
    statement = cps.join("").trimEnd() + "…";
  }
  return head + statement + tail;
}

/** The lines the `render` verb (`/pm:status`) prints for the mission: the statement, the mission milestone and how many
 *  active criteria it has. Empty with no current mission. */
export function missionStatusLines(state) {
  const m = missionOf(state);
  if (!m.current) return [];
  return [escapeControls(`mission: ${m.current.statement} (mission milestone: ${m.milestoneRelease === null ? "none" : m.milestoneRelease}; ${activeCriteria(m).length} active criteria)`)];
}
