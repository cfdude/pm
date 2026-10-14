# execution-profile Specification

## Purpose
Defines the execution profile. It says how intensely to review, which model and effort each job role
runs on, and how often the agent reports. It covers how the profile is configured at the project,
lane and epic layers, how the effective value is resolved per field, and how pm emits it as
instructions without ever dispatching an agent itself.

## Requirements

### Requirement: A profile holds three fields drawn from closed value lists

An execution profile SHALL hold at most three fields.

- `review`: one of `off | standard | thorough`.
- `model`: a map from job role to a `{model, effort}` pair.
  - The job roles are `plan | implement | test | review | mechanical | rudimentary`:
    - `plan` writes proposals, specs, designs and implementation plans;
    - `implement` builds the work;
    - `test` writes and runs tests;
    - `review` runs gate and code reviews;
    - `mechanical` makes fully specified rote edits, such as renames, fixture regeneration, doc
      sync and changeset fragments;
    - `rudimentary` does trivial lookups, listings, summaries and formatting.
  - `model` is one of `fable | opus | sonnet | haiku`. Each name means that family's latest
    release, and `fable` is the top tier for the hardest and longest tasks.
  - `effort` is one of `low | medium | high | xhigh | max | ultracode`.
- `verbosity`: one of `quiet | verbose`.

Each list SHALL be declared once in the engine, and every verb that accepts or reports the field
SHALL read it from there. That includes every help text, refusal message and emitted instruction
that names the job roles. None of them SHALL type the role list itself. The spend ledger's `role`
vocabulary SHALL be this same job-role list, and no second role list SHALL exist.

`haiku` takes no effort. A pair naming `haiku` with an effort SHALL be refused. A pair naming any
other model without an effort SHALL also be refused, because a model with no effort leaves the job's
cost undecided. Any other value outside its list SHALL be refused, and the refusal SHALL name the
accepted values. Every refusal exits non-zero and writes nothing.

#### Scenario: A model pair with an effort is accepted

- **WHEN** the agent runs `set-profile --model implement=sonnet:medium`
- **THEN** the project layer's `model.implement` is recorded as `{model: "sonnet", effort: "medium"}`

#### Scenario: A new role is accepted at every layer

- **WHEN** the agent runs `set-profile --model plan=fable:high`, then
  `set-profile --lane claude-code --model mechanical=haiku`, then
  `update-epic e --model rudimentary=sonnet:low`
- **THEN** each pair is recorded at its layer under that role name

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

#### Scenario: An unknown model, role, effort or verbosity level is refused

- **WHEN** the agent passes `--model deploy=opus:medium`, `--model implement=gpt:high`,
  `--model implement=opus:huge`, or `--verbosity loud`
- **THEN** each exits non-zero naming the offending value and the accepted list, and nothing is
  written
- **AND** the refusal for `deploy` names all six job roles

#### Scenario: The role-taking flag's help names every role

- **WHEN** the agent runs `update-epic --help`
- **THEN** the `--clear-model` entry names all six job roles

### Requirement: The profile is configured at three layers, and a detour has no layer of its own

A profile field SHALL be settable at three layers:

- **Project.** Written by `set-profile` with no scope flag. `set-review-mode --mode <m>` remains
  accepted as shorthand for `set-profile --review <m>`, and both SHALL write the same record.
- **Lane.** Written by `set-profile --lane <lane>`, where `<lane>` is one of the engine's known
  lanes. Any other lane SHALL be refused.
- **Epic.** Written by `add-epic`, `add-many` (as batch keys) and `update-epic` through
  `--review-mode`, `--model <role>=<model>[:<effort>]` (repeatable) and
  `--verbosity <level>`.

A detour registered as an epic SHALL resolve from its own epic record. It SHALL NOT inherit any
field from the epic it paused. A minimal detour is a log line, not an epic, and has no profile.

Setting one role of `model` SHALL leave the layer's other roles unchanged.

#### Scenario: An epic override set at creation

- **WHEN** the agent runs `add-epic --id risky --title=Risky --lane openspec --review-mode thorough`
- **THEN** epic `risky` carries `review: thorough` at the epic layer, and no other layer changes

#### Scenario: add-many accepts the same fields as batch keys

- **WHEN** an `add-many` batch entry carries `model` and `verbosity` keys with valid values
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
4. otherwise the built-in default: `review` `standard`, `verbosity` `quiet`, and for each `model`
   role, that role's default pair.

`model` SHALL resolve PER ROLE, and the `{model, effort}` pair SHALL be taken whole from the first
layer that sets that role. If no layer sets the role, the pair is taken whole from the default. A
layer never contributes an effort to another layer's model, or to the default's, so a resolved pair
can never be an effort paired with `haiku`.

The epic's `review` SHALL win even where it is LOWER than the lane's or the project's. The previous
escalate-only rule is replaced: `update-epic --review-mode` SHALL NOT refuse a value below the
project `review`, and the effective value SHALL NOT be the maximum of the layers.

A stored value outside its closed list, for example after a hand edit, SHALL be treated as unset at
that layer. Resolution falls through it, and the read verb names the value it ignored.

#### Scenario: An epic overrides only review

- **WHEN** the project sets `review: standard`, `model.implement: opus/medium` and
  `verbosity: quiet`, and epic `e` sets only `review: thorough`
- **THEN** `e` resolves `review: thorough` (epic), `model.implement: opus/medium` (project) and
  `verbosity: quiet` (project)

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

#### Scenario: A layer's pair replaces the default whole

- **WHEN** the project sets `model.rudimentary: sonnet/low` and nothing else
- **THEN** `rudimentary` resolves `sonnet (low)` with source `project`, and `plan` still resolves
  its default `opus (high)` with source `default`

#### Scenario: Nothing set resolves to today's behaviour

- **WHEN** a state file written before this capability holds no profile keys at any layer, and it
  is resolved for any epic
- **THEN** `review` resolves to `standard` and `verbosity` to `quiet`, and each `model` role
  resolves to its default pair, all with source `default`
- **AND** the file loads with no migration, and `upgrade` leaves its profile keys absent

#### Scenario: A pre-0.52.0 state with the old three roles still resolves

- **WHEN** the project layer holds only `model.implement`, `model.test` and `model.review`, as
  written by 0.51.0
- **THEN** those three resolve from `project`, and `plan`, `mechanical` and `rudimentary` resolve
  from `default`

#### Scenario: Unsetting a role restores its default

- **WHEN** the project sets `model.plan: sonnet/high` and the agent runs
  `set-profile --unset model:plan`
- **THEN** with no lane or epic override, `plan` resolves `opus (high)` with source `default`

#### Scenario: A stored invalid value falls through

- **WHEN** an epic's `verbosity` field holds `loud` in `state.json` and the lane sets `verbose`
- **THEN** the epic resolves `verbosity: verbose` from `lane:<lane>`, and `profile --epic <id>`
  names `loud` as an ignored epic-layer value

### Requirement: Every set has an inverse at every layer

Each field SHALL be clearable at each layer it can be set, and clearing SHALL make that field fall
through to the next layer, and past the last layer to the built-in default.

- **Project and lane layers.** `set-profile [--lane <lane>] --unset <field>`, repeatable. `<field>`
  is `review`, `verbosity`, `model` (every role) or `model:<role>` (one role).
- **Epic layer.** `update-epic <id> --clear review-mode`, `--clear verbosity`, `--clear model`
  (every role) and `--clear-model <role>` (repeatable).
- **The shorthand.** `set-review-mode` ships no inverse of its own. Its inverse is
  `set-profile --unset review`, and `commands/review-mode.md` SHALL name it.

There SHALL be no value that makes a model role resolve to "no directive". The built-in default is
the floor every role clears to.

A lane layer left with no field set SHALL be removed from the record, so an emptied lane is
indistinguishable from one never configured. Unsetting a field that is not set SHALL succeed, write
nothing, and say that it was already unset.

#### Scenario: Unsetting the project review restores the default

- **WHEN** the project `review` is `thorough` and the agent runs `set-profile --unset review`
- **THEN** a project with no lane or epic override resolves `review: standard` with source `default`

#### Scenario: Clearing one epic model role

- **WHEN** epic `e` sets `model.implement` and `model.test`, and the agent runs
  `update-epic e --clear-model test`
- **THEN** `e` keeps `model.implement`, and `model.test` resolves from the lane layer, else the
  project layer, else its default `sonnet (low)` with source `default`

#### Scenario: Clearing every epic model role falls through to the defaults

- **WHEN** epic `e` sets `model.plan` and no lane or project layer sets a model, and the agent runs
  `update-epic e --clear model`
- **THEN** every role of `e` resolves its default with source `default`, and the clear's confirmation
  text names the default as the last fallback

#### Scenario: Unsetting the last field of a lane removes the lane layer

- **WHEN** the `decision` lane holds only `review: off`, and the agent runs
  `set-profile --lane decision --unset review`
- **THEN** `state.json` holds no layer for `decision`

#### Scenario: Unsetting what is not set writes nothing

- **WHEN** the agent runs `set-profile --unset verbosity` on a project with no verbosity set
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
  - the project values, with one line per job role carrying its resolved pair and its source,
    defaults included;
  - every lane override;
  - the resolution order, which names the built-in default pair per role as the last layer;
  - the instruction to resolve the active epic's profile before dispatching a job, and to run that
    job on the resolved `{model, effort}` of the role it matches, where the platform supports it
    (and to say so where it does not). The jobs named SHALL be every job role, rendered from the
    job-role list;
  - the one-shot override: an epic built straight off a finished plan by a top-tier model sets
    `--model implement=fable:<effort>`;
  - the verbosity rule: `quiet` means one completion message per epic, `verbose` means a message
    at each phase transition and gate.

  The existing line `Current mode: **<review>**.` SHALL remain, carrying the resolved project
  `review`.
- **`rules --epic <id>`** emits the same section with that epic's effective values.
- **The session briefing** names the active epic's effective profile: one line per field, such as
  `review: thorough (epic)`, plus a `model:` line only for each role whose source is not `default`.
- **The `/pm:init` instructions** tell the agent to ASK the user about the project profile before
  writing it. They present the built-in default table as the recommendation; accepting it records
  nothing. They name the one-shot override, and they offer lane overrides at the same point. Any
  value the user chooses instead is recorded with `set-profile`. The engine SHALL NOT write any
  model value on its own.

#### Scenario: The rules block names lane overrides

- **WHEN** the project sets `review: thorough`, the `claude-code` lane sets `review: standard`, and
  the rules block is written
- **THEN** the block's "Execution profile" section lists the project `review: thorough` and the
  `claude-code` lane override `review: standard`, and still carries
  `Current mode: **thorough**.`

#### Scenario: The rules block shows every role's default

- **WHEN** the rules block is written for a project that sets no model
- **THEN** the "Execution profile" section carries one `model <role>:` line for each of the six
  roles, each naming its default pair with source `default`, and the "Before dispatching a job"
  instruction names all six roles

#### Scenario: The resolution order names every default, even for an overridden role

- **WHEN** the project sets `model.implement: sonnet/medium`, and the rules block is written
- **THEN** the resolution-order sentence names the built-in default pair of all six roles. That
  includes `plan` `opus (high)` and `rudimentary` `haiku`, and also `implement`'s default, which
  the project overrides. The default pairs are rendered from the engine's one default table.

#### Scenario: rules --epic emits the effective value

- **WHEN** epic `e` sets `model.implement: sonnet/medium`, and the agent runs `rules --epic e`
- **THEN** the emitted section shows `implement: sonnet (medium)` with source `epic`

#### Scenario: The brief stays silent on defaults

- **WHEN** the active epic sets `model.implement: fable/high` and no layer sets any other model
- **THEN** the brief carries exactly one `model:` line, `model: implement fable (high) (epic)`

#### Scenario: init writes no model on its own

- **WHEN** `init` runs on a fresh repository
- **THEN** `state.json` holds no `executionProfile` model entry, and the emitted init instructions
  present the built-in default table as the recommendation, as a question for the user

#### Scenario: Nothing is dispatched

- **WHEN** any profile verb runs
- **THEN** the engine starts no child process other than the `git` calls it already makes, and opens
  no network connection

### Requirement: Every job role has a built-in default model pair

The engine SHALL declare, once and beside the job-role list, a built-in default `{model, effort}`
pair for every job role: `plan` opus/high, `implement` sonnet/medium, `test` sonnet/low, `review`
opus/high, `mechanical` sonnet/low, `rudimentary` haiku. Every default SHALL pass the same check
as a user-set pair. The defaults SHALL cover exactly the job roles, no more and no fewer.

#### Scenario: The default table covers exactly the job roles

- **WHEN** the default table and the job-role list are compared
- **THEN** they hold the same role names, and every default pair passes the same check that
  `set-profile --model` applies

#### Scenario: A fresh repository resolves every role to its default

- **WHEN** `profile` runs on a state file holding no `model` entry at any layer
- **THEN** it prints `model plan: opus (high) (default)`, `model implement: sonnet (medium)
  (default)`, `model test: sonnet (low) (default)`, `model review: opus (high) (default)`,
  `model mechanical: sonnet (low) (default)` and `model rudimentary: haiku (default)`

### Requirement: A default is never stored

A default model pair SHALL NOT be written to `state.json` by any verb, by `init`, or by `upgrade`.
It exists only at resolution time. A value recorded at the project, lane or epic layer is
therefore always something someone chose, and a default is always reported with source `default`.

#### Scenario: No verb writes a default

- **WHEN** `init`, then `upgrade`, then `profile` run on a fresh repository
- **THEN** `state.json` holds no `executionProfile.model` entry, no lane `model` entry and no
  epic `model` entry

### Requirement: A one-shot build is an epic-layer override of the implement role

The way to have a top-tier model build an epic straight off its finished plan SHALL be an
epic-layer override of the `implement` role, `--model implement=fable:<effort>`. It SHALL NOT be a
separate job role. The emitted instructions and the profile command doc SHALL name this override.

#### Scenario: A one-shot epic overrides only implement

- **WHEN** the agent runs `update-epic e --model implement=fable:high`, and no other layer sets a
  model
- **THEN** `profile --epic e` shows `model implement: fable (high) (epic)`, and every other role
  shows its default with source `default`
