# Design: Split `scripts/conductor.mjs` into ES modules

**Epic:** `conductor-mjs-module-split` (openspec lane, P2)
**Date:** 2026-07-21

## Problem

`scripts/conductor.mjs` is ~2,537 lines, 85 functions, 21 comment-delimited sections
(`// ---------- name ----------`). Motivated by **AI-agent token-efficiency, not
human-readability tech debt**: every edit to a monolith costs a full-file read/orient
regardless of the size of the actual change, and that cost compounds every session this
repo dogfoods itself. The file is already well-organized internally (clean section
boundaries, no classes, module-level constants, two pure `loadState`/`saveState`
functions) — this is a mechanical extraction, not a redesign.

`scripts/conductor.test.mjs` is entirely black-box: it shells out to the CLI via
`execFileSync`/`spawnSync` and never imports internals. This makes the split low-risk —
the existing 250 tests are the safety net; if they all still pass unchanged, behavior is
provably unchanged.

## Goal

Split into `scripts/lib/*.mjs` modules, zero-dependency (Node 18+ built-ins only, per
CLAUDE.md's hard constraint), entry point (`scripts/conductor.mjs`) and its CLI behavior
completely unchanged.

## Granularity decision

One module per existing section, not grouped into 6-8 larger domain modules. Rationale
(user's): grouping now requires guessing future scale and re-grouping later when it turns
out wrong; one-module-per-section requires no such guess, and the existing 21 sections are
already a proven, stable decomposition (added to over many releases without needing
reshuffling).

**One exception:** the "helpers" section (lines 77-491, 414 lines, 30 functions) is not
one cohesive thing — it mixes state I/O, git plumbing, changelog parsing, plugin-version
comparison, epic-progress/dependency-ordering logic, and link validation. Splitting it
1:1 would leave the one large mixed-concern file among otherwise-small single-purpose
ones, undermining the reason for going granular in the first place. It splits into 6
cohesive modules instead (see below).

## Module list

**Foundation (6 modules, replacing "helpers"):**

| Module | Contents | Depends on |
|---|---|---|
| `lib/constants.mjs` | `ROOT`, path constants (`CONDUCTOR_DIR`, `STATE_PATH`, etc.), `KNOWN_*` lists, `RULES_BEGIN`/`RULES_END`, `LANE_RANK`/`laneRank`, `REVIEW_MODE_RANK` | none |
| `lib/state.mjs` | `readJSON`, `readStdin`, `isInitialized`, `defaultState`, `loadState`, `saveState` | constants |
| `lib/git.mjs` | `gitShortSha`, `appendDetourLog` | constants |
| `lib/plugin-meta.mjs` | `pluginRoot`, `pluginVersion`, `stampVersion`, `cmpVer`, `newestInstalledVersion`, `changelogSections`, `changelogBetween`, `changelogAddedHeadlines` | constants, state |
| `lib/epic-progress.mjs` | `resolveEpics`, `epicProgress`, `countCheckboxes`, `reconcileArchived`, `orderQueueWithDependencies`, `activeChangeIds`, `planFiles`, `firstHeading`, `isArchived`, `missing`, `bar` | constants, state |
| `lib/links.mjs` | `validLink`, `normalizeLink`, `detourContext` | constants, state |

**One module per remaining section (19 sections; `getAutonomy` merges into the existing
"autonomy" section rather than staying in helpers):**

`lib/autonomy.mjs`, `lib/rules.mjs`, `lib/briefing.mjs`, `lib/render.mjs`,
`lib/subcommands.mjs`, `lib/add-epic.mjs`, `lib/add-many.mjs`, `lib/active-pointer.mjs`,
`lib/update-epic.mjs`, `lib/remove-epic.mjs`, `lib/reconciler-writeback.mjs`,
`lib/gate-review-writeback.mjs`, `lib/tracker.mjs`, `lib/lane-routing.mjs`,
`lib/review-mode.mjs`, `lib/gate-guard.mjs`, `lib/migrations.mjs`, `lib/changelog.mjs`,
`lib/worktree-hygiene.mjs`.

File names match each section's banner text exactly (kebab-cased, parentheticals
dropped) — e.g. `// ---------- update-epic (write-back) ----------` → `update-epic.mjs` —
so the mapping from old section to new file is obvious and greppable without a lookup
table.

That's **25 `lib/` files** total.

## Entry point

`scripts/conductor.mjs` keeps:
- The "dispatch" section (the CLI subcommand → function map, unchanged in shape).
- The engine-banner print logic (`showEngineBanner` and the `PM_VERBOSE_ENGINE_BANNER`/
  `PM_QUIET_ENGINE_BANNER`/`CLAUDE_PROJECT_DIR` check).
- Imports of every function it dispatches to, from the 25 `lib/` modules.

Nothing else. This matches "entry point unchanged" from the epic's own description — the
CLI's observable behavior, subcommand names, and flags are identical before and after.

## Circular imports — expected, not a bug

Some section pairs call into each other: `rules.mjs`'s `writeRules()` calls
`tracker.mjs`'s `currentTracker()`/`currentSecondaryTrackers()` and
`review-mode.mjs`'s `currentReviewMode()`, while `tracker.mjs`, `review-mode.mjs`, and
`migrations.mjs` all call `rules.mjs`'s `writeRules()` after a state change (to refresh
`CLAUDE.md`'s rules block). This is a genuine circular import between `rules.mjs` and
both `tracker.mjs`/`review-mode.mjs`.

**This is safe and does not need to be engineered around.** Verified empirically: Node
ESM resolves circular imports between modules whose top-level bodies only declare
functions (never call each other at module-evaluation time) — every call in this codebase
already happens lazily, inside a function body invoked later from the dispatch table.
Introducing an indirection layer (e.g. a shared "rules-context" module) to avoid the
cycle would be exactly the kind of premature abstraction this project's own
Ship-Real-Software principles argue against — there is no real problem to solve here,
only a shape that looks unusual on first glance.

## Testing

No changes to `scripts/conductor.test.mjs`. It shells out to the built CLI and knows
nothing about internal module structure. Success criterion: **all 250 existing tests pass
unchanged**, run against the post-split `conductor.mjs` entry point, proving the CLI's
behavior is identical.

## Out of scope

- No behavior changes of any kind — this is a pure mechanical extraction.
- No new abstractions, shared interfaces, or dependency-injection layers beyond what's
  described above.
- Grouping/re-grouping modules later, if a natural cluster emerges over time, is a future
  decision, not part of this split.
