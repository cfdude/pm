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

Two verbs are exempt by name because they do not depend on the content: `verify-state` only stats
`state.json`'s mtime against the render stamp and never loads it; `activity` loads state only for the
current revision (`activity-report.mjs`) and catches the refusal, reporting the revision as unknown.

### D2 — A dedicated exit code, chosen outside Node's own

`UNREADABLE_INPUT_EXIT_CODE = 11` in `constants.mjs`, beside `CONFLICT_EXIT_CODE = 9`. Node's
documented exit codes (`doc/api/process.md`, "Exit codes") use 1, 3–7, 9, 10, 12, 13 and >128, and mark
2 and 8 unused; 10 is "Internal JavaScript Run-Time Failure", so a pm refusal on 10 would be
indistinguishable from a Node bootstrap crash. 11 is not assigned by Node. (`CONFLICT_EXIT_CODE = 9`
already coincides with Node's "Invalid Argument"; that is pre-existing, Node emits 9 only for its own
command-line errors before any script runs, and changing a published retry code is out of scope.)

The same code serves the rules-block refusal (D6): both mean "a file this verb depends on is in a
state the engine will not guess about; a human fixes the file". The message names which file.

`conductor.mjs`'s top-level catch maps `StateUnreadableError` (and D6's error) the way
`conflictExitCode()` maps a conflict, per verb for the hooks (D3); anything else re-throws unchanged.
Message shape:

```
conductor: .conductor/state.json cannot be read — <reason>. Nothing was written.
  If a merge left conflict markers:  git checkout --ours .conductor/state.json   (or --theirs)
  If the markers were committed:     git show <good-rev>:.conductor/state.json > .conductor/state.json
  To discard local damage:           git restore .conductor/state.json
  Never committed (git has no copy): mv .conductor/state.json .conductor/state.json.damaged
                                     then /pm:init   (the damaged bytes are kept beside it)
  Then re-run the command.
```

The untracked remedy is required, not decoration: a repository `init`'d and damaged before its first
commit has nothing for git to restore, and `init` refuses while the damaged file is in place.

**Alternatives:** exit 1 — indistinguishable from a malformed command, so a fleet script cannot tell
"fix this repo's file" from "fix your invocation"; the conflict code — tells the caller to retry,
which cannot help; 10 — Node's.

### D3 — Hooks: one decision per event, from what the event does with the exit code

| hook | on unreadable | why |
| --- | --- | --- |
| `gate-guard` (PreToolUse Edit/Write/NotebookEdit) | stderr message, **exit 2** | Fail CLOSED. Exit 0 silently disables the unconditional reconcile block exactly when the record that says whether one is owed is unreadable. Not a wedge: Bash is not matched by this hook, and every remedy in the message is a shell command. |
| `brief` (SessionStart) | stdout JSON whose `additionalContext` is ONLY the warning; **exit 0** | The only channel that reaches the agent. No latch consumption, no other briefing content. |
| `snapshot` (PreCompact) | stderr, **exit 11**, no `render()`, no `brief.txt` | Must never be 2 (blocks compaction). 11 is a non-blocking notice. |
| `commit-nudge` (PostToolUse Bash) | when it reaches its `loadState()`: stderr, **exit 2**, no heal, no render, no detour log | Exit 2 on PostToolUse reaches Claude — the actor who can run the remedy — and cannot block. |
| `lesson-advice` (PreToolUse) | unchanged | Reads only `isInitialized()`. |

Implementation: the mapping is bound at `conductor.mjs`'s top-level catch, BY VERB — `gate-guard` and
`commit-nudge` → print the message, exit 2; `brief` → print the warning-only JSON, exit 0; every other
verb, `snapshot` included → exit 11. A hook MAY also catch at its own load, but that is an
optimisation, not the guarantee: a refusal raised from anything a hook calls must still produce the
hook's status, and on PreToolUse any code but 2 is fail-open.

**`commit-nudge`'s HEAD watermark is exempt from "writes nothing".** `observeCommit()` runs first and
unconditionally and writes `.conductor/commit-watch.json` before state is ever read — the ordering
`commitNudge()`'s own comment defends. It is left as is: the watermark is a fact about HEAD, not a
value derived from state. Consequence, accepted: the reminder for a commit that landed while the file
was unreadable is not re-shown after the repair, because the watermark has already passed it.

**The gh#129 intent is reversed.** `scripts/test/conductor-26.test.mjs`
`gh#129: degrades to doing nothing — no git, unreadable state, reflogs disabled` writes `{ not json`,
commits, and asserts `commit-nudge` does not throw (exit 0), on the reasoning that the hook fires on
every Bash call so erroring is a mid-session failure for every user. For the unreadable-state rung that
reasoning is the defect: exit 0 there re-rendered `PROJECT.md` from an empty guess. The rung is
rewritten to expect exit 2 and no write; the no-git and reflogs-disabled rungs keep `doesNotThrow`.

**Declined — let `gate-guard` allow an Edit/Write whose target is `.conductor/state.json` itself.** It
widens the one unconditional block with a path match on untrusted tool input, and every realistic
resolution is reachable through Bash.

**Declined — probe readability on every `commit-nudge` invocation.** A conflicting `git merge` lands
no commit, so the hook returns at `no-commit` before reading state; probing earlier adds a parse of a
456 KB file (this repository's) to every Bash call. The next Edit/Write (gate-guard) and the next
session (brief) both report it.

**The activity-log chokepoint** in `conductor.mjs` already wraps its `loadState()` in `try/catch`, so
it swallows the refusal and the verb itself refuses. `scripts/test/conductor-33.test.mjs`
`gh-111: an UNREADABLE state.json does not fail the verb either` keeps its intent (the observer never
breaks the run) and inverts its assertion: `owners` exits 11 with the refusal and no observer stack.

### D4 — An O_EXCL lock file, a serialised break, and identity by inode plus nonce

**Paths:** `.conductor/state.json.lock` and `.conductor/state.json.lock.break`, gitignored by one
`ensureGitignore()` entry `.conductor/state.json.lock*` (which `upgrade` re-runs; no MIGRATIONS entry).

**Lock content:** `{pid, host: os.hostname(), pidns, acquiredAt, nonce}`. `nonce` is 16 random bytes
from `node:crypto` (a built-in). `pidns` is `fs.readlinkSync("/proc/self/ns/pid")` where that exists
(Linux), otherwise `null`. The holder keeps its `nonce` and the lock's inode (`fstatSync` on the
descriptor it created). **Identity** of a lock is inode AND nonce: inode numbers are reused after
unlink on some filesystems, and two locks with the same recorded fields are otherwise
indistinguishable. No fsync of the lock content — it buys nothing for a file that only lives for a save.

**Acquire:** `fs.openSync(lock, "wx")`, write content, close. On `EEXIST`: judge staleness; if stale,
break (below) and retry; if not, sleep and retry until `STATE_LOCK_WAIT_MS` (2000) elapses. Sleep is
`Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, STATE_LOCK_POLL_MS)` (25).

**Stale:** `mtime` more than `STATE_LOCK_STALE_MS` (30000) in the past or in the future (a backward
clock step must not wedge the lock), OR (`host` AND `pidns` equal the checker's
AND `process.kill(pid, 0)` throws `ESRCH`; `EPERM` means alive). A container sharing the host name but
not the pid namespace has a different `pidns` and is judged by age only. A matching `pidns` does not
prove the same kernel (the initial namespace reads the same on every Linux host); two kernels sharing
one `.conductor/` means a network filesystem, which is not a supported layout. Unparseable content (a holder
between `open` and `write`) is judged by age only, and is young. A save holds the lock for milliseconds.

**Break, serialised:** create `state.json.lock.break` with `"wx"`. On `EEXIST`, if the break file is
older than `STATE_LOCK_STALE_MS`, unlink it only if its inode is still the one just stat'ed, then go
back to waiting (check-then-unlink: two processes judging a dead breaker's file can both proceed; the
replay ends at the holder's pre-rename inode+nonce check as a spurious exit 9, not a loss); otherwise just go back to waiting. While holding the break file: stat and read the
lock currently at the path; unlink it ONLY IF its identity equals the lock originally judged AND it is
still stale by the rule above. Release the break file (unlink if its inode is ours), then retry the
exclusive create.

Why this closes the Gate 1 interleaving (B judges L stale; A breaks L and takes N; B then acts): B
cannot act until A has released the break file, and on re-judging B finds N — a different identity,
and not stale, since A is alive and N is fresh — so B removes nothing. No path renames a lock away, so
there is no window in which the lock path is empty while its holder is mid-section.

**Critical section, in `try … finally { release }`:** acquire → strict disk read (unreadable →
refuse) → revision compare (skipped under `--force`) → no-op compare → `stampTouched` → write temp →
`fsyncSync(tempFd)` → ownership check: the lock at the path has our inode and nonce (else refuse as
conflict, write nothing) → `renameSync` → best-effort `fsync` of the `.conductor` directory →
read-back. **Release** in `finally` unlinks the lock only if its identity is still ours, so every
return and throw path releases. There is no `process.on("exit")` handler: every `process.exit` in the
engine's verbs runs after `saveState()` has returned, by which point `finally` has already run. A
signal kill leaves the lock; the stale rule removes it.

**"fsync" means `fsync(2)`.** On macOS Node exposes no `F_FULLFSYNC`, so this orders the temp file's
data ahead of the rename and closes the torn-file case on Linux; it does not promise power-loss
durability on macOS.

**Lock timeout outcome:** interactive → `StateConflictError` naming the recorded holder, exit 9. Hook
(`onConflict: "skip"`) → `recordConflict({verb, expected, found})` with `found` the disk revision
read (unlocked) at the timeout, per the existing "Hook writes retry once, then skip" requirement, and
`{ok: false}`. `saveHookHeal()` retries once, so a hook can wait up to about 4 s (two 2 s waits) under
sustained contention.

**Why reverse 0.26.0:** its objection — a lock held forever — is answered by the age backstop; its
chosen mechanism was measured insufficient (proposal "Why"). The revision guard stays: the lock
serialises the section, the revision still detects a writer whose LOAD predates another's save.

**Alternatives:** `fs.mkdirSync` as the lock — atomic, but no content, so no liveness and no nonce;
rename-to-unique break with `linkSync` restore (the Gate 1 draft) — leaves the lock path empty while a
holder is mid-section, which admits a third writer; advisory `flock` — not reachable from Node without a
dependency.

### D5 — One TTL bound, shared by writer and reader; the repo claim written atomically

`CLAIM_MAX_TTL_MINUTES = 10080` (7 days) in `constants.mjs`, against defaults of 120 (epic) and 30
(repo). A claim is "who owns this right now", renewed by re-claiming; a week is generous, and a bound
this far below the representable range (about 1.4e11 minutes from the epoch) leaves no overflow
arithmetic to reason about.

`claim-shape.mjs` gains `validTtlMinutes(n)` and imports the bound from `constants.mjs`; its header
("imports nothing from lib/") is updated to "imports only `constants.mjs`", which is itself a leaf, so
`integrity.mjs`'s dependency discipline still holds. `ttlFrom()` refuses with it; `claimExpiry()`
returns `null` with it and also when the computed date is not finite. `isLiveClaim()` already reads
`null` as expired. `formatOwners()` renders a `null` expiry as `an unreadable time`, the phrase
`integrity.mjs` already uses.

**`writeRepoClaim()`** writes `.conductor/session-claim.json` with a plain `writeFileSync`, so a
reader racing it can see a torn file, which `readRepoClaim()` reads as "no claim". This change owns
that file's TTL, so it also writes it by temp file plus rename in the same directory (the temp name
matches the existing gitignore entry's prefix pattern, added as `.conductor/session-claim.json*`).
**Declined:** locking it. The repository claim is advisory and never guarded a read-modify-write; the
check-then-write race between two `claim --repo` invocations is pre-existing and outside the four
findings this change carries.

**Alternative:** bound only at input — a 0.43.0-written claim of 1e9 minutes (year 3928, reproduced)
would stay live for centuries.

### D6 — The rules writer works on lines, refuses ambiguity, and never uses a string replacement

A pure `rulesBlockArrangement(text)` splits into lines KEEPING terminators and classifies each line
(terminator stripped) as BEGIN (`startsWith(RULES_BEGIN_PREFIX) && endsWith("-->")`), END
(`=== RULES_END`) or content, returning `none`, `one {i, j}` or `ambiguous [markers]`. `writeRules()`:

- `none` → append (existing branch) / create.
- `one` → `lines.slice(0, i).join("") + block + lines.slice(j + 1).join("")`.
- `ambiguous` → throw `RulesBlockAmbiguousError(file, markers[])`, mapped in `conductor.mjs` to exit 11
  with every `line N: BEGIN|END` and the fix. No `String.prototype.replace` on this path.

Line endings: when refreshing, the block uses the BEGIN marker line's terminator; when appending, the
first terminator in the file (LF when none).

`RULES_BEGIN_PREFIX` stays the detection anchor, so a block written by an older version (different
parenthetical) is still found, as its comment in `constants.mjs` records.

**Refuse vs heal — decided REFUSE.** Gate 1 recounted 27 marker-bearing rules files on the proposing
machine, each with exactly one whole-line BEGIN and one whole-line END (this author's narrower scan —
three roots, depth 3 — found 25 of them, also all well-formed, none CRLF). The refusal fires on none.
Healing an orphan marker must guess the managed extent (the defect). Healing two well-formed pairs is
unambiguous in extent but not in intent, and the historical source of duplicates (the parenthetical
rename in `constants.mjs`) is fixed. A second machine is unmeasured; a refusal there costs one hand
deletion with line numbers supplied.

**Where the refusal binds.** In `writeRules()` for every caller, AND as a preflight before the first
write in exactly `init` and `upgrade`. Those two are singled out, not enumerated from habit: `upgrade`
stamps `pmVersion`, which is what the fleet-upgrade procedure reads as "this repo is done", and then
runs `render()`, `ensureGitignore()` (which is how `.conductor/state.json.lock*` arrives) and the
COMMIT notice after the block write — so a late refusal would leave a repository that reads as
upgraded forever with a stale block, stale `PROJECT.md`, no lock gitignore line, and a `verify-state`
false hand-edit. `init` is the same shape on a fresh repo. The preflight resolves the target file
with the platform the verb would record, WITHOUT recording it, then calls `rulesBlockArrangement()`.

For `write-rules`, `set-tracker` (three paths) and `set-review-mode`, the refusal happens at
`writeRules()`, after whatever state save the verb makes (possibly a no-op, and for `write-rules` one
that happens only when the platform switched, leaving the new platform recorded) and before any later
write. The message says only what is true on every path: the rules file and every later write were not
made; re-running the verb after the fix completes it (a re-run of `write-rules` is then a non-switch). **Declined:** a preflight in
those too — neither stamps a done-marker, the re-run is idempotent, and every added preflight is one
more enumerated site.

**Declined — code-fence awareness.** A whole-line marker inside a fenced example is counted. The
outcome is a refusal with line numbers, never a deletion.

### D7 — Capability homes

- `state-write-guard` for everything about `state.json` reads, saves and the lock — its Purpose is
  the guard on that file. Its existing superseded-revision requirement is not MODIFIED: its text
  stays true, and the ADDED serialisation requirement is what makes it hold under concurrency.
- `conductor-record` for claim lifetime (the brief for this change assigns it; the claim is a field of
  the record) and for the detached-HEAD table, which asserts it lists EVERY `.conductor/` write site
  and would be false with the lock files absent from it.
- A new `managed-rules-block` for the writer. Every existing "rules block" requirement
  (`tracker-sync`, `conductor-record`, `epic-disposition`, `gate-integrity`) is about what the block
  SAYS; none owns how it is spliced into a human's file, and a delta cannot widen an existing
  capability's Purpose to take it.

## Risks / Trade-offs

- [A damaged `state.json` now stops pm in that repo, and gate-guard blocks every Edit/Write] →
  deliberate; the message names Bash-reachable remedies, and the brief carries the warning.
- [A holder alive but stalled past `STATE_LOCK_STALE_MS` — a suspended laptop, a debugger — is judged
  stale by age, and a breaker can remove its lock; if that holder then resumes between its ownership
  check and its rename, two writers write] → narrowed to that window; no loss without a stalled or dead
  holder or breaker, because breaks are serialised and re-judged. Accepted residual.
- [Age is judged from `mtime`, which on a shared filesystem is another host's clock] → `.conductor/` on
  a network filesystem is not a supported layout; skew only shortens or lengthens the wait.
- [macOS `fsync` is not `F_FULLFSYNC`] → stated in D4; ordering, not power-loss durability.
- [A hook can wait about 4 s under sustained contention] → contention of that length means a writer is
  wedged, which the existing contention warning reports.
- [Claims above 7 days written by 0.43.0 read as expired after upgrade] → advisory; re-claim.
- [`set-tracker`/`set-review-mode` over a malformed block leave `state.json` saved with the rules file,
  `PROJECT.md` and the render stamp unwritten, so `verify-state` reports a hand-edit until the re-run]
  → the refusal says exactly that and names the re-run.
- [An `upgrade` over a malformed block does not complete until a human fixes the file, and the
  fleet script correctly keeps reporting that repository as not upgraded] → intended.
- [Two existing tests (gh-111, gh#129's unreadable rung) invert] → rewritten, not deleted (D3).

## Migration Plan

No `state.json` transformation, so no MIGRATIONS entry and no `pmVersion`-keyed step. The gitignore
lines arrive through `ensureGitignore()` on the next `init`/`upgrade`. A repository whose rules block is
already malformed gets an upgrade refusal naming the lines — the CHANGELOG entry says so. Rollback:
revert the release; a stray lock file left by a crashed new engine is ignored by an old one.

## Coordination

- **`every-verb-refuses-what-it-does-not-read` (applies first).** Its D10 reorders argv (positionals
  first, argv-level flags last) and keeps `--force` in `process.argv` for `saveState()` to read, and it owns `--force`'s
  registration (`verb-surface` "--force is accepted where a write can be forced, and nowhere else").
  This change only requires that a forced save still takes the lock and never overwrites an unreadable
  file — keep whatever mechanism that change lands for reading the flag. This change's forced-save
  scenarios use only verbs declared `mutates`. Re-derive every line anchor in `state.mjs`,
  `conductor.mjs` and `claims.mjs` after it merges. If it introduces an exit-code registry, register 11
  there.
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
