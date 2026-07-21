// scripts/lib/active-pointer.mjs
// The single-active-epic invariant, staleness detection, and the set-active/clear-active
// CLI verbs. Circular with lib/render.mjs (setActive/clearActive call render(); render()
// calls staleMarker()) -- see the design doc.

import { isArchived } from "./epic-progress.mjs";
import { isInitialized, loadState, saveState } from "./state.mjs";
import { render } from "./render.mjs";

/** Enforce the single-active invariant: `id` becomes the one active epic AND the
 *  top-level `.active` pointer. Any OTHER epic left at status "active" is demoted to
 *  "queued", so `.active` and `status: "active"` can never silently disagree. */
export function activate(state, id) {
  for (const e of state.epics) if (e.status === "active" && e.id !== id) e.status = "queued";
  const t = state.epics.find(e => e.id === id);
  if (t) {
    t.status = "active";
    // Stamp startedAt only once — re-activating (e.g. resuming after a demotion)
    // must not reset the clock used for staleness/velocity tracking.
    if (!t.startedAt) t.startedAt = new Date().toISOString();
  }
  state.active = id;
}

const STALE_DAYS = 14;

/** Days elapsed since `startedAt`, or null if the epic has no startedAt (never activated)
 *  or is already completed (completedAt set) — a finished epic is never "stale". */
export function daysActive(epic) {
  if (!epic.startedAt || epic.completedAt) return null;
  const started = Date.parse(epic.startedAt);
  if (Number.isNaN(started)) return null;
  return Math.floor((Date.now() - started) / (24 * 60 * 60 * 1000));
}

/** `⚠ stale, Nd active` marker for an epic that's been active more than STALE_DAYS with
 *  no completedAt — surfaced in both PROJECT.md's table and the brief's NOW/NEXT UP lines. */
export function staleMarker(epic) {
  const d = daysActive(epic);
  return d !== null && d > STALE_DAYS ? ` ⚠ stale, ${d}d active` : "";
}

/** `set-active <id>` — the CLI verb for the top-level active pointer (positional id). */
export function setActive() {
  if (!isInitialized()) { process.stderr.write("conductor: run /pm:init first\n"); process.exit(1); }
  const argv = process.argv.slice(3);
  const id = argv[0] && !argv[0].startsWith("--") ? argv[0] : undefined;
  if (!id) { process.stderr.write("usage: conductor.mjs set-active <id>\n"); process.exit(1); }
  const state = loadState();
  const t = state.epics.find(e => e.id === id);
  if (!t) { process.stderr.write(`conductor: epic '${id}' not found\n`); process.exit(1); }
  if (t.status === "archived" || isArchived(id)) {
    process.stderr.write(`conductor: epic '${id}' is archived — cannot make it active\n`); process.exit(1);
  }
  activate(state, id);
  saveState(state);
  render();
  process.stderr.write(`conductor: active is now '${id}'\n`);
}

/** `clear-active` — drop the active pointer and demote the epic it pointed at. */
export function clearActive() {
  if (!isInitialized()) { process.stderr.write("conductor: run /pm:init first\n"); process.exit(1); }
  const state = loadState();
  if (state.active) {
    const a = state.epics.find(e => e.id === state.active);
    if (a && a.status === "active") a.status = "queued";
  }
  state.active = null;
  saveState(state);
  render();
  process.stderr.write("conductor: active cleared\n");
}
