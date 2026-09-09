// /pm:upgrade rewrites tracked files and never said to commit them.
//
// A machine-wide sweep on 2026-09-08 found NINE repositories in this state: `/pm:upgrade` or
// `openspec update` had run, succeeded, rewritten git-tracked files, and been left uncommitted.
// Git recorded an old version while the session read the new rules off disk. Two repos sat six
// days with git saying pm 0.16.0 and disk running 0.39.0; another was two OpenSpec upgrades
// deep (HEAD 1.7.0, disk 1.11.0). Nothing catches it because nothing is broken — and
// tool-currency.mjs reads the version from the stamp ON DISK, so an uncommitted upgrade makes
// the one surface built to notice staleness go quiet.
//
// The nudge must be conditional in BOTH directions, which is what this suite pins: a no-op
// re-run says nothing (a message that always fires is one people stop reading), and a repo that
// git-ignores the files is never told to commit something git would refuse.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { run, runCombined, tmpRepo } from "./helpers.mjs";

const NUDGE = /COMMIT THIS UPGRADE/;

/** A git repo with everything committed — the only state in which `git diff HEAD` can report
 *  what an upgrade subsequently changed. */
function gitCommitAll(cwd, message = "baseline") {
  execFileSync("git", ["add", "-A"], { cwd });
  execFileSync("git", ["commit", "-q", "-m", message], { cwd });
}
function gitInit(cwd) {
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd });
  execFileSync("git", ["config", "user.email", "t@e.com"], { cwd });
  execFileSync("git", ["config", "user.name", "T"], { cwd });
}

/** An initialized, fully committed repo whose stamped pmVersion is old enough that `upgrade`
 *  has migrations to apply and therefore really does rewrite state.json. */
function staleCommittedRepo() {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const statePath = path.join(cwd, ".conductor", "state.json");
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  state.pmVersion = "0.1.0";
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");
  gitInit(cwd);
  gitCommitAll(cwd);
  return cwd;
}

test("an upgrade that rewrites tracked files says to commit them, and names them", () => {
  const cwd = staleCommittedRepo();
  const out = runCombined(["upgrade"], { cwd });
  assert.match(out, NUDGE);
  // The `git add` line must be copy-pasteable, not a description of what changed.
  assert.match(out, /git add [^\n]*\.conductor\/state\.json/);
  assert.match(out, /git commit -m "chore\(pm\): upgrade conductor to /);
  // Non-vacuity: the paths it names really are the ones git reports as differing from HEAD.
  const diff = execFileSync("git", ["diff", "--name-only", "HEAD"], { cwd, encoding: "utf8" });
  const addLine = out.split("\n").find(l => l.trim().startsWith("git add"));
  for (const p of addLine.replace(/^\s*git add\s*/, "").split(" ")) {
    assert.ok(diff.includes(p), `${p} was named but does not differ from HEAD`);
  }
});

test("a second, idempotent upgrade with nothing left to commit says NOTHING", () => {
  const cwd = staleCommittedRepo();
  // First run changes things and nudges; commit exactly what it asked for.
  assert.match(runCombined(["upgrade"], { cwd }), NUDGE);
  gitCommitAll(cwd, "chore(pm): upgrade conductor");
  // Second run is a no-op against a clean tree — the nudge must not fire.
  assert.doesNotMatch(runCombined(["upgrade"], { cwd }), NUDGE);
});

test("a repo that git-ignores the conductor's output is never told to commit it", () => {
  const cwd = staleCommittedRepo();
  // Ignore everything the upgrade writes, and drop it from the index, exactly as a repo that
  // git-ignores `.claude/` and the conductor's own files would look. Five of 25 repos surveyed
  // on this machine git-ignore `.claude/` outright.
  fs.writeFileSync(path.join(cwd, ".gitignore"),
    ".conductor/\nPROJECT.md\nCLAUDE.md\n.gitignore\n");
  // .gitignore itself comes out of the index too — ensureGitignore() appends to it, and a
  // TRACKED file stays tracked (and so stays diffable) even when it lists itself as ignored.
  execFileSync("git", ["rm", "-r", "-q", "--cached", ".conductor", "PROJECT.md", "CLAUDE.md", ".gitignore"], { cwd });
  gitCommitAll(cwd, "ignore the conductor's output");
  const out = runCombined(["upgrade"], { cwd });
  assert.doesNotMatch(out, NUDGE);
  // Non-vacuity: the upgrade really did run and really did rewrite those files.
  assert.match(out, /upgraded \(\d+ migration\(s\)\)/);
});

test("outside a git repository there is nothing to compare against, and it stays silent", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const out = runCombined(["upgrade"], { cwd });
  assert.doesNotMatch(out, NUDGE);
  assert.match(out, /upgraded \(\d+ migration\(s\)\)/);
});

test("a git repo with no commit yet has no HEAD to diff against, and stays silent", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  gitInit(cwd);                       // initialized, but nothing committed — HEAD is unborn
  assert.doesNotMatch(runCombined(["upgrade"], { cwd }), NUDGE);
});
