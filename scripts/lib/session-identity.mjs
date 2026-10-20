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
import { currentEnv } from "./invocation.mjs";
import { escapeControls } from "./constants.mjs";

/** The session identity for this invocation, or null when nobody said.
 *
 *  `flags` is parseFlags() output. A repeatable-flag array is not expected here (`--session` is
 *  not declared repeatable) but is handled anyway: parseFlags' repeatable set is a global union
 *  across subcommands, so a future row could make it one without this file being touched. */
export function resolveSession(flags = {}) {
  const raw = flags.session;
  const fromFlag = Array.isArray(raw) ? raw[raw.length - 1] : raw;
  if (typeof fromFlag === "string" && fromFlag.trim()) return fromFlag.trim();
  const fromEnv = currentEnv().PM_SESSION;
  if (typeof fromEnv === "string" && fromEnv.trim()) return fromEnv.trim();
  return null;
}

/** The longest identity accepted. An identity is opaque: pm never derives one and never checks it against
 *  anything, so the only rules are the ones that keep it safe to store and print. */
export const SESSION_MAX_LENGTH = 128;

/** Validate ONE identity string. Non-blank after trimming, at most SESSION_MAX_LENGTH characters, no control
 *  character (C0, DEL or C1). Returns `{ ok: true, value }` (trimmed) or `{ ok: false, message }` naming the
 *  rule and WHERE the value came from. The message never repeats the offending value. */
export function checkSession(raw, origin = "--session") {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return { ok: false, message: escapeControls(origin) + " requires a session name — a blank one is refused" };
  if (/[\u0000-\u001f\u007f-\u009f]/.test(value)) {
    return { ok: false, message: escapeControls(origin) + " must not contain a control character — a session identity is a plain name" };
  }
  if ([...value].length > SESSION_MAX_LENGTH) {
    return { ok: false, message: escapeControls(origin) + " must be at most " + SESSION_MAX_LENGTH + " characters" };
  }
  return { ok: true, value };
}

/** The identity this invocation acts as, VALIDATED: `{ ok: true, session }` (null when nobody said) or
 *  `{ ok: false, message }`. Same precedence as resolveSession (an explicit flag beats PM_SESSION); a flag
 *  that is present but blank is a refusal rather than a silent fall-through to the environment, and a blank
 *  environment value is simply "nobody said". */
export function resolveSessionChecked(flags = {}) {
  const raw = flags.session;
  const fromFlag = Array.isArray(raw) ? raw[raw.length - 1] : raw;
  // A flag that is PRESENT is judged, string or not: a valueless `--session` parses as `true`, and falling
  // through to the environment would turn "I named a session and forgot to say which" into a silent
  // stamp of whatever PM_SESSION happens to hold.
  if (fromFlag !== undefined) {
    const c = checkSession(fromFlag, "--session");
    return c.ok ? { ok: true, session: c.value } : c;
  }
  const fromEnv = currentEnv().PM_SESSION;
  if (typeof fromEnv === "string" && fromEnv.trim()) {
    const c = checkSession(fromEnv, "PM_SESSION");
    return c.ok ? { ok: true, session: c.value } : c;
  }
  return { ok: true, session: null };
}

/** How a caller is told to supply one. Kept beside the resolver so the two cannot disagree
 *  about which mechanisms exist — the precedence above is the same list, in the same order. */
export const SESSION_HINT =
  "name the session with --session <name>, or export PM_SESSION";
