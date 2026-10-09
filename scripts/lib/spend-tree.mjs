// scripts/lib/spend-tree.mjs
// token-spend-tracking-per-epic — WHICH WORKING TREE the spend ledger belongs to.
//
// ONE LEDGER PER REPOSITORY, kept in the MAIN working tree (design D3). `conductorDir` is per
// invocation root, so a per-checkout ledger in a linked worktree would read the same transcripts into
// a second ledger with a nearly empty timeline, and the budget guard's totals would depend on where
// it happened to run. This module answers "which tree is the main one" and "is it detached" for
// every spend code path, so none of them re-derives it.
//
// NO NEW GIT OPERATION. The gateway already holds `worktreeList` (`git worktree list --porcelain
// -z`), whose first record is always the main working tree. Adding an operation would also mean a
// capture refresh and the functional proof that the capture matches the real git; reusing the one
// that exists keeps this change inside the seam.
//
// WHEN GIT CANNOT ANSWER (not a repository, git absent, a failure) THE ROOT IS TREATED AS THE MAIN
// TREE. That is the safe direction the head-attachment probe already takes: keep recording, because
// a wrong record is visible and removable and a wrong refusal silently disables the trail.

import fs from "node:fs";
import path from "node:path";
import { engineRoot, gitOps } from "./invocation.mjs";
import { isDetachedTree } from "./git.mjs";

/** The spend directory of a main working tree. */
export const spendDir = (mainRoot) => path.join(mainRoot, ".conductor", "spend");

/** The worktree paths in `git worktree list --porcelain -z` output, in listing order (main first). */
export function worktreePaths(listing) {
  return String(listing || "").split("\0").filter((l) => l.startsWith("worktree ")).map((l) => l.slice("worktree ".length));
}

const within = (dir, root) => root === dir || root.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep);

/** `{ main, linked }` for `root`, given the listing. PURE. `main` is the conductor's root IN THE MAIN
 *  TREE — where `.conductor/` lives there.
 *
 *  `root` may be a SUBDIRECTORY of a working tree (a conductor in a subfolder), so the tree that holds
 *  it is the listing entry that is `root` or its longest ancestor — which is also what separates a
 *  linked worktree nested INSIDE the main checkout (`<repo>/.claude/worktrees/agent-x`) from the main
 *  tree it sits in. A root no entry holds is its own main tree. */
export function mainTreeRoot(root, listing) {
  const paths = worktreePaths(listing);
  if (!paths.length) return { main: root, linked: false };
  const holders = paths.filter((p) => within(p, root)).sort((a, b) => b.length - a.length);
  if (!holders.length) return { main: root, linked: false };
  const holder = holders[0];
  // The conductor's own root, in the main tree: the same offset below the tree's top. For a
  // conductor at a repository's top level the offset is empty and this is just the main tree.
  return { main: paths[0] + root.slice(holder.length), linked: holder !== paths[0] };
}

/** The main working tree for THIS invocation: `{ root, main, linked }`. Runs one `git worktree list`,
 *  so it is never called on a hot path — only by the verbs and the dispatch tail that need it, and the
 *  tail only after `state.active` has moved. */
export function resolveMainTree() {
  const root = engineRoot();
  let listing;
  try { listing = gitOps().worktreeList(); } catch { return { root, main: root, linked: false }; }
  let real = root;
  try { real = fs.realpathSync(root); } catch { /* a root that is not on disk answers as given */ }
  const answer = mainTreeRoot(real, listing);
  // Report the main tree in the SAME spelling as `root` when root is itself the main tree, so a
  // symlinked checkout does not make the ledger path differ between two spellings of one directory.
  if (!answer.linked && answer.main === real) return { root, main: root, linked: false };
  return { root, ...answer };
}

/** Is the MAIN working tree's HEAD detached? Asked about the tree the ledger is written to, never
 *  about the invocation's root: a detached linked worktree must not stop ingest into a main tree that
 *  is on a branch, and the reverse (conductor-record, "Detachment is tested on the main working tree"). */
export const mainTreeDetached = (main) => isDetachedTree(main);
