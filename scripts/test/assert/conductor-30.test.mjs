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
//
// THE FIVE gh-149/gh-152 TESTS THAT STOOD HERE MOVED TO THE UNIT RUNG in 4.1 (`scripts/test/unit/
// conductor-30.test.mjs`): they assert on the refusal text, the exit status and the record's bytes,
// and none of them needs a path. What is left in this file is the gh-148 family, whose subject is
// `openspec/` ON DISK, and the two `add-many` tests, whose fixture is a batch file.

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
