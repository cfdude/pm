// scripts/test/unit/execution-profile-defaults.test.mjs
// execution-profile-planning-and-light-roles 1.1-1.3 — the six job roles, the built-in default pair
// per role, resolution to the default, and the emitted instructions that name them.
// UNIT RUNG: values over in-memory records and the pure rulesBlock() string.

import assert from "node:assert/strict";
import { emptyRecord, expectFail, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";
import { DEFAULT_ROLE_MODELS, KNOWN_JOB_ROLES } from "../../lib/constants.mjs";
import { checkPair, modelText, profileContext, resolveProfile, briefProfileLines } from "../../lib/execution-profile.mjs";
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

unitTest("1.2 a new role is accepted at every layer (parse level)", async () => {
  const { parseSetProfile } = await import(new URL("../../lib/execution-profile.mjs", import.meta.url).href);
  const r = parseSetProfile({ model: ["plan=fable:high", "mechanical=haiku", "rudimentary=sonnet:low"] },
    ["openspec", "superpowers", "claude-code", "decision", "external"]);
  assert.equal(r.ok, true);
});

unitTest("1.2 unsetting a role restores its default", () => {
  const engine = memoryEngine(state({ executionProfile: { model: { plan: { model: "sonnet", effort: "high" } } } }));
  assert.match(engine(["profile"]), /model plan: sonnet \(high\) \(project\)/);
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
