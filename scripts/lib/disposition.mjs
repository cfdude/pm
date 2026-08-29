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

/** Validate a CORRECTION of an already-recorded agent disposition (#130). Returns an error
 *  STRING or null, on the same never-exits-never-writes contract as dispositionError().
 *
 *  WHAT MAKES A CORRECTION LEGITIMATE. The engine cannot gate on WHO: an agent record carries
 *  no identity by construction (`recordedBy` is never agent-writable, and absence is precisely
 *  what marks a record as an agent's), so "only the agent who recorded it may correct it" is
 *  unenforceable rather than strict. What it CAN require is that the correction be
 *  DELIBERATE — never reachable by re-running the ordinary verb, which still refuses —
 *  SELF-DESCRIBING — the flag's value is why the recorded record was wrong — and
 *  NON-DESTRUCTIVE — the prior record survives verbatim and renders, so a correction is
 *  distinguishable from an original by anyone reading afterwards. That is disclosure rather
 *  than authority, and it is the same trade `record-gate-review` already makes.
 *
 *  A correction has NOTHING to do when the record is engine-stamped: the ordinary path already
 *  replaces those, and accepting the flag there would file an ordinary record as a correction —
 *  a superseded entry saying a judgment was made where none was. Refused rather than ignored.
 *
 *  Deliberately NOT time-boxed, and deliberately not narrowed to "only a missing required
 *  field". A window makes truth a function of when somebody looked — a wrong `delivered`
 *  noticed next week is exactly as false as one noticed in the same minute — and the
 *  headline case (`delivered` typed where `superseded` was meant) is a whole wrong outcome,
 *  not an absent field. */
export function correctionError({ prior, reason } = {}) {
  if (!prior || isEngineStamped(prior)) {
    return "there is no agent-recorded disposition to correct — an engine stamp is replaced by " +
      "recording an outcome the ordinary way, and an epic with no disposition has nothing to " +
      "supersede";
  }
  if (!nonEmpty(reason)) {
    return "--correct-disposition requires a reason saying why the recorded disposition was wrong";
  }
  return null;
}

/** Build an AGENT-supplied disposition record — one carrying no `recordedBy`, so it is not
 *  replaceable by the replacement rule that lets an agent overwrite an engine stamp.
 *  Throws on an invalid record rather than returning a partial one: a caller that skipped
 *  dispositionError() must not be able to write a record the vocabulary forbids.
 *
 *  `corrects` — `{prior, reason}` — makes this record a CORRECTION of `prior`: the prior record
 *  is kept verbatim under `superseded` and the reason it was wrong is kept beside it. Only a
 *  caller that has passed correctionError() may supply it, and this builder re-validates.
 *
 *  ONE nested record, not a chain: the prior's own `superseded` is dropped rather than carried
 *  down, exactly as recordGateReview() caps its nest — an unbounded nest would make the
 *  record's depth a function of how many times it was re-recorded. The prior's own
 *  `correction` string IS kept, so a second correction still says what the first one fixed. */
export function agentDisposition({ outcome, reason, carriedTo, recordedAt, corrects } = {}) {
  const err = dispositionError({ outcome, reason });
  if (err) throw new Error(err);
  const record = { outcome, recordedAt: recordedAt || new Date().toISOString() };
  // An omitted reason is ABSENT, never an empty string — absent says "none was required",
  // an empty string says "one was supplied and it was blank".
  if (nonEmpty(reason)) record.reason = reason.trim();
  if (nonEmpty(carriedTo)) record.carriedTo = carriedTo;
  if (corrects) {
    const cerr = correctionError(corrects);
    if (cerr) throw new Error(cerr);
    record.correction = corrects.reason.trim();
    const kept = { ...corrects.prior };
    delete kept.superseded;
    record.superseded = kept;
  }
  return record;
}

/** The marking a corrected disposition carries wherever an outcome is shown, so PROJECT.md and
 *  the brief describe one the same way. If the only trace of a correction were nested JSON,
 *  "supersede" would be "overwrite" for every human reader — which is the half of the
 *  requirement a record shape alone cannot meet. */
export function correctionMarking(disposition) {
  const prior = disposition && disposition.superseded;
  return prior ? ` · corrected (was ${prior.outcome || "unknown"})` : "";
}

/** WHY a corrected disposition was corrected, rendered beside the reason it now carries. */
export function correctionNote(disposition) {
  const why = disposition && disposition.correction;
  return nonEmpty(why) ? ` — corrected: ${why}` : "";
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

/** The epic-level REGISTRATION provenance: which engine path created this epic RECORD.
 *
 *  Distinct from `disposition.recordedBy`, which says who recorded how the work ENDED, and the
 *  distinction is the whole of #133. Backfill-ness was read off the disposition — a record the
 *  interactive verb REPLACES WHOLESALE with an agent's own, carrying no `recordedBy` by design —
 *  so an agent recording an honest outcome on a backfilled epic silently erased the fact that
 *  the epic had been reconstructed from disk, and its archived task counts reverted to `—`.
 *  Recording the truth destroyed the evidence.
 *
 *  Registration and disposition are two different lifecycles and now live on two different
 *  hosts, which is exactly why `recordedBy` was put on two host objects in the first place.
 *  Nothing writes this but a creation path, no CLI flag reaches it, and no disposition write
 *  touches it. Today `backfillArchive()` is its only writer; a second writer means stating what
 *  its token exempts, the same closed-set discipline ENGINE_STAMP_TOKENS carries. */
export const ARCHIVE_BACKFILL = "archive-backfill";

/** Was this epic reconstructed from `openspec/changes/archive/` rather than managed?
 *
 *  Named rather than left as a field read at each site because it is asked from three very
 *  different places — progress resolution, the creation sink's attribution seeding and the
 *  integrity checks' scope rule — and the QUESTION, not the token, is what those share. A
 *  backfilled epic has no gate verdict, no start time, and — where the change was abandoned —
 *  no ticked tasks; those are properties of a record rebuilt from disk, not of a badly managed
 *  epic.
 *
 *  Reads the EPIC's `registeredBy` and NOT the disposition stamp. Repos written before 0.32.0
 *  carry the provenance only on the disposition; the 0.32.0 migration LIFTS it onto the epic
 *  rather than this reader consulting both — two fields answering one question is the second
 *  definition the suite's source scan exists to prevent. */
export function isArchiveBackfilled(epic) {
  return !!epic && epic.registeredBy === ARCHIVE_BACKFILL;
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

// ───────────────────────── the STORY-level terminal disposition (#95) ─────────────────────────
//
// A story is `{title, done}`. A boolean holds two states and the record needs three: open,
// completed, and DELIBERATELY NOT BEING DONE. Deletion is not the third state — removing the row
// destroys the evidence that the work was ever projected, which is precisely the history an
// archived epic's reader needs. So the row always survives and only its terminal state differs.
//
// SEPARATE from the epic-level disposition above and deliberately not folded into it: that one
// says how an EPIC ended and carries an `outcome` from KNOWN_OUTCOMES; this one says what
// happened to ONE MILESTONE inside an epic that may still be running. Giving them one shape
// would put `delivered|killed|superseded|abandoned|declined` on a checklist row, where four of
// the five are meaningless.
//
// A REASON IS MANDATORY, with no `delivered`-style exemption, because there is no disposition
// here that means "this shipped" — `--done` already says that. Every value this field can hold
// is a decision not to do the work, and a terminal state with no recorded why reproduces the
// original problem one level down.

/** The story-level terminal states. One value today; a closed list rather than a free string so
 *  a second one cannot arrive without a rule saying what it exempts — the same discipline
 *  ENGINE_STAMP_TOKENS carries. `moved` was considered and deliberately left out: the audited
 *  record holds zero story-level moves, the epic-level `--carried-to` handoff already names a
 *  receiving epic, and a story-level receiver id would be a new cross-record pointer with its
 *  own deletion path to sweep. */
export const KNOWN_STORY_DISPOSITIONS = ["wont-do"];

/** Validate a proposed story disposition. Returns an error STRING or null; never exits, never
 *  writes — same contract as dispositionError() above, so a CLI verb and any later gate enforce
 *  one rule rather than two. */
export function storyDispositionError({ state, reason } = {}) {
  if (!KNOWN_STORY_DISPOSITIONS.includes(state)) {
    return `story disposition '${state}' is not one of ${KNOWN_STORY_DISPOSITIONS.join("|")}`;
  }
  if (!nonEmpty(reason)) return `--${state} requires a reason — a terminal state with no recorded why is the silence this records`;
  return null;
}

/** Build the record written onto `stories[n-1].disposition`. Timestamped here so every writer
 *  stamps identically. */
export function storyDisposition({ state, reason, recordedAt } = {}) {
  return { state, reason: reason.trim(), recordedAt: recordedAt || new Date().toISOString() };
}

/** Is this story terminally disposed? The ONE predicate every counter and guard reads, so
 *  "disposed" cannot come to mean two things in two files. A story with no `disposition` key —
 *  which is every story written before this capability existed — is not disposed, so a legacy
 *  record keeps meaning exactly what it meant and no migration is required. */
export function isStoryDisposed(story) {
  return !!(story && story.disposition && KNOWN_STORY_DISPOSITIONS.includes(story.disposition.state));
}
