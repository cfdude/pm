// scripts/test/functional/drift-script.test.mjs
// THE FUNCTIONAL HALF'S SIDE OF THE DRIFT SCRIPT (G-I2, Gate 2; certification-record-redesign 2.4).
//
// Its assertion twin is scripts/test/assert/drift-script.test.mjs — same id, same subject — which
// exercises the four checks as PURE functions over injected data and the record directory over a
// scratch common dir. What cannot be exercised there is what this file is about: WHICH INDEX the
// freshness check reads, through real git.
//
// THE DEFECT (G-I2). The record's freshness is documented as a property of the STAGED content. Every
// assertion-half test of check 4 injects its inputs, so nothing held the reader to the index:
// replacing the staged read with a worktree read left all of the drift tests green. The bypass that
// buys:
//
//   $ git add scripts/lib/m.mjs          # the index now holds edited, unverified content
//   $ git checkout -- scripts/lib/m.mjs  # the worktree holds the CERTIFIED bytes again
//   $ node scripts/test/drift.mjs        # a worktree read matches the record — the gate PASSES
//                                        # while the commit carries content no run ever covered
//
// Since certification-record-redesign 2.4 the record is a directory of content-keyed MANIFESTS (mode
// and blob id per subject path), and this file also holds the two cases the switch needs real git
// for: a staged DELETION of a functional test (judged through HEAD's subject, Gate 1 B2), and the
// X1 case — two real indexes, so `indexManifest(…, { indexFile })` is seen to read ONE index for the
// subject, the bytes the subject is judged by, and the modes and blobs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpRepo, seedAgreeingEntry } from "../fixtures/functional-harness.mjs";
import { indexManifest } from "../drift.mjs";

const DRIFT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "drift.mjs");

const git = (cwd, args, env) => execFileSync("git", args,
  { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "ignore"], ...(env ? { env: { ...process.env, ...env } } : {}) }).trim();

const TEST_BODY = 'import { test } from "node:test";\ntest("alpha", () => {});\n';

/** A fixture repository shaped the way the drift script's derivations read: an engine entry point,
 *  one library module that CALLS the gateway (so it is in the interim functional subject, through
 *  `certifiedModules()`, and in the sweeps subject), one functional test with its assertion twin, and
 *  one sweep test.
 *
 *  The record holds an agreeing entry for BOTH buckets over the committed content — seeded through
 *  drift's own `indexManifest()` — so a refusal below can only be about what the case changed. */
function fixtureRepo() {
  const cwd = tmpRepo();
  git(cwd, ["init", "-q"]);
  git(cwd, ["config", "user.email", "test@example.com"]);
  git(cwd, ["config", "user.name", "Test"]);
  const CERTIFIED = "export const touch = () => gitOps();\n";
  const files = {
    "scripts/conductor.mjs": "export const main = () => 0;\n",
    "scripts/lib/m.mjs": CERTIFIED,
    "scripts/test/functional/alpha.test.mjs": TEST_BODY,
    "scripts/test/assert/alpha.test.mjs": TEST_BODY,
    "scripts/test/sweeps/s.test.mjs": 'import { test } from "node:test";\ntest("s", () => {});\n',
  };
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(cwd, rel)), { recursive: true });
    fs.writeFileSync(path.join(cwd, rel), body);
  }
  git(cwd, ["add", "--", ...Object.keys(files)]);
  git(cwd, ["commit", "-q", "-m", "fixture"]);
  seedAgreeingEntry(cwd, "functional");
  seedAgreeingEntry(cwd, "sweeps");
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
  assert.notEqual(`${staged}\n`, CERTIFIED,
    "precondition: the INDEX holds different bytes from the worktree — this is the bypass's whole shape");

  const r = runDrift(cwd);
  assert.notEqual(r.status, 0,
    "the drift script accepted a commit whose index holds content the record does not cover: the " +
    `record must be checked against the STAGED content. Output was: ${r.out}`);
  assert.match(r.out, /scripts\/lib\/m\.mjs/,
    "the refusal must NAME the module whose staged content is uncertified");
  assert.match(r.out, /certify\.mjs/,
    "and it must name the run that satisfies it, or the refusal gets bypassed instead of met");
});

test("G-I2 control: the same fixture with the worktree MATCHING the index is accepted", () => {
  // Without this the test above could pass on any refusal — a missing record, a broken derivation —
  // and would be measuring nothing. Here the index IS the certified content, and a staged no-op
  // (the same bytes re-added) touches nothing, so the gate must accept.
  const { cwd } = fixtureRepo();
  const r = runDrift(cwd);
  assert.equal(r.status, 0, `an unchanged, fully-certified fixture must be accepted: ${r.out}`);
  assert.match(r.out, /drift: ok/);
  // And a staged subject change is fresh once a run over exactly that index is recorded for each
  // bucket that demands it.
  fs.appendFileSync(path.join(cwd, "scripts/lib/m.mjs"), "// edited\n");
  git(cwd, ["add", "--", "scripts/lib/m.mjs"]);
  seedAgreeingEntry(cwd, "functional");
  seedAgreeingEntry(cwd, "sweeps");
  const fresh = runDrift(cwd);
  assert.equal(fresh.status, 0, `a staged subject change with an agreeing entry for each bucket is fresh: ${fresh.out}`);
});

test("2.4 a staged DELETION of a functional test demands the functional bucket (Gate 1 B2)", () => {
  // The record holds a passing entry for the current subject; the commit deletes a functional test
  // (and its twin, so check 3 is not what refuses). The index no longer holds the path, so
  // subject(index) cannot name it — subject(HEAD) does, and no entry agrees with the new subject.
  // Before the switch this commit PASSED: the old record was keyed per module, and no entry's
  // `covers` named the deleted id (red-2.4.txt).
  const { cwd } = fixtureRepo();
  const before = runDrift(cwd);
  assert.equal(before.status, 0, `precondition: the seeded fixture is fresh: ${before.out}`);
  git(cwd, ["rm", "-q", "--", "scripts/test/functional/alpha.test.mjs", "scripts/test/assert/alpha.test.mjs"]);
  const r = runDrift(cwd);
  assert.notEqual(r.status, 0, `a staged deletion of a functional test must demand a functional run: ${r.out}`);
  assert.match(r.out, /the functional bucket's subject changed \(scripts\/test\/functional\/alpha\.test\.mjs\)/,
    `the refusal names the functional bucket and the deleted path: ${r.out}`);
  assert.match(r.out, /node scripts\/test\/certify\.mjs functional/, "and the run that satisfies it");
  assert.doesNotMatch(r.out, /the sweeps bucket's subject changed/, "a functional test is not in the sweeps subject");
});

test("2.4 X1: indexManifest() reads ONE index — its listing, the bytes its subject is judged by, and its modes and blobs", () => {
  // `.git/index` stages scripts/lib/a.mjs WITHOUT a `gitOps(` call. A SECOND index stages it WITH one,
  // plus a functional test the first lacks, which IMPORTS it — at L2 `a.mjs` is admitted by its
  // `gitOps(` text, from 3.3 by the import closure, so the case discriminates by index at both steps.
  const cwd = tmpRepo();
  git(cwd, ["init", "-q"]);
  git(cwd, ["config", "user.email", "test@example.com"]);
  git(cwd, ["config", "user.name", "Test"]);
  const A = "scripts/lib/a.mjs";
  const F = "scripts/test/functional/uses-a.test.mjs";
  fs.mkdirSync(path.join(cwd, "scripts/lib"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "scripts/conductor.mjs"), "export const main = () => 0;\n");
  fs.writeFileSync(path.join(cwd, A), "export const quiet = () => 0;\n");
  git(cwd, ["add", "--", "scripts/conductor.mjs", A]);

  const second = path.join(fs.realpathSync(cwd), ".git", "second-index");
  fs.copyFileSync(path.join(cwd, ".git", "index"), second);
  const blob = (body) => execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd, input: body, encoding: "utf8" }).trim();
  const A2 = "export const touch = () => gitOps();\n";
  const F2 = 'import { test } from "node:test";\nimport { touch } from "../../lib/a.mjs";\ntest("uses a", () => { void touch; });\n';
  const a2 = blob(A2);
  git(cwd, ["update-index", "--add", "--cacheinfo", `100644,${a2},${A}`], { GIT_INDEX_FILE: second });
  git(cwd, ["update-index", "--add", "--cacheinfo", `100644,${blob(F2)},${F}`], { GIT_INDEX_FILE: second });

  const other = indexManifest(cwd, "functional", { indexFile: second });
  assert.ok(other.subject.includes(A), `the second index's a.mjs calls gitOps( — its subject must hold it: ${JSON.stringify(other.subject)}`);
  assert.ok(other.subject.includes(F), `and the functional file only the second index holds: ${JSON.stringify(other.subject)}`);
  assert.equal(other.manifest[A], `100644 ${a2}`, "a.mjs's blob is the SECOND index's, not the inherited one's");

  const own = indexManifest(cwd, "functional");
  assert.equal(own.subject.includes(A), false, `the inherited index's a.mjs makes no gitOps( call: ${JSON.stringify(own.subject)}`);
  assert.equal(own.subject.includes(F), false, "and the inherited index holds no functional file");
  assert.notEqual(own.key, other.key);

  assert.throws(() => indexManifest(cwd, "functional", { indexFile: ".git/second-index" }), /absolute/,
    "a relative indexFile is refused: `-C root` would re-anchor it");
});
