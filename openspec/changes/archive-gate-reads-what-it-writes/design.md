# Design

## The rule, in one sentence

The archive gate decides on the record the `update-epic` invocation leaves: its decision is the one
it would make if the invocation's field writes had already been applied.

The claim is scoped to the gate on purpose. Gate 1 lens B pointed out that a stronger version, "one
call is decided exactly as the same flags split into consecutive calls", is false. Refusals that
validate an invocation have no split equivalent (contradictory flags, a story index checked before
`--add-story` appends), and Half 2 below refuses the field-write-only call of a split whose one-call
form is accepted. The gate's rule is the one this change needs, and it holds without exceptions.

| One call | What the gate sees today | After |
|---|---|---|
| `--lane openspec --status archived --outcome delivered` (claude-code, no Gate 2) | the claude-code record → exit 0 | the openspec record → refused |
| `--attribute-commit <descendant> --status archived …` | attributions before the append → exit 0 | stale → refused |
| `--add-story s --status archived …` (stories done) | no outstanding work → exit 0 | outstanding → refused |
| `--withdraw-commit <only> --status archived …` | the attribution still present → exit 0 | attribution-withdrawn → refused |
| `--story 1 --done --status archived …` (last story) | story 1 outstanding → refused | nothing outstanding → accepted |
| `--lane claude-code --status archived …` (openspec, no Gate 2) | the openspec record → refused | the claude-code record → accepted |

The last row is not a loophole. Re-routing an epic out of the openspec lane is a legitimate
correction that two calls already reach.

## Half 1 — the gate runs last

`archiveGate()` moves from `update-epic.mjs:460` to after the `--clear` unset loop. It lands before
the `completedAt` stamp, the claim clear, `activate()` / the `state.active` sync, and `saveState()`.
None of those four reads what the gate decides on. Every refusal between the old and new positions
(the `--withdraw-commit` refusals) still exits before `saveState()`, so a refused call still writes
nothing.

**What the gate reads, checked against `archive-gate.mjs`, and confirmed by Gate 1 lens A:**

- `epic.disposition` and `epic.deferralAssertion`: nothing between the two positions writes them; the
  gate assigns both after it passes.
- `isOpenspecLane(epic)`, `gateReview.gate2`, `gateStaleness()` (`attributedCommits` /
  `withdrawnCommits`): what the move is *for*.
- `outstandingSummary()` → `epicProgress()`: `stories`, `planPath`, `specPath`, the lane. It reads
  `epic.status` too (written at `:521`, before the new position), but only to suppress a
  missing-source `warn`, never a count.

**The announcements.** Exactly three stderr lines print between the old position and the save:

- the sync-ignore tombstone clear (`:534`);
- the rank clear (`:546`);
- the `--clear` `clearNote`s (`:602`).

They go into an `announcements` array that is flushed only once the gate AND the Half 2 check have
passed, before `saveState()`. `claimArtifacts()` → `unignoreArtifact()` mutates memory only, so a
refused call leaves `state.json` byte-identical.

## Half 2 — an archived epic's obligations do not regress

An update to an epic that is already `archived` never reaches the gate. Reproduced:
`update-epic a3 --lane openspec` on an archived `delivered` claude-code epic exits 0 and leaves a
`delivered` openspec-lane epic with no Gate 2.

**When it runs** (it is mutually exclusive with the gate, which needs `--status archived`). All four
conditions must hold:

- the stored status is `archived`;
- `str(f.status) !== "archived"`;
- `str(f.status) === undefined || isArchived(epic.id)`;
- `outcomeOf(epic) === "delivered"`.

The third line is what both Gate 1 lenses found missing from the first draft. `update-epic` ends by
calling `render()`, and `render()` runs `reconcileArchived()`, which re-archives any epic whose change
directory is archived on disk. It keeps the existing disposition and runs no gate. So
`--status queued --attribute-commit <descendant>` on such an epic disabled both the gate and a check
keyed on "no `--status`", and the heal put the epic straight back: archived, `delivered`, stale Gate 2
(reproduced by both lenses). Keying on `isArchived()`, the heal's own predicate imported from
`epic-progress.mjs`, means the check runs exactly when the record will still be archived after the
invocation's render. A genuine unarchive, one with nothing on disk to re-archive it, stays unrefused.

**The comparison:**

```
before = deliveredObligations(snapshot, { carriedTo: snapshot.disposition?.carriedTo })  // failing kinds
after  = deliveredObligations(epic,     { carriedTo: epic.disposition?.carriedTo })
broken = after.filter(o => !before.some(b => b.kind === o.kind))
refuse iff broken.length > 0
```

**Per obligation, not per record** (Gate 1 round 3 on `gate-verdict-withdrawal`). A whole-record
`before === null` test lets an already-failing handoff mask a Gate 2 the invocation breaks. The route
is reachable by verbs: archive `delivered --carried-to z` with a story outstanding, then `remove-epic z`
strips `carriedTo`, and the handoff now fails. From there, a whole-record test would accept withdrawing
the only attribution, or Gate 2 itself.

`snapshot` is `structuredClone(epic)`, taken immediately after lookup and before any mutation. Both
calls read the same disk and git within one invocation, so the comparison is consistent (Gate 1 lens A
confirmed it).

**Why a regression and not a plain re-evaluation.** Plenty of archived `delivered` records already fail
an obligation. Refusing any update to them would freeze `--notes`, `--link` and `--priority` on legacy
records for a defect the update did not cause.

**Why only `delivered`.** It is the only outcome carrying obligations: the Gate 2 demand and the handoff
demand both bind `delivered` only (`archive-gate.mjs:277`, `:320`). The fleet's `unknown` archived epics
and every other outcome are unaffected.

**`deliveredObligations(epic, {carriedTo})`** returns an array of failing `{kind: "gate2" | "handoff", detail}`, empty when met, Gate 2 first. The
Gate 2 block (present, `pass`, not `stale`, not `attribution-withdrawn`) and the handoff block of
`archiveGate()` are extracted into it. `archiveGate()` renders its existing messages from `{kind,
detail}`, byte-identical, so its message tests pass unchanged.

**The regression refusal writes its own message** (Gate 1 lens A I1). The gate's messages open
"cannot archive …" and the handoff remedy names `--carried-to`. On a call without `--status archived`,
`--carried-to`, `--outcome` and `--reason` are silently dropped (update-epic.mjs guards only the three
deferral flags), so quoting that remedy would send the user round the same refusal. The refusal says
the update would break an obligation the archived record met, gives the `detail`, and offers one
command: the printed invocation.

**The printed invocation** is the call's own flags, minus any non-archived `--status`, plus
`--status archived --outcome <outcome> --reason "<why>"`.

- It adds `--correct-disposition "<why the recorded one was wrong>"` **only** when
  `isEngineStamped(epic.disposition)` is false: `correctionError()` refuses to correct an engine stamp.
- It adds the placeholder `<--no-deferrals | --deferral "<epicId>:<section>">` **only** when the epic
  has no `deferralAssertion`. It never prints a bare `--no-deferrals`, which is a claim (required task
  item 6), not a default.
- That command runs the full gate on the record it leaves (Half 1), so it cannot archive anything the
  gate refuses.

Prose may add how to leave the obligation met where that exists (a lane switch can be preceded by
recording Gate 2, which `record-gate-review` has accepted on any lane since #163). It never promises a
command: a Gate 2 withdrawal, for one, cannot leave its own obligation met.

## What this deliberately does not do

Four paths can leave an archived `delivered` record failing an obligation with no gate involved.
Refusing at those sites would falsify the record or block an unrelated operation. The standing
condition is held by the registered epic `archived-delivered-gate2-regression-report` (an integrity check
naming every archived `delivered` epic that fails a delivered obligation), and the paths are:

- **`record-gate-review` recording a `fail` over a `pass`.** A verdict is evidence; refusing a true
  review because the record it leaves is inconvenient would falsify the record.
- **The heal re-archiving an epic that genuinely left the archive and was changed while open.** The
  heal reflects disk and receives no disposition. It keeps the old `delivered` one by an existing
  requirement, and refusing would make the record contradict disk.
- **`remove-epic <receiver>` stripping `disposition.carriedTo`** (`links.mjs:245`) from an archived
  `delivered` epic with outstanding stories. The removal is right, since the pointer would dangle, and
  refusing it would block deleting an unrelated epic.
- **Disk-side task changes** (unticking a plan file). These are not a verb.

Also out of scope:

- **A non-archived `--status` that the heal undoes prints `updated`.** `update-epic <id> --status queued`
  on an epic whose change is archived on disk reports success while the status stays `archived`. That
  is a false-success report on the same verb, pre-existing, and it is held by the registered epic
  `status-write-undone-by-heal-reports-updated`.
- **No change to `add-epic` / `add-many` archived-at-creation.** Those paths are stamped, not gated, by
  an existing requirement.

## The inverse of each operation added

- Moving the gate adds no operation.
- The Half 2 refusal's exits are the printed invocation (which ends at the full gate) and a genuine
  unarchive (whose re-archive through the verb ends at the full gate; through the heal it is the path
  held above).

## Risks

- **An existing test may pin the old ordering.** `rg` at proposal time found no `update-epic` test
  combining `--lane`, `--attribute-commit`, `--add-story` or `--story … --done` with
  `--status archived`. The sweep re-derives it; a test asserting the false refusal is corrected and
  named.
- **A workflow may update archived `delivered` epics.** `--notes`, links and priority touch no
  obligation, and required task item 4 excludes the archive commit from attribution. The full suite and
  this repository's own record are the check.
- **`gate-verdict-withdrawal` builds on both requirements.** It is paused behind this change with
  `--reconcile`, and its reconcile gate re-validates it against what ships here.
