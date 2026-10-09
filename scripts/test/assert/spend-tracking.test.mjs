// scripts/test/assert/spend-tracking.test.mjs
// token-spend-tracking-per-epic — the FILE rung: bytes on disk. Grows group by group; this commit
// holds the switch's byte-identity scenarios and the ignore-line backfill.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, runCombined, expectFail, writeState } from "../fixtures/assert-harness.mjs";

const stateBytes = (cwd) => fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");

test("1.2 `on` stores {enabled, enabledAt}; a re-enable keeps the FIRST enabledAt", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["set-spend-tracking", "on"], { cwd });
  const first = JSON.parse(stateBytes(cwd)).spendTracking;
  assert.equal(first.enabled, true);
  assert.match(first.enabledAt, /^\d{4}-\d\d-\d\dT[\d:.]+Z$/);
  run(["set-spend-tracking", "off"], { cwd });
  assert.equal(JSON.parse(stateBytes(cwd)).spendTracking.enabled, false);
  assert.equal(JSON.parse(stateBytes(cwd)).spendTracking.enabledAt, first.enabledAt, "off keeps enabledAt");
  run(["set-spend-tracking", "on"], { cwd });
  assert.deepEqual(JSON.parse(stateBytes(cwd)).spendTracking, { enabled: true, enabledAt: first.enabledAt });
});

test("1.2 a repeated setting says so", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["set-spend-tracking", "on"], { cwd });
  assert.match(runCombined(["set-spend-tracking", "on"], { cwd }), /spend tracking was already on/);
  const off = tmpRepo();
  run(["init"], { cwd: off });
  assert.match(runCombined(["set-spend-tracking", "off"], { cwd: off }), /spend tracking was already off/);
});

test("1.2 `set-spend-tracking maybe` leaves state.json byte-identical", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const before = stateBytes(cwd);
  expectFail(() => run(["set-spend-tracking", "maybe"], { cwd }));
  assert.equal(stateBytes(cwd), before);
});

test("1.2 a repeated `on` writes nothing: state.json is byte-identical", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["set-spend-tracking", "on"], { cwd });
  const before = stateBytes(cwd);
  run(["set-spend-tracking", "on"], { cwd });
  assert.equal(stateBytes(cwd), before);
});

test("1.2 init does not turn tracking on, and upgrade lists the unadopted switch", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  assert.equal(JSON.parse(stateBytes(cwd)).spendTracking, undefined);
  const out = run(["upgrade"], { cwd });
  assert.match(out, /NOT SET: spendTracking — no record of which epic, phase, role or model spent tokens → set-spend-tracking on/);
  assert.equal(JSON.parse(stateBytes(cwd)).spendTracking, undefined, "upgrade never enables it");
});

test("1.3 upgrade backfills the .conductor/spend/ ignore line", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const gi = path.join(cwd, ".gitignore");
  fs.writeFileSync(gi, fs.readFileSync(gi, "utf8").split("\n").filter((l) => l.trim() !== ".conductor/spend/").join("\n"));
  assert.ok(!fs.readFileSync(gi, "utf8").split("\n").includes(".conductor/spend/"));
  run(["upgrade"], { cwd });
  assert.ok(fs.readFileSync(gi, "utf8").split("\n").map((l) => l.trim()).includes(".conductor/spend/"));
});

test("1.3 init writes the .conductor/spend/ ignore line", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  assert.ok(fs.readFileSync(path.join(cwd, ".gitignore"), "utf8").split("\n").map((l) => l.trim()).includes(".conductor/spend/"));
});

test("G2-M1 an unparseable enabledAt: `spend` refuses, and the remedy it names (off, then on) clears the refusal", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["set-spend-tracking", "on"], { cwd });
  const s = JSON.parse(stateBytes(cwd));
  s.spendTracking.enabledAt = "not-a-date";
  writeState(cwd, s);
  const env = { CLAUDE_CONFIG_DIR: tmpRepo(), HOME: "/no/such/home" };
  expectFail(() => run(["spend", "--no-ingest"], { cwd, env }));
  run(["set-spend-tracking", "off"], { cwd });
  assert.equal(JSON.parse(stateBytes(cwd)).spendTracking.enabledAt, undefined, "off drops a value no ingest could use");
  run(["set-spend-tracking", "on"], { cwd });
  const fresh = JSON.parse(stateBytes(cwd)).spendTracking.enabledAt;
  assert.ok(Number.isFinite(Date.parse(fresh)), "on stamped a fresh start");
  run(["spend", "--no-ingest"], { cwd, env });
});

test("G2-M1 `on` over an unparseable enabledAt stamps a fresh one without needing an `off` first", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["set-spend-tracking", "on"], { cwd });
  const s = JSON.parse(stateBytes(cwd));
  s.spendTracking.enabled = false;
  s.spendTracking.enabledAt = "garbage";
  writeState(cwd, s);
  run(["set-spend-tracking", "on"], { cwd });
  assert.ok(Number.isFinite(Date.parse(JSON.parse(stateBytes(cwd)).spendTracking.enabledAt)));
});
