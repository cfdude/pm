// scripts/test/functional/git-shim.test.mjs
// 0.49.0 task 2.4c — "A real git call in any file's process fails the run", as a DURABLE test
// (suite-certification, Gate 1 I3).
//
// WHY IT IS FUNCTIONAL. Its subject is the process boundary: a test file that runs in a process of its
// own — the runner's default per-file isolation — installs the shim, reaches `git` through a library
// call the way a direct lib call reaches the real gateway, and TOLERATES the shim's exit 128 the way
// every real caller does. Nothing in that file fails. The run must fail anyway, because the shim's exit
// listener sets `process.exitCode = 1` and the runner reports that file as failed. Observing it means
// starting `node --test`, which only this half may do.
//
// Its assertion twin is `assert/git-shim.test.mjs`, which exercises the shim's removal function and
// the harness's exit-time schedule.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ENGINE } from "../fixtures/functional-harness.mjs";

const SHIM = path.join(path.dirname(ENGINE), "test", "fixtures", "assert-git-shim.mjs");

test("2.4c a real git call in a file's OWN process fails the run — the exit listener reports the argv", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-git-shim-run-"));
  try {
    const file = path.join(dir, "reaches-git.test.mjs");
    fs.writeFileSync(file,
      `import ${JSON.stringify(pathToFileURL(SHIM).href)};\n` +
      'import { test } from "node:test";\n' +
      'import { execFileSync } from "node:child_process";\n' +
      'test("reaches git through a library call, and tolerates its failure like every real caller", () => {\n' +
      '  try { execFileSync("git", ["--version"], { stdio: "pipe" }); } catch { /* exit 128 is tolerated */ }\n' +
      "});\n");
    // THE RUNNER IS STARTED EXACTLY AS THE HOOK STARTS IT: one reporter, no colour. NODE_TEST_CONTEXT is
    // stripped, or the nested runner would treat itself as a worker of this one and short-circuit.
    const env = { ...process.env, FORCE_COLOR: "0" };
    delete env.NODE_TEST_CONTEXT;
    delete env.NODE_TEST_WORKER_ID;
    const r = spawnSync(process.execPath, ["--test", "--test-reporter=spec", file],
      { cwd: dir, env, encoding: "utf8", timeout: 60_000 });
    const out = `${r.stdout || ""}${r.stderr || ""}`;
    assert.equal(r.status, 1,
      `a file whose process reached the real git must fail the run, and the run exited ${r.status}: ${out}`);
    assert.match(out, /^ℹ fail 1$/m, `the runner must count the file as one failure: ${out}`);
    assert.match(out, /REAL 'git' invocation\(s\) reached the shim/,
      `the shim's exit listener must say what happened: ${out}`);
    assert.match(out, /^ {2}git --version$/m, `and it must name the argv that reached the shim: ${out}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
