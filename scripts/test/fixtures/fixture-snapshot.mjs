// scripts/test/fixtures/fixture-snapshot.mjs
// 3.2 — BUILD ONCE PER FILE, RESTORE PER TEST (0.48.0, design D5).
//
// WHY. `owingRepo()` is defined three times (`assert/gate-guard-write-paths.test.mjs`,
// `assert/reconcile-obligation.test.mjs`, `functional/conformance.test.mjs`) and each CALL rebuilds a
// four-verb repository. Measured: 124.9 ms to build one, and ~1.0 ms to restore a built six-file
// fixture of ≈34.7 KB with `fs.cpSync` (median 1.03–1.15 across n=20, min 0.78, p90 1.26). The
// rebuild is what the file rung's tests do today, thousands of times a run.
//
// WHAT IT IS NOT. Not a codemod target and not "every fixture": the rule is a fixture used by MORE
// THAN ONE TEST IN A FILE. Where a file builds one repository and uses it once, the copy costs more
// than the build and the helper is the wrong tool (design D5's cost discipline).
//
// WHY A COPY AND NOT AN IN-PROCESS STATE OBJECT. The tests that stay on the file rung assert on
// BYTES on disk — a rendered PROJECT.md's parity, the write-conflict log's bytes, the render stamp —
// so the restored thing has to BE a filesystem. The unit rung is the other half of the same idea:
// there the filesystem is replaced by a store, here it is kept and stopped being rebuilt.
//
// THE MUTATION-LEAK HAZARD, AND WHY THE TEMPLATE IS NEVER HANDED OUT. A template a test can mutate
// corrupts every later test in the file, SILENTLY — the later tests pass against a mutated premise.
// So the built tree lives in a `mkdtemp` template that is only ever a SOURCE for a copy, each test
// gets its own copy, and the previous copy is removed before the next one is made. The hazard is the
// same class as the `fs` singleton trap `helpers.mjs:73` already documents, which is why the guard is
// written rather than trusted: `assert/fixture-snapshot.test.mjs` asserts exactly this, with a test
// that mutates a restored tree and a second test that reads the value the fixture was BUILT with.
//
// THE RESTORE PATH PERFORMS NO `fsync` AND STARTS NO ENGINE (3.3, and the requirement states it):
// `cpSync` copies bytes, and the only thing this module calls is `cpSync`, `mkdtempSync` (once per
// file) and `rmSync` (per restoration, of the previous copy).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after } from "node:test";

/** Every template this PROCESS has built and not yet disposed, so 3.5's disposal can be a promise
 *  rather than an intention. Keyed by the template path. */
const TEMPLATES = new Set();

/** Remove one template and forget it. Best effort: a template already gone is not a failure. */
export function disposeTemplate(template) {
  if (!TEMPLATES.has(template)) return false;
  TEMPLATES.delete(template);
  try { fs.rmSync(template, { recursive: true, force: true }); return true; } catch { return false; }
}

/** Remove every template this process still holds. Called by the per-FILE `after()` hook the helper
 *  registers on its first build, and again on process exit as a backstop for a file whose run ends
 *  without the hook firing. */
export function disposeAllTemplates() {
  let n = 0;
  for (const t of [...TEMPLATES]) if (disposeTemplate(t)) n++;
  return n;
}

/** The templates still held — for the disposal test, which has to be able to see one exist. */
export const heldTemplates = () => [...TEMPLATES];

/** Remove every copy a fixture handed out. Best effort, and it reports nothing: a copy already gone
 *  (a test that removed it, an interrupted teardown) is not a failure. */
export function disposeCopies(copies) {
  for (const c of [...copies]) { try { fs.rmSync(c, { recursive: true, force: true }); } catch { /* best effort */ } copies.delete(c); }
}

// THE PROCESS-EXIT BACKSTOP, installed once. It is NOT the primary mechanism (that is the per-file
// `after()` below): a hook that did not fire — an interrupted run, a file that throws during load —
// would otherwise leave its template under the temp dir until the OS cleaner reached it.
let exitHookInstalled = false;
function installExitHook() {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.on("exit", () => { try { disposeAllTemplates(); } catch { /* exiting anyway */ } });
}

/**
 * A fixture built ONCE per FILE, restored per test.
 *
 * `build()` is called at most once, lazily, on the first `acquire()` — not when the factory is
 * called, so a file that declares a fixture it never uses pays nothing. It must return the path of a
 * directory it built (the `tmpRepo()` + verbs shape the three `owingRepo()`s already have).
 *
 * The returned function is what a test calls in place of the old `owingRepo()`:
 *
 *     const owingRepo = fixtureOnce(() => buildAnOwingRepo());
 *     test("…", () => { const cwd = owingRepo(); … });
 *
 * Each call hands back a FRESH directory containing a copy of the built tree, and removes the copy it
 * handed out last. Two calls in the same test are legal and give two independent trees.
 */
export function fixtureOnce(build, { name = "pm-fixture" } = {}) {
  // A SLOT RATHER THAN A LOCAL, because the teardown below is registered BEFORE the template exists.
  const slot = { template: null, copies: new Set() };
  // THE PER-FILE TEARDOWN, registered at FACTORY-CREATION TIME, which is MODULE SCOPE of the file
  // that declares the fixture — and that timing is the whole trick. A test file writes
  // `const owingRepo = fixtureOnce(…)` at the top level, so this `after()` is a FILE-level hook; the
  // first draft registered it on the first BUILD, which happens inside a test, and node:test scopes
  // an `after()` called there to THAT TEST. The file's second test then found its template already
  // disposed — caught by this file's own leak test, which is what it is for.
  // THE FILE'S TEARDOWN DISPOSES THE TEMPLATE AND EVERY COPY THIS FIXTURE HANDED OUT. Tracking the
  // copies rather than pruning the previous one is a MEASURED correction, not a simplification: the
  // first draft removed the copy it handed out last, on the next acquire, and the conformance set's
  // reconcile row legitimately builds TWO fixtures before using either —
  //
  //     const cwdForProcess = row.setup();      // acquire #1
  //     const cwdForInProcess = row.setup();    // acquire #2, which removed #1's directory
  //     const viaProcess = asProcess(cwdForProcess, …);   // spawnSync cwd: gone  → status null
  //
  // — because that test compares TWO ROUTES against two identical trees on purpose (half these
  // classes mutate what they are run against, so one tree cannot serve both). It failed as
  // `EXITED status null`, which is a child that never started. Removal therefore belongs at the
  // FILE's end, where it also covers the copies a file never gets round to releasing.
  try { after(() => { disposeTemplate(slot.template); disposeCopies(slot.copies); }); } catch { /* not a test context */ }
  const acquire = () => {
    if (slot.template === null) {
      // BUILT INTO A TEMPLATE, and the measurement is why it is a directory at all: the fixture is a
      // repository on disk that the engine's own verbs built, so the snapshot has to be a tree.
      const template = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-template-`));
      slot.template = template;
      installExitHook();
      TEMPLATES.add(template);
      const built = build();
      // INTO THE TEMPLATE, and the build's own directory is then removed: the built tree is the
      // TEMPLATE's contents, never handed out, so no test can mutate it.
      const inner = path.join(template, "tree");
      fs.mkdirSync(inner, { recursive: true });
      for (const entry of fs.readdirSync(built)) {
        fs.cpSync(path.join(built, entry), path.join(inner, entry), { recursive: true });
      }
      try { fs.rmSync(built, { recursive: true, force: true }); } catch { /* best effort */ }
    }
    const handed = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
    slot.copies.add(handed);
    fs.cpSync(path.join(slot.template, "tree"), handed, { recursive: true });
    return handed;
  };
  /** The template path, for a test that wants to assert it was never handed out. Null until built. */
  acquire.template = () => slot.template;
  return acquire;
}
