# Call-site completeness sweep — gate-verdict-withdrawal

Required task item 7.1, derived mechanically from the tree at `3da2ad4`, never from design.md's
surface table. Line numbers are as of `3da2ad4`.

## Derivation

```sh
# callers of every guarded or new function, and the gate vocabulary
rg -n "\b(gateHasEvidence|gateArtifacts|gateSummary|gateStaleness|stalenessMarking|ungatedArchives|recordedShas|archiveGate|deliveredObligations|KNOWN_GATE_NUMBERS|withdrawnGate|gateTableRows|withdrawnArchiveNote)\(|\bKNOWN_GATE_NUMBERS\b" scripts/lib \
  | rg -v "^\S+:\d+:\s*(//|\*|/\*)"
# every reader, writer and remover of the gate record and the new sibling
rg -n "gateReview|\bgate1\b|\bgate2\b" scripts/lib | rg -v "^\S+:\d+:\s*(//|\*|/\*)"
rg -n "withdrawnGateReviews" scripts/lib | rg -v "^\S+:\d+:\s*(//|\*|/\*)"
# the flags
rg -n "\"withdraw-gate-review\"|withdrawal-reason" scripts/lib | rg -v "^\S+:\d+:\s*(//|\*|/\*)"
```

## Writers and removers of `gateReview.gateN`

| Site | Operation | Withdrawn state |
|---|---|---|
| `gate-review-writeback.mjs:134-159` `record-gate-review` | writes `gateN`, keeping one `superseded` | **Ends it.** A stored verdict is never withdrawn (`withdrawnGate`). `prior` is undefined after a withdrawal, so a re-record starts clean (2.7). |
| `update-epic.mjs:689-700` `--withdraw-gate-review` | REMOVES `gateN`, appends to `withdrawnGateReviews` | **Creates it.** Refusals 1-6 at `:230-296` run before any write; the archive gate (`:808`) and the regression check (`:841-842`) decide on the record it leaves (6.1, 6.2). |
| `epic-progress.mjs:134-136` `reconcileArchived` (the heal) | writes `gate2 = ungated` over an absent entry | **Skips a withdrawn Gate 2** (5.1). An `ungated` stamp would end the state and relabel the epic "never reviewed". |
| `migrations.mjs:152-153` 0.27.0 `stampArchivedOutcomes` | reads `gate2.verdict === "pass"` | **Not taught.** A withdrawn Gate 2 reads as no pass and stamps `unknown`, which is the true outcome (design.md "The record", stated assumption). |
| `add-epic`, `add-many`, `state.mjs` pushEpic | none | No writer: creation never sets `gateReview` (the `add-epic.mjs:467` hit is a comment). |
| `remove-epic` | removes the epic whole | `gateReview` and `withdrawnGateReviews` are nested in the epic and leave with it; no cross-record pointer to sweep. |

## Readers of `gateReview.gateN`

| Site | Reads | Withdrawn state holds? |
|---|---|---|
| `archive-gate.mjs:273-290` `deliveredObligations` | Gate 2 present / pass / staleness | **Yes** — names a withdrawn Gate 2 in `detail`, reason in `items` (4.1). Both callers inherit it. |
| `archive-gate.mjs:392-420` `archiveGate` | Gate 2 remedy selection | **Yes** — prints the reason JSON-quoted, controls escaped (4.1, 6.1). |
| `update-epic.mjs:123-132` `regressionRefusal` | the obligation's `items` | **Yes** — switches on `o.kind`; handoff rendering byte-identical (4.1, 6.2). |
| `archive-gate.mjs:139-150` `gateTableRows` → `render.mjs:242`, `briefing.mjs:199` | which epics, each cell | **Yes** — lists an epic whose every gate is withdrawn; cell `withdrawn — <reason>` (4.4). |
| `integrity.mjs:149-181` `ungatedArchives` → `integrity.mjs:244` (ungated check), `:258` (withdrawn check), `briefing.mjs:218` | Gate 2 `ungated` / withdrawn | **Yes** — two kinds, disjoint; withdrawn kind filtered openspec-lane, completion scope, archived in state OR on disk (5.3-5.7). |
| `integrity.mjs:306-314` `archived-openspec-epic-with-no-gate-1` | Gate 2 pass, Gate 1 absent | **Yes** — names a withdrawn Gate 1 and quotes its reason (4.2). With both withdrawn it is quiet by its own premise (no pass), and the withdrawn kind covers the epic. |
| `integrity.mjs:119-120` `recordedShas` | both gates' `baseSha`/`headSha` | **Not taught, deliberately** — see DATA references below. |
| `integrity.mjs:223-224` `verdict-range-omits-cited-commits` | both gates' ranges | **Not taught, deliberately**: a withdrawn verdict is not a claim the record still makes, so its note's cited shas are not checked against it. Mirrors `withdrawnCommits`. |
| `integrity.mjs:272-273` `delivered-epic-attributed-no-commits` | Gate 2 pass | **Quiet by construction**: no pass, no finding. A withdrawn Gate 2 on a delivered epic is named instead by the archive gate / regression check on the way in, and by `archived-delivered-gate2-regression-report` (registered by the predecessor) where it arrives another way. |
| `integrity.mjs:346-347` `heal-archived-epic-passed-gate-2` | Gate 2 pass | **Quiet by construction**: the check is about a pass wearing `unknown`; there is no pass. |
| `integrity.mjs:366-388` `gate-recorded-as-bookkeeping` | both gates' `reviewedAt` | **Clears**, deliberately: clearing a misplaced verdict's bookkeeping finding is the use case (6.5). |
| `activity-log.mjs:247-249` `diffEvents` gate-review | verdict change | **Unchanged**: a vanished verdict emits nothing. `:255-258` emits `gate-withdrawn` on GROWTH of `withdrawnGateReviews` only, so a hand-edit deleting `gate2` is not logged as a withdrawal (4.5). |
| `constants.mjs:90-96` `withdrawnGate` | `gateN` presence | The definition itself. |
| `update-epic.mjs:61` `missingGateWithdrawals` | `gateN` presence after render | The read-back (2.8). |
| `update-epic.mjs:276` refusals 5/6 | `gateN` presence, `verdict === "ungated"` | Keyed on the verdict, never on `recordedBy` (3.6). |
| `verb-effects.mjs:113` | a description string, not a read | n/a |

## Other guarded functions

| Function | Callers | Holds? |
|---|---|---|
| `gateHasEvidence` | `archive-gate.mjs:107`, `constants.mjs:139`, `gate-review-writeback.mjs:83`, `integrity.mjs:225`, `:402` | Unchanged: every caller receives a stored entry, which is never withdrawn. |
| `gateArtifacts` | `constants.mjs:138`, `integrity.mjs:402` | Same. |
| `gateSummary` | `archive-gate.mjs:145` only (render and brief now go through `gateTableRows`) | A withdrawn cell never reaches it. |
| `gateStaleness` / `stalenessMarking` | `archive-gate.mjs:121`, `:145`, `:284`, `:420` | A withdrawn gate has no entry; `gateTableRows` renders the withdrawn cell before `stalenessMarking` is consulted. |
| `archiveGate` | `update-epic.mjs:808` only | The heal, backfill and archived-at-creation paths stamp and are not gated, by an existing requirement. |
| `deliveredObligations` | `archive-gate.mjs:391`, `update-epic.mjs:841-842` | Both inherit the withdrawn wording. |
| `KNOWN_GATE_NUMBERS` | `gate-review-writeback.mjs:58-59`, `update-epic.mjs:249-252` | One declaration (`constants.mjs:126`), two importers (2.1). |
| `withdrawnGate` | `archive-gate.mjs:142`, `:149`, `:274`; `epic-progress.mjs:134`; `integrity.mjs:169`, `:314` | Every surface calls it; none re-derives the state. |

## Readers of `withdrawnGateReviews`

`constants.mjs:93` (`withdrawnGate`), `integrity.mjs:173` (`archivedUngated` — ANY Gate 2 entry, 5.8),
`activity-log.mjs:255-256` (growth), `update-epic.mjs:62` (read-back), and the single writer
`update-epic.mjs:696`. It is append-only: nothing removes an entry.

## DATA references

- **`withdrawnGateReviews[].entry.baseSha`/`headSha` hold commit shas.** `recordedShas()` deliberately
  does not enumerate them, and its own "a third holder added later must be added HERE" comment now says
  so (`integrity.mjs`, commit `3da2ad4`): a withdrawn verdict is a record of something taken back, so
  demanding its commits stay resolvable would preserve evidence for a claim nobody is making. This
  mirrors `withdrawnCommits[].sha`, recorded in the same comment.
- **No field holding another record's id is added.** `entry` holds a verdict; `reason` is free text.

## `INVOCATION_DROPPED_FLAGS`

`--withdraw-gate-review` and `--withdrawal-reason` are deliberately NOT in `update-epic.mjs:78-81`, and
the set's own comment now says why (commit `3da2ad4`): the printed invocation must echo the withdrawal,
because the #175-shaped remedy is "withdraw AND record the implied disposition" in one call. Pinned by
6.2 (`'--withdraw-gate-review' '2'` appears in the invocation).

## Conclusion

The withdrawn state holds at every reader that decides from a Gate 2 or Gate 1 verdict and words the
result for a person: the archive gate, the regression refusal, the gate tables, the standing condition
(integrity and brief) and the no-Gate-1 check. The readers it deliberately does not reach are the four
whose finding is QUIET once no verdict is stored (`delivered-epic-attributed-no-commits`,
`heal-archived-epic-passed-gate-2`, `gate-recorded-as-bookkeeping` — which is the use case — and the
0.27.0 migration), plus the two sha holders (`recordedShas`, `verdict-range-omits-cited-commits`) that
check evidence a withdrawn verdict no longer claims. No sibling site was left untouched without a
reason above.

## Inverse of every operation added (7.2)

- **`--withdraw-gate-review` is the inverse of `record-gate-review`**, which was the one record in
  `state.json` without one.
- **Its own inverse is re-recording** (`record-gate-review`), which ends the withdrawn state and keeps
  the withdrawal as history (2.7, 4.3). **No un-withdraw verb is shipped, deliberately**: restoring the
  withdrawn entry would resurrect a verdict nobody re-asserted (design.md "What this deliberately does
  not do").
- **`withdrawnGateReviews[]` is append-only with no remove**, as `withdrawnCommits` is: a withdrawal is
  a judgment, and this record keeps judgments.
- **`record-cross-spec-review` gets no withdrawal**, deliberately: that verdict is stored against a
  release with its spec set hashed from disk, so a spec change already stales it (design.md).
- **The heal's skip** is not an operation with an inverse: it declines to write.
