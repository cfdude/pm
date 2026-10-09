## Context

The proposal (`proposal.md`, "Why") covers the motivation. This section covers only the shipped
0.51.0 profile and the state of the base commit `2677e2f2`.

- **Closed lists in `scripts/lib/constants.mjs`.**
  - `KNOWN_JOB_ROLES = ["implement","test","review"]` is at line 1500.
  - `KNOWN_MODELS = ["fable","opus","sonnet","haiku"]`: `fable` already exists, as the top tier.
  - `MODELS_WITHOUT_EFFORT = ["haiku"]`.
- **The resolver.** `resolveProfile()` in `scripts/lib/execution-profile.mjs` resolves each model
  role through `resolveField(layers, …, checkModelEntry, null)`. The `null` default is what renders
  as "no directive" with source `default`. Every reader iterates `KNOWN_JOB_ROLES`:
  - `profileLines`
  - `briefProfileLines`
  - `laneLayerPhrase`
  - `profileDeltas`
  - `applyProfileOps`
  - `parseSetProfile`'s set/unset clash check
  - `parseUnsetField`
  - `parseModelPair`
  - `normalizeBatchModel`

  Each of those picks up new roles with no edit.
- **Role literals that do NOT read the constant.** Found mechanically with
  `rg -n -e 'implement\|test\|review' -e 'implement\\\|test' -e 'implement \| test \| review' -e 'no model directive' -e "lane's, then the project's" scripts commands skills README.md`.
  The second pattern catches markdown-escaped pipes.
  - `scripts/lib/constants.mjs:705`: the `clear-model` flag row's `requires`/`placeholder` text,
    which feeds `--help` and refusals.
  - `scripts/lib/constants.mjs:701`: the `--clear model` note, "falls back to its lane's, then the
    project's". It must now end at the default.
  - `commands/epic.md:283`: the `--model` row's `implement\|test\|review`.
  - `scripts/lib/rules.mjs:848`: "no model directive" in the resolution-order sentence.
  - `scripts/lib/rules.mjs` "Before dispatching a job (implementing, testing, reviewing)".
  - `commands/profile.md:17,24`
  - `commands/init.md:76-87`
  - `commands/spend.md:77`
  - `README.md:872,877`
- **The spend ledger (`token-spend-tracking-per-epic`) is already implemented at this base.**
  - `spendTrackingLines()` in `rules.mjs` renders its role list from `KNOWN_JOB_ROLES`.
  - `resolveMarker()` in `spend-attribution.mjs` takes `roles = KNOWN_JOB_ROLES`.
  - This change therefore lands SECOND at the shared rules-block insertion point. It adds no
    second role list.
- **Pinned fixtures.**
  - `scripts/test/assert/execution-profile-emission.test.mjs` pins the section against
    `fixtures/rules-0.51.0-execution-profile.txt`, which currently reads
    `model review: no directive (default)`.
  - `spend-rules-emission.test.mjs` pins `fixtures/rules-0.52.0-spend-tracking.txt`. Its role
    line grows.
- **Tests that the role change breaks.** Every one of them runs on every commit:
  - The two pinned fixtures above.
  - `unit/execution-profile-lists.test.mjs:15` pins the three-role array.
  - `unit/spend-attribution.test.mjs:64-71` uses `plan` as the role that "is not a job role
    today". The sibling spec's scenario at
    `token-spend-tracking-per-epic/specs/spend-ledger/spec.md:396-399` does the same.
  - `assert/execution-profile-emission.test.mjs:46-51` pins the old `/pm:init` wording.

  So the constant change, the resolver default, the rules lines, the fixture regeneration and those
  test amendments must land in ONE commit. Any split leaves an intermediate commit red, and the
  pre-commit hook refuses it.

## Goals / Non-Goals

**Goals:**
- Six job roles, each with a built-in default pair, resolved through the existing layer chain.
- A default stays distinguishable from a choice: never stored, always reported as `default`.
- Every role literal in the product is rendered from the one constant.

**Non-Goals:**
- **Tier-mismatch analysis in `spend`.** It is deferred to `token-spend-analysis-and-recommendations`.
- **A fifth model name, or a dedicated one-shot role.**
- **Any check of which model actually ran.** pm stays an instruction layer.
- **Changing the `review` or `verbosity` defaults.**

## Decisions

### D1. The role set: add `plan`, `mechanical` and `rudimentary`, and keep all three existing roles

`KNOWN_JOB_ROLES = ["plan","implement","test","review","mechanical","rudimentary"]`, in lifecycle
order (plan, build, verify, then the light tiers). The order is the order every output prints.

- `implement`, `test` and `review` keep their names. Renaming any of them would invalidate values
  stored by 0.51.0 and the ledger's recorded markers.
- `mechanical` and `rudimentary` are kept as two roles because Rob's brief names both. They differ
  by default tier (D2): `mechanical` is rote but still code-touching, so `sonnet:low`;
  `rudimentary` has no code judgment at all, so `haiku`.
- **Alternative: one light role, `mechanical=haiku`.** This is what the epic text names. It is
  open as a question for Rob. Collapsing is a one-constant edit plus two scenario lines, so it does
  not change the shape of this design.

### D2. The defaults live in one table beside the role list, and are never stored

`constants.mjs` gains `DEFAULT_ROLE_MODELS`, a frozen `{role: {model, effort?}}` holding the table
in the spec. The resolver's per-role default changes from `null` to `DEFAULT_ROLE_MODELS[role]`.

- **Where the values come from.**
  - `plan=opus`, `implement=sonnet` and `rudimentary=haiku` are Rob's tiers.
  - `test=sonnet:low` and `review=opus:high` follow this repository's own project profile, the
    one configuration that has run a release.
  - `mechanical=sonnet:low` is the cheapest code-capable tier.
  - The efforts are not something Rob stated. They are listed as a question.
- **Why not write the defaults into state** (by `init`, `upgrade` or a migration)? A stored
  default reads as `(project)`, which is indistinguishable from a choice. It would also make
  changing a default in a later release need a migration per repo, because every repo would hold
  a stale copy.
- **Why the table sits beside the role list rather than in `execution-profile.mjs`.** The existing
  rule is that every closed list is declared once in `constants.mjs`. A unit test asserts that
  the table's keys equal `KNOWN_JOB_ROLES` and that every value passes `checkPair`. That makes a
  role added without a default (or the reverse) a red test, not a silent `undefined`.

### D3. No `MIGRATIONS` entry

CLAUDE.md requires a migration only when existing data must be *transformed* to stay valid. Nothing
needs transforming here:

- every 0.51.0 value (the three old roles) is still a valid role;
- the new roles are simply absent from old files, which is exactly "unset";
- a migration that wrote defaults would break D2.

The upgrade path is the usual one: update the plugin, reload, `/pm:upgrade`, which rewrites the
rules block with the new lines. A unit test loads a 0.51.0-shaped state and asserts that it
resolves as the spec says, with no transformation.

### D4. The one-shot build is an `implement` override on the epic

"Fable builds straight off a plan" names the model for the build job of ONE epic. That is exactly
what the epic layer is for.

- **Rejected: a sixth role such as `build`/`oneshot`.** It would duplicate `implement`, and it
  would leave the agent to choose between two roles for the same dispatch. That is precisely the
  ambiguity a profile exists to remove.
- **Where it is documented.** The rules block gains one sentence naming the override, and
  `commands/profile.md` and `/pm:init` show it.

### D5. Render every role literal from the constant

- **The `clear-model` row in `constants.mjs`.** It is declared below `KNOWN_JOB_ROLES` in the file
  but sits inside an object literal evaluated at module load. So it must reference the constant
  through a value that is already initialised when the row evaluates:
  - either move the `KNOWN_JOB_ROLES` declaration above the flag table;
  - or build the string lazily.

  The implementation chooses whichever the module's evaluation order allows, and a unit test
  asserts that `update-epic --help` names all six roles.
- **The `rules.mjs` lines.**
  - "Before dispatching a job (…)" lists the roles from the constant.
  - The resolution-order sentence names every role's default pair inline, rendered from
    `DEFAULT_ROLE_MODELS` through `modelText`. The value lines below it show RESOLVED pairs, and
    those hide the default of any role a layer overrides. So the sentence is the one place an
    agent can always see the floor.
  - Accepted cost: the defaults then appear twice in the block whenever a role is unset.
- **The `--clear model` note** (`constants.mjs:701`) ends "…then the project's, then its built-in
  default".
- **The command docs and README** cannot import a constant. A FILE-rung drift test (task 3.2)
  asserts two things, for every role in `KNOWN_JOB_ROLES`:
  - its name appears in `commands/profile.md`, `commands/init.md`, `commands/epic.md` and
    `commands/spend.md`;
  - its default pair, as `modelText` renders it, appears in `commands/profile.md` and
    `commands/init.md`.

  That makes both name drift and default-value drift a red test.
- **`modelText`'s "no directive" branch** becomes unreachable from resolution. It is kept,
  because `modelText` is also called on stored values, and the 7.1 sweep notes it as dead for
  resolved views.
- **Declined: "overrides default …".** `resolveField` names what a layer overrides only between
  stored layers. Extending that to the default would change every existing
  `review`/`verbosity` line too. The source label `(project)` against `(default)`, and the defaults
  in the resolution sentence, already make an override visible.

### D6. The brief does not grow

`briefProfileLines` already prints a `model:` line only for a role whose source is not `default`,
so the defaults add zero brief bytes. The rules block grows by three things: three
`- model <role>: …` lines, the default pairs in the resolution sentence, and the one-shot sentence.
That is an estimate of 400–500 bytes, to be measured against `session-cost`'s rules-block report in
task 2.2.

## Risks / Trade-offs

- **[Repos that deliberately set nothing now receive directives.]** → This is intended (Rob's
  decision). It is called out as BREAKING (emitted instructions) in the proposal and in the
  changeset, so `/pm:changelog` shows it at upgrade. A repo that wants different tiers sets them
  with `set-profile`.
- **[No way to say "no directive" for a role any more.]** Before this change, an unset role meant
  "the agent picks". Now it always resolves to a pair. The inverse that would restore that state, a
  sentinel such as `none`, is deliberately NOT shipped:
  - pm's rule is that the profile names a cost for every job, and `checkPair` already refuses a
    model without an effort for that reason;
  - a platform that cannot set the model per dispatch is already covered by "say so where it does
    not".

  This is recorded as a justified omitted inverse (required item 1).
- **[The rules-block insertion point is shared with the ledger.]** → The ledger landed first, so this
  change rebases onto it. Its role line (rendered) grows automatically, and its pinned fixture is
  regenerated in the same commit.
- **[A role-order change reorders printed lines.]** → Tests that index lines by position are found
  by the call-site sweep and updated in the commit that changes the constant.

## Migration Plan

- There is no state migration (D3).
- **Rollout.** The plugin release is followed by `/pm:upgrade` per repo, which refreshes the
  rules block.
- **Rollback.** Revert the release. No stored value depends on the new roles unless a user set
  one. 0.51.0's resolver iterates only its own three roles, so such a key is simply never read. It
  stays in `state.json`, inert, and nothing refuses to load.
