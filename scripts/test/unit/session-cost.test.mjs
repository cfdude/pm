// scripts/test/unit/session-cost.test.mjs
// rules-block-session-cost — the pure half: measuring the managed rules block and capping the
// SessionStart brief. Values in, values out; nothing here touches a file.

import assert from "node:assert/strict";
import { unitTest } from "../fixtures/unit-harness.mjs";

const load = () => import(new URL("../../lib/session-cost.mjs", import.meta.url).href);
const bytes = (s) => Buffer.byteLength(s, "utf8");

unitTest("tokens are bytes/4 rounded up, and sizes are UTF-8 bytes, not characters", async () => {
  const { estimateTokens, byteSize } = await load();
  assert.equal(estimateTokens(0), 0);
  assert.equal(estimateTokens(1), 1);
  assert.equal(estimateTokens(4), 1);
  assert.equal(estimateTokens(40087), 10022);
  assert.equal(byteSize("—"), 3, "an em dash is three bytes");
});

const BLOCK = [
  "<!-- BEGIN pm-conductor rules (managed by pm — safe to delete this block) -->",
  "## First",
  "aaaa",
  "",
  "## Second section",
  "b".repeat(200),
  "cccc",
  "",
  "## Third",
  "<!-- END pm-conductor rules -->",
].join("\n") + "\n";

unitTest("a block splits into its ## sections and the sizes sum to the whole, markers included", async () => {
  const { rulesBlockSections } = await load();
  const sections = rulesBlockSections(BLOCK);
  assert.deepEqual(sections.map(s => s.heading), ["First", "Second section", "Third"]);
  assert.equal(sections.reduce((n, s) => n + s.bytes, 0), bytes(BLOCK), "no byte is unaccounted for");
  assert.ok(sections[0].bytes > bytes("## First\naaaa\n\n"), "the BEGIN marker belongs to the first section");
  assert.ok(sections[2].bytes > bytes("## Third\n"), "the END marker belongs to the last section");
});

unitTest("a block with no ## heading is one unnamed section; an empty block has none", async () => {
  const { rulesBlockSections } = await load();
  assert.deepEqual(rulesBlockSections("just text\n"), [{ heading: "(no heading)", bytes: 10 }]);
  assert.deepEqual(rulesBlockSections(""), []);
});

unitTest("measureRulesBlock reports bytes, tokens and sections ranked largest first with stable ties", async () => {
  const { measureRulesBlock } = await load();
  const m = measureRulesBlock(BLOCK);
  assert.equal(m.bytes, bytes(BLOCK));
  assert.equal(m.tokens, Math.ceil(bytes(BLOCK) / 4));
  assert.equal(m.sections[0].heading, "Second section");
  for (let i = 1; i < m.sections.length; i++) assert.ok(m.sections[i - 1].bytes >= m.sections[i].bytes);
});

unitTest("a heading inside a fenced example is still a section boundary only at line start", async () => {
  const { rulesBlockSections } = await load();
  const s = rulesBlockSections("## A\nsee `## not a heading` inline\n## B\n");
  assert.deepEqual(s.map(x => x.heading), ["A", "B"]);
});

unitTest("onDiskRulesBlock lifts exactly the marked lines out of a file and is null when there is none", async () => {
  const { onDiskRulesBlock } = await load();
  const file = `# CLAUDE.md\n\nhand written\n\n${BLOCK}\nafter\n`;
  assert.equal(onDiskRulesBlock(file), BLOCK);
  assert.equal(onDiskRulesBlock("# no block here\n"), null);
  assert.equal(onDiskRulesBlock(`${BLOCK}${BLOCK}`), null, "an ambiguous arrangement is not measured, never guessed at");
});

const para = (tag, n) => `${tag} ${"x".repeat(n)}`;
const longBrief = () => [
  "HEAD line one", "HEAD line two", "",
  ...Array.from({ length: 200 }, (_, i) => para(`middle-${i}`, 60)), "",
  "LIFECYCLE reminder", "",
  "RULES reminder", "",
  "Manage with /pm:status",
].join("\n");

unitTest("a brief at or under the cap passes through byte-for-byte and is not marked truncated", async () => {
  const { capBrief } = await load();
  const text = "short brief\n";
  assert.deepEqual(capBrief(text, 1000), { text, truncated: false, bytes: bytes(text), originalBytes: bytes(text) });
  assert.equal(capBrief(text, bytes(text)).truncated, false, "exactly at the cap is under it");
});

unitTest("an over-cap brief is cut on a line boundary, within the cap, with a visible marker naming where the rest lives", async () => {
  const { capBrief } = await load();
  const input = longBrief();
  const r = capBrief(input, 4096);
  assert.equal(r.truncated, true);
  assert.ok(bytes(r.text) <= 4096, `capped output is ${bytes(r.text)} bytes`);
  assert.equal(r.bytes, bytes(r.text));
  assert.equal(r.originalBytes, bytes(input));
  assert.match(r.text, /^HEAD line one\nHEAD line two\n/, "the head survives");
  assert.match(r.text, /\[pm brief truncated: \d+ bytes over the 4096-byte cap/);
  assert.match(r.text, /PROJECT\.md/, "the marker names where the full text is");
  assert.match(r.text, /\/pm:status/);
  for (const line of r.text.split("\n").filter(l => l.startsWith("middle-"))) assert.match(line, /^middle-\d+ x{60}$/, "no line is cut mid-way");
});

unitTest("the closing reminder paragraphs are kept after the marker, so the standing rules are never the part dropped", async () => {
  const { capBrief } = await load();
  const r = capBrief(longBrief(), 4096);
  const markerAt = r.text.indexOf("[pm brief truncated");
  assert.ok(markerAt > 0);
  const after = r.text.slice(markerAt);
  assert.match(after, /LIFECYCLE reminder/);
  assert.match(after, /RULES reminder/);
  assert.match(after, /Manage with \/pm:status\n$/);
});

unitTest("a tail too large to keep is dropped rather than blowing the cap", async () => {
  const { capBrief } = await load();
  const input = ["head", "", "a".repeat(5000), "", "b".repeat(5000), "", "c".repeat(5000)].join("\n");
  const r = capBrief(input, 1024);
  assert.ok(bytes(r.text) <= 1024);
  assert.match(r.text, /\[pm brief truncated/);
});

unitTest("a single line longer than the budget is cut on a character boundary, never mid-codepoint", async () => {
  const { capBrief } = await load();
  const r = capBrief("—".repeat(5000), 1024);
  assert.ok(bytes(r.text) <= 1024);
  assert.ok(!r.text.includes("�"), "no replacement character from a split codepoint");
  assert.match(r.text, /\[pm brief truncated/);
});

unitTest("the cap is a named constant, large enough for the head of a real brief and far below a fleet-worst one", async () => {
  const { BRIEF_BYTE_CAP } = await load();
  assert.equal(BRIEF_BYTE_CAP, 16384);
});

unitTest("session cost lines: one line for the block, one for the brief, each saying what a session pays", async () => {
  const { sessionCostLines } = await load();
  const lines = sessionCostLines({
    file: "CLAUDE.md", block: { bytes: 40087, tokens: 10022 },
    brief: { originalBytes: 78276, bytes: 16384, truncated: true }, cap: 16384,
  });
  assert.equal(lines.length, 2);
  assert.match(lines[0], /rules block \(CLAUDE\.md\): 40087 bytes, ~10022 tokens/);
  assert.match(lines[1], /SessionStart brief: 16384 of 78276 bytes sent \(~4096 tokens\), truncated at the 16384-byte cap/);
  const ok = sessionCostLines({
    file: "AGENTS.md", block: { bytes: 100, tokens: 25 },
    brief: { originalBytes: 800, bytes: 800, truncated: false }, cap: 16384,
  });
  assert.match(ok[1], /SessionStart brief: 800 bytes \(~200 tokens\), under the 16384-byte cap/);
});

unitTest("session cost lines say so when there is no managed block to measure", async () => {
  const { sessionCostLines } = await load();
  const lines = sessionCostLines({
    file: "CLAUDE.md", block: null,
    brief: { originalBytes: 10, bytes: 10, truncated: false }, cap: 16384,
  });
  assert.match(lines[0], /rules block \(CLAUDE\.md\): none found/);
});

unitTest("the section table lists every section ranked, with bytes and share of the block", async () => {
  const { measureRulesBlock, sectionTableLines } = await load();
  const lines = sectionTableLines(measureRulesBlock(BLOCK));
  assert.equal(lines.length, 3 + 1, "one row per section plus the total");
  assert.match(lines[0], /Second section/);
  assert.match(lines[lines.length - 1], /total .*\b\d+ bytes/);
});
