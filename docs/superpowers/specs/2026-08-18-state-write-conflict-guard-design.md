# Design: state.json write-conflict guard

**Epic:** `state-lost-update-concurrent-sessions` (P1) · **Issue:** cfdude/pm#83
**Date:** 2026-08-18 · **Engine:** 0.25.2

## The defect

`.conductor/state.json` is read-modify-written with no version, no lock, and no comparison.
Two processes that both `loadState()`, mutate, and `saveState()` produce a **silent lost
update**: the second write wins wholesale, the first one's change vanishes, and nothing in the
file or on stderr records that it happened.

`saveState()` already writes atomically — tmp file plus `rename(2)` — so a crash never leaves a
torn file. That guarantees the *write*. The unguarded thing is the *cycle*.

### This is not only a multi-session bug

The framing on #83 is orchestration across sessions, which is real. But `render.mjs:18`:

```js
if (reconcileArchived(state)) saveState(state);
```

`render` is invoked by the SessionStart hook, the PreCompact hook, and the PostToolUse
commit-nudge. **A single session's own hooks race its interactive commands.** Any fix must
therefore assume writers are common, not rare.

Measured surface: **24 `saveState()` call sites across 17 files, 34 `loadState()` sites.**

## Approach: optimistic concurrency, not a lock

`#83` argues against a lockfile and is right: a session killed mid-write leaves the lock held
forever, which needs PID checks and timeouts, and introduces a new failure mode where the tool
refuses to work. A revision comparison has no such state to leave behind.

**The guard lives entirely in `scripts/lib/state.mjs`. No call site changes.**

Verified that this is possible: every writer follows `const s = loadState(); …; saveState(s)`,
there are **zero** `saveState({…})` fresh-object calls, and every file calling `saveState` also
calls `loadState`. So the revision rides inside the state object the caller already round-trips.

```
loadState()   → stamps the on-disk revision onto the returned object (absent → 0)
saveState(s)  → re-reads the file, compares revisions
                 match    → write with revision + 1
                 mismatch → conflict
```

Absent-means-zero is what makes a `state.json` written by 0.25.2 load unchanged, so no
`MIGRATIONS` entry is required — the first write stamps `1`.

## Two writer classes, two behaviours

The single most important decision here, because "fail loudly" is right for only one of them.

| Writer | On conflict | Why |
|---|---|---|
| **Interactive verbs** (`add-epic`, `update-epic`, `set-active`, …) | **Fail loudly.** Distinct exit code, message naming what changed. No retry. | A human or agent is present and can re-read and re-apply. A silent overwrite here is the data loss the epic exists to stop. |
| **Hook writes** (`render`, `brief`, `snapshot`, `commit-nudge`) | **Retry once, then skip.** | The only hook write is `reconcileArchived()`'s self-heal, which re-runs on the next hook. Losing it costs nothing; hard-failing turns an invisible race into a visible mid-session error for a write that did not matter. |

A `--force` escape hatch exists on the interactive path for the deliberate overwrite, so nobody
learns to hand-edit `state.json` to get around the guard.

### But a *pattern* of skips is a real failure and must be noisy

**Maintainer ruling, 2026-08-18:** *"Retry once then skip, but repeated failures is a problem
that should be addressed and made noisy."*

A single skip is transient contention. Repeated skips mean something is genuinely wrong — a
wedged writer holding the file, a hook firing in a loop, or genuine sustained contention — and
silently degrading through that is the same class of defect as everything else this tracker has
been filing.

**The counter cannot live in `state.json`.** That is the file the write just failed against;
recording the failure there would need the very write that is failing. It gets its own sidecar:

- `.conductor/write-conflicts.log` — append-only, one line per skipped hook write
  (`<ts>\t<verb>\t<expected-rev>\t<found-rev>`). Appending needs no guard, since it is
  append-only and never read-modify-written.
- **A successful state write truncates it.** The signal of interest is *consecutive* skips
  since the last success, not skips ever. Without the reset a single bad afternoon nags forever.
- **The briefing surfaces it once, on threshold.** At N consecutive skips (N = 3), the brief
  carries `⚠ N state writes skipped on conflict since <ts> — a writer may be wedged`.

### Escalate on the pattern, not on each occurrence

Explicitly following the maintainer's prior experience with an error repeating every three
minutes and flooding logs and Slack: **do not warn on skip 1, and do not re-warn on skips 4, 5,
6.** Warn once when the threshold trips, and again only after a success has reset the counter
and it trips again. A warning that repeats per-occurrence trains the reader to filter it, which
is how a real signal becomes invisible.

## The check that can fail

Every assertion below can fail against the current engine today:

1. **Two writers, one loses** — construct two states from the same revision, save both; the
   second must be refused, not written. Fails today (it is written).
2. **The refusal is distinguishable** — a conflict exits with its own code, not the generic 1,
   so an agent can tell "someone else wrote" from "bad flag".
3. **`--force` overwrites deliberately** — and only with the flag.
4. **A hook write retries once and skips** — it does not exit non-zero and does not abort the
   hook.
5. **Threshold warning appears at N, once** — and does *not* re-appear at N+1.
6. **A successful write clears the counter** — the next skip starts from 1.
7. **Backward compatibility** — a `state.json` with no `revision` loads, and its first write
   stamps 1.

Assertion 5 is the one most likely to be written vacuously: it must assert both the appearance
at N **and the absence** at N+1, or it passes on a warning that fires every time.

## Scope

**In:** `scripts/lib/state.mjs` (the guard), the conflict sidecar, the briefing surface, a
`--force` flag on the interactive path, tests.

**Out, deliberately:**

- **Reshaping call sites into a `mutate(fn)` form for replay.** Fail-loud needs no replay, and
  the refactor would touch 24 sites for no gain at this stage.
- **Advisory claim/release (#84).** Cooperative signalling is a different half from write
  enforcement, and #84 was filed separately on purpose.
- **`cross-session-epic-assignment`.** It depends on this landing; it is not part of it.

## Consequence

A lost update becomes a refused write with a distinct exit code, and a degraded hook path
becomes visible after three consecutive skips instead of never. `cross-session-epic-assignment`
is unblocked — dispatch across concurrent sessions is unsafe until this exists, which is why the
dependency link points this way.
