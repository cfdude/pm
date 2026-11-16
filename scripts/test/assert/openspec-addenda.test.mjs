// scripts/test/assert/openspec-addenda.test.mjs
// gh-cfdude-pm-262 task 4.1 / 5.1 (FILE rung): the bytes the OpenSpec addenda section leaves in a repo's CLAUDE.md, the brief's
// residual / missing lines over a real tree, `overhead` counting the section, and THIS repo's own generated files being pristine.
// The value-level half is in unit/openspec-addenda.test.mjs and unit/openspec-addenda-rules.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpRepo, run, parseBrief } from "../fixtures/assert-harness.mjs";
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
