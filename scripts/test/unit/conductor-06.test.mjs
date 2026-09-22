// scripts/test/unit/conductor-06.test.mjs
// 4.1's migration of `assert/conductor-06.test.mjs` — 25 of its 26 tests, moved from the file rung
// to the unit rung with every assertion unchanged.
//
// THE FUNCTIONAL FILE'S SUBJECT is the hierarchy/link family: the 0.5.0 link migration, plan-hierarchy
// batching, top-level depends-on ordering, remove-epic and its dangling-reference sweep, and
// verify-worktrees. ONLY verify-worktrees READS GIT: three of its five tests create a real repository
// and a real linked worktree (`gitInitWithCommit` + `addHierarchyWorktree`), which no assertion-half
// rung can do (design D5). Its FOURTH case — a directory that is not a repository at all — is exactly
// the assertion half's world, and is kept here.
//
// Everything else here is state-machine behaviour that needs no repository, and it is the behaviour a
// pre-commit gate must see break.
//
// ─────────────── WHAT MOVED, AND WHAT DID NOT ───────────────
//
// Twenty-five of twenty-six: every observable is a VALUE — plan-hierarchy's JSON, the brief's
// rendered text, a record field, a refusal printed to a stream. ONE STAYS on the file rung, and its
// reason is that its SUBJECT is the upgrade path itself: it seeds `pmVersion` and a malformed links[]
// array, then runs `upgrade` twice with `fixturePluginRoot("0.5.0")` — a REAL plugin directory on
// disk — and asserts idempotence by comparing state.json's BYTES. `upgrade` also back-fills
// `.gitignore`, which the store does not own.
//
// The mechanism that changed:
//
//   `tmpRepo()` + `run(["init"], { cwd })`  →  `memoryEngine(emptyRecord())`
//   `setupHierarchy(cwd)`                   →  `sprint(engine)` — the same four registrations
//   `run(args, { cwd })`                    →  `engine(args)`
//   `runCombined(args, { cwd })`            →  `engine.combined(args)`
//   `readState(cwd)`                        →  `engine.store.record()`
//   `parseBrief(cwd)`                       →  the `brief` verb's own stdout, parsed the same way
//   `writeState(cwd, wholeRecord)`          →  a `memoryEngine(wholeRecord)` seed — the write
//                                              REPLACED the record, and a seed is that replacement

import assert from "node:assert/strict";
import { emptyRecord, expectFail, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

const readState = (engine) => engine.store.record();
const parseBrief = (engine) =>
  JSON.parse(engine(["brief"])).hookSpecificOutput.additionalContext;

/** `helpers.mjs`'s `setupHierarchy()`, spelled for this rung: the same `sprint` plus three children,
 *  with the same priorities. The helper itself is bound to the file rung's `run()`. */
function sprint(engine) {
  engine(["add-epic", "--id", "sprint", "--lane", "claude-code"]);
  engine(["add-epic", "--id", "child-a", "--lane", "claude-code", "--parent", "sprint", "--priority", "P1"]);
  engine(["add-epic", "--id", "child-b", "--lane", "claude-code", "--parent", "sprint", "--priority", "P0"]);
  engine(["add-epic", "--id", "child-c", "--lane", "claude-code", "--parent", "sprint", "--priority", "P2"]);
}

unitTest("plan-hierarchy batches independent children together, ordered by priority within a batch", () => {
  const engine = memoryEngine(emptyRecord());
  sprint(engine);
  const out = JSON.parse(engine(["plan-hierarchy", "--parent", "sprint"]));
  assert.equal(out.parent, "sprint");
  assert.equal(out.batches.length, 1);
  assert.deepEqual(out.batches[0].epics.map(e => e.id), ["child-b", "child-a", "child-c"]); // P0, P1, P2
  for (const e of out.batches[0].epics) assert.deepEqual(e.dependsOn, []);
});
unitTest("plan-hierarchy sequences a depends-on chain into separate batches", () => {
  const engine = memoryEngine(emptyRecord());
  sprint(engine);
  engine(["update-epic", "child-b", "--link", "depends-on:child-a:needs a's output"]);
  const out = JSON.parse(engine(["plan-hierarchy", "--parent", "sprint"]));
  assert.equal(out.batches.length, 2);
  assert.deepEqual(out.batches[0].epics.map(e => e.id), ["child-a", "child-c"]); // no unresolved deps
  assert.deepEqual(out.batches[1].epics.map(e => e.id), ["child-b"]);            // waits on child-a
  assert.deepEqual(out.batches[1].epics.find(e => e.id === "child-b").dependsOn, ["child-a"]);
});
unitTest("plan-hierarchy ignores a depends-on link to an epic outside the hierarchy", () => {
  const engine = memoryEngine(emptyRecord());
  sprint(engine);
  engine(["add-epic", "--id", "outsider", "--lane", "claude-code"]);
  engine(["update-epic", "child-a", "--link", "depends-on:outsider:unrelated"]);
  const out = JSON.parse(engine(["plan-hierarchy", "--parent", "sprint"]));
  assert.equal(out.batches.length, 1); // outsider isn't a sibling, so it doesn't force a second batch
});
unitTest("plan-hierarchy detects and rejects a dependency cycle among children, naming the cycle path", () => {
  const engine = memoryEngine(emptyRecord());
  sprint(engine);
  engine(["update-epic", "child-a", "--link", "depends-on:child-b:x"]);
  engine(["update-epic", "child-b", "--link", "depends-on:child-a:y"]);
  const err = expectFail(() => engine(["plan-hierarchy", "--parent", "sprint"]));
  assert.ok(err, "expected a cycle rejection");
  const msg = String(err.stderr || err.message);
  assert.match(msg, /dependency cycle/);
  assert.match(msg, /child-a/);
  assert.match(msg, /child-b/);
});
unitTest("plan-hierarchy annotates each child's autonomy status", () => {
  const engine = memoryEngine(emptyRecord());
  sprint(engine);
  engine(["set-autonomy", "child-a", "--level", "autonomous"]);
  const out = JSON.parse(engine(["plan-hierarchy", "--parent", "sprint"]));
  const byId = Object.fromEntries(out.batches[0].epics.map(e => [e.id, e.autonomous]));
  assert.equal(byId["child-a"], true);
  assert.equal(byId["child-b"], false);
  assert.equal(byId["child-c"], false);
});
unitTest("plan-hierarchy on a parent with no children returns an empty batches array", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "lonely-parent", "--lane", "claude-code"]);
  const out = JSON.parse(engine(["plan-hierarchy", "--parent", "lonely-parent"]));
  assert.deepEqual(out.batches, []);
});
unitTest("plan-hierarchy rejects an unknown parent id", () => {
  const engine = memoryEngine(emptyRecord());
  assert.ok(expectFail(() => engine(["plan-hierarchy", "--parent", "ghost"])));
});
unitTest("plan-hierarchy requires --parent", () => {
  const engine = memoryEngine(emptyRecord());
  assert.ok(expectFail(() => engine(["plan-hierarchy"])));
});

// ──────── top-level queue: dependency-aware ordering (dependency-aware-standalone-ordering) ────────
unitTest("NEXT UP does not starve a top-level epic's unresolved depends-on dependency, even when the dependent outranks it on priority", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "low-dep", "--lane", "claude-code", "--priority", "P3"]);
  engine(["add-epic", "--id", "high-blocked", "--lane", "claude-code", "--priority", "P0",
       "--link", "depends-on:low-dep:needs low-dep shipped first"]);
  const brief = parseBrief(engine);
  assert.ok(brief.indexOf("`low-dep`") < brief.indexOf("`high-blocked`"),
    "unresolved dependency must be listed ahead of the higher-priority epic waiting on it");
});
unitTest("brief prints a one-line note naming the blocking epic when priority order is overridden by an unresolved depends-on", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "low-dep", "--lane", "claude-code", "--priority", "P3"]);
  engine(["add-epic", "--id", "high-blocked", "--lane", "claude-code", "--priority", "P0",
       "--link", "depends-on:low-dep:needs low-dep shipped first"]);
  assert.match(parseBrief(engine), /`high-blocked` ready but waiting on `low-dep`/);
});
unitTest("top-level dependency ordering applies across unrelated epics, not just siblings under one parent", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "infra", "--lane", "claude-code", "--priority", "P2"]);
  engine(["add-epic", "--id", "feature", "--lane", "claude-code", "--priority", "P0",
       "--link", "depends-on:infra:needs infra"]);
  const brief = parseBrief(engine);
  assert.ok(brief.indexOf("`infra`") < brief.indexOf("`feature`"));
  assert.match(brief, /`feature` ready but waiting on `infra`/);
});
unitTest("a resolved depends-on (dependency archived) does not starve the dependent — no reordering, no note", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "done-dep", "--lane", "claude-code", "--priority", "P3"]);
  engine(["add-epic", "--id", "dependent", "--lane", "claude-code", "--priority", "P0",
       "--link", "depends-on:done-dep:needs done-dep"]);
  engine(["update-epic", "done-dep", "--status", "archived", "--outcome", "delivered", "--no-deferrals"]);
  const brief = parseBrief(engine);
  assert.doesNotMatch(brief, /ready but waiting on/);
  assert.match(brief, /`dependent`/);
});
unitTest("no unresolved depends-on among queued epics leaves plain priority order untouched (no notes)", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code", "--priority", "P0"]);
  engine(["add-epic", "--id", "b", "--lane", "claude-code", "--priority", "P1"]);
  const brief = parseBrief(engine);
  assert.ok(brief.indexOf("`a`") < brief.indexOf("`b`"));
  assert.doesNotMatch(brief, /ready but waiting on/);
});
unitTest("a dependency cycle among top-level queued epics does not crash the brief — falls back gracefully", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code", "--priority", "P1"]);
  engine(["add-epic", "--id", "b", "--lane", "claude-code", "--priority", "P1"]);
  engine(["update-epic", "a", "--link", "depends-on:b:cyclic"]);
  engine(["update-epic", "b", "--link", "depends-on:a:cyclic"]);
  const brief = parseBrief(engine);
  assert.match(brief, /NEXT UP/);
  assert.match(brief, /`a`/);
  assert.match(brief, /`b`/);
});

// ---------- remove-epic ----------
unitTest("remove-epic hard-deletes a childless, unreferenced epic", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code"]);
  engine(["remove-epic", "a"]);
  assert.ok(!readState(engine).epics.some(e => e.id === "a"));
});
unitTest("remove-epic clears the active pointer when the removed epic was active", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code", "--status", "active"]);
  engine(["remove-epic", "a"]);
  assert.equal(readState(engine).active, null);
});
unitTest("remove-epic strips dangling links[] from other epics and warns", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code"]);
  engine(["add-epic", "--id", "b", "--lane", "claude-code", "--link", "depends-on:a"]);
  const out = engine.combined(["remove-epic", "a"]);
  const b = readState(engine).epics.find(e => e.id === "b");
  assert.deepEqual(b.links, []);
  assert.match(out, /stripped 1 dangling reference/);
  assert.match(out, /links\[\]/, "the warning names WHERE the reference was held, not just who held it");
  assert.match(out, /\bb\b/);
});
unitTest("remove-epic blocks removal of an epic with children by default, printing a table", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "parent", "--lane", "claude-code", "--title", "Parent epic"]);
  engine(["add-epic", "--id", "child1", "--lane", "claude-code", "--parent", "parent", "--title", "Child one"]);
  engine(["add-epic", "--id", "child2", "--lane", "claude-code", "--parent", "parent", "--title", "Child two"]);
  const err = expectFail(() => engine(["remove-epic", "parent"]));
  assert.ok(err);
  const out = String(err.stdout || "") + String(err.stderr || "");
  assert.match(out, /child1/);
  assert.match(out, /child2/);
  assert.match(out, /--cascade/);
  const state = readState(engine);
  assert.ok(state.epics.some(e => e.id === "parent"));
  assert.ok(state.epics.some(e => e.id === "child1"));
});
unitTest("remove-epic blocked-removal preview includes grandchildren, not just direct children", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "parent", "--lane", "claude-code"]);
  engine(["add-epic", "--id", "child", "--lane", "claude-code", "--parent", "parent"]);
  engine(["add-epic", "--id", "grandchild", "--lane", "claude-code", "--parent", "child"]);
  const err = expectFail(() => engine(["remove-epic", "parent"]));
  assert.ok(err);
  const out = String(err.stdout || "") + String(err.stderr || "");
  assert.match(out, /grandchild/);
  assert.match(out, /2 descendant\(s\) total/);
});
unitTest("remove-epic --cascade removes a parent and all its descendants", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "parent", "--lane", "claude-code"]);
  engine(["add-epic", "--id", "child1", "--lane", "claude-code", "--parent", "parent"]);
  engine(["add-epic", "--id", "grandchild", "--lane", "claude-code", "--parent", "child1"]);
  engine(["remove-epic", "parent", "--cascade"]);
  assert.equal(readState(engine).epics.length, 0);
});
unitTest("remove-epic rejects an unknown id", () => {
  const engine = memoryEngine(emptyRecord());
  assert.ok(expectFail(() => engine(["remove-epic", "ghost"])));
});
unitTest("remove-epic requires a positional id", () => {
  const engine = memoryEngine(emptyRecord());
  assert.ok(expectFail(() => engine(["remove-epic"])));
});

// ---------- verify-worktrees ----------
unitTest("verify-worktrees returns an empty orphaned list gracefully when the engine isn't a git repo at all", () => {
  // The assertion half's EVERY root is a directory git cannot answer about, so this is the same
  // case the functional file keeps for the same reason — the check must degrade, not throw.
  const engine = memoryEngine(emptyRecord());
  const out = JSON.parse(engine(["verify-worktrees"]));
  assert.deepEqual(out.orphaned, []);
});

// ---------- remove-epic: every dangling reference, not just links[] ----------
unitTest("remove-epic sweeps a release deferral, a carriedTo handoff and a deferral assertion", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "gone", "--lane", "claude-code"]);
  engine(["add-epic", "--id", "holder", "--lane", "claude-code"]);
  engine(["release", "0.27.0", "--intent", "a release"]);
  engine(["release", "0.27.0", "--defer", "gone", "--reason", "cut for time"]);
  engine(["update-epic", "holder", "--status", "archived", "--outcome", "delivered",
    "--carried-to", "gone", "--deferral", "gone:design.md § Risks"]);

  const out = engine.combined(["remove-epic", "gone"]);
  const st = readState(engine);
  const holder = st.epics.find(e => e.id === "holder");
  assert.deepEqual(st.releases[0].deferred, [],
    "a deferral naming a removed epic renders in PROJECT.md as a deferral pointing at nothing");
  assert.equal(holder.disposition.carriedTo, undefined, "a handoff to a removed epic names nothing");
  assert.deepEqual(holder.deferralAssertion.deferrals, [],
    "the assertion survives; the entry naming a removed epic does not");
  assert.match(out, /dangling/, "the sweep says what it dropped, as the links[] sweep already did");
});
unitTest("remove-epic REFUSES while a detour frame names the epic, rather than dropping the frame", () => {
  const epic = (id) => ({ id, title: id, priority: "P1", status: "queued", role: "epic",
    lane: "claude-code", links: [], reconcileNeeded: false, attributedCommits: [] });
  // The file rung's `init` + `writeState(engine, …)`: the SECOND call replaces the record wholesale,
  // and a memory store takes that record as its seed. No `revision` is supplied, exactly as
  // `writeState()` supplied none — `shapeProblem()` does not require one.
  const engine = memoryEngine({ version: 1, active: "the-detour", detourStack: [
    { pausedEpic: "paused-one", reason: "blocked on it", spawnedDetour: "the-detour", reconcileOnResume: true },
  ], epics: [epic("paused-one"), epic("the-detour")] });
  const err = expectFail(() => engine(["remove-epic", "paused-one"]));
  assert.ok(err, "removing an epic held by a live detour frame must not silently succeed");
  const out = String(err.stdout || "") + String(err.stderr || "");
  assert.match(out, /detour/, "the refusal must say WHICH holder blocks it");
  assert.ok(readState(engine).epics.some(e => e.id === "paused-one"), "nothing was removed");
});

// ───────────────────────── the deliberate omissions ─────────────────────────
//
// The three verify-worktrees cases that CREATE a repository and a linked worktree — an archived
// child, an in-flight child with an unmerged commit, and a merged-into-HEAD child — are
// functional-only by construction (design D5): the subject is what a real `git worktree list` holds
// and what `merge-base --is-ancestor` answers. The degradation case above is the half of that
// surface this half can prove, and scripts/test/functional/conductor-06.test.mjs holds the rest.

// ───────────────────────── the deliberate omissions ─────────────────────────
//
// The three verify-worktrees cases that CREATE a repository and a linked worktree — an archived
// child, an in-flight child with an unmerged commit, and a merged-into-HEAD child — are
// functional-only by construction (design D5): the subject is what a real `git worktree list` holds
// and what `merge-base --is-ancestor` answers. The degradation case above is the half of that
// surface this rung can prove, and scripts/test/functional/conductor-06.test.mjs holds the rest.
// The 0.5.0 migration case is on the FILE rung for its own reason — see the header.
