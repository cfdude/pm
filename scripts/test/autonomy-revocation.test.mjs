// scripts/test/autonomy-revocation.test.mjs
// `epic-autonomy` — the inverse `--preauthorize` never shipped, and the two rules that come with
// it: a grant names something, and re-arming autonomy says what it restores.
//
// WHERE THE SPEC PUTS THEM. Every test below is one scenario of
// openspec/changes/operations-ship-their-inverses/specs/epic-autonomy/spec.md, named for it, so a
// reader can go from the requirement to the assertion without a search. The measured instance the
// capability exists for: on 0.45.0, `set-autonomy a1 --preauthorize "rm -rf build/:it is
// regenerated"` then `--level off` exits 0 with the grant intact and nothing able to take it back,
// so turning autonomy back on silently restores every prior grant.

import { test } from "node:test";
import assert from "node:assert/strict";
import { run, runCombined, readState, tmpRepo, expectFail } from "./helpers.mjs";
import fs from "node:fs";
import path from "node:path";

const stateFile = (cwd) => path.join(cwd, ".conductor", "state.json");
const stateBytes = (cwd) => fs.readFileSync(stateFile(cwd));
const autonomyOf = (cwd, id) => (readState(cwd).epics.find(e => e.id === id) || {}).autonomy;

function repoWithEpic(id = "a") {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", id, "--lane", "claude-code"], { cwd });
  return cwd;
}

// ───────── A pre-authorization is revocable, and revoking it is recorded ─────────

test("Scenario: A granted action is revoked and no longer authorises", () => {
  const cwd = repoWithEpic();
  run(["set-autonomy", "a", "--preauthorize", "rm -rf build/:it is regenerated"], { cwd });
  run(["set-autonomy", "a", "--revoke", "rm -rf build/",
    "--revoke-reason", "build/ now holds a checked-in vendor tree"], { cwd });

  const a = autonomyOf(cwd, "a");
  assert.equal(a.preAuthorized.length, 1, "the grant is RECORDED as revoked, never spliced out");
  const g = a.preAuthorized[0];
  assert.equal(g.action, "rm -rf build/");
  assert.equal(g.reason, "it is regenerated", "the grant's own reason survives its revocation");
  assert.ok(g.revoked && typeof g.revoked === "object", "the entry carries a revocation stamp");
  assert.equal(g.revoked.reason, "build/ now holds a checked-in vendor tree");
  assert.ok(g.revoked.revokedAt, "the revocation records when it happened");
});

test("Scenario: A category grant is revoked by naming the category", () => {
  const cwd = repoWithEpic();
  run(["set-autonomy", "a", "--preauthorize", "category:filesystem:scratch only"], { cwd });
  run(["set-autonomy", "a", "--revoke", "category:filesystem",
    "--revoke-reason", "the scratch dir moved under the repo"], { cwd });

  const a = autonomyOf(cwd, "a");
  assert.equal(a.preAuthorized.length, 1);
  const g = a.preAuthorized[0];
  assert.equal(g.category, "filesystem");
  assert.equal(g.action, undefined, "a category grant still carries no action");
  assert.ok(g.revoked, "a category grant is revocable by the SAME operation, not a second one");
  assert.equal(g.revoked.reason, "the scratch dir moved under the repo");
});

test("Scenario: A revoke names the stored value, however the grant spelled it", () => {
  // The grant splits on its FIRST colon, so a stored action never contains one. `--revoke` runs
  // the identical split, which is what makes BOTH spellings name the same grant: the bare stored
  // action, and the whole original `--preauthorize` value pasted back. Design Decision 1 — "whatever
  // --preauthorize stored is exactly what --revoke names".
  const cwd = repoWithEpic();
  run(["set-autonomy", "a", "--preauthorize", "rm -rf build/:it is regenerated"], { cwd });
  run(["set-autonomy", "a", "--revoke", "rm -rf build/:it is regenerated",
    "--revoke-reason", "no longer regenerated"], { cwd });
  assert.ok(autonomyOf(cwd, "a").preAuthorized[0].revoked, "the full grant string names the grant too");
});

test("Scenario: A revoke over a mixed match leaves the earlier revocation untouched", () => {
  const cwd = repoWithEpic();
  run(["set-autonomy", "a", "--preauthorize", "drop-scratch-table:reviewed, safe"], { cwd });
  run(["set-autonomy", "a", "--revoke", "drop-scratch-table", "--revoke-reason", "first reason"], { cwd });
  // Re-granting is the documented un-revoke, so a live entry and a revoked one for the SAME action
  // legitimately coexist and a revoke naming that action matches both.
  run(["set-autonomy", "a", "--preauthorize", "drop-scratch-table:re-reviewed"], { cwd });
  const before = autonomyOf(cwd, "a").preAuthorized[0].revoked;

  run(["set-autonomy", "a", "--revoke", "drop-scratch-table", "--revoke-reason", "second reason"], { cwd });

  const a = autonomyOf(cwd, "a");
  assert.equal(a.preAuthorized.length, 2);
  assert.deepEqual(a.preAuthorized[0].revoked, before,
    "the earlier revocation's reason and date describe a DIFFERENT event and are never re-stamped");
  assert.equal(a.preAuthorized[1].revoked.reason, "second reason");
});
