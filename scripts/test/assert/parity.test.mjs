// scripts/test/assert/parity.test.mjs
// 5.3's ASSERTION TWIN of scripts/test/functional/parity.test.mjs — same id, same subject.
//
// THE FUNCTIONAL FILE'S SUBJECT is the parity gate: every shipped artifact under PARITY_ROOTS is
// claimed by exactly one capability in docs/parity-ledger.json, every claimed path exists, and the
// ledger declares the base platform. Three of its fourteen tests need a REAL git repository —
// `walkArtifacts()` filters via `git check-ignore`, and `fixtures/parity-helpers.mjs` SPAWNS it
// (`spawnSync`), so those three are functional-only by subject (design D5).
//
// A FINDING, recorded here rather than silently worked around: the assertion half's guard
// (`assert-half-has-no-spawn.test.mjs`) is a TEXT scan of each file in this directory, so it cannot
// see a spawn reached transitively through an imported fixture. `parity-helpers.mjs` is exactly that
// shape — importing it and calling `walkArtifacts()` would run `git check-ignore` from a file this
// guard passes. This twin therefore walks the tree itself, WITHOUT the git-ignore filter, and every
// ledger comparison below is made over that walk.
//
// THE LEDGER INVARIANTS ARE THE SUBJECT, and they are what this half can prove on every commit: a
// new shipped file that nobody claimed, a claim for a path that no longer exists, and a row with no
// base mechanism. The `git check-ignore` FILTER is what the functional half adds, and it can only
// ever REMOVE a path from the walk (fail-open otherwise), so a violation found here over the
// unfiltered walk is a violation there too.

import "../fixtures/assert-git-shim.mjs";  // the run-time git counter, installed in THIS process (0.49.0, D3 row 1)
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PARITY_ROOTS } from "../fixtures/parity-helpers.mjs";

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** The same recursive walk `parity-helpers.mjs` performs, minus its `git check-ignore` filter. */
function walkArtifactsSpawningNothing(rootDir) {
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

function violations(rootDir, ledger) {
  const onDisk = new Set(walkArtifactsSpawningNothing(rootDir));
  const claimCount = new Map();
  for (const cap of ledger.capabilities) {
    for (const artifact of cap.artifacts) claimCount.set(artifact, (claimCount.get(artifact) || 0) + 1);
  }
  return {
    unclaimed: [...onDisk].filter(p => !claimCount.has(p)).sort(),
    doubleClaimed: [...claimCount].filter(([, n]) => n > 1).map(([p]) => p).sort(),
    missing: [...claimCount.keys()].filter(p => !onDisk.has(p)).sort(),
  };
}

/** A fresh temp dir holding `files` (repo-relative). */
function tmpFixture(files) {
  const os = { tmpdir: process.env.TMPDIR || "/tmp" };
  const dir = fs.mkdtempSync(path.join(os.tmpdir, "pm-parity-"));
  for (const rel of files) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, "# fixture\n");
  }
  return dir;
}

// ───────────────── the walk, and each violation direction ─────────────────

test("the walk finds nested files under the walked roots and ignores everything else", () => {
  const dir = tmpFixture([
    "commands/status.md", "skills/conductor/SKILL.md", ".claude-plugin/plugin.json",
    "docs/parity-ledger.json", "README.md",
  ]);
  assert.deepEqual(walkArtifactsSpawningNothing(dir),
    [".claude-plugin/plugin.json", "commands/status.md", "skills/conductor/SKILL.md"]);
});

test("an artifact claimed by no capability is reported as unclaimed", () => {
  const dir = tmpFixture(["commands/status.md", "commands/orphan.md"]);
  const ledger = { platforms: ["claude-code"],
    capabilities: [{ id: "briefing", artifacts: ["commands/status.md"], platforms: { "claude-code": "slash command" } }] };
  const v = violations(dir, ledger);
  assert.deepEqual(v.unclaimed, ["commands/orphan.md"]);
  assert.deepEqual(v.doubleClaimed, []);
  assert.deepEqual(v.missing, []);
});

test("an artifact claimed by two capabilities is reported as double-claimed", () => {
  const dir = tmpFixture(["commands/status.md"]);
  const ledger = { platforms: ["claude-code"], capabilities: [
    { id: "briefing", artifacts: ["commands/status.md"], platforms: { "claude-code": "slash command" } },
    { id: "index", artifacts: ["commands/status.md"], platforms: { "claude-code": "slash command" } },
  ] };
  const v = violations(dir, ledger);
  assert.deepEqual(v.doubleClaimed, ["commands/status.md"]);
  assert.deepEqual(v.unclaimed, []);
  assert.deepEqual(v.missing, []);
});

test("a claimed path that does not exist on disk is reported as missing", () => {
  const dir = tmpFixture(["commands/status.md"]);
  const ledger = { platforms: ["claude-code"], capabilities: [{
    id: "briefing", artifacts: ["commands/status.md", "commands/deleted.md"],
    platforms: { "claude-code": "slash command" } }] };
  assert.deepEqual(violations(dir, ledger).missing, ["commands/deleted.md"]);
});

test("a ledger that exactly partitions the artifacts on disk reports no violations", () => {
  const dir = tmpFixture(["commands/status.md", "agents/reconciler.md", "skills/conductor/SKILL.md"]);
  const ledger = { platforms: ["claude-code"], capabilities: [
    { id: "briefing", artifacts: ["commands/status.md"], platforms: { "claude-code": "slash command" } },
    { id: "reconcile", artifacts: ["agents/reconciler.md"], platforms: { "claude-code": "subagent" } },
    { id: "discipline", artifacts: ["skills/conductor/SKILL.md"], platforms: { "claude-code": "skill" } },
  ] };
  assert.deepEqual(violations(dir, ledger), { unclaimed: [], doubleClaimed: [], missing: [] });
});

test("a walked root that does not exist is skipped rather than throwing", () => {
  const dir = tmpFixture(["commands/status.md"]);
  const ledger = { platforms: ["claude-code"],
    capabilities: [{ id: "briefing", artifacts: ["commands/status.md"], platforms: { "claude-code": "slash command" } }] };
  assert.deepEqual(violations(dir, ledger), { unclaimed: [], doubleClaimed: [], missing: [] });
});

// ───────────────── the gate: the real ledger against the real tree ─────────────────

const realLedger = () => JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "docs", "parity-ledger.json"), "utf8"));

test("no shipped artifact is claimed by more than one capability in docs/parity-ledger.json", () => {
  const v = violations(REPO_ROOT, realLedger());
  assert.deepEqual(v.doubleClaimed, [],
    `artifact(s) claimed by more than one capability: ${v.doubleClaimed.join(", ")}`);
});

test("every path claimed in docs/parity-ledger.json exists on disk", () => {
  const v = violations(REPO_ROOT, realLedger());
  assert.deepEqual(v.missing, [],
    `docs/parity-ledger.json claims parity for path(s) that no longer exist: ${v.missing.join(", ")}`);
});

test("the ledger declares claude-code, and every capability describes its claude-code mechanism", () => {
  const ledger = realLedger();
  assert.ok(ledger.platforms.includes("claude-code"), "platforms[] must include the base platform");
  const undescribed = ledger.capabilities
    .filter(c => !c.platforms["claude-code"] || !c.platforms["claude-code"].trim())
    .map(c => c.id);
  assert.deepEqual(undescribed, [], `capability(ies) with no claude-code mechanism described: ${undescribed.join(", ")}`);
});

// ───────────────────────── the deliberate omissions ─────────────────────────
//
// 1. "every shipped artifact is claimed by at least one capability" is the one real-tree assertion
//    this half cannot make: the IGNORED set on this machine comes from the developer's GLOBAL
//    excludes file, which `git check-ignore` reads and a non-spawning walk cannot. Measured here:
//    the unfiltered walk returns `skills/.DS_Store`, the filtered one does not, and the ledger is
//    correct about every real artifact. It is a functional-only assertion (design D5), and the
//    functional file keeps it.
// 2. "walkArtifacts records symlinked artifacts", "excludes a git-ignored file" and "still returns
//    an untracked, never-staged, not-ignored file" all exercise `filterGitIgnored()`, which SPAWNS
//    `git check-ignore` — see the FINDING at the top of this file.
