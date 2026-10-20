## MODIFIED Requirements

### Requirement: The rules block carries a Spend guard section only while a limit is configured

While a limit is configured (opt-in requirement), the rules block SHALL carry a `## Spend guard`
section after the `## Spend tracking` slot, telling the agent to run `spend-guard <epic>` before every
review or fix dispatch, to treat exit 2 as a STOP autonomy does not bypass and escalate, to record the
decision with `override-spend-guard`, which no autonomy grant covers, and to mark review dispatches
`phase=review round=<n>`. With no limit there is no such section. Any invocation that changes whether
a limit is configured SHALL refresh the block.

#### Scenario: A configured limit adds the section

- **WHEN** `set-spend-guard --max-failed-rounds 2` runs
- **THEN** the managed `CLAUDE.md` rules block contains `## Spend guard` with the literal `spend-guard <epic>` command
- **AND** the section follows `## Spend tracking` when tracking is on, and takes that position when it is off

#### Scenario: Unsetting the last limit removes it

- **WHEN** the only configured limit is unset
- **THEN** the rules block contains no `## Spend guard` section

#### Scenario: A warnAt alone is not a limit

- **WHEN** the only guard field set anywhere is `warnAt`
- **THEN** the rules block contains no `## Spend guard` section

#### Scenario: Archiving the only epic holding a limit removes the section

- **WHEN** epic E holds the only configured limit (`--epic E --max-failed-rounds 2`)
- **AND** `update-epic E --status archived --outcome abandoned --reason "x" --no-deferrals` runs
- **THEN** `CLAUDE.md`'s managed block on disk contains no `## Spend guard` section

#### Scenario: Removing the only epic holding a limit removes the section

- **WHEN** epic E holds the only configured limit and `remove-epic E` runs
- **THEN** `CLAUDE.md`'s managed block on disk contains no `## Spend guard` section

#### Scenario: Un-archiving restores the section

- **WHEN** archived epic E holds `--epic E --max-failed-rounds 2`, no other limit exists, and `update-epic E --status untriaged` runs
- **THEN** `CLAUDE.md`'s managed block on disk contains `## Spend guard`

#### Scenario: A write that leaves liveness unchanged does not rewrite CLAUDE.md

- **WHEN** a project-layer limit is configured and `update-epic E --notes "x"` runs
- **THEN** `CLAUDE.md` is byte-identical to before and its mtime is unchanged

#### Scenario: A refused invocation refreshes nothing

- **WHEN** `update-epic E --status archived` is refused for a missing outcome
- **THEN** `CLAUDE.md` is byte-identical to before

#### Scenario: A refresh failure does not fail the write

- **WHEN** archiving E changes liveness and `CLAUDE.md` cannot be written
- **THEN** the archive is recorded, the verb exits with its own status, and a warning names `rules` as the remedy
