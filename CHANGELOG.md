# Changelog

All notable changes to the `pm` plugin are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project adheres to [Semantic Versioning](https://semver.org/).

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
