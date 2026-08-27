// scripts/lib/self-hosting.mjs
// gh-134: hand execution off to the checkout's engine when pm is being developed.
//
// Every entry point the plugin ships — `hooks/hooks.json` (4 hooks) and `commands/*.md` (15
// slash commands) — invokes `${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs`, which resolves to
// the INSTALLED plugin, not the checkout being edited. Working on pm itself therefore runs an
// engine a full release behind the working tree; the PostToolUse hook fires on every commit
// and re-renders the tracked PROJECT.md with output that predates the change being made, and a
// broad `git add` commits that as an apparent regression. The slash-command half of this is
// docs/lessons/slash-commands-run-the-installed-plugin.md; the hook half is worse because
// nobody invokes it, so nobody thinks to doubt it.
//
// ─────────────────────────── THE TRUST BOUNDARY ───────────────────────────
//
// This module decides whether to execute code the PROJECT supplies, and that decision is
// evaluated in EVERY project on the machine, initialized or not, by four hooks — SessionStart,
// PreToolUse, PostToolUse, PreCompact — on roughly every turn. Before this handoff existed,
// those hooks could only ever run code that shipped with the plugin.
//
// So the authorization MUST come from something the project cannot write. The first version of
// this file keyed off `<project>/scripts/conductor.mjs` plus a `.claude-plugin/plugin.json`
// naming `pm` — which is two lines of JSON an attacker writes. A directory containing exactly
// those two files was enough to get arbitrary code executed with the full parent environment,
// with no `.conductor/`, no `/pm:init`, and no user action beyond opening the folder.
//
// The gate is therefore OPT-IN and NAMES THE CHECKOUT: `PM_ENGINE_DELEGATION=<absolute path>`,
// honoured only when it resolves to the same real path as the project being run in. A bare
// boolean would not do — a developer exports it once in a shell profile, where it would then be
// set for every project they ever open, re-opening the hole for exactly the person most likely
// to set it. A path names one tree; a hostile repo anywhere else never matches.
//
// The manifest and file-existence checks below are kept as sanity checks — they catch a
// mistyped path pointing at a non-pm tree — but they are NOT the boundary and must never again
// be treated as one. Every guard in this file is mutation-tested: neuter it and a named test
// must fail. Two that could not were deleted rather than left standing as decoration.
//
// Depends only on lib/constants.mjs (ROOT) and lib/state.mjs (readJSON) so it can run before
// anything else.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT } from "./constants.mjs";
import { readJSON } from "./state.mjs";

/** Opt-in, and the whole trust boundary: the ABSOLUTE PATH of the checkout whose engine may be
 *  executed. Unset — the default, and what every ordinary project sees — means no handoff. */
export const DELEGATION_ENV = "PM_ENGINE_DELEGATION";
/** Set on the child so a delegated engine never delegates again. The realpath equality check
 *  below already closes the loop for every shape realpath can compare — a copy, a shim, a bind
 *  mount, a hardlink, a worktree, a case-differing ROOT. This sentinel covers what realpath
 *  cannot reason about: a target engine that predates this release, or is not a conductor at
 *  all, and so would not perform the equality check itself. */
export const DELEGATED_ENV = "PM_ENGINE_DELEGATED";

/** realpath, or null when the path does not exist / is unreadable. */
function real(p) {
  try { return fs.realpathSync(p); } catch { return null; }
}

/** Has the USER authorized executing `root`'s own engine? True only when the environment names
 *  a path that resolves to the same tree as `root`. Nothing readable from inside `root` can
 *  influence this. */
export function delegationAuthorized(root = ROOT, env = process.env) {
  const named = env[DELEGATION_ENV];
  if (!named) return false;
  const a = real(named);
  const b = real(root);
  return a !== null && b !== null && a === b;
}

/** The RESOLVED path of the engine the pm checkout `root` carries, or null if `root` does not
 *  look like one.
 *
 *  A sanity check on an ALREADY-AUTHORIZED path, not an authorization check — see the trust
 *  boundary note above. Both files must be present and the manifest must name `pm`, so a
 *  mistyped `PM_ENGINE_DELEGATION` pointing at some unrelated tree fails closed instead of
 *  running whatever happens to sit at `scripts/conductor.mjs` there.
 *
 *  Existence is checked by `real()` — which returns null for an absent path and is propagated
 *  straight out — rather than by a separate `existsSync` or an extra `=== null` branch. Both of
 *  those were written here first and BOTH survived being mutated away with the suite still
 *  green, because the null already flows to the caller unaided. A check no test can reach is
 *  not defence in depth; it is the shape of protection with none of the substance, and in a
 *  file that decides whether to execute someone else's code it is worse than nothing. The one
 *  reachable existence guard is the caller's `target === null`. */
export function checkoutEngine(root = ROOT) {
  const engine = real(path.join(root, "scripts", "conductor.mjs"));
  const manifest = readJSON(path.join(root, ".claude-plugin", "plugin.json"), null);
  if (!manifest || manifest.name !== "pm") return null;
  return engine;
}

/** Re-exec the checkout's engine with this process's arguments, returning its exit code — or
 *  null when no handoff applies and the caller should just run locally.
 *
 *  `selfPath` is the absolute path of the running conductor.mjs.
 *
 *  Two details are load-bearing:
 *   - CLAUDE_PLUGIN_ROOT is REPOINTED at the checkout. It is env-first in plugin-meta.mjs, so a
 *     child that inherited the installed value would read the installed plugin.json and render
 *     exactly the stale output this handoff exists to prevent — the handoff would run and the
 *     bug would survive it.
 *   - the child's exit status is propagated verbatim. `gate-guard` is a BLOCKING PreToolUse
 *     hook and CONFLICT_EXIT_CODE (9) is retryable-vs-fatal signal; swallowing either turns a
 *     rendering bug into a safety regression.
 *
 *  A spawn failure degrades to the status quo (run the installed engine) rather than crashing
 *  the hook: stale output is a nuisance, a hook that cannot run is worse. */
export function delegateToCheckout({
  selfPath,
  argv = process.argv.slice(2),
  root = ROOT,
  env = process.env,
} = {}) {
  if (env[DELEGATED_ENV]) return null;
  if (!delegationAuthorized(root, env)) return null;
  const target = checkoutEngine(root);  // already realpath-resolved
  if (target === null) return null;

  const self = real(selfPath) ?? selfPath;
  if (target === self) return null;  // already the checkout engine — nothing to hand off to

  const r = spawnSync(process.execPath, [target, ...argv], {
    stdio: "inherit",
    env: { ...env, [DELEGATED_ENV]: "1", CLAUDE_PLUGIN_ROOT: root },
  });
  if (r.error) {
    process.stderr.write(
      `conductor: could not hand off to the checkout engine at ${target} ` +
      `(${r.error.message}); running the installed engine instead\n`
    );
    return null;
  }
  // A child killed by a signal reports status null; treat that as a failure rather than as
  // success, which is what a bare `|| 0` would silently produce.
  return r.status === null ? 1 : r.status;
}
