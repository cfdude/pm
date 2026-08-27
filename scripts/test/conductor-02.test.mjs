import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tmpRepo, run, readState, writeState, projectMd, parseBrief, expectFail, fixtureCache, fixturePluginRoot, FIXTURE_CHANGELOG } from "./helpers.mjs";

test("upgrade on a never-stamped repo runs migrations, stamps lanes + pmVersion", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  // simulate a pre-0.3.0 repo: remove pmVersion, add an epic with no lane
  const s = readState(cwd); delete s.pmVersion;
  s.epics.push({ id: "legacy", title: "legacy", priority: "P1", status: "queued", role: "epic", links: [] });
  writeState(cwd, s);
  const root = fixturePluginRoot("0.3.0");
  run(["upgrade"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root } });
  const after = readState(cwd);
  assert.equal(after.pmVersion, "0.3.0");
  assert.equal(after.epics.find(e => e.id === "legacy").lane, "openspec");
});

test("upgrade from several versions behind applies ALL intermediate migrations", () => {
  // A repo two minor versions behind (0.2.0) must replay BOTH the 0.3.0 (lane) and
  // 0.5.0 (link-normalize) migrations — not just the most recent one.
  const cwd = tmpRepo();
  const root = fixturePluginRoot("0.5.1");
  run(["init"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root } });
  writeState(cwd, { version: 1, active: null, detourStack: [], pmVersion: "0.2.0",
    epics: [{ id: "old", title: "old", priority: "P1", status: "queued", role: "epic",
              links: ["blocks:other:was flaky", ""] }] });
  run(["upgrade"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root } });
  const after = readState(cwd);
  assert.equal(after.pmVersion, "0.5.1");
  const e = after.epics.find(x => x.id === "old");
  assert.equal(e.lane, "openspec");                                                 // 0.3.0 migration fired
  assert.deepEqual(e.links, [{ type: "blocks", epic: "other", reason: "was flaky" }]); // 0.5.0 migration fired
});

test("upgrade is idempotent on a second run", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const s = readState(cwd); delete s.pmVersion; writeState(cwd, s);
  const root = fixturePluginRoot("0.3.0");
  run(["upgrade"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root } });
  const first = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
  run(["upgrade"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root } });
  const second = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
  assert.equal(first, second);
});

test("rules block is lane-agnostic, not openspec-only", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const out = run(["rules"], { cwd });
  assert.match(out, /lane-agnostic/i);
  assert.match(out, /openspec \| superpowers \| claude-code/);
  assert.doesNotMatch(out, /becomes its own OpenSpec proposal/);
});

test("rules block always includes the epic-level autonomy section, with the five-criteria decision rule", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const out = run(["rules"], { cwd });
  assert.match(out, /## Epic-level autonomy/);
  assert.match(out, /set-autonomy/);
  assert.match(out, /No backup\/restore path exists\? → STOP/);
  assert.match(out, /Destructive but restorable.*→ WARN/);
  assert.match(out, /irreversible EXTERNAL side/i);   // scope boundary called out explicitly
});

test("render is a no-op when content is unchanged (no timestamp churn)", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["render"], { cwd });
  const first = fs.readFileSync(path.join(cwd, "PROJECT.md"), "utf8");
  run(["render"], { cwd });
  const second = fs.readFileSync(path.join(cwd, "PROJECT.md"), "utf8");
  assert.equal(first, second); // byte-identical, including the Last rendered line
});

test("render rewrites with a fresh stamp when content changes", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["render"], { cwd });
  const before = fs.readFileSync(path.join(cwd, "PROJECT.md"), "utf8");
  const s = readState(cwd);
  s.epics.push({ id: "x", title: "x", priority: "P1", status: "queued", role: "epic", lane: "claude-code", links: [] });
  writeState(cwd, s);
  run(["render"], { cwd });
  const after = fs.readFileSync(path.join(cwd, "PROJECT.md"), "utf8");
  assert.notEqual(before, after);
  assert.match(after, /`x`/);
});

test("add-epic accepts --status planned", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "road-1", "--title", "Road 1", "--lane", "openspec", "--status", "planned"], { cwd });
  assert.equal(readState(cwd).epics.find(e => e.id === "road-1").status, "planned");
});

test("add-epic and update-epic accept --status later and --status blocked (documented in README, previously rejected)", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "deferred", "--lane", "claude-code", "--status", "later"], { cwd });
  assert.equal(readState(cwd).epics.find(e => e.id === "deferred").status, "later");
  run(["add-epic", "--id", "stuck", "--lane", "claude-code", "--status", "blocked"], { cwd });
  assert.equal(readState(cwd).epics.find(e => e.id === "stuck").status, "blocked");
  run(["update-epic", "deferred", "--status", "blocked"], { cwd });
  assert.equal(readState(cwd).epics.find(e => e.id === "deferred").status, "blocked");
});

test("later/blocked epics are excluded from NEXT UP but still appear in the lanes rollup (unlike planned, which is excluded from both)", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  writeState(cwd, { version: 1, active: null, detourStack: [], epics: [
    { id: "ready", title: "ready", priority: "P1", status: "queued", role: "epic", lane: "claude-code", links: [] },
    { id: "deferred", title: "deferred", priority: "P0", status: "later", role: "epic", lane: "claude-code", links: [] },
    { id: "stuck", title: "stuck", priority: "P0", status: "blocked", role: "epic", lane: "claude-code", links: [] },
  ]});
  const brief = parseBrief(cwd);
  // Scoped to the NEXT UP block, not the whole brief. The contract under test is MEMBERSHIP of
  // the actionable queue; a whole-document `doesNotMatch` also asserted that a `blocked` epic is
  // NAMED NOWHERE, which is a different and much stronger claim — and a wrong one (gh#101): a
  // `blocked` epic with nothing recording what it waits on is precisely what has to be said out
  // loud, and it was said nowhere for exactly as long as this assertion held.
  const nextUp = brief.split("NEXT UP")[1].split("\n\n")[0];
  assert.match(nextUp, /`ready`/);
  assert.doesNotMatch(nextUp, /`deferred`/);
  assert.doesNotMatch(nextUp, /`stuck`/);
  assert.match(brief, /lanes: claude-code 3/);   // rollup counts all three, unlike planned
  // The other half of the same contract: excluded from the queue, still named by the record.
  assert.match(brief, /`stuck` is `blocked` with no `depends-on` link/);
});

test("add-epic rejects an unknown --status", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  assert.ok(expectFail(() => run(["add-epic", "--id", "x", "--lane", "openspec", "--status", "bogus"], { cwd })));
});

test("add-epic rejects a valueless --id and writes nothing", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  assert.ok(expectFail(() => run(["add-epic", "--lane", "openspec", "--id"], { cwd })));
  assert.equal(readState(cwd).epics.length, 0);
});

test("add-epic tolerates a valueless --link without crashing", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "y", "--lane", "claude-code", "--link"], { cwd }); // must not throw
  assert.deepEqual(readState(cwd).epics.find(e => e.id === "y").links, []);
});

test("ACCEPTANCE: 30 lane-tagged epics, zero OpenSpec changes", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const lanes = ["superpowers", "claude-code", "decision"];
  for (let i = 0; i < 30; i++) {
    const lane = lanes[i % lanes.length];
    const pr = `P${i % 4}`;
    run(["add-epic", "--id", `item-${String(i).padStart(2, "0")}`, "--title", `Item ${i}`,
         "--lane", lane, "--priority", pr], { cwd });
  }
  // mark one superpowers epic active with manual progress
  const s = readState(cwd);
  const target = s.epics.find(e => e.lane === "superpowers");
  target.status = "active";
  target.stories = [{ title: "a", done: true }, { title: "b", done: false }];
  s.active = target.id;
  writeState(cwd, s);
  run(["render"], { cwd });

  // all 30 registered, none from OpenSpec
  assert.equal(readState(cwd).epics.length, 30);
  assert.equal(fs.existsSync(path.join(cwd, "openspec")), false);

  // PROJECT.md shows them with lanes and the active one's progress
  const md = projectMd(cwd);
  for (let i = 0; i < 30; i++) assert.match(md, new RegExp(`item-${String(i).padStart(2, "0")}`));
  assert.match(md, /1\/2 stories/);                  // active epic's manual progress rendered
  assert.match(md, new RegExp(`\`${target.id}\``));

  // brief is bounded and shows lane counts
  const brief = parseBrief(cwd);
  assert.match(brief, /NOW: `/);
  assert.match(brief, /lanes: /);
  assert.match(brief, /\(\+\d+ more — see PROJECT\.md\)/);
});

test("planned openspec epic: not missing, not in NEXT UP, counted, in table", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  writeState(cwd, { version: 1, active: null, detourStack: [], epics: [
    { id: "4c", title: "4c", priority: "P0", status: "planned", role: "epic", lane: "openspec", links: [] },
  ]});
  run(["render"], { cwd });
  const md = projectMd(cwd);
  assert.doesNotMatch(md, /no change on disk/);            // not flagged missing
  assert.match(md, /`4c` \| openspec \| epic \| planned/); // shown in Epics table
  const brief = parseBrief(cwd);
  assert.doesNotMatch(brief, /NEXT UP/);                   // not actionable
  assert.match(brief, /planned: 1 — see PROJECT\.md/);
});

test("planned epics do not inflate the brief lanes: rollup", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  writeState(cwd, { version: 1, active: null, detourStack: [], epics: [
    { id: "q1", title: "q1", priority: "P1", status: "queued", role: "epic", lane: "superpowers", stories: [{ title: "a", done: false }], links: [] },
    { id: "p1", title: "p1", priority: "P0", status: "planned", role: "epic", lane: "openspec", links: [] },
  ]});
  const brief = parseBrief(cwd);
  assert.match(brief, /lanes: superpowers 1/);
  assert.doesNotMatch(brief, /openspec 1/);  // planned openspec excluded from lanes rollup
  assert.match(brief, /planned: 1/);
});

test("sync auto-transitions a planned openspec epic to untriaged once its change dir exists", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "feat-z", "--lane", "openspec", "--priority", "P1", "--status", "planned"], { cwd });
  assert.doesNotMatch(parseBrief(cwd), /`feat-z`/);  // planned → not in NEXT UP yet
  fs.mkdirSync(path.join(cwd, "openspec", "changes", "feat-z"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "openspec", "changes", "feat-z", "tasks.md"), "- [ ] a\n");
  run(["sync"], { cwd });
  assert.equal(readState(cwd).epics.find(e => e.id === "feat-z").status, "untriaged");
  assert.match(parseBrief(cwd), /`feat-z`/);         // now actionable
});

test("sync does not transition a non-openspec planned epic (lane guard)", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "dual", "--lane", "claude-code", "--status", "planned"], { cwd });
  fs.mkdirSync(path.join(cwd, "openspec", "changes", "dual"), { recursive: true });
  run(["sync"], { cwd });
  const e = readState(cwd).epics.find(x => x.id === "dual");
  assert.equal(e.lane, "claude-code");
  assert.equal(e.status, "planned");  // lane guard: not flipped despite a matching change dir
});

test("rules block mentions planned status and the roadmap on-ramp", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  const out = run(["rules"], { cwd });
  assert.match(out, /planned/);
  assert.match(out, /roadmap/i);
});

test("upgrade refuses when a newer pm is installed than the running engine", () => {
  const cwd = tmpRepo();
  const root03 = fixturePluginRoot("0.4.0");
  run(["init"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root03 } });
  const stampedBefore = readState(cwd).pmVersion; // 0.4.0
  const cache = fixtureCache(["0.4.0", "0.4.1"]);
  const err = expectFail(() => run(["upgrade"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root03, PM_CACHE_ROOT: cache } }));
  assert.ok(err, "expected non-zero exit when stale");
  assert.match(String(err.stderr || err.message), /0\.4\.0.*0\.4\.1|0\.4\.1.*installed/);
  assert.equal(readState(cwd).pmVersion, stampedBefore); // unchanged — no mutation
});

test("upgrade proceeds when the running engine is the newest installed", () => {
  const cwd = tmpRepo();
  const root = fixturePluginRoot("0.4.1");
  run(["init"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root } });
  const cache = fixtureCache(["0.4.0", "0.4.1"]);
  run(["upgrade"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root, PM_CACHE_ROOT: cache } });
  assert.equal(readState(cwd).pmVersion, "0.4.1");
});

test("upgrade proceeds when the cache cannot be read (newest null)", () => {
  const cwd = tmpRepo();
  const root = fixturePluginRoot("0.4.0");
  run(["init"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root } });
  // PM_CACHE_ROOT defaults to the empty cache → newest is null → guard no-op
  run(["upgrade"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root } });
  assert.equal(readState(cwd).pmVersion, "0.4.0");
});

test("newest-version semver: 0.10.0 beats 0.9.0 (guard fires)", () => {
  const cwd = tmpRepo();
  const root = fixturePluginRoot("0.9.0");
  run(["init"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root } });
  const cache = fixtureCache(["0.9.0", "0.10.0"]);
  const err = expectFail(() => run(["upgrade"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root, PM_CACHE_ROOT: cache } }));
  assert.ok(err, "0.10.0 must be treated as newer than 0.9.0");
});

test("nudge fires from newest-installed even when the running engine is old", () => {
  const cwd = tmpRepo();
  const root = fixturePluginRoot("0.3.0");
  run(["init"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root } }); // stamps 0.3.0
  const cache = fixtureCache(["0.3.0", "0.4.1"]);
  const out = JSON.parse(run(["brief"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root, PM_CACHE_ROOT: cache } }))
    .hookSpecificOutput.additionalContext;
  assert.match(out, /pm 0\.3\.0 → 0\.4\.1 available/);
  assert.match(out, /\/reload-plugins/);
  assert.match(out, /\/pm:upgrade/);
});

test("nudge inlines top Added-bullet headlines from versions between stamped and newest", () => {
  const cwd = tmpRepo();
  const root = fixturePluginRoot("0.4.0", FIXTURE_CHANGELOG);
  run(["init"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root } }); // stamps 0.4.0
  const cache = fixtureCache(["0.4.0", "0.6.0"]);
  const out = JSON.parse(run(["brief"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root, PM_CACHE_ROOT: cache } }))
    .hookSpecificOutput.additionalContext;
  assert.match(out, /pm 0\.4\.0 → 0\.6\.0 available/);
  assert.match(out, /Feature F6 lands here\./);
  assert.match(out, /Feature F5 lands here\./);
  assert.doesNotMatch(out, /Feature F4 lands here\./); // at/below stamped version, excluded
});

test("nudge headlines are capped at 3 even across many in-between versions", () => {
  const cwd = tmpRepo();
  const changelog = `# Changelog

## [0.4.0] — 2026-06-26
### Added
- Feature FA lands here.

---

## [0.3.0] — 2026-06-25
### Added
- Feature FB lands here.

---

## [0.2.0] — 2026-06-24
### Added
- Feature FC lands here.

---

## [0.1.0] — 2026-06-23
### Added
- Feature FD lands here.
`;
  const root = fixturePluginRoot("0.1.0", changelog);
  run(["init"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root } }); // stamps 0.1.0
  const cache = fixtureCache(["0.1.0", "0.4.0"]);
  const out = JSON.parse(run(["brief"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root, PM_CACHE_ROOT: cache } }))
    .hookSpecificOutput.additionalContext;
  assert.match(out, /Feature FA lands here\./);
  assert.match(out, /Feature FB lands here\./);
  assert.match(out, /Feature FC lands here\./);
  assert.doesNotMatch(out, /Feature FD lands here\./); // 4th headline, over the cap of 3
});

test("nudge has no headlines section when the plugin ships no CHANGELOG", () => {
  const cwd = tmpRepo();
  const root = fixturePluginRoot("0.3.0"); // no changelog file
  run(["init"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root } });
  const cache = fixtureCache(["0.3.0", "0.4.1"]);
  const out = JSON.parse(run(["brief"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root, PM_CACHE_ROOT: cache } }))
    .hookSpecificOutput.additionalContext;
  assert.match(out, /pm 0\.3\.0 → 0\.4\.1 available/);
});

test("no nudge when stamped equals newest installed", () => {
  const cwd = tmpRepo();
  const root = fixturePluginRoot("0.4.1");
  run(["init"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root } });
  const cache = fixtureCache(["0.4.1"]);
  const out = JSON.parse(run(["brief"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root, PM_CACHE_ROOT: cache } }))
    .hookSpecificOutput.additionalContext;
  assert.doesNotMatch(out, /available —/);
  assert.doesNotMatch(out, /since this repo was set up/);
});
