// scripts/test/outcome-vocabulary.test.mjs
// THE anchor under the outcome vocabulary.
//
// `AGENT_OUTCOMES` is DERIVED — `KNOWN_OUTCOMES.filter(o => o !== "unknown")` — which is right,
// and is why every emitted enumeration and every archive-gate refusal renders from it rather than
// from a list somebody typed. But BOTH drift guards (conductor-13, conductor-18) also anchor their
// assertions to `AGENT_OUTCOMES`. So emitter and assertion move TOGETHER: narrow the constant and
// nothing fires. Verified during 0.40.0's Gate 2 fix pass — anchoring conductor-13 to the joined
// alternation does not catch a narrowed constant; only hard-coding a stale list in the emitter did.
//
// That is the same shape as the five stale `declined` sites 0.40.0 repaired, one level up: the
// guard is derived, which is correct, and nothing guards the thing it derives FROM.
//
// So this file holds ONE DELIBERATE LITERAL, at the root of the vocabulary, and asserts every
// derivation above it. The literal is the point: growing the vocabulary must be a conscious edit
// here, stating what the new value means, rather than a filter that quietly changes shape.

import { test } from "node:test";
import assert from "node:assert/strict";
import { KNOWN_OUTCOMES } from "../../lib/disposition.mjs";
import { AGENT_OUTCOMES } from "../../lib/archive-gate.mjs";

/** The vocabulary, written out. The ONLY hard-coded outcome list in the suite.
 *
 *  `unknown` is last and separate because it is the one value an agent may never supply: it is
 *  the engine's stamp for "nobody was asked", and `unconsidered-outcomes` exists to drive its
 *  population to zero. Every other value is a judgement somebody recorded. */
const AGENT_SUPPLIABLE = [
  "delivered", "killed", "superseded", "abandoned", "declined", "unreconstructable",
];
const ENGINE_ONLY = ["unknown"];

test("KNOWN_OUTCOMES is exactly the agent-suppliable set plus the engine-only stamp", () => {
  assert.deepEqual([...KNOWN_OUTCOMES].sort(), [...AGENT_SUPPLIABLE, ...ENGINE_ONLY].sort(),
    "the outcome vocabulary changed. That is allowed — but it must be a deliberate edit HERE, " +
    "stating what the new value means and what rule exempts it, not a side effect of a filter.");
});

test("AGENT_OUTCOMES derives from KNOWN_OUTCOMES by removing exactly the engine-only stamp", () => {
  // Asserted as a RELATION, not as a second literal: the derivation is the property under test.
  assert.deepEqual([...AGENT_OUTCOMES].sort(),
    KNOWN_OUTCOMES.filter(o => !ENGINE_ONLY.includes(o)).sort(),
    "AGENT_OUTCOMES must be KNOWN_OUTCOMES minus the engine-only stamps — nothing more removed, " +
    "nothing added. Narrowing it silently shrinks every emitted --outcome enumeration AND every " +
    "archive-gate refusal at once, because both render from it.");
});

test("AGENT_OUTCOMES cannot be narrowed without this file failing", () => {
  // The regression this file exists for, stated as a property rather than trusted to the two
  // assertions above: every agent-suppliable value is present, individually.
  for (const o of AGENT_SUPPLIABLE) {
    assert.ok(AGENT_OUTCOMES.includes(o),
      `'${o}' is missing from AGENT_OUTCOMES. Every doc enumeration and every refusal message ` +
      "renders from that constant, so this drops the value from every surface at once — which is " +
      "exactly how `declined` reached the engine and none of five documented surfaces.");
  }
  assert.ok(!AGENT_OUTCOMES.includes("unknown"),
    "`unknown` is the engine's stamp for 'nobody was asked'. An agent offered it could record " +
    "that nobody was asked while being asked, which is the one thing the disposition rule forbids.");
});
