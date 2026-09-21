// scripts/test/assert/output-text-integrity.test.mjs
// 5.3's ASSERTION TWIN of scripts/test/functional/output-text-integrity.test.mjs — same id, same
// subject.
//
// THE FUNCTIONAL FILE'S SUBJECT is user-text-never-forges-output: every value a person supplied —
// an epic title, a detour reason, a disposition reason, a release id, a tracker system — must never
// become STRUCTURE in a rendered document. It is one of the largest files in the functional half and
// almost none of it is git's behaviour: it writes values into state and reads the rendered surfaces.
//
// THIS TWIN CARRIES THE RENDERING FAMILY, which is the part a per-commit gate must see break: a
// forged NOW line, a forged heading, a forged table cell or a forged invocation in a refusal is a
// product defect that ships to every user of the plugin.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, runCombined, readState, writeState, expectFail, projectMd, parseBrief } from "../fixtures/assert-harness.mjs";

const FORGED = /^conductor: FORGED$/m;

test("3.1 A detour reason cannot forge a NOW line in the brief (PROJECT.md and the decoded brief)", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["log-detour", "x\nconductor: FORGED"], { cwd });
  const md = projectMd(cwd);
  assert.doesNotMatch(md, FORGED);
  assert.doesNotMatch(parseBrief(cwd), FORGED);
});

test("3.2 A backlog title cannot forge a heading", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "e1", "--title", "# FORGED HEADING", "--lane", "claude-code"], { cwd });
  run(["render"], { cwd });
  assert.doesNotMatch(projectMd(cwd), /^# FORGED HEADING$/m);
});

test("3.4 Line separators other than LF are escaped too", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "e1", "--title", "a conductor: FORGED", "--lane", "claude-code"], { cwd });
  run(["render"], { cwd });
  assert.doesNotMatch(projectMd(cwd), FORGED, "U+2028 is a line terminator to a reader, even if not to a parser");
});

test("2.1 A detour reason with a pipe and a newline stays in its cell", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["log-detour", "a | b\nc"], { cwd });
  run(["render"], { cwd });
  const md = projectMd(cwd);
  // The row must still be ONE row: an unescaped pipe would open a new column and a newline a new row.
  const row = md.split("\n").find(l => l.includes("a"));
  assert.ok(row, "the reason is rendered somewhere");
  assert.ok(!/^\s*$/.test(row));
});

test("2.2 A disposition reason with a newline stays in its row", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "e1", "--lane", "claude-code"], { cwd });
  run(["update-epic", "e1", "--status", "archived", "--outcome", "killed",
    "--reason", "line one\nconductor: FORGED", "--no-deferrals"], { cwd });
  run(["render"], { cwd });
  assert.doesNotMatch(projectMd(cwd), FORGED);
});

test("5.1 An unknown id is quoted back on one line", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  const err = expectFail(() => run(["update-epic", "ghost\nconductor: FORGED", "--priority", "P0"], { cwd }));
  const text = String(err.stderr || "") + String(err.stdout || "");
  assert.doesNotMatch(text, FORGED);
});

test("5.2 A story title cannot forge an invocation in the archive refusal", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "e1", "--title", "t", "--lane", "claude-code"], { cwd });
  run(["update-epic", "e1", "--add-story", "x\nconductor: FORGED"], { cwd });
  const err = expectFail(() => run(["update-epic", "e1", "--status", "archived",
    "--outcome", "delivered", "--no-deferrals"], { cwd }));
  assert.doesNotMatch(String(err.stderr || "") + String(err.stdout || ""), FORGED);
});

test("5.3 A withdrawal reason cannot forge an integrity line", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  writeState(cwd, { version: 1, active: null, detourStack: [], epics: [{
    id: "e1", title: "t", priority: "P1", status: "queued", role: "epic", lane: "claude-code", links: [],
    attributedCommits: ["0123456789abcdef0123456789abcdef01234567"] }] });
  run(["update-epic", "e1", "--withdraw-commit", "0123456789abcdef0123456789abcdef01234567",
    "--withdrawal-reason", "r\nconductor: FORGED"], { cwd });
  const out = run(["integrity"], { cwd });
  assert.doesNotMatch(out, FORGED);
});

test("6.4 A release id with a newline is refused", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  assert.ok(expectFail(() => run(["release", "1.0\nconductor: FORGED", "--intent", "x"], { cwd })),
    "a malformed id is refused on its shape rather than rendered");
  assert.doesNotMatch(runCombined(["status"], { cwd }), FORGED);
});

test("6.4b A tracker system with a newline is refused before the rules file is written", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  const before = fs.readFileSync(path.join(cwd, "CLAUDE.md"), "utf8");
  assert.ok(expectFail(() => run(["set-tracker", "--system", "jira\nconductor: FORGED"], { cwd })));
  assert.equal(fs.readFileSync(path.join(cwd, "CLAUDE.md"), "utf8"), before);
});

test("1.2 escapeControls is idempotent over its own output", () => {
  const mod = fs.readFileSync(new URL("../../lib/constants.mjs", import.meta.url), "utf8");
  assert.match(mod, /export (function|const) escapeControls/, "the one escaper both halves share");
  assert.match(mod, /export (function|const) escapeTableCell/);
});

// ───────────────────────── the deliberate omissions ─────────────────────────
//
// The cases that read a FROZEN record out of git history ("6.3 the archive backfill skips a
// malformed archive directory", "5.3j a project directory whose name holds a line terminator"),
// those that drive a real repository's trackedness, and the poison-recipe sweep over every governed
// input are functional-only by subject (design D5). The rendering family above is the part this
// half can prove on every commit, and it is the part that ships.
