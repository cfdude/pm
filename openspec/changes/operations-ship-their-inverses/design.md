## Context

See proposal.md — Why for the three defects and the repro that reproduces each against 0.45.0.

The relevant current state, verified from disk on 2026-09-17:

- `scripts/lib/autonomy.mjs` — `setAutonomy()` appends to `a.preAuthorized` and never subtracts.
  `getAutonomy()` is documented as the ONLY place that reads `epic.autonomy` directly; `render.mjs`
  and `briefing.mjs` call it, and both read **only `level`** (a `🤖` marker). **No surface renders
  the grants at all**, which is the mechanical reason a silent restore is silent.
- `scripts/lib/constants.mjs` `VERB_FLAGS` rows 739-742 declare `set-autonomy`'s four flags;
  `KNOWN_PREAUTHORIZE_CATEGORIES` is at the file's tail.
- `scripts/lib/update-epic.mjs` — the `pairs()` helper (line 625) splits `--deferral` and performs
  no validation; `str(f["carried-to"])` (line 922) is passed to the gate unchecked. The
  both-halves-non-empty guard exists on `declinedPairs()` (line 647 — this document said ~680, corrected at apply) and was never applied to
  `pairs()`.
- `scripts/lib/detour-stack.mjs` — `pushDetour()` refuses a paused epic that is already archived and
  writes both links via `linkOnce()`, arming `may-invalidate.reconcileOnResume`. `popDetour()` is
  strictly last-in-first-out and refuses an archived paused epic by name. Nothing else in
  `scripts/` writes `state.detourStack`.
- `scripts/lib/links.mjs` — `ownedDetours()` filters on `isArmed(l) && !l.reconciled`;
  `epicReferences()` emits detour-stack rows with `kind: "frame"` and no `drop`, which is what makes
  `removeEpic()` refuse.
- `scripts/lib/archive-gate.mjs` — `archiveGate()` has exactly ONE call site, `update-epic.mjs:920`
  (`rg -n "archiveGate\\(" scripts/` at apply time; every other hit is a comment or the import).
  CORRECTED AT APPLY: this line used to read "the one place all five archive paths share", which is
  the opposite of the truth and of `archive-gate.mjs`'s own header — every other archive path
  "never reaches this function" and stamps `unknown` itself. The consequence is in this change's
  favour and is why Decision 4 is cheap: the refusal is bound to the interactive verb by
  construction, not by a scope test somebody has to write.

## Goals / Non-Goals

**Goals:**

- Ship each operation this change touches together with its inverse, and say so where an inverse is
  deliberately not shipped.
- Make a stored epic id refuseable at the write, and make the two shapes already on disk visible.
- Give an already-jammed record an exit that does not require contradicting its own disposition.

**Non-Goals:**

- Autonomy *matching* semantics. This change does not define or change how a category grant is
  matched against a candidate action at decision-rule time; it only ensures a grant names something
  and can be taken back.
- The `PreToolUse` gate-guard matcher — the sibling 0.46.0 change owns it.
- Any migration of existing state. Every field added is additive and read-time-defaulted.

## Decisions

### 1. A revoke RECORDS; it does not splice the array

`preAuthorized[]` entries gain an optional revocation stamp — an object carrying the revoking
reason and the moment — and the entry stays in the array. Readers treat an entry carrying that stamp
as not granting anything.

**Why over splicing.** This repository has decided this question three times already and always the
same way: `linkOnce()` moves a superseded reconcile verdict to `superseded` rather than deleting it;
`--withdraw-gate-review` records the withdrawal rather than removing the verdict; and
`disposition.mjs` states outright that "deletion removes the record of projected work". A revoke
that spliced would make "this was authorised and then taken back" indistinguishable from "this was
never authorised", which is exactly the evidence a safety-surface record exists to keep.

**Alternative considered and rejected:** splice, and write the revocation to the activity log
instead. Rejected because the log is optional (`set-activity-log`) and purgeable (`purge-logs`), so
the record would be conditional on a feature the repo may not have enabled.

**A revoke marks only the UNREVOKED matches.** Because re-granting is the documented un-revoke, an
epic can hold a revoked entry and a live entry for the same action simultaneously, so a match is a
set and not a single entry. Marking the whole set would re-stamp the older revocation with a reason
and a date describing a different event — the data loss the already-revoked refusal exists to
prevent, reached through the mixed case. The refusal fires only when EVERY match is already revoked;
where at least one is live, the live ones are marked and the revoked ones are left byte-identical.

**Trade-off, stated:** `preAuthorized[]` grows monotonically and a long-lived epic accumulates dead
entries. Accepted; the array is per-epic and small, and the alternative trades a bounded size
problem for an unbounded truth problem.

**The revoke's value shape, decided rather than left to the implementer.** `--revoke` takes the
grant's identity and `--revoke-reason` takes the reason, as two flags — not one colon-packed value.
This is forced, not stylistic: `--preauthorize` splits on the FIRST colon, so a grant whose action
contains a colon is stored with a `action` that is only the part before it. If `--revoke` packed its
reason after a colon, it would have to guess where the action ends between two free-text halves, and
those grants would be **unrevokable** — an inverse that does not cover its operation's range. This
is the same judgment `declinedPairs()` already records: between two free-text halves there is no
correct guess, so do not make one. `--revoke` therefore matches against the **stored** `action` or
`category` value, after the identical split the grant went through, so whatever `--preauthorize`
stored is exactly what `--revoke` names. A `category:` prefix on the value selects a category grant,
mirroring the grant syntax.

### 2. `--level off` does NOT clear grants; the fix binds at the re-arm

Clearing on `off` would be deletion under another name, and it is also the wrong shape for the
common case — an epic taken off autonomy for an afternoon has not withdrawn anybody's judgment about
which actions were safe.

The measured harm in CLAUDE.md's required item 1 is not survival, it is the **silent** restore. So
`--level autonomous` reports what it arms: the count, and each live grant's action or category. This
is a strictly better fix than clearing, because clearing would only have helped an operator who
happened to pass `--level off` in between, and the harm occurs whenever autonomy is re-armed at all.

**This is a deliberate decision and not a default.** Recorded here because a reader arriving from the
finding text will expect `off` to clear.

### 3. The frame-drop verb is `drop-detour <pausedEpicId> --reason "<why>"`

Named for what it does to the stack, in the `push-detour`/`pop-detour` family. It is **not**
`--force` on `pop-detour`: a force flag would make "resume this epic" and "this epic is not coming
back" the same operation with a modifier, and they differ in every observable way — which frame is
selected, whether the active pointer moves, whether the status changes, and whether an obligation is
armed or ended.

Three properties are load-bearing and each is in the spec:

- **Selects by epic, not by position.** `push-detour` already refuses to pause an epic that is
  already on the stack, so at most one frame names a given epic and the selection is unambiguous. A
  last-in-first-out-only drop would leave a buried jam stuck — the very condition being fixed.
- **Accepts an already-archived epic.** This is the migration path for existing jams, and it is also
  required going forward: the drift heal can still archive a parked epic (Decision 4), so the state
  remains reachable by a path that is correct to leave unbound.
- **Ends the reconcile obligation.** Setting the `may-invalidate` link's `reconcileOnResume` to
  false is what makes `ownedDetours()` stop counting it, which is what unblocks `remove-epic`. It is
  written alongside a drop stamp (reason + when) so the record distinguishes *dropped* from
  *answered*; `record-reconcile` still refuses a detour that was never popped, and this change does
  not touch it. The link is **disarmed, never removed** — removing an armed link on an owing epic is
  refused by `gate-integrity`'s *A write never destroys the record of an owed reconcile*, and that
  refusal binds this write unchanged.

**Clearing `reconcileNeeded` is a SECOND WRITER of a flag the main spec says has one.**
`gate-integrity`'s *A reconcile obligation survives until a verdict answers it* states that the flag
SHALL NOT be set false by any write other than an accepted `record-reconcile`, with one exception
(the drift heal). The frame-drop is a second exception and the delta carries the MODIFIED block that
says so — reason-bearing, disarming rather than removing, and clearing the flag in the SAME write
that removes the frame, so the drift heal's exception precondition (owing, no armed link, no frame)
is never reachable between two writes. Without that delta this change would contradict an unmodified
requirement of the capability it is extending, which is precisely the absent-edit class it exists to
close.

**Three spellings of "is anything still owed" already exist and the drop must agree with all
three.** `ownedDetours()` and `liveReconcileFrame()` are both exported from `scripts/lib/links.mjs`
(`:234` and `:241`) — not from `reconciler-writeback.mjs`, which imports them — and
`reconcileArchived()` (`scripts/lib/epic-progress.mjs:108`) re-derives the flag from live frames on
every write path. The drop removes the frame and disarms the link in one write, so `reconcileArchived()`
re-derives the same answer on the next render rather than re-arming or re-clearing anything; that
agreement is asserted by test, not assumed.

### 4. The archive refusal binds the interactive verb only

The same reasoning `gate-integrity` already gives for the Gate 2 arm: the drift heal reflects disk,
and refusing there would make the record contradict reality to protect a stack. The consequence is
that a parked epic archived on disk still produces a live frame over an archived epic — which is
acceptable **only because** `drop-detour` accepts that state. The refusal and the verb are one fix,
not two, and neither is shippable alone. This is stated in the spec as a prohibition rather than as
advice.

### 5. Reference validation is a write-time refusal AND a read-time check

Both, and they are not redundant. The refusal binds writes that have not happened; the check sees
what is already on disk, which is where both live instances were found. The two shapes the existing
`dangling-epic-reference` check cannot see are the empty id (it names no epic, so the check's
predicate passes over it) and the self-reference (it names an epic that demonstrably exists).

The refusal reuses `epicReferences()`'s declared set as its vocabulary rather than enumerating
holders inline — enumerating holders inline is the documented cause of the last dangling-reference
family, per that function's own header comment.

**And the declaration has to become value-agnostic for the read-time half to be possible at all.**
`epicReferences()`'s `add()` is `if (typeof epic === "string" && epic)` (`links.mjs:324`, re-derived at apply), so an
empty id never enters the emitted set and an empty-id check driven from that set can never fire —
verified against the fixture, where `--deferral ":"` stored `{"epic":"","section":""}` and
`integrity` reported only the ghost id. Simply loosening the filter is the wrong fix: empty ids
would then also reach `dangling-epic-reference` (and `remove-epic`'s sweep), duplicating the finding
from the other side. So the enumeration declares the HOLDER whatever the value, and each consumer
applies its own predicate: `dangling-epic-reference` and the removal sweep keep their existing
non-empty test, and the new checks report exactly what those tests pass over. One holder list, three
consumers, each finding reported once — which is also why the regression guard asserts the two
existing consumers are unchanged.

### 6. The inverses this change deliberately does NOT ship

Stated here rather than only in the task list, because the thesis of this change is that an
unjustified missing inverse is a finding:

- **A grants clear-all** — not shipped. It is deletion under another name and Decision 1 rules it out.
- **An "un-drop" that re-pushes a dropped frame** — not shipped. `push-detour` already creates a
  frame, and an undo would have to resurrect an obligation somebody deliberately ended with a reason.
- **`--context` and `--notify`** — no inverse, and the `epic-autonomy` spec's inverse claim is scoped
  to `--preauthorize` for this reason. Both are declared `repeats: true` with no `key`
  (`constants.mjs:741-742`), so `update-epic --clear` cannot reach them and nothing un-writes either.
  Justification: each is an append-only record of something that happened — a note, a notification —
  not a standing authorisation, so there is nothing live to take back. A grant is different in kind
  and that difference is the whole reason it needs a revoke.

## Risks / Trade-offs

- **A revoked grant renders nowhere, because grants render nowhere.** → This change does not add
  grant rendering to `PROJECT.md`; the re-arm report (Decision 2) is the surface. Adding a grants
  column is a separate ask and belongs in the backlog, not smuggled in here.
- **`drop-detour` is an escape hatch, and escape hatches get used as shortcuts.** → It requires a
  reason, it refuses when no frame exists, and it never moves the active pointer, so it cannot stand
  in for `pop-detour`. The reason is the record that distinguishes the two afterwards.
- **Refusing an unknown `--deferral` epic could block a legitimate archive** where the receiving
  epic genuinely has not been registered yet. → That is the requirement working: the deferral
  capability already says an asserted deferral is "registered as a `planned`/`queued` epic", so
  registering it first is the documented order, and `--declined-deferral` covers the case where it
  is not going to be registered at all.
- **A jam can still be created by the drift heal.** → Accepted and stated in Decision 4; the exit
  exists, and refusing the heal would be the worse trade.

## Migration Plan

None required. Every field added is optional and read-time-defaulted, so a `state.json` written by
0.45.0 loads unchanged and an epic with no revoked grants and no dropped obligations reads exactly
as it does today. No `MIGRATIONS` entry is needed, because no existing data must be *transformed* to
remain valid — the two integrity checks are how already-written bad references become visible, which
is the deliberate alternative to transforming them (the engine cannot know whether a self-reference
was a typo or shorthand, and guessing would fabricate the record it exists to protect).

`.claude-plugin/plugin.json` version bump and the `CHANGELOG.md` entry are release discipline and
are tasks in this change; the Mintlify sync belongs to the release cut, not here.

## Coordination

**With `the-guard-covers-every-write-path` (the sibling 0.46.0 change).** `drop-detour` writes state
while `reconcileNeeded` is true, and the gate-guard's reconcile branch is unconditional —
`set-gate-guard off` does not reach it. Three statements, and the third is the one that binds:

1. **This change shipped safely alone against 0.45.0, and in 0.46.0 it no longer ships alone.**
   Before the sibling, the matcher was `Edit|Write|NotebookEdit` (`hooks/hooks.json:49`) and
   `gateGuardCheck()` blocked only those. Within this release the matcher covers `Bash`, so what
   keeps `drop-detour` reachable is no longer the matcher but the sibling's normative commitment
   that no engine invocation is a command-word write shape — and, until the shape list grows past
   a segment's leading command word, the structural fact that no row is reachable from a
   `node`-led segment at all. Both 0.46.0 changes also rewrite the emitted managed rules block in
   `scripts/lib/rules.mjs` and its goldens under `scripts/test/fixtures/` (task 1.11 here, task
   3.6 there); **the sibling lands FIRST**, so this change regenerates those fixtures against the
   block it has already rewritten rather than against 0.45.0's.
2. **Any exemption the sibling adds should be NARROW, not broad.** `gateGuardCheck()` keys on the
   ACTIVE non-archived epic's `reconcileNeeded` (`gate-guard.mjs:92-110`), and in the canonical jam
   the active epic is the *detour*, which owes nothing — so under Bash coverage `drop-detour` is
   blocked only in the narrower case where the active epic is itself the owing one. A broad
   conductor-wide exemption would buy nothing this change needs and would spend the guard's coverage.
3. **What this change NEEDS from the sibling is coverage derived from the verb registry, not a
   transcribed allowlist.** A list of verb names written against 0.45.0 does not contain
   `drop-detour`, and if the sibling lands first carrying one, the only exit from a jam is locked
   behind the jam — an ORDER dependency between the two changes. Deriving the exempt set from the
   registry the engine already keeps removes the ordering hazard entirely and is the rule this
   repository has already written down (`docs/lessons/bind-rules-to-functions-not-enumerations.md`,
   cited at `constants.mjs:694`). If the sibling nonetheless ships an enumeration, `drop-detour` must
   be in it in the same release.

4. **Every remedy THIS change emits is swept against the sibling's shape scanner (task 4.1b), and
   the sweep's one finding is an UNFILLED command template.** `drop-detour <pausedEpicId> --reason
   "<why>"` blocks on the sibling's prototype, because `<why>` and `<pausedEpicId>` each carry a
   `>` that its redirection arm matches; so does `set-autonomy <id> --revoke <action |
   category:<name>> --revoke-reason "<why>"`, the usage line task 1.2 adds. **The verdict is
   ACCEPTED, and the class belongs to the SIBLING, not here.** Two reasons, and the second is why
   this change ships no fix at the emitting site. First, the block removes nothing that would
   otherwise run: an unfilled template is already broken at the shell, where `<id>` is an input
   redirection, and every FILLED spelling passes — verified on the prototype for
   `node "$ENGINE" drop-detour p --reason "stale frame"` and
   `set-autonomy e --revoke "rm -rf build/" --revoke-reason "no longer regenerated"`, both null.
   Second, the interaction is PRE-EXISTING and pm-wide rather than introduced here: pm emits the
   same spelling today at `briefing.mjs:30`/`:45`/`:60`, `autonomy.mjs:44-46`,
   `gate-review-writeback.mjs:51-52` and `argv-surface.mjs:213`, none of which this change touches.
   It is therefore a consequence of the sibling's scope, named as an accepted class in ITS design
   D7 — inventing it as new work here would file one pm-wide class in two places and fix it in
   neither. The rest of the sweep is clean: no remedy this change emits is a redirection, an
   in-place editor, an `rm` of the record or any other row, and `rm -rf build/` appears only INSIDE
   a quoted `--preauthorize` argument, where it is not a segment-leading command word (null on the
   prototype).

That change owns the matcher and the exemption; this change does not touch `hooks/` or
`gate-guard.mjs`. Task 0.2's cross-spec review is where the two are checked against each other.

**With `epic-annotation`'s shared flag allowlist.** That requirement's "one shared allowlist" is the
union of `EPIC_FLAGS` and `VERB_FLAGS` (both tables carry the same row shape and are read together
by `constants.mjs`), so registering `--revoke` and `drop-detour --reason` as `VERB_FLAGS` rows
satisfies it and no delta to `epic-annotation` is required. Verified at proposal time: that
capability's documented-surface coverage check is scoped to `update-epic`/`add-epic` against
`commands/epic.md` (`scripts/test/conductor-36.test.mjs`), so neither new flag falls under it. **No new
`commands/` file is created**: `drop-detour` is documented in the existing `commands/detour.md`,
already claimed by the `detour-lifecycle` capability in `docs/parity-ledger.json`, so the parity
ledger needs no new path and `scripts/test/parity.test.mjs` is unaffected. The whole docs pass
(`commands/detour.md`, README, `skills/conductor/SKILL.md`, CHANGELOG) therefore lands after Gate 2
as usual.

## Open Questions

None that would change the specs, the approach or the task breakdown.
