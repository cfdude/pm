// scripts/lib/detour-stack.mjs
// The substantial-detour PUSH and POP — gh#151.
//
// WHAT WAS HERE BEFORE: nothing. `log-detour` existed for the MINIMAL case, and the substantial
// PUSH was a documented HAND-EDIT of `.conductor/state.json` (commands/detour.md step 2), with
// POP the same hand-edit in reverse (commands/resume.md step 2). So the state of record's most
// consequential transition — parking one piece of work to build another — was performed by the
// one mechanism this project tells every agent never to use, and none of the engine's guarantees
// applied to it: no validation that the paused epic exists, no non-empty reason, no deliberate
// `reconcileOnResume`, no write-conflict guard, no read-back verification, and no record that
// the transition happened at all beyond whatever the agent chose to type.
//
// POP NEEDED IT TOO, and #151 flags that as worth checking rather than assuming. It does:
// `/pm:resume` runs the engine at step 3 (`record-reconcile`) and step 4 (`honcho-memory pop`),
// and NEITHER removes a frame — `record-reconcile` writes a verdict onto a link and clears
// `reconcileNeeded`. `rg detourStack scripts/` finds only readers. The pop itself was step 2's
// hand-edit, so fixing PUSH alone would have left the identical sibling site untouched.
//
// ONE state object and ONE saveState for both halves. The ORDERING TRAP this paragraph used to
// describe — reconcileArchived() clearing `reconcileNeeded` on any epic with no live frame that was
// not `state.active`, so a pop survived only because it set the pointer in the same write — is GONE
// (gates-bind-to-verified-evidence Decision 4): the heal no longer clears on pointer or status, and
// the obligation is recorded per detour on the paused epic's `may-invalidate` link, armed at PUSH.
// The heal's one remaining clear is an owing epic holding no armed or unmigrated link and no frame
// — nothing a verdict could answer — and a push always arms the link first. One write is still the
// right shape: a transition half-written is a record that disagrees with itself.
//
// One-directional dependencies only. Honcho memory is FORMATTED and LOGGED here and never sent:
// the engine is an instruction layer and never opens a network connection (see conductor.mjs).

import { isInitialized, loadState, saveState } from "./state.mjs";
import { reportSave, STATE_UNCHANGED } from "./save-report.mjs";
import { parseFlags, requireFlagValues } from "./add-epic.mjs";
import { printedId, escapeControls, orNoRemedy } from "./constants.mjs";
import { render } from "./render.mjs";
import { activate, owedReconcileNotice } from "./active-pointer.mjs";
import { deferralHistory, deferralNote, isArmed, liveReconcileFrame, ownedDetours } from "./links.mjs";
import { appendHonchoMemory } from "./subcommands.mjs";

const die = (msg) => { process.stderr.write(`conductor: ${msg}\n`); process.exit(1); };

const PUSH_USAGE =
  "usage: conductor.mjs push-detour <pausedEpicId> --detour <detourEpicId> --reason \"<why>\" " +
  "(--reconcile | --no-reconcile)\n";

/** Add a link once. The PUSH protocol writes two, and re-running a push that half-succeeded
 *  must not leave an epic carrying the same edge twice. Matched on type AND epic: an epic can
 *  legitimately hold two differently-typed links to the same other epic. */
function linkOnce(epic, type, otherId, reason, { arm } = {}) {
  epic.links = Array.isArray(epic.links) ? epic.links : [];
  const found = epic.links.find(l => l && l.type === type && l.epic === otherId);
  if (type !== "may-invalidate") {
    if (!found) epic.links.push(reason ? { type, epic: otherId, reason } : { type, epic: otherId });
    return;
  }
  // THE ARMING RECORD (gates-bind-to-verified-evidence Decision 1), applied to the link this push
  // CREATES or FINDS — it used to return early on an existing link, so a re-push wrote nothing.
  //   --reconcile on a new link: armed. On an existing one: armed, and a verdict it already carries
  //     moves to `superseded` (RE-ARM) so the new pause owes a new verdict and the earlier one stays
  //     readable. An explicit arming is a fact, so an unmigrated link is armed too.
  //   --no-reconcile on a new link: false. On an existing one: NOTHING — it never lowers a true
  //     record, and it never writes a key onto an unmigrated link, which would be a guess.
  if (!found) {
    const link = reason ? { type, epic: otherId, reason } : { type, epic: otherId };
    link.reconcileOnResume = arm === true;
    epic.links.push(link);
    return;
  }
  if (arm !== true) return;
  if (found.reconciled) {
    found.superseded = found.reconciled;
    delete found.reconciled;
  }
  found.reconcileOnResume = true;
}

/** `push-detour <pausedEpicId> --detour <detourEpicId> --reason "<why>" (--reconcile |
 *  --no-reconcile)` — park the current epic and make the detour active, in one guarded write.
 *
 *  THE RECONCILE DECISION IS SAID, NEVER DEFAULTED. `--reconcile` and `--no-reconcile` are both
 *  required to be present, exactly one of them, on the precedent `--no-deferrals` set: the
 *  archive gate refuses a disposition with no deferral assertion precisely so that "there are
 *  none" has to be CLAIMED and cannot be arrived at by forgetting. #151 asks for
 *  `reconcileOnResume` to be written "deliberately rather than by hand", and a default is the
 *  one thing that is not deliberate. A default-on reading is defensible on safety grounds — a
 *  forgotten flag would give you the gate — but it makes an absent decision indistinguishable
 *  from a considered one, and `reconcileOnResume` is the flag whose whole documented property is
 *  that it must survive until reconciliation completes. A mistaken `--no-reconcile` is at least
 *  attributable; a forgotten default is not. */
export function pushDetour() {
  if (!isInitialized()) die("run /pm:init first");
  const argv = process.argv.slice(3);
  const id = argv[0] && !argv[0].startsWith("--") ? argv[0] : undefined;
  const f = parseFlags(id ? argv.slice(1) : argv);
  // Before loadState(), so a refusal can never leave a partial write behind — the same position
  // every other write surface calls this from.
  requireFlagValues("push-detour", f);

  const detourId = typeof f.detour === "string" ? f.detour : undefined;
  const reason = typeof f.reason === "string" ? f.reason.trim() : "";
  if (!id || !detourId || !reason) { process.stderr.write(PUSH_USAGE); process.exit(1); }

  const yes = f.reconcile === true;
  const no = f["no-reconcile"] === true;
  if (yes === no) {
    die("push-detour requires exactly one of --reconcile or --no-reconcile — whether the detour " +
      "can invalidate the paused epic's plan is a judgment, and a default would make an absent " +
      "decision look like a considered one. Say --reconcile unless you are certain the detour " +
      "touches nothing the paused epic depends on");
  }
  const reconcileOnResume = yes;

  const state = loadState();
  const paused = state.epics.find(e => e.id === id);
  if (!paused) die(`epic '${escapeControls(id)}' not found`);
  if (paused.status === "archived") {
    die(`epic '${escapeControls(id)}' is archived — an epic that has ended cannot be paused for a detour, and a ` +
      "frame naming it would never be resumable");
  }
  const detour = state.epics.find(e => e.id === detourId);
  if (!detour) {
    die(`detour epic '${escapeControls(detourId)}' not found — register it first (` + orNoRemedy(() => `\`add-epic --id ${printedId(detourId)} ` +
      "…\`") + "), so the frame cannot name work that does not exist");
  }
  if (detour.status === "archived") die(`detour epic '${escapeControls(detourId)}' is archived — there is nothing left to build`);
  if (id === detourId) die("the paused epic and the detour cannot be the same epic");
  if ((state.detourStack || []).some(fr => fr && fr.pausedEpic === id)) {
    die(`epic '${escapeControls(id)}' is already on the detour stack — resume it before pausing it again, or the ` +
      "stack holds two frames whose pops would contradict each other");
  }

  // `role: "detour"` was part of the hand-edit the protocol documented, and `add-epic` has no
  // `--role` flag — which is exactly why the old SKILL.md offered "or edit `state.json`
  // directly". Replacing the hand-edit without this would have registered every detour as
  // `role: "epic"`, which silently costs two things: `detourContext()` (links.mjs) falls back to
  // `cur.role === "detour"` when no frame is live, and PROJECT.md prints the role column. Set
  // HERE rather than at registration because this verb is the moment an epic BECOMES a detour.
  detour.role = "detour";
  paused.status = "paused";
  // Set at the TRANSITION, not derived. reconcileArchived() re-derives it from the live frame
  // while the frame exists, so the two agree here; what makes writing it necessary is POP, where
  // the frame is gone and the flag must survive anyway.
  //
  // ORed, never assigned (gates-bind-to-verified-evidence Decision 6). Assigning let a later
  // `--no-reconcile` push overwrite an obligation still owed against an earlier detour, and the pop
  // that followed then logged "no reconcile was required" — a false record of an answer nobody gave.
  const alreadyOwed = paused.reconcileNeeded === true;
  paused.reconcileNeeded = alreadyOwed || reconcileOnResume;
  state.detourStack = Array.isArray(state.detourStack) ? state.detourStack : [];
  state.detourStack.push({
    pausedEpic: id,
    pausedAt: new Date().toISOString(),
    reason,
    spawnedDetour: detourId,
    reconcileOnResume,
  });
  // The two links the PUSH protocol has always documented. `may-invalidate` is the one
  // record-reconcile hangs its verdict on (it never creates one — the arming record is written here),
  // and deferralHistory() counts it, so writing it here is what makes the deferral disclosure
  // below true for a push that is later resumed and pushed again.
  linkOnce(paused, "may-invalidate", detourId, reason, { arm: reconcileOnResume });
  linkOnce(detour, "resolves-blocker-for", id, reason);
  activate(state, detourId);

  const saved = saveState(state, { verb: "push-detour" });
  render();

  // "NO reconcile on resume" only where NOTHING is owed: a --no-reconcile push on an epic that still
  // owes an earlier verdict says so, naming the detours it owes.
  const owedBefore = ownedDetours(paused);
  const pushReport = reconcileOnResume
    ? " — reconcile gate armed for /pm:resume"
    : alreadyOwed
      ? ` — no reconcile for '${escapeControls(detourId)}'; '${escapeControls(id)}' still owes a reconcile` +
        (owedBefore.length ? ` against ${owedBefore.map(d => `'${escapeControls(d)}'`).join(", ")}` : "")
      : " — NO reconcile on resume";
  reportSave(saved, {
    changed: `conductor: paused '${escapeControls(id)}' and made detour '${escapeControls(detourId)}' active${pushReport}`,
    // A frame carries `pausedAt`, so a PUSH always differs from disk. Bound rather than
    // exempted for the same reason add-epic is: the argument for "cannot no-op" is about
    // today's frame shape, not about this verb.
    unchanged: `conductor: '${escapeControls(id)}' was already paused for detour '${escapeControls(detourId)}' on exactly these ` +
      `terms — ${STATE_UNCHANGED}`,
  });
  // gh#94's disclosure, now at the moment of the deferral itself rather than one step after it.
  // Computed from the POST-push state so the push being made is counted; silent on a first
  // deferral, because the first detour is the mechanism working.
  const note = deferralNote(deferralHistory(state, id));
  if (note) process.stderr.write(`conductor: \`${escapeControls(id)}\` — ${note}\n`);
  // Step 3 of the old protocol, no longer a step: the ready-to-copy Honcho line is emitted here
  // and logged durably, so the pivot survives outside this repo without a second invocation the
  // agent has to remember. stdout, because it is a line the agent pastes verbatim.
  appendHonchoMemory("push", id, reason);
}

/** `pop-detour [<expectedPausedEpicId>]` — resume the epic at the top of the stack.
 *
 *  The optional positional is an ASSERTION, not a selector: the stack is LIFO and pops the top
 *  frame whatever you pass, so naming an epic that is not on top is refused rather than
 *  quietly popping a different one.
 *
 *  It deliberately does NOT refuse when the detour epic is unarchived. `/pm:resume` step 1 asks
 *  the agent to confirm the detour is finished, and that is a judgment; refusing here would
 *  leave a stack whose detour epic was removed or renamed with no CLI way out, which re-creates
 *  the hand-edit this verb exists to remove. It warns, which is the honest shape. */
export function popDetour() {
  if (!isInitialized()) die("run /pm:init first");
  const argv = process.argv.slice(3);
  const expected = argv[0] && !argv[0].startsWith("--") ? argv[0] : undefined;

  const state = loadState();
  const stack = Array.isArray(state.detourStack) ? state.detourStack : [];
  if (!stack.length) die("the detour stack is empty — there is nothing paused to resume");
  const frame = stack[stack.length - 1];
  const pausedEpic = frame && typeof frame.pausedEpic === "string" ? frame.pausedEpic : undefined;
  if (!pausedEpic) {
    die("the top detour-stack frame names no paused epic — it cannot be resumed, and popping it " +
      "would discard the only record that something was parked");
  }
  if (expected && expected !== pausedEpic) {
    die(`the top of the detour stack is '${escapeControls(pausedEpic)}', not '${escapeControls(expected)}' — the stack is LIFO, ` +
      `so resume '${escapeControls(pausedEpic)}' first`);
  }
  const epic = state.epics.find(e => e.id === pausedEpic);
  if (!epic) die(`paused epic '${escapeControls(pausedEpic)}' is not in the record — it cannot be resumed`);
  if (epic.status === "archived") {
    die(`paused epic '${escapeControls(pausedEpic)}' is archived — it ended while parked, so there is nothing to ` +
      "resume. End the frame by removing the epic's pause deliberately rather than by popping it");
  }

  // ONE state object, ONE saveState, and the ORDER below is load-bearing — see this module's
  // header. The frame goes, the obligation is written, and the active pointer moves, before
  // anything reads the state back.
  stack.pop();
  state.detourStack = stack;
  if (frame.reconcileOnResume) epic.reconcileNeeded = true;
  const previousActive = state.active;
  activate(state, pausedEpic);

  const saved = saveState(state, { verb: "pop-detour" });
  // NOT exempt: the pointer moves off the DETOUR, and a detour can itself owe a reconcile.
  owedReconcileNotice(state, previousActive);
  render();

  const detourId = typeof frame.spawnedDetour === "string" ? frame.spawnedDetour : null;
  const detour = detourId ? state.epics.find(e => e.id === detourId) : null;
  if (detour && detour.status !== "archived") {
    process.stderr.write(
      `conductor: detour '${escapeControls(detourId)}' is still ${escapeControls(detour.status)}, not archived — resuming anyway, ` +
      "but confirm its work is finished and committed before building on the resumed epic\n");
  }
  reportSave(saved, {
    changed: `conductor: resumed '${escapeControls(pausedEpic)}'`,
    unchanged: `conductor: '${escapeControls(pausedEpic)}' was already resumed on exactly these terms — ` +
      `${STATE_UNCHANGED}`,
  });
  // READ BACK AFTER render(): its heal can clear an obligation nothing could answer (a hand-set flag
  // over a --no-reconcile frame) and save that, so deciding from the copy loaded before it printed a
  // RECONCILE GATE instruction the engine then refuses (Gate 2 re-review, minor 2).
  const resumed = loadState().epics.find(e => e && e.id === pausedEpic) || epic;
  if (resumed.reconcileNeeded === true) {
    // The Honcho POP line says "reconciled vs X", which is not yet true. Emitting it here would
    // be the engine writing a claim nobody has made — the same defect the reconcile gate exists
    // to prevent — so the line is deferred to after the verdict, and the command that emits it
    // is named rather than left to memory.
    //
    // Keyed on the EPIC'S obligation after the pop, not on this frame (Decision 6): an earlier
    // armed detour still unanswered owes a verdict whatever this frame said, and every owed detour
    // is named — not only the one just popped.
    const owed = ownedDetours(resumed);
    const targets = owed.length ? owed : [detourId || "<detourId>"];
    process.stderr.write(
      `conductor: RECONCILE GATE — '${escapeControls(pausedEpic)}' carries reconcileNeeded` +
      (owed.length ? ` and owes a verdict against ${owed.map(d => `'${escapeControls(d)}'`).join(", ")}` : "") +
      ". Run the reconciler BEFORE writing code, then " +
      [...new Set(targets.map(d => orNoRemedy(() => `\`record-reconcile ${printedId(pausedEpic)} --detour ${printedId(d)} --verdict valid|invalidated\``)))].join(", ") +
      ", then " + orNoRemedy(() => "`honcho-memory pop " + printedId(pausedEpic) + " \"<detour>; reconcile = …\"`") + " for the memory line\n");
    return;
  }
  // Nothing to reconcile, so the resume is complete and the memory line is true now.
  appendHonchoMemory("pop", pausedEpic, detourId ? `${detourId}; no reconcile was required` : "no detour recorded");
}

const DROP_USAGE = "usage: conductor.mjs drop-detour <pausedEpicId> --reason \"<why>\"\n";

/** `drop-detour <pausedEpicId> --reason "<why>"` — THE INVERSE `push-detour` NEVER SHIPPED.
 *
 *  `pop-detour` is not it. Resuming an epic and recording that it is not coming back differ in every
 *  observable way — which frame is selected, whether the active pointer moves, whether the status
 *  changes, whether an obligation is armed or ended — so this is a verb and not a `--force` flag on
 *  the pop, which would make the two one operation with a modifier.
 *
 *  Four properties are load-bearing, each one a requirement rather than an implementation choice:
 *
 *  SELECTS BY EPIC, NOT BY POSITION. `push-detour` already refuses to pause an epic that is on the
 *  stack, so at most one frame names a given epic and the selection is unambiguous. A
 *  last-in-first-out-only drop would leave a BURIED jam stuck, which is the condition being fixed.
 *
 *  NEVER ACTIVATES AND NEVER CHANGES STATUS. The epic ended, or is ending; resuming it is what
 *  `pop-detour` is for. Nothing here touches `state.active`, so the stderr owed-reconcile warning
 *  that binds every pointer move has nothing to say about this verb.
 *
 *  ACCEPTS AN ALREADY-ARCHIVED EPIC. That is the state every existing jam is already in, and the
 *  state the drift heal can still produce — the heal reflects disk and is deliberately unbound by
 *  the archive refusal. An operation that refused there would leave every existing jam with no exit,
 *  which is the whole point.
 *
 *  ENDS THE RECONCILE OBLIGATION THE PUSH ARMED — and ENDING ONE IS NOT ANSWERING IT. No reconcile
 *  verdict is written. The `may-invalidate` link is DISARMED and kept, carrying a drop stamp
 *  (`droppedAt` + the reason), so the record distinguishes *dropped* from *answered* and "A write
 *  never destroys the record of an owed reconcile" binds this write unchanged.
 *
 *  ONE saveState for all of it. The flag is recomputed by the SAME rule reconciler-writeback applies
 *  at its verdict transition — `ownedDetours(epic).length > 0 || liveReconcileFrame(state, id)` —
 *  never by a rule written fresh here, and in the SAME write that removes the frame and disarms the
 *  link, so the heal's "an obligation with nothing to answer it" precondition is never reachable
 *  between two writes and that exception's claim that the engine cannot produce the state stays true. */
export function dropDetour() {
  // NOTHING IS SHARED WITH popDetour() AND THAT IS THE ANSWER TO "factor it once", not an omission
  // (task 3.10). Their frame SELECTION rules are opposites by requirement — the pop takes the top
  // and treats its positional as an assertion about what the top is; the drop takes the frame naming
  // the epic wherever it sits, because a buried jam is the case with no other exit — so a shared
  // selector would have to carry a mode flag, which is the `--force`-on-pop shape design Decision 3
  // rejects, one level down. Their LINK handling does not overlap either: the pop touches no link at
  // all, it re-raises `reconcileNeeded` from the frame it popped. The one rule they genuinely share —
  // "is anything still owed" — is already factored, in links.mjs, and both read it from there.
  if (!isInitialized()) die("run /pm:init first");
  const argv = process.argv.slice(3);
  const id = argv[0] && !argv[0].startsWith("--") ? argv[0] : undefined;
  const f = parseFlags(id ? argv.slice(1) : argv);
  // Before loadState(), the position every other write surface here calls it from.
  requireFlagValues("drop-detour", f);
  const reason = typeof f.reason === "string" ? f.reason.trim() : "";
  if (!id || !reason) { process.stderr.write(DROP_USAGE); process.exit(1); }

  const state = loadState();
  const frames = Array.isArray(state.detourStack) ? state.detourStack : [];
  const at = frames.findIndex(fr => fr && fr.pausedEpic === id);
  if (at === -1) {
    die(`no live detour-stack frame pauses '${escapeControls(id)}' — there is no pause to end. ` +
      orNoRemedy(() => "`pop-detour`") + " resumes the epic at the top of the stack; this verb ends a " +
      "frame for an epic that is not coming back");
  }
  const frame = frames[at];
  const epic = state.epics.find(e => e.id === id);
  // DELIBERATELY NOT REFUSED on an archived epic: that is the state an existing jam is in.

  const detourId = typeof frame.spawnedDetour === "string" ? frame.spawnedDetour : undefined;
  const droppedAt = new Date().toISOString();
  frames.splice(at, 1);
  state.detourStack = frames;
  if (epic) {
    // DISARM, never remove. Removing an armed link on an owing epic is refused by gate-integrity's
    // "A write never destroys the record of an owed reconcile", and that refusal binds this write
    // unchanged — the evidence that an obligation existed has to survive the obligation ending.
    const link = (Array.isArray(epic.links) ? epic.links : [])
      .find(l => isArmed(l) && l.epic === detourId && !l.reconciled);
    if (link) {
      link.reconcileOnResume = false;
      link.dropped = { reason, droppedAt };
    }
    // THE SAME SPELLING reconciler-writeback uses at its verdict transition, imported from the module
    // that exports both — two spellings of "is anything still owed" is the sibling-site defect this
    // change is about. An EARLIER detour still unanswered keeps the obligation, which is correct: the
    // drop ends the obligation it names and no other.
    if (epic.reconcileNeeded === true) {
      epic.reconcileNeeded = ownedDetours(epic).length > 0 || liveReconcileFrame(state, id);
    }
  }

  const saved = saveState(state, { verb: "drop-detour" });
  render();
  reportSave(saved, {
    changed: `conductor: dropped the detour frame pausing '${escapeControls(id)}'` +
      (detourId ? ` for detour '${escapeControls(detourId)}'` : "") +
      (frame.reconcileOnResume
        ? " — the reconcile obligation it armed is ENDED, not answered: no verdict was written, and " +
          "the may-invalidate link keeps its record carrying the drop and this reason"
        : "") +
      `. '${escapeControls(id)}' is not resumed and its status is unchanged`,
    // A frame carries `pausedAt`, so removing one always differs from disk; the no-op branch is
    // bound rather than exempted, on the same reasoning push-detour's is.
    unchanged: `conductor: '${escapeControls(id)}' held no frame to drop — ${STATE_UNCHANGED}`,
  });
}
