// Which host agent is driving this invocation, and which file its rules block belongs in.
//
// pm never runs on its own: every engine invocation is triggered by a host agent, through a
// hook whose command string pm itself authored. So the platform is DECLARED, not detected --
// each platform's hook config carries `--platform <id>`. No markers, no filesystem
// archaeology, no precedence heuristic to get wrong.
import fs from "node:fs";
import path from "node:path";

import { KNOWN_PLATFORMS, PLATFORM_RULES_CHAIN } from "./constants.mjs";
import { isInitialized, loadState, saveState } from "./state.mjs";

/** Extract just `--platform <value>` from an argv slice.
 *
 *  Deliberately NOT lib/add-epic.mjs's parseFlags(): importing that would pull platform.mjs
 *  into add-epic.mjs -> render.mjs -> briefing.mjs -> active-pointer.mjs, the known circular
 *  cluster documented in CLAUDE.md. Since rules.mjs imports platform.mjs, any future edge
 *  from that cluster back to rules.mjs would close a loop around the rules writer itself.
 *  platform.mjs stays a LEAF -- constants.mjs and state.mjs only. Scanning for one flag is
 *  three lines; the coupling is not worth saving them. */
export function platformFlag(argv) {
  const i = argv.indexOf("--platform");
  if (i === -1) return "";
  const v = argv[i + 1];
  return (typeof v === "string" && !v.startsWith("--")) ? v.trim() : "";
}

/** Resolve the active platform. Never throws and never returns falsy: an unresolved
 *  platform that wrote NO rules block would be a silent no-op -- pm appearing installed
 *  while contributing nothing -- so the chain ends in a hard default.
 *
 *  Order: explicit flag > recorded in state > CLAUDECODE env > claude-code.
 *  An unknown explicit value is rejected by the caller (see assertKnownPlatform), not
 *  silently ignored, because it means a hand-authored hook has a typo. */
export function resolvePlatform(flags = {}, state = null) {
  // An unknown flag value is IGNORED here rather than returned, symmetrically with how an
  // unknown recorded value is ignored below. Callers run assertKnownPlatform() first so a typo
  // in a hand-authored hook still fails loudly; this is the second line of defence, so that a
  // caller which forgets cannot leak a garbage id into rulesTarget()/pmCmd() -- both of which
  // would silently fall back to claude-code anyway, just less legibly.
  const flag = typeof flags.platform === "string" ? flags.platform.trim() : "";
  if (flag && KNOWN_PLATFORMS.includes(flag)) return flag;
  const recorded = state && typeof state.platform === "string" ? state.platform.trim() : "";
  if (recorded && KNOWN_PLATFORMS.includes(recorded)) return recorded;

  // NOTE: there is deliberately no CLAUDECODE env rung. One existed and was dead code -- both
  // its branches returned "claude-code", so it could never change an outcome, and the test that
  // claimed to distinguish "the env rung" from "the terminal default" could not fail for the
  // reason it stated. If a future platform ever needs env-based inference, add it as a real
  // branch that returns something different, not as a no-op that reads like coverage.
  return "claude-code";
}

/** Exit(1) with a legible message on an unknown platform, mirroring how add-epic
 *  treats an unknown --lane. Called only for an EXPLICIT flag value. */
export function assertKnownPlatform(platform) {
  if (!KNOWN_PLATFORMS.includes(platform)) {
    process.stderr.write(`conductor: --platform must be one of ${KNOWN_PLATFORMS.join("|")}\n`);
    process.exit(1);
  }
}

/** Absolute path of the file this platform's rules block belongs in: the first file in
 *  its chain that already EXISTS (that is the one the platform will actually read), else
 *  the chain's last entry. */
export function rulesTarget(platform, root) {
  const chain = PLATFORM_RULES_CHAIN[platform] || PLATFORM_RULES_CHAIN["claude-code"];
  for (const name of chain) {
    const candidate = path.join(root, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.join(root, chain[chain.length - 1]);
}

/** Stamp the active platform onto state. Returns true when it changed, so a caller can
 *  detect a platform SWITCH (the project changed hands) and report it. */
export function recordPlatform(state, platform) {
  if (state.platform === platform) return false;
  state.platform = platform;
  return true;
}

/** Resolve the platform for a top-level subcommand invocation and persist it.
 *  Centralised because the dispatch table calls every subcommand with NO arguments, so
 *  each entry point must read argv itself -- duplicating that logic is exactly how one of
 *  them silently stops honouring the flag. Returns { platform, switched }. */
export function resolveAndRecordPlatform() {
  const declared = platformFlag(process.argv.slice(3));
  if (declared) assertKnownPlatform(declared);
  const state = loadState();
  const platform = resolvePlatform({ platform: declared }, state);
  const switched = recordPlatform(state, platform);
  // Persist ONLY in a repo that is already conductor-managed.
  //
  // loadState() returns defaultState() for a missing file rather than null, so recordPlatform()
  // always reports a change on a fresh repo and an unguarded saveState() here CREATES
  // .conductor/state.json in a project that never ran /pm:init. That silently ends pm's
  // dormancy: once state.json exists, isInitialized() is true and every hook activates.
  // Verified live before this guard -- `write-rules` in an empty directory produced a state
  // file, after which commit-nudge started firing.
  if (switched && isInitialized()) saveState(state);
  return { platform, switched };
}
