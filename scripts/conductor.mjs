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
 *   commit-nudge   PostToolUse/PostToolUseFailure(Bash): fires after EVERY Bash call and decides by OBSERVING the
 *                  repo — a reflog anchor (.conductor/commit-observe.json) and every commit
 *                  entry after it — never by reading the command text (see lib/commit-watch.mjs).
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
 *   retract-detour <sha> --reason "why"  retract the automatic AUTO-DETOUR/DETOUR-COMMIT rows of
 *                  one commit: appends a RETRACTED row, removes nothing, re-renders PROJECT.md
 *   push-detour    the SUBSTANTIAL detour's PUSH, as a verb rather than the hand-edit of
 *                  state.json it used to be: pauses the parent, pushes the frame, writes both
 *                  protocol links, activates the detour and emits the Honcho line — one guarded
 *                  write, so it inherits the conflict guard and the read-back verification
 *   drop-detour    the INVERSE push-detour never shipped. Removes the frame naming an epic
 *                  WHEREVER it sits in the stack, for the case pop cannot serve — the paused epic
 *                  is not coming back. Never resumes it, never moves the pointer, and ENDS the
 *                  reconcile obligation the push armed rather than answering it.
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

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pluginVersion } from "./lib/plugin-meta.mjs";
import {
  currentTracker, currentSecondaryTrackers, currentReviewMode, rulesBlock, writeRules,
} from "./lib/rules.mjs";
import { resolvePlatform, assertKnownPlatform, platformFlag, resolveAndRecordPlatform, rulesTarget } from "./lib/platform.mjs";
import { loadState, readStdin } from "./lib/state.mjs";
import { refusalFor } from "./lib/refusal.mjs";
import { CommandExit } from "./lib/command-exit.mjs";
import { engineRoot, escapeControls, warnRootDivergence, warnDetachedTree } from "./lib/constants.mjs";
import { isDetachedTree } from "./lib/git.mjs";
import { VERB_EFFECTS } from "./lib/verb-effects.mjs";
import { checkCommandLine } from "./lib/argv-surface.mjs";
import { setActive, clearActive } from "./lib/active-pointer.mjs";
import { setAutonomy } from "./lib/autonomy.mjs";
import { parseFlags, planHierarchy, addEpic, requireFlagValues } from "./lib/add-epic.mjs";
import { render } from "./lib/render.mjs";
import { init, brief, snapshot, commitNudge, sync, logDetour, retractDetour, honchoMemory } from "./lib/subcommands.mjs";
import { pushDetour, popDetour, dropDetour } from "./lib/detour-stack.mjs";
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
import { currentArgv, currentEnv, errStream, normalizeStdin, outStream, setInvocation, stdinSource } from "./lib/invocation.mjs";

/** This module's own absolute path. `main()` hands it to the delegation handoff, the banner names
 *  its directory, and the tail compares it against `process.argv[1]` to decide whether this module
 *  was RUN or IMPORTED. */
const SELF = fileURLToPath(import.meta.url);

// ---------- THE ENTRY POINT (0.47.0, engine-invocation) ----------
//
// `main(argv, io)` returns the status the binary exits with, and NOTHING it does ends the calling
// process. Every refusal leaves it as a thrown CommandExit (lib/command-exit.mjs) caught at the one
// dispatch site below, and the five module-load side effects that used to run on import — the
// delegation handoff, the root-divergence warning, the detached-tree warning, the engine banner and
// the activity log's exit handler — moved in here with it, because each of them is per-INVOCATION
// work that would otherwise happen once per PROCESS, against the real environment and the real
// streams, while main() was still being entered.
//
// `io` carries `{ cwd, env, stdin, stdout, stderr }`. Everything below reads those, through
// lib/invocation.mjs — never the process's own — so two calls in one process are independent and
// nothing an invocation prints reaches the process's stdout or stderr.
//
// The module still runs as `node scripts/conductor.mjs …`: the tail below calls main() with this
// process's own values and assigns the result to `process.exitCode` — never `process.exit()`, whose
// reason is recorded there.
export async function main(argv, io = {}) {
  const cwd = io.cwd ?? process.cwd();
  const env = io.env ?? process.env;
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const stdin = normalizeStdin(io.stdin);
  const ctx = {
    // Index 0 and 1 are the program and the script, exactly as `process.argv` shapes them, so every
    // existing `argv[2]` / `argv.slice(3)` reader is unchanged. It is a COPY: the pre-dispatch check
    // rewrites it in place, and engine-invocation guarantees the caller's own arguments are never
    // modified.
    argv: ["node", SELF, ...argv],
    cwd, env, stdin, stdout, stderr,
    root: env.CLAUDE_PROJECT_DIR || cwd,
    // 4.2 — the git gateway. `io.git` is how a caller hands over a DOUBLE (the assertion half's
    // fake); when it is absent, `gitOps()` builds the real one over THIS context, so an in-process
    // invocation without a fake still reads the invocation's root rather than the process's.
    git: io.git,
  };
  setInvocation(ctx);
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
  // place the engine can execute code it did not ship, and the hooks (five events) reach it in every
  // project on the machine — see the trust-boundary note at the top of lib/self-hosting.mjs
  // before loosening the condition.
  const delegated = delegateToCheckout({ selfPath: SELF, argv, root: ctx.root, env });
  if (delegated !== null) return delegated;

  // ---------- dispatch ----------

  const cmd = currentArgv()[2];

  const USAGE = "usage: conductor.mjs init|render|brief|snapshot|commit-nudge|sync|log-detour|retract-detour|push-detour|pop-detour|drop-detour|honcho-memory|add-epic|add-many|update-epic|remove-epic|reorder|set-active|clear-active|set-tracker|set-lane-routing|suggest-lane|triage|set-autonomy|record-reconcile|record-gate-review|record-cross-spec-review|record-tracker-refresh|set-review-mode|release|set-gate-guard|gate-guard|lesson-advice|plan-hierarchy|claim|unclaim|owners|activity|set-activity-log|purge-logs|verify-worktrees|verify-state|verify-specs|integrity|changesets|recover-created-at|unconsidered-outcomes|upgrade|changelog|rules|write-rules|rules-target\n";

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
  const helpAt = currentArgv().slice(2).findIndex(a => a === "--help" || a === "-h");
  if (!cmd || (!Object.prototype.hasOwnProperty.call(VERB_EFFECTS, cmd) && (helpAt === 0 || helpAt === 1))) {
    outStream().write(USAGE);
    return 0;
  }
  {
    const verdict = checkCommandLine(cmd, currentArgv(), { initialized: isInitialized() });
    if (verdict.kind === "help") {
      // #158 — VERB-SCOPED help, projected from the same declarations the check enforces.
      const { verbHelp } = await import("./lib/help.mjs");
      outStream().write(verbHelp(cmd));
      return 0;
    }
    if (verdict.kind === "refuse") {
      // A hook verb's payload is on stdin. Drain it before exiting, as gate-guard and lesson-advice
      // do on their own paths, so the hook writer is not left holding a pipe (an EPIPE on its side).
      // Never from a terminal: a person typing a refused hook line would wait on a read that only
      // ends at EOF, with the refusal not yet printed. The message goes first for the same reason.
      errStream().write(verdict.message + "\n");
      // The INVOCATION's stdin, whose default is the real fd 0 tested with isatty(0) rather than
      // process.stdin.isTTY: touching process.stdin opens a stream on fd 0 that makes the synchronous
      // drain read nothing, and the hook writer then sees EPIPE. A caller that supplied its own input
      // gets the question asked of ITS input, which is what makes a refused hook line testable
      // in-process.
      if (VERB_EFFECTS[cmd].hook === true && !stdinSource().isTTY) readStdin();
      return 1;
    }
    // D10 — every verb reads its command line in canonical order: positionals first, then flags with
    // their values in their original relative order, argv-level flags (`--force`) last. So an
    // `argv[0]` reader sees its positional first (`set-active --force e2`), and saveState()'s own
    // `process.argv.includes("--force")` keeps working unedited.
    if (verdict.canonicalArgv) currentArgv().splice(3, currentArgv().length - 3, ...verdict.canonicalArgv);
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
  const showEngineBanner = env.PM_VERBOSE_ENGINE_BANNER
    ? true
    : (env.PM_QUIET_ENGINE_BANNER || env.CLAUDE_PROJECT_DIR) ? false : true;
  if (showEngineBanner) {
    errStream().write(
      `conductor: engine ${pluginVersion() || "unknown"} @ ${escapeControls(path.dirname(SELF))}\n`
    );
  }
  // ---------- #111: the activity log's ONE instrumentation point ----------
  //
  // Events are DERIVED by diffing state.json across this whole invocation, rather than emitted by
  // hand from each of the ~25 verbs that write state. That is not a shortcut: a list of emit sites
  // typed from memory goes stale the moment a verb is added, and a verb that forgot to emit would
  // be invisible in exactly the log built to find invisible things. The diff cannot forget.
  //
  // A SNAPSHOT HERE, and the diff in a `finally` around dispatch below — NOT process.on("exit"),
  // which is what this was until 0.47.0 and which ITS OWN COMMENT argued for. The argument was
  // sound at the time and is now false: `process.exit()` skips `finally`, so the exit-handler shape
  // was the only one that recorded update-epic's post-write attribution refusal. Refusals are
  // THROWN and caught now (lib/command-exit.mjs), so a `finally` runs on every path including that
  // one. Keeping the handler would be a defect specific to this change: in the assertion half's ONE
  // shared process every call would register another listener, none would fire until the runner
  // exited, and main() would have returned long before the diff it owes.
  //
  // Placed AFTER the --help short-circuit (a help flag must have no side effect, and there is
  // nothing to diff) and BEFORE dispatch, so the snapshot is genuinely the pre-verb state.
  //
  // EVERY call here is guarded. Observability must never break the run it observes — the rule
  // lib/write-conflicts.mjs opens with, for the same reason: a throw would convert a working
  // command into a visible failure, and would fire when the filesystem is already in trouble.
  let activityBefore = null;
  let activitySession = null;
  try {
    if (isInitialized()) {
      const snapshot = loadState();
      if (activityEnabled(snapshot)) {
        activityBefore = snapshot;
        activitySession = resolveSession(parseFlags(currentArgv().slice(3)));
      }
    }
  } catch { /* including a state.json this process cannot read at all */ }

  let status;
  try {
  // The dispatch table's own arm returns nothing — every handler reports by writing and by
  // throwing. The arm beside it, the unknown-verb usage, returns 1, and CAPTURING the result is
  // what makes that 1 leave `main()` as a return rather than being discarded by the call.
  status = await ({
    init,
    render,
    brief,
    snapshot,
    "commit-nudge": commitNudge,
    sync: () => sync(false),
    "log-detour": logDetour,
    "retract-detour": retractDetour,
    "push-detour": pushDetour,
    "pop-detour": popDetour,
    "drop-detour": dropDetour,
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
      const f = parseFlags(currentArgv().slice(3));
      requireFlagValues("rules", f);
      const epicId = typeof f.epic === "string" ? f.epic : undefined;
      const declared = platformFlag(currentArgv().slice(3));
      if (declared) assertKnownPlatform(declared);
      const rulesPlatform = resolvePlatform({ platform: declared }, loadState());
      outStream().write(rulesBlock(currentTracker(), currentReviewMode(epicId), currentSecondaryTrackers(), rulesPlatform));
    },
    "write-rules": () => {
      // #152: `--platform` is read straight off argv by platformFlag(), which treats a valueless
      // occurrence as absent — so `write-rules --platform` silently wrote the RECORDED platform's
      // rules block while looking answered. Parsed and checked here for that reason alone; the
      // resolution below is unchanged.
      requireFlagValues("write-rules", parseFlags(currentArgv().slice(3)));
      const { platform, switched } = resolveAndRecordPlatform();
      writeRules(platform);
      if (switched) errStream().write(`conductor: platform: ${platform}\n`);
    },
    // Read-only query: which file does this platform's rules block belong in? Exists so a
    // CONSUMER (evals/observe.py) never has to mirror PLATFORM_RULES_CHAIN -- a second copy of
    // platform knowledge is exactly the drift this epic was filed to remove. Deliberately does
    // NOT record the platform: a query must not mutate state the way write-rules does.
    "rules-target": () => {
      requireFlagValues("rules-target", parseFlags(currentArgv().slice(3)));
      const declared = platformFlag(currentArgv().slice(3));
      if (declared) assertKnownPlatform(declared);
      outStream().write(rulesTarget(resolvePlatform({ platform: declared }, loadState()), engineRoot()) + "\n");
    },
  }[cmd] || (() => {
    errStream().write(USAGE);
    return 1;
  }))();
  } catch (err) {
    // A refusal now arrives as a THROWN VALUE rather than as a call to process.exit
    // (lib/command-exit.mjs): `die()` has already written the message to the invocation's stderr, so
    // this arm only carries the status out. It is checked FIRST because CommandExit is not one of
    // refusalFor()'s classes and would otherwise be re-thrown as an unhandled error, turning
    // "refused" into "crashed".
    if (err instanceof CommandExit) {
      status = err.code;
    } else {
      // A conflict is retryable; a validation error is not; an unreadable state file is neither. They
      // must not share an exit code — lib/refusal.mjs holds the mapping. Anything else is re-thrown
      // UNCHANGED so a real crash keeps its stack -- swallowing it here would trade one silent failure
      // for another.
      const refusal = refusalFor(cmd, err);
      if (refusal === null) throw err;
      if (refusal.stderr) errStream().write(refusal.stderr);
      // exitCode and RETURN, never process.exit(): a hook's refusal can be a JSON payload on stdout
      // (SessionStart), and exiting straight after a stdout write truncates it at a pipe's buffer
      // (conductor-38). Nothing after this catch keeps the event loop alive.
      if (refusal.stdout) outStream().write(refusal.stdout);
      status = refusal.exitCode;
    }
  } finally {
    // ONE line per invocation, on EVERY path — success, a refusal, and a re-thrown crash alike —
    // and it runs BEFORE main() returns, so an in-process caller can read the log the moment the
    // call is over rather than at some later process exit.
    if (activityBefore) {
      try {
        const after = loadState();
        // No revision movement means no write happened; recording a line for it would make every
        // read verb a log entry and drown the signal the log exists for.
        if (after.revision !== activityBefore.revision) {
          appendEvents(diffEvents(activityBefore, after, { verb: cmd, session: activitySession }));
        }
      } catch { /* never break the run being observed */ }
    }
  }
  // The SUCCESS path, written rather than left to fall off the end, so that `main()` RETURNS a
  // numeric status on every route (engine-invocation).
  return typeof status === "number" ? status : 0;
}

// ---------- the CLI tail ----------
//
// The only caller that hands over the PROCESS's own streams and stdin, and the only place the status
// reaches the runtime. `process.exitCode` and NOT `process.exit()`: a hook's refusal can be a JSON
// payload on stdout (SessionStart), and exiting straight after a stdout write truncates it at a
// pipe's buffer (conductor-38). Nothing after this keeps the event loop alive, so the assignment is
// the last word either way.
//
// `invokedDirectly()` rather than an unconditional call, so importing this module — which the
// assertion half does for every in-process test — neither runs a verb nor registers an invocation.
// Both comparisons are needed: realpath resolves a symlinked or relatively-spelled path to this
// file, and the resolve() fallback covers a path that is not on disk at all.
function invokedDirectly() {
  // `import.meta.url` is ALREADY the resolved location — Node's ESM loader realpaths the entry
  // module — so a symlinked or relatively-spelled argv[1] has to be resolved the same way before
  // the two are compared. This guarded on `fs.realpathSync` from the moment it was written and
  // `fs` was never imported, so the call threw, the catch fell through to a bare `path.resolve`,
  // and the tail did not run AT ALL for any invocation whose path is not already canonical —
  // `/tmp` on macOS is `/private/tmp`, which is the shape 5.3j's hostile-directory test installs
  // the engine under. Found by that test; the engine printed nothing and exited 0.
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try { if (fs.realpathSync(argv1) === SELF) return true; } catch { /* not a path on disk */ }
  return path.resolve(argv1) === SELF;
}

if (invokedDirectly()) {
  process.exitCode = await main(process.argv.slice(2), {
    cwd: process.cwd(), env: process.env,
    // `stdin` IS DELIBERATELY ABSENT, and passing `process.stdin` here is a REAL DEFECT that the
    // pre-commit suite caught. Reading that property CREATES the lazy ReadStream on fd 0, and a
    // stream holding fd 0 makes `fs.readFileSync(0, "utf8")` return NOTHING — measured: the
    // refused-hook-line drain read 0 of 204800 bytes and the hook writer took an EPIPE, which is
    // the exact failure the drain exists to prevent. `normalizeStdin(undefined)` produces the real
    // source (fd 0 + isatty(0)) without ever touching the property.
    stdout: process.stdout, stderr: process.stderr,
  });
}
