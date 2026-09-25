// scripts/lib/command-exit.mjs
// THE one way the engine refuses: write the refusal, then THROW.
//
// Before this module the engine had 194 `process.exit(` sites in scripts/lib and five local `die`
// helpers that were five different spellings of the same two lines. That shape is the reason the
// suite needs a process boundary per assertion: an exit cannot be observed, only survived, so a
// test that wanted to know "does this verb refuse that command line" had to spawn a `node` and read
// its status. A thrown value can be caught, returned and asserted in-process, which is what
// engine-invocation's in-process entry point is built on.
//
// The message goes to the INVOCATION's stderr (`invocation().stderr`) and not to the process's, so
// a caller that supplied its own streams receives the refusal on them and nothing reaches the
// process's own stderr — the guarantee engine-invocation states, and the reason `main(argv, io)`
// could be called twice in one process without the two invocations' output interleaving.
//
// `die()` writes the message EXACTLY as given: every call site already carries its own
// `conductor: ` prefix and its own trailing newline, and a shared prefix here would double it on
// all of them. The five module-local helpers that spelled the prefix themselves keep their call
// sites unchanged by wrapping this function (see `conductorDie()` below).

import { invocation } from "./invocation.mjs";

/** What a refusal throws. `code` is the status the CLI must exit with — the value `main()` returns
 *  and the value `process.exitCode` is assigned, so the two can never disagree by construction.
 *
 *  Not an Error subclass with a stack worth reading: it is a CONTROL FLOW signal, not a defect, and
 *  a refusal class's message is already on stderr by the time this is thrown. Extending Error keeps
 *  it recognizable to `instanceof` checks and to a debugger. */
export class CommandExit extends Error {
  constructor(code = 1) {
    super(refusalSummary(code));
    this.name = "CommandExit";
    this.code = code;
  }
}

/** The Error message carried by a thrown refusal. It is NEVER printed — `die()` has already put the
 *  real refusal on the invocation's stderr by the time this is constructed — so the status number is
 *  the whole of it, for a stack trace someone is reading in a debugger. */
export function refusalSummary(code) {
  return `conductor: refused (exit ${code})`;
}

/** Write `message` to the current invocation's stderr and throw `CommandExit(code)`.
 *
 *  Never `process.exit()`: an in-process caller may serve many invocations, and an exit takes its
 *  whole process with it — in the assertion half, every remaining test in that file — so a missed
 *  site reads as a catastrophic failure rather than as the one refusal it is. `scripts/test/assert/no-inline-exit.test.mjs` is the guard. */
export function die(message, code = 1) {
  invocation().stderr.write(message);
  throw new CommandExit(code);
}

/** The `conductor: <msg>\n` wrapper the five module-local helpers used to define inline
 *  (`detour-stack`, `claims`, `add-many`, `releases`, `purge-logs`; `add-many` prefixes its own
 *  verb name instead). Kept as one function so those call sites stay untouched while all five
 *  collapse onto the single exit path above. */
export const conductorDie = (msg, code = 1) => die(`conductor: ${msg}\n`, code);
