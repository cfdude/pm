# Tasks

## Commit mechanics

- **TDD.** RED then GREEN, saved as `red-<task>.txt` here, one commit naming it.
- **Rungs.** The liveness comparison is a value (UNIT). `CLAUDE.md` bytes and mtime after archive,
  remove, un-archive, a no-op write and a refused write are bytes on disk (FILE, `scripts/test/assert/`).
- **Certify.** `conductor.mjs` is in both buckets' subjects and the rules block is a managed-rules
  surface: run `node scripts/test/drift.mjs --phase pre-commit` after staging and certify
  `functional` and `sweeps` as it names them.
- **Commits.** One conventional commit per task, explicit paths, never `--no-verify`; `git show --stat`
  (R.2) and `update-epic spend-guard-rules-section-follows-live-limits --attribute-commit <sha>` (R.4)
  after each.
- **Order.** Build first in Batch 1 with `dehardcode-openspec-change-root-in-instructions` (both touch
  the rules-block chokepoint; assessment build order).

## 0. Before any code

- [ ] 0.1 **Gate 1** (review `standard`) over the proposal, design, `specs/spend-guard/spec.md` and this
      file; fix Critical and Important; `openspec validate spend-guard-rules-section-follows-live-limits --strict`
      (read the exit status); `record-gate-review … --gate 1 --verdict pass --artifact <path>… --reviewer "<identity>"`.
- [ ] 0.2 **Cross-spec review of release 0.53.0** (item 5), release-scoped. The rules block is also edited by `feature-switches-audit`. Name the chokepoint: the
      `spend-guard` spec is also edited by `gh-cfdude-pm-251` (other requirements); the rules block is
      also edited by `dehardcode-openspec-change-root-in-instructions` (other text).

## 1. Refresh on a liveness change

- [x] 1.1 TDD (UNIT): a pure `guardLivenessChanged(before, after)` over two state objects, true exactly
      when `guardConfigured()` differs. Cover archive, remove, un-archive, an epic-layer limit on an
      epic moved between archived and not, and a project limit present throughout (false).
- [x] 1.2 TDD (FILE): in the dispatch wrapper, for a NON-hook verb that wrote state only (design D1a),
      take the before-image from the snapshot already loaded, read the after-image once, and call
      `writeRules()` when 1.1 is true and the verb did not already refresh (design D3). Hook verbs are
      derived from `hooks/hooks.json`, never typed; cover "A hook does no liveness comparison" with the
      observe-reads fixture (no extra `state.json` read on PreToolUse) and a `commit-nudge` self-heal. Cover every scenario of the MODIFIED requirement, including mtime unchanged
      on a no-op write and on a refused write, and the warning on a failed refresh (design D4).
- [x] 1.3 Changeset fragment `.changesets/spend-guard-rules-section-follows-live-limits.md`.

## R. Required task items (CLAUDE.md "The gate procedure", items 1–7)

- [x] R.1 **Call-site completeness sweep** (item 1). Derive mechanically:
      `rg -n "status\s*=\s*\"archived\"|\.status\s*=|epics\.splice|epics\s*=\s*.*filter|spendGuard\s*=" scripts/lib scripts/conductor.mjs`
      lists every writer that can change an epic's archived status, existence or epic-layer limit;
      `rg -n "writeRules\(" scripts/` lists every refresh. For each writer state that it runs inside the
      dispatch wrapper (covered by 1.2) or why not. Name any hook path that writes state (none is
      expected) and why it is excluded. Inverse: archive ↔ un-archive and add ↔ remove are both covered
      by the same comparison. Save as `call-site-sweep-R.1.txt`.
- [ ] R.2 **Verify against the commit** (item 2).
- [ ] R.3 **Lifecycle marker** (item 3): C.2 and C.3.
- [ ] R.4 **Attribute every commit** (item 4); never the archive move.
- [ ] R.5 Cross-spec review (item 5): 0.2.
- [ ] R.6 Disposition (item 6): C.2.
- [ ] R.7 **Route what the work taught you** (item 7). Candidate practice to name: "a section gated on
      derived state is refreshed on the derivation's change, not at each writer".

## G. Gate 2

- [ ] G.1 **Gate 2** over `BASE..HEAD` (or the converged `rc/0.53.0` review): every liveness writer
      covered, no rewrite on a no-op, no hook does guard work. Record with SHAs reaching every
      attributed commit.

## D. Docs (after Gate 2 only)

- [ ] D.1 None user-facing: the section now does what `commands/set-spend-guard.md` already says. State
      that in the closeout.

## C. Close

- [ ] C.1 Re-record Gate 2 if anything was attributed after it.
- [ ] C.2 <!-- pm:lifecycle --> **Disposition.** `update-epic spend-guard-rules-section-follows-live-limits --status archived --outcome delivered --reason "<why>" --no-deferrals`, then `/pm:status`.
- [ ] C.3 <!-- pm:lifecycle --> **Archive.** `/opsx:archive spend-guard-rules-section-follows-live-limits`. Not attributed.
