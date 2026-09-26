## REMOVED Requirements

### Requirement: An epic id holding a control character or whitespace is never stored

**Reason**: It let `sync` and the archive backfill register ids `add-epic` itself refuses — a change
directory `x|y`, whose pipe splits PROJECT.md's Epics table, `.hidden`, and uppercase plan names —
because it tested only for control characters and whitespace, and its scenario *"An uppercase plan
filename still registers, and a held one is not reported"* required that. Two rules for one id is the
drift sync-registers-ids-add-epic-refuses (0.50.0) removes. A MODIFIED block cannot drop a scenario the
main spec still holds, so the requirement is removed and restated under a name that says what it now
binds.

**Migration**: Replaced by the ADDED requirement *"No registration path stores an epic id add-epic
would refuse"* below, which keeps every refusal this one carried (control characters, whitespace, the
skip line on every run, the final-rung placement) and widens the rule to the whole id format. Stored
legacy ids are never re-validated: they still load, render and update. An uppercase plan is skipped
with a runnable `add-epic --id <lowercased> --plan <path>`.

## ADDED Requirements

### Requirement: No registration path stores an epic id add-epic would refuse
`add-epic` and `add-many` SHALL keep refusing an id that does not match `^[a-z0-9][a-z0-9._-]*$`, exit
non-zero and write nothing. `sync`'s registration of an active OpenSpec change and of a plan file, and
the archive backfill, SHALL NOT store an epic whose derived id does not match that same format, and
every one of these paths SHALL ask one shared validator rather than test the format itself
(sync-registers-ids-add-epic-refuses, 0.50.0, which superseded the 0.45.0 allowance for uppercase and
other characters). A stored epic whose id predates the rule SHALL still load, render and update. For
a skipped plan file whose lowercased name matches the format, the skip line SHALL carry a runnable
`add-epic --id <lowercased> --lane superpowers --plan <path>`, and `sync`'s final line SHALL count the
entries skipped for their name. The check SHALL apply
only at the step that would create the epic — after an entry has been matched to an existing epic by
any route (claimed artifact, known id, tombstone, near-match) — so an entry already held by an epic is
never reported as skipped. A sweep SHALL still register every other entry in the same run, SHALL exit as
it would have without the skipped entry, and SHALL name each skipped entry on stderr under the requirement
*A value the engine did not write never begins a line of output* on every run, whether or not it is running quietly. A report that tells the reader `sync` will
register an entry SHALL NOT say so of an entry `sync` skips.

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

#### Scenario: An uppercase plan filename is skipped with a runnable remedy, and a held one is not reported
- **WHEN** the plans directory holds `MASTER-platform-stabilization.md`, not yet registered, and
  `Legacy-Plan.md`, already held by an epic with id `Legacy-Plan`, and `sync` runs
- **THEN** `state.json` holds no epic `MASTER-platform-stabilization`, stderr names that file with
  `add-epic --id master-platform-stabilization --lane superpowers --plan …`, and carries no
  not-a-valid-epic-id skip line for `Legacy-Plan.md` (its already-claimed or id-already-exists line is
  unaffected)

#### Scenario: A change directory with a pipe is not registered
- **WHEN** `openspec/changes/` holds `x|y` and `good-change`, and `sync` runs
- **THEN** `state.json` holds `good-change` and no epic `x|y`, stderr names `x|y`, and the final line
  says `1 skipped`
