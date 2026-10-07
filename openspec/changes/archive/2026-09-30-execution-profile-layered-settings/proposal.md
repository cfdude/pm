# Proposal: execution-profile-layered-settings

## Why

Review intensity is one repo-global dial today (`state.reviewMode`, set by `set-review-mode`), with a
per-epic override that can only ESCALATE above it (`update-epic --review-mode`, refused below the
dial in `scripts/lib/update-epic.mjs`, resolved as `max(global, epic)` by `currentReviewMode()` in
`scripts/lib/rules.mjs`). pm records nothing about which model or effort a job should run on, and
nothing about how chatty the agent should be.

0.51.0 measured the cost. Its five epics spent ~11M+ subagent tokens, and ~70% of that went to one
epic's 7+ review rounds under a repo-wide `thorough`. That epic needed `thorough`. The others
inherited it because the only lever was the whole repo. The inverse case was not expressible at
all: a financial app that runs `thorough` everywhere cannot mark a non-critical component
`standard`, because the epic override refuses to go below the dial.

Rob, 2026-09-29: review thoroughness, model and verbosity must cascade the way Claude
Code settings do. Project default, overridden per lane, overridden per epic.

## What Changes

- **An execution profile with three fields.**
  - `review`: `off | standard | thorough`.
  - `model`: per job role `implement | test | review`, each a `{model, effort}` pair. Models are the
    closed list `fable | opus | sonnet | haiku`, each meaning "latest". Effort is
    `low | medium | high | xhigh | max | ultracode`. `haiku` takes no effort, and an effort given
    with `haiku` is refused.
  - `verbosity`: `quiet | verbose`. `quiet` means one completion message.
- **Three layers: project, lane, epic.** A detour is an epic and resolves from its own record. It
  does not inherit from the epic it paused. There is no separate detour layer.
- **Configure top-down.**
  - Project default at `/pm:init`. The emitted instructions tell the agent to ASK the user and to
    recommend `opus` / `medium`, naming `sonnet` for `implement` and `haiku` for `test` as the
    cheaper option. The user chooses.
  - Lane overrides at setup.
  - Epic overrides at creation (`add-epic`, `add-many`) or later (`update-epic`).
- **Resolve bottom-up, per field.** The value comes from the epic if set, else the lane, else the
  project, else the built-in default. `model` resolves per role, as a whole `{model, effort}` pair.
  So an epic can override only `review`, or only `model.test`.
- **BREAKING (behaviour of an existing guard): the epic's `review` may now be LOWER than the
  project's.** The escalate-only refusal in `update-epic --review-mode` is removed, and
  `max(global, epic)` becomes most-specific-wins. This is the user's decision and the epic's own
  example depends on it. To keep a lowering visible, every read of the effective profile names the
  layer each value came from.
- **New verbs.**
  - `set-profile [--lane <lane>] …` sets and unsets at the project or lane layer.
  - `profile [--epic <id> | --lane <lane>]` reads the effective profile and names each value's
    source layer.
- **New epic flags** on `add-epic`, `add-many` and `update-epic`: `--model`, `--verbosity`,
  plus the existing `--review-mode`. Their inverses are `--clear review-mode`,
  `--clear verbosity`, `--clear model` and `--clear-model <role>`.
- `set-review-mode` stays as shorthand for the project-layer `review`. Its inverse is
  `set-profile --unset review`.
- **Emission.**
  - The rules block's "Review mode" section becomes "Execution profile". It shows the project
    values, any lane overrides and the resolution order, and keeps the `Current mode:` line.
  - `rules --epic <id>` emits that epic's effective profile.
  - The briefing names the active epic's effective profile.
- **The engine only records, resolves and emits.** It never dispatches an agent and never picks a
  model at run time. pm is an instruction layer.
- **The schema change is additive.** Every new key is optional, and an absent key resolves to
  today's behaviour: `review` falls back to `standard`, `verbosity` to `quiet`, and `model` to
  no model directive. No `MIGRATIONS` entry.

## Capabilities

### New Capabilities

- `execution-profile`: what an execution profile holds, how each layer is configured and cleared,
  how the effective value is resolved per field, and how pm emits it without dispatching anything.

### Modified Capabilities

None. The escalate-only rule being replaced lives in engine code and command docs, not in any main
spec: `rg -n -i "escalat" openspec/specs` returns nothing.

## Impact

- **Engine.**
  - `scripts/lib/constants.mjs`: the closed lists and the `EPIC_FLAGS` rows.
  - `scripts/lib/rules.mjs`: resolution and the emitted section.
  - `scripts/lib/update-epic.mjs`: the guard is removed and new flags are added.
  - `scripts/lib/add-epic.mjs`, and the batch keys `add-many` accepts.
  - `scripts/lib/review-mode.mjs`.
  - A new `scripts/lib/execution-profile.mjs`.
  - The dispatch in `scripts/conductor.mjs`.
  - The brief.
  - `scripts/lib/activity-log.mjs`, whose review-mode events widen to every profile field.
- **Docs.**
  - `commands/review-mode.md`, where the per-epic section is rewritten.
  - New `commands/profile.md`, covering `set-profile` and `profile`.
  - `commands/epic.md` and `commands/init.md`.
  - `skills/conductor/SKILL.md`: the lines about review mode and the state schema.
  - `docs/parity-ledger.json`.
  - README and the Mintlify site after Gate 2.
- **State.**
  - `state.reviewMode` is kept as the project `review`.
  - New optional `state.executionProfile` for the project `model` and `verbosity`.
  - New optional `state.laneProfiles`.
  - New optional `epic.model` and `epic.verbosity`. `epic.reviewMode` is kept.
- **Consumers.** `converged-release-candidate-review` reads the effective `review` to size its
  reviewer budget.
