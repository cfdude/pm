// scripts/test/fixtures/engine-extraction.mjs
// engine-source-extraction-vacuity — ONE HELPER FOR A TEST THAT PULLS A VALUE OUT OF ENGINE SOURCE.
//
// THE FAILURE IT CLOSES. A guard that slices engine source (an `indexOf` pair, a regex capture, a reader of
// the dispatch table) and then asserts something ABOUT the slice goes green against an EMPTY one when the
// engine changes shape: "every verb has a row" holds for zero verbs, "no slice names the forbidden call"
// holds for the empty string. It happened: 0.47.0 re-indented the dispatch table and the verb reader found
// nothing while the guard that depended on it stayed green; only a hand-written "the reader is broken, not
// the table" assertion in one of five copies caught it. This module makes that assertion the default.
//
// PURE VALUES, NO FILESYSTEM: every function takes the source text, so the unit rung can use it and the
// unit test (unit/engine-extraction.test.mjs) exercises every refusal with strings.

import assert from "node:assert/strict";

/** Is `value` an extraction that found nothing: null, undefined, a string with no non-space character, an
 *  array, Set or Map with no member, or an object with no key. A number or boolean is a value, never empty. */
export function isEmptyExtraction(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (value instanceof Set || value instanceof Map) return value.size === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

/** Return `value` unchanged, or THROW when it is an empty extraction. `what` names what was being
 *  extracted, so the failure reads "no verbs were extracted from the dispatch table" rather than a bare
 *  "expected a non-empty value". */
export function nonEmpty(value, what) {
  assert.ok(!isEmptyExtraction(value),
    `extracted NOTHING for ${what}: the engine's shape changed under this guard, so it would pass vacuously. ` +
    "Fix the extractor, do not relax the check.");
  return value;
}

/** The text of `src` from the first `from` through the first `to` after it (`to` null: through the end),
 *  by string anchors. REFUSES a missing anchor (indexOf -1, which `slice` would turn into "the last
 *  character" or "from the start") and an empty or blank result. `inclusive` keeps the `to` anchor. */
export function sliceBetween(src, from, to, what, { inclusive = false } = {}) {
  const start = src.indexOf(from);
  assert.notEqual(start, -1, `${what}: the start anchor ${JSON.stringify(from)} is gone from the source`);
  let end = src.length;
  if (to !== null && to !== undefined) {
    const at = src.indexOf(to, start + from.length);
    assert.notEqual(at, -1, `${what}: the end anchor ${JSON.stringify(to)} is gone from the source after the start`);
    end = inclusive ? at + to.length : at;
  }
  return nonEmpty(src.slice(start, end), what);
}

/** The first capture group of `regex` over `src`, REFUSING a pattern that matches nothing and a capture that
 *  is empty. A pattern without a capture group returns the whole match. */
export function captureOf(src, regex, what) {
  const m = regex.exec(src);
  assert.ok(m, `${what}: the pattern ${regex} matches nothing in the source — its shape changed`);
  return nonEmpty(m.length > 1 ? m[1] : m[0], what);
}

/** `matchAll` that REFUSES zero matches: every match of `regex` (needs the `g` flag) over `src`. */
export function allMatches(src, regex, what) {
  return nonEmpty([...src.matchAll(regex)], what);
}

/** The verb names conductor.mjs's dispatch object holds, read out of the SOURCE TEXT `src` (the caller reads
 *  the file). ONE reader for the five test files that each carried a copy; it refuses a missing marker, a
 *  missing `}[cmd]` index, and — the case the copies did not — an EMPTY verb set.
 *
 *  THE INDENT IS PART OF THE SHAPE: 0.47.0 moved the table two spaces right by wrapping the module body in
 *  `main(argv, io)`, and a reader pinned to exactly two spaces found nothing. The band `2,4` accepts either
 *  shape and refuses anything deeper, so a table nested further down still fails rather than silently
 *  matching a handler's own line. Shorthand entries (`init,` with no colon) are dispatched too. */
export function dispatchedVerbsOf(src) {
  const start = src.indexOf("// ---------- dispatch ----------");
  assert.notEqual(start, -1, "conductor.mjs must still carry its dispatch marker comment");
  const tryAt = src.indexOf("try {", start);
  assert.notEqual(tryAt, -1, "the dispatch marker must still be followed by a `try {`");
  const open = src.indexOf("({", tryAt);
  assert.notEqual(open, -1, "the dispatch object must still open with `({`");
  const body = src.slice(open);
  const end = body.indexOf("}[cmd]");
  assert.notEqual(end, -1, "the dispatch object must still be indexed as `}[cmd]`");
  const table = body.slice(0, end);
  const verbs = new Set();
  for (const m of table.matchAll(/^ {2,4}(?:"([a-z-]+)"|([a-z-]+))\s*:/gm)) verbs.add(m[1] || m[2]);
  for (const m of table.matchAll(/^ {2,4}([a-z-]+),\s*$/gm)) verbs.add(m[1]);
  return nonEmpty(verbs, "the verbs of the dispatch table");
}
