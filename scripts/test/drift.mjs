// scripts/test/drift.mjs
// THE DRIFT SCRIPT (design D8, tasks 5.4 / 6.1 / 6.4 / 7.2). Dev-only, plain Node, no dependency,
// living in the test tree so it is not part of what the plugin ships (8.4).
//
// WHAT IT IS. The two halves of this suite run on different triggers. The functional half may not run
// for months, so the links that keep it honest are checked on EVERY commit, by a script that
//   * reads files,
//   * reads the git INDEX (tracked set, staged set, staged blobs, the common dir), and
//   * DOES NOT run the functional half, does not start an engine process, and does not create a git
//     fixture. The check runs BEFORE the suite in `.githooks/pre-commit`, so a check that demanded a
//     record its own later step would write refuses one step too early to ever be satisfied — and a
//     check that ran the functional half would make every commit as slow as the thing the trigger
//     exists to keep out of the way (suite-certification, "The pre-commit gate checks the record
//     without running the functional half").
//
// THE FOUR CHECKS, and there are exactly four (D8). Every refusing message NAMES the module, id or
// file at fault:
//   1. enrolment      — every tracked test file has exactly one home (D5)
//   2. twin coverage  — every functional id has an assertion file of the same id (D6, ONE direction)
//   3. diff coupling  — a staged change to a functional file carries its twin in the same diff (D6)
//   4. freshness      — a certified module whose STAGED content differs from the record's
//                       `contentHash` is refused, and the refusal names the run that satisfies it
//                       (D7); plus 7.2's dangling ids, so a renamed module or a deleted functional
//                       test cannot leave a record pointing at something that no longer exists
//
// THERE IS NO CONVERSE OF CHECK 2, deliberately (D6): an assertion-half file with no functional twin
// is the normal shape for a test whose subject is not git's behaviour.
//
// THE FLOOR IS NOT HERE. The hook's test-count floor (`declared` from the tracked files of the half
// the runner was handed) stays in `.githooks/pre-commit`, because the runner's count is only known
// there. This script supplies check 1, which the hook carried inline from 5.3 until 6.4.

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  REPO, ENGINE_SOURCE, certifiedSet, conformanceRows, couplingRefusals, describeRefusal,
  enrolmentRefusals, functionalIds, assertionIds, homeOf, homesInProse, readRecord, recordRefusals, sweepIds, twinRefusals, twinPathsOf,
} from "./certification.mjs";

// ───────────────────────────── the index reads ─────────────────────────────

/** THE ONLY SPawn IN THIS FILE, and the only subcommands it may ask for. Every git call the drift
 *  script makes is an INDEX READ: what is tracked, what is staged, what the staged bytes are, and
 *  where the common directory is. There is no `git commit`, no `git init`, no fixture, no engine
 *  process and no test runner anywhere in the script — the check runs BEFORE the suite in the hook,
 *  so it may not be able to start the thing whose result it is checking (D8). A subcommand outside
 *  this set throws rather than running, so the property is enforced where the call is made and not
 *  only asserted about the source. */
export const PERMITTED_SUBCOMMANDS = ["ls-files", "diff", "show", "rev-parse"];

export function gitRead(root, args) {
  const sub = args.find((a) => !a.startsWith("-"));
  if (!PERMITTED_SUBCOMMANDS.includes(sub)) {
    throw new Error(`drift: '${sub}' is not an index read — this script checks files, it does not drive git`);
  }
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

export function trackedTestFiles(root) {
  // BOTH ARMS, AND THE REASON IS GIT'S — corrected at Gate 2 (G-M3), because the first version of
  // this comment had it backwards and the code is only as safe as the reason it is kept for.
  //
  // Measured on git 2.55.0, in a scratch repository holding one top-level test file and three under
  // `assert/` (one of them two levels down):
  //   `ls-files 'scripts/test/*.test.mjs'`   → ALL FOUR. A git pathspec's `*` matches `/`, so this
  //                                            arm reaches nested files as well as top-level ones.
  //   `ls-files 'scripts/test/**/*.test.mjs'` → THREE — it MISSES the top-level file, because `**`
  //                                            does not match zero directories.
  // So the claim this comment used to make ("the nested arm is the only one that reaches a file one
  // level down") is wrong in the direction that matters: the single-star arm is the load-bearing one
  // and the `**` arm is the one that under-counts. The previous text asserted the opposite and
  // justified the pair by an under-count that does not happen.
  //
  // The pair is kept anyway, and this is the honest reason: `*`-matches-`/` is a pathspec rule that
  // is easy to re-read the other way (this comment did), so the enumeration names both spellings and
  // is then correct under either reading rather than correct by an argument. It is also what the
  // drift script's own tests exercise, and an enumeration that is what check 1 refuses over (D5)
  // should not depend on one subtle rule being remembered.
  return gitRead(root, ["ls-files", "scripts/test/*.test.mjs", "scripts/test/**/*.test.mjs"])
    .split("\n").filter(Boolean).sort();
}

/** The staged set. `--no-renames` is REQUIRED, not a preference: with rename detection on, a move
 *  reports only the NEW path and the pairing check would see one half of a rename and refuse a
 *  legitimate move. With it off, a rename reports as a delete plus an add, so both paths are present
 *  and check 3 passes on it — exactly the behaviour D6 states. */
export function stagedFiles(root) {
  return gitRead(root, ["diff", "--cached", "--name-only", "--no-renames"]).split("\n").filter(Boolean).sort();
}

/** The STAGED bytes of a path (`git show :<path>`), or null when the index does not hold it — a
 *  deletion, or a path the caller asked about that was never staged. A null is a refusal, not a
 *  pass: the content cannot be shown to be the content the record describes. */
function stagedReader(root) {
  return (rel) => {
    try {
      return gitRead(root, ["show", `:${rel}`]);
    } catch {
      return null;
    }
  };
}

/** THE INDEX AS A FILESYSTEM — `readdir` and `readFile` over what is STAGED, in the shape the
 *  certification functions already accept (0.50.0, found at branch review). Until then every SET drift
 *  judges — the certified engine modules, the engine-source files, the functional/assertion/sweep ids,
 *  the conformance rows — came from `fs` reads of the working tree, so a module staged into
 *  scripts/lib/ that calls the gateway and was then deleted from disk was invisible: drift exited 0
 *  and an uncertified engine module could be committed. Drift judges a commit, so it reads the commit.
 *
 *  Both take ABSOLUTE paths under `root`, as the fs defaults do. A directory the index holds nothing
 *  under reads as EMPTY (the fs default would throw ENOENT for a missing one, and `testIdsIn` already
 *  treats that as empty; `certifiedModules` needs `scripts/lib/` to read as empty in a tree that
 *  stages none). A file the index does not hold reads as "" — it is not in the commit, so it calls no
 *  gateway and carries no ROWS table, which is exactly how an absent file must be judged.
 *  One `ls-files` for the listing; one `show :<path>` per file actually read. */
export function indexReaders(root) {
  const staged = gitRead(root, ["ls-files", "-z"]).split("\0").filter(Boolean);
  const inIndex = new Set(staged);
  const rel = (abs) => path.relative(root, abs).split(path.sep).join("/");
  const readdir = (abs) => {
    const prefix = rel(abs) ? `${rel(abs)}/` : "";
    const names = new Set();
    for (const f of staged) if (f.startsWith(prefix)) names.add(f.slice(prefix.length).split("/")[0]);
    return [...names].sort();
  };
  const readFile = (abs) => (inIndex.has(rel(abs)) ? gitRead(root, ["show", `:${rel(abs)}`]) : "");
  return { readdir, readFile };
}

// ───────────────────────────── the checks ─────────────────────────────

/** All four, as data. `set`/`record`/`conformanceRowsNow` are gathered here and checked in
 *  certification.mjs, so the checks themselves are pure and can be exercised by the assertion half. */
export function checkAll(root = REPO) {
  const tracked = trackedTestFiles(root);
  const staged = stagedFiles(root);
  // EVERY SET BELOW IS READ FROM THE INDEX (0.50.0) — see indexReaders(). The record is the one
  // thing still read from disk: it lives in the git common dir and is not part of any commit.
  const { readdir, readFile } = indexReaders(root);
  const functional = functionalIds(root, readdir);
  const assertion = assertionIds(root, readdir);
  const set = certifiedSet(root, readFile, readdir);
  const gitCommonDir = path.resolve(root, gitRead(root, ["rev-parse", "--git-common-dir"]).trim());
  const record = readRecord(gitCommonDir, (p) => fs.readFileSync(p, "utf8"));
  const readStaged = stagedReader(root);

  const result = {
    enrolment: enrolmentRefusals(tracked),
    twins: twinRefusals({ functional, assertion }),
    coupling: couplingRefusals({ stagedFiles: staged, functional, assertion }),
    record: recordRefusals({
      stagedFiles: staged,
      record,
      set,
      hashStaged: (files) => {
        // The staged bytes of every file in the set, hashed the way `certification.contentHash` does.
        // A null anywhere means the content cannot be shown fresh, which is a refusal rather than a
        // pass — the loud direction.
        const h = crypto.createHash("sha256");
        for (const f of [...files].sort()) {
          const bytes = readStaged(f);
          if (bytes === null) return null;
          h.update(f).update("\0").update(bytes).update("\0");
        }
        return h.digest("hex");
      },
      // Every id a covers entry may legitimately name: the functional half AND the sweep bucket.
      liveIds: [...functional, ...sweepIds(root, readdir)],
      conformanceRowsNow: (() => {
        try { return conformanceRows(root, readFile); } catch { return null; }
      })(),
    }),
  };
  return { result, tracked, staged, functional, assertion };
}

// ───────────────────────────── the CLI tail ─────────────────────────────

function render(refusals) {
  const lines = [];
  if (refusals.enrolment.length) {
    lines.push("these tracked test files are in neither half and in no bucket:");
    for (const f of refusals.enrolment) lines.push(`  ${f} — a test file with no home is run by nothing and counted by nothing`);
    // DERIVED FROM homeOf'S OWN ALTERNATIVES, never typed (task 2.2's I5). Written out by hand, this
    // line named three homes and would have gone on naming three after the unit rung became the
    // fourth — a refusal that tells the reader to move the file somewhere that is about to stop
    // being the whole set.
    lines.push(`move it under ${homesInProse()} — or enrol it deliberately.`);
  }
  if (refusals.twins.length) {
    // DERIVED FROM THE SAME LIST THE CHECK USES (task 5.1(c)): the twin may live on EITHER rung of
    // the assertion half, and a refusal naming one of them would send a reader to a file that is not
    // where the rule looks.
    lines.push(`these functional ids have no assertion twin (${twinPathsOf("<id>").join(" or ")}):`);
    for (const id of refusals.twins) lines.push(`  ${id}`);
  }
  if (refusals.coupling.length) {
    lines.push("these functional files are staged without their assertion twin in the same diff:");
    for (const c of refusals.coupling) lines.push(`  ${c.id} — ${c.functional} is staged, ${c.assertion} is not`);
  }
  for (const r of refusals.record) lines.push(describeRefusal(r));
  return lines;
}

// REALPATHS ON BOTH SIDES (0.50.0): Node resolves the main module to its REAL path, so a script run
// through a symlinked directory — macOS $TMPDIR is /var/… -> /private/var/…, where the pre-commit hook
// now runs drift from its index snapshot — compared unequal, did nothing, and exited 0.
const invokedDirectly = (() => {
  try { return fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }  // no argv[1], or one that is not a file: imported, not run
})();
if (invokedDirectly) {
  let root = REPO;
  const i = process.argv.indexOf("--root");
  if (i !== -1 && process.argv[i + 1]) root = path.resolve(process.argv[i + 1]);
  let payload;
  try {
    payload = checkAll(root);
  } catch (e) {
    process.stderr.write(`drift: could not run the checks — ${e && e.message}\n`);
    process.exit(1);
  }
  const lines = render(payload.result);
  if (lines.length) {
    process.stderr.write("drift: ABORT — the suite's two halves have drifted apart\n\n");
    for (const l of lines) process.stderr.write(`${l}\n`);
    process.stderr.write("\ndrift: the checks are enrolment, twin coverage, diff coupling and record freshness.\n");
    process.stderr.write("drift: `node scripts/test/certify.mjs functional|sweeps` produces the record a freshness refusal names.\n");
    process.exit(1);
  }
  process.stdout.write(
    `drift: ok — ${payload.tracked.length} tracked test files, ${payload.functional.length} functional ids, ` +
    `${payload.staged.length} staged paths\n`,
  );
}

export { homeOf };
