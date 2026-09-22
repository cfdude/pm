import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, runCombined, invokeEngine } from "../fixtures/assert-harness.mjs";

// 4.1 (0.48.0) moved SIX of this file's tests to the unit rung — the whole `rules`-verb family, whose
// observables are the resolved platform and the emitted text, both values. `scripts/test/unit/
// platform.test.mjs` holds them. What remains here needs a PATH: `write-rules`/`init` WRITE the rules
// block through raw fs (the seam edge "a VERB whose side effect writes a path"), `rules-target` READS
// the filesystem to resolve first-existing-wins, and the shipped-hooks test reads hooks/hooks.json.

// ────────────── platform resolution + rules target ──────────────

test("rulesTarget returns CLAUDE.md for claude-code regardless of a stray AGENTS.md", () => {
  const cwd = tmpRepo();
  fs.writeFileSync(path.join(cwd, "AGENTS.md"), "# from some other agent\n");
  run(["init"], { cwd });
  assert.ok(fs.existsSync(path.join(cwd, "CLAUDE.md")), "claude-code has no chain; CLAUDE.md is written");
  const agents = fs.readFileSync(path.join(cwd, "AGENTS.md"), "utf8");
  assert.doesNotMatch(agents, /BEGIN pm-conductor rules/, "the stray file must be left alone");
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

// ────────────── the shipping hooks actually declare their platform ──────────────

test("every pm-authored Claude Code hook command declares its platform", () => {
  const hooks = JSON.parse(fs.readFileSync(new URL("../../../hooks/hooks.json", import.meta.url), "utf8"));
  const commands = JSON.stringify(hooks).match(/conductor\.mjs\\" [a-z-]+[^"]*/g) || [];
  assert.ok(commands.length >= 4, `expected at least 4 hook commands, found ${commands.length}`);
  for (const c of commands) {
    assert.match(c, /--platform claude-code/, `hook command does not declare its platform: ${c}`);
  }
});

// ── rules-target: expose the resolved target so consumers stop guessing it ──
// evals/observe.py hardcoded CLAUDE.md, which made it a SECOND platform seam: the engine now
// writes a per-platform target, so the observer reported rules_block_present=false for any
// platform whose block lands elsewhere -- a confident wrong answer that would surface as a fake
// parity failure on the first non-Claude run. Rather than mirror PLATFORM_RULES_CHAIN into
// Python (a second copy that can drift, which is the same class of bug), the engine answers.

test("rules-target prints the absolute path for the default platform", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const out = run(["rules-target"], { cwd, env: { CLAUDECODE: "" } }).trim();
  assert.equal(out, path.join(cwd, "CLAUDE.md"));
  assert.ok(path.isAbsolute(out), "must be absolute so a consumer can use it directly");
});

test("rules-target honours --platform and the per-platform chain", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  assert.equal(run(["rules-target", "--platform", "codex"], { cwd }).trim(),
    path.join(cwd, "AGENTS.md"), "codex reads AGENTS.md and never CLAUDE.md");
  // Clean repo: hermes gets the chain's LAST entry (most broadly compatible), not HERMES.md.
  assert.equal(run(["rules-target", "--platform", "hermes"], { cwd }).trim(),
    path.join(cwd, "CLAUDE.md"));
});

test("rules-target resolves first-existing-wins, so it tracks what the platform will READ", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  fs.writeFileSync(path.join(cwd, "AGENTS.md"), "# left by a prior agent\n");
  assert.equal(run(["rules-target", "--platform", "hermes"], { cwd }).trim(),
    path.join(cwd, "AGENTS.md"),
    "AGENTS.md outranks CLAUDE.md in hermes' chain, so that is what it will read");
});

test("rules-target is READ-ONLY -- it must not record a platform or create state", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const before = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
  run(["rules-target", "--platform", "codex"], { cwd });
  assert.equal(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"), before,
    "a query must not persist a platform switch -- only init/write-rules do that");
});

test("rules-target rejects an unknown --platform rather than defaulting", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const r = invokeEngine(["rules-target", "--platform", "nope"], { cwd });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--platform must be one of claude-code\|hermes\|codex/);
});
