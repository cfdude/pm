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
import { activeChangeIds, archivedChanges, firstHeading, planFiles, reconcileArchived, strippedChangeId } from "./epic-progress.mjs";
import { engineStamp } from "./disposition.mjs";
import { ROOT, CONDUCTOR_DIR, BRIEF_PATH, PLANS_DIR, anyInwardProcedureEmittable } from "./constants.mjs";
import { resolveAndRecordPlatform } from "./platform.mjs";

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
  const rawSubject = (m && (m[1] || m[2] || m[3])) || "";

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
  // All three reduce to one question: does HEAD in ROOT hold the commit we just parsed?
  // Comparing SHAs would need a stored baseline; the subject is already in hand. Note an
  // exit-code check would NOT cover the backgrounded case — there is no exit code yet.
  //
  // Three-state on purpose. Only CONTRADICTED (a subject was parsed, git works, and HEAD
  // disagrees) means "no commit landed here" and goes silent. UNVERIFIABLE -- no `-m` to
  // parse, git unusable here, or a shell-assembled message we cannot read -- keeps the
  // previous behaviour, because the archived-epic self-heal below must still run in a repo
  // with no git at all, and because guessing wrong here silently disables the whole hook.
  const head = headSubject();
  if (!shellBuilt && subject && head !== null && head !== subject) return;

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
  //
  // This is a HOOK write (PostToolUse), same class as render.mjs's self-heal, and needs the
  // same RETRY ONCE, THEN SKIP treatment: a conflict here is a self-heal that re-runs on the
  // next hook, so losing it costs nothing — while the default onConflict:"throw" turns an
  // invisible race into a visible mid-session exit-9 error for a write that did not matter.
  // The retry reloads and RE-RUNS reconcileArchived rather than re-attempting the same write:
  // the in-hand `state` is built on a revision another writer has already superseded, so
  // writing it again would clobber exactly what the guard exists to protect.
  if (reconcileArchived(state)) {
    const first = saveState(state, { onConflict: "skip", verb: "commit-nudge" });
    if (!first.ok) {
      const fresh = loadState();
      if (reconcileArchived(fresh)) saveState(fresh, { onConflict: "skip", verb: "commit-nudge" });
    }
  }
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
    state.epics.push({
      id, title: id, priority: "P?", status: "archived", role: "epic", lane: "openspec",
      links: [], reconcileNeeded: false,
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
  // EXEMPTION NOTE: registering a historical archived change does NOT go through archiveGate().
  // Like the heal below and the two archived-at-creation paths, it supplies no disposition,
  // receives no named receiver from anyone, and reflects a record rather than a judgment — so
  // the outcome refusal, the deferral assertion and the handoff demand do not bind it.
  backfillArchive(state);
  reconcileArchived(state);
  saveState(state);
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
}
