// scripts/test/fixtures/explicit-root.mjs
// test-isolation-guard I1 — a test that calls an engine lib function DIRECTLY names the root it means.
//
// Outside `main()` the engine answers `engineRoot()` from the process view: `CLAUDE_PROJECT_DIR || cwd`.
// `record-isolation.mjs` pins `CLAUDE_PROJECT_DIR` to an empty scratch directory in every test process,
// so a direct call that relied on that fallback to reach THIS repository (its live record, its real git
// history) now reads the scratch directory instead — which is the pin doing its job. Such a test says
// which repository it reads by running the call inside `withRoot(root, fn)`: an invocation whose root and
// cwd are `root`, installed for the duration of `fn` and then removed, exactly the save/restore `main()`
// does. The process environment is never touched, so nothing else in the process is unpinned.
//
// A write made inside `withRoot(REPO, …)` lands in the real repository, and the exit check reports it —
// naming a root explicitly is a statement of intent, not a licence.

import path from "node:path";
import { installedInvocation, setInvocation } from "../../lib/invocation.mjs";

/** Run `fn` with the engine's root and cwd set to `root`; restore the previous invocation after, also
 *  when `fn` throws or its promise rejects. */
export function withRoot(root, fn) {
  const abs = path.resolve(root);
  const previous = installedInvocation();
  setInvocation({
    cwd: abs,
    root: abs,
    env: { ...process.env, CLAUDE_PROJECT_DIR: abs },
    argv: process.argv,
    stdin: { real: false, read: () => "", isTTY: false },
    stdout: process.stdout,
    stderr: process.stderr,
  });
  let result;
  try {
    result = fn();
  } catch (err) {
    setInvocation(previous);
    throw err;
  }
  if (result && typeof result.then === "function") return result.finally(() => setInvocation(previous));
  setInvocation(previous);
  return result;
}
