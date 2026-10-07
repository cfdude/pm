// scripts/test/unit/flake-retry.test.mjs
// flaky-test-quarantine-and-targeted-rerun — the retry's decisions, as VALUES. Its functional twin is
// scripts/test/functional/flake-retry.test.mjs, which runs the real certify runner over a real fixture
// repository and reads the ledger bytes; this file holds every branch with the filesystem injected.

import assert from "node:assert/strict";
import { unitTest } from "../fixtures/unit-harness.mjs";

const load = () => import(new URL("../flake-retry.mjs", import.meta.url).href);
const CWD = "/run/tree";
const A = "scripts/test/functional/a.test.mjs";
const B = "scripts/test/functional/b.test.mjs";
const FILES = [`${CWD}/${A}`, `${CWD}/${B}`];
const NOW = () => new Date("2026-09-30T12:00:00.000Z");

/** A spec-reporter run's tail, in the exact shape Node prints it (`test at` is relative to the cwd). */
const specOutput = (failures, { tests = 10, fail = failures.length } = {}) =>
  `ℹ tests ${tests}\nℹ suites 0\nℹ pass ${tests - fail}\nℹ fail ${fail}\n\n✖ failing tests:\n\n` +
  failures.map(([file, name]) => `test at ${file}:5:1\n✖ ${name} (1.2ms)\n  AssertionError: x\n      at y\n`).join("\n");

/** An injected io: a known-flakes file and an append recorder. */
const fakeIo = (known) => {
  const appended = [];
  return {
    appended,
    readFileSync: () => { if (known === undefined) throw new Error("ENOENT"); return typeof known === "string" ? known : JSON.stringify(known); },
    appendFileSync: (p, text) => appended.push({ p, text }),
  };
};

const run = async (over) => {
  const { recoverFlakes } = await load();
  const reruns = [];
  const result = await recoverFlakes({
    output: specOutput([[A, "flaky one"]]), status: 1, cwd: CWD, files: FILES, ledgerRoot: "/repo", knownFile: "/k.json",
    realpath: (p) => p, now: NOW, load: () => 3.5,
    rerun: async (abs) => { reruns.push(abs); return { status: 0, output: "ℹ tests 1\nℹ pass 1\nℹ fail 0\n" }; },
    ...over,
  });
  return { result, reruns };
};

unitTest("failuresOf reads the failing tests out of the spec output and maps them to root-relative files", async () => {
  const { failuresOf } = await load();
  const r = failuresOf(specOutput([[A, "one"], [B, "two (with parens)"]]), { cwd: CWD, files: FILES, realpath: (p) => p });
  assert.deepEqual(r.failures, [{ file: A, test: "one" }, { file: B, test: "two (with parens)" }]);
  assert.equal(r.unmapped, 0);
});

unitTest("a failure in a file the runner was not given (a helper's path) is unmapped, and so is a listing that is absent", async () => {
  const { failuresOf } = await load();
  assert.equal(failuresOf(specOutput([["scripts/test/fixtures/unit-harness.mjs", "x"]]), { cwd: CWD, files: FILES, realpath: (p) => p }).unmapped, 1);
  assert.equal(failuresOf("ℹ tests 3\nℹ fail 1\n", { cwd: CWD, files: FILES, realpath: (p) => p }).unmapped, 1);
});

unitTest("a listed test that passes on retry recovers, is named a known flake, and the ledger gets one line", async () => {
  const io = fakeIo([{ file: A, test: "flaky", owningEpic: null, note: "n" }]);
  const { result, reruns } = await run({ io });
  assert.equal(result.recovered, true);
  assert.deepEqual(reruns, [[`${CWD}/${A}`]], "ONLY the failed file is run again, once");
  assert.match(result.messages.join("\n"), /known flake .*not to be diagnosed.*a\.test\.mjs — flaky one/);
  assert.doesNotMatch(result.messages.join("\n"), /UNLISTED/);
  assert.deepEqual(result.counts, { tests: 10, pass: 10, fail: 0 }, "the recovered run counts the failure as passing");
  assert.equal(io.appended.length, 1);
  assert.equal(io.appended[0].p, "/repo/.test-flakes.log");
  assert.deepEqual(JSON.parse(io.appended[0].text), {
    at: "2026-09-30T12:00:00.000Z", file: A, test: "flaky one", load1: 3.5, outcome: "passed-on-retry",
  });
});

unitTest("an unlisted test that passes on retry still recovers, but is named UNLISTED with its file and test", async () => {
  const { result } = await run({ io: fakeIo([{ file: B, test: "flaky one" }]) });
  assert.equal(result.recovered, true);
  assert.match(result.messages.join("\n"), new RegExp(`UNLISTED flake: ${A} flaky one`));
});

unitTest("a listing of the same test name in ANOTHER file does not make it known", async () => {
  const { isKnownFlake } = await load();
  assert.equal(isKnownFlake([{ file: B, test: "flaky" }], A, "flaky one"), false);
  assert.equal(isKnownFlake([{ file: A, test: "flaky" }], A, "flaky one"), true);
});

unitTest("a test that fails twice is a real failure, with its ledger line saying so", async () => {
  const io = fakeIo([]);
  const { result } = await run({
    io, rerun: async () => ({ status: 1, output: specOutput([[A, "flaky one"]]) }),
  });
  assert.equal(result.recovered, false);
  assert.match(result.messages.join("\n"), /failed twice: .*flaky one/);
  assert.equal(JSON.parse(io.appended[0].text).outcome, "failed-on-retry");
});

unitTest("a failed retry that lists nothing still counts every first-run failure as failing again", async () => {
  const io = fakeIo([]);
  const { result } = await run({ io, rerun: async () => ({ status: 1, output: "garbage" }) });
  assert.equal(result.recovered, false);
  assert.equal(JSON.parse(io.appended[0].text).outcome, "failed-on-retry");
});

unitTest("nothing is retried for a signal, an unreadable count, no failing test, or an unmappable failure", async () => {
  for (const over of [
    { status: null }, { status: 143 }, { status: 0 },
    { counts: { tests: null, pass: null, fail: null } },
    { counts: { tests: 5, pass: 5, fail: 0 } },
    { output: specOutput([["scripts/test/fixtures/unit-harness.mjs", "x"]]) },
    { output: specOutput([[A, "ok"], ["scripts/test/fixtures/unit-harness.mjs", "x"]]) },
  ]) {
    const io = fakeIo([]);
    const { result, reruns } = await run({ io, ...over });
    assert.equal(result.recovered, false, JSON.stringify(over));
    assert.deepEqual(reruns, [], `no retry may run: ${JSON.stringify(over)}`);
    assert.deepEqual(io.appended, [], "and no ledger line is written");
  }
});

unitTest("a malformed known-flakes file is a warning and every flake is UNLISTED", async () => {
  const { result } = await run({ io: fakeIo("{not json") });
  assert.equal(result.recovered, true);
  assert.match(result.messages.join("\n"), /WARNING .*unreadable/);
  assert.match(result.messages.join("\n"), /UNLISTED flake/);
});

unitTest("a missing known-flakes file is no entries and no warning", async () => {
  const { loadKnownFlakes } = await load();
  assert.deepEqual(loadKnownFlakes("/k.json", fakeIo(undefined)), { entries: [], error: null });
});

unitTest("one retry covers several tests of one file with one rerun and one ledger line each", async () => {
  const io = fakeIo([]);
  const { result, reruns } = await run({
    io, output: specOutput([[A, "one"], [A, "two"], [B, "three"]]),
  });
  assert.equal(result.recovered, true);
  assert.equal(reruns.length, 1);
  assert.deepEqual(reruns[0], [`${CWD}/${A}`, `${CWD}/${B}`]);
  assert.equal(io.appended[0].text.trim().split("\n").length, 3);
});

// A file-level failure (`process.exitCode = 1`) can print NO `test at` line: Node prints one only for a test
// with a file. It must count as unmapped, so a flaky test in another file can never recover the run.
const withUnlocated = (located, name = "scripts/test/fixtures/record-isolation.mjs") =>
  `${specOutput(located, { fail: located.length + 1 })}\n✖ ${name} (5.1ms)\n  'test failed'\n`;

unitTest("an unlocated failure beside a mapped flaky one is unmapped, and the run does NOT recover", async () => {
  const { failuresOf } = await load();
  const out = withUnlocated([[A, "flaky one"]]);
  const r = failuresOf(out, { cwd: CWD, files: FILES, realpath: (p) => p });
  assert.deepEqual(r.failures, [{ file: A, test: "flaky one" }]);
  assert.equal(r.unmapped, 1, "the entry with no `test at` is counted, not dropped");
  const io = fakeIo([]);
  const { result, reruns } = await run({ io, output: out, counts: { tests: 10, pass: 8, fail: 2 } });
  assert.equal(result.recovered, false);
  assert.deepEqual(reruns, [], "nothing is retried while a failure cannot be attributed");
  assert.deepEqual(io.appended, []);
});

unitTest("a listing whose failure count disagrees with the runner's summary is never recovered", async () => {
  const { result, reruns } = await run({ output: specOutput([[A, "flaky one"]], { fail: 2 }) });
  assert.equal(result.recovered, false);
  assert.match(result.reason, /summary counts 2/);
  assert.deepEqual(reruns, []);
});
