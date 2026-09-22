// scripts/test/unit/conductor-02.test.mjs
// 4.1's migration of `assert/conductor-02.test.mjs` — 13 of its 28 tests, moved from the file rung
// to the unit rung with every assertion unchanged.
//
// ─────────────── WHAT MOVED, AND WHY THE MAJORITY DID NOT ───────────────
//
// The thirteen that moved observe a verb's ANSWER or the RENDERED record: the rules block's text,
// PROJECT.md's text and its no-op behaviour, the brief's NEXT UP membership and lane rollup, and
// add-epic's refusals. `projectMd(cwd)` becomes `engine.store.read("PROJECT.md").text`, which is the
// point — PROJECT.md is store-owned, so "a second render changes not one byte" is still asserted,
// now without a tmpdir.
//
// FIFTEEN STAY, and they are three populations rather than fifteen judgments:
//
//   * TWELVE version-currency tests — `upgrade` and the nudge. Their fixtures are
//     `fixturePluginRoot(version)` and `fixtureCache(versions)`, REAL directories built on disk for
//     the engine to read, and `init`/`upgrade` also back-fill `.gitignore` beside them. Building a
//     fixture with `mkdtempSync` FROM THE TEST'S OWN FRAME is exactly what the unit rung's run-time
//     counter refuses.
//   * TWO `sync` tests, whose fixture is an `openspec/changes/<id>/` directory the sync scanner must
//     find on disk.
//   * ONE test — the 30-epic ACCEPTANCE — whose last assertion is `fs.existsSync(cwd/openspec) ===
//     false`: a claim about a directory's ABSENCE, which is a filesystem fact rather than a value.
//
// The mechanism that changed in the moved tests:
//
//   `tmpRepo()` + `run(["init"], { cwd })`  →  `memoryEngine(emptyRecord())`
//   `writeState(cwd, wholeRecord)`          →  a `memoryEngine(wholeRecord)` seed
//   `const s = readState(cwd); …; writeState(cwd, s)`  →  `mutateRecord(engine, s => …)`
//   `run(args, { cwd })`                    →  `engine(args)`
//   `readState(cwd)`                        →  `engine.store.record()`
//   `projectMd(cwd)` / `parseBrief(cwd)`    →  `store.read("PROJECT.md").text` / the `brief` verb's stdout

import assert from "node:assert/strict";
import { emptyRecord, expectFail, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

const readState = (engine) => engine.store.record();
const projectMd = (engine) => engine.store.read("PROJECT.md").text;
const parseBrief = (engine) =>
  JSON.parse(engine(["brief"])).hookSpecificOutput.additionalContext;

/** The file rung's `writeState(cwd, s)` for a PARTIAL edit: the memory store hands back the record it
 *  holds, so the mutation IS the write. `writeRecord()` is not the equivalent — its revision guard
 *  would refuse a revision no verb produced. */
function mutateRecord(engine, edit) {
  edit(engine.store.record());
}

unitTest("rules block is lane-agnostic, not openspec-only", () => {
  const engine = memoryEngine(emptyRecord());
  const out = engine(["rules"]);
  assert.match(out, /lane-agnostic/i);
  assert.match(out, /openspec \| superpowers \| claude-code/);
  assert.doesNotMatch(out, /becomes its own OpenSpec proposal/);
});
unitTest("rules block always includes the epic-level autonomy section, with the five-criteria decision rule", () => {
  const engine = memoryEngine(emptyRecord());
  const out = engine(["rules"]);
  assert.match(out, /## Epic-level autonomy/);
  assert.match(out, /set-autonomy/);
  assert.match(out, /No backup\/restore path exists\? → STOP/);
  assert.match(out, /Destructive but restorable.*→ WARN/);
  assert.match(out, /irreversible EXTERNAL side/i);   // scope boundary called out explicitly
});
unitTest("render is a no-op when content is unchanged (no timestamp churn)", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["render"]);
  const first = projectMd(engine);
  engine(["render"]);
  const second = projectMd(engine);
  assert.equal(first, second); // byte-identical, including the Last rendered line
});
unitTest("render rewrites with a fresh stamp when content changes", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["render"]);
  const before = projectMd(engine);
  mutateRecord(engine, s => {
    s.epics.push({ id: "x", title: "x", priority: "P1", status: "queued", role: "epic", lane: "claude-code", links: [] });
  });
  engine(["render"]);
  const after = projectMd(engine);
  assert.notEqual(before, after);
  assert.match(after, /`x`/);
});
unitTest("add-epic accepts --status planned", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "road-1", "--title", "Road 1", "--lane", "openspec", "--status", "planned"]);
  assert.equal(readState(engine).epics.find(e => e.id === "road-1").status, "planned");
});
unitTest("add-epic and update-epic accept --status later and --status blocked (documented in README, previously rejected)", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "deferred", "--lane", "claude-code", "--status", "later"]);
  assert.equal(readState(engine).epics.find(e => e.id === "deferred").status, "later");
  engine(["add-epic", "--id", "stuck", "--lane", "claude-code", "--status", "blocked"]);
  assert.equal(readState(engine).epics.find(e => e.id === "stuck").status, "blocked");
  engine(["update-epic", "deferred", "--status", "blocked"]);
  assert.equal(readState(engine).epics.find(e => e.id === "deferred").status, "blocked");
});
unitTest("later/blocked epics are excluded from NEXT UP but still appear in the lanes rollup (unlike planned, which is excluded from both)", () => {
  const engine = memoryEngine({ version: 1, active: null, detourStack: [], epics: [
    { id: "ready", title: "ready", priority: "P1", status: "queued", role: "epic", lane: "claude-code", links: [] },
    { id: "deferred", title: "deferred", priority: "P0", status: "later", role: "epic", lane: "claude-code", links: [] },
    { id: "stuck", title: "stuck", priority: "P0", status: "blocked", role: "epic", lane: "claude-code", links: [] },
  ]});
  const brief = parseBrief(engine);
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
unitTest("add-epic rejects an unknown --status", () => {
  const engine = memoryEngine(emptyRecord());
  assert.ok(expectFail(() => engine(["add-epic", "--id", "x", "--lane", "openspec", "--status", "bogus"])));
});
unitTest("add-epic rejects a valueless --id and writes nothing", () => {
  const engine = memoryEngine(emptyRecord());
  assert.ok(expectFail(() => engine(["add-epic", "--lane", "openspec", "--id"])));
  assert.equal(readState(engine).epics.length, 0);
});

// gh-149 CHANGED THIS. It used to assert that add-epic TOLERATED a valueless `--link` — created
// the epic, links silently `[]` — while `update-epic --link` with no value was refused and told
// you `--clear-links` is the flag that empties. Same flag, same registry row, two behaviours;
// that asymmetry is what #149 decided, strictly, on every surface. What the old test was really
// protecting — that the parse does not CRASH — is asserted here as a clean refusal, which is a
// stronger claim than "did not throw".
unitTest("add-epic refuses a valueless --link, with update-epic's wording, and creates no epic", () => {
  const engine = memoryEngine(emptyRecord());
  const err = expectFail(() => engine(["add-epic", "--id", "y", "--lane", "claude-code", "--link"]));
  assert.ok(err, "a valueless --link used to create the epic with links silently []");
  assert.doesNotMatch(String(err.stderr || err.message), /TypeError/, "refused, not crashed");
  assert.match(String(err.stderr || err.message), /--clear-links/);
  assert.equal(readState(engine).epics.length, 0);
});
unitTest("planned openspec epic: not missing, not in NEXT UP, counted, in table", () => {
  const engine = memoryEngine({ version: 1, active: null, detourStack: [], epics: [
    { id: "4c", title: "4c", priority: "P0", status: "planned", role: "epic", lane: "openspec", links: [] },
  ]});
  engine(["render"]);
  const md = projectMd(engine);
  assert.doesNotMatch(md, /no change on disk/);            // not flagged missing
  assert.match(md, /`4c` \| openspec \| epic \| planned/); // shown in Epics table
  const brief = parseBrief(engine);
  assert.doesNotMatch(brief, /NEXT UP/);                   // not actionable
  assert.match(brief, /planned: 1 — see PROJECT\.md/);
});
unitTest("planned epics do not inflate the brief lanes: rollup", () => {
  const engine = memoryEngine({ version: 1, active: null, detourStack: [], epics: [
    { id: "q1", title: "q1", priority: "P1", status: "queued", role: "epic", lane: "superpowers", stories: [{ title: "a", done: false }], links: [] },
    { id: "p1", title: "p1", priority: "P0", status: "planned", role: "epic", lane: "openspec", links: [] },
  ]});
  const brief = parseBrief(engine);
  assert.match(brief, /lanes: superpowers 1/);
  assert.doesNotMatch(brief, /openspec 1/);  // planned openspec excluded from lanes rollup
  assert.match(brief, /planned: 1/);
});
unitTest("rules block mentions planned status and the roadmap on-ramp", () => {
  const engine = memoryEngine(emptyRecord());
  const out = engine(["rules"]);
  assert.match(out, /planned/);
  assert.match(out, /roadmap/i);
});
