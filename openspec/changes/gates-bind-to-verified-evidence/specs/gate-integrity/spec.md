## ADDED Requirements

### Requirement: A reconcile verdict answers only a detour the epic owes

Vocabulary used by every reconcile requirement in this capability:

- every `may-invalidate` link carries an explicit **arming record**, true or false. Only
  `push-detour <epic> --detour <detour> --reconcile` writes true. `push-detour … --no-reconcile`
  writes false on a link it creates and never lowers a true record. Every other write that creates a
  `may-invalidate` link (`update-epic --link`, `add-epic --link`, an `add-many` entry) writes false.
  Links written by an earlier release are given their record by the 0.44.0 migration below;
- a detour is **armed** against an epic when the epic's `may-invalidate` link to it carries a true
  arming record, decided per link and never from the epic's other links or its flag. A link carrying
  no arming record at all (a state file not yet upgraded) is **unmigrated**: it is never armed, and
  it is never grounds for clearing an obligation;
- an armed detour is **answered** once `record-reconcile` records a verdict against it, and is
  **unanswered** until then;
- an epic **owes a reconcile** while its `reconcileNeeded` is true.

`record-reconcile <epic> --detour <detour> --verdict valid|invalidated` SHALL be accepted only
where `<detour>` is armed against `<epic>` and no detour-stack frame pausing `<epic>` for `<detour>`
is still on the stack. Every other invocation MUST be refused: it exits non-zero, leaves
`state.json` byte-identical, and its message names the detours the epic currently owes a verdict
against, or states that it owes none. While the epic holds ANY unmigrated `may-invalidate` link, every
`record-reconcile` on it MUST be refused naming `/pm:upgrade`, whichever detour it names: an obligation
the unmigrated link carries cannot be counted, so no verdict may clear the flag before it is stamped. The self-epic, an epic that was never a detour of `<epic>`,
and a detour pushed with `--no-reconcile` are all refused by this rule. `record-reconcile` MUST
NOT create a link.

An accepted verdict SHALL be recorded against that armed detour, and `reconcileNeeded` SHALL become
false only when no armed detour of the epic remains unanswered and no frame pausing the epic with
reconcile-on-resume is still on the stack. Otherwise it stays true.

**Re-recording is a correction, not an overwrite.** A verdict recorded against an armed detour that
is already answered SHALL be accepted, SHALL keep the verdict it replaces readable, and SHALL NOT
set `reconcileNeeded` true or clear an obligation owed against another detour.

**Re-arming.** `push-detour <epic> --detour <detour> --reconcile` against a detour that is already
answered SHALL make it unanswered again, keeping its previous verdict readable, so the new pause
owes a new verdict and the epic is never left owing a reconcile with nothing it can record.

**Amendments.** `--amendments` whose entire trimmed value is `none`, in any letter case, SHALL
record no amendments. A repeatable `--amendment "<text>"` SHALL record each occurrence as exactly
one amendment, verbatim. Supplying both `--amendment` and `--amendments` in one invocation MUST be
refused.

#### Scenario: A verdict against the paused epic itself is refused

- **WHEN** `p` owes a reconcile after `push-detour p --detour d --reason r --reconcile` and
  `pop-detour p`, and `record-reconcile p --detour p --verdict valid` runs
- **THEN** it exits non-zero naming `d` as the detour owed, `state.json` is byte-identical, and
  `gate-guard` still exits 2

#### Scenario: A verdict against an unrelated epic is refused and writes no link

- **WHEN** the same `p` runs `record-reconcile p --detour other --verdict valid`, where `other` is an
  existing epic that was never a detour of `p`
- **THEN** it exits non-zero, `state.json` is byte-identical, and `p` carries no link to `other`

#### Scenario: A detour pushed without reconcile does not answer an armed one

- **WHEN** `p` owes a reconcile against armed detour `d`, then `push-detour p --detour d2 --reason r
  --no-reconcile` and `pop-detour p` run, and `record-reconcile p --detour d2 --verdict valid` runs
- **THEN** it exits non-zero naming `d`, and `p` still owes a reconcile

#### Scenario: A verdict before the detour is popped is refused

- **WHEN** `push-detour p --detour d --reason r --reconcile` has run and its frame is still on the
  stack, and `record-reconcile p --detour d --verdict valid` runs
- **THEN** it exits non-zero and `state.json` is byte-identical

#### Scenario: The armed detour's verdict clears the obligation

- **WHEN** `p` owes a reconcile against armed detour `d` only, and `record-reconcile p --detour d
  --verdict valid` runs
- **THEN** it exits zero, the verdict is readable on `p`'s link to `d`, `p` no longer owes a
  reconcile, and `gate-guard` exits 0

#### Scenario: Two armed detours need two verdicts

- **WHEN** `p` is pushed for `d` with `--reconcile` and popped, then pushed for `d2` with
  `--reconcile` and popped, and `record-reconcile p --detour d --verdict valid` runs
- **THEN** it exits zero, `p` still owes a reconcile and `gate-guard` still exits 2, until a verdict
  against `d2` is recorded

#### Scenario: Re-pushing to an answered detour re-arms it

- **WHEN** `p` is pushed for `d` with `--reconcile`, popped, answered `valid`, pushed for `d` again
  with `--reconcile` and popped, and `record-reconcile p --detour d --verdict invalidated` runs
- **THEN** it exits zero, `p` no longer owes a reconcile, the link to `d` carries `invalidated`, and
  the earlier `valid` verdict is still readable on that link

#### Scenario: Correcting a recorded verdict keeps the one it replaces

- **WHEN** `p`'s armed detour `d` is answered `valid` and nothing else is owed, and
  `record-reconcile p --detour d --verdict invalidated` runs
- **THEN** it exits zero, the link carries `invalidated` with the `valid` verdict still readable, and
  `p` does not owe a reconcile

#### Scenario: A no-reconcile push to the same detour never lowers its arming

- **WHEN** `p` owes a reconcile against armed detour `d`, then `push-detour p --detour d --reason r
  --no-reconcile` and `pop-detour p` run, and `render` runs
- **THEN** `p` still owes a reconcile against `d`, and `record-reconcile p --detour d --verdict valid`
  exits zero

#### Scenario: A hand-supplied link is never armed

- **WHEN** `update-epic p --link "may-invalidate:x:why"` runs, where `p` owes a reconcile against
  armed detour `d` only
- **THEN** `record-reconcile p --detour x --verdict valid` is refused naming `d`, and
  the link to `x` carries a false arming record

#### Scenario: A verdict against a new detour cannot clear an unmigrated obligation

- **WHEN** a 0.43.0 state file holds `p` with `reconcileNeeded: true` and a `may-invalidate` link to `d`
  carrying no arming record, then `push-detour p --detour d2 --reason r --reconcile` and `pop-detour p`
  run before `upgrade`, and `record-reconcile p --detour d2 --verdict valid` runs
- **THEN** it exits non-zero naming `/pm:upgrade`, `state.json` is byte-identical, and `p` still owes a
  reconcile

#### Scenario: An unmigrated link is refused with the upgrade named

- **WHEN** a state file written by 0.43.0 holds `p` with `reconcileNeeded: true` and a
  `may-invalidate` link to `d` carrying no arming record, and `record-reconcile p --detour d
  --verdict valid` runs before `upgrade`
- **THEN** it exits non-zero naming `/pm:upgrade`, `state.json` is byte-identical, and, `p` being the
  active epic, `render` leaves
  `p` owing a reconcile

#### Scenario: A none amendment records nothing

- **WHEN** an accepted verdict is recorded with `--amendments none`
- **THEN** the recorded amendments are empty

#### Scenario: A repeated amendment flag keeps each amendment whole

- **WHEN** an accepted verdict is recorded with `--amendment "rename x; keep y" --amendment "drop z"`
- **THEN** the recorded amendments are exactly `rename x; keep y` and `drop z`, in that order

### Requirement: The 0.44.0 migration gives every reconcile link an explicit arming record

The 0.44.0 `upgrade` migration SHALL give every `may-invalidate` link that carries no arming record
one: true where its epic's `reconcileNeeded` is true AND the link carries no recorded verdict AND it
targets another epic that exists, false otherwise (a link to the epic itself or to a missing epic can
never be answered, so arming it would wedge the epic). It SHALL read only `state.json`, SHALL leave a link that already carries a record exactly
as it is, and SHALL change nothing else. Running it again changes nothing. A state file written by
0.43.0 SHALL load and be upgraded by it.

The same stamp SHALL also run on EVERY `upgrade`, whatever `pmVersion` the state already carries, so
the `/pm:upgrade` a refusal names always stamps a link written later by an older engine (an unreloaded
session, or another machine sharing `state.json` through git).

Tradeoff, stated rather than hidden: an epic that owes a reconcile while every one of its
`may-invalidate` links already carries a verdict (a re-push after a verdict under 0.43.0) receives
only false records, so the survival requirement's exception then clears its flag and says so on
stderr. Measured before this change: 0 epics owing a reconcile and 2 `may-invalidate` links across
the 24 pm-managed repositories on the authoring machine. The stamp can also over-arm: a 0.43.0
`--no-reconcile` link with no verdict, on an epic that later came to owe through another detour, is
stamped true, and answering it costs one truthful verdict.

#### Scenario: An owing epic's unanswered link becomes armed

- **WHEN** a 0.43.0 state file holds `p` with `reconcileNeeded: true` and an unrecorded, unanswered
  `may-invalidate` link to `d`, and `upgrade` runs
- **THEN** the link to `d` carries a true arming record, and `record-reconcile p --detour d --verdict
  valid` exits zero and clears the obligation

#### Scenario: A link on an epic that owes nothing is never armed

- **WHEN** a 0.43.0 state file holds `p` with `reconcileNeeded: false` and an unrecorded
  `may-invalidate` link to `d2` (written by a `--no-reconcile` push), and `upgrade` runs
- **THEN** the link to `d2` carries a false arming record

#### Scenario: An answered link is never armed

- **WHEN** a 0.43.0 state file holds `p` with `reconcileNeeded: true` and an unrecorded
  `may-invalidate` link to `d` that already carries a verdict, and `upgrade` runs
- **THEN** the link to `d` carries a false arming record

#### Scenario: Upgrade stamps a link written after the version was already stamped

- **WHEN** a state file stamped `pmVersion` 0.44.0 holds `p` with `reconcileNeeded: true` and a
  `may-invalidate` link carrying no arming record to a detour that is archived, and `upgrade` runs
- **THEN** the link carries a true arming record and `record-reconcile p --detour <that detour>
  --verdict valid` exits zero

#### Scenario: The migration is idempotent

- **WHEN** `upgrade` has run the 0.44.0 migration and the migration is applied to that state again
- **THEN** `state.json` is unchanged

### Requirement: A reconcile obligation survives until a verdict answers it

`reconcileNeeded` SHALL NOT be set false by any write other than an accepted `record-reconcile`,
with the one exception below. Moving the active pointer — `set-active`, `clear-active`,
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

- **WHEN** `p` owes a reconcile and is active, and `add-epic --id q --title q --status active` runs
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

### Requirement: A later detour never overwrites an earlier reconcile obligation

`push-detour` on an epic that owes a reconcile SHALL leave that obligation, and every unanswered
armed detour of the epic, intact whichever of `--reconcile` or `--no-reconcile` it carries. Its
report MUST NOT state that no reconcile is owed on resume while an earlier obligation survives.

`pop-detour` SHALL emit and log the Honcho POP memory line only where the resumed epic owes no
reconcile after the pop. Where it owes one — from the frame being popped or from any earlier armed
detour — it SHALL emit no POP line, write none to the Honcho memory log, and print the reconcile-gate
notice naming every detour the epic owes a verdict against.

#### Scenario: A no-reconcile push keeps the pending obligation

- **WHEN** `p` owes a reconcile against armed detour `d`, and `push-detour p --detour d2 --reason r
  --no-reconcile` runs
- **THEN** `p` still owes a reconcile, and the push's report does not state that no reconcile is owed
  on resume

#### Scenario: The pop does not claim a reconcile nobody recorded

- **WHEN** that push is followed by `pop-detour p`
- **THEN** stdout carries no line containing `no reconcile was required`, the Honcho memory log gains
  no POP line for `p`, stderr names `d` as owed, and `gate-guard` exits 2

#### Scenario: A pop that owes nothing still records its memory line

- **WHEN** an epic that owes no reconcile is pushed with `--no-reconcile` and popped
- **THEN** the POP memory line is emitted and logged as today

### Requirement: A write never destroys the record of an owed reconcile

While an epic owes a reconcile, a write that would remove any of its armed `may-invalidate` links —
answered or not — or any unmigrated one MUST be refused, exiting non-zero with `state.json` byte-identical and a message naming
`record-reconcile`. This binds `update-epic <epic> --clear-links`, and `remove-epic <detour>`, which
would otherwise strip the link as a dangling reference.

Supplying a link whose type and target equal an existing `may-invalidate` link — the documented way
to correct a reason — SHALL change only the reason, keeping that link's arming record and any
recorded verdict, whether or not anything is owed.

#### Scenario: Clearing links on an owing epic is refused

- **WHEN** `p` owes a reconcile against armed detour `d`, and `update-epic p --clear-links` runs
- **THEN** it exits non-zero naming `record-reconcile`, and `state.json` is byte-identical

#### Scenario: Removing an armed detour is refused

- **WHEN** `p` owes a reconcile against armed detour `d`, and `remove-epic d` runs
- **THEN** it exits non-zero naming `record-reconcile`, `state.json` is byte-identical, and `p` still
  owes a reconcile against `d`

#### Scenario: An answered armed link is protected while another obligation stands

- **WHEN** `p`'s armed detour `d` is answered while `p` still owes against armed detour `d2`, and
  `update-epic p --clear-links` or `remove-epic d` runs
- **THEN** each exits non-zero and `state.json` is byte-identical

#### Scenario: Correcting a link's reason keeps its verdict

- **WHEN** `p`'s link to armed detour `d` carries a recorded verdict, and `update-epic p --link
  "may-invalidate:d:corrected reason"` runs
- **THEN** the link carries `corrected reason` and the same verdict, and `p`'s reconcile state is
  unchanged

### Requirement: A recorded commit is resolved when it is written

Every commit value these flags write SHALL be resolved as a commit against this repository's local
object database at the moment of the write: `update-epic --attribute-commit`, `update-epic
--withdraw-commit` (whose matching the requirement below defines), and `record-gate-review
--base-sha` and `--head-sha` on either gate. Resolution MUST be independent of the checked-out
branch and of whether any branch contains the commit, and MUST contact nothing outside the
repository.

A value that does not resolve to exactly one commit — not a commit, ambiguous, or absent from the
object database — MUST refuse the whole invocation: it exits non-zero, `state.json` is
byte-identical, and the message names every value that did not resolve. An accepted value SHALL be
stored as the full object name of the commit it resolved to, so a short hash, a tag, `HEAD` or
`main~1` is recorded as the commit it named at write time and never re-resolved later.

#### Scenario: A value that is not a commit is refused

- **WHEN** `update-epic <id> --attribute-commit not-a-commit` runs
- **THEN** it exits non-zero naming `not-a-commit`, and `state.json` is byte-identical

#### Scenario: A moving ref is stored as the commit it named

- **WHEN** `record-gate-review <id> --gate 2 --verdict pass --base-sha main~1 --head-sha HEAD
  --reviewer r` runs and a later commit is then made
- **THEN** the recorded `baseSha` and `headSha` are the full object names `main~1` and `HEAD` named at
  the time of the call, not the literal refs

#### Scenario: A short hash is stored in full

- **WHEN** `update-epic <id> --attribute-commit <a unique short hash of commit C>` runs
- **THEN** the attribution array's new entry is C's full object name

#### Scenario: A commit reachable only from a tag resolves

- **WHEN** a commit is reachable from no branch but is held by a `presquash/*` tag, and its hash is
  passed to `--attribute-commit` while another branch is checked out
- **THEN** it is accepted and stored in full

#### Scenario: A range bound that is not a commit is refused

- **WHEN** `record-gate-review <id> --gate 2 --verdict pass --base-sha root --head-sha <a commit>`
  runs in a repository with no ref or commit named `root`
- **THEN** it exits non-zero naming `root`, and no verdict is recorded

### Requirement: A commit withdrawal matches the attributed commit, not its spelling

`update-epic <id> --withdraw-commit <value>` SHALL remove the LAST attributed entry that names the
same commit as `<value>`, whatever length either is written at. Where `<value>` does not resolve, it
SHALL still withdraw an attributed entry exactly equal to it, so a legacy entry that no longer
resolves can be corrected. Where no entry matches either way, the invocation MUST be refused naming
the value, as today. The withdrawal record SHALL carry the attributed entry that was removed. An
invocation that attributes and withdraws the same commit, however each is spelled, MUST be refused.

#### Scenario: A full hash withdraws the short entry of the same commit

- **WHEN** an epic attributes commit C as a short hash, and `update-epic <id> --withdraw-commit <C in
  full> --withdrawal-reason x` runs
- **THEN** it exits zero, the attribution array no longer holds that entry, and the withdrawal record
  names the entry removed

#### Scenario: A legacy entry that no longer resolves can be withdrawn

- **WHEN** a state file's epic attributes the literal `not-a-commit`, and `update-epic <id>
  --withdraw-commit not-a-commit --withdrawal-reason x` runs
- **THEN** it exits zero and the entry is withdrawn

#### Scenario: The same commit spelled two ways cannot be attributed and withdrawn together

- **WHEN** an epic already attributes commit C in full, and `update-epic <id> --attribute-commit <C
  short> --withdraw-commit <C in full> --withdrawal-reason x` runs
- **THEN** it exits non-zero, and `state.json` is byte-identical

### Requirement: A recorded commit value that is not a commit object name is reported

The integrity surface SHALL report every epic holding, in its attribution array or in the
`baseSha`/`headSha` of a currently stored gate verdict, a value that is not shaped as a hexadecimal
commit object name — a ref name written before write-time resolution. The finding names the epic,
where the value is held, and the value. The check is read-only and SHALL NOT rewrite the value: which
commit a moving ref named at the time it was written is not recoverable from the record. A short
hexadecimal hash that resolves is not a finding.

**Scoped to what is still asserted, so the remedy clears it.** Withdrawing the attribution, or
re-recording the verdict, is the remedy; a withdrawal record and a superseded or withdrawn verdict
are history kept on purpose, and a finding over them would outlive every remedy.

#### Scenario: A symbolic head is reported

- **WHEN** a state file's epic carries a Gate 2 verdict whose `headSha` is `HEAD`, and `integrity`
  runs
- **THEN** it reports that epic, the Gate 2 `headSha`, and the value `HEAD`, and `state.json` is
  unchanged

#### Scenario: Re-recording the verdict clears the finding

- **WHEN** the epic of the previous scenario re-records its Gate 2 with resolvable `--base-sha` and
  `--head-sha`, and `integrity` runs
- **THEN** no finding of this kind names the epic, although the superseded verdict still holds `HEAD`

#### Scenario: A resolving short hash is not reported as a symbolic value

- **WHEN** an epic attributes a unique short hash of a commit this repository holds, and `integrity`
  runs
- **THEN** no finding of this kind names it

## MODIFIED Requirements

### Requirement: A verdict that does not cover the shipped work is stale

A verdict whose `headSha` does not reach **every** commit attributable to that epic's work does not
cover the code that shipped and SHALL be treated as stale. A commit is reached when it is equal to or
an ancestor of `headSha`. A stale Gate 2 MUST NOT satisfy the archive gate for a `delivered`
outcome, and MUST be rendered as stale wherever the verdict is displayed. Two constraints bound the
check: it MUST be local — deriving commits from `git` is permitted, the engine already shells to
`git rev-parse` and `git merge-base`, and no network call or external system is involved — and it
MUST NOT refuse on commits unrelated to the epic. Repository `HEAD` alone is therefore not the
baseline: an epic archived a week after its merge has a `HEAD` far past its own `headSha` through
nobody's fault. Reachability from a branch or any other ref is never the test either: a
squash-merge leaves the reviewed commits reachable only from tags, or from nothing.

**Every entry is compared, not only the last.** Comparing only the last entry let an ancestor
attributed after an uncovered descendant make a stale verdict read fresh, and let a `headSha` on an
unrelated branch read fresh because it was not an ancestor of anything. A `headSha` that is not
related to the attributed commits reaches none of them and is stale.

**A value that is not a commit object name is not a pass.** A verdict SHALL also be stale where its
`headSha`, or any attributed entry, is not shaped as a hexadecimal commit object name — a ref name or
other string stored before write-time resolution. Such a value is never resolved as a ref at read
time, and the archive refusal names it. A hexadecimal value this clone cannot resolve to exactly one
commit — absent, ambiguous, or naming an object that is not a commit — is different: a clone that
cannot resolve it cannot answer for the record, so where no reached-or-not answer can be given the
verdict is unverifiable, as below. The integrity report and this requirement decide "shaped as a
hexadecimal commit object name" identically. A resolvable attributed
commit that `headSha` does not reach makes the verdict stale whatever else is missing.

**Attribution SHALL be an array of commit hashes recorded on the epic.** The emitted gate procedure
records the last entry as the head of the reviewed range. **The array is written by the named flag
and the emitted obligation the next requirement defines** — this requirement does not leave
"appended as each commit is attributed" to an unnamed actor, because nothing would then append and
every epic would carry an absent array, firing the unverifiable case below universally and leaving
this whole staleness gate permanently inert. Deriving attribution from **commits that touch the
epic's own files** is explicitly EXCLUDED: archiving a change moves `openspec/changes/<id>/` into
`archive/<date>-<id>/`, a commit that touches every file the epic owns, so under that design the
archive move itself makes every verdict stale at the exact moment the archive gate reads it, and the
gate refuses forever. Commit messages naming epic ids are a human-readable echo of the record and
MUST NOT be the mechanism: a prose convention was measured at 3/15 adoption in this project's own
audit, against 14/14 for anything a required task carries.

#### Scenario: Commits attributed to the epic landed after the reviewed range

- **WHEN** an openspec-lane epic being archived as `delivered` carries a passing Gate 2 whose
  `headSha` is an ancestor of, but not equal to, the last hash in its recorded attribution array
- **THEN** the archive is refused with a message naming the recorded `headSha` and the attributed
  commits it does not cover, and the verdict renders as stale rather than as a pass

#### Scenario: The reviewed range covers the shipped work

- **WHEN** the recorded `headSha` is the last hash in the epic's recorded attribution array and every
  earlier entry is an ancestor of it
- **THEN** the verdict satisfies the archive gate and renders as a pass, even where unrelated
  commits have since moved repository `HEAD` past it

#### Scenario: An ancestor attributed last does not hide an uncovered descendant

- **WHEN** an openspec-lane epic attributes a descendant of commit A and then A itself, carries a
  passing Gate 2 whose `headSha` is A, and is archived as `delivered`
- **THEN** the archive is refused naming the descendant as uncovered, and the verdict renders as stale

#### Scenario: A head on an unrelated branch is stale

- **WHEN** an openspec-lane epic's passing Gate 2 records a `headSha` that shares no history with its
  attributed commits, and the epic is archived as `delivered`
- **THEN** the archive is refused and the verdict renders as stale

#### Scenario: A value the repository cannot resolve does not let an archive through

- **WHEN** an openspec-lane epic's state holds an attributed entry `not-a-commit` beside a passing
  Gate 2 whose `headSha` resolves, and it is archived as `delivered`
- **THEN** the archive is refused naming `not-a-commit`, and the verdict renders as stale rather than
  unverifiable

#### Scenario: A symbolic head stored before resolution is stale

- **WHEN** an openspec-lane epic's state holds an attribution array of exactly one resolvable commit
  and a passing Gate 2 whose `headSha` is the literal `HEAD`
- **THEN** PROJECT.md and the briefing render that verdict as stale, and a `delivered` archive is
  refused naming `HEAD`

#### Scenario: An epic with no recorded attribution is unverifiable, not refused

- **WHEN** an epic carries a passing Gate 2 and has no attribution array at all — it predates this
  capability — or no git history is available, or its `headSha` or an attributed entry is a
  hexadecimal value this clone does not hold and no resolvable attributed commit is unreached
- **THEN** the archive is not refused on staleness grounds, and the verdict is reported as
  unverifiable rather than silently rendered as a covering pass

#### Scenario: An empty attribution array is not the same as an absent one

- **WHEN** an epic created under this capability — and therefore carrying the array initialized
  empty — reaches archive with no commit yet attributed to it
- **THEN** it asserts that no commit has been attributed, so no verdict can be shown stale by it
  and the archive is not refused on staleness grounds; the epic instead renders as `delivered` with
  no attributed commits — a distinct rendering from an epic whose array is absent, which renders as
  unverifiable

### Requirement: Commit attribution is written by a named flag the emitted instructions require

The attribution array the staleness requirement compares against SHALL be written by a **named flag
on `update-epic`** — `--attribute-commit <sha>`, accepted more than once in a single invocation and
appending each commit in the order given — and that flag SHALL be declared in the single shared flag
allowlist that `epic-annotation` requires, not in a second parallel list. The engine SHALL append
the full object name each given value resolves to, as "A recorded commit is resolved when it is
written" defines, and SHALL infer attribution from nothing else: not from the files a commit touches,
not from an epic id appearing in a commit message, not from commit ordering.

**An epic created after this capability SHALL be created carrying the array, initialized empty.**
That is what makes the staleness requirement's two no-attribution states distinguishable and both
reachable: an ABSENT array means the epic predates this capability and its verdict is unverifiable,
while an EMPTY array means the epic was created under it and nothing has been attributed yet. Were
the array only ever created by the flag's first use, `[]` would be a state nothing could produce and
an agent ignoring the obligation below would leave an absence indistinguishable from a pre-existing
epic — hiding the omission behind the one case the staleness gate is required to forgive.

**The migration SHALL NOT add the array to an epic that already exists.** The absent/empty
distinction above is load-bearing and unguarded otherwise: a uniformity-minded migration that
initializes every epic to `[]` collapses the two states, and every pre-existing epic then asserts
"created under this capability, nothing attributed" — a claim that is false for all of them and
that silently converts the staleness gate's one forgiven case into a repo-wide false positive. For
the same reason no migration SHALL rewrite an entry already stored: whether a stored value resolves
is a property of the clone reading it, and a migration would bake one clone's answer into the shared
record.

An epic-mutating flag nobody is told to use produces an absent array on every epic, which is
indistinguishable in the record from an epic that predates this capability. The instructions pm
emits — its managed `CLAUDE.md` rules block, the `conductor` skill, and its command docs — SHALL
therefore require the agent to attribute each commit to the epic it belongs to at the moment that
commit is made, and SHALL name the per-task conventional commit of an OpenSpec apply loop as the
case that always qualifies. This is the same instruction-layer obligation `conductor-record` states
for the `<!-- pm:lifecycle -->` declaration, for the same reason and to the same shape: the engine
emits the rule and never writes the record itself, and without the emitted rule the field is
expressible and never exercised.

The obligation SHALL also cover work already in flight when this capability lands, since an epic
whose commits were made before the flag existed can only acquire attribution from the agent
finishing it.

**The obligation SHALL exclude the change's own archive move.** The commit that moves
`openspec/changes/<id>/` under `openspec/changes/archive/` — and any commit that only relocates or
deletes a change's artifacts rather than implementing its work — is lifecycle bookkeeping, and the
emitted text SHALL say so where it states the obligation. Without the exclusion the obligation and
the staleness gate collide on the documented workflow: the archive move lands *after* the reviewed
range by construction, so an agent following "attribute each commit as it is made" attributes it,
the array gains a descendant of the recorded `headSha`, the verdict reads stale, and the archive
gate refuses the very `delivered` record the interactive verb is required above to accept — the
same trap this requirement already refuses to build by inference, reappearing through the flag. The
exclusion is agent-declared, exactly like the `<!-- pm:lifecycle -->` marker `conductor-record`
defines: the engine still appends precisely the commits it is given and classifies nothing, so the
excluded mechanisms above are untouched. Excluding the move never empties a populated array — it
withholds one append — so an epic that attributed its delivery commits keeps them, and an epic whose
only candidate was the move reads as empty, which is the forgiven "nothing attributed yet" state
rather than a stale verdict.

#### Scenario: The emitted obligation excludes the archive move

- **WHEN** pm emits the text stating the attribution obligation
- **THEN** that text names the change's archive move as a commit NOT to attribute, so an agent
  following the emitted instructions cannot make an epic's own Gate 2 stale at the instant the
  archive gate reads it

#### Scenario: Archiving after the move commit is not refused as stale

- **WHEN** an openspec-lane epic whose attribution array ends at its last delivery commit has its
  change archived on disk, that move is committed, and the agent then records `outcome: delivered`
  through the interactive archive verb
- **THEN** the archive is not refused on staleness grounds, because the move was never attributed
  and the recorded `headSha` still reaches every hash in the array

#### Scenario: The flag appends hashes and is registered once

- **WHEN** the agent runs `update-epic <id> --attribute-commit <sha1> --attribute-commit <sha2>`
- **THEN** the full object names of both commits are appended to that epic's attribution array in
  the order given, readable back from `state.json`, and the flag appears in the one shared flag
  allowlist rather than in a second list of its own

#### Scenario: A newly created epic carries the array empty

- **WHEN** an epic is created after this capability lands and no commit has been attributed to it
- **THEN** it carries an attribution array holding no hashes, distinguishable in the record from an
  epic created before this capability, which carries no array at all

#### Scenario: The emitted instructions require attribution at commit time

- **WHEN** pm emits its managed rules block, the `conductor` skill text, or a command doc covering
  the build loop for an openspec-lane epic
- **THEN** that text directs the agent to attribute each commit to its epic as the commit is made,
  naming the flag — assertable directly against the text pm emits, and covering an epic whose
  earlier commits predate this capability

#### Scenario: The engine never infers an attribution

- **WHEN** a commit touches every file an epic owns, or names the epic's id in its message, and no
  `--attribute-commit` was run for it
- **THEN** that hash does not appear in the epic's attribution array, because the archive move
  itself touches every file a change owns and a prose convention was measured at 3/15 adoption
