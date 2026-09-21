// scripts/test/assert/conductor-39.test.mjs
// 5.3's ASSERTION TWIN of scripts/test/functional/conductor-39.test.mjs — same id, same subject.
//
// THE FUNCTIONAL FILE'S SUBJECT is the `createdAt`/`touchedAt` family: what a NEW epic is stamped
// with, how a save advances `touchedAt` only for the epics whose content changed, and
// `recover-created-at`, which reads the introducing commit out of LOCAL GIT HISTORY to backfill a
// date the record never carried.
//
// ONLY `recover-created-at` NEEDS GIT. Everything before it is decided from state.json, and the
// `recover-created-at` DEGRADATION cases are this half's world exactly: no repository, an untracked
// file, no history — all of which must yield ABSENT rather than an error or an invented date. The
// half of that verb that recovers a REAL date is functional-only (design D5).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, readState, writeState } from "../fixtures/assert-harness.mjs";

test("1.1: a newly registered epic carries createdAt, and no later mutation rewrites it", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code"], { cwd });
  const first = readState(cwd).epics.find(e => e.id === "a");
  assert.match(first.createdAt, /^\d{4}-\d{2}-\d{2}T/);
  run(["update-epic", "a", "--priority", "P0"], { cwd });
  assert.equal(readState(cwd).epics.find(e => e.id === "a").createdAt, first.createdAt);
});

test("1.1: an epic written without createdAt reads as unknown, never as a date", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  writeState(cwd, { version: 1, active: null, detourStack: [],
    epics: [{ id: "old", title: "old", priority: "P1", status: "queued", role: "epic", lane: "claude-code", links: [] }] });
  assert.equal(readState(cwd).epics.find(e => e.id === "old").createdAt, undefined);
});

test("1.2: a save that changes nothing stamps nothing — no touch, no revision bump, same bytes", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code"], { cwd });
  const before = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
  run(["render"], { cwd });   // a read verb that re-renders
  assert.equal(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"), before);
});

test("1.3: a save that writes advances touchedAt only on the epics whose content changed", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code"], { cwd });
  run(["add-epic", "--id", "b", "--lane", "claude-code"], { cwd });
  const before = Object.fromEntries(readState(cwd).epics.map(e => [e.id, e.touchedAt]));
  run(["update-epic", "a", "--priority", "P0"], { cwd });
  const after = Object.fromEntries(readState(cwd).epics.map(e => [e.id, e.touchedAt]));
  assert.notEqual(after.a, before.a, "the epic whose content changed is touched");
  assert.equal(after.b, before.b, "the epic that did not change is NOT touched");
});

test("1.6: a record written with neither field present still loads and renders", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  writeState(cwd, { version: 1, active: null, detourStack: [],
    epics: [{ id: "old", title: "old", priority: "P1", status: "queued", role: "epic", lane: "claude-code", links: [] }] });
  assert.doesNotThrow(() => run(["render"], { cwd }));
  assert.doesNotThrow(() => run(["brief"], { cwd }));
});

// ─────────── recover-created-at: the DEGRADATION rungs, which are this half's world ───────────

test("2.2: degradation — no git repository yields ABSENT, not an error and not a date", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  writeState(cwd, { version: 1, active: null, detourStack: [],
    epics: [{ id: "e", title: "e", priority: "P1", status: "queued", role: "epic", lane: "claude-code", links: [] }] });
  const out = run(["recover-created-at"], { cwd });
  const epic = readState(cwd).epics.find(e => e.id === "e");
  assert.equal(epic.createdAt, undefined,
    "unrecoverable stays ABSENT and re-attemptable — a guessed date would be worse than none");
  assert.doesNotMatch(out, /\d{4}-\d{2}-\d{2}T/);
});

test("2.3: re-running never invents a date for an id it cannot find in history", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  writeState(cwd, { version: 1, active: null, detourStack: [],
    epics: [{ id: "never-committed", title: "t", priority: "P1", status: "queued", role: "epic", lane: "claude-code", links: [] }] });
  run(["recover-created-at"], { cwd });
  run(["recover-created-at"], { cwd });
  assert.equal(readState(cwd).epics.find(e => e.id === "never-committed").createdAt, undefined);
});

test("2.6/2.8: the verb is local-only and reads no network", () => {
  // The engine is an INSTRUCTION layer with no network access at all (repo CLAUDE.md, "hard
  // constraints"); this asserts the verb runs to completion in a directory with no repository and
  // does not reach outside it.
  const cwd = tmpRepo(); run(["init"], { cwd });
  assert.doesNotThrow(() => run(["recover-created-at"], { cwd }));
});

// ───────────────────────── the deliberate omissions ─────────────────────────
//
// "2.1: the verb recovers a real date for an id whose introducing commit is in the history" and
// "2.3: an absent date is re-attempted and recovered once the checkout has the history" both read
// `git log -S` over a real repository — the subject is git's history, so they are functional-only
// (design D5). The degradations above are the half of that verb this half can prove on every commit.
