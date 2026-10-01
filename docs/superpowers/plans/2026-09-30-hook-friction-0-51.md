# hook-friction-0-51 — six papercuts the hooks and nudges put in front of agents

Epic: `hook-friction-0-51` (0.51.0 batch 2, superpowers lane). Items 1, 2 and 6 are user-facing (changeset
`.changesets/hook-friction-0-51.md`); 3, 4 and 5 are repo-internal or message-only.

## Items

1. **Attribution nudge ignores bookkeeping.** `scripts/lib/subcommands.mjs` `attributionNudge`: per commit, a
   changed-path list of only `.conductor/**`, `PROJECT.md` and/or a change MOVED under
   `openspec/changes/archive/` (recognised by pairing `changes/<id>/<rest>` with `archive/<date>-<id>/<rest>`,
   because `diff-tree` runs without rename detection) gets "needs no attribution". New predicate
   `isAttributionBookkeeping`, deliberately not a widening of `isConductorOwnFiles` (detour logging uses it).
2. **The active epic is a candidate, not the owner.** Both single-candidate branches say "the engine cannot
   tell whether this commit is `<id>`'s work … if it is, record it" unless a commit's subject names the id
   (`subjectNamesEpic`) or its paths touch the epic's own artifacts. (The brief's "note 6" is read as item 2.)
3. **Amend + Twin-Unchanged.** `.githooks/commit-msg` reads its parent's command line (no hook argument or env
   var distinguishes an amend: measured, `prepare-commit-msg` gets source `message` for `--amend -m`), stops at
   the first message flag so a message mentioning `--amend` is not one, and passes drift an optional `--amend`;
   `scripts/test/drift.mjs` `stagedFiles` then diffs against `HEAD^` (a root commit: the whole index).
4. **Every stale bucket in one run.** Measured first: `checkAll` already maps over both buckets and the G1 case
   already pins both demands — no logic change. Added `staleBucketsLine`, so the closing line names each stale
   bucket's exact command instead of "functional|sweeps".
5. **`delivered-release-epic-left-open`.** No clean rule: the schema has no cut-epic field, no parent pointer and
   no delivery marker, and `carriedTo` says nothing about the release's own state. Per the brief's fallback the
   rule is unchanged, the finding names the `--status active` workaround, and the doc comment records that the
   rule NEEDS A DECISION.
6. **`ensureGitignore` names the Honcho outbox.** `.conductor/honcho-memories.log` joins `ENGINE_IGNORED`
   (so `upgrade` and `init` write it, and a repo that tracks it gets the untrack block). `.test-flakes.log` stays
   a root `.gitignore` line only (done in the flaky-test-quarantine epic).

## Order, and why (certify)

`scripts/test/drift.mjs` is runner code: certify refuses to run while it differs between the working tree and
the index. So the flaky-test epic is committed and certified first, then items 3 and 4 together (both edit
drift.mjs and the hooks), then the engine items. `CLAUDE.md` and `.conductor/` are watched by the isolation guard:
editing them while a certify or a commit hook runs fails every test file running at that moment (learned the
hard way on this branch: 14 files red, one edit).

## Tasks

- [x] 1. Item 1 and 2: predicate, hedged wording, functional + unit tests
- [x] 2. Item 3: commit-msg detection, drift `--amend`, five functional cases, one text-guard twin
- [x] 3. Item 4: reproduction (already reported), closing line, tests
- [x] 4. Item 5: message names the workaround, doc comment, unit test; flagged as needing a decision
- [x] 5. Item 6: `ENGINE_IGNORED`, `commands/upgrade.md`, assert test
- [ ] 6. Orchestrator: attribute commits, decide item 5's rule, archive <!-- pm:lifecycle -->
