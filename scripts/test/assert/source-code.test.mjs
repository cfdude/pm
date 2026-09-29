// scripts/test/assert/source-code.test.mjs
// guards-that-read-engine-source-drift-silently, task 1 — THE ONE COMMENT STRIPPER OF THE TEST TREE.
//
// A source-reading guard that a COMMENT can satisfy checks the wrong half of what it claims
// (`docs/lessons/a-guard-can-check-the-wrong-half.md`). Seven guards carried their own stripper, and
// the two measured against real source were each unsound in the direction a guard cannot afford: a
// character-level one with no regex state desyncs on a regex literal holding a quote and passes every
// later comment through VERBATIM; a line-oriented one keeps a TRAILING comment. `codeOnly()` is built
// on `js-lexer.mjs`, which tracks regex literals and REFUSES to answer when it knows it misread.
//
// Sample sources are BUILT FROM PARTS where they hold a token another guard walks this file for.

import "../fixtures/assert-git-shim.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { codeOnly, engineCode } from "../fixtures/source-code.mjs";

test("a comment naming a token is gone — line, block, and trailing", () => {
  const src = "// archiveGate(\nconst a = 1; // archiveGate(\n/* archiveGate( */ const b = 2;\n";
  assert.doesNotMatch(codeOnly(src), /archiveGate/);
  assert.match(codeOnly(src), /const a = 1;/);
  assert.match(codeOnly(src), /const b = 2;/);
});

test("the desync case: a regex literal holding a quote does not open a string", () => {
  // The shape that broke the character-level stripper on lib/update-epic.mjs: after the regex, every
  // comment was read as string text and kept.
  const src = 'const q = /"/;\n// archiveGate(\nconst r = x.replace(/[\'"]/g, "");\n/* archiveGate( */\n';
  assert.doesNotMatch(codeOnly(src), /archiveGate/);
});

test("strings, templates and regexes are kept as written — only comments go", () => {
  const src = 'const u = "http://x/y"; const t = `a // b`; const re = /\\/\\/ c/;\n';
  assert.equal(codeOnly(src), src);
});

test("line and column positions survive: every comment character becomes a space, newlines stay", () => {
  const src = "a();\n/* one\n   two */ b();\nc(); // tail\n";
  const out = codeOnly(src);
  assert.equal(out.length, src.length);
  assert.equal(out.split("\n").length, src.split("\n").length);
  assert.equal(out.indexOf("b();"), src.indexOf("b();"));
  assert.equal(out.indexOf("c();"), src.indexOf("c();"));
});

test("a misparse THROWS, naming the source — it never answers from a misread", () => {
  assert.throws(() => codeOnly("const s = 'open\nnext;\n", "sample.mjs"), /sample\.mjs:1: .*fail closed/);
  assert.throws(() => codeOnly("/* never closed\n", "b.mjs"), /b\.mjs:1: an unterminated/);
});

test("engineCode reads engine source, and refuses a path outside the engine", () => {
  const code = engineCode("scripts/lib/update-epic.mjs");
  assert.match(code, /export function /, "it is the module's code");
  assert.doesNotMatch(code, /^\s*\/\//m, "and no line opens a comment");
  for (const bad of ["scripts/test/js-lexer.mjs", "README.md", "scripts/lib/../../README.md", "scripts/conductor.mjs.bak"]) {
    assert.throws(() => engineCode(bad), /not engine source/, bad);
  }
  assert.match(engineCode("scripts/conductor.mjs"), /process\.exitCode/);
});
