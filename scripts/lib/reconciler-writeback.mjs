// scripts/lib/reconciler-writeback.mjs
// Records a reconciler's verdict (valid/invalidated) durably against a paused epic's
// link to the detour that may have invalidated it. One-directional dependencies only.

import { isInitialized, loadState, saveState } from "./state.mjs";
import { reportSave, STATE_UNCHANGED } from "./save-report.mjs";
import { parseFlags, requireFlagValues } from "./add-epic.mjs";
import { render } from "./render.mjs";
import { isArmed, isUnmigrated, liveReconcileFrame, ownedDetours } from "./links.mjs";

const KNOWN_RECONCILE_VERDICTS = ["valid", "invalidated"];

export function recordReconcile() {
  if (!isInitialized()) { process.stderr.write("conductor: run /pm:init first\n"); process.exit(1); }
  const argv = process.argv.slice(3);
  const id = argv[0] && !argv[0].startsWith("--") ? argv[0] : undefined;
  const f = parseFlags(id ? argv.slice(1) : argv);
  requireFlagValues("record-reconcile", f);
  const detourId = typeof f.detour === "string" ? f.detour : undefined;
  const verdict = typeof f.verdict === "string" ? f.verdict : undefined;
  if (!id || !detourId || !verdict) {
    process.stderr.write(
      "usage: conductor.mjs record-reconcile <epicId> --detour <detourId> " +
      "--verdict valid|invalidated [--amendments \"<a>;<b>\" | --amendment \"<a>\" ...]\n");
    process.exit(1);
  }
  // Both amendment spellings in one call would make the record depend on which one this code reads
  // first. Refused before anything is read, naming the combination (not an unknown flag).
  if (f.amendment !== undefined && f.amendments !== undefined) {
    process.stderr.write(
      "conductor: --amendment and --amendments cannot be combined — give each amendment as its own " +
      "--amendment, or all of them as one `;`-separated --amendments. Nothing was written.\n");
    process.exit(1);
  }
  if (!KNOWN_RECONCILE_VERDICTS.includes(verdict)) {
    process.stderr.write(`conductor: --verdict must be one of ${KNOWN_RECONCILE_VERDICTS.join("|")}\n`);
    process.exit(1);
  }
  const state = loadState();
  const epic = state.epics.find(e => e.id === id);
  if (!epic) { process.stderr.write(`conductor: epic '${id}' not found\n`); process.exit(1); }

  // ACCEPTANCE (gates-bind-to-verified-evidence Decision 2). A verdict answers ONLY a detour this
  // epic's obligation was ARMED for by `push-detour --reconcile`. The verb used to push a
  // `may-invalidate` link to whatever `--detour` named and clear the flag, so a verdict against the
  // epic itself, an unrelated epic, or a `--no-reconcile` detour cleared an obligation owed against
  // another detour, and `gate-guard` let the edit through. Every refusal below exits before any
  // write and names what IS owed, so the caller learns the one invocation that is accepted.
  const owed = ownedDetours(epic);
  const owedPhrase = owed.length
    ? `'${id}' owes a verdict against: ${owed.map(d => `'${d}'`).join(", ")}`
    : `'${id}' owes no reconcile verdict against any detour`;
  const refuse = (why) => { process.stderr.write(`conductor: ${why} — ${owedPhrase}. Nothing was written.\n`); process.exit(1); };
  //  0. An UNMIGRATED link — one written before arming records existed — may carry an obligation
  //     nothing can count, so EVERY verdict on this epic waits for the stamp, whichever detour it
  //     names: a verdict against a new armed detour would otherwise set the flag from ownedDetours()
  //     and silently drop the unmigrated one.
  const unmigrated = (Array.isArray(epic.links) ? epic.links : []).filter(isUnmigrated);
  if (unmigrated.length) {
    process.stderr.write(
      `conductor: '${id}' holds ${unmigrated.length} may-invalidate link(s) written before reconcile ` +
      `arming was recorded (${unmigrated.map(l => `'${l.epic}'`).join(", ")}). Run /pm:upgrade first ` +
      "(`upgrade`): it stamps each link with whether a reconcile is owed against it, and only then " +
      "can a verdict be matched to the detour it answers. Nothing was written.\n");
    process.exit(1);
  }
  //  0b. KEPT from before the arming rule: a --detour that names no epic is a typo or a removed record,
  // and it is refused as that rather than diagnosed as an unarmed detour — and an armed link a
  // hand-edit left pointing at a missing epic is never answered in its name. AFTER the unmigrated
  // refusal (Gate 2 m2), so an epic awaiting /pm:upgrade is told that whatever --detour says.
  if (!state.epics.some(e => e.id === detourId)) {
    process.stderr.write(`conductor: detour epic '${detourId}' not found\n`); process.exit(1);
  }
  //  1. Never the epic itself.
  if (detourId === id) refuse(`'${id}' cannot answer a reconcile against itself`);
  //  2. Only a detour this epic's link ARMS.
  const link = (Array.isArray(epic.links) ? epic.links : []).find(l => l && l.type === "may-invalidate" && l.epic === detourId);
  if (!isArmed(link)) {
    refuse(`'${detourId}' is not a detour '${id}' was paused for with --reconcile, so there is no ` +
      "reconcile obligation for this verdict to answer");
  }
  //  3. Not while that detour's frame is still on the stack: the detour has not been resumed from,
  //     so its work is not finished and nothing has yet been reconciled against it.
  if ((state.detourStack || []).some(fr => fr && fr.pausedEpic === id && fr.spawnedDetour === detourId)) {
    refuse(`'${id}' is still paused for '${detourId}' — pop the detour (/pm:resume) before recording ` +
      "the verdict against it");
  }

  // `--amendments none` (any case) is the reconciler's EMPTY form (`AMENDMENTS: none`), and records
  // none — it used to be stored as the amendment `["none"]`. Otherwise split on `;` as documented.
  // `--amendment` repeats and each occurrence is ONE amendment, verbatim.
  const amendments = f.amendment !== undefined
    ? [].concat(f.amendment).filter(v => typeof v === "string" && v.trim() !== "")
    : typeof f.amendments === "string"
      ? (f.amendments.trim().toLowerCase() === "none"
        ? []
        : f.amendments.split(";").map(s => s.trim()).filter(Boolean))
      : [];

  // RE-RECORDING IS A CORRECTION, never an overwrite: a verdict already on the link moves to
  // `superseded` (one level deep, as a gate verdict's does) before the new one is written.
  const correction = !!link.reconciled;
  if (correction) link.superseded = link.reconciled;
  link.reconciled = { verdict, amendments, reconciledAt: new Date().toISOString() };
  // The flag is written AT THE VERDICT TRANSITION, from durable per-link records and the live stack —
  // verdict first, then flag. A correction never RAISES it: answering again says nothing new is owed.
  const stillOwed = ownedDetours(epic).length > 0 || liveReconcileFrame(state, id);
  epic.reconcileNeeded = correction ? (epic.reconcileNeeded === true && stillOwed) : stillOwed;

  const saved = saveState(state);
  render();
  reportSave(saved, {
    changed: `conductor: recorded reconcile verdict '${verdict}' for '${id}' vs '${detourId}'`,
    unchanged: `conductor: '${id}' already carried this exact reconcile verdict against ` +
      `'${detourId}' — ${STATE_UNCHANGED}`,
  });
}
