// scripts/test/certification.mjs
// THE SHARED MACHINERY OF THE DRIFT SCRIPT AND THE CERTIFY RUNNER (design D7/D8, tasks 5.4, 6.1–6.4).
//
// WHY IT IS ONE MODULE. The drift script CHECKS the record and the certify runner WRITES it, and the
// two must agree about three things or the gate is theatre: which modules are certified, what a
// content hash is taken over, and how a covers id resolves. Two copies of any of those is the
// defect the change's own floor (D8) exists to catch — two expressions that move in lockstep, so a
// drift in one is invisible from the other. So: one derivation, imported by both.
//
// IT SPAWNS NOTHING AND READS NO GIT. Everything here is a pure function of files and of lists its
// caller gathered. The git plumbing (`ls-files`, `diff --cached`, `show :path`, `rev-parse
// --git-common-dir`) lives in the two CLI tails — drift.mjs and certify.mjs — so the checks can be
// exercised in the assertion half, where a spawn is a refusal (5.2's guard).
//
// DEV-ONLY, AND IN THE TEST TREE. Nothing here ships: the plugin's shipped surface is
// `.claude-plugin/`, `commands/`, `agents/`, `skills/`, `hooks/` and `scripts/conductor.mjs` +
// `scripts/lib/` — see 8.4's parity ledger. This file is under `scripts/test/`, so it is not in it.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The repository this module's defaults read. `scripts/test/certification.mjs` → two levels up. */
export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The record's file name, under `$(git rev-parse --git-common-dir)` — beside the `pm-suite.lock`
 *  the pre-commit hook already keeps there (D7). Machine state, never committed, shared by every
 *  worktree of this clone. */
export const RECORD_NAME = "pm-suite-certification.json";

/** The two `kind`s an entry can have (D7/D9). `module` is a certified engine module; `trigger` is a
 *  change-triggered bucket's own subject. They are DISJOINT demands: an edit to `scripts/conductor.mjs`
 *  changes both hashes, so it demands a conformance run AND a sweep run and neither substitutes. */
export const KIND_MODULE = "module";
export const KIND_TRIGGER = "trigger";

/** The sweep bucket's trigger id (D9). */
export const ENGINE_SOURCE = "engine-source";

/** The engine entry point, named rather than derived in two places. */
export const ENGINE_ENTRY = "scripts/conductor.mjs";

/** The functional half's conformance file id (D10/6.2). `conductor.mjs`'s `covers` is THIS id, because
 *  the in-process/CLI status equivalence is its subject and nothing else in the functional half
 *  watches it. */
export const CONFORMANCE_ID = "conformance";

/** The FOUR homes a tracked test file may have (D5, plus 0.48.0's unit rung), plus the script's
 *  named exclusion list, which is EMPTY today. An entry here states why the file is in neither half,
 *  who runs it, and where its result is recorded — the vocabulary is D5's table, and the emptiness is
 *  the claim that every one of the repository's tracked test files has a home.
 *
 *  THE COUNT MOVED FROM THREE TO FOUR WITH THE UNIT RUNG (0.48.0, task 2.2), and the comment moves
 *  in the same edit on purpose: a comment that under-counts the homes is how the next file gets filed
 *  in none. */
export const EXCLUSIONS = [];

const readDefault = (p) => fs.readFileSync(p, "utf8");
const readdirDefault = (p) => fs.readdirSync(p);

// ───────────────────────────── the enrolment rule (check 1) ─────────────────────────────

/** The rungs and halves a test file may be filed under, IN THE ORDER the refusal message names
 *  them. ONE list, because it is asked two questions — "where does this path land" and "what should
 *  the refusal say" — and two lists answering them is how a fourth home gets added to one and not the
 *  other. That is exactly what happened before 0.48.0: `drift.mjs`'s enrolment refusal named the
 *  THREE homes in hand-written prose ("move it under scripts/test/assert/, scripts/test/functional/
 *  or scripts/test/sweeps/"), which is not derived from this regex and would have stayed wrong the
 *  moment `unit` was added (task 2.2's I5). */
export const HOMES = ["assert", "unit", "functional", "sweeps"];

/** The home a repository-relative test path lands in, or `null`. The names above are the homes;
 *  anything else — including a file sitting directly in `scripts/test/` — is no home at all. */
export function homeOf(rel) {
  const m = new RegExp(`^scripts\\/test\\/(${HOMES.join("|")})\\/[^/]+\\.test\\.mjs$`).exec(rel);
  return m ? m[1] : null;
}

/** The homes as a reader should see them named in a refusal, derived from HOMES so the message cannot
 *  go stale: `scripts/test/assert/, scripts/test/unit/, …`, with the last joined by "or". */
export function homesInProse() {
  const dirs = HOMES.map((h) => `scripts/test/${h}/`);
  return `${dirs.slice(0, -1).join(", ")} or ${dirs[dirs.length - 1]}`;
}

/** Every tracked test file that has no home. The enumeration the caller passes MUST be BOTH arms of
 *  `git ls-files 'scripts/test/*.test.mjs'` plus the nested arm (see drift.mjs's `trackedTestFiles`
 *  for the measurement): a git pathspec's `*` matches `/`, so the FIRST arm reaches nested files as
 *  well as top-level ones, and the `**` arm is the one that misses a file sitting directly in
 *  `scripts/test/`. Both are named so the enumeration is correct under either reading of a rule this
 *  repository has already mis-stated once (G-M3, Gate 2). */
export function enrolmentRefusals(trackedTestFiles, exclusions = EXCLUSIONS) {
  const excused = new Set(exclusions.map((e) => (typeof e === "string" ? e : e.file)));
  return trackedTestFiles.filter((f) => homeOf(f) === null && !excused.has(f)).sort();
}

/** The functional half's ids, from disk (D6: the id is derived from the file's place on disk, never
 *  from a registry, so a pair renamed apart cannot stay silently paired). */
export function functionalIds(root = REPO, readdir = readdirDefault) {
  return testIdsIn(root, "functional", readdir);
}

/** The assertion half's ids — BOTH ITS RUNGS (0.48.0 task 4.1).
 *
 *  THE TWIN RULE IS ABOUT HALVES, NOT DIRECTORIES: it says every functional id has a twin in the
 *  ASSERTION half, and the unit rung is a rung of that half (design D2) — same trigger, same runner
 *  invocation.
 *  Reading only `assert/` would refuse a functional id whose twin had MOVED to the unit rung, which
 *  is exactly what 4.1's migration does to a file whose tests assert on values: flag-parsing is the
 *  first one, and its twin is a full port of a functional file's tests. Found by attempting that
 *  move rather than by reading the rule — the refusal named the missing twin, and the missing twin
 *  was there, one directory over. */
export function assertionIds(root = REPO, readdir = readdirDefault) {
  return [...new Set([...testIdsIn(root, "assert", readdir), ...testIdsIn(root, "unit", readdir)])].sort();
}

/** The sweep bucket's ids. A `covers` entry may name one of these as readily as a functional id —
 *  the `engine-source` trigger's own member does — so a resolver that looked only in the functional
 *  half would refuse every record the sweep runner writes. Found by running the drift script against
 *  a record produced by `certify sweeps`, which is the reason that verification is end-to-end. */
export function sweepIds(root = REPO, readdir = readdirDefault) {
  return testIdsIn(root, "sweeps", readdir);
}

function testIdsIn(root, half, readdir) {
  // A MISSING DIRECTORY IS AN EMPTY ONE, not a crash. These functions are handed synthetic
  // repositories as well as this one — the functional half's hook tests build a throwaway tree with
  // only the directories their subject needs — so a rung this repository has and a fixture does not
  // would otherwise turn "no unit files here" into `ENOENT … scandir`, which is a failure of the
  // CHECK rather than a finding about the suite. The enrolment check is what refuses a file with no
  // home; it is not this function's job to insist a directory exists.
  let names;
  try { names = readdir(path.join(root, "scripts", "test", half)); } catch { return []; }
  return names
    .filter((f) => f.endsWith(".test.mjs"))
    .map((f) => f.slice(0, -".test.mjs".length))
    .sort();
}

/** Check 2 — TWIN COVERAGE, ONE DIRECTION (D6, task 5.4). Every functional id must have an assertion
 *  file of the same id. The converse is deliberately NOT a refusal: an assertion-half file with no
 *  functional twin is the normal shape for a test whose subject is not git's behaviour. The direction
 *  that carries the risk is the one checked — the functional half is the half that can go months
 *  unrun, so the fast half is the one that must learn its behaviour. */
export function twinRefusals({ functional, assertion }) {
  const have = new Set(assertion);
  return functional.filter((id) => !have.has(id)).sort();
}

/** THE PATHS A TWIN CAN LIVE AT — one per rung of the assertion half (0.48.0 task 5.1(c)).
 *
 *  A SINGLE DERIVATION, because this path is asked three questions: which file would SATISFY the twin
 *  rule, which file must be STAGED with a functional change, and which file the refusal should NAME.
 *  Until 4.1's first migration it was the literal `scripts/test/assert/${id}.test.mjs` in two of those
 *  places and prose in the third — the shape 5.1(c) exists to find, and it would have been wrong in
 *  all three the moment a twin moved to the unit rung. */
export const twinPathsOf = (id) => HOMES.filter((h) => h !== "functional" && h !== "sweeps")
  .map((h) => `scripts/test/${h}/${id}.test.mjs`);

/** Check 3 — DIFF COUPLING (D6). A staged change to a functional file requires its twin in the SAME
 *  staged diff. Keyed on the functional half only, where check 2 is keyed. A rename carries both
 *  paths and passes — which is why the caller must collect the staged set with `--no-renames`. */
export function couplingRefusals({ stagedFiles, functional, assertion }) {
  const staged = new Set(stagedFiles);
  const have = new Set(assertion);
  const out = [];
  for (const id of functional) {
    const functionalPath = `scripts/test/functional/${id}.test.mjs`;
    if (!staged.has(functionalPath)) continue;
    // THE TWIN MAY BE ON EITHER RUNG — `find` reports the first one that is STAGED, so the
    // refusal names the file the author would have had to touch.
    const twinPath = twinPathsOf(id).find((p) => staged.has(p)) || twinPathsOf(id)[0];
    if (staged.has(twinPath) && have.has(id)) continue;
    out.push({ id, functional: functionalPath, assertion: twinPath });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

// ───────────────────────────── the certified set (derived, never typed) ─────────────────────────────

/** The modules a functional run certifies: every module that CALLS the gateway, plus the entry point
 *  whose return-status mapping the conformance set pins (D7's "and `conductor.mjs`", which is NOT
 *  derivable from the gateway sweep and is named for the opposite reason).
 *
 *  THE DERIVATION IS THE CALL, NOT THE NAME. A module is in the set when its source contains a
 *  `gitOps(` call. `invocation.mjs` DEFINES that function and `git-gateway.mjs` IS the gateway, so
 *  neither can be "handed a double" in the sense that matters — they are excluded by name, and a
 *  module ADDED later that starts calling the gateway enters the set without anyone remembering to
 *  add it, which is the whole point of deriving rather than listing. */
export function certifiedModules(root = REPO, readFile = readDefault, readdir = readdirDefault) {
  const CALLS_GATEWAY = /\bgitOps\s*\(/;
  const machinery = new Set(["git-gateway.mjs", "invocation.mjs"]);
  const libDir = path.join(root, "scripts", "lib");
  const mods = readdir(libDir)
    .filter((f) => f.endsWith(".mjs") && !machinery.has(f))
    .filter((f) => CALLS_GATEWAY.test(readFile(path.join(libDir, f))))
    .map((f) => `scripts/lib/${f}`);
  if (CALLS_GATEWAY.test(readFile(path.join(root, ENGINE_ENTRY)))) mods.push(ENGINE_ENTRY);
  return mods.sort();
}

/** The `engine-source` trigger's subject (D9): the entry point plus every library module, because the
 *  output sweep reads their SOURCE and a change to any of them can invalidate it. */
export function engineSourceFiles(root = REPO, readdir = readdirDefault) {
  const libDir = path.join(root, "scripts", "lib");
  return [ENGINE_ENTRY, ...readdir(libDir).filter((f) => f.endsWith(".mjs")).sort().map((f) => `scripts/lib/${f}`)];
}

/** Every id the record can be keyed on, with the files its entry covers. */
export function certifiedSet(root = REPO, readFile = readDefault, readdir = readdirDefault) {
  const out = new Map();
  for (const m of certifiedModules(root, readFile, readdir)) out.set(m, [m]);
  out.set(ENGINE_SOURCE, engineSourceFiles(root, readdir));
  return out;
}

// ───────────────────────────── content hashing (D7: freshness is the CONTENT) ─────────────────────────────

/** The hash of a set of files' bytes, as an entry records it. Path-tagged so two files whose contents
 *  are swapped do not hash the same, and sorted so the hash does not depend on readdir order. */
export function contentHash(files, readContent) {
  const h = crypto.createHash("sha256");
  for (const f of [...files].sort()) h.update(f).update("\0").update(readContent(f)).update("\0");
  return h.digest("hex");
}

/** The hash of the files AS STAGED (`git show :<path>`), which is what check 4 compares against —
 *  "a record exists whose contentHash equals the hash of those files as staged" (D8, check 4). The
 *  distinction matters: a developer who stages, then edits the worktree, has staged content the
 *  record does not describe, and the worktree byte-compare would have called that fresh. */
export function stagedHash(files, readStaged) {
  return contentHash(files, readStaged);
}

// ───────────────────────────── covers (D7: recorded, not implied) ─────────────────────────────

/** The functional ids recorded as covering `moduleId`.
 *
 *  THE RULE IS MECHANICAL AND STATED: a functional id covers a module when that module's BASENAME
 *  appears in the functional file's source. It is a weaker claim than "this file exercises that
 *  module" and it is the stronger of the two that can be DERIVED from disk alone — the alternative,
 *  an operation-level map of which test drives which gateway call, is the split-probe's scratch
 *  artifact and is not a mechanism anything can re-derive at certification time. What the drift
 *  script then holds is the part that matters: every covers id must RESOLVE, so a renamed or deleted
 *  functional file cannot leave a module reading as certified by an id that no longer exists (7.2).
 *
 *  `scripts/conductor.mjs` is the exception, and 6.2 states it: its covers is the CONFORMANCE SET —
 *  the in-process/CLI status equivalence lives in its dispatch and its tail and is not derivable
 *  from the gateway sweep. Its row ids are recorded alongside, so deleting a conformance ROW refuses
 *  too, not just renaming the file. */
export function coversFor(moduleId, { root = REPO, functional = functionalIds(root), readFile = readDefault } = {}) {
  if (moduleId === ENGINE_ENTRY) return [CONFORMANCE_ID];
  const base = path.basename(moduleId);
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // THE BARE NAME — an unqualified mention, which is how a test names the module it is driving.
  const names = new RegExp(`(^|[^\\w./-])${escaped}(?![\\w-])`);
  // ...AND THE IMPORT SPECIFIER, which the bare rule cannot see (G-M2, Gate 2). A test that reaches
  // a module the normal way writes `await import("../../lib/commit-watch.mjs")`, and the character
  // before the basename is `/` — inside the bare rule's excluded set, because that set exists to stop
  // `not-git.mjs` matching `git.mjs`. The two rules are kept separate for exactly that reason: an
  // IMPORT can only be the module's own specifier, so `/` is safe there, and widening the bare rule
  // instead would make every file that merely prints a module's path a claim to cover it. Found by a
  // certified module (`commit-watch.mjs`) certifying with an EMPTY covers, which the writer now
  // refuses — the refusal is what made the hole visible rather than a module reading as covered by
  // nothing.
  const imported = new RegExp(`(?:from\\s*|import\\s*\\(|require\\s*\\()\\s*["'][^"']*/${escaped}["']`);
  return functional.filter((id) => {
    const src = readFile(path.join(root, "scripts", "test", "functional", `${id}.test.mjs`));
    return names.test(src) || imported.test(src);
  });
}

/** The conformance set's row ids, read out of the functional conformance file's ROWS table. The rows
 *  are the CLASSES 1.1 enumerates — one row per refusal class — so deleting one is deleting the only
 *  observation of that class, which is what 7.2 requires the record to refuse over. */
export function conformanceRows(root = REPO, readFile = readDefault) {
  const file = path.join(root, "scripts", "test", "functional", `${CONFORMANCE_ID}.test.mjs`);
  const src = readFile(file);
  const start = src.indexOf("const ROWS = [");
  if (start === -1) throw new Error(`certification: ${CONFORMANCE_ID}.test.mjs no longer carries a 'const ROWS = [' table`);
  const end = src.indexOf("\n];", start);
  if (end === -1) throw new Error(`certification: ${CONFORMANCE_ID}.test.mjs's ROWS table is not terminated`);
  const body = src.slice(start, end);
  return [...body.matchAll(/^\s*name:\s*"((?:[^"\\]|\\.)*)"/gm)].map((m) => JSON.parse(`"${m[1]}"`));
}

/** The entry one certified MODULE gets, as data — pure, so its SHAPE is testable without running a
 *  bucket (the shape is what 7.2's dangling-id checks read). `covers` is recorded, never implied
 *  (D7), and for the entry point the conformance set's ROWS are recorded beside the file id so that
 *  deleting a row refuses rather than leaving `conductor.mjs` certified by a class nobody observes
 *  any more. */
export function moduleEntry(id, { root = REPO, functional, counts, ranAt, engineSha, readFile = (p) => fs.readFileSync(p, "utf8") }) {
  return {
    kind: KIND_MODULE,
    files: [id],
    contentHash: contentHash([id], (rel) => readFile(path.join(root, rel))),
    covers: coversFor(id, { root, functional, readFile }),
    result: "pass",
    ranAt,
    engineSha,
    counts,
    run: "node scripts/test/certify.mjs functional",
    ...(id === ENGINE_ENTRY ? { conformanceRows: conformanceRows(root, readFile) } : {}),
  };
}

/** The entry the `engine-source` TRIGGER gets — a second, DISJOINT demand over the whole engine
 *  source, which is the sweep bucket's subject (D9/6.3). */
export function triggerEntry({ root = REPO, counts, ranAt, engineSha, readFile = (p) => fs.readFileSync(p, "utf8"), readdir = readdirDefault }) {
  const files = engineSourceFiles(root, readdir);
  return {
    kind: KIND_TRIGGER,
    files,
    contentHash: contentHash(files, (rel) => readFile(path.join(root, rel))),
    covers: ["output-interpolations"],
    result: "pass",
    ranAt,
    engineSha,
    counts,
    run: "node scripts/test/certify.mjs sweeps",
  };
}

// ───────────────────────────── the index run plan (certification-record-redesign D2) ─────────────────────────────

/** THE CERTIFY RUN, AS A VALUE: the ordered steps that take ONE copy of the index and build the
 *  directory a bucket runs in (#230). A pure function of its four inputs, so which index each step
 *  reads is asserted on the plan (`unit/certify-index`) rather than only observed by running it.
 *
 *  THE LIVE INDEX IS READ ONCE, by the first step, which copies it to `<tmp>/index`. Everything after
 *  reads that copy: the manifest (`ls-files -s` under `GIT_INDEX_FILE` = the copy), and the export,
 *  because the copy is installed as the clone's own index before `checkout-index` runs. So an edit or
 *  a `git add` during a run of several minutes changes neither what ran nor what is recorded.
 *
 *  WHY A `clone --shared`, NOT A BARE `checkout-index` EXPORT. Several functional tests need a
 *  repository around the content (a HEAD, a parent commit, a readable object); run from a bare export
 *  they die with `not a git repository`. A shared clone borrows the object store through `alternates`
 *  (so the index's staged, unreachable blobs are readable), copies no objects, registers no worktree
 *  and touches no stash. HEAD is set explicitly, detached, because `clone` would otherwise take the
 *  common repository's default branch rather than this worktree's HEAD; an unborn HEAD sets none.
 *
 *  A step is `{ op: "copy", from, to }` or `{ op: "git", args, env? }`, where `env` holds only what
 *  the step adds to the environment. The caller executes them in order. */
export function indexRunPlan({ indexFile, commonDir, headSha, tmp }) {
  const copy = path.join(tmp, "index");
  const tree = path.join(tmp, "tree");
  return {
    copy,
    tree,
    steps: [
      { op: "copy", from: indexFile, to: copy },
      { op: "git", args: ["-C", commonDir, "ls-files", "-s", "-z"], env: { GIT_INDEX_FILE: copy } },
      { op: "git", args: ["clone", "--shared", "--no-checkout", "-q", commonDir, tree] },
      ...(headSha ? [{ op: "git", args: ["-C", tree, "update-ref", "--no-deref", "HEAD", headSha] }] : []),
      { op: "copy", from: copy, to: path.join(tree, ".git", "index") },
      { op: "git", args: ["-C", tree, "checkout-index", "-a", "-f"] },
    ],
  };
}

// ───────────────────────────── freshness as a manifest (certification-record-redesign D1) ─────────────────────────────

/** The subject ROOTS (design D2, "The skip"). Every rule that admits a path into a bucket's subject
 *  admits only paths under one of these, so a staged set holding none of them demands nothing, and
 *  neither subject derivation has to be paid for to know it. ONE constant, which the derivation also
 *  filters on, so the skip and the derivation cannot disagree. */
export const SUBJECT_ROOTS = Object.freeze(["scripts/", ".githooks/", "hooks/", "commands/", "skills/", "agents/", ".claude-plugin/"]);
export const SUBJECT_ROOT_FILES = Object.freeze(["README.md", "CLAUDE.md", "docs/parity-ledger.json"]);
export const underSubjectRoot = (rel) => SUBJECT_ROOTS.some((r) => rel.startsWith(r)) || SUBJECT_ROOT_FILES.includes(rel);

/** The staged paths that demand a bucket (design D1 step 2; suite-certification, "A staged change").
 *  A staged path demands it when it is in the subject derived from the index, or — for a path the
 *  index no longer holds, which is what a staged DELETION is — in the subject derived from HEAD. A
 *  path the index still holds is judged by subject(index) alone (m2).
 *
 *  The two derivations are THUNKS, each called at most once and only when needed: neither when no
 *  staged path lies under a subject root (m3), and subject(HEAD) only when a staged path under one
 *  is absent from the index. An ordinary commit pays for one derivation, a docs-only commit for none. */
export function demandedPaths({ stagedPaths, indexPaths, subjectIndex, subjectHead }) {
  const candidates = [...stagedPaths].filter(underSubjectRoot);
  if (!candidates.length) return [];
  const inIndex = indexPaths instanceof Set ? indexPaths : new Set(indexPaths);
  const sIndex = new Set(subjectIndex());
  let sHead = null;
  const out = [];
  for (const p of candidates) {
    if (sIndex.has(p)) { out.push(p); continue; }
    if (inIndex.has(p)) continue;
    if (sHead === null) sHead = new Set(subjectHead());
    if (sHead.has(p)) out.push(p);
  }
  return out.sort();
}

/** Whether a staged set demands a bucket at all — `demandedPaths()` is non-empty. */
export function bucketDemanded(args) {
  return demandedPaths(args).length > 0;
}

/** The manifest of a subject over an index: every subject path the index HOLDS, mapped to its
 *  `"<mode> <blob id>"` (Gate 1 round 4, design D1 step 3). A path the derivation names but the index
 *  does not hold — `engineSourceFiles()` always names `scripts/conductor.mjs`, which a hook fixture
 *  writes and never tracks — has no mode and no blob, so it cannot be in a manifest. The rule lives
 *  here, in the one function every caller shares, rather than in any one caller.
 *  `indexEntries` is a Map (or plain object) of path → "<mode> <blob id>". */
export function manifestOf({ subject, indexEntries }) {
  const get = indexEntries instanceof Map ? (p) => indexEntries.get(p) : (p) => indexEntries[p];
  const out = {};
  for (const p of [...new Set(subject)].sort()) {
    const v = get(p);
    if (v !== undefined) out[p] = v;
  }
  return out;
}

/** `git ls-files -s -z` output as the Map `manifestOf()` takes: "<mode> <blob> <stage>\t<path>\0"
 *  per entry → path → "<mode> <blob>". The ONLY parser of that output (design D1, "Content identity");
 *  its one caller is drift's `indexManifest()`. */
export function parseStagedEntries(text) {
  const out = new Map();
  for (const rec of String(text).split("\0").filter(Boolean)) {
    const tab = rec.indexOf("\t");
    const [mode, blob] = rec.slice(0, tab).split(" ");
    out.set(rec.slice(tab + 1), `${mode} ${blob}`);
  }
  return out;
}

/** An entry's NAME: the sha256 of its manifest, serialized as `path NUL mode SP blob NUL` over the
 *  sorted paths. The mode is in it, so a chmod-only change is a different manifest. */
export function manifestKey(manifest) {
  const h = crypto.createHash("sha256");
  for (const p of Object.keys(manifest).sort()) h.update(p).update("\0").update(manifest[p]).update("\0");
  return h.digest("hex");
}

/** Two manifests are EQUAL: the same path set, and the same mode and blob per path. */
export function sameManifest(a, b) {
  const ka = Object.keys(a || {}), kb = Object.keys(b || {});
  return ka.length === kb.length && ka.every((p) => Object.prototype.hasOwnProperty.call(b, p) && a[p] === b[p]);
}

/** FRESHNESS (design D1 step 3, Gate 1 B1): a demanded bucket is fresh only when ONE entry — the one
 *  named by the index manifest's key, which `entryFor(key)` returns or null — passed, is this bucket's,
 *  and holds EXACTLY the index manifest. A lookup, never a scan: no entry can combine with another, and
 *  an entry about some other tree's content is simply never consulted (it neither passes nor refuses).
 *  Returns `{ fresh, key, why }`; `why` is null when fresh. */
export function recordFreshness({ bucket, indexManifest, entryFor }) {
  const key = manifestKey(indexManifest);
  const entry = entryFor(key);
  let why = null;
  if (!entry) why = "no passing run over this content is recorded";
  else if (entry.bucket !== bucket) why = `the entry under this content's key is the ${JSON.stringify(entry.bucket)} bucket's`;
  else if (entry.result !== "pass") why = `the recorded result for this content was ${JSON.stringify(entry.result)}`;
  else if (!sameManifest(entry.manifest, indexManifest)) why = "the entry under this content's key holds a different manifest";
  return { fresh: why === null, key, why };
}

/** The run that satisfies a bucket's demand. The refusal NAMES it, because a refusal a developer
 *  cannot satisfy is a refusal that gets bypassed. */
export const runForBucket = (bucket) => `node scripts/test/certify.mjs ${bucket}`;

/** CHECK 4 FOR ONE BUCKET, over the record directory (design D1 steps 1-4): the demand, then — only
 *  when demanded — the index's manifest (a thunk, so a commit that demands nothing reads none) and
 *  the ONE entry its key names. Returns null when the bucket is not demanded or is fresh, else the
 *  refusal `{ kind: "stale-record", bucket, changed, run, key, why }`, where `changed` is the staged
 *  subject paths. A record directory that does not exist — a fresh clone, or one that holds only the
 *  superseded single-file record — has no entries, so a demand in it is always a refusal (D5). */
export function freshnessRefusal({ commonDir, bucket, stagedPaths, indexPaths, subjectIndex, subjectHead, manifest, io = fs }) {
  const changed = demandedPaths({ stagedPaths, indexPaths, subjectIndex, subjectHead });
  if (!changed.length) return null;
  const f = recordFreshness({ bucket, indexManifest: manifest(), entryFor: (key) => readEntry(commonDir, bucket, key, io) });
  if (f.fresh) return null;
  return { kind: "stale-record", bucket, changed, run: runForBucket(bucket), key: f.key, why: f.why };
}

// ───────────────────────────── the record DIRECTORY (certification-record-redesign D1, D5) ─────────────────────────────

/** The record's directory, under `$(git rev-parse --git-common-dir)`: one sub-directory per bucket,
 *  one file per passing run, `<bucket>/<manifest key>.json`. A NEW path (D5), so the single-file record
 *  beside it is never read and never removed by anything here. */
export const RECORD_DIR = "pm-suite-certification.d";

/** The buckets, which are also the record's directory names. */
export const BUCKETS = Object.freeze(["functional", "sweeps"]);

export const bucketDir = (commonDir, bucket) => path.join(commonDir, RECORD_DIR, bucket);

/** A path that is a test file OF a bucket — what a manifest must hold at least one of, or the pass it
 *  records rests on no test of its bucket. */
const isBucketTest = (bucket, rel) => new RegExp(`^scripts/test/${bucket}/[^/]+\\.test\\.mjs$`).test(rel);

/** Write one passing run's entry: `<key>.json`, created through a UNIQUE temp name and a rename.
 *  No run reads another run's file to write its own, so two runs cannot lose each other's entry
 *  (#226); two runs over identical content produce the same key, and the second rename replaces the
 *  file with an equivalent claim. `ranAt` is taken when the entry is WRITTEN, so the pruner never
 *  ranks a just-finished run as the oldest.
 *
 *  REFUSED, writing nothing: an unknown bucket, and a manifest holding no test file of its bucket —
 *  the successor of the empty-covers refusal (design D1, "What retires"). Returns `{ key, file, entry }`. */
export function writeManifestEntry(commonDir, { bucket, manifest, counts = null, engineSha = "unknown", worktree = null },
  { io = fs, now = () => new Date() } = {}) {
  if (!BUCKETS.includes(bucket)) {
    throw new Error(`certification: refusing to record an entry for bucket ${JSON.stringify(bucket)} — the buckets are ${BUCKETS.join(" and ")}`);
  }
  if (!Object.keys(manifest || {}).some((p) => isBucketTest(bucket, p))) {
    throw new Error(`certification: refusing to record a ${bucket} entry whose manifest holds no test file of the ${bucket} bucket ` +
      `(scripts/test/${bucket}/*.test.mjs) — the entry would claim a pass that no test of the bucket stands behind`);
  }
  const key = manifestKey(manifest);
  const dir = bucketDir(commonDir, bucket);
  const file = path.join(dir, `${key}.json`);
  const entry = { version: 2, bucket, manifest, result: "pass", counts, ranAt: now().toISOString(), engineSha, worktree };
  io.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `${key}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`);
  io.writeFileSync(tmp, JSON.stringify(entry, null, 2) + "\n");
  io.renameSync(tmp, file);
  return { key, file, entry };
}

/** The entry of one key, or null. An absent directory or file is NO ENTRY — a fresh clone, a clone
 *  upgraded mid-flight, or an entry a concurrent pruner removed — which can only turn a pass into a
 *  demand, the loud direction. */
export function readEntry(commonDir, bucket, key, io = fs) {
  try {
    return JSON.parse(io.readFileSync(path.join(bucketDir(commonDir, bucket), `${key}.json`), "utf8"));
  } catch (e) {
    if (e && e.code === "ENOENT") return null;
    throw e;
  }
}

/** THE INVERSE OF WRITING (design D1, "Pruning"; Gate 1 M6). Keeps the bucket's newest `max` entries by
 *  `ranAt`, and never `keep` — the entry the run just wrote — whatever its `ranAt`. Also removes the
 *  leftovers of killed runs: a `*.tmp` in the bucket directory older than an hour (a live writer holds
 *  its temp name for milliseconds), and a `pm-certify-run.*` directory under `tmpDir` older than 24
 *  hours (a functional run takes minutes). A pruned entry can only cause a demand, never a pass.
 *  Returns the paths removed. */
export function pruneRecord(commonDir, bucket, { keep = null, max = 50, tmpDir = os.tmpdir(), io = fs, nowMs = Date.now() } = {}) {
  const dir = bucketDir(commonDir, bucket);
  const removed = [];
  const rm = (p) => { try { io.rmSync(p, { recursive: true, force: true }); removed.push(p); } catch { /* already gone */ } };
  const olderThan = (p, ms) => { try { return nowMs - io.statSync(p).mtimeMs > ms; } catch { return false; } };
  let names = [];
  try { names = io.readdirSync(dir); } catch { names = []; }
  const entries = [];
  for (const n of names) {
    if (n.endsWith(".tmp")) { if (olderThan(path.join(dir, n), 3600 * 1000)) rm(path.join(dir, n)); continue; }
    if (!n.endsWith(".json")) continue;
    const key = n.slice(0, -".json".length);
    let ranAt = 0;
    try { ranAt = Date.parse(JSON.parse(io.readFileSync(path.join(dir, n), "utf8")).ranAt) || 0; } catch { continue; }
    entries.push({ key, ranAt });
  }
  const others = entries.filter((e) => e.key !== keep).sort((a, b) => b.ranAt - a.ranAt);
  const room = keep && entries.some((e) => e.key === keep) ? max - 1 : max;
  for (const e of others.slice(Math.max(0, room))) rm(path.join(dir, `${e.key}.json`));
  let runs = [];
  try { runs = io.readdirSync(tmpDir); } catch { runs = []; }
  for (const n of runs) {
    if (n.startsWith("pm-certify-run.") && olderThan(path.join(tmpDir, n), 24 * 3600 * 1000)) rm(path.join(tmpDir, n));
  }
  return removed;
}

// ───────────────────────────── the record ─────────────────────────────

/** Read the record, or an empty one. A fresh clone has NO record, and that is correct behaviour
 *  rather than an error: the first commit touching a certified module demands a run (6.2). */
export function readRecord(gitCommonDir, readFile = readDefault) {
  const p = path.join(gitCommonDir, RECORD_NAME);
  try {
    const parsed = JSON.parse(readFile(p));
    if (!parsed || typeof parsed !== "object" || typeof parsed.entries !== "object" || parsed.entries === null) {
      throw new Error(`certification: the record at ${p} has no 'entries' object`);
    }
    return parsed;
  } catch (e) {
    if (e && e.code === "ENOENT") return { version: 1, entries: {} };
    throw e;
  }
}

/** Write an entry, leaving every other entry alone — the runner records one bucket at a time and must
 *  not drop the other's claim. The write is atomic (write beside, then rename) so a killed run
 *  cannot leave a half-written record that reads as a pass. */
export function writeEntry(gitCommonDir, entryId, entry, io = fs) {
  // AN ENTRY WITH NO COVERS IS REFUSED (G-M2, Gate 2). `covers` is what makes a record answerable:
  // it names the tests the claim rests on, and every one of them is resolved when the record is
  // consulted. An empty list passes that resolution vacuously, so a module could certify over a run
  // in which NOTHING is named as covering it — a pass with no observation behind it, which is the
  // shape this whole record exists to make impossible. The refusal is at the WRITER, where the
  // entry is created, rather than in the drift check, because a record that should never exist is
  // better refused than diagnosed later.
  if (!Array.isArray(entry?.covers) || entry.covers.length === 0) {
    throw new Error(
      `certification: refusing to record '${entryId}' with an EMPTY covers — the entry would claim a ` +
      "pass with no test named as covering it. Every certified module must be named by at least one " +
      "functional or sweep id; if none does, the derivation in coversFor() is missing a mention of it " +
      `(an import specifier counts — see coversFor), and the fix belongs there.`);
  }
  const p = path.join(gitCommonDir, RECORD_NAME);
  const record = readRecord(gitCommonDir, (q) => io.readFileSync(q, "utf8"));
  record.version = 1;
  record.entries[entryId] = entry;
  const tmp = `${p}.${process.pid}.tmp`;
  io.writeFileSync(tmp, JSON.stringify(record, null, 2) + "\n");
  io.renameSync(tmp, p);
  return record;
}

// ───────────────────────────── check 4 — the record's freshness, and its dangling ids (7.2) ─────────────────────────────

/** Which run satisfies an entry's demand. The refusal NAMES this command, because a refusal a
 *  developer cannot satisfy is a refusal that gets bypassed (6.3/6.4). */
export function runFor(entryId) {
  return entryId === ENGINE_SOURCE
    ? "node scripts/test/certify.mjs sweeps"
    : "node scripts/test/certify.mjs functional";
}

/** Check 4, and 7.2's DATA-reference obligation, in one place.
 *
 *  THE FRESHNESS TEST IS THE CONTENT HASH, NOT THE AGE AND NOT A COMMIT IDENTITY (D7). A module whose
 *  content is unchanged needs no new run however old the record; a module whose content changed needs
 *  one however recent the record. Both directions are asserted by the drift script's tests.
 *
 *  `hashStaged(files)` returns the hash of those files AS STAGED, or `null` when the caller cannot
 *  staged-read them — a null is treated as a demand that cannot be shown fresh, which is the loud
 *  direction.
 *
 *  THE DANGLING-ID HALF is 7.2's. A record points at a module id and at functional ids (`covers`);
 *  a module renamed, a functional file deleted or a conformance row removed leaves the record
 *  rendering a pointer to something that no longer exists, and the module reads as certified by a
 *  test nobody can run. Every one of those is REFUSED rather than silently ignored, and it is
 *  checked whenever the record is consulted at all — not only when the pointed-at file moved. */
export function recordRefusals({
  stagedFiles,
  record,
  set,                       // Map<entryId, files[]>, from certifiedSet()
  hashStaged,                // (files) => string|null
  liveIds,                   // every id a covers entry may name: the functional half PLUS the
                             // sweep bucket, which is where the engine-source trigger's own
                             // member (`output-interpolations`) lives
  conformanceRowsNow,        // string[] | null — null when the conformance file is absent
}) {
  const staged = new Set(stagedFiles);
  const live = new Set(liveIds);
  const refusals = [];

  for (const [entryId, files] of set) {
    const changed = files.filter((f) => staged.has(f));
    if (!changed.length) continue;
    const entry = record.entries[entryId];
    const want = hashStaged(files);
    if (!entry || entry.result !== "pass" || entry.contentHash !== want) {
      refusals.push({
        kind: "stale-record",
        entryId,
        changed,
        // WHAT KIND OF THING CHANGED (G-M1, Gate 2). This read `set.get(entryId).kind`, and the
        // certified set maps an id to its FILES — an array, whose `.kind` is undefined — so the
        // trigger branch below never fired and every refusal called the engine-source trigger a
        // "module". The entry's OWN kind is the right source when the record has one (it was
        // written by whoever certified it); the derivation is the fallback for the case the entry is
        // missing or was written without one, and it is the same derivation `runFor()` uses.
        noun: entry?.kind ?? (entryId === ENGINE_SOURCE ? KIND_TRIGGER : KIND_MODULE),
        run: runFor(entryId),
        why: !entry
          ? "no record entry covers this content"
          : entry.result !== "pass"
            ? `the record's last result for it was ${JSON.stringify(entry.result)}`
            : want === null
              ? "the staged content could not be read, so no record can be shown to cover it"
              : "the record covers DIFFERENT content — it was written before this change",
      });
    }
  }

  for (const [entryId, entry] of Object.entries(record.entries)) {
    if (!set.has(entryId)) {
      refusals.push({
        kind: "dangling-entry",
        entryId,
        why: "the record certifies an id that is no longer in the certified set — a module was renamed " +
          "or removed, and a record keyed on the old name reads as a certification of nothing",
      });
      continue;
    }
    for (const id of entry.covers ?? []) {
      if (!live.has(id)) {
        refusals.push({
          kind: "dangling-covers",
          entryId,
          covers: id,
          why: "the record names a test id that no longer exists in either half or the sweep bucket — " +
            "the entry would read as covered by a test nobody can run",
        });
      }
    }
    if (entryId === ENGINE_ENTRY && entry.covers?.includes(CONFORMANCE_ID)) {
      const now = new Set(conformanceRowsNow ?? []);
      if (now.size === 0) {
        refusals.push({
          kind: "dangling-covers",
          entryId,
          covers: CONFORMANCE_ID,
          why: `the conformance set's rows could not be read from scripts/test/functional/${CONFORMANCE_ID}.test.mjs`,
        });
      } else {
        for (const row of entry.conformanceRows ?? []) {
          if (!now.has(row)) {
            refusals.push({
              kind: "dangling-covers",
              entryId,
              covers: `${CONFORMANCE_ID} — ${JSON.stringify(row)}`,
              why: "a conformance ROW the record was written over is gone; deleting a row deletes the only " +
                "observation of that refusal class, and the record must not keep claiming it",
            });
          }
        }
      }
    }
  }

  return refusals;
}

/** One rendered line per refusal, so both the CLI and its tests print the same sentence. */
export function describeRefusal(r) {
  switch (r.kind) {
    case "stale-record":
      return `the certified ${r.noun === "trigger" ? "change-triggered bucket" : "module"} '${r.entryId}' ` +
        `changed (${r.changed.join(", ")}), and ${r.why}. Run \`${r.run}\` to certify the new content.`;
    case "dangling-entry":
      return `the record holds an entry for '${r.entryId}': ${r.why}. Delete the entry or re-run ` +
        `\`${runFor(r.entryId)}\`.`;
    case "dangling-covers":
      return `the record's entry for '${r.entryId}' names ${r.covers} in its covers: ${r.why}. ` +
        `Re-run \`${runFor(r.entryId)}\`.`;
    default:
      return `${r.kind}: ${JSON.stringify(r)}`;
  }
}
