// Parity gate: the one place the ledger-vs-tree comparison is implemented. Both the real-tree
// gate and the fixture tests in parity.test.mjs call parityViolations(), so the tests that
// prove the gate CAN fail exercise the same code CI runs. See
// docs/superpowers/specs/2026-07-31-platform-parity-mechanism-design.md.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

/** The artifact trees every capability must be declared over. Recursive, no extension filter:
 *  a new nested file (e.g. skills/conductor/references/foo.md) SHOULD fail until it is claimed.
 *  Paths git-ignores (e.g. a macOS `.DS_Store` under skills/) are excluded — see
 *  filterGitIgnored() below for why that must be done with `git check-ignore`, not
 *  `git ls-files`. */
export const PARITY_ROOTS = ["commands", "agents", "skills", "hooks", ".claude-plugin"];

/** Given repo-relative candidate paths, return the subset git does NOT ignore, using a single
 *  `git check-ignore --stdin` call (not one spawn per file). Fails OPEN: if git is missing,
 *  errors, or rootDir is not a git repository (exit code other than 0/1 — notably 128), every
 *  candidate is returned unfiltered rather than throwing or silently dropping paths.
 *
 *  Deliberately `git check-ignore`, NOT `git ls-files`: ls-files answers "is this tracked",
 *  and a brand-new unstaged commands/foo.md is untracked-but-not-ignored — filtering on
 *  tracked-ness would stop the gate from ever seeing it, reintroducing the exact miss this
 *  gate exists to catch. Only *ignored* paths may be excluded; untracked-and-not-ignored
 *  paths must still be walked. */
function filterGitIgnored(rootDir, candidates) {
  if (candidates.length === 0) return candidates;
  const result = spawnSync("git", ["check-ignore", "--stdin"], {
    cwd: rootDir,
    input: candidates.join("\n") + "\n",
    encoding: "utf8",
  });
  if (result.status === 0) {
    const ignored = new Set(result.stdout.split("\n").filter(Boolean));
    return candidates.filter((p) => !ignored.has(p));
  }
  if (result.status === 1) return candidates; // none ignored
  return candidates; // git missing, not a repo (128), or other error — fail open
}

/** Sorted repo-relative POSIX paths of every non-directory entry under PARITY_ROOTS — including
 *  symlinks, excluding anything git ignores. fs.readdirSync uses lstat semantics, so a
 *  symlinked file is neither isFile() nor isDirectory() true together with isFile(); it must
 *  still be recorded (a symlinked artifact ships via git like any other file and must be
 *  claimed), so we recurse only on isDirectory() and treat everything else as a leaf. */
export function walkArtifacts(rootDir) {
  const found = [];
  const visit = (abs) => {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const child = path.join(abs, entry.name);
      if (entry.isDirectory()) visit(child);
      else found.push(path.relative(rootDir, child).split(path.sep).join("/"));
    }
  };
  for (const root of PARITY_ROOTS) {
    const abs = path.join(rootDir, root);
    if (fs.existsSync(abs)) visit(abs);
  }
  return filterGitIgnored(rootDir, found).sort();
}

/** Compare the tree under rootDir against a parsed parity ledger.
 *  Returns { unclaimed, doubleClaimed, missing } — all sorted; all empty means parity holds. */
export function parityViolations(rootDir, ledger) {
  const onDisk = new Set(walkArtifacts(rootDir));

  const claimCount = new Map();
  for (const cap of ledger.capabilities) {
    for (const artifact of cap.artifacts) {
      claimCount.set(artifact, (claimCount.get(artifact) || 0) + 1);
    }
  }

  const unclaimed = [...onDisk].filter((p) => !claimCount.has(p)).sort();
  const doubleClaimed = [...claimCount].filter(([, n]) => n > 1).map(([p]) => p).sort();
  const missing = [...claimCount.keys()].filter((p) => !onDisk.has(p)).sort();
  return { unclaimed, doubleClaimed, missing };
}
