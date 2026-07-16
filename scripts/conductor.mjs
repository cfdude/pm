#!/usr/bin/env node
/**
 * conductor.mjs — engine for the `pm` plugin.
 * A thin project-management layer above OpenSpec + Superpowers.
 *
 * It does NOT re-track stories. Stories live in openspec/changes/<id>/tasks.md.
 * The conductor owns three things OpenSpec doesn't:
 *   1. cross-epic ORDERING (priority + next-up pointer)
 *   2. the DETOUR STACK (what we paused, why, and what we spun up to fix it)
 *   3. epic LINKS + the RECONCILE flag (a detour can invalidate a paused parent)
 *
 * State of record:  .conductor/state.json   (structured; Claude + you edit it)
 * Human view:       PROJECT.md              (fully GENERATED — do not hand-edit)
 * Detour trail:     .conductor/detours.log  (append-only; minimal detours + detour commits)
 * Honcho memories:  .conductor/honcho-memories.log  (append-only; every honcho-memory emission)
 * Story progress:   DERIVED live from tasks.md checkboxes at render time.
 *
 * Subcommands:
 *   init           scaffold .conductor/state.json, sync, render, write CLAUDE.md rules
 *   render         regenerate PROJECT.md from state.json + live tasks.md
 *   brief          SessionStart: print additionalContext JSON (DORMANT if not init'd)
 *   snapshot       PreCompact: render + write .conductor/brief.txt (DORMANT if not init'd)
 *   commit-nudge   PostToolUse(Bash): after a git commit, log detour commits + nudge;
 *                  also auto-logs an AUTO-DETOUR entry when a small fix/chore commit's
 *                  diff shape looks like an unlogged minimal detour (see
 *                  looksLikeUnloggedMinimalDetour)
 *   sync           add any new openspec changes to state.json as "untriaged"
 *   log-detour "x" record a MINIMAL detour in detours.log (with the current git SHA)
 *   honcho-memory  <push|pop> <epicId> "<reason>" — print + log the ready-to-copy Honcho line
 *   rules          print the CLAUDE.md rules block to stdout
 *   write-rules    insert/refresh the rules block in ./CLAUDE.md (idempotent)
 *   verify-state   fail loudly if state.json's mtime is newer than the last render's stamp
 *                  (a mechanical check for an undetected hand-edit)
 *
 * No external dependencies. Node 18+. OpenSpec optional (uses the filesystem).
 *
 * The plugin's hooks run in EVERY project at user scope, so brief/snapshot/
 * commit-nudge stay silent until a project runs `/pm:init` (presence of
 * .conductor/state.json). This mirrors OpenSpec being dormant until `openspec init`.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const CONDUCTOR_DIR = path.join(ROOT, ".conductor");
const STATE_PATH = path.join(CONDUCTOR_DIR, "state.json");
const BRIEF_PATH = path.join(CONDUCTOR_DIR, "brief.txt");
const RENDER_STAMP_PATH = path.join(CONDUCTOR_DIR, "render-stamp.json");
const DETOURS_LOG = path.join(CONDUCTOR_DIR, "detours.log");
const PROJECT_MD = path.join(ROOT, "PROJECT.md");
const CLAUDE_MD = path.join(ROOT, "CLAUDE.md");
const CHANGES_DIR = path.join(ROOT, "openspec", "changes");
const ARCHIVE_DIR = path.join(CHANGES_DIR, "archive");
const PLANS_DIR = path.join(ROOT, "docs", "superpowers", "plans");
const KNOWN_LANES = ["openspec", "superpowers", "claude-code", "decision", "external"];
const KNOWN_STATUSES = ["untriaged", "queued", "active", "paused", "later", "blocked", "planned", "archived"];
const KNOWN_AUTONOMY_LEVELS = ["off", "autonomous"];
// Default category taxonomy for the `--preauthorize "category:<name>:<reason>"` shorthand —
// see the `conductor` skill's "Epic-level autonomy" section for the matching heuristic each
// category expands to at decision-rule time. Additive-only convention: adding a category here
// is not a breaking change for existing preAuthorized entries.
const KNOWN_PREAUTHORIZE_CATEGORIES = ["filesystem", "network", "schema", "external-api"];
const KNOWN_REVIEW_MODES = ["off", "standard", "thorough"];
/** Rank used to compare review modes so an epic-level override can only ESCALATE above the
 *  repo-global dial, never de-escalate below it — see currentReviewMode(epicId). */
const REVIEW_MODE_RANK = { off: 0, standard: 1, thorough: 2 };
const LANE_RANK = { openspec: 0, superpowers: 1, "claude-code": 2, decision: 3, external: 4 };
const laneRank = (l) => (l in LANE_RANK ? LANE_RANK[l] : 9);

const RULES_BEGIN = "<!-- BEGIN pm-conductor rules (managed by /pm:init — safe to delete this block) -->";
const RULES_END = "<!-- END pm-conductor rules -->";

// ---------- helpers ----------

function readJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return fallback; }
}

function readStdin() {
  try { return fs.readFileSync(0, "utf8"); } catch { return ""; }
}

function isInitialized() {
  return fs.existsSync(STATE_PATH);
}

function gitShortSha() {
  try { return execSync("git rev-parse --short HEAD", { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); }
  catch { return "-"; }
}

function defaultState() {
  return { version: 1, active: null, epics: [], detourStack: [] };
}

function loadState() {
  const s = readJSON(STATE_PATH, null);
  return s && typeof s === "object" ? { ...defaultState(), ...s } : defaultState();
}

/** Atomic write: write to a tmp file in the same directory, then rename(2) over the
 *  real path. rename is atomic on the same filesystem — a crash mid-write leaves a
 *  truncated .tmp-* file, never a truncated state.json. */
function saveState(state) {
  fs.mkdirSync(CONDUCTOR_DIR, { recursive: true });
  const data = JSON.stringify(state, null, 2) + "\n";
  const tmpPath = `${STATE_PATH}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, data);
  fs.renameSync(tmpPath, STATE_PATH);
}

/** The running plugin's root dir. Env-first so tests can point at a fixture. */
function pluginRoot() {
  return process.env.CLAUDE_PLUGIN_ROOT
    ? process.env.CLAUDE_PLUGIN_ROOT
    : path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
}

/** The running plugin's release. Env-first so tests can point at a fixture plugin.json. */
function pluginVersion() {
  const pj = readJSON(path.join(pluginRoot(), ".claude-plugin", "plugin.json"), null);
  return pj && pj.version ? String(pj.version) : null;
}

/** Parse the plugin's own CHANGELOG.md into [{version, body}] sections (file order,
 *  newest-first). Returns null if no CHANGELOG ships with this version. Zero-dep:
 *  sections are delimited by `## [x.y.z]` headers. */
function changelogSections() {
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
function changelogBetween(fromVer, toVer) {
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
function changelogAddedHeadlines(fromVer, toVer, limit = 3) {
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
function newestInstalledVersion() {
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
function cmpVer(a, b) {
  const pa = String(a).split(".").map(n => parseInt(n, 10) || 0);
  const pb = String(b).split(".").map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

function stampVersion(state) {
  const v = pluginVersion();
  if (v) state.pmVersion = v;
}

function appendDetourLog(kind, epic, note) {
  fs.mkdirSync(CONDUCTOR_DIR, { recursive: true });
  const line = [new Date().toISOString(), gitShortSha(), kind, epic || "-", (note || "").replace(/\s+/g, " ").trim()].join("\t");
  fs.appendFileSync(DETOURS_LOG, line + "\n");
}

/** Active openspec change ids = subdirs of openspec/changes except `archive`. */
function activeChangeIds() {
  try {
    return fs.readdirSync(CHANGES_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name !== "archive")
      .map(d => d.name);
  } catch { return []; }
}

function planFiles() {
  try {
    return fs.readdirSync(PLANS_DIR, { withFileTypes: true })
      .filter(d => d.isFile() && d.name.endsWith(".md"))
      .map(d => d.name);
  } catch { return []; }
}

function firstHeading(absPath) {
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
function isArchived(id) {
  if (fs.existsSync(path.join(ARCHIVE_DIR, id))) return true;
  let entries;
  try { entries = fs.readdirSync(ARCHIVE_DIR, { withFileTypes: true }); } catch { return false; }
  const re = new RegExp(`^\\d{4}-\\d{2}-\\d{2}-${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
  return entries.some(d => d.isDirectory() && re.test(d.name));
}

/** Heal drift between the conductor and the on-disk archive: any epic whose change is
 *  archived becomes status `archived`, and an `active` pointer aimed at an archived epic
 *  is cleared. Returns true if it changed anything. Called from the mutating paths
 *  (sync/commit-nudge/init/upgrade) so the agent never has to hand-edit state.json. */
/** Recompute-don't-remember: re-derive active validity and reconcile obligation from
 *  disk/state on every call, rather than trusting stored flags that can go stale (a
 *  hand-edit, a lost compaction, a forgotten clear on resume). Called by write paths
 *  (render, sync, commit-nudge, upgrade) — NOT by brief(), which stays read-only and
 *  displays the same recomputed truth in-memory via resolveEpics() without persisting. */
function reconcileArchived(state) {
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
function countCheckboxes(absPath) {
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
function epicProgress(epic) {
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
function resolveEpics(state) {
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
function missing(e) {
  return e.lane === "openspec" && !e.present && !isArchived(e.id) &&
    e.status !== "planned" && e.status !== "archived";
}

/** Extends plan-hierarchy's depends-on topological sort from ONE parent's children to ALL
 *  top-level queued/untriaged epics generally — the same starvation problem exists there: a
 *  higher-priority epic with an unresolved `depends-on` link to another still-queued epic would
 *  otherwise be listed (and picked by /pm:next) ahead of the very dependency it's waiting on.
 *  `sorted` is a priority-then-lane-then-id-ordered list (resolveEpics()'s existing sort,
 *  already filtered to queued/untriaged + not-missing — this function does not re-derive that
 *  filter, so it applies uniformly whether or not the epics involved share a parent). Returns
 *  `{ ordered, notes }`: `ordered` respects every unresolved depends-on edge between epics in
 *  `sorted` (Kahn's algorithm, batching by the existing priority order within each batch, same
 *  approach as planHierarchy()); `notes` is one human-readable line per case where dependency
 *  ordering actually demoted an epic behind a lower-priority one it would otherwise have
 *  outranked — i.e. exactly the cases where /pm:next's pick changed because of a dependency.
 *  A dependency cycle among queued epics does not fail here (unlike plan-hierarchy, which is
 *  the authoritative execution plan for a hierarchy) — this only drives a status display and a
 *  /pm:next recommendation, so on a cycle we fall back to the original priority order for
 *  whatever's left rather than erroring out of a status render. A depends-on link to an epic
 *  NOT in `sorted` (done, archived, or simply not in this queued/untriaged set) imposes no
 *  wait, matching plan-hierarchy's existing "outside the hierarchy" behavior. */
function orderQueueWithDependencies(sorted) {
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

function bar(p) {
  if (!p) return "—";
  if (p.warn) return `⚠ ${p.warn}`;
  if (p.total > 0) return `${p.done}/${p.total} ${p.source === "plan" ? "tasks" : "stories"}`;
  return "—";
}

// `autonomy` is optional per epic — absent means "off", today's behavior, unchanged.
// getAutonomy() is the ONLY place that should read epic.autonomy directly; everywhere
// else (render, brief, set-autonomy) calls this so a missing field never needs a
// migration to backfill — it defaults cleanly at read-time.
const DEFAULT_AUTONOMY = Object.freeze({ level: "off", preAuthorized: [], context: [], notifications: [] });
function getAutonomy(epic) {
  const a = epic.autonomy;
  if (!a) return DEFAULT_AUTONOMY;
  return {
    level: a.level || "off",
    preAuthorized: Array.isArray(a.preAuthorized) ? a.preAuthorized : [],
    context: Array.isArray(a.context) ? a.context : [],
    notifications: Array.isArray(a.notifications) ? a.notifications : [],
  };
}

/** A link is renderable only when both endpoints are strings. Guards against
 *  malformed/partial entries (incl. older schemas) that would render `undefined`. */
function validLink(l) {
  return l && typeof l.type === "string" && typeof l.epic === "string";
}

/** Normalize one stored link for the 0.5.0 migration. Repair-first:
 *  a valid {type, epic} object passes through; the documented colon-string
 *  encoding `type:epic[:reason]` (what add-epic's --link parser produces) is
 *  repaired into an object; anything else is unrecoverable → null (dropped). */
function normalizeLink(l) {
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
function detourContext(state) {
  if (state.detourStack && state.detourStack.length) {
    const top = state.detourStack[state.detourStack.length - 1];
    return { active: true, detourId: top.spawnedDetour || state.active || "-" };
  }
  const cur = state.epics.find(e => e.id === state.active);
  if (cur && cur.role === "detour") return { active: true, detourId: cur.id };
  return { active: false, detourId: null };
}

// ---------- rules ----------

/** The tracker block from state, or null — used to make emitted instructions tracker-aware. */
function currentTracker() {
  try { const t = loadState().tracker; return t && t.system ? t : null; } catch { return null; }
}

/** The repo-global review-mode dial, defaulting to "standard" when unset or invalid. */
function globalReviewMode(state) {
  const m = state && state.reviewMode;
  return KNOWN_REVIEW_MODES.includes(m) ? m : "standard";
}

/** The active review-mode dial. With no `epicId`, this is just the repo-global dial. With an
 *  `epicId`, returns the EFFECTIVE mode for that epic: the higher-ranked of the repo-global
 *  dial and the epic's own `reviewMode` override (if any) — an epic override can only escalate
 *  above the global dial, never silently de-escalate below it (enforced at write time in
 *  updateEpic(), not here; this is just "take the max" for read time). */
function currentReviewMode(epicId) {
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

function rulesBlock(tracker, reviewMode) {
  const mode = KNOWN_REVIEW_MODES.includes(reviewMode) ? reviewMode : "standard";
  const lines = [
    RULES_BEGIN,
    "## PM Conductor — operating rules",
    "",
    "This repo is managed by the `pm` plugin. The conductor sits ABOVE OpenSpec and Superpowers.",
    "Epics are **lane-agnostic** (openspec | superpowers | claude-code | decision | external);",
    "OpenSpec is one lane. Stories come from each epic's source (OpenSpec `tasks.md`, a Superpowers",
    "plan, or a manual list). Follow these rules:",
    "",
    "1. **Detours** — when something blocks the active epic, CLASSIFY before fixing:",
    "   - *Minimal* (small, self-contained, no design ambiguity): fix → test → commit → push,",
    "     then run `/pm:detour --minimal \"<what>\"` so it is recorded in `.conductor/detours.log`.",
    "     Then resume.",
    "   - *Substantial* (own design / changes shared behavior / multi-step): run `/pm:detour`.",
    "     It becomes its own epic in the appropriate lane (OpenSpec proposal, Superpowers plan,",
    "     etc.); PUSH the current epic onto the detour stack in `.conductor/state.json` with a",
    "     concrete reason and `reconcileOnResume`.",
    "2. **State of record is `.conductor/state.json`.** After any change to epics, status,",
    "   priority, or the detour stack, re-render with `/pm:status`. Never hand-edit `PROJECT.md`.",
    "3. **Resuming after a detour** — use `/pm:resume`. If the popped frame had",
    "   `reconcileOnResume`, run the reconcile gate (reconciler agent) BEFORE writing code,",
    "   then write its verdict back durably with `record-reconcile <id> --detour <id>",
    "   --verdict valid|invalidated [--amendments \"<a>;<b>\"]` — this attaches",
    "   `{verdict, amendments, reconciledAt}` to the paused epic's link to the detour and",
    "   clears `reconcileNeeded`, instead of the judgment only ever living in conversation.",
    "4. **Honcho** — on every PUSH and POP, also write a one-line memory to Honcho",
    "   (\"paused X for Y\" / \"resumed X, reconciled vs Y\") so the relationship survives outside",
    "   this repo.",
    "5. **Keep `tasks.md` checkboxes truthful** — they are the source of truth for story progress.",
    "6. **Roadmap as backlog** — work you intend to do but haven't proposed yet can be",
    "   registered now with `/pm:epic add … --status planned` (any lane). Planned epics show",
    "   as ordered backlog in `PROJECT.md` and a `planned: N` count in the briefing, without a",
    "   \"no change on disk\" warning; `/pm:sync` flips an openspec planned epic to untriaged once",
    "   its change is proposed. Have a roadmap doc? Read it in-session and load each item this way.",
    "",
    "## Epic-level autonomy",
    "",
    "An epic's `autonomy` block (`.conductor/state.json`) can grant it broad execution trust —",
    "`level: \"off\"` by default (today's behavior, unchanged). Setting `level: \"autonomous\"`",
    "removes the need to ask before each phase transition, but NEVER removes a genuine safety stop.",
    "This is development-time only — it never covers actions with irreversible EXTERNAL side",
    "effects (sending email/Slack, deploying to production, third-party API calls, pushing to a",
    "shared branch); those are out of scope regardless of autonomy level.",
    "",
    "1. **Preflight before flipping the switch** — see the `conductor` skill's",
    "   \"Epic-level autonomy — the preflight scan\" section for the full process. In short: read",
    "   the epic's full source, produce a short batch of destructive-risk-points +",
    "   genuine-unknowns questions, get the user's answers, THEN record them:",
    "   `set-autonomy <id> --preauthorize \"<action>:<reason>\"` / `--context \"<note>\"`, and only",
    "   then `set-autonomy <id> --level autonomous`. For routine, repeated categories of action",
    "   instead of enumerating each one, use the shorthand",
    "   `--preauthorize \"category:<filesystem|network|schema|external-api>:<reason>\"` — see the",
    "   `conductor` skill's \"Epic-level autonomy\" section for the exact keyword heuristic each",
    "   category matches at decision-rule time.",
    "2. **Execution-time decision rule** — check every destructive action against these, in",
    "   order, before treating it as a stop:",
    "   a. Already pre-authorized in the preflight — either an exact `action` match or the",
    "      action falls under a granted `category` (per the category heuristic)? → proceed,",
    "      record via `--notify`.",
    "   b. No backup/restore path exists? → STOP regardless of autonomy level.",
    "   c. Destructive but restorable (backed up first)? → WARN — `--notify` it immediately, proceed.",
    "   d. No context to act on? → STOP — a real gap, not a false stall.",
    "   e. Consequential and not yet notified? → `--notify` it immediately, then proceed.",
    "3. **Notify incrementally, not at the end** — `--notify` writes durably to `state.json`'s",
    "   `notifications[]` the moment a WARN-class (c) or consequential (e) decision is made. Do this",
    "   AS EACH DECISION HAPPENS, not batched — a session can be compacted or interrupted mid-epic,",
    "   and anything not yet `--notify`'d is lost when that happens.",
    "4. **End-of-epic report** — on completion, read back the accumulated `notifications[]` and",
    "   report what was asked, what was done, and the decisions made in the user's absence (drawn",
    "   from that log, not from memory), with an explicit \"are you OK with these?\" checkpoint, THEN",
    "   run tests. Leave room to iterate — including rewriting code — if the user is not satisfied.",
    "",
    "## Review mode",
    "",
    "Review intensity is a bounded dial, not a free-form call each time — set via",
    "`set-review-mode --mode <off|standard|thorough>` (default: `standard` if never set).",
    "",
    "| Mode | Reviewer budget | Trigger |",
    "|------|-----------------|---------|",
    "| `off` | none — self-review only | tiny, low-risk, single-file claude-code tweaks |",
    "| `standard` | one fresh-context reviewer per gate | the default: OpenSpec Gate 1/Gate 2, a Superpowers task review |",
    "| `thorough` | two independent fresh-context reviewers per gate; adjudicate any disagreement yourself | schema/migration changes, security-sensitive work, or anything explicitly flagged high-stakes |",
    "",
    `Current mode: **${mode}**.`,
  ];
  if (tracker && tracker.system) {
    const sys = tracker.system;
    const scope = tracker.projectKey ? ` · ${tracker.projectKey}` : "";
    // github-issues is deliberately INWARD-only (issues -> untriaged epics, below): auto-filing
    // a GitHub issue for every unmirrored local epic is a much bigger, more consequential
    // default (silently creating public GitHub issues) than mirroring toward an internal
    // Jira/Linear instance, so the outward "External tracker sync" section is suppressed
    // entirely for this system. jira/linear/any other tracker system keeps full bidirectional
    // outward-mirror instructions, unchanged.
    if (sys !== "github-issues") {
      lines.push(
        "",
        `## External tracker sync (${sys}${scope})`,
        "",
        `This repo mirrors conductor epics to **${sys}**. YOU (the interactive agent) own this sync —`,
        `the pm plugin NEVER calls ${sys} itself. On these events, perform the matching action with`,
        "your own tooling (MCP, connector, CLI — whatever this project uses):",
        `- A real epic has no \`externalId\` → create the ${sys} issue, then record its key with`,
        "  `/pm:epic` → `update-epic <id> --external-id <KEY> --external-url <url>`.",
        "- An epic moves to a status with a `statusIntent` (e.g. active/archived) → transition the",
        "  linked issue toward that SEMANTIC target, resolving the real workflow transition yourself.",
        `- A parent epic → create it as a ${sys} epic and link its children.`,
        "The SessionStart brief lists epics not yet mirrored under `TRACKER SYNC`. Status-transition",
        "sync is your responsibility on every status change (the brief does not fabricate it).",
        "",
        "**Epic-level autonomy on tracker-linked epics:** before running the preflight scan on a",
        `tracker-linked epic, pull the ${sys} issue + its child stories/subtasks with your own`,
        "tracker tools (the same ones you use for status sync) — that IS its source, not a local",
        "file alone. Mirror the preflight Q&A as a comment on the issue for visibility — this is a",
        "non-authoritative echo, `.conductor/state.json` stays the sole source of truth. If the",
        "tracker issue changes materially after the preflight snapshot, treat that as decision-rule",
        "item (d) — mid-run drift is a new genuine unknown, not something autonomy silently absorbs.",
      );
    }
    if (sys === "github-issues" && tracker.repo) {
      const repo = tracker.repo;
      lines.push(
        "",
        `## GitHub issue sync (${repo})`,
        "",
        "This tracker is inward: open GitHub issues become conductor epics, same pattern as the",
        "OpenSpec/Superpowers auto-registration `sync` already does for on-disk changes/plans. The",
        "pm plugin NEVER calls `gh` itself — as part of running `/pm:sync`, YOU (the interactive",
        "agent) do:",
        `1. \`gh issue list --repo ${repo} --state open --json number,title,url,labels\`.`,
        "2. For each issue, check whether an epic with that issue number as `externalId` already",
        "   exists (`/pm:epic list` or read `.conductor/state.json`) — if so, skip it (already",
        "   mirrored; re-running sync must never create a duplicate epic for the same issue).",
        "3. Otherwise register a new untriaged epic: `add-epic --status untriaged --external-id",
        "   <issue-number> --external-url <issue-url> --lane claude-code --priority P2`, unless a",
        "   `P0`/`P1`/`P2`/`P3` label is present on the issue, in which case use that label's",
        "   priority instead of the P2 default. `add-epic` itself rejects a duplicate `--external-id`",
        "   as a second line of defense, so a stale local view can't produce a duplicate either.",
        "4. Set `--title` from the issue title so the epic is legible before you triage it further.",
      );
    }
  }
  lines.push(RULES_END, "");
  return lines.join("\n");
}

function writeRules() {
  let existing = "";
  try { existing = fs.readFileSync(CLAUDE_MD, "utf8"); } catch { /* no CLAUDE.md yet */ }

  const block = rulesBlock(currentTracker(), currentReviewMode());
  let next;
  if (existing.includes(RULES_BEGIN) && existing.includes(RULES_END)) {
    // refresh in place
    const re = new RegExp(`${RULES_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${RULES_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n?`);
    next = existing.replace(re, block);
    process.stderr.write("conductor: refreshed rules block in CLAUDE.md\n");
  } else if (existing.trim()) {
    next = existing.replace(/\n*$/, "\n\n") + block;
    process.stderr.write("conductor: appended rules block to CLAUDE.md\n");
  } else {
    next = "# CLAUDE.md\n\n" + block;
    process.stderr.write("conductor: created CLAUDE.md with rules block\n");
  }
  fs.writeFileSync(CLAUDE_MD, next);
}

// ---------- the briefing ----------

function buildBrief(state) {
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

  // TRACKER SYNC — only when a tracker is configured, and only honestly-computable drift:
  // active-work epics (queued/active/paused, excluding missing() ghosts) with no externalId.
  // Status-transition sync is the agent's job (rules block), NOT fabricated here.
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

  // Re-injected RULES reminder — survives compaction because SessionStart re-fires (source=compact).
  L.push("RULES (pm): classify detours before fixing — minimal → fix+commit then `/pm:detour --minimal`; " +
    "substantial → `/pm:detour` (own proposal + PUSH). After any state change, `/pm:status`. " +
    "Resume via `/pm:resume` + reconcile gate. Mirror every PUSH/POP to a one-line Honcho memory.");
  L.push("");
  L.push("Manage with /pm:status · /pm:next · /pm:detour · /pm:resume, or the `conductor` skill.");
  return L.join("\n");
}

// ---------- render PROJECT.md ----------

function render() {
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
  // Render as a tree: roots in resolveEpics() order, each followed by its
  // descendants depth-first. Grouping is render-only — it does not touch the
  // resolveEpics() sort that buildBrief()/NEXT UP rely on.
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
    if (seen.has(e.id)) return;                 // cycle guard (validation prevents; render stays safe)
    seen.add(e.id);
    epicRow(e, depth);
    for (const c of childrenOf(e.id)) emit(c, depth + 1);
  };
  for (const e of epics) if (!e.parent || !byId.has(e.parent)) emit(e, 0);
  for (const e of epics) if (!seen.has(e.id)) emit(e, 0);   // orphaned by a cycle → render flat
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
  if (existing && existing.replace(STAMP_RE, "") === content.replace(STAMP_RE, "")) {
    process.stderr.write("conductor: PROJECT.md unchanged (skipped rewrite)\n");
    return;
  }
  fs.writeFileSync(PROJECT_MD, content);
  process.stderr.write(`conductor: rendered ${PROJECT_MD}\n`);
}

/** Records when PROJECT.md was last generated FROM the current state.json content, so
 *  `verify-state` can catch an undetected hand-edit: if state.json's mtime is newer than
 *  this stamp, someone modified it outside the render pipeline (CLAUDE.md forbids
 *  hand-editing state.json/PROJECT.md — the state of record must go through the engine's
 *  subcommands so ordering/detour-stack/link invariants stay consistent). Sidecar file
 *  (not a state.json field) so stamping never itself perturbs the content being verified. */
function writeRenderStamp() {
  let stateMtimeMs = null;
  try { stateMtimeMs = fs.statSync(STATE_PATH).mtimeMs; } catch { /* no state.json yet */ }
  // verify-state only ever compares stateMtimeMs (see verifyState() below) — renderedAt is
  // informational only, nothing reads it back for correctness. So if state.json's mtime
  // hasn't moved since the last stamp, rewriting the file would only bump renderedAt and
  // produce a spurious byte-for-byte diff on every render() call even though nothing that
  // matters changed. Skip the rewrite in that case.
  const existing = readJSON(RENDER_STAMP_PATH, null);
  if (existing && existing.stateMtimeMs === stateMtimeMs) return;
  const stamp = { renderedAt: new Date().toISOString(), stateMtimeMs };
  fs.mkdirSync(CONDUCTOR_DIR, { recursive: true });
  fs.writeFileSync(RENDER_STAMP_PATH, JSON.stringify(stamp, null, 2) + "\n");
}

// ---------- subcommands ----------

function init() {
  if (isInitialized()) {
    process.stderr.write("conductor: already initialized (.conductor/state.json exists)\n");
  } else {
    saveState(defaultState());
    process.stderr.write("conductor: created .conductor/state.json\n");
  }
  sync(true);                 // pull in existing openspec changes + plans
  { const s = loadState(); stampVersion(s); saveState(s); }
  writeRules();
  render();
  process.stderr.write(
    "conductor: initialized. Triage epics in .conductor/state.json " +
    "(set priority/status/active), then /pm:status.\n"
  );
}

function brief() {
  if (!isInitialized()) return;          // DORMANT until /pm:init
  const context = buildBrief(loadState());
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context },
  }));
}

function snapshot() {
  if (!isInitialized()) return;          // DORMANT until /pm:init
  const state = loadState();
  render();
  fs.mkdirSync(CONDUCTOR_DIR, { recursive: true });
  fs.writeFileSync(BRIEF_PATH, buildBrief(state) + "\n");
  process.stderr.write("conductor: snapshot written before compaction\n");
}


/** Files changed by HEAD, via `git diff-tree`. Returns null if git isn't usable here. */
function headChangedFiles() {
  try {
    const out = execSync("git diff-tree --no-commit-id --name-only -r --root HEAD", {
      cwd: ROOT, stdio: ["ignore", "pipe", "ignore"],
    }).toString().trim();
    return out ? out.split("\n") : [];
  } catch { return null; }
}

/** pm's own state-output files — routine conductor bookkeeping (registering/archiving
 *  epics, re-rendering) touches only these, never a stray detour. CLAUDE.md is deliberately
 *  excluded: it's user-authored content, not purely engine-generated output, so a commit
 *  touching it could still be a real detour. */
const CONDUCTOR_OWN_FILES = new Set([".conductor/state.json", "PROJECT.md", ".conductor/render-stamp.json"]);

/** Diff-shape heuristic for an UNLOGGED minimal detour: a small, self-contained commit
 *  (<=3 files) whose subject uses a fix/chore conventional-commit prefix, made while no
 *  detour is active, and that does not itself name the currently active epic (a commit
 *  tagged to the active epic's own scope is that epic's work, not a stray detour). */
function looksLikeUnloggedMinimalDetour(subject, activeEpicId) {
  if (!/^(fix|chore)(\([^)]*\))?:\s/.test(subject)) return false;
  if (activeEpicId && subject.includes(`(${activeEpicId})`)) return false;
  const files = headChangedFiles();
  if (files === null || files.length === 0 || files.length > 3) return false;
  if (files.every((f) => CONDUCTOR_OWN_FILES.has(f))) return false;
  return true;
}

function commitNudge() {
  if (!isInitialized()) return;          // DORMANT until /pm:init
  const raw = readStdin();
  let cmd = "";
  try {
    const j = JSON.parse(raw);
    cmd = j?.tool_input?.command || j?.tool_input?.cmd || "";
  } catch { /* ignore */ }
  if (!/git\s+commit/.test(cmd)) return; // only react to commits

  const state = loadState();
  const ctx = detourContext(state);
  const m = cmd.match(/-m\s+(?:"([^"]*)"|'([^']*)'|(\S+))/);
  const subject = (m && (m[1] || m[2] || m[3])) || "";

  // DETERMINISTIC: if we are inside a detour, record this commit in the trail.
  let autoLogged = false;
  if (ctx.active) {
    appendDetourLog("DETOUR-COMMIT", ctx.detourId, subject);
  } else if (looksLikeUnloggedMinimalDetour(subject, state.active)) {
    // AUTO-DETECT: this commit's shape looks like a minimal detour nobody logged via
    // `/pm:detour --minimal`. Log it automatically instead of relying on the agent to
    // remember — the whole point of this heuristic.
    appendDetourLog("AUTO-DETOUR", state.active || "-", subject);
    autoLogged = true;
  }
  // Self-heal: if this commit archived the active epic (e.g. an OpenSpec archive),
  // clear the stale active pointer + stamp archived status so /pm:next advances.
  if (reconcileArchived(state)) saveState(state);
  render();

  const msg = ctx.active
    ? `Commit detected during DETOUR \`${ctx.detourId}\` (logged to detours.log). ` +
      "When the detour is done: archive it, `/pm:resume` to pop the stack, and run the " +
      "RECONCILE check on the paused parent epic. Write a one-line Honcho memory on resume."
    : autoLogged
    ? "Commit detected. Diff shape (small, fix/chore-prefixed, unrelated to the active " +
      "epic) looks like a MINIMAL detour, so it was auto-logged to `.conductor/detours.log` " +
      "as an AUTO-DETOUR entry. Review it — if that's wrong, edit/remove the line."
    : "Commit detected. If this was a MINIMAL detour, run `/pm:detour --minimal \"<what>\"` " +
      "to record it. Otherwise update `.conductor/state.json` if an epic's status or stories changed.";
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: msg },
  }));
}

function sync(quiet = false) {
  const state = loadState();
  const onDiskChanges = new Set(activeChangeIds());
  for (const e of state.epics) {
    if ((e.lane || "openspec") === "openspec" && e.status === "planned" && onDiskChanges.has(e.id)) {
      e.status = "untriaged";
      if (!quiet) process.stderr.write(`conductor: '${e.id}' proposed — planned → untriaged\n`);
    }
  }
  const known = new Set(state.epics.map(e => e.id));
  let added = 0;
  for (const id of activeChangeIds()) {
    if (!known.has(id)) {
      state.epics.push({ id, title: id, priority: "P?", status: "untriaged", role: "epic", lane: "openspec", links: [], reconcileNeeded: false });
      known.add(id); added++;
    }
  }
  for (const fname of planFiles()) {
    const id = fname.replace(/\.md$/, "");
    if (known.has(id)) {
      if (!quiet) process.stderr.write(`conductor: sync skipped plan '${id}' — id already exists\n`);
      continue;
    }
    const planPath = path.join("docs", "superpowers", "plans", fname);
    const title = firstHeading(path.join(PLANS_DIR, fname)) || id;
    state.epics.push({ id, title, priority: "P?", status: "untriaged", role: "epic", lane: "superpowers", planPath, links: [], reconcileNeeded: false });
    known.add(id); added++;
  }
  reconcileArchived(state);
  saveState(state);
  if (!quiet) process.stderr.write(`conductor: synced (${added} new epic(s) added as untriaged)\n`);
}

function logDetour() {
  if (!isInitialized()) { process.stderr.write("conductor: run /pm:init first\n"); process.exit(1); }
  const reason = process.argv.slice(3).join(" ").trim();
  if (!reason) { process.stderr.write("usage: conductor.mjs log-detour \"<what you fixed>\"\n"); process.exit(1); }
  const state = loadState();
  appendDetourLog("MINIMAL", state.active || "-", reason);
  render();
  process.stderr.write("conductor: logged minimal detour\n");
}

const HONCHO_MEMORIES_LOG = path.join(CONDUCTOR_DIR, "honcho-memories.log");

/** Format the exact one-line Honcho memory string for a detour-stack PUSH or POP, per
 *  CLAUDE.md rule 4 ("on every PUSH and POP, also write a one-line memory to Honcho").
 *  Pure string formatting — the engine never calls Honcho itself (see the ZERO-DEPENDENCY /
 *  INSTRUCTION-LAYER law above); this only gives the interactive agent an exact, consistently
 *  worded, ready-to-copy string instead of composing one ad hoc from context each time. */
function honchoMemoryLine(action, epicId, reason) {
  if (action === "push") return `paused ${epicId} for ${reason}`;
  if (action === "pop") return `resumed ${epicId}, reconciled vs ${reason}`;
  throw new Error(`honchoMemoryLine: unknown action '${action}' (expected 'push' or 'pop')`);
}

/** `honcho-memory <push|pop> <epicId> "<reason>"` — prints the ready-to-copy Honcho memory
 *  line to stdout (for the interactive agent to paste into its actual Honcho MCP call) AND
 *  appends a timestamped copy to `.conductor/honcho-memories.log`, so there's a durable local
 *  record of what was emitted even if the agent forgets to actually send it. */
function honchoMemory() {
  if (!isInitialized()) { process.stderr.write("conductor: run /pm:init first\n"); process.exit(1); }
  const [action, epicId, ...rest] = process.argv.slice(3);
  const reason = rest.join(" ").trim();
  if (!action || !epicId || !reason) {
    process.stderr.write("usage: conductor.mjs honcho-memory <push|pop> <epicId> \"<reason>\"\n");
    process.exit(1);
  }
  let line;
  try {
    line = honchoMemoryLine(action, epicId, reason);
  } catch (e) {
    process.stderr.write(`conductor: ${e.message}\n`);
    process.exit(1);
  }
  fs.mkdirSync(CONDUCTOR_DIR, { recursive: true });
  fs.appendFileSync(HONCHO_MEMORIES_LOG, `${new Date().toISOString()}\t${line}\n`);
  process.stdout.write(line + "\n");
}

// ---------- add-epic ----------

// Flags that accumulate into an array across repeated `--flag value` occurrences,
// shared by add-epic/add-many (--link), set-tracker (--intent), and set-autonomy
// (--preauthorize/--context/--notify).
const REPEATABLE_FLAGS = ["link", "intent", "preauthorize", "context", "notify", "add", "remove"];
function parseFlags(argv) {
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
 *  objects. Rejects malformed input (fewer than two segments, or an `epic` that isn't a
 *  real known epic id) by THROWING, instead of the prior behavior of silently storing a
 *  garbage link object — a typo like "type:related:epic:..." used to parse successfully
 *  (type="type", epic="related") because nothing checked that "related" was a real epic.
 *  Shared by add-epic and update-epic. */
function parseLinkFlags(raw, knownEpicIds) {
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
 *  to `stuckIds` (the set Kahn's algorithm couldn't place). Returns the actual cycle as an
 *  array of ids ending back at its start (e.g. ["a","b","a"]), for a debuggable error message
 *  instead of an unordered dump of every stuck id. */
function findCyclePath(stuckIds, deps) {
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
  return stuckIds; // defensive fallback — Kahn's algorithm guarantees a real cycle exists
}

/** `plan-hierarchy --parent <id>` — computes execution batches for a parent epic's children,
 *  recomputed fresh from existing data every call (no new persistent state): `depends-on`
 *  links BETWEEN SIBLINGS drive a topological sort into batches (Kahn's algorithm); within a
 *  batch, order by priority (P0 first, ties broken by id). Each child is annotated with
 *  whether it already has `autonomy.level === "autonomous"` — dispatching one that doesn't
 *  would immediately hit the epic-autonomy decision rule's "no context to act on" stop.
 *  A dependency cycle among children is rejected outright (exit 1), naming the cycle path,
 *  rather than producing a bogus order. Pure read + stdout — no state mutation. */
function planHierarchy() {
  if (!isInitialized()) { process.stderr.write("conductor: run /pm:init first\n"); process.exit(1); }
  const f = parseFlags(process.argv.slice(3));
  const parent = typeof f.parent === "string" ? f.parent : undefined;
  if (!parent) { process.stderr.write("usage: conductor.mjs plan-hierarchy --parent <id>\n"); process.exit(1); }
  const state = loadState();
  if (!state.epics.some(e => e.id === parent)) {
    process.stderr.write(`conductor: epic '${parent}' not found\n`); process.exit(1);
  }
  // Archived children are done — exclude them from the plan entirely. This also means a
  // depends-on reference to an archived sibling falls outside `childIds` below and is
  // silently treated as "not a hierarchy dependency" (satisfied), exactly the existing
  // behavior for a link to any epic outside the hierarchy — a done dependency imposes no wait.
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
 *  Returns an error string, or null if the parent is acceptable (or unset).
 *  `id` need not yet exist (add-epic); for re-parenting (update-epic) it will.
 *  Shared by add-epic, update-epic, and add-many so the tree stays acyclic. */
function parentError(epics, id, parent) {
  if (parent === undefined || parent === null) return null;
  if (parent === id) return `epic '${id}' cannot be its own parent`;
  const byId = new Map(epics.map(e => [e.id, e]));
  if (!byId.has(parent)) return `parent '${parent}' is not a known epic`;
  // Walk ancestors of `parent`; reaching `id` means this edge would close a cycle.
  let cur = byId.get(parent), guard = 0;
  while (cur && cur.parent && guard++ < 10000) {
    if (cur.parent === id) return `setting parent '${parent}' on '${id}' would create a cycle`;
    cur = byId.get(cur.parent);
  }
  return null;
}

function addEpic() {
  if (!isInitialized()) { process.stderr.write("conductor: run /pm:init first\n"); process.exit(1); }
  const f = parseFlags(process.argv.slice(3));
  const str = (v) => (typeof v === "string" ? v : undefined); // valueless flags arrive as boolean true
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
  if (externalId !== undefined) {
    const dup = state.epics.find(e => e.externalId === externalId);
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
  if (epic.status === "active") activate(state, id);   // keep .active in sync on creation
  saveState(state);
  render();
  process.stderr.write(`conductor: added epic '${id}' (${lane}, ${status})\n`);
}

// ---------- add-many (atomic bulk create) ----------

/** Bulk-create epics from a JSON batch `{ parent?, epics: [...] }`.
 *  Validate EVERYTHING first (id format, uniqueness vs existing AND within the
 *  batch, lane, status, parent refs/cycles); on any failure write nothing and
 *  exit non-zero. One saveState at the end — atomic, and race-free. JSON only
 *  (zero-dep engine). `--from -` reads stdin. */
function addMany() {
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
    if (parentId && entry.parent === undefined) entry.parent = parentId;  // children default to the parent
    incoming.push(entry);
  }
  if (!incoming.length) { process.stderr.write("conductor: add-many: nothing to add (need `parent` and/or `epics`)\n"); process.exit(1); }

  const die = (msg) => { process.stderr.write(`conductor: add-many: ${msg}\n`); process.exit(1); };

  // Pass 1 — id / lane / status / uniqueness (vs existing AND within batch).
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
  // Pass 2 — parent refs/cycles against the union of existing + the full batch.
  const projected = [...state.epics, ...incoming.map(e => ({ id: e.id, parent: e.parent }))];
  for (const e of incoming) {
    if (e.parent !== undefined && e.parent !== null) {
      const perr = parentError(projected, e.id, e.parent);
      if (perr) die(perr);
    }
  }
  // All valid — build and write once.
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

// ---------- active pointer ----------

/** Enforce the single-active invariant: `id` becomes the one active epic AND the
 *  top-level `.active` pointer. Any OTHER epic left at status "active" is demoted to
 *  "queued", so `.active` and `status: "active"` can never silently disagree. */
function activate(state, id) {
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
function daysActive(epic) {
  if (!epic.startedAt || epic.completedAt) return null;
  const started = Date.parse(epic.startedAt);
  if (Number.isNaN(started)) return null;
  return Math.floor((Date.now() - started) / (24 * 60 * 60 * 1000));
}

/** `⚠ stale, Nd active` marker for an epic that's been active more than STALE_DAYS with
 *  no completedAt — surfaced in both PROJECT.md's table and the brief's NOW/NEXT UP lines. */
function staleMarker(epic) {
  const d = daysActive(epic);
  return d !== null && d > STALE_DAYS ? ` ⚠ stale, ${d}d active` : "";
}

/** `set-active <id>` — the CLI verb for the top-level active pointer (positional id). */
function setActive() {
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
function clearActive() {
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

// ---------- update-epic (write-back) ----------

// The flags update-epic recognizes. Anything else is a rejected error, not a
// silent no-op — an unrecognized flag (e.g. a typo) used to parse, run, and
// print "updated" with nothing actually changed.
const UPDATE_EPIC_FLAGS = ["external-id", "external-url", "parent", "status", "priority", "title", "link", "review-mode"];

/** Update an EXISTING epic's title/externalId/externalUrl/parent/status/priority/links.
 *  The id is POSITIONAL (parseFlags skips non-`--` tokens). Closes the tracker
 *  sync loop: after the agent creates an issue it records the key here.
 *  --link REPLACES the links array wholesale (unlike the other flags, which patch single
 *  fields) — this is the CLI path to fix a malformed link without hand-editing state.json;
 *  "fixing" means replacing the bad entry, not layering a new one on top of it. */
function updateEpic() {
  if (!isInitialized()) { process.stderr.write("conductor: run /pm:init first\n"); process.exit(1); }
  const argv = process.argv.slice(3);
  const id = argv[0] && !argv[0].startsWith("--") ? argv[0] : undefined;
  if (!id) { process.stderr.write("usage: conductor.mjs update-epic <id> [--title T] [--external-id X] [--external-url U] [--parent P] [--status S] [--priority P] [--link \"<type>:<epic>[:<reason>]\"] [--review-mode off|standard|thorough]\n"); process.exit(1); }
  const f = parseFlags(argv.slice(1));
  const unknown = Object.keys(f).filter(k => !UPDATE_EPIC_FLAGS.includes(k));
  if (unknown.length) {
    process.stderr.write(`conductor: update-epic: unknown flag(s) --${unknown.join(", --")} ` +
      `(known: ${UPDATE_EPIC_FLAGS.map(k => `--${k}`).join(", ")})\n`);
    process.exit(1);
  }
  const str = (v) => (typeof v === "string" ? v : undefined);
  const state = loadState();
  const epic = state.epics.find(e => e.id === id);
  if (!epic) { process.stderr.write(`conductor: epic '${id}' not found\n`); process.exit(1); }

  const parent = str(f.parent);
  if (parent !== undefined) {
    const perr = parentError(state.epics, id, parent);
    if (perr) { process.stderr.write(`conductor: ${perr}\n`); process.exit(1); }
  }
  const status = str(f.status);
  if (status !== undefined && !KNOWN_STATUSES.includes(status)) {
    process.stderr.write(`conductor: --status must be one of ${KNOWN_STATUSES.join("|")}\n`); process.exit(1);
  }
  let links;
  if (f.link !== undefined) {
    try {
      links = parseLinkFlags(f.link, new Set(state.epics.map(e => e.id)));
    } catch (e) {
      process.stderr.write(`conductor: ${e.message}\n`); process.exit(1);
    }
  }

  // --review-mode: a per-epic escalation-only override of the repo-global review-mode dial
  // (set-review-mode). It must never be usable to quietly de-escalate below the global dial —
  // that would let one epic silently weaken review rigor a human explicitly raised repo-wide.
  const reviewMode = str(f["review-mode"]);
  if (reviewMode !== undefined) {
    if (!KNOWN_REVIEW_MODES.includes(reviewMode)) {
      process.stderr.write(`conductor: --review-mode must be one of ${KNOWN_REVIEW_MODES.join("|")}\n`);
      process.exit(1);
    }
    const global = globalReviewMode(state);
    if (REVIEW_MODE_RANK[reviewMode] < REVIEW_MODE_RANK[global]) {
      process.stderr.write(
        `conductor: --review-mode '${reviewMode}' would de-escalate below the repo-global dial ` +
        `('${global}') — an epic-level override may only escalate above the global dial, never below it\n`);
      process.exit(1);
    }
  }

  // openspec-lane epics may not be archived without a passing Gate 2 (implementation review)
  // verdict — see CLAUDE.md "OpenSpec build — TWO mandatory gates" and recordGateReview()
  // above. Gate 1 (spec review) gates code, which already happened earlier in the workflow;
  // only Gate 2 blocks archiving. Non-openspec-lane epics are completely unaffected.
  if (status === "archived" && epic.lane === "openspec") {
    const gate2 = epic.gateReview && epic.gateReview.gate2;
    if (!gate2 || gate2.verdict !== "pass") {
      process.stderr.write(
        `conductor: cannot archive openspec-lane epic '${id}' — missing a passing Gate 2 ` +
        `(implementation review) verdict. Run 'record-gate-review ${id} --gate 2 --verdict pass' ` +
        `after a real fresh-context implementation review before archiving.\n`);
      process.exit(1);
    }
  }

  if (str(f.title) !== undefined) epic.title = str(f.title);
  if (str(f["external-id"]) !== undefined) epic.externalId = str(f["external-id"]);
  if (str(f["external-url"]) !== undefined) epic.externalUrl = str(f["external-url"]);
  if (parent !== undefined) epic.parent = parent;
  if (status !== undefined) epic.status = status;
  if (str(f.priority) !== undefined) epic.priority = str(f.priority);
  if (links !== undefined) epic.links = links;
  if (reviewMode !== undefined) epic.reviewMode = reviewMode;

  // Stamp completedAt the moment an epic transitions TO archived (not merely re-saved
  // while already archived) — supports velocity tracking off startedAt/completedAt.
  if (status === "archived" && !epic.completedAt) epic.completedAt = new Date().toISOString();

  // Keep .active consistent with status — the two must never disagree.
  if (epic.status === "active") activate(state, id);
  else if (state.active === id) state.active = null;

  saveState(state);
  render();
  process.stderr.write(`conductor: updated '${id}'\n`);
}

// ---------- remove-epic ----------

/** Render a short (id, title, summary) table for human review — used when a removal is
 *  blocked by children, so the operator sees exactly what's in play without a raw dump. */
function epicSummaryTable(epics) {
  return epics
    .map(e => `  ${e.id.padEnd(24)} ${e.title.slice(0, 50).padEnd(50)} ${e.lane}/${e.priority}/${e.status}`)
    .join("\n");
}

/** `remove-epic <id> [--cascade]` — hard-deletes an epic (splice from state.json;
 *  recoverable only via git history, replacing the raw `git checkout` workaround). Blocks
 *  by default if the epic has children, printing an (id, title, summary) table for human
 *  review; `--cascade` removes the epic and every descendant in one go. Any OTHER epic's
 *  `links[]` entries referencing a removed id are stripped automatically, with a warning
 *  naming the affected epics — dangling references are worse than a silently smaller graph. */
function removeEpic() {
  if (!isInitialized()) { process.stderr.write("conductor: run /pm:init first\n"); process.exit(1); }
  const argv = process.argv.slice(3);
  const id = argv[0] && !argv[0].startsWith("--") ? argv[0] : undefined;
  if (!id) { process.stderr.write("usage: conductor.mjs remove-epic <id> [--cascade]\n"); process.exit(1); }
  const f = parseFlags(argv.slice(1));
  const cascade = f.cascade === true || f.cascade === "true";

  const state = loadState();
  const epic = state.epics.find(e => e.id === id);
  if (!epic) { process.stderr.write(`conductor: epic '${id}' not found\n`); process.exit(1); }

  // Walk the FULL descendant tree (BFS), not just direct children — the block-path preview
  // and the --cascade removal must agree on blast radius, or a human approving --cascade off
  // the preview table would be confirming a smaller deletion than what actually happens.
  const directChildren = state.epics.filter(e => e.parent === id);
  const descendants = [];
  {
    let frontier = [id];
    while (frontier.length) {
      const next = state.epics.filter(e => frontier.includes(e.parent));
      descendants.push(...next);
      frontier = next.map(e => e.id);
    }
  }

  if (descendants.length && !cascade) {
    process.stderr.write(
      `conductor: cannot remove '${id}' — it has ${directChildren.length} direct child epic(s) ` +
      `and ${descendants.length} descendant(s) total:\n` +
      `${epicSummaryTable([epic, ...descendants])}\n` +
      `Reassign or remove the descendants first, or re-run with --cascade to remove '${id}' ` +
      `and all ${descendants.length} descendant(s) together.\n`);
    process.exit(1);
  }

  const toRemove = new Set([id]);
  if (cascade) for (const d of descendants) toRemove.add(d.id);

  // Strip dangling links[] from epics that survive, and note who was affected.
  const affected = [];
  for (const e of state.epics) {
    if (toRemove.has(e.id)) continue;
    const before = (e.links || []).length;
    e.links = (e.links || []).filter(l => !toRemove.has(l.epic));
    if (e.links.length !== before) affected.push(e.id);
  }

  state.epics = state.epics.filter(e => !toRemove.has(e.id));
  if (toRemove.has(state.active)) state.active = null;

  saveState(state);
  render();
  const removedIds = [...toRemove];
  process.stderr.write(`conductor: removed ${removedIds.length} epic(s): ${removedIds.join(", ")}\n`);
  if (affected.length) {
    process.stderr.write(`conductor: stripped dangling link(s) referencing removed epic(s) from: ${affected.join(", ")}\n`);
  }
}

// ---------- autonomy ----------

/** `set-autonomy <id> [--level off|autonomous] [--preauthorize "<action>:<reason>"]
 *  [--preauthorize "category:<name>:<reason>"] [--context "<note>"] [--notify "<what>"]` —
 *  writes/merges an epic's `autonomy` block. Every flag is additive (repeated calls APPEND
 *  to preAuthorized/context/notifications, never clobber) except --level, which replaces.
 *  A `--preauthorize` value starting with "category:" is stored as a category-based grant
 *  (`{ category, reason, grantedAt }`, no `action` field) distinct from an exact-action grant
 *  (`{ action, reason, grantedAt }`, no `category` field) — see KNOWN_PREAUTHORIZE_CATEGORIES
 *  and the `conductor` skill's "Epic-level autonomy" section for the matching heuristic each
 *  category expands to at decision-rule time. Pure local state write — no external calls,
 *  consistent with the engine's instruction-layer law. */
function setAutonomy() {
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
      // "category:<name>:<reason>" — shorthand covering any action the decision rule matches
      // to that category, instead of enumerating each specific action string. See the
      // `conductor` skill's "Epic-level autonomy" section for the matching heuristic.
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

// ---------- reconciler structured writeback ----------

const KNOWN_RECONCILE_VERDICTS = ["valid", "invalidated"];

/** `record-reconcile <epicId> --detour <detourId> --verdict <valid|invalidated>
 *  [--amendments "<a>;<b>"]` — the durable half of the reconcile gate. The reconciler
 *  agent's judgment (see agents/reconciler.md) previously only ever lived in the
 *  conversation transcript; this writes it onto the paused epic's link entry for the
 *  detour that triggered reconciliation, so the verdict survives compaction and is
 *  visible in `.conductor/state.json`/PROJECT.md. Finds the existing link (any type)
 *  to `--detour`, or creates a `may-invalidate` link if none exists yet (mirrors the
 *  PUSH-protocol convention in the conductor skill: "parent may-invalidate detour").
 *  Also clears `reconcileNeeded` on the epic — recording a verdict IS completing the
 *  gate, matching the conductor skill's POP protocol step 3. Pure local state write. */
function recordReconcile() {
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

// ---------- openspec gate-review structured writeback ----------

const KNOWN_GATE_NUMBERS = ["1", "2"];
const KNOWN_GATE_VERDICTS = ["pass", "fail"];

/** `record-gate-review <epicId> --gate 1|2 --verdict pass|fail [--reviewer "<note>"]` —
 *  the durable half of the OpenSpec two-gate process (CLAUDE.md "OpenSpec build — TWO
 *  mandatory gates": Gate 1 = spec review before code, Gate 2 = implementation review
 *  before docs). Mirrors record-reconcile's shape: a dedicated subcommand writes structured
 *  evidence onto the epic (`gateReview.gate1`/`gateReview.gate2`, each
 *  `{verdict, reviewedAt, note?}`) instead of a hand-edited field, so a fresh-context
 *  reviewer's judgment survives compaction and is visible in `.conductor/state.json`.
 *  Scoped to the openspec lane only — rejects any other lane, an unknown epic id, or an
 *  invalid gate/verdict value, writing nothing on any rejection. `update-epic --status
 *  archived` requires `gate2.verdict === "pass"` for openspec-lane epics (see updateEpic());
 *  recording gate 1 alone does not unblock archiving. Pure local state write — no external
 *  calls, consistent with the engine's instruction-layer law. */
function recordGateReview() {
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

// ---------- tracker ----------

/** Write/merge the `tracker` block. Pure local state write — the engine NEVER
 *  contacts the tracker; it only records that one is in use so the instructions
 *  it emits (rules block + brief) can assign sync work to the interactive agent. */
function setTracker() {
  if (!isInitialized()) { process.stderr.write("conductor: run /pm:init first\n"); process.exit(1); }
  const f = parseFlags(process.argv.slice(3));
  const str = (v) => (typeof v === "string" ? v : undefined);
  const state = loadState();
  const t = { ...(state.tracker || {}) };
  if (str(f.system) !== undefined) t.system = str(f.system);
  if (str(f.instance) !== undefined) t.instance = str(f.instance);
  if (str(f.project) !== undefined) t.projectKey = str(f.project);
  if (str(f.mechanism) !== undefined) t.mechanism = str(f.mechanism);
  if (str(f.repo) !== undefined) t.repo = str(f.repo);
  if (Array.isArray(f.intent)) {
    const si = { ...(t.statusIntent || {}) };
    for (const pair of f.intent) {
      if (typeof pair !== "string") continue;
      const i = pair.indexOf(":");                 // split once — target may contain no ':'
      if (i <= 0 || i === pair.length - 1) continue;
      si[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
    }
    t.statusIntent = si;
  }
  if (!t.system) {
    process.stderr.write("conductor: set-tracker requires --system (e.g. jira)\n"); process.exit(1);
  }
  state.tracker = t;
  saveState(state);
  writeRules();   // refresh CLAUDE.md so the agent sees its new tracker-sync responsibility
  render();
  process.stderr.write(`conductor: tracker set (${t.system}${t.projectKey ? ` ${t.projectKey}` : ""})\n`);
}

// ---------- lane routing (per-repo overrides checked before the generic heuristic) ----------

/** Turn a `match` string into a case-insensitive matcher. `*` is a glob wildcard
 *  (`billing-*` matches "billing-refund-flow"); anything else is a plain
 *  case-insensitive substring match (`hotfix` matches "urgent hotfix for prod"). */
function laneMatchTest(match, text) {
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
 *  Writes/edits the optional `laneRouting.overrides` list — keyword/glob rules checked
 *  BEFORE the generic lane heuristic (documented in CLAUDE.md / the conductor skill) when
 *  an agent is deciding which lane should build a new epic. Pure local state write, same
 *  shape as setTracker(): the engine never enforces this itself (it has no lane-assignment
 *  code path to intercept — add-epic always takes an explicit --lane); suggest-lane just
 *  surfaces the match so the interactive agent can act on it. */
function setLaneRouting() {
  if (!isInitialized()) { process.stderr.write("conductor: run /pm:init first\n"); process.exit(1); }
  const f = parseFlags(process.argv.slice(3));
  const state = loadState();
  const lr = { overrides: [...((state.laneRouting || {}).overrides || [])] };

  if (f.clear) {
    lr.overrides = [];
  }
  if (Array.isArray(f.remove) || typeof f.remove === "string") {
    const removes = new Set((Array.isArray(f.remove) ? f.remove : [f.remove]).map(String));
    lr.overrides = lr.overrides.filter(o => !removes.has(o.match));
  }
  if (Array.isArray(f.add) || typeof f.add === "string") {
    const adds = Array.isArray(f.add) ? f.add : [f.add];
    for (const raw of adds) {
      if (typeof raw !== "string") continue;
      const i = raw.lastIndexOf(":");
      if (i <= 0 || i === raw.length - 1) {
        process.stderr.write(`conductor: bad --add '${raw}': expected "<match>:<lane>"\n`); process.exit(1);
      }
      const match = raw.slice(0, i).trim();
      const lane = raw.slice(i + 1).trim();
      if (!KNOWN_LANES.includes(lane)) {
        process.stderr.write(`conductor: bad --add '${raw}': lane must be one of ${KNOWN_LANES.join("|")}\n`); process.exit(1);
      }
      lr.overrides = lr.overrides.filter(o => o.match !== match);   // last --add for a match wins
      lr.overrides.push({ match, lane });
    }
  }

  state.laneRouting = lr;
  saveState(state);
  render();
  process.stderr.write(`conductor: lane routing has ${lr.overrides.length} override(s)\n`);
}

/** `suggest-lane "<free text>"` — checks the repo's `laneRouting.overrides` (in order,
 *  first match wins) against a proposed epic's title/description BEFORE the generic
 *  lane heuristic is applied. Prints `{lane, matched}` as JSON; `lane: null` means no
 *  override matched and the agent should fall back to the documented generic heuristic
 *  (>8h/cross-system -> openspec; 2-8h -> superpowers; <2h -> claude-code; etc). */
function suggestLane() {
  if (!isInitialized()) { process.stderr.write("conductor: run /pm:init first\n"); process.exit(1); }
  const text = process.argv[3];
  if (typeof text !== "string" || !text.length) {
    process.stderr.write("usage: conductor.mjs suggest-lane \"<free text>\"\n"); process.exit(1);
  }
  const state = loadState();
  const overrides = ((state.laneRouting || {}).overrides || []);
  for (const o of overrides) {
    if (laneMatchTest(o.match, text)) {
      process.stdout.write(JSON.stringify({ lane: o.lane, matched: o.match }) + "\n");
      return;
    }
  }
  process.stdout.write(JSON.stringify({ lane: null, matched: null }) + "\n");
}

// ---------- review mode ----------

/** `set-review-mode --mode off|standard|thorough` — the repo-level dial, mirroring Comet's
 *  review_mode: bounds how many fresh-context reviewer passes run and when, replacing an
 *  ad-hoc judgment call with an explicit, dedup'd budget. Pure local state write — no
 *  external calls. A single epic can escalate ABOVE this dial via
 *  `update-epic <id> --review-mode <mode>` (never below it) — see currentReviewMode(epicId). */
function setReviewMode() {
  if (!isInitialized()) { process.stderr.write("conductor: run /pm:init first\n"); process.exit(1); }
  const f = parseFlags(process.argv.slice(3));
  const mode = typeof f.mode === "string" ? f.mode : undefined;
  if (!mode || !KNOWN_REVIEW_MODES.includes(mode)) {
    process.stderr.write(`conductor: set-review-mode requires --mode, one of ${KNOWN_REVIEW_MODES.join("|")}\n`);
    process.exit(1);
  }
  const state = loadState();
  state.reviewMode = mode;
  saveState(state);
  writeRules();   // refresh CLAUDE.md so the agent sees the new active mode
  render();
  process.stderr.write(`conductor: review mode is now '${mode}'\n`);
}

// ---------- gate guard (optional opt-in PreToolUse guard) ----------

/** `set-gate-guard <on|off>` — repo-level opt-in for a hard PreToolUse guard blocking
 *  source writes while the active epic still owes a reconcile. Off by default. This is
 *  the one place pm's law tolerates mechanical blocking over pure instruction, because it
 *  protects the single highest-stakes skip (writing code before the reconcile gate runs
 *  on a detour POP) — opt-in, reversible, never silent. */
function setGateGuard() {
  if (!isInitialized()) { process.stderr.write("conductor: run /pm:init first\n"); process.exit(1); }
  const val = process.argv[3];
  if (val !== "on" && val !== "off") {
    process.stderr.write("usage: conductor.mjs set-gate-guard <on|off>\n"); process.exit(1);
  }
  const state = loadState();
  state.gateGuard = (val === "on");
  saveState(state);
  render();
  process.stderr.write(`conductor: gate guard is now ${val}\n`);
}

/** PreToolUse hook body: block Edit/Write/NotebookEdit while the active epic still owes a
 *  reconcile (`reconcileNeeded` — see reconcileArchived()'s comment for why this can be
 *  legitimately true with an empty detour stack). Dormant until /pm:init. As of the
 *  gate-guard-default-on-reconcile change, an epic with `reconcileNeeded: true` is ALWAYS
 *  gate-guarded — real-usage feedback showed the opt-in (`set-gate-guard on`) was never
 *  actually turned on, so the single highest-stakes skip (writing source before the
 *  reconcile gate runs) is now protected by default and cannot be silenced via
 *  `set-gate-guard off`. The repo-level `gateGuard` flag still exists (and still gates any
 *  *future* generalization of this hook to other checks), but no longer gates the
 *  reconcile-owed check itself. Exits 2 to block per Claude Code's PreToolUse convention
 *  (stderr becomes the reason shown to the agent). */
function gateGuardCheck() {
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

// ---------- migrations ----------

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

function upgrade() {
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
  // Apply in ascending release order (independent of array authoring order) so a
  // repo several versions behind runs every missed migration in the correct sequence.
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

  // Surface WHAT the upgrade brought, not just that it happened — close the
  // post-upgrade blindspot. Print the CHANGELOG delta for (stamped, running].
  const delta = changelogBetween(stamped, state.pmVersion || null);
  if (delta && delta.length) {
    process.stdout.write(
      `What's new in pm (since ${stamped}):\n\n` + delta.map(s => s.body).join("\n\n") + "\n");
  }
}

// ---------- changelog ----------

/** Show CHANGELOG entries newer than a version. `--since <x.y.z>` overrides the
 *  default, which is the version stamped in this repo's state.json. On-demand
 *  companion to the delta that `upgrade` prints automatically. */
function changelog() {
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

// ---------- worktree hygiene ----------

/** `verify-worktrees` — cross-references `git worktree list` against epic status to catch a
 *  hierarchy-dispatch worktree (branch `hierarchy-child/<epic-id>`, see the epic-hierarchy
 *  orchestration design's worktree-isolation addendum) that was never cleaned up after its
 *  epic's branch merged and the epic was archived. Pure read — flags, never deletes, since a
 *  worktree could in principle still hold in-progress work the bookkeeping hasn't caught up
 *  with. Bakes worktree hygiene into the plugin itself (checkable on any fresh install) rather
 *  than depending on a user's own personal discipline/CLAUDE.md. Zero-dependency: shells out to
 *  `git worktree list --porcelain` only; gracefully returns no orphans if that fails (e.g. this
 *  isn't a git repo at all). */
function verifyWorktrees() {
  if (!isInitialized()) { process.stderr.write("conductor: run /pm:init first\n"); process.exit(1); }
  const state = loadState();
  const byId = new Map(state.epics.map(e => [e.id, e]));
  let out;
  try {
    out = execSync("git worktree list --porcelain", { cwd: ROOT, encoding: "utf8" });
  } catch {
    process.stdout.write(JSON.stringify({ orphaned: [] }) + "\n");
    return;
  }
  const orphaned = [];
  let currentPath = null;
  for (const line of out.split("\n")) {
    if (line.startsWith("worktree ")) { currentPath = line.slice("worktree ".length).trim(); continue; }
    const m = line.match(/^branch refs\/heads\/hierarchy-child\/(.+)$/);
    if (m && currentPath) {
      const epicId = m[1];
      const epic = byId.get(epicId);
      if (epic && epic.status === "archived") {
        orphaned.push({ path: currentPath, branch: `hierarchy-child/${epicId}`, epicId });
      }
      currentPath = null;
    }
  }
  process.stdout.write(JSON.stringify({ orphaned }) + "\n");
}

/** `changesets` — lists the `.changesets/<epic-id>.md` fragment files hierarchy children write
 *  instead of editing CHANGELOG.md's shared `[Unreleased]` section directly (that shared-header
 *  edit was a guaranteed merge conflict across parallel batches). Pure read: never deletes or
 *  concatenates on its own — the orchestrator is the sole writer of CHANGELOG.md, same pattern as
 *  it already being the sole writer of state.json, and does the consolidation itself at release
 *  time (concatenate the fragment bodies into the new/`[Unreleased]` section, then delete the
 *  consumed files). Returns `{ changesets: [{ id, path, body }] }` sorted by id, `[]` if
 *  `.changesets/` doesn't exist or is empty — never errors on a missing directory. */
function changesets() {
  if (!isInitialized()) { process.stderr.write("conductor: run /pm:init first\n"); process.exit(1); }
  const dir = path.join(ROOT, ".changesets");
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    process.stdout.write(JSON.stringify({ changesets: [] }) + "\n");
    return;
  }
  const out = [];
  for (const ent of entries) {
    if (!ent.isFile() || !ent.name.endsWith(".md")) continue;
    const id = ent.name.slice(0, -3);
    const p = path.join(dir, ent.name);
    out.push({ id, path: p, body: fs.readFileSync(p, "utf8") });
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  process.stdout.write(JSON.stringify({ changesets: out }) + "\n");
}

/** `verify-state` — mechanically catches an undetected hand-edit of state.json (CLAUDE.md
 *  forbids hand-editing it; PROJECT.md must only ever be regenerated from it). Compares
 *  state.json's filesystem mtime against the stamp `writeRenderStamp()` records every
 *  render(): if state.json was modified AFTER the last recorded render, that mtime delta
 *  is evidence something wrote to it outside `/pm:status`/the engine's subcommands. Pure
 *  read — never modifies state.json or PROJECT.md itself. */
function verifyState() {
  if (!isInitialized()) { process.stderr.write("conductor: not initialized (.conductor/state.json missing) — run /pm:init\n"); process.exit(1); }
  const stamp = readJSON(RENDER_STAMP_PATH, null);
  if (!stamp || typeof stamp.stateMtimeMs !== "number") {
    process.stderr.write(
      "conductor: no render stamp found (.conductor/render-stamp.json) — state.json has never " +
      "been rendered, so an accidental hand-edit can't be ruled out. Run `/pm:status` to render " +
      "and establish a baseline.\n"
    );
    process.exit(1);
  }
  const currentMtimeMs = fs.statSync(STATE_PATH).mtimeMs;
  if (currentMtimeMs > stamp.stateMtimeMs) {
    process.stderr.write(
      "conductor: state.json was modified AFTER the last render — this looks like an " +
      "undetected hand-edit (CLAUDE.md forbids hand-editing state.json/PROJECT.md; the state " +
      "of record must go through the engine's subcommands). Run `/pm:status` to re-render, " +
      "review the diff, and reconcile before trusting PROJECT.md again.\n"
    );
    process.exit(1);
  }
  process.stderr.write("conductor: state.json matches the last render — no hand-edit detected.\n");
}

// ---------- dispatch ----------

const cmd = process.argv[2];
if (!process.env.PM_QUIET_ENGINE_BANNER) {
  process.stderr.write(
    `conductor: engine ${pluginVersion() || "unknown"} @ ${path.dirname(fileURLToPath(import.meta.url))}\n`
  );
}
({
  init,
  render,
  brief,
  snapshot,
  "commit-nudge": commitNudge,
  sync: () => sync(false),
  "log-detour": logDetour,
  "honcho-memory": honchoMemory,
  "add-epic": addEpic,
  "add-many": addMany,
  "update-epic": updateEpic,
  "remove-epic": removeEpic,
  "set-active": setActive,
  "clear-active": clearActive,
  "set-tracker": setTracker,
  "set-lane-routing": setLaneRouting,
  "suggest-lane": suggestLane,
  "set-autonomy": setAutonomy,
  "record-reconcile": recordReconcile,
  "record-gate-review": recordGateReview,
  "set-review-mode": setReviewMode,
  "set-gate-guard": setGateGuard,
  "gate-guard": gateGuardCheck,
  "plan-hierarchy": planHierarchy,
  "verify-worktrees": verifyWorktrees,
  "verify-state": verifyState,
  changesets,
  upgrade,
  changelog,
  rules: () => {
    const f = parseFlags(process.argv.slice(3));
    const epicId = typeof f.epic === "string" ? f.epic : undefined;
    process.stdout.write(rulesBlock(currentTracker(), currentReviewMode(epicId)));
  },
  "write-rules": writeRules,
}[cmd] || (() => {
  process.stderr.write("usage: conductor.mjs init|render|brief|snapshot|commit-nudge|sync|log-detour|honcho-memory|add-epic|add-many|update-epic|remove-epic|set-active|clear-active|set-tracker|set-lane-routing|suggest-lane|set-autonomy|record-reconcile|record-gate-review|set-review-mode|set-gate-guard|gate-guard|plan-hierarchy|verify-worktrees|verify-state|changesets|upgrade|changelog|rules|write-rules\n");
  process.exit(1);
}))();
