// scripts/test/functional/drift-script.test.mjs
// THE FUNCTIONAL HALF'S SIDE OF THE DRIFT SCRIPT (G-I2, Gate 2).
//
// Its assertion twin is scripts/test/assert/drift-script.test.mjs — same id, same subject — which
// exercises the four checks as PURE functions over injected data. What cannot be exercised there is
// the one thing this file is about: WHERE THE FRESHNESS CHECK READS FROM.
//
// THE DEFECT (G-I2). The record's freshness is documented as the hash of the certified files AS
// STAGED (`git show :<path>`, design D8 check 4). Every assertion-half test of check 4 injects
// `hashStaged` as a stub, so nothing held the reader to the index: replacing the staged read with a
// worktree `readFileSync` left all of the drift tests green. The concrete bypass that buys:
//
//   $ git add scripts/lib/git.mjs        # the index now holds edited, unverified content
//   $ git checkout -- scripts/lib/git.mjs  # the worktree holds the CERTIFIED bytes again
//   $ node scripts/test/drift.mjs        # a worktree hash matches the record — the gate PASSES
//                                        # while the commit carries content no run ever covered
//
// The test below builds exactly that state in a real fixture repository and requires the refusal.
// It is a REGRESSION GUARD rather than a RED — the implementation already reads the index, so it
// passes the moment it exists — and it is therefore verified by a deliberate violation: the mutant
// that makes the reader a worktree read is in red-G-I2.txt, and it kills this test.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpRepo } from "../fixtures/functional-harness.mjs";
import { RECORD_NAME, certifiedSet, contentHash } from "../certification.mjs";

const DRIFT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "drift.mjs");

const git = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }).trim();

/** A fixture repository shaped the way the drift script's derivations read: an engine entry point,
 *  one library module that CALLS the gateway (so it is in the certified set, and so is the
 *  `engine-source` trigger over the same files), and the three bucket directories.
 *
 *  The record holds an entry for BOTH demands, written over the module's CERTIFIED bytes — without
 *  both, a missing entry would refuse for the wrong reason and the test would pass without ever
 *  reaching the question it asks. */
function fixtureRepo() {
  const cwd = tmpRepo();
  git(cwd, ["init", "-q"]);
  git(cwd, ["config", "user.email", "test@example.com"]);
  git(cwd, ["config", "user.name", "Test"]);
  for (const d of ["scripts/lib", "scripts/test/assert", "scripts/test/functional", "scripts/test/sweeps"]) {
    fs.mkdirSync(path.join(cwd, d), { recursive: true });
  }
  const CERTIFIED = "export const touch = () => gitOps();\n";
  fs.writeFileSync(path.join(cwd, "scripts/conductor.mjs"), "export const main = () => 0;\n");
  fs.writeFileSync(path.join(cwd, "scripts/lib/m.mjs"), CERTIFIED);
  git(cwd, ["add", "--", "scripts/conductor.mjs", "scripts/lib/m.mjs"]);
  git(cwd, ["commit", "-q", "-m", "fixture"]);

  const commonDir = path.resolve(cwd, git(cwd, ["rev-parse", "--git-common-dir"]));
  const set = certifiedSet(cwd);
  const read = (rel) => fs.readFileSync(path.join(cwd, rel), "utf8");
  const entries = {};
  for (const [id, files] of set) {
    entries[id] = {
      kind: id === "engine-source" ? "trigger" : "module",
      files,
      contentHash: contentHash(files, read),
      // No test files exist in this fixture, so there is no id a covers entry could legitimately
      // name — and naming one that does not resolve is exactly what check 4's dangling-id half
      // refuses. This fixture is about WHERE THE HASH IS READ, so covers is left empty rather than
      // filled with an id that would turn every assertion below into a dangling-covers refusal.
      covers: [],
      result: "pass",
      ranAt: "2026-01-01T00:00:00.000Z",
      engineSha: git(cwd, ["rev-parse", "HEAD"]),
      counts: { tests: 1, pass: 1, fail: 0 },
      run: "node scripts/test/certify.mjs functional",
    };
  }
  fs.writeFileSync(path.join(commonDir, RECORD_NAME), JSON.stringify({ version: 1, entries }, null, 2) + "\n");
  return { cwd, CERTIFIED };
}

/** Run the drift script as the pre-commit hook does — the real script, its own process, against the
 *  fixture root — and hand back its status and combined output. */
function runDrift(cwd) {
  try {
    const out = execFileSync(process.execPath, [DRIFT, "--root", cwd], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    return { status: 0, out };
  } catch (e) {
    return { status: e.status, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

test("G-I2 the record's freshness is taken over the STAGED bytes, not the worktree's", () => {
  const { cwd, CERTIFIED } = fixtureRepo();

  // The bypass, in three steps. The index holds content no run has covered...
  fs.writeFileSync(path.join(cwd, "scripts/lib/m.mjs"),
    "export const touch = () => gitOps();\nexport const EDITED = true;\n");
  git(cwd, ["add", "--", "scripts/lib/m.mjs"]);
  // ...and the worktree is put back to the CERTIFIED bytes, which is the state a developer reaches
  // by staging an edit and then reverting the file — deliberately or by accident.
  fs.writeFileSync(path.join(cwd, "scripts/lib/m.mjs"), CERTIFIED);
  assert.equal(fs.readFileSync(path.join(cwd, "scripts/lib/m.mjs"), "utf8"), CERTIFIED,
    "precondition: the worktree holds the certified bytes");

  const staged = git(cwd, ["show", ":scripts/lib/m.mjs"]);
  assert.notEqual(staged, CERTIFIED,
    "precondition: the INDEX holds different bytes from the worktree — this is the bypass's whole shape");

  const r = runDrift(cwd);
  assert.notEqual(r.status, 0,
    "the drift script accepted a commit whose index holds content the record does not cover: the " +
    `record must be checked against the STAGED bytes. Output was: ${r.out}`);
  assert.match(r.out, /scripts\/lib\/m\.mjs/,
    "the refusal must NAME the module whose staged content is uncertified");
  assert.match(r.out, /certify\.mjs/,
    "and it must name the run that satisfies it, or the refusal gets bypassed instead of met");
});

test("G-I2 control: the same fixture with the worktree MATCHING the index is accepted", () => {
  // Without this the test above could pass on any refusal — a missing record, a broken derivation —
  // and would be measuring nothing. Here the staged bytes ARE the certified bytes, so the gate must
  // accept, which is what makes the refusal above attributable to the staged/worktree divergence.
  const { cwd } = fixtureRepo();
  const r = runDrift(cwd);
  assert.equal(r.status, 0, `an unchanged, fully-certified fixture must be accepted: ${r.out}`);
  assert.match(r.out, /drift: ok/);
});
