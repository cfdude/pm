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
// behaviour, while a caller that does enter through `main()` is handed a frozen snapshot for the
// duration of that one call. `setInvocation()` is called once per invocation and never
// concurrently: the assertion half is a SINGLE process running tests in sequence.
//
// `root` is deliberately a value and not a getter even in the process context: read once, the way
// `constants.mjs` read it once, so the CLI's own semantics are unchanged.

let CURRENT = null;

/** The context used when nothing has called `setInvocation()`: the real process. Live getters, so
 *  a direct importer of a lib module keeps the behaviour it had before this module existed. */
const PROCESS_CONTEXT = {
  get cwd() { return process.cwd(); },
  get env() { return process.env; },
  get argv() { return process.argv; },
  get stdin() { return process.stdin; },
  get stdout() { return process.stdout; },
  get stderr() { return process.stderr; },
  get root() { return process.env.CLAUDE_PROJECT_DIR || process.cwd(); },
};

/** The invocation in force. Never null: outside `main()` it is a live view of the process. */
export const invocation = () => CURRENT || PROCESS_CONTEXT;

/** Enter an invocation. `main()` calls this exactly once, before anything reads a global.
 *
 *  Deliberately NOT re-entrant and deliberately not refcounted: the engine has one entry point and
 *  the assertion half runs tests in sequence, so "the current invocation" is a stack of one. */
export function setInvocation(ctx) {
  CURRENT = ctx;
  return CURRENT;
}

/** The root this invocation acts on: `CLAUDE_PROJECT_DIR` when the caller supplied it, else the
 *  invocation's working directory. The eleven path constants in `constants.mjs` are functions of
 *  THIS by default — see `conductorDir(root = root())` and its siblings. */
export const root = (ctx = invocation()) => ctx.root;
