// gates-bind-to-verified-evidence — a recorded commit is resolved when it is written, a withdrawal
// matches the attributed commit rather than its spelling, staleness reads every attributed commit,
// and integrity reports a recorded value that is not a commit object name.
//
// Every fixture here holds REAL commits (fixtureCommits in helpers.mjs). A fake sha is now refused
// at write, so a test that fed one would be exercising the refusal rather than the rule it names.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { ENGINE, EMPTY_CACHE, tmpRepo, run, readState, writeState, fixtureCommits, fixtureCommit } from "./helpers.mjs";

const stateFile = (cwd) => path.join(cwd, ".conductor", "state.json");
const stateBytes = (cwd) => fs.readFileSync(stateFile(cwd));
const epicOf = (cwd, id) => readState(cwd).epics.find(e => e.id === id);
const git = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

function attempt(cwd, args) {
  const r = spawnSync("node", [ENGINE, ...args], {
    cwd, encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, PM_CACHE_ROOT: EMPTY_CACHE },
  });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}
function refused(cwd, args) {
  const before = stateBytes(cwd);
  const r = attempt(cwd, args);
  assert.notEqual(r.status, 0, `expected a refusal, got exit 0.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  assert.ok(stateBytes(cwd).equals(before), "a refused invocation must leave state.json byte-identical");
  return r;
}
function accepted(cwd, args) {
  const r = attempt(cwd, args);
  assert.equal(r.status, 0, `expected exit 0.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  return r;
}

/** An initialized pm repository holding `names` as real linear commits on branch `main`. */
function repoWith(names = ["root", "one"]) {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const shas = fixtureCommits(cwd, names);
  git(cwd, ["branch", "-M", "main"]);
  run(["add-epic", "--id", "e", "--lane", "openspec"], { cwd });
  return { cwd, shas };
}

// ═══════════════ Requirement: A recorded commit is resolved when it is written ═══════════════

test("2.1 --attribute-commit of a value that is not a commit is refused naming it, byte-identical", () => {
  const { cwd } = repoWith();
  const r = refused(cwd, ["update-epic", "e", "--attribute-commit", "not-a-commit"]);
  assert.match(r.stderr, /not-a-commit/, "the refusal names the value that did not resolve");
});

test("2.2 a moving ref is stored as the commit it named at the time of the call", () => {
  const { cwd, shas: [root, one] } = repoWith();
  accepted(cwd, ["record-gate-review", "e", "--gate", "2", "--verdict", "pass",
    "--base-sha", "main~1", "--head-sha", "HEAD", "--reviewer", "r"]);
  fixtureCommit(cwd, "later");
  const entry = epicOf(cwd, "e").gateReview.gate2;
  assert.equal(entry.baseSha, root, "main~1 is recorded as the full name it named at call time");
  assert.equal(entry.headSha, one, "HEAD is recorded as the full name it named at call time");
});

test("2.3 a unique short hash is stored as its commit's full name, and the read-back passes", () => {
  const { cwd, shas: [, one] } = repoWith();
  accepted(cwd, ["update-epic", "e", "--attribute-commit", one.slice(0, 10)]);
  assert.deepEqual(epicOf(cwd, "e").attributedCommits, [one]);
});

test("2.4 REGRESSION GUARD: a commit reachable only from a presquash/* tag, attributed from another branch, resolves", () => {
  const { cwd, shas: [, one] } = repoWith();
  const tree = git(cwd, ["rev-parse", "HEAD^{tree}"]);
  const squashed = execFileSync("git", ["commit-tree", tree, "-p", one, "-m", "pre-squash work"],
    { cwd, encoding: "utf8" }).trim();
  git(cwd, ["tag", "presquash/work", squashed]);
  git(cwd, ["checkout", "-q", "-b", "elsewhere"]);
  assert.equal(git(cwd, ["branch", "--contains", squashed]), "", "no branch holds the commit");
  accepted(cwd, ["update-epic", "e", "--attribute-commit", squashed.slice(0, 12)]);
  assert.deepEqual(epicOf(cwd, "e").attributedCommits, [squashed]);
});

test("2.5 a range bound that is not a commit is refused naming it, and no verdict is recorded", () => {
  const { cwd, shas: [, one] } = repoWith();
  const r = refused(cwd, ["record-gate-review", "e", "--gate", "2", "--verdict", "pass",
    "--base-sha", "root", "--head-sha", one]);
  assert.match(r.stderr, /root/, "the refusal names the unresolved bound");
  assert.equal(epicOf(cwd, "e").gateReview, undefined, "no verdict was recorded");
});
