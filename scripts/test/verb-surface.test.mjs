// every-verb-refuses-what-it-does-not-read — what every dispatched verb accepts on its command
// line, and the guarantee that a refused command line leaves every file exactly as it was.
//
// The population of every sweep below is the DISPATCH TABLE read out of conductor.mjs, never a
// list typed here: a verb added later is covered by these tests the moment it is dispatched, which
// is the whole reason the check this file guards is bound to that table rather than placed per verb.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CONSTANTS = new URL("../lib/constants.mjs", import.meta.url).href;
const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The verb names the engine actually dispatches, read from conductor.mjs's dispatch object.
 *  DUPLICATED from conductor-31.test.mjs, as that file's own comment prescribes — nine lines, and
 *  hoisting it would edit a file every test module imports. */
function dispatchedVerbs() {
  const src = fs.readFileSync(path.join(REPO, "scripts", "conductor.mjs"), "utf8");
  const start = src.indexOf("// ---------- dispatch ----------");
  assert.notEqual(start, -1, "conductor.mjs must still carry its dispatch marker comment");
  const body = src.slice(src.indexOf("({", src.indexOf("try {", start)));
  const end = body.indexOf("}[cmd]");
  assert.notEqual(end, -1, "the dispatch object must still be indexed as `}[cmd]`");
  const table = body.slice(0, end);
  const verbs = new Set();
  for (const m of table.matchAll(/^ {2}(?:"([a-z-]+)"|([a-z-]+))\s*:/gm)) verbs.add(m[1] || m[2]);
  for (const m of table.matchAll(/^ {2}([a-z-]+),\s*$/gm)) verbs.add(m[1]);
  return verbs;
}

// ═══════════════ 1.1 — positional arity is declared for every dispatched verb ═══════════════

const validArity = (row, label) => {
  assert.ok(Number.isInteger(row.min) && row.min >= 0, `${label}: min must be a non-negative integer`);
  assert.ok(row.max === Infinity || (Number.isInteger(row.max) && row.max >= row.min),
    `${label}: max must be an integer >= min, or Infinity`);
  assert.equal(typeof row.form, "string", `${label}: form must be a string`);
  assert.ok(row.form.trim().length > 0, `${label}: form must be non-empty — help prints it`);
};

test("VERB_POSITIONALS is set-equal to the dispatch table", async () => {
  const { VERB_POSITIONALS } = await import(CONSTANTS);
  assert.ok(VERB_POSITIONALS && typeof VERB_POSITIONALS === "object",
    "constants.mjs must export VERB_POSITIONALS");
  const dispatched = dispatchedVerbs();
  assert.ok(dispatched.size >= 30, `the dispatch-table reader yielded only ${dispatched.size} verbs`);
  const declared = new Set(Object.keys(VERB_POSITIONALS));
  assert.deepEqual([...dispatched].filter(v => !declared.has(v)).sort(), [],
    "a dispatched verb declares no positional arity — the check cannot bound what it has not been told");
  assert.deepEqual([...declared].filter(v => !dispatched.has(v)).sort(), [],
    "VERB_POSITIONALS declares a verb the engine does not dispatch");
});

test("every VERB_POSITIONALS row has a valid arity, a form, and boolean markers", async () => {
  const { VERB_POSITIONALS } = await import(CONSTANTS);
  for (const [verb, row] of Object.entries(VERB_POSITIONALS)) {
    validArity(row, verb);
    assert.equal(typeof row.idFirst, "boolean", `${verb}: idFirst must be a boolean`);
    assert.equal(typeof row.freeText, "boolean", `${verb}: freeText must be a boolean`);
  }
});

test("release carries two forms keyed by its first positional", async () => {
  const { VERB_POSITIONALS } = await import(CONSTANTS);
  const rel = VERB_POSITIONALS.release;
  assert.equal(rel.min, 1);
  assert.equal(rel.max, 1, "`release <id>` reads exactly one positional");
  assert.ok(rel.byFirst && rel.byFirst.show, "the `show` read form is declared as its own branch");
  validArity(rel.byFirst.show, "release show");
  assert.equal(rel.byFirst.show.max, 2, "`release show [<id>]` reads the keyword and at most one id");
  assert.match(rel.byFirst.show.form, /^show /);
  const others = Object.entries(VERB_POSITIONALS).filter(([v, r]) => v !== "release" && r.byFirst);
  assert.deepEqual(others, [], "release is the one verb whose surface branches on a positional");
});

test("freeText is carried by exactly triage, suggest-lane, log-detour and honcho-memory", async () => {
  const { VERB_POSITIONALS } = await import(CONSTANTS);
  const free = Object.entries(VERB_POSITIONALS).filter(([, r]) => r.freeText).map(([v]) => v).sort();
  assert.deepEqual(free, ["honcho-memory", "log-detour", "suggest-lane", "triage"]);
});
