## Why

On 2026-10-06 Rob settled the model tiers: plan on an Opus-class model, execute on Sonnet, give
rudimentary work to Haiku, and let a one-shot model (Fable) build straight off a finished plan.
The execution profile shipped in 0.51.0 cannot say any of that:

- It has three job roles, `implement | test | review`. Planning has no role at all, and neither does
  cheap rote work.
- An unset role resolves to "no model directive". A repo that configures nothing therefore gets no
  tiering whatsoever.

The token-spend ledger in the same 0.52.0 release takes its `role` values from the same list. So
until planning is a role, a planning dispatch cannot be attributed as one.

## What Changes

- **Three new job roles** in the single `KNOWN_JOB_ROLES` declaration. The order is
  `plan | implement | test | review | mechanical | rudimentary`.
  - `plan`: proposals, specs, designs and implementation plans.
  - `mechanical`: rote edits that are fully specified, such as renames, fixture regeneration,
    doc sync and changeset fragments.
  - `rudimentary`: trivial lookups, listings, summaries and formatting.
  - The existing three roles keep their names and meaning.
- **Built-in default model tiers, one per role.** Each is declared once, next to the role list:

  | Role | Default |
  | --- | --- |
  | `plan` | `opus:high` |
  | `implement` | `sonnet:medium` |
  | `test` | `sonnet:low` |
  | `review` | `opus:high` |
  | `mechanical` | `sonnet:low` |
  | `rudimentary` | `haiku` |

  - A role set at no layer now resolves to its default, reported with source `default`. It no
    longer resolves to "no model directive".
  - The epic, lane and project layers override the default exactly as they override one another
    today.
  - **BREAKING (emitted instructions only):** a repo that never set a model will, after upgrading,
    read a model directive for every role in its rules block. Its `state.json` does not change.
- **The one-shot build is a documented override, not a role.** To have a top-tier model build an
  epic straight off its finished plan, set `--model implement=fable:<effort>` on that epic.
  `fable` is already in `KNOWN_MODELS`, and no model name is added.
- **Every role literal is rendered from the constant.** That covers:
  - the `--clear-model` flag's help text;
  - the rules block's "Before dispatching a job" line and its default sentence;
  - the `/pm:init` recommendation;
  - `commands/profile.md`, `commands/epic.md` and `commands/spend.md`;
  - the `--clear model` confirmation note, which now names the default as the last fallback;
  - the README.

  The `## Spend tracking` section already renders its role list from `KNOWN_JOB_ROLES`, so it
  picks up the new roles with no edit of its own.
- **`/pm:init`** now recommends ACCEPTING the defaults (record nothing), instead of setting
  `opus:medium` on every role. The engine still writes no model on its own.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `execution-profile`: the job-role list grows from three roles to six, and each role resolves to a
  built-in default pair instead of "no model directive". The rules-block and init emission name the
  roles and defaults, and the one-shot override is documented. A cleared role falls through to its
  default.

  `spend-ledger` has no requirement change of its own, because its role vocabulary is defined as
  `KNOWN_JOB_ROLES`. One example in it does have to change:
  - The unarchived sibling `token-spend-tracking-per-epic` has the scenario "A role added to the
    job-role list is accepted without a ledger change". That scenario and its twin test
    `scripts/test/unit/spend-attribution.test.mjs` use `plan` as the role that is not yet known,
    and after this change `plan` IS known.
  - Task 1.1 amends both to use a role that is still unknown, before either change archives.

## Impact

- **Engine.** Every edit is pure, and none adds a dependency:
  - `scripts/lib/constants.mjs`: `KNOWN_JOB_ROLES`, a new `DEFAULT_ROLE_MODELS`, and the
    `clear-model` flag row's `requires` and `placeholder`.
  - `scripts/lib/execution-profile.mjs`: the resolver default.
  - `scripts/lib/rules.mjs`: three edits.
    - The dispatch line's role list.
    - The resolution sentence, which renders the default pairs from `DEFAULT_ROLE_MODELS`.
    - The one-shot sentence.
- **Managed rules block.** The `## Execution profile` section grows by three role lines. Every
  repo's block changes on its next write, so the functional certify is required.
- **State.** The change is additive: roles that older state files never hold. There is no
  `MIGRATIONS` entry (see design D3). A pre-0.52.0 `state.json` loads byte-identical.
- **Tests.**
  - a new current-version fixture `rules-0.52.0-execution-profile.txt`;
  - a regenerated `rules-0.52.0-spend-tracking.txt`, because its role list grows;
  - unit coverage of the resolver and the default table.
- **Docs.** The following change, and the Mintlify site follows at the release cut:
  - `commands/profile.md`
  - `commands/init.md`
  - `commands/epic.md`
  - `commands/spend.md`
  - `skills/conductor/SKILL.md`
  - `README.md`
  - a changeset fragment
- **Shared chokepoints** with `token-spend-tracking-per-epic`:
  - the rules-block builder: that change landed first, so this one rebases onto it;
  - `KNOWN_JOB_ROLES`: it stays the only role list.
- **Deferred.** The epic text asks that spend analysis flag a tier mismatch, meaning an agent whose
  model tier differs from its role's resolved tier. That analysis belongs to the planned epic
  `token-spend-analysis-and-recommendations` (0.53.0). It is recorded at archive as a `--deferral`
  to that epic, not specified here.
