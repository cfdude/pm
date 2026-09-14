// Guards scripts/test/hermetic-git.mjs. Each assertion is written to fail on CI as well as on a
// developer machine when the module stops doing its job — CI has no global template directory and
// no signing config, so a test that only checked "no hooks appeared" would pass there vacuously.

import "./hermetic-git.mjs";
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

test("every test file that spawns git imports the hermetic module, directly or through helpers", () => {
  const offenders = fs.readdirSync(TEST_DIR)
    .filter(f => f.endsWith(".test.mjs"))
    .filter(f => {
      const src = fs.readFileSync(path.join(TEST_DIR, f), "utf8");
      return /["']git["']/.test(src) && !/helpers\.mjs|hermetic-git\.mjs/.test(src);
    });
  assert.deepEqual(offenders, [],
    `these spawn git without the hermetic module — import "./hermetic-git.mjs" first: ${offenders.join(", ")}`);
});
