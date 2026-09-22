// scripts/test/unit/conductor-03.test.mjs
// 4.1's migration of `assert/conductor-03.test.mjs` — 16 of its 21 tests, moved from the file rung
// to the unit rung with every assertion unchanged.
//
// 5.3's ASSERTION TWIN of scripts/test/functional/conductor-03.test.mjs — same id, same subject.
//
// THE FUNCTIONAL FILE'S SUBJECT is the active-pointer/autonomy/recompute family of verbs, and almost
// none of it is git's behaviour: set-active and clear-active move a pointer, set-autonomy records
// grants, and render/brief recompute the truth from state.json. It is in the functional half only
// because two of its tests land a real commit for commit-nudge's VERIFIED path — and that one test
// is the only thing no assertion-half rung can reach (design D5's placement rule).
//
// ─────────────── WHAT MOVED, AND WHAT DID NOT ───────────────
//
// SIXTEEN moved: every pointer move, all five `set-autonomy` tests, the two 🤖 rendering tests, and
// the whole recompute-don't-remember family (three render tests and the brief's read-only twin).
//
// FIVE STAY, and they are ONE seam edge rather than five judgments: every one of them needs
// `withArchivedChange(cwd, id)` — or, once, a hand-written `mkdirSync` of
// `openspec/changes/archive/2026-07-08-done` — because "is this epic archived" is answered by reading
// whether that DIRECTORY exists. The fixture writes a path for the engine to read, which is what the
// unit rung forbids.
//
// The mechanism that changed:
//
//   `tmpRepo()` + `run(["init"], { cwd })`  →  `memoryEngine(emptyRecord())`
//   `writeState(cwd, wholeRecord)`          →  a `memoryEngine(wholeRecord)` seed
//   `run(args, { cwd })`                    →  `engine(args)`
//   `readState(cwd)`                        →  `engine.store.record()`
//   `fs.readFileSync(…/state.json)`         →  `engine.store.read("state.json").text`
//   `projectMd(cwd)` / `parseBrief(cwd)`    →  `store.read("PROJECT.md").text` / the `brief` verb's stdout

import assert from "node:assert/strict";
import { emptyRecord, expectFail, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

const readState = (engine) => engine.store.record();
const projectMd = (engine) => engine.store.read("PROJECT.md").text;
const parseBrief = (engine) =>
  JSON.parse(engine(["brief"])).hookSpecificOutput.additionalContext;

unitTest("set-active sets the .active pointer and the epic's status, demoting a prior active", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code"]);
  engine(["add-epic", "--id", "b", "--lane", "claude-code"]);
  engine(["set-active", "a"]);
  let s = readState(engine);
  assert.equal(s.active, "a");
  assert.equal(s.epics.find(e => e.id === "a").status, "active");
  engine(["set-active", "b"]);
  s = readState(engine);
  assert.equal(s.active, "b");
  assert.equal(s.epics.find(e => e.id === "b").status, "active");
  assert.equal(s.epics.find(e => e.id === "a").status, "queued");   // prior active demoted
});
unitTest("clear-active nulls the pointer and demotes the active epic", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code"]);
  engine(["set-active", "a"]);
  engine(["clear-active"]);
  const s = readState(engine);
  assert.equal(s.active, null);
  assert.equal(s.epics.find(e => e.id === "a").status, "queued");
});
unitTest("update-epic --status active also sets the .active pointer (no desync)", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code"]);
  engine(["update-epic", "a", "--status", "active"]);
  const s = readState(engine);
  assert.equal(s.active, "a");                                       // the reported footgun, fixed
  assert.equal(s.epics.find(e => e.id === "a").status, "active");
  assert.match(parseBrief(engine), /NOW: `a`/);
});
unitTest("update-epic moving the active epic off active clears the pointer", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code"]);
  engine(["set-active", "a"]);
  engine(["update-epic", "a", "--status", "queued"]);
  const s = readState(engine);
  assert.equal(s.active, null);
  assert.equal(s.epics.find(e => e.id === "a").status, "queued");
});
unitTest("add-epic --status active sets the .active pointer too", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code", "--status", "active"]);
  assert.equal(readState(engine).active, "a");
});

// ──────────────── epic-level autonomy: set-autonomy ────────────────
unitTest("set-autonomy sets level and rejects an unknown level", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code"]);
  engine(["set-autonomy", "a", "--level", "autonomous"]);
  assert.equal(readState(engine).epics.find(e => e.id === "a").autonomy.level, "autonomous");
  assert.ok(expectFail(() => engine(["set-autonomy", "a", "--level", "bogus"])), "bad level rejected");
});
unitTest("set-autonomy records preauthorize/context/notify entries, repeatable and merged across calls", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code"]);
  engine(["set-autonomy", "a",
    "--preauthorize", "drop-scratch-table:reviewed, safe to drop",
    "--preauthorize", "rename-field:no external readers",
    "--context", "staging DB only, no prod access",
  ]);
  let a = readState(engine).epics.find(e => e.id === "a").autonomy;
  assert.equal(a.preAuthorized.length, 2);
  assert.deepEqual(
    { action: a.preAuthorized[0].action, reason: a.preAuthorized[0].reason },
    { action: "drop-scratch-table", reason: "reviewed, safe to drop" },
  );
  assert.ok(a.preAuthorized[0].grantedAt);            // timestamp present
  assert.deepEqual(a.context, ["staging DB only, no prod access"]);

  // a second call APPENDS, does not clobber
  engine(["set-autonomy", "a", "--notify", "ran a schema migration"]);
  a = readState(engine).epics.find(e => e.id === "a").autonomy;
  assert.equal(a.preAuthorized.length, 2);            // unchanged by the second call
  assert.equal(a.notifications.length, 1);
  assert.equal(a.notifications[0].what, "ran a schema migration");
  assert.ok(a.notifications[0].when);
});
unitTest("set-autonomy supports a category-based --preauthorize shorthand distinct from exact-action grants", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code"]);
  engine(["set-autonomy", "a",
    "--preauthorize", "category:filesystem:routine scratch-file cleanup",
    "--preauthorize", "delete-legacy-config:reviewed, one-off",
    "--preauthorize", "category:network:internal health checks only",
  ]);
  const a = readState(engine).epics.find(e => e.id === "a").autonomy;
  assert.equal(a.preAuthorized.length, 3);

  const catEntry = a.preAuthorized.find(e => e.category === "filesystem");
  assert.ok(catEntry, "filesystem category entry recorded");
  assert.equal(catEntry.action, undefined);           // category entries carry no `action`
  assert.equal(catEntry.reason, "routine scratch-file cleanup");
  assert.ok(catEntry.grantedAt);

  const actionEntry = a.preAuthorized.find(e => e.action === "delete-legacy-config");
  assert.ok(actionEntry, "exact-action entry still recorded unchanged");
  assert.equal(actionEntry.category, undefined);      // exact-action entries carry no `category`
  assert.equal(actionEntry.reason, "reviewed, one-off");

  const netEntry = a.preAuthorized.find(e => e.category === "network");
  assert.ok(netEntry);
  assert.equal(netEntry.reason, "internal health checks only");
});
unitTest("set-autonomy rejects an unknown --preauthorize category", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code"]);
  assert.ok(expectFail(() => engine(["set-autonomy", "a",
    "--preauthorize", "category:bogus-category:whatever",
  ])), "unknown category rejected");
});
unitTest("set-autonomy on an unknown id exits non-zero and writes nothing", () => {
  const engine = memoryEngine(emptyRecord());
  const before = engine.store.read("state.json").text;
  assert.ok(expectFail(() => engine(["set-autonomy", "ghost", "--level", "autonomous"])));
  assert.equal(engine.store.read("state.json").text, before);
});
unitTest("render marks an autonomous epic with 🤖 in its Status cell; a plain epic gets no marker", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "auto", "--lane", "claude-code"]);
  engine(["add-epic", "--id", "plain", "--lane", "claude-code"]);
  engine(["set-autonomy", "auto", "--level", "autonomous"]);
  engine(["render"]);
  const md = projectMd(engine);
  const autoLine = md.split("\n").find(l => l.includes("`auto`"));
  const plainLine = md.split("\n").find(l => l.includes("`plain`"));
  assert.match(autoLine, /🤖/);
  assert.doesNotMatch(plainLine, /🤖/);
});
unitTest("brief NOW line shows 🤖 autonomous only when the active epic is autonomous", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code", "--status", "active"]);
  assert.doesNotMatch(parseBrief(engine), /🤖/);
  engine(["set-autonomy", "a", "--level", "autonomous"]);
  assert.match(parseBrief(engine), /NOW: `a`.*🤖 autonomous/);
});
unitTest("render clears a dangling active pointer that references a completely missing epic (not just an archived one)", () => {
    const engine = memoryEngine({ version: 1, active: "ghost-id", detourStack: [], epics: [
    { id: "real", title: "real", priority: "P1", status: "queued", role: "epic", lane: "claude-code", links: [] },
  ]});
  engine(["render"]);
  assert.equal(readState(engine).active, null);
});
unitTest("render recomputes reconcileNeeded from the detour stack rather than trusting a stored flag", () => {
    const engine = memoryEngine({
    version: 1, active: "paused-a", detourStack: [
      { pausedEpic: "paused-a", pausedAt: "2026-07-14T00:00:00Z", reason: "x", spawnedDetour: "d1", reconcileOnResume: true },
    ],
    epics: [
      // stale true with no matching frame → should be healed to false
      { id: "stale-true", title: "stale-true", priority: "P1", status: "queued", role: "epic", lane: "claude-code", links: [], reconcileNeeded: true },
      // missing/false but IS the pausedEpic of a reconcileOnResume frame → should be healed to true
      { id: "paused-a", title: "paused-a", priority: "P1", status: "paused", role: "epic", lane: "claude-code", links: [], reconcileNeeded: false },
    ],
  });
  engine(["render"]);
  const s = readState(engine);
  assert.equal(s.epics.find(e => e.id === "stale-true").reconcileNeeded, false);
  assert.equal(s.epics.find(e => e.id === "paused-a").reconcileNeeded, true);
});
unitTest("render NEVER clears reconcileNeeded on the currently active epic, even with no live detour frame (the legitimate just-popped, pre-reconcile window)", () => {
    const engine = memoryEngine({
    version: 1, active: "just-resumed", detourStack: [],
    epics: [
      { id: "just-resumed", title: "just-resumed", priority: "P1", status: "active", role: "epic", lane: "claude-code",
        links: [{ type: "may-invalidate", epic: "the-detour", reason: "r", reconcileOnResume: true }], reconcileNeeded: true },
      { id: "the-detour", title: "the-detour", priority: "P1", status: "archived", role: "detour", lane: "claude-code", links: [] },
    ],
  });
  engine(["render"]);
  assert.equal(readState(engine).epics.find(e => e.id === "just-resumed").reconcileNeeded, true);
});
unitTest("brief displays the recomputed truth but stays read-only, even for the new active/reconcile checks", () => {
    const engine = memoryEngine({ version: 1, active: "ghost-id", detourStack: [], epics: [
    { id: "real", title: "real", priority: "P1", status: "queued", role: "epic", lane: "claude-code", links: [] },
  ]});
  const brief = parseBrief(engine);
  assert.match(brief, /NOW: \(no active epic set\)/);
  assert.equal(readState(engine).active, "ghost-id");   // brief did NOT mutate state (read path)
});

// ───────────────────────── the one deliberate omission ─────────────────────────
//
// The functional file's "commit-nudge self-heals on the VERIFIED path too (real git repo, commit
// landed)" is NOT ported: verifying a landed commit needs a real repository and a real HEAD move,
// which is precisely what the assertion half's world does not have (design D5). It is covered
// where it belongs — scripts/test/functional/conductor-03.test.mjs — and the unverifiable rung
// above is the half of that pair this half CAN prove.
