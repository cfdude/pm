// scripts/lib/rules-usage.mjs
// gh-cfdude-pm-248 D1/D2 — the ONE predicate pair behind the usage-conditioned rules-block sections.
//
// A LEAF over a state object: it reads nothing and imports nothing, so rules.mjs (the renderer), the
// `rules` verb, overhead.rulesBlockFor and the refresh can all ask the same question without a cycle.
// Every path that renders the block FROM STATE asks `rulesUsage(state)`; a caller that supplies no
// answers renders the FULL block (`FULL_USAGE`), which is the safe failure — it over-emits rather than
// drops a rule.

/** Both usage answers true: the block every caller that supplies no answers gets. */
export const FULL_USAGE = Object.freeze({ autonomy: true, releaseCandidate: true });

const isRecord = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** `{ autonomy, releaseCandidate }` for a record image. PURE.
 *  - autonomy: some epic whose status is not `archived` holds an `autonomy` object. PRESENCE, not level:
 *    the preflight writes grants and context before `--level autonomous`, and level `off` keeps the
 *    grants that re-arming restores.
 *  - releaseCandidate: some entry of `state.releases` has no truthy `delivered`. Not "any release
 *    exists": no verb removes a release, so that would have no shipped inverse; `--deliver` and
 *    `--undeliver` are the real ones. */
export function rulesUsage(state) {
  const s = state || {};
  const epics = Array.isArray(s.epics) ? s.epics : [];
  const releases = Array.isArray(s.releases) ? s.releases : [];
  return {
    autonomy: epics.some((e) => isRecord(e) && e.status !== "archived" && isRecord(e.autonomy)),
    releaseCandidate: releases.some((r) => isRecord(r) && !r.delivered),
  };
}
