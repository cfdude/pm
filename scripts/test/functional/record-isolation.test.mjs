// scripts/test/functional/record-isolation.test.mjs
// test-isolation-guard — the FUNCTIONAL half of id `record-isolation`; its assertion twin is
// scripts/test/assert/record-isolation.test.mjs.
//
// THE SUBJECT IS THE PROCESS BOUNDARY: `fixtures/record-isolation.mjs` fails a test FILE through an
// `exit` listener, and only a real `node --test` run can show that the runner then reports the file
// `✖` and exits non-zero; and the PIN is only proven by a real engine spawned the way the 2026-09-21
// leak spawned it. Each case writes a throwaway test file that loads the guard, runs it under a real
// runner, and reads the status and output back. The record the guard protects is a scratch
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
import { ENGINE, EMPTY_CACHE, tmpRepo, run } from "../fixtures/functional-harness.mjs";

const GUARD = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "record-isolation.mjs");

/** A scratch repository holding a `.conductor/state.json`, standing in for the developer's checkout. */
function realRepo() {
  const root = removeAtExit(fs.mkdtempSync(path.join(os.tmpdir(), "pm-record-isolation-real-")));
  fs.mkdirSync(path.join(root, ".conductor"));
  fs.writeFileSync(path.join(root, ".conductor", "state.json"), "{\"epics\":[]}\n");
  return root;
}

/** Run `body` as the one test of a fresh file that loads the guard first, under a real runner. `env`
 *  entries set to `undefined` are removed; the parent's own pin marker is always dropped, so each case
 *  states exactly the CLAUDE_PROJECT_DIR it inherits. */
function runGuarded(body, env, { cwd } = {}) {
  const dir = removeAtExit(fs.mkdtempSync(path.join(os.tmpdir(), "pm-record-isolation-run-")));
  const file = path.join(dir, "case.test.mjs");
  fs.writeFileSync(file, [
    `import ${JSON.stringify(pathToFileURL(GUARD).href)};`,
    'import { test } from "node:test";',
    'import assert from "node:assert/strict";',
    'import { spawnSync } from "node:child_process";',
    'import fs from "node:fs";',
    'import path from "node:path";',
    `test("case", () => {\n${body}\n});`,
  ].join("\n"));
  const childEnv = { ...process.env, PM_TEST_PINNED_ROOT: undefined, ...env, FORCE_COLOR: "0" };
  // node --test marks itself on these; inherited, the nested runner acts as a worker and runs nothing.
  delete childEnv.NODE_TEST_CONTEXT;
  delete childEnv.NODE_TEST_WORKER_ID;
  for (const k of Object.keys(childEnv)) if (childEnv[k] === undefined) delete childEnv[k];
  const r = spawnSync(process.execPath, ["--test", "--test-reporter=spec", file],
    { cwd: cwd ?? dir, env: childEnv, encoding: "utf8" });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

test("a test that writes the protected record fails its file: ✖, exit 1, and the path is named with its mtime", () => {
  const real = realRepo();
  const r = runGuarded(
    `fs.writeFileSync(${JSON.stringify(path.join(real, ".conductor", "state.json"))}, '{"epics":[{"id":"alpha"}]}');`,
    { PM_TEST_PROTECTED_ROOT: real, CLAUDE_PROJECT_DIR: undefined });
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /✖ .*case\.test\.mjs/, "the runner reports the FILE failed, though its one test passed");
  assert.ok(r.out.includes(`${path.join(real, ".conductor", "state.json")} (changed; mtime `), r.out);
  assert.match(r.out, /s after this process started\)/);
});

test("a log line appended to an inherited CLAUDE_PROJECT_DIR's record is caught the same way", () => {
  const real = realRepo();
  const r = runGuarded(
    `fs.appendFileSync(${JSON.stringify(path.join(real, ".conductor", "honcho-memories.log"))}, "paused X for Y\\n");`,
    { CLAUDE_PROJECT_DIR: real, PM_TEST_PROTECTED_ROOT: undefined });
  assert.equal(r.status, 1, r.out);
  assert.ok(r.out.includes(`${path.join(real, ".conductor", "honcho-memories.log")} (added; `), r.out);
});

test("a root file the engine writes (CLAUDE.md) is protected as well as the .conductor record", () => {
  const real = realRepo();
  fs.writeFileSync(path.join(real, "CLAUDE.md"), "# rules\n");
  const r = runGuarded(
    `fs.appendFileSync(${JSON.stringify(path.join(real, "CLAUDE.md"))}, "<!-- leaked rules block -->\\n");`,
    { PM_TEST_PROTECTED_ROOT: real, CLAUDE_PROJECT_DIR: undefined });
  assert.equal(r.status, 1, r.out);
  assert.ok(r.out.includes(`${path.join(real, "CLAUDE.md")} (changed; `), r.out);
});

test("the pin PREVENTS the 2026-09-21 shape: an engine spawned with ...process.env from inside the real repo writes nothing there", () => {
  // The developer's checkout: an initialized conductor, exported as CLAUDE_PROJECT_DIR AND the test's
  // cwd — the worst case, where an unset variable would fall back to the real repository as well.
  const real = tmpRepo();
  run(["init", "--platform", "claude-code"], { cwd: real });
  const before = fs.readFileSync(path.join(real, ".conductor", "state.json"));
  const r = runGuarded([
    "assert.equal(process.env.CLAUDE_PROJECT_DIR, process.env.PM_TEST_PINNED_ROOT);",
    "assert.deepEqual(fs.readdirSync(process.env.CLAUDE_PROJECT_DIR), []);",
    `const s = spawnSync(process.execPath, [${JSON.stringify(ENGINE)}, "add-epic", "--id", "alpha", "--lane", "claude-code"],`,
    `  { cwd: ${JSON.stringify(real)}, env: { ...process.env, PM_CACHE_ROOT: ${JSON.stringify(EMPTY_CACHE)} }, encoding: "utf8" });`,
    'assert.equal(s.status, 1, "the pinned root is not a conductor, so the verb refuses: " + s.stderr);',
  ].join("\n"), { CLAUDE_PROJECT_DIR: real, PM_TEST_PROTECTED_ROOT: undefined }, { cwd: real });
  assert.equal(r.status, 0, r.out);
  assert.doesNotMatch(r.out, /record-isolation:/);
  assert.ok(fs.readFileSync(path.join(real, ".conductor", "state.json")).equals(before),
    "the real record is byte-identical: the leak was prevented, not merely detected");
});

test("a clean test file passes, and a record that stays absent is not a leak", () => {
  const empty = removeAtExit(fs.mkdtempSync(path.join(os.tmpdir(), "pm-record-isolation-none-")));
  const r = runGuarded("assert.ok(true);", { PM_TEST_PROTECTED_ROOT: empty, CLAUDE_PROJECT_DIR: undefined });
  assert.equal(r.status, 0, r.out);
  assert.doesNotMatch(r.out, /record-isolation:/);
});
