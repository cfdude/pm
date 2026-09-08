## ADDED Requirements

### Requirement: An epic in a status the engine does not define is reported
The integrity surface SHALL report every epic whose `status` is outside the set of statuses the
engine defines, naming the epic, naming the value it carries, and naming the remedy — the same
shape the existing unknown-link-type check already establishes for a stored value that cannot be
true.

The finding SHALL state the consequence a reader would otherwise not deduce: an epic in an
undefined status is **non-terminal to every rule that tests for the archived status**, so it is
invisible to the completion-shaped checks and makes the record look cleaner than it is. It SHALL
also state that any dependency edge pointing at such an epic reads unsatisfied permanently, which
lifts the effective priority of everything downstream of it for as long as the value persists.

The check SHALL be read-only and SHALL NOT repair the value it finds. Which legal status an
undefined one should become is a judgment about what happened to the work, and an engine that
guessed would write a disposition nobody made.

#### Scenario: An epic in an undefined status is named with its consequence
- **WHEN** the integrity surface runs over a state file containing an epic whose status is not one
  the engine defines
- **THEN** it reports that epic, the undefined value, the remedy, and the fact that the epic is
  currently exempt from every rule that tests for the archived status

#### Scenario: The check reports and does not repair
- **WHEN** the integrity surface reports an epic in an undefined status
- **THEN** the epic's stored status is unchanged by the check

#### Scenario: A state file with only defined statuses reports nothing
- **WHEN** the integrity surface runs over a state file in which every epic carries a defined
  status
- **THEN** no unknown-status finding is reported

### Requirement: A migration that skips records says which it skipped
A migration whose scope is conditional — one that transforms only records matching some
predicate — SHALL make the records it did not reach discoverable, rather than leaving a partially
migrated state file that reports as fully migrated.

This SHALL hold whether the skipped records are reachable by a later run or not: a repository
carrying records outside a migration's predicate is in a different state from one where the
migration had nothing to skip, and the two SHALL NOT be indistinguishable. Measured across 28
repositories, one migration's archived-only predicate left 29 epics untouched in six repositories
with nothing reporting it, and those 29 were the records least likely to be noticed by any other
means.

#### Scenario: A conditional migration surfaces what it did not reach
- **WHEN** a migration transforms only the records matching its predicate and others exist
- **THEN** the records it did not reach are discoverable through the integrity surface, rather
  than silently indistinguishable from records the migration handled
