// scripts/test/assert/execution-profile-emission.test.mjs
// execution-profile-layered-settings 4.1 (the pinned fixture), 4.3 and 4.5 — the FILE-rung half:
// CLAUDE.md's bytes, a fixture file, and what `init` leaves on disk.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, readState, claudeMd } from "../fixtures/assert-harness.mjs";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const FIXTURE = fs.readFileSync(path.join(HERE, "..", "fixtures", "rules-0.52.0-execution-profile.txt"), "utf8");
const LIB = new URL("../../lib/", import.meta.url).href;

test("4.1: the rules block's Execution profile section is byte-pinned by the current-version fixture", async () => {
  const { rulesBlock } = await import(LIB + "rules.mjs");
  const { profileContext } = await import(LIB + "execution-profile.mjs");
  const state = { reviewMode: "thorough",
    executionProfile: { verbosity: "verbose", model: { implement: { model: "sonnet", effort: "medium" }, test: { model: "haiku" } } },
    laneProfiles: { "claude-code": { review: "standard", model: { test: { model: "haiku" } } }, decision: { review: "off" } }, epics: [] };
  const block = rulesBlock(null, "thorough", [], "claude-code", profileContext(state));
  const section = block.slice(block.indexOf("## Execution profile"), block.indexOf("## Release candidate"));
  assert.equal(section, FIXTURE, "regenerate scripts/test/fixtures/rules-0.52.0-execution-profile.txt deliberately if this changes");
});

test("4.3: set-profile refreshes the block on disk with the new project value; an epic-layer write does not rewrite it", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "e", "--title", "E", "--lane", "claude-code"], { cwd });
  assert.match(claudeMd(cwd), /- review: standard \(default\)/);
  run(["set-profile", "--review", "thorough", "--model", "implement=opus:medium", "--lane", "claude-code"].filter((a) => a !== "--lane" && a !== "claude-code"), { cwd });
  const after = claudeMd(cwd);
  assert.match(after, /- review: thorough \(project\)/);
  assert.match(after, /- model implement: opus \(medium\) \(project\)/);
  assert.match(after, /Current mode: \*\*thorough\*\*/);
  run(["set-profile", "--lane", "claude-code", "--review", "off"], { cwd });
  assert.match(claudeMd(cwd), /Lane overrides:\n- claude-code: review off/);
  const before = fs.readFileSync(path.join(cwd, "CLAUDE.md"));
  run(["update-epic", "e", "--review-mode", "off", "--model", "test=haiku", "--verbosity", "verbose"], { cwd });
  assert.equal(Buffer.compare(fs.readFileSync(path.join(cwd, "CLAUDE.md")), before), 0, "an epic-layer write leaves CLAUDE.md byte-identical");
});

test("4.5: init writes no model on its own, and its instructions recommend accepting the defaults", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  const s = readState(cwd);
  assert.ok(!s.executionProfile, "a fresh init's state holds no executionProfile");
  assert.ok(!s.laneProfiles);
  const doc = fs.readFileSync(path.join(HERE, "..", "..", "..", "commands", "init.md"), "utf8");
  assert.match(doc, /ASK\s+the\s+user/);
  assert.match(doc, /Recommend ACCEPTING the built-in defaults, which records nothing/);
  assert.match(doc, /--model implement=fable:<effort>/);
  assert.match(doc, /set-profile/);
});

test("2.1: no verb writes a default: init, then upgrade, then profile leave no model entry at any layer", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "e", "--title", "E", "--lane", "claude-code"], { cwd });
  run(["upgrade"], { cwd });
  run(["profile"], { cwd });
  run(["profile", "--epic", "e"], { cwd });
  const raw = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
  const s = JSON.parse(raw);
  assert.ok(!s.executionProfile || !("model" in s.executionProfile), "no project-layer model");
  assert.ok(!s.laneProfiles, "no lane layer");
  for (const e of s.epics) assert.ok(!("model" in e), `epic ${e.id} holds no model`);
  assert.doesNotMatch(raw, /"effort"/, "no default pair was serialised anywhere");
});

test("3.2: the command docs name every job role, and profile.md and init.md carry every default pair", async () => {
  const { KNOWN_JOB_ROLES, DEFAULT_ROLE_MODELS } = await import(LIB + "constants.mjs");
  const { modelText } = await import(LIB + "execution-profile.mjs");
  const doc = (n) => fs.readFileSync(path.join(HERE, "..", "..", "..", "commands", n), "utf8");
  for (const n of ["profile.md", "init.md", "epic.md", "spend.md"]) {
    for (const role of KNOWN_JOB_ROLES) assert.ok(doc(n).includes(role), `${n} names role ${role}`);
  }
  for (const n of ["profile.md", "init.md"]) {
    const text = doc(n).replaceAll("`", "");
    for (const role of KNOWN_JOB_ROLES) {
      const pair = modelText(DEFAULT_ROLE_MODELS[role]);
      assert.ok(text.includes(pair), `${n} carries the default pair '${pair}' of ${role}`);
    }
  }
});
