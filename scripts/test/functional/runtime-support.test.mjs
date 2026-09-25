// scripts/test/functional/runtime-support.test.mjs
// 0.49.0 task 3.2 — THE COMMAND-LINE PATH of the runtime version (engine-invocation's "The command
// line consults the version its process reports", Gate 1 B2).
//
// WHY IT IS FUNCTIONAL. Its subject is the process: the version the command line consults is the one
// the running `node` REPORTS, and the only way to make a real process report a version below the
// support floor without installing an old Node is to start one with a preload that redefines
// `process.version` (it is `configurable: true`). Starting a process is this half's alone. Its twin is
// `unit/runtime-support.test.mjs`, which covers every decision the line makes over an in-memory record.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ENGINE, EMPTY_CACHE, run, tmpRepo } from "../fixtures/functional-harness.mjs";

const LINE = /^⚠ Node .* is below pm's support floor \(Node \d+, the oldest supported LTS line\)/m;

/** `brief` from the command line in an initialized repository, optionally under a preload. */
function cliBrief(cwd, preload) {
  const args = [...(preload ? ["--import", pathToFileURL(preload).href] : []), ENGINE, "brief", "--platform", "claude-code"];
  const r = spawnSync(process.execPath, args, {
    cwd, encoding: "utf8", timeout: 30_000,
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, PM_CACHE_ROOT: EMPTY_CACHE },
  });
  assert.equal(r.status, 0, `brief must exit 0 from the command line: ${r.stderr}`);
  return JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
}

test("3.2 the command line consults the version its PROCESS reports — below the floor, one line; otherwise none", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-node-version-preload-"));
  try {
    const preload = path.join(dir, "old-node.mjs");
    fs.writeFileSync(preload, 'Object.defineProperty(process, "version", { value: "v20.20.2" });\n');
    const below = cliBrief(cwd, preload);
    assert.match(below.split("\n")[0], LINE, `a process reporting v20.20.2 must get the line first: ${below}`);
    assert.match(below.split("\n")[0], /Node v20\.20\.2 is below pm's support floor \(Node 22,/,
      "the line names the version the process reported and the support floor");
    const own = cliBrief(cwd, null);
    assert.doesNotMatch(own, LINE,
      `without the preload the process reports its own supported version (${process.version}), and there is no line`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
