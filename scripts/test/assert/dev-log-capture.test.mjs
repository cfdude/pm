// scripts/test/assert/dev-log-capture.test.mjs
// developer-session-log 1.3 -- the FILE rung of capture: devlog.jsonl bytes after a real ingest over fixture
// transcripts, the cursor's carry across ingests, the switch-off path, the sentinel proof, and that no hook
// reaches the file. Fixture transcripts only; nothing here reads a real transcript.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, invokeEngine } from "../fixtures/assert-harness.mjs";
import { fakeGit } from "../fixtures/fake-git.mjs";
import { recordFsPaths, touchedUnder } from "../fixtures/fs-path-recorder.mjs";
import { SENTINEL, buildTranscriptTree, walk } from "../fixtures/spend-transcripts.mjs";
import { ingest, rebuild } from "../../lib/spend-ledger.mjs";
import { spendDir } from "../../lib/spend-tree.mjs";
import { encodeProjectPath } from "../../lib/spend-reader.mjs";
import { appendDevLog, readDevLog } from "../../lib/dev-log-capture.mjs";

const NOW = Date.now();
const iso = (sec) => new Date(NOW + sec * 1000).toISOString();
const j = (o) => JSON.stringify(o);
const asst = (id, sec, content, extra = {}) => j({
  type: "assistant", timestamp: iso(sec), sessionId: "sA", isSidechain: false, agentId: null,
  message: { id, model: "claude-opus-4-7", content, usage: { input_tokens: 1, cache_creation_input_tokens: 2, cache_read_input_tokens: 3, output_tokens: 4 } }, ...extra,
});
const userStr = (s) => j({ type: "user", timestamp: iso(0), message: { content: s } });
const toolResult = (id, body) => j({ type: "user", timestamp: iso(0), message: { content: [{ type: "tool_result", tool_use_id: id, content: body }] } });
const snapshot = (on) => () => ({ features: { spendGuard: { on, bytes: on ? 806 : 0 } }, surfaces: { "rules:spend-guard": on ? 806 : 0 } });

/** A repo, a transcript root, and a one-session main transcript the test appends to. */
function scene() {
  const repo = fs.realpathSync(tmpRepo());
  const cfg = fs.realpathSync(tmpRepo());
  const file = path.join(cfg, "projects", encodeProjectPath(repo), "sA.jsonl");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const append = (lines) => fs.appendFileSync(file, lines.join("\n") + "\n");
  const opts = (devLog = { enabledAtMs: NOW - 60_000, snapshot: snapshot(false) }) =>
    ({ mainRoot: repo, env: { CLAUDE_CONFIG_DIR: cfg }, home: "/no/such/home", enabledAtMs: NOW - 60_000, ...(devLog ? { devLog } : {}) });
  const log = () => {
    try { return fs.readFileSync(path.join(spendDir(repo), "devlog.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
  };
  const messages = () => log().filter((e) => e.type === "message");
  return { repo, cfg, file, append, opts, log, messages };
}

test("1.3 ingest appends one entry per new assistant message, keyed by messageId", () => {
  const s = scene();
  s.append([userStr("hi"), asst("m1", 1, [{ type: "text", text: "a" }]), asst("m2", 2, [{ type: "text", text: "bb" }])]);
  ingest(s.opts());
  const m = s.messages();
  assert.deepEqual(m.map((e) => e.messageId), ["m1", "m2"]);
  assert.equal(m[0].userText, 2);
  assert.equal(m[1].textBytes, 2);
  assert.equal(s.log().filter((e) => e.type === "features").length, 1);
});

test("1.3 the entry carries no token count, and the tokens come from the ledger row by messageId", () => {
  const s = scene();
  s.append([asst("m1", 1, [{ type: "text", text: "a" }])]);
  ingest(s.opts());
  const e = s.messages()[0];
  for (const k of ["input", "cacheCreation", "cacheRead", "output", "tools"]) assert.equal(k in e, false, k);
  const rows = fs.readFileSync(path.join(spendDir(s.repo), "rows.jsonl"), "utf8");
  assert.ok(rows.includes('"messageId":"m1"'));
});

test("1.3 re-ingest over unchanged transcripts is idempotent, and a later message adds only itself", () => {
  const s = scene();
  s.append([asst("m1", 1, [{ type: "text", text: "a" }])]);
  ingest(s.opts());
  const first = fs.readFileSync(path.join(spendDir(s.repo), "devlog.jsonl"), "utf8");
  ingest(s.opts());
  assert.equal(fs.readFileSync(path.join(spendDir(s.repo), "devlog.jsonl"), "utf8"), first);
  s.append([asst("m2", 5, [{ type: "text", text: "b" }])]);
  ingest(s.opts());
  assert.deepEqual(s.messages().map((e) => e.messageId), ["m1", "m2"]);
});

test("1.3 request bytes and tool names survive the cursor between two real ingests", () => {
  const s = scene();
  s.append([asst("m0", 1, [{ type: "tool_use", id: "t1", name: "Read", input: {} }])]);
  ingest(s.opts());
  s.append([toolResult("t1", "r".repeat(321)), userStr("later prompt")]);
  ingest(s.opts());
  s.append([asst("m1", 9, [{ type: "text", text: "z" }])]);
  ingest(s.opts());
  const m1 = s.messages().find((e) => e.messageId === "m1");
  assert.deepEqual(m1.toolResults, { Read: 321 });
  assert.equal(m1.userText, "later prompt".length);
});

test("1.3 spend --rebuild does not duplicate entries", () => {
  const s = scene();
  s.append([asst("m1", 1, [{ type: "text", text: "a" }]), asst("m2", 2, [{ type: "text", text: "b" }])]);
  ingest(s.opts());
  rebuild(s.opts());
  rebuild(s.opts());
  const ids = s.messages().map((e) => e.messageId);
  assert.deepEqual(ids, ["m1", "m2"]);
});

test("1.3 with the log off, ingest writes no devlog.jsonl and the ledger and cursor are exactly what they were", () => {
  const on = scene();
  const off = scene();
  for (const s of [on, off]) s.append([userStr("hi"), asst("m1", 1, [{ type: "text", text: "a" }])]);
  ingest(on.opts());
  ingest(off.opts(null));
  assert.equal(fs.existsSync(path.join(spendDir(off.repo), "devlog.jsonl")), false);
  const cursor = (s) => JSON.parse(fs.readFileSync(path.join(spendDir(s.repo), "cursor.json"), "utf8"));
  const [offEntry] = Object.values(cursor(off));
  assert.deepEqual(Object.keys(offEntry).sort(), ["dev", "ino", "offset", "size", "userSeen"], "today's cursor shape, byte for byte");
  const strip = (c) => Object.values(c).map(({ devState, ...rest }) => rest);
  assert.deepEqual(strip(cursor(on)).map(({ ino, dev, ...r }) => r), strip(cursor(off)).map(({ ino, dev, ...r }) => r));
  const rows = (s) => fs.readFileSync(path.join(spendDir(s.repo), "rows.jsonl"), "utf8").replace(/"source":"[^"]*"/g, "");
  assert.equal(rows(on), rows(off), "the ledger rows are identical with the log on or off");
});

test("1.3 SENTINEL text in prompts, responses, tool inputs, tool outputs and attachments never reaches devlog.jsonl or the cursor", () => {
  const repo = fs.realpathSync(tmpRepo());
  const cfg = fs.realpathSync(tmpRepo());
  buildTranscriptTree(cfg, repo);
  const FRESH = new Date("2026-10-09T12:00:00.000Z");
  for (const f of walk(cfg)) fs.utimesSync(path.join(cfg, f), FRESH, FRESH);
  const enabled = Date.parse("2026-10-01T00:00:00.000Z");
  ingest({ mainRoot: repo, env: { CLAUDE_CONFIG_DIR: cfg }, home: "/no/such/home", enabledAtMs: enabled, devLog: { enabledAtMs: enabled, snapshot: snapshot(false) } });
  const dir = spendDir(repo);
  const dev = fs.readFileSync(path.join(dir, "devlog.jsonl"), "utf8");
  assert.ok(dev.includes('"type":"message"'), "the fixture produced entries");
  assert.ok(!dev.includes(SENTINEL), "devlog.jsonl holds no fixture text");
  assert.ok(!fs.readFileSync(path.join(dir, "cursor.json"), "utf8").includes(SENTINEL), "nor does the cursor's carry");
});

// ── the verb level: every ingest caller captures, and no hook reaches the file ──

function verbScene() {
  const repo = fs.realpathSync(tmpRepo());
  const cfg = fs.realpathSync(tmpRepo());
  run(["init"], { cwd: repo });
  run(["add-epic", "--id", "e1", "--title", "e1", "--lane", "claude-code"], { cwd: repo });
  run(["set-spend-tracking", "on"], { cwd: repo });
  run(["set-dev-log", "on"], { cwd: repo });
  const file = path.join(cfg, "projects", encodeProjectPath(repo), "sA.jsonl");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const t = Date.now() + 1000;
  fs.writeFileSync(file, [
    userStr("hi"),
    j({ type: "assistant", timestamp: new Date(t).toISOString(), sessionId: "sA", message: { id: "v1", model: "claude-opus-4-7", content: [{ type: "text", text: "a" }], usage: { input_tokens: 1, output_tokens: 1 } } }),
  ].join("\n") + "\n");
  fs.utimesSync(file, new Date(t), new Date(t));
  return { repo, cfg, env: { CLAUDE_CONFIG_DIR: cfg } };
}
const devlogIds = (repo) => {
  try { return fs.readFileSync(path.join(spendDir(repo), "devlog.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.type === "message").map((e) => e.messageId); } catch { return []; }
};

test("1.3 `spend` captures, and so does `spend-guard`: every ingest caller shares one switch", () => {
  const a = verbScene();
  const r = invokeEngine(["spend", "--json"], { cwd: a.repo, env: a.env });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(devlogIds(a.repo), ["v1"]);
  const b = verbScene();
  const g = invokeEngine(["spend-guard", "e1"], { cwd: b.repo, env: b.env });
  assert.ok([0, 2].includes(g.status), g.stderr);
  assert.deepEqual(devlogIds(b.repo), ["v1"], "spend-guard's ingest advances the shared cursor, so it must capture");
});

test("1.3 turning the log off stops capture and keeps the file", () => {
  const a = verbScene();
  invokeEngine(["spend"], { cwd: a.repo, env: a.env });
  const before = fs.readFileSync(path.join(spendDir(a.repo), "devlog.jsonl"), "utf8");
  run(["set-dev-log", "off"], { cwd: a.repo });
  const file = path.join(a.cfg, "projects", encodeProjectPath(a.repo), "sA.jsonl");
  const t = Date.now() + 5000;
  fs.appendFileSync(file, j({ type: "assistant", timestamp: new Date(t).toISOString(), sessionId: "sA", message: { id: "v2", model: "claude-opus-4-7", content: [], usage: { input_tokens: 1, output_tokens: 1 } } }) + "\n");
  fs.utimesSync(file, new Date(t), new Date(t));
  invokeEngine(["spend"], { cwd: a.repo, env: a.env });
  assert.equal(fs.readFileSync(path.join(spendDir(a.repo), "devlog.jsonl"), "utf8"), before);
});

test("1.3 no hook opens or stats devlog.jsonl, with the log on", () => {
  const a = verbScene();
  invokeEngine(["spend"], { cwd: a.repo, env: a.env });
  const payload = (event) => JSON.stringify({ hook_event_name: event, tool_name: "Bash", tool_input: { command: "ls" }, session_id: "s1" });
  const hooks = [["brief", "SessionStart"], ["snapshot", "PreCompact"], ["commit-nudge", "PostToolUse"], ["gate-guard", "PreToolUse"], ["lesson-advice", "PreToolUse"]];
  for (const [hook, event] of hooks) {
    const { result, touched } = recordFsPaths(() => invokeEngine([hook, "--platform", "claude-code"], {
      cwd: a.repo, git: fakeGit({ noRepository: true }), env: a.env, input: payload(event),
    }));
    assert.equal(result.status, 0, `${hook}: ${result.stderr}`);
    assert.deepEqual(touchedUnder(touched, spendDir(a.repo)), [], `${hook} touches nothing under the spend directory`);
    assert.deepEqual(touched.filter((p) => p.endsWith("devlog.jsonl")), []);
  }
});

// ── 1.4 the features snapshot ──

const features = (repo) => {
  try { return fs.readFileSync(path.join(spendDir(repo), "devlog.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.type === "features"); } catch { return []; }
};

test("1.4 an unchanged configuration appends no second snapshot; a switch change appends one", () => {
  const a = verbScene();
  invokeEngine(["spend"], { cwd: a.repo, env: a.env });
  invokeEngine(["spend"], { cwd: a.repo, env: a.env });
  assert.equal(features(a.repo).length, 1);
  assert.equal(features(a.repo)[0].features.spendGuard.on, false);
  run(["set-spend-guard", "--max-failed-rounds", "2"], { cwd: a.repo });
  invokeEngine(["spend"], { cwd: a.repo, env: a.env });
  const f = features(a.repo);
  assert.equal(f.length, 2);
  assert.equal(f[1].features.spendGuard.on, true);
  assert.ok(f[1].features.spendGuard.bytes > 0);
  assert.ok(f[1].surfaces["rules:spend-guard"] > 0);
});

test("1.4 the snapshot omits the surfaces that follow the record's history, and keeps the rest", () => {
  const a = verbScene();
  invokeEngine(["spend"], { cwd: a.repo, env: a.env });
  const [snap] = features(a.repo);
  assert.equal("brief" in snap.surfaces, false);
  assert.equal("snapshot" in snap.surfaces, false);
  assert.ok(snap.surfaces["rules:intake"] > 0);
  assert.equal(snap.features.spendTracking.on, true);
  assert.equal(snap.features.devLog.on, true);
});

test("1.4 the snapshot takes `on` from `overhead`, never from an OPT_INS row's isSet", () => {
  const src = fs.readFileSync(new URL("../../lib/dev-log.mjs", import.meta.url), "utf8");
  const body = src.slice(src.indexOf("export function featuresSnapshot"), src.indexOf("export function devLogOptions"));
  assert.ok(body.includes("buildReport("));
  assert.equal(/isSet/.test(body), false);
});

test("1.3 an append after a torn write starts on its own line instead of gluing to the partial one", () => {
  const repo = fs.realpathSync(tmpRepo());
  const file = path.join(spendDir(repo), "devlog.jsonl");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const whole = JSON.stringify({ type: "features", at: iso(0), features: { a: 1 }, surfaces: {} });
  fs.writeFileSync(file, whole + '\n{"type":"features","at":"torn');
  const r = appendDevLog(repo, [], () => ({ features: { spendGuard: { on: true, bytes: 1 } }, surfaces: {} }));
  assert.equal(r.snapshotAppended, true);
  const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
  assert.equal(lines.length, 3, "whole line, torn line, the new entry");
  assert.doesNotThrow(() => JSON.parse(lines[2]), "the new entry is a complete line of its own");
  assert.equal(JSON.parse(lines[2]).features.spendGuard.bytes, 1);
  assert.equal(readDevLog(repo).corrupt, 1, "only the torn line is unreadable");
});
