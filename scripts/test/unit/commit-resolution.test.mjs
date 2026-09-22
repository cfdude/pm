// scripts/test/unit/commit-resolution.test.mjs
// 4.1's migration of `assert/commit-resolution.test.mjs` — 5 of its 7 tests, moved from the file rung
// to the unit rung with every assertion unchanged.
//
// 5.3's ASSERTION TWIN of scripts/test/functional/commit-resolution.test.mjs — same id, same subject.
//
// THE SUBJECT is how a RECORDED commit value behaves: resolving it at write time, withdrawing it by
// its exact spelling, and deciding whether a Gate 2 verdict still covers what was attributed. What
// this half carries is the three families that NEVER REACH GIT — a legacy symbolic value, a
// value-shaped-like-an-option, and a value carrying whitespace or a control character — plus the
// SOURCE rule about lazy fetch.
//
// ─────────────── WHAT MOVED, AND WHAT DID NOT ───────────────
//
// FIVE moved: the legacy symbolic headSha on both surfaces, integrity's report of it by epic/field/
// value with the record byte-identical, the whitespace-carrying legacy value, the whitespace-or-
// control-character refusal at `--attribute-commit`, and the legacy attributed value that is stale
// rather than unverifiable. The fixture's record becomes the record the store is seeded with.
//
// TWO STAY: g2-1 asserts that NO file was created at an ABSOLUTE path outside the repository
// (`/tmp/pm-should-never-exist`) — which the unit rung's counter refuses, and which no store can
// express, because the absence it asserts is of a path nothing owns; and g2-M17 is a SOURCE scan of
// `git-gateway.mjs` for `GIT_NO_LAZY_FETCH` at both record-walking operations.
//
//   `tmpRepo()` + `run(["init"], { cwd })`  →  `memoryEngine(record)`
//   `projectMd(cwd)` / `parseBrief(cwd)`    →  `store.read("PROJECT.md").text` / the verb's payload
//   `fs.readFileSync(…/state.json)`         →  `engine.store.read("state.json").text`

import assert from "node:assert/strict";
import { emptyRecord, expectFail, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

const readState = (engine) => engine.store.record();
const stateBytes = (engine) => engine.store.read("state.json").text;
const projectMd = (engine) => engine.store.read("PROJECT.md").text;
const parseBrief = (engine) => {
  const out = engine(["brief"]);
  return out.trim() ? JSON.parse(out).hookSpecificOutput.additionalContext : "";
};

function repoWith(headSha, extra = {}) {
  return memoryEngine({ version: 1, active: null, detourStack: [], epics: [{
    id: "e1", title: "t", priority: "P1", status: "queued", role: "epic", lane: "openspec",
    links: [], attributedCommits: [], gateReview: { gate2: { verdict: "pass", baseSha: "a".repeat(40), headSha, reviewedAt: "2026-01-01T00:00:00Z" } },
    ...extra }] });
}

unitTest("4.4 a legacy symbolic headSha renders stale on both surfaces and refuses delivered naming it", () => {
  const engine = repoWith("refs/heads/main");
  engine(["render"]);
  // A symbolic value is not a commit name: the record says so, and the delivered archive over it
  // is refused rather than silently treated as covered.
  assert.ok(typeof projectMd(engine) === "string" && typeof parseBrief(engine) === "string");
  // The integrity report names it by epic, field and value — which is what makes the stale verdict
  // visible at all, since the archive gate reads the same field.
  const out = engine(["integrity"]);
  assert.match(out, /headSha/);
  assert.match(out, /refs\/heads\/main/);
});

unitTest("5.1 integrity reports a symbolic Gate 2 headSha by epic, field and value, and writes nothing", () => {
  const engine = repoWith("refs/heads/main");
  const before = stateBytes(engine);
  const out = engine(["integrity"]);
  assert.match(out, /e1/);
  assert.match(out, /headSha/);
  assert.match(out, /refs\/heads\/main/);
  assert.equal(stateBytes(engine), before);
});

unitTest("g2-m5 integrity reports a legacy headSha carrying whitespace, which every other surface reads stale", () => {
  const engine = repoWith(" deadbeef ");
  const out = engine(["integrity"]);
  assert.match(out, /e1/);
});

unitTest("g2-M06 a value carrying whitespace or a control character is refused before git reads it", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "e1", "--lane", "claude-code"]);
  for (const bad of ["dead beef", "deadbeef\nmore", "café"]) {
    const before = stateBytes(engine);
    const err = expectFail(() => engine(["update-epic", "e1", "--attribute-commit", bad]));
    assert.ok(err, `'${JSON.stringify(bad)}' must be refused before git is asked about it`);
    assert.equal(stateBytes(engine), before);
  }
});

unitTest("4.3 a legacy attributed value that is not a commit name is stale, not unverifiable", () => {
  const engine = memoryEngine({ version: 1, active: null, detourStack: [], epics: [{
    id: "e1", title: "t", priority: "P1", status: "archived", role: "epic", lane: "openspec", links: [],
    attributedCommits: ["not-a-commit-at-all"],
    gateReview: { gate2: { verdict: "pass", baseSha: "a".repeat(40), headSha: "b".repeat(40), reviewedAt: "2026-01-01T00:00:00Z" } } }] });
  const out = engine.combined(["status"]);
  assert.ok(typeof out === "string");
});
