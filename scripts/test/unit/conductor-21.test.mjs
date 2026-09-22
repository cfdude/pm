// scripts/test/unit/conductor-21.test.mjs
// 4.1's migration of `assert/conductor-21.test.mjs` — 20 of its 24 tests, moved from the file rung to
// the unit rung with every assertion unchanged.
//
// gh#95 — stories: atomic creation, and a terminal disposition that lets the ALREADY-EXISTING
// archive gate be cleared honestly.
//
// A separate file rather than an append to conductor-05 (the other story home) purely for
// concurrency: three agents were editing this suite in the same round, and a new file has no
// merge surface at all.
//
// What this file does NOT test, deliberately: a NEW archive refusal. There isn't one. The
// handoff demand in archive-gate.mjs already refuses `--outcome delivered` while
// outstandingWork() > 0, and epicProgress() reads `stories[]` FIRST — so an epic with an
// unticked story is already blocked. Measured on this repository's own record (2026-08-27):
// 3 of 99 archived epics carry incomplete stories and NONE of the three can be re-recorded as
// `delivered` today. The defect is that the refusal's own suggested remedy — put
// `<!-- pm:lifecycle -->` on the task's line — is IMPOSSIBLE on the stories path, because
// inline stories have no task source and epicProgress() hardcoded `excluded: 0` for them.
// The only key was epic-level `--carried-to`, which for deliberately-dropped work names a
// receiver nobody carried anything to: the fabricated record the message itself warns against.
//
// ─────────────── WHAT MOVED, AND WHAT DID NOT ───────────────
//
// TWENTY moved: every story-creation and disposition test, the counts on both rendered surfaces, the
// archive-gate handoff, `--carried-to`, the legacy-record test, and all four gate-guard cases (the
// hook reads its JSON payload off STDIN, which the options bag carries).
//
// FOUR STAY, on three of the four seam edges: two `add-many` tests whose fixture is a BATCH FILE; the
// checkbox-source test, which writes `docs/superpowers/plans/p.md` because reading that file is its
// subject; and the usage/doc test, which reads `commands/epic.md`.
//
//   `tmpRepo()` + `run(["init"], { cwd })`  →  `memoryEngine(emptyRecord())`
//   `writeState(cwd, obj)`                  →  `writeState(engine, obj)` — replace what the store holds
//   `fs.writeFileSync(stateFile(cwd), …)`   →  GONE: the mutation the test already made IS the write
//   `run(args, { cwd, input })`             →  `engine(args, { input })`
//   `runCombined(args, { cwd })`            →  `engine.combined(args)`
//   `readState(cwd)`                        →  `engine.store.record()`

import assert from "node:assert/strict";
import { emptyRecord, expectFail, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

const readState = (engine) => engine.store.record();
const epicOf = (engine, id) => readState(engine).epics.find(e => e.id === id);
const projectMd = (engine) => engine.store.read("PROJECT.md").text;
const parseBrief = (engine) =>
  JSON.parse(engine(["brief"])).hookSpecificOutput.additionalContext;

/** The file rung's `writeState(cwd, obj)` for a WHOLE record: replace what the store holds, with no
 *  verb in the chain and therefore no revision guard (`writeRecord()` would refuse a revision no verb
 *  produced). The gate-guard tests here install a record four times in a loop. */
function writeState(engine, obj) {
  mutateRecord(engine, (s) => {
    for (const k of Object.keys(s)) delete s[k];
    Object.assign(s, obj);
  });
}

function mutateRecord(engine, edit) {
  edit(engine.store.record());
}

/** The gate-guard fixture, unchanged from the file rung: an active epic with one override. */
const guardState = (over) => ({
  version: 1, active: "a", detourStack: [], epics: [{
    id: "a", title: "a", priority: "P1", role: "epic", lane: "claude-code", links: [],
    status: "active", reconcileNeeded: false, ...over,
  }],
});

unitTest("add-epic --add-story is repeatable and lands every story in the SAME write", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code",
    "--add-story", "First", "--add-story", "Second", "--add-story", "Third"]);
  assert.deepEqual(epicOf(engine, "a").stories, [
    { title: "First", done: false },
    { title: "Second", done: false },
    { title: "Third", done: false },
  ]);
});
unitTest("add-epic without --add-story writes NO stories key at all (absent, not empty)", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code"]);
  assert.equal("stories" in epicOf(engine, "a"), false);
});
unitTest("add-epic --add-story with a blank or valueless title is refused and creates no epic", () => {
  const engine = memoryEngine(emptyRecord());
  for (const args of [["--add-story", "   "], ["--add-story"]]) {
    const err = expectFail(() => engine(["add-epic", "--id", "a", "--lane", "claude-code", ...args]));
    assert.ok(err, `expected ${args.join(" ")} to be refused`);
    assert.match(String(err.stderr || err.message), /non-empty title/);
    assert.equal(readState(engine).epics.some(e => e.id === "a"), false, "no epic may be created");
  }
});
unitTest("update-epic --add-story stays repeatable too — two in one call both land", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code"]);
  engine(["update-epic", "a", "--add-story", "One", "--add-story", "Two"]);
  assert.deepEqual(epicOf(engine, "a").stories.map(s => s.title), ["One", "Two"]);
});
unitTest("--story <n> --wont-do \"<reason>\" keeps the row and records the reason durably", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code", "--add-story", "Keep", "--add-story", "Drop"]);
  engine(["update-epic", "a", "--story", "2", "--wont-do", "docs site was retired"]);
  const s = epicOf(engine, "a").stories;
  assert.equal(s.length, 2, "the row survives — deletion is not the release valve");
  assert.equal(s[1].title, "Drop");
  assert.equal(s[1].done, false, "a dropped story is NOT completed");
  assert.equal(s[1].disposition.state, "wont-do");
  assert.equal(s[1].disposition.reason, "docs site was retired");
  assert.match(s[1].disposition.recordedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(s[0], { title: "Keep", done: false }, "the untouched story is untouched");
});
unitTest("--wont-do REQUIRES a reason — blank, whitespace and valueless are all refused, nothing written", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code", "--add-story", "Drop"]);
  const before = engine.store.read("state.json").text;
  for (const args of [["--wont-do", ""], ["--wont-do", "   "], ["--wont-do"]]) {
    const err = expectFail(() => engine(["update-epic", "a", "--story", "1", ...args]));
    assert.ok(err, `expected ${JSON.stringify(args)} to be refused`);
    assert.match(String(err.stderr || err.message), /--wont-do requires a reason/,
      "the refusal must name --wont-do's own rule, not a generic parse error");
    assert.equal(engine.store.read("state.json").text, before);
  }
});
unitTest("re-disposing an already-disposed story is refused — a recorded judgment is not overwritten", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code", "--add-story", "Drop"]);
  engine(["update-epic", "a", "--story", "1", "--wont-do", "first reason"]);
  const before = engine.store.read("state.json").text;
  const err = expectFail(() => engine(["update-epic", "a", "--story", "1", "--wont-do", "second reason"]));
  assert.ok(err);
  assert.match(String(err.stderr || err.message), /already carries a recorded disposition/);
  assert.equal(engine.store.read("state.json").text, before);
  assert.equal(epicOf(engine, "a").stories[0].disposition.reason, "first reason");
});
unitTest("a COMPLETED story cannot be dropped, and a DISPOSED story cannot be ticked done", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code", "--add-story", "Ship", "--add-story", "Drop"]);
  engine(["update-epic", "a", "--story", "1", "--done"]);
  engine(["update-epic", "a", "--story", "2", "--wont-do", "out of scope"]);
  const e1 = expectFail(() => engine(["update-epic", "a", "--story", "1", "--wont-do", "changed my mind"]));
  assert.ok(e1);
  assert.match(String(e1.stderr || e1.message), /already done/);
  const e2 = expectFail(() => engine(["update-epic", "a", "--story", "2", "--done"]));
  assert.ok(e2);
  assert.match(String(e2.stderr || e2.message), /already carries a recorded disposition/);
});
unitTest("--story <n> with neither --done nor --wont-do names BOTH, and --wont-do without --story is refused", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code", "--add-story", "Only"]);
  const e1 = expectFail(() => engine(["update-epic", "a", "--story", "1"]));
  assert.match(String(e1.stderr || e1.message), /--done/);
  assert.match(String(e1.stderr || e1.message), /--wont-do/);
  const e2 = expectFail(() => engine(["update-epic", "a", "--wont-do", "why"]));
  assert.ok(e2);
  assert.match(String(e2.stderr || e2.message), /requires --story/);
});

// ───────────── what the disposition does to the counts, and so to the gate ─────────────
unitTest("a disposed story leaves BOTH sides of the ratio, exactly as a lifecycle-marked task does", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code",
    "--add-story", "Ship", "--add-story", "Drop", "--add-story", "Also drop"]);
  engine(["update-epic", "a", "--story", "1", "--done"]);
  engine(["update-epic", "a", "--story", "2", "--wont-do", "r1"]);
  engine(["update-epic", "a", "--story", "3", "--wont-do", "r2"]);
  // 1/1, not 1/3 and not 3/3: the two dropped rows are neither outstanding nor completed.
  assert.match(projectMd(engine), /1\/1 stories · 2 disposed/);
  assert.match(parseBrief(engine), /1\/1 stories · 2 disposed/);
});
unitTest("an epic whose every story is disposed renders 0/0 · N disposed rather than an em dash", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code", "--add-story", "Drop"]);
  engine(["update-epic", "a", "--story", "1", "--wont-do", "never mind"]);
  assert.match(projectMd(engine), /0\/0 · 1 disposed/);
});
unitTest("the EXISTING archive gate refuses a stories epic with an undisposed story, and the disposition clears it", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code", "--add-story", "Ship", "--add-story", "Drop"]);
  engine(["update-epic", "a", "--story", "1", "--done"]);
  const err = expectFail(() => engine(["update-epic", "a", "--status", "archived",
    "--outcome", "delivered", "--no-deferrals"]));
  assert.ok(err, "the gate already refuses this — no new refusal is added by gh#95");
  engine(["update-epic", "a", "--story", "2", "--wont-do", "descoped"]);
  engine(["update-epic", "a", "--status", "archived", "--outcome", "delivered", "--no-deferrals"]);
  const e = epicOf(engine, "a");
  assert.equal(e.status, "archived");
  assert.equal(e.stories[1].disposition.reason, "descoped",
    "the archived epic still carries WHY the dropped work was dropped — the searchable audit trail");
});
unitTest("the refusal NAMES the outstanding stories, and offers --wont-do instead of the impossible lifecycle marker", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code",
    "--add-story", "Ship", "--add-story", "Cut over staging DNS", "--add-story", "Retire the old worker"]);
  engine(["update-epic", "a", "--story", "1", "--done"]);
  const err = expectFail(() => engine(["update-epic", "a", "--status", "archived",
    "--outcome", "delivered", "--no-deferrals"]));
  const msg = String(err.stderr || err.message);
  // The block IS the reminder: the unfinished work leads, the disposal options come second.
  assert.match(msg, /2\. Cut over staging DNS/);
  assert.match(msg, /3\. Retire the old worker/);
  assert.ok(msg.indexOf("Cut over staging DNS") < msg.indexOf("--wont-do"),
    "the stories must be named BEFORE the way past them");
  assert.doesNotMatch(msg, /pm:lifecycle/,
    "the lifecycle marker cannot be applied to an inline story — offering it is a dead end");
});
unitTest("--carried-to still clears the gate for a stories epic — the epic-level handoff is not replaced", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "recv", "--lane", "claude-code"]);
  engine(["add-epic", "--id", "a", "--lane", "claude-code", "--add-story", "Ship", "--add-story", "Moved"]);
  engine(["update-epic", "a", "--story", "1", "--done"]);
  engine(["update-epic", "a", "--status", "archived", "--outcome", "delivered", "--no-deferrals",
    "--carried-to", "recv", "--reason", "story 2 moved"]);
  assert.equal(epicOf(engine, "a").status, "archived");
});

// ───────────── backward compatibility: no migration, old records still mean what they meant ─────────────
unitTest("a pre-existing {title, done} story is untouched and still counts as outstanding", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code"]);
  const st = readState(engine);
  st.epics.find(e => e.id === "a").stories = [{ title: "legacy", done: false }];
  engine(["render"]);
  assert.match(projectMd(engine), /0\/1 stories/);
  assert.doesNotMatch(projectMd(engine), /disposed/);
  const err = expectFail(() => engine(["update-epic", "a", "--status", "archived",
    "--outcome", "delivered", "--no-deferrals"]));
  assert.ok(err, "a legacy record keeps meaning exactly what it meant — no transform, no migration");
});
unitTest("`--wont-do` is refused on an epic that has no stories at all, rather than inventing one", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code"]);
  const err = expectFail(() => engine(["update-epic", "a", "--story", "1", "--wont-do", "x"]));
  assert.ok(err);
  assert.match(String(err.stderr || err.message), /out of range/);
});
unitTest("gate-guard does NOT block on an ARCHIVED active epic that still carries reconcileNeeded", () => {
  const engine = memoryEngine(emptyRecord());
  writeState(engine, guardState({ status: "archived", reconcileNeeded: true }));
  engine(["gate-guard"], { input: "{}" });   // must not throw
});
unitTest("gate-guard does NOT block on an ARCHIVED active epic that still owes a tracker refresh", () => {
  const engine = memoryEngine(emptyRecord());
  writeState(engine, { ...guardState({ status: "archived", trackerRefreshNeeded: true }), gateGuard: true });
  engine(["gate-guard"], { input: "{}" });   // must not throw
});
unitTest("gate-guard STILL blocks a LIVE active epic that owes a reconcile — the fix must not disarm it", () => {
  const engine = memoryEngine(emptyRecord());
  for (const status of ["active", "paused", "queued", "blocked"]) {
    writeState(engine, guardState({ status, reconcileNeeded: true }));
    const err = expectFail(() => engine(["gate-guard"], { input: "{}" }));
    assert.ok(err, `expected a block for a live epic at status '${status}'`);
    assert.match(String(err.stderr || err.message), /still owes a reconcile/);
  }
});
unitTest("gate-guard STILL blocks a LIVE active epic that owes a tracker refresh", () => {
  const engine = memoryEngine(emptyRecord());
  writeState(engine, { ...guardState({ trackerRefreshNeeded: true }), gateGuard: true });
  const err = expectFail(() => engine(["gate-guard"], { input: "{}" }));
  assert.ok(err);
  assert.match(String(err.stderr || err.message), /owes a tracker refresh/);
});
