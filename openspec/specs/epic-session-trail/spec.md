# epic-session-trail Specification

## Purpose
Record on each epic which named sessions changed it, from an opaque identity the agent supplies, so the
record itself can say who wrote it without the activity log.

## Requirements

### Requirement: --session is accepted by every epic-writing verb

Every verb that can change an epic SHALL declare `--session <name>` through the shared flag allowlist.
The identity SHALL resolve as `--session`, else `PM_SESSION`, else none.

#### Scenario: update-epic accepts --session

- **WHEN** `update-epic E --notes "x" --session build-a` runs
- **THEN** the verb is not refused for an undeclared flag
- **AND** the note is recorded

#### Scenario: The flag wins over the environment

- **WHEN** `PM_SESSION=env-a` is set and `update-epic E --notes "x" --session flag-b` runs
- **THEN** the identity recorded is `flag-b`

#### Scenario: The allowlist is the only declaration

- **WHEN** the documented flag surface of each epic-writing verb is read
- **THEN** every one that documents `--session` accepts it, and no second list declares it

### Requirement: A changed epic records the session that changed it

When a non-hook verb's save changes an epic and an identity resolves, the same write SHALL record it in
`epic.sessions`: one `{session, firstAt, lastAt}` entry per distinct identity, in first-seen order.
Entries SHALL NOT be reordered or removed. With no identity, `epic.sessions` SHALL NOT be written.

#### Scenario: A first write by a session appends an entry

- **WHEN** `update-epic E --notes "x"` runs with `PM_SESSION=build-a` and E has no `sessions`
- **THEN** E's record holds `sessions: [{session: "build-a", firstAt: T, lastAt: T}]` written in the same save as the note

#### Scenario: A later write by the same session moves only lastAt

- **WHEN** `build-a` writes E again at T2
- **THEN** E still holds one `build-a` entry with `firstAt` T and `lastAt` T2

#### Scenario: A second session is appended after the first

- **WHEN** `build-b` writes E after `build-a`
- **THEN** `E.sessions` lists `build-a` then `build-b`

#### Scenario: No identity writes no trail

- **WHEN** neither `--session` nor `PM_SESSION` is given and `update-epic E --notes "x"` runs
- **THEN** E's record has no `sessions` field added

#### Scenario: A no-op write records nothing

- **WHEN** `update-epic E --priority P2 --session build-a` runs and E is already P2
- **THEN** the verb reports that nothing changed
- **AND** `state.json` is byte-identical to before

#### Scenario: A side-effect change is stamped too

- **WHEN** E1 is active and `set-active E2 --session build-a` runs
- **THEN** every epic whose record that save changed carries a `build-a` entry

#### Scenario: A hook's self-heal save stamps nothing

- **WHEN** `PM_SESSION=build-a` is set and a hook's `reconcileArchived()` self-heal changes an epic
- **THEN** that epic gains no `sessions` entry from the hook's save

#### Scenario: An older state file loads

- **WHEN** a state file written by 0.52.0 is loaded
- **THEN** no epic has `sessions` and nothing is rewritten

### Requirement: A session identity is validated before any write

An identity SHALL be non-blank after trimming, at most 128 characters, and free of control characters.
On a non-hook verb an invalid identity SHALL be refused, naming the rule, with nothing written. A hook
verb (one `hooks/hooks.json` invokes) SHALL neither validate, refuse on, nor stamp an identity.

#### Scenario: A blank identity is refused

- **WHEN** `update-epic E --notes "x" --session "   "` runs
- **THEN** the verb exits non-zero naming the rule
- **AND** `state.json` is byte-identical to before

#### Scenario: A hook never refuses on the identity

- **WHEN** `PM_SESSION` holds an escape character and the SessionStart, PreCompact, PostToolUse or PreToolUse hook runs
- **THEN** the hook behaves exactly as with no identity: no refusal, no stamp, and its output carries no identity text

#### Scenario: A control character is refused

- **WHEN** `PM_SESSION` holds an escape character and `update-epic E --notes "x"` runs
- **THEN** the verb exits non-zero naming the rule, and writes nothing
