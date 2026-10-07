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
// WHAT IT FLAGS, in every `scripts/test/**/*.test.mjs`, with comments stripped first — a POSITIVE
// assertion whose subject is raw engine source:
//   * `assert.match(X, …)`; `assert.ok(<re>.test(X))` and bare `assert(<re>.test(X))`;
//     `assert.ok(X.includes(…))` / `assert.ok(X.match(…))` (bare `assert(…)` too);
//     `assert.notEqual(X.indexOf(…), -1)`; `assert.equal(<re>.test(X), true)`;
//   * where X is a name whose NEAREST preceding declaration is initialised DIRECTLY by a read of engine
//     source — `const X = fs.<read>(<engine path>)`, the read allowed to wrap onto the next line — or a
//     reader `const X = (f) => fs.<read>(<engine path>)` called as `X(…)`, or a name a
//     `for (const [n, X] of …)` / `for (const X of …)` binds from an iterable that names such a value
//     (final review I3: conductor-18's gh-112 aliased two raw reads through exactly that loop); or where
//     the read is written inline as `assert.match`'s subject;
//   * an "engine path" argument names `conductor.mjs`, a `lib` path segment, `ENGINE`, `LIB` or
//     `libDir`, and is not a `.md`/`.json` path.
//
// WHAT IT DOES NOT FLAG, deliberately: the NEGATIVE forms — `assert.doesNotMatch`, `assert.ok(!…)`,
// `assert.equal(…, false)`, `assert.equal(x.indexOf(…), -1)` — are the STRICTER check against raw
// source (a comment naming the forbidden shape fails them loudly).
//
// ITS STATED LIMITS — places the scan structurally cannot see, named rather than chased:
//   (a) a read whose path is a VARIABLE (`path.join(REPO, rel)`) or goes through a helper
//       (`read(lib("x"))`) — the scan cannot know what the argument names;
//   (b) a value DERIVED from the raw read (`src.slice(…)`, `.split("\n")`, an extraction regex) and then
//       matched — the taint is followed one assignment (or one loop binding) deep, not through
//       computation; the vacuity of such extractions is its own follow-up epic;
//   (c) an async read (`fs.promises.readFile`, `await readFile(…)`);
//   (d) a `let` declared first and assigned the read later;
//   (e) a destructured alias of the read call itself (`const { readFileSync: r } = fs`);
//   (f) the lexer's own blind spot: a regex literal in statement position after `)` or `}` — which
//       a separate sweep over the engine's own files asserts does not occur there;
//   (g) further alias shapes (final re-review minor 1), named rather than chased: a callback alias
//       (`.forEach(([n, src]) => …)`, `.map(…)`), a plain rebinding (`const src = a`), a two-hop loop
//       (`const pairs = [["x", a]]; for (const [n, src] of pairs)`), and a `.toString()` / `String(…)`
//       wrap of the read;
//   (h) further positive subject shapes, likewise named: `assert.equal/strictEqual(x.includes(…), true)`,
//       `assert.ok(x.indexOf(…) !== -1)` and `assert.ok(x.search(…) >= 0)`.
// These are covered by review, not by this scan; the plan's section 7 lists every helper that returns
// engine source and where each positive call site reads it.
//
// ONE DELIBERATE EXCEPTION, and no exemption mechanism: `assert/save-report-surface.test.mjs`'s
// non-vacuity test counts `saveState(` mentions in constants.mjs's PROSE, raw, on purpose — it is the
// witness that the comment stripper really strips (every mention there is a comment). It reads through a
// variable path, so this scan does not see it (limit (a)). Any other guard that must match engine
// comment text positively states why beside its read in the same way, and this file names it here.

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
  // Every declaration of every name, so a use is judged by the NEAREST one before it: `const|let|var X =`
  // and each name a `for (… of …)` binds (plain or destructured).
  const decls = new Map();
  const declare = (x, at) => { if (!decls.has(x)) decls.set(x, []); decls.get(x).push(at); };
  for (const d of code.matchAll(/(?:const|let|var)\s+([\w$]+)\s*=/g)) declare(d[1], d.index);
  const loops = [];
  for (const f of code.matchAll(/\bfor\s*\(\s*(?:const|let|var)\s+(\[[^\]]*\]|\{[^}]*\}|[\w$]+)\s+of\s+/g)) {
    const open = code.indexOf("(", f.index);
    const close = closing(code, open);
    const names = f[1].match(/[\w$]+/g) || [];
    for (const x of names) declare(x, f.index);
    loops.push({ at: f.index, names, iterable: code.slice(f.index + f[0].length, close < 0 ? undefined : close) });
  }
  const nearest = (x, at) => Math.max(-1, ...(decls.get(x) || []).filter((d) => d < at));
  // Tainted bindings: `const X = <read>` or `const X = (…) => <read>`, the head allowed to wrap lines,
  // with nothing chained after the read.
  const tainted = [];
  for (const r of reads) {
    const boundary = Math.max(code.lastIndexOf(";", r.at - 1), code.lastIndexOf("{", r.at - 1), code.lastIndexOf("}", r.at - 1)) + 1;
    const head = code.slice(boundary, r.at);
    const b = /(?:const|let|var)\s+([\w$]+)\s*=\s*(\([^()]*\)\s*=>\s*)?(?:fs\.)?$/.exec(head.replace(/(?:fs\.)$/, ""));
    if (!b) continue;
    if (/^\s*[.[]/.test(code.slice(r.close + 1))) continue;          // derived: a stated limit
    tainted.push({ x: b[1], declAt: boundary + b.index, arrow: Boolean(b[2]), read: r.arg });
  }
  // Loop aliases: a `for (… of <iterable>)` whose iterable names a tainted value taints every name it binds.
  for (const t of [...tainted]) {
    if (t.arrow) continue;
    for (const l of loops) {
      if (l.at > t.declAt && nearest(t.x, l.at) === t.declAt && new RegExp(`(?<![\\w$.])${esc(t.x)}\\b`).test(l.iterable)) {
        for (const x of l.names) {
          if (!tainted.some((o) => o.x === x && o.declAt === l.at)) tainted.push({ x, declAt: l.at, arrow: false, read: t.read });
        }
      }
    }
  }
  const RETEST = `(?:\\/(?:\\\\.|[^/\\n])+\\/[a-z]*|[\\w$.]+)\\.test`;
  const A = `(?<![\\w$.])assert`;
  for (const t of tainted) {
    const X = esc(t.x);
    const V = t.arrow ? `${X}\\s*\\([^()]*\\)` : `${X}\\b(?!\\s*[.[(])`;   // the value itself
    const M = t.arrow ? `${X}\\s*\\([^()]*\\)` : `${X}`;                     // a receiver of a method
    const uses = new RegExp([
      `${A}\\.match\\(\\s*${V}`,
      `${A}(?:\\.ok)?\\(\\s*${RETEST}\\(\\s*${V}\\s*\\)`,
      `${A}(?:\\.ok)?\\(\\s*${M}\\.(?:includes|match)\\(`,
      `${A}\\.(?:notEqual|notStrictEqual)\\(\\s*${M}\\.indexOf\\(`,
      `${A}\\.(?:equal|strictEqual)\\(\\s*${RETEST}\\(\\s*${V}\\s*\\)\\s*,\\s*true\\b`,
    ].join("|"), "g");
    for (const u of code.matchAll(uses)) {
      if (nearest(t.x, u.index) === t.declAt) found.push({ line: lineOf(code, u.index), subject: t.x, read: t.read });
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
  // Final review I3 — the shapes the first version could not follow, each seen RED before its GREEN.
  const tri = `path.join(REPO, "scripts", "lib", "triage.mjs")`;
  assert.equal(rawEngineMatches("loop", `const a = ${rd}(${tri}, "utf8");\nconst b = ${rd}(${lib}, "utf8");\n` +
    `for (const [name, src] of [["a", a], ["b", b]]) {\n  assert.match(src, /supersededEpics/, name);\n}\n`).length, 1,
    "an array/loop alias of a raw read (conductor-18's gh-112 shape) is flagged");
  assert.equal(rawEngineMatches("each", `const a = ${rd}(${tri}, "utf8");\nfor (const src of [a]) assert.match(src, /x/);\n`).length, 1,
    "a plain for-of alias is flagged");
  assert.equal(rawEngineMatches("wrap", `const src =\n  ${rd}(\n    ${lib}, "utf8");\nassert.match(src, /x/);\n`).length, 1,
    "a binding whose read wraps onto the next line is flagged");
  assert.equal(rawEngineMatches("idx", `const s = ${rd}(ENGINE, "utf8");\nassert.notEqual(s.indexOf("x("), -1);\n`).length, 1,
    "assert.notEqual(x.indexOf(…), -1) is flagged");
  assert.equal(rawEngineMatches("om", `const s = ${rd}(ENGINE, "utf8");\nassert.ok(s.match(/x/));\n`).length, 1,
    "assert.ok(x.match(…)) is flagged");
  assert.equal(rawEngineMatches("bare", `const s = ${rd}(ENGINE, "utf8");\nassert(s.includes("x"));\n`).length, 1,
    "a bare assert(x.includes(…)) is flagged");
  assert.equal(rawEngineMatches("eqt", `const s = ${rd}(ENGINE, "utf8");\nassert.equal(/x/.test(s), true);\n`).length, 1,
    "assert.equal(/…/.test(x), true) is flagged");
  assert.deepEqual(rawEngineMatches("neg", `const s = ${rd}(ENGINE, "utf8");\nassert.ok(!s.includes("x"));\nassert.equal(/x/.test(s), false);\nassert.equal(s.indexOf("x"), -1);\n`), [],
    "the NEGATIVE forms are the stricter check against raw source and are not flagged");
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
