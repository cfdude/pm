# Changelog

All notable changes to the `pm` plugin are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project adheres to [Semantic Versioning](https://semver.org/).

---

## [0.6.0] — 2026-06-25

### Added

- **Knowledge surfacing — the plugin now teaches the agent at the two moments that matter.**
  Previously an upgrade exposed new commands but never explained *what* it brought, and a
  first-time install gave the agent no orientation beyond command descriptions. Closed both:
  - **`/pm:upgrade` prints a changelog delta.** After applying migrations, the engine reads its
    own `CHANGELOG.md` and prints every entry in `(stamped, running]` — so the agent and user see
    exactly what the version added, not just that it happened.
  - **New `changelog` subcommand + `/pm:changelog [--since <x.y.z>]`.** On-demand changelog delta;
    defaults its floor to the version stamped in this repo's `state.json`. Zero-dependency
    markdown parsing (sections split on `## [x.y.z]` headers); graceful when no CHANGELOG ships.
  - **`/pm:init` orients the agent first.** Init now instructs the agent to load the `conductor`
    skill (the agent-facing how-to) — and points at the shipped `README.md` for deeper reference —
    so even a cold install of a much-later version knows how to drive the plugin. Deep orientation
    stays a one-time/on-demand load; the persistent CLAUDE.md rules block remains the recurring
    anchor (no full-orientation injection every session).

### Upgrade

Minor release — no schema change, no data migration. Update the plugin → `/reload-plugins` →
`/pm:upgrade`; the upgrade will now print what this version (and any you skipped) brought.

---

## [0.5.1] — 2026-06-25

### Fixed

- **Multi-version upgrade ordering (hardening).** `upgrade()` already replayed every migration
  newer than the stamped version, so a repo several versions behind (e.g. `0.2.0 → 0.5.x`) was
  upgraded correctly. This release makes that guarantee robust: migrations are now applied **sorted
  by release** (independent of array authoring order), the `MIGRATIONS` array is documented as
  **append-only / never-reorder**, and a regression test asserts a two-versions-behind repo replays
  *both* the 0.3.0 (lane) and 0.5.0 (link-normalize) migrations in order.

- **Tracker detection no longer over-triggers on Git hosting.** The `/pm:tracker`, `/pm:init`, and
  `/pm:upgrade` detection guidance previously let the agent infer a tracker from the fact that a
  repo is hosted on GitHub. Hosting on any Git service (GitHub, GitLab, Bitbucket, …) is **not** a
  signal — they all have issues/PRs, but a remote is not evidence that work is managed there.
  Detection now requires a *real* signal (an in-use tracker MCP, issue-key conventions, or an
  explicit statement), frames tracker mirroring as an **optional choice**, and reassures that
  declining loses nothing — the conductor always tracks everything locally in
  `.conductor/state.json` + `PROJECT.md`; a tracker only *adds* an external mirror. Choosing a Git
  host as the tracker (issues + PRs) remains fully valid.

### Upgrade

Patch release — no schema change, no data migration. Update the plugin → `/reload-plugins` →
`/pm:upgrade` to stamp `0.5.1` and refresh the rules/command docs.

---

## [0.5.0] — 2026-06-25

### Added

- **First-class epic hierarchy.** Epics gain an optional `parent` field (single-parent tree,
  arbitrary depth). `add-epic --parent <id>` validates the reference (must exist, no self-parent,
  no cycle) via a shared `parentError()` ancestor-walk helper. `PROJECT.md` renders children
  indented beneath their parent (`└─`, deepened per level), groups families ordered by parent
  priority, and shows an `X/Y children archived` rollup in the parent's Progress cell. The
  briefing's NEXT UP annotates a child with its parent id. **Grouping is render-only** — the
  `resolveEpics` priority sort is untouched, so a P0 child of a P2 parent keeps its NEXT UP slot.

- **External-tracker awareness (instruction layer only).** An optional `tracker` block in
  `state.json` (`system`, `instance`, `projectKey`, `mechanism`, and a semantic `statusIntent`
  map) makes the conductor *aware* a project mirrors epics to Jira/GitHub/Linear. **The engine
  never calls the tracker** — it only shapes the instructions it already emits:
  - the CLAUDE.md rules block gains an "External tracker sync" section assigning the interactive
    agent ownership (create issue + record key; transition on status change toward the semantic
    `statusIntent`; parent epic → tracker epic);
  - the briefing gains a `TRACKER SYNC` block listing only honestly-computable drift — active-work
    epics (`queued`/`active`/`paused`, excluding `missing()` ghosts) with no `externalId`. No
    transition-drift is fabricated (the engine cannot see tracker state).
  - New `set-tracker` subcommand (repeatable `--intent <status>:<target>`; `parseFlags` now
    accumulates `intent` like `link`) writes the block and refreshes the rules.
  - New per-epic `externalId`/`externalUrl` fields (on `add-epic` and `update-epic`).
  - New **`update-epic <id>`** write-back subcommand (positional id) mutates
    `externalId`/`externalUrl`/`parent`/`status`/`priority` on an existing epic under the same
    validation as creation — closing the sync loop after the agent creates an issue.
  - New `/pm:tracker` command doc; `/pm:init` and `/pm:upgrade` gain an agent-driven detection
    step (detect signals → confirm with the user → `set-tracker`; upgrade only when unset).

- **Atomic bulk creation.** New `add-many --from <path|->` reads a JSON `{ parent?, epics[] }`
  batch. If `parent` is present it is created first and children default their `parent` to it.
  Every entry is validated up front (id format, uniqueness vs existing AND within the batch, lane,
  status, parent refs + intra-batch cycles); on any failure nothing is written and it exits
  non-zero. A valid batch persists in a single write — removing the race that forced chaining
  individual `add-epic` calls. JSON only (the engine stays zero-dependency).

### Fixed

- **Stale-link rendering.** `render()` and the briefing now emit a link only when both its `type`
  and `epic` are strings (shared `validLink()` helper), so malformed or older-schema link entries
  no longer render as `undefined undefined`.

### Migration

- **0.5.0 migration (repair-first).** `MIGRATIONS` gains a `0.5.0` entry that normalizes stored
  `links`: valid `{type, epic}` objects pass through, the documented colon-string encoding
  `type:epic[:reason]` is repaired into an object, and unrecoverable entries are dropped. Additive
  and idempotent. Defensive rendering (above) is the shape-agnostic durable fix.

### Compatibility

All additions are optional and backward-compatible: a `state.json` written by v0.4.1 loads
unchanged, and a 0.5.0-written state remains loadable by the older engine (it ignores the new
optional fields).

### Upgrade

**Existing repos:** update the plugin → `/reload-plugins` (or restart) → `/pm:upgrade` per repo.
The upgrade runs the additive, idempotent 0.5.0 migration, refreshes the rules, and stamps
`pmVersion: 0.5.0`. To make a repo tracker-aware, run `/pm:tracker` (or answer the detection
prompt during `/pm:upgrade`).

---

## [0.4.1] — 2026-06-22

### Added

- **`/pm:upgrade` staleness guard.** `/pm:upgrade` now checks whether the running engine
  version matches the newest installed version before proceeding. If they differ (i.e. the
  plugin was updated but Claude Code has not been reloaded), it refuses with a clear message
  — "this is pm <old> but <new> is installed; run `/reload-plugins` or restart Claude Code
  first" — instead of silently re-stamping an old version. From 0.4.1 forward every upgrade
  is self-guarding.

- **SessionStart nudge fires from newest installed version.** The upgrade nudge in the
  SessionStart briefing now keys on the newest installed version (from the plugin's
  `plugin.json`) rather than the running engine version. This means the nudge fires even
  before you reload Claude Code, and it names the full sequence: (1) reload/restart; (2)
  `/pm:upgrade` per repo.

- **Documented update sequence.** `upgrade.md` and README both document the required
  three-step sequence: update the plugin → `/reload-plugins` or restart → `/pm:upgrade`
  per project. The upgrade command note now explains why the reload step is mandatory
  (Claude Code loads the engine at session start).

### Limitation

The staleness guard ships inside 0.4.1, so the first upgrade *into* 0.4.1 still runs the
old 0.4.0 engine until you `/reload-plugins`. From 0.4.1 forward every upgrade is
self-guarding.

### Upgrade

**Existing repos:** run `/pm:upgrade` after updating — refreshes rules, stamps 0.4.1 into
`state.json`. Idempotent; safe to run multiple times. No data migration required. Remember
to `/reload-plugins` first (see above).

---

## [0.4.0] — 2026-06-18

### Added

- **`status: planned` — roadmap as ordered backlog.** A new epic status for items that are
  known, sequenced, but not yet ready to start. `planned: N` appears as a brief summary line
  in the briefing; planned epics are excluded from NEXT UP and the lanes rollup, but are
  shown in the PROJECT.md epics table so the full backlog is visible.

- **`sync` auto-transitions proposed planned epics → untriaged (openspec lane).** When
  `sync`/`init` discovers a new OpenSpec change on disk and an epic with the same id already
  exists with `status: planned`, it transitions that epic to `untriaged` automatically so it
  enters the normal triage flow without manual state editing.

- **PROJECT.md stamp-on-content-change only.** `render` now compares the new output to the
  current file before writing; if the content is identical, the file is not touched. Prevents
  mtime churn and spurious git diffs when nothing meaningful changed.

- **`add-epic` validates `--status` against known statuses.** Passing an unknown status to
  `/pm:epic add` is now an error rather than silently stored. A valueless-flag guard also
  catches `--status` with no argument (e.g. `--status --lane`) and reports a clear error
  instead of treating the next flag as the status value.

- **Portable `ls -t` glob in command docs.** The `find`-based file listing in `sync` command
  documentation is replaced with a portable `ls -t` glob, removing a macOS/GNU `find`
  incompatibility.

- **`--status` documented in `/pm:epic`.** The `add` sub-command now shows all valid status
  values (including `planned`) in its help text and the commands table.

- **Roadmap on-ramp guidance.** README and SKILL document how to import an existing roadmap
  into the conductor without parsing: in an interactive session, read the roadmap doc and
  register each item via `/pm:epic add … --status planned`, choosing the appropriate
  execution lane. The conductor does not parse roadmap files automatically.

### Changed

- Rules block wording updated: documents `planned` status (roadmap on-ramp), auto-transition
  of planned epics on `sync`, and stamp-on-content-change behaviour.

### Upgrade

**Existing repos:** run `/pm:upgrade` after updating — refreshes rules, stamps 0.4.0 into
`state.json`. Idempotent; safe to run multiple times. No data migration required.

---

## [0.3.0] — 2026-06-18

### Added

- **Lane-agnostic epics.** Epics are no longer restricted to OpenSpec proposals. Every epic
  now carries a `lane` tag — `openspec | superpowers | claude-code | decision | external` —
  so the conductor tracks the full backlog regardless of how work is executed.

- **Epic schema fields.**
  - `lane` (string, optional, backward-compatible): execution lane. Defaults to `"openspec"`
    on read so existing `state.json` files are unaffected.
  - `planPath` (string, optional): repo-relative path to a Superpowers/markdown plan file.
    Used as a progress source when `stories[]` is absent.
  - `stories` (array, optional): inline `{ title, done }` story list. Highest-priority
    progress source.

- **Progress precedence resolver.** `epicProgress(epic)` replaces `storyProgress(id)` and
  resolves progress in order: `stories[]` → `planPath` checkboxes → `openspec/changes/<id>/tasks.md`
  → `—`. A dangling `planPath` renders `⚠ planPath missing` rather than silent `0/0`.

- **Non-OpenSpec epics in the briefing.** Non-OpenSpec epics now appear in NEXT UP and the
  Epics table. Only OpenSpec epics missing their on-disk change are flagged `⚠ no change on
  disk`; other lanes are shown as-is.

- **Bounded briefing.** NEXT UP is capped at **top-5** by priority-then-lane, with a
  per-lane count summary (`lanes: openspec 4 · superpowers 12 · claude-code 9`) and a
  `(+N more — see PROJECT.md)` overflow line, so the briefing stays compact regardless of
  backlog size.

- **`/pm:epic add`.** Registers a new epic directly (no `state.json` edit required):
  ```
  /pm:epic add --id X --title "…" --lane superpowers --priority P1
  ```
  Validates id format (`^[a-z0-9][a-z0-9._-]*$`), lane, and uniqueness. Optional flags:
  `--plan PATH`, `--status STATUS`, `--link "type:id:reason"`.

- **`sync` imports Superpowers plans.** `docs/superpowers/plans/*.md` are scanned on
  `sync`/`init` and registered as lane-`superpowers` epics (id = filename without `.md`,
  `planPath` set, title from first `#` heading). Additive and id-collision-safe (colliding
  ids are skipped with a warning). The plans directory may be absent — the scan returns `[]`
  gracefully.

- **Version-aware upgrade subsystem.**
  - `init` and `upgrade` stamp `pmVersion` (the running release) into `state.json`.
  - `brief()` compares the stamped version to the running release; if older, prepends a
    one-line upgrade nudge (re-shown every SessionStart and PreCompact until resolved).
  - **`/pm:upgrade`** runs registered migrations (those whose `release` is newer than the
    stamped version), then unconditionally refreshes the CLAUDE.md rules block, re-renders
    `PROJECT.md`, and re-stamps `pmVersion`. Idempotent — a second run is a no-op.
  - **0.3.0 migration:** stamps an explicit `lane: "openspec"` on any epic lacking one,
    making `state.json` self-describing.

- **Lane-agnostic detour rules.** A substantial detour becomes its own **epic in the
  appropriate lane** (not necessarily an OpenSpec proposal). The `rulesBlock()` wording and
  PUSH/POP templates are updated accordingly.

### Changed

- Epics table header changed from `Epic (OpenSpec change)` to `Epic`; a **Lane** column is
  added. Epics are sorted by priority rank then lane rank in both `PROJECT.md` and the brief.
- NOW line includes the lane tag.
- `rulesBlock()`: "epics = proposals" replaced with "epics are lane-agnostic; OpenSpec is
  one lane (openspec | superpowers | claude-code | decision | external)."

### Upgrade

**Existing repos:** after updating the plugin, run `/pm:upgrade` once. It will:

1. Refresh the CLAUDE.md rules block with lane-agnostic wording.
2. Stamp explicit `lane: "openspec"` on all pre-0.3.0 epics.
3. Record `pmVersion: "0.3.0"` in `state.json` so the upgrade nudge stops appearing.

The command is **idempotent** — running it more than once is safe and produces no changes on
the second run. No data is lost; the migration is purely additive.

---

## [0.2.0] — 2026-06-01

Initial public release. Tracks OpenSpec proposals as epics, maintains an explicit detour
stack, and enforces a reconcile gate so nothing is lost when development pivots or context
is compacted.
