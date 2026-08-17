import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tmpRepo, run, readState, writeState, projectMd, claudeMd, parseBrief, manyEpics, expectFail, fixturePluginRoot } from "./helpers.mjs";

test("epic without lane reads as openspec (back-compat) and shows a Lane column", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  writeState(cwd, {
    version: 1, active: null, detourStack: [],
    epics: [{ id: "legacy", title: "Legacy epic", priority: "P1", status: "queued", role: "epic", links: [], reconcileNeeded: false }],
  });
  run(["render"], { cwd });
  const md = projectMd(cwd);
  assert.match(md, /\| Lane \|/);            // Lane column header exists
  assert.match(md, /`legacy`/);
  assert.match(md, /\| openspec \|/);        // legacy epic defaulted to openspec
});

test("epics sort by priority then lane rank deterministically", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  writeState(cwd, {
    version: 1, active: null, detourStack: [],
    epics: [
      { id: "b-sp", title: "b", priority: "P1", status: "queued", role: "epic", lane: "superpowers", links: [] },
      { id: "a-os", title: "a", priority: "P1", status: "queued", role: "epic", lane: "openspec", links: [] },
      { id: "c-cc", title: "c", priority: "P0", status: "queued", role: "epic", lane: "claude-code", links: [] },
    ],
  });
  run(["render"], { cwd });
  const md = projectMd(cwd);
  // P0 claude-code first, then P1 openspec before P1 superpowers
  const order = ["c-cc", "a-os", "b-sp"].map(id => md.indexOf(`\`${id}\``));
  assert.ok(order[0] < order[1] && order[1] < order[2], `bad order: ${order}`);
});

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
  // of atomicity — the CLI is exercised via execFileSync (a child process), so this test
  // harness can't inject a crash mid-write to directly observe the failure-path guarantee
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

test("progress precedence: manual stories win", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  writeState(cwd, { version: 1, active: null, detourStack: [], epics: [
    { id: "m", title: "m", priority: "P1", status: "queued", role: "epic", lane: "claude-code",
      stories: [{ title: "a", done: true }, { title: "b", done: false }], links: [] },
  ]});
  run(["render"], { cwd });
  assert.match(projectMd(cwd), /1\/2 stories/);
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

test("dangling planPath renders a warning, not a count", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  writeState(cwd, { version: 1, active: null, detourStack: [], epics: [
    { id: "sp", title: "sp", priority: "P1", status: "queued", role: "epic", lane: "superpowers",
      planPath: "docs/superpowers/plans/missing.md", links: [] },
  ]});
  run(["render"], { cwd });
  assert.match(projectMd(cwd), /⚠ planPath missing/);
});

test("decision lane with no source renders an em dash", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  writeState(cwd, { version: 1, active: null, detourStack: [], epics: [
    { id: "d", title: "d", priority: "P2", status: "queued", role: "epic", lane: "decision", links: [] },
  ]});
  run(["render"], { cwd });
  assert.match(projectMd(cwd), /`d` \| decision \| epic \| queued \| — \|/);
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

test("non-openspec epic appears in NEXT UP", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  writeState(cwd, { version: 1, active: null, detourStack: [], epics: [
    { id: "sp1", title: "sp1", priority: "P1", status: "queued", role: "epic", lane: "superpowers",
      stories: [{ title: "x", done: false }], links: [] },
  ]});
  const brief = parseBrief(cwd);
  assert.match(brief, /NEXT UP/);
  assert.match(brief, /`sp1` \(P1, superpowers, queued\)/);
});

test("missing openspec change is marked and excluded from NEXT UP", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  writeState(cwd, { version: 1, active: null, detourStack: [], epics: [
    { id: "ghost", title: "ghost", priority: "P1", status: "queued", role: "epic", lane: "openspec", links: [] },
  ]});
  run(["render"], { cwd });
  assert.match(projectMd(cwd), /no change on disk/);
  const brief = parseBrief(cwd);
  assert.doesNotMatch(brief, /`ghost`/);
});

test("an archived openspec epic is never flagged as missing its change, even if its change dir is gone", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  writeState(cwd, { version: 1, active: null, detourStack: [], epics: [
    { id: "shipped", title: "shipped", priority: "P1", status: "archived", role: "epic", lane: "openspec", links: [] },
  ]});
  run(["render"], { cwd });
  assert.doesNotMatch(projectMd(cwd), /no change on disk/);
});

test("brief caps NEXT UP at 5 and reports the remainder", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  writeState(cwd, { version: 1, active: null, detourStack: [], epics: manyEpics(8) });
  const brief = parseBrief(cwd);
  const shown = (brief.match(/^ {2}• /gm) || []).length;
  assert.equal(shown, 5);
  assert.match(brief, /\(\+3 more — see PROJECT\.md\)/);
  assert.match(brief, /lanes: superpowers 8/);
});

test("active epic is shown even when NEXT UP is capped", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const epics = manyEpics(8);
  epics.push({ id: "live", title: "live", priority: "P0", status: "active", role: "epic", lane: "openspec", links: [] });
  writeState(cwd, { version: 1, active: "live", detourStack: [], epics });
  const brief = parseBrief(cwd);
  assert.match(brief, /NOW: `live`/);
});

test("epic with no autonomy field defaults to level off via render/brief (no crash, no marker)", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code", "--status", "active"], { cwd });
  const md = projectMd(cwd);
  assert.match(md, /`a`/);
  assert.doesNotMatch(md, /🤖/);              // no autonomy marker for a plain epic
  const brief = parseBrief(cwd);
  assert.doesNotMatch(brief, /🤖/);
});

test("add-epic inserts a lane-tagged epic with defaults", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "refactor-auth", "--title", "Refactor auth", "--lane", "superpowers", "--priority", "P1"], { cwd });
  const e = readState(cwd).epics.find(x => x.id === "refactor-auth");
  assert.equal(e.lane, "superpowers");
  assert.equal(e.priority, "P1");
  assert.equal(e.status, "queued");
  assert.equal(e.role, "epic");
});

test("add-epic rejects a duplicate id", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "dup", "--lane", "claude-code"], { cwd });
  const err = expectFail(() => run(["add-epic", "--id", "dup", "--lane", "claude-code"], { cwd }));
  assert.ok(err, "expected non-zero exit on duplicate");
});

test("add-epic rejects a bad id and an unknown lane", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  assert.ok(expectFail(() => run(["add-epic", "--id", "Bad ID", "--lane", "claude-code"], { cwd })));
  assert.ok(expectFail(() => run(["add-epic", "--id", "ok", "--lane", "nope"], { cwd })));
});

test("add-epic stores planPath and links", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "y", "--lane", "claude-code"], { cwd });   // link target must exist
  run(["add-epic", "--id", "x", "--lane", "superpowers", "--plan", "docs/superpowers/plans/x.md",
       "--link", "blocks:y:needs token"], { cwd });
  const e = readState(cwd).epics.find(x => x.id === "x");
  assert.equal(e.planPath, "docs/superpowers/plans/x.md");
  assert.deepEqual(e.links, [{ type: "blocks", epic: "y", reason: "needs token" }]);
});

test("add-epic rejects a --link whose epic id doesn't exist, instead of silently storing garbage", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const before = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
  // the reported real-world typo: "type:related:epic:..." — split(":") yields
  // type="type", epic="related", and "related" is not a real epic id.
  const err = expectFail(() => run(["add-epic", "--id", "x", "--lane", "claude-code",
    "--link", "type:related:epic:some reason"], { cwd }));
  assert.ok(err, "expected rejection");
  assert.match(String(err.stderr || err.message), /not a known epic/);
  assert.equal(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"), before);
  assert.equal(readState(cwd).epics.length, 0);   // epic itself was not created either
});

test("add-epic rejects a --link with fewer than two segments", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  assert.ok(expectFail(() => run(["add-epic", "--id", "x", "--lane", "claude-code",
    "--link", "justoneword"], { cwd })));
});

test("update-epic --link replaces the epic's links wholesale, validated the same way as add-epic", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "y", "--lane", "claude-code"], { cwd });
  run(["add-epic", "--id", "z", "--lane", "claude-code"], { cwd });
  run(["add-epic", "--id", "x", "--lane", "claude-code", "--link", "blocks:y:old reason"], { cwd });
  run(["update-epic", "x", "--link", "relates-to:z:new reason"], { cwd });
  const e = readState(cwd).epics.find(x => x.id === "x");
  assert.deepEqual(e.links, [{ type: "relates-to", epic: "z", reason: "new reason" }]);   // replaced, not appended

  // fixing a malformed link works the same way: an invalid --link is rejected and
  // writes nothing, leaving the last-good links array intact.
  const before = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
  const err = expectFail(() => run(["update-epic", "x", "--link", "type:ghost-epic:bad"], { cwd }));
  assert.ok(err, "expected rejection");
  assert.equal(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"), before);
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

test("sync tolerates a missing plans dir", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });            // no docs/ dir at all
  run(["sync"], { cwd });            // must not throw
  assert.ok(Array.isArray(readState(cwd).epics));
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

test("an ARCHIVED epic never warns about a missing source — archiving is when it legitimately goes away", () => {
  // Measured on a 108-epic repo: 7 of 8 epics carrying a planPath dangled, and all 7 were
  // archived with their plan correctly moved out of plans/. Warning there is wrong 7 times
  // out of 8, which trains the reader to ignore the once it is right.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  writeState(cwd, { version: 1, active: null, detourStack: [], epics: [
    { id: "sp-done", title: "sp-done", priority: "P1", status: "archived", role: "epic",
      lane: "superpowers", planPath: "docs/superpowers/plans/moved.md", links: [] },
    { id: "os-done", title: "os-done", priority: "P1", status: "archived", role: "epic",
      lane: "openspec", links: [] },
  ]});
  run(["render"], { cwd });
  assert.doesNotMatch(projectMd(cwd), /⚠ planPath missing/);
  assert.doesNotMatch(projectMd(cwd), /⚠ tasks\.md missing/);
});

test("a non-archived dangling planPath still warns — the exemption is scoped to archived only", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  writeState(cwd, { version: 1, active: null, detourStack: [], epics: [
    { id: "sp-live", title: "sp-live", priority: "P1", status: "active", role: "epic",
      lane: "superpowers", planPath: "docs/superpowers/plans/gone.md", links: [] },
  ]});
  run(["render"], { cwd });
  assert.match(projectMd(cwd), /⚠ planPath missing/);
});
