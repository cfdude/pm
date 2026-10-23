# Proposal: backlog-grooming-pass

## Why

After intake nothing re-reads the backlog as a SET. `/pm:triage` runs once, at registration; from then
on no surface asks whether an epic still matters, duplicates another, or was already delivered under a
different name. The sprint-planning role is unfilled: nobody prunes, dedupes, merges a P2's context into
the P0 that supersedes it, or catches an epic whose premise died. Measured 2026-09-06: all three
newly-synced issues overlapped archived epics, and one was a straight re-report of work recorded
delivered. A manual pass on 2026-09-10 (this epic's notes) found 3 consolidations, 2 reprioritizations,
2 rescopes and 14 epics left as they were, and also found that the PREVIOUS pass cited line numbers
that had rotted within two days. The pass works; it is not repeatable, because nothing carries its
procedure.

`list` cannot support it today. `listRow()` (`scripts/lib/list.mjs`) reports id, title, status, lane,
priority and links, so a pass cannot ask how long an epic has sat (`createdAt`, delivered by
`epic-registration-clock`), which release it is in, or what it says it is for (`description`) without
reading `.conductor/state.json`, the file the rules forbid hand-reading and hand-editing.

## What Changes

- **`list` rows gain three fields**, additively: `release`, `createdAt`, `description`. Existing
  `{count, epics}` consumers keep working. Filtering on them is done by the reader of `--json`; this
  change adds NO `--release` or `--priority` flag (a flag earns its place on a measured case).
- **A procedure skill, `skills/backlog-grooming/SKILL.md`, and a command doc,
  `commands/backlog-grooming.md`** (`/pm:backlog-grooming`). The skill reads the open backlog as a set
  (`list --json`), runs `triage` per suspicious epic, and PROPOSES merges, declines and dead-premise
  findings. It records nothing unasked.
- **Every consolidation records a disposition**: `--outcome superseded|declined` with `--reason` and a
  `supersedes` link; the survivor receives the superseded epic's context BEFORE the disposition is
  recorded. Never `remove-epic`.
- **Evidence is cited so it does not rot**: epic ids, verb output and commit shas, never line numbers.
- Parity ledger: a new capability claims both new files, in the same commit.

## Capabilities

### New Capabilities

- `epic-list`: what a `list` row reports (no existing spec owns `list`; see design D4).
- `backlog-grooming`: the repeatable pass, its read-only proposing stance, and the disposition rule for
  every consolidation.

### Modified Capabilities

None.

## Impact

- Engine (Node built-ins only): `scripts/lib/list.mjs` (`listRow` only; `filterEpics` unchanged).
- Docs: `commands/list.md` (JSON shape), new `commands/backlog-grooming.md`, new
  `skills/backlog-grooming/SKILL.md`, `docs/parity-ledger.json`, a changeset fragment.
- State: none. No new field is written; `release`, `createdAt` and `description` already exist on epics.
- No new verb, no new flag, no migration.
