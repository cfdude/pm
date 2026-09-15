## Context

See proposal.md "Why" for the four reproductions. The code as of 0.43.0:

- `scripts/lib/state.mjs` — `readJSON(p, fallback)` swallows every read and parse error.
  `loadState()` calls it with `null` and falls back to `defaultState()`; `diskRevision()` reads the
  same file the same way and returns 0; `saveState()`'s no-op comparison reads it with `{}`. So an
  unreadable file is revision 0 on both sides of the guard, and the guard passes. `isInitialized()`
  is `fs.existsSync(STATE_PATH)` and every hook keys its dormancy on it.
- `saveState()` writes a temp file with `writeFileSync` (no flush), renames it, and reads it back.
  Its own comment records the 0.26.0 decision against a lock file ("a session killed mid-write
  leaves the lock held forever"), repeated in `docs/superpowers/plans/2026-08-18-state-write-conflict-guard.md`.
- `scripts/lib/gate-guard.mjs` `gateGuardCheck()` — `isInitialized()` → `loadState()` → resolve the
  active epic. It blocks with exit 2 and allows by returning.
- `scripts/lib/subcommands.mjs` — `brief()` (SessionStart), `snapshot()` (PreCompact: `render()` then
  `brief.txt`), `commitNudge()` (PostToolUse: observes HEAD first, returns on `no-commit`, then
  `loadState()`, heal, `render()`), `init()` (prints "already initialized" and proceeds when the file
  exists), `ensureGitignore()`.
- `scripts/lib/claim-shape.mjs` `claimExpiry()` guards non-finite and non-positive TTLs but calls
  `toISOString()` on an unrepresentable date, which throws. `claims.mjs` `ttlFrom()` accepts any
  positive finite number.
- `scripts/lib/rules.mjs` `writeRules()` — `existing.includes(RULES_BEGIN_PREFIX) &&
  existing.includes(RULES_END)` then `existing.replace(lazyRegex, block)` with a STRING replacement.
- Claude Code hook exit semantics, checked against `https://code.claude.com/docs/en/hooks.md` on
  2026-09-15: PreToolUse exit 2 blocks the tool call; SessionStart exit 2 shows stderr to the user
  only and Claude does not see it; **PreCompact exit 2 blocks compaction**; PostToolUse exit 2 shows
  stderr to Claude and cannot block; any other non-zero exit is a non-blocking notice to the user.

### How it bit

Each defect reports success over a loss, so nothing downstream looks broken:

- `add-epic` over a conflicted file printed `added epic 'new'` and exited 0 while removing three
  epics. `commit-nudge` over the same kind of file re-rendered `PROJECT.md` from the empty guess
  (md5 changed) and exited 0.
- 16 parallel `add-epic`: 9/9/8 printed `added epic` against 7/6/6 on disk, across three runs. Run 3
  also threw `StatePersistError … at revision 9 (disk revision 9)`: two writers published the same
  revision and the read-back guard correctly saw bytes that were not its own — a third failure mode
  of the same race, and one that disappears once saves are serialised.
- `claim --ttl 1e12` crashed after writing, and every later reader crashed.
- `write-rules` printed `refreshed` while deleting a hand-written section.

On the rules-block defect: after the 0.43.0 fleet upgrade, 25 repositories' `CLAUDE.md` were compared
against pre-upgrade backups and no loss was found. **That is weak evidence and is not cited as proof
that nothing was lost**: several of those files hold only 0–2 lines outside the managed block, so
there was almost nothing there to lose. The measurement this design does rely on is different — a
scan of the same files for marker LINES (below, D6).

## Goals / Non-Goals

**Goals:** no path reads an unreadable `state.json` as a record; no two saves interleave; no stored
claim can crash a reader; no refresh of the rules block touches a byte outside a well-formed block.

**Non-Goals:**
- Repairing a damaged `state.json`. The engine names the file and a git remedy; it does not attempt a
  merge of conflict sides.
- Locking READS. Rename is atomic, so a reader sees the whole old file or the whole new one; a reader
  racing a writer reads a revision that is already stale, which is the case the revision guard handles.
- Validating `state.json` content beyond the four shape rules in the spec (see D1).
- Parsing markdown code fences in the rules file (see D6).
- `--force`'s flag registration — owned by `every-verb-refuses-what-it-does-not-read`.
- Reconcile-gate semantics in `gate-guard.mjs` — owned by `gates-bind-to-verified-evidence`.

## Decisions

### D1 — A strict reader for state, bound in `state.mjs`; `readJSON` keeps its fallback

A new internal `readStateFile()` returns one of `{absent}`, `{ok, state}`, `{unreadable, reason}`.
`loadState()`, `diskRevision()` and `saveState()`'s pre-image read all go through it. `loadState()`
throws `StateUnreadableError(path, reason)` on `unreadable` and keeps returning `defaultState()` on
`absent` (so `init`'s first save, and any code path already guarded by `isInitialized()`, is
unchanged). `readJSON()` keeps its swallow — its other callers (`render.mjs` render stamp,
`worktree-hygiene.mjs`, `plugin-meta.mjs`, `self-hosting.mjs`) read files whose absence or damage is
legitimately "no value", and the call-site sweep (tasks 7.1) must list each and state that.

Shape rules are limited to what makes a reader crash or makes a save discard data: top-level object,
`epics` array-if-present with object elements, `detourStack` array-if-present. **Declined:** refusing a
non-integer `revision` — it is read as 0 on both sides and loses nothing; refusing unknown keys —
state.json grows keys every release and an older engine must still load a newer file's superset.

Binding in the loader rather than at each verb is the rule `docs/lessons/bind-rules-to-functions-not-enumerations.md`
states: `rg -c "loadState\("` counts 68 occurrences across 33 engine files today (definition
included), and an enumerated guard goes stale at the next verb.

`init()` calls `loadState()` before `ensureGitignore()` when the file exists, so its refusal precedes
its first write.

### D2 — A dedicated exit code

`STATE_UNREADABLE_EXIT_CODE = 10` in `constants.mjs`, beside `CONFLICT_EXIT_CODE = 9`.
`conductor.mjs`'s top-level catch maps `StateUnreadableError` the way `conflictExitCode()` maps a
conflict (extend that function or add a sibling; keep "anything else re-throws unchanged").
Message shape:

```
conductor: .conductor/state.json cannot be read — <reason>. Nothing was written.
  If a merge left conflict markers: git checkout --ours .conductor/state.json   (or --theirs)
  To discard local damage:          git restore .conductor/state.json
  Never committed (git has no copy): mv .conductor/state.json .conductor/state.json.damaged
                                    then /pm:init   (the damaged bytes are kept beside it)
  Then re-run the command.
```

The untracked remedy is required, not decoration: a repository `init`'d and damaged before its first
commit has nothing for git to restore, and `init` refuses while the damaged file is in place. Moving
it aside rather than deleting it keeps the bytes for a hand recovery.

**Alternatives:** exit 1 — indistinguishable from a malformed command, so a fleet script cannot tell
"fix this repo's file" from "fix your invocation"; the conflict code — tells the caller to retry,
which cannot help.

### D3 — Hooks: one decision per event, from what the event does with the exit code

| hook | on unreadable | why |
| --- | --- | --- |
| `gate-guard` (PreToolUse Edit/Write/NotebookEdit) | stderr message, **exit 2** | Fail CLOSED. Exit 0 silently disables the unconditional reconcile block exactly when the record that says whether one is owed is unreadable. Not a wedge: Bash is not matched by this hook, and every remedy in the message is a git command. |
| `brief` (SessionStart) | stdout JSON whose `additionalContext` is ONLY the warning; **exit 0** | The only channel that reaches the agent. Non-zero would reach the human only. No latch consumption, no other briefing content — a partial brief from a guessed record is the defect. |
| `snapshot` (PreCompact) | stderr, **exit 10**, no `render()`, no `brief.txt` | Must never be 2 (blocks compaction). 10 is a non-blocking notice. |
| `commit-nudge` (PostToolUse Bash) | when it reaches its `loadState()`: stderr, **exit 2**, no heal, no render, no detour log | Exit 2 on PostToolUse reaches Claude — the actor who can run the git remedy — and cannot block. |
| `lesson-advice` (PreToolUse) | unchanged | Reads only `isInitialized()`. |

Implementation: the mapping is bound at `conductor.mjs`'s top-level catch, BY VERB — `gate-guard` and
`commit-nudge` → print the message, exit 2; `brief` → print the warning-only JSON, exit 0; every other
verb, `snapshot` included → exit 10. Each hook MAY also catch at its own load for a tidier message, but
that is an optimisation, not the guarantee: a refusal raised from anything a hook calls (`render()`,
`resolvePlatform()`, a future refactor that moves the load) must still produce the hook's status, and
on PreToolUse any code but 2 is fail-open. A per-verb table beside `conflictExitCode()` keeps it one
place.

**Declined — let `gate-guard` allow an Edit/Write whose target is `.conductor/state.json` itself**, so
a merge could be resolved with the Edit tool. It widens the one unconditional block with a path
match on untrusted tool input, and every realistic resolution (`--ours`, `--theirs`, `git restore`,
re-running the verbs for the lost side) is reachable through Bash.

**Declined — probe readability on every `commit-nudge` invocation**, so the merge that produced the
conflict is reported on the very next Bash call. A conflicting `git merge` lands no commit, so the
hook returns at `no-commit` before reading state; probing earlier adds a parse of a 456 KB file
(this repository's) to every Bash call. The next Edit/Write (gate-guard) and the next session (brief)
both report it.

**The activity-log chokepoint** in `conductor.mjs` already wraps its `loadState()` in `try/catch`, so
it swallows the refusal and the verb itself refuses. The existing test
`gh-111: an UNREADABLE state.json does not fail the verb either` (`scripts/test/conductor-33.test.mjs`)
asserts `owners` still answers on `{ not json at all`; its INTENT (the observer never breaks the run)
survives, its ASSERTION inverts: `owners` now exits 10, and the test asserts the stderr is the
refusal message and carries no stack trace from the observer.

### D4 — An O_EXCL lock file with a stale-break rule

**Path:** `.conductor/state.json.lock`, added to `ensureGitignore()`'s list (which `upgrade` re-runs;
no MIGRATIONS entry — nothing in `state.json` changes).

**Acquire:** `fs.openSync(lock, "wx")` (O_CREAT|O_EXCL); write `{"pid", "host": os.hostname(),
"acquiredAt"}`, `fsyncSync`, close. On `EEXIST`: judge staleness; if stale, break (below) and retry
immediately; if not, sleep and retry until `STATE_LOCK_WAIT_MS` (2000) elapses. Sleep is
`Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, STATE_LOCK_POLL_MS)` (25) — synchronous,
zero-dependency, permitted on Node's main thread.

**Stale:** `mtime` older than `STATE_LOCK_STALE_MS` (30000), OR (`host === os.hostname()` AND
`process.kill(pid, 0)` throws `ESRCH`). `EPERM` means alive. Unparseable content (a holder between
`open` and `write`, or a crash there) is judged by age only. A save holds the lock for milliseconds
— one read, one stringify, one write, one rename, one read-back — so 30 s is two to three orders of
magnitude of headroom.

**Break without stealing a fresh lock:** rename the lock to `state.json.lock.stale-<pid>-<rand>`
(atomic); read the renamed file; if it is byte-identical to what was judged stale, unlink it and
retry the exclusive create; if it is not (another process broke and re-acquired in between), restore
it with `fs.linkSync(renamed, lock)` — which fails with `EEXIST` rather than overwrite a newer lock —
then unlink the renamed path and go back to waiting.

**Critical section:** acquire → strict disk read (unreadable → refuse) → revision compare (skipped
under `--force`) → no-op compare → `stampTouched` → write temp → `fsyncSync(tempFd)` → verify the lock
file still holds our `{pid, acquiredAt}` (else refuse as conflict) → `renameSync` → best-effort
`fsync` of the `.conductor` directory → read-back → release.

**Release:** unlink the lock only if its content is still ours. Registered ALSO as a
`process.on("exit")` handler at acquire time, removed on normal release: `process.exit()` skips
`finally`, and at least one mutating verb (`update-epic`'s post-write attribution read-back) exits
non-zero after a successful save — the same reason `conductor.mjs`'s activity log uses an exit
handler. A SIGKILL leaves the lock; the stale rule removes it on the next save (immediately on the
same host).

**Lock timeout outcome:** interactive → `StateConflictError` whose message names the holder
(`state.json is locked by pid 4711 on <host> since <iso>`), exit 9. Hook (`onConflict: "skip"`) →
`recordConflict({verb, expected, found})` with `found` the disk revision read (unlocked) at the
timeout, and `{ok: false}`; `saveHookHeal()`'s single retry then applies unchanged. `found` stays a
revision because `state-write-guard`'s existing "Hook writes retry once, then skip" requirement says
the sidecar entry names the expected and found revisions; lock-ness is not recorded in the sidecar
(the interactive message carries the holder).

**Why reverse 0.26.0:** its objection — a lock held forever — is answered by the age backstop; its
chosen mechanism was measured insufficient (proposal "Why"). The revision guard stays: the lock
serialises the section, the revision still detects a writer whose LOAD predates another's save.

**Alternatives:** `fs.mkdirSync` as the lock primitive — equally atomic, but it has no content, so
holder liveness cannot be judged; a lock held only around rename — leaves the compare-then-rename
window open; advisory `flock` — not reachable from Node without a dependency.

### D5 — One TTL bound, shared by writer and reader

`CLAIM_MAX_TTL_MINUTES = 10080` (7 days) in `constants.mjs`, against defaults of 120 (epic) and 30
(repo). A claim is "who owns this right now", renewed by re-claiming; a week is generous, and a bound
this far below the representable range (about 1.4e11 minutes from the epoch) leaves no overflow
arithmetic to reason about.

`claim-shape.mjs` (the leaf module both `claims.mjs` and `integrity.mjs` already import) gains
`validTtlMinutes(n)`; `ttlFrom()` refuses with it, `claimExpiry()` returns `null` with it and also when
`Number.isFinite(new Date(t + mins * 60000).getTime())` is false — defensive even under the bound.
`isLiveClaim()` already reads `null` as expired. `formatOwners()` renders a `null` expiry as
`an unreadable time`, matching the phrase `integrity.mjs` already uses, instead of the literal `null`.

**Alternative:** bound only at input and let readers accept any representable TTL — a 0.43.0-written
claim of 1e9 minutes (year 3928, reproduced) would stay live for centuries.

### D6 — The rules writer works on lines, refuses ambiguity, and never uses a string replacement

`writeRules()`: split `existing` into lines KEEPING terminators; classify each line (terminator
stripped) as BEGIN (`startsWith(RULES_BEGIN_PREFIX) && endsWith("-->")`), END (`=== RULES_END`) or
content. Then:

- 0 markers → append (existing branch) / create.
- exactly `[BEGIN at i, END at j]`, `i < j` → `lines.slice(0, i).join("") + block + lines.slice(j + 1).join("")`.
- anything else → throw `RulesBlockAmbiguousError(file, markers[])`, mapped in `conductor.mjs` to exit
  1 with a message listing `line N: BEGIN|END` for every marker and the fix, and saying the rules file
  was not modified. No `String.prototype.replace` anywhere on this path.

Line endings: when refreshing, the block uses the BEGIN marker line's terminator; when appending, the
first line terminator found in the file (LF when none). The block text itself is produced by
`rulesBlock()` with `\n` and converted. The trailing newline after END is preserved from the original
END line's terminator.

`RULES_BEGIN_PREFIX` stays the detection anchor — keyed on the prefix precisely so a block written by
an older version (different parenthetical) is still found, as its comment in `constants.mjs` records.

**Refuse vs heal — decided REFUSE.** Measured on the proposing machine before writing this: every
`CLAUDE.md`/`AGENTS.md`/`HERMES.md` within three directory levels of `~/Documents/Repos`, `~/Servers`
and `~/Documents/Highway` that contains the marker string — 25 files — holds exactly one whole-line
BEGIN, exactly one whole-line END, no substring-only mention, and no CRLF. The refusal fires on zero
of them. Healing an orphan marker must guess the managed extent (the defect). Healing two well-formed
pairs is unambiguous in extent but not in intent, and the historical source of duplicate blocks (the
parenthetical rename recorded in `constants.mjs`) is already fixed. A second machine's fleet is
unmeasured; a refusal there costs one hand deletion with line numbers supplied.

**Where the refusal binds — in `writeRules()`, not a preflight at its callers.** Five verbs call it
(`write-rules`, `init`, `upgrade`, `set-tracker` ×3 paths, `set-review-mode`); a preflight at each is
an enumeration. Consequence, accepted and stated in the message: a verb that saved `state.json` before
its block write keeps that save. `upgrade` then exits 1 without printing `upgraded`; re-running after
the fix is a state no-op plus the block refresh. **Declined:** rolling back the earlier save — a
second write path on the failure path, for a condition fixed by one hand edit.

**Declined — code-fence awareness.** A whole-line marker inside a fenced example is counted. The
outcome is a refusal with line numbers, never a deletion, and no measured file has one.

### D7 — Capability homes

- `state-write-guard` for everything about `state.json` reads, saves and the lock — its Purpose is
  the guard on that file.
- `conductor-record` for claim lifetime (the brief for this change assigns it; the claim is a field of
  the record) and for the detached-HEAD table, which asserts it lists EVERY `.conductor/` write site
  and would be false with the lock file absent from it.
- A new `managed-rules-block` for the writer. Every existing "rules block" requirement
  (`tracker-sync`, `conductor-record`, `epic-disposition`, `gate-integrity`) is about what the block
  SAYS; none owns how it is spliced into a human's file, and a delta cannot widen an existing
  capability's Purpose to take it.

## Risks / Trade-offs

- [A damaged `state.json` now stops pm in that repo, and gate-guard blocks every Edit/Write] →
  deliberate; the message names a Bash-reachable git remedy, and the condition is visible in the
  session brief. The alternative is silent data loss.
- [A holder paused longer than 30 s between its ownership check and its rename can have its lock
  broken, and both writers can write] → the ownership check narrows this to one system call after a
  30 s stall; a save's critical section is milliseconds. Accepted residual.
- [O_EXCL on a network filesystem] → `.conductor/` on NFS is not a supported layout; the age backstop
  still prevents a permanent wedge.
- [A 2 s lock wait inside a hook] → only under genuine contention; hook holds are milliseconds.
- [Claims above 7 days written by 0.43.0 read as expired after upgrade] → advisory; re-claim.
- [`upgrade`/`set-tracker` leave `state.json` saved when the block write refuses] → exit 1 plus a
  message naming that only the rules file was untouched; re-run is idempotent.
- [The `gh-111` test's assertion inverts] → rewritten, not deleted; its intent is kept (D3).

## Migration Plan

No `state.json` transformation, so no MIGRATIONS entry and no `pmVersion`-keyed step. The lock's
`.gitignore` line arrives through `ensureGitignore()` on the next `init`/`upgrade`. Rollback: revert
the release; a stray `state.json.lock` left by a crashed new engine is ignored by an old one.

## Coordination

- **`every-verb-refuses-what-it-does-not-read` (applies first).** `saveState()` reads `--force` with
  `process.argv.includes("--force")`; that change owns making `--force` a registered flag on the verbs
  that save. This change only requires that a forced save still takes the lock and never overwrites
  an unreadable file — keep whatever mechanism that change lands. Re-derive every line anchor in
  `state.mjs`, `conductor.mjs` and `claims.mjs` after it merges (it edits `ttlFrom`'s neighbourhood and
  the top-level dispatch/catch). If it introduces an exit-code registry, register 10 there.
  Its draft adds `verb-surface` "--force is accepted where a write can be forced, and nowhere else";
  this change's forced-save scenarios use only verbs declared `mutates`, so they stay reachable.
- **`gates-bind-to-verified-evidence`.** It edits the CONTENT of `scripts/lib/rules.mjs` (block
  text); this change rewrites only `writeRules()`'s splice — expect a textual conflict in that file,
  not a semantic one. Both changes edit `scripts/lib/gate-guard.mjs`. Split: this
  change owns the unreadable-state branch at the top of `gateGuardCheck()` (the `loadState()` call and
  what happens when it refuses); that change owns everything after the active epic is resolved
  (reconcile and tracker-refresh semantics). Whichever applies second re-anchors on the other's
  version of the function.
- Neither sibling is expected to touch `claim-shape.mjs`, `rules.mjs writeRules()`, or
  `conductor-record`'s detached-HEAD requirement; a cross-spec reviewer should confirm (task 0.2).

## Open Questions

None that change the specs or the tasks. The second machine's rules files are unmeasured (D6); the
refusal there is recoverable by hand and the measurement can be taken at the next fleet upgrade.
