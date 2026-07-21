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
import { ROOT, CONDUCTOR_DIR, BRIEF_PATH, PLANS_DIR } from "./constants.mjs";

export function init() {
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

export function brief() {
  if (!isInitialized()) return;          // DORMANT until /pm:init
  const context = buildBrief(loadState());
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context },
  }));
}

export function snapshot() {
  if (!isInitialized()) return;          // DORMANT until /pm:init
  const state = loadState();
  render();
  fs.mkdirSync(CONDUCTOR_DIR, { recursive: true });
  fs.writeFileSync(BRIEF_PATH, buildBrief(state) + "\n");
  process.stderr.write("conductor: snapshot written before compaction\n");
}


/** Files changed by HEAD, via `git diff-tree`. Returns null if git isn't usable here. */
export function headChangedFiles() {
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
export function looksLikeUnloggedMinimalDetour(subject, activeEpicId) {
  if (!/^(fix|chore)(\([^)]*\))?:\s/.test(subject)) return false;
  if (activeEpicId && subject.includes(`(${activeEpicId})`)) return false;
  const files = headChangedFiles();
  if (files === null || files.length === 0 || files.length > 3) return false;
  if (files.every((f) => CONDUCTOR_OWN_FILES.has(f))) return false;
  return true;
}

export function commitNudge() {
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

export function sync(quiet = false) {
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

export function logDetour() {
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
export function honchoMemoryLine(action, epicId, reason) {
  if (action === "push") return `paused ${epicId} for ${reason}`;
  if (action === "pop") return `resumed ${epicId}, reconciled vs ${reason}`;
  throw new Error(`honchoMemoryLine: unknown action '${action}' (expected 'push' or 'pop')`);
}

/** `honcho-memory <push|pop> <epicId> "<reason>"` — prints the ready-to-copy Honcho memory
 *  line to stdout (for the interactive agent to paste into its actual Honcho MCP call) AND
 *  appends a timestamped copy to `.conductor/honcho-memories.log`, so there's a durable local
 *  record of what was emitted even if the agent forgets to actually send it. */
export function honchoMemory() {
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
