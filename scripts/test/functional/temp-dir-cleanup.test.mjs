// scripts/test/functional/temp-dir-cleanup.test.mjs
// gh-cfdude-pm-224 — A TEST RUN LEAVES NO `pm-*` DIRECTORY BEHIND IN THE OS TEMP DIR.
//
// WHAT WENT WRONG. Measured 2026-09-25 in a hermetic TMPDIR: one assertion-half run left 436
// directories behind and one functional-half run left 1,517 more — `tmpRepo()` alone about 1,850 of
// them — and one machine had accumulated ~87k from months of runs, which is where slow runs had been
// blamed on the suite. Every fixture directory is now either scheduled for removal at process exit
// with `removeAtExit()` (`fixtures/temp-dir.mjs`, 0.49.0's one mechanism) or removed in a `finally`.
//
// WHY IT IS FUNCTIONAL. Its subject is what is still on disk AFTER a test process EXITS — the removal
// runs in an `exit` listener, after every test in the file has finished, so no in-process assertion
// can observe it. Observing it means starting `node --test`, which only this half may do.
//
// HOW. Each run below is a nested `node --test` whose `TMPDIR` is a fresh directory nothing else
// writes to. The count before is zero by construction (the directory is new); the count after must be
// zero too. It is NOT VACUOUS, and three things say so: the child must exit 0 having passed at least
// one test; the PROBE records every directory the fixture helpers handed it, and each must have lain
// under the hermetic TMPDIR and existed while the probe ran — so a child that ignored `TMPDIR` or
// made nothing fails here rather than reading as clean.
//
// Its assertion twin is `assert/temp-dir-cleanup.test.mjs`: each helper's directory is scheduled, and
// every `mkdtempSync` site in the tree is enrolled with the way it is removed — per commit, so a new
// unscheduled site fails before this triggered half ever runs.

import "../fixtures/hermetic-git.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { removeAtExit } from "../fixtures/temp-dir.mjs";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(TEST_DIR, "..", "fixtures");
const href = (p) => JSON.stringify(pathToFileURL(p).href);

/** The probe: every directory-making helper in `fixtures/`, called once each, the paths recorded. */
const PROBE = [
  `import ${href(path.join(FIXTURES, "functional-harness.mjs"))};`,
  `import { tmpRepo, fixtureCache, fixturePluginRoot, gitInitWithCommit, addHierarchyWorktree } from ${href(path.join(FIXTURES, "helpers.mjs"))};`,
  `import { buildFixture } from ${href(path.join(FIXTURES, "git-gateway-repo.mjs"))};`,
  'import { test } from "node:test";',
  'import assert from "node:assert/strict";',
  'import fs from "node:fs";',
  'test("probe: every directory-making fixture helper, once each", () => {',
  "  const repo = tmpRepo();",
  "  gitInitWithCommit(repo);",
  "  const fx = buildFixture();",
  "  const made = [repo, fixtureCache([\"0.1.0\"]), fixturePluginRoot(\"0.1.0\"), addHierarchyWorktree(repo, \"probe\"),",
  "    fx.attached.root, fx.attached.worktree, fx.detached.root, fx.plain];",
  "  for (const d of made) assert.ok(fs.existsSync(d), `${d} does not exist while the probe runs`);",
  "  fs.writeFileSync(process.env.PM_PROBE_OUT, JSON.stringify(made));",
  "});",
  "",
].join("\n");

/** Real site files, each run in a hermetic TMPDIR of its own. Every entry is a site `rg -n mkdtemp`
 *  found that a PASSING run reaches; a site that leaked only when its own assertion failed (removal
 *  inline, not in a `finally`) is covered by the twin's enrolment instead, since a passing run cannot
 *  show it. `namePattern` keeps a large file to the tests that reach its site. */
const SITE_RUNS = [
  { file: "assert/parity.test.mjs" },
  { file: "assert/engine-resolution.test.mjs" },
  { file: "functional/head-attachment.test.mjs" },
  { file: "functional/hermetic-git.test.mjs" },
  { file: "functional/state-write-verification.test.mjs" },
  { file: "functional/commit-resolution.test.mjs", namePattern: "^g2-1 " },
  { file: "functional/emitted-invocations.test.mjs", namePattern: "^1\\.4 " },
];

function hermeticRoot() {
  // The guard's own scratch is scheduled too — a guard against leaks must not be one.
  const root = removeAtExit(fs.mkdtempSync(path.join(os.tmpdir(), "pm-leak-guard-")));
  const tmp = path.join(root, "tmp");
  fs.mkdirSync(tmp);
  return { root, tmp };
}

function nestedRun(files, { tmp, env: extra = {}, namePattern = null }) {
  const env = { ...process.env, ...extra, TMPDIR: tmp, FORCE_COLOR: "0" };
  // Stripped, or the nested runner treats itself as a worker of this one and short-circuits.
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_TEST_WORKER_ID;
  const args = ["--test", "--test-reporter=spec"];
  if (namePattern) args.push(`--test-name-pattern=${namePattern}`);
  const r = spawnSync(process.execPath, [...args, ...files],
    { cwd: path.join(TEST_DIR, "..", "..", ".."), env, encoding: "utf8", timeout: 300_000 });
  const out = `${r.stdout || ""}${r.stderr || ""}`;
  assert.equal(r.status, 0, `the nested run of ${files.join(", ")} failed (exit ${r.status}):\n${out}`);
  const pass = Number((out.match(/^ℹ pass (\d+)$/m) || [])[1] || 0);
  assert.ok(pass > 0, `the nested run of ${files.join(", ")} passed no test — a clean temp dir would prove nothing:\n${out}`);
  return out;
}

function leftovers(tmp) {
  return fs.readdirSync(tmp).filter((n) => n.startsWith("pm-")).sort();
}

test("temp-dir-cleanup: the fixture helpers' directories are all gone once the process exits", () => {
  const { root, tmp } = hermeticRoot();
  const probe = path.join(root, "probe.test.mjs");
  const out = path.join(root, "probe-paths.json");
  fs.writeFileSync(probe, PROBE);
  nestedRun([probe], { tmp, env: { PM_PROBE_OUT: out } });
  const made = JSON.parse(fs.readFileSync(out, "utf8"));
  const realTmp = fs.realpathSync(tmp);
  for (const d of made) {
    assert.ok(d.startsWith(tmp + path.sep) || d.startsWith(realTmp + path.sep),
      `the probe's ${d} is not under the hermetic TMPDIR ${tmp} — the child ignored TMPDIR, so the count below would be vacuous`);
  }
  assert.deepEqual(leftovers(tmp), [],
    `these temp directories outlived the process that made them — schedule each with removeAtExit() ` +
    `(fixtures/temp-dir.mjs):\n  ${leftovers(tmp).join("\n  ")}`);
});

test("temp-dir-cleanup: each enrolled site file leaves nothing behind", () => {
  assert.ok(SITE_RUNS.length > 0, "no site files enrolled — this test would pass having run nothing");
  const left = {};
  for (const { file, namePattern = null } of SITE_RUNS) {
    const { tmp } = hermeticRoot();
    nestedRun([path.join(TEST_DIR, "..", file)], { tmp, namePattern });
    if (leftovers(tmp).length) left[file + (namePattern ? ` /${namePattern}/` : "")] = leftovers(tmp);
  }
  assert.deepEqual(left, {},
    "these site files left temp directories behind once their process exited — schedule each with removeAtExit()");
});
