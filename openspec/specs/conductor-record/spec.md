# conductor-record Specification

## Purpose

The conductor's record of what a repository actually shipped must be complete, and its progress
signal must reflect delivery rather than bookkeeping. Today `sync` never walks
`openspec/changes/archive/`, so the conductor sees 49 of 87 archived changes across 8 repos (56%),
and a task reading `run /opsx:archive <this change>` — which cannot be ticked before the thing that
ticks it — counts as outstanding work. Every effectiveness number this project has published was
computed over that record. This capability also owns the definition of "outstanding work" that the
rest of the release refuses actions on.

## Requirements

### Requirement: Outstanding work is a defined quantity
This capability SHALL be the single definition of an epic's **outstanding work**, and every
consumer SHALL key on that definition rather than counting raw checkboxes for itself — the rendered
project record, the briefing, `/pm:next`, and any guard in this release that refuses an action
because an epic still has work left.

**Outstanding work** for an epic is the number of items in its progress source that are neither
ticked nor declared lifecycle bookkeeping in the sense defined below. An epic **has outstanding
work** when that number is greater than zero. A declared-bookkeeping item is removed from both the
numerator and the denominator, so an epic's rendered progress and its outstanding-work count can
never disagree.

A guard that refuses an action on the grounds that work remains SHALL cite this quantity. Refusing
an epic that renders as complete — because the guard counted an item this definition excludes — is
prohibited; the archive instruction in a change's own task list is unticked at archive time by
construction, and a guard keying on raw checkboxes would refuse every correctly finished change.

#### Scenario: An epic whose only unticked item is declared bookkeeping has nothing outstanding
- **WHEN** an epic's task source holds 13 items, 12 ticked, and the thirteenth is a declared
  lifecycle-bookkeeping task instructing the agent to archive this very change
- **THEN** the epic's outstanding work is zero, its progress renders `12/12`, and a guard that
  refuses an action while work remains does not refuse for this epic

#### Scenario: A refusal cites the same count the record renders
- **WHEN** an action is refused because an epic still has outstanding work
- **THEN** the count named in the refusal is this definition's count and is identical to the count
  the rendered project record shows for that epic

### Requirement: Lifecycle bookkeeping is excluded only where it is declared
A task that is lifecycle bookkeeping rather than delivery SHALL be excludable from outstanding work
by an explicit declaration carried in the task source itself. The declaration SHALL be the single
literal token `<!-- pm:lifecycle -->`, written onto the task line by the agent authoring the source
— one fixed string, chosen so it renders invisibly in markdown and so a test binds to it exactly.

The judgment is the agent's, not the engine's. The engine SHALL exclude exactly the tasks that
carry the marker and SHALL infer exclusion from nothing else — not from a task's wording, not from
the commands its text names, not from its position in the file. This is the ruling `epic-disposition`
makes on the identical problem for deferrals, and the one `PLAN_INDEX_FILES` already embodies in
`epic-progress.mjs` by excluding against an enumerable literal rather than reading a file for
intent.

The error direction is deliberate. An undeclared bookkeeping task keeps counting as outstanding,
which is today's behavior and is visible in the rendered record. A text matcher would fail the
other way, silently excluding a real task and under-reporting outstanding work — the exact
over-reporting of completion this whole release exists to correct.

Exclusion MUST remove the task from both the numerator and the denominator: `12/13` where the
thirteenth is a declared archive instruction becomes `12/12`, never `12/13` with a hidden
adjustment.

Excluding tasks MUST NOT collapse a real progress source into the "no progress source" state. A
missing source is a distinct condition from a source that is present and empty, and only the former
warns; an epic whose every task was excluded still has a source, and MUST NOT emit the
missing-source warning.

#### Scenario: A declared self-referential archive task is not outstanding work
- **WHEN** an epic's task source has 13 tasks, 12 ticked, and the thirteenth reads
  `run /opsx:archive <this change>` and carries the marker
- **THEN** the epic's progress renders `12/12` and the epic does not present as having outstanding
  work

#### Scenario: An undeclared task is counted however it is worded
- **WHEN** a task reads `run /opsx:archive <this change>` and does NOT carry the marker
- **THEN** it counts normally toward both numerator and denominator, and the engine does not
  exclude it on the strength of its text

#### Scenario: A real task that mentions archiving still counts
- **WHEN** a task describes implementing or testing behavior that involves archiving, and does not
  carry the marker
- **THEN** it counts normally toward both numerator and denominator

#### Scenario: An epic whose only task was excluded does not warn
- **WHEN** every task in a present, readable task source carries the marker
- **THEN** the epic renders as having a progress source with nothing outstanding, and no
  missing-source warning is emitted

### Requirement: The emitted instructions require the declaration to be written
The conductor does not author task sources — OpenSpec and the agent do — so the declaration only
ever appears if the instructions this plugin emits ask for it. The managed rules block and the
session brief SHALL therefore instruct the agent to mark a lifecycle-bookkeeping task with
`<!-- pm:lifecycle -->` at the moment the task source is authored or amended, and SHALL name the
self-referential archive task as the case that always qualifies. This is an instruction-layer
obligation: the engine emits the rule and never edits a task source itself.

Without this, exclusion is expressible and never exercised — an unmarked archive task still counts
as outstanding by the definition above, so an archive guard keyed on that definition still refuses
every correctly finished change. The declaration is the only thing standing between the two, and
nothing else in this capability causes it to exist.

The instructions SHALL also cover amendment, not only authoring: a task source written before this
capability carries no marker, and the agent finishing such a change is the only party positioned to
add one. This change's own task source is an in-flight instance of exactly that case.

#### Scenario: A generated archive task carries the declaration
- **WHEN** an agent following the emitted rules authors a task source containing a task that
  instructs it to archive that very change
- **THEN** that task carries `<!-- pm:lifecycle -->`, and the epic's outstanding work at archive
  time is zero rather than one

#### Scenario: A pre-existing task source is amended rather than left to refuse
- **WHEN** an agent reaches archive time on a change whose task source predates this capability and
  whose only unticked task is the archive instruction
- **THEN** the emitted instructions direct it to add the declaration to that task, and the engine
  neither adds nor infers the marker on its own

### Requirement: sync reconciles the archive directory
`sync` SHALL reconcile `openspec/changes/archive/` in addition to `openspec/changes/`. An archived
change on disk with no corresponding epic SHALL be registered as an epic already in `status:
"archived"` — preserving the record without pretending the change was managed. `reconcileArchived()`
only flips epics that already exist and MUST continue to create nothing; registration is `sync`'s
job.

#### Scenario: An archived change with no epic is registered
- **WHEN** `sync` runs in a repo with 24 archived changes on disk and 8 of them have no epic
- **THEN** 8 epics are registered, each with `status: "archived"`, and the conductor's archived count
  matches the directory

#### Scenario: A change archived before the conductor was initialized is not lost
- **WHEN** a change was archived before `/pm:init` ever ran in the repo
- **THEN** the next reconciliation registers it, rather than it remaining permanently invisible
  because it was never active while a sync ran

### Requirement: Archive registration cannot produce duplicate epics
Identity for archive registration SHALL be the change id, derived identically to the way
`isArchived()` matches it — an archive directory named `<YYYY-MM-DD>-<id>` and one named `<id>`
resolve to the same id, and neither may register a second epic for a change the conductor already
holds. This registration path MUST NOT become a third way to produce duplicates alongside the
over-registration behaviors already filed against `sync`.

#### Scenario: A date-prefixed archive directory does not duplicate its epic
- **WHEN** the archive contains `archive/2026-08-01-port-domain-health-system` and an epic
  `port-domain-health-system` already exists
- **THEN** no new epic is created, and the existing epic is used

#### Scenario: Re-running sync after a backfill adds nothing
- **WHEN** `sync` is run again immediately after an archive reconciliation registered new epics
- **THEN** zero epics are added and no epic is modified

#### Scenario: An active change and its archived form are one epic
- **WHEN** a change registered while active is later archived and `sync` runs
- **THEN** the existing epic flips to `archived` and no second epic is registered for the archive
  directory

### Requirement: The backfill is visible, one-time, and announced
Registering historical archived changes SHALL be a deliberate, announced action, never a silent side
effect of a routine `sync`. The engine MUST report what it registered — the count and the ids — and
MUST NOT alter a repo's epic counts without saying so, because those counts are the input to every
effectiveness measurement taken from conductor state. Once the backfill has run, subsequent
reconciliation is forward-only: it registers changes archived since, and MUST NOT re-announce or
re-register history.

Whether the backfill has run SHALL be persisted on `.conductor/state.json` as `archiveBackfilledAt`,
an ISO timestamp whose PRESENCE is the marker and whose value records when. It is deliberately not a
watermark: forward-only registration derives from "this archived change has no epic", so nothing is
ever compared against the timestamp, and the field's only behavioral job is to decide whether a
registration run announces itself as the historical backfill or proceeds as routine forward
reconciliation. A state file carrying no `archiveBackfilledAt` — including every state file written
before this capability — SHALL load unchanged and be treated as not yet backfilled.

#### Scenario: The one-time backfill announces what it changed and records that it ran
- **WHEN** the archive backfill runs for the first time in a repo and registers 8 historical epics
- **THEN** it reports the count and the ids it registered, so the change in the repo's numbers is
  attributable, and `archiveBackfilledAt` is written to `.conductor/state.json`

#### Scenario: A routine sync does not silently backfill
- **WHEN** `sync` runs in a repo whose state already carries `archiveBackfilledAt`
- **THEN** no historical epic is registered or re-announced, and only changes archived since are
  picked up, without a backfill announcement

#### Scenario: State written before this capability backfills once
- **WHEN** `sync` runs against a state file that has no `archiveBackfilledAt` field
- **THEN** the state loads unchanged, the backfill runs and announces once, and the field is
  written so the next run does not repeat it

### Requirement: A backfilled epic is distinguishable from a managed one
Every epic the archive backfill registers SHALL be stamped by the ENGINE as having been registered
by that path — unconditionally, for every backfilled epic, and never by the agent. The stamp SHALL
be the field `recordedBy` on the epic's terminal disposition record, carrying the literal value
`archive-backfill`, alongside the `unknown` terminal outcome that `epic-disposition` reserves for
work whose disposition was never recorded. It is a named field precisely so a consumer keys on data
rather than parsing a free-text reason; the reason MAY additionally name the path for a human
reader, but no consumer may depend on that prose.

`recordedBy` is the general form of the same stamp every non-interactive path needs — the engine
records which path wrote a disposition nobody chose — so any other path in this release that stamps
an outcome the agent did not supply SHALL use this field with its own path name as the value.

A backfilled epic never passed through the conductor while it was in flight. It has no gate verdict,
no start time, and — where the change was abandoned — no ticked tasks. Those are properties of a
record reconstructed from disk, not of a badly managed epic. The stamp exists so that a check or a
refusal keyed on any of those properties can tell the two apart. Without it, the first run of the
backfill fills the repo's integrity report with findings against changes that were archived long
before the conductor could have guarded them.

The stamp MUST NOT be conditional on the backfilled epic's task counts, its lane, or any other
property — conditioning it would reintroduce exactly the engine-side classifier this capability
rules out elsewhere.

#### Scenario: A backfilled epic carries its origin as data
- **WHEN** the backfill registers an archived change as an epic
- **THEN** the epic carries the `unknown` outcome and `recordedBy: "archive-backfill"`, readable as
  a field without parsing a free-text reason

#### Scenario: Every backfilled epic is stamped, not only the incomplete ones
- **WHEN** the backfill registers one change whose tasks are fully ticked and one archived with 12
  tasks unticked
- **THEN** both epics carry the stamp, and neither is distinguished from the other by whether it was
  stamped

#### Scenario: The stamp is not available to the agent
- **WHEN** an epic is created by any path other than the archive backfill
- **THEN** it does not carry the backfill stamp, and no CLI flag lets the agent apply one

### Requirement: A backfilled epic carries its real delivery evidence
An epic registered from the archive SHALL carry the task-completion evidence recorded in its
archived artifacts. Its progress MUST read those counts, and MUST NOT render as `0/0` or as an em
dash because the engine looked for a task source where an ACTIVE change would keep one and an
archived epic's missing source is suppressed rather than warned about. A change archived with 12 of
its tasks still unticked is the most informative row in the whole audit; registering it without its
counts preserves the row and discards the only evidence that makes the row worth preserving.

#### Scenario: An abandoned change registers with its unticked count intact
- **WHEN** `log-collector-not-applicable` is registered from the archive with 12 of its tasks
  unticked
- **THEN** its progress reflects those 12 unticked tasks rather than rendering `0/0` or an em dash

#### Scenario: A fully delivered archived change registers as complete
- **WHEN** an archived change whose task source is fully ticked is registered
- **THEN** its progress renders as complete, distinguishable from the abandoned case above

### Requirement: A checkbox is a claim, not evidence
Progress derived from checkbox state SHALL be presented as **claimed** completion, and this
capability explicitly does not assert that a ticked task was actually delivered. The bound is
measured, not theoretical: in an 18-epic sample, 3 ticked tasks hid undone work — one still
defective at HEAD, verified by executing the real renderer — and all 3 unticked boxes were non-work.
The errors are asymmetric toward over-reporting completion. Nothing in this capability verifies a
claim; verification is the gates' job, and any consumer that treats a progress figure as evidence of
delivery MUST be considered out of contract.

#### Scenario: Progress is labelled as a claim where it is presented
- **WHEN** `PROJECT.md`, the briefing, or `/pm:next` presents an epic's checkbox-derived progress
- **THEN** it is presented as claimed completion rather than verified delivery, so a reader does not
  mistake `12/12` for evidence that the work is correct

#### Scenario: A fully ticked epic still carries no delivery assurance
- **WHEN** an epic's tasks are all ticked but its Gate 2 verdict is absent or failing
- **THEN** this capability makes no claim that the epic delivered, and the archive-time disposition
  and gate requirements remain the authority on that question

### Requirement: An epic records when it was registered and when it was last touched
Every epic SHALL carry the moment it was registered and the moment it was last modified. Without
the first, no surface can answer how long an epic has sat, because an epic registered and never
started carries no other date: `startedAt` is absent by definition for that population, and it is
exactly the population a staleness question is about.

The registration date SHALL be written at the single sink every epic creation routes through, and
SHALL NOT be bound to an enumeration of creation surfaces. That enumeration approach has already
been tried in this engine for a sibling field and already went stale — two creation paths carried
the rule, two did not, and no consumer complained, because absence was forgiven by the very gate
meant to catch it. Binding at the sink inherits the source scan that already forbids bypassing it.
The registration date SHALL NOT be rewritten by any later mutation.

The last-touched date SHALL be advanced only for records whose stored content changed, and the
mechanism SHALL respect the no-op save requirement the `state-write-guard` capability owns: a save
that changes nothing writes nothing and therefore touches nothing. Neither timekeeping field SHALL
be an input to that comparison — writing a registration date is not itself a touch, whether it
happens during the release migration or during a later standalone re-run of the recovery.

Both SHALL be absent-tolerant: an epic written by an earlier version carries neither, and any
reader SHALL treat absence as "unknown", never as a date — never substituting another field's date
and never substituting the current time. Registration records when pm learned of the work, NOT how
old the work is: a historical change registered today is correctly stamped today.

This capability specifies STORAGE and absence tolerance only. What a staleness surface DISPLAYS is
deliberately out of scope here and belongs to the recurring grooming pass that consumes these
fields; specifying a reader in the same change that introduces the field it reads would put a
requirement in this delta that nothing in this delta implements.

#### Scenario: A newly registered epic carries its registration date
- **WHEN** an epic is registered by any path
- **THEN** it carries a registration timestamp, and that timestamp is unchanged by every subsequent
  mutation of that epic

#### Scenario: A creation path cannot omit the stamp
- **WHEN** a new epic-creating path is added that does not route through the creation sink
- **THEN** the suite fails, rather than the new path producing epics with no registration date

#### Scenario: A mutation advances the last-touched date
- **WHEN** a mutation changes an epic's stored content
- **THEN** that epic's last-touched timestamp is advanced, its registration timestamp is not, and
  epics whose content did not change are not advanced

#### Scenario: An epic from an earlier version reports unknown, not a date
- **WHEN** a reader encounters an epic carrying no registration timestamp
- **THEN** it reports the registration date as unknown, and never substitutes another field's date
  or the current time

### Requirement: Registration dates are recovered from history by a re-runnable operation
The operation that populates registration dates from history SHALL be re-runnable, and the release
migration SHALL invoke it rather than performing the recovery itself.

A migration entry runs at most once per repository, keyed to the stamped version. An operation that
reads version-control history produces a different result per checkout — two checkouts of one
remote differ by whatever history each has fetched — so performing the recovery inside a one-shot
migration freezes a wrong answer permanently in the checkout that had less history at that moment,
and it never recovers when that checkout catches up. This is a distinct constraint from the network
law and is stated in the engine's own migration framework.

Where the state file is tracked, the commit that first introduced an epic's id into it SHALL be the
source of that epic's registration date. A commit at a SHALLOW BOUNDARY SHALL NOT be
accepted as that source. Git has cut such a commit's parents, so it diffs against nothing and reports
every id in the file as introduced there — a naive search would hand an entire archive one fabricated
date and record it as fact, which is precisely the outcome the absence rule exists to prevent. A
boundary hit SHALL yield ABSENT, and SHALL remain re-attemptable: unshallowing the clone and
re-running recovers the real dates, which is the case the re-runnable requirement above exists for. Where no such evidence is recoverable — the file is
untracked, the history is shallow, or the id predates the tracked history — the date SHALL be left
absent, absence SHALL mean unknown, and a later run SHALL be free to recover it.

The operation SHALL be idempotent and SHALL NOT overwrite a date already present. It SHALL read
only local version-control history, invoked with an argument vector rather than a shell string,
because epic ids are read from a state file that may predate the id validation now applied at
registration.

The release migration SHALL leave the last-touched date ABSENT on pre-existing epics rather than
stamping its own run time. This is a consequence of the exclusion above and not a separate rule: the
migration writes registration dates across the whole archive in one save, so without excluding the
timekeeping fields from the per-record comparison every epic in every repository would read as last
touched on upgrade day. Stamping it would record every epic in the fleet as last touched on
upgrade day, which is the same signal destruction this specification rejects for the registration
date.

#### Scenario: A recovery finds a real date from tracked history
- **WHEN** the operation runs where the state file is tracked and the history contains the commit
  that introduced an epic's id
- **THEN** that epic's registration date is that commit's date, not the run time

#### Scenario: An unrecoverable date is left absent and stays re-attemptable
- **WHEN** the operation cannot recover an epic's introducing commit
- **THEN** the date is left absent, no date is fabricated, and a later run in a checkout with more
  history recovers it

#### Scenario: Re-running never overwrites a recovered date
- **WHEN** the operation runs again over epics whose dates it already recovered
- **THEN** no already-present date changes

#### Scenario: The migration does not stamp last-touched
- **WHEN** the release migration runs over a state file of pre-existing epics and the 0.40.0 entry
  is the only pending one
- **THEN** no epic carries a last-touched date as a result of that entry's own write

> Scoped to the 0.40.0 entry deliberately. `upgrade()` applies EVERY pending migration plus the
> archive-drift heal to one in-memory state and calls `saveState` once, so a repository lagging
> far enough back runs an earlier entry in the same write — and an epic that entry genuinely
> modified WAS touched. The claim being made is about this entry, not about the save it happens to
> share. The general form of it is the delta-shaped one the sibling scenario already states: a
> record whose only change is a recovered registration date is not touched.

### Requirement: A detached HEAD suppresses session-bookkeeping writes

The engine MUST NOT write **session bookkeeping** into a working tree whose HEAD is detached.

Session bookkeeping is defined by a CRITERION, not by a list: a file the engine writes that is
**per-checkout, engine-owned, and a record of work in progress rather than of the project**. The
enumeration below is every `.conductor/` write site the engine has, each settled against that
criterion — so a site added later is measured against the definition rather than silently falling
outside a closed list.

| write site | file | suppressed? |
| --- | --- | --- |
| `commit-watch.mjs` | `commit-watch.json` | YES — a watermark for a session's own commits |
| `git.mjs` `appendDetourLog()` | `detours.log` | YES — a record of interrupting active work |
| `subcommands.mjs` | `brief.txt` | YES — a snapshot for the next session in this tree |
| `activity-log.mjs` | `activity/*.log` | YES — per-session event trail |
| `claims.mjs` | `session-claim.json` | YES — it says "THIS session is mid-operation in THIS working tree", which is the criterion stated aloud |
| `write-conflicts.mjs` | `write-conflicts.log`, `.latch` | NO — see below |
| `subcommands.mjs` | `honcho-memories.log` | NO — see below |
| `render.mjs` | `render-stamp.json` | NO — see below |
| `state.mjs` | `state.json.lock` | NO — see below |
| `state.mjs` | `state.json.lock.break` | NO — see below |

**`write-conflicts.log` and its latch are NOT suppressed.** They record that two writers collided,
which is a fact about the repository rather than about a session, and the latch is consumed by
`brief` — a verb declared `read-only`, so the warning half of this change cannot reach it either.
Suppressing it would be the only case here where suppression loses evidence of a real problem.

**`honcho-memories.log` is NOT suppressed.** It is an append-only outbox of lines the operator is
meant to paste elsewhere, so a missing line is work lost rather than noise avoided. It is also not
gitignored, which makes its absence visible rather than silent.

**`render-stamp.json` is NOT suppressed, and this is the consequential one.** It is written by
`render()` on essentially every mutating verb, and it is TRACKED — measured dirty in the deployed
tree this change was proposed against. It is not session bookkeeping: it records when the project's
own rendered output was produced. Leaving it writing means a mutating verb in a detached tree still
dirties a tracked file, which is precisely what the warning in `state-write-guard` exists to
announce. Suppressing it here would make the warning's subject disappear and would leave
`PROJECT.md` and the stamp disagreeing about when they were produced.

**`state.json.lock` and `state.json.lock.break` are NOT suppressed.** They are per-checkout and
engine-owned, but neither is a record of anything: the lock exists only for the duration of a
`state.json` save, the break lock only while a stale lock is being removed, and that save is not
suppressed in a detached tree. Suppressing the lock would leave the save unserialised in exactly the tree whose writes
already go unnoticed, which is the lost-update window `state-write-guard` closes.

> The dormancy guard asks whether `.conductor/state.json` exists, and that file is git-tracked so
> the documented `git restore` undo works. In a repository that deploys by checking ITSELF out, the
> deployed copy therefore carries `state.json` and reads as a workspace. One file is answering two
> questions — *is this repository pm-managed* and *is this tree a place to work* — which diverge
> exactly there.
>
> Suppression is SILENT for these, because a file that does not appear asserts nothing, where a
> warning about one would fire on every hook invocation.

#### Scenario: The commit watermark is not written in a detached tree

- **WHEN** the commit-nudge hook runs in a working tree whose HEAD is detached
- **THEN** the hook exits 0 and produces its normal output, AND no commit watermark file is created
  or updated in that tree

#### Scenario: The detour log is not written in a detached tree

- **WHEN** a detour would be logged in a working tree whose HEAD is detached
- **THEN** the verb completes and reports as it normally would, AND no detour log entry is written

#### Scenario: The brief snapshot, the activity log and the session claim are not written in a detached tree

- **WHEN** a snapshot, an activity event, or a session claim would be written in a working tree
  whose HEAD is detached
- **THEN** the invoking verb completes and reports as it normally would, AND none of the three is
  written

> Every suppression scenario asserts the POSITIVE half as well as the absence. An absence passes
> just as happily when the hook never fired, when the repository is not initialized, when the
> directory is unwritable, or when the feature does not exist at all — which is the vacuous-pass
> shape this repository has a standing rule against.

#### Scenario: commit-nudge in a detached tree does not fall back to the text heuristic

- **WHEN** the commit-nudge hook runs repeatedly in a working tree whose HEAD is detached
- **THEN** it does not nudge on the basis of command text alone

> Suppressing the watermark alone would leave `readWatch()` returning null forever, so every
> invocation reads `unverifiable / no-baseline` and falls through to the PRE-OBSERVATION text
> heuristic — `gh#104`'s behaviour, where any command merely mentioning `git commit` fires the
> nudge, reinstated permanently in exactly the tree where noise is least wanted, and reaching a
> `state.json` write on the way. Suppressing the WATERMARK requires suppressing the hook's
> REACTION; a gap in the watermark is otherwise safe (no false `landed` is constructible from a
> stale baseline, because the classifier also requires a matching reflog entry) but the fallback
> is not.

#### Scenario: A state save in a detached tree is still serialised

- **WHEN** a live, fresh state lock is held by another process in a working tree whose HEAD is
  detached, and a mutating verb saves state there
- **THEN** the save does not write while that lock is held, exactly as it would on a branch

#### Scenario: A tree on a branch is unaffected

- **WHEN** any of those writes happens in a working tree whose HEAD is on a branch
- **THEN** it happens exactly as it did before, with no suppression and no additional output

#### Scenario: A repository git cannot answer about is treated as a workspace

- **WHEN** the detachment probe cannot answer — not a repository, git absent from PATH, or the
  command fails for any reason other than reporting a detached HEAD
- **THEN** the engine treats the tree as a workspace and writes normally

> The safe direction is to keep recording. A false record is visible and removable; a false
> SUPPRESSION silently disables the trail, which is the same asymmetry `isConductorOwnFiles`
> already states. This is why the probe must distinguish "git says detached" from "git could not
> say" — see the design's exit-status rule.

#### Scenario: The probe answers about the tree being written to

- **WHEN** the engine's root and the process working directory are different trees
- **THEN** the detachment answer is the one for the root being written to, not the working directory

> `ROOT` is `CLAUDE_PROJECT_DIR || process.cwd()`, and the warning this change adds prints beside
> an existing one that exists PRECISELY for the case where those differ. A probe on the wrong tree
> would put two sentences about two different trees in one message, and nothing would detect it.

### Requirement: An advisory claim's lifetime is bounded, and an unreadable expiry reads as expired

A claim's TTL SHALL be bounded by a fixed maximum number of minutes, and the bound SHALL be one
definition shared by the verbs that write a claim and the readers that judge one.

At input, `claim <epic-id>` and `claim --repo` SHALL refuse a `--ttl` that is not a finite number
greater than zero and no greater than the maximum: exit non-zero, name the maximum, and write
nothing — neither `state.json` nor `.conductor/session-claim.json`.

A claim already on disk SHALL be judged without throwing. A claim whose expiry cannot be computed —
its `claimedAt` does not parse, its `ttlMinutes` is not a finite positive number, its `ttlMinutes`
exceeds the maximum, or `claimedAt` plus the TTL is not a representable date — has NO expiry and
reads as EXPIRED, never as live. This holds for an epic claim and for the repository claim alike,
and for every reader: `owners`, `integrity`, and `claim`/`unclaim` judging another session's claim,
with or without `--steal`.

> Expired, not live, and the direction is chosen: an unreadable marker read as live would block every
> other session with no way to reason about when it stops. A claim written by an earlier engine with
> a TTL above the new maximum therefore reads as expired after upgrade; the holder re-claims. A
> reader that throws is worse than either reading: in the reproduction, one `claim --ttl 1e12` made
> `owners`, `integrity` and every other session's `claim`/`unclaim` crash on every later invocation.

#### Scenario: An oversized TTL is refused at input

- **WHEN** `claim <epic-id> --session s1 --ttl 1e12` is run
- **THEN** it exits non-zero, the message names the maximum, and `state.json` is byte-identical
  afterwards

#### Scenario: An oversized repository TTL is refused at input

- **WHEN** `claim --repo --session s1 --ttl 1e12` is run
- **THEN** it exits non-zero and `.conductor/session-claim.json` is not created or changed

#### Scenario: The maximum itself is accepted

- **WHEN** `claim <epic-id> --session s1 --ttl <the maximum>` is run
- **THEN** the claim is written and the report names its expiry

#### Scenario: A poisoned epic claim already on disk reads as expired

- **WHEN** an epic's stored claim carries `ttlMinutes: 1000000000000`, and `owners`, `integrity`, and
  `claim <epic-id> --session s2` are each run
- **THEN** none of them throws; `owners` reports the claim as not live; `integrity` reports it as
  expired at an unreadable time; and the claim by `s2` succeeds without `--steal`, reporting that the
  previous claim had expired

#### Scenario: A poisoned repository claim already on disk reads as expired

- **WHEN** `.conductor/session-claim.json` carries `ttlMinutes: 1000000000000` and `owners` is run
- **THEN** it exits 0 and reports the repository claim as not live
