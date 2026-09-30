// release-candidate-staleness — converged-release-candidate-review 3.2, D2.
//
// THE CLAIM UNDER TEST: the converged verdict needs NO new verb. It is N ordinary Gate 2 records at one
// range, and the existing staleness rule already checks each — so a verdict recorded before a fix
// commit is stale for the member the fix was attributed to, and re-recording at a head that reaches the
// fix clears it. This needs real git (the rule resolves ancestry through `git`), so it is functional;
// the assertion twin (unit/release-candidate-staleness) pins what needs no commit graph.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { ENGINE, EMPTY_CACHE, tmpRepo, run, readState, gitInitWithCommit, commitFiles } from "../fixtures/functional-harness.mjs";

const headSha = (cwd) => execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
const stateBytes = (cwd) => fs.readFileSync(path.join(cwd, ".conductor", "state.json"));
const epicOf = (cwd, id) => readState(cwd).epics.find(e => e.id === id);

function attempt(cwd, args) {
  const r = spawnSync("node", [ENGINE, ...args], {
    cwd, encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, PM_CACHE_ROOT: EMPTY_CACHE },
  });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}
const ARCHIVE_DELIVERED = ["--status", "archived", "--outcome", "delivered", "--no-deferrals"];

/** A release `r1` with two openspec-lane candidate members, each with one attributed commit, on real
 *  history: root, then `first` (a's), then `second` (b's). */
function candidate() {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  gitInitWithCommit(cwd);
  const root = headSha(cwd);
  commitFiles(cwd, { "a.txt": "a" }, "feat: member a");
  const first = headSha(cwd);
  commitFiles(cwd, { "b.txt": "b" }, "feat: member b");
  const second = headSha(cwd);
  return { cwd, root, first, second };
}

function seed() {
  const c = candidate();
  const { cwd } = c;
  for (const id of ["a", "b"]) run(["add-epic", "--id", id, "--lane", "openspec"], { cwd });
  run(["release", "r1", "--intent", "the candidate", "--member", "a", "--member", "b"], { cwd });
  run(["update-epic", "a", "--attribute-commit", c.first], { cwd });
  run(["update-epic", "b", "--attribute-commit", c.second], { cwd });
  return c;
}

const record = (cwd, id, base, head) =>
  run(["record-gate-review", id, "--gate", "2", "--verdict", "pass", "--base-sha", base, "--head-sha", head, "--reviewer", "rc"], { cwd });

test("3.2 A verdict recorded before a fix is stale, and re-recording at a head that reaches the fix clears it", () => {
  const { cwd, root, second } = seed();
  // The converged verdict: the SAME range recorded once per candidate member, through the existing verb.
  record(cwd, "a", root, second);
  record(cwd, "b", root, second);
  const shown = run(["release", "show", "r1"], { cwd });
  assert.match(shown, new RegExp(`candidate review: converged at \`${second}\``));

  // A fix lands on member a's code and is attributed to a. b is untouched.
  commitFiles(cwd, { "a.txt": "a-fixed" }, "fix: member a after review");
  const fix = headSha(cwd);
  run(["update-epic", "a", "--attribute-commit", fix], { cwd });

  // The verdict recorded before the fix does not reach it: a `delivered` archive is refused, naming the fix.
  const before = stateBytes(cwd);
  const refused = attempt(cwd, ["update-epic", "a", ...ARCHIVE_DELIVERED]);
  assert.notEqual(refused.status, 0, "a verdict recorded before the fix must not let the member archive");
  assert.ok(refused.stderr.includes(fix), `the refusal names the fix commit ${fix}: ${refused.stderr}`);
  assert.ok(stateBytes(cwd).equals(before), "the refusal wrote nothing");
  // Re-record at a head that reaches the fix (for every candidate member, at the one range).
  record(cwd, "a", root, fix);
  record(cwd, "b", root, fix);
  assert.match(run(["release", "show", "r1"], { cwd }), new RegExp(`converged at \`${fix}\``));
  // A pass now: the archive of a is ACCEPTED, and the fix is no longer uncovered.
  const again = attempt(cwd, ["update-epic", "a", ...ARCHIVE_DELIVERED]);
  assert.equal(again.status, 0, `a verdict at a head that reaches the fix lets the member archive: ${again.stderr}`);
  assert.equal(epicOf(cwd, "a").status, "archived");
  // Once a is archived it is no longer a candidate member: the read-back now covers b alone.
  assert.match(run(["release", "show", "r1"], { cwd }), /1 member\b/);
  assert.equal(epicOf(cwd, "a").gateReview.gate2.headSha, fix);
});

test("3.2 a Gate 2 pass without a range is refused per member, exactly as for any change (no release-level path)", () => {
  const { cwd } = seed();
  const before = stateBytes(cwd);
  const r = attempt(cwd, ["record-gate-review", "a", "--gate", "2", "--verdict", "pass"]);
  assert.notEqual(r.status, 0);
  assert.ok(stateBytes(cwd).equals(before));
});
