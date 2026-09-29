# brief-txt-tracked-in-fleet-repos — plan

**Goal.** `.conductor/brief.txt` stops being a committed file that churns on every SessionStart/PreCompact
snapshot, in every pm-managed repo: `ensureGitignore()` ignores it (and every other engine-written
per-checkout file it misses), and a repo where such a file is ALREADY tracked is told the exact
command that untracks it. pm never runs `git rm` itself — it is an instruction layer.

## Premise, verified against today's code (dev @ ce6674b6)

- `ensureGitignore()` (`scripts/lib/subcommands.mjs`) lists detours.log, write-conflicts.log,
  write-conflicts.latch, commit-watch.json, commit-observe.json*, session-claim.json*,
  state.json.lock*, state.json.tmp*, activity/ — and NOT `brief.txt`. This repo ignores it only
  because its own hand-written `.gitignore` line 2 says so. Confirmed.
- `brief.txt` is written by the `brief` (SessionStart) and `snapshot` (PreCompact) hooks
  (`lib/verb-effects.mjs`, `constants.mjs` `briefPath`).
- A SECOND gap of the same class: `store.rotate()` renames `write-conflicts.log` to
  `write-conflicts.log.prev` (`rotateWriteConflictsLog`, store.mjs). Nothing ignores it —
  `git check-ignore` matches no rule, not even a global `*.log`.
- `.conductor/agent-logs/` is written only by `scripts/agent-log.sh`, this repository's own
  multi-agent tooling, into this repo's main checkout. No user flow reaches it → NOT added.
  The record-isolation fixture header claims every SESSION_BOOKKEEPING entry is ignored by
  `ensureGitignore`; that claim is corrected for agent-logs/.
- `honcho-memories.log` is ignored here only by the maintainer's global `*.log` (#106's pattern),
  but it is not session bookkeeping — it is a durable local log someone may track on purpose.
  Out of scope; reported for its own epic.
- Adding an ignore line does nothing for a file already in the index. `upgrade()` already prints a
  copy-pasteable `COMMIT THIS UPGRADE` block (migrations.mjs); the untrack instruction follows that
  precedent.

## Decisions

- **Export the list** as `ENGINE_IGNORED` so the detector and the writer can never disagree.
- **Detector**: one `gitOps().lsFiles(ENGINE_IGNORED)` call (existing gateway operation, cwd-relative
  like tool-currency's), each output line mapped back to the ENTRY it falls under (exact = equal,
  `*` = prefix, `/` = directory prefix). Print the ENTRIES, single-quoted, never the ls-files output:
  git expands a quoted glob against the index itself, `activity/` never expands into N segment
  names, and no repository-derived string is interpolated into output.
- **Output**, before `COMMIT THIS UPGRADE`, on stderr, own commit line, notes `--cached` keeps the
  files on disk. Silent when git cannot answer (no repo / unborn / any throw) — same as the nudge.
- **Callers** (`rg -n 'ensureGitignore\(\)' scripts/lib`): `init()` and `upgrade()`. Both emit the
  instruction through one shared helper.
- **MIGRATIONS: no.** Nothing in `state.json` is transformed; `upgrade()` re-runs
  `ensureGitignore()` on every run, so existing repos pick the lines up — the precedent every
  earlier addition to this list recorded.
- **Inverse**: re-tracking is not shipped. pm only instructs; a stale ignore line is harmless and
  `ensureGitignore()` has never removed a line (precedent). Justified omission.

## Tasks

1. **Ignore list (FILE rung, `assert/conductor-12.test.mjs`).**
   RED: `init` writes `.conductor/brief.txt` and `.conductor/write-conflicts.log.prev` to `.gitignore`
   — fails today. GREEN: add both entries, export `ENGINE_IGNORED`. Mutation: drop either entry →
   red. Also correct the record-isolation header's agent-logs claim.
2. **Untrack instruction.**
   RED (functional, `functional/upgrade-commit-nudge.test.mjs`): a committed repo with
   `.conductor/brief.txt` force-added and `.gitignore` lacking it; `upgrade` prints a `git rm` line;
   running that line EXACTLY leaves `ls-files` empty, the file on disk, and a second `upgrade` prints
   no untrack block. Twin (`assert/upgrade-commit-nudge.test.mjs`): outside a repo no `git rm` line
   is printed. GREEN: `trackedEngineIgnored()` + `untrackLines()` in subcommands.mjs, called from
   `init` and `upgrade`. Mutation: detector returns [] → functional red; drop the quoting → the
   printed glob still works? (proved by running the line).
3. **Docs + changeset.** `commands/upgrade.md` (the stale "three entries" paragraph → the full
   list + the untrack block); `.changesets/brief-txt-tracked-in-fleet-repos.md`.

## Required gate items

1. Call-site sweep — `rg -n 'ensureGitignore\(\)'`: init, upgrade; both emit. `rg -n 'lsFiles'`:
   tool-currency + this; gateway comment updated. Writers of `.conductor/*`: ARTIFACT table in
   store.mjs + `rotate()` + commit-watch.mjs + agent-log.sh — each accounted for above.
2. Verify against the commit: `git show --stat <sha>` per task.
3. No lifecycle task here (superpowers lane; the orchestrator archives).
4. Attribution: the orchestrator attributes after merge.
