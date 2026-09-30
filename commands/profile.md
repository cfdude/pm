---
description: Set and read the execution profile — review intensity, model and effort per job role, verbosity — at the project, lane and epic layers
allowed-tools: Bash, Read
---

The **execution profile** says how intensely to review, which model and effort each job role runs
on, and how often you report. It is a pure instruction-layer setting: the plugin records it,
resolves it and emits it into the rules block and the session brief. It never dispatches an agent or
checks which model actually ran — applying `{model, effort}` to a dispatch is YOUR job, where your
platform supports it (and say so where it does not).

## The three fields

| Field | Values |
|---|---|
| `review` | `off \| standard \| thorough` — the reviewer budget (see `/pm:review-mode`) |
| `model` | per job role (`implement \| test \| review`) a pair `{model, effort}`. `model` is `fable \| opus \| sonnet \| haiku` (each means that family's latest release; `fable` is the top tier). `effort` is `low \| medium \| high \| xhigh \| max \| ultracode`. **`haiku` takes no effort; every other model requires one.** |
| `verbosity` | `quiet` (one completion message per epic) `\| verbose` (a message at each phase transition and gate) |

## Where it is resolved from

Each field resolves independently, most specific first: the **epic's own value**, else its
**lane's**, else the **project's**, else the built-in default (`review: standard`, `verbosity:
quiet`, no model directive). `model` resolves per role, and the `{model, effort}` pair is taken
whole from the first layer that sets that role. An epic's `review` wins even where it is LOWER than
the lane's or the project's. A stored value outside its list is ignored (and named by `profile`).
A detour epic resolves from its own record and inherits nothing from the epic it paused.

## Set the project or a lane

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" set-profile \
  --review thorough --model implement=sonnet:medium --model test=haiku --verbosity quiet
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" set-profile --lane claude-code --review off
```

If `${CLAUDE_PLUGIN_ROOT}` is empty:
`ENGINE="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/scripts/conductor.mjs}"; [ -f "$ENGINE" ] || ENGINE=$(ls -t ~/.claude/plugins/cache/*/pm/*/scripts/conductor.mjs 2>/dev/null | head -1); node "$ENGINE" set-profile --review thorough`

- `--lane <lane>` — write that lane's layer instead of the project's. One of `openspec | superpowers | claude-code | decision | external`.
- `--review <off|standard|thorough>` — the project `review` is `state.reviewMode`, the same record `set-review-mode --mode` writes.
- `--model <role>=<model>[:<effort>]` — repeatable. Setting one role leaves the layer's other roles alone. `haiku` with an effort, or any other model without one, is refused.
- `--verbosity <quiet|verbose>`
- **At least one operation is required.** A bare `set-profile` exits non-zero and writes nothing.
- Every refusal (an unknown lane, model, role, effort or level; a field both set and unset in one call) exits non-zero, names the offending value and the accepted list, and leaves `state.json` byte-identical.

A successful write refreshes the managed rules block in `CLAUDE.md` (which carries the project values
and every lane override) and re-renders `PROJECT.md`.

## Set an epic's own values

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" add-epic --id risky --title=Risky --lane openspec --review-mode thorough
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" update-epic docs-tweak --review-mode standard --model implement=haiku --verbosity quiet
```

`--review-mode`, `--model <role>=<model>[:<effort>]` (repeatable) and `--verbosity` are accepted by
`add-epic`, `update-epic` and (as the batch keys `reviewMode`, `model`, `verbosity`) `add-many`. An
epic's `--review-mode` may be BELOW the project's: it wins, and `profile --epic` shows what it
overrides. A batch with one invalid value refuses the whole batch and writes nothing.

## Every set has an inverse

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" set-profile --unset review --unset model:test
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" set-profile --lane claude-code --unset model
```

`--unset <field>` is repeatable; `<field>` is `review`, `verbosity`, `model` (every role) or
`model:<role>` (one role). The field then falls through to the next layer. A lane left with no field
set is removed from the record, so an emptied lane is indistinguishable from one never configured.
Unsetting a field that is not set succeeds, writes nothing and says it was already unset.
`set-review-mode` ships no inverse of its own: `set-profile --unset review` is its inverse.
At the epic layer: `update-epic <id> --clear review-mode`, `--clear verbosity`, `--clear model` (every
role) and `--clear-model <role>` (repeatable, one role); each field then falls through to the lane,
then the project.

## Read it, with sources

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" profile                 # the project layer
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" profile --lane claude-code
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" profile --epic <id>
```

`--epic` and `--lane` are mutually exclusive. `profile` is read-only: it writes nothing. For every
field and every model role it names the value and the layer it came from (`epic`, `lane:<lane>`,
`project` or `default`), so an epic that LOWERED a value is visible as such: it names the value it
overrides. An unknown epic or lane is refused, naming it.

```text
Execution profile — epic docs-tweak
review: standard (epic) — overrides project thorough
verbosity: quiet (default)
model implement: sonnet (medium) (project)
```
