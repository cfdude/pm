// scripts/test/unit/mutation-pass.test.mjs
// mutation-pass-is-a-required-task-item: the gate procedure's last numbered item obliges the agent to
// MUTATE every guard a change adds and keep the run, and to write RED notes task-relative (#211).
//
// Every assertion is made against the RENDERED rules block (`rules` stdout), never the generator's
// source: a test that greps the source passes for a line no branch emits. The mirrors and the shipped
// skill are PATH reads and live in `scripts/test/assert/mutation-pass.test.mjs`.

import assert from "node:assert/strict";
import { emptyRecord, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";
import { GATE_PROCEDURE_ITEMS } from "../../lib/rules.mjs";

export const MUTATION_ITEM = "Prove every guard can fail.";
const ROUTING_ITEM = "Route what the work taught you.";
/** The claims that must survive any rewording, on every surface. Determiner-free and punctuation-stable. */
export const MUTATION_CLAIMS = [
  "MUTATE it",
  "mutation-evidence.txt",
  "Save and commit the run",
  "A SURVIVING mutant is a finding to fix",
  "No guard added",
  "task-relative",
  "fails after 2.4",
  "when its own task starts",
  "mutation-pass",
];
const norm = (s) => s.replace(/[`*_]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

/** The lines of numbered item `n`: its title line plus continuations up to the next numbered item or heading. */
const itemBody = (text, n, title) => {
  const lines = text.split("\n");
  const start = lines.findIndex(l => l.trim().startsWith(`${n}. **${title}**`));
  assert.ok(start !== -1, `no numbered item ${n}. **${title}** found`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex(l => /^\s*\d+\.\s+\*\*/.test(l) || /^## /.test(l));
  return [lines[start], ...(end === -1 ? rest : rest.slice(0, end))].join("\n");
};
const rendered = () => memoryEngine(emptyRecord())(["rules"]);

unitTest("mutation-pass: the item is a numbered gate-procedure item that comes AFTER the routing item", () => {
  const titles = GATE_PROCEDURE_ITEMS.map(i => i.title);
  assert.ok(titles.includes(MUTATION_ITEM), `the gate procedure must carry "${MUTATION_ITEM}"`);
  assert.ok(titles.indexOf(MUTATION_ITEM) > titles.indexOf(ROUTING_ITEM),
    "appended, never inserted: tests, lessons and docs cite items 1-7 by number");
});

unitTest("mutation-pass: the rendered block carries the item NUMBERED, with every claim inside its own body", () => {
  const n = GATE_PROCEDURE_ITEMS.findIndex(i => i.title === MUTATION_ITEM) + 1;
  assert.ok(n > 0, "the item must exist before its body can be sliced");
  const body = norm(itemBody(rendered(), n, MUTATION_ITEM));
  for (const claim of MUTATION_CLAIMS) {
    assert.ok(body.includes(norm(claim)),
      `the rendered item ${n} body is missing "${claim}" — an obligation placed outside the numbered item is a prose bullet`);
  }
});

unitTest("mutation-pass: the item declares every claim in mustSay, so a mirror cannot drop or reverse it", () => {
  const item = GATE_PROCEDURE_ITEMS.find(i => i.title === MUTATION_ITEM);
  assert.ok(item, "the item must exist before its claims can be checked");
  for (const claim of MUTATION_CLAIMS) {
    assert.ok(item.mustSay.some(c => norm(c) === norm(claim)), `mustSay must declare "${claim}"`);
  }
});

unitTest("mutation-pass: the item stays inside its byte budget (every session pays for the rules block)", () => {
  const n = GATE_PROCEDURE_ITEMS.findIndex(i => i.title === MUTATION_ITEM) + 1;
  assert.ok(n > 0, "the item must exist before it can be measured");
  const bytes = Buffer.byteLength(itemBody(rendered(), n, MUTATION_ITEM) + "\n", "utf8");
  assert.ok(bytes <= 600, `item ${n} is ${bytes} bytes; the budget is 600 (~150 tokens)`);
});
