# Design

## Two halves, and why neither is enough alone

A withdrawal has to satisfy two properties at once, and each half of the design buys one.

**1. Move the entry out of `gateReview.gateN`.** Readers across the engine decide from that field by
truthiness (`if (gates.gate1)`) or by `verdict === "pass"`. They include:

- the archive gate, render and the brief;
- the integrity checks `archived-openspec-epic-with-no-gate-1`, `heal-archived-epic-passed-gate-2`,
  `delivered-epic-attributed-no-commits`, `gate-recorded-as-bookkeeping` and
  `verdict-range-omits-cited-commits`;
- `recordedShas`, and the 0.27.0 migration's `stampArchivedOutcomes`.

Marking the entry in place (`withdrawn: true`) means every one of them must learn to skip it. Each
that does not is a withdrawn `pass` still counting as a pass: the sibling-miss class this repository
names as its dominant defect. Moving the entry makes all of them see no stored verdict with no edit,
which is the **safe** direction, because the obligation reappears.

**2. No stored verdict is not the same as withdrawn.** Moving alone collapses the two. 0.38.0's Gate 2
caught exactly that on `--withdraw-commit`, where an emptied attribution array read
`none-attributed` and archived cleanly. The fix there was a distinct state, refused by name, and this
change does the same one field over.

`withdrawnGate(epic, n)` in `constants.mjs` returns the most recent withdrawal of gate N **when gate
N has no stored verdict** (`gateReview.gateN` absent), else null. Every surface below calls it; none
re-derives it.

A gate with a stored verdict is never withdrawn, whatever its history. Re-recording returns it to
normal, and the withdrawal stays as history in `withdrawnGateReviews`. An `ungated` stamp is a stored
verdict too, so a gate carrying one is reported as `ungated`, never as withdrawn. That makes the two
standing-condition kinds disjoint by construction.

## Bound by the archive gate, through the change it depends on

Gate 1 round 2 showed that the ordering defect found here is not a withdrawal problem.
`update-epic` ran the archive gate before **every** field write of the call. It reproduced as a bypass
through `--lane`, `--attribute-commit`, `--add-story` and `--withdraw-commit`, and as a false refusal
through `--story <n> --done`. It also showed that a mutation on an already-archived epic never meets
the gate at all.

A fix scoped to the two withdrawal flags would leave the rest open, so it was split out as
`archive-gate-reads-what-it-writes`. This change is paused behind it with `--reconcile`. That change
ships two requirements this flag inherits without restating:

- **The gate reads the record the invocation writes.** `--withdraw-gate-review` is a field write like
  any other, placed beside the `--withdraw-commit` block. Combined with `--status archived --outcome
  delivered`, a Gate 2 withdrawal is refused by the gate's Gate 2 demand.
- **An update to an archived `delivered` epic does not break an obligation its archive met.**
  `deliveredObligation()` reads `gateReview.gate2`. So withdrawing a covering passing Gate 2 from an
  archived `delivered` openspec-lane epic is a regression, and it is refused. The refusal prints the
  invocation that also records a disposition, carrying `--correct-disposition` only where the
  recorded one is agent-recorded.
- **A Gate 1 withdrawal never trips either rule.** Gate 1 is not an archive obligation.
- **Neither does a withdrawal from an archived epic whose outcome is not `delivered`,** including
  the heal's `unknown` stamp. Those epics carry no obligation, and the standing condition below
  reports them instead.

This change adds one thing to that machinery: `deliveredObligation()`'s Gate 2 message, when
`withdrawnGate(epic, 2)` holds, says Gate 2 was withdrawn and quotes the reason rather than saying it
is missing.

The `#175`-shaped remedy is one invocation:

```
update-epic <mirror> --withdraw-gate-review 1 --withdraw-gate-review 2 \
  --withdrawal-reason "copied from the change epic; the review is not this epic's" \
  --status archived --outcome superseded --reason "<what replaced it>" \
  --correct-disposition "<why delivered was wrong>" --no-deferrals
```

The gate evaluates the resulting record: `superseded`, with no gates. The Gate 2 demand binds
`delivered` only, so the archive proceeds. `--correct-disposition` belongs there because the prior
`delivered` was agent-recorded. Against an engine stamp it is refused, and the form drops it.

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
- It **differs from the issue's suggestion** (`{gate, verdict, reviewedAt, reason, withdrawnAt}`) on
  purpose. Flattening drops `baseSha`, `headSha`, `artifacts`, `reviewer` and `superseded`, and an
  audit of a withdrawal needs to see exactly what was taken back.
- Append-only, like `withdrawnCommits`. Withdraw, re-record, withdraw again is two entries.
- An emptied `gateReview` is left as `{}`; every reader already tests the gates, not the object.
- Additive and absent-tolerant, so no migration.
- **Assumption, stated:** `stampArchivedOutcomes` (0.27.0) reads a Gate 2 `pass`. In a repo that
  withdraws on a newer engine before its first `/pm:upgrade` past 0.27.0, the migration sees no pass
  and stamps `unknown`. That is the true outcome anyway.

## The flag

`--withdraw-gate-review <1|2>` is **repeatable**. `parseFlags` overwrites any flag not declared
`repeats`, so without it `--withdraw-gate-review 1 --withdraw-gate-review 2` would silently withdraw
only Gate 2, while the read-back checked only Gate 2. That is the `attribute-commit` loss
`constants.mjs` already warns about.

Repeated distinct gates are both withdrawn under the one `--withdrawal-reason`; the same gate twice is
refused. The gate vocabulary comes from an exported `KNOWN_GATE_NUMBERS`, not retyped.

It works on **any lane**: `record-gate-review` has had no lane refusal since #163, so any lane can
carry a verdict to withdraw. The heal and the integrity checks stay openspec-lane, as they are today.

## Refusals

All run before any write, and none is a precondition of another. Refusal 1 runs before `loadState`.
Refusals 5 and 6 are **disjoint by definition**: 5 is `gateReview.gateN` absent, 6 is present with
verdict `ungated`. No input can satisfy both, and the engine checks them in this order:

1. **`--withdrawal-reason` with neither withdrawal flag.** Names both flags. The precedent is
   `--done requires --story <n>`.
2. **No reason.** Names `--withdrawal-reason`; `--reason` belongs to the disposition (0.38.0 I1).
3. **A gate other than 1 or 2.** Names `KNOWN_GATE_NUMBERS`.
4. **The same gate twice** in one invocation.
5. **No stored verdict** for the gate. This keeps the flag from becoming a reset lever.
6. **A stored `ungated` verdict.** Keyed on `verdict === "ungated"`, the test `ungatedArchives` uses,
   and NOT on `recordedBy`: conductor-13 asserts no `scripts/lib` module reads `.recordedBy` off an
   epic. An `ungated` stamp is cleared by recording a real verdict.

## Surfaces, settled one by one

| Surface | After the move | Change |
|---|---|---|
| `deliveredObligation` (Gate 2, `delivered`, openspec) | `!gate2` → fails | Message names the withdrawal and quotes the reason. Every caller (the archive gate and the regression check) inherits it |
| `archived-openspec-epic-with-no-gate-1` | fires only with a Gate 2 `pass` | Detail names a withdrawn Gate 1. With BOTH withdrawn it is quiet by its own premise, and the standing condition below covers the epic |
| `ungatedArchives` → `archived-with-no-gate-2-review` and the brief's notice | `ungated` kind only | Returns `{epic, kind, withdrawal}`. The **`ungated` kind is unchanged**: `gate2.verdict === "ungated" && inCompletionScope(e)`, with no lane or status filter, because only the heal writes that stamp. The **`withdrawn` kind is new and filtered explicitly**: `e.status === "archived" && isOpenspecLane(e) && inCompletionScope(e) && withdrawnGate(e, 2)`. Both readers word the kinds differently, since "no review recorded by anyone" is false for a withdrawn one. A withdrawn entry whose `superseded` holds an `ungated` stamp says so |
| `reconcileArchived` (heal) | `!gate2` → would stamp `ungated` | Skips the stamp when `withdrawnGate(e, 2)`; disposition half unchanged |
| `gate-recorded-as-bookkeeping` | entry gone | None: clearing it for a misplaced verdict is the use case |
| `heal-archived-epic-passed-gate-2`, `delivered-epic-attributed-no-commits` | no `pass` → quiet | None |
| `verdict-range-omits-cited-commits`, `recordedShas` | entry gone → not checked | None. Mirrors `withdrawnCommits`; the decision is written into `recordedShas`'s own "a third holder added later must be added HERE" comment, not only here |
| `render`, `buildBrief` gate tables | an epic whose gates are all withdrawn drops out of `gate1 \|\| gate2` | ONE helper in `archive-gate.mjs` (which already imports `stalenessMarking`; `constants.mjs` may not) decides which epics appear and renders the cell literal `withdrawn — <reason>`. Both surfaces call it. Each keeps its own row cap (`NEXT_CAP` stays in the brief) |
| `diffEvents` (activity log) | a vanished verdict emits nothing | Emits `gate-withdrawn` **on growth of `withdrawnGateReviews`**, never on a verdict disappearing, so a hand-edit that deletes `gate2` is not logged as an engine withdrawal |
| `activity-report.mjs` GATES section | only collects `gate-review` | Collects `gate-withdrawn`; `activity-log.mjs`'s kind-list comment and `commands/activity.md` name it |
| `stampArchivedOutcomes` | reads `pass` | None; see the assumption above |
| `recordGateReview` | `prior` undefined after a withdrawal | None: re-recording starts clean, asserted |
| `rules.mjs` Reporting item 1 | lists recorded writes | Adds withdrawals |

## The heal

The heal stamps `ungated` onto an openspec-lane epic whose change was archived on disk and whose
Gate 2 is absent. With the entry moved out that condition holds. Left unchanged, the heal would write
a fresh `ungated`, meaning "nobody reviewed this", which is a different and false claim. A later real
verdict would then push the withdrawal a level past the one-level `superseded` history.

So the heal skips the stamp where `withdrawnGate(e, 2)` holds, and `ungatedArchives` reports that
epic as `kind: "withdrawn"`: same standing condition, same clearing path, a truthful record. The
rejected alternative, stamping and rendering the withdrawal beside it, leaves two records disagreeing
about one gate.

**This is the route that produces an archived epic with a withdrawn Gate 2.** Withdraw while the epic
is open, then archive on disk and let the heal run. The heal stamps outcome `unknown`, which is in
completion scope, so the epic is named. A verb can reach "archived `delivered` with a withdrawn Gate 2"
only from a record that already failed its Gate 2 obligation, such as a stale verdict. The gate refuses
it on the way in, and the regression check refuses it from a record that met the obligation. Tests
reach the standing condition through the heal route, never by writing state directly.

These change two EXISTING requirements, so the delta carries them as MODIFIED, restated whole:

- **The heal requirement.** Its first scenario gains the withdrawal exception in its WHEN, so the
  kept scenario and the new one cannot disagree on one input. The restatement also corrects a sentence
  false since #163: "`record-gate-review` refuses a verdict to an epic of any other lane". The bypass
  half's lane binding still holds, for the reason that remains true: the heal and integrity do not
  treat a non-openspec lane as owing Gate 2, so an `ungated` entry there would be a condition nothing
  treats as clearable.
- **The standing-condition requirement.** The `ungated` kind keeps today's definition word for word.
  The `withdrawn` kind is added beside it with its explicit filter.

## What this deliberately does not do

- **No `--withdraw-cross-spec-review`.** That verdict is stored against a release with its spec set
  hashed from disk, so a spec change already stales it. Named here so the omission is a decision.
- **No un-withdraw verb.** Re-recording is the way back; an un-withdraw would restore a verdict
  nobody re-asserted.
- **No change to `record-gate-review`'s evidence rules.**
- **No archive-gate rule of its own.** Those belong to `archive-gate-reads-what-it-writes`; restating
  them here would make two capabilities own one rule.

## The inverse of each operation added

- `--withdraw-gate-review` is the inverse of `record-gate-review`; its own inverse is re-recording.
- `withdrawnGateReviews[]` is append-only with no remove, as `withdrawnCommits` is.

## Risks

- **conductor-13's documented-flag test cannot exercise the flag as the harness stands.** It runs
  `init`, two `add-epic`s and `update-epic subject …setup`, and no `update-epic` flag records a gate
  verdict. The harness gains a full-argv `pre` step (`record-gate-review subject --gate 2 …`), rather
  than an entry that asserts the refusal, which that table's own comments rule out.
- **This change's plan depends on another change's shipped behavior.** Its reconcile gate runs on POP
  and re-validates these artifacts against what `archive-gate-reads-what-it-writes` actually shipped,
  above all the name and signature of `deliveredObligation()`.
