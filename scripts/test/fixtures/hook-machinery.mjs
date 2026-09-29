// scripts/test/fixtures/hook-machinery.mjs
// WHAT A HOOK FIXTURE COPIES, DERIVED FROM THE HOOKS THEMSELVES (hook-fixtures-couple-to-every-hook-step).
//
// A fixture that runs the REAL `.githooks/*` (so the hook is exercised, not a stub) must hold every
// script those hooks run and every module those scripts reach. Until this module, five builders typed
// that set by hand, and every addition had to be mirrored into them: a hook STEP (the drift script,
// 6.4), an IMPORT inside a script the hook runs (`js-lexer.mjs`, certification-record-redesign 3.1), a
// hook FILE (`commit-msg`, D4), a module certify loads by path (`observe-reads.mjs`, 3.2). Each time,
// unrelated tests went red pointing at the hook — about half an hour of diagnosis for a one-line hook
// insertion (the epic's own measurement). Nothing here names a script: the set is READ from the hooks'
// code and walked through the scripts' imports, so a new step, import or hook file is picked up with no
// edit anywhere. `assert/hook-machinery.test.mjs` proves all three shapes over in-memory readers.
//
// Every function takes injectable readers (`root`, `readFile`, `exists`, `readdir`, `isExecutable`),
// defaulting to this repository on disk.

import fs from "node:fs";
import path from "node:path";
import { REPO, relativeImports } from "../certification.mjs";
import { stripComments } from "../js-lexer.mjs";

export const HOOKS_DIR = ".githooks";

const DEFAULT_READERS = {
  root: REPO,
  readFile: (abs) => fs.readFileSync(abs, "utf8"),
  exists: (abs) => fs.existsSync(abs),
  readdir: (abs) => fs.readdirSync(abs),
  isExecutable: (abs) => { const s = fs.statSync(abs); return s.isFile() && (s.mode & 0o111) !== 0; },
};
const readersOf = (r = {}) => ({ ...DEFAULT_READERS, ...r });

/** Every hook git would run from `.githooks/`: its EXECUTABLE files, sorted. A new hook file is installed
 *  by a fixture with no edit here; a stray non-executable file (a `.DS_Store`) is not a hook. */
export function hookNames(readers) {
  const { root, readdir, isExecutable } = readersOf(readers);
  return readdir(path.join(root, HOOKS_DIR)).filter((n) => isExecutable(path.join(root, HOOKS_DIR, n))).sort();
}

/** The repository scripts a hook's CODE spells: every `scripts/….mjs` path, after shell comments are
 *  stripped (a `#` at a line's start or after whitespace, to the end of the line — the pre-commit hook's
 *  prose names scripts it never runs). A path after a variable prefix (`"$SNAP/scripts/test/drift.mjs"`)
 *  counts; a glob (`scripts/test/unit/*.test.mjs`) is no script. ITS LIMIT: a `#` after whitespace inside
 *  a quoted string is read as a comment — the hooks hold none today, and missing a step fails the
 *  fixture loudly rather than silently. Sorted, de-duplicated. */
export function hookInvokedScripts(text) {
  const code = text.split("\n").map((line) => line.replace(/(^|\s)#.*$/, "$1")).join("\n");
  return [...new Set([...code.matchAll(/(?<![A-Za-z0-9_.-])(scripts\/[A-Za-z0-9_./-]+\.mjs)(?![A-Za-z0-9_])/g)].map((m) => m[1]))].sort();
}

/** THE CLOSURE OF `roots`: each root, every module it reaches by a relative import (certification's own
 *  walker, `relativeImports()` — one regex for the functional subject and the fixtures), and every
 *  `scripts/test/….mjs` path a reached file spells as a whole string literal in its CODE (comments
 *  stripped by the shared lexer) — which is how certify reaches the module it loads by path
 *  (`OBSERVER`, `fixtures/observe-reads.mjs`). Only `scripts/test/` literals are followed: the engine
 *  entry point those scripts spell is DATA to them (a subject root), never run by a hook, and a fixture
 *  that needs an engine builds its own. A ROOT that does not exist THROWS, naming it — a hook running
 *  a missing script is a gap to name, not to copy around. Sorted. */
export function scriptClosure(roots, readers) {
  const { root, readFile, exists } = readersOf(readers);
  for (const r of roots) {
    if (!exists(path.join(root, r))) throw new Error(`hook-machinery: ${r} is run but does not exist in ${root}`);
  }
  const LITERAL = /["'`](scripts\/test\/[A-Za-z0-9_./-]+\.mjs)["'`]/g;
  const seen = new Set();
  const stack = [...roots];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f) || !exists(path.join(root, f))) continue;
    seen.add(f);
    const text = readFile(path.join(root, f));
    const next = [...relativeImports(text, f), ...[...stripComments(text, f).matchAll(LITERAL)].map((m) => m[1])];
    for (const t of next) if (!seen.has(t)) stack.push(t);
  }
  return [...seen].sort();
}

/** Everything the hooks in `.githooks/` run, and everything that reaches. What a hook fixture copies. */
export function hookMachinery(readers) {
  const r = readersOf(readers);
  const roots = new Set();
  for (const h of hookNames(r)) for (const s of hookInvokedScripts(r.readFile(path.join(r.root, HOOKS_DIR, h)))) roots.add(s);
  return scriptClosure([...roots].sort(), r);
}

/** Everything `scripts/test/certify.mjs` reaches. What a certify fixture copies. */
export function certifyMachinery(readers) {
  return scriptClosure(["scripts/test/certify.mjs"], readers);
}

/** Copies `rels` from this repository (or `from`) into `cwd`, creating directories. Returns `rels`. */
export function copyInto(cwd, rels, { from = REPO } = {}) {
  for (const rel of rels) {
    fs.mkdirSync(path.dirname(path.join(cwd, rel)), { recursive: true });
    fs.copyFileSync(path.join(from, rel), path.join(cwd, rel));
  }
  return rels;
}
