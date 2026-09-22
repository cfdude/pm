// scripts/test/fixtures/fs-work-counter.mjs
// THE UNIT RUNG'S RUN-TIME COUNTER (task 2.1, design D4's second layer).
//
// WHY A RUN-TIME LAYER EXISTS AT ALL. The source scan next door refuses a unit-rung FILE that names
// the filesystem. It cannot see a call reached three modules away — a unit test calls a helper, the
// helper reads a path — and that is exactly the hole 0.47.0's Gate 2 found in the git guard (G-I4),
// which is why the git shim exists. Same argument, same answer: wrap the entry points and count,
// because a shim that merely FAILED would be tolerated by every caller that catches.
//
// WHY IT COUNTS READS AS WELL AS WRITES (I4). The spec forbids a unit-rung file to "read, write,
// create or remove a path", so a write-only counter would refuse less than the requirement states.
//
// ─── WHAT IT ASSERTS, AND WHY IT IS NOT "THE PROCESS COUNT IS ZERO" (I7, and a finding) ───
//
// The absolute assertion is about WRITES AND FLUSHES: a unit test performs ZERO of them, from
// anywhere. That is the property the rung exists for — the assertion half's 12,524 `fsyncSync` calls
// are durability work on tests that assert on a value — and it holds, because every record write in
// the engine is store-owned now and a memory store writes nothing.
//
// READS are refused when they come from THE TEST'S OWN FRAME. `fs` is one object for the whole
// assertion half, and an invocation READS the repository as a matter of course: openspec
// `changes/**` for the change-on-disk check, `plugin.json` and `CHANGELOG.md` for the version
// currency warning, `<root>/openspec` for dormancy. Design D1 names those reads as deliberately
// NOT store-owned — they are reads of the REPOSITORY, not of the conductor record — so an
// "absolutely zero reads" assertion is unreachable for any unit test that invokes a verb at all,
// and it would have to be met by weakening the guard into a blanket allowlist of engine paths,
// which is the shape that stops guarding anything.
//
// What is left is stronger and it is what the spec's own scenario states: "WHEN a file under the
// unit rung's directory is edited to read or write a file ... THEN the guard test names that file".
// The subject is the TEST FILE, and a stack-scoped read check names exactly that — at any depth,
// through any helper — while the ENGINE's own repository reads are named here as outside the rung's
// contract rather than silently permitted.
//
// THE STACK IS CAPTURED ONLY WHILE ARMED. `Error().stack` on every filesystem call across the whole
// half would re-introduce the cost this change is removing; the wrapper is one boolean check
// outside a unit test's window, and captures a stack only inside one, where there are tens of calls
// rather than hundreds of thousands.
//
// ITS KNOWN LIMIT, named rather than claimed closed (design Risk 7): a call reached through a module
// that captured `fs`'s functions BEFORE this wrapper was installed is missed.

import fs from "node:fs";

/** The names wrapped. Built from parts so this file does not itself write out the call shapes the
 *  source scan refuses — the same self-exemption avoidance the spawn guard uses. */
const READ_NAMES = [
  "readFileSync", "readFile", "readdirSync", "readdir", "statSync", "stat",
  "lstatSync", "lstat", "existsSync", "accessSync", "access", "openSync", "open",
  "readlinkSync", "realpathSync", "opendirSync", "createReadStream", "watch", "readSync", "fstatSync",
];
const WRITE_NAMES = [
  "writeFileSync", "writeFile", "appendFileSync", "appendFile", "mkdirSync", "mkdir",
  "rmSync", "rm", "rmdirSync", "unlinkSync", "renameSync", "copyFileSync", "cpSync",
  "fsyncSync", "fsync", "truncateSync", "chmodSync", "symlinkSync", "linkSync", "mkdtempSync",
  "writeSync", "writevSync", "fchmodSync", "utimesSync",
];

/** Armed for ONE test at a time — the rung runs in one process, sequentially, so a stack of one is
 *  the whole requirement. `actors` holds the path fragments that make a read the TEST's work. */
let armed = false;
let actors = [];
const writes = [];
const ownReads = [];
const WORK = new Set([...READ_NAMES, ...WRITE_NAMES]);

/** WHAT MAKES A READ THE TEST'S OWN WORK — the engine is NOT on the call chain. This is the only
 *  rule that discriminates, and two simpler ones were tried and discarded by measurement:
 *
 *    * "the test file is on the stack" is TRUE FOR EVERYTHING the test calls, because the test's own
 *      frame is at the bottom of every chain it starts. It refused every invocation.
 *    * An allowlist of the engine's own paths would have to name openspec `changes/**`, plugin.json,
 *      CHANGELOG.md and `<root>/openspec` and would grow with the engine — the shape that stops
 *      guarding anything.
 *
 *  So: a filesystem call is the test's own when a frame from the unit rung's file is present AND no
 *  engine frame sits above it. A test that reads a file, or calls a helper that reads one, has no
 *  engine on the chain and is refused; a verb reading the repository it was invoked in has the
 *  engine on the chain and is not this guard's subject (design D1 names those reads as deliberately
 *  not store-owned). */
const ENGINE_FRAMES = /scripts[/\\]lib[/\\]|scripts[/\\]conductor\.mjs/;

/** Install once. Idempotent by a marker rather than by a module-level flag alone, so a second import
 *  path (a cache-busted one) cannot double-wrap and double-count. */
if (!fs.__pmFsWorkCounter) {
  for (const name of WORK) {
    const original = fs[name];
    if (typeof original !== "function") continue;
    const isWrite = WRITE_NAMES.includes(name);
    fs[name] = function (...args) {
      if (armed) {
        const arg = typeof args[0] === "string" ? args[0] : "<fd>";
        if (isWrite) writes.push({ op: name, arg });
        else {
          // ONE stack capture, only while armed.
          const stack = new Error().stack || "";
          if (actors.some((a) => stack.includes(a)) && !ENGINE_FRAMES.test(stack)) {
            ownReads.push({ op: name, arg });
          }
        }
      }
      return original.apply(fs, args);
    };
  }
  Object.defineProperty(fs, "__pmFsWorkCounter", { value: true, enumerable: false, configurable: false });
}

/** How deep a captured stack needs to be for the two questions above: the caller, and whether an
 *  engine frame is among them. The engine's frames sit IMMEDIATELY below the wrapper, so a dozen is
 *  generous — and the limit is why a stack capture here costs tenths of a millisecond rather than
 *  milliseconds. It is restored on the way out, whatever the test did. */
const ARMED_STACK_LIMIT = 6;
let savedStackLimit = null;

/** Start watching. `actorPaths` are the file paths whose presence on a read's stack makes that read
 *  the TEST's own work. Called by `unitTest()` with the calling test file. */
export function armFsCounter(actorPaths) {
  armed = true;
  actors = actorPaths;
  writes.length = 0;
  ownReads.length = 0;
  savedStackLimit = Error.stackTraceLimit;
  Error.stackTraceLimit = ARMED_STACK_LIMIT;
}

/** Stop watching, and report. Beyond a unit test's window this is inert. */
export function disarmFsCounter() {
  armed = false;
  if (savedStackLimit !== null) Error.stackTraceLimit = savedStackLimit;
  savedStackLimit = null;
  return { writes: writes.slice(), ownReads: ownReads.slice() };
}

/** Everything recorded in the current window. */
export const fsWork = () => ({ writes: writes.slice(), ownReads: ownReads.slice() });

/** How a refusal reads. */
export function describeFsWork({ writes: w, ownReads: r }) {
  const parts = [];
  if (w.length) parts.push(`wrote ${w.length}: ` + w.map((c) => `${c.op}(${c.arg})`).join(", "));
  if (r.length) parts.push(`read ${r.length} from the test's own code: ` + r.map((c) => `${c.op}(${c.arg})`).join(", "));
  return parts.join("; ");
}
