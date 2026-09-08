## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: An epic that ends records its outcome
An epic reaching `status: "archived"` SHALL carry an `outcome` alongside that status, drawn from
`delivered` | `killed` | `superseded` | `abandoned` | `declined` | `unreconstructable` | `unknown`.
`outcome` is a distinct field from `status`, not a new status value — an epic is still `archived`,
and every existing status-driven behavior is unchanged. `delivered` MAY omit a reason; `killed`,
`superseded`, `abandoned`, `declined` and `unreconstructable` MUST carry one. This capability
defines the record's shape; **which archive paths exist, and which outcome the Gate 2 requirement
binds, are enumerated by the `gate-integrity` capability** and are not restated here.

`unknown` is never an agent's answer — it is the engine saying nobody recorded one.

`unreconstructable` IS an agent's answer, and it is the one this release adds: it records that
somebody looked for the evidence of what happened and the evidence does not exist. It is
deliberately distinct from `unknown`, which says nobody looked, and from any reconstructed outcome,
which says somebody looked and found. A fabricated disposition is worse than an absent one — an
absent outcome is visibly a gap, while an invented one is indistinguishable from evidence and
defeats every later reader — so the record SHALL preserve all three states.

`declined` is included here because the engine already accepts it on the agent-facing surface while
this specification's enumeration omitted it; that divergence is closed rather than repeated.

#### Scenario: An ended epic carries a reason-bearing outcome
- **WHEN** an epic reaches `archived` through any path
- **THEN** it carries an outcome from the enumerated set, and every outcome except `delivered`
  carries a reason

#### Scenario: An unreconstructable outcome is recorded with its reason
- **WHEN** an agent determines that an archived epic's outcome cannot be reconstructed from
  available evidence
- **THEN** that determination is recorded with its reason, and the epic no longer appears in the
  unconsidered set

#### Scenario: The three states remain distinguishable
- **WHEN** a reader inspects an archived epic's disposition
- **THEN** it can distinguish an outcome nobody considered, one an agent recorded, and one an agent
  determined to be unreconstructable

#### Scenario: Archiving a killed change preserves why it was killed
- **WHEN** an openspec-lane epic proposed with 47 tasks is dropped before any code is written
  because Gate 1 found the proposed check would invert stop-loss safety on the autonomous exit path,
  and the agent archives it with `outcome: killed` and that reason
- **THEN** `state.json` distinguishes it from a delivered epic, and the reason is readable without
  opening the commit that deleted the change's spec files

#### Scenario: Archiving through the interactive verb without an outcome is refused
- **WHEN** the agent archives an epic through the interactive archive verb and supplies no
  `outcome`
- **THEN** the transition is refused with a message naming the permitted outcomes, and the epic
  remains in its prior status

#### Scenario: The agent cannot choose `unknown`
- **WHEN** the agent archives an epic through the interactive archive verb supplying
  `outcome: unknown`
- **THEN** the transition is refused, because `unknown` records that nobody was asked and an agent
  running the verb was asked

#### Scenario: A path that supplies no disposition stamps `unknown` with `recordedBy` as a field
- **WHEN** any archive path that supplies no disposition leaves an epic at `archived` — the
  archive-drift heal, the archive backfill registration, or either archived-at-creation path
- **THEN** the epic carries `outcome: unknown` **and** `recordedBy` on that disposition record
  holding the fixed token for the path that wrote it, readable without parsing any free-text
  reason — rather than being refused (which would make the record contradict disk) or left with no
  outcome

#### Scenario: Pre-existing archived epics remain valid
- **WHEN** the engine loads a `state.json` whose archived epics predate this capability
- **THEN** those epics load as `outcome: unknown` (stamped `delivered` by migration only where a
  passing Gate 2 verdict exists — 7 of the 49 audited), every existing behavior functions unchanged,
  and no reason is demanded retroactively
