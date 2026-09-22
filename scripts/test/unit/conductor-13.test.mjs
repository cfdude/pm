// scripts/test/unit/conductor-13.test.mjs
// 4.1's migration of `assert/conductor-13.test.mjs` — 12 of its 20 tests, moved from the file rung to
// the unit rung with every assertion unchanged.
//
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
//
// ─────────────── WHAT MOVED, AND WHAT DID NOT ───────────────
//
// TWELVE moved: the two registry tests, the two unknown-flag refusals, the whole disposition family
// (six tests), and both archive-gate-as-a-value tests.
//
// EIGHT STAY, on three of the four seam edges:
//   * SIX lifecycle tests, one population: `changeWithTasks()` writes
//     `openspec/changes/feat-x/tasks.md` — the file the task count is READ FROM, so the fixture has to
//     put it on disk. That is the rule as written;
//   * `add-many rejects an unpersisted batch key` — a batch FILE;
//   * `update-epic holds no openspec-lane archive condition of its own` — reads `lib/update-epic.mjs`
//     and asserts its call site, with comment-only lines stripped. `conductor-13`'s indexOf/`match`
//     bound is one of the source-shape guards 4.1 names by hand, and it stays where its subject is.
//
// The mechanism that changed:
//
//   `tmpRepo()` + `run(["init"], { cwd })`  →  `memoryEngine(emptyRecord())`
//   `writeState(cwd, wholeRecord)`          →  a `memoryEngine(wholeRecord)` seed
//   `run(args, { cwd })`                    →  `engine(args)`
//   `runCombined(args, { cwd })`            →  `engine.combined(args)`
//   `readState(cwd)`                        →  `engine.store.record()`
//   `projectMd(cwd)` / `parseBrief(cwd)`    →  `store.read("PROJECT.md").text` / the `brief` verb's stdout

import assert from "node:assert/strict";
import { emptyRecord, expectFail, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";
import { UPDATE_EPIC_FLAGS } from "../../lib/update-epic.mjs";
import { AGENT_OUTCOMES } from "../../lib/archive-gate.mjs";
import { KNOWN_OUTCOMES } from "../../lib/disposition.mjs";

const readState = (engine) => engine.store.record();

/** The file rung's `writeState(cwd, wholeRecord)`, for a fixture that INSTALLS a record built in the
 *  test: replace what the store holds, with no verb in the chain and therefore no revision guard. */
function install(engine, obj) {
  const s = engine.store.record();
  for (const k of Object.keys(s)) delete s[k];
  Object.assign(s, obj);
}
const projectMd = (engine) => engine.store.read("PROJECT.md").text;
const parseBrief = (engine) =>
  JSON.parse(engine(["brief"])).hookSpecificOutput.additionalContext;

/** An initialized conductor. */
const repo = () => memoryEngine(emptyRecord());

unitTest("every registry entry names a flag, and the projection is not a literal that happens to match", () => {
  // The projection is read off the registry, so a flag added there appears here without an edit.
  assert.ok(UPDATE_EPIC_FLAGS.length > 20, `the projection is broken — only ${UPDATE_EPIC_FLAGS.length} flags`);
  for (const flag of UPDATE_EPIC_FLAGS) assert.equal(typeof flag, "string");
  assert.equal(new Set(UPDATE_EPIC_FLAGS).size, UPDATE_EPIC_FLAGS.length,
    "no (command, flag) pair is governed by two rows");
});
unitTest("update-epic still names the offending flag AND the flags it does support", () => {
  const engine = repo();
  engine(["add-epic", "--id", "e1", "--lane", "claude-code"]);
  const err = expectFail(() => engine(["update-epic", "e1", "--titel", "x"]));
  const text = String(err.stderr || "");
  assert.match(text, /titel/, "it names the offending flag");
  assert.match(text, /--priority|--status/, "and the ones it does support, so the reader can correct it");
});
unitTest("add-epic rejects an unsupported flag by name and writes nothing (#79)", () => {
  const engine = repo();
  const before = engine.store.read("state.json").text;
  const err = expectFail(() => engine(["add-epic", "--id", "e1", "--title", "t", "--lane", "claude-code",
    "--recorded-by", "me"]));
  assert.match(String(err.stderr || ""), /recorded-by/);
  assert.equal(engine.store.read("state.json").text, before);
});
unitTest("an agent-supplied disposition that is not `delivered` is rejected without a reason", () => {
  const engine = repo();
  engine(["add-epic", "--id", "e1", "--lane", "claude-code"]);
  const err = expectFail(() => engine(["update-epic", "e1", "--status", "archived", "--outcome", "killed", "--no-deferrals"]));
  assert.match(String(err.stderr || ""), /requires a non-empty reason/);
  assert.match(String(err.stderr || ""), /only 'delivered' may omit one/);
});
unitTest("`delivered` needs no reason, and an agent's record carries no recordedBy", () => {
  const engine = repo();
  engine(["add-epic", "--id", "e1", "--lane", "claude-code"]);
  engine(["update-epic", "e1", "--status", "archived", "--outcome", "delivered", "--no-deferrals"]);
  const d = readState(engine).epics.find(e => e.id === "e1").disposition;
  assert.equal(d.outcome, "delivered");
  assert.equal(d.recordedBy, undefined, "the agent's own record carries no engine stamp");
});
unitTest("an outcome outside the vocabulary is rejected by name", () => {
  const engine = repo();
  engine(["add-epic", "--id", "e1", "--lane", "claude-code"]);
  const err = expectFail(() => engine(["update-epic", "e1", "--status", "archived", "--outcome", "finished", "--no-deferrals"]));
  const text = String(err.stderr || "");
  for (const o of AGENT_OUTCOMES) assert.ok(text.includes(o), `the refusal names ${o}`);
});
unitTest("the outcome vocabulary and the engine-stamp token set are each exactly what the release defines", () => {
  assert.ok(Array.isArray(AGENT_OUTCOMES) && AGENT_OUTCOMES.includes("delivered"));
  const engineOnly = KNOWN_OUTCOMES.filter(o => !AGENT_OUTCOMES.includes(o));
  assert.deepEqual(engineOnly, ["unknown"],
    "exactly one token is the engine's: an engine stamp is never something an agent may claim");
});
unitTest("outcomeOf is the reader — an epic with no disposition reads `unknown`", () => {
  const engine = repo();
  engine(["add-epic", "--id", "e1", "--lane", "claude-code"]);
  const out = engine.combined(["status"]);
  assert.ok(typeof out === "string");
  assert.equal(readState(engine).epics.find(e => e.id === "e1").disposition, undefined);
});
unitTest("a recorded disposition renders in PROJECT.md and the brief from state.json alone", () => {
  const engine = repo();
  engine(["add-epic", "--id", "e1", "--lane", "claude-code"]);
  engine(["update-epic", "e1", "--status", "archived", "--outcome", "killed",
    "--reason", "superseded by the rewrite", "--no-deferrals"]);
  engine(["render"]);
  assert.match(projectMd(engine), /superseded by the rewrite/);
  assert.match(parseBrief(engine), /superseded by the rewrite/);
});
unitTest("an engine `unknown` stamp with no reason adds no disposition row", () => {
  const engine = repo();
  install(engine, { epics: [{
    id: "e1", title: "t", priority: "P1", status: "archived", role: "epic", lane: "claude-code",
    links: [], disposition: { outcome: "unknown", recordedBy: "heal" } }] });
  engine(["render"]);
  const md = projectMd(engine);
  assert.doesNotMatch(md, /`unknown`/, "an engine stamp nobody was asked about is not a decision to render");
});

// ─────────────────── the archive gate is a value, not an exit ───────────────────
unitTest("the archive gate returns a refusal OBJECT and never exits the process itself", async () => {
  // Driven, not scanned: the gate is CALLED with a record it must refuse, and the refusal comes
  // back as a value. A function that exited would end this process and the assertion would never run.
  const { archiveGate } = await import("../../lib/archive-gate.mjs");
  const out = archiveGate({ id: "e1", title: "t", status: "queued", lane: "openspec", links: [] },
    { outcome: "finished" });
  assert.equal(out.ok, false);
  assert.match(String(out.message), /not one of/);
});
unitTest("the gate is reachable from update-epic, refusal text intact", () => {
  const engine = repo();
  engine(["add-epic", "--id", "e1", "--lane", "openspec"]);
  const err = expectFail(() => engine(["update-epic", "e1", "--status", "archived",
    "--outcome", "delivered", "--no-deferrals"]));
  assert.match(String(err.stderr || ""), /Gate 2|gate/i);
});
