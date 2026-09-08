## ADDED Requirements

### Requirement: An epic in a status the engine does not define is reported
The integrity surface SHALL report every epic whose `status` is outside the set of statuses the
engine defines, naming the epic, naming the value it carries, and naming the remedy — the same
shape the existing unknown-link-type check establishes for a stored value that cannot be true.

The finding SHALL state the consequence a reader would otherwise not deduce: an epic in an
undefined status is **non-terminal to every rule that tests for the archived status**, so it is
invisible to the completion-shaped checks and makes the record look cleaner than it is. It SHALL
also state that any dependency edge pointing at such an epic reads unsatisfied permanently, which
lifts the effective priority of everything downstream of it for as long as the value persists.

The check SHALL be read-only and SHALL NOT repair the value it finds. Which legal status an
undefined one should become is a judgment about what happened to the work, and an engine that
guessed would write a disposition nobody made.

#### Scenario: An epic in an undefined status is named with its consequence
- **WHEN** the integrity surface runs over a state file containing an epic whose status is not one
  the engine defines
- **THEN** it reports that epic, the undefined value, the remedy, and the fact that the epic is
  currently exempt from every rule that tests for the archived status

#### Scenario: The check reports and does not repair
- **WHEN** the integrity surface reports an epic in an undefined status
- **THEN** the epic's stored status is unchanged by the check

#### Scenario: A state file with only defined statuses reports nothing
- **WHEN** the integrity surface runs over a state file in which every epic carries a defined
  status
- **THEN** no unknown-status finding is reported

## MODIFIED Requirements

### Requirement: Integrity checks report records that cannot be true

The conductor SHALL expose a read-only integrity check over its own record, reporting each
finding with the epic it concerns and enough detail to act on. Every check below can fail against
today's engine — several on live data in this repository today, the rest constructible from a
fixture. A finding is reported, not repaired: none of these
checks writes state, and none blocks a command other than where a requirement above says so.

Two classes of archived epic are explicitly OUT of scope for the completion-shaped checks below,
because in both the record is working rather than broken, and a check that fires on them trains a
reader to filter it:

1. an epic whose `outcome` is `killed`, `superseded`, `abandoned`, `declined` or
   `unreconstructable` — each carries a required reason explaining why the work did not complete, or
   why what happened to it can no longer be established, and the release's own flagship case is a
   change killed at Gate 1 with 47 tasks and no code written, which is zero-ticked by construction.
   `unreconstructable` belongs on this list for the same reason the others do: an epic whose
   defining property is that the evidence is gone is zero-ticked by construction, and a check firing
   on it forever would be firing on the record working correctly;
2. an epic stamped `recordedBy: "archive-backfill"`, which `conductor-record` requires to register
   with its counts intact, unticked ones included.

**Every other archived epic is IN scope, including one whose `outcome` is `unknown`, and regardless
of lane.** `absent` is not a state an archived epic reaches: the migration stamps every pre-existing
archived epic regardless of lane, and the outcome invariant above binds every one of the five archive
paths going forward, the two creation paths included. A check that had to handle an absent outcome
would be handling a state no path produces.
The exclusion is deliberately written as those two cases rather than as "any
outcome other than `delivered`": `unknown` is the value the engine stamps when nobody was asked, and
its reason is a path name, not an explanation of why the work did not complete — the property the
exclusion above actually rests on. Scoping these checks to `delivered` would make them inert, which
is measurable rather than arguable: this repository holds 68 archived epics, 3 with a passing
Gate 2, so after the migration that stamps `delivered` only where such a verdict exists, a
`delivered`-only zero-ticked check has zero candidates in the repository whose live data this
requirement cites as its evidence.

#### Scenario: A verdict's range does not contain the commits its note cites

- **WHEN** a gate verdict's note names commit shas that are not contained in the range recorded by
  its `baseSha`/`headSha` fields
- **THEN** the check reports the epic, the recorded range and the uncontained shas — the live
  instance in this repository is `platform-parity-mechanism`, whose Gate 2 records
  `d168b1e..04c54c8` and cites `c63efc1` and `3cba2e9`, both descendants of that range

#### Scenario: A gate was recorded as bookkeeping rather than as review

- **WHEN** a gate verdict's `reviewedAt` satisfies **either** arm:
  - the verdict carries **no checkable evidence** (no `baseSha`/`headSha`) **and** falls **after
    the epic's merge commit**, where the merge commit is the last hash in the epic's attribution
    array — and where that array is absent or empty this arm does not apply, because every other
    reading of "merge commit" is either inert on all live epics or fires on essentially all of
    them; **or**
  - it falls **within 60 seconds** of the `reviewedAt` of the epic's other gate verdict
- **THEN** the check reports it as a bookkeeping signature — the audited instance recorded both
  gates 83 seconds after the squash-merge, 47 ms apart, with no notes, and 47 ms is inside the
  60-second bound while a spec review and an implementation review of the same change never are

**Arm 1's evidence exemption is load-bearing, and it was found by this change reporting itself.**
Two obligations this same release ships — attribute each commit *at the moment it is made*, and
record Gate 2 *after* the implementation — together guarantee `reviewedAt >
commitDate(last attributed)` for **every correctly run gate**. Without the exemption the arm
therefore fires on compliance rather than on the defect, which is strictly worse than not shipping
it: measured live the first time this repository satisfied both obligations, the arm reported its
own honest verdict. The audited instances the arm exists for are unevidenced by construction —
they predate the sha fields and were written 83 seconds after a squash-merge with no notes and no
range — so exempting an evidenced verdict removes the false positive without weakening the signal.
Whether an evidenced verdict's range actually REACHES the attributed commits is a different
question, answered by the staleness gate and refused at the archive, never guessed at here.

#### Scenario: An evidenced verdict recorded after the last attributed commit is not a finding

- **WHEN** an epic's attribution array is non-empty and its Gate 2 records `baseSha`/`headSha` and
  a `reviewedAt` later than the last attributed commit's date — the shape the emitted procedure
  produces every time it is followed
- **THEN** the check reports nothing for it, because a verdict that states the range it covered and
  is dated after the last commit in that range is what a real review looks like

#### Scenario: An archived epic with zero ticked tasks is reported

- **WHEN** an archived epic that carries neither an outcome the requirement above excludes nor the `archive-backfill` stamp has a progress source that exists and contains
  checkboxes, none of which are ticked
- **THEN** the check reports the epic and its source — four epics in this repository qualify today,
  archived at `0/17`, `0/99`, `0/37` and `0/34`, none carrying a passing Gate 2 and so none
  `delivered` after the migration. Three of the four are the date-prefixed superpowers-lane
  registrations of ids also held under the openspec lane, which the dual-lane check below reports
  separately once that check keys on the date-prefix-stripped id; the fourth,
  `2026-07-29-platform-aware-rules-block`, is not in the collision set at all, so this check has a
  live candidate that is not an artifact of another finding

#### Scenario: A killed epic with no ticked tasks is not a finding

- **WHEN** an epic is archived with `outcome: killed` and its reason, its 47 tasks all unticked
- **THEN** the check reports nothing for it, because a recorded non-delivered disposition already
  explains the zero and is the record working as designed

#### Scenario: One change is registered under two lanes

- **WHEN** two epics whose ids are equal after stripping a leading `<YYYY-MM-DD>-` date prefix —
  the same normalization `isArchived()` already applies to archive directory names — appear in
  `state.epics` under different `lane` values
- **THEN** the check reports every such pair and the lanes each holds

> Identity for this check MUST be the date-prefix-stripped id, not literal equality. Measured on
> this repository: **zero** ids collide literally, while **four changes** are registered twice —
> `conductor-mjs-module-split` (openspec) against `2026-07-21-conductor-mjs-module-split`
> (superpowers), and the same shape for `platform-parity-mechanism`,
> `epic-hierarchy-orchestration` and `edd-harness-agent-behavior-testing`. A literal-equality check
> reports none of them while claiming four exist — a check that reads as coverage and measures
> nothing, which is the defect class this capability exists to end.

#### Scenario: A heal-archived epic that did pass Gate 2 reads as unknown

- **WHEN** an agent records a passing Gate 2 and then runs `/opsx:archive`, so the change moves on
  disk and the archive-drift heal flips the status and stamps `outcome: unknown` with
  `recordedBy: "archive-drift-heal"` while correctly leaving the existing `gate2` untouched
- **THEN** the check reports that epic — a `delivered`-shaped record wearing an `unknown` outcome

> Without this check the case is invisible everywhere: it gets no `ungated` entry, so the standing
> ungated-archive notice never names it, and its outcome is honestly `unknown` because nobody
> supplied a disposition at the transition. The heal is behaving correctly; what is missing is
> anything that surfaces the mismatch. The remediation is the interactive archive verb run on the
> already-archived epic — the requirement above requires that call to be accepted, and
> `epic-disposition` makes the agent's `delivered` replace the heal's engine stamp — so this check
> is the finding, and that call is the fix. This is the ordinary end of the documented workflow, not
> an exceptional repair.

#### Scenario: A delivered epic with a passing Gate 2 has attributed no commits

- **WHEN** an epic carries `outcome: delivered` and a passing `gate2` (which requires `baseSha` and
  `headSha`) while its attribution array is present and empty
- **THEN** the check reports it

> This is precisely the shape of *the agent ignored the `--attribute-commit` obligation*. The
> staleness gate still behaves correctly — an empty array is not a stale verdict — so without this
> check nothing anywhere reports an unmet emitted obligation, and the obligation becomes advisory
> in the one way that leaves no trace.

#### Scenario: An archive directory has no epic

- **WHEN** a directory under `openspec/changes/archive/` corresponds to no epic in `state.epics`
- **THEN** the check reports the directory as an unrecorded archived change; registering it is out
  of scope here and belongs to the conductor's record-completeness capability

#### Scenario: An unreconstructable epic does not fire the zero-ticked check

- **WHEN** the completion-shaped checks run over an archived epic whose outcome is
  `unreconstructable` and whose tasks are unticked
- **THEN** no zero-ticked finding is reported for it


### Requirement: The emitted gate procedure requires a call-site completeness sweep

The gate procedure pm emits SHALL require, for every rule, guard or invariant a change introduces
or modifies, that the reviewer enumerate all call sites of the thing being guarded, state where
the rule holds and where it does not, and justify each omission.

It SHALL FURTHER require the reviewer to enumerate the **INVERSE OPERATION** of every operation the
change adds or modifies — set against unset, add against remove, append against replace, enable
against disable, grant against revoke — and to name and justify each inverse that is not shipped,
exactly as an unguarded call site must be. A call-site sweep alone cannot find this class, and the
reason is mechanical rather than a matter of diligence: enumerating the callers of a thing that is
written never leads to the question of whether it can be unwritten. Measured in this repository,
six instances shipped past both gates while the call-site obligation was already in force, and the
most consequential is a safety surface — pre-authorization grants that accumulate with no revoke,
where disabling the feature leaves every prior grant intact.

The requirement MUST appear in the emitted procedure as a **numbered required task item**, not as
a prose bullet in a paragraph of review guidance. The acceptable surface is one pm itself owns and
emits — its managed `CLAUDE.md` rules block, the `conductor` skill, and its command docs — because
a change's `tasks.md` is authored by the `openspec` plugin, which pm neither owns nor writes; what
pm controls, and what its own suite can assert, is the text of the procedure it emits and hands
the agent to carry into that task list. The form matters and is measured: across one audited
repository, a rule carried by a mandatory task section reached 14/14 subsequent changes, while the
same rule as a prose bullet reached 3/15. Both gates are diff-scoped and structurally cannot see
an edit that is absent from a file the diff never touched — the dominant defect class in all three
audit shards, ~38 instances in one shard and 5 whole epics that exist only to finish an earlier
epic's rule.

The obligation SHALL reach every mirrored surface, not the generator alone. The mirrors are
deliberately reworded for markdown, so the guard that keeps them in step compares DECLARED
LOAD-BEARING CLAIMS rather than prose; an obligation added to the emitted text without a
corresponding declared claim leaves that guard green while every mirror continues to carry the
older, narrower rule. That failure has been proven live in this repository — a mirror's body was
edited to say the OPPOSITE of the generator and the whole suite stayed green — and it is the same
absent-edit class this requirement exists to prevent, which is why the claim, and not only the
text, is normative.

#### Scenario: The sweep is emitted as a numbered required task item

- **WHEN** pm emits the gate procedure for an openspec-lane change
- **THEN** the emitted text carries the completeness sweep as a numbered required task item, with
  the enumeration it demands named concretely, rather than as advisory prose — assertable directly
  against the text pm emits

#### Scenario: A rule applied at one of several call sites is a finding

- **WHEN** a change introduces a guard at one call site while an identical sibling call site is
  left untouched and the omission is not justified
- **THEN** the emitted procedure directs the reviewer to raise it as a finding rather than as a
  detail, regardless of whether the unedited site appears in the diff

#### Scenario: An operation shipped without its inverse is a finding

- **WHEN** a change adds or modifies an operation that writes a value, and the corresponding
  operation that removes that value is neither shipped nor justified
- **THEN** the emitted procedure directs the reviewer to raise it as a finding

#### Scenario: The inverse obligation reaches the mirrored surfaces

- **WHEN** the mirrored surfaces are checked against the generator's declared load-bearing claims
- **THEN** the inverse-operation obligation is among those claims, and every mirrored surface
  carries it
