// scripts/test/assert/set-profile.test.mjs
// execution-profile-layered-settings 3.1 — the FILE-rung half: set-profile end to end. A successful
// write refreshes CLAUDE.md's managed block, and a no-op must leave state.json's BYTES alone.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, readState, expectFail } from "../fixtures/assert-harness.mjs";

const stateBytes = (cwd) => fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");

test("set-profile records project model pairs and verbosity, and the project review in state.reviewMode", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["set-profile", "--review", "thorough", "--model", "implement=sonnet:medium", "--model", "test=haiku", "--verbosity", "verbose"], { cwd });
  const s = readState(cwd);
  assert.equal(s.reviewMode, "thorough");
  assert.deepEqual(s.executionProfile, { verbosity: "verbose", model: { implement: { model: "sonnet", effort: "medium" }, test: { model: "haiku" } } });
});

test("set-review-mode and set-profile write one record", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["set-review-mode", "--mode", "thorough"], { cwd });
  assert.match(run(["profile"], { cwd }), /review: thorough \(project\)/);
  run(["set-profile", "--unset", "review"], { cwd });
  assert.match(run(["profile"], { cwd }), /review: standard \(default\)/);
});

test("a lane layer is written, resolved by an epic of that lane, and removed when emptied", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "e", "--title", "E", "--lane", "claude-code"], { cwd });
  run(["set-profile", "--lane", "claude-code", "--review", "off"], { cwd });
  assert.deepEqual(readState(cwd).laneProfiles, { "claude-code": { review: "off" } });
  assert.match(run(["profile", "--epic", "e"], { cwd }), /review: off \(lane:claude-code\)/);
  run(["set-profile", "--lane", "claude-code", "--unset", "review"], { cwd });
  assert.ok(!("laneProfiles" in readState(cwd)));
});

test("an unset of a field that is not set exits zero, says so, and leaves state.json byte-identical", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  const before = stateBytes(cwd);
  const out = run(["set-profile", "--unset", "verbosity"], { cwd });
  assert.match(out, /already unset: verbosity/);
  assert.equal(stateBytes(cwd), before);
});

test("a refused set-profile leaves state.json byte-identical", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  const before = stateBytes(cwd);
  assert.ok(expectFail(() => run(["set-profile", "--model", "test=haiku:low"], { cwd })));
  assert.ok(expectFail(() => run(["set-profile", "--lane", "marketing", "--review", "off"], { cwd })));
  assert.equal(stateBytes(cwd), before);
});

test("set-profile refreshes the managed block in CLAUDE.md with the new project review", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["set-profile", "--review", "thorough"], { cwd });
  assert.match(fs.readFileSync(path.join(cwd, "CLAUDE.md"), "utf8"), /Current mode: \*\*thorough\*\*/);
});
