## Purpose

Defines the execution profile. It says how intensely to review, which model and effort each job role
runs on, and how often the agent reports. It covers how the profile is configured at the project,
lane and epic layers, how the effective value is resolved per field, and how pm emits it as
instructions without ever dispatching an agent itself.

## ADDED Requirements

### Requirement: A profile holds three fields drawn from closed value lists

An execution profile SHALL hold at most three fields.

- `review`: one of `off | standard | thorough`.
- `model`: a map from job role to a `{model, effort}` pair.
  - The job roles are `implement | test | review`.
  - `model` is one of `fable | opus | sonnet | haiku`. Each name means that family's latest
    release, and `fable` is the top tier for the hardest and longest tasks.
  - `effort` is one of `low | medium | high | xhigh | max | ultracode`.
- `notifications`: one of `quiet | verbose`.

Each list SHALL be declared once in the engine, and every verb that accepts or reports the field
SHALL read it from there.

`haiku` takes no effort. A pair naming `haiku` with an effort SHALL be refused. A pair naming any
other model without an effort SHALL also be refused, because a model with no effort leaves the job's
cost undecided. Any other value outside its list SHALL be refused, and the refusal SHALL name the
accepted values. Every refusal exits non-zero and writes nothing.

#### Scenario: A model pair with an effort is accepted

- **WHEN** the agent runs `set-profile --model implement=sonnet:medium`
- **THEN** the project layer's `model.implement` is recorded as `{model: "sonnet", effort: "medium"}`

#### Scenario: Haiku with an effort is refused

- **WHEN** the agent runs `set-profile --model test=haiku:low`
- **THEN** the command exits non-zero naming `haiku` as a model that takes no effort, and
  `state.json` is byte-identical to before

#### Scenario: Haiku without an effort is accepted

- **WHEN** the agent runs `set-profile --model test=haiku`
- **THEN** `model.test` is recorded as `{model: "haiku"}` with no effort key

#### Scenario: A non-haiku model without an effort is refused

- **WHEN** the agent runs `update-epic <id> --model review=opus`
- **THEN** the command exits non-zero naming the accepted efforts, and nothing is written

#### Scenario: An unknown model, role, effort or notification level is refused

- **WHEN** the agent passes `--model deploy=opus:medium`, `--model implement=gpt:high`,
  `--model implement=opus:huge`, or `--notifications loud`
- **THEN** each exits non-zero naming the offending value and the accepted list, and nothing is
  written

### Requirement: The profile is configured at three layers, and a detour has no layer of its own

A profile field SHALL be settable at three layers:

- **Project.** Written by `set-profile` with no scope flag. `set-review-mode --mode <m>` remains
  accepted as shorthand for `set-profile --review <m>`, and both SHALL write the same record.
- **Lane.** Written by `set-profile --lane <lane>`, where `<lane>` is one of the engine's known
  lanes. Any other lane SHALL be refused.
- **Epic.** Written by `add-epic`, `add-many` (as batch keys) and `update-epic` through
  `--review-mode`, `--model <role>=<model>[:<effort>]` (repeatable) and
  `--notifications <level>`.

A detour registered as an epic SHALL resolve from its own epic record. It SHALL NOT inherit any
field from the epic it paused. A minimal detour is a log line, not an epic, and has no profile.

Setting one role of `model` SHALL leave the layer's other roles unchanged.

#### Scenario: An epic override set at creation

- **WHEN** the agent runs `add-epic --id risky --title=Risky --lane openspec --review-mode thorough`
- **THEN** epic `risky` carries `review: thorough` at the epic layer, and no other layer changes

#### Scenario: add-many accepts the same fields as batch keys

- **WHEN** an `add-many` batch entry carries `model` and `notifications` keys with valid values
- **THEN** the created epic records them exactly as `add-epic` would, and an invalid value refuses
  the whole batch with nothing written

#### Scenario: A lane override

- **WHEN** the agent runs `set-profile --lane claude-code --review off`
- **THEN** the `claude-code` lane layer records `review: off`, and neither the project layer nor any
  epic changes

#### Scenario: An unknown lane is refused

- **WHEN** the agent runs `set-profile --lane marketing --review off`
- **THEN** the command exits non-zero naming the known lanes, and nothing is written

#### Scenario: set-review-mode and set-profile write one record

- **WHEN** the agent runs `set-review-mode --mode thorough` and then `profile`
- **THEN** the project `review` reads `thorough` with source `project`

#### Scenario: Setting one model role leaves the others

- **WHEN** the project layer holds `model.implement` and `model.test`, and the agent runs
  `set-profile --model review=opus:high`
- **THEN** all three roles are recorded, and `implement` and `test` are unchanged

#### Scenario: A detour epic does not inherit from the epic it paused

- **WHEN** epic `parent` carries `review: thorough`, and a detour epic `fix` with no review of its
  own is pushed with `push-detour parent --detour fix`
- **THEN** `profile --epic fix` resolves `review` from `fix`'s lane or the project, never from
  `parent`

### Requirement: The effective value is resolved bottom-up, per field

For a given epic, each field SHALL resolve independently, in this order:

1. the epic's own value, if set;
2. otherwise the value set for the epic's lane, if any;
3. otherwise the project value, if set;
4. otherwise the built-in default.

`model` SHALL resolve PER ROLE, and the `{model, effort}` pair SHALL be taken whole from the first
layer that sets that role. A layer never contributes an effort to another layer's model, so a
resolved pair can never be an effort paired with `haiku`.

The epic's `review` SHALL win even where it is LOWER than the lane's or the project's. The previous
escalate-only rule is replaced: `update-epic --review-mode` SHALL NOT refuse a value below the
project `review`, and the effective value SHALL NOT be the maximum of the layers.

A stored value outside its closed list, for example after a hand edit, SHALL be treated as unset at
that layer. Resolution falls through it, and the read verb names the value it ignored.

#### Scenario: An epic overrides only review

- **WHEN** the project sets `review: standard`, `model.implement: opus/medium` and
  `notifications: quiet`, and epic `e` sets only `review: thorough`
- **THEN** `e` resolves `review: thorough` (epic), `model.implement: opus/medium` (project) and
  `notifications: quiet` (project)

#### Scenario: A lane value sits between project and epic

- **WHEN** the project sets `review: thorough`, the `claude-code` lane sets `review: standard`, and
  a `claude-code` epic sets no review
- **THEN** the epic resolves `review: standard` with source `lane:claude-code`

#### Scenario: An epic lowers review below the project

- **WHEN** the project `review` is `thorough` and the agent runs
  `update-epic docs-tweak --review-mode standard`
- **THEN** the command succeeds, and `docs-tweak` resolves `review: standard` with source `epic`

#### Scenario: A model pair is taken whole from one layer

- **WHEN** the lane sets `model.test: sonnet/low` and the epic sets `model.test: haiku`
- **THEN** the epic resolves `model.test` as `haiku` with no effort, from source `epic`

#### Scenario: Nothing set resolves to today's behaviour

- **WHEN** a state file written before this capability, holding no profile keys at any layer, is
  resolved for any epic
- **THEN** `review` resolves to `standard`, `notifications` to `quiet`, and each `model` role to
  "no model directive", all with source `default`, and the file loads with no migration

#### Scenario: A stored invalid value falls through

- **WHEN** an epic's `notifications` field holds `loud` in `state.json` and the lane sets `verbose`
- **THEN** the epic resolves `notifications: verbose` from `lane:<lane>`, and `profile --epic <id>`
  names `loud` as an ignored epic-layer value

### Requirement: Every set has an inverse at every layer

Each field SHALL be clearable at each layer it can be set, and clearing SHALL make that field fall
through to the next layer.

- **Project and lane layers.** `set-profile [--lane <lane>] --unset <field>`, repeatable. `<field>`
  is `review`, `notifications`, `model` (every role) or `model:<role>` (one role).
- **Epic layer.** `update-epic <id> --clear review-mode`, `--clear notifications`, `--clear model`
  (every role) and `--clear-model <role>` (repeatable).
- **The shorthand.** `set-review-mode` ships no inverse of its own. Its inverse is
  `set-profile --unset review`, and `commands/review-mode.md` SHALL name it.

A lane layer left with no field set SHALL be removed from the record, so an emptied lane is
indistinguishable from one never configured. Unsetting a field that is not set SHALL succeed, write
nothing, and say that it was already unset.

#### Scenario: Unsetting the project review restores the default

- **WHEN** the project `review` is `thorough` and the agent runs `set-profile --unset review`
- **THEN** a project with no lane or epic override resolves `review: standard` with source `default`

#### Scenario: Clearing one epic model role

- **WHEN** epic `e` sets `model.implement` and `model.test`, and the agent runs
  `update-epic e --clear-model test`
- **THEN** `e` keeps `model.implement`, and `model.test` resolves from the lane or project layer

#### Scenario: Unsetting the last field of a lane removes the lane layer

- **WHEN** the `decision` lane holds only `review: off`, and the agent runs
  `set-profile --lane decision --unset review`
- **THEN** `state.json` holds no layer for `decision`

#### Scenario: Unsetting what is not set writes nothing

- **WHEN** the agent runs `set-profile --unset notifications` on a project with no notifications set
- **THEN** the command exits zero, reports the field was already unset, and `state.json` is
  byte-identical

### Requirement: The effective profile is readable with each value's source

A read verb, `profile`, SHALL print the effective profile. With `--epic <id>`, it prints that epic's
profile. With `--lane <lane>`, it prints what an epic of that lane with no overrides would resolve.
With neither, it prints the project layer.

For every field, and for each `model` role, the output SHALL name the resolved value and the layer
it came from: `epic`, `lane:<lane>`, `project` or `default`. So an epic that LOWERED a value is
visible as such. `profile` SHALL write nothing, and SHALL refuse an unknown epic id or lane, naming
it.

#### Scenario: The source of a lowered value is visible

- **WHEN** the project `review` is `thorough`, epic `e` sets `review: standard`, and the agent runs
  `profile --epic e`
- **THEN** the output shows `review: standard` with source `epic`, and names the project value
  `thorough` it overrides

#### Scenario: profile refuses an unknown epic

- **WHEN** the agent runs `profile --epic no-such-epic`
- **THEN** the command exits non-zero naming `no-such-epic`, and nothing is written

### Requirement: pm emits the profile as instructions and never dispatches

The engine SHALL record, resolve and emit the profile, and SHALL NOT start, configure or choose a
model for any agent at run time. Emission SHALL reach the agent through surfaces pm already writes.

- **The managed rules block** carries an "Execution profile" section. It holds:
  - the project values;
  - every lane override;
  - the resolution order;
  - the instruction to resolve the active epic's profile before dispatching a job, and to use the
    resolved `{model, effort}` for that job's role where the platform supports it (and to say so
    where it does not);
  - the notification rule: `quiet` means one completion message per epic, `verbose` means a message
    at each phase transition and gate.

  The existing line `Current mode: **<review>**.` SHALL remain, carrying the resolved project
  `review`.
- **`rules --epic <id>`** emits the same section with that epic's effective values.
- **The session briefing** names the active epic's effective profile, one field per item.
- **The `/pm:init` instructions** tell the agent to ASK the user for the project profile before
  writing it. They recommend `opus` with `medium` effort for every role, and name `sonnet` for
  `implement` and `haiku` for `test` as the cheaper alternative. The user's choice is recorded with
  `set-profile`. The instructions also offer lane overrides at the same point. The engine SHALL NOT
  write any recommended value on its own.

#### Scenario: The rules block names lane overrides

- **WHEN** the project sets `review: thorough`, the `claude-code` lane sets `review: standard`, and
  the rules block is written
- **THEN** the block's "Execution profile" section lists the project `review: thorough` and the
  `claude-code` lane override `review: standard`, and still carries
  `Current mode: **thorough**.`

#### Scenario: rules --epic emits the effective value

- **WHEN** epic `e` sets `model.implement: sonnet/medium`, and the agent runs `rules --epic e`
- **THEN** the emitted section shows `implement: sonnet (medium)` with source `epic`

#### Scenario: init writes no model on its own

- **WHEN** `init` runs on a fresh repository
- **THEN** `state.json` holds no `executionProfile` model entry, and the emitted init instructions
  name the recommended `opus` / `medium` default and the cheaper `sonnet` / `haiku` option as a
  question for the user

#### Scenario: Nothing is dispatched

- **WHEN** any profile verb runs
- **THEN** the engine starts no child process other than the `git` calls it already makes, and opens
  no network connection
