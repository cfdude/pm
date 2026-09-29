// scripts/test/fixtures/record-isolation.mjs
// test-isolation-guard — NO TEST MAY WRITE THE DEVELOPER'S REAL `.conductor` RECORD.
//
// A SIDE-EFFECT MODULE, like `hermetic-git.mjs`, loaded by every process the suite starts: every unit-
// and file-rung file through `assert-git-shim.mjs`, the functional half through `helpers.mjs`, the
// sweep bucket and a few functional files directly. `assert/record-isolation.test.mjs` refuses, by
// name, a test file of any bucket whose static imports never reach it.
//
// WHY. The engine resolves its root as `CLAUDE_PROJECT_DIR || cwd` (`scripts/lib/invocation.mjs`), and a
// Claude Code session exports `CLAUDE_PROJECT_DIR` at the developer's checkout. So any test that spawns
// the engine, or calls it in process, with an environment built from `...process.env` and no override
// acts on the developer's own repository. On 2026-09-21 a functional run leaked two junk epics
// (`alpha`, `from-caller`) and 554 `honcho-memories.log` lines into this repository's real record, and
// nothing noticed until a person read the record.
//
// WHAT IT DOES, per process:
//   1. PROTECTS, at import, three roots: the repository this module belongs to; `PM_TEST_PROTECTED_ROOT`
//      (the pre-commit hook and certify run the suite over a COPY — the index snapshot, the run tree —
//      so the module-relative root there is the copy, and they name the real top level through this
//      variable); and an inherited `CLAUDE_PROJECT_DIR`, unless it is the pin a parent test process made
//      (`PM_TEST_PINNED_ROOT`), which is scratch nobody owns. For each it hashes every file under
//      `.conductor/` and fingerprints (lstat: size, mtime, inode — see `snapshotRecord`) the three root
//      files the engine writes (`PROJECT.md`, `CLAUDE.md`, `.gitignore` — `lib/verb-effects.mjs`,
//      `init`/`render`). `.DS_Store` and `*.lock` are skipped:
//      the first is the OS's, the second a transient the commit-nudge hook makes and removes.
//      So is SESSION BOOKKEEPING (`SESSION_BOOKKEEPING`): the files a LIVE Claude Code session's hooks
//      and agents rewrite as they work, which are never the record of work. Watching them made the
//      guard unusable: every Bash call of every live session in the checkout rewrites
//      commit-observe.json, so on 2026-09-29 every file of the pre-commit assertion half failed
//      (~40 files, all on that one path) while a second session worked in another worktree. Each
//      entry is git-ignored by the engine itself (`ensureGitignore`, lib/subcommands.mjs) as
//      per-checkout transient state, and each has a named live writer:
//        commit-observe.json*  — the PostToolUse/PostToolUseFailure `commit-nudge` hook, every tool
//                                call (lib/commit-watch.mjs): the record, its O_EXCL lock and the
//                                `.tmp-<pid>` of its rename, which a killed hook leaves behind.
//        commit-watch.json     — the same hook's 0.44.0 watermark, still rewritten by an unreloaded
//                                0.44.0 session sharing the checkout.
//        session-claim.json*   — #84's per-session quiescence marker and its rename temp
//                                (lib/claims.mjs): "THIS session is mid-operation here".
//        brief.txt             — rewritten by the SessionStart `brief` and PreCompact `snapshot` hooks
//                                (lib/verb-effects.mjs); derived from state.json, which stays watched.
//        activity/             — #111's activity segments (lib/activity-log.mjs), appended by every
//                                engine run, hooks included, when the log is on.
//        agent-logs/           — scripts/agent-log.sh, which every worktree agent appends to in the
//                                MAIN checkout.
//      The DURABLE record stays watched: state.json, render-stamp.json, detours.log,
//      honcho-memories.log, feedback/, write-conflicts.*, and the root files. Matching is on the
//      root-relative path, never the basename, so `.conductor/feedback/brief.txt` is still watched.
//      RESIDUAL FALSE POSITIVE, deliberately kept: commit-nudge can also self-heal state.json and
//      append detours.log, and a live orchestrator writes state.json; those are the record, so a
//      concurrent write to one still fails the file and the mtime in the message says whose it was.
//   2. PINS `CLAUDE_PROJECT_DIR` to a fresh EMPTY scratch directory, removed at exit.
//   3. AT EXIT, hashes again. Any file added, changed or removed is written to stderr by path, with
//      its mtime against this process's start, and the process exits 1 — which the runner reports as
//      `✖ <file> … 'test failed'` and a failed run (the mechanism `assert-git-shim.mjs` measured on
//      Node 22, 24 and 26).
//
// WHAT IS PREVENTED, AND WHAT IS ONLY DETECTED.
//   PREVENTED — an engine call that names no root AND inherits this process's environment: spawned
//     with an env built from `...process.env` (the variable carried through), or called in process
//     outside `main()`. It resolves `CLAUDE_PROJECT_DIR || cwd` to the pinned scratch directory,
//     whatever the test's cwd is — the 2026-09-21 shape.
//   DETECTED ONLY (the exit check, after the fact) — every other route to the real repository: a
//     literal path, one derived from `import.meta.url`, a child given `CLAUDE_PROJECT_DIR=<repo>`, a
//     child whose env was built by hand WITHOUT `CLAUDE_PROJECT_DIR` (or had it deleted) and whose cwd
//     is the protected repository — its engine falls back to that cwd (reproduced at re-review: it
//     wrote state.json and the exit check caught it) — a lib call inside `withRoot(REPO, …)`
//     (`explicit-root.mjs`), and a git command run with the repository as its cwd.
//   NOT SEEN — a write under a protected root outside the hashed set (any other path in the working
//     tree, and the SESSION_BOOKKEEPING paths above); and a DETACHED child that outlives this process and writes after its exit listener ran.
//
// IT NEVER RESTORES the record. A restore could clobber a LEGITIMATE concurrent write and would erase
// the evidence of the leak. That concurrent write is this guard's false positive: the exit check cannot
// tell which process wrote a file, so the message names the other writers it could be and prints each
// path's mtime against this process's start.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { removeAtExit } from "./temp-dir.mjs";

const SUITE_REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const STARTED_MS = Date.now();

/** The root files outside `.conductor/` that the engine writes (`init`, `render`). */
export const ROOT_FILES = ["PROJECT.md", "CLAUDE.md", ".gitignore"];

/** The roots whose records this process must leave byte-identical, de-duplicated, suite first. */
export function protectedRoots(env, suiteRepo) {
  const roots = [suiteRepo, env.PM_TEST_PROTECTED_ROOT];
  const inherited = env.CLAUDE_PROJECT_DIR;
  if (inherited && !(env.PM_TEST_PINNED_ROOT && path.resolve(inherited) === path.resolve(env.PM_TEST_PINNED_ROOT))) {
    roots.push(inherited);
  }
  const out = [];
  for (const r of roots) {
    if (!r) continue;
    const abs = path.resolve(r);
    if (!out.includes(abs)) out.push(abs);
  }
  return out;
}

/** Is `name` a file the walk leaves out? The OS's `.DS_Store`, and every `*.lock` — a lock is a
 *  transient by construction (the commit-nudge hook makes one under `.conductor/` and removes it). */
export const skipped = (name) => name === ".DS_Store" || name.endsWith(".lock");

/** The root-relative paths a live session's hooks and agents rewrite as bookkeeping — see the header
 *  for each one's writer. A trailing `*` is a prefix (the file and its lock/temp siblings, the shape
 *  of the engine's own .gitignore glob); a trailing `/` is a directory, pruned whole. */
export const SESSION_BOOKKEEPING = [
  ".conductor/commit-observe.json*", ".conductor/commit-watch.json", ".conductor/session-claim.json*",
  ".conductor/brief.txt", ".conductor/activity/", ".conductor/agent-logs/",
];

/** Is the root-relative `rel` (a file, or a directory without its trailing slash) session bookkeeping? */
export function sessionBookkeeping(rel) {
  return SESSION_BOOKKEEPING.some((p) => {
    if (p.endsWith("*")) return rel.startsWith(p.slice(0, -1));
    if (p.endsWith("/")) return rel === p.slice(0, -1) || rel.startsWith(p);
    return rel === p;
  });
}

const digest = (abs) => crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex");

/** `{ "<root-relative path>": sha256 }` for every regular file under `<root>/.conductor/` and each of
 *  `ROOT_FILES` that exists; an absent file has no key. Symlinks are recorded by their target text,
 *  never followed. */
export function snapshotRecord(root) {
  const out = {};
  const record = (abs, rel, dirent) => {
    try {
      if (dirent.isSymbolicLink()) out[rel] = `symlink:${fs.readlinkSync(abs)}`;
      else if (dirent.isFile()) out[rel] = digest(abs);
    } catch { out[rel] = "unreadable"; }
  };
  const walk = (abs, rel) => {
    let entries;
    try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (skipped(e.name)) continue;
      const a = path.join(abs, e.name), r = `${rel}/${e.name}`;
      if (sessionBookkeeping(r)) continue;
      if (e.isDirectory()) walk(a, r);
      else record(a, r, e);
    }
  };
  walk(path.join(root, ".conductor"), ".conductor");
  // The root files are FINGERPRINTED, not read: size, mtime and inode from `lstat`. Reading their bytes
  // would make every functional process READ `PROJECT.md` and `.gitignore`, which the certification
  // subject excludes, and certify's run-time observer refuses a run that reads a tracked file outside
  // its subject. Any write moves the mtime, so a write is still seen; a stat is not a read.
  for (const name of ROOT_FILES) {
    let st;
    try { st = fs.lstatSync(path.join(root, name)); } catch { continue; }
    out[name] = `stat:${st.size}:${st.mtimeMs}:${st.ino}`;
  }
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

/** When `abs` was last modified, against `startedMs`: `mtime <iso>, <n>s after this process started`
 *  (or `before`); `no mtime` for a removed file. */
export function mtimeNote(abs, startedMs) {
  let ms;
  try { ms = fs.lstatSync(abs).mtimeMs; } catch { return "no mtime: the path no longer exists"; }
  const d = (Math.abs(ms - startedMs) / 1000).toFixed(1);
  return `mtime ${new Date(ms).toISOString()}, ${d}s ${ms >= startedMs ? "after" : "before"} this process started`;
}

/** The exit message for `[{ root, leaks }]`; empty when nothing leaked. */
export function describeLeaks(found, startedMs = STARTED_MS) {
  const hit = found.filter((f) => f.leaks.length);
  if (!hit.length) return "";
  return "\nrecord-isolation: a protected record CHANGED while this test file ran — no test may write the " +
    "developer's real record (test-isolation-guard):\n" +
    hit.flatMap(({ root, leaks }) => leaks.slice(0, 20).map((l) => {
      const abs = path.join(root, l.path);
      return `  ${abs} (${l.change}; ${mtimeNote(abs, startedMs)})\n`;
    })).join("") +
    "CLAUDE_PROJECT_DIR is pinned to an empty scratch directory in every test process, so an engine call that " +
    "names no root cannot have done this. The write named the repository itself: a literal path, a path " +
    "derived from import.meta.url, a child given CLAUDE_PROJECT_DIR=<repo>, withRoot(<repo>, …), or git run " +
    "with the repository as its cwd. Give the engine a fixture root (tmpRepo()). The record was NOT " +
    "restored: inspect it (git diff) and remove what the test wrote.\n" +
    "The writer may not be this file: it may be this file or one running alongside it, or another pm " +
    "process (a Claude Code session, a hook, another worktree's orchestrator) writing the same record. " +
    "An mtime before this process started, or one matching another process's work, points there — " +
    "re-run the file alone to tell.\n";
}

export const PROTECTED = protectedRoots(process.env, SUITE_REPO);
const BEFORE = PROTECTED.map((root) => ({ root, snap: snapshotRecord(root) }));

/** The empty scratch directory `CLAUDE_PROJECT_DIR` is pinned to in this process. */
export const PINNED_ROOT = removeAtExit(fs.mkdtempSync(path.join(os.tmpdir(), "pm-test-project-dir-")));
process.env.CLAUDE_PROJECT_DIR = PINNED_ROOT;
process.env.PM_TEST_PINNED_ROOT = PINNED_ROOT;

/** The exit listener: compare every protected record with its import-time snapshot and fail the file
 *  on any difference. Exported so a test can call it on purpose. */
export function onExit() {
  const text = describeLeaks(BEFORE.map(({ root, snap }) => ({ root, leaks: diffRecords(snap, snapshotRecord(root)) })));
  if (!text) return;
  process.stderr.write(text);
  process.exitCode = 1;
}

process.on("exit", onExit);
