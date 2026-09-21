// scripts/lib/autonomy.mjs
// Per-epic autonomy read (getAutonomy) and the set-autonomy CLI verb. Circular with
// lib/render.mjs (setAutonomy calls render(); render() calls getAutonomy()) and needs
// lib/add-epic.mjs's parseFlags() -- see the design doc.

import { isInitialized, loadState, saveState } from "./state.mjs";
import { reportSave, STATE_UNCHANGED } from "./save-report.mjs";
import { parseFlags, requireFlagValues } from "./add-epic.mjs";
import { render } from "./render.mjs";
import { KNOWN_AUTONOMY_LEVELS, KNOWN_PREAUTHORIZE_CATEGORIES, escapeControls } from "./constants.mjs";
import { die } from "./command-exit.mjs";
import { currentArgv, errStream } from "./invocation.mjs";

// `autonomy` is optional per epic — absent means "off", today's behavior, unchanged.
// getAutonomy() is the ONLY place that should read epic.autonomy directly; everywhere
// else (render, brief, set-autonomy) calls this so a missing field never needs a
// migration to backfill — it defaults cleanly at read-time.
const DEFAULT_AUTONOMY = Object.freeze({ level: "off", preAuthorized: [], context: [], notifications: [] });
export function getAutonomy(epic) {
  const a = epic.autonomy;
  if (!a) return DEFAULT_AUTONOMY;
  return {
    level: a.level || "off",
    preAuthorized: Array.isArray(a.preAuthorized) ? a.preAuthorized : [],
    context: Array.isArray(a.context) ? a.context : [],
    notifications: Array.isArray(a.notifications) ? a.notifications : [],
  };
}

/** A grant taken back. Revocation RECORDS rather than deletes — the entry stays in
 *  `preAuthorized[]` carrying this stamp — on the precedent `linkOnce()`'s `superseded` and
 *  `--withdraw-gate-review` already set: a splice would make "this was authorised and then taken
 *  back" indistinguishable from "this was never authorised", which is the evidence a safety record
 *  exists to keep. */
export function isRevoked(grant) {
  return !!(grant && typeof grant === "object" && grant.revoked && typeof grant.revoked === "object");
}

/** What a grant NAMES — its identity, for matching and for the re-arm report below. `null` where it
 *  names nothing: a `{action: ""}` a release before this one stored, which no revoke can reach
 *  because a revoke names a STORED value and an empty one is not expressible as a flag value. */
export function grantLabel(grant) {
  if (!grant || typeof grant !== "object") return null;
  if (typeof grant.category === "string" && grant.category) return `category:${grant.category}`;
  if (typeof grant.action === "string" && grant.action) return grant.action;
  return null;
}

/** The grants that authorise something: named, and not revoked. ONE predicate, so the re-arm report
 *  and `integrity`'s grant check cannot come to disagree about which grants are live. */
export function liveGrants(autonomy) {
  return (autonomy && Array.isArray(autonomy.preAuthorized) ? autonomy.preAuthorized : [])
    .filter(g => !isRevoked(g) && grantLabel(g) !== null);
}

/** Read a `--revoke` value as the grant identity it names, through the IDENTICAL first-colon split
 *  the grant itself went through. A stored action therefore never contains a colon, which is what
 *  makes both spellings name the same grant: the bare stored action, and the whole original
 *  `--preauthorize` value pasted back. Whatever `--preauthorize` stored is exactly what
 *  `--revoke` names. */
function grantIdentity(value) {
  const s = String(value);
  if (s.startsWith("category:")) {
    const rest = s.slice("category:".length);
    const i = rest.indexOf(":");
    return { category: (i === -1 ? rest : rest.slice(0, i)).trim() };
  }
  const i = s.indexOf(":");
  return { action: (i === -1 ? s : s.slice(0, i)).trim() };
}

const namesGrant = (grant, target) => target.category !== undefined
  ? grant && grant.category === target.category
  : grant && grant.action === target.action;

/** `set-autonomy <id> [--level off|autonomous] [--preauthorize "<action>:<reason>"]
 *  [--preauthorize "category:<name>:<reason>"] [--context "<note>"] [--notify "<what>"]` —
 *  writes/merges an epic's `autonomy` block. Every flag is additive (repeated calls APPEND
 *  to preAuthorized/context/notifications, never clobber) except --level, which replaces.
 *  A `--preauthorize` value starting with "category:" is stored as a category-based grant
 *  (`{ category, reason, grantedAt }`, no `action` field) distinct from an exact-action grant
 *  (`{ action, reason, grantedAt }`, no `category` field) — see KNOWN_PREAUTHORIZE_CATEGORIES
 *  and the `conductor` skill's "Epic-level autonomy" section for the matching heuristic each
 *  category expands to at decision-rule time. Pure local state write — no external calls,
 *  consistent with the engine's instruction-layer law. */
export function setAutonomy() {
  if (!isInitialized()) { die("conductor: run /pm:init first\n"); }
  const argv = currentArgv().slice(3);
  const id = argv[0] && !argv[0].startsWith("--") ? argv[0] : undefined;
  if (!id) {
    die(
      "usage: conductor.mjs set-autonomy <id> [--level off|autonomous] " +
      "[--preauthorize \"<action>:<reason>\"] [--preauthorize \"category:<filesystem|network|schema|external-api>:<reason>\"] " +
      "[--revoke \"<action>\" --revoke-reason \"<why>\"] " +
      "[--context \"<note>\"] [--notify \"<what>\"]\n");
  }
  const f = parseFlags(argv.slice(1));
  requireFlagValues("set-autonomy", f);
  // A reason for a revocation nobody asked for is a value this verb would parse and DISCARD while
  // reporting success — every-verb-refuses-what-it-does-not-read. Before loadState(), the position
  // every other pre-write guard here takes.
  if (f["revoke-reason"] !== undefined && typeof f.revoke !== "string") {
    die(
      "conductor: --revoke-reason explains a revocation, and this invocation revokes nothing — " +
      "pass --revoke \"<action>\" (or \"category:<name>\") alongside it. Nothing was written.\n");
  }
  const state = loadState();
  const epic = state.epics.find(e => e.id === id);
  if (!epic) { die(`conductor: epic '${escapeControls(id)}' not found\n`); }

  const level = typeof f.level === "string" ? f.level : undefined;
  if (level !== undefined && !KNOWN_AUTONOMY_LEVELS.includes(level)) {
    die(`conductor: --level must be one of ${KNOWN_AUTONOMY_LEVELS.join("|")}\n`);
  }

  const a = { ...getAutonomy(epic) };
  if (level !== undefined) a.level = level;

  // THE REVOKE RUNS BEFORE THE GRANTS BELOW, so `--revoke X --preauthorize "X:<new reason>"` in one
  // call reads as "take it back, then grant it again on new terms" rather than revoking the grant
  // this same invocation just made. Re-granting IS the documented un-revoke, so the two flags
  // together have to compose in that direction.
  //
  // ONLY THE UNREVOKED MATCHES ARE MARKED, and an existing revocation stamp is never rewritten.
  // Because re-granting is the un-revoke, an epic can legitimately hold a revoked entry and a live
  // entry for the SAME action at once, so a match is a SET. Re-stamping the whole set would replace
  // an earlier reason and date that describe something that happened with a later pair describing a
  // different event — the data loss the already-revoked refusal exists to prevent, reached through
  // the mixed case.
  if (typeof f.revoke === "string") {
    const target = grantIdentity(f.revoke);
    const revokeReason = typeof f["revoke-reason"] === "string" ? f["revoke-reason"].trim() : "";
    // THE THREE REFUSALS, all of them BEFORE the map below, so a refused revoke leaves
    // `.conductor/state.json` byte-identical: nothing is saved and `epic.autonomy` is never
    // assigned. A revoke that recorded nothing true is the shape each of them removes.
    if (!revokeReason) {
      die(
        "conductor: --revoke requires --revoke-reason \"<why>\" — the revocation is kept on the " +
        "record beside the grant it takes back, and a reason is what distinguishes a deliberate " +
        "withdrawal from a grant nobody can account for\n");
    }
    const matches = a.preAuthorized.filter(g => namesGrant(g, target));
    if (!matches.length) {
      die(
        `conductor: '${escapeControls(id)}' holds no pre-authorization naming ` +
        `'${escapeControls(target.category !== undefined ? `category:${target.category}` : target.action)}' — ` +
        "a revoke that silently matched nothing would report success for an authorisation that is " +
        "still live. Nothing was written.\n");
    }
    if (matches.every(isRevoked)) {
      die(
        `conductor: every grant '${escapeControls(id)}' holds for ` +
        `'${escapeControls(target.category !== undefined ? `category:${target.category}` : target.action)}' is already ` +
        "revoked — a second revocation would overwrite the first one's reason and date with a later " +
        "pair describing nothing that happened. Nothing was written.\n");
    }
    const revokedAt = new Date().toISOString();
    a.preAuthorized = a.preAuthorized.map(g =>
      namesGrant(g, target) && !isRevoked(g)
        ? { ...g, revoked: revokeReason ? { reason: revokeReason, revokedAt } : { revokedAt } }
        : g);
  }

  for (const s of (f.preauthorize || [])) {
    if (typeof s !== "string") continue;
    if (s.startsWith("category:")) {
      // "category:<name>:<reason>" — shorthand covering any action the decision rule matches
      // to that category, instead of enumerating each specific action string. See the
      // `conductor` skill's "Epic-level autonomy" section for the matching heuristic.
      const rest = s.slice("category:".length);
      const i = rest.indexOf(":");
      const category = (i === -1 ? rest : rest.slice(0, i)).trim();
      const reason = i === -1 ? undefined : rest.slice(i + 1).trim();
      if (!KNOWN_PREAUTHORIZE_CATEGORIES.includes(category)) {
        die(
          `conductor: --preauthorize category must be one of ${KNOWN_PREAUTHORIZE_CATEGORIES.join("|")}\n`);
      }
      const entry = { category, grantedAt: new Date().toISOString() };
      if (reason) entry.reason = reason;
      a.preAuthorized = [...a.preAuthorized, entry];
      continue;
    }
    const i = s.indexOf(":");
    const action = i === -1 ? s.trim() : s.slice(0, i).trim();
    const reason = i === -1 ? undefined : s.slice(i + 1).trim();
    // THE ACTION HALF, and only that half. An empty action is not a harmless no-op record: it is a
    // grant whose match against any candidate action is undefined, and an implementer reading the
    // decision rule may reasonably treat it as matching nothing or as matching everything. It is
    // also unrevokable afterwards, because a revoke names a STORED value and an empty one is not
    // expressible as a flag value — so the refusal belongs at the write, while the ambiguity is
    // still one re-run away from being said correctly.
    //
    // NOT `declinedPairs()`'s both-halves rule copied over: "a grant with an action and no reason is
    // still accepted" is behaviour this keeps. The rule binds the half that decides what is
    // AUTHORISED, not the half that explains it. (The empty-CATEGORY half is refused above, by the
    // known-vocabulary test, and has been since before this change.)
    if (!action) {
      die(
        `conductor: --preauthorize ${escapeControls(JSON.stringify(s))} names no action — the action half is what ` +
        "decides what is authorised, and a grant naming nothing matches nothing or everything " +
        "depending on who reads it. Write it as \"<action>:<reason>\". Nothing was written.\n");
    }
    const entry = { action, grantedAt: new Date().toISOString() };
    if (reason) entry.reason = reason;
    a.preAuthorized = [...a.preAuthorized, entry];
  }
  for (const c of (f.context || [])) {
    if (typeof c === "string") a.context = [...a.context, c];
  }
  for (const n of (f.notify || [])) {
    if (typeof n === "string") a.notifications = [...a.notifications, { what: n, when: new Date().toISOString() }];
  }

  epic.autonomy = a;
  const saved = saveState(state);
  render();
  // THE RE-ARM REPORT, printed on BOTH of reportSave()'s branches and therefore written AFTER it.
  // `--level off` does NOT clear grants — deletion is not the inverse of granting, and an epic taken
  // off autonomy for an afternoon has not withdrawn anybody's judgment about which actions were safe
  // — so the fix binds where the measured harm is. The harm was never that the grants SURVIVE; it is
  // that re-arming restores them SILENTLY. A report conditional on the write having changed anything
  // would be swallowed on the second `--level autonomous`, which is the invocation that arms an epic
  // somebody already armed; the report states what is LIVE, not what moved.
  if (level === "autonomous") {
    const live = liveGrants(a);
    errStream().write(live.length
      ? `conductor: arming ${live.length} pre-authorization${live.length === 1 ? "" : "s"} on ` +
        `'${escapeControls(id)}': ${live.map(g => escapeControls(grantLabel(g))).join(", ")}\n`
      // Said out loud rather than left silent: silence here is indistinguishable from a report that
      // was not produced, which is the whole defect this line closes.
      : `conductor: arming no pre-authorizations on '${escapeControls(id)}' — it holds none that ` +
        "are live (a revoked grant is not restored by re-arming, and a grant naming nothing " +
        "authorises nothing)\n");
  }
  reportSave(saved, {
    changed: `conductor: autonomy for '${escapeControls(id)}' is now level=${escapeControls(a.level)}`,
    unchanged: `conductor: autonomy for '${escapeControls(id)}' already reads level=${escapeControls(a.level)} with exactly the ` +
      `pre-authorizations and context this invocation supplied — ${STATE_UNCHANGED}`,
  });
}
