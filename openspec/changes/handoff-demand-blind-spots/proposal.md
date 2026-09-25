# Proposal: the archive gate reads the archived work

**Epic:** `handoff-demand-blind-spots` (code review 0.43.0, findings A1 and A2), the carrier. It also
carries cfdude/pm#222: that epic, `gh-cfdude-pm-222`, is already archived `superseded` into this one
through a `supersedes` link, and the issue is closed with the ship evidence at close (task 9.2).
**Release:** 0.50.0

## Why

The record can say `delivered` over work the repository shows was not delivered. There are three
blind spots, and each one has already happened for real in this repository:

1. **The handoff demand reads 0/0 once `/opsx:archive` has moved `tasks.md`.** `epicProgress()` looks
   only at `openspec/changes/<id>/tasks.md`. `archivedTasksPath()` exists, but only a backfilled epic
   uses it. So on the documented sequence (archive, then the heal, then the interactive verb), an epic
   with 2 of 3 tasks unticked is accepted as `delivered`. The gate-integrity spec currently *requires*
   that zero ("which reads as zero for an archived epic whose source is gone"), so no spec-level check
   can fail. Measured 2026-09-25: 17 managed archived openspec epics in this repository render `0/0`
   although their archived `tasks.md` is on disk. Two of them are `delivered` with a real task left
   open: `gate-verdict-withdrawal` at 53/54 and `archive-gate-reads-what-it-writes` at 46/47. In both
   the open task is a Mintlify sync, not an archive instruction.
2. **One inline story hides a whole `tasks.md`.** In `epicProgress()`, `Array.isArray(epic.stories)`
   wins over the checkbox source. Take `tasks.md` at 1/3, run `--add-story x`, then
   `--story 1 --done --status archived --outcome delivered`. The epic archives, and PROJECT.md
   shows 1/1.
3. **Nothing notices when an archived change's spec deltas never reached `openspec/specs/` (#222).**
   0.48.0's archive rewrote two main specs, but its commit staged only `openspec/changes`. A later
   hard reset then discarded four ADDED requirements, and they were missing for two days
   (`docs/lessons/an-archive-writes-outside-the-change-dir.md`). The lesson and the release-checklist
   line guard the human step. Nothing checks the record.

## What Changes

- **Archived tasks are read for every epic.** When the live `tasks.md` is gone, the progress source
  of an openspec-lane epic is its archived `tasks.md`, found by ONE resolver that also answers
  `isArchived()` (today the two use different matches; the latest date prefix wins). Before, only
  backfilled epics read it. The gate-integrity clause that made the handoff read
  zero is replaced.
- **Stories and a checkbox source count together.** An epic's outstanding work is the sum of its
  undisposed open inline stories and the open, undeclared items of its checkbox source (a plan
  file, or the change's `tasks.md`). Neither can hide the other. A refusal names the remedy for each
  part that contributes (`epic-disposition` states it), and every remedy the engine prints keys on
  each part's own open count (`emitted-instructions`).
- **The record reports it when a delivered epic's archived spec deltas are absent from the main
  specs.** This is a new integrity check, and a briefing line reports the same finding:
  - every ADDED or MODIFIED requirement header in the archived change's delta specs must be in the
    main spec, and every REMOVED header must be absent;
  - RENAMED is checked on both of its sides;
  - a later archived change that touched the same header discharges the obligation.

  The main spec is read from git's **index** (`:./<path>`, relative to the conductor root), not the
  working tree. This is reported as a standing condition, **not** a refusal at the archive
  transition; `design.md` gives the reason (it would deadlock pm's own closeout). It is reported by
  `integrity`, the SessionStart briefing and `render`'s output, and never written into the tracked
  `PROJECT.md`.
- **A new git-gateway operation** reads index content as BYTES in one `cat-file --batch` process. It
  is answered by the assertion rung's git double.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `conductor-record`: "Outstanding work is a defined quantity" defines the progress source as the
  UNION of inline stories and the checkbox source, and says that the checkbox source of an archived
  openspec change is its archived `tasks.md`.
- `gate-integrity`:
  - "The interactive archive verb accepts an epic that is already archived" no longer says the
    outstanding-work quantity reads zero once the source has moved;
  - ADDED: "A delivered epic whose archived spec deltas are absent from the main specs is reported
    until they arrive".
- `epic-disposition`:
  - "Unfinished work at archive records where it went": the refusal names the remedy for each part
    of the union that contributes;
  - "The archive can be asked which of its records carry no considered outcome": the story remedy
    clears the entry only for a story-only epic; a both-parts scenario is added.
- `emitted-instructions`: "A remedy the engine prints clears the condition that printed it": the
  delivered-release and drift-heal remedies key on each part of the union, not on either/or.

## Impact

- **Engine:** `scripts/lib/epic-progress.mjs` (`epicProgress`, `outstandingWork`),
  `scripts/lib/archive-gate.mjs` (`outstandingSummary`, the handoff entry of
  `DELIVERED_OBLIGATIONS`), `scripts/lib/integrity.mjs` (new check), the briefing's
  standing-condition block and `render`'s output (never `PROJECT.md`), a new module for the delta parser and the comparison,
  `scripts/lib/git.mjs` (a wrapper), and `scripts/lib/git-gateway.mjs` (`realGit`,
  `GIT_OPERATIONS`).
- **Tests:** the git double (`scripts/test/fixtures/fake-git.mjs`) and its capture
  (`git-gateway-capture.json`, which gains a byte-valued entry), the gateway guard in both halves and
  `fixtures/git-gateway-repo.mjs`, new unit, assert and functional tests (functional ones with their
  twins), `functional/conductor-15.test.mjs`'s 8.3 case and its twin, and any live-record
  test whose expectation moves when 17 archived epics stop reading 0/0.
- **Docs:** `README.md`, `commands/status.md` (which documents `integrity` and the briefing), a `.changesets/` fragment,
  and the Mintlify pages for the release cut.
- **Landing constraint:** implementation lands AFTER the 0.50.0 wave that edits `epic-progress.mjs`,
  `add-epic.mjs`, `update-epic.mjs` and `constants.mjs`. The tasks cite symbols, never line numbers.
