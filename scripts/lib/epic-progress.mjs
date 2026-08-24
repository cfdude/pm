// scripts/lib/epic-progress.mjs
// Epic progress/resolution: merging state.json metadata with what's actually on disk
// (openspec changes, plan files), dependency-aware queue ordering, and archive-drift
// healing. Depends only on lib/constants.mjs.

import fs from "node:fs";
import path from "node:path";
import { ROOT, CHANGES_DIR, ARCHIVE_DIR, PLANS_DIR, laneRank, isOpenspecLane } from "./constants.mjs";

/** Active openspec change ids = subdirs of openspec/changes except `archive`. */
export function activeChangeIds() {
  try {
    return fs.readdirSync(CHANGES_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name !== "archive")
      .map(d => d.name);
  } catch { return []; }
}

/** Markdown files in PLANS_DIR that are actually PLANS.
 *
 *  A directory's own index file is not a plan. `README.md` (and the `INDEX`/`CONTRIBUTING`
 *  variants that show up beside it) documents what the directory is FOR, so registering it
 *  produces an epic titled after that file's H1 — observed live as an untriaged epic called
 *  "Superpowers Plans — Active". Excluded by NAME rather than by content: reading inside the
 *  file to decide would make registration depend on heading conventions, which is the
 *  fragility this whole surface already suffers from. */
const PLAN_INDEX_FILES = new Set(["readme.md", "index.md", "contributing.md"]);

export function planFiles() {
  try {
    return fs.readdirSync(PLANS_DIR, { withFileTypes: true })
      .filter(d => d.isFile() && d.name.endsWith(".md"))
      .filter(d => !PLAN_INDEX_FILES.has(d.name.toLowerCase()))
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

/** The one literal that declares a task to be lifecycle bookkeeping rather than delivery.
 *  Chosen so it renders invisibly in markdown and so a test binds to it exactly.
 *
 *  THE JUDGMENT IS THE AGENT'S. The engine excludes exactly the tasks whose OWN LINE carries
 *  this literal, and infers exclusion from nothing else — not a task's wording, not the
 *  commands its text names, not its position in the file, not a marker on a following line.
 *
 *  The error direction is the whole argument. An undeclared bookkeeping task keeps counting as
 *  outstanding, which is today's behavior and is visible in the rendered record. A text
 *  matcher fails the other way: it cannot tell `run /opsx:archive <this change>` from a real
 *  task that implements archiving, and a false exclusion silently under-reports outstanding
 *  work — the exact over-reporting of completion this release exists to correct.
 *
 *  PLAN_INDEX_FILES above is this file's own precedent: it excludes against an enumerable
 *  literal precisely to avoid reading inside a file to decide what it means. */
export const LIFECYCLE_MARKER = "<!-- pm:lifecycle -->";

/** Count [ ] / [x] checkboxes in a markdown file, excluding declared lifecycle bookkeeping.
 *
 *  An excluded task leaves BOTH the numerator and the denominator — `12/13` where the
 *  thirteenth is a declared archive instruction becomes `12/12`, never `12/13` with a hidden
 *  adjustment — so an epic's rendered progress and its outstanding-work count can never
 *  disagree. `excluded` is reported so a caller can say how many were left out.
 *
 *  Exclusion does NOT depend on the checkbox state: a marked task is out whether ticked or
 *  not. Depending on it would move the count at the instant the marked task is ticked, which
 *  is exactly the silent drift this definition exists to prevent. */
export function countCheckboxes(absPath) {
  let total = 0, done = 0, excluded = 0, exists = false;
  try {
    const txt = fs.readFileSync(absPath, "utf8");
    exists = true;
    for (const line of txt.split("\n")) {
      const m = line.match(/^\s*[-*]\s+\[([ xX])\]/);
      if (!m) continue;
      // A task that DOCUMENTS the marker must not be excluded by it. Found by dogfooding:
      // this change's own tasks.md names `<!-- pm:lifecycle -->` inside backticks on six task
      // lines that are real delivery work, and only one line actually declares. Counting those
      // would have under-reported outstanding work by six and made the release's own self-check
      // pass falsely. A marker inside a code span is a mention, not a declaration.
      if (line.replace(/`[^`]*`/g, "").includes(LIFECYCLE_MARKER)) { excluded++; continue; }
      total++; if (m[1].toLowerCase() === "x") done++;
    }
  } catch { /* missing file */ }
  return { done, total, excluded, exists };
}

/** Resolve an epic's progress by precedence: stories -> planPath -> openspec tasks.md -> none.
 *
 *  A missing progress SOURCE must never be reported as an em dash, because `bar()` also renders
 *  an em dash for "this epic legitimately has no source" and for "the source exists and is
 *  empty". Collapsing three states into one glyph is how a dangling pointer hides: an openspec
 *  epic whose tasks.md moved rendered exactly like a decision-lane epic that never had one.
 *  Both branches below therefore warn, and `bar()` renders `⚠ <warn>` in PROJECT.md and the brief.
 *
 *  `exists` from countCheckboxes() — never `total > 0` — is the missing-source discriminator.
 *  Excluding tasks must not collapse a real source into the no-source state: an epic whose
 *  every task carries the lifecycle marker still HAS a source, reads `0/0` legitimately, and
 *  must not warn. A `total > 0` test would fold it back into the missing case, reintroducing
 *  the three-states-into-one-glyph confusion the warning was added to end.
 *
 *  ARCHIVED epics are exempt. Archiving is precisely when a source legitimately goes away —
 *  openspec removes `changes/<id>/`, and the documented convention for finished plans is to move
 *  them out of `plans/` (which is also the mitigation for sync re-registering shipped plans).
 *  Warning there fires on correct behavior: measured on one 108-epic repo, 7 of 8 epics with a
 *  planPath dangled and ALL 7 were archived-and-moved. A warning that is wrong 7 times out of 8
 *  trains people to ignore the one time it is right. */
export function epicProgress(epic) {
  // An archived epic's source is SUPPOSED to be gone; suppress rather than cry wolf.
  const archived = epic.status === "archived";
  if (Array.isArray(epic.stories)) {
    const total = epic.stories.length;
    const done = epic.stories.filter(s => s && s.done).length;
    // Inline stories carry no task source and so no markers — `excluded` is 0, never
    // undefined, so every consumer reads the same shape whichever branch produced it.
    return { done, total, excluded: 0, source: "stories", warn: null };
  }
  if (epic.planPath) {
    const c = countCheckboxes(path.join(ROOT, epic.planPath));
    if (!c.exists) {
      return { done: 0, total: 0, excluded: 0, source: "plan", warn: archived ? null : "planPath missing" };
    }
    return { done: c.done, total: c.total, excluded: c.excluded, source: "plan", warn: null };
  }
  if ((epic.lane || "openspec") === "openspec") {
    const c = countCheckboxes(path.join(CHANGES_DIR, epic.id, "tasks.md"));
    if (!c.exists) {
      return { done: 0, total: 0, excluded: 0, source: "openspec", warn: archived ? null : "tasks.md missing" };
    }
    return { done: c.done, total: c.total, excluded: c.excluded, source: "openspec", warn: null };
  }
  return { done: 0, total: 0, excluded: 0, source: "none", warn: null };
}

/** THE definition of an epic's OUTSTANDING WORK, and the only counter. Every consumer keys on
 *  it rather than counting raw checkboxes for itself — the rendered project record, the
 *  briefing, `/pm:next`, and every guard in this release that refuses because work remains.
 *
 *  A thin reader over epicProgress() on purpose: the guard's number and the rendered bar come
 *  out of the same call, so a refusal can never cite a count the record does not show. That
 *  divergence is the defect — the archive instruction in a change's own task list is unticked
 *  at archive time by construction, and a guard counting raw checkboxes would refuse every
 *  correctly finished change. */
export function outstandingWork(epic) {
  const p = epicProgress(epic);
  return Math.max(0, p.total - p.done);
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
  return isOpenspecLane(e) && !e.present && !isArchived(e.id) &&
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

/** The ONE wording every surface uses to say what a progress figure is. Exported rather than
 *  written out three times so PROJECT.md, the brief and `/pm:next` cannot drift apart; the
 *  command document carries the same literal, and a test holds all three to it.
 *
 *  Nothing here verifies a claim — verification is the gates' job, and any consumer treating a
 *  progress figure as evidence of delivery is out of contract. */
export const CLAIMED_COMPLETION_NOTE =
  "Progress is claimed completion — ticked checkboxes, not verified delivery.";

export function bar(p) {
  if (!p) return "—";
  if (p.warn) return `⚠ ${p.warn}`;
  // Declared lifecycle bookkeeping left both sides of the ratio, so say how many — otherwise
  // a denominator that moved from 13 to 12 looks like a task went missing.
  const lifecycle = p.excluded ? ` · ${p.excluded} lifecycle` : "";
  if (p.total > 0) return `${p.done}/${p.total} ${p.source === "plan" ? "tasks" : "stories"}${lifecycle}`;
  return p.excluded ? `0/0${lifecycle}` : "—";
}
