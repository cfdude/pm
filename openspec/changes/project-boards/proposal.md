## Why

An operator running pm without Jira or GitHub Issues cannot see what is in the backlog, why each item matters
now, or where the project stands against what it is trying to ship. Epic ids are hyphenated slugs that say
nothing about the problem: one epic nearly got greenlit on its name alone. Two consumers (pm-dev's own plan and
`iv-studio-dev`) each had to write their own script that reads `.conductor/state.json` directly, guesses at
release order and status, and treats `archived` as delivered (cfdude/pm #268, #269, #270). The feedback brief
(`docs/feedback/2026-10-23-release-planning-mission-and-milestone.md`) asks for a mission, a milestone and
releases with a rationale. The research (`docs/feedback/2026-11-03-backlog-and-release-board-research.md`)
settles how pm surfaces them: two live boards that every pm repo gets by default, fed by a read-only engine
export. pm still never opens a connection itself.

## What Changes

- **New read-only verb `board`** (`board --json`): one versioned snapshot holding the counts, the mission and
  its milestone, the releases in plan order with derived status, the open epics in engine order with effective
  priority and rank, a recent window of ended epics, a three-state `delivered` flag, resolved `dependsOn`, and a
  `rejected[]` list for any record whose id fails `/^[A-Za-z0-9._-]+$/`. Declared read-only in `VERB_EFFECTS`.
  It runs no git and makes no network call. Closes #269 and #270.
- **Release planning fields** on `release <id>`: `--theme`, `--rationale`, `--exit`, `--order`, `--size`,
  each with a `--clear <field>` inverse. Release status is derived (`planned | in-progress | shipped`) and
  never recorded, so it cannot disagree with the existing `--deliver`. A plan position comes from
  `release here <id> [--text] [--next]` and is removed with `release here --clear-here`. `here` becomes a reserved
  release id. Closes #268 (its `scope` maps to the existing `intent`).
- **New verb `mission`**: records the mission statement and keeps a history of past statements, sets the
  milestone release, and adds and removes numbered exit criteria. Every one of these operations has a
  recorded inverse. Releases ordered at or before the milestone are critical path. The mission shows in
  `/pm:status`, one SessionStart brief line and a one-line `## Mission` rules-block section (brief §4 item 1).
- **Epic `summary` and `whyNow`**: one-line fields on `add-epic`, `update-epic` and `add-many`, each clearable.
  When an epic leaves `untriaged` without them, a warning names the missing fields. The write still succeeds.
  The inward tracker recipe fills `summary` from the item.
- **Bundled skill `skills/project-boards/`** with two page templates (release plan, backlog), the database
  contract and its access rules, the refresh procedure, drag-to-rank handling, the standalone-HTML fallback
  and the `docs/artifacts/artifacts.md` registration step. A thin `/pm:boards` command loads it.
- **Page security**: the shipped templates escape every interpolated value, allowlist priority against the
  level list, reject malformed ids, treat every database document as untrusted, and isolate each render step,
  so one bad record cannot break the board. Database rules declared with the page, not client checks, decide
  who writes what.
- **Default-on switch**: an `OPT_INS` row for `set-boards on|off`, on unless turned off, plus a one-time
  `upgrade` announcement. While boards are on, the managed rules block carries a short `## Boards` section and the
  brief carries one refresh line. Both are absent while boards are off.

Out of scope, with where each goes (none of it is dropped):
- brief item 4, the backlog growth-over-time view → follow-up epic `backlog-trend-view`, which needs `epic-registration-clock`
- brief item 5, the anti-spawn rule that changes `next` → follow-up epic `mission-anti-spawn-rule`
- brief item 6, the blocker pass against the mission → `mission-anti-spawn-rule`
- brief item 8, cuts confirmed and recorded → already delivered by `backlog-grooming-pass`
- brief item 9, the commit-time close check → follow-up epic `commit-time-close-check`
- turning the `summary`/`whyNow` warning into a refusal one release later → follow-up epic `epic-summary-required-on-triage`
- critical-path and `here` marks in the brief's RELEASES lines, and so in `PROJECT.md`'s Briefing copy → declined for
  now. `release show`, the `/pm:status` verb's own output and the boards carry them, and the brief is capped and
  re-injected every session. The default-on boards line and the mission line do reach `PROJECT.md` through Briefing,
  and that is intended
- the brief's "size weight" → declined (start lean); `--size` records the semver impact only
- votes, effort, the data-science flag, the per-release log and CSV export → declined for now ("start lean")
- #267 and #271 → independent fixes, not in this change

## Capabilities

### New Capabilities

- `board-export`: the read-only `board` verb and its versioned JSON snapshot. Covers the derived `delivered`
  flag, resolved `dependsOn`, id rejection and the ended-epic window.
- `release-planning`: per-release theme, rationale, exit check, order and size, the derived release status,
  and the plan's "we are here" marker. Each has its inverse.
- `project-mission`: the mission statement with history, the milestone release, numbered exit criteria, the
  critical-path designation, and where the mission is surfaced.
- `project-boards`: the bundled skill and `/pm:boards`, both page templates, the database contract and its
  access rules, the refresh and drag-apply procedures, the standalone fallback, and page-side security.

### Modified Capabilities

- `epic-annotation`: adds `summary` and `whyNow` to the shared epic flag surface, and the warning on leaving
  `untriaged`.
- `feature-switches`: adds the default-on `boards` switch, its upgrade announcement and its cost-table rows.
- `managed-rules-block`: adds the `## Boards` section (follows the switch) and the `## Mission` section (follows the
  record), both verb-refreshed and outside the conditional-section set.
- `tracker-sync`: the inward registration recipe carries a `summary`.

## Impact

- Engine: new `scripts/lib/board.mjs` and `scripts/lib/mission.mjs`. Changes to `scripts/lib/releases.mjs`
  (fields, `here`), `scripts/lib/verb-effects.mjs`, `scripts/lib/constants.mjs` (flag registry, clearable
  fields), `scripts/lib/opt-ins.mjs`, `scripts/lib/rules.mjs`, `scripts/lib/briefing.mjs`, `scripts/lib/add-epic.mjs`
  and `scripts/lib/add-many.mjs`, plus dispatch in `scripts/conductor.mjs`. Zero runtime dependencies kept.
- Docs and ledger: `commands/boards.md` (documents `/pm:boards`, the `board` verb and `set-boards`, so no
  near-homophone `/pm:board` slash command exists) and `commands/mission.md`,
  `skills/project-boards/SKILL.md` and its `templates/`, all claimed in `docs/parity-ledger.json`. Also README
  cost table rows, the `release` documentation in `skills/release-candidate/SKILL.md` and `skills/conductor/SKILL.md`
  (there is no `commands/release.md`), `commands/list.md` (no change to `list --json`; says so), and the
  Mintlify site.
- State: new optional `mission`, `releasePlan` and `boards` keys, new optional release and epic fields. All
  additive. A state file written by 0.54.0 loads unchanged. No `MIGRATIONS` entry.
- Release: a member of 0.55.0.
