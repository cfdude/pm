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
import path from "node:path";
import { execSync } from "node:child_process";

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const CONDUCTOR_DIR = path.join(ROOT, ".conductor");
const STATE_PATH = path.join(CONDUCTOR_DIR, "state.json");
const BRIEF_PATH = path.join(CONDUCTOR_DIR, "brief.txt");
const DETOURS_LOG = path.join(CONDUCTOR_DIR, "detours.log");
const PROJECT_MD = path.join(ROOT, "PROJECT.md");
const CLAUDE_MD = path.join(ROOT, "CLAUDE.md");
const CHANGES_DIR = path.join(ROOT, "openspec", "changes");
const ARCHIVE_DIR = path.join(CHANGES_DIR, "archive");

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

function isArchived(id) {
  return fs.existsSync(path.join(ARCHIVE_DIR, id));
}

/** Count [ ] / [x] checkboxes in a change's tasks.md. Source of truth for stories. */
function storyProgress(id) {
  const f = path.join(CHANGES_DIR, id, "tasks.md");
  let total = 0, done = 0;
  try {
    for (const line of fs.readFileSync(f, "utf8").split("\n")) {
      const m = line.match(/^\s*[-*]\s+\[([ xX])\]/);
      if (m) { total++; if (m[1].toLowerCase() === "x") done++; }
    }
  } catch { /* no tasks.md yet */ }
  return { done, total };
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
    out.push({ ...meta, progress: storyProgress(id), present: true });
  }
  for (const e of state.epics) {
    if (!onDisk.has(e.id)) {
      out.push({ ...e, progress: storyProgress(e.id),
        status: isArchived(e.id) ? "archived" : e.status, present: false });
    }
  }
  const rank = { P0: 0, P1: 1, P2: 2, P3: 3, "P?": 9 };
  out.sort((a, b) => (rank[a.priority] ?? 9) - (rank[b.priority] ?? 9));
  return out;
}

function bar({ done, total }) {
  return total ? `${done}/${total} stories` : "no tasks.md";
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
    "This repo is managed by the `pm` plugin. The conductor sits ABOVE OpenSpec (epics =",
    "proposals; stories = `tasks.md` checkboxes) and Superpowers. Follow these rules:",
    "",
    "1. **Detours** — when something blocks the active epic, CLASSIFY before fixing:",
    "   - *Minimal* (small, self-contained, no design ambiguity): fix → test → commit → push,",
    "     then run `/pm:detour --minimal \"<what>\"` so it is recorded in `.conductor/detours.log`.",
    "     Then resume.",
    "   - *Substantial* (own design / changes shared behavior / multi-step): run `/pm:detour`.",
    "     It becomes its own OpenSpec proposal; PUSH the current epic onto the detour stack in",
    "     `.conductor/state.json` with a concrete reason and `reconcileOnResume`.",
    "2. **State of record is `.conductor/state.json`.** After any change to epics, status,",
    "   priority, or the detour stack, re-render with `/pm:status`. Never hand-edit `PROJECT.md`.",
    "3. **Resuming after a detour** — use `/pm:resume`. If the popped frame had",
    "   `reconcileOnResume`, run the reconcile gate (reconciler agent) BEFORE writing code.",
    "4. **Honcho** — on every PUSH and POP, also write a one-line memory to Honcho",
    "   (\"paused X for Y\" / \"resumed X, reconciled vs Y\") so the relationship survives outside",
    "   this repo.",
    "5. **Keep `tasks.md` checkboxes truthful** — they are the source of truth for story progress.",
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

  L.push("CONDUCTOR STATE — where we are and what's next");
  L.push("");

  const active = state.active && byId[state.active];
  if (active) {
    L.push(`NOW: \`${active.id}\` (${active.role}, ${active.priority}) — ${bar(active.progress)}`);
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

  const queued = epics.filter(e => ["queued", "untriaged"].includes(e.status) && e.present);
  if (queued.length) {
    L.push("NEXT UP (by priority):");
    for (const e of queued) L.push(`  • \`${e.id}\` (${e.priority}, ${e.status}) — ${bar(e.progress)}`);
    L.push("");
  }

  const links = epics.flatMap(e => (e.links || []).map(l => ({ from: e.id, ...l })));
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
  md.push("| Priority | Epic (OpenSpec change) | Role | Status | Stories | Links |");
  md.push("|----------|------------------------|------|--------|---------|-------|");
  for (const e of epics) {
    const links = (e.links || []).map(l => `${l.type}→${l.epic}`).join("; ") || "-";
    md.push(`| ${e.priority} | \`${e.id}\` | ${e.role} | ${e.status}${e.reconcileNeeded ? " ⚠" : ""} | ${bar(e.progress)} | ${links} |`);
  }
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

  fs.writeFileSync(PROJECT_MD, md.join("\n"));
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
  sync(true);        // pull in existing openspec changes as untriaged
  writeRules();      // install/refresh the CLAUDE.md rules block
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
  const known = new Set(state.epics.map(e => e.id));
  let added = 0;
  for (const id of activeChangeIds()) {
    if (!known.has(id)) {
      state.epics.push({ id, title: id, priority: "P?", status: "untriaged", role: "epic", links: [], reconcileNeeded: false });
      added++;
    }
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
  rules: () => process.stdout.write(rulesBlock()),
  "write-rules": writeRules,
}[cmd] || (() => {
  process.stderr.write("usage: conductor.mjs init|render|brief|snapshot|commit-nudge|sync|log-detour|rules|write-rules\n");
  process.exit(1);
}))();
