# Tasks

## Commit mechanics

- **TDD.** The sweep test is the RED: it fails on today's 27 shipped lines plus `README.md`. Save the
  failing run as `red-1.1.txt` and land it with the text edits that turn it green in ONE commit.
- **Rungs.** The sweep reads shipped files on disk: FILE (`scripts/test/assert/`). The rendered rules
  block is a value: UNIT.
- **Certify.** `rules.mjs` is emitted text (a managed-rules surface) and the sweep names files the
  functional half observes: run `node scripts/test/drift.mjs --phase pre-commit` after staging and
  certify every bucket it names.
- **Commits.** One conventional commit per task, explicit paths, never `--no-verify`; `git show --stat`
  (R.2) and `update-epic dehardcode-openspec-change-root-in-instructions --attribute-commit <sha>` (R.4).
- **Order.** Build first in Batch 1 with `spend-guard-rules-section-follows-live-limits` (shared
  `rules.mjs`). Measure `node scripts/conductor.mjs rules --sections` before 1.2 and after, for the
  closeout.

## 0. Before any code

- [x] 0.1 **Gate 1** (review `standard`) over the proposal, design, `specs/emitted-instructions/spec.md` (Gate 1 pass recorded 2026-10-20)
      and this file; fix Critical and Important; `openspec validate dehardcode-openspec-change-root-in-instructions --strict`
      (read the exit status); `record-gate-review … --gate 1 --verdict pass --artifact <path>… --reviewer "<identity>"`.
- [x] 0.2 **Cross-spec review of release 0.53.0** (item 5), release-scoped. The rules block is also edited by `feature-switches-audit`. Chokepoint: the rules block, (release 0.53.0 cross-spec pass, fixed at 8c4b1c78)
      also edited by `spend-guard-rules-section-follows-live-limits`.

## 1. The sweep and the edits

- [x] 1.1 TDD (FILE): a sweep over the population `emitted-instructions` derives (reuse its enumerator;
      do not type a list) failing on any `openspec/changes/` not preceded by `by default ` (design D2),
      naming file and line. UNIT twin for the rendered rules block and brief across platforms.
- [x] 1.2 Re-derive the sites with `rg -n "openspec/changes" commands agents skills hooks README.md scripts/lib/rules.mjs`
      and rewrite each to the D1/D3 form, keeping meaning. `agents/reconciler.md` names
      `openspec status --change <paused> --json` → `changeRoot` (spec scenario). The emitted
      `rules.mjs` line keeps its meaning: the archive-move commit is never attributed.
- [x] 1.3 Changeset fragment `.changesets/dehardcode-openspec-change-root-in-instructions.md`.

## R. Required task items (CLAUDE.md "The gate procedure", items 1–7)

- [x] R.1 **Call-site completeness sweep** (item 1). The rule's sites ARE the `rg` output in 1.2: save it
      before and after as `call-site-sweep-R.1.txt`, with every remaining hit justified (the D2 form
      only). List engine-printed messages that keep the literal (`rg -n "openspec/changes" scripts/lib`
      restricted to string literals) and state why each is out of scope (the engine reads that path).
      Inverse: none owed (a text rule, not an operation).
- [x] R.2 **Verify against the commit** (item 2).
- [x] R.3 **Lifecycle marker** (item 3): C.2 and C.3. (C.2 and C.3 carry the marker)
- [x] R.4 **Attribute every commit** (item 4); never the archive move.
- [x] R.5 Cross-spec review (item 5): 0.2. (by 0.2)
- [x] R.6 Disposition (item 6): C.2, carrying the engine-path declined deferral. (by C.2)
- [x] R.7 **Route what the work taught you** (item 7). Evidence to weigh: the site count grew 4 → 27 while (process failure: the site count grew 4 to 27 while open and the citation was wrong twice, so sites are derived by rg at build time, never typed; see epic notes)
      the epic was open, and its own citation was wrong twice (epic notes).

## G. Gate 2

- [x] G.1 **Gate 2** over `BASE..HEAD` (or the converged `rc/0.53.0` review): every directive rewritten (converged Gate 2 recorded at 8c4b1c78)
      with meaning kept, the sweep derives its population, `rules --sections` delta reported.

## D. Docs (after Gate 2 only)

- [ ] D.1 Mintlify pages mirroring `commands/status.md`, `epic.md`, `sync.md`, `detour.md`,
      `cross-spec-review.md`, per the `mintlify-doc-sync` skill. README is edited in 1.2.

## C. Close

- [x] C.1 Re-record Gate 2 after docs if a docs commit was attributed. (no attributed commit after the recorded Gate 2 at 8c4b1c78)
- [x] C.2 <!-- pm:lifecycle --> **Disposition.** `update-epic dehardcode-openspec-change-root-in-instructions --status archived --outcome delivered --reason "<why>" --declined-deferral "engine path handling and printed messages:the engine reads openspec/changes/ itself, so naming it is true; following changeRoot in the engine is a relocation feature"`, then `/pm:status`.
- [x] C.3 <!-- pm:lifecycle --> **Archive.** `/opsx:archive dehardcode-openspec-change-root-in-instructions`. Not attributed.
