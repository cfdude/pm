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

- **New verb `initiative`**: `initiative <id> --title --capability` creates or amends one; `--end --reason "<why>"`
  and `--reopen --reason "<why>"` keep a lifecycle history (an initiative is ended, never deleted); `initiative show [<id>] [--history]`
  reads it back. `show` is reserved.
- **Initiative milestones**, nested inside the initiative record so none can exist without one: `--add-milestone "<line>"`
  appends `m1`, `m2`, …; `--remove-milestone "mN:<why>"` marks it removed. Every human surface says "initiative milestone",
  keeping it apart from 0.55.0's "mission milestone", which this change leaves untouched.
- **Release purpose**: `release <id> --initiative <id>` names the ONE primary initiative, `--maintenance` declares that the
  release serves none (allowed explicitly), and the valueless `--clear-initiative` removes either. The existing `theme` is
  the release's goal; it is labelled "Goal" on the release plan board and is not duplicated.
- **Epic planning fields** on `add-epic`, `update-epic` and `add-many`: `--initiative` (primary),
  `--secondary-initiative` (repeatable) with `--remove-secondary-initiative`, `--kind initiative-work|health`, and the two
  recorded challenge answers `--off-mission-reason` and `--off-initiative-reason`. Each scalar clears with `--clear <field>`.
- **The challenge, once.** When at least one open initiative exists, an epic leaving `untriaged` (or added to a release whose
  primary initiative it does not serve) without an initiative, a kind or a recorded reason gets one stderr warning. It is
  a warning, never a refusal, and a recorded reason silences it for good. `claude-code`-lane epics are exempt.
- **Non-goals** on the mission, each initiative, each release and each epic (never on a milestone): one shape,
  `--add-non-goal "<line>"` and `--remove-non-goal "nN:<why>"`, stable ids, marked removed and never deleted.
- **The 80/20 report**: each release reports its members' split by `kind` (initiative work, health, unclassified), the health
  share against the fixed 20% target, and a drift flag. `release <id> --split-reason "<why>"` records a human override as a
  reason beside the drift; it never hides the report and there is no switch to turn the report off.
- **Derive, then confirm.** The skill procedure clusters the existing backlog, docs and issues into candidate initiatives and
  milestones, marks what it cannot ground as UNGROUNDED, asks "Does this make sense?" and writes only confirmed answers.
- **Surfaces**: `board --json` gains `initiatives`, `missionNonGoals` and per-release and per-epic planning fields
  (`schemaVersion` stays 1, additive); the release plan board shows each release's primary initiative (or "Maintenance"), its
  goal and its split, and an Initiatives section. A verb-refreshed `## Initiatives` rules-block section (at most 280 bytes)
  carries the challenge rule while an open initiative exists. `integrity` reports a hand-edited reference naming no initiative.

## Non-goals of this change (Later/Next; each is a separate future epic)

- Now/Next/Later roadmap view: a separate future epic; this change adds no roadmap page or column.
- Derived progress attribution ("6 of 10, +2 added since planning") beyond recording the fields it needs: a separate future epic.
- Definition of done at three levels (initiative, release, epic): a separate future epic.
- Dependency-graph validation, a view over existing `depends-on` links with no second file: a separate future epic.
- Risk register (it would hold off-mission false positives): a separate future epic.
- Deprecation record: a separate future epic.
- Decision-log expansion: a separate future epic.
- Appetite budgets: a separate future epic.
- `successSignal` and `reviewDue` (the orchestrating agent answers first, the human only without authority): a separate future epic.
- Stop-and-escalate floor: a separate future epic.
- Project assessment skill: a separate future epic.
- `.pm` folder consolidation: a separate future epic.

## Capabilities

### New Capabilities

- `initiative-record`: the `initiative` verb and record, its lifecycle history, nested initiative milestones, the
  `board --json` `initiatives` key and the board's Initiatives section, the `## Initiatives` rules-block section, the
  `integrity` check for dangling initiative references, and the derive-and-confirm and challenge procedures in skill text.
- `non-goals`: the one non-goal shape and its add and remove operations on the mission, an initiative, a release and an
  epic, their read-back in `show` verbs and `board --json`, and the explicit absence of non-goals on a milestone.

### Modified Capabilities

- `release-planning` (ADDED requirements; the base spec lands when `project-boards` archives): the release's primary
  initiative or maintenance purpose, the goal label, the 80/20 split report with its drift flag and recorded override, and
  their `release show`, `board --json` and release plan board surfaces.
- `epic-annotation` (ADDED requirements): the epic's primary and secondary initiatives, `kind`, the two recorded challenge
  answers, the once-only challenge warning, and their `board --json` fields.

## Impact

- Engine: new `scripts/lib/initiative.mjs` (verb) and `scripts/lib/initiative-record.mjs` (pure readers), new
  `scripts/lib/non-goals.mjs` (shared shape and validation); changes to `scripts/lib/releases.mjs`, `scripts/lib/mission.mjs`,
  `scripts/lib/constants.mjs` (flag registry, `VERB_POSITIONALS`, `USAGE`), `scripts/lib/verb-effects.mjs`,
  `scripts/lib/epic-summary.mjs` (the warning sink), `scripts/lib/add-epic.mjs`, `scripts/lib/add-many.mjs`,
  `scripts/lib/update-epic.mjs`, `scripts/lib/board.mjs`, `scripts/lib/rules.mjs`, `scripts/lib/overhead.mjs`,
  `scripts/lib/integrity.mjs`, dispatch in `scripts/conductor.mjs`. Zero runtime dependencies kept; no network, no git.
- Docs and ledger: new `commands/initiative.md`, claimed in `docs/parity-ledger.json`; `commands/epic.md`,
  `commands/mission.md`, `commands/boards.md`, `skills/project-boards/SKILL.md` and its `templates/release-plan.html`,
  `skills/conductor/SKILL.md` and `skills/release-candidate/SKILL.md` (the `release` docs), README cost row; Mintlify later.
- State: new optional top-level `initiatives` array; optional release keys `initiative`, `maintenance`, `splitReason`,
  `nonGoals`; optional epic keys `initiative`, `secondaryInitiatives`, `kind`, `offMissionReason`, `offInitiativeReason`,
  `nonGoals`; optional `mission.nonGoals`. All additive: a 0.55.0 state file loads unchanged and no MIGRATIONS entry is needed.
- Release: the sole member of 0.56.0. Archives after `project-boards` (0.55.0), whose specs it extends.
