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
 * Story progress:   DERIVED live from tasks.md checkboxes at render time.
 *
 * Subcommands:
 *   init           scaffold .conductor/state.json, sync, render, write CLAUDE.md rules
 *   render         regenerate PROJECT.md from state.json + live tasks.md
 *   brief          SessionStart: print additionalContext JSON (DORMANT if not init'd)
 *   snapshot       PreCompact: render + write .conductor/brief.txt (DORMANT if not init'd)
 *   commit-nudge   PostToolUse(Bash): after a git commit, log detour commits + nudge
 *   sync           add any new openspec changes to state.json as "untriaged"
 *   log-detour "x" record a MINIMAL detour in detours.log (with the current git SHA)
 *   rules          print the CLAUDE.md rules block to stdout
 *   write-rules    insert/refresh the rules block in ./CLAUDE.md (idempotent)
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
const DETOURS_LOG = path.join(CONDUCTOR_DIR, "detours.log");
const PROJECT_MD = path.join(ROOT, "PROJECT.md");
const CLAUDE_MD = path.join(ROOT, "CLAUDE.md");
const CHANGES_DIR = path.join(ROOT, "openspec", "changes");
const ARCHIVE_DIR = path.join(CHANGES_DIR, "archive");
const PLANS_DIR = path.join(ROOT, "docs", "superpowers", "plans");
const KNOWN_LANES = ["openspec", "superpowers", "claude-code", "decision", "external"];
const KNOWN_STATUSES = ["untriaged", "queued", "active", "paused", "later", "blocked", "planned", "archived"];
const KNOWN_AUTONOMY_LEVELS = ["off", "autonomous"];
const KNOWN_REVIEW_MODES = ["off", "standard", "thorough"];
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

/** An openspec epic with no change on disk and not archived = genuinely missing its change. */
function missing(e) {
  return e.lane === "openspec" && !e.present && !isArchived(e.id) && e.status !== "planned";
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

/** The active review-mode dial, defaulting to "standard" when unset or invalid. */
function currentReviewMode() {
  try {
    const m = loadState().reviewMode;
    return KNOWN_REVIEW_MODES.includes(m) ? m : "standard";
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
    "   `reconcileOnResume`, run the reconcile gate (reconciler agent) BEFORE writing code.",
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
    "   then `set-autonomy <id> --level autonomous`.",
    "2. **Execution-time decision rule** — check every destructive action against these, in",
    "   order, before treating it as a stop:",
    "   a. Already pre-authorized in the preflight? → proceed, record via `--notify`.",
    "   b. No backup/restore path exists? → STOP regardless of autonomy level.",
    "   c. Destructive but restorable (backed up first)? → WARN — log it, proceed.",
    "   d. No context to act on? → STOP — a real gap, not a false stall.",
    "   e. Consequential and not yet notified? → record it for the end-of-epic report.",
    "3. **End-of-epic report** — on completion, report what was asked, what was done, decisions",
    "   made in the user's absence (the WARN-class log), and an explicit \"are you OK with",
    "   these?\" checkpoint, THEN run tests. Leave room to iterate — including rewriting code —",
    "   if the user is not satisfied.",
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
      L.push("");
    }
  } else {
    const running = pluginVersion();
    if (running && cmpVer(stamped, running) < 0) {
      L.push(`⚠ pm ${stamped} → ${running} since this repo was set up — run \`/pm:upgrade\` (CLAUDE.md rules and epic schema may need refreshing).`);
      L.push("");
    }
  }

  L.push("CONDUCTOR STATE — where we are and what's next");
  L.push("");

  const activeEpic = state.active ? byId[state.active] : null;
  const active = activeEpic && activeEpic.status !== "archived" ? activeEpic : null;
  if (active) {
    const autonomous = getAutonomy(active).level === "autonomous" ? ", 🤖 autonomous" : "";
    L.push(`NOW: \`${active.id}\` (${active.lane}, ${active.role}, ${active.priority}${autonomous}) — ${bar(active.progress)}`);
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
  const queued = epics.filter(e => ["queued", "untriaged"].includes(e.status) && !missing(e));
  if (queued.length) {
    L.push("NEXT UP (by priority, then lane):");
    for (const e of queued.slice(0, NEXT_CAP)) {
      const pa = e.parent ? `, parent: \`${e.parent}\`` : "";
      L.push(`  • \`${e.id}\` (${e.priority}, ${e.lane}, ${e.status}${pa}) — ${bar(e.progress)}`);
    }
    if (queued.length > NEXT_CAP) L.push(`  (+${queued.length - NEXT_CAP} more — see PROJECT.md)`);
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
    md.push(`**\`${active.id}\`** — ${active.title} (${active.role}, ${active.priority}) — ${bar(active.progress)}`);
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
    md.push(`| ${e.priority} | ${indent}\`${e.id}\` | ${e.lane} | ${e.role} | ${e.status}${e.reconcileNeeded ? " ⚠" : ""}${miss}${autonomous} | ${progress} | ${links} |`);
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
  if (existing && existing.replace(STAMP_RE, "") === content.replace(STAMP_RE, "")) {
    process.stderr.write("conductor: PROJECT.md unchanged (skipped rewrite)\n");
    return;
  }
  fs.writeFileSync(PROJECT_MD, content);
  process.stderr.write(`conductor: rendered ${PROJECT_MD}\n`);
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

  // DETERMINISTIC: if we are inside a detour, record this commit in the trail.
  if (ctx.active) {
    const m = cmd.match(/-m\s+(?:"([^"]*)"|'([^']*)'|(\S+))/);
    const subject = (m && (m[1] || m[2] || m[3])) || "";
    appendDetourLog("DETOUR-COMMIT", ctx.detourId, subject);
  }
  // Self-heal: if this commit archived the active epic (e.g. an OpenSpec archive),
  // clear the stale active pointer + stamp archived status so /pm:next advances.
  if (reconcileArchived(state)) saveState(state);
  render();

  const msg = ctx.active
    ? `Commit detected during DETOUR \`${ctx.detourId}\` (logged to detours.log). ` +
      "When the detour is done: archive it, `/pm:resume` to pop the stack, and run the " +
      "RECONCILE check on the paused parent epic. Write a one-line Honcho memory on resume."
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

// ---------- add-epic ----------

// Flags that accumulate into an array across repeated `--flag value` occurrences,
// shared by add-epic/add-many (--link), set-tracker (--intent), and set-autonomy
// (--preauthorize/--context/--notify).
const REPEATABLE_FLAGS = ["link", "intent", "preauthorize", "context", "notify"];
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
  const links = (f.link || []).filter(s => typeof s === "string").map(s => {
    const [type, epic, ...rest] = s.split(":");
    const reason = rest.join(":").trim();
    return reason ? { type, epic, reason } : { type, epic };
  });
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
  if (t) t.status = "active";
  state.active = id;
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
const UPDATE_EPIC_FLAGS = ["external-id", "external-url", "parent", "status", "priority", "title"];

/** Update an EXISTING epic's title/externalId/externalUrl/parent/status/priority.
 *  The id is POSITIONAL (parseFlags skips non-`--` tokens). Closes the tracker
 *  sync loop: after the agent creates an issue it records the key here. */
function updateEpic() {
  if (!isInitialized()) { process.stderr.write("conductor: run /pm:init first\n"); process.exit(1); }
  const argv = process.argv.slice(3);
  const id = argv[0] && !argv[0].startsWith("--") ? argv[0] : undefined;
  if (!id) { process.stderr.write("usage: conductor.mjs update-epic <id> [--title T] [--external-id X] [--external-url U] [--parent P] [--status S] [--priority P]\n"); process.exit(1); }
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

  if (str(f.title) !== undefined) epic.title = str(f.title);
  if (str(f["external-id"]) !== undefined) epic.externalId = str(f["external-id"]);
  if (str(f["external-url"]) !== undefined) epic.externalUrl = str(f["external-url"]);
  if (parent !== undefined) epic.parent = parent;
  if (status !== undefined) epic.status = status;
  if (str(f.priority) !== undefined) epic.priority = str(f.priority);

  // Keep .active consistent with status — the two must never disagree.
  if (epic.status === "active") activate(state, id);
  else if (state.active === id) state.active = null;

  saveState(state);
  render();
  process.stderr.write(`conductor: updated '${id}'\n`);
}

// ---------- autonomy ----------

/** `set-autonomy <id> [--level off|autonomous] [--preauthorize "<action>:<reason>"]
 *  [--context "<note>"] [--notify "<what>"]` — writes/merges an epic's `autonomy` block.
 *  Every flag is additive (repeated calls APPEND to preAuthorized/context/notifications,
 *  never clobber) except --level, which replaces. Pure local state write — no external
 *  calls, consistent with the engine's instruction-layer law. */
function setAutonomy() {
  if (!isInitialized()) { process.stderr.write("conductor: run /pm:init first\n"); process.exit(1); }
  const argv = process.argv.slice(3);
  const id = argv[0] && !argv[0].startsWith("--") ? argv[0] : undefined;
  if (!id) {
    process.stderr.write(
      "usage: conductor.mjs set-autonomy <id> [--level off|autonomous] " +
      "[--preauthorize \"<action>:<reason>\"] [--context \"<note>\"] [--notify \"<what>\"]\n");
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

// ---------- review mode ----------

/** `set-review-mode --mode off|standard|thorough` — a repo-level dial (not per-epic),
 *  mirroring Comet's review_mode: bounds how many fresh-context reviewer passes run and
 *  when, replacing an ad-hoc judgment call with an explicit, dedup'd budget. Pure local
 *  state write — no external calls. */
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

// ---------- dispatch ----------

const cmd = process.argv[2];
({
  init,
  render,
  brief,
  snapshot,
  "commit-nudge": commitNudge,
  sync: () => sync(false),
  "log-detour": logDetour,
  "add-epic": addEpic,
  "add-many": addMany,
  "update-epic": updateEpic,
  "set-active": setActive,
  "clear-active": clearActive,
  "set-tracker": setTracker,
  "set-autonomy": setAutonomy,
  "set-review-mode": setReviewMode,
  upgrade,
  changelog,
  rules: () => process.stdout.write(rulesBlock(currentTracker(), currentReviewMode())),
  "write-rules": writeRules,
}[cmd] || (() => {
  process.stderr.write("usage: conductor.mjs init|render|brief|snapshot|commit-nudge|sync|log-detour|add-epic|add-many|update-epic|set-active|clear-active|set-tracker|set-autonomy|set-review-mode|upgrade|changelog|rules|write-rules\n");
  process.exit(1);
}))();
