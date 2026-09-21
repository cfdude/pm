// scripts/test/assert/conductor-06.test.mjs
// 5.3's ASSERTION TWIN of scripts/test/functional/conductor-06.test.mjs — same id, same subject.
//
// THE FUNCTIONAL FILE'S SUBJECT is the hierarchy/link family: the 0.5.0 link migration, plan-hierarchy
// batching, top-level depends-on ordering, remove-epic and its dangling-reference sweep, and
// verify-worktrees. ONLY verify-worktrees READS GIT: three of its five tests create a real repository
// and a real linked worktree (`gitInitWithCommit` + `addHierarchyWorktree`), which this half cannot do
// (design D5). Its FOURTH case — a directory that is not a repository at all — is exactly this half's
// world, and is kept.
//
// Everything else here is state-machine behaviour that needs no repository, and it is the behaviour a
// pre-commit gate must see break.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, runCombined, readState, writeState, parseBrief, expectFail, fixturePluginRoot, setupHierarchy } from "../fixtures/assert-harness.mjs";

// ───────────────────────── 0.5.0: link migration ─────────────────────────

test("0.5.0 migration repairs colon-string links, drops unrecoverable, is idempotent", () => {
  const cwd = tmpRepo();
  const root = fixturePluginRoot("0.5.0");
  run(["init"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root } });
  const s = readState(cwd);
  s.pmVersion = "0.4.1";
  s.epics.push({ id: "a", title: "a", priority: "P1", status: "queued", role: "epic", lane: "openspec",
    links: ["blocks:other:was flaky", { type: "related", epic: "z" }, "", {}] });
  writeState(cwd, s);

  run(["upgrade"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root } });
  const after = readState(cwd);
  assert.equal(after.pmVersion, "0.5.0");
  const links = after.epics.find(e => e.id === "a").links;
  assert.deepEqual(links.find(l => l.type === "blocks"), { type: "blocks", epic: "other", reason: "was flaky" });
  assert.ok(links.find(l => l.type === "related" && l.epic === "z"));  // valid object preserved
  assert.equal(links.length, 2);                                       // "" and {} dropped

  // idempotent on a second run
  const first = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
  run(["upgrade"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root } });
  assert.equal(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"), first);
});

test("plan-hierarchy batches independent children together, ordered by priority within a batch", () => {
  const cwd = tmpRepo();
  setupHierarchy(cwd);
  const out = JSON.parse(run(["plan-hierarchy", "--parent", "sprint"], { cwd }));
  assert.equal(out.parent, "sprint");
  assert.equal(out.batches.length, 1);
  assert.deepEqual(out.batches[0].epics.map(e => e.id), ["child-b", "child-a", "child-c"]); // P0, P1, P2
  for (const e of out.batches[0].epics) assert.deepEqual(e.dependsOn, []);
});

test("plan-hierarchy sequences a depends-on chain into separate batches", () => {
  const cwd = tmpRepo();
  setupHierarchy(cwd);
  run(["update-epic", "child-b", "--link", "depends-on:child-a:needs a's output"], { cwd });
  const out = JSON.parse(run(["plan-hierarchy", "--parent", "sprint"], { cwd }));
  assert.equal(out.batches.length, 2);
  assert.deepEqual(out.batches[0].epics.map(e => e.id), ["child-a", "child-c"]); // no unresolved deps
  assert.deepEqual(out.batches[1].epics.map(e => e.id), ["child-b"]);            // waits on child-a
  assert.deepEqual(out.batches[1].epics.find(e => e.id === "child-b").dependsOn, ["child-a"]);
});

test("plan-hierarchy ignores a depends-on link to an epic outside the hierarchy", () => {
  const cwd = tmpRepo();
  setupHierarchy(cwd);
  run(["add-epic", "--id", "outsider", "--lane", "claude-code"], { cwd });
  run(["update-epic", "child-a", "--link", "depends-on:outsider:unrelated"], { cwd });
  const out = JSON.parse(run(["plan-hierarchy", "--parent", "sprint"], { cwd }));
  assert.equal(out.batches.length, 1); // outsider isn't a sibling, so it doesn't force a second batch
});

test("plan-hierarchy detects and rejects a dependency cycle among children, naming the cycle path", () => {
  const cwd = tmpRepo();
  setupHierarchy(cwd);
  run(["update-epic", "child-a", "--link", "depends-on:child-b:x"], { cwd });
  run(["update-epic", "child-b", "--link", "depends-on:child-a:y"], { cwd });
  const err = expectFail(() => run(["plan-hierarchy", "--parent", "sprint"], { cwd }));
  assert.ok(err, "expected a cycle rejection");
  const msg = String(err.stderr || err.message);
  assert.match(msg, /dependency cycle/);
  assert.match(msg, /child-a/);
  assert.match(msg, /child-b/);
});

test("plan-hierarchy annotates each child's autonomy status", () => {
  const cwd = tmpRepo();
  setupHierarchy(cwd);
  run(["set-autonomy", "child-a", "--level", "autonomous"], { cwd });
  const out = JSON.parse(run(["plan-hierarchy", "--parent", "sprint"], { cwd }));
  const byId = Object.fromEntries(out.batches[0].epics.map(e => [e.id, e.autonomous]));
  assert.equal(byId["child-a"], true);
  assert.equal(byId["child-b"], false);
  assert.equal(byId["child-c"], false);
});

test("plan-hierarchy on a parent with no children returns an empty batches array", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "lonely-parent", "--lane", "claude-code"], { cwd });
  const out = JSON.parse(run(["plan-hierarchy", "--parent", "lonely-parent"], { cwd }));
  assert.deepEqual(out.batches, []);
});

test("plan-hierarchy rejects an unknown parent id", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  assert.ok(expectFail(() => run(["plan-hierarchy", "--parent", "ghost"], { cwd })));
});

test("plan-hierarchy requires --parent", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  assert.ok(expectFail(() => run(["plan-hierarchy"], { cwd })));
});

// ──────── top-level queue: dependency-aware ordering (dependency-aware-standalone-ordering) ────────

test("NEXT UP does not starve a top-level epic's unresolved depends-on dependency, even when the dependent outranks it on priority", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "low-dep", "--lane", "claude-code", "--priority", "P3"], { cwd });
  run(["add-epic", "--id", "high-blocked", "--lane", "claude-code", "--priority", "P0",
       "--link", "depends-on:low-dep:needs low-dep shipped first"], { cwd });
  const brief = parseBrief(cwd);
  assert.ok(brief.indexOf("`low-dep`") < brief.indexOf("`high-blocked`"),
    "unresolved dependency must be listed ahead of the higher-priority epic waiting on it");
});

test("brief prints a one-line note naming the blocking epic when priority order is overridden by an unresolved depends-on", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "low-dep", "--lane", "claude-code", "--priority", "P3"], { cwd });
  run(["add-epic", "--id", "high-blocked", "--lane", "claude-code", "--priority", "P0",
       "--link", "depends-on:low-dep:needs low-dep shipped first"], { cwd });
  assert.match(parseBrief(cwd), /`high-blocked` ready but waiting on `low-dep`/);
});

test("top-level dependency ordering applies across unrelated epics, not just siblings under one parent", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "infra", "--lane", "claude-code", "--priority", "P2"], { cwd });
  run(["add-epic", "--id", "feature", "--lane", "claude-code", "--priority", "P0",
       "--link", "depends-on:infra:needs infra"], { cwd });
  const brief = parseBrief(cwd);
  assert.ok(brief.indexOf("`infra`") < brief.indexOf("`feature`"));
  assert.match(brief, /`feature` ready but waiting on `infra`/);
});

test("a resolved depends-on (dependency archived) does not starve the dependent — no reordering, no note", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "done-dep", "--lane", "claude-code", "--priority", "P3"], { cwd });
  run(["add-epic", "--id", "dependent", "--lane", "claude-code", "--priority", "P0",
       "--link", "depends-on:done-dep:needs done-dep"], { cwd });
  run(["update-epic", "done-dep", "--status", "archived", "--outcome", "delivered", "--no-deferrals"], { cwd });
  const brief = parseBrief(cwd);
  assert.doesNotMatch(brief, /ready but waiting on/);
  assert.match(brief, /`dependent`/);
});

test("no unresolved depends-on among queued epics leaves plain priority order untouched (no notes)", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code", "--priority", "P0"], { cwd });
  run(["add-epic", "--id", "b", "--lane", "claude-code", "--priority", "P1"], { cwd });
  const brief = parseBrief(cwd);
  assert.ok(brief.indexOf("`a`") < brief.indexOf("`b`"));
  assert.doesNotMatch(brief, /ready but waiting on/);
});

test("a dependency cycle among top-level queued epics does not crash the brief — falls back gracefully", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code", "--priority", "P1"], { cwd });
  run(["add-epic", "--id", "b", "--lane", "claude-code", "--priority", "P1"], { cwd });
  run(["update-epic", "a", "--link", "depends-on:b:cyclic"], { cwd });
  run(["update-epic", "b", "--link", "depends-on:a:cyclic"], { cwd });
  const brief = parseBrief(cwd);
  assert.match(brief, /NEXT UP/);
  assert.match(brief, /`a`/);
  assert.match(brief, /`b`/);
});

// ---------- remove-epic ----------

test("remove-epic hard-deletes a childless, unreferenced epic", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code"], { cwd });
  run(["remove-epic", "a"], { cwd });
  assert.ok(!readState(cwd).epics.some(e => e.id === "a"));
});

test("remove-epic clears the active pointer when the removed epic was active", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code", "--status", "active"], { cwd });
  run(["remove-epic", "a"], { cwd });
  assert.equal(readState(cwd).active, null);
});

test("remove-epic strips dangling links[] from other epics and warns", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code"], { cwd });
  run(["add-epic", "--id", "b", "--lane", "claude-code", "--link", "depends-on:a"], { cwd });
  const out = runCombined(["remove-epic", "a"], { cwd });
  const b = readState(cwd).epics.find(e => e.id === "b");
  assert.deepEqual(b.links, []);
  assert.match(out, /stripped 1 dangling reference/);
  assert.match(out, /links\[\]/, "the warning names WHERE the reference was held, not just who held it");
  assert.match(out, /\bb\b/);
});

test("remove-epic blocks removal of an epic with children by default, printing a table", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "parent", "--lane", "claude-code", "--title", "Parent epic"], { cwd });
  run(["add-epic", "--id", "child1", "--lane", "claude-code", "--parent", "parent", "--title", "Child one"], { cwd });
  run(["add-epic", "--id", "child2", "--lane", "claude-code", "--parent", "parent", "--title", "Child two"], { cwd });
  const err = expectFail(() => run(["remove-epic", "parent"], { cwd }));
  assert.ok(err);
  const out = String(err.stdout || "") + String(err.stderr || "");
  assert.match(out, /child1/);
  assert.match(out, /child2/);
  assert.match(out, /--cascade/);
  const state = readState(cwd);
  assert.ok(state.epics.some(e => e.id === "parent"));
  assert.ok(state.epics.some(e => e.id === "child1"));
});

test("remove-epic blocked-removal preview includes grandchildren, not just direct children", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "parent", "--lane", "claude-code"], { cwd });
  run(["add-epic", "--id", "child", "--lane", "claude-code", "--parent", "parent"], { cwd });
  run(["add-epic", "--id", "grandchild", "--lane", "claude-code", "--parent", "child"], { cwd });
  const err = expectFail(() => run(["remove-epic", "parent"], { cwd }));
  assert.ok(err);
  const out = String(err.stdout || "") + String(err.stderr || "");
  assert.match(out, /grandchild/);
  assert.match(out, /2 descendant\(s\) total/);
});

test("remove-epic --cascade removes a parent and all its descendants", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "parent", "--lane", "claude-code"], { cwd });
  run(["add-epic", "--id", "child1", "--lane", "claude-code", "--parent", "parent"], { cwd });
  run(["add-epic", "--id", "grandchild", "--lane", "claude-code", "--parent", "child1"], { cwd });
  run(["remove-epic", "parent", "--cascade"], { cwd });
  assert.equal(readState(cwd).epics.length, 0);
});

test("remove-epic rejects an unknown id", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  assert.ok(expectFail(() => run(["remove-epic", "ghost"], { cwd })));
});

test("remove-epic requires a positional id", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  assert.ok(expectFail(() => run(["remove-epic"], { cwd })));
});

// ---------- verify-worktrees ----------

test("verify-worktrees returns an empty orphaned list gracefully when the cwd isn't a git repo at all", () => {
  // The assertion half's EVERY root is a directory git cannot answer about, so this is the same
  // case the functional file keeps for the same reason — the check must degrade, not throw.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const out = JSON.parse(run(["verify-worktrees"], { cwd }));
  assert.deepEqual(out.orphaned, []);
});

// ---------- remove-epic: every dangling reference, not just links[] ----------

test("remove-epic sweeps a release deferral, a carriedTo handoff and a deferral assertion", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "gone", "--lane", "claude-code"], { cwd });
  run(["add-epic", "--id", "holder", "--lane", "claude-code"], { cwd });
  run(["release", "0.27.0", "--intent", "a release"], { cwd });
  run(["release", "0.27.0", "--defer", "gone", "--reason", "cut for time"], { cwd });
  run(["update-epic", "holder", "--status", "archived", "--outcome", "delivered",
    "--carried-to", "gone", "--deferral", "gone:design.md § Risks"], { cwd });

  const out = runCombined(["remove-epic", "gone"], { cwd });
  const st = readState(cwd);
  const holder = st.epics.find(e => e.id === "holder");
  assert.deepEqual(st.releases[0].deferred, [],
    "a deferral naming a removed epic renders in PROJECT.md as a deferral pointing at nothing");
  assert.equal(holder.disposition.carriedTo, undefined, "a handoff to a removed epic names nothing");
  assert.deepEqual(holder.deferralAssertion.deferrals, [],
    "the assertion survives; the entry naming a removed epic does not");
  assert.match(out, /dangling/, "the sweep says what it dropped, as the links[] sweep already did");
});

test("remove-epic REFUSES while a detour frame names the epic, rather than dropping the frame", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const epic = (id) => ({ id, title: id, priority: "P1", status: "queued", role: "epic",
    lane: "claude-code", links: [], reconcileNeeded: false, attributedCommits: [] });
  writeState(cwd, { version: 1, active: "the-detour", detourStack: [
    { pausedEpic: "paused-one", reason: "blocked on it", spawnedDetour: "the-detour", reconcileOnResume: true },
  ], epics: [epic("paused-one"), epic("the-detour")] });
  const err = expectFail(() => run(["remove-epic", "paused-one"], { cwd }));
  assert.ok(err, "removing an epic held by a live detour frame must not silently succeed");
  const out = String(err.stdout || "") + String(err.stderr || "");
  assert.match(out, /detour/, "the refusal must say WHICH holder blocks it");
  assert.ok(readState(cwd).epics.some(e => e.id === "paused-one"), "nothing was removed");
});

// ───────────────────────── the deliberate omissions ─────────────────────────
//
// The three verify-worktrees cases that CREATE a repository and a linked worktree — an archived
// child, an in-flight child with an unmerged commit, and a merged-into-HEAD child — are
// functional-only by construction (design D5): the subject is what a real `git worktree list` holds
// and what `merge-base --is-ancestor` answers. The degradation case above is the half of that
// surface this half can prove, and scripts/test/functional/conductor-06.test.mjs holds the rest.
