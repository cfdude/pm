// scripts/test/unit/conductor-04.test.mjs
// 4.1's migration of `assert/conductor-04.test.mjs` — 14 of its 26 tests, moved from the file rung
// to the unit rung with every assertion unchanged.
//
// ─────────────── WHAT MOVED, AND WHAT DID NOT ───────────────
//
// Fourteen moved: the 0.4.1-shaped record's render, the hierarchy grouping/indentation/sibling
// ordering, the brief's parent annotation, the defensive-render test for malformed links, four
// external-id/url tests, and every `update-epic` refusal. `projectMd(cwd)` and `parseBrief(cwd)`
// become the store's PROJECT.md text and the `brief` verb's stdout, and the whole-record `writeState`
// calls become `memoryEngine(record)` seeds.
//
// TWELVE STAY, and they are two of the four seam edges rather than twelve judgments:
//   * SIX version-currency tests — `changelog` and `upgrade` — whose fixture is
//     `fixturePluginRoot(version, FIXTURE_CHANGELOG)`, a REAL plugin directory on disk that the
//     engine reads and `init`/`upgrade` back-fill `.gitignore` beside;
//   * SIX tracker tests. Five assert on `claudeMd(cwd)` — CLAUDE.md's managed block, a repository
//     file the store does not own — and all six run `set-tracker`, which WRITES that file as a side
//     effect. That last one is worth naming: "set-tracker writes a tracker block with a
//     multi-entry statusIntent map" asserts on a VALUE, and it still cannot move, because the verb
//     the fixture has to run performs a write the rung forbids.
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

unitTest("0.4.1-shaped state (no parent/externalId/tracker) loads and renders unchanged", () => {
    const engine = memoryEngine({
    version: 1, active: "live", detourStack: [], pmVersion: "0.4.1",
    epics: [
      { id: "live", title: "Live one", priority: "P0", status: "active", role: "epic", lane: "openspec", links: [], reconcileNeeded: false },
      { id: "q", title: "Queued", priority: "P1", status: "queued", role: "epic", lane: "superpowers", stories: [{ title: "a", done: false }], links: [] },
    ],
  });
  engine(["render"]);
  const md = projectMd(engine);
  assert.match(md, /`live`/);
  assert.match(md, /`q`/);
  assert.doesNotMatch(md, /undefined/);
  const brief = parseBrief(engine);
  assert.match(brief, /NOW: `live`/);
  assert.doesNotMatch(brief, /undefined/);
});
unitTest("add-epic --parent sets parent when the parent exists", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "sprint", "--lane", "external", "--priority", "P0"]);
  engine(["add-epic", "--id", "child-1", "--lane", "external", "--parent", "sprint"]);
  assert.equal(readState(engine).epics.find(e => e.id === "child-1").parent, "sprint");
});
unitTest("add-epic --parent rejects a non-existent parent and writes nothing", () => {
  const engine = memoryEngine(emptyRecord());
  const before = readState(engine).epics.length;
  const err = expectFail(() => engine(["add-epic", "--id", "orphan", "--lane", "external", "--parent", "nope"]));
  assert.ok(err, "expected non-zero exit for missing parent");
  assert.match(String(err.stderr || err.message), /parent/i);
  assert.equal(readState(engine).epics.length, before);
});
unitTest("render groups children under their parent with indent, rollup, and sorted siblings", () => {
    const engine = memoryEngine({ version: 1, active: null, detourStack: [], epics: [
    { id: "sprint", title: "Sprint", priority: "P0", status: "queued", role: "epic", lane: "external", links: [] },
    { id: "c-b", title: "cb", priority: "P1", status: "queued", role: "epic", lane: "external", parent: "sprint", links: [] },
    { id: "c-a", title: "ca", priority: "P0", status: "archived", role: "epic", lane: "external", parent: "sprint", links: [] },
  ]});
  engine(["render"]);
  const md = projectMd(engine);
  assert.match(md, /└─ `c-a`/);                       // children indented
  assert.match(md, /└─ `c-b`/);
  assert.match(md, /1\/2 children archived/);          // rollup on the parent row
  assert.ok(md.indexOf("`sprint`") < md.indexOf("`c-a`"), "parent renders before its children");
  assert.ok(md.indexOf("`c-a`") < md.indexOf("`c-b`"), "siblings sorted by priority (P0 before P1)");
});
unitTest("render indents grandchildren one level deeper", () => {
    const engine = memoryEngine({ version: 1, active: null, detourStack: [], epics: [
    { id: "p", title: "p", priority: "P0", status: "queued", role: "epic", lane: "external", links: [] },
    { id: "c", title: "c", priority: "P0", status: "queued", role: "epic", lane: "external", parent: "p", links: [] },
    { id: "gc", title: "gc", priority: "P0", status: "queued", role: "epic", lane: "external", parent: "c", links: [] },
  ]});
  engine(["render"]);
  const md = projectMd(engine);
  assert.match(md, /└─ `c`/);
  assert.match(md, /└─ └─ `gc`/);
});
unitTest("brief keeps a child's priority slot in NEXT UP and annotates its parent", () => {
    const engine = memoryEngine({ version: 1, active: null, detourStack: [], epics: [
    { id: "par", title: "par", priority: "P2", status: "queued", role: "epic", lane: "external", links: [] },
    { id: "kid", title: "kid", priority: "P0", status: "queued", role: "epic", lane: "external", parent: "par", links: [] },
  ]});
  const brief = parseBrief(engine);
  assert.ok(brief.indexOf("`kid`") < brief.indexOf("`par`"), "P0 child outranks its P2 parent in NEXT UP");
  assert.match(brief, /`kid`[^\n]*parent: `par`/);     // child annotated with its parent
});

// ───────────────────────── 0.5.0: defensive render ─────────────────────────
unitTest("malformed links never render as undefined, valid links still show", () => {
    const engine = memoryEngine({ version: 1, active: null, detourStack: [], epics: [
    { id: "a", title: "a", priority: "P1", status: "queued", role: "epic", lane: "external",
      links: [{ reason: "broken — no type/epic" }, { type: "blocks", epic: "b" }] },
    { id: "b", title: "b", priority: "P1", status: "queued", role: "epic", lane: "external", links: [] },
  ]});
  engine(["render"]);
  const md = projectMd(engine);
  assert.doesNotMatch(md, /undefined/);
  assert.match(md, /blocks→b/);                  // valid link still rendered in the table
  const brief = parseBrief(engine);
  assert.doesNotMatch(brief, /undefined/);
  assert.match(brief, /`a` blocks `b`/);         // valid link still rendered in EPIC LINKS
});

// ─────────────────── 0.5.0: external-tracker awareness ───────────────────
unitTest("add-epic stores externalId/externalUrl", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "job-506", "--lane", "external",
       "--external-id", "JOB-506", "--external-url", "https://onvex.example/JOB-506"]);
  const e = readState(engine).epics.find(x => x.id === "job-506");
  assert.equal(e.externalId, "JOB-506");
  assert.equal(e.externalUrl, "https://onvex.example/JOB-506");
});
unitTest("update-epic records external id/url onto an existing epic (write-back)", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "job-507", "--lane", "external"]);
  engine(["update-epic", "job-507", "--external-id", "JOB-507", "--external-url", "https://onvex.example/JOB-507"]);
  const e = readState(engine).epics.find(x => x.id === "job-507");
  assert.equal(e.externalId, "JOB-507");
  assert.equal(e.externalUrl, "https://onvex.example/JOB-507");
});

// ────────────── github-issues tracker: inward pull (issues → untriaged epics) ──────────────
unitTest("add-epic rejects a duplicate --external-id, leaving state unchanged (dedup by externalId)", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "gh-42", "--lane", "claude-code", "--status", "untriaged",
       "--external-id", "42", "--external-url", "https://github.com/cfdude/pm/issues/42"]);
  const before = readState(engine).epics.length;
  const err = expectFail(() => engine(["add-epic", "--id", "gh-42-dup", "--lane", "claude-code",
       "--status", "untriaged", "--external-id", "42",
       "--external-url", "https://github.com/cfdude/pm/issues/42"]));
  // Both keys match here, and the one that COLLIDED is the URL — the primary key. This line used to
  // assert `external-id '42' already`, pinning the mis-named refusal code review 0.43.0 (E1) found.
  assert.match(String(err.stderr || err.message), /external-url 'https:\/\/github\.com\/cfdude\/pm\/issues\/42' is already held by epic 'gh-42'/);
  const after = readState(engine);
  assert.equal(after.epics.length, before);
  assert.ok(!after.epics.some(e => e.id === "gh-42-dup"));
});
unitTest("update-epic's own --external-id write is unaffected by the add-epic dedup guard", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "gh-43", "--lane", "claude-code"]);
  engine(["update-epic", "gh-43", "--external-id", "43", "--external-url", "https://github.com/cfdude/pm/issues/43"]);
  const e = readState(engine).epics.find(x => x.id === "gh-43");
  assert.equal(e.externalId, "43");
});
unitTest("update-epic re-status/re-priority works; self-parent and cycle are rejected", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "external"]);
  engine(["add-epic", "--id", "b", "--lane", "external", "--parent", "a"]); // b under a
  engine(["update-epic", "a", "--status", "active", "--priority", "P0"]);
  const e = readState(engine).epics.find(x => x.id === "a");
  assert.equal(e.status, "active");
  assert.equal(e.priority, "P0");
  assert.ok(expectFail(() => engine(["update-epic", "a", "--parent", "a"])), "self-parent rejected");
  assert.ok(expectFail(() => engine(["update-epic", "a", "--parent", "b"])), "cycle rejected");
  assert.equal(readState(engine).epics.find(x => x.id === "a").parent, undefined);
});
unitTest("update-epic on an unknown id exits non-zero and writes nothing", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "real", "--lane", "external"]);
  const before = engine.store.read("state.json").text;
  const err = expectFail(() => engine(["update-epic", "ghost", "--status", "active"]));
  assert.ok(err, "expected non-zero exit for unknown id");
  assert.equal(engine.store.read("state.json").text, before);
});
unitTest("update-epic --title updates an existing epic's title, mirroring add-epic", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--title", "Old title", "--lane", "claude-code"]);
  engine(["update-epic", "a", "--title", "New, corrected title"]);
  assert.equal(readState(engine).epics.find(e => e.id === "a").title, "New, corrected title");
});
