# State Write-Conflict Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a silent lost update on `.conductor/state.json` into a refused write with a distinct exit code, while letting hook writes degrade quietly — but only until a *pattern* of skips appears, which must become visible.

**Architecture:** Optimistic concurrency, not a lock. `loadState()` stamps the on-disk revision onto the object it returns; `saveState()` re-reads and compares before its existing atomic rename. Because every writer round-trips the object it loaded, the revision travels inside it and **no call site changes**. Hook writes pass a flag that converts a conflict from an exit into a logged skip, counted in a sidecar the state lock cannot protect.

**Tech Stack:** Node 18+ built-ins only (`node:fs`, `node:path`). Tests: `node --test scripts/test/*.test.mjs`.

**Spec:** `docs/superpowers/specs/2026-08-18-state-write-conflict-guard-design.md`

## Global Constraints

- **`scripts/conductor.mjs` and `scripts/lib/*.mjs` are ZERO-DEPENDENCY.** Node 18+ built-ins only (`node:fs`, `node:path`, `node:os`, `node:child_process`, `node:url`). **Never** add an npm package or a `package.json` dependency.
- **`node --test scripts/test/*.test.mjs` must pass — currently 308 tests, 0 failing.** `.githooks/pre-commit` runs it and blocks failing commits. **NEVER** use `git commit --no-verify`. The suite takes ~130 s; pass a Bash timeout of **300000 ms** when running it or committing.
- **pm is an INSTRUCTION layer, never an INTEGRATION layer.** No code path may open a network connection or call an external system. This plan adds none.
- **Backward compatibility is mandatory.** A `state.json` written by 0.25.2 has no `revision`; it must load unchanged and its first write stamps `1`. **No `MIGRATIONS` entry is required** — absent-means-zero handles it.
- **Release discipline:** this changes user-visible engine behaviour (a new exit code, a new warning in the brief, `init` writing `.gitignore`), so it ships as a version bump plus a `CHANGELOG.md` entry. Current version is `0.25.2`; this ships as **`0.26.0`** (new behaviour, not just a fix).
- Conventional commits (`feat|fix|docs|test|chore|refactor`).
- **Do not push and do not open a pull request.** Commits stay local; the branch is finished separately via the `pr-workflow` skill.
- **Stay on branch `dev`.** `.claude/commands/opsx/*` and `.claude/skills/openspec-*` carry pre-existing uncommitted changes from an unrelated OpenSpec upgrade — **leave them alone, never stage them.**

### Frozen decisions — use these exact values, do not re-derive

| Decision | Value |
|---|---|
| Conflict exit code | **`9`** — distinct from the `1` used by every existing validation failure (14 sites in `update-epic.mjs` alone) |
| Sidecar path | `.conductor/write-conflicts.log` |
| Sidecar line format | `<ISO ts>\t<verb>\t<expected-rev>\t<found-rev>\n` |
| Rotation trigger | `fs.statSync(path).size > 8192` |
| Rotation action | `rename` to `<path>.prev`, replacing any existing `.prev`. **Never read the log body.** |
| Threshold for the brief warning | **3** consecutive skips |
| Hook verbs (skip, don't fail) | `brief`, `commit-nudge`, `gate-guard`, `snapshot` — the four in `hooks/hooks.json` — plus `render`, which they call |
| `.gitignore` entries added by `init`/`upgrade` | `.conductor/write-conflicts.log` and `.conductor/detours.log` |

## File Structure

- **`scripts/lib/constants.mjs`** (modify) — add `WRITE_CONFLICTS_LOG`, `CONFLICT_EXIT_CODE`, `CONFLICT_LOG_MAX_BYTES`, `CONFLICT_WARN_THRESHOLD`. Pure data.
- **`scripts/lib/state.mjs`** (modify) — the guard itself: revision stamping in `loadState()`, comparison in `saveState()`. One responsibility: *the state file's read/write contract.*
- **`scripts/lib/write-conflicts.mjs`** (create) — the sidecar: append, rotate, count, clear. Kept out of `state.mjs` because it must remain usable **when the state write has failed**, and because `state.mjs` should not grow a logging concern.
- **`scripts/lib/briefing.mjs`** (modify) — surface the threshold warning.
- **`scripts/lib/subcommands.mjs`** (modify) — `init` writes the `.gitignore` entries; `upgrade` backfills them.
- **`scripts/test/conductor-12.test.mjs`** (create) — all tests for this feature. A new capability gets its own file, matching how `platform.test.mjs` and `parity.test.mjs` were added; it also keeps the parallel split balanced.

**Not touched:** the 24 `saveState()` call sites. That is the design's central claim and it must stay true — a plan that ends up editing them has taken a wrong turn.

---

### Task 1: The revision guard in state.mjs

**Files:**
- Modify: `scripts/lib/constants.mjs` (after `DETOURS_LOG`, line 12)
- Modify: `scripts/lib/state.mjs`
- Create: `scripts/test/conductor-12.test.mjs`

**Interfaces:**
- Consumes: `STATE_PATH`, `CONDUCTOR_DIR` from `constants.mjs` (already imported by `state.mjs`).
- Produces:
  ```js
  // constants.mjs
  export const CONFLICT_EXIT_CODE = 9;
  // state.mjs
  export function loadState(): object          // now carries a numeric `revision` (absent on disk → 0)
  export function saveState(state, opts?): boolean
  //   opts = { onConflict: "throw" | "skip", verb?: string }   default: "throw"
  //   returns true when written; false only when opts.onConflict === "skip" and a conflict occurred
  export class StateConflictError extends Error   // .expected, .found
  ```
  `saveState` keeps its existing single-argument call shape, so all 24 existing call sites compile and behave identically apart from the new refusal.

- [ ] **Step 1: Write the failing tests**

Create `scripts/test/conductor-12.test.mjs` with exactly this content:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run } from "./helpers.mjs";

// ─────────────── the revision guard ───────────────
//
// state.json was read-modify-written with no comparison, so two writers that both loaded the
// same state produced a SILENT lost update: second write wins, first change gone, nothing
// recorded. The atomic rename already guaranteed the WRITE; the unguarded thing was the CYCLE.

/** Load state.mjs fresh with CLAUDE_PROJECT_DIR pointed at `cwd`, since constants.mjs
 *  resolves ROOT once at import time. A cache-busting query makes each load independent. */
async function freshState(cwd) {
  process.env.CLAUDE_PROJECT_DIR = cwd;
  const url = new URL("../lib/state.mjs", import.meta.url);
  return import(`${url.href}?t=${Date.now()}${Math.random()}`);
}

test("loadState stamps a revision, and a file written without one reads as 0", async () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  // init wrote via saveState, so it is already at revision 1. Simulate a 0.25.2 file:
  const p = path.join(cwd, ".conductor", "state.json");
  const raw = JSON.parse(fs.readFileSync(p, "utf8"));
  delete raw.revision;
  fs.writeFileSync(p, JSON.stringify(raw, null, 2) + "\n");

  const { loadState } = await freshState(cwd);
  assert.equal(loadState().revision, 0, "a pre-0.26 state.json must load as revision 0");
});

test("a second writer holding a stale revision is REFUSED, not silently applied", async () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const { loadState, saveState, StateConflictError } = await freshState(cwd);

  const a = loadState();          // both read the same revision
  const b = loadState();

  a.epics.push({ id: "from-a", title: "a", priority: "P1", status: "queued", role: "epic", lane: "claude-code", links: [] });
  assert.equal(saveState(a), true, "the first writer must succeed");

  b.epics.push({ id: "from-b", title: "b", priority: "P1", status: "queued", role: "epic", lane: "claude-code", links: [] });
  assert.throws(() => saveState(b), StateConflictError,
    "the second writer holds a stale revision and must be refused");

  // and the first writer's change must still be on disk
  const onDisk = JSON.parse(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"));
  assert.deepEqual(onDisk.epics.map(e => e.id), ["from-a"],
    "the refused write must not have clobbered the successful one");
});

test("a successful write increments the revision", async () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const { loadState, saveState } = await freshState(cwd);

  const first = loadState().revision;
  const s = loadState();
  saveState(s);
  assert.equal(loadState().revision, first + 1);
});

test("--force overwrites deliberately, and ONLY with the flag", async () => {
  // Without a documented override people learn to hand-edit state.json to get past the guard,
  // which is strictly worse than an override that leaves a trace in the command line.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const { loadState, saveState } = await freshState(cwd);

  const stale = loadState();
  saveState(loadState());                        // advance the on-disk revision

  const argv = process.argv;
  try {
    process.argv = [...argv, "--force"];
    assert.equal(saveState(stale).ok, true, "--force must write despite the stale revision");
  } finally {
    process.argv = argv;
  }
});

test("onConflict:skip returns false instead of throwing", async () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const { loadState, saveState } = await freshState(cwd);

  const stale = loadState();
  saveState(loadState());                       // advance the on-disk revision

  assert.equal(saveState(stale, { onConflict: "skip", verb: "render" }), false,
    "a hook write must report the skip rather than exiting");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test scripts/test/conductor-12.test.mjs`

Expected: FAIL — `loadState().revision` is `undefined` (not `0`), and `saveState` neither throws nor accepts a second argument.

- [ ] **Step 3: Add the constants**

In `scripts/lib/constants.mjs`, after the `DETOURS_LOG` line:

```js
export const WRITE_CONFLICTS_LOG = path.join(CONDUCTOR_DIR, "write-conflicts.log");
// Distinct from the 1 that every validation failure already uses (14 sites in update-epic.mjs
// alone), so an agent can tell "someone else wrote" from "you passed a bad flag" and retry
// rather than guess.
export const CONFLICT_EXIT_CODE = 9;
// Size-triggered rotation, never count-based: enforcing "keep the last N entries" means
// reading, filtering and rewriting the file, and this is the failure path of a WRITE guard.
// statSync is O(1) and rename(2) is O(1), so the mechanism never reads the log body.
export const CONFLICT_LOG_MAX_BYTES = 8192;
export const CONFLICT_WARN_THRESHOLD = 3;
```

- [ ] **Step 4: Implement the guard**

Replace `loadState` and `saveState` in `scripts/lib/state.mjs` with:

```js
/** Thrown when a write would clobber a newer revision than the one this caller read. */
export class StateConflictError extends Error {
  constructor(expected, found) {
    super(`state.json changed under this process (read revision ${expected}, found ${found})`);
    this.name = "StateConflictError";
    this.expected = expected;
    this.found = found;
  }
}

/** Read the revision currently on disk without parsing the whole state twice at the call site. */
function diskRevision() {
  const s = readJSON(STATE_PATH, null);
  return s && typeof s === "object" && Number.isInteger(s.revision) ? s.revision : 0;
}

export function loadState() {
  const s = readJSON(STATE_PATH, null);
  const base = s && typeof s === "object" ? { ...defaultState(), ...s } : defaultState();
  // Absent means 0, which is what lets a state.json written by 0.25.2 load unchanged and take
  // revision 1 on its first write. No migration is needed for that reason.
  base.revision = Number.isInteger(base.revision) ? base.revision : 0;
  return base;
}

/** Atomic write with an optimistic revision check.
 *
 *  The tmp-file + rename(2) below already guaranteed the WRITE was atomic — a crash never left
 *  a torn state.json. What was unguarded was the read-modify-write CYCLE: two processes that
 *  both loaded the same revision each wrote back wholesale, and the second silently discarded
 *  the first one's change. A lockfile was rejected because a session killed mid-write leaves
 *  the lock held forever; a revision comparison leaves nothing behind.
 *
 *  opts.onConflict "throw" (default) is for interactive verbs: a human or agent is present and
 *  can re-read and re-apply. "skip" is for HOOK writes, whose only write is reconcileArchived()'s
 *  self-heal — that re-runs on the next hook, so losing it costs nothing, while hard-failing
 *  would turn an invisible race into a visible mid-session error for a write that did not matter.
 */
export function saveState(state, opts = {}) {
  const { onConflict = "throw", verb = "unknown" } = opts;
  fs.mkdirSync(CONDUCTOR_DIR, { recursive: true });

  const expected = Number.isInteger(state.revision) ? state.revision : 0;
  const found = diskRevision();
  // --force is the deliberate "I know, overwrite it" escape hatch. It is read from argv rather
  // than threaded through 24 call sites, which is the same shape as platformFlag() in
  // conductor.mjs. Without an escape hatch people learn to hand-edit state.json to get around
  // the guard, which is strictly worse than a documented override.
  const forced = process.argv.includes("--force");
  if (found !== expected && !forced) {
    if (onConflict === "skip") return { ok: false, expected, found, verb };
    throw new StateConflictError(expected, found);
  }

  const next = { ...state, revision: expected + 1 };
  const data = JSON.stringify(next, null, 2) + "\n";
  const tmpPath = `${STATE_PATH}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, data);
  fs.renameSync(tmpPath, STATE_PATH);
  state.revision = next.revision;   // keep the caller's object usable for a subsequent save
  return { ok: true, revision: next.revision };
}
```

Then change the test's two `saveState` assertions to read the `ok` field, since the richer
return is what Task 2 needs. In `scripts/test/conductor-12.test.mjs`, replace:

```js
  assert.equal(saveState(a), true, "the first writer must succeed");
```
with
```js
  assert.equal(saveState(a).ok, true, "the first writer must succeed");
```
and replace:
```js
  assert.equal(saveState(stale, { onConflict: "skip", verb: "render" }), false,
    "a hook write must report the skip rather than exiting");
```
with
```js
  assert.equal(saveState(stale, { onConflict: "skip", verb: "render" }).ok, false,
    "a hook write must report the skip rather than exiting");
```

Also update the `Produces` contract above in your head: `saveState` returns
`{ok: true, revision}` or `{ok: false, expected, found, verb}`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test scripts/test/conductor-12.test.mjs`

Expected: PASS, 5 tests.

- [ ] **Step 6: Run the full suite**

Run: `node --test scripts/test/*.test.mjs` (Bash timeout 300000 ms)

Expected: 313 tests, 0 failing (308 + 5). **If any existing test fails, stop and report it** — a
failure here means an existing writer does not round-trip its loaded object, which contradicts
the design's central claim and must be resolved before continuing rather than worked around.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/constants.mjs scripts/lib/state.mjs scripts/test/conductor-12.test.mjs
git commit -m "feat(state): refuse a write that would clobber a newer revision"
```

---

### Task 2: The conflict sidecar

**Files:**
- Create: `scripts/lib/write-conflicts.mjs`
- Modify: `scripts/test/conductor-12.test.mjs` (append)

**Interfaces:**
- Consumes: `WRITE_CONFLICTS_LOG`, `CONFLICT_LOG_MAX_BYTES`, `CONFLICT_WARN_THRESHOLD` from `constants.mjs`; the `{ok:false, expected, found, verb}` shape from Task 1.
- Produces:
  ```js
  export function recordConflict({ verb, expected, found }): void  // append + rotate if needed
  export function conflictCount(): number                          // consecutive skips since last success
  export function clearConflicts(): void                           // called after any successful write
  ```

- [ ] **Step 1: Write the failing tests**

Append to `scripts/test/conductor-12.test.mjs`:

```js
// ─────────────── the conflict sidecar ───────────────
//
// The counter CANNOT live in state.json: that is the file the write just failed against, so
// recording the failure there would need the very write that is failing. Hence a sidecar that
// is append-only and therefore needs no guard of its own.

async function freshConflicts(cwd) {
  process.env.CLAUDE_PROJECT_DIR = cwd;
  const url = new URL("../lib/write-conflicts.mjs", import.meta.url);
  return import(`${url.href}?t=${Date.now()}${Math.random()}`);
}

test("recordConflict appends one line per skip and conflictCount counts them", async () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const { recordConflict, conflictCount } = await freshConflicts(cwd);

  assert.equal(conflictCount(), 0, "a repo with no conflicts must report zero");
  recordConflict({ verb: "render", expected: 4, found: 5 });
  recordConflict({ verb: "brief", expected: 5, found: 6 });
  assert.equal(conflictCount(), 2);

  const body = fs.readFileSync(path.join(cwd, ".conductor", "write-conflicts.log"), "utf8");
  assert.match(body, /\trender\t4\t5\n/, "the line must name the verb and both revisions");
});

test("clearConflicts resets the count — the signal is CONSECUTIVE skips, not skips ever", async () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const { recordConflict, conflictCount, clearConflicts } = await freshConflicts(cwd);

  recordConflict({ verb: "render", expected: 1, found: 2 });
  recordConflict({ verb: "render", expected: 1, found: 3 });
  clearConflicts();
  assert.equal(conflictCount(), 0, "a successful write must reset, or one bad hour nags forever");
});

test("the log rotates on SIZE to a .prev, and rotation never reads the body", async () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const { recordConflict } = await freshConflicts(cwd);
  const logPath = path.join(cwd, ".conductor", "write-conflicts.log");

  // Pre-fill past the 8192-byte cap without going through recordConflict.
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, "x".repeat(9000));

  recordConflict({ verb: "render", expected: 9, found: 10 });

  assert.ok(fs.existsSync(`${logPath}.prev`), "the oversized log must be rotated to .prev");
  assert.equal(fs.readFileSync(`${logPath}.prev`, "utf8").length, 9000,
    ".prev must hold the previous body verbatim");
  const fresh = fs.readFileSync(logPath, "utf8");
  assert.ok(fresh.length < 200 && fresh.includes("render"),
    "the live log must restart with just the new entry");
});

test("rotation replaces an existing .prev rather than accumulating files", async () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const { recordConflict } = await freshConflicts(cwd);
  const logPath = path.join(cwd, ".conductor", "write-conflicts.log");
  fs.mkdirSync(path.dirname(logPath), { recursive: true });

  fs.writeFileSync(`${logPath}.prev`, "older");
  fs.writeFileSync(logPath, "y".repeat(9000));
  recordConflict({ verb: "brief", expected: 1, found: 2 });

  assert.equal(fs.readFileSync(`${logPath}.prev`, "utf8").length, 9000,
    "the new .prev must overwrite the old one");
  assert.ok(!fs.existsSync(`${logPath}.prev.prev`), "rotation must not chain");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test scripts/test/conductor-12.test.mjs`

Expected: the four new tests FAIL with `Cannot find module '.../scripts/lib/write-conflicts.mjs'`.

- [ ] **Step 3: Implement the sidecar**

Create `scripts/lib/write-conflicts.mjs`:

```js
// scripts/lib/write-conflicts.mjs
// The conflict sidecar for hook writes that were skipped rather than applied.
//
// WHY A SIDECAR. The count cannot live in state.json — that is the file whose write just
// failed, so recording the failure there would require the very write that is failing. This
// log is APPEND-ONLY and therefore needs no guard of its own: no reader-modifier-writer, no
// lock, nothing that can be lost to the race it exists to record.

import fs from "node:fs";
import {
  CONDUCTOR_DIR, WRITE_CONFLICTS_LOG, CONFLICT_LOG_MAX_BYTES,
} from "./constants.mjs";

/** Rotate when the file exceeds the cap. Deliberately SIZE-triggered and wholesale:
 *  statSync is O(1) and rename(2) is O(1), so this never reads the log body. A count cap
 *  ("keep the last N") would require reading, filtering and rewriting on every trip — a
 *  read-modify-write on the path that exists to record a failed read-modify-write. */
function rotateIfNeeded() {
  let size = 0;
  try { size = fs.statSync(WRITE_CONFLICTS_LOG).size; } catch { return; }
  if (size <= CONFLICT_LOG_MAX_BYTES) return;
  try { fs.renameSync(WRITE_CONFLICTS_LOG, `${WRITE_CONFLICTS_LOG}.prev`); } catch { /* best effort */ }
}

export function recordConflict({ verb, expected, found }) {
  fs.mkdirSync(CONDUCTOR_DIR, { recursive: true });
  rotateIfNeeded();
  const line = `${new Date().toISOString()}\t${verb}\t${expected}\t${found}\n`;
  try { fs.appendFileSync(WRITE_CONFLICTS_LOG, line); } catch { /* diagnostics must never break a hook */ }
}

/** Consecutive skips since the last successful write. Counting lines is fine here — this is
 *  read only by the briefing, not on the write path, and the file is capped at 8 KB. */
export function conflictCount() {
  try {
    return fs.readFileSync(WRITE_CONFLICTS_LOG, "utf8").split("\n").filter(Boolean).length;
  } catch { return 0; }
}

/** Called after ANY successful state write. The signal of interest is CONSECUTIVE skips, not
 *  skips ever — without this reset a single contended afternoon would warn forever. */
export function clearConflicts() {
  try { fs.rmSync(WRITE_CONFLICTS_LOG, { force: true }); } catch { /* best effort */ }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test scripts/test/conductor-12.test.mjs`

Expected: PASS, 9 tests.

- [ ] **Step 5: Run the full suite**

Run: `node --test scripts/test/*.test.mjs` (Bash timeout 300000 ms)

Expected: 317 tests, 0 failing.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/write-conflicts.mjs scripts/test/conductor-12.test.mjs
git commit -m "feat(state): append-only conflict sidecar with size-triggered rotation"
```

---

### Task 3: Wire the two together, and warn on the pattern

**Files:**
- Modify: `scripts/lib/state.mjs` (call the sidecar from `saveState`)
- Modify: `scripts/lib/render.mjs:18` (the one hook write)
- Modify: `scripts/lib/briefing.mjs`
- Modify: `scripts/test/conductor-12.test.mjs` (append)

**Interfaces:**
- Consumes: `recordConflict`, `conflictCount`, `clearConflicts` from Task 2; `CONFLICT_WARN_THRESHOLD` from Task 1's constants.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/test/conductor-12.test.mjs`:

```js
// ─────────────── the threshold warning ───────────────

test("the brief warns ONCE at the threshold and does NOT re-warn above it", async () => {
  // The absence half is the point. A warning that fires on every skip past the threshold is the
  // three-minute error storm that trains a reader to filter it — which is how a real signal
  // becomes invisible. Assert both halves or this test passes on a warning that always fires.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const { recordConflict } = await freshConflicts(cwd);

  recordConflict({ verb: "render", expected: 1, found: 2 });
  recordConflict({ verb: "render", expected: 1, found: 3 });
  assert.doesNotMatch(run(["brief"], { cwd }), /writes skipped on conflict/,
    "below the threshold the brief must stay quiet");

  recordConflict({ verb: "render", expected: 1, found: 4 });   // now at 3
  assert.match(run(["brief"], { cwd }), /3 state writes skipped on conflict/,
    "at the threshold the brief must say so");

  recordConflict({ verb: "render", expected: 1, found: 5 });   // now at 4
  assert.doesNotMatch(run(["brief"], { cwd }), /writes skipped on conflict/,
    "past the threshold it must NOT warn again until a success resets it");
});

test("a successful state write clears the conflict log", async () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const { recordConflict } = await freshConflicts(cwd);
  recordConflict({ verb: "render", expected: 1, found: 2 });

  run(["add-epic", "--id", "clears-it", "--lane", "claude-code", "--priority", "P3"], { cwd });

  assert.ok(!fs.existsSync(path.join(cwd, ".conductor", "write-conflicts.log")),
    "any successful write must reset the consecutive-skip signal");
});
```

**Note on the "warn once" mechanism:** `conflictCount()` returning exactly `CONFLICT_WARN_THRESHOLD` is the trigger. Above it, the brief stays silent. That is why the third assertion above is `doesNotMatch` — equality, not `>=`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test scripts/test/conductor-12.test.mjs`

Expected: both new tests FAIL — the brief contains no such warning, and a successful write does not remove the log.

- [ ] **Step 3: Record and clear from saveState**

In `scripts/lib/state.mjs`, add the import:

```js
import { recordConflict, clearConflicts } from "./write-conflicts.mjs";
```

and in `saveState`, replace the conflict branch and the success tail:

```js
  if (found !== expected) {
    if (onConflict === "skip") {
      recordConflict({ verb, expected, found });
      return { ok: false, expected, found, verb };
    }
    throw new StateConflictError(expected, found);
  }
```

and immediately before `return { ok: true, revision: next.revision };`:

```js
  clearConflicts();   // consecutive skips end at the first success
```

- [ ] **Step 4: Make the one hook write skip rather than throw**

In `scripts/lib/render.mjs:18`, change:

```js
  if (reconcileArchived(state)) saveState(state);
```

to:

```js
  // The ONLY hook write. reconcileArchived() is a self-heal that re-runs on the next hook, so a
  // conflict here costs nothing — while throwing would turn an invisible race into a visible
  // mid-session error for a write that did not matter.
  //
  // RETRY ONCE, THEN SKIP (the ruling). The retry has to reload and RE-RUN the heal rather than
  // re-attempt the same write: the in-hand state is built on a revision someone else has already
  // superseded, so writing it again would clobber exactly what the guard exists to protect.
  // Replay is affordable here and nowhere else — this is one call site with one pure heal, not
  // the 24-site refactor the design deliberately excluded.
  if (reconcileArchived(state)) {
    const first = saveState(state, { onConflict: "skip", verb: "render" });
    if (!first.ok) {
      const fresh = loadState();
      if (reconcileArchived(fresh)) saveState(fresh, { onConflict: "skip", verb: "render" });
    }
  }
```

Note the second attempt is also `skip`, so a hook can never fail. Two conflicts in a row record
**two** entries, which is correct: the threshold counts consecutive skips, and a run that lost
twice genuinely is more contended than one that lost once.

- [ ] **Step 5: Surface the threshold in the briefing**

In `scripts/lib/briefing.mjs`, add to the imports:

```js
import { conflictCount } from "./write-conflicts.mjs";
import { CONFLICT_WARN_THRESHOLD } from "./constants.mjs";
```

and immediately after the `NOW:` line is pushed (the `L.push(\`NOW: ...\`)` / no-active-epic branch), add:

```js
  // Exactly-equal, not >=: warn ONCE when the pattern appears. Re-warning on every subsequent
  // skip is the repeating-error storm that trains a reader to filter the message, at which
  // point a real signal has been made invisible.
  if (conflictCount() === CONFLICT_WARN_THRESHOLD) {
    L.push(`⚠ ${CONFLICT_WARN_THRESHOLD} state writes skipped on conflict — a writer may be wedged (.conductor/write-conflicts.log)`);
  }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test scripts/test/conductor-12.test.mjs`

Expected: PASS, 12 tests.

- [ ] **Step 7: Run the full suite**

Run: `node --test scripts/test/*.test.mjs` (Bash timeout 300000 ms)

Expected: 320 tests, 0 failing.

- [ ] **Step 8: Commit**

```bash
git add scripts/lib/state.mjs scripts/lib/render.mjs scripts/lib/briefing.mjs scripts/test/conductor-12.test.mjs
git commit -m "feat(state): skip-and-record on hook writes, warn once at the threshold"
```

---

### Task 4: The conflict exit code on interactive verbs

**Files:**
- Modify: `scripts/conductor.mjs` (the dispatch tail)
- Modify: `scripts/test/conductor-12.test.mjs` (append)

**Interfaces:**
- Consumes: `StateConflictError` from Task 1, `CONFLICT_EXIT_CODE` from Task 1's constants.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing test**

Append to `scripts/test/conductor-12.test.mjs`:

```js
// ─────────────── the distinct exit code ───────────────

test("an interactive verb exits 9 on conflict, distinct from the 1 used by validation errors", async () => {
  // A generic exit 1 is indistinguishable from "you passed a bad flag", so an agent cannot tell
  // retry-me from fix-your-command. Every existing validation failure already uses 1.
  const cwd = tmpRepo();
  run(["init"], { cwd });

  // Hand-write a state.json whose revision is AHEAD of what the next command will read,
  // by writing it after that command has loaded. Simplest deterministic equivalent: bump the
  // on-disk revision behind the CLI's back is impossible in-process, so drive it via the API.
  const { loadState, saveState } = await freshState(cwd);
  const stale = loadState();
  saveState(loadState());              // on-disk revision now ahead of `stale`
  fs.writeFileSync(path.join(cwd, ".conductor", "state.json.stale"),
    JSON.stringify(stale, null, 2) + "\n");

  // Restore the stale revision INTO the live file so the next CLI call reads a revision that
  // no longer matches what it will find at write time... which cannot happen single-process.
  // Instead assert the mapping directly: the dispatcher must translate the error to exit 9.
  const r = spawnSync("node", [ENGINE, "--conflict-selftest"], {
    cwd, env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, PM_CACHE_ROOT: EMPTY_CACHE },
    encoding: "utf8",
  });
  assert.equal(r.status, 9, "a StateConflictError must map to exit 9");
  assert.match(r.stderr, /state\.json changed under this process/);
});
```

Add the imports this test needs at the top of the file, beside the existing ones:

```js
import { spawnSync } from "node:child_process";
import { ENGINE, EMPTY_CACHE } from "./helpers.mjs";
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/test/conductor-12.test.mjs`

Expected: FAIL — `--conflict-selftest` is not a subcommand, so the engine prints usage and exits 1, not 9.

- [ ] **Step 3: Map the error to the exit code**

In `scripts/conductor.mjs`, the dispatch is an IIFE of the form `({...}[cmd] || fallback)();`.
Wrap the invocation so a `StateConflictError` escaping any verb becomes exit 9, and add the
self-test verb the test drives.

Add to the imports at the top of `scripts/conductor.mjs`:

```js
import { StateConflictError } from "./lib/state.mjs";
import { CONFLICT_EXIT_CODE } from "./lib/constants.mjs";
```

Add this entry inside the dispatch object, beside `"rules-target"`:

```js
  // Deliberately a hidden verb, not a documented subcommand: it exists ONLY so a test can prove
  // that a StateConflictError escaping a verb maps to the distinct exit code. Without it the
  // mapping is untestable in-process, and an untested exit code is one nobody can rely on.
  "--conflict-selftest": () => { throw new StateConflictError(1, 2); },
```

and change the dispatch tail from:

```js
}[cmd] || (() => {
  process.stderr.write(USAGE);
  process.exit(1);
}))();
```

to:

```js
}[cmd] || (() => {
  process.stderr.write(USAGE);
  process.exit(1);
}));

try {
  handler();
} catch (err) {
  // A conflict is retryable and a validation error is not, so they must not share an exit code.
  if (err instanceof StateConflictError) {
    process.stderr.write(`conductor: ${err.message}\n`);
    process.exit(CONFLICT_EXIT_CODE);
  }
  throw err;
}
```

changing the preceding `({` to `const handler = ({` so the object is assigned rather than
immediately invoked.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test scripts/test/conductor-12.test.mjs`

Expected: PASS, 12 tests.

- [ ] **Step 5: Confirm the hidden verb is excluded from the doc-drift tests**

The SKILL.md and README.md drift tests in `scripts/test/conductor-09.test.mjs` assert every
dispatch key is documented. `--conflict-selftest` starts with `--`, so confirm the extraction
regexes (`/^\s*"([a-z-]+)"\s*:/gm` and friends) do not capture it.

Run: `node --test scripts/test/conductor-09.test.mjs`

Expected: PASS. **If a drift test now fails naming `--conflict-selftest`, stop** — do not add it
to an exclusion list. Report it, because the right fix is a naming change, not a suppression.

- [ ] **Step 6: Run the full suite**

Run: `node --test scripts/test/*.test.mjs` (Bash timeout 300000 ms)

Expected: 320 tests, 0 failing.

- [ ] **Step 7: Commit**

```bash
git add scripts/conductor.mjs scripts/test/conductor-12.test.mjs
git commit -m "feat(state): map a write conflict to exit 9, distinct from validation failures"
```

---

### Task 5: `.gitignore` for the conductor's generated logs

**Files:**
- Modify: `scripts/lib/subcommands.mjs` (`init`, and the `upgrade` path)
- Modify: `scripts/test/conductor-12.test.mjs` (append)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: nothing later tasks depend on.

This closes cfdude/pm#106: `.conductor/detours.log` has never been ignored by anything pm ships.
It is invisible on the maintainer's machine only because their personal global gitignore holds
`*.log`, so every other user has carried a permanently untracked file since it shipped.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/test/conductor-12.test.mjs`:

```js
// ─────────────── generated logs must not dirty the working tree ───────────────

test("init writes .gitignore entries for the conductor's generated logs", async () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const gi = fs.readFileSync(path.join(cwd, ".gitignore"), "utf8");
  assert.match(gi, /^\.conductor\/detours\.log$/m,
    "detours.log was ignored only by the maintainer's personal global gitignore (#106)");
  assert.match(gi, /^\.conductor\/write-conflicts\.log$/m);
});

test("init is idempotent — a second run does not duplicate the entries", async () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["init"], { cwd });
  const lines = fs.readFileSync(path.join(cwd, ".gitignore"), "utf8").split("\n");
  assert.equal(lines.filter(l => l === ".conductor/detours.log").length, 1);
});

test("init preserves an existing .gitignore instead of overwriting it", async () => {
  const cwd = tmpRepo();
  fs.writeFileSync(path.join(cwd, ".gitignore"), "node_modules/\n");
  run(["init"], { cwd });
  const gi = fs.readFileSync(path.join(cwd, ".gitignore"), "utf8");
  assert.match(gi, /^node_modules\/$/m, "an existing entry must survive");
  assert.match(gi, /^\.conductor\/detours\.log$/m);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test scripts/test/conductor-12.test.mjs`

Expected: all three FAIL — `init` writes no `.gitignore` at all (`rg gitignore scripts/lib/*.mjs`
returns nothing today).

- [ ] **Step 3: Implement the ignore write**

In `scripts/lib/subcommands.mjs`, add near the top-level imports:

```js
import path from "node:path";
import { ROOT } from "./constants.mjs";
```

(only add whichever of these is not already imported in that file), and add this function above
`export function init()`:

```js
/** Ensure the conductor's GENERATED artifacts are git-ignored.
 *
 *  #106: detours.log has never been ignored by anything pm ships. It is invisible on the
 *  maintainer's machine only because their personal ~/.gitignore_global carries `*.log`, so
 *  every other user has had a permanently untracked file since it shipped — the same class as
 *  #81 (PROJECT.md is never clean), and unnoticed precisely because the one person positioned
 *  to see it is configured not to.
 *
 *  state.json, render-stamp.json and PROJECT.md stay TRACKED: they are the state of record and
 *  the generated index, and both belong in git. */
function ensureGitignore() {
  const wanted = [".conductor/detours.log", ".conductor/write-conflicts.log"];
  const giPath = path.join(ROOT, ".gitignore");
  let existing = "";
  try { existing = fs.readFileSync(giPath, "utf8"); } catch { /* absent is fine */ }
  const have = new Set(existing.split("\n").map(l => l.trim()));
  const missing = wanted.filter(w => !have.has(w));
  if (missing.length === 0) return;
  const prefix = existing && !existing.endsWith("\n") ? "\n" : "";
  fs.appendFileSync(giPath, `${prefix}${missing.join("\n")}\n`);
}
```

Call it from `init()`, immediately after the `saveState(defaultState())` / already-initialized
branch closes — so it runs on a re-init too, which is what backfills an existing repo:

```js
  ensureGitignore();
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test scripts/test/conductor-12.test.mjs`

Expected: PASS, 15 tests.

- [ ] **Step 5: Backfill this repo's own .gitignore**

Run: `node scripts/conductor.mjs init`

Expected: `conductor: already initialized`, and `.gitignore` now carries both entries. Confirm
with `rg conductor .gitignore`. This repo's `.gitignore` already has `.conductor/brief.txt`;
leave it.

- [ ] **Step 6: Run the full suite**

Run: `node --test scripts/test/*.test.mjs` (Bash timeout 300000 ms)

Expected: 323 tests, 0 failing.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/subcommands.mjs scripts/test/conductor-12.test.mjs .gitignore
git commit -m "fix(init): git-ignore the conductor's generated logs

closes #106"
```

---

### Task 6: Release 0.26.0

**Files:**
- Modify: `.claude-plugin/plugin.json`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Bump the version**

In `.claude-plugin/plugin.json`, change `"version": "0.25.2"` to `"version": "0.26.0"`.

Minor, not patch: this adds a new exit code, a new brief warning, and makes `init` write a file
it never wrote before. All three are behaviour a user can observe.

- [ ] **Step 2: Add the changelog entry**

In `CHANGELOG.md`, replace the line `## [Unreleased]` with:

```markdown
## [Unreleased]

## [0.26.0] — 2026-08-18

### Added

- **`state.json` writes are now guarded against lost updates.** Two processes that both read the
  same state and wrote it back produced a **silent** lost update: the second write won wholesale
  and the first one's change vanished with no error. The atomic `rename(2)` already guaranteed
  the *write*; the unguarded thing was the read-modify-write *cycle*. `loadState()` now stamps
  the on-disk revision onto the object it returns and `saveState()` refuses a write whose
  revision is stale. A lockfile was rejected deliberately — a session killed mid-write leaves a
  lock held forever, whereas a revision comparison leaves nothing behind.
- **A conflict on an interactive verb exits `9`**, distinct from the `1` every validation failure
  already uses, so an agent can tell "someone else wrote, retry" from "you passed a bad flag".
- **Hook writes degrade instead of failing.** The only hook write is `reconcileArchived()`'s
  self-heal, which re-runs on the next hook — so a conflict there is recorded and skipped rather
  than surfaced as a mid-session error for a write that did not matter. **Three consecutive
  skips warn once in the briefing**, and only once: a warning that repeats per occurrence is the
  error storm that trains a reader to filter it, at which point a real signal is invisible.
- Skips are recorded in `.conductor/write-conflicts.log`, which rotates at 8 KB keeping one
  `.prev`. Size-triggered rather than count-based on purpose: enforcing "keep the last N" means
  reading and rewriting the file, and this is the failure path of a *write* guard.

### Fixed

- **`init` now git-ignores the conductor's generated logs** (#106). `.conductor/detours.log` had
  never been ignored by anything pm ships — it was invisible on the maintainer's machine only
  because their personal global gitignore carries `*.log`, so every other user had carried a
  permanently untracked file since it shipped. `state.json`, `render-stamp.json` and
  `PROJECT.md` remain tracked; they are the state of record and the generated index.

### Compatibility

- A `state.json` written by 0.25.2 has no `revision`; it loads unchanged and takes revision `1`
  on its first write. **No migration is required.**
```

- [ ] **Step 3: Run the full suite**

Run: `node --test scripts/test/*.test.mjs` (Bash timeout 300000 ms)

Expected: 323 tests, 0 failing.

- [ ] **Step 4: Commit**

```bash
git add .claude-plugin/plugin.json CHANGELOG.md
git commit -m "0.26.0: guard state.json against lost updates; git-ignore generated logs"
```

---

## Done means

- `node --test scripts/test/*.test.mjs` → 323 tests, 0 failing.
- All eight spec assertions have a test, and the threshold test asserts **both** the warning at 3 **and its absence at 4**.
- The 24 `saveState()` call sites are unchanged apart from `render.mjs:18`, which opts into skip.
- `.gitignore` in this repo carries both log entries.
- Version `0.26.0`, changelog entry present, no `MIGRATIONS` entry.
- **Not done here:** the Mintlify Changelog page, and the `pr-workflow` branch dance. Both are separate, and the release checklist owns them.
