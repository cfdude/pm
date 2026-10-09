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
 *  ~1.7 KB. PROJECT.md embeds the same text uncapped, so nothing is lost by cutting it here. */
export const BRIEF_BYTE_CAP = 16384;

/** The closing paragraphs of the brief (lifecycle-marker reminder, the one-paragraph RULES reminder,
 *  the "Manage with" line) are the standing instructions; a cut that ate them would drop the part of
 *  the brief an agent most needs. They are kept after the marker, up to this many bytes. */
const TAIL_PARAGRAPHS = 3;
const TAIL_MAX_BYTES = 2048;

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

function cutToBytes(text, maxBytes) {
  if (maxBytes <= 0) return "";
  const lines = text.split(/(?<=\n)/);
  let out = "";
  for (const line of lines) {
    if (byteSize(out) + byteSize(line) > maxBytes) break;
    out += line;
  }
  if (out) return out;
  // Not even one whole line fits: cut inside it, on a character boundary.
  let cut = Buffer.from(text, "utf8").subarray(0, maxBytes).toString("utf8");
  while (cut.endsWith("�")) cut = cut.slice(0, -1);
  return cut;
}

/** Cap the SessionStart brief at `cap` bytes. Never silent: a cut brief carries a marker line that says
 *  how much was over and where the full text lives. Over the cap, the output is the head (whole lines),
 *  the marker, then the closing paragraphs. `{text, truncated, bytes, originalBytes}`. */
export function capBrief(text, cap = BRIEF_BYTE_CAP) {
  const originalBytes = byteSize(text);
  if (originalBytes <= cap) return { text, truncated: false, bytes: originalBytes, originalBytes };

  const marker =
    `[pm brief truncated: ${originalBytes} bytes over the ${cap}-byte cap; the middle is omitted. ` +
    `Full text: run \`/pm:status\` and read the "Briefing" section of PROJECT.md]`;
  const paragraphs = text.replace(/\n+$/, "").split("\n\n");
  let tail = paragraphs.length > TAIL_PARAGRAPHS ? paragraphs.slice(-TAIL_PARAGRAPHS).join("\n\n") : "";
  if (byteSize(tail) > TAIL_MAX_BYTES) tail = "";
  const tailPart = tail ? `\n\n${tail}\n` : "\n";
  let budget = cap - byteSize(marker) - byteSize(tailPart) - 1;
  if (budget < 0 && tail) {
    tail = "";
    budget = cap - byteSize(marker) - 2;
  }
  const head = cutToBytes(text, budget).replace(/\n+$/, "");
  const out = `${head ? head + "\n\n" : ""}${marker}${tail ? `\n\n${tail}\n` : "\n"}`;
  return { text: out, truncated: true, bytes: byteSize(out), originalBytes };
}

/** The two report lines, one per cost. `block` is `{bytes, tokens}` or null (no block found); `brief` is
 *  capBrief()'s result. Printed by `upgrade` and by the `render` verb (/pm:status). */
export function sessionCostLines({ file, block, brief, cap }) {
  const first = block
    ? `conductor: rules block (${file}): ${block.bytes} bytes, ~${block.tokens} tokens (bytes/4) — paid by every session and every dispatched agent`
    : `conductor: rules block (${file}): none found`;
  const second = brief.truncated
    ? `conductor: SessionStart brief: ${brief.bytes} of ${brief.originalBytes} bytes sent (~${estimateTokens(brief.bytes)} tokens), truncated at the ${cap}-byte cap — full text in PROJECT.md`
    : `conductor: SessionStart brief: ${brief.bytes} bytes (~${estimateTokens(brief.bytes)} tokens), under the ${cap}-byte cap`;
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
