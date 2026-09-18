## ADDED Requirements

### Requirement: An epic holding a live detour frame does not archive through the interactive verb

The **interactive archive verb** — one of the five archive paths this capability enumerates — SHALL
refuse, writing nothing and exiting non-zero, to archive an epic that a live detour-stack frame
still names as its paused epic. The refusal SHALL name the frame's detour and the operation that
ends the frame.

**THE REFUSAL BINDS THE TRANSITION INTO `archived`, AND NOT AN INVOCATION AGAINST AN EPIC ALREADY
THERE.** The requirement *The interactive archive verb accepts an epic that is already archived* is
what makes the documented workflow's real disposition recordable at all: `/opsx:archive` moves the
change on disk, the drift heal flips the epic and stamps `outcome: unknown`, and the agent's record
is written by a later call to the same verb. That call is the **only** remaining moment at which a
real disposition can be recorded, and a parked epic reaches exactly that state by the heal path this
requirement deliberately leaves unbound. A refusal with no scope would therefore block the
correction path on precisely the population this change exists to rescue — and would do it while a
`drop-detour` performed afterwards left the epic stranded at `outcome: unknown` with no way back.
So where the epic's status is already `archived`, this arm SHALL NOT fire; every other demand the
archive gate makes of that invocation is unchanged.

An epic that ends while parked is a real event, and the record has no way to express it. The frame
survives the archive; the resume operation refuses it because there is nothing to resume; the
removal operation refuses it because the frame is control state it will not strip; and the stack is
last-in-first-out, so **every frame beneath it is unreachable as well**. The only exit is to
contradict the record — restore the epic to paused and resume it — which leaves an epic at a live
status carrying a terminal disposition, a record that says the work both ended and is under way.

**THE REFUSAL IS NOT SUFFICIENT ON ITS OWN AND SHALL NOT SHIP ON ITS OWN.** It prevents new jams and
does nothing for the ones already written, and the frame-ending operation the next requirement
defines is what both the refusal's message and an already-jammed record depend on. A guard shipped
without the operation its own message names is the defect class this change exists to close, applied
inside the change closing it.

**The other four archive paths are NOT bound by this refusal**, and the reason is the one this
capability already gives for the Gate 2 arm: the **archive-drift heal** reflects what is on disk,
and disk is the source of truth for OpenSpec, so a heal that refused would make the record
contradict reality to protect a stack. It therefore remains possible for the heal to archive a
parked epic, and that is precisely why the frame-ending operation must accept an epic that is
**already archived** — see the next requirement. The **archive backfill registration** and the two
**archived-at-creation paths** register epics that were never paused by this conductor.

#### Scenario: Archiving a parked epic through the interactive verb is refused

- **WHEN** an epic is paused by a live detour frame and the agent runs the interactive archive verb
  on it with a valid outcome, reason and deferral assertion
- **THEN** the command exits non-zero naming the detour the frame spawned and the operation that
  ends the frame, and the state of record is byte-identical to before the call

#### Scenario: Archiving an epic with no frame is unaffected

- **WHEN** an epic that no live detour frame names is archived through the interactive verb
- **THEN** the archive proceeds exactly as it does today

#### Scenario: An already-archived parked epic still records its real disposition

- **WHEN** the drift heal has flipped a parked epic to `archived` with `outcome: unknown`, its frame
  is still live, and the agent runs the interactive archive verb on it with `--status archived` and
  a real disposition
- **THEN** the call is accepted and the disposition is recorded — this arm does not fire on an epic
  whose status is already `archived`, and every other archive-gate demand binds that call unchanged

#### Scenario: The drift heal still archives a parked epic

- **WHEN** the change directory for a parked openspec-lane epic appears under
  `openspec/changes/archive/` and the archive-drift heal runs
- **THEN** the epic's status becomes `archived` and the frame survives, because the record must not
  contradict disk — and the resulting state is exitable by the frame-ending operation rather than
  by restoring a status the record says has ended

### Requirement: A detour frame is ended by a verb, and ending one is not answering the reconcile it armed

Pausing an epic for a detour SHALL have an inverse other than resuming it. A **frame-drop
operation** SHALL remove a named epic's detour-stack frame, carrying a **non-empty reason**, for the
case the resume path cannot serve: the paused epic is not coming back.

It SHALL differ from the resume operation in exactly the ways that case demands, and the differences
are the requirement:

- It SHALL remove **the frame naming that epic wherever it sits in the stack**, not only the top
  frame. A jam buried under later frames is the case that has no other exit, and a
  last-in-first-out-only operation would leave it stuck. An epic is named by at most one live frame,
  so the frame to remove is unambiguous.
- It SHALL NOT make the epic active and SHALL NOT change its status. The epic ended, or is ending;
  resuming it is what the resume operation is for.
- It SHALL accept an epic whose status is **already archived**, because that is the state a jammed
  record is already in and the state the drift heal can still produce. An operation that refused
  there would leave every existing jam with no exit, which is what this requirement is for.
- It SHALL **end** the reconcile obligation the push armed against that detour rather than leaving
  it owed: an obligation that can never be answered blocks the epic's removal and is reported
  forever as a verdict somebody owes.

**ENDING AN OBLIGATION IS NOT ANSWERING IT, and the record SHALL NOT let the two be confused.** The
frame-drop SHALL NOT write a reconcile verdict. What it records is that the obligation was dropped,
with its reason and the detour it was owed against, kept on the record beside any verdict the epic
carries — the same shape a withdrawn gate verdict takes. A dropped obligation SHALL NOT be reported
as owed, and SHALL NOT be reported as reconciled.

The operation SHALL be refused, writing nothing and exiting non-zero, when the named epic holds no
live frame, and when no reason is supplied.

#### Scenario: A jammed frame is dropped and the stack is usable again

- **WHEN** two frames are pushed, the epic named by the top frame is archived, and the frame-drop
  operation names that epic with a reason
- **THEN** the command exits zero, that frame is gone, the frame beneath is now the top of the
  stack, and resuming **the epic that lower frame pauses** succeeds — the dropped epic is archived
  and is never resumed by this operation

#### Scenario: A buried frame is dropped without disturbing the frames above it

- **WHEN** two frames are pushed and the frame-drop operation names the epic of the **lower** frame
- **THEN** the command exits zero, the lower frame is gone, the upper frame is still on the stack
  unchanged, and the operation does not behave as a last-in-first-out pop

#### Scenario: Dropping a frame does not resume or revive the epic

- **WHEN** the frame-drop operation is run on a paused epic
- **THEN** the epic's status is unchanged and it is not made the active epic — the record does not
  claim work restarted

#### Scenario: An already-archived epic's frame is droppable

- **WHEN** the frame-drop operation names an epic whose status is already `archived` and which a
  live frame still pauses
- **THEN** the command exits zero and the frame is removed, so a record already in this state has an
  exit that does not require contradicting its own disposition

#### Scenario: A dropped frame's reconcile obligation is ended, not answered

- **WHEN** a frame pushed with reconcile-on-resume is dropped with a reason
- **THEN** the epic is no longer reported as owing a reconcile verdict against that detour, the
  record shows the obligation as dropped with that reason rather than as reconciled, and no
  reconcile verdict is written

#### Scenario: Removing the epic afterwards is no longer blocked

- **WHEN** an epic whose frame and reconcile obligation have both been dropped is removed
- **THEN** the removal is not blocked by a detour-stack reference or by an owed reconcile obligation

#### Scenario: Dropping a frame for an epic that has none is refused

- **WHEN** the frame-drop operation names an epic that no live frame pauses
- **THEN** the command exits non-zero saying so, and the state of record is byte-identical to before
  the call

#### Scenario: Dropping a frame without a reason is refused

- **WHEN** the frame-drop operation is supplied with no reason, or an empty one
- **THEN** the command exits non-zero, and the state of record is byte-identical to before the call

### Requirement: The record reports a stored value that cannot be true — a reference naming itself, and a reference or a grant naming nothing

The read-only integrity surface this capability defines SHALL additionally report three shapes of
stored value that cannot be true, each with the epic it concerns and the field that holds it. All
three are reported and not repaired, on the same contract as every other check there.

1. **A self-referential reference** — a stored epic id whose value is the id of the epic that holds
   it. It reads as a relationship to another record and conveys nothing, and a self-referential
   `carriedTo` satisfies the archive gate's handoff obligation while leaving the work it names owned
   by a record that ended.
2. **A reference whose id is empty** — a stored epic id whose value is an empty string.
3. **A grant that names nothing** — an autonomy pre-authorization whose action and whose category
   are both empty. Unlike the two above it is not a reference, and it is here for the reason the
   other two are: it is already on disk, the write-time refusal `epic-autonomy` requires binds only
   writes that have not happened, and no revoke can name a value that is empty. The report is the
   only surface that sees it.

**Items 1 and 2 SHALL cover the SAME set of fields, and that set SHALL be the single declared
enumeration of epic-id-holding fields the record already keeps** — a `carriedTo`, a superseded
`carriedTo`, a deferral assertion's epic, a release deferral's epic, a link's epic, a parent, the
active pointer. Two checks over two hand-written lists of holders is the sibling-site defect this
change exists to close, and a self-reference is no less false in a deferral than in a `carriedTo`.

**That enumeration SHALL be value-agnostic.** Today's declaration emits a holder only where the
stored value is a non-empty string, so a check driven from what it emits can never see an empty id —
the shape item 2 exists to report. The declaration SHALL therefore enumerate the holder whatever its
value, and each consumer SHALL apply its own predicate to the value: the existing dangling-reference
check keeps skipping an empty value, the reference sweep that strips a removed epic's mentions keeps
behaving exactly as it does today, and the new checks report precisely the values those consumers
pass over. A finding SHALL be reported by exactly one check — an empty id is item 2 and never a
dangling reference, an unknown non-empty id is a dangling reference and never item 2.

Every one of the three is reported **in addition to**, and not in place of, the write-time refusals
the `epic-disposition` and `epic-autonomy` capabilities require. The two are not redundant and
neither substitutes for the other: a refusal binds a write that has not happened yet, and does
nothing for the records already on disk, which is where all three of these were found. The existing
dangling-reference check cannot see any of them — an empty string names no epic, so "names an epic
the record does not hold" passes over it by construction; a self-reference names an epic the record
demonstrably does hold; and a grant is not a reference at all.

#### Scenario: A self-referential handoff is reported

- **WHEN** the integrity surface runs over a record holding an epic whose `carriedTo` is that epic's
  own id
- **THEN** it reports that epic and the field, and does not modify the record

#### Scenario: An empty deferral reference is reported

- **WHEN** the integrity surface runs over a record holding a deferral assertion whose epic half is
  an empty string
- **THEN** it reports that epic and the field, and does not modify the record

#### Scenario: A self-referential deferral is reported

- **WHEN** the integrity surface runs over a record holding a deferral assertion whose epic half is
  the id of the epic that holds the assertion
- **THEN** it reports that epic and the field, on the same footing as a self-referential `carriedTo`

#### Scenario: A grant naming nothing is reported

- **WHEN** the integrity surface runs over a record holding an epic whose autonomy carries a
  pre-authorization with an empty action and no category
- **THEN** it reports that epic and the grant, and does not modify the record

#### Scenario: An unknown id is reported once, as a dangling reference and not as an empty one

- **WHEN** the integrity surface runs over a record holding a `carriedTo` naming a non-empty id no
  epic carries
- **THEN** the existing dangling-reference check reports it exactly once and the empty-id check
  reports nothing for it

#### Scenario: A valid reference is not reported

- **WHEN** the integrity surface runs over a record whose stored references all name other epics the
  record holds, and whose grants all name an action or a category
- **THEN** none of the three checks reports a finding

## MODIFIED Requirements

### Requirement: A reconcile obligation survives until a verdict answers it

`reconcileNeeded` SHALL NOT be set false by any write other than an accepted `record-reconcile`,
with the two exceptions below. Moving the active pointer — `set-active`, `clear-active`,
`update-epic --status`, or creating an epic at `active` — every run of the archive-drift heal, and
archiving the epic MUST leave it as it was. `gate-guard` does not block on an archived epic, as today,
but an archived epic that owes a reconcile is otherwise still bound by it — the refusals of "A write
never destroys the record of an owed reconcile" still apply — and an epic returned from `archived`
to any other status still owes every armed detour left unanswered. An owing epic whose work ended
records its verdict like any other: an `invalidated` verdict is the truthful answer for work that
will not resume.

**The one exception: an obligation with nothing to answer it against.** Where an epic owes a
reconcile, holds no armed `may-invalidate` link (answered or not) and no unmigrated one, and no frame
pausing it is on the stack, no `record-reconcile`
invocation can be accepted, so the obligation would block the epic permanently. The archive-drift
heal SHALL clear it and state on stderr that it did, naming the epic. The engine after this change
cannot produce that state — pushing arms a link, and removing an armed link is refused below — so it
arises only from a hand-edited state file or from the migration tradeoff above.

**The second exception: an obligation whose frame was dropped rather than answered.** The
frame-drop operation this capability defines SHALL clear `reconcileNeeded` where, after the drop,
the epic owes nothing any `record-reconcile` could answer. This is an exception and not a loophole,
and three properties make it one. It is **reason-bearing**: the drop refuses without a non-empty
reason, so unlike a pointer move it records why the obligation ended, and the record distinguishes
*dropped* from *answered* — no reconcile verdict is written. It **disarms rather than removes**: the
`may-invalidate` link stays on the epic carrying its drop stamp, so "A write never destroys the
record of an owed reconcile" binds this write unchanged and the evidence that an obligation existed
survives it. And it clears the flag **in the same write** that disarms the link and removes the
frame, so the first exception's precondition — an epic owing a reconcile with no armed link and no
frame — is still unreachable between two writes, and that exception's claim that the engine cannot
produce that state remains true.

The frame-drop moves no pointer and changes no status, so the stderr-warning paragraph below is
unaffected and its `push-detour` exemption needs no companion.

Because the obligation survives, `gate-guard` SHALL block again whenever the owing epic is the active
epic once more.

A verb that moves the active pointer off an epic owing a reconcile SHALL complete as it normally would and SHALL state on stderr that the epic
still owes a reconcile, naming the detours it owes. The only exemption is `push-detour` moving the
pointer off the epic it parks; `pop-detour` moving it off a detour that itself owes a reconcile is
not exempt. It is a warning and not a refusal: refusing would
leave no CLI route to set work aside, which is the hand-edit the detour verbs exist to remove.

#### Scenario: Clearing the active pointer does not erase the obligation

- **WHEN** `p` owes a reconcile and is active, and `clear-active` runs followed by `render`
- **THEN** `p` still owes a reconcile, and stderr of `clear-active` names `p` and the owed detour

#### Scenario: Activating another epic and returning restores the block

- **WHEN** `p` owes a reconcile and is active, `set-active other` runs, then `set-active p` runs
- **THEN** `p` still owes a reconcile and `gate-guard` exits 2

#### Scenario: A status change on another epic does not erase the obligation

- **WHEN** `p` owes a reconcile and is active, and `update-epic other --status active` runs
- **THEN** `p` still owes a reconcile, and stderr of that command names `p` and the owed detour

#### Scenario: Creating an epic at active warns

- **WHEN** `p` owes a reconcile and is active, and `add-epic --id q --title q --lane claude-code --status active` runs
- **THEN** `p` still owes a reconcile, and stderr of that command names `p` and the owed detour

#### Scenario: Archiving and un-archiving does not erase the obligation

- **WHEN** `p` owes a reconcile against armed detour `d`, `update-epic p --status archived --outcome
  abandoned --reason r --no-deferrals` runs, then `update-epic p --status active` runs
- **THEN** `p` still owes a reconcile against `d` and `gate-guard` exits 2

#### Scenario: An archived owing epic is not blocked

- **WHEN** an epic that owes a reconcile is archived with a recorded disposition
- **THEN** `gate-guard` does not block on it

#### Scenario: An obligation with no link to answer is cleared, and says so

- **WHEN** a state file holds active epic `p` with `reconcileNeeded: true`, no detour-stack frame,
  and no `may-invalidate` link other than one carrying a false arming record, and `render` runs
- **THEN** `p` no longer owes a reconcile, and stderr names `p`

#### Scenario: A pointer move does not trigger that exception

- **WHEN** `p` owes a reconcile against armed detour `d`, and `clear-active` then `render` run
- **THEN** `p` still owes a reconcile, because it holds a link a verdict can be recorded against

#### Scenario: A dropped frame's obligation is cleared by the drop itself

- **WHEN** `p` owes a reconcile against armed detour `d` and the frame pausing `p` is dropped with a
  reason
- **THEN** `p` no longer owes a reconcile, the `may-invalidate` link to `d` is still present on `p`
  carrying the drop and its reason, no reconcile verdict is written against `d`, and `gate-guard`
  no longer blocks on `p`

#### Scenario: A drop leaves an obligation an earlier detour still owes

- **WHEN** `p` carries two armed `may-invalidate` links from two successive detours, the earlier one
  unanswered, and the frame pausing `p` for the later detour is dropped with a reason
- **THEN** `p` still owes a reconcile, because a verdict can still be recorded against the earlier
  detour — the drop ends the obligation it names and no other
