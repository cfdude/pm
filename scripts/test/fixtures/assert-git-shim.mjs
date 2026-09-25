// scripts/test/fixtures/assert-git-shim.mjs
// G-I4 (Gate 2) — THE ASSERTION HALF'S RUNTIME COUNTER FOR REAL GIT SPAWNS.
//
// WHY A RUNTIME SHIM AND NOT ANOTHER SOURCE SCAN. The half already carries two source-level checks:
// 5.2's guard over the half's own test files, and 4.1's derivation over the engine's modules. Both
// look for a spawn IN SOURCE, and both are blind to the defect the reviewer found: a test that calls
// a lib function DIRECTLY — outside `main()` — leaves `invocation()` returning the live
// PROCESS_CONTEXT, so `gitOps()` builds the REAL gateway and `git symbolic-ref` runs. There is no
// spawn call anywhere in the offending file; the spawn is three modules down, inside the gateway.
// A source scan cannot see it, and neither can a reviewer, which is why it shipped.
//
// SO THE ENFORCEMENT IS AT THE PROCESS BOUNDARY, where the spawn actually happens. A directory with
// an executable `git` is put FIRST on PATH — `execFileSync("git", …)` resolves through PATH, so the
// real binary is unreachable for the rest of this process — and the shim appends its argv to a log
// and exits 128. Two things then hold the property:
//
//   * an `exit` listener that sets `process.exitCode = 1` and says so when the log is not empty, so
//     ONE spawn anywhere in a file's process fails that file, and the file's failure fails the run —
//     measured on Node 22, 24 and 26 under the runner's default per-file isolation: a file whose exit
//     listener sets `exitCode = 1` is reported `✖ <file> … 'test failed'` and the run exits 1
//     (0.49.0, design D3 row 2);
//   * `gitSpawns()`, which the guard test reads directly, so the same fact is also an assertion in
//     the half rather than only a process status.
//
// THE COUNTER IS PER PROCESS, SO EVERY RUNG FILE INSTALLS IT ITSELF (0.49.0, design D3 row 1). The
// runner gives each file its own process, and a shim another file installed covers nothing here.
// Every unit- and file-rung file imports this module directly or through `assert-harness.mjs` /
// `unit-harness.mjs`, and `assert/assert-half-has-no-spawn.test.mjs` refuses, by name, one that does
// neither. The functional half imports `functional-harness.mjs` instead and must never load this file —
// it runs the real git by design.
//
// THE DIRECTORY IS REMOVED AT EXIT (0.49.0, design D3 row 3). One `pm-assert-no-git-*` directory is
// made per process that imports this file; the exit listener reads the log and THEN removes it, through
// `removeTempDir()` (`temp-dir.mjs`), which `fixtures/harness.mjs` uses for its own per-process directory too.
//
// THE SHIM IS NOT A FAILURE INJECTION. Exiting 128 is what a missing repository looks like, and it is
// TOLERATED by every caller (`headAttachment` answers "unknown", `appendEvents` returns): the suite
// stays green on its own merits, and the spawn is reported by the listener rather than by a test
// breaking for an unrelated reason. That is deliberate — a shim that broke tests would be removed the
// first time it fired, which is how a guard like this gets deleted rather than obeyed.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { removeTempDir } from "./temp-dir.mjs";

const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-assert-no-git-"));

/** The commands the shim has been asked to run, newest last. */
export const GIT_SPAWN_LOG = path.join(shimDir, "git-spawns.log");

const shim = path.join(shimDir, "git");
fs.writeFileSync(shim,
  "#!/bin/sh\n" +
  `printf '%s\\n' "$*" >> '${GIT_SPAWN_LOG}'\n` +
  "exit 128\n");
fs.chmodSync(shim, 0o755);

/** The shim directory, so a test can assert the PATH really is shadowed rather than trusting it. */
export const SHIM_DIR = shimDir;

process.env.PATH = `${shimDir}${path.delimiter}${process.env.PATH}`;

// The removal function, and the exit-time schedule the harness uses for its own directory, live in
// `temp-dir.mjs` (the harness is imported by the functional half too, which must never load this
// file). Re-exported here so a test can exercise them (`assert/git-shim.test.mjs`): the listener
// itself runs after every test has finished, where nothing can observe it.
export { removeAtExit, removeTempDir, scheduledForRemoval } from "./temp-dir.mjs";

/** Every real git invocation the process has made since the shim was installed. Empty is the
 *  property; a non-empty list is the evidence, including the argv that was run. */
export function gitSpawns() {
  try {
    return fs.readFileSync(GIT_SPAWN_LOG, "utf8").split("\n").filter(Boolean);
  } catch { return []; }
}

/** Read the spawn log in `dir`, then remove `dir` — READ FIRST, the log lives in the directory being
 *  removed. Returns the logged argv lines. Exported so a test can exercise it on a scratch directory
 *  (Gate 2 M1). */
export function drainAndRemove(dir) {
  let spawns = [];
  try { spawns = fs.readFileSync(path.join(dir, "git-spawns.log"), "utf8").split("\n").filter(Boolean); } catch { /* none */ }
  removeTempDir(dir);
  return spawns;
}

/** The exit listener: drain and remove this process's shim directory, then fail the file if any real
 *  git call reached the shim. Exported so a test can assert it is the registered listener. */
export function onExit() {
  const spawns = drainAndRemove(shimDir);
  if (!spawns.length) return;
  process.stderr.write(
    `\nassertion half: ${spawns.length} REAL 'git' invocation(s) reached the shim — the half must run ` +
    "no git (suite-certification's 'No test in the assertion half spawns a process or runs git'):\n" +
    spawns.slice(0, 10).map((s) => `  git ${s}\n`).join("") +
    "A direct lib call outside `main()` leaves invocation() on the live process context, so gitOps() " +
    "builds the real gateway. Drive it through the harness, or hand it a fake.\n");
  process.exitCode = 1;
}

process.on("exit", onExit);
