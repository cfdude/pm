## Context

See proposal.md "Why" for the eight reproduced defects. Current shape, read at `dev` f49871a:

- `hooks/hooks.json` wires `commit-nudge` on **PostToolUse(Bash) only**. Claude Code fires PostToolUse
  only when a tool call succeeds; a failed call fires `PostToolUseFailure`, and a cancelled call
  fires neither (code.claude.com/docs/en/hooks, "PostToolUseFailure"). PostToolUse fires
  concurrently for parallel tool calls. PreToolUse, PostToolUse and PostToolUseFailure all carry
  `tool_use_id`.
- `commit-watch.mjs` `observeCommit()` compares HEAD against a single watermark
  (`.conductor/commit-watch.json`) and, when HEAD moved, reads `git reflog -1`. The three-valued
  verdict (`landed` / `no-commit` / `unverifiable`) and the unverifiable rung's text heuristic
  (`unverifiableSubject`) exist so the archived-epic self-heal still runs without git.
- `subcommands.mjs` `runNudge()` writes DETOUR-COMMIT (detour live) or AUTO-DETOUR
  (`looksLikeUnloggedMinimalDetour`) through `git.mjs` `appendDetourLog(kind, epic, note)`, which
  derives the sha from `gitShortSha()` (HEAD) and dedupes commit-derived kinds on `(sha, kind)`.
- `headChangedFiles()` runs `git diff-tree … HEAD`, whose paths are git-root relative, and is
  compared to `CONDUCTOR_OWN_FILES`, which is conductor-root relative.
- `attributionTarget()` picks exactly one epic (the detour epic if a detour is live, else the
  active epic) and `attributionNudge()` prints one command for one sha.
- `render.mjs` shows the last 8 lines of `detours.log` verbatim.
- Measured cost of one no-op `commit-nudge` process: 10 runs in 621 ms (~62 ms each).

## Goals / Non-Goals

**Goals:** every commit a call made is seen; nothing a call did not make is claimed; an amend is a
replacement; the auto-detour heuristic stops firing on the two measured false-positive classes (own
artifacts, nested bookkeeping); every automatic row has a verb-shaped inverse; the attribution hint
ranks without deciding.

**Non-Goals:**
- Widening the commit-creating reflog actions to `revert`, `cherry-pick`, `merge`, `rebase`
  (unchanged, per `COMMIT_ACTION`'s own comment).
- A subject-prefix rule for `chore(release)` / `chore(conductor)` (#184's first suggestion). Its
  comments argue against a prefix list and this change agrees: `chore(openspec)` joined the list the
  week after it was proposed. A release commit that touches none of the active epic's artifacts
  stays auto-logged and is retracted with the new verb.
- Recognising pm-written lines inside `.gitignore` or the managed block of `CLAUDE.md` (#173's
  broader suggestion). Deciding that a hunk is "pm's" means diffing file content against what
  `ensureGitignore`/`writeRules` would emit; declined here because the file-list rule already covers
  `/pm:upgrade`'s state/PROJECT.md commits, and the retract verb covers the rest.
- A monorepo holding two conductors: a commit entirely outside this conductor's root is still
  classified by this conductor's hook as today. See Open Questions.
- Retracting `MINIMAL` rows: the agent declared them, and their sha is HEAD at declaration time, not
  an identity (`COMMIT_DERIVED_KINDS` comment in `git.mjs`), so a sha cannot select one.

## Decisions

### 1. Bound the call with a PreToolUse reflog snapshot, not a time window

`commit-nudge` is additionally wired on **PreToolUse(Bash)** and **PostToolUseFailure(Bash)**. It
reads `hook_event_name` from its stdin payload and dispatches: pre-call → record; post-call (either
event) → observe. No new verb and no new flag, so the argv surface (verb-surface) is untouched.

Pre-call writes `.conductor/commit-watch/<tool_use_id>.json` holding the HEAD reflog's top entry as
`{ sha, selector-time, subject }` (from `git reflog -1 --format=%H%x09%gd%x09%gs --date=unix`), or
an explicit empty marker when HEAD has no reflog yet. Post-call reads HEAD's reflog from the top
downward until it reaches the recorded entry; the entries above it are the call's window. If the
recorded entry is not found (reflog expired, rewritten), the window is unverifiable and Decision 3's
no-claim rule applies.

- *Alternative: `duration_ms` from the PostToolUse payload.* Rejected: optional in the payload, it
  excludes PreToolUse time, and reflog timestamps have one-second resolution — a window by time would
  misclassify any commit made within a second of the call's start.
- *Alternative: `git rev-list <watermark>..HEAD`* (the finding's suggested fix). Rejected: a commit
  made and then checked out away from (defect 1) is not reachable from HEAD; the reflog records it.
- *Alternative: reflog entry count.* Rejected: `git gc --auto`, which can run after a commit, expires
  old reflog entries from the bottom and changes the count.

**The pre-call path must never exit 2.** `refusal.mjs` `HOOK_ON_UNREADABLE` maps `commit-nudge` to "block"
(exit 2) by VERB name, which was right while the verb ran only on PostToolUse, where exit 2 is
advisory. On PreToolUse exit 2 denies the call, and today's engine, handed a PreToolUse payload after
a commit with `state.json` unparseable, exits 2 (fixture `rpre`) — so wiring it unchanged would wedge
every Bash call, including the one that repairs the file. The pre-call branch therefore runs before
`readStdin`'s consumers load state, never calls `loadState`, and is wrapped so any throw exits 0
with a stderr line; `refusalFor` gains the event (read from the payload the verb already parsed) so
the mapping cannot regress through a callee. A separate `commit-snapshot` verb was considered: it
would make the verb-keyed table correct by construction, but adds a sixth hook verb to
`verb-surface`'s enumerated `--platform` requirement, a `VERB_EFFECTS` row and a
`HOOK_DEFAULT_ON_UNREADABLE` entry — three surfaces to keep in step for one branch. Rejected; the
state-write-guard delta pins the behaviour either way.

A per-call file, not a key in `commit-watch.json`, because parallel calls run their pre- and
post-call hooks concurrently and a shared JSON object would lose writes. Post-call deletes its own
file. Orphans (a cancelled call fires no post-call hook) are pruned by the pre-call hook when older
than 24 hours. `ensureGitignore` gains `.conductor/commit-watch/`; `upgrade()` already re-runs it.

### 2. Report once: the announced position

`commit-watch.json` keeps its watermark and gains the reflog position of the newest commit already
reported. Post-call reports only window entries above it, then advances it with write-temp-and-
rename. Two overlapping calls therefore report a shared commit once. Residual race: two post-call
hooks reading the position before either writes can both report; the detour trail still holds one
row (`appendDetourLog`'s existing `(sha, kind)` dedupe), and the duplicate is in advisory text only.
Taking the state lock for this was considered and rejected: the lock guards `state.json`, and a
PostToolUse hook waiting on it would stall every Bash call behind a long-running verb.

### 3. What happens to commits outside the window

Commits between the watermark and the call's pre-call snapshot, and every commit when no snapshot
exists for the `tool_use_id`, are **unbounded**. The post-call hook names them in one sentence
("N commit(s) landed outside this tool call and were not logged or attributed: <short shas>") and
does nothing else with them: no detour row, no attribution command, no amend handling. The
archived-epic self-heal and `render()` still run, as today, because they are not about any commit.

This is a deliberate reduction on the fallback path: a session whose hook configuration predates
this release (plugin updated, not reloaded) loses AUTO-DETOUR logging until reload. Chosen over
keeping today's watermark behaviour there, which is exactly defect 3. The unverifiable rung (no git, or
reflogs disabled) is unchanged, including `unverifiableSubject`; "no watermark yet" stops being on
it whenever a pre-call snapshot exists, because the snapshot alone bounds the window.

### 4. Amend handling

An amend's reflog entry is `commit (amend): …`; the replaced commit is the new-sha of the entry
directly below it. Handling, in order: (a) retract every non-retracted commit-derived row whose sha
matches the replaced commit, reason `amended into <short new sha>`; (b) if any epic's
`attributedCommits` holds the replaced full sha, print
`update-epic <id> --withdraw-commit <replaced> --withdrawal-reason "amended into <new>"` for each;
(c) classify the replacing commit normally. Where an amend chain lands within one call
(commit, amend, amend), only the final commit is reported and every intermediate is treated as
replaced. The engine never runs the withdrawal: `--withdraw-commit` is a record write the rules
reserve for the agent.

The replaced commit is read from the reflog entry directly below the amend, whatever that entry's
action: it records HEAD's value immediately before the amend, which is the commit amended even when
a checkout or reset preceded it in the same call. Where no entry below exists (expired), the amend
is handled as an ordinary commit.

### 5. Changed paths relative to the conductor root

`headChangedFiles()` becomes `changedFiles(sha)` and returns paths relative to the conductor root by
stripping `git rev-parse --show-prefix` from each git-root path. A path that does not start with the
prefix is returned unchanged, so it can never equal a conductor-relative own file. #195's
`--relative` flag is rejected: it drops out-of-root paths entirely and so turns a mixed commit into
a bookkeeping-only one (proposal defect 6, verified in `r5-nested`).

### 6. Own artifacts

`ownArtifacts(epic)` = the prefix `openspec/changes/<epic.id>/` plus each normalized path in
`EPIC_SOURCE_ARTIFACTS` (`planPath`, `specPath`) the epic holds (`normalizeArtifactPath`). A changed
path matches when it equals a file artifact or lies under a directory artifact. Keyed on
`openspec/changes/<id>/` because `sync` registers an openspec change under its directory name; an
openspec epic registered under a different id (hand-added) does not match and keeps today's
behaviour. `specPath` is many-to-one (`source-artifacts.mjs`), so a shared spec file makes several
epics candidates — correct for ranking in Decision 8, harmless for suppression in Decision 7.

### 7. Detour-row rules

- AUTO-DETOUR: `looksLikeUnloggedMinimalDetour(subject, activeEpic, files)` gains
  "no changed path matches `ownArtifacts(active epic)`". The existing prefix, ≤3-file and bookkeeping
  tests are unchanged. `67dbee6`, `cbe5be3`, `b2c5394` and #184's `1f962d9` all touch their active
  epic's change directory; `7ce3657` does not and stays a false positive — the retract verb is its
  remedy.
- DETOUR-COMMIT: suppressed when every changed path matches the own artifacts of some epic paused on
  the stack, or is a pm-owned file. A commit touching the paused epic's artifacts AND detour code is
  still detour work and is logged.
- Both take the per-commit sha (Decision 9) and that commit's own file list, not HEAD's.

### 8. Attribution hint

`attributionCandidates(state, ctx, files)` returns ordered epics: those whose own artifacts the
commit touches (non-archived, carrying `attributedCommits`), then the detour epic, then paused epics
top of stack first, then the active epic when no detour is live — de-duplicated, each resolved
against `state.epics` and dropped when `attributedCommits` is absent (unchanged exemption). One
candidate prints today's sentence. Several print "ATTRIBUTION — candidates for <shas>; the engine
recorded nothing and choosing is yours:" followed by one command per candidate. The empty-array
escalation text applies per candidate. The archive-move exclusion sentence is printed once.

For a multi-commit call the file list used for ranking is the union of the commits' files; each
command lists `--attribute-commit` once per commit, oldest first.

### 9. Detour trail rows carry the commit they describe

`appendDetourLog(kind, epic, note, sha = gitShortSha())` — commit-derived callers pass the short sha
of the commit being logged. Dedupe keys on that sha. Every other caller (`log-detour`) keeps the
default.

### 10. `retract-detour`

`retract-detour <sha> --reason "<why>"`. Positional table: exactly one, not free text. Flag registry:
`reason` gains `retract-detour` in the push-detour row's `commands` or a row of its own (whichever
keeps `REASON_REQUIRES` semantics correct — decided at implementation, recorded in the commit).
`verb-effects.mjs`: `mutates`, writes `.conductor/detours.log (append-only), PROJECT.md`. In a
detached tree `appendDetourLog` writes nothing (gh#175), so the verb there exits non-zero saying no
retraction was written, rather than reporting one it did not make; it is not marked `detachedNoOp`
because its output would otherwise claim success.

Row: `<iso>\t<short sha>\tRETRACTED\t<epic of the retracted row>\t<reason>`. The sha is resolved
with `git rev-parse --verify <sha>^{commit}` then shortened the way `gitShortSha` shortens, so a full
or abbreviated spelling both match. Render filters: build the set of retracted shas, drop rows of
commit-derived kinds whose sha is in it, drop RETRACTED rows, THEN take the last 8. `alreadyLogged`
keeps counting a retracted sha as logged. The hook's AUTO-DETOUR message ends:
"If that's wrong: `retract-detour <sha> --reason \"<why>\"` (re-renders PROJECT.md)."

`purge-logs` truncates `detours.log` wholesale; a retraction row whose target was purged is inert.
No un-retract verb: a wrongly retracted row is re-declared with `log-detour`, which is what a
minimal detour's record is, and a retraction is itself a record that should not be erased.

## Risks / Trade-offs

- [Every Bash call now spawns two `node` processes, ~62 ms each measured] → the pre-call path does one
  `git reflog -1` and one small file write and returns before loading state; the dormant checks
  (`isInitialized`, detached tree) run first.
- [Fallback path loses AUTO-DETOUR until the session reloads hooks] → the unbounded sentence names
  the commits, so the agent can still `/pm:detour --minimal`; the next reload restores it.
- [Two parallel post-call hooks can both print the same commit] → trail dedupe holds; advisory only.
- [A detour genuinely made while editing the active epic's change dir is no longer auto-logged] →
  accepted: the agent-declared `/pm:detour --minimal` path is unchanged, and in this repository every AUTO-DETOUR
  row touching its active epic's change directory (`67dbee6`, `cbe5be3`, and `b2c5394` before its
  hand-removal) is in that epic's `attributedCommits` — 3 of 3.
- [A commit made by a backgrounded Bash call (`run_in_background`) lands after that call's post-call
  hook ran, so it is unbounded: named by the next call, never logged or attributed (gh#68's case;
  today's watermark would log it against the active epic on the next call)] → accepted, same class
  as proposal defect 3; the agent attributes it by hand, and the sentence names the sha.
- [Reflog disabled (`core.logAllRefUpdates=false`)] → unchanged unverifiable rung.
- [A commit on a branch later deleted within the same call] → still reported (the reflog has it);
  Gate 2 ancestry reads it as unreachable, which is the correct finding if the agent attributes it.

## Migration Plan

No `state.json` change, no MIGRATIONS entry. `upgrade()` re-runs `ensureGitignore`, which adds
`.conductor/commit-watch/`. Hook wiring ships in `hooks/hooks.json`; users pick it up with
`/reload-plugins`. Rollback: revert; orphan snapshot files are git-ignored and inert.

## Coordination

- **Change 2 (`emitted-commands-run-as-written`)** carries `emitted-text-says-hand-edit-state`, which
  names `runNudge`'s "Otherwise update `.conductor/state.json`" sentence. This change restructures
  `runNudge`'s message assembly (unbounded sentence, retract pointer, candidate list). Apply order
  1 → 2: change 2 rewrites that sentence on top of this change's shape; the sentence itself is left
  to change 2 here.
- **Change 3 (`user-text-never-forges-output`)** escapes user text in `render.mjs`, including the
  detour table's note column. This change edits the same block (retraction filter before the
  8-row slice); expect a textual conflict. Retraction reasons are user text and reach `detours.log`
  and `PROJECT.md` through that block, so change 3's escaping covers them once both land. Change 3's design assigns `commit-nudge`'s own output to this
  change: the hook text this change adds prints short shas, epic ids resolved from `state.json`, and
  no commit subject; a retraction reason is written through `appendDetourLog`'s existing whitespace
  collapse, so a tab or newline in `--reason` cannot add a `detours.log` column or line.
- `subcommands.mjs` `ensureGitignore` is shared with no sibling.
- Mintlify sync belongs to the 0.45.0 release cut.

## Open Questions

- Should a nested conductor ignore commits wholly outside its root (monorepo with two conductors)?
  Deferrable: no report in hand, and the answer adds a rule without changing any requirement here.

## Notes for Gate 1

- The `conductor-record` delta's new detached-tree scenario cannot fail on today's engine (no
  snapshot file exists to suppress); it is a REGRESSION GUARD for the new write site, carried with its
  positive half (the hook exits 0) per that requirement's own anti-vacuity note. The requirement is
  MODIFIED only to keep its criterion-plus-enumeration table complete.
