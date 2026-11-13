// scripts/test/assert/overhead-survey.test.mjs
// pm-overhead-calibration-and-feature-switches B2 -- the survey WALK. FILE rung: it needs bytes on disk
// (a fixture tree in a temp dir, and the real hooks/hooks.json). The walk is called IN-PROCESS; nothing
// here spawns a process. Fixture lines are SYNTHETIC; no real transcript is copied.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpRepo } from "../fixtures/assert-harness.mjs";
import { BRIEF_HOOK } from "../../measure/overhead-survey-core.mjs";
import { runSurvey, parseSurveyArgs, defaultPaths } from "../../measure/overhead-survey.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const BRIEF_CMD = 'node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" brief --platform claude-code';

const line = (o) => JSON.stringify(o);
const hook = (entrypoint = "cli") => line({
  type: "attachment", entrypoint,
  attachment: { type: "hook_success", hookName: "SessionStart:startup", command: BRIEF_CMD, exitCode: 0, content: "SECRET-BRIEF" },
});
const asst = (id = "m1", cc = 1000, entrypoint = "cli") => line({
  type: "assistant", entrypoint, timestamp: "2026-10-29T10:00:01.000Z", sessionId: "SECRET-SESSION-ID",
  message: { id, model: "claude-opus-4-7", content: [{ type: "text", text: "SECRET-PROMPT" }],
    usage: { input_tokens: 2, cache_creation_input_tokens: cc, cache_read_input_tokens: 5, output_tokens: 9 } },
});
const usr = () => line({ type: "user", message: { role: "user", content: "SECRET-USER" } });

function tmpTree() {
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, "root"));
  fs.mkdirSync(path.join(dir, "out", ".raw"), { recursive: true });
  return { dir, rawDir: path.join(dir, "out", ".raw"), root: path.join(dir, "root"), out: path.join(dir, "out", "agg.json"), rows: path.join(dir, "out", ".raw", "rows.json") };
}
const put = (root, proj, file, lines) => {
  fs.mkdirSync(path.join(root, proj), { recursive: true });
  fs.writeFileSync(path.join(root, proj, file), lines.join("\n") + "\n");
};
const done = (t) => fs.rmSync(t.dir, { recursive: true, force: true });

test("B2 BRIEF_HOOK matches the SessionStart command in the real hooks/hooks.json", () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(REPO, "hooks", "hooks.json"), "utf8"));
  const cmds = hooks.hooks.SessionStart.flatMap((g) => g.hooks.map((h) => h.command));
  assert.ok(cmds.length > 0);
  for (const c of cmds) assert.match(c, BRIEF_HOOK, c);
});

test("B2 a project dir named with a leading dash is walked, and a session is counted", async () => {
  const t = tmpTree();
  try {
    put(t.root, "--tmp-claude-501-proj", "s1.jsonl", [hook(), asst(), usr()]);
    const r = await runSurvey({ root: t.root, out: t.out, rowsOut: t.rows, rawDir: t.rawDir });
    assert.equal(r.stats.filesRead, 1);
    assert.equal(r.aggregate.population.headlineSessions, 1);
    assert.equal(r.aggregate.groups[0].briefPresent, true);
  } finally { done(t); }
});

test("B2 a subagents/ file is not read", async () => {
  const t = tmpTree();
  try {
    put(t.root, "-p", "s1.jsonl", [hook(), asst(), usr()]);
    put(t.root, path.join("-p", "s1", "subagents"), "agent-x.jsonl", [hook(), asst("sub"), usr()]);
    const r = await runSurvey({ root: t.root, out: t.out, rowsOut: t.rows, rawDir: t.rawDir });
    assert.equal(r.stats.filesRead, 1);
    assert.equal(r.aggregate.population.headlineSessions, 1);
  } finally { done(t); }
});

test("B2 bytes after the first message are never parsed: garbage there still yields the row", async () => {
  const t = tmpTree();
  try {
    put(t.root, "-p", "s1.jsonl", [hook(), asst(), usr(), "}{ garbage \u0000\u0001 not json", "x".repeat(200000)]);
    const r = await runSurvey({ root: t.root, out: t.out, rowsOut: t.rows, rawDir: t.rawDir });
    assert.equal(r.aggregate.population.headlineSessions, 1);
    assert.equal(r.aggregate.excluded.byReason["oversize-line"], undefined);
  } finally { done(t); }
});

test("B2 an oversize line BEFORE the first message voids the session with a counted reason", async () => {
  const t = tmpTree();
  try {
    put(t.root, "-p", "s1.jsonl", [hook(), "y".repeat(5000), asst(), usr()]);
    const r = await runSurvey({ root: t.root, out: t.out, rowsOut: t.rows, rawDir: t.rawDir, maxLineChars: 1000 });
    assert.equal(r.aggregate.population.headlineSessions, 0);
    assert.equal(r.aggregate.excluded.byReason["oversize-line"], 1);
  } finally { done(t); }
});

test("B2 Highway and employer-hosted project dirs are never opened; they are counted by reason", async () => {
  const t = tmpTree();
  try {
    put(t.root, "-Users-x-Documents-Highway-thing", "s1.jsonl", [hook(), asst(), usr()]);
    put(t.root, "-Users-x-Documents-Repos-highway-llm", "s1.jsonl", [hook(), asst(), usr()]);
    put(t.root, "-Users-x-Servers-zendesk-mcp", "s1.jsonl", [hook(), asst(), usr()]);
    put(t.root, "-Users-x-Documents-Repos-pm", "s1.jsonl", [hook(), asst(), usr()]);
    const r = await runSurvey({ root: t.root, out: t.out, rowsOut: t.rows, rawDir: t.rawDir });
    assert.equal(r.stats.filesRead, 1);
    assert.equal(r.aggregate.excluded.byReason["project-highway"], 2);
    assert.equal(r.aggregate.excluded.byReason["project-employer-repo"], 1);
    const rows = JSON.parse(fs.readFileSync(t.rows, "utf8"));
    assert.deepEqual(rows.map((x) => x.project), ["-Users-x-Documents-Repos-pm"]);
  } finally { done(t); }
});

test("B2 neither output file contains any fixture text; the aggregate names no project or session", async () => {
  const t = tmpTree();
  try {
    put(t.root, "-Users-x-Repos-pm", "SECRET-FILE-NAME.jsonl", [hook(), asst(), usr()]);
    put(t.root, "-Users-x-Repos-other", "s2.jsonl", [asst("m1", 10, "sdk-py"), usr()]);
    await runSurvey({ root: t.root, out: t.out, rowsOut: t.rows, rawDir: t.rawDir });
    for (const f of [t.out, t.rows]) {
      const text = fs.readFileSync(f, "utf8");
      assert.doesNotMatch(text, /SECRET/, f);
    }
    const agg = fs.readFileSync(t.out, "utf8");
    assert.doesNotMatch(agg, /Users-x|Repos-pm|Repos-other/);
    const rows = JSON.parse(fs.readFileSync(t.rows, "utf8"));
    assert.deepEqual(Object.keys(rows[0]).sort(),
      ["briefPresent", "cacheCreation", "cacheRead", "entrypoint", "input", "model", "project", "start"]);
  } finally { done(t); }
});

test("B2 a directory merely NAMED .raw is not the repo's .raw: default rawDir refuses it", async () => {
  const t = tmpTree();
  try {
    put(t.root, "-p", "s1.jsonl", [hook(), asst(), usr()]);
    await assert.rejects(runSurvey({ root: t.root, out: t.out, rowsOut: t.rows }), /\.raw/);
    assert.equal(fs.existsSync(t.rows), false);
  } finally { done(t); }
});

test("B2 the rows file never lands outside a .raw/ directory", async () => {
  const t = tmpTree();
  try {
    put(t.root, "-p", "s1.jsonl", [hook(), asst(), usr()]);
    await assert.rejects(
      runSurvey({ root: t.root, out: t.out, rowsOut: path.join(t.dir, "out", "rows.json"), rawDir: t.rawDir }),
      /\.raw/,
    );
    assert.equal(fs.existsSync(path.join(t.dir, "out", "rows.json")), false);
  } finally { done(t); }
});

test("B2 a missing root fails loudly and writes nothing", async () => {
  const t = tmpTree();
  try {
    await assert.rejects(runSurvey({ root: path.join(t.dir, "nope"), out: t.out, rowsOut: t.rows, rawDir: t.rawDir }), /transcript root/);
    assert.equal(fs.existsSync(t.out), false);
  } finally { done(t); }
});

test("B2 flags: --root, --out, --rows-out parse; an unknown flag is refused; defaults sit under docs/measurement", () => {
  const ok = parseSurveyArgs(["--root", "/a", "--out", "/b/o.json", "--rows-out", "/c/.raw/r.json"]);
  assert.deepEqual([ok.root, ok.out, ok.rowsOut], ["/a", "/b/o.json", "/c/.raw/r.json"]);
  assert.match(parseSurveyArgs(["--bogus"]).error, /--bogus/);
  assert.match(parseSurveyArgs(["--root"]).error, /--root/);
  const d = defaultPaths();
  assert.equal(d.out, path.join(REPO, "docs", "measurement", "2026-10-overhead-survey.json"));
  assert.equal(d.rowsOut, path.join(REPO, "docs", "measurement", ".raw", "overhead-survey-rows.json"));
});

test("B2 docs/measurement/.raw/ is git-ignored", () => {
  const ignore = fs.readFileSync(path.join(REPO, ".gitignore"), "utf8").split("\n").map((l) => l.trim());
  assert.ok(ignore.includes("docs/measurement/.raw/"));
});
