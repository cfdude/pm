import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, runCombined, ENGINE, EMPTY_CACHE } from "./helpers.mjs";

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

// ────────────── per-platform command form ──────────────

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

// ── regression: the block ANCHOR must tolerate older decoration ──
// The parenthetical in RULES_BEGIN changed from "(managed by /pm:init …)" to the
// platform-neutral "(managed by pm …)". Detection used to key on the FULL string, so a block
// written by any earlier version stopped matching and writeRules() fell through to its APPEND
// branch -- producing a SECOND rules block in every existing repo on the next upgrade.
// Verified live before the fix: 1 block in, 2 blocks out.

test("writeRules upgrades a block written with the OLD marker wording instead of duplicating it", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const claudeMdPath = path.join(cwd, "CLAUDE.md");

  // Simulate a repo last written by <= 0.23.1.
  const asOldVersion = fs.readFileSync(claudeMdPath, "utf8")
    .replace("(managed by pm — safe to delete this block)",
             "(managed by /pm:init — safe to delete this block)");
  fs.writeFileSync(claudeMdPath, asOldVersion);
  assert.equal((asOldVersion.match(/BEGIN pm-conductor rules/g) || []).length, 1);

  run(["write-rules"], { cwd });

  const after = fs.readFileSync(claudeMdPath, "utf8");
  assert.equal((after.match(/BEGIN pm-conductor rules/g) || []).length, 1,
    "an old-marker block must be refreshed IN PLACE, never appended alongside");
  assert.match(after, /managed by pm — safe to delete this block/,
    "the anchor should be upgraded to the current wording");
  assert.doesNotMatch(after, /managed by \/pm:init/,
    "the stale wording must not survive the refresh");
});

// ────────────── writeRules() targets the platform's actual precedence chain ──────────────

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

// ────────────── platform recorded in state.json ──────────────

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

// ── regression: pm must stay DORMANT until /pm:init ──
// resolveAndRecordPlatform() persists the resolved platform, but loadState() returns
// defaultState() for a missing file rather than null -- so recordPlatform() always reports a
// change on a fresh repo, and an unguarded saveState() CREATED .conductor/state.json in a
// project that never ran /pm:init. That silently ends dormancy: once state.json exists,
// isInitialized() is true and every hook activates. Verified live before the guard.

test("write-rules does NOT create conductor state in a repo that never ran init (dormancy)", () => {
  const cwd = tmpRepo();                       // deliberately NOT initialized
  run(["write-rules"], { cwd });
  assert.ok(!fs.existsSync(path.join(cwd, ".conductor", "state.json")),
    "write-rules must not seed .conductor/state.json -- pm is dormant until /pm:init");
});

test("commit-nudge stays dormant in a repo that never ran init", () => {
  const cwd = tmpRepo();
  const out = run(["commit-nudge"], { cwd, input: JSON.stringify({
    tool_input: { command: 'git commit -m "fix: something"' } }) });
  assert.equal(out.trim(), "",
    "commit-nudge must emit nothing at all before /pm:init");
  assert.ok(!fs.existsSync(path.join(cwd, ".conductor", "state.json")));
});

test("an initialized repo DOES persist a platform switch (the guard must not block the real case)", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["write-rules", "--platform", "codex"], { cwd });
  const state = JSON.parse(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"));
  assert.equal(state.platform, "codex",
    "guard failed closed: an initialized repo must still record the switch");
});
