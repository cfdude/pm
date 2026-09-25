// scripts/test/assert/lesson-detect-corpus.test.mjs
// The `detect:` contract over a corpus ON DISK: lesson files a repository wrote, read by the
// classifier and by the `lesson-advice` hook. File rung because the subject is the bytes of
// `docs/lessons/*.md` — CRLF line endings, a malformed frontmatter value — which the store does
// not own. The pure verdicts are the unit rung's (unit/lesson-detect-rules.test.mjs).
//
// Code review 0.43.0 (C1, C2) and #194: CRLF frontmatter was silently inert, a typo'd key matched
// every tool call, and a malformed `detect:` was discarded with nothing anywhere saying so.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, invokeEngine } from "../fixtures/assert-harness.mjs";
import { classifyLessons } from "../../lib/lessons.mjs";

function initRepo() {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  return cwd;
}

/** Write a lesson; `eol` lets a test save it the way a Windows editor would. */
function lesson(cwd, slug, fields, eol = "\n") {
  const dir = path.join(cwd, "docs", "lessons");
  fs.mkdirSync(dir, { recursive: true });
  const fm = Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join(eol);
  fs.writeFileSync(path.join(dir, `${slug}.md`), `---${eol}${fm}${eol}---${eol}${eol}Body.${eol}`);
  return dir;
}

function advice(cwd, event) {
  const r = invokeEngine(["lesson-advice"], { cwd, input: JSON.stringify(event) });
  assert.equal(r.status, 0, `the advisor never blocks\n${r.stderr}`);
  return r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : "";
}

test("a CRLF-saved lesson fires exactly like its LF twin (C1)", () => {
  const cwd = initRepo();
  lesson(cwd, "crlf-lesson", {
    detect: '{"tool":"Bash","commandMatches":"gh pr merge"}', rule: "CRLF rule fires",
  }, "\r\n");
  assert.match(advice(cwd, { tool_name: "Bash", tool_input: { command: "gh pr merge 3" } }), /CRLF rule fires/);
  // The rule itself must not carry the carriage return into the advice.
  assert.doesNotMatch(advice(cwd, { tool_name: "Bash", tool_input: { command: "gh pr merge 3" } }), /\r/);
});

test("a typo'd detect key no longer matches every tool call (C2 repro)", () => {
  const cwd = initRepo();
  lesson(cwd, "typo", { detect: '{"tool":"Bash","commandMatch":"gh pr merge"}', rule: "typo rule" });
  assert.equal(advice(cwd, { tool_name: "Bash", tool_input: { command: "ls" } }), "");
});

test("classifyLessons names every rejected matcher and why, apart from retrieval-only lessons (#194)", () => {
  const cwd = initRepo();
  lesson(cwd, "bare-regex", { detect: "(str\\.replace|sed -i)", rule: "r" });
  lesson(cwd, "typo", { detect: '{"tool":"Bash","commandMatch":"x"}', rule: "r" });
  lesson(cwd, "catastrophic", { detect: '{"tool":"Bash","commandMatches":"^(a+)+$"}', rule: "r" });
  lesson(cwd, "empty", { detect: "", rule: "r" });
  lesson(cwd, "good", { detect: '{"tool":"Edit","pathEndsWith":"CLAUDE.md"}', rule: "good rule" });
  const dir = lesson(cwd, "no-matcher", { rule: "retrieval only by design" });
  const c = classifyLessons(dir);
  assert.deepEqual(c.matchable.map(l => [l.file, l.rule]), [["good.md", "good rule"]]);
  assert.deepEqual(c.retrievalOnly, ["no-matcher.md"]);
  const reasons = Object.fromEntries(c.rejected.map(r => [r.file, r.reason]));
  assert.deepEqual(Object.keys(reasons).sort(), ["bare-regex.md", "catastrophic.md", "empty.md", "typo.md"]);
  assert.match(reasons["bare-regex.md"], /not JSON/);
  assert.match(reasons["typo.md"], /unknown key "commandMatch"/);
  assert.match(reasons["catastrophic.md"], /nests an unbounded quantifier/);
  assert.match(reasons["empty.md"], /empty/);
});

test("the hook stays silent about rejects — a malformed corpus is not advice", () => {
  const cwd = initRepo();
  lesson(cwd, "bare-regex", { detect: "(ls)", rule: "r" });
  lesson(cwd, "typo", { detect: '{"tool":"Bash","commandMatch":"ls"}', rule: "r" });
  const r = invokeEngine(["lesson-advice"], {
    cwd, input: JSON.stringify({ tool_name: "Bash", tool_input: { command: "ls" } }),
  });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "");
  assert.equal(r.stderr, "");
});

test("a NotebookEdit path matcher fires through the hook", () => {
  const cwd = initRepo();
  lesson(cwd, "nb", { detect: '{"tool":"NotebookEdit","pathEndsWith":".ipynb"}', rule: "notebook rule" });
  assert.match(advice(cwd, { tool_name: "NotebookEdit", tool_input: { notebook_path: "/x/a.ipynb" } }),
    /notebook rule/);
});
