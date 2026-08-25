# Task 16.1 — call-site completeness sweep

#115's remedy, applied to this change. Every enumeration below was **derived mechanically** (`rg`
for the callers), never typed from memory — a list typed from memory goes stale the moment a caller
is added, which is the defect this sweep exists to catch.

Run by a fresh-context reviewer against `3c0962f`. Findings were fixed in `eee4f7e`, `70a1783`,
`044233f`, `31ef0a9`, `431e8c7`.

## Findings

### 1. The attribution array was not initialized on `sync`'s two creation paths — FIXED

`gate-integrity` spec:519 makes the rule **temporal and unconditional**: an epic created after this
capability carries the array, initialized empty. Enumerated `state.epics.push`:

| site | held before | after |
|---|---|---|
| `add-epic.mjs:262` | ✅ | ✅ |
| `add-many.mjs:89` | ✅ | ✅ |
| `subcommands.mjs:293` — sync, openspec change | ❌ | ✅ |
| `subcommands.mjs:305` — sync, superpowers plan | ❌ | ✅ |
| `backfillArchive`, `subcommands.mjs:261` | ⚪ | ⚪ correctly absent |

**Why it mattered:** both consumers *forgive* an absent array — staleness returns `unverifiable`,
and the integrity check requires `Array.isArray && length === 0` so it never fires. The omission was
therefore silent, and `/pm:sync` is the dominant registration path for **openspec-lane** epics —
exactly the lane the Gate 2 and staleness rules bind. The spec's own phrase: *"hiding the omission
behind the one case the staleness gate is required to forgive."*

**The test was the counter-example.** It enumerated two sites **by name**
(`conductor-13.test.mjs:1068`, *"on both creation paths"*). Fixed by routing all five paths through
one sink, `pushEpic()` in `state.mjs`, with the backfill exemption **derived** from its stamp rather
than passed — a sixth path inherits the rule instead of needing to remember it — and by replacing
the by-name test with a mechanical source scan.

**Justified omission:** `backfillArchive`. A backfilled epic genuinely predates the capability, so
absent (meaning *unverifiable*) is the honest state. Now carries a block comment saying so; it
previously justified its missing `gate2` at length and said nothing about the array, inviting the
next reader to "fix" it for uniformity.

### 2. `record-gate-review` had no unknown-flag allowlist — FIXED

`epic-annotation` spec:84-87 requires an epic-mutating command to reject an unsupported flag by
name. `add-epic`, `update-epic`, `add-many` and `release` complied; `gate-review-writeback.mjs:22-31`
read named flags and dropped the rest, so `--reviewr "x"` exited 0 and wrote nothing — **#79's exact
shape at a fifth site**, in the release fixing #79. This change had *added* three flags for that
command to `EPIC_FLAGS` without giving it the rejection those registrations exist to feed.

`--gate`/`--verdict` were registered at the same time: without them the allowlist would reject the
command's own usage line, which would be a parallel list spelled as an exception.

### 3. Scope-lessness was generalized to secondary trackers — FIXED

`tracker-sync` spec:115-117 says explicitly *"this requirement MUST NOT be generalized to them."*
`anyInwardProcedureEmittable` ran every secondary through the primary's predicate. Result:
`rules.mjs:390` **emitted** the secondary sync section while `rules.mjs:439`, `briefing.mjs:218`,
`:232` and `subcommands.mjs:340` all **suppressed** it — two emitters, one question, opposite
answers. **#109's shape at the sibling site.**

Fixing it surfaced a second live symptom of the same cause: that configuration rendered
`add-epic --id null-<issue-number>` in its emitted recipe — a command that fails as written.

### 4. `remove-epic` left a dangling deferral — FIXED

`remove-epic.mjs:67` stripped dangling `links[]` and never touched `state.releases[].deferred[]`, so
removing a deferred epic left `PROJECT.md` rendering a deferral pointing at nothing. Introduced by
group 14.

**This sweep did not find it** — the implementing agent did. The sweep enumerated **call sites**, and
a deferral is a **data reference**. That gap is now closed in the emitted rule itself (`431e8c7`):
the sweep item covers data references, not only calls. `epicReferences()` in `links.mjs` declares all
seven holders of an epic id; `remove-epic` sweeps the droppable ones and **refuses** on a detour
frame, which is control state rather than a record.

## Swept and found complete

Each enumeration derived with `rg`, not from the design doc.

| Rule | Sites | Result |
|---|---|---|
| Archive transition | 5 — interactive verb, heal, backfill, `add-epic`, `add-many` | complete; `rg '"archived"'` finds no sixth writer |
| `reconcileArchived()` | 6 call sites | rule lives **inside** the function, so a seventh caller inherits it |
| Lane normalization | all former strict `=== "openspec"` sites | none survive; negated forms checked too |
| `ENGINE_STAMP_TOKENS` | 5 tokens ↔ 5 engine writers | `engineStamp` throws on an unregistered token |
| Disposition writers | engine paths stamp `recordedBy`, agent paths omit it | consistent; replacement reads it at one site |
| `activate()` | 4 doors | obligation set **inside** the function |
| Flag registry | `UPDATE_EPIC_FLAGS`, `add-epic`, `RELEASE_FLAGS`, `add-many` keys | all projections of `EPIC_FLAGS` |
| Migration vs attribution array | — | never added to a pre-existing epic |
| Raw checkbox counting | `countCheckboxes` | called only inside `epic-progress.mjs`; every consumer goes through the chokepoint |
| Contention latch | both Decision-14 edits | consume sets the latch, `snapshot()` does not consume |
| Tracker direction | 6 governed emitters | enumerated from the **emission** side, not the predicate side |

## What the sweep taught about itself

It found three real defects and **missed a fourth of a shape it was not looking for**. The
enumeration discipline works; the definition of "call site" was too narrow. That correction is now
in the emitted rule rather than only in this report, so the next sweep inherits it.
