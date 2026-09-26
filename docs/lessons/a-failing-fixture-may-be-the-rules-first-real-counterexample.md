---
lesson: a-failing-fixture-may-be-the-rules-first-real-counterexample
date: 2026-09-25
trigger: A new rule turns existing tests red, and you are about to edit their FIXTURES (a date, a field, an ordering) so the rule passes — especially many fixtures at once, reasoning that the history they describe "cannot happen".
cost: sync-registers-ids-add-epic-refuses (0.50.0) added a date rule to the archive resolver — an archive dated before the epic's `createdAt` is not its archive. It failed 14 assertion-half and 42 functional tests. All were edited as impossible histories (fixed past archive dates, no `createdAt`) behind a new `archiveDay()` helper, with assertions unchanged, and the branch went green. One was not impossible: conductor-15 8.3 registers an epic already archived AFTER its archive, which pm's own 0.40.0 `createdAt` recovery produces in the field (knowledge-store: `bidirectional-sync-api`, `schema-source-reconciliation` — createdAt 07-09 against archives 07-01 and 07-06). Both review lenses failed the branch on it: those epics' 26/26 and 14/14 rendered `—`, every sync advised renaming their directories, and they left spec-sync and cross-spec scope. Moving the fixture's date to today had hidden exactly that regression.
rule: Before editing a fixture a new rule breaks, classify each failure: is this history impossible, or merely unusual? Check it against what the product itself writes (migrations, recoveries, backfills) and against real records in the fleet — not against how the feature is normally used. Keep at least one failing fixture per class UNCHANGED until you can say which one it is; a fixture that turns out possible stays as the regression guard and the rule changes instead.
enforced_in: habit — no mechanism. conductor-15 8.3 (assert and functional) keeps its fixed 2026-08-05 date as the guard for this history; `archiveDay()` in scripts/test/fixtures/helpers.mjs dates the fixtures that were genuinely impossible.
tags: [testing, fixtures, time, review]
---

**Cause.** A red suite after a new rule reads as "the fixtures are stale", and most of them may be.
The rule's author also holds the strongest belief about which histories are possible, which is the
belief the failing tests are testing. Editing the fixtures in bulk converts every counter-example into
agreement.

**What made this one hard to see.** The impossible cases dominated: 55 of the 56 failures really were
fixtures that registered an epic today and archived it under a random past date. The one that was
real looked identical — a fixed date, a newer `createdAt` — and the difference was only in the
epic's STATUS (already archived) and in who writes such records (pm's own date recovery, not a
user).

**The check that would have caught it.** Ask the product, not the feature: which code paths write
`createdAt`, and can any of them write a date later than the archive? `recover-created-at` could,
and the fleet held two instances.
