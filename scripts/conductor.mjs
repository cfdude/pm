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
 *   commit-nudge   PostToolUse(Bash): fires on EVERY Bash call and decides by OBSERVING the
 *                  repo — a HEAD watermark (.conductor/commit-watch.json) plus the reflog
 *                  action — never by reading the command text (see lib/commit-watch.mjs).
 *                  When a commit really landed: log detour commits + nudge; also auto-logs an
 *                  AUTO-DETOUR entry when a small fix/chore commit's diff shape looks like an
 *                  unlogged minimal detour AND an epic is active (see
 *                  looksLikeUnloggedMinimalDetour)
 *   sync           add any new openspec changes to state.json as "untriaged"
 *   triage         INTAKE: the mechanical half of admitting an ask — a candidate set of
 *                  existing epics sharing distinctive vocabulary with it, the repo's lane
 *                  suggestion, and the backlog's shape. Emits `verdict: null`: whether two
 *                  asks are the SAME ask is judgment, and judgment is the agent's.
 *   log-detour "x" record a MINIMAL detour in detours.log (with the current git SHA)
 *   push-detour    the SUBSTANTIAL detour's PUSH, as a verb rather than the hand-edit of
 *                  state.json it used to be: pauses the parent, pushes the frame, writes both
 *                  protocol links, activates the detour and emits the Honcho line — one guarded
 *                  write, so it inherits the conflict guard and the read-back verification
 *   pop-detour     the matching POP. Removes the top frame, resumes the epic, and writes
 *                  `reconcileNeeded` in the SAME write — the frame is gone before reconciliation
 *                  runs, so a second write would let the self-heal clear the obligation
 *   honcho-memory  <push|pop> <epicId> "<reason>" — print + log the ready-to-copy Honcho line
 *   rules          print the CLAUDE.md rules block to stdout
 *   write-rules    insert/refresh the rules block in ./CLAUDE.md (idempotent)
 *   release        create/amend a release, and associate epics with it (membership is
 *                  one-way: `epic.release`, at most one)
 *   record-cross-spec-review  record the RELEASE-scope review verdict — do this release's specs
 *                  agree WITH EACH OTHER? (Gate 1/Gate 2 each take one CHANGE as their unit)
 *   recover-created-at  fill in the registration date of every epic that predates the
 *                  field, from the commit that first introduced its id into state.json.
 *                  Local history only; unrecoverable stays ABSENT and re-attemptable,
 *                  which is why it is a re-runnable verb and not a MIGRATIONS body
 *   unconsidered-outcomes  READ-ONLY: the archived epics whose outcome NOBODY CONSIDERED —
 *                  an engine stamp carrying `unknown` — each with the invocation that would
 *                  record a disposition. The spec says an agent ASKS the engine; this is the ask
 *   integrity      READ-ONLY audit of the record itself — shapes that cannot be true
 *                  (reports; never writes state, never blocks a command)
 *   verify-state   fail loudly if state.json's mtime is newer than the last render's stamp
 *                  (a mechanical check for an undetected hand-edit)
 *   verify-specs   READ-ONLY inventory: for every design document under a root (default
 *                  docs/superpowers/specs, override with --root), how many epics were drawn
 *                  from it, plus the epics naming a document that is not on disk. An
 *                  uncovered document is INVENTORY, not a finding — see lib/verify-specs.mjs
 *
 * WHICH OF THESE MUTATE THE WORKING TREE is declared in lib/verb-effects.mjs — read-only vs
 * mutates, per verb, with the read-only half behaviourally verified by the suite (#85).
 * `brief` is the read; `render` writes PROJECT.md and the render stamp whenever there is
 * anything to render, so it is not the verb to reach for when inspecting a repo you do not own.
 *
 * No external dependencies. Node 18+. OpenSpec optional (uses the filesystem).
 *
 * The plugin's hooks run in EVERY project at user scope, so brief/snapshot/
 * commit-nudge stay silent until a project runs `/pm:init` (presence of
 * .conductor/state.json). This mirrors OpenSpec being dormant until `openspec init`.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { pluginVersion } from "./lib/plugin-meta.mjs";
import {
  currentTracker, currentSecondaryTrackers, currentReviewMode, rulesBlock, writeRules,
} from "./lib/rules.mjs";
import { resolvePlatform, assertKnownPlatform, platformFlag, resolveAndRecordPlatform, rulesTarget } from "./lib/platform.mjs";
import { loadState, conflictExitCode, readStdin } from "./lib/state.mjs";
import { ROOT, warnRootDivergence, warnDetachedTree } from "./lib/constants.mjs";
import { isDetachedTree } from "./lib/git.mjs";
import { VERB_EFFECTS } from "./lib/verb-effects.mjs";
import { checkCommandLine } from "./lib/argv-surface.mjs";
import { setActive, clearActive } from "./lib/active-pointer.mjs";
import { setAutonomy } from "./lib/autonomy.mjs";
import { parseFlags, planHierarchy, addEpic, requireFlagValues } from "./lib/add-epic.mjs";
import { render } from "./lib/render.mjs";
import { init, brief, snapshot, commitNudge, sync, logDetour, honchoMemory } from "./lib/subcommands.mjs";
import { pushDetour, popDetour } from "./lib/detour-stack.mjs";
import { addMany } from "./lib/add-many.mjs";
import { recordReconcile } from "./lib/reconciler-writeback.mjs";
import { recordGateReview } from "./lib/gate-review-writeback.mjs";
import { recordTrackerRefresh } from "./lib/tracker-refresh-writeback.mjs";
import { updateEpic } from "./lib/update-epic.mjs";
import { reorder } from "./lib/rank.mjs";
import { integrity } from "./lib/integrity.mjs";
import { removeEpic } from "./lib/remove-epic.mjs";
import { setTracker } from "./lib/tracker.mjs";
import { setLaneRouting, suggestLane } from "./lib/lane-routing.mjs";
import { triage } from "./lib/triage.mjs";
import { setReviewMode } from "./lib/review-mode.mjs";
import { setGateGuard, gateGuardCheck } from "./lib/gate-guard.mjs";
import { lessonAdvice } from "./lib/lessons.mjs";
import { upgrade } from "./lib/migrations.mjs";
import { changelog } from "./lib/changelog.mjs";
import { release, recordCrossSpecReview } from "./lib/releases.mjs";
import { verifyWorktrees, changesets, verifyState } from "./lib/worktree-hygiene.mjs";
import { verifySpecs } from "./lib/verify-specs.mjs";
import { claim, unclaim, owners } from "./lib/claims.mjs";
import { activityEnabled, appendEvents, diffEvents, setActivityLog } from "./lib/activity-log.mjs";
import { activity } from "./lib/activity-report.mjs";
import { purgeLogs } from "./lib/purge-logs.mjs";
import { isInitialized } from "./lib/state.mjs";
import { resolveSession } from "./lib/session-identity.mjs";
import { delegateToCheckout } from "./lib/self-hosting.mjs";
import { recoverCreatedAt } from "./lib/created-at.mjs";
import { unconsideredOutcomesReport } from "./lib/unconsidered.mjs";

// ---------- self-hosting handoff (gh-134) ----------
//
// hooks.json and every command doc invoke this engine through ${CLAUDE_PLUGIN_ROOT} — the
// INSTALLED plugin. When the project being worked in IS a pm checkout, that engine is behind
// the working tree and renders PROJECT.md as it looked a release ago, unprompted, on every
// commit. Hand off to the checkout's engine before ANY other work: before the banner, before
// --help, before dispatch, so the delegated process owns the whole invocation and nothing is
// printed twice.
//
// OPT-IN ONLY, via PM_ENGINE_DELEGATION naming the checkout's absolute path. This is the single
// place the engine can execute code it did not ship, and the four hooks reach it in every
// project on the machine — see the trust-boundary note at the top of lib/self-hosting.mjs
// before loosening the condition.
const delegated = delegateToCheckout({ selfPath: fileURLToPath(import.meta.url) });
if (delegated !== null) process.exit(delegated);

// ---------- dispatch ----------

const cmd = process.argv[2];

const USAGE = "usage: conductor.mjs init|render|brief|snapshot|commit-nudge|sync|log-detour|push-detour|pop-detour|honcho-memory|add-epic|add-many|update-epic|remove-epic|reorder|set-active|clear-active|set-tracker|set-lane-routing|suggest-lane|triage|set-autonomy|record-reconcile|record-gate-review|record-cross-spec-review|record-tracker-refresh|set-review-mode|release|set-gate-guard|gate-guard|lesson-advice|plan-hierarchy|claim|unclaim|owners|activity|set-activity-log|purge-logs|verify-worktrees|verify-state|verify-specs|integrity|changesets|recover-created-at|unconsidered-outcomes|upgrade|changelog|rules|write-rules|rules-target\n";

// ---------- the command-line check (every-verb-refuses-what-it-does-not-read) ----------
//
// ONE pre-dispatch decision about what the command line may carry, for every dispatched verb, made
// in lib/argv-surface.mjs from the registry and acted on HERE — before the root-divergence warning,
// the banner, the activity snapshot and dispatch, so nothing it refuses can have written anything.
//
// It replaces gh-187's short-circuit, which honoured a help token only at argv position 0/1. That
// narrowing turned "exit 0, writes nothing" into "exit 0, writes ANYWAY" for every help token after a
// positional: `remove-epic e2 --help` removed e2 and `set-gate-guard off --help` disarmed the guard.
// A help token in any non-value position now prints that verb's help and exits 0 having written
// nothing; one in a VALUE position is still refused, because there it was data (#187).
//
// An UNKNOWN verb keeps today's behaviour exactly: a help token first → global usage, exit 0;
// otherwise it falls through to dispatch's USAGE, exit 1, having warned where it is pointed.
const helpAt = process.argv.slice(2).findIndex(a => a === "--help" || a === "-h");
if (!cmd || (!Object.prototype.hasOwnProperty.call(VERB_EFFECTS, cmd) && (helpAt === 0 || helpAt === 1))) {
  process.stdout.write(USAGE);
  process.exit(0);
}
{
  const verdict = checkCommandLine(cmd, process.argv, { initialized: isInitialized() });
  if (verdict.kind === "help") {
    // #158 — VERB-SCOPED help, projected from the same declarations the check enforces.
    const { verbHelp } = await import("./lib/help.mjs");
    process.stdout.write(verbHelp(cmd));
    process.exit(0);
  }
  if (verdict.kind === "refuse") {
    // A hook verb's payload is on stdin. Drain it before refusing, as gate-guard and lesson-advice
    // do on their own paths, so the hook writer is not left holding a pipe (an EPIPE on its side).
    if (VERB_EFFECTS[cmd].hook === true) readStdin();
    process.stderr.write(verdict.message + "\n");
    process.exit(1);
  }
}

// gh#82 — is ROOT the repository the caller is standing in?  Emitted here, ONCE, and for every
// verb: after the --help short-circuit (a help flag must have no side effect and nothing to warn
// about) and after the self-hosting handoff (the delegated child owns the whole invocation and
// prints it there instead of twice). Before the banner, because it outranks it.
//
// EVERY VERB THAT WRITES, including the hooks — `commit-nudge` fires on every Bash tool call
// and writes detours.log and state.json, so a redirected hook is failure mode 1 from the issue,
// not a quiet read. That argument is about the MUTATING hooks and was never an argument for
// warning on a read: this line said "WRITING A DIFFERENT REPOSITORY" ahead of `integrity`, whose
// own output two lines later reads "Findings are reported, never repaired: nothing here writes
// state" — verified writing nothing (state.json md5 identical before and after, working tree
// clean). Crying wolf on the 16 read-only verbs is what teaches a reader to skim past it on the
// 32 where it is the difference between inspecting another repo and mutating it.
//
// The classification is NOT a list kept here. lib/verb-effects.mjs already declares
// `effect: "read-only" | "mutates"` for every verb, and conductor-25 asserts set-equality
// between that table and the dispatch object BELOW, read out of this file's source — so a verb
// added without an entry fails the build and this gate cannot go stale. An UNKNOWN verb has no
// entry, reads as not-read-only, and still warns: it falls through to USAGE having done nothing,
// but a misspelling under a redirected CLAUDE_PROJECT_DIR is exactly when a caller wants to be
// told where they are pointed.
//
// The predicate is cheap (two realpaths and one existsSync) and, by construction, silent in
// every case except two live conductors with the wrong one selected.
if (VERB_EFFECTS[cmd]?.effect !== "read-only") {
  warnRootDivergence();
  // gh#175. THE SAME GATE, deliberately. 0.40.0 stopped the divergence warning above crying wolf
  // on the 17 read-only verbs; a second warning built beside it must inherit that gate or it
  // reintroduces the defect one release later. `!== "read-only"` and not `=== "mutates"`: an
  // unrecognised verb has no entry, reads as not-read-only, and warns — which is the same
  // deliberate choice the line above makes, and conductor-25 asserts set-equality between
  // VERB_EFFECTS and the dispatch object so a new verb cannot arrive undeclared.
  // A verb whose whole write set is session bookkeeping writes NOTHING here, so there is no
  // discarded write to warn about — and one of them runs on every Bash tool call.
  if (isDetachedTree() && !VERB_EFFECTS[cmd]?.detachedNoOp) warnDetachedTree(VERB_EFFECTS[cmd]?.writes);
}

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
// ---------- #111: the activity log's ONE instrumentation point ----------
//
// Events are DERIVED by diffing state.json across this whole invocation, rather than emitted by
// hand from each of the ~25 verbs that write state. That is not a shortcut: a list of emit sites
// typed from memory goes stale the moment a verb is added, and a verb that forgot to emit would
// be invisible in exactly the log built to find invisible things. The diff cannot forget.
//
// process.on("exit"), NOT try/finally. Verified mechanically before choosing the shape:
// `rg -n "process\.exit" scripts/lib/` finds one MUTATING verb that writes state and then exits
// non-zero (update-epic's post-write attribution read-back). process.exit() skips `finally` and
// runs exit handlers, so a `finally` would drop exactly the invocation most worth recording.
//
// Placed AFTER the --help short-circuit (a help flag must have no side effect, and there is
// nothing to diff) and BEFORE dispatch, so the snapshot is genuinely the pre-verb state.
//
// EVERY call here is guarded. Observability must never break the run it observes — the rule
// lib/write-conflicts.mjs opens with, for the same reason: a throw would convert a working
// command into a visible failure, and would fire when the filesystem is already in trouble.
try {
  if (isInitialized()) {
    const activityBefore = loadState();
    if (activityEnabled(activityBefore)) {
      const session = resolveSession(parseFlags(process.argv.slice(3)));
      process.on("exit", () => {
        try {
          const after = loadState();
          // No revision movement means no write happened; recording a line for it would make
          // every read verb a log entry and drown the signal the log exists for.
          if (after.revision === activityBefore.revision) return;
          appendEvents(diffEvents(activityBefore, after, { verb: cmd, session }));
        } catch { /* never break the run being observed */ }
      });
    }
  }
} catch { /* ditto — including a state.json this process cannot read at all */ }

try {
({
  init,
  render,
  brief,
  snapshot,
  "commit-nudge": commitNudge,
  sync: () => sync(false),
  "log-detour": logDetour,
  "push-detour": pushDetour,
  "pop-detour": popDetour,
  "honcho-memory": honchoMemory,
  "add-epic": addEpic,
  "add-many": addMany,
  "update-epic": updateEpic,
  "remove-epic": removeEpic,
  reorder,
  "set-active": setActive,
  "clear-active": clearActive,
  "set-tracker": setTracker,
  "set-lane-routing": setLaneRouting,
  "suggest-lane": suggestLane,
  triage,
  "set-autonomy": setAutonomy,
  "record-reconcile": recordReconcile,
  "record-gate-review": recordGateReview,
  "record-cross-spec-review": recordCrossSpecReview,
  "record-tracker-refresh": recordTrackerRefresh,
  "set-review-mode": setReviewMode,
  release,
  "set-gate-guard": setGateGuard,
  "gate-guard": gateGuardCheck,
  "lesson-advice": lessonAdvice,
  "plan-hierarchy": planHierarchy,
  "verify-worktrees": verifyWorktrees,
  "verify-state": verifyState,
  "verify-specs": verifySpecs,
  claim,
  unclaim,
  owners,
  activity,
  "set-activity-log": setActivityLog,
  "purge-logs": purgeLogs,
  "recover-created-at": recoverCreatedAt,
  "unconsidered-outcomes": unconsideredOutcomesReport,
  integrity,
  changesets,
  upgrade,
  changelog,
  rules: () => {
    const f = parseFlags(process.argv.slice(3));
    requireFlagValues("rules", f);
    const epicId = typeof f.epic === "string" ? f.epic : undefined;
    const declared = platformFlag(process.argv.slice(3));
    if (declared) assertKnownPlatform(declared);
    const rulesPlatform = resolvePlatform({ platform: declared }, loadState());
    process.stdout.write(rulesBlock(currentTracker(), currentReviewMode(epicId), currentSecondaryTrackers(), rulesPlatform));
  },
  "write-rules": () => {
    // #152: `--platform` is read straight off argv by platformFlag(), which treats a valueless
    // occurrence as absent — so `write-rules --platform` silently wrote the RECORDED platform's
    // rules block while looking answered. Parsed and checked here for that reason alone; the
    // resolution below is unchanged.
    requireFlagValues("write-rules", parseFlags(process.argv.slice(3)));
    const { platform, switched } = resolveAndRecordPlatform();
    writeRules(platform);
    if (switched) process.stderr.write(`conductor: platform: ${platform}\n`);
  },
  // Read-only query: which file does this platform's rules block belong in? Exists so a
  // CONSUMER (evals/observe.py) never has to mirror PLATFORM_RULES_CHAIN -- a second copy of
  // platform knowledge is exactly the drift this epic was filed to remove. Deliberately does
  // NOT record the platform: a query must not mutate state the way write-rules does.
  "rules-target": () => {
    requireFlagValues("rules-target", parseFlags(process.argv.slice(3)));
    const declared = platformFlag(process.argv.slice(3));
    if (declared) assertKnownPlatform(declared);
    process.stdout.write(rulesTarget(resolvePlatform({ platform: declared }, loadState()), ROOT) + "\n");
  },
}[cmd] || (() => {
  process.stderr.write(USAGE);
  process.exit(1);
}))();
} catch (err) {
  // A conflict is retryable; a validation error is not. They must not share an exit code.
  // Anything else is re-thrown UNCHANGED so a real crash keeps its stack -- swallowing it here
  // would trade one silent failure for another.
  const code = conflictExitCode(err);
  if (code !== null) {
    process.stderr.write(`conductor: ${err.message}\n`);
    process.exit(code);
  }
  throw err;
}
