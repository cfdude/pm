// scripts/test/assert/record-isolation.test.mjs
// test-isolation-guard — THE ASSERTION TWIN of scripts/test/functional/record-isolation.test.mjs.
//
// NO TEST MAY WRITE THE DEVELOPER'S REAL `.conductor` RECORD. On 2026-09-21 a functional run leaked
// two junk epics (`alpha`, `from-caller`) and 554 `honcho-memories.log` lines into the real
// repository's record, because the engine resolves its root as `CLAUDE_PROJECT_DIR || cwd` and a
// Claude Code session exports `CLAUDE_PROJECT_DIR` at the developer's checkout. Nothing noticed until
// a person read the record. `fixtures/record-isolation.mjs` unsets the variable in every test
// process and proves the real record byte-identical at exit; this file holds the two things that can
// be checked without starting a process:
//
//   * THE WIRING — every tracked test file of all four buckets (unit, assert, functional, sweeps)
//     reaches the module through its STATIC relative-import closure. A guard only some processes load
//     guards only those processes, and the file that skips it is exactly the one nobody is watching.
//   * THE PURE HALF — the snapshot and the comparison the exit listener runs, on scratch records.
//
// The functional twin runs the listener for real: a child `node --test` whose test writes a protected
// record is reported `✖` and exits 1.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { removeAtExit } from "../fixtures/assert-git-shim.mjs";
import {
  snapshotRecord, diffRecords, protectedRoots, PINNED_ROOT, PROTECTED, describeLeaks, ROOT_FILES, skipped,
  mtimeNote, SESSION_BOOKKEEPING, sessionBookkeeping,
} from "../fixtures/record-isolation.mjs";
import { lex } from "../js-lexer.mjs";

const TEST_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));   // scripts/test
const REPO = path.resolve(TEST_DIR, "..", "..");
const MODULE = path.join(TEST_DIR, "fixtures", "record-isolation.mjs");
const BUCKETS = ["unit", "assert", "functional", "sweeps"];

/** Relative specifiers of every STATIC import and re-export in `src`, read from the shared lexer's
 *  TOKENS rather than from text: a comment is not a token, and a string or template is ONE token whose
 *  contents are never scanned — so `const s = 'import "./guard.mjs"'` is a decoy, not an edge (a test
 *  file holding the import text only inside a string passed a text match and leaked). An edge is an
 *  `import`/`export` keyword at the top level (not `import(` and not `import.meta`) whose specifier
 *  string follows `from`, or follows `import` directly (a bare side-effect import). Dynamic `import()`
 *  is deliberately not an edge: a guard reached only through one could load after a test body had
 *  already run. Fails closed on a lexer misparse, like every other reader of the lexer. */
function staticImports(src, name) {
  const { contexts, misparse } = lex(src);
  if (misparse.length) throw new Error(`js-lexer: ${name}:${misparse[0].line}: ${misparse[0].what}`);
  const toks = contexts[0].tokens;
  const text = (t) => (t && (t.kind === "ident" || t.kind === "punct") ? t.text : undefined);
  const out = [];
  for (let i = 0; i < toks.length; i++) {
    const kw = text(toks[i]);
    if (kw !== "import" && kw !== "export") continue;
    if (text(toks[i - 1]) === ".") continue;                              // x.import
    if (kw === "import" && ["(", "."].includes(text(toks[i + 1]))) continue;   // import(…), import.meta
    for (let j = i + 1; j < toks.length; j++) {
      if (text(toks[j]) === ";" || text(toks[j]) === "import" || text(toks[j]) === "export") break;
      if (toks[j].kind === "template") break;
      if (toks[j].kind !== "string") continue;
      const prev = text(toks[j - 1]);
      if (prev === "from" || (kw === "import" && j === i + 1)) {
        const spec = src.slice(toks[j].start + 1, toks[j].end - 1);
        if (/^\.{1,2}\//.test(spec)) out.push(spec);
      }
      break;
    }
  }
  return out;
}

/** Each file's resolved static imports, parsed once per process — the engine's modules are reached
 *  from almost every test file, and lexing them again per file costs tens of seconds. */
const edges = new Map();
function importsOf(file) {
  if (!edges.has(file)) {
    let src = null;
    try { src = fs.readFileSync(file, "utf8"); } catch { /* not a file: no edges */ }
    edges.set(file, src === null ? [] : staticImports(src, file).map((spec) => path.resolve(path.dirname(file), spec)));
  }
  return edges.get(file);
}

/** Does `file`'s static relative-import closure reach `target`? */
function reaches(file, target, seen = new Set()) {
  if (file === target) return true;
  if (seen.has(file)) return false;
  seen.add(file);
  return importsOf(file).some((next) => reaches(next, target, seen));
}

const scratch = (prefix) => removeAtExit(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));

test("every test file of every bucket loads the record-isolation guard through its static imports", () => {
  const missing = [];
  let seen = 0;
  for (const bucket of BUCKETS) {
    const dir = path.join(TEST_DIR, bucket);
    for (const name of fs.readdirSync(dir).filter((n) => n.endsWith(".test.mjs")).sort()) {
      seen++;
      if (!reaches(path.join(dir, name), MODULE)) missing.push(`scripts/test/${bucket}/${name}`);
    }
  }
  assert.ok(seen > 200, `the walk saw ${seen} test files — it must see every bucket`);
  assert.deepEqual(missing, [],
    "these test files never load scripts/test/fixtures/record-isolation.mjs, so nothing pins " +
    "CLAUDE_PROJECT_DIR in their process and nothing checks the real record at exit. Import a fixture " +
    "that loads it (assert-git-shim.mjs, functional-harness.mjs / helpers.mjs), or the module itself");
});

test("the closure walk is not vacuous: an unrelated file does not reach the guard, a comment is not an import", () => {
  const dir = scratch("pm-record-isolation-walk-");
  fs.writeFileSync(path.join(dir, "a.test.mjs"), `// import "${MODULE}";\nimport "./b.mjs";\n`);
  fs.writeFileSync(path.join(dir, "b.mjs"), "export const b = 1;\n");
  fs.writeFileSync(path.join(dir, "c.test.mjs"), `import { x } from "./d.mjs";\n`);
  const rel = path.relative(dir, MODULE);
  assert.ok(rel.startsWith("../"), `a relative specifier: ${rel}`);
  fs.writeFileSync(path.join(dir, "d.mjs"), `export { PROTECTED as x } from ${JSON.stringify(rel)};\n`);
  assert.equal(reaches(path.join(dir, "a.test.mjs"), MODULE), false);
  assert.equal(reaches(path.join(dir, "c.test.mjs"), MODULE), true, "a re-export chain is an edge");
});

test("the closure walk is not vacuous: an import written only inside a string or a template is a decoy, not an edge", () => {
  const dir = scratch("pm-record-isolation-decoy-");
  const rel = JSON.stringify(path.relative(dir, MODULE));
  fs.writeFileSync(path.join(dir, "s.test.mjs"), `const decoy = 'import ${rel.replace(/'/g, "")};';\nexport const n = 1;\n`);
  fs.writeFileSync(path.join(dir, "t.test.mjs"), `const decoy = \`\nimport ${rel};\n\`;\nexport const n = 1;\n`);
  fs.writeFileSync(path.join(dir, "u.test.mjs"), `const m = await import(${rel});\nexport const n = 1;\n`);
  fs.writeFileSync(path.join(dir, "v.test.mjs"), `import ${rel};\n`);
  assert.equal(reaches(path.join(dir, "s.test.mjs"), MODULE), false, "a quoted-string decoy");
  assert.equal(reaches(path.join(dir, "t.test.mjs"), MODULE), false, "a template decoy spanning lines");
  assert.equal(reaches(path.join(dir, "u.test.mjs"), MODULE), false, "a dynamic import() is not a static edge");
  assert.equal(reaches(path.join(dir, "v.test.mjs"), MODULE), true, "and the real side-effect import still is");
});

test("this process is pinned: CLAUDE_PROJECT_DIR is an empty scratch directory, never a protected root", () => {
  assert.equal(process.env.CLAUDE_PROJECT_DIR, PINNED_ROOT);
  assert.equal(process.env.PM_TEST_PINNED_ROOT, PINNED_ROOT);
  assert.deepEqual(fs.readdirSync(PINNED_ROOT), [], "the pin is empty — not a conductor");
  assert.ok(PROTECTED.includes(REPO), "the repository this suite belongs to is protected");
  assert.ok(!PROTECTED.includes(PINNED_ROOT));
});

test("protectedRoots: this repo, PM_TEST_PROTECTED_ROOT, and an inherited CLAUDE_PROJECT_DIR — never a parent's pin", () => {
  assert.deepEqual(protectedRoots({ CLAUDE_PROJECT_DIR: "/real/checkout" }, "/suite"), ["/suite", "/real/checkout"]);
  assert.deepEqual(protectedRoots({ PM_TEST_PROTECTED_ROOT: "/real/top" }, "/snapshot"), ["/snapshot", "/real/top"]);
  assert.deepEqual(protectedRoots({ CLAUDE_PROJECT_DIR: "/tmp/pin", PM_TEST_PINNED_ROOT: "/tmp/pin" }, "/suite"), ["/suite"],
    "a nested test process inherits its parent's pin, which is scratch, not a record anybody owns");
  assert.deepEqual(protectedRoots({ CLAUDE_PROJECT_DIR: "/suite/", PM_TEST_PROTECTED_ROOT: "/suite" }, "/suite"), ["/suite"]);
  assert.deepEqual(protectedRoots({}, "/suite"), ["/suite"]);
});

test("snapshot + diff: an untouched record compares equal; an added, changed or removed file is named", () => {
  const root = scratch("pm-record-isolation-snap-");
  const rec = path.join(root, ".conductor");
  fs.mkdirSync(path.join(rec, "feedback"), { recursive: true });
  fs.writeFileSync(path.join(rec, "state.json"), "{\"epics\":[]}\n");
  fs.writeFileSync(path.join(rec, "feedback", "a.md"), "x");
  fs.writeFileSync(path.join(rec, "gone.log"), "y");
  const before = snapshotRecord(root);
  assert.deepEqual(diffRecords(before, snapshotRecord(root)), []);

  fs.writeFileSync(path.join(rec, "state.json"), "{\"epics\":[{\"id\":\"alpha\"}]}\n");
  fs.appendFileSync(path.join(rec, "honcho-memories.log"), "paused X for Y\n");
  fs.rmSync(path.join(rec, "gone.log"));
  assert.deepEqual(diffRecords(before, snapshotRecord(root)), [
    { path: ".conductor/gone.log", change: "removed" },
    { path: ".conductor/honcho-memories.log", change: "added" },
    { path: ".conductor/state.json", change: "changed" },
  ]);
});

test("snapshot + diff: the root files the engine writes are fingerprinted too — PROJECT.md, CLAUDE.md, .gitignore", () => {
  // Fingerprinted by lstat, never read: see snapshotRecord — certify's observer refuses a functional
  // run that reads a tracked file outside its subject, and PROJECT.md and .gitignore are outside it.
  assert.deepEqual(ROOT_FILES, ["PROJECT.md", "CLAUDE.md", ".gitignore"]);
  const root = scratch("pm-record-isolation-rootfiles-");
  fs.writeFileSync(path.join(root, "CLAUDE.md"), "# rules\n");
  fs.writeFileSync(path.join(root, ".gitignore"), "node_modules\n");
  fs.writeFileSync(path.join(root, "README.md"), "not the engine's\n");
  const before = snapshotRecord(root);
  fs.appendFileSync(path.join(root, "CLAUDE.md"), "<!-- pm:rules -->\n");
  fs.writeFileSync(path.join(root, "PROJECT.md"), "# Project\n");
  fs.rmSync(path.join(root, ".gitignore"));
  fs.appendFileSync(path.join(root, "README.md"), "outside the hashed set\n");
  assert.deepEqual(diffRecords(before, snapshotRecord(root)), [
    { path: ".gitignore", change: "removed" },
    { path: "CLAUDE.md", change: "changed" },
    { path: "PROJECT.md", change: "added" },
  ]);
});

test("snapshot: .DS_Store and every *.lock are skipped — the OS's file and the commit-nudge transient", () => {
  assert.equal(skipped(".DS_Store"), true);
  assert.equal(skipped("commit-observe.json.lock"), true);
  assert.equal(skipped("state.json"), false);
  assert.equal(skipped("locks.json"), false);
  const root = scratch("pm-record-isolation-skip-");
  fs.mkdirSync(path.join(root, ".conductor", "feedback"), { recursive: true });
  fs.writeFileSync(path.join(root, ".conductor", "state.json"), "{}");
  const before = snapshotRecord(root);
  fs.writeFileSync(path.join(root, ".conductor", "commit-observe.json.lock"), "123");
  fs.writeFileSync(path.join(root, ".conductor", ".DS_Store"), "x");
  fs.writeFileSync(path.join(root, ".conductor", "feedback", ".DS_Store"), "x");
  assert.deepEqual(diffRecords(before, snapshotRecord(root)), []);
});

test("snapshot: a live session's hook bookkeeping is left out of the walk; the durable record is not", () => {
  // The files a LIVE Claude Code session's hooks rewrite on every tool call, never the record of work:
  // before this exclusion every file of the pre-commit assertion half failed on commit-observe.json
  // whenever any session was active in the checkout.
  assert.deepEqual(SESSION_BOOKKEEPING, [
    ".conductor/commit-observe.json*", ".conductor/commit-watch.json", ".conductor/session-claim.json*",
    ".conductor/brief.txt", ".conductor/activity/", ".conductor/agent-logs/",
  ]);
  for (const rel of [".conductor/commit-observe.json", ".conductor/commit-observe.json.tmp-42",
    ".conductor/commit-watch.json", ".conductor/session-claim.json", ".conductor/session-claim.json.tmp-1",
    ".conductor/brief.txt", ".conductor/activity", ".conductor/activity/2026-09-29.jsonl",
    ".conductor/agent-logs", ".conductor/agent-logs/a.jsonl"]) {
    assert.equal(sessionBookkeeping(rel), true, rel);
  }
  for (const rel of [".conductor/state.json", ".conductor/render-stamp.json", ".conductor/detours.log",
    ".conductor/honcho-memories.log", ".conductor/feedback/a.md", ".conductor/feedback/brief.txt",
    ".conductor/feedback/activity/x", ".conductor/brief.txt.bak", ".conductor/commit-watch.json.old",
    ".conductor/activity-other", "PROJECT.md"]) {
    assert.equal(sessionBookkeeping(rel), false, rel);
  }
  const root = scratch("pm-record-isolation-session-");
  const rec = path.join(root, ".conductor");
  fs.mkdirSync(path.join(rec, "feedback"), { recursive: true });
  for (const f of ["state.json", "render-stamp.json", "detours.log", "honcho-memories.log", "commit-observe.json", "brief.txt"]) {
    fs.writeFileSync(path.join(rec, f), "before\n");
  }
  const before = snapshotRecord(root);
  fs.writeFileSync(path.join(rec, "commit-observe.json"), "after\n");
  fs.writeFileSync(path.join(rec, "commit-observe.json.tmp-99"), "x");
  fs.writeFileSync(path.join(rec, "commit-watch.json"), "{}");
  fs.writeFileSync(path.join(rec, "session-claim.json"), "{}");
  fs.writeFileSync(path.join(rec, "brief.txt"), "after\n");
  fs.mkdirSync(path.join(rec, "activity"));
  fs.writeFileSync(path.join(rec, "activity", "seg.jsonl"), "{}\n");
  fs.mkdirSync(path.join(rec, "agent-logs"));
  fs.writeFileSync(path.join(rec, "agent-logs", "a.jsonl"), "{}\n");
  assert.deepEqual(diffRecords(before, snapshotRecord(root)), [], "session bookkeeping alone is not a leak");

  for (const f of ["state.json", "render-stamp.json", "detours.log", "honcho-memories.log"]) {
    fs.writeFileSync(path.join(rec, f), "after\n");
  }
  fs.writeFileSync(path.join(rec, "feedback", "brief.txt"), "a nested name is not the session's brief");
  assert.deepEqual(diffRecords(before, snapshotRecord(root)), [
    { path: ".conductor/detours.log", change: "changed" },
    { path: ".conductor/feedback/brief.txt", change: "added" },
    { path: ".conductor/honcho-memories.log", change: "changed" },
    { path: ".conductor/render-stamp.json", change: "changed" },
    { path: ".conductor/state.json", change: "changed" },
  ]);
});

test("snapshot + diff: a record that did not exist and now does is a leak; one that stays absent is not", () => {
  const root = scratch("pm-record-isolation-absent-");
  const before = snapshotRecord(root);
  assert.deepEqual(diffRecords(before, snapshotRecord(root)), []);
  fs.mkdirSync(path.join(root, ".conductor"));
  fs.writeFileSync(path.join(root, ".conductor", "state.json"), "{}");
  assert.deepEqual(diffRecords(before, snapshotRecord(root)), [{ path: ".conductor/state.json", change: "added" }]);
});

test("the pre-commit hook's run over the INDEX SNAPSHOT protects the real checkout, not only the copy", () => {
  // The hook runs the assertion half from `$SNAP`, an export of the index, so the guard's
  // module-relative root there is the copy. The real top level reaches every test process only
  // through this export, and it must be in place BEFORE the runner starts.
  const hook = fs.readFileSync(path.join(REPO, ".githooks", "pre-commit"), "utf8");
  const exportAt = hook.search(/^export PM_TEST_PROTECTED_ROOT="\$ROOT"$/m);
  const rootAt = hook.search(/^ROOT=\$PWD$/m);
  const cdSnapAt = hook.search(/^cd "\$SNAP"$/m);
  const runnerAt = hook.search(/^if FORCE_COLOR=0 node --test /m);
  assert.ok(exportAt > 0, ".githooks/pre-commit no longer exports PM_TEST_PROTECTED_ROOT=\"$ROOT\"");
  assert.ok(rootAt > 0 && rootAt < exportAt, "the export must follow ROOT's assignment, or it names nothing");
  assert.ok(exportAt < cdSnapAt && cdSnapAt < runnerAt, "the export must precede the move into the snapshot and the runner");
});

test("certify hands every bucket run the real top level, and the observer's variables still ride along", async () => {
  const { bucketEnv } = await import("../certify.mjs");
  assert.deepEqual(bucketEnv("/real/top"), { PM_TEST_PROTECTED_ROOT: "/real/top" });
  assert.deepEqual(bucketEnv("/real/top", { NODE_OPTIONS: "--import=x" }),
    { PM_TEST_PROTECTED_ROOT: "/real/top", NODE_OPTIONS: "--import=x" });
  const src = fs.readFileSync(path.join(TEST_DIR, "certify.mjs"), "utf8");
  assert.match(src, /bucketEnv\(root, [^\n]*\n\s*let result = await runBucket\(run\.tree, bucket, env\)/,
    "certify's bucket run no longer passes bucketEnv(root, …): the run over the index copy would guard only the copy");
});

test("describeLeaks names the root and every path, and says what a false positive looks like", () => {
  const root = scratch("pm-record-isolation-describe-");
  fs.mkdirSync(path.join(root, ".conductor"));
  fs.writeFileSync(path.join(root, ".conductor", "state.json"), "{}");
  const text = describeLeaks([{ root, leaks: [
    { path: ".conductor/state.json", change: "changed" },
    { path: ".conductor/gone.log", change: "removed" },
  ] }], Date.now() - 60_000);
  assert.ok(text.includes(`${path.join(root, ".conductor", "state.json")} (changed; mtime `), text);
  assert.match(text, /s after this process started\)/, "the mtime is read against the process's start");
  assert.ok(text.includes(`${path.join(root, ".conductor", "gone.log")} (removed; no mtime`), text);
  assert.match(text, /CLAUDE_PROJECT_DIR is pinned/);
  assert.match(text, /this file or one running alongside it, or another pm process/);
  assert.equal(describeLeaks([]), "");
});

test("mtimeNote: before or after the process's start, and absent for a removed path", () => {
  const root = scratch("pm-record-isolation-mtime-");
  const f = path.join(root, "x");
  fs.writeFileSync(f, "x");
  const now = fs.statSync(f).mtimeMs;
  assert.match(mtimeNote(f, now - 5000), /5\.0s after this process started$/);
  assert.match(mtimeNote(f, now + 5000), /5\.0s before this process started$/);
  assert.match(mtimeNote(path.join(root, "nope"), now), /^no mtime/);
});
