// scripts/test/fixtures/assert-harness.mjs
// THE ASSERTION HALF'S BINDING (task 5.1). Everything a test needs from `fixtures/helpers.mjs`,
// with `run`/`runCombined` bound to the in-process entry point AND to the git double.
//
// THE DOUBLE MODELS "there is no repository here", which is the truth about every assertion-half
// invocation: the half runs against a fresh temporary directory, and a test whose subject needs a
// real repository is in the functional half instead (design D5). See `fakeGit({noRepository:true})`
// and the frozen `noRepository` section of the capture, which 4.4 proves byte-identical to the real
// git's answers in exactly that world.
//
// THE ONE IMPORT LINE a moved test needs is this module in place of `./helpers.mjs`; everything
// else it used is re-exported below.

export * from "./helpers.mjs";

// THE RUNTIME GUARD (G-I4), installed by IMPORT — see the module's own header. It must come before
// the harness builds anything, and it must never be imported by the functional half's binding:
// `scripts/test/functional/` runs the real git on purpose, and a PATH shim there would make the
// half that exists to prove the double against the real binary unable to find it.
import "./assert-git-shim.mjs";
export { gitSpawns, GIT_SPAWN_LOG, SHIM_DIR } from "./assert-git-shim.mjs";

import { EMPTY_CACHE, makeHarness, setRunner } from "./harness.mjs";
import { fakeGit } from "./fake-git.mjs";
import { installedInvocation, setInvocation } from "../../lib/invocation.mjs";

/** Run `fn` with an invocation INSTALLED, the way `run()` installs one for the duration of a call.
 *
 *  WHY THIS EXISTS (G-I4). A test that imports a lib module directly and calls a function from it
 *  runs OUTSIDE any invocation, so `invocation()` answers with the live PROCESS_CONTEXT and
 *  `gitOps()` builds the REAL gateway — one `git symbolic-ref` per call, in the half whose whole
 *  contract is that it runs no git. The call site that did this was invisible to review and to the
 *  source scan; the fix is not to weaken either, it is to give such a test the same invocation every
 *  other test in this half gets. The double is the half's (`fakeGit({ noRepository: true })`), the
 *  streams are discarded, and the previous invocation — usually `null`, the process view — is put
 *  back afterwards so a later direct call sees exactly what it saw before.
 *
 *  ASYNC-AWARE: `fn` is awaited before the invocation is restored, so a test may await between its
 *  own appends and still have each call land under the root it was given. */
export async function withAssertInvocation(cwd, fn) {
  const prev = installedInvocation();
  setInvocation({
    cwd,
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, PM_CACHE_ROOT: EMPTY_CACHE },
    argv: ["node", "conductor.mjs"],
    stdin: { read: () => "", isTTY: false },
    stdout: { write: () => true },
    stderr: { write: () => true },
    git: fakeGit({ noRepository: true }),
  });
  try {
    return await fn();
  } finally {
    setInvocation(prev);
  }
}

const harness = makeHarness({ fake: true });
export const run = harness.run;
export const runCombined = harness.runCombined;
// For a test that needs the STATUS rather than the throwing form — the same in-process
// invocation `run` is built on, and the shape a local `spawnSync` helper returned.
export const invokeEngine = harness.invokeEngine;
// Registered so the helpers that drive the engine themselves (parseBrief, setupHierarchy,
// nudgeAndReadLog) use THIS half's run rather than a second route.
setRunner(harness.run);
