// The per-INTERPOLATION output sweep (user-text-never-forges-output, Gate 2 T-S2; moved into the suite by
// Gate 2 U2-I1 so it guards every later commit, not only the one that ran it).
//
// WHY THIS EXISTS. A sweep that filters rg hits to lines WITHOUT an escaper hides every line that escapes
// one value and not its neighbour. The unit here is ONE interpolated value, never a line: every `${…}` of
// every template literal and every non-literal operand of a `+` chain that holds a string literal, in
// scripts/conductor.mjs and scripts/lib/*.mjs.
//
// METHOD. A small JS lexer (comments, quotes, nested template literals, regex literals) finds each
// interpolation with its line and enclosing top-level declaration. Each is classified, in order:
//   escaped       the whole value is a call to an escaper or id printer (escapeControls, escapeTableCell,
//                 printedId, commandValue, noRemedyMessage, tableRow, unstorableSkipLine), a
//                 `.map(<escaper>).join(…)`, or it sits inside the argument of escapeControls /
//                 escapeTableCell / tableRow. asCode and orNoRemedy escape NOTHING themselves: they count
//                 only around a BUILT remedy — a template or `+` chain of literals and escaper calls, an
//                 escaper call, or a call to a remedy builder of archive-gate.mjs (Gate 2 V-I2). An
//                 escaper is trusted only under the name it is really bound to in that file: imported
//                 from its home module, declared there, or a local alias whose value is the escaper or
//                 an arrow returning a whole call to it — never a name alone (`esc`), and never a local
//                 declaration shadowing the real one. shellQuote is deliberately NOT an escaper;
//   literal       every value it can print is literal: a string, a number, `<name>.length`/`.size`, an
//                 ALL_CAPS constant (or its `.join`) whose every declaration — followed through imports — is
//                 a literal, an array/object/Set of literals, or listed in LITERAL_ALLOWLIST with a reason,
//                 and that is never reassigned or rebound (Gate 2 W-I2), a Date rendering, a template or `+` chain of
//                 literals (whose own values are swept where they sit), a ternary / `&&` of those (an
//                 `&&` only when no looser `||`, `??`, `?` or `,` sits beside it at the top level);
//   sink          it sits inside `X.push(…)` in a declaration that joins X through `X.map(escapeControls)`;
//   not-output    it sits inside a call that builds no printed text (RegExp, path, fs, child_process,
//                 JSON.parse, import);
//   judged        everything else, matched against the DECLARED table in output-interpolations.judged.mjs.
//                 A judgment names EXACT expressions with the number of times each occurs in its
//                 declaration, so a second raw copy of a judged expression is a finding too; only a
//                 sink-flow or json judgment may cover a whole declaration, and a sink-flow one never covers
//                 a value written straight to a stream (process.stdout/stderr.write, console, fs.writeSync)
//                 beside its sink (Gate 2 W-I1).
//   UNCLASSIFIED  none of the above — a FINDING. A judgment matching fewer occurrences than it declares
//                 is STALE; one matching more is EXCESS. Both are findings.
// The test is output-interpolations.test.mjs. Run `node scripts/test/output-interpolations.mjs [--all]`
// to print the findings (or, with --all, every interpolation with its class); it exits 1 on any finding.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JUDGED } from "./output-interpolations.judged.mjs";

/** The repository root: two directories above this file (scripts/test/), wherever the checkout lives. */
export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export function sweptFiles(repo = REPO) {
  return ["scripts/conductor.mjs",
    ...fs.readdirSync(path.join(repo, "scripts", "lib")).filter(f => f.endsWith(".mjs")).sort().map(f => `scripts/lib/${f}`)];
}

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
export function topLevelFunctions(src) {
  const starts = [...src.matchAll(/^(?:export\s+)?(?:async\s+)?(?:function\s+([\w$]+)|(?:const|let)\s+([\w$]+)\s*=)/gm)]
    .map(m => ({ start: m.index, name: m[1] || m[2] }));
  return starts.map((s, i) => ({ ...s, end: i + 1 < starts.length ? starts[i + 1].start : src.length }));
}

// shellQuote is NOT here: it quotes for the shell and leaves a control character raw, so each use is judged.
// Each escaper with the module that declares it: a name is trusted only as a binding to THAT declaration.
export const ESCAPER_HOMES = {
  escapeControls: "scripts/lib/constants.mjs", escapeTableCell: "scripts/lib/constants.mjs", printedId: "scripts/lib/constants.mjs",
  commandValue: "scripts/lib/constants.mjs", noRemedyMessage: "scripts/lib/constants.mjs", unstorableSkipLine: "scripts/lib/constants.mjs",
  tableRow: "scripts/lib/render.mjs",
  // WRAPPERS, not escapers: they return what their argument built (Gate 2 V-I2). See builtRemedy().
  asCode: "scripts/lib/constants.mjs", orNoRemedy: "scripts/lib/constants.mjs",
  // Remedy BUILDERS: each returns a command composed from printedId()/commandValue() and engine text, its own
  // interpolations swept where they sit. Trusted only inside asCode()/orNoRemedy() and only as the real import.
  gateRemedy: "scripts/lib/archive-gate.mjs", obligationRemedy: "scripts/lib/archive-gate.mjs",
  dispositionInvocation: "scripts/lib/archive-gate.mjs", deliveredArchiveInvocation: "scripts/lib/archive-gate.mjs",
};
const WRAPPERS = new Set(["asCode", "orNoRemedy"]);
const BUILDERS = new Set(["gateRemedy", "obligationRemedy", "dispositionInvocation", "deliveredArchiveInvocation"]);
/** Calls whose ARGUMENT text is escaped as a whole, so every value interpolated inside it is too. */
const SPAN_ESCAPERS = new Set(["escapeControls", "escapeTableCell", "tableRow"]);

/** The escapers a file may use, as a Map of LOCAL name → real name. A real name counts when the file is its
 *  home and declares it at the top level, or imports it from its home module (`as` aliases included) — and
 *  is not also declared locally, which would shadow the import. A local `const A = B` or
 *  `const A = (v) => B(…)` (B trusted) aliases B, but only if EVERY declaration of A in the file does. */
export function trustedEscapers(rel, src) {
  const names = new Map();
  // Line comments first: a `//` comment may hold `/*` (a glob such as `commands/*.md`).
  const code = src.replace(/(^|\s)\/\/[^\n]*/g, "$1").replace(/\/\*[\s\S]*?\*\//g, "");
  const declared = (n) => [...code.matchAll(new RegExp(`(?:^|[^\\w$.])(?:const|let|var|function|class)\\s+${n.replace(/\$/g, "\\$")}\\b`, "g"))].length;
  for (const [real, home] of Object.entries(ESCAPER_HOMES)) {
    if (rel === home && new RegExp(`^export\\s+(?:const|function)\\s+${real}\\b`, "m").test(code) && declared(real) === 1) names.set(real, real);
  }
  for (const m of code.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
    const from = path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[2]));
    for (const spec of m[1].split(",").map(t => t.trim()).filter(Boolean)) {
      const [real, local = real] = spec.split(/\s+as\s+/).map(t => t.trim());
      if (ESCAPER_HOMES[real] === from && declared(local) === 0) names.set(local, real);
    }
  }
  const aliasDecls = [...code.matchAll(/(?:const|let)\s+([\w$]+)\s*=\s*([^;\n]+);?/g)];
  for (const name of new Set(aliasDecls.map(m => m[1]))) {
    if (names.has(name)) continue;
    const rhs = aliasDecls.filter(m => m[1] === name).map(m => m[2].trim());
    const realOf = (r) => {
      if (names.has(r) && !WRAPPERS.has(names.get(r)) && !BUILDERS.has(names.get(r))) return names.get(r);
      const arrow = /^\(?\s*[\w$]+\s*\)?\s*=>\s*([\s\S]+)$/.exec(r);
      const callee = arrow && /^([\w$]+)\(/.exec(arrow[1]);
      return callee && names.has(callee[1]) && SPAN_ESCAPERS.has(names.get(callee[1])) && wholeCallTo(arrow[1], [callee[1]]) ? names.get(callee[1]) : null;
    };
    const reals = rhs.map(realOf);
    if (reals.length === declared(name) && reals.every(r => r && r === reals[0])) names.set(name, reals[0]);
  }
  return names;
}
/** Local names bound to one of `reals`. */
const localNames = (names, reals) => [...names].filter(([, real]) => reals.has(real)).map(([local]) => local);
const ESCAPER_REALS = new Set(Object.keys(ESCAPER_HOMES).filter(n => !WRAPPERS.has(n) && !BUILDERS.has(n)));

/** An escaped call: a whole call to a trusted escaper, or to asCode()/orNoRemedy() around a built remedy. */
function escapedCall(expr, names) {
  const m = /^([\w$]+)\(/.exec(expr);
  if (!m || !names.has(m[1]) || !wholeCallTo(expr, [m[1]])) return false;
  const real = names.get(m[1]);
  if (ESCAPER_REALS.has(real)) return true;
  if (!WRAPPERS.has(real)) return false;
  const arg = expr.slice(m[0].length, -1).trim();
  if (real === "asCode") return builtRemedy(arg, names);
  const thunk = /^\(\s*\)\s*=>\s*([\s\S]+)$/.exec(arg);
  return !!thunk && builtRemedy(thunk[1].trim(), names);
}
/** A remedy as built: a template (its values swept where they sit), a `+` chain of literals, templates and
 *  escaped calls holding a string, an escaped call, or a call to a trusted remedy builder (optionally indexed). */
function builtRemedy(expr, names) {
  let e = expr.trim();
  while (/^\(.*\)$/s.test(e) && balancedParens(e.slice(1, -1))) e = e.slice(1, -1).trim();
  const toks = lex(e).contexts[0].tokens;
  if (toks.length === 1 && toks[0].kind === "template") return true;
  if (escapedCall(e, names)) return true;
  const call = /^([\w$]+)\(/.exec(e);
  if (call && names.has(call[1]) && BUILDERS.has(names.get(call[1]))) {
    const bare = e.replace(/\[\d+\]$/, "");
    if (wholeCallTo(bare, [call[1]])) return true;
  }
  const ops = [];
  let k = 0;
  while (k < toks.length) {
    const end = operandEnd(toks, k);
    if (end < 0) return false;
    ops.push(e.slice(toks[k].start, toks[end - 1].end));
    if (end === toks.length) break;
    if (!(toks[end].kind === "punct" && toks[end].text === "+")) return false;
    k = end + 1;
  }
  if (ops.length < 2) return false;
  const stringy = ops.some(o => { const t = lex(o).contexts[0].tokens; return t.length === 1 && isStringy(t[0]); });
  return stringy && ops.every(o => { const t = lex(o).contexts[0].tokens; return (t.length === 1 && isLiteral(t[0])) || escapedCall(o.trim(), names); });
}
function wholeCallTo(expr, names) {
  const m = /^([\w$]+)\(/.exec(expr);
  if (!m || !names.includes(m[1])) return false;
  let d = 0;
  for (let i = m[1].length; i < expr.length; i++) {
    if (expr[i] === "(") d++; else if (expr[i] === ")") { d--; if (d === 0) return i === expr.length - 1; }
  }
  return false;
}
// Anchored to the WHOLE operand (Gate 2 V-I2): `held.session + held.x.length` is not a count. `<name> + 1`
// is not here at all — a name alone cannot say it is a number — so an ordinal judges it.
const SIMPLE_ENGINE = [
  /^\d+$/, /^[\w$.]+\.length$/, /^[\w$.]+\.size$/,
  /^new Date\([^)]*\)\.toISOString\(\)$/, /^ordinal\([\w$.]+\)$/,
];
// An ALL_CAPS name (or its `.join(…)`) is literal only when its DECLARATION is (Gate 2 W-I2): a name alone
// said nothing — `PROJECT_MD` is path.join(CLAUDE_PROJECT_DIR…), `L` a local array of templates, and
// `const HELD = held.session` was trusted by its spelling.
const CONSTANT_NAME = /^([A-Z][A-Z0-9_]*)(?:\.join\((?:["'][^"']*["'])?\))?$/;
/** Constants whose declaration is not a literal SHAPE the resolver reads, trusted with a reason. Each names
 *  its declaration; the test asserts every entry still resolves to a declaration of that exact text. */
export const LITERAL_ALLOWLIST = {
  "scripts/lib/archive-gate.mjs:AGENT_OUTCOMES": {
    decl: "KNOWN_OUTCOMES.filter(o => o !== \"unknown\")",
    why: "a filter of disposition.mjs's literal KNOWN_OUTCOMES array: a subset of literal strings",
  },
};
/** Comments removed and the TEXT of every string and template literal blanked (quotes kept, length kept),
 *  so a declaration pattern never matches inside a literal or a comment (Gate 2 W-M2). */
export function codeOnly(src) {
  const { contexts, templates, interps } = lex(src);
  const out = src.split("");
  const keep = new Uint8Array(src.length);
  const blank = (a, b) => { for (let i = a; i < b; i++) if (out[i] !== "\n") out[i] = " "; };
  for (const ctx of contexts) for (const t of ctx.tokens) keep.fill(1, t.start, t.end);
  // A comment is whatever no token covers; whitespace stays as it is.
  for (let i = 0; i < src.length; i++) if (!keep[i] && !/\s/.test(src[i])) out[i] = " ";
  for (const ctx of contexts) for (const t of ctx.tokens) {
    if (t.kind === "string" || t.kind === "regex") blank(t.start + 1, t.end - 1);
  }
  for (const tpl of templates) {
    // The template's literal text, never its interpolations' code.
    let at = tpl.start + 1;
    for (const x of interps.filter(x => x.start > tpl.start && x.end < tpl.end).sort((p, q) => p.start - q.start)) {
      if (x.start - 2 > at) blank(at, x.start - 2);
      at = Math.max(at, x.end + 1);
    }
    if (tpl.end - 1 > at) blank(at, tpl.end - 1);
  }
  return out.join("");
}
/** The text of a declaration's right-hand side starting at `from` (just after `=`): to a top-level `;`, or a
 *  line break at depth 0 after a complete value where no operator continues the expression. */
function rhsText(src, from) {
  const toks = lex(src.slice(from)).contexts[0].tokens;
  let depth = 0, end = 0;
  const CONT = new Set(["+", ".", "?.", "?", ":", "||", "&&", "??", "=>", ",", "(", "[", "{", "-", "*", "/"]);
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k], prev = toks[k - 1];
    if (depth === 0 && prev && /\n/.test(src.slice(from + prev.end, from + t.start)) &&
      !(prev.kind === "punct" && CONT.has(prev.text)) && !(t.kind === "punct" && CONT.has(t.text))) break;
    if (t.kind === "punct" && ["(", "[", "{"].includes(t.text)) depth++;
    else if (t.kind === "punct" && [")", "]", "}"].includes(t.text)) depth--;
    if (depth === 0 && t.kind === "punct" && t.text === ";") break;
    end = t.end;
  }
  return src.slice(from, from + end).trim();
}
/** Is `name`, as file `rel` binds it, a constant whose every declaration is literal — a string, a number, an
 *  interpolation-free template, or an array/object/Set/Object.freeze of those and of other such constants —
 *  or an import of one? Anything else (a call, a path, a destructured binding, a parameter) is not. */
export function literalConstant(rel, name, read, seen = new Set()) {
  const key = `${rel}:${name}`;
  if (seen.has(key)) return false;
  seen.add(key);
  let src;
  try { src = read(rel); } catch { return false; }
  const code = codeOnly(src);
  const esc = name.replace(/\$/g, "\\$");
  // Any binding that is not `const|let|var NAME =`: a function, a class, a destructuring, a parameter or catch.
  if (new RegExp(`(?:^|[^\\w$.])(?:function|class)\\s+${esc}\\b`).test(code)) return false;
  if (new RegExp(`(?:const|let|var)\\s*[{\\[][^=;]*[^\\w$.]${esc}\\b[^=;]*[}\\]]\\s*=`).test(code)) return false;
  if (new RegExp(`\\(\\s*(?:[\\w$]+\\s*,\\s*)*${esc}\\s*(?:,[^)]*)?\\)\\s*(?:=>|\\{)|catch\\s*\\(\\s*${esc}\\s*\\)|[^\\w$.]${esc}\\s*=>`).test(code)) return false;
  // A reassignment `NAME = …` outside its declaration: its value is whatever was assigned last.
  if (new RegExp(`(?:^|[^\\w$.])${esc}\\s*(?:[-+*/|&?]{1,3})?=(?![=>])`).test(code.replace(new RegExp(`(?:const|let|var)\\s+${esc}\\s*=`, "g"), ""))) return false;
  const decls = [...code.matchAll(new RegExp(`(?:^|[^\\w$.])(?:const|let|var)\\s+${esc}\\s*=`, "g"))];
  if (decls.length) {
    const allow = LITERAL_ALLOWLIST[key];
    return decls.every(m => {
      const rhs = rhsText(src, m.index + m[0].length);
      return (allow && normaliseExpr(rhs) === normaliseExpr(allow.decl)) || literalValue(rel, rhs, read, seen);
    });
  }
  for (const m of code.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
    // The specifier list and the module path, read from the ORIGINAL text at the same offsets.
    const orig = src.slice(m.index, m.index + m[0].length);
    const im = /import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/.exec(orig);
    for (const spec of im[1].split(",").map(t => t.trim()).filter(Boolean)) {
      const [real, local = real] = spec.split(/\s+as\s+/).map(t => t.trim());
      if (local === name) return literalConstant(path.posix.normalize(path.posix.join(path.posix.dirname(rel), im[2])), real, read, seen);
    }
  }
  return false;
}
function literalValue(rel, rhs, read, seen) {
  const toks = lex(rhs).contexts[0].tokens;
  if (!toks.length) return false;
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k], next = toks[k + 1], prev = toks[k - 1];
    if (t.kind === "string" || t.kind === "number") continue;
    if (t.kind === "template") { if (t.tpl.hasInterp) return false; continue; }
    if (t.kind === "punct" && ["[", "]", "{", "}", "(", ")", ",", ":", "+", "-", "..."].includes(t.text)) continue;
    if (t.kind === "ident" && ["true", "false", "null", "undefined"].includes(t.text)) continue;
    if (t.kind === "ident" && next && next.kind === "punct" && next.text === ":" && prev && ["{", ","].includes(prev.text)) continue;   // an object key
    if (t.kind === "ident" && t.text === "Object" && next && next.text === "." && toks[k + 2] && toks[k + 2].text === "freeze") { k += 2; continue; }
    if (t.kind === "ident" && t.text === "new" && next && next.kind === "ident" && next.text === "Set") { k += 1; continue; }
    if (t.kind === "ident" && /^[A-Z][A-Z0-9_]*$/.test(t.text) && !(next && next.kind === "punct" && [".", "?.", "("].includes(next.text)) &&
      literalConstant(rel, t.text, read, seen)) continue;
    return false;
  }
  return true;
}
const reAlt = (xs) => xs.map(n => n.replace(/\$/g, "\\$")).join("|") || "(?!)";
/** `X.map(<escaper>).join(…)`, with the escaper named as the file really binds it. */
function mappedEscape(e, names) {
  const plain = reAlt(localNames(names, new Set(["escapeControls", "printedId"])));
  return new RegExp(`^[\\w$.]+(?:\\.filter\\([^)]*\\))?\\.map\\((?:${plain}|\\(?[\\w$]+\\)? => (?:${plain})\\(.*\\))\\)\\.join\\((?:"[^"]*"|'[^']*')?\\)$`).test(e);
}
function literalOnly(expr, names) {
  let e = expr.trim();
  while (/^\(.*\)$/.test(e) && balancedParens(e.slice(1, -1))) e = e.slice(1, -1).trim();
  if (escapedCall(e, names) || mappedEscape(e, names)) return true;
  if (/^`[\s\S]*`$/.test(e) && lex(e).contexts[0].tokens.length === 1) return true;   // a template: structure
  const and = splitTop(e, "&&");
  if (and) return literalOnly(and[1], names);                // `cond && <safe>` prints the safe half or a falsy literal
  // `X.map(v => `…`).join(…)`: the callback's template is STRUCTURE, its values swept where they sit.
  if (/^[\w$.\[\]()]+?\.map\(\(?[\w$, ]*\)? => `[^`]*`\)\.join\((?:"[^"]*"|'[^']*')?\)$/.test(e)) return true;
  // A `+` chain of literals and templates only.
  const plusToks = lex(e).contexts[0].tokens;
  if (plusToks.length > 1 && plusToks.every((tk, k) => (k % 2 === 0 ? isLiteral(tk) : tk.kind === "punct" && tk.text === "+"))) return true;
  if (SIMPLE_ENGINE.some(r => r.test(e))) return true;
  const constant = CONSTANT_NAME.exec(e);
  if (constant && names.constant && names.constant(constant[1])) return true;
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
      return literalOnly(a, names) && literalOnly(b, names);
    }
  }
  return false;
}
/** Calls that write their argument straight to a process stream. */
const DIRECT_OUTPUT_CALLS = /\b(process\.(?:stdout|stderr)\.write|console\.(?:log|error|warn|info)|fs\.writeSync)\(/g;
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
    // A ternary, `||`, `??`, assignment or comma binds looser than `&&`: splitting past one would judge the
    // right half of `a || b && "y"` as if it were the whole value (Gate 2 V-I2).
    else if (depth === 0 && t.kind === "punct" && ["?", "||", "??", ",", "=", "||=", "??=", "&&="].includes(t.text) && t.text !== op) return null;
    else if (depth === 0 && t.kind === "punct" && t.text === op) at = k;
  }
  return at < 0 ? null : [e.slice(0, toks[at].start).trim(), e.slice(toks[at].end).trim()];
}
/** The form a judgment's expression is MATCHED in (Gate 2 V-M3): whitespace collapsed, none left after an
 *  opening bracket or `.`, none before a closing bracket, `,` or `.`, and a trailing comma before a closing
 *  bracket dropped — so a judged expression reformatted across lines still matches. Token-level, so the
 *  text of a string or template literal is never touched. Applied to BOTH sides of the comparison. */
export function normaliseExpr(text) {
  const e = String(text).trim().replace(/\s+/g, " ");
  const toks = lex(e).contexts[0].tokens;
  if (!toks.length) return e;
  const OPENS = new Set(["(", "[", "{", ".", "?."]), TIGHT_BEFORE = new Set([")", "]", "}", ",", ".", "?."]);
  let out = "", last = null;
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k], next = toks[k + 1];
    if (t.kind === "punct" && t.text === "," && next && next.kind === "punct" && [")", "]", "}"].includes(next.text)) continue;
    if (last) {
      const spaced = /\s/.test(e.slice(last.end, t.start));
      const tight = (last.kind === "punct" && OPENS.has(last.text)) || (t.kind === "punct" && TIGHT_BEFORE.has(t.text));
      if (spaced && !tight) out += " ";
    }
    out += e.slice(t.start, t.end);
    last = t;
  }
  return out;
}
// ─────────────── run ───────────────
/** The only classes a judgment may assert for a WHOLE declaration: every value it prints joins a line sink,
 *  or its whole output is one JSON document. Any other class is a claim about particular expressions. */
export const FUNCTION_WIDE_CLASSES = new Set(["sink-flow", "json"]);

/** Classify every interpolation. `read(rel)` returns a swept file's text — a test passes a mutated copy.
 *  Returns every row, the per-class counts, and the findings (UNCLASSIFIED, STALE, EXCESS, WIDE). */
export function sweepInterpolations({ repo = REPO, read = (rel) => fs.readFileSync(path.join(repo, rel), "utf8"), judged = JUDGED } = {}) {
  const used = new Map(judged.map(x => [x, 0]));
  const exactKey = new Map(judged.filter(x => x.exact !== undefined).map(x => [x, normaliseExpr(x.exact)]));
  const rows = [];
  for (const rel of sweptFiles(repo)) {
    const src = read(rel);
    const { contexts, interps } = lex(src);
    const values = [...interps.map(x => ({ start: x.start, end: x.end, how: "${}" })),
      ...contexts.flatMap(concatOperands).map(x => ({ ...x, how: "+" }))];
    const fns = topLevelFunctions(src);
    const pushes = balancedCallSpans(src, /\b([\w$]+)\.push\(/g);
    const notOutput = balancedCallSpans(src, NOT_OUTPUT_CALLS);
    const direct = balancedCallSpans(src, DIRECT_OUTPUT_CALLS);
    const names = trustedEscapers(rel, src);
    names.constant = (n) => literalConstant(rel, n, read);
    const spanNames = localNames(names, SPAN_ESCAPERS);
    const escaping = spanNames.length ? balancedCallSpans(src, new RegExp(`\\b(${reAlt(spanNames)})\\(`, "g")) : [];
    for (const v of values) {
      const expr = src.slice(v.start, v.end).trim().replace(/\s+/g, " ");
      const fn = fns.filter(f => f.start <= v.start && v.start < f.end).pop();
      const fnSrc = fn ? src.slice(fn.start, fn.end) : "";
      let cls;
      if (escapedCall(expr, names)) cls = "escaped";
      else if (escaping.some(p => p.start < v.start && v.end <= p.end)) cls = "escaped";
      else if (literalOnly(expr, names)) cls = "literal";
      else if (pushes.some(p => p.start < v.start && v.end <= p.end && new RegExp(`\\b${p.name}\\.map\\(escapeControls\\)`).test(fnSrc))) cls = "sink";
      else if (notOutput.some(p => p.start < v.start && v.end <= p.end)) cls = "not-output";
      else {
        const key = normaliseExpr(expr);
        // A WHOLE-declaration judgment says where the declaration's lines GO; a value written straight to a
        // stream beside that sink never goes there, so only an exact judgment covers it (Gate 2 W-I1).
        const straight = direct.some(p => p.start < v.start && v.end <= p.end);
        const j = judged.find(x => x.file === rel && x.fn === (fn ? fn.name : undefined) &&
          (x.exact !== undefined ? exactKey.get(x) === key : !(straight && x.class === "sink-flow") && x.re.test(expr)));
        cls = j ? `judged:${j.class}` : "UNCLASSIFIED";
        if (j) used.set(j, used.get(j) + 1);
      }
      rows.push({ cls, file: rel, line: lineOf(src, v.start), where: `${rel}:${lineOf(src, v.start)}`, fn: fn ? fn.name : "-", how: v.how, expr });
    }
  }
  const counts = {};
  for (const r of rows) counts[r.cls.split(":")[0]] = (counts[r.cls.split(":")[0]] || 0) + 1;
  const findings = rows.filter(r => r.cls === "UNCLASSIFIED").map(r => `UNCLASSIFIED ${r.where} [${r.fn}] ${r.how} ${r.expr.slice(0, 160)}`);
  const name = (x) => `${x.file} [${x.fn}] ${x.exact !== undefined ? JSON.stringify(x.exact) : `/${x.re.source}/`}`;
  const where = "(declared in scripts/test/output-interpolations.judged.mjs)";
  for (const [x, n] of used) {
    if (x.exact === undefined && !FUNCTION_WIDE_CLASSES.has(x.class)) findings.push(`WIDE ${name(x)}: a ${x.class} judgment must name its expressions ${where}`);
    const want = x.exact !== undefined ? x.count : 1;
    if (n < want) findings.push(`STALE ${name(x)}: declared ${x.exact !== undefined ? `${want} occurrence(s)` : "a match"}, found ${n} ${where}`);
    if (x.exact !== undefined && n > want) findings.push(`EXCESS ${name(x)}: declared ${want} occurrence(s), found ${n} — judge the new one ${where}`);
  }
  return { rows, counts, findings };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { rows, counts, findings } = sweepInterpolations();
  const out = [];
  if (process.argv.includes("--all")) for (const r of rows) out.push(`${r.cls.padEnd(22)} ${r.where} [${r.fn}] ${r.how} ${r.expr.slice(0, 160)}`);
  out.push(...findings.filter(f => !(process.argv.includes("--all") && f.startsWith("UNCLASSIFIED"))));
  out.push(`\ninterpolations: ${rows.length} — ` + Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(", "));
  process.stdout.write(out.join("\n") + "\n");
  // exitCode, never exit(): exit() can cut a piped stdout short of what was written.
  process.exitCode = findings.length ? 1 : 0;
}
