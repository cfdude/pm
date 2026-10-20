# Tasks

## Commit mechanics

- **TDD.** RED then GREEN, saved as `red-<task>.txt` here, one commit naming it.
- **Rungs.** Every assertion is a value over the in-memory store (the record after a verb, a refusal,
  the no-op report): UNIT. The documented-surface coverage check is the existing FILE-rung test.
- **Certify.** `constants.mjs` and the save path are in both buckets' subjects: stage exactly, run
  `node scripts/test/drift.mjs --phase pre-commit`, certify what it names.
- **Commits.** One conventional commit per task, explicit paths, never `--no-verify`; `git show --stat`
  (R.2) and `update-epic epic-session-attribution --attribute-commit <sha>` (R.4) after each.
- **Order.** Batch 1, after the two `rules.mjs` changes and before the analysis (assessment build order;
  shares `constants.mjs` with every new verb in the batch).

## 0. Before any code

- [x] 0.1 **Gate 1** (review `standard`) over the proposal, design, `specs/epic-session-trail/spec.md` (Gate 1 pass recorded 2026-10-20)
      and this file; fix Critical and Important; `openspec validate epic-session-attribution --strict`
      (read the exit status); `record-gate-review epic-session-attribution --gate 1 --verdict pass --artifact <path>… --reviewer "<identity>"`.
- [x] 0.2 **Cross-spec review of release 0.53.0** (item 5), release-scoped. Chokepoint: the shared flag (release 0.53.0 cross-spec pass, fixed at 8c4b1c78)
      allowlist in `constants.mjs`, also grown by `decision-cost-log` (`record-decision`) and
      `token-spend-analysis-and-recommendations`.

## 1. The flag

- [x] 1.1 TDD (UNIT): widen the `session` row's `commands` to every epic-writing verb, derived from the
      same set the allowlist's other epic rows use (never a typed list). Cover the three scenarios of
      "--session is accepted by every epic-writing verb"; the existing documented-surface test passes
      with `commands/epic.md` updated in the same commit.
- [x] 1.2 TDD (UNIT): identity validation (design D3), refusing before any write. It also binds `claim` and
      `unclaim` (same resolver): say so in the changeset, and cover one claim refusal.
- [x] 1.3 TDD (UNIT): derive "every epic-writing verb" from `verb-effects` entries marked `mutates` that
      write an epic, and assert each accepts `--session`; add a set-only nullability marker for
      `epic.sessions` with its reason (epic-annotation "Nullability is declared").

## 2. The trail

- [x] 2.1 TDD (UNIT): in the save, stamp every epic whose record changed with the resolved identity
      (design D1, D2, D4), on non-hook verbs only (design D4a; hook verbs derived from `hooks/hooks.json`).
      Cover "A hook's self-heal save stamps nothing" and "A hook never refuses on the identity". Cover every scenario of "A changed epic records the session that changed it",
      including the no-op byte-identity and the 0.52.0 fixture.
- [x] 2.2 `commands/epic.md`: `--session` and `epic.sessions`; changeset fragment
      `.changesets/epic-session-attribution.md`.

## R. Required task items (CLAUDE.md "The gate procedure", items 1–7)

- [x] R.1 **Call-site completeness sweep** (item 1). `rg -n "resolveSession|PM_SESSION|flag: \"session\"" scripts/`:
      every resolver call and its precedence; `rg -n "saveState\(" scripts/lib` lists every save that
      can change an epic, each stated as stamped or justified (a save that changes no epic). Data
      reference: `epic.sessions` holds identities, not ids, so no dangling-reference sweep is owed;
      enumerate its writer (one), readers and REMOVE path (`remove-epic`). Inverse: none shipped,
      justified by design D5. Save as `call-site-sweep-R.1.txt`.
- [x] R.2 **Verify against the commit** (item 2).
- [x] R.3 **Lifecycle marker** (item 3): C.2 and C.3. (C.2 and C.3 carry the marker)
- [x] R.4 **Attribute every commit** (item 4); never the archive move.
- [x] R.5 Cross-spec review (item 5): 0.2. (by 0.2)
- [x] R.6 Disposition (item 6): C.2. (by C.2)
- [x] R.7 **Route what the work taught you** (item 7). Weigh the epic's own history: two agents disagreed (lessons in epic notes)
      about what had shipped until it was re-verified against HEAD (epic note).

## G. Gate 2

- [x] G.1 **Gate 2** over `BASE..HEAD` (or the converged `rc/0.53.0` review): one save writes the (converged Gate 2 recorded at 8c4b1c78)
      trail, no-op preserved, every epic-writing verb declares the flag through the allowlist.

## D. Docs (after Gate 2 only)

- [ ] D.1 README one line under the epic record; Mintlify `epic` page, per `mintlify-doc-sync`.

## C. Close

- [x] C.1 Re-record Gate 2 after docs if a docs commit was attributed. (no attributed commit after the recorded Gate 2 at 8c4b1c78)
- [ ] C.2 <!-- pm:lifecycle --> **Disposition.** `update-epic epic-session-attribution --status archived --outcome delivered --reason "<why>" --declined-deferral "linking a named session to a transcript sessionId:pm cannot observe the mapping; a later change may record it when the agent supplies both"`, then `/pm:status`.
- [ ] C.3 <!-- pm:lifecycle --> **Archive.** `/opsx:archive epic-session-attribution`. Not attributed.
