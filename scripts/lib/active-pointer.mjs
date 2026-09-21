// scripts/lib/active-pointer.mjs
// The single-active-epic invariant, staleness detection, and the set-active/clear-active
// CLI verbs. Circular with lib/render.mjs (setActive/clearActive call render(); render()
// calls staleMarker()) -- see the design doc.

import { isArchived } from "./epic-progress.mjs";
import { isInitialized, loadState, saveState } from "./state.mjs";
import { reportSave, STATE_UNCHANGED } from "./save-report.mjs";
import { render } from "./render.mjs";
import { ownedDetours } from "./links.mjs";
import { printedId, escapeControls, orNoRemedy } from "./constants.mjs";
import { die } from "./command-exit.mjs";

/** Enforce the single-active invariant: `id` becomes the one active epic AND the
 *  top-level `.active` pointer. Any OTHER epic left at status "active" is demoted to
 *  "queued", so `.active` and `status: "active"` can never silently disagree.
 *
 *  THE single activation door — `set-active`, `update-epic --status active`, `add-epic` creating
 *  at active, and `add-many` all come through here. That is why the tracker-refresh obligation
 *  is set HERE and not at four call sites: binding a rule to one path and not its sibling is the
 *  defect class this release exists to close.
 *
 *  The obligation keys on PROVENANCE — an `externalId` being present — and never on the repo's
 *  tracker direction. Direction says where items are BORN; provenance says where an item's TRUTH
 *  lives, and in a `both` repo the two disagree routinely on the same day. A linked item
 *  accumulates third-party context regardless of which way it was born, so an outward-mirrored
 *  epic owes the same look as an inward-born one. Origin governs only whose ask wins when the
 *  item and a local spec disagree — guidance for the agent, not a recorded field.
 *
 *  It is SET AT THE TRANSITION, never derived from current state — the law `reconcileNeeded`
 *  taught this repo. Deriving it from "does this epic have a stale watermark" would break at
 *  exactly the moment it must stay true, because a watermark advances for reasons unrelated to
 *  activation.
 *
 *  `freshlyRead` is the one exemption: an epic created active by the same command that just read
 *  the external item owes no immediate re-read. It is a parameter rather than a second site
 *  clearing the flag afterwards, so the rule still has exactly one author. */
export function activate(state, id, { freshlyRead = false } = {}) {
  for (const e of state.epics) if (e.status === "active" && e.id !== id) e.status = "queued";
  const t = state.epics.find(e => e.id === id);
  if (t) {
    t.status = "active";
    // Stamp startedAt only once — re-activating (e.g. resuming after a demotion)
    // must not reset the clock used for staleness/velocity tracking.
    if (!t.startedAt) t.startedAt = new Date().toISOString();
    if (t.externalId && !freshlyRead) t.trackerRefreshNeeded = true;
  }
  state.active = id;
}

/** The warning every verb that moves `state.active` OFF an epic owing a reconcile prints after its
 *  save (gates-bind-to-verified-evidence Decision 4). A WARNING, not a refusal — precedent
 *  pop-detour's unarchived-detour warning: refusing would leave no CLI route to set work aside,
 *  which is the hand-edit the detour verbs exist to remove. The obligation itself is untouched, and
 *  gate-guard blocks again when the epic is active once more.
 *
 *  Called at: set-active, clear-active, update-epic (activating another epic, or moving the pointer
 *  off its own epic), add-epic and add-many creating an epic at active, and pop-detour (the pointer
 *  moves off the DETOUR, which can itself owe). The one exemption is push-detour moving the pointer
 *  off the epic it parks: that pause is the obligation's own origin, and its report says so. */
export function owedReconcileNotice(state, previousActiveId) {
  if (typeof previousActiveId !== "string" || !previousActiveId || state.active === previousActiveId) return;
  const e = (state.epics || []).find(x => x && x.id === previousActiveId);
  if (!e || e.reconcileNeeded !== true) return;
  const owed = ownedDetours(e);
  process.stderr.write(
    `conductor: '${escapeControls(e.id)}' is no longer the active epic and still owes a reconcile` +
    (owed.length ? ` against ${owed.map(d => `'${escapeControls(d)}'`).join(", ")}` : "") +
    " — the obligation is kept, and gate-guard blocks edits again when it is active. Answer it with " +
    `${orNoRemedy(() => `\`record-reconcile ${printedId(e.id)} --detour <detourId> --verdict valid|invalidated\``)}.\n`);
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
  if (!isInitialized()) { die("conductor: run /pm:init first\n"); }
  const argv = process.argv.slice(3);
  const id = argv[0] && !argv[0].startsWith("--") ? argv[0] : undefined;
  if (!id) { die("usage: conductor.mjs set-active <id>\n"); }
  const state = loadState();
  const t = state.epics.find(e => e.id === id);
  if (!t) { die(`conductor: epic '${escapeControls(id)}' not found\n`); }
  if (t.status === "archived" || isArchived(id)) {
    die(`conductor: epic '${escapeControls(id)}' is archived — cannot make it active\n`);
  }
  const previous = state.active;
  activate(state, id);
  const saved = saveState(state);
  owedReconcileNotice(state, previous);
  render();
  reportSave(saved, {
    changed: `conductor: active is now '${escapeControls(id)}'`,
    unchanged: `conductor: '${escapeControls(id)}' was already the active epic — ${STATE_UNCHANGED}`,
  });
}

/** `clear-active` — drop the active pointer and demote the epic it pointed at. */
export function clearActive() {
  if (!isInitialized()) { die("conductor: run /pm:init first\n"); }
  const state = loadState();
  const previous = state.active;
  if (state.active) {
    const a = state.epics.find(e => e.id === state.active);
    if (a && a.status === "active") a.status = "queued";
  }
  state.active = null;
  const saved = saveState(state);
  owedReconcileNotice(state, previous);
  render();
  reportSave(saved, {
    changed: "conductor: active cleared",
    unchanged: `conductor: there was no active epic to clear — ${STATE_UNCHANGED}`,
  });
}
