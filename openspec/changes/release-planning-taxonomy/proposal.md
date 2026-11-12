## Why

pm 0.55.0 (`project-boards`) records a mission, a mission milestone that is a release, and per-release plan fields, but nothing
says what a release is FOR beyond its own theme. A release plan cannot answer "which multi-release effort does this release
advance?", work that serves no larger effort goes unchallenged, and nothing reports whether a release spends anything on
engineering health. The owner settled the taxonomy on 2026-11-12 (epic `release-planning-taxonomy`, its notes):
**Mission > Initiative > Milestone > Release > Epic.** An initiative is a multi-release effort delivering a valuable
capability; it owns milestones and many epics and is the unit a roadmap prioritizes. A milestone is a notable achievement
outside any single release and is meaningless without an initiative. A release is a shippable increment with a goal (the
existing `theme`); at planning the question is "what initiative does this release go into?". An epic is the most granular unit
and never spans releases. The agent attests facts, the human decides preferences, and the engine stays an instruction layer.

## What Changes

- **New verb `initiative`**: `initiative <id> --title --capability` creates or amends one, with optional `--source` (where it
  was derived from; `UNGROUNDED` allowed) and `--off-mission-reason`, each cleared with `--clear <field>`. It ends with a work
  disposition, `--end --outcome delivered|abandoned|superseded --reason "<why>"`, and `--reopen --reason "<why>"` is the
  inverse; it is never deleted. `initiative show [<id>] [--history]` reads it back; `show` is reserved.
- **Initiative milestones**, nested inside the initiative so none can exist without one: `--add-milestone`,
  `--remove-milestone "mN:<why>"` (marked), and `--reach-milestone "mN:<evidence>"` with the human override
  `--unreach-milestone "mN:<why>"`. Every human surface says "initiative milestone"; 0.55.0's mission milestone is untouched.
- **Release purpose**: `release <id> --initiative <id>` names the ONE primary initiative, `--maintenance` declares that it
  serves none, `--clear-initiative` removes either. The existing `theme` is the goal, labelled "Goal", not duplicated. A
  release none of whose members serves its primary is flagged (`primaryServed: false`).
- **Epic planning fields** on `add-epic`, `update-epic` and `add-many`: `--initiative` (recording `initiativeJoinedAt`),
  `--secondary-initiative` with `--remove-secondary-initiative`, `--kind initiative-work|health`, `--off-mission-reason` and
  `--off-initiative-reason`. Each scalar clears with `--clear <field>`.
- **The challenge, once.** While an initiative is open, an epic leaving `untriaged` (or added to a release whose primary it
  does not serve) without a kind, an initiative or a recorded reason gets one stderr warning, never a refusal; a recorded
  reason silences it for good. `claude-code`-lane epics are exempt. Initiatives are challenged against the mission once.
- **Every piece of work is accounted for.** Each release splits ALL members, in any lane, into health, initiative work and
  unaligned (neither): a visible off-initiative signal. A `claude-code` epic with no kind counts as `initiative-work` when it
  names an initiative, else `health`. A tweak too small for an epic is attributed to the per-release `maintenance-<releaseId>`
  epic (a convention over existing verbs); the commit nudge names that destination when a commit is not the active epic's.
- **The 80/20 report**: the health share against the fixed 20% target, with drift flagged below 10% or above 30%.
  `release <id> --split-reason "<why>"` records an override beside the drift; it never hides the report and no switch exists.
- **Scope movement, recorded now so it is derivable later**: `release --member` records `releaseJoinedAt`;
  the planning baseline is derived (the earliest `startedAt` among the release's members, no new flag); `release show`
  reports "N epics added since planning". Report only.
- **Non-goals** on the mission, each initiative, each release and each epic (never on a milestone): `--add-non-goal`,
  `--remove-non-goal "nN:<why>"`, stable ids, marked removed. Mission non-goals reach the rules block in one line.
- **Derive, then confirm.** The skill clusters the existing backlog, docs and issues into candidate initiatives and milestones,
  records each source or `UNGROUNDED`, asks "Does this make sense?" and writes only confirmed answers.
- **Surfaces**: `board --json` gains `initiatives`, `missionNonGoals` and per-release and per-epic planning fields
  (`schemaVersion` stays 1); the release plan board shows each release's primary initiative (or "Maintenance"), goal, split
  and scope line, and an Initiatives section. Two verb-refreshed rules sections, `## Initiatives` (at most 280 bytes, while an
  initiative is open) and `## Mission non-goals` (at most 200, while one is set). `integrity` reports dangling initiative
  references.

## Non-goals of this change (Later/Next; each is a separate future epic)

- Now/Next/Later roadmap view, which also folds the 0.55.0 mission milestone into initiative milestones: a separate future epic.
- Derived progress attribution ("6 of 10, +2 added since planning") beyond recording the fields it needs: a separate future epic.
- Epic sizing, with ONE default scale chosen and kept, the scale a configuration choice (t-shirt, Fibonacci, others): a separate future epic.
- Definition of done at three levels (initiative, release, epic): a separate future epic.
- Dependency-graph validation, a view over existing `depends-on` links with no second file: a separate future epic.
- Risk register (it would hold off-mission false positives): a separate future epic.
- Deprecation record: a separate future epic.
- Decision-log expansion: a separate future epic.
- Appetite budgets: a separate future epic.
- The OUTCOME review, `successSignal` and `reviewDue`, which arms AFTER deployment and never at close (the orchestrating agent answers first, the human only without authority): a separate future epic.
- An `integrity` check listing commits in a release range that no epic attributes (needs a recorded release range): a separate future epic.
- Stop-and-escalate floor: a separate future epic.
- Project assessment skill: a separate future epic.
- `.pm` folder consolidation: a separate future epic.

## Capabilities

### New Capabilities

- `initiative-record`: the `initiative` verb and record, its source and mission challenge answer, its work disposition and
  lifecycle history, nested initiative milestones and their reached marks, the
  `board --json` `initiatives` key and the board's Initiatives section, the `## Initiatives` rules-block section, the
  `integrity` check for dangling initiative references, and the derive-and-confirm and challenge procedures in skill text.
- `non-goals`: the one non-goal shape and its add and remove operations on the mission, an initiative, a release and an
  epic, their read-back in `show` verbs and `board --json`, the `## Mission non-goals` rules section, and the explicit absence
  of non-goals on a milestone.

### Modified Capabilities

- `release-planning` (ADDED requirements; the base spec lands when `project-boards` archives): the release's primary
  initiative or maintenance purpose, the goal label, the all-lanes split with `unaligned`, the drift band and recorded override,
  the unserved-primary flag, join times and the planning baseline, the maintenance-epic convention and the commit-nudge
  destinations, and their `release show`, `board --json` and release plan board surfaces.
- `epic-annotation` (ADDED requirements): the epic's primary and secondary initiatives and `initiativeJoinedAt`, `kind`, the
  two recorded challenge answers, the once-only challenge warning, and their `board --json` fields (with `effectiveKind`).

## Impact

- Engine: new `scripts/lib/initiative.mjs` (verb) and `scripts/lib/initiative-record.mjs` (pure readers), new
  `scripts/lib/non-goals.mjs` (shared shape and validation); changes to `scripts/lib/releases.mjs`, `scripts/lib/mission.mjs`,
  `scripts/lib/constants.mjs` (flag registry, `VERB_POSITIONALS`, `USAGE`), `scripts/lib/verb-effects.mjs`,
  `scripts/lib/epic-summary.mjs` (the warning sink), `scripts/lib/add-epic.mjs`, `scripts/lib/add-many.mjs`,
  `scripts/lib/update-epic.mjs`, `scripts/lib/board.mjs`, `scripts/lib/rules.mjs`, `scripts/lib/overhead.mjs`,
  `scripts/lib/integrity.mjs`, `scripts/lib/subcommands.mjs` (the commit nudge's untied branch), dispatch in `scripts/conductor.mjs`. Zero runtime dependencies kept; no network, no git.
- Docs and ledger: new `commands/initiative.md`, claimed in `docs/parity-ledger.json`; `commands/epic.md`,
  `commands/mission.md`, `commands/boards.md`, `skills/project-boards/SKILL.md` and its `templates/release-plan.html`,
  `skills/conductor/SKILL.md` and `skills/release-candidate/SKILL.md` (the `release` docs), README cost row; Mintlify later.
- State: new optional top-level `initiatives` array; optional release keys `initiative`, `maintenance`, `splitReason`,
  `nonGoals`; optional epic keys `initiative`, `initiativeJoinedAt`, `secondaryInitiatives`, `kind`,
  `releaseJoinedAt`, `offMissionReason`, `offInitiativeReason`, `nonGoals`; optional `mission.nonGoals`. All additive: a 0.55.0 state file loads unchanged and no MIGRATIONS entry is needed.
- Release: the sole member of 0.56.0. Archives after `project-boards` (0.55.0), whose specs it extends.
