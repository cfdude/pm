## Why

The PostToolUse `commit-nudge` hook is the engine's only observer of commits, and it reads one
thing: the top entry of the HEAD reflog, compared against a watermark left by the previous hook
run. That single read is wrong in both directions — it misses commits a tool call made and it
claims commits the call did not make — and the detour trail it feeds has had
five rows removed from `detours.log` by hand across two repositories in seven days (#184 and its
comments, 2026-09-09 to 2026-09-15).

Every defect below was reproduced on the 0.44.0 engine in a hermetic scratch repository
(`scratchpad/propose45/commit-nudge-reads-the-whole-move/`, `lib.sh` + fixtures `r1`, `r1a`, `r4`,
`r5-flat`, `r5-nested`, `r6`), with an active epic `epic-a` and the hook invoked the way
`hooks/hooks.json` invokes it:

1. **A commit followed by a checkout in the same call is never reported.** `r1a`: commit
   `fix: one` (f103352), `git checkout -b tmp`, `git checkout main`, then the hook → empty output,
   no `detours.log`. `.conductor/commit-watch.json` already holds `f103352…`, so the next call is
   also silent: the commit is permanently invisible, not deferred. The reflog's top entry is
   `checkout: moving from tmp to main`, which `classifyMovement` reads as `no-commit`.
2. **Two commits in one call report only HEAD.** `r1`: `fix: two` (46f8340) and `fix: three`
   (3e74559) in one call → one AUTO-DETOUR row and one `--attribute-commit 3e74559…` command;
   46f8340 is named nowhere. Attribution is append-only, so an agent obeying the hint leaves the
   epic's record permanently short.
3. **A commit from another terminal is claimed by the next unrelated call.** `r1`: commit
   `chore: from another terminal` outside any tool call, then a hook run for an unrelated command
   → AUTO-DETOUR row against `epic-a` and an attribution command for it.
4. **`commit --amend` double-logs.** `r1`: `fix: amend me` (6bd2266) logged; `--amend` → a second
   row for 58985ed, while 6bd2266 is on no branch. The hint asks to attribute 58985ed and says
   nothing about 6bd2266 if it was already attributed.
5. **The active epic's own work is logged as a detour from it.** `r4`: a `fix(a):` commit touching
   `openspec/changes/epic-a/red-1.txt` plus two source files, a `chore(openspec): tick epic-a 1.1`
   commit touching only `openspec/changes/epic-a/tasks.md`, and `chore(release): v1.0.1` → three
   AUTO-DETOUR rows against `epic-a`. In this repository `67dbee6` and `cbe5be3` (both still in
   `.conductor/detours.log`) and `b2c5394` (removed by hand) each touch
   `openspec/changes/<active-epic>/red-*.txt`, were each logged as AUTO-DETOUR, and are each in that
   same active epic's `attributedCommits` today. `7ce3657` (`chore(argv-surface)`, 2 files, no
   change-dir path, removed by hand) is the case no path rule reaches.
6. **A nested conductor logs its own bookkeeping.** `r5-nested` (conductor at `projects/sub/`):
   `chore(conductor): register epic-b` touching only `projects/sub/.conductor/state.json` and
   `projects/sub/PROJECT.md` → AUTO-DETOUR row; `r5-flat`, same commit → no row. `git diff-tree`
   prints git-root paths; `CONDUCTOR_OWN_FILES` is conductor-root relative (#195). #195's suggested
   `--relative` is wrong: on a mixed commit touching `projects/sub/PROJECT.md` and `src/thing.mjs`,
   `--relative` prints only the conductor files, which would SUPPRESS a row for real work.
7. **During a detour the attribution hint names only the detour epic.** `r6`: `parent-a` paused
   behind `detour-b`; a commit touching only `openspec/changes/parent-a/tasks.md` → a DETOUR-COMMIT
   row for `detour-b` and `update-epic detour-b --attribute-commit …` as the only command (#199).
8. **The only correction path is a hand-edit.** The AUTO-DETOUR message says "edit/remove the
   line"; `detours.log` is git-ignored while the `PROJECT.md` it renders is tracked, so the removal
   is local and the false row is what gets committed (#173's comment).

## What Changes

- The hook bounds each Bash tool call with a per-call HEAD reflog snapshot taken at PreToolUse,
  and at PostToolUse **and PostToolUseFailure** reports every commit the reflog records inside that
  window, in the order they landed — regardless of checkouts, resets or pulls after them.
- Commits that landed outside any observed call (another terminal, a cancelled or backgrounded
  call) are never written to the detour trail and never named in an attribution command.
- An amend is a replacement: the replaced commit's trail row is retracted by the engine, and where
  the replaced commit is attributed the hint names the withdrawal before the new attribution.
- The AUTO-DETOUR heuristic stops logging a commit that touches the active epic's own artifacts;
  the DETOUR-COMMIT branch stops logging a commit confined to a paused epic's own artifacts; both
  compare changed paths against the conductor root, not the git root.
- **New verb `retract-detour <sha> --reason "<why>"`** — the inverse of auto-logging. Appends a
  retraction row (the trail stays append-only), re-renders `PROJECT.md`, and replaces the hook's
  "edit/remove the line" instruction.
- The ATTRIBUTION hint names every candidate epic (detour epic, each paused epic, any epic whose own
  artifacts the commit touches first), states the choice is the agent's, and still writes nothing.

## Capabilities

### New Capabilities
- `commit-observation`: what the commit hook observes per tool call, which commits it may report,
  when it writes a detour-trail row, how an amend is treated, and how a commit-derived row is
  retracted.

### Modified Capabilities
- `gate-integrity`: ADDED requirement — the post-commit attribution hint may rank candidate epics
  but never decides one, beside "Commit attribution is written by a named flag the emitted
  instructions require".
- `state-write-guard`: MODIFIED "Hooks never write over an unreadable state file and report it where
  it can be acted on" — `commit-nudge` now runs on three events; before a Bash call it never reads
  state and never exits 2 (exit 2 on PreToolUse denies the call; today's engine given a PreToolUse
  payload after a commit, with `state.json` unparseable, exits 2 — reproduced in fixture `rpre`).
- `conductor-record`: MODIFIED "A detached HEAD suppresses session-bookkeeping writes" — the per-call
  snapshot and the retraction row join the suppressed write sites.

## Impact

- `scripts/lib/commit-watch.mjs` (reflog window, per-call snapshot), `scripts/lib/subcommands.mjs`
  (`commitNudge`, `runNudge`, `attributionNudge`, `attributionTarget`, `headChangedFiles`,
  `isConductorOwnFiles`, `looksLikeUnloggedMinimalDetour`), `scripts/lib/git.mjs`
  (`appendDetourLog` takes a sha; retraction rows; dedupe), `scripts/lib/render.mjs` (retracted rows
  hidden), a new `retract-detour` verb (`conductor.mjs` dispatch, flag registry, positional table,
  `verb-effects.mjs`, help), `hooks/hooks.json` (PreToolUse and PostToolUseFailure wiring),
  `ensureGitignore` (snapshot directory), `commands/detour.md` (the doc that already covers `log-detour`, so no new command file and no `docs/parity-ledger.json` row).
- Cost: one extra `node` process per Bash call (PreToolUse). Measured: 10 no-op `commit-nudge` runs
  took 621 ms on this machine, about 62 ms each.
- No `state.json` schema change; no migration. `detours.log` gains one row kind.
