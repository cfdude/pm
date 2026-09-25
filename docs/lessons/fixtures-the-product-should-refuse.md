---
title: A fixture value the product should refuse hides the missing refusal
trigger: You are writing a test fixture for a field that names something outside the record — a commit
  sha, an epic id, a file path, a detour — and you type a placeholder ("abc1234", "HEAD", "deadbeef", an
  epic that was never pushed) because the verb accepts it today.
cost: pm accepted any string as a commit sha and any epic as a reconcile detour from the day those verbs shipped. The
  0.43.0 review found both were gate bypasses: `--attribute-commit not-a-commit` flipped a refused
  archive to accepted, and `record-reconcile p --detour p` cleared the reconcile gate. The suite never
  noticed because its fixtures relied on exactly that acceptance: the commit that added write-time
  resolution (3132bab) removed over fifty lines seeding placeholder shas, and conductor-09's "record-reconcile creates the
  link if one doesn't already exist" test pinned the bypass as intended behaviour and had to be inverted.
  Converting fixtures to real commits and armed detours produced 37 test-file entries across the
  commits of gates-bind-to-verified-evidence.
rule: When a fixture needs a value that references something, create the real thing (a commit, a pushed
  detour, a registered epic) instead of typing a placeholder. If creating it is awkward, that is the
  signal the verb may be accepting something it should refuse; write the refusal test first.
enforced_in: scripts/test/helpers.mjs real-commit fixture helpers (d50c389) and the write-time refusals in
  update-epic, record-gate-review and record-reconcile, which now reject placeholders outright. Retrieval
  only elsewhere.
---

## What happened

Placeholders are convenient and they read as harmless: the test is "about" something else. But each
one is a silent assertion that the verb accepts an unverifiable value. Hundreds of them across the
suite made that acceptance load-bearing, so the moment the engine started refusing a non-commit, a
large share of the suite would have failed. That is exactly why the refusal was never added.

## Kind

A process failure: how fixtures get written. Related: a-degradation-test-can-pin-the-defect.

## Recurrence — a hand-built record SHAPE, not just a placeholder value (2026-09-25)

The same failure in a different form. `conductor-33`'s activity-log test built its detour frame
by hand as `{ epic: "e1" }`. `push-detour` has always written `{ pausedEpic, spawnedDetour, … }`,
and the log's `frameEpic` read `epic || epicId || id`, keys that nothing writes. The fixture agreed
with the reader, not with the writer, so the test passed while every real detour event recorded
`epic: null` from 0.35.0 until activity-log-detour-events-lose-epic. The rule covers shapes as
well as values: when a test feeds a reader a record, have the verb that writes that record produce
it.
