// scripts/test/unit/conductor-18.test.mjs
// 4.1's migration of `assert/conductor-18.test.mjs` — 10 of its 10 tests, moved from the file rung to
// the unit rung with every assertion unchanged. The file is GONE from the file rung.
//
// 5.3's ASSERTION TWIN of scripts/test/functional/conductor-18.test.mjs — same id, same subject.
//
// THE SUBJECT is two integrity checks that nothing else can see: gh-137, an epic left non-terminal in
// a release whose parent delivered, and gh-112, an epic another epic supersedes that never ended.
// Both are decided ENTIRELY from state.json — no git, no spawn — so every observable is the report
// `integrity` prints, and the fixture's `writeState` is the record the memory store is seeded with.
// Nothing in it needed a path, which is why the whole file left the file rung.
//
//   `tmpRepo()` + `run(["init"], { cwd })`  →  `memoryEngine(record)` (the fixture's own record)
//   `run(["integrity"], { cwd })`           →  `engine(["integrity"])`

import assert from "node:assert/strict";
import { memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

const DELIVERED = "delivered-release-epic-left-open";
const SUPERSEDED = "superseded-epic-never-ended";

const epic = (id, extra = {}) => ({
  id, title: id, priority: "P1", status: "queued", role: "epic", lane: "claude-code", links: [], ...extra,
});

/** The report line for one check, e.g. "<id> — 2 finding(s): ..." */
function countLine(out, id) {
  const m = out.match(new RegExp(`^${id} — (\\d+) finding\\(s\\)`, "m"));
  assert.ok(m, `the report must name ${id} with its count, even at zero:\n${out}`);
  return Number(m[1]);
}

/** The record the file rung's fixture wrote, verbatim — `writeState` replaced the whole of it. */
const repoWith = (record) => memoryEngine({ version: 1, active: null, detourStack: [], ...record });

// ─────────────────── gh-137: a delivered release with work still open ───────────────────

/** A member carrying a `delivered` disposition, which is what makes a release read as delivered:
 *  the release object holds no delivery marker, so the reading is MEMBER-DERIVED by design. */
const shipped = (id) => epic(id, { release: "1.0", status: "archived",
  disposition: { outcome: "delivered", recordedAt: "2026-01-01T00:00:00Z" } });

unitTest("gh-137: an epic left non-terminal in a release whose parent delivered is reported", () => {
  const engine = repoWith({
    releases: [{ id: "1.0", intent: "x", deferred: [] }],
    epics: [shipped("shipped"), epic("left-open", { release: "1.0", status: "queued" })] });
  const out = engine(["integrity"]);
  assert.equal(countLine(out, DELIVERED), 1);
  assert.match(out, /left-open/);
});

unitTest("gh-137: the release's own `deferred[]` excludes an epic cut on purpose", () => {
  const engine = repoWith({
    releases: [{ id: "1.0", intent: "x",
      deferred: [{ epic: "cut", reason: "scope", recordedAt: "2026-01-01T00:00:00Z" }] }],
    epics: [shipped("shipped"), epic("cut", { release: "1.0", status: "queued" })] });
  assert.equal(countLine(engine(["integrity"]), DELIVERED), 0,
    "the record already distinguishes 'cut on purpose' from 'shipped' — consuming one half of it " +
    "and not the other is the whole shape of the bug");
});

unitTest("gh-137: an epic in no release, and a release nothing delivered, are both silent", () => {
  const engine = repoWith({
    releases: [{ id: "1.0", intent: "x", deferred: [] }],
    epics: [epic("free", { status: "queued" })] });
  assert.equal(countLine(engine(["integrity"]), DELIVERED), 0);
});

unitTest("gh-137: a release with work still in flight is silent — a staged release is not a defect", () => {
  const engine = repoWith({
    releases: [{ id: "1.0", intent: "x", deferred: [] }],
    epics: [shipped("shipped"), epic("in-flight", { release: "1.0", status: "active" })] });
  assert.equal(countLine(engine(["integrity"]), DELIVERED), 0,
    "an inflated count is how a true warning gets ignored");
});

unitTest("gh-137: the check never reports an epic whose status is terminal (gh-138)", () => {
  const engine = repoWith({
    releases: [{ id: "1.0", intent: "x", deferred: [] }],
    epics: [shipped("shipped"), epic("ended", { release: "1.0", status: "archived" })] });
  assert.equal(countLine(engine(["integrity"]), DELIVERED), 0);
});

// ─────────────────── gh-112: a superseded epic that never ended ───────────────────

unitTest("gh-112: an epic another epic supersedes, still queued, is reported", () => {
  const engine = repoWith({
    epics: [epic("old", { status: "queued" }),
            epic("new", { links: [{ type: "supersedes", epic: "old", reason: "replaced" }] })] });
  assert.equal(countLine(engine(["integrity"]), SUPERSEDED), 1);
});

unitTest("gh-112: a superseded epic that ENDED is silent (gh-138)", () => {
  const engine = repoWith({
    epics: [epic("old", { status: "archived", disposition: { outcome: "superseded", reason: "r" } }),
            epic("new", { links: [{ type: "supersedes", epic: "old", reason: "replaced" }] })] });
  assert.equal(countLine(engine(["integrity"]), SUPERSEDED), 0);
});

unitTest("gh-112: another link type is not a supersession", () => {
  const engine = repoWith({
    epics: [epic("old", {}), epic("new", { links: [{ type: "relates-to", epic: "old", reason: "r" }] })] });
  assert.equal(countLine(engine(["integrity"]), SUPERSEDED), 0);
});

unitTest("gh-112: a supersedes link naming an epic the record does not hold is not this check's finding", () => {
  const engine = repoWith({
    epics: [epic("new", { links: [{ type: "supersedes", epic: "ghost", reason: "r" }] })] });
  assert.equal(countLine(engine(["integrity"]), SUPERSEDED), 0,
    "a dangling reference is a different check's finding, so this one stays quiet");
});

unitTest("gh-137/gh-112: both checks appear in the report even when they find nothing", () => {
  const engine = repoWith({ epics: [] });
  const out = engine(["integrity"]);
  countLine(out, DELIVERED);
  countLine(out, SUPERSEDED);
});
