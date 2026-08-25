// scripts/lib/links.mjs
// Epic-link validation/normalization, detour-context detection, and THE declaration of every
// place the record holds an epic id. Pure functions, no dependencies on any other lib module.

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

/** EVERY place `state` holds an epic id, as one flat list — the single declaration both the
 *  `remove-epic` sweep and the `dangling-epic-reference` integrity check read.
 *
 *  It exists because the sweep was written as an enumeration and went stale exactly as
 *  docs/lessons/bind-rules-to-functions-not-enumerations predicts. `remove-epic` stripped
 *  `links[]` and nulled a removed `active`, then group 14 added three more holders — a
 *  release's `deferred[]`, an archive disposition's `carriedTo`, a deferral assertion's
 *  `deferrals[]` — and none was swept, so removing an epic a release had deferred left
 *  `PROJECT.md` rendering a deferral that pointed at nothing. Declaring the set once means a
 *  sixth holder is handled by both consumers or by neither, never by one of them.
 *
 *  Each entry carries `drop()` where the reference can be removed WITHOUT losing anything the
 *  record needs, and `drop: null` where it cannot. A detour frame is the second kind: it is
 *  control state, not a record, so dropping it would discard a paused epic's resume path while
 *  keeping it would leave `/pm:resume` popping a frame that names nothing. `remove-epic`
 *  refuses on those instead of sweeping them.
 *
 *  `parent` is included even though `remove-epic` handles it structurally (block-or-cascade):
 *  the integrity check has no such structure behind it, and a hand-edited state can dangle a
 *  parent like anything else. */
export function epicReferences(state) {
  const refs = [];
  const add = (holder, where, epic, drop) => { if (typeof epic === "string" && epic) refs.push({ holder, where, epic, drop }); };

  if (state && typeof state.active === "string") {
    add(null, "state.active", state.active, () => { state.active = null; });
  }
  for (const e of (state && state.epics) || []) {
    if (!e || typeof e !== "object") continue;
    for (const l of Array.isArray(e.links) ? [...e.links] : []) {
      add(e.id, `epic \`${e.id}\` links[]`, l && l.epic, () => { e.links = e.links.filter(x => x !== l); });
    }
    add(e.id, `epic \`${e.id}\` parent`, e.parent, () => { delete e.parent; });
    if (e.disposition && typeof e.disposition === "object") {
      add(e.id, `epic \`${e.id}\` disposition.carriedTo`, e.disposition.carriedTo,
        () => { delete e.disposition.carriedTo; });
    }
    const da = e.deferralAssertion;
    for (const d of da && Array.isArray(da.deferrals) ? [...da.deferrals] : []) {
      add(e.id, `epic \`${e.id}\` deferralAssertion.deferrals[]`, d && d.epic,
        () => { da.deferrals = da.deferrals.filter(x => x !== d); });
    }
  }
  for (const r of (state && state.releases) || []) {
    for (const d of r && Array.isArray(r.deferred) ? [...r.deferred] : []) {
      add(null, `release \`${r.id}\` deferred[]`, d && d.epic,
        () => { r.deferred = r.deferred.filter(x => x !== d); });
    }
  }
  for (const f of (state && state.detourStack) || []) {
    if (!f || typeof f !== "object") continue;
    add(null, "a detour-stack frame's pausedEpic", f.pausedEpic, null);
    add(null, "a detour-stack frame's spawnedDetour", f.spawnedDetour, null);
  }
  return refs;
}
