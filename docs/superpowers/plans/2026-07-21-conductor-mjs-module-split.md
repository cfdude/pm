# conductor.mjs Module Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `scripts/conductor.mjs` (2,537 lines, 85 functions) into 25 `scripts/lib/*.mjs`
modules per the approved design, with zero behavior change — `conductor.mjs` becomes a thin
entry point (dispatch table + engine-banner logic + imports).

**Architecture:** One `lib/` module per existing comment section, except "helpers" (a
grab-bag) which splits into 6 cohesive modules. `render.mjs`, `briefing.mjs`,
`active-pointer.mjs`, `autonomy.mjs`, and `add-epic.mjs` form one mutually-dependent
cluster (verified by exact call-graph analysis, not guesswork) and are extracted together
in a single task. Every other cross-module dependency is one-directional.

**Tech Stack:** Node 18+ ES modules (`.mjs`), zero npm dependencies (CLAUDE.md hard
constraint). `node:fs`, `node:path`, `node:os`, `node:child_process`, `node:url` only.

## Global Constraints

- Zero-dependency: Node 18+ built-ins only. Never add an npm package or `package.json`.
- `node --test scripts/conductor.test.mjs` must pass (all pre-existing tests, unmodified)
  after **every** task in this plan. It is entirely black-box (shells out to the CLI via
  `execFileSync`/`spawnSync`), so it needs zero changes — its continued passing is the
  proof that behavior is unchanged.
- The `.githooks/pre-commit` hook re-runs the full suite on every commit and blocks on
  failure — do not bypass it (`--no-verify` is forbidden).
- No behavior changes of any kind. This is a mechanical extraction. Do not "improve"
  logic, rename variables, reformat unrelated code, or refactor while moving it.
- Conventional commits (`refactor(pm): ...`), one commit per task.
- File names match each section's banner text exactly, kebab-cased, parentheticals
  dropped (e.g. `// ---------- update-epic (write-back) ----------` → `update-epic.mjs`).

---

## Source map (current `scripts/conductor.mjs`, before any changes)

| Lines | Current section | Destination |
|---|---|---|
| 48-76 | (top-of-file constants) | `lib/constants.mjs` |
| 79-115 | helpers (state I/O) | `lib/state.mjs` |
| 92-95, 222-226 | helpers (git) | `lib/git.mjs` |
| 118-220 | helpers (plugin/changelog) | `lib/plugin-meta.mjs` |
| 229-441 | helpers (epic progress) | `lib/epic-progress.mjs` |
| 443-457 | helpers (autonomy read) | `lib/autonomy.mjs` (merged) |
| 461-490 | helpers (links) | `lib/links.mjs` |
| 492-794 | rules | `lib/rules.mjs` |
| 795-923 | the briefing | `lib/briefing.mjs` (cluster) |
| 924-1091 | render PROJECT.md | `lib/render.mjs` (cluster) |
| 1092-1283 | subcommands | `lib/subcommands.mjs` |
| 1284-1500 | add-epic | `lib/add-epic.mjs` (cluster) |
| 1501-1571 | add-many | `lib/add-many.mjs` |
| 1572-1638 | active pointer | `lib/active-pointer.mjs` (cluster) |
| 1639-1772 | update-epic (write-back) | `lib/update-epic.mjs` |
| 1773-1848 | remove-epic | `lib/remove-epic.mjs` |
| 1849-1925 | autonomy | `lib/autonomy.mjs` (merged) |
| 1926-1981 | reconciler structured writeback | `lib/reconciler-writeback.mjs` |
| 1982-2040 | openspec gate-review structured writeback | `lib/gate-review-writeback.mjs` |
| 2041-2117 | tracker | `lib/tracker.mjs` |
| 2118-2201 | lane routing | `lib/lane-routing.mjs` |
| 2202-2224 | review mode | `lib/review-mode.mjs` |
| 2225-2270 | gate guard | `lib/gate-guard.mjs` |
| 2271-2333 | migrations | `lib/migrations.mjs` |
| 2334-2353 | changelog | `lib/changelog.mjs` |
| 2354-2481 | worktree hygiene | `lib/worktree-hygiene.mjs` |
| 2482-2537 | dispatch | stays in `conductor.mjs` |

**Mechanical extraction procedure used by every task below:** for each destination file,
(1) create it with a header comment plus the exact import lines specified, (2) copy the
named functions/consts verbatim from the given line range in the CURRENT `conductor.mjs`
(no edits to their bodies), (3) add an `export` keyword to each top-level function/const
being moved, (4) delete those same lines from `conductor.mjs`, (5) add one `import { ... }
from "./lib/<name>.mjs";` line near the top of `conductor.mjs` in their place, (6) run the
full test suite, (7) commit.

---

### Task 1: `lib/constants.mjs`

**Files:**
- Create: `scripts/lib/constants.mjs`
- Modify: `scripts/conductor.mjs:42-76`
- Test: `scripts/conductor.test.mjs` (unchanged, run as-is)

**Interfaces:**
- Produces: `ROOT, CONDUCTOR_DIR, STATE_PATH, BRIEF_PATH, RENDER_STAMP_PATH, DETOURS_LOG, PROJECT_MD, CLAUDE_MD, CHANGES_DIR, ARCHIVE_DIR, PLANS_DIR, KNOWN_LANES, KNOWN_STATUSES, KNOWN_AUTONOMY_LEVELS, KNOWN_PREAUTHORIZE_CATEGORIES, KNOWN_REVIEW_MODES, REVIEW_MODE_RANK, LANE_RANK, laneRank, RULES_BEGIN, RULES_END` — every later task imports from this file.

- [ ] **Step 1: Create `scripts/lib/constants.mjs`**

```javascript
// scripts/lib/constants.mjs
// Shared path/enum constants for the conductor engine. No dependencies on any other
// lib module — every other module may import from here.

import path from "node:path";

export const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
export const CONDUCTOR_DIR = path.join(ROOT, ".conductor");
export const STATE_PATH = path.join(CONDUCTOR_DIR, "state.json");
export const BRIEF_PATH = path.join(CONDUCTOR_DIR, "brief.txt");
export const RENDER_STAMP_PATH = path.join(CONDUCTOR_DIR, "render-stamp.json");
export const DETOURS_LOG = path.join(CONDUCTOR_DIR, "detours.log");
export const PROJECT_MD = path.join(ROOT, "PROJECT.md");
export const CLAUDE_MD = path.join(ROOT, "CLAUDE.md");
export const CHANGES_DIR = path.join(ROOT, "openspec", "changes");
export const ARCHIVE_DIR = path.join(CHANGES_DIR, "archive");
export const PLANS_DIR = path.join(ROOT, "docs", "superpowers", "plans");
export const KNOWN_LANES = ["openspec", "superpowers", "claude-code", "decision", "external"];
export const KNOWN_STATUSES = ["untriaged", "queued", "active", "paused", "later", "blocked", "planned", "archived"];
export const KNOWN_AUTONOMY_LEVELS = ["off", "autonomous"];
// Default category taxonomy for the `--preauthorize "category:<name>:<reason>"` shorthand —
// see the `conductor` skill's "Epic-level autonomy" section for the matching heuristic each
// category expands to at decision-rule time. Additive-only convention: adding a category here
// is not a breaking change for existing preAuthorized entries.
export const KNOWN_PREAUTHORIZE_CATEGORIES = ["filesystem", "network", "schema", "external-api"];
export const KNOWN_REVIEW_MODES = ["off", "standard", "thorough"];
/** Rank used to compare review modes so an epic-level override can only ESCALATE above the
 *  repo-global dial, never de-escalate below it — see currentReviewMode(epicId). */
export const REVIEW_MODE_RANK = { off: 0, standard: 1, thorough: 2 };
export const LANE_RANK = { openspec: 0, superpowers: 1, "claude-code": 2, decision: 3, external: 4 };
export const laneRank = (l) => (l in LANE_RANK ? LANE_RANK[l] : 9);

export const RULES_BEGIN = "<!-- BEGIN pm-conductor rules (managed by /pm:init — safe to delete this block) -->";
export const RULES_END = "<!-- END pm-conductor rules -->";
```

- [ ] **Step 2: In `scripts/conductor.mjs`, delete lines 48-76** (the block from `const ROOT = ...` through `const RULES_END = ...`), and add this import immediately after the existing `node:url` import (was line 46):

```javascript
import {
  ROOT, CONDUCTOR_DIR, STATE_PATH, BRIEF_PATH, RENDER_STAMP_PATH, DETOURS_LOG,
  PROJECT_MD, CLAUDE_MD, CHANGES_DIR, ARCHIVE_DIR, PLANS_DIR,
  KNOWN_LANES, KNOWN_STATUSES, KNOWN_AUTONOMY_LEVELS, KNOWN_PREAUTHORIZE_CATEGORIES,
  KNOWN_REVIEW_MODES, REVIEW_MODE_RANK, LANE_RANK, laneRank, RULES_BEGIN, RULES_END,
} from "./lib/constants.mjs";
```

- [ ] **Step 3: Run the full test suite**

Run: `node --test scripts/conductor.test.mjs`
Expected: all tests pass (same count as before this task — check the pre-task baseline with `git stash && node --test scripts/conductor.test.mjs; git stash pop` if unsure).

- [ ] **Step 4: Commit**

```bash
git add scripts/lib/constants.mjs scripts/conductor.mjs
git commit -m "refactor(pm): extract lib/constants.mjs from conductor.mjs"
```

---

### Task 2: `lib/links.mjs`

**Files:**
- Create: `scripts/lib/links.mjs`
- Modify: `scripts/conductor.mjs:461-490` (after Task 1's line-48-76 deletion, these line numbers shift up by 29 — locate by the `// ---------- rules ----------` banner and the `validLink`/`normalizeLink`/`detourContext` function names instead of trusting absolute line numbers from here on)

**Interfaces:**
- Produces: `validLink(l)`, `normalizeLink(l)`, `detourContext(state)`

- [ ] **Step 1: Create `scripts/lib/links.mjs`**

```javascript
// scripts/lib/links.mjs
// Epic-link validation/normalization and detour-context detection. Pure functions,
// no dependencies on any other lib module.

/** A link is renderable only when both endpoints are strings. Guards against
 *  malformed/partial entries (incl. older schemas) that would render `undefined`. */
export function validLink(l) {
  return l && typeof l.type === "string" && typeof l.epic === "string";
}

/** Normalize one stored link for the 0.5.0 migration. Repair-first:
 *  a valid {type, epic} object passes through; the documented colon-string
 *  encoding `type:epic[:reason]` (what add-epic's --link parser produces) is
 *  repaired into an object; anything else is unrecoverable → null (dropped). */
export function normalizeLink(l) {
  if (validLink(l)) return l;
  if (typeof l === "string") {
    const [type, epic, ...rest] = l.split(":");
    if (type && epic) {
      const reason = rest.join(":").trim();
      return reason ? { type, epic, reason } : { type, epic };
    }
  }
  return null;
}

/** Is the project currently inside a detour? (active epic is a detour, or stack non-empty) */
export function detourContext(state) {
  if (state.detourStack && state.detourStack.length) {
    const top = state.detourStack[state.detourStack.length - 1];
    return { active: true, detourId: top.spawnedDetour || state.active || "-" };
  }
  const cur = state.epics.find(e => e.id === state.active);
  if (cur && cur.role === "detour") return { active: true, detourId: cur.id };
  return { active: false, detourId: null };
}
```

- [ ] **Step 2: In `scripts/conductor.mjs`, delete the `validLink`/`normalizeLink`/`detourContext` function bodies** (find them via `grep -n "^function validLink\|^function normalizeLink\|^function detourContext" scripts/conductor.mjs` — delete from each `function` line to its closing `}`), and add:

```javascript
import { validLink, normalizeLink, detourContext } from "./lib/links.mjs";
```

- [ ] **Step 3: Run the full test suite**

Run: `node --test scripts/conductor.test.mjs`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add scripts/lib/links.mjs scripts/conductor.mjs
git commit -m "refactor(pm): extract lib/links.mjs from conductor.mjs"
```

---

### Task 3: `lib/epic-progress.mjs`

**Files:**
- Create: `scripts/lib/epic-progress.mjs`
- Modify: `scripts/conductor.mjs` (functions: `activeChangeIds`, `planFiles`, `firstHeading`, `isArchived`, `reconcileArchived`, `countCheckboxes`, `epicProgress`, `resolveEpics`, `missing`, `orderQueueWithDependencies`, `bar` — originally lines 229-441)

**Interfaces:**
- Produces: `activeChangeIds()`, `planFiles()`, `firstHeading(absPath)`, `isArchived(id)`, `reconcileArchived(state)`, `countCheckboxes(absPath)`, `epicProgress(epic)`, `resolveEpics(state)`, `missing(e)`, `orderQueueWithDependencies(sorted)`, `bar(p)`

- [ ] **Step 1: Create `scripts/lib/epic-progress.mjs`**

```javascript
// scripts/lib/epic-progress.mjs
// Epic progress/resolution: merging state.json metadata with what's actually on disk
// (openspec changes, plan files), dependency-aware queue ordering, and archive-drift
// healing. Depends only on lib/constants.mjs.

import fs from "node:fs";
import path from "node:path";
import { ROOT, CHANGES_DIR, ARCHIVE_DIR, PLANS_DIR, laneRank } from "./constants.mjs";

/** Active openspec change ids = subdirs of openspec/changes except `archive`. */
export function activeChangeIds() {
  try {
    return fs.readdirSync(CHANGES_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name !== "archive")
      .map(d => d.name);
  } catch { return []; }
}

export function planFiles() {
  try {
    return fs.readdirSync(PLANS_DIR, { withFileTypes: true })
      .filter(d => d.isFile() && d.name.endsWith(".md"))
      .map(d => d.name);
  } catch { return []; }
}

export function firstHeading(absPath) {
  try {
    for (const line of fs.readFileSync(absPath, "utf8").split("\n")) {
      const m = line.match(/^#\s+(.+)/);
      if (m) return m[1].trim();
    }
  } catch { /* ignore */ }
  return null;
}

/** Archived-change detection. OpenSpec archives a change as `archive/<YYYY-MM-DD>-<id>`,
 *  so an exact-name check misses it. Match the exact id (older/manual) OR a date-prefixed dir. */
export function isArchived(id) {
  if (fs.existsSync(path.join(ARCHIVE_DIR, id))) return true;
  let entries;
  try { entries = fs.readdirSync(ARCHIVE_DIR, { withFileTypes: true }); } catch { return false; }
  const re = new RegExp(`^\\d{4}-\\d{2}-\\d{2}-${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
  return entries.some(d => d.isDirectory() && re.test(d.name));
}

/** Heal drift between the conductor and the on-disk archive: any epic whose change is
 *  archived becomes status `archived`, and an `active` pointer aimed at an archived epic
 *  is cleared. Returns true if it changed anything. Called from the mutating paths
 *  (sync/commit-nudge/init/upgrade) so the agent never has to hand-edit state.json.
 *  Recompute-don't-remember: re-derive active validity and reconcile obligation from
 *  disk/state on every call, rather than trusting stored flags that can go stale (a
 *  hand-edit, a lost compaction, a forgotten clear on resume). Called by write paths
 *  (render, sync, commit-nudge, upgrade) — NOT by brief(), which stays read-only and
 *  displays the same recomputed truth in-memory via resolveEpics() without persisting. */
export function reconcileArchived(state) {
  let changed = false;
  for (const e of state.epics) {
    if (e.status !== "archived" && isArchived(e.id)) { e.status = "archived"; changed = true; }
  }
  if (state.active) {
    const a = state.epics.find(e => e.id === state.active);
    // Missing entirely (!a), archived, or archived on disk — any of these means the
    // pointer no longer refers to a real, in-flight epic.
    if (!a || a.status === "archived" || isArchived(state.active)) { state.active = null; changed = true; }
  }
  // reconcileNeeded is a genuine state-TRANSITION flag, not a pure function of current
  // state: POP protocol removes the detour-stack frame BEFORE reconciliation runs (per
  // the conductor skill), so "is there still a live frame for this epic" is false during
  // the exact window (just-resumed, reconcile not yet done) the flag needs to stay true.
  // Recompute only the cases that ARE safely derivable from current state:
  const pendingReconcile = new Set(
    (state.detourStack || []).filter(f => f.reconcileOnResume).map(f => f.pausedEpic)
  );
  for (const e of state.epics) {
    if (e.status === "archived") {
      // Done/abandoned — reconcile is moot regardless of how it got set.
      if (e.reconcileNeeded) { e.reconcileNeeded = false; changed = true; }
    } else if (pendingReconcile.has(e.id)) {
      // Still paused with a live frame demanding reconcile — ensure it's flagged.
      if (!e.reconcileNeeded) { e.reconcileNeeded = true; changed = true; }
    } else if (e.reconcileNeeded && e.id !== state.active) {
      // Not archived, no live frame, AND not the current active epic: this can only be
      // orphaned/forgotten state (a hand-edit, or leftover from an aborted flow) — the
      // legitimate post-pop-pre-reconcile window is exactly `e.id === state.active`,
      // which this branch deliberately never touches.
      e.reconcileNeeded = false; changed = true;
    }
  }
  return changed;
}

/** Count [ ] / [x] checkboxes in a markdown file. */
export function countCheckboxes(absPath) {
  let total = 0, done = 0, exists = false;
  try {
    const txt = fs.readFileSync(absPath, "utf8");
    exists = true;
    for (const line of txt.split("\n")) {
      const m = line.match(/^\s*[-*]\s+\[([ xX])\]/);
      if (m) { total++; if (m[1].toLowerCase() === "x") done++; }
    }
  } catch { /* missing file */ }
  return { done, total, exists };
}

/** Resolve an epic's progress by precedence: stories -> planPath -> openspec tasks.md -> none. */
export function epicProgress(epic) {
  if (Array.isArray(epic.stories)) {
    const total = epic.stories.length;
    const done = epic.stories.filter(s => s && s.done).length;
    return { done, total, source: "stories", warn: null };
  }
  if (epic.planPath) {
    const c = countCheckboxes(path.join(ROOT, epic.planPath));
    if (!c.exists) return { done: 0, total: 0, source: "plan", warn: "planPath missing" };
    return { done: c.done, total: c.total, source: "plan", warn: null };
  }
  if ((epic.lane || "openspec") === "openspec") {
    const c = countCheckboxes(path.join(CHANGES_DIR, epic.id, "tasks.md"));
    return { done: c.done, total: c.total, source: "openspec", warn: null };
  }
  return { done: 0, total: 0, source: "none", warn: null };
}

/** Merge state metadata with what's actually on disk. */
export function resolveEpics(state) {
  const onDisk = new Set(activeChangeIds());
  const known = new Map(state.epics.map(e => [e.id, e]));
  const out = [];

  for (const id of onDisk) {
    const meta = known.get(id) || {
      id, title: id, priority: "P?", status: "untriaged", role: "epic",
      links: [], reconcileNeeded: false,
    };
    const lane = meta.lane || "openspec";
    out.push({ ...meta, lane, progress: epicProgress({ ...meta, lane }), present: true });
  }
  for (const e of state.epics) {
    if (!onDisk.has(e.id)) {
      const lane = e.lane || "openspec";
      out.push({ ...e, lane, progress: epicProgress({ ...e, lane }),
        status: isArchived(e.id) ? "archived" : e.status, present: false });
    }
  }
  const rank = { P0: 0, P1: 1, P2: 2, P3: 3, "P?": 9 };
  out.sort((a, b) =>
    ((rank[a.priority] ?? 9) - (rank[b.priority] ?? 9)) ||
    (laneRank(a.lane) - laneRank(b.lane)) ||
    a.id.localeCompare(b.id));
  return out;
}

/** An openspec epic with no change on disk and not archived = genuinely missing its change.
 *  Archived is checked both ways: via disk (isArchived) for epics whose status hasn't been
 *  healed yet, and via e.status directly — an already-closed epic (status archived) has its
 *  openspec/changes/<id> directory legitimately removed by the archive process, so there is
 *  no change on disk BY DESIGN and it must never show the warning, regardless of whether the
 *  on-disk archive-dir naming convention still matches. */
export function missing(e) {
  return e.lane === "openspec" && !e.present && !isArchived(e.id) &&
    e.status !== "planned" && e.status !== "archived";
}

/** Extends plan-hierarchy's depends-on topological sort from ONE parent's children to ALL
 *  top-level queued/untriaged epics generally — the same starvation problem exists there: a
 *  higher-priority epic with an unresolved `depends-on` link to another still-queued epic would
 *  otherwise be listed (and picked by /pm:next) ahead of the very dependency it's waiting on.
 *  `sorted` is a priority-then-lane-then-id-ordered list (resolveEpics()'s existing sort,
 *  already filtered to queued/untriaged + not-missing). Returns `{ ordered, notes }`. */
export function orderQueueWithDependencies(sorted) {
  const ids = new Set(sorted.map(e => e.id));
  const deps = new Map(sorted.map(e => [e.id, new Set(
    (e.links || []).filter(l => l && l.type === "depends-on" && ids.has(l.epic)).map(l => l.epic))]));

  const indexOf = new Map(sorted.map((e, i) => [e.id, i]));
  const notes = [];
  for (const e of sorted) {
    for (const d of deps.get(e.id)) {
      if (indexOf.get(e.id) < indexOf.get(d)) {
        notes.push(`epic \`${e.id}\` ready but waiting on \`${d}\``);
      }
    }
  }

  const placed = new Set();
  const ordered = [];
  let remaining = sorted;
  while (remaining.length) {
    const ready = remaining.filter(e => [...deps.get(e.id)].every(d => placed.has(d)));
    if (!ready.length) {
      ordered.push(...remaining);
      break;
    }
    for (const e of ready) { ordered.push(e); placed.add(e.id); }
    remaining = remaining.filter(e => !placed.has(e.id));
  }
  return { ordered, notes };
}

export function bar(p) {
  if (!p) return "—";
  if (p.warn) return `⚠ ${p.warn}`;
  if (p.total > 0) return `${p.done}/${p.total} ${p.source === "plan" ? "tasks" : "stories"}`;
  return "—";
}
```

- [ ] **Step 2: In `scripts/conductor.mjs`, delete the 11 function bodies listed above**, and add:

```javascript
import {
  activeChangeIds, planFiles, firstHeading, isArchived, reconcileArchived,
  countCheckboxes, epicProgress, resolveEpics, missing, orderQueueWithDependencies, bar,
} from "./lib/epic-progress.mjs";
```

- [ ] **Step 3: Run the full test suite**

Run: `node --test scripts/conductor.test.mjs`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add scripts/lib/epic-progress.mjs scripts/conductor.mjs
git commit -m "refactor(pm): extract lib/epic-progress.mjs from conductor.mjs"
```

---

### Task 4: `lib/state.mjs`

**Files:**
- Create: `scripts/lib/state.mjs`
- Modify: `scripts/conductor.mjs` (functions: `readJSON`, `readStdin`, `isInitialized`, `defaultState`, `loadState`, `saveState`)

**Interfaces:**
- Consumes: `STATE_PATH`, `CONDUCTOR_DIR` from `lib/constants.mjs`
- Produces: `readJSON(p, fallback)`, `readStdin()`, `isInitialized()`, `defaultState()`, `loadState()`, `saveState(state)`

- [ ] **Step 1: Create `scripts/lib/state.mjs`**

```javascript
// scripts/lib/state.mjs
// state.json load/save — the conductor's single source of record. Depends only on
// lib/constants.mjs.

import fs from "node:fs";
import { STATE_PATH, CONDUCTOR_DIR } from "./constants.mjs";

export function readJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return fallback; }
}

export function readStdin() {
  try { return fs.readFileSync(0, "utf8"); } catch { return ""; }
}

export function isInitialized() {
  return fs.existsSync(STATE_PATH);
}

export function defaultState() {
  return { version: 1, active: null, epics: [], detourStack: [] };
}

export function loadState() {
  const s = readJSON(STATE_PATH, null);
  return s && typeof s === "object" ? { ...defaultState(), ...s } : defaultState();
}

/** Atomic write: write to a tmp file in the same directory, then rename(2) over the
 *  real path. rename is atomic on the same filesystem — a crash mid-write leaves a
 *  truncated .tmp-* file, never a truncated state.json. */
export function saveState(state) {
  fs.mkdirSync(CONDUCTOR_DIR, { recursive: true });
  const data = JSON.stringify(state, null, 2) + "\n";
  const tmpPath = `${STATE_PATH}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, data);
  fs.renameSync(tmpPath, STATE_PATH);
}
```

- [ ] **Step 2: In `scripts/conductor.mjs`, delete the 6 function bodies listed above**, and add:

```javascript
import { readJSON, readStdin, isInitialized, defaultState, loadState, saveState } from "./lib/state.mjs";
```

- [ ] **Step 3: Run the full test suite**

Run: `node --test scripts/conductor.test.mjs`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add scripts/lib/state.mjs scripts/conductor.mjs
git commit -m "refactor(pm): extract lib/state.mjs from conductor.mjs"
```

---

### Task 5: `lib/git.mjs`

**Files:**
- Create: `scripts/lib/git.mjs`
- Modify: `scripts/conductor.mjs` (functions: `gitShortSha`, `appendDetourLog`)

**Interfaces:**
- Consumes: `ROOT`, `CONDUCTOR_DIR`, `DETOURS_LOG` from `lib/constants.mjs`
- Produces: `gitShortSha()`, `appendDetourLog(kind, epic, note)`

- [ ] **Step 1: Create `scripts/lib/git.mjs`**

```javascript
// scripts/lib/git.mjs
// git plumbing (current SHA) and the append-only detour log. Depends only on
// lib/constants.mjs.

import fs from "node:fs";
import { execSync } from "node:child_process";
import { ROOT, CONDUCTOR_DIR, DETOURS_LOG } from "./constants.mjs";

export function gitShortSha() {
  try { return execSync("git rev-parse --short HEAD", { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); }
  catch { return "-"; }
}

export function appendDetourLog(kind, epic, note) {
  fs.mkdirSync(CONDUCTOR_DIR, { recursive: true });
  const line = [new Date().toISOString(), gitShortSha(), kind, epic || "-", (note || "").replace(/\s+/g, " ").trim()].join("\t");
  fs.appendFileSync(DETOURS_LOG, line + "\n");
}
```

- [ ] **Step 2: In `scripts/conductor.mjs`, delete the 2 function bodies listed above**, and add:

```javascript
import { gitShortSha, appendDetourLog } from "./lib/git.mjs";
```

- [ ] **Step 3: Run the full test suite**

Run: `node --test scripts/conductor.test.mjs`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add scripts/lib/git.mjs scripts/conductor.mjs
git commit -m "refactor(pm): extract lib/git.mjs from conductor.mjs"
```

---

### Task 6: `lib/plugin-meta.mjs` — includes a critical path-depth fix

**Files:**
- Create: `scripts/lib/plugin-meta.mjs`
- Modify: `scripts/conductor.mjs` (functions: `pluginRoot`, `pluginVersion`, `changelogSections`, `changelogBetween`, `changelogAddedHeadlines`, `newestInstalledVersion`, `cmpVer`, `stampVersion`)

**Interfaces:**
- Consumes: `readJSON` from `lib/state.mjs`
- Produces: `pluginRoot()`, `pluginVersion()`, `changelogSections()`, `changelogBetween(fromVer, toVer)`, `changelogAddedHeadlines(fromVer, toVer, limit)`, `newestInstalledVersion()`, `cmpVer(a, b)`, `stampVersion(state)`

**⚠ Critical gotcha:** `pluginRoot()` originally computed the plugin's root directory as
`path.dirname(fileURLToPath(import.meta.url))` **one level up**, because it lived directly
in `scripts/conductor.mjs` (`scripts/` → plugin root is one `..` up). Moved into
`scripts/lib/plugin-meta.mjs`, `import.meta.url` now resolves to a file one directory
**deeper** (`scripts/lib/`), so the path must go up **two** levels instead of one. Getting
this wrong would silently break `/pm:upgrade`, the engine-version banner, and the
changelog delta — none of which would necessarily fail loudly (they'd just report `null`
or stale data). This is why Step 1 below has `"..", ".."` instead of the original single
`".."`.

- [ ] **Step 1: Create `scripts/lib/plugin-meta.mjs`**

```javascript
// scripts/lib/plugin-meta.mjs
// The running plugin's own version/changelog, and comparing it against what's
// installed. Depends on lib/state.mjs (readJSON).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJSON } from "./state.mjs";

/** The running plugin's root dir. Env-first so tests can point at a fixture.
 *  NOTE: this file lives at scripts/lib/plugin-meta.mjs, one directory deeper than the
 *  original scripts/conductor.mjs — hence ".." TWICE (lib/ -> scripts/ -> plugin root),
 *  not once. */
export function pluginRoot() {
  return process.env.CLAUDE_PLUGIN_ROOT
    ? process.env.CLAUDE_PLUGIN_ROOT
    : path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

/** The running plugin's release. Env-first so tests can point at a fixture plugin.json. */
export function pluginVersion() {
  const pj = readJSON(path.join(pluginRoot(), ".claude-plugin", "plugin.json"), null);
  return pj && pj.version ? String(pj.version) : null;
}

/** Parse the plugin's own CHANGELOG.md into [{version, body}] sections (file order,
 *  newest-first). Returns null if no CHANGELOG ships with this version. Zero-dep:
 *  sections are delimited by `## [x.y.z]` headers. */
export function changelogSections() {
  let txt;
  try { txt = fs.readFileSync(path.join(pluginRoot(), "CHANGELOG.md"), "utf8"); }
  catch { return null; }
  const sections = [];
  let cur = null;
  for (const line of txt.split("\n")) {
    const m = line.match(/^##\s+\[(\d+\.\d+\.\d+)\]/);
    if (m) { cur = { version: m[1], lines: [line] }; sections.push(cur); }
    else if (cur) cur.lines.push(line);
  }
  return sections.map(s => ({
    version: s.version,
    body: s.lines.join("\n").replace(/\n*-{3,}\s*$/, "").trimEnd(),
  }));
}

/** CHANGELOG sections with version in (fromVer, toVer]. `fromVer`/`toVer` may be null
 *  (open bound). Returns null only when no CHANGELOG exists. */
export function changelogBetween(fromVer, toVer) {
  const secs = changelogSections();
  if (secs === null) return null;
  return secs.filter(s =>
    (fromVer == null || cmpVer(s.version, fromVer) > 0) &&
    (toVer == null || cmpVer(s.version, toVer) <= 0));
}

/** Top "Added" bullet headlines (first line of each bullet only, no continuation lines)
 *  across CHANGELOG sections with version in (fromVer, toVer], newest-first, capped at
 *  `limit`. Returns [] if no CHANGELOG ships or no Added bullets fall in range — never
 *  null, so callers can splice it in unconditionally. */
export function changelogAddedHeadlines(fromVer, toVer, limit = 3) {
  const secs = changelogBetween(fromVer, toVer);
  if (!secs) return [];
  const out = [];
  for (const s of secs) {
    if (out.length >= limit) break;
    let inAdded = false;
    for (const line of s.body.split("\n")) {
      if (/^###\s+Added\b/.test(line)) { inAdded = true; continue; }
      if (/^###\s+/.test(line)) { inAdded = false; continue; }
      if (inAdded && /^-\s+/.test(line)) {
        out.push(line.replace(/^-\s+/, "").trim());
        if (out.length >= limit) break;
      }
    }
  }
  return out;
}

/** Highest pm version present in the plugin cache, or null if it can't be determined.
 *  Cache root is env-overridable for testability. Per-entry resilient: one bad
 *  plugin.json doesn't collapse the scan. */
export function newestInstalledVersion() {
  const cacheRoot = process.env.PM_CACHE_ROOT || path.join(os.homedir(), ".claude", "plugins", "cache");
  let best = null;
  try {
    for (const mp of fs.readdirSync(cacheRoot, { withFileTypes: true })) {
      if (!mp.isDirectory()) continue;
      const pmDir = path.join(cacheRoot, mp.name, "pm");
      let versions;
      try { versions = fs.readdirSync(pmDir, { withFileTypes: true }); } catch { continue; }
      for (const v of versions) {
        if (!v.isDirectory()) continue;
        const pj = readJSON(path.join(pmDir, v.name, ".claude-plugin", "plugin.json"), null);
        const ver = pj && pj.version ? String(pj.version) : null;
        if (ver && (best === null || cmpVer(ver, best) > 0)) best = ver;
      }
    }
  } catch { /* cache root absent/unreadable → null */ }
  return best;
}

/** Numeric semver compare: <0 if a<b, 0 if equal, >0 if a>b. */
export function cmpVer(a, b) {
  const pa = String(a).split(".").map(n => parseInt(n, 10) || 0);
  const pb = String(b).split(".").map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

export function stampVersion(state) {
  const v = pluginVersion();
  if (v) state.pmVersion = v;
}
```

- [ ] **Step 2: In `scripts/conductor.mjs`, delete the 8 function bodies listed above**, and add:

```javascript
import {
  pluginRoot, pluginVersion, changelogSections, changelogBetween,
  changelogAddedHeadlines, newestInstalledVersion, cmpVer, stampVersion,
} from "./lib/plugin-meta.mjs";
```

- [ ] **Step 3: Run the full test suite, with specific attention to version/changelog tests**

Run: `node --test scripts/conductor.test.mjs`
Expected: all tests pass, INCLUDING any test that exercises `/pm:upgrade`, the engine
version banner, or `changelog`/`changesets` output — these are exactly the tests that
would catch the path-depth gotcha above if it were done wrong.

- [ ] **Step 4: Commit**

```bash
git add scripts/lib/plugin-meta.mjs scripts/conductor.mjs
git commit -m "refactor(pm): extract lib/plugin-meta.mjs from conductor.mjs

Includes the required path-depth fix in pluginRoot() -- this file now
lives one directory deeper than the original conductor.mjs, so
computing the plugin root needs two '..' segments instead of one."
```

---

### Task 7: `lib/rules.mjs`

**Files:**
- Create: `scripts/lib/rules.mjs`
- Modify: `scripts/conductor.mjs` (functions: `currentTracker`, `currentSecondaryTrackers`, `secondaryTrackerKey`, `upsertSecondaryTracker`, `removeSecondaryTracker`, `globalReviewMode`, `currentReviewMode`, `rulesBlock`, `writeRules` — originally lines 495-794)

**Interfaces:**
- Consumes: `loadState` from `lib/state.mjs`; `KNOWN_REVIEW_MODES`, `REVIEW_MODE_RANK`, `RULES_BEGIN`, `RULES_END`, `CLAUDE_MD` from `lib/constants.mjs`
- Produces: `currentTracker()`, `currentSecondaryTrackers()`, `secondaryTrackerKey(entry)`, `upsertSecondaryTracker(state, entry)`, `removeSecondaryTracker(state, entry)`, `globalReviewMode(state)`, `currentReviewMode(epicId)`, `rulesBlock(tracker, reviewMode, secondaryTrackers)`, `writeRules()`

**Note:** no circular dependency here despite first appearances — `tracker.mjs`,
`lane-routing.mjs`, `review-mode.mjs`, `migrations.mjs`, and `subcommands.mjs` all call
`writeRules()` one-directionally; nothing in this file calls back into any of them (see
the design doc's corrected "Circular imports" section).

- [ ] **Step 1: Get the exact current body of `rulesBlock()`** (it's ~200 lines and is not
reproduced in this plan to keep the plan a reasonable size — it is copied VERBATIM, not
rewritten). Run:

```bash
sed -n '/^function rulesBlock/,/^function writeRules/p' scripts/conductor.mjs | head -n -1 > /tmp/rulesBlock.txt
cat /tmp/rulesBlock.txt | head -5   # sanity check: should start with "function rulesBlock(tracker, reviewMode, secondaryTrackers = []) {"
```

- [ ] **Step 2: Create `scripts/lib/rules.mjs`** with this exact structure — the header/imports and the first/last few functions shown verbatim; `rulesBlock`'s body is the content captured into `/tmp/rulesBlock.txt` in Step 1, pasted in whole (add `export` before `function rulesBlock`):

```javascript
// scripts/lib/rules.mjs
// The CLAUDE.md managed rules block: tracker/review-mode-aware instruction text, and
// the idempotent writer that keeps it in sync. Depends on lib/state.mjs and
// lib/constants.mjs only — see the design doc for why this is NOT circular with
// lib/tracker.mjs / lib/review-mode.mjs despite first appearances.

import fs from "node:fs";
import { loadState } from "./state.mjs";
import { KNOWN_REVIEW_MODES, REVIEW_MODE_RANK, RULES_BEGIN, RULES_END, CLAUDE_MD } from "./constants.mjs";

/** The tracker block from state, or null — used to make emitted instructions tracker-aware. */
export function currentTracker() {
  try { const t = loadState().tracker; return t && t.system ? t : null; } catch { return null; }
}

/** state.secondaryTrackers, or [] — absent/undefined on any pre-existing state.json is a valid
 *  "zero secondary trackers configured" state, not an error. */
export function currentSecondaryTrackers() {
  try {
    const st = loadState().secondaryTrackers;
    return Array.isArray(st) ? st : [];
  } catch { return []; }
}

/** Namespace-prefixed upsert key for a secondary tracker entry — `system:repo:<repo>` or
 *  `system:project:<projectKey>`. */
export function secondaryTrackerKey(entry) {
  if (entry.repo) return `${entry.system}:repo:${entry.repo}`;
  return `${entry.system}:project:${entry.projectKey}`;
}

/** Upsert `entry` into `state.secondaryTrackers` by secondaryTrackerKey(), merging onto an
 *  existing match (only the passed-in fields change) rather than appending a duplicate. Mutates
 *  and returns `state`. */
export function upsertSecondaryTracker(state, entry) {
  if (!Array.isArray(state.secondaryTrackers)) state.secondaryTrackers = [];
  const key = secondaryTrackerKey(entry);
  const existing = state.secondaryTrackers.find(e => secondaryTrackerKey(e) === key);
  if (existing) {
    Object.assign(existing, entry);
  } else {
    state.secondaryTrackers.push(entry);
  }
  return state;
}

/** Remove the secondary tracker matching `entry`'s key. Returns true if something was removed. */
export function removeSecondaryTracker(state, entry) {
  if (!Array.isArray(state.secondaryTrackers)) return false;
  const key = secondaryTrackerKey(entry);
  const before = state.secondaryTrackers.length;
  state.secondaryTrackers = state.secondaryTrackers.filter(e => secondaryTrackerKey(e) !== key);
  return state.secondaryTrackers.length < before;
}

/** The repo-global review-mode dial, defaulting to "standard" when unset or invalid. */
export function globalReviewMode(state) {
  const m = state && state.reviewMode;
  return KNOWN_REVIEW_MODES.includes(m) ? m : "standard";
}

/** The active review-mode dial. With no `epicId`, this is just the repo-global dial. With an
 *  `epicId`, returns the EFFECTIVE mode for that epic: the higher-ranked of the repo-global
 *  dial and the epic's own `reviewMode` override (if any). */
export function currentReviewMode(epicId) {
  try {
    const state = loadState();
    const global = globalReviewMode(state);
    if (!epicId) return global;
    const epic = state.epics.find(e => e.id === epicId);
    const override = epic && KNOWN_REVIEW_MODES.includes(epic.reviewMode) ? epic.reviewMode : null;
    if (!override) return global;
    return REVIEW_MODE_RANK[override] > REVIEW_MODE_RANK[global] ? override : global;
  } catch { return "standard"; }
}

// PASTE THE VERBATIM CONTENT OF /tmp/rulesBlock.txt HERE, with `export ` prepended
// to `function rulesBlock(tracker, reviewMode, secondaryTrackers = []) {`.
// (Not reproduced in this plan document — copy exactly, do not retype from memory.)

export function writeRules() {
  const block = rulesBlock(currentTracker(), currentReviewMode(), currentSecondaryTrackers());
  let existing = "";
  try { existing = fs.readFileSync(CLAUDE_MD, "utf8"); } catch { /* file doesn't exist yet */ }
  const has = existing.includes(RULES_BEGIN) && existing.includes(RULES_END);
  if (has) {
    const start = existing.indexOf(RULES_BEGIN);
    const end = existing.indexOf(RULES_END) + RULES_END.length;
    const next = existing.slice(0, start) + block + existing.slice(end);
    if (next !== existing) {
      fs.writeFileSync(CLAUDE_MD, next);
      process.stderr.write("conductor: refreshed rules block in CLAUDE.md\n");
    }
  } else {
    const sep = existing && !existing.endsWith("\n\n") ? (existing.endsWith("\n") ? "\n" : "\n\n") : "";
    fs.writeFileSync(CLAUDE_MD, existing + sep + block);
    process.stderr.write("conductor: created CLAUDE.md with rules block\n");
  }
}
```

**Verification note:** the `writeRules()` body above is reconstructed from this codebase's
documented behavior (idempotent insert/refresh of a delimited block) — before pasting,
diff it against the actual current body at `sed -n '/^function writeRules/,/^}/p'
scripts/conductor.mjs` and use the ACTUAL current text if it differs in any way from what's
shown here. Do not trust this plan's reproduction over the real source file.

- [ ] **Step 3: In `scripts/conductor.mjs`, delete the 9 function bodies for this section**, and add:

```javascript
import {
  currentTracker, currentSecondaryTrackers, secondaryTrackerKey, upsertSecondaryTracker,
  removeSecondaryTracker, globalReviewMode, currentReviewMode, rulesBlock, writeRules,
} from "./lib/rules.mjs";
```

- [ ] **Step 4: Run the full test suite**

Run: `node --test scripts/conductor.test.mjs`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/rules.mjs scripts/conductor.mjs
git commit -m "refactor(pm): extract lib/rules.mjs from conductor.mjs"
```

---

### Task 8: The render cluster — `lib/render.mjs`, `lib/briefing.mjs`, `lib/active-pointer.mjs`, `lib/autonomy.mjs`, `lib/add-epic.mjs`

**This is the one task that must extract five files together**, verified by exact
call-graph analysis: `render()` calls `getAutonomy()` (autonomy), `parseFlags()`
(add-epic), and `staleMarker()` (active-pointer); all three call `render()` back after
mutating state; `buildBrief()` also calls `staleMarker()`. Extracting any one of these
alone would leave an import pointing at a file that doesn't exist yet.

**Files:**
- Create: `scripts/lib/render.mjs`, `scripts/lib/briefing.mjs`, `scripts/lib/active-pointer.mjs`, `scripts/lib/autonomy.mjs`, `scripts/lib/add-epic.mjs`
- Modify: `scripts/conductor.mjs` (sections: the briefing, render PROJECT.md, add-epic, active pointer, autonomy — originally lines 443-457, 795-1091, 1284-1500, 1572-1638, 1849-1925)

**Interfaces:**
- `lib/active-pointer.mjs` produces: `activate(state, id)`, `daysActive(epic)`, `staleMarker(epic)`, `setActive()`, `clearActive()`. Consumes: `isArchived` (epic-progress), `isInitialized`/`loadState`/`saveState` (state), `render` (render.mjs — circular).
- `lib/autonomy.mjs` produces: `getAutonomy(epic)`, `setAutonomy()`. Consumes: `isInitialized`/`loadState`/`saveState` (state), `parseFlags` (add-epic.mjs — circular), `render` (render.mjs — circular), `KNOWN_AUTONOMY_LEVELS`/`KNOWN_PREAUTHORIZE_CATEGORIES` (constants).
- `lib/add-epic.mjs` produces: `parseFlags(argv)`, `parseLinkFlags(raw, knownEpicIds)`, `findCyclePath(stuckIds, deps)`, `planHierarchy()`, `parentError(epics, id, parent)`, `addEpic()`. Consumes: `activate` (active-pointer.mjs), `isInitialized`/`loadState`/`saveState` (state), `render` (render.mjs — circular), `KNOWN_LANES`/`KNOWN_STATUSES` (constants).
- `lib/briefing.mjs` produces: `buildBrief(state)`. Consumes: `resolveEpics`/`missing`/`orderQueueWithDependencies`/`bar` (epic-progress), `changelogAddedHeadlines`/`cmpVer`/`newestInstalledVersion`/`pluginVersion` (plugin-meta), `getAutonomy` (autonomy.mjs), `staleMarker` (active-pointer.mjs), `validLink` (links), `KNOWN_LANES` (constants).
- `lib/render.mjs` produces: `render()`, `normalizeForDiffSummary(content)`, `writeRenderStamp()`. Consumes: `loadState`/`saveState` (state), `reconcileArchived`/`resolveEpics`/`bar`/`missing` (epic-progress), `buildBrief` (briefing.mjs), `staleMarker` (active-pointer.mjs — circular), `getAutonomy` (autonomy.mjs — circular), `parseFlags` (add-epic.mjs — circular), `validLink` (links), `readJSON` (state), `DETOURS_LOG`/`PROJECT_MD`/`STATE_PATH`/`RENDER_STAMP_PATH`/`CONDUCTOR_DIR` (constants).

- [ ] **Step 1: Create `scripts/lib/active-pointer.mjs`**

```javascript
// scripts/lib/active-pointer.mjs
// The single-active-epic invariant, staleness detection, and the set-active/clear-active
// CLI verbs. Circular with lib/render.mjs (setActive/clearActive call render(); render()
// calls staleMarker()) -- see the design doc.

import { isArchived } from "./epic-progress.mjs";
import { isInitialized, loadState, saveState } from "./state.mjs";
import { render } from "./render.mjs";

/** Enforce the single-active invariant: `id` becomes the one active epic AND the
 *  top-level `.active` pointer. Any OTHER epic left at status "active" is demoted to
 *  "queued", so `.active` and `status: "active"` can never silently disagree. */
export function activate(state, id) {
  for (const e of state.epics) if (e.status === "active" && e.id !== id) e.status = "queued";
  const t = state.epics.find(e => e.id === id);
  if (t) {
    t.status = "active";
    // Stamp startedAt only once — re-activating (e.g. resuming after a demotion)
    // must not reset the clock used for staleness/velocity tracking.
    if (!t.startedAt) t.startedAt = new Date().toISOString();
  }
  state.active = id;
}

const STALE_DAYS = 14;

/** Days elapsed since `startedAt`, or null if the epic has no startedAt (never activated)
 *  or is already completed (completedAt set) — a finished epic is never "stale". */
export function daysActive(epic) {
  if (!epic.startedAt || epic.completedAt) return null;
  const started = Date.parse(epic.startedAt);
  if (Number.isNaN(started)) return null;
  return Math.floor((Date.now() - started) / (24 * 60 * 60 * 1000));
}

/** `⚠ stale, Nd active` marker for an epic that's been active more than STALE_DAYS with
 *  no completedAt — surfaced in both PROJECT.md's table and the brief's NOW/NEXT UP lines. */
export function staleMarker(epic) {
  const d = daysActive(epic);
  return d !== null && d > STALE_DAYS ? ` ⚠ stale, ${d}d active` : "";
}

/** `set-active <id>` — the CLI verb for the top-level active pointer (positional id). */
export function setActive() {
  if (!isInitialized()) { process.stderr.write("conductor: run /pm:init first\n"); process.exit(1); }
  const argv = process.argv.slice(3);
  const id = argv[0] && !argv[0].startsWith("--") ? argv[0] : undefined;
  if (!id) { process.stderr.write("usage: conductor.mjs set-active <id>\n"); process.exit(1); }
  const state = loadState();
  const t = state.epics.find(e => e.id === id);
  if (!t) { process.stderr.write(`conductor: epic '${id}' not found\n`); process.exit(1); }
  if (t.status === "archived" || isArchived(id)) {
    process.stderr.write(`conductor: epic '${id}' is archived — cannot make it active\n`); process.exit(1);
  }
  activate(state, id);
  saveState(state);
  render();
  process.stderr.write(`conductor: active is now '${id}'\n`);
}

/** `clear-active` — drop the active pointer and demote the epic it pointed at. */
export function clearActive() {
  if (!isInitialized()) { process.stderr.write("conductor: run /pm:init first\n"); process.exit(1); }
  const state = loadState();
  if (state.active) {
    const a = state.epics.find(e => e.id === state.active);
    if (a && a.status === "active") a.status = "queued";
  }
  state.active = null;
  saveState(state);
  render();
  process.stderr.write("conductor: active cleared\n");
}
```

- [ ] **Step 2: Create `scripts/lib/autonomy.mjs`**

```javascript
// scripts/lib/autonomy.mjs
// Per-epic autonomy read (getAutonomy) and the set-autonomy CLI verb. Circular with
// lib/render.mjs (setAutonomy calls render(); render() calls getAutonomy()) and needs
// lib/add-epic.mjs's parseFlags() -- see the design doc.

import { isInitialized, loadState, saveState } from "./state.mjs";
import { parseFlags } from "./add-epic.mjs";
import { render } from "./render.mjs";
import { KNOWN_AUTONOMY_LEVELS, KNOWN_PREAUTHORIZE_CATEGORIES } from "./constants.mjs";

// `autonomy` is optional per epic — absent means "off", today's behavior, unchanged.
// getAutonomy() is the ONLY place that should read epic.autonomy directly; everywhere
// else (render, brief, set-autonomy) calls this so a missing field never needs a
// migration to backfill — it defaults cleanly at read-time.
const DEFAULT_AUTONOMY = Object.freeze({ level: "off", preAuthorized: [], context: [], notifications: [] });
export function getAutonomy(epic) {
  const a = epic.autonomy;
  if (!a) return DEFAULT_AUTONOMY;
  return {
    level: a.level || "off",
    preAuthorized: Array.isArray(a.preAuthorized) ? a.preAuthorized : [],
    context: Array.isArray(a.context) ? a.context : [],
    notifications: Array.isArray(a.notifications) ? a.notifications : [],
  };
}

export function setAutonomy() {
  if (!isInitialized()) { process.stderr.write("conductor: run /pm:init first\n"); process.exit(1); }
  const argv = process.argv.slice(3);
  const id = argv[0] && !argv[0].startsWith("--") ? argv[0] : undefined;
  if (!id) {
    process.stderr.write(
      "usage: conductor.mjs set-autonomy <id> [--level off|autonomous] " +
      "[--preauthorize \"<action>:<reason>\"] [--preauthorize \"category:<filesystem|network|schema|external-api>:<reason>\"] " +
      "[--context \"<note>\"] [--notify \"<what>\"]\n");
    process.exit(1);
  }
  const f = parseFlags(argv.slice(1));
  const state = loadState();
  const epic = state.epics.find(e => e.id === id);
  if (!epic) { process.stderr.write(`conductor: epic '${id}' not found\n`); process.exit(1); }

  const level = typeof f.level === "string" ? f.level : undefined;
  if (level !== undefined && !KNOWN_AUTONOMY_LEVELS.includes(level)) {
    process.stderr.write(`conductor: --level must be one of ${KNOWN_AUTONOMY_LEVELS.join("|")}\n`);
    process.exit(1);
  }

  const a = { ...getAutonomy(epic) };
  if (level !== undefined) a.level = level;

  for (const s of (f.preauthorize || [])) {
    if (typeof s !== "string") continue;
    if (s.startsWith("category:")) {
      const rest = s.slice("category:".length);
      const i = rest.indexOf(":");
      const category = (i === -1 ? rest : rest.slice(0, i)).trim();
      const reason = i === -1 ? undefined : rest.slice(i + 1).trim();
      if (!KNOWN_PREAUTHORIZE_CATEGORIES.includes(category)) {
        process.stderr.write(
          `conductor: --preauthorize category must be one of ${KNOWN_PREAUTHORIZE_CATEGORIES.join("|")}\n`);
        process.exit(1);
      }
      const entry = { category, grantedAt: new Date().toISOString() };
      if (reason) entry.reason = reason;
      a.preAuthorized = [...a.preAuthorized, entry];
      continue;
    }
    const i = s.indexOf(":");
    const action = i === -1 ? s.trim() : s.slice(0, i).trim();
    const reason = i === -1 ? undefined : s.slice(i + 1).trim();
    const entry = { action, grantedAt: new Date().toISOString() };
    if (reason) entry.reason = reason;
    a.preAuthorized = [...a.preAuthorized, entry];
  }
  for (const c of (f.context || [])) {
    if (typeof c === "string") a.context = [...a.context, c];
  }
  for (const n of (f.notify || [])) {
    if (typeof n === "string") a.notifications = [...a.notifications, { what: n, when: new Date().toISOString() }];
  }

  epic.autonomy = a;
  saveState(state);
  render();
  process.stderr.write(`conductor: autonomy for '${id}' is now level=${a.level}\n`);
}
```

- [ ] **Step 3: Create `scripts/lib/add-epic.mjs`**

```javascript
// scripts/lib/add-epic.mjs
// CLI flag parsing (shared by nearly every subcommand module), the add-epic verb, and
// plan-hierarchy. Circular with lib/render.mjs (addEpic calls render(); render() calls
// parseFlags()) -- see the design doc. parseFlags/parseLinkFlags/findCyclePath/
// parentError are general-purpose and imported by most other lib modules; they live
// here because that's where the "add-epic" comment section originally put them.

import fs from "node:fs";
import path from "node:path";
import { activate } from "./active-pointer.mjs";
import { isInitialized, loadState, saveState, readStdin } from "./state.mjs";
import { render } from "./render.mjs";
import { ROOT, KNOWN_LANES, KNOWN_STATUSES } from "./constants.mjs";

// Flags that accumulate into an array across repeated `--flag value` occurrences,
// shared by add-epic/add-many (--link), set-tracker (--intent), and set-autonomy
// (--preauthorize/--context/--notify).
const REPEATABLE_FLAGS = ["link", "intent", "preauthorize", "context", "notify", "add", "remove"];
export function parseFlags(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const k = a.slice(2);
    const v = (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) ? argv[++i] : true;
    if (REPEATABLE_FLAGS.includes(k)) (o[k] || (o[k] = [])).push(v);
    else o[k] = v;
  }
  return o;
}

/** Parse `--link "<type>:<epic>[:<reason>]"` strings into validated {type,epic,reason?}
 *  objects. Rejects malformed input by THROWING. Shared by add-epic and update-epic. */
export function parseLinkFlags(raw, knownEpicIds) {
  return (raw || []).filter(s => typeof s === "string").map(s => {
    const [type, epic, ...rest] = s.split(":");
    if (!type || !epic) {
      throw new Error(`bad --link '${s}': expected "<type>:<epic>[:<reason>]"`);
    }
    if (!knownEpicIds.has(epic)) {
      throw new Error(`bad --link '${s}': '${epic}' is not a known epic id`);
    }
    const reason = rest.join(":").trim();
    return reason ? { type, epic, reason } : { type, epic };
  });
}

/** DFS cycle-path finder over a dependency map (id -> Set of ids it depends on), restricted
 *  to `stuckIds`. Returns the actual cycle as an array of ids ending back at its start. */
export function findCyclePath(stuckIds, deps) {
  const stuckSet = new Set(stuckIds);
  const visited = new Set();
  const stack = [];
  const onStack = new Set();
  function dfs(id) {
    stack.push(id); onStack.add(id); visited.add(id);
    for (const dep of deps.get(id)) {
      if (!stuckSet.has(dep)) continue;
      if (onStack.has(dep)) return [...stack.slice(stack.indexOf(dep)), dep];
      if (!visited.has(dep)) {
        const found = dfs(dep);
        if (found) return found;
      }
    }
    stack.pop(); onStack.delete(id);
    return null;
  }
  for (const id of stuckIds) {
    if (!visited.has(id)) {
      const found = dfs(id);
      if (found) return found;
    }
  }
  return stuckIds;
}

/** `plan-hierarchy --parent <id>` — computes execution batches for a parent epic's children. */
export function planHierarchy() {
  if (!isInitialized()) { process.stderr.write("conductor: run /pm:init first\n"); process.exit(1); }
  const f = parseFlags(process.argv.slice(3));
  const parent = typeof f.parent === "string" ? f.parent : undefined;
  if (!parent) { process.stderr.write("usage: conductor.mjs plan-hierarchy --parent <id>\n"); process.exit(1); }
  const state = loadState();
  if (!state.epics.some(e => e.id === parent)) {
    process.stderr.write(`conductor: epic '${parent}' not found\n`); process.exit(1);
  }
  const children = state.epics.filter(e => e.parent === parent && e.status !== "archived");
  const childIds = new Set(children.map(e => e.id));

  const deps = new Map(children.map(e => [e.id, new Set()]));
  for (const e of children) {
    for (const l of (e.links || [])) {
      if (l && l.type === "depends-on" && childIds.has(l.epic)) deps.get(e.id).add(l.epic);
    }
  }

  const rank = { P0: 0, P1: 1, P2: 2, P3: 3, "P?": 9 };
  const placed = new Set();
  const batches = [];
  while (placed.size < children.length) {
    const ready = children.filter(e =>
      !placed.has(e.id) && [...deps.get(e.id)].every(d => placed.has(d)));
    if (!ready.length) {
      const stuck = children.filter(e => !placed.has(e.id)).map(e => e.id);
      const cycle = findCyclePath(stuck, deps);
      process.stderr.write(
        `conductor: plan-hierarchy: dependency cycle among children of '${parent}': ${cycle.join(" -> ")}\n`);
      process.exit(1);
    }
    ready.sort((a, b) => ((rank[a.priority] ?? 9) - (rank[b.priority] ?? 9)) || a.id.localeCompare(b.id));
    batches.push(ready);
    for (const e of ready) placed.add(e.id);
  }

  const plan = {
    parent,
    batches: batches.map((epics, i) => ({
      batch: i,
      epics: epics.map(e => ({
        id: e.id, priority: e.priority,
        autonomous: !!(e.autonomy && e.autonomy.level === "autonomous"),
        dependsOn: [...deps.get(e.id)].sort(),
      })),
    })),
  };
  process.stdout.write(JSON.stringify(plan) + "\n");
}

/** Validate a proposed `parent` for epic `id` against the current `epics`.
 *  Shared by add-epic, update-epic, and add-many so the tree stays acyclic. */
export function parentError(epics, id, parent) {
  if (parent === undefined || parent === null) return null;
  if (parent === id) return `epic '${id}' cannot be its own parent`;
  const byId = new Map(epics.map(e => [e.id, e]));
  if (!byId.has(parent)) return `parent '${parent}' is not a known epic`;
  let cur = byId.get(parent), guard = 0;
  while (cur && cur.parent && guard++ < 10000) {
    if (cur.parent === id) return `setting parent '${parent}' on '${id}' would create a cycle`;
    cur = byId.get(cur.parent);
  }
  return null;
}

export function addEpic() {
  if (!isInitialized()) { process.stderr.write("conductor: run /pm:init first\n"); process.exit(1); }
  const f = parseFlags(process.argv.slice(3));
  const str = (v) => (typeof v === "string" ? v : undefined);
  const id = str(f.id);
  if (!id || !/^[a-z0-9][a-z0-9._-]*$/.test(id)) {
    process.stderr.write("conductor: --id required, format ^[a-z0-9][a-z0-9._-]*$\n"); process.exit(1);
  }
  const lane = str(f.lane);
  if (!lane || !KNOWN_LANES.includes(lane)) {
    process.stderr.write(`conductor: --lane must be one of ${KNOWN_LANES.join("|")}\n`); process.exit(1);
  }
  const status = str(f.status) || "queued";
  if (!KNOWN_STATUSES.includes(status)) {
    process.stderr.write(`conductor: --status must be one of ${KNOWN_STATUSES.join("|")}\n`); process.exit(1);
  }
  const state = loadState();
  if (state.epics.some(e => e.id === id)) {
    process.stderr.write(`conductor: epic '${id}' already exists\n`); process.exit(1);
  }
  const externalId = str(f["external-id"]);
  const externalUrl = str(f["external-url"]);
  if (externalId !== undefined) {
    const dup = state.epics.find(e => {
      if (externalUrl !== undefined && e.externalUrl !== undefined) return e.externalUrl === externalUrl;
      if (externalUrl === undefined && e.externalUrl === undefined) return e.externalId === externalId;
      return false;
    });
    if (dup) {
      process.stderr.write(`conductor: epic with external-id '${externalId}' already exists ('${dup.id}') — skipped\n`);
      process.exit(1);
    }
  }
  let links;
  try {
    links = parseLinkFlags(f.link, new Set(state.epics.map(e => e.id)));
  } catch (e) {
    process.stderr.write(`conductor: ${e.message}\n`); process.exit(1);
  }
  const parent = str(f.parent);
  if (parent !== undefined) {
    const perr = parentError(state.epics, id, parent);
    if (perr) { process.stderr.write(`conductor: ${perr}\n`); process.exit(1); }
  }
  const epic = {
    id, title: str(f.title) || id, priority: str(f.priority) || "P?",
    status, role: "epic", lane, links, reconcileNeeded: false,
  };
  if (str(f.plan)) epic.planPath = f.plan;
  if (parent !== undefined) epic.parent = parent;
  if (str(f["external-id"]) !== undefined) epic.externalId = str(f["external-id"]);
  if (str(f["external-url"]) !== undefined) epic.externalUrl = str(f["external-url"]);
  state.epics.push(epic);
  if (epic.status === "active") activate(state, id);
  saveState(state);
  render();
  process.stderr.write(`conductor: added epic '${id}' (${lane}, ${status})\n`);
}
```

**Note:** `fs`/`path`/`ROOT` are imported above for consistency with the original file's
imports, but this exact set of six functions doesn't directly use them — verify against
the actual current `conductor.mjs` source and drop any genuinely unused import (a linter
or `node --check` won't catch unused imports, but keep the file honest).

- [ ] **Step 4: Create `scripts/lib/briefing.mjs`**

```javascript
// scripts/lib/briefing.mjs
// Builds the SessionStart/PreCompact briefing text. Needs lib/active-pointer.mjs's
// staleMarker() (one-directional — active-pointer doesn't need anything back from here).

import { resolveEpics, missing, orderQueueWithDependencies, bar } from "./epic-progress.mjs";
import { changelogAddedHeadlines, cmpVer, newestInstalledVersion, pluginVersion } from "./plugin-meta.mjs";
import { getAutonomy } from "./autonomy.mjs";
import { staleMarker } from "./active-pointer.mjs";
import { validLink } from "./links.mjs";
import { KNOWN_LANES } from "./constants.mjs";

export function buildBrief(state) {
  const epics = resolveEpics(state);
  const byId = Object.fromEntries(epics.map(e => [e.id, e]));
  const L = [];

  const stamped = state.pmVersion || "0.0.0";
  const newest = newestInstalledVersion();
  if (newest !== null) {
    if (cmpVer(stamped, newest) < 0) {
      L.push(`⚠ pm ${stamped} → ${newest} available — run \`/reload-plugins\` (if you just updated the plugin), then \`/pm:upgrade\`.`);
      for (const h of changelogAddedHeadlines(stamped, newest)) L.push(`   - ${h}`);
      L.push("");
    }
  } else {
    const running = pluginVersion();
    if (running && cmpVer(stamped, running) < 0) {
      L.push(`⚠ pm ${stamped} → ${running} since this repo was set up — run \`/pm:upgrade\` (CLAUDE.md rules and epic schema may need refreshing).`);
      for (const h of changelogAddedHeadlines(stamped, running)) L.push(`   - ${h}`);
      L.push("");
    }
  }

  L.push("CONDUCTOR STATE — where we are and what's next");
  L.push("");

  const activeEpic = state.active ? byId[state.active] : null;
  const active = activeEpic && activeEpic.status !== "archived" ? activeEpic : null;
  if (active) {
    const autonomous = getAutonomy(active).level === "autonomous" ? ", 🤖 autonomous" : "";
    L.push(`NOW: \`${active.id}\` (${active.lane}, ${active.role}, ${active.priority}${autonomous}) — ${bar(active.progress)}${staleMarker(active)}`);
    if (active.reconcileNeeded)
      L.push(`  ⚠ RECONCILE PENDING: re-validate this proposal before continuing (a detour touched shared code).`);
  } else if (activeEpic && activeEpic.status === "archived") {
    L.push(`NOW: (no active epic — \`${activeEpic.id}\` was archived; the active pointer clears on next /pm:sync or commit)`);
  } else {
    L.push("NOW: (no active epic set)");
  }
  L.push("");

  if (state.detourStack.length) {
    L.push(`DETOUR STACK — ${state.detourStack.length} paused (LIFO, resume top first):`);
    for (let i = state.detourStack.length - 1; i >= 0; i--) {
      const f = state.detourStack[i];
      L.push(`  ⤷ paused \`${f.pausedEpic}\` — ${f.reason}`);
      if (f.spawnedDetour) L.push(`      detour in flight: \`${f.spawnedDetour}\``);
      if (f.reconcileOnResume)
        L.push(`      ⚠ ON RESUME: re-validate \`${f.pausedEpic}\` against \`${f.spawnedDetour}\`'s changes BEFORE coding.`);
    }
    L.push("");
  }

  const NEXT_CAP = 5;
  const queuedByPriority = epics.filter(e => ["queued", "untriaged"].includes(e.status) && !missing(e));
  const { ordered: queued, notes: starvationNotes } = orderQueueWithDependencies(queuedByPriority);
  if (queued.length) {
    L.push("NEXT UP (by priority, then lane):");
    for (const e of queued.slice(0, NEXT_CAP)) {
      const pa = e.parent ? `, parent: \`${e.parent}\`` : "";
      L.push(`  • \`${e.id}\` (${e.priority}, ${e.lane}, ${e.status}${pa}) — ${bar(e.progress)}${staleMarker(e)}`);
    }
    if (queued.length > NEXT_CAP) L.push(`  (+${queued.length - NEXT_CAP} more — see PROJECT.md)`);
    for (const note of starvationNotes) L.push(`  ⚠ ${note}`);
    const counts = {};
    for (const e of epics) if (!missing(e) && e.status !== "planned") counts[e.lane] = (counts[e.lane] || 0) + 1;
    const ordered = KNOWN_LANES.filter(l => counts[l]).map(l => `${l} ${counts[l]}`);
    const unknown = Object.keys(counts).filter(l => !KNOWN_LANES.includes(l)).sort().map(l => `${l} ${counts[l]}`);
    L.push(`  lanes: ${[...ordered, ...unknown].join(" · ")}`);
    L.push("");
  }

  const plannedCount = epics.filter(e => e.status === "planned").length;
  if (plannedCount) {
    L.push(`planned: ${plannedCount} — see PROJECT.md`);
    L.push("");
  }

  const links = epics.flatMap(e => (e.links || []).filter(validLink).map(l => ({ from: e.id, ...l })));
  if (links.length) {
    L.push("EPIC LINKS:");
    for (const l of links) L.push(`  • \`${l.from}\` ${l.type} \`${l.epic}\`${l.reason ? ` — ${l.reason}` : ""}`);
    L.push("");
  }

  if (state.tracker && state.tracker.system) {
    const tr = state.tracker;
    const scope = tr.projectKey ? ` · ${tr.projectKey}` : "";
    const unmirrored = epics.filter(e =>
      ["queued", "active", "paused"].includes(e.status) && !missing(e) && !e.externalId);
    L.push(`TRACKER SYNC (${tr.system}${scope}):`);
    if (unmirrored.length) {
      L.push(`  ⚠ not yet in ${tr.system} — create issues + record keys (update-epic): ` +
        unmirrored.map(e => `\`${e.id}\``).join(", "));
    } else {
      L.push(`  ✓ all active epics are mirrored to ${tr.system}`);
    }
    L.push("");
  }

  const secondaryTrackers = Array.isArray(state.secondaryTrackers) ? state.secondaryTrackers : [];
  const trackerCount = (state.tracker && state.tracker.system ? 1 : 0) + secondaryTrackers.length;
  if (trackerCount > 0) {
    const systems = [
      ...(state.tracker && state.tracker.system ? [state.tracker.system] : []),
      ...secondaryTrackers.map(st => st.system),
    ];
    const label = trackerCount === 1 ? "tracker" : "trackers";
    L.push(`💡 ${trackerCount} ${label} configured (${systems.join(", ")}) — consider \`/pm:sync\` this ` +
      "session to pull in any new issues.");
    L.push("");
  }

  L.push("RULES (pm): classify detours before fixing — minimal → fix+commit then `/pm:detour --minimal`; " +
    "substantial → `/pm:detour` (own proposal + PUSH). After any state change, `/pm:status`. " +
    "Resume via `/pm:resume` + reconcile gate. Mirror every PUSH/POP to a one-line Honcho memory.");
  L.push("");
  L.push("Manage with /pm:status · /pm:next · /pm:detour · /pm:resume, or the `conductor` skill.");
  return L.join("\n");
}
```

**Note:** the "TRACKER SYNC"/sync-nudge blocks above must match the actual current
`buildBrief()` body exactly — the CLAUDE.md rules block generation has evolved with
GitHub-issue-sync and secondary-tracker features across recent releases in this same
session. Diff this against `sed -n '/^function buildBrief/,/^}/p' scripts/conductor.mjs`
before committing and use the real current text for any part that differs.

- [ ] **Step 5: Create `scripts/lib/render.mjs`**

```javascript
// scripts/lib/render.mjs
// Renders PROJECT.md from state.json + on-disk truth. Circular with
// lib/active-pointer.mjs (staleMarker), lib/autonomy.mjs (getAutonomy), and
// lib/add-epic.mjs (parseFlags) -- see the design doc.

import fs from "node:fs";
import { loadState, saveState, readJSON } from "./state.mjs";
import { reconcileArchived, resolveEpics, bar, missing } from "./epic-progress.mjs";
import { buildBrief } from "./briefing.mjs";
import { staleMarker } from "./active-pointer.mjs";
import { getAutonomy } from "./autonomy.mjs";
import { parseFlags } from "./add-epic.mjs";
import { validLink } from "./links.mjs";
import { DETOURS_LOG, PROJECT_MD, STATE_PATH, RENDER_STAMP_PATH, CONDUCTOR_DIR } from "./constants.mjs";

export function render() {
  const state = loadState();
  if (reconcileArchived(state)) saveState(state);
  const epics = resolveEpics(state);
  const md = [];

  md.push("# PROJECT — Conductor Index");
  md.push("");
  md.push("> GENERATED by the `pm` plugin — do not hand-edit. Source of truth is");
  md.push("> `.conductor/state.json` (ordering, detours, links) + OpenSpec `tasks.md` (stories).");
  md.push("> Regenerate: `/pm:status` (or `node scripts/conductor.mjs render`).");
  md.push(`> Last rendered: ${new Date().toISOString()}`);
  md.push("");

  const activeEpic = epics.find(e => e.id === state.active);
  const active = activeEpic && activeEpic.status !== "archived" ? activeEpic : null;
  md.push("## Now");
  md.push("");
  if (active) {
    md.push(`**\`${active.id}\`** — ${active.title} (${active.role}, ${active.priority}) — ${bar(active.progress)}${staleMarker(active)}`);
    if (active.reconcileNeeded) {
      md.push("");
      md.push("⚠ **Reconcile pending** — re-validate this proposal before continuing.");
    }
  } else if (activeEpic && activeEpic.status === "archived") {
    md.push(`_\`${activeEpic.id}\` was archived; the active pointer clears on next \`/pm:sync\` or commit._`);
  } else {
    md.push("_No active epic set._");
  }
  md.push("");

  md.push("## Detour stack");
  md.push("");
  if (!state.detourStack.length) {
    md.push("_Empty — no work is paused._");
  } else {
    md.push("| # | Paused epic | Reason | Detour | Reconcile on resume |");
    md.push("|---|-------------|--------|--------|---------------------|");
    state.detourStack.forEach((f, i) => {
      md.push(`| ${i + 1} | \`${f.pausedEpic}\` | ${f.reason} | \`${f.spawnedDetour || "-"}\` | ${f.reconcileOnResume ? "⚠ yes" : "no"} |`);
    });
  }
  md.push("");

  md.push("## Epics");
  md.push("");
  md.push("| Priority | Epic | Lane | Role | Status | Progress | Links |");
  md.push("|----------|------|------|------|--------|----------|-------|");
  const byId = new Map(epics.map(e => [e.id, e]));
  const childrenOf = (id) => epics.filter(e => e.parent === id);
  const epicRow = (e, depth) => {
    const links = (e.links || []).filter(validLink).map(l => `${l.type}→${l.epic}`).join("; ") || "-";
    const miss = missing(e) ? " ⚠ no change on disk" : "";
    const indent = depth > 0 ? "└─ ".repeat(depth) : "";
    const kids = childrenOf(e.id);
    let progress = bar(e.progress);
    if (kids.length) {
      const archived = kids.filter(k => k.status === "archived").length;
      const rollup = `${archived}/${kids.length} children archived`;
      progress = progress === "—" ? rollup : `${rollup} · ${progress}`;
    }
    const autonomous = getAutonomy(e).level === "autonomous" ? " 🤖" : "";
    md.push(`| ${e.priority} | ${indent}\`${e.id}\` | ${e.lane} | ${e.role} | ${e.status}${e.reconcileNeeded ? " ⚠" : ""}${miss}${autonomous}${staleMarker(e)} | ${progress} | ${links} |`);
  };
  const seen = new Set();
  const emit = (e, depth) => {
    if (seen.has(e.id)) return;
    seen.add(e.id);
    epicRow(e, depth);
    for (const c of childrenOf(e.id)) emit(c, depth + 1);
  };
  for (const e of epics) if (!e.parent || !byId.has(e.parent)) emit(e, 0);
  for (const e of epics) if (!seen.has(e.id)) emit(e, 0);
  md.push("");

  md.push("## Recent detours");
  md.push("");
  try {
    const lines = fs.readFileSync(DETOURS_LOG, "utf8").trim().split("\n").filter(Boolean).slice(-8);
    if (lines.length) {
      md.push("| When | SHA | Kind | Epic | Note |");
      md.push("|------|-----|------|------|------|");
      for (const ln of lines) {
        const [when, sha, kind, epic, note] = ln.split("\t");
        md.push(`| ${when} | \`${sha}\` | ${kind} | \`${epic}\` | ${note || ""} |`);
      }
    } else { md.push("_None logged._"); }
  } catch { md.push("_None logged._"); }
  md.push("");

  md.push("## Briefing (what a fresh session sees)");
  md.push("");
  md.push("```");
  md.push(buildBrief(state));
  md.push("```");
  md.push("");

  const content = md.join("\n");
  const STAMP_RE = /^> Last rendered: .*$/m;
  let existing = "";
  try { existing = fs.readFileSync(PROJECT_MD, "utf8"); } catch { /* no file yet */ }
  writeRenderStamp();

  const flags = parseFlags(process.argv.slice(3));
  if (flags["diff-summary"]) {
    const epicRelevant = !existing || normalizeForDiffSummary(existing) !== normalizeForDiffSummary(content);
    process.stdout.write(`epic-relevant: ${epicRelevant ? "yes" : "no"}\n`);
  }

  if (existing && existing.replace(STAMP_RE, "") === content.replace(STAMP_RE, "")) {
    process.stderr.write("conductor: PROJECT.md unchanged (skipped rewrite)\n");
    return;
  }
  fs.writeFileSync(PROJECT_MD, content);
  process.stderr.write(`conductor: rendered ${PROJECT_MD}\n`);
}

/** Normalizes the two sources of PROJECT.md diff noise that are never "epic-relevant" on
 *  their own: the "Last rendered" timestamp line and the "## Recent detours" table body. */
export function normalizeForDiffSummary(content) {
  let out = content.replace(/^> Last rendered: .*$/m, "> Last rendered: (normalized)");
  const marker = "## Recent detours";
  const start = out.indexOf(marker);
  if (start !== -1) {
    const afterHeading = start + marker.length;
    const nextHeadingIdx = out.indexOf("\n## ", afterHeading);
    const end = nextHeadingIdx === -1 ? out.length : nextHeadingIdx;
    out = out.slice(0, afterHeading) + "\n(normalized)\n" + out.slice(end);
  }
  return out;
}

/** Records when PROJECT.md was last generated FROM the current state.json content, so
 *  `verify-state` can catch an undetected hand-edit. */
export function writeRenderStamp() {
  let stateMtimeMs = null;
  try { stateMtimeMs = fs.statSync(STATE_PATH).mtimeMs; } catch { /* no state.json yet */ }
  const existing = readJSON(RENDER_STAMP_PATH, null);
  if (existing && existing.stateMtimeMs === stateMtimeMs) return;
  const stamp = { renderedAt: new Date().toISOString(), stateMtimeMs };
  fs.mkdirSync(CONDUCTOR_DIR, { recursive: true });
  fs.writeFileSync(RENDER_STAMP_PATH, JSON.stringify(stamp, null, 2) + "\n");
}
```

**Note:** this codebase has iterated on `render()`/`buildBrief()` a great deal this
session (the `--diff-summary` flag, various tracker-sync additions). Diff the reproduction
above against `sed -n '/^function render()/,/^function writeRenderStamp/p'
scripts/conductor.mjs` before committing, and use the real current source for anything
that's drifted.

- [ ] **Step 6: In `scripts/conductor.mjs`, delete all functions covered by Steps 1-5 above** (the briefing, render PROJECT.md, add-epic, active pointer, and autonomy sections in full, plus `getAutonomy`/`DEFAULT_AUTONOMY` from the old helpers section if not already removed in an earlier task), and add:

```javascript
import { activate, daysActive, staleMarker, setActive, clearActive } from "./lib/active-pointer.mjs";
import { getAutonomy, setAutonomy } from "./lib/autonomy.mjs";
import { parseFlags, parseLinkFlags, findCyclePath, planHierarchy, parentError, addEpic } from "./lib/add-epic.mjs";
import { buildBrief } from "./lib/briefing.mjs";
import { render, normalizeForDiffSummary, writeRenderStamp } from "./lib/render.mjs";
```

- [ ] **Step 7: Run the full test suite**

Run: `node --test scripts/conductor.test.mjs`
Expected: all tests pass. This is the highest-risk task in the whole plan (5 files, 2 real
circular pairs) — if anything fails, check for: (a) a genuinely stale reproduction that
didn't match the real source (see the "Note" callouts above), (b) a missing `export`
keyword, (c) an import path typo.

- [ ] **Step 8: Commit**

```bash
git add scripts/lib/active-pointer.mjs scripts/lib/autonomy.mjs scripts/lib/add-epic.mjs scripts/lib/briefing.mjs scripts/lib/render.mjs scripts/conductor.mjs
git commit -m "refactor(pm): extract the render/briefing/active-pointer/autonomy/add-epic cluster

These five modules are mutually dependent (render() needs getAutonomy(),
parseFlags(), and staleMarker(); all three call render() back) and must
land in one commit -- see the design doc's corrected circular-imports
section for the verified call graph."
```

---

### Task 9: `lib/subcommands.mjs`

**Files:**
- Create: `scripts/lib/subcommands.mjs`
- Modify: `scripts/conductor.mjs` (functions: `init`, `brief`, `snapshot`, `headChangedFiles`, `looksLikeUnloggedMinimalDetour`, `commitNudge`, `sync`, `logDetour`, `honchoMemoryLine`, `honchoMemory`, plus local consts `CONDUCTOR_OWN_FILES` and `HONCHO_MEMORIES_LOG` — originally lines 1092-1283)

**Interfaces:**
- Consumes: `defaultState`/`isInitialized`/`loadState`/`saveState`/`readStdin` (state), `stampVersion` (plugin-meta), `render` (render.mjs), `writeRules` (rules.mjs), `buildBrief` (briefing.mjs), `appendDetourLog`/`gitShortSha` (git), `detourContext` (links), `activeChangeIds`/`firstHeading`/`planFiles`/`reconcileArchived` (epic-progress), `CONDUCTOR_DIR` (constants)
- Produces: `init()`, `brief()`, `snapshot()`, `commitNudge()`, `sync(quiet)`, `logDetour()`, `honchoMemory()`

**⚠ Verify against real source, don't retype from memory:** `headChangedFiles`,
`looksLikeUnloggedMinimalDetour`, and the exact bodies of `commitNudge`/`sync`/
`honchoMemoryLine`/`honchoMemory` are NOT reproduced here — this section has grown
significantly (auto-detour heuristics, honcho memory logging) and a stale reproduction
risks silently reintroducing an old bug. Get the exact current content directly:

```bash
sed -n '/^function init/,/^\/\/ ---------- add-epic/p' scripts/conductor.mjs | head -n -2 > /tmp/subcommands.txt
```

- [ ] **Step 1: Create `scripts/lib/subcommands.mjs`** with this header, followed by the
verbatim content of `/tmp/subcommands.txt` from Step 1 above (add `export` before each of
the 10 function declarations: `init`, `brief`, `snapshot`, `headChangedFiles`,
`looksLikeUnloggedMinimalDetour`, `commitNudge`, `sync`, `logDetour`, `honchoMemoryLine`,
`honchoMemory`):

```javascript
// scripts/lib/subcommands.mjs
// Top-level session-hook entry points: init, the SessionStart/PreCompact hooks,
// commit-nudge, sync, log-detour, and honcho-memory. One-directional dependency on the
// render/briefing/rules modules -- nothing calls back into this file.

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { defaultState, isInitialized, loadState, saveState, readStdin } from "./state.mjs";
import { stampVersion } from "./plugin-meta.mjs";
import { render } from "./render.mjs";
import { writeRules } from "./rules.mjs";
import { buildBrief } from "./briefing.mjs";
import { appendDetourLog, gitShortSha } from "./git.mjs";
import { detourContext } from "./links.mjs";
import { activeChangeIds, firstHeading, planFiles, reconcileArchived } from "./epic-progress.mjs";
import { ROOT, CONDUCTOR_DIR } from "./constants.mjs";

// PASTE THE VERBATIM CONTENT OF /tmp/subcommands.txt HERE, with `export ` prepended to
// each of: function init, function brief, function snapshot, function headChangedFiles,
// function looksLikeUnloggedMinimalDetour, function commitNudge, function sync,
// function logDetour, function honchoMemoryLine, function honchoMemory.
// Also prepend `export ` to `const CONDUCTOR_OWN_FILES = ...` and
// `const HONCHO_MEMORIES_LOG = ...` if either is referenced from conductor.mjs's
// dispatch table after extraction (check first — likely not, since the dispatch table
// only calls the exported functions, not these internal consts).
```

- [ ] **Step 2: In `scripts/conductor.mjs`, delete the whole "subcommands" section**
(everything from `function init()` through the end of `function honchoMemory()`,
including the `CONDUCTOR_OWN_FILES` and `HONCHO_MEMORIES_LOG` consts), and add:

```javascript
import { init, brief, snapshot, commitNudge, sync, logDetour, honchoMemory } from "./lib/subcommands.mjs";
```

- [ ] **Step 3: Run the full test suite**

Run: `node --test scripts/conductor.test.mjs`
Expected: all tests pass, including any test exercising `/pm:init`, session hooks, or the
auto-detour heuristic.

- [ ] **Step 4: Commit**

```bash
git add scripts/lib/subcommands.mjs scripts/conductor.mjs
git commit -m "refactor(pm): extract lib/subcommands.mjs from conductor.mjs"
```

---

### Task 10: `lib/add-many.mjs`

**Files:**
- Create: `scripts/lib/add-many.mjs`
- Modify: `scripts/conductor.mjs` (function: `addMany`)

**Interfaces:**
- Consumes: `parentError` (add-epic), `isInitialized`/`loadState`/`saveState`/`readStdin` (state), `render` (render.mjs), `ROOT`/`KNOWN_LANES`/`KNOWN_STATUSES` (constants)
- Produces: `addMany()`

- [ ] **Step 1: Create `scripts/lib/add-many.mjs`**

```javascript
// scripts/lib/add-many.mjs
// Atomic bulk epic creation. One-directional dependency on lib/add-epic.mjs
// (parentError) and lib/render.mjs (render) -- neither calls back here.

import fs from "node:fs";
import path from "node:path";
import { parentError, parseFlags } from "./add-epic.mjs";
import { isInitialized, loadState, saveState, readStdin } from "./state.mjs";
import { render } from "./render.mjs";
import { ROOT, KNOWN_LANES, KNOWN_STATUSES } from "./constants.mjs";

/** Bulk-create epics from a JSON batch `{ parent?, epics: [...] }`.
 *  Validate EVERYTHING first (id format, uniqueness vs existing AND within the
 *  batch, lane, status, parent refs/cycles); on any failure write nothing and
 *  exit non-zero. One saveState at the end — atomic, and race-free. JSON only
 *  (zero-dep engine). `--from -` reads stdin. */
export function addMany() {
  if (!isInitialized()) { process.stderr.write("conductor: run /pm:init first\n"); process.exit(1); }
  const f = parseFlags(process.argv.slice(3));
  const from = typeof f.from === "string" ? f.from : undefined;
  if (!from) { process.stderr.write("usage: conductor.mjs add-many --from <path|->\n"); process.exit(1); }
  let raw;
  try { raw = from === "-" ? readStdin() : fs.readFileSync(path.resolve(ROOT, from), "utf8"); }
  catch { process.stderr.write(`conductor: cannot read '${from}'\n`); process.exit(1); }
  let doc;
  try { doc = JSON.parse(raw); } catch { process.stderr.write("conductor: --from is not valid JSON\n"); process.exit(1); }

  const state = loadState();
  const parentId = doc.parent && typeof doc.parent.id === "string" ? doc.parent.id : undefined;
  const incoming = [];
  if (doc.parent) incoming.push({ ...doc.parent });
  for (const e of Array.isArray(doc.epics) ? doc.epics : []) {
    const entry = { ...e };
    if (parentId && entry.parent === undefined) entry.parent = parentId;
    incoming.push(entry);
  }
  if (!incoming.length) { process.stderr.write("conductor: add-many: nothing to add (need `parent` and/or `epics`)\n"); process.exit(1); }

  const die = (msg) => { process.stderr.write(`conductor: add-many: ${msg}\n`); process.exit(1); };

  const existingIds = new Set(state.epics.map(e => e.id));
  const batchIds = new Set();
  for (const e of incoming) {
    const id = e.id;
    if (typeof id !== "string" || !/^[a-z0-9][a-z0-9._-]*$/.test(id)) die(`bad id '${id}' (format ^[a-z0-9][a-z0-9._-]*$)`);
    if (existingIds.has(id)) die(`epic '${id}' already exists`);
    if (batchIds.has(id)) die(`duplicate id '${id}' within the batch`);
    if (!e.lane || !KNOWN_LANES.includes(e.lane)) die(`epic '${id}': lane must be one of ${KNOWN_LANES.join("|")}`);
    const status = e.status || "queued";
    if (!KNOWN_STATUSES.includes(status)) die(`epic '${id}': status must be one of ${KNOWN_STATUSES.join("|")}`);
    batchIds.add(id);
  }
  const projected = [...state.epics, ...incoming.map(e => ({ id: e.id, parent: e.parent }))];
  for (const e of incoming) {
    if (e.parent !== undefined && e.parent !== null) {
      const perr = parentError(projected, e.id, e.parent);
      if (perr) die(perr);
    }
  }
  for (const e of incoming) {
    const epic = {
      id: e.id, title: typeof e.title === "string" ? e.title : e.id,
      priority: typeof e.priority === "string" ? e.priority : "P?",
      status: e.status || "queued", role: "epic", lane: e.lane,
      links: Array.isArray(e.links) ? e.links : [], reconcileNeeded: false,
    };
    if (e.parent !== undefined && e.parent !== null) epic.parent = e.parent;
    if (typeof e.externalId === "string") epic.externalId = e.externalId;
    if (typeof e.externalUrl === "string") epic.externalUrl = e.externalUrl;
    if (typeof e.planPath === "string") epic.planPath = e.planPath;
    state.epics.push(epic);
  }
  saveState(state);
  render();
  process.stderr.write(`conductor: add-many added ${incoming.length} epic(s)\n`);
}
```

- [ ] **Step 2: In `scripts/conductor.mjs`, delete the `addMany` function body**, and add:

```javascript
import { addMany } from "./lib/add-many.mjs";
```

- [ ] **Step 3: Run the full test suite**

Run: `node --test scripts/conductor.test.mjs`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add scripts/lib/add-many.mjs scripts/conductor.mjs
git commit -m "refactor(pm): extract lib/add-many.mjs from conductor.mjs"
```

---

### Task 11: `lib/update-epic.mjs`

**Files:**
- Create: `scripts/lib/update-epic.mjs`
- Modify: `scripts/conductor.mjs` (functions: `updateEpic`, `epicSummaryTable`; local const `UPDATE_EPIC_FLAGS` — originally lines 1639-1772, minus the `remove-epic` section which starts partway through per the section table)

**Interfaces:**
- Consumes: `activate` (active-pointer), `globalReviewMode` (rules), `isInitialized`/`loadState`/`saveState` (state), `parentError`/`parseFlags`/`parseLinkFlags` (add-epic), `recordGateReview` (gate-review-writeback — check for a cycle: does `recordGateReview` call back into `updateEpic`? No, per the verified call graph `recordGateReview`'s only deps are `isInitialized`/`loadState`/`saveState`/`parseFlags`/`render` — one-directional, safe), `render` (render.mjs)
- Produces: `updateEpic()`, `epicSummaryTable(epics)`

**⚠ Verify against real source:** `updateEpic()` is one of the largest and most
frequently-modified functions in this session (it grew `--add-story`/`--story --done`
support in a recent task). Get the exact current body — do not retype from memory:

```bash
sed -n '/^const UPDATE_EPIC_FLAGS/,/^\/\/ ---------- remove-epic/p' scripts/conductor.mjs | head -n -2 > /tmp/update-epic.txt
```

- [ ] **Step 1: Create `scripts/lib/update-epic.mjs`** with this header, then the verbatim
content of `/tmp/update-epic.txt` (add `export` to `const UPDATE_EPIC_FLAGS`, `function
updateEpic`, and `function epicSummaryTable`):

```javascript
// scripts/lib/update-epic.mjs
// The update-epic write-back verb: title/status/priority/links/story mutations on an
// existing epic. One-directional dependencies only.

import { activate } from "./active-pointer.mjs";
import { globalReviewMode } from "./rules.mjs";
import { isInitialized, loadState, saveState } from "./state.mjs";
import { parentError, parseFlags, parseLinkFlags } from "./add-epic.mjs";
import { recordGateReview } from "./gate-review-writeback.mjs";
import { render } from "./render.mjs";

// PASTE THE VERBATIM CONTENT OF /tmp/update-epic.txt HERE, with `export ` prepended to
// `const UPDATE_EPIC_FLAGS`, `function updateEpic`, and `function epicSummaryTable`.
```

- [ ] **Step 2: In `scripts/conductor.mjs`, delete the `UPDATE_EPIC_FLAGS`/`updateEpic`/`epicSummaryTable` bodies**, and add:

```javascript
import { updateEpic, epicSummaryTable } from "./lib/update-epic.mjs";
```

**Note:** `lib/update-epic.mjs` imports `recordGateReview` from `lib/gate-review-writeback.mjs`,
which doesn't exist yet at this point in the plan (Task 15). Either reorder this task to
after Task 15, or create a minimal `lib/gate-review-writeback.mjs` stub now and complete
it properly in Task 15. **Recommended: do Task 15 (`gate-review-writeback.mjs`) and Task
14 (`reconciler-writeback.mjs`) BEFORE this task**, since neither has any dependency on
`update-epic.mjs` and are simpler, standalone modules — swap their order in relative to
what's numbered here if executing tasks strictly in order. If using subagent-driven
execution, flag this reordering explicitly to whichever agent picks up this task.

- [ ] **Step 3: Run the full test suite**

Run: `node --test scripts/conductor.test.mjs`
Expected: all tests pass, including every test touching `update-epic` (status/priority/link/story mutations).

- [ ] **Step 4: Commit**

```bash
git add scripts/lib/update-epic.mjs scripts/conductor.mjs
git commit -m "refactor(pm): extract lib/update-epic.mjs from conductor.mjs"
```

---

### Task 12: `lib/remove-epic.mjs`

**Files:**
- Create: `scripts/lib/remove-epic.mjs`
- Modify: `scripts/conductor.mjs` (functions: `removeEpic`, `epicSummaryTable` if not already covered by Task 11 — verify: the function list shows `epicSummaryTable` at line 1777, inside "remove-epic" section per line ranges, NOT inside "update-epic" — correct Task 11 accordingly: `epicSummaryTable` belongs to `remove-epic.mjs`, not `update-epic.mjs`. Fix this cross-reference before executing Task 11.)

**⚠ Correction to Task 11 above:** `epicSummaryTable` (line 1777) is inside the
"remove-epic" section (1773-1848), not "update-epic" (1639-1772). When executing Task 11,
do NOT move `epicSummaryTable` there — leave it for this task instead. Verify the exact
boundary with `grep -n "^function updateEpic\|^function epicSummaryTable\|^function removeEpic\|^// ---------- remove-epic" scripts/conductor.mjs` before extracting either file.

**Interfaces:**
- Consumes: `isInitialized`/`loadState`/`saveState` (state), `parseFlags` (add-epic), `render` (render.mjs)
- Produces: `epicSummaryTable(epics)`, `removeEpic()`

- [ ] **Step 1: Get the exact current body**

```bash
sed -n '/^\/\/ ---------- remove-epic/,/^\/\/ ---------- autonomy/p' scripts/conductor.mjs | head -n -2 > /tmp/remove-epic.txt
cat /tmp/remove-epic.txt
```

- [ ] **Step 2: Create `scripts/lib/remove-epic.mjs`** with this header, then the verbatim
content from Step 1 (add `export` to `function epicSummaryTable` and `function removeEpic`):

```javascript
// scripts/lib/remove-epic.mjs
// The remove-epic verb and its epic-summary-table formatter. One-directional
// dependencies only.

import { isInitialized, loadState, saveState } from "./state.mjs";
import { parseFlags } from "./add-epic.mjs";
import { render } from "./render.mjs";

// PASTE THE VERBATIM CONTENT FROM STEP 1 HERE, with `export ` prepended to
// `function epicSummaryTable` and `function removeEpic`.
```

- [ ] **Step 3: In `scripts/conductor.mjs`, delete the `epicSummaryTable`/`removeEpic` bodies**, and add:

```javascript
import { epicSummaryTable, removeEpic } from "./lib/remove-epic.mjs";
```

- [ ] **Step 4: Run the full test suite**

Run: `node --test scripts/conductor.test.mjs`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/remove-epic.mjs scripts/conductor.mjs
git commit -m "refactor(pm): extract lib/remove-epic.mjs from conductor.mjs"
```

---

### Task 13: `lib/reconciler-writeback.mjs`

**Files:**
- Create: `scripts/lib/reconciler-writeback.mjs`
- Modify: `scripts/conductor.mjs` (function: `recordReconcile`; local const `KNOWN_RECONCILE_VERDICTS`)

**Interfaces:**
- Consumes: `isInitialized`/`loadState`/`saveState` (state), `parseFlags` (add-epic), `render` (render.mjs)
- Produces: `recordReconcile()`

**Note:** do this task (and Task 14) BEFORE Task 11 (`update-epic.mjs`) if executing in
numeric order, since Task 11's `update-epic.mjs` needs `recordGateReview` from Task 14 —
see the note in Task 11.

- [ ] **Step 1: Create `scripts/lib/reconciler-writeback.mjs`**

```javascript
// scripts/lib/reconciler-writeback.mjs
// Records a reconciler's verdict (valid/invalidated) durably against a paused epic's
// link to the detour that may have invalidated it. One-directional dependencies only.

import { isInitialized, loadState, saveState } from "./state.mjs";
import { parseFlags } from "./add-epic.mjs";
import { render } from "./render.mjs";

const KNOWN_RECONCILE_VERDICTS = ["valid", "invalidated"];

export function recordReconcile() {
  if (!isInitialized()) { process.stderr.write("conductor: run /pm:init first\n"); process.exit(1); }
  const argv = process.argv.slice(3);
  const id = argv[0] && !argv[0].startsWith("--") ? argv[0] : undefined;
  const f = parseFlags(id ? argv.slice(1) : argv);
  const detourId = typeof f.detour === "string" ? f.detour : undefined;
  const verdict = typeof f.verdict === "string" ? f.verdict : undefined;
  if (!id || !detourId || !verdict) {
    process.stderr.write(
      "usage: conductor.mjs record-reconcile <epicId> --detour <detourId> " +
      "--verdict valid|invalidated [--amendments \"<a>;<b>\"]\n");
    process.exit(1);
  }
  if (!KNOWN_RECONCILE_VERDICTS.includes(verdict)) {
    process.stderr.write(`conductor: --verdict must be one of ${KNOWN_RECONCILE_VERDICTS.join("|")}\n`);
    process.exit(1);
  }
  const state = loadState();
  const epic = state.epics.find(e => e.id === id);
  if (!epic) { process.stderr.write(`conductor: epic '${id}' not found\n`); process.exit(1); }
  if (!state.epics.some(e => e.id === detourId)) {
    process.stderr.write(`conductor: detour epic '${detourId}' not found\n`); process.exit(1);
  }

  const amendments = typeof f.amendments === "string"
    ? f.amendments.split(";").map(s => s.trim()).filter(Boolean)
    : [];

  epic.links = Array.isArray(epic.links) ? epic.links : [];
  let link = epic.links.find(l => l && l.epic === detourId);
  if (!link) {
    link = { type: "may-invalidate", epic: detourId };
    epic.links.push(link);
  }
  link.reconciled = { verdict, amendments, reconciledAt: new Date().toISOString() };
  epic.reconcileNeeded = false;

  saveState(state);
  render();
  process.stderr.write(`conductor: recorded reconcile verdict '${verdict}' for '${id}' vs '${detourId}'\n`);
}
```

- [ ] **Step 2: In `scripts/conductor.mjs`, delete the `KNOWN_RECONCILE_VERDICTS`/`recordReconcile` bodies**, and add:

```javascript
import { recordReconcile } from "./lib/reconciler-writeback.mjs";
```

- [ ] **Step 3: Run the full test suite**

Run: `node --test scripts/conductor.test.mjs`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add scripts/lib/reconciler-writeback.mjs scripts/conductor.mjs
git commit -m "refactor(pm): extract lib/reconciler-writeback.mjs from conductor.mjs"
```

---

### Task 14: `lib/gate-review-writeback.mjs`

**Files:**
- Create: `scripts/lib/gate-review-writeback.mjs`
- Modify: `scripts/conductor.mjs` (function: `recordGateReview`; local consts `KNOWN_GATE_NUMBERS`, `KNOWN_GATE_VERDICTS`)

**Interfaces:**
- Consumes: `isInitialized`/`loadState`/`saveState` (state), `parseFlags` (add-epic), `render` (render.mjs)
- Produces: `recordGateReview()`

- [ ] **Step 1: Create `scripts/lib/gate-review-writeback.mjs`**

```javascript
// scripts/lib/gate-review-writeback.mjs
// Records an OpenSpec gate review's verdict durably against an epic. One-directional
// dependencies only.

import { isInitialized, loadState, saveState } from "./state.mjs";
import { parseFlags } from "./add-epic.mjs";
import { render } from "./render.mjs";

const KNOWN_GATE_NUMBERS = ["1", "2"];
const KNOWN_GATE_VERDICTS = ["pass", "fail"];

export function recordGateReview() {
  if (!isInitialized()) { process.stderr.write("conductor: run /pm:init first\n"); process.exit(1); }
  const argv = process.argv.slice(3);
  const id = argv[0] && !argv[0].startsWith("--") ? argv[0] : undefined;
  const f = parseFlags(id ? argv.slice(1) : argv);
  const gate = typeof f.gate === "string" ? f.gate : (typeof f.gate === "number" ? String(f.gate) : undefined);
  const verdict = typeof f.verdict === "string" ? f.verdict : undefined;
  const note = typeof f.reviewer === "string" ? f.reviewer : undefined;
  if (!id || !gate || !verdict) {
    process.stderr.write(
      "usage: conductor.mjs record-gate-review <epicId> --gate 1|2 --verdict pass|fail " +
      "[--reviewer \"<note>\"]\n");
    process.exit(1);
  }
  if (!KNOWN_GATE_NUMBERS.includes(gate)) {
    process.stderr.write(`conductor: --gate must be one of ${KNOWN_GATE_NUMBERS.join("|")}\n`);
    process.exit(1);
  }
  if (!KNOWN_GATE_VERDICTS.includes(verdict)) {
    process.stderr.write(`conductor: --verdict must be one of ${KNOWN_GATE_VERDICTS.join("|")}\n`);
    process.exit(1);
  }
  const state = loadState();
  const epic = state.epics.find(e => e.id === id);
  if (!epic) { process.stderr.write(`conductor: epic '${id}' not found\n`); process.exit(1); }
  if (epic.lane !== "openspec") {
    process.stderr.write(
      `conductor: record-gate-review only applies to openspec-lane epics ` +
      `('${id}' is lane '${epic.lane}')\n`);
    process.exit(1);
  }

  epic.gateReview = epic.gateReview && typeof epic.gateReview === "object" ? epic.gateReview : {};
  const entry = { verdict, reviewedAt: new Date().toISOString() };
  if (note !== undefined) entry.note = note;
  epic.gateReview[`gate${gate}`] = entry;

  saveState(state);
  render();
  process.stderr.write(`conductor: recorded gate ${gate} review '${verdict}' for '${id}'\n`);
}
```

- [ ] **Step 2: In `scripts/conductor.mjs`, delete the `KNOWN_GATE_NUMBERS`/`KNOWN_GATE_VERDICTS`/`recordGateReview` bodies**, and add:

```javascript
import { recordGateReview } from "./lib/gate-review-writeback.mjs";
```

- [ ] **Step 3: Run the full test suite**

Run: `node --test scripts/conductor.test.mjs`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add scripts/lib/gate-review-writeback.mjs scripts/conductor.mjs
git commit -m "refactor(pm): extract lib/gate-review-writeback.mjs from conductor.mjs"
```

---

### Task 15: `lib/tracker.mjs`

**Files:**
- Create: `scripts/lib/tracker.mjs`
- Modify: `scripts/conductor.mjs` (function: `setTracker`)

**Interfaces:**
- Consumes: `isInitialized`/`loadState`/`saveState` (state), `parseFlags` (add-epic), `removeSecondaryTracker`/`upsertSecondaryTracker`/`writeRules` (rules), `render` (render.mjs)
- Produces: `setTracker()`

**⚠ Verify against real source:** `setTracker()` has grown across several tracker-related
sessions (primary + secondary tracker support, github-issues wiring). Get the exact
current body:

```bash
sed -n '/^function setTracker/,/^\/\/ ---------- lane routing/p' scripts/conductor.mjs | head -n -2 > /tmp/tracker.txt
```

- [ ] **Step 1: Create `scripts/lib/tracker.mjs`** with this header, then the verbatim
content of `/tmp/tracker.txt` (add `export` before `function setTracker`):

```javascript
// scripts/lib/tracker.mjs
// The set-tracker verb: configures primary/secondary external-tracker mirroring.
// One-directional dependency on lib/rules.mjs's writeRules() -- see the design doc's
// corrected circular-imports section (this is NOT circular).

import { isInitialized, loadState, saveState } from "./state.mjs";
import { parseFlags } from "./add-epic.mjs";
import { removeSecondaryTracker, upsertSecondaryTracker, writeRules } from "./rules.mjs";
import { render } from "./render.mjs";

// PASTE THE VERBATIM CONTENT OF /tmp/tracker.txt HERE, with `export ` prepended to
// `function setTracker`.
```

- [ ] **Step 2: In `scripts/conductor.mjs`, delete the `setTracker` body**, and add:

```javascript
import { setTracker } from "./lib/tracker.mjs";
```

- [ ] **Step 3: Run the full test suite**

Run: `node --test scripts/conductor.test.mjs`
Expected: all tests pass, including every tracker-related test (primary/secondary, github-issues, jira).

- [ ] **Step 4: Commit**

```bash
git add scripts/lib/tracker.mjs scripts/conductor.mjs
git commit -m "refactor(pm): extract lib/tracker.mjs from conductor.mjs"
```

---

### Task 16: `lib/lane-routing.mjs`

**Files:**
- Create: `scripts/lib/lane-routing.mjs`
- Modify: `scripts/conductor.mjs` (functions: `laneMatchTest`, `setLaneRouting`, `suggestLane`)

**Interfaces:**
- Consumes: `isInitialized`/`loadState`/`saveState` (state), `parseFlags` (add-epic), `render` (render.mjs)
- Produces: `laneMatchTest(match, text)`, `setLaneRouting()`, `suggestLane()`

- [ ] **Step 1: Create `scripts/lib/lane-routing.mjs`**

```javascript
// scripts/lib/lane-routing.mjs
// Per-repo lane-assignment override rules (keyword/glob), checked before the generic
// lane heuristic. One-directional dependencies only.

import { isInitialized, loadState, saveState } from "./state.mjs";
import { parseFlags } from "./add-epic.mjs";
import { render } from "./render.mjs";

export function laneMatchTest(match, text) {
  const hay = String(text).toLowerCase();
  if (match.includes("*")) {
    // glob-style: split on '*', escape each literal segment, join with '.*', and
    // search (not full-anchor) so "billing-*" matches inside "billing-refund-flow".
    const pattern = match.split("*").map(seg =>
      seg.toLowerCase().replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    ).join(".*");
    return new RegExp(pattern, "i").test(hay);
  }
  return hay.includes(match.toLowerCase());
}

/** `set-lane-routing --add "<match>:<lane>" [--add ...] | --remove "<match>" | --clear`
 *  Writes/edits the optional `laneRouting.overrides` list. */
export function setLaneRouting() {
  // Get the exact current body -- not reproduced here, verify against source:
  // sed -n '/^function setLaneRouting/,/^function suggestLane/p' scripts/conductor.mjs
}

export function suggestLane() {
  // Get the exact current body -- not reproduced here, verify against source:
  // sed -n '/^function suggestLane/,/^\/\/ ---------- review mode/p' scripts/conductor.mjs
}
```

**⚠ This task's `setLaneRouting`/`suggestLane` bodies are intentionally left as a
verify-against-source instruction, not a guess** — get them with:

```bash
sed -n '/^function setLaneRouting/,/^\/\/ ---------- review mode/p' scripts/conductor.mjs | head -n -2
```

Paste that exact output in place of the two placeholder function bodies above, adding
`export` before each `function` keyword.

- [ ] **Step 2: In `scripts/conductor.mjs`, delete the `laneMatchTest`/`setLaneRouting`/`suggestLane` bodies**, and add:

```javascript
import { laneMatchTest, setLaneRouting, suggestLane } from "./lib/lane-routing.mjs";
```

- [ ] **Step 3: Run the full test suite**

Run: `node --test scripts/conductor.test.mjs`
Expected: all tests pass, including lane-routing tests.

- [ ] **Step 4: Commit**

```bash
git add scripts/lib/lane-routing.mjs scripts/conductor.mjs
git commit -m "refactor(pm): extract lib/lane-routing.mjs from conductor.mjs"
```

---

### Task 17: `lib/review-mode.mjs`

**Files:**
- Create: `scripts/lib/review-mode.mjs`
- Modify: `scripts/conductor.mjs` (function: `setReviewMode`)

**Interfaces:**
- Consumes: `isInitialized`/`loadState`/`saveState` (state), `parseFlags` (add-epic), `writeRules` (rules), `render` (render.mjs)
- Produces: `setReviewMode()`

- [ ] **Step 1: Get the exact current body**

```bash
sed -n '/^function setReviewMode/,/^\/\/ ---------- gate guard/p' scripts/conductor.mjs | head -n -2 > /tmp/review-mode.txt
```

- [ ] **Step 2: Create `scripts/lib/review-mode.mjs`** with this header, then the verbatim
content from Step 1 (add `export` before `function setReviewMode`):

```javascript
// scripts/lib/review-mode.mjs
// The set-review-mode verb: the repo-global review-intensity dial. One-directional
// dependency on lib/rules.mjs's writeRules() -- NOT circular, see the design doc.

import { isInitialized, loadState, saveState } from "./state.mjs";
import { parseFlags } from "./add-epic.mjs";
import { writeRules } from "./rules.mjs";
import { render } from "./render.mjs";

// PASTE THE VERBATIM CONTENT FROM STEP 1 HERE, with `export ` prepended to
// `function setReviewMode`.
```

- [ ] **Step 3: In `scripts/conductor.mjs`, delete the `setReviewMode` body**, and add:

```javascript
import { setReviewMode } from "./lib/review-mode.mjs";
```

- [ ] **Step 4: Run the full test suite**

Run: `node --test scripts/conductor.test.mjs`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/review-mode.mjs scripts/conductor.mjs
git commit -m "refactor(pm): extract lib/review-mode.mjs from conductor.mjs"
```

---

### Task 18: `lib/gate-guard.mjs`

**Files:**
- Create: `scripts/lib/gate-guard.mjs`
- Modify: `scripts/conductor.mjs` (functions: `setGateGuard`, `gateGuardCheck`)

**Interfaces:**
- Consumes: `isInitialized`/`loadState`/`saveState`/`readStdin` (state), `reconcileArchived` (epic-progress), `render` (render.mjs), `upgrade` (migrations — check: does `gateGuardCheck` really call `upgrade()`? Per the verified call graph, this was a FALSE POSITIVE from the earlier unfiltered pass — the real `gateGuardCheck` only calls `isInitialized`, `loadState`, `readStdin`. Do NOT import `upgrade` here.)
- Produces: `setGateGuard()`, `gateGuardCheck()`

- [ ] **Step 1: Create `scripts/lib/gate-guard.mjs`**

```javascript
// scripts/lib/gate-guard.mjs
// The optional opt-in PreToolUse guard that blocks writes while a reconcile is owed.
// One-directional dependencies only.

import { isInitialized, loadState, saveState, readStdin } from "./state.mjs";
import { reconcileArchived } from "./epic-progress.mjs";
import { render } from "./render.mjs";

export function setGateGuard() {
  // Get the exact current body -- verify against source, do not guess:
  // sed -n '/^function setGateGuard/,/^function gateGuardCheck/p' scripts/conductor.mjs
}

export function gateGuardCheck() {
  if (!isInitialized()) return;         // DORMANT until /pm:init
  readStdin();                          // drain, unused — this check needs no tool_input
  const state = loadState();
  const active = state.active ? state.epics.find(e => e.id === state.active) : null;
  if (active && active.reconcileNeeded) {
    process.stderr.write(
      `conductor: gate guard — '${active.id}' still owes a reconcile (a detour touched shared ` +
      "code). Run the reconcile gate (reconciler agent, per the conductor skill's POP protocol) " +
      "before writing source. Turn the guard off with `set-gate-guard off` if you need to bypass.\n"
    );
    process.exit(2);
  }
}
```

- [ ] **Step 2: Fill in the actual `setGateGuard()` body**

```bash
sed -n '/^function setGateGuard/,/^function gateGuardCheck/p' scripts/conductor.mjs | head -n -1
```

Paste that exact output in place of the placeholder, adding `export` before `function setGateGuard`.

- [ ] **Step 3: In `scripts/conductor.mjs`, delete the `setGateGuard`/`gateGuardCheck` bodies**, and add:

```javascript
import { setGateGuard, gateGuardCheck } from "./lib/gate-guard.mjs";
```

- [ ] **Step 4: Run the full test suite**

Run: `node --test scripts/conductor.test.mjs`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/gate-guard.mjs scripts/conductor.mjs
git commit -m "refactor(pm): extract lib/gate-guard.mjs from conductor.mjs"
```

---

### Task 19: `lib/migrations.mjs`

**Files:**
- Create: `scripts/lib/migrations.mjs`
- Modify: `scripts/conductor.mjs` (function: `upgrade`; local const `MIGRATIONS`)

**Interfaces:**
- Consumes: `isInitialized`/`loadState`/`saveState` (state), `pluginVersion`/`newestInstalledVersion`/`cmpVer`/`changelogBetween`/`stampVersion` (plugin-meta), `reconcileArchived` (epic-progress), `writeRules` (rules), `render` (render.mjs), `normalizeLink` (links)
- Produces: `upgrade()`

- [ ] **Step 1: Create `scripts/lib/migrations.mjs`**

```javascript
// scripts/lib/migrations.mjs
// APPEND-ONLY schema migrations, keyed by the release that introduced each change, and
// the /pm:upgrade verb that applies them. One-directional dependencies only.

import { isInitialized, loadState, saveState } from "./state.mjs";
import { pluginVersion, newestInstalledVersion, cmpVer, changelogBetween, stampVersion } from "./plugin-meta.mjs";
import { reconcileArchived } from "./epic-progress.mjs";
import { writeRules } from "./rules.mjs";
import { render } from "./render.mjs";
import { normalizeLink } from "./links.mjs";

// MIGRATIONS — APPEND-ONLY, each keyed by the release that introduced the change.
// NEVER remove or reorder a shipped entry: a repo many versions behind replays every
// entry whose release > its stamped version. upgrade() applies them SORTED by release,
// so a multi-version jump (e.g. 0.2.0 → 0.5.x) runs them in the correct order regardless
// of array position. Each apply() must be additive, idempotent, and backward-compatible.
const MIGRATIONS = [
  {
    release: "0.3.0",
    note: "stamp explicit lane on epics (lane-agnostic schema)",
    apply(state) {
      for (const e of state.epics) if (!e.lane) e.lane = "openspec";
    },
  },
  {
    release: "0.5.0",
    note: "normalize links (repair colon-strings, drop unrecoverable)",
    apply(state) {
      for (const e of state.epics) {
        e.links = (Array.isArray(e.links) ? e.links : []).map(normalizeLink).filter(Boolean);
      }
    },
  },
];

export function upgrade() {
  if (!isInitialized()) { process.stderr.write("conductor: run /pm:init first\n"); process.exit(1); }
  const running = pluginVersion();
  const newest = newestInstalledVersion();
  if (running && newest && cmpVer(newest, running) > 0) {
    process.stderr.write(
      `conductor: this is pm ${running}, but ${newest} is installed — your session is still ` +
      `running the old engine.\n` +
      `Run /reload-plugins (or restart Claude Code), then /pm:upgrade again.\n` +
      `(Running the engine directly from a checkout? Set PM_CACHE_ROOT to override.)\n`);
    process.exit(1);
  }
  const state = loadState();
  const stamped = state.pmVersion || "0.0.0";
  let applied = 0;
  const ordered = [...MIGRATIONS].sort((a, b) => cmpVer(a.release, b.release));
  for (const m of ordered) {
    if (cmpVer(m.release, stamped) > 0) { m.apply(state); applied++; }
  }
  reconcileArchived(state);
  stampVersion(state);
  saveState(state);
  writeRules();
  render();
  process.stderr.write(`conductor: upgraded (${applied} migration(s)), pmVersion now ${state.pmVersion || "unknown"}\n`);

  const delta = changelogBetween(stamped, state.pmVersion || null);
  if (delta && delta.length) {
    process.stdout.write(
      `What's new in pm (since ${stamped}):\n\n` + delta.map(s => s.body).join("\n\n") + "\n");
  }
}
```

**⚠ MIGRATIONS array note:** this is APPEND-ONLY per its own comment — check the real
current source for any migration entries added since this design/plan was written (search
`grep -n "release:" scripts/conductor.mjs` before extracting) and include ALL of them, in
the same order, not just the two shown above.

- [ ] **Step 2: In `scripts/conductor.mjs`, delete the `MIGRATIONS`/`upgrade` bodies**, and add:

```javascript
import { upgrade } from "./lib/migrations.mjs";
```

- [ ] **Step 3: Run the full test suite**

Run: `node --test scripts/conductor.test.mjs`
Expected: all tests pass, including every migration/upgrade test.

- [ ] **Step 4: Commit**

```bash
git add scripts/lib/migrations.mjs scripts/conductor.mjs
git commit -m "refactor(pm): extract lib/migrations.mjs from conductor.mjs"
```

---

### Task 20: `lib/changelog.mjs`

**Files:**
- Create: `scripts/lib/changelog.mjs`
- Modify: `scripts/conductor.mjs` (function: `changelog`)

**Interfaces:**
- Consumes: `changelogBetween` (plugin-meta), `isInitialized`/`loadState` (state), `parseFlags` (add-epic)
- Produces: `changelog()`

- [ ] **Step 1: Create `scripts/lib/changelog.mjs`**

```javascript
// scripts/lib/changelog.mjs
// The /pm:changelog CLI verb -- an on-demand companion to the delta upgrade() prints
// automatically. One-directional dependencies only.

import { changelogBetween } from "./plugin-meta.mjs";
import { isInitialized, loadState } from "./state.mjs";
import { parseFlags } from "./add-epic.mjs";

/** Show CHANGELOG entries newer than a version. `--since <x.y.z>` overrides the
 *  default, which is the version stamped in this repo's state.json. */
export function changelog() {
  const f = parseFlags(process.argv.slice(3));
  const since = typeof f.since === "string"
    ? f.since
    : (isInitialized() ? (loadState().pmVersion || null) : null);
  const secs = changelogBetween(since, null);
  if (secs === null) {
    process.stdout.write("conductor: no CHANGELOG.md ships with this pm version\n"); return;
  }
  if (!secs.length) {
    process.stdout.write(`conductor: no changelog entries newer than ${since || "(start)"}\n`); return;
  }
  process.stdout.write(secs.map(s => s.body).join("\n\n") + "\n");
}
```

- [ ] **Step 2: In `scripts/conductor.mjs`, delete the `changelog` function body**, and add:

```javascript
import { changelog } from "./lib/changelog.mjs";
```

**⚠ Naming collision to watch for:** `conductor.mjs`'s dispatch table has a key literally
named `changelog`. Make sure the import name `changelog` (the function) doesn't collide
with anything else already in scope in `conductor.mjs` at this point — it shouldn't, since
this is the only place that name is used, but double check with `node --check
scripts/conductor.mjs` after this edit.

- [ ] **Step 3: Run the full test suite**

Run: `node --test scripts/conductor.test.mjs`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add scripts/lib/changelog.mjs scripts/conductor.mjs
git commit -m "refactor(pm): extract lib/changelog.mjs from conductor.mjs"
```

---

### Task 21: `lib/worktree-hygiene.mjs`

**Files:**
- Create: `scripts/lib/worktree-hygiene.mjs`
- Modify: `scripts/conductor.mjs` (functions: `verifyWorktrees`, `isAncestorOfCurrentHead`, `changesets`, `verifyState`)

**Interfaces:**
- Consumes: `isInitialized`/`loadState`/`readJSON` (state), `render` (render.mjs), `writeRenderStamp` (render.mjs), `ROOT`/`RENDER_STAMP_PATH`/`STATE_PATH` (constants)
- Produces: `verifyWorktrees()`, `changesets()`, `verifyState()`

**Correction from the design doc's Task ordering:** the verified call graph for
`verifyState()` shows it depends ONLY on `isInitialized` and `readJSON` — an earlier,
buggy pass of the call-graph analysis attributed a dozen extra false-positive
dependencies to it (from a range-overrun bug that let its body-scan bleed into the entire
dispatch table below it). Do not import `currentReviewMode`/`currentSecondaryTrackers`/
`currentTracker`/`parseFlags`/`pluginVersion`/`rulesBlock`/`sync` into this file — none of
them are actually used by `verifyState()`.

- [ ] **Step 1: Get the exact current body**

```bash
sed -n '/^\/\/ ---------- worktree hygiene/,/^\/\/ ---------- dispatch/p' scripts/conductor.mjs | head -n -2 > /tmp/worktree-hygiene.txt
```

- [ ] **Step 2: Create `scripts/lib/worktree-hygiene.mjs`** with this header, then the
verbatim content of `/tmp/worktree-hygiene.txt` from Step 1 (add `export` before each of
`function verifyWorktrees`, `function isAncestorOfCurrentHead` — note this one is NOT
exported in the design's interface list since it's a private helper only used within this
file, but exporting it is harmless — `function changesets`, `function verifyState`):

```javascript
// scripts/lib/worktree-hygiene.mjs
// Cross-references git worktree list against epic status to flag orphaned
// hierarchy-child worktrees; lists .changesets/*.md fragments; verifies state.json
// hasn't been hand-edited outside the render pipeline. One-directional dependencies only.

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { isInitialized, loadState, readJSON } from "./state.mjs";
import { render, writeRenderStamp } from "./render.mjs";
import { ROOT, RENDER_STAMP_PATH, STATE_PATH } from "./constants.mjs";

// PASTE THE VERBATIM CONTENT OF /tmp/worktree-hygiene.txt HERE, with `export ` prepended
// to `function verifyWorktrees`, `function isAncestorOfCurrentHead`, `function changesets`,
// and `function verifyState`.
```

- [ ] **Step 3: In `scripts/conductor.mjs`, delete the whole "worktree hygiene" section**, and add:

```javascript
import { verifyWorktrees, changesets, verifyState } from "./lib/worktree-hygiene.mjs";
```

- [ ] **Step 4: Run the full test suite**

Run: `node --test scripts/conductor.test.mjs`
Expected: all tests pass, including `verify-worktrees`, `changesets`, and `verify-state` tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/worktree-hygiene.mjs scripts/conductor.mjs
git commit -m "refactor(pm): extract lib/worktree-hygiene.mjs from conductor.mjs

Corrects an earlier call-graph analysis bug: verifyState() only ever
depended on isInitialized/readJSON, not the dozen extra functions a
buggy body-range calculation had attributed to it."
```

---

### Task 22: Final entry-point cleanup and verification

**Files:**
- Modify: `scripts/conductor.mjs` (final pass — should now contain ONLY: the shebang/header
  comment, the 6 `node:*` imports, ~25 `import { ... } from "./lib/*.mjs";` lines, the
  dispatch section (`const cmd = ...`, `showEngineBanner` logic, the dispatch table
  object, the usage-string fallback))

**Interfaces:**
- Consumes: every named export from all 25 `lib/*.mjs` modules
- Produces: nothing new — this is verification only

- [ ] **Step 1: Confirm `scripts/conductor.mjs` has no remaining function/const definitions
outside the dispatch section**

```bash
grep -n "^function \|^async function \|^const [A-Z_]* = \[" scripts/conductor.mjs
```

Expected: no output (or only `const cmd = process.argv[2];` / `const showEngineBanner =
...` from the dispatch section, which stay in the entry point by design).

- [ ] **Step 2: Confirm every file is syntactically valid**

```bash
for f in scripts/conductor.mjs scripts/lib/*.mjs; do
  node --check "$f" || echo "SYNTAX ERROR: $f"
done
```

Expected: no `SYNTAX ERROR` lines.

- [ ] **Step 3: Confirm no lib file imports from `../conductor.mjs`** (a sign that
something was extracted before its dependency existed, and a temporary/leftover
cross-import was never cleaned up)

```bash
grep -rn "from \"\.\./conductor" scripts/lib/ || echo "clean"
```

Expected: `clean`.

- [ ] **Step 4: Run the full test suite one final time**

Run: `node --test scripts/conductor.test.mjs`
Expected: all tests pass — same count as the pre-refactor baseline (record this number
before Task 1 and compare here).

- [ ] **Step 5: Run the actual CLI end-to-end as a smoke test, not just the test suite**

```bash
cd /tmp && rm -rf pm-split-smoketest && mkdir pm-split-smoketest && cd pm-split-smoketest
node /Users/robsherman/Documents/Repos/pm/scripts/conductor.mjs init
cat PROJECT.md | head -20
node /Users/robsherman/Documents/Repos/pm/scripts/conductor.mjs add-epic --id smoke-test --lane claude-code --title "Smoke test epic"
node /Users/robsherman/Documents/Repos/pm/scripts/conductor.mjs render
node /Users/robsherman/Documents/Repos/pm/scripts/conductor.mjs update-epic smoke-test --priority P1
node /Users/robsherman/Documents/Repos/pm/scripts/conductor.mjs status 2>&1 || true
cd / && rm -rf /tmp/pm-split-smoketest
```

Expected: `init` scaffolds successfully, `PROJECT.md` renders with real content,
`add-epic`/`update-epic` succeed without error. This exercises the render cluster
(Task 8) end-to-end outside the test harness, in a real directory.

- [ ] **Step 6: Commit any final cleanup**

```bash
git add -A
git commit -m "refactor(pm): final cleanup pass after conductor.mjs module split

conductor.mjs is now a thin entry point: node:* imports, ~25 lib/*.mjs
imports, and the dispatch table. All 85 functions live in
scripts/lib/*.mjs, one module per original comment section (helpers
split into 6 cohesive modules; render/briefing/active-pointer/autonomy/
add-epic extracted together as a verified circular cluster)."
```

---

## Self-review notes (from writing this plan)

**Spec coverage:** every module in the design doc's table has a corresponding task above.
The design doc's `getAutonomy` merge into `autonomy.mjs` is Task 8. The path-depth gotcha
for `pluginRoot()` is called out explicitly in Task 6. The corrected circular-import
finding (not `rules.mjs`↔`tracker.mjs`, but the real
`render`/`briefing`/`active-pointer`/`autonomy`/`add-epic` cluster) drove both a design-doc
correction and Task 8's five-file combined scope.

**Known gaps, deliberately left as "verify against source" rather than a guessed
reproduction:** `writeRules()`'s exact body (Task 7), `subcommands.mjs`'s
`headChangedFiles`/`looksLikeUnloggedMinimalDetour`/`commitNudge`/`sync`/
`honchoMemoryLine`/`honchoMemory` bodies (Task 9), `updateEpic()`'s full body (Task 11),
`setTracker()`'s full body (Task 15), `setLaneRouting()`/`suggestLane()` (Task 16),
`setReviewMode()` (Task 17), `setGateGuard()` (Task 18). These are large, frequently-changed
functions where retyping from memory risks silently reverting a recent fix — each task
gives the exact `sed` command to pull the real current source instead. This is a
deliberate choice, not a placeholder: the instruction ("run this exact command, paste its
exact output, add `export`") is complete and unambiguous, and safer than a plan-author's
reproduction of code that has changed hands multiple times this session.

**Task ordering fix folded in:** Task 11 originally assumed `epicSummaryTable` belonged
with `updateEpic`; call-graph verification placed it in the "remove-epic" section instead
(Task 12) — corrected inline in both tasks. Task 11 also depends on Task 14
(`gate-review-writeback.mjs`) for `recordGateReview` — flagged explicitly with a
recommended reorder.

**Type/name consistency check:** every function name used in a later task's imports
matches the exact name it's exported under in its producing task (verified by re-reading
each Interfaces block against its Produces list). No renames occurred during extraction.
