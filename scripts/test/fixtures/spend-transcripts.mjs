// scripts/test/fixtures/spend-transcripts.mjs
// A SYNTHETIC Claude Code transcript tree for the spend ledger's file-rung tests.
//
// NEVER A COPY OF A REAL TRANSCRIPT: a real one holds prompt text. Every line here is built by hand to
// reproduce a SHAPE measured on real transcripts (token-spend-tracking-per-epic design.md "Context"):
// a message streamed across several entries with a growing output, a zero-usage thinking entry, an
// entry whose output DROPS after `stop_reason`, `tool_use` blocks split across entries of one id, a
// `cost-state` entry, `usage.iterations`, one marked and one unmarked sub-agent with their `.meta.json`,
// and two `--claude-worktrees-agent-<id>` project directories whose entries are `isSidechain:false`
// with a null `agentId`. The text fields all carry SENTINEL so a privacy test can prove none of it
// reaches the ledger.

import fs from "node:fs";
import path from "node:path";
import { encodeProjectPath } from "../../lib/spend-reader.mjs";

export const SENTINEL = "SENTINEL-7f3a";
export const MARKER_LINE = "pm-spend: epic=e1 role=review phase=review round=2";

/** Expected folded totals per source, so a test states what it expects once. */
export const EXPECTED = Object.freeze({
  main: { messages: 3, total: 500 + 417 + 431 },           // m1 + m2 + m3
  marked: { messages: 2, total: 132 + 62 },
  unmarked: { messages: 1, total: 33 },
  worktreeMarked: { messages: 1, total: 82 },
  worktreeOrphan: { messages: 1, total: 13 },
  all: 500 + 417 + 431 + 132 + 62 + 33 + 82 + 13,
});

const ts = (sec) => new Date(Date.UTC(2026, 9, 9, 10, 0, sec)).toISOString();

function assistant(id, sec, usage, content, extra = {}) {
  return JSON.stringify({
    type: "assistant", timestamp: ts(sec), sessionId: extra.sessionId || "sessA",
    isSidechain: extra.isSidechain ?? false, agentId: extra.agentId ?? null,
    message: { id, model: extra.model || "claude-opus-4-7", content, usage },
  });
}
const use = (input, cc, cr, output, more = {}) => ({
  input_tokens: input, cache_creation_input_tokens: cc, cache_read_input_tokens: cr, output_tokens: output, ...more,
});
const text = (t = `reply ${SENTINEL}`) => [{ type: "text", text: t }];
const tool = (name) => [{ type: "tool_use", name, input: { command: `echo ${SENTINEL}` } }];
const user = (sec, body) => JSON.stringify({ type: "user", timestamp: ts(sec), message: { role: "user", content: body } });

/** The main session: orchestrator spend, streamed duplicates and the awkward shapes. */
export function mainSessionLines() {
  return [
    JSON.stringify({ type: "system", subtype: "init", note: SENTINEL }),
    user(0, `${SENTINEL} please build the thing`),
    // m1: streamed over three entries, output growing 21 -> 195 -> 195; tools split across entries.
    assistant("m1", 1, use(5, 100, 200, 21, { iterations: [use(5, 100, 200, 21)] }), text()),
    assistant("m1", 2, use(5, 100, 200, 195), tool("Bash")),
    // the LAST of the tied entries wins the fold, so the thinking subset rides on it
    assistant("m1", 3, use(5, 100, 200, 195, { output_tokens_details: { thinking_tokens: 80 } }), tool("Read")),
    // m2: a zero-usage thinking entry first, then the real one.
    assistant("m2", 4, use(0, 0, 0, 0), [{ type: "thinking", thinking: SENTINEL }]),
    assistant("m2", 5, use(7, 50, 60, 300), text()),
    // m3: the output DROPS after stop_reason; the complete entry is the larger one.
    assistant("m3", 6, use(1, 10, 20, 400), text()),
    assistant("m3", 7, use(1, 10, 20, 120), text()),
    JSON.stringify({ type: "cost-state", totalCostUSD: 12.5, models: { "claude-haiku-4-5": { costUSD: 0.1 } } }),
    JSON.stringify({ type: "attachment", note: SENTINEL }),
    // an assistant entry with no message id, and one that is not JSON at all
    JSON.stringify({ type: "assistant", timestamp: ts(8), message: { usage: use(1, 1, 1, 1) } }),
    '{"type":"assistant", broken',
    "",
  ];
}

/** A sub-agent transcript. `marker` is the first line of its dispatch prompt, or null. */
export function subagentLines(agentId, marker, assistants) {
  return [
    user(10, `${marker ? `${marker}\n` : ""}${SENTINEL} do the sub-task`),
    ...assistants.map(([id, sec, usage]) => assistant(id, sec, usage, text(), { isSidechain: true, agentId })),
    JSON.stringify({ type: "user", timestamp: ts(40), message: { content: [{ type: "tool_result", content: `output ${SENTINEL}` }] } }),
    "",
  ];
}

/** A worktree-isolated agent's own session: entries LOOK like main-session entries. */
export function worktreeLines(assistants) {
  return [
    user(20, `${SENTINEL} worktree prompt`),
    ...assistants.map(([id, sec, usage]) => assistant(id, sec, usage, text(), { sessionId: "wtSess", isSidechain: false, agentId: null })),
    JSON.stringify({ type: "cost-state", totalCostUSD: 3 }),
    "",
  ];
}

const put = (file, lines) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Array.isArray(lines) ? lines.join("\n") : lines);
};

/** Build the tree under `configDir/projects` for the repository whose main working tree is `repoRoot`.
 *  Returns the paths a test needs. */
export function buildTranscriptTree(configDir, repoRoot) {
  const projects = path.join(configDir, "projects");
  const enc = encodeProjectPath(repoRoot);
  const proj = path.join(projects, enc);
  const paths = {
    projects, proj,
    main: path.join(proj, "sessA.jsonl"),
    marked: path.join(proj, "sessA", "subagents", "agent-MARKED.jsonl"),
    markedMeta: path.join(proj, "sessA", "subagents", "agent-MARKED.meta.json"),
    unmarked: path.join(proj, "sessA", "subagents", "agent-UNMARKED.jsonl"),
    unmarkedMeta: path.join(proj, "sessA", "subagents", "agent-UNMARKED.meta.json"),
    worktreeMarked: path.join(projects, `${enc}--claude-worktrees-agent-MARKED`, "wtSess.jsonl"),
    worktreeOrphan: path.join(projects, `${enc}--claude-worktrees-agent-ORPHAN`, "wtSess.jsonl"),
  };
  put(paths.main, mainSessionLines());
  put(paths.marked, subagentLines("MARKED", MARKER_LINE, [["s1", 11, use(2, 10, 20, 100)], ["s2", 12, use(1, 5, 6, 50)]]));
  put(paths.markedMeta, JSON.stringify({ agentType: "general-purpose", description: SENTINEL, toolUseId: "toolu_1", model: "claude-opus-4-7" }));
  put(paths.unmarked, subagentLines("UNMARKED", null, [["u1", 13, use(1, 1, 1, 30)]]));
  put(paths.unmarkedMeta, JSON.stringify({ agentType: "Explore", description: SENTINEL, toolUseId: "toolu_2", model: "claude-sonnet-5-5" }));
  put(paths.worktreeMarked, worktreeLines([["w1", 21, use(3, 4, 5, 70)]]));
  put(paths.worktreeOrphan, worktreeLines([["o1", 22, use(1, 1, 1, 10)]]));
  return paths;
}

/** Every file under `dir`, relative, sorted — to prove a tree is unchanged or holds no sentinel. */
export function walk(dir) {
  const out = [];
  const visit = (d) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) visit(p); else out.push(path.relative(dir, p));
    }
  };
  visit(dir);
  return out.sort();
}
