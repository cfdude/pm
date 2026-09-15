---
title: Narrowing a guard's trigger must re-test the population the guard protected
trigger: You are fixing a false positive in a guard, refusal or short-circuit by narrowing WHEN it
  fires (a position, a prefix, a verb list, a flag shape), and the test you write proves the false
  positive is gone.
cost: pm 0.41.0 fixed cfdude/pm#187 ("a bare --help anywhere in argv short-circuits and writes
  nothing") by firing the help short-circuit only at argv positions 0 and 1. The fix's tests proved
  the value-position case. Nothing re-ran the cases the broad guard had been protecting. A review of
  0.43.0 found `remove-epic e2 --help` exited 0 having deleted e2, and a sweep appending `--help` to
  each verb's working invocation found 14 verbs that performed their write. Exit 0 and writes nothing
  had become exit 0 and writes anyway, which is worse, and it shipped in three releases.
rule: When you narrow a guard, list what the broad guard was stopping before you change it, and keep a
  test for each. The fix's own test only proves the case you narrowed FOR. The cases you narrowed
  AWAY from are what regress.
enforced_in: scripts/test/verb-surface.test.mjs — DISPATCH_BASELINE appends a help token after every
  verb's working invocation and asserts nothing is written, so the population is re-tested whenever
  the check changes. Retrieval only elsewhere.
---

## What happened

The broad short-circuit had two effects: it stopped `--help` in a value position from being read as a
value (the bug #187 reported) and it stopped every verb from acting when a help token appeared anywhere.
The narrowing kept the first and silently dropped the second for every position after 1. The tests
written for the fix asserted the reported case and passed.

## What would have caught it

A table of the guard's population before editing: every verb, every position a help token can take.
0.44.0 now runs that table as a test (`DISPATCH_BASELINE`), so a future narrowing fails on the verb it
re-exposes.

## Kind

A process failure: how a guard fix gets tested. The engine defect is fixed in
every-verb-refuses-what-it-does-not-read.
