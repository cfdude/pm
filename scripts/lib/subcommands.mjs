// scripts/lib/subcommands.mjs
// Top-level session-hook entry points: init, the SessionStart/PreCompact hooks,
// commit-nudge, sync, log-detour, and honcho-memory. One-directional dependency on the
// render/briefing/rules modules -- nothing calls back into this file.

import fs from "node:fs";
import path from "node:path";
import { execFileSync, execSync } from "node:child_process";
import { defaultState, isInitialized, loadState, pushEpic, saveState, readStdin } from "./state.mjs";
import { reportSave, STATE_UNCHANGED } from "./save-report.mjs";
import { stampVersion } from "./plugin-meta.mjs";
import { render } from "./render.mjs";
import { assertRulesBlockWritable, writeRules } from "./rules.mjs";
import { buildBrief } from "./briefing.mjs";
import { COMMIT_DERIVED_KINDS, appendDetourLog, appendRetraction, fullSha, gitShortSha, isCommitNameShaped, isDetachedTree, readDetourRows, rowMatches, rowShasOverlap, shortSha } from "./git.mjs";
import { parseFlags, requireFlagValues } from "./add-epic.mjs";
import { STORABLE_EPIC_ID, asCode, escapeControls, jsonText, printedId, orNoRemedy, commandValue, unstorableSkipLine } from "./constants.mjs";
import { beginObservation, isAmend, isLiveCommit } from "./commit-watch.mjs";
import { deliveredRegression, planWithdrawal, withdrawnRecord } from "./update-epic.mjs";
import { deferralHistory, deferralNote, detourContext } from "./links.mjs";
import { activeChangeIds, archivedChanges, firstHeading, planFiles, reconcileArchived, strippedChangeId } from "./epic-progress.mjs";
import { claimedSourceArtifacts, epicSourceArtifacts, normalizeArtifactPath, syncIgnoredArtifacts } from "./source-artifacts.mjs";
import { ARCHIVE_BACKFILL, engineStamp } from "./disposition.mjs";
import { ROOT, CONDUCTOR_DIR, BRIEF_PATH, PLANS_DIR, anyInwardProcedureEmittable } from "./constants.mjs";
import { platformFlag, resolveAndRecordPlatform, resolvePlatform } from "./platform.mjs";
import { requirePlatformFlag } from "./add-epic.mjs";
// The positionals the command-line check classified — never the raw argv tail (argv-surface.mjs).
import { checkedPositionals } from "./argv-surface.mjs";
import { saveHookHeal } from "./hook-write.mjs";

/** Ensure the conductor's GENERATED artifacts are git-ignored.
 *
 *  #106: detours.log has never been ignored by anything pm ships. It is invisible on the
 *  maintainer's machine only because their personal ~/.gitignore_global carries `*.log`, so
 *  every other user has had a permanently untracked file since it shipped — the same class as
 *  #81 (PROJECT.md is never clean), and unnoticed precisely because the one person positioned
 *  to see it is configured not to.
 *
 *  state.json, render-stamp.json and PROJECT.md stay TRACKED: they are the state of record and
 *  the generated index, and both belong in git. */
export function ensureGitignore() {
  const wanted = [
    ".conductor/detours.log",
    ".conductor/write-conflicts.log",
    // The contention latch is engine-written too (write-conflicts.mjs). Left out, every
    // pm-managed repo grows a permanently untracked file the moment writes contend — #106
    // exactly, in the release that fixes #106's sibling. upgrade() re-runs this
    // (migrations.mjs:71), so repos initialized before the latch existed pick it up.
    ".conductor/write-conflicts.latch",
    // The commit-nudge HEAD watermark (commit-watch.mjs). Engine-written on every Bash tool
    // call and per-checkout by nature — a worktree has its own HEAD — so tracking it would be
    // a merge conflict per commit as well as #106's untracked-file complaint.
    ".conductor/commit-watch.json",
    // commit-nudge-reads-the-whole-move: the observation record that replaces the watermark above
    // (commit-watch.mjs). A GLOB: its O_EXCL lock and the temp file of its rename start with its
    // name, and a hook killed mid-write leaves either behind. The exact commit-watch.json line
    // stays — 0.44.0 engines still write that file, and this function never removes a line.
    ".conductor/commit-observe.json*",
    // #84's repo-level quiescence marker (claims.mjs). Per-checkout and per-session by nature —
    // it says "THIS session is mid-operation in THIS working tree" — so committing it would
    // publish one machine's transient state to everybody, on top of #106's untracked-file
    // complaint. upgrade() re-runs this (migrations.mjs), so repos initialized before the
    // marker existed pick it up without a MIGRATIONS entry.
    //
    // A GLOB since state-file-refuses-to-guess: the marker is now written by temp file plus rename
    // in the same directory (claims.mjs), and the temp name starts with the marker's own name.
    // An existing exact `.conductor/session-claim.json` line is left in place — it is harmless, and
    // this function never removes a line it manages.
    ".conductor/session-claim.json*",
    // The state.json lock and its break file (state.mjs, design D4). Per-checkout and live only
    // for the duration of one save, so a stray one must never show up as an untracked file.
    ".conductor/state.json.lock*",
    // The save's temp file (state.mjs). Removed on every failure the process survives; a save
    // killed by a signal between its write and its rename still leaves one behind.
    ".conductor/state.json.tmp*",
    // #111's activity segments. The whole DIRECTORY, not a glob of segment names: the names are
    // timestamped, so a per-file entry would need one line per segment forever. Same #106 rule —
    // engine-written, per-checkout, and useless to anyone but this working tree.
    ".conductor/activity/",
  ];
  const giPath = path.join(ROOT, ".gitignore");
  let existing = "";
  try { existing = fs.readFileSync(giPath, "utf8"); } catch { /* absent is fine */ }
  const have = new Set(existing.split("\n").map(l => l.trim()));
  const missing = wanted.filter(w => !have.has(w));
  if (missing.length === 0) return;
  const prefix = existing && !existing.endsWith("\n") ? "\n" : "";
  fs.appendFileSync(giPath, `${prefix}${missing.join("\n")}\n`);
}

export function init() {
  // FIRST, before saveState(defaultState()): `init --platform bogus` used to create state.json and
  // THEN refuse, which ended pm's dormancy in a repo whose init had failed.
  requirePlatformFlag("init");
  // LOAD FIRST when the file exists, before any write: a present but unreadable state.json refuses
  // here (StateUnreadableError), so init never writes over, beside or around a record it cannot read.
  const recorded = isInitialized() ? loadState() : null;
  // THEN the rules-block preflight, still before the first write (state.json on a fresh repo,
  // .gitignore otherwise): an ambiguous marker arrangement refuses with nothing created. The target
  // is resolved with the platform this init would use, WITHOUT recording it.
  assertRulesBlockWritable(resolvePlatform({ platform: platformFlag(process.argv.slice(3)) }, recorded));
  if (isInitialized()) {
    process.stderr.write("conductor: already initialized (.conductor/state.json exists)\n");
  } else {
    // save-report: exempt — the file does not exist on this branch (isInitialized() is false), so
    // the first write of defaultState() cannot compare equal to a disk pre-image there is none of.
    saveState(defaultState());
    process.stderr.write("conductor: created .conductor/state.json\n");
  }
  ensureGitignore();
  sync(true);                 // pull in existing openspec changes + plans
  // save-report: exempt — a version stamp inside init(), which prints its own outcome line once
  // at the end; this write has no outcome line of its own to make true or false.
  { const s = loadState(); stampVersion(s); saveState(s); }
  const { platform } = resolveAndRecordPlatform();
  writeRules(platform);
  render();
  process.stderr.write(
    // Verbs, never a hand-edit of the state of record (conductor-record): a hand-edit skips the
    // validation, the write lock and the read-back every verb supplies. Code spans, so the
    // emitted-invocation sweep reads them as invocations.
    "conductor: initialized. Triage with `update-epic <id> --priority <P0-P3> --status <status>` " +
    "and `set-active <id>`, then /pm:status.\n"
  );
}

export function brief() {
  if (!isInitialized()) return;          // DORMANT until /pm:init
  requirePlatformFlag("brief");
  // consume: true — this IS a briefing actually reaching a session (SessionStart), so a
  // threshold warning surfaced here must be consumed (see briefing.mjs's buildBrief comment).
  const context = buildBrief(loadState(), { consume: true });
  process.stdout.write(jsonText({
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context },
  }));
}

export function snapshot() {
  if (!isInitialized()) return;          // DORMANT until /pm:init
  requirePlatformFlag("snapshot");
  // BEFORE render(): an unreadable state file refuses here, so nothing is rendered and no snapshot
  // written. Never exit 2 on this hook — on PreCompact that blocks compaction (lib/refusal.mjs).
  const state = loadState();
  render();
  fs.mkdirSync(CONDUCTOR_DIR, { recursive: true });
  // NO consume — the opposite of brief(). This briefing is written to .conductor/brief.txt,
  // which NOTHING reads back, so consuming here retired the contention warning against a reader
  // who never existed: a PreCompact landing between the threshold crossing and the next
  // SessionStart showed the message to no one, and compaction is routine in exactly the long
  // sessions where sustained contention is most likely. brief() is the only delivery point that
  // reaches a session; render() already passes no consume and stays that way.
  // gh#175: a snapshot is for the NEXT session in this tree, and a deployed checkout has none —
  // the next thing to touch it is a `git checkout --force` that discards the file.
  const detached = isDetachedTree();
  if (!detached) fs.writeFileSync(BRIEF_PATH, buildBrief(state) + "\n");
  process.stderr.write(detached
    ? "conductor: snapshot NOT written — this tree is detached, and the next thing to touch it is " +
      "a checkout that would discard the file. PROJECT.md was still re-rendered.\n"
    : "conductor: snapshot written before compaction\n");
}


/** Files changed by HEAD, via `git diff-tree`. Returns null if git isn't usable here. */
export function headChangedFiles() {
  return changedFiles("HEAD");
}

/** Files changed by one commit, RELATIVE TO THE CONDUCTOR ROOT (design Decision 8). Returns null if
 *  git cannot answer. The value reaches git as one argv element, never through a shell.
 *
 *  `git diff-tree` prints git-root paths; pm's own files (CONDUCTOR_OWN_FILES) and an epic's own
 *  artifacts are conductor-root relative, so a nested conductor's bookkeeping commit never looked
 *  like bookkeeping (#195). The `git rev-parse --show-prefix` is stripped; a path OUTSIDE the
 *  conductor root keeps a `:/` marker (git's own top-of-tree pathspec spelling), so it can never
 *  equal a conductor-relative path — a git-root `PROJECT.md` in a monorepo is not this conductor's.
 *  `--relative` is rejected: it DROPS out-of-root paths and turns a mixed commit into a
 *  bookkeeping-only one. */
let showPrefix = null;   // invariant for one process: ROOT does not move under a running invocation
export function changedFiles(sha) {
  try {
    const opts = { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] };
    // `-z`: NUL-terminated and UNQUOTED. Without it git quotes any path holding a non-ASCII byte
    // (`"projects/s\303\274b/PROJECT.md"`, core.quotePath), so no path under a non-ASCII conductor
    // root matched the prefix and every bookkeeping commit there was logged (Gate 2 G2-I1). `-z` also
    // survives a tab or newline in a path, which `core.quotePath=false` does not.
    const out = execFileSync("git", ["diff-tree", "-z", "--no-commit-id", "--name-only", "-r", "--root", sha], opts);
    // --show-prefix prints the prefix raw today; quotePath=false keeps it comparable with the -z paths
    // should that ever change.
    if (showPrefix === null) showPrefix = execFileSync("git", ["-c", "core.quotePath=false", "rev-parse", "--show-prefix"], opts).replace(/\n$/, "");
    const prefix = showPrefix;
    return out.split("\0").filter(Boolean).map(p => !prefix ? p : p.startsWith(prefix) ? p.slice(prefix.length) : `:/${p}`);
  } catch { return null; }
}

/** An epic's OWN ARTIFACTS: its change directory `openspec/changes/<id>/` plus each source-artifact
 *  path it records (plan, spec), conductor-root relative. An openspec epic registered under an id
 *  that differs from its change directory does not match, and keeps the old behaviour. */
export function ownArtifacts(epic) {
  if (!epic || typeof epic.id !== "string") return [];
  return [{ path: `openspec/changes/${epic.id}/`, dir: true },
    ...epicSourceArtifacts(epic).map(a => ({ path: a.path, dir: false }))];
}

/** Does this conductor-relative path lie within these own artifacts? */
export const withinOwnArtifacts = (file, artifacts) =>
  artifacts.some(a => (a.dir ? file.startsWith(a.path) : file === a.path));

/** Subject line of one commit, or null when git cannot answer. */
export function commitSubject(sha) {
  try {
    return execFileSync("git", ["log", "-1", "--format=%s", sha], {
      cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch { return null; }
}

/** Subject line of the commit at HEAD in the pm-managed repo, or null when git is unusable
 *  here (not a repo yet, no commits, git missing). null means "cannot tell", which is
 *  deliberately NOT the same answer as "no commit landed" — see commitNudge's guard. */
export function headSubject() {
  try {
    return execSync("git log -1 --format=%s", {
      cwd: ROOT, stdio: ["ignore", "pipe", "ignore"],
    }).toString().trim();
  } catch { return null; }
}

/** pm's own state-output files — routine conductor bookkeeping (registering/archiving
 *  epics, re-rendering) touches only these, never a stray detour. CLAUDE.md is deliberately
 *  excluded: it's user-authored content, not purely engine-generated output, so a commit
 *  touching it could still be a real detour. */
const CONDUCTOR_OWN_FILES = new Set([
  ".conductor/state.json", "PROJECT.md", ".conductor/render-stamp.json",
  // Belt-and-braces: ensureGitignore() ignores the watermark, so it cannot normally appear in a
  // diff. It can in a repo that force-added it before the ignore existed, and a bookkeeping-only
  // commit must not stop looking like bookkeeping because an engine-written cache rode along.
  ".conductor/commit-watch.json",
  ".conductor/commit-observe.json",
]);

/** Does this file list consist ENTIRELY of pm's own generated output?
 *
 *  `false` for an empty list and for `null` (headChangedFiles()'s "git cannot answer"): both mean
 *  "cannot tell this is bookkeeping", and the safe direction is to keep logging. A false log row
 *  is visible and reviewable; a false SUPPRESSION silently disables the trail.
 *
 *  Shared by BOTH commit-nudge branches on purpose (gh#81). It lived inline in the AUTO-DETOUR
 *  branch only, which is why the DETOUR-COMMIT branch went on logging the conductor's own
 *  re-render commits — a sibling call site the diff that added it never touched. */
export function isConductorOwnFiles(files) {
  return Array.isArray(files) && files.length > 0 && files.every((f) => CONDUCTOR_OWN_FILES.has(f));
}

/** Diff-shape heuristic for an UNLOGGED minimal detour: a small, self-contained commit
 *  (<=3 files) whose subject uses a fix/chore conventional-commit prefix, made while no
 *  detour is active, and that does not itself name the currently active epic (a commit
 *  tagged to the active epic's own scope is that epic's work, not a stray detour). */
export function looksLikeUnloggedMinimalDetour(subject, activeEpicId, files = headChangedFiles(), own = []) {
  // gh#91: a detour is BY DEFINITION an interruption of an active epic. With no active epic
  // there is nothing to detour FROM, and the entry this used to write carried an empty epic
  // field (`AUTO-DETOUR\t-\t…`) describing an interruption that never happened — then asked the
  // human to hand-clean detours.log, the exact hand-editing pm exists to remove. Observed twice
  // in one session on `/pm:upgrade`'s own `chore(pm): upgrade conductor to <ver>` commit.
  //
  // Only THIS branch needs the ACTIVE-EPIC guard, and that asymmetry alone is the deliberate
  // one: the sibling DETOUR-COMMIT branch is gated on detourContext(state).active, the strictly
  // stronger condition — a live detour frame implies a paused epic.
  //
  // The BOOKKEEPING guard below (isConductorOwnFiles) was a different story, and this comment
  // used to be read as covering it too. It was an omission, not a design: gh#81's commit loop is
  // the DETOUR-COMMIT branch logging pm's own `chore(pm): re-render PROJECT.md` commits. It now
  // guards both call sites — do not re-inline it here.
  if (!activeEpicId) return false;
  if (!/^(fix|chore)(\([^)]*\))?:\s/.test(subject)) return false;
  if (activeEpicId && subject.includes(`(${activeEpicId})`)) return false;
  if (files === null || files.length === 0 || files.length > 3) return false;
  if (isConductorOwnFiles(files)) return false;
  // commit-nudge-reads-the-whole-move: a commit touching ANY of the active epic's own artifacts is
  // that epic's work — a TDD commit carrying its red-*.txt, a task tick, a plan edit — never a
  // detour from it. Decided from paths, never from a subject prefix or scope.
  if (files.some(f => withinOwnArtifacts(f, own))) return false;
  return true;
}

/** The hook event this run answers, echoed in the output envelope (design Decision 6). */
const POST_CALL_EVENTS = new Set(["PostToolUse", "PostToolUseFailure"]);

export function commitNudge() {
  if (!isInitialized()) return;          // DORMANT until /pm:init
  // gh#175: DORMANT in a detached tree too, and suppressing the observation record alone would
  // have been worse than doing nothing: with no anchor ever recorded every invocation reads
  // `unverifiable` and falls through to unverifiableSubject() — the PRE-OBSERVATION text heuristic,
  // where any command merely mentioning `git commit` fires the nudge. That is gh#104's behaviour,
  // reinstated permanently in exactly the tree where noise is least wanted, and it reaches
  // reconcileArchived() and a state.json write on the way. Suppressing the RECORD requires
  // suppressing the REACTION.
  if (isDetachedTree()) return;
  const raw = readStdin();
  // After the drain, so a refused hook line does not leave the writer holding a pipe. In a detached
  // tree this verb is dormant (above) and so is this --platform VALUE refusal — but not the
  // pre-dispatch undeclared-flag refusal (lib/argv-surface.mjs), which runs before dispatch and
  // still fires in a detached tree; only a repository without pm makes that one dormant.
  requirePlatformFlag("commit-nudge");
  let cmd = "";
  let event = "PostToolUse";
  try {
    const j = JSON.parse(raw);
    cmd = j?.tool_input?.command || j?.tool_input?.cmd || "";
    if (POST_CALL_EVENTS.has(j?.hook_event_name)) event = j.hook_event_name;
  } catch { /* ignore */ }

  // OBSERVE FIRST, on every invocation, whatever the command text says: the anchor tracks the
  // reflog rather than "the last command that mentioned a commit". The observation holds its lock
  // until finish()/release(); a run that cannot take it skips entirely and leaves every commit
  // after the anchor for the next run (commit-watch.mjs, Decision 3).
  const obs = beginObservation();
  if (obs.verdict === "skipped") return;
  try {
    if (obs.verdict === "no-commit") { obs.finish([]); return; }   // nothing landed. Assert nothing.
    // BEFORE the record or anything derived from state is written: an unreadable file refuses here,
    // so no anchor advance, no heal, no render and no detour-log line follows
    // (state-file-refuses-to-guess; conductor.mjs maps the refusal to exit 2 for this hook). The
    // commit therefore stays after the anchor and the first readable run reports it.
    const state = loadState();
    const ctx = detourContext(state);

    if (obs.verdict === "landed") {
      // The observed path needs no parser at all: each subject comes from its commit, which is what
      // closes `-am` / `-F` / editor commits / escaped quotes as a class rather than one flag form
      // at a time.
      // AN AMEND REPLACES (Decision 7), and it is handled BEFORE any commit is classified, so the
      // replaced commit's row is already retracted when the amending commit's row is written.
      const amendNote = supersedeAmended(state, obs.candidates);
      // LIVE commits only get a row or an attribution command (Decision 4); a dead one is named.
      const live = obs.candidates.filter(c => isLiveCommit(c.sha));
      const dead = obs.candidates.filter(c => !live.includes(c)).map(c => c.sha);
      const commits = live.map(c => ({ sha: c.sha, subject: commitSubject(c.sha) || "" }));
      // gh#129 — the commit-TIME half of the attribution obligation, and ONLY on the observed rung:
      // on the unverifiable rung nothing is known to have landed, and naming HEAD there would
      // assert a commit the repository never confirmed against an APPEND-ONLY array.
      const files = commits.flatMap(c => changedFiles(c.sha) || []);
      const attribution = attributionNudge(state, ctx, commits.map(c => c.sha), files);
      runNudge(state, ctx, commits, attribution, event, dead, amendNote);
    } else {
      const subject = unverifiableSubject(cmd);
      // null: the unverifiable rung, and the old heuristic said no.
      if (subject !== null) runNudge(state, ctx, [{ sha: null, subject }], null, event);
    }
    // The record LAST, once the output naming these commits has been written: a commit is reported
    // when the output names it, so a run that dies before that point must leave it after the anchor
    // for the next run. Repeating a report is already guarded where rows are written (the prefix-
    // matched duplicate check); dropping one would be silent. The cost is that the lock is held
    // across render() and the self-heal save, so a concurrent observation skips more often — and a
    // skip only defers.
    obs.finish(obs.candidates.map(c => c.sha));
  } finally { obs.release(); }
}

/** Supersede every commit an amend in this window replaced (design Decision 7). Returns the
 *  paragraph to print, or "".
 *
 *  For EVERY `commit (amend)` entry, live or dead, the replaced commit is that line's old value —
 *  never a neighbouring entry's. A replaced commit that is LIVE again (the amend was undone, e.g.
 *  `reset --hard HEAD@{1}`) is skipped: retracting or withdrawing it would be irreversible and false.
 *  Otherwise, in landing order:
 *    (a) every non-retracted AUTO-DETOUR / DETOUR-COMMIT row of it is retracted by the engine, with
 *        the reason `amended into <new>`;
 *    (b) each epic whose attribution array holds it gets a printed
 *        `update-epic <id> --withdraw-commit <replaced> --withdrawal-reason "amended into <new>"` —
 *        unless `deliveredRegression()` (the predicate update-epic's own refusal calls) says that
 *        command would be refused, in which case the paragraph says so in prose and names no remedy:
 *        the runnable remedy is emitted-commands-run-as-written's to print. The record the predicate
 *        is asked about is the one --withdraw-commit writes — the sha REMOVED from the attribution
 *        array AND APPENDED to the withdrawn commits — because removal alone reads an emptied array
 *        as `none-attributed` and misses the Gate 2 obligation.
 *  The engine never withdraws anything itself. */
function supersedeAmended(state, candidates) {
  const lines = [];
  for (const entry of candidates) {
    if (!isAmend(entry)) continue;
    const replaced = entry.old;
    if (/^0+$/.test(replaced) || isLiveCommit(replaced)) continue;
    const reason = `amended into ${shortSha(entry.sha)}`;
    const replacedShort = shortSha(replaced);
    const label = replacedShort === "-" ? replaced.slice(0, 7) : replacedShort;

    const rows = readDetourRows();
    const retracted = rows.filter(r => r.kind === "RETRACTED").map(r => r.sha);
    const open = rows.filter(r => COMMIT_DERIVED_KINDS.has(r.kind) && rowMatches(r.sha, replaced) &&
      !retracted.some(x => rowShasOverlap(x, r.sha)));
    const retractedNow = open.length > 0 && appendRetraction(open[0].sha, open[0].epic, reason);

    const commands = [];
    const refused = [];
    for (const epic of state.epics || []) {
      // Cheap pre-filter only: an entry can name the replaced commit by identity only if it is a
      // prefix of its full name, or by spelling only if it equals it.
      if (!Array.isArray(epic.attributedCommits) || !epic.attributedCommits.some(v =>
        typeof v === "string" && (v === replaced || (isCommitNameShaped(v) && replaced.startsWith(v.toLowerCase()))))) continue;
      // The SAME simulation `update-epic --withdraw-commit` performs (G2-I2): one occurrence, the
      // last, by identity — never every copy by exact spelling.
      const plan = planWithdrawal(epic.attributedCommits, [replaced], new Map([[replaced, replaced]]));
      if (!plan.removed.length) continue;
      const next = { ...epic, ...withdrawnRecord(epic, plan, reason, new Date().toISOString()) };
      if (deliveredRegression(epic.id, epic, next, { status: undefined }).length) refused.push(epic.id);
      else commands.push(orNoRemedy(() => `\`update-epic ${printedId(epic.id)} --withdraw-commit ${replaced} --withdrawal-reason "${reason}"\``));
    }
    if (!retractedNow && !commands.length && !refused.length) continue;
    let text = `AMEND — \`${label}\` was ${reason} and is on no branch, so it is replaced, not added.`;
    if (retractedNow) text += ` Its automatic detour row was retracted (${reason}).`;
    if (commands.length) {
      text += " Withdraw its attribution BEFORE attributing anything else: " + commands.join(", ") + ".";
    }
    for (const id of refused) {
      text += ` \`${escapeControls(id)}\` is a delivered epic holding \`${label}\`, whose record the withdrawal would break; ` +
        "`update-epic`'s refusal of that withdrawal names the remedy.";
    }
    lines.push(text);
  }
  return lines.join("\n\n");
}

/** The epics a commit that just landed may belong to — every CANDIDATE, deciding none
 *  (design Decision 10, gate-integrity "names every candidate epic and decides none").
 *
 *  While a detour is live: the detour epic, then each paused epic on the stack, top first. The
 *  0.44.0 hook named only the detour epic, and a commit made to the paused parent's own files (a
 *  task tick) was then attributed to the detour by an agent obeying it (#199). Otherwise: the
 *  active epic. NOT `state.active` during a detour on its own — it names the PAUSED PARENT there.
 *
 *  Each id is RESOLVED against `state.epics` rather than interpolated (`detourContext` falls back to
 *  the literal "-"), and an epic whose `attributedCommits` is ABSENT is dropped: pushEpic() leaves it
 *  off an archive-backfilled epic, and the staleness gate forgives that absence, so nudging there
 *  would demand attribution for work that predates the capability.
 *
 *  `files` (conductor-relative changed paths of the reported commits) only ORDERS the candidates —
 *  a stable sort puts those whose own artifacts were touched first. It never adds one: touching an
 *  epic's files, the archive move included, is not a claim that the work is that epic's. */
function attributionCandidates(state, ctx, files = []) {
  const epics = state.epics || [];
  const ids = ctx.active
    ? [ctx.detourId, ...[...(state.detourStack || [])].reverse().map(fr => fr && fr.pausedEpic)]
    : [state.active];
  const out = [];
  for (const id of ids) {
    const epic = epics.find(e => e.id === id);
    if (!epic || !Array.isArray(epic.attributedCommits) || out.includes(epic)) continue;
    out.push(epic);
  }
  const touches = (epic) => (files || []).some(f => withinOwnArtifacts(f, ownArtifacts(epic)));
  return [...out.filter(touches), ...out.filter(e => !touches(e))];
}

/** gh#129 — the commit-TIME half of the attribution obligation, appended to the advisory the hook
 *  already emits on a real commit. The engine records NOTHING: attribution is append-only and its
 *  order decides the Gate 2 range, so it is the agent's write, made with a command it can run.
 *
 *  One candidate keeps the single-command sentence (escalated while that epic has attributed
 *  nothing, which is when catching up is most likely owed). Several get one runnable command each
 *  and the statement that choosing is the agent's. Every command names every reported live commit,
 *  oldest first, as ONE invocation. NOISE BUDGET: one short paragraph per real commit, on a message
 *  that already prints; what it must never do is fire when no commit landed, or name a wrong sha. */
function attributionNudge(state, ctx, shas, files = []) {
  // Every value is a full sha read from a reflog line (commit-watch.mjs parseReflog), so none can
  // be empty; the filter keeps an empty one from emitting a command that appends nothing.
  const list = (shas || []).filter(s => typeof s === "string" && s);
  if (!list.length) return null;
  const candidates = attributionCandidates(state, ctx, files);
  if (!candidates.length) return null;
  // The no-remedy message in place of the command for an id holding a control character (D4a).
  const cmd = (epic) => orNoRemedy(() => `update-epic ${printedId(epic.id)} ${list.map(s => `--attribute-commit ${s}`).join(" ")}`);
  // The exclusion travels WITH the commands, once: the archive move is the one commit obeying them
  // would damage, since it lands after the reviewed range and makes the epic's own Gate 2 stale.
  const exclusion =
    "ONE exclusion: a commit that only moves or deletes a change's artifacts — the " +
    "`/opsx:archive` move above all — is lifecycle bookkeeping and must NOT be attributed; it " +
    "lands after the reviewed range, so attributing it makes this epic's own Gate 2 read stale.";

  if (candidates.length > 1) {
    return "ATTRIBUTION — the engine recorded nothing; choosing is yours. Each of these epics could own " +
      "what landed (a candidate whose own files the commits touch is listed first):\n" +
      candidates.map(e => `- ${asCode(cmd(e))}` + (e.attributedCommits.length === 0 ? " (attributes no commits yet)" : "")).join("\n") +
      `\n${exclusion}`;
  }
  const epic = candidates[0];
  if (epic.attributedCommits.length === 0) {
    return `ATTRIBUTION — \`${escapeControls(epic.id)}\` has attributed no commits yet: ` +
      "attribute every commit of this epic's work that " +
      "already landed, IN THE ORDER THEY LANDED, and then this one — " +
      `${asCode(cmd(epic))}. The array is append-only and a recorded Gate 2 \`headSha\` must reach EVERY ` +
      "entry, so a commit left unattributed is work that gate is never checked against. " +
      `${exclusion}`;
  }
  return `ATTRIBUTION — record this commit against its epic now, before the next one: ` +
    `${asCode(cmd(epic))}. ${exclusion}`;
}

/** The pre-observation heuristic, kept intact for the UNVERIFIABLE rung only: no git, no
 *  repository, reflogs disabled, or no reflog anchor recorded yet (the first hook run in a repo).
 *  Returns the subject to act on, or null for "do not nudge".
 *
 *  Keeping it matters for one behaviour that must not be lost: commit-nudge's archived-epic
 *  self-heal has to run in a repo with no git at all, where nothing can ever be observed. */
function unverifiableSubject(cmd) {
  if (!/git\s+commit/.test(cmd)) return null;

  // `-m`, and also `-am` / `-qm` / any bundled short-flag cluster ending in m: the old
  // `-m\s+` capture matched none of those, so `git commit -am "…"` parsed to "" and slipped past
  // the guard below on the empty-subject short-circuit — a REJECTED -am commit still wrote a
  // false DETOUR-COMMIT line, which is gh#65's original symptom surviving in a flag form.
  // `--amend` cannot match: the cluster must be followed by whitespace immediately after its m.
  const m = cmd.match(/(?:^|\s)--?[A-Za-z]*m\s+(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+))/);
  // Backslash-aware capture, then unescaped: `[^"]*` truncated at the first \" inside a
  // double-quoted message, so `-m "fix: say \"hi\""` captured `fix: say \` — which HEAD then
  // CONTRADICTS, silently suppressing a commit that genuinely landed. Only \ " $ and ` are
  // special inside shell double quotes, so those are the escapes to undo.
  const rawSubject = (m && (m[1] ?? m[2] ?? m[3]) || "").replace(/\\(["\\$`])/g, "$1");

  // `git log -1 --format=%s` yields ONLY the first line, but the `-m` capture above uses
  // [^"]* which spans newlines and swallows the whole message body. Comparing those two
  // directly can never match for a commit with a body -- and this repo mandates one (the
  // Claude-Session footer), so the guard below suppressed EVERY real commit. Compare the
  // first line with the first line.
  const subject = rawSubject.split("\n")[0].trim();

  // A message assembled by the shell -- `-m "$(cat <<'EOF' … EOF)"`, `-m "$MSG"` -- cannot be
  // recovered from the command string: what we captured is the shell SOURCE, not the text git
  // received. That is "cannot tell", not "does not match", so it takes the UNVERIFIABLE rung
  // rather than being wrongly contradicted.
  //
  // This test is deliberately BROAD, and the breadth has a cost worth stating: a *literal*
  // `$(` or `${` in a genuine subject -- `fix: escape ${VAR} in the template` -- also lands on
  // the unverifiable rung, so gh#65's false-positive can still occur for that message shape.
  // That is the correct direction to fail. A false log line is visible and reviewable; a false
  // SUPPRESSION silently disables the hook, which is the bug this whole guard exists to avoid
  // and which shipped once already (see the first-line comment above).
  const shellBuilt = /\$\(|\$\{|<<-?\s*['"]?\w+/.test(rawSubject) || /^\$\w+$/.test(rawSubject);

  // gh#65 / gh#68: PostToolUse fires when the Bash tool RETURNS, which is NOT the same as
  // "a commit landed in this repo". Three observed divergences, each of which wrote a false
  // detours.log line attributed to this repo's STALE HEAD:
  //   * pre-commit rejected the commit          -> HEAD never advanced      (gh#65 bug 1)
  //   * the commit was backgrounded, still running -> HEAD not advanced yet (gh#68)
  //   * the commit landed in ANOTHER repo (paired repo, submodule, `git -C`) -> our HEAD is
  //     untouched, but gitShortSha()/headChangedFiles() both read ROOT and so attribute
  //     that commit to this repo                                           (gh#65 bug 2)
  //
  // The reflog walk (commit-watch.mjs) now answers all three directly and without a subject — this subject-vs-HEAD
  // comparison is what is left for the rung where nothing can be observed. It stays a
  // SUPPRESSION-ONLY test: only CONTRADICTED (a subject was parsed, git works here, and HEAD
  // disagrees) goes silent. A subject we could not read is "cannot tell", which keeps the old
  // behaviour, because guessing wrong here silently disables the whole hook.
  const head = headSubject();
  if (!shellBuilt && subject && head !== null && head !== subject) return null;
  return subject;
}

/** Log the commit, self-heal an archived active pointer, re-render, and emit the advisory.
 *  Reached only once a commit is believed to have landed — by observation, or by the fallback
 *  heuristic above. */
function runNudge(state, ctx, commits, attribution = null, event = "PostToolUse", dead = [], amendNote = "") {
  // DETERMINISTIC: if we are inside a detour, record each commit in the trail. Each commit is
  // judged on ITS OWN subject and changed paths, and its row carries its own sha; `sha: null` is
  // the unverifiable rung, which knows no commit and keeps HEAD's reading.
  let autoLogged = false;
  let detourLogged = false;
  // The abbreviated sha of every row actually written, for the per-row retract pointer.
  const loggedRows = [];
  const pausedArtifacts = (state.detourStack || [])
    .map(fr => (state.epics || []).find(e => fr && e.id === fr.pausedEpic))
    .flatMap(e => ownArtifacts(e));
  const confinedToPaused = (files) => Array.isArray(files) && files.length > 0 && pausedArtifacts.length > 0 &&
    files.every(f => withinOwnArtifacts(f, pausedArtifacts) || isConductorOwnFiles([f]));
  const logRow = (kind, epic, subject, sha) => {
    if (!appendDetourLog(kind, epic, subject, sha || undefined)) return false;
    loggedRows.push(sha ? shortSha(sha) : gitShortSha());
    return true;
  };
  for (const { sha, subject } of commits) {
    const files = sha ? changedFiles(sha) : headChangedFiles();
    if (ctx.active) {
      // gh#81 — THE LOOP. Committing a file this hook regenerates used to append a row describing
      // that commit; the row changed PROJECT.md's "Recent detours" table; the re-render dirtied the
      // tree again; committing THAT appended another row. Measured in the field: 8 rows for 4 real
      // commits, several describing commits whose only content was re-rendering the file the row
      // lives in, and `git status` never clean in any session.
      //
      // A commit touching ONLY pm's own generated output is bookkeeping, not detour work — there is
      // nothing about it a reader of the trail needs. The same predicate has always guarded the
      // AUTO-DETOUR branch; it was simply never applied here.
      //
      // A commit whose every changed path is a paused epic's own artifact or a pm-owned file is the
      // paused work's bookkeeping (a task tick on the parent), not detour work.
      detourLogged = (!isConductorOwnFiles(files) && !confinedToPaused(files)
        && logRow("DETOUR-COMMIT", ctx.detourId, subject, sha)) || detourLogged;
    } else if (looksLikeUnloggedMinimalDetour(subject, state.active, files,
      ownArtifacts((state.epics || []).find(e => e.id === state.active)))) {
      // AUTO-DETECT: this commit's shape looks like a minimal detour nobody logged via
      // `/pm:detour --minimal`. Log it automatically instead of relying on the agent to
      // remember — the whole point of this heuristic.
      // No `|| "-"` fallback any more: looksLikeUnloggedMinimalDetour refuses without an active
      // epic (gh#91), so the placeholder that used to stand in for one can no longer be reached.
      // The return value, not an unconditional true: a re-fire of the hook for a sha already in the
      // trail writes nothing (gh#81's dedupe), and announcing "logged automatically" for a row that
      // does not exist is the plugin reporting one thing while doing another.
      autoLogged = logRow("AUTO-DETOUR", state.active, subject, sha) || autoLogged;
    }
  }
  // Self-heal: if this commit archived the active epic (e.g. an OpenSpec archive),
  // clear the stale active pointer + stamp archived status so /pm:next advances.
  //
  // This is a HOOK write (PostToolUse), same class as render.mjs's self-heal, and needs the
  // same RETRY ONCE, THEN SKIP treatment: a conflict here is a self-heal that re-runs on the
  // next hook, so losing it costs nothing — while the default onConflict:"throw" turns an
  // invisible race into a visible mid-session exit-9 error for a write that did not matter.
  // The policy itself is lib/hook-write.mjs's saveHookHeal() — SHARED with render.mjs, not
  // copied from it (#131). This site is also the one that cannot be verified end to end:
  // render() is called two lines below and its heal is idempotent, so from outside a single
  // invocation the retry running and the retry being absent are indistinguishable — identical
  // final state, identical revision, identical conflict log. That cover is what let the retry
  // go untested at both sites for six releases, so a source scan in conductor-25 binds this
  // site to the shared policy instead.
  if (reconcileArchived(state)) {
    saveHookHeal({ state, verb: "commit-nudge", heal: reconcileArchived });
  }
  render();

  const named = commits.filter(c => c.sha).map(c => `\`${shortSha(c.sha)}\``);
  // The provenance statement (design Decision 5) — the whole treatment of defect 3. The hook
  // cannot tell a commit the answered call made from one made in another terminal or by a parallel
  // call in the same interval, so it never says which; no row is suppressed because of it.
  const detected = named.length > 1
    ? `Commits ${named.join(", ")} (oldest first) landed since the last observation — this call, another terminal, or a parallel call; the hook cannot tell which`
    : named.length === 1
      ? `Commit ${named[0]} landed since the last observation — this call, another terminal, or a parallel call; the hook cannot tell which`
      : "Commit detected";
  // Every automatic row carries its inverse: the verb, never a hand-edit of a git-ignored log whose
  // tracked rendering would keep the false row (#173).
  const retractPointer = loggedRows.length
    ? " If a row is wrong: " + loggedRows.map(r => `\`retract-detour ${r} --reason "<why>"\``).join(", ") +
      " (re-renders PROJECT.md)."
    : "";
  // Dead commits get one sentence and nothing else. The replacement a rebase wrote is a `(pick)`
  // entry, which is not reported (design Non-Goals), so the sentence says to attribute it by hand.
  const deadSentence = dead.length
    ? `Rewritten or abandoned since the last observation: ${dead.map(s => `\`${shortSha(s)}\``).join(", ")} — ` +
      "not logged, not attributed (reachable from no branch). If a rebase rewrote them, attribute " +
      "what the rebase produced by hand."
    : "";
  // G2-M1: naming a dead commit IS reporting it, so a report of dead commits alone carries the same
  // provenance statement a live report opens with.
  const deadProvenance = `${dead.length > 1 ? "These commits" : "This commit"} landed since the last observation — ` +
    "this call, another terminal, or a parallel call; the hook cannot tell which.";
  const msg = !commits.length ? `${deadProvenance} ${deadSentence}` : (ctx.active
    // "(logged to detours.log)" is now a CLAIM about what just happened, so it is conditional:
    // a bookkeeping-only commit, or a re-fire for a sha already in the trail, writes no row, and
    // saying otherwise would send the agent looking for a line that is not there.
    ? `${detected} during DETOUR \`${escapeControls(ctx.detourId)}\`` +
      (detourLogged ? " (logged to detours.log)" : " (bookkeeping only — not added to the detour trail)") + ". " +
      "When the detour is done: archive it, `/pm:resume` to pop the stack, and run the " +
      "RECONCILE check on the paused parent epic. Write a one-line Honcho memory on resume." + retractPointer
    : autoLogged
    ? `${detected}. Diff shape (small, fix/chore-prefixed, unrelated to the active ` +
      "epic) looks like a MINIMAL detour, so it was auto-logged to `.conductor/detours.log` " +
      "as an AUTO-DETOUR entry." + retractPointer
    : `${detected}. If this was a MINIMAL detour, run \`/pm:detour --minimal "<what>"\` ` +
      "to record it. Otherwise record an epic's status or story change with `update-epic` " +
      "(`--status`, `--story <n> --done`).")
    + (commits.length && deadSentence ? `\n\n${deadSentence}` : "");
  // The attribution clause is a SECOND paragraph, never a longer first one: the three messages
  // above are about the DETOUR record and are decided by different inputs, so splicing the two
  // obligations into one sentence would make each harder to act on than either alone.
  process.stdout.write(jsonText({
    hookSpecificOutput: {
      hookEventName: event,
      // The amend paragraph sits BEFORE the attribution one: a withdrawal of the replaced commit is
      // owed before anything new is attributed.
      additionalContext: [msg, amendNote, attribution].filter(Boolean).join("\n\n"),
    },
  }));
}

/** Register every archived change on disk that the conductor does not already hold.
 *
 *  A change archived before `/pm:init` ever ran — or archived in a session where `sync` never
 *  ran — was permanently invisible: `reconcileArchived()` only flips epics that ALREADY exist,
 *  and `sync` only walked the active changes directory. So the record silently under-counted
 *  exactly the work that finished, which is the reading a project-management tool exists to get
 *  right.
 *
 *  Registration is `sync`'s job and stays there. A heal that registered would grow the epic list
 *  from a read-mostly path (render, the commit hook) on every call, which is how an index comes
 *  to change without anyone asking it to.
 *
 *  Returns the ids it registered, so the caller owns what is said about them.
 */
export function backfillArchive(state, skipped = []) {
  // Identity is the DATE-PREFIX-STRIPPED id on both sides. An epic may itself carry a
  // date-prefixed id (this repository holds four such registrations), so comparing the stripped
  // archive id against the epic's literal id alone would miss it and register a duplicate —
  // making this path a third way to produce the duplicates `sync` is already filed for.
  const held = new Set();
  for (const e of state.epics) { held.add(e.id); held.add(strippedChangeId(e.id)); }
  const registered = [];
  for (const { id, dir } of archivedChanges()) {
    if (held.has(id)) continue;
    // The final registration step (design D4): an entry already held never reaches here. A name no
    // epic id can carry is reported by the caller, never stored.
    if (!STORABLE_EPIC_ID(id)) { skipped.push(dir); continue; }
    // Through pushEpic() like every other creation path, and exempted BY IT: the
    // `archive-backfill` stamp below is what tells the sink to leave `attributedCommits`
    // ABSENT. Absent is the truthful record here — this epic never passed through the
    // conductor while it was in flight, so no verdict of its can be shown stale and none can
    // be verified either. Do NOT "fix" this for uniformity with the other creation paths: an
    // empty array would assert "created under commit attribution, nothing attributed yet",
    // which is false for every backfilled change and converts the staleness gate's one
    // forgiven case into a repo-wide false positive.
    pushEpic(state, {
      id, title: id, priority: "P?", status: "archived", role: "epic", lane: "openspec",
      links: [], reconcileNeeded: false,
      // The REGISTRATION provenance, on the epic itself. It is what every backfill exemption
      // now keys on, and it lives here rather than on the disposition because a disposition is
      // replaced wholesale the moment an agent records a real outcome — which used to take the
      // epic's archived task counts with it (#133).
      registeredBy: ARCHIVE_BACKFILL,
      // The ENGINE stamps this, unconditionally and with no CLI flag that reaches it: a
      // backfilled epic never passed through the conductor while it was in flight, and every
      // exemption that keeps a check or a refusal from firing on it keys on this token.
      disposition: engineStamp("archive-backfill"),
      // Deliberately NO `gateReview.gate2`. An `ungated` entry here would be a permanent,
      // unclearable condition against essentially every archived change — its only clearing
      // path is a real passing Gate 2 carrying a commit range, which for a change archived
      // before the conductor existed is either impossible or fabrication. Measured on this
      // repository: 69 archived epics against 3 carrying a passing Gate 2.
    });
    held.add(id);
    registered.push(id);
  }
  return registered;
}

export function sync(quiet = false) {
  const state = loadState();
  const onDiskChanges = new Set(activeChangeIds());
  for (const e of state.epics) {
    if ((e.lane || "openspec") === "openspec" && e.status === "planned" && onDiskChanges.has(e.id)) {
      e.status = "untriaged";
      if (!quiet) process.stderr.write(`conductor: '${escapeControls(e.id)}' proposed — planned → untriaged\n`);
    }
  }
  const known = new Set(state.epics.map(e => e.id));
  let added = 0;
  for (const id of activeChangeIds()) {
    if (!known.has(id)) {
      // Said on EVERY run, quiet included: a skipped change has no other reported condition, so a
      // silent skip would read as a clean sync (design D4).
      if (!STORABLE_EPIC_ID(id)) { process.stderr.write(unstorableSkipLine("change", id)); continue; }
      pushEpic(state, { id, title: id, priority: "P?", status: "untriaged", role: "epic", lane: "openspec", links: [], reconcileNeeded: false });
      known.add(id); added++;
    }
  }
  // THE RESOLUTION LADDER (#64/#69). Dedup used to key on the plan's FILENAME-DERIVED id alone,
  // so it fired only when a plan happened to be named exactly like its epic — which is the
  // uncommon case, since plan filenames carry a date prefix and epic ids do not. Every other
  // epic's plan was re-registered as a fresh untriaged epic on EVERY sync, forever. Reported
  // four times across three repos; one operator hand-deleted the same phantom four times in a
  // day, and one phantom was a duplicate of the epic that was ACTIVE at that moment.
  //
  // Rungs, in order, per plan file on disk. Order is deliberate: the truthful answers come
  // first, the heuristic last, so a repo that has recorded its associations never reaches the
  // rung that guesses.
  const claimed = claimedSourceArtifacts(state);
  const ignored = syncIgnoredArtifacts(state);
  for (const fname of planFiles()) {
    const id = fname.replace(/\.md$/, "");
    const planPath = path.join("docs", "superpowers", "plans", fname);
    const norm = normalizeArtifactPath(planPath);

    // 1. CLAIMED — the durable fix. Status-blind and lane-blind by construction (see
    //    claimedSourceArtifacts): an archived epic still holds its `planPath`, which is the
    //    done-signal #69 asks for without inferring completion from anything.
    const claim = claimed.get(norm);
    if (claim) {
      if (!quiet) process.stderr.write(
        `conductor: sync skipped ${claim.label} '${escapeControls(fname)}' — already claimed by epic '${escapeControls(claim.epic)}'\n`);
      continue;
    }

    // 2. The pre-existing id guard, unchanged in behavior and in wording.
    if (known.has(id)) {
      if (!quiet) process.stderr.write(`conductor: sync skipped plan '${escapeControls(id)}' — id already exists\n`);
      continue;
    }

    // 3. TOMBSTONED — `remove-epic` said no. Removal used to buy you only until the next sync.
    if (ignored.has(norm)) {
      if (!quiet) process.stderr.write(
        `conductor: sync skipped plan '${escapeControls(fname)}' — sync-ignore tombstone (removed epic); ` +
        `attach it to an epic with \`update-epic <id> --plan ${commandValue(planPath, "<plan path>")}\` to un-ignore it\n`);
      continue;
    }

    // 4. NAME MATCH — the recovery path for the epics registered before `update-epic --plan`
    //    existed (0.27.0), which therefore claim nothing yet. This rung REPORTS, it does not
    //    repair: it names BOTH exits, because the match is a name collision and may be
    //    coincidental, and an operator who followed a single "associate it" instruction onto an
    //    unrelated plan would point that epic's progress source at the wrong file and read
    //    `0/N` forever. Registering nothing is the conservative half — a plan named after an
    //    existing epic minus its date prefix is, on all evidence, that epic's plan.
    //    The candidate must claim NO source artifact of its own. Rung 1 only fires when THIS
    //    plan is claimed, so an epic already holding a DIFFERENT plan still matches by name —
    //    and the instruction would then repoint that epic's progress source at this file,
    //    silently discarding a recorded association. Reachable with two date-prefixed plans
    //    sharing a stem: `2026-08-01-x.md` registers, then `2026-09-01-x.md` matches it. An
    //    epic that already claims something falls through to registration instead: a visible
    //    epic a human can remove beats a silent overwrite of a real association.
    const near = state.epics.find(e =>
      e.id !== id && strippedChangeId(e.id) === strippedChangeId(id) && !epicSourceArtifacts(e).length);
    if (near) {
      if (!quiet) process.stderr.write(
        `conductor: sync skipped plan '${escapeControls(fname)}' — epic '${escapeControls(near.id)}' has the same name without ` +
        `the date prefix and claims no plan. If it IS that epic's plan: ` +
        `${orNoRemedy(() => `\`update-epic ${printedId(near.id)} --plan ${commandValue(planPath, "<plan path>")}\``)}. If it is genuinely different work: ` +
        `${orNoRemedy(() => `\`add-epic --id ${printedId(id)} --lane superpowers --plan ${commandValue(planPath, "<plan path>")}\``)}\n`);
      continue;
    }

    // 5. Real backlog — the final registration step, so only an entry no rung above matched is
    //    tested: a name no epic id can carry is skipped and named on every run (design D4).
    if (!STORABLE_EPIC_ID(id)) { process.stderr.write(unstorableSkipLine("plan", fname)); continue; }
    const title = firstHeading(path.join(PLANS_DIR, fname)) || id;
    pushEpic(state, { id, title, priority: "P?", status: "untriaged", role: "epic", lane: "superpowers", planPath, links: [], reconcileNeeded: false });
    known.add(id); claimed.set(norm, { epic: id, key: "planPath", label: "plan" }); added++;
  }
  // EXEMPTION NOTE: registering a historical archived change does NOT go through archiveGate().
  // Like the heal below and the two archived-at-creation paths, it supplies no disposition,
  // receives no named receiver from anyone, and reflects a record rather than a judgment — so
  // the outcome refusal, the deferral assertion and the handoff demand do not bind it.
  // PRESENCE is the marker — nothing is ever compared against the timestamp. Read BEFORE the
  // registration, because the registration is what decides whether there is anything to
  // announce, and written after, so a run that registered nothing still records that history
  // has been accounted for.
  const firstBackfill = !("archiveBackfilledAt" in state);
  const skippedArchives = [];
  const backfilled = backfillArchive(state, skippedArchives);
  for (const dir of skippedArchives) process.stderr.write(unstorableSkipLine("archive directory", dir));
  if (firstBackfill) state.archiveBackfilledAt = new Date().toISOString();
  reconcileArchived(state);
  const saved = saveState(state);
  // Said even under `quiet`, which init passes to suppress routine per-epic chatter. The
  // historical backfill is the one thing here that MUST NOT be quiet: it alters a repo's epic
  // counts, and those counts are the input to every effectiveness measurement taken from
  // conductor state. A count that moved with nobody told is the silent side effect this
  // capability is defined against.
  if (backfilled.length) {
    process.stderr.write(firstBackfill
      ? `conductor: archive backfill — registered ${backfilled.length} historical archived ` +
        `change(s) the conductor never held: ${backfilled.join(", ")}\n`
      : `conductor: registered ${backfilled.length} newly archived change(s): ${backfilled.join(", ")}\n`);
  }
  if (!quiet) {
    reportSave(saved, {
      changed: `conductor: synced (${added} new epic(s) added as untriaged)`,
      // `added` counts registrations, and it is NOT the same question as "did the file change":
      // a sync that registers nothing still rewrites state when it heals an archive drift or
      // stamps the backfill marker. The save's own answer is the only one that is true of the file.
      unchanged: `conductor: synced (${added} new epic(s) added as untriaged) — ${STATE_UNCHANGED}`,
    });
    // What sync instructs EXTERNALLY follows direction. The engine performs none of it — it
    // reads no tracker and never will — but saying which branch applies is the difference
    // between an agent doing the inward pull and an agent inventing one for a repo that has
    // no procedure for it.
    const tracker = state.tracker && state.tracker.system ? state.tracker : null;
    const secondaries = Array.isArray(state.secondaryTrackers) ? state.secondaryTrackers : [];
    if (anyInwardProcedureEmittable(tracker, secondaries)) {
      process.stderr.write(
        "conductor: inward tracker sync is YOURS — follow the inward sync section in the rules " +
        "block: list open items, register the unmirrored ones (matching on `externalUrl`, never " +
        "on a bare item number — the same number in two trackers is two different items), then " +
        "compare each linked epic's `externalUpdatedAt` watermark against its item's updated " +
        "timestamp and read the movers\n");
    } else if (tracker || secondaries.length) {
      process.stderr.write(
        "conductor: no inward procedure is configured — registered local OpenSpec/Superpowers " +
        "sources only; nothing was read from your tracker(s), and nothing should be\n");
    }
  }
}

export function logDetour() {
  if (!isInitialized()) { process.stderr.write("conductor: run /pm:init first\n"); process.exit(1); }
  const reason = checkedPositionals("log-detour").join(" ").trim();
  if (!reason) { process.stderr.write("usage: conductor.mjs log-detour \"<what you fixed>\"\n"); process.exit(1); }
  const state = loadState();
  // gh#175 Gate 2 C2: HONOUR THE RETURN. appendDetourLog()'s docstring says the boolean exists
  // "so a caller never announces 'logged to detours.log' for a row that was suppressed" — the two
  // commit-nudge callers already honour it, and this one did not. Detachment added a second
  // suppressed path through a channel that was already there, which is the absent-edit class in
  // the change that ships the rule against it.
  const logged = appendDetourLog("MINIMAL", state.active || "-", reason);
  render();
  process.stderr.write(logged
    ? "conductor: logged minimal detour\n"
    : "conductor: NOT logged — this tree is detached, so nothing was written to .conductor/detours.log\n");
}

/** `retract-detour <sha> --reason "<why>"` — the inverse of the commit hook's automatic logging
 *  (design Decision 11). Appends ONE `RETRACTED` row covering every AUTO-DETOUR and DETOUR-COMMIT row
 *  of that commit, removes and rewrites nothing, and re-renders PROJECT.md so no retracted row shows.
 *
 *  Row matching. A `<sha>` that resolves to a commit matches a row when the commit's full name begins
 *  with the row's sha (Decision 9). One that resolves to no commit — rewritten, then pruned — is
 *  matched against the stored text only: it must be at least 7 hex characters, only rows whose own sha
 *  also resolves to nothing are candidates, either sha may be a prefix of the other, and the candidates
 *  must name exactly one commit, so `retract-detour 1` cannot retract every row starting with `1`.
 *
 *  MINIMAL rows are not retractable: their sha is HEAD at declaration, not an identity, and the agent
 *  declared them. There is no un-retract; re-declare with `log-detour`. Every refusal names its own
 *  reason and happens before any write. */
export function retractDetour() {
  if (!isInitialized()) { process.stderr.write("conductor: run /pm:init first\n"); process.exit(1); }
  const refuse = (msg) => { process.stderr.write(`conductor: retract-detour refused — ${msg}\n`); process.exit(1); };
  const [arg] = checkedPositionals("retract-detour");
  const argv = process.argv.slice(3);
  const f = parseFlags(argv[0] && !argv[0].startsWith("--") ? argv.slice(1) : argv);
  requireFlagValues("retract-detour", f);
  if (!arg) refuse("usage: retract-detour <sha> --reason \"<why>\"");
  if (f.reason === undefined) refuse("it requires --reason \"<why>\" — a retraction says why the automatic row was wrong");
  const reason = typeof f.reason === "string" ? f.reason.trim() : "";
  if (!reason) refuse("--reason is empty — a retraction with no reason is indistinguishable from a deleted row");
  const sha = String(arg).trim().toLowerCase();

  // G2-M2: a ref (`HEAD`, `main~1`) is not a sha. It used to fall through to the pruned-commit branch
  // and be told it "resolves to no commit", which is false. The contract is a sha: a row names a
  // commit, not wherever a ref points now.
  if (!/^[0-9a-f]+$/.test(sha)) {
    refuse(`'${escapeControls(arg)}' is not a hexadecimal sha — retract-detour takes a commit sha, not a ref ` +
      "(run `git rev-parse <ref>` for it)");
  }
  const rows = readDetourRows();
  const full = /^[0-9a-f]{4,64}$/.test(sha) ? fullSha(sha) : null;
  let matching;
  let label;
  if (full) {
    matching = rows.filter(r => r.kind !== "RETRACTED" && rowMatches(r.sha, full));
    label = shortSha(full);
  } else {
    if (!/^[0-9a-f]{7,64}$/.test(sha)) {
      refuse(`'${escapeControls(arg)}' resolves to no commit, and a value that resolves to none must be at least 7 ` +
        "hexadecimal characters — a shorter one could match the rows of many commits");
    }
    const resolves = new Map();
    const resolvable = (s) => { if (!resolves.has(s)) resolves.set(s, fullSha(s) !== null); return resolves.get(s); };
    matching = rows.filter(r => r.kind !== "RETRACTED" && rowShasOverlap(r.sha, sha) && !resolvable(r.sha));
    const distinct = [...new Set(matching.map(r => r.sha))].sort((x, y) => y.length - x.length);
    const commits = distinct.filter(x => !distinct.some(y => y !== x && y.length > x.length && y.startsWith(x)));
    if (commits.length > 1) {
      refuse(`'${escapeControls(sha)}' is ambiguous — it matches rows of ${commits.length} different commits (${commits.join(", ")}); ` +
        "give more of the sha");
    }
    label = distinct[0];
  }
  // A commit that exists but was never logged, and a value that names nothing at all, are different
  // mistakes: the first is the wrong commit, the second the wrong value.
  if (!matching.length) {
    refuse(full
      ? `commit ${label} has no AUTO-DETOUR or DETOUR-COMMIT row to retract (it has no row in .conductor/detours.log)`
      : `'${escapeControls(sha)}' resolves to no commit and matches no row in .conductor/detours.log`);
  }
  const derived = matching.filter(r => COMMIT_DERIVED_KINDS.has(r.kind));
  if (!derived.length) {
    refuse(matching.some(r => r.kind === "MINIMAL")
      ? `'${escapeControls(sha)}' has only a MINIMAL row — a MINIMAL row is a declaration, not an automatic row, and ` +
        "is not retractable"
      : `'${escapeControls(sha)}' has no AUTO-DETOUR or DETOUR-COMMIT row to retract`);
  }
  const retracted = rows.filter(r => r.kind === "RETRACTED").map(r => r.sha);
  if (derived.every(r => retracted.some(x => rowShasOverlap(x, r.sha)))) {
    refuse(`'${escapeControls(sha)}' is already retracted — the row stays in the log and is already hidden from PROJECT.md`);
  }
  if (!full && !derived.some(r => r.sha === label)) label = derived[0].sha;
  if (!appendRetraction(label, derived[0].epic, reason)) {
    process.stderr.write("conductor: this tree is detached, so no retraction was written to .conductor/detours.log\n");
    process.exit(1);
  }
  render();
  process.stderr.write(`conductor: retracted ${derived.length} automatic row(s) for ${label} — ` +
    "kept in .conductor/detours.log, hidden from PROJECT.md\n");
}

const HONCHO_MEMORIES_LOG = path.join(CONDUCTOR_DIR, "honcho-memories.log");

/** Format the exact one-line Honcho memory string for a detour-stack PUSH or POP, per
 *  CLAUDE.md rule 4 ("on every PUSH and POP, also write a one-line memory to Honcho").
 *  Pure string formatting — the engine never calls Honcho itself (see the ZERO-DEPENDENCY /
 *  INSTRUCTION-LAYER law above); this only gives the interactive agent an exact, consistently
 *  worded, ready-to-copy string instead of composing one ad hoc from context each time. */
export function honchoMemoryLine(action, epicId, reason) {
  // ONE line by definition: the epic id and the reason are governed values, escaped so neither the
  // printed line nor its `.conductor/honcho-memories.log` entry can gain a line (user-text-never-
  // forges-output D7). A memory then carries a visible escape where a newline was typed.
  if (action === "push") return `paused ${escapeControls(epicId)} for ${escapeControls(reason)}`;
  if (action === "pop") return `resumed ${escapeControls(epicId)}, reconciled vs ${escapeControls(reason)}`;
  throw new Error(`honchoMemoryLine: unknown action '${escapeControls(action)}' (expected 'push' or 'pop')`);
}

/** Format one memory line, append a timestamped copy to `.conductor/honcho-memories.log`, and
 *  print it to stdout for the agent to paste into its actual Honcho MCP call. Returns the line.
 *
 *  Extracted so `push-detour` and `pop-detour` (lib/detour-stack.mjs) emit the memory as part of
 *  the transition instead of leaving it as a separate step the agent has to remember — #151's
 *  "emit the Honcho line rather than asking for it". The log path is module-private here on
 *  purpose: two writers appending to one file must not each carry their own copy of where it is. */
export function appendHonchoMemory(action, epicId, reason) {
  const line = honchoMemoryLine(action, epicId, reason);
  fs.mkdirSync(CONDUCTOR_DIR, { recursive: true });
  fs.appendFileSync(HONCHO_MEMORIES_LOG, `${new Date().toISOString()}\t${line}\n`);
  process.stdout.write(line + "\n");
  return line;
}

/** `honcho-memory <push|pop> <epicId> "<reason>"` — prints the ready-to-copy Honcho memory
 *  line to stdout (for the interactive agent to paste into its actual Honcho MCP call) AND
 *  appends a timestamped copy to `.conductor/honcho-memories.log`, so there's a durable local
 *  record of what was emitted even if the agent forgets to actually send it. */
export function honchoMemory() {
  if (!isInitialized()) { process.stderr.write("conductor: run /pm:init first\n"); process.exit(1); }
  const [action, epicId, ...rest] = checkedPositionals("honcho-memory");
  const reason = rest.join(" ").trim();
  if (!action || !epicId || !reason) {
    process.stderr.write("usage: conductor.mjs honcho-memory <push|pop> <epicId> \"<reason>\"\n");
    process.exit(1);
  }
  try {
    appendHonchoMemory(action, epicId, reason);
  } catch (e) {
    process.stderr.write(`conductor: ${e.message}\n`);
    process.exit(1);
  }

  // gh#94's disclosure. `push-detour` (lib/detour-stack.mjs) now emits this at the moment of the
  // deferral itself, which is where it belongs; this verb keeps it because it stays available on
  // its own — for a pivot recorded after the fact, or by an agent still following the old
  // protocol. It states what the record holds and asks for nothing: a gate here would fire after
  // the decision was already made. Silent on a first deferral, and on stderr, because stdout is
  // a line the agent pastes into Honcho verbatim.
  if (action === "push") {
    const note = deferralNote(deferralHistory(loadState(), epicId));
    if (note) process.stderr.write(`conductor: \`${escapeControls(epicId)}\` — ${note}\n`);
  }
}
