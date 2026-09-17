// Gate 2 T-S2 — the per-INTERPOLATION output sweep (task 8.1, re-run).
//
// WHY THIS EXISTS. 0a33fd4's 8.1 sweep filtered the rg hits to lines WITHOUT escapeControls /
// orNoRemedy / printedId, which hid every line that escapes one value and not its neighbour (Gate 2:
// remove-epic's success line, reorder's, releaseLine() beside an escaped id). The unit here is ONE
// interpolated value, never a line: every `${…}` of every template literal and every non-literal operand
// of a `+` chain that holds a string literal, in scripts/conductor.mjs and scripts/lib/*.mjs.
//
// METHOD. A small JS lexer (comments, quotes, nested template literals, regex literals) finds each
// interpolation with its line and enclosing top-level declaration. Each is classified, in order:
//   escaped       the whole value is a call to an escaper or id printer (escapeControls, escapeTableCell,
//                 printedId, commandValue, orNoRemedy, noRemedyMessage, asCode, tableRow,
//                 unstorableSkipLine), a `.map(<escaper>).join(…)`, or it sits inside the argument of
//                 escapeControls / escapeTableCell / tableRow. shellQuote is deliberately NOT an escaper;
//   literal       every value it can print is literal: a string, a number, `.length`/`.size`, an
//                 ALL_CAPS constant (or its `.join`), a Date rendering, a template or `+` chain of
//                 literals (whose own values are swept where they sit), a ternary / `&&` of those;
//   sink          it sits inside `X.push(…)` in a declaration that joins X through `X.map(escapeControls)`;
//   not-output    it sits inside a call that builds no printed text (RegExp, path, fs, child_process,
//                 JSON.parse, import);
//   judged        everything else, matched against the DECLARED table in sweep-interpolations.judged.mjs —
//                 sink-flow (reaches a line sink downstream), passthrough (text composed and swept where it
//                 was built), engine (numbers, registry and vocabulary values, validated values, engine
//                 paths, versions and shas), json (one JSON document), escaped, not-output, justified.
//   UNCLASSIFIED  none of the above — a FINDING. A judgment matching nothing is STALE.
// Run: `node openspec/changes/user-text-never-forges-output/sweep-interpolations.mjs [--all]`.
// Exit 1 while anything is UNCLASSIFIED or STALE. `--all` prints every interpolation with its class;
// sweep-interpolations.txt is that output at the commit that recorded it.
import fs from "node:fs";
import path from "node:path";

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "..");
const FILES = [path.join(REPO, "scripts", "conductor.mjs"),
  ...fs.readdirSync(path.join(REPO, "scripts", "lib")).filter(f => f.endsWith(".mjs")).sort().map(f => path.join(REPO, "scripts", "lib", f))];

// ─────────────── lexer ───────────────
const KEYWORDS_BEFORE_REGEX = new Set(["return", "typeof", "case", "in", "of", "delete", "void", "throw", "new", "else", "do", "instanceof", "yield", "await"]);
function lex(src) {
  const contexts = [];                         // { tokens: [], start, parent } — root and one per ${…}
  const root = { tokens: [], start: 0, kind: "root" };
  contexts.push(root);
  const stack = [{ mode: "code", ctx: root }];
  const interps = [];                          // { start, end, ctx }
  const templates = [];                        // { start, end, hasInterp }
  let i = 0;
  const top = () => stack[stack.length - 1];
  const prevSig = (ctx) => ctx.tokens[ctx.tokens.length - 1];
  while (i < src.length) {
    const t = top();
    const c = src[i];
    if (t.mode === "template") {
      if (c === "\\") { i += 2; continue; }
      if (c === "`") { stack.pop(); const tpl = t.tpl; tpl.end = i + 1; top().ctx.tokens.push({ kind: "template", start: tpl.start, end: i + 1, tpl }); i++; continue; }
      if (c === "$" && src[i + 1] === "{") {
        t.tpl.hasInterp = true;
        const ctx = { tokens: [], start: i + 2, kind: "interp" };
        contexts.push(ctx);
        stack.push({ mode: "interp", ctx, braces: 0 });
        i += 2; continue;
      }
      i++; continue;
    }
    // code or interp
    const ctx = t.ctx;
    if (c === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && src[i + 1] === "*") { const e = src.indexOf("*/", i + 2); i = e < 0 ? src.length : e + 2; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) { if (src[j] === "\\") j++; j++; }
      ctx.tokens.push({ kind: "string", start: i, end: j + 1 }); i = j + 1; continue;
    }
    if (c === "`") { const tpl = { start: i, hasInterp: false }; templates.push(tpl); stack.push({ mode: "template", ctx, tpl }); i++; continue; }
    if (c === "{") { if (t.mode === "interp") t.braces++; ctx.tokens.push({ kind: "punct", text: "{", start: i, end: i + 1 }); i++; continue; }
    if (c === "}") {
      if (t.mode === "interp" && t.braces === 0) { interps.push({ start: ctx.start, end: i, ctx }); stack.pop(); i++; continue; }
      if (t.mode === "interp") t.braces--;
      ctx.tokens.push({ kind: "punct", text: "}", start: i, end: i + 1 }); i++; continue;
    }
    if (c === "/") {
      const p = prevSig(ctx);
      const division = p && (p.kind === "number" || p.kind === "string" || p.kind === "template" || p.kind === "regex" ||
        (p.kind === "ident" && !KEYWORDS_BEFORE_REGEX.has(p.text)) || (p.kind === "punct" && (p.text === ")" || p.text === "]" || p.text === "}")));
      if (!division) {
        let j = i + 1, inClass = false;
        while (j < src.length) {
          if (src[j] === "\\") { j += 2; continue; }
          if (src[j] === "[") inClass = true; else if (src[j] === "]") inClass = false;
          else if (src[j] === "/" && !inClass) break;
          j++;
        }
        j++;
        while (/[a-z]/.test(src[j] || "")) j++;
        ctx.tokens.push({ kind: "regex", start: i, end: j }); i = j; continue;
      }
    }
    if (/[A-Za-z_$]/.test(c)) { let j = i; while (/[\w$]/.test(src[j] || "")) j++; ctx.tokens.push({ kind: "ident", text: src.slice(i, j), start: i, end: j }); i = j; continue; }
    if (/[0-9]/.test(c)) { let j = i; while (/[\w.]/.test(src[j] || "")) j++; ctx.tokens.push({ kind: "number", start: i, end: j }); i = j; continue; }
    const three = src.slice(i, i + 3), two = src.slice(i, i + 2);
    const op = ["===", "!==", "...", "**=", "&&=", "||=", "??="].includes(three) ? three
      : ["=>", "==", "!=", "<=", ">=", "&&", "||", "??", "?.", "++", "--", "+=", "-=", "*=", "/="].includes(two) ? two : c;
    ctx.tokens.push({ kind: "punct", text: op, start: i, end: i + op.length }); i += op.length;
  }
  return { contexts, interps, templates };
}

// ─────────────── `+` chains holding a string literal ───────────────
// A template operand is STRUCTURE: its own `${…}` values are swept one by one where they sit.
const isLiteral = (t) => t.kind === "string" || t.kind === "number" || t.kind === "template";
const isStringy = (t) => t.kind === "string" || t.kind === "template";
const BOUNDARY = new Set(["(", ",", "=", ":", "?", "[", "{", ";", "=>", "||", "&&", "??", "!", "return", "+=", "===", "!==", "==", "!=", "}", "...", "<", ">", "<=", ">="]);
/** Parse one operand starting at token k; returns the index after it, or -1. */
function operandEnd(toks, k) {
  let j = k;
  while (j < toks.length && toks[j].kind === "punct" && (toks[j].text === "!" || toks[j].text === "-")) j++;
  if (j >= toks.length) return -1;
  const first = toks[j];
  if (first.kind === "ident" && (first.text === "typeof" || first.text === "new" || first.text === "await")) j++;
  const skipGroup = (open, close) => { let d = 0; for (; j < toks.length; j++) { if (toks[j].text === open) d++; else if (toks[j].text === close) { d--; if (d === 0) { j++; return; } } } };
  const f = toks[j];
  if (!f) return -1;
  if (f.kind === "ident" && ["return", "throw", "yield", "case", "else", "in", "of", "instanceof"].includes(f.text)) return -1;
  if (f.kind === "punct" && f.text === "(") skipGroup("(", ")");
  else if (f.kind === "punct" && f.text === "[") skipGroup("[", "]");
  else if (["ident", "string", "number", "template", "regex"].includes(f.kind)) j++;
  else return -1;
  for (;;) {
    const n = toks[j];
    if (!n) break;
    if (n.kind === "punct" && (n.text === "." || n.text === "?.")) { j++; if (toks[j] && toks[j].kind === "ident") j++; continue; }
    if (n.kind === "punct" && n.text === "(") { skipGroup("(", ")"); continue; }
    if (n.kind === "punct" && n.text === "[") { skipGroup("[", "]"); continue; }
    if (n.kind === "template") { j++; continue; }       // a tagged template
    break;
  }
  return j;
}
function concatOperands(ctx) {
  const toks = ctx.tokens, out = [];
  for (let k = 0; k < toks.length; k++) {
    const prev = toks[k - 1];
    if (prev && !((prev.kind === "punct" && BOUNDARY.has(prev.text)) || (prev.kind === "ident" && ["return", "throw", "yield", "await", "case"].includes(prev.text)))) continue;
    const ops = [];
    let j = k, e = operandEnd(toks, j);
    if (e < 0) continue;
    ops.push([j, e]);
    while (toks[e] && toks[e].kind === "punct" && toks[e].text === "+") {
      const e2 = operandEnd(toks, e + 1);
      if (e2 < 0) break;
      ops.push([e + 1, e2]); e = e2;
    }
    if (ops.length < 2) continue;
    if (!ops.some(([a, b]) => b - a === 1 && isStringy(toks[a]))) continue;
    for (const [a, b] of ops) if (!(b - a === 1 && isLiteral(toks[a]))) out.push({ start: toks[a].start, end: toks[b - 1].end });
  }
  return out;
}

// ─────────────── context ───────────────
function lineOf(src, off) { let n = 1; for (let i = 0; i < off; i++) if (src.charCodeAt(i) === 10) n++; return n; }
function balancedCallSpans(src, re) {
  const spans = [];
  for (const m of src.matchAll(re)) {
    let i = m.index + m[0].length, d = 1;
    for (; i < src.length && d > 0; i++) { if (src[i] === "(") d++; else if (src[i] === ")") d--; }
    spans.push({ start: m.index, end: i, name: m[1] });
  }
  return spans;
}
/** Top-level declarations: `function name`, `export function name`, `const name =` at column 0. */
function topLevelFunctions(src) {
  const starts = [...src.matchAll(/^(?:export\s+)?(?:async\s+)?(?:function\s+([\w$]+)|(?:const|let)\s+([\w$]+)\s*=)/gm)]
    .map(m => ({ start: m.index, name: m[1] || m[2] }));
  return starts.map((s, i) => ({ ...s, end: i + 1 < starts.length ? starts[i + 1].start : src.length }));
}

// shellQuote is NOT here: it quotes for the shell and leaves a control character raw, so each use is judged.
// orNoRemedy / asCode return what their builder built, whose own values are swept inside it.
const ESCAPERS = ["escapeControls", "escapeTableCell", "printedId", "commandValue", "orNoRemedy", "noRemedyMessage", "asCode", "tableRow", "unstorableSkipLine"];
/** Calls whose ARGUMENT text is escaped as a whole, so every value interpolated inside it is too. */
const ESCAPING_SPANS = /\b(escapeControls|escapeTableCell|tableRow)\(/g;
function wholeCallTo(expr, names) {
  const m = /^([\w$]+)\(/.exec(expr);
  if (!m || !names.includes(m[1])) return false;
  let d = 0;
  for (let i = m[1].length; i < expr.length; i++) {
    if (expr[i] === "(") d++; else if (expr[i] === ")") { d--; if (d === 0) return i === expr.length - 1; }
  }
  return false;
}
const SIMPLE_ENGINE = [
  /^\d+$/, /\.length$/, /\.size$/, /^[A-Z][A-Z0-9_]*$/, /^[A-Z][A-Z0-9_]*\.join\((["'][^"']*["'])?\)$/,
  /^new Date\([^)]*\)\.toISOString\(\)$/, /^[\w$.]+ \+ 1$/, /^ordinal\([\w$.]+\)$/,
];
const MAPPED_ESCAPE = /^[\w$.]+(?:\.filter\([^)]*\))?\.map\((?:escapeControls|esc|printedId|\(?[\w$]+\)? => (?:escapeControls|printedId)\(.*\))\)\.join\((?:"[^"]*"|'[^']*')?\)$/;
function literalOnly(expr) {
  let e = expr.trim();
  while (/^\(.*\)$/.test(e) && balancedParens(e.slice(1, -1))) e = e.slice(1, -1).trim();
  if (wholeCallTo(e, ESCAPERS) || MAPPED_ESCAPE.test(e)) return true;
  if (/^`[\s\S]*`$/.test(e) && lex(e).contexts[0].tokens.length === 1) return true;   // a template: structure
  const and = splitTop(e, "&&");
  if (and) return literalOnly(and[1]);                // `cond && <safe>` prints the safe half or a falsy literal
  // `X.map(v => `…`).join(…)`: the callback's template is STRUCTURE, its values swept where they sit.
  if (/^[\w$.\[\]()]+?\.map\(\(?[\w$, ]*\)? => `[^`]*`\)\.join\((?:"[^"]*"|'[^']*')?\)$/.test(e)) return true;
  // A `+` chain of literals and templates only.
  const plusToks = lex(e).contexts[0].tokens;
  if (plusToks.length > 1 && plusToks.every((tk, k) => (k % 2 === 0 ? isLiteral(tk) : tk.kind === "punct" && tk.text === "+"))) return true;
  if (SIMPLE_ENGINE.some(r => r.test(e))) return true;
  if (/^(["'])(?:(?!\1)[^\\]|\\.)*\1$/.test(e)) return true;
  if (/^`[^`$]*`$/.test(e)) return true;
  // A ternary whose output branches are all literal: `cond ? "a" : "b"` (nested allowed).
  const { contexts } = lex(e);
  const toks = contexts[0].tokens;
  let depth = 0, q = -1;
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.kind === "punct" && ["(", "[", "{"].includes(t.text)) depth++;
    else if (t.kind === "punct" && [")", "]", "}"].includes(t.text)) depth--;
    else if (depth === 0 && t.kind === "punct" && t.text === "?" && q < 0) q = k;
    else if (depth === 0 && t.kind === "punct" && t.text === ":" && q >= 0) {
      const a = e.slice(toks[q + 1].start, toks[k - 1].end), b = e.slice(toks[k + 1] ? toks[k + 1].start : e.length);
      return literalOnly(a) && literalOnly(b);
    }
  }
  return false;
}
const NOT_OUTPUT_CALLS = /\b(new RegExp|path\.(?:join|resolve|relative|dirname|basename)|fs\.[a-zA-Z]+|execFileSync|spawnSync|execSync|JSON\.parse|import)\(/g;

function balancedParens(s) { let d = 0; for (const ch of s) { if (ch === "(") d++; else if (ch === ")" && --d < 0) return false; } return d === 0; }
/** Split at the LAST top-level binary operator `op` (token-level), or null. */
function splitTop(e, op) {
  const toks = lex(e).contexts[0].tokens;
  let depth = 0, at = -1;
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.kind === "punct" && ["(", "[", "{"].includes(t.text)) depth++;
    else if (t.kind === "punct" && [")", "]", "}"].includes(t.text)) depth--;
    else if (depth === 0 && t.kind === "punct" && t.text === "?") return null;   // a ternary binds looser
    else if (depth === 0 && t.kind === "punct" && t.text === op) at = k;
  }
  return at < 0 ? null : [e.slice(0, toks[at].start).trim(), e.slice(toks[at].end).trim()];
}

// ─────────────── the DECLARED judgments ───────────────
// { file, fn?, expr: RegExp over the expression, class, why }. `fn` is the enclosing top-level declaration.
import { JUDGED } from "./sweep-interpolations.judged.mjs";

// ─────────────── run ───────────────
const all = process.argv.includes("--all");
const rows = [];
for (const file of FILES) {
  const src = fs.readFileSync(file, "utf8");
  const rel = path.relative(REPO, file);
  const { contexts, interps } = lex(src);
  const values = [...interps.map(x => ({ start: x.start, end: x.end, how: "${}" })),
    ...contexts.flatMap(concatOperands).map(x => ({ ...x, how: "+" }))];
  const fns = topLevelFunctions(src);
  const pushes = balancedCallSpans(src, /\b([\w$]+)\.push\(/g);
  const notOutput = balancedCallSpans(src, NOT_OUTPUT_CALLS);
  const escaping = balancedCallSpans(src, ESCAPING_SPANS);
  for (const v of values) {
    const expr = src.slice(v.start, v.end).trim().replace(/\s+/g, " ");
    const fn = fns.filter(f => f.start <= v.start && v.start < f.end).pop();
    const fnSrc = fn ? src.slice(fn.start, fn.end) : "";
    let cls;
    if (wholeCallTo(expr, ESCAPERS)) cls = "escaped";
    else if (escaping.some(p => p.start < v.start && v.end <= p.end)) cls = "escaped";
    else if (literalOnly(expr)) cls = "literal";
    else if (pushes.some(p => p.start < v.start && v.end <= p.end && new RegExp(`\\b${p.name}\\.map\\(escapeControls\\)`).test(fnSrc))) cls = "sink";
    else if (notOutput.some(p => p.start < v.start && v.end <= p.end)) cls = "not-output";
    else {
      const j = JUDGED.find(x => x.file === rel && (!x.fn || (fn && x.fn === fn.name)) && x.re.test(expr));
      cls = j ? `judged:${j.class}` : "UNCLASSIFIED";
      if (j) j.used = (j.used || 0) + 1;
    }
    rows.push({ cls, where: `${rel}:${lineOf(src, v.start)}`, fn: fn ? fn.name : "-", how: v.how, expr });
  }
}
const counts = {};
for (const r of rows) counts[r.cls.split(":")[0]] = (counts[r.cls.split(":")[0]] || 0) + 1;
for (const r of rows) if (all || r.cls === "UNCLASSIFIED") console.log(`${r.cls.padEnd(22)} ${r.where} [${r.fn}] ${r.how} ${r.expr.slice(0, 160)}`);
const unused = JUDGED.filter(j => !j.used);
for (const j of unused) console.log(`STALE-JUDGMENT ${j.file} ${j.fn || ""} /${j.re.source}/`);
console.log(`\ninterpolations: ${rows.length} — ` + Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(", "));
process.exit(counts.UNCLASSIFIED || unused.length ? 1 : 0);
