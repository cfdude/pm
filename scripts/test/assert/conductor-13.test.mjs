// scripts/test/assert/conductor-13.test.mjs
// 5.3's ASSERTION TWIN of scripts/test/functional/conductor-13.test.mjs — same id, same subject.
//
// THE FUNCTIONAL FILE'S SUBJECT is the FLAG REGISTRY (every flag a verb reads is declared exactly
// once), the DISPOSITION record (how an epic ended, who recorded it, and what that turns off), and
// the LIFECYCLE task count (a `<!-- pm:lifecycle -->`-marked task leaves both the numerator and the
// denominator). All three are state.json, argv and files — no git — so this twin carries the
// behavioural core and belongs on the per-commit path.
//
// THE REGISTRY IS THE ONE PLACE A FLAG CAN BE READ BUT NOT DECLARED, and the failure is silent: the
// verb works, and the flag is invisible to every help surface and every guard built on the registry.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, runCombined, readState, writeState, expectFail, projectMd, parseBrief } from "../fixtures/assert-harness.mjs";
import { UPDATE_EPIC_FLAGS } from "../../lib/update-epic.mjs";
import { AGENT_OUTCOMES } from "../../lib/archive-gate.mjs";
import { KNOWN_OUTCOMES } from "../../lib/disposition.mjs";

const repo = () => { const cwd = tmpRepo(); run(["init"], { cwd }); return cwd; };
const stateBytes = (cwd) => fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");

// ─────────────────── the registry ───────────────────

test("every registry entry names a flag, and the projection is not a literal that happens to match", () => {
  // The projection is read off the registry, so a flag added there appears here without an edit.
  assert.ok(UPDATE_EPIC_FLAGS.length > 20, `the projection is broken — only ${UPDATE_EPIC_FLAGS.length} flags`);
  for (const flag of UPDATE_EPIC_FLAGS) assert.equal(typeof flag, "string");
  assert.equal(new Set(UPDATE_EPIC_FLAGS).size, UPDATE_EPIC_FLAGS.length,
    "no (command, flag) pair is governed by two rows");
});

test("update-epic still names the offending flag AND the flags it does support", () => {
  const cwd = repo();
  run(["add-epic", "--id", "e1", "--lane", "claude-code"], { cwd });
  const err = expectFail(() => run(["update-epic", "e1", "--titel", "x"], { cwd }));
  const text = String(err.stderr || "");
  assert.match(text, /titel/, "it names the offending flag");
  assert.match(text, /--priority|--status/, "and the ones it does support, so the reader can correct it");
});

test("add-epic rejects an unsupported flag by name and writes nothing (#79)", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  const before = stateBytes(cwd);
  const err = expectFail(() => run(["add-epic", "--id", "e1", "--title", "t", "--lane", "claude-code",
    "--recorded-by", "me"], { cwd }));
  assert.match(String(err.stderr || ""), /recorded-by/);
  assert.equal(stateBytes(cwd), before);
});

test("add-many rejects an unpersisted batch key by name and creates ZERO epics", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  const batch = path.join(cwd, "batch.json");
  fs.writeFileSync(batch, JSON.stringify({ epics: [{ id: "b1", title: "t", lane: "claude-code", nonsense: 1 }] }));
  assert.ok(expectFail(() => run(["add-many", "--from", batch], { cwd })));
  assert.deepEqual(readState(cwd).epics, [], "a partial batch is not a batch");
});

// ─────────────────── the disposition record ───────────────────

test("an agent-supplied disposition that is not `delivered` is rejected without a reason", () => {
  const cwd = repo();
  run(["add-epic", "--id", "e1", "--lane", "claude-code"], { cwd });
  const err = expectFail(() => run(["update-epic", "e1", "--status", "archived", "--outcome", "killed", "--no-deferrals"], { cwd }));
  assert.match(String(err.stderr || ""), /requires a non-empty reason/);
  assert.match(String(err.stderr || ""), /only 'delivered' may omit one/);
});

test("`delivered` needs no reason, and an agent's record carries no recordedBy", () => {
  const cwd = repo();
  run(["add-epic", "--id", "e1", "--lane", "claude-code"], { cwd });
  run(["update-epic", "e1", "--status", "archived", "--outcome", "delivered", "--no-deferrals"], { cwd });
  const d = readState(cwd).epics.find(e => e.id === "e1").disposition;
  assert.equal(d.outcome, "delivered");
  assert.equal(d.recordedBy, undefined, "the agent's own record carries no engine stamp");
});

test("an outcome outside the vocabulary is rejected by name", () => {
  const cwd = repo();
  run(["add-epic", "--id", "e1", "--lane", "claude-code"], { cwd });
  const err = expectFail(() => run(["update-epic", "e1", "--status", "archived", "--outcome", "finished", "--no-deferrals"], { cwd }));
  const text = String(err.stderr || "");
  for (const o of AGENT_OUTCOMES) assert.ok(text.includes(o), `the refusal names ${o}`);
});

test("the outcome vocabulary and the engine-stamp token set are each exactly what the release defines", () => {
  assert.ok(Array.isArray(AGENT_OUTCOMES) && AGENT_OUTCOMES.includes("delivered"));
  const engineOnly = KNOWN_OUTCOMES.filter(o => !AGENT_OUTCOMES.includes(o));
  assert.deepEqual(engineOnly, ["unknown"],
    "exactly one token is the engine's: an engine stamp is never something an agent may claim");
});

test("outcomeOf is the reader — an epic with no disposition reads `unknown`", () => {
  const cwd = repo();
  run(["add-epic", "--id", "e1", "--lane", "claude-code"], { cwd });
  const out = runCombined(["status"], { cwd });
  assert.ok(typeof out === "string");
  assert.equal(readState(cwd).epics.find(e => e.id === "e1").disposition, undefined);
});

test("a recorded disposition renders in PROJECT.md and the brief from state.json alone", () => {
  const cwd = repo();
  run(["add-epic", "--id", "e1", "--lane", "claude-code"], { cwd });
  run(["update-epic", "e1", "--status", "archived", "--outcome", "killed",
    "--reason", "superseded by the rewrite", "--no-deferrals"], { cwd });
  run(["render"], { cwd });
  assert.match(projectMd(cwd), /superseded by the rewrite/);
  assert.match(parseBrief(cwd), /superseded by the rewrite/);
});

test("an engine `unknown` stamp with no reason adds no disposition row", () => {
  const cwd = repo();
  writeState(cwd, { version: 1, active: null, detourStack: [], epics: [{
    id: "e1", title: "t", priority: "P1", status: "archived", role: "epic", lane: "claude-code",
    links: [], disposition: { outcome: "unknown", recordedBy: "heal" } }] });
  run(["render"], { cwd });
  const md = projectMd(cwd);
  assert.doesNotMatch(md, /`unknown`/, "an engine stamp nobody was asked about is not a decision to render");
});

// ─────────────────── the archive gate is a value, not an exit ───────────────────

test("the archive gate returns a refusal OBJECT and never exits the process itself", async () => {
  // Driven, not scanned: the gate is CALLED with a record it must refuse, and the refusal comes
  // back as a value. A function that exited would end this process and the assertion would never run.
  const { archiveGate } = await import("../../lib/archive-gate.mjs");
  const out = archiveGate({ id: "e1", title: "t", status: "queued", lane: "openspec", links: [] },
    { outcome: "finished" });
  assert.equal(out.ok, false);
  assert.match(String(out.message), /not one of/);
});

test("the gate is reachable from update-epic, refusal text intact", () => {
  const cwd = repo();
  run(["add-epic", "--id", "e1", "--lane", "openspec"], { cwd });
  const err = expectFail(() => run(["update-epic", "e1", "--status", "archived",
    "--outcome", "delivered", "--no-deferrals"], { cwd }));
  assert.match(String(err.stderr || ""), /Gate 2|gate/i);
});

test("update-epic holds no openspec-lane archive condition of its own", () => {
  // The gate owns the rule; a second copy in the verb is how the two drift apart.
  const src = fs.readFileSync(new URL("../../lib/update-epic.mjs", import.meta.url), "utf8");
  assert.match(src, /archiveGate\(/, "the verb calls the gate");
});

// ─────────────────── the lifecycle task count ───────────────────

/** An openspec change whose tasks.md holds `body`. */
function changeWithTasks(cwd, body, id = "feat-x") {
  const dir = path.join(cwd, "openspec", "changes", id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "tasks.md"), body);
  return dir;
}

test("a declared lifecycle task leaves BOTH numerator and denominator", () => {
  const cwd = repo();
  run(["add-epic", "--id", "feat-x", "--title", "t", "--lane", "openspec"], { cwd });
  changeWithTasks(cwd, [
    "- [x] 1.1 do the thing",
    "- [ ] 1.2 <!-- pm:lifecycle --> Archive — /opsx:archive feat-x",
  ].join("\n") + "\n");
  run(["render"], { cwd });
  // One task counted, one ticked, and the marked line reported as its OWN count: the lifecycle
  // task leaves the numerator and the denominator TOGETHER, and the render says how many it left.
  assert.match(projectMd(cwd), /1\/1 stories · 1 lifecycle/);
});

test("a marked task is excluded whether or not it is ticked", () => {
  const cwd = repo();
  run(["add-epic", "--id", "feat-x", "--title", "t", "--lane", "openspec"], { cwd });
  changeWithTasks(cwd, [
    "- [x] 1.1 one",
    "- [x] 1.2 two <!-- pm:lifecycle --> Archive",
  ].join("\n") + "\n");
  run(["render"], { cwd });
  assert.match(projectMd(cwd), /1\/1 stories · 1 lifecycle/,
    "a marked task is excluded whether or not it is ticked");
});

test("the marker is read on the task LINE — never on a following line, never by position", () => {
  const cwd = repo();
  run(["add-epic", "--id", "feat-x", "--title", "t", "--lane", "openspec"], { cwd });
  changeWithTasks(cwd, [
    "- [ ] 1.1 an undeclared task",
    "<!-- pm:lifecycle --> on its own line",
  ].join("\n") + "\n");
  run(["render"], { cwd });
  const row = projectMd(cwd).split("\n").find(l => l.includes("`feat-x`"));
  assert.match(row, /0\/1 stories/, "a marker on its own line belongs to no task");
  assert.doesNotMatch(row, /lifecycle/, "and it excludes nothing");
});

test("an UNDECLARED task is counted however it is worded", () => {
  const cwd = repo();
  run(["add-epic", "--id", "feat-x", "--title", "t", "--lane", "openspec"], { cwd });
  changeWithTasks(cwd, [
    "- [ ] Archive the change",
    "- [ ] anything at all",
  ].join("\n") + "\n");
  run(["render"], { cwd });
  assert.match(projectMd(cwd), /0\/2 stories/);
});

test("a source whose every task is excluded is still a SOURCE — no missing-source warning", () => {
  const cwd = repo();
  run(["add-epic", "--id", "feat-x", "--title", "t", "--lane", "openspec"], { cwd });
  changeWithTasks(cwd, "- [ ] 1.1 <!-- pm:lifecycle --> Archive\n");
  run(["render"], { cwd });
  const md = projectMd(cwd);
  assert.doesNotMatch(md, /no change on disk/, "an all-excluded source is a source, not a ghost");
});

test("a task that merely DOCUMENTS the marker is not excluded by it", () => {
  const cwd = repo();
  run(["add-epic", "--id", "feat-x", "--title", "t", "--lane", "openspec"], { cwd });
  changeWithTasks(cwd, "- [ ] 1.1 write about the `<!-- pm:lifecycle -->` marker\n");
  run(["render"], { cwd });
  const row = projectMd(cwd).split("\n").find(l => l.includes("`feat-x`"));
  assert.match(row, /0\/1 stories/, "documenting the marker is not declaring it");
  assert.doesNotMatch(row, /lifecycle/);
});

// ───────────────────────── the deliberate omissions ─────────────────────────
//
// "the registry's update-epic projection still accepts every 0.26.0 UPDATE_EPIC_FLAGS entry" and the
// two 0.26.0 round-trip sweeps replay a FIXTURE read from the repository's own history; "no module
// under scripts/lib/ reads .outcome or .recordedBy off an epic" and "no module decides openspec-lane
// membership with a strict comparison" are source sweeps whose population is the whole tree. All are
// functional-only by subject (design D5), and the RULES they protect are asserted above.
