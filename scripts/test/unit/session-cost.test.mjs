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

const OB = (tag) => `OBLIGATION ${tag}`;
const list = (heading, n, { width = 60, boundedCap = 5, fromEnd = false, where = "PROJECT.md" } = {}) => ({
  heading, boundedCap, fromEnd,
  items: Array.from({ length: n }, (_, i) => [`  - ${heading}-${i} ${"x".repeat(width)}`]),
  more: (k) => `  (+${k} more - see ${where})`,
});
const partsOf = (lists, { obligation = 3, tailLines = ["RULES reminder"] } = {}) => [
  "HEAD line", "",
  ...Array.from({ length: obligation }, (_, i) => OB(i)), "",
  { lists },
  ...tailLines,
];
/** The plain text a caller would hold: obligations, then every list in full. */
const plainOf = (parts) => parts.flatMap(x => typeof x === "string" ? [x]
  : x.lists.flatMap(l => [l.heading, ...l.items.flat(), ""])).join("\n");

unitTest("a brief at or under the cap is sent as the plain text, byte for byte, and not marked", async () => {
  const { fitBrief } = await load();
  const parts = partsOf([list("A", 2)]);
  const plain = plainOf(parts);
  const r = fitBrief(parts, { plain, cap: 100000 });
  assert.deepEqual(r, { text: plain, truncated: false, overCap: false, bytes: bytes(plain), originalBytes: bytes(plain) });
  assert.equal(fitBrief(parts, { plain, cap: bytes(plain) }).truncated, false, "exactly at the cap is under it");
});

unitTest("over the cap, lists are bounded with a visible overflow line and every obligation line survives", async () => {
  const { fitBrief } = await load();
  const parts = partsOf([list("RELEASES", 40, { fromEnd: true, boundedCap: 3, where: 'PROJECT.md "Releases"' }), list("LINKS", 40)]);
  const plain = plainOf(parts);
  const r = fitBrief(parts, { plain, cap: 2000 });
  assert.equal(r.truncated, true);
  assert.equal(r.overCap, false);
  assert.ok(bytes(r.text) <= 2000, `sent ${bytes(r.text)}`);
  assert.equal(r.bytes, bytes(r.text));
  assert.equal(r.originalBytes, bytes(plain));
  for (let i = 0; i < 3; i++) assert.ok(r.text.includes(OB(i)), "an obligation line was cut");
  assert.match(r.text, /RELEASES-39 /, "the MOST RECENT releases are the ones kept");
  assert.doesNotMatch(r.text, /RELEASES-0 /);
  assert.match(r.text, /\(\+37 more - see PROJECT\.md "Releases"\)/, "the overflow line names where the rest is and how many");
  assert.match(r.text, /RULES reminder$/, "the closing instructions are last and intact");
});

unitTest("the marker's arithmetic is total minus cap, and its pointer is the one PROJECT.md section that holds the text", async () => {
  const { fitBrief } = await load();
  const parts = partsOf([list("A", 60)]);
  const plain = plainOf(parts);
  const r = fitBrief(parts, { plain, cap: 1500 });
  const m = /\[pm brief: (\d+) bytes uncapped, (\d+) over the 1500-byte cap/.exec(r.text);
  assert.ok(m, r.text);
  assert.equal(Number(m[1]), bytes(plain));
  assert.equal(Number(m[2]), bytes(plain) - 1500, "bytes over the cap is total minus cap, not the total");
  assert.match(r.text, /PROJECT\.md "Briefing"/);
});

unitTest("when the total is still over the cap the biggest list is trimmed further, never an obligation block", async () => {
  const { fitBrief } = await load();
  const parts = partsOf([list("BIG", 5, { width: 400, boundedCap: 5 }), list("SMALL", 5, { width: 10, boundedCap: 5 })], { obligation: 2 });
  const plain = plainOf(parts);
  const loose = fitBrief(parts, { plain, cap: 1500 });
  const tight = fitBrief(parts, { plain, cap: 900 });
  assert.ok(bytes(tight.text) < bytes(loose.text));
  assert.ok(bytes(tight.text) <= 900, `sent ${bytes(tight.text)}`);
  assert.ok(tight.text.includes(OB(0)) && tight.text.includes(OB(1)));
  assert.match(tight.text, /SMALL-0 /, "the small list is untouched while the big one gives way");
});

unitTest("obligations alone over the cap are emitted whole and the brief says so", async () => {
  const { fitBrief } = await load();
  const parts = partsOf([list("A", 10)], { obligation: 80 });
  const plain = plainOf(parts);
  const r = fitBrief(parts, { plain, cap: 600 });
  assert.equal(r.overCap, true);
  assert.ok(bytes(r.text) > 600, "over the cap, deliberately");
  for (let i = 0; i < 80; i++) assert.ok(r.text.includes(OB(i)), `obligation ${i} was cut`);
  assert.match(r.text, /obligation blocks alone exceed it\. They are never cut/);
  assert.match(r.text, /A\n\s+\(\+10 more/, "the list is down to its heading and overflow line");
});

unitTest("a list item longer than BRIEF_ITEM_MAX is trimmed on a character boundary with an ellipsis", async () => {
  const { fitBrief, BRIEF_ITEM_MAX } = await load();
  const parts = partsOf([{ heading: "L:", boundedCap: 5, fromEnd: false, items: [["  - " + "—".repeat(2000)]], more: () => "" }]);
  const r = fitBrief(parts, { plain: plainOf(parts), cap: 1200 });
  const line = r.text.split("\n").find(l => l.startsWith("  - "));
  assert.equal([...line].length, BRIEF_ITEM_MAX);
  assert.ok(line.endsWith("…"));
  assert.ok(!r.text.includes("�"));
});

unitTest("a prefix line (the runtime-support floor) leads the brief and counts against the cap", async () => {
  const { fitBrief } = await load();
  const parts = partsOf([list("A", 4)]);
  const plain = plainOf(parts);
  const r = fitBrief(parts, { plain, cap: 100000, prefix: "FLOOR line" });
  assert.ok(r.text.startsWith("FLOOR line\n"));
  assert.equal(r.originalBytes, bytes("FLOOR line\n" + plain));
});

unitTest("the cap is a named constant, large enough for the head of a real brief and far below a fleet-worst one", async () => {
  const { BRIEF_BYTE_CAP } = await load();
  assert.equal(BRIEF_BYTE_CAP, 16384);
});

unitTest("session cost lines: one line for the block, one for the brief, each saying what a session pays", async () => {
  const { sessionCostLines } = await load();
  const lines = sessionCostLines({
    file: "CLAUDE.md", block: { bytes: 40087, tokens: 10022 },
    brief: { originalBytes: 78276, bytes: 8242, truncated: true, overCap: false }, cap: 16384,
  });
  assert.equal(lines.length, 2);
  assert.match(lines[0], /rules block \(CLAUDE\.md\): 40087 bytes, ~10022 tokens/);
  assert.match(lines[1], /SessionStart brief: 8242 of 78276 bytes sent \(~2061 tokens\), long lists shortened to fit the 16384-byte cap.*every warning and obligation block is whole/);
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
