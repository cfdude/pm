// scripts/lib/remove-epic.mjs
// The remove-epic verb and its epic-summary-table formatter. One-directional
// dependencies only.

import { isInitialized, loadState, saveState } from "./state.mjs";
import { parseFlags } from "./add-epic.mjs";
import { epicReferences } from "./links.mjs";
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
 *  review; `--cascade` removes the epic and every descendant in one go. EVERY reference to a
 *  removed id — declared once by epicReferences() in links.mjs, not enumerated here — is
 *  stripped automatically with a warning naming where it was held; dangling references are
 *  worse than a silently smaller graph. The one exception is a detour-stack frame, which is
 *  control state rather than a record and blocks the removal instead. */
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

  // EVERY reference to a removed id, read from the one declaration of where the record holds
  // them. Enumerating the holders here is what left a release's `deferred[]`, a disposition's
  // `carriedTo` and a deferral assertion's `deferrals[]` dangling after group 14 added them:
  // `PROJECT.md` rendered a deferral pointing at an epic that no longer existed.
  const refs = epicReferences(state).filter(r => toRemove.has(r.epic));

  // A detour frame is CONTROL state, not a record. Dropping it discards a paused epic's resume
  // path; keeping it leaves `/pm:resume` popping a frame that names nothing. Neither is a
  // sweep, so this refuses and says which frame holds the epic.
  const blocking = refs.filter(r => !r.drop);
  if (blocking.length) {
    process.stderr.write(
      `conductor: cannot remove ${[...toRemove].map(i => `'${i}'`).join(", ")} — still held by ` +
      `${blocking.length} detour-stack reference(s): ` +
      blocking.map(r => `${r.where} → \`${r.epic}\``).join("; ") + ".\n" +
      "Resume or pop the detour first (/pm:resume), then remove.\n");
    process.exit(1);
  }

  const affected = [];
  for (const r of refs) {
    r.drop();
    affected.push(r.where);
  }

  state.epics = state.epics.filter(e => !toRemove.has(e.id));

  saveState(state);
  render();
  const removedIds = [...toRemove];
  process.stderr.write(`conductor: removed ${removedIds.length} epic(s): ${removedIds.join(", ")}\n`);
  if (affected.length) {
    process.stderr.write(
      `conductor: stripped ${affected.length} dangling reference(s) to removed epic(s), held by: ` +
      `${[...new Set(affected)].join(", ")}\n`);
  }
}
