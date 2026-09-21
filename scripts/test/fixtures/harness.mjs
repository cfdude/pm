// scripts/test/fixtures/harness.mjs
// THE TWO HALVES' INVOCATION HARNESS (task 5.1 of functional-assertion-test-split, design D5).
//
// ONE IMPLEMENTATION, TWO BINDINGS. `run` and `runCombined` used to spawn `node
// scripts/conductor.mjs …` per call. They now call `main(argv, io)` IN THE RUNNING PROCESS, and the
// only thing that differs between the halves is the git gateway the invocation is handed:
//
//   * the ASSERTION half passes the double — `fakeGit({ noRepository: true })`, because every
//     invocation in that half runs against a temporary directory that is not a repository (D5 sends
//     a test that needs a real repository to the functional half). Those tests are bound by
//     `fixtures/assert-harness.mjs`, and the guard in `scripts/test/assert/` fails on any file that
//     spawns a child or reaches git for itself.
//   * the FUNCTIONAL half passes NOTHING, so `lib/invocation.mjs` builds the real gateway over the
//     invocation's own context and the engine runs the real git. Those tests are bound by
//     `fixtures/functional-harness.mjs`.
//
// WHY IN-PROCESS RATHER THAN A PROCESSS BOUNDARY. That IS the change: the assertion half's cost was
// 1,961 process spawns, and the engine was made invocable in-process for exactly this. The functional
// half could spawn and does not, because the subject it needs to exercise is the REAL GATEWAY, not
// the process boundary — the boundary is exercised where a boundary is the subject (the conformance
// set's CLI route, and the hook verbs' end-to-end invocations).
//
// THE THROWING CONTRACT IS PRESERVED EXACTLY, because 226 call sites depend on it:
// `expectFail(() => run(...))` and `assert.throws(() => run(...))` read the error's `.stderr` or
// `.message`. `execFileSync` throws on any non-zero exit, so `run()` throws here too, with `.status`,
// `.stdout` and `.stderr` set the way that error carries them.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { main } from "../../conductor.mjs";
import { fakeGit } from "./fake-git.mjs";

/** One empty version cache for the whole process, as before: `pluginVersion()`/tool-currency read
 *  it, and a per-call one would be a filesystem allocation per assertion. */
export const EMPTY_CACHE = fs.mkdtempSync(path.join(os.tmpdir(), "pm-empty-cache-"));

// ─────────── which half's `run` the shared helpers should use ───────────
//
// `fixtures/helpers.mjs` holds three helpers that drive the engine THEMSELVES — `parseBrief`,
// `setupHierarchy`, `nudgeAndReadLog` — and they must go through the same in-process, gateway-injected
// route the calling test got, not a second one of their own. They cannot import `run` from either
// harness module (each of those re-exports helpers, so that way lies a cycle), so the binding is
// registered here at the harness module's import, and READ at call time: by then every import in the
// graph has run, whichever harness the test file used has registered, and the half is fixed for the
// process. Reading it early throws rather than quietly spawning.
let RUNNER = null;
export function setRunner(fn) { RUNNER = fn; }
export function runner() {
  if (!RUNNER) {
    throw new Error("no test harness bound: import run/runCombined from fixtures/assert-harness.mjs " +
      "or fixtures/functional-harness.mjs rather than reaching the engine from a helper");
  }
  return RUNNER;
}

/** One in-process invocation, with the caller's streams, the caller's stdin and (optionally) a
 *  double for git. Returns the captured streams and the returned status rather than throwing, so
 *  `runCombined` and a caller that wants the status can both be built on it. */
export function invokeEngine(args, { cwd, env = {}, input, git } = {}) {
  let out = "", err = "";
  const io = {
    cwd,
    // The same three keys the spawned form set: the root the engine acts on, the empty cache it
    // reads versions from, and whatever the caller overrode. `process.env` is spread FIRST so the
    // caller's values win, exactly as `{ ...process.env, CLAUDE_PROJECT_DIR: cwd, ...env }` did.
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, PM_CACHE_ROOT: EMPTY_CACHE, ...env },
    stdin: { read: () => (input === undefined ? "" : input), isTTY: false },
    stdout: { write: (s) => { out += s; return true; } },
    stderr: { write: (s) => { err += s; return true; } },
    ...(git ? { git } : {}),
  };
  const status = main(args, io);
  return { status, stdout: out, stderr: err };
}

/** The two entry points, bound to one gateway. `fake` is a boolean rather than an object because the
 *  double is built PER CALL: the no-repository world has no roots to declare, and building it fresh
 *  keeps a test from seeing a previous test's answers. */
export function makeHarness({ fake }) {
  const invoke = (args, opts = {}) => invokeEngine(args, { ...opts, git: fake ? fakeGit({ noRepository: true }) : undefined });

  function run(args, opts = {}) {
    const r = invoke(args, opts);
    if (r.status !== 0) {
      const e = new Error(r.stderr || `conductor exited ${r.status}: ${args.join(" ")}`);
      e.status = r.status;
      e.stdout = r.stdout;
      e.stderr = r.stderr;
      throw e;
    }
    return r.stdout;
  }
  function runCombined(args, opts = {}) {
    const r = invoke(args, opts);
    return r.stdout + r.stderr;
  }
  return { run, runCombined, invokeEngine: invoke };
}
