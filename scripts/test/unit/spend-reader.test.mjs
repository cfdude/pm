// scripts/test/unit/spend-reader.test.mjs
// token-spend-tracking-per-epic, group 2 (2.1, 2.2, 2.3) — the transcript reader. UNIT rung: every
// function under test takes strings or lists and returns a value, so nothing here names a path on a
// disk. The fixture lines are SYNTHETIC; no real transcript is ever copied into the repository.

import assert from "node:assert/strict";
import { unitTest } from "../fixtures/unit-harness.mjs";
import {
  MARKER_FIELDS, ROW_FIELDS, encodeProjectPath, foldRows, markerFromText, parseEntry, rowTotal,
  sourceInfo, storedMarker, storedRow, tierOf, transcriptDirs, transcriptRoot,
} from "../../lib/spend-reader.mjs";

const MAIN = sourceInfo("-repo/sess1.jsonl");

/** One synthetic assistant entry. `over` merges onto the message / usage / entry. */
function assistant({ id = "m1", out = 10, input = 5, cc = 100, cr = 200, ts = "2026-10-09T10:00:00.000Z",
  model = "claude-opus-4-7", content = [{ type: "text", text: "SENTINEL-7f3a" }], usage = {}, entry = {} } = {}) {
  return JSON.stringify({
    type: "assistant", timestamp: ts, sessionId: "sess1", ...entry,
    message: {
      id, model, content,
      usage: { input_tokens: input, cache_creation_input_tokens: cc, cache_read_input_tokens: cr, output_tokens: out, ...usage },
    },
  });
}
const rowOf = (line, source = MAIN) => {
  const r = parseEntry(line, source);
  assert.ok(r.row, `expected a row, got ${JSON.stringify(r)}`);
  return r.row;
};

// ───────────────────────────── 2.1 discovery ─────────────────────────────

unitTest("2.1 the transcript root honours CLAUDE_CONFIG_DIR and defaults to ~/.claude/projects", () => {
  assert.equal(transcriptRoot({ CLAUDE_CONFIG_DIR: "/fixture/cfg" }, "/home/u"), "/fixture/cfg/projects");
  assert.equal(transcriptRoot({}, "/home/u"), "/home/u/.claude/projects");
  assert.equal(transcriptRoot({ CLAUDE_CONFIG_DIR: "" }, "/home/u"), "/home/u/.claude/projects", "an empty override is no override");
});

unitTest("2.1 the project directory is the main tree's path with every non-alphanumeric as a dash", () => {
  assert.equal(encodeProjectPath("/Users/rob/Documents/Repos/pm"), "-Users-rob-Documents-Repos-pm");
  assert.equal(encodeProjectPath("/a b/c.d_e"), "-a-b-c-d-e");
});

unitTest("2.1 worktree siblings are discovered by the encoded prefix, with the agent id from the NAME", () => {
  const listed = [
    "-repo", "-repo--claude-worktrees-agent-bbb", "-repo--claude-worktrees-agent-aaa",
    "-repo2", "-repo2--claude-worktrees-agent-zzz", "-other",
    "-repo--claude-worktrees-agent-",      // no id: not a worktree session
  ];
  const found = transcriptDirs("/repo", { CLAUDE_CONFIG_DIR: "/cfg" }, () => listed, "/home/u");
  assert.equal(found.root, "/cfg/projects");
  assert.deepEqual(found.dirs.map((d) => [d.dir, d.kind, d.agentId]), [
    ["/cfg/projects/-repo", "project", null],
    ["/cfg/projects/-repo--claude-worktrees-agent-aaa", "worktree", "aaa"],
    ["/cfg/projects/-repo--claude-worktrees-agent-bbb", "worktree", "bbb"],
  ]);
});

unitTest("2.1 a linked worktree resolves to the MAIN tree's directories: the caller passes the main root", () => {
  // transcriptDirs() is asked about the MAIN root; resolving that root from a linked worktree is
  // spend-tracking.mjs's job (mainTreeRoot, tested in spend-tree.test.mjs).
  const fromMain = transcriptDirs("/repo", {}, () => [], "/h");
  assert.deepEqual(fromMain.dirs.map((d) => d.dir), ["/h/.claude/projects/-repo"]);
});

unitTest("2.1 a lister that finds nothing yields only the project directory (a missing directory is not an error)", () => {
  assert.equal(transcriptDirs("/repo", {}, () => undefined, "/h").dirs.length, 1);
});

unitTest("2.1 sourceInfo reads actor and agent id from the PATH, never from the entry", () => {
  assert.deepEqual(sourceInfo("-repo/s1.jsonl"),
    { rel: "-repo/s1.jsonl", kind: "main", actor: "orchestrator", agentId: null, sessionId: "s1" });
  assert.deepEqual(sourceInfo("-repo/s1/subagents/agent-abc123.jsonl"),
    { rel: "-repo/s1/subagents/agent-abc123.jsonl", kind: "subagent", actor: "subagent", agentId: "abc123", sessionId: "s1" });
  assert.deepEqual(sourceInfo("-repo--claude-worktrees-agent-xyz/s9.jsonl"),
    { rel: "-repo--claude-worktrees-agent-xyz/s9.jsonl", kind: "worktree-session", actor: "subagent", agentId: "xyz", sessionId: "s9" });
});

// ───────────────────────────── 2.2 parse and fold ─────────────────────────────

unitTest("2.2 a tier maps to the first KNOWN_MODELS token in the id, else `other`", () => {
  assert.equal(tierOf("claude-sonnet-5-5"), "sonnet");
  assert.equal(tierOf("claude-opus-4-7"), "opus");
  assert.equal(tierOf("claude-haiku-4-5"), "haiku");
  assert.equal(tierOf("some-other-model"), "other");
  assert.equal(tierOf(undefined), "other");
});

unitTest("2.2 an assistant entry yields a row with the four counts, thinking, tools and the model", () => {
  const row = rowOf(assistant({
    id: "m1", out: 21, usage: { output_tokens_details: { thinking_tokens: 7 } },
    content: [{ type: "tool_use", name: "Bash", input: { command: "SENTINEL-7f3a" } }],
  }));
  assert.deepEqual(row, {
    messageId: "m1", sessionId: "sess1", agentId: null, actor: "orchestrator", source: "-repo/sess1.jsonl",
    at: "2026-10-09T10:00:00.000Z", model: "claude-opus-4-7", tier: "opus",
    input: 5, cacheCreation: 100, cacheRead: 200, output: 21, thinking: 7, tools: ["Bash"],
  });
  assert.equal(rowTotal(row), 5 + 100 + 200 + 21, "thinking is a subset and never added");
});

unitTest("2.2 Streamed duplicates count once: outputs 21, 195 and 195 fold to one row with output 195", () => {
  const rows = [21, 195, 195].map((out) => rowOf(assistant({ id: "m1", out })));
  const folded = foldRows(rows);
  assert.equal(folded.length, 1);
  assert.equal(folded[0].output, 195);
  assert.equal(rowTotal(folded[0]), 5 + 100 + 200 + 195);
});

unitTest("2.2 A zero-usage partial entry does not win", () => {
  const thinking = rowOf(assistant({ id: "m1", out: 0, input: 0, cc: 0, cr: 0 }));
  const real = rowOf(assistant({ id: "m1", out: 300 }));
  assert.equal(foldRows([thinking, real])[0].output, 300);
  assert.equal(foldRows([real, thinking])[0].output, 300, "order does not matter when the outputs differ");
});

unitTest("2.2 an output that DROPS after stop_reason does not win either", () => {
  const complete = rowOf(assistant({ id: "m1", out: 400 }));
  const later = rowOf(assistant({ id: "m1", out: 120, entry: { stop_reason: "end_turn" } }));
  assert.equal(foldRows([complete, later])[0].output, 400);
});

unitTest("2.2 on a tie in output the LATER entry wins", () => {
  const a = rowOf(assistant({ id: "m1", out: 50, input: 1 }));
  const b = rowOf(assistant({ id: "m1", out: 50, input: 2 }));
  assert.equal(foldRows([a, b])[0].input, 2);
});

unitTest("2.2 Tools spread over several entries are all kept, in order, once each", () => {
  const e1 = rowOf(assistant({ id: "m1", out: 10, content: [{ type: "tool_use", name: "Bash" }] }));
  const e2 = rowOf(assistant({ id: "m1", out: 20, content: [{ type: "tool_use", name: "Read" }] }));
  const e3 = rowOf(assistant({ id: "m1", out: 20, content: [{ type: "tool_use", name: "Bash" }] }));
  assert.deepEqual(foldRows([e1, e2])[0].tools, ["Bash", "Read"]);
  assert.deepEqual(foldRows([e1, e2, e3])[0].tools, ["Bash", "Read"], "a replayed entry does not duplicate a tool");
});

unitTest("2.2 Iterations are not double-counted: the total is the top-level counts alone", () => {
  const row = rowOf(assistant({ id: "m1", out: 10, usage: { iterations: [{ input_tokens: 5, output_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 200 }] } }));
  assert.equal(rowTotal(row), 5 + 100 + 200 + 10);
});

unitTest("2.2 folding is idempotent and keeps first-appearance order of ids", () => {
  const rows = [rowOf(assistant({ id: "b", out: 1 })), rowOf(assistant({ id: "a", out: 1 })), rowOf(assistant({ id: "b", out: 9 }))];
  const once = foldRows(rows);
  assert.deepEqual(once.map((r) => r.messageId), ["b", "a"]);
  assert.deepEqual(foldRows(once), once);
});

unitTest("2.2 Non-assistant and malformed entries yield no row, and a malformed one is skipped BY REASON", () => {
  const user = JSON.stringify({ type: "user", message: { content: "SENTINEL-7f3a hello" } });
  assert.deepEqual(parseEntry(JSON.stringify({ type: "system" }), MAIN), { ignored: true });
  assert.deepEqual(parseEntry(JSON.stringify({ type: "attachment" }), MAIN), { ignored: true });
  assert.deepEqual(parseEntry(JSON.stringify({ type: "cost-state", totalCostUSD: 1 }), MAIN), { ignored: true });
  assert.deepEqual(parseEntry("", MAIN), { ignored: true });
  assert.deepEqual(parseEntry(user, MAIN), { user: true, marker: null });
  assert.deepEqual(parseEntry("{not json", MAIN), { skip: "malformed-json" });
  assert.deepEqual(parseEntry(JSON.stringify({ type: "assistant", timestamp: "2026-10-09T10:00:00Z", message: { usage: {} } }), MAIN), { skip: "no-message-id" });
  assert.deepEqual(parseEntry(JSON.stringify({ type: "assistant", timestamp: "2026-10-09T10:00:00Z", message: { id: "x" } }), MAIN), { skip: "no-usage" });
  assert.deepEqual(parseEntry(JSON.stringify({ type: "assistant", message: { id: "x", usage: {} } }), MAIN), { skip: "no-timestamp" });
});

unitTest("2.2 Sub-agent sources are sub-agent actors: the subagents file, isSidechain, and the worktree directory", () => {
  const fromFile = rowOf(assistant({ id: "s1" }), sourceInfo("-repo/sess/subagents/agent-A1.jsonl"));
  assert.deepEqual([fromFile.actor, fromFile.agentId], ["subagent", "A1"]);
  const fromWorktree = rowOf(assistant({ id: "w1", entry: { isSidechain: false, agentId: null } }), sourceInfo("-repo--claude-worktrees-agent-W9/sess.jsonl"));
  assert.deepEqual([fromWorktree.actor, fromWorktree.agentId], ["subagent", "W9"], "the directory name, not the entry, names the agent");
  const sidechain = rowOf(assistant({ id: "c1", entry: { isSidechain: true, agentId: "SC7" } }));
  assert.deepEqual([sidechain.actor, sidechain.agentId], ["subagent", "SC7"]);
  const sidechainNoId = rowOf(assistant({ id: "c2", entry: { isSidechain: true } }));
  assert.equal(sidechainNoId.actor, "subagent");
  assert.ok(sidechainNoId.agentId, "a sidechain entry always has an agent id");
  const plain = rowOf(assistant({ id: "p1" }));
  assert.deepEqual([plain.actor, plain.agentId], ["orchestrator", null]);
});

unitTest("2.2 the marker is the FIRST matching line, raw tokens, whether or not valid", () => {
  const t = "Please build it.\npm-spend: epic=e1 role=review phase=review round=2\npm-spend: epic=e9 role=x phase=y";
  assert.deepEqual(markerFromText(t), { epic: "e1", role: "review", phase: "review", round: "2" });
  assert.deepEqual(markerFromText("pm-spend: epic=e1 role=implement phase=build"), { epic: "e1", role: "implement", phase: "build", round: null });
  assert.deepEqual(markerFromText("pm-spend: epic=e1 role=bogus phase=nonsense round=two"), { epic: "e1", role: "bogus", phase: "nonsense", round: "two" });
  assert.equal(markerFromText("no marker here\n  pm-spend: epic=e1 role=a"), null);
  assert.equal(markerFromText("quoted: pm-spend: epic=e1 role=a phase=b"), null, "the line must START with the token");
});

unitTest("2.2 a user entry's marker is read from a string or an array of text blocks", () => {
  const line = (content) => JSON.stringify({ type: "user", message: { content } });
  const want = { user: true, marker: { epic: "e1", role: "test", phase: "build", round: null } };
  assert.deepEqual(parseEntry(line("pm-spend: epic=e1 role=test phase=build"), MAIN), want);
  assert.deepEqual(parseEntry(line([{ type: "text", text: "intro" }, { type: "text", text: "pm-spend: epic=e1 role=test phase=build" }]), MAIN), want);
});

// ───────────────────────────── 2.3 the stored shapes ─────────────────────────────

unitTest("2.3 a stored row holds EXACTLY the allowlisted fields — and nothing a parsed row might grow", () => {
  assert.deepEqual([...ROW_FIELDS], [
    "messageId", "sessionId", "agentId", "actor", "source", "at", "model", "tier",
    "input", "cacheCreation", "cacheRead", "output", "thinking", "tools",
  ]);
  const parsed = { ...rowOf(assistant({ id: "m1" })), prompt: "SENTINEL-7f3a", cwd: "/x", description: "SENTINEL-7f3a" };
  const stored = storedRow(parsed);
  assert.deepEqual(Object.keys(stored), [...ROW_FIELDS]);
  assert.equal(JSON.stringify(stored).includes("SENTINEL-7f3a"), false);
});

unitTest("2.3 a stored marker holds exactly its four tokens", () => {
  assert.deepEqual([...MARKER_FIELDS], ["epic", "role", "phase", "round"]);
  const stored = storedMarker({ epic: "e1", role: "review", phase: "review", round: "2", text: "SENTINEL-7f3a" });
  assert.deepEqual(Object.keys(stored), [...MARKER_FIELDS]);
  assert.equal(JSON.stringify(stored).includes("SENTINEL-7f3a"), false);
});
