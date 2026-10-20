// scripts/test/functional/log-detour-sha.test.mjs
// gh-cfdude-pm-239 -- `log-detour` stamps HEAD after a commit that never landed, and the MINIMAL row
// it wrote could never be retracted. The real-git half: `--sha` against a real commit, the HEAD
// warning, and the retraction hiding the wrong row while the right one stays.
//
// The assertion twin (same id) is scripts/test/unit/log-detour-sha.test.mjs, which owns the refusals
// and the retraction's matching rules over the in-memory store.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { tmpRepo, run, runCombined } from "../fixtures/functional-harness.mjs";

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" });
const log = (cwd) => fs.readFileSync(path.join(cwd, ".conductor", "detours.log"), "utf8");
const project = (cwd) => fs.readFileSync(path.join(cwd, "PROJECT.md"), "utf8");

function workspace() {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  git(cwd, "init", "-q", "-b", "main");
  git(cwd, "config", "user.email", "t@example.com");
  git(cwd, "config", "user.name", "t");
  git(cwd, "add", "-A");
  git(cwd, "commit", "-q", "-m", "one");
  return cwd;
}

test("239: log-detour --sha records the row against THAT commit, not HEAD", () => {
  const cwd = workspace();
  const first = git(cwd, "rev-parse", "--short", "HEAD").trim();
  fs.writeFileSync(path.join(cwd, "two.txt"), "2\n");
  git(cwd, "add", "two.txt");
  git(cwd, "commit", "-q", "-m", "two");
  const head = git(cwd, "rev-parse", "--short", "HEAD").trim();
  assert.notEqual(first, head);
  run(["log-detour", "--sha", first, "described the first commit"], { cwd });
  const row = log(cwd).trim().split("\n").pop().split("\t");
  assert.equal(row[1], first, "the row carries the named commit's sha");
  assert.equal(row[2], "MINIMAL");
  assert.equal(row[4], "described the first commit");
});

test("239: log-detour --sha with a value that is no commit is refused and writes nothing", () => {
  const cwd = workspace();
  const r = runCombined(["log-detour", "--sha", "deadbeefdeadbeef", "x"], { cwd });
  assert.match(r, /names no commit in this repository/);
  assert.equal(fs.existsSync(path.join(cwd, ".conductor", "detours.log")), false);
});

test("239: a second declaration on a HEAD that already has one is said, and the wrong row can be retracted", () => {
  const cwd = workspace();
  run(["log-detour", "the real change for this commit"], { cwd });
  // The commit for "B" is refused by a hook, so HEAD is still the first commit when B is declared.
  const out = runCombined(["log-detour", "B, whose commit never landed"], { cwd });
  assert.match(out, /already carried 1 MINIMAL row/);
  assert.match(out, /retract-detour [0-9a-f]+ with --minimal/);
  assert.match(project(cwd), /B, whose commit never landed/);

  const sha = git(cwd, "rev-parse", "--short", "HEAD").trim();
  const retract = runCombined(["retract-detour", sha, "--minimal", "B, whose commit never landed",
    "--reason", "its commit was refused by a hook; HEAD did not move"], { cwd });
  assert.match(retract, /retracted the MINIMAL row/);
  assert.doesNotMatch(project(cwd), /B, whose commit never landed/, "the wrong row is hidden from PROJECT.md");
  assert.match(project(cwd), /the real change for this commit/, "the right row for the same sha stays");
  assert.match(log(cwd), /B, whose commit never landed/, "and the log keeps the wrong row");
});

test("239: retract-detour --minimal refuses a description no visible MINIMAL row has", () => {
  const cwd = workspace();
  run(["log-detour", "the only row"], { cwd });
  const sha = git(cwd, "rev-parse", "--short", "HEAD").trim();
  const r = runCombined(["retract-detour", sha, "--minimal", "something else", "--reason", "r"], { cwd });
  assert.match(r, /no visible MINIMAL row whose description is exactly "something else"/);
});
