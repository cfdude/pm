// scripts/lib/remove-epic.mjs
// The remove-epic verb and its epic-summary-table formatter. One-directional
// dependencies only.

import { isInitialized, loadState, saveState } from "./state.mjs";
import { parseFlags } from "./add-epic.mjs";
import { render } from "./render.mjs";

/** Render a short (id, title, summary) table for human review — used when a removal is
 *  blocked by children, so the operator sees exactly what's in play without a raw dump. */
export function epicSummaryTable(epics) {
  return epics
    .map(e => `  ${e.id.padEnd(24)} ${e.title.slice(0, 50).padEnd(50)} ${e.lane}/${e.priority}/${e.status}`)
    .join("\n");
}

/** `remove-epic <id> [--cascade]` — hard-deletes an epic (splice from state.json;
 *  recoverable only via git history, replacing the raw `git checkout` workaround). Blocks
 *  by default if the epic has children, printing an (id, title, summary) table for human
 *  review; `--cascade` removes the epic and every descendant in one go. Any OTHER epic's
 *  `links[]` entries referencing a removed id are stripped automatically, with a warning
 *  naming the affected epics — dangling references are worse than a silently smaller graph. */
export function removeEpic() {
  if (!isInitialized()) { process.stderr.write("conductor: run /pm:init first\n"); process.exit(1); }
  const argv = process.argv.slice(3);
  const id = argv[0] && !argv[0].startsWith("--") ? argv[0] : undefined;
  if (!id) { process.stderr.write("usage: conductor.mjs remove-epic <id> [--cascade]\n"); process.exit(1); }
  const f = parseFlags(argv.slice(1));
  const cascade = f.cascade === true || f.cascade === "true";

  const state = loadState();
  const epic = state.epics.find(e => e.id === id);
  if (!epic) { process.stderr.write(`conductor: epic '${id}' not found\n`); process.exit(1); }

  // Walk the FULL descendant tree (BFS), not just direct children — the block-path preview
  // and the --cascade removal must agree on blast radius, or a human approving --cascade off
  // the preview table would be confirming a smaller deletion than what actually happens.
  const directChildren = state.epics.filter(e => e.parent === id);
  const descendants = [];
  {
    let frontier = [id];
    while (frontier.length) {
      const next = state.epics.filter(e => frontier.includes(e.parent));
      descendants.push(...next);
      frontier = next.map(e => e.id);
    }
  }

  if (descendants.length && !cascade) {
    process.stderr.write(
      `conductor: cannot remove '${id}' — it has ${directChildren.length} direct child epic(s) ` +
      `and ${descendants.length} descendant(s) total:\n` +
      `${epicSummaryTable([epic, ...descendants])}\n` +
      `Reassign or remove the descendants first, or re-run with --cascade to remove '${id}' ` +
      `and all ${descendants.length} descendant(s) together.\n`);
    process.exit(1);
  }

  const toRemove = new Set([id]);
  if (cascade) for (const d of descendants) toRemove.add(d.id);

  // Strip dangling links[] from epics that survive, and note who was affected.
  const affected = [];
  for (const e of state.epics) {
    if (toRemove.has(e.id)) continue;
    const before = (e.links || []).length;
    e.links = (e.links || []).filter(l => !toRemove.has(l.epic));
    if (e.links.length !== before) affected.push(e.id);
  }

  state.epics = state.epics.filter(e => !toRemove.has(e.id));
  if (toRemove.has(state.active)) state.active = null;

  saveState(state);
  render();
  const removedIds = [...toRemove];
  process.stderr.write(`conductor: removed ${removedIds.length} epic(s): ${removedIds.join(", ")}\n`);
  if (affected.length) {
    process.stderr.write(`conductor: stripped dangling link(s) referencing removed epic(s) from: ${affected.join(", ")}\n`);
  }
}
