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
/** The fixtures' functional test IMPORTS their one library module, so the module is in the observed
 *  functional subject (certification-record-redesign 3.3) as well as in the sweeps subject. */
const FN_BODY = 'import { test } from "node:test";\nimport { touch } from "../../lib/m.mjs";\ntest("alpha", () => { void touch; });\n';

/** A fixture repository shaped the way the drift script's derivations read: an engine entry point,
 *  one library module the functional test IMPORTS (so it is in the observed functional subject, and in
 *  the sweeps subject as engine source), one functional test with its assertion twin, and
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
    "scripts/test/functional/alpha.test.mjs": FN_BODY,
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

// ─────────────── 2.5 — REGRESSION GUARD: #226's two failure modes, across two real worktrees ───────────────
//
// 0.50.0 certified in up to seven parallel worktrees of one clone, and the single-file record failed
// there twice over: a certify in worktree B OVERWROTE the entry worktree A had just written, and — not
// a race at all — B's entry named a functional test only B's branch had, so drift in EVERY other
// worktree refused it as `dangling-covers`. Here two linked worktrees of one fixture repository each
// run the REAL certify runner (copied in, as functional/certify-index does) over their own index, B's
// content holding a functional test only B has, in both orders; A's drift must accept A's commit
// every time. It passes the moment it exists; it is verified by restoring "resolve the covers of
// every entry" in a scratch copy, which must refuse A (mutation-2.5.txt).

const TEST_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** A fixture repository holding copies of the runner and its machinery, a gateway-calling module, one
 *  functional test with its twin, and one sweep test — committed, so both worktrees start from it. */
function certifiableRepo() {
  const cwd = tmpRepo();
  git(cwd, ["init", "-q", "-b", "main"]);
  git(cwd, ["config", "user.email", "test@example.com"]);
  git(cwd, ["config", "user.name", "Test"]);
  const files = {
    "scripts/conductor.mjs": "export const main = () => 0;\n",
    "scripts/lib/m.mjs": "export const touch = () => gitOps();\n",
    "scripts/test/functional/alpha.test.mjs": FN_BODY,
    "scripts/test/assert/alpha.test.mjs": TEST_BODY,
    "scripts/test/sweeps/s.test.mjs": 'import { test } from "node:test";\ntest("s", () => {});\n',
  };
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(cwd, rel)), { recursive: true });
    fs.writeFileSync(path.join(cwd, rel), body);
  }
  for (const rel of ["certify.mjs", "certification.mjs", "drift.mjs", "js-lexer.mjs", "fixtures/temp-dir.mjs", "fixtures/observe-reads.mjs"]) {
    fs.mkdirSync(path.dirname(path.join(cwd, "scripts/test", rel)), { recursive: true });
    fs.copyFileSync(path.join(TEST_ROOT, rel), path.join(cwd, "scripts/test", rel));
  }
  git(cwd, ["add", "-A"]);
  git(cwd, ["commit", "-q", "-m", "fixture"]);
  return fs.realpathSync(cwd);
}

/** The worktree's OWN copy of the runner, run over the worktree's own index. */
function certifyIn(wt, bucket) {
  const env = { ...process.env, TMPDIR: tmpRepo() };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_TEST_WORKER_ID;
  try {
    execFileSync(process.execPath, [path.join(wt, "scripts/test/certify.mjs"), bucket], { cwd: wt, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    assert.fail(`certify ${bucket} failed in ${wt}:\n${e.stdout}${e.stderr}`);
  }
}

/** Worktree A stages an edit to its module; worktree B stages a functional test only B has. */
const stageA = (a) => { fs.appendFileSync(path.join(a, "scripts/lib/m.mjs"), "export const A = 1;\n"); git(a, ["add", "--", "scripts/lib/m.mjs"]); };
const stageB = (b) => {
  for (const half of ["functional", "assert"]) fs.writeFileSync(path.join(b, `scripts/test/${half}/only-on-b.test.mjs`), TEST_BODY);
  git(b, ["add", "--", "scripts/test/functional/only-on-b.test.mjs", "scripts/test/assert/only-on-b.test.mjs"]);
};

for (const order of ["B certifies first", "A certifies first"]) {
  test(`2.5 two worktrees certify different content and A's drift accepts A's commit (${order})`, () => {
    const main = certifiableRepo();
    const holder = tmpRepo();
    const a = path.join(holder, "wt-a");
    const b = path.join(holder, "wt-b");
    try {
      git(main, ["worktree", "add", "-q", "-b", "a", a]);
      git(main, ["worktree", "add", "-q", "-b", "b", b]);
      stageA(a);
      stageB(b);
      const certifyA = () => { certifyIn(a, "functional"); certifyIn(a, "sweeps"); };
      const certifyB = () => certifyIn(b, "functional");
      if (order === "B certifies first") { certifyB(); certifyA(); } else { certifyA(); certifyB(); }

      const entries = fs.readdirSync(path.join(main, ".git", "pm-suite-certification.d", "functional"));
      assert.equal(entries.length, 2, `each worktree's run left its own entry, neither replaced: ${entries}`);
      const bEntry = entries.map((n) => JSON.parse(fs.readFileSync(path.join(main, ".git", "pm-suite-certification.d", "functional", n), "utf8")))
        .find((e) => e.manifest["scripts/test/functional/only-on-b.test.mjs"]);
      assert.ok(bEntry, "precondition: B's entry names a functional test A's tree does not have");

      const r = runDrift(a);
      assert.equal(r.status, 0, `A's commit is judged by A's entry alone; B's entry must not refuse it (#226): ${r.out}`);
      assert.match(r.out, /drift: ok/);
      git(a, ["commit", "-q", "-m", "A's change"]);
      const rb = runDrift(b);
      assert.equal(rb.status, 0, `and B's commit is fresh on B's own entry, A's commit notwithstanding: ${rb.out}`);
    } finally {
      for (const wt of [a, b]) { try { git(main, ["worktree", "remove", "--force", wt]); } catch { /* not created */ } }
      git(main, ["worktree", "prune"]);
      const listed = git(main, ["worktree", "list", "--porcelain"]).split("\n").filter((l) => l.startsWith("worktree "));
      assert.deepEqual(listed, [`worktree ${main}`], "the fixture's worktrees are removed and pruned: only the main tree is left");
    }
  });
}
