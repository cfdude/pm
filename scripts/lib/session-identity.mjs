// scripts/lib/session-identity.mjs
// WHO is acting — resolved in ONE place, for the whole field family.
//
// #84 (`epic.claim.session` — who OWNS this epic right now) and #111 (an activity event's
// `session` — who DID this) are the same question asked at two moments, and the maintainer's
// design work links them deliberately: "who is doing this" and "who did this" must agree about
// what a session IS, or an audit joins two vocabularies and silently matches nothing.
//
// So the resolver ships once, here, with no consumer-specific behaviour. `epic.notes[].actor`
// is the third member of the family and is deliberately NOT changed by this module: it records
// a ROLE (`agent`/`engine`), not an identity, and conflating the two would make the existing
// notes trail unreadable.
//
// PRECEDENCE, and it is this way round on purpose: an explicit `--session` on the command line
// beats the ambient environment, because the environment is inherited by every subprocess and
// an orchestrator dispatching into a child repo needs to be able to say who it is acting AS
// without exporting a variable the child then inherits in turn.
//
// Leaf module: imports nothing from lib/. Nothing here reads or writes state.

/** The session identity for this invocation, or null when nobody said.
 *
 *  `flags` is parseFlags() output. A repeatable-flag array is not expected here (`--session` is
 *  not declared repeatable) but is handled anyway: parseFlags' repeatable set is a global union
 *  across subcommands, so a future row could make it one without this file being touched. */
export function resolveSession(flags = {}) {
  const raw = flags.session;
  const fromFlag = Array.isArray(raw) ? raw[raw.length - 1] : raw;
  if (typeof fromFlag === "string" && fromFlag.trim()) return fromFlag.trim();
  const fromEnv = process.env.PM_SESSION;
  if (typeof fromEnv === "string" && fromEnv.trim()) return fromEnv.trim();
  return null;
}

/** How a caller is told to supply one. Kept beside the resolver so the two cannot disagree
 *  about which mechanisms exist — the precedence above is the same list, in the same order. */
export const SESSION_HINT =
  "name the session with --session <name>, or export PM_SESSION";
