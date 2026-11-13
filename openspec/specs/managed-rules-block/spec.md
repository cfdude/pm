# managed-rules-block Specification

## Purpose
How the engine locates, replaces, appends and refuses to replace its managed rules block inside a
human-owned rules file (`CLAUDE.md`, `AGENTS.md` or `HERMES.md`), so that refreshing the block can
never delete, duplicate or corrupt the hand-written text around it.

## Requirements

### Requirement: The managed block is located by whole-line markers and replaced only when unambiguous

A **BEGIN marker line** is a line that, with only its line terminator removed, starts at its first
character with `<!-- BEGIN pm-conductor rules` and ends with `-->`. An **END marker line** is a line
that, with only its line terminator removed, is exactly `<!-- END pm-conductor rules -->`. A marker
string appearing anywhere else — inside prose, inline code, after indentation, or sharing its line
with other text — is NOT a marker and SHALL be treated as ordinary file content.

Every write of the block into the rules file SHALL act on the marker lines as follows:

- **No marker lines at all** — the block is appended after the existing content, or the file is
  created with it when it is absent or blank.
- **Exactly one BEGIN marker line and exactly one END marker line after it** — the lines from the
  BEGIN marker line through the END marker line inclusive are replaced by the block, and every byte
  before and after that span is left unchanged.
- **Any other arrangement** — an END without a BEGIN, a BEGIN without an END, an END before the
  BEGIN, or two or more of either — the write SHALL be refused: the rules file is byte-identical
  afterwards, and the refusal names the file and the line number and kind of every marker line found,
  and names a fix a human can apply by hand from the line numbers it just printed (for example
  deleting the stray lines with `sed` by line number). The fix SHALL NOT be justified by the claim
  that Bash escapes the reconcile gate: an in-place stream editor is a recognized write shape, so
  while a reconcile is owed the mechanical guard blocks that `sed` as surely as it blocks `Edit`.
  That interaction is accepted — a damaged marker arrangement is not time-critical and is not the
  guard's own escape hatch — and the way through is the one the gate always names, completing the
  reconcile gate.

A refused write SHALL NOT be reported as success. A verb that refreshes the block — `write-rules`,
`init`, `upgrade`, `set-tracker`, `set-review-mode` — SHALL exit 11 — the code an unreadable state file
produces, which is not 0, 1 (the validation code) or the conflict exit code — and SHALL print no line saying the block was
refreshed, appended or created.

`init` and `upgrade` SHALL detect a refused arrangement BEFORE their first write, and a refused `init`
or `upgrade` SHALL write nothing: `state.json` (its recorded `pmVersion` included), `PROJECT.md`, the
render stamp, `.gitignore` and the rules file are byte-identical afterwards. `pmVersion` is what marks
a repository as upgraded, so an upgrade that stamped it and then refused would read as done forever
while its rules block, `PROJECT.md` and `.gitignore` stayed behind.

Any other verb that refuses at its block write SHALL say that the rules file and every write the verb
makes after it were not made, and that after fixing the markers, running `write-rules` and then
`render` completes it. Re-running the original verb is not named: it does not complete on every path
(a re-run of `set-tracker --role secondary --remove` refuses because the tracker is already removed).

> REFUSE, not heal, for every ambiguous arrangement, including two well-formed pairs. An orphan
> marker's block could end anywhere, so any repair must guess which hand-written text is managed —
> the defect this requirement exists to remove. Two well-formed pairs have an unambiguous extent, but
> whether the second is a stale duplicate or a user's deliberate copy is not knowable, and the fix is
> one deletion a human can make with the line numbers in hand. Measured before this change: every
> rules file carrying the marker on the proposing machine (27 at Gate 1's recount) holds exactly one
> whole-line BEGIN and one whole-line END, so the refusal fires on none of them today.

#### Scenario: Prose mentioning the BEGIN marker does not cost hand-written content

- **WHEN** a rules file holds, in order, a prose line containing `<!-- BEGIN pm-conductor rules`
  inside inline code, a hand-written `## My rules` section, and one well-formed managed block, and
  `write-rules` runs
- **THEN** it exits 0, every byte before the BEGIN marker line — the prose line and the `## My rules`
  section included — is identical to before, and the file holds exactly one BEGIN marker line

#### Scenario: A BEGIN marker without an END is refused

- **WHEN** a rules file holds a BEGIN marker line, the block body, and hand-written text after it, but
  no END marker line, and `write-rules` runs
- **THEN** it exits non-zero, the rules file is byte-identical, and the message names the file and
  the BEGIN marker's line number

#### Scenario: Two managed blocks are refused

- **WHEN** a rules file holds two well-formed BEGIN/END pairs with hand-written text between them, and
  `set-review-mode --mode thorough` runs
- **THEN** it exits non-zero, the rules file is byte-identical, the message names all four marker line
  numbers, and no line reports the block as refreshed

#### Scenario: An upgrade over a malformed block writes nothing

- **WHEN** a repository whose recorded `pmVersion` is older than the running engine has a rules file
  holding a BEGIN marker line and no END marker line, and `upgrade` runs
- **THEN** it exits 11, and `state.json` (with its
  `pmVersion`), `PROJECT.md`, `.gitignore` and the rules file are byte-identical afterwards

#### Scenario: A single well-formed block is refreshed in place

- **WHEN** a rules file holds hand-written text, one well-formed block, and more hand-written text, and
  `write-rules` runs after a change to the block's content
- **THEN** the text before the BEGIN marker line and after the END marker line is byte-identical and
  the block between them carries the new content

#### Scenario: A file with no markers gets the block appended

- **WHEN** a non-blank rules file holds no marker lines and `write-rules` runs
- **THEN** the original content is preserved as a prefix and exactly one block follows it

#### Scenario: The marker refusal's own remedy is a recognized write shape

- **WHEN** the `sed` remedy named by a refusal for an ambiguous marker arrangement is run through the
  guard's write-shape check
- **THEN** the check matches it as an in-place stream editor, and the requirement's own text states
  that it is blocked while a reconcile is owed

### Requirement: The block is written literally

The block's text, including every value interpolated into it from the record, SHALL be written into
the rules file exactly as rendered. No character sequence in the block or in any value SHALL be
interpreted as a substitution pattern or otherwise cause file content from outside the block to be
copied into it.

#### Scenario: Substitution patterns in the block are written verbatim

- **WHEN** a rules file holds a hand-written line `PREFIX-SENTINEL` above one well-formed block, and
  the block being written contains each of the sequences ``$` ``, `$&` and `$'` — as it does, for
  example, when a recorded tracker repository value contains one
- **THEN** `PREFIX-SENTINEL` occurs exactly once in the file afterwards, and each sequence appears in
  the written block exactly as rendered

### Requirement: The block follows the rules file's line endings

When the rules file's lines end in CRLF, the block SHALL be written with CRLF line endings, so that
refreshing the block never converts the file to mixed line endings. Bytes outside the block SHALL be
unchanged either way.

#### Scenario: A CRLF rules file stays CRLF

- **WHEN** every line of a rules file ends in CRLF, it holds one well-formed block, and `write-rules`
  runs
- **THEN** every line of the file afterwards ends in CRLF

### Requirement: A usage-conditioned section is emitted only while its feature is in use

The **usage-conditioned sections** SHALL be `## Epic-level autonomy`, carried only while a non-archived epic has an autonomy record, and `## Release candidate`, carried only while a release lacks a delivered marker. Each condition is one predicate over state, read by every path rendering the block from state. The gate procedure, Intake and Reporting sections SHALL be emitted under every usage answer.

#### Scenario: A fresh repo carries neither section

- **WHEN** `init` runs in an empty git repository and `rules --sections` is read
- **THEN** neither `Epic-level autonomy` nor `Release candidate` is listed
- **AND** `The gate procedure — required task items` is listed with the same bytes as in the default (full) render

#### Scenario: The printed block and the written block agree

- **WHEN** `rules` prints the block for a state holding an autonomy record on a non-archived epic and no release
- **THEN** its sections are exactly those of the managed block `write-rules` writes for that state

#### Scenario: A caller that supplies no usage answers renders the full block

- **WHEN** the block is rendered with no usage answers supplied
- **THEN** it is identical to the block rendered with both usage answers true
- **AND** turning one answer off removes exactly that section (and, for autonomy, the outward-tracker paragraph) and adds the pointer

### Requirement: The conditional sections are one named set

The **conditional sections** SHALL be exactly the two usage-conditioned sections plus `## Spend tracking` and `## Spend guard`, each with one presence predicate over state. The refresh and the appearance notice SHALL both use this set. The pointer `## Procedures emitted on use` is not in it, because its presence is derived from two members. Tracker sections are not in it either; the tracker verbs refresh the block themselves.

#### Scenario: The set is declared once

- **WHEN** the refresh, the notice and the coverage test are read
- **THEN** all three read the same declared set of four headings

#### Scenario: Every usage or spend toggle is in the set

- **WHEN** `rulesBlock()` is rendered over every combination of the spend-tracking, spend-guard, autonomy and release-candidate inputs (tracker absent)
- **THEN** every heading that is present in one combination and absent in another is either in the set or is the pointer

### Requirement: An absent procedure is named by an always-on pointer

While either usage-conditioned section is absent, the block SHALL carry a `## Procedures emitted on use` section naming, for each absent one only, the shipped skill to load before first use: the `conductor` skill's "Epic-level autonomy — the preflight scan" before the first `set-autonomy`, and the `release-candidate` skill before the first `release`. With both present it SHALL be absent. It SHALL be at most 400 bytes.

#### Scenario: Both absent

- **WHEN** the block is written for a fresh repo
- **THEN** `## Procedures emitted on use` names both skills and is at most 400 bytes

#### Scenario: Only one absent

- **WHEN** a non-archived epic has an autonomy record and no release exists
- **THEN** the pointer names the `release-candidate` skill and does not name the preflight scan

#### Scenario: Neither absent

- **WHEN** both usage-conditioned sections are present
- **THEN** the block carries no `## Procedures emitted on use` section

#### Scenario: Every command span in the pointer runs as written

- **WHEN** the emitted-invocations check runs over the block rendered with each usage answer off
- **THEN** every command the pointer sets in a code span passes the "runnable as written" check

### Requirement: Text that stays emitted never points at an absent section

No line emitted while a usage-conditioned section is absent SHALL refer to that section or to a rule only it states. The outward-tracker paragraph "Epic-level autonomy on tracker-linked epics", which cites the autonomy decision rule's item (d), SHALL be emitted only while `## Epic-level autonomy` is.

#### Scenario: An outward tracker with no autonomy record

- **WHEN** the block is written for a repo with an outward tracker and no non-archived autonomy record
- **THEN** the outward tracker section carries its sync steps and no "Epic-level autonomy on tracker-linked epics" paragraph

#### Scenario: An outward tracker with an autonomy record

- **WHEN** a non-archived epic of that repo gains an autonomy record
- **THEN** the paragraph and `## Epic-level autonomy` are both present after the next write

### Requirement: The block on disk follows every conditional section after any non-hook write

After a non-hook verb writes state, the engine SHALL compare the presence of each conditional section on disk with its predicate over the after-image, and rewrite the block only on a disagreement. Hooks SHALL do no comparison. For Spend guard, the `spend-guard` spec's requirement governs; this one adds no rule to it.

#### Scenario: A write that changes no condition rewrites nothing

- **WHEN** `update-epic E --notes "x"` runs and no condition changes
- **THEN** `CLAUDE.md` is byte-identical to before and its mtime is unchanged

#### Scenario: A hand-edit is corrected by the next engine write

- **WHEN** `.conductor/state.json` is edited by hand to give a non-archived epic an autonomy record, and then `update-epic F --notes "x"` runs
- **THEN** the managed block on disk carries `## Epic-level autonomy`

#### Scenario: A refused invocation refreshes nothing

- **WHEN** `update-epic E --status archived` is refused for a missing outcome
- **THEN** `CLAUDE.md` is byte-identical to before

#### Scenario: A hook does no comparison, and the next non-hook verb catches up

- **WHEN** the SessionStart, PreCompact, PostToolUse or PreToolUse hook runs, including a `commit-nudge` whose archive self-heal archives the last epic with an autonomy record
- **THEN** no after-image of `state.json` is read for the comparison and `CLAUDE.md` is byte-identical to before
- **AND** the next non-hook verb that writes state refreshes the block if a conditional section's presence differs from its predicate

#### Scenario: A repo with no managed block is not given one

- **WHEN** a condition changes in a repo whose rules file has no managed block
- **THEN** no block is written

#### Scenario: A refresh failure does not fail the write

- **WHEN** a write changes a condition and `CLAUDE.md` cannot be written
- **THEN** the state write stands, the verb exits with its own status, and a warning names the conditional section and `write-rules` as the remedy

### Requirement: A conditional section that appears during a session is announced

Whenever a write of an EXISTING managed block adds a conditional section, whichever verb made the write, the engine SHALL print one stderr line per added conditional section. The line SHALL name the section, say that a session or agent that loaded the block earlier does not have it, and name `rules` as the command that prints it. No other heading SHALL be announced. A write that creates or appends the block SHALL announce nothing.

#### Scenario: The first autonomy grant announces the section

- **WHEN** no non-archived epic has an autonomy record and `set-autonomy E --context "x"` runs
- **THEN** stderr carries a line naming `Epic-level autonomy` and the `rules` command

#### Scenario: A verb that writes the block itself announces too

- **WHEN** no spend limit is configured and `set-spend-guard --max-failed-rounds 2` runs
- **THEN** stderr carries a line naming `Spend guard` and the `rules` command

#### Scenario: A first write announces nothing

- **WHEN** `init` creates the rules file with its block
- **THEN** no appearance line is printed

#### Scenario: A retirement is silent even when the pointer appears

- **WHEN** an undelivered release exists and the last non-archived epic with an autonomy record is archived
- **THEN** `## Epic-level autonomy` is removed, `## Procedures emitted on use` is added, and no appearance line is printed

#### Scenario: A tracker heading is not announced

- **WHEN** `set-tracker` adds an outward tracker to a repo whose block already exists
- **THEN** no appearance line is printed for the tracker section

### Requirement: The boards section follows the boards switch

While boards are on, the managed block SHALL carry a `## Boards` section, at most 280 bytes including its heading.
It SHALL name the `project-boards` skill and `/pm:boards`, and tell the agent to refresh the boards after `/pm:sync`,
a status change, a `release` or `mission` write, or a gate record. While boards are off, the section SHALL be absent.
It SHALL NOT restate the refresh procedure. Every command span in it SHALL pass the "runnable as written" check.

#### Scenario: Section present by default

- **WHEN** the block is written for a fresh repo
- **THEN** it contains one `## Boards` section naming `project-boards` and `/pm:boards`, at most 280 bytes

#### Scenario: Section absent when off

- **WHEN** `set-boards off` has run and the block is written
- **THEN** no `## Boards` heading and no line naming `project-boards` is present

#### Scenario: Command spans run as written

- **WHEN** the emitted-invocations check runs over the block with boards on
- **THEN** every code span in the `## Boards` section passes

### Requirement: The boards and mission sections are verb-refreshed, outside the conditional set

`## Boards` and `## Mission` SHALL NOT be members of the declared conditional-section set. Like the tracker sections,
the verbs that change them (`set-boards`, and `mission` when the section's text changes) SHALL rewrite the block
themselves. The overhead map SHALL assign `rules:boards` to the feature `boards` and `rules:mission` to `core`.

#### Scenario: The conditional set is unchanged

- **WHEN** `set-boards off` or `set-boards on` changes the setting
- **THEN** that verb rewrites the block itself, and the declared set still holds exactly the four existing headings

#### Scenario: Overhead attributes the sections

- **WHEN** `overhead` runs with boards on and a mission recorded
- **THEN** it reports `rules:boards` under `boards` and `rules:mission` under `core`

### Requirement: The mission section follows the recorded mission

While a current mission exists, the managed block SHALL carry a `## Mission` section, at most 280 bytes including its
heading. It SHALL state the mission, truncated with an ellipsis, and the mission milestone release, or `none`. With no
current mission, the section SHALL be absent.

#### Scenario: Mission section present and bounded

- **WHEN** a 300-character mission statement is recorded with milestone r2, and the block is written
- **THEN** the block holds one `## Mission` section, at most 280 bytes, ending its statement in an ellipsis and naming `r2`

#### Scenario: Mission section absent after end

- **WHEN** `mission --end --reason "x"` runs
- **THEN** the block on disk carries no `## Mission` section
