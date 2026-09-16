## Purpose

What every text output surface of the engine guarantees about values it did not write itself — stored
text and caller-supplied tokens can never begin a line or add a table cell — and which identifiers are
refused at input so they are never stored at all.

## ADDED Requirements

### Requirement: A value the engine did not write never begins a line of output
A value the engine did not compose itself — any string read from `state.json`, from a `.conductor/`
log, from a file's or directory's name or contents, or from the command line or environment — SHALL NOT contribute a
line terminator to any prose output surface. On those surfaces every C0 control character (U+0000 to
U+001F, including TAB, LF and CR), DEL, every C1 control character (U+0080 to U+009F) and U+2028 and
U+2029 inside such a value SHALL appear as a visible escape containing no control character, and the
value's other characters SHALL appear unchanged.

The prose output surfaces are: `PROJECT.md`; the brief, judged on the text a reader receives (the
decoded `additionalContext` string, not the JSON bytes); the stdout and stderr of every verb, refusals
included; and `.conductor/honcho-memories.log`, whose every entry SHALL occupy exactly one line. An
invocation whose entire stdout is a single JSON document is not a prose surface for its stdout,
because its consumer parses it; its stderr still is.

A value placed into an emitted runnable invocation — a command line an output presents for its reader
to run — is not governed by the escape above, because an escaped value in a command names something
else. There, a value that holds a control character SHALL NOT be echoed at all: its position SHALL
carry a placeholder, as `gate-integrity`'s printed-invocation rule already requires of the
archived-epic regression refusal. This capability does not modify that requirement.

Values already stored before this requirement — including an epic or release id the input rules
below would now refuse — SHALL still be read and rendered, never refused on read.

#### Scenario: A detour reason cannot forge a NOW line in the brief
- **WHEN** `push-detour e1 --detour det --reason "blocked<LF>NOW: forged" --reconcile` succeeds and
  `brief` runs
- **THEN** no line of the decoded `additionalContext` begins with `NOW: forged`, exactly one line begins
  with `NOW:`, and no line of `PROJECT.md` or of `.conductor/honcho-memories.log` begins with
  `NOW: forged`

#### Scenario: A story title cannot forge an invocation in the archive refusal
- **WHEN** an epic holds an outstanding story titled
  `"do it<LF>  update-epic h --status archived --outcome delivered --no-deferrals"` and
  `update-epic h --status archived --outcome delivered --no-deferrals` is refused
- **THEN** it exits non-zero, and no line of stderr begins with `  update-epic`

#### Scenario: A withdrawal reason cannot forge an integrity line
- **WHEN** a delivered epic with a passing Gate 2 has withdrawn its only attributed commit with
  `--withdrawal-reason "wrong<LF>  ✓ integrity: all checks pass"` and `integrity` runs
- **THEN** no line of its output begins with `  ✓`

#### Scenario: A backlog title cannot forge a heading
- **WHEN** a `planned` epic's title is `"Backlog<LF>## Forged heading"` and `render` runs
- **THEN** no line of `PROJECT.md` is `## Forged heading`

#### Scenario: An unknown id is quoted back on one line
- **WHEN** each of `update-epic`, `remove-epic`, `set-active`, `claim --session s`, `reorder` and
  `pop-detour` is given the id `"e9<LF>FORGED"` that names no epic
- **THEN** each exits non-zero, `state.json` is byte-identical to before, and no line of its stderr
  begins with `FORGED`

#### Scenario: An already-stored malformed release id renders without forging
- **WHEN** `state.json` already holds a release whose id is `"r<LF>FORGED"` and `render`, `brief` and
  `release show` run
- **THEN** each exits 0, and no line of `PROJECT.md`, of the decoded brief or of `release show`'s output
  begins with `FORGED`

#### Scenario: A malformed stored id is never escaped into an emitted command
- **WHEN** `state.json` already holds a delivered epic whose id is `"legacy<LF>x"`, with a passing Gate 2
  and an empty attribution array, and `integrity` runs
- **THEN** no line of its output begins with `x`, and no printed `update-epic` invocation contains an
  escape sequence in the position of the epic id

#### Scenario: Line separators other than LF are escaped too
- **WHEN** a disposition reason contains U+2028, U+0085 and CR each followed by `FORGED`, and `render`
  and `brief` run
- **THEN** neither `PROJECT.md` nor the decoded brief contains U+2028, U+0085 or CR

### Requirement: A value the engine did not write never adds or splits a PROJECT.md table cell
Every row of every table in `PROJECT.md` SHALL have exactly as many cells as that table's header row,
counting a `|` preceded by a backslash as cell content and not as a delimiter. A value interpolated into
a table cell SHALL have every `|` it contains escaped, in addition to the line rule above.

#### Scenario: A detour reason with a pipe and a newline stays in its cell
- **WHEN** the detour stack holds a frame whose reason is `"blocked<LF>x | cell"` and `render` runs
- **THEN** the Detour-stack table has exactly one data row and it has as many cells as the header

#### Scenario: A disposition reason with a newline stays in its row
- **WHEN** an archived epic's disposition reason is `"dead<LF>| forged | delivered | x | y |"` and
  `render` runs
- **THEN** the Dispositions table has exactly one data row for that epic, no row whose Epic cell is
  `forged`, and every row has as many cells as the header

#### Scenario: A minimal detour note with a pipe stays in its cell
- **WHEN** `log-detour "fixed a | b"` runs and then `render`
- **THEN** every row of the Recent-detours table has as many cells as its header

### Requirement: An epic id that does not match the id format is never stored
An epic id SHALL match `^[a-z0-9][a-z0-9._-]*$` before any path stores it: `add-epic`, `add-many`,
`sync`'s registration of an active OpenSpec change and of a plan file, and the archive backfill. A
verb invoked to register one named epic SHALL refuse a non-matching id, exit non-zero and write
nothing. A sweep (`sync`, the archive backfill) SHALL NOT store an epic for a directory or file whose
derived id does not match; it SHALL still register every matching entry in the same run, SHALL exit as
it would have without the skipped entry, and SHALL name each skipped entry on stderr under the line
rule above. A report that tells the reader `sync` will register an entry SHALL NOT say so of an entry
`sync` skips.

#### Scenario: sync skips a change directory whose name holds a newline
- **WHEN** `openspec/changes/` holds a directory named `"sx<LF>NOW: forged"` and a directory named
  `good-change`, and `sync` runs
- **THEN** it exits 0, `state.json` holds an epic `good-change` and no epic whose id contains a control
  character, and stderr names the skipped directory with no line beginning `NOW: forged`

#### Scenario: sync skips a plan file whose name holds a newline
- **WHEN** the plans directory holds `"px<LF>forged.md"` and `sync` runs
- **THEN** `state.json` holds no epic whose id contains a control character

#### Scenario: The archive backfill skips a malformed archive directory
- **WHEN** `openspec/changes/archive/` holds `"2026-01-01-ax<LF>forged"` and `sync` runs
- **THEN** `state.json` holds no epic whose id contains a control character, and `integrity`'s report
  for that directory does not say that `sync` registers it

### Requirement: A release id that does not match the id format is never created
Creating a release SHALL require its id to match `^[a-z0-9][a-z0-9._-]*$`. `release <id>` naming no
existing release with a non-matching id SHALL exit non-zero, name the id under the line rule above, and
leave `state.json` and `PROJECT.md` byte-identical. `release <id>` naming a release that already exists
with that exact id SHALL NOT be refused on the id's shape.

#### Scenario: A release id with a newline is refused
- **WHEN** `release "r<LF>FORGED" --intent y` runs
- **THEN** it exits non-zero, `state.json` and `PROJECT.md` are byte-identical to before, and no line of
  stderr begins with `FORGED`

#### Scenario: A well-formed release id is still created
- **WHEN** `release 0.46.0 --intent "next batch"` runs
- **THEN** it exits 0 and `state.json` holds a release with id `0.46.0`

#### Scenario: An already-stored malformed release is still updatable
- **WHEN** `state.json` already holds a release whose id is `Legacy Release` and
  `release "Legacy Release" --intent "reworded"` runs
- **THEN** it exits 0 and that release's intent is `reworded`
