// deliveredObligations(epic, {carriedTo}) — THE one definition of the two obligations a
// `delivered` outcome carries (the Gate 2 demand and the handoff demand). The archive gate and
// the archived-epic regression check both call it, so they cannot disagree about what "met" means.
//
// Evaluated in a CHILD process whose CLAUDE_PROJECT_DIR is a fixture repository: the staleness
// half asks git, and lib/constants.mjs resolves the repository root once, at module load.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpRepo, run, gitInitWithCommit, commitFiles } from "./helpers.mjs";

const ARCHIVE_GATE = new URL("../lib/archive-gate.mjs", import.meta.url).href;
const headSha = (cwd) => execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();

/** deliveredObligations(epic, opts), computed inside `cwd`. */
function obligations(cwd, epic, opts) {
  const script =
    `import { deliveredObligations } from ${JSON.stringify(ARCHIVE_GATE)};\n` +
    `const [epic, opts] = JSON.parse(process.env.PM_FIXTURE);\n` +
    `process.stdout.write(JSON.stringify(deliveredObligations(epic, opts)));\n`;
  const r = spawnSync("node", ["--input-type=module", "-e", script], {
    cwd, encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, PM_FIXTURE: JSON.stringify([epic, opts]) },
  });
  assert.equal(r.status, 0, `deliveredObligations could not be evaluated: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

/** A repository holding a root commit and two delivery commits. */
function fixtureRepo() {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  gitInitWithCommit(cwd);
  const root = headSha(cwd);
  commitFiles(cwd, { "one.txt": "1" }, "feat: first");
  const first = headSha(cwd);
  commitFiles(cwd, { "two.txt": "2" }, "feat: second");
  return { cwd, root, first, second: headSha(cwd) };
}

const { cwd, root, first, second } = fixtureRepo();
const passing = (headSha) => ({ gate2: { verdict: "pass", baseSha: root, headSha, reviewedAt: "2026-09-14T00:00:00.000Z" } });
const epic = (fields) => ({ id: "e", title: "e", priority: "P1", status: "archived", role: "epic", links: [], ...fields });

test("met: a covering passing Gate 2 and no outstanding work fail nothing", () => {
  const met = epic({ lane: "openspec", attributedCommits: [first, second], gateReview: passing(second),
    stories: [{ title: "done", done: true }] });
  assert.deepEqual(obligations(cwd, met, {}), []);
});

test("no Gate 2: the Gate 2 demand fails, with its finding as the detail", () => {
  const out = obligations(cwd, epic({ lane: "openspec" }), {});
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, "gate2");
  assert.match(out[0].detail, /missing a passing Gate 2/);
  assert.doesNotMatch(out[0].detail, /record-gate-review/, "the gate's remedy is not part of the finding");
  assert.deepEqual(out[0].items, []);
});

test("stale: a passing Gate 2 that does not cover the last attribution fails, naming the uncovered commit", () => {
  const out = obligations(cwd, epic({ lane: "openspec", attributedCommits: [first, second], gateReview: passing(first) }), {});
  assert.deepEqual(out.map(o => o.kind), ["gate2"]);
  assert.ok(out[0].detail.includes(second), `the detail names ${second}: ${out[0].detail}`);
  assert.doesNotMatch(out[0].detail, /Re-review/, "the gate's remedy is not part of the finding");

  const withdrawn = obligations(cwd, epic({ lane: "openspec", attributedCommits: [], gateReview: passing(first),
    withdrawnCommits: [{ sha: first, reason: "wrong", withdrawnAt: "2026-09-14T00:00:00.000Z" }] }), {});
  assert.deepEqual(withdrawn.map(o => o.kind), ["gate2"], "an attribution-withdrawn record fails the Gate 2 demand too");
});

test("outstanding story: the handoff demand fails, carrying the titles as items and never in the detail", () => {
  const record = epic({ lane: "claude-code", stories: [{ title: "shipped", done: true }, { title: "left behind", done: false }] });
  const out = obligations(cwd, record, {});
  assert.deepEqual(out.map(o => o.kind), ["handoff"]);
  assert.deepEqual(out[0].items, [{ n: 2, title: "left behind" }]);
  assert.ok(!out[0].detail.includes("left behind"), "a user-supplied title is data, not part of the detail");
  assert.deepEqual(obligations(cwd, record, { carriedTo: "z" }), [], "a named receiver meets the handoff demand");
});

test("both failing: Gate 2 comes first", () => {
  const out = obligations(cwd, epic({ lane: "openspec", stories: [{ title: "left", done: false }] }), {});
  assert.deepEqual(out.map(o => o.kind), ["gate2", "handoff"]);
});

test("a non-delivered outcome is not tested: the same record reports identically", () => {
  const base = { lane: "openspec", stories: [{ title: "left", done: false }] };
  const delivered = obligations(cwd, epic({ ...base, disposition: { outcome: "delivered", recordedAt: "2026-09-14T00:00:00.000Z" } }), {});
  const superseded = obligations(cwd, epic({ ...base, disposition: { outcome: "superseded", reason: "r", recordedAt: "2026-09-14T00:00:00.000Z" } }), {});
  assert.deepEqual(superseded, delivered);
  assert.equal(superseded.length, 2);
});
