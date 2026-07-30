import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, ENGINE, EMPTY_CACHE } from "./helpers.mjs";

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
