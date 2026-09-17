## MODIFIED Requirements

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
the remedy that meets it. gh-189 measured the cost: of 20 epics reported, all 12 openspec-lane
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

#### Scenario: The archived-delivered regression refusal keeps delivered
- **WHEN** an `--attribute-commit` on an archived `delivered` openspec-lane epic is refused because
  its passing Gate 2 would no longer reach the attributed commits
- **THEN** the refusal names the Gate 2 re-record first, its printed invocation still offers
  `delivered`, and following both in order with the range filled by meaning exits zero

#### Scenario: The integrity remedy for an undefined status follows the same rule
- **WHEN** `integrity` reports an openspec-lane epic with no passing Gate 2 sitting in an undefined
  status
- **THEN** the archive invocation it prints does not offer `delivered`
