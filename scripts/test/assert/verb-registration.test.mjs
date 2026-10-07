// scripts/test/assert/verb-registration.test.mjs
// gh#206 — ONE test that names EVERY table row a newly dispatched verb is missing, in a single run.
//
// Adding an engine verb means hand-writing rows in tables nothing derives from one another. Each is
// guarded on its own, so each omission cost a full suite run to find and each run named only the first.
// This reads the dispatch table out of conductor.mjs (the population, never a list typed here) and
// checks every other table against it, then fails ONCE with one line per missing row.
//
// THE TABLES (the checklist a verb author works from; CONTRIBUTING.md "Adding an engine verb" says the same):
//   1. scripts/conductor.mjs                      USAGE string, dispatch table (its header comment is NOT checked: it
//                                                 already lists only some verbs, so it is documentation, not a table)
//   2. scripts/lib/constants.mjs                  VERB_POSITIONALS row; a flag surface (a VERB_FLAGS / EPIC_FLAGS
//                                                 row naming it, or FLAGLESS_VERBS)
//   3. scripts/lib/verb-effects.mjs               the effect / writes row
//   4. scripts/test/functional/verb-surface.test.mjs   DISPATCH_BASELINE: one working invocation of the verb
//   5. scripts/test/functional/conductor-31.test.mjs   VERB_BASELINE: one working invocation per verb that
//                                                 declares flags (the valueless-flag sweep needs it)
//
// THE SEED STEP. A DISPATCH_BASELINE entry runs in an empty `init`ed repo. A verb that needs state no
// other verb can write (retract-detour needs an automatic detours.log row, and no verb writes one in a
// repository without git) gives its entry a `seed: (cwd) => …` hook — setup that is not a verb call —
// alongside `pre: [[verb args]…]` (verb calls to run first), `local` and `input`. The guard below FAILS
// when a baseline entry has no `args`, so "the verb needs seeding" cannot be answered by omitting it.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ENGINE } from "../fixtures/assert-harness.mjs";
import { EPIC_FLAGS, FLAGLESS_VERBS, VERB_FLAGS, VERB_POSITIONALS } from "../../lib/constants.mjs";
import { VERB_EFFECTS } from "../../lib/verb-effects.mjs";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const read = (p) => fs.readFileSync(p, "utf8");

/** Every dispatched verb, from the engine's own dispatch table. */
export function dispatchedVerbs(src) {
  const m = src.match(/\(\{\n([\s\S]*?)\n\s*\}\[cmd\]/m);
  assert.ok(m, "could not locate the dispatch table object in conductor.mjs");
  const keys = new Set();
  for (const x of m[1].matchAll(/^\s*"([a-z-]+)"\s*:/gm)) keys.add(x[1]);
  for (const x of m[1].matchAll(/^\s*([a-zA-Z][\w-]*)\s*:/gm)) keys.add(x[1]);
  for (const x of m[1].matchAll(/^\s*([a-zA-Z][\w-]*),?\s*$/gm)) keys.add(x[1]);
  return [...keys].sort();
}

/** The keys of a top-level `const NAME = { … };` object literal in a test file, read as text. */
export function tableKeys(src, name) {
  const start = src.indexOf(`const ${name} = {`);
  assert.notEqual(start, -1, `${name} not found`);
  const end = src.indexOf("\n};", start);
  assert.notEqual(end, -1, `${name} has no closing brace`);
  const body = src.slice(start, end);
  const keys = new Set();
  for (const m of body.matchAll(/^ {2}(?:"([a-z-]+)"|([a-zA-Z][\w-]*))\s*:/gm)) keys.add(m[1] || m[2]);
  return keys;
}

/** The missing rows, as `table: verb` lines. Pure over its arguments, so the test below can prove it
 *  reports every omission at once without breaking the real tables. */
export function missingRows({ verbs, usage, positionals, effects, flagged, verbFlagged, flagless, dispatchBaseline, flagBaseline }) {
  const out = [];
  for (const v of verbs) {
    if (!usage.has(v)) out.push(`conductor.mjs USAGE string: \`${v}\` is not listed`);
    if (!(v in positionals)) out.push(`constants.mjs VERB_POSITIONALS: no row for \`${v}\``);
    if (!(v in effects)) out.push(`verb-effects.mjs VERB_EFFECTS: no row for \`${v}\``);
    if (!flagged.has(v) && !flagless.includes(v)) {
      out.push(`constants.mjs flag surface: \`${v}\` is in no VERB_FLAGS/EPIC_FLAGS row and not in FLAGLESS_VERBS`);
    }
    if (!dispatchBaseline.has(v)) out.push(`functional/verb-surface.test.mjs DISPATCH_BASELINE: no entry for \`${v}\` (needs state no verb writes? give it a \`seed\` hook)`);
    if (verbFlagged.has(v) && !flagBaseline.has(v)) out.push(`functional/conductor-31.test.mjs VERB_BASELINE: no entry for \`${v}\`, which declares flags`);
  }
  return out;
}

function realInputs() {
  const src = read(ENGINE);
  const verbs = dispatchedVerbs(src);
  const usageMatch = src.match(/const USAGE = "usage: conductor\.mjs ([^"\\]+)/);
  assert.ok(usageMatch, "could not locate the USAGE string in conductor.mjs");
  const dispatchSrc = read(path.join(HERE, "..", "functional", "verb-surface.test.mjs"));
  const c31Src = read(path.join(HERE, "..", "functional", "conductor-31.test.mjs"));
  const flaggedRows = [...EPIC_FLAGS, ...VERB_FLAGS].filter(r => !r.argvLevel);
  return {
    verbs,
    usage: new Set(usageMatch[1].split("|")),
    positionals: VERB_POSITIONALS,
    effects: VERB_EFFECTS,
    flagged: new Set(flaggedRows.flatMap(r => r.commands)),
    // conductor-31's baseline table is asserted against VERB_FLAGS alone (EPIC_FLAGS verbs are swept elsewhere).
    verbFlagged: new Set(VERB_FLAGS.filter(r => !r.argvLevel).flatMap(r => r.commands)),
    flagless: FLAGLESS_VERBS,
    dispatchBaseline: tableKeys(dispatchSrc, "DISPATCH_BASELINE"),
    dispatchSrc,
    flagBaseline: tableKeys(c31Src, "VERB_BASELINE"),
  };
}

test("every dispatched verb has a row in every per-verb table — and every omission is named in ONE failure", () => {
  const i = realInputs();
  const missing = missingRows(i);
  assert.deepEqual(missing, [], `a verb is missing table rows (gh#206):\n  ${missing.join("\n  ")}`);
  assert.ok(i.verbs.length >= 40, `only ${i.verbs.length} verbs read from the dispatch table`);
});

test("the guard itself: a verb absent from every table is reported once per table, all in one run", () => {
  const i = realInputs();
  const missing = missingRows({
    ...i, verbs: ["brand-new-verb"], usage: new Set(),
    positionals: {}, effects: {}, flagged: new Set(), verbFlagged: new Set(["brand-new-verb"]), flagless: [],
    dispatchBaseline: new Set(), flagBaseline: new Set(),
  });
  assert.equal(missing.length, 6, missing.join("\n"));
  for (const table of ["USAGE string", "VERB_POSITIONALS", "VERB_EFFECTS", "flag surface", "DISPATCH_BASELINE", "VERB_BASELINE"]) {
    assert.ok(missing.some(m => m.includes(table)), `names the ${table} row: ${missing.join("\n")}`);
  }
  assert.ok(missing.every(m => m.includes("brand-new-verb")), "every line names the verb");
});

test("the seed step is real: every DISPATCH_BASELINE entry that declares `seed` also declares `args`, and the hook is a function", () => {
  const { dispatchSrc } = realInputs();
  const body = dispatchSrc.slice(dispatchSrc.indexOf("const DISPATCH_BASELINE = {"));
  const end = body.indexOf("\n};");
  const entries = body.slice(0, end).split(/\n(?= {2}(?:"[a-z-]+"|[a-z-]+): \{)/).filter(l => /^ {2}(?:"[a-z-]+"|[a-z-]+): \{/.test(l));
  assert.ok(entries.length >= 40, `parsed only ${entries.length} baseline entries`);
  for (const line of entries) {
    assert.match(line, /args: /, `a baseline entry without \`args\` cannot run: ${line.trim().slice(0, 80)}`);
    if (/seed:/.test(line)) assert.match(line, /seed: [A-Z_]+|seed: \(/, `seed must be a function or a named hook: ${line.trim()}`);
  }
});
