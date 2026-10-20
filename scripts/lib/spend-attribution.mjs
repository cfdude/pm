// scripts/lib/spend-attribution.mjs
// token-spend-tracking-per-epic — WHOSE tokens were they. Pure: rows, markers, a timeline and the
// current state in, attributed rows out. No file, no clock, no git.
//
// COMPUTED AT READ TIME, NEVER STORED (design D6). A stored row carries no `epic`, `attribution` or
// `reason`. Attributing at ingest would freeze two wrong answers: an epic registered AFTER its marked
// dispatch would stay `unknown-epic` forever, and an epic removed later would keep its credit. Every
// report runs this function over the folded rows it was going to read anyway, against the markers, the
// timeline and the state as they are NOW.
//
// THE PRECEDENCE, and the first rule that applies wins:
//   1. tracking-off   the row falls in an interval the switch was off — whatever its actor or marker
//   2. marker         a SUB-AGENT row takes epic, role, phase and round from its agent's valid marker
//   3. window         an ORCHESTRATOR row takes the epic the timeline says was active at its `at`
//   4. unattributed   with a reason from a closed list
// A sub-agent row is NEVER window-attributed: background sub-agents build several epics at once, so a
// window would credit them to whichever epic the orchestrator last activated — confidently wrong. An
// honest `unmarked-subagent` total is the signal that the marker discipline slipped.

import { KNOWN_JOB_ROLES, KNOWN_SPEND_PHASES } from "./constants.mjs";

/** The closed list of reasons a row is unattributed, as the report prints them. */
export const UNATTRIBUTED_REASONS = Object.freeze([
  "tracking-off", "unmarked-subagent", "invalid-marker", "unknown-epic", "no-active-epic", "before-timeline",
]);

const ms = (iso) => (typeof iso === "string" ? Date.parse(iso) : NaN);

/** The timeline's usable entries, oldest first (stable for equal instants). A malformed line is
 *  skipped, not trusted. */
export function normalizeTimeline(timeline) {
  const out = [];
  for (const e of Array.isArray(timeline) ? timeline : []) {
    if (!e || typeof e !== "object") continue;
    const t = ms(e.at);
    if (!Number.isFinite(t)) continue;
    out.push({ t, tracking: e.tracking === "off" || e.tracking === "on" ? e.tracking : null, hasActive: Object.prototype.hasOwnProperty.call(e, "active"), active: typeof e.active === "string" && e.active ? e.active : null });
  }
  return out.map((e, i) => [e, i]).sort((a, b) => a[0].t - b[0].t || a[1] - b[1]).map((p) => p[0]);
}

/** The intervals tracking was off, from `normalizeTimeline()`'s entries: from each `off` entry up to
 *  the next `on` entry (exclusive), or without end. An `off` at T covers T itself. */
export function offIntervals(entries) {
  const out = [];
  let open = null;
  for (const e of entries) {
    if (e.tracking === "off" && open === null) open = e.t;
    else if (e.tracking === "on" && open !== null) { out.push({ from: open, to: e.t }); open = null; }
  }
  if (open !== null) out.push({ from: open, to: Infinity });
  return out;
}

/** What the timeline says was active at `t`: `{ before: true }` when no entry precedes it, else
 *  `{ active: <id|null> }`. Only entries that SAY something about the active epic count; a bare
 *  `off` entry says nothing (rows after it are tracking-off anyway, and the next `on` re-seeds). */
export function activeAt(entries, t) {
  let seen = false, active = null;
  for (const e of entries) {
    if (e.t > t) break;
    if (e.tracking === "off" || !e.hasActive) continue;
    seen = true;
    active = e.active;
  }
  return seen ? { active } : { before: true };
}

/** What a `round` must be: not a list, so the one-element description both report forms print. */
export const ROUND_ACCEPTED = Object.freeze(["positive integer"]);

/** Validate a stored marker against the CURRENT lists and state. `roles` and `phases` default to the
 *  constants and are parameters so a role added to KNOWN_JOB_ROLES is accepted with no ledger change. */
export function resolveMarker(marker, { epicIds, roles = KNOWN_JOB_ROLES, phases = KNOWN_SPEND_PHASES }) {
  if (!marker || typeof marker !== "object") return { ok: false, reason: "unmarked-subagent" };
  const { epic, role, phase } = marker;
  const roundText = marker.round === null || marker.round === undefined ? "1" : String(marker.round);
  // The FIRST failing field in the fixed order role, phase, round (gh-cfdude-pm-242 D1) is carried out with
  // the rejected value and the accepted set, read from the lists the check itself uses (D2). Validation
  // stays strict: no alias is mapped, so `reason` is still `invalid-marker` and nothing is attributed.
  const invalid = (field, value, accepted) => ({ ok: false, reason: "invalid-marker", field, value: value === undefined ? null : value, accepted });
  if (!roles.includes(role)) return invalid("role", role, roles);
  if (!phases.includes(phase)) return invalid("phase", phase, phases);
  if (!/^[1-9][0-9]*$/.test(roundText)) return invalid("round", marker.round, ROUND_ACCEPTED);
  if (typeof epic !== "string" || !epicIds.has(epic)) return { ok: false, reason: "unknown-epic" };
  return { ok: true, epic, role, phase, round: Number(roundText) };
}

/** Attribute every row. Returns new rows with `epic`, `role`, `phase`, `round` (null where they do not
 *  apply), `attribution` (`marker` | `window` | null) and `reason` (null when attributed). Never drops
 *  a row, and never mutates its input. */
export function attribute(rows, markers, timeline, state, opts = {}) {
  const epicIds = new Set((state && Array.isArray(state.epics) ? state.epics : []).map((e) => e && e.id).filter((id) => typeof id === "string"));
  const entries = normalizeTimeline(timeline);
  const off = offIntervals(entries);
  const lists = { epicIds, roles: opts.roles || KNOWN_JOB_ROLES, phases: opts.phases || KNOWN_SPEND_PHASES };
  const none = { epic: null, role: null, phase: null, round: null, attribution: null };
  const unattributed = (r, reason) => ({ ...r, ...none, reason });

  return rows.map((r) => {
    const t = ms(r.at);
    if (off.some((iv) => t >= iv.from && t < iv.to)) return unattributed(r, "tracking-off");
    if (r.actor === "subagent") {
      const m = markers && r.agentId ? markers[r.agentId] : undefined;
      const resolved = resolveMarker(m, lists);
      if (!resolved.ok) {
        const row = unattributed(r, resolved.reason);
        // Only an invalid marker carries the field that failed; the report groups on it at read time.
        return resolved.field ? { ...row, invalid: { field: resolved.field, value: resolved.value, accepted: resolved.accepted } } : row;
      }
      return { ...r, epic: resolved.epic, role: resolved.role, phase: resolved.phase, round: resolved.round, attribution: "marker", reason: null };
    }
    const at = activeAt(entries, t);
    if (at.before) return unattributed(r, "before-timeline");
    if (at.active === null) return unattributed(r, "no-active-epic");
    if (!epicIds.has(at.active)) return unattributed(r, "unknown-epic");
    return { ...r, epic: at.active, role: null, phase: null, round: null, attribution: "window", reason: null };
  });
}
