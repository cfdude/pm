// scripts/test/assert/conductor-30.test.mjs
// 5.3's ASSERTION TWIN of scripts/test/functional/conductor-30.test.mjs — same id, same subject.
//
// THE FUNCTIONAL FILE'S SUBJECT is gh-149 (a flag that takes a value must REFUSE a valueless
// occurrence, on every surface, before any state is touched) and gh-148 (verify-specs proposes the
// ids an uncovered spec document names, and confirms nothing). Both are argv and files — no git —
// so this twin carries the behavioural half of both.
//
// gh-149's failure mode is asymmetry: `add-epic --plan` with no value must not be accepted where
// `--title` with no value is refused. That asymmetry is invisible in a spot check and obvious in a
// sweep, which is why the sweep lives in the functional half and the sharpest cases live here.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, runCombined, readState, writeState, expectFail } from "../fixtures/assert-harness.mjs";

const repo = () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "e1", "--title", "t", "--lane", "claude-code"], { cwd });
  return cwd;
};
const stateBytes = (cwd) => fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");

// ─────────────────── gh-149: a valueless occurrence is refused ───────────────────

test("gh-149: add-epic --plan with no value is refused — the asymmetry this issue is about", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  const before = stateBytes(cwd);
  const err = expectFail(() => run(["add-epic", "--id", "e1", "--title", "t", "--lane", "claude-code", "--plan"], { cwd }));
  assert.ok(err, "a value-bearing flag with no value must refuse, not silently take nothing");
  assert.match(String(err.stderr || ""), /--plan requires/);
  assert.equal(stateBytes(cwd), before, "and it refuses BEFORE any state is written");
});

test("gh-149: every value-bearing flag on add-epic refuses a valueless occurrence", () => {
  // The population is short and named here, because the sweep over EVERY registered flag lives in
  // the functional half; these are the ones whose refusal text the sharpest cases depend on.
  const cwd = tmpRepo(); run(["init"], { cwd });
  for (const flag of ["--title", "--lane", "--priority", "--notes", "--description"]) {
    const err = expectFail(() => run(["add-epic", "--id", "e1", flag], { cwd }));
    assert.ok(err, `${flag} with no value must be refused`);
    assert.match(String(err.stderr || ""), new RegExp(`${flag} requires`));
  }
});

test("gh-149: a REPEATABLE flag is refused when ANY occurrence is valueless, not just the first", () => {
  const cwd = repo();
  const before = stateBytes(cwd);
  const err = expectFail(() => run(["update-epic", "e1", "--add-story", "one", "--add-story"], { cwd }));
  assert.ok(err, "the SECOND occurrence is what makes this a sweep rather than a first-token check");
  assert.equal(stateBytes(cwd), before);
});

test("gh-149: the refusal lands BEFORE any state is loaded or written, on every surface", () => {
  for (const argv of [
    ["add-epic", "--id", "e1", "--title"],
    ["update-epic", "e1", "--priority"],
    ["set-autonomy", "e1", "--level"],
    ["release", "1.0", "--intent"],
  ]) {
    const cwd = repo();
    const before = stateBytes(cwd);
    const err = expectFail(() => run(argv, { cwd }));
    assert.ok(err, `${argv.join(" ")} must be refused`);
    assert.equal(stateBytes(cwd), before, `${argv[0]} wrote state while refusing`);
  }
});

test("gh-152's sharpest case: `set-autonomy --level` with no value writes no autonomy block", () => {
  const cwd = repo();
  assert.ok(expectFail(() => run(["set-autonomy", "e1", "--level"], { cwd })));
  assert.equal(readState(cwd).epics.find(e => e.id === "e1").autonomy, undefined);
});

// ─────────────────── gh-148: verify-specs ───────────────────

test("gh-148: --headers is an allowlisted flag and takes no value", () => {
  const cwd = repo();
  fs.mkdirSync(path.join(cwd, "openspec", "specs"), { recursive: true });
  const err = expectFail(() => run(["verify-specs", "--headers=x"], { cwd }));
  assert.ok(err, "--headers takes no value");
  assert.match(String(err.stderr || ""), /--headers takes no value/);
});

test("gh-148: an ABSENT spec root says so rather than reporting a confidently empty proposal set", () => {
  const cwd = repo();   // no openspec/ at all
  const out = runCombined(["verify-specs"], { cwd });
  assert.match(out, /openspec|spec/i, "the report names what it looked for");
});

test("gh-148: the header parse keys on the METADATA BLOCK, not on a list of label names", () => {
  const cwd = repo();
  const dir = path.join(cwd, "openspec", "specs", "thing");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "spec.md"), [
    "---",
    "id: thing",
    "---",
    "",
    "# Thing",
    "",
    "A paragraph mentioning another-id in prose, and `code-id` in a span.",
    "",
    "## Requirements",
  ].join("\n") + "\n");
  const out = runCombined(["verify-specs", "--headers"], { cwd });
  // The prose and the code span are NOT candidates — only the metadata block is read.
  assert.ok(!/another-id/.test(out), "body text below the header block is not a candidate");
  assert.ok(!/code-id/.test(out), "and neither is a code span");
});

test("gh-148: verify-specs confirms nothing — it proposes", () => {
  const cwd = repo();
  const dir = path.join(cwd, "openspec", "specs", "thing");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "spec.md"), "---\nid: thing\n---\n\n# Thing\n\n## R\n");
  const before = stateBytes(cwd);
  runCombined(["verify-specs", "--headers"], { cwd });
  assert.equal(stateBytes(cwd), before, "an inventory verb writes nothing");
});

// ─────────────────── add-many ───────────────────

test("gh-149: add-many refuses a batch key whose value is not a usable string, and creates nothing", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  const batch = path.join(cwd, "batch.json");
  fs.writeFileSync(batch, JSON.stringify({ epics: [{ id: "b1", title: "t", lane: "claude-code", notes: 42 }] }));
  const err = expectFail(() => run(["add-many", "--from", batch], { cwd }));
  assert.ok(err, "a key the writer cannot persist must be refused by name");
  assert.deepEqual(readState(cwd).epics, []);
});

test("gh-149: add-many still accepts the array-valued keys it validates itself", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  const batch = path.join(cwd, "batch.json");
  fs.writeFileSync(batch, JSON.stringify({ epics: [{ id: "b1", title: "t", lane: "claude-code",
    links: [{ type: "relates-to", epic: "b1", reason: "self" }] }] }));
  run(["add-many", "--from", batch], { cwd });
  assert.deepEqual(readState(cwd).epics.map(e => e.id), ["b1"]);
});

// ───────────────────────── the deliberate omissions ─────────────────────────
//
// The two SWEEPS — "EVERY command in the registry has a baseline invocation, so the sweep covers all
// of them" and "every value-bearing flag, on every command, refuses a valueless occurrence" — derive
// their population from the registry and drive every verb through a spawned process (design D5). The
// sharpest members of the same population are asserted above, in-process.
