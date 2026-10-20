// scripts/test/unit/engine-extraction.test.mjs
// engine-source-extraction-vacuity — the helper's refusals, as VALUES (strings in, a throw or a slice out).

import assert from "node:assert/strict";
import { unitTest } from "../fixtures/unit-harness.mjs";
import {
  isEmptyExtraction, nonEmpty, sliceBetween, captureOf, allMatches, dispatchedVerbsOf,
} from "../fixtures/engine-extraction.mjs";

unitTest("isEmptyExtraction: nothing found is empty, any real value is not", () => {
  for (const v of [null, undefined, "", "  \n", [], new Set(), new Map(), {}]) assert.equal(isEmptyExtraction(v), true, String(v));
  for (const v of ["x", [0], new Set([1]), new Map([[1, 2]]), { a: 1 }, 0, false]) assert.equal(isEmptyExtraction(v), false, String(v));
});

unitTest("nonEmpty returns a real value untouched and refuses an empty one naming what it was extracting", () => {
  const set = new Set(["a"]);
  assert.equal(nonEmpty(set, "verbs"), set);
  assert.throws(() => nonEmpty(new Set(), "the verbs"), /extracted NOTHING for the verbs/);
  assert.throws(() => nonEmpty("", "a body"), /extracted NOTHING for a body/);
});

unitTest("sliceBetween slices by anchors and refuses a missing anchor or an empty slice", () => {
  const src = "head\nSTART body one\nEND tail";
  assert.equal(sliceBetween(src, "START", "END", "body"), "START body one\n");
  assert.equal(sliceBetween(src, "START", "END", "body", { inclusive: true }), "START body one\nEND");
  assert.equal(sliceBetween(src, "START", null, "to the end"), "START body one\nEND tail");
  assert.throws(() => sliceBetween(src, "GONE", "END", "body"), /start anchor "GONE" is gone/);
  assert.throws(() => sliceBetween(src, "START", "GONE", "body"), /end anchor "GONE" is gone/);
  assert.throws(() => sliceBetween("x   y", " ", "y", "blank"), /extracted NOTHING for blank/);
  // the end anchor is looked for AFTER the start: an earlier occurrence must not make a backwards slice
  assert.throws(() => sliceBetween("END x START y", "START", "END", "ordered"), /end anchor "END" is gone from the source after the start/);
});

unitTest("captureOf returns the first group, the whole match without one, and refuses no match or an empty capture", () => {
  assert.equal(captureOf("max: 256 MiB", /max: (\d+)/, "max"), "256");
  assert.equal(captureOf("max: 256", /max: \d+/, "max"), "max: 256");
  assert.throws(() => captureOf("nothing", /max: (\d+)/, "max"), /matches nothing/);
  assert.throws(() => captureOf("max: ", /max: (\s*)/, "max"), /extracted NOTHING for max/);
});

unitTest("allMatches refuses zero matches", () => {
  assert.equal(allMatches("a1 b2", /[a-z]\d/g, "pairs").length, 2);
  assert.throws(() => allMatches("none", /\d+/g, "numbers"), /extracted NOTHING for numbers/);
});

unitTest("dispatchedVerbsOf reads quoted, bare and shorthand entries at either indent", () => {
  for (const wrap of [(s) => s, (s) => s.replace(/^/gm, "  ")]) {
    const src = wrap("// ---------- dispatch ----------\ntry {\n(({\n  \"update-epic\": () => 0,\n  status: () => 0,\n  init,\n}[cmd]));\n}\n");
    assert.deepEqual([...dispatchedVerbsOf(src)].sort(), ["init", "status", "update-epic"]);
  }
});

unitTest("dispatchedVerbsOf refuses a table it cannot read: no marker, no index, and an EMPTY set", () => {
  assert.throws(() => dispatchedVerbsOf("export const x = 1;\n"), /dispatch marker comment/);
  assert.throws(() => dispatchedVerbsOf("// ---------- dispatch ----------\ntry {\n(({ a: 1 }));\n"), /\}\[cmd\]/);
  // the 0.47.0 case: the table exists but its rows sit at an indent the reader does not accept
  const deep = "// ---------- dispatch ----------\ntry {\n(({\n        status: () => 0,\n}[cmd]));\n";
  assert.throws(() => dispatchedVerbsOf(deep), /extracted NOTHING for the verbs of the dispatch table/);
});
