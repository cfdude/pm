// scripts/test/unit/certify-index.test.mjs
// certification-record-redesign task 1.1 (design D2) — THE RUN PLAN IS A VALUE.
//
// The certify runner used to run a bucket in the CHECKOUT and hash WORKING-TREE bytes (#230), while
// the commit, and since 0.50.0 the pre-commit hook, judge the INDEX. D2 moves the run onto one COPY
// of the index: the manifest is read from that copy, and the bytes the bucket runs over are exported
// from that copy into a `clone --shared`, so what ran and what is recorded come from one moment.
//
// The sequence is extracted as `indexRunPlan()`, a pure function of four values, so the property
// that matters — every read after the first goes to the COPY, and the live index is read exactly
// once — is asserted here on the plan itself, over no filesystem and no git. The functional twin
// (`functional/certify-index.test.mjs`) runs the plan against a real repository.
//
// UNIT RUNG: every observable below is a value the function returned.

import assert from "node:assert/strict";
import path from "node:path";
import * as certification from "../certification.mjs";
import * as certify from "../certify.mjs";
import { unitTest } from "../fixtures/unit-harness.mjs";

const INPUT = Object.freeze({
  indexFile: "/repo/.git/index",
  commonDir: "/repo/.git",
  headSha: "0123456789abcdef0123456789abcdef01234567",
  tmp: "/tmp/pm-certify-run.abc123",
});

function plan(over = {}) {
  assert.equal(typeof certification.indexRunPlan, "function",
    "certification.mjs exports no indexRunPlan(): the run plan is not a value, so which index the " +
    "runner reads cannot be asserted without running it");
  return certification.indexRunPlan({ ...INPUT, ...over });
}

/** The index of the first step matching `pred`, asserted to exist. */
function stepAt(steps, what, pred) {
  const i = steps.findIndex(pred);
  assert.notEqual(i, -1, `the plan has no ${what} step: ${JSON.stringify(steps)}`);
  return i;
}

const isGit = (sub) => (s) => s.op === "git" && s.args.includes(sub);

unitTest("1.1 the plan copies the index, clones shared, sets HEAD and exports, in that order", () => {
  const p = plan();
  const { steps } = p;
  const copy = stepAt(steps, "index copy", (s) => s.op === "copy" && s.from === INPUT.indexFile);
  const clone = stepAt(steps, "clone", isGit("clone"));
  const head = stepAt(steps, "update-ref", isGit("update-ref"));
  const copyIn = stepAt(steps, "copy into the clone", (s) => s.op === "copy" && s.from === p.copy);
  const exportAt = stepAt(steps, "checkout-index", isGit("checkout-index"));
  assert.deepEqual([copy, clone, head, copyIn, exportAt], [...[copy, clone, head, copyIn, exportAt]].sort((a, b) => a - b),
    "the steps are out of order: the index is copied FIRST, and the export runs LAST, over the copy");
  assert.equal(steps.length, 5, `the plan has steps nobody asked for: ${JSON.stringify(steps)}`);
  // THE MANIFEST LEFT THE PLAN AT 2.4 (Gate 1 round 4, T2): it is read through drift's ONE entry point,
  // `indexManifest(root, bucket, { indexFile: <the copy> })`, so no second parser of `ls-files -s`
  // exists here. `p.copy` is what the runner hands it.
  assert.equal(steps.some(isGit("ls-files")), false, "the plan reads no manifest of its own: drift's indexManifest() does");
  assert.deepEqual(steps[clone].args, ["clone", "--shared", "--no-checkout", "-q", INPUT.commonDir, p.tree],
    "the run directory is a SHARED clone of the common dir, with nothing checked out by clone itself");
  assert.deepEqual(steps[head].args, ["-C", p.tree, "update-ref", "--no-deref", "HEAD", INPUT.headSha],
    "the clone's HEAD is set to THIS worktree's HEAD, detached — clone would otherwise take the common repository's default");
  assert.deepEqual(steps[exportAt].args, ["-C", p.tree, "checkout-index", "-a", "-f"],
    "the export is every index entry, forced, inside the clone");
});

unitTest("1.1 the export reads the COPY, and the live index is read exactly once", () => {
  const p = plan();
  const { steps } = p;
  assert.ok(p.copy.startsWith(`${INPUT.tmp}${path.sep}`), `the index copy ${p.copy} is not under the run directory`);
  assert.ok(p.tree.startsWith(`${INPUT.tmp}${path.sep}`), `the clone ${p.tree} is not under the run directory`);

  const copyIn = steps.find((s) => s.op === "copy" && s.from === p.copy);
  assert.equal(copyIn.to, path.join(p.tree, ".git", "index"),
    "the clone's index must BE the copy, so checkout-index exports the same entries the manifest read");
  const exp = steps.find(isGit("checkout-index"));
  assert.equal(exp.env, undefined, "the export reads the clone's own index (the copy), with no index override");

  const namesLive = steps.filter((s) => JSON.stringify(s).includes(INPUT.indexFile));
  assert.deepEqual(namesLive, [{ op: "copy", from: INPUT.indexFile, to: p.copy }],
    "the LIVE index may be named by exactly one step, the copy; any other reader could see a later `git add`");
});

unitTest("1.1 the plan never names a worktree, the stash, GIT_DIR or GIT_WORK_TREE", () => {
  const text = JSON.stringify(plan());
  for (const banned of [/worktree/i, /stash/i, /GIT_DIR/, /GIT_WORK_TREE/]) {
    assert.doesNotMatch(text, banned,
      `the plan names ${banned}: a registered worktree orphaned by a SIGKILL breaks every session on the ` +
      "machine, the stash is shared by every worktree, and an exported GIT_DIR/GIT_WORK_TREE points every " +
      "test's child git at the user's repository (design D2, alternatives rejected)");
  }
});

unitTest("1.1 an unborn HEAD sets no HEAD in the clone, and the plan is a pure function of its input", () => {
  const unborn = plan({ headSha: null });
  assert.equal(unborn.steps.some(isGit("update-ref")), false,
    "with no HEAD there is no commit to point the clone at; the export still runs over the copy");
  assert.ok(unborn.steps.some(isGit("checkout-index")));
  assert.deepEqual(plan(), plan(), "two calls over the same input returned different plans");
});

// ─────────────── 1.2 — the run's environment (certify.mjs) ───────────────
//
// The runner executes the plan and the bucket with the caller's environment MINUS the variables git
// sets for a hook process. An inherited GIT_DIR, GIT_WORK_TREE or GIT_INDEX_FILE would point the
// run's git (the clone, the export, every test's child git) at the user's repository or index
// instead of the run directory's — the leak `.githooks/pre-commit` scrubs for the same reason. The
// functional twin runs the runner; this pins the scrub as a value.

unitTest("1.2 the run's environment drops every variable git sets for a hook, and keeps the rest", () => {
  assert.equal(typeof certify.cleanEnv, "function", "certify.mjs exports no cleanEnv(): the run's environment cannot be asserted");
  const hookEnv = Object.fromEntries(certify.HOOK_GIT_VARS.map((k) => [k, `/somewhere/${k}`]));
  const out = certify.cleanEnv({ ...hookEnv, PATH: "/bin", PM_KEEP: "yes" });
  for (const k of ["GIT_DIR", "GIT_INDEX_FILE", "GIT_WORK_TREE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_PREFIX"]) {
    assert.equal(k in out, false, `${k} reached the run: its git would read the user's repository, not the run directory`);
  }
  assert.deepEqual(out, { PATH: "/bin", PM_KEEP: "yes" }, "everything else in the environment is passed through");
  const input = { GIT_DIR: "/x", KEEP: "1" };
  certify.cleanEnv(input);
  assert.deepEqual(input, { GIT_DIR: "/x", KEEP: "1" }, "the scrub returns a copy; the caller's object is not modified");
});

// ─────────────── 1.3 — the bucket runs in the CLONE, never in a bare export ───────────────
//
// The functional twin's 1.3 guard runs the four files a bare `checkout-index --prefix` export breaks
// (no `.git`, so `fatal: not a git repository`) in the directory the runner builds. This pins the
// plan's half of that: the export is written INTO the clone the bucket runs in, never to a prefix.

unitTest("1.3 the export lands inside the clone, never in a bare --prefix directory", () => {
  const p = plan();
  const exp = p.steps.find(isGit("checkout-index"));
  assert.equal(exp.args.some((a) => a.startsWith("--prefix")), false,
    "a --prefix export has no repository around it; the functional half's HEAD and history reads die there");
  assert.equal(exp.args[1], p.tree, "the export runs in the clone");
  assert.equal(p.steps.find(isGit("clone")).args.at(-1), p.tree, "and the clone is the directory the bucket runs in");
});

// ─────────────── 3.1 — THE OBSERVED FUNCTIONAL SUBJECT, over an injected index reader ───────────────
//
// certification-record-redesign D3 (#229): the functional subject is what the half OBSERVES — the
// import closure of every functional test file and of the engine entry point, the functional files,
// every assertion-half file the half EXECUTES (a quoted `assert/<name>.test.mjs` in a closure file's
// CODE), every tracked file under `scripts/`, `.githooks/` or `hooks/` whose NAME a closure file under
// `scripts/test/` spells, the shipped-surface roots a closure file spells, and README.md / CLAUDE.md /
// docs/parity-ledger.json by name. The record (`openspec/`, `.conductor/`, `CHANGELOG.md`, the rest of
// `docs/`) is never in it. Every case below is a VALUE `functionalSubject()` returned over an index the
// test hands it as text — no path is read.
// From 3.3 it IS the functional bucket's subject (drift's and certify's, through `bucketSubject()`), so the
// functional twin's fixture stub IMPORTS its one library module — a comment naming it no longer puts it in.
// Its #229 guard (3.5) derives the subject over this repository's REAL index with git, which this rung
// cannot: the b4ffe164 shape is pinned here as a value (the first 3.1 case) and there over the real tree.

const ROOT = "/r";
/** An index as a filesystem, in the shape drift's `indexReaders()` returns: `paths` is the listing,
 *  `readdir`/`readFile` take absolute paths under ROOT; an absent file reads as "". */
function memIndex(files) {
  const paths = Object.keys(files).sort();
  const rel = (abs) => path.posix.relative(ROOT, abs);
  return {
    root: ROOT,
    paths,
    readFile: (abs) => files[rel(abs)] ?? "",
    readdir: (abs) => {
      const prefix = rel(abs) ? `${rel(abs)}/` : "";
      return [...new Set(paths.filter((p) => p.startsWith(prefix)).map((p) => p.slice(prefix.length).split("/")[0]))].sort();
    },
  };
}
function subjectOf(files) {
  assert.equal(typeof certification.functionalSubject, "function",
    "certification.mjs exports no functionalSubject(): the functional subject is still how a module reaches git (#229), not what the half observes");
  return new Set(certification.functionalSubject(memIndex(files)));
}
const FN = "scripts/test/functional/f.test.mjs";

unitTest("3.1 an engine module the half imports is IN though it makes no gateway call (the b4ffe164 shape)", () => {
  const s = subjectOf({
    "scripts/conductor.mjs": 'import { gate } from "./lib/archive-gate.mjs";\n',
    "scripts/lib/archive-gate.mjs": 'export const gate = () => "refused: the archive gate";\n',
    "scripts/lib/unused.mjs": "export const nobody = 1;\n",
    [FN]: 'import { test } from "node:test";\n',
  });
  assert.ok(s.has("scripts/lib/archive-gate.mjs"), `archive-gate.mjs is imported by the engine entry point: ${[...s]}`);
  assert.ok(s.has("scripts/conductor.mjs") && s.has(FN), "the entry point and the functional file are closure roots");
  assert.equal(s.has("scripts/lib/unused.mjs"), false, "a module nothing imports or names is not observed");
});

unitTest("3.1 .githooks/pre-commit and hooks/hooks.json are IN when a closure test spells their names", () => {
  const files = {
    ".githooks/pre-commit": "#!/bin/sh\n",
    "hooks/hooks.json": "{}\n",
    [FN]: 'const hook = path.join(REPO, ".githooks", "pre-commit");\nconst cfg = "hooks/hooks.json";\n',
  };
  const s = subjectOf(files);
  assert.ok(s.has(".githooks/pre-commit"), "the hook is named as a literal segment");
  assert.ok(s.has("hooks/hooks.json"), "the hook configuration is named as the last segment of a literal");
  const t = subjectOf({ ...files, [FN]: "// no names here\n" });
  assert.equal(t.has(".githooks/pre-commit") || t.has("hooks/hooks.json"), false, "unnamed, neither is observed");
});

unitTest("3.1 scripts/test/{assert,unit}/* are OUT unless executed, even when named", () => {
  const s = subjectOf({
    "scripts/test/assert/x.test.mjs": "",
    "scripts/test/unit/y.test.mjs": "",
    [FN]: 'const names = ["x.test.mjs", "y.test.mjs"];\n',
  });
  assert.equal(s.has("scripts/test/assert/x.test.mjs"), false, "a named assertion file is not executed by being named");
  assert.equal(s.has("scripts/test/unit/y.test.mjs"), false, "nor a named unit file");
});

unitTest("3.1 the shipped roots are wholly IN when a closure file spells the root, the three root files by name", () => {
  const files = {
    "commands/a.md": "", "commands/b.md": "", "skills/s/SKILL.md": "", "agents/r.md": "", "hooks/h.mjs": "",
    ".claude-plugin/plugin.json": "{}", "README.md": "", "CLAUDE.md": "", "docs/parity-ledger.json": "{}",
    "scripts/test/fixtures/roots.mjs": 'export const ROOTS = ["commands", "skills", "agents", "hooks", ".claude-plugin"];\n' +
      'export const DOCS = ["README.md", "CLAUDE.md", "docs/parity-ledger.json"];\n',
    [FN]: 'import { ROOTS } from "../fixtures/roots.mjs";\n',
  };
  const s = subjectOf(files);
  for (const p of Object.keys(files)) assert.ok(s.has(p), `${p} is observed: ${[...s].join(", ")}`);
  const t = subjectOf({ ...files, "scripts/test/fixtures/roots.mjs": "export const ROOTS = [];\n" });
  for (const p of ["commands/a.md", "skills/s/SKILL.md", "README.md", "CLAUDE.md", "docs/parity-ledger.json"]) {
    assert.equal(t.has(p), false, `${p} is not observed when nothing spells it`);
  }
});

unitTest("3.1 the record — openspec/, .conductor/, CHANGELOG.md and the rest of docs/ — is OUT even when named", () => {
  const s = subjectOf({
    "openspec/changes/c/tasks.md": "", ".conductor/state.json": "{}", "CHANGELOG.md": "", "docs/lessons/l.md": "",
    [FN]: 'const r = ["openspec", "tasks.md", ".conductor", "state.json", "CHANGELOG.md", "docs", "l.md"];\n',
  });
  for (const p of ["openspec/changes/c/tasks.md", ".conductor/state.json", "CHANGELOG.md", "docs/lessons/l.md"]) {
    assert.equal(s.has(p), false, `${p} is the repository's record, excluded by rule`);
  }
});

unitTest("3.1 a literal dynamic import and a bare side-effect import are followed; a non-relative specifier is not", () => {
  const s = subjectOf({
    "scripts/test/fixtures/hermetic-git.mjs": "export {};\n",
    "scripts/test/fixtures/late.mjs": "export const late = 1;\n",
    "scripts/test/fixtures/pkg/index.mjs": "export {};\n",
    [FN]: 'import "../fixtures/hermetic-git.mjs";\nimport path from "node:path";\nimport helper from "pkg";\n' +
      'const { late } = await import("../fixtures/late.mjs");\n',
  });
  assert.ok(s.has("scripts/test/fixtures/hermetic-git.mjs"), "a bare side-effect import is followed (Gate 1 M1)");
  assert.ok(s.has("scripts/test/fixtures/late.mjs"), "a literal dynamic import is followed");
  assert.equal(s.has("scripts/test/fixtures/pkg/index.mjs"), false, "a non-relative specifier is not a repository path");
});

unitTest("3.1 an EXECUTED assertion file is IN, with its imports (round 2 C1)", () => {
  const s = subjectOf({
    "scripts/test/assert/parity.test.mjs": 'import { walk } from "../fixtures/parity-helpers.mjs";\n',
    "scripts/test/fixtures/parity-helpers.mjs": "export const walk = () => [];\n",
    "scripts/test/assert/other.test.mjs": "",
    [FN]: 'const SITE_RUNS = [{ file: "assert/parity.test.mjs" }];\n',
  });
  assert.ok(s.has("scripts/test/assert/parity.test.mjs"), "the file the half runs as a nested test run is observed");
  assert.ok(s.has("scripts/test/fixtures/parity-helpers.mjs"), "and so is what it imports: it is a closure root");
  assert.equal(s.has("scripts/test/assert/other.test.mjs"), false);
});

unitTest("3.1 a twin named only in a comment stays OUT, quoted or not; the same quoted path in CODE is IN (R4)", () => {
  const twin = "scripts/test/assert/parity.test.mjs";
  const out = (body) => assert.equal(subjectOf({ [twin]: "", [FN]: body }).has(twin), false, `a comment executes nothing:\n${body}`);
  const inn = (body) => assert.ok(subjectOf({ [twin]: "", [FN]: body }).has(twin), `code that names the file runs it:\n${body}`);
  out("// Its assertion twin is `assert/parity.test.mjs`\n");
  out('// runs "assert/parity.test.mjs"\n');
  out('/* runs "assert/parity.test.mjs" */\n');
  out('/*\n * runs \'scripts/test/assert/parity.test.mjs\'\n */\n');
  inn('run("assert/parity.test.mjs");\n');
  inn('run("scripts/test/assert/parity.test.mjs");\n');
  // A string holding `//` is a string, not the start of a comment: the call after it is still code.
  inn('const u = "http://x"; run("assert/parity.test.mjs");\n');
});

// THE LEXER (Gate 1 round 4, T1): the comment stripper is the sweep's regex-aware `lex()`, moved to
// `scripts/test/js-lexer.mjs`. A tokenizer with no regex-literal state misread both lines below — it
// opened a string (or a template) inside the regex, kept the comment after it as string text, and so
// matched the quoted path in the comment. Each line is the real text of the file it is named after.

unitTest("3.1 a regex holding a quote does not open a string: the comment after it executes nothing (conformance.test.mjs:470)", () => {
  const body = "  assert.doesNotMatch(src, /process\\.on\\(\\s*[\"'`]exit[\"'`]/,\n" +
    '    "the engine must not instrument anything through a process exit handler");\n' +
    '// runs "assert/parity.test.mjs"\n';
  assert.equal(subjectOf({ "scripts/test/assert/parity.test.mjs": "", [FN]: body }).has("scripts/test/assert/parity.test.mjs"), false,
    "the regex's quote opened a string and the comment was read as code");
});

unitTest("3.1 a regex holding a backtick does not open a template (output-text-integrity.test.mjs:185)", () => {
  const body = "  const pushes = [...src.matchAll(/md\\.push\\(\\s*([\"'`])\\|/g)];\n" +
    '// runs "assert/parity.test.mjs"\n';
  assert.equal(subjectOf({ "scripts/test/assert/parity.test.mjs": "", [FN]: body }).has("scripts/test/assert/parity.test.mjs"), false,
    "the regex's backtick opened a template and the comment was read as code");
});

unitTest("3.1 a string that meets an unescaped newline is REFUSED as a misparse, naming the file and line 1", () => {
  const body = 'const a = "abc\nrun("assert/parity.test.mjs");\n';
  assert.throws(() => subjectOf({ "scripts/test/assert/parity.test.mjs": "", [FN]: body }),
    (e) => e instanceof Error && e.message.includes(FN) && /:1\b/.test(e.message),
    "a misread must fail closed, naming the file and the line — never answer from it");
});

unitTest("3.1 lex() reports the comment ranges it skipped and each misparse, additively", async () => {
  const { lex } = await import("../js-lexer.mjs");
  const src = 'a(); // one\n/* two */ b("x");\n';
  const r = lex(src);
  assert.deepEqual(r.comments.map(([s, e]) => src.slice(s, e)), ["// one", "/* two */"], "the skipped comment ranges");
  assert.deepEqual(r.misparse, [], "a well-formed source records no misparse");
  for (const [bad, what] of [['x = "a\nb";\n', "a string meeting a newline"], ["x = /a\nb/;\n", "a regex meeting a newline"],
    ["/* open\n", "an unterminated comment"], ["x = `a ${b\n", "input ending inside a template's ${…}"], ["x = 'a", "input ending inside a string"]]) {
    assert.ok(lex(bad).misparse.length > 0, `${what} is a misparse`);
  }
  assert.ok(Array.isArray(r.contexts) && Array.isArray(r.interps) && Array.isArray(r.templates), "the sweep's results are unchanged");
});

// ─────────────── 3.2 — THE STATIC NODE_OPTIONS GUARD (round 2 I3; round 3 shapes) ───────────────
//
// A Node process that git or a shell starts cannot be matched to a run-time token, so certify refuses,
// before the bucket runs, any functional test or fixture whose CODE assigns NODE_OPTIONS a value that does
// not carry `process.env.NODE_OPTIONS` (design D3). Two syntactic shapes — an object key, a property
// assignment — and nothing else; a comment or a string that is not the key or subscript is not code.

function guard(text, file = "scripts/test/functional/g.test.mjs") {
  assert.equal(typeof certification.nodeOptionsRefusals, "function",
    "certification.mjs exports no nodeOptionsRefusals(): a test that REPLACES NODE_OPTIONS drops the observer from every Node process under it, and nothing refuses it");
  return certification.nodeOptionsRefusals([{ path: file, text }]);
}
const refused = (text) => assert.equal(guard(text).length, 1, `this assignment replaces the inherited options and must be refused:\n${text}`);
const allowed = (text) => assert.deepEqual(guard(text), [], `this is not an assignment that replaces the options:\n${text}`);

unitTest("3.2 RED input: today's conformance.test.mjs:210 is refused, naming the file and line", () => {
  const line210 = "    env: (cwd) => ({\n      NODE_OPTIONS: `--require ${path.join(HERE, \"..\", \"fixtures\", \"inject-state-conflict.cjs\")}`,\n" +
    "      PM_INJECT_CONFLICT_DIR: path.join(cwd, \".conductor\"),\n    }),\n";
  assert.deepEqual(guard(line210, "scripts/test/functional/conformance.test.mjs").map((r) => [r.file, r.line]),
    [["scripts/test/functional/conformance.test.mjs", 2]]);
  allowed(line210.replace("`--require ${", "`${process.env.NODE_OPTIONS ?? \"\"} --require ${"));
});

unitTest("3.2 negatives: a comment showing the variable (future-clock.mjs:6), prose in a string, and comparisons", () => {
  // The real header of scripts/test/fixtures/future-clock.mjs, whose line 6 shows a command line.
  allowed("// scripts/test/fixtures/future-clock.mjs\n// THE CLOCK-SHIFT PRELOAD.\n//\n//\n//\n" +
    '//   PM_TEST_CLOCK_OFFSET_DAYS=400 NODE_OPTIONS="--import $PWD/scripts/test/fixtures/future-clock.mjs" \\\n' +
    "//     node --test scripts/test/unit/*.test.mjs scripts/test/assert/*.test.mjs\nconst OFFSET = Number(process.env.PM_TEST_CLOCK_OFFSET_DAYS || 0);\n");
  allowed('const doc = "NODE_OPTIONS: --require x";\n');
  allowed('if (x == "NODE_OPTIONS") y();\n');
  allowed("if (env.NODE_OPTIONS === y) z();\n");
});

unitTest("3.2 the object-key shape — bare, double-quoted, single-quoted, and a key overriding the spread — is refused unless it carries the inherited value", () => {
  for (const key of ["NODE_OPTIONS", '"NODE_OPTIONS"', "'NODE_OPTIONS'"]) {
    refused(`launch("node", ["x.mjs"], { env: { ${key}: "--require ./x.cjs" } });\n`);
    refused(`launch("node", ["x.mjs"], { env: { ...process.env, ${key}: "--require ./x.cjs" } });\n`);
    allowed(`launch("node", ["x.mjs"], { env: { ...process.env, ${key}: \`\${process.env.NODE_OPTIONS ?? ""} --require ./x.cjs\` } });\n`);
  }
});

unitTest("3.2 the property-assignment shape — dotted, and subscripted with either quote — is refused unless it carries the inherited value", () => {
  for (const target of ["env.NODE_OPTIONS", 'env["NODE_OPTIONS"]', "env['NODE_OPTIONS']"]) {
    refused(`${target} = "--require ./x.cjs";\n`);
    allowed(`${target} = \`\${process.env.NODE_OPTIONS ?? ""} --require ./x.cjs\`;\n`);
  }
});

unitTest("3.2 the tokenizer's order: a `//` inside a string does not hide the key after it; a block comment does", () => {
  refused('"a // b"; NODE_OPTIONS: "x"\n');
  allowed('/* NODE_OPTIONS: "x" */\n');
});

unitTest("3.2 only files under scripts/test/{functional,fixtures}/ are judged, and a misparse throws naming the file and line", () => {
  assert.deepEqual(guard('env.NODE_OPTIONS = "x";\n', "scripts/test/assert/a.test.mjs"), [], "the assertion half starts no process");
  assert.equal(guard('env.NODE_OPTIONS = "x";\n', "scripts/test/fixtures/f.mjs").length, 1);
  assert.throws(() => guard('const a = "abc\nenv.NODE_OPTIONS = "x";\n'),
    (e) => /scripts\/test\/functional\/g\.test\.mjs:1\b/.test(e.message), "a misread fails closed");
});

// ─────────────── 3.2 — WHAT A RUN OBSERVED, JUDGED (design D3, "The check") ───────────────

unitTest("3.2 an observed tracked path outside the subject is MISSED; the record is excluded by rule; the observer is never reported", () => {
  assert.equal(typeof certification.observationRefusals, "function", "certification.mjs exports no observationRefusals()");
  const tracked = ["scripts/lib/a.mjs", "scripts/lib/hidden.mjs", "openspec/changes/archive/x/tasks.md", ".conductor/state.json",
    "CHANGELOG.md", "docs/parity-ledger.json", "scripts/test/fixtures/observe-reads.mjs", "scripts/test/fixtures/dir/one.txt"];
  const r = certification.observationRefusals({
    tracked,
    subject: ["scripts/lib/a.mjs"],
    observations: [
      { reads: ["scripts/lib/a.mjs", "scripts/lib/hidden.mjs", "openspec/changes/archive/x/tasks.md", "scripts/test/fixtures/observe-reads.mjs", "untracked.txt"] },
      { reads: [".conductor/state.json", "CHANGELOG.md", "docs/parity-ledger.json", "scripts/test/fixtures/dir"] },
    ],
  });
  assert.deepEqual(r.missed, ["docs/parity-ledger.json", "scripts/lib/hidden.mjs", "scripts/test/fixtures/dir/one.txt"],
    "a derivation gap is named; the ledger is NOT the record; a copied directory stands for the tracked files under it");
  assert.deepEqual(r.excluded, [".conductor/state.json", "CHANGELOG.md", "openspec/changes/archive/x/tasks.md"]);
});

unitTest("3.2 an expected Node child that neither arrived nor was cancelled is UNARRIVED; one that did either is not", () => {
  const e = (token) => ({ token, test: "scripts/test/functional/t.test.mjs", argv: ["node", "x.mjs"] });
  const r = certification.observationRefusals({
    tracked: [], subject: [],
    observations: [{ expected: [e("a"), e("b"), e("c")], cancelled: ["c"] }, { arrived: ["a"] }],
  });
  assert.deepEqual(r.unarrived.map((x) => x.token), ["b"]);
});

// ─────────────── Gate 2 G2 — the observation file is an append-only event log ───────────────

const obsLine = (e) => `${JSON.stringify(e)}\n`;
const OBS = obsLine({ kind: "process", pid: 7, argv: ["x.mjs"], test: "scripts/test/functional/t.test.mjs" }) +
  obsLine({ kind: "arrived", token: "a" }) +
  obsLine({ kind: "expected", token: "b", test: "scripts/test/functional/t.test.mjs", argv: ["node", "y.mjs"] }) +
  obsLine({ kind: "cancelled", token: "b" }) +
  obsLine({ kind: "read", path: "scripts/lib/a.mjs" }) +
  obsLine({ kind: "read", path: "scripts/lib/hidden.mjs" });

unitTest("G2 parseObservation() reads every event line into the shape observationRefusals() judges", () => {
  assert.equal(typeof certification.parseObservation, "function", "certification.mjs exports no parseObservation()");
  const o = certification.parseObservation(OBS, "/run/observe/7.aa.jsonl");
  assert.equal(o.pid, 7);
  assert.equal(o.test, "scripts/test/functional/t.test.mjs");
  assert.deepEqual(o.arrived, ["a"]);
  assert.deepEqual(o.expected, [{ token: "b", test: "scripts/test/functional/t.test.mjs", argv: ["node", "y.mjs"] }]);
  assert.deepEqual(o.cancelled, ["b"]);
  assert.deepEqual(o.reads, ["scripts/lib/a.mjs", "scripts/lib/hidden.mjs"]);
  assert.equal(o.torn, false);
  const r = certification.observationRefusals({ observations: [o], subject: ["scripts/lib/a.mjs"], tracked: ["scripts/lib/a.mjs", "scripts/lib/hidden.mjs"] });
  assert.deepEqual(r.missed, ["scripts/lib/hidden.mjs"]);
  assert.deepEqual(r.unarrived, []);
});

unitTest("G2 a torn LAST line — a process killed mid-write — is dropped, and every complete line is kept", () => {
  const torn = OBS + '{"kind":"read","path":"scripts/lib/sec';
  const o = certification.parseObservation(torn, "/run/observe/7.aa.jsonl");
  assert.equal(o.torn, true);
  assert.deepEqual(o.reads, ["scripts/lib/a.mjs", "scripts/lib/hidden.mjs"], "the complete reads survive the torn tail");
  assert.deepEqual(certification.parseObservation("", "e").reads, [], "an empty file is no events");
  assert.equal(certification.parseObservation('{"kind":"proc', "e").torn, true, "a file holding only a torn line is no events");
});

unitTest("G2 any corruption other than a torn last line is REFUSED, naming the file and the line", () => {
  const name = "/run/observe/9.bb.jsonl";
  const lines = OBS.split("\n");
  const middle = [...lines.slice(0, 2), '{"kind":"read","pa', ...lines.slice(2)].join("\n");
  assert.throws(() => certification.parseObservation(middle, name), /\/run\/observe\/9\.bb\.jsonl is corrupt at line 3/,
    "a torn line that is NOT the last is corruption");
  assert.throws(() => certification.parseObservation(OBS + obsLine({ kind: "wrote", path: "x" }), name), /9\.bb\.jsonl is corrupt at line 7/,
    "an unknown event kind is corruption");
  assert.throws(() => certification.parseObservation(OBS + "[1]\n", name), /corrupt at line 7/, "a line that is not an object is corruption");
  assert.throws(() => certification.parseObservation(OBS + "\n", name), /corrupt at line 7/, "an empty complete line is corruption");
});

unitTest("m2 an observation that cannot be read is a NAMED refusal: the error's message (the file and line), and no stack", () => {
  assert.equal(typeof certify.observationReadRefusal, "function", "certify.mjs exports no observationReadRefusal()");
  let err;
  try { certification.parseObservation("not json\n", "/run/observe/3.cc.jsonl"); } catch (e) { err = e; }
  assert.ok(err, "precondition: the parser refuses the damaged file");
  const text = certify.observationReadRefusal("functional half", { pass: 4, tests: 4 }, err);
  assert.match(text, /functional half passed \(4\/4\), but its run-time observation cannot be read/);
  assert.match(text, /\/run\/observe\/3\.cc\.jsonl is corrupt at line 1/, "the refusal names the file and the line");
  assert.match(text, /nothing recorded/);
  assert.doesNotMatch(text, /^\s+at /m, "no stack frame");
});

unitTest("m3 rule 4 admits a file named in a TEMPLATE literal — a backtick opens a string literal too", () => {
  // Gate 2 m3. The spec's rule 4 is "a string literal"; the opening quote class held only `"`, `'` and `/`,
  // so a file spelled only as `` `hidden.mjs` `` — or as the last segment of `` `scripts/lib/hidden.mjs` `` — was not admitted.
  const hidden = "scripts/lib/hidden.mjs";
  const base = { [hidden]: "export const hidden = 1;\n" };
  const whole = subjectOf({ ...base, [FN]: "const f = path.join(root, `hidden.mjs`);\n" });
  assert.ok(whole.has(hidden), "a whole template literal naming the file admits it");
  const segment = subjectOf({ ...base, [FN]: "const f = `scripts/lib/hidden.mjs`;\n" });
  assert.ok(segment.has(hidden), "and so does its last segment inside one");
  const prefix = subjectOf({ ...base, [FN]: "const f = `not-hidden.mjs`;\n" });
  assert.equal(prefix.has(hidden), false, "a longer name ending in the file's name is still not its name");
});

unitTest("S1 rules 5 and 6 admit a shipped root and a root file named in a TEMPLATE literal, as rule 4 does", () => {
  // Gate 2 follow-up (m3's siblings, required task item 1). Rules 5 and 6 carried the same opening class
  // `["'/]` rule 4 had, so a root or a root file spelled only inside a template literal was not admitted.
  const cmd = "commands/status.md";
  const whole = subjectOf({ [cmd]: "# status\n", [FN]: "const d = path.join(root, `commands`);\n" });
  assert.ok(whole.has(cmd), "a shipped root named in a whole template literal admits the files under it");
  const segment = subjectOf({ [cmd]: "# status\n", [FN]: "const d = `commands/status.md`;\n" });
  assert.ok(segment.has(cmd), "and so does a root opening a template literal's path");
  const notRoot = subjectOf({ [cmd]: "# status\n", [FN]: "const d = `subcommands`;\n" });
  assert.equal(notRoot.has(cmd), false, "a longer name ending in the root's name is still not the root");
  const readme = subjectOf({ "README.md": "# pm\n", [FN]: "const r = load(`README.md`);\n" });
  assert.ok(readme.has("README.md"), "a root file named in a whole template literal is admitted");
  const ledger = subjectOf({ "docs/parity-ledger.json": "{}\n", [FN]: "const l = `docs/parity-ledger.json`;\n" });
  assert.ok(ledger.has("docs/parity-ledger.json"), "and so is a root file named as a template literal's last segment");
  const notFile = subjectOf({ "CLAUDE.md": "# c\n", [FN]: "const c = `NOTCLAUDE.md`;\n" });
  assert.equal(notFile.has("CLAUDE.md"), false, "a longer name ending in the root file's name is still not its name");
});

unitTest("m4 the run tree is built from the index copy alone: nothing is copied or exported from the working tree", () => {
  // Gate 2 m4's assertion half: an untracked working-tree file can reach the run only if a step reads the
  // working tree. Every copy is of the index or of its copy, the export is `checkout-index` inside the
  // clone (which writes what its index holds), and no step names the repository's working directory.
  const p = plan();
  const copies = p.steps.filter((s) => s.op === "copy");
  assert.deepEqual(copies.map((s) => s.from), [INPUT.indexFile, p.copy], "the only files copied are the live index, once, and its copy");
  const exported = p.steps.filter((s) => s.op === "git" && s.args.includes("checkout-index"));
  assert.equal(exported.length, 1);
  assert.deepEqual(exported[0].args.slice(0, 2), ["-C", p.tree], "the export writes inside the clone, from the clone's index");
  for (const s of p.steps) {
    if (s.op !== "git") continue;
    for (const a of s.args) {
      assert.ok(a === INPUT.commonDir || !String(a).startsWith(path.dirname(INPUT.commonDir) + path.sep) || String(a).startsWith(INPUT.tmp),
        `a step names a path in the repository's working directory: ${s.args.join(" ")}`);
    }
  }
});
