// Parity gate: the one place the ledger-vs-tree comparison is implemented. Both the real-tree
// gate and the fixture tests in parity.test.mjs call parityViolations(), so the tests that
// prove the gate CAN fail exercise the same code CI runs. See
// docs/superpowers/specs/2026-07-31-platform-parity-mechanism-design.md.
import fs from "node:fs";
import path from "node:path";

/** The artifact trees every capability must be declared over. Recursive, no extension filter:
 *  a new nested file (e.g. skills/conductor/references/foo.md) SHOULD fail until it is claimed. */
export const PARITY_ROOTS = ["commands", "agents", "skills", "hooks", ".claude-plugin"];

/** Sorted repo-relative POSIX paths of every non-directory entry under PARITY_ROOTS — including
 *  symlinks. fs.readdirSync uses lstat semantics, so a symlinked file is neither isFile() nor
 *  isDirectory() true together with isFile(); it must still be recorded (a symlinked artifact
 *  ships via git like any other file and must be claimed), so we recurse only on isDirectory()
 *  and treat everything else as a leaf. */
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
  return found.sort();
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
