# Design

## Two halves, and why neither is enough alone

A withdrawal has to satisfy two properties at once, and each half of the design buys one.

**1. Move the entry out of `gateReview.gateN`.** Readers across the engine decide from that field by
truthiness (`if (gates.gate1)`) or by `verdict === "pass"`: the archive gate, render, the brief,
`archived-openspec-epic-with-no-gate-1`, `heal-archived-epic-passed-gate-2`,
`delivered-epic-attributed-no-commits`, `gate-recorded-as-bookkeeping`,
`verdict-range-omits-cited-commits`, `recordedShas`, and the 0.27.0 migration's
`stampArchivedOutcomes`. Marking the entry in place (`withdrawn: true`) means every one of them must
learn to skip it, and each that does not is a withdrawn `pass` still counting as a pass — the
sibling-miss class this repository names as its dominant defect. Moving the entry makes all of them
read the gate as absent with no edit, which is the **safe** direction: the obligation re-appears.

**2. Absent is not withdrawn.** Moving alone collapses the two — the defect 0.38.0's Gate 2 caught on
`--withdraw-commit`, where an emptied attribution array read `none-attributed` and archived cleanly.
The fix there was a distinct state refused by name. This change does the same one field over:
`withdrawnGate(epic, n)` in `constants.mjs` returns the most recent withdrawal of gate N **when gate
N is currently absent**, else null. Every surface below calls it; none re-derives it.

A gate with a live verdict is never withdrawn, whatever its history: re-recording returns it to
normal, and the withdrawal stays as history in `withdrawnGateReviews`.

**"Live verdict"** means any stored `gateReview.gateN` entry whose verdict is not `ungated` —
`pass` and `fail` alike, and a Gate 1 recorded with `--artifact` evidence alike.

## Withdrawals run BEFORE the archive gate — on both withdrawal flags

Gate 1 (both lenses) found, and one lens **reproduced on the shipped flag**: `updateEpic` calls
`archiveGate()` before the `--withdraw-commit` block, so the gate reads the epic as it was *before*
the withdrawal. One invocation —
`update-epic os --withdraw-commit <c1> --withdrawal-reason r --status archived --outcome delivered --no-deferrals`
— printed `updated 'os'` and left the epic archived `delivered` with zero attributions, while the
same two steps as separate calls are refused ("attributes no commits, having withdrawn 1"). A new
flag placed "beside the `--withdraw-commit` block, in its order" inherits the bypass.

**Resolution:** both withdrawal blocks — their refusals and their in-memory mutation — move ahead of
`archiveGate()`. The gate then evaluates the record the invocation will actually write. This fixes
the shipped `--withdraw-commit` in the same commit; it is the sibling site, not a follow-up.

**A withdrawal on an epic that is ALREADY archived** does not pass through `--status archived`, so
moving the block alone does not reach it: withdrawing Gate 2 from an archived `delivered`
openspec-lane epic would create the exact record the gate refuses, and only `integrity` would notice.
**Resolution:** when the epic's stored status is `archived` and the invocation does not itself carry
`--status archived`, the withdrawal is refused if the resulting record would fail the archive gate's
obligation for its recorded outcome, and the refusal names the combined form that corrects the
disposition in the same call. The same rule binds `--withdraw-commit`.

That combined form is `#175`'s real remedy, and it becomes one invocation:

```
update-epic gh-cfdude-pm-175 --withdraw-gate-review 1 --withdraw-gate-review 2 \
  --withdrawal-reason "transcribed from the change epic; the review is not this epic's" \
  --status archived --outcome superseded --reason "…" --correct-disposition "…" --no-deferrals
```

Withdrawals apply first, the gate sees `superseded` with no gates — the Gate 2 demand binds
`delivered` only — and the archive proceeds.

## The record

```json
"withdrawnGateReviews": [
  { "gate": 2, "entry": { "verdict": "pass", "reviewedAt": "…", "baseSha": "…", "headSha": "…",
                          "reviewer": "…", "superseded": { … } },
    "reason": "…", "withdrawnAt": "…" }
]
```

- The **whole entry moves**, `superseded` included. Promoting the superseded entry would resurrect a
  verdict nobody re-asserted.
- **Differs from the issue's suggestion** (`{gate, verdict, reviewedAt, reason, withdrawnAt}`) on
  purpose: flattening drops `baseSha`/`headSha`/`artifacts`/`reviewer`/`superseded`, and an audit of
  a withdrawal needs to see exactly what was taken back.
- Append-only, like `withdrawnCommits`. Withdraw, re-record, withdraw again is two entries.
- An emptied `gateReview` is left as `{}`; every reader already tests the gates, not the object.
- Additive and absent-tolerant — no migration.
- **Assumption, stated:** `stampArchivedOutcomes` (0.27.0) reads a Gate 2 `pass`. A repo that
  withdraws on a newer engine before its first `/pm:upgrade` past 0.27.0 is theoretically possible;
  such a repo's migration sees no pass and stamps `unknown`, which is the true outcome anyway.

## The flag

`--withdraw-gate-review <1|2>` is **repeatable**. `parseFlags` overwrites any flag not declared
`repeats`, so `--withdraw-gate-review 1 --withdraw-gate-review 2` would silently withdraw only Gate 2
while the read-back checked only Gate 2 — the `attribute-commit` loss `constants.mjs` already warns
about. Repeated distinct gates are both withdrawn under the one `--withdrawal-reason`; the same gate
twice is refused. The gate vocabulary comes from an exported `KNOWN_GATE_NUMBERS`, not retyped.

It works on **any lane**: `record-gate-review` has had no lane refusal since #163, so any lane can
carry a verdict to withdraw. The heal and the integrity checks stay openspec-lane, as they are today.

## Refusals

All before any write. Each is independent of the others — a scenario for one supplies every other
input valid — so their order is not normative. Reason-alone runs before `loadState`.

1. **No reason** — names `--withdrawal-reason`; `--reason` is the disposition's (0.38.0 I1).
2. **A gate other than 1 or 2** — names `KNOWN_GATE_NUMBERS`.
3. **The same gate twice** in one invocation.
4. **No live verdict** for the gate — keeps the flag from becoming a reset lever.
5. **An `ungated` entry** — keyed on `verdict === "ungated"`, the same test `ungatedArchives` uses, and
   NOT on `recordedBy` (conductor-13 asserts no `scripts/lib` module reads `.recordedBy` off an epic).
6. **`--withdrawal-reason` with neither withdrawal flag** — names both. Precedent: `--done requires
   --story <n>`.
7. **Already archived, and the result would fail its archive obligation** — names the combined form.

## Surfaces, settled one by one

| Surface | After the move | Change |
|---|---|---|
| `archiveGate` (Gate 2, `delivered`, openspec) | `!gate2` → refuses | Message names the withdrawal and quotes the reason |
| `archived-openspec-epic-with-no-gate-1` | fires only with a Gate 2 `pass` | Detail names a withdrawn Gate 1. When BOTH are withdrawn it is quiet by its own premise, and the Gate 2 report below covers the epic |
| `ungatedArchives` → `archived-with-no-gate-2-review` and the brief's notice | keys on `ungated` | Returns `{epic, kind: "ungated" \| "withdrawn", withdrawal}`; **the openspec-lane and `inCompletionScope` filters stay inside it**, so a `superseded`/`killed` epic owes nothing; both readers branch their wording, since "no review recorded by anyone" is false for a withdrawn one. A withdrawn entry whose `superseded` was an `ungated` stamp says so |
| `reconcileArchived` (heal) | `!gate2` → would stamp `ungated` | Skips the stamp when `withdrawnGate(e, 2)`; disposition half unchanged |
| `gate-recorded-as-bookkeeping` | entry gone | None — clearing it for a misplaced verdict is the use case |
| `heal-archived-epic-passed-gate-2`, `delivered-epic-attributed-no-commits` | no `pass` → quiet | None |
| `verdict-range-omits-cited-commits`, `recordedShas` | entry gone → not checked | None — mirrors `withdrawnCommits`; the decision is written into `recordedShas`'s own "a third holder added later must be added HERE" comment, not only here |
| `render`, `buildBrief` gate tables | an epic whose gates are all withdrawn drops out of `gate1 \|\| gate2` | ONE helper beside `gateSummary` decides which epics appear and renders the cell literal `withdrawn — <reason>`; both surfaces call it |
| `diffEvents` (activity log) | a vanished verdict emits nothing | Emits `gate-withdrawn` **on growth of `withdrawnGateReviews`**, never on a verdict disappearing — so a hand-edit that deletes `gate2` is not logged as an engine withdrawal |
| `activity-report.mjs` GATES section | only collects `gate-review` | Collects `gate-withdrawn`; `activity-log.mjs` kind-list comment and `commands/activity.md` name it |
| `stampArchivedOutcomes` | reads `pass` | None — see the assumption above |
| `recordGateReview` | `prior` undefined after a withdrawal | None — re-recording starts clean; asserted |
| `rules.mjs` Reporting item 1 | lists recorded writes | Adds withdrawals |

## The heal

The heal stamps `ungated` onto an openspec-lane epic whose change was archived on disk and whose
Gate 2 is absent. With the entry moved out that condition holds, so unchanged, the heal writes a
fresh `ungated` — "nobody reviewed this", a different and false claim — and a later real verdict
pushes the withdrawal a level past the one-level `superseded` history.

The heal skips the stamp where `withdrawnGate(e, 2)` holds; `ungatedArchives` reports that epic as
`kind: "withdrawn"`. Same standing condition, same clearing path, a truthful record. The rejected
alternative — stamp and render the withdrawal beside it — leaves two records disagreeing about one
gate.

These change two EXISTING requirements, so the delta carries them as MODIFIED, restated whole. The
heal requirement's restatement also **corrects a sentence that has been false since #163**:
"`record-gate-review` refuses a verdict to an epic of any other lane". The lane binding of the bypass
half still holds, for the reason that remains true — no path clears an `ungated` stamp on a lane the
heal and integrity do not treat as owing Gate 2.

## What this deliberately does not do

- **No `--withdraw-cross-spec-review`.** Stored against a release, its spec set hashed from disk; a
  spec change already stales it. Named here so the omission is a decision.
- **No un-withdraw verb** — re-recording is the way back; an un-withdraw restores a verdict nobody
  re-asserted.
- **No change to `record-gate-review`'s evidence rules.**

## The inverse of each operation added

- `--withdraw-gate-review` is the inverse of `record-gate-review`; its own inverse is re-recording.
- `withdrawnGateReviews[]` is append-only with no remove, as `withdrawnCommits` is.

## Risks

- **conductor-13's documented-flag test cannot exercise the flag as the harness stands** — it runs
  `init`, two `add-epic`s and `update-epic subject …setup`, and no `update-epic` flag records a gate
  verdict. The harness gains a full-argv `pre` step (`record-gate-review subject --gate 2 …`), rather
  than an entry that asserts the refusal, which that table's own comments rule out.
- **conductor-15's "every live finding is explained"** trips only if a live epic here gains a
  withdrawal. `gh-cfdude-pm-175` would, if its remedy is run — and that is deferred out of this change.
- **The bypass fix changes shipped behaviour** of `--withdraw-commit` combined with
  `--status archived`. It changes it from wrong to refused; nothing correct is lost.
