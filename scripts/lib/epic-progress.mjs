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
      // The naive priority order already placed e ahead of its own dependency d — that's
      // exactly the starvation case this function exists to prevent, and worth flagging.
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
      // Cycle among queued epics — not fatal for a display/selection helper; keep whatever's
      // left in its original priority order rather than erroring out of a status render.
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
