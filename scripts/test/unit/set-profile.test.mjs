// scripts/test/unit/set-profile.test.mjs
// execution-profile-layered-settings 3.1 (the parts that write nothing to disk) and 3.2.
//
// RUNG NOTE. A SUCCESSFUL `set-profile` refreshes CLAUDE.md's managed block (the same write
// `set-review-mode` makes), and the unit rung's counter refuses any filesystem write — the reason
// conductor-05 kept its three review-mode tests on the file rung. So this file holds (a) the pure
// parse and apply functions, which is where every set/unset/lane/validation rule lives, (b) every
// REFUSAL through the engine (a refusal writes nothing), and (c) the read verb `profile`. The
// end-to-end success path, and state.json's byte identity, are in assert/set-profile.test.mjs.

import assert from "node:assert/strict";
import { emptyRecord, expectFail, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

const load = () => import(new URL("../../lib/execution-profile.mjs", import.meta.url).href);
const LANES = ["openspec", "superpowers", "claude-code", "decision", "external"];
const epic = (id, extra = {}) => ({ id, title: id, priority: "P1", status: "queued", role: "epic", lane: "claude-code", links: [], reconcileNeeded: false, ...extra });
const seeded = (extra = {}, epics = []) => memoryEngine({ ...emptyRecord(), epics, ...extra });

// ── parseSetProfile ──

unitTest("a call that names no operation is refused before anything is read", async () => {
  const { parseSetProfile } = await load();
  const r = parseSetProfile({}, LANES);
  assert.equal(r.ok, false);
  assert.match(r.message, /needs an operation/);
  assert.equal(parseSetProfile({ lane: "decision" }, LANES).ok, false, "a scope alone is not an operation");
});

unitTest("an unknown lane is refused naming the known lanes", async () => {
  const { parseSetProfile } = await load();
  const r = parseSetProfile({ lane: "marketing", review: "off" }, LANES);
  assert.equal(r.ok, false);
  assert.match(r.message, /'marketing'.*openspec\|superpowers\|claude-code\|decision\|external/);
});

unitTest("a field set and unset in one call is refused, at every spelling", async () => {
  const { parseSetProfile } = await load();
  assert.equal(parseSetProfile({ review: "off", unset: "review" }, LANES).ok, false);
  assert.equal(parseSetProfile({ verbosity: "quiet", unset: ["verbosity"] }, LANES).ok, false);
  assert.equal(parseSetProfile({ model: "test=haiku", unset: "model" }, LANES).ok, false);
  assert.equal(parseSetProfile({ model: "test=haiku", unset: "model:test" }, LANES).ok, false);
  assert.equal(parseSetProfile({ model: "test=haiku", unset: "model:review" }, LANES).ok, true, "a different role is not a clash");
});

unitTest("every model, review and verbosity refusal names the accepted values", async () => {
  const { parseSetProfile } = await load();
  assert.match(parseSetProfile({ model: "test=haiku:low" }, LANES).message, /takes no effort/);
  assert.match(parseSetProfile({ model: "review=opus" }, LANES).message, /low\|medium/);
  assert.match(parseSetProfile({ model: "deploy=opus:medium" }, LANES).message, /implement\|test\|review/);
  assert.match(parseSetProfile({ review: "max" }, LANES).message, /off\|standard\|thorough/);
  assert.match(parseSetProfile({ verbosity: "loud" }, LANES).message, /quiet\|verbose/);
});

// ── applyProfileOps ──

const ops = async (f) => { const { parseSetProfile } = await load(); const r = parseSetProfile(f, LANES); assert.ok(r.ok, r.message); return r.ops; };

unitTest("a project model pair is recorded whole, and haiku carries no effort key", async () => {
  const { applyProfileOps } = await load();
  const s = {};
  applyProfileOps(s, await ops({ model: ["implement=sonnet:medium", "test=haiku"] }));
  assert.deepEqual(s.executionProfile.model, { implement: { model: "sonnet", effort: "medium" }, test: { model: "haiku" } });
  assert.ok(!("effort" in s.executionProfile.model.test));
});

unitTest("the project review is written to state.reviewMode, the existing key", async () => {
  const { applyProfileOps } = await load();
  const s = {};
  applyProfileOps(s, await ops({ review: "thorough" }));
  assert.equal(s.reviewMode, "thorough");
  assert.ok(!s.executionProfile, "no second record for one fact");
});

unitTest("setting one model role leaves the layer's other roles unchanged", async () => {
  const { applyProfileOps } = await load();
  const s = { executionProfile: { model: { implement: { model: "opus", effort: "low" }, test: { model: "haiku" } } } };
  applyProfileOps(s, await ops({ model: "review=opus:high" }));
  assert.deepEqual(Object.keys(s.executionProfile.model).sort(), ["implement", "review", "test"]);
  assert.deepEqual(s.executionProfile.model.implement, { model: "opus", effort: "low" });
});

unitTest("a lane override lands in laneProfiles and touches neither the project nor any epic", async () => {
  const { applyProfileOps } = await load();
  const s = { reviewMode: "thorough", epics: [epic("e")] };
  applyProfileOps(s, await ops({ lane: "claude-code", review: "off" }));
  assert.deepEqual(s.laneProfiles, { "claude-code": { review: "off" } });
  assert.equal(s.reviewMode, "thorough");
  assert.equal(s.epics[0].reviewMode, undefined);
});

unitTest("unsetting the project review restores the default; unsetting the last lane field removes the lane layer", async () => {
  const { applyProfileOps, resolveProfile } = await load();
  const s = { reviewMode: "thorough", laneProfiles: { decision: { review: "off" } } };
  applyProfileOps(s, await ops({ unset: "review" }));
  assert.ok(!("reviewMode" in s));
  assert.equal(resolveProfile(s, {}).review.source, "default");
  applyProfileOps(s, await ops({ lane: "decision", unset: "review" }));
  assert.ok(!("laneProfiles" in s), "the emptied lane (and the empty map) is gone");
});

unitTest("unsetting one role, then the rest, empties the model map away", async () => {
  const { applyProfileOps } = await load();
  const s = { executionProfile: { model: { implement: { model: "opus", effort: "low" }, test: { model: "haiku" } }, verbosity: "verbose" } };
  applyProfileOps(s, await ops({ unset: "model:test" }));
  assert.deepEqual(Object.keys(s.executionProfile.model), ["implement"]);
  applyProfileOps(s, await ops({ unset: "model" }));
  assert.deepEqual(s.executionProfile, { verbosity: "verbose" });
  applyProfileOps(s, await ops({ unset: "verbosity" }));
  assert.ok(!("executionProfile" in s));
});

unitTest("unsetting what is not set reports it and changes nothing", async () => {
  const { applyProfileOps } = await load();
  const s = { epics: [] };
  const r = applyProfileOps(s, await ops({ unset: ["verbosity", "model:test", "review"] }));
  assert.equal(r.changed, false);
  assert.deepEqual(r.already, ["verbosity", "model:test", "review"]);
  assert.deepEqual(s, { epics: [] }, "no container was left behind");
  const lane = applyProfileOps(s, await ops({ lane: "external", unset: "verbosity" }));
  assert.equal(lane.changed, false);
  assert.deepEqual(s, { epics: [] });
});

unitTest("re-setting the same value is not a change", async () => {
  const { applyProfileOps } = await load();
  const s = { reviewMode: "thorough" };
  assert.equal(applyProfileOps(s, await ops({ review: "thorough" })).changed, false);
});

// ── the engine's refusals write nothing ──

unitTest("set-profile refusals exit non-zero and leave state.json byte-identical", () => {
  const engine = seeded();
  const before = engine.store.read("state.json").text;
  for (const args of [
    ["set-profile"],
    ["set-profile", "--lane", "marketing", "--review", "off"],
    ["set-profile", "--model", "test=haiku:low"],
    ["set-profile", "--model", "implement=opus"],
    ["set-profile", "--verbosity", "loud"],
    ["set-profile", "--review", "max"],
    ["set-profile", "--review", "off", "--unset", "review"],
    ["set-profile", "--unset", "colour"],
  ]) {
    assert.ok(expectFail(() => engine(args)), `refused: ${args.join(" ")}`);
    assert.equal(engine.store.read("state.json").text, before, `unchanged after: ${args.join(" ")}`);
  }
});

unitTest("set-profile's refusals name the offender and the accepted list on stderr", () => {
  const engine = seeded();
  const err = expectFail(() => engine(["set-profile", "--lane", "marketing", "--review", "off"]));
  assert.match(err.stderr, /^conductor: --lane 'marketing' is not one of openspec\|/);
  assert.match(expectFail(() => engine(["set-profile", "--model", "test=haiku:low"])).stderr, /haiku is a model that takes no effort/);
});

// ── 3.2: the profile verb ──

unitTest("profile prints each field with its source and names the value an epic lowered", () => {
  const engine = seeded({ reviewMode: "thorough" }, [epic("e", { reviewMode: "standard" })]);
  const out = engine(["profile", "--epic", "e"]);
  assert.match(out, /review: standard \(epic\) — overrides project thorough/);
  assert.match(out, /verbosity: quiet \(default\)/);
  assert.match(out, /model implement: no directive \(default\)/);
});

unitTest("profile names a stored value it ignored", () => {
  const engine = seeded({ laneProfiles: { "claude-code": { verbosity: "verbose" } } }, [epic("e", { verbosity: "loud" })]);
  const out = engine(["profile", "--epic", "e"]);
  assert.match(out, /verbosity: verbose \(lane:claude-code\)/);
  assert.match(out, /ignored: epic verbosity 'loud'/);
});

unitTest("profile --lane resolves what an override-free epic of that lane would; bare profile is the project layer", () => {
  const engine = seeded({ reviewMode: "thorough", laneProfiles: { decision: { review: "off", model: { test: { model: "haiku" } } } } });
  const lane = engine(["profile", "--lane", "decision"]);
  assert.match(lane, /review: off \(lane:decision\) — overrides project thorough/);
  assert.match(lane, /model test: haiku \(lane:decision\)/);
  assert.match(engine(["profile"]), /review: thorough \(project\)/);
});

unitTest("profile refuses an unknown epic, an unknown lane, and both scopes at once, writing nothing", () => {
  const engine = seeded();
  const before = engine.store.read("state.json").text;
  assert.match(expectFail(() => engine(["profile", "--epic", "no-such-epic"])).stderr, /no epic 'no-such-epic'/);
  assert.match(expectFail(() => engine(["profile", "--lane", "marketing"])).stderr, /openspec\|superpowers/);
  assert.ok(expectFail(() => engine(["profile", "--epic", "x", "--lane", "decision"])));
  assert.equal(engine.store.read("state.json").text, before);
});

unitTest("profile writes nothing on success", () => {
  const engine = seeded({ reviewMode: "thorough" }, [epic("e")]);
  const before = engine.store.read("state.json").text;
  engine(["profile", "--epic", "e"]); engine(["profile"]); engine(["profile", "--lane", "openspec"]);
  assert.equal(engine.store.read("state.json").text, before);
});

unitTest("set-profile --help lists exactly the D4 flags, and profile --help its two", () => {
  const engine = seeded();
  const help = engine(["set-profile", "--help"]);
  for (const flag of ["--lane", "--review", "--model", "--verbosity", "--unset"]) assert.match(help, new RegExp(flag));
  assert.match(engine(["profile", "--help"]), /--epic[\s\S]*--lane|--lane[\s\S]*--epic/);
});
