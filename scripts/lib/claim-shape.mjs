// scripts/lib/claim-shape.mjs
// What an advisory claim IS, and how to read one. LEAF module: imports nothing from lib/.
//
// Split out from claims.mjs (the verbs) on purpose. `integrity.mjs`'s own header states the
// dependency discipline it lives under — it may import constants/epic-progress/disposition/
// links/git "and nothing under those imports back up" — and claims.mjs reaches add-epic.mjs for
// parseFlags, which is circular with render.mjs. Two readers of one predicate must never end up
// with two copies of it, so the predicate moved down here rather than the audit growing a
// second definition of "expired".

/** When `claim` stops being live, as an ISO string — or null when the record is unreadable.
 *
 *  DERIVED, never stored. A stored `expiresAt` alongside a stored `claimedAt` + `ttlMinutes`
 *  would be two places saying one thing, and the record could then contradict itself. */
export function claimExpiry(claim) {
  if (!claim || typeof claim !== "object") return null;
  const t = Date.parse(claim.claimedAt);
  if (!Number.isFinite(t)) return null;
  const mins = Number(claim.ttlMinutes);
  if (!Number.isFinite(mins) || mins <= 0) return null;
  return new Date(t + mins * 60_000).toISOString();
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
