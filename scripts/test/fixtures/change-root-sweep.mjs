// scripts/test/fixtures/change-root-sweep.mjs
// dehardcode-openspec-change-root-in-instructions D2 — the one rule both halves of the sweep apply: the
// literal `openspec/changes/` may appear in shipped instruction text only as a STATED DEFAULT, i.e.
// immediately preceded by `by default ` (case-insensitive, an opening backtick allowed between, a line
// break allowed inside the phrase). Anything else is a pinned path and is reported with its line.

const LITERAL = /openspec\/changes\//g;
const STATED_DEFAULT = /by\s+default\s+`?$/i;

/** `[{ line, text }]` for every pinned occurrence in `text`. */
export function pinnedPaths(text) {
  const hits = [];
  for (const m of text.matchAll(LITERAL)) {
    if (STATED_DEFAULT.test(text.slice(0, m.index))) continue;
    const line = text.slice(0, m.index).split("\n").length;
    hits.push({ line, text: text.split("\n")[line - 1].trim().slice(0, 140) });
  }
  return hits;
}
