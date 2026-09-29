// scripts/test/unit/certify-index.test.mjs
// certification-record-redesign task 1.1 (design D2) — THE RUN PLAN IS A VALUE.
//
// The certify runner used to run a bucket in the CHECKOUT and hash WORKING-TREE bytes (#230), while
// the commit, and since 0.50.0 the pre-commit hook, judge the INDEX. D2 moves the run onto one COPY
// of the index: the manifest is read from that copy, and the bytes the bucket runs over are exported
// from that copy into a `clone --shared`, so what ran and what is recorded come from one moment.
//
// The sequence is extracted as `indexRunPlan()`, a pure function of four values, so the property
// that matters — every read after the first goes to the COPY, and the live index is read exactly
// once — is asserted here on the plan itself, over no filesystem and no git. The functional twin
// (`functional/certify-index.test.mjs`) runs the plan against a real repository.
//
// UNIT RUNG: every observable below is a value the function returned.

import assert from "node:assert/strict";
import path from "node:path";
import * as certification from "../certification.mjs";
import * as certify from "../certify.mjs";
import { unitTest } from "../fixtures/unit-harness.mjs";

const INPUT = Object.freeze({
  indexFile: "/repo/.git/index",
  commonDir: "/repo/.git",
  headSha: "0123456789abcdef0123456789abcdef01234567",
  tmp: "/tmp/pm-certify-run.abc123",
});

function plan(over = {}) {
  assert.equal(typeof certification.indexRunPlan, "function",
    "certification.mjs exports no indexRunPlan(): the run plan is not a value, so which index the " +
    "runner reads cannot be asserted without running it");
  return certification.indexRunPlan({ ...INPUT, ...over });
}

/** The index of the first step matching `pred`, asserted to exist. */
function stepAt(steps, what, pred) {
  const i = steps.findIndex(pred);
  assert.notEqual(i, -1, `the plan has no ${what} step: ${JSON.stringify(steps)}`);
  return i;
}

const isGit = (sub) => (s) => s.op === "git" && s.args.includes(sub);

unitTest("1.1 the plan copies the index, reads its manifest, clones shared, sets HEAD and exports, in that order", () => {
  const p = plan();
  const { steps } = p;
  const copy = stepAt(steps, "index copy", (s) => s.op === "copy" && s.from === INPUT.indexFile);
  const manifest = stepAt(steps, "ls-files -s", isGit("ls-files"));
  const clone = stepAt(steps, "clone", isGit("clone"));
  const head = stepAt(steps, "update-ref", isGit("update-ref"));
  const copyIn = stepAt(steps, "copy into the clone", (s) => s.op === "copy" && s.from === p.copy);
  const exportAt = stepAt(steps, "checkout-index", isGit("checkout-index"));
  assert.deepEqual([copy, manifest, clone, head, copyIn, exportAt], [...[copy, manifest, clone, head, copyIn, exportAt]].sort((a, b) => a - b),
    "the steps are out of order: the index is copied FIRST, and the export runs LAST, over the copy");
  assert.equal(steps.length, 6, `the plan has steps nobody asked for: ${JSON.stringify(steps)}`);

  assert.deepEqual(steps[manifest].args.slice(steps[manifest].args.indexOf("ls-files")), ["ls-files", "-s", "-z"],
    "the manifest is `ls-files -s` (mode, blob id, stage, path), NUL-separated so no path is quoted");
  assert.deepEqual(steps[clone].args, ["clone", "--shared", "--no-checkout", "-q", INPUT.commonDir, p.tree],
    "the run directory is a SHARED clone of the common dir, with nothing checked out by clone itself");
  assert.deepEqual(steps[head].args, ["-C", p.tree, "update-ref", "--no-deref", "HEAD", INPUT.headSha],
    "the clone's HEAD is set to THIS worktree's HEAD, detached — clone would otherwise take the common repository's default");
  assert.deepEqual(steps[exportAt].args, ["-C", p.tree, "checkout-index", "-a", "-f"],
    "the export is every index entry, forced, inside the clone");
});

unitTest("1.1 the manifest and the export both read the COPY, and the live index is read exactly once", () => {
  const p = plan();
  const { steps } = p;
  assert.ok(p.copy.startsWith(`${INPUT.tmp}${path.sep}`), `the index copy ${p.copy} is not under the run directory`);
  assert.ok(p.tree.startsWith(`${INPUT.tmp}${path.sep}`), `the clone ${p.tree} is not under the run directory`);

  const ls = steps.find(isGit("ls-files"));
  assert.deepEqual(ls.env, { GIT_INDEX_FILE: p.copy },
    "the manifest must be read from the index COPY, never the live index a concurrent `git add` can change");

  const copyIn = steps.find((s) => s.op === "copy" && s.from === p.copy);
  assert.equal(copyIn.to, path.join(p.tree, ".git", "index"),
    "the clone's index must BE the copy, so checkout-index exports the same entries the manifest read");
  const exp = steps.find(isGit("checkout-index"));
  assert.equal(exp.env, undefined, "the export reads the clone's own index (the copy), with no index override");

  const namesLive = steps.filter((s) => JSON.stringify(s).includes(INPUT.indexFile));
  assert.deepEqual(namesLive, [{ op: "copy", from: INPUT.indexFile, to: p.copy }],
    "the LIVE index may be named by exactly one step, the copy; any other reader could see a later `git add`");
});

unitTest("1.1 the plan never names a worktree, the stash, GIT_DIR or GIT_WORK_TREE", () => {
  const text = JSON.stringify(plan());
  for (const banned of [/worktree/i, /stash/i, /GIT_DIR/, /GIT_WORK_TREE/]) {
    assert.doesNotMatch(text, banned,
      `the plan names ${banned}: a registered worktree orphaned by a SIGKILL breaks every session on the ` +
      "machine, the stash is shared by every worktree, and an exported GIT_DIR/GIT_WORK_TREE points every " +
      "test's child git at the user's repository (design D2, alternatives rejected)");
  }
});

unitTest("1.1 an unborn HEAD sets no HEAD in the clone, and the plan is a pure function of its input", () => {
  const unborn = plan({ headSha: null });
  assert.equal(unborn.steps.some(isGit("update-ref")), false,
    "with no HEAD there is no commit to point the clone at; the export still runs over the copy");
  assert.ok(unborn.steps.some(isGit("checkout-index")));
  assert.deepEqual(plan(), plan(), "two calls over the same input returned different plans");
});

// ─────────────── 1.2 — the run's environment (certify.mjs) ───────────────
//
// The runner executes the plan and the bucket with the caller's environment MINUS the variables git
// sets for a hook process. An inherited GIT_DIR, GIT_WORK_TREE or GIT_INDEX_FILE would point the
// run's git (the clone, the export, every test's child git) at the user's repository or index
// instead of the run directory's — the leak `.githooks/pre-commit` scrubs for the same reason. The
// functional twin runs the runner; this pins the scrub as a value.

unitTest("1.2 the run's environment drops every variable git sets for a hook, and keeps the rest", () => {
  assert.equal(typeof certify.cleanEnv, "function", "certify.mjs exports no cleanEnv(): the run's environment cannot be asserted");
  const hookEnv = Object.fromEntries(certify.HOOK_GIT_VARS.map((k) => [k, `/somewhere/${k}`]));
  const out = certify.cleanEnv({ ...hookEnv, PATH: "/bin", PM_KEEP: "yes" });
  for (const k of ["GIT_DIR", "GIT_INDEX_FILE", "GIT_WORK_TREE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_PREFIX"]) {
    assert.equal(k in out, false, `${k} reached the run: its git would read the user's repository, not the run directory`);
  }
  assert.deepEqual(out, { PATH: "/bin", PM_KEEP: "yes" }, "everything else in the environment is passed through");
  const input = { GIT_DIR: "/x", KEEP: "1" };
  certify.cleanEnv(input);
  assert.deepEqual(input, { GIT_DIR: "/x", KEEP: "1" }, "the scrub returns a copy; the caller's object is not modified");
});
