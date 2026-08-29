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
// THE ORDERING TRAP, and the reason both halves are ONE state object and ONE saveState:
// reconcileArchived() (epic-progress.mjs) clears `reconcileNeeded` on any epic that has no live
// frame and is not `state.active`. POP removes the frame BEFORE reconciliation runs, so the
// resumed epic is in exactly that window — and it survives only because it IS `state.active`.
// Setting the active pointer in a second write, or calling render() between the two, lets the
// self-heal erase the obligation the pop just created. See conductor-31's pop tests.
//
// One-directional dependencies only. Honcho memory is FORMATTED and LOGGED here and never sent:
// the engine is an instruction layer and never opens a network connection (see conductor.mjs).

import { isInitialized, loadState, saveState } from "./state.mjs";
import { parseFlags, requireFlagValues } from "./add-epic.mjs";
import { render } from "./render.mjs";
import { activate } from "./active-pointer.mjs";
import { deferralHistory, deferralNote } from "./links.mjs";
import { appendHonchoMemory } from "./subcommands.mjs";

const die = (msg) => { process.stderr.write(`conductor: ${msg}\n`); process.exit(1); };

const PUSH_USAGE =
  "usage: conductor.mjs push-detour <pausedEpicId> --detour <detourEpicId> --reason \"<why>\" " +
  "(--reconcile | --no-reconcile)\n";

/** Add a link once. The PUSH protocol writes two, and re-running a push that half-succeeded
 *  must not leave an epic carrying the same edge twice. Matched on type AND epic: an epic can
 *  legitimately hold two differently-typed links to the same other epic. */
function linkOnce(epic, type, otherId, reason) {
  epic.links = Array.isArray(epic.links) ? epic.links : [];
  if (epic.links.some(l => l && l.type === type && l.epic === otherId)) return;
  epic.links.push(reason ? { type, epic: otherId, reason } : { type, epic: otherId });
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
  if (!paused) die(`epic '${id}' not found`);
  if (paused.status === "archived") {
    die(`epic '${id}' is archived — an epic that has ended cannot be paused for a detour, and a ` +
      "frame naming it would never be resumable");
  }
  const detour = state.epics.find(e => e.id === detourId);
  if (!detour) {
    die(`detour epic '${detourId}' not found — register it first (\`add-epic --id ${detourId} ` +
      "…\`), so the frame cannot name work that does not exist");
  }
  if (detour.status === "archived") die(`detour epic '${detourId}' is archived — there is nothing left to build`);
  if (id === detourId) die("the paused epic and the detour cannot be the same epic");
  if ((state.detourStack || []).some(fr => fr && fr.pausedEpic === id)) {
    die(`epic '${id}' is already on the detour stack — resume it before pausing it again, or the ` +
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
  paused.reconcileNeeded = reconcileOnResume;
  state.detourStack = Array.isArray(state.detourStack) ? state.detourStack : [];
  state.detourStack.push({
    pausedEpic: id,
    pausedAt: new Date().toISOString(),
    reason,
    spawnedDetour: detourId,
    reconcileOnResume,
  });
  // The two links the PUSH protocol has always documented. `may-invalidate` is the one
  // record-reconcile hangs its verdict on (it creates it if absent — now it will not have to),
  // and deferralHistory() counts it, so writing it here is what makes the deferral disclosure
  // below true for a push that is later resumed and pushed again.
  linkOnce(paused, "may-invalidate", detourId, reason);
  linkOnce(detour, "resolves-blocker-for", id, reason);
  activate(state, detourId);

  saveState(state, { verb: "push-detour" });
  render();

  process.stderr.write(
    `conductor: paused '${id}' and made detour '${detourId}' active` +
    `${reconcileOnResume ? " — reconcile gate armed for /pm:resume" : " — NO reconcile on resume"}\n`);
  // gh#94's disclosure, now at the moment of the deferral itself rather than one step after it.
  // Computed from the POST-push state so the push being made is counted; silent on a first
  // deferral, because the first detour is the mechanism working.
  const note = deferralNote(deferralHistory(state, id));
  if (note) process.stderr.write(`conductor: \`${id}\` — ${note}\n`);
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
    die(`the top of the detour stack is '${pausedEpic}', not '${expected}' — the stack is LIFO, ` +
      `so resume '${pausedEpic}' first`);
  }
  const epic = state.epics.find(e => e.id === pausedEpic);
  if (!epic) die(`paused epic '${pausedEpic}' is not in the record — it cannot be resumed`);
  if (epic.status === "archived") {
    die(`paused epic '${pausedEpic}' is archived — it ended while parked, so there is nothing to ` +
      "resume. End the frame by removing the epic's pause deliberately rather than by popping it");
  }

  // ONE state object, ONE saveState, and the ORDER below is load-bearing — see this module's
  // header. The frame goes, the obligation is written, and the active pointer moves, before
  // anything reads the state back.
  stack.pop();
  state.detourStack = stack;
  if (frame.reconcileOnResume) epic.reconcileNeeded = true;
  activate(state, pausedEpic);

  saveState(state, { verb: "pop-detour" });
  render();

  const detourId = typeof frame.spawnedDetour === "string" ? frame.spawnedDetour : null;
  const detour = detourId ? state.epics.find(e => e.id === detourId) : null;
  if (detour && detour.status !== "archived") {
    process.stderr.write(
      `conductor: detour '${detourId}' is still ${detour.status}, not archived — resuming anyway, ` +
      "but confirm its work is finished and committed before building on the resumed epic\n");
  }
  process.stderr.write(`conductor: resumed '${pausedEpic}'\n`);
  if (frame.reconcileOnResume) {
    // The Honcho POP line says "reconciled vs X", which is not yet true. Emitting it here would
    // be the engine writing a claim nobody has made — the same defect the reconcile gate exists
    // to prevent — so the line is deferred to after the verdict, and the command that emits it
    // is named rather than left to memory.
    process.stderr.write(
      `conductor: RECONCILE GATE — '${pausedEpic}' carries reconcileNeeded. Run the reconciler ` +
      `BEFORE writing code, then \`record-reconcile ${pausedEpic} --detour ${detourId || "<detourId>"} ` +
      "--verdict valid|invalidated\`, then `honcho-memory pop " + pausedEpic +
      " \"<detour>; reconcile = …\"` for the memory line\n");
    return;
  }
  // Nothing to reconcile, so the resume is complete and the memory line is true now.
  appendHonchoMemory("pop", pausedEpic, detourId ? `${detourId}; no reconcile was required` : "no detour recorded");
}
