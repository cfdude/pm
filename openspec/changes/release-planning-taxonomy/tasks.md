# Tasks

## Commit mechanics

- **TDD.** Every behaviour task is RED then GREEN. Save the failing run as `red-<task>.txt` in this directory and land it in
  ONE commit with its GREEN; that commit's message names the file. A RED note is task-relative ("fails before 2.2"), never
  "fails today", and is re-run when its own task starts.
- **Order.** The export (section 1) comes first and reads every new field as `null` or `[]` when absent, so the RED tests of
  sections 2 to 5 fail on the missing behaviour, not on a missing key.
- **Rungs.** A value the engine produced (a verb's JSON or refusal, what `state.json` holds) is a UNIT test over the in-memory
  store (`scripts/test/unit/`, `unitTest()`). Bytes on disk (command docs, skills, the template, the rules block, README rows)
  are FILE-rung tests (`scripts/test/assert/`). The only functional work is the existing read-only `VERB_EFFECTS` check for
  the new verb and the emitted-invocations test for the new rules section (task 6.2).
- **Certify.** Engine source is a certify subject. Stage exactly, run `node scripts/test/drift.mjs --phase pre-commit`,
  certify each bucket it names, then commit plainly. Never `--no-verify`.
- **Commits.** One conventional commit per task, with explicit paths. After each: `git show --stat <sha>` (R.2) and
  `update-epic release-planning-taxonomy --attribute-commit <sha>` (R.4).
- **Changeset.** Each user-facing change adds to `.changesets/release-planning-taxonomy.md`. `CHANGELOG.md` is consolidated
  at the cut (V.3), not per task.

## 0. Before any code

- [ ] 0.1 **Re-read the source.** The epic has no `externalId`: read its notes in `.conductor/state.json` in full, this change,
      and `openspec/changes/project-boards/` (or its archive) in full. Confirm `project-boards` is archived, so
      `openspec/specs/release-planning/spec.md` exists and this change's ADDED requirements land on it.
- [ ] 0.2 **Gate 1** (review `standard`) over `proposal.md`, `design.md`, the four spec files and this file. Fix every Critical
      and Important finding, re-run `openspec validate release-planning-taxonomy --strict` (it must print "is valid"), then
      `record-gate-review release-planning-taxonomy --gate 1 --verdict pass --artifact <path>… --reviewer "<identity>"`.
- [ ] 0.3 **Release membership.** `release show 0.56.0` lists `release-planning-taxonomy`; if not, `release 0.56.0 --member
      release-planning-taxonomy`.
- [ ] 0.4 **Cross-spec review** (gate item 5). Four spec files, so invoke the `cross-spec-review` skill over the whole 0.56.0
      set AND the 0.55.0 specs it extends (`release-planning`, `board-export`, `project-mission`, `project-boards`,
      `epic-annotation`), testing design.md's "Amendments owed: none" claim. Record
      `record-cross-spec-review 0.56.0 --verdict pass|fail --reviewer "<identity>"`. Shared chokepoints:
      - the flag registry in `scripts/lib/constants.mjs` (the second `kind` row beside `purge-logs`'s; valueless
        `maintenance`, `clear-initiative`, `clear-split-reason`; `add-non-goal`, `remove-non-goal` across five verbs)
      - `release --clear`'s closed field list and `mission`'s `--reason` closed list (design D5)
      - `board.mjs` `REJECTED_REASONS` and the fixed `mission` object (design D5, D7)
      - `docs/parity-ledger.json`, `SURFACE_FEATURES`, the rules-block sections, the README cost table
      - the "milestone" vocabulary (design D3)
- [x] 0.5 **Owner answers.** Q1 to Q13 answered on 2026-11-12 and folded in as design D17 to D30 (Q5 revised by the owner).
      Q14 answered the same day as design D31 (an automatic planning baseline, no flag).

- [ ] 0.6 **The owed `board-export` amendment** (design, "Amendments owed"), ordered AFTER `project-boards` is archived (0.1
      confirms it), because a MODIFIED delta needs `openspec/specs/board-export/spec.md` to exist and amending the unarchived
      `project-boards` would make 0.55.0 contradict its built code. Add `specs/board-export/spec.md` with a MODIFIED
      "rejected entries have one shape and a closed reason list" adding kind `initiative`, amend the initiative-record export
      requirement so a bad initiative id becomes a `rejected` entry (reason `id format`) instead of a skip, and add its RED
      test to 1.1. Re-validate, then re-run 0.2 and 0.4 (a fifth spec file joins the set).

## 1. The export reads the new fields (specs: all four, their `board --json` requirements)

- [ ] 1.1 RED (UNIT, `boardSnapshot` over fixtures): `initiatives` is `[]` and `missionNonGoals` is `[]` on an empty record;
      every initiative entry carries `outcome`, `source`, `offMissionReason` and milestones with `reachedAt` and `evidence`;
      every release entry carries `initiative: null`, `maintenance: false`, `splitReason: null`, `primaryServed: null`,
      `planningBaseline: null`, `addedSincePlanning: null`, `unknownJoinTime: null`, `nonGoals: []` and the zero `split`
      (`initiativeWork`, `health`, `unaligned`); every epic entry carries `initiative`, `initiativeJoinedAt`,
      `secondaryInitiatives: []`, `kind`, `effectiveKind`, `releaseJoinedAt`, both reasons and `nonGoals: []`; a populated
      fixture reads each back; an initiative with a malformed id is omitted; a reference naming no initiative reads `null`;
      removed milestones and non-goals are absent; `schemaVersion` is 1. Save `red-1.1.txt`.
- [ ] 1.2 GREEN: extend `scripts/lib/board.mjs` (no change to `REJECTED_REASONS`); update the JSON shape in
      `commands/boards.md`. Changeset.

## 2. Initiatives (spec: initiative-record)

- [ ] 2.1 RED (UNIT): create needs `--title` and `--capability`; amend replaces; one-line and length refusals with escaped
      echo; `show` reserved; malformed id refused; `--source` (with `UNGROUNDED`) and `--off-mission-reason` set and clear,
      `--clear` refusing any other field; `--end --outcome delivered|abandoned|superseded --reason` and `--reopen --reason`
      append history, refusing the wrong state, a missing or other outcome (`killed`), an empty reason, and `--reason` alone
      or beside another flag; no delete path exists; `initiative show [<id>] [--history]` and `no initiatives` write nothing; unknown
      id refused. Save `red-2.1.txt`.
- [ ] 2.2 GREEN: `scripts/lib/initiative.mjs` and `scripts/lib/initiative-record.mjs` (pure readers, a leaf like
      `mission-record.mjs`), registry rows, `VERB_POSITIONALS`, `USAGE`, dispatch in `scripts/conductor.mjs`, a
      `VERB_EFFECTS` row (mutates; `show` writes nothing, with an `exercise` row). Add `commands/initiative.md` and claim it
      in `docs/parity-ledger.json` in the same commit. Certify functional (the read-only check). Changeset.
- [ ] 2.3 RED then GREEN (UNIT): initiative milestones: stable `mN` ids, never reused; `--remove-milestone "mN:<why>"` marks
      with time and reason, refuses unknown, removed and reasonless; no release field; the mission milestone and
      `criticalPath` unchanged; `--reach-milestone "mN:<evidence>"` and its override `--unreach-milestone "mN:<why>"` keep
      both events and refuse the wrong state. RED: `red-2.3.txt` (fails before 2.3).
- [ ] 2.4 RED then GREEN (UNIT): the reference rule: every initiative-naming flag refuses an unknown id; `runIntegrity`
      reports a hand-edited `epic.initiative`, `epic.secondaryInitiatives[]` entry and `release.initiative` naming no
      initiative. Edit `scripts/lib/integrity.mjs`. RED: `red-2.4.txt`.

## 3. Non-goals (spec: non-goals)

- [ ] 3.1 RED (UNIT): one shape on four records; per-record `nN` ids; `--add-non-goal` repeatable on `mission`,
      `initiative`, `release`, `add-epic`, `update-epic`, and the `add-many` `nonGoals` key; one bad value refuses the whole
      invocation; `--remove-non-goal "nN:<why>"` marks, is not repeatable, refuses unknown, removed and reasonless; a
      `--add-non-goal` beside `--add-milestone` lands on the initiative; a `nonGoals` key on a milestone record is ignored;
      `mission show --history` and `initiative show --history` list removed ones. Save `red-3.1.txt`.
- [ ] 3.2 GREEN: `scripts/lib/non-goals.mjs` (design D12) wired into `mission.mjs`, `mission-record.mjs` (`missionOf`
      carries `nonGoals`), `initiative.mjs`, `releases.mjs`, `add-epic.mjs`, `update-epic.mjs`, `add-many.mjs`; registry
      rows. Update `commands/mission.md`, `commands/epic.md`, `commands/initiative.md` and the `release` docs in
      `skills/release-candidate/SKILL.md` and `skills/conductor/SKILL.md`. Changeset.

## 4. Release purpose and the 80/20 split (spec: release-planning)

- [ ] 4.1 RED then GREEN (UNIT): `--initiative`, `--maintenance` (valueless), each replacing the other, both together
      refused, `--clear-initiative` (valueless) removing either; `release here` refuses all three; `--goal` is an unknown
      flag; `release show <id>` keeps its `theme:` label (existing tests unchanged, design D32) and prints `initiative: <id> (<title>)` or `initiative: maintenance`;
      `release show` appends the purpose. Edit `scripts/lib/releases.mjs`, the registry, `USAGE`. RED: `red-4.1.txt`.
- [ ] 4.2 RED then GREEN (UNIT): every member in any lane counted once into `health`, `initiativeWork` or `unaligned`
      (design D21); the claude-code effective kind (`initiative-work` with an initiative, else `health`); an
      `offInitiativeReason` leaves a member `unaligned`; `healthShare` over all members and its `null` case; fixed
      `target: 0.2`; `drift` against `HEALTH_SHARE_MIN = 0.10` and `HEALTH_SHARE_MAX = 0.30` (0/10 and 4/10 drift; 1, 2 and
      3 of 10 do not); never stored; `primaryServed` true, false and `null`, and its `release show` warning line; the
      `release show` split line with its band and `, DRIFT` suffix. RED: `red-4.2.txt`.
- [ ] 4.3 RED then GREEN (UNIT): `--split-reason` (one line, 400) and `--clear-split-reason` (valueless); a reason changes
      neither `drift` nor the split; no flag, verb or `OPT_INS` row turns the report off or changes the target (a registry
      scan). RED: `red-4.3.txt`.
- [ ] 4.4 RED then GREEN (UNIT; no new verb or flag): `release --member` writes `epic.releaseJoinedAt` at the one writer
      (`releases.mjs:367`) only on a join, guarded so a repeat for the same release keeps it; a move replaces it; both
      removers delete it, `--unmember` (`releases.mjs:399`) and `--defer` on that release (`releases.mjs:375`); a pre-0.56.0
      member reads `null`; the derived
      `planningBaseline` is the earliest member `startedAt` and `null` with none started; `addedSincePlanning` and
      `unknownJoinTime` follow it and are `null` without it; `release --planned` is an unknown flag; `release show`
      prints `N epics added since the first member started`. RED: `red-4.4.txt`.
- [ ] 4.5 RED then GREEN (UNIT `attributionNudge` with the injected `short`): the untied branch names `maintenance-<releaseId>`
      with runnable `add-epic` and `release --member` commands when it is absent and a runnable `--attribute-commit` with the
      commit's sha, plus the small claude-code epic for initiative work, when the active epic is a release member; unchanged
      text when it is not; `null` still returned with no active epic. Then extend the emitted-invocations functional test with
      the new commands and its assertion twin, and run `node scripts/test/certify.mjs functional`. RED: `red-4.5.txt`.
      Changeset for 4.1 to 4.5.

## 5. Epic planning fields and the challenge (spec: epic-annotation)

- [ ] 5.1 RED then GREEN (UNIT): `--initiative`, `--secondary-initiative` (repeatable, repeat ignored, equal-to-primary
      refused), `--remove-secondary-initiative`, `--kind initiative-work|health`, `--off-mission-reason`,
      `--off-initiative-reason`, each through add-epic, update-epic and add-many (batch keys), each scalar cleared with
      `--clear`, and the nullable-field registry test covering every new nullable row. `commands/epic.md` states the health
      definition; `initiativeJoinedAt` is written when the primary changes, kept on a same-value re-set and removed by
      `--clear initiative`. RED: `red-5.1.txt`.
- [ ] 5.2 RED then GREEN (UNIT): the planning warning at every `warnSummary` sink (design, Call sites): fires on the
      transition only while an initiative is open; names `--kind`, and `--initiative` unless `health`; silenced by
      `offInitiativeReason`; never for `claude-code`; never on an unchanged status or on archive; exit 0 and the write lands.
      Edit `scripts/lib/epic-summary.mjs` (or a sibling module called from the same sinks). RED: `red-5.2.txt`.
- [ ] 5.3 RED then GREEN (UNIT): `release --member` warns for an epic not serving the release's primary (not `health`, not
      `claude-code`, no reason), still writes the membership, and never warns for a maintenance or purpose-less release.
      RED: `red-5.3.txt`. Changeset for section 5.

## 6. The rules-block sections (specs: initiative-record, non-goals)

- [ ] 6.1 RED (FILE): `## Initiatives` present while an initiative is open, absent when none is, at most 280 bytes heading
      included, names both reason flags; `## Mission non-goals` present while the mission has an active non-goal, absent
      otherwise, at most 200 bytes with an ellipsis cut, and the `## Mission` section byte-identical; both rewritten by their
      verb when their text changes and kept by `set-boards`, `mission` and the `rules` verb; `overhead` reports
      `rules:initiatives` and `rules:mission-non-goals` under `core`; README cost rows exist. Save `red-6.1.txt`.
- [ ] 6.2 GREEN: both sections in `scripts/lib/rules.mjs` (outside `CONDITIONAL_SECTIONS`, the `missionSectionText`
      pattern), their arguments at all three `rulesBlock` builders (`writeRules`, the `rules` verb in `scripts/conductor.mjs`,
      `overhead.mjs`), the `SURFACE_FEATURES` rows, the README rows. Extend `fillRecipe` in
      `scripts/test/functional/emitted-invocations.test.mjs` for any new placeholder, with its assertion twin, and run
      `node scripts/test/certify.mjs functional`. Re-run `node scripts/conductor.mjs overhead` and put the measured bytes in
      the changeset (design D29 gives the 2026-11-12 baseline). Changeset.

## 7. Skills and the release plan template (specs: initiative-record, non-goals, release-planning)

- [ ] 7.1 RED (FILE): `skills/project-boards/SKILL.md` "First population" names clustering the backlog, UNGROUNDED, "Does
      this make sense?", that the user never names an initiative or milestone, and that nothing unconfirmed is written;
      `skills/conductor/SKILL.md` Intake names both reason flags, "once", initiatives as well as epics, reading the recorded
      reason first, the `claude-code` exemption, the orchestrating-agent-first order, and the two tweak destinations
      (`maintenance-<releaseId>` with its lane, kind, membership, `--attribute-commit` and end-with-release; a small
      claude-code epic for a tweak that moves an initiative). `--source` and UNGROUNDED appear in "First population".
      Save `red-7.1.txt`.
- [ ] 7.2 RED (FILE, `node:vm` over the template's marked render block, project-boards D13): the Initiatives section and its
      guided empty state, source with the UNGROUNDED mark, milestone reached marks; each release card's primary initiative
      title or "Maintenance", its "Goal" label, its split with the unaligned count, drift mark and reason, the unserved-primary
      warning, the scope-added line, and its guided empty state naming `release <id> --initiative <id>` and `--maintenance`; the
      "Not doing" lists for mission, initiative and release, with no empty heading; hostile title, capability, milestone,
      non-goal, evidence, source and split-reason text stays inert; the `${}` and markup-concatenation source scans still pass. Save
      `red-7.2.txt`.
- [ ] 7.3 GREEN: write the skill text and `skills/project-boards/templates/release-plan.html`; update the skill's doc contract
      for the new keys. Changeset.

## 8. Integration checks

- [ ] 8.1 Run the whole assertion half once: `node --test scripts/test/unit/*.test.mjs scripts/test/assert/*.test.mjs`, then
      certify each bucket drift names. Report counts and every unlisted flake.
- [ ] 8.2 Backward compatibility (UNIT): a 0.55.0-shaped fixture (no `initiatives`, no new release, epic or mission keys)
      loads; `board --json`, `release show`, `mission show` and `initiative show` succeed on it; the load writes nothing.
      This is the evidence for "no MIGRATIONS entry" (design, Migration Plan).
- [ ] 8.3 Rendering verified for real: the release plan loaded through the standalone fallback with a populated and an empty
      snapshot, screenshotted at desktop and phone width, checked for horizontal overflow.

## R. Required task items (CLAUDE.md "The gate procedure", items 1 to 8)

- [ ] R.1 **Call-site completeness sweep** (item 1). Re-derive mechanically and compare with design.md "Call sites":
      - `rg -n "warnSummary\(|owesSummaryWarning" scripts/lib`: every transition sink carries the planning warning.
      - `rg -n "lineFieldError\(" scripts/lib`: every new one-line field is validated through it.
      - `rg -n "epicBatchKeys|epicFlagsFor" scripts/lib`: add-many and `--help` see every new epic row.
      - `rg -n 'flag: "(initiative|secondary-initiative|remove-secondary-initiative|kind|off-mission-reason|off-initiative-reason|add-non-goal|remove-non-goal|maintenance|clear-initiative|split-reason|clear-split-reason|add-milestone|remove-milestone|title|capability|end|reopen|outcome|source|reach-milestone|unreach-milestone)"' scripts/lib/constants.mjs`:
        each new row, and each flag's `commands` list.
      - `rg -n "\.initiative\b|secondaryInitiatives|initiatives\b" scripts/lib scripts/conductor.mjs`: every writer, reader and
        remover of the data references (design, Data references table).
      - `rg -n "nonGoals|nextNonGoal" scripts/lib`: all four records go through `non-goals.mjs`.
      - `rg -n "\.kind\b|effectiveKind|splitReason|maintenance|planningBaseline|primaryServed" scripts/lib/releases.mjs scripts/lib/board.mjs scripts/lib/epic-summary.mjs`.
      - `rg -n "\.release = |delete [a-zA-Z.()]*\.release\b|releaseJoinedAt|initiativeJoinedAt" scripts/lib scripts/conductor.mjs`:
        the one writer of membership writes the join time only on a join, and every remover (`--unmember`, `--defer`, a move,
        `--clear initiative`, `remove-epic`) removes or replaces it.
      - `rg -n "attributionNudge|attributionCandidates" scripts/lib`: only the untied branch carries the destinations.
      - `rg -n "missionSectionText|SURFACE_FEATURES|CONDITIONAL_SECTIONS" scripts/lib`.
      - `rg -n "rulesBlock\(|writeRules\(|currentMissionSection\(|currentBoardsSection\(" scripts/lib scripts/conductor.mjs`:
        every builder of the block passes the `## Initiatives` section, and every other writer goes through `writeRules`.
      - `rg -n "\"show\"" scripts/lib/initiative.mjs scripts/lib/releases.mjs scripts/lib/mission.mjs`: reserved ids.
      - `rg -n '\$\{' skills/project-boards/templates/release-plan.html`: every new interpolation is escaped.
      State where each rule holds and justify each omission. Confirm every row of design.md "Inverses" against the code and
      justify the three not shipped.
- [ ] R.2 **Verify against the commit** (item 2): `git show --stat <sha>` for each task; every file the task claims (command
      doc, ledger claim, red file, changeset) appears in THAT commit.
- [ ] R.3 **Lifecycle marker** (item 3): `rg -n "pm:lifecycle" openspec/changes/release-planning-taxonomy/tasks.md` lists C.2
      and C.3.
- [ ] R.4 **Attribute every commit** (item 4): `update-epic release-planning-taxonomy --attribute-commit <sha>` in landing
      order. Never attribute the archive move, or a lifecycle commit made after Gate 2 is recorded.
- [ ] R.5 **Cross-spec review** (item 5): satisfied by 0.4; re-run if any 0.56.0 spec changes after the verdict (0.5 can do it).
- [ ] R.6 **Disposition** (item 6): satisfied by C.2.
- [ ] R.7 **Route what the work taught you** (item 7), naming each as a practice, tooling friction or process failure, with
      evidence. Candidates: register the proposal's twelve Later/Next epics not already registered (run `/pm:triage` per
      ask first); file `/pm:feedback` for any emitted instruction that did not run as written; a lesson if the closed-list
      collisions of design D5 recur in a later change.
- [ ] R.8 **Prove every guard can fail** (item 8, the `mutation-pass` skill). Mutate each and confirm a test fails:
      - initiative: create-needs-both, the one-line and length checks, reserved `show`, id format, end and reopen state checks,
        the empty-reason refusal, milestone id reuse, the remove-reason requirement
      - references: the unknown-initiative refusal on epic and release, the integrity report, the export's `null` read
      - non-goals: the per-record counter, the whole-invocation refusal, the marked removal, the milestone exclusion
      - initiative: the outcome allowlist (`killed` refused), reach and unreach state checks, the `--clear` field list
      - release: the `--initiative`/`--maintenance` exclusion, `release here` refusal, the three-way split, the claude-code
        effective kind, the `null` share, both band edges (0.10 and 0.30 inside), the reason-does-not-change-drift rule,
        `primaryServed`, the join-time write and its removal on `--unmember`, the baseline's earliest-`startedAt` choice and its `null` with no member started
      - nudge: the release-member condition for the destinations text
      - epic: secondary-equals-primary, the kind allowlist, the warning's open-initiative, `claude-code`, `health` and
        recorded-reason conditions, the member warning's maintenance condition
      - rules block: both caps (280, 200) and both absent-when-empty rules
      - template: escaping of each new field, and the guided empty states
      Save and commit the run as `openspec/changes/release-planning-taxonomy/mutation-evidence.txt`. A surviving mutant is a
      finding to fix.

## G. Gate 2

- [ ] G.1 **Gate 2** over `BASE..HEAD` (review `standard`): spec alignment for the four specs, no network or git in the engine,
      zero runtime dependencies, the closed lists of design D5 intact, the template security rules, the Inverses table,
      release discipline. Record it with `--base-sha`/`--head-sha` reaching every attributed commit.

## D. Docs (after Gate 2 only)

- [ ] D.1 Update `README.md` (the `initiative` verb, the epic and release flags, the 80/20 report; the cost row landed in 6.2).
      The Mintlify pass is separate and later, per the `mintlify-doc-sync` skill, or carried to the release cut.

## V. Release discipline (0.56.0, at the cut, per the `release-checklist` skill)

- [ ] V.1 Confirm `.changesets/release-planning-taxonomy.md` covers every user-facing change above.
- [ ] V.2 Bump `.claude-plugin/plugin.json` `version` to `0.56.0` at the release cut, not in this change.
- [ ] V.3 Consolidate the changeset into the `CHANGELOG.md` 0.56.0 entry.
- [ ] V.4 MIGRATIONS: none, because every key is additive (evidence: 8.2). If an Open question's answer added a transform,
      its entry is keyed to 0.56.0, additive and idempotent, and a state file written by 0.55.0 still loads.

## C. Close

- [ ] C.1 Re-record Gate 2 after the docs if the docs added commits. Re-record, never withdraw.
- [ ] C.2 <!-- pm:lifecycle --> **Disposition.** `update-epic release-planning-taxonomy --status archived --outcome delivered --reason "<why>"` with one `--deferral "<epicId>:proposal.md Non-goals of this change"` per registered Later/Next epic and one `--declined-deferral "<what>::<why not>"` per Later/Next item deliberately not registered (`--no-deferrals` only if the list is empty). Then `/pm:status`.
- [ ] C.3 <!-- pm:lifecycle --> **Archive.** `/opsx:archive release-planning-taxonomy`. Do NOT attribute the archive-move commit.
