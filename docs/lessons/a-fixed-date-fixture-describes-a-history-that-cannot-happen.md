---
lesson: a-fixed-date-fixture-describes-a-history-that-cannot-happen
date: 2026-09-25
trigger: You are writing a test fixture that puts a DATED artifact on disk — an `openspec/changes/archive/YYYY-MM-DD-<id>` directory, a dated plan, a timestamped log row — next to a record the same test creates now, and you type a fixed calendar date because nothing reads the date today.
cost: sync-registers-ids-add-epic-refuses (0.50.0) made the archive resolver compare an archive directory's date with the epic's `createdAt`, so an unrelated `archive/2025-01-01-add-auth` could no longer end a live epic. Under the shipped rule the full runs failed 14 assertion-half tests (up to two of them this change's own new tests, still RED) and 42 functional tests, spread over 14 test files and the shared `withArchivedChange` fixture — every one of them registering an epic TODAY and then "archiving" its change under a fixed past date (2026-06-25, 2026-08-05, 2026-09-14…), or hand-writing a live epic with no `createdAt`. None of those histories can happen. Fixing them took a shared `archiveDay()` helper, an earlier `createdAt` on hand-written records, five twin edits and two functional certifications; the assertions themselves did not change.
rule: Date a fixture artifact RELATIVE to the record it belongs to — `archiveDay()` (fixtures/helpers.mjs) for "archived now", an explicit earlier `createdAt` for a hand-written record — never a fixed calendar date. A fixed date is only right when the test is ABOUT that date (ordering of two archives, a backfill of history).
enforced_in: habit — no mechanism. `archiveDay()` in scripts/test/fixtures/helpers.mjs is the helper the fixed fixtures now use; nothing refuses a new fixed date.
tags: [testing, fixtures, time]
---

**Cause.** A fixed date in a fixture is free while no code compares it with anything. The moment a
rule does — here, "an archive older than the epic is not its archive" — every fixture that picked
a date at random becomes a claim about an impossible order of events, and the suite reports the
new rule as the regression.

**The shape to recognise.** It is the same class as
[`fixtures-the-product-should-refuse`](fixtures-the-product-should-refuse.md): a fixture that relies
on the product accepting something it should not. There it was a placeholder sha; here it is a
timeline. In both cases the fix that the new rule forces is in the fixtures, not in the rule.

**The second trap.** A fixed date that is "in the past" today drifts: `2026-09-20` was one day old
when written and five days old when this rule landed. A fixture dated relative to now stays true.
