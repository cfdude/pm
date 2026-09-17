// user-text-never-forges-output — a value the engine did not write never begins a line of output,
// never adds or splits a PROJECT.md table cell, and an identifier holding a control character is
// never stored (design.md D0–D8; spec output-text-integrity).
//
// TOOL TRAP (this file is ALL about control characters): no raw control character and no literal
// backslash-u escape text is ever typed into this source. Every such string is BUILT from parts —
// `String.fromCharCode` for the characters, `BS + "u" + hex` for the escape text the engine prints —
// so `rg -n '[\x00-\x08\x0b-\x1f\x7f]' scripts/` and `rg -n '[^\x00-\x7f]'` over this file find only
// what is intended.
import "./hermetic-git.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

const lib = (name) => new URL(`../lib/${name}`, import.meta.url).href;

// ═══════════════════════════════ building blocks ═══════════════════════════════

export const ch = (code) => String.fromCharCode(code);
export const BS = ch(0x5c);
export const LF = ch(0x0a);
export const CR = ch(0x0d);
export const NEL = ch(0x85);
export const LS = ch(0x2028);
export const PS = ch(0x2029);
/** The escape text escapeControls() prints for one character: backslash, `u`, four lowercase hex. */
export const escOf = (code) => BS + "u" + code.toString(16).padStart(4, "0");

/** Every control character of the spec's class: C0, DEL, C1, U+2028, U+2029. */
export const CONTROL_CODES = [
  ...Array.from({ length: 0x20 }, (_, i) => i),
  ...Array.from({ length: 0x9f - 0x7f + 1 }, (_, i) => 0x7f + i),
  0x2028, 0x2029,
];

/** A table row's cells as GitHub-flavored Markdown splits them: a backslash escapes the ONE
 *  character after it, and only an unescaped `|` delimits. The leading and trailing pipe are
 *  the row's edges, not cells. */
export function gfmCells(row) {
  const t = row.trim();
  const cells = [];
  let cur = "", endedOnDelimiter = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    endedOnDelimiter = false;
    if (c === BS && i + 1 < t.length) { cur += c + t[i + 1]; i++; continue; }
    if (c === "|") { cells.push(cur); cur = ""; endedOnDelimiter = true; continue; }
    cur += c;
  }
  if (!endedOnDelimiter) cells.push(cur);
  if (t.startsWith("|")) cells.shift();
  return cells;
}

// ═══════════════════════════════ 1. the two escapers ═══════════════════════════════

test("1.2 escapeTableCell escapes every control character as escapeControls does, then backslashes, then pipes", async () => {
  const { escapeControls, escapeTableCell } = await import(lib("constants.mjs"));
  assert.equal(typeof escapeTableCell, "function", "constants.mjs must export escapeTableCell beside escapeControls");
  for (const code of CONTROL_CODES) {
    const line = escapeControls(ch(code));
    assert.equal(line, escOf(code), `escapeControls renders U+${code.toString(16)} as its escape`);
    // Then the backslash of that escape is doubled, so the raw cell holds two and renders one.
    assert.equal(escapeTableCell(ch(code)), BS + BS + "u" + code.toString(16).padStart(4, "0"),
      `escapeTableCell renders U+${code.toString(16)} as escapeControls does, backslash doubled`);
  }
  // `a\|b`: the backslash first, then the pipe, so GFM reads ONE cell displaying `a\|b`.
  const aBsPipeB = "a" + BS + "|b";
  const cell = escapeTableCell(aBsPipeB);
  assert.equal(cell, "a" + BS + BS + BS + "|b");
  assert.deepEqual(gfmCells(`| ${cell} |`), [` ${cell} `], "the escaped value is exactly one GFM cell");
  // The pipe-only escape the Dispositions table used to apply splits the same value.
  const pipeOnly = aBsPipeB.replace(/\|/g, BS + "|");
  assert.equal(gfmCells(`| ${pipeOnly} |`).length, 2, "a pipe-only escape of a backslash-pipe value splits the cell");
  assert.equal(escapeTableCell("plain text"), "plain text");
  assert.equal(escapeTableCell("x | y"), "x " + BS + "| y");
});

test("1.2 escapeControls is idempotent over its own output", async () => {
  const { escapeControls } = await import(lib("constants.mjs"));
  const all = CONTROL_CODES.map(ch).join("FORGED");
  const once = escapeControls(all);
  assert.equal(escapeControls(once), once);
  assert.equal(/[\x00-\x1f\x7f-\x9f]/.test(once) || once.includes(LS) || once.includes(PS), false,
    "escapeControls output holds no control character");
});
