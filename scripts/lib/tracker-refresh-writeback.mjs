// scripts/lib/tracker-refresh-writeback.mjs
// The record-tracker-refresh verb: the agent's writeback for the tracker-refresh gate.
// One-directional dependencies only. The engine reads NOTHING from a tracker here — it stores
// what the agent supplies, exactly as it does for record-gate-review and record-reconcile.

import { isInitialized, loadState, saveState } from "./state.mjs";
import { parseFlags, requireFlagValues } from "./add-epic.mjs";
import { render } from "./render.mjs";

/** The verdicts a refresh can record. `unchanged` and `material-change` are the whole
 *  vocabulary: the question the gate asks is "did the linked item's content move in a way that
 *  changes the ask", and a third value would be an opinion nothing consumes. */
export const KNOWN_REFRESH_VERDICTS = ["unchanged", "material-change"];

/** `record-tracker-refresh <id> --verdict <v> --external-updated-at <iso> [--summary "<what>"]`
 *
 *  Requires BOTH the verdict and the item's tracker-side updated timestamp, so a verdict can
 *  never be recorded without advancing the watermark — a recorded judgment with a stale
 *  watermark would re-flag the same epic forever and teach a reader to ignore the flag. The
 *  timestamp is the TRACKER's, never a local clock reading: the comparison this feeds is
 *  `remote.updatedAt > epic.externalUpdatedAt`, and mixing in a local clock makes it wrong by
 *  skew and by the tracker's own write latency. */
export function recordTrackerRefresh() {
  if (!isInitialized()) { process.stderr.write("conductor: run /pm:init first\n"); process.exit(1); }
  const argv = process.argv.slice(3);
  const id = argv[0] && !argv[0].startsWith("--") ? argv[0] : undefined;
  if (!id) {
    process.stderr.write(
      "usage: conductor.mjs record-tracker-refresh <id> --verdict unchanged|material-change " +
      "--external-updated-at <iso> [--summary \"<what changed>\"]\n");
    process.exit(1);
  }
  const f = parseFlags(argv.slice(1));
  requireFlagValues("record-tracker-refresh", f);
  const str = (v) => (typeof v === "string" ? v : undefined);

  const verdict = str(f.verdict);
  if (!verdict || !KNOWN_REFRESH_VERDICTS.includes(verdict)) {
    process.stderr.write(`conductor: --verdict must be one of ${KNOWN_REFRESH_VERDICTS.join("|")}\n`);
    process.exit(1);
  }
  const watermark = str(f["external-updated-at"]);
  if (!watermark) {
    process.stderr.write(
      "conductor: record-tracker-refresh requires --external-updated-at <iso> — the item's OWN " +
      "updated timestamp, so a verdict can never be recorded without advancing the watermark\n");
    process.exit(1);
  }

  const state = loadState();
  const epic = state.epics.find(e => e.id === id);
  if (!epic) { process.stderr.write(`conductor: epic '${id}' not found\n`); process.exit(1); }
  if (!epic.externalId) {
    process.stderr.write(
      `conductor: epic '${id}' has no external id — there is no linked item to have refreshed. ` +
      "An epic with no external origin re-reads its LOCAL source (its plan document, or its " +
      "OpenSpec proposal and tasks); that is instruction, and nothing about it is recorded here\n");
    process.exit(1);
  }

  epic.trackerRefresh = {
    verdict,
    ...(str(f.summary) !== undefined ? { summary: str(f.summary) } : {}),
    recordedAt: new Date().toISOString(),
    externalUpdatedAt: watermark,
  };
  epic.externalUpdatedAt = watermark;
  delete epic.trackerRefreshNeeded;

  saveState(state);
  render();
  process.stderr.write(`conductor: recorded tracker refresh for '${id}' (${verdict})\n`);
}
