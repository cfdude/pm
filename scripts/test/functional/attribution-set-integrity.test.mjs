// scripts/test/functional/attribution-set-integrity.test.mjs
// Theme B batch B1 (0.51.0) — the attribution array is a SET read against a recorded Gate 2 head, and
// what is written into it is recorded once.
//
//   gh#216  a catch-up appends an ANCESTOR after its descendants. Staleness already reads every entry
//           (commitsNotReachedBy over the whole array), so the archive gate is fine; what broke was every
//           POSITION-reader: the stale-Gate-2 remedy told the caller to record `--head-sha <the last
//           attributed commit>`, which after a catch-up is an ancestor of the others, and integrity's
//           bookkeeping arm took "the merge commit" from the last array element.
//   gh#237  a verbatim duplicate was appended again, silently. It is now a no-op said out loud.
//   gh#205  attributing a commit after a recorded Gate 2 can stale the verdict; the engine now says so and
//           names both ways out instead of staling in silence.
//
// Real commits throughout (fixtureCommits): a fake sha is refused at write. The assertion twin of this id
// is scripts/test/unit/attribution-set-integrity.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { ENGINE, EMPTY_CACHE, tmpRepo, run, readState, fixtureCommits } from "../fixtures/functional-harness.mjs";

const stateBytes = (cwd) => fs.readFileSync(path.join(cwd, ".conductor", "state.json"));
const epicOf = (cwd, id) => readState(cwd).epics.find(e => e.id === id);
const git = (cwd, args, env = {}) => execFileSync("git", args,
  { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], env: { ...process.env, ...env } }).trim();

function attempt(cwd, args) {
  const r = spawnSync("node", [ENGINE, ...args], {
    cwd, encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, PM_CACHE_ROOT: EMPTY_CACHE },
  });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}
const accepted = (cwd, args) => {
  const r = attempt(cwd, args);
  assert.equal(r.status, 0, `expected exit 0.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  return r;
};
const refused = (cwd, args) => {
  const r = attempt(cwd, args);
  assert.notEqual(r.status, 0, `expected a refusal.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  return r;
};

/** An initialized repo holding `names` as a linear history, and an openspec-lane epic `e`. */
function repoWith(names) {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const shas = fixtureCommits(cwd, names);
  git(cwd, ["branch", "-M", "main"]);
  run(["add-epic", "--id", "e", "--lane", "openspec"], { cwd });
  return { cwd, shas };
}
const ARCHIVE_DELIVERED = ["update-epic", "e", "--status", "archived", "--outcome", "delivered", "--no-deferrals"];

// ═══════════════ gh#237 — a commit is recorded once ═══════════════

test("237.1 a verbatim duplicate is a no-op: exit 0, said on stderr, state.json byte-identical", () => {
  const { cwd, shas: [, one] } = repoWith(["root", "one"]);
  accepted(cwd, ["update-epic", "e", "--attribute-commit", one]);
  const before = stateBytes(cwd);
  const r = accepted(cwd, ["update-epic", "e", "--attribute-commit", one]);
  assert.match(r.stderr, /already attributed/, `the duplicate is named: ${r.stderr}`);
  assert.deepEqual(epicOf(cwd, "e").attributedCommits, [one]);
  assert.ok(stateBytes(cwd).equals(before), "nothing was written for the duplicate");
});

test("237.2 HEAD and its full sha in one call resolve to one commit and are recorded once", () => {
  const { cwd, shas: [, one] } = repoWith(["root", "one"]);
  accepted(cwd, ["update-epic", "e", "--attribute-commit", "HEAD", "--attribute-commit", one]);
  assert.deepEqual(epicOf(cwd, "e").attributedCommits, [one]);
});

test("237.3 a mixed call appends only the new commit, in order, and the read-back still passes", () => {
  const { cwd, shas: [root, one, two] } = repoWith(["root", "one", "two"]);
  accepted(cwd, ["update-epic", "e", "--attribute-commit", one]);
  const r = accepted(cwd, ["update-epic", "e", "--attribute-commit", one.slice(0, 10), "--attribute-commit", two]);
  assert.match(r.stderr, /already attributed/);
  assert.deepEqual(epicOf(cwd, "e").attributedCommits, [one, two]);
  assert.ok(root);
});

test("237.4 INVERSE: a commit withdrawn by an earlier call attributes again", () => {
  const { cwd, shas: [, one] } = repoWith(["root", "one"]);
  accepted(cwd, ["update-epic", "e", "--attribute-commit", one]);
  accepted(cwd, ["update-epic", "e", "--withdraw-commit", one, "--withdrawal-reason", "amended"]);
  assert.deepEqual(epicOf(cwd, "e").attributedCommits, []);
  accepted(cwd, ["update-epic", "e", "--attribute-commit", one]);
  assert.deepEqual(epicOf(cwd, "e").attributedCommits, [one]);
});

// ═══════════════ gh#216 — the array is a set against the Gate 2 head ═══════════════

test("216.1 a catch-up of an EARLIER commit leaves a head that reaches the whole set fresh", () => {
  // Z lands first, then A B C. A B C are attributed forward and Z is caught up AFTER them: the array
  // reads [A, B, C, Z] and its last entry is an ancestor of the rest.
  const { cwd, shas: [root, z, a, b, c] } = repoWith(["root", "z", "a", "b", "c"]);
  for (const sha of [a, b, c, z]) accepted(cwd, ["update-epic", "e", "--attribute-commit", sha]);
  assert.deepEqual(epicOf(cwd, "e").attributedCommits, [a, b, c, z]);
  accepted(cwd, ["record-gate-review", "e", "--gate", "2", "--verdict", "pass", "--base-sha", root, "--head-sha", c]);
  const r = accepted(cwd, ARCHIVE_DELIVERED);
  assert.ok(r.status === 0);
  assert.equal(epicOf(cwd, "e").status, "archived", "the set is reached by C, whatever the array's last entry is");
});

test("216.2 a head equal to the LAST ENTRY after a catch-up is stale, and the remedy names the true tip, not the last entry", () => {
  const { cwd, shas: [root, z, a, b] } = repoWith(["root", "z", "a", "b"]);
  for (const sha of [a, b, z]) accepted(cwd, ["update-epic", "e", "--attribute-commit", sha]);
  accepted(cwd, ["record-gate-review", "e", "--gate", "2", "--verdict", "pass", "--base-sha", root, "--head-sha", z]);
  const r = refused(cwd, ARCHIVE_DELIVERED);
  assert.ok(r.stderr.includes(b), `the refusal names the uncovered descendant: ${r.stderr}`);
  assert.match(r.stderr, /--head-sha <the attributed commit every other one is an ancestor of>/);
  assert.match(r.stderr, /--base-sha <parent of the earliest attributed commit>/);
  assert.doesNotMatch(r.stderr, /the last attributed commit/, "the remedy no longer claims position carries meaning");
});

test("216.3 integrity's bookkeeping arm dates 'the merge commit' by the latest commit, not the last array element", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const [root] = fixtureCommits(cwd, ["root"]);
  git(cwd, ["branch", "-M", "main"]);
  const tree = git(cwd, ["rev-parse", "HEAD^{tree}"]);
  const at = (parent, name, date) => git(cwd, ["commit-tree", tree, "-p", parent, "-m", name],
    { GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date });
  const older = at(root, "older", "2024-01-01T00:00:00Z");
  const newer = at(older, "newer", "2025-06-01T00:00:00Z");
  run(["add-epic", "--id", "e", "--lane", "claude-code"], { cwd });
  const seed = (reviewedAt) => {
    const s = readState(cwd);
    const e = s.epics.find(x => x.id === "e");
    // [newer, older]: the catch-up shape — the last element is NOT the latest commit.
    e.attributedCommits = [newer, older];
    e.gateReview = { gate2: { verdict: "pass", reviewedAt } };
    fs.writeFileSync(path.join(cwd, ".conductor", "state.json"), JSON.stringify(s, null, 2) + "\n");
  };
  // Reviewed BETWEEN the two commits: it precedes the real tip, so the arm must not fire. Reading the
  // last element (older, 2024) would have called it post-dating the work.
  seed("2025-03-01T00:00:00.000Z");
  let out = attempt(cwd, ["integrity"]);
  assert.doesNotMatch(out.stdout + out.stderr, /post-dates the work it claims to have reviewed/);
  // Reviewed AFTER both: it fires, and names the latest commit as the merge commit.
  seed("2026-01-01T00:00:00.000Z");
  out = attempt(cwd, ["integrity"]);
  const text = out.stdout + out.stderr;
  assert.match(text, /post-dates the work it claims to have reviewed/);
  assert.ok(text.includes(newer), "the finding names the latest-dated commit as the merge commit");
});

// ═══════════════ gh#205 — attributing after a recorded Gate 2 says what it did ═══════════════

test("205.1 attributing a commit past a passing Gate 2 says the verdict went stale and names both ways out", () => {
  const { cwd, shas: [root, a, b] } = repoWith(["root", "a", "b"]);
  accepted(cwd, ["update-epic", "e", "--attribute-commit", a]);
  accepted(cwd, ["record-gate-review", "e", "--gate", "2", "--verdict", "pass", "--base-sha", root, "--head-sha", a]);
  const r = accepted(cwd, ["update-epic", "e", "--attribute-commit", b]);
  assert.match(r.stderr, /moved 'e's passing Gate 2/, r.stderr);
  assert.match(r.stderr, /re-record Gate 2/);
  assert.match(r.stderr, /--withdraw-commit/, "the lifecycle-bookkeeping way out is named");
  // The way out works: withdrawing it leaves the verdict fresh again and the record says why.
  accepted(cwd, ["update-epic", "e", "--withdraw-commit", b, "--withdrawal-reason", "lifecycle bookkeeping"]);
  accepted(cwd, ARCHIVE_DELIVERED);
  assert.equal(epicOf(cwd, "e").status, "archived");
});

test("205.3 the advisory also fires when the first attribution lands after a Gate 2 recorded with none attributed", () => {
  const { cwd, shas: [root, a, b] } = repoWith(["root", "a", "b"]);
  accepted(cwd, ["record-gate-review", "e", "--gate", "2", "--verdict", "pass", "--base-sha", root, "--head-sha", a]);
  const r = accepted(cwd, ["update-epic", "e", "--attribute-commit", b]);
  assert.match(r.stderr, /moved 'e's passing Gate 2/, r.stderr);
});

test("205.2 no advisory when the commit is covered by the head, or when no Gate 2 is recorded", () => {
  const { cwd, shas: [root, a, b] } = repoWith(["root", "a", "b"]);
  let r = accepted(cwd, ["update-epic", "e", "--attribute-commit", a]);
  assert.doesNotMatch(r.stderr, /Gate 2/, "no verdict recorded: nothing to stale");
  accepted(cwd, ["record-gate-review", "e", "--gate", "2", "--verdict", "pass", "--base-sha", root, "--head-sha", b]);
  r = accepted(cwd, ["update-epic", "e", "--attribute-commit", b]);
  assert.doesNotMatch(r.stderr, /moved 'e's passing Gate 2/, "the head reaches b: the verdict stays fresh");
});
