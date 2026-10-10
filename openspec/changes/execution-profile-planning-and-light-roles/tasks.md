# Tasks

## Commit mechanics

These rules bind every section below.

- **TDD.** Every behaviour task is RED then GREEN. The pre-commit hook runs the whole assertion half,
  so a RED cannot be committed alone. Save the failing run as `red-<task>.txt` in this directory,
  and land the RED and GREEN in ONE commit whose message names that file.
- **Rungs** (`.claude/agent-startup.md`, the rung table):
  - **UNIT** (`scripts/test/unit/`): values. That covers:
    - the constants and the default table;
    - `resolveProfile`, `profileLines` and `briefProfileLines`;
    - `parseSetProfile` and `parseModelPair` refusals;
    - the `rulesBlock()` string;
    - help text and refusal messages.
  - **FILE** (`scripts/test/assert/`): bytes on disk. That covers:
    - the pinned rules-block fixtures;
    - `CLAUDE.md` after `init`/`upgrade`;
    - the command docs' role lists.
- **Certify.** Every engine task here touches `scripts/lib`, and the rules-block text is a
  managed-rules surface.
  - Stage exactly.
  - Run `node scripts/test/drift.mjs --phase pre-commit`, then certify every bucket it names
    (`functional` and/or `sweeps`).
  - Then run a plain `git commit`. Never use `--no-verify`.
  - Batch the docs-only edits into the engine commit they document.
- **Commits.**
  - One conventional commit per task, `git add` with explicit paths.
  - After each commit, run `git show --stat <sha>` (5.2).
  - The orchestrator attributes each commit:
    `update-epic execution-profile-planning-and-light-roles --attribute-commit <sha>` (5.4).

## 0. Before any code

- [ ] 0.1 **Gate 1** (review `standard`, one fresh-context reviewer, opus) over these artifacts, by
      path:
      - `proposal.md`, `design.md`, `specs/execution-profile/spec.md` and this file.

      The reviewer checks:
      - WHEN/THEN testability on the named rung;
      - default-vs-explicit semantics;
      - call-site and inverse completeness;
      - coordination with `token-spend-tracking-per-epic`;
      - task and TDD ordering.

      Fix the Critical and Important findings. Re-run
      `openspec validate execution-profile-planning-and-light-roles --strict`. Then record:
      `record-gate-review execution-profile-planning-and-light-roles --gate 1 --verdict pass --artifact <path>… --reviewer "<identity>"`.
- [ ] 0.2 **Rob's answers applied.** Settle the open questions from the proposal round before 1.1,
      and fold any change into the spec and this file:
      - Do `mechanical` and `rudimentary` stay distinct?
      - The `test`/`review`/`mechanical` default tiers.
      - The default efforts.

      Verify: `openspec validate execution-profile-planning-and-light-roles --strict` passes, and
      the spec's default table equals the one 1.1 encodes.
- [ ] 0.3 **Cross-spec review of release 0.52.0** (required item 5). The release holds this change's
      `execution-profile` delta plus `token-spend-tracking-per-epic`'s two specs.
      - Invoke the `cross-spec-review` skill over the whole 0.52.0 spec set on disk, naming the
        shared chokepoints: `KNOWN_JOB_ROLES` (the ledger's role vocabulary) and the rules-block
        insertion point.
      - Fix the BLOCKS, then record
        `record-cross-spec-review 0.52.0 --verdict pass|fail --reviewer "<identity>"`.
      - One review satisfies this item and the ledger's 0.2 together if it runs after both changes'
        specs are final.
      - Verify: `release show 0.52.0` shows the verdict current.

## 1. The role change — ONE atomic commit (design Context, "Tests that the role change breaks")

Changing `KNOWN_JOB_ROLES` turns six already-running tests red, so 1.1–1.4 land as a single RED/GREEN
commit. Write the REDs first, save the failing run as `red-1.txt`, then make every item below green
before staging.
- After staging: `node scripts/test/drift.mjs --phase pre-commit`.
- Then certify `functional` and `sweeps` over that index.
- Then make one plain commit.

- [x] 1.1 TDD (UNIT), the constants. `KNOWN_JOB_ROLES` becomes
      `["plan","implement","test","review","mechanical","rudimentary"]`, and `DEFAULT_ROLE_MODELS` is
      added beside it (design D1, D2).
      - Test:
        - the table's keys equal `KNOWN_JOB_ROLES`, in order;
        - every value passes `checkPair`;
        - the table is frozen.
      - Amend `unit/execution-profile-lists.test.mjs:15` to the six-role array.
      - Amend `unit/spend-attribution.test.mjs:64-71` so the not-yet-known role is `deploy`, not
        `plan`.
      - Amend the sibling's scenario at
        `openspec/changes/token-spend-tracking-per-epic/specs/spend-ledger/spec.md:396-399` the same
        way, and tell the orchestrator. It is another change's artifact, and its Gate records may
        need re-recording.
        NOT DONE in the 1.x commit: editing it turns the sibling's recorded Gate 1 stale, and the
        functional record check (conductor-15 9.14) refuses an unexplained stale verdict. The orchestrator
        applies the one-scenario edit (`plan` -> `deploy`) and re-records the sibling's Gate 1.
      - Render the `clear-model` flag row's `requires`/`placeholder` from `KNOWN_JOB_ROLES`, resolving
        the declaration-order TDZ.
      - End the `--clear model` note at the built-in default (design D5). Covers "The role-taking
        flag's help names every role", the six-role refusal for `--model deploy=…`, and "Clearing
        every epic model role falls through to the defaults".
- [x] 1.2 TDD (UNIT), resolution. The resolver's per-role default becomes `DEFAULT_ROLE_MODELS[role]`,
      with source `default`. Cover these scenarios:
      - "A fresh repository resolves every role to its default"
      - "A layer's pair replaces the default whole"
      - "A pre-0.52.0 state with the old three roles still resolves"
      - "Nothing set resolves to today's behaviour"
      - "Unsetting a role restores its default"
      - "Clearing one epic model role"
      - "A one-shot epic overrides only implement"
      - "A new role is accepted at every layer"
      - "The brief stays silent on defaults"

      Update any test that indexes profile lines by position. Find them with
      `rg -n "model implement|model test|model review|no directive" scripts/test`.
- [x] 1.3 TDD (UNIT), emission. In `rules.mjs`, make three changes:
      - render the "Before dispatching a job" role list from the constant;
      - render every role's default pair inline in the resolution sentence from
        `DEFAULT_ROLE_MODELS` (design D5);
      - add the one-shot sentence (D4).

      Covers "The rules block shows every role's default", "The resolution order names every
      default, even for an overridden role", and "rules --epic emits the effective value".
- [x] 1.4 TDD (FILE), the fixtures.
      - Pin the section against a new current-version fixture,
        `scripts/test/fixtures/rules-0.52.0-execution-profile.txt`, and repoint
        `assert/execution-profile-emission.test.mjs` at it.
      - Keep `rules-0.51.0-execution-profile.txt` unchanged, as the historical record of the
        0.51.0 block, the same convention as the `rules-0.26.0-*` fixtures. It is referenced by
        nothing after the repoint, which is deliberate.
      - Regenerate `rules-0.52.0-spend-tracking.txt` deliberately, because its role line now names
        six roles.
      - Verify: `git show --stat <sha>` lists:
        - both fixtures;
        - `constants.mjs`, `execution-profile.mjs` and `rules.mjs`;
        - the amended tests, including `unit/execution-profile-resolver.test.mjs` and
          `unit/set-profile.test.mjs` (both assert the old no-directive default and go red at
          this commit);
        - the sibling spec.

## 2. Defaults are never stored

- [x] 2.1 TDD (FILE): "No verb writes a default". Run `init`, then `upgrade`, on a temp repo. Then
      the `state.json` bytes hold no `model` key at any layer. Verify: the assert test passes.
- [x] 2.2 Measure the rules-block growth with the `session-cost` report, before and after (design D6).
      Record the byte delta in the 2.1 commit message. Verify: the brief's byte count is unchanged,
      and the report stays under `BRIEF_BYTE_CAP`.

## 3. Docs that ship with the plugin

- [x] 3.1 Update the docs and test 4.5 in ONE commit:
      - `commands/profile.md`: the field table's role list with a one-line meaning per role, the
        default table, and the one-shot override.
      - `commands/init.md` step 4: recommend accepting the defaults (record nothing), and show
        overriding by example. Rewrite `assert/execution-profile-emission.test.mjs` test 4.5
        (lines 46-51) in the same commit, to cover "init writes no model on its own" against the
        new wording.
      - `commands/epic.md:283`: the `--model` row's role list.
      - `commands/spend.md:77`: the role list.

      Every refused example keeps its refusal-class marker. Verify:
      `node --test scripts/test/assert/parity.test.mjs`, the emission test, and the
      emitted-instructions twin pass.
- [x] 3.2 TDD (FILE), a doc-drift test (design D5). It asserts:
      - every role in `KNOWN_JOB_ROLES` appears in `commands/profile.md`, `commands/init.md`,
        `commands/epic.md` and `commands/spend.md`;
      - every role's default pair, rendered by `modelText`, appears in `commands/profile.md` and
        `commands/init.md`.

      Verify: the test fails when one role or one default is altered in a doc, and passes as
      shipped.
- [x] 3.3 Update `skills/conductor/SKILL.md` (the profile summary) and add the changeset fragment
      `.changesets/execution-profile-planning-and-light-roles.md`. The fragment must carry the
      BREAKING note on emitted instructions. Verify: `node scripts/conductor.mjs changesets` lists
      it.

## 4. Integration

- [x] 4.1 Run the full assertion half
      (`node --test scripts/test/unit/*.test.mjs scripts/test/assert/*.test.mjs`) plus
      `node scripts/test/certify.mjs functional` and `… sweeps`. Time the run and record peak memory
      (`/usr/bin/time -l`).
- [x] 4.2 Dogfood: in this repo, `node scripts/conductor.mjs profile` shows six roles. This repo's
      three set roles show `(project)` and `plan`/`mechanical`/`rudimentary` show `(default)`.
      `rules` emits the same.

## 5. Required task items (CLAUDE.md "The gate procedure", items 1–7)

- [x] 5.1 **Call-site completeness sweep** (item 1). Save the result as
      `call-site-sweep-5.1.txt` in this directory.
      - **Callers.** Derive the callers mechanically, with
        `rg -n -e 'KNOWN_JOB_ROLES|DEFAULT_ROLE_MODELS|resolveProfile\(|no model directive|no directive' -e 'implement\|test\|review' -e 'implement\\\|test' -e 'implement \| test \| review' -e "lane's, then the project's" scripts commands skills README.md`.
        The third pattern catches markdown-escaped pipes, such as `commands/epic.md:283`.
        - State where the six-role list and the default reach, and justify each place they do not.
        - Note `modelText`'s "no directive" branch: it is unreachable for resolved views (design D5).
      - **The data reference.** `epic.model`, `executionProfile.model` and
        `laneProfiles.<lane>.model` hold role keys. Name every writer, reader and remover.
      - **Inverses.** Name each one:
        - `--model <role>=…` against `set-profile --unset model:<role>` and
          `update-epic --clear-model <role>`;
        - `--clear model`.
      - **Omitted inverses.** "no directive" for a role is a justified omitted inverse (design
        Risks), and so is the absent default writer.
- [x] 5.2 **Verify each task against its commit** (item 2). For every task above, run
      `git show --stat <that task's sha>`, and assert that every file the task claims appears in
      THAT commit. Save the result as `commit-verification-5.2.txt`.
- [x] 5.3 **Lifecycle marker** (item 3). Tasks 8.2 and 8.3 carry `<!-- pm:lifecycle -->` on their
      task lines. Verify:
      `rg -n "pm:lifecycle" openspec/changes/execution-profile-planning-and-light-roles/tasks.md`
      lists both.
- [ ] 5.4 **Attribute every commit** (item 4), in landing order, starting with the proposal commit.
      Do NOT attribute the archive move (8.3), or a lifecycle-only commit made after Gate 2 is
      recorded. Verify: `attributedCommits` lists them in landing order.
- [ ] 5.5 Cross-spec review (item 5). Satisfied by 0.3.
- [ ] 5.6 End by recording a disposition (item 6). Satisfied by 8.2.
- [ ] 5.7 **Route what the work taught you** (item 7). Name each lesson as one of three kinds:
      - a practice (register an epic);
      - tooling friction (`/pm:feedback`);
      - a process failure (`docs/lessons/`).

      Give the evidence with each. "None" is a claim, and it must say what was looked at.

## 6. Gate 2

- [ ] 6.1 **Gate 2** at this epic's effective review. When the epic is built inside the 0.52.0
      release candidate, the converged release-candidate review satisfies it. The review covers the
      full `BASE..HEAD` diff:
      - spec alignment;
      - that defaults are never stored;
      - every role literal rendered;
      - the fixtures regenerated deliberately;
      - the ledger's role vocabulary unforked.

      Fix the Critical and Important findings, and log the Minor ones. Record:
      `record-gate-review execution-profile-planning-and-light-roles --gate 2 --verdict pass --base-sha <a> --head-sha <b> --reviewer "<identity>"`,
      where `<b>` reaches every attributed commit.

## 7. Docs (after Gate 2 only)

- [ ] 7.1 README: the six roles, the default table, default-vs-explicit, and the one-shot override.
      Verify: `rg -n "rudimentary" README.md`.
- [ ] 7.2 Mintlify (`pm-plugin.dev`), per the `mintlify-doc-sync` skill: the profile page and the
      init page. If the site must not document the feature before the plugin ships, carry this
      task to the 0.52.0 release cut.

## 8. Close

- [ ] 8.1 **Re-record Gate 2 after docs**, at the post-docs head, once 7.x has landed and been
      attributed. Re-record, never withdraw. Verify: Gate 2 renders as a pass, not stale.
- [ ] 8.2 <!-- pm:lifecycle --> **Disposition.** Run
      `update-epic execution-profile-planning-and-light-roles --status archived --outcome delivered --reason "<why>"`
      with
      `--deferral "token-spend-analysis-and-recommendations:proposal Impact (spend analysis flags a tier mismatch)"`.
- [ ] 8.3 <!-- pm:lifecycle --> **Archive the change:**
      `/opsx:archive execution-profile-planning-and-light-roles`. It must archive AFTER
      `token-spend-tracking-per-epic` if both land in 0.52.0, since both touch the rules-block text.
      Verify: `openspec/changes/archive/` holds it, and `openspec/specs/execution-profile/spec.md`
      lists six roles.
