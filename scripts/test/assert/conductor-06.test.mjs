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
