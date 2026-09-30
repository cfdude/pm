// scripts/test/unit/execution-profile-emission.test.mjs
// execution-profile-layered-settings 4.1, 4.2, 4.4 — what pm emits: the rules block's Execution
// profile section, `rules --epic`, and the brief. UNIT RUNG: values in, text out (rulesBlock and
// buildBrief are pure over their arguments; `rules` and `brief` write nothing).
// The pinned current-version fixture, CLAUDE.md on disk, and init are in assert/execution-profile-emission.

import assert from "node:assert/strict";
import { emptyRecord, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

const RULES = new URL("../../lib/rules.mjs", import.meta.url).href;
const PROFILE = new URL("../../lib/execution-profile.mjs", import.meta.url).href;
const epic = (id, extra = {}) => ({ id, title: id, priority: "P1", status: "queued", role: "epic", lane: "claude-code", links: [], reconcileNeeded: false, ...extra });

const STATE = {
  reviewMode: "thorough",
  executionProfile: { verbosity: "verbose", model: { implement: { model: "sonnet", effort: "medium" } } },
  laneProfiles: { "claude-code": { review: "standard" } },
  epics: [],
};

unitTest("The rules block names lane overrides, the project values and the unchanged Current mode line", async () => {
  const { rulesBlock } = await import(RULES);
  const { profileContext } = await import(PROFILE);
  const block = rulesBlock(null, "thorough", [], "claude-code", profileContext(STATE));
  assert.match(block, /## Execution profile/);
  assert.match(block, /- review: thorough \(project\)/);
  assert.match(block, /Lane overrides:\n- claude-code: review standard/);
  assert.match(block, /most specific first: the epic's own value, else its lane's,\nelse the project's/);
  assert.match(block, /resolve the active epic's\nprofile and run that job's role on its `\{model, effort\}` where your platform lets you set them/);
  assert.match(block, /Where it does not, say so/);
  assert.match(block, /`quiet` — one completion message per epic; `verbose` — a message at each phase/);
  assert.match(block, /Current mode: \*\*thorough\*\*\./);
});

unitTest("the rules block with no lane override says so, and a caller with no profile still shows the defaults", async () => {
  const { rulesBlock } = await import(RULES);
  const { profileContext } = await import(PROFILE);
  assert.match(rulesBlock(null, "standard", [], "claude-code", profileContext({ epics: [] })), /Lane overrides: none\./);
  const bare = rulesBlock(null, "thorough");
  assert.match(bare, /- review: thorough \(project\)/, "the passed review mode is the project value when no profile is given");
  assert.match(bare, /Current mode: \*\*thorough\*\*\./);
});

unitTest("a stored invalid value never reaches the block", async () => {
  const { rulesBlock } = await import(RULES);
  const { profileContext } = await import(PROFILE);
  const s = { ...STATE, executionProfile: { verbosity: "loud" }, laneProfiles: { decision: { review: "max" } } };
  const block = rulesBlock(null, "thorough", [], "claude-code", profileContext(s));
  assert.doesNotMatch(block, /verbosity[^\n]*loud|ignored:/);
  assert.match(block, /Lane overrides: none\./);
  assert.match(block, /- verbosity: quiet \(default\)/);
});

unitTest("rules --epic emits the effective value with its source", () => {
  const engine = memoryEngine({ ...emptyRecord(), reviewMode: "thorough",
    epics: [epic("e", { model: { implement: { model: "sonnet", effort: "medium" } }, reviewMode: "standard" })] });
  const out = engine(["rules", "--epic", "e"]);
  assert.match(out, /Effective values for epic `e`:/);
  assert.match(out, /implement: sonnet \(medium\) \(epic\)/);
  assert.match(out, /- review: standard \(epic\) — overrides project thorough/);
  assert.match(out, /Current mode: \*\*standard\*\*\./);
  assert.match(engine(["rules"]), /Project values:/, "and without --epic the project scope");
});

unitTest("rules --epic for an unknown epic falls back to the project scope", () => {
  const engine = memoryEngine({ ...emptyRecord(), reviewMode: "thorough" });
  assert.match(engine(["rules", "--epic", "nope"]), /Project values:/);
});

unitTest("the brief names the active epic's effective profile, and a model line only for a non-default role", () => {
  const engine = memoryEngine({ ...emptyRecord(), reviewMode: "standard", active: "e",
    executionProfile: { model: { implement: { model: "opus", effort: "medium" } } },
    epics: [epic("e", { status: "active", reviewMode: "thorough" })] });
  const brief = JSON.parse(engine(["brief"])).hookSpecificOutput.additionalContext;
  assert.match(brief, /\n {2}review: thorough \(epic\)/);
  assert.match(brief, /\n {2}verbosity: quiet \(default\)/);
  assert.match(brief, /\n {2}model: implement opus \(medium\) \(project\)/);
  assert.doesNotMatch(brief, /model: (test|review)/, "a role at the default gets no line");
});

unitTest("the brief carries no profile lines when there is no active epic", () => {
  const engine = memoryEngine({ ...emptyRecord(), epics: [epic("e")] });
  const brief = JSON.parse(engine(["brief"])).hookSpecificOutput.additionalContext;
  assert.doesNotMatch(brief, /verbosity: quiet/);
});
