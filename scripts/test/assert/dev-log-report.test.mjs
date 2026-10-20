// scripts/test/assert/dev-log-report.test.mjs
// developer-session-log 2.1 / 2.2 -- the FILE rung of the verb: the report over a real ingest of fixture
// transcripts, the off messages opening no spend or transcript path, and the clear (plan first, --yes to act,
// only the log removed, off keeps the file, refused while tracking is off).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, invokeEngine } from "../fixtures/assert-harness.mjs";
import { recordFsPaths, touchedUnder } from "../fixtures/fs-path-recorder.mjs";
import { walk } from "../fixtures/spend-transcripts.mjs";
import { spendDir } from "../../lib/spend-tree.mjs";
import { encodeProjectPath } from "../../lib/spend-reader.mjs";

const j = (o) => JSON.stringify(o);

function scene({ log = true, tracking = true } = {}) {
  const repo = fs.realpathSync(tmpRepo());
  const cfg = fs.realpathSync(tmpRepo());
  run(["init"], { cwd: repo });
  if (tracking) run(["set-spend-tracking", "on"], { cwd: repo });
  if (log) run(["set-dev-log", "on"], { cwd: repo });
  const file = path.join(cfg, "projects", encodeProjectPath(repo), "sA.jsonl");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const env = { CLAUDE_CONFIG_DIR: cfg };
  const t = Date.now() + 1000;
  const iso = (s) => new Date(t + s * 1000).toISOString();
  const usage = { input_tokens: 10, cache_creation_input_tokens: 20, cache_read_input_tokens: 400000, output_tokens: 5 };
  fs.writeFileSync(file, [
    j({ type: "user", timestamp: iso(0), message: { content: "hello there" } }),
    j({ type: "assistant", timestamp: iso(1), sessionId: "sA", message: { id: "d1", model: "claude-opus-4-7", content: [{ type: "tool_use", id: "t1", name: "Read", input: {} }], usage } }),
    j({ type: "user", timestamp: iso(2), message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "x".repeat(500) }] } }),
    j({ type: "system", subtype: "compact_boundary", timestamp: iso(3), sessionId: "sA", compactMetadata: { trigger: "auto", preTokens: 9, postTokens: 3 } }),
    j({ type: "assistant", timestamp: iso(4), sessionId: "sA", message: { id: "d2", model: "claude-opus-4-7", content: [{ type: "text", text: "done" }], usage: { ...usage, cache_read_input_tokens: 1000 } } }),
  ].join("\n") + "\n");
  fs.utimesSync(file, new Date(t), new Date(t));
  return { repo, cfg, env, file };
}
const dev = (cwd, env, args = []) => invokeEngine(["dev-log", ...args], { cwd, env });

test("2.1 dev-log ingests then reports the session: messages, tokens, composition, features and the warnings", () => {
  const s = scene();
  const r = dev(s.repo, s.env, ["--json"]);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.sessions.length, 1);
  const [sess] = out.sessions;
  assert.equal(sess.sessionId, "sA");
  assert.equal(sess.messages, 2);
  assert.equal(sess.composition.toolResults.Read, 500);
  assert.equal(sess.tokens.cacheRead, 401000);
  assert.deepEqual(sess.warnings.map((w) => w.rule).sort(), ["compacted", "large-context"]);
  assert.ok(sess.features, "a features snapshot is in force");
  assert.deepEqual(out.thresholds, { staleSessionDays: 7, largeContextTokens: 300000, status: "proposals" });
  const text = dev(s.repo, s.env).stdout;
  assert.match(text, /session sA: 2 message\(s\)/);
  assert.match(text, /composition \(BYTES, not tokens\)/);
});

test("2.1 --session-id narrows to that session; --no-ingest reads no transcript", () => {
  const s = scene();
  dev(s.repo, s.env);
  assert.equal(JSON.parse(dev(s.repo, s.env, ["--json", "--session-id", "nope"]).stdout).sessions.length, 0);
  assert.equal(JSON.parse(dev(s.repo, s.env, ["--json", "--session-id", "sA"]).stdout).sessions.length, 1);
  fs.rmSync(s.cfg, { recursive: true, force: true });
  const { result, touched } = recordFsPaths(() => dev(s.repo, s.env, ["--no-ingest", "--json"]));
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(touchedUnder(touched, s.cfg, path.join(s.cfg, "projects")), [], "--no-ingest opens no transcript path");
  assert.equal(JSON.parse(result.stdout).sessions.length, 1);
});

test("2.1 after `spend --clear --yes` a message reports `tokens: not in ledger`", () => {
  const s = scene();
  dev(s.repo, s.env);
  const cleared = invokeEngine(["spend", "--clear", "--yes"], { cwd: s.repo, env: s.env });
  assert.equal(cleared.status, 0, cleared.stderr);
  const sess = JSON.parse(dev(s.repo, s.env, ["--no-ingest", "--json"]).stdout).sessions[0];
  assert.match(sess.tokens.notInLedger, /tokens: not in ledger/);
  assert.ok(fs.existsSync(path.join(spendDir(s.repo), "devlog.jsonl")), "spend --clear leaves the developer log");
});

test("2.1 off (the log, or tracking) names the switch and opens no path under the spend directory or the transcripts", () => {
  for (const [opts, expect] of [[{ log: false }, /set-dev-log on/], [{ tracking: false, log: false }, /set-spend-tracking on/]]) {
    const s = scene(opts);
    fs.mkdirSync(spendDir(s.repo), { recursive: true });
    const { result, touched } = recordFsPaths(() => dev(s.repo, s.env));
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, expect);
    assert.deepEqual(touchedUnder(touched, spendDir(s.repo), s.cfg), [], "no spend or transcript path");
  }
});

// ── 2.2 the clear ──

const snapshotDir = (repo) => Object.fromEntries(walk(spendDir(repo)).filter((f) => f !== "ingest.lock").map((f) => [f, fs.readFileSync(path.join(spendDir(repo), f), "utf8")]));

test("2.2 `dev-log --clear` prints its plan and changes nothing; `--yes` removes devlog.jsonl only", () => {
  const s = scene();
  dev(s.repo, s.env);
  const before = snapshotDir(s.repo);
  assert.ok("devlog.jsonl" in before);
  const plan = dev(s.repo, s.env, ["--clear"]);
  assert.equal(plan.status, 0, plan.stderr);
  assert.match(plan.stdout, /would remove[\s\S]*devlog\.jsonl/);
  assert.match(plan.stdout, /Nothing was changed/);
  assert.deepEqual(snapshotDir(s.repo), before);
  const done = dev(s.repo, s.env, ["--clear", "--yes"]);
  assert.equal(done.status, 0, done.stderr);
  const after = snapshotDir(s.repo);
  const { "devlog.jsonl": _gone, ...rest } = before;
  assert.deepEqual(after, rest, "ledger rows, cursor, markers and timeline are unchanged");
});

test("2.2 `set-dev-log off` keeps the file, and a clear still works afterwards", () => {
  const s = scene();
  dev(s.repo, s.env);
  const log = fs.readFileSync(path.join(spendDir(s.repo), "devlog.jsonl"), "utf8");
  run(["set-dev-log", "off"], { cwd: s.repo });
  assert.equal(fs.readFileSync(path.join(spendDir(s.repo), "devlog.jsonl"), "utf8"), log);
  assert.equal(dev(s.repo, s.env, ["--clear", "--yes"]).status, 0);
  assert.equal(fs.existsSync(path.join(spendDir(s.repo), "devlog.jsonl")), false);
});

test("2.2 clearing with tracking off is refused, names set-spend-tracking on, and opens no spend path", () => {
  const s = scene({ tracking: false, log: false });
  const { result, touched } = recordFsPaths(() => dev(s.repo, s.env, ["--clear", "--yes"]));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /set-spend-tracking on/);
  assert.deepEqual(touchedUnder(touched, spendDir(s.repo)), []);
});

test("2.2 `--clear` takes only --yes: a report flag beside it is refused and nothing changes", () => {
  const s = scene();
  dev(s.repo, s.env);
  const before = snapshotDir(s.repo);
  for (const extra of ["--json", "--session-id", "--no-ingest"]) {
    const r = dev(s.repo, s.env, ["--clear", extra, ...(extra === "--session-id" ? ["sA"] : [])]);
    assert.notEqual(r.status, 0, extra);
  }
  assert.deepEqual(snapshotDir(s.repo), before);
});
