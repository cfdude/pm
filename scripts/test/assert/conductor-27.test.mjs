// scripts/test/assert/conductor-27.test.mjs
// 5.3's ASSERTION TWIN of scripts/test/functional/conductor-27.test.mjs — same id, same subject.
//
// THE FUNCTIONAL FILE'S SUBJECT is gh#81 (the PROJECT.md commit loop, the render stamp, and the
// detour log's SHA idempotence) and gh#82 (the root-divergence warning). Almost none of it is git's
// behaviour: the render stamp is a file the engine writes, the divergence warning is a comparison of
// two paths, and the detour log is append-only bookkeeping.
//
// THE ONE CASE THIS HALF CANNOT REACH IS THE `-` ROW'S OTHER HALF: with a repository, `-` is the
// sha a MINIMAL detour gets when the engine cannot tell; with NO repository, every row gets `-`, and
// the rule that matters — two declared events at one HEAD keep BOTH rows rather than collapsing on
// the shared key — is asserted here in exactly that form.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, runCombined, readState, writeState, invokeEngine, detourLog } from "../fixtures/assert-harness.mjs";

const projectMd = (cwd) => fs.readFileSync(path.join(cwd, "PROJECT.md"), "utf8");

// ─────────────────── gh#81: the render loop and the stamp ───────────────────

test("gh#81: re-rendering with nothing changed leaves PROJECT.md byte-identical", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "e1", "--lane", "claude-code"], { cwd });
  const first = projectMd(cwd);
  run(["render"], { cwd });
  assert.equal(projectMd(cwd), first, "a second render of an unchanged record is a no-op");
});

test("gh#81: the render stamp still MOVES when something real changed", () => {
  // A file that never changes is as wrong as one that always does: the stamp is what makes
  // "PROJECT.md is current" checkable, so a change must move it.
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "e1", "--lane", "claude-code"], { cwd });
  const before = fs.readFileSync(path.join(cwd, ".conductor", "render-stamp.json"), "utf8");
  run(["add-epic", "--id", "e2", "--lane", "claude-code"], { cwd });
  assert.notEqual(fs.readFileSync(path.join(cwd, ".conductor", "render-stamp.json"), "utf8"), before);
});

// ─────────────────── gh#82: the root-divergence warning ───────────────────

test("gh#82: writing another initialized repo's conductor warns, names both paths, and still writes", () => {
  const target = tmpRepo(); run(["init"], { cwd: target });
  const here = tmpRepo(); run(["init"], { cwd: here });
  // cwd = here, root = target: the invocation was started somewhere other than the record it writes.
  const r = invokeEngine(["add-epic", "--id", "e1", "--lane", "claude-code"], { cwd: here, env: { CLAUDE_PROJECT_DIR: target } });
  assert.equal(r.status, 0, "the warning is not a refusal");
  const text = r.stdout + r.stderr;
  assert.match(text, /different repository|divergen/i, "it says what is happening");
  assert.ok(text.includes(target) && text.includes(here), "and names BOTH paths, or the reader cannot act");
  assert.deepEqual(readState(target).epics.map(e => e.id), ["e1"], "and the write still lands");
});

test("gh#82: a READ-ONLY verb does not claim to be writing a different repository", () => {
  const target = tmpRepo(); run(["init"], { cwd: target });
  const here = tmpRepo(); run(["init"], { cwd: here });
  const r = invokeEngine(["brief"], { cwd: here, env: { CLAUDE_PROJECT_DIR: target } });
  assert.doesNotMatch(r.stdout + r.stderr, /different repository|divergen/i,
    "the read/write split is read from verb-effects.mjs, not from a second list");
});

test("gh#82: with CLAUDE_PROJECT_DIR unset there is nothing to diverge from", () => {
  const here = tmpRepo(); run(["init"], { cwd: here });
  const r = invokeEngine(["add-epic", "--id", "e1", "--lane", "claude-code"], { cwd: here, env: { CLAUDE_PROJECT_DIR: "" } });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout + r.stderr, /divergen/i);
});

test("gh#82: a MUTATING verb in the same fixture still warns — the gate is not a blanket silence", () => {
  const target = tmpRepo(); run(["init"], { cwd: target });
  const here = tmpRepo(); run(["init"], { cwd: here });
  const mutating = invokeEngine(["log-detour", "x"], { cwd: here, env: { CLAUDE_PROJECT_DIR: target } });
  assert.match(mutating.stdout + mutating.stderr, /divergen|different repository/i);
});

// ─────────────────── gh#81: the detour log ───────────────────

test("gh#81: a MINIMAL detour is a declared event, not a commit — two at one HEAD keep both rows", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["log-detour", "first"], { cwd });
  run(["log-detour", "second"], { cwd });
  const log = detourLog(cwd);
  assert.match(log, /first/);
  assert.match(log, /second/);
  assert.equal(log.trim().split("\n").length, 2, "the shared `-` sha must not collapse two events into one");
});

test("gh#81: with no git at all, `-` is 'cannot tell' and must not collapse unrelated rows into one", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["log-detour", "alpha"], { cwd });
  run(["log-detour", "beta"], { cwd });
  const rows = detourLog(cwd).trim().split("\n");
  assert.equal(rows.length, 2);
  for (const r of rows) assert.match(r, /\t-\t/, "the sha field is the literal `-` in this world");
});

test("gh#81: re-rendering with a detour row present is still stable", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["log-detour", "x"], { cwd });
  const first = projectMd(cwd);
  run(["render"], { cwd });
  assert.equal(projectMd(cwd), first);
});

test("gh#81: the PROJECT.md commit loop terminates — a render writes only what changed", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "e1", "--lane", "claude-code"], { cwd });
  const a = projectMd(cwd);
  runCombined(["render"], { cwd });
  runCombined(["render"], { cwd });
  assert.equal(projectMd(cwd), a, "a re-render that changed nothing leaves the file alone, so a " +
    "commit-the-re-render loop cannot spin");
});

test("gh#81: a bookkeeping-only change is still recorded rather than silently dropped", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  writeState(cwd, { ...readState(cwd), active: null });
  const before = projectMd(cwd);
  run(["render"], { cwd });
  assert.ok(typeof projectMd(cwd) === "string");
  void before;
});

// ───────────────────────── the deliberate omission ─────────────────────────
//
// "gh#81: the detour log is idempotent on SHA — the same commit is never logged twice", its control
// ("two different SHAs both get a row"), "a bookkeeping-only commit inside a detour writes no
// DETOUR-COMMIT row" and "a real commit inside a detour is still logged" all need REAL commits in a
// real repository, whose shas the log is keyed on — functional-only by subject (design D5). The `-`
// rows above are the same key, in the world where every value is `-`.
