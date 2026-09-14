// archive-gate-reads-what-it-writes — the archive gate decides on the record an `update-epic`
// invocation LEAVES, and an update to an archived `delivered` epic may not break an obligation
// its archive met.
//
// Every refusal here asserts `state.json` BYTE-IDENTICAL, not merely "the status did not move":
// a refused call that wrote half its fields is the partial write this change must not introduce
// by moving the gate below the field writes.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { ENGINE, EMPTY_CACHE, tmpRepo, run, readState, writeState, gitInitWithCommit, commitFiles } from "./helpers.mjs";

const stateFile = (cwd) => path.join(cwd, ".conductor", "state.json");
const stateBytes = (cwd) => fs.readFileSync(stateFile(cwd));
const epicOf = (cwd, id) => readState(cwd).epics.find(e => e.id === id);
const headSha = (cwd) => execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();

/** Run the engine WITHOUT throwing, so a test can read the exit code and both streams. */
function attempt(cwd, args) {
  const r = spawnSync("node", [ENGINE, ...args], {
    cwd, encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, PM_CACHE_ROOT: EMPTY_CACHE },
  });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

/** Assert a refusal that wrote nothing, and hand back what it printed. */
function refused(cwd, args) {
  const before = stateBytes(cwd);
  const r = attempt(cwd, args);
  assert.notEqual(r.status, 0, `expected a refusal, got exit 0.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  assert.ok(stateBytes(cwd).equals(before), "a refused invocation must leave state.json byte-identical");
  return r;
}

/** Assert an accepted invocation, and hand back what it printed. */
function accepted(cwd, args) {
  const r = attempt(cwd, args);
  assert.equal(r.status, 0, `expected exit 0.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  return r;
}

const ARCHIVE_DELIVERED = ["--status", "archived", "--outcome", "delivered", "--no-deferrals"];

/** An initialized repository with one real commit beyond the root. */
function repo() {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  gitInitWithCommit(cwd);
  const root = headSha(cwd);
  commitFiles(cwd, { "one.txt": "1" }, "feat: the delivery commit");
  return { cwd, root, first: headSha(cwd) };
}

let n = 0;
/** A commit descending from everything already committed in `cwd`. */
function descendant(cwd) {
  commitFiles(cwd, { [`later-${++n}.txt`]: String(n) }, "feat: a later commit");
  return headSha(cwd);
}

/** An openspec-lane epic attributing exactly `first`, with a passing Gate 2 whose headSha is it. */
function coveredOpenspecEpic(id = "spec") {
  const r = repo();
  run(["add-epic", "--id", id, "--lane", "openspec"], { cwd: r.cwd });
  run(["update-epic", id, "--attribute-commit", r.first], { cwd: r.cwd });
  run(["record-gate-review", id, "--gate", "2", "--verdict", "pass",
    "--base-sha", r.root, "--head-sha", r.first], { cwd: r.cwd });
  return r;
}

function bareRepo() {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  return cwd;
}

// ═══════════════ Requirement: the interactive archive verb gates the record it writes ═══════════════

test("1.1 a lane switch and an archive in one call cannot bypass Gate 2", () => {
  const cwd = bareRepo();
  run(["add-epic", "--id", "a1", "--lane", "claude-code"], { cwd });
  const r = refused(cwd, ["update-epic", "a1", "--lane", "openspec", ...ARCHIVE_DELIVERED]);
  assert.match(r.stderr, /passing Gate 2/, "the refusal names the missing passing Gate 2");
  assert.notEqual(epicOf(cwd, "a1").status, "archived");
});

test("1.2 an attribution and an archive in one call cannot bypass staleness", () => {
  const { cwd } = coveredOpenspecEpic("a2");
  const later = descendant(cwd);
  const r = refused(cwd, ["update-epic", "a2", "--attribute-commit", later, ...ARCHIVE_DELIVERED]);
  assert.ok(r.stderr.includes(later), `the refusal names the uncovered commit ${later}: ${r.stderr}`);
});

test("1.3 an added story and an archive in one call cannot bypass the handoff", () => {
  const cwd = bareRepo();
  run(["add-epic", "--id", "a3", "--lane", "claude-code"], { cwd });
  run(["update-epic", "a3", "--add-story", "s0"], { cwd });
  run(["update-epic", "a3", "--story", "1", "--done"], { cwd });
  const r = refused(cwd, ["update-epic", "a3", "--add-story", "s", ...ARCHIVE_DELIVERED]);
  assert.match(r.stderr, /\[ \] 2\. s\b/, "the refusal names the outstanding story the call adds");
});

test("1.4 a commit withdrawal and an archive in one call cannot bypass the gate", () => {
  const { cwd, first } = coveredOpenspecEpic("a4");
  const r = refused(cwd, ["update-epic", "a4", "--withdraw-commit", first, "--withdrawal-reason", "x",
    ...ARCHIVE_DELIVERED]);
  assert.match(r.stderr, /withdrawn/, "the refusal names the withdrawn attribution");
  assert.notEqual(epicOf(cwd, "a4").status, "archived");
});

test("1.5 finishing the last story and archiving in one call is accepted", () => {
  const cwd = bareRepo();
  run(["add-epic", "--id", "a5", "--lane", "claude-code"], { cwd });
  run(["update-epic", "a5", "--add-story", "s1"], { cwd });
  accepted(cwd, ["update-epic", "a5", "--story", "1", "--done", ...ARCHIVE_DELIVERED]);
  const e = epicOf(cwd, "a5");
  assert.equal(e.stories[0].done, true);
  assert.equal(e.status, "archived");
  assert.equal(e.disposition.outcome, "delivered");
});

test("1.6 leaving the openspec lane and archiving in one call is accepted", () => {
  const cwd = bareRepo();
  run(["add-epic", "--id", "a6", "--lane", "openspec"], { cwd });
  accepted(cwd, ["update-epic", "a6", "--lane", "claude-code", ...ARCHIVE_DELIVERED]);
  const e = epicOf(cwd, "a6");
  assert.equal(e.lane, "claude-code");
  assert.equal(e.status, "archived");
  assert.equal(e.disposition.outcome, "delivered");
});

test("1.6a detaching a plan with outstanding tasks and archiving in one call is accepted, and announced", () => {
  const cwd = bareRepo();
  const plan = "docs/superpowers/plans/p.md";
  fs.mkdirSync(path.join(cwd, path.dirname(plan)), { recursive: true });
  fs.writeFileSync(path.join(cwd, plan), "# p\n\n- [ ] an outstanding task\n");
  run(["add-epic", "--id", "a6a", "--lane", "claude-code", "--plan", plan], { cwd });
  const r = accepted(cwd, ["update-epic", "a6a", "--clear", "plan", ...ARCHIVE_DELIVERED]);
  assert.match(r.stderr, /cleared `a6a`'s plan/, "the detached plan is announced");
  const e = epicOf(cwd, "a6a");
  assert.ok(!("planPath" in e));
  assert.equal(e.status, "archived");
});

/** The "a refused call announces no cleared field" fixture: claude-code lane, no stories, ranked
 *  in P2, carrying a parent, and a sync-ignored plan file whose every task is ticked. */
function announcementFixture() {
  const cwd = bareRepo();
  const plan = "docs/superpowers/plans/done.md";
  fs.mkdirSync(path.join(cwd, path.dirname(plan)), { recursive: true });
  fs.writeFileSync(path.join(cwd, plan), "# done\n\n- [x] a ticked task\n");
  run(["add-epic", "--id", "par", "--lane", "claude-code"], { cwd });
  run(["add-epic", "--id", "a7", "--lane", "claude-code", "--priority", "P2", "--parent", "par"], { cwd });
  const s = readState(cwd);
  s.epics.find(e => e.id === "a7").rank = 1;
  s.syncIgnore = [{ path: plan, at: "2026-09-01T00:00:00.000Z", reason: "fixture tombstone" }];
  writeState(cwd, s);
  return { cwd, args: ["update-epic", "a7", "--priority", "P1", "--clear", "parent", "--plan", plan] };
}

const ANNOUNCED = {
  tombstone: /cleared the sync-ignore tombstone on/,
  rank: /cleared `a7`'s rank/,
  parent: /cleared `a7`'s parent/,
};

test("1.7 a refused call announces no cleared field", () => {
  const { cwd, args } = announcementFixture();
  const r = refused(cwd, [...args, "--lane", "openspec", ...ARCHIVE_DELIVERED]);
  for (const [what, re] of Object.entries(ANNOUNCED)) {
    assert.doesNotMatch(r.stderr, re, `a refused call announced the ${what} clear: ${r.stderr}`);
  }
});

test("1.7 regression guard: an accepted call still announces what it cleared", () => {
  const { cwd, args } = announcementFixture();
  const r = accepted(cwd, [...args, ...ARCHIVE_DELIVERED]);
  for (const [what, re] of Object.entries(ANNOUNCED)) {
    assert.match(r.stderr, re, `the accepted call did not announce the ${what} clear: ${r.stderr}`);
  }
});
