## Purpose

Turn the spend ledger into a postmortem: where tokens went by context, tools, sub-agents and model; which
epics and agents are outliers and why; what to change; and whether spend per epic is rising or falling
across releases.

## ADDED Requirements

### Requirement: spend-analysis reads the ledger as spend does and writes no state

`spend-analysis [--epic <id> | --release <id>] [--json] [--no-ingest]` SHALL ingest exactly when `spend`
would, then analyse the attributed ledger. It SHALL write nothing to `state.json`. While tracking is off it
SHALL open no path under the spend or transcript directory, as `spend-ledger` requires of every verb but
`spend`, and SHALL say tracking is off.

#### Scenario: Tracking off reads no transcript

- **WHEN** tracking is off and `spend-analysis` runs
- **THEN** no path under the spend directory or the transcript directory is opened
- **AND** the output says spend tracking is off and names `set-spend-tracking on`

#### Scenario: Tracking on with an empty ledger

- **WHEN** tracking was just turned on and no row has been ingested
- **THEN** `spend-analysis --no-ingest` exits 0 saying the ledger holds no rows to analyse

#### Scenario: Scope flags are exclusive and checked

- **WHEN** both `--epic` and `--release` are given, or `--epic` names no epic, or `--release` names no release
- **THEN** the verb exits non-zero naming the problem, and ingests nothing

#### Scenario: State is untouched

- **WHEN** `spend-analysis --epic E` runs with tracking on
- **THEN** `state.json` is byte-identical to before

### Requirement: The breakdown keeps token classes apart and ranks by work

For its scope the analysis SHALL report `input`, `cacheCreation`, `cacheRead`, `output`, `work` and
`total`, split by actor, model tier, role and phase, and list sub-agents ranked by `work`. It SHALL
report coverage and the unattributed reasons as their own section, and SHALL NOT compute a money cost.

#### Scenario: Sub-agents are ranked by work, not total

- **WHEN** agent A has total 60,500,000 and work 400,000, and agent B has total 9,000,000 and work 900,000
- **THEN** B is listed above A, and both totals are printed

#### Scenario: Context and sub-agent work are separated

- **WHEN** the scope holds orchestrator and sub-agent rows
- **THEN** the output shows each actor's four token classes, so cache-read held by the orchestrator and by sub-agents is visible separately

#### Scenario: Unattributed spend is a section of its own

- **WHEN** 32% of the scope's tokens are unattributed
- **THEN** the output prints the coverage share and each unattributed reason with its tokens

### Requirement: Tool use is reported as call counts, never as tokens

The analysis SHALL report, for its scope, the number of `tool_use` calls per tool name and per actor,
read from the `tools` names the ledger rows store. It SHALL NOT apportion tokens to tools, and SHALL say
that per-message usage cannot separate them.

#### Scenario: Tool calls are counted from the rows

- **WHEN** the scope's rows store `tools` of `["Read","Bash"]`, `["Read"]` and `[]`
- **THEN** the output lists `Read 2` and `Bash 1`

#### Scenario: No token figure is given per tool

- **WHEN** the tools section is printed
- **THEN** it carries no token count per tool and states that tokens are not apportioned to tools

### Requirement: Outliers are flagged from a closed rule list with their evidence

The analysis SHALL evaluate exactly the rules `long-context-agent`, `dominant-agent`, `tier-mismatch`,
`review-loop`, `low-coverage` and `invalid-markers`, each against a named threshold constant. Every
flag SHALL print its rule id, the subject, the measured values and the threshold.

#### Scenario: A long-lived large-context agent is flagged

- **WHEN** an agent has 156 messages with mean per-message context (`input + cacheCreation + cacheRead`) of 379,000
- **THEN** a `long-context-agent` flag names that agent, 156 messages, 379,000 per message and both thresholds

#### Scenario: A mechanical role on a top tier is flagged

- **WHEN** a sub-agent's marker role is `mechanical` and its rows' model is an opus-tier model
- **THEN** a `tier-mismatch` flag names the agent, the role and the tier

#### Scenario: A review loop is flagged

- **WHEN** an epic's `phase=review` rows carry rounds 1, 2 and 3
- **THEN** a `review-loop` flag names the epic and 3 distinct review rounds
- **AND** it says this count is not the spend guard's rounds signal, which counts from the pass anchor

#### Scenario: Invalid markers are flagged

- **WHEN** the scope holds `invalid-marker` tokens
- **THEN** an `invalid-markers` flag names the tokens and points to the invalid-marker list `spend` prints

#### Scenario: A clean scope flags nothing

- **WHEN** no rule's threshold is met
- **THEN** the output says no outliers were found and prints each rule's threshold

### Requirement: Each flag carries one rule-rendered recommendation

Each flag SHALL carry exactly one recommendation: fixed text for its rule, with the flag's evidence
filled in, naming the lever and, where one exists, the pm verb that applies it. Recommendations SHALL be
rendered from these rules alone, never from a model call.

#### Scenario: A long-context agent gets the handoff lever

- **WHEN** a `long-context-agent` flag is raised
- **THEN** its recommendation says to split the batch or hand off to a fresh context, and cites the measured context per message

#### Scenario: A tier mismatch names the profile verb

- **WHEN** a `tier-mismatch` flag is raised for role `mechanical`
- **THEN** its recommendation names `set-profile` with `--model mechanical=<model>`

#### Scenario: The same ledger gives the same recommendations

- **WHEN** `spend-analysis --no-ingest` runs twice over an unchanged ledger and state
- **THEN** both outputs are identical

### Requirement: The cross-release trend gives a verdict only above a data floor

The analysis SHALL report mean `work` per epic for each release with attributed epics. It SHALL give a
verdict (`growing`, `falling` or `flat`, at a named 20% threshold between the latest two releases, ordered by release registration, newest first) only
when at least 2 releases each hold at least 3 epics with attributed rows, and otherwise SHALL print
`insufficient data` with the release and epic counts.

#### Scenario: One release is not a trend

- **WHEN** the ledger holds 4 attributed epics, all in one release
- **THEN** the trend prints `insufficient data — 1 releases, 4 epics`

#### Scenario: A rising mean is called growing

- **WHEN** release R1 has 3 epics with mean work 1,000,000 and the later release R2 has 3 epics with mean work 1,300,000
- **THEN** the trend verdict is `growing`

#### Scenario: A small change is flat

- **WHEN** R2's mean work is 1,100,000 under the same R1
- **THEN** the trend verdict is `flat`

### Requirement: The JSON form carries every section

`spend-analysis --json` SHALL print one object with keys `tracking`, `scope`, `breakdown`, `agents`,
`unattributed`, `coverage`, `tools`, `flags`, `trend` and `cost`, where `cost.computed` is `false`, plus
`decisions` under `--epic` as `decision-cost-log` specifies.

#### Scenario: The shape

- **WHEN** `spend-analysis --json` runs
- **THEN** each of those keys is present
- **AND** every entry of `flags` holds `rule`, `subject`, `values`, `threshold` and `recommendation`
