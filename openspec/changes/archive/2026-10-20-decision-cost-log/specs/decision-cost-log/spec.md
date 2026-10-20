## Purpose

Record the significant decisions an epic's work reached, with the tokens it cost to reach each one
computed from the spend ledger, so a postmortem can reflect on the decision process and not only on raw
spend.

## ADDED Requirements

### Requirement: record-decision appends a numbered decision to the epic

`record-decision <epicId> --what <text> --why <text> --since <iso> [--until <iso>] [--alternative <text>]… [--phase <phase>]`
SHALL append `{n, what, why, alternatives, phase, since, until, at}` to `epic.decisions`. `n` is
1-based per epic and never reused; `until` defaults to `at`; `phase` is from `KNOWN_SPEND_PHASES`.

#### Scenario: A decision is recorded

- **WHEN** tracking is on and `record-decision E --what "split the build" --why "one agent ran 156 turns" --since 2026-10-10T00:00:00Z --alternative "keep one agent" --phase build` runs
- **THEN** `E.decisions` ends with an entry `n: 1` holding those values, `until` equal to its `at`

#### Scenario: Numbering survives a withdrawal

- **WHEN** E has decisions 1 and 2, decision 2 is withdrawn, and a new decision is recorded
- **THEN** the new decision is `n: 3`

#### Scenario: An archived epic accepts a decision

- **WHEN** E is archived and `record-decision E …` runs with valid fields
- **THEN** the decision is recorded

#### Scenario: Invalid input is refused and nothing is written

- **WHEN** `--what` or `--why` is missing or blank, `--since` is not an ISO time, `--until` is before `--since` or after now, `--phase` is outside `KNOWN_SPEND_PHASES`, a text exceeds 2,000 characters, or the epic does not exist
- **THEN** the verb exits non-zero naming what is wrong and what is accepted
- **AND** `state.json` is byte-identical to before

### Requirement: Decisions are off while spend tracking is off

Recording a decision SHALL be refused while spend tracking is off, naming `set-spend-tracking on` and
`update-epic <id> --notes`, and writing nothing; `--withdraw` reads no ledger and SHALL stay accepted. Turning tracking off SHALL delete no
decision. No verb in this capability reads a ledger or transcript file while tracking is off.

#### Scenario: Recording with tracking off is refused

- **WHEN** tracking is off and `record-decision E --what x --why y --since 2026-10-10T00:00:00Z` runs
- **THEN** the verb exits non-zero naming `set-spend-tracking on`
- **AND** `state.json` is byte-identical to before

#### Scenario: Withdrawing with tracking off is accepted

- **WHEN** tracking is off and `record-decision E --withdraw 1 --reason "duplicate"` runs
- **THEN** decision 1 is marked withdrawn and no spend or transcript path is opened

#### Scenario: A fresh repo has no decisions

- **WHEN** `init` runs in a new repository
- **THEN** no epic has `decisions` and `init` and `upgrade` record none

#### Scenario: Reading with tracking off computes no cost

- **WHEN** E holds decisions, tracking is off, and `decisions E` runs
- **THEN** each decision prints `cost: not computed — spend tracking is off`
- **AND** no path under the spend directory or the transcript directory is opened

### Requirement: A decision's cost is the epic's attributed spend inside its window

At read time, a live decision's cost SHALL be the `work` and `total` that `spend` attributes to its epic
with `since <= at < until`, plus the coverage share for that window. Costs SHALL NOT be stored, and SHALL
NOT be summed across decisions. The output SHALL say the cost is the epic's spend in the window, not
spend caused by the decision alone.

#### Scenario: The cost follows the ledger

- **WHEN** E's decision 1 has a window holding attributed rows of total 750,000 and work 30,000
- **THEN** `decisions E` prints decision 1 with `work 30,000` and `total 750,000`

#### Scenario: A re-attribution re-prices the decision

- **WHEN** rows in decision 1's window were `invalid-marker` and become attributed to E after a vocabulary fix
- **THEN** the next `decisions E` includes them, with no write to `state.json`

#### Scenario: The JSON form

- **WHEN** `decisions E --json` runs with tracking on
- **THEN** stdout is one object with `epic` and `decisions[]`, each holding the stored fields plus `withdrawn` and `cost` (`work`, `total`, `coverage`, or `computed: false` with a reason)

### Requirement: A decision is withdrawn by a recorded withdrawal, never by deletion

`record-decision <epicId> --withdraw <n> --reason <text>` SHALL set `withdrawnAt` and `withdrawReason` on
decision `n` and keep it. A withdrawn decision SHALL be listed as withdrawn and have no cost computed.
Withdrawing an absent or already-withdrawn decision SHALL exit non-zero and write nothing.

#### Scenario: Withdrawing keeps the record

- **WHEN** `record-decision E --withdraw 1 --reason "duplicate of 2"` runs
- **THEN** decision 1 carries `withdrawnAt` and `withdrawReason` and is still in `E.decisions`
- **AND** `decisions E` lists it as withdrawn with no cost

#### Scenario: Withdrawing twice is refused

- **WHEN** decision 1 is already withdrawn and the same withdrawal runs again
- **THEN** the verb exits non-zero naming decision 1, and writes nothing

#### Scenario: Withdraw takes no decision fields

- **WHEN** `--withdraw 1` is given with `--what`
- **THEN** the verb exits non-zero, and writes nothing

### Requirement: The postmortem shows an epic's decisions

`spend-analysis --epic <id>` SHALL include a Decisions section listing the epic's decisions as
`decisions <id>` renders them, in `n` order, and `--json` SHALL carry the same `decisions[]`. An epic
with no decisions SHALL show no Decisions section.

#### Scenario: The analysis carries the section

- **WHEN** E holds two live decisions and `spend-analysis --epic E` runs
- **THEN** its output contains a Decisions section listing both with their costs

#### Scenario: The section with tracking off

- **WHEN** tracking is off and E holds decisions
- **THEN** `spend-analysis --epic E` lists them with `cost: not computed — spend tracking is off`

#### Scenario: No decisions, no section

- **WHEN** E holds no decisions
- **THEN** `spend-analysis --epic E` prints no Decisions section
