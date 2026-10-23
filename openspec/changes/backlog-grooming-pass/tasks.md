# Tasks

## Commit mechanics

- **TDD.** Every behaviour task is RED then GREEN, with the failing run saved as `red-<task>.txt` here
  and landed in ONE commit with its GREEN, whose message names that file.
- **Rungs.** The `listRow` values are values the engine produced over an in-memory store: UNIT. The
  skill and command doc are bytes: checked by the parity test and a doc assertion on the file rung.
- **Certify.** `scripts/lib/list.mjs` is engine source: stage exactly, run
  `node scripts/test/drift.mjs --phase pre-commit`, certify each bucket it names, commit plainly.
- **Commits.** One conventional commit per task, explicit paths, never `--no-verify`; after each,
  `git show --stat <sha>` (R.2) and `update-epic backlog-grooming-pass --attribute-commit <sha>` (R.4).

## 0. Before any code

- [ ] 0.1 **Gate 1** (review `standard`) over `proposal.md`, `design.md`, both spec files and this file.
      Fix Critical and Important, re-run `openspec validate backlog-grooming-pass --strict`, then
      `record-gate-review backlog-grooming-pass --gate 1 --verdict pass --artifact <path>… --reviewer "<identity>"`.
- [ ] 0.2 **Cross-spec review** (item 5), release-scoped: the release holding this change carries two
      or more spec files (this change alone has two), so invoke the `cross-spec-review` skill before
      `/opsx:apply` and after any concurrent amendment, then
      `record-cross-spec-review <releaseId> --verdict pass|fail --reviewer "<identity>"`. Name the shared
      chokepoints: `docs/parity-ledger.json` (new commands elsewhere in the release),
      `scripts/lib/constants.mjs` (this change adds no flag; confirm), and the epic
      `triage-surfaces-open-release-intents`, which also touches the triage surface this pass calls.

## 1. The list row

- [x] 1.1 RED (UNIT): `listRow()` reports `release`, `createdAt`, `description`, `outcome`, with `null`
      for absent or non-string values (an empty-string `description` reports `""`); `list --json` keeps
      `{count, epics}`; the text form is unchanged. UPDATE `scripts/test/unit/list-verb.test.mjs:38-45`,
      the only consumer that deep-compares a whole row, to the wider shape. Regression guard: `list
      --release` and `--priority` are already refused as unknown flags; the requirement is that NO
      registry row is added. Save `red-1.1.txt`.
- [x] 1.2 GREEN: widen `listRow()` in `scripts/lib/list.mjs`; `filterEpics` and `listText` untouched.

## 2. The procedure

- [x] 2.1 RED (file rung): `skills/backlog-grooming/SKILL.md` and `commands/backlog-grooming.md` exist;
      the ledger claims them in exactly one capability (`scripts/test/parity.test.mjs` fails first);
      the skill names the per-status `list --status <s> --json` first read, `triage`, the disposition order
      of design D5, and the no-line-number rule. The doc assertion ADDITIONALLY asserts that the skill
      states: null `createdAt` means age unknown; a re-report of delivered work is found by reading
      archived epics; an unfinished consolidation is reported; the report names what it left alone;
      nothing is written before the user confirms; no direct read of `state.json`. Save `red-2.1.txt`.
- [x] 2.2 GREEN: write the skill and the command doc; add the capability to `docs/parity-ledger.json`
      in the same commit; update the JSON shape line in `commands/list.md`; add
      `.changesets/backlog-grooming-pass.md`.

## R. Required task items (CLAUDE.md "The gate procedure", items 1–7)

- [x] R.1 **Call-site completeness sweep** (item 1): `rg -n "listRow|filterEpics" scripts` and
      `rg -n "list --json|list\b.*--json" commands skills scripts/lib/rules.mjs` derived mechanically;
      state where the wider row is read and why `listText` stays as it is. Data references: the three
      new row fields are copies of epic fields, written nowhere by this change. **Inverse question:**
      name the inverse of each operation added (a wider row has none to ship; supersede and decline are
      undone LOSSILY: reopen B with `update-epic B --status untriaged`, then clear A's links with
      `--clear-links` and re-add the ones to keep with their reasons, because no single-link removal
      exists) and justify each not shipped.
- [x] R.2 **Verify against the commit** (item 2): `git show --stat <sha>` per task; every file the
      task claims appears in THAT commit, not only in the working tree.
- [x] R.3 **Lifecycle marker** (item 3): `rg -n "pm:lifecycle" openspec/changes/backlog-grooming-pass/tasks.md`
      lists C.2 and C.3.
- [x] R.4 **Attribute every commit** (item 4): `update-epic backlog-grooming-pass --attribute-commit <sha>`
      in landing order, never the archive move.
- [ ] R.5 **Cross-spec review** (item 5): satisfied by 0.2; record the verdict against the release.
- [ ] R.6 **Disposition** (item 6): satisfied by C.2.
- [ ] R.7 **Route what the work taught you** (item 7): name each lesson as a practice, tooling friction
      or process failure, with evidence. File `/pm:feedback feature "update-epic --unlink
      <type>:<epic>"` (tooling friction: undoing one `supersedes` link today costs `--clear-links` plus
      re-adding every other link). Candidate: the brief named `epic-index` and `list` specs that
      do not exist on disk; if the spec set has no owner for `list`, file that.

## G. Gate 2

- [ ] G.1 **Gate 2** over `BASE..HEAD` (or the converged release-candidate review): spec alignment,
      additive row, no new verb or flag, disposition order in the skill. Record with
      `--base-sha`/`--head-sha` reaching every attributed commit.

## D. Docs (after Gate 2 only)

- [ ] D.1 README and Mintlify: the new skill and command and the wider `list --json` row, per the
      `mintlify-doc-sync` skill, or carried to the release cut.

## C. Close

- [ ] C.1 Re-record Gate 2 after docs. Re-record, never withdraw.
- [ ] C.2 <!-- pm:lifecycle --> **Disposition.** `update-epic backlog-grooming-pass --status archived --outcome delivered --reason "<why>" --no-deferrals`, then `/pm:status`.
- [ ] C.3 <!-- pm:lifecycle --> **Archive.** `/opsx:archive backlog-grooming-pass`. The archive-move commit is NOT attributed.
