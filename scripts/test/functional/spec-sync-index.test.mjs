// scripts/test/functional/spec-sync-index.test.mjs
// handoff-demand-blind-spots 3.2 — git.mjs indexFileContents() against REAL git (design D5). Its
// assertion twin (assert/spec-sync-index.test.mjs) drives the byte-offset parse over a captured Buffer;
// THIS file's subject is what only a real index can answer: staged versus committed versus reset, a path
// the index lacks, no repository at all, multi-byte blobs framed by byte size, and a conductor root that
// is a SUBDIRECTORY of its repository (the `:./` rule).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fixtureGit, tmpRepo } from "../fixtures/functional-harness.mjs";
import { removeAtExit } from "../fixtures/temp-dir.mjs";
import { installedInvocation, setInvocation } from "../../lib/invocation.mjs";
import { indexFileContents } from "../../lib/git.mjs";

/** Run `fn` with an invocation rooted at `root` and NO gateway injected, so gitOps() builds the REAL
 *  one over this root — the half's subject. The previous invocation is restored afterwards. */
function atRoot(root, fn) {
  const prev = installedInvocation();
  setInvocation({ cwd: root, root, env: { ...process.env, CLAUDE_PROJECT_DIR: root }, argv: ["node", "conductor.mjs"],
    stdin: { read: () => "", isTTY: false }, stdout: { write: () => true }, stderr: { write: () => true } });
  try { return fn(); } finally { setInvocation(prev); }
}

function repo() {
  const cwd = tmpRepo();
  fixtureGit(cwd, "init", "-q", "-b", "main");
  fixtureGit(cwd, "config", "user.email", "test@example.com");
  fixtureGit(cwd, "config", "user.name", "Test");
  return cwd;
}
const write = (root, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};
const A = "openspec/specs/alpha/spec.md";
const B = "openspec/specs/beta/spec.md";
const COMMITTED = "# α\n\n## Requirements\n\n### Requirement: Committed — «é»\nThe system SHALL ✓.\n";
const STAGED = "# α\n\n## Requirements\n\n### Requirement: Staged — ñ 日本\nThe system SHALL ✓✓.\n";

test("3.2 a committed spec reads its contents; a staged rewrite reads the STAGED bytes; a hard reset reads the committed ones", () => {
  const cwd = repo();
  write(cwd, A, COMMITTED);
  fixtureGit(cwd, "add", "-A");
  fixtureGit(cwd, "commit", "-q", "-m", "spec");
  assert.equal(atRoot(cwd, () => indexFileContents([A])).get(A), COMMITTED, "committed → its contents");
  write(cwd, A, STAGED);
  fixtureGit(cwd, "add", A);
  assert.equal(atRoot(cwd, () => indexFileContents([A])).get(A), STAGED,
    "the index is what the NEXT commit records, so a staged rewrite is read before it is committed");
  write(cwd, A, "an unstaged edit the index does not hold\n");
  assert.equal(atRoot(cwd, () => indexFileContents([A])).get(A), STAGED, "the working tree is not read");
  fixtureGit(cwd, "reset", "-q", "--hard");
  assert.equal(atRoot(cwd, () => indexFileContents([A])).get(A), COMMITTED,
    "after `git reset --hard` the staged rewrite is gone — the 0.48.0 shape");
});

test("3.2 a path absent from the index → null; a NON-repository → null overall", () => {
  const cwd = repo();
  write(cwd, A, COMMITTED);
  fixtureGit(cwd, "add", "-A");
  write(cwd, B, "on disk, never staged\n");
  const got = atRoot(cwd, () => indexFileContents([A, B]));
  assert.equal(got.get(A), COMMITTED);
  assert.equal(got.get(B), null, "absent from the index — an untracked file on disk is not the index");
  const plain = removeAtExit(fs.mkdtempSync(path.join(os.tmpdir(), "pm-specsync-plain-")));
  assert.equal(atRoot(plain, () => indexFileContents([A])), null, "git cannot answer at all → null, and only then");
});

test("3.2 TWO multi-byte specs in one call decode exactly, byte-for-byte equal to the files", () => {
  const cwd = repo();
  write(cwd, A, COMMITTED);
  write(cwd, B, "# β\n\n## Requirements\n\n### Requirement: 二つ目 — ü\nThe system SHALL «work».\n");
  fixtureGit(cwd, "add", "-A");
  const got = atRoot(cwd, () => indexFileContents([A, B]));
  for (const p of [A, B]) {
    assert.ok(Buffer.from(got.get(p), "utf8").equals(fs.readFileSync(path.join(cwd, p))), `${p} is byte-exact`);
    assert.ok(Buffer.byteLength(got.get(p)) > got.get(p).length, `${p} really is multi-byte`);
  }
});

test("3.2 a conductor root that is a SUBDIRECTORY of its repository reads ITS OWN openspec/specs", () => {
  const top = repo();
  write(top, A, "# the top level's own spec\n");
  write(top, path.join("sub", A), COMMITTED);
  fixtureGit(top, "add", "-A");
  const got = atRoot(path.join(top, "sub"), () => indexFileContents([A]));
  assert.equal(got.get(A), COMMITTED, "`:./` resolves from the conductor root — a bare `:<path>` would read the top level's or `missing`");
});

test("C2 a CORRUPT index (exit 128) is rethrown, never read as 'no repository'", () => {
  const cwd = repo();
  write(cwd, A, COMMITTED);
  fixtureGit(cwd, "add", "-A");
  fs.writeFileSync(path.join(cwd, ".git", "index"), "garbage");
  assert.throws(() => atRoot(cwd, () => indexFileContents([A])), (e) => e.status === 128,
    "git exits 128 for every fatal error; the confirming question finds a repository, so this rethrows");
});
