// scripts/test/head-attachment.test.mjs
// gh#175 group 1 — the probe.
//
// pm's dormancy guard is `fs.existsSync(STATE_PATH)`, and `.conductor/state.json` is git-tracked BY
// DESIGN (it is the backup; `git restore` is the documented undo). So a repository that deploys by
// checking ITSELF out carries state.json in the deployed copy and reads as a workspace. One file is
// answering two questions — is this repository pm-managed, and is this tree a place to work — and
// in a self-deploying repository those diverge.
//
// THE EXIT STATUS IS THE WHOLE THING. "Non-zero means detached" conflates status 1 (genuinely
// detached) with 128 (not a repository) and with a throw (git absent from PATH). Implemented that
// way, a non-repository would SUPPRESS writes — the opposite of the safe direction, and a direct
// contradiction of this change's own spec scenario. Only status 1 is `detached`.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

const LIB = new URL("../lib/", import.meta.url).pathname;

/** Probe in a SUBPROCESS, one per case.
 *
 *  `ROOT` is read at `constants.mjs` load time, and a query-string re-import of `git.mjs` still
 *  binds the same cached `constants.mjs` — so changing `CLAUDE_PROJECT_DIR` in-process moves
 *  nothing. A subprocess is also the honest test: it exercises the probe exactly as a real
 *  invocation does, rather than a re-imported copy of it. */
function probeIn(dir, { env = {}, cwd } = {}) {
  const src = "import('" + LIB + "git.mjs').then(m => process.stdout.write(m.headAttachment()))";
  return execFileSync(process.execPath, ["--input-type=module", "-e", src], {
    cwd: cwd || dir,
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir, ...env },
    encoding: "utf8",
  }).trim();
}

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" });

function repo() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "pm-head-"));
  git(d, "init", "-q", "-b", "main");
  git(d, "config", "user.email", "t@example.com");
  git(d, "config", "user.name", "t");
  return d;
}
function withCommit(d) {
  fs.writeFileSync(path.join(d, "f.txt"), "one\n");
  git(d, "add", "-A");
  git(d, "commit", "-q", "-m", "one");
  return d;
}

test("a branch checkout is `attached`", () => {
  assert.equal(probeIn(withCommit(repo())), "attached");
});

test("a detached HEAD is `detached` — the case this change exists for", () => {
  const d = withCommit(repo());
  const sha = git(d, "rev-parse", "HEAD").trim();
  git(d, "checkout", "-q", "--detach", sha);
  assert.equal(probeIn(d), "detached",
    "a deployed checkout sits exactly here — `git checkout --detach --force <tag>`");
});

test("an UNBORN HEAD is `attached`, not unknown — a fresh repository is a workspace", () => {
  // `symbolic-ref` succeeds and names the branch that does not exist yet, which is the second
  // independent reason to prefer it: `rev-parse --abbrev-ref HEAD` exits 128 here, so the rejected
  // probe would have put every fresh repository on the error path.
  assert.equal(probeIn(repo()), "attached");
});

test("a directory that is not a repository is `unknown`, NOT detached", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "pm-nogit-"));
  assert.equal(probeIn(d), "unknown",
    "status 128 is 'git cannot answer', and the safe direction is to treat the tree as a " +
    "workspace — a false record is visible and removable, a false SUPPRESSION silently disables " +
    "the trail");
});

test("the answer is cached per process — one spawn, however many calls", () => {
  const d = withCommit(repo());
  // Call once, then break git entirely and call again. An uncached second probe would spawn,
  // fail to find git, and answer `unknown`; a cached one cannot.
  const src = "import('" + LIB + "git.mjs').then(m => {" +
    "const a = m.headAttachment(); process.env.PATH = '/nonexistent';" +
    "process.stdout.write(a + ',' + m.headAttachment()); })";
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", src],
    { cwd: d, env: { ...process.env, CLAUDE_PROJECT_DIR: d }, encoding: "utf8" }).trim();
  assert.equal(out, "attached,attached",
    "the second call must not spawn — with git unreachable an uncached probe would say `unknown`");
});

test("the probe answers about ROOT, not about process.cwd()", () => {
  // The warning this change adds prints beside one that exists PRECISELY for the case where those
  // two differ. A probe on the wrong tree would put two sentences about two different trees in one
  // message, and nothing would detect it.
  const detached = withCommit(repo());
  const sha = git(detached, "rev-parse", "HEAD").trim();
  git(detached, "checkout", "-q", "--detach", sha);
  const onBranch = withCommit(repo());

  assert.equal(probeIn(detached, { cwd: onBranch }), "detached",
    "ROOT is the detached tree while the process cwd is on a branch — the answer follows ROOT");
});
