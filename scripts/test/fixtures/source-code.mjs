// scripts/test/fixtures/source-code.mjs
// THE ONE COMMENT STRIPPER OF THE TEST TREE (guards-that-read-engine-source-drift-silently).
// Dev-only, plain Node, no dependency; nothing here ships.
//
// A guard that reads source text and asserts a shape in it must answer from CODE: a comment that
// names the call it watches satisfies a raw read, and the call can then be deleted with nothing to
// say so. Seven guards each carried a stripper of their own; the character-level ones had no regex
// state and desynced on a regex literal holding a quote (every later comment passed through
// VERBATIM), and the line-oriented ones kept a trailing comment. This one is built on
// `../js-lexer.mjs`, which tracks regex literals and records where it KNOWS it may have misread —
// and `codeOnly()` throws on any such record rather than answer.
//
// WHY NOT `js-lexer.stripComments()`: that one DELETES a block comment, so line numbers shift after
// it, and several guards here report a line. It is also certify machinery; this module is not.
//
// ITS LIMIT is the lexer's own (js-lexer.mjs, "ITS LIMIT"): a regex literal in statement position
// after `)` or `}` is read as division.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lex } from "../js-lexer.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** `src` with every comment BLANKED — each comment character replaced by a space, each newline kept —
 *  so a line or column found in the result is the same line or column in `src`. Strings, templates
 *  and regex literals are kept as written. THROWS on any lexer misparse, naming `name` and the line. */
export function codeOnly(src, name = "<source>") {
  const { comments, misparse } = lex(src);
  if (misparse.length) {
    const m = misparse[0];
    throw new Error(`source-code: ${name}:${m.line}: ${m.what} — refusing to answer from a misread (fail closed)`);
  }
  let out = "", at = 0;
  for (const [a, b] of comments) {
    out += src.slice(at, a) + src.slice(a, b).replace(/[^\n]/g, " ");
    at = b;
  }
  return out + src.slice(at);
}

/** The engine module at repo-relative `rel` (`scripts/conductor.mjs` or `scripts/lib/<name>.mjs`),
 *  as `codeOnly()` returns it. A path outside the engine is refused: this reader exists so a guard
 *  over ENGINE source cannot be satisfied by the engine's prose. */
export function engineCode(rel) {
  const norm = path.posix.normalize(String(rel));
  if (norm !== rel || !(norm === "scripts/conductor.mjs" || /^scripts\/lib\/[\w.-]+\.mjs$/.test(norm))) {
    throw new Error(`source-code: ${rel} is not engine source (scripts/conductor.mjs or scripts/lib/*.mjs)`);
  }
  return codeOnly(fs.readFileSync(path.join(REPO, norm), "utf8"), norm);
}
