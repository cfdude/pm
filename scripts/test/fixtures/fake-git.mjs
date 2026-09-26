// scripts/test/fixtures/fake-git.mjs
// THE ASSERTION HALF'S GIT DOUBLE — the object `main(argv, io)` is handed as `io.git` in place of
// scripts/lib/git-gateway.mjs's real one (4.3 of functional-assertion-test-split, design D4/D5).
//
// IT ANSWERS FROM A FROZEN CAPTURE, never from the machine's git. That is the point of a double: a
// fake that consulted the real repository at test time would make the assertion half depend on git,
// on a repository, and on the machine's git version, which is exactly what the half exists to be free
// of. `fixtures/git-gateway-capture.json` is committed, one entry per gateway operation, each saying
// when it would be legitimate to refresh it, and TASK 4.4 proves those answers byte-identical to the
// real git's for the same invocations — so a capture that went stale fails loudly rather than quietly
// answering the fast half with a fiction.
//
// IT KEYS ON THE ARGUMENTS, deeply and exactly. Two invocations of one operation with different
// arguments are different questions (`headRef` about an attached tree and about a detached one; three
// arg lists through commit-watch's one plumbing operation), so a match by operation alone would answer
// the wrong one silently. A call the capture does NOT hold throws, naming the operation and the
// arguments: in a fake, a plausible default answer is the failure mode that makes a whole suite pass
// against a made-up repository.
//
// ARGUMENT MATCHING IS TOKEN-AWARE, for the same reason the capture is: a root is a fresh temporary
// directory, so a call arrives carrying a real path while the capture holds the token. The fake
// substitutes the roots it was BUILT with before matching — the one normalization the capture states.

import fs from "node:fs";
import { CAPTURE_PATH, rootToToken } from "./git-gateway-repo.mjs";
import { GIT_OPERATIONS } from "../../lib/git-gateway.mjs";

/** The capture as committed. Read ONCE, AT MODULE LOAD, and it is the one thing this change moved
 *  here for a measurement rather than for tidiness: the fake used to read the file lazily on its
 *  first call, which put a `readFileSync` of a fixture INSIDE the first invocation of every
 *  in-process test — including a unit-rung test's, where 0.48.0's run-time counter is watching (task
 *  2.1). The read is the HARNESS's, not the engine's and not the test's, so the honest fix is to take
 *  it out of every window rather than to teach the counter to excuse it. `loadCapture()` still
 *  returns a fresh parse for a caller that wants one. */
const CAPTURE = JSON.parse(fs.readFileSync(CAPTURE_PATH, "utf8"));
export function loadCapture() {
  return JSON.parse(JSON.stringify(CAPTURE));
}

/** A stable key for an argument list, so matching is exact rather than approximate. JSON's own
 *  encoding is enough: every argument here is a string, a number, an array or a boolean. */
const keyOf = (args) => JSON.stringify(args);

/** THE OTHER WORLD: the invocation's root is NOT a repository.
 *
 *  The assertion half runs every invocation against a fresh temporary directory with no `git init`
 *  anywhere above it (design D5 sends a test that needs a real repository to the functional half), so
 *  the double has to answer what git answers THERE, and the frozen `noRepository` section of the
 *  capture holds exactly that — one answer per operation, taken against a real non-repository
 *  directory and checked byte-for-byte by 4.4 against the live git.
 *
 *  IT ANSWERS PER OPERATION AND IGNORES THE ARGUMENTS, which the arg-keyed mode below deliberately
 *  does not, and the difference is not a loophole. In a non-repository git fails before it reads its
 *  arguments, so the answer genuinely does not depend on them; this is the one place where "the same
 *  answer whatever you asked" is git's behaviour rather than a convenience. What it must never do is
 *  answer a SUCCESS: a test whose subject needs git to succeed belongs in the functional half, and
 *  gets a loud 128 here rather than a plausible value. */
function noRepositoryGateway(capture) {
  const section = capture.noRepository;
  const gateway = {};
  for (const { name } of GIT_OPERATIONS) {
    const c = section[name];
    if (!c) throw new Error(`fake git: the capture holds no no-repository answer for ${name}`);
    gateway[name] = () => {
      if (c.status !== 0) {
        const err = new Error(c.stderr || `git exited ${c.status}`);
        err.status = c.status;
        err.stderr = c.stderr || "";
        throw err;
      }
      return c.value === null ? undefined : c.value;
    };
  }
  return gateway;
}

/** The double. `roots` is the list `rootToToken` wants — `[{root, token}, …]` — and may be empty for
 *  a test that only needs operations with no path in their arguments; a call carrying a real root then
 *  simply will not match, which is the loud failure rather than the quiet one.
 *
 *  `noRepository: true` selects the OTHER world instead — see `noRepositoryGateway()`. The assertion
 *  half uses it for every invocation whose root is a plain temporary directory. */
export function fakeGit({ capture = loadCapture(), roots = [], noRepository = false } = {}) {
  if (noRepository) return noRepositoryGateway(capture);

  const answers = new Map();
  for (const [op, entry] of Object.entries(capture.operations)) {
    for (const c of entry.cases) {
      const k = `${op} ${keyOf(c.args)}`;
      // A duplicate key would be two answers to one question; the capture's own test asserts the
      // operations are distinct, and this catches the case-level version of the same mistake.
      if (answers.has(k)) throw new Error(`fake git: the capture holds two answers for ${op} ${keyOf(c.args)}`);
      answers.set(k, c);
    }
  }

  const gateway = {};
  for (const { name } of GIT_OPERATIONS) {
    gateway[name] = (...args) => {
      const tokenized = rootToToken(args, roots);
      const c = answers.get(`${name} ${keyOf(tokenized)}`);
      if (!c) {
        throw new Error(
          `fake git: no captured answer for ${name}(${tokenized.map(a => JSON.stringify(a)).join(", ")}). ` +
          "Add the invocation to casesFor() in fixtures/git-gateway-repo.mjs, refresh the capture, and " +
          "let 4.4's check prove it against the real git first — inventing an answer here would make " +
          "the assertion half pass against a repository that does not exist"
        );
      }
      if (c.status !== 0) {
        // The real operations THROW on a non-zero status and several callers read the status as data
        // (`isAncestor` tells 1 from everything else), so the double must throw too — an `undefined`
        // return here would turn "git said no" into "git could not be asked".
        const err = new Error(c.stderr || `git exited ${c.status}`);
        err.status = c.status;
        err.stderr = c.stderr || "";
        throw err;
      }
      // A byte-valued answer (`encoding: "base64"`) is handed back as the Buffer it was captured as,
      // because its caller parses by byte offset and a string would never exercise that parse.
      if (c.encoding === "base64") return Buffer.from(c.value, "base64");
      return c.value === null ? undefined : c.value;
    };
  }
  return gateway;
}
