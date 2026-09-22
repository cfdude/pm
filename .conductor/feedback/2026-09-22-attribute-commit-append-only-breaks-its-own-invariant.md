# Catching up an EARLIER commit with `--attribute-commit` breaks the invariant the array is read with

**Kind:** bug

## What happened

`attributedCommits` is append-only and the engine neither reorders nor de-duplicates it. Required task
item 4 also says work already in flight is covered: "catch up in the order the commits landed, then
keep attributing forward."

Those two rules meet badly. The catch-up call appends an ANCESTOR at the END of the array, and the
array is read with a position-sensitive invariant:

> every attributed commit must be reached by a recorded Gate 2 `headSha` (equal to that head or an
> ancestor of it), whatever position it holds

`headSha` is the LAST attributed commit. So after a catch-up the array's last entry is an ancestor of
entries that precede it, and every commit that landed after it is a DESCENDANT of the head — not
reached by it. The archive gate then reads a stale verdict for commits that are perfectly fresh.

Reproduced here, on `unit-rung-and-fixture-snapshots`: after attributing forward, three proposal
commits that landed before the first attributed commit had to be caught up, plus a task commit
re-attributed because it had been AMENDED (its sha changed, so the previously attributed one was
withdrawn). All four appended. The last entry became an ancestor of `be2daa9`, `79b5c57`, `e6b928f`
and others.

**The only repair available is to re-attribute the true head**, so the last entry reaches every other
one — which means the array now holds the head TWICE. That works, and it is what the engine tolerates
rather than what it intends.

## Why it is worth fixing rather than documenting

* The failure is SILENT until archive time, which is the worst moment: the work is done, the review is
  recorded, and the gate says the verdict is stale for a range nobody can re-review.
* The remedy available to a user is either "re-attribute the head, creating a duplicate" or "hand-edit
  `state.json`", and hand-editing is the thing this record exists to prevent.
* The catch-up path is the DOCUMENTED path for work already in flight — it is not an edge case, it is
  what happens on the first attribution of any epic that was started before its commits were recorded.

## What pm should do (any one of these closes it)

1. **Key the invariant on the SET, not the last element.** "Every attributed commit is reachable from
   the recorded headSha" is the property; "the last entry IS the head" is an implementation of it that
   a catch-up breaks. Compare against the head the verdict names, not against array position.
2. **Refuse the catch-up append when it would break the order**, naming the two ways out: attribute in
   landing order from the start, or re-attribute the head afterwards. A refusal now is cheaper than a
   stale verdict later.
3. **Give the catch-up a verb that reorders** (`--attribute-commit <sha> --before <sha>`), so the
   documented operation produces a well-ordered array instead of requiring a duplicate to repair it.

## Repro

```
# an epic with commits A B C attributed forward, then a catch-up for Z, which landed BEFORE A
node scripts/conductor.mjs update-epic <id> --attribute-commit Z
node -e 'console.log(require("./.conductor/state.json").epics.find(e=>e.id==="<id>").attributedCommits)'
# -> [A, B, C, Z]      and Z is an ancestor of A, B and C
# Gate 2 then records headSha = Z, and B/C are NOT reached by it.
```
