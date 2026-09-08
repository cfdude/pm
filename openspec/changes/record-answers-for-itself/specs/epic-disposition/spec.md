## ADDED Requirements

### Requirement: The archive can be asked which of its records carry no disposition
The engine SHALL be able to enumerate the archived epics that carry no agent-recorded outcome —
those whose disposition is absent, and those stamped by a migration rather than by a person or an
agent — and SHALL emit, per epic, the invocation that would record one.

An engine-written stamp and an agent-recorded disposition SHALL remain distinguishable for this
purpose. A stamp that says nobody recorded an outcome is a true statement about the record and is
not an outcome; a surface that counted it as one would report a complete archive over a record
that answers nothing.

Measured in this repository, 66 of 143 archived epics carry no agent-recorded outcome — 46% of the
archive — and across 28 repositories the figure is 382. The cost is not cosmetic: a grooming pass
over this repository's own backlog hit that wall four separate times and reconstructed from commit
history what the record should have stated, and one user-filed issue reported work that had in
fact been done, because the epic proposing it archived with nothing saying so.

#### Scenario: The undispositioned set is enumerable with its remedy
- **WHEN** an agent asks the engine which archived epics carry no agent-recorded outcome
- **THEN** it receives those epics and, for each, the invocation that would record a disposition

#### Scenario: An engine stamp is not counted as a recorded outcome
- **WHEN** an archived epic carries an outcome written by a migration rather than by an agent
- **THEN** it appears in the undispositioned set

#### Scenario: An archive with every outcome recorded reports an empty set
- **WHEN** every archived epic carries an agent-recorded outcome
- **THEN** the undispositioned set is empty

### Requirement: An outcome that cannot be reconstructed is recordable as such
Where the evidence needed to state what happened to an ended piece of work is genuinely
unrecoverable, that SHALL be recordable as a deliberate, reason-bearing finding, distinct both
from an outcome nobody looked for and from a reconstructed one.

A fabricated disposition is worse than an absent one: an absent outcome is visibly a gap, while an
invented one is indistinguishable from evidence and defeats every later reader. The record SHALL
therefore preserve the difference between "nobody recorded this", "this was reconstructed from
evidence", and "this was looked for and the evidence does not exist".

#### Scenario: An unreconstructable outcome is recorded with its reason
- **WHEN** an agent determines that an archived epic's outcome cannot be reconstructed from
  available evidence
- **THEN** that determination is recordable with its reason, and the epic no longer appears as an
  outcome nobody looked for

#### Scenario: The three states remain distinguishable
- **WHEN** a reader inspects an archived epic's disposition
- **THEN** it can distinguish an outcome nobody recorded, one an agent recorded, and one an agent
  determined to be unreconstructable
