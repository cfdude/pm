## ADDED Requirements

### Requirement: The post-commit attribution hint names every candidate epic and decides none

When the commit hook prints an attribution hint for live commits it reports, the hint SHALL name every
**candidate epic** that carries an attribution array, and no other epic:

- while a detour is live: the detour epic and every epic paused on the detour stack;
- otherwise: the active epic.

With no candidate the hook SHALL print no attribution hint. Where more than one candidate exists, the
hint SHALL give each candidate its own runnable `update-epic <id> --attribute-commit <sha>…` command
and SHALL state that choosing among them is the agent's decision. A candidate whose own artifacts (as
`commit-observation` defines them) the reported commits touch SHALL be ordered before one whose
artifacts they do not touch; ordering is the only use the hint makes of changed paths, and changed
paths never add a candidate. The hook SHALL NOT write any epic's attribution array, consistent with
"Commit attribution is written by a named flag the emitted instructions require".

Where one observation reports more than one live commit, each command SHALL name every such commit in
landing order, as one invocation.

#### Scenario: During a detour the hint names the paused epic as well

- **WHEN** epic P is paused behind detour D, both carry attribution arrays, and a commit lands
- **THEN** the hint prints a runnable command for D and one for P, and states the choice is the
  agent's

#### Scenario: A commit confined to the paused epic's change directory lists that epic first

- **WHEN** epic P is paused behind detour D and a commit touches only `openspec/changes/P/tasks.md`
- **THEN** the command naming P is printed before the command naming D

#### Scenario: Touching an epic's files never makes it a candidate

- **WHEN** no epic is active, no detour is live, and a commit touches only `openspec/changes/E/` for a
  registered epic E — including the move of that directory under `openspec/changes/archive/`
- **THEN** the hook prints no attribution hint

#### Scenario: The hint never records an attribution

- **WHEN** the hook prints a hint naming one or more candidates
- **THEN** every epic's attribution array in `state.json` is unchanged by that hook run

#### Scenario: A single candidate keeps a single command

- **WHEN** no detour is live, epic A is active, and a commit touches no epic's own artifacts
- **THEN** the hint prints exactly one command, naming A
