// scripts/test/assert/rules-usage-write.test.mjs
// gh-cfdude-pm-248, task 2.3 (FILE) — `writeRules()` and the `rules` verb render the block with the usage
// answers read from state. FILE rung: the observable is CLAUDE.md's bytes after a verb.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, claudeMd } from "../fixtures/assert-harness.mjs";

const LIB = new URL("../../lib/", import.meta.url).href;
const AUTONOMY = "## Epic-level autonomy", RC = "## Release candidate", POINTER = "## Procedures emitted on use";
const realRepo = () => fs.realpathSync(tmpRepo());
const managed = (text) => text.slice(text.indexOf("<!-- BEGIN pm-conductor rules"), text.indexOf("<!-- END pm-conductor rules -->"));
const section = (block, heading) => {
  const at = block.indexOf(heading);
  assert.notEqual(at, -1, `${heading} present`);
  const next = block.indexOf("\n## ", at + 1);
  return block.slice(at, next === -1 ? undefined : next);
};

function freshRepo() {
  const cwd = realRepo();
  run(["init"], { cwd });
  return cwd;
}
/** A repo holding an autonomy record on a non-archived epic and one undelivered release. */
function inUseRepo() {
  const cwd = freshRepo();
  run(["add-epic", "--id", "e1", "--title", "e1", "--lane", "claude-code"], { cwd });
  run(["set-autonomy", "e1", "--context", "x"], { cwd });
  run(["release", "1.0.0", "--intent", "x"], { cwd });
  run(["write-rules"], { cwd });
  return cwd;
}

test("2.3 a fresh init writes neither usage-conditioned section and does write the pointer", () => {
  const cwd = freshRepo();
  const text = claudeMd(cwd);
  assert.ok(!text.includes(AUTONOMY) && !text.includes(RC));
  assert.ok(text.includes(POINTER));
  assert.equal(text.split(POINTER).length - 1, 1);
});

test("2.3 write-rules for a state holding a record and an open release writes both sections and no pointer", () => {
  const cwd = inUseRepo();
  const text = claudeMd(cwd);
  assert.ok(text.includes(AUTONOMY) && text.includes(RC));
  assert.ok(!text.includes(POINTER));
});

test("2.3 `rules` and `write-rules` agree for the same state: fresh and in use", () => {
  for (const cwd of [freshRepo(), inUseRepo()]) {
    run(["write-rules"], { cwd });
    const printed = run(["rules"], { cwd });
    assert.equal(managed(claudeMd(cwd)).trimEnd() + "\n<!-- END pm-conductor rules -->", printed.trimEnd(),
      "the managed block on disk is exactly what `rules` prints");
  }
});

test("2.3 the gate procedure's bytes equal those of the default (full) render", async () => {
  const { rulesBlock } = await import(LIB + "rules.mjs");
  const full = rulesBlock(null, "standard", [], "claude-code", null, false, false);
  const cwd = freshRepo();
  const gate = (b) => section(b, "## The gate procedure — required task items");
  assert.equal(gate(claudeMd(cwd)), gate(full));
  assert.equal(section(claudeMd(cwd), "## Intake"), section(full, "## Intake"));
});

test("2.3 --sections lists the same sections the written block carries (fresh repo)", () => {
  const cwd = freshRepo();
  const table = run(["rules", "--sections", "--platform", "claude-code"], { cwd });
  assert.ok(table.includes("Procedures emitted on use"));
  assert.ok(!table.includes("Epic-level autonomy") && !table.includes("Release candidate"));
});

test("2.3 a hand-written autonomy record is picked up by the next write-rules", () => {
  const cwd = freshRepo();
  run(["add-epic", "--id", "e1", "--title", "e1", "--lane", "claude-code"], { cwd });
  const file = path.join(cwd, ".conductor", "state.json");
  const state = JSON.parse(fs.readFileSync(file, "utf8"));
  state.epics.find((e) => e.id === "e1").autonomy = { level: "off" };
  fs.writeFileSync(file, JSON.stringify(state, null, 2));
  run(["write-rules"], { cwd });
  assert.ok(claudeMd(cwd).includes(AUTONOMY));
});
