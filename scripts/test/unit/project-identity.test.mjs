// scripts/test/unit/project-identity.test.mjs
// project-boards 8.3 (spec project-identity): `set-project --name --key`, each with `--unset`. UNIT rung: the verb writes
// state.json and nothing else (no rules block, no render), so the success path is exercised through the verb over the in-memory
// store. Every refusal asserts the record is unchanged.

import assert from "node:assert/strict";
import { memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";
import { applyProject } from "../../lib/set-project.mjs";
import { projectKeyError, projectNameError } from "../../lib/project-identity.mjs";
import { VERB_EFFECTS } from "../../lib/verb-effects.mjs";

const record = (over = {}) => ({ version: 1, revision: 1, active: null, detourStack: [], epics: [], ...over });
const stateOf = (engine) => JSON.stringify(engine.store.record());
const refused = (engine, args, re) => {
  const before = stateOf(engine);
  const r = engine.result(args);
  assert.notEqual(r.status, 0, args.join(" "));
  assert.match(r.stderr, re);
  assert.equal(stateOf(engine), before, "a refusal writes nothing");
};

unitTest("set-project: both fields, then one alone; the other is untouched", () => {
  const engine = memoryEngine(record());
  engine(["set-project", "--name", "Project Manager", "--key", "PM"]);
  assert.deepEqual([engine.store.record().projectName, engine.store.record().projectKey], ["Project Manager", "PM"]);
  engine(["set-project", "--key", "PX"]);
  assert.deepEqual([engine.store.record().projectName, engine.store.record().projectKey], ["Project Manager", "PX"]);
  engine(["set-project", "--name", "Other"]);
  assert.deepEqual([engine.store.record().projectName, engine.store.record().projectKey], ["Other", "PX"]);
});

unitTest("set-project: a two-letter and a three-letter key are both valid", () => {
  const engine = memoryEngine(record());
  engine(["set-project", "--key", "AB"]);
  engine(["set-project", "--key", "ABC"]);
  assert.equal(engine.store.record().projectKey, "ABC");
});

unitTest("set-project: bad keys and names are refused with the rule named, writing nothing", () => {
  const engine = memoryEngine(record({ projectKey: "PM", projectName: "Keep" }));
  for (const key of ["pm", "P", "PMXX", "P1", "P M", "PM-", "ÅB", ""]) refused(engine, ["set-project", "--key", key], /--key/);
  refused(engine, ["set-project", "--name", ""], /--name/);
  refused(engine, ["set-project", "--name", "x".repeat(61)], /at most 60/);
  refused(engine, ["set-project", "--name", "a<b"], /`<`/);
  refused(engine, ["set-project", "--name", "a\nb"], /control character/);
  refused(engine, ["set-project", "--name", "a\u0007b"], /control character/);
  assert.equal(projectNameError("x".repeat(60)), null, "exactly 60 is allowed");
  assert.equal(projectKeyError("ZZ"), null);
});

unitTest("set-project: a valueless --name or --key is refused", () => {
  const engine = memoryEngine(record());
  refused(engine, ["set-project", "--name"], /--name/);
  refused(engine, ["set-project", "--key"], /--key/);
});

unitTest("set-project: --unset name and --unset key are the inverses, and an unset of an unset field is a no-op", () => {
  const engine = memoryEngine(record({ projectKey: "PM", projectName: "Keep" }));
  engine(["set-project", "--unset", "name"]);
  assert.equal("projectName" in engine.store.record(), false);
  assert.equal(engine.store.record().projectKey, "PM");
  engine(["set-project", "--unset", "key"]);
  assert.equal("projectKey" in engine.store.record(), false);
  const before = stateOf(engine);
  const out = engine.combined(["set-project", "--unset", "key"]);
  assert.match(out, /was not set/);
  assert.equal(stateOf(engine), before);
});

unitTest("set-project: both unsets in one call, repeated flag", () => {
  const engine = memoryEngine(record({ projectKey: "PM", projectName: "Keep" }));
  engine(["set-project", "--unset", "name", "--unset", "key"]);
  assert.deepEqual([engine.store.record().projectName, engine.store.record().projectKey], [undefined, undefined]);
});

unitTest("set-project: an unknown --unset field, no operation, and set-plus-unset of one field are refused", () => {
  const engine = memoryEngine(record({ projectKey: "PM" }));
  refused(engine, ["set-project", "--unset", "colour"], /name and key/);
  refused(engine, ["set-project"], /needs an operation/);
  refused(engine, ["set-project", "--key", "PX", "--unset", "key"], /contradict/);
  refused(engine, ["set-project", "--name", "N", "--unset", "name"], /contradict/);
});

unitTest("set-project: the same value twice writes nothing and says so", () => {
  const engine = memoryEngine(record());
  engine(["set-project", "--key", "PM", "--name", "N"]);
  const before = stateOf(engine);
  const out = engine.combined(["set-project", "--key", "PM", "--name", "N"]);
  assert.match(out, /already reads exactly that/);
  assert.equal(stateOf(engine), before);
});

unitTest("set-project: a positional argument is refused (the verb takes none)", () => {
  const engine = memoryEngine(record());
  refused(engine, ["set-project", "PM"], /./);
});

unitTest("set-project: it is declared as a mutating verb that writes state only", () => {
  assert.equal(VERB_EFFECTS["set-project"].effect, "mutates");
  assert.match(VERB_EFFECTS["set-project"].writes, /state\.json/);
  assert.doesNotMatch(VERB_EFFECTS["set-project"].writes, /CLAUDE\.md/);
});

unitTest("set-project: applyProject is pure — it returns the refusal and leaves the record alone", () => {
  const s = record({ projectKey: "PM" });
  const before = JSON.stringify(s);
  const r = applyProject(s, { key: "nope" });
  assert.equal(r.ok, false);
  assert.equal(JSON.stringify(s), before);
});
