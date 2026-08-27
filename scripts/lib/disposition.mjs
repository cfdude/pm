// scripts/lib/disposition.mjs
// The terminal-disposition record: its shape, its vocabulary, and the two ways it is written.
// May import constants.mjs and nothing else — as of this change it needs nothing at all — and
// nothing under it imports back up, per the one-directional discipline constants.mjs documents.
//
// One record shape carries FOUR scopes rather than four parallel shapes: an epic that ended, a
// declined deferral, a release exclusion, and a handoff (`carriedTo`, naming the receiving
// epic, with the reason saying which tasks moved).
//
//   { outcome, reason?, recordedAt, recordedBy?, carriedTo? }
//
// `outcome` is NOT a flat field on the epic and it never becomes a `status` value —
// KNOWN_STATUSES is untouched and every status-driven behavior in the engine is unchanged. A
// scenario phrased "the epic carries outcome: unknown" is a claim about the READER
// (outcomeOf), not about a flat field.

/** The terminal outcomes. `unknown` is never an agent's answer — it records that nobody was
 *  asked, which is why only the engine ever writes it (see engineStamp).
 *
 *  `declined` is the INTAKE end (gh-112): an ask that was considered and not taken on. It is an
 *  outcome and deliberately not a status, because nothing about it needs a new status-driven
 *  behavior — a declined ask is terminal, `archived` already says terminal, and every rule that
 *  reads a status stays exactly as it was. What it needs is a RECORD, and this vocabulary is
 *  where the record lives. Without it, declining means never registering the ask at all, which
 *  destroys the evidence that anyone considered it — the same objection that made every other
 *  ending recordable. "Declined" is already this codebase's word for that judgment: a deferral
 *  assertion's `declined[]` entries carry `{what, reason}` for exactly the same reason.
 *
 *  It inherits the required-reason rule below with no exemption of its own (a decline with no
 *  reason is indistinguishable from an ask nobody looked at), and it is NOT `delivered`, so the
 *  Gate 2 demand and the handoff demand in archive-gate.mjs both pass it by — correctly: no code
 *  was written, so there is no implementation to review and no outstanding work to hand over. */
export const KNOWN_OUTCOMES = ["delivered", "killed", "superseded", "abandoned", "declined", "unknown"];

/** The fixed literal path tokens `recordedBy` may hold. A disposition is ENGINE-STAMPED when
 *  it carries one of these and AGENT-SUPPLIED when it carries no `recordedBy` at all; nothing
 *  else distinguishes them, which is the whole reason the field is data and not prose.
 *
 *  The set is closed on purpose. Every exemption in this release keys on one of these values —
 *  the integrity checks' scope rule, the archive gate's exemptions, and the replacement rule
 *  that lets an agent correct a record the engine wrote. A sixth path added without a rule to
 *  go with it is a silent hole, so adding a token here means stating what it exempts. */
export const ENGINE_STAMP_TOKENS = [
  "archive-drift-heal", "archive-backfill", "add-epic", "add-many", "migration",
];

const nonEmpty = (s) => typeof s === "string" && s.trim() !== "";

/** Validate an AGENT-supplied disposition. Returns an error STRING naming what is wrong, or
 *  null. Never exits and never writes — the caller owns its own refusal message and its own
 *  write, so the same rule can be enforced from a CLI verb and from a gate alike.
 *
 *  Every outcome except `delivered` MUST carry a non-empty reason. `delivered` means "this
 *  shipped as intended" and needs no explanation; every other outcome IS the explanation's
 *  subject, and a disposition recorded without one is the silence this capability removes. */
export function dispositionError({ outcome, reason } = {}) {
  if (!KNOWN_OUTCOMES.includes(outcome)) {
    return `outcome '${outcome}' is not one of ${KNOWN_OUTCOMES.join("|")}`;
  }
  if (outcome !== "delivered" && !nonEmpty(reason)) {
    return `outcome '${outcome}' requires a non-empty reason (only 'delivered' may omit one)`;
  }
  return null;
}

/** Build an AGENT-supplied disposition record — one carrying no `recordedBy`, so it is not
 *  replaceable by the replacement rule that lets an agent overwrite an engine stamp.
 *  Throws on an invalid record rather than returning a partial one: a caller that skipped
 *  dispositionError() must not be able to write a record the vocabulary forbids. */
export function agentDisposition({ outcome, reason, carriedTo, recordedAt } = {}) {
  const err = dispositionError({ outcome, reason });
  if (err) throw new Error(err);
  const record = { outcome, recordedAt: recordedAt || new Date().toISOString() };
  // An omitted reason is ABSENT, never an empty string — absent says "none was required",
  // an empty string says "one was supplied and it was blank".
  if (nonEmpty(reason)) record.reason = reason.trim();
  if (nonEmpty(carriedTo)) record.carriedTo = carriedTo;
  return record;
}

/** Build an ENGINE stamp — the record a path writes when no disposition was supplied at the
 *  transition. No reason is demanded: the token IS the record of how the epic got there, and
 *  demanding prose from a path with nobody to ask would be a fabrication. `outcome` and
 *  `recordedAt` are parameters because the migration stamps `delivered` where a passing Gate 2
 *  exists and prefers the epic's existing `completedAt` over the migration clock. */
export function engineStamp(recordedBy, { outcome = "unknown", reason, recordedAt } = {}) {
  if (!ENGINE_STAMP_TOKENS.includes(recordedBy)) {
    throw new Error(`recordedBy '${recordedBy}' is not one of ${ENGINE_STAMP_TOKENS.join("|")}`);
  }
  if (!KNOWN_OUTCOMES.includes(outcome)) {
    throw new Error(`outcome '${outcome}' is not one of ${KNOWN_OUTCOMES.join("|")}`);
  }
  const record = { outcome, recordedAt: recordedAt || new Date().toISOString(), recordedBy };
  if (nonEmpty(reason)) record.reason = reason.trim();
  return record;
}

/** THE reader. Every consumer and every test asks for an epic's outcome here — never
 *  `epic.outcome`, which is not a field this design ships. An epic with no disposition reads
 *  `unknown`, which is exactly true of it: nobody recorded one. Because the reader is a single
 *  lookup, the outcome invariant ("no write that leaves an epic archived may leave it without
 *  an outcome") stays checkable wherever an archived epic is read. */
export function outcomeOf(epic) {
  const d = epic && epic.disposition;
  return d && KNOWN_OUTCOMES.includes(d.outcome) ? d.outcome : "unknown";
}

/** THE discriminator. A disposition is engine-stamped iff `recordedBy` holds one of the fixed
 *  five tokens; anything else — including a token some later path invented without registering
 *  it — is not. This is the only way any consumer tells an engine stamp from an agent's
 *  record, which is what lets an agent's disposition REPLACE a stamp nobody chose while being
 *  refused against another agent's judgment. */
export function isEngineStamped(disposition) {
  return !!disposition && ENGINE_STAMP_TOKENS.includes(disposition.recordedBy);
}

/** WHICH engine path wrote this epic's disposition — asked here, never by reading the field.
 *
 *  Every exemption and every remediation in this release keys on the path: the integrity checks'
 *  scope rule on `archive-backfill`, the heal-mismatch check on `archive-drift-heal`, the
 *  migration's own stamp on `migration`. A caller naming the token it cares about is fine; a
 *  caller reaching for `.recordedBy` is how a second definition of "engine-stamped" starts, and
 *  the suite's source scan fails one. */
export function stampedBy(epic, recordedBy) {
  const d = epic && epic.disposition;
  return !!d && d.recordedBy === recordedBy;
}

/** Was this epic reconstructed from `openspec/changes/archive/` rather than managed?
 *
 *  Named rather than left as a `stampedBy(e, "archive-backfill")` at each site because it is
 *  asked from two very different places — progress resolution and the checks' scope rule — and
 *  the QUESTION, not the token, is what those two share. A backfilled epic has no gate verdict,
 *  no start time, and — where the change was abandoned — no ticked tasks; those are properties
 *  of a record rebuilt from disk, not of a badly managed epic. */
export function isArchiveBackfilled(epic) {
  return stampedBy(epic, "archive-backfill");
}

/** The dispositions worth SHOWING, in epic-list order: every record carrying a judgment —
 *  a real outcome, or a reason, or a handoff. An `unknown` stamp with no reason is excluded
 *  because it adds nothing the status already carries, and after the 0.27.0 migration 66 of
 *  this repository's 69 archived epics hold exactly that: a per-epic row saying "nobody
 *  recorded a disposition" is how a reader is trained to skip the whole section. The outcome
 *  still renders beside the status for every epic that has one.
 *
 *  Shared by PROJECT.md and the brief so the two can never disagree about what is shown. */
export function recordedDispositions(epics) {
  return (epics || [])
    .filter(e => e && e.disposition &&
      (outcomeOf(e) !== "unknown" || e.disposition.reason || e.disposition.carriedTo))
    .map(e => ({ epic: e, disposition: e.disposition }));
}

/** Build the DEFERRAL ASSERTION a change records before it may be archived.
 *
 *  The engine cannot know what a change's deferrals are, and MUST NOT claim to: matching on
 *  artifact prose is the same fragility PLAN_INDEX_FILES already works around, and a scanner
 *  that missed a deferral would make the guard less trustworthy than no guard. What it can
 *  require is an ASSERTION — including the assertion that there are none — which is why this
 *  builder takes what the agent says and reads nothing.
 *
 *  `deferrals` carry provenance: the epic now holding the work and the artifact section that
 *  named it. `declined` carry the judgment that it is not worth doing, with its reason, so a
 *  decline is a recorded call rather than an absence indistinguishable from never looking. */
export function deferralAssertion({ deferrals = [], declined = [], assertedAt } = {}) {
  return {
    assertedAt: assertedAt || new Date().toISOString(),
    deferrals: deferrals.map(d => ({ epic: d.epic, section: d.section })),
    declined: declined.map(d => ({ what: d.what, reason: d.reason })),
  };
}

/** Validate a RELEASE EXCLUSION — the fourth scope of the one record. Returns an error STRING
 *  naming what is wrong, or null; never exits and never writes, exactly as dispositionError()
 *  does, so the same rule is enforceable from a CLI verb and from a gate alike.
 *
 *  Same required-reason rule, applied without an `outcome`: an exclusion is a scoping call about
 *  ONE release and never an ending, so there is no terminal outcome to name — the excluded epic
 *  stays in the backlog. That is not a parallel shape; it is how the record already works for
 *  the declined-deferral scope, whose entries carry `{what, reason}` and no outcome either.
 *
 *  The reason is what distinguishes an exclusion from an epic nobody considered. Without it the
 *  two are indistinguishable in the record, which is the silence this capability removes — so it
 *  is required here for every exclusion, with no `delivered`-shaped exemption to hide behind. */
export function releaseDeferralError({ epic, reason } = {}) {
  if (!nonEmpty(epic)) return "a release deferral must name the epic it excludes";
  if (!nonEmpty(reason)) {
    return "a release deferral requires a non-empty reason (--reason \"<why it was cut>\") — " +
      "an exclusion with no reason is indistinguishable from an epic nobody considered";
  }
  return null;
}

/** Build a RELEASE EXCLUSION record: `{epic, reason, recordedAt}`, recorded against the
 *  epic/release pair and stored in `state.releases[].deferred[]`. Throws on an invalid record
 *  rather than returning a partial one — a caller that skipped releaseDeferralError() must not
 *  be able to write an exclusion the rule forbids. */
export function releaseDeferral({ epic, reason, recordedAt } = {}) {
  const err = releaseDeferralError({ epic, reason });
  if (err) throw new Error(err);
  return { epic: epic.trim(), reason: reason.trim(), recordedAt: recordedAt || new Date().toISOString() };
}

/** The stamp a CREATION path writes for an epic created directly at `archived`.
 *
 *  `via` exists for one case and is not a general override: where the archive backfill
 *  registers a historical change THROUGH a creation path, the record must carry
 *  `archive-backfill` and not the inner creation token — every rule elsewhere in this release
 *  that exempts historical registrations keys on that token, and a record carrying the inner
 *  one would defeat those exemptions. One record carries one token; there is no shape that
 *  carries two. No CLI flag reaches this: `recordedBy` is never agent-writable. */
export function creationStamp(command, { via } = {}) {
  return engineStamp(via || command);
}
