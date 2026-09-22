import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, readState, writeState, projectMd, claudeMd, parseBrief, manyEpics, expectFail, fixturePluginRoot } from "../fixtures/assert-harness.mjs";

// ─────────────── 4.1 SPLIT THIS FILE, AND THIS IS THE FILE-RUNG HALF ───────────────
//
// TWENTY-ONE of its thirty-three tests moved to `scripts/test/unit/conductor-01.test.mjs` — the
// sorting and rendering tests, the progress precedence that needs no source file, the
// dangling-pointer warnings, NEXT UP's cap and lane rollup, every `add-epic` test with its four
// refusals, `update-epic --link`'s append, `sync` tolerating a missing plans dir, and the
// archived-epic exemption.
//
// TWELVE STAY, and each is one of the four seam edges the batch-2 table in worklist-4.1.md names:
//   * the filesystem SUBJECT — `render-stamp.json`'s MTIME, and the tmp-file hygiene check that walks
//     `.conductor/` and compares its entry list;
//   * a repo file the store does not own — CLAUDE.md's managed block, asserted by the `init`
//     scaffolding test;
//   * a FIXTURE that writes a path — five `sync`/`progress` tests seed
//     `docs/superpowers/plans/*.md` or `openspec/changes/*/tasks.md`, because reading those files is
//     what their subject IS;
//   * a VERB whose side effect writes a path — `init`/`upgrade` against `fixturePluginRoot`, in the
//     pmVersion-stamp test and the two nudge tests.
//
// No assertion changed in either direction.

test("init scaffolds state.json, PROJECT.md, and CLAUDE.md rules block", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const state = readState(cwd);
  assert.equal(state.version, 1);
  assert.deepEqual(state.epics, []);
  assert.deepEqual(state.detourStack, []);
  assert.match(projectMd(cwd), /PROJECT — Conductor Index/);
  assert.match(claudeMd(cwd), /BEGIN pm-conductor rules/);
});
test("state.json writes leave no stray tmp file behind after tmp+rename", () => {
  // This is a hygiene/regression check for the success path, not a fault-injection proof
  // of atomicity — the engine is exercised in-process through the assertion half's harness, so
  // this test can't inject a crash mid-write to directly observe the failure-path guarantee
  // (a crash leaves a truncated .tmp-* file, never a truncated state.json, because rename(2)
  // is atomic on the same filesystem). What IS verified here: repeated writes never leave a
  // leftover tmp file next to state.json, and the final file is always valid, complete JSON.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code"], { cwd });
  run(["update-epic", "a", "--title", "Renamed"], { cwd });
  const entries = fs.readdirSync(path.join(cwd, ".conductor"));
  assert.deepEqual(entries.sort(), ["render-stamp.json", "state.json"]);
  const parsed = JSON.parse(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"));
  assert.equal(parsed.epics.find(e => e.id === "a").title, "Renamed");
});
test("render() does not rewrite render-stamp.json when state.json is unchanged", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const stampPath = path.join(cwd, ".conductor", "render-stamp.json");
  const before = fs.readFileSync(stampPath, "utf8");
  const beforeMtime = fs.statSync(stampPath).mtimeMs;
  // Render again with no state.json change in between — render-stamp.json's stateMtimeMs
  // is already correct, so the file's content (and mtime) should be left untouched.
  run(["render"], { cwd });
  const after = fs.readFileSync(stampPath, "utf8");
  const afterMtime = fs.statSync(stampPath).mtimeMs;
  assert.equal(after, before, "render-stamp.json content should be byte-identical when state.json didn't change");
  assert.equal(afterMtime, beforeMtime, "render-stamp.json should not be rewritten (mtime unchanged) when state.json didn't change");
});
test("progress precedence: planPath checkboxes when no stories", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  fs.mkdirSync(path.join(cwd, "docs", "superpowers", "plans"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "docs", "superpowers", "plans", "p.md"),
    "# Plan\n- [x] one\n- [ ] two\n- [ ] three\n");
  writeState(cwd, { version: 1, active: null, detourStack: [], epics: [
    { id: "sp", title: "sp", priority: "P1", status: "queued", role: "epic", lane: "superpowers",
      planPath: "docs/superpowers/plans/p.md", links: [] },
  ]});
  run(["render"], { cwd });
  assert.match(projectMd(cwd), /1\/3 tasks/);
});
test("openspec lane still reads tasks.md by id", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const ch = path.join(cwd, "openspec", "changes", "feat-x");
  fs.mkdirSync(ch, { recursive: true });
  fs.writeFileSync(path.join(ch, "tasks.md"), "- [x] a\n- [x] b\n- [ ] c\n");
  run(["sync"], { cwd });
  run(["render"], { cwd });
  assert.match(projectMd(cwd), /2\/3 stories/);
});
test("sync imports superpowers plans as lane-tagged epics", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  fs.mkdirSync(path.join(cwd, "docs", "superpowers", "plans"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "docs", "superpowers", "plans", "big-refactor.md"), "# Big Refactor\n- [ ] a\n");
  run(["sync"], { cwd });
  const e = readState(cwd).epics.find(x => x.id === "big-refactor");
  assert.equal(e.lane, "superpowers");
  assert.equal(e.title, "Big Refactor");
  assert.equal(e.planPath, "docs/superpowers/plans/big-refactor.md");
});
test("sync skips a plan whose id collides with an existing epic", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "auth", "--lane", "openspec"], { cwd });
  fs.mkdirSync(path.join(cwd, "docs", "superpowers", "plans"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "docs", "superpowers", "plans", "auth.md"), "# Auth\n- [ ] a\n");
  run(["sync"], { cwd });
  const matches = readState(cwd).epics.filter(x => x.id === "auth");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].lane, "openspec");   // original kept; plan skipped
});
test("sync: openspec change discovered in same run prevents same-id plan from being added", () => {
  // This test guards the known.add(id) call inside the openspec loop of sync.
  // Without that call, a plan with the same id as a freshly-discovered openspec
  // change would be pushed as a second epic with lane "superpowers".
  const cwd = tmpRepo();
  run(["init"], { cwd });
  // On-disk OpenSpec change directory with tasks.md (no pre-existing epic in state)
  const chDir = path.join(cwd, "openspec", "changes", "auth");
  fs.mkdirSync(chDir, { recursive: true });
  fs.writeFileSync(path.join(chDir, "tasks.md"), "- [ ] a\n");
  // Superpowers plan with the same id
  fs.mkdirSync(path.join(cwd, "docs", "superpowers", "plans"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "docs", "superpowers", "plans", "auth.md"), "# Auth\n- [ ] a\n");
  // Both are discovered in the same sync run
  run(["sync"], { cwd });
  const matches = readState(cwd).epics.filter(x => x.id === "auth");
  assert.equal(matches.length, 1, "expected exactly one 'auth' epic");
  assert.equal(matches[0].lane, "openspec", "openspec change should win over same-run plan");
});
test("init stamps pmVersion from the running plugin", () => {
  const cwd = tmpRepo();
  const root = fixturePluginRoot("0.3.0");
  run(["init"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root } });
  assert.equal(readState(cwd).pmVersion, "0.3.0");
});
test("brief nudges when stamped pmVersion is older than running (semver-aware)", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  // simulate an old repo: stamp 0.9.0, run as 0.10.0 (string compare would get this wrong)
  const s = readState(cwd); s.pmVersion = "0.9.0"; writeState(cwd, s);
  const root = fixturePluginRoot("0.10.0");
  const out = JSON.parse(run(["brief"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root } })).hookSpecificOutput.additionalContext;
  assert.match(out, /pm 0\.9\.0 → 0\.10\.0 since this repo was set up/);
  assert.match(out, /\/pm:upgrade/);
});
test("no nudge when stamped equals running", () => {
  const cwd = tmpRepo();
  const root = fixturePluginRoot("0.3.0");
  run(["init"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root } });
  const out = JSON.parse(run(["brief"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root } })).hookSpecificOutput.additionalContext;
  assert.doesNotMatch(out, /since this repo was set up/);
});

// ---------- missing progress SOURCE must warn, not render an em dash (#86) ----------
//
// `bar()` renders an em dash for THREE different states: no source, empty source, and missing
// source. A dangling pointer therefore hid inside the normal reading. The openspec lane never
// warned at all; the plan lane warned even when the source was gone legitimately.
test("openspec epic with a missing tasks.md warns instead of rendering an em dash", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  writeState(cwd, { version: 1, active: null, detourStack: [], epics: [
    { id: "os", title: "os", priority: "P1", status: "queued", role: "epic", lane: "openspec", links: [] },
  ]});
  fs.mkdirSync(path.join(cwd, "openspec", "changes", "os"), { recursive: true });
  run(["render"], { cwd });
  assert.match(projectMd(cwd), /⚠ tasks\.md missing/,
    "a change dir with no tasks.md is indistinguishable from an empty one without this warning");
});
