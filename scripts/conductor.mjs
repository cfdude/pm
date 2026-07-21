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
  KNOWN_STATUSES,
  LANE_RANK, laneRank,
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
import { epicSummaryTable, removeEpic } from "./lib/remove-epic.mjs";
import { setTracker } from "./lib/tracker.mjs";
import { laneMatchTest, setLaneRouting, suggestLane } from "./lib/lane-routing.mjs";
import { setReviewMode } from "./lib/review-mode.mjs";
import { setGateGuard, gateGuardCheck } from "./lib/gate-guard.mjs";

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
