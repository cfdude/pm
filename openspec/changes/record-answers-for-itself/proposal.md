## Why

`.conductor/state.json` is pm's state of record, and there is a class of question it cannot
answer about itself. Measured across 28 pm-managed repositories on 2026-09-06/07:

- **382 archived epics carry no usable outcome.** 353 hold `outcome: "unknown"` written by
  0.27.0's migration with no reason text; a further 29 sit in `status: "done"` — a status
  `KNOWN_STATUSES` does not contain — and were never reached by that migration at all. In this
  repository alone that is 66 of 143 archived epics, **46% of the archive**.
- **18 of 20 open epics carried no date of any kind.** The schema has `startedAt`,
  `completedAt`, `externalUpdatedAt` and `disposition.recordedAt`, and no field recording when
  an epic was *registered* — which is exactly the population a staleness question is about, since
  an epic that was registered and never started has no clock at all.
- **Eight nullable fields can be set and never unset.** `--clear-links` is the only clear path
  on `update-epic`; `planPath`, `specPath`, `parent`, `externalId`, `externalUrl`,
  `externalUpdatedAt`, `description` and `reviewMode` are set-only.

These are not separate papercuts. Each one is the record failing to answer a question that a
person or an agent then answers by reading code instead — and the cost is measurable. A grooming
pass over this repository's own backlog on 2026-09-07 hit the missing-disposition wall four
separate times and had to reconstruct from commits what the record should have stated. A user
filed `#173` against work that **had** been done, because the epic proposing it archived with
nothing saying so. `#174` was filed from another repository after finding 18 epics silently
exempt from every terminal rule.

The dominant defect class behind the set-only fields has a name here and a measured cost: a
guard added at one call site while its inverse operation goes untouched. `gh-66` archived
`delivered` claiming *"a test now fails CI if any source-artifact field is settable at creation
but not on the update surfaces"* — and `scripts/test/conductor-23.test.mjs` tests set-at-creation
against set-on-update and **never tests unset**. The guard was built along the axis the existing
sweep already looks at, which is precisely why the sweep cannot find this class. Six instances
are now catalogued, and the most consequential is a safety surface: `set-autonomy` grants are
append-only with no revoke, and `--level off` leaves `preAuthorized` intact, so re-enabling
autonomy silently restores every prior grant.

## What Changes

- **Epics record when they were registered.** `createdAt` at registration and `touchedAt` on any
  mutation, with a migration that backfills real dates rather than nulls: `git log -S'"<id>"' --
  .conductor/state.json` recovers the registering commit's date in any repository that commits
  `.conductor/`, verified against three ids spanning 2026-07-15 to 2026-08-25.
- **An epic in a status the engine does not know is reported.** A new integrity check mirroring
  the existing `link-of-unknown-type`, naming the epic, the status, and the consequence a reader
  would otherwise miss: the epic is silently exempt from all 25 sites that read
  `status === "archived"`, including `dependencySatisfied`, where it would read unsatisfied
  forever and permanently lift effective priority.
- **The undispositioned archive can be walked and repaired.** A surface that enumerates archived
  epics carrying no agent-recorded outcome and emits the per-epic remedy, plus an explicit way to
  record that an outcome is genuinely unreconstructable — because a fabricated disposition is
  worse than an absent one.
- **Every nullable field an epic-writing surface can set, it can unset** — or the spec states why
  not, per field. This is the operation-pair rule applied to its own first instance rather than
  shipping a single `--clear-plan`, which would repeat exactly the miss `#169` re-reports.
- **The call-site completeness sweep covers operation pairs.** The emitted rules block's required
  task item 1 gains the inverse-operation obligation — set/unset, add/remove, append/replace,
  enable/disable — as a numbered required task item, the form measured at 14/14 adoption against
  3/15 for the same rule written as prose.
- **`sync` can be previewed.** `--dry-run` reports the epics a sync would create or update
  without writing, following the shape `purge-logs --dry-run` already proves in this engine.

No breaking changes. Every field added has a documented absent-value default, and a `state.json`
written by 0.39.0 must still load.

## Capabilities

### New Capabilities

None. Every change extends an existing capability, which is the correct outcome here: this
release adds no new concept, it closes questions the existing concepts already imply.

### Modified Capabilities

- `conductor-record`: epics carry a registration date and a last-touched date; the emitted
  required task item 1 obliges an inverse-operation sweep, not only a call-site sweep.
- `gate-integrity`: an epic whose `status` is outside `KNOWN_STATUSES` is a reported integrity
  finding, with its silent-exemption consequence named in the remedy.
- `epic-disposition`: the undispositioned archive is enumerable, and an unreconstructable outcome
  is recordable as such rather than left indistinguishable from one nobody looked at.
- `epic-annotation`: clearing is uniform across the nullable fields rather than existing for
  `links` alone, and `--link` appends rather than replaces.
- `tracker-sync`: `sync` supports a non-writing preview.

## Impact

**Engine** — `scripts/lib/`: `constants.mjs` (flag registry, `KNOWN_STATUSES`), `update-epic.mjs`
(clear paths, `--link` append semantics), `migrations.mjs` (the clock migration and its git
backfill), `integrity.mjs` (the unknown-status check), `subcommands.mjs` (`sync --dry-run`),
`rules.mjs` (required task item 1).

**Schema** — `state.json` gains `createdAt` and `touchedAt` on epics. Additive, idempotent,
backward-compatible; a `MIGRATIONS` entry keyed to 0.40.0. The backfill shells out to `git log`,
which is read-only and already how the engine reads history elsewhere — it opens no network
connection and the architectural law holds.

**Docs** — `README.md`, `commands/epic.md`, `commands/sync.md`, `commands/status.md`, the
`conductor` skill, and the Mintlify site at `pm-plugin.dev` in the same PR cycle.

**Tests** — `scripts/test/conductor-23.test.mjs` gains the unset axis it never had, which is the
regression guard for the class this release is named after.

**Fleet** — 28 repositories take this on their next `/pm:upgrade`. The migration must be safe on
a repository carrying `status: "done"` epics, since six of them do.
