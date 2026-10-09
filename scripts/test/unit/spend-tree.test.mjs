// scripts/test/unit/spend-tree.test.mjs
// token-spend-tracking-per-epic, group 2 (2.1) — which working tree owns the ledger. UNIT rung: the
// resolution is pure over the text `git worktree list --porcelain -z` prints, so the tests hand it
// hand-written listings and name no directory.

import assert from "node:assert/strict";
import { unitTest } from "../fixtures/unit-harness.mjs";
import { mainTreeRoot, spendDir, worktreePaths } from "../../lib/spend-tree.mjs";

/** `git worktree list --porcelain -z` for the given [path, branch] pairs: every attribute ends in NUL
 *  and a record ends in an extra NUL. */
const listing = (...trees) => trees.map(([p, b]) => `worktree ${p}\0HEAD 0123456789abcdef\0branch refs/heads/${b}\0\0`).join("");

unitTest("2.1 the spend directory lives under the main tree's .conductor", () => {
  assert.equal(spendDir("/repo"), "/repo/.conductor/spend");
});

unitTest("2.1 the worktree paths come out in listing order, main first", () => {
  assert.deepEqual(worktreePaths(listing(["/repo", "main"], ["/repo/.claude/worktrees/agent-x", "wt"])),
    ["/repo", "/repo/.claude/worktrees/agent-x"]);
  assert.deepEqual(worktreePaths(""), []);
});

unitTest("2.1 A linked worktree uses the same ledger: it resolves to the MAIN tree, flagged linked", () => {
  const l = listing(["/repo", "main"], ["/elsewhere/wt", "feature"]);
  assert.deepEqual(mainTreeRoot("/elsewhere/wt", l), { main: "/repo", linked: true });
  assert.deepEqual(mainTreeRoot("/repo", l), { main: "/repo", linked: false });
});

unitTest("2.1 a linked worktree nested INSIDE the main checkout is still linked (longest holder wins)", () => {
  const l = listing(["/repo", "main"], ["/repo/.claude/worktrees/agent-x", "wt"]);
  assert.deepEqual(mainTreeRoot("/repo/.claude/worktrees/agent-x", l), { main: "/repo", linked: true });
});

unitTest("2.1 a conductor in a SUBDIRECTORY keeps its offset: the main tree's conductor root is the same offset below the main tree", () => {
  const l = listing(["/repo", "main"], ["/repo/.claude/worktrees/agent-x", "wt"]);
  assert.deepEqual(mainTreeRoot("/repo/.claude/worktrees/agent-x/sub", l), { main: "/repo/sub", linked: true });
  assert.deepEqual(mainTreeRoot("/repo/packages/app", l), { main: "/repo/packages/app", linked: false },
    "a subdirectory of the main tree is the main tree, not a linked one");
});

unitTest("2.1 a path a sibling shares only a NAME PREFIX with is not inside it", () => {
  const l = listing(["/repo", "main"]);
  assert.deepEqual(mainTreeRoot("/repo-two", l), { main: "/repo-two", linked: false });
});

unitTest("2.1 an empty or unparseable listing treats the root as its own main tree", () => {
  assert.deepEqual(mainTreeRoot("/anywhere", ""), { main: "/anywhere", linked: false });
  assert.deepEqual(mainTreeRoot("/anywhere", "not a listing"), { main: "/anywhere", linked: false });
});
