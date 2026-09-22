// scripts/test/unit/conductor-34.test.mjs
// 4.1's migration of `assert/conductor-34.test.mjs` — 5 of its 13 tests, moved from the file rung to
// the unit rung with every assertion unchanged.
//
// gh-89 / gh-90 / gh-114 / gh-154 — four INSTRUCTION-layer issues. Nothing here changes what
// the engine computes; all four change what pm EMITS.
//
// ─────────────── WHAT MOVED, AND WHAT DID NOT ───────────────
//
// FIVE moved, and they are exactly the tests whose only surface is the RENDERED block: the
// `mustSay` declaration on the lifecycle item, the numbered-intake-item form check, the
// numbered-operating-rule form check, the reporting section's own numbering, and the carve-outs that
// stop "defer to the user" from deleting an obligation. `rules` PRINTS the block, so `rulesText(cwd)`
// is the invocation the unit rung already makes.
//
// EIGHT STAY, and it is the same reason in every case: their assertion is a LOOP OVER SURFACES —
// `skills/conductor/SKILL.md`, `commands/epic.md`, `commands/status.md`, `commands/hierarchy.md`,
// `commands/lane-routing.md`, `commands/next.md`, `README.md` and the three `agents/*.md` files —
// read with `readFileSync` against the repository. Splitting the loop to move the one value-valued
// arm would weaken the per-surface assertion that is the whole point of it ("asserting against the
// surfaces JOINED would stay green when the warning is deleted from three of the four"). One more
// stays for a fixture reason: 34.2's one-site sweep runs `set-tracker`, which writes CLAUDE.md
// through raw fs.
//
//   `tmpRepo()` + `run(["init"], { cwd })`  →  `memoryEngine(emptyRecord())`
//   `rulesText(cwd)`                        →  `engine(["rules"])`

import assert from "node:assert/strict";
import { emptyRecord, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";
import { GATE_PROCEDURE_ITEMS } from "../../lib/rules.mjs";

const rulesText = (engine) => engine(["rules"]);

const norm = (s) => s.replace(/[`*_]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

/** Every numbered item in a body of emitted text, as `<n>. <title>` — the FORM check. A prose
 *  bullet does not appear here, which is what makes "downgraded to a bullet" a failing test
 *  rather than a cosmetic difference. 14/14 against 3/15 is why the form is asserted at all. */
const numberedItems = (text) =>
  text.split("\n").filter(l => /^\d+\. /.test(l.trim())).map(l => l.trim());

// ───────────── 34.1 (#154): the openspec-validate collision is documented where the marker is ─────────────

unitTest("34.1 the collision rides item 3's mustSay, so a reworded mirror cannot drop it", () => {
  const item = GATE_PROCEDURE_ITEMS.find(i => i.title === "Declare lifecycle bookkeeping.");
  assert.ok(item, "the lifecycle-bookkeeping item must still exist under that title");
  for (const claim of ["openspec validate --archived", "do NOT wire it into a pm-managed repo"]) {
    assert.ok(item.mustSay.some(c => norm(c) === norm(claim)),
      `"${claim}" must be declared in item 3's mustSay — otherwise conductor-16's 15.5 guard ` +
      "compares titles only and a mirror can drop the warning silently");
  }
  // It stays a NUMBERED required task item, not a prose bullet appended underneath it.
  const items = numberedItems(rulesText(memoryEngine(emptyRecord()))).join("\n");
  assert.match(items, /\*\*Declare lifecycle bookkeeping\.\*\*/);
});

// ───────────── 34.2 (#114): lane routing is instruction, not algorithm ─────────────

const INTAKE_HEADING = "## Intake — triage an ask against the whole backlog BEFORE registering it";

/** The intake section of an emitted rules block, sliced at its own heading. */
function intakeSection(text) {
  const start = text.indexOf(INTAKE_HEADING);
  assert.notEqual(start, -1, "the emitted block must carry the intake section");
  const rest = text.slice(start + INTAKE_HEADING.length);
  const next = rest.search(/\n## /);
  return next === -1 ? rest : rest.slice(0, next);
}

unitTest("34.2 lane choice is a NUMBERED intake item, not a prose aside", () => {
  const section = intakeSection(rulesText(memoryEngine(emptyRecord())));
  const items = numberedItems(section);
  assert.match(items.join("\n"), /\*\*Decide the lane; do not inherit it\.\*\*/,
    "the lane decision must be a numbered intake item — 14/14 against 3/15 is why the form matters");
  // Contiguous 1..N: an inserted item that leaves a gap breaks the "item N means the same thing
  // everywhere" claim the numbering carries.
  assert.deepEqual(items.map(l => Number(l.match(/^(\d+)\./)[1])), items.map((_, i) => i + 1),
    "intake's numbered items must run 1..N with no gap");
  assert.doesNotMatch(section, /^\s*[-*] \*\*Decide the lane/m, "not a bullet");
});

// ───────────── 34.3 (#89): discovery is delegated, and the rule binds the ORCHESTRATOR ─────────────

unitTest("34.3 delegating discovery is a NUMBERED operating rule, not a prose bullet", () => {
  const block = rulesText(memoryEngine(emptyRecord()));
  const items = numberedItems(block);
  const rule = items.find(l => /\*\*Delegate discovery/.test(l));
  assert.ok(rule, "the emitted block must carry the delegation rule as a numbered item — " +
    "14/14 against 3/15 for the same rule as a prose bullet");
  assert.doesNotMatch(block, /^\s*[-*] \*\*Delegate discovery/m, "not a bullet");
  // Its list is the operating rules, which run 1..N contiguously.
  const opsStart = block.indexOf("## PM Conductor — operating rules");
  const opsEnd = block.indexOf("## The gate procedure");
  assert.ok(opsStart !== -1 && opsEnd > opsStart);
  const ops = numberedItems(block.slice(opsStart, opsEnd));
  assert.deepEqual(ops.map(l => Number(l.match(/^(\d+)\./)[1])), ops.map((_, i) => i + 1),
    "the operating rules must run 1..N with no gap");
  assert.ok(ops.some(l => /\*\*Delegate discovery/.test(l)),
    "the rule belongs to the OPERATING rules, not to some other numbered list in the block");
});

// ───────────── 34.4 (#90): pm's reporting shape yields to the user's, where it is presentation ─────────────

const REPORTING_HEADING = "## Reporting — pm owns what is recorded and what is said; you own how you say it";

unitTest("34.4 the emitted block carries the reporting split as its own numbered section", () => {
  const block = rulesText(memoryEngine(emptyRecord()));
  assert.ok(block.includes(REPORTING_HEADING),
    "reporting must be a section of its own, not a sentence inside another");
  const start = block.indexOf(REPORTING_HEADING);
  const rest = block.slice(start + REPORTING_HEADING.length);
  const cut = rest.search(/\n## /);
  const section = cut === -1 ? rest : rest.slice(0, cut);
  const items = numberedItems(section);
  assert.ok(items.length >= 5, "the split is carried as numbered items, not prose bullets");
  assert.deepEqual(items.map(l => Number(l.match(/^(\d+)\./)[1])), items.map((_, i) => i + 1),
    "the reporting items must run 1..N with no gap");
});

unitTest("34.4 the carve-outs are stated, so 'defer to the user' cannot delete an obligation", () => {
  const t = norm(rulesText(memoryEngine(emptyRecord())));
  // Scope: this governs REPORTING, never DOING. Without it a brevity contract reads as licence to
  // skip a gate — the same failure the issue reports, pointed the other way.
  assert.ok(t.includes(norm("governs how you REPORT")),
    "the section must scope itself to reporting, never to what the other sections instruct");
  assert.ok(t.includes(norm("does not authorise skipping a required task item")),
    "it must say outright that a brevity contract does not excuse a required task item or a gate");
  // RECORDED band: a write is not a sentence.
  assert.ok(t.includes(norm("not sentences")) && t.includes(norm("data loss, not brevity")),
    "the recorded band must be named as writes, with the consequence of shortening one");
  // PARSED band: field names are a wire format.
  assert.ok(t.includes(norm("wire format")) && t.includes(norm("STATUS/DONE/DECISIONS/CONCERNS")),
    "the parsed band must name the machine-read blocks and say they do not bend");
  // The mapping mechanic: reshape, never drop.
  assert.ok(t.includes(norm("Reshaping is always allowed")) && t.includes(norm("ADD a slot")),
    "it must say to add a slot for a required element the user's shape has no room for, not drop it");
});
