// gh-101 — dependency ordering across the WHOLE record, effective priority, and manual rank.
//
// The defect this file pins: `orderQueueWithDependencies()` only ever saw `queued`/`untriaged`
// epics, so a `depends-on` edge pointing at a `planned`, `later`, `blocked` or `paused` epic was
// silently inert — the dependent sorted as if nothing were in its way, and the thing that would
// unblock it appeared nowhere near it. Every fixture below therefore puts the blocker in a
// status the old pass could not see; a fixture with a `queued` blocker would pass against the
// pre-existing topological sort and prove nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { run, tmpRepo, parseBrief, projectMd, readState } from "./helpers.mjs";

// ──────── effective priority — computed over the depends-on closure, never stored ────────

test("a planned blocker inherits the effective priority of the queued epic that depends on it", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "blocker", "--lane", "claude-code", "--priority", "P2", "--status", "planned"], { cwd });
  run(["add-epic", "--id", "goal", "--lane", "claude-code", "--priority", "P1", "--status", "queued",
       "--link", "depends-on:blocker:cannot start without it"], { cwd });
  const md = projectMd(cwd);
  assert.match(md, /\| P2 → P1 \| `blocker`/, "PROJECT.md must show the merit priority AND the inherited effective one");
  assert.doesNotMatch(md, /\| P1 → P1 \| `goal`/, "an epic whose effective priority equals its merit must render one value");
});

test("effective priority is never written back to state.json", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "blocker", "--lane", "claude-code", "--priority", "P2", "--status", "planned"], { cwd });
  run(["add-epic", "--id", "goal", "--lane", "claude-code", "--priority", "P1",
       "--link", "depends-on:blocker:needed"], { cwd });
  run(["render"], { cwd });
  const st = readState(cwd);
  const blocker = st.epics.find(e => e.id === "blocker");
  assert.equal(blocker.priority, "P2", "merit priority stays legible");
  assert.equal(blocker.effectivePriority, undefined, "effective priority is computed, never stored");
});

test("effective priority propagates transitively along depends-on", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "deep", "--lane", "claude-code", "--priority", "P3", "--status", "planned"], { cwd });
  run(["add-epic", "--id", "mid", "--lane", "claude-code", "--priority", "P2", "--status", "planned",
       "--link", "depends-on:deep:needs deep"], { cwd });
  run(["add-epic", "--id", "goal", "--lane", "claude-code", "--priority", "P0",
       "--link", "depends-on:mid:needs mid"], { cwd });
  const md = projectMd(cwd);
  assert.match(md, /\| P3 → P0 \| `deep`/, "priority must travel the whole closure, not one hop");
  assert.match(md, /\| P2 → P0 \| `mid`/);
});

test("an ARCHIVED dependent does not lift its blocker — a satisfied dependency has nothing left to unblock", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "blocker", "--lane", "claude-code", "--priority", "P3", "--status", "planned"], { cwd });
  run(["add-epic", "--id", "goal", "--lane", "claude-code", "--priority", "P0",
       "--link", "depends-on:blocker:needed"], { cwd });
  run(["update-epic", "goal", "--status", "archived", "--outcome", "delivered", "--no-deferrals"], { cwd });
  const md = projectMd(cwd);
  assert.doesNotMatch(md, /P3 → /, "an archived dependent must not keep lifting the epic it once needed");
});

test("effective priority reorders the record — a lifted planned blocker sorts above an unrelated P2", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "zzz-blocker", "--lane", "claude-code", "--priority", "P3", "--status", "planned"], { cwd });
  run(["add-epic", "--id", "aaa-unrelated", "--lane", "claude-code", "--priority", "P2"], { cwd });
  run(["add-epic", "--id", "goal", "--lane", "claude-code", "--priority", "P0",
       "--link", "depends-on:zzz-blocker:needed"], { cwd });
  const md = projectMd(cwd);
  assert.ok(md.indexOf("`zzz-blocker`") < md.indexOf("`aaa-unrelated`"),
    "a P3 lifted to effective P0 must outrank an unrelated P2 despite sorting last alphabetically");
});

test("a dependency cycle among non-queued epics does not hang or crash the render", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code", "--priority", "P1", "--status", "planned"], { cwd });
  run(["add-epic", "--id", "b", "--lane", "claude-code", "--priority", "P2", "--status", "blocked"], { cwd });
  run(["update-epic", "a", "--link", "depends-on:b:cyclic"], { cwd });
  run(["update-epic", "b", "--link", "depends-on:a:cyclic"], { cwd });
  const md = projectMd(cwd);
  assert.match(md, /`a`/);
  assert.match(md, /`b`/);
});

// ──────── the statement — an inversion a human can act on in seconds ────────

test("the brief names a P1's non-queued, lower-priority dependency instead of offering the P1 as workable", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "gh-79", "--lane", "claude-code", "--priority", "P2", "--status", "planned"], { cwd });
  run(["add-epic", "--id", "gh-95", "--lane", "claude-code", "--priority", "P1",
       "--link", "depends-on:gh-79:the archive gate fires on false positives until then"], { cwd });
  const brief = parseBrief(cwd);
  assert.match(brief, /`gh-95` \(P1\) depends on `gh-79` \(P2, planned\)/);
  assert.match(brief, /lower-priority and not queued/);
  assert.match(brief, /effective priority P1/);
});

test("a SAME-priority non-queued dependency is reported as not queued and NOT as lower-priority", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "dep", "--lane", "claude-code", "--priority", "P1", "--status", "later"], { cwd });
  run(["add-epic", "--id", "goal", "--lane", "claude-code", "--priority", "P1",
       "--link", "depends-on:dep:needed"], { cwd });
  const brief = parseBrief(cwd);
  assert.match(brief, /`goal` \(P1\) depends on `dep` \(P1, later\) — the dependency is not queued/);
  assert.doesNotMatch(brief, /lower-priority/, "the reason must be derived per-edge, not a constant string");
});

test("PROJECT.md carries the same dependency warnings the brief does — /pm:next reads PROJECT.md, not the brief", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "dep", "--lane", "claude-code", "--priority", "P2", "--status", "planned"], { cwd });
  run(["add-epic", "--id", "goal", "--lane", "claude-code", "--priority", "P1",
       "--link", "depends-on:dep:needed"], { cwd });
  const md = projectMd(cwd);
  assert.match(md, /## Dependency warnings/);
  assert.match(md, /`goal` \(P1\) depends on `dep` \(P2, planned\)/);
});

test("an archived dependency produces no warning at all", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "dep", "--lane", "claude-code", "--priority", "P2", "--status", "planned"], { cwd });
  run(["add-epic", "--id", "goal", "--lane", "claude-code", "--priority", "P1",
       "--link", "depends-on:dep:needed"], { cwd });
  run(["update-epic", "dep", "--status", "archived", "--outcome", "delivered", "--no-deferrals"], { cwd });
  const md = projectMd(cwd);
  assert.doesNotMatch(md, /## Dependency warnings/);
});

// ──────── `blocked` derived from depends-on, with nothing stored ────────

test("a `blocked` epic with no depends-on edge is reported as recording nothing about what it waits on", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "stuck", "--lane", "claude-code", "--priority", "P1", "--status", "blocked"], { cwd });
  const brief = parseBrief(cwd);
  assert.match(brief, /`stuck` is `blocked` with no `depends-on` link/);
  assert.match(brief, /update-epic stuck --link "depends-on:/);
});

test("a `blocked` epic WITH an unsatisfied depends-on edge is not reported as recording nothing", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "dep", "--lane", "claude-code", "--priority", "P2", "--status", "planned"], { cwd });
  run(["add-epic", "--id", "stuck", "--lane", "claude-code", "--priority", "P1", "--status", "blocked",
       "--link", "depends-on:dep:waiting on it"], { cwd });
  const brief = parseBrief(cwd);
  assert.doesNotMatch(brief, /with no `depends-on` link/);
});

test("a `blocked` epic whose only depends-on is ARCHIVED records nothing live — it is reported", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "dep", "--lane", "claude-code", "--priority", "P2"], { cwd });
  run(["add-epic", "--id", "stuck", "--lane", "claude-code", "--priority", "P1", "--status", "blocked",
       "--link", "depends-on:dep:waiting"], { cwd });
  run(["update-epic", "dep", "--status", "archived", "--outcome", "delivered", "--no-deferrals"], { cwd });
  const brief = parseBrief(cwd);
  assert.match(brief, /`stuck` is `blocked` with no `depends-on` link/);
});
