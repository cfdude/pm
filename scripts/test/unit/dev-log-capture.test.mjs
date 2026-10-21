// scripts/test/unit/dev-log-capture.test.mjs
// developer-session-log 1.3 / 1.4 -- the pure collector (composition from in-memory transcript lines), the stored
// entry allowlist, and the append's de-duplication and features-snapshot diff, the last over an injected file
// system. No file is opened.

import assert from "node:assert/strict";
import path from "node:path";
import { unitTest } from "../fixtures/unit-harness.mjs";
import {
  COMPACTION_FIELDS, MESSAGE_FIELDS, appendDevLog, feedLine, finishRead, newCollector, storedEntry,
} from "../../lib/dev-log-capture.mjs";

const SENTINEL = "SENTINEL-7f3a";
const ts = (sec) => new Date(Date.UTC(2026, 9, 9, 10, 0, sec)).toISOString();
const j = (o) => JSON.stringify(o);
const asst = (id, sec, content, extra = {}) =>
  j({ type: "assistant", timestamp: ts(sec), sessionId: "sA", message: { id, model: "m", content, usage: {} }, ...extra });
const userStr = (s) => j({ type: "user", message: { content: s } });
const userBlocks = (blocks, extra = {}) => j({ type: "user", message: { content: blocks }, ...extra });
const ctx = { actor: "orchestrator", agentId: null, sessionId: "sA" };
const run = (lines, carry, c = ctx) => {
  const col = newCollector(carry, c);
  for (const l of lines) feedLine(col, l);
  return finishRead(col);
};

unitTest("1.3 tool results are sized per tool, the name resolved from the tool_use id", () => {
  const r = run([
    asst("m0", 1, [{ type: "tool_use", id: "t1", name: "Read", input: {} }, { type: "tool_use", id: "t2", name: "Bash", input: {} }]),
    userBlocks([
      { type: "tool_result", tool_use_id: "t1", content: "x".repeat(1200) },
      { type: "tool_result", tool_use_id: "t2", content: [{ type: "text", text: "y".repeat(300) }] },
    ]),
    asst("m1", 2, [{ type: "text", text: "ok" }]),
  ]);
  const m1 = r.entries.find((e) => e.messageId === "m1");
  assert.deepEqual(m1.toolResults, { Read: 1200, Bash: 300 });
});

unitTest("1.3 user text, attachments and an image count are the request's delta, attached once", () => {
  const r = run([
    userStr("héllo"),   // 6 bytes: the e-acute is two
    userBlocks([{ type: "text", text: "abc" }, { type: "image", source: {} }]),
    j({ type: "attachment", attachment: { type: "date", date: "2026-10-09" } }),
    userStr("meta reminder").replace('"user"', '"user","isMeta":true'),
    asst("m1", 1, [{ type: "text", text: "a" }]),
    asst("m2", 2, [{ type: "text", text: "b" }]),
  ]);
  const [m1, m2] = r.entries;
  assert.equal(m1.userText, 6 + 3);
  assert.equal(m1.images, 1);
  assert.equal(m1.attachments, Buffer.byteLength(JSON.stringify({ type: "date", date: "2026-10-09" })) + "meta reminder".length);
  assert.deepEqual([m2.userText, m2.images, m2.attachments, m2.toolResults], [0, 0, 0, {}], "a second message in a row owes no request delta");
});

unitTest("1.3 one API message spread over three entries sums its text and thinking bytes", () => {
  const r = run([
    asst("m1", 1, [{ type: "thinking", thinking: "t".repeat(40) }]),
    asst("m1", 2, [{ type: "text", text: "x".repeat(10) }]),
    asst("m1", 3, [{ type: "text", text: "y".repeat(5) }, { type: "tool_use", id: "t1", name: "Bash", input: {} }]),
  ]);
  assert.equal(r.entries.length, 1);
  assert.equal(r.entries[0].thinkingBytes, 40);
  assert.equal(r.entries[0].textBytes, 15);
});

unitTest("1.3 a request that straddles two ingests keeps its bytes and its tool names through the carry", () => {
  const first = run([
    asst("m0", 1, [{ type: "tool_use", id: "t1", name: "Read", input: {} }]),
    userBlocks([{ type: "tool_result", tool_use_id: "t1", content: "r".repeat(77) }]),
    userStr("pending prompt"),
  ]);
  assert.deepEqual(first.entries.map((e) => e.messageId), ["m0"]);
  assert.deepEqual(first.carry.pending.toolResults, { Read: 77 }, "the cursor carries the pending bytes");
  // A second ingest resumes: the id->name map for a result that arrives later also rode in the carry.
  const carried = JSON.parse(JSON.stringify(first.carry));
  const second = run([asst("m1", 3, [{ type: "text", text: "z" }])], carried);
  assert.equal(second.entries[0].toolResults.Read, 77);
  assert.equal(second.entries[0].userText, "pending prompt".length);
  // and a tool_use in the first read resolves a result in the second
  const a = run([asst("m0", 1, [{ type: "tool_use", id: "t9", name: "Grep", input: {} }])]);
  const b = run([userBlocks([{ type: "tool_result", tool_use_id: "t9", content: "q".repeat(5) }]), asst("m1", 2, [])], JSON.parse(JSON.stringify(a.carry)));
  assert.deepEqual(b.entries[0].toolResults, { Grep: 5 });
});

unitTest("1.3 a result for an id the collector never saw is reported under `unknown`", () => {
  const r = run([userBlocks([{ type: "tool_result", tool_use_id: "nope", content: "abc" }]), asst("m1", 1, [])]);
  assert.deepEqual(r.entries[0].toolResults, { unknown: 3 });
});

unitTest("1.3 a compact_boundary system entry is a compaction entry carrying numbers only", () => {
  const r = run([
    j({ type: "system", subtype: "compact_boundary", timestamp: ts(5), sessionId: "sA", content: SENTINEL,
      compactMetadata: { trigger: "auto", preTokens: 150000, postTokens: 12000, preservedSegment: SENTINEL } }),
  ]);
  assert.deepEqual(r.entries, [{ type: "compaction", sessionId: "sA", at: ts(5), trigger: "auto", preTokens: 150000, postTokens: 12000 }]);
});

unitTest("1.3 entries older than enabledAt are dropped and counted; malformed lines are ignored", () => {
  const r = run(["not json", "", asst("old", 1, []), asst("new", 100, [])], null, { ...ctx, enabledAtMs: Date.parse(ts(50)) });
  assert.deepEqual(r.entries.map((e) => e.messageId), ["new"]);
  assert.equal(r.beforeEnabled, 1);
});

unitTest("1.3 a sidechain entry in a main file is attributed to its sub-agent id", () => {
  const r = run([asst("s1", 1, [], { isSidechain: true, agentId: "ag7" })]);
  assert.equal(r.entries[0].agentId, "ag7");
  assert.equal(run([asst("s1", 1, [])], null, { actor: "subagent", agentId: "FILE", sessionId: "sA" }).entries[0].agentId, "FILE");
});

unitTest("1.3 SENTINEL text anywhere in a transcript never reaches a stored entry or the carry", () => {
  const r = run([
    userStr(`${SENTINEL} prompt`),
    j({ type: "attachment", attachment: { note: SENTINEL } }),
    asst("m0", 1, [{ type: "tool_use", id: "t1", name: "Bash", input: { command: `echo ${SENTINEL}` } }, { type: "thinking", thinking: SENTINEL }]),
    userBlocks([{ type: "tool_result", tool_use_id: "t1", content: `out ${SENTINEL}` }]),
    asst("m1", 2, [{ type: "text", text: SENTINEL }]),
  ]);
  const stored = r.entries.map((e) => JSON.stringify(storedEntry(e))).join("\n");
  assert.ok(!stored.includes(SENTINEL));
  assert.ok(!JSON.stringify(r.carry).includes(SENTINEL));
  for (const e of r.entries) assert.deepEqual(Object.keys(storedEntry(e)), MESSAGE_FIELDS.slice());
});

unitTest("1.3 the stored entry allowlists are closed", () => {
  assert.deepEqual(Object.keys(storedEntry({ type: "message", messageId: "a", extra: SENTINEL })), [...MESSAGE_FIELDS]);
  assert.deepEqual(Object.keys(storedEntry({ type: "compaction", extra: SENTINEL })), [...COMPACTION_FIELDS]);
});

// ── the append, over an injected file system ──

function memFs() {
  const files = new Map();
  return {
    files,
    readFileSync: (p) => { if (!files.has(p)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); return files.get(p); },
    mkdirSync: () => {},
    appendFileSync: (p, t) => files.set(p, (files.get(p) || "") + t),
  };
}
const ROOT = path.join(path.sep, "pm-unit", "repo");
const file = (fsx) => [...fsx.files.entries()].find(([p]) => p.endsWith("devlog.jsonl"));
const lines = (fsx) => (file(fsx) ? file(fsx)[1].split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const msg = (id) => ({ type: "message", messageId: id, sessionId: "s", agentId: null, at: ts(1), userText: 1, toolResults: {}, attachments: 0, images: 0, textBytes: 2, thinkingBytes: 0 });

unitTest("1.3 appending the same message twice stores it once (idempotent re-ingest, rebuild)", () => {
  const fsx = memFs();
  appendDevLog(ROOT, [msg("a"), msg("b")], null, fsx);
  appendDevLog(ROOT, [msg("a"), msg("b")], null, fsx);
  assert.deepEqual(lines(fsx).map((e) => e.messageId), ["a", "b"]);
  const dup = memFs();
  appendDevLog(ROOT, [msg("a"), msg("a")], null, dup);
  assert.equal(lines(dup).length, 1, "a duplicate inside one batch too");
});

unitTest("1.3 with nothing to append and no snapshot the file is not created", () => {
  const fsx = memFs();
  appendDevLog(ROOT, [], null, fsx);
  assert.equal(fsx.files.size, 0);
});

unitTest("1.4 a features snapshot is appended on change only", () => {
  const fsx = memFs();
  const snap = (on) => () => ({ features: { spendGuard: { on, bytes: on ? 806 : 0 } }, surfaces: { "rules:spend-guard": on ? 806 : 0 } });
  appendDevLog(ROOT, [], snap(false), fsx);
  appendDevLog(ROOT, [msg("a")], snap(false), fsx);
  assert.equal(lines(fsx).filter((e) => e.type === "features").length, 1, "unchanged configuration appends no snapshot");
  appendDevLog(ROOT, [], snap(true), fsx);
  const feats = lines(fsx).filter((e) => e.type === "features");
  assert.equal(feats.length, 2);
  assert.equal(feats[1].features.spendGuard.on, true);
  assert.deepEqual(Object.keys(feats[1]), ["type", "at", "features", "surfaces"]);
});
