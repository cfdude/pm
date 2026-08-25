// scripts/lib/tracker.mjs
// The set-tracker verb: configures primary/secondary external-tracker mirroring.
// One-directional dependency on lib/rules.mjs's writeRules() -- see the design doc's
// corrected circular-imports section (this is NOT circular).

import { isInitialized, loadState, saveState } from "./state.mjs";
import { parseFlags } from "./add-epic.mjs";
import { removeSecondaryTracker, secondaryTrackerKey, upsertSecondaryTracker, writeRules } from "./rules.mjs";
import { render } from "./render.mjs";
import { resolvePlatform } from "./platform.mjs";
import { KNOWN_TRACKER_DIRECTIONS } from "./constants.mjs";

/** Write/merge the `tracker` block (role: primary, default) or upsert/remove an entry in
 *  `state.secondaryTrackers` (role: secondary). Pure local state write — the engine NEVER
 *  contacts the tracker; it only records that one is in use so the instructions it emits (rules
 *  block + brief) can assign sync work to the interactive agent. */
export function setTracker() {
  if (!isInitialized()) { process.stderr.write("conductor: run /pm:init first\n"); process.exit(1); }
  const f = parseFlags(process.argv.slice(3));
  const str = (v) => (typeof v === "string" ? v : undefined);
  const state = loadState();
  const role = str(f.role) || "primary";
  if (role !== "primary" && role !== "secondary") {
    process.stderr.write("conductor: --role must be primary or secondary\n"); process.exit(1);
  }

  // `direction` is EXPLICIT configuration, never inferred from the vendor's name at any site.
  // Validated here, before either branch touches state, so a rejected value writes nothing on
  // the primary path or the secondary one.
  const direction = str(f.direction);
  if (direction !== undefined && !KNOWN_TRACKER_DIRECTIONS.includes(direction)) {
    process.stderr.write(`conductor: --direction must be one of ${KNOWN_TRACKER_DIRECTIONS.join("|")}\n`);
    process.exit(1);
  }
  // A secondary tracker is PINNED to inward: the secondary role is defined as pull-only — open
  // issues come in as untriaged epics and no outward creation is specified for it anywhere — so
  // an outward secondary would be a direction with no procedure behind it.
  if (role === "secondary" && direction !== undefined && direction !== "inward") {
    process.stderr.write(
      `conductor: a secondary tracker is inward-only — --direction '${direction}' is not available ` +
      "for --role secondary (a secondary tracker never gets outward-created issues)\n");
    process.exit(1);
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
      writeRules(resolvePlatform({}, state));
      render();
      process.stderr.write(`conductor: secondary tracker removed (${system}${repo ? ` ${repo}` : ` ${projectKey}`})\n`);
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
    saveState(state);
    writeRules(resolvePlatform({}, state));
    render();
    process.stderr.write(`conductor: secondary tracker set (${entry.system}${entry.repo ? ` ${entry.repo}` : ` ${entry.projectKey}`})\n`);
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
    process.stderr.write("conductor: set-tracker requires --system (e.g. jira)\n"); process.exit(1);
  }
  // A NEW primary tracker defaults to `inward`. Deliberate, user-visible reversal for newly
  // registered non-github trackers: creating issues in someone else's tracker is the
  // consequential direction and must be chosen, not inherited. `set-tracker --direction
  // outward` is the one-flag remedy.
  if (isNew && t.direction === undefined) t.direction = "inward";
  state.tracker = t;
  saveState(state);
  writeRules(resolvePlatform({}, state));   // refresh CLAUDE.md so the agent sees its new tracker-sync responsibility
  render();
  process.stderr.write(`conductor: tracker set (${t.system}${t.projectKey ? ` ${t.projectKey}` : ""})\n`);
}
