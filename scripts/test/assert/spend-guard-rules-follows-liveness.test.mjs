// scripts/test/assert/spend-guard-rules-follows-liveness.test.mjs
// spend-guard-rules-section-follows-live-limits, task 1.2 (FILE) — the managed rules block's
// `## Spend guard` section tracks "a limit is configured" after ANY state-writing verb, never after a hook,
// a no-op write or a refusal. FILE rung: the observable is CLAUDE.md's bytes and mtime on disk.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, invokeEngine, writeState } from "../fixtures/assert-harness.mjs";

const SECTION = "## Spend guard";
const realRepo = () => fs.realpathSync(tmpRepo());
const mdPath = (cwd) => path.join(cwd, "CLAUDE.md");
const md = (cwd) => fs.readFileSync(mdPath(cwd), "utf8");
const stat = (cwd) => fs.statSync(mdPath(cwd));
const stateFile = (cwd) => path.join(cwd, ".conductor", "state.json");
const ARCHIVE = ["--status", "archived", "--outcome", "abandoned", "--reason", "x", "--no-deferrals"];

/** A repo whose ONLY configured limit sits on epic e1 (so E's archived status decides liveness). */
function onlyEpicLimit() {
  const cwd = realRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "e1", "--title", "e1", "--lane", "claude-code"], { cwd });
  run(["set-spend-guard", "--epic", "e1", "--max-failed-rounds", "2"], { cwd });
  assert.ok(md(cwd).includes(SECTION), "precondition: the section is present while the limit is live");
  return cwd;
}

test("1.2 archiving the only epic holding a limit removes the section", () => {
  const cwd = onlyEpicLimit();
  run(["update-epic", "e1", ...ARCHIVE], { cwd });
  assert.equal(md(cwd).includes(SECTION), false);
});

test("1.2 removing the only epic holding a limit removes the section", () => {
  const cwd = onlyEpicLimit();
  run(["remove-epic", "e1"], { cwd });
  assert.equal(md(cwd).includes(SECTION), false);
});

test("1.2 un-archiving restores the section (the inverse of archiving)", () => {
  const cwd = onlyEpicLimit();
  run(["update-epic", "e1", ...ARCHIVE], { cwd });
  assert.equal(md(cwd).includes(SECTION), false);
  run(["update-epic", "e1", "--status", "untriaged"], { cwd });
  assert.ok(md(cwd).includes(SECTION));
});

test("1.2 a write that leaves liveness unchanged does not rewrite CLAUDE.md: bytes and mtime", () => {
  const cwd = realRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "e1", "--title", "e1", "--lane", "claude-code"], { cwd });
  run(["set-spend-guard", "--max-failed-rounds", "2"], { cwd });
  const before = md(cwd), mtime = stat(cwd).mtimeMs;
  run(["update-epic", "e1", "--notes", "x"], { cwd });
  assert.equal(md(cwd), before);
  assert.equal(stat(cwd).mtimeMs, mtime);
});

test("1.2 a refused invocation refreshes nothing", () => {
  const cwd = onlyEpicLimit();
  const before = md(cwd), mtime = stat(cwd).mtimeMs;
  const r = invokeEngine(["update-epic", "e1", "--status", "archived"], { cwd });
  assert.notEqual(r.status, 0, "archiving without an outcome is refused");
  assert.equal(md(cwd), before);
  assert.equal(stat(cwd).mtimeMs, mtime);
});

test("1.2 set-spend-guard's own refresh is not repeated by the wrapper (one refresh line)", () => {
  const cwd = realRepo();
  run(["init"], { cwd });
  const r = invokeEngine(["set-spend-guard", "--max-failed-rounds", "2"], { cwd });
  assert.equal(r.status, 0);
  assert.equal((r.stderr.match(/rules block/g) || []).length, 1, r.stderr);
});

test("1.2 a hook does no liveness comparison; the next non-hook write picks the drift up", () => {
  const cwd = onlyEpicLimit();
  // Archive E behind the engine's back (as a hook's archive self-heal would), then run each hook verb.
  const s = JSON.parse(fs.readFileSync(stateFile(cwd), "utf8"));
  s.epics.find((e) => e.id === "e1").status = "archived";
  writeState(cwd, s);
  const before = md(cwd), mtime = stat(cwd).mtimeMs;
  for (const hook of [["brief"], ["snapshot"], ["commit-nudge"]]) invokeEngine(hook, { cwd });
  assert.equal(md(cwd), before, "no hook touched the rules block");
  assert.equal(stat(cwd).mtimeMs, mtime);
  run(["update-epic", "e1", "--notes", "x"], { cwd });
  assert.equal(md(cwd).includes(SECTION), false, "the next non-hook write refreshed the block");
});

test("1.2 a refresh failure does not fail the write and names the remedy", () => {
  const cwd = onlyEpicLimit();
  fs.chmodSync(mdPath(cwd), 0o444);
  try {
    const r = invokeEngine(["update-epic", "e1", ...ARCHIVE], { cwd });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(fs.readFileSync(stateFile(cwd), "utf8")).epics.find((e) => e.id === "e1").status, "archived");
    assert.match(r.stderr, /warning .*Spend guard section could not be refreshed/);
    assert.match(r.stderr, /write-rules/);
  } finally {
    fs.chmodSync(mdPath(cwd), 0o644);
  }
});
