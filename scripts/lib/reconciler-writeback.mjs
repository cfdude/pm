// scripts/lib/reconciler-writeback.mjs
// Records a reconciler's verdict (valid/invalidated) durably against a paused epic's
// link to the detour that may have invalidated it. One-directional dependencies only.

import { isInitialized, loadState, saveState } from "./state.mjs";
import { parseFlags } from "./add-epic.mjs";
import { render } from "./render.mjs";

const KNOWN_RECONCILE_VERDICTS = ["valid", "invalidated"];

export function recordReconcile() {
  if (!isInitialized()) { process.stderr.write("conductor: run /pm:init first\n"); process.exit(1); }
  const argv = process.argv.slice(3);
  const id = argv[0] && !argv[0].startsWith("--") ? argv[0] : undefined;
  const f = parseFlags(id ? argv.slice(1) : argv);
  const detourId = typeof f.detour === "string" ? f.detour : undefined;
  const verdict = typeof f.verdict === "string" ? f.verdict : undefined;
  if (!id || !detourId || !verdict) {
    process.stderr.write(
      "usage: conductor.mjs record-reconcile <epicId> --detour <detourId> " +
      "--verdict valid|invalidated [--amendments \"<a>;<b>\"]\n");
    process.exit(1);
  }
  if (!KNOWN_RECONCILE_VERDICTS.includes(verdict)) {
    process.stderr.write(`conductor: --verdict must be one of ${KNOWN_RECONCILE_VERDICTS.join("|")}\n`);
    process.exit(1);
  }
  const state = loadState();
  const epic = state.epics.find(e => e.id === id);
  if (!epic) { process.stderr.write(`conductor: epic '${id}' not found\n`); process.exit(1); }
  if (!state.epics.some(e => e.id === detourId)) {
    process.stderr.write(`conductor: detour epic '${detourId}' not found\n`); process.exit(1);
  }

  const amendments = typeof f.amendments === "string"
    ? f.amendments.split(";").map(s => s.trim()).filter(Boolean)
    : [];

  epic.links = Array.isArray(epic.links) ? epic.links : [];
  let link = epic.links.find(l => l && l.epic === detourId);
  if (!link) {
    link = { type: "may-invalidate", epic: detourId };
    epic.links.push(link);
  }
  link.reconciled = { verdict, amendments, reconciledAt: new Date().toISOString() };
  epic.reconcileNeeded = false;

  saveState(state);
  render();
  process.stderr.write(`conductor: recorded reconcile verdict '${verdict}' for '${id}' vs '${detourId}'\n`);
}
