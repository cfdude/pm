// scripts/test/unit/conductor-10.test.mjs
// 4.1's migration of `assert/conductor-10.test.mjs` — 7 of its 24 tests, moved from the file rung to
// the unit rung with every assertion unchanged.
//
// ─────────────── WHAT MOVED, AND WHY SO FEW ───────────────
//
// SEVEN moved: the four `add-epic` externalUrl-dedup tests, the legacy-record render, and two
// no-tracker emission tests.
//
// SEVENTEEN STAY, and they are ONE seam edge: EVERY ONE OF THEM RUNS `set-tracker`, which refreshes the
// managed rules block as a side effect (`tracker.mjs:194` → `rules.mjs`'s `writeRules()` →
// `writeFileSync` on CLAUDE.md) — a repository file the store does not own. The unit rung's run-time
// counter names the path and the operation on the first attempt, which is how this was measured rather
// than assumed. Seeding the record's tracker fields instead would have moved the tests while deleting
// what most of them check — that `set-tracker` RECORDS a tracker and `rules` then emits its section —
// which is the same call conductor-04 and conductor-05 made for the same reason.
//
// The mechanism that changed:
//
//   `tmpRepo()` + `run(["init"], { cwd })`  →  `memoryEngine(emptyRecord())`
//   `writeState(cwd, wholeRecord)`          →  a `memoryEngine(wholeRecord)` seed
//   `run(args, { cwd })`                    →  `engine(args)`
//   `readState(cwd)`                        →  `engine.store.record()`
//   `projectMd(cwd)`                        →  `engine.store.read("PROJECT.md").text`

import assert from "node:assert/strict";
import { emptyRecord, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

const readState = (engine) => engine.store.record();
const projectMd = (engine) => engine.store.read("PROJECT.md").text;

unitTest("state.json without secondaryTrackers loads and renders exactly as before this change", () => {
    const engine = memoryEngine({
    version: 1, active: null, detourStack: [],
    tracker: { system: "jira", projectKey: "JOB" },
    epics: [{ id: "a", title: "a", priority: "P1", status: "queued", role: "epic", lane: "claude-code", links: [] }],
  });
  engine(["render"]);
  const md = projectMd(engine);
  assert.match(md, /`a`/);
  const rules = engine(["rules"]);
  assert.doesNotMatch(rules, /market-intelligence/);
});

// ────────────── externalUrl-first dedup (cross-tracker externalId collision fix) ──────────────
unitTest("add-epic dedups by externalUrl when both incoming and an existing epic have one, even if externalId matches", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "mi-42", "--lane", "claude-code", "--external-id", "42",
       "--external-url", "https://github.com/acme/market-intelligence/issues/42"]);
  // Same bare externalId "42", but a DIFFERENT repo's issue — must NOT be treated as a duplicate.
  engine(["add-epic", "--id", "risk-42", "--lane", "claude-code", "--external-id", "42",
       "--external-url", "https://github.com/acme/risk-engine/issues/42"]);
  const ids = readState(engine).epics.map(e => e.id).sort();
  assert.deepEqual(ids, ["mi-42", "risk-42"]);
});
unitTest("add-epic still rejects a true duplicate externalUrl", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "mi-42", "--lane", "claude-code", "--external-id", "42",
       "--external-url", "https://github.com/acme/market-intelligence/issues/42"]);
  assert.throws(() => engine(["add-epic", "--id", "mi-42-dup", "--lane", "claude-code", "--external-id", "42",
       "--external-url", "https://github.com/acme/market-intelligence/issues/42"]));
  const ids = readState(engine).epics.map(e => e.id);
  assert.deepEqual(ids, ["mi-42"]);
});
unitTest("add-epic falls back to bare externalId dedup when neither side has a URL", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "job-1", "--lane", "claude-code", "--external-id", "JOB-1"]);
  assert.throws(() => engine(["add-epic", "--id", "job-1-dup", "--lane", "claude-code", "--external-id", "JOB-1"]));
  const ids = readState(engine).epics.map(e => e.id);
  assert.deepEqual(ids, ["job-1"]);
});
unitTest("a URL-less legacy epic never falsely blocks a genuinely distinct, URL-bearing epic sharing the same bare externalId (Gate 2 finding)", () => {
  const engine = memoryEngine(emptyRecord());
  // Legacy epic registered with only a bare externalId, no URL.
  engine(["add-epic", "--id", "legacy-42", "--lane", "claude-code", "--external-id", "42"]);
  // A genuinely distinct epic happens to share the bare id "42" but DOES carry a URL — must
  // NOT be treated as a duplicate of the URL-less legacy entry.
  engine(["add-epic", "--id", "risk-42", "--lane", "claude-code", "--external-id", "42",
       "--external-url", "https://github.com/acme/risk-engine/issues/42"]);
  const ids = readState(engine).epics.map(e => e.id).sort();
  assert.deepEqual(ids, ["legacy-42", "risk-42"]);
});

// ────────────── rulesBlock(): secondary-tracker inward pull + status writeback ──────────────
unitTest("rulesBlock omits the resync instruction when no tracker is configured at all", () => {
  const engine = memoryEngine(emptyRecord());
  const rules = engine(["rules"]);
  assert.doesNotMatch(rules, /Sync after completing tracker-linked work/);
});
unitTest("SessionStart brief has no sync nudge when no tracker is configured", () => {
  const engine = memoryEngine(emptyRecord());
  const brief = engine(["brief"]);
  assert.doesNotMatch(brief, /consider `\/pm:sync` this session/);
});
