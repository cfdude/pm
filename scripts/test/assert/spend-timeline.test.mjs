// scripts/test/assert/spend-timeline.test.mjs
// token-spend-tracking-per-epic, group 3 (3.3, 3.4, 3.5) — the active-epic timeline written at the
// dispatch chokepoint, the hot-path guarantee, and detached-HEAD suppression. FILE rung: bytes on disk
// and the paths the engine touches. Linked-worktree and detached scenarios run against a hand-written
// git gateway, because this half runs no real git (the functional twin spend-tree.test.mjs does).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, runCombined, invokeEngine } from "../fixtures/assert-harness.mjs";
import { fakeGit } from "../fixtures/fake-git.mjs";
import { recordFsPaths, touchedUnder } from "../fixtures/fs-path-recorder.mjs";
import { buildTranscriptTree } from "../fixtures/spend-transcripts.mjs";

/** A scratch directory spelled as the OS spells it for real: `git worktree list` prints realpaths, and
 *  a temp directory under a symlink (macOS's /var) would otherwise never match what the gateway says. */
const realRepo = () => fs.realpathSync(tmpRepo());
const spendPath = (cwd, ...p) => path.join(cwd, ".conductor", "spend", ...p);
const timeline = (cwd) => {
  try { return fs.readFileSync(spendPath(cwd, "timeline.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); }
  catch { return []; }
};
const stateOf = (cwd) => JSON.parse(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"));

/** An initialised repo with epics e1 and e2 registered. */
function repo() {
  const cwd = realRepo();
  run(["init"], { cwd });
  for (const id of ["e1", "e2"]) run(["add-epic", "--id", id, "--title", id, "--lane", "claude-code"], { cwd });
  return cwd;
}

/** A gateway that answers like a repository with a linked worktree, and says which trees are
 *  detached. The rest is the frozen no-repository double. */
function gateway({ main, linked = null, detached = [] }) {
  const base = fakeGit({ noRepository: true });
  const rec = (p, b) => `worktree ${p}\0HEAD 0123456789abcdef\0branch refs/heads/${b}\0\0`;
  return {
    ...base,
    worktreeList: () => rec(main, "main") + (linked ? rec(linked, "wt") : ""),
    headRef: (at) => {
      if (detached.includes(at)) throw Object.assign(new Error("detached"), { status: 1 });
      return Buffer.alloc(0);
    },
  };
}
const withGit = (git, cwd, args, extra = {}) => invokeEngine(args, { cwd, git, ...extra });

// ───────────────────────────── 3.3 the timeline ─────────────────────────────

test("3.3 Enabling seeds the timeline: a tracking:on line whose active is the active epic", () => {
  const cwd = repo();
  run(["set-active", "e1"], { cwd });
  run(["set-spend-tracking", "on"], { cwd });
  const t = timeline(cwd);
  assert.equal(t.length, 1);
  assert.deepEqual([t[0].tracking, t[0].active], ["on", "e1"]);
  assert.match(t[0].at, /^\d{4}-\d\d-\d\dT/);
});

test("3.3 Activating an epic appends exactly one entry whose active is the new epic", () => {
  const cwd = repo();
  run(["set-spend-tracking", "on"], { cwd });
  const before = timeline(cwd).length;
  run(["set-active", "e1"], { cwd });
  const t = timeline(cwd);
  assert.equal(t.length, before + 1);
  assert.deepEqual([t.at(-1).active, "tracking" in t.at(-1)], ["e1", false]);
  run(["set-active", "e2"], { cwd });
  assert.equal(timeline(cwd).at(-1).active, "e2", "every writer of state.active is covered by the same diff");
  run(["clear-active"], { cwd });
  assert.equal(timeline(cwd).at(-1).active, null, "clearing the pointer is a change too");
});

test("3.3 An unchanged active epic appends nothing: the timeline is byte-identical after a verb that left it alone", () => {
  const cwd = repo();
  run(["set-active", "e1"], { cwd });
  run(["set-spend-tracking", "on"], { cwd });
  const before = fs.readFileSync(spendPath(cwd, "timeline.jsonl"), "utf8");
  run(["update-epic", "e1", "--notes", "a note that moves state.json but not the pointer"], { cwd });
  run(["set-active", "e1"], { cwd });
  assert.equal(fs.readFileSync(spendPath(cwd, "timeline.jsonl"), "utf8"), before);
});

test("3.3 Off records no timeline: no spend directory is created by set-active", () => {
  const cwd = repo();
  run(["set-active", "e1"], { cwd });
  assert.equal(fs.existsSync(spendPath(cwd)), false);
  run(["set-spend-tracking", "on"], { cwd });
  run(["set-spend-tracking", "off"], { cwd });
  const frozen = fs.readFileSync(spendPath(cwd, "timeline.jsonl"), "utf8");
  run(["set-active", "e2"], { cwd });
  assert.equal(fs.readFileSync(spendPath(cwd, "timeline.jsonl"), "utf8"), frozen, "off stops the timeline");
});

test("3.3 A failing append does not fail the verb", () => {
  const cwd = repo();
  run(["set-spend-tracking", "on"], { cwd });
  fs.rmSync(spendPath(cwd), { recursive: true, force: true });
  fs.writeFileSync(spendPath(cwd), "not a directory");           // every append under it fails
  const out = runCombined(["set-active", "e1"], { cwd });
  assert.doesNotMatch(out, /Error|ENOTDIR/);
  assert.equal(stateOf(cwd).active, "e1");
});

test("3.3 Off keeps the ledger: every file but the timeline is byte-identical, and the timeline gains one off entry", () => {
  const cwd = repo();
  run(["set-spend-tracking", "on"], { cwd });
  fs.writeFileSync(spendPath(cwd, "rows.jsonl"), '{"messageId":"m1"}\n');
  fs.writeFileSync(spendPath(cwd, "cursor.json"), "{}\n");
  fs.writeFileSync(spendPath(cwd, "markers.json"), "{}\n");
  const files = ["rows.jsonl", "cursor.json", "markers.json"];
  const before = files.map((f) => fs.readFileSync(spendPath(cwd, f), "utf8"));
  const n = timeline(cwd).length;
  run(["set-spend-tracking", "off"], { cwd });
  assert.deepEqual(files.map((f) => fs.readFileSync(spendPath(cwd, f), "utf8")), before);
  const t = timeline(cwd);
  assert.equal(t.length, n + 1);
  assert.deepEqual([t.at(-1).tracking, "active" in t.at(-1)], ["off", false]);
  assert.equal(stateOf(cwd).spendTracking.enabled, false);
});

test("3.3 A repeated setting writes nothing to the timeline either", () => {
  const cwd = repo();
  run(["set-spend-tracking", "on"], { cwd });
  const before = fs.readFileSync(spendPath(cwd, "timeline.jsonl"), "utf8");
  run(["set-spend-tracking", "on"], { cwd });
  assert.equal(fs.readFileSync(spendPath(cwd, "timeline.jsonl"), "utf8"), before);
  const off = repo();
  run(["set-spend-tracking", "off"], { cwd: off });
  assert.equal(fs.existsSync(spendPath(off)), false, "off on a repo that never turned it on is a no-op");
  assert.equal(stateOf(off).spendTracking, undefined);
});

test("3.3 A linked worktree records no timeline: set-active there appends nothing, here or in the main tree", () => {
  const main = repo();
  run(["set-spend-tracking", "on"], { cwd: main });
  const linked = realRepo();
  fs.mkdirSync(path.join(linked, ".conductor"), { recursive: true });
  fs.copyFileSync(path.join(main, ".conductor", "state.json"), path.join(linked, ".conductor", "state.json"));
  const git = gateway({ main, linked });
  const mainBefore = fs.readFileSync(spendPath(main, "timeline.jsonl"), "utf8");
  const r = withGit(git, linked, ["set-active", "e1"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(stateOf(linked).active, "e1");
  assert.equal(fs.existsSync(spendPath(linked)), false, "nothing is written beside the linked worktree");
  assert.equal(fs.readFileSync(spendPath(main, "timeline.jsonl"), "utf8"), mainBefore, "nor into the main tree's timeline");
});

test("3.3 The switch is refused outside the main working tree, naming the main tree, and nothing changes", () => {
  const main = repo();
  const linked = realRepo();
  fs.mkdirSync(path.join(linked, ".conductor"), { recursive: true });
  fs.copyFileSync(path.join(main, ".conductor", "state.json"), path.join(linked, ".conductor", "state.json"));
  const before = fs.readFileSync(path.join(linked, ".conductor", "state.json"), "utf8");
  const git = gateway({ main, linked });
  for (const arg of ["on", "off"]) {
    const r = withGit(git, linked, ["set-spend-tracking", arg]);
    assert.notEqual(r.status, 0);
    assert.ok(r.stderr.includes(main), `names the main working tree (${r.stderr})`);
  }
  assert.equal(fs.readFileSync(path.join(linked, ".conductor", "state.json"), "utf8"), before);
  assert.equal(fs.existsSync(spendPath(linked)), false);
  assert.equal(fs.existsSync(spendPath(main)), false);
});

// ───────────────────────────── 3.4 the hot path ─────────────────────────────

const HOOKS = [
  ["brief", "SessionStart"], ["snapshot", "PreCompact"], ["commit-nudge", "PostToolUse"],
  ["gate-guard", "PreToolUse"], ["lesson-advice", "PreToolUse"],
];
const payload = (event) => JSON.stringify({ hook_event_name: event, tool_name: "Bash", tool_input: { command: "ls" }, session_id: "s1" });

function hotPath(on) {
  const cwd = repo();
  const cfg = realRepo();
  buildTranscriptTree(cfg, cwd);
  if (on) {
    run(["set-spend-tracking", "on"], { cwd });
    fs.writeFileSync(spendPath(cwd, "rows.jsonl"), '{"messageId":"m1"}\n');
  }
  const spendDirs = [spendPath(cwd), fs.realpathSync(cwd) + "/.conductor/spend"];
  const transcriptDirs = [cfg, fs.realpathSync(cfg)];
  const out = {};
  for (const [hook, event] of HOOKS) {
    const { result, touched } = recordFsPaths(() => withGit(fakeGit({ noRepository: true }), cwd,
      [hook, "--platform", "claude-code"], { env: { CLAUDE_CONFIG_DIR: cfg }, input: payload(event) }));
    assert.equal(result.status, 0, `${hook} ran: ${result.stderr}`);
    out[hook] = { spend: touchedUnder(touched, ...spendDirs), transcripts: touchedUnder(touched, ...transcriptDirs), all: touched.length };
  }
  return out;
}

test("3.4 A disabled repo's hooks touch nothing new: no path under the spend directory or the transcript directory", () => {
  const seen = hotPath(false);
  for (const [hook, s] of Object.entries(seen)) {
    assert.deepEqual(s.spend, [], `${hook}: no spend path`);
    assert.deepEqual(s.transcripts, [], `${hook}: no transcript path`);
    assert.ok(s.all > 0, `${hook}: the recorder saw the hook work, so an empty answer is not vacuous`);
  }
});

test("3.4 An enabled repo's hooks still read no transcript and no ledger file", () => {
  const seen = hotPath(true);
  for (const [hook, s] of Object.entries(seen)) {
    assert.deepEqual(s.transcripts, [], `${hook}: no transcript opened`);
    assert.deepEqual(s.spend, [], `${hook}: no ledger file read, written or probed`);
    assert.ok(s.all > 0, `${hook}: the recorder saw the hook work`);
  }
});

test("3.4 With tracking on, an invocation that moves nothing spawns no git and appends nothing", () => {
  const cwd = repo();
  run(["set-active", "e1"], { cwd });
  run(["set-spend-tracking", "on"], { cwd });
  const before = fs.readFileSync(spendPath(cwd, "timeline.jsonl"), "utf8");
  let probes = 0;
  const git = { ...fakeGit({ noRepository: true }), worktreeList: () => { probes++; throw Object.assign(new Error("x"), { status: 128 }); } };
  withGit(git, cwd, ["brief", "--platform", "claude-code"], { input: payload("SessionStart") });
  withGit(git, cwd, ["update-epic", "e1", "--notes", "n"], {});
  assert.equal(probes, 0, "the main-tree probe runs only after state.active moved");
  assert.equal(fs.readFileSync(spendPath(cwd, "timeline.jsonl"), "utf8"), before);
  withGit(git, cwd, ["set-active", "e2"], {});
  assert.ok(probes > 0, "and it does run when the pointer moves (the positive control)");
});

// ───────────────────────────── 3.5 a detached main tree ─────────────────────────────

test("3.5 Spend data is not written in a detached tree: set-active completes and the timeline is untouched", () => {
  const cwd = repo();
  run(["set-spend-tracking", "on"], { cwd });
  const before = fs.readFileSync(spendPath(cwd, "timeline.jsonl"), "utf8");
  const r = withGit(gateway({ main: cwd, detached: [cwd] }), cwd, ["set-active", "e1"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(stateOf(cwd).active, "e1", "the verb did its normal work");
  assert.equal(fs.readFileSync(spendPath(cwd, "timeline.jsonl"), "utf8"), before, "and the timeline did not move");
  // the control: the same verb on a branch DOES append
  const ok = withGit(gateway({ main: cwd }), cwd, ["set-active", "e2"]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(timeline(cwd).at(-1).active, "e2");
});

test("3.5 The switch is refused while the main working tree is detached, naming the detached HEAD", () => {
  const cwd = repo();
  run(["set-spend-tracking", "on"], { cwd });
  const stateBefore = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
  const tlBefore = fs.readFileSync(spendPath(cwd, "timeline.jsonl"), "utf8");
  const r = withGit(gateway({ main: cwd, detached: [cwd] }), cwd, ["set-spend-tracking", "off"]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /detached/);
  assert.equal(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"), stateBefore);
  assert.equal(fs.readFileSync(spendPath(cwd, "timeline.jsonl"), "utf8"), tlBefore);
});

test("3.5 A tree on a branch is unaffected: an unanswerable probe records as normal", () => {
  const cwd = repo();
  run(["set-spend-tracking", "on"], { cwd });
  run(["set-active", "e1"], { cwd });                        // the no-repository double answers 128
  assert.equal(timeline(cwd).at(-1).active, "e1");
});
