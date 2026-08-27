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
// The fix belongs in the ENGINE, not in hooks.json: one handoff at startup covers all 19
// entry points, and no caller has to remember anything. Depends only on lib/constants.mjs
// (ROOT) and lib/state.mjs (readJSON) so it can run before anything else.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT } from "./constants.mjs";
import { readJSON } from "./state.mjs";

/** Set on the child so a delegated engine never delegates again. realpath equality already
 *  catches the immediate loop; this covers shapes realpath cannot compare — a shim, a copy,
 *  a bind mount — where the two paths differ but the code is the same. */
export const DELEGATED_ENV = "PM_ENGINE_DELEGATED";
/** Escape hatch, in case the handoff ever misfires in a tree we did not anticipate. */
export const NO_DELEGATION_ENV = "PM_NO_ENGINE_DELEGATION";

/** The engine of the pm checkout `root` is, or null if `root` is not a pm checkout.
 *
 *  BOTH files are required, and the manifest's `name` is checked. This is a safety guard, not
 *  a narrowing nicety: the plugin's hooks fire in EVERY project on this machine, so keying off
 *  `scripts/conductor.mjs` alone would execute arbitrary code from any repo that happens to
 *  carry that path. */
export function checkoutEngine(root = ROOT) {
  const engine = path.join(root, "scripts", "conductor.mjs");
  if (!fs.existsSync(engine)) return null;
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
  if (env[DELEGATED_ENV] || env[NO_DELEGATION_ENV]) return null;
  const engine = checkoutEngine(root);
  if (!engine) return null;

  let target, self;
  try { target = fs.realpathSync(engine); } catch { return null; }
  try { self = fs.realpathSync(selfPath); } catch { self = selfPath; }
  if (target === self) return null;  // already the checkout engine — nothing to hand off to

  const r = spawnSync(process.execPath, [engine, ...argv], {
    stdio: "inherit",
    env: {
      ...env,
      [DELEGATED_ENV]: "1",
      CLAUDE_PLUGIN_ROOT: path.dirname(path.dirname(engine)),
    },
  });
  if (r.error) {
    process.stderr.write(
      `conductor: could not hand off to the checkout engine at ${engine} ` +
      `(${r.error.message}); running the installed engine instead\n`
    );
    return null;
  }
  // A child killed by a signal reports status null; treat that as a failure rather than as
  // success, which is what a bare `|| 0` would silently produce.
  return r.status === null ? 1 : r.status;
}
