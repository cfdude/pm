// scripts/lib/claim-shape.mjs
// What an advisory claim IS, and how to read one. LEAF module: imports only constants.mjs, which is
// itself a leaf, so integrity.mjs's dependency discipline below still holds.
//
// Split out from claims.mjs (the verbs) on purpose. `integrity.mjs`'s own header states the
// dependency discipline it lives under — it may import constants/epic-progress/disposition/
// links/git "and nothing under those imports back up" — and claims.mjs reaches add-epic.mjs for
// parseFlags, which is circular with render.mjs. Two readers of one predicate must never end up
// with two copies of it, so the predicate moved down here rather than the audit growing a
// second definition of "expired".

import { CLAIM_MAX_TTL_MINUTES, escapeControls } from "./constants.mjs";

/** Is `n` a TTL a claim may carry: a finite number of minutes, greater than zero and no greater
 *  than CLAIM_MAX_TTL_MINUTES? One predicate for the writer's refusal and the reader's judgement. */
export function validTtlMinutes(n) {
  return typeof n === "number" && Number.isFinite(n) && n > 0 && n <= CLAIM_MAX_TTL_MINUTES;
}

/** When `claim` stops being live, as an ISO string — or null when the record is unreadable: a
 *  `claimedAt` that does not parse, a TTL that is not valid (validTtlMinutes — above the maximum
 *  included, so a claim an earlier engine wrote with a longer TTL reads as expired), or a sum that
 *  is not a representable date. NEVER throws: a reader that throws is worse than either reading.
 *
 *  DERIVED, never stored. A stored `expiresAt` alongside a stored `claimedAt` + `ttlMinutes`
 *  would be two places saying one thing, and the record could then contradict itself. */
export function claimExpiry(claim) {
  if (!claim || typeof claim !== "object") return null;
  const t = Date.parse(claim.claimedAt);
  if (!Number.isFinite(t)) return null;
  const mins = Number(claim.ttlMinutes);
  if (!validTtlMinutes(mins)) return null;
  const expiry = new Date(t + mins * 60_000);
  return Number.isFinite(expiry.getTime()) ? expiry.toISOString() : null;
}

/** Is this claim still live, as of `now`?
 *
 *  A record whose timestamp or TTL is unreadable is treated as EXPIRED, never as live. That
 *  direction is chosen rather than incidental: an unreadable marker that read as live would
 *  block every other session forever with no way to reason about when it stops — the "worse
 *  than no marker at all" failure #84 names in its own words. */
export function isLiveClaim(claim, now = Date.now()) {
  const exp = claimExpiry(claim);
  return exp !== null && Date.parse(exp) > now;
}

/** THE ONE REMOVAL PATH for the claim of an epic that has ENDED (#84; code review 0.43.0, B2).
 *  An archived epic cannot still be OWNED: the claim is an advisory "I am working on this", and
 *  leaving it behind is a dangling reference that `owners` would show as live ownership of finished
 *  work forever. Every path that moves an epic to `archived` calls this — `update-epic` and the
 *  archive-drift heal (`reconcileArchived`, which is how an `/opsx:archive`d epic usually gets
 *  there). The heal once had no removal, and integrity then blamed a hand-edit that never happened.
 *
 *  Deletes `epic.claim` and returns the line to announce, or null when nothing was held. The CALLER
 *  writes the line, so this module stays a leaf. */
export function releaseClaimOfEndedEpic(epic) {
  if (!epic || !epic.claim) return null;
  const line = `conductor: cleared the advisory claim held by '${escapeControls(epic.claim.session)}' — ` +
    `'${escapeControls(epic.id)}' has ended\n`;
  delete epic.claim;
  return line;
}
