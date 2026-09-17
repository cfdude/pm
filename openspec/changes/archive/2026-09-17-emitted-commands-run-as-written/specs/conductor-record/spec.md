## ADDED Requirements

### Requirement: No instruction pm ships directs a write to the state of record except through a verb
Wherever pm tells an agent to change what `.conductor/state.json` records — an epic's status,
priority, active pointer, stories, the detour stack — the instruction SHALL name the engine verb
that makes that change, and SHALL NOT direct the agent to edit, update or set the file itself. This
binds everything the engine prints (`init`'s output, the commit nudge, the brief, refusals) and every
document pm ships (`commands/*.md`, `skills/**/SKILL.md`, `agents/*.md`, `README.md`). Reading the
file is not a write and stays allowed.

The exception for a stored epic or release id holding a control character, which no verb can rename,
is specified in `output-text-integrity`.

A hand-edit skips everything a verb supplies: validation, the write lock, the revision guard, the
read-back, and — on a POP — the same-write `reconcileNeeded` stamp the rules block exists to protect.
The rules block already says "NEVER hand-edit"; text elsewhere saying otherwise is two instructions
that cannot both be followed.

#### Scenario: init's closing line names verbs
- **WHEN** `init` completes in a fresh repository
- **THEN** its output names the verbs that set priority, status and the active epic, and does not
  direct triage "in `.conductor/state.json`" (today it does)

#### Scenario: The commit nudge names verbs
- **WHEN** the commit nudge fires for a commit outside a detour that was not auto-logged
- **THEN** its message names the verb that records an epic's status or story change, and does not
  tell the agent to update `.conductor/state.json` (today it does)

#### Scenario: No shipped document directs a hand-edit
- **WHEN** the shipped documents are scanned for instructions to edit, update or set
  `.conductor/state.json` or one of its fields directly
- **THEN** none is found outside text that forbids or explains the hand-edit (today
  `skills/conductor/SKILL.md` and `commands/init.md` each carry one)
