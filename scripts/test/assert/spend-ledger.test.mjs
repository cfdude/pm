// scripts/test/assert/spend-ledger.test.mjs
// token-spend-tracking-per-epic, group 2 (2.4, 2.5) — the ledger's FILES: incremental ingest over a
// synthetic transcript tree, the cursor, the markers, the lock, and the privacy sentinel. FILE rung:
// every observable here is bytes on disk. The tree is built by fixtures/spend-transcripts.mjs and is
// never a copy of a real transcript.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo } from "../fixtures/assert-harness.mjs";
import { EXPECTED, SENTINEL, buildTranscriptTree, walk } from "../fixtures/spend-transcripts.mjs";
import { LOCK_STALE_MS, ingest, readLedger } from "../../lib/spend-ledger.mjs";
import { rowTotal, sourceInfo } from "../../lib/spend-reader.mjs";
import { spendDir } from "../../lib/spend-tree.mjs";

const ENABLED_AT = Date.parse("2026-10-01T00:00:00.000Z");
const FRESH = new Date("2026-10-09T12:00:00.000Z");

/** A repo root, a config dir holding the fixture tree, and every fixture file stamped FRESH so the
 *  mtime rule is deterministic whatever the machine's clock says. */
function scene() {
  const repo = tmpRepo();
  const cfg = tmpRepo();
  const paths = buildTranscriptTree(cfg, repo);
  for (const f of walk(cfg)) fs.utimesSync(path.join(cfg, f), FRESH, FRESH);
  const env = { CLAUDE_CONFIG_DIR: cfg };
  const opts = { mainRoot: repo, env, home: "/no/such/home", enabledAtMs: ENABLED_AT };
  return { repo, cfg, paths, env, opts };
}

const sumBy = (rows, pick) => {
  const m = {};
  for (const r of rows) { const k = pick(r); m[k] = (m[k] || 0) + rowTotal(r); }
  return m;
};
const ledgerBytes = (repo) => {
  const dir = spendDir(repo);
  return Object.fromEntries(walk(dir).filter((f) => f !== "ingest.lock").map((f) => [f, fs.readFileSync(path.join(dir, f), "utf8")]));
};

test("2.4 ingest reads the main session, both sub-agents and both worktree sessions, folded once per message", () => {
  const { repo, opts } = scene();
  const r = ingest(opts);
  assert.equal(r.ran, true);
  assert.equal(r.projectDirFound, true);
  assert.equal(r.files.seen, 5, "main + 2 subagents + 2 worktree sessions");
  const { rows } = readLedger(repo);
  const bySource = sumBy(rows, (x) => sourceInfo(x.source).kind + ":" + (x.agentId || "-"));
  assert.deepEqual(bySource, {
    "main:-": EXPECTED.main.total,
    "subagent:MARKED": EXPECTED.marked.total,
    "subagent:UNMARKED": EXPECTED.unmarked.total,
    "worktree-session:MARKED": EXPECTED.worktreeMarked.total,
    "worktree-session:ORPHAN": EXPECTED.worktreeOrphan.total,
  });
  assert.equal(rows.length, EXPECTED.main.messages + EXPECTED.marked.messages + EXPECTED.unmarked.messages + 2);
  assert.deepEqual(r.skipped, { "no-message-id": 1, "malformed-json": 1 }, "skipped entries are reported by reason");
});

test("2.4 the folded main-session rows carry the complete counts and the merged tools", () => {
  const { repo, opts } = scene();
  ingest(opts);
  const m1 = readLedger(repo).rows.find((x) => x.messageId === "m1");
  assert.equal(m1.output, 195);
  assert.deepEqual(m1.tools, ["Bash", "Read"]);
  assert.equal(m1.thinking, 80);
});

test("2.4 Ingest is idempotent: a re-run reads nothing, adds nothing, and leaves the ledger bytes identical", () => {
  const { repo, opts } = scene();
  ingest(opts);
  const before = ledgerBytes(repo);
  const second = ingest(opts);
  assert.equal(second.rowsAdded, 0);
  assert.equal(second.files.read, 0);
  assert.equal(second.files.unchanged, 5);
  assert.deepEqual(ledgerBytes(repo), before);
});

test("2.4 A partial trailing line waits for its newline", () => {
  const { repo, paths, opts } = scene();
  ingest(opts);
  const before = readLedger(repo).rows.length;
  const line = JSON.stringify({
    type: "assistant", timestamp: "2026-10-09T10:05:00.000Z", sessionId: "sessA",
    message: { id: "late", model: "claude-opus-4-7", content: [], usage: { input_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 9 } },
  });
  fs.appendFileSync(paths.main, line);                      // no newline yet
  const waiting = ingest(opts);
  assert.equal(waiting.rowsAdded, 0, "the unterminated line is not consumed");
  assert.equal(readLedger(repo).rows.length, before);
  fs.appendFileSync(paths.main, "\n");
  const done = ingest(opts);
  assert.equal(done.rowsAdded, 1);
  assert.equal(readLedger(repo).rows.find((x) => x.messageId === "late").output, 9);
});

test("2.4 A replaced file does not double-count: it is re-read from 0 and the totals are unchanged", () => {
  const { repo, paths, opts } = scene();
  ingest(opts);
  const before = sumBy(readLedger(repo).rows, (x) => x.source);
  // The same messages in a SHORTER file with a new identity: drop the trailing tool_result line.
  const lines = fs.readFileSync(paths.marked, "utf8").split("\n").filter((l) => l && !l.includes("tool_result"));
  const replacement = paths.marked + ".new";
  fs.writeFileSync(replacement, lines.join("\n") + "\n");
  fs.utimesSync(replacement, FRESH, FRESH);
  fs.renameSync(replacement, paths.marked);
  const r = ingest(opts);
  assert.equal(r.files.read, 1, "only the replaced file is read again");
  assert.deepEqual(sumBy(readLedger(repo).rows, (x) => x.source), before);
});

test("2.4 History before enabling is not opened: a file older than enabledAt never reaches openSync", () => {
  const { paths, opts } = scene();
  const old = new Date("2026-09-01T00:00:00.000Z");
  fs.utimesSync(paths.unmarked, old, old);
  const opened = [];
  const counting = new Proxy(fs, {
    get(target, prop) {
      if (prop === "openSync") return (p, ...rest) => { opened.push(String(p)); return target.openSync(p, ...rest); };
      const v = target[prop];
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
  const r = ingest(opts, counting);
  assert.equal(r.files.skippedBeforeEnabled, 1);
  assert.ok(!opened.includes(paths.unmarked), "the old file was never opened");
  assert.ok(opened.includes(paths.main), "the harness would have caught a counter that sees nothing");
});

test("2.4 rows timestamped before enabledAt are skipped even in a file that is opened", () => {
  const { repo, opts } = scene();
  const r = ingest({ ...opts, enabledAtMs: Date.parse("2026-10-09T10:00:03.500Z") });
  // m1's entries are at seconds 1-3 and m2's first (zero) at 4: only rows from second 4 on survive.
  assert.ok(r.rowsBeforeEnabled > 0);
  assert.equal(readLedger(repo).rows.some((x) => x.messageId === "m1"), false);
});

test("2.4 A concurrent ingest does not interleave: a live lock makes the second run report busy and add nothing", () => {
  const { repo, opts } = scene();
  fs.mkdirSync(spendDir(repo), { recursive: true });
  fs.writeFileSync(path.join(spendDir(repo), "ingest.lock"), "{}");
  const r = ingest(opts);
  assert.deepEqual([r.ran, r.busy], [false, true]);
  assert.equal(walk(spendDir(repo)).includes("rows.jsonl"), false, "nothing was ingested");
  assert.ok(fs.existsSync(path.join(spendDir(repo), "ingest.lock")), "the holder's lock is left alone");
});

test("2.4 a lock older than ten minutes is broken, and the ingest proceeds and releases its own lock", () => {
  const { repo, opts } = scene();
  fs.mkdirSync(spendDir(repo), { recursive: true });
  const lock = path.join(spendDir(repo), "ingest.lock");
  fs.writeFileSync(lock, "{}");
  const old = new Date(Date.now() - LOCK_STALE_MS - 60_000);
  fs.utimesSync(lock, old, old);
  const r = ingest(opts);
  assert.equal(r.ran, true);
  assert.ok(r.rowsAdded > 0);
  assert.equal(fs.existsSync(lock), false, "the lock is removed in a finally");
});

test("2.4 Transcripts are never modified: bytes and mtime are equal afterwards", () => {
  const { cfg, opts } = scene();
  const snap = () => Object.fromEntries(walk(cfg).map((f) => {
    const p = path.join(cfg, f);
    return [f, [fs.readFileSync(p, "utf8"), fs.statSync(p).mtimeMs]];
  }));
  const before = snap();
  ingest(opts);
  ingest(opts);
  assert.deepEqual(snap(), before);
});

test("2.4 No transcript directory is not an error: it adds no row and names the directory it looked for", () => {
  const repo = tmpRepo();
  const cfg = tmpRepo();
  const r = ingest({ mainRoot: repo, env: { CLAUDE_CONFIG_DIR: cfg }, home: "/no/such/home", enabledAtMs: ENABLED_AT });
  assert.equal(r.ran, true);
  assert.equal(r.projectDirFound, false);
  assert.match(r.projectDir, new RegExp(`^${cfg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/projects/-`));
  assert.equal(r.rowsAdded, 0);
  assert.equal(readLedger(repo).rows.length, 0);
});

test("2.4 The config directory override is honoured: nothing is read under the home directory", () => {
  const { repo, opts } = scene();
  const home = tmpRepo();
  const homeTree = path.join(home, ".claude", "projects");
  fs.mkdirSync(homeTree, { recursive: true });
  const r = ingest({ ...opts, home });
  assert.equal(r.files.seen, 5);
  assert.equal(r.projectDir.startsWith(opts.env.CLAUDE_CONFIG_DIR), true);
  assert.deepEqual(walk(homeTree), []);
  assert.ok(readLedger(repo).rows.length > 0);
});

test("2.4 The marker survives incremental ingest: a second run that starts past the first user entry still attributes", () => {
  const repo = tmpRepo();
  const cfg = tmpRepo();
  const paths = buildTranscriptTree(cfg, repo);
  // Cut the marked sub-agent down to its dispatch prompt + one assistant entry, ingest, then append.
  const lines = fs.readFileSync(paths.marked, "utf8").split("\n").filter(Boolean);
  fs.writeFileSync(paths.marked, lines.slice(0, 2).join("\n") + "\n");
  for (const f of walk(cfg)) fs.utimesSync(path.join(cfg, f), FRESH, FRESH);
  const opts = { mainRoot: repo, env: { CLAUDE_CONFIG_DIR: cfg }, home: "/no/such/home", enabledAtMs: ENABLED_AT };
  ingest(opts);
  const first = JSON.parse(fs.readFileSync(path.join(spendDir(repo), "markers.json"), "utf8"));
  assert.deepEqual(first.MARKED, { epic: "e1", role: "review", phase: "review", round: "2" });
  fs.appendFileSync(paths.marked, lines.slice(2).join("\n") + "\n");
  fs.utimesSync(paths.marked, FRESH, FRESH);
  ingest(opts);
  const { rows, markers } = readLedger(repo);
  assert.deepEqual(markers.MARKED, first.MARKED, "the marker was captured once and kept");
  const marked = rows.filter((x) => x.agentId === "MARKED" && x.actor === "subagent" && x.source.includes("subagents"));
  assert.equal(marked.length, 2, "rows from both runs carry the agent id the marker is keyed by");
});

test("2.4 A worktree session's rows are sub-agent rows keyed by the DIRECTORY name, whatever the entries say", () => {
  const { repo, opts } = scene();
  ingest(opts);
  const wt = readLedger(repo).rows.filter((x) => x.source.includes("--claude-worktrees-agent-"));
  assert.deepEqual(wt.map((x) => [x.actor, x.agentId]).sort(), [["subagent", "MARKED"], ["subagent", "ORPHAN"]]);
});

test("2.5 Fixture text never reaches the ledger: no file under .conductor/spend/ holds the sentinel", () => {
  const { repo, cfg, opts } = scene();
  // The sentinel IS in the fixture, in a prompt, a response, a tool input, a tool output and a meta description.
  const inFixture = walk(cfg).filter((f) => fs.readFileSync(path.join(cfg, f), "utf8").includes(SENTINEL));
  assert.ok(inFixture.length >= 6, `the sentinel is planted in the fixture (${inFixture.length} files)`);
  ingest(opts);
  const files = walk(spendDir(repo));
  assert.ok(files.includes("rows.jsonl") && files.includes("markers.json") && files.includes("cursor.json"));
  for (const f of files) {
    assert.equal(fs.readFileSync(path.join(spendDir(repo), f), "utf8").includes(SENTINEL), false, `${f} holds no fixture text`);
  }
});

test("2.5 the stored rows hold exactly the allowlisted fields", () => {
  const { repo, opts } = scene();
  ingest(opts);
  const lines = fs.readFileSync(path.join(spendDir(repo), "rows.jsonl"), "utf8").split("\n").filter(Boolean);
  assert.ok(lines.length > 0);
  for (const l of lines) {
    assert.deepEqual(Object.keys(JSON.parse(l)), [
      "messageId", "sessionId", "agentId", "actor", "source", "at", "model", "tier",
      "input", "cacheCreation", "cacheRead", "output", "thinking", "tools",
    ]);
  }
});
