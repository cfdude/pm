---
title: A test that pins graceful degradation can pin the defect as the contract
trigger: You are writing or keeping a test that asserts a verb "still works", "does not throw" or
  "degrades to doing nothing" when its input is corrupt, missing or unreadable, and the test does not
  also assert what the verb WROTE while degrading.
cost: Two pm tests pinned the data-loss path the 0.43.0 review found. gh-111 (conductor-33) asserted
  that `owners` still answered on an unreadable state.json, and gh#129 (conductor-26) asserted that
  commit-nudge "degrades to doing nothing" (exit 0) over the same file. Both passed because loadState
  quietly returned an empty record. That same empty record is what `add-epic` then saved over a
  conflicted state.json, wiping every epic (reproduced: 3 epics → ["new"]). Fixing it meant rewriting
  both tests in the commits that changed the behavior (state-file-refuses-to-guess 1.2 and 2.3).
rule: A degradation test must say what degraded means for the record. Assert the file is byte-identical
  (or name exactly what may change) and that the verb's output does not claim success it did not have.
  "Did not throw" on corrupt input is not a contract, and it will defend a silent overwrite.
enforced_in: scripts/test/state-file-refuses-to-guess.test.mjs and the rewritten gh-111 rung (asserts
  exit 11 and no output) and gh#129 rung (asserts exit 2 and no write). Retrieval only elsewhere.
---

## What happened

Both tests were written for a real goal: a hook or a read verb should not crash a session because
state.json is damaged. Each asserted the absence of a crash and nothing about the record. The engine
met that contract by treating an unparseable file as an empty one, and every later write then saved the
empty record. The tests could not tell "degraded safely" from "about to destroy the file".

## A related reversal

pm 0.26.0 rejected a lockfile because "a session killed mid-write leaves a lock held forever". A lock
that records its holder and expires by age answers that objection, and measurement showed the
revision check alone lost updates (16 parallel add-epic in three runs: 9, 9 and 8 printed "added" against 7, 6 and 6 epics on disk). A rejection made on a
failure mode is worth re-opening when that failure mode gets a mitigation.

## Kind

A process failure: how degradation tests get written. The engine defects are fixed in
state-file-refuses-to-guess.
