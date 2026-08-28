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

/** THE set of epic ids some OTHER epic declares it supersedes — one declaration, read by
 *  `triage`'s candidate scorer and by the `superseded-epic-never-ended` integrity check.
 *
 *  Declared here for the same reason `epicReferences()` is: two copies of "who is superseded"
 *  drift, and the two consumers then disagree about which epics are already dead. `triage` marks
 *  a candidate `superseded: true` so an agent does not consolidate a fourth ask into a corpse;
 *  the check reports that same corpse still carrying a non-terminal status. Those must be the
 *  same set or one surface is telling an agent an epic is dead while the other says it is live
 *  work.
 *
 *  Direction is FIXED and asymmetric: the link lives on the epic that REPLACES, naming the epic
 *  replaced (`--link "supersedes:<id>:<why>"`), so the ids collected here are the replaced ones.
 *  Reading it the other way round would report every consolidation's survivor.
 *
 *  Returns a MAP from the replaced id to the FIRST epic declaring it — not a Set — so a consumer
 *  that must name the replacement does not walk the links a second time to find it. `.has()` is
 *  the membership test either way, which is all `triage` asks of it. First-declarer wins where
 *  two epics both claim to supersede one: naming one of them is what a finding needs, and
 *  "which of several consolidations is the real one" is a judgment no engine should invent. */
export function supersededEpics(epics) {
  const out = new Map();
  for (const e of Array.isArray(epics) ? epics : []) {
    for (const l of e && Array.isArray(e.links) ? e.links : []) {
      if (l && l.type === "supersedes" && typeof l.epic === "string" && !out.has(l.epic)) {
        out.set(l.epic, e.id);
      }
    }
  }
  return out;
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
 *  parent like anything else.
 *
 *  DELIBERATELY ABSENT: `state.syncIgnore[].removedEpic`. That id is HISTORICAL — it names the
 *  epic whose removal wrote the tombstone, so it dangles from the moment it is written and
 *  always will. Sweeping it would strip the provenance the entry exists to carry, and reporting
 *  it would make every tombstone a permanent finding. See ignoreArtifact() in
 *  source-artifacts.mjs. */
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
