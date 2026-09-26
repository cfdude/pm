// scripts/test/assert/conductor-03.test.mjs
// 5.3's ASSERTION TWIN of scripts/test/functional/conductor-03.test.mjs — same id, same subject.
//
// THE FUNCTIONAL FILE'S SUBJECT is the active-pointer/autonomy/recompute family of verbs, and almost
// none of it is git's behaviour: set-active and clear-active move a pointer, set-autonomy records
// grants, and render/brief recompute the truth from state.json. It is in the functional half only
// because two of its tests land a real commit for commit-nudge's VERIFIED path — and that one test
// is the only thing this half cannot reach (design D5's placement rule).
//
// SO THIS TWIN CARRIES EVERY BEHAVIOUR OF THE FUNCTIONAL FILE THAT DOES NOT NEED A REPOSITORY, and
// this is the half where those alerts the fast half needs: the assertion half runs on EVERY commit,
// and the pointer/autonomy/recompute rules are exactly the ones a pre-commit gate must see break.
// The one deliberate omission is named at the bottom.
//
// ─────────────── 4.1 SPLIT THIS FILE, AND THIS IS THE FILE-RUNG HALF ───────────────
//
// SIXTEEN of its twenty-one tests moved to `scripts/test/unit/conductor-03.test.mjs` — every pointer
// move, all five `set-autonomy` tests, the two 🤖 rendering tests, and the whole
// recompute-don't-remember family.
//
// THE FIVE THAT STAY ARE ONE SEAM EDGE, not five judgments: each needs `withArchivedChange(cwd, id)`
// — or, once, a hand-written `mkdirSync` of `openspec/changes/archive/2026-07-08-done` — because
// "is this epic archived" is answered by whether that DIRECTORY exists. The fixture writes a path for
// the engine to read, which is the rule as written rather than an edge of it.
//
// No assertion changed in either direction.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, readState, writeState, projectMd, parseBrief, expectFail, withArchivedChange, archiveDay } from "../fixtures/assert-harness.mjs";

test("set-active rejects an unknown or archived id and writes nothing", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "real", "--lane", "claude-code"], { cwd });
  const before = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
  assert.ok(expectFail(() => run(["set-active", "ghost"], { cwd })), "unknown id rejected");
  assert.equal(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"), before);
  // archived id
  fs.mkdirSync(path.join(cwd, "openspec", "changes", "archive", `${archiveDay()}-done`), { recursive: true });
  run(["add-epic", "--id", "done", "--lane", "openspec"], { cwd });
  assert.ok(expectFail(() => run(["set-active", "done"], { cwd })), "archived id rejected");
});
test("isArchived recognizes a date-prefixed openspec archive dir (status flips, no ghost)", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  withArchivedChange(cwd, "feat-x");
  run(["render"], { cwd });
  const md = projectMd(cwd);
  assert.match(md, /`feat-x` \| openspec \| epic \| archived/);   // derived status = archived
  assert.doesNotMatch(md, /no change on disk/);                   // not a false ghost
});
test("brief does not show an archived epic as active, and stays read-only", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  withArchivedChange(cwd, "feat-x");
  const brief = parseBrief(cwd);
  assert.doesNotMatch(brief, /NOW: `feat-x`/);    // not presented as active
  assert.match(brief, /was archived/);            // honest note instead
  assert.equal(readState(cwd).active, "feat-x");  // brief did NOT mutate state (read path)
});
test("sync clears an archived active pointer and stamps archived status", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  withArchivedChange(cwd, "feat-x");
  run(["sync"], { cwd });
  const s = readState(cwd);
  assert.equal(s.active, null);
  assert.equal(s.epics.find(e => e.id === "feat-x").status, "archived");
});

// The assertion half's root is a fresh temporary directory with no repository above it, so this is
// the SAME repo-less situation the functional file's own unverifiable-path test uses — and here it
// is the only situation there is. The double answers headRef with status 128, so the hook cannot
// verify a commit and must self-heal on the unverifiable rung rather than going silent.
test("commit-nudge self-heals an archived active pointer when the commit cannot be verified", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  withArchivedChange(cwd, "feat-x");
  run(["commit-nudge"], { cwd, input: JSON.stringify({ tool_input: { command: 'git commit -m "archive feat-x"' } }) });
  const s = readState(cwd);
  assert.equal(s.active, null);
  assert.equal(s.epics.find(e => e.id === "feat-x").status, "archived");
});

// ───────── recompute-don't-remember: active validity + reconcileNeeded self-heal ─────────
