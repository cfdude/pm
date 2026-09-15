## Purpose

How the engine locates, replaces, appends and refuses to replace its managed rules block inside a
human-owned rules file (`CLAUDE.md`, `AGENTS.md` or `HERMES.md`), so that refreshing the block can
never delete, duplicate or corrupt the hand-written text around it.

## ADDED Requirements

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
  and states that removing the stray marker lines (or the extra block) by hand and re-running is the
  fix.

A refused write SHALL NOT be reported as success. A verb that refreshes the block — `write-rules`,
`init`, `upgrade`, `set-tracker`, `set-review-mode` — SHALL exit with a code that is not 0, not 1
(the validation code) and not the conflict exit code, and SHALL print no line saying the block was
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
- **THEN** it exits with a code that is not 0, 1 or the conflict code, and `state.json` (with its
  `pmVersion`), `PROJECT.md`, `.gitignore` and the rules file are byte-identical afterwards

#### Scenario: A single well-formed block is refreshed in place

- **WHEN** a rules file holds hand-written text, one well-formed block, and more hand-written text, and
  `write-rules` runs after a change to the block's content
- **THEN** the text before the BEGIN marker line and after the END marker line is byte-identical and
  the block between them carries the new content

#### Scenario: A file with no markers gets the block appended

- **WHEN** a non-blank rules file holds no marker lines and `write-rules` runs
- **THEN** the original content is preserved as a prefix and exactly one block follows it

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
