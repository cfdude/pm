// scripts/lib/links.mjs
// Epic-link validation/normalization, detour-context detection, and THE declaration of every
// place the record holds an epic id. Pure functions; the ONE import is constants.mjs, the
// designated root every module may read from — the flat KNOWN_LINK_TYPES lives there so
// `rg 'KNOWN_[A-Z_]+ =' constants.mjs` answers the question gh#100 was filed after asking.

import { KNOWN_LINK_TYPES } from "./constants.mjs";

/** THE link-type vocabulary, in three honest bands — gh#100.
 *
 *  `--link` validated the epic half and not the type half, so a typo (`depends_on`,
 *  `realtes-to`) was stored silently and every consumer that switches on the type ignored it
 *  forever. Worse, it TAUGHT: `--help` published the syntax and no vocabulary, so the next
 *  agent inferred the vocabulary from the inert precedent already in `state.json`.
 *
 *  The bands are separate because "known" and "does something" are different claims, and
 *  collapsing them is the same lie in a new place. Verified mechanically (`rg '\.type ===' `,
 *  `rg 'type: "'`) rather than typed from memory, and conductor-29's drift guard re-derives it
 *  from the source on every run, in both directions — a consumer switching on a type the set
 *  does not carry fails, and a declaration whose consumer was deleted fails too. See
 *  docs/lessons/bind-rules-to-functions-not-enumerations.md.
 *
 *  Lines carrying `pm:link-vocabulary` DECLARE the vocabulary; they do not consume it, and the
 *  drift guard's extractor skips them so a declaration cannot satisfy its own orphan check. */
export const LINK_TYPES_READ = [
  // pm:link-vocabulary
  { type: "depends-on", readBy: ["dependency-order.mjs", "epic-progress.mjs", "add-epic.mjs"],
    drives: "queue ordering — a blocker is listed before the epic waiting on it" },
  // pm:link-vocabulary
  { type: "supersedes", readBy: ["links.mjs"],
    drives: "triage's superseded marker and the superseded-epic-never-ended check" },
];

/** Written by the engine as protocol state, and read back BY EPIC ID rather than by type:
 *  `record-reconcile` creates the link to hang a verdict on and finds it with
 *  `l.epic === detourId`. So it is known and it is meaningful to a reader, but nothing
 *  switches on it — filing it under "semantic" would be exactly the overclaim gh#100 is about. */
export const LINK_TYPES_WRITTEN = [
  // pm:link-vocabulary
  { type: "may-invalidate", writtenBy: ["reconciler-writeback.mjs", "detour-stack.mjs"],
    drives: "nothing switches on it — it carries a reconcile verdict for a human and for `/pm:resume`" },
];

/** Accepted, inert, and DOCUMENTED as inert. `blocks` and `relates-to` are the two the shipped
 *  command docs teach; `resolves-blocker-for` is written by the detour protocol — since #151 by
 *  the `push-detour` verb itself (detour-stack.mjs), not by hand — onto the DETOUR, naming the
 *  parent it unblocks. It stays in the ANNOTATION band even so: the band is about whether
 *  anything switches on the type, and nothing does.
 *
 *  `resolves-blocker-for` is deliberately NOT an alias for `depends-on`, which gh#100 asks about:
 *  the direction is opposite. The link lives on the detour and names the parent, so recording it
 *  as `depends-on` would say the detour depends on the epic it is unblocking — an inverted edge
 *  that `orderQueueWithDependencies` would act on. Rewriting stored types is unavailable for the
 *  same reason: it would silently change meaning, not repair a typo. */
export const LINK_TYPES_ANNOTATION = ["relates-to", "blocks", "resolves-blocker-for"];

/** Re-exported so a consumer needing the vocabulary AND the bands has one import, and so the
 *  band declarations above and the flat set stay one concept with one name. The array itself is
 *  declared in constants.mjs; conductor-29 asserts the bands' union equals it. */
export { KNOWN_LINK_TYPES };

export function isKnownLinkType(t) {
  return typeof t === "string" && KNOWN_LINK_TYPES.includes(t);
}

/** The vocabulary as one `|`-joined string, for a usage line. Derived, never typed: a usage
 *  string that listed the types by hand is a second enumeration and would drift from the first. */
export function linkTypeVocabulary() {
  return KNOWN_LINK_TYPES.join("|");
}

/** The refusal an unknown type earns. It names the whole set WITH its bands (the issue's
 *  ranked list puts the write-time error first — it is the only surface an agent cannot skip),
 *  and it names the way out: `--link` REPLACES an epic's links wholesale, so the common way to
 *  meet this error is re-passing a legacy link somebody else wrote, not typing a new one. */
export function unknownLinkTypeMessage(raw, type) {
  return `bad --link '${raw}': '${type}' is not a known link type.\n` +
    `  reads (these change behaviour): ${LINK_TYPES_READ.map(t => `${t.type} — ${t.drives}`).join("; ")}\n` +
    `  protocol state: ${LINK_TYPES_WRITTEN.map(t => t.type).join(", ")}\n` +
    `  annotation only: ${LINK_TYPES_ANNOTATION.join(", ")}\n` +
    "  `--link` replaces an epic's links wholesale, so if this came from a link already in the " +
    "record, pass the corrected type (or `--clear-links`) rather than re-passing the old one.";
}

/** A link is renderable only when both endpoints are strings. Guards against
 *  malformed/partial entries (incl. older schemas) that would render `undefined`.
 *
 *  DELIBERATELY not a vocabulary check, and renamed from `validLink` so it stops reading as one
 *  (gh#100 item 4). Every READ path — this, `normalizeLink`, render, the brief, integrity —
 *  must keep accepting an unknown type: records written before the vocabulary existed hold
 *  them, and a read path that rejected one would make an existing state file unloadable to
 *  punish a typo made months ago. Validation belongs on the WRITE path only; the stored ones
 *  are REPORTED by integrity's link-of-unknown-type check. */
export function isRenderableLink(l) {
  return l && typeof l.type === "string" && typeof l.epic === "string";
}

/** Normalize one stored link for the 0.5.0 migration. Repair-first:
 *  a valid {type, epic} object passes through; the documented colon-string
 *  encoding `type:epic[:reason]` (what add-epic's --link parser produces) is
 *  repaired into an object; anything else is unrecoverable → null (dropped).
 *
 *  DELIBERATELY does not validate the type either: this runs over data ALREADY ON DISK during
 *  a migration, where rejecting an unknown type would drop the edge — losing the record rather
 *  than reporting it, which is the opposite of what gh#100 asks for. */
export function normalizeLink(l) {
  if (isRenderableLink(l)) return l;
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
      // The SUPERSEDED record a correction keeps (#130) holds an epic id too, and a historical
      // record is not exempt from the sweep: a superseded disposition rendering a pointer to an
      // epic that no longer exists is exactly the dangling reference this enumeration exists to
      // catch. One level deep by construction — a correction never nests further.
      const prior = e.disposition.superseded;
      if (prior && typeof prior === "object") {
        add(e.id, `epic \`${e.id}\` disposition.superseded.carriedTo`, prior.carriedTo,
          () => { delete prior.carriedTo; });
      }
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

/** How often has THIS epic been deferred, and how long has the current pause run — gh#94.
 *
 *  gh#94 asks the conductor to "push back when a project keeps getting deferred". It gets the
 *  counting half and not the pushing half, and that is a judgment, not a shortcut:
 *
 *  1. A detour is not a failure. The design is built around interruption being normal, so a
 *     conductor that nags on the second one is a conductor people learn to ignore — the exact
 *     failure #138 fixed for the freshness warning, and the reason the `gateGuard` opt-in was
 *     never turned on by anyone.
 *  2. No threshold is defensible on the evidence available. Audited on this repository's own
 *     record (dated snapshot, 2026-08-29): an EMPTY `detourStack`, zero `may-invalidate` links,
 *     and a `detours.log` whose lines are overwhelmingly AUTO-DETOUR commit attributions rather
 *     than deliberate deferrals. There is no distribution here to put a number on, and a
 *     threshold invented anyway would be a number the engine cannot support.
 *  3. #151 removed the third reason, and it is recorded here rather than deleted because it is
 *     the one that CHANGED. It read: "there is nowhere to put a gate even if one were justified
 *     — the substantial-detour PUSH is a HAND-EDIT of state.json, so the engine is not present
 *     at the moment the deferral is decided." `push-detour` (lib/detour-stack.mjs) is now that
 *     moment, and it calls deferralNote() itself. So a gate has become BUILDABLE; reasons 1 and
 *     2 are why one is still not built, and they are about evidence, not mechanism. Building it
 *     needs a defensible threshold, which needs a distribution this repository does not have.
 *
 *  So: information, never an imperative. "You have paused this three times" is a fact the
 *  operator can act on; "you should stop doing that" is a judgment the engine cannot support.
 *
 *  DERIVED, not stored — no `pausedCount` field, so nothing has to be incremented by a hand-edit
 *  that already forgets things. A deferral leaves two durable traces and this reads both: the
 *  `may-invalidate` link the PUSH protocol writes from the parent to the detour, and the live
 *  detour-stack frame. Counted as a SET of detour ids so a frame whose link was also written
 *  (the compliant case) counts once, not twice. `pausedAt` is the OLDEST live frame naming this
 *  epic: how long the deferral has run is the question, and a later frame understates it. */
export function deferralHistory(state, epicId) {
  const detours = new Set();
  let pausedAt = null;
  for (const e of (state && state.epics) || []) {
    if (!e || e.id !== epicId) continue;
    for (const l of Array.isArray(e.links) ? e.links : []) {
      if (l && l.type === "may-invalidate" && typeof l.epic === "string") detours.add(l.epic);
    }
  }
  for (const f of (state && state.detourStack) || []) {
    if (!f || f.pausedEpic !== epicId) continue;
    if (typeof f.spawnedDetour === "string" && f.spawnedDetour) detours.add(f.spawnedDetour);
    if (typeof f.pausedAt === "string" && (pausedAt === null || f.pausedAt < pausedAt)) pausedAt = f.pausedAt;
  }
  return { count: detours.size, detours: [...detours].sort(), pausedAt };
}

/** Whole days since an ISO timestamp, or null if it does not parse. Null rather than 0 so an
 *  unparseable `pausedAt` renders nothing instead of claiming the pause started today. */
export function daysSince(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((now - t) / 86400000));
}

/** `1st`/`2nd`/`3rd`/`11th`. English, because the count is read by a human in a briefing. */
export function ordinal(n) {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${{ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"}`;
}

/** The one phrasing of a repeat deferral, shared by the brief and by `honcho-memory push` so
 *  the two surfaces cannot come to describe the same situation differently. Returns null for a
 *  FIRST deferral: the first detour is the mechanism working, and saying anything about it is
 *  how a signal becomes noise. */
export function deferralNote(history) {
  if (!history || history.count < 2) return null;
  return `${ordinal(history.count)} deferral of this epic (detours recorded: ${history.detours.join(", ")})`;
}
