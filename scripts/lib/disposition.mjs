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
 *  asked, which is why only the engine ever writes it (see engineStamp). */
export const KNOWN_OUTCOMES = ["delivered", "killed", "superseded", "abandoned", "unknown"];

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
