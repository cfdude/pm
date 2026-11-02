## ADDED Requirements

### Requirement: A usage-conditioned section is emitted only while its feature is in use

The block SHALL carry `## Epic-level autonomy` only while a non-archived epic has an autonomy record, and `## Release candidate` only while a release lacks a delivered marker. Each condition SHALL be one predicate over the state record, read by every path that renders the block from state (`write-rules`, `rules`, `overhead`'s real report, the refresh). Every other section's presence is unchanged.

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

The **conditional sections** SHALL be exactly `## Spend tracking`, `## Spend guard`, `## Epic-level autonomy` and `## Release candidate`, each with one presence predicate over state. The refresh and the appearance notice SHALL both use this set. The pointer `## Procedures emitted on use` is not in it, because its presence is derived from two members. Tracker sections are not in it either; the tracker verbs refresh the block themselves.

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
