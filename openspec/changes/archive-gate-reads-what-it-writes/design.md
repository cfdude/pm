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
correction that two calls already reach. The same argument covers a one-call `--clear plan --status
archived --outcome delivered` on an epic whose plan has outstanding tasks: with the plan detached the
source falls through (`epic-progress.mjs:253`), exactly as it does in two calls. The detached plan is
announced, and task 1.6a pins the behavior.

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
- `outstandingSummary()` → `epicProgress()`: `stories`, `planPath`, the lane (for the openspec
  `tasks.md` source). It reads
  `epic.status` too (written at `:521`, before the new position), but only to suppress a
  missing-source `warn`, never a count.

**The announcements.** Three stderr lines print between the old position and the new one (a fourth,
the claim clear, already prints after the new position and only on an accepted archive):

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

**When it runs** (it is mutually exclusive with the gate, which needs `--status archived`). Every
condition reads `snapshot`, never `epic`, because `--status` has already overwritten `epic.status` at
`update-epic.mjs:521` by the time the check runs:

```
outcomeOf(snapshot) === "delivered"
  && str(f.status) !== "archived"
  && (isArchived(id) || (snapshot.status === "archived" && f.status === undefined))
```

The `isArchived(id)` half is what the Gate 1 lenses found missing, twice. `update-epic` ends by
calling `render()`, and `render()` runs `reconcileArchived()`, which re-archives any epic whose change
directory is archived on disk. It keeps the existing disposition and runs no gate. So
`--status queued --attribute-commit <descendant>` on such an epic disabled both the gate and a check
keyed on "no `--status`", and the heal put the epic straight back: archived, `delivered`, stale Gate 2
(reproduced by both lenses). The second time, re-review lens A reproduced the same result starting
from a STORED `queued` epic: unarchive it while nothing is archived on disk, then move its change under
`archive/`, then attribute a descendant. The heal archived it `delivered` with a stale Gate 2, because
the first revision still required stored status `archived`. So `isArchived()`, the heal's own predicate
imported from `epic-progress.mjs`, stands alone: whenever the call's render will archive the record,
the check runs, whatever the stored status. A genuine unarchive, with nothing on disk to archive it,
stays unrefused.

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

**`deliveredObligations(epic, {carriedTo})`** returns an array of failing `{kind: "gate2" | "handoff",
detail}`, empty when met, Gate 2 first. The Gate 2 block (present, `pass`, not `stale`, not
`attribution-withdrawn`) and the handoff block of `archiveGate()` are extracted into it. It does NOT
test the outcome, and it takes `carriedTo` as an argument rather than reading a disposition:
- the gate calls it only for a requested `delivered`, passing the REQUEST's `--carried-to`, because
  the epic has no new disposition yet;
- the regression check calls it only when `outcomeOf(snapshot) === "delivered"`, passing the STORED
  `disposition.carriedTo`.

`archiveGate()` embeds each entry's `detail` in its message, so the withdrawn wording a later change
puts into `detail` reaches both callers, and keeps its own remedy sentences around it. It re-derives
which remedy applies from the epic, as it does today: the staleness state for the three Gate 2 remedies, `summary.source` for the handoff
remedy. So its messages stay byte-identical and its message tests pass unchanged.

**The regression refusal writes its own message** (Gate 1 lens A I1). The gate's messages open
"cannot archive …" and the handoff remedy names `--carried-to`. On a call without `--status archived`,
`--carried-to`, `--outcome` and `--reason` are silently dropped (update-epic.mjs refuses only the three
deferral flags and `--correct-disposition` there), so quoting that remedy would send the user round the same refusal. The refusal says
the update would break an obligation the archived record met, gives the `detail`, and offers one
command: the printed invocation. `detail` is the obligation's finding only (the missing Gate 2, the
uncovered commits, the outstanding stories by name). The remedy sentences stay in `archiveGate()`'s own
message renderer and never reach this refusal.

**The disposition tail is rendered by the existing `dispositionInvocation()`** (`archive-gate.mjs:165`),
extended to take options: the echoed prefix tokens, whether to add `--correct-disposition`, and whether
the epic already carries a deferral assertion. Its comment exists "so no caller types the vocabulary
into a string of its own", and a second renderer would break that. Its options default so that
a call with only `(id)` prints exactly today's text; the new caller passes the options, and gets no
deferral text where the epic already carries an assertion, or the placeholder where it does not. Its
existing callers (`unconsideredOutcomes`, `integrity.mjs:460`) keep their output unchanged: they print a bare
`--no-deferrals` for engine-stamped `unknown` records. That text is a suggestion of a claim this
change would not print, and it is recorded as its own epic,
`disposition-invocation-prints-bare-no-deferrals`, rather than widened into this change, because
changing it moves the integrity report's and the brief's text.

**The printed invocation** is built from the call's raw argument TOKENS, never from parsed flags.
Parsed flags lose shape: booleans parse as `true` (and `--clear-links 'true'` is refused), repeatable
flags become arrays, and an inline `--notes=--x` would re-parse as a flag. The tokens pass through
minus `--status` and every disposition flag with its value (`--outcome`, `--reason`, `--carried-to`,
`--correct-disposition`, the deferral flags). The registry declares only whether a flag is `valueless`, not how many tokens it takes. What counts as a
flag's value is decided the way `requireKnownFlags` walks argv (`add-epic.mjs:158-163`): an inline
`--reason=--x` token carries its own value and drops alone, and a separate next token drops only where
`isFlagToken(next)` is false. A "drop the next token" rule would swallow the flag after an inline
disposition flag, and the re-run would then silently lose that change. The tokens then
gain `--status archived --outcome <outcome> --reason "<why>"`. Each echoed token is single-quoted for a
POSIX shell, with `'` written as `'\''`, so a multi-word or apostrophe-bearing value survives a
copy-paste. The line is printed alone, beginning `  update-epic `, which lets a test tell the command
from the prose. A dropped non-archived `--status` is said out loud: the change directory archived on
disk re-archives the epic, so `activate()` and the status write would not have happened anyway.

- It adds `--correct-disposition "<why the recorded one was wrong>"` **only** when
  `isEngineStamped(epic.disposition)` is false: `correctionError()` refuses to correct an engine stamp.
- It adds the placeholder `<--no-deferrals | --deferral "<epicId>:<section>">` **only** when the epic
  has no `deferralAssertion`. It never prints a bare `--no-deferrals`, which is a claim (required task
  item 6), not a default.
- That command runs the full gate on the record it leaves (Half 1), so it cannot archive anything the
  gate refuses.

Prose may add how to leave the obligation met where that exists (a lane switch can be preceded by
recording Gate 2, which `record-gate-review` has accepted on any lane since #163). It never promises a
command: a Gate 2 withdrawal, for one, cannot leave its own obligation met. The Half 1 handoff refusal's
existing `--story <n> --done` remedy is dead in ONE call with `--add-story` (the index is checked
before the append, `update-epic.mjs:276`); it works as a second call, and this change leaves that
message alone.

## What this deliberately does not do

Four paths can leave an archived `delivered` record failing an obligation with no gate involved.
Refusing at those sites would falsify the record or block an unrelated operation. The standing
condition is held by the registered epic `archived-delivered-gate2-regression-report` (an integrity check
naming every archived `delivered` epic that fails a delivered obligation), and the paths are:

- **`record-gate-review` recording a `fail` over a `pass`, or a `pass` whose `headSha` does not cover
  the attributions.** A verdict is evidence; refusing a true review because the record it leaves is
  inconvenient would falsify the record.
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
- **An archived `delivered` epic cannot gain a story, done or not** (re-review lens A). `--add-story`
  alone is refused by Half 2, and `--add-story s --story <n> --done` in one call fails the story-index
  check, which runs before the append (`update-epic.mjs:276`; `parseStoryFlags` has no done form).
  This is deliberate and not shipped as an inverse. A story added to work already recorded as
  delivered is new work, and new work is a new epic. The honest routes are that new epic, or
  recording the disposition the change implies with the printed invocation.
- The Half 2 refusal's exits are the printed invocation (which ends at the full gate) and a genuine
  unarchive (whose re-archive through the verb ends at the full gate; through the heal it is the path
  held above).
- **It is a ratchet, deliberately** (re-review lens A). The check compares against the record just
  before the call, so on a record that already failed Gate 2 (a `fail` recorded after archive),
  `--lane claude-code` is accepted, because it meets the obligation. `--lane openspec` straight
  afterwards is refused, although it restores the record the check had accepted. That is the intended
  reading, not an oversight. The check holds no history, and the restored record claims `delivered`
  on the openspec lane with a failed Gate 2, which is the false record it exists to stop being
  written anew. The routes back are honest ones: record a passing Gate 2 if a real review passed, then
  switch the lane; or record the disposition the failed review implies with the printed invocation.
  A scenario pins it. `--clear plan` followed by `--plan <p>` with outstanding tasks behaves the same
  way.

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
