# developer-session-log Specification

## Purpose
A developer-only, opt-in, per-session log of what pm features were on, the shape of each request and
response, the token breakdown, and context-retention warnings, kept as plain JSONL with no new dependency.

## Requirements

### Requirement: The developer session log is an opt-in, off by default, that requires spend tracking

`set-dev-log on|off` SHALL store `state.devLog = {enabled, enabledAt}` in the main working tree's state,
refused in a linked worktree or on a detached main HEAD as `set-spend-tracking` is. Absent reads as off;
`init`/`upgrade` SHALL NOT turn it on. `on` SHALL be refused while spend tracking is off. `OPT_INS`
SHALL carry a `devLog` row.

#### Scenario: A fresh repo has the log off

- **WHEN** `init` runs in a new repository
- **THEN** `state.devLog` is absent
- **AND** the `upgrade` opt-in lines include `NOT SET: devLog`

#### Scenario: On without spend tracking is refused

- **WHEN** spend tracking is off and `set-dev-log on` runs
- **THEN** the verb exits non-zero naming `set-spend-tracking on`
- **AND** `state.json` is byte-identical to before

#### Scenario: The switch is refused outside the main working tree

- **WHEN** `set-dev-log off` runs inside a linked worktree
- **THEN** the verb exits non-zero naming the main working tree, and writes nothing
- **AND** capture keeps reading the switch from the main tree's `state.devLog`

#### Scenario: A repeated setting writes nothing

- **WHEN** `set-dev-log on` runs while the log is already on
- **THEN** the verb says it was already on and `state.json` is byte-identical to before

#### Scenario: An unknown argument is refused

- **WHEN** `set-dev-log maybe` runs
- **THEN** the verb exits non-zero naming `on|off`, and writes nothing

### Requirement: Capture happens only during ingest, never on a hot path

While the log is on and spend tracking is on, any ingest (`spend` and every verb that reads the ledger through the shared ingest) SHALL append one `devlog.jsonl` entry per
newly ingested assistant message to the spend directory. Nothing else SHALL write the file, and no hook
SHALL read or write it. While either switch is off, no entry SHALL be appended.

#### Scenario: Ingest appends entries

- **WHEN** both switches are on and ingest reads two new assistant messages
- **THEN** `devlog.jsonl` gains two message entries keyed by their `messageId`

#### Scenario: Hooks touch nothing

- **WHEN** the log is on and the SessionStart, PreCompact and PreToolUse hooks run
- **THEN** `devlog.jsonl` is neither opened nor stat'ed

#### Scenario: Off appends nothing

- **WHEN** the log is off and ingest runs
- **THEN** `devlog.jsonl` is not created or changed

#### Scenario: Re-ingest is idempotent

- **WHEN** ingest runs twice over unchanged transcripts
- **THEN** `devlog.jsonl` holds one entry per assistant message

#### Scenario: A rebuild does not duplicate entries

- **WHEN** `spend --clear --yes` or `spend --rebuild --yes` runs and ingest then re-reads every transcript from the start
- **THEN** `devlog.jsonl` still holds at most one entry per `messageId`

### Requirement: A message entry records composition as counts, never text

A message entry SHALL hold only `messageId`, `sessionId`, `agentId`, `at`, the request's new content as
bytes by kind (`userText`, `toolResults` per tool name, `attachments`) plus an `images` count, and the
response's `textBytes` and `thinkingBytes`. Token counts and tool names SHALL be read from the ledger row
with the same `messageId`, not stored again.

#### Scenario: Fixture text never reaches the log

- **WHEN** a fixture transcript's prompts, responses, tool inputs, tool outputs and system reminders each contain `SENTINEL-7f3a`
- **THEN** `devlog.jsonl` does not contain `SENTINEL-7f3a`

#### Scenario: Tool results are sized per tool

- **WHEN** a request carries a 1,200-byte `Read` result and a 300-byte `Bash` result
- **THEN** the entry's `toolResults` is `{Read: 1200, Bash: 300}`

#### Scenario: Tokens come from the ledger

- **WHEN** `dev-log --json` reports a message whose ledger row exists
- **THEN** its token classes equal that row's, and `devlog.jsonl` holds no token count

### Requirement: Each ingest records which pm features were on when they change

Each ingest with the log on SHALL append a `features` entry holding each feature's `on` value and
per-surface bytes as `overhead` computes them (never an `OPT_INS` row's `isSet`), only when it differs
from the last `features` entry.

#### Scenario: An unchanged configuration appends no snapshot

- **WHEN** ingest runs twice with no opt-in changed
- **THEN** only one `features` entry exists

#### Scenario: A switch change appends a snapshot

- **WHEN** `set-spend-guard --max-failed-rounds 2` runs between two ingests
- **THEN** a second `features` entry records `spendGuard` with `on: true`

### Requirement: dev-log reports per session with context-retention warnings

`dev-log [--session-id <id>] [--since <iso>] [--until <iso>] [--json] [--no-ingest]` SHALL report per
transcript session: message count, first and last time, token classes and `work`, composition totals, the
features snapshot in force, and warnings `stale-session`, `large-context` and `compacted`, each with its
evidence and named threshold. It writes nothing to `state.json`.

#### Scenario: A week-old session is flagged

- **WHEN** a session's first message is at T and its last at T plus 7 days
- **THEN** the session carries a `stale-session` warning naming both times and the 7-day threshold

#### Scenario: A large context is flagged

- **WHEN** a message's per-message context (`input + cacheCreation + cacheRead`, the measure `spend-analysis` also uses) is 379,000
- **THEN** its session carries a `large-context` warning naming 379,000 and the threshold

#### Scenario: A mid-session switch change is marked

- **WHEN** a `features` snapshot was appended between a session's first and last message
- **THEN** the session's report says the features changed during it

#### Scenario: Off says which switch

- **WHEN** `dev-log` runs with the log off or spend tracking off
- **THEN** it says which switch is off and names the verb to run first (`set-spend-tracking on` when tracking is off, else `set-dev-log on`)
- **AND** no path under the spend directory or the transcript directory is opened

#### Scenario: A missing ledger row is named

- **WHEN** an entry's `messageId` has no ledger row
- **THEN** that message reports `tokens: not in ledger`

### Requirement: The log's inverse prints its plan first, and off deletes nothing

`dev-log --clear` SHALL print what it would remove and change nothing; with `--yes` it SHALL remove
`devlog.jsonl` only. It SHALL be refused while spend tracking is off, touching nothing, since
`spend-ledger` then allows only `spend` and `set-spend-tracking` in the spend directory.
`set-dev-log off` SHALL remove no file.

#### Scenario: Clear without --yes changes nothing

- **WHEN** `dev-log --clear` runs
- **THEN** it names `devlog.jsonl` and every file under the spend directory is unchanged

#### Scenario: Clear touches only the log

- **WHEN** `dev-log --clear --yes` runs
- **THEN** `devlog.jsonl` is gone and the ledger rows, cursor, markers and timeline are unchanged

#### Scenario: Clear with tracking off is refused

- **WHEN** spend tracking is off and `dev-log --clear --yes` runs
- **THEN** the verb exits non-zero naming `set-spend-tracking on`, and no path under the spend directory is opened

#### Scenario: Off keeps the log

- **WHEN** `set-dev-log off` runs
- **THEN** `devlog.jsonl` is unchanged
