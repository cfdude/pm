## ADDED Requirements

### Requirement: Every totals object carries a work total

Every totals object `spend` reports SHALL carry `work`, defined as `input + cacheCreation + output`:
every token class except `cacheRead`. It is the one definition of "work tokens"; every consumer SHALL
read it from the totals object rather than summing the classes itself.

#### Scenario: The work total excludes cache-read

- **WHEN** an epic's rows sum to input 10, cacheCreation 5,366, cacheRead 1,123,665 and output 2,111
- **THEN** its totals object holds `work: 7487` and `total: 1131152`

#### Scenario: Every totals object has it

- **WHEN** `spend --json` runs
- **THEN** `epics.<id>.totals`, each `agents.<agentId>.totals` and `unattributed.totals` all hold `work`
- **AND** every bucket of `byActor`, `byRole`, `byPhase`, `byTier` and `byRound` holds `work`

#### Scenario: The text report prints it

- **WHEN** `spend` prints an epic's totals line
- **THEN** the line names the work total beside the four token classes
