# Design: the archive gate reads the archived work

See `proposal.md` for the Why. The requirements are in `specs/conductor-record/spec.md` and
`specs/gate-integrity/spec.md`. This document records how the work is built, what was measured
before choosing, and what was deliberately left out.

## Context

- `epicProgress()` in `scripts/lib/epic-progress.mjs` resolves progress by precedence: stories,
  then `planPath`, then the openspec `tasks.md`, then none. For an openspec epic whose live
  `tasks.md` is gone, it reads `archivedTasksPath(epic.id)` ONLY when `isArchiveBackfilled(epic)`
  is true. Its comment names the reason, and that reason is now void: "`archiveGate()` documents
  that outstanding work reads zero for an archived epic whose source is gone". This change amends
  that sentence of the spec.
- `outstandingWork()` and `outstandingSummary()` (in `archive-gate.mjs`) are thin readers over
  `epicProgress()`. The handoff entry of `DELIVERED_OBLIGATIONS` branches on
  `outstandingSummary(epic).source === "stories"` for both its `remedy` and its `archiveFlags`.
- The engine has one injected git gateway (`scripts/lib/git-gateway.mjs`: `realGit()` and the
  `GIT_OPERATIONS` table). A guard (`scripts/test/{assert,functional}/git-gateway-guard.test.mjs`)
  derives the exec sites from source, and the table must match them. The assertion half's double
  (`scripts/test/fixtures/fake-git.mjs`) answers from a frozen capture
  (`fixtures/git-gateway-capture.json`). In the assertion half, the root is never a repository, so
  every operation answers the `noRepository` failure there.
- `archive-gate.mjs` may import only `constants.mjs`, `epic-progress.mjs`, `disposition.mjs` and
  `git.mjs` (its header).
- **Landing constraint.** The 0.50.0 wave before this one edits `epic-progress.mjs`, `add-epic.mjs`,
  `update-epic.mjs` and `constants.mjs`. Every task cites symbols and never line numbers, and the
  first implementation task re-reads those files from disk.

### Measured on 2026-09-25, before any design choice

The script is in the proposal session's scratchpad. Re-run it at implementation (task 1.1). Nothing
below is carried forward as a fact.

| Measurement | Result |
|---|---|
| Managed archived openspec epics (no backfill stamp, no stories, no plan) whose archived `tasks.md` exists | 17. Every one renders `0/0` today. |
| ...of which have outstanding work once the archived file is read | 2, both `delivered`: `gate-verdict-withdrawal` 53/54, `archive-gate-reads-what-it-writes` 46/47. Each open task is a Mintlify sync (`8.7` and `5.4`), which is real work, not an unmarked archive task. |
| Epics carrying both inline stories and a checkbox source | 0 of 15 story-bearing epics. |
| Spec-sync comparison (headers only, later-change discharge) against `HEAD` | 17 archived changes, 186 headers, **0 findings**. |
| The same comparison against `3256cc2^` (before the 0.48.0 restore) | Exactly 0.48.0's four lost ADDED headers: store seam, CLI-store parity, fixture snapshots, rung membership. The `node-support-policy` rows in that replay are an artifact: that change's directory exists today but was not archived at `3256cc2^`. |

## Goals / Non-Goals

**Goals**

- One definition of outstanding work that no source can hide: archived tasks, and stories plus
  tasks.
- A standing report whenever a delivered record's archived deltas are absent from the main specs,
  from one definition that two surfaces read.

**Non-Goals**

- **A refusal at the archive transition for unsynced specs.** See D3.
- **Comparing requirement BODIES.** See D4.
- **Mapping an epic to a change directory with a different id.** The key stays the epic's id, as it
  is for `archivedTasksPath()`, `isArchived()` and the heal.
- **Reconstructing a moved plan file.** Plans have no archive convention.
- **Repairing the two live `delivered` records with open tasks.** They are reported truthfully. The
  per-obligation regression check does not refuse updates to them, because the obligation they fail
  was already failing before any update.

## Decisions

### D1. Read the archived `tasks.md` for every epic, keyed on the epic's id

When the live `tasks.md` is absent, `epicProgress()` reads `archivedTasksPath(epic.id)` whatever
the backfill stamp says.

- **Alternative: keep it scoped to backfill.** Rejected. The scope rests on a spec sentence that
  makes the handoff demand inert on the documented path, and the 53/54 and 46/47 records are that
  inertness observed live.
- **Alternative: read the archived path first.** Rejected. The live path is authoritative while the
  change is in flight, and a change can be un-archived and re-proposed under the same id. The
  hazard of live-first is stated rather than hidden: a stale LIVE copy left behind after an archive
  (exactly what `0ffb025` removed for `functional-assertion-test-split`) shadows the archived
  `tasks.md`. That stale copy is itself a defect `sync` and the heal already surface, because the
  change then reads as both live and archived. Detecting it is out of scope here.

**Consequence.** `archived-with-zero-ticked-tasks` becomes able to see these 17 epics. On the
measurement, none of them has zero ticked, so the check gains candidates and no findings. Task 1.1
re-measures this.

### D2. Stories and the checkbox source count together

`epicProgress()` computes the story part and the checkbox part independently and sums them.

- `excluded` is the sum of disposed stories and lifecycle-declared tasks.
- `excludedLabel` names both kinds when both are non-zero, so `bar()` never calls a disposed story
  "lifecycle".
- `source` stays a single value when one part contributes and becomes a two-part value (for example
  `stories+openspec`) when both do.
- A new field lists the parts, so a consumer tests membership rather than equality.

**Every consumer of `source` is re-derived in the same commit** (task 2.3 enumerates them with `rg`):

- `outstandingSummary`: `items` lists the open stories whenever the story part contributes;
- the handoff's `remedy`: it offers `--story <n> --done` when stories contribute;
- the handoff's `archiveFlags`: it offers `--carried-to` when the checkbox part has open tasks;
- `bar()`;
- the regression refusal's printed-invocation rule for `--carried-to`, in gate-integrity: "if and
  only if the record ... has a checkbox task source whose open tasks break the handoff demand". That
  wording stays true under the union, and the implementation must test the checkbox part's open
  count, not `source`.

**Alternative: refuse to switch source.** This means refusing `--add-story` on an epic with a
checkbox source, and the reverse. Rejected for three reasons:

- it guards the writers only (`add-epic`, `add-many`, `update-epic --add-story`, plus the inverses
  `--plan` and `--lane openspec` on a story epic), and three of those files are in the preceding
  wave's scope;
- it leaves every existing record that holds both parts reading one of them;
- over-counting is the visible error direction, and `conductor-record` already chooses it.

**The missing-source warning** follows the checkbox part alone. A story no longer silences a
missing `tasks.md` on an openspec epic that is not archived. On the measurement, no live epic
changes.

### D3. Specs-synced is a standing condition, not a delivered obligation

The brief for this change placed the check in `archiveGate()` / `deliveredObligations()`. It lives
beside `ungatedArchives()` instead, as a standing condition that `integrity` and the briefing both
read. The reason is a deadlock this repository demonstrably has (memory:
`pm-archive-gate-deadlocks-on-live-record-tests`). pm's own closeout order is:

1. record `delivered`;
2. `openspec archive`;
3. commit.

Every commit here runs tests that assert on the live record, and those tests fail until the release's
epic is archived.

- A refusal reading `HEAD` needs the archive commit before the disposition, but that commit cannot
  land before the disposition.
- A refusal reading the working tree is vacuous on pm's own path, because the change has not moved
  yet when `delivered` is recorded. It would also have PASSED 0.48.0, whose edits sat in the working
  tree.
- Adding the check to `DELIVERED_OBLIGATIONS` would also make it part of the shared definition that
  the archived-epic regression check compares. That would amend a second requirement for no gain:
  an `update-epic` cannot change what the index holds.

The ungated archive is the same argument already shipped as a standing condition in
`gate-integrity`, and this condition is modelled on it.

### D4. Headers only, and a later change discharges in the opposite direction

The comparison is set membership over requirement NAMES, and it follows OpenSpec 1.13.2's delta
grammar (read from `dist/core/parsers/requirement-blocks.js`):

- names are compared case-sensitively after `normalizeRequirementName` (strip a closing `#` run,
  trim);
- lines in code fences are skipped;
- REMOVED also accepts a bulleted header;
- RENAMED is a `FROM:` line followed by a `TO:` line, with an optional `-*+` bullet and optional
  backticks;
- an unpaired line is a finding, not a skip.

The engine re-implements this grammar rather than importing OpenSpec, under the zero-runtime-dependency
law, so a fixture per arm pins it (task 4.1).

**Body comparison was rejected.** Consider "the latest change to touch a header owns its text".
Every later hand-edit to a main spec, such as a sync fix or a typo fix, would then fire forever on an
old archive, and the check would be wrong on routine work. This is the 7-of-8 failure mode the
plan-freshness warning was retired for. The MODIFIED-body gap (0.48.0's three stale blocks) is
DECLARED in the spec as a limit, and is recorded as a declined deferral at archive.

**Order.** "Later" means a strictly later `YYYY-MM-DD` prefix. A same-date or undated pair is
unordered and discharges in both directions. OpenSpec's archive records no finer order, and a
finding that guessed one would report a correct record.

### D5. The main spec is read from the INDEX, through one new gateway operation

**Why the index.** It equals `HEAD` at rest, and between `git add` and `git commit` it is what the
next commit will record. So in the 0.48.0 shape (the archive staged, the specs left out), an
interactive `integrity` or `status` run in that window reports the loss before the commit is made.
The next SessionStart briefing reports it too, instead of two days later. `HEAD` would report every
correct archive as broken until its commit lands. The working tree would pass the 0.48.0 loss
outright.

**What does NOT run it.** The pre-commit hook runs the assertion half, whose git double answers the
no-repository case. The check therefore sees "cannot answer" there and reports nothing, so it
neither blocks nor protects a commit. Wiring it into the hook against real git is a separate
decision, and it is not taken here.

**The operation.** It is `git cat-file --batch`, with one `:<path>` line per capability on stdin,
in ONE process. The briefing reads it at SessionStart, and integrity scans every in-scope epic. A
`show :<path>` per file would be one process each.

- A `missing` line is the definite answer "absent from the index": the spec holds no headers.
- A throw means "cannot answer" (no repository, no git). That yields no findings at all, which
  mirrors how the integrity checks already treat an unanswerable git ("`null` means git could not
  answer at all ... must never be reported as a finding").
- The same `batchCheckCommits` precedent sets `GIT_NO_LAZY_FETCH=1`.

**Where it lives.**

- The operation is in `realGit()` and `GIT_OPERATIONS`.
- A wrapper sits in `git.mjs` (e.g. `indexFileContents(paths) -> Map<path, string|null> | null`).
- The pure comparison and the delta parser go in a NEW module (working name
  `scripts/lib/spec-sync.mjs`), which imports `epic-progress.mjs` (`archivedChanges`,
  `strippedChangeId`) and `git.mjs`. `integrity.mjs` and the briefing import it.
- `git.mjs` is a certified module (it calls `gitOps(`). The new module is not, because it calls only
  the wrapper.

**Testing.**

- **The pure comparison** is on the UNIT rung. Its observable is a value, from delta text and main
  text to findings, with no git.
- **The git read** is FUNCTIONAL, with a hermetic repository that covers:
  - staged but not committed;
  - committed;
  - reset;
  - absent from the index;
  - no repository.
  It has an assertion twin of the same id, edited in the same commit.
- **The double** gains:
  - a `noRepository` answer for the operation. In the assertion half, every existing brief and
    integrity test then sees "cannot answer" and no finding, so no existing assertion moves;
  - an arg-keyed capture entry, refreshed by the capture's own procedure and checked byte-for-byte
    against real git.

### D6. Surfaces

- An integrity check with a stable id (working name `delivered-epic-spec-deltas-absent`).
- A briefing block under its own heading, fed by the same exported function (the
  `ungatedArchives()` pattern), so the two cannot name different sets.
- `status` renders the briefing and inherits the block.
- `unconsidered-outcomes` is NOT extended. It answers "which records carry no considered outcome",
  and these records carry one.

## Risks / Trade-offs

- **[The briefing runs a git process and reads delta files at every SessionStart]** → one
  `cat-file --batch` for all capabilities. The delta files are read only for in-scope epics. Task 5.3
  measures the briefing's wall time before and after.
- **[The index differs from `HEAD` while a user has staged unrelated spec edits]** → the check
  answers "what the next commit records", which is the question that matters. It is documented in
  `commands/status.md`.
- **[The two live delivered epics now render open work]** → correct, and each is a Mintlify task
  that was really left open. Nothing refuses. Task 1.1 re-measures them, and task 1.4
  names them in its commit body so the orchestrator can decide whether to verify the two Mintlify
  pages and correct those records.
- **[The re-implemented OpenSpec grammar drifts from a future OpenSpec]** → a fixture per arm, and a
  comment naming the upstream file and version it was read from.
- **[This change's own id differs from both member epics]** → under D1, neither
  `handoff-demand-blind-spots` nor `gh-cfdude-pm-222` reads this change's `tasks.md`, and the check
  in D3 finds no archived directory for either. This is raised as an open question to the
  orchestrator, not solved by a mapping.

## Migration Plan

No `state.json` schema change and no `MIGRATIONS` entry. Every change is a read-side derivation.
Rollback is a revert of the implementation commits.

## Open Questions

- What happens to the two member epics' progress while this change's id matches neither? The
  orchestrator decides: re-key, register the change id as the carrier epic and supersede the two, or
  link them. It is raised in the proposal report, and it does not change these specs.
