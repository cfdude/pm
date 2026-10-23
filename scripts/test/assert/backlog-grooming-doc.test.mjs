// scripts/test/assert/backlog-grooming-doc.test.mjs
// backlog-grooming-pass task 2.1: the grooming procedure is BYTES (a skill and a command doc), so it
// is checked on the file rung. The skill must carry each rule the spec requires, because a rule
// that is not written there is not followed (repo CLAUDE.md: a skill/required task reaches 14/14, a
// prose bullet 3/15). Reads files, spawns nothing.

import "../fixtures/assert-git-shim.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SKILL = path.join(REPO, "skills", "backlog-grooming", "SKILL.md");
const COMMAND = path.join(REPO, "commands", "backlog-grooming.md");
const LEDGER = path.join(REPO, "docs", "parity-ledger.json");

const read = p => fs.readFileSync(p, "utf8");

test("backlog-grooming: the skill and the command doc exist, and the ledger claims both in exactly one capability", () => {
  assert.ok(fs.existsSync(SKILL), "skills/backlog-grooming/SKILL.md");
  assert.ok(fs.existsSync(COMMAND), "commands/backlog-grooming.md");
  const caps = JSON.parse(read(LEDGER)).capabilities;
  for (const f of ["skills/backlog-grooming/SKILL.md", "commands/backlog-grooming.md"]) {
    assert.equal(caps.filter(c => c.artifacts.includes(f)).length, 1, `${f} claimed once`);
  }
});

test("backlog-grooming: the skill names the first read, triage, the disposition order and the no-line-number rule", () => {
  const s = read(SKILL);
  for (const status of ["untriaged", "queued", "active", "paused", "later", "blocked", "planned"]) {
    assert.match(s, new RegExp(status), `open status ${status}`);
  }
  assert.match(s, /list --status <status> --json/);
  assert.match(s, /triage/);
  // design D5 order: note on the survivor, then the supersedes link, then the superseded epic's disposition.
  const note = s.indexOf("--notes"), link = s.indexOf("supersedes:B"), done = s.indexOf("--outcome superseded");
  assert.ok(note > -1 && link > note && done > link, "note, then link, then archive");
  assert.match(s, /NEVER cite a line\s+number/);
  assert.match(s, /remove-epic/);
});

test("backlog-grooming: the skill states the stances the spec requires", () => {
  const s = read(SKILL).replace(/\s+/g, " ");
  assert.match(s, /null `createdAt` means age UNKNOWN/);
  assert.match(s, /re-reports of delivered work by reading archived epics/);
  assert.match(s, /reported as unfinished/);
  assert.match(s, /Report what you left alone/);
  assert.match(s, /Nothing is written before the user confirms/);
  assert.match(s, /Do not read `\.conductor\/state\.json` directly/);
});

test("backlog-grooming: the command doc states the read-only stance and points at the skill", () => {
  const c = read(COMMAND).replace(/\s+/g, " ");
  assert.match(c, /backlog-grooming/);
  assert.match(c, /read-only until you confirm/);
});
