// scripts/test/unit/list-verb.test.mjs
// gh-cfdude-pm-204: `list`, the read-only epic listing that replaces "read .conductor/state.json".
// Its filters map to the procedures that needed the set: `--status` (backlog), `--lane` (routing),
// `--linked-to <id>` (a deferral list: every epic carrying a link to this change).

import assert from "node:assert/strict";
import { expectFail, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

const epic = (id, over = {}) => ({
  id, title: `Title of ${id}`, priority: "P2", status: "queued", role: "epic", lane: "claude-code",
  stories: [], links: [], ...over,
});
const seed = () => ({ version: 1, revision: 1, active: null, detourStack: [], epics: [
  epic("a", { status: "queued", lane: "claude-code" }),
  epic("b", { status: "later", lane: "superpowers", links: [{ type: "relates-to", epic: "a", reason: "r" }] }),
  epic("c", { status: "queued", lane: "superpowers", links: [{ type: "relates-to", epic: "a", reason: "r" }] }),
  epic("d", { status: "archived", lane: undefined }),
] });
const ids = (engine, args) => JSON.parse(engine(["list", "--json", ...args])).epics.map(e => e.id);

unitTest("list: no filter returns every epic, in record order", () => {
  assert.deepEqual(ids(memoryEngine(seed()), []), ["a", "b", "c", "d"]);
});

unitTest("list: --status, --lane and --linked-to narrow, and compose", () => {
  const engine = memoryEngine(seed());
  assert.deepEqual(ids(engine, ["--status", "queued"]), ["a", "c"]);
  assert.deepEqual(ids(engine, ["--lane", "superpowers"]), ["b", "c"]);
  assert.deepEqual(ids(engine, ["--linked-to", "a"]), ["b", "c"]);
  assert.deepEqual(ids(engine, ["--linked-to", "a", "--status", "queued"]), ["c"]);
});

unitTest("list: an epic with no lane is reported in openspec, as every other reader treats it", () => {
  const engine = memoryEngine(seed());
  assert.deepEqual(ids(engine, ["--lane", "openspec"]), ["d"]);
});

unitTest("list: --json rows carry id, title, status, lane, priority, links, release, createdAt, description and outcome", () => {
  const out = JSON.parse(memoryEngine(seed())(["list", "--json", "--linked-to", "a", "--status", "later"]));
  assert.equal(out.count, 1);
  assert.deepEqual(out.epics[0], {
    id: "b", title: "Title of b", status: "later", lane: "superpowers", priority: "P2",
    links: [{ type: "relates-to", epic: "a" }],
    release: null, createdAt: null, description: null, outcome: null,
  });
});

unitTest("list: a registered epic reports release, createdAt, description and its recorded outcome", () => {
  const st = seed();
  st.epics.push(epic("e", { release: "0.54.0", createdAt: "2026-09-08T17:55:42-07:00", description: "what it is for",
    status: "archived", disposition: { outcome: "delivered", reason: "r", recordedAt: "2026-10-01T00:00:00Z", recordedBy: "agent" } }));
  const out = JSON.parse(memoryEngine(st)(["list", "--json", "--status", "archived"]));
  const row = out.epics.find(r => r.id === "e");
  assert.equal(row.release, "0.54.0");
  assert.equal(row.createdAt, "2026-09-08T17:55:42-07:00");
  assert.equal(row.description, "what it is for");
  assert.equal(row.outcome, "delivered");
  assert.deepEqual(Object.keys(out).sort(), ["count", "epics"]);
});

unitTest("list: absent or non-string values report null, and an empty description stays an empty string", () => {
  const st = seed();
  st.epics.push(epic("n", { createdAt: 12345, release: 7, description: "", disposition: { outcome: 3 } }));
  const row = JSON.parse(memoryEngine(st)(["list", "--json"])).epics.find(r => r.id === "n");
  assert.equal(row.createdAt, null);
  assert.equal(row.release, null);
  assert.equal(row.description, "");
  // A disposition whose outcome is not in the vocabulary reads as the engine's own "unknown" (outcomeOf);
  // an epic with NO disposition reports null.
  assert.equal(row.outcome, "unknown");
  assert.equal(JSON.parse(memoryEngine(seed())(["list", "--json"])).epics[0].outcome, null);
});

unitTest("list: the new fields add no filter flag -- --release and --priority stay refused", () => {
  const engine = memoryEngine(seed());
  assert.match(expectFail(() => engine(["list", "--release", "0.54.0"])).stderr, /unknown flag --release for list/);
  assert.match(expectFail(() => engine(["list", "--priority", "P1"])).stderr, /unknown flag --priority for list/);
});

unitTest("list: the text form is one line per epic, and says so when none match", () => {
  const engine = memoryEngine(seed());
  const lines = engine(["list", "--status", "queued"]).trimEnd().split("\n");
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^a\s+queued\s+claude-code\s+P2\s+Title of a$/);  // none of the four new fields
  assert.equal(engine(["list", "--linked-to", "nobody"]), "No epics match.\n");
});

unitTest("list: an unknown --status or --lane value is refused, naming the vocabulary", () => {
  const engine = memoryEngine(seed());
  assert.match(expectFail(() => engine(["list", "--status", "nope"])).stderr, /--status must be one of untriaged\|queued/);
  assert.match(expectFail(() => engine(["list", "--lane", "nope"])).stderr, /--lane must be one of openspec\|/);
});

unitTest("list: a valueless filter is refused and an undeclared flag is refused", () => {
  const engine = memoryEngine(seed());
  assert.match(expectFail(() => engine(["list", "--linked-to"])).stderr, /--linked-to requires an epic id/);
  assert.match(expectFail(() => engine(["list", "--bogus"])).stderr, /unknown flag --bogus for list/);
});

unitTest("list: it is READ-ONLY -- the record's bytes do not move", () => {
  const engine = memoryEngine(seed());
  const before = engine.store.read("state.json").text;
  engine(["list"]); engine(["list", "--json", "--status", "queued"]);
  assert.equal(engine.store.read("state.json").text, before);
});
