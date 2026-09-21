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
//     ONE spawn anywhere in the half fails the half — measured, not assumed: with
//     `--test-isolation=none` a passing `node --test` run whose exit listener sets `exitCode` exits
//     1 (probed before this file was written);
//   * `gitSpawns()`, which the guard test reads directly, so the same fact is also an assertion in
//     the half rather than only a process status.
//
// IT IS IMPORTED BY `assert-harness.mjs`, and that is the whole installation: every assertion-half
// file that drives the engine imports the harness, so the shim is in place before any test body
// runs. The functional half imports `functional-harness.mjs` instead and must never load this file —
// it runs the real git by design.
//
// THE SHIM IS NOT A FAILURE INJECTION. Exiting 128 is what a missing repository looks like, and it is
// TOLERATED by every caller (`headAttachment` answers "unknown", `appendEvents` returns): the suite
// stays green on its own merits, and the spawn is reported by the listener rather than by a test
// breaking for an unrelated reason. That is deliberate — a shim that broke tests would be removed the
// first time it fired, which is how a guard like this gets deleted rather than obeyed.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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

/** Every real git invocation the process has made since the shim was installed. Empty is the
 *  property; a non-empty list is the evidence, including the argv that was run. */
export function gitSpawns() {
  try {
    return fs.readFileSync(GIT_SPAWN_LOG, "utf8").split("\n").filter(Boolean);
  } catch { return []; }
}

process.on("exit", () => {
  const spawns = gitSpawns();
  if (!spawns.length) return;
  process.stderr.write(
    `\nassertion half: ${spawns.length} REAL 'git' invocation(s) reached the shim — the half must run ` +
    "no git (design D5, suite-certification's 'spawns no process and runs no git'):\n" +
    spawns.slice(0, 10).map((s) => `  git ${s}\n`).join("") +
    "A direct lib call outside `main()` leaves invocation() on the live process context, so gitOps() " +
    "builds the real gateway. Drive it through the harness, or hand it a fake.\n");
  process.exitCode = 1;
});
