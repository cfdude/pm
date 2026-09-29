// scripts/test/assert/raw-engine-source-match.test.mjs
// guards-that-read-engine-source-drift-silently, task 5 — NO POSITIVE ASSERTION AGAINST RAW ENGINE SOURCE.
//
// WHAT IT IS FOR. A guard that reads engine source and asserts a shape in it (`assert.match(src,
// /archiveGate\(/)`) is satisfied by a COMMENT that names the shape as readily as by the code: the
// engine's prose talks about its own calls constantly. Measured in 5.6: conductor-13's gate-call guard
// stayed GREEN with the call aliased away, because `// … one level down from archiveGate()'s refusal`
// still matched. So a positive assertion over engine source reads it through `engineCode()`
// (`fixtures/source-code.mjs`), which strips every comment with the shared regex-aware lexer.
//
// WHAT IT FLAGS, in every `scripts/test/**/*.test.mjs`, with comments stripped first:
//   * `assert.match(X, …)`, `assert.ok(<re>.test(X))` and `assert.ok(X.includes(…))`, where X is a
//     name whose NEAREST preceding declaration is initialised DIRECTLY by a read of engine source —
//     `const X = fs.<read>(<engine path>)`, or a reader `const X = (f) => fs.<read>(<engine path>)`
//     called as `X(…)` — or where the read is written inline as the subject;
//   * an "engine path" argument names `conductor.mjs`, a `lib` path segment, `ENGINE`, `LIB` or
//     `libDir`, and is not a `.md`/`.json` path.
//
// WHAT IT DOES NOT FLAG, deliberately: `assert.doesNotMatch` — against raw source it is the STRICTER
// form (a comment naming the forbidden shape fails it loudly). And its STATED LIMITS, each a place the
// scan structurally cannot see rather than a place it forgot:
//   (a) a read whose path is a VARIABLE (`path.join(REPO, rel)`) — the scan cannot know `rel`;
//   (b) a value DERIVED from the raw read (`src.slice(…)`, `.split("\n")`, an extraction regex) and
//       then matched — the taint is followed one assignment deep, not through computation;
//   (c) the lexer's own blind spot: a regex literal in statement position after `)` or `}`.
// No exemption is shipped: no guard in this tree needs to match engine COMMENT text positively. If one
// ever does, it states why beside a raw read this scan can see — and this file grows the exemption
// then, with its inverse, rather than now with nothing to justify it.

import "../fixtures/assert-git-shim.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { codeOnly } from "../fixtures/source-code.mjs";

const TEST_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// Built from parts so this file's own text holds no read call the scan would find in its samples.
const READ = ["read", "FileSync"].join("");
const READ_CALL = new RegExp(`(?<![\\w$])(?:fs\\.)?${READ}\\s*\\(`, "g");
const ENGINE_ARG = /conductor\.mjs|["'`/]lib["'`/]|\bENGINE\b|\bLIB\b|\blibDir\b/;
const NOT_CODE = /\.(md|json)\b/;

/** Index of the `)` closing the `(` at `open`, or -1. Counts parens only: an arg holding a paren in a
 *  string is rare here and errs toward a longer arg, which still names its path. */
function closing(code, open) {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === "(") depth++;
    else if (code[i] === ")" && --depth === 0) return i;
  }
  return -1;
}

const lineOf = (code, at) => code.slice(0, at).split("\n").length;
const esc = (s) => s.replace(/[$]/g, "\\$&");

/** Every positive assertion in `src` made against raw engine source: `{ line, subject, read }`. */
export function rawEngineMatches(name, src) {
  const code = codeOnly(src, name);
  const found = [];
  const reads = [];
  for (const m of code.matchAll(READ_CALL)) {
    const open = m.index + m[0].length - 1;
    const close = closing(code, open);
    if (close < 0) continue;
    const arg = code.slice(open + 1, close);
    if (!ENGINE_ARG.test(arg) || NOT_CODE.test(arg)) continue;
    reads.push({ at: m.index, close, arg: arg.replace(/\s+/g, " ").trim() });
  }
  // Inline: the read IS the assertion's subject.
  const inline = new RegExp(`assert\\.match\\(\\s*(?:fs\\.)?${READ}\\s*\\(`, "g");
  for (const m of code.matchAll(inline)) {
    const r = reads.find((x) => x.at >= m.index && x.at < m.index + m[0].length);
    if (r) found.push({ line: lineOf(code, m.index), subject: "(inline)", read: r.arg });
  }
  // Bound: `const X = <read>` or `const X = (…) => <read>`, with nothing chained after the read.
  for (const r of reads) {
    const lineStart = code.lastIndexOf("\n", r.at) + 1;
    const head = code.slice(lineStart, r.at);
    const b = /(?:const|let|var)\s+([\w$]+)\s*=\s*(\([^()]*\)\s*=>\s*)?$/.exec(head);
    if (!b) continue;
    if (/^\s*[.[]/.test(code.slice(r.close + 1))) continue;          // derived: limit (b)
    const [, x, arrow] = b;
    const declAt = lineStart + b.index;
    const decls = [...code.matchAll(new RegExp(`(?:const|let|var)\\s+${esc(x)}\\s*=`, "g"))].map((d) => d.index);
    const subject = arrow ? `${esc(x)}\\s*\\(` : `${esc(x)}\\b(?!\\s*[.[(])`;
    const uses = new RegExp(
      `assert\\.match\\(\\s*${subject}` +
      `|assert\\.ok\\(\\s*(?:\\/(?:\\\\.|[^/\\n])+\\/[a-z]*|[\\w$.]+)\\.test\\(\\s*${subject}` +
      `|assert\\.ok\\(\\s*${esc(x)}${arrow ? "\\s*\\([^)]*\\)" : ""}\\.includes\\(`, "g");
    for (const u of code.matchAll(uses)) {
      const nearest = Math.max(...decls.filter((d) => d < u.index));
      if (nearest === declAt) found.push({ line: lineOf(code, u.index), subject: x, read: r.arg });
    }
  }
  return found.sort((a, b) => a.line - b.line);
}

function testFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === "node_modules") return [];
    const p = path.join(dir, e.name);
    return e.isDirectory() ? testFiles(p) : e.name.endsWith(".test.mjs") ? [p] : [];
  });
}

test("no test asserts a shape in RAW engine source — it reads engineCode(), so a comment cannot satisfy it", () => {
  const files = testFiles(TEST_ROOT).sort();
  assert.ok(files.length > 150, `the walk found ${files.length} test files; a walk over nearly nothing is not a check`);
  const found = files.flatMap((f) => rawEngineMatches(f, fs.readFileSync(f, "utf8"))
    .map((h) => `${path.relative(TEST_ROOT, f)}:${h.line}: ${h.subject} ← ${h.read}`));
  assert.deepEqual(found, [],
    "these assert a shape in engine source read RAW, so a comment naming the shape satisfies them " +
    "(conductor-13's gate-call guard stayed green with the call deleted). Read the module with " +
    "engineCode(\"scripts/lib/<name>.mjs\") from fixtures/source-code.mjs instead:\n" + found.join("\n"));
});

test("the scan DISCRIMINATES — raw reads are flagged, engineCode and doesNotMatch are not", () => {
  const rd = `fs.${READ}`;
  const lib = `new URL("../../lib/update-epic.mjs", import.meta.url)`;
  // conductor-13's ORIGINAL shape — the guard 5.6 proved a comment could satisfy.
  const original = `const src = ${rd}(${lib}, "utf8");\nassert.match(src, /archiveGate\\(/, "the verb calls the gate");\n`;
  assert.equal(rawEngineMatches("o", original).length, 1, "conductor-13's original shape is flagged");
  assert.equal(rawEngineMatches("i", `assert.match(${rd}(path.join(REPO, "scripts", "conductor.mjs"), "utf8"), /x/);\n`).length, 1,
    "an inline read as the subject is flagged");
  assert.equal(rawEngineMatches("t", `const s = ${rd}(ENGINE, "utf8");\nassert.ok(/x/.test(s));\nassert.ok(s.includes("y"));\n`).length, 2,
    "assert.ok over .test() and .includes() are flagged too");
  assert.equal(rawEngineMatches("f", `const lib = (f) => ${rd}(new URL(\`../../lib/\${f}\`, import.meta.url), "utf8");\nassert.match(lib("a.mjs"), /x/);\n`).length, 1,
    "a reader function called as the subject is flagged");
  // Not flagged.
  assert.deepEqual(rawEngineMatches("e", `const src = engineCode("scripts/lib/update-epic.mjs");\nassert.match(src, /archiveGate\\(/);\n`), [],
    "engineCode() is the sanctioned read");
  assert.deepEqual(rawEngineMatches("d", `const src = ${rd}(${lib}, "utf8");\nassert.doesNotMatch(src, /forbidden/);\n`), [],
    "doesNotMatch against raw source is the stricter form, not a hole");
  assert.deepEqual(rawEngineMatches("m", `const s = ${rd}(path.join(REPO, "README.md"), "utf8");\nassert.match(s, /x/);\n`), [],
    "a markdown read is not engine source");
  assert.deepEqual(rawEngineMatches("c", `// const src = ${rd}(${lib});\n// assert.match(src, /x/);\n`), [],
    "a comment is not a read");
  assert.deepEqual(rawEngineMatches("r", `const src = ${rd}(${lib}, "utf8");\nassert.doesNotMatch(src, /a/);\nconst src2 = 1;\n{ const src = "fixture";\n  assert.match(src, /x/); }\n`), [],
    "a later re-declaration of the name is judged by ITS initialiser, not the raw read above it");
});
