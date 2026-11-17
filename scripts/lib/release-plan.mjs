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
/** The clearable plan fields, in the order they are listed in a refusal. `target` is a field `--target` has always set; it joined the
 *  clearable list in project-boards 8.5 so it has an inverse. `intent` has none: a release with no intent is the failure its creation refuses. */
export const PLAN_FIELDS = ["theme", "rationale", "exit", "order", "size", "target"];
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

// ─────────────── the 80/20 split and scope movement (change release-planning-taxonomy, spec release-planning) ───────────────
// Every value below is DERIVED on read and none is stored (design D9, D21, D31): a stored split disagrees with the members the
// moment one is added, and a stored baseline needs an inverse the owner declined.

/** The fixed health-share target (D30): the same for every project, with no setting. */
export const HEALTH_SHARE_TARGET = 0.2;
/** The drift band (D10, D19): a share BELOW the minimum or ABOVE the maximum drifts; the edges are inside. Engine constants, not settings. */
export const HEALTH_SHARE_MIN = 0.1;
export const HEALTH_SHARE_MAX = 0.3;
/** The two epic kinds. */
export const EPIC_KINDS = ["initiative-work", "health"];

/** An epic's EFFECTIVE kind (D21a): the recorded kind; a `claude-code`-lane epic with none reads `initiative-work` when it names
 *  an initiative (`names`, true when it names a recorded one), else `health`; anything else with none reads null. Never stored. */
export function effectiveKindOf(epic, names) {
  if (epic && EPIC_KINDS.includes(epic.kind)) return epic.kind;
  if (epic && epic.lane === "claude-code") return names ? "initiative-work" : "health";
  return null;
}

/** The set of recorded initiative ids. */
export const initiativeIdSet = (state) =>
  new Set((state && Array.isArray(state.initiatives) ? state.initiatives : []).filter(i => i && typeof i.id === "string").map(i => i.id));

/** A release's split over ALL its members, in any lane, each counted once (D21, D32): `health` when its effective kind is health,
 *  else `initiativeWork` when it names a recorded primary initiative, else `unaligned`. `healthShare` is health over every member,
 *  null with none. `drift` is null with no share, else true below the minimum or above the maximum. Compared in integers so 1/10
 *  and 3/10 sit on the edge exactly. */
export function releaseSplit(memberRecords, initiativeIds) {
  const split = { initiativeWork: 0, health: 0, unaligned: 0 };
  for (const e of memberRecords) {
    const names = typeof e.initiative === "string" && initiativeIds.has(e.initiative);
    if (effectiveKindOf(e, names) === "health") split.health++;
    else if (names) split.initiativeWork++;
    else split.unaligned++;
  }
  const n = memberRecords.length;
  const share = n === 0 ? null : split.health / n;
  const lo = Math.round(HEALTH_SHARE_MIN * 100), hi = Math.round(HEALTH_SHARE_MAX * 100);
  const drift = n === 0 ? null : (split.health * 100 < lo * n || split.health * 100 > hi * n);
  return { ...split, healthShare: share, target: HEALTH_SHARE_TARGET, drift };
}

/** `true` when a member names the release's primary initiative (as primary or secondary), `false` when it has members and none does,
 *  null with no members or no primary (D24). */
export function primaryServedOf(primary, memberRecords) {
  if (typeof primary !== "string" || !memberRecords.length) return null;
  return memberRecords.some(e => e.initiative === primary || (Array.isArray(e.secondaryInitiatives) && e.secondaryInitiatives.includes(primary)));
}

const ms = (v) => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? Date.parse(v) : null);

/** The derived planning baseline (D31): the earliest `startedAt` among the members that have one, as the member recorded it, or null.
 *  `addedSincePlanning` counts members whose `releaseJoinedAt` is later; `unknownJoinTime` those with none. Both null with no baseline. */
export function releaseScope(memberRecords) {
  let base = null, baseAt = null;
  for (const e of memberRecords) {
    const t = ms(e.startedAt);
    if (t !== null && (baseAt === null || t < baseAt)) { base = e.startedAt; baseAt = t; }
  }
  if (baseAt === null) return { planningBaseline: null, addedSincePlanning: null, unknownJoinTime: null };
  let added = 0, unknown = 0;
  for (const e of memberRecords) {
    const j = ms(e.releaseJoinedAt);
    if (j === null) unknown++;
    else if (j > baseAt) added++;
  }
  return { planningBaseline: base, addedSincePlanning: added, unknownJoinTime: unknown };
}
