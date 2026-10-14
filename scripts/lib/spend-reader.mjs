// scripts/lib/spend-reader.mjs
// token-spend-tracking-per-epic — the TRANSCRIPT READER. Pure: it takes text and returns values.
//
// It touches no file, opens no connection and runs no model. The module that does the reading of
// files is spend-ledger.mjs, which hands this one parsed lines; keeping the two apart is what lets
// every rule below be tested over strings (the unit rung) and lets the ledger be tested over a
// fixture tree (the file rung).
//
// WHAT A CLAUDE CODE TRANSCRIPT ACTUALLY HOLDS — measured on the maintainer's machine, 2026-10-09
// (design.md "Context"): one API message is written as 2-3 `assistant` entries sharing a
// `message.id`, each with exactly one content block, whose `output_tokens` grows as it streams; some
// entries carry zero usage (a thinking block) and a few have a LOWER output after `stop_reason`.
// `usage.iterations[]` repeats the top-level counts and `output_tokens_details.thinking_tokens` is a
// SUBSET of `output_tokens`. So a row-per-entry sum over-counts 2-3x, and the answer is a FOLD: the
// counts of the entry with the greatest `output_tokens` (a tie goes to the later entry), the tool
// names merged across every entry.
//
// PRIVACY IS STRUCTURAL, NOT A PROMISE. A stored row is built from an explicit field list
// (`storedRow`), and the only text this module ever inspects for content is a sub-agent's first user
// entry, scanned in memory for ONE line of a fixed shape. The prompt itself is never kept.

import path from "node:path";
import { KNOWN_MODELS } from "./constants.mjs";

/** The ONLY fields a stored row holds (spec: "Stored rows hold counts and identifiers only, and never
 *  text"). `storedRow` builds from this list, so a field added to a parsed row cannot reach disk
 *  without being added here, in a diff a reviewer reads. */
export const ROW_FIELDS = Object.freeze([
  "messageId", "sessionId", "agentId", "actor", "source", "at", "model", "tier",
  "input", "cacheCreation", "cacheRead", "output", "thinking", "tools",
]);

/** A stored marker holds only its four tokens, as captured (validated at READ time). */
export const MARKER_FIELDS = Object.freeze(["epic", "role", "phase", "round"]);

/** Every reason an entry can be skipped, as the report prints them. Closed, so a count is never
 *  keyed by free text. */
export const SKIP_REASONS = Object.freeze(["malformed-json", "no-message-id", "no-usage", "no-timestamp"]);

/** The line a dispatch prompt carries, matched against ONE line, never a prompt as a whole. */
export const MARKER_PATTERN = /^pm-spend: epic=(\S+) role=(\S+) phase=(\S+)(?: round=(\S+))?$/;

// ───────────────────────────── where the transcripts are ─────────────────────────────

/** Claude Code's project-directory encoding: every character outside [A-Za-z0-9] becomes `-`. It is
 *  CLAUDE CODE's rule, not pm's. If it changes, discovery finds no directory and `spend` says so. */
export const encodeProjectPath = (absPath) => String(absPath).replace(/[^A-Za-z0-9]/g, "-");

/** The marker a worktree-isolated agent's project directory carries after the repo's encoding. A
 *  worktree at `<repo>/.claude/worktrees/agent-<id>` encodes `/.` as `--`. */
export const WORKTREE_INFIX = "--claude-worktrees-";

/** `$CLAUDE_CONFIG_DIR/projects` when the variable is set, else `<home>/.claude/projects`. */
export function transcriptRoot(env, home) {
  const configured = env && typeof env.CLAUDE_CONFIG_DIR === "string" && env.CLAUDE_CONFIG_DIR ? env.CLAUDE_CONFIG_DIR : null;
  return path.join(configured || path.join(home || "", ".claude"), "projects");
}

/** The ordered directories ingest reads for the repository whose MAIN working tree is `mainRoot`.
 *
 *  Pure over an injected lister (`listDir(root)` returns the names under the transcript root, or []),
 *  so the unit rung tests it without a directory. The repository's own project directory comes
 *  first; every sibling named `<encoded repo>--claude-worktrees-agent-<id>` follows in name order,
 *  each carrying the agent id the DIRECTORY NAME gives, because the entries inside such a session
 *  look like main-session entries (`isSidechain:false`, `agentId:null`) and are not. */
export function transcriptDirs(mainRoot, env, listDir, home) {
  const root = transcriptRoot(env, home);
  const encoded = encodeProjectPath(mainRoot);
  const dirs = [{ dir: path.join(root, encoded), kind: "project", agentId: null }];
  const prefix = `${encoded}${WORKTREE_INFIX}agent-`;
  const names = [...(listDir(root) || [])].filter((n) => typeof n === "string" && n.startsWith(prefix) && n.length > prefix.length).sort();
  for (const name of names) dirs.push({ dir: path.join(root, name), kind: "worktree", agentId: name.slice(prefix.length) });
  return { root, encoded, dirs };
}

/** What a transcript file IS, from its path relative to the transcript root. Never from its content:
 *  the content of a worktree session says it is a main session. */
export function sourceInfo(rel) {
  const parts = String(rel).split(path.sep === "\\" ? /[\\/]/ : "/").filter(Boolean);
  const projectDir = parts[0] || "";
  const at = projectDir.indexOf(`${WORKTREE_INFIX}agent-`);
  const worktreeAgent = at >= 0 ? projectDir.slice(at + `${WORKTREE_INFIX}agent-`.length) : null;
  const file = parts[parts.length - 1] || "";
  const sub = parts.length >= 3 && parts[parts.length - 2] === "subagents" && /^agent-.+\.jsonl$/.test(file);
  if (sub) {
    return {
      rel, kind: "subagent", actor: "subagent",
      agentId: file.replace(/^agent-/, "").replace(/\.jsonl$/, ""),
      sessionId: parts[parts.length - 3],
    };
  }
  const sessionId = file.replace(/\.jsonl$/, "");
  if (worktreeAgent) return { rel, kind: "worktree-session", actor: "subagent", agentId: worktreeAgent, sessionId };
  return { rel, kind: "main", actor: "orchestrator", agentId: null, sessionId };
}

// ───────────────────────────── the entry parser ─────────────────────────────

/** `claude-sonnet-5-5` -> `sonnet`: the first KNOWN_MODELS token the id contains, else `other`. */
export function tierOf(model, models = KNOWN_MODELS) {
  const id = String(model || "").toLowerCase();
  return models.find((m) => id.includes(m)) || "other";
}

const count = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

/** The text of a `user` entry's message, whether Claude Code stored a string or an array of blocks. */
function userText(obj) {
  const content = obj && obj.message ? obj.message.content : undefined;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((b) => (typeof b === "string" ? b : b && b.type === "text" && typeof b.text === "string" ? b.text : "")).join("\n");
  }
  return "";
}

/** The FIRST line of `text` matching the marker shape, as raw tokens, or null. Only the first match
 *  counts: a later line is a prompt that happens to quote one. */
export function markerFromText(text) {
  for (const line of String(text).split(/\r?\n/)) {
    const m = MARKER_PATTERN.exec(line.trim());
    if (m) return { epic: m[1], role: m[2], phase: m[3], round: m[4] === undefined ? null : m[4] };
  }
  return null;
}

/** Parse one transcript line. Returns exactly one of:
 *    { row }                   an assistant entry with an id and usage (a PARSED row, not yet stored)
 *    { skip: <reason> }        an entry that should have been a row and was not (SKIP_REASONS)
 *    { user: true, marker }    a `user` entry; `marker` is the raw tokens its text carries, or null
 *    { ignored: true }         anything else (system, attachment, cost-state, a blank line)
 *
 *  `source` is `sourceInfo()`'s answer. The prompt text is read only inside `markerFromText` and is
 *  not part of what is returned. */
export function parseEntry(line, source) {
  const text = String(line);
  if (!text.trim()) return { ignored: true };
  let obj;
  try { obj = JSON.parse(text); } catch { return { skip: "malformed-json" }; }
  if (!obj || typeof obj !== "object") return { skip: "malformed-json" };
  if (obj.type === "user") return { user: true, marker: markerFromText(userText(obj)) };
  if (obj.type !== "assistant") return { ignored: true };
  const message = obj.message;
  if (!message || typeof message !== "object" || typeof message.id !== "string" || !message.id) return { skip: "no-message-id" };
  const usage = message.usage;
  if (!usage || typeof usage !== "object") return { skip: "no-usage" };
  const at = typeof obj.timestamp === "string" && Number.isFinite(Date.parse(obj.timestamp)) ? obj.timestamp : null;
  if (!at) return { skip: "no-timestamp" };
  const tools = [];
  if (Array.isArray(message.content)) {
    for (const b of message.content) if (b && b.type === "tool_use" && typeof b.name === "string" && b.name) tools.push(b.name);
  }
  // A sidechain entry inside a main file is sub-agent spend even though the FILE says otherwise.
  let actor = source.actor;
  let agentId = source.agentId;
  if (obj.isSidechain === true && actor === "orchestrator") {
    actor = "subagent";
    agentId = (typeof obj.agentId === "string" && obj.agentId) || "unknown-sidechain";
  }
  const model = typeof message.model === "string" && message.model ? message.model : "unknown";
  return {
    row: {
      messageId: message.id,
      sessionId: (typeof obj.sessionId === "string" && obj.sessionId) || source.sessionId || null,
      agentId, actor, source: source.rel, at, model, tier: tierOf(model),
      input: count(usage.input_tokens),
      cacheCreation: count(usage.cache_creation_input_tokens),
      cacheRead: count(usage.cache_read_input_tokens),
      output: count(usage.output_tokens),
      thinking: count(usage.output_tokens_details && usage.output_tokens_details.thinking_tokens),
      tools,
    },
  };
}

// ───────────────────────────── the fold ─────────────────────────────

/** Fold rows sharing a `messageId` into one. The counts come from the row with the greatest `output`
 *  (a tie goes to the later row); `tools` is the in-order union of every row's. First-appearance
 *  order of the ids is kept. Pure and idempotent: folding a folded list returns it unchanged. */
export function foldRows(rows) {
  const byId = new Map();
  for (const r of rows) {
    const held = byId.get(r.messageId);
    if (!held) { byId.set(r.messageId, { ...r, tools: [...new Set(r.tools || [])] }); continue; }
    const tools = [...new Set([...held.tools, ...(r.tools || [])])];
    byId.set(r.messageId, r.output >= held.output ? { ...r, tools } : { ...held, tools });
  }
  return [...byId.values()];
}

/** The total a row contributes. `thinking` and `iterations` are never added: both are subsets of
 *  counts already here. */
export const rowTotal = (r) => r.input + r.cacheCreation + r.cacheRead + r.output;

// ───────────────────────────── what reaches disk ─────────────────────────────

/** A row as it is stored: the allowlisted fields and nothing else. */
export function storedRow(row) {
  const out = {};
  for (const k of ROW_FIELDS) out[k] = row[k] === undefined ? null : row[k];
  out.tools = Array.isArray(row.tools) ? [...row.tools] : [];
  return out;
}

/** A marker as it is stored: its four raw tokens and nothing else. */
export function storedMarker(m) {
  const out = {};
  for (const k of MARKER_FIELDS) out[k] = m[k] === undefined ? null : m[k];
  return out;
}
