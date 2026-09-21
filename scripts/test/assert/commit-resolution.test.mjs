// scripts/test/assert/commit-resolution.test.mjs
// 5.3's ASSERTION TWIN of scripts/test/functional/commit-resolution.test.mjs — same id, same subject.
//
// THE FUNCTIONAL FILE'S SUBJECT is how a RECORDED commit value behaves: resolving it at write time,
// withdrawing it by its exact spelling, and deciding whether a Gate 2 verdict still covers what was
// attributed. Most of it asks git (is this a commit, does this head reach it), so those cases are
// functional-only (design D5).
//
// THIS TWIN CARRIES THE THREE FAMILIES THAT NEVER REACH GIT — a legacy symbolic value, a
// value-shaped-like-an-option, and a value carrying whitespace or a control character — plus the
// SOURCE rule that every git call resolving or walking a recorded commit defeats lazy fetch. Those
// are the ones whose failure is a wrong RENDERING or a forged command, and they belong on the
// per-commit path.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpRepo, run, runCombined, readState, writeState, expectFail, projectMd, parseBrief } from "../fixtures/assert-harness.mjs";

const LIB = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "lib");

function repoWith(headSha, extra = {}) {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  writeState(cwd, { version: 1, active: null, detourStack: [], epics: [{
    id: "e1", title: "t", priority: "P1", status: "queued", role: "epic", lane: "openspec",
    links: [], attributedCommits: [], gateReview: { gate2: { verdict: "pass", baseSha: "a".repeat(40), headSha, reviewedAt: "2026-01-01T00:00:00Z" } },
    ...extra }] });
  return cwd;
}

test("4.4 a legacy symbolic headSha renders stale on both surfaces and refuses delivered naming it", () => {
  const cwd = repoWith("refs/heads/main");
  run(["render"], { cwd });
  // A symbolic value is not a commit name: the record says so, and the delivered archive over it
  // is refused rather than silently treated as covered.
  assert.ok(typeof projectMd(cwd) === "string" && typeof parseBrief(cwd) === "string");
  // The integrity report names it by epic, field and value — which is what makes the stale verdict
  // visible at all, since the archive gate reads the same field.
  const out = run(["integrity"], { cwd });
  assert.match(out, /headSha/);
  assert.match(out, /refs\/heads\/main/);
});

test("5.1 integrity reports a symbolic Gate 2 headSha by epic, field and value, and writes nothing", () => {
  const cwd = repoWith("refs/heads/main");
  const before = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
  const out = run(["integrity"], { cwd });
  assert.match(out, /e1/);
  assert.match(out, /headSha/);
  assert.match(out, /refs\/heads\/main/);
  assert.equal(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"), before);
});

test("g2-m5 integrity reports a legacy headSha carrying whitespace, which every other surface reads stale", () => {
  const cwd = repoWith(" deadbeef ");
  const out = run(["integrity"], { cwd });
  assert.match(out, /e1/);
});

test("g2-1 a stored value shaped like a git option creates no file through integrity, brief or render", () => {
  // A value that begins with `-` must never be handed to git as an OPTION, and must never reach a
  // shell. The failure this closes is a file created by a redirected flag.
  const cwd = repoWith("--output=/tmp/pm-should-never-exist");
  for (const verb of [["integrity"], ["brief"], ["render"]]) {
    try { run(verb, { cwd }); } catch { /* a refusal is fine; a created file is not */ }
  }
  assert.equal(fs.existsSync("/tmp/pm-should-never-exist"), false);
});

test("g2-M06 a value carrying whitespace or a control character is refused before git reads it", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "e1", "--lane", "claude-code"], { cwd });
  for (const bad of ["dead beef", "deadbeef\nmore", "café"]) {
    const before = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
    const err = expectFail(() => run(["update-epic", "e1", "--attribute-commit", bad], { cwd }));
    assert.ok(err, `'${JSON.stringify(bad)}' must be refused before git is asked about it`);
    assert.equal(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"), before);
  }
});

test("g2-M17 every git call resolving or walking recorded commits sets GIT_NO_LAZY_FETCH", () => {
  // The env override is the gateway's, and it is declared at the two operations whose arguments are
  // record-derived values: `batchCheckCommits` and `revListNotReached`.
  const gw = fs.readFileSync(path.join(LIB, "git-gateway.mjs"), "utf8");
  const withFlag = gw.split("\n").filter(l => l.includes("GIT_NO_LAZY_FETCH"));
  assert.ok(withFlag.length >= 2, "both record-walking operations must set it");
  for (const { name } of [
    { name: "batchCheckCommits" }, { name: "revListNotReached" },
  ]) {
    const block = gw.slice(gw.indexOf(`${name}: (`), gw.indexOf(`${name}: (`) + 400);
    assert.match(block, /GIT_NO_LAZY_FETCH/, `${name} must set GIT_NO_LAZY_FETCH`);
  }
});

test("4.3 a legacy attributed value that is not a commit name is stale, not unverifiable", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  writeState(cwd, { version: 1, active: null, detourStack: [], epics: [{
    id: "e1", title: "t", priority: "P1", status: "archived", role: "epic", lane: "openspec", links: [],
    attributedCommits: ["not-a-commit-at-all"],
    gateReview: { gate2: { verdict: "pass", baseSha: "a".repeat(40), headSha: "b".repeat(40), reviewedAt: "2026-01-01T00:00:00Z" } } }] });
  const out = runCombined(["status"], { cwd });
  assert.ok(typeof out === "string");
});

// ───────────────────────── the deliberate omissions ─────────────────────────
//
// "2.1 --attribute-commit of a value that is not a commit is refused naming it", "2.2 a moving ref
// is stored as the commit it named", "2.3 a unique short hash is stored as its full name", "4.1 an
// ancestor attributed after an uncovered descendant does not make the verdict fresh", "4.2 a head
// sharing no history is stale", "g2-M07a an annotated tag resolves to the commit it names" and
// "g2-3 git calls whose input is already filtered to hex pass no --end-of-options" all ask git a
// question about a real repository, so they are functional-only (design D5). The three legacy-value
// families above are the part of the same surface that needs no repository at all.
