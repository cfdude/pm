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

/** The capture as committed. Read once — it is not the thing under test and nothing mutates it. */
export function loadCapture() {
  return JSON.parse(fs.readFileSync(CAPTURE_PATH, "utf8"));
}

/** A stable key for an argument list, so matching is exact rather than approximate. JSON's own
 *  encoding is enough: every argument here is a string, a number, an array or a boolean. */
const keyOf = (args) => JSON.stringify(args);

/** The double. `roots` is the list `rootToToken` wants — `[{root, token}, …]` — and may be empty for
 *  a test that only needs operations with no path in their arguments; a call carrying a real root then
 *  simply will not match, which is the loud failure rather than the quiet one. */
export function fakeGit({ capture = loadCapture(), roots = [] } = {}) {
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
      return c.value === null ? undefined : c.value;
    };
  }
  return gateway;
}
