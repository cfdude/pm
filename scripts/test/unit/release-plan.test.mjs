// scripts/test/unit/release-plan.test.mjs
// project-boards 3.1 (spec release-planning): the release's plan fields, the derived status, the "we are here"
// marker, and where each is shown (`release show`, the `/pm:status` verb). UNIT rung over an in-memory record.

import assert from "node:assert/strict";
import { expectFail, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

const epic = (id, over = {}) => ({
  id, title: `Title of ${id}`, priority: "P2", status: "queued", role: "epic", lane: "claude-code",
  stories: [], links: [], ...over,
});
const rel = (id, over = {}) => ({ id, intent: `intent of ${id}`, deferred: [], ...over });
const record = (epics = [], releases = [], over = {}) =>
  ({ version: 1, revision: 1, active: null, detourStack: [], epics, releases, ...over });
const board = (engine) => JSON.parse(engine(["board", "--json"]));
const relOf = (engine, id) => board(engine).releases.find(r => r.id === id);
const stateOf = (engine) => JSON.stringify(engine.store.record());
const refused = (engine, args, re) => {
  const before = stateOf(engine);
  const r = engine.result(args);
  assert.notEqual(r.status, 0, args.join(" "));
  assert.match(r.stderr, re);
  assert.equal(stateOf(engine), before, "nothing was written");
};

unitTest("plan fields: set on create and amend, read back through release show and board --json", () => {
  const engine = memoryEngine(record());
  engine(["release", "r1", "--intent", "stabilize the API", "--theme", "Lock the API", "--order", "1", "--size", "minor", "--exit", "contract tests pass", "--rationale", "why"]);
  const r = relOf(engine, "r1");
  assert.deepEqual([r.theme, r.order, r.size, r.exit, r.rationale], ["Lock the API", 1, "minor", "contract tests pass", "why"]);
  const shown = engine(["release", "show", "r1"]);
  assert.match(shown, /Lock the API/);
  assert.match(shown, /contract tests pass/);
  assert.match(shown, /order 1/);
  assert.match(shown, /minor/);
  engine(["release", "r1", "--theme", "A new theme", "--order", "0"]);
  assert.deepEqual([relOf(engine, "r1").theme, relOf(engine, "r1").order], ["A new theme", 0]);
  assert.equal(relOf(engine, "r1").intent, "stabilize the API", "intent is untouched");
});

unitTest("plan fields: bad values are refused with the accepted values named, writing nothing", () => {
  const engine = memoryEngine(record([], [rel("r1")]));
  refused(engine, ["release", "r1", "--size", "huge"], /major\|minor\|patch/);
  refused(engine, ["release", "r1", "--order", "-1"], /a non-negative integer/);
  refused(engine, ["release", "r1", "--order", "1.5"], /a non-negative integer/);
  refused(engine, ["release", "r1", "--order", "abc"], /a non-negative integer/);
  refused(engine, ["release", "r1", "--theme", "a\nb"], /theme.*one line/);
  refused(engine, ["release", "r1", "--theme", "x".repeat(401)], /theme.*400/);
  refused(engine, ["release", "r1", "--exit", ""], /--exit/);
  refused(engine, ["release", "r1", "--rationale", "a\nb"], /rationale.*one line/);
});

unitTest("plan fields: 400 characters is accepted", () => {
  const engine = memoryEngine(record([], [rel("r1")]));
  engine(["release", "r1", "--theme", "x".repeat(400)]);
  assert.equal(relOf(engine, "r1").theme.length, 400);
});

unitTest("plan fields: --clear removes each field and leaves the others; clearing an absent field is a reported no-op", () => {
  const engine = memoryEngine(record([], [rel("r1", { theme: "t", rationale: "r", exit: "e", order: 2, size: "major" })]));
  engine(["release", "r1", "--clear", "theme"]);
  assert.equal(relOf(engine, "r1").theme, null);
  assert.equal(relOf(engine, "r1").rationale, "r");
  engine(["release", "r1", "--clear", "rationale", "--clear", "exit", "--clear", "order", "--clear", "size"]);
  const r = relOf(engine, "r1");
  assert.deepEqual([r.rationale, r.exit, r.order, r.size], [null, null, null, null]);
  const again = engine.result(["release", "r1", "--clear", "theme"]);
  assert.equal(again.status, 0);
  assert.match(again.stderr, /theme.*(not set|nothing to clear|no-op)/i);
});

unitTest("plan fields: --clear naming another field is refused naming the clearable ones", () => {
  const engine = memoryEngine(record([], [rel("r1")]));
  refused(engine, ["release", "r1", "--clear", "intent"], /theme.*rationale.*exit.*order.*size/);
  refused(engine, ["release", "r1", "--theme", "x", "--clear", "theme"], /contradict/);
});

unitTest("plan fields: --status is an unknown flag", () => {
  const engine = memoryEngine(record([], [rel("r1")]));
  refused(engine, ["release", "r1", "--status", "shipped"], /unknown flag --status/);
});

unitTest("status: derived from delivery and members, never stored", () => {
  const status = (epics, r) => relOf(memoryEngine(record(epics, [r])), "r1").status;
  assert.equal(status([epic("a", { release: "r1" })], rel("r1", { delivered: { recordedAt: "2026-11-01T00:00:00Z" } })), "shipped");
  assert.equal(status([epic("a", { release: "r1", status: "active" })], rel("r1")), "in-progress");
  assert.equal(status([epic("a", { release: "r1", status: "paused" })], rel("r1")), "in-progress");
  assert.equal(status([epic("a", { release: "r1", status: "archived", disposition: { outcome: "delivered", recordedAt: "t", recordedBy: "agent" } })], rel("r1")), "in-progress");
  assert.equal(status([], rel("r1")), "planned");
  assert.equal(status([epic("a", { release: "r1" })], rel("r1")), "planned");
});

unitTest("status: --undeliver returns it to what the members imply", () => {
  const engine = memoryEngine(record([epic("a", { release: "r1" })], [rel("r1")]));
  engine(["release", "r1", "--deliver"]);
  assert.equal(relOf(engine, "r1").status, "shipped");
  engine(["release", "r1", "--undeliver"]);
  assert.equal(relOf(engine, "r1").status, "planned");
});

unitTest("here: sets the marker and the two lines, and --clear-here (valueless) removes all three", () => {
  const engine = memoryEngine(record([], [rel("r1"), rel("r2")]));
  engine(["release", "here", "r2", "--text", "Hardening the API", "--next", "Cut r2"]);
  assert.deepEqual(board(engine).plan, { here: "r2", hereText: "Hardening the API", nextText: "Cut r2" });
  engine(["release", "here", "--clear-here"]);
  assert.deepEqual(board(engine).plan, { here: null, hereText: null, nextText: null });
  const again = engine.result(["release", "here", "--clear-here"]);
  assert.equal(again.status, 0, "clearing an absent marker is a no-op");
});

unitTest("here: setting it again replaces the marker, and a --text line goes when the marker moves without one", () => {
  const engine = memoryEngine(record([], [rel("r1"), rel("r2")]));
  engine(["release", "here", "r1", "--text", "old"]);
  engine(["release", "here", "r2"]);
  assert.deepEqual([board(engine).plan.here, board(engine).plan.hereText], ["r2", null]);
});

unitTest("here: an unknown release id is refused, and `here` cannot be created as a release", () => {
  const engine = memoryEngine(record([], [rel("r1")]));
  refused(engine, ["release", "here", "nope"], /nope/);
  refused(engine, ["release", "here", "--intent", "x"], /reserved/);
  refused(engine, ["release", "here", "r1", "--intent", "x"], /--text.*--next.*--clear-here/);
  refused(engine, ["release", "here", "r1", "--clear-here"], /--clear-here takes no id/);
  refused(engine, ["release", "here", "--text", "x"], /release id/);
  refused(engine, ["release", "here", "r1", "--text", "a\nb"], /one line/);
  refused(engine, ["release", "here", "r1", "--text", "x".repeat(201)], /200/);
  refused(engine, ["release", "here"], /usage|release id/i);
});

unitTest("here: a marker naming a removed release reads null and is reported", () => {
  const s = board(memoryEngine(record([], [rel("r1")], { releasePlan: { here: "r9" } })));
  assert.equal(s.plan.here, null);
  assert.deepEqual(s.rejected, [{ kind: "plan", id: null, field: "plan.here", value: "r9", reason: "here names no release" }]);
});

const mission = (milestoneRelease) => ({ current: { statement: "m", setAt: "t", reason: "r" }, history: [], milestoneRelease, criteria: [], nextCriterion: 1 });

unitTest("show: one release prints theme, order, the derived status and (here)", () => {
  const engine = memoryEngine(record([], [rel("r1", { theme: "Lock the API", order: 1 })], { releasePlan: { here: "r1" } }));
  const out = engine(["release", "show", "r1"]);
  assert.match(out, /Lock the API/);
  assert.match(out, /order 1/);
  assert.match(out, /planned/);
  assert.match(out, /\(here\)/);
});

unitTest("show: critical-path marks appear on one release and in the list, only when a milestone gives them meaning", () => {
  const releases = [rel("r1", { order: 1 }), rel("r2", { order: 2 }), rel("r3", { order: 3 })];
  const withMilestone = memoryEngine(record([], releases, { mission: mission("r2") }));
  assert.match(withMilestone(["release", "show", "r2"]), /\(critical path\)/);
  assert.match(withMilestone(["release", "show", "r3"]), /\(off critical path\)/);
  const list = withMilestone(["release", "show"]);
  assert.match(list.split("\n").find(l => l.includes("`r2`")), /\(critical path\)/);
  assert.match(list.split("\n").find(l => l.includes("`r3`")), /\(off critical path\)/);
  assert.match(list.split("\n").find(l => l.includes("`r1`")), /order 1/);
  const none = memoryEngine(record([], releases));
  assert.doesNotMatch(none(["release", "show", "r2"]), /critical path/);
});

unitTest("status verb: prints here: and the critical-path marks from its own output, and neither is in PROJECT.md", () => {
  const releases = [rel("r1", { order: 1 }), rel("r2", { order: 2 }), rel("r3", { order: 3 })];
  const engine = memoryEngine(record([], releases, { mission: mission("r2"), releasePlan: { here: "r2", hereText: "Hardening the API" } }));
  const out = engine(["render"]);
  assert.match(out, /here: r2/);
  assert.match(out, /Hardening the API/);
  assert.match(out, /r1.*\(critical path\)/);
  assert.match(out, /r2.*\(critical path\)/);
  assert.match(out, /r3.*\(off critical path\)/);
  const md = engine.store.read("PROJECT.md").text;
  assert.doesNotMatch(md, /here: r2/);
  assert.doesNotMatch(md, /critical path/);
});

unitTest("status verb: a milestone release with no order marks nothing", () => {
  const engine = memoryEngine(record([], [rel("r1"), rel("r2", { order: 2 })], { mission: mission("r1") }));
  assert.doesNotMatch(engine(["render"]), /critical path/);
});

unitTest("status verb: no marker and no milestone prints neither", () => {
  const out = memoryEngine(record([], [rel("r1", { order: 1 })]))(["render"]);
  assert.doesNotMatch(out, /here:|critical path/);
});

unitTest("here: the brief's release lines carry neither mark", () => {
  const engine = memoryEngine(record([], [rel("r1", { order: 1 })], { mission: mission("r1"), releasePlan: { here: "r1" } }));
  const brief = engine(["brief"]);
  assert.doesNotMatch(brief, /critical path|here: r1/);
});

unitTest("here: no existing release is named here, and the flag surface is unchanged for release show", () => {
  expectFail(() => memoryEngine(record([], [rel("r1")]))(["release", "show", "--theme", "x"]));
});

unitTest("here: --text, --next and --clear-here are refused on a plain release amendment, naming `release here`", () => {
  const engine = memoryEngine(record([], [rel("r1")]));
  refused(engine, ["release", "r1", "--text", "x"], /release here r1 --text/);
  refused(engine, ["release", "r1", "--next", "x"], /release here r1 --text/);
  refused(engine, ["release", "r1", "--clear-here"], /release here r1 --text/);
  refused(engine, ["release", "r1", "--intent", "y", "--text", "x"], /release here r1 --text/);
});

// project-boards 8.5: the verbs that write each field the boards read are discoverable from `--help` and from the missing-id usage.
unitTest("discoverability: `release --help` names `release here`, the plan fields and the clear inverse", () => {
  const help = memoryEngine(record())(["release", "--help"]);
  for (const needle of ["release here <id>", "--text", "--next", "--clear-here", "--theme", "--rationale", "--exit", "--order", "--size", "--clear <field>"]) {
    assert.ok(help.includes(needle), `release --help names ${needle}`);
  }
  assert.match(help, /theme, rationale, exit, order, size and target/, "the clearable fields are listed");
  assert.match(help, /release show \[<id>\]/);
});

unitTest("discoverability: the missing-id usage names `release here` and the plan flags", () => {
  const r = memoryEngine(record()).result(["release"]);
  assert.notEqual(r.status, 0);
  for (const needle of ["release here <id>", "--theme", "--order", "--size", "--clear <field>"]) {
    assert.ok(r.stderr.includes(needle), `the usage names ${needle}`);
  }
});

unitTest("target: `--clear target` is the inverse of `--target`, refuses to contradict it, and says when there was nothing to clear", () => {
  const engine = memoryEngine(record([], [rel("r1", { target: "2026-12-01" })]));
  engine(["release", "r1", "--clear", "target"]);
  assert.equal("target" in engine.store.record().releases[0], false);
  assert.equal(relOf(engine, "r1").target, null);
  assert.match(engine.combined(["release", "r1", "--clear", "target"]), /no target set/);
  refused(engine, ["release", "r1", "--target", "x", "--clear", "target"], /contradicts --target/);
  refused(engine, ["release", "r1", "--clear", "intent"], /Clearable fields: theme, rationale, exit, order, size, target/);
});
