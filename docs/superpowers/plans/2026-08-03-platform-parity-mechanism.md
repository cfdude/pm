# Platform Parity Mechanism Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a mechanical parity gate — one hand-declared JSON ledger of pm's capabilities, and one test that fails when a shipped artifact is not claimed by exactly one capability, or when a claimed path does not exist.

**Architecture:** A single pure function, `parityViolations(rootDir, ledger)`, computes all violations by walking five artifact directories and comparing them to the ledger. The real gate calls it with the repo root and `docs/parity-ledger.json`; the fixture tests call the *same* function with a temp dir and an inline ledger, so the tests that prove the gate can fail exercise the identical code path that runs in CI. Everything lives under `scripts/test/` — this is repo-maintenance tooling, not shipped engine code.

**Tech Stack:** Node 18+ built-ins only (`node:fs`, `node:path`, `node:assert`, `node:test`). Run with `node --test scripts/test/*.test.mjs`.

**Spec:** `docs/superpowers/specs/2026-07-31-platform-parity-mechanism-design.md`

## Global Constraints

- **Zero dependencies.** Node 18+ built-ins only (`node:fs`, `node:path`, `node:os`, `node:child_process`, `node:url`). **Never** add an npm package or a `package.json` dependency. This applies to `scripts/test/` as well as `scripts/`.
- **`node --test scripts/test/*.test.mjs` must pass — currently 287 tests, 0 failing** (measured 2026-08-03 at HEAD `5c8f91c`). `.githooks/pre-commit` runs it and blocks failing commits. **NEVER** use `git commit --no-verify`.
- **pm is an INSTRUCTION layer, never an INTEGRATION layer.** No code path may open a network connection or call an external system. This plan adds no exceptions — the gate is a static consistency check over files already on disk.
- **No version bump, no `CHANGELOG.md` entry, no `MIGRATIONS` entry.** Stated explicitly rather than skipped silently: this ships no new subcommand, no flag, and no behavior any user or host agent invokes; `state.json`'s schema is untouched. It is a repo-maintenance gate in the same class as the existing SKILL.md/README.md dispatch-drift tests, which are likewise unversioned. Current version stays `0.25.0`.
- **No README.md change and no Mintlify sync.** Also stated explicitly, per CLAUDE.md's documentation-currency rule: nothing here is user-visible — no subcommand, no flag, no changed epic/tracker/autonomy behavior — so neither `README.md` nor `pm-plugin.dev` needs to follow. The `mintlify-doc-sync` skill is not invoked for this plan.
- Conventional commits (`feat|fix|docs|test|chore|refactor|perf`).
- **Do not push and do not open a pull request.** Commits stay local; the branch is finished separately via the `pr-workflow` skill.

### Frozen decisions — use these exact values, do not re-derive

**The walked roots** (exactly these five, repo-relative, in this order):

```
commands/    agents/    skills/    hooks/    .claude-plugin/
```

**The walk rule:** **recursive**, and **every regular file regardless of extension**. Two consequences chosen deliberately:

- `skills/` today holds exactly one file at `skills/conductor/SKILL.md` — a non-recursive walk would find nothing there. Recursion is required, not optional.
- The first `skills/conductor/references/foo.md` (or a second `.claude-plugin/*.json`) **will** fail the gate until it is claimed. That is the gate working, not a false positive. No extension filter, no allowlist, no skip-list — an exclusion list is exactly the hole this epic exists to close.

Paths are compared as repo-relative POSIX strings (`commands/status.md`), produced with `path.relative(rootDir, abs).split(path.sep).join("/")`.

**`docs/parity-ledger.json` lives outside all five roots**, so the ledger never claims itself. Verified against the tree at HEAD.

**The 22 artifacts at HEAD** — 16 `commands/`, 3 `agents/`, 1 `skills/`, 1 `hooks/`, 1 `.claude-plugin/`. Task 2's ledger partitions exactly these.

## File Structure

- **`scripts/test/parity-helpers.mjs`** (create) — the one exported function `parityViolations()`, plus the walk. Not named `*.test.mjs`, so `node --test scripts/test/*.test.mjs` does not treat it as a test file; CI's syntax loop (`for f in scripts/lib/*.mjs scripts/test/*.mjs`) still syntax-checks it. Precedent: `scripts/test/helpers.mjs`.
- **`scripts/test/parity.test.mjs`** (create) — the real-tree gate (Task 2) and the fixture tests proving each violation direction can fail (Task 1). One new file rather than appending to `conductor-09.test.mjs`, matching how `platform.test.mjs` was added for a new capability.
- **`docs/parity-ledger.json`** (create) — the hand-declared ledger. Not under `scripts/`, because it is a project document read by a test, not engine data.

Nothing under `scripts/conductor.mjs` or `scripts/lib/` is touched. The engine is platform-neutral and shared; per the spec it has nothing to port and therefore nothing to claim.

---

### Task 1: The violation checker and its fixture tests

Build the pure function first, proven against temp-dir fixtures. The real repo is not touched in this task — that is Task 2 — so this task's tests pass on their own and stay meaningful even if the ledger is later restructured.

**Files:**
- Create: `scripts/test/parity-helpers.mjs`
- Create: `scripts/test/parity.test.mjs`

**Interfaces:**
- Consumes: `tmpRepo()` from `scripts/test/helpers.mjs` — returns the path of a fresh empty temp directory (`fs.mkdtempSync`).
- Produces:
  ```js
  // scripts/test/parity-helpers.mjs
  export const PARITY_ROOTS = ["commands", "agents", "skills", "hooks", ".claude-plugin"];
  export function walkArtifacts(rootDir): string[]          // sorted repo-relative POSIX paths
  export function parityViolations(rootDir, ledger): {
    unclaimed:    string[],   // on disk, in no capability
    doubleClaimed: string[],  // claimed by 2+ capabilities
    missing:      string[],   // claimed by a capability, not on disk
  }
  ```
  `ledger` is the parsed object: `{ platforms: string[], capabilities: [{ id, artifacts: string[], platforms: {} }] }`. All three arrays are sorted; empty arrays mean no violations. Task 2 uses `parityViolations` only.

- [ ] **Step 1: Write the failing fixture tests**

Create `scripts/test/parity.test.mjs` with exactly this content:

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test scripts/test/parity.test.mjs`

Expected: every test FAILS with a module-resolution error — `Cannot find module '.../scripts/test/parity-helpers.mjs'`.

- [ ] **Step 3: Write the checker**

Create `scripts/test/parity-helpers.mjs` with exactly this content:

```js
// Parity gate: the one place the ledger-vs-tree comparison is implemented. Both the real-tree
// gate and the fixture tests in parity.test.mjs call parityViolations(), so the tests that
// prove the gate CAN fail exercise the same code CI runs. See
// docs/superpowers/specs/2026-07-31-platform-parity-mechanism-design.md.
import fs from "node:fs";
import path from "node:path";

/** The artifact trees every capability must be declared over. Recursive, no extension filter:
 *  a new nested file (e.g. skills/conductor/references/foo.md) SHOULD fail until it is claimed. */
export const PARITY_ROOTS = ["commands", "agents", "skills", "hooks", ".claude-plugin"];

/** Sorted repo-relative POSIX paths of every regular file under PARITY_ROOTS. */
export function walkArtifacts(rootDir) {
  const found = [];
  const visit = (abs) => {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const child = path.join(abs, entry.name);
      if (entry.isDirectory()) visit(child);
      else if (entry.isFile()) found.push(path.relative(rootDir, child).split(path.sep).join("/"));
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test scripts/test/parity.test.mjs`

Expected: PASS, 6/6.

- [ ] **Step 5: Run the full suite**

Run: `node --test scripts/test/*.test.mjs`

Expected: 293 tests, 0 failing (287 + the 6 added here). It takes roughly two minutes; do not interrupt it.

- [ ] **Step 6: Commit**

```bash
git add scripts/test/parity-helpers.mjs scripts/test/parity.test.mjs
git commit -m "test(parity): violation checker for the parity gate, with fixtures per direction"
```

---

### Task 2: The ledger and the real-tree gate

Now point the checker at the repo. The gate test is written *before* the ledger exists, so its first run fails against the real tree with all 22 artifacts unclaimed — that is what proves the gate is wired to the real repo and not only to fixtures.

**Files:**
- Create: `docs/parity-ledger.json`
- Modify: `scripts/test/parity.test.mjs` (append the real-tree gate)

**Interfaces:**
- Consumes: `parityViolations(rootDir, ledger)` from Task 1.
- Produces: `docs/parity-ledger.json` — read by the gate, and by the `hermes-platform-support` port, which appends `"hermes"` to `platforms[]` and adds a `"hermes"` key to each capability's `platforms` object as it goes.

- [ ] **Step 1: Write the failing real-tree gate**

Append to `scripts/test/parity.test.mjs`:

```js
// ───────────────── the gate: the real ledger against the real tree ─────────────────

// fileURLToPath, not new URL(...).pathname — same convention as helpers.mjs, and correct for
// paths containing spaces or percent-encodable characters.
const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function realLedger() {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "docs", "parity-ledger.json"), "utf8"));
}

test("every shipped artifact is claimed by exactly one capability in docs/parity-ledger.json", () => {
  const v = parityViolations(REPO_ROOT, realLedger());
  assert.deepEqual(v.unclaimed, [],
    `artifact(s) on disk that no capability claims — add them to docs/parity-ledger.json: ${v.unclaimed.join(", ")}`);
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
```

- [ ] **Step 2: Run the gate to verify it fails against the real tree**

Run: `node --test scripts/test/parity.test.mjs`

Expected: the three new tests FAIL with `ENOENT: no such file or directory, open '.../docs/parity-ledger.json'`. The 6 fixture tests from Task 1 still pass.

- [ ] **Step 3: Write the ledger**

Create `docs/parity-ledger.json` with exactly this content. It partitions all 22 artifacts at HEAD; `platforms` holds only `claude-code`, because no other platform has been ported and the spec forbids present-with-nulls rows.

```json
{
  "platforms": ["claude-code"],
  "capabilities": [
    {
      "id": "conductor-discipline",
      "artifacts": ["skills/conductor/SKILL.md"],
      "platforms": { "claude-code": "skill loaded by name (skills/<name>/SKILL.md)" }
    },
    {
      "id": "epic-index",
      "artifacts": [
        "commands/epic.md",
        "commands/status.md",
        "commands/next.md",
        "commands/sync.md"
      ],
      "platforms": { "claude-code": "slash commands (/pm:epic, /pm:status, /pm:next, /pm:sync)" }
    },
    {
      "id": "detour-lifecycle",
      "artifacts": [
        "commands/detour.md",
        "commands/resume.md",
        "commands/gate-guard.md",
        "agents/reconciler.md"
      ],
      "platforms": { "claude-code": "slash commands + reconciler subagent + a PreToolUse gate-guard hook" }
    },
    {
      "id": "epic-hierarchy-orchestration",
      "artifacts": [
        "commands/hierarchy.md",
        "agents/hierarchy-child-executor.md",
        "agents/merge-conflict-resolver.md"
      ],
      "platforms": { "claude-code": "slash command dispatching two subagents into git worktrees" }
    },
    {
      "id": "repo-configuration",
      "artifacts": [
        "commands/tracker.md",
        "commands/lane-routing.md",
        "commands/review-mode.md"
      ],
      "platforms": { "claude-code": "slash commands writing settings into .conductor/state.json" }
    },
    {
      "id": "install-and-upgrade",
      "artifacts": [
        "commands/init.md",
        "commands/upgrade.md",
        "commands/changelog.md",
        "commands/changesets.md"
      ],
      "platforms": { "claude-code": "slash commands (/pm:init scaffolds; /pm:upgrade migrates and rewrites the rules block)" }
    },
    {
      "id": "feedback-channel",
      "artifacts": ["commands/feedback.md"],
      "platforms": { "claude-code": "slash command instructing the agent to file a GitHub issue (the engine never calls gh)" }
    },
    {
      "id": "session-lifecycle-hooks",
      "artifacts": ["hooks/hooks.json"],
      "platforms": { "claude-code": "SessionStart / PreCompact / PostToolUse hooks in hooks.json, each passing --platform claude-code" }
    },
    {
      "id": "plugin-packaging",
      "artifacts": [".claude-plugin/plugin.json"],
      "platforms": { "claude-code": "plugin manifest consumed by the Claude Code marketplace loader" }
    }
  ]
}
```

- [ ] **Step 4: Run the gate to verify it passes**

Run: `node --test scripts/test/parity.test.mjs`

Expected: PASS, 9/9.

If `unclaimed` is non-empty, an artifact was added since this plan was written — add it to the capability it belongs to rather than loosening the walk.

- [ ] **Step 5: Prove the gate is pointed at the real tree**

The fixture tests prove the function; this proves the wiring. Run these three commands in order:

```bash
printf -- '---\ndescription: scratch\n---\n' > commands/zzz-scratch.md
node --test scripts/test/parity.test.mjs   # expect FAIL: unclaimed → commands/zzz-scratch.md
rm commands/zzz-scratch.md
```

Expected: the middle command fails with `artifact(s) on disk that no capability claims — add them to docs/parity-ledger.json: commands/zzz-scratch.md`. Confirm `git status` is clean of `zzz-scratch.md` afterwards.

- [ ] **Step 6: Run the full suite**

Run: `node --test scripts/test/*.test.mjs`

Expected: 296 tests, 0 failing (287 + 6 from Task 1 + 3 here).

- [ ] **Step 7: Commit**

```bash
git add docs/parity-ledger.json scripts/test/parity.test.mjs
git commit -m "feat(parity): declare the capability ledger and gate the tree against it"
```

---

### Task 3: Wire the gate into the project's own rules

The gate only works if the next person adding a command knows it exists. `CLAUDE.md` is where this repo's hard constraints live, so the obligation is recorded there next to the other release-discipline rules.

**Files:**
- Modify: `CLAUDE.md` (in "The `pm` engine — hard constraints (must follow)", after the "Release discipline" bullet)

**Interfaces:**
- Consumes: `docs/parity-ledger.json` from Task 2 (referenced by path).
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Add the constraint bullet**

Insert this bullet into `CLAUDE.md` immediately after the bullet beginning "**Release discipline.**":

```markdown
- **Parity ledger.** Every file under `commands/`, `agents/`, `skills/`, `hooks/`, and
  `.claude-plugin/` must be claimed by exactly one capability in `docs/parity-ledger.json`, and
  every path it claims must exist. `scripts/test/parity.test.mjs` enforces both and fails CI
  otherwise. Adding a command/agent/skill file means adding it to a capability in the same
  commit — either an existing one or a new one with its `claude-code` mechanism described.
  Unported platforms are **absent** from `platforms[]`, never present with null values; a port
  adds itself and fills its column as it goes. See
  `docs/superpowers/specs/2026-07-31-platform-parity-mechanism-design.md`.
```

- [ ] **Step 2: Verify the suite still passes**

Run: `node --test scripts/test/*.test.mjs`

Expected: 296 tests, 0 failing. (`CLAUDE.md` is not a walked root, so the ledger is unaffected; this run confirms the doc-drift tests over `README.md`/`SKILL.md` are still green.)

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(pm): record the parity-ledger obligation in the engine's hard constraints"
```

---

## Done means

- `node --test scripts/test/*.test.mjs` → 296 tests, 0 failing.
- Creating an unclaimed file under any of the five roots fails the suite (demonstrated in Task 2, Step 5).
- `docs/parity-ledger.json` declares one platform, nine capabilities, 22 artifacts, no nulls, no exemptions.
- No version bump, no `CHANGELOG.md`/`MIGRATIONS` entry, no `README.md` or Mintlify change — by the explicit decision recorded in Global Constraints, not by omission.
- The epic's consequence holds: `hermes-platform-support` has no remaining unarchived `depends-on`.
