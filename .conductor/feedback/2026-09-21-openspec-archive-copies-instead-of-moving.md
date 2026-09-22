# `openspec archive` (0.47.0 flow) COPIED a change tree under `archive/` instead of moving it

**Kind:** bug

## What happened

Commit `ab171b7` (`chore(openspec): archive functional-assertion-test-split; apply its spec deltas
to the main specs`) ADDED `openspec/changes/archive/2026-09-21-functional-assertion-test-split/`
**without removing** `openspec/changes/functional-assertion-test-split/`. `diff -rq` reports the two
trees IDENTICAL, and `openspec list` still reports the change as LIVE:

```
Changes:
  unit-rung-and-fixture-snapshots     0/41 tasks    just now
  functional-assertion-test-split     47/48 tasks   13h ago
```

## Why it matters (the part that is not cosmetic)

Nothing in pm refuses it, and the duplicate is not inert:

1. **`record-cross-spec-review` enumerates it.** The release-scope spec enumeration walks
   `openspec/changes/` and hashes every spec under it. On release `0.48.0` it enumerated FOUR specs
   where the release has two — the extra pair being
   `functional-assertion-test-split/specs/{suite-certification,engine-invocation}/spec.md`, the stale
   live copies. The verdict's hash set therefore covers files a human would not call part of the
   release. The gate is doing what it says (it enumerates from disk); the tree is what is wrong.
2. **`openspec list` and every count derived from it are wrong**, and any change that sizes itself
   from the number of live changes inherits the error.
3. The change it happened to is the one whose own task list says the archive must MOVE, not COPY.

## Mechanism (from pm 0.47.0's own task list, this repo)

0.48.0's `tasks.md` task 7.2 carries: *"This is the archive that the 0.47.0 archive COPY and did not
MOVE (task 0.4) — move, do not copy, and confirm afterwards that `openspec list` no longer reports
this change."* So the COPY was already observed once, in this repository, at 0.47.0 archive time, and
written down rather than fixed.

## What pm should do

Whatever performs the archive move should be **refuse-or-move**, never **copy**:

- after moving, assert the source path no longer exists (a post-condition on the move), and
- refuse if the destination already exists rather than merging into it, and
- name the change in `openspec list`'s output as archived rather than live when both trees exist,
  or fail loudly on the duplicate.

A duplicate tree is the state in which an archived change keeps being counted as live work.

## Repro

```
git log --stat -1 ab171b7        # the ADDED archive copy, no delete of the source
diff -rq openspec/changes/functional-assertion-test-split \
         openspec/changes/archive/2026-09-21-functional-assertion-test-split   # no output: identical
openspec list                    # still reports it live, 47/48 tasks
node scripts/conductor.mjs record-cross-spec-review 0.48.0 --verdict pass --reviewer x
                                 # "recorded cross-spec review 'pass' for release '0.48.0' (4 specs)"
```
