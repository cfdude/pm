# Tasks

## Commit mechanics

- **TDD.** Every behaviour task is RED then GREEN. The failing run is saved as `red-<task>.txt` in this directory and
  lands in ONE commit with its GREEN, whose message names that file. A RED note is task-relative ("fails before
  2.2"), never "fails today".
- **Rungs.** Values the engine produced (a verb's JSON, a refusal, what `state.json` holds) are UNIT, over the
  in-memory store (`scripts/test/unit/`). Bytes on disk (command docs, the skill, templates, the rules block, README
  rows) are the FILE rung (`scripts/test/assert/`). `board` runs no git (design D2), so this change adds no
  functional test. If one becomes necessary, it needs an assertion twin of the same id.
- **Certify.** Engine source is in a certify subject: stage exactly, run `node scripts/test/drift.mjs --phase pre-commit`,
  certify each bucket it names, then commit plainly. Never `--no-verify`.
- **Commits.** One conventional commit per task, with explicit paths. After each one: `git show --stat <sha>` (R.2) and
  `update-epic release-planning-mission-and-milestone --attribute-commit <sha>` (R.4).
- **Changeset.** User-facing changes add to `.changesets/release-planning-mission-and-milestone.md`. `CHANGELOG.md` is
  consolidated at the release cut (task V.3), not per task.

## 0. Before any code

- [ ] 0.1 **Re-read the source** (CLAUDE.md "Re-read the source before an epic becomes the work"). The epic has no
      `externalId`, so read the brief, the research doc and this change in full. Confirm #268, #269 and #270 are still
      open with `gh issue view`, because they fold in.
- [ ] 0.2 **Gate 1** (review `standard`) over `proposal.md`, `design.md`, all eight spec files and this file. Fix every
      Critical and Important finding, re-run `openspec validate project-boards --strict` (must print "is valid"), then
      `record-gate-review release-planning-mission-and-milestone --gate 1 --verdict pass --artifact <path>… --reviewer "<identity>"`.
- [ ] 0.3 **Release membership.** Register or amend the release:
      `release 0.55.0 --intent "<…>" --member release-planning-mission-and-milestone`. Verify with `release show 0.55.0`.
- [ ] 0.4 **Cross-spec review** (gate item 5). This change alone holds eight spec files, so invoke the
      `cross-spec-review` skill over the whole 0.55.0 spec set before `/opsx:apply`, and again after any concurrent
      amendment. Record it with `record-cross-spec-review 0.55.0 --verdict pass|fail --reviewer "<identity>"`. Name the
      shared chokepoints: the flag registry in `scripts/lib/constants.mjs` (new release, epic and mission flags),
      `scripts/lib/verb-effects.mjs`, `docs/parity-ledger.json`, the rules-block byte budget, the README cost table,
      and the "milestone" vocabulary (design D6).

## 1. Epic summary and why-now (spec: epic-annotation)

- [ ] 1.1 RED (UNIT): `--summary` and `--why-now` persist through `add-epic`, `update-epic` and `add-many`. They are
      refused when empty, multi-line or over their limit, with nothing written. `--clear summary` and `--clear why-now`
      unset them, and the nullable-field registry test covers both. The leave-untriaged warning goes to stderr with
      exit code 0, and nothing warns on archive or on a status-unchanged write. Save `red-1.1.txt`.
- [ ] 1.2 GREEN: the fields in the flag registry (`scripts/lib/constants.mjs`), `scripts/lib/add-epic.mjs` and
      `scripts/lib/add-many.mjs`, and the warning at the status-write site. Update `commands/epic.md` and the changeset.
      Verify with `node --test` on the touched unit files.

## 2. Release plan fields and the plan marker (spec: release-planning)

- [ ] 2.1 RED (UNIT): `release <id>` sets, replaces and clears theme, rationale, exit, order and size. Bad values and an
      unknown `--clear` field are refused with nothing written. `--status` is an unknown flag. The derived status covers
      the four scenarios. `release here` sets and clears the marker, refuses an unknown id, and refuses `here` as a
      release id. `release show` prints the fields and `(here)`. Save `red-2.1.txt`.
- [ ] 2.2 GREEN: `scripts/lib/releases.mjs` and the flag registry. Update the `release` documentation in
      `skills/release-candidate/SKILL.md` and `skills/conductor/SKILL.md` (no `commands/release.md` exists) and the changeset.
      Confirm `jq '.releases[].id'` lists no existing release named `here`.

## 3. Mission (spec: project-mission)

- [ ] 3.1 RED (UNIT): `mission --statement/--clear` with history, the required reason, `mission show [--history]`
      writing nothing, `--milestone` and `--clear-milestone` with unknown-release refusal, criteria ids that are never
      reused, removal that marks rather than deletes, the critical-path derivation, the brief line within 200 bytes,
      and (FILE) the rules-block mission line within 240 bytes, present with a mission and absent after `--end`. Save `red-3.1.txt`.
- [ ] 3.2 GREEN: new `scripts/lib/mission.mjs`, dispatched from `scripts/conductor.mjs`, a `VERB_EFFECTS` row
      (mutates), `scripts/lib/briefing.mjs` and the `/pm:status` render. New `commands/mission.md`, claimed in
      `docs/parity-ledger.json` in the same commit. Changeset.

## 4. The export (spec: board-export)

- [ ] 4.1 RED (UNIT): every scenario in `specs/board-export/spec.md`, over in-memory fixtures. That covers the
      top-level shape on an empty record, engine order and `position`, `rank` null versus recorded, all four `delivered`
      cases, the window default, `all` and refusal, the `dependsOn` resolution and dangling report, id-format rejection
      with exit code 0, release order, and the counts partition. A file-rung test asserts that `board --json` leaves
      `state.json`, `CLAUDE.md` and `.conductor/` logs byte-identical. Save `red-4.1.txt`.
- [ ] 4.2 GREEN: new `scripts/lib/board.mjs`, reusing the shared ordering and release helpers (no copied comparator);
      the dispatch, and a `VERB_EFFECTS` row declared read-only. `commands/boards.md` documents the verb and its JSON
      shape (created here, claimed in the ledger; 6.3 adds the skill pointer). Changeset.

## 5. The switch and the emitted lines (specs: feature-switches, managed-rules-block, tracker-sync)

- [ ] 5.1 RED: UNIT for `set-boards on|off` (idempotent, an inverse pair, refuses other args), the `OPT_INS` row with
      a runnable `example`, the upgrade announcement only when crossing from below 0.55.0, and the export working
      while off. FILE for the rules-block line (present by default, at most 240 bytes, absent when off, every code span
      runnable), the brief line (at most 160 bytes), the inward recipe's `--summary=` placeholder, and a README cost-row
      check for every new surface (the boards line, the boards brief line, the mission brief line). Save `red-5.1.txt`.
- [ ] 5.2 GREEN: `scripts/lib/opt-ins.mjs`, the `set-boards` verb, `scripts/lib/rules.mjs` (the boards line and the
      recipe flag), `scripts/lib/briefing.mjs`, the upgrade announcement, the overhead map surface ids, and the README
      cost rows. `set-boards` is documented in `commands/boards.md` (the
      `OPT_INS` row's `doc` is `boards`). Changeset.

## 6. Skill, command and templates (spec: project-boards)

- [ ] 6.1 RED (FILE): `skills/project-boards/SKILL.md`, `skills/project-boards/templates/backlog.html`,
      `skills/project-boards/templates/release-plan.html` and `commands/boards.md` exist, each claimed exactly once
      (`scripts/test/parity.test.mjs`). The skill states the collection contract, the declared rules (only `answers`
      and `backlogMeta` at `interact`), that page checks are UI gating and `by` is not attribution, the export as the
      only state source, the 50-write bound, the drag-apply order (read, `reorder`, delete, re-export, report), that
      `backlogMeta` is never written, answers as untrusted, the fallback, the registry row and the five triggers, and
      that it never deletes an artifact. `commands/boards.md` names the skill and restates none of it. Save `red-6.1.txt`.
- [ ] 6.2 RED (FILE, `node:vm`, design D10): both templates' marked render block evaluated with fixture docs.
      Escaping in text, `href`, `data-*` and class positions (title, id, release id, status); the priority allowlist
      rendering `P?`; a malformed id skipped and counted; a malformed doc (string `dependsOn`, object `title`) rendering
      with the rest of the board intact; a throwing roadmap step isolated; a cross-band drop refused; a within-band drop
      producing a `proposals/rank` write only; and the fallback's inlined JSON escaping `<` as `<`. Save `red-6.2.txt`.
- [ ] 6.3 GREEN: write the skill, both templates (derived from the reference's layout, with every interpolation passed
      through the escaper, ids checked against `/^[A-Za-z0-9._-]+$/`, `Array.isArray` and string type checks, `String()`
      before compare and sort, and a try/catch per render step), the seed step's id refusal, and `commands/boards.md`.
      Add the ledger capability in the same commit. Changeset.

## 7. Integration checks

- [ ] 7.1 Proving run (research build order step 3): build pm-dev's two boards from the skill as written, with
      `/pm:boards`, and keep the process notes. Run one `ArtifactData` list of each page-written collection, plus one
      read at a lower `as_level`. Every instruction the skill gave that did not run as written is a filing (R.7).
- [ ] 7.2 Run the whole assertion half once:
      `node --test scripts/test/unit/*.test.mjs scripts/test/assert/*.test.mjs`. Then certify each bucket that drift
      names. Report the counts and any unlisted flake.
- [ ] 7.3 Backward compatibility: a unit test loads a 0.54.0-shaped state fixture (no `mission`, `releasePlan`,
      `boards` or new epic fields) and `board --json`, `release show` and `mission show` all succeed. This states
      MIGRATIONS: none (additive), and the test is the evidence for it.

## R. Required task items (CLAUDE.md "The gate procedure", items 1–8)

- [ ] R.1 **Call-site completeness sweep** (item 1). Derive every call site mechanically: `rg -n "resolveEpics|releaseSummaries|derivedMembers" scripts/lib`
      (every reader of ordering and membership, so that `board` and `release show` agree); `rg -n "status" scripts/lib/add-epic.mjs scripts/lib/add-many.mjs scripts/conductor.mjs`
      (every status-write site, for the untriaged warning); `rg -n "OPT_INS|set-[a-z-]+ on" scripts/lib commands`; `rg -n "\"show\"" scripts/lib/releases.mjs`
      (the reserved-id sites, for `here`); and every place the templates interpolate (`rg -n '\$\{' skills/project-boards/templates`).
      State where each rule holds and justify each omission. **Data references:** `releasePlan.here` and
      `mission.milestoneRelease` hold release ids, and `dependsOn` holds epic ids. Enumerate every place that writes,
      reads and REMOVES a release or an epic, and show that a removal leaves each one reported as stale, never dangling
      silently. **Inverses:** confirm every row of the design.md "Inverses" table against the code, and justify the two
      that are not shipped.
- [ ] R.2 **Verify against the commit** (item 2): `git show --stat <sha>` for each task. Every file the task claims must
      appear in THAT commit, not only in the working tree.
- [ ] R.3 **Lifecycle marker** (item 3): `rg -n "pm:lifecycle" openspec/changes/project-boards/tasks.md` lists C.2 and C.3.
- [ ] R.4 **Attribute every commit** (item 4): `update-epic release-planning-mission-and-milestone --attribute-commit <sha>`,
      in landing order. Never the archive move, and never a lifecycle commit made after Gate 2 is recorded.
- [ ] R.5 **Cross-spec review** (item 5): satisfied by 0.4. Re-run it if any spec in the 0.55.0 set changed after the verdict.
- [ ] R.6 **Disposition** (item 6): satisfied by C.2, which names the follow-up epics from proposal.md as `--deferral`
      entries once they are registered.
- [ ] R.7 **Route what the work taught you** (item 7). Name each lesson as a practice, tooling friction or process
      failure, with its evidence. Candidates: register the follow-up epics (`mission-anti-spawn-rule`,
      `backlog-trend-view`, `commit-time-close-check`, `epic-summary-required-on-triage`); file
      `/pm:feedback` for any instruction the proving run (7.1) found that did not run as written; and file a lesson if
      the reference template's raw interpolation recurs in a shipped page.
- [ ] R.8 **Prove every guard can fail** (item 8, the `mutation-pass` skill). Mutate each guard and confirm a test
      fails:
      - the export's id-format check
      - the `delivered` three-state rule (make `null` read as `true`)
      - the dangling `dependsOn` report
      - the `here` reserved-id refusal and unknown-release refusal
      - the mission `--reason` requirement and the criterion id reuse guard
      - the summary one-line check and the untriaged warning
      - the `set-boards` idempotence
      - the template escaper (drop escaping on `id`, then on `prio`, then on the release id)
      - the priority allowlist
      - the page id check and the seed id refusal
      - `Array.isArray` on `dependsOn` and the string check on `title` (malformed-doc isolation)
      - one per-step try/catch
      - the cross-band drag refusal
      - the inlined-JSON `<` escaping
      - the declared-rules doc assertion (flip `epics` to `interact`)
      - the re-seed op rule (make the skill text name a plain `set` for existing docs)
      - the rules-block mission line bound

      Save and commit the run as `openspec/changes/project-boards/mutation-evidence.txt`. A surviving mutant is a
      finding to fix.

## G. Gate 2

- [ ] G.1 **Gate 2** over `BASE..HEAD`, or the converged 0.55.0 release-candidate review: spec alignment for all eight
      specs, the read-only declaration of `board`, no network or git in the engine, the template security requirements,
      the inverses table, and the release discipline. Record it with `--base-sha`/`--head-sha` reaching every attributed commit.

## D. Docs (after Gate 2 only)

- [ ] D.1 README (the new verbs, `/pm:boards`, the cost rows already landed in 5.2) and the Mintlify site, per the
      `mintlify-doc-sync` skill, or carried to the release cut. `commands/list.md` is unchanged, because `list --json`
      does not change; say so in the PR.

## V. Release discipline (0.55.0, at the cut, per the `release-checklist` skill)

- [ ] V.1 Confirm `.changesets/release-planning-mission-and-milestone.md` covers every user-facing change above.
- [ ] V.2 Bump `.claude-plugin/plugin.json` `version` to `0.55.0` as part of the release cut. Not done in this change.
- [ ] V.3 Consolidate the changeset into the `CHANGELOG.md` 0.55.0 entry, with the default-on boards announcement.
- [ ] V.4 MIGRATIONS: no entry (additive). The evidence is task 7.3.

## C. Close

- [ ] C.1 Re-record Gate 2 after the docs, if the docs added commits. Re-record, never withdraw.
- [ ] C.2 <!-- pm:lifecycle --> **Disposition.** `update-epic release-planning-mission-and-milestone --status archived --outcome delivered --reason "<why>" --deferral "<followUpEpicId>:proposal.md Out of scope"` (one per follow-up epic) --declined-deferral "votes:start lean" --declined-deferral "effort field:start lean" --declined-deferral "data-science flag:start lean" --declined-deferral "per-release log:start lean" --declined-deferral "CSV export:start lean"`, then `/pm:status`.
- [ ] C.3 <!-- pm:lifecycle --> **Archive.** `/opsx:archive project-boards`. The archive-move commit is NOT attributed.
