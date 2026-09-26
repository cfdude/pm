# sync-registers-ids-add-epic-refuses — implementation plan

> Epic: `sync-registers-ids-add-epic-refuses` (superpowers lane, release 0.50.0). Found by the
> 0.43.0 code review (D1), `docs/reviews/2026-09-14-code-review-0.43.0-findings.md`. The 0.50.0
> inventory (2026-09-25) found it PARTLY fixed: since 0.45.0 a name holding whitespace or a
> control character is skipped. Two defects remain.

**Goal:** every path that registers an epic applies `add-epic`'s own id rule, and an unrelated
archive directory can no longer end a live epic or take its active pointer.

**Architecture:** one validator (`STORABLE_EPIC_ID` in `constants.mjs`, now defined as
`EPIC_ID_FORMAT`) at every creation site and in the sink (`pushEpic`); one archive resolver
(`archivedChangeDir` in `epic-progress.mjs`) that takes the epic's RECORD and discards an archive
dated before the epic was registered.

**Tests:** a new file-rung file `scripts/test/assert/sync-registration-ids.test.mjs` (sync reads
real directories, so it is the file rung per CONTRIBUTING, not the unit rung). The functional
`output-text-integrity` 6.5 / 6.6a / 6.6c assert the superseded uppercase rule and are edited with
their assertion twin.

## Task 1 — this plan (commit 1)

## Task 2 — defect 1: one id rule for every registration path

The rule is `^[a-z0-9][a-z0-9._-]*$`. It is what `add-epic` and `add-many` refuse on, and since
0.45.0 sync and the backfill applied only a weaker "no whitespace/control character" test, so
`x|y` (breaks the Epics table) and `.hidden` were registered.

1. RED: a sync over `openspec/changes/x|y`, `.hidden`, `good-change`, an archive dir
   `2026-01-01-a|b`, and plans `x|y.md` / `MASTER-plan.md` registers only `good-change`; stderr
   names each skipped entry; the final line counts the skips (not a bare "synced"); the plan
   remedy for `MASTER-plan.md` is a runnable `add-epic --id master-plan … --plan …`; pushEpic
   refuses `x|y` and `MASTER-ok`.
2. GREEN: `STORABLE_EPIC_ID = id => typeof id === "string" && EPIC_ID_FORMAT.test(id)`; add-epic
   and add-many call it; the skip line and `InvalidEpicIdError` state the format; a skipped plan
   whose lowercased stem passes the rule is given the `add-epic` line; sync's final line appends
   `N skipped`; `integrity`'s unregistered-archive detail follows the same predicate.
3. SPEC: `openspec/specs/output-text-integrity/spec.md` — the requirement "An epic id holding a
   control character or whitespace is never stored" and its uppercase scenario are superseded; the
   uppercase plan now skips with a runnable remedy. Stored legacy ids stay loadable and updatable
   (nothing re-validates a stored record).
4. Edit functional 6.5 / 6.6a / 6.6c and the twin; certify the functional half under the lock.

## Task 3 — defect 2: an archive older than the epic is not its archive

**Rule (decided).** A DATED archive directory (`YYYY-MM-DD-<id>`) whose date is more than one day
before the epic's `createdAt` day is not that epic's archive. Justification: `openspec archive`
dates the directory on the day the change is archived; `createdAt` is stamped when the conductor
first learned of the epic (`pushEpic`), so the change it tracks cannot have been archived before
then. One day of slack because openspec writes a LOCAL date and `createdAt` is UTC.

- Exempt `registeredBy === "archive-backfill"`: it was registered FROM that archive, so its
  `createdAt` postdates the archive by construction.
- Undated directories carry no date and stay name-matched (unchanged).
- Fallback, `createdAt` absent / null / unparseable: the resolver cannot date the epic. It never
  ENDS a live epic by name alone — a live (status not `archived`) undatable epic matches no archive
  — while an ended epic still locates its files by name. The failure this chooses is visible and
  reversible (the epic stays open, an openspec one shows "no change on disk", and
  `recover-created-at` dates it from history, after which the date rule decides), never a silent archive that
  clears the active pointer.
- Measured on this repository before committing to the rule: 17 epics match an archive directory
  by name, and the rule changes the answer for 0 of them.

1. RED: an active claude-code epic `add-auth` created today plus `archive/2025-01-01-add-auth`;
   `sync`, `render` (via `status`) and `set-active add-auth` leave it live and active; sync names
   the ignored directory. A real archive dated today still heals. A backfilled epic still resolves
   its dated archive. A live epic with no `createdAt` is not ended.
2. GREEN: `archivedChangeDir(idOrEpic, dir)` — a record applies the rule, a bare id keeps the name
   match. `isArchived` / `archivedTasksPath` / `changeSpecRoot` pass the record through.
   Callers switched to pass the record (derived by `rg`, see item 1).
3. sync prints, on every run, each archive directory the rule set aside for a held epic.

## Task 4 — changeset fragment, item 1 / item 7 closeout

## Required item 1 — call-site sweep

(Filled in at Task 4 from `rg`.)

## Required item 7 — route what was learned

(Filled in at Task 4.)
