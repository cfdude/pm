// scripts/test/drift.mjs
// THE DRIFT SCRIPT (design D8, tasks 5.4 / 6.1 / 6.4 / 7.2). Dev-only, plain Node, no dependency,
// living in the test tree so it is not part of what the plugin ships (8.4).
//
// WHAT IT IS. The two halves of this suite run on different triggers. The functional half may not run
// for months, so the links that keep it honest are checked on EVERY commit, by a script that
//   * reads files,
//   * reads the git INDEX (tracked set, staged set, staged blobs, the common dir), and
//   * DOES NOT run the functional half, does not start an engine process, and does not create a git
//     fixture. The pre-commit phase runs BEFORE the suite in `.githooks/pre-commit`, so a check that demanded a
//     record its own later step would write refuses one step too early to ever be satisfied — and a
//     check that ran the functional half would make every commit as slow as the thing the trigger
//     exists to keep out of the way (suite-certification, "The pre-commit gate checks the record
//     without running the functional half").
//
// THE FOUR CHECKS, and there are exactly four (D8). Every refusing message NAMES the module, id or
// file at fault:
//   1. enrolment      — every tracked test file has exactly one home (D5)
//   2. twin coverage  — every functional id has an assertion file of the same id (D6, ONE direction)
//   3. diff coupling  — a staged change to a functional file carries its twin in the same diff (D6),
//                       unless the commit message declares `Twin-Unchanged: <id> — <reason>`, a git
//                       trailer (certification-record-redesign D4). It is the ONE check that reads the
//                       message, so it runs in the commit-msg hook (`--phase commit-msg`) and in no other
//                       hook; a merge commit (MERGE_HEAD present) is not judged by it
//   4. freshness      — a staged change to a bucket's subject (an addition, an edit, a mode change or
//                       a deletion) demands that bucket, and the commit is fresh only when ONE passing
//                       entry's manifest equals the manifest of the bucket's WHOLE subject in this
//                       index (certification-record-redesign D1); the refusal names the bucket, the
//                       staged subject paths and the run that satisfies it
//
// THE PHASES (D4, `phaseChecks()`): `--phase pre-commit` runs checks 1, 2 and 4; `--phase commit-msg
// --message <file>` runs check 3 with that message's declarations; NO phase runs all four, check 3 with
// the declarations of `--message <file>` when one is given and none otherwise — so a developer's bare
// run never reports fewer refusals than the two hooks together.
//
// THERE IS NO CONVERSE OF CHECK 2, deliberately (D6): an assertion-half file with no functional twin
// is the normal shape for a test whose subject is not git's behaviour.
//
// THE FLOOR IS NOT HERE. The hook's test-count floor (`declared` from the tracked files of the half
// the runner was handed) stays in `.githooks/pre-commit`, because the runner's count is only known
// there. This script supplies check 1, which the hook carried inline from 5.3 until 6.4.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUCKETS, REPO, bucketSubject, couplingRefusals, describeRefusal, enrolmentRefusals, freshnessRefusal,
  functionalIds, assertionIds, homeOf, homesInProse, manifestKey, manifestOf, parseStagedEntries, parseTwinExemptions,
  phaseChecks, twinRefusals, twinPathsOf,
} from "./certification.mjs";

// ───────────────────────────── the index reads ─────────────────────────────

/** THE ONLY SPawn IN THIS FILE, and the only subcommands it may ask for. Every git call the drift
 *  script makes is a READ: what is tracked, what is staged, the staged bytes and their modes and blob
 *  ids, HEAD's tree (`ls-tree`, to judge a staged deletion — certification-record-redesign D1), where
 *  the common directory and the per-worktree git paths are (`rev-parse`, MERGE_HEAD through
 *  `--git-path`), and git's own parse of the commit message's trailers (`interpret-trailers`, D4 — so
 *  git, not this script, decides what is a trailer). There is no `git commit`, no `git init`, no fixture, no engine
 *  process and no test runner anywhere in the script — the check runs BEFORE the suite in the hook,
 *  so it may not be able to start the thing whose result it is checking (D8). A subcommand outside
 *  this set throws rather than running, so the property is enforced where the call is made and not
 *  only asserted about the source. */
export const PERMITTED_SUBCOMMANDS = ["ls-files", "diff", "show", "rev-parse", "ls-tree", "interpret-trailers"];

/** One git read. `indexFile`, when given, is the index this read is about: it is handed to git as
 *  `GIT_INDEX_FILE`, which is the ONE place this file names that variable (Gate 1 round 5, X1). It
 *  must be ABSOLUTE — `-C root` re-anchors a relative one — and a relative one is refused. Without
 *  it the read inherits the process's index, which is the index the pre-commit hook hands drift. */
export function gitRead(root, args, { indexFile } = {}) {
  const sub = args.find((a) => !a.startsWith("-"));
  if (!PERMITTED_SUBCOMMANDS.includes(sub)) {
    throw new Error(`drift: '${sub}' is not an index read — this script checks files, it does not drive git`);
  }
  if (indexFile !== undefined && !path.isAbsolute(indexFile)) {
    throw new Error(`drift: indexFile must be an absolute path (got ${JSON.stringify(indexFile)}) — \`-C ${root}\` would re-anchor a relative one`);
  }
  const env = indexFile === undefined ? process.env : { ...process.env, GIT_INDEX_FILE: indexFile };
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env });
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
  //
  // NUL-DELIMITED (Gate 2 G1): without `-z` git C-quotes a name holding a non-ASCII byte, a quote, a
  // tab or a newline, and a line-split listing then names a path that does not exist — enrolment
  // refused a correctly homed non-ASCII test as homeless.
  return gitRead(root, ["ls-files", "-z", "scripts/test/*.test.mjs", "scripts/test/**/*.test.mjs"])
    .split("\0").filter(Boolean).sort();
}

/** The staged set, NUL-delimited (`-z`, Gate 2 G1): a C-quoted name matched no subject path, so a
 *  staged non-ASCII engine module demanded nothing and a non-ASCII functional file escaped coupling.
 *  `--no-renames` is REQUIRED, not a preference: with rename detection on, a move
 *  reports only the NEW path and the pairing check would see one half of a rename and refuse a
 *  legitimate move. With it off, a rename reports as a delete plus an add, so both paths are present
 *  and check 3 passes on it — exactly the behaviour D6 states. */
export function stagedFiles(root) {
  return gitRead(root, ["diff", "--cached", "--name-only", "-z", "--no-renames"]).split("\0").filter(Boolean).sort();
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
 *  treats that as empty; `engineSourceFiles` needs `scripts/lib/` to read as empty in a tree that
 *  stages none). A file the index does not hold reads as "" — it is not in the commit, so it imports,
 *  executes and names nothing, which is exactly how the observed subject (`functionalSubject()`) must
 *  judge an absent file.
 *  One `ls-files` for the listing; one `show :<path>` per file actually read. `paths` is the listing.
 *
 *  `indexFile` (certification-record-redesign 2.4, X1) reaches BOTH reads — the listing AND every
 *  `show :<path>` — so the subject a caller derives from these readers is one index's, never one
 *  index's listing judged by another index's bytes. */
export function indexReaders(root, { indexFile } = {}) {
  const staged = gitRead(root, ["ls-files", "-z"], { indexFile }).split("\0").filter(Boolean);
  const inIndex = new Set(staged);
  const rel = (abs) => path.relative(root, abs).split(path.sep).join("/");
  const readdir = (abs) => {
    const prefix = rel(abs) ? `${rel(abs)}/` : "";
    const names = new Set();
    for (const f of staged) if (f.startsWith(prefix)) names.add(f.slice(prefix.length).split("/")[0]);
    return [...names].sort();
  };
  const readFile = (abs) => (inIndex.has(rel(abs)) ? gitRead(root, ["show", `:${rel(abs)}`], { indexFile }) : "");
  return { readdir, readFile, paths: staged };
}

/** HEAD AS A FILESYSTEM, in the same shape — for subject(HEAD), which is what judges a staged
 *  DELETION (design D1 step 2): the index no longer holds the path, so subject(index) cannot name it.
 *  `ls-tree -r -z HEAD` for the listing, `show HEAD:<path>` for bytes. No HEAD (an unborn branch)
 *  reads as an EMPTY tree. These read no index, and take `indexFile` anyway, so no read in this file is
 *  on the inherited index by omission. */
export function headReaders(root, { indexFile } = {}) {
  let listing = "";
  try { listing = gitRead(root, ["ls-tree", "-r", "-z", "HEAD"], { indexFile }); } catch { listing = ""; }
  const paths = listing.split("\0").filter(Boolean).map((rec) => rec.slice(rec.indexOf("\t") + 1));
  const inHead = new Set(paths);
  const rel = (abs) => path.relative(root, abs).split(path.sep).join("/");
  const readdir = (abs) => {
    const prefix = rel(abs) ? `${rel(abs)}/` : "";
    const names = new Set();
    for (const f of paths) if (f.startsWith(prefix)) names.add(f.slice(prefix.length).split("/")[0]);
    return [...names].sort();
  };
  const readFile = (abs) => (inHead.has(rel(abs)) ? gitRead(root, ["show", `HEAD:${rel(abs)}`], { indexFile }) : "");
  return { readdir, readFile, paths };
}

/** THE ONE MANIFEST ENTRY POINT (Gate 1 round 4, T2; design D1, "Content identity"). The bucket's
 *  subject derived over the index at `indexFile` (the inherited index when omitted), intersected with
 *  that index's paths, with modes and blob ids from `ls-files -s` under the SAME index. Its callers are
 *  drift's freshness check, certify (with its index copy) and the fixture helper `seedAgreeingEntry()`,
 *  so the key a run records and the key drift looks up are one computation, not two kept equal.
 *  Returns `{ subject, manifest, key }`; `subject` is the intersection, i.e. the manifest's paths. */
export function indexManifest(root, bucket, { indexFile } = {}) {
  const readers = indexReaders(root, { indexFile });
  const derived = bucketSubject(bucket, { root, ...readers });
  const manifest = manifestOf({ subject: derived, indexEntries: parseStagedEntries(gitRead(root, ["ls-files", "-s", "-z"], { indexFile })) });
  return { subject: Object.keys(manifest), manifest, key: manifestKey(manifest) };
}

/** subject(HEAD) for a bucket — the lazy half of the demand (design D1 step 2). */
export function headSubject(root, bucket, { indexFile } = {}) {
  return bucketSubject(bucket, { root, ...headReaders(root, { indexFile }) });
}

// ───────────────────────────── the checks ─────────────────────────────

/** The checks of one phase, as data (D4, `phaseChecks()`): all four with no `phase`. The lists are
 *  gathered here and checked in certification.mjs, so the checks themselves are pure and can be
 *  exercised by the assertion half. A check the phase does not run reports nothing, and its inputs are
 *  not gathered. `message` is the ABSOLUTE path of the commit message file (the hook makes it so). */
export function checkAll(root = REPO, { phase, message } = {}) {
  const checks = new Set(phaseChecks(phase));
  const tracked = trackedTestFiles(root);
  const staged = stagedFiles(root);
  // EVERY SET BELOW IS READ FROM THE INDEX (0.50.0) — see indexReaders(). The record is the one
  // thing still read from disk: it lives in the git common dir and is not part of any commit. Every
  // read here is on the INHERITED index — the one the hook hands drift — so no indexFile.
  const readers = indexReaders(root);
  const { readdir } = readers;
  const functional = functionalIds(root, readdir);
  const assertion = assertionIds(root, readdir);
  const indexPaths = new Set(readers.paths);

  // CHECK 3's INPUTS (D4). git parses the trailers (`--no-divider`: a `---` line does not end the
  // message, as it does not for Gate 2's `%(trailers)`; the scissors line still does). A merge is
  // found through `--git-path`, which names the per-worktree MERGE_HEAD in a linked worktree, where
  // `.git` is a file (Gate 1 M3).
  let exemptions = [];
  let isMerge = false;
  if (checks.has("coupling")) {
    if (message !== undefined) {
      if (!path.isAbsolute(message)) throw new Error(`--message must be an absolute path (got ${JSON.stringify(message)})`);
      exemptions = parseTwinExemptions(gitRead(root, ["interpret-trailers", "--parse", "--no-divider", message]));
    }
    isMerge = fs.existsSync(gitRead(root, ["rev-parse", "--path-format=absolute", "--git-path", "MERGE_HEAD"]).trim());
  }

  const result = {
    enrolment: checks.has("enrolment") ? enrolmentRefusals(tracked) : [],
    twins: checks.has("twins") ? twinRefusals({ functional, assertion }) : [],
    coupling: checks.has("coupling") ? couplingRefusals({ stagedFiles: staged, functional, assertion, exemptions, isMerge }) : [],
    // CHECK 4, one bucket at a time: the demand, then — only when demanded — this index's manifest
    // and the ONE entry its key names (certification-record-redesign D1). Nothing is resolved against
    // an entry about some other tree, and the superseded single-file record is never read (D5).
    record: checks.has("record") ? BUCKETS.map((bucket) => freshnessRefusal({
      commonDir: path.resolve(root, gitRead(root, ["rev-parse", "--git-common-dir"]).trim()),
      bucket,
      stagedPaths: staged,
      indexPaths,
      subjectIndex: () => bucketSubject(bucket, { root, ...readers }),
      subjectHead: () => headSubject(root, bucket),
      manifest: () => indexManifest(root, bucket).manifest,
    })).filter(Boolean) : [],
  };
  return { result, tracked, staged, functional, assertion, checks, exemptions, isMerge };
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
  const undeclared = refusals.coupling.filter((c) => !c.declaration);
  if (undeclared.length) {
    lines.push("these functional files are staged without their assertion twin in the same diff:");
    for (const c of undeclared) lines.push(`  ${c.id} — ${c.functional} is staged, ${c.assertion} is not`);
    lines.push("  (a change that leaves what the file tests untouched may declare it: a `Twin-Unchanged: <id> — <reason>` trailer)");
  }
  const declared = refusals.coupling.filter((c) => c.declaration);
  if (declared.length) {
    lines.push("these Twin-Unchanged declarations are refused:");
    for (const c of declared) {
      lines.push(c.declaration === "not-staged"
        ? `  ${c.id} — declared Twin-Unchanged, but ${c.functional} is not staged: the declaration exempts nothing`
        : `  ${c.id} — declared Twin-Unchanged with no reason: Gate 2 has nothing to judge`);
    }
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
/** What a refusal's closing line says the checks are, per phase — the reader is told which hook ran
 *  which checks, so a pre-commit refusal never names coupling and a commit-msg refusal names only it. */
const CHECKS_IN_PROSE = {
  "pre-commit": "drift: the pre-commit checks are enrolment, twin coverage and record freshness; diff coupling runs in the commit-msg hook.",
  "commit-msg": "drift: the commit-msg check is diff coupling; a `Twin-Unchanged: <id> — <reason>` trailer declares a change that leaves what the file tests untouched.",
};
if (invokedDirectly) {
  let root = REPO;
  const arg = (name) => { const i = process.argv.indexOf(name); return i !== -1 ? process.argv[i + 1] : undefined; };
  if (arg("--root")) root = path.resolve(arg("--root"));
  const phase = arg("--phase");
  const message = arg("--message") === undefined ? undefined : path.resolve(arg("--message"));
  let payload;
  try {
    payload = checkAll(root, { phase, message });
  } catch (e) {
    process.stderr.write(`drift: could not run the checks — ${e && e.message}\n`);
    process.exit(1);
  }
  const lines = render(payload.result);
  if (lines.length) {
    process.stderr.write("drift: ABORT — the suite's two halves have drifted apart\n\n");
    for (const l of lines) process.stderr.write(`${l}\n`);
    process.stderr.write(`\n${CHECKS_IN_PROSE[phase] || "drift: the checks are enrolment, twin coverage, diff coupling and record freshness."}\n`);
    if (payload.checks.has("record")) {
      process.stderr.write("drift: `node scripts/test/certify.mjs functional|sweeps` produces the record a freshness refusal names.\n");
    }
    process.exit(1);
  }
  // EVERY DECLARATION IS PRINTED ON THE ACCEPTING RUN (D4), so an exemption is visible where the commit
  // was made, in the words Gate 2's `%(trailers:key=Twin-Unchanged)` audit will read.
  if (payload.checks.has("coupling") && !payload.isMerge) {
    for (const e of payload.exemptions) process.stdout.write(`drift: coupling exemption ${e.id} — ${e.reason}\n`);
  }
  if (phase === "commit-msg") {
    process.stdout.write(payload.isMerge
      ? "drift: ok — a merge commit (MERGE_HEAD is present); the coupling check does not judge a merge\n"
      : `drift: ok — ${payload.staged.length} staged paths, ${payload.exemptions.length} Twin-Unchanged declarations\n`);
  } else {
    process.stdout.write(
      `drift: ok — ${payload.tracked.length} tracked test files, ${payload.functional.length} functional ids, ` +
      `${payload.staged.length} staged paths\n`,
    );
  }
}

export { homeOf };
