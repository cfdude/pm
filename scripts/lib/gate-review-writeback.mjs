// scripts/lib/gate-review-writeback.mjs
// Records an OpenSpec gate review's verdict durably against an epic. One-directional
// dependencies only.

import { isInitialized, loadState, saveState } from "./state.mjs";
import { parseFlags } from "./add-epic.mjs";
import { render } from "./render.mjs";

const KNOWN_GATE_NUMBERS = ["1", "2"];
const KNOWN_GATE_VERDICTS = ["pass", "fail"];

export function recordGateReview() {
  if (!isInitialized()) { process.stderr.write("conductor: run /pm:init first\n"); process.exit(1); }
  const argv = process.argv.slice(3);
  const id = argv[0] && !argv[0].startsWith("--") ? argv[0] : undefined;
  const f = parseFlags(id ? argv.slice(1) : argv);
  const gate = typeof f.gate === "string" ? f.gate : (typeof f.gate === "number" ? String(f.gate) : undefined);
  const verdict = typeof f.verdict === "string" ? f.verdict : undefined;
  const note = typeof f.reviewer === "string" ? f.reviewer : undefined;
  if (!id || !gate || !verdict) {
    process.stderr.write(
      "usage: conductor.mjs record-gate-review <epicId> --gate 1|2 --verdict pass|fail " +
      "[--reviewer \"<note>\"]\n");
    process.exit(1);
  }
  if (!KNOWN_GATE_NUMBERS.includes(gate)) {
    process.stderr.write(`conductor: --gate must be one of ${KNOWN_GATE_NUMBERS.join("|")}\n`);
    process.exit(1);
  }
  if (!KNOWN_GATE_VERDICTS.includes(verdict)) {
    process.stderr.write(`conductor: --verdict must be one of ${KNOWN_GATE_VERDICTS.join("|")}\n`);
    process.exit(1);
  }
  const state = loadState();
  const epic = state.epics.find(e => e.id === id);
  if (!epic) { process.stderr.write(`conductor: epic '${id}' not found\n`); process.exit(1); }
  if (epic.lane !== "openspec") {
    process.stderr.write(
      `conductor: record-gate-review only applies to openspec-lane epics ` +
      `('${id}' is lane '${epic.lane}')\n`);
    process.exit(1);
  }

  epic.gateReview = epic.gateReview && typeof epic.gateReview === "object" ? epic.gateReview : {};
  const entry = { verdict, reviewedAt: new Date().toISOString() };
  if (note !== undefined) entry.note = note;
  epic.gateReview[`gate${gate}`] = entry;

  saveState(state);
  render();
  process.stderr.write(`conductor: recorded gate ${gate} review '${verdict}' for '${id}'\n`);
}
