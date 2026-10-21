// scripts/test/unit/log-detour-sha.test.mjs
// gh-cfdude-pm-239 -- the assertion twin of scripts/test/functional/log-detour-sha.test.mjs (same id).
// The unit rung has no repository: HEAD answers nothing, so what it owns is the refusals, the
// retraction's matching over seeded rows, and the inverse's bookkeeping (the row stays in the log).

import assert from "node:assert/strict";
import { emptyRecord, expectFail, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";
import { visibleDetourRows } from "../../lib/git.mjs";

const SHA = "abcdef1234";
const row = (when, sha, kind, epic, note, target) =>
  [when, sha, kind, epic, note, ...(target ? [target] : [])].join("\t") + "\n";
const log = (engine) => (engine.store.exists("detours.log") ? engine.store.read("detours.log").text : "");
const seeded = () => {
  const engine = memoryEngine(emptyRecord());
  engine.store.append("detours.log", row("2026-09-30T06:00:00.000Z", SHA, "MINIMAL", "-", "the right row"));
  engine.store.append("detours.log", row("2026-09-30T06:30:40.000Z", SHA, "MINIMAL", "-", "the wrong row"));
  return engine;
};

unitTest("239: log-detour --sha naming no commit is refused and writes nothing", () => {
  const engine = memoryEngine(emptyRecord());
  assert.match(expectFail(() => engine(["log-detour", "--sha", "deadbeef", "x"])).stderr, /names no commit in this repository/);
  assert.equal(log(engine), "");
});

unitTest("239: log-detour --sha with no value is refused", () => {
  const engine = memoryEngine(emptyRecord());
  assert.match(expectFail(() => engine(["log-detour", "x", "--sha"])).stderr, /--sha requires/);
});

unitTest("239: retract-detour --minimal hides exactly the named row and keeps both in the log", () => {
  const engine = seeded();
  engine(["retract-detour", SHA, "--minimal", "the wrong row", "--reason", "its commit never landed"]);
  const text = log(engine);
  assert.match(text, /the wrong row/, "the row is never removed");
  assert.match(text, /RETRACTED-MINIMAL\t-\tits commit never landed\t2026-09-30T06:30:40\.000Z/);
  const shown = visibleDetourRows(text.split("\n").filter(Boolean).map((raw) => {
    const [when, sha, kind, epic, note, target] = raw.split("\t");
    return { raw, when, sha, kind, epic, note, target };
  }));
  assert.deepEqual(shown.map(r => r.note), ["the right row"]);
});

unitTest("239: the same description retracts once; a second attempt finds nothing visible", () => {
  const engine = seeded();
  engine(["retract-detour", SHA, "--minimal", "the wrong row", "--reason", "r"]);
  const err = expectFail(() => engine(["retract-detour", SHA, "--minimal", "the wrong row", "--reason", "r"]));
  assert.match(err.stderr, /no visible MINIMAL row whose description is exactly "the wrong row"/);
});

unitTest("239: --minimal needs a reason, and an undeclared description writes nothing", () => {
  const engine = seeded();
  const before = log(engine);
  assert.match(expectFail(() => engine(["retract-detour", SHA, "--minimal", "the wrong row"])).stderr, /requires --reason/);
  assert.match(expectFail(() => engine(["retract-detour", SHA, "--minimal", "no such", "--reason", "r"])).stderr, /no visible MINIMAL row/);
  assert.equal(log(engine), before);
});

unitTest("239: a MINIMAL retraction does not hide the commit-derived rows of the same sha", () => {
  const engine = seeded();
  engine.store.append("detours.log", row("2026-09-30T06:10:00.000Z", SHA, "AUTO-DETOUR", "e1", "commit subject"));
  engine(["retract-detour", SHA, "--minimal", "the wrong row", "--reason", "r"]);
  const kinds = log(engine).split("\n").filter(Boolean).map(l => l.split("\t")[2]);
  assert.ok(kinds.includes("AUTO-DETOUR"));
  assert.ok(!kinds.includes("RETRACTED"), "the SHA-keyed retraction kind is not used, which would hide AUTO-DETOUR");
});
