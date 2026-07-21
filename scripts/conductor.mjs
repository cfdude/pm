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
import { validLink, detourContext } from "./lib/links.mjs";
import {
  activeChangeIds, planFiles, firstHeading, isArchived,
  countCheckboxes, epicProgress, resolveEpics, missing, orderQueueWithDependencies, bar,
} from "./lib/epic-progress.mjs";
import { readJSON, readStdin, isInitialized, defaultState, loadState } from "./lib/state.mjs";
import {
  pluginRoot, pluginVersion, changelogSections, changelogBetween,
  changelogAddedHeadlines,
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
import { upgrade } from "./lib/migrations.mjs";
import { changelog } from "./lib/changelog.mjs";
import { verifyWorktrees, changesets, verifyState } from "./lib/worktree-hygiene.mjs";

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
