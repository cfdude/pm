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
- **Amended after review (Task 5): the rule binds LIVE epics only.** An already-archived epic finds
  its archive by name. The measurement above missed the fleet: pm's own 0.40.0 `createdAt` recovery
  dated `knowledge-store`'s `bidirectional-sync-api` and `schema-source-reconciliation` 07-09 against
  archives dated 07-01 and 07-06, and the first version of the rule rendered their 26/26 and 14/14
  as `—`, advised renaming their directories on every sync, and dropped them from spec-sync and
  cross-spec scope. So `createdAt` is evidence of order only for the decision to END live work.

1. RED: an active claude-code epic `add-auth` created today plus `archive/2025-01-01-add-auth`;
   `sync`, `render` (via `status`) and `set-active add-auth` leave it live and active; sync names
   the ignored directory. A real archive dated today still heals. A backfilled epic still resolves
   its dated archive. A live epic with no `createdAt` is not ended.
2. GREEN: `archivedChangeDir(idOrEpic, dir)` — a record applies the rule, a bare id keeps the name
   match. `isArchived` / `archivedTasksPath` / `changeSpecRoot` pass the record through.
   Callers switched to pass the record (derived by `rg`, see item 1).
3. sync prints, on every run, each archive directory the rule set aside for a held epic.

## Task 4 — changeset fragment, item 1 / item 7 closeout

## Task 5 — review fixes (both lenses)

1. RED (`…-evidence/red-5.txt`, run against the prior HEAD): an already-archived epic dated after
   its archive keeps its counts and gets no rename advice; the resolver keeps an ended record's
   archive; conductor-15 8.3 restored to its fixed `2026-08-05` date as the regression guard.
2. GREEN: `canBeArchiveOf` returns true for `status: archived`; `deliveredRegression` asks about
   the record as it will be written. The set-aside line can no longer print for an ended epic.
3. Hygiene: the pushEpic refusal test moves to the unit rung; set-active's own `isArchived(t)` gets
   an isolated case (no heal in between); the bare-id scan widens (`["id"]`, any receiver,
   `subcommands.mjs`) and declares its limits.
4. Governance: the direct main-spec edit of `output-text-integrity` is reverted and expressed as a
   MODIFIED delta in `openspec/changes/handoff-demand-blind-spots/`; the date rule joins that
   change's `conductor-record` delta with scenarios.

## Task 6 — Gate 1 / cross-spec review fixes

1. RED (`…-evidence/red-8.txt`): the one-day slack edge as a pure predicate (unit rung, now that
   `canBeArchiveOf` is exported), a REOPENED backfilled epic, and the set-aside line's runnable
   `update-epic … --status archived` for a late-registered epic.
2. GREEN: export `canBeArchiveOf`; the set-aside line appends the archive gate's own
   `dispositionInvocation(e)`. Undated directories stay name-matched, with the reason written down.
3. Specs (change deltas only): MODIFIED *sync reconciles the archive directory* and *Archive
   registration cannot produce duplicate epics* (registration identity stays name-only; a set-aside
   directory is held and reported); the resolver paragraph states the rule's purpose, the undated
   rationale, the backfill exemption for live epics and three new scenarios; gate-integrity's
   spec-sync scope no longer says "whatever the stored status says"; the output-text-integrity
   ADDED block names the line requirement instead of "above".

## Required item 1 — call-site sweep

Derived with `rg` at Task 4 (comment lines excluded).

**Registration paths** — `rg -n "pushEpic\(" scripts/lib`:

| Site | Rule holds? |
|---|---|
| `state.mjs` pushEpic() (the sink) | yes — throws `InvalidEpicIdError` on a failing id |
| `add-epic.mjs` | yes — `STORABLE_EPIC_ID(id)` before pushEpic |
| `add-many.mjs` | yes — `STORABLE_EPIC_ID(id)` per entry, whole batch refused |
| `subcommands.mjs` sync, change rung | yes — skipped, named, counted |
| `subcommands.mjs` sync, plan rung 5 | yes — skipped, named, counted; runnable `add-epic` where the lowercased stem passes |
| `subcommands.mjs` backfillArchive() | yes — skipped via `skipped[]`, named and counted by sync |

No module appends to `state.epics` outside pushEpic() (conductor-13's source scan). `integrity`'s
`archive-directory-has-no-epic` detail uses the same predicate to decide whether it may say "sync
registers it". `releases.mjs` and `verify-specs.mjs` still test `EPIC_ID_FORMAT` directly: a release
id is not an epic id, and verify-specs READS candidates rather than registering — both are outside
the rule by subject.

**Writers of `status: "archived"`** — `rg -n 'status = "archived"|status: "archived"|\.status = '`:

| Site | Through the date rule? |
|---|---|
| `epic-progress.mjs` reconcileArchived() (the heal; callers: sync, render, commit-nudge, `migrations.mjs` upgrade) | yes — `isArchived(e)` with the record |
| `subcommands.mjs` backfillArchive() | n/a — registers an UNHELD directory as archived; it cannot end a live epic |
| `update-epic.mjs` `--status archived` | n/a — an explicit operator transition through the archive gate, not inferred from disk |
| `add-epic` / `add-many` `--status archived` | n/a — created archived by the operator |

**Resolver consumers** — `rg -n "isArchived\(|archivedChangeDir\(|archivedTasksPath\(|changeSpecRoot\("`:
every one now passes the record — heal (`epic-progress.mjs`), the active-pointer clear, `resolveEpics()`'s
disk status, `missing()`, `epicProgress()`'s archived task counts, `active-pointer.mjs` set-active,
`update-epic.mjs` deliveredRegression(), `integrity.mjs` withdrawn-Gate-2 scope, `spec-sync.mjs` scope
and directory, `cross-spec-review.mjs` changeSpecRoot(). The per-commit scan in
`sync-registration-ids.test.mjs` refuses a bare-id call in those six files.

**Where the rule does not hold, and why.** The name-keyed `held` sets in backfillArchive() and
integrity's `archive-directory-has-no-epic` still treat a SET-ASIDE directory as held (its name is
taken): the backfill cannot register it (the id belongs to the live epic) and integrity does not
report it. sync names it every run instead. A matching integrity check is a follow-up, not done here.

**Inverses.** The date rule has no override ("treat this older directory as the epic's archive
anyway"). Not shipped, deliberately: the case is an epic registered by hand AFTER its change was
archived, and its remedy is the ordinary one — `update-epic <id> --status archived --outcome …`. For
an undatable epic the inverse of "never ended by a bare name" is `recover-created-at`. The id rule's
inverse (registering a refused name) is renaming the entry, or `add-epic --id <valid> --plan` for a
plan. No field holding another record's id was added.

## Required item 7 — route what was learned

- **Process lesson** — `docs/lessons/a-failing-fixture-may-be-the-rules-first-real-counterexample.md`
  (+ README rows). First filed as "a fixed-date fixture describes a history that cannot happen";
  review showed one of the 56 failures (conductor-15 8.3) was a real history pm's own createdAt
  recovery writes, so the lesson was reframed around that.
- **Tooling friction (not pm's)** — the worktree agent's Bash guard refuses `trap`, so the certify
  lock could not be released by a trap as the orchestrator's brief required; it was taken with
  `mkdir` and released by an explicit `rmdir` after each commit. Reported to the orchestrator.
- **pm friction** — none genuinely new; `update-epic` has no set form for `createdAt` by design
  (only `--clear created-at`), so fixtures write it directly.
