---
title: A validation that normalises a copy of the input guards nothing the write reads
trigger: You are writing a refusal or validation step for a CLI flag and you normalise the value
  first (trim, lowercase, parse, dedupe) into a local variable, while the code that WRITES the value
  sits elsewhere in the function and reads the flag again.
cost: gate-verdict-withdrawal Gate 2, 2026-09-14. Refusals 3-6 judged `" 2".trim()`; the write
  re-read the raw flag, keyed the delete `gate 2`, left the verdict stored, and saved an entry-less
  withdrawal to an append-only array that has no remove verb. Paired with `--status archived` it
  archived the epic, then the read-back exited 1. Both Gate 2 lenses found it independently; 1392
  tests passed over it. One fix commit (fc0561f) plus a re-review round.
rule: Validate the exact value the write uses, and make the write iterate the validated variable,
  never the raw flag. If normalising is right, normalise once and pass that one value to both. Test
  the refusal with a padded, multi-line and look-alike value, and assert state.json is byte-identical.
enforced_in: scripts/lib/update-epic.mjs — the `withdrawnGates` list is the only thing refusals
  3-6, the write loop and the read-back read; test 3.3a in
  scripts/test/gate-verdict-withdrawal.test.mjs. Retrieval only elsewhere.
---

## What happened

`--withdraw-gate-review` was validated from `withdrawnGates`, a trimmed copy of the flag. The write
block, 400 lines further down, looped over `f["withdraw-gate-review"]` directly. The two agreed on
every value the tests used, because no test passed whitespace. A value that trims to a valid gate
passed every refusal and then wrote with the untrimmed key.

The read-back caught the bad write, but only after `saveState()`: it exited non-zero on a record
that was already on disk. So the refusal looked like a refusal, and the damage had already happened.

## The sibling that got it right

`record-gate-review --gate " 2"` and `--withdraw-commit " abc1234"` both refuse outright, because
they judge the raw value. The new flag broke the house pattern by being more forgiving in its
check than in its write.

## Kind

A process failure: how a validation gets written. The engine defect itself is fixed and tested.
