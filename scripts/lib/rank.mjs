// scripts/lib/rank.mjs
// MANUAL RANK — placement among equals, and the `reorder` verb that is its only writer.
//
// WHAT IT IS FOR, and what it is deliberately not. Three undifferentiated P1s sort
// alphabetically today, which is arbitrary and reads as if it meant something. `rank` is the
// tie-break that replaces `id.localeCompare`, and nothing more:
//
//     dependencies (hard constraint) → priority (merit) → RANK (tie-break)
//
// Rank is the LAST key on purpose. A rank that outranked a dependency would just re-create the
// starvation inversion gh#101 exists to remove, with a number defending it; a rank that
// outranked priority would make the priority field decorative. Both would be a manual override
// of a computed truth, which is the failure mode `effectivePriority` was written to avoid.
//
// `rank` is NOT `order`. `order` sequences stories INSIDE an epic — different container,
// different question, genuinely not derivable. Keeping the two words apart keeps the two
// questions apart.
//
// ── THE INVARIANT, stated precisely, because the loose version is wrong ──
// `reorder` writes DENSE `1..N` across the epics it is given, and it is the only thing that
// writes `rank` at all. What survives continuously is therefore weaker than "ranks are exactly
// 1..N forever":
//
//   * within a priority band, the RANKED epics carry DISTINCT ranks; unranked is legal and
//     sorts after every ranked one.
//   * contiguity holds AT WRITE TIME and self-heals on the next `reorder`.
//
// It has to be stated that way, because two ordinary operations perturb it and neither is a
// defect: `add-epic` registers a new epic with no rank (so it joins the unranked tail rather
// than breaking the ranked prefix), and `remove-epic` leaves a gap in the numbering (harmless —
// a gap changes no ordering, and the next `reorder` closes it). What would NOT be harmless is a
// rank surviving a move between bands, where it would collide with the destination band's own
// numbering; `update-epic --priority` therefore clears it.
//
// Dense-not-sparse is the right call here specifically because `state.json` is rewritten
// wholesale on every verb and holds tens of epics: renumbering is free, so there is no gap
// exhaustion to fear and no compaction pass to remember. Sparse ranking exists to avoid
// renumbering rows in a database, which is not this situation.
//
// The verb takes the whole band POSITIONALLY and refuses a partial one. That is what makes
// contiguity true by construction rather than checked afterwards, and it is why there is no
// per-epic `--rank` flag: one-at-a-time reordering is both tedious and, given the write-conflict
// guard, racy — two agents each setting one rank produce a numbering neither of them chose.

// The READ side — `rankOf()`, the sort key itself — lives in epic-progress.mjs beside
// `resolveEpics()`'s comparator, because that is the one place the ordering is expressed and a
// key defined away from its comparator is a key that drifts from it. This file is the WRITE
// side and the rules above.

import { isInitialized, loadState, saveState } from "./state.mjs";
import { render } from "./render.mjs";

/** `reorder <id> <id> …` — set the manual rank of one whole priority band, atomically.
 *
 *  Every refusal below writes NOTHING. A partially applied reorder is worse than a rejected
 *  one: it leaves a numbering nobody asked for, in a field whose entire value is that a human
 *  chose it. */
export function reorder() {
  if (!isInitialized()) { process.stderr.write("conductor: run /pm:init first\n"); process.exit(1); }
  const ids = process.argv.slice(3).filter(a => !a.startsWith("--"));
  const fail = (msg) => {
    process.stderr.write(`conductor: ${msg}\n`);
    process.exit(1);
  };
  if (!ids.length) {
    // Not a no-op and not "clear the band": an empty invocation is far likelier to be a shell
    // expansion that produced nothing than a deliberate request, and the destructive reading of
    // what looks like a typo is exactly how `--link` with no value used to wipe an epic's links.
    process.stderr.write("usage: conductor.mjs reorder <id> <id> … " +
      "(every non-archived epic in ONE priority band, in the order you want them)\n");
    process.exit(1);
  }

  const state = loadState();
  const byId = new Map(state.epics.map(e => [e.id, e]));

  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) fail(`'${id}' is named twice — a rank is a position, and one epic has one`);
    seen.add(id);
    if (!byId.has(id)) fail(`epic '${id}' not found`);
    if (byId.get(id).status === "archived") {
      fail(`epic '${id}' is archived — ranking finished work orders a band nobody will read`);
    }
  }

  const band = byId.get(ids[0]).priority;
  const offBand = ids.filter(id => byId.get(id).priority !== band);
  if (offBand.length) {
    // Ranks from two bands in one call cannot both be 1..N, so the numbering would silently mean
    // something different for each half.
    fail(`rank is a placement WITHIN one priority band, and these are not all ${band}: ` +
      offBand.map(id => `${id} (${byId.get(id).priority})`).join(", "));
  }

  // COMPLETENESS is the whole mechanism. Accepting a subset would let `1..N` be written over a
  // band that has more than N members, at which point rank is no longer validatable and the
  // engine cannot tell a deliberate order from a half-finished one.
  const missing = state.epics
    .filter(e => e.priority === band && e.status !== "archived" && !seen.has(e.id))
    .map(e => e.id);
  if (missing.length) {
    fail(`reorder takes the WHOLE ${band} band so the numbering stays contiguous — ` +
      `not named: ${missing.join(", ")}. Add them in the position you want them.`);
  }

  ids.forEach((id, i) => { byId.get(id).rank = i + 1; });
  saveState(state, { verb: "reorder" });
  process.stdout.write(`conductor: ${band} reordered — ${ids.map((id, i) => `${i + 1}. ${id}`).join("  ")}\n`);
  render();
}
