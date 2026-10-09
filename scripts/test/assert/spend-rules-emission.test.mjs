// scripts/test/assert/spend-rules-emission.test.mjs
// token-spend-tracking-per-epic, group 5 (5.1 fixture, 5.2) — the rules-block section as bytes: pinned
// against a current-version fixture, and refreshed into CLAUDE.md by the toggle. FILE rung.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, claudeMd } from "../fixtures/assert-harness.mjs";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const FIXTURE = fs.readFileSync(path.join(HERE, "..", "fixtures", "rules-0.52.0-spend-tracking.txt"), "utf8");
const LIB = new URL("../../lib/", import.meta.url).href;

/** The managed block's text in CLAUDE.md, between the markers. */
function managedBlock(cwd) {
  const text = claudeMd(cwd);
  const begin = text.indexOf("<!-- BEGIN pm-conductor rules");
  const end = text.indexOf("<!-- END pm-conductor rules -->");
  assert.ok(begin !== -1 && end !== -1, "the managed block exists");
  return text.slice(begin, end);
}
const count = (s) => s.split("## Spend tracking").length - 1;

test("5.1: the Spend tracking section is byte-pinned by the current-version fixture", async () => {
  const { rulesBlock } = await import(LIB + "rules.mjs");
  const block = rulesBlock(null, "thorough", [], "claude-code", null, true);
  const section = block.slice(block.indexOf("## Spend tracking"), block.indexOf("## Release candidate"));
  assert.equal(section, FIXTURE, "regenerate scripts/test/fixtures/rules-0.52.0-spend-tracking.txt deliberately if this changes");
});

test("5.2 Toggling refreshes CLAUDE.md: the section is in the managed block after `on` and gone after `off`", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  assert.equal(count(managedBlock(cwd)), 0, "init does not turn tracking on");
  run(["set-spend-tracking", "on"], { cwd });
  const withSection = managedBlock(cwd);
  assert.equal(count(withSection), 1);
  assert.ok(withSection.includes("pm-spend: epic=<id> role=<role> phase=<phase> [round=<n>]"));
  run(["set-spend-tracking", "off"], { cwd });
  const without = managedBlock(cwd);
  assert.equal(count(without), 0);
  assert.doesNotMatch(without, /pm-spend:/);
});

test("5.2 a repeated `on` leaves CLAUDE.md as it was, and write-rules/upgrade keep the section while it is on", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["set-spend-tracking", "on"], { cwd });
  const once = claudeMd(cwd);
  run(["set-spend-tracking", "on"], { cwd });
  assert.equal(claudeMd(cwd), once);
  run(["write-rules"], { cwd });
  assert.equal(count(claudeMd(cwd)), 1);
  run(["upgrade"], { cwd });
  assert.equal(count(claudeMd(cwd)), 1, "upgrade re-renders the block from state, and tracking is still on");
});

test("5.2 the `rules` verb prints the section only while tracking is on", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  assert.doesNotMatch(run(["rules"], { cwd }), /## Spend tracking/);
  run(["set-spend-tracking", "on"], { cwd });
  assert.match(run(["rules"], { cwd }), /## Spend tracking/);
});
