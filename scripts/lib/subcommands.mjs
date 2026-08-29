// scripts/lib/subcommands.mjs
// Top-level session-hook entry points: init, the SessionStart/PreCompact hooks,
// commit-nudge, sync, log-detour, and honcho-memory. One-directional dependency on the
// render/briefing/rules modules -- nothing calls back into this file.

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { defaultState, isInitialized, loadState, pushEpic, saveState, readStdin } from "./state.mjs";
import { stampVersion } from "./plugin-meta.mjs";
import { render } from "./render.mjs";
import { writeRules } from "./rules.mjs";
import { buildBrief } from "./briefing.mjs";
import { appendDetourLog, gitShortSha } from "./git.mjs";
import { observeCommit } from "./commit-watch.mjs";
import { deferralHistory, deferralNote, detourContext } from "./links.mjs";
import { activeChangeIds, archivedChanges, firstHeading, planFiles, reconcileArchived, strippedChangeId } from "./epic-progress.mjs";
import { claimedSourceArtifacts, epicSourceArtifacts, normalizeArtifactPath, syncIgnoredArtifacts } from "./source-artifacts.mjs";
import { ARCHIVE_BACKFILL, engineStamp } from "./disposition.mjs";
import { ROOT, CONDUCTOR_DIR, BRIEF_PATH, PLANS_DIR, anyInwardProcedureEmittable } from "./constants.mjs";
import { resolveAndRecordPlatform } from "./platform.mjs";
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
    // #84's repo-level quiescence marker (claims.mjs). Per-checkout and per-session by nature —
    // it says "THIS session is mid-operation in THIS working tree" — so committing it would
    // publish one machine's transient state to everybody, on top of #106's untracked-file
    // complaint. upgrade() re-runs this (migrations.mjs), so repos initialized before the
    // marker existed pick it up without a MIGRATIONS entry.
    ".conductor/session-claim.json",
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
  if (isInitialized()) {
    process.stderr.write("conductor: already initialized (.conductor/state.json exists)\n");
  } else {
    saveState(defaultState());
    process.stderr.write("conductor: created .conductor/state.json\n");
  }
  ensureGitignore();
  sync(true);                 // pull in existing openspec changes + plans
  { const s = loadState(); stampVersion(s); saveState(s); }
  const { platform } = resolveAndRecordPlatform();
  writeRules(platform);
  render();
  process.stderr.write(
    "conductor: initialized. Triage epics in .conductor/state.json " +
    "(set priority/status/active), then /pm:status.\n"
  );
}

export function brief() {
  if (!isInitialized()) return;          // DORMANT until /pm:init
  // consume: true — this IS a briefing actually reaching a session (SessionStart), so a
  // threshold warning surfaced here must be consumed (see briefing.mjs's buildBrief comment).
  const context = buildBrief(loadState(), { consume: true });
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context },
  }));
}

export function snapshot() {
  if (!isInitialized()) return;          // DORMANT until /pm:init
  const state = loadState();
  render();
  fs.mkdirSync(CONDUCTOR_DIR, { recursive: true });
  // NO consume — the opposite of brief(). This briefing is written to .conductor/brief.txt,
  // which NOTHING reads back, so consuming here retired the contention warning against a reader
  // who never existed: a PreCompact landing between the threshold crossing and the next
  // SessionStart showed the message to no one, and compaction is routine in exactly the long
  // sessions where sustained contention is most likely. brief() is the only delivery point that
  // reaches a session; render() already passes no consume and stays that way.
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
export function looksLikeUnloggedMinimalDetour(subject, activeEpicId) {
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
  const files = headChangedFiles();
  if (files === null || files.length === 0 || files.length > 3) return false;
  if (isConductorOwnFiles(files)) return false;
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
  // OBSERVE FIRST, and unconditionally. observeCommit() records where HEAD is on EVERY
  // invocation — including this one, whatever it decides — so the watermark tracks HEAD rather
  // than tracking "the last command that mentioned a commit". Gating the observation behind the
  // text check below would leave a `git checkout` invisible to the watermark, and would make
  // gh#104's own repro (`echo "… git commit …"`) the only thing that ever primed it.
  const obs = observeCommit();
  if (obs.verdict === "no-commit") return;   // HEAD says nothing landed here. Assert nothing.

  const state = loadState();
  const ctx = detourContext(state);

  // The observed path needs no parser at all: the subject comes from the commit itself, which is
  // what closes `-am` / `-F` / editor commits / escaped quotes as a class rather than one flag
  // form at a time.
  const subject = obs.verdict === "landed"
    ? (headSubject() || "")
    : unverifiableSubject(cmd);
  if (subject === null) return;              // unverifiable rung, and the old heuristic said no

  // gh#129 — the commit-TIME half of the attribution obligation, and ONLY on the observed rung.
  // On the unverifiable rung `obs.head` can be a perfectly real sha while nothing is known to
  // have landed (no watermark yet, reflogs off, HEAD unreadable): naming it there would be
  // gh#104 in a new costume, asserting a commit the repository never confirmed — against an
  // APPEND-ONLY array whose last entry is the Gate 2 endpoint. Absence of the clause is the
  // degradation, and it costs nothing.
  const attribution = obs.verdict === "landed" ? attributionNudge(state, ctx, obs.head) : null;

  // ── everything below is shared by both rungs ──
  runNudge(state, ctx, subject, attribution);
}

/** The epic a commit that just landed belongs to, or null wherever the engine would have to
 *  GUESS. Guessing is the one thing this must not do: the emitted rule says attribution is
 *  inferred from NOTHING, and `attributedCommits` is append-only — the engine neither reorders
 *  nor de-duplicates it — so a wrongly-named epic is not a papercut, it is a permanent wrong
 *  Gate 2 endpoint on an epic nobody will think to re-check.
 *
 *  NOT `state.active`. While a detour is live `state.active` still names the PAUSED PARENT
 *  (links.mjs `detourContext`) while the commits being made are the detour's work, so the
 *  parent is exactly the wrong answer during the one period the hook fires most.
 *
 *  The id is RESOLVED against `state.epics` rather than interpolated: `detourContext` falls back
 *  to `state.active` and then to the literal `"-"` for a frame naming no spawned detour, and a
 *  nudge reading `update-epic - --attribute-commit …` is a command that cannot run. */
function attributionTarget(state, ctx) {
  const id = ctx.active ? ctx.detourId : state.active;
  // RESOLUTION IS THE ONLY GUARD, deliberately. Explicit `!id` and `id === "-"` checks read as
  // defence but are strictly redundant here — neither `null` nor `"-"` names an epic — and a
  // redundant guard is one no mutation can kill, which is how a file grows branches nobody can
  // verify. One lookup covers "no active epic", detourContext's `state.active` fallback, and its
  // literal `"-"` fallback alike.
  const epic = (state.epics || []).find(e => e.id === id);
  if (!epic) return null;
  // ABSENT is not empty, and the difference is the whole exemption. pushEpic() deliberately
  // leaves `attributedCommits` OFF an archive-backfilled epic (state.mjs) because that epic
  // never passed through the conductor while it was in flight; the staleness gate reads the
  // same absence as "unverifiable" and forgives it. Nudging there would demand attribution for
  // work that predates the capability — turning the gate's one forgiven case into a per-commit
  // false positive, which is precisely how a channel stops being read.
  if (!Array.isArray(epic.attributedCommits)) return null;
  return epic;
}

/** gh#129 — one clause, appended to the advisory commit-nudge ALREADY emits on a real commit.
 *
 *  The obligation ("record it at the moment each commit is made") was checked only at the
 *  archive gate, which is after the commits were made, often across sessions, and after the
 *  ordering rule may already have been violated irrecoverably. This moves the DETECTOR to the
 *  moment the finding is still actionable, and moves nothing else: no new hook, no new file, no
 *  new state, no new flag, and no engine-held epic→sha mapping (which would owe a pruning story
 *  for detours, resets, rebases, dropped branches and the archive move — five false-nag modes on
 *  a channel that only just became trustworthy).
 *
 *  SELF-EXTINGUISHING WITHOUT ANY BOOKKEEPING OF ITS OWN: the escalated form keys on
 *  `attributedCommits.length === 0`, which is state the AGENT wrote. Attribute once and the
 *  loud form is gone for the life of the epic. That empty array is also the only state in which
 *  item 4's catch-up rule is still available — after the first append, catching up would leave
 *  an ancestor as the last entry — so the escalation lands at the one moment it changes the
 *  outcome rather than on every commit forever.
 *
 *  NOISE BUDGET, stated plainly: this is willing to be ignored on the steady-state rung. One
 *  short sentence per real commit under an active epic, on a message that already prints, is
 *  what it spends; if a reader skims past it the cost is what today already costs. What it must
 *  never do is fire when no commit landed, or name the wrong epic or the wrong sha. */
function attributionNudge(state, ctx, sha) {
  // `observeCommit()` documents `""` (unborn HEAD) and `null` (git cannot answer) as real return
  // values for `head`. Neither can reach here today — `landed` implies a reflog-confirmed commit
  // — but that coupling lives in another module, and an empty sha would emit a command that
  // silently appends nothing to an append-only array. Stated exception: no test kills this
  // guard, because nothing in the current engine can reach it.
  if (!sha || typeof sha !== "string") return null;
  const epic = attributionTarget(state, ctx);
  if (!epic) return null;
  // No "already attributed?" check, deliberately: `verdict: "landed"` means this sha is where
  // HEAD moved TO since the last observation, so it is being announced for the first time by
  // construction. A guard for it would be a branch no test can reach — and unreachable guards
  // are how a file accumulates behaviour nobody can verify.

  const cmd = `update-epic ${epic.id} --attribute-commit ${sha}`;
  // The exclusion travels WITH the command, because this nudge is the surface most likely to be
  // obeyed reflexively and the archive move is the one commit obeying it would damage: it lands
  // after the reviewed range by construction, so attributing it makes the epic's own Gate 2 read
  // stale at the instant the archive gate checks it. The engine states the rule and classifies
  // NOTHING — it reads no commit message and inspects no commit's contents, exactly as
  // archive-gate.mjs's own exclusion does.
  const exclusion =
    "ONE exclusion: a commit that only moves or deletes a change's artifacts — the " +
    "`/opsx:archive` move above all — is lifecycle bookkeeping and must NOT be attributed; it " +
    "lands after the reviewed range, so attributing it makes this epic's own Gate 2 read stale.";

  if (epic.attributedCommits.length === 0) {
    return `ATTRIBUTION — \`${epic.id}\` has attributed no commits yet, so this is the last ` +
      "moment its catch-up rule is available: attribute every commit of this epic's work that " +
      "already landed, IN THE ORDER THEY LANDED, and then this one — " +
      `\`${cmd}\`. The array is append-only and its LAST entry is the endpoint a Gate 2 ` +
      "`headSha` is compared against, so catching up after attributing forward is not " +
      `recoverable. ${exclusion}`;
  }
  return `ATTRIBUTION — record this commit against its epic now, before the next one: ` +
    `\`${cmd}\`. ${exclusion}`;
}

/** The pre-observation heuristic, kept intact for the UNVERIFIABLE rung only: no git, no
 *  repository, reflogs disabled, or no watermark recorded yet (the first hook run in a repo).
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
  // observeCommit() now answers all three directly and without a subject — this subject-vs-HEAD
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
function runNudge(state, ctx, subject, attribution = null) {
  // DETERMINISTIC: if we are inside a detour, record this commit in the trail.
  let autoLogged = false;
  let detourLogged = false;
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
    detourLogged = !isConductorOwnFiles(headChangedFiles())
      && appendDetourLog("DETOUR-COMMIT", ctx.detourId, subject);
  } else if (looksLikeUnloggedMinimalDetour(subject, state.active)) {
    // AUTO-DETECT: this commit's shape looks like a minimal detour nobody logged via
    // `/pm:detour --minimal`. Log it automatically instead of relying on the agent to
    // remember — the whole point of this heuristic.
    // No `|| "-"` fallback any more: looksLikeUnloggedMinimalDetour refuses without an active
    // epic (gh#91), so the placeholder that used to stand in for one can no longer be reached.
    // The return value, not an unconditional true: a re-fire of the hook for a sha already in the
    // trail writes nothing (gh#81's dedupe), and announcing "logged automatically" for a row that
    // does not exist is the plugin reporting one thing while doing another.
    autoLogged = appendDetourLog("AUTO-DETOUR", state.active, subject);
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

  const msg = ctx.active
    // "(logged to detours.log)" is now a CLAIM about what just happened, so it is conditional:
    // a bookkeeping-only commit, or a re-fire for a sha already in the trail, writes no row, and
    // saying otherwise would send the agent looking for a line that is not there.
    ? `Commit detected during DETOUR \`${ctx.detourId}\`` +
      (detourLogged ? " (logged to detours.log)" : " (bookkeeping only — not added to the detour trail)") + ". " +
      "When the detour is done: archive it, `/pm:resume` to pop the stack, and run the " +
      "RECONCILE check on the paused parent epic. Write a one-line Honcho memory on resume."
    : autoLogged
    ? "Commit detected. Diff shape (small, fix/chore-prefixed, unrelated to the active " +
      "epic) looks like a MINIMAL detour, so it was auto-logged to `.conductor/detours.log` " +
      "as an AUTO-DETOUR entry. Review it — if that's wrong, edit/remove the line."
    : "Commit detected. If this was a MINIMAL detour, run `/pm:detour --minimal \"<what>\"` " +
      "to record it. Otherwise update `.conductor/state.json` if an epic's status or stories changed.";
  // The attribution clause is a SECOND paragraph, never a longer first one: the three messages
  // above are about the DETOUR record and are decided by different inputs, so splicing the two
  // obligations into one sentence would make each harder to act on than either alone.
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: attribution ? `${msg}\n\n${attribution}` : msg,
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
export function backfillArchive(state) {
  // Identity is the DATE-PREFIX-STRIPPED id on both sides. An epic may itself carry a
  // date-prefixed id (this repository holds four such registrations), so comparing the stripped
  // archive id against the epic's literal id alone would miss it and register a duplicate —
  // making this path a third way to produce the duplicates `sync` is already filed for.
  const held = new Set();
  for (const e of state.epics) { held.add(e.id); held.add(strippedChangeId(e.id)); }
  const registered = [];
  for (const { id } of archivedChanges()) {
    if (held.has(id)) continue;
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
      if (!quiet) process.stderr.write(`conductor: '${e.id}' proposed — planned → untriaged\n`);
    }
  }
  const known = new Set(state.epics.map(e => e.id));
  let added = 0;
  for (const id of activeChangeIds()) {
    if (!known.has(id)) {
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
        `conductor: sync skipped ${claim.label} '${fname}' — already claimed by epic '${claim.epic}'\n`);
      continue;
    }

    // 2. The pre-existing id guard, unchanged in behavior and in wording.
    if (known.has(id)) {
      if (!quiet) process.stderr.write(`conductor: sync skipped plan '${id}' — id already exists\n`);
      continue;
    }

    // 3. TOMBSTONED — `remove-epic` said no. Removal used to buy you only until the next sync.
    if (ignored.has(norm)) {
      if (!quiet) process.stderr.write(
        `conductor: sync skipped plan '${fname}' — sync-ignore tombstone (removed epic); ` +
        `attach it to an epic with \`update-epic <id> --plan ${planPath}\` to un-ignore it\n`);
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
        `conductor: sync skipped plan '${fname}' — epic '${near.id}' has the same name without ` +
        `the date prefix and claims no plan. If it IS that epic's plan: ` +
        `\`update-epic ${near.id} --plan ${planPath}\`. If it is genuinely different work: ` +
        `\`add-epic --id ${id} --lane superpowers --plan ${planPath}\`\n`);
      continue;
    }

    // 5. Real backlog.
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
  const backfilled = backfillArchive(state);
  if (firstBackfill) state.archiveBackfilledAt = new Date().toISOString();
  reconcileArchived(state);
  saveState(state);
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
    process.stderr.write(`conductor: synced (${added} new epic(s) added as untriaged)\n`);
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

  // gh#94, at the closest thing to the moment of deferral the engine is invited to. The
  // substantial-detour PUSH is a hand-edit of state.json (commands/detour.md step 2), so there
  // is no `push-detour` verb to gate; this verb runs at step 3, immediately after, and is the
  // one place the engine is handed the paused epic's id. That makes a DISCLOSURE possible and a
  // gate impossible — which is the honest shape anyway: it states what the record holds and
  // asks for nothing. Silent on a first deferral, and on stderr, because stdout is a line the
  // agent pastes into Honcho verbatim.
  if (action === "push") {
    const note = deferralNote(deferralHistory(loadState(), epicId));
    if (note) process.stderr.write(`conductor: \`${epicId}\` — ${note}\n`);
  }
}
