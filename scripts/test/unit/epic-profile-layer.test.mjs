// scripts/test/unit/epic-profile-layer.test.mjs
// execution-profile-layered-settings 3.3 and 3.4 — the epic layer's flags on add-epic, add-many and
// update-epic, the removal of the escalate-only guard, and the activity log's profile events.
// UNIT RUNG: values over an in-memory store. (No verb here writes CLAUDE.md.)

import assert from "node:assert/strict";
import { emptyRecord, expectFail, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

const epicOf = (engine, id) => engine.store.record().epics.find(e => e.id === id);
const bytes = (engine) => engine.store.read("state.json").text;
const repo = (extra = {}) => {
  const engine = memoryEngine({ ...emptyRecord(), ...extra });
  engine(["add-epic", "--id", "e", "--lane", "claude-code"]);
  return engine;
};

unitTest("An epic override set at creation: add-epic --review-mode records it and nothing else changes", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "risky", "--title=Risky", "--lane", "openspec", "--review-mode", "thorough"]);
  const e = epicOf(engine, "risky");
  assert.equal(e.reviewMode, "thorough");
  assert.ok(!("model" in e) && !("verbosity" in e));
  assert.equal(engine.store.record().reviewMode, undefined, "no other layer changed");
});

unitTest("add-epic records model pairs and verbosity, and a refusal registers nothing", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code", "--model", "implement=sonnet:medium", "--model", "test=haiku", "--verbosity", "verbose"]);
  assert.deepEqual(epicOf(engine, "a").model, { implement: { model: "sonnet", effort: "medium" }, test: { model: "haiku" } });
  assert.equal(epicOf(engine, "a").verbosity, "verbose");
  const before = bytes(engine);
  for (const bad of [["--model", "test=haiku:low"], ["--model", "review=opus"], ["--verbosity", "loud"], ["--review-mode", "max"]]) {
    assert.ok(expectFail(() => engine(["add-epic", "--id", "b", "--lane", "claude-code", ...bad])), bad.join(" "));
  }
  assert.equal(bytes(engine), before);
});

unitTest("add-many accepts the same fields as batch keys, and one invalid value refuses the whole batch", () => {
  const engine = memoryEngine(emptyRecord());
  const batch = { epics: [
    { id: "a", lane: "claude-code", reviewMode: "off", verbosity: "verbose", model: ["implement=opus:high", "test=haiku"] },
    { id: "b", lane: "claude-code", model: { review: "sonnet:low", test: { model: "haiku" } } },
  ] };
  engine(["add-many", "--from", "-"], { input: JSON.stringify(batch) });
  assert.deepEqual(epicOf(engine, "a").model, { implement: { model: "opus", effort: "high" }, test: { model: "haiku" } });
  assert.equal(epicOf(engine, "a").reviewMode, "off");
  assert.equal(epicOf(engine, "a").verbosity, "verbose");
  assert.deepEqual(epicOf(engine, "b").model, { review: { model: "sonnet", effort: "low" }, test: { model: "haiku" } });

  const before = bytes(engine);
  const bad = { epics: [{ id: "c", lane: "claude-code" }, { id: "d", lane: "claude-code", verbosity: "loud" }] };
  assert.ok(expectFail(() => engine(["add-many", "--from", "-"], { input: JSON.stringify(bad) })));
  assert.equal(bytes(engine), before, "nothing written, not even the valid entry");
  const bad2 = { epics: [{ id: "c", lane: "claude-code", model: ["test=haiku:low"] }] };
  assert.ok(expectFail(() => engine(["add-many", "--from", "-"], { input: JSON.stringify(bad2) })));
  assert.equal(bytes(engine), before);
});

unitTest("An epic lowers review below the project: update-epic --review-mode below the dial succeeds", () => {
  const engine = repo({ reviewMode: "thorough" });
  engine(["update-epic", "e", "--review-mode", "standard"]);
  assert.equal(epicOf(engine, "e").reviewMode, "standard");
  assert.match(engine(["profile", "--epic", "e"]), /review: standard \(epic\) — overrides project thorough/);
  assert.ok(expectFail(() => engine(["update-epic", "e", "--review-mode", "bogus"])), "an unknown mode is still refused");
});

unitTest("update-epic --model refusals write nothing", () => {
  const engine = repo();
  const before = bytes(engine);
  for (const bad of [["--model", "review=opus"], ["--model", "test=haiku:low"], ["--model", "deploy=opus:medium"],
    ["--model", "implement=gpt:high"], ["--model", "implement=opus:huge"], ["--verbosity", "loud"]]) {
    const err = expectFail(() => engine(["update-epic", "e", ...bad]));
    assert.ok(err, bad.join(" "));
    assert.equal(bytes(engine), before, `unchanged after ${bad.join(" ")}`);
  }
  assert.match(expectFail(() => engine(["update-epic", "e", "--model", "review=opus"])).stderr, /low\|medium\|high\|xhigh\|max\|ultracode/);
});

unitTest("Setting one model role leaves the others; Clearing one epic model role keeps the rest", () => {
  const engine = repo();
  engine(["update-epic", "e", "--model", "implement=opus:medium", "--model", "test=haiku"]);
  engine(["update-epic", "e", "--model", "review=sonnet:low"]);
  assert.deepEqual(Object.keys(epicOf(engine, "e").model).sort(), ["implement", "review", "test"]);
  engine(["update-epic", "e", "--clear-model", "test"]);
  assert.deepEqual(Object.keys(epicOf(engine, "e").model).sort(), ["implement", "review"]);
  assert.deepEqual(epicOf(engine, "e").model.implement, { model: "opus", effort: "medium" });
  engine(["update-epic", "e", "--clear-model", "implement", "--clear-model", "review"]);
  assert.ok(!("model" in epicOf(engine, "e")), "an emptied model map is removed");
});

unitTest("--clear-model refuses an unknown role, and a role set in the same call", () => {
  const engine = repo();
  engine(["update-epic", "e", "--model", "test=haiku"]);
  const before = bytes(engine);
  assert.match(expectFail(() => engine(["update-epic", "e", "--clear-model", "deploy"])).stderr, /implement\|test\|review/);
  assert.ok(expectFail(() => engine(["update-epic", "e", "--clear-model", "test", "--model", "test=haiku"])));
  assert.equal(bytes(engine), before);
});

unitTest("--clear model, --clear verbosity and --clear review-mode each fall through to the next layer", () => {
  const engine = repo({ reviewMode: "thorough", executionProfile: { verbosity: "verbose" } });
  engine(["update-epic", "e", "--model", "test=haiku", "--verbosity", "quiet", "--review-mode", "off"]);
  engine(["update-epic", "e", "--clear", "model", "--clear", "verbosity", "--clear", "review-mode"]);
  const e = epicOf(engine, "e");
  assert.ok(!("model" in e) && !("verbosity" in e) && !("reviewMode" in e));
  const out = engine(["profile", "--epic", "e"]);
  assert.match(out, /review: thorough \(project\)/);
  assert.match(out, /verbosity: verbose \(project\)/);
});

unitTest("a detour epic does not inherit the profile of the epic it paused, through the verbs", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "parent", "--lane", "claude-code", "--status", "active", "--review-mode", "thorough", "--model", "test=haiku"]);
  engine(["add-epic", "--id", "fix", "--lane", "claude-code"]);
  engine(["push-detour", "parent", "--detour", "fix", "--reason", "blocked", "--reconcile"]);
  const out = engine(["profile", "--epic", "fix"]);
  assert.match(out, /review: standard \(default\)/);
  assert.doesNotMatch(out, /thorough|haiku/);
});

// ── 3.4: the activity log ──

unitTest("a lane model change produces one profile-setting event naming layer, field, from and to", async () => {
  const { diffEvents } = await import(new URL("../../lib/activity-log.mjs", import.meta.url).href);
  const b = { revision: 1, epics: [] };
  const a = { revision: 2, epics: [], laneProfiles: { "claude-code": { model: { test: { model: "sonnet", effort: "low" } } } } };
  const ev = diffEvents(b, a, { verb: "set-profile" }).filter(e => e.kind === "profile-setting");
  assert.equal(ev.length, 1);
  assert.deepEqual([ev[0].layer, ev[0].field, ev[0].from, ev[0].to], ["lane:claude-code", "model.test", null, "sonnet (low)"]);
});

unitTest("profile-setting events cover the project, a lane's review and an epic's verbosity and model", async () => {
  const { diffEvents } = await import(new URL("../../lib/activity-log.mjs", import.meta.url).href);
  const epicA = { id: "e", lane: "claude-code" };
  const b = { revision: 1, epics: [epicA] };
  const a = { revision: 2,
    executionProfile: { verbosity: "verbose" },
    laneProfiles: { decision: { review: "off" } },
    epics: [{ ...epicA, verbosity: "quiet", model: { review: { model: "haiku" } }, reviewMode: "thorough" }] };
  const rows = diffEvents(b, a, { verb: "set-profile" }).filter(e => e.kind === "profile-setting")
    .map(e => [e.epic, e.layer, e.field, e.from, e.to]);
  assert.deepEqual(rows.sort(), [
    ["e", "epic", "model.review", null, "haiku"],
    ["e", "epic", "verbosity", null, "quiet"],
    [null, "lane:decision", "review", null, "off"],
    [null, "project", "verbosity", null, "verbose"],
  ].sort());
  const kinds = diffEvents(b, a, { verb: "update-epic" }).map(e => e.kind);
  assert.ok(kinds.includes("review-mode"), "the epic's review stays a review-mode event, in its historical shape");
});

unitTest("an unrelated write logs no profile-setting event", async () => {
  const { diffEvents } = await import(new URL("../../lib/activity-log.mjs", import.meta.url).href);
  const s = { revision: 1, epics: [{ id: "e", lane: "claude-code", model: { test: { model: "haiku" } } }] };
  const ev = diffEvents(s, { ...s, revision: 2, active: "e" }, { verb: "set-active" });
  assert.ok(!ev.some(e => e.kind === "profile-setting"));
});
