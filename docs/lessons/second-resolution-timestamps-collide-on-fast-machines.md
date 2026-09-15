---
title: A test that asserts two timestamps differ passes on a slow machine and fails on a fast one
trigger: You are writing a test whose fixture makes two or more git commits, or two records
  stamped from the clock, and an assertion depends on their times being DIFFERENT.
cost: One CI failure on a release PR, after the change had already passed Gate 1, a cross-spec
  gate, Gate 2 at three fresh-context lenses, and two full local suite runs at 1206/1206. The
  test had been green on the developer laptop for the whole release.
rule: Never assert that two timestamps merely differ. Set the times explicitly — GIT_AUTHOR_DATE and
  GIT_COMMITTER_DATE, or an injected clock — and assert each record against its OWN source. Git's
  `%cI` is second-resolution, so a fast machine writes both in the same second.
enforced_in: scripts/test/conductor-39.test.mjs — the fixture now sets GIT_AUTHOR_DATE and
  GIT_COMMITTER_DATE explicitly, spaced a minute apart, and asserts each record against its OWN
  commit rather than merely against "not the other one".
detect: (notStrictEqual|notEqual)\([^)]*(createdAt|touchedAt|recordedAt|reviewedAt|assertedAt|%cI)
---

## What happened

`conductor-39.test.mjs` built a fixture that registered two epics, committing after each, then
asserted the recovered `createdAt` of the two differed:

```js
git(cwd, "commit", "-q", "-m", `chore: register ${id}`);
...
assert.notEqual(epicOf(cwd, "one").createdAt, epicOf(cwd, "two").createdAt,
  "two epics introduced by two commits do not share a date");
```

`git log --format=%cI` has **second** resolution. On a GitHub Actions runner both commits landed
inside the same second, so the two dates were byte-identical and the assertion failed — with
`expected` and `actual` printed as the *same string*, which reads as a nonsense failure until you
notice the operator is `notStrictEqual`.

## Why every gate missed it

Nothing in the review path runs on different hardware. Gate 1 reads artifacts, the cross-spec gate
reads specs, Gate 2 reads a diff, and the local suite runs on one machine whose commit loop happens
to be slow enough. The failure is a property of the **execution environment**, and the first
environment that differed was CI — which is the last thing to run before a merge.

The shape generalises past git: any assertion that two clock readings differ is really an assertion
about how fast the code between them runs.

## The rule

**Never let a test depend on wall-clock time advancing.** If two records must differ in time, *make*
them differ: set `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE` for a commit, or inject the clock for an
engine stamp. A fixture that controls its own time is also a better test — it can assert each
record matches **its own** source, which is the property actually under test, rather than the much
weaker "these two are not equal".

And when a `notEqual` fails with identical `expected` and `actual`, that is the signature: two
things that were supposed to be distinct were produced too close together to be distinguished.
