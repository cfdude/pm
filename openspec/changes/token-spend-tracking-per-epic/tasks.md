# Tasks

## Commit mechanics

These rules bind every section below.

- **TDD.** Every behaviour task is RED then GREEN. The pre-commit hook runs the whole assertion half,
  so a RED cannot be committed alone. Save the failing run as `red-<task>.txt` in this directory,
  and land the RED and GREEN in ONE commit whose message names that file.
- **Rungs.** A test's rung follows what it OBSERVES (`.claude/agent-startup.md`, the rung table):
  - **UNIT** (`scripts/test/unit/`): values over an in-memory store. That covers:
    - entry parsing, the fold and tier mapping
    - marker parsing and read-time attribution, window and off-interval lookup
    - report aggregation and the JSON shape
    - every refusal
    - what `state` holds after `set-spend-tracking`
    - the `rulesBlock()` string and the `optInLines()` output

    The reader takes parsed lines and the attribution takes rows, so neither needs a path.
  - **FILE** (`scripts/test/assert/`): bytes on disk. That covers:
    - ingest over a fixture transcript tree under a temp `CLAUDE_CONFIG_DIR`
    - the cursor, `rows.jsonl`, `markers.json`, `timeline.jsonl` and the privacy sentinel
    - `--clear` and `--rebuild`, and `.gitignore`
    - `CLAUDE.md` after the toggle
    - fixture transcripts unchanged after ingest
  - **Certify buckets.** The sweeps subject is all of `scripts/lib` plus `conductor.mjs`, and the
    functional subject is the entry point's import closure. So nearly every engine task here demands
    BOTH `node scripts/test/certify.mjs functional` and `… sweeps`.
    - Run `node scripts/test/drift.mjs --phase pre-commit` after staging. It names the demanded
      buckets.
    - Certify each bucket it names before the plain commit.
    - Batch docs-only edits into the engine commits they document, so that no extra certify runs.
- **Fixtures** are synthetic and minimal. Build a transcript tree under a temp dir with:
  - a main session holding streamed duplicates (equal input with a growing output), a zero-usage
    thinking entry, an entry whose output DROPS after `stop_reason`, `tool_use` blocks split across
    entries of one id, a `cost-state` entry and `iterations`
  - one marked sub-agent and one unmarked sub-agent, each with its `.meta.json`
  - one `--claude-worktrees-agent-<id>` directory, whose entries are `isSidechain:false`, have a null
    `agentId`, and carry their own `cost-state`
    - its `<id>` matches the marked sub-agent
    - add a second such directory with no matching marker

  Never copy a real transcript into the repo, because real transcripts hold prompt text.
- **Commits.**
  - Make one conventional commit per task.
  - Use `git add` with explicit paths. Stage exactly, certify the buckets drift names, then run a
    plain `git commit`.
  - Never use `--no-verify`.
  - After each commit, run `git show --stat <sha>` (7.2) and
    `node scripts/conductor.mjs update-epic token-spend-tracking-per-epic --attribute-commit <sha>` (7.4).

## 0. Before any code

- [x] 0.1 **Gate 1** (review `standard`, one fresh-context reviewer, opus) over these artifacts, by path:
      - `proposal.md` and `design.md`
      - `specs/spend-ledger/spec.md` and `specs/conductor-record/spec.md`
      - this file

      The reviewer checks:
      - WHEN/THEN testability on the rung named above
      - the data model against the observed transcript facts (design Context)
      - attribution precedence under concurrency
      - call-site and inverse completeness
      - task and TDD ordering

      Fix the Critical and Important findings. Re-validate with
      `openspec validate token-spend-tracking-per-epic --strict`. Record the verdict:
      `record-gate-review token-spend-tracking-per-epic --gate 1 --verdict pass --artifact <path>… --reviewer "<identity>"`.
- [ ] 0.2 **Cross-spec review of release 0.52.0** (required item 5). This change alone carries two spec
      files (`spend-ledger`, `conductor-record`), so the review is required.
      - Before `/opsx:apply`, invoke the `cross-spec-review` skill over the whole spec set of the
        0.52.0 members' changes on disk.
      - Name the shared chokepoints explicitly: the rules block and `KNOWN_JOB_ROLES` (with
        `execution-profile-planning-and-light-roles`), and the `conductor-record` detached-HEAD table.
      - Fix the BLOCKS. Record the verdict:
        `record-cross-spec-review 0.52.0 --verdict pass|fail --reviewer "<identity>"`.
      - Verify: `release show 0.52.0` shows the verdict current.

## 1. Constants, the switch and the ignore line

- [ ] 1.1 TDD (UNIT): add `KNOWN_SPEND_PHASES = ["plan","build","review","docs","release"]` to
      `scripts/lib/constants.mjs`, as one declaration. RED: a test that imports it and asserts the exact
      list from the spec. Verify: `rg -n "KNOWN_SPEND_PHASES\s*=" scripts` returns exactly one line.
- [ ] 1.2 TDD (UNIT, plus FILE for byte-identity): add the `set-spend-tracking on|off` verb in a new
      `scripts/lib/spend-tracking.mjs`.
      - Cover every scenario of "Spend tracking is a project opt-in, off by default":
        - the first `on` sets `enabledAt`
        - a re-enable keeps `enabledAt`
        - `maybe` is refused, and `state.json` is byte-identical (FILE)
        - a repeat writes nothing (FILE)
        - the exact `NOT SET: spendTracking — …` line
      - Wire it in:
        - the `conductor.mjs` dispatch and `USAGE`
        - the positional table in `constants.mjs` (`min:1, max:1, form:"on|off"`), and
          `FLAGLESS_VERBS`
        - `verb-effects.mjs` (`mutates`)
        - the `OPT_INS` row `spendTracking` (verb `set-spend-tracking`, doc `spend`)
      - In the SAME commit, create `commands/spend.md`, covering `set-spend-tracking`, and claim it in
        `docs/parity-ledger.json`. `scripts/test/assert/opt-ins.test.mjs` asserts the doc exists.

      Verify: `node scripts/conductor.mjs set-spend-tracking --help`,
      `node --test scripts/test/unit/opt-ins.test.mjs scripts/test/assert/opt-ins.test.mjs scripts/test/parity.test.mjs`.
- [ ] 1.3 TDD (FILE): add `.conductor/spend/` to `ENGINE_IGNORED` in `scripts/lib/subcommands.mjs`,
      with a comment citing #106 and this change. Cover "upgrade backfills the ignore line". Verify:
      the test's temp repo `.gitignore` holds the line after `upgrade`.
- [ ] 1.4 **Call-site completeness sweep, including inverses and data references** (required item 1).
      - **Callers.** Derive every caller mechanically with
        `rg -n "OPT_INS|ENGINE_IGNORED|KNOWN_JOB_ROLES|KNOWN_MODELS|state\.active\b|activityEnabled|conductorDir|detachedNoOp|rulesBlock\(|FLAGLESS_VERBS" scripts commands skills`,
        including tests. For each site, say whether the new switch, phase list, timeline rule or
        main-tree directory rule holds there, and justify each omission.
        - Name every writer of `state.active`, and show that the D7 chokepoint covers it, including
          writes made by hooks.
        - Name every reader of `KNOWN_JOB_ROLES`, to show the ledger adds no second role list.
        - Name every `.conductor/` write site, to show that the `conductor-record` table delta covers
          the new ones.
      - **Data references.** A marker's `epic` holds an epic id.
        - Writes: ingest, into `markers.json`.
        - Reads: read-time attribution.
        - Removal: `--clear`.

        A removed epic needs no removal path, because attribution is read-time: its rows report as
        `unknown-epic`. 4.1 pins that.
      - **Inverses.** Check each write against design D8. The unshipped ones are the
        `ENGINE_IGNORED` line and `record-spend` (D9). Justify both.
      - Save the result as `call-site-sweep-1.4.txt`.

## 2. The transcript reader and the ledger

- [ ] 2.1 TDD (UNIT): `transcriptDirs(mainRoot, env, listDir)` and the main-tree resolution for the
      spend directory (design D3/D4).
      - They are pure over an injected directory lister, and over the git double in
        `scripts/test/fixtures/`.
      - Cover:
        - the `CLAUDE_CONFIG_DIR` override and the default root
        - the encoding
        - the `--claude-worktrees-` siblings
        - "A linked worktree uses the same ledger": both the transcripts and the spend directory
          resolve to the main tree
        - "spend in a linked worktree reads the main tree's state" and "The switch is refused outside
          the main working tree" (FILE, in 4.2 and 1.2 respectively, over a linked-worktree fixture)
- [ ] 2.2 TDD (UNIT): `parseEntry(line, source)` and `foldRows(rows)` (design D5). Cover:
      - "Streamed duplicates count once" and "A zero-usage partial entry does not win"
      - the output-drops-after-`stop_reason` shape
      - "Tools spread over several entries are all kept"
      - "Iterations are not double-counted"
      - "Non-assistant and malformed entries yield no row" (skip counts by reason)
      - "Sub-agent sources are sub-agent actors": the subagents file, `isSidechain`, and the
        worktree directory, where `agentId` comes from the directory name
      - the tier mapping
- [ ] 2.3 TDD (UNIT): the stored-row allowlist, including `source`, and the stored-marker shape. Build
      both from explicit field lists, and assert that `Object.keys` equals the spec lists exactly.
- [ ] 2.4 TDD (FILE): incremental ingest over the fixture tree under a temp `CLAUDE_CONFIG_DIR`.
      - Cover every scenario of "Ingest is incremental and idempotent":
        - a re-run adds nothing
        - a partial trailing line waits
        - a replaced file does not double-count
        - history before `enabledAt` is not opened (assert through an injected `open` counter)
        - a concurrent ingest does not interleave (`ingest.lock`, broken after 10 minutes)
      - Also cover:
        - "Transcripts are never modified": bytes and mtime are equal
        - "No transcript directory is not an error"
        - "The marker survives incremental ingest": `markers.json` is captured on the first run
- [ ] 2.5 TDD (FILE): the privacy sentinel. Put `SENTINEL-7f3a` into prompts, responses, tool inputs,
      tool outputs and the meta `description`. Verify: no file under the fixture's
      `.conductor/spend/` contains it.
- [ ] 2.6 Network boundary: confirm that `scripts/test/assert/conductor-35.test.mjs` (the existing
      network-import scan) covers every module this change adds. Extend its file list only if it
      does not. Verify: run that test, and name the new modules it scanned in the commit message.

## 3. Attribution and the timeline

- [ ] 3.1 TDD (UNIT): marker parsing and read-time attribution (design D6), as a pure
      `attribute(rows, markers, timeline, state)`.
      - Cover every scenario of "The dispatch marker is captured…", "Attribution is computed at read
        time…" and "Actor, role and phase are separate closed vocabularies":
        - a valid marker
        - an invalid role or phase
        - `round=0` and `round=two`
        - an omitted round defaults to 1
        - an unknown epic
        - "An epic registered after its dispatch is attributed"
        - "A worktree session takes its agent's marker"
        - "A worktree session is never window-attributed"
        - only the FIRST matching line of the FIRST user entry is used
      - "A role added to the job-role list is accepted without a ledger change": inject an extended
        list.
- [ ] 3.2 TDD (UNIT): window and off-interval attribution over an in-memory timeline. Cover:
      - the window hit
      - `before-timeline`
      - `no-active-epic`
      - "Spend made while tracking was off is not credited to an epic": `tracking-off` beats a marker
      - "An unmarked sub-agent is unattributed, even inside a window"
- [ ] 3.3 TDD (FILE): the timeline append at the dispatch chokepoint (design D7).
      - Widen the snapshot gate at `conductor.mjs:370` onwards to
        `activityEnabled || spendTracking.enabled`.
      - Cover every scenario of "The engine records an active-epic timeline while tracking is on":
        - `set-active` appends one line
        - an unchanged `active` appends nothing
        - off creates nothing
        - enabling seeds the timeline
        - a failing append does not fail the verb
      - Also cover "Off keeps the ledger" (the `tracking:"off"` entry) and "A linked worktree records
        no timeline".
      - Declare `detachedNoOp` in `verb-effects.mjs` for the spend writes.
- [ ] 3.4 TDD (FILE): the hot-path guarantee ("No hook reads a transcript…"). Call the SessionStart,
      PreCompact and PreToolUse hook entry points in-process through `main(argv, io)`, with tracking
      off and with tracking on. Use an fs-call counter on the `scripts/test/fixtures/fs-work-counter.mjs`
      pattern that records every path touched. (`observe-reads.mjs` is certify's own observer and
      cannot see untracked paths.) Verify:
      - off: no path under the fixture `CLAUDE_CONFIG_DIR` or `.conductor/spend/` is touched
      - on: no transcript is opened and no ledger file is read
- [ ] 3.5 TDD (FILE): the `conductor-record` delta, "Spend data is not written in a detached tree".
      Detach HEAD in a fixture repo through the git double, then run `set-active` and `spend` with
      tracking on. Verify:
      - both verbs complete
      - nothing under `.conductor/spend/` changes
      - `spend` says it did not ingest

      Also cover the `spend-ledger` requirement "Detachment is tested on the main working tree, and
      the switch is refused there": `set-spend-tracking` refused in a detached main tree, and a
      detached linked worktree still ingesting into the main tree's ledger.

## 4. The `spend` verb and its inverses

- [ ] 4.1 TDD (UNIT): report aggregation over folded, attributed rows. Cover:
      - "The JSON shape serves the dependent epics", every key named in the scenario: per-agent
        totals, `byRound`, and input, cacheCreation, cacheRead and output kept separate
      - the unattributed total by reason, printed when it is 0
      - the coverage share
      - `--epic`, `--since` and `--until` (half-open)
      - the cost line and `cost.computed: false`
      - "An unknown epic is refused" (and no ingest)
      - "A row whose epic was removed reports as unknown"
- [ ] 4.2 TDD (FILE): the `spend` end-to-end over the fixture tree. Cover:
      - ingest, then report
      - `--no-ingest`
      - "spend while off reports without ingesting"
      - "The config directory override is honoured"
      - "Worktree sessions are discovered"

      Wire it in:
      - the `conductor.mjs` dispatch and `USAGE`
      - the flag table in `constants.mjs`: `--epic`, `--since`, `--until`, `--json`, `--no-ingest`,
        `--clear`, `--rebuild`, `--timeline` and `--yes`
      - `verb-effects.mjs`: `spend` writes only under `.conductor/spend/` and never `state.json`

      Verify: `node scripts/conductor.mjs spend --help` lists exactly those flags.
- [ ] 4.3 TDD (FILE): the inverses (design D8). Cover every scenario of "Every ledger write has an
      inverse":
      - clear without `--yes` changes nothing
      - clear keeps the timeline
      - `--clear --timeline --yes` removes it, and "Clearing the timeline says what it forgets"
      - rebuild reproduces the same totals
      - "Rebuild keeps what it cannot re-derive"
      - "Rebuild while off is refused"
      - "Conflicting operations are refused"
- [ ] 4.4 Extend `commands/spend.md` in the same commit as 4.2. It covers:
      - the `spend` flags and every inverse
      - the attribution precedence, the marker format and the closed lists
      - what is NOT measured: Claude Code background calls, spend before `enabledAt`, and spend while
        tracking is off
      - the window caveat for release-candidate orchestrator spend
      - transcript retention, and rebuild keeping rows whose source is gone
      - the notional-cost sentence

      Every refused example in the doc (for example `spend --clear --rebuild`) carries the
      refusal-class marker that `emitted-instructions` requires. Verify:
      `node --test scripts/test/parity.test.mjs` and the emitted-invocations assertion twin pass.

## 5. Emission

- [ ] 5.1 TDD (UNIT): `rulesBlock` emits `## Spend tracking` only while tracking is on (design D10),
      with the marker format and the role and phase lists rendered from the constants. Cover "On emits
      the section" and "Off emits nothing".
      - Add a tracking-on render to the `emitted-instructions` rules-block population, so the marker
        line is checked like every other shipped instruction.
      - Add a current-version rules fixture with tracking on. Leave the historical
        `rules-0.26.0-*.txt` fixtures unchanged.
      - Stage exactly, run `node scripts/test/certify.mjs functional`, then commit plainly.
      - Rebase point: this is the same insertion point as `execution-profile-planning-and-light-roles`.
        Whichever lands second rebases.
- [ ] 5.2 TDD (FILE): "Toggling refreshes CLAUDE.md". After `set-spend-tracking on`, the managed block
      on disk carries the section. After `off`, it does not.
- [ ] 5.3 `skills/conductor/SKILL.md`: the verb summary (`set-spend-tracking`, `spend`) and the state
      schema entry for `spendTracking`. Add the changeset fragment
      `.changesets/token-spend-tracking-per-epic.md`. Verify: `node scripts/conductor.mjs changesets`
      lists it.

## 6. Dogfood

- [ ] 6.1 Integration: the full assertion half passes
      (`node --test scripts/test/unit/*.test.mjs scripts/test/assert/*.test.mjs`), plus
      `node scripts/test/certify.mjs functional` and `… sweeps`. Time the run and record its peak
      memory.
- [ ] 6.2 Turn the switch on in this repo: `node scripts/conductor.mjs set-spend-tracking on`. Run
      `spend` once. Verify:
      - the output names the transcript directory it read
      - it prints an unattributed line and a coverage line
      - `git status` shows nothing under `.conductor/spend/`

## 7. Required task items (CLAUDE.md "The gate procedure", items 1–7)

- [ ] 7.1 Call-site completeness sweep (item 1). Satisfied by 1.4. Verify that
      `call-site-sweep-1.4.txt` exists and names every inverse.
- [ ] 7.2 **Verify each task against its commit** (item 2). For every task above, run
      `git show --stat <that task's sha>`, and assert that every file the task claims appears in THAT
      commit. Save the result as `commit-verification-7.2.txt`.
- [ ] 7.3 **Lifecycle marker** (item 3). Tasks 10.2 and 10.3 carry `<!-- pm:lifecycle -->` on their task
      lines. Verify: `rg -n "pm:lifecycle" openspec/changes/token-spend-tracking-per-epic/tasks.md`
      lists both.
- [ ] 7.4 **Attribute every commit** (item 4), in landing order, starting with the proposal commit. Do
      NOT attribute the archive move (10.3), or a lifecycle-only commit after Gate 2 is recorded.
      Verify: `attributedCommits` lists them in landing order.
- [ ] 7.5 Cross-spec review (item 5). Satisfied by 0.2.
- [ ] 7.6 End by recording a disposition (item 6). Satisfied by 10.2.
- [ ] 7.7 **Route what the work taught you** (item 7). Name each lesson as one of three kinds:
      - a practice (register an epic)
      - tooling friction (`/pm:feedback`)
      - a process failure (`docs/lessons/`)

      Give the evidence with each. "None" is a claim, and it must say what was looked at.

## 8. Gate 2

- [ ] 8.1 **Gate 2** at this epic's effective review. When built inside the 0.52.0 release candidate,
      the converged release-candidate review satisfies it. The review covers the full `BASE..HEAD`
      diff:
      - spec alignment
      - real tests passing
      - privacy (the sentinel and the field allowlist)
      - the hot-path guarantee
      - fold correctness
      - read-time attribution
      - lock and cursor edge cases
      - detached-HEAD suppression

      Fix the Critical and Important findings, and log the Minor ones. Record the verdict:
      `record-gate-review token-spend-tracking-per-epic --gate 2 --verdict pass --base-sha <a> --head-sha <b> --reviewer "<identity>"`,
      where `<b>` reaches every attributed commit.

## 9. Docs (after Gate 2 only)

- [ ] 9.1 README: the spend-tracking opt-in, `spend`, the marker, the inverses, and what is not
      measured. Verify: `rg -n "set-spend-tracking" README.md`.
- [ ] 9.2 Mintlify (`pm-plugin.dev`), per the `mintlify-doc-sync` skill: a spend page and the opt-in
      list. If the site must not document the feature before the plugin ships, carry this task to the
      0.52.0 release cut.

## 10. Close

- [ ] 10.1 **Re-record Gate 2 after docs**, at the post-docs head, once 9.x has landed and been
      attributed. Re-record, never withdraw. Verify: Gate 2 renders as a pass, not stale.
- [ ] 10.2 <!-- pm:lifecycle --> **Disposition.**
      `update-epic token-spend-tracking-per-epic --status archived --outcome delivered --reason "<why>"`
      with the deferral assertions:
      - `--deferral "token-spend-analysis-and-recommendations:design Open Questions (freeze per-epic totals at archive)"`
      - `--declined-deferral "rows.jsonl rotation:revisit past ~100 MB; the reader contract does not change"`
        (or a `--deferral`, if an epic holds it)
      - `--declined-deferral "record-spend verb:<why, per design D9>"`, unless an epic now holds it; in
        that case use `--deferral "<epicId>:design D9"`

      Then run `/pm:status`.
- [ ] 10.3 <!-- pm:lifecycle --> **Archive.** `/opsx:archive token-spend-tracking-per-epic`. The
      archive-move commit is NOT attributed (7.4).
