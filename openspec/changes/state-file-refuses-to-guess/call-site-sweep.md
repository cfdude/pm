# Call-site completeness sweep — state-file-refuses-to-guess (tasks 7.1, 7.2)

Derived with `rg` from the tree at `dd4d925` (after every implementation commit), never from design.md.
Counts are what `rg` returned; comment lines are excluded.

## 1. The strict state read

| symbol | call sites | where the rule holds / does not, and why |
| --- | --- | --- |
| `loadState()` | 68 occurrences in 33 engine files (definition included) | Bound in the loader: every caller refuses on a present-but-unreadable file because the loader throws `StateUnreadableError`. Three callers CATCH it, each named: the activity-log chokepoint in `conductor.mjs` (pre-dispatch snapshot and exit handler — deliberate: the observer never breaks the run, and the verb itself then refuses, conductor-33 gh-111); `activity-report.mjs` (the named exemption — reports the revision and the on/off flag as unknown); and `rules.mjs` `currentTracker` / `currentSecondaryTrackers` / `currentReviewMode`, which swallowed EVERY error into a default. **Finding, fixed in a1931f8:** those three would have rendered a rules block from a guessed "no tracker, standard review"; they now rethrow `StateUnreadableError` and keep their default for anything else. `changelog.mjs:16` reads `pmVersion` and therefore refuses — it depends on content, so that is the rule holding, not a gap. |
| `readStateFile()` | `state.mjs` only: `loadState`, `saveState` (inside the lock), the lock-timeout peek | The one strict reader. |
| `diskRevision()` | removed | Replaced by the single strict read inside `saveState()`'s critical section. |
| `readJSON()` | `worktree-hygiene.mjs:116` (render stamp), `render.mjs:342` (render stamp), `plugin-meta.mjs:23`, `:94` (plugin.json), `self-hosting.mjs:89` (manifest) | Keep their swallow deliberately: each reads a file whose absence or damage legitimately means "no value", and none reads `state.json`. |
| `isInitialized()` | 50 sites: every verb's "run /pm:init first" guard, the four hooks' dormancy, `lesson-advice`'s dormancy, `checkCommandLine`'s `initialized`, the activity chokepoint, `platform.mjs:116`, `changelog.mjs`, `init` | Still means "the file EXISTS". A present-but-unreadable file is initialized, so each path proceeds to its load and refuses there. `lesson-advice` reads nothing more and is unaffected (D3). |
| `render.mjs` mtime stat | `render.mjs:336` `fs.statSync(STATE_PATH).mtimeMs` in `writeRenderStamp()` | Does NOT use the strict reader, deliberately: it records when state.json last changed, not what it says, and its one caller is `render()` (`render.mjs:287`), which has already loaded state through `loadState()` at `render.mjs:22` — so an unreadable file has refused before this line. A missing file is caught as "no state.json yet". |
| `verifyState` | `worktree-hygiene.mjs:114` | Exemption holds: it stats `state.json`'s mtime and never loads it (1.1 test). |
| `activity` | `activity-report.mjs:269` | Exemption holds: catches the refusal, revision unknown (1.1 test). |
| `init()` | `subcommands.mjs` | Loads before its first write when the file exists, then runs the rules-block preflight; `ensureGitignore()` runs after both (1.1, 6.3 tests). |

## 2. Saves, conflicts and the exit-status mapping

| symbol | call sites | where the rule holds / does not |
| --- | --- | --- |
| `saveState()` | 31 call lines in 23 files (`hook-write.mjs`'s `hookSave` and `platform.mjs:116` included) | Lock, fsync, strict read, ownership check and release are all inside the function, so every caller inherits them. `platform.mjs:116` saves only when initialized; `init`'s first save sees ABSENT as `{}`. |
| `saveHookHeal()` | `render.mjs:36`, `subcommands.mjs:475` (commit-nudge) | A lock timeout is a skip under "retry once, then skip" (3.3 test). An unreadable disk file is NOT a skip: it throws, and the top-level mapping decides the status (commit-nudge 2; `render` reached from any other verb 11). |
| `recordConflict()` | `state.mjs` ×3: revision mismatch, lock timeout, lock taken over before rename | All three record `{verb, expected, found}` under `onConflict: "skip"` and throw a `StateConflictError` otherwise. |
| `conflictExitCode()` | `refusal.mjs` only | The top-level catch reaches it through `refusalFor()`. |
| `StateUnreadableError` | thrown: `state.mjs` ×3; caught: `refusal.mjs`, `rules.mjs` (rethrow), `activity-report.mjs` | See §1. |
| `UNREADABLE_INPUT_EXIT_CODE` | `constants.mjs` (definition), `refusal.mjs` ×2 | No exit-code registry exists in the tree to register it in (the design's conditional does not fire). |
| top-level catch | `conductor.mjs` → `refusalFor(cmd, err)` | Every dispatched verb is synchronous (no `async function` in `scripts/lib`), so a refusal raised anywhere in a verb reaches this catch. It sets `process.exitCode` rather than calling `process.exit`, so the `brief` JSON cannot truncate at a pipe (conductor-38). |

**Hook entries.** `gateGuardCheck` loads after its stdin drain and `--platform` check → 2. `brief` → warning-only JSON, 0, loaded before `buildBrief` so no latch is consumed. `snapshot` loads before `render()` → 11. `commitNudge` → 2; `observeCommit()` runs first and writes the watermark (the D3 exemption); its load precedes the heal, render and detour log. `lessonAdvice` never loads. **The DEFAULT for a verb the mapping does not name is 11**, which is fail-OPEN on PreToolUse: a hook verb added later must be added to `HOOK_ON_UNREADABLE` in `refusal.mjs`. `lesson-advice` is already such a sibling — a PreToolUse hook absent from the table, correct only because its body never loads state. So the hook set is now bound mechanically: `refusal.mjs` exports `HOOK_ON_UNREADABLE` and `HOOK_DEFAULT_ON_UNREADABLE` (the verbs that take the default, each with its reason: `snapshot`, `lesson-advice`), and `state-file-refuses-to-guess.test.mjs` asserts their keys are set-equal to VERB_EFFECTS's `hook: true` verbs.

## 3. The lock

DATA: the lock content `{pid, host, pidns, acquiredAt, nonce}` and the paths `.conductor/state.json.lock` and `.conductor/state.json.lock.break`.

| role | sites |
| --- | --- |
| writer | `acquireStateLock()` (the lock); `breakStaleLock()` (the break file, O_EXCL) |
| reader | `inspectLock()`, called by `acquireStateLock` (judging a held lock), `breakStaleLock` (re-judge), the pre-rename ownership check in `saveState`, `releaseStateLock`; `isStaleLock()` reads `pid`, `host`, `pidns` and the mtime; `describeHolder()` reads the recorded fields for the refusal |
| remover | `releaseStateLock()` (only our inode+nonce); `breakStaleLock()` (only the judged identity, still stale; and a break file older than the stale age whose inode is unchanged); `acquireStateLock()` (the lock it just created, by inode, when writing its content fails — Gate 2 I3) |
| unremovable | a lock or break path past the stale age that cannot be unlinked (a directory) is an OBSTACLE: `tryBreakStaleLock()` reports it and the save refuses at once with exit 9 naming the path and `rm -r <path>` (Gate 2 C1/I2). A path that exists but cannot be opened as a file is judged from `lstat` (`lstatLock()`), so every contended iteration reaches the deadline and the sleep. |

Classifiers: `purge-logs` kinds are activity/conflicts/detours logs — the lock is not a log and needs no entry. `isConductorOwnFiles` classifies files in a commit's diff; the lock paths are gitignored (`.conductor/state.json.lock*`) and live only for one save, so they cannot appear there. `VERB_EFFECTS` `writes` strings describe lasting effects; the lock is removed on every return and throw (3.2 guard), so no string gains it. The detached-HEAD table: not suppressed (3.3 detached case). `state.json.tmp-<pid>-<ts>` is unlinked on every failure between its creation and a successful rename (write, fsync, close, ownership refusal, rename — Gate 2 I4); only a signal kill in that window leaves one, and `ensureGitignore()` now ignores `.conductor/state.json.tmp*`. The detached-HEAD table lists no temp file (nor `state.json` itself), so it gains no row.

## 4. Claims

| symbol | call sites | where the rule holds / does not |
| --- | --- | --- |
| `CLAIM_MAX_TTL_MINUTES` / `validTtlMinutes()` | `claim-shape.mjs` (reader), `claims.mjs` `ttlFrom` (writer) | One definition, both halves. |
| `ttlFrom()` | `claim --repo` (`claims.mjs:153`), `claim <epic>` (`:182`) | Both refuse before any write (5.1). |
| `claimExpiry()` | `refuseHeld` (only for a LIVE claim, so never null); the two success reports (a TTL just validated, so never null — except `:173`'s re-read of the repo marker, which prints `null` if the file vanished between the write and the read: pre-existing, not reachable by the defects here, left as is); `ownerRows` → `formatOwners` (null renders "an unreadable time"; `owners --json` keeps `expiresAt: null` deliberately); `integrity.mjs:780` (already rendered null) | Never throws (5.3). |
| `isLiveClaim()` | `claims.mjs` ×6, `integrity.mjs:778` | A null expiry reads expired everywhere. |
| `readRepoClaim()` / `writeRepoClaim()` / `clearRepoClaim()` | `claim --repo`, `unclaim --repo`, `owners` | The writer is temp file plus rename (5.5); not locked (D5). Its detached-tree check now asks about the per-call root its path is built from, not the import-time `ROOT` (Gate 2 I1). The other `isDetachedTree()` callers — `appendDetourLog`, `writeWatch`, `snapshot`, `commitNudge` — write paths derived from that same frozen `ROOT`, so their check and their write agree; `activity-log.mjs` already passes `activityRoot()`. A killed writer can leave `session-claim.json.tmp-*`, which the `.conductor/session-claim.json*` entry ignores. |
| `ownerRows()` / `formatOwners()` | `owners` | See `claimExpiry`. |

DATA `claim.ttlMinutes`: written by `makeClaim` (both claim paths), read by `claimExpiry` and `integrity.mjs:781`'s message, removed by `unclaim` (`delete epic.claim`, `clearRepoClaim`) and by archive (`update-epic.mjs:853`). A stored value above the bound from an earlier engine reads as expired (5.3).

## 5. The rules block

| symbol | call sites | where the rule holds / does not |
| --- | --- | --- |
| `writeRules()` | `conductor.mjs` write-rules, `init`, `upgrade`, `set-tracker` ×3 (`tracker.mjs:64`, `:86`, `:133`), `set-review-mode` | Refuses an ambiguous arrangement at the block write for every caller. `set-tracker` and `set-review-mode` do so after their state save, WITHOUT a preflight (D6: none stamps a done-marker; the message names `write-rules` then `render`). |
| `rulesBlockArrangement()` | `writeRules`, `assertRulesBlockWritable` | The only locator. |
| `assertRulesBlockWritable()` | `init`, `upgrade` | Exactly the two verbs D6 singles out, before their first write (6.3). |
| `RULES_BEGIN_PREFIX` / `RULES_END` | `rules.mjs` `rulesBlockArrangement` | Whole-line match. |
| `RULES_BEGIN` | `rules.mjs:541` (the producer: the block's own first line), `constants.mjs` | Not a reader. |
| `evals/observe.py` `RULES_BEGIN` | `_has_rules_block()` | **Changed (6.7), not justified away:** it now matches a whole BEGIN line as the engine does, with a pytest RED/GREEN. It remains a presence check, not a locator — it never splices. |

Other plain `writeFileSync` / append writes of `.conductor/` files a reader parses, and whether a torn write matters: `commit-watch.json` (`readWatch` reads torn as no baseline → one invocation on the unverifiable rung; harmless and pre-existing); `render-stamp.json` (`verify-state` reads torn as "no stamp" → a false "never rendered"; pre-existing, low); `write-conflicts.latch` (existence only); `brief.txt` (nothing reads it); `detours.log`, `write-conflicts.log`, `honcho-memories.log`, activity segments (line appends; activity counts a malformed line). None is in this change's scope.

## Parity ledger

This change adds no file under `commands/`, `agents/`, `skills/`, `hooks/` or `.claude-plugin/` (`hooks/README.md` is modified and already claimed); the OpenSpec capability `managed-rules-block` is not a parity-ledger capability. `node --test scripts/test/parity.test.mjs`: 14/14.

## 7.2 — the inverse of every operation added

| operation | inverse | shipped? |
| --- | --- | --- |
| acquire the state lock | release in `finally` | yes |
| acquire the break file | release in `finally`; age recovery for a dead breaker | yes |
| a holder dies holding the lock | the stale break is that inverse | yes |
| `ensureGitignore` adds `state.json.lock*`, `session-claim.json*` | remove an entry | no — `ensureGitignore` has never removed any entry it manages; a stale ignore line is harmless. The old exact `session-claim.json` line is likewise left beside the glob. |
| rules block append / refresh | remove the block | no — no verb has ever removed it; its marker says it is safe to delete by hand |
| refused TTL, refused state file, refused block write in `init`/`upgrade` | none needed | they write nothing |
| `set-tracker` / `set-review-mode` state save followed by a refused block write | the same verb with the previous value (the block write is completed by `write-rules` then `render`) | yes, by existing verbs |
| `commit-nudge` advances its watermark over an unreadable file | none | accepted (D3): the reminder for that commit is not re-shown after the repair |
| repo claim written by temp + rename | `unclaim --repo` | yes (unchanged) |
| the lock-timeout / ownership-loss skip recorded to the sidecar | `clearConflicts()` on the next successful save | yes (unchanged) |

No further operation was found by the sweep.
