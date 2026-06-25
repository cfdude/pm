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
const KNOWN_STATUSES = ["untriaged", "queued", "active", "paused", "planned", "archived"];
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

function saveState(state) {
  fs.mkdirSync(CONDUCTOR_DIR, { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + "\n");
}

/** The running plugin's release. Env-first so tests can point at a fixture plugin.json. */
function pluginVersion() {
  const root = process.env.CLAUDE_PLUGIN_ROOT
    ? process.env.CLAUDE_PLUGIN_ROOT
    : path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const pj = readJSON(path.join(root, ".claude-plugin", "plugin.json"), null);
  return pj && pj.version ? String(pj.version) : null;
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

function isArchived(id) {
  return fs.existsSync(path.join(ARCHIVE_DIR, id));
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

/** A link is renderable only when both endpoints are strings. Guards against
 *  malformed/partial entries (incl. older schemas) that would render `undefined`. */
function validLink(l) {
  return l && typeof l.type === "string" && typeof l.epic === "string";
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

function rulesBlock() {
  return [
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
    RULES_END,
    "",
  ].join("\n");
}

function writeRules() {
  let existing = "";
  try { existing = fs.readFileSync(CLAUDE_MD, "utf8"); } catch { /* no CLAUDE.md yet */ }

  const block = rulesBlock();
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

  const active = state.active && byId[state.active];
  if (active) {
    L.push(`NOW: \`${active.id}\` (${active.lane}, ${active.role}, ${active.priority}) — ${bar(active.progress)}`);
    if (active.reconcileNeeded)
      L.push(`  ⚠ RECONCILE PENDING: re-validate this proposal before continuing (a detour touched shared code).`);
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
  const epics = resolveEpics(state);
  const md = [];

  md.push("# PROJECT — Conductor Index");
  md.push("");
  md.push("> GENERATED by the `pm` plugin — do not hand-edit. Source of truth is");
  md.push("> `.conductor/state.json` (ordering, detours, links) + OpenSpec `tasks.md` (stories).");
  md.push("> Regenerate: `/pm:status` (or `node scripts/conductor.mjs render`).");
  md.push(`> Last rendered: ${new Date().toISOString()}`);
  md.push("");

  const active = epics.find(e => e.id === state.active);
  md.push("## Now");
  md.push("");
  if (active) {
    md.push(`**\`${active.id}\`** — ${active.title} (${active.role}, ${active.priority}) — ${bar(active.progress)}`);
    if (active.reconcileNeeded) {
      md.push("");
      md.push("⚠ **Reconcile pending** — re-validate this proposal before continuing.");
    }
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
    md.push(`| ${e.priority} | ${indent}\`${e.id}\` | ${e.lane} | ${e.role} | ${e.status}${e.reconcileNeeded ? " ⚠" : ""}${miss} | ${progress} | ${links} |`);
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

function parseFlags(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const k = a.slice(2);
    const v = (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) ? argv[++i] : true;
    if (k === "link") (o.link || (o.link = [])).push(v);
    else if (k === "intent") (o.intent || (o.intent = [])).push(v);
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
  state.epics.push(epic);
  saveState(state);
  render();
  process.stderr.write(`conductor: added epic '${id}' (${lane}, ${status})\n`);
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
  render();
  process.stderr.write(`conductor: tracker set (${t.system}${t.projectKey ? ` ${t.projectKey}` : ""})\n`);
}

// ---------- migrations ----------

const MIGRATIONS = [
  {
    release: "0.3.0",
    note: "stamp explicit lane on epics (lane-agnostic schema)",
    apply(state) {
      for (const e of state.epics) if (!e.lane) e.lane = "openspec";
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
  for (const m of MIGRATIONS) {
    if (cmpVer(m.release, stamped) > 0) { m.apply(state); applied++; }
  }
  stampVersion(state);
  saveState(state);
  writeRules();
  render();
  process.stderr.write(`conductor: upgraded (${applied} migration(s)), pmVersion now ${state.pmVersion || "unknown"}\n`);
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
  "set-tracker": setTracker,
  upgrade,
  rules: () => process.stdout.write(rulesBlock()),
  "write-rules": writeRules,
}[cmd] || (() => {
  process.stderr.write("usage: conductor.mjs init|render|brief|snapshot|commit-nudge|sync|log-detour|add-epic|add-many|update-epic|set-tracker|upgrade|rules|write-rules\n");
  process.exit(1);
}))();
