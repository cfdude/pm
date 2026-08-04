import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
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

test("walkArtifacts records symlinked artifacts, not just regular files", () => {
  const dir = fixtureRepo(["commands/status.md"]);
  fs.symlinkSync(
    path.join(dir, "commands", "status.md"),
    path.join(dir, "commands", "linked.md"),
  );
  assert.deepEqual(walkArtifacts(dir), ["commands/linked.md", "commands/status.md"]);
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

/** Like fixtureRepo(), but a real git repository: `git init`, an identity (some git commands
 *  need one even without a commit), and a .gitignore. Used to exercise the git-ignore filtering
 *  in walkArtifacts() — fixtureRepo()'s plain temp dirs are NOT git repos, which is exactly the
 *  fail-open case those other fixture tests already cover. */
function gitFixtureRepo(files, gitignore) {
  const dir = fixtureRepo(files);
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "--local", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "--local", "user.name", "Test"], { cwd: dir });
  if (gitignore) fs.writeFileSync(path.join(dir, ".gitignore"), gitignore);
  return dir;
}

test("walkArtifacts excludes a git-ignored file (e.g. a macOS .DS_Store under skills/)", () => {
  const dir = gitFixtureRepo(["commands/status.md", "commands/.DS_Store"], ".DS_Store\n");
  assert.deepEqual(walkArtifacts(dir), ["commands/status.md"]);
});

test("walkArtifacts still returns an untracked, never-staged, not-ignored file — the anti-trap assertion", () => {
  // This is the test that stops a future refactor from swapping `git check-ignore` for
  // `git ls-files`: ls-files means "tracked", and this file is deliberately never staged.
  // Filtering on tracked-ness instead of ignored-ness would make this file vanish from the
  // walk, silently reintroducing the exact miss the parity gate exists to catch.
  const dir = gitFixtureRepo(["commands/status.md"], ".DS_Store\n");
  fs.writeFileSync(path.join(dir, "commands", "brand-new.md"), "# fixture\n");
  assert.deepEqual(walkArtifacts(dir), ["commands/brand-new.md", "commands/status.md"]);
});

test("walkArtifacts fails open (returns everything) when rootDir is not a git repository", () => {
  // fixtureRepo() dirs are plain temp dirs, not git repos — `git check-ignore` exits 128
  // ("not a git repository") there, and the fix must not throw or drop paths in that case.
  const dir = fixtureRepo(["commands/status.md", "commands/.DS_Store"]);
  assert.deepEqual(walkArtifacts(dir), ["commands/.DS_Store", "commands/status.md"]);
});

// ───────────────── the gate: the real ledger against the real tree ─────────────────

// fileURLToPath, not new URL(...).pathname — same convention as helpers.mjs, and correct for
// paths containing spaces or percent-encodable characters.
const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function realLedger() {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "docs", "parity-ledger.json"), "utf8"));
}

test("every shipped artifact is claimed by at least one capability in docs/parity-ledger.json", () => {
  const v = parityViolations(REPO_ROOT, realLedger());
  assert.deepEqual(v.unclaimed, [],
    `artifact(s) on disk that no capability claims — add them to docs/parity-ledger.json: ${v.unclaimed.join(", ")}`);
});

test("no shipped artifact is claimed by more than one capability in docs/parity-ledger.json", () => {
  const v = parityViolations(REPO_ROOT, realLedger());
  assert.deepEqual(v.doubleClaimed, [],
    `artifact(s) claimed by more than one capability — a capability is the unit of parity, so each artifact belongs to exactly one: ${v.doubleClaimed.join(", ")}`);
});

test("every path claimed in docs/parity-ledger.json exists on disk", () => {
  const v = parityViolations(REPO_ROOT, realLedger());
  assert.deepEqual(v.missing, [],
    `docs/parity-ledger.json claims parity for path(s) that no longer exist — remove the stale row(s): ${v.missing.join(", ")}`);
});

test("the ledger declares claude-code, and every capability describes its claude-code mechanism", () => {
  // claude-code is the permanent base platform; a capability with no base mechanism is a
  // half-declared row. Ported platforms are ABSENT from platforms[] until they are real, so
  // nothing here asserts completeness for any other platform.
  const ledger = realLedger();
  assert.ok(ledger.platforms.includes("claude-code"), "platforms[] must include the base platform");
  const undescribed = ledger.capabilities
    .filter((c) => !c.platforms["claude-code"] || !c.platforms["claude-code"].trim())
    .map((c) => c.id);
  assert.deepEqual(undescribed, [],
    `capability(ies) with no claude-code mechanism described: ${undescribed.join(", ")}`);
});
