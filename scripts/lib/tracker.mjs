// scripts/lib/tracker.mjs
// The set-tracker verb: configures primary/secondary external-tracker mirroring.
// One-directional dependency on lib/rules.mjs's writeRules() -- see the design doc's
// corrected circular-imports section (this is NOT circular).

import { isInitialized, loadState, saveState } from "./state.mjs";
import { parseFlags } from "./add-epic.mjs";
import { removeSecondaryTracker, upsertSecondaryTracker, writeRules } from "./rules.mjs";
import { render } from "./render.mjs";

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
