// scripts/lib/spend-switch.mjs
// token-spend-tracking-per-epic — the ONE predicate for "is spend tracking on in this record".
//
// A LEAF, on purpose: it imports nothing. The rules block (rules.mjs) needs the answer to decide
// whether to emit the `## Spend tracking` section, and `set-spend-tracking` (spend-tracking.mjs) needs
// rules.mjs to refresh CLAUDE.md after a toggle — so the predicate cannot live in either of them
// without a cycle. Absent config means OFF, the only default under which a user who never opts in
// pays nothing.

/** Is spend tracking on in this record? */
export function spendEnabled(state) {
  return !!(state && state.spendTracking && state.spendTracking.enabled === true);
}
