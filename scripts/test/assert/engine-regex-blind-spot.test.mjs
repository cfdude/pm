// scripts/test/assert/engine-regex-blind-spot.test.mjs
// guards-that-read-engine-source-drift-silently, final review m1 — THE LEXER'S BLIND SPOT, HELD CLOSED
// FOR THE ENGINE.
//
// `js-lexer.mjs` reads a `/` after `)` or `}` as DIVISION ("ITS LIMIT"). A regex literal in statement
// position there — `if (ok) /re/.test(s)`, or a statement opening with a regex after a block's `}` — is
// misread, and when the misread closes on its own line the lexer records nothing. Every source guard
// now reads engine code through `engineCode()`, so such a line could blank or keep the wrong text with
// no misparse to stop it. This sweep asserts the shape does not occur in `scripts/conductor.mjs` or
// `scripts/lib/*.mjs`, so the blind spot stays a documented limit rather than a live one.
//
// THE SHAPE, over the lexer's own tokens: a `/` read as division whose previous token is `}`, or `)`
// closing a parenthesis opened directly after `if`, `while`, `for` or `with` — the two places a `/` can
// only be the start of a regex. A real division after `)` (`(a + b) / 2`) is not flagged.

import "../fixtures/assert-git-shim.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lex } from "../js-lexer.mjs";

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const HEADS = new Set(["if", "while", "for", "with"]);

/** Every `/` the lexer read as division where only a regex can stand: `{ line }` each. */
export function blindSpots(src) {
  const out = [];
  for (const ctx of lex(src).contexts) {
    const t = ctx.tokens;
    const opens = [];                 // for each open `(`: did a statement keyword precede it?
    const closedHead = new Map();     // token index of a `)` → whether its `(` followed a keyword
    t.forEach((tok, i) => {
      if (tok.kind !== "punct") return;
      if (tok.text === "(") opens.push(i > 0 && t[i - 1].kind === "ident" && HEADS.has(t[i - 1].text));
      else if (tok.text === ")") closedHead.set(i, opens.pop() === true);
      else if ((tok.text === "/" || tok.text === "/=") && i > 0) {
        const p = t[i - 1];
        if (p.kind === "punct" && (p.text === "}" || (p.text === ")" && closedHead.get(i - 1)))) {
          out.push({ line: src.slice(0, tok.start).split("\n").length });
        }
      }
    });
  }
  return out;
}

test("no engine file holds a regex literal where the shared lexer reads division", () => {
  const files = ["conductor.mjs", ...fs.readdirSync(path.join(SCRIPTS, "lib")).filter((f) => f.endsWith(".mjs")).map((f) => `lib/${f}`)];
  assert.ok(files.length > 30, `the sweep found ${files.length} engine files; a sweep over nearly nothing is not a check`);
  const found = files.flatMap((f) => blindSpots(fs.readFileSync(path.join(SCRIPTS, f), "utf8")).map((h) => `scripts/${f}:${h.line}`));
  assert.deepEqual(found, [],
    "these lines put a regex literal after `)` of an if/while/for/with or after `}`, where js-lexer.mjs " +
    "reads division — every engineCode() guard would then read that file wrongly with no misparse " +
    "recorded. Bind the regex to a name first (`const RE = /…/;`) or wrap it in parentheses.");
});

test("the sweep DISCRIMINATES — the two blind-spot shapes are found, division is not", () => {
  assert.equal(blindSpots("if (ok) /a/.test(s);\n").length, 1, "a regex after if (…)");
  assert.equal(blindSpots("while (x) /b/g.exec(s);\n").length, 1, "a regex after while (…)");
  assert.equal(blindSpots("{ run(); }\n/c/.test(s);\n").length, 1, "a regex opening a statement after a block");
  assert.deepEqual(blindSpots("const h = (a + b) / 2;\nconst q = f(x) / y;\n"), [], "division after a call or group");
  assert.deepEqual(blindSpots("if (ok) { x = 1; }\nconst r = /d/.test(s);\n"), [], "a regex after `=` is read correctly");
});
