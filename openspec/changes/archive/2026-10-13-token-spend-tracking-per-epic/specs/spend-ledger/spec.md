# Spec Delta

## Purpose

An opt-in, local, per-epic record of the tokens an AI coding agent spent. It is built read-only from
Claude Code's own transcript files and attributed to epics, so pm can say which epic, phase, role and
model the tokens went to.

## ADDED Requirements

### Requirement: Spend tracking is a project opt-in, off by default

`set-spend-tracking on|off` SHALL store `state.spendTracking = {enabled, enabledAt}`.

- `enabledAt` is written on the first `on` and never moved after that.
- `init` and `upgrade` SHALL NOT turn tracking on.
- The `OPT_INS` registry SHALL carry a `spendTracking` row naming this verb and `commands/spend.md`.
- Absent `state.spendTracking` reads as off. The field is additive and has no migration.

#### Scenario: A fresh repo has tracking off

- **WHEN** `init` runs in a new repository
- **THEN** `state.spendTracking` is absent
- **AND** the `upgrade` opt-in lines include
  `NOT SET: spendTracking — no record of which epic, phase, role or model spent tokens → set-spend-tracking on`

#### Scenario: Turning tracking on records when it started

- **WHEN** `set-spend-tracking on` runs in a repo where tracking has never been on
- **THEN** `state.spendTracking.enabled` is `true`
- **AND** `enabledAt` is the time of that write

#### Scenario: Re-enabling keeps the original start

- **WHEN** tracking is turned on, then off, then on again
- **THEN** `enabledAt` still holds the time of the first `on`

#### Scenario: An unknown argument is refused

- **WHEN** `set-spend-tracking maybe` runs
- **THEN** the verb exits non-zero, naming `on|off`
- **AND** `state.json` is byte-identical to before

#### Scenario: A repeated setting writes nothing

- **WHEN** `set-spend-tracking on` runs while tracking is already on
- **THEN** the verb says tracking was already on
- **AND** `state.json` and `timeline.jsonl` are byte-identical to before

### Requirement: Turning tracking off stops reading, deletes nothing, and marks the gap

While tracking is off:

- No verb other than `spend` and `set-spend-tracking` SHALL read or write transcript files or the
  spend directory.
- `spend` SHALL NOT read transcript files.

`set-spend-tracking off` SHALL remove no file. It SHALL append one `{at, tracking: "off"}` entry to
the timeline, so that spend made while tracking was off is never credited to an epic.

#### Scenario: Off keeps the ledger

- **WHEN** tracking is on, `spend` has written rows, and `set-spend-tracking off` runs
- **THEN** every ledger file except `timeline.jsonl` still exists with the same bytes
- **AND** `timeline.jsonl` gained exactly one `tracking: "off"` entry

#### Scenario: spend while off reports without ingesting

- **WHEN** tracking is off and a transcript file has grown since the last ingest
- **THEN** `spend` adds no row
- **AND** its output states that tracking is off and the totals are as of the last ingest

#### Scenario: Spend made while tracking was off is not credited to an epic

- **WHEN** tracking is turned off at T1 and on again at T2
- **AND** a later ingest reads rows timestamped between T1 and T2
- **THEN** those rows are unattributed with reason `tracking-off`, whatever their actor or marker

### Requirement: No hook reads a transcript, and a disabled repo pays nothing new on any hot path

- No hook SHALL read a transcript file or a ledger file, whether tracking is on or off.
- With tracking off, nothing other than `spend` and `set-spend-tracking` SHALL perform a filesystem
  operation on the spend directory or on the transcript directory.
- With tracking on, the extra hot-path work per engine invocation is limited to:
  - one read of `state.json` to compare `state.active` before and after
  - one timeline append, only when `state.active` changed

#### Scenario: A disabled repo's hooks touch nothing new

- **WHEN** tracking is off and the SessionStart, PreCompact and PreToolUse hooks run
- **THEN** no path under the spend directory or the transcript directory is opened or stat'ed

#### Scenario: An enabled repo's hooks still read no transcript or ledger

- **WHEN** tracking is on and the SessionStart hook runs
- **THEN** no transcript file is opened
- **AND** no ledger file is read

### Requirement: The transcript location is resolved from the config directory and the repository path

The transcript root SHALL be `$CLAUDE_CONFIG_DIR/projects` when that variable is set, and
`~/.claude/projects` otherwise. The project directory is the main working tree's absolute path with
every character outside `[A-Za-z0-9]` replaced by `-`.

Ingest SHALL read:

- that directory's `*.jsonl`
- each session's `subagents/agent-*.jsonl`
- every sibling directory named with that encoding plus `--claude-worktrees-`

#### Scenario: The config directory override is honoured

- **WHEN** `CLAUDE_CONFIG_DIR` points at a fixture directory holding a session for this repo
- **THEN** `spend` ingests that session
- **AND** reads nothing under the real home directory

#### Scenario: Worktree sessions are discovered

- **WHEN** a session file exists under `<encoded repo>--claude-worktrees-agent-x/`
- **THEN** `spend` ingests its assistant messages

#### Scenario: No transcript directory is not an error

- **WHEN** the resolved project directory does not exist
- **THEN** `spend` exits 0 and adds no row
- **AND** it names the directory it looked for

### Requirement: One ledger per repository, kept in the main working tree

The spend directory SHALL be the main working tree's `.conductor/spend/`, from any working tree.
`spend` SHALL read the main tree's `state.json` for the switch, `enabledAt` and the epic set. Only
invocations rooted in the main tree SHALL append to the timeline or run `set-spend-tracking`. A
linked worktree's spend is sub-agent spend, attributed by marker.

#### Scenario: A linked worktree uses the same ledger

- **WHEN** `spend` runs from a linked worktree of the repository
- **THEN** it reads the same transcripts as a run from the main working tree
- **AND** it reads and writes the same `.conductor/spend/` directory

#### Scenario: spend in a linked worktree reads the main tree's state

- **WHEN** epic `e9` is registered in the main working tree after a linked worktree branched
- **AND** `spend --json --epic e9` runs in that linked worktree
- **THEN** it accepts `e9` and reports the same totals as the same command run in the main tree
- **AND** `enabled`, `enabledAt` and the epic set all come from the main tree's `state.json`

#### Scenario: The switch is refused outside the main working tree

- **WHEN** `set-spend-tracking on` or `off` runs in a linked worktree
- **THEN** the verb exits non-zero, naming the main working tree's path
- **AND** no `state.json` or timeline file changes

#### Scenario: A linked worktree records no timeline

- **WHEN** tracking is on and `set-active e1` runs in a linked worktree
- **THEN** no timeline entry is appended

### Requirement: Detachment is tested on the main working tree, and the switch is refused there

Every detachment test in this capability SHALL ask about the MAIN working tree's HEAD, the tree the
spend directory is written to (`conductor-record`, "A detached HEAD suppresses session-bookkeeping
writes"). `set-spend-tracking` SHALL be refused while that HEAD is detached, so the switch never
changes in `state.json` without its timeline entry.

#### Scenario: The switch is refused while the main working tree is detached

- **WHEN** the main working tree's HEAD is detached and `set-spend-tracking off` runs there
- **THEN** the verb exits non-zero, naming the detached HEAD
- **AND** `state.json` and `timeline.jsonl` are byte-identical to before

#### Scenario: A detached linked worktree does not stop ingest

- **WHEN** tracking is on, the main working tree is on a branch, and `spend` runs in a linked
  worktree whose HEAD is detached
- **THEN** `spend` ingests into the main working tree's `.conductor/spend/`

### Requirement: Transcripts are read-only and the ledger never reaches the network

The engine SHALL NOT write to any transcript file, open a network connection, or invoke a model while
building or reading the ledger.

#### Scenario: Transcripts are never modified

- **WHEN** `spend` ingests a fixture transcript tree
- **THEN** every fixture file's bytes and mtime are unchanged afterwards

#### Scenario: The ledger code imports no network module

- **WHEN** the engine's existing network-import scan runs over the modules this capability adds
- **THEN** it finds no network module, `fetch(` call or bare specifier

### Requirement: One row per assistant message, folded by message id

Each `assistant` transcript entry with a `message.id` and `message.usage` SHALL yield a row. Rows
sharing a `message.id` are one streamed message and SHALL fold to one:

- The token counts come from the entry with the greatest `output_tokens`. A tie goes to the later
  entry.
- `tools` is the in-order union of every entry's `tool_use` names.

A row's total is `input + cacheCreation + cacheRead + output`. `iterations` and `thinking` are never
added to it.

#### Scenario: Streamed duplicates count once

- **WHEN** a transcript holds three `assistant` entries with the same `message.id`, with output
  tokens 21, 195 and 195
- **THEN** the folded ledger holds one row for that id, with output 195

#### Scenario: A zero-usage partial entry does not win

- **WHEN** a message's entries are a thinking entry with zero usage, followed by an entry with
  output 300
- **THEN** the folded row has output 300

#### Scenario: Tools spread over several entries are all kept

- **WHEN** one message's first entry holds a `tool_use` named `Bash`, and its second entry holds one
  named `Read`
- **THEN** the folded row's `tools` is `["Bash","Read"]`

#### Scenario: Iterations are not double-counted

- **WHEN** an entry's `usage.iterations[0]` repeats its top-level counts
- **THEN** the row's total equals the top-level counts alone

#### Scenario: Non-assistant and malformed entries yield no row

- **WHEN** a transcript holds `user`, `attachment`, `system` and `cost-state` entries
- **AND** it holds an `assistant` entry lacking `message.id` or `usage`
- **THEN** none of them yields a row
- **AND** `spend` reports the malformed entry as skipped, by reason

### Requirement: Stored rows hold counts and identifiers only, and never text

A stored row SHALL hold only these fields:

- `messageId`, `sessionId`, `agentId` (or null), `actor`
- `source` (the transcript path relative to the transcript root)
- `at`, `model` (the raw id), `tier`
- `input`, `cacheCreation`, `cacheRead`, `output`, `thinking`
- `tools` (the `tool_use` names)

A stored marker SHALL hold only its four tokens. Nothing stored SHALL contain prompt, response, tool
input or output, file content, `cwd`, or a sub-agent's `description`.

#### Scenario: Fixture text never reaches the ledger

- **WHEN** a fixture transcript's prompts, responses, tool inputs, tool outputs and meta
  `description` each contain the sentinel `SENTINEL-7f3a`
- **THEN** no file under `.conductor/spend/` contains `SENTINEL-7f3a`

#### Scenario: Model tier maps to the known list

- **WHEN** a row's model is `claude-sonnet-5-5`, `claude-opus-4-7` or `some-other-model`
- **THEN** its `tier` is `sonnet`, `opus` or `other` respectively, matched against `KNOWN_MODELS`

### Requirement: Ingest is incremental and idempotent

- Ingest SHALL keep a per-file cursor (byte offset, size and file identity) and consume only
  complete lines past it.
- A file that shrank, or was replaced, SHALL be re-read from offset 0.
- Ingest SHALL skip rows timestamped before `enabledAt`. It SHALL skip, without opening, any file
  whose mtime is before `enabledAt`.
- Running `spend` twice with no transcript change SHALL leave the folded ledger identical.

#### Scenario: A re-run adds nothing

- **WHEN** `spend` runs twice in a row with no transcript change
- **THEN** the second run reports 0 rows added
- **AND** the folded totals are identical

#### Scenario: A partial trailing line waits

- **WHEN** a transcript's last line has no newline yet
- **THEN** that line is not consumed
- **AND** it is consumed by the next run once its newline is written

#### Scenario: A replaced file does not double-count

- **WHEN** a transcript file is replaced by a shorter file holding the same messages
- **THEN** the file is re-read from 0
- **AND** the folded totals are unchanged

#### Scenario: History before enabling is not read

- **WHEN** tracking was enabled at T and a transcript's mtime is before T
- **THEN** that file is not opened

#### Scenario: A concurrent ingest does not interleave

- **WHEN** a `spend` ingest is already running for this repository and a second `spend` starts
- **THEN** the second run does not ingest
- **AND** it reports from the existing ledger, saying an ingest was in progress

### Requirement: The dispatch marker is captured once per sub-agent and stored as tokens

When ingest reads a sub-agent transcript's first `user` entry, it SHALL scan that entry's text for
the first line matching `pm-spend: epic=<id> role=<role> phase=<phase>[ round=<n>]`. It SHALL store
the raw tokens, keyed by `agentId`, in the ledger, whether or not they are valid.

The marker for a `--claude-worktrees-agent-<id>` session is the one captured for agent `<id>`.

#### Scenario: The marker survives incremental ingest

- **WHEN** a marked sub-agent transcript is ingested in two runs, and the second run starts past its
  first `user` entry
- **THEN** rows from both runs are attributed by the marker

#### Scenario: A worktree session takes its agent's marker

- **WHEN** `subagents/agent-x.jsonl` carries a marker for `e1`
- **AND** `<encoded repo>--claude-worktrees-agent-x/` holds a session
- **THEN** that session's rows are `actor=subagent`, `agentId=x`, attributed to `e1` by marker

### Requirement: Attribution is computed at read time, in a fixed precedence, and never drops a row

Each report SHALL attribute every folded row from the stored markers, the timeline and current
`state`. The first rule that applies wins:

1. **tracking-off**: the row falls in an off interval.
2. **marker**: a sub-agent row takes epic, role, phase and round from its agent's valid marker.
3. **window**: an orchestrator row takes the epic active at its `at`.
4. **unattributed**: with a reason.

A sub-agent row SHALL NOT be window-attributed.

#### Scenario: Every unattributed row carries a reason from the closed list

- **WHEN** any row is unattributed
- **THEN** its reason is one of `tracking-off`, `unmarked-subagent`, `invalid-marker`,
  `unknown-epic`, `no-active-epic` or `before-timeline`

#### Scenario: A marked sub-agent is attributed by its marker

- **WHEN** a sub-agent's marker is `pm-spend: epic=e1 role=review phase=review round=2`
- **AND** `e1` is an epic in state
- **THEN** its rows report `epic=e1`, `role=review`, `phase=review`, `round=2` and `attribution=marker`

#### Scenario: An orchestrator row is attributed by the window

- **WHEN** the timeline records `e1` active from T1 and `e2` from T2
- **AND** an orchestrator row is timestamped between T1 and T2
- **THEN** the row reports `epic=e1`, `attribution=window`, and null `role` and `phase`

#### Scenario: An unmarked sub-agent is unattributed, even inside a window

- **WHEN** a sub-agent has no marker
- **AND** its rows fall inside `e1`'s window
- **THEN** its rows are unattributed with reason `unmarked-subagent`

#### Scenario: A worktree session is never window-attributed

- **WHEN** a `--claude-worktrees-agent-y` session has no captured marker
- **AND** its rows fall inside `e1`'s window
- **THEN** its rows are `actor=subagent`, unattributed with reason `unmarked-subagent`

#### Scenario: An invalid marker is unattributed, not guessed

- **WHEN** a marker names a role outside `KNOWN_JOB_ROLES` or a phase outside `KNOWN_SPEND_PHASES`
- **THEN** that agent's rows are unattributed with reason `invalid-marker`

#### Scenario: An epic registered after its dispatch is attributed

- **WHEN** a marker names `e9`, which did not exist at ingest
- **AND** `e9` is registered later
- **THEN** the next report attributes those rows to `e9` without a re-ingest

#### Scenario: A row whose epic was removed reports as unknown

- **WHEN** rows were attributed to `e1` and `e1` is removed with `remove-epic`
- **THEN** `spend` reports those rows under the reason `unknown-epic`
- **AND** `rows.jsonl` is not rewritten

#### Scenario: An orchestrator row with no epic active is unattributed

- **WHEN** an orchestrator row falls where the timeline holds no active epic
- **THEN** it is unattributed with reason `no-active-epic`

### Requirement: Actor, role and phase are separate closed vocabularies

- `actor` SHALL be `orchestrator` or `subagent`.
- A marker's `role` SHALL be a member of `KNOWN_JOB_ROLES`. This capability declares no role list of
  its own.
- `phase` SHALL be a member of `KNOWN_SPEND_PHASES` = `plan`, `build`, `review`, `docs`, `release`,
  declared once.
- `round` SHALL be a positive integer, and defaults to 1 when the marker omits it.

#### Scenario: Sub-agent sources are sub-agent actors

- **WHEN** a row comes from a `subagents/agent-*.jsonl` file, from a `--claude-worktrees-agent-<id>`
  directory, or from an entry carrying `isSidechain: true`
- **THEN** its `actor` is `subagent` and its `agentId` is set

#### Scenario: A role added to the job-role list is accepted without a ledger change

- **WHEN** `KNOWN_JOB_ROLES` gains a role not yet in it, for example `deploy`
- **THEN** a marker with `role=deploy` is valid

#### Scenario: A non-integer round is invalid

- **WHEN** a marker carries `round=0` or `round=two`
- **THEN** that agent's rows are unattributed with reason `invalid-marker`

### Requirement: The engine records an active-epic timeline while tracking is on

While tracking is on, an invocation rooted in the main working tree that changes `state.active`
SHALL append `{at, active}` to `timeline.jsonl`, unless the main working tree's HEAD is detached
(the append is then suppressed, per `conductor-record`). `set-spend-tracking on` SHALL append
`{at, tracking: "on", active}`. The append reads no ledger file, and its failure SHALL NOT fail the
invocation.

#### Scenario: Activating an epic appends one entry

- **WHEN** tracking is on and `set-active e1` runs
- **THEN** `timeline.jsonl` gains exactly one line, whose `active` is `e1`

#### Scenario: An unchanged active epic appends nothing

- **WHEN** tracking is on and a verb runs that leaves `state.active` unchanged
- **THEN** `timeline.jsonl` is byte-identical to before

#### Scenario: Off records no timeline

- **WHEN** tracking is off and `set-active e1` runs
- **THEN** `timeline.jsonl` is not created or changed

#### Scenario: Enabling seeds the timeline

- **WHEN** `set-spend-tracking on` runs while `e1` is active
- **THEN** `timeline.jsonl` gains a `tracking: "on"` line whose `active` is `e1`

#### Scenario: A failing append does not fail the verb

- **WHEN** the spend directory is not writable and `set-active e1` runs with tracking on
- **THEN** `set-active` exits 0 and `state.active` is `e1`

### Requirement: The rules block carries the dispatch-marker instruction only while tracking is on

While tracking is on, the managed rules block SHALL carry a `## Spend tracking` section. It instructs
the agent to begin every sub-agent dispatch prompt with one line
`pm-spend: epic=<id> role=<role> phase=<phase> [round=<n>]`, and names the accepted roles and phases.
While tracking is off, the block SHALL NOT carry the section. `set-spend-tracking` SHALL refresh the
block.

#### Scenario: On emits the section

- **WHEN** tracking is on and the rules block is rendered
- **THEN** it contains `## Spend tracking`, the marker format, the `KNOWN_JOB_ROLES` values and the
  `KNOWN_SPEND_PHASES` values

#### Scenario: Off emits nothing

- **WHEN** tracking is off and the rules block is rendered
- **THEN** it contains no `## Spend tracking` section and no `pm-spend:` text

#### Scenario: Toggling refreshes CLAUDE.md

- **WHEN** `set-spend-tracking on` runs, and later `set-spend-tracking off` runs
- **THEN** `CLAUDE.md`'s managed block on disk contains the section after the first and not after
  the second

### Requirement: spend reports per-epic totals, shows the unattributed spend, and computes no cost

`spend [--epic <id>] [--since <iso>] [--until <iso>] [--json] [--no-ingest]` SHALL ingest (unless
`--no-ingest` is given, tracking is off, or the main working tree's HEAD is detached), then report from the folded,
read-time-attributed ledger:

- per-epic totals, split by actor, role, phase, round and tier, with each sub-agent's own totals
- an unattributed total by reason, always printed
- a coverage share

It SHALL NOT compute a money cost.

#### Scenario: The unattributed bucket is always shown

- **WHEN** every row is attributed
- **THEN** the report still prints an unattributed line reading 0

#### Scenario: Filtering by epic and window

- **WHEN** `spend --epic e1 --since T1 --until T2 --no-ingest` runs
- **THEN** only rows attributed to `e1` with `T1 <= at < T2` are summed

#### Scenario: An unknown epic is refused

- **WHEN** `spend --epic nope` runs and no epic `nope` exists
- **THEN** the verb exits non-zero, naming the id
- **AND** it ingests nothing

#### Scenario: The JSON shape serves the dependent epics

- **WHEN** `spend --json` runs
- **THEN** the output is one object with keys `tracking`, `ingest`, `epics`, `unattributed`,
  `coverage` and `cost`
- **AND** every totals object holds `input`, `cacheCreation`, `cacheRead`, `output` and `total`
- **AND** `epics.<id>` holds `totals`, `byActor`, `byRole`, `byPhase`, `byRound`, `byTier`,
  `firstAt`, `lastAt`, and `agents.<agentId>` with `role`, `phase`, `round`, `tier` and `totals`
- **AND** `unattributed` holds `totals` and `byReason`
- **AND** `cost.computed` is `false`

#### Scenario: Cost is labelled, not invented

- **WHEN** `spend` prints its text report
- **THEN** it prints a cost line stating that no cost is computed, that tokens are the measure, and
  that Claude Code's cost figures are notional under subscription auth

### Requirement: Every ledger write has an inverse that prints its plan first

- `spend --clear` SHALL remove the rows, cursor and markers.
- `--clear --timeline` SHALL also remove the timeline.
- `spend --rebuild` SHALL re-derive rows from the transcripts on disk, keeping the timeline and every
  row and marker whose source is gone.

Without `--yes`, each SHALL print its plan and change nothing. `--rebuild` SHALL be refused while
tracking is off. `--clear` and `--rebuild` SHALL NOT combine, and `--timeline` needs `--clear`.

#### Scenario: Clear without --yes changes nothing

- **WHEN** `spend --clear` runs
- **THEN** it prints the files it would remove
- **AND** every file under `.conductor/spend/` is unchanged

#### Scenario: Clearing the timeline says what it forgets

- **WHEN** `spend --clear --timeline` runs without `--yes`
- **THEN** the plan states that the off intervals and windows are lost
- **AND** it states that spend from an off period may be credited to epics by marker after a
  re-ingest

#### Scenario: Clear keeps the timeline unless asked

- **WHEN** `spend --clear --yes` runs
- **THEN** the rows, the cursor and the markers are gone
- **AND** `timeline.jsonl` is unchanged

#### Scenario: Rebuild reproduces the same totals

- **WHEN** no transcript has changed and `spend --rebuild --yes` runs
- **THEN** the folded totals equal those before the rebuild

#### Scenario: Rebuild keeps what it cannot re-derive

- **WHEN** rows exist whose `source` file is no longer on disk
- **AND** `spend --rebuild --yes` runs
- **THEN** those rows are still in the ledger afterwards
- **AND** the plan names how many rows were kept because their source is gone

#### Scenario: Rebuild while off is refused

- **WHEN** tracking is off and `spend --rebuild --yes` runs
- **THEN** the verb exits non-zero
- **AND** it reads no transcript and changes nothing

#### Scenario: Conflicting operations are refused

- **WHEN** `spend --clear --rebuild` or `spend --timeline --yes` runs
- **THEN** the verb exits non-zero
- **AND** it changes nothing

### Requirement: The spend directory is git-ignored

`.conductor/spend/` SHALL be in the engine's ignored-path list, so `init` and `upgrade` add it to
`.gitignore`.

#### Scenario: upgrade backfills the ignore line

- **WHEN** `upgrade` runs in a repository whose `.gitignore` lacks `.conductor/spend/`
- **THEN** `.gitignore` afterwards contains the line `.conductor/spend/`
