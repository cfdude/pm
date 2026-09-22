// scripts/test/unit/conductor-01.test.mjs
// 4.1's migration of `assert/conductor-01.test.mjs` — 21 of its 33 tests, moved from the file rung
// to the unit rung with every assertion unchanged.
//
// ─────────────── WHAT MOVED, AND WHAT DID NOT ───────────────
//
// Twenty-one moved: the sorting/rendering tests, the progress precedence that needs no source file,
// the dangling-pointer warnings, NEXT UP's cap and lane rollup, every `add-epic` test including its
// four refusals, `update-epic --link`'s append, `sync` tolerating a missing plans dir, and the
// archived-epic exemption. `projectMd(cwd)` and `parseBrief(cwd)` become the store's PROJECT.md text
// and the `brief` verb's stdout, and `manyEpics(n)` is a pure array builder that crosses unchanged.
//
// TWELVE STAY, and each is one of the four seam edges (`worklist-4.1.md`): the filesystem SUBJECT
// (`render-stamp.json`'s mtime; the tmp-file hygiene check that walks `.conductor/`), a repo file the
// store does not own (CLAUDE.md's managed block, asserted by the `init` scaffolding test), a FIXTURE
// that writes a path (five `sync`/`progress` tests seed `docs/superpowers/plans/*.md` or
// `openspec/changes/*/tasks.md`), and a VERB whose side effect writes a path (`init`/`upgrade` with
// `fixturePluginRoot`, in the pmVersion-stamp and nudge tests).
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
import { emptyRecord, expectFail, manyEpics, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

const readState = (engine) => engine.store.record();

/** The file rung's `writeState(cwd, obj)` for a WHOLE record: replace what the store holds, with no
 *  verb in the chain and therefore no revision guard (`writeRecord()` would refuse a revision no verb
 *  produced). Used where the record is built in steps before being installed. */
function writeState(engine, obj) {
  mutateRecord(engine, (s) => {
    for (const k of Object.keys(s)) delete s[k];
    Object.assign(s, obj);
  });
}

/** The file rung's `writeState(cwd, s)` for a PARTIAL edit: the memory store hands back the record it
 *  holds, so the mutation IS the write. */
function mutateRecord(engine, edit) {
  edit(engine.store.record());
}
const projectMd = (engine) => engine.store.read("PROJECT.md").text;
const parseBrief = (engine) =>
  JSON.parse(engine(["brief"])).hookSpecificOutput.additionalContext;

unitTest("epic without lane reads as openspec (back-compat) and shows a Lane column", () => {
    const engine = memoryEngine({
    version: 1, active: null, detourStack: [],
    epics: [{ id: "legacy", title: "Legacy epic", priority: "P1", status: "queued", role: "epic", links: [], reconcileNeeded: false }],
  });
  engine(["render"]);
  const md = projectMd(engine);
  assert.match(md, /\| Lane \|/);            // Lane column header exists
  assert.match(md, /`legacy`/);
  assert.match(md, /\| openspec \|/);        // legacy epic defaulted to openspec
});
unitTest("epics sort by priority then lane rank deterministically", () => {
    const engine = memoryEngine({
    version: 1, active: null, detourStack: [],
    epics: [
      { id: "b-sp", title: "b", priority: "P1", status: "queued", role: "epic", lane: "superpowers", links: [] },
      { id: "a-os", title: "a", priority: "P1", status: "queued", role: "epic", lane: "openspec", links: [] },
      { id: "c-cc", title: "c", priority: "P0", status: "queued", role: "epic", lane: "claude-code", links: [] },
    ],
  });
  engine(["render"]);
  const md = projectMd(engine);
  // P0 claude-code first, then P1 openspec before P1 superpowers
  const order = ["c-cc", "a-os", "b-sp"].map(id => md.indexOf(`\`${id}\``));
  assert.ok(order[0] < order[1] && order[1] < order[2], `bad order: ${order}`);
});
unitTest("progress precedence: manual stories win", () => {
    const engine = memoryEngine({ version: 1, active: null, detourStack: [], epics: [
    { id: "m", title: "m", priority: "P1", status: "queued", role: "epic", lane: "claude-code",
      stories: [{ title: "a", done: true }, { title: "b", done: false }], links: [] },
  ]});
  engine(["render"]);
  assert.match(projectMd(engine), /1\/2 stories/);
});
unitTest("dangling planPath renders a warning, not a count", () => {
    const engine = memoryEngine({ version: 1, active: null, detourStack: [], epics: [
    { id: "sp", title: "sp", priority: "P1", status: "queued", role: "epic", lane: "superpowers",
      planPath: "docs/superpowers/plans/missing.md", links: [] },
  ]});
  engine(["render"]);
  assert.match(projectMd(engine), /⚠ planPath missing/);
});
unitTest("decision lane with no source renders an em dash", () => {
    const engine = memoryEngine({ version: 1, active: null, detourStack: [], epics: [
    { id: "d", title: "d", priority: "P2", status: "queued", role: "epic", lane: "decision", links: [] },
  ]});
  engine(["render"]);
  assert.match(projectMd(engine), /`d` \| decision \| epic \| queued \| — \|/);
});
unitTest("non-openspec epic appears in NEXT UP", () => {
    const engine = memoryEngine({ version: 1, active: null, detourStack: [], epics: [
    { id: "sp1", title: "sp1", priority: "P1", status: "queued", role: "epic", lane: "superpowers",
      stories: [{ title: "x", done: false }], links: [] },
  ]});
  const brief = parseBrief(engine);
  assert.match(brief, /NEXT UP/);
  assert.match(brief, /`sp1` \(P1, superpowers, queued\)/);
});
unitTest("missing openspec change is marked and excluded from NEXT UP", () => {
    const engine = memoryEngine({ version: 1, active: null, detourStack: [], epics: [
    { id: "ghost", title: "ghost", priority: "P1", status: "queued", role: "epic", lane: "openspec", links: [] },
  ]});
  engine(["render"]);
  assert.match(projectMd(engine), /no change on disk/);
  const brief = parseBrief(engine);
  assert.doesNotMatch(brief, /`ghost`/);
});
unitTest("an archived openspec epic is never flagged as missing its change, even if its change dir is gone", () => {
    const engine = memoryEngine({ version: 1, active: null, detourStack: [], epics: [
    { id: "shipped", title: "shipped", priority: "P1", status: "archived", role: "epic", lane: "openspec", links: [] },
  ]});
  engine(["render"]);
  assert.doesNotMatch(projectMd(engine), /no change on disk/);
});
unitTest("brief caps NEXT UP at 5 and reports the remainder", () => {
    const engine = memoryEngine({ version: 1, active: null, detourStack: [], epics: manyEpics(8) });
  const brief = parseBrief(engine);
  const shown = (brief.match(/^ {2}• /gm) || []).length;
  assert.equal(shown, 5);
  assert.match(brief, /\(\+3 more — see PROJECT\.md\)/);
  assert.match(brief, /lanes: superpowers 8/);
});
unitTest("active epic is shown even when NEXT UP is capped", () => {
  const engine = memoryEngine(emptyRecord());
  const epics = manyEpics(8);
  epics.push({ id: "live", title: "live", priority: "P0", status: "active", role: "epic", lane: "openspec", links: [] });
  writeState(engine, { version: 1, active: "live", detourStack: [], epics });
  const brief = parseBrief(engine);
  assert.match(brief, /NOW: `live`/);
});
unitTest("epic with no autonomy field defaults to level off via render/brief (no crash, no marker)", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code", "--status", "active"]);
  const md = projectMd(engine);
  assert.match(md, /`a`/);
  assert.doesNotMatch(md, /🤖/);              // no autonomy marker for a plain epic
  const brief = parseBrief(engine);
  assert.doesNotMatch(brief, /🤖/);
});
unitTest("add-epic inserts a lane-tagged epic with defaults", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "refactor-auth", "--title", "Refactor auth", "--lane", "superpowers", "--priority", "P1"]);
  const e = readState(engine).epics.find(x => x.id === "refactor-auth");
  assert.equal(e.lane, "superpowers");
  assert.equal(e.priority, "P1");
  assert.equal(e.status, "queued");
  assert.equal(e.role, "epic");
});
unitTest("add-epic rejects a duplicate id", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "dup", "--lane", "claude-code"]);
  const err = expectFail(() => engine(["add-epic", "--id", "dup", "--lane", "claude-code"]));
  assert.ok(err, "expected non-zero exit on duplicate");
});
unitTest("add-epic rejects a bad id and an unknown lane", () => {
  const engine = memoryEngine(emptyRecord());
  assert.ok(expectFail(() => engine(["add-epic", "--id", "Bad ID", "--lane", "claude-code"])));
  assert.ok(expectFail(() => engine(["add-epic", "--id", "ok", "--lane", "nope"])));
});
unitTest("add-epic stores planPath and links", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "y", "--lane", "claude-code"]);   // link target must exist
  engine(["add-epic", "--id", "x", "--lane", "superpowers", "--plan", "docs/superpowers/plans/x.md",
       "--link", "blocks:y:needs token"]);
  const e = readState(engine).epics.find(x => x.id === "x");
  assert.equal(e.planPath, "docs/superpowers/plans/x.md");
  assert.deepEqual(e.links, [{ type: "blocks", epic: "y", reason: "needs token" }]);
});
unitTest("add-epic rejects a --link whose epic id doesn't exist, instead of silently storing garbage", () => {
  const engine = memoryEngine(emptyRecord());
  const before = engine.store.read("state.json").text;
  // the reported real-world typo: "type:related:epic:..." — split(":") yields
  // type="type", epic="related", and "related" is not a real epic id.
  const err = expectFail(() => engine(["add-epic", "--id", "x", "--lane", "claude-code",
    "--link", "type:related:epic:some reason"]));
  assert.ok(err, "expected rejection");
  assert.match(String(err.stderr || err.message), /not a known epic/);
  assert.equal(engine.store.read("state.json").text, before);
  assert.equal(readState(engine).epics.length, 0);   // epic itself was not created either
});
unitTest("add-epic rejects a --link with fewer than two segments", () => {
  const engine = memoryEngine(emptyRecord());
  assert.ok(expectFail(() => engine(["add-epic", "--id", "x", "--lane", "claude-code",
    "--link", "justoneword"])));
});
unitTest("update-epic --link APPENDS, and is validated the same way as add-epic", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "y", "--lane", "claude-code"]);
  engine(["add-epic", "--id", "z", "--lane", "claude-code"]);
  engine(["add-epic", "--id", "x", "--lane", "claude-code", "--link", "blocks:y:old reason"]);
  engine(["update-epic", "x", "--link", "relates-to:z:new reason"]);
  const e = readState(engine).epics.find(x => x.id === "x");
  // ADDED, not substituted. This assertion read `[relates-to:z]` alone while `--link` replaced
  // the array — recording a second relationship silently discarded the first.
  assert.deepEqual(e.links, [
    { type: "blocks", epic: "y", reason: "old reason" },
    { type: "relates-to", epic: "z", reason: "new reason" },
  ]);

  // an invalid --link is rejected and writes nothing, leaving the last-good links array intact.
  const before = engine.store.read("state.json").text;
  const err = expectFail(() => engine(["update-epic", "x", "--link", "type:ghost-epic:bad"]));
  assert.ok(err, "expected rejection");
  assert.equal(engine.store.read("state.json").text, before);
});
unitTest("sync tolerates a missing plans dir", () => {
  const engine = memoryEngine(emptyRecord());            // no docs/ dir at all
  engine(["sync"]);            // must not throw
  assert.ok(Array.isArray(readState(engine).epics));
});
unitTest("an ARCHIVED epic never warns about a missing source — archiving is when it legitimately goes away", () => {
  // Measured on a 108-epic repo: 7 of 8 epics carrying a planPath dangled, and all 7 were
  // archived with their plan correctly moved out of plans/. Warning there is wrong 7 times
  // out of 8, which trains the reader to ignore the once it is right.
    const engine = memoryEngine({ version: 1, active: null, detourStack: [], epics: [
    { id: "sp-done", title: "sp-done", priority: "P1", status: "archived", role: "epic",
      lane: "superpowers", planPath: "docs/superpowers/plans/moved.md", links: [] },
    { id: "os-done", title: "os-done", priority: "P1", status: "archived", role: "epic",
      lane: "openspec", links: [] },
  ]});
  engine(["render"]);
  assert.doesNotMatch(projectMd(engine), /⚠ planPath missing/);
  assert.doesNotMatch(projectMd(engine), /⚠ tasks\.md missing/);
});
unitTest("a non-archived dangling planPath still warns — the exemption is scoped to archived only", () => {
    const engine = memoryEngine({ version: 1, active: null, detourStack: [], epics: [
    { id: "sp-live", title: "sp-live", priority: "P1", status: "active", role: "epic",
      lane: "superpowers", planPath: "docs/superpowers/plans/gone.md", links: [] },
  ]});
  engine(["render"]);
  assert.match(projectMd(engine), /⚠ planPath missing/);
});
