// scripts/lib/gate-review-writeback.mjs
// Records an OpenSpec gate review's verdict durably against an epic. One-directional
// dependencies only.

import { epicFlagsFor, gateHasEvidence, isOpenspecLane } from "./constants.mjs";
import { isInitialized, loadState, saveState } from "./state.mjs";
import { parseFlags, requireFlagValues } from "./add-epic.mjs";
import { render } from "./render.mjs";

const KNOWN_GATE_NUMBERS = ["1", "2"];
/** What an AGENT may pass to `--verdict`. Exported so a test binds to the list itself rather
 *  than transcribing it, and deliberately NOT the same list as constants.mjs's
 *  STORABLE_GATE_VERDICTS: the engine additionally stores `ungated`, and admitting that value
 *  here would let the party whose work would otherwise be reviewed certify that no review
 *  happened. Two lists is the mechanism; one list with a comment is not. */
export const KNOWN_GATE_VERDICTS = ["pass", "fail"];

export function recordGateReview() {
  if (!isInitialized()) { process.stderr.write("conductor: run /pm:init first\n"); process.exit(1); }
  const argv = process.argv.slice(3);
  const id = argv[0] && !argv[0].startsWith("--") ? argv[0] : undefined;
  const f = parseFlags(id ? argv.slice(1) : argv);
  // The allowlist, PROJECTED from the shared registry — never a literal here. Without it this
  // command read the flags it happened to name and dropped every other one in silence, so
  // `--reviewr "x"` exited 0 and wrote nothing: #79's exact shape at a fifth epic-mutating
  // site, and at the very command this release added `--base-sha`/`--head-sha`/`--reviewer` to.
  // Rejected BEFORE loadState(), so a refusal cannot leave a partial write behind.
  const known = epicFlagsFor("record-gate-review");
  const unknown = Object.keys(f).filter(k => !known.includes(k));
  if (unknown.length) {
    process.stderr.write(`conductor: record-gate-review: unknown flag(s) --${unknown.join(", --")} ` +
      `(known: ${known.map(k => `--${k}`).join(", ")})\n`);
    process.exit(1);
  }
  // #149 — this command checked NO flag for a value, so a valueless `--reviewer` (and a blank
  // `--base-sha`) exited 0 with the evidence field simply absent from the recorded verdict.
  // One rule, read from the same registry the allowlist above is projected from.
  requireFlagValues("record-gate-review", f);
  const gate = typeof f.gate === "string" ? f.gate : (typeof f.gate === "number" ? String(f.gate) : undefined);
  const verdict = typeof f.verdict === "string" ? f.verdict : undefined;
  // Evidence as FIELDS, never as prose in a note. A recorded `a..b` on an epic that later
  // shipped `b..c` was byte-identical in the record to a review that covered everything, and
  // reviewer identity buried in a free-text note cannot be queried apart from any other remark.
  const reviewer = typeof f.reviewer === "string" ? f.reviewer : undefined;
  const baseSha = typeof f["base-sha"] === "string" ? f["base-sha"] : undefined;
  const headSha = typeof f["head-sha"] === "string" ? f["head-sha"] : undefined;
  if (!id || !gate || !verdict) {
    process.stderr.write(
      "usage: conductor.mjs record-gate-review <epicId> --gate 1|2 --verdict pass|fail " +
      "[--base-sha <sha>] [--head-sha <sha>] [--reviewer \"<identity>\"]\n");
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
  // A `pass` MUST carry the range it covered. Without it, `record-gate-review <id> --gate 2
  // --verdict pass` is one command with no evidence requirement at all, and a review of `a..b`
  // on an epic that later ships `b..c` is byte-identical in the record to one that covered
  // everything. A `fail` may omit the range: there is no shipped work for it to have covered,
  // and demanding a range would make recording a failed review harder than recording a pass.
  if (verdict === "pass" && !gateHasEvidence({ baseSha, headSha })) {
    const missingEvidence = [];
    if (baseSha === undefined) missingEvidence.push("--base-sha");
    if (headSha === undefined) missingEvidence.push("--head-sha");
    process.stderr.write(
      `conductor: a 'pass' verdict requires the commit range it covered — missing ` +
      `${missingEvidence.join(" and ")}. Record the range the reviewer actually read ` +
      `(a 'fail' may omit it).\n`);
    process.exit(1);
  }
  const state = loadState();
  const epic = state.epics.find(e => e.id === id);
  if (!epic) { process.stderr.write(`conductor: epic '${id}' not found\n`); process.exit(1); }
  // Normalized, not strict: an epic with no lane is openspec-lane everywhere else, and
  // refusing it a verdict here would leave it permanently unable to satisfy the archive
  // gate that (also normalizing) binds it.
  if (!isOpenspecLane(epic)) {
    process.stderr.write(
      `conductor: record-gate-review only applies to openspec-lane epics ` +
      `('${id}' is lane '${epic.lane}')\n`);
    process.exit(1);
  }

  epic.gateReview = epic.gateReview && typeof epic.gateReview === "object" ? epic.gateReview : {};
  const entry = { verdict, reviewedAt: new Date().toISOString() };
  if (baseSha !== undefined) entry.baseSha = baseSha;
  if (headSha !== undefined) entry.headSha = headSha;
  if (reviewer !== undefined) entry.reviewer = reviewer;

  // Supersede, never destroy. This write used to replace the entry wholesale, so the `ungated`
  // record the archive-drift heal writes — the record that an epic reached `archived` with no
  // review — was erased by the very verdict that supersedes it, and "the superseded entry MUST
  // remain readable" had no writer anywhere in the engine.
  //
  // ONE nested record, not a chain: the prior entry's own `superseded` is dropped rather than
  // carried down. A growing verdict history is a different capability, and an unbounded nest
  // would make the record's depth a function of how many times a gate was re-recorded.
  const prior = epic.gateReview[`gate${gate}`];
  if (prior && typeof prior === "object") {
    const kept = { ...prior };
    delete kept.superseded;
    entry.superseded = kept;
  }
  epic.gateReview[`gate${gate}`] = entry;

  saveState(state);
  render();
  process.stderr.write(`conductor: recorded gate ${gate} review '${verdict}' for '${id}'\n`);
}
