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
  snapshotRecord, diffRecords, protectedRoots, INHERITED_PROJECT_DIR, PROTECTED, describeLeaks,
} from "../fixtures/record-isolation.mjs";
import { stripComments } from "../js-lexer.mjs";

const TEST_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));   // scripts/test
const REPO = path.resolve(TEST_DIR, "..", "..");
const MODULE = path.join(TEST_DIR, "fixtures", "record-isolation.mjs");
const BUCKETS = ["unit", "assert", "functional", "sweeps"];

/** Relative specifiers of every STATIC import and re-export in `src` (comments stripped first, so a
 *  specifier named in a comment is not an edge). Dynamic `import()` is deliberately not an edge: a
 *  guard reached only through one could load after a test body had already run. */
function staticImports(src, name) {
  const code = stripComments(src, name);
  const out = [];
  const re = /(?:^|[;\n}])\s*(?:import|export)\s+(?:[^'"`;]*?\bfrom\s*)?(["'])(\.{1,2}\/[^"']+)\1/g;
  for (const m of code.matchAll(re)) out.push(m[2]);
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

test("this process is pinned: CLAUDE_PROJECT_DIR is unset, and whatever it held is protected", () => {
  assert.equal(process.env.CLAUDE_PROJECT_DIR, undefined, "the engine's root must fall back to the cwd the caller hands it");
  assert.ok(PROTECTED.includes(REPO), "the repository this suite belongs to is protected");
  if (INHERITED_PROJECT_DIR) assert.ok(PROTECTED.includes(path.resolve(INHERITED_PROJECT_DIR)));
});

test("protectedRoots: this repo, PM_TEST_PROTECTED_ROOT, and an inherited CLAUDE_PROJECT_DIR", () => {
  assert.deepEqual(protectedRoots({ CLAUDE_PROJECT_DIR: "/real/checkout" }, "/suite"), ["/suite", "/real/checkout"]);
  assert.deepEqual(protectedRoots({ PM_TEST_PROTECTED_ROOT: "/real/top" }, "/snapshot"), ["/snapshot", "/real/top"]);
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
  assert.match(src, /await runBucket\(run\.tree, bucket, bucketEnv\(root, /,
    "certify's bucket run no longer passes bucketEnv(root, …): the run over the index copy would guard only the copy");
});

test("describeLeaks names the root and every path, and says what a false positive looks like", () => {
  const text = describeLeaks([{ root: "/real", leaks: [{ path: ".conductor/state.json", change: "changed" }] }]);
  assert.match(text, /\/real\/\.conductor\/state\.json \(changed\)/);
  assert.match(text, /CLAUDE_PROJECT_DIR/);
  assert.match(text, /another session/i);
  assert.equal(describeLeaks([]), "");
});
