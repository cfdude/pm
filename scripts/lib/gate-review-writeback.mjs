// scripts/lib/gate-review-writeback.mjs
// Records an OpenSpec gate review's verdict durably against an epic. One-directional
// dependencies only.

import { KNOWN_GATE_NUMBERS, epicFlagsFor, gateArtifacts, gateHasEvidence } from "./constants.mjs";
import { isInitialized, loadState, saveState } from "./state.mjs";
import { reportSave, STATE_UNCHANGED } from "./save-report.mjs";
import { parseFlags, requireFlagValues } from "./add-epic.mjs";
import { render } from "./render.mjs";

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
  // GATE 1's evidence (gh#177): the artifact PATHS the reviewer actually read. Repeatable, so it
  // arrives as an array; a single occurrence arrives as a string because parseFlags' repeatable
  // set is a global union and this normalizes either shape rather than trusting one.
  const artifacts = [].concat(f.artifact === undefined ? [] : f.artifact)
    .filter(v => typeof v === "string" && v.trim() !== "").map(v => v.trim());
  if (!id || !gate || !verdict) {
    process.stderr.write(
      "usage: conductor.mjs record-gate-review <epicId> --gate 1|2 --verdict pass|fail " +
      "[--artifact <path>]... [--base-sha <sha>] [--head-sha <sha>] [--reviewer \"<identity>\"]\n");
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
  // gh#177 — WHICH evidence a pass requires depends on WHICH GATE it is, because the two gates
  // review different things. Gate 2 reads an implementation range and must record it. Gate 1 is
  // the SPEC review and runs before `/opsx:apply`, so at the moment its verdict is truthful there
  // is no implementation range in existence: demanding one produced a field satisfiable only with
  // a value of the wrong kind, and 0.40.0's own Gate 1 duly recorded its ARTIFACT commits, which
  // every consumer reading `baseSha..headSha` as an implementation range then read as one.
  //
  // A PASS STILL CARRIES EVIDENCE — that rule is unchanged and is the reason this is not simply
  // "make the flags optional". Gate 1's evidence is `--artifact`; the sha pair remains ACCEPTED
  // there so that every invocation that worked before still works, and every verdict already
  // recorded still loads.
  if (verdict === "pass") {
    const hasRange = gateHasEvidence({ baseSha, headSha });
    if (gate === "2" && !hasRange) {
      const missingEvidence = [];
      if (baseSha === undefined) missingEvidence.push("--base-sha");
      if (headSha === undefined) missingEvidence.push("--head-sha");
      process.stderr.write(
        `conductor: a gate 2 'pass' requires the commit range it covered — missing ` +
        `${missingEvidence.join(" and ")}. Record the range the reviewer actually read ` +
        `(a 'fail' may omit it).\n`);
      process.exit(1);
    }
    if (gate === "1" && !hasRange && !artifacts.length) {
      process.stderr.write(
        "conductor: a gate 1 'pass' requires the artifacts it reviewed — missing --artifact " +
        "<path> (repeatable). Gate 1 is the SPEC review and runs before any code exists, so its " +
        "evidence is the proposal, design, specs and tasks the reviewer actually read " +
        "(a 'fail' may omit it).\n");
      process.exit(1);
    }
    // RECORDED, then said out loud. A range on a gate 1 verdict is not refused — refusing it
    // would break every invocation that predates this change, and the record would be lost
    // rather than corrected — but it is the wrong KIND of evidence for a spec review, and
    // `integrity`'s `verdict-range-omits-cited-commits` arm reads gate 1's range exactly as it
    // reads gate 2's.
    if (gate === "1" && hasRange && !artifacts.length) {
      process.stderr.write(
        `conductor: recorded — but ${baseSha}..${headSha} is an IMPLEMENTATION range on a gate 1 ` +
        "verdict, and every consumer that reads that field treats it as one. Gate 1 reviews " +
        "artifacts by path: --artifact <path> (repeatable) is the evidence a spec review has.\n");
    }
  }
  const state = loadState();
  const epic = state.epics.find(e => e.id === id);
  if (!epic) { process.stderr.write(`conductor: epic '${id}' not found\n`); process.exit(1); }
  // Normalized, not strict: an epic with no lane is openspec-lane everywhere else, and
  // refusing it a verdict here would leave it permanently unable to satisfy the archive
  // gate that (also normalizing) binds it.
  // #163 — NO LANE REFUSAL. A verdict is recordable wherever a review actually happened.
  //
  // `set-review-mode` is lane-agnostic and its own table names "a Superpowers task review", so pm
  // told every lane to run reviews and could record the verdict for exactly one of them. The
  // consequences were 0.27.0's own defects displaced by one lane: `--base-sha`/`--head-sha` became
  // prose in `--notes`, which nothing compares, so a non-openspec verdict could never read stale;
  // `integrity` keys off `gateReview` and could not see it; and silence was indistinguishable from
  // reviewed-and-clean. This release's own Gate 2 — two fresh-context reviewers, a real commit
  // range, one Important finding — was unverifiable prose for exactly this reason.
  //
  // THE ARCHIVE GATE IS UNCHANGED and stays openspec-only (archive-gate.mjs). Recording evidence
  // where a review happened must not create an obligation where none existed: a claude-code epic
  // with no verdict archives exactly as it always has. Asserted by conductor-36.

  epic.gateReview = epic.gateReview && typeof epic.gateReview === "object" ? epic.gateReview : {};
  const entry = { verdict, reviewedAt: new Date().toISOString() };
  if (baseSha !== undefined) entry.baseSha = baseSha;
  if (headSha !== undefined) entry.headSha = headSha;
  // In the ORDER GIVEN, and stored as bare paths. Accepted on gate 2 as well as gate 1: a
  // reviewer who also names the artifacts they read has recorded something true, and refusing it
  // there would be a second rule for a field that means the same thing on both gates. What
  // differs between the gates is what a PASS requires, which is decided above and nowhere else.
  if (artifacts.length) entry.artifacts = artifacts;
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

  const saved = saveState(state);
  render();
  reportSave(saved, {
    changed: `conductor: recorded gate ${gate} review '${verdict}' for '${id}'`,
    unchanged: `conductor: '${id}' already carried this exact gate ${gate} verdict — ${STATE_UNCHANGED}`,
  });
}
