// Guards scripts/test/hermetic-git.mjs. Each assertion is written to fail on CI as well as on a
// developer machine when the module stops doing its job — CI has no global template directory and
// no signing config, so a test that only checked "no hooks appeared" would pass there vacuously.

import "../fixtures/hermetic-git.mjs";
import "../fixtures/record-isolation.mjs";   // no test may write the developer's real .conductor record
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { removeAtExit } from "../fixtures/temp-dir.mjs";  // gh-cfdude-pm-224: scratch dirs are removed at exit

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const tmp = (p) => removeAtExit(fs.mkdtempSync(path.join(os.tmpdir(), p)));

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

// emitted-invocations-copy-flake. A porcelain `git commit` runs `git maintenance run --auto`, and with
// the developer's global config nulled (GIT_CONFIG_GLOBAL=/dev/null, from the functional harness) that
// run DETACHES: a daemon then takes and drops `objects/maintenance.lock` after the commit returned, and
// a fixture copied or removed in that window fails with ENOENT. Observed through git's own trace2
// event stream, so the assertion is deterministic — it does not wait for the race.
test("a fixture commit spawns no automatic maintenance or gc, detached or otherwise", () => {
  const repo = tmp("pm-hermetic-");
  const trace = tmp("pm-hermetic-trace2-");
  // The global config is NULLED as the functional harness nulls it: a machine whose global config
  // already says `maintenance.auto=false` (or `gc.autodetach=false`) would otherwise pass this
  // without the module, and never meet the `--detach` path the harness actually takes.
  const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_TRACE2_EVENT: trace } });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  fs.writeFileSync(path.join(repo, "a.txt"), "a\n");
  git("add", "a.txt");
  git("commit", "-q", "-m", "baseline");
  const argvs = fs.readdirSync(trace).flatMap((f) => fs.readFileSync(path.join(trace, f), "utf8").split("\n"))
    .filter(Boolean).map((l) => JSON.parse(l))
    .filter((e) => e.event === "start" || e.event === "child_start").map((e) => e.argv || []);
  assert.ok(argvs.some((a) => a.includes("commit")), "the trace recorded no commit — a vacuous check");
  const spawned = argvs.filter((a) => a.includes("maintenance") || a.includes("gc"));
  assert.deepEqual(spawned, [], `a fixture commit started automatic maintenance: ${JSON.stringify(spawned)}`);
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
