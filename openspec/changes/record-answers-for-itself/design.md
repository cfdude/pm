## Context

Five defects across five capabilities, sharing one root: the state file cannot answer questions
about itself. They ship together because they touch overlapping surfaces and because each release
costs a fleet upgrade across 27 distinct upstreams, so a release that closes one and leaves the
others buys a second propagation for no additional coverage.

**This document was rewritten after four fresh-context reviewers returned FAIL.** Three decisions
below reverse what the first draft asserted, and each reversal is marked. The first draft's errors
were all the same shape — a claim about the engine that was never checked against the engine —
which is the class this release exists to reduce.

Four constraints shape every decision.

**The engine is zero-dependency and never opens a network connection.** Six modules already shell
to git, and `scripts/lib/git.mjs:118-125` (`commitDate()`) is the exact idiom the recovery needs,
carrying its own note: *"Local only, per the engine's architectural law — this reads the object
database and contacts nothing."* Reading history adds no new architectural category.

**A migration may not read outside `state`, and that is a *second* law the first draft missed.**
`scripts/lib/migrations.mjs:44-48` states it deliberately: *"a migration that consulted disk would
produce a different result on a machine whose checkout is at a different commit, which is not a
property a one-shot, never-replayed transformation may have."* This is not the network law and
arguing the network law does not answer it.

**A state file written by 0.39.0 must still load.** Every field is additive with a documented
absent-value default, and every reader treats absence as unknown.

**The migration runs on repositories that are already wrong.** Six carry epics in `status: "done"`,
a value `KNOWN_STATUSES` does not contain. It must transform them like any other and must not
repair them.

## Goals / Non-Goals

**Goals:**

- An epic can be asked how long it has existed, and answers "unknown" honestly where it cannot.
- An epic in an undefined status is visible, with the consequence that it is exempt from every
  terminal rule.
- The archive can be asked which records carry no considered outcome with a per-epic remedy.
- Every nullable field an update surface can set, it can unset — declared in one place so a ninth
  field cannot be added silently.
- The emitted call-site sweep obliges the inverse operation.

**Non-Goals:**

- **The recurring grooming pass.** It depends on the clock this introduces; specifying it against a
  field that does not exist yet is how a spec gets written from assumption. Registered separately.
- **A revoke for `set-autonomy` pre-authorization grants.** The Why names it as the most
  consequential instance of the operation-pair class, and it is deliberately NOT fixed here:
  `preAuthorized` is not a field on the epic update surface, so it falls outside `epic-annotation`
  entirely, and a safety surface deserves its own design rather than a rider. Registered as its own
  epic; this release ships the RULE that makes the next one findable.
- **No automatic repair of undefined statuses or missing dispositions.** Both are judgments about
  what happened to the work.
- **Fleet-wide discovery.** Separate registered epic.

## Decisions

### `createdAt` binds to `pushEpic`, not to an enumeration of creation surfaces

**Reversal.** The first draft said "stamp it at every surface that creates an epic" and then
admitted in Risks that a future surface could omit it and nothing would complain.

`scripts/lib/state.mjs:37-46` is *"THE sink every epic creation routes through, and the ONE site
the `attributedCommits` rule is bound to"* — and its docstring records that the enumeration
approach was already tried here and already went stale: *"`add-epic` and `add-many` carried it,
`sync`'s two registration paths did not, and neither consumer complained."* A source scan in
`conductor-13.test.mjs` forbids bypassing it.

Binding `createdAt` there costs one edit, inherits the existing source scan, and removes the
residual risk rather than documenting it. `docs/lessons/bind-rules-to-functions-not-enumerations`
is the lesson this repository already wrote about exactly this.

### `touchedAt` is stamped inside `saveState`, after the no-op return

**Reversal.** The first draft claimed it would "reuse the existing comparison". There is no
comparison at that granularity to reuse. `state.mjs:196-201` is a whole-state boolean run at write
time, after the caller has already mutated the epic, with `revision` as its *only* exclusion.
Stamping before it makes `nextBody` differ unconditionally, the short-circuit never fires, and the
byte-idempotence three shipped tests assert (`conductor-02:40`, `conductor-15:107`,
`conductor-01:80`) breaks for every verb. Per-caller stamping is infeasible at 69 `saveState` call
sites.

The scenario is implementable at exactly one site: stamp **after** the early return, comparing each
epic against its disk pre-image in `currentBody.epics`, which `state.mjs:197` has already read. The
`readJSON(..., {})` fallback is correct on a first save — every epic looks changed and gets
`createdAt == touchedAt`.

This modifies behaviour `state-write-guard` owns, so that capability now carries a delta. The first
draft did not list it, which is how the conflict survived to review.

### The recovery is a re-runnable verb the migration invokes once

**Reversal.** The first draft put the recovery inside `MIGRATIONS`, which `migrations.mjs:44-48`
forbids for a disk-reading transformation, and then froze the wrong answer with a test asserting a
second run changes nothing "including the epics it left absent."

The named instance is on this machine. `~/Servers/market-intelligence` (detached, 158 commits
touching `state.json`) and `~/Servers/market-intelligence-dev` (160) are two checkouts of one
remote. The detached one sees strictly less history, so `git log -S` returns a date in one and
permanent absence in the other for the same epic id — and a one-shot migration keyed to `pmVersion`
never recovers when that checkout fast-forwards.

A re-runnable verb, invoked once by the 0.40.0 entry and available afterwards, fixes it. The
never-overwrite and idempotence properties the spec already requires are exactly what makes
re-invocation safe. Absence stays re-attemptable rather than frozen.

The migration itself leaves `touchedAt` absent on every pre-existing epic — the same treatment
`createdAt` gets and for the same reason. The migration's own write must not advance it, or every
epic in the fleet reads "last touched: upgrade day", which is precisely the signal destruction this
design rejects for the sibling field.

**Cost, measured, not estimated:** 25ms/epic against this repository's real history — roughly 4.5s
for its 176 epics. An earlier reading of 85ms/epic (155ms on a larger repository) was taken while
four test suites were running concurrently and was conservative by 3x. `upgrade` is user-invoked and not hooked (`conductor.mjs:263`), so
it is tolerable, but it is not free.

The invocation uses `execFileSync` with an argv array, never a shell string:
`scripts/lib/git.mjs:141-142` states the rule, and epic ids read from an existing `state.json` may
predate the `^[a-z0-9][a-z0-9._-]*$` validation `add-epic.mjs:345` now applies.

### `--link` appends, and the six sites that document replacement change with it

**The first draft called replacement "undocumented". It is documented in six places, two of which
the engine emits at runtime**, and under append both emitted remedies stop working:

- `scripts/lib/links.mjs:76-83` tells a user to fix an unknown link type by *"pass the corrected
  type… rather than re-passing the old one"*. The corrected type is a different `(type, target)`
  pair, so dedup does not collapse it — the malformed link stays, and the very
  `link-of-unknown-type` finding the message remedies persists forever.
- `scripts/lib/integrity.mjs:387-388` carries the same instruction inside the finding's own detail.
- Plus `commands/epic.md:189,321,329`, `commands/next.md:43`, `update-epic.mjs:49-51`, and an
  assertion at `conductor-14.test.mjs:1049`.

An emitted command that no longer runs as written violates a shipped requirement
(`tracker-sync/spec.md:596`). All six change in this release.

**And the documented repair path is not currently atomic.** `update-epic.mjs:134-137` makes
`--clear-links` and `--link` mutually exclusive in one invocation, so "clear then re-add" is two
writes with a zero-link window, and a `parseLinkFlags` rejection on the second leaves the epic with
no links at all. This release relaxes that exclusion so `--clear-links --link a --link b` is one
atomic replace — which is what preserves the repair path append would otherwise remove.

### `--clear <field>` requires a declared nullable set, and that declaration is the decision

**The first draft's deciding argument was wrong.** It chose the single flag over a `--clear-<field>`
family because "the failure mode of the flag family is silent while the single flag's is loud." But
no nullability declaration exists — `EPIC_FLAGS` rows carry `flag`, `key`, `commands`,
`placeholder`, `repeats`, `write`, `requires` and nothing else — so a nullable field added
later gets no clearing form under *either* shape, silently. The argument did not hold.

The real decision is the declaration: add `nullable: true` to the relevant `EPIC_FLAGS` rows. Once
it exists, `--clear <field>` derives its accepted set from the registry, the test derives its
coverage from the same place, and a new nullable row without a clearing path fails CI. That one
edit settles the design argument, makes the spec's "or name why it is set-only" enforceable as a
`setOnly: "<reason>"` property rather than unfalsifiable prose, and resolves the namespace fork —
`constants.mjs:200-202` warns that `flag` (`external-id`) and `key` (`externalId`) are two
namespaces, and `--clear` takes the **flag** spelling, because that is what a user reads in `--help`.

`--clear` is repeatable, and `repeatableFlagNames()` is global across subcommands
(`constants.mjs:632-638`). `--clear` already exists as a valueless flag on `set-lane-routing`
(`constants.mjs:461`), which survives only because `lane-routing.mjs:37` tests truthiness rather
than `=== true`. That call site is named in the sweep.

### The integrity check reports the consequence, not just the value

Naming an epic and its illegal status is the easy half. The non-obvious half — why this went
unnoticed in six repositories — is that such an epic is non-terminal to every rule testing for the
archived status, so it is invisible to precisely the checks that would surface it, and any
dependency edge pointing at it reads unsatisfied forever (`dependency-order.mjs:41`), so the epic
ITSELF absorbs the effective priority of everything depending on it — `:80-99` propagates from the
dependent into the blocker, which is the opposite of what this design first asserted and was caught
only when the check was implemented, after three review rounds had read the sentence. The remedy text carries that.

The spec states this as "every rule that tests for the archived status" with no number. A count
would be wrong within a release: measured today it is 24 code sites for `=== "archived"` plus 16
for `!== "archived"`, and the narrative's "25" was off by one.

### The unconsidered population excludes evidence-based stamps

**Corrected.** The first draft's predicate was "stamped by a migration", which returns 69 here, not
the 66 claimed — because three epics carry `delivered` written by the migration *from a passing
Gate 2 verdict*. Handing an agent those three to re-dispose would ask it to re-derive what the
record already derived correctly.

The population is `recordedBy` present **and** `outcome: unknown`. Measured: 144 archived, 66
matching, 3 evidence-based `delivered/migration` excluded, 75 agent-recorded.

The "disposition is absent" arm is dropped: `gate-integrity/spec.md:645-649` establishes that
absent is not a state an archived epic reaches, and live data agrees at zero.

### The skipped-records requirement is cut

It appeared in no proposal bullet, no design decision, no Impact line and no task. Forced to a
dilemma it is either redundant with the unknown-status check — which already reports exactly the
epics `migrations.mjs:124` skipped — or a general unspecified mechanism requiring every migration to
record its predicate, which is a capability, not a clause. It is redundant. Cut.

## Risks / Trade-offs

**A no-op write can still print "updated".** Composing two requirements here produces it: re-supplying
an already-recorded link changes nothing, so no touch, so the whole-state comparison is equal, so
`saveState` early-returns — and the command reports success having written nothing. `--clear` on an
already-absent field is the same shape, and `update-epic.mjs:356` names this defect class by number
(#79). `epic-annotation` now carries a requirement over the WHOLE write surface — whenever the save
reports it changed nothing, the invocation says so. Scoping it to the two paths this change happens
to introduce was the first draft's framing and was itself the defect required task item 1 exists to
catch: setting a field to the value it already holds ALREADY reports a write that did not happen.

**Two spines, and the rider was cut.** Items 1–3 are "the record cannot answer questions about
itself"; items 4–5 are "operations ship without their inverse". A sixth item — a non-writing `sync`
preview — belonged to neither and was cut at Gate 1 on a reviewer's recommendation, after the same
review found its one real complication unaddressed: `sync` calls `render()`, so the specified
"byte-identical state file" would still have rewritten `PROJECT.md` and the render stamp. It is
registered as its own change. Two spines in one release is still a bundling argument rather than a
thematic one, and it is stated openly.

**Appending links changes an existing observable behaviour**, and unlike the first draft's claim it
is a *documented* one. Six sites change with it; the atomic-replace relaxation preserves the repair
path. Named here so both gates see it rather than discover it.

**The migration runs against malformed input.** Six repositories carry epics in an undefined status.
Tested against a fixture carrying one, asserting the migration transforms it and does not repair it.

**Five items is a large release by recent cadence** — thirteen shipped in the eleven days before it.
The mitigation is the cross-spec gate, which returned six BLOCKS on this set's first draft, three of
which no change-scoped review could have found because they were conflicts *between* specs.

**This change is its own first test of the rule it adds.** Required task item 1 gains the
inverse-operation obligation, and this change must satisfy it — including for the operations it adds
itself.
