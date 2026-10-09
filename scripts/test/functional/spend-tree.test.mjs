// scripts/test/functional/spend-tree.test.mjs
// token-spend-tracking-per-epic — the REAL GIT half of the working-tree rules. The assertion twin
// (scripts/test/unit/spend-tree.test.mjs, same id) proves the resolution over hand-written
// `git worktree list` text; this file proves it against a real repository with a real linked worktree:
// the ledger and the transcripts resolve to the MAIN tree, the switch is refused outside it, and
// detachment is asked about the tree the ledger is written to.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { tmpRepo, run, runCombined, invokeEngine, readState, writeState } from "../fixtures/functional-harness.mjs";
import { EXPECTED, buildTranscriptTree, walk } from "../fixtures/spend-transcripts.mjs";

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" });
const FRESH = new Date("2026-10-09T12:00:00.000Z");
const spendPath = (cwd, ...p) => path.join(cwd, ".conductor", "spend", ...p);

/** A real repository (REALPATH'd, so the encoded transcript directory is unambiguous on a platform
 *  whose temp directory is a symlink) on a branch, initialised, with tracking on, plus a linked
 *  worktree, plus the fixture transcripts for the MAIN tree's path. */
function scene() {
  const main = fs.realpathSync(tmpRepo());
  git(main, "init", "-q", "-b", "main");
  git(main, "config", "user.email", "t@example.com");
  git(main, "config", "user.name", "t");
  run(["init"], { cwd: main });
  run(["add-epic", "--id", "e1", "--title", "E1", "--lane", "claude-code"], { cwd: main });
  git(main, "add", "-A");
  git(main, "commit", "-q", "-m", "one");
  const linked = path.join(fs.realpathSync(tmpRepo()), "wt");
  git(main, "worktree", "add", "-q", "-b", "feature", linked);
  const cfg = fs.realpathSync(tmpRepo());
  buildTranscriptTree(cfg, main);
  for (const f of walk(cfg)) fs.utimesSync(path.join(cfg, f), FRESH, FRESH);
  run(["set-spend-tracking", "on"], { cwd: main });
  const s = readState(main);
  s.spendTracking.enabledAt = "2026-10-01T00:00:00.000Z";
  writeState(main, s);
  fs.writeFileSync(spendPath(main, "timeline.jsonl"), JSON.stringify({ at: "2026-10-09T09:00:00.000Z", tracking: "on", active: "e1" }) + "\n");
  return { main, linked, cfg, env: { CLAUDE_CONFIG_DIR: cfg, HOME: "/no/such/home" } };
}

test("a linked worktree reads the same transcripts and writes the MAIN tree's ledger", () => {
  const sc = scene();
  const out = JSON.parse(run(["spend", "--json"], { cwd: sc.linked, env: sc.env }));
  assert.equal(out.coverage.total, EXPECTED.all, "the linked run read the main tree's transcripts");
  assert.ok(fs.existsSync(spendPath(sc.main, "rows.jsonl")), "and wrote the main tree's ledger");
  assert.equal(fs.existsSync(path.join(sc.linked, ".conductor", "spend")), false, "none of its own");
  const fromMain = JSON.parse(run(["spend", "--json", "--no-ingest"], { cwd: sc.main, env: sc.env }));
  assert.deepEqual(fromMain.epics, out.epics, "the same totals from either tree");
});

test("spend in a linked worktree accepts an epic registered in the main tree after it branched", () => {
  const sc = scene();
  run(["add-epic", "--id", "e9", "--title", "E9", "--lane", "claude-code"], { cwd: sc.main });
  assert.equal(readState(sc.linked).epics.some((e) => e.id === "e9"), false);
  const r = invokeEngine(["spend", "--json", "--epic", "e9"], { cwd: sc.linked, env: sc.env });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).tracking.enabledAt, "2026-10-01T00:00:00.000Z");
});

test("the switch is refused in a linked worktree, naming the main tree, and nothing changes", () => {
  const sc = scene();
  const before = fs.readFileSync(path.join(sc.linked, ".conductor", "state.json"), "utf8");
  for (const arg of ["on", "off"]) {
    const r = invokeEngine(["set-spend-tracking", arg], { cwd: sc.linked, env: sc.env });
    assert.notEqual(r.status, 0);
    assert.ok(r.stderr.includes(sc.main), r.stderr);
  }
  assert.equal(fs.readFileSync(path.join(sc.linked, ".conductor", "state.json"), "utf8"), before);
});

test("set-active in a linked worktree appends no timeline entry, and in the main tree it does", () => {
  const sc = scene();
  const tl = () => fs.readFileSync(spendPath(sc.main, "timeline.jsonl"), "utf8").split("\n").filter(Boolean);
  const n = tl().length;
  run(["set-active", "e1"], { cwd: sc.linked, env: sc.env });
  assert.equal(tl().length, n);
  assert.equal(fs.existsSync(path.join(sc.linked, ".conductor", "spend")), false);
  run(["set-active", "e1"], { cwd: sc.main, env: sc.env });
  assert.equal(tl().length, n + 1);
  assert.equal(JSON.parse(tl().at(-1)).active, "e1");
});

test("a detached MAIN tree: the switch is refused, ingest is suppressed and says so, set-active appends nothing", () => {
  const sc = scene();
  git(sc.main, "checkout", "-q", "--detach", git(sc.main, "rev-parse", "HEAD").trim());
  const tl = fs.readFileSync(spendPath(sc.main, "timeline.jsonl"), "utf8");
  const r = invokeEngine(["set-spend-tracking", "off"], { cwd: sc.main, env: sc.env });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /detached/);
  const before = walk(spendPath(sc.main));
  const out = runCombined(["spend"], { cwd: sc.main, env: sc.env });
  assert.match(out, /did not ingest because the main working tree's HEAD is detached/);
  assert.deepEqual(walk(spendPath(sc.main)), before);
  runCombined(["set-active", "e1"], { cwd: sc.main, env: sc.env });
  assert.equal(fs.readFileSync(spendPath(sc.main, "timeline.jsonl"), "utf8"), tl);
});

test("a detached LINKED worktree does not stop ingest: the main tree is on a branch", () => {
  const sc = scene();
  const detached = path.join(fs.realpathSync(tmpRepo()), "wt2");
  git(sc.main, "worktree", "add", "-q", "--detach", detached);
  const r = invokeEngine(["spend", "--json"], { cwd: detached, env: sc.env });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).ingest.ran, true);
  assert.ok(fs.existsSync(spendPath(sc.main, "rows.jsonl")));
});
