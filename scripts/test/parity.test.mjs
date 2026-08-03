import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpRepo } from "./helpers.mjs";
import { parityViolations, walkArtifacts } from "./parity-helpers.mjs";

// ───────────────── fixture tests: prove each violation direction can fail ─────────────────
//
// These call the SAME parityViolations() the real-tree gate below calls. A separate
// re-implementation against a temp dir would prove nothing about the gate that runs in CI —
// that is the vacuous-coverage trap this epic was written to avoid.

/** Write `files` (repo-relative paths) into a fresh temp dir and return its path. */
function fixtureRepo(files) {
  const dir = tmpRepo();
  for (const rel of files) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, "# fixture\n");
  }
  return dir;
}

test("walkArtifacts finds nested files under the walked roots and ignores everything else", () => {
  const dir = fixtureRepo([
    "commands/status.md",
    "skills/conductor/SKILL.md",
    ".claude-plugin/plugin.json",
    "docs/parity-ledger.json",  // outside the roots — must not be walked
    "README.md",                // outside the roots — must not be walked
  ]);
  assert.deepEqual(walkArtifacts(dir), [
    ".claude-plugin/plugin.json",
    "commands/status.md",
    "skills/conductor/SKILL.md",
  ]);
});

test("an artifact claimed by no capability is reported as unclaimed", () => {
  const dir = fixtureRepo(["commands/status.md", "commands/orphan.md"]);
  const ledger = {
    platforms: ["claude-code"],
    capabilities: [{ id: "briefing", artifacts: ["commands/status.md"], platforms: { "claude-code": "slash command" } }],
  };
  const v = parityViolations(dir, ledger);
  assert.deepEqual(v.unclaimed, ["commands/orphan.md"]);
  assert.deepEqual(v.doubleClaimed, []);
  assert.deepEqual(v.missing, []);
});

test("an artifact claimed by two capabilities is reported as double-claimed", () => {
  const dir = fixtureRepo(["commands/status.md"]);
  const ledger = {
    platforms: ["claude-code"],
    capabilities: [
      { id: "briefing", artifacts: ["commands/status.md"], platforms: { "claude-code": "slash command" } },
      { id: "index", artifacts: ["commands/status.md"], platforms: { "claude-code": "slash command" } },
    ],
  };
  const v = parityViolations(dir, ledger);
  assert.deepEqual(v.doubleClaimed, ["commands/status.md"]);
  assert.deepEqual(v.unclaimed, []);
  assert.deepEqual(v.missing, []);
});

test("a claimed path that does not exist on disk is reported as missing", () => {
  const dir = fixtureRepo(["commands/status.md"]);
  const ledger = {
    platforms: ["claude-code"],
    capabilities: [{
      id: "briefing",
      artifacts: ["commands/status.md", "commands/deleted.md"],
      platforms: { "claude-code": "slash command" },
    }],
  };
  const v = parityViolations(dir, ledger);
  assert.deepEqual(v.missing, ["commands/deleted.md"]);
  assert.deepEqual(v.unclaimed, []);
  assert.deepEqual(v.doubleClaimed, []);
});

test("a ledger that exactly partitions the artifacts on disk reports no violations", () => {
  const dir = fixtureRepo(["commands/status.md", "agents/reconciler.md", "skills/conductor/SKILL.md"]);
  const ledger = {
    platforms: ["claude-code"],
    capabilities: [
      { id: "briefing", artifacts: ["commands/status.md"], platforms: { "claude-code": "slash command" } },
      { id: "reconcile", artifacts: ["agents/reconciler.md"], platforms: { "claude-code": "subagent" } },
      { id: "discipline", artifacts: ["skills/conductor/SKILL.md"], platforms: { "claude-code": "skill" } },
    ],
  };
  assert.deepEqual(parityViolations(dir, ledger), { unclaimed: [], doubleClaimed: [], missing: [] });
});

test("a walked root that does not exist is skipped rather than throwing", () => {
  // A platform port may land `commands/` before `agents/`; a missing root is not a violation.
  const dir = fixtureRepo(["commands/status.md"]);
  const ledger = {
    platforms: ["claude-code"],
    capabilities: [{ id: "briefing", artifacts: ["commands/status.md"], platforms: { "claude-code": "slash command" } }],
  };
  assert.deepEqual(parityViolations(dir, ledger), { unclaimed: [], doubleClaimed: [], missing: [] });
});
