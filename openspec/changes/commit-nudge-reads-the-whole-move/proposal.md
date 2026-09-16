## Why

The `commit-nudge` hook (PostToolUse) is the engine's only observer of commits, and it reads one
thing: the top entry of the HEAD reflog, compared against a watermark left by the previous hook
run. That single read is wrong in both directions — it misses commits a tool call made and it
claims commits the call did not make — and the detour trail it feeds has had
five rows removed from `detours.log` by hand across two repositories in seven days (#184 and its
comments, 2026-09-09 to 2026-09-15).

Every defect below was reproduced on the 0.44.0 engine in a hermetic scratch repository
(`scratchpad/propose45/commit-nudge-reads-the-whole-move/`, `lib.sh` + fixtures `r1`, `r1a`, `r4`,
`r5-flat`, `r5-nested`, `r6`, `rrb`), with an active epic `epic-a` and the hook invoked the way
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
   → AUTO-DETOUR row against `epic-a` and an attribution command for it. **This change does not
   close defect 3** (see What Changes): it states it in the hook's output and gives the row a verb
   to retract it.
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

Two cases today's engine gets right only by being silent, and which any reflog walk must not break
(fixture `rrb`, a clone with an upstream commit): `git commit` then `git pull --rebase` leaves the
original commit (e7c562d) reachable from no branch — `git for-each-ref --contains` lists 0 refs — and
`git commit` then `git reset --hard HEAD~1` does the same. Today's hook prints nothing for either,
because it reads only the top reflog entry. A walk that reported every `commit` entry would name
both dead shas as attributable.

## What Changes

- The post-call hook, wired on `PostToolUse` **and** `PostToolUseFailure` (no pre-call hook), keeps
  a reflog anchor — the byte size of HEAD's reflog file and its full last line — and reports every
  entry since the anchor whose action begins with `commit`, oldest first, whatever happened to HEAD
  afterwards. A shrunk or mismatched reflog is unverifiable and reports nothing from the reflog.
- Duplicate reports are prevented by a set of reported shas, so overlapping hook runs never drop or
  repeat a commit.
- Only commits reachable from a branch get a detour-trail row or an attribution command; the rest are
  named as rewritten or abandoned.
- The hook states that a reported commit landed since the last observation and may come from another
  terminal or a parallel call. Defect 3 is a stated residual, not a fix; `retract-detour` corrects a
  wrong automatic row.
- An amend is a replacement: the replaced commit's row is retracted by the engine, and where the
  replaced commit is attributed the hint names the withdrawal.
- The AUTO-DETOUR heuristic stops logging a commit that touches the active epic's own artifacts; the
  DETOUR-COMMIT branch stops logging a commit confined to a paused epic's own artifacts; both compare
  changed paths from the conductor root.
- **New verb `retract-detour <sha> --reason "<why>"`** — the inverse of automatic logging: appends a
  retraction row, re-renders `PROJECT.md`, and replaces the "edit/remove the line" instruction. Row
  matching is by prefix of the full sha, because row abbreviation lengths drift (personal-finance-paper's
  `detours.log` holds 7- and 8-character rows).
- The ATTRIBUTION hint names the detour epic, each paused epic, or the active epic — every candidate,
  each with its own command, stating the choice is the agent's. Changed paths only order those
  candidates; they never add one, and with no candidate the hint stays silent as today.
- The hook's output envelope names the event it answers (`PostToolUse` or `PostToolUseFailure`).
- A new observation record, `.conductor/commit-observe.json`, so an unreloaded 0.44.0 session writing
  `commit-watch.json` cannot clobber it.

## Capabilities

### New Capabilities
- `commit-observation`: what the post-call commit hook observes since its last observation, which
  commits it may report and with what provenance statement, when it writes a detour-trail row, how an
  amend is treated, and how a commit-derived row is retracted.

### Modified Capabilities
- `gate-integrity`: ADDED requirement — the post-commit attribution hint names every candidate epic
  among the detour, paused and active epics, may order them by changed paths, and decides none.
- `state-write-guard`: MODIFIED "Hooks never write over an unreadable state file and report it where
  it can be acted on" — `commit-nudge` runs on `PostToolUse` and `PostToolUseFailure`, and its one
  write exemption is the new observation record.
- `conductor-record`: MODIFIED "A detached HEAD suppresses session-bookkeeping writes" — the
  observation record and the retraction row are the suppressed write sites.

## Impact

- `scripts/lib/commit-watch.mjs` (reflog anchor, reported set, reachability), `scripts/lib/subcommands.mjs`
  (`commitNudge`, `runNudge`, `attributionNudge`, `attributionTarget`, `headChangedFiles`,
  `isConductorOwnFiles`, `looksLikeUnloggedMinimalDetour`, `ensureGitignore`), `scripts/lib/git.mjs`
  (`appendDetourLog` takes a sha; prefix match; retraction rows), `scripts/lib/render.mjs` (retracted
  rows hidden), a new `retract-detour` verb (`conductor.mjs` dispatch and USAGE, flag registry,
  positional table, `verb-effects.mjs`, help), `hooks/hooks.json` (`PostToolUseFailure`),
  `hooks/README.md`, `commands/detour.md` (already covers `log-detour`, so no new command file and no
  `docs/parity-ledger.json` row), `skills/conductor/SKILL.md`, `README.md`.
- Cost: no new hook process on a successful Bash call. A failed Bash call gains one `commit-nudge`
  process, measured at 63 ms per no-op run (mean of 20 on this machine). Inside the hook, reading the
  reflog anchor is one `git rev-parse --git-path logs/HEAD` plus a file read (a shell running
  `rev-parse` and a 300-byte `tail` measured 11 ms per run, mean of 20). Reachability costs one
  `git for-each-ref --contains` per reported commit, only when a commit landed.
- Picked up with `/reload-plugins`; until then a session keeps 0.44.0's hook and engine.
- No `state.json` schema change; no migration. `detours.log` gains one row kind.
