// Guards scripts/test/hermetic-git.mjs. Each assertion is written to fail on CI as well as on a
// developer machine when the module stops doing its job — CI has no global template directory and
// no signing config, so a test that only checked "no hooks appeared" would pass there vacuously.

import "../fixtures/hermetic-git.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

test("a fixture git init copies no hooks, even when a template directory is configured", () => {
  // Configure a template that WOULD install a hook, at a precedence (command-line -c) higher than
  // any global config — so without GIT_TEMPLATE_DIR this fails on every machine, CI included.
  const template = tmp("pm-fake-template-");
  fs.mkdirSync(path.join(template, "hooks"));
  fs.writeFileSync(path.join(template, "hooks", "pre-commit"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  const repo = tmp("pm-hermetic-");
  execFileSync("git", ["-c", `init.templateDir=${template}`, "init", "-q"], { cwd: repo });
  const hooks = fs.existsSync(path.join(repo, ".git", "hooks"))
    ? fs.readdirSync(path.join(repo, ".git", "hooks")) : [];
  assert.deepEqual(hooks, [], `the configured template's hooks were copied: ${hooks.join(", ")}`);
});

test("a fixture commit is not signed, whatever the developer's global config says", () => {
  const repo = tmp("pm-hermetic-");
  execFileSync("git", ["init", "-q"], { cwd: repo });
  // "false", not merely "not true": on CI the key is otherwise UNSET, and an unset key would let
  // this pass without the module.
  const value = execFileSync("git", ["config", "--get", "commit.gpgsign"], { cwd: repo, encoding: "utf8" }).trim();
  assert.equal(value, "false");
});

test("every FUNCTIONAL test file that mentions git imports the hermetic module, directly or through its harness", () => {
  // NARROWED BY 5.7, AND HERE IS THE NARROWING. The predicate used to walk every file in
  // scripts/test/ and refuse one that contained the string "git" without importing the hermetic
  // module. After the split that walks the assertion half too — where the string "git" is drawn on
  // by the fake's canned output (`headRef`, `worktreeList`, `diff-tree` answers) and by every
  // comment about the double, while the file never runs git at all. Those files are not offenders;
  // they are the half that exists precisely so git is never run per commit, and the old predicate
  // would have made the guard fire on the design.
  //
  // SCOPE IS THEREFORE THE HALF THAT CAN RUN GIT — scripts/test/functional/, which is the only half
  // whose files may spawn one (assert-half-has-no-spawn.test.mjs refuses the other half outright,
  // so the property this guard protects is not lost by the narrowing; it is enforced by a stronger
  // check on the side this one gives up).
  //
  // ACCEPTANCE WIDENED IN THE SAME MOVE: a functional file reaches the hermetic module through
  // `../fixtures/functional-harness.mjs`, which re-exports `fixtures/helpers.mjs`, whose FIRST
  // import is `./hermetic-git.mjs`. A file that imports the harness has the module; the old
  // `/helpers\.mjs|hermetic-git\.mjs/` would have called every one of them an offender.
  const HALF = path.join(TEST_DIR, "..", "functional");
  const files = fs.readdirSync(HALF).filter(f => f.endsWith(".test.mjs"));
  assert.ok(files.length > 20, `the functional half holds ${files.length} files; walking a moved or emptied directory is not a check`);
  const offenders = files.filter(f => {
    const src = fs.readFileSync(path.join(HALF, f), "utf8");
    return /["']git["']/.test(src) && !/functional-harness\.mjs|helpers\.mjs|hermetic-git\.mjs/.test(src);
  });
  assert.deepEqual(offenders, [],
    `these spawn git without the hermetic module — import the functional harness (or ` +
    `./hermetic-git.mjs) first: ${offenders.join(", ")}`);
});
