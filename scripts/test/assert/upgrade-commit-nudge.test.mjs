// scripts/test/assert/upgrade-commit-nudge.test.mjs
// 5.3's ASSERTION TWIN of scripts/test/functional/upgrade-commit-nudge.test.mjs — same id, same
// subject.
//
// THE FUNCTIONAL FILE'S SUBJECT is the conditional commit nudge `/pm:upgrade` emits after rewriting
// tracked files — and the whole point is that it is conditional in BOTH directions: a no-op re-run
// says nothing, and a repo where git cannot compare says nothing either. A machine-wide sweep found
// NINE repositories sitting with an upgrade written to disk and never committed, which is invisible
// precisely because nothing is broken.
//
// THE "CANNOT COMPARE" DIRECTION IS THIS HALF'S WORLD, and it is the one whose failure is silent:
// every root here is a directory git cannot answer about. A nudge that fired there would tell every
// user of a tarball, a deployed copy or a not-yet-initialised clone to commit files against a HEAD
// that does not exist.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { run, runCombined, tmpRepo } from "../fixtures/assert-harness.mjs";

const NUDGE = /COMMIT THIS UPGRADE/;

test("outside a git repository there is nothing to compare against, and it stays silent", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  // Make the upgrade actually have work to do, so the silence cannot be "nothing ran".
  const statePath = path.join(cwd, ".conductor", "state.json");
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  state.pmVersion = "0.1.0";
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");

  const out = runCombined(["upgrade"], { cwd });
  assert.doesNotMatch(out, NUDGE, "no HEAD, no diff, no nudge — never a copy-pasteable git add line");
  assert.match(out, /upgraded \(\d+ migration\(s\)\)/, "non-vacuity: the upgrade really did run");
});

test("a second, idempotent upgrade with nothing left to commit still says nothing here", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const first = runCombined(["upgrade"], { cwd });
  const second = runCombined(["upgrade"], { cwd });
  assert.doesNotMatch(first, NUDGE);
  assert.doesNotMatch(second, NUDGE, "a message that always fires is one people stop reading");
});

test("the nudge is never the reason an upgrade fails", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  // `run` throws on a non-zero status, so reaching the assertion at all is the check: the nudge is
  // an advisory appended to a successful upgrade, never a gate on it.
  assert.ok(typeof run(["upgrade"], { cwd }) === "string");
});

// ───────────────────────── the deliberate omissions ─────────────────────────
//
// The functional file's three POSITIVE cases — "an upgrade that rewrites tracked files says to
// commit them, and names them" (which verifies the named paths really do differ from HEAD), "a
// second, idempotent upgrade … says NOTHING", and "a repo that git-ignores the conductor's output is
// never told to commit it" (which runs `git rm --cached`) — all need a real repository with a real
// HEAD (design D5). The two SILENT directions above are the same rule from the side this half runs
// in on every commit.
