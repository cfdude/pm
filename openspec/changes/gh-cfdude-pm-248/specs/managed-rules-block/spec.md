## ADDED Requirements

### Requirement: A usage-conditioned section is emitted only while its feature is in use

The block SHALL carry `## Epic-level autonomy` only while a non-archived epic has an autonomy record, and `## Release candidate` only while a release lacks a delivered marker. Each condition SHALL be computed by one predicate over the state record, and every path that renders the block from state (`write-rules`, `rules`, `overhead`, the refresh) SHALL read that predicate. Every other section's presence is unchanged.

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

### Requirement: Text that stays emitted never points at an absent section

No line emitted while a usage-conditioned section is absent SHALL refer to that section or to a rule only it states. The outward-tracker paragraph "Epic-level autonomy on tracker-linked epics", which cites the autonomy decision rule's item (d), SHALL be emitted only while `## Epic-level autonomy` is.

#### Scenario: An outward tracker with no autonomy record

- **WHEN** the block is written for a repo with an outward tracker and no non-archived autonomy record
- **THEN** the outward tracker section carries its sync steps and no "Epic-level autonomy on tracker-linked epics" paragraph

#### Scenario: An outward tracker with an autonomy record

- **WHEN** a non-archived epic of that repo gains an autonomy record
- **THEN** the paragraph and `## Epic-level autonomy` are both present after the next write

### Requirement: The block on disk follows every usage condition after any non-hook write

After a non-hook verb writes state, the engine SHALL compare the presence of every usage-conditioned section on disk with its predicate over the after-image, and rewrite the block only on a disagreement. It SHALL cover spend tracking, spend guard, autonomy and release candidate in one comparison. Hooks SHALL do no comparison. For Spend guard, the `spend-guard` spec's requirement governs; this one adds no rule to it.

#### Scenario: A write that changes no condition rewrites nothing

- **WHEN** `update-epic E --notes "x"` runs and no usage condition changes
- **THEN** `CLAUDE.md` is byte-identical to before and its mtime is unchanged

#### Scenario: A hand-edit is corrected by the next engine write

- **WHEN** `.conductor/state.json` is edited by hand to give a non-archived epic an autonomy record, and then `update-epic F --notes "x"` runs
- **THEN** the managed block on disk carries `## Epic-level autonomy`

#### Scenario: A refused invocation refreshes nothing

- **WHEN** `update-epic E --status archived` is refused for a missing outcome
- **THEN** `CLAUDE.md` is byte-identical to before

#### Scenario: A hook does no comparison

- **WHEN** the SessionStart, PreCompact, PostToolUse or PreToolUse hook runs
- **THEN** no after-image of `state.json` is read for the comparison and `CLAUDE.md` is byte-identical to before

#### Scenario: A repo with no managed block is not given one

- **WHEN** a usage condition changes in a repo whose rules file has no managed block
- **THEN** no block is written

#### Scenario: A refresh failure does not fail the write

- **WHEN** a write changes a usage condition and `CLAUDE.md` cannot be written
- **THEN** the state write stands, the verb exits with its own status, and a warning names `write-rules` as the remedy

### Requirement: A section that appears during a session is announced

Whenever a write of an EXISTING managed block adds a usage-conditioned section, whichever verb made the write, the engine SHALL print one stderr line per added section. The line SHALL name the section, say that a session or agent that loaded the block earlier does not have it, and name `rules` as the command that prints it. A write that creates or appends the block, or only removes sections, SHALL print no such line.

#### Scenario: The first autonomy grant announces the section

- **WHEN** no non-archived epic has an autonomy record and `set-autonomy E --context "x"` runs
- **THEN** stderr carries a line naming `Epic-level autonomy` and the `rules` command

#### Scenario: A verb that writes the block itself announces too

- **WHEN** no spend limit is configured and `set-spend-guard --max-failed-rounds 2` runs
- **THEN** stderr carries a line naming `Spend guard` and the `rules` command

#### Scenario: A first write announces nothing

- **WHEN** `init` creates the rules file with its block
- **THEN** no appearance line is printed

#### Scenario: A retirement is silent

- **WHEN** the last non-archived epic with an autonomy record is archived
- **THEN** the section is removed and no appearance line is printed
