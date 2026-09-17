## Context

See proposal.md "Why" for the reproduced defects. Current shape, read at `dev` f49871a (anchors re-derived with `rg` at `dev` bea35d0 by task 0.3: every function named below still exists; the only line anchor that moved is update-epic.mjs's withdrawal write, now ~708-710):

- `hooks/hooks.json` wires `commit-nudge` on **PostToolUse(Bash) only**. Claude Code fires PostToolUse
  only when a tool call succeeds and `PostToolUseFailure` when it fails; a cancelled call fires
  neither (code.claude.com/docs/en/hooks). PostToolUse fires concurrently for parallel tool calls.
  The hook output's `hookSpecificOutput.hookEventName` must match the event.
- `commit-watch.mjs` `observeCommit()` compares HEAD against one watermark
  (`.conductor/commit-watch.json`) and, when HEAD moved, reads `git reflog -1`. `COMMIT_ACTION` is
  `/^commit\b/`, which already matches `commit (merge)` and `commit (cherry-pick)` (the forms git
  writes when a conflicted merge or cherry-pick is concluded with `git commit`). A clean `git merge`
  writes `merge <branch>: …`, a clean cherry-pick writes `cherry-pick: …`, a revert `revert: …`, a
  rebase `… (pick): …` — none match (verified in fixture `rrl`).
- `subcommands.mjs` `runNudge()` writes DETOUR-COMMIT or AUTO-DETOUR through `git.mjs`
  `appendDetourLog(kind, epic, note)`, which takes the sha from `gitShortSha()` (HEAD) and dedupes on
  exact `(sha, kind)`. Row abbreviation length is whatever git chose at write time: 
  personal-finance-paper's `detours.log` holds 7-character and 8-character rows.
- `headChangedFiles()` paths are git-root relative; `CONDUCTOR_OWN_FILES` is conductor-root relative.
- `attributionTarget()` picks exactly one epic; `attributionNudge()` prints one command for one sha.
- `render.mjs` shows the last 8 lines of `detours.log` verbatim.
- `scripts/conductor.mjs`'s activity block calls `loadState()` before dispatch, inside a try/catch.

## Goals / Non-Goals

**Goals:** every live commit since the last observation is seen once; dead shas are never offered for
attribution; an amend is a replacement; the auto-detour heuristic stops firing on the measured
own-artifact and nested-bookkeeping classes; every automatic row has a verb-shaped inverse; the
attribution hint lists candidates without deciding.

**Non-Goals:**
- **Proving a commit came from the call being answered (defect 3).** A pre-call hook could bound the
  call, but it adds an engine spawn to every Bash call in every session (Gate 1 lens A measured about
  100 ms per spawn), for the one defect nothing else fixes. Stated as a residual instead (Risks).
- Reporting `revert:`, clean `merge …:`, clean `cherry-pick:` or rebase `(pick)` entries. Unchanged
  from today; `commit (merge)` and `commit (cherry-pick)` ARE reported, as today.
- A subject-prefix rule for `chore(release)` / `chore(conductor)` (#184's first suggestion). Its
  comments argue against a prefix list, and `chore(openspec)` joined the list the week after it was
  proposed.
- Recognising pm-written lines inside `.gitignore` or the managed block of `CLAUDE.md` (#173's
  broader suggestion): that means diffing hunks against what `ensureGitignore`/`writeRules` emit.
  Declined; `retract-detour` is the remedy (Risks).
- A monorepo holding two conductors (see Open Questions).
- Retracting `MINIMAL` rows (Risks).

## Decisions

### 1. A reflog anchor, not a HEAD watermark

After each observation the hook records an anchor: the byte size of the file named by
`git rev-parse --git-path logs/HEAD` (a path git prints relative to the working directory — `../../.git/logs/HEAD`
in a nested conductor — so it is resolved against the conductor root, the hook's `cwd`) and that
file's full last line, as bytes (Decision 2). The next observation locates the anchor BY CONTENT: the last occurrence of the
anchored line that ends at or before the recorded size. Expiry (`git reflog expire`, `git gc`,
`gc --auto`, a fetch's auto-gc) removes entries from the FRONT of the file, so the anchored line
survives at a smaller offset and new entries still follow it; appends only ever land after the
recorded size, so bounding the search by it keeps an identical later line (same old, new, second and
message) from being mistaken for the anchor. Only when no such occurrence exists is the observation
**unverifiable**: it reports nothing from the reflog and re-anchors. Otherwise it reads the bytes after
that occurrence, one reflog line each:
`<old> <new> <ident> <time> <tz>\t<message>`. Entries whose message matches `^commit\b` are candidates,
oldest first.

- *Rejected: `HEAD@{time}` / `HEAD@{n}` selectors.* Lens A reproduced two reflog entries in one second,
  so a time selector is ambiguous, and `git gc --auto` (which can run after a commit) expires entries
  and renumbers `{n}`.
- *Rejected: `git rev-list <watermark>..HEAD`* — a commit then checked out away from (defect 1) is not
  reachable from HEAD.
- *Rejected: a pre-call hook* — see Non-Goals.

With no anchor recorded (first run, or a repository initialised before this release), the hook records
one and takes today's unverifiable rung for that run, including `unverifiableSubject`'s text heuristic,
which exists so the archived-epic self-heal runs without git. `core.logAllRefUpdates=false` does not
stop git appending to an EXISTING `logs/HEAD` (measured: 12 lines to 13 after a commit), so observation
works there too; only a repository with no `logs/HEAD` at all is unverifiable, as today.

### 2. A new record file: `.conductor/commit-observe.json`

`{ "anchor": { "size": <n>, "lineBase64": "<last line's bytes, base64>" }, "reported": ["<full sha>", …] }`
(the line is stored and compared as BYTES — a reflog is not guaranteed to be UTF-8, and a UTF-8 decode of a
Latin-1 subject never matched again; Gate 2 G2-C1), written by
temp-file-and-rename inside the lock of Decision 3. `ensureGitignore` ignores `.conductor/commit-observe.json*`, so
the lock and a temp file left by a killed hook are ignored too, and the file joins `CONDUCTOR_OWN_FILES`
for the same reason `commit-watch.json` is there. A new file, not a new key in `commit-watch.json`, because plugin versions install
side by side and a session that has not run `/reload-plugins` keeps running 0.44.0's hook and engine,
which rewrites `commit-watch.json` as `{head}` on every Bash call and would erase any key added to it.
The new engine never reads or writes `commit-watch.json`. `upgrade()` already re-runs `ensureGitignore`. The old file is left in place (no engine removes it; see 8.2).

### 3. Report once: a set of reported shas, read and written under one lock

The record is written only after the run has read `state.json` successfully: a run that exits on an
unreadable file (state-write-guard) leaves anchor and set untouched, so the commit is re-read and
reported by the first readable run.

A commit is reported only if its full sha is not in `reported`; reporting adds it. The whole
observation — read `{anchor, reported}`, walk the reflog, decide what to report, write the new record —
runs while holding an exclusive lock, `.conductor/commit-observe.json.lock`, created with `O_EXCL`
(`fs.openSync(path, "wx")`). Gate 1 round 2 simulated the unlocked form: a run holding an older anchor
also writes an older `reported`, erasing a sha another run just added, and a third run reports it
again. Under the lock no run reads a record another run is about to supersede, so the anchor never
moves backwards and `reported` never loses an entry it still needs.

Contention: the hook retries for at most 200 ms, then SKIPS the observation entirely — no report, no
write, no output. The commits stay after the anchor and the next observation reports them, so a skip
delays a report and never drops or repeats one. A lock older than 10 s is taken as left by a killed
hook and broken (an observation is a reflog read and one small write). Not 0.44.0's state lock
(`state.mjs` `lockPaths`): that lock waits up to `STATE_LOCK_WAIT_MS` and then refuses, and a hook
must neither wait that long on every Bash call nor turn contention into an error. Writes to
`state.json` later in the same run still take the state lock, as today.

The single-position form is rejected (lens A: it drops a commit when overlapping runs write out of
order). Bound: the set keeps the 500 most recently added shas; because the anchor never regresses, an
evicted sha lies behind the anchor and is never read again.

### 4. Live commits only

Before any row or attribution command, each candidate is checked with
`git for-each-ref --contains <sha> --count=1 refs/heads`. Empty output means the commit is reachable
from no branch: it was rewritten (`pull --rebase`, `rebase`), reset away, or made on a detached HEAD
and abandoned. Such commits are named in one sentence ("rewritten or abandoned since the last
observation: <short shas> — not logged, not attributed") and added to `reported`. The rewritten
replacement of a rebased commit is written by a `(pick)` entry and is not reported (Non-Goals); the
sentence tells the agent to attribute what the rebase produced by hand. An empty `refs/heads` (every
branch deleted) makes every commit dead; accepted.

### 5. The provenance statement

Every report says the commits "landed since the last observation — this call, another terminal, or a
parallel call". This is the whole treatment of defect 3: no row is suppressed because of it. An
AUTO-DETOUR or DETOUR-COMMIT message ends: "If that row is wrong: `retract-detour <sha> --reason
\"<why>\"` (re-renders PROJECT.md)."

### 6. Output envelope

`hookSpecificOutput.hookEventName` is the payload's `hook_event_name` when it is `PostToolUse` or
`PostToolUseFailure`, and `PostToolUse` otherwise (today's constant). `hooks.json` gains a
`PostToolUseFailure` entry with matcher `Bash` invoking the same command line. The exit-status
mapping in `refusal.mjs` needs no change: exit 2 is advisory on both events.

### 7. Amend handling

For EVERY `commit (amend)` entry in the window, live or dead, the replaced commit is that line's `<old>`
field. A replaced commit that is LIVE when the reflog is read (the amend was undone, e.g.
`reset --hard HEAD@{1}`) is skipped: retracting or withdrawing it would be irreversible (no
un-retract) and false. Before any commit is classified, for each remaining entry in landing order:
(a) retract every non-retracted commit-derived row matching the replaced commit, reason
`amended into <short new sha>`; (b) for each epic whose `attributedCommits` holds the replaced full sha,
print `update-epic <id> --withdraw-commit <replaced> --withdrawal-reason "amended into <new>"` —
except where that command would hit `update-epic`'s archived-delivered regression refusal
(`regressionRefusal`, update-epic.mjs). That decision is ONE exported predicate,
`deliveredRegression(id, snapshot, next, { status })` in `scripts/lib/update-epic.mjs`, returning the
obligations `next` breaks (empty = no refusal). It holds BOTH halves of today's inline test at
update-epic.mjs ~871-872: stored outcome `delivered`, `status` not `archived`, and EITHER the change
directory is archived on disk (`isArchived(id)`, whatever the stored status) OR the record is stored
`archived` and `status` is undefined; then it returns every `deliveredObligations(next)` kind absent
from `deliveredObligations(snapshot)`. Kinds are `deliveredObligations()`'s own `kind` (`gate2`,
`handoff`), never `emitted-commands-run-as-written`'s Gate 2 variants, so a record whose Gate 2 is
already stale is not newly refused when a withdrawal turns it into attribution-withdrawn. `update-epic`'s refusal is rewritten to call it, and the hook
calls it with `status` undefined (the printed command carries no `--status`), so the two cannot drift.
`next` is the record `--withdraw-commit` would write: the replaced sha REMOVED from
`attributedCommits` AND APPENDED to `withdrawnCommits` (as update-epic.mjs ~708-710 does). Removing it
alone is wrong: an emptied array then reads `none-attributed` instead of `attribution-withdrawn`
(archive-gate.mjs ~115-119), and the Gate 2 obligation the refusal enforces is missed. So a lane
shortcut is not the rule: an openspec epic with two attributed commits both covered by its Gate 2
head clears the predicate when the replaced one is withdrawn, and a `queued` epic whose change
directory is archived on disk does not. A delivered epic the predicate clears gets the command as
usual. Where it is refused, and a printed command the
engine refuses would break emitted-instructions R2; there the hook says in prose that the replaced
commit is attributed to delivered epic <id> whose record the withdrawal would break, and that
`update-epic`'s refusal names the remedy when the agent attempts the withdrawal. The hook names no
remedy itself: today's refusal offers only a disposition invocation, which the archive gate refuses
for this trigger ("attributes no commits, having withdrawn 1"), and the runnable remedy — re-record
Gate 2 over the replacing commit, attribute it, then withdraw — is `emitted-commands-run-as-written`'s
to print and to test (its task 2.6), and that change applies after this one;
then (c) classify the live commits normally. So C1 amended to C2 and again to C3 in one call retracts
and withdraws C1, handles C2 the same way (it has no row; a withdrawal only if something attributed it),
and reports C3; an amend followed by `reset --hard` retracts and withdraws the amended commit even
though the amending commit is itself dead. Keying on the live amend alone, as the round-1 draft did,
left C1's row visible and attributed. The engine never runs the withdrawal.

### 8. Changed paths and own artifacts

`changedFiles(sha)` returns `git diff-tree --no-commit-id --name-only -r --root <sha>` paths with
`git rev-parse --show-prefix` stripped; a path not starting with the prefix is returned unchanged, so it
can never equal a conductor-relative path. #195's `--relative` is rejected: it drops out-of-root paths
and turns a mixed commit into a bookkeeping-only one (proposal defect 6).

`ownArtifacts(epic)` = `openspec/changes/<epic.id>/` plus each normalised `EPIC_SOURCE_ARTIFACTS` path
(`planPath`, `specPath`). A path matches when it equals a file artifact or lies under a directory one.
An openspec epic registered under an id that differs from its change directory does not match and
keeps today's behaviour.

- AUTO-DETOUR: `looksLikeUnloggedMinimalDetour` gains "no changed path matches the active epic's own
  artifacts". `67dbee6`, `cbe5be3`, `b2c5394` and #184's `1f962d9` all match; `7ce3657` does not.
- DETOUR-COMMIT: suppressed when every changed path matches some paused epic's own artifacts or is a
  pm-owned file.

### 9. Trail rows carry their commit; rows match by prefix

`appendDetourLog(kind, epic, note, sha = gitShortSha())`; commit-derived callers pass the abbreviated
sha of the commit being logged. A row matches a commit when `fullSha.startsWith(rowSha)`. Used by the
duplicate check, amend retraction and `retract-detour`. Direction matters: comparing abbreviations to
each other breaks when lengths differ, and a full name always extends its own abbreviation.

### 10. Attribution candidates

`attributionCandidates(state, ctx, files)`: while a detour is live, the detour epic then paused epics
(top of stack first); otherwise the active epic. Each resolved against `state.epics`, dropped when
`attributedCommits` is absent (unchanged exemption), de-duplicated. A stable sort then moves candidates
whose own artifacts `files` touches ahead of the rest; `files` never adds a candidate. No candidate →
no hint, as today (so an archive move with nothing active prints nothing). One candidate → today's
sentence. Several → "ATTRIBUTION — the engine recorded nothing; choosing is yours:" and one command per
candidate. Each command lists every live reported commit, oldest first. The archive-move exclusion
sentence is printed once.

### 11. `retract-detour`

`retract-detour <sha> --reason "<why>"`. Positional table: exactly one, not free text. Flag registry:
`--reason` on this verb, keeping `REASON_REQUIRES` semantics for `push-detour` intact. `verb-effects.mjs`:
`mutates`, writes `.conductor/detours.log (append-only), PROJECT.md`. Row matching: a `<sha>` that resolves is matched by
Decision 9; one that resolves to no commit (rewritten, then pruned) is matched against the stored row
text only: it must be at least 7 hex characters, only rows whose own sha also resolves to nothing are
candidates, a row matches when either sha begins with the other, and the candidates must name exactly
one sha — otherwise the verb refuses naming the too-short value or the ambiguity (so `retract-detour 1`
cannot retract every row starting with `1`). Refusal messages, each distinct:
no matching row; no AUTO-DETOUR or DETOUR-COMMIT row for it (naming a MINIMAL-only row where that is the
case); already retracted; reason missing or empty. In a detached tree `appendDetourLog` writes nothing
(gh#175), so the verb exits non-zero saying no retraction was written.

Row: `<iso>\t<abbreviated sha>\tRETRACTED\t<epic of the retracted row>\t<reason, whitespace collapsed>`.
Render: collect retracted commits, drop matching commit-derived rows and all RETRACTED rows, then take
the last 8. The duplicate check keeps counting a retracted commit as logged. `purge-logs` truncates the
log wholesale; a retraction whose target was purged is inert. No un-retract: re-declare with
`log-detour`.

## Risks / Trade-offs

- [Defect 3 stays: a commit from another terminal or a parallel call is reported by the next
  observation, auto-logged against the active epic and offered for attribution] → the output says so
  in every report (Decision 5); `retract-detour` corrects the row; attribution is never written by the
  hook.
- [`MINIMAL` rows cannot be retracted, and one commit can carry both an AUTO-DETOUR row and a
  DETOUR-COMMIT row (logged before and after a detour was pushed), which `retract-detour` retracts
  together] → accepted: a MINIMAL row's sha is HEAD at declaration, not an identity, and it was
  declared by the agent; both commit-derived rows describe one commit, so retracting one and not the
  other would leave the table contradicting itself.
- [#173's upgrade commit touching `.gitignore`, `state.json` and `PROJECT.md` (3 files) is still
  auto-logged, because `.gitignore` is not a pm-owned file] → `retract-detour` is its remedy; the
  hunk-level alternative is declined in Non-Goals.
- [A commit rewritten by `pull --rebase` is never offered for attribution, and its replacement is not
  reported] → named as rewritten; the agent attributes the replacement by hand.
- [A failed Bash call now spawns one `commit-nudge` process: 63 ms per no-op run measured, mean of 20]
  → only on failure; successful calls gain no process.
- [An unreloaded session keeps 0.44.0 behaviour, and its rows may coexist with 0.45.0 rows in one
  `detours.log`] → prefix matching deduplicates across both; the CHANGELOG says `/reload-plugins`.
- [Reflog disabled] → unchanged unverifiable rung.

## Migration Plan

No `state.json` change, no MIGRATIONS entry. `upgrade()` re-runs `ensureGitignore`, which adds
`.conductor/commit-observe.json`. `hooks/hooks.json` ships the `PostToolUseFailure` entry; sessions pick
it up with `/reload-plugins`. The first observation per checkout records an anchor and reports nothing
from the reflog. Rollback: revert; `commit-observe.json` is git-ignored and inert.

## Coordination

- **Change 2 (`emitted-commands-run-as-written`)** carries `emitted-text-says-hand-edit-state`, which
  names `runNudge`'s "Otherwise update `.conductor/state.json`" sentence. This change restructures
  `runNudge`'s message assembly (provenance sentence, dead-commit sentence, retract pointer, candidate
  list). Apply order 1 → 2: change 2 rewrites that sentence on top of this change's shape.
- **Change 3 (`user-text-never-forges-output`)** escapes user text in `render.mjs`, including the detour
  table's note column; this change edits the same block (retraction filter before the 8-row slice), so
  expect a textual conflict. Change 3's design
  assigns `commit-nudge`'s own output to this change: the text added here prints abbreviated shas and
  epic ids resolved from `state.json`, never a commit subject; `--reason` goes through
  `appendDetourLog`'s whitespace collapse, which removes tabs and newlines but NOT `|`, U+0085 or ESC;
  RETRACTED rows are never rendered (Decision 11), and change 3's output escaping covers the note text
  of rows that are.
- Mintlify sync belongs to the 0.45.0 release cut.

## Open Questions

- Should a nested conductor ignore commits wholly outside its root (a monorepo with two conductors)?
  Deferrable: no report in hand, and the answer adds a rule without changing any requirement here.

## Notes for Gate 1

- The `conductor-record` delta's detached-tree scenario cannot fail on today's engine (no
  `commit-observe.json` exists to suppress); it is a REGRESSION GUARD for the new write site, with its
  positive half. The `state-write-guard` delta's failure-event scenario fails today on its last clause
  (today's engine advances `commit-watch.json`).
- The `pull --rebase` and `reset --hard` scenarios pass on today's engine (it is silent for both, fixture
  `rrb`); they are RED against the reflog walk before Decision 4's filter, which is the order tasks
  implement them in.
