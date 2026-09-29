// scripts/test/functional/record-isolation.test.mjs
// test-isolation-guard — the FUNCTIONAL half of id `record-isolation`; its assertion twin is
// scripts/test/assert/record-isolation.test.mjs.
//
// THE SUBJECT IS THE PROCESS BOUNDARY: `fixtures/record-isolation.mjs` fails a test FILE through an
// `exit` listener, and only a real `node --test` run can show that the runner then reports the file
// `✖` and exits non-zero. Each case writes a throwaway test file that loads the guard, runs it under
// a real runner, and reads the status and output back. The record the guard protects is a scratch
// repository named through `PM_TEST_PROTECTED_ROOT` or an inherited `CLAUDE_PROJECT_DIR` — never this
// repository's, which this file must not write either.

import "../fixtures/record-isolation.mjs";   // no test may write the developer's real .conductor record
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { removeAtExit } from "../fixtures/temp-dir.mjs";

const GUARD = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "record-isolation.mjs");

/** A scratch repository holding a `.conductor/state.json`, standing in for the developer's checkout. */
function realRepo() {
  const root = removeAtExit(fs.mkdtempSync(path.join(os.tmpdir(), "pm-record-isolation-real-")));
  fs.mkdirSync(path.join(root, ".conductor"));
  fs.writeFileSync(path.join(root, ".conductor", "state.json"), "{\"epics\":[]}\n");
  return root;
}

/** Run `body` as the one test of a fresh file that loads the guard first, under a real runner. */
function runGuarded(body, env) {
  const dir = removeAtExit(fs.mkdtempSync(path.join(os.tmpdir(), "pm-record-isolation-run-")));
  const file = path.join(dir, "case.test.mjs");
  fs.writeFileSync(file, [
    `import ${JSON.stringify(pathToFileURL(GUARD).href)};`,
    'import { test } from "node:test";',
    'import assert from "node:assert/strict";',
    'import fs from "node:fs";',
    'import path from "node:path";',
    `test("case", () => { ${body} });`,
  ].join("\n"));
  const childEnv = { ...process.env, ...env, FORCE_COLOR: "0" };
  // node --test marks itself on these; inherited, the nested runner acts as a worker and runs nothing.
  delete childEnv.NODE_TEST_CONTEXT;
  delete childEnv.NODE_TEST_WORKER_ID;
  for (const k of Object.keys(env)) if (env[k] === undefined) delete childEnv[k];
  const r = spawnSync(process.execPath, ["--test", "--test-reporter=spec", file], { cwd: dir, env: childEnv, encoding: "utf8" });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

test("a test that writes the protected record fails its file: ✖, exit 1, and the path is named", () => {
  const real = realRepo();
  const r = runGuarded(
    `fs.writeFileSync(${JSON.stringify(path.join(real, ".conductor", "state.json"))}, '{"epics":[{"id":"alpha"}]}');`,
    { PM_TEST_PROTECTED_ROOT: real, CLAUDE_PROJECT_DIR: undefined });
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /✖ .*case\.test\.mjs/, "the runner reports the FILE failed, though its one test passed");
  assert.ok(r.out.includes(`${path.join(real, ".conductor", "state.json")} (changed)`), r.out);
});

test("a log line appended to an inherited CLAUDE_PROJECT_DIR's record is caught the same way", () => {
  const real = realRepo();
  const r = runGuarded(
    `fs.appendFileSync(${JSON.stringify(path.join(real, ".conductor", "honcho-memories.log"))}, "paused X for Y\\n");`,
    { CLAUDE_PROJECT_DIR: real, PM_TEST_PROTECTED_ROOT: undefined });
  assert.equal(r.status, 1, r.out);
  assert.ok(r.out.includes(`${path.join(real, ".conductor", "honcho-memories.log")} (added)`), r.out);
});

test("the pin: an inherited CLAUDE_PROJECT_DIR is unset, so the engine's fallback lands in the test's cwd, not the real record", () => {
  const real = realRepo();
  const before = fs.readFileSync(path.join(real, ".conductor", "state.json"));
  const r = runGuarded([
    "assert.equal(process.env.CLAUDE_PROJECT_DIR, undefined);",
    // What the engine's `CLAUDE_PROJECT_DIR || cwd` resolution does with the root it is left:
    'const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();',
    `assert.notEqual(root, ${JSON.stringify(real)});`,
    'fs.mkdirSync(path.join(root, ".conductor"));',
    'fs.writeFileSync(path.join(root, ".conductor", "state.json"), "{}");',
  ].join(" "), { CLAUDE_PROJECT_DIR: real, PM_TEST_PROTECTED_ROOT: undefined });
  assert.equal(r.status, 0, r.out);
  assert.doesNotMatch(r.out, /record-isolation:/);
  assert.ok(fs.readFileSync(path.join(real, ".conductor", "state.json")).equals(before));
});

test("a clean test file passes, and a record that stays absent is not a leak", () => {
  const empty = removeAtExit(fs.mkdtempSync(path.join(os.tmpdir(), "pm-record-isolation-none-")));
  const r = runGuarded("assert.ok(true);", { PM_TEST_PROTECTED_ROOT: empty, CLAUDE_PROJECT_DIR: undefined });
  assert.equal(r.status, 0, r.out);
  assert.doesNotMatch(r.out, /record-isolation:/);
});
