# Tasks

## Commit mechanics

These rules bind every section below.

- **TDD.** Every behaviour task is RED then GREEN. The pre-commit hook runs the whole assertion half,
  so a RED cannot be committed alone. Save the failing run as `red-<task>.txt` in this directory,
  and land the RED and GREEN in ONE commit whose message names that file.
- **Rungs.** A test's rung follows what it OBSERVES:
  - **UNIT** (`scripts/test/unit/`): values over an in-memory store. Resolution, parsing, every
    refusal's message and exit, what `state` holds after a verb, the `rulesBlock()` string, the brief
    text and the `profile` output.
  - **FILE** (`scripts/test/assert/`): bytes on disk. `CLAUDE.md` after `set-profile` refreshes the
    block, and `state.json` being byte-identical after a refusal or a no-op unset.
  - **FUNCTIONAL** (`scripts/test/functional/` plus an assertion twin of the same id): only where
    real git or the process boundary is the subject. This change needs the functional certify
    (`node scripts/test/certify.mjs functional`) because it changes the managed-rules surface
    (4.1), and may add a functional test if 1.3 finds a git-backed caller.
- **Commits.**
  - One conventional commit per task.
  - `git add` with explicit paths. Stage exactly, run `node scripts/test/certify.mjs functional|sweeps`
    when the hook names a bucket, then run a plain `git commit`.
  - Never `--no-verify`.
  - After each commit, run `git show --stat <sha>` (5.1) and
    `update-epic execution-profile-layered-settings --attribute-commit <sha>` (5.3).

## 0. Before any code

- [ ] 0.1 **Gate 1** (review mode per the effective profile of this epic, `standard` today): one
      fresh-context reviewer over `proposal.md`, `design.md`, `specs/execution-profile/spec.md` and
      this file, BY PATH. Check WHEN/THEN testability on the rung named above, D1 storage against the
      "absent resolves to today" claim, and task ordering. Fix Critical and Important findings, then
      re-validate with `openspec validate execution-profile-layered-settings --strict`. Record the
      verdict:
      `record-gate-review execution-profile-layered-settings --gate 1 --verdict pass|fail --artifact <path>…`.
- [ ] 0.2 **Cross-spec review of release 0.51.0** (required item 5). This change and
      `converged-release-candidate-review` each add a spec, and change 2 reads this change's `review`
      resolution. Invoke the `cross-spec-review` skill over the release's whole spec set and fix
      BLOCKS. Record the verdict with
      `record-cross-spec-review 0.51.0 --verdict pass|fail --reviewer "<identity>"`. Verify:
      `release show 0.51.0` shows a current, not stale, verdict.

## 1. Closed lists and the pair parser

- [x] 1.1 TDD (UNIT): add `KNOWN_MODELS`, `KNOWN_EFFORTS`, `MODELS_WITHOUT_EFFORT`,
      `KNOWN_JOB_ROLES` and `KNOWN_VERBOSITY_LEVELS` to `scripts/lib/constants.mjs`, one
      declaration each. RED: a test that imports them and asserts the exact lists from the spec.
- [x] 1.2 TDD (UNIT): a shared parser for `<role>=<model>[:<effort>]` and
      `<field>` / `model:<role>`. Cover every "refused" scenario in "A profile holds three fields…"
      (haiku with an effort, a non-haiku model with none, an unknown role, model, effort or level).
      Verify: each refusal message names the accepted list.

- [x] 1.3 **Call-site completeness sweep, including inverses.**
      - Derive every caller mechanically with
        `rg -n "currentReviewMode|globalReviewMode|REVIEW_MODE_RANK|KNOWN_REVIEW_MODES|reviewMode|executionProfile|laneProfiles|\.verbosity\b|autonomy\.notifications|epic\.model" scripts commands skills`,
        including tests. For each site, state whether the most-specific-wins rule and the new fields
        hold there, and justify each omission. The de-escalation guard removal must reach every site
        that repeats "escalate only": the design's Context table is the starting list, not the final
        one.
      - **DATA references:** none of the new fields holds another record's id. The lane KEY in
        `laneProfiles` names a lane, which is an engine constant, not a record. Say so in the sweep
        file.
      - **Inverses:** confirm each set has its shipped unset, per the spec requirement "Every set has
        an inverse at every layer". The unshipped ones are `set-review-mode` (covered by
        `set-profile --unset review`) and the init recommendation (text, not a write). Justify both.
      - Save the result as `call-site-sweep-1.3.txt`.

## 2. The resolver

- [x] 2.1 TDD (UNIT): `resolveProfile(state, {epicId?, lane?})` in the new
      `scripts/lib/execution-profile.mjs` (design D2). Cover every scenario of "The effective value is
      resolved bottom-up, per field", including "Nothing set resolves to today's behaviour" over a
      0.50.0-shaped fixture state, the whole-pair rule for `model`, and a stored invalid value falling
      through with `ignored` set.
- [x] 2.2 TDD (UNIT): make `currentReviewMode(epicId)` an adapter over the resolver. RED: an epic
      whose `reviewMode` is BELOW the project resolves to its own value (it resolves to the max
      today). Update the existing unit tests that pin max-resolution (1.3 lists them) in the same
      commit, and cite this spec's "An epic lowers review below the project" scenario in each.
- [x] 2.3 TDD (UNIT): "A detour epic does not inherit from the epic it paused". Push a detour over an
      in-memory store and resolve it. Verify: the parent's `thorough` never appears in its profile.

## 3. Verbs and records

- [x] 3.1 TDD (UNIT, plus FILE for byte-identity): `set-profile` (design D4). Cover set and unset at
      the project and lane layers, lane validation, the refusal when no operation is named, the
      refusal when one field is set and unset together, an emptied lane layer being removed, and a
      no-op unset writing nothing (FILE: `state.json` bytes unchanged). The project `--review` writes
      `state.reviewMode`. Also cover "set-review-mode and set-profile write one record". Add
      `set-profile` to the dispatch at the bottom of `conductor.mjs`, to the verb priority table in
      `constants.mjs`, and to the verb-surface registry so `--help` projects its flags. Verify:
      `node scripts/conductor.mjs set-profile --help` lists exactly the D4 flags.
- [x] 3.2 TDD (UNIT): `profile [--epic <id> | --lane <lane>]`, read-only. Cover the source label per
      field and per role, naming the overridden value when an epic lowers it, naming ignored stored
      values, and refusing an unknown epic or lane. Verify: `profile --help`, and that the verb
      writes nothing (UNIT: the store is unchanged).
- [x] 3.3 TDD (UNIT): epic-layer flags. Widen the `review-mode` `EPIC_FLAGS` row to
      `add-epic`/`add-many`/`update-epic`, and add rows for `model` (repeatable, parsed by 1.2) and
      `verbosity`, all `nullable`. Add `--clear-model <role>`. REMOVE the de-escalation refusal in
      `update-epic.mjs`, and rewrite the row's `clearNote` (design D3). Cover "An epic override set at
      creation", "add-many accepts the same fields as batch keys", "Setting one model role leaves the
      others" and "Clearing one epic model role".
- [x] 3.4 TDD (UNIT): `activity-log.mjs` emits an event for every profile field change at every layer,
      not only `reviewMode`. Verify: a lane `model.test` change produces one event naming layer, field,
      from and to.
- [x] 3.5 Command docs in the same commits as their verbs:
      - a new `commands/profile.md` covering `set-profile` and `profile`, with every flag, every
        inverse, and the resolution order;
      - `commands/review-mode.md`: rewrite "Per-epic override" (no longer escalate-only), and name
        `set-profile --unset review` as the shorthand's inverse;
      - `commands/epic.md`: the flag table rows.

      Add `commands/profile.md` to a capability in `docs/parity-ledger.json`. Verify:
      `node --test scripts/test/parity.test.mjs` passes.

## 4. Emission

- [ ] 4.1 TDD (UNIT): `rulesBlock` emits `## Execution profile` (design D5). Include the project
      values, the lane overrides, the resolution order, the dispatch instruction (apply
      `{model, effort}` per role where supported, and say so where not), the verbosity rule, and
      the unchanged `Current mode: **<review>**.` line. Leave the `rules-0.26.0-*.txt` fixtures
      unchanged (historical upgrade inputs), add a current-version rules fixture that pins the new
      section, and update the managed-rules assertions, in the same commit. Stage exactly, run
      `node scripts/test/certify.mjs functional`, then commit plainly. Cover "The rules block names
      lane overrides". **This is the shared chokepoint with `converged-release-candidate-review`
      2.1: task 4.1 lands FIRST, and converged 2.1 rebases on it.**
- [ ] 4.2 TDD (UNIT): `rules --epic <id>` emits the epic's effective values with sources. Cover
      "rules --epic emits the effective value".
- [ ] 4.3 TDD (FILE): `set-profile` refreshes `CLAUDE.md`, and the block on disk carries the new
      project value after the verb. An epic-layer write does not rewrite the block.
- [ ] 4.4 TDD (UNIT): the brief names the active epic's effective profile (design D5).
- [ ] 4.5 `commands/init.md`: the ask-and-recommend step (`opus` / `medium` recommended,
      `sonnet` / `haiku` as the cheaper option, lane overrides offered, the answer recorded with
      `set-profile`). TDD (UNIT): "init writes no model on its own". A fresh init's state holds no
      `executionProfile.model`. Update `skills/conductor/SKILL.md` (the verb summary near "review
      mode", and the state schema entries for `executionProfile`, `laneProfiles`, `epic.model` and
      `epic.verbosity`).

## 5. Required task items (CLAUDE.md "The gate procedure", items 1–7)

- [ ] 5.1 **Verify each task against its commit.** For every task above, run
      `git show --stat <that task's sha>` and assert every file the task claims appears in THAT commit.
      A missing file fails the task even when the working tree holds the edit. Save the result as
      `commit-verification-5.1.txt`.
- [ ] 5.2 **Behaviour-change inventory (design D6).** List every epic in this repo's
      `.conductor/state.json` whose `reviewMode` is below `state.reviewMode`. Those resolve lower
      after this change. Report them in the closeout. Do not transform them.
- [ ] 5.3 **Attribute every commit.** At each commit, run
      `node scripts/conductor.mjs update-epic execution-profile-layered-settings --attribute-commit <sha>`,
      including the proposal commit and the Gate 1 fix commit, which are attributed already. Do NOT
      attribute the archive move (8.4). Verify: the attribution array is the proposal commit, the
      Gate 1 fix commit, then the implementation commits, in landing order.
- [ ] 5.4 **Lifecycle marker.** The archive task 8.4 carries `<!-- pm:lifecycle -->` on its task line,
      and so does the disposition task 8.3. Verify:
      `rg -n "pm:lifecycle" openspec/changes/execution-profile-layered-settings/tasks.md` lists both.
- [ ] 5.5 **Route what the work taught you.**
      - Name each lesson as a practice (register an epic), tooling friction (`/pm:feedback`) or a
        process failure (`docs/lessons/`), with evidence.
      - "None" is a claim, and it must say what was looked at.

## 6. Gate 2

- [ ] 6.1 **Gate 2** at the effective review of this epic. When built inside the 0.51.0 release
      candidate, it is satisfied by the converged review defined by `converged-release-candidate-review`.
      The review covers the full `BASE..HEAD` diff for spec alignment, real tests passing, and error
      and edge handling (invalid stored values, the haiku rule). Fix Critical and Important findings,
      and log Minor ones. Record the verdict:
      `record-gate-review execution-profile-layered-settings --gate 2 --verdict pass --base-sha <a> --head-sha <b> --reviewer "<identity>"`,
      where `<b>` reaches every attributed commit. Verify: `release show 0.51.0` / PROJECT.md render it
      as a pass, not stale.

## 7. Docs (after Gate 2 only)

- [ ] 7.1 README: the execution profile (fields, layers, resolution order, verbs and inverses), and
      removing the "escalate only" wording. Verify: `rg -n -i "escalat" README.md` returns no stale
      claim.
- [ ] 7.2 Mintlify (`pm-plugin.dev`), per the `mintlify-doc-sync` skill: the review-mode page, a
      profile page or section, and the epic flag reference. Merge live and verify the pages render.

## 8. Close

- [ ] 8.1 Integration: the full suite passes
      (`node --test scripts/test/unit/*.test.mjs scripts/test/assert/*.test.mjs`, plus
      `node scripts/test/certify.mjs functional` and `… sweeps`), and
      `openspec validate execution-profile-layered-settings --strict` passes.
- [ ] 8.2 **Re-record Gate 2 after docs.** Once the docs commits (7.1, 7.2) have landed and been
      attributed, re-record Gate 2 at the post-docs head:
      `record-gate-review execution-profile-layered-settings --gate 2 --verdict pass --base-sha <a> --head-sha <post-docs head> --reviewer "<identity>"`.
      Re-record, never withdraw. Verify: the epic's Gate 2 renders as a pass, not stale, so the
      `delivered` archive in 8.3 is not refused.
- [ ] 8.3 <!-- pm:lifecycle --> **Disposition.**
      `update-epic execution-profile-layered-settings --status archived --outcome delivered --reason "<why>" --no-deferrals`,
      or `--deferral` / `--declined-deferral` for anything held back, such as `profile --json` from
      design Open Questions. Run `/pm:status`.
- [ ] 8.4 <!-- pm:lifecycle --> **Archive.** `/opsx:archive execution-profile-layered-settings`. The
      archive-move commit is NOT attributed (5.3).
