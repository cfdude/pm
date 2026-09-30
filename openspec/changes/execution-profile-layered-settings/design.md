# Design: execution-profile-layered-settings

## Context

See proposal.md, "Why". The current mechanism, as of `fc04700d`:

- `state.reviewMode` is the repo dial. `set-review-mode` (`scripts/lib/review-mode.mjs`) writes it,
  then rewrites the rules block and PROJECT.md.
- `epic.reviewMode` is an escalate-only override. `update-epic --review-mode` refuses a value below
  `globalReviewMode(state)` (`scripts/lib/update-epic.mjs`, the `REVIEW_MODE_RANK` comparison).
  `currentReviewMode(epicId)` in `scripts/lib/rules.mjs` returns the higher-ranked of the two.
- The `EPIC_FLAGS` row `{flag: "review-mode", key: "reviewMode", commands: ["update-epic"],
  nullable: true, clearNote}` in `scripts/lib/constants.mjs`. It gives `--clear review-mode` for
  free, but it is `update-epic` only, so `add-epic` and `add-many` cannot set it at creation.
- `rulesBlock(tracker, reviewMode, …)` emits `## Review mode` with `Current mode: **<m>**.`. The
  managed-rules fixtures in `scripts/test/fixtures/rules-0.26.0-*.txt` (historical upgrade inputs, left unchanged) and the assertion tests pin
  that line.
- `activity-log.mjs` emits a `review-mode` event when `epic.reviewMode` or `state.reviewMode`
  changes.

Starting call-site list, from
`rg -n "currentReviewMode|globalReviewMode|REVIEW_MODE_RANK|KNOWN_REVIEW_MODES|reviewMode" scripts commands skills`
(excluding tests). Task 5.1 re-derives it mechanically at apply time.

| Site | What it does |
|---|---|
| `scripts/lib/rules.mjs:81,91,629,1092` | resolve the review mode, render the block, write it |
| `scripts/lib/update-epic.mjs:534-545,864` | validate, run the de-escalation guard, assign |
| `scripts/lib/review-mode.mjs:19-29` | `set-review-mode` |
| `scripts/lib/constants.mjs:662-667,799,981,1425-1428` | the flag row, the `--mode` flag, the priority table, the lists and ranks |
| `scripts/lib/activity-log.mjs:335-353` | review-mode events |
| `scripts/conductor.mjs:90,464` | the `rules --epic` dispatch |
| `commands/review-mode.md:55,66,96` + "Per-epic override" | docs |
| `commands/epic.md:276` | the flag table row, "per-epic escalation above the repo dial" |
| `skills/conductor/SKILL.md:177-178,1309` | the verb summary and the state schema |

## Goals / Non-Goals

**Goals:**

- One resolver, a pure function of `(state, epicId | lane)`, returns every field together with its
  source layer. Every consumer calls it: the rules block, `rules --epic`, the brief, `profile`, and
  change 2's reviewer budget.
- Additive storage, so a 0.50.0 state file loads and resolves to today's behaviour unchanged.

**Non-Goals:**

- Dispatching agents, or checking which model actually ran. pm is an instruction layer, and nothing
  in the engine can observe the harness's model choice.
- A detour layer. A detour is an epic.
- Per-story profiles.
- A `review` value per gate, such as Gate 1 differing from Gate 2.

## Decisions

### D1. Storage: reuse the two review keys and add three optional keys

| Layer | review | model | verbosity |
|---|---|---|---|
| project | `state.reviewMode` (existing) | `state.executionProfile.model` | `state.executionProfile.verbosity` |
| lane | `state.laneProfiles[<lane>].review` | `state.laneProfiles[<lane>].model` | `state.laneProfiles[<lane>].verbosity` |
| epic | `epic.reviewMode` (existing) | `epic.model` | `epic.verbosity` |

`model` is `{implement?: {model, effort?}, test?: …, review?: …}`.

The existing keys are reused rather than moved under `executionProfile`. Moving them would need a
`MIGRATIONS` transform, and it would break every external reader of `state.reviewMode`, including
the command doc's own advice to "read `state.reviewMode` directly". The asymmetry between the
project's `reviewMode` and the lane's `review` is contained in one module. Alternative rejected:
`state.executionProfile.review` alongside `state.reviewMode` would leave two records for one fact.

### D2. The resolver lives in a new `scripts/lib/execution-profile.mjs`, and rules.mjs calls it

`resolveProfile(state, {epicId?, lane?})` returns this shape:

```
{ review: {value, source, ignored?},
  verbosity: {…},
  model: { implement: {value, source, ignored?}, … } }
```

`currentReviewMode(epicId)` becomes a one-line adapter over it, so existing callers are untouched.
The resolver takes `state` rather than loading it, which puts it on the unit rung.
`globalReviewMode` stays as the project-layer reader.

Alternative rejected: growing `rules.mjs`. It is already the largest emitter and owns the block. The
resolution is not rules-specific, because the brief and change 2 need it too.

### D3. Removing the escalate-only guard is a decision already made; visibility replaces the refusal

The refusal existed so that "an epic can never quietly weaken review rigor a human explicitly raised
repo-wide" (`commands/review-mode.md`). The user's layered design needs a lowering: a thorough
project with standard non-critical components. So the guard goes. What replaces it is visibility:

- `profile --epic` and `rules --epic` name the source layer, and when an epic lowers a value they
  name the higher value it overrides.
- The activity log records the change.

The `clearNote` on the `review-mode` row, which warns that "the de-escalation guard … does not see
a clear", is rewritten, because there is no longer a guard.

### D4. Verb surface

| Verb | Flags | Notes |
|---|---|---|
| `set-profile` | `--lane <lane>`, `--review <m>`, `--model <role>=<model>[:<effort>]` (repeatable), `--verbosity <n>`, `--unset <field>` (repeatable) | Refuses a call that names no operation, as `set-lane-routing` does. Refuses the same field being set and unset in one call. The project `--review` writes `state.reviewMode`. |
| `profile` | `--epic <id>`, `--lane <lane>` (mutually exclusive) | Read-only. It is not in the mutating verbs' `--force` set. |
| `add-epic`, `add-many`, `update-epic` | `--review-mode` (existing row, widened to all three), `--model` (repeatable), `--verbosity` | New `EPIC_FLAGS` rows. The `add-many` batch keys follow from the rows. |
| `update-epic` | `--clear review-mode`, `--clear verbosity`, `--clear model`, `--clear-model <role>` (repeatable) | `nullable: true` on the rows gives `--clear`, and `--clear-model` is a dedicated flag. |
| `set-review-mode` | unchanged | Its doc names `set-profile --unset review` as its inverse. |

`<field>` in `--unset` is `review | verbosity | model | model:<role>`. The `=` and `:` separators
are parsed by one shared parser, used by `set-profile` and the epic verbs alike.

Every set in this surface has a shipped inverse. The two unshipped inverses:

- **The shorthand.** `set-review-mode` gets no dedicated unset, because `set-profile --unset review`
  covers it and a second spelling would be a second record path.
- **The init recommendation.** It is an emitted text, not a write, so it has no inverse.

### D5. Emission

- **`rulesBlock`.** Its signature gains a `profile` argument, the resolved project or epic profile
  plus the lane map. It replaces the `## Review mode` section with `## Execution profile`:
  - the existing reviewer-budget table;
  - a project-values table;
  - one line per lane override;
  - the resolution order;
  - the dispatch instruction;
  - the verbosity rule;
  - the unchanged `Current mode: **<review>**.` line.

  The `rules-0.26.0-*.txt` fixtures are historical upgrade inputs and stay unchanged. A
  current-version fixture pins the new section instead, added in the same commit (task 4.1). The
  managed-rules surface is functional-bucket subject, so that commit needs
  `node scripts/test/certify.mjs functional` (task 4.1).
- **`writeRules` refresh.** `set-profile` refreshes the block the same way `set-review-mode` does.
  Epic-layer writes do not refresh it, because the block shows project and lane values only.
  `rules --epic` is the epic view.
- **The brief.** One line per field for the active epic, as `review: thorough (epic)`, with a
  `model:` line per role that resolves to something other than the default.
- **`commands/init.md`.** A new step: ask for the project profile, recommend `opus` / `medium`,
  offer `sonnet` for implement and `haiku` for test as cheaper, record the answer with
  `set-profile`, and offer lane overrides.

### D6. No MIGRATIONS entry

Every new key is optional, and every absent key resolves to the pre-0.51.0 behaviour:

- review falls back to `standard`;
- verbosity falls back to `quiet`, which is today's implicit default of one completion report;
- model falls back to no directive.

An existing `epic.reviewMode` that was escalated keeps its meaning. It was at or above the dial when
it was written, and most-specific-wins returns it either way. An epic whose override is now BELOW a
dial that was raised later changes behaviour. It used to resolve to the dial, and it now resolves to
its own lower value. Task 5.3 enumerates such epics in this repo's state and reports them in the
closeout. It does not transform them.

## Risks / Trade-offs

- **[Risk] An epic silently lowers review.** → The source layer and the overridden value are shown
  on every read and in the brief, and the activity log records it. There is still no refusal, by
  decision.
- **[Risk] A platform cannot set effort per dispatch.** → The emitted instruction says to apply
  model and effort where the platform supports it, and to say so where it does not. The engine
  cannot check either way.
- **[Risk] Model names age: "opus" means latest.** → The closed list is one constant, and a new
  family is one edit plus a release.
- **[Trade-off] The project's `reviewMode` against the lane's `review` naming asymmetry.** → It is
  contained in `execution-profile.mjs`, and the `profile` output uses `review` uniformly.
- **[Risk] A dial raised after an epic override now resolves lower for that epic.** → See D6. It is
  reported, not migrated.

## Migration Plan

None. The keys are additive. Rollback means reverting the release: the older engine ignores the new
keys, and its de-escalation guard only runs on the next `--review-mode` write.

## Open Questions

- Should `profile` gain a `--json` form for a scripted consumer, such as change 2's reviewer-budget
  step? It is deferrable, because the text output is enough for an agent. Add it when a consumer
  exists.
