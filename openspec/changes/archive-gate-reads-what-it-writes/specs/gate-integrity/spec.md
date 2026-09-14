## ADDED Requirements

### Requirement: The interactive archive verb gates the record the invocation writes

When `update-epic` carries `--status archived`, the archive gate MUST evaluate the epic after every
field write and unset in that invocation, never the epic as it stood before them. The field writes
include the lane, the plan and spec paths, commit attribution and its withdrawal, added stories, a
story marked done or won't-do, links, priority, and every `--clear` unset. The consequence SHALL be
that one invocation is decided exactly as the same flags split into consecutive invocations, field
writes first and the archive last: refused where that sequence would be refused, accepted where it
would be accepted.

A refused invocation MUST write nothing and MUST print no line announcing a write. That includes the
sync-ignore tombstone clear, the rank clear, and the `--clear` notes: a refused call that announced a
cleared rank would report a change that did not happen.

Today the gate reads the epic before those writes. One call can therefore leave a record the gate
refuses in two, and refuse a record the gate accepts in two. The gate exists to decide on the record
that gets written, and a gate that reads a different record decides nothing.

#### Scenario: A lane switch and an archive in one call cannot bypass Gate 2

- **WHEN** a `claude-code`-lane epic with no Gate 2 verdict runs
  `update-epic <id> --lane openspec --status archived --outcome delivered --no-deferrals`
- **THEN** it exits non-zero naming the missing passing Gate 2, `state.json` is byte-identical, and
  the epic is not archived

#### Scenario: An attribution and an archive in one call cannot bypass staleness

- **WHEN** an openspec-lane epic carries a passing Gate 2 whose `headSha` is its last attributed
  commit, and `update-epic <id> --attribute-commit <a later commit> --status archived --outcome
  delivered --no-deferrals` runs
- **THEN** it exits non-zero naming the uncovered commit, and `state.json` is byte-identical

#### Scenario: An added story and an archive in one call cannot bypass the handoff

- **WHEN** an epic whose stories are all done runs `update-epic <id> --add-story "s" --status archived
  --outcome delivered --no-deferrals`
- **THEN** it exits non-zero naming the outstanding story, and `state.json` is byte-identical

#### Scenario: A commit withdrawal and an archive in one call cannot bypass the gate

- **WHEN** an openspec-lane epic attributes exactly one commit and carries a passing Gate 2 covering
  it, and `update-epic <id> --withdraw-commit <that sha> --withdrawal-reason "x" --status archived
  --outcome delivered --no-deferrals` runs
- **THEN** it exits non-zero, `state.json` is byte-identical, and the epic is not archived

#### Scenario: Finishing the last story and archiving in one call is accepted

- **WHEN** an epic whose only outstanding story is story 1 runs `update-epic <id> --story 1 --done
  --status archived --outcome delivered --no-deferrals`
- **THEN** it exits zero, story 1 is done, and the epic is archived with outcome `delivered`

#### Scenario: Leaving the openspec lane and archiving in one call is accepted

- **WHEN** an openspec-lane epic with no Gate 2 verdict and no outstanding work runs
  `update-epic <id> --lane claude-code --status archived --outcome delivered --no-deferrals`
- **THEN** it exits zero and the epic is an archived `delivered` `claude-code`-lane epic, exactly as
  the same flags in two calls would leave it

#### Scenario: A refused call announces no cleared field

- **WHEN** a ranked P2 epic with a `parent`, a sync-ignored plan path and no passing Gate 2 runs
  `update-epic <id> --priority P1 --clear parent --plan <that path> --lane openspec --status archived
  --outcome delivered --no-deferrals`
- **THEN** it exits non-zero, stderr carries none of the rank-clear, parent-clear or tombstone-clear
  lines, and `state.json` is byte-identical

#### Scenario: An accepted call still announces what it cleared

- **WHEN** the same epic runs the same flags with `--lane openspec` omitted and has no outstanding
  work
- **THEN** it exits zero and stderr carries the rank-clear, parent-clear and tombstone-clear lines

### Requirement: An update to an archived epic does not break an obligation its archive met

When the epic's stored status is `archived`, the invocation carries no `--status`, and the epic's
recorded outcome is `delivered`, `update-epic` MUST compare the delivered-outcome obligations on the
record before the invocation with those on the record it would leave. The obligations are the Gate 2
demand (openspec lane: a present, passing Gate 2 that is not stale and not attribution-withdrawn) and
the handoff demand (no outstanding work unless the disposition names where it was carried). The
invocation MUST be refused, writing nothing, where the record before met every obligation and the
record after fails one. The refusal MUST name the failing obligation.

The archive gate and this check MUST decide the obligations from ONE definition, so they cannot
disagree about what "met" means.

A record that already failed an obligation before the invocation MUST NOT be refused on that
account. Archived records from before a rule existed fail rules they were never held to. Refusing
every update to them would lock notes, links and priority on a record for a defect the update did not
cause.

The refusal MUST print a runnable invocation that makes the same change and records the disposition
it implies: the invocation's own flags plus `--status archived --outcome <outcome> --reason "<why>"`.
Only its placeholders need filling. That invocation MUST carry `--correct-disposition` if and only if
the recorded disposition is agent-recorded, because an engine-stamped disposition is replaced by
recording an outcome and the correction flag is refused against it. It MUST carry a deferral flag
if and only if the epic has no deferral assertion. The refusal MAY also say how an invocation could
leave the obligation met, but that is prose, not a promised command. Whether one exists depends on
the change: a lane switch can be preceded by recording Gate 2, while a Gate 2 withdrawal cannot
leave its own obligation met.

An update to an archived epic never passes through `--status archived`, so the archive gate never
sees it. Reproduced: `update-epic <id> --lane openspec` on an archived `delivered` `claude-code` epic
exits 0 and leaves a `delivered` openspec-lane epic with no Gate 2, which `integrity` names nowhere.

#### Scenario: Switching an archived delivered epic into the openspec lane is refused

- **WHEN** an archived `delivered` `claude-code`-lane epic with no Gate 2 verdict runs
  `update-epic <id> --lane openspec`
- **THEN** it exits non-zero naming the missing passing Gate 2, and `state.json` is byte-identical

#### Scenario: Attributing a commit an archived delivered epic's Gate 2 does not cover is refused

- **WHEN** an archived `delivered` openspec-lane epic carries a passing Gate 2 whose `headSha` is its
  last attributed commit, and `update-epic <id> --attribute-commit <a later commit>` runs
- **THEN** it exits non-zero naming the uncovered commit, and `state.json` is byte-identical

#### Scenario: Adding a story to an archived delivered epic is refused

- **WHEN** an archived `delivered` epic whose stories are all done runs `update-epic <id> --add-story
  "s"`
- **THEN** it exits non-zero naming the outstanding story, and `state.json` is byte-identical

#### Scenario: Withdrawing the only attribution of an archived delivered epic is refused

- **WHEN** an archived `delivered` openspec-lane epic attributes exactly one commit, covered by its
  passing Gate 2, and `update-epic <id> --withdraw-commit <that sha> --withdrawal-reason "x"` runs
- **THEN** it exits non-zero, and `state.json` is byte-identical

#### Scenario: A record that already failed is not locked

- **WHEN** an archived `delivered` openspec-lane epic's Gate 2 is `ungated`, and `update-epic <id>
  --attribute-commit <sha>` runs
- **THEN** it exits zero and the commit is attributed, because the record failed the Gate 2 demand
  before the call

#### Scenario: An epic that ended another way carries no obligation

- **WHEN** an archived `claude-code`-lane epic with outcome `superseded` runs `update-epic <id> --lane
  openspec --add-story "s"`
- **THEN** it exits zero

#### Scenario: An engine-stamped outcome is not delivered and carries no obligation

- **WHEN** an archived `claude-code`-lane epic whose outcome is `unknown` with an engine `recordedBy`
  runs `update-epic <id> --lane openspec`
- **THEN** it exits zero

#### Scenario: The remedy for an agent-recorded disposition names the correction

- **WHEN** the lane-switch refusal above fires on an epic whose `delivered` disposition is
  agent-recorded
- **THEN** the invocation it prints carries `--correct-disposition`

#### Scenario: The remedy for an engine-stamped disposition does not name the correction

- **WHEN** an archived epic whose `delivered` disposition was stamped by the 0.27.0 migration (a
  pre-0.27.0 state file carrying a passing Gate 2, run through `upgrade`), and whose stories are all
  done, runs `update-epic <id> --add-story "s"`
- **THEN** it is refused, and the invocation it prints carries no `--correct-disposition`

#### Scenario: The printed remedy runs

- **WHEN** the invocation printed for an agent-recorded `delivered` epic is run with its
  placeholders filled as `--outcome superseded`, a reason, and a correction reason
- **THEN** it exits zero, and the epic is an archived `superseded` openspec-lane epic whose prior
  `delivered` disposition is kept under `superseded`

#### Scenario: Leaving the archive is not refused

- **WHEN** an archived `delivered` `claude-code`-lane epic with no Gate 2 runs `update-epic <id>
  --status queued --lane openspec`
- **THEN** it exits zero, and archiving it again is decided by the archive gate on the record that
  call leaves
