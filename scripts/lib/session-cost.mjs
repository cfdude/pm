// scripts/lib/session-cost.mjs
// rules-block-session-cost — what pm costs every session before the user types a word, as PURE values.
//
// Two things are paid on every session start and by every dispatched agent: the managed rules block
// in CLAUDE.md (read as project instructions) and the SessionStart brief (injected as context).
// Nothing measured either, so nothing could notice either growing. This module is the measuring and
// the capping; it touches no file. The impure half (reading the rules file, building the brief) is
// session-cost-report.mjs.
//
// Tokens are bytes/4, rounded up: an ESTIMATE, labelled as one wherever it is printed. No tokenizer is
// involved — the engine has no dependency to supply one — and a ratio is enough to rank and to notice
// growth, which is all this is for.

import { rulesBlockArrangement } from "./rules.mjs";

/** The hard cap on the SessionStart brief, in UTF-8 bytes (about 4K tokens). The brief is the one
 *  per-session payload that GROWS with a repository's history: on pm's own repo it was 78,276 bytes,
 *  of which RELEASES, DISPOSITIONS, GATE REVIEWS, HANDOFFS and EPIC LINKS were all but the first
 *  ~1.7 KB. PROJECT.md embeds the same text uncapped, so nothing is lost by bounding it here.
 *
 *  THE CAP BINDS THE LISTS, NOT THE BRIEF'S TEXT. A tail-cut at a byte offset (the first design) ate
 *  whatever sat past the offset: with RELEASES alone near 14 KB, the UNGATED / WITHDRAWN ARCHIVES
 *  blocks, the spec-sync block and TRACKER SYNC, all obligations, were the part dropped. fitBrief()
 *  shortens only the lists buildBriefParts() marks shortenable and leaves every other block whole. */
export const BRIEF_BYTE_CAP = 16384;

/** A shortenable list's item lines are trimmed to this many characters (a release or disposition row
 *  can carry a multi-KB free-text reason); the overflow line and the PROJECT.md pointer are not. */
export const BRIEF_ITEM_MAX = 240;

export const byteSize = (text) => Buffer.byteLength(text, "utf8");
export const estimateTokens = (bytes) => Math.ceil(bytes / 4);

/** The block's `## ` sections as `[{heading, bytes}]`, in document order. A section runs from its
 *  heading line to the next one. The text before the first heading (the BEGIN marker line) belongs to
 *  the first section and the END marker to the last, so the sizes SUM to the block's size and no byte
 *  is unaccounted for. Block with no heading: one section, "(no heading)". */
export function rulesBlockSections(block) {
  if (!block) return [];
  const sections = [];
  let current = null;
  let carry = "";
  for (const line of block.split(/(?<=\n)/)) {
    const m = /^## (.*?)\s*$/.exec(line);
    if (m) {
      current = { heading: m[1], bytes: byteSize(carry) };
      carry = "";
      sections.push(current);
    }
    if (current) current.bytes += byteSize(line);
    else carry += line;
  }
  if (!sections.length) return [{ heading: "(no heading)", bytes: byteSize(carry) }];
  return sections;
}

/** `{bytes, tokens, sections}` for one block, sections ranked largest first (ties keep document order). */
export function measureRulesBlock(block) {
  const bytes = byteSize(block);
  const sections = rulesBlockSections(block)
    .map((s, i) => ({ ...s, i }))
    .sort((a, b) => b.bytes - a.bytes || a.i - b.i)
    .map(({ heading, bytes: b }) => ({ heading, bytes: b }));
  return { bytes, tokens: estimateTokens(bytes), sections };
}

/** The managed block as it sits in a rules file: the marker lines and everything between, verbatim.
 *  Null when the file has none, and null (never a guess) when its markers are ambiguous. */
export function onDiskRulesBlock(fileText) {
  const a = rulesBlockArrangement(fileText || "");
  if (a.kind !== "one") return null;
  return a.lines.slice(a.i, a.j + 1).join("");
}

const trimLine = (line, max) => {
  const chars = [...line];
  return chars.length <= max ? line : chars.slice(0, max - 1).join("") + "…";
};

/** Fit the SessionStart brief to `cap` bytes by shortening LISTS, never by cutting text.
 *
 *  `parts` is buildBriefParts()'s: escaped strings (every obligation, warning and standing
 *  instruction) with one `{lists}` slot. `plain` is the same brief with every list in full. A brief
 *  at or under the cap is returned as `plain`, byte for byte. Over it, each list starts at its own
 *  cap (most recent releases, first five of the others, every item line trimmed to BRIEF_ITEM_MAX
 *  characters) with a visible `(+N more — see <where it lives>)` line; if the total is still over,
 *  the list contributing the most bytes loses one more item, repeatedly, down to its heading and
 *  overflow line. Only when every list is at that floor and the brief is still over does it stay
 *  over: the remaining text is obligations, which are never cut, and the marker says so.
 *
 *  `prefix` is one line placed first (the runtime-support floor), counted in the total.
 *  Returns `{text, truncated, overCap, bytes, originalBytes}`; `truncated` means some list was
 *  shortened, `overCap` means obligations alone exceed the cap. */
export function fitBrief(parts, { plain, cap = BRIEF_BYTE_CAP, prefix = "" } = {}) {
  const lead = prefix ? prefix + "\n" : "";
  const original = lead + plain;
  const originalBytes = byteSize(original);
  if (originalBytes <= cap) return { text: original, truncated: false, overCap: false, bytes: originalBytes, originalBytes };

  const where = `Full text: PROJECT.md "Briefing"`;
  const trimMarker = `[pm brief: ${originalBytes} bytes uncapped, ${originalBytes - cap} over the ${cap}-byte cap. ` +
    `The lists above were shortened (each says what it omits and where it lives); every warning and ` +
    `obligation block is whole. ${where}]`;
  const overMarker = `[pm brief: ${originalBytes} bytes uncapped, over the ${cap}-byte cap, and the warnings and ` +
    `obligation blocks alone exceed it. They are never cut, so this brief is sent over the cap; the ` +
    `lists were shortened as far as they go. ${where}]`;

  const slot = parts.find(x => x && typeof x === "object" && Array.isArray(x.lists));
  const lists = slot ? slot.lists : [];
  const counts = lists.map(l => Math.min(l.items.length, l.boundedCap));
  const renderList = (l, n) => {
    const shown = l.fromEnd ? l.items.slice(l.items.length - n) : l.items.slice(0, n);
    const out = [l.heading];
    for (const item of shown) for (const line of item) out.push(trimLine(line, BRIEF_ITEM_MAX));
    if (l.items.length > n) out.push(l.more(l.items.length - n));
    out.push("");
    return out;
  };
  const build = (marker) => {
    const lines = [];
    for (const x of parts) {
      if (typeof x === "string") lines.push(x);
      else if (x === slot) {
        lists.forEach((l, i) => lines.push(...renderList(l, counts[i])));
        lines.push(marker, "");
      }
    }
    return lead + lines.join("\n");
  };
  const sizeOf = (i) => byteSize(renderList(lists[i], counts[i]).join("\n"));
  let text = build(trimMarker);
  while (byteSize(text) > cap) {
    let pick = -1;
    for (let i = 0; i < lists.length; i++) {
      if (counts[i] > 0 && (pick === -1 || sizeOf(i) > sizeOf(pick))) pick = i;
    }
    if (pick === -1) break;
    counts[pick] -= 1;
    text = build(trimMarker);
  }
  const overCap = byteSize(text) > cap;
  if (overCap) text = build(overMarker);
  return { text, truncated: true, overCap, bytes: byteSize(text), originalBytes };
}

/** The two report lines, one per cost. `block` is `{bytes, tokens}` or null (no block found); `brief` is
 *  fitBrief()'s result. Printed by `upgrade` and by the `render` verb (/pm:status). */
export function sessionCostLines({ file, block, brief, cap }) {
  const first = block
    ? `conductor: rules block (${file}): ${block.bytes} bytes, ~${block.tokens} tokens (bytes/4) — paid by every session and every dispatched agent`
    : `conductor: rules block (${file}): none found`;
  const second = brief.overCap
    ? `conductor: SessionStart brief: ${brief.bytes} of ${brief.originalBytes} bytes sent (~${estimateTokens(brief.bytes)} tokens), OVER the ${cap}-byte cap — its warnings and obligation blocks alone exceed it and are never cut; the lists were shortened as far as they go`
    : brief.truncated
    ? `conductor: SessionStart brief: ${brief.bytes} of ${brief.originalBytes} bytes sent (~${estimateTokens(brief.bytes)} tokens), long lists shortened to fit the ${cap}-byte cap (each names where the rest is); every warning and obligation block is whole — full text in PROJECT.md`
    :`conductor: SessionStart brief: ${brief.bytes} bytes (~${estimateTokens(brief.bytes)} tokens), under the ${cap}-byte cap`;
  return [first, second];
}

/** The ranked per-section table behind `rules --sections`: heading, bytes, share. Largest first, then a total. */
export function sectionTableLines(measured) {
  const rows = measured.sections.map(s => {
    const pct = ((s.bytes / measured.bytes) * 100).toFixed(1).padStart(5);
    return `${String(s.bytes).padStart(7)} bytes  ${pct}%  ${s.heading}`;
  });
  rows.push(`total ${measured.bytes} bytes, ~${measured.tokens} tokens (bytes/4)`);
  return rows;
}
