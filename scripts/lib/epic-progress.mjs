// scripts/lib/epic-progress.mjs
// Epic progress/resolution: merging state.json metadata with what's actually on disk
// (openspec changes, plan files), dependency-aware queue ordering, and archive-drift
// healing. Depends only on lib/constants.mjs.

import fs from "node:fs";
import path from "node:path";
import { ROOT, CHANGES_DIR, ARCHIVE_DIR, PLANS_DIR, laneRank, isOpenspecLane } from "./constants.mjs";
import { engineStamp, isArchiveBackfilled, isStoryDisposed } from "./disposition.mjs";
import { effectivePriorityOf, priorityRank } from "./dependency-order.mjs";

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

/** THE normalization every archive-identity question goes through: a change archived as
 *  `<YYYY-MM-DD>-<id>` and one archived as `<id>` are the same change.
 *
 *  Exported rather than repeated because three separate questions ask it — does this epic's
 *  change sit in the archive (`isArchived`), does this archive directory already have an epic
 *  (the backfill), and are two epics the same change under different lanes (the integrity
 *  check). Literal equality answers all three wrongly: measured on this repository, ZERO ids
 *  collide literally while four changes are registered twice. */
export const strippedChangeId = (name) => String(name).replace(/^\d{4}-\d{2}-\d{2}-/, "");

/** Every directory under `openspec/changes/archive/`, as `{dir, id}` — `dir` as it sits on
 *  disk, `id` normalized.
 *
 *  `dir` defaults to the process-wide ARCHIVE_DIR, which is resolved once at module load from
 *  `CLAUDE_PROJECT_DIR || cwd`. The parameter exists so a caller that already knows the repo
 *  root can pass it (cross-spec-review.mjs enumerates a release's specs under a root a test may
 *  supply) — WITHOUT that caller re-deriving the date-prefix naming rule, which is the one thing
 *  a second archive reader must never do. */
export function archivedChanges(dir = ARCHIVE_DIR) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => ({ dir: d.name, id: strippedChangeId(d.name) }));
  } catch { return []; }
}

/** Where an archived change's task source actually sits, or a path that does not exist.
 *
 *  `CHANGES_DIR/<id>/tasks.md` cannot exist once a change is archived — openspec MOVES the
 *  directory — so a consumer that needs the counts has to look where the file went. Both archive
 *  namings are tried, the same two `isArchived()` matches. */
export function archivedTasksPath(id) {
  const exact = path.join(ARCHIVE_DIR, id, "tasks.md");
  if (fs.existsSync(exact)) return exact;
  const hit = archivedChanges().find(c => c.id === strippedChangeId(id));
  return hit ? path.join(ARCHIVE_DIR, hit.dir, "tasks.md") : exact;
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
    if (e.status !== "archived" && isArchived(e.id)) {
      e.status = "archived";
      // ONE record for the transition, whose TWO HALVES BIND DIFFERENT SETS OF EPICS. Written
      // together on purpose: two independent writes are exactly what produces an epic carrying
      // the bypass and not the outcome.
      //
      // The DISPOSITION half binds EVERY LANE — the outcome invariant admits no lane
      // exception, and this function reaches epics of every lane (65 of this repository's 68
      // archived epics are not openspec-lane). `recordedBy` is a FIELD, not prose in the
      // reason: a consumer keys on data, never on parsing a path name out of free text.
      if (!e.disposition) e.disposition = engineStamp("archive-drift-heal");
      // The BYPASS half binds OPENSPEC-LANE EPICS ONLY, through isOpenspecLane so a lane-less
      // epic — openspec-lane on every other surface — gets the record its rendering says it
      // owes. `record-gate-review` refuses a verdict to any other lane, so an `ungated` entry
      // on a claude-code or superpowers epic would be a standing condition with NO clearing
      // path in the engine at all. No `reviewer` field: that carries an identity, and an audit
      // query over reviewers must never pick up path names.
      if (isOpenspecLane(e) && !(e.gateReview && e.gateReview.gate2)) {
        e.gateReview = e.gateReview && typeof e.gateReview === "object" ? e.gateReview : {};
        e.gateReview.gate2 = {
          verdict: "ungated", reviewedAt: new Date().toISOString(), recordedBy: "archive-drift-heal",
        };
      }
      changed = true;
    }
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
    // A DISPOSED story leaves BOTH sides of the ratio, exactly as a `<!-- pm:lifecycle -->`
    // task does in countCheckboxes() (which `continue`s before `total++`). Three renderings
    // were possible and two of them are wrong: counting a dropped story as `done` would claim
    // completion for work nobody did, and counting it as outstanding would leave the archive
    // gate refusing forever with no honest key. Excluding it says what happened — the work is
    // not outstanding AND was not delivered — and the reason stays on the row either way.
    const counted = epic.stories.filter(s => s && !isStoryDisposed(s));
    const excluded = epic.stories.length - counted.length;
    const total = counted.length;
    const done = counted.filter(s => s.done).length;
    // `excludedLabel` exists because bar() would otherwise call these "lifecycle", which is a
    // different declaration made by a different mechanism in a different place.
    return { done, total, excluded, excludedLabel: "disposed", source: "stories", warn: null };
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
      // A BACKFILLED epic reads its counts from the archived artifacts. It never passed through
      // the conductor while it was in flight, so `0/0` here is not "a managed epic whose source
      // legitimately moved" — it is the evidence being discarded at the moment it is registered.
      // A change archived with 12 of its tasks unticked is the most informative row in an audit,
      // and preserving the row while throwing away the counts preserves nothing.
      //
      // Deliberately SCOPED to the backfill rather than applied to every archived epic.
      // `archiveGate()` documents that outstanding work "reads zero for an archived epic whose
      // source is gone" and the interactive verb's handoff demand rests on that; reading archived
      // artifacts for every archived epic would move a quantity out from under a gate written
      // against it. The stamp is exactly what the spec says it is for — telling a record
      // reconstructed from disk apart from one the conductor managed.
      const a = isArchiveBackfilled(epic) ? countCheckboxes(archivedTasksPath(epic.id)) : { exists: false };
      if (a.exists) return { done: a.done, total: a.total, excluded: a.excluded, source: "openspec", warn: null };
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

/** An epic's MANUAL RANK as a sort key — placement among equals within one priority band.
 *  Unranked (absent, non-integer, or non-positive) is Infinity, so it sorts AFTER every ranked
 *  epic in its band rather than before it: a newly registered epic must not jump a deliberately
 *  ordered prefix just because its id happens to sort first, and an unranked record orders
 *  exactly as it did before rank existed.
 *
 *  Defined here rather than in lib/rank.mjs — which owns the WRITE side, the `reorder` verb and
 *  the invariant's full statement — so the key and the comparator that consumes it sit in one
 *  file and cannot drift apart. rank.mjs is also a leaf on the render path, and importing it
 *  here would close a cycle. */
export const rankOf = (e) => (Number.isInteger(e && e.rank) && e.rank > 0 ? e.rank : Infinity);

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
  // EFFECTIVE priority, attached here and nowhere else. resolveEpics() is the ONE place the
  // whole record is assembled, and it has exactly two consumers — render() and buildBrief() —
  // so computing the closure here is what stops PROJECT.md and the brief from being able to
  // disagree about what outranks what. It is attached to the RESOLVED copy (`{...meta}`), never
  // to `state.epics`, so nothing reaches state.json: the merit priority stays the only stored
  // one, and the derived one cannot go stale. See lib/dependency-order.mjs.
  const eff = effectivePriorityOf(out);
  for (const e of out) e.effectivePriority = eff.get(e.id) || e.priority;
  out.sort((a, b) =>
    // Dependencies first (as inherited priority), MERIT second — so a lifted blocker leads the
    // band it was pulled into, while two epics with the same effective priority still order by
    // what they are worth on their own. With no depends-on edges in the record the first key is
    // a no-op and this is byte-for-byte the previous ordering.
    (priorityRank(a.effectivePriority) - priorityRank(b.effectivePriority)) ||
    (priorityRank(a.priority) - priorityRank(b.priority)) ||
    // MANUAL RANK, and it sits here — after both priorities, before lane. A human's explicit
    // placement among equals should beat a mechanical lane heuristic; it must never beat a
    // dependency or a priority, which is what putting it any higher would do. Unranked is
    // Infinity, so with nothing ranked this key is a no-op and the ordering is unchanged.
    (rankOf(a) - rankOf(b)) ||
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
 *  `sorted` is a list in resolveEpics()'s order — effective priority, then merit priority, then
 *  manual rank, then lane, then id — already filtered to queued/untriaged + not-missing.
 *  Returns `{ ordered, notes }`.
 *
 *  This pass is DEPENDENCY-AWARE ONLY WITHIN THE SET IT IS HANDED, which is queued/untriaged.
 *  An edge pointing at any other status is invisible here BY CONSTRUCTION and is the province
 *  of lib/dependency-order.mjs — effective priority (which reorders the whole record) and
 *  `dependencyNotes()` (which names the inversion). Do not widen this function's input to fix
 *  that: `planned`/`later` epics staying out of NEXT UP is a deliberate membership contract
 *  with tests behind it. */
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
  // a denominator that moved from 13 to 12 looks like a task went missing. `excludedLabel`
  // names WHICH declaration removed them: a checkbox source says "lifecycle" (the
  // `<!-- pm:lifecycle -->` marker) and an inline story says "disposed" (a recorded --wont-do).
  // Defaulted here rather than required, so a progress object built before this field existed
  // renders exactly as it always did.
  const lifecycle = p.excluded ? ` · ${p.excluded} ${p.excludedLabel || "lifecycle"}` : "";
  if (p.total > 0) return `${p.done}/${p.total} ${p.source === "plan" ? "tasks" : "stories"}${lifecycle}`;
  return p.excluded ? `0/0${lifecycle}` : "—";
}
