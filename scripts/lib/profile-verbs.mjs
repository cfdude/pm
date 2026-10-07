// scripts/lib/profile-verbs.mjs
// The `set-profile` and `profile` verbs (execution-profile-layered-settings D4). All the logic sits in
// execution-profile.mjs as pure functions; this file owns the argv, the state write and the output.

import { isInitialized, loadState, saveState } from "./state.mjs";
import { reportSave, STATE_UNCHANGED } from "./save-report.mjs";
import { parseFlags, requireFlagValues } from "./add-epic.mjs";
import { writeRules } from "./rules.mjs";
import { render } from "./render.mjs";
import { KNOWN_LANES, escapeControls } from "./constants.mjs";
import { resolvePlatform } from "./platform.mjs";
import { die } from "./command-exit.mjs";
import { currentArgv, outStream } from "./invocation.mjs";
import { applyProfileOps, parseSetProfile, profileLines, resolveProfile } from "./execution-profile.mjs";

/** `set-profile [--lane <lane>] [--review <m>] [--model <role>=<model>[:<effort>]]... [--verbosity <n>]
 *  [--unset <field>]...` — writes the project layer, or one lane's layer. Every set has its inverse in
 *  `--unset`. Refreshes the managed rules block (which shows project and lane values) and PROJECT.md,
 *  exactly as `set-review-mode` does. A call that changes nothing — including an unset of a field that
 *  is not set — writes nothing and says so. */
export function setProfile() {
  if (!isInitialized()) { die("conductor: run /pm:init first\n"); }
  const f = parseFlags(currentArgv().slice(3));
  requireFlagValues("set-profile", f);
  const parsed = parseSetProfile(f);
  if (!parsed.ok) die(`conductor: ${parsed.message}\n`);
  const state = loadState();
  const { changed, already, described } = applyProfileOps(state, parsed.ops);
  const where = parsed.ops.lane ? `lane ${escapeControls(parsed.ops.lane)}` : "project";
  const notes = already.length ? ` (already unset: ${already.map(escapeControls).join(", ")})` : "";
  if (!changed) {
    outStream().write(`conductor: ${where} profile unchanged${notes} — ${STATE_UNCHANGED}\n`);
    return;
  }
  const saved = saveState(state);
  writeRules(resolvePlatform({}, state));   // the block shows project and lane values
  render();
  reportSave(saved, {
    changed: `conductor: ${where} profile: ${described.map(escapeControls).join(", ")}${notes}`,
    unchanged: `conductor: ${where} profile already held exactly this — ${STATE_UNCHANGED}`,
  });
}

/** `profile [--epic <id> | --lane <lane>]` — read-only. Prints each field's effective value with the
 *  layer it came from. With neither flag it prints the project layer. */
export function profile() {
  if (!isInitialized()) { die("conductor: run /pm:init first\n"); }
  const f = parseFlags(currentArgv().slice(3));
  requireFlagValues("profile", f);
  if (f.epic !== undefined && f.lane !== undefined) {
    die("conductor: profile takes --epic or --lane, not both\n");
  }
  const state = loadState();
  let scope = "project";
  let opts = {};
  if (f.epic !== undefined) {
    if (!state.epics.some((e) => e.id === f.epic)) {
      die(`conductor: profile: no epic '${escapeControls(String(f.epic))}'\n`);
    }
    scope = `epic ${f.epic}`;
    opts = { epicId: f.epic };
  } else if (f.lane !== undefined) {
    if (!KNOWN_LANES.includes(f.lane)) {
      die(`conductor: profile: --lane '${escapeControls(String(f.lane))}' is not one of ${KNOWN_LANES.join("|")}\n`);
    }
    scope = `lane ${f.lane}`;
    opts = { lane: f.lane };
  }
  const lines = [`Execution profile — ${scope}`, ...profileLines(resolveProfile(state, opts))];
  outStream().write(lines.map(escapeControls).join("\n") + "\n");
}
