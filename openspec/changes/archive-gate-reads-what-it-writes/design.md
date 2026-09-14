# Design

## The rule, in one sentence

An `update-epic` invocation is decided on the record it leaves. One call is decided exactly as the
same flags split into consecutive calls, field writes first and the archive last.

That sentence settles every case below, in both directions: the bypasses are refused, and the false
refusal is accepted.

| One call | The same flags as two calls | Today | After |
|---|---|---|---|
| `--lane openspec --status archived --outcome delivered` (no Gate 2) | lane, then archive → refused | exit 0 | refused |
| `--attribute-commit <uncovered> --status archived --outcome delivered` | stale → refused | exit 0 | refused |
| `--add-story s --status archived --outcome delivered` | outstanding → refused | exit 0 | refused |
| `--withdraw-commit <only> --status archived --outcome delivered` | attribution-withdrawn → refused | exit 0 | refused |
| `--story 1 --done --status archived --outcome delivered` (last story) | done, then archive → accepted | refused | accepted |
| `--lane claude-code --status archived --outcome delivered` (openspec, no Gate 2) | lane, then archive → accepted | refused | accepted |

The last row is not a loophole. Re-routing an epic out of the openspec lane is a legitimate
correction, already reachable in two calls. The engine refusing it in one call while accepting it
in two protects nothing.

## Half 1 — the gate runs last

`archiveGate()` moves from `update-epic.mjs:460` to after the `--clear` unset loop, and before:

- the `completedAt` stamp,
- the claim clear,
- `activate()` / the `state.active` sync,
- `saveState()`.

None of those four reads what the gate decides on. Every refusal between the old and new positions
(the `--withdraw-commit` refusals) still exits before `saveState()`, so a refused call still writes
nothing.

**What the gate reads, and whether moving it changes the reading.** Checked against
`archive-gate.mjs`:

- `epic.disposition` and `epic.deferralAssertion`: no field write before the gate touches them.
  The gate itself assigns both after it passes.
- `isOpenspecLane(epic)`, `gateReview.gate2`, and `gateStaleness()` (which reads
  `attributedCommits` / `withdrawnCommits`): these are what the move is *for*.
- `outstandingSummary()` → `epicProgress()`: reads `stories`, `planPath`, `specPath` and the lane.
  It also reads `epic.status`, but only to suppress a missing-source `warn`, never a count. So
  writing `status` before the gate changes no quantity the gate refuses on.

**The announcements.** Three stderr lines currently print between the old gate position and the
save. Left in place, a refused call would announce writes that never happened:

- the sync-ignore tombstone clear (`claimArtifacts`),
- the rank clear,
- the `--clear` `clearNote`s.

They go into an `announcements` array and are flushed after the gate (and the Half 2 check) pass,
before `saveState()`.

`claimArtifacts()` mutates `state.ignoredArtifacts` **in memory**: `unignoreArtifact(state, p)`
performs no filesystem write. So a refused call still leaves `state.json` byte-identical.

## Half 2 — an archived epic's obligations do not regress

An update to an epic that is already `archived`, and that does not carry `--status`, never reaches
the gate. Half 1 cannot help it. Reproduced: `update-epic a3 --lane openspec` on an archived
`delivered` claude-code epic exits 0. It leaves a `delivered` openspec-lane epic with no Gate 2, and
`integrity` names it nowhere.

**The check.** Run it when the stored status is `archived`, `--status` is absent, and
`outcomeOf(epic) === "delivered"`. It sits at the same position as the gate (the two are mutually
exclusive, because the gate needs `--status archived`):

```
before = deliveredObligation(snapshot, { carriedTo: snapshot.disposition?.carriedTo })
after  = deliveredObligation(epic,     { carriedTo: epic.disposition?.carriedTo })
refuse iff before === null && after !== null
```

`snapshot` is `structuredClone(epic)`, taken immediately after the epic is looked up and before any
mutation. Node 18 ships `structuredClone`, so the zero-dependency rule holds.

**Why a regression and not a plain re-evaluation.** Plenty of archived `delivered` records already
fail an obligation: every migration-era epic, and every epic archived before a rule existed. Refusing
any update to them would freeze `--notes`, `--link` and `--priority` on legacy records for a defect
the update did not cause. The check refuses only what the invocation breaks.

**Why only `delivered`.** It is the only outcome that carries obligations. The Gate 2 demand and the
handoff demand both bind `delivered` only (`archive-gate.mjs:277`, `:320`). The fleet's 353
`unknown` archived epics, and every `superseded` / `killed` / `abandoned` / `declined` /
`unreconstructable` one, are unaffected.

**`deliveredObligation(epic, {carriedTo})`** is the Gate 2 block (present, `pass`, not `stale`, not
`attribution-withdrawn`) and the handoff block of `archiveGate()`, extracted verbatim. It returns the
first failing message, or null. `archiveGate()` calls it for `outcome === "delivered"`, so its
messages stay byte-identical and the check cannot drift from the gate. A git that cannot answer reads
`unknown` staleness in both, and neither refuses on it.

**The remedy names what fits the provenance.** `correctionError()` refuses to correct an engine
stamp ("an engine stamp is replaced by recording an outcome the ordinary way"). So naming
`--correct-disposition` unconditionally would print a command the engine then refuses.

**The promised command** records the disposition the change implies, in the same call: the same
flags plus `--status archived --outcome <outcome> --reason "<why>"`. It adds `--correct-disposition
"<why the recorded one was wrong>"` **only** when `isEngineStamped(epic.disposition)` is false. It adds
`--no-deferrals` only when the epic carries no `deferralAssertion`. That command then runs the full
gate on the record it leaves (Half 1), so it cannot archive anything the gate refuses.

**Prose, not a command, for meeting the obligation instead.** Whether such an invocation exists
depends on the change. A lane switch can be preceded by recording Gate 2 (`record-gate-review` has
accepted any lane since #163). `--add-story s --story <n> --done` in one call leaves nothing
outstanding. A Gate 2 withdrawal cannot leave its own obligation met at all. A promised command that
does not exist for some changes would be a false instruction, so the spec promises only the one that
always exists.

## What this deliberately does not do

- **`record-gate-review` is not re-gated.** Recording a `fail` over an archived `delivered` epic's
  `pass` breaks the Gate 2 obligation, but a verdict is evidence. Refusing a true review because the
  record it leaves is inconvenient would falsify the record, the opposite of this capability's job.
  No integrity check names that resulting record today either. That gap is registered as its own
  epic, `archived-delivered-gate2-regression-report`, rather than widened into this change.
- **Disk-side changes are not re-gated.** Unticking a plan file of an archived `delivered` epic is not
  a verb. The same follow-up epic covers the standing condition.
- **Unarchiving is not refused.** `--status queued` on an archived epic leaves the archive, and
  re-archiving runs the full gate on the record it leaves. There is no route through.
- **No change to `add-epic` / `add-many` archived-at-creation.** Those paths are stamped, not gated, by
  an existing requirement.

## The inverse of each operation added

- Moving the gate adds no operation.
- The Half 2 refusal's inverse is not refusing. Its two exits are the named remedies and unarchiving,
  each of which ends at the full gate.

## Risks

- **An existing test may pin the old ordering.** `rg` at proposal time found no `update-epic` test
  combining `--lane`, `--attribute-commit`, `--add-story` or `--story … --done` with
  `--status archived`. The sweep re-derives this at apply. A test asserting the false refusal would be
  corrected, not preserved.
- **A workflow may update archived `delivered` epics.** The release checklist attributes nothing after
  archive (required task item 4 excludes the archive commit), and `--notes`, links and priority touch
  no obligation. The full suite and this repository's own record are the check.
- **`gate-verdict-withdrawal` builds on both requirements.** It is paused behind this change with
  `--reconcile`. Its reconcile gate re-validates its artifacts against what ships here.
