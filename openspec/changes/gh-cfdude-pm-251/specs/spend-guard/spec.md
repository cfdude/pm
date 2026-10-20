## MODIFIED Requirements

### Requirement: Guard limits are configured at three layers and resolved most specific first

`set-spend-guard` SHALL store four optional fields: `maxFailedRounds` (positive integer), `tokenCeiling`
(positive integer), `tokenBasis` (`total` or `work`) and `warnAt` (integer 1–99, a percentage), at the
project layer by default, at a lane with `--lane <lane>`, or at an epic with `--epic <id>`. Each field
SHALL resolve independently, epic, then lane, then project. An unset field has no limit, except `warnAt`
(default 80) and `tokenBasis` (default `total`).

#### Scenario: An epic value overrides the project value

- **WHEN** `set-spend-guard --max-failed-rounds 3` and then `set-spend-guard --epic E --max-failed-rounds 1` run
- **THEN** `spend-guard E` reports `maxFailedRounds 1 (epic)` and an epic in the same lane without its own value reports `3 (project)`

#### Scenario: A lane value applies to that lane's epics

- **WHEN** `set-spend-guard --lane openspec --tokens 2000000` runs
- **THEN** an openspec-lane epic with no epic-layer value resolves `tokenCeiling 2000000 (lane:openspec)`
- **AND** a superpowers-lane epic resolves no token ceiling

#### Scenario: A detour epic inherits nothing from the epic it paused

- **WHEN** epic P has `--epic P --max-failed-rounds 1` and detour D is pushed from P
- **THEN** D resolves `maxFailedRounds` from its own lane or the project, never from P

#### Scenario: Invalid values are refused and nothing is written

- **WHEN** `set-spend-guard` gets `--max-failed-rounds 0`, `--tokens -5`, `--warn-at 100`, `--token-basis cached`, `--lane nope`, `--epic missing`, or both `--epic` and `--lane`
- **THEN** each exits non-zero naming the offending value and what is accepted
- **AND** no state write is made

#### Scenario: A set with nothing to set is refused

- **WHEN** `set-spend-guard --epic E` runs with no field flag and no `--unset`
- **THEN** it exits non-zero, says nothing was given to set, and writes nothing

#### Scenario: An absent basis reads as total

- **WHEN** a state file written by 0.52.0 holds `state.spendGuard = {tokenCeiling: 300000000}`
- **THEN** `spend-guard E` reports `tokenBasis total (default)` and compares the epic's `total` with the ceiling
- **AND** nothing is rewritten

#### Scenario: A lane can count work while the project counts total

- **WHEN** the project holds `tokenCeiling 300000000` and `set-spend-guard --lane openspec --token-basis work --tokens 20000000` runs
- **THEN** an openspec-lane epic resolves `tokenBasis work (lane:openspec)` and `tokenCeiling 20000000 (lane:openspec)`
- **AND** a superpowers-lane epic resolves `tokenBasis total (default)` and `tokenCeiling 300000000 (project)`

#### Scenario: A basis alone is not a limit

- **WHEN** the only guard field set anywhere is `tokenBasis`
- **THEN** no limit is configured, the `spendGuard` opt-in row reads `NOT SET`, and the rules block has no `## Spend guard` section

### Requirement: Every guard limit has an unset at every layer

`set-spend-guard [--epic <id> | --lane <lane>] --unset <field>` SHALL remove that field from that layer
only, where `<field>` is `max-failed-rounds`, `tokens`, `token-basis`, `warn-at` or `all`. Resolution
then falls through to the next layer. A layer left with no fields SHALL be removed. Unsetting a field
that is not set SHALL exit 0, print that nothing changed, and leave `state.json` unchanged.

#### Scenario: Unsetting the epic layer falls through to the project

- **WHEN** the project has `maxFailedRounds 3`, epic E has `1`, and `set-spend-guard --epic E --unset max-failed-rounds` runs
- **THEN** `spend-guard E` reports `maxFailedRounds 3 (project)`
- **AND** `epic.spendGuard` is absent from E's record

#### Scenario: Unsetting everything at the project returns to no limits

- **WHEN** `set-spend-guard --unset all` runs and no lane or epic layer sets a field
- **THEN** `state.spendGuard` is absent and every epic resolves no limit

#### Scenario: An unset of an absent field changes nothing

- **WHEN** `set-spend-guard --lane openspec --unset tokens` runs and that lane has no token ceiling
- **THEN** the command exits 0 saying nothing changed
- **AND** no state write is made

#### Scenario: Unsetting the basis falls back to the default

- **WHEN** the project holds `tokenBasis work` and `set-spend-guard --unset token-basis` runs
- **THEN** every epic with no lane or epic basis resolves `tokenBasis total (default)`

### Requirement: The token signal compares attributed spend with the ceiling

When `tokenCeiling` resolves and tracking is on, the token signal SHALL compare the epic's attributed
count in the resolved basis (`total` or `work`, as `spend` reports them), minus the latest live tokens
override's baseline in that basis, with the ceiling. At or above `warnAt` percent it SHALL be WARN; at
or above the ceiling, tripped. Unattributed spend is never counted, and the report SHALL print the
coverage share.

#### Scenario: Below the warning share

- **WHEN** E's ceiling is 1,000,000, `warnAt` is 80, and its attributed count in the resolved basis is 700,000
- **THEN** the token signal is OK

#### Scenario: Past the warning share

- **WHEN** E's attributed count is 850,000 under the same limits
- **THEN** the token signal is WARN, and `spend-guard E` still exits 0

#### Scenario: At the ceiling

- **WHEN** E's attributed count is 1,000,000 under the same limits
- **THEN** the token signal is tripped

#### Scenario: Unattributed spend is shown, not charged

- **WHEN** 40% of the tokens in the ledger are unattributed
- **THEN** `spend-guard E` prints the coverage share next to the token signal
- **AND** the unattributed tokens are not added to E's count

#### Scenario: A work basis ignores cache-read

- **WHEN** E resolves `tokenBasis work` and `tokenCeiling 1000000`, and its rows sum to total 1,131,152 of which work is 7,487
- **THEN** the token signal is OK with count 7,487

## ADDED Requirements

### Requirement: spend-guard prints the token-class breakdown beside the token signal

Whenever the token signal is checked, `spend-guard` SHALL print the epic's attributed `input`,
`cacheCreation`, `cacheRead`, `output`, `work` and `total`, and the resolved basis with its source.
`--json` SHALL carry them as `signals.tokens.breakdown` and `signals.tokens.basis`.

#### Scenario: The text form names the basis and the classes

- **WHEN** `spend-guard E` runs with tracking on and a ceiling resolved
- **THEN** the tokens line names the basis and its source
- **AND** a breakdown line names all six counts

#### Scenario: The JSON form carries the breakdown

- **WHEN** `spend-guard E --json` runs under the same conditions
- **THEN** `signals.tokens.basis` is `total` or `work` and `signals.tokens.breakdown` holds the six counts

#### Scenario: Not checked prints no breakdown

- **WHEN** tracking is off
- **THEN** the token signal is `not-checked` and no breakdown is printed or computed

### Requirement: A low total-basis ceiling warns and is still recorded

When `set-spend-guard --tokens <n>` leaves the written layer resolving `tokenBasis total` and `n` is below
10,000,000, it SHALL record the value and print one line saying that a total counts cache-read on every
message, that the floor is a suggestion rather than a measurement, and naming `--token-basis work`.

#### Scenario: The issue's first value warns

- **WHEN** `set-spend-guard --tokens 1500000` runs with no basis set anywhere
- **THEN** `tokenCeiling 1500000` is recorded
- **AND** the output contains a line naming `cache-read` and `--token-basis work`

#### Scenario: A work basis does not warn

- **WHEN** `set-spend-guard --token-basis work --tokens 1500000` runs
- **THEN** the value is recorded and no low-ceiling line is printed

#### Scenario: A value at or above the floor does not warn

- **WHEN** `set-spend-guard --tokens 300000000` runs with basis total
- **THEN** no low-ceiling line is printed

### Requirement: A tokens override is bound to the basis it was counted in

`override-spend-guard <epicId> --signal tokens` SHALL record `basis` on the entry: the basis the baseline
was counted in. A tokens override whose `basis` differs from the basis that resolves now SHALL NOT be
applied, and `spend-guard` SHALL say it was recorded in another basis. An entry with no `basis` reads as
`total`.

#### Scenario: The override records its basis

- **WHEN** E resolves `tokenBasis work`, its token signal is tripped, and a tokens override is recorded
- **THEN** the override entry holds `basis: "work"` and a `baseline` equal to E's work count

#### Scenario: A basis change sets the override aside

- **WHEN** E holds a live tokens override with `basis: "total"` and E's basis is later set to `work`
- **THEN** `spend-guard E` applies no baseline from that override
- **AND** it prints that the override was recorded in the `total` basis

#### Scenario: A 0.52 override reads as total

- **WHEN** a tokens override written by 0.52.0 has no `basis` and E resolves `tokenBasis total`
- **THEN** that override's baseline is applied
