# Conductor fleet census — 2026-08-23

Evidence base for the lifecycle spec and the product-layer roadmap conversation. Measured across
**15 personal conductor-managed repositories, 333 epics**. Highway repos excluded from the sample
(trust boundary); this is a personal-estate measurement only.

Reproduce with the commands in [Method](#method).

## Headline

| Association | Epics carrying it | Share |
|---|---|---|
| `planPath` — the plan this epic implements | 39 | 12% |
| `specPath` — the design it came from | **0** | 0% (field does not exist — #92) |
| `stories` — a breakdown | 17 | 5% |
| `gateReview.gate2 == pass` — a recorded implementation review | 7 | 2% |

**88% of epics have no link to a plan. 100% have no link to a spec. 98% have no recorded review.**

The conductor knows what to work on and in what order. It knows almost nothing about what each
item is part of, or what it came from.

## Per repo

| Repo | Epics | planPath | specPath | stories | gate2 | externalId |
|---|---|---|---|---|---|---|
| pm | 115 | 4 | 0 | 15 | 3 | 32 |
| personal-finance-paper | 63 | 20 | 0 | 0 | 0 | 15 |
| personal-finance | 37 | 1 | 0 | 0 | 0 | 7 |
| job-search-agent | 30 | 0 | 0 | 1 | 1 | 27 |
| onvex-ai-corp | 21 | 4 | 0 | 0 | 0 | 0 |
| cfdude-plugins | 18 | 4 | 0 | 1 | 0 | 1 |
| virtual-mic | 12 | 4 | 0 | 0 | 1 | 1 |
| agent-dm | 12 | 1 | 0 | 0 | 2 | 0 |
| substack | 8 | 0 | 0 | 0 | 0 | 0 |
| knowledge-store | 4 | 0 | 0 | 0 | 0 | 0 |
| onvex-meetnexus-backend | 4 | 0 | 0 | 0 | 0 | 0 |
| onvex-meetnexus-ios | 3 | 1 | 0 | 0 | 0 | 0 |
| cfdude-music, pm-sample, edd-harness-dev | 6 | 0 | 0 | 0 | 0 | 0 |
| **Total** | **333** | **39** | **0** | **17** | **7** | **83** |

## The Gate 2 finding (#110)

**49 openspec-lane epics are archived. 7 carry a passing Gate 2.**

The gate is code, not instruction — `update-epic` exits 1 — so this is not an adherence problem.
42 epics went around it, and did not have to try:

```
$ conductor.mjs update-epic gate-bypass --status archived
conductor: cannot archive openspec-lane epic … missing a passing Gate 2
status: active                                          # guard holds

$ mkdir -p openspec/changes/archive/2026-08-23-gate-bypass    # i.e. /opsx:archive
$ conductor.mjs render
status: archived  gate2=none                            # guard gone
```

`reconcileArchived()` (`scripts/lib/epic-progress.mjs:70`) flips any epic whose change is archived
on disk, with no lane check and no gate check — and `render` runs from the SessionStart hook,
PreCompact, and commit-nudge. The transition happens before the next prompt, with no command run
and no agent involved.

`/opsx:archive` is **step 6 of the documented OpenSpec lifecycle**. Following the documented
process is what defeats the guard.

There is no test for the archive gate on either path
(`rg "cannot archive openspec" scripts/test/` → nothing).

## What a gate verdict actually contains (#113)

`record-gate-review` stores `{verdict, reviewedAt, note?}` and nothing else
(`scripts/lib/gate-review-writeback.mjs:45`). The notes are substantive — they name diff ranges,
finding counts, test totals — but a range like `40c82fb..2ca1242` is prose in a free-text field.
No code reads it.

Consequences: a verdict cannot go stale (review `a..b`, ship `b..c`, gate still passes); a verdict
cannot be verified (one command, no evidence required); and `gate1` is stored, documented, and read
by **nothing** — the only consumer of `gateReview` in the engine is `update-epic.mjs:107`, which
reads `gate2`.

## Lane distribution — this repo

| Lane | Archived | Queued/planned/untriaged |
|---|---|---|
| claude-code | 51 | 44 |
| superpowers | 7 | 1 |
| decision | 7 | 0 |
| openspec | 3 | 2 |

95 of 115 epics are `claude-code` lane — the lane with no spec, no plan, no gate, no stories by
design. 51 are already archived with no artifact linkage.

32 of those 95 carry an `externalId`, i.e. arrived through the inward-sync instruction, which
hardcodes `--lane claude-code` (`rules.mjs:243`, `:275`) regardless of what the issue describes.
That accounts for about a third; the remaining 63 were routed by hand or heuristic (#114).

## Retrospective audit — feasibility

Confirmed feasible. **44 of the 49** archived openspec epics still have their archived change on
disk under `openspec/changes/archive/`:

| Repo | Archived openspec epics | Spec recoverable |
|---|---|---|
| personal-finance | 18 | 16 |
| personal-finance-paper | 15 | 14 |
| agent-dm | 4 | 4 |
| virtual-mic | 4 | 4 |
| pm | 3 | 1 |
| knowledge-store | 2 | 2 |
| job-search-agent | 2 | 2 |
| cfdude-plugins | 1 | 1 |

Two of pm's three are unrecoverable for an instructive reason: `platform-parity-mechanism` and
`conductor-mjs-module-split` are tagged `openspec` lane but their artifacts live under
`docs/superpowers/`. Lane labels and actual process already disagree in the sample.

## Method

```bash
# per-repo association census
jq -r '[.epics[]|select(.planPath)]|length' .conductor/state.json
jq -r '[.epics[]|select(.gateReview.gate2.verdict=="pass")]|length' .conductor/state.json

# gate coverage
jq -r '[.epics[]|select(.lane=="openspec" and .status=="archived")]|length' .conductor/state.json

# spec recoverability
ls -d openspec/changes/archive/*"$epic_id"
```

Repos enumerated with `fd -H -t f state.json --glob '*/.conductor/state.json'` under
`~/Documents/Repos`, filtered to exclude Highway.

## What this is for

1. Evidence base for the lifecycle spec (spec → plan → epic → story → delivered chain).
2. Baseline for the retrospective audit of the 42 ungated archives.
3. The first row of a measurement series — the intent is to re-run this and watch the numbers
   move, and eventually to publish them rather than only cite them internally.

---

## Recomputed on the archive-directory denominator — 2026-08-23

The lane-based count above undercounts. `lane == "openspec"` counts epics *labelled* openspec;
it misses changes that went through the full OpenSpec workflow under another lane label, and it
cannot see a change that was never registered at all. The physical artifact — a directory under
`openspec/changes/archive/` — is the honest denominator for "work that went through the OpenSpec
process".

| Repo | archive dirs | openspec-lane epics | indexed | **unindexed** | gate2 |
|---|---|---|---|---|---|
| personal-finance-paper | 34 | 15 | 18 | **16** | 0 |
| personal-finance | 24 | 18 | 16 | **8** | 0 |
| job-search-agent | 9 | 2 | 2 | **7** | 1 |
| virtual-mic | 9 | 4 | 4 | **5** | 1 |
| agent-dm | 4 | 4 | 4 | 0 | 2 |
| knowledge-store | 2 | 2 | 2 | 0 | 0 |
| onvex-meetnexus-backend | 2 | 0 | 0 | **2** | 0 |
| cfdude-plugins | 1 | 1 | 1 | 0 | 0 |
| edd-harness-dev | 1 | 0 | 1 | 0 | 0 |
| pm | 1 | 3 | 1 | 0 | 3 |
| **Total** | **87** | **49** | **49** | **38** | **7** |

### What the recomputation does and does not change

**It does not change the gate conclusion.** Gate 2 coverage moves from **14%** (7/49, lane
denominator) to **8%** (7/87, archive denominator). Both say the same thing: the gate is not
systematically applied. And per #122 the numerator is unreliable in both directions anyway, so
neither figure should be quoted as precise.

**It produces a different and more useful number:**

> **The conductor sees 49 of 87 archived OpenSpec changes — 56%.**

That is a measurement of *pm's own coverage*, not of the gate. Nearly half the OpenSpec work done
in these repositories is invisible to the tool whose job is to know what is in flight and what
shipped. It is the cleanest single statement of the problem #117 describes, and it is not
derivable from the lane-based view at all — the lane view reports 49 of 49 and looks complete.

**Use the archive denominator as the baseline going forward**, so future measurements compare
against something that does not move when a lane label is chosen differently.
