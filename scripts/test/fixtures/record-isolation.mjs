// scripts/test/fixtures/record-isolation.mjs
// test-isolation-guard — NO TEST MAY WRITE THE DEVELOPER'S REAL `.conductor` RECORD.
//
// A SIDE-EFFECT MODULE, like `hermetic-git.mjs`, loaded by every process the suite starts: every unit-
// and file-rung file through `assert-git-shim.mjs`, the functional half through `helpers.mjs`, the
// sweep bucket directly. `assert/record-isolation.test.mjs` refuses, by name, a test file of any bucket
// whose static imports never reach it.
//
// WHY. The engine resolves its root as `CLAUDE_PROJECT_DIR || cwd` (`scripts/lib/invocation.mjs`), and a
// Claude Code session exports `CLAUDE_PROJECT_DIR` at the developer's checkout. So any test that spawns
// the engine, or calls it in process, with an environment built from `...process.env` and no override
// acts on the developer's own repository. On 2026-09-21 a functional run leaked two junk epics
// (`alpha`, `from-caller`) and 554 `honcho-memories.log` lines into this repository's real record, and
// nothing noticed until a person read the record.
//
// WHAT IT DOES, per process:
//   1. PROTECTS, at import, the `.conductor/` of: the repository this module belongs to; the root in
//      `PM_TEST_PROTECTED_ROOT` (the pre-commit hook and certify run the suite over a COPY — the index
//      snapshot, the run tree — so the module-relative root there is the copy, and they name the real
//      top level through this variable); and an inherited `CLAUDE_PROJECT_DIR`.
//      Each is snapshotted as relative path → sha256 of every regular file (absent is a state too).
//   2. PINS `CLAUDE_PROJECT_DIR` UNSET — the environment CI runs in. With it unset the engine's root is
//      the cwd the caller hands it, so a test that forgets to name a root acts on its own cwd, never on
//      the checkout a Claude Code session exported. WHY UNSET AND NOT A SCRATCH DIRECTORY (measured on
//      the functional half, test-isolation-guard task 3): a scratch pin broke nine tests and one whole
//      file — conductor-13 16.3, conductor-15 9.2–9.5 and gate-artifact-evidence call lib functions
//      directly and rely on `CLAUDE_PROJECT_DIR || cwd` resolving to the repository they run in. Unset,
//      the functional half fails exactly as it does without the guard.
//      A test whose cwd IS a protected repository can still write it through the fallback; step 3 is
//      what catches that.
//   3. AT EXIT, snapshots again. Any file added, changed or removed under a protected record is
//      written to stderr by path and the process exits 1 — which the runner reports as
//      `✖ <file> … 'test failed'` and a failed run (the mechanism `assert-git-shim.mjs` measured on
//      Node 22, 24 and 26).
//
// IT NEVER RESTORES the record. A restore could clobber a LEGITIMATE concurrent write — the same
// developer's session recording work while the suite runs — and would erase the evidence of the leak.
// That concurrent write is also this guard's one false positive; the message says so.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SUITE_REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** The roots whose `.conductor/` this process must leave byte-identical, de-duplicated, suite first. */
export function protectedRoots(env, suiteRepo) {
  const roots = [suiteRepo, env.PM_TEST_PROTECTED_ROOT, env.CLAUDE_PROJECT_DIR];
  const out = [];
  for (const r of roots) {
    if (!r) continue;
    const abs = path.resolve(r);
    if (!out.includes(abs)) out.push(abs);
  }
  return out;
}

/** `{ "<.conductor/rel>": sha256 }` for every regular file under `<root>/.conductor/`; an absent
 *  record is the empty object. Symlinks are recorded by their target text, never followed. */
export function snapshotRecord(root) {
  const out = {};
  const walk = (abs, rel) => {
    let entries;
    try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const a = path.join(abs, e.name), r = `${rel}/${e.name}`;
      try {
        if (e.isDirectory()) walk(a, r);
        else if (e.isSymbolicLink()) out[r] = `symlink:${fs.readlinkSync(a)}`;
        else if (e.isFile()) out[r] = crypto.createHash("sha256").update(fs.readFileSync(a)).digest("hex");
      } catch { out[r] = "unreadable"; }
    }
  };
  walk(path.join(root, ".conductor"), ".conductor");
  return out;
}

/** Every path that differs between two snapshots, sorted: `added`, `changed` or `removed`. */
export function diffRecords(before, after) {
  const paths = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  const out = [];
  for (const p of paths) {
    if (!(p in before)) out.push({ path: p, change: "added" });
    else if (!(p in after)) out.push({ path: p, change: "removed" });
    else if (before[p] !== after[p]) out.push({ path: p, change: "changed" });
  }
  return out;
}

/** The exit message for `[{ root, leaks }]`; empty when nothing leaked. */
export function describeLeaks(found) {
  const hit = found.filter((f) => f.leaks.length);
  if (!hit.length) return "";
  return "\nrecord-isolation: a test WROTE THE DEVELOPER'S REAL RECORD — no test may (test-isolation-guard):\n" +
    hit.flatMap(({ root, leaks }) => leaks.slice(0, 20).map((l) => `  ${path.join(root, l.path)} (${l.change})\n`)).join("") +
    "Every test process runs with CLAUDE_PROJECT_DIR unset, so a write here came through a literal path, a " +
    "path derived from import.meta.url, or an engine call whose cwd is the repository. Give the engine a " +
    "fixture root (tmpRepo(), and CLAUDE_PROJECT_DIR set to it). The record was NOT restored: inspect it " +
    "(git diff .conductor) and remove what the test added. If another session wrote this record while the " +
    "suite ran, this is that write and not a leak — re-run the file.\n";
}

export const PROTECTED = protectedRoots(process.env, SUITE_REPO);
const BEFORE = PROTECTED.map((root) => ({ root, snap: snapshotRecord(root) }));

/** What `CLAUDE_PROJECT_DIR` held when this process started — protected above, then unset. */
export const INHERITED_PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR;
delete process.env.CLAUDE_PROJECT_DIR;

/** The exit listener: compare every protected record with its import-time snapshot and fail the file
 *  on any difference. Exported so a test can call it on purpose. */
export function onExit() {
  const text = describeLeaks(BEFORE.map(({ root, snap }) => ({ root, leaks: diffRecords(snap, snapshotRecord(root)) })));
  if (!text) return;
  process.stderr.write(text);
  process.exitCode = 1;
}

process.on("exit", onExit);
