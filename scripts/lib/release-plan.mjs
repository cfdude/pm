// scripts/lib/release-plan.mjs
// The release PLAN readers (change project-boards, spec release-planning), shared by `board`, `release show` and the
// `render` verb so the three cannot disagree. Every value here is DERIVED on read and none is stored: a status that is
// recorded can disagree with `--deliver`, and a critical path that is recorded goes stale the moment an order moves.
//
// Pure over a state record. No disk, no git, no output.

import { escapeControls, findRelease } from "./constants.mjs";

/** A text plan field: one line, at most this many characters. */
export const PLAN_TEXT_MAX = 400;
/** The "we are here" and "next up" lines: one line, at most this many characters. */
export const PLAN_LINE_MAX = 200;
/** The clearable plan fields, in the order they are listed in a refusal. */
export const PLAN_FIELDS = ["theme", "rationale", "exit", "order", "size"];
/** The text ones among them. */
export const PLAN_TEXT_FIELDS = ["theme", "rationale", "exit"];
/** `--size` is the semver impact. */
export const PLAN_SIZES = ["major", "minor", "patch"];

/** The member statuses that make an undelivered release `in-progress`. An archived member counts: the work is done
 *  and delivery is simply not recorded. */
const IN_FLIGHT = ["active", "paused", "blocked", "archived"];

/** `planned | in-progress | shipped`. `--deliver` wins; else any member in flight; else planned (always, with no
 *  members). `memberStatuses` is the list of the members' statuses. */
export function releaseStatus(rel, memberStatuses) {
  if (rel && rel.delivered) return "shipped";
  return (memberStatuses || []).some(s => IN_FLIGHT.includes(s)) ? "in-progress" : "planned";
}

/** An order as a number, or null when the release carries none (or a non-integer). */
export const orderOfRelease = (rel) => (rel && Number.isInteger(rel.order) && rel.order >= 0 ? rel.order : null);

/** The mission milestone as `{id, order}`, or null when none is set or it names a release that does not exist. */
export function milestoneOf(state) {
  const id = state && state.mission && state.mission.milestoneRelease;
  const rel = typeof id === "string" ? findRelease(state, id) : null;
  return rel ? { id, order: orderOfRelease(rel) } : null;
}

/** Is `rel` on the critical path? `true` when it is the milestone or has an order at most the milestone's; `false`
 *  otherwise; `null` (unknown) with no milestone, or a milestone release with no order. */
export function criticalPathOf(rel, state) {
  const m = milestoneOf(state);
  if (!m || m.order === null) return null;
  const order = orderOfRelease(rel);
  return rel.id === m.id || (order !== null && order <= m.order);
}

/** The plan marker as `{here, hereText, nextText}` with every field null when unset, or when `here` names no release. */
export function planOf(state) {
  const p = state && state.releasePlan && typeof state.releasePlan === "object" ? state.releasePlan : {};
  const here = typeof p.here === "string" && findRelease(state, p.here) ? p.here : null;
  const text = (v) => (typeof v === "string" ? v : null);
  return { here, hereText: text(p.hereText), nextText: text(p.nextText) };
}

/** The ` (here)` / ` (critical path)` / ` (off critical path)` marks for one release, as one suffix. */
export function releaseMarks(rel, state) {
  const crit = criticalPathOf(rel, state);
  return (planOf(state).here === rel.id ? " (here)" : "") +
    (crit === true ? " (critical path)" : crit === false ? " (off critical path)" : "");
}

/** The lines the `render` verb (the `/pm:status` verb) prints for the plan: `here:`, `next:` and the critical-path
 *  mark per release. Empty with no marker and no mark. Never written into PROJECT.md or the brief. */
export function planStatusLines(state) {
  const plan = planOf(state);
  const lines = [];
  if (plan.here !== null) lines.push(escapeControls(`here: ${plan.here}${plan.hereText ? ` — ${plan.hereText}` : ""}`));
  if (plan.here !== null && plan.nextText) lines.push(escapeControls(`next: ${plan.nextText}`));
  const releases = (Array.isArray(state && state.releases) ? state.releases : []).filter(r => r && r.id);
  const marked = releases.map(r => ({ r, crit: criticalPathOf(r, state) })).filter(x => x.crit !== null);
  if (marked.length) {
    lines.push("release plan:");
    for (const { r, crit } of marked) lines.push(escapeControls(`  ${r.id} ${crit ? "(critical path)" : "(off critical path)"}`));
  }
  return lines;
}
