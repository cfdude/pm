// scripts/lib/epic-planning.mjs
// An epic's PLANNING fields (change release-planning-taxonomy, spec epic-annotation): its primary and secondary initiatives and when it
// joined the primary, its kind, and the two recorded challenge answers. `add-epic`, `update-epic` and `add-many` all read and write them
// through THIS module, so the three surfaces cannot admit different values (the same reason epic-summary.mjs exists).
//
// PURE over records: validate against the record, then apply to an epic. Nothing here touches disk. The engine checks PRESENCE and
// the id's existence; whether the work serves the initiative is the agent's judgment (design D6).

import { escapeControls } from "./constants.mjs";
import { lineFieldError } from "./epic-summary.mjs";
import { findInitiative } from "./initiative-record.mjs";
import { EPIC_KINDS } from "./release-plan.mjs";
import { flagValues } from "./non-goals.mjs";

/** A recorded challenge answer: one line, at most this many characters (design D16). */
export const REASON_MAX = 300;

/** The add-many batch keys this module owns: validated and written here, never by the generic string copy. */
export const PLANNING_BATCH_KEYS = ["initiative", "secondaryInitiatives", "kind", "offMissionReason", "offInitiativeReason"];

const last = (v) => (Array.isArray(v) ? v[v.length - 1] : v);

/** The planning input a CLI flag set carries (`f` is parseFlags()'s result). Absent keys stay undefined. */
export function planningFromFlags(f) {
  const out = {};
  if (f.initiative !== undefined) out.initiative = last(f.initiative);
  if (f["secondary-initiative"] !== undefined) out.secondary = flagValues(f["secondary-initiative"]);
  if (f["remove-secondary-initiative"] !== undefined) out.removeSecondary = flagValues(f["remove-secondary-initiative"]);
  if (f.kind !== undefined) out.kind = last(f.kind);
  if (f["off-mission-reason"] !== undefined) out.offMission = last(f["off-mission-reason"]);
  if (f["off-initiative-reason"] !== undefined) out.offInitiative = last(f["off-initiative-reason"]);
  return out;
}

/** The planning input one `add-many` entry carries. */
export function planningFromBatch(e) {
  const out = {};
  if (e.initiative !== undefined) out.initiative = e.initiative;
  if (e.secondaryInitiatives !== undefined) out.secondary = e.secondaryInitiatives;
  if (e.kind !== undefined) out.kind = e.kind;
  if (e.offMissionReason !== undefined) out.offMission = e.offMissionReason;
  if (e.offInitiativeReason !== undefined) out.offInitiative = e.offInitiativeReason;
  return out;
}

const NOT_RECORDED = "which is not a recorded initiative. Record it first with the initiative verb (an id, --title and --capability)";

/** The refusal for `input` against `state`, or null. `current` is the epic being amended (null for a new one); `where` prefixes a batch
 *  entry's id. Every check runs before any write, so a refusal writes nothing. */
export function planningError(state, input, current, where = "") {
  const w = (flag) => `${where}${flag}`;
  const known = (id) => typeof id === "string" && findInitiative(state, id) !== null;
  if (input.kind !== undefined && !EPIC_KINDS.includes(input.kind)) {
    return escapeControls(`${w("--kind")} must be one of ${EPIC_KINDS.join("|")} (got ${JSON.stringify(input.kind === undefined ? null : input.kind)})`);
  }
  for (const [key, flag] of [["offMission", "--off-mission-reason"], ["offInitiative", "--off-initiative-reason"]]) {
    if (input[key] === undefined) continue;
    const err = lineFieldError({ flag: flag.slice(2), max: REASON_MAX }, input[key], w(flag));
    if (err) return err;
  }
  if (input.initiative !== undefined && !known(input.initiative)) {
    return escapeControls(`${w("--initiative")} names '${String(input.initiative)}', ${NOT_RECORDED}`);
  }
  const secondary = Array.isArray(input.secondary) ? input.secondary : input.secondary === undefined ? [] : [input.secondary];
  if (input.secondary !== undefined && !Array.isArray(input.secondary)) return escapeControls(`${w("secondaryInitiatives")} must be an array of initiative ids`);
  const primary = input.initiative !== undefined ? input.initiative : current && typeof current.initiative === "string" ? current.initiative : undefined;
  for (const id of secondary) {
    if (!known(id)) return escapeControls(`${w("--secondary-initiative")} names '${String(id)}', ${NOT_RECORDED}`);
    if (id === primary) return escapeControls(`${w("--secondary-initiative")} '${id}' is the epic's primary initiative — a secondary must differ from the primary`);
  }
  if (input.initiative !== undefined) {
    const held = [...(current && Array.isArray(current.secondaryInitiatives) ? current.secondaryInitiatives : []), ...secondary];
    if (held.includes(input.initiative)) {
      return escapeControls(`${w("--initiative")} '${input.initiative}' is already one of the epic's secondary initiatives — remove it from the secondaries first (--remove-secondary-initiative), since a secondary must differ from the primary`);
    }
  }
  for (const id of Array.isArray(input.removeSecondary) ? input.removeSecondary : []) {
    const has = current && Array.isArray(current.secondaryInitiatives) && current.secondaryInitiatives.includes(id);
    if (!has) return escapeControls(`${w("--remove-secondary-initiative")} names '${String(id)}', which is not a secondary initiative of this epic`);
  }
  return null;
}

/** Write `input` (already validated) onto `epic`. A new primary stamps `initiativeJoinedAt`; the same value keeps it. Returns whether anything changed. */
export function applyPlanning(epic, input, now) {
  let changed = false;
  const set = (key, v) => { if (epic[key] !== v) { epic[key] = v; changed = true; } };
  if (input.initiative !== undefined && epic.initiative !== input.initiative) {
    epic.initiative = input.initiative;
    epic.initiativeJoinedAt = now;
    changed = true;
  }
  if (Array.isArray(input.secondary) && input.secondary.length) {
    const list = Array.isArray(epic.secondaryInitiatives) ? epic.secondaryInitiatives.slice() : [];
    for (const id of input.secondary) if (!list.includes(id)) { list.push(id); changed = true; }
    epic.secondaryInitiatives = list;
  }
  if (Array.isArray(input.removeSecondary) && input.removeSecondary.length) {
    const list = (Array.isArray(epic.secondaryInitiatives) ? epic.secondaryInitiatives : []).filter(id => !input.removeSecondary.includes(id));
    if (list.length) epic.secondaryInitiatives = list; else delete epic.secondaryInitiatives;
    changed = true;
  }
  if (input.kind !== undefined) set("kind", input.kind);
  if (input.offMission !== undefined) set("offMissionReason", input.offMission.trim());
  if (input.offInitiative !== undefined) set("offInitiativeReason", input.offInitiative.trim());
  return changed;
}
