# Tasks

## Commit mechanics

- **TDD.** Every behaviour task is RED then GREEN. Save the failing run as `red-<task>.txt` in this directory and land
  it in ONE commit with its GREEN; that commit's message names the file. A RED note is task-relative ("fails before
  1.2"), never "fails today".
- **Order.** The export (section 1) comes first. Sections 2–4 assert their fields through `board --json`, so their
  RED tests fail on the missing field, not on a missing verb. Section 1 reads every new field as `null` when it is
  absent from the record.
- **Rungs.** Values the engine produced (a verb's JSON, a refusal, what `state.json` holds) are UNIT tests over the
  in-memory store (`scripts/test/unit/`). Bytes on disk (command docs, the skill, templates, the rules block, README
  rows) are FILE-rung tests (`scripts/test/assert/`). This change adds no functional test file. `board`'s
  `VERB_EFFECTS` `exercise` row is checked by the existing read-only check in the functional bucket, so staging
  `verb-effects.mjs` demands `certify functional` (design D2).
- **Certify.** Engine source is a certify subject. Stage exactly, run `node scripts/test/drift.mjs --phase pre-commit`,
  certify each bucket it names, then commit plainly. Never use `--no-verify`.
- **Commits.** One conventional commit per task, with explicit paths. After each commit, run `git show --stat <sha>`
  (R.2) and `update-epic project-boards --attribute-commit <sha>` (R.4).
- **Changeset.** Each user-facing change adds to `.changesets/project-boards.md`.
  `CHANGELOG.md` is consolidated at the release cut (task V.3), not per task.

## 0. Before any code

- [ ] 0.1 **Re-read the source** (CLAUDE.md "Re-read the source before an epic becomes the work"). The epic has no
      `externalId`, so read in full the brief, the research doc and this change. Confirm with `gh issue view` that
      #268, #269 and #270 are still open, because this change folds them in.
- [ ] 0.2 **Gate 1** (review `standard`) over `proposal.md`, `design.md`, all nine spec files and this file. Fix every
      Critical and Important finding, then re-run `openspec validate project-boards --strict`; it must print "is
      valid". Then run
      `record-gate-review project-boards --gate 1 --verdict pass --artifact <path>… --reviewer "<identity>"`.
- [ ] 0.3 **Release membership.** Register or amend the release with
      `release 0.55.0 --intent "<…>" --member project-boards`, and verify it with
      `release show 0.55.0`.
- [ ] 0.4 **Cross-spec review** (gate item 5). This change alone holds nine spec files, so before `/opsx:apply`, and
      again after any concurrent amendment, invoke the `cross-spec-review` skill over the whole 0.55.0 spec set.
      Record the verdict with `record-cross-spec-review 0.55.0 --verdict pass|fail --reviewer "<identity>"`. Name the
      shared chokepoints:
      - the flag registry in `scripts/lib/constants.mjs` (new release, epic and mission flags, and the valueless
        `clear-here`, `clear-milestone`, `end`, `needs-human` and `history` rows; the `clear` row's command list gains
        `release`)
      - `scripts/lib/verb-effects.mjs` (the `release` row text notes that `release here` writes)
      - `docs/parity-ledger.json`
      - the overhead map (`scripts/lib/overhead.mjs`)
      - the rules-block sections
      - the README cost table
      - the "milestone" vocabulary (design D7)

## 1. The export (spec: board-export)

- [x] 1.1 Refactor, with no behaviour change: extract `resolveEpics()`'s effective-priority and sort step into a pure
      exported function over an epic list, and call it from `resolveEpics()` (design D2). Verify that the existing
      ordering, render and brief tests pass unchanged; the commit carries no test edits.
- [x] 1.2 RED (UNIT, `boardSnapshot(state, resolved)` over fixtures): cover every scenario in
      `specs/board-export/spec.md`. That is:
      - the top-level shape and the `mission`/`milestone`/`plan` shapes
      - the render order, `position`, `meritPriority` and `rank`
      - unregistered changes counted and not listed
      - `updatedAt` from `touchedAt`
      - all five `delivered` cases, including the engine stamp `unknown`
      - the ended-epic window: its default, `all`, and refusal
      - `dependsOn` resolution and the dangling-target report
      - the id format applied to every emitted id field
      - the URL scheme rule
      - release order
      - the counts partition

      A file-rung test also asserts that `board --json` leaves `state.json`, `CLAUDE.md` and the `.conductor/` logs
      byte-identical. Save `red-1.2.txt`.
- [x] 1.3 GREEN: add `scripts/lib/board.mjs`, using `outcomeOf` and the shared ordering, with no copied comparator.
      Add the dispatch and a `VERB_EFFECTS` row (read-only, with `exercise: ["--json"]`). Add `commands/boards.md`
      documenting the verb and its JSON shape, and claim it in the ledger. Add the changeset. Then certify functional.

## 2. Epic summary and why-now (spec: epic-annotation)

- [x] 2.1 RED (UNIT): cover each of these.
      - `--summary` and `--why-now` persist through `add-epic`, `update-epic` and `add-many`, read back through
        `board --json`.
      - Both are refused when empty, multi-line or over their limit, and nothing is written.
      - `--clear summary` and `--clear why-now` unset them, and the nullable-field registry test covers both.
      - Leaving `untriaged` without them prints a warning on stderr and exits 0.
      - Nothing warns on archive or on a write that leaves the status unchanged.

      Save `red-2.1.txt`.
- [x] 2.2 GREEN: add the fields to the flag registry in `scripts/lib/constants.mjs`, update
      `scripts/lib/add-epic.mjs` and `scripts/lib/add-many.mjs`, and add the warning at every status-write site that
      R.1 enumerates, including `scripts/lib/update-epic.mjs` and the other writers (`active-pointer.mjs`,
      `detour-stack.mjs`, `subcommands.mjs`, `epic-progress.mjs`) wherever a write leaves `untriaged`. Update `commands/epic.md` and the changeset.

## 3. Release plan fields and the plan marker (spec: release-planning)

- [x] 3.1 RED (UNIT): cover each of these.
      - `release <id>` sets, replaces and clears theme, rationale, exit, order and size.
      - Bad values and an unknown `--clear` field are refused, with nothing written.
      - `--status` is an unknown flag.
      - The derived status matches all six scenarios, including the case where every member is archived without
        `--deliver`, and the case of no members.
      - `release here` sets the marker, and `--clear-here` (a valueless registry row) clears it.
      - `release here` refuses an unknown id and refuses `here` as a release id.
      - `release show` prints the fields, `(here)` and the critical-path marks.
      - `/pm:status` prints `here:` and the critical-path marks from the verb's own output, and neither appears in
        `PROJECT.md`.
      - `release here r2 --intent x` and `release here --text x` are refused.

      Save `red-3.1.txt`.
- [x] 3.2 GREEN: update `scripts/lib/releases.mjs`, the flag registry and the status render. Update the `release`
      documentation in `skills/release-candidate/SKILL.md` and `skills/conductor/SKILL.md` (no `commands/release.md`
      exists), and the changeset. Confirm with `jq '.releases[].id'` that no existing release is named `here`.

## 4. Mission (spec: project-mission, managed-rules-block's `## Mission`)

- [x] 4.1 RED: these are UNIT unless marked FILE.
      - `mission --statement` keeps a history, requires `--reason`, and writes nothing when the statement is
        unchanged.
      - `mission --end` keeps the ended statement in history, and is refused when there is no current mission.
      - `mission show [--history]` writes nothing.
      - `--milestone` refuses an unknown release, and `--clear-milestone` clears the milestone.
      - Criterion ids are never reused, and removing a criterion marks it rather than deleting it.
      - Critical path derives from the release order.
      - The brief's mission line is at most 200 bytes.
      - FILE: the `## Mission` section is at most 280 bytes, present while a mission exists, absent after `--end`,
        and rewritten by the `mission` verb.
      - FILE: `overhead` reports `rules:mission` under `core`.

      Save `red-4.1.txt`.
- [x] 4.2 GREEN: add `scripts/lib/mission.mjs` and its dispatch, a `VERB_EFFECTS` row (mutates), the valueless `end`
      and `clear-milestone` registry rows, `scripts/lib/briefing.mjs`, the `## Mission` section in
      `scripts/lib/rules.mjs` (outside `CONDITIONAL_SECTIONS`, refreshed by the verb), the `rules:mission` entry in
      `SURFACE_FEATURES`, the README cost row, and the `/pm:status` render. Add `commands/mission.md`, claimed in
      `docs/parity-ledger.json` in the same commit. Add the changeset.

## 5. The switch and the boards surfaces (specs: feature-switches, managed-rules-block, tracker-sync)

- [x] 5.1 RED: these are UNIT unless marked FILE.
      - `set-boards on|off` is idempotent, each undoes the other, and other arguments are refused.
      - The `OPT_INS` row (`doc: "boards"`) has a runnable `example`.
      - The upgrade announcement appears only when crossing from below 0.55.0.
      - The export still works while boards are off.
      - FILE: `## Boards` is at most 280 bytes, present by default, absent when off, and every code span in it runs
        as written.
      - FILE: the brief line is at most 160 bytes.
      - FILE: `overhead` reports `rules:boards` and `brief:boards` under `boards`, with `brief` excluding the line,
        and 0 bytes for `boards` when off.
      - FILE: the inward recipe carries the `--summary=` placeholder.
      - FILE: `upgrade` prints `boards: on (default)` in its `optInLines` output (`scripts/lib/opt-ins.mjs`).
      - FILE: the brief's boards and mission lines pass `fitBrief` (`BRIEF_BYTE_CAP`), are never shortened, and are
        measured after fitting.
      - FILE: README rows exist for `rules:boards` and `brief:boards`.

      Save `red-5.1.txt`.
- [x] 5.2 GREEN: update `scripts/lib/opt-ins.mjs`, the `set-boards` verb and its `VERB_EFFECTS` row,
      `scripts/lib/rules.mjs` (the `## Boards` section, verb-refreshed, and the recipe flag), and
      `scripts/lib/briefing.mjs`. Add the `<one-line summary>` substitution to `fillRecipe` in
      `scripts/test/functional/emitted-invocations.test.mjs` (~line 2378), which fills only known placeholders, with its
      assertion twin, and run `node scripts/test/certify.mjs functional`. Add the `brief:boards` surface in `scripts/lib/overhead.mjs`, the upgrade
      announcement and the README cost rows. Extend `commands/boards.md` with `set-boards`. Add the changeset.

## 6. Skill, command and templates (spec: project-boards)

- [x] 6.1 RED (FILE): these files exist and the parity test (`scripts/test/parity.test.mjs`) claims each exactly
      once:
      - `skills/project-boards/SKILL.md`
      - `skills/project-boards/templates/backlog.html`
      - `skills/project-boards/templates/release-plan.html`
      - `commands/boards.md`

      No `commands/board.md` exists. The skill states each of these:
      - the collection contract
      - the declared rules, with only `answers` and `backlogMeta` at `interact`
      - that page checks are UI gating only and `by` is not attribution
      - that the export is the only state source
      - the 50-write bound
      - the re-seed rule: `update`, or `set` with `if_version`, retried once then reported
      - the apply order: read, check, `reorder`, delete, re-export; one bad id refuses the whole proposal
      - that `backlogMeta` is never written
      - that `decisions` come from the agent and answers are untrusted
      - the fallback
      - the registry row and the five triggers
      - that it never deletes an artifact

      `commands/boards.md` names the skill and restates none of it. Save `red-6.1.txt`.
- [x] 6.2 RED (FILE, `node:vm`, design D13): evaluate each template's marked render block over fixture docs, and
      check each of these:
      - escaping in text, `href`, `data-*` and class positions, for the title, id, release id and status
      - the priority allowlist rendering `P?`
      - a `javascript:` URL rendering no `href`
      - a malformed id skipped and counted
      - a malformed doc (a string `dependsOn`, an object `title`) rendering while the rest of the board renders
      - a throwing roadmap step isolated
      - a cross-band drop refused
      - a lifted blocker with no drag handle
      - a within-band drop writing the whole merit band to `proposals/rank` and nothing else
      - the fallback's inlined JSON containing the six-byte sequence `\u003c` wherever the snapshot had `<`, and
        containing no other `</script`

      Save `red-6.2.txt`.
- [x] 6.3 GREEN: write the skill and both templates. The templates derive from the reference's layout, with these
      changes:
      - every interpolation goes through the escaper
      - ids are checked against `/^[A-Za-z0-9._-]+$/`
      - links render only for http and https
      - fields are type-checked with `Array.isArray` and string checks
      - values go through `String()` before compare and sort
      - each render step has its own try/catch

      Also write the seed step's id refusal, and add the skill pointer to `commands/boards.md`. Add the ledger
      capability in the same commit, and the changeset.

## 7. Integration checks

- [x] 7.1 Proving run (research build order step 3): build pm-dev's two boards from the skill as written, using
      `/pm:boards`, and keep the process notes. Run one `ArtifactData` list of each page-written collection, and one
      read at a lower `as_level`. Record that the page-written collections are exactly `answers`, `backlogMeta` and
      `proposals`. Every instruction from the skill that did not run as written is a filing (R.7).
- [x] 7.2 Run the whole assertion half once:
      `node --test scripts/test/unit/*.test.mjs scripts/test/assert/*.test.mjs`. Then certify each bucket drift names.
      Report the counts and any unlisted flake.
- [x] 7.3 Backward compatibility: a unit test loads a 0.54.0-shaped state fixture, with no `mission`, `releasePlan`,
      `boards` or new epic fields. `board --json`, `release show` and `mission show` must all succeed on it. This
      states that the new keys are additive (section 8 adds the one 0.55.0 migration, epic numbers), and the test is the evidence. Whether an older engine tolerates newer keys
      is not claimed (design, Migration Plan).

## 8. Board redesign (Rob feedback 2026-11-11)

8.0 to 8.6 are the engine half; 8.8 to 8.14 redraw the two templates and the skill on top of it. Specs:
`specs/project-identity/spec.md` (new), the "project, number and key" and "progress" requirements added to
`specs/board-export/spec.md`, and the six board-redesign requirements added to `specs/project-boards/spec.md`. Design D20 to D23.

- [x] 8.0 Docs of record: the `project-identity` spec, the `board-export` additions, design D20 to D23 and its Inverses and
      Migration Plan rows, the proposal bullets, this section. `openspec validate project-boards --strict` passes.
- [x] 8.1 RED then GREEN (UNIT `epic-numbers.test.mjs`, FILE `epic-numbers-files.test.mjs`): every epic carries a number,
      assigned in `pushEpic` through `assignEpicNumber` (`scripts/lib/epic-number.mjs`). Tracker integer first, else the
      counter, skipping held numbers; the counter only advances; no flag or batch key sets a number (the number follows the tracker-number keep rule, else the counter); remove and a
      changed `--external-id` do not free or change a number. RED: `red-8.1.txt` (fails before 8.1, the module is absent).
- [x] 8.2 RED then GREEN (UNIT `epic-numbers-migration.test.mjs`, FILE `epic-numbers-upgrade.test.mjs`): the `MIGRATIONS` entry
      keyed to 0.55.0 and the same function on every `upgrade`. `store.mjs`'s per-record comparison also ignores `number`, so a
      backfill is a recovery and not a touch (no epic reads as last touched on upgrade day). The two functional upgrade tests
      (`conductor-15` 7.1, `conductor-39` 2.5) pin the new entry count. RED: `red-8.2.txt` (fails before 8.2, `upgrade` does not number).
- [x] 8.3 RED then GREEN (UNIT `project-identity.test.mjs`): `set-project --name --key` with `--unset <name|key>`; registry rows,
      `VERB_POSITIONALS`, `VERB_EFFECTS`, dispatch and `USAGE`, `commands/set-project.md`, the parity ledger claim.
      RED: `red-8.3.txt` (fails before 8.3, `set-project.mjs` is absent).
- [x] 8.4 RED then GREEN (UNIT `board-export.test.mjs` additions): `project`, epic `number` and `key`, release `progress`, the
      `project` rejection kind. `schemaVersion` stays 1 (D21). RED: `red-8.4.txt` (fails before 8.4, the empty record lacks the new keys).
- [x] 8.5 Verify which verbs write each field the boards need, and make each discoverable from `--help` (UNIT):
      - release `theme`, `rationale`, `exit`, `order`, `size`: `release <id> --theme|--rationale|--exit|--order|--size`, each cleared
        with `--clear <field>`; `target` and `intent`: `release <id> --target|--intent`. `intent` has no clear (a release with no
        intent is what creation refuses). `target` had no inverse, so `--clear target` is added (the one code change in this task).
      - `plan.here`, `hereText`, `nextText`: `release here <id> [--text] [--next]`, removed together by `release here --clear-here`;
        no flag clears the text lines alone.
      - `mission.statement`, `milestone`, `criteria`: `mission --statement --reason`, `--end --reason`, `--milestone`,
        `--clear-milestone`, `--add-criterion [--check|--needs-human]`, `--remove-criterion`.
      - epic `summary`: `add-epic|update-epic|add-many --summary`, cleared with `update-epic <id> --clear summary` (an empty
        `--summary ""` is refused, not a clear). No code change.
      The other gap was discoverability: the `release` usage text and its missing-id error never named `release here` or the plan
      fields. Fixed in the same commit. RED: `red-8.5.txt` (the discoverability and `--clear target` tests fail before 8.5).
- [x] 8.6 Required items for section 8 (CLAUDE.md "The gate procedure"):
      - **Call-site sweep (item 1).** `rg -n "pushEpic\(" scripts/lib` lists the five creation call sites (`add-epic.mjs`,
        `add-many.mjs`, `subcommands.mjs` x3). The rule is bound inside `pushEpic`, so all five hold it; the source scan in
        `conductor-13.test.mjs` keeps a sixth from bypassing it. Readers of `number`: `board.mjs` (the export) and
        `epic-number.mjs`. Writers: `pushEpic` and `stampEpicNumbers` only. Removers: `remove-epic` deletes the whole epic record,
        which takes its number with it; the counter is untouched, so the number is not reissued to a plain registration.
        A DATA reference: nothing stores another epic's number, so no dangling reference exists.
      - **Inverses (item 1).** `set-project --name|--key` against `--unset name|key`: shipped. A number is never reassigned and
        `nextEpicNumber` never goes back, by design (design Inverses). `release --target` against `release --clear target`: shipped in 8.5 (design Inverses table, `release-planning` spec, mutants 110 and 111).
      - **Lifecycle (item 3).** Nothing in section 8 is lifecycle bookkeeping; C.2 and C.3 keep their markers.
      - **Verify against the commit (item 2).** `git show --stat` of `9cdbd672` (8.1, 8.2) and `3ae4f250` (8.3 to 8.5) lists every file the
        tasks above claim, including the command doc, the ledger claim and the three functional test files.
      - **Attribute (item 4).** Each feature commit is attributed on landing, and the bookkeeping commit is not.
      - **Guards proved (item 8).** Mutants 80 to 112b in `mutation-evidence.txt`: 33 mutants, 29 killed on first run, 4 survived (3 fixed by a
        new test, 1 equivalent and redone on the real line).
      - **Cross-spec (item 5).** `project-identity` joins the 0.55.0 spec set and `board-export` changed, so the recorded cross-spec
        verdict is stale and must be re-run; Gate 2 is stale for the same reason.

- [x] 8.7 RED then GREEN (UNIT `epic-numbers.test.mjs`, `epic-numbers-migration.test.mjs`; FILE `epic-numbers-upgrade.test.mjs`): the
      counter floor (design D23). Epics with no tracker number draw from a counter whose first value is 1000; a tracker issue number
      below 1000 that no epic holds is kept; a number at or above 1000, or held, falls back to the counter. `pushEpic` and the 0.55.0
      backfill and `upgrade` renumbering share the rule (`scripts/lib/epic-number.mjs`). Every test that pinned 267-style numbers
      (1, 2, 3, 257, 258, 10) now pins the floor. Guard proved: mutants 113 to 115 in `mutation-evidence.txt`. RED note: the RED run for 8.7 was done in-session and not saved to a file; the mutation evidence (mutants 113 to 131) is the proof the guards can fail.

- [x] 8.8 RED then GREEN (FILE `project-boards-templates.test.mjs` 8.8): ids are engine keys (`okKey`), the slug is secondary
      text, an epic with no key says "no key", dependency tags name keys; the table sits under "Epics" with a "Summary" column
      whose null summary falls back to the title, marked; titles read `<name> Backlog` / `<name> Release Plan` from
      `page/info.project` (`projOf` applies the `set-project` rules) and fall back to the neutral title. RED note: the RED run was done in-session and not saved to a file; the mutation evidence (mutants 113 to 131) is the proof the guards can fail.
- [x] 8.9 RED then GREEN (FILE 8.9): `when()` formats every timestamp as "Nov 11, 2:10 PM" in the viewer's locale and zone
      (pinned in tests), adds the year across years and a relative phrase past one day; no raw ISO reaches any output. RED note: the RED run was done in-session and not saved to a file; the mutation evidence (mutants 113 to 131) is the proof the guards can fail.
- [x] 8.10 RED then GREEN (FILE 8.10): guided empty states (`need()`) for every null field each page needs, naming the command
      and who supplies it, with placeholders escaped; none on a fully populated board; no bare "not set". The backlog takes the
      Enterprise Portal layout (spine, group break, dot count pills, P0-P3 legend, Find/Priority/Status/Release/Lane filter grid
      with drag off while filtering, compact cards only for epics with a why-now or description, Delivered and Not pursuing
      tables with Restore); the release plan takes the Ivy layout (Last updated pill, mission, plan bar, dark "We are here"
      banner with the two-day stale warning, collapsible release cards with `progress` bars and a WE ARE HERE rule, criteria
      table, decisions with Agree/Disagree and Send). Write set unchanged: `backlogMeta`, `proposals/rank`, `answers`. RED note: the RED run was done in-session and not saved to a file; the mutation evidence (mutants 113 to 131) is the proof the guards can fail.
- [x] 8.11 RED then GREEN (FILE 8.11): security over the new fields: hostile project name, key, theme, target, here text, lane,
      progress and filter text stay inert; a new source scan refuses a markup string concatenated with anything but `esc()`,
      `num()`, `H()` or a finished render part, alongside the `${}` scan. RED note: the RED run was done in-session and not saved to a file; the mutation evidence (mutants 113 to 131) is the proof the guards can fail.
- [x] 8.12 RED then GREEN (FILE `project-boards-skill.test.mjs` 8.12): SKILL.md states that titles name the project and why the
      old rule is replaced, `page/info` carries `project`, the "First population" section with every verb and who supplies it
      (one batch, never invent, re-run the refresh), the refresh-time stale check, and the fallback's title substitution. RED note: the RED run was done in-session and not saved to a file; the mutation evidence (mutants 113 to 131) is the proof the guards can fail.
- [x] 8.13 Rendering verified for real: each template loaded through the standalone fallback with a populated and an empty
      snapshot, screenshotted at desktop and phone width in a browser, checked for horizontal overflow, raw ISO and code-name ids.
- [x] 8.14 Required items for 8.8 to 8.13 (CLAUDE.md "The gate procedure"):
      - **Call-site sweep (item 1).** `rg -n '\$\{' skills/project-boards/templates`: every site goes through `esc`/`num`/`H`,
        enforced by the `${}` scan; markup concatenation is enforced by the new 8.11 scan. Data reference `page/info.project` is
        written only by the refresh seed, read only by the two pages' render, and removed with `page/info`.
      - **Inverses (item 1).** A filter chip toggles off and Find clears; Set aside has Restore; an answer can be changed by
        picking the other stance. Renaming the project changes the tab and H1 on the next refresh, the gallery title only on a
        republish (stated in the skill).
      - **Verify against the commit (item 2).** `git show --stat` of the 8.8 to 8.13 feature commit lists both templates,
        SKILL.md, both test files and `specs/project-boards/spec.md`, and nothing else.
      - **Attribute (item 4).** The feature commit and this docs commit are attributed; the conductor bookkeeping commit is not.
      - **Lifecycle (item 3).** Nothing in 8.8 to 8.14 is lifecycle bookkeeping.
      - **Guards proved (item 8).** Mutants 116 to 131 in `mutation-evidence.txt`: 16 mutants, 15 killed on first run; 124 (an
        unparseable date) survived, its test was strengthened and the re-run killed it. Review-fix mutants 132 to 135 (duplicate number, code-point name length, whitespace-only name, target hint): 135 first survived and was fixed.
      - **Cross-spec (item 5).** `specs/project-boards/spec.md` changed, so the recorded 0.55.0 cross-spec verdict, Gate 1 and
        Gate 2 are stale again and must be re-recorded by the orchestrator.

## R. Required task items (CLAUDE.md "The gate procedure", items 1–8)

- [ ] R.1 **Call-site completeness sweep** (item 1). Derive every call site mechanically with these searches:
      - `rg -n "resolveEpics|orderQueueWithDependencies|releaseSummaries|outcomeOf" scripts/lib`: the readers of
        order, membership and outcome.
      - `rg -n "\.status\s*=|status:" scripts/lib scripts/conductor.mjs`: the status-write sites that need the
        untriaged warning (`add-epic`, `add-many`, `update-epic`, `active-pointer`, `detour-stack`, `subcommands`,
        `epic-progress` and any other hit).
      - `rg -n "OPT_INS|SURFACE_FEATURES|CONDITIONAL_SECTIONS" scripts/lib`.
      - `rg -n "\"show\"" scripts/lib/releases.mjs`: the reserved-id sites that `here` must join.
      - `rg -n 'externalUrl' scripts/lib skills/project-boards`.
      - `rg -n '\$\{' skills/project-boards/templates`: every template interpolation.

      State where each rule holds, and justify each omission.

      **Data references.** These fields hold record ids:
      - `releasePlan.here` and `mission.milestoneRelease` hold release ids.
      - `dependsOn` holds epic ids.
      - `proposals/rank` holds epic ids.

      Enumerate every place that writes, reads and REMOVES a release or an epic. Show that each removal leaves the
      reference reported as stale, never silently dangling.

      **Inverses.** Confirm every row of the design.md "Inverses" table against the code, and justify the two that
      are not shipped.
- [ ] R.2 **Verify against the commit** (item 2): run `git show --stat <sha>` for each task. Every file a task claims
      must appear in THAT commit, not only in the working tree.
- [ ] R.3 **Lifecycle marker** (item 3): `rg -n "pm:lifecycle" openspec/changes/project-boards/tasks.md` must list
      C.2 and C.3.
- [ ] R.4 **Attribute every commit** (item 4): run
      `update-epic project-boards --attribute-commit <sha>` in landing order. Never attribute
      the archive move, or a lifecycle commit made after Gate 2 is recorded.
- [ ] R.5 **Cross-spec review** (item 5): satisfied by 0.4. Re-run it if any spec in the 0.55.0 set changes after the
      verdict.
- [ ] R.6 **Disposition** (item 6): satisfied by C.2.
- [ ] R.7 **Route what the work taught you** (item 7). Name each lesson as a practice, tooling friction or process
      failure, with its evidence. Candidates:
      - Register the follow-up epics: `mission-anti-spawn-rule`, `backlog-trend-view`, `commit-time-close-check` and
        `epic-summary-required-on-triage`.
      - File `/pm:feedback` for each instruction the proving run (7.1) found that did not run as written.
      - File a lesson if the reference template's raw interpolation recurs in a shipped page.
- [x] R.8 **Prove every guard can fail** (item 8, the `mutation-pass` skill). Mutate each guard below and confirm that
      a test fails:
      - **Export:**
        - the id-format check, both on own ids and on reference fields
        - the URL scheme check
        - the `delivered` rule: make `unknown` read as `true`, then make a missing disposition read as `true`
        - the dangling `dependsOn` report
        - the `--archived` bound
      - **Releases and mission:**
        - plan-field validation for size, order and newline
        - the `here` reserved-id refusal and the unknown-release refusal
        - the mission milestone unknown-release refusal
        - the mission `--reason` requirement, the same-statement no-op, and the `--end` with no mission refusal
        - the criterion-id reuse guard
      - **Epic fields and switch:**
        - the summary one-line check and the untriaged warning
        - `set-boards` idempotence
        - the `## Boards` and `## Mission` byte bounds
      - **Templates:**
        - the escaper: drop escaping on `id`, then on `prio`, then on the release id
        - the priority allowlist
        - the page link-scheme check
        - the page id check and the seed id refusal
        - `Array.isArray` on `dependsOn` and the string check on `title`
        - one per-step try/catch
        - the cross-band drag refusal and the lifted-blocker no-drag rule
        - the inlined-JSON `<` escaping
      - **Skill text:**
        - the declared-rules doc assertion: flip `epics` to `interact`
        - the re-seed op rule: make the skill text name a plain `set` for existing docs
        - the answers-are-untrusted rule: drop the "no pm verb runs until the user confirms" line from the skill

      Save and commit the run as `openspec/changes/project-boards/mutation-evidence.txt`. A surviving mutant is a
      finding to fix.

## G. Gate 2

- [x] G.1 **Gate 2** over `BASE..HEAD`, or the converged 0.55.0 release-candidate review. Review:
      - spec alignment for all nine specs
      - `board` declared read-only
      - no network or git in the engine
      - the template security requirements
      - the inverses table
      - release discipline

      Record it with `--base-sha`/`--head-sha` reaching every attributed commit.

## D. Docs (after Gate 2 only)

- [ ] D.1 Update the README (the new verbs and `/pm:boards`; the cost rows already landed in 4.2 and 5.2) and the
      Mintlify site, per the `mintlify-doc-sync` skill, or carry them to the release cut. `commands/list.md` is
      unchanged because `list --json` does not change; say so in the PR.

## V. Release discipline (0.55.0, at the cut, per the `release-checklist` skill)

- [ ] V.1 Confirm `.changesets/project-boards.md` covers every user-facing change above.
- [ ] V.2 Bump `.claude-plugin/plugin.json` `version` to `0.55.0` as part of the release cut, not in this change.
- [ ] V.3 Consolidate the changeset into the `CHANGELOG.md` 0.55.0 entry, including the default-on boards
      announcement.
- [ ] V.4 MIGRATIONS: one entry keyed to 0.55.0 (epic numbering, task 8.2). Everything else is additive; the evidence for that is task 7.3.

## C. Close

- [ ] C.1 Re-record Gate 2 after the docs, if the docs added commits. Re-record, never withdraw.
- [ ] C.2 <!-- pm:lifecycle --> **Disposition.** First end the superseded brief epic: `update-epic release-planning-mission-and-milestone --status archived --outcome superseded --reason "built as project-boards" --no-deferrals`. Then `update-epic project-boards --status archived --outcome delivered --reason "<why>" --deferral "<followUpEpicId>:proposal.md Out of scope" --declined-deferral "votes:start lean" --declined-deferral "effort field:start lean" --declined-deferral "data-science flag:start lean" --declined-deferral "per-release log:start lean" --declined-deferral "CSV export:start lean" --declined-deferral "size weight:start lean" --declined-deferral "critical-path marks in the brief RELEASES lines:brief is capped; status and boards carry them"`, with one `--deferral` per registered follow-up epic. Then run `/pm:status`.
- [ ] C.3 <!-- pm:lifecycle --> **Archive.** `/opsx:archive project-boards`. Do NOT attribute the archive-move commit.
