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

/** A repo whose LISTS are far over the cap: 40 releases carrying 3 KB of free text each, and an archived
 *  epic stamped `ungated`, which the brief reports in its UNGATED ARCHIVES obligation block. The old
 *  tail-cut sent the head of RELEASES and nothing after it, so the obligation was the part dropped. */
function fatListsRepo() {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const s = readState(cwd);
  s.epics.push({ id: "shipped-ungated", title: "x", priority: "P1", status: "archived", role: "epic", lane: "openspec",
    gateReview: { gate2: { verdict: "ungated" } }, disposition: { outcome: "delivered", recordedAt: "2026-01-01T00:00:00.000Z", reason: "r" } });
  s.releases = Array.from({ length: 40 }, (_, i) => ({ id: `1.${i}.0`, intent: `intent ${i} ` + "word ".repeat(600), deferred: [] }));
  writeState(cwd, s);
  return cwd;
}

test("a small repo's SessionStart brief is sent whole, with no marker", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const out = context(cwd);
  assert.doesNotMatch(out, /pm brief:/);
  assert.match(out, /CONDUCTOR STATE/);
});

test("an over-cap brief shortens its LISTS, keeps the obligation blocks whole and in front, and ends with the standing reminders", () => {
  const cwd = fatListsRepo();
  const out = context(cwd);
  assert.ok(bytes(out) <= 16384, `sent ${bytes(out)} bytes`);
  assert.match(out, /UNGATED ARCHIVES/, "the obligation block survives");
  assert.match(out, /`shipped-ungated`/);
  assert.ok(out.indexOf("UNGATED ARCHIVES") < out.indexOf("RELEASES:"), "obligations come before the lists");
  assert.match(out, /`1\.39\.0`/, "the most recent release is kept");
  assert.doesNotMatch(out, /`1\.0\.0`/);
  assert.match(out, /\(\+37 older releases — see PROJECT\.md "Releases"\)/);
  const m = /\[pm brief: (\d+) bytes uncapped, (\d+) over the 16384-byte cap/.exec(out);
  assert.ok(m, "the marker is present");
  assert.equal(Number(m[2]), Number(m[1]) - 16384, "bytes over the cap is total minus cap");
  assert.match(out, /RULES \(pm\): classify detours/, "the closing reminder survives");
});

test("every pointer the bounded brief prints is true: PROJECT.md holds the full RELEASES list and the Briefing section", () => {
  const cwd = fatListsRepo();
  run(["render"], { cwd });
  const md = fs.readFileSync(path.join(cwd, "PROJECT.md"), "utf8");
  assert.match(md, /^## Releases$/m);
  assert.match(md, /^## Briefing/m);
  assert.doesNotMatch(md, /pm brief:/, "PROJECT.md embeds the plain brief, never the bounded one");
  assert.ok(md.includes("`1.0.0`") && md.includes("`1.39.0`"), "every release is still in PROJECT.md");
});

test("obligations alone over the cap are emitted whole, over the cap, and the brief says so", () => {
  const cwd = fatRepo();
  const out = context(cwd);
  assert.ok(bytes(out) > 16384, "300 dependency warnings are never cut");
  assert.equal(out.split("\n").filter(l => l.includes("waits-on-base-")).length >= 300, true, "every warning line is there");
  assert.match(out, /obligation blocks alone exceed it\. They are never cut/);
  assert.match(runCombined(["render"], { cwd }), /SessionStart brief: \d+ of \d+ bytes sent \(~\d+ tokens\), OVER the 16384-byte cap/);
});

test("PROJECT.md keeps the UNcapped brief, so the pointers are true", () => {
  const cwd = fatRepo();
  run(["render"], { cwd });
  const md = fs.readFileSync(path.join(cwd, "PROJECT.md"), "utf8");
  assert.doesNotMatch(md, /pm brief:/);
  assert.ok(md.split("\n").filter(l => l.includes("waits-on-base-")).length > 200, "every warning line is still there");
});

test("render prints the two cost lines, saying the lists were shortened when the brief is over the cap", () => {
  const cwd = fatListsRepo();
  const out = runCombined(["render"], { cwd });
  assert.match(out, /conductor: rules block \(CLAUDE\.md\): \d+ bytes, ~\d+ tokens \(bytes\/4\)/);
  assert.match(out, /conductor: SessionStart brief: \d+ of \d+ bytes sent \(~\d+ tokens\), long lists shortened to fit the 16384-byte cap/);
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
