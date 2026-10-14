// scripts/test/unit/execution-profile-defaults.test.mjs
// execution-profile-planning-and-light-roles 1.1-1.3 — the six job roles, the built-in default pair
// per role, resolution to the default, and the emitted instructions that name them.
// UNIT RUNG: values over in-memory records and the pure rulesBlock() string.

import assert from "node:assert/strict";
import { emptyRecord, expectFail, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";
import { DEFAULT_ROLE_MODELS, KNOWN_JOB_ROLES } from "../../lib/constants.mjs";
import { applyProfileOps, checkPair, modelText, parseSetProfile, profileContext, resolveProfile, briefProfileLines } from "../../lib/execution-profile.mjs";
import { rulesBlock } from "../../lib/rules.mjs";

const ROLES = ["plan", "implement", "test", "review", "mechanical", "rudimentary"];
const epic = (id, extra = {}) => ({ id, title: id, priority: "P1", status: "queued", role: "epic", lane: "claude-code", links: [], reconcileNeeded: false, ...extra });
const state = (extra = {}, epics = []) => ({ ...emptyRecord(), epics, ...extra });

unitTest("1.1 the job roles are the six, in lifecycle order", () => {
  assert.deepEqual(KNOWN_JOB_ROLES, ROLES);
});

unitTest("1.1 the default table covers exactly the job roles, in order, frozen, every pair valid", () => {
  assert.deepEqual(Object.keys(DEFAULT_ROLE_MODELS), [...KNOWN_JOB_ROLES]);
  assert.ok(Object.isFrozen(DEFAULT_ROLE_MODELS));
  for (const role of KNOWN_JOB_ROLES) {
    const p = DEFAULT_ROLE_MODELS[role];
    assert.equal(checkPair(p.model, p.effort).ok, true, role);
  }
  assert.deepEqual(DEFAULT_ROLE_MODELS, {
    plan: { model: "opus", effort: "high" }, implement: { model: "sonnet", effort: "medium" },
    test: { model: "sonnet", effort: "low" }, review: { model: "opus", effort: "high" },
    mechanical: { model: "sonnet", effort: "low" }, rudimentary: { model: "haiku" },
  });
});

unitTest("1.2 a fresh repository resolves every role to its default, source default", () => {
  const p = resolveProfile(state(), {});
  for (const role of KNOWN_JOB_ROLES) assert.deepEqual(p.model[role], { value: DEFAULT_ROLE_MODELS[role], source: "default" }, role);
  const out = memoryEngine(state())(["profile"]);
  assert.match(out, /model plan: opus \(high\) \(default\)/);
  assert.match(out, /model implement: sonnet \(medium\) \(default\)/);
  assert.match(out, /model test: sonnet \(low\) \(default\)/);
  assert.match(out, /model review: opus \(high\) \(default\)/);
  assert.match(out, /model mechanical: sonnet \(low\) \(default\)/);
  assert.match(out, /model rudimentary: haiku \(default\)/);
});

unitTest("1.2 a layer's pair replaces the default whole", () => {
  const p = resolveProfile(state({ executionProfile: { model: { rudimentary: { model: "sonnet", effort: "low" } } } }), {});
  assert.deepEqual(p.model.rudimentary, { value: { model: "sonnet", effort: "low" }, source: "project" });
  assert.deepEqual(p.model.plan, { value: { model: "opus", effort: "high" }, source: "default" });
});

unitTest("1.2 a pre-0.52.0 state holding only the old three roles still resolves", () => {
  const s = state({ pmVersion: "0.51.0", executionProfile: { model: {
    implement: { model: "opus", effort: "medium" }, test: { model: "haiku" }, review: { model: "sonnet", effort: "high" } } } });
  const p = resolveProfile(s, {});
  for (const r of ["implement", "test", "review"]) assert.equal(p.model[r].source, "project", r);
  for (const r of ["plan", "mechanical", "rudimentary"]) assert.equal(p.model[r].source, "default", r);
});

unitTest("1.2 a one-shot epic overrides only implement", () => {
  const s = state({}, [epic("e", { model: { implement: { model: "fable", effort: "high" } } })]);
  const p = resolveProfile(s, { epicId: "e" });
  assert.deepEqual(p.model.implement, { value: { model: "fable", effort: "high" }, source: "epic" });
  for (const r of KNOWN_JOB_ROLES.filter((x) => x !== "implement")) assert.equal(p.model[r].source, "default", r);
});

unitTest("1.2 the brief stays silent on defaults", () => {
  const s = state({}, [epic("e", { model: { implement: { model: "fable", effort: "high" } } })]);
  const lines = briefProfileLines(resolveProfile(s, { epicId: "e" }));
  assert.deepEqual(lines.filter((l) => l.startsWith("model:")), ["model: implement fable (high) (epic)"]);
});

unitTest("1.2 the resolved default is a copy: mutating it never reaches the table", () => {
  const p = resolveProfile(state(), {});
  assert.notEqual(p.model.plan.value, DEFAULT_ROLE_MODELS.plan);
});

// RUNG NOTE: a successful `set-profile` rewrites CLAUDE.md's managed block, which the unit rung's
// guard refuses (see set-profile.test.mjs). The project and lane layers therefore go through the
// verb's own parse + apply pair (parseSetProfile -> applyProfileOps, exactly what the verb runs);
// the epic layer goes through the real `update-epic` verb. The verb end to end is in
// assert/execution-profile-emission.test.mjs.
const LANES = ["openspec", "superpowers", "claude-code", "decision", "external"];
const setProfile = (st, flags) => {
  const r = parseSetProfile(flags, LANES);
  assert.ok(r.ok, r.message);
  return applyProfileOps(st, r.ops);
};

unitTest("1.2 a new role is accepted at every layer: written at project, lane and epic, stored and resolved", () => {
  const st = state({}, [epic("e")]);
  setProfile(st, { model: ["plan=fable:high"] });
  setProfile(st, { lane: "claude-code", model: ["mechanical=haiku"] });
  const engine = memoryEngine(st);
  engine(["update-epic", "e", "--model", "rudimentary=sonnet:low"]);
  const rec = engine.store.record();
  assert.deepEqual(rec.executionProfile.model, { plan: { model: "fable", effort: "high" } });
  assert.deepEqual(rec.laneProfiles["claude-code"].model, { mechanical: { model: "haiku" } });
  assert.deepEqual(rec.epics[0].model, { rudimentary: { model: "sonnet", effort: "low" } });
  const p = resolveProfile(rec, { epicId: "e" });
  assert.deepEqual(p.model.plan, { value: { model: "fable", effort: "high" }, source: "project" });
  assert.deepEqual(p.model.mechanical, { value: { model: "haiku" }, source: "lane:claude-code" });
  assert.deepEqual(p.model.rudimentary, { value: { model: "sonnet", effort: "low" }, source: "epic" });
  for (const r of ["implement", "test", "review"]) assert.equal(p.model[r].source, "default", r);
});

unitTest("1.2 unsetting a role restores its default, at project, lane and epic", () => {
  const resolved = (st, role) => resolveProfile(st, { epicId: "e" }).model[role];
  const isDefault = (st, role) => assert.deepEqual(resolved(st, role), { value: DEFAULT_ROLE_MODELS[role], source: "default" }, role);

  // project layer: set-profile --unset model:<role>
  const proj = state({}, [epic("e")]);
  setProfile(proj, { model: ["plan=sonnet:high"] });
  assert.deepEqual(resolved(proj, "plan"), { value: { model: "sonnet", effort: "high" }, source: "project" });
  setProfile(proj, { unset: "model:plan" });
  isDefault(proj, "plan");
  assert.equal(proj.executionProfile, undefined, "the emptied project layer is removed");

  // lane layer: set-profile --lane <lane> --unset model:<role>, then --unset model
  const lane = state({}, [epic("e")]);
  setProfile(lane, { lane: "claude-code", model: ["mechanical=haiku", "rudimentary=sonnet:low"] });
  assert.equal(resolved(lane, "mechanical").source, "lane:claude-code");
  setProfile(lane, { lane: "claude-code", unset: "model:mechanical" });
  isDefault(lane, "mechanical");
  assert.equal(resolved(lane, "rudimentary").source, "lane:claude-code", "the sibling role is untouched");
  setProfile(lane, { lane: "claude-code", unset: "model" });
  for (const r of KNOWN_JOB_ROLES) isDefault(lane, r);

  // epic layer: update-epic --clear-model <role>, then --clear model
  const ep = memoryEngine(state({}, [epic("e")]));
  ep(["update-epic", "e", "--model", "rudimentary=sonnet:low"]);
  assert.equal(resolved(ep.store.record(), "rudimentary").source, "epic");
  ep(["update-epic", "e", "--clear-model", "rudimentary"]);
  isDefault(ep.store.record(), "rudimentary");
  ep(["update-epic", "e", "--model", "plan=fable:high", "--model", "test=haiku"]);
  ep(["update-epic", "e", "--clear", "model"]);
  for (const r of KNOWN_JOB_ROLES) isDefault(ep.store.record(), r);
});

unitTest("1.1 the refusal for an unknown role names all six; --clear-model help names all six", () => {
  const engine = memoryEngine(state({}, [epic("e")]));
  const err = expectFail(() => engine(["update-epic", "e", "--model", "deploy=opus:medium"])).stderr;
  assert.ok(err.includes(ROLES.join("|")), err);
  const help = engine(["update-epic", "--help"]);
  assert.ok(help.includes(ROLES.join("|")), "update-epic --help names every role");
});

unitTest("1.1 --clear model's note ends at the built-in default", () => {
  const engine = memoryEngine(state({}, [epic("e", { model: { plan: { model: "sonnet", effort: "low" } } })]));
  const r = engine.result(["update-epic", "e", "--clear", "model"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout + r.stderr, /then its built-in default/);
  const p = resolveProfile(engine.store.record(), { epicId: "e" });
  for (const role of KNOWN_JOB_ROLES) assert.deepEqual(p.model[role], { value: DEFAULT_ROLE_MODELS[role], source: "default" }, role);
});

unitTest("1.3 the rules block shows every role's default and names all six at dispatch", () => {
  const block = rulesBlock(null, "standard", [], "claude-code", profileContext(state()));
  for (const role of KNOWN_JOB_ROLES) {
    assert.ok(block.includes(`- model ${role}: ${modelText(DEFAULT_ROLE_MODELS[role])} (default)`), role);
  }
  const sentence = block.slice(block.indexOf("Each field resolves independently"), block.indexOf("Set the project or a lane"));
  assert.doesNotMatch(sentence, /no model directive/);
  assert.match(block, /\*\*Before dispatching a job\*\* \(/);
  const dispatch = block.slice(block.indexOf("**Before dispatching a job**"), block.indexOf("resolve the active epic"));
  for (const role of KNOWN_JOB_ROLES) assert.ok(dispatch.includes(role), `dispatch line names ${role}`);
});

unitTest("1.3 the resolution order names every default, even for an overridden role", () => {
  const s = state({ executionProfile: { model: { implement: { model: "sonnet", effort: "medium" } } } });
  const block = rulesBlock(null, "standard", [], "claude-code", profileContext(s));
  const sentence = block.slice(block.indexOf("Each field resolves independently"), block.indexOf("Set the project or a lane"));
  for (const role of KNOWN_JOB_ROLES) {
    assert.ok(sentence.includes(`${role} ${modelText(DEFAULT_ROLE_MODELS[role])}`), `${role} default is in the sentence`);
  }
});

unitTest("1.3 the one-shot override is named in the rules block", () => {
  const block = rulesBlock(null, "standard", [], "claude-code", profileContext(state()));
  assert.ok(block.includes("--model implement=fable:<effort>"));
});

unitTest("1.3 rules --epic emits the effective value", () => {
  const s = state({}, [epic("e", { model: { implement: { model: "sonnet", effort: "medium" } } })]);
  const block = rulesBlock(null, "standard", [], "claude-code", profileContext(s, "e"));
  assert.ok(block.includes("- model implement: sonnet (medium) (epic)"));
});
