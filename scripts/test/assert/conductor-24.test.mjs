// scripts/test/assert/conductor-24.test.mjs
// 5.3's ASSERTION TWIN of scripts/test/functional/conductor-24.test.mjs — same id, same subject.
//
// THE FUNCTIONAL FILE'S SUBJECT is the OBSERVATION mechanism itself (commit-watch): the reflog
// anchor, the observation record, and the rule that commit-nudge decides by OBSERVING the repo and
// never by reading the command text. Nearly all of it lands real commits, so it is functional by
// subject (design D5).
//
// THE OVERLAP THIS TWIN OWNS is the DECISION THE HOOK MAKES WHEN IT CANNOT OBSERVE ANYTHING, which is
// every invocation in this half: it must fall back to the advisory rather than going silent, must
// write NO observation record it could not ground, and must degrade rather than throw on a corrupt
// record. That is the same code path gh#104 ("decides by observing, not by reading the text") and the
// corrupt-record case exercise, in the world this half has.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, writeState, detourLog, autoDetourState } from "../fixtures/assert-harness.mjs";

const observePath = (cwd) => path.join(cwd, ".conductor", "commit-observe.json");
const nudge = (cwd, command) => run(["commit-nudge"], { cwd, input: JSON.stringify({ tool_input: { command } }) });

test("without a repository no observation record is written, and the advisory still fires", () => {
  const cwd = tmpRepo(); run(["init"], { cwd }); autoDetourState(cwd);
  const out = nudge(cwd, 'git commit -m "fix: something"');
  assert.match(out, /Commit detected/, "the hook ran to completion — an unverifiable HEAD is not a silence");
  assert.equal(fs.existsSync(observePath(cwd)), false,
    "an anchor with no repository to anchor against would be a record the hook invented");
});

test("a command that only MENTIONS a commit writes no record either (gh#104)", () => {
  const cwd = tmpRepo(); run(["init"], { cwd }); autoDetourState(cwd);
  nudge(cwd, "echo 'git commit -m nope'");
  nudge(cwd, "rg 'git commit' docs/");
  assert.equal(fs.existsSync(observePath(cwd)), false);
  assert.equal(detourLog(cwd), "");
});

test("a corrupt observation record degrades to the pre-observation path instead of throwing", () => {
  const cwd = tmpRepo(); run(["init"], { cwd }); autoDetourState(cwd);
  fs.writeFileSync(observePath(cwd), "{ this is not json");
  assert.doesNotThrow(() => nudge(cwd, "git commit -m x"));
  // The hook is a PostToolUse listener on EVERY Bash call; throwing here is a mid-session failure
  // for every user, which is why the rung must fall back rather than raise.
  assert.match(nudge(cwd, "git commit -m x"), /hookSpecificOutput/);
});

test("an unwritable/absent state avoids the auto-log entirely rather than guessing", () => {
  const cwd = tmpRepo();
  // No `init`: the hook fires in a directory that is not a conductor at all. It must do nothing.
  const out = run(["commit-nudge"], { cwd, input: JSON.stringify({ tool_input: { command: "git commit -m x" } }) });
  assert.equal(out.trim(), "", "dormant project: the hook emits nothing and creates nothing");
  assert.equal(fs.existsSync(path.join(cwd, ".conductor")), false);
});

// ───────────────────────── the deliberate omissions ─────────────────────────
//
// The functional file's positive cases — a backgrounded commit caught on the next call, every commit
// FORM being noticed, the anchor persisted on every invocation, and the cold-start -am/escaped-quote
// cases — all require a real repository whose reflog can be read. They are the observation
// mechanism's own subject and stay in the functional half (design D5); the four tests above are that
// mechanism's no-repository behaviour, which this half can prove on every commit.
