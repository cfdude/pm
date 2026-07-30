# Platform-Aware Rules Block Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make pm's managed rules block platform-aware — the host agent declares which platform it is, and pm writes the right file with the right command syntax for that platform.

**Architecture:** pm never runs on its own; a host agent always triggers it, through a hook whose command string pm itself authored. So the platform is passed explicitly as `--platform <id>` rather than detected. It is recorded in `state.json` (written and read once per session start), and resolves through a chain that ends in a `claude-code` default so it can never silently resolve to nothing. Two things vary per platform: the target filename (respecting each platform's instruction-file precedence chain) and the slash-command form. The block body stays a single platform-neutral source of text.

**Tech Stack:** Node 18+ built-ins only (`node:fs`, `node:path`). Tests: `node --test scripts/conductor.test.mjs`.

**Spec:** `docs/superpowers/specs/2026-07-29-platform-aware-rules-block-design.md`

## Global Constraints

- **`scripts/conductor.mjs` and `scripts/lib/*.mjs` are ZERO-DEPENDENCY.** Node 18+ built-ins only (`node:fs`, `node:path`, `node:os`, `node:child_process`, `node:url`). **Never** add an npm package or a `package.json` dependency.
- **`node --test scripts/conductor.test.mjs` must pass — currently 250 tests, 0 failing.** `.githooks/pre-commit` runs it and blocks failing commits. **NEVER** use `git commit --no-verify`.
- **pm is an INSTRUCTION layer, never an INTEGRATION layer.** No code path may open a network connection or call an external system (Jira, GitHub, Linear). This plan adds no exceptions.
- **Backward compatibility is mandatory.** A `state.json` written by 0.23.1 must still load. Every existing caller of `rulesBlock()` / `writeRules()` must keep working unchanged — the new parameter is optional with a `claude-code` default.
- **Release discipline:** a feature bumps `.claude-plugin/plugin.json` `version`, adds a `CHANGELOG.md` entry, and — because this changes the `state.json` schema — adds a `MIGRATIONS` entry keyed to the new release (additive, idempotent). Current version is `0.23.1`; this ships as **`0.24.0`**.
- Conventional commits (`feat|fix|docs|style|refactor|test|chore|perf`).
- **Do not push and do not open a pull request.** Commits stay local; the branch is finished separately.

### Verified platform facts — use these exact values, do not re-derive

| Platform id | Instruction-file chain (first existing wins) | Command form |
|---|---|---|
| `claude-code` | `CLAUDE.md` | `/pm:status` |
| `hermes` | `HERMES.md` → `AGENTS.md` → `CLAUDE.md` | `/pm:status` |
| `codex` | `AGENTS.md` | `/pm-status` |

Hermes preserves `:` in plugin command names (`name.lower().strip().lstrip("/").replace(" ", "-")` — never strips `:`) and looks commands up by whole key. Codex derives command names from `~/.codex/prompts/*.md` filename stems, so it is flat and hyphenated.

## File Structure

- **`scripts/lib/constants.mjs`** (modify) — add `KNOWN_PLATFORMS`, `PLATFORM_RULES_CHAIN`, `PLATFORM_COMMAND_PREFIX`. Pure data; no logic.
- **`scripts/lib/platform.mjs`** (create) — platform resolution and the target-file chain walk. One responsibility: answering "which platform, and which file". Kept out of `rules.mjs` so `rules.mjs` stays about *content*.
- **`scripts/lib/rules.mjs`** (modify) — `rulesBlock()` takes a platform and emits per-platform command strings; `writeRules()` writes to the resolved target.
- **`scripts/lib/migrations.mjs`** (modify) — one additive `0.24.0` entry stamping `state.platform`.
- **`scripts/conductor.mjs`** (modify) — pass the resolved platform into the `rules` subcommand.
- **`hooks/hooks.json`** (modify) — every pm-authored Claude Code hook command declares `--platform claude-code`.
- **`scripts/conductor.test.mjs`** (modify) — tests appended per task.

**Out of scope for this plan:** `evals/observe.py` (owned by the separate `edd-observe-hardcodes-claude-md` epic, which depends on this one), and the Hermes/Codex artifact trees (owned by the port epics). This plan makes the engine platform-aware; it does not add a second platform's files.

---

### Task 1: Platform constants and resolution

**Files:**
- Modify: `scripts/lib/constants.mjs:18` (after `KNOWN_LANES`)
- Create: `scripts/lib/platform.mjs`
- Test: `scripts/conductor.test.mjs` (append)

**Interfaces:**
- Consumes: `loadState()` / `saveState(state)` from `scripts/lib/state.mjs:25,33`; `ROOT` from `scripts/lib/constants.mjs`.
- Produces:
  - `KNOWN_PLATFORMS: string[]` — `["claude-code", "hermes", "codex"]`
  - `PLATFORM_RULES_CHAIN: Record<string, string[]>`
  - `PLATFORM_COMMAND_PREFIX: Record<string, string>`
  - `platformFlag(argv: string[]) -> string` — `""` when absent
  - `resolvePlatform(flags: object, state?: object|null) -> string` — never throws, never returns falsy
  - `assertKnownPlatform(platform: string) -> void` — `process.exit(1)` on an unknown value
  - `rulesTarget(platform: string, root: string) -> string` — absolute path
  - `recordPlatform(state: object, platform: string) -> boolean` — true if it changed

**Critical test-isolation hazard:** `run()` in `scripts/conductor.test.mjs:15` spreads `...process.env` into the child, so `CLAUDECODE=1` is present whenever the suite runs inside a Claude Code session. Any test asserting the *default* rung must pass `env: { CLAUDECODE: "" }` explicitly, or it will pass via the `CLAUDECODE` rung and prove nothing.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/conductor.test.mjs`:

```javascript
// ────────────── platform resolution + rules target ──────────────

test("resolvePlatform prefers an explicit --platform flag over everything", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const out = run(["rules", "--platform", "codex"], { cwd });
  assert.match(out, /\/pm-status/, "codex form should appear when --platform codex is passed");
  assert.doesNotMatch(out, /\/pm:status/, "the claude-code form must not leak through");
});

test("resolvePlatform rejects an unknown --platform instead of silently defaulting", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const r = spawnSync("node", [ENGINE, "rules", "--platform", "nope"], {
    cwd,
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, PM_CACHE_ROOT: EMPTY_CACHE },
    encoding: "utf8",
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--platform must be one of claude-code\|hermes\|codex/);
});

test("resolvePlatform falls back to claude-code when nothing declares a platform", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  // CLAUDECODE is blanked so this exercises the terminal default, not the env rung.
  const out = run(["rules"], { cwd, env: { CLAUDECODE: "" } });
  assert.match(out, /\/pm:status/);
});

test("rulesTarget returns CLAUDE.md for claude-code regardless of a stray AGENTS.md", () => {
  const cwd = tmpRepo();
  fs.writeFileSync(path.join(cwd, "AGENTS.md"), "# from some other agent\n");
  run(["init"], { cwd });
  assert.ok(fs.existsSync(path.join(cwd, "CLAUDE.md")), "claude-code has no chain; CLAUDE.md is written");
  const agents = fs.readFileSync(path.join(cwd, "AGENTS.md"), "utf8");
  assert.doesNotMatch(agents, /BEGIN pm-conductor rules/, "the stray file must be left alone");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test scripts/conductor.test.mjs 2>&1 | rg "^(ℹ|#) (tests|pass|fail)"`
Expected: `fail` is non-zero — the first two error on the unknown `--platform` flag being accepted, or on `/pm-status` never appearing.

- [ ] **Step 3: Add the platform constants**

In `scripts/lib/constants.mjs`, immediately after the `KNOWN_LANES` line:

```javascript
export const KNOWN_PLATFORMS = ["claude-code", "hermes", "codex"];

// Each platform's project-instruction file, in the order that platform resolves them.
// First EXISTING file wins (that is the one the platform will actually read); if none
// exist, the LAST entry is created -- it is the most broadly-compatible choice, e.g. a
// fresh Hermes repo gets CLAUDE.md (which Hermes reads as its third fallback and Claude
// Code reads natively) rather than a Hermes-exclusive HERMES.md.
export const PLATFORM_RULES_CHAIN = {
  "claude-code": ["CLAUDE.md"],
  hermes: ["HERMES.md", "AGENTS.md", "CLAUDE.md"],
  codex: ["AGENTS.md"],
};

// Slash-command form per platform. Hermes preserves ':' in plugin command names and
// looks them up by whole key, so the namespace survives -- and the namespace matters:
// Hermes SILENTLY skips a plugin command colliding with a built-in, and it ships a
// built-in `status`. Codex derives command names from prompt-file stems, so it is flat.
export const PLATFORM_COMMAND_PREFIX = {
  "claude-code": "/pm:",
  hermes: "/pm:",
  codex: "/pm-",
};
```

- [ ] **Step 4: Create the resolution module**

Create `scripts/lib/platform.mjs`:

```javascript
// Which host agent is driving this invocation, and which file its rules block belongs in.
//
// pm never runs on its own: every engine invocation is triggered by a host agent, through a
// hook whose command string pm itself authored. So the platform is DECLARED, not detected --
// each platform's hook config carries `--platform <id>`. No markers, no filesystem
// archaeology, no precedence heuristic to get wrong.
import fs from "node:fs";
import path from "node:path";

import { KNOWN_PLATFORMS, PLATFORM_RULES_CHAIN } from "./constants.mjs";

/** Extract just `--platform <value>` from an argv slice.
 *
 *  Deliberately NOT lib/add-epic.mjs's parseFlags(): importing that would pull platform.mjs
 *  into add-epic.mjs -> render.mjs -> briefing.mjs -> active-pointer.mjs, the known circular
 *  cluster documented in CLAUDE.md. Since rules.mjs imports platform.mjs, any future edge
 *  from that cluster back to rules.mjs would close a loop around the rules writer itself.
 *  platform.mjs stays a LEAF -- constants.mjs and state.mjs only. Scanning for one flag is
 *  three lines; the coupling is not worth saving them. */
export function platformFlag(argv) {
  const i = argv.indexOf("--platform");
  if (i === -1) return "";
  const v = argv[i + 1];
  return (typeof v === "string" && !v.startsWith("--")) ? v.trim() : "";
}

/** Resolve the active platform. Never throws and never returns falsy: an unresolved
 *  platform that wrote NO rules block would be a silent no-op -- pm appearing installed
 *  while contributing nothing -- so the chain ends in a hard default.
 *
 *  Order: explicit flag > recorded in state > CLAUDECODE env > claude-code.
 *  An unknown explicit value is rejected by the caller (see assertKnownPlatform), not
 *  silently ignored, because it means a hand-authored hook has a typo. */
export function resolvePlatform(flags = {}, state = null) {
  const flag = typeof flags.platform === "string" ? flags.platform.trim() : "";
  if (flag) return flag;
  const recorded = state && typeof state.platform === "string" ? state.platform.trim() : "";
  if (recorded && KNOWN_PLATFORMS.includes(recorded)) return recorded;
  if (process.env.CLAUDECODE) return "claude-code";
  return "claude-code";
}

/** Exit(1) with a legible message on an unknown platform, mirroring how add-epic
 *  treats an unknown --lane. Called only for an EXPLICIT flag value. */
export function assertKnownPlatform(platform) {
  if (!KNOWN_PLATFORMS.includes(platform)) {
    process.stderr.write(`conductor: --platform must be one of ${KNOWN_PLATFORMS.join("|")}\n`);
    process.exit(1);
  }
}

/** Absolute path of the file this platform's rules block belongs in: the first file in
 *  its chain that already EXISTS (that is the one the platform will actually read), else
 *  the chain's last entry. */
export function rulesTarget(platform, root) {
  const chain = PLATFORM_RULES_CHAIN[platform] || PLATFORM_RULES_CHAIN["claude-code"];
  for (const name of chain) {
    const candidate = path.join(root, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.join(root, chain[chain.length - 1]);
}

/** Stamp the active platform onto state. Returns true when it changed, so a caller can
 *  detect a platform SWITCH (the project changed hands) and report it. */
export function recordPlatform(state, platform) {
  if (state.platform === platform) return false;
  state.platform = platform;
  return true;
}
```

- [ ] **Step 5: Wire `--platform` into the `rules` subcommand**

`rules` (`scripts/conductor.mjs:112-116`) is already a closure that parses flags, so it is the one entry point that can honour `--platform` with a local change. It currently reads:

```javascript
    process.stdout.write(rulesBlock(currentTracker(), currentReviewMode(epicId), currentSecondaryTrackers()));
```

`rules` is read-only — it prints the block and must **not** persist anything — so resolve without recording:

```javascript
    const declared = platformFlag(process.argv.slice(3));
    if (declared) assertKnownPlatform(declared);
    const rulesPlatform = resolvePlatform({ platform: declared }, loadState());
    process.stdout.write(rulesBlock(currentTracker(), currentReviewMode(epicId), currentSecondaryTrackers(), rulesPlatform));
```

Keep the existing `parseFlags` line above it — `--epic` still comes from it.

Imports to add at the top, alongside the other `./lib/*.mjs` imports: `import { resolvePlatform, assertKnownPlatform, platformFlag } from "./lib/platform.mjs";`. Check what is already imported with `rg -n "loadState" scripts/conductor.mjs` and add only what is missing.

**Note:** `platformFlag` and `assertKnownPlatform` are defined in Task 1 Step 4; `resolveAndRecordPlatform` (Task 4) is not needed here precisely because `rules` must not write.

- [ ] **Step 6: Run the tests**

Run: `node --test scripts/conductor.test.mjs 2>&1 | rg "^(ℹ|#) (tests|pass|fail)"`
Expected: `fail 0`. Tests 1, 2 and 4 pass. **Test 3 and the `/pm-status` assertion in test 1 will still fail** — `rulesBlock()` does not yet accept or use a platform. That is expected; Task 2 closes it. Confirm the *only* remaining failures are those command-form assertions.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/constants.mjs scripts/lib/platform.mjs scripts/conductor.mjs scripts/conductor.test.mjs
git commit -m "feat(engine): platform constants and declared-platform resolution

pm never runs on its own -- a host agent always triggers it through a hook whose
command string pm authored -- so the platform is declared via --platform rather
than detected. Resolution ends in a hard claude-code default because resolving to
nothing would write no rules block at all: pm appearing installed while
contributing nothing."
```

---

### Task 2: Per-platform command strings in the rules block

**Files:**
- Modify: `scripts/lib/rules.mjs:82` (the `rulesBlock` signature) and its 14 hardcoded `/pm:` sites
- Test: `scripts/conductor.test.mjs` (append)

**Interfaces:**
- Consumes: `PLATFORM_COMMAND_PREFIX` from `scripts/lib/constants.mjs` (Task 1).
- Produces: `rulesBlock(tracker, reviewMode, secondaryTrackers = [], platform = "claude-code") -> string` — the platform parameter is **fourth and optional**, so all six existing callers keep working untouched.
- Produces: `pmCmd(platform: string, name: string) -> string` exported from `scripts/lib/rules.mjs`.

There are exactly **14** lines in `scripts/lib/rules.mjs` containing `/pm:`. Find them with `rg -n '/pm:' scripts/lib/rules.mjs`. Every one becomes a template string using `pmCmd(platform, "<name>")`. Do not miss the `Manage with …` footer.

- [ ] **Step 1: Write the failing test**

```javascript
test("rules block uses the platform's command form, and the body stays identical otherwise", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });

  const cc = run(["rules", "--platform", "claude-code"], { cwd });
  const hermes = run(["rules", "--platform", "hermes"], { cwd });
  const codex = run(["rules", "--platform", "codex"], { cwd });

  assert.match(cc, /\/pm:status/);
  assert.match(hermes, /\/pm:status/, "Hermes preserves ':' in plugin command names");
  assert.match(codex, /\/pm-status/, "Codex command names come from prompt-file stems: flat");
  assert.doesNotMatch(codex, /\/pm:/, "no namespaced form may leak into the codex block");

  // The BODY is platform-neutral: normalising the command form makes the blocks equal.
  const norm = (s) => s.replace(/\/pm[-:]/g, "/pm§");
  assert.equal(norm(codex), norm(cc), "only command strings may differ between platforms");
  assert.equal(norm(hermes), norm(cc));
});

test("rulesBlock defaults to the claude-code command form when no platform is given", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const out = run(["rules"], { cwd, env: { CLAUDECODE: "" } });
  assert.match(out, /\/pm:status/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test scripts/conductor.test.mjs 2>&1 | rg "^(ℹ|#) (tests|pass|fail)"`
Expected: FAIL — `codex` output still contains `/pm:status`.

- [ ] **Step 3: Add `pmCmd` and thread the platform through**

In `scripts/lib/rules.mjs`, add `PLATFORM_COMMAND_PREFIX` to the existing `constants.mjs` import, then add above `rulesBlock`:

```javascript
/** The platform's invocation form for a pm command. `pmCmd("codex", "status")` -> "/pm-status".
 *  An unrecognised platform falls back to the claude-code form rather than emitting a broken
 *  string -- the rules block must always name SOMETHING invocable. */
export function pmCmd(platform, name) {
  const prefix = PLATFORM_COMMAND_PREFIX[platform] || PLATFORM_COMMAND_PREFIX["claude-code"];
  return `${prefix}${name}`;
}
```

Change the signature at `scripts/lib/rules.mjs:82`:

```javascript
export function rulesBlock(tracker, reviewMode, secondaryTrackers = [], platform = "claude-code") {
```

Then convert each of the 14 sites. Two worked examples — apply the same transformation to all of them:

```javascript
// before
    "     then run `/pm:detour --minimal \"<what>\"` so it is recorded in `.conductor/detours.log`.",
// after
    `     then run \`${pmCmd(platform, "detour")} --minimal "<what>"\` so it is recorded in \`.conductor/detours.log\`.`,
```

```javascript
// before
    "   priority, or the detour stack, re-render with `/pm:status`. Never hand-edit `PROJECT.md`.",
// after
    `   priority, or the detour stack, re-render with \`${pmCmd(platform, "status")}\`. Never hand-edit \`PROJECT.md\`.`,
```

- [ ] **Step 4: Verify no hardcoded form survives**

Run: `rg -n '/pm:' scripts/lib/rules.mjs`
Expected: **no output.** Any remaining hit is a site you missed. (`/pm-` should also produce no output — every form now comes from `pmCmd`.)

- [ ] **Step 5: Run the tests**

Run: `node --test scripts/conductor.test.mjs 2>&1 | rg "^(ℹ|#) (tests|pass|fail)"`
Expected: `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/rules.mjs scripts/conductor.test.mjs
git commit -m "feat(engine): per-platform command form in the rules block

Body stays a single platform-neutral source of text; only the slash-command form
varies. The pm: namespace is retained wherever supported because Hermes SILENTLY
skips a plugin command that collides with a built-in, and it ships a built-in
\`status\` -- so a bare /status would be dropped with no signal."
```

---

### Task 3: Write to the file the platform will actually read

**Files:**
- Modify: `scripts/lib/rules.mjs:291-310` (`writeRules`)
- Test: `scripts/conductor.test.mjs` (append)

**Interfaces:**
- Consumes: `rulesTarget(platform, root)` and `resolvePlatform(flags, state)` from `scripts/lib/platform.mjs` (Task 1); `ROOT` from `scripts/lib/constants.mjs`.
- Produces: `writeRules(platform = "claude-code") -> string` — **now returns the absolute path it wrote**, so callers can report it. All six existing callers ignore the return value and keep working.

`writeRules()` currently hardcodes `CLAUDE_MD`. It must use the resolved target instead. Note the existing function reads, patches and writes in three branches (refresh in place / append / create) — preserve all three; only the path and the reported filename change.

- [ ] **Step 1: Write the failing tests**

```javascript
test("hermes writes into a pre-existing AGENTS.md, which outranks CLAUDE.md in its chain", () => {
  const cwd = tmpRepo();
  fs.writeFileSync(path.join(cwd, "AGENTS.md"), "# pre-existing, from a prior Codex attempt\n");
  run(["init", "--platform", "hermes"], { cwd });

  const agents = fs.readFileSync(path.join(cwd, "AGENTS.md"), "utf8");
  assert.match(agents, /BEGIN pm-conductor rules/,
    "Hermes resolves AGENTS.md before CLAUDE.md, so the block must land there");
  assert.match(agents, /pre-existing, from a prior Codex attempt/, "existing content is preserved");

  // Writing CLAUDE.md here would be the silent-invisibility bug: Hermes would never read it.
  if (fs.existsSync(path.join(cwd, "CLAUDE.md"))) {
    const claude = fs.readFileSync(path.join(cwd, "CLAUDE.md"), "utf8");
    assert.doesNotMatch(claude, /BEGIN pm-conductor rules/,
      "the block must not go to a file Hermes will not read");
  }
});

test("hermes with a clean repo writes CLAUDE.md, the most compatible entry in its chain", () => {
  const cwd = tmpRepo();
  run(["init", "--platform", "hermes"], { cwd });
  assert.ok(fs.existsSync(path.join(cwd, "CLAUDE.md")));
  assert.ok(!fs.existsSync(path.join(cwd, "HERMES.md")), "no Hermes-exclusive file is invented");
});

test("codex writes AGENTS.md and never CLAUDE.md, which it cannot read", () => {
  const cwd = tmpRepo();
  run(["init", "--platform", "codex"], { cwd });
  const agents = fs.readFileSync(path.join(cwd, "AGENTS.md"), "utf8");
  assert.match(agents, /BEGIN pm-conductor rules/);
  assert.ok(!fs.existsSync(path.join(cwd, "CLAUDE.md")), "Codex does not read CLAUDE.md");
});

test("the rules block refreshes in place rather than duplicating on a second write", () => {
  const cwd = tmpRepo();
  run(["init", "--platform", "codex"], { cwd });
  run(["write-rules", "--platform", "codex"], { cwd });
  const agents = fs.readFileSync(path.join(cwd, "AGENTS.md"), "utf8");
  assert.equal(agents.match(/BEGIN pm-conductor rules/g).length, 1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test scripts/conductor.test.mjs 2>&1 | rg "^(ℹ|#) (tests|pass|fail)"`
Expected: FAIL — the block lands in `CLAUDE.md` for every platform.

- [ ] **Step 3: Make `writeRules` platform-aware**

Replace `writeRules()` in `scripts/lib/rules.mjs` with:

```javascript
export function writeRules(platform = "claude-code") {
  const target = rulesTarget(platform, ROOT);
  const name = path.basename(target);

  let existing = "";
  try { existing = fs.readFileSync(target, "utf8"); } catch { /* target does not exist yet */ }

  const block = rulesBlock(currentTracker(), currentReviewMode(), currentSecondaryTrackers(), platform);
  let next;
  if (existing.includes(RULES_BEGIN) && existing.includes(RULES_END)) {
    // refresh in place
    const re = new RegExp(`${RULES_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${RULES_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n?`);
    next = existing.replace(re, block);
    process.stderr.write(`conductor: refreshed rules block in ${name} (platform: ${platform})\n`);
  } else if (existing.trim()) {
    next = existing.replace(/\n*$/, "\n\n") + block;
    process.stderr.write(`conductor: appended rules block to ${name} (platform: ${platform})\n`);
  } else {
    next = `# ${name}\n\n` + block;
    process.stderr.write(`conductor: created ${name} with rules block (platform: ${platform})\n`);
  }
  fs.writeFileSync(target, next);
  return target;
}
```

Add `path` and the platform helper to the imports at the top of `scripts/lib/rules.mjs`:

```javascript
import path from "node:path";
import { rulesTarget } from "./platform.mjs";
```

Add `ROOT` to the existing `constants.mjs` import. `CLAUDE_MD` is no longer used by this function — leave the constant exported (other code and tests may reference it) but confirm with `rg -n "CLAUDE_MD" scripts/` that nothing now depends on `writeRules` writing it.

- [ ] **Step 4: Run the tests**

Run: `node --test scripts/conductor.test.mjs 2>&1 | rg "^(ℹ|#) (tests|pass|fail)"`
Expected: `fail 0`. If an older test asserted on the literal string `CLAUDE.md` in stderr, update it to accept the new `(platform: …)` suffix — the message changed deliberately.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/rules.mjs scripts/conductor.test.mjs
git commit -m "feat(engine): write the rules block where the platform will read it

Hermes resolves project context first-match-wins over HERMES.md > AGENTS.md >
CLAUDE.md. Writing CLAUDE.md in a repo that already has an AGENTS.md means the
block is SILENTLY invisible -- no error, just an agent with no conductor rules.
writeRules now targets the first existing file in the platform's chain, and
reports which file and platform it chose."
```

---

### Task 4: `--platform` wiring, state recording, and the migration

**Files:**
- Modify: `scripts/lib/subcommands.mjs:28` (the `writeRules()` caller)
- Modify: `scripts/lib/migrations.mjs:17` (add a `0.24.0` entry) and `:60`
- Modify: `scripts/lib/tracker.mjs:42,54,81` and `scripts/lib/review-mode.mjs:27` — pass the recorded platform
- Modify: `.claude-plugin/plugin.json` (version → `0.24.0`), `CHANGELOG.md`
- Test: `scripts/conductor.test.mjs` (append)

**Interfaces:**
- Consumes: `resolvePlatform`, `assertKnownPlatform`, `recordPlatform` from `scripts/lib/platform.mjs`; `writeRules(platform)` from `scripts/lib/rules.mjs`.
- Produces: `state.platform: string` in `.conductor/state.json`.

The six `writeRules()` callers must pass the platform the session declared. The cheapest correct approach: each caller resolves from `loadState()` (the recorded value), because only `init`/`upgrade`/`write-rules`/`rules` receive an explicit flag — the tracker and review-mode refreshes are downstream of a session whose platform is already recorded.

- [ ] **Step 1: Write the failing tests**

```javascript
test("init records the declared platform in state.json", () => {
  const cwd = tmpRepo();
  run(["init", "--platform", "codex"], { cwd });
  const state = JSON.parse(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"));
  assert.equal(state.platform, "codex");
});

test("a later invocation with no flag reuses the recorded platform", () => {
  const cwd = tmpRepo();
  run(["init", "--platform", "codex"], { cwd });
  // No --platform, and CLAUDECODE blanked: the recorded value must win over the default.
  const out = run(["rules"], { cwd, env: { CLAUDECODE: "" } });
  assert.match(out, /\/pm-status/, "the recorded codex platform should still apply");
});

test("a platform switch is recorded and reported, not silently ignored", () => {
  const cwd = tmpRepo();
  run(["init", "--platform", "claude-code"], { cwd });
  const out = runCombined(["write-rules", "--platform", "hermes"], { cwd });
  const state = JSON.parse(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"));
  assert.equal(state.platform, "hermes");
  assert.match(out, /platform: hermes/);
});

test("upgrade stamps platform on a state file written before the field existed", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const p = path.join(cwd, ".conductor", "state.json");
  const state = JSON.parse(fs.readFileSync(p, "utf8"));
  delete state.platform;                 // simulate a 0.23.1 state file
  state.pmVersion = "0.23.1";
  fs.writeFileSync(p, JSON.stringify(state, null, 2));

  run(["upgrade"], { cwd });

  const after = JSON.parse(fs.readFileSync(p, "utf8"));
  assert.equal(after.platform, "claude-code", "the migration must be additive and default to the base platform");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test scripts/conductor.test.mjs 2>&1 | rg "^(ℹ|#) (tests|pass|fail)"`
Expected: FAIL — `state.platform` is `undefined`.

- [ ] **Step 3: Add the migration entry**

In `scripts/lib/migrations.mjs`, append to the `MIGRATIONS` array (keeping existing entries untouched):

```javascript
  {
    release: "0.24.0",
    note: "stamp the active host platform (claude-code for every pre-existing repo)",
    apply(state) {
      if (!state.platform) state.platform = "claude-code";
    },
  },
```

- [ ] **Step 4a: Understand the dispatch trap before writing code**

`scripts/conductor.mjs`'s dispatch is `{ …table… }[cmd] || (usage)()` — **every subcommand function is invoked with NO arguments.** And `init()`, `upgrade()` and `writeRules()` do not read `process.argv` at all:

- `"write-rules": writeRules` (`scripts/conductor.mjs:117`) — a bare function reference.
- `init()` (`scripts/lib/subcommands.mjs:19`) — no parameters.
- `upgrade()` (`scripts/lib/migrations.mjs:36`) — no parameters.

So passing `--platform` to any of them is currently a **silent no-op**: it would default to `claude-code` and this task's tests would fail in a confusing direction (the flag "works" but does nothing). `rules` is the only entry point that already parses flags, because it is a closure.

Each entry point that must honour `--platform` therefore needs to parse `process.argv.slice(3)` itself. `upgrade` does **not** need the flag — the `0.24.0` MIGRATIONS entry stamps the default.

- [ ] **Step 4b: Add a shared resolve-and-record helper**

Add to `scripts/lib/platform.mjs`:

`platformFlag` and `assertKnownPlatform` already exist from Task 1 Step 4. Add only this:

```javascript
/** Resolve the platform for a top-level subcommand invocation and persist it.
 *  Centralised because the dispatch table calls every subcommand with NO arguments, so
 *  each entry point must read argv itself -- duplicating that logic is exactly how one of
 *  them silently stops honouring the flag. Returns { platform, switched }. */
export function resolveAndRecordPlatform() {
  const declared = platformFlag(process.argv.slice(3));
  if (declared) assertKnownPlatform(declared);
  const state = loadState();
  const platform = resolvePlatform({ platform: declared }, state);
  const switched = recordPlatform(state, platform);
  if (switched) saveState(state);
  return { platform, switched };
}
```

Add this one import to `scripts/lib/platform.mjs` (alongside the existing `constants.mjs` import from Task 1):

```javascript
import { loadState, saveState } from "./state.mjs";
```

Verify the leaf property holds before committing: `rg -n "^import" scripts/lib/platform.mjs` must show only `node:fs`, `node:path`, `./constants.mjs`, and `./state.mjs`.

- [ ] **Step 4c: Convert the entry points**

In `scripts/conductor.mjs`, replace the bare reference:

```javascript
  "write-rules": () => {
    const { platform } = resolveAndRecordPlatform();
    writeRules(platform);
  },
```

In `scripts/lib/subcommands.mjs`, `init()` — resolve and record before the `writeRules()` call at line 28:

```javascript
  const { platform } = resolveAndRecordPlatform();
  writeRules(platform);
```

In `scripts/lib/migrations.mjs:60`, `scripts/lib/tracker.mjs:42,54,81` and `scripts/lib/review-mode.mjs:27` — these are downstream refreshes with no flag of their own, so read the recorded value without re-parsing argv:

```javascript
  writeRules(resolvePlatform({}, loadState()));
```

Add the needed imports to each file. Note `subcommands.mjs` already imports `loadState`/`saveState`; verify per file with `rg -n "^import" scripts/lib/<file>.mjs` rather than assuming.

- [ ] **Step 4d: Verify no bare call site survives**

Run: `rg -n "^\s*writeRules\(\);" scripts/`
Expected: **no output.**

Use this statement-anchored pattern, **not** a bare `rg "writeRules\(\)"` — the looser pattern also matches two explanatory comments (`scripts/lib/tracker.mjs:3`, `scripts/lib/review-mode.mjs:3`) and so can never return empty, which would make the check meaningless.

- [ ] **Step 5: Bump the version and add the changelog entry**

In `.claude-plugin/plugin.json`, set `"version": "0.24.0"`.

Prepend to `CHANGELOG.md` (match the file's existing heading style exactly — check with `head -20 CHANGELOG.md`):

```markdown
## 0.24.0

### Added
- **Platform-aware rules block.** The managed rules block is no longer Claude-Code-only. The
  host agent declares itself via `--platform <claude-code|hermes|codex>` in the hook command pm
  authors for that platform, and the active platform is recorded in `.conductor/state.json`.
- Per-platform slash-command form: `/pm:status` on Claude Code and Hermes, `/pm-status` on Codex.
  The namespace is retained wherever supported because Hermes silently skips a plugin command
  that collides with a built-in, and it ships a built-in `status`.

### Fixed
- The rules block is now written to the file the host platform will actually read. Hermes
  resolves project context first-match-wins over `HERMES.md` > `AGENTS.md` > `CLAUDE.md`, so in a
  repo already carrying an `AGENTS.md` the block was silently invisible — no error, just an agent
  running without the conductor's instructions.

### Migration
- `0.24.0` stamps `platform` on existing state files, defaulting to `claude-code`. Additive and
  idempotent; a `0.23.1` state file still loads.
```

- [ ] **Step 6: Run the tests**

Run: `node --test scripts/conductor.test.mjs 2>&1 | rg "^(ℹ|#) (tests|pass|fail)"`
Expected: `fail 0`.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/subcommands.mjs scripts/lib/migrations.mjs scripts/lib/tracker.mjs \
        scripts/lib/review-mode.mjs .claude-plugin/plugin.json CHANGELOG.md scripts/conductor.test.mjs
git commit -m "feat(engine): record the active platform in state.json (0.24.0)

Written and read once per session start, so the choice is auditable in the state
of record and a platform SWITCH is detectable -- the project changed hands and the
new host's artifacts may need recreating. Additive 0.24.0 migration defaults
existing repos to claude-code."
```

---

### Task 5: Claude Code's hooks declare their platform, and the docs follow

**Files:**
- Modify: `hooks/hooks.json` (4 command strings)
- Modify: `README.md`, `commands/upgrade.md`, `skills/conductor/SKILL.md`
- Test: `scripts/conductor.test.mjs` (append)

**Interfaces:**
- Consumes: the `--platform` flag from Tasks 1 and 4.
- Produces: nothing new in code; this closes the loop so the declared-platform mechanism is actually exercised in the shipping product.

Without this task the mechanism exists but nothing uses it — every real session would fall through to the `CLAUDECODE`/default rung. There are exactly 4 hook commands (`brief`, `snapshot`, `commit-nudge`, `gate-guard`) at `hooks/hooks.json:10,22,34,46`.

- [ ] **Step 1: Write the failing test**

```javascript
test("every pm-authored Claude Code hook command declares its platform", () => {
  const hooks = JSON.parse(fs.readFileSync(new URL("../hooks/hooks.json", import.meta.url), "utf8"));
  const commands = JSON.stringify(hooks).match(/conductor\.mjs" [a-z-]+[^"]*/g) || [];
  assert.ok(commands.length >= 4, `expected at least 4 hook commands, found ${commands.length}`);
  for (const c of commands) {
    assert.match(c, /--platform claude-code/, `hook command does not declare its platform: ${c}`);
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test scripts/conductor.test.mjs 2>&1 | rg "^(ℹ|#) (tests|pass|fail)"`
Expected: FAIL — no hook command carries `--platform`.

- [ ] **Step 3: Add the flag to each hook command**

In `hooks/hooks.json`, append ` --platform claude-code` to all four commands. Example for the first:

```json
"command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs\" brief --platform claude-code"
```

Apply the same to `snapshot`, `commit-nudge`, and `gate-guard`.

- [ ] **Step 4: Run the tests**

Run: `node --test scripts/conductor.test.mjs 2>&1 | rg "^(ℹ|#) (tests|pass|fail)"`
Expected: `fail 0`.

- [ ] **Step 5: Update the user-facing docs**

`CLAUDE.md`'s documentation-currency rule requires README.md and the Mintlify site to reflect any user-facing change in the same PR cycle. This change is user-facing (a new flag, a new state field, a different file possibly being written).

- `README.md` — document `--platform`, the three supported ids, and that the rules block now targets the file the host platform reads. Read the surrounding section first and match its voice.
- `commands/upgrade.md` — note that `upgrade` stamps `platform` on pre-0.24.0 state.
- `skills/conductor/SKILL.md` — if it describes the rules block as living in `CLAUDE.md`, correct it.

Find every place that needs it rather than guessing: `rg -n "CLAUDE\.md" README.md commands/ skills/`.

**The Mintlify site is a separate repo and a separate procedure** — follow the `mintlify-doc-sync` skill; do **not** hand-edit or guess at it here. If you cannot complete it, say so explicitly in your report rather than silently skipping it.

- [ ] **Step 6: Verify the whole suite and commit**

Run: `node --test scripts/conductor.test.mjs 2>&1 | rg "^(ℹ|#) (tests|pass|fail)"`
Expected: `fail 0`.

```bash
git add hooks/hooks.json README.md commands/upgrade.md skills/conductor/SKILL.md scripts/conductor.test.mjs
git commit -m "feat(hooks): Claude Code hooks declare --platform claude-code

Closes the loop: without this the declared-platform mechanism exists but nothing
exercises it, and every real session would fall through to the env/default rung."
```

---

## Self-Review

**1. Spec coverage**

| Spec section | Task |
|---|---|
| §1 host declares itself via `--platform` | 1 (resolution), 5 (hooks actually declare it) |
| §2 resolution order + non-silent default | 1 (chain, reject-unknown), 4 (recorded rung) |
| §3 record in `state.json`, session start, MIGRATIONS | 4 |
| §4 write the file that wins the chain | 3 |
| §5 neutral body, only commands vary | 2 (asserted by the normalising equality test) |
| §6 per-platform command form | 2 |
| Verified platform facts table | 1 (constants) |
| Report the chosen platform/file | 3 (stderr), 4 (switch test) |
| Deferred: CLI fallback, foreign-file adoption, `SOUL.md` | none — correctly out of scope, filed as planned epics |
| Out of scope: `observe.py`, port artifact trees | none — stated in File Structure |

Open question 2 from the spec (reject vs fall through on an unknown `--platform`) is **resolved in Task 1**: reject with a message, mirroring `add-epic`'s `--lane` handling. Open question 1 (platform-switch artifact recreation) is deliberately left to the port epics; Task 4 implements only the detection-and-report half, which is this epic's share.

**2. Placeholder scan** — no TBD/TODO; every code step carries real code; every command has an exact expected result. Task 5 Step 5 intentionally instructs *finding* the doc sites via `rg` rather than listing line numbers, because doc line numbers drift and a stale number is worse than a search.

**3. Type consistency** — `resolvePlatform(flags, state)`, `assertKnownPlatform(platform)`, `rulesTarget(platform, root)`, `recordPlatform(state, platform)`, `pmCmd(platform, name)`, `writeRules(platform)`, `rulesBlock(tracker, reviewMode, secondaryTrackers, platform)` are used with these exact names and argument orders in every task that references them. `writeRules` gains a return value (the target path) that no existing caller reads.

**One risk worth flagging to the human before execution:** Task 3 changes `writeRules`'s stderr messages, and Task 4 touches six call sites. Existing tests that assert on the old `"refreshed rules block in CLAUDE.md"` string will fail. That is intended — the message changed on purpose — but the implementer must update those assertions rather than weaken them, and a reviewer should confirm the updates preserve the original intent.
