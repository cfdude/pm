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
import { LOCK_STALE_MS, ingest, readLedger, rebuild } from "../../lib/spend-ledger.mjs";
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
  // Stamp the mtime from Date.now(): under the CI shifted clock a real-time mtime reads as ancient and the engine breaks it.
  fs.utimesSync(path.join(spendDir(repo), "ingest.lock"), new Date(Date.now()), new Date(Date.now()));
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

// ───────────────────────────── an unreadable transcript costs only itself ─────────────────────────────

const relOf = (cfg, abs) => path.relative(path.join(cfg, "projects"), abs);
const cursorOf = (repo) => JSON.parse(fs.readFileSync(path.join(spendDir(repo), "cursor.json"), "utf8"));
const withFs = (overrides) => new Proxy(fs, {
  get(target, prop) {
    if (prop in overrides) return overrides[prop](target);
    const v = target[prop];
    return typeof v === "function" ? v.bind(target) : v;
  },
});
const SKIP = "unreadable-transcript";
const norm = (s) => s.replace(/pm-test-[A-Za-z0-9]+/, "R");   // the project dir name carries the tmp repo path

test("G2-I1 an unreadable file (EACCES) and a directory named like a transcript is skipped (the first at the read, the second at discovery), counted, and the rest is ingested", () => {
  const clean = scene();
  ingest(clean.opts);
  const baseline = sumBy(readLedger(clean.repo).rows, (x) => norm(x.source));

  const { repo, cfg, paths, opts } = scene();
  fs.chmodSync(paths.unmarked, 0o000);
  const dirName = path.join(path.dirname(paths.marked), "agent-DIR.jsonl");
  fs.mkdirSync(dirName);
  fs.utimesSync(dirName, FRESH, FRESH);
  try {
    const r = ingest(opts);
    assert.equal(r.ran, true);
    assert.equal(r.skipped[SKIP], 1, "the unreadable file is counted under its named reason");
    assert.equal(r.skipped["not-a-regular-file"], 1, "the directory is counted under its own");
    const got = sumBy(readLedger(repo).rows, (x) => norm(x.source));
    const want = Object.fromEntries(Object.entries(baseline).filter(([src]) => !src.includes("UNMARKED")));
    assert.deepEqual(got, want, "every readable file's rows were written");
    const c = cursorOf(repo);
    assert.equal(relOf(cfg, paths.unmarked) in c, false, "the unreadable file has no cursor entry");
    assert.equal(relOf(cfg, dirName) in c, false);
    assert.equal(relOf(cfg, paths.main) in c, true);
  } finally { fs.chmodSync(paths.unmarked, 0o644); }
  const again = ingest(opts);
  assert.equal(again.skipped[SKIP], undefined, "the file became readable");
  assert.equal(again.skipped["not-a-regular-file"], 1, "the directory is still not a file");
  assert.deepEqual(sumBy(readLedger(repo).rows, (x) => norm(x.source)), baseline, "the file became readable and was ingested in full");
});

test("G2-I1 a bad file's existing cursor entry is left untouched", () => {
  const { repo, cfg, paths, opts } = scene();
  ingest(opts);
  const before = cursorOf(repo)[relOf(cfg, paths.unmarked)];
  assert.ok(before, "the file was ingested first");
  fs.appendFileSync(paths.unmarked, "\n");                 // size changes so it is not 'unchanged'
  fs.utimesSync(paths.unmarked, FRESH, FRESH);
  fs.chmodSync(paths.unmarked, 0o000);
  try {
    const r = ingest(opts);
    assert.equal(r.skipped[SKIP], 1);
    assert.deepEqual(cursorOf(repo)[relOf(cfg, paths.unmarked)], before);
  } finally { fs.chmodSync(paths.unmarked, 0o644); }
});

test("G2-I1 a transcript deleted between the stat and the open (ENOENT) is skipped and counted", () => {
  const { repo, cfg, paths, opts } = scene();
  const gone = withFs({
    openSync: (t) => (p, ...rest) => {
      if (String(p) === paths.marked) { const e = new Error("ENOENT: gone"); e.code = "ENOENT"; throw e; }
      return t.openSync(p, ...rest);
    },
  });
  const r = ingest(opts, gone);
  assert.equal(r.skipped[SKIP], 1);
  assert.equal(r.files.read, 4);
  const rows = readLedger(repo).rows;
  assert.ok(rows.length > 0);
  assert.equal(rows.some((x) => x.source === relOf(cfg, paths.marked)), false);
});

test("G2-I1 rebuild keeps the rows and markers of a live transcript it cannot read", () => {
  const { repo, paths, opts } = scene();
  ingest(opts);
  const before = sumBy(readLedger(repo).rows, (x) => x.source);
  const markersBefore = readLedger(repo).markers;
  fs.chmodSync(paths.marked, 0o000);
  try {
    const r = rebuild(opts);
    assert.equal(r.skipped[SKIP], 1);
    assert.deepEqual(sumBy(readLedger(repo).rows, (x) => x.source), before, "no source lost rows");
    assert.deepEqual(readLedger(repo).markers, markersBefore, "no marker lost");
  } finally { fs.chmodSync(paths.marked, 0o644); }
});

test("G2-I1 a throw inside rebuild leaves the previous ledger byte-identical, with no temp files", () => {
  const { repo, opts } = scene();
  ingest(opts);
  const before = ledgerBytes(repo);
  const failing = withFs({ renameSync: () => () => { throw new Error("disk full"); } });
  assert.throws(() => rebuild(opts, failing), /disk full/);
  assert.deepEqual(ledgerBytes(repo), before, "rows, cursor and markers are exactly as they were");
});

// ───────────────────────────── a line has a length cap; links are never followed ─────────────────────────────

const assistantLine = (id, output) => JSON.stringify({
  type: "assistant", timestamp: "2026-10-09T10:05:00.000Z", sessionId: "sessA",
  message: { id, model: "claude-opus-4-7", content: [], usage: { input_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: output } },
}) + "\n";

test("G2-M4 an over-long line is dropped and counted, the lines after it are still read, and the cursor passes it", () => {
  const { repo, cfg, paths, opts } = scene();
  ingest(opts);
  // 3.5 MB with no newline spans several 1 MB reads: the carry must not grow with it.
  fs.appendFileSync(paths.main, "x".repeat(3_500_000) + "\n" + assistantLine("after-long", 7));
  fs.utimesSync(paths.main, FRESH, FRESH);
  const r = ingest({ ...opts, maxLineBytes: 1_500_000 });
  assert.equal(r.skipped["over-long-line"], 1, "counted once, under a named reason");
  assert.equal(r.rowsAdded, 1);
  assert.equal(readLedger(repo).rows.find((x) => x.messageId === "after-long").output, 7);
  assert.equal(cursorOf(repo)[relOf(cfg, paths.main)].offset, fs.statSync(paths.main).size, "everything was consumed");
});

test("G2-M4 a complete line longer than the cap is dropped too, whatever the chunking", () => {
  const { repo, paths, opts } = scene();
  ingest(opts);
  fs.appendFileSync(paths.main, assistantLine("big", 1).replace('"content":[]', `"content":["${"y".repeat(5000)}"]`) + assistantLine("small", 3));
  fs.utimesSync(paths.main, FRESH, FRESH);
  const r = ingest({ ...opts, maxLineBytes: 1000 });
  assert.equal(r.skipped["over-long-line"], 1);
  const ids = readLedger(repo).rows.map((x) => x.messageId);
  assert.ok(ids.includes("small") && !ids.includes("big"));
});

test("G2-M4 an over-long line still being written is not consumed: the cursor stays at its start", () => {
  const { cfg, repo, paths, opts } = scene();
  ingest(opts);
  const startSize = fs.statSync(paths.main).size;
  fs.appendFileSync(paths.main, "z".repeat(2_500_000));            // no newline yet
  fs.utimesSync(paths.main, FRESH, FRESH);
  const r = ingest({ ...opts, maxLineBytes: 1_000_000 });
  assert.equal(r.skipped["over-long-line"], 1);
  assert.equal(cursorOf(repo)[relOf(cfg, paths.main)].offset, startSize);
  fs.appendFileSync(paths.main, "\n" + assistantLine("later", 5));
  fs.utimesSync(paths.main, FRESH, FRESH);
  ingest({ ...opts, maxLineBytes: 1_000_000 });
  assert.equal(readLedger(repo).rows.find((x) => x.messageId === "later").output, 5);
});

test("G2-M4 symlinks and non-files are skipped the same way at every level, counted, and never followed", () => {
  const { repo, paths, opts } = scene();
  const projDir = path.dirname(paths.main);
  const subDir = path.dirname(paths.marked);
  fs.symlinkSync(paths.main, path.join(projDir, "link.jsonl"));                    // top-level .jsonl link
  fs.symlinkSync(paths.unmarked, path.join(subDir, "agent-LINK.jsonl"));           // subagent link
  fs.symlinkSync(path.join(projDir, "sessA"), path.join(projDir, "sessB"));        // a linked session directory
  fs.mkdirSync(path.join(projDir, "sessC"));
  fs.symlinkSync(subDir, path.join(projDir, "sessC", "subagents"));                // a linked subagents directory
  fs.mkdirSync(path.join(projDir, "dir.jsonl"));                                   // a directory named like a transcript
  const r = ingest(opts);
  assert.equal(r.files.seen, 5, "the same five real transcripts, none twice");
  assert.equal(r.skipped["not-a-regular-file"], 5);
  const clean = scene();
  ingest(clean.opts);
  assert.equal(readLedger(repo).rows.length, readLedger(clean.repo).rows.length);
});
