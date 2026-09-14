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
  `deliveredObligations()` reads `gateReview.gate2` and compares obligations one at a time. So
  withdrawing a covering passing Gate 2 from an archived `delivered` openspec-lane epic is a Gate 2
  regression, and it is refused even where the handoff already fails. The refusal prints the
  invocation that also records a disposition, carrying `--correct-disposition` only where the
  recorded one is agent-recorded.
- **A Gate 1 withdrawal never trips either rule.** Gate 1 is not an archive obligation.
- **Neither does a withdrawal from an archived epic whose outcome is not `delivered`,** including
  the heal's `unknown` stamp. Those epics carry no obligation. The standing condition below reports
  the `unknown` ones, which are in completion scope; `killed`, `superseded` and the other explained
  outcomes owe no Gate 2 and are reported by nothing, correctly.

This change adds no rule to that machinery. It adds wording: wherever either rule's Gate 2 detail
comes from `deliveredObligations()` and `withdrawnGate(epic, 2)` holds, the detail says Gate 2 was
withdrawn and quotes the reason rather than saying it is missing. The spec states that once, in the
withdrawn-state requirement, and the field-write requirement cross-references it.

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
refused. The gate vocabulary is `KNOWN_GATE_NUMBERS`, which today is a module-local constant in
`gate-review-writeback.mjs:11`. It MOVES to `constants.mjs` and both `record-gate-review` and this flag
import it, so it is never typed twice.

It works on **any lane**: `record-gate-review` has had no lane refusal since #163, so any lane can
carry a verdict to withdraw. The heal and the integrity checks stay openspec-lane, as they are today.

## Refusals

All run before any write, in this order, and refusal 1 runs before `loadState`. The order is
normative where it matters: refusals 5 and 6 are evaluated only for gate values that passed 3 and 4
(gate `3` has no stored entry, so it would otherwise also satisfy 5). Refusals 5 and 6 are **disjoint
by definition**: 5 is `gateReview.gateN` absent, 6 is present with verdict `ungated`.

1. **`--withdrawal-reason` with neither withdrawal flag.** Names both flags. The precedent is
   `--done requires --story <n>`.
2. **No reason.** Names `--withdrawal-reason`; `--reason` belongs to the disposition (0.38.0 I1).
3. **A gate other than 1 or 2.** Names `KNOWN_GATE_NUMBERS`.
4. **The same gate twice** in one invocation.
5. **No stored verdict** for the gate. This keeps the flag from becoming a reset lever.
6. **A stored `ungated` verdict.** Keyed on `verdict === "ungated"`, the test `ungatedArchives` uses,
   and NOT on `recordedBy`: conductor-13 asserts no `scripts/lib` module reads `.recordedBy` off an
   epic. An `ungated` stamp is not a review, so recording it as a review taken back is false and would
   relabel "never reviewed" as "withdrawn". It is cleared by recording a real verdict.

## Surfaces, settled one by one

| Surface | After the move | Change |
|---|---|---|
| `deliveredObligations` (Gate 2, `delivered`, openspec) | `!gate2` → fails | Its Gate 2 detail names the withdrawal and quotes the reason. Every caller (the archive gate and the regression check) inherits it |
| `archived-openspec-epic-with-no-gate-1` | fires only with a Gate 2 `pass` | Detail names a withdrawn Gate 1. With BOTH withdrawn it is quiet by its own premise, and the standing condition below covers the epic |
| `ungatedArchives` → `archived-with-no-gate-2-review` and the brief's notice | `ungated` kind only | Returns `{epic, kind, withdrawal}`. The **`ungated` kind is unchanged** in code: `gate2.verdict === "ungated" && inCompletionScope(e)`, no lane or status filter. It is keyed on a stamp that records a bypass, and the stamp stays reported wherever the epic later moves. The **`withdrawn` kind is new and filtered explicitly**: `(e.status === "archived" \|\| isArchived(e.id)) && isOpenspecLane(e) && inCompletionScope(e) && withdrawnGate(e, 2)`. The `isArchived` half exists because `integrity.mjs:201` passes stored epics and `briefing.mjs:218` passes `resolveEpics()` epics, whose status is already resolved against disk; without it the two readers disagree between `/opsx:archive` and the next heal (Gate 1 round 3, lens A). Both readers word the kinds differently. "Archived ungated" is said where ANY Gate 2 withdrawal entry's `superseded` holds an `ungated` stamp, so a second withdrawal cannot hide it. Callers to update for the new return shape: `integrity.mjs:201`, `briefing.mjs:218`, and the intent of `scripts/test/conductor-15.test.mjs:1417` |
| `reconcileArchived` (heal) | `!gate2` → would stamp `ungated` | Skips the stamp when `withdrawnGate(e, 2)`; disposition half unchanged |
| `gate-recorded-as-bookkeeping` | entry gone | None: clearing it for a misplaced verdict is the use case |
| `heal-archived-epic-passed-gate-2`, `delivered-epic-attributed-no-commits` | no `pass` → quiet | None |
| `verdict-range-omits-cited-commits`, `recordedShas` | entry gone → not checked | None. Mirrors `withdrawnCommits`; the decision is written into `recordedShas`'s own "a third holder added later must be added HERE" comment, not only here |
| `render`, `buildBrief` gate tables | an epic whose gates are all withdrawn drops out of `gate1 \|\| gate2` | ONE helper in `archive-gate.mjs` (which defines `stalenessMarking`; `constants.mjs` may not import it) decides which epics appear and renders the cell literal `withdrawn — <reason>`. Both surfaces call it. Each keeps its own row cap (`NEXT_CAP` stays in the brief) |
| `diffEvents` (activity log) | a vanished verdict emits nothing | Emits `gate-withdrawn` **on growth of `withdrawnGateReviews`**, never on a verdict disappearing, so a hand-edit that deletes `gate2` is not logged as an engine withdrawal |
| `activity-report.mjs` GATES section | only collects `gate-review` | Collects `gate-withdrawn`; `activity-log.mjs`'s kind-list comment and `commands/activity.md` name it |
| `stampArchivedOutcomes` | reads `pass` | None; see the assumption above |
| `recordGateReview` | `prior` undefined after a withdrawal | None: re-recording starts clean, asserted |
| `rules.mjs` Reporting item 1 | lists recorded writes | Adds withdrawals |

## The heal

The heal stamps `ungated` onto an openspec-lane epic whose change was archived on disk and whose
Gate 2 is absent. With the entry moved out that condition holds. Left unchanged, the heal would write
a fresh `ungated`, meaning "nobody reviewed this", which is a different and false claim. A stored
`ungated` would also end the withdrawn state, so every surface would word the epic as never reviewed.

So the heal skips the stamp where `withdrawnGate(e, 2)` holds, and `ungatedArchives` reports that
epic as `kind: "withdrawn"`: same standing condition, same clearing path, a truthful record. The
rejected alternative, stamping and rendering the withdrawal beside it, leaves two records disagreeing
about one gate.

**This is the route that produces an archived epic with a withdrawn Gate 2.** Withdraw while the epic
is open, then archive on disk and let the heal run. The heal stamps outcome `unknown`, which is in
completion scope, so the epic is named. "Archived `delivered` with a withdrawn Gate 2" is reachable
two ways. A verb reaches it only from a record whose Gate 2 obligation already failed, for example a
`fail` recorded by `record-gate-review` after archive: the gate refuses it on the way in, and the
per-obligation regression check refuses it from a record whose Gate 2 was met, whatever its handoff.
The heal reaches it by re-archiving an epic that genuinely left the archive and changed, a path
`archive-gate-reads-what-it-writes` hands to `archived-delivered-gate2-regression-report`. Tests reach
the standing condition through the heal route and the recorded-`fail` route, never by writing state
directly.

These change two EXISTING requirements, so the delta carries them as MODIFIED, restated whole:

- **The heal requirement.** Every change against the base, disclosed:
  - The bypass-half bullet adds "only epics whose Gate 2 is not in the withdrawn state", and a new
    paragraph forbids stamping over a withdrawn Gate 2.
  - The first scenario's WHEN narrows from "no passing Gate 2 verdict" to "no `gateReview.gate2` and
    no Gate 2 withdrawal". The narrowing to an absent entry matches the code
    (`epic-progress.mjs:127`), and it removes a latent conflict with "An existing verdict is never
    overwritten", which a stored `fail` satisfied both of.
  - The lane-less scenario's WHEN gains the same absent-entry condition.
  - The non-openspec rationale, in prose and in its scenario, drops the sentence false since #163
    ("`record-gate-review` refuses a verdict to an epic of any other lane") and the "worse than the
    backfill flood" comparison that rested on it. The lane binding still holds, because the lane was
    never owed Gate 2.
  - One new scenario (the withdrawn stamp is skipped). The draft's "unchanged where nothing was
    withdrawn" scenario is dropped as a duplicate of the narrowed first scenario.
- **The standing-condition requirement.** Every change against the base, disclosed:
  - The ungated kind's text adds "in completion scope", matching what `ungatedArchives` has done since
    completion scope was introduced. The base spec's text never said it, and the code does not change.
    The first scenario's WHEN gains the same words.
  - The base sentence "a non-openspec-lane epic is never named by this notice, because it never
    acquires the entry" becomes "…unless it was stamped as openspec-lane and switched lanes
    afterwards". The base sentence was already false once `--lane` could change an archived epic's
    lane (reproduced in Gate 1 round 3); this corrects it, and the code does not change.
  - The clearing paragraph: "SHALL supersede an `ungated` entry" gains "and SHALL end the withdrawn
    state", "the superseded entry MUST remain readable" gains "and the withdrawal", and "supersession
    path" becomes "clearing path", because there are now two notices to clear.
  - It gains the "outside completion scope" paragraph (naming the backfill exclusion
    `inCompletionScope` already applies), the withdrawn kind, the two-filter rationale, the wording
    rules, and seven scenarios.

**Arm 2 of "The archive transition is gated on every path that can reach it"** says the heal records
that it bypassed Gate 2. For an epic with a withdrawn Gate 2 the heal writes no `ungated`. Arm 2 is
still met: the heal's `archive-drift-heal` disposition stamp records how the epic reached `archived`,
and the `withdrawnGateReviews` entry records what happened to its Gate 2. Together they leave nothing
silent, which is the arm's purpose.

**Left as it is, deliberately:** base `gate-integrity` "Every site deciding openspec-lane membership
normalizes an absent lane" still names "`record-gate-review`'s lane refusal" among three sites. That
sentence describes the sites that existed when the requirement was written; its rule ("every site
MUST normalize") is still true, and restating an unrelated requirement to reword history would widen
this change for no behavior. The same false rationale in the code comment at `epic-progress.mjs:123`
IS corrected (task 5.1), because a comment misleads the next person editing that code.

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
  above all the name and signature of `deliveredObligations()`.
