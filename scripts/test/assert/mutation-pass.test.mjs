import "../fixtures/assert-git-shim.mjs";  // the run-time git counter, installed in THIS process

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GATE_PROCEDURE_ITEMS } from "../../lib/rules.mjs";

// mutation-pass-is-a-required-task-item: the PATH half. The rendered block and the generator are asserted
// on the unit rung (`unit/mutation-pass.test.mjs`); what is here reads shipped FILES — the three mirrors,
// the skill, the parity ledger and the lesson that names where its rule binds.

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const shipped = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");
const MUTATION_ITEM = "Prove every guard can fail.";
const MIRRORS = ["skills/conductor/SKILL.md", "commands/epic.md", "commands/status.md"];
const CLAIMS = ["MUTATE it", "mutation-evidence.txt", "A SURVIVING mutant is a finding to fix",
  "task-relative", "fails after 2.4", "when the task that depends on it starts"];
const norm = (s) => s.replace(/[`*_]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

const itemBody = (text, n, title) => {
  const lines = text.split("\n");
  const start = lines.findIndex(l => l.trim().startsWith(`${n}. **${title}**`));
  assert.ok(start !== -1, `no numbered item ${n}. **${title}** found`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex(l => /^\s*\d+\.\s+\*\*/.test(l) || /^## /.test(l));
  return [lines[start], ...(end === -1 ? rest : rest.slice(0, end))].join("\n");
};

test("mutation-pass: every mirror carries the item NUMBERED with each claim inside its own body", () => {
  const n = GATE_PROCEDURE_ITEMS.findIndex(i => i.title === MUTATION_ITEM) + 1;
  assert.ok(n > 0, "the item must exist in the generator");
  for (const rel of MIRRORS) {
    const body = norm(itemBody(shipped(rel), n, MUTATION_ITEM));
    for (const claim of CLAIMS) {
      assert.ok(body.includes(norm(claim)), `${rel} item ${n} is missing "${claim}"`);
    }
  }
});

test("mutation-pass: the skill exists, names the artifact and the RED-note rule, and the ledger claims it once", () => {
  const skill = "skills/mutation-pass/SKILL.md";
  const text = shipped(skill);
  assert.match(text, /^name: mutation-pass$/m, "frontmatter name");
  for (const claim of ["mutation-evidence.txt", "surviving mutant", "task-relative", "fails after"]) {
    assert.ok(norm(text).includes(norm(claim)), `${skill} must carry "${claim}"`);
  }
  const ledger = JSON.parse(shipped("docs/parity-ledger.json"));
  const owners = ledger.capabilities.filter(c => c.artifacts.includes(skill));
  assert.equal(owners.length, 1, `${skill} must be claimed by exactly one capability`);
});

test("mutation-pass: the lesson that states the habit names the item and the skill as its mechanism", () => {
  const txt = shipped("docs/lessons/a-guard-can-check-the-wrong-half.md");
  const line = txt.split("\n").find(l => l.startsWith("enforced_in:")) ?? "";
  assert.ok(line.includes(MUTATION_ITEM), "enforced_in must name the required item");
  assert.ok(line.includes("skills/mutation-pass/SKILL.md"), "enforced_in must name the skill");
  assert.doesNotMatch(line, /no mechanism/, "the lesson no longer has 'no mechanism'");
});
