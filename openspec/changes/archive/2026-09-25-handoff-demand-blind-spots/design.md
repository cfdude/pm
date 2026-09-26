# Design: the archive gate reads the archived work

See `proposal.md` for the Why. The requirements are in four delta files:
`specs/conductor-record/spec.md`, `specs/gate-integrity/spec.md`, `specs/epic-disposition/spec.md`
and `specs/emitted-instructions/spec.md`. The last two exist because the union (D2) makes two
either/or sentences in those main specs false: an epic with an open story AND an open task is not
cleared by the story remedy alone. This document records how the work is built, what was measured
before choosing, and what was deliberately left out.

## Context

- `epicProgress()` in `scripts/lib/epic-progress.mjs` resolves progress by precedence: stories,
  then `planPath`, then the openspec `tasks.md`, then none. For an openspec epic whose live
  `tasks.md` is gone, it reads `archivedTasksPath(epic.id)` ONLY when `isArchiveBackfilled(epic)`
  is true. Its comment names the reason, and that reason is now void: "`archiveGate()` documents
  that outstanding work reads zero for an archived epic whose source is gone". This change amends
  that sentence of the spec. The same premise is repeated in three code comments that must be
  rewritten with it: `archiveGate()`'s doc comment ("reads zero for an archived epic whose source is
  gone"), the handoff branch inside `archiveGate()` ("A checkbox source cannot be read here at all"),
  and the `archived-with-zero-ticked-tasks` check's comment in `integrity.mjs` (which calls `0/0`
  "the ordinary case" for an archived epic).
- `archivedTasksPath()` and `isArchived()` answer "which archived directory is this epic's" with two
  DIFFERENT matches. `archivedTasksPath()` tries the undated name, then the first
  `strippedChangeId()` match in directory order (the oldest). `isArchived()` tries the undated name,
  then a regex over the LITERAL id. They disagree for an id that itself carries a date prefix, and
  when a change was archived twice.
- `outstandingWork()` and `outstandingSummary()` (in `archive-gate.mjs`) are thin readers over
  `epicProgress()`. The handoff entry of `DELIVERED_OBLIGATIONS` branches on
  `outstandingSummary(epic).source === "stories"` for both its `remedy` and its `archiveFlags`, and
  `archiveGate()`'s own refusal message branches on the same test to choose its remedy text.
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
- **Refusing to let a `--skip-specs` or `killed` later change discharge an obligation.** See D4.

## Decisions

### D1. Read the archived `tasks.md` for every epic, keyed on the epic's id

When the live `tasks.md` is absent, `epicProgress()` reads `archivedTasksPath(epic.id)` whatever
the backfill stamp says.

**One resolver.** `isArchived()`, `archivedTasksPath()` and the spec-sync check (D5) all call ONE
exported resolver (working name `archivedChangeDir(id)`) built on `archivedChanges()` and
`strippedChangeId()`: strip one date prefix from both sides, and among several matches take the
latest date, with an undated directory ranking below every dated one. `conductor-record` states the
rule. `reconcileArchived()` reaches it through `isArchived()`, which is a file the 0.50.0 epic
`drift-heal-leaves-claim-on-archive` also edits (Risks).

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

`epicProgress()` computes the story part and the checkbox source independently and sums them.

- `excluded` is the sum of disposed stories and lifecycle-declared tasks.
- `excludedLabel` names both kinds when both are non-zero, so `bar()` never calls a disposed story
  "lifecycle".
- The vocabulary is `conductor-record`'s: the **story part**, a **disposed story**, and the
  **checkbox source** (a plan file or a `tasks.md`). No artifact says "checkbox part".
- `source` stays a single value when one part contributes and becomes a two-part value (for example
  `stories+openspec`) when both do.
- A new field lists the parts, so a consumer tests membership rather than equality.

**Every consumer of `source` is re-derived in the same commit** (task 2.3 enumerates them with `rg`):

- `outstandingSummary`: `items` lists the open stories whenever the story part contributes;
- `archiveGate()`'s handoff refusal message: its `source === "stories"` remedy branch becomes one
  remedy clause per contributing part, as `epic-disposition` now requires, and its "a checkbox
  source cannot be read here" comment is rewritten, because under D1 it can;
- the handoff's `remedy`: it offers `--story <n> --done` when stories contribute;
- the handoff's `archiveFlags`: it offers `--carried-to` when the checkbox source has open tasks;
- the remedies `integrity` prints for `heal-archived-epic-passed-gate-2` and
  `delivered-release-epic-left-open`, which `emitted-instructions` now requires to name both parts'
  remedies when both contribute;
- `bar()`;
- the regression refusal's printed-invocation rule for `--carried-to`, in gate-integrity: "if and
  only if the record ... has a checkbox task source whose open tasks break the handoff demand". That
  wording stays true under the union, and the implementation must test the checkbox source's open
  count, not `source`.

**Readers of `deliveredObligations()` inherit the union without being edited**, and each must be
checked (task 6.1): `blockedDelivered()` (and through it `unconsidered-outcomes`), `integrity`'s
`heal-archived-epic-passed-gate-2` and `delivered-release-epic-left-open`, `deliveredRegression()`,
and the AMEND commit hook in `subcommands.mjs` that calls `deliveredRegression()`. An archived
`delivered` epic whose handoff obligation newly fails under D1 was ALREADY failing it before any
edit, so `deliveredRegression()` (which compares before and after) does not refuse an update to it.

**Alternative: refuse to switch source.** This means refusing `--add-story` on an epic with a
checkbox source, and the reverse. Rejected for three reasons:

- it guards the writers only (`add-epic`, `add-many`, `update-epic --add-story`, plus the inverses
  `--plan` and `--lane openspec` on a story epic), and three of those files are in the preceding
  wave's scope;
- it leaves every existing record that holds both parts reading one of them;
- over-counting is the visible error direction, and `conductor-record` already chooses it.

**The missing-source warning** follows the checkbox source alone. A story no longer silences a
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
grammar (read from `dist/core/parsers/requirement-blocks.js`). The ADDED requirement in
`gate-integrity` states every rule, and task 4.1 pins each with a fixture. The ones most easily got
wrong:

- the header regex is `^###\s*Requirement:\s*(.+)\s*$` with the `i` flag, so the keyword is
  case-insensitive and `###Requirement:` is a header;
- a closing `#` run is stripped only after a space or tab (`[ \t]+#+[ \t]*$`), so `C#` keeps its `#`;
- a BOM is stripped and CRLF/CR become LF before anything else;
- section titles fold case-insensitively and a repeated title contributes every copy;
- `FROM:`/`TO:` pairs form per section body, never across two copies; an unpaired `FROM:` AND an
  unpaired `TO:` are both findings;
- the MAIN spec counts only headers under its `## Requirements` section, as
  `extractRequirementsSection()` does; the delta counts only headers under a delta section.

An unpaired RENAMED finding needs no git, so it is reported even where git cannot answer. The
no-repository rule suppresses presence and absence findings only (P5 of the cross-spec review).

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

**Any archived change discharges, and that is a declared limit.** The discharging change's epic
outcome is not read, and `openspec archive --skip-specs` leaves no trace. So a later change archived
with `--skip-specs`, or ending `killed`, can clear a real loss. Restricting discharge to delivered
epics would report correct records whenever a discharging change has no epic (the archive predates
the conductor). This is the false-negative direction, declared in the spec.

### D5. The main spec is read from the INDEX, through one new gateway operation

**Why the index.** It equals `HEAD` at rest, and between `git add` and `git commit` it is what the
next commit will record. So in the 0.48.0 shape (the archive staged, the specs left out), an
interactive `integrity` or `status` run in that window reports the loss before the commit is made.
The next SessionStart briefing reports it too, instead of two days later. The working tree would pass
the 0.48.0 loss outright.

**What the index costs, stated.** `HEAD` would report every correct archive until its commit lands.
The index does the same until `git add`: after `openspec archive` rewrites the main specs in the
working tree and before they are staged, a CORRECT archive is reported. The index narrows the window
to the staging step; it does not close it. That window is the reason for D6's `PROJECT.md` decision.

**What does NOT run it.** The pre-commit hook runs the assertion half, whose git double answers the
no-repository case. The check therefore sees "cannot answer" there and reports nothing, so it
neither blocks nor protects a commit. Wiring it into the hook against real git is a separate
decision, and it is not taken here.

**The operation.** It is `git cat-file --batch`, with one `:./<path>` line per capability on stdin,
in ONE process. The briefing reads it at SessionStart, and integrity scans every in-scope epic. A
`show :<path>` per file would be one process each.

- **Paths are `:./openspec/specs/<cap>/spec.md`, resolved from the gateway's `cwd` (the conductor
  root).** A bare `:<path>` resolves from the repository's TOP LEVEL, so in a monorepo whose conductor
  lives in a subdirectory every capability would read `missing` and every header would be reported.
  Verified 2026-09-25 with git 2.55.0 in a scratch repository: from `sub/`,
  `:./openspec/specs/x/spec.md` answers the blob and `:openspec/specs/x/spec.md` answers `missing`.
  (`rev-parse --show-prefix` joined onto the path is the equivalent; `:./` needs no second process.)
- **The output is BYTES.** Each header line is `<oid> blob <size>`, and `<size>` counts bytes. The
  specs hold multi-byte text: all 15 main specs differ between byte and UTF-16 length (measured
  2026-09-25), and `gate-integrity` is 164362 bytes against 163986 characters, so slicing a decoded string by `<size>`
  misreads every file after the first multi-byte one. The operation returns a `Buffer`; the wrapper
  slices by byte offset and decodes each blob as UTF-8 only after slicing.
- **`maxBuffer` is set explicitly** to 256 MiB, the gateway's existing ceiling for `rev-list`. The
  default is 1 MiB and the main specs already total 485045 bytes. An overflow (`ENOBUFS`) is NOT "git
  cannot answer": the wrapper rethrows it, and the check fails loudly rather than reporting nothing.
- A `missing` line is the definite answer "absent from the index": the spec holds no headers.
- The no-repository failure (git exits non-zero because there is no repository, or git is absent)
  means "cannot answer". The wrapper returns `null` for that and for nothing else. That yields no
  presence or absence findings, which mirrors how the integrity checks already treat an unanswerable
  git ("`null` means git could not answer at all ... must never be reported as a finding").
- The same `batchCheckCommits` precedent sets `GIT_NO_LAZY_FETCH=1`.
- **The capture carries bytes.** Every existing gateway operation returns a UTF-8 string, and the
  capture pipeline decodes to strings at three points: `callReal()` in
  `fixtures/git-gateway-repo.mjs` turns any `Buffer` answer into a UTF-8 string, `buildCapture()`
  stores that string (after `rootToToken()`), and the comparator in
  `functional/git-gateway-double.test.mjs` (`callFake()`, `describeDifference()`) compares strings.
  For THIS operation, keyed on its name so no existing entry changes, each of the three keeps the
  `Buffer`: `callReal()` returns it undecoded, `buildCapture()` stores it base64-encoded under an
  explicit encoding tag, `fake-git.mjs` decodes the tag back to a `Buffer`, and the comparator
  compares bytes.
  - **Why the double returns a `Buffer` at all:** the wrapper's byte-offset parse is the thing under
    test, and a string-valued double would never exercise it.
  - **Why base64, stated correctly:** NOT multi-byte text. Valid UTF-8 round-trips losslessly
    through a JSON string (checked 2026-09-25: a multi-byte string decoded, stored and re-encoded is
    byte-equal). Base64 is kept for INVALID UTF-8 only: a blob holding a stray `0xff` byte decodes
    to U+FFFD and re-encodes 3 bytes longer (3 bytes in, 5 out, checked the same day), which would
    shift every later `<size>` frame. A spec file should never hold such bytes, but the capture is
    the one place that must not assume it.

**Where it lives.**

- The operation is in `realGit()` and `GIT_OPERATIONS`.
- A wrapper sits in `git.mjs` (e.g. `indexFileContents(paths) -> Map<path, string|null> | null`).
- **The injection point is named.** The exported comparison (working name
  `specSyncFindings(epics, { readIndex = indexFileContents } = {})`) takes the index reader as a
  parameter, and `integrity` and the briefing both call it with the default. A test hands it a stub
  reader returning a NON-EMPTY map. The verb path reaches git only through `gitOps()`, so a verb-level
  test supplies the operation through the invocation's `io.git` like any other gateway operation.
  Without this, the assertion half's double answers `noRepository`, the check reports nothing, and a
  test comparing two surfaces compares two empty sets.
- The pure comparison and the delta parser go in a NEW module (working name
  `scripts/lib/spec-sync.mjs`), which imports `epic-progress.mjs` (`archivedChanges`,
  `strippedChangeId`) and `git.mjs`. `integrity.mjs` and the briefing import it.
- `git.mjs` is a certified module (it calls `gitOps(`). The new module is not, because it calls only
  the wrapper.

**Testing, by rung.** A test's rung follows what it observes and what its own frame touches. The
unit rung refuses a test that reads or writes a path (`fixtures/fs-work-counter.mjs`), and the
precedent is `unit/conductor-22` and `unit/conductor-03`, which left every `withArchivedChange()`
case on the file rung.

- **UNIT:** the delta parser and the pure comparison (delta text and main text in, findings out,
  no git, no path), and the story-only progress cases.
- **ASSERT (file rung):** anything whose fixture writes an archived change directory or a
  `tasks.md` for the engine to read: 1.2, 1.3, 2.1's checkbox cases, 2.2, 2.3, and
  `specSyncFindings()` called directly with a stub reader over fixture directories.
- **FUNCTIONAL, each with its assertion twin edited in the same commit:** the git read itself
  (staged, committed, reset, absent, multi-byte, subdirectory root, no repository), and every
  verb-level spec-sync case: `integrity` naming the epic, the briefing and integrity reporting the
  same set, the archive transition not refused, the staged-then-reset sequence and the
  archive-to-`git add` window.
- **The double** gains:
  - a `noRepository` answer for the operation. In the assertion half, every existing brief and
    integrity test then sees "cannot answer" and no finding, so no existing assertion moves;
  - an arg-keyed capture entry, refreshed by the capture's own procedure and checked byte-for-byte
    against real git.

### D6. Surfaces

- An integrity check with a stable id (working name `delivered-epic-spec-deltas-absent`).
- **Its remedy runs against an ARCHIVED change.** Neither OpenSpec command can re-apply an archived
  delta: checked 2026-09-25 in a scratch repository, `openspec archive <id> -y` answers "Change
  '<id>' not found" for both the dated directory name and the bare id, and `/opsx:sync` works on
  active changes only. `git checkout <sha> -- openspec/specs/<cap>/spec.md` was rejected too: the
  0.48.0 edits were never committed, so for the case that motivates the check no such sha exists
  (the same scratch run: `git log -S` over the spec's history found none). The printed remedy is one
  sequence: make the main spec's `## Requirements` section hold what the delta requires (copy each
  header reported absent with its block from `openspec/changes/archive/<dir>/specs/<cap>/spec.md`,
  delete each block reported present, rename a RENAMED `FROM` header to its `TO`), then
  `git add openspec/`. In the archive-to-`git add` window the first step is already true, so the
  same sequence clears that case too. The scratch run confirmed the sequence: the index held the
  header afterwards, read through `cat-file --batch` with a `:./` path.
- **Its emitted-instructions builder is constructable, so it is not declared unconstructable.**
  `emitted-invocations`' registry test fails for any `CHECKS` id with no builder, and
  `UNCONSTRUCTABLE` is 0. That functional file's `remedyRepo()` is a hermetic real-git fixture, and
  5.1 already builds this exact condition in one, so a declared "cannot be constructed" would be
  false. The builder declares `prints: "none"`, following the `archived-with-zero-ticked-tasks`
  precedent, because the remedy is an edit plus `git add`, not an engine invocation, and the
  harness follows engine invocations only. `prints: "none"` alone never runs the remedy, so 5.1 adds
  the case that follows it and checks the finding clears.
- A briefing block under its own heading, fed by the same exported function (the
  `ungatedArchives()` pattern), so the two cannot name different sets. Its overflow line points at
  `integrity`, never at `PROJECT.md`.
- **The block is NOT written into `PROJECT.md`.** `render()` embeds `buildBrief(state)` into
  `PROJECT.md`, a tracked file. Decided: `buildBrief()` gains an option that includes the block, which
  `brief()` passes and `render()`'s embedding does not. (`snapshot()` does NOT pass it either — Gate 2
  I3: its `.conductor/brief.txt` is tracked in 14 of 24 fleet repositories, so it is a tracked file too.) The `render` VERB, at its
  command-line dispatch and not inside `render()`, writes the block to its stdout after writing the
  file. `render()` itself runs in-process under `snapshot`, `commit-nudge`, `sync`, `upgrade` and most
  mutating verbs, several of them hooks, so printing there would put the block (and a git process)
  into every one of those outputs; and `render --diff-summary`'s stdout is a machine-read line, so
  it never carries the block. `/pm:status` runs `render`, so status can still show it, but ONLY once
  `commands/status.md` tells the reader to read that output. At HEAD it does not: its procedure step
  says "Then read `PROJECT.md` and summarize for the user", and nothing else. Task 7.1 rewrites that
  step to read the `render` output as well as `PROJECT.md`; until 7.1 lands, a `/pm:status` run
  would print the block and the procedure would not look at it. Why not the file:
  - the condition depends on the INDEX, and a render between `openspec archive` and `git add` would
    write a finding about a correct archive into `PROJECT.md`, which pm's closeout then commits;
  - `PROJECT.md` would change with staging state rather than with the record, which defeats
    `render`'s unchanged-skip and `--diff-summary`;
  - the ungated block belongs in the file because it is a function of `state.json`; this one is not.
- `unconsidered-outcomes` is NOT extended with this check. It answers "which records carry no
  considered outcome", and these records carry one. Its entries DO change under D1 and D2, through
  `blockedDelivered()`, so it is in 1.1's and 8.1's baselines.

## Risks / Trade-offs

- **[The briefing runs a git process and reads delta files at every SessionStart]** → one
  `cat-file --batch` for all capabilities. The delta files are read only for in-scope epics. Task 5.3
  measures the briefing's wall time before and after.
- **[The index differs from `HEAD` while a user has staged unrelated spec edits]** → the check
  answers "what the next commit records", which is the question that matters. Task 7.1 documents it
  in `commands/status.md`, which says nothing about it at HEAD.
- **[The two live delivered epics now render open work]** → correct, and each is a Mintlify task
  that was really left open. Nothing refuses. Task 1.1 re-measures them, and task 1.4
  names them in its commit body so the orchestrator can decide whether to verify the two Mintlify
  pages and correct those records.
- **[The re-implemented OpenSpec grammar drifts from a future OpenSpec]** → a fixture per arm, and a
  comment naming the upstream file and version it was read from.
- **[Shared files with other 0.50.0 epics]** → `drift-heal-leaves-claim-on-archive` edits
  `reconcileArchived()`, which calls `isArchived()`, the function D1's one resolver rewrites; whichever
  lands second re-reads the other's diff. `no-network-law-test-is-weak` adds an allowlist over spawn
  and exec argv; the new gateway operation spawns `git`, which that allowlist must admit, and the new
  exec site is one more row its test sees. `commit-gate-tests-working-tree-not-index` moves the
  pre-commit hook to the index; D5's "the hook does not run this check" stays true either way.

## Migration Plan

No `state.json` schema change and no `MIGRATIONS` entry. Every change is a read-side derivation.
Rollback is a revert of the implementation commits.

## Open Questions

None. The change-to-epic mapping was resolved by RE-KEY (task 0.3): the change id is the carrier
epic's id. `gh-cfdude-pm-222` is already archived `superseded` into the carrier through a
`supersedes` link; cfdude/pm#222 is closed with the ship evidence by task 9.2.
