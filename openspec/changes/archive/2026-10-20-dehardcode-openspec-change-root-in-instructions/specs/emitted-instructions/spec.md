## ADDED Requirements

### Requirement: Shipped instructions name an OpenSpec change's location as OpenSpec resolves it

Shipped instruction text SHALL name a change's location as the `changeRoot` that
`openspec status --change <id> --json` reports, and an archived change as the directory `/opsx:archive`
moved it to. The literal `openspec/changes/` MAY appear only as a stated default, immediately preceded
by `by default `. The population is the one this capability already derives, plus the rendered rules
block and brief.

#### Scenario: The emitted rules block carries no pinned path

- **WHEN** the rules block is rendered for every supported platform under both the current state and a state with every opt-in on
- **THEN** every occurrence of `openspec/changes/` in it is immediately preceded by `by default `

#### Scenario: A shipped document with a pinned path fails the sweep

- **WHEN** a file under `commands/` contains `read openspec/changes/<id>/tasks.md`
- **THEN** the sweep test fails, naming that file and line

#### Scenario: A stated default passes

- **WHEN** a shipped document says `its directory (changeRoot from openspec status --change <id> --json; by default openspec/changes/<id>/)`
- **THEN** the sweep test passes that line

#### Scenario: The reconciler is pointed at the resolved location

- **WHEN** `agents/reconciler.md` tells the reconciler where to read the paused change's proposal and tasks
- **THEN** it names `changeRoot` from `openspec status --change <paused> --json`

#### Scenario: The population is derived, not listed

- **WHEN** a new file is added under `skills/<name>/SKILL.md` containing a pinned path
- **THEN** the sweep test fails without the test being edited
