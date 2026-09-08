## Context

Six defects across five capabilities, sharing one root: the state file cannot answer questions
about itself. They ship together because they touch overlapping surfaces — `update-epic`'s flag
handling, the `state.json` epic schema, the integrity reporter, and the emitted rules block — and
because each release costs a 28-repository fleet upgrade, so a release that closes one of these
and leaves the others buys a second propagation for no additional coverage.

Three constraints shape every decision below.

**The engine is zero-dependency and never opens a network connection.** The registration backfill
reads local `git log`, which is read-only and already how the engine reads history elsewhere. It
is not an integration.

**A state file written by 0.39.0 must still load.** Every field this change adds is additive with
a documented absent-value default, and every reader treats absence as unknown rather than
substituting a value.

**The migration runs on repositories that are already wrong.** Six of the 28 carry epics in
`status: "done"`, a value `KNOWN_STATUSES` does not contain. The migration must not assume a
well-formed input, and must not repair one either.

## Goals / Non-Goals

**Goals:**

- An epic can be asked how long it has existed, and answers "unknown" honestly where it cannot.
- An epic in an undefined status is visible, along with the consequence that it is exempt from
  every terminal rule.
- The undispositioned archive is enumerable with a per-epic remedy.
- Every nullable field an update surface can set, it can unset — or the spec names why not.
- The emitted call-site sweep obliges the inverse operation, so this class stops shipping.
- `sync` can be previewed.

**Non-Goals:**

- **The recurring grooming pass is not in this change.** It depends on the clock this change
  introduces, and designing a repeatable staleness pass against a field that does not exist yet
  would produce a spec written from assumption. It is registered separately and follows.
- **No automatic repair of undefined statuses or missing dispositions.** Which legal status an
  undefined one should become, and what outcome an ended epic had, are judgments about what
  happened to the work. An engine that guessed would write a disposition nobody made — the exact
  failure `epic-disposition` exists to prevent.
- **No change to what `startedAt` or `completedAt` mean.** They stay as they are.
- **The engine does not walk the filesystem looking for other repositories.** Fleet-wide discovery
  is a separate registered epic.

## Decisions

### The registration backfill reads git, and leaves absent what it cannot recover

The alternative — stamping the migration's own run time — is worse than doing nothing. It would
record every pre-existing epic as registered on upgrade day, which is not merely imprecise but
actively destroys the signal the field exists to carry, and does so invisibly, because a plausible
date is indistinguishable from a real one.

`git log -S'"<id>"' -- .conductor/state.json` returns the commit that first introduced an epic's
id into the tracked state file. Verified against three ids in this repository spanning 2026-07-15
to 2026-08-25. Where the state file is untracked, the history is shallow, or the id predates the
tracked history, the field stays absent — and absence means unknown at every reader.

**Trade-off accepted:** the backfill is O(epics) subprocess calls on a one-time migration. At 143
archived epics in the largest repository this is seconds, and it runs once.

### `touchedAt` advances on content change, not on save

The engine already has a save-that-changes-nothing path (`state-write-guard`: *"A save that
changes nothing writes nothing"*). Advancing `touchedAt` on every save would make every render and
every hook look like activity, which would make the field useless for exactly the question it
exists to answer. It advances when stored content changes and not otherwise, reusing the existing
comparison rather than introducing a second notion of "changed".

### Clearing is one uniform mechanism, not eight flags

Eight nullable fields currently have one clearing flag between them. Adding a second flag for a
second field would reproduce, inside the fix, the defect being repaired.

Two shapes were considered. A per-field `--clear-<field>` flag family is discoverable in `--help`
and reads naturally, but it is eight new registry entries that must each be remembered when a
ninth nullable field is added — the same growth problem, deferred. A single `--clear <field>`
taking the field name is one registry entry that covers every nullable field including future
ones, and it fails loudly on a field that is not nullable.

**Chosen: `--clear <field>`, repeatable.** The decisive argument is that the failure mode of the
flag family is silent (a new field simply has no clearing flag and nobody notices), while the
failure mode of the single flag is loud (an unrecognised field name exits non-zero naming it).
This release exists because silent omissions ship.

### `--link` appends, and the existing clearing form is how you empty it

`--link` currently assigns. Two relationships recorded in separate invocations silently lose the
first, which is a destructive default under a non-destructive name. Appending with de-duplication
on the pair `(type, target)` makes the operation match its name; `--clear-links` remains the
documented way to empty the list and is named differently enough that neither is reachable by a
typo in the other.

**Backward compatibility:** a single `--link` on an epic with no links is unchanged. An invocation
that today relies on `--link` to *replace* would now add — but that behaviour is undocumented, is
the defect under repair, and the documented replacement path (`--clear-links` then `--link`)
remains exact.

### The integrity check reports the consequence, not just the value

Naming an epic and its illegal status is the easy half and the less useful one. The non-obvious
half — the reason this went unnoticed in six repositories — is that such an epic is non-terminal
to all 25 sites testing for the archived status, so it is invisible to precisely the checks that
would otherwise surface it, and any dependency edge pointing at it reads unsatisfied forever. The
remedy text carries that, because a finding a reader cannot act on is a finding that gets ignored.

### The inverse-operation obligation is a numbered task item

Measured in this repository: a rule carried by a mandatory task section reached 14 of 14
subsequent changes; the same rule written as a prose bullet reached 3 of 15. This one is added to
required task item 1 rather than written as a new bullet anywhere, because the whole point is that
six instances shipped past both gates while the call-site obligation was already in force.

## Risks / Trade-offs

**The migration runs against malformed input.** Six repositories carry epics in an undefined
status. The migration must transform those epics like any other and must not repair them — the new
integrity check reports them, and repair is a judgment. Tested explicitly against a fixture
carrying an undefined status.

**`git log -S` is a subprocess, and subprocess behaviour varies.** A repository with no git, a
detached or bare checkout, or an untracked state file must all degrade to "absent", never to an
error and never to a fabricated date. Each is a test case, and the failure mode of every one of
them is the same benign absence.

**Appending links changes an existing observable behaviour.** It is a fix to an undocumented
destructive default rather than a contract change, but it is the one place in this release where a
caller could notice a difference. Called out here so both gates see it named rather than
discovering it.

**Six items is a large release by this repository's recent cadence** — thirteen shipped in the
eleven days before it. The mitigation is the cross-spec review gate, which exists for exactly this
and which returned 5 Critical and 10 Important on the last release of comparable size, against
specs that had each passed validation and would each have passed a change-scoped review alone.
Five delta specs here means that gate is mandatory, not optional.

**The clock is measured in one place and read in another.** `createdAt` is written by every
creating surface. If a future surface creates an epic without stamping it, that epic reports
unknown forever and nothing complains. The call-site sweep required by this change's own task list
is what catches that, which makes this change its own first test of the rule it adds.
