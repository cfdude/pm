// scripts/test/assert/openspec-addenda.test.mjs
// gh-cfdude-pm-262 task 4.1 / 5.1 (FILE rung): the bytes the OpenSpec addenda section leaves in a repo's CLAUDE.md, the brief's
// residual / missing lines over a real tree, `overhead` counting the section, and THIS repo's own generated files being pristine.
// The value-level half is in unit/openspec-addenda.test.mjs and unit/openspec-addenda-rules.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpRepo, run, runCombined, parseBrief } from "../fixtures/assert-harness.mjs";
import { engineCode } from "../fixtures/source-code.mjs";
import { OPENSPEC_ADDENDA_MAX_BYTES, PM_OPENSPEC_ADDENDA } from "../../lib/openspec-addenda.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const NEEDLE = PM_OPENSPEC_ADDENDA[0].needle;
const HEADING = "## OpenSpec addenda";
const claude = (cwd) => fs.readFileSync(path.join(cwd, "CLAUDE.md"), "utf8");
const count = (text) => text.split(HEADING).length - 1;
const repo = ({ openspec } = {}) => {
  const cwd = tmpRepo();
  if (openspec) fs.mkdirSync(path.join(cwd, "openspec"), { recursive: true });
  run(["init"], { cwd });
  return cwd;
};
const sections = (cwd) => run(["rules", "--sections"], { cwd });

test("4.1a a repo with openspec/ carries the section exactly once, with the clause", () => {
  const cwd = repo({ openspec: true });
  run(["write-rules"], { cwd });
  assert.equal(count(claude(cwd)), 1);
  assert.ok(claude(cwd).includes(NEEDLE));
});

test("4.1b a repo without openspec/ has no section and pays no bytes", () => {
  const cwd = repo();
  assert.equal(count(claude(cwd)), 0);
  assert.ok(!sections(cwd).includes("OpenSpec addenda"));
});

test("4.1c removing openspec/ and refreshing drops the section (the inverse)", () => {
  const cwd = repo({ openspec: true });
  assert.equal(count(claude(cwd)), 1);
  fs.rmSync(path.join(cwd, "openspec"), { recursive: true });
  run(["write-rules"], { cwd });
  assert.equal(count(claude(cwd)), 0);
});

test("4.1d write-rules twice leaves the file byte-identical", () => {
  const cwd = repo({ openspec: true });
  run(["write-rules"], { cwd });
  const first = claude(cwd);
  run(["write-rules"], { cwd });
  assert.equal(claude(cwd), first);
});

test("4.1e `rules --sections` lists the heading with a size within the cap", () => {
  const cwd = repo({ openspec: true });
  const line = sections(cwd).split("\n").find((l) => l.includes("OpenSpec addenda"));
  assert.ok(line, "listed");
  const n = Number(/(\d+) bytes/.exec(line)[1]);
  assert.ok(n <= OPENSPEC_ADDENDA_MAX_BYTES + 2, `${n} bytes (+ the blank separator line)`);
});

test("4.1f `overhead` counts the section for the same repo (the overhead call site passes it)", () => {
  const cwd = repo({ openspec: true });
  const rules = JSON.parse(run(["overhead", "--json"], { cwd }));
  assert.ok(JSON.stringify(rules).includes("OpenSpec addenda"), "overhead names the section");
  const bare = repo();
  assert.ok(!JSON.stringify(JSON.parse(run(["overhead", "--json"], { cwd: bare }))).includes("OpenSpec addenda"));
});

test("brief: pm text left inside a generated file is RESIDUAL; a clean tree and a block with the section are silent", () => {
  const cwd = repo({ openspec: true });
  assert.doesNotMatch(parseBrief(cwd), /OpenSpec addenda (RESIDUAL|MISSING)/);
  const skill = path.join(cwd, ".claude", "skills", "openspec-archive-change", "SKILL.md");
  fs.mkdirSync(path.dirname(skill), { recursive: true });
  fs.writeFileSync(skill, `step 6; ${NEEDLE}\n`);
  assert.match(parseBrief(cwd), /OpenSpec addenda RESIDUAL .*openspec-archive-change\/SKILL\.md/);
});

test("brief: a repo with openspec/ whose block lacks the section reports MISSING, and write-rules clears it", () => {
  const cwd = repo({ openspec: true });
  fs.writeFileSync(path.join(cwd, "CLAUDE.md"), claude(cwd).replace(/## OpenSpec addenda[\s\S]*?(?=\n## )/, ""));
  assert.match(parseBrief(cwd), /OpenSpec addenda MISSING/);
  run(["write-rules"], { cwd });
  assert.doesNotMatch(parseBrief(cwd), /OpenSpec addenda MISSING/);
});

test("5.1 THIS repo's generated archive skill and command do not carry pm's clause", () => {
  for (const rel of [".claude/skills/openspec-archive-change/SKILL.md", ".claude/commands/opsx/archive.md"]) {
    assert.ok(!fs.readFileSync(path.join(ROOT, rel), "utf8").includes(NEEDLE), rel);
  }
});

test("12.10 the addenda module never spawns a process or imports the child_process module (the engine only READS; pm instructs)", () => {
  const src = engineCode("scripts/lib/openspec-addenda.mjs");
  assert.doesNotMatch(src, new RegExp("child" + "_process"));
  assert.doesNotMatch(src, new RegExp("(?<![.\\w$])" + "(exec|spawn)" + "(File|Sync)?(Sync)?\\s*\\("));
});

test("upgrade prints the RESIDUAL line too (the second surface of the shared emitter)", () => {
  const cwd = repo({ openspec: true });
  const skill = path.join(cwd, ".claude", "skills", "openspec-archive-change", "SKILL.md");
  fs.mkdirSync(path.dirname(skill), { recursive: true });
  fs.writeFileSync(skill, `step 6; ${NEEDLE}\n`);
  assert.match(runCombined(["upgrade"], { cwd }), /OpenSpec addenda RESIDUAL/);
});

test("11.3 the brief reads the block from the RECORDED platform's rules file, as upgrade does (codex: AGENTS.md, not an unrelated CLAUDE.md)", () => {
  const cwd = tmpRepo();
  fs.mkdirSync(path.join(cwd, "openspec"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "CLAUDE.md"), "# CLAUDE.md\n\nproject notes with no pm block\n");
  run(["init", "--platform", "codex"], { cwd });
  assert.ok(fs.readFileSync(path.join(cwd, "AGENTS.md"), "utf8").includes(HEADING), "the codex block carries the section");
  assert.doesNotMatch(parseBrief(cwd), /OpenSpec addenda MISSING/, "a block that HAS the section must not read as missing because CLAUDE.md lacks it");
  const agents = path.join(cwd, "AGENTS.md");
  fs.writeFileSync(agents, fs.readFileSync(agents, "utf8").replace(/## OpenSpec addenda[\s\S]*?(?=\n## )/, ""));
  assert.match(parseBrief(cwd), /OpenSpec addenda MISSING/, "and a codex block that lacks it is reported");
});
