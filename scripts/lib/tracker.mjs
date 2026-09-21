// scripts/lib/tracker.mjs
// The set-tracker verb: configures primary/secondary external-tracker mirroring.
// One-directional dependency on lib/rules.mjs's writeRules() -- see the design doc's
// corrected circular-imports section (this is NOT circular).

import { isInitialized, loadState, saveState } from "./state.mjs";
import { reportSave, STATE_UNCHANGED } from "./save-report.mjs";
import { parseFlags, requireFlagValues } from "./add-epic.mjs";
import { removeSecondaryTracker, secondaryTrackerKey, upsertSecondaryTracker, writeRules } from "./rules.mjs";
import { render } from "./render.mjs";
import { resolvePlatform } from "./platform.mjs";
import { CONTROL_CHARACTER, KNOWN_TRACKER_DIRECTIONS, directionOf, escapeControls, isGithubRepo } from "./constants.mjs";
import { die } from "./command-exit.mjs";

/** Write/merge the `tracker` block (role: primary, default) or upsert/remove an entry in
 *  `state.secondaryTrackers` (role: secondary). Pure local state write — the engine NEVER
 *  contacts the tracker; it only records that one is in use so the instructions it emits (rules
 *  block + brief) can assign sync work to the interactive agent. */
export function setTracker() {
  if (!isInitialized()) { die("conductor: run /pm:init first\n"); }
  const f = parseFlags(process.argv.slice(3));
  requireFlagValues("set-tracker", f);
  const str = (v) => (typeof v === "string" ? v : undefined);
  // A TRACKER'S RECORDED SCOPE holding a control character is refused before anything is read or
  // written (design D8) — it heads a section of the rules file, the channel that reaches every
  // subagent. Both roles; NOT `--role secondary --remove`, whose match key is whatever was stored, so
  // a legacy entry stays removable. A primary `--remove` has no remove handler and is refused. Runs
  // BEFORE the owner/name shape check below, so a value failing both gets this refusal.
  if (!(str(f.role) === "secondary" && f.remove)) {
    for (const [flag, key] of [["system", "system"], ["project", "project"], ["repo", "repo"]]) {
      const values = [].concat(f[key] === undefined ? [] : f[key]).filter(v => typeof v === "string");
      const bad = values.find(v => CONTROL_CHARACTER.test(v));
      if (bad !== undefined) {
        die(`conductor: --${flag} ${escapeControls(JSON.stringify(bad))} holds a control character — a ` +
          "tracker's recorded scope heads a section of the rules file and names the tracker in emitted " +
          "instructions, so it cannot hold one. Nothing was written.\n");
      }
    }
  }
  const state = loadState();
  const role = str(f.role) || "primary";
  if (role !== "primary" && role !== "secondary") {
    die("conductor: --role must be primary or secondary\n");
  }

  // `direction` is EXPLICIT configuration, never inferred from the vendor's name at any site.
  // Validated here, before either branch touches state, so a rejected value writes nothing on
  // the primary path or the secondary one.
  const direction = str(f.direction);
  if (direction !== undefined && !KNOWN_TRACKER_DIRECTIONS.includes(direction)) {
    die(`conductor: --direction must be one of ${KNOWN_TRACKER_DIRECTIONS.join("|")}\n`);
  }
  // A secondary tracker is PINNED to inward: the secondary role is defined as pull-only — open
  // issues come in as untriaged epics and no outward creation is specified for it anywhere — so
  // an outward secondary would be a direction with no procedure behind it.
  if (role === "secondary" && direction !== undefined && direction !== "inward") {
    die(
      `conductor: a secondary tracker is inward-only — --direction '${escapeControls(direction)}' is not available ` +
      "for --role secondary (a secondary tracker never gets outward-created issues)\n");
  }

  // THE REPOSITORY SHAPE, for either role, before anything is written. A github-issues repo is
  // placed in an emitted `gh issue list --repo …` line, so a value that could alter that command is
  // refused here rather than escaped there. `--remove` is exempt ON THE SECONDARY ROLE ONLY: that
  // branch matches the recorded value exactly and writes nothing new, so a legacy malformed entry
  // stays removable. The primary branch has no remove handler — `--remove` there falls through to
  // the merge, which SAVES `--repo` — so exempting it would write the refused value (Gate 2 E-C1).
  // The refused value is quoted through escapeControls(), so the refusal cannot itself carry a
  // control character.
  {
    const system = str(f.system) || (role === "primary" && state.tracker ? state.tracker.system : undefined);
    const repo = str(f.repo);
    const removingSecondary = role === "secondary" && !!f.remove;
    if (system === "github-issues" && repo !== undefined && !removingSecondary && !isGithubRepo(repo)) {
      die(`conductor: --repo ${escapeControls(JSON.stringify(repo))} is not a GitHub repository — ` +
        "a github-issues tracker records its repo as owner/name, or HOST/owner/name for GitHub Enterprise (letters, digits, `-`, and `.`/`_` in the name). " +
        "Nothing was written.\n");
    }
  }

  if (role === "secondary") {
    const system = str(f.system);
    const repo = str(f.repo);
    const projectKey = str(f.project);
    if (!system) {
      die("conductor: set-tracker --role secondary requires --system\n");
    }
    if (!repo && !projectKey) {
      die("conductor: set-tracker --role secondary requires --repo or --project\n");
    }
    if (f.remove) {
      const removed = removeSecondaryTracker(state, { system, repo, projectKey });
      if (!removed) {
        die(`conductor: no matching secondary tracker (${escapeControls(`${system}${repo ? ` ${repo}` : ` ${projectKey}`}`)})\n`);
      }
      const saved = saveState(state);
      writeRules(resolvePlatform({}, state));
      render();
      reportSave(saved, {
        changed: `conductor: secondary tracker removed (${escapeControls(`${system}${repo ? ` ${repo}` : ` ${projectKey}`}`)})`,
        unchanged: `conductor: no secondary tracker matched (${escapeControls(`${system}${repo ? ` ${repo}` : ` ${projectKey}`}`)}) — ` +
          `${STATE_UNCHANGED} (the rules block and PROJECT.md were re-rendered)`,
      });
      return;
    }
    const entry = { system, role: "secondary" };
    if (repo) entry.repo = repo;
    if (projectKey) entry.projectKey = projectKey;
    if (str(f.instance) !== undefined) entry.instance = str(f.instance);
    if (str(f.mechanism) !== undefined) entry.mechanism = str(f.mechanism);
    if (direction !== undefined) entry.direction = direction;
    // NEW entries only — computed BEFORE the upsert merges, for the same reason the primary
    // path computes `isNew` before its spread.
    const existingSecondary = (Array.isArray(state.secondaryTrackers) ? state.secondaryTrackers : [])
      .some(e => secondaryTrackerKey(e) === secondaryTrackerKey(entry));
    if (!existingSecondary && entry.direction === undefined) entry.direction = "inward";
    upsertSecondaryTracker(state, entry);
    const saved = saveState(state);
    writeRules(resolvePlatform({}, state));
    render();
    reportSave(saved, {
      changed: `conductor: secondary tracker set (${escapeControls(`${entry.system}${entry.repo ? ` ${entry.repo}` : ` ${entry.projectKey}`}`)})`,
      unchanged: `conductor: that secondary tracker was already recorded exactly so — ` +
        `${STATE_UNCHANGED} (the rules block and PROJECT.md were re-rendered)`,
    });
    return;
  }

  // Captured BEFORE the merge below. `t` is a spread of the EXISTING tracker, so a naive
  // `if (!t.direction) t.direction = "inward"` placed after it would stamp `inward` onto every
  // pre-existing direction-less jira repo the first time anyone ran `set-tracker` for any
  // reason — silently switching OFF the outward mirroring that repo has always had. A new
  // tracker chooses; an existing one keeps resolving exactly as it did.
  // The PRIMARY branch writes `state.tracker` and nothing else — it never creates or touches
  // `state.secondaryTrackers`, which only the `--role secondary` branch above may write. The two
  // roles share this command and nothing else; a primary write that reached into the secondary
  // list would silently re-scope work that was deliberately kept out of the primary mirror.
  const isNew = !(state.tracker && state.tracker.system);
  const t = { ...(state.tracker || {}) };
  // A VENDOR SWITCH — `--system` names a system different from the one recorded. Two things a plain
  // merge would carry across silently (repro.txt §B9):
  //   scope: `repo`, `projectKey` and `instance` belong to the tracker they were recorded for, so
  //     each one this call does not re-supply is DROPPED and named — carried over, every heading,
  //     listing step and derived id would name the old tracker;
  //   direction: a primary with no recorded direction resolves by system, so switching the system
  //     alone would turn outward creation on or off. Unless `--direction` is given, a recorded
  //     direction is kept, and an unrecorded one is RECORDED as what the old tracker resolved to.
  //   `statusIntent` and `mechanism` are kept — they describe how the user works, not where.
  const notices = [];
  const previous = state.tracker && state.tracker.system ? state.tracker : null;
  if (previous && str(f.system) !== undefined && str(f.system) !== previous.system) {
    const resupplied = { repo: str(f.repo), projectKey: str(f.project), instance: str(f.instance) };
    for (const field of ["repo", "projectKey", "instance"]) {
      if (t[field] !== undefined && resupplied[field] === undefined) {
        notices.push(`conductor: dropped ${field}=${escapeControls(JSON.stringify(t[field]))} recorded for ${escapeControls(previous.system)}`);
        delete t[field];
      }
    }
    if (direction === undefined && t.direction === undefined) {
      const kept = directionOf(previous);
      t.direction = kept;
      notices.push(`conductor: direction ${kept} recorded — kept from the previous ${escapeControls(previous.system)} tracker, which ` +
        `resolved to it; set-tracker --direction <${KNOWN_TRACKER_DIRECTIONS.join("|")}> to change it`);
    }
  }
  if (str(f.system) !== undefined) t.system = str(f.system);
  if (str(f.instance) !== undefined) t.instance = str(f.instance);
  if (str(f.project) !== undefined) t.projectKey = str(f.project);
  if (str(f.mechanism) !== undefined) t.mechanism = str(f.mechanism);
  if (str(f.repo) !== undefined) t.repo = str(f.repo);
  if (direction !== undefined) t.direction = direction;
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
    die("conductor: set-tracker requires --system (e.g. jira)\n");
  }
  // A NEW primary tracker defaults to `inward`. Deliberate, user-visible reversal for newly
  // registered non-github trackers: creating issues in someone else's tracker is the
  // consequential direction and must be chosen, not inherited. `set-tracker --direction
  // outward` is the one-flag remedy.
  if (isNew && t.direction === undefined) t.direction = "inward";
  state.tracker = t;
  const saved = saveState(state);
  for (const line of notices) process.stderr.write(`${line}\n`);
  writeRules(resolvePlatform({}, state));   // refresh CLAUDE.md so the agent sees its new tracker-sync responsibility
  render();
  reportSave(saved, {
    changed: `conductor: tracker set (${escapeControls(`${t.system}${t.projectKey ? ` ${t.projectKey}` : ""}`)})`,
    unchanged: `conductor: the primary tracker was already recorded exactly so — ${STATE_UNCHANGED} ` +
      "(the rules block and PROJECT.md were re-rendered)",
  });
}
