// scripts/lib/dev-log-capture.mjs
// developer-session-log -- the CAPTURE half: a pure collector fed one transcript line at a time, and the
// append-only file the entries land in. spend-ledger.mjs's ingest drives it from its own read loop, so there is
// still exactly one transcript reader and no hook ever reaches this file.
//
// COMPOSITION, NEVER TEXT. The collector counts bytes: it holds no string it was handed. A stored entry has
// numbers and identifiers only (design D2). The fields are an allowlist below, built the way `storedRow` builds
// a ledger row, so a field added to the collector cannot reach disk without a diff a reviewer reads.
//
// A REQUEST'S COMPOSITION IS A DELTA. The entries between the previous assistant message and this one are the
// request's NEW content (the cached prefix is already measured by the ledger's `cacheRead`): user text, tool
// results sized per tool name (the name resolved from the `tool_use` block whose id the result carries),
// attachments (system reminders and every other injected block) and a count of images.
//
// ONE API MESSAGE IS 2-3 TRANSCRIPT ENTRIES sharing `message.id`, one content block each. The response's
// `textBytes` and `thinkingBytes` are SUMMED across them, and the request delta is attached once, to the first.
// (This is not the ledger's fold, which keeps the entry with the greatest output.)
//
// INCREMENTAL INGEST CARRIES STATE. The cursor advances past lines whose request bytes have not met an assistant
// entry yet, and the id->tool-name map would die with the ingest, so both ride in the per-file cursor entry
// (`dev`), the way `userSeen` does. A message whose entries straddle two ingests is recorded from the part seen
// first (entries are deduplicated by `messageId`); Claude Code writes a message's entries in quick succession, so
// this is rare, and it is stated here rather than discovered.

import fs from "node:fs";
import path from "node:path";
import { spendDir } from "./spend-tree.mjs";

export const DEVLOG_FILE = "devlog.jsonl";

/** The ONLY fields a stored message entry holds. */
export const MESSAGE_FIELDS = Object.freeze([
  "type", "messageId", "sessionId", "agentId", "at",
  "userText", "toolResults", "attachments", "images", "textBytes", "thinkingBytes",
]);
/** The ONLY fields a stored compaction entry holds. */
export const COMPACTION_FIELDS = Object.freeze(["type", "sessionId", "at", "trigger", "preTokens", "postTokens"]);

/** How many unresolved `tool_use` ids a collector remembers. A result for a forgotten id reports under `unknown`. */
export const TOOL_NAME_CAP = 2000;
const NAME_MAX = 100;

const bytes = (s) => Buffer.byteLength(String(s), "utf8");
const num = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);
const safeName = (n) => (typeof n === "string" && n ? n.slice(0, NAME_MAX) : "unknown");

export const emptyPending = () => ({ userText: 0, toolResults: {}, attachments: 0, images: 0 });

/** Bytes of a tool result's / message's content: a string, or the `text` blocks of an array. Other block types
 *  (an image) contribute nothing here; images are counted by the caller. */
function contentBytes(c) {
  if (typeof c === "string") return bytes(c);
  if (!Array.isArray(c)) return 0;
  let n = 0;
  for (const b of c) {
    if (typeof b === "string") n += bytes(b);
    else if (b && b.type === "text" && typeof b.text === "string") n += bytes(b.text);
  }
  return n;
}

/** A collector, restored from `carry` (the `dev` object of a cursor entry) when the file is resumed. */
export function newCollector(carry, ctx = {}) {
  const c = {
    pending: emptyPending(), toolNames: {}, open: null, entries: [],
    ctx, enabledAtMs: Number.isFinite(ctx.enabledAtMs) ? ctx.enabledAtMs : 0, beforeEnabled: 0,
  };
  if (carry && typeof carry === "object") {
    const p = carry.pending;
    if (p && typeof p === "object") {
      c.pending = {
        userText: num(p.userText) || 0, attachments: num(p.attachments) || 0, images: num(p.images) || 0,
        toolResults: Object.fromEntries(Object.entries(p.toolResults || {}).map(([k, v]) => [safeName(k), num(v) || 0])),
      };
    }
    if (carry.toolNames && typeof carry.toolNames === "object") {
      for (const [id, name] of Object.entries(carry.toolNames)) c.toolNames[id] = safeName(name);
    }
  }
  return c;
}

function takePending(c) {
  const p = c.pending;
  c.pending = emptyPending();
  return p;
}

function flush(c) {
  const o = c.open;
  if (!o) return;
  c.open = null;
  if (Date.parse(o.at) < c.enabledAtMs) { c.beforeEnabled++; return; }
  c.entries.push({
    type: "message", messageId: o.messageId, sessionId: o.sessionId, agentId: o.agentId, at: o.at,
    userText: o.comp.userText, toolResults: o.comp.toolResults, attachments: o.comp.attachments, images: o.comp.images,
    textBytes: o.textBytes, thinkingBytes: o.thinkingBytes,
  });
}

function rememberTool(c, id, name) {
  if (typeof id !== "string" || !id) return;
  c.toolNames[id] = safeName(name);
  const ids = Object.keys(c.toolNames);
  if (ids.length > TOOL_NAME_CAP) for (const old of ids.slice(0, ids.length - TOOL_NAME_CAP)) delete c.toolNames[old];
}

/** Feed one transcript line. Pure over the collector. Never throws on a line it cannot use. */
export function feedLine(c, line) {
  let obj;
  try { obj = JSON.parse(line); } catch { return; }
  if (!obj || typeof obj !== "object") return;
  const t = obj.type;
  if (t === "assistant") {
    const m = obj.message;
    if (!m || typeof m !== "object" || typeof m.id !== "string" || !m.id) return;
    if (c.open && c.open.messageId !== m.id) flush(c);
    if (!c.open) {
      const at = typeof obj.timestamp === "string" && Number.isFinite(Date.parse(obj.timestamp)) ? obj.timestamp : null;
      if (!at) return;
      let agentId = c.ctx.agentId || null;
      if (obj.isSidechain === true && c.ctx.actor === "orchestrator") agentId = (typeof obj.agentId === "string" && obj.agentId) || "unknown-sidechain";
      c.open = {
        messageId: m.id, sessionId: (typeof obj.sessionId === "string" && obj.sessionId) || c.ctx.sessionId || null,
        agentId, at, comp: takePending(c), textBytes: 0, thinkingBytes: 0,
      };
    }
    if (Array.isArray(m.content)) {
      for (const b of m.content) {
        if (!b || typeof b !== "object") continue;
        if (b.type === "text" && typeof b.text === "string") c.open.textBytes += bytes(b.text);
        else if (b.type === "thinking" && typeof b.thinking === "string") c.open.thinkingBytes += bytes(b.thinking);
        else if (b.type === "tool_use") rememberTool(c, b.id, b.name);
      }
    }
    return;
  }
  // Every other entry closes the message being assembled: its entries are consecutive.
  flush(c);
  if (t === "user") {
    const content = obj.message ? obj.message.content : undefined;
    if (obj.isCompactSummary === true || obj.isMeta === true) { c.pending.attachments += contentBytes(content); return; }
    if (typeof content === "string") { c.pending.userText += bytes(content); return; }
    if (!Array.isArray(content)) return;
    for (const b of content) {
      if (!b || typeof b !== "object") continue;
      if (b.type === "text" && typeof b.text === "string") c.pending.userText += bytes(b.text);
      else if (b.type === "image") c.pending.images += 1;
      else if (b.type === "tool_result") {
        const name = (typeof b.tool_use_id === "string" && c.toolNames[b.tool_use_id]) || "unknown";
        if (typeof b.tool_use_id === "string") delete c.toolNames[b.tool_use_id];
        c.pending.toolResults[name] = (c.pending.toolResults[name] || 0) + contentBytes(b.content);
      }
    }
    return;
  }
  if (t === "attachment") { c.pending.attachments += bytes(JSON.stringify(obj.attachment === undefined ? {} : obj.attachment)); return; }
  if (t === "system" && obj.subtype === "compact_boundary") {
    const at = typeof obj.timestamp === "string" && Number.isFinite(Date.parse(obj.timestamp)) ? obj.timestamp : null;
    if (!at || Date.parse(at) < c.enabledAtMs) return;
    const meta = obj.compactMetadata && typeof obj.compactMetadata === "object" ? obj.compactMetadata : {};
    c.entries.push({
      type: "compaction", sessionId: (typeof obj.sessionId === "string" && obj.sessionId) || c.ctx.sessionId || null, at,
      trigger: typeof meta.trigger === "string" && /^[a-z_-]{1,20}$/.test(meta.trigger) ? meta.trigger : null,
      preTokens: num(meta.preTokens), postTokens: num(meta.postTokens),
    });
  }
}

/** End of one read: close the open message and return what to store. `carry` is what the cursor keeps. */
export function finishRead(c) {
  flush(c);
  return { entries: c.entries, beforeEnabled: c.beforeEnabled, carry: { pending: c.pending, toolNames: c.toolNames } };
}

// ───────────────────────────── what reaches disk ─────────────────────────────

/** An entry as stored: the allowlisted fields of its type and nothing else. */
export function storedEntry(e) {
  const fields = e.type === "compaction" ? COMPACTION_FIELDS : e.type === "message" ? MESSAGE_FIELDS : ["type", "at", "features", "surfaces"];
  const out = {};
  for (const k of fields) out[k] = e[k] === undefined ? null : e[k];
  return out;
}

const devPath = (mainRoot) => path.join(spendDir(mainRoot), DEVLOG_FILE);

/** The log as the report reads it: entries in file order and the count of unreadable lines. A missing file is empty. */
export function readDevLog(mainRoot, fsx = fs) {
  let text;
  try { text = fsx.readFileSync(devPath(mainRoot), "utf8"); } catch { return { entries: [], corrupt: 0, exists: false }; }
  const entries = [];
  let corrupt = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try { const e = JSON.parse(line); if (e && typeof e === "object") entries.push(e); else corrupt++; } catch { corrupt++; }
  }
  return { entries, corrupt, exists: true };
}

const keyOf = (e) => (e.type === "message" ? `m:${e.messageId}` : e.type === "compaction" ? `c:${e.sessionId}:${e.at}` : null);
const snapshotKey = (e) => JSON.stringify([e.features, e.surfaces]);

/** Append `entries` and, when it differs from the last one, a `features` snapshot. Entries already in the file
 *  (by message id, or session and time for a compaction) are dropped, so a re-read of the same transcript, a
 *  crash between the append and the cursor write and `spend --rebuild` all add nothing twice. `snapshot` is a
 *  function returning `{features, surfaces}`, evaluated only here. Returns `{appended, snapshotAppended}`.
 *  Creates the file only when there is something to write. */
export function appendDevLog(mainRoot, entries, snapshot, fsx = fs) {
  const existing = readDevLog(mainRoot, fsx).entries;
  const seen = new Set(existing.map(keyOf).filter(Boolean));
  let last = null;
  for (const e of existing) if (e.type === "features") last = e;
  const fresh = [];
  for (const e of entries) {
    const k = keyOf(e);
    if (k && seen.has(k)) continue;
    if (k) seen.add(k);
    fresh.push(storedEntry(e));
  }
  let snapshotAppended = false;
  if (snapshot) {
    const s = snapshot();
    if (s && (!last || snapshotKey(last) !== snapshotKey(s))) {
      fresh.push(storedEntry({ type: "features", at: new Date().toISOString(), features: s.features, surfaces: s.surfaces }));
      snapshotAppended = true;
    }
  }
  if (fresh.length) {
    fsx.mkdirSync(spendDir(mainRoot), { recursive: true });
    // A torn write leaves a last line with no newline; appending straight after it would glue the next entry
    // onto the partial one and lose both. Start on a fresh line when the file's last byte is not one.
    if (endsMidLine(devPath(mainRoot), fsx)) fsx.appendFileSync(devPath(mainRoot), "\n");
    fsx.appendFileSync(devPath(mainRoot), fresh.map((e) => JSON.stringify(e)).join("\n") + "\n");
  }
  return { appended: fresh.length - (snapshotAppended ? 1 : 0), snapshotAppended };
}

/** True when the file exists, is non-empty and its last byte is not a newline. */
function endsMidLine(file, fsx) {
  try {
    const size = fsx.statSync(file).size;
    if (size === 0) return false;
    const fd = fsx.openSync(file, "r");
    try {
      const buf = Buffer.alloc(1);
      fsx.readSync(fd, buf, 0, 1, size - 1);
      return buf[0] !== 0x0a;
    } finally { fsx.closeSync(fd); }
  } catch { return false; }
}

/** `dev-log --clear`'s plan: the file's size, or null when there is none. */
export function devLogSize(mainRoot, fsx = fs) {
  try { return fsx.statSync(devPath(mainRoot)).size; } catch { return null; }
}

/** Remove `devlog.jsonl` and nothing else. Returns whether a file was removed. */
export function removeDevLog(mainRoot, fsx = fs) {
  if (devLogSize(mainRoot, fsx) === null) return false;
  fsx.rmSync(devPath(mainRoot), { force: true });
  return true;
}
