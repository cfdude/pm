# Task 16.2 — verification against the commit

#121's remedy, applied to this change. For every task, the files its `(files: …)` clause claims were
checked against **that task's commit** via `git show --stat` — **never the working tree**, which is
the failure #121 exists to end: two commits in the audited corpus were ticked green while their
files were never staged, because every verification layer inspected the tree instead of the diff.

Run by a fresh-context reviewer against `3c0962f`. Findings fixed in `d9fba22`.

## Method

The task→commit map was built by **diffing `tasks.md` across `152587b..HEAD` and recording which
commit flipped each `- [ ] N.M` to `- [x]`**. Subject matching is useless here — `commit-map.md` §1
documents three commits carrying another agent's message — and this method is reproducible by anyone
with the branch.

## Counts

| Measure | Value |
|---|---|
| Task lines in `tasks.md` | 115 |
| Ticked and in scope | 103 |
| Ticked tasks carrying a `(files: …)` clause | 102 |
| Ticked tasks claiming no files | 1 — `13.4`, on the closed exemption list |
| **Verified against their own ticking commit alone** | **66 / 102** |
| Needed widening to a set or sibling commit | 36 |
| Claimed files absent from the entire branch | 1 → fixed |

## Findings

### 1. Task 8.6 claimed a file absent from the whole branch — FIXED as a claim

`scripts/lib/state.mjs` appears in **zero commits**; `archiveBackfilledAt` lives only in
`subcommands.mjs`. The **code is right** — the marker must stay out of `defaultState()`, or
`loadState`'s spread would make it always present and collapse the presence semantics the design
depends on. The claim was corrected and the deliberate omission stated.

### 2. Task 3.5 claimed three files its commit does not carry — FIXED as a claim

`subcommands.mjs` is **unsatisfiable by construction**: `/pm:next` has no engine subcommand
(`rg '"next"' scripts/conductor.mjs` → nothing), so there was no consumer there to repoint.
`render.mjs`/`briefing.mjs` reach the definition through `resolveEpics()` → `epicProgress()`.

Resolved as *claim wrong, work present* — but deliberately, not by default. **"The behavior exists
elsewhere" is exactly the reasoning #121 was created to defeat**, so the evidence is stated inline:
what the task shipped is the chokepoint plus a source scan forbidding anyone else doing the
subtraction.

### 3. The vacuous half came back clean

Exactly one ticked task claims no files (`13.4`), and it is on the preamble's closed exemption list.
**No ticked task is missing its claim** — so 16.2 is not passing vacuously over part of the list,
which was the risk that made this check worth running at all.

Edge, not a finding: `1.6` and `10.10` name only a test file. Both are test-authoring tasks whose
only product is that file.

## Noted — the checkbox and the diff were written by different hands

Not in `commit-map.md`, and it is **the same decoupling that made #121 possible**.

**26 tasks were ticked by a commit that did not implement them.** 21 of those (`10.1`–`10.14`,
`11.1`–`11.6`, `12.1`) were bulk-ticked by `badb5ea` — a docs commit carrying **no engine file at
all**. Each has a covering implementing commit elsewhere on the branch; the tick simply does not
point at it. A further five were ticked by test-only commits.

Every one was verified substantively. None is a missing implementation. But the tick is not evidence
of the work — which is precisely the claim #118 makes about checkboxes, arriving from the commit
side.

## Noted — covered by `commit-map.md` §2

`5.5`, `6.10`, `8.4`/`8.5`, `11.4`, `10.12` — one commit carrying several tasks where git hunks could
not separate interleaved edits. For these, "the task's commit" is a **set**, and union coverage was
confirmed for each.

## Noted — `commit-map.md` §3 was incomplete — FIXED

It named three absorbing commits. Two more had absorbed `docs/lessons/**`: `badb5ea` (11 files) and
`fc6636a` (2). The record of the damage was itself short, so "ignore the §3 paths" could not be
applied mechanically. §3 now lists six, and names the three lessons-lane commits that **own** their
files.

## Over-claims — file named, no edit needed

`1.4` (`constants.mjs`), `7.3` (`disposition.mjs`), `9.3` (`git.mjs` — imported, not edited).
Recorded rather than corrected: naming a file you read is defensible, and tightening the convention
mid-release would invalidate the map above.

## Not repaired, deliberately

Rewriting pushed history to tidy attribution would cost more than the imprecision it removes. The
task is to **report**, and the damage is now recorded in `commit-map.md` where a later reader will
find it instead of rediscovering it.
