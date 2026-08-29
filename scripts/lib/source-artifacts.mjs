// scripts/lib/source-artifacts.mjs
// THE declaration of every field an epic holds that points at an on-disk SOURCE ARTIFACT —
// the document the epic's work is drawn from — plus the sync-ignore tombstone list that
// records artifacts deliberately NOT registered. Pure functions, no imports: every other lib
// module may depend on this one and it depends on none of them (state.mjs does, so a cycle
// here would break epic creation itself).
//
// WHY A TABLE AND NOT A FIELD. `planPath` was the only such field, read in exactly one place,
// and `sync` deduped plan files on the plan's FILENAME rather than on this association — so an
// epic whose plan is named differently from its id (the normal case: plan filenames carry a
// date prefix and epic ids do not) was re-registered as a fresh untriaged epic on every sync,
// forever (#64, #69). Declaring the family once means the next artifact field — `specPath`, the
// same missing association one artifact over (#92) — inherits the claim check, the tombstone
// clearing and the removal sweep by ADDING ONE ROW here plus its `EPIC_FLAGS` entry in
// constants.mjs. It does not get to be a second shape with its own half-covered call sites,
// which is the defect this file exists to make structurally impossible.
//
// See docs/lessons/bind-rules-to-functions-not-enumerations — same reasoning as
// epicReferences() in links.mjs, which declares every place the record holds an epic ID. This
// one declares every place it holds an artifact PATH.

/** Every epic field naming an on-disk source artifact.
 *
 *  `key`   the state key on the epic (matches EPIC_FLAGS' `key`, deliberately duplicated as a
 *          value rather than imported: constants.mjs already imports enough of the tree that a
 *          dependency from here would risk the cycle noted above, and the two are joined by a
 *          parity assertion in the suite instead).
 *  `flag`  the CLI flag that writes it, quoted verbatim in the instruction sync emits.
 *  `label` how it is named to a human in a skip message.
 */
export const EPIC_SOURCE_ARTIFACTS = [
  { key: "planPath", flag: "plan", label: "plan" },
  // #92 (epic↔spec association). The row above is ONE-TO-ONE in practice — a plan produces an
  // epic — and this one is deliberately MANY-TO-ONE: a design document too large for a single
  // implementation plan enumerates N chunks, every one of which names this same path. That is
  // the whole missing concept #92 reports, and it is why `artifactClaimants()` exists below
  // beside the first-claimant-wins map: "which epic claims this?" and "how many epics cover
  // this?" are different questions and only the second one is #93's.
  { key: "specPath", flag: "spec", label: "spec" },
];

/** One artifact path, in the single form every comparison uses: repo-relative, forward slashes,
 *  no leading `./`, no trailing slash. Two spellings of the same file must never read as two
 *  different artifacts — that is the whole failure this module prevents, one level down. */
export function normalizeArtifactPath(p) {
  if (typeof p !== "string") return null;
  const s = p.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  return s || null;
}

/** Every source-artifact path any epic claims → the epic that claims it.
 *
 *  Status-blind and lane-blind BY CONSTRUCTION, and both are load-bearing. An archived epic
 *  still holds its `planPath`, which is precisely the done-signal #69 asks for without
 *  inferring completion from checkbox counts or another tool's private progress ledger; and
 *  two of this repository's four live dual-lane pairs hold `decision` on the un-prefixed side,
 *  so a claim check that only believed the `superpowers` lane would miss half of them.
 *
 *  First claimant wins where two epics name the same artifact: naming one is all a skip message
 *  needs, and adjudicating a genuine double-claim is a judgment no engine should invent.
 */
export function claimedSourceArtifacts(state) {
  const out = new Map();
  for (const [p, claims] of artifactClaimants(state)) out.set(p, claims[0]);
  return out;
}

/** Every source-artifact path any epic claims → EVERY epic that claims it, in registration order.
 *
 *  The COUNTING enumerator, and the reason it is a second function rather than a widening of
 *  claimedSourceArtifacts(): that map answers "name an epic that claims this", which is all a
 *  sync skip message needs, and it discards every claimant after the first. `specPath` is
 *  many-to-one by construction (#92: one design document, six implementation chunks), so
 *  "how many epics cover this document?" — #93's entire question — is unanswerable from a
 *  first-wins map. Deriving the first-wins map FROM this one is what keeps the two from
 *  drifting: there is one walk of the family table, not two.
 *
 *  Status-blind and lane-blind for the same reasons documented on claimedSourceArtifacts():
 *  an archived epic for chunk 1 IS coverage of chunk 1, and a coverage report that only
 *  believed live epics would call a finished design uncovered. */
export function artifactClaimants(state) {
  const out = new Map();
  for (const e of (state && state.epics) || []) {
    if (!e || typeof e !== "object") continue;
    for (const { path: p, key, label } of epicSourceArtifacts(e)) {
      if (!out.has(p)) out.set(p, []);
      out.get(p).push({ epic: e.id, key, label });
    }
  }
  return out;
}

/** The tombstone list: artifacts `sync` must not register, as normalized paths.
 *
 *  Absent means empty. This is a READ-SIDE default, not a transformation — a state file written
 *  by any earlier version loads unchanged and needs no migration entry. */
export function syncIgnoredArtifacts(state) {
  const out = new Set();
  for (const i of (state && state.syncIgnore) || []) {
    const p = normalizeArtifactPath(i && typeof i === "object" ? i.path : i);
    if (p) out.add(p);
  }
  return out;
}

/** Record that an artifact must not be registered, with WHY and by whose removal.
 *
 *  Idempotent on path. Returns true when it actually added an entry.
 *
 *  Why a tombstone at all: `remove-epic` was durable only until the next `sync`, which
 *  re-registered byte-identical ids within the hour. The alternative considered and rejected
 *  was leaving an `archived` epic behind, which works today only because the dedup keys on id
 *  EXISTENCE rather than status — but `remove-epic` exists for an epic registered in error,
 *  where there is no work and so no disposition to record, and a tombstone epic would be a
 *  disposition-shaped record of nothing.
 *
 *  `removedEpic` is deliberately NOT registered in epicReferences() (links.mjs), which declares
 *  every place the record holds a LIVE epic id for the removal sweep and the
 *  `dangling-epic-reference` check to read. This one is HISTORICAL by construction — it names
 *  the epic whose removal created the tombstone, so it dangles the instant it is written and
 *  always will. Registering it would make every tombstone a permanent finding and have the
 *  sweep strip the provenance that is the entry's whole point. The name says which kind it is;
 *  nothing renders it or resolves it. */
export function ignoreArtifact(state, p, { epic, reason } = {}) {
  const norm = normalizeArtifactPath(p);
  if (!norm) return false;
  if (!Array.isArray(state.syncIgnore)) state.syncIgnore = [];
  if (state.syncIgnore.some(i => normalizeArtifactPath(i && typeof i === "object" ? i.path : i) === norm)) return false;
  const entry = { path: norm, at: new Date().toISOString() };
  if (epic) entry.removedEpic = epic;
  if (reason) entry.reason = reason;
  state.syncIgnore.push(entry);
  return true;
}

/** Drop any tombstone on this artifact. Returns true when one was there.
 *
 *  The un-ignore path is DERIVED from an action the operator already takes rather than being a
 *  new verb: attaching an artifact to an epic is the explicit statement that it is real work,
 *  which contradicts a tombstone saying it is not. Leaving both would let the record hold two
 *  opposite claims about one file. */
export function unignoreArtifact(state, p) {
  const norm = normalizeArtifactPath(p);
  if (!norm || !Array.isArray(state.syncIgnore)) return false;
  const before = state.syncIgnore.length;
  state.syncIgnore = state.syncIgnore.filter(
    i => normalizeArtifactPath(i && typeof i === "object" ? i.path : i) !== norm);
  return state.syncIgnore.length !== before;
}

/** Every source artifact this epic claims, normalized. The one enumeration both the creation
 *  sink and the removal sweep read, so a field added to the table above is handled by both or
 *  by neither — never by one of them. */
export function epicSourceArtifacts(epic) {
  const out = [];
  for (const { key, flag, label } of EPIC_SOURCE_ARTIFACTS) {
    const p = normalizeArtifactPath(epic && epic[key]);
    if (p) out.push({ path: p, key, flag, label });
  }
  return out;
}

/** Clear every tombstone contradicted by the artifacts this epic now claims. Called from the
 *  ONE creation sink (pushEpic) and from `update-epic`, the only two ways an epic comes to
 *  claim an artifact. Returns the paths cleared. */
export function claimArtifacts(state, epic) {
  const cleared = [];
  for (const { path: p } of epicSourceArtifacts(epic)) {
    if (unignoreArtifact(state, p)) cleared.push(p);
  }
  return cleared;
}

/** Tombstone every artifact these epics claim, because they are being removed. Takes the LIST,
 *  not one epic, so `remove-epic --cascade` cannot cover the named epic and leave its
 *  descendants' artifacts registerable — the absent-sibling-edit defect this repository audits
 *  itself for.
 *
 *  Returns `{path, flag}` per recorded artifact rather than a bare path, because the caller's
 *  message is an INSTRUCTION — "attach it to an epic to un-ignore it" — and an instruction has
 *  to name the flag that writes THAT field. It said `--plan` unconditionally while the family
 *  held one row; the second row made it wrong, and a caller that has to remember which field a
 *  path came from is the enumeration this module exists to remove. */
export function tombstoneArtifacts(state, epics, reason) {
  const recorded = [];
  for (const e of epics) {
    for (const { path: p, flag } of epicSourceArtifacts(e)) {
      if (ignoreArtifact(state, p, { epic: e.id, reason })) recorded.push({ path: p, flag });
    }
  }
  return recorded;
}
