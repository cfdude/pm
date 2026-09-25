// scripts/test/assert/conductor-06.test.mjs
// 5.3's ASSERTION TWIN of scripts/test/functional/conductor-06.test.mjs — same id, same subject.
//
// THE FUNCTIONAL FILE'S SUBJECT is the hierarchy/link family: the 0.5.0 link migration, plan-hierarchy
// batching, top-level depends-on ordering, remove-epic and its dangling-reference sweep, and
// verify-worktrees. ONLY verify-worktrees READS GIT: three of its five tests create a real repository
// and a real linked worktree (`gitInitWithCommit` + `addHierarchyWorktree`), which this half cannot do
// (design D5). Its FOURTH case — a directory that is not a repository at all — is exactly this half's
// world, and is kept.
//
// ─────────────── 4.1 SPLIT THIS FILE, AND THIS IS THE FILE-RUNG HALF ───────────────
//
// TWENTY-FIVE of its twenty-six tests moved to `scripts/test/unit/conductor-06.test.mjs` — every one
// whose observable is a VALUE (plan-hierarchy's JSON, the brief's rendered text, a record field, a
// refusal printed to a stream). WHAT STAYS is the one test whose subject IS the upgrade path: it seeds
// `pmVersion` and a malformed `links[]` array and then runs `upgrade` twice against
// `fixturePluginRoot("0.5.0")` — a REAL plugin directory on disk — comparing state.json's BYTES for
// idempotence. `upgrade` also back-fills `.gitignore`, a repository file the store does not own.
//
// No assertion changed in either direction.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, readState, writeState, fixturePluginRoot } from "../fixtures/assert-harness.mjs";
import { fakeGit } from "../fixtures/fake-git.mjs";
// The UNBOUND entry point: the harness's own `invokeEngine` pins the no-repository double per call,
// and this file's last test hands the engine a listing of its own.
import { invokeEngine } from "../fixtures/harness.mjs";

// ───────────────────────── 0.5.0: link migration ─────────────────────────

test("0.5.0 migration repairs colon-string links, drops unrecoverable, is idempotent", () => {
  const cwd = tmpRepo();
  const root = fixturePluginRoot("0.5.0");
  run(["init"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root } });
  const s = readState(cwd);
  s.pmVersion = "0.4.1";
  s.epics.push({ id: "a", title: "a", priority: "P1", status: "queued", role: "epic", lane: "openspec",
    links: ["blocks:other:was flaky", { type: "related", epic: "z" }, "", {}] });
  writeState(cwd, s);

  run(["upgrade"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root } });
  const after = readState(cwd);
  assert.equal(after.pmVersion, "0.5.0");
  const links = after.epics.find(e => e.id === "a").links;
  assert.deepEqual(links.find(l => l.type === "blocks"), { type: "blocks", epic: "other", reason: "was flaky" });
  assert.ok(links.find(l => l.type === "related" && l.epic === "z"));  // valid object preserved
  assert.equal(links.length, 2);                                       // "" and {} dropped

  // idempotent on a second run
  const first = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
  run(["upgrade"], { cwd, env: { CLAUDE_PLUGIN_ROOT: root } });
  assert.equal(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"), first);
});

// (The functional test's scratch parent is scheduled with removeAtExit(); this twin makes no temp dir of its own.)
// The twin of the functional "reports the WHOLE path of a worktree whose directory name holds a line
// feed". This half cannot create a worktree, but it can hand the engine the listing git would print:
// the double's no-repository gateway with the one listing answered, NUL-terminated as `-z` prints it.
// The path's line feed must survive into the report, and the BRANCH line after it must still be read.
test("verify-worktrees parses a NUL-terminated listing: a line feed inside a path stays in the path", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "lf-child", "--lane", "claude-code", "--status", "archived"], { cwd });
  const wt = "/tmp/pm-wt/line\nfeed";
  const git = {
    ...fakeGit({ noRepository: true }),
    worktreeList: () => `worktree ${cwd}\0HEAD aaaa\0branch refs/heads/main\0\0` +
      `worktree ${wt}\0HEAD bbbb\0branch refs/heads/hierarchy-child/lf-child\0\0`,
    mergeBaseIsAncestorOfHead: () => { const e = new Error("not an ancestor"); e.status = 1; throw e; },
  };
  const r = invokeEngine(["verify-worktrees"], { cwd, git });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.orphaned.map(o => o.path), [wt], "the whole path, line feed included");
  assert.deepEqual(out.orphaned[0].reasons, ["epic-archived"]);
});

// `-z` needs git 2.36+. An older git refuses the switch (status 129), and that failure used to print
// the same `{orphaned: []}` as a clean repository — a check that could not run, reading as a pass.
// Only "not a repository" (128) is an honest empty answer.
test("verify-worktrees REFUSES when git cannot list worktrees for any reason but 'not a repository'", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const failing = (status, stderr) => ({
    ...fakeGit({ noRepository: true }),
    worktreeList: () => { const e = new Error(stderr); e.status = status; e.stderr = stderr; throw e; },
  });
  const old = invokeEngine(["verify-worktrees"], { cwd, git: failing(129, "error: unknown switch `z'") });
  assert.notEqual(old.status, 0, "an old git is refused, not reported clean");
  assert.equal(old.stdout, "", "and no JSON verdict is printed");
  assert.match(old.stderr, /needs git 2\.36 or later/);
  assert.match(old.stderr, /unknown switch/, "the message git printed is carried");
  const none = invokeEngine(["verify-worktrees"], { cwd, git: failing(128, "fatal: not a git repository") });
  assert.equal(none.status, 0);
  assert.deepEqual(JSON.parse(none.stdout).orphaned, [], "outside a repository, empty is the true answer");
});
