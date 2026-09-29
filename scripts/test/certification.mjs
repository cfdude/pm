// scripts/test/certification.mjs
// THE SHARED MACHINERY OF THE DRIFT SCRIPT AND THE CERTIFY RUNNER (design D7/D8, tasks 5.4, 6.1–6.4).
//
// WHY IT IS ONE MODULE. The drift script CHECKS the record and the certify runner WRITES it, and the
// two must agree about three things or the gate is theatre: what each bucket's subject is, what a
// manifest and its key are, and where an entry lives. Two copies of any of those is the defect the
// change's own floor (D8) exists to catch — two expressions that move in lockstep, so a drift in one
// is invisible from the other. So: one derivation, imported by both (certification-record-redesign D1).
//
// IT SPAWNS NOTHING AND READS NO GIT. Everything here is a pure function of files and of lists its
// caller gathered, plus the record directory's own reads and writes. The git plumbing (`ls-files`,
// `ls-files -s`, `diff --cached`, `show :path`, `ls-tree`/`show HEAD:path`, `rev-parse`) lives in
// drift.mjs — whose `indexManifest()` certify calls too — so the checks can be exercised in the
// assertion half, where a spawn is a refusal (5.2's guard).
//
// DEV-ONLY, AND IN THE TEST TREE. Nothing here ships: the plugin's shipped surface is
// `.claude-plugin/`, `commands/`, `agents/`, `skills/`, `hooks/` and `scripts/conductor.mjs` +
// `scripts/lib/` — see 8.4's parity ledger. This file is under `scripts/test/`, so it is not in it.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lex, stripComments } from "./js-lexer.mjs";

/** The repository this module's defaults read. `scripts/test/certification.mjs` → two levels up. */
export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The engine entry point, named rather than derived in two places. */
export const ENGINE_ENTRY = "scripts/conductor.mjs";

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

/** Check 3 — DIFF COUPLING (D6), with a DECLARED EXEMPTION (certification-record-redesign D4, #227). A
 *  staged change to a functional file requires its twin in the SAME staged diff, UNLESS the commit
 *  message declares `Twin-Unchanged: <id> — <reason>` (`parseTwinExemptions()`) — the committer's
 *  claim that the change leaves what the file tests untouched, which Gate 2 audits. Keyed on the
 *  functional half only, where check 2 is keyed. A rename carries both paths and passes — which is why
 *  the caller must collect the staged set with `--no-renames`.
 *
 *  THE DECLARATIONS ARE JUDGED TOO. One naming an id whose functional file is not staged exempts
 *  nothing and is a stale or mistyped claim: refused as `{ id, declaration: "not-staged", functional }`.
 *  One with an empty reason gives Gate 2 nothing to judge: refused as `{ id, declaration: "no-reason" }`,
 *  and it exempts nothing, so its unpaired file is refused as well. An undeclared unpaired file is
 *  refused exactly as it was before declarations existed, `{ id, functional, assertion }`.
 *
 *  `isMerge` (MERGE_HEAD present): NOTHING is judged. A merge's staged set is every change the other
 *  parent brings in, each judged with its own declarations when it was made; a declaration on a
 *  merged-in commit is not on the merge's message. A squash has no MERGE_HEAD and is judged. */
export function couplingRefusals({ stagedFiles, functional, assertion, exemptions = [], isMerge = false }) {
  if (isMerge) return [];
  const staged = new Set(stagedFiles);
  const have = new Set(assertion);
  const out = [];
  const exempt = new Set();
  for (const { id, reason } of exemptions || []) {
    const functionalPath = `scripts/test/functional/${id}.test.mjs`;
    if (!staged.has(functionalPath)) out.push({ id, declaration: "not-staged", functional: functionalPath });
    else if (!reason) out.push({ id, declaration: "no-reason" });
    else exempt.add(id);
  }
  for (const id of functional) {
    const functionalPath = `scripts/test/functional/${id}.test.mjs`;
    if (!staged.has(functionalPath) || exempt.has(id)) continue;
    // THE TWIN MAY BE ON EITHER RUNG — `find` reports the first one that is STAGED, so the
    // refusal names the file the author would have had to touch.
    const twinPath = twinPathsOf(id).find((p) => staged.has(p)) || twinPathsOf(id)[0];
    if (staged.has(twinPath) && have.has(id)) continue;
    out.push({ id, functional: functionalPath, assertion: twinPath });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** WHICH CHECKS A PHASE RUNS (certification-record-redesign D4, Gate 1 M5). The pre-commit hook runs
 *  enrolment, twin coverage and freshness; the commit-msg hook runs coupling, the one check that must
 *  read the message — so coupling runs in exactly one hook. With NO phase (a developer's bare
 *  `node scripts/test/drift.mjs`) every check runs, so a bare run never reports fewer refusals than
 *  the two hooks together. An unknown phase is refused rather than read as "none". */
export const PHASES = Object.freeze({
  "pre-commit": Object.freeze(["enrolment", "twins", "record"]),
  "commit-msg": Object.freeze(["coupling"]),
});
export function phaseChecks(phase) {
  if (phase === undefined) return ["enrolment", "twins", "coupling", "record"];
  if (!Object.hasOwn(PHASES, phase)) {
    throw new Error(`drift: unknown phase ${JSON.stringify(phase)} — the phases are ${Object.keys(PHASES).join(" and ")}`);
  }
  return [...PHASES[phase]];
}

/** THE DECLARATIONS A COMMIT MESSAGE CARRIES (certification-record-redesign D4, Gate 1 B3, round 2 I1/I2).
 *  `parsedTrailers` is the OUTPUT of `git interpret-trailers --parse --no-divider <message>` — git has
 *  already decided which lines are trailers (the last paragraph only, above any `commit -v` scissors
 *  line, a `---` line not ending the message), so this function applies none of that rule and cannot
 *  disagree with Gate 2's `%(trailers:key=Twin-Unchanged)` about it. It reads only the `Twin-Unchanged`
 *  lines, the key matched without regard to case as `%(trailers:key=)` matches it.
 *
 *  THE SPLIT. The id is the value's FIRST whitespace-delimited token, and only a SPACED separator after
 *  it — ` — `, ` -- ` or ` - ` — begins the reason, which is everything after that separator. Splitting
 *  at the first `-` anywhere would cut `conductor-09` in two, and a reason may itself hold ` - `. A value
 *  with no spaced separator after its first token has an EMPTY reason, kept as empty so that the
 *  coupling check refuses it by name rather than dropping it. Returns `[{ id, reason }]` in git's order. */
export function parseTwinExemptions(parsedTrailers) {
  const out = [];
  for (const line of String(parsedTrailers).split("\n")) {
    const colon = line.indexOf(":");
    if (colon === -1 || line.slice(0, colon).trim().toLowerCase() !== "twin-unchanged") continue;
    const value = line.slice(colon + 1).trim();
    if (!value) continue;
    const id = value.split(/\s/)[0];
    const sep = /^\s+(?:—|--|-)(?:\s+([\s\S]*))?$/.exec(value.slice(id.length));
    out.push({ id, reason: sep && sep[1] ? sep[1].trim() : "" });
  }
  return out;
}

// ───────────────────────────── the subjects (derived, never typed) ─────────────────────────────

/** The engine source (D9): the entry point plus every library module, because the output sweep reads
 *  their SOURCE and a change to any of them can invalidate it. The sweeps subject is built on it. */
export function engineSourceFiles(root = REPO, readdir = readdirDefault) {
  const libDir = path.join(root, "scripts", "lib");
  return [ENGINE_ENTRY, ...readdir(libDir).filter((f) => f.endsWith(".mjs")).sort().map((f) => `scripts/lib/${f}`)];
}

/** THE FUNCTIONAL SUBJECT, DERIVED FROM WHAT THE HALF OBSERVES (certification-record-redesign D3, #229;
 *  task 3.1). Over ONE index, read through `readFile`/`readdir` (absolute paths under `root`) plus that
 *  index's path list `paths` — drift's `indexReaders()`, or any reader of the same shape. The union of:
 *
 *    1. the IMPORT CLOSURE of every `scripts/test/functional/*.test.mjs` and of the engine entry point:
 *       static `from`, `export … from`, a bare side-effect `import "…"`, and a literal dynamic
 *       `import("…")`, RELATIVE specifiers only (a package or `node:` specifier is no repository path);
 *    2. the functional test files themselves (they are closure roots);
 *    3. every assertion-half test file the half EXECUTES: one whose path — `assert/<name>.test.mjs` or
 *       `unit/<name>.test.mjs`, optionally prefixed `scripts/test/` — a closure file under
 *       `scripts/test/` spells in its CODE as a single- or double-quoted string. Comments are stripped
 *       first by the shared regex-aware lexer (`js-lexer.mjs`), so a twin named in a comment is not
 *       matched however it is quoted; a misparse THROWS, naming the file and line (fail closed). Such a
 *       file is a closure ROOT, so its own imports are in too;
 *    4. every tracked file under `scripts/`, `.githooks/` or `hooks/` — never `scripts/test/{assert,unit}/`,
 *       which only rule 3 admits — whose file name a closure file under `scripts/test/` spells as a
 *       string literal (quoted, or a template — Gate 2 m3), or as the last `/`-separated segment of one (the `coversFor()` basename
 *       precedent, moved to where it is sound);
 *    5. every tracked file under a shipped-surface root (`commands/`, `skills/`, `agents/`, `hooks/`,
 *       `.claude-plugin/`) when a closure file under `scripts/test/` spells that root as a path segment;
 *    6. `README.md`, `CLAUDE.md` and `docs/parity-ledger.json` when one spells the name.
 *
 *  THE RECORD IS NEVER IN IT — `openspec/`, `.conductor/`, `CHANGELOG.md` and the rest of `docs/` — by
 *  construction: no rule above reaches them. Rules 1, 4, 5 and 6 read the RAW text, as the measurement
 *  the design's numbers come from does (`measure.mjs`, which 7.2 re-runs with this function); only rule
 *  3 strips comments, because only rule 3 turns a mention into an EXECUTION. Membership is decided by
 *  `paths`, never by whether `readFile` returned bytes: a tracked file can be empty. Sorted. */
export function functionalSubject({ root = REPO, readFile = readDefault, readdir = readdirDefault, paths = null } = {}) {
  const listing = paths || walkPaths(root, readdir);
  const tracked = new Set(listing);
  const src = (rel) => (tracked.has(rel) ? readFile(path.join(root, rel)) : "");
  const IMPORT_SPEC = /(?:from\s*|import\s*\(\s*|\bimport\s*|export\s+\*\s+from\s*)["'](\.{1,2}\/[^"']+)["']/g;
  const EXECUTED = /["'](?:scripts\/test\/)?((?:assert|unit)\/[^"'/]+\.test\.mjs)["']/g;
  const closure = new Set();
  const stack = [...listing.filter((p) => /^scripts\/test\/functional\/[^/]+\.test\.mjs$/.test(p)), ENGINE_ENTRY];
  while (stack.length) {
    const f = stack.pop();
    if (closure.has(f) || !tracked.has(f)) continue;
    closure.add(f);
    const text = src(f);
    for (const m of text.matchAll(IMPORT_SPEC)) {
      const t = path.posix.normalize(path.posix.join(path.posix.dirname(f), m[1]));
      if (tracked.has(t) && !closure.has(t)) stack.push(t);
    }
    if (f.startsWith("scripts/test/")) {
      for (const m of stripComments(text, f).matchAll(EXECUTED)) {
        const t = `scripts/test/${m[1]}`;
        if (tracked.has(t) && !closure.has(t)) stack.push(t);
      }
    }
  }
  const spelled = [...closure].filter((f) => f.startsWith("scripts/test/")).map(src).join("\n");
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const out = new Set(closure);
  for (const f of listing) {
    if (out.has(f) || !/^(scripts\/|\.githooks\/|hooks\/)/.test(f) || /^scripts\/test\/(assert|unit)\//.test(f)) continue;
    // A backtick OPENS a string literal as well as closing one (Gate 2 m3): a template literal is a string literal.
    if (new RegExp(`["'\`/]${esc(path.posix.basename(f))}["'\`]`).test(spelled)) out.add(f);
  }
  for (const r of SHIPPED_ROOTS) {
    if (new RegExp(`["'/]${esc(r)}["'/]`).test(spelled)) for (const f of listing) if (f.startsWith(`${r}/`)) out.add(f);
  }
  for (const f of SUBJECT_ROOT_FILES) {
    if (tracked.has(f) && new RegExp(`["'/]${esc(path.posix.basename(f))}["']`).test(spelled)) out.add(f);
  }
  return [...out].sort();
}

/** THE REPOSITORY'S RECORD (design D3, "Why the repository's record is out"): `openspec/`, `.conductor/`,
 *  `CHANGELOG.md` and `docs/` other than the parity ledger. The functional half does read some of it
 *  (the archive walk, the live `state.json`, CHANGELOG as shipped markdown and through the engine), and
 *  the exclusion is a deliberate trade of demand frequency — so an observed read of it is not a refusal. */
export const isRecordPath = (rel) => /^(openspec|\.conductor)\//.test(rel) || rel === "CHANGELOG.md" ||
  (rel.startsWith("docs/") && rel !== "docs/parity-ledger.json");

/** The observer's own module, which its load reports as nothing (m9). */
export const OBSERVER = "scripts/test/fixtures/observe-reads.mjs";

/** ONE PROCESS'S OBSERVATION FILE, PARSED (Gate 2 G2). The observer appends one JSON line per event —
 *  `process` (pid, argv, test), `arrived`, `expected`, `cancelled` and `read` — each with one synchronous
 *  write made BEFORE the operation it observes, so a process killed mid-write can tear only its LAST line,
 *  and that line is an operation it never performed. So: the bytes after the last newline are dropped
 *  (`torn: true`), and ANY other corruption — a complete line that is not a JSON object of a known kind —
 *  THROWS, naming the file and the line. Returns the shape `observationRefusals()` reads. Pure. */
export const OBSERVATION_KINDS = Object.freeze(["process", "arrived", "expected", "cancelled", "read"]);
export function parseObservation(text, name = "<observation>") {
  const src = String(text);
  const cut = src.lastIndexOf("\n");
  const complete = cut === -1 ? "" : src.slice(0, cut);
  const out = { file: name, pid: null, argv: [], test: null, arrived: [], expected: [], cancelled: [], reads: [], torn: cut !== src.length - 1 && src.length > 0 };
  if (!complete && cut === -1) return out;
  complete.split("\n").forEach((line, i) => {
    let e;
    try { e = JSON.parse(line); } catch { e = null; }
    if (!e || typeof e !== "object" || Array.isArray(e) || !OBSERVATION_KINDS.includes(e.kind)) {
      throw new Error(`certification: the observation file ${name} is corrupt at line ${i + 1} (${JSON.stringify(line.slice(0, 80))}) — ` +
        "only its last line may be torn, by a process killed mid-write; refusing to judge a run from a damaged observation");
    }
    if (e.kind === "process") Object.assign(out, { pid: e.pid ?? null, argv: e.argv || [], test: e.test ?? null });
    else if (e.kind === "arrived") out.arrived.push(e.token);
    else if (e.kind === "expected") out.expected.push({ token: e.token, test: e.test, argv: e.argv });
    else if (e.kind === "cancelled") out.cancelled.push(e.token);
    else out.reads.push(e.path);
  });
  return out;
}

/** Every observation file a run's processes wrote under `dir` (`*.jsonl`), parsed, sorted by name. A
 *  corrupt file throws, naming it (`parseObservation()`). */
export function readObservations(dir, io = fs) {
  return io.readdirSync(dir).filter((n) => n.endsWith(".jsonl")).sort()
    .map((n) => parseObservation(io.readFileSync(path.join(dir, n), "utf8"), path.join(dir, n)));
}

/** WHAT A FUNCTIONAL RUN OBSERVED, JUDGED AGAINST THE DERIVED SUBJECT (design D3, "The check"; task 3.2).
 *  `observations` are the per-process files the observer wrote (`reads`, `expected`, `arrived`,
 *  `cancelled`); `subject` is `functionalSubject()` over the run's index copy; `tracked` is that copy's
 *  path list. Returns:
 *    missed    — every observed TRACKED path outside the subject that is not the record, sorted. A read
 *                recorded as a directory (the source of a `cp`) stands for every tracked file under it;
 *    unarrived — every EXPECTED Node child whose token neither arrived nor was cancelled: a direct child
 *                that loaded code without the observer, so what it read was never seen;
 *    excluded  — the observed record paths, reported as "excluded by rule", never refused.
 *  Pure: the certify runner reads the files and prints the refusal. */
export function observationRefusals({ observations, subject, tracked }) {
  const inSubject = new Set(subject);
  const trackedList = [...tracked];
  const trackedSet = new Set(trackedList);
  const seen = new Set();
  const arrived = new Set(), cancelled = new Set();
  const expected = [];
  for (const o of observations) {
    for (const r of o.reads || []) {
      if (trackedSet.has(r)) { seen.add(r); continue; }
      const prefix = r.endsWith("/") ? r : `${r}/`;
      for (const t of trackedList) if (t.startsWith(prefix)) seen.add(t);
    }
    for (const t of o.arrived || []) arrived.add(t);
    for (const t of o.cancelled || []) cancelled.add(t);
    for (const e of o.expected || []) expected.push(e);
  }
  seen.delete(OBSERVER);
  const missed = [], excluded = [];
  for (const p of [...seen].sort()) {
    if (inSubject.has(p)) continue;
    (isRecordPath(p) ? excluded : missed).push(p);
  }
  const unarrived = expected.filter((e) => !arrived.has(e.token) && !cancelled.has(e.token));
  return { missed, unarrived, excluded };
}

/** THE STATIC NODE_OPTIONS GUARD (design D3, "A static guard, for INDIRECT Node children"; task 3.2). A
 *  Node process that git or a shell starts cannot be matched to a run-time token, so before the bucket
 *  runs, every file under `scripts/test/{functional,fixtures}/` is refused whose CODE assigns
 *  `NODE_OPTIONS` a value that does not carry `process.env.NODE_OPTIONS` — a value that REPLACES the
 *  inherited options drops the observer from every Node process under it.
 *
 *  `files` is `[{ path, text }]`; other paths are ignored. Two syntactic shapes, and nothing else:
 *    an OBJECT KEY, bare or quoted (`NODE_OPTIONS:`, `"NODE_OPTIONS":`, `'NODE_OPTIONS':` — a key
 *      overriding `...process.env` is this shape);
 *    a PROPERTY ASSIGNMENT, dotted with the bare name (`env.NODE_OPTIONS =`) or subscripted with a quoted
 *      one (`env["NODE_OPTIONS"] =`, `env['NODE_OPTIONS'] =`), never `==` or `===`.
 *  A string in key or subscript position is CODE; every other string's text, and every comment, is not.
 *  The value is the text up to the end of that property or statement (the next `,` `;` `)` `]` or `}` at
 *  its own depth). The shared lexer tokenizes, and a misparse THROWS naming the file and line.
 *  Its limit (the spec's fourth): a statement-position regex misread that closes on its own line records
 *  no misparse, and an assignment inside it is not refused.
 *  Returns `[{ file, line, value }]`, sorted by file then line. */
export function nodeOptionsRefusals(files) {
  const out = [];
  const CARRIES = /process\.env\.NODE_OPTIONS\b|process\.env\[\s*["'`]NODE_OPTIONS["'`]\s*\]/;
  for (const { path: file, text } of files) {
    if (!/^scripts\/test\/(functional|fixtures)\//.test(file)) continue;
    const { contexts, misparse } = lex(text);
    if (misparse.length) {
      throw new Error(`certification: ${file}:${misparse[0].line}: ${misparse[0].what} — the NODE_OPTIONS guard refuses to answer from a misread`);
    }
    for (const ctx of contexts) {
      const toks = ctx.tokens;
      const strText = (t) => text.slice(t.start + 1, t.end - 1);
      const isPunct = (t, p) => t && t.kind === "punct" && t.text === p;
      for (let k = 0; k < toks.length; k++) {
        const t = toks[k];
        const bare = t.kind === "ident" && t.text === "NODE_OPTIONS";
        const quoted = t.kind === "string" && strText(t) === "NODE_OPTIONS";
        if (!bare && !quoted) continue;
        let valueAt = -1;
        if (isPunct(toks[k + 1], ":")) valueAt = k + 2;                                            // an object key
        else if (bare && isPunct(toks[k - 1], ".") && isPunct(toks[k + 1], "=")) valueAt = k + 2;  // env.NODE_OPTIONS =
        else if (quoted && isPunct(toks[k - 1], "[") && isPunct(toks[k + 1], "]") && isPunct(toks[k + 2], "=")) valueAt = k + 3;
        if (valueAt < 0) continue;
        let depth = 0, end = text.length;
        for (let j = valueAt; j < toks.length; j++) {
          const v = toks[j];
          if (v.kind === "punct" && ["(", "[", "{"].includes(v.text)) depth++;
          else if (v.kind === "punct" && [")", "]", "}"].includes(v.text)) { if (depth === 0) { end = v.start; break; } depth--; }
          else if (v.kind === "punct" && (v.text === "," || v.text === ";") && depth === 0) { end = v.start; break; }
          if (j === toks.length - 1) end = v.end;
        }
        const start = toks[valueAt] ? toks[valueAt].start : end;
        const value = text.slice(start, Math.max(start, end)).trim();
        if (CARRIES.test(value)) continue;
        out.push({ file, line: text.slice(0, t.start).split("\n").length, value });
      }
    }
  }
  return out.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

/** The shipped-surface roots rule 5 of `functionalSubject()` takes whole (design D3; `PARITY_ROOTS`). */
export const SHIPPED_ROOTS = Object.freeze(["commands", "skills", "agents", "hooks", ".claude-plugin"]);

/** Every file path under `root`, from a `readdir` over an index: a name the index holds nothing under
 *  is a FILE (an index has no empty directories). Used only when a reader supplies no `paths`. */
function walkPaths(root, readdir) {
  const out = [];
  const walk = (rel) => {
    let names = [];
    try { names = readdir(path.join(root, rel)); } catch { names = []; }
    if (!names.length && rel) { out.push(rel); return; }
    for (const n of names) walk(rel ? `${rel}/${n}` : n);
  };
  walk("");
  return out.sort();
}

/** A BUCKET'S SUBJECT (design D3, landing step L3), over one index read through `readFile`/`readdir`
 *  plus that index's path list `paths`:
 *    functional — `functionalSubject()`: what the functional half OBSERVES (its import closure, what it
 *                 executes, what it names, the shipped roots it walks). The `gitOps(` scan that decided
 *                 it until L3 is retired: it asked how a module reaches git, and a
 *                 module the half imports that never reaches git (b4ffe164's archive-gate.mjs, #229) fell
 *                 outside it;
 *    sweeps     — `engineSourceFiles()`, every tracked `scripts/test/sweeps/*.mjs` (the sweep's tests AND
 *                 the method they run), and `scripts/test/js-lexer.mjs`, which the sweep imports.
 *  The result may name a path the index does not hold (`engineSourceFiles()` always names the entry
 *  point); `manifestOf()` drops it. Sorted, de-duplicated. */
export function bucketSubject(bucket, { root = REPO, readFile = readDefault, readdir = readdirDefault, paths = null } = {}) {
  let out;
  if (bucket === "functional") {
    out = functionalSubject({ root, readFile, readdir, paths });
  } else if (bucket === "sweeps") {
    out = [
      ...engineSourceFiles(root, readdir),
      ...(paths || walkPaths(root, readdir)).filter((p) => /^scripts\/test\/sweeps\/[^/]+\.mjs$/.test(p)),
      "scripts/test/js-lexer.mjs",
    ];
  } else {
    throw new Error(`certification: no subject for bucket ${JSON.stringify(bucket)} — the buckets are functional and sweeps`);
  }
  return [...new Set(out)].filter(underSubjectRoot).sort();
}

// ───────────────────────────── the index run plan (certification-record-redesign D2) ─────────────────────────────

/** THE CERTIFY RUN, AS A VALUE: the ordered steps that take ONE copy of the index and build the
 *  directory a bucket runs in (#230). A pure function of its four inputs, so which index each step
 *  reads is asserted on the plan (`unit/certify-index`) rather than only observed by running it.
 *
 *  THE LIVE INDEX IS READ ONCE, by the first step, which copies it to `<tmp>/index`. Everything after
 *  reads that copy: the export, because the copy is installed as the clone's own index before
 *  `checkout-index` runs, and the manifest, which the runner reads through drift's `indexManifest()`
 *  with `indexFile` = the copy (2.4: the ONE manifest entry point, so this plan no longer carries its
 *  own `ls-files -s` step). So an edit or a `git add` during a run of several minutes changes neither
 *  what ran nor what is recorded.
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

/** Write one passing run's entry: `<key>.json`, written whole under a UNIQUE temp name and then
 *  LINKED into place — never renamed over it (Gate 2 m1; spec: writing an entry "SHALL create it, never
 *  rewrite a file another run wrote"). No run reads another run's file to write its own, so two runs
 *  cannot lose each other's entry (#226). Two runs over identical content produce the same key: the
 *  second link fails with EEXIST and the FIRST file is kept byte for byte (`created: false`). The temp
 *  name is removed either way. A link, not an exclusive create of `<key>.json` itself, so a reader never
 *  sees a half-written entry. `ranAt` is taken when the entry is WRITTEN, so the pruner never ranks a
 *  just-finished run as the oldest.
 *
 *  REFUSED, writing nothing: an unknown bucket, and a manifest holding no test file of its bucket —
 *  the successor of the empty-covers refusal (design D1, "What retires"). Returns `{ key, file, entry, created }`. */
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
  let created = true;
  try {
    io.linkSync(tmp, file);
  } catch (e) {
    if (!e || e.code !== "EEXIST") { try { io.unlinkSync(tmp); } catch { /* already gone */ } throw e; }
    created = false;
  }
  io.unlinkSync(tmp);
  return { key, file, entry, created };
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

/** One rendered line per refusal, so both the CLI and its tests print the same sentence. The
 *  freshness refusal names the BUCKET, the staged subject paths and the run (design D1 step 4). */
export function describeRefusal(r) {
  switch (r.kind) {
    case "stale-record":
      return `the ${r.bucket} bucket's subject changed (${r.changed.join(", ")}), and ${r.why}. ` +
        `Run \`${r.run}\` over the staged commit to certify the new content.`;
    default:
      return `${r.kind}: ${JSON.stringify(r)}`;
  }
}
