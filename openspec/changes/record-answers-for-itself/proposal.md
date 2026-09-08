## Why

`.conductor/state.json` is pm's state of record, and there is a class of question it cannot answer
about itself. Measured on this machine 2026-09-06/08, over the **working-repo set** — 27 distinct
upstreams, excluding plugin-cache copies of this repository's own state file and counting
`market-intelligence` and its `-dev` worktree once:

- **310 archived epics carry `outcome: unknown`**, written by 0.27.0's migration with no reason
  text, plus **26 epics in `status: "done"`** across five repositories — a value `KNOWN_STATUSES`
  does not contain and that migration never reached. In this repository alone that is **66 of 144**
  archived epics, **46% of the archive**.
- **18 of 20 open epics carried no date of any kind.** The schema has `startedAt`, `completedAt`,
  `externalUpdatedAt` and `disposition.recordedAt`, and nothing recording when an epic was
  *registered* — which is exactly the population a staleness question is about, since an epic
  registered and never started has no other date.
- **Eight nullable fields can be set and never unset.** `--clear-links` is the only clear path on
  `update-epic`; `planPath`, `specPath`, `parent`, `externalId`, `externalUrl`,
  `externalUpdatedAt`, `description` and `reviewMode` are set-only, and `notes` appends with no
  removal path at all.

Each is the record failing to answer a question that a person or an agent then answers by reading
code instead, and the cost is measurable. A grooming pass over this repository's own backlog on
2026-09-07 hit the missing-disposition wall four separate times and reconstructed from commit
history what the record should have stated. A user filed `#173` against work that **had** been done,
because the epic proposing it archived with nothing saying so. `#174` came from another repository
after finding 18 epics silently exempt from every terminal rule.

The set-only fields belong to a defect class this repository has named and measured: a guard added
at one call site while its inverse operation goes untouched. `gh-66` archived `delivered` claiming
*"a test now fails CI if any source-artifact field is settable at creation but not on the update
surfaces"* — and the sweep it refers to, `scripts/test/conductor-20.test.mjs:264-281`, is driven
from `EPIC_SOURCE_ARTIFACTS` and tests set-at-creation against set-on-update while **never testing
unset**. The guard was built along the axis the existing sweep already looks at,
which is why the sweep cannot find this class. Six instances are catalogued.

## What Changes

- **Epics record when they were registered and when they were last touched.** `createdAt` is bound
  to `pushEpic` — the single sink every creation routes through, already carrying the
  `attributedCommits` rule and a source scan forbidding bypass — rather than to an enumeration of
  creation surfaces, which this repository already tried and already watched go stale. `touchedAt`
  is stamped inside `saveState` after its no-op early return, against the disk pre-image already
  read there.
- **Registration dates are recovered from history by a re-runnable verb**, invoked once by the
  0.40.0 migration and available afterwards. Not inside `MIGRATIONS` itself: a one-shot
  transformation that reads disk produces a different result per checkout, which
  `scripts/lib/migrations.mjs:44-48` forbids by name — and two checkouts of one remote on this
  machine differ by two commits touching `state.json`, so a one-shot recovery would freeze a wrong
  answer in one of them permanently.
- **An epic in a status the engine does not define is reported**, mirroring the existing
  unknown-link-type check, and naming the consequence a reader would otherwise miss: the epic is
  exempt from every rule testing for the archived status, and any dependency edge pointing at it
  reads unsatisfied forever.
- **The archive is enumerable by considered outcome**, with an outcome that can be recorded as genuinely
  unreconstructable. The population is `recordedBy` present **and** `outcome: unknown` — which
  deliberately excludes the three epics here whose `delivered` a migration derived from a passing
  Gate 2 verdict.
- **Every nullable field can be unset**, via `--clear <field>` deriving its accepted set from a new
  `nullable: true` marker on the flag registry, so a nullable field added later fails CI
  rather than silently having no clearing form.
- **`--link` appends instead of replacing**, and the six sites documenting replacement change with
  it — including two the engine emits at runtime, whose remedies would otherwise stop remedying.
  `--clear-links` and `--link` stop being mutually exclusive, so the documented repair path stays a
  single atomic write.
- **The call-site sweep obliges the inverse operation**, in `GATE_PROCEDURE_ITEMS[0]`'s `lines`
  **and** its `mustSay` claims, plus the three mirrored surfaces the drift guard reads — because
  the guard iterates `mustSay` only, and amending `lines` alone leaves the suite green while every
  mirror carries the old rule.

No breaking changes to stored data. Every field added has a documented absent-value default, and a
`state.json` written by 0.39.0 must still load. `--link`'s semantics change is a documented
behaviour change and is named in Design's risks.

## Capabilities

### New Capabilities

None. Every change extends an existing capability, which is the correct outcome: this release adds
no new concept, it closes questions the existing concepts already imply.

### Modified Capabilities

- `conductor-record`: epics carry a registration date and a last-touched date, recovered from
  history by a re-runnable operation the release migration invokes once.
- `state-write-guard`: a last-touched stamp must not defeat the no-op save path — the stamp happens
  after the identity comparison, not before it.
- `gate-integrity`: an epic whose `status` is outside `KNOWN_STATUSES` is a reported integrity
  finding; the zero-ticked-tasks exclusion list grows to admit `unreconstructable` and `declined`;
  and required task item 1's existing emitted-procedure requirement is extended to oblige the
  inverse operation across every mirrored surface.
- `epic-disposition`: the archive can be asked which records carry no considered outcome, an unreconstructable outcome is
  recordable, and the outcome keyword set grows to admit it. That set also gains `declined`, which
  the engine has accepted since it shipped while the specification's enumeration omitted it — a
  spec-to-code drift repaired here rather than repeated. The matching growth of the zero-ticked
  exclusion list belongs to `gate-integrity`, which owns it.
- `epic-annotation`: clearing is uniform across nullable fields; `--link` appends; and a write that
  changes nothing says so rather than reporting success.

## Impact

**Engine** — `scripts/lib/`: `state.mjs` (`pushEpic`, `saveState`), `constants.mjs` (`nullable`
markers and `--clear`), `update-epic.mjs` (clear paths, `--link` append, the
mutual-exclusion relaxation), `migrations.mjs` (the 0.40.0 entry), the new recovery verb,
`integrity.mjs` (unknown-status check **and** the `--link` remedy text), `links.mjs`
(`unknownLinkTypeMessage`), `rules.mjs`
(`GATE_PROCEDURE_ITEMS[0].lines` and `.mustSay`), `disposition.mjs`, `archive-gate.mjs`.

**Emitted and mirrored surfaces** — `commands/epic.md`, `commands/status.md`,
`skills/conductor/SKILL.md` (the three the drift guard reads), `commands/next.md`, and this repository's own managed `CLAUDE.md` block.

**Schema** — `state.json` epics gain `createdAt` and `touchedAt`. Additive, idempotent,
backward-compatible; a `MIGRATIONS` entry keyed to 0.40.0 that invokes the recovery verb once and
leaves `touchedAt` absent on pre-existing epics rather than stamping upgrade day.

**Tests** — `conductor-20.test.mjs:264-281` — the source-artifact parity sweep driven from
`EPIC_SOURCE_ARTIFACTS`, which is the sweep `gh-66`'s disposition actually referred to — widens from
two fields to the nullable set; `conductor-16.test.mjs`'s
`mustSay` guard must see the new claim; `conductor-13.test.mjs`'s creation-sink source scan covers
`createdAt` by construction; `conductor-14.test.mjs:1049` asserts the old `--link` wording and
changes with it.

**Docs** — `README.md` and the Mintlify site at `pm-plugin.dev` in the same PR cycle.

**Fleet** — 27 upstreams take this on their next `/pm:upgrade`. The backfill costs a measured
85–155ms per epic, so roughly 15–23 seconds on the larger repositories: tens of seconds, not
"seconds". `upgrade` is user-invoked and not hooked, so that is tolerable. The migration must be
safe on the six repositories carrying `status: "done"` epics.
