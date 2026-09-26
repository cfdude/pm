// scripts/test/unit/add-many-input.test.mjs
// add-many-drops-input-silently (code review 0.43.0 B1/B2). A bulk write persists what it accepts
// or refuses it BY NAME — never exit 0 with part of the input gone. Re-verified at 0.49.0 before
// this file existed: `links: ["depends-on:base"]` and `links: "depends-on:base"` vanished, a link to
// the non-existent `ghost` was stored dangling, `{type:"blocks"}` with no target was stored, and a
// top-level `"epic": [...]` (for `epics`) created only the parent — every one exit 0.
//
// Unit rung: the batch arrives on stdin (`--from -`), so every observable is a refusal or a value
// the record holds.

import assert from "node:assert/strict";
import { emptyRecord, expectFail, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

const addMany = (engine, doc) =>
  engine(["add-many", "--from", "-"], { input: typeof doc === "string" ? doc : JSON.stringify(doc) });
const ids = (engine) => engine.store.record().epics.map(e => e.id).sort();
const epic = (engine, id) => engine.store.record().epics.find(e => e.id === id);
const refusal = (fn) => {
  const err = expectFail(fn);
  assert.ok(err, "expected a refusal, but the batch was ACCEPTED");
  return String(err.stderr || err.message);
};
const withBase = () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "base", "--lane", "claude-code"]);
  return engine;
};

// ─────────────── the document's own shape ───────────────
unitTest("an unknown top-level key is refused by name, and nothing is created (`epic` for `epics`)", () => {
  const engine = memoryEngine(emptyRecord());
  const msg = refusal(() => addMany(engine, { parent: { id: "p", lane: "claude-code" },
    epic: [{ id: "c", lane: "claude-code" }] }));
  assert.match(msg, /unsupported top-level key\(s\) epic/);
  assert.match(msg, /supported: parent, epics/);
  assert.deepEqual(ids(engine), [], "the parent was not created on its own");
});

unitTest("a batch that is not a JSON object is refused by name", () => {
  const engine = memoryEngine(emptyRecord());
  for (const doc of ["[]", "null", "\"x\"", "7"]) {
    assert.match(refusal(() => addMany(engine, doc)), /must be a JSON object/, `for ${doc}`);
  }
  assert.deepEqual(ids(engine), []);
});

unitTest("`epics` that is not an array, and `parent` that is not an object, are refused by name", () => {
  const engine = memoryEngine(emptyRecord());
  assert.match(refusal(() => addMany(engine, { epics: { id: "c", lane: "claude-code" } })), /`epics` must be an array/);
  assert.match(refusal(() => addMany(engine, { parent: "p", epics: [] })), /`parent` must be an object/);
  assert.deepEqual(ids(engine), []);
});

// ─────────────── links — the same validation `--link` gets ───────────────
unitTest("a string link in the --link grammar is PERSISTED, reason included", () => {
  const engine = withBase();
  addMany(engine, { epics: [
    { id: "a", lane: "claude-code", links: ["depends-on:base"] },
    { id: "b", lane: "claude-code", links: ["relates-to:base:shares a parser: and a colon"] },
  ] });
  assert.deepEqual(epic(engine, "a").links, [{ type: "depends-on", epic: "base" }]);
  assert.deepEqual(epic(engine, "b").links, [{ type: "relates-to", epic: "base", reason: "shares a parser: and a colon" }]);
});

unitTest("links that is not an array — a bare string, null, an object — is refused by name", () => {
  const engine = withBase();
  for (const links of ["depends-on:base", null, { type: "depends-on", epic: "base" }]) {
    assert.match(refusal(() => addMany(engine, { epics: [{ id: "a", lane: "claude-code", links }] })),
      /epic 'a': links must be an array/, `for ${JSON.stringify(links)}`);
  }
  assert.deepEqual(ids(engine), ["base"]);
});

unitTest("a link to an epic that exists nowhere is refused, not stored dangling", () => {
  const engine = withBase();
  for (const l of [{ type: "depends-on", epic: "ghost" }, "depends-on:ghost"]) {
    assert.match(refusal(() => addMany(engine, { epics: [{ id: "a", lane: "claude-code", links: [l] }] })),
      /epic 'a': .*'ghost' is not a known epic id/);
  }
  assert.deepEqual(ids(engine), ["base"]);
});

unitTest("a link with no target, or no type, is refused naming what is missing", () => {
  const engine = withBase();
  assert.match(refusal(() => addMany(engine, { epics: [{ id: "a", lane: "claude-code", links: [{ type: "blocks" }] }] })),
    /epic 'a': .*needs a string `epic`/);
  assert.match(refusal(() => addMany(engine, { epics: [{ id: "a", lane: "claude-code", links: [{ epic: "base" }] }] })),
    /epic 'a': .*needs a string `type`/);
  assert.match(refusal(() => addMany(engine, { epics: [{ id: "a", lane: "claude-code", links: ["blocks"] }] })),
    /epic 'a': .*expected "<type>:<epic>\[:<reason>\]"/);
  assert.deepEqual(ids(engine), ["base"]);
});

unitTest("a link element that is neither a string nor an object, or carries a key a link does not have, is refused", () => {
  const engine = withBase();
  assert.match(refusal(() => addMany(engine, { epics: [{ id: "a", lane: "claude-code", links: [42] }] })),
    /epic 'a': .*must be a "<type>:<epic>\[:<reason>\]" string or a \{type, epic, reason\} object/);
  // mergeLinks spreads the supplied object, so an unchecked key would carry a hand-written verdict
  // onto the edge.
  assert.match(refusal(() => addMany(engine, { epics: [{ id: "a", lane: "claude-code",
    links: [{ type: "may-invalidate", epic: "base", verdict: "valid" }] }] })), /unsupported link key\(s\) verdict/);
  assert.match(refusal(() => addMany(engine, { epics: [{ id: "a", lane: "claude-code",
    links: [{ type: "relates-to", epic: "base", reason: 7 }] }] })), /reason must be a string/);
  assert.deepEqual(ids(engine), ["base"]);
});

unitTest("an unknown link type is still refused, and the epic half is checked first", () => {
  const engine = withBase();
  assert.match(refusal(() => addMany(engine, { epics: [{ id: "a", lane: "claude-code", links: ["depends_on:base"] }] })),
    /'depends_on' is not one of/);
  assert.match(refusal(() => addMany(engine, { epics: [{ id: "a", lane: "claude-code", links: ["type:related:epic"] }] })),
    /'related' is not a known epic id/);
});

unitTest("a link to an entry LATER in the same batch is accepted, and so is a self-link (as update-epic --link accepts one)", () => {
  const engine = withBase();
  addMany(engine, { epics: [
    { id: "first", lane: "claude-code", links: ["depends-on:second"] },
    { id: "second", lane: "claude-code", links: [{ type: "relates-to", epic: "second" }] },
  ] });
  assert.deepEqual(epic(engine, "first").links, [{ type: "depends-on", epic: "second" }]);
  assert.deepEqual(epic(engine, "second").links, [{ type: "relates-to", epic: "second" }]);
});

unitTest("a hand-supplied may-invalidate edge is still written disarmed, as every other writer writes it", () => {
  const engine = withBase();
  addMany(engine, { epics: [{ id: "a", lane: "claude-code", links: ["may-invalidate:base:why"] }] });
  assert.deepEqual(epic(engine, "a").links,
    [{ type: "may-invalidate", epic: "base", reason: "why", reconcileOnResume: false }]);
});
