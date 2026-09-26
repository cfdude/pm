// scripts/test/assert/hermetic-git.test.mjs
// 5.3's ASSERTION TWIN of scripts/test/functional/hermetic-git.test.mjs — same id, same subject.
//
// THE FUNCTIONAL FILE'S SUBJECT is `fixtures/hermetic-git.mjs`, which points fixture git at an empty
// template and a null global config so a machine's `core.abbrev`, `commit.gpgsign` or secret-scanning
// template cannot change what a fixture commit looks like. Its FIRST TWO tests create a repository
// and run git in it; its THIRD is a file-walk over `scripts/test/functional/` and spawns nothing.
//
// THE THIRD IS PORTED HERE, unchanged — it is the guard 5.7 narrowed, and a guard over the OTHER
// half reads files from either side. And the twin adds the assertion that MADE the narrowing
// necessary, which the functional file can only describe: this half's files DO contain the string
// `"git"` without importing the hermetic module, because the double's canned answers are git's
// output. Without that, the narrowing looks like a convenience.

// TEMP DIRECTORIES (gh-cfdude-pm-224). The functional file's scratch directories are scheduled for
// removal at process exit through `fixtures/temp-dir.mjs`; the rule that EVERY such site in the tree
// is scheduled or enrolled is `assert/temp-dir-cleanup.test.mjs`'s, not this file's.

import "../fixtures/assert-git-shim.mjs";  // the run-time git counter, installed in THIS process (0.49.0, D3 row 1)
import "../fixtures/hermetic-git.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));

test("every FUNCTIONAL test file that mentions git imports the hermetic module, directly or through its harness", () => {
  const HALF = path.join(TEST_DIR, "..", "functional");
  const files = fs.readdirSync(HALF).filter(f => f.endsWith(".test.mjs"));
  assert.ok(files.length > 20, `the functional half holds ${files.length} files; walking a moved or emptied directory is not a check`);
  const offenders = files.filter(f => {
    const src = fs.readFileSync(path.join(HALF, f), "utf8");
    return /["']git["']/.test(src) && !/functional-harness\.mjs|helpers\.mjs|hermetic-git\.mjs/.test(src);
  });
  assert.deepEqual(offenders, [],
    `these spawn git without the hermetic module — import the functional harness (or ` +
    `./hermetic-git.mjs) first: ${offenders.join(", ")}`);
});

test("5.7's narrowing is safe, because the property it gave up is enforced more strongly here", () => {
  // The pre-5.7 predicate refused any file under scripts/test/ that holds the quoted string "git"
  // without importing the hermetic module. Read honestly: NO assertion-half file matches that
  // pattern today, so the narrowing is not repairing a live false positive — it stops the guard
  // from firing on the design the moment one of these files quotes the string (the fake's canned
  // answers ARE git's output, and this half is full of comments about it).
  //
  // What makes the narrowing safe anyway is that the property is not lost: the assert half cannot
  // spawn AT ALL (assert-half-has-no-spawn.test.mjs), so "imports the hermetic module before
  // running git" is vacuous on this side — git is never run here to be made hermetic.
  const files = fs.readdirSync(TEST_DIR).filter(f => f.endsWith(".test.mjs"));
  const quotingGitUnhermetically = files.filter(f => {
    const src = fs.readFileSync(path.join(TEST_DIR, f), "utf8");
    return /["']git["']/.test(src) && !/hermetic-git\.mjs/.test(src);
  });
  const mentioningGit = files.filter(f => /\bgit\b/.test(fs.readFileSync(path.join(TEST_DIR, f), "utf8")));
  assert.ok(mentioningGit.length > 5,
    `expected this half to be full of files that mention git — found ${mentioningGit.length}`);
  assert.deepEqual(quotingGitUnhermetically, [],
    "if this stops being empty the old predicate WOULD have fired here, and the narrowing is then " +
    "not merely prophylactic: it is what keeps this half from being refused for mentioning the " +
    "thing its double stands in for");
});

// ───────────────────────── the deliberate omissions ─────────────────────────
//
// The two fixture tests — "a fixture git init copies no hooks" and "a fixture commit is not signed"
// — exist to prove the hermetic module WORKS, and each does it by creating a repository and running
// git in it, which this half cannot do (design D5). They stay in the functional half, where the
// fixtures and the module are actually used.
