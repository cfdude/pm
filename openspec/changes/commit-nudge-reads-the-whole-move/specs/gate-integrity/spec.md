## ADDED Requirements

### Requirement: The post-commit attribution hint names every candidate epic and decides none

When the commit hook prints an attribution hint for the commits a tool call landed, the hint SHALL
name every **candidate epic** that carries an attribution array:

- while a detour is live: the detour epic and every epic paused on the detour stack;
- otherwise: the active epic;
- in either case: every epic that is not archived and whose own artifacts (as `commit-observation`
  defines them) the commit touches.

Where more than one candidate exists, the hint SHALL give each candidate its own runnable
`update-epic <id> --attribute-commit <sha>…` command, SHALL state that choosing among them is the
agent's decision, and SHALL order candidates whose own artifacts the commit touches first. Ordering
is the only use the hint makes of a commit's changed paths. The hook SHALL NOT write any epic's
attribution array, whatever the candidates and their order, consistent with "Commit attribution is
written by a named flag the emitted instructions require".

Where a tool call landed more than one commit, each command SHALL name every attributable commit
of that call in landing order, as one invocation.

#### Scenario: During a detour the hint names the paused epic as well

- **WHEN** epic P is paused behind detour D, both carry attribution arrays, and a commit lands
- **THEN** the hint prints a runnable command for D and one for P, and states the choice is the
  agent's

#### Scenario: A commit confined to the paused epic's change directory lists that epic first

- **WHEN** epic P is paused behind detour D and a commit touches only `openspec/changes/P/tasks.md`
- **THEN** the command naming P is printed before the command naming D

#### Scenario: The hint never records an attribution

- **WHEN** the hook prints a hint naming one or more candidates for a commit that touches only a
  candidate's own artifacts
- **THEN** every epic's attribution array in `state.json` is unchanged by that hook run

#### Scenario: A single candidate keeps a single command

- **WHEN** no detour is live, epic A is active, and a commit touches no epic's own artifacts
- **THEN** the hint prints exactly one command, naming A
