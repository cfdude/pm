// scripts/test/assert/session-cost.test.mjs
// rules-block-session-cost — the verbs that report and enforce it, over a real repository on disk:
// `brief` caps what a session receives, `render` and `upgrade` print the two cost lines, and
// `rules --sections` prints the ranked per-section table. The pure half is unit/session-cost.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, runCombined, readState, writeState } from "../fixtures/assert-harness.mjs";

const bytes = (s) => Buffer.byteLength(s, "utf8");
const context = (cwd) => JSON.parse(run(["brief", "--platform", "claude-code"], { cwd })).hookSpecificOutput.additionalContext;

/** A repo whose brief is far over the cap: 300 queued epics each waiting on one planned epic, and every
 *  such inversion is a DEPENDENCY WARNINGS line the brief lists in full. */
function fatRepo() {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const s = readState(cwd);
  const epic = (id, status, links = []) => ({ id, title: id, priority: "P1", status, role: "epic", lane: "claude-code", links });
  s.epics.push(epic("base", "planned"));
  for (let i = 0; i < 300; i++) {
    s.epics.push(epic(`waits-on-base-${i}`, "queued", [{ type: "depends-on", epic: "base", reason: "needs the base" }]));
  }
  writeState(cwd, s);
  return cwd;
}

test("a small repo's SessionStart brief is sent whole, with no truncation marker", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const out = context(cwd);
  assert.doesNotMatch(out, /pm brief truncated/);
  assert.match(out, /CONDUCTOR STATE/);
});

test("an over-cap brief is cut to the cap, marked, and still ends with the standing reminders", () => {
  const cwd = fatRepo();
  const out = context(cwd);
  assert.ok(bytes(out) <= 16384, `sent ${bytes(out)} bytes`);
  assert.match(out, /\[pm brief truncated: \d+ bytes over the 16384-byte cap/);
  assert.match(out, /CONDUCTOR STATE/, "the head survives");
  assert.match(out, /RULES \(pm\): classify detours/, "the closing reminder survives");
});

test("PROJECT.md keeps the UNcapped brief, so the marker's pointer is true", () => {
  const cwd = fatRepo();
  run(["render"], { cwd });
  const md = fs.readFileSync(path.join(cwd, "PROJECT.md"), "utf8");
  assert.doesNotMatch(md, /pm brief truncated/);
  assert.ok(md.split("\n").filter(l => l.includes("waits-on-base-")).length > 200, "every warning line is still there");
});

test("render prints the two cost lines, truncated when the brief is over the cap", () => {
  const cwd = fatRepo();
  const out = runCombined(["render"], { cwd });
  assert.match(out, /conductor: rules block \(CLAUDE\.md\): \d+ bytes, ~\d+ tokens \(bytes\/4\)/);
  assert.match(out, /conductor: SessionStart brief: \d+ of \d+ bytes sent \(~\d+ tokens\), truncated at the 16384-byte cap/);
});

test("render's cost lines are not printed under --diff-summary, whose stdout is one machine-read line", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  assert.equal(run(["render", "--diff-summary"], { cwd }).trim().split("\n").length, 1);
});

test("a small repo's brief line says it is under the cap", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  assert.match(runCombined(["render"], { cwd }), /SessionStart brief: \d+ bytes \(~\d+ tokens\), under the 16384-byte cap/);
});

test("the block size printed is the size of the block ON DISK, which is what a session reads", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const line = /rules block \(CLAUDE\.md\): (\d+) bytes/.exec(runCombined(["render"], { cwd }));
  assert.ok(line, "the rules-block line is present");
  const table = run(["rules", "--sections", "--platform", "claude-code"], { cwd });
  assert.match(table, new RegExp(`total ${line[1]} bytes`), "the generated block and the written block are the same size");
});

test("upgrade prints the two cost lines", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const out = runCombined(["upgrade"], { cwd });
  assert.match(out, /conductor: rules block \(CLAUDE\.md\): \d+ bytes/);
  assert.match(out, /conductor: SessionStart brief: /);
});

test("rules --sections prints sections ranked largest first, then a total; plain rules still prints the block", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const rows = run(["rules", "--sections", "--platform", "claude-code"], { cwd }).trim().split("\n");
  const sizes = rows.slice(0, -1).map(r => Number(/^\s*(\d+) bytes/.exec(r)[1]));
  assert.ok(sizes.length >= 5);
  assert.deepEqual([...sizes].sort((a, b) => b - a), sizes);
  assert.match(rows[rows.length - 1], /^total \d+ bytes, ~\d+ tokens/);
  assert.match(run(["rules", "--platform", "claude-code"], { cwd }), /^<!-- BEGIN pm-conductor rules/);
});

test("--sections is refused on a verb that does not read it", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  assert.throws(() => run(["write-rules", "--sections"], { cwd }));
});
