// scripts/test/js-lexer.mjs
// THE ONE JAVASCRIPT LEXER OF THE TEST TREE (certification-record-redesign D3, "The tokenizer"; task 3.1).
// Dev-only, plain Node, no dependency; nothing here ships.
//
// MOVED, NOT WRITTEN. `lex()` and `KEYWORDS_BEFORE_REGEX` were the output sweep's own lexer
// (`scripts/test/sweeps/output-interpolations.mjs`). The functional subject's derivation needs the same
// thing — code told apart from comments, strings, templates and REGEX LITERALS — to strip comments
// before its executed-file match, and so does the static NODE_OPTIONS guard. A second tokenizer would
// be a second answer to one question, and the round-3 tokenizer this replaced had no regex state: it
// opened a string at the quote inside `/process\.on\(\s*["'`]exit["'`]/` and read the comment after it
// as string text. So there is one lexer, imported by the sweep, by `certification.mjs`, and by nothing
// that keeps a copy.
//
// WHAT IT RETURNS. The sweep's three results, unchanged — `contexts` (the root and one per `${…}`, each
// with its tokens), `interps` and `templates` — plus two ADDITIVE ones the sweep ignores:
//   comments  — the `[start, end)` range of every `//` and `/* … */` comment it skipped;
//   misparse  — `{ at, line, what }` for every place the lexer KNOWS it may have misread: a quoted
//               (non-template) string or a regex literal that meets an unescaped newline, an
//               unterminated `/*`, and input that ends inside a string, template, `${…}` or regex.
// Recording a misparse changes no token: the scan continues exactly as it always has, so the sweep's
// classifications are byte-for-byte what they were. A caller that must not answer from a misread
// (the subject derivation, the NODE_OPTIONS guard) throws on a non-empty `misparse`.
//
// ITS LIMIT (design D3 (b), round 5). A `/` after `)` or `}` is read as division, so a regex literal in
// STATEMENT position after one (`if (ok) /re/.test(s)`, or a statement opening with a regex after a
// block's `}`) is misread; when that misread closes on its own line nothing is recorded. The spec states
// it as the static guard's fourth limit.

export const KEYWORDS_BEFORE_REGEX = new Set(["return", "typeof", "case", "in", "of", "delete", "void", "throw", "new", "else", "do", "instanceof", "yield", "await"]);

export function lex(src) {
  const contexts = [];                         // { tokens: [], start, parent } — root and one per ${…}
  const root = { tokens: [], start: 0, kind: "root" };
  contexts.push(root);
  const stack = [{ mode: "code", ctx: root }];
  const interps = [];                          // { start, end, ctx }
  const templates = [];                        // { start, end, hasInterp }
  const comments = [];                         // [start, end) of every comment skipped
  const misparse = [];                         // { at, line, what }
  const miss = (at, what) => misparse.push({ at, line: src.slice(0, at).split("\n").length, what });
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
    if (c === "/" && src[i + 1] === "/") { const s0 = i; while (i < src.length && src[i] !== "\n") i++; comments.push([s0, i]); continue; }
    if (c === "/" && src[i + 1] === "*") {
      const e = src.indexOf("*/", i + 2);
      if (e < 0) miss(i, "an unterminated /* comment");
      const s0 = i;
      i = e < 0 ? src.length : e + 2;
      comments.push([s0, i]);
      continue;
    }
    if (/\s/.test(c)) { i++; continue; }
    if (c === "'" || c === '"') {
      let j = i + 1, crossed = false;
      while (j < src.length && src[j] !== c) {
        if (src[j] === "\\") j++;
        else if (src[j] === "\n" && !crossed) { crossed = true; miss(i, "a quoted string meets an unescaped newline"); }
        j++;
      }
      if (j >= src.length) miss(i, "the input ends inside a string");
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
        let j = i + 1, inClass = false, crossed = false;
        while (j < src.length) {
          if (src[j] === "\\") { j += 2; continue; }
          if (src[j] === "\n" && !crossed) { crossed = true; miss(i, "a regex literal meets an unescaped newline"); }
          if (src[j] === "[") inClass = true; else if (src[j] === "]") inClass = false;
          else if (src[j] === "/" && !inClass) break;
          j++;
        }
        if (j >= src.length) miss(i, "the input ends inside a regex literal");
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
  if (stack.length > 1) {
    const open = top();
    miss(src.length, open.mode === "template" ? "the input ends inside a template" : "the input ends inside a template's ${…}");
  }
  return { contexts, interps, templates, comments, misparse };
}

/** The source with every comment removed — a line comment dropped, a block comment replaced by a
 *  space — and every string, template and regex kept as written. THROWS on any misparse, naming `name`
 *  and the line, because a caller matching text in CODE must never answer from a misread. */
export function stripComments(src, name = "<source>") {
  const { comments, misparse } = lex(src);
  if (misparse.length) {
    const m = misparse[0];
    throw new Error(`js-lexer: ${name}:${m.line}: ${m.what} — refusing to answer from a misread (fail closed, design D3 (b))`);
  }
  let out = "", at = 0;
  for (const [a, b] of comments) { out += src.slice(at, a) + (src.startsWith("/*", a) ? " " : ""); at = b; }
  return out + src.slice(at);
}
