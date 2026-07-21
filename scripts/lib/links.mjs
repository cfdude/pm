// scripts/lib/links.mjs
// Epic-link validation/normalization and detour-context detection. Pure functions,
// no dependencies on any other lib module.

/** A link is renderable only when both endpoints are strings. Guards against
 *  malformed/partial entries (incl. older schemas) that would render `undefined`. */
export function validLink(l) {
  return l && typeof l.type === "string" && typeof l.epic === "string";
}

/** Normalize one stored link for the 0.5.0 migration. Repair-first:
 *  a valid {type, epic} object passes through; the documented colon-string
 *  encoding `type:epic[:reason]` (what add-epic's --link parser produces) is
 *  repaired into an object; anything else is unrecoverable → null (dropped). */
export function normalizeLink(l) {
  if (validLink(l)) return l;
  if (typeof l === "string") {
    const [type, epic, ...rest] = l.split(":");
    if (type && epic) {
      const reason = rest.join(":").trim();
      return reason ? { type, epic, reason } : { type, epic };
    }
  }
  return null;
}

/** Is the project currently inside a detour? (active epic is a detour, or stack non-empty) */
export function detourContext(state) {
  if (state.detourStack && state.detourStack.length) {
    const top = state.detourStack[state.detourStack.length - 1];
    return { active: true, detourId: top.spawnedDetour || state.active || "-" };
  }
  const cur = state.epics.find(e => e.id === state.active);
  if (cur && cur.role === "detour") return { active: true, detourId: cur.id };
  return { active: false, detourId: null };
}
