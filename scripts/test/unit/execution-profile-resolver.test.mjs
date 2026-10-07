// scripts/test/unit/execution-profile-resolver.test.mjs
// execution-profile-layered-settings 2.1-2.3 — resolveProfile(state, {epicId?, lane?}), the
// currentReviewMode adapter, and the detour rule. UNIT RUNG: values over in-memory records.

import assert from "node:assert/strict";
import { emptyRecord, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

const load = () => import(new URL("../../lib/execution-profile.mjs", import.meta.url).href);
const epic = (id, extra = {}) => ({ id, title: id, priority: "P1", status: "queued", role: "epic", lane: "claude-code", links: [], reconcileNeeded: false, ...extra });
const state = (extra = {}, epics = []) => ({ ...emptyRecord(), epics, ...extra });

// ── 2.1 ──

unitTest("an epic overrides only review; the other fields come from the project", async () => {
  const { resolveProfile } = await load();
  const s = state({ reviewMode: "standard", executionProfile: { verbosity: "quiet", model: { implement: { model: "opus", effort: "medium" } } } },
    [epic("e", { reviewMode: "thorough" })]);
  const p = resolveProfile(s, { epicId: "e" });
  assert.equal(p.review.value, "thorough"); assert.equal(p.review.source, "epic");
  assert.deepEqual(p.model.implement, { value: { model: "opus", effort: "medium" }, source: "project" });
  assert.equal(p.verbosity.value, "quiet"); assert.equal(p.verbosity.source, "project");
});

unitTest("a lane value sits between project and epic", async () => {
  const { resolveProfile } = await load();
  const s = state({ reviewMode: "thorough", laneProfiles: { "claude-code": { review: "standard" } } }, [epic("e")]);
  const p = resolveProfile(s, { epicId: "e" });
  assert.equal(p.review.value, "standard"); assert.equal(p.review.source, "lane:claude-code");
});

unitTest("an epic lowers review below the project, and the overridden value is named", async () => {
  const { resolveProfile } = await load();
  const s = state({ reviewMode: "thorough" }, [epic("e", { reviewMode: "standard" })]);
  const p = resolveProfile(s, { epicId: "e" });
  assert.equal(p.review.value, "standard"); assert.equal(p.review.source, "epic");
  assert.deepEqual(p.review.overrides, { value: "thorough", source: "project" });
});

unitTest("a model pair is taken whole from one layer, never an effort from another", async () => {
  const { resolveProfile } = await load();
  const s = state({ laneProfiles: { "claude-code": { model: { test: { model: "sonnet", effort: "low" } } } } },
    [epic("e", { model: { test: { model: "haiku" } } })]);
  const p = resolveProfile(s, { epicId: "e" });
  assert.deepEqual(p.model.test.value, { model: "haiku" });
  assert.equal(p.model.test.source, "epic");
  assert.ok(!("effort" in p.model.test.value));
  assert.deepEqual(p.model.test.overrides, { value: { model: "sonnet", effort: "low" }, source: "lane:claude-code" });
});

unitTest("model resolves per role, each from its own layer", async () => {
  const { resolveProfile } = await load();
  const s = state({ executionProfile: { model: { implement: { model: "opus", effort: "high" }, test: { model: "haiku" } } },
    laneProfiles: { "claude-code": { model: { test: { model: "sonnet", effort: "low" } } } } },
    [epic("e", { model: { review: { model: "fable", effort: "max" } } })]);
  const p = resolveProfile(s, { epicId: "e" });
  assert.equal(p.model.implement.source, "project");
  assert.equal(p.model.test.source, "lane:claude-code");
  assert.equal(p.model.review.source, "epic");
});

unitTest("nothing set resolves to today's behaviour over a 0.50.0-shaped state", async () => {
  const { resolveProfile } = await load();
  const s = state({ pmVersion: "0.50.0", reviewMode: undefined }, [epic("e")]);
  const p = resolveProfile(s, { epicId: "e" });
  assert.deepEqual(p.review, { value: "standard", source: "default" });
  assert.deepEqual(p.verbosity, { value: "quiet", source: "default" });
  for (const r of ["implement", "test", "review"]) assert.deepEqual(p.model[r], { value: null, source: "default" });
});

unitTest("a stored invalid value falls through and is named as ignored", async () => {
  const { resolveProfile } = await load();
  const s = state({ laneProfiles: { "claude-code": { verbosity: "verbose" } } }, [epic("e", { verbosity: "loud" })]);
  const p = resolveProfile(s, { epicId: "e" });
  assert.equal(p.verbosity.value, "verbose"); assert.equal(p.verbosity.source, "lane:claude-code");
  assert.deepEqual(p.verbosity.ignored, [{ source: "epic", value: "loud" }]);
});

unitTest("a stored invalid model pair (haiku with an effort) is ignored, not half-used", async () => {
  const { resolveProfile } = await load();
  const s = state({ executionProfile: { model: { test: { model: "sonnet", effort: "low" } } } },
    [epic("e", { model: { test: { model: "haiku", effort: "low" } } })]);
  const p = resolveProfile(s, { epicId: "e" });
  assert.deepEqual(p.model.test.value, { model: "sonnet", effort: "low" });
  assert.equal(p.model.test.ignored[0].source, "epic");
});

unitTest("with a lane and no epic, the lane and project layers resolve; with neither, the project layer", async () => {
  const { resolveProfile } = await load();
  const s = state({ reviewMode: "thorough", laneProfiles: { decision: { review: "off" } } });
  assert.equal(resolveProfile(s, { lane: "decision" }).review.source, "lane:decision");
  assert.equal(resolveProfile(s, {}).review.source, "project");
  assert.equal(resolveProfile(s).review.value, "thorough");
});

// ── 2.2 ──

unitTest("currentReviewMode resolves an epic BELOW the project to its own value (An epic lowers review below the project)", async () => {
  const engine = memoryEngine(state({ reviewMode: "thorough" }, [epic("docs-tweak", { reviewMode: "standard" })]));
  assert.match(engine(["rules", "--epic", "docs-tweak"]), /Current mode: \*\*standard\*\*/);
  assert.match(engine(["rules"]), /Current mode: \*\*thorough\*\*/);
  const { currentReviewMode } = await import(new URL("../../lib/rules.mjs", import.meta.url).href);
  assert.equal(typeof currentReviewMode, "function");
});

// ── 2.3 ──

unitTest("a detour epic does not inherit from the epic it paused", async () => {
  const { resolveProfile } = await load();
  const engine = memoryEngine(state({ reviewMode: "standard" },
    [epic("parent", { status: "in-progress", reviewMode: "thorough" }), epic("fix")]));
  engine(["push-detour", "parent", "--detour", "fix", "--reason", "blocked", "--reconcile"]);
  const p = resolveProfile(engine.store.record(), { epicId: "fix" });
  assert.equal(p.review.value, "standard");
  assert.notEqual(p.review.source, "epic");
  assert.ok(!JSON.stringify(p).includes("thorough"), "the parent's thorough never appears in the detour's profile");
});
