// scripts/lib/invocation.mjs
// THE current invocation's values — the root it acts on, the arguments it reads, the environment it
// consults, the input it drains and the streams it writes. Every module reads these from HERE
// rather than from the process globals, and `main(argv, io)` sets them once at entry.
//
// WHY THIS EXISTS, and why it is a value rather than a set of parameters threaded through 57
// modules. engine-invocation requires two invocations in ONE process to be independent: each acts
// on its own working directory, reads its own arguments, writes to its own streams. `constants.mjs`
// used to freeze `ROOT` at module load and eleven path constants derived from it in the same pass,
// which makes the FIRST caller's root the only root any module can ever see — and under the
// assertion half's `--test-isolation=none`, where every test file shares one module graph, that is
// every later test writing into the first test's directory. Threading six values through ~2,500
// call sites to fix it would be a rewrite; the engine is a library with exactly one entry point, so
// the values belong to the invocation, not to the call graph.
//
// This is NOT the module-scope capture it replaces, and the difference is the whole point:
// `PROCESS_CONTEXT` below is a LIVE view (getters), so a caller that never enters through `main()`
// — a test importing `state.mjs` directly and moving `CLAUDE_PROJECT_DIR` — sees exactly today's
// behaviour, while a caller that does enter through `main()` is handed a snapshot for the duration
// of that one call. `setInvocation()` is called once per invocation and never concurrently: the
// assertion half is a SINGLE process running tests in sequence.
//
// Depends on Node built-ins and one leaf: `git-gateway.mjs`, which imports NOTHING from the engine,
// so the cycle this module's own note warns about — anything imported here cycles back into
// `constants.mjs`, the module every other module depends on — cannot form. `constants.mjs` imports
// THIS module for `engineRoot`; `git-gateway.mjs` imports neither.

import fs from "node:fs";
import { isatty } from "node:tty";
import { realGit } from "./git-gateway.mjs";

let CURRENT = null;

/** The gateway used when nothing has called `setInvocation()`: built once, lazily, against a LIVE
 *  view of this process. See `gitOps()` below for why it lives here rather than being imported by
 *  its callers. */
let PROCESS_GIT = null;

/** The context used when nothing has called `setInvocation()`: the real process. Live getters, so
 *  a direct importer of a lib module keeps the behaviour it had before this module existed. */
const PROCESS_CONTEXT = {
  get cwd() { return process.cwd(); },
  get env() { return process.env; },
  get argv() { return process.argv; },
  get stdin() {
    return { real: true, read: () => fs.readFileSync(0, "utf8"), get isTTY() { return isatty(0); } };
  },
  get stdout() { return process.stdout; },
  get stderr() { return process.stderr; },
  get root() { return process.env.CLAUDE_PROJECT_DIR || process.cwd(); },
};

/** The invocation in force. Never null: outside `main()` it is a live view of the process. */
export const invocation = () => CURRENT || PROCESS_CONTEXT;

/** The invocation currently INSTALLED, or `null` when none is — distinct from `invocation()`, which
 *  cannot tell "none installed" from "the process view is installed" because both ANSWER with the
 *  process view. `main()` needs that distinction: it saves this before installing its own context
 *  and puts it back when it returns, so code that runs OUTSIDE an invocation (a test importing a
 *  lib module and calling it directly) sees the process view again rather than the last invocation's
 *  temporary directory — which is exactly what it saw when an invocation was a child process. */
export const installedInvocation = () => CURRENT;

/** Enter an invocation. `main()` calls this exactly once, before anything reads a global, and puts
 *  the PREVIOUS value back when it returns (see `installedInvocation`).
 *
 *  Deliberately NOT re-entrant and deliberately not refcounted: the engine has one entry point and
 *  the assertion half runs tests in sequence, so "the current invocation" is a stack of one. What
 *  it is NOT is permanent — an in-process invocation that stayed installed after returning made
 *  every DIRECT lib call that followed read the invocation's temporary directory, where a child
 *  process had left the caller's own process view alone. */
export function setInvocation(ctx) {
  CURRENT = ctx;
  return CURRENT;
}

/** The root this invocation acts on: `CLAUDE_PROJECT_DIR` when the caller supplied it, else the
 *  invocation's working directory. `constants.mjs`'s path constants are functions of THIS by
 *  default — see `conductorDir(root = engineRoot())` and its siblings. */
export const engineRoot = (ctx = invocation()) => ctx.root;

/** The invocation's full argument list — index 0 and 1 are the program and the script, exactly as
 *  `process.argv` shapes them, so every existing `argv[2]` / `argv.slice(3)` reader is unchanged.
 *  `main()` owns a COPY: the pre-dispatch check rewrites it in place (canonicalArgv), and
 *  engine-invocation guarantees the calling process's own arguments are never modified. */
export const currentArgv = (ctx = invocation()) => ctx.argv;

/** The environment this invocation consults — `CLAUDE_PROJECT_DIR`, `PM_CACHE_ROOT`,
 *  `CLAUDE_PLUGIN_ROOT` and the four banner/session keys. Never the process's own, once `main()`
 *  has been entered: leaving env process-global would make the assertion half's roots a shared
 *  mutable, which is the hazard per-call values exist to remove. */
export const currentEnv = (ctx = invocation()) => ctx.env;

/** The working directory this invocation acts on. Distinct from `engineRoot()`: a caller may point
 *  `CLAUDE_PROJECT_DIR` at a project from anywhere, and the divergence warning exists precisely
 *  because those two can differ. */
export const currentCwd = (ctx = invocation()) => ctx.cwd;

/** The streams this invocation writes to. `die()` already goes through `errStream()`; 3.4 routes the
 *  rest, so an in-process caller receives everything on its own streams and nothing reaches the
 *  process's own stdout or stderr — engine-invocation states that as a SHALL, and it is what lets
 *  one process serve many invocations without their output interleaving. */
export const outStream = (ctx = invocation()) => ctx.stdout;
export const errStream = (ctx = invocation()) => ctx.stderr;

/** The input this invocation drains. `readStdin()` and the refused-hook-line drain both go through
 *  it, rather than reading fd 0 behind the caller's back. */
export const stdinSource = (ctx = invocation()) => ctx.stdin;

/** The git gateway this invocation is handed — the REAL one for a process that never entered
 *  through `main()`, the caller's own when it supplied `io.git` (design D4: the assertion half
 *  passes a double, the functional half the real thing, and the engine cannot tell which).
 *
 *  THIS ACCESSOR IS WHY NO MODULE IMPORTS THE GATEWAY. A module that imported it could not be given
 *  a double, and a module that reached git directly would be a call site outside the gateway —
 *  which the call-site guard fails on. Every git user therefore asks the INVOCATION for its gateway,
 *  exactly as it asks for its root, env and streams; `lib/git-gateway.mjs` itself is imported by
 *  this file and by `conductor.mjs` (which supplies the default) and by nothing else. */
export function gitOps(ctx = invocation()) {
  if (ctx.git) return ctx.git;
  // Built once PER CONTEXT and cached on it, never per call: `realGit`'s operations read the context
  // lazily, so one object serves every call. The thunk is a live view rather than a snapshot for the
  // same reason the rest of PROCESS_CONTEXT is getters — a direct importer that moves
  // CLAUDE_PROJECT_DIR between two calls must see the second one.
  if (ctx === PROCESS_CONTEXT) return (PROCESS_GIT ??= realGit(() => PROCESS_CONTEXT));
  return (ctx.__git ??= realGit(() => ctx));
}

/** Normalize whatever a caller passed as `stdin` into `{ read(), isTTY, real }`.
 *
 *  The REAL case is the CLI tail handing over `process.stdin`, and it must keep using `isatty(0)`
 *  and `fs.readFileSync(0)` rather than `process.stdin.isTTY`: touching `process.stdin` opens a
 *  stream on fd 0, and that makes the synchronous drain read NOTHING — the hook writer then sees
 *  EPIPE. That reason is recorded at the drain site in conductor.mjs and is why this lives here
 *  rather than at the drain.
 *
 *  An INJECTED source is `{ read(): string, isTTY?: boolean }` — a plain object, because a test
 *  that had to build a real Readable would be paying for the thing this change removes. */
export function normalizeStdin(s) {
  if (!s || s === process.stdin) {
    return { real: true, read: () => fs.readFileSync(0, "utf8"), get isTTY() { return isatty(0); } };
  }
  return {
    real: false,
    read: () => { try { return String(s.read() ?? ""); } catch { return ""; } },
    isTTY: !!s.isTTY,
  };
}
