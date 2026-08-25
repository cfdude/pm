import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tmpRepo, run, runCombined, readState, writeState, parseBrief, expectFail, fixturePluginRoot, setupHierarchy, gitInitWithCommit, addHierarchyWorktree } from "./helpers.mjs";

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
  const childA = out.batches[0].epics.find(e => e.id === "child-a");
  assert.deepEqual(childA.dependsOn, []);
  const childB = out.batches[1].epics.find(e => e.id === "child-b");
  assert.deepEqual(childB.dependsOn, ["child-a"]);
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
  const brief = parseBrief(cwd);
  assert.match(brief, /`high-blocked` ready but waiting on `low-dep`/);
});

test("top-level dependency ordering applies across unrelated epics, not just siblings under one parent", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  // No parent/child relationship at all — both are top-level, unrelated epics.
  run(["add-epic", "--id", "infra", "--lane", "claude-code", "--priority", "P2"], { cwd });
  run(["add-epic", "--id", "feature", "--lane", "claude-code", "--priority", "P0",
       "--link", "depends-on:infra:needs infra"], { cwd });
  const brief = parseBrief(cwd);
  assert.ok(brief.indexOf("`infra`") < brief.indexOf("`feature`"),
    "top-level depends-on ordering must not be limited to plan-hierarchy's parent/child scope");
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
  // dependent is now the only queued epic left (done-dep archived, excluded from NEXT UP).
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
  const state = readState(cwd);
  assert.ok(!state.epics.some(e => e.id === "a"));
});

test("remove-epic clears the active pointer when the removed epic was active", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code", "--status", "active"], { cwd });
  run(["remove-epic", "a"], { cwd });
  const state = readState(cwd);
  assert.equal(state.active, null);
});

test("remove-epic strips dangling links[] from other epics and warns", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code"], { cwd });
  run(["add-epic", "--id", "b", "--lane", "claude-code", "--link", "depends-on:a"], { cwd });
  const out = runCombined(["remove-epic", "a"], { cwd });
  const state = readState(cwd);
  const b = state.epics.find(e => e.id === "b");
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
  const state = readState(cwd);
  assert.equal(state.epics.length, 0);
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

test("verify-worktrees reports no orphans when there are no hierarchy-child worktrees", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  gitInitWithCommit(cwd);
  const out = JSON.parse(run(["verify-worktrees"], { cwd }));
  assert.deepEqual(out.orphaned, []);
});

test("verify-worktrees flags a hierarchy-child worktree whose epic is already archived", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  gitInitWithCommit(cwd);
  run(["add-epic", "--id", "done-child", "--lane", "claude-code", "--status", "archived"], { cwd });
  const wtPath = addHierarchyWorktree(cwd, "done-child");
  const out = JSON.parse(run(["verify-worktrees"], { cwd }));
  assert.equal(out.orphaned.length, 1);
  assert.equal(out.orphaned[0].epicId, "done-child");
  assert.equal(out.orphaned[0].branch, "hierarchy-child/done-child");
  assert.equal(fs.realpathSync(out.orphaned[0].path), fs.realpathSync(wtPath));
  execFileSync("git", ["worktree", "remove", "--force", wtPath], { cwd });
});

test("verify-worktrees does not flag a hierarchy-child worktree whose epic is still in flight and whose branch has unmerged work", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  gitInitWithCommit(cwd);
  run(["add-epic", "--id", "in-flight-child", "--lane", "claude-code", "--status", "active"], { cwd });
  const wtPath = addHierarchyWorktree(cwd, "in-flight-child");
  // Simulate real in-flight work: a commit on the child branch not yet merged into HEAD, so
  // its tip is genuinely NOT an ancestor of the current branch (unlike a freshly-created
  // worktree, whose tip trivially equals HEAD at creation time).
  fs.writeFileSync(path.join(wtPath, "wip.txt"), "wip\n");
  execFileSync("git", ["add", "wip.txt"], { cwd: wtPath });
  execFileSync("git", ["commit", "-q", "-m", "wip"], { cwd: wtPath });
  const out = JSON.parse(run(["verify-worktrees"], { cwd }));
  assert.deepEqual(out.orphaned, []);
  execFileSync("git", ["worktree", "remove", "--force", wtPath], { cwd });
});

test("verify-worktrees flags a hierarchy-child worktree whose branch is already merged into HEAD, even when the epic's status is not archived", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  gitInitWithCommit(cwd);
  run(["add-epic", "--id", "merged-child", "--lane", "claude-code", "--status", "active"], { cwd });
  const wtPath = addHierarchyWorktree(cwd, "merged-child");
  // Branch tip is created directly from HEAD (no divergent commits), so it's trivially an
  // ancestor of HEAD — mirrors the real "git branch -d failed, used by worktree" scenario
  // where the merge already landed but the worktree/epic bookkeeping wasn't cleaned up.
  const out = JSON.parse(run(["verify-worktrees"], { cwd }));
  assert.equal(out.orphaned.length, 1);
  assert.equal(out.orphaned[0].epicId, "merged-child");
  assert.deepEqual(out.orphaned[0].reasons, ["branch-merged"]);
  execFileSync("git", ["worktree", "remove", "--force", wtPath], { cwd });
});

test("verify-worktrees returns an empty orphaned list gracefully when the cwd isn't a git repo at all", () => {
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
  // The other holders are records; a detour frame is CONTROL STATE. Silently dropping it would
  // discard a paused epic's resume path, and silently keeping it would leave `/pm:resume`
  // popping a frame that names nothing. Neither is a sweep, so this one refuses.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const epic = (id) => ({ id, title: id, priority: "P1", status: "queued", role: "epic",
    lane: "claude-code", links: [], reconcileNeeded: false, attributedCommits: [] });
  // Written directly because `/pm:detour` is an INSTRUCTION-layer command — the engine has no
  // subcommand that pushes a frame, so state is where one comes from.
  writeState(cwd, { version: 1, active: "the-detour", detourStack: [
    { pausedEpic: "paused-one", reason: "blocked on it", spawnedDetour: "the-detour", reconcileOnResume: true },
  ], epics: [epic("paused-one"), epic("the-detour")] });
  const err = expectFail(() => run(["remove-epic", "paused-one"], { cwd }));
  assert.ok(err, "removing an epic held by a live detour frame must not silently succeed");
  const out = String(err.stdout || "") + String(err.stderr || "");
  assert.match(out, /detour/, "the refusal must say WHICH holder blocks it");
  assert.ok(readState(cwd).epics.some(e => e.id === "paused-one"), "nothing was removed");
});
