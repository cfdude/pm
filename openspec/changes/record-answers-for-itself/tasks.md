## 1. The clock — `createdAt` and `touchedAt`

- [ ] 1.1 RED: test that a newly registered epic carries `createdAt`, that it is unchanged by a
      later mutation, and that an epic written without it reads as unknown rather than as a date
- [ ] 1.2 RED: test that a content-changing mutation advances `touchedAt` and that a save changing
      nothing does not — reusing the existing changed-content comparison, not a second one
- [ ] 1.3 GREEN: stamp `createdAt` at every surface that creates an epic. Enumerate those surfaces
      mechanically (`rg` for the creation path), not from memory — see task 8.1
- [ ] 1.4 GREEN: advance `touchedAt` on content change in the shared save path
- [ ] 1.5 Verify absence tolerance: a `state.json` written by 0.39.0 loads, renders and passes
      integrity with neither field present

## 2. The backfill migration

- [ ] 2.1 RED: test that the migration recovers a real date from tracked history for an id whose
      introducing commit exists
- [ ] 2.2 RED: test each degradation path independently — no git, untracked state file, shallow
      history, id absent from history — and assert every one yields ABSENT, never an error and
      never a fabricated date
- [ ] 2.3 RED: test idempotence — a second run changes nothing, including the epics it left absent
- [ ] 2.4 RED: test the migration against a fixture carrying an epic in an undefined status
      (`status: "done"`), asserting it transforms that epic like any other and does NOT repair the
      status
- [ ] 2.5 GREEN: implement the migration with a `MIGRATIONS` entry keyed to 0.40.0
- [ ] 2.6 Confirm the migration opens no network connection and shells only to local `git log`

## 3. Unknown-status integrity check

- [ ] 3.1 RED: test that an epic whose status is outside `KNOWN_STATUSES` is reported with the
      epic id, the offending value, and the remedy
- [ ] 3.2 RED: test that the finding names the consequence — exempt from every archived-status
      rule, and any dependency edge pointing at it reads unsatisfied permanently
- [ ] 3.3 RED: test that the check repairs nothing and that a clean state file reports nothing
- [ ] 3.4 GREEN: implement the check alongside the existing unknown-link-type check, following its
      shape
- [ ] 3.5 Verify against a copy of a real repository's state file carrying `status: "done"` epics

## 4. Undispositioned-archive enumeration

- [ ] 4.1 RED: test that the enumeration returns archived epics with no agent-recorded outcome,
      that a migration-written stamp counts as undispositioned, and that an agent-recorded outcome
      does not
- [ ] 4.2 RED: test that each returned epic carries the invocation that would record a disposition
- [ ] 4.3 RED: test that an unreconstructable outcome is recordable with its reason and afterwards
      no longer appears as an outcome nobody looked for
- [ ] 4.4 RED: test that the three states stay distinguishable — nobody recorded, agent recorded,
      agent determined unreconstructable
- [ ] 4.5 GREEN: implement the enumeration and the unreconstructable disposition
- [ ] 4.6 Run it against this repository's own 66 undispositioned epics and record the count in
      the test as a real-data assertion

## 5. Uniform clearing, and `--link` appends

- [ ] 5.1 RED: test that every nullable field on the update surface is reachable by `--clear
      <field>`, driven from the field list rather than a hand-typed set, so a ninth nullable field
      fails the test until it is addressed
- [ ] 5.2 RED: test that clearing one field leaves every other field unchanged
- [ ] 5.3 RED: test that `--clear` on a non-nullable field exits non-zero naming the field and
      changes nothing
- [ ] 5.4 RED: test that `--link` appends, that a duplicate `(type, target)` pair does not produce
      a second entry, and that `--clear-links` still empties the list
- [ ] 5.5 GREEN: implement `--clear <field>` (repeatable) and the append semantics
- [ ] 5.6 Extend `scripts/test/conductor-23.test.mjs` with the UNSET axis it has never had — this
      is the regression guard for the class this release is named after, and its absence is why
      `gh-66` closed `delivered` with the sibling case unshipped

## 6. `sync --dry-run`

- [ ] 6.1 RED: test that the preview reports what a writing run would register
- [ ] 6.2 RED: test that the state file is BYTE-IDENTICAL after a preview, including any field a
      writing run touches as a side effect
- [ ] 6.3 RED: test that a repository with nothing to register previews an empty set
- [ ] 6.4 GREEN: implement `--dry-run`, deriving the preview set from the same code path the
      writing run uses so the two cannot disagree
- [ ] 6.5 Add `--dry-run` to the flag registry and confirm `sync --help` advertises it

## 7. The emitted inverse-operation obligation

- [ ] 7.1 RED: test that the emitted rules block contains the inverse-operation obligation inside
      required task item 1, and that it is a numbered task item rather than a prose bullet
- [ ] 7.2 GREEN: amend required task item 1 in `rules.mjs`
- [ ] 7.3 Verify the emitted block for all three platform variants — a rule that reaches only
      `claude-code` is a rule two platforms do not have

## 8. Gate procedure — required task items, carried into both gates

- [ ] 8.1 **Call-site completeness sweep, INCLUDING INVERSE OPERATIONS.** For every rule, guard or
      invariant this change adds or modifies, enumerate all call sites mechanically (`rg`, never
      from memory), state where the rule holds and where it does not, and justify each omission.
      A guard added at one call site while a sibling is untouched is a FINDING even though the
      unedited site never appears in the diff. **Then enumerate the INVERSE of every operation
      this change adds** — set/unset, add/remove, append/replace, enable/disable, grant/revoke —
      and justify each inverse not shipped. This change adds that obligation to the product; it
      applies to this change first. Data references count: enumerate every place a new field is
      written, read and REMOVED.
- [ ] 8.2 **Verify against the commit, not the working tree.** For every task, run
      `git show --stat <that task's sha>` and assert every file the task claims to change appears
      in THAT commit. A task whose claimed file is absent from its commit FAILS even though the
      working tree holds the edit and the suite passes.
- [ ] 8.3 **Attribute every commit to its epic** at the moment it is made:
      `update-epic <id> --attribute-commit <sha>`. Attribute forward only. The archive commit is
      excluded and MUST NOT be attributed.
- [ ] 8.4 **Cross-spec review before `/opsx:apply`.** This release carries FIVE delta specs, so
      the gate is mandatory. Dispatch two fresh-context reviewers with different lenses (review
      mode is `thorough`) at the whole spec set and ask the six questions: contradiction, double
      ownership, unmeetable requirements, gaps against the proposal's Resolves list, vocabulary
      forks, shared chokepoints. Split findings into BLOCKS and POLISH, fix the BLOCKS, decline
      most POLISH with reasons. Then record it:
      `record-cross-spec-review 0.40.0 --verdict pass|fail --reviewer "<identity>"`
- [ ] 8.5 **Gate 1 — spec review before code.** Fresh-context reviewers over the artifacts by file
      path. Fix Critical and Important, re-validate.
- [ ] 8.6 **Gate 2 — implementation review, committed, before docs.** Full `BASE..HEAD` diff, two
      independent fresh-context reviewers under `thorough`. Record with
      `record-gate-review <id> --gate 2 --verdict pass --base-sha <x> --head-sha <y>`
- [ ] 8.7 **End work by recording a disposition** for every member epic, in one invocation
      carrying both halves: `--status archived --outcome <o> --reason "<why>" --no-deferrals` (or
      the deferrals it stands in for). Never end work by removing the record.
- [ ] 8.8 **Route what the work taught you** — a practice becomes an epic with its evidence;
      friction in the tooling becomes a `/pm:feedback` filing; a process failure becomes a lesson
      file in `docs/lessons/`. Name which of the three each one is out loud.

## 9. Documentation and release

- [ ] 9.1 Update `README.md`, `commands/epic.md`, `commands/sync.md` and the `conductor` skill for
      every user-visible flag and behaviour this change adds
- [ ] 9.2 Sync the Mintlify site at `pm-plugin.dev` in the same PR cycle, per `mintlify-doc-sync`
- [ ] 9.3 Bump `.claude-plugin/plugin.json` to 0.40.0 and add the `CHANGELOG.md` entry
- [ ] 9.4 Full suite green — every test, including ones this change did not write
- [ ] 9.5 Record the release object with its member epics and any deliberate exclusions
- [ ] 9.6 Archive this change <!-- pm:lifecycle -->
