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
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  ROOT, CONDUCTOR_DIR, STATE_PATH, BRIEF_PATH, RENDER_STAMP_PATH, DETOURS_LOG,
  PROJECT_MD, CHANGES_DIR, ARCHIVE_DIR, PLANS_DIR,
  KNOWN_LANES, KNOWN_STATUSES,
  KNOWN_REVIEW_MODES, REVIEW_MODE_RANK, LANE_RANK, laneRank,
} from "./lib/constants.mjs";
import { gitShortSha, appendDetourLog } from "./lib/git.mjs";
import { validLink, normalizeLink, detourContext } from "./lib/links.mjs";
import {
  activeChangeIds, planFiles, firstHeading, isArchived, reconcileArchived,
  countCheckboxes, epicProgress, resolveEpics, missing, orderQueueWithDependencies, bar,
} from "./lib/epic-progress.mjs";
import { readJSON, readStdin, isInitialized, defaultState, loadState, saveState } from "./lib/state.mjs";
import {
  pluginRoot, pluginVersion, changelogSections, changelogBetween,
  changelogAddedHeadlines, newestInstalledVersion, cmpVer, stampVersion,
} from "./lib/plugin-meta.mjs";
import {
  currentTracker, currentSecondaryTrackers, secondaryTrackerKey, upsertSecondaryTracker,
  removeSecondaryTracker, globalReviewMode, currentReviewMode, rulesBlock, writeRules,
} from "./lib/rules.mjs";
import { activate, daysActive, staleMarker, setActive, clearActive } from "./lib/active-pointer.mjs";
import { getAutonomy, setAutonomy } from "./lib/autonomy.mjs";
import { parseFlags, parseLinkFlags, findCyclePath, planHierarchy, parentError, addEpic } from "./lib/add-epic.mjs";
import { buildBrief } from "./lib/briefing.mjs";
import { render, normalizeForDiffSummary, writeRenderStamp } from "./lib/render.mjs";
import { init, brief, snapshot, commitNudge, sync, logDetour, honchoMemory } from "./lib/subcommands.mjs";
import { addMany } from "./lib/add-many.mjs";
import { recordReconcile } from "./lib/reconciler-writeback.mjs";
import { recordGateReview } from "./lib/gate-review-writeback.mjs";
import { updateEpic } from "./lib/update-epic.mjs";

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


// ---------- tracker ----------

/** Write/merge the `tracker` block (role: primary, default) or upsert/remove an entry in
 *  `state.secondaryTrackers` (role: secondary). Pure local state write — the engine NEVER
 *  contacts the tracker; it only records that one is in use so the instructions it emits (rules
 *  block + brief) can assign sync work to the interactive agent. */
function setTracker() {
  if (!isInitialized()) { process.stderr.write("conductor: run /pm:init first\n"); process.exit(1); }
  const f = parseFlags(process.argv.slice(3));
  const str = (v) => (typeof v === "string" ? v : undefined);
  const state = loadState();
  const role = str(f.role) || "primary";
  if (role !== "primary" && role !== "secondary") {
    process.stderr.write("conductor: --role must be primary or secondary\n"); process.exit(1);
  }

  if (role === "secondary") {
    const system = str(f.system);
    const repo = str(f.repo);
    const projectKey = str(f.project);
    if (!system) {
      process.stderr.write("conductor: set-tracker --role secondary requires --system\n"); process.exit(1);
    }
    if (!repo && !projectKey) {
      process.stderr.write("conductor: set-tracker --role secondary requires --repo or --project\n"); process.exit(1);
    }
    if (f.remove) {
      const removed = removeSecondaryTracker(state, { system, repo, projectKey });
      if (!removed) {
        process.stderr.write(`conductor: no matching secondary tracker (${system}${repo ? ` ${repo}` : ` ${projectKey}`})\n`);
        process.exit(1);
      }
      saveState(state);
      writeRules();
      render();
      process.stderr.write(`conductor: secondary tracker removed (${system}${repo ? ` ${repo}` : ` ${projectKey}`})\n`);
      return;
    }
    const entry = { system, role: "secondary" };
    if (repo) entry.repo = repo;
    if (projectKey) entry.projectKey = projectKey;
    if (str(f.instance) !== undefined) entry.instance = str(f.instance);
    if (str(f.mechanism) !== undefined) entry.mechanism = str(f.mechanism);
    upsertSecondaryTracker(state, entry);
    saveState(state);
    writeRules();
    render();
    process.stderr.write(`conductor: secondary tracker set (${entry.system}${entry.repo ? ` ${entry.repo}` : ` ${entry.projectKey}`})\n`);
    return;
  }

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

/** `verify-worktrees` — cross-references `git worktree list` against epic status (and, since
 *  the `df-verify-worktrees-merged-not-just-archived` fix, actual merge state) to catch a
 *  hierarchy-dispatch worktree (branch `hierarchy-child/<epic-id>`, see the epic-hierarchy
 *  orchestration design's worktree-isolation addendum) that was never cleaned up after its
 *  work landed. Two independent triggers, either one is enough to flag a worktree:
 *    - `epic-archived` — the epic's status field says it's done (the original check).
 *    - `branch-merged` — the worktree's branch tip is already an ancestor of the current
 *      branch's HEAD (`git merge-base --is-ancestor`), regardless of what the epic's status
 *      field says. This catches the case where `git branch -d` was attempted after a merge
 *      and failed with "used by worktree" — the branch is fully merged but the worktree
 *      itself (and often the epic's status bookkeeping) was never cleaned up.
 *  Pure read — flags, never deletes, since a worktree could in principle still hold
 *  in-progress work the bookkeeping hasn't caught up with. Bakes worktree hygiene into the
 *  plugin itself (checkable on any fresh install) rather than depending on a user's own
 *  personal discipline/CLAUDE.md. Zero-dependency: shells out to `git worktree list
 *  --porcelain` and `git merge-base --is-ancestor` only; gracefully returns no orphans if
 *  listing worktrees fails (e.g. this isn't a git repo at all). */
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
  let currentHead = null;
  for (const line of out.split("\n")) {
    if (line.startsWith("worktree ")) { currentPath = line.slice("worktree ".length).trim(); currentHead = null; continue; }
    if (line.startsWith("HEAD ")) { currentHead = line.slice("HEAD ".length).trim(); continue; }
    const m = line.match(/^branch refs\/heads\/hierarchy-child\/(.+)$/);
    if (m && currentPath) {
      const epicId = m[1];
      const epic = byId.get(epicId);
      const branch = `hierarchy-child/${epicId}`;
      const archived = !!(epic && epic.status === "archived");
      const merged = !!(currentHead && isAncestorOfCurrentHead(currentHead));
      if (archived || merged) {
        const reasons = [];
        if (archived) reasons.push("epic-archived");
        if (merged) reasons.push("branch-merged");
        orphaned.push({ path: currentPath, branch, epicId, reasons });
      }
      currentPath = null;
      currentHead = null;
    }
  }
  process.stdout.write(JSON.stringify({ orphaned }) + "\n");
}

/** True if `sha` is an ancestor of the current branch's HEAD (i.e. already merged in) —
 *  used by `verifyWorktrees()`'s `branch-merged` trigger. Returns false (never throws) if
 *  the check itself fails for any reason (detached/missing ref, shallow clone, etc.) so a
 *  git-plumbing hiccup degrades to "not flagged" rather than crashing verify-worktrees. */
function isAncestorOfCurrentHead(sha) {
  try {
    execSync(`git merge-base --is-ancestor ${sha} HEAD`, { cwd: ROOT, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
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
// df-engine-banner-noise-every-invocation: the banner is suppressed by default whenever
// CLAUDE_PROJECT_DIR is set (self-hosting/dev context -- the stale-cache scenario this banner
// exists to guard against is unlikely there) -- set PM_VERBOSE_ENGINE_BANNER=1 to force it
// back on. PM_QUIET_ENGINE_BANNER=1 continues to work as an explicit suppress outside that
// context too (back-compat with the pre-fix default-on behavior).
const showEngineBanner = process.env.PM_VERBOSE_ENGINE_BANNER
  ? true
  : (process.env.PM_QUIET_ENGINE_BANNER || process.env.CLAUDE_PROJECT_DIR) ? false : true;
if (showEngineBanner) {
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
    process.stdout.write(rulesBlock(currentTracker(), currentReviewMode(epicId), currentSecondaryTrackers()));
  },
  "write-rules": writeRules,
}[cmd] || (() => {
  process.stderr.write("usage: conductor.mjs init|render|brief|snapshot|commit-nudge|sync|log-detour|honcho-memory|add-epic|add-many|update-epic|remove-epic|set-active|clear-active|set-tracker|set-lane-routing|suggest-lane|set-autonomy|record-reconcile|record-gate-review|set-review-mode|set-gate-guard|gate-guard|plan-hierarchy|verify-worktrees|verify-state|changesets|upgrade|changelog|rules|write-rules\n");
  process.exit(1);
}))();
