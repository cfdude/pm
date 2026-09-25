## MODIFIED Requirements

### Requirement: Unfinished work at archive records where it went
Archiving an epic that **has outstanding work** SHALL require a handoff disposition: a `carried-to`
reference naming the epic that now owns the work, with which tasks, as the reason.

**THE NAMED RECEIVER SHALL BE A REAL, OTHER EPIC.** A handoff is the one thing standing between
outstanding work and its disappearance, so the reference SHALL be refused, writing nothing and
exiting non-zero, when it is **empty**, names an epic **the record does not hold**, or names **the
epic being archived**. The refusal SHALL name the offending value and which of the three it is.

The self-reference is the sharpest of the three and is the reason this rule is stated here rather
than left to the read-only integrity check. A handoff to the archiving epic satisfies the guard
while conveying nothing: the work is recorded as owned by a record that has just ended, the gate
that exists to stop a remainder vanishing reports success, and a reader afterwards cannot
distinguish it from a genuine handoff. Every id-storing sibling in the record validates its target;
this one did not.

**The demand binds `outcome: delivered` only** — the same binding the archive gate takes in
`gate-integrity`, for the same reason. `killed`, `superseded` and `abandoned` already carry a
required reason that answers where the work went: nowhere, and why. A change killed at Gate 1 with
no code written has every task outstanding by construction, so a handoff demand that bound every
outcome would refuse the exact archive this release exists to make recordable. `carried-to` is how
a *delivered* epic accounts for a remainder it did not finish. **The validation above, unlike the
demand, binds wherever the reference is supplied**: a receiver named alongside any outcome is a
claim about where work went, and a false one is no less false for accompanying a `killed`.

This MUST NOT block a legitimate archive — the archive proceeds once the handoff is recorded. Both the archiving epic and the
receiving epic MUST show the relationship in `PROJECT.md` and the briefing. The link vocabulary
already accepts a free-form type, so no new link type is required; what does not exist today is the
prompt at the transition and the rendering on both ends.

**"Has outstanding work" is the quantity the `conductor-record` capability defines, and this guard
SHALL key on it rather than counting unticked checkboxes for itself.** The two are not the same: a
change's own task list carries a task instructing the agent to archive it, which is unticked at
archive time by construction, so a guard reading raw checkbox state would demand a handoff for
every fully delivered change and the release would ship a guard that refuses its own success case.
The refusal MUST state the same count the record renders for that epic.

**The refusal MUST name BOTH remedies.** The exclusion `conductor-record` defines is marker-gated,
so a task source authored before this release — carrying a real archive instruction with no
`<!-- pm:lifecycle -->` declaration — still counts that item as outstanding and still refuses.
There are therefore two correct responses to this refusal, and the message SHALL name each: record
a `carried-to` reference where work genuinely moved to another epic, **or** add the
`<!-- pm:lifecycle -->` declaration, quoted as that literal token, where the outstanding item is
lifecycle bookkeeping rather than delivery. A refusal naming only the handoff steers an agent
holding a fully delivered change toward inventing a receiver for work nobody carried anywhere,
which is a fabricated record produced by a guard built to prevent fabricated records.

**The refusal names the remedy for EACH part that contributes outstanding work.** An epic's
outstanding work is the union `conductor-record` defines: its **story part** (undisposed inline
stories) and its **checkbox source** (a plan file, or an openspec change's `tasks.md`, archived or
live). One remedy covers the whole union, and the others each reach only their own part:

- a `carried-to` reference is the handoff this requirement demands, and it accounts for ALL the
  outstanding work, stories and tasks alike; where both parts contribute, its reason SHALL say which
  stories and which tasks moved;
- the per-item remedies reach one part only: for the checkbox source, the `<!-- pm:lifecycle -->`
  declaration where the open item is bookkeeping; for the story part, `--story <n> --done` where the
  story shipped, or `--story <n> --wont-do "<reason>"` where it will not be done. The lifecycle marker
  has nowhere to be written for a story, and no story verb ticks a task.

Where both parts contribute, the refusal SHALL name the per-item remedies of BOTH parts, each against
the part it clears, as well as the handoff. Naming one part's per-item remedy alone leaves the agent a
remedy that, followed, is refused again on the other part. A shipped story is named for
`--story <n> --done` before any handoff, so that it is recorded as delivered rather than as carried
elsewhere; that ordering keeps the record honest and is not itself a refusal. The refusal decides
which remedies to name from each part's own open count, never from a single source label, because
under the union an epic has no single source.

The guard binds the **interactive archive verb** only. Every other archive path `gate-integrity`
enumerates — the **archive-drift heal**, the **archive backfill registration** and the two
**archived-at-creation paths** — MUST NOT be bound by it: the backfill is required to register
historical changes with their unticked counts intact, including the one genuinely abandoned change
in the audited archive, and none of those paths receives a named receiver from anyone.

#### Scenario: Archiving with outstanding work and a named receiver
- **WHEN** an epic is archived with 3 of 81 tasks deliberately un-ticked and the agent records
  `carried-to` the epic that inherited them
- **THEN** the archive succeeds, the archived epic renders as having carried work out, and the
  receiving epic renders what it inherited

#### Scenario: Archiving as delivered with outstanding work and no handoff is refused
- **WHEN** an epic with outstanding work is archived through the interactive verb as
  `outcome: delivered` with no `carried-to` reference
- **THEN** the transition is refused, stating the same outstanding count the record renders, so the
  handoff cannot vanish silently

#### Scenario: A handoff naming the archiving epic itself is refused
- **WHEN** an epic holding outstanding work is archived through the interactive verb as
  `outcome: delivered` with a `carried-to` reference naming that same epic
- **THEN** the command exits non-zero saying an epic cannot carry work to itself, the epic is not
  archived, and the state of record is byte-identical to before the call

#### Scenario: A handoff naming an epic the record does not hold is refused
- **WHEN** an epic is archived through the interactive verb with a `carried-to` reference to an id
  no epic in the record carries
- **THEN** the command exits non-zero naming that id as unknown, and the state of record is
  byte-identical to before the call

#### Scenario: A handoff supplied alongside a non-delivered outcome is validated too
- **WHEN** an epic is archived through the interactive verb with `outcome: killed`, its reason, and
  a `carried-to` reference naming an id no epic carries
- **THEN** the command exits non-zero, because the reference is a claim about where work went
  whether or not this outcome demanded one

#### Scenario: The refusal names the declaration as well as the handoff
- **WHEN** a fully delivered change is archived through the interactive verb and its only
  outstanding item is an un-declared archive instruction in a task source written before this
  release
- **THEN** the refusal names both remedies — record a `carried-to` reference, or mark the item with
  the literal `<!-- pm:lifecycle -->` declaration — so the agent is not steered into naming a
  receiver for work that went nowhere

#### Scenario: A refusal over both parts names the remedy for each
- **WHEN** an openspec-lane epic whose `tasks.md` holds one open undeclared task also carries one open
  inline story, and it is archived through the interactive verb as `outcome: delivered` with no
  `carried-to` reference
- **THEN** the refusal states the outstanding count of 2 the record renders, names the story's own
  remedy (`--story <n> --done` or `--wont-do`) against the story, the task's own remedy (the
  `<!-- pm:lifecycle -->` declaration) against the task, and the `carried-to` handoff as the one remedy
  covering both, and the state of record is byte-identical to before the call

#### Scenario: A killed epic with every task outstanding needs no handoff
- **WHEN** an epic is archived with `outcome: killed` and its reason, with all 47 of its tasks
  outstanding because no code was ever written
- **THEN** the archive succeeds and no `carried-to` reference is demanded, because the recorded
  reason already accounts for the work — the same archive `gate-integrity` requires to succeed
  without a Gate 2 verdict

#### Scenario: The change's own archive instruction alone demands no handoff
- **WHEN** a fully delivered change is archived and the only item its task source leaves unticked is
  the lifecycle-bookkeeping task instructing the agent to archive this very change, carrying the
  declaration marker that `conductor-record` requires for exclusion
- **THEN** the archive succeeds with no handoff demanded, because the epic's outstanding work is
  zero; a guard that refused here would refuse every correctly finished change in the repository

#### Scenario: A backfilled archived epic is not asked for a handoff
- **WHEN** the archive backfill registration registers a historical archived change carrying
  unticked tasks
- **THEN** it registers as `archived` with those counts intact and no handoff is demanded, because
  no agent is present on that path and the counts are the evidence the backfill exists to preserve


### Requirement: The archive can be asked which of its records carry no considered outcome
The engine SHALL be able to enumerate the archived epics whose outcome nobody considered, and SHALL
emit, per epic, the invocation that would record one.

That population is precisely the epics carrying an ENGINE-WRITTEN stamp whose outcome value is
`unknown`. Both halves are load-bearing. An engine stamp alone is not enough: a stamp can be
evidence-derived, and this repository holds three epics stamped `delivered` by migration from a
passing Gate 2 verdict — handing those to an agent to re-dispose would ask it to re-derive what the
record already derived correctly. An `unknown` value alone is not enough either, since `unknown` is
never an agent's answer and can only arrive by stamp.

An absent disposition SHALL NOT be part of the population. Absence is not a state an archived epic
reaches: every archive path binds the outcome invariant, and the migration stamped every
pre-existing archived epic. A predicate handling absence would be handling a state no path produces.

Measured in this repository, 66 of 144 archived epics match — 46% of the archive — with 3
evidence-derived stamps correctly excluded and 75 agent-recorded outcomes untouched. The cost of
that gap is not cosmetic: a grooming pass hit it four separate times and reconstructed from commit
history what the record should have stated, and a user filed an issue reporting work that had in
fact been done, because the epic proposing it archived with nothing saying so.

**The emitted invocation SHALL offer only outcomes the archive gate would accept for that epic.**
Where recording `delivered` is blocked by an obligation the archive gate enforces — for an
openspec-lane epic, a missing, withdrawn or stale Gate 2 — the entry SHALL NOT offer `delivered` in
its invocation, and SHALL name each blocking obligation in a machine-readable field, together with
the remedy that meets it. That field is an ORDERED list, and its order is the order the remedies must
run: every Gate 2 obligation before the handoff, because the `delivered` archive that meets a checkbox
source's handoff is itself refused while Gate 2 is unmet. gh-189 measured the cost: of 20 epics reported, all 12 openspec-lane
entries were refused when `delivered` was substituted, and nothing in the output said they would be.
Where the blocking obligation is a Gate 2 that the epic predates, the entry states that recording
`delivered` requires a real Gate 2 review of that work — the finding is about process, not a
bookkeeping obstacle. The `integrity` remedy for an epic in an undefined status SHALL apply the
same rule.

**One rendering is excepted: update-epic's refusal of an edit that would break an archived
`delivered` record.** That epic's outcome is already `delivered` and was considered; the refusal
exists so the edit can be made without losing it. Its remedy SHALL keep `delivered` and SHALL name
first the re-record that restores the broken obligation (for a Gate 2, the verdict over the range
that now covers the attributed commits), then the disposition invocation. Where the edit would leave
the record attributing no commits (it withdraws the last one), a re-record cannot restore the
obligation alone: the remedy SHALL name the Gate 2 re-record over the commit that replaces the
withdrawn one, then that commit's `--attribute-commit`, then the invocation.

#### Scenario: The unconsidered set is enumerable with its remedy
- **WHEN** an agent asks the engine which archived epics carry no considered outcome
- **THEN** it receives those epics and, for each, the invocation that would record a disposition

#### Scenario: An evidence-derived engine stamp is excluded
- **WHEN** an archived epic carries an engine-written outcome other than `unknown`
- **THEN** it does NOT appear in the unconsidered set

#### Scenario: An agent-recorded outcome is excluded
- **WHEN** an archived epic carries an agent-recorded outcome
- **THEN** it does NOT appear in the unconsidered set

#### Scenario: An archive with every outcome considered reports an empty set
- **WHEN** no archived epic carries an engine-written `unknown`
- **THEN** the unconsidered set is empty

#### Scenario: An openspec-lane entry without Gate 2 does not offer delivered
- **WHEN** the unconsidered set holds an openspec-lane epic with no passing Gate 2
- **THEN** its invocation's outcome choices exclude `delivered`, its entry names the Gate 2 obligation
  and the remedy that records one, and running the invocation with any outcome it offers (and a
  reason) exits zero (today `delivered` is offered and exits 1)

#### Scenario: An entry the gate does not bind still offers delivered
- **WHEN** the unconsidered set holds a `claude-code`-lane epic
- **THEN** its invocation offers `delivered` and names no blocking obligation, and running it with
  `delivered` exits zero

#### Scenario: An entry blocked by open work names the way past it
- **WHEN** the unconsidered set holds an epic whose outstanding work comes from ONE part only — a
  checkbox source with a task open and no open story, or a story-only epic with an open inline story
- **THEN** its entry names the handoff obligation with a remedy that is never empty: for the checkbox
  source, the `delivered` archive carrying `--carried-to <epicId>` and `--reason`, which filled with a
  receiving epic exits zero and removes the entry; for the story-only epic, `--story <n> --done`,
  after which the entry names nothing blocking `delivered` (before Gate 2 U-I1 the checkbox entry's
  remedy was empty)

#### Scenario: An entry blocked by open work in both parts names both remedies
- **WHEN** the unconsidered set holds an epic with an open inline story AND a checkbox source with a
  task open, which `conductor-record` counts as one union
- **THEN** its entry's handoff obligation names both remedies; after `--story <n> --done` alone the
  entry STILL names the handoff obligation, now for the open task only; and following that with the
  `delivered` archive carrying `--carried-to <epicId>` and `--reason`, filled with a receiving epic,
  exits zero and removes the entry. Recording the story alone is not the way past a union with a
  task still open

#### Scenario: An entry blocked twice lists its remedies in the order they run
- **WHEN** the unconsidered set holds an openspec-lane epic with no passing Gate 2 whose task source is a
  checkbox file with a task open
- **THEN** its entry names the Gate 2 obligation first and the handoff second; running the handoff's
  archive first is refused on the missing Gate 2; and running every entry's remedy lines in the order
  listed, filled with a range and a receiving epic, exits zero at each step and removes the entry

#### Scenario: The archived-delivered regression refusal keeps delivered
- **WHEN** an `--attribute-commit` on an archived `delivered` openspec-lane epic is refused because
  its passing Gate 2 would no longer reach the attributed commits
- **THEN** the refusal names the Gate 2 re-record first, its printed invocation still offers
  `delivered`, and following both in order with the range filled by meaning exits zero

#### Scenario: The integrity remedy for an undefined status follows the same rule
- **WHEN** `integrity` reports an openspec-lane epic with no passing Gate 2 sitting in an undefined
  status
- **THEN** the archive invocation it prints does not offer `delivered`
