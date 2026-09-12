---
title: A test fixture reconstructed from the live record dies the moment the product succeeds
trigger: You are writing a test that builds its fixture by reading the project's own live record
  and UNDOING something — peeling off a migration's stamps, reverting statuses, stripping a field —
  to reconstruct an earlier state.
cost: Four tests failed at once, mid-batch, after an evidence-based walk replaced 66 engine-stamped
  dispositions with real ones. The walk was the product's explicit goal — `unconsidered-outcomes`
  exists to drive that count to zero — so the tests broke BECAUSE the tool worked. Blocked a commit
  until a frozen fixture was captured and four tests were re-pointed.
rule: Freeze the fixture. Never build a test's starting state by reading the project's own live
  record and undoing part of it — the tool improving that record is then what breaks the test, and
  the failure arrives mid-batch with nothing wrong.
enforced_in: scripts/test/fixtures/state-pre-disposition-walk.json — the frozen pre-walk record,
  and the rename of `repoFromLiveState()` to `repoFromFrozenPreMigrationRecord()` in
  scripts/test/conductor-15.test.mjs that stopped the function claiming to read live state.
detect: (readFileSync|require|import)\([^)]*\.conductor/state\.json.*\n?.*(delete |filter\(|splice\()
---

## What happened

`conductor-15.test.mjs` tested the 0.27.0 migration against **real data shapes** rather than a
synthetic fixture — a good instinct, and the comments said so. It built its fixture by reading the
repository's own `.conductor/state.json` and peeling off every disposition whose
`recordedBy === "migration"`, reconstructing the record as it stood before that migration ran.

Then a disposition walk replaced all 66 of those stamps with agent-recorded dispositions carrying
real evidence. Agent-recorded dispositions correctly carry no `recordedBy`. So the peel found
nothing, the migration under test had an empty population, and the test failed on
`assert.ok(delivered.length < stamped.length)` with both sides zero.

Three sibling tests failed the same afternoon for the same underlying reason: they asserted live
counts and named live ids that the walk legitimately changed.

## Why this is worse than an ordinary flaky test

A flaky test fails intermittently and passes on retry. This one fails **permanently, and gets
worse as the project gets better.** The reconstruction depends on the record still containing the
defect the product exists to remove. Every step toward a complete record is a step toward an
impossible fixture.

It also inverts the signal: a green suite came to mean *the archive is still full of
undispositioned epics*. Nobody wrote that assertion, and nobody would have agreed to it.

## The rule

**A test that needs a past state needs a frozen artifact, not a reconstruction from the present.**
Reading real data is right; deriving it from today's record by undoing history is not. Snapshot the
shape you need, commit it as a fixture, and say in a comment when it would be legitimate to refresh
it.

The tell at authoring time is the word *undo*: if your fixture setup deletes, reverts, strips or
peels something off the live record to get back to an earlier shape, the thing you are undoing is
something somebody is trying to fix for real. When they succeed, you break.

Related, one level out: a test that transcribes a live count or a list of live ids rots the same
way — see `hardcoded-live-data-claims-rot.md`. This lesson is that one's sharper cousin, because a
count can be updated while an exhausted fixture source cannot.
