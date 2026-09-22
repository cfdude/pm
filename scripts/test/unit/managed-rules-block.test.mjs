// scripts/test/unit/managed-rules-block.test.mjs
// 4.1's migration of `assert/managed-rules-block.test.mjs` — 1 of its 11 tests, moved from the file
// rung to the unit rung with every assertion unchanged.
//
// state-file-refuses-to-guess, capability `managed-rules-block`: how the engine locates, replaces
// and refuses to replace its managed block inside a HUMAN-OWNED rules file. On 0.43.0 the markers
// were matched as substrings and the block spliced in with a string replacement, so `write-rules`
// deleted a hand-written section above a prose mention of the BEGIN marker and printed `refreshed`.
//
// WHY ONLY ONE MOVED. TEN of the eleven are about the FILE: they write a CLAUDE.md, a `.gitignore`
// or a raw `state.json` by hand and then assert the file's BYTES — a hand-written sentinel surviving
// a refresh, CRLF preserved, an upgrade that must write nothing at all, an init that must create no
// `.conductor/` directory. That is the whole subject of the capability, and CLAUDE.md is the file the
// store does not own (this migration's edge 3).
//
// THE ONE THAT MOVED is a pure-function test: `rulesBlockArrangement()` takes a STRING and returns
// the arrangement it found, including the four marker rules the Gate-2 review pinned — END before
// BEGIN is ambiguous, a BEGIN without its `-->` is content, an END with trailing spaces is content,
// and a CRLF terminator is not part of the marker. No file, no repository, no store.

import assert from "node:assert/strict";
import { unitTest } from "../fixtures/unit-harness.mjs";

const BEGIN = "<!-- BEGIN pm-conductor rules (managed by pm — safe to delete this block) -->";
const END = "<!-- END pm-conductor rules -->";

// ─────────────── G2-I5 — the parser's marker rules, each pinned ───────────────

unitTest("G2-I5 parser: END before BEGIN is refused, a BEGIN without its --> and an END with trailing spaces are content", async () => {
  const { rulesBlockArrangement } = await import("../../lib/rules.mjs");
  const reversed = rulesBlockArrangement(`# x\n${END}\nbody\n${BEGIN}\n`);
  assert.equal(reversed.kind, "ambiguous", "END before BEGIN is not one block");
  assert.deepEqual(reversed.markers, [{ line: 2, kind: "END" }, { line: 4, kind: "BEGIN" }]);

  const unclosed = rulesBlockArrangement("# x\n<!-- BEGIN pm-conductor rules (managed by pm\nbody\n");
  assert.equal(unclosed.kind, "none", "a BEGIN line that does not end with --> is not a marker");

  const spaced = rulesBlockArrangement(`# x\n${BEGIN}\nbody\n${END}   \n`);
  assert.equal(spaced.kind, "ambiguous", "an END line with trailing spaces is not the END marker, so BEGIN is orphaned");
  assert.deepEqual(spaced.markers, [{ line: 2, kind: "BEGIN" }]);

  const crlf = rulesBlockArrangement(`# x\r\n${BEGIN}\r\nbody\r\n${END}\r\n`);
  assert.equal(crlf.kind, "one", "a CRLF terminator is not part of the marker");
});
