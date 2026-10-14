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

// 3.2 — doc drift. Every doc that STATES the role list or the default pairs is checked against
// KNOWN_JOB_ROLES and DEFAULT_ROLE_MODELS with strings GENERATED from them and matched EXACTLY, so
// deleting one role from a list, or changing one role's default, fails the doc that states it. A bare
// `includes("plan")` could not: `plan` appears 20 times in epic.md, and `opus (high)` / `sonnet (low)`
// are each shared by two roles. Markdown noise (backticks, `\|` escapes, line wraps) is normalised on
// both sides before comparing.
const norm = (t) => t.replaceAll("`", "").replaceAll("\\", "").replace(/\s+/g, " ");
const ROOT = path.join(HERE, "..", "..", "..");
const escRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// where each doc states the roles (`lists`: how, as a join of the generated role names) and the default
// pairs (`pairs`: "table" = a `| role | what it does | pair |` row, "prose" = `role pair` adjacent).
const DOC_CLAIMS = [
  { file: "commands/profile.md", lists: [(r) => r.join(" | ")], pairs: "table" },
  { file: "commands/init.md", lists: [(r) => r.join(", ")], pairs: "prose" },
  { file: "commands/epic.md", lists: [(r) => r.join("|")] },
  { file: "commands/spend.md", lists: [(r) => r.join(", ")] },
  { file: "skills/conductor/SKILL.md", lists: [(r) => r.join(", "), (r) => r.map((x) => `${x}?`).join("|")] },
  { file: "README.md", lists: [(r) => r.join("|")], pairs: "prose" },
];

export async function docDriftFailures(read) {
  const { KNOWN_JOB_ROLES, DEFAULT_ROLE_MODELS } = await import(LIB + "constants.mjs");
  const { modelText } = await import(LIB + "execution-profile.mjs");
  const out = [];
  for (const { file, lists, pairs } of DOC_CLAIMS) {
    const text = norm(read(file));
    for (const list of lists) {
      const want = list([...KNOWN_JOB_ROLES]);
      if (!text.includes(want)) out.push(`${file} does not state the role list '${want}'`);
    }
    if (!pairs) continue;
    for (const role of KNOWN_JOB_ROLES) {
      const pair = modelText(DEFAULT_ROLE_MODELS[role]);
      const re = pairs === "table"
        ? new RegExp(`\\| ${escRe(role)} \\| [^|]* \\| ${escRe(pair)} \\|`)
        : new RegExp(`(^|[ ,(])${escRe(role)} ${escRe(pair)}([ ,.;)]|$)`);
      if (!re.test(text)) out.push(`${file} does not give ${role} its default '${pair}' (${pairs} form)`);
    }
  }
  return out;
}

test("3.2: every doc that states the roles or defaults states exactly KNOWN_JOB_ROLES and DEFAULT_ROLE_MODELS", async () => {
  const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
  assert.deepEqual(await docDriftFailures(read), []);
});

test("3.2: the drift check FAILS when one role is dropped from a list or one default is changed", async () => {
  const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
  const mutate = (file, from, to) => (f) => {
    const t = read(f);
    if (f !== file) return t;
    assert.ok(t.includes(from), `${file} holds the text this mutation targets: ${from}`);
    return t.replace(from, to);
  };
  // (a) delete `plan` from the epic.md role list
  const a = await docDriftFailures(mutate("commands/epic.md", "plan\\|implement\\|test", "implement\\|test"));
  assert.ok(a.some((m) => m.startsWith("commands/epic.md does not state the role list")), a.join("\n"));
  // (b) change plan's default in profile.md
  const b = await docDriftFailures(mutate("commands/profile.md", "| `plan` | proposals, specs, designs and implementation plans | `opus` (`high`) |",
    "| `plan` | proposals, specs, designs and implementation plans | `opus` (`low`) |"));
  assert.ok(b.some((m) => m.startsWith("commands/profile.md does not give plan its default")), b.join("\n"));
  // (c) change one of two roles that SHARE a pair: a bare pair-includes could not see it
  const c = await docDriftFailures(mutate("commands/init.md", "`mechanical` `sonnet` (`low`)", "`mechanical` `sonnet` (`medium`)"));
  assert.ok(c.some((m) => m.includes("mechanical")), c.join("\n"));
});

test("1.2: the real verbs unset a role at project, lane and epic, and the profile reads the default again", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "e", "--title", "E", "--lane", "claude-code"], { cwd });
  run(["set-profile", "--model", "plan=sonnet:high"], { cwd });
  run(["set-profile", "--lane", "claude-code", "--model", "mechanical=haiku"], { cwd });
  run(["update-epic", "e", "--model", "rudimentary=sonnet:low"], { cwd });
  const set = run(["profile", "--epic", "e"], { cwd });
  assert.match(set, /model plan: sonnet \(high\) \(project\)/);
  assert.match(set, /model mechanical: haiku \(lane:claude-code\)/);
  assert.match(set, /model rudimentary: sonnet \(low\) \(epic\)/);
  run(["set-profile", "--unset", "model:plan"], { cwd });
  run(["set-profile", "--lane", "claude-code", "--unset", "model"], { cwd });
  run(["update-epic", "e", "--clear-model", "rudimentary"], { cwd });
  const after = run(["profile", "--epic", "e"], { cwd });
  assert.match(after, /model plan: opus \(high\) \(default\)/);
  assert.match(after, /model mechanical: sonnet \(low\) \(default\)/);
  assert.match(after, /model rudimentary: haiku \(default\)/);
  const s = readState(cwd);
  assert.ok(!s.executionProfile && !s.laneProfiles && !("model" in s.epics[0]), "every layer is gone from state.json");
});
