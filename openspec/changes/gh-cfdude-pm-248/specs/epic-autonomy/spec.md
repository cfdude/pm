## ADDED Requirements

### Requirement: The autonomy section follows non-archived autonomy records

The rules block SHALL carry `## Epic-level autonomy` exactly while some epic whose status is not `archived` has an autonomy record, at any level. An autonomy record at level `off` counts, because the grants it keeps are what re-arming restores. Every inverse made by a non-hook verb (archiving, `remove-epic`, un-archiving) SHALL retire or restore the section in the same invocation; a hook's archive self-heal is caught by the next non-hook write (managed-rules-block).

#### Scenario: The first record adds the section

- **WHEN** no epic has an autonomy record and `set-autonomy E --preauthorize "drop-scratch:reviewed"` runs
- **THEN** the managed block on disk carries `## Epic-level autonomy`

#### Scenario: Level off keeps the section

- **WHEN** E is the only epic with an autonomy record and `set-autonomy E --level off` runs
- **THEN** the managed block on disk still carries `## Epic-level autonomy`

#### Scenario: Archiving the last holder retires the section

- **WHEN** E is the only non-archived epic with an autonomy record
- **AND** `update-epic E --status archived --outcome delivered --reason "x" --no-deferrals` runs
- **THEN** the managed block on disk carries no `## Epic-level autonomy` section

#### Scenario: Removing the last holder retires the section

- **WHEN** E is the only non-archived epic with an autonomy record and `remove-epic E` runs
- **THEN** the managed block on disk carries no `## Epic-level autonomy` section

#### Scenario: Un-archiving restores the section

- **WHEN** archived epic E has an autonomy record, no other non-archived epic has one, and `update-epic E --status untriaged` runs
- **THEN** the managed block on disk carries `## Epic-level autonomy`

#### Scenario: An archived holder alone does not emit it

- **WHEN** every epic with an autonomy record is archived and `write-rules` runs
- **THEN** the managed block carries no `## Epic-level autonomy` section
