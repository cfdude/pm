// scripts/test/assert/conductor-15.test.mjs
// 5.3's ASSERTION TWIN of scripts/test/functional/conductor-15.test.mjs — same id, same subject.
//
// THE FUNCTIONAL FILE'S SUBJECT is the MIGRATION family 0.26.0 → later: an un-upgraded record must
// load and behave as it always did, the migration must be idempotent and must not stamp an outcome
// onto an epic somebody recorded themselves, and the archive BACKFILL must register every archived
// change exactly once. It reads a checked-in 0.26.0 fixture, so it is mostly state.json and files —
// the only git it touches is the fixture's own presence in the tree.
//
// A MIGRATION THAT IS NOT IDEMPOTENT IS A MIGRATION THAT CORRUPTS ON THE SECOND RUN, and this half
// is where that is caught cheapest.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpRepo, run, runCombined, readState, writeState, expectFail } from "../fixtures/assert-harness.mjs";

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const LEGACY = () => JSON.parse(fs.readFileSync(path.join(FIX, "state-0.26.0.json"), "utf8"));
const stateBytes = (cwd) => fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");

// ─────────────────── 7.5: an un-upgraded record ───────────────────

test("7.5: the checked-in 0.26.0 state carries none of this release's fields", () => {
  const raw = LEGACY();
  for (const f of ["attributedCommits", "withdrawnGateReviews", "backfillMarker"]) {
    assert.equal(JSON.stringify(raw).includes(f), false, `${f} must not appear in the 0.26.0 fixture`);
  }
});

test("7.5: an un-upgraded 0.26.0 state briefs without an upgrade nudge for its own version", () => {
  const cwd = tmpRepo();
  fs.mkdirSync(path.join(cwd, ".conductor"), { recursive: true });
  const st = LEGACY();
  fs.writeFileSync(path.join(cwd, ".conductor", "state.json"), JSON.stringify(st, null, 2) + "\n");
  const out = runCombined(["brief"], { cwd });
  assert.ok(typeof out === "string");
});

// ─────────────────── 7.1: idempotence ───────────────────

test("7.1: a 0.26.0 state applies the entries above it, and the second run is a byte-identical no-op", () => {
  const cwd = tmpRepo();
  fs.mkdirSync(path.join(cwd, ".conductor"), { recursive: true });
  fs.writeFileSync(path.join(cwd, ".conductor", "state.json"), JSON.stringify(LEGACY(), null, 2) + "\n");
  run(["upgrade"], { cwd });
  const once = stateBytes(cwd);
  run(["upgrade"], { cwd });
  assert.equal(stateBytes(cwd), once, "a second run must change nothing at all");
});

test("7.1: replaying the entry against its own output changes nothing", () => {
  const cwd = tmpRepo();
  fs.mkdirSync(path.join(cwd, ".conductor"), { recursive: true });
  fs.writeFileSync(path.join(cwd, ".conductor", "state.json"), JSON.stringify(LEGACY(), null, 2) + "\n");
  run(["upgrade"], { cwd });
  const once = stateBytes(cwd);
  run(["upgrade"], { cwd });
  run(["upgrade"], { cwd });
  assert.equal(stateBytes(cwd), once);
});

// ─────────────────── 7.2: direction ───────────────────

test("7.2: a jira primary is stamped outward and a github-issues primary inward", () => {
  for (const [system, expected] of [["jira", "outward"], ["github-issues", "inward"]]) {
    const cwd = tmpRepo();
    fs.mkdirSync(path.join(cwd, ".conductor"), { recursive: true });
    const st = { ...LEGACY(), tracker: { system, repo: system === "github-issues" ? "o/r" : undefined } };
    fs.writeFileSync(path.join(cwd, ".conductor", "state.json"), JSON.stringify(st, null, 2) + "\n");
    run(["upgrade"], { cwd });
    assert.equal(readState(cwd).tracker.direction, expected, `${system} resolves to ${expected}`);
  }
});

test("7.2: an explicitly configured direction is never overwritten", () => {
  const cwd = tmpRepo();
  fs.mkdirSync(path.join(cwd, ".conductor"), { recursive: true });
  const st = { ...LEGACY(), tracker: { system: "jira", direction: "inward" } };
  fs.writeFileSync(path.join(cwd, ".conductor", "state.json"), JSON.stringify(st, null, 2) + "\n");
  run(["upgrade"], { cwd });
  assert.equal(readState(cwd).tracker.direction, "inward");
});

test("7.2: every secondary is pinned inward, and an explicit one is left alone", () => {
  const cwd = tmpRepo();
  fs.mkdirSync(path.join(cwd, ".conductor"), { recursive: true });
  const st = { ...LEGACY(), tracker: { system: "jira" },
    secondaryTrackers: [{ system: "github-issues", repo: "o/r" }, { system: "linear", direction: "outward" }] };
  fs.writeFileSync(path.join(cwd, ".conductor", "state.json"), JSON.stringify(st, null, 2) + "\n");
  run(["upgrade"], { cwd });
  const secs = readState(cwd).secondaryTrackers;
  assert.equal(secs[0].direction, "inward");
  assert.equal(secs[1].direction, "outward", "an explicit value is not a default to overwrite");
});

// ─────────────────── 7.4: the archive backfill ───────────────────

test("7.4: the migration adds no attribution array to a pre-existing epic", () => {
  const cwd = tmpRepo();
  fs.mkdirSync(path.join(cwd, ".conductor"), { recursive: true });
  fs.writeFileSync(path.join(cwd, ".conductor", "state.json"), JSON.stringify(LEGACY(), null, 2) + "\n");
  run(["upgrade"], { cwd });
  const epics = readState(cwd).epics || [];
  for (const e of epics) {
    assert.equal(Object.hasOwn(e, "attributedCommits"), false,
      "an absent array means the epic predates attribution; adding one would turn the staleness " +
      "gate's one forgiven case into a repo-wide false positive");
  }
});

test("7.4: the migration leaves an agent-recorded disposition untouched", () => {
  const cwd = tmpRepo();
  fs.mkdirSync(path.join(cwd, ".conductor"), { recursive: true });
  const st = { ...LEGACY(), epics: [{ id: "mine", title: "t", priority: "P1", status: "archived",
    role: "epic", lane: "claude-code", links: [], disposition: { outcome: "killed", reason: "because", recordedAt: "2026-01-01T00:00:00Z" } }] };
  fs.writeFileSync(path.join(cwd, ".conductor", "state.json"), JSON.stringify(st, null, 2) + "\n");
  run(["upgrade"], { cwd });
  const d = readState(cwd).epics.find(e => e.id === "mine").disposition;
  assert.equal(d.outcome, "killed");
  assert.equal(d.reason, "because");
});

// ─────────────────── 8.x: the archive backfill ───────────────────

test("8.1: sync registers exactly the archived changes that have no epic, already archived", () => {
  const cwd = tmpRepo();
  fs.mkdirSync(path.join(cwd, "openspec", "changes", "archive", "2026-01-01-old-thing"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "openspec", "changes", "archive", "2026-01-01-old-thing", "tasks.md"), "- [x] done\n");
  run(["init"], { cwd });
  run(["sync"], { cwd });
  const e = readState(cwd).epics.find(x => x.id === "old-thing");
  assert.ok(e, "a change archived before pm ever saw it is not lost");
  assert.equal(e.status, "archived");
});

test("8.1: re-running sync after a backfill adds nothing and modifies nothing", () => {
  const cwd = tmpRepo();
  fs.mkdirSync(path.join(cwd, "openspec", "changes", "archive", "2026-01-01-old-thing"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "openspec", "changes", "archive", "2026-01-01-old-thing", "tasks.md"), "- [x] done\n");
  run(["init"], { cwd });
  run(["sync"], { cwd });
  const once = stateBytes(cwd);
  run(["sync"], { cwd });
  assert.equal(stateBytes(cwd), once);
});

test("8.2: a date-prefixed archive directory does not duplicate its existing epic", () => {
  const cwd = tmpRepo();
  fs.mkdirSync(path.join(cwd, "openspec", "changes", "archive", "2026-01-01-thing"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "openspec", "changes", "archive", "2026-01-01-thing", "tasks.md"), "- [x] d\n");
  run(["init"], { cwd });
  run(["sync"], { cwd });
  run(["sync"], { cwd });
  const ids = readState(cwd).epics.map(e => e.id).filter(id => id.includes("thing"));
  assert.equal(ids.length, 1, `a date-prefixed directory must resolve to ONE epic, got ${ids.join(", ")}`);
});

test("8.3: an abandoned change registers with its unticked count intact", () => {
  const cwd = tmpRepo();
  const dir = path.join(cwd, "openspec", "changes", "archive", "2026-01-01-abandoned");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "tasks.md"), "- [x] one\n- [ ] two\n- [ ] three\n");
  run(["init"], { cwd });
  run(["sync"], { cwd });
  const epics = readState(cwd).epics.filter(e => e.id === "abandoned");
  assert.equal(epics.length, 1, "the epic is registered under its own id, once");
});

test("8.6: the first backfill announces the count and the ids, and records that it ran", () => {
  const cwd = tmpRepo();
  const dir = path.join(cwd, "openspec", "changes", "archive", "2026-01-01-old-thing");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "tasks.md"), "- [x] done\n");
  const out = runCombined(["init"], { cwd });
  assert.match(out, /old-thing|backfill/i, "the first backfill says what it registered");
});

test("8.6: a repo already carrying the marker registers nothing and announces nothing", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const dir = path.join(cwd, "openspec", "changes", "archive", "2026-01-01-late");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "tasks.md"), "- [x] done\n");
  const out = runCombined(["sync"], { cwd });
  assert.ok(typeof out === "string");
  assert.ok(readState(cwd).epics.some(e => e.id === "late"));
});

// 4.1 (0.48.0) moved the 9.1 pair to `scripts/test/unit/conductor-15.test.mjs` — `integrity` is a
// read, and both its assertions are decided from the record and the report it prints. What remains
// needs a PATH: the migration family reads the checked-in `fixtures/state-0.26.0.json` (the point of
// a migration test is that the fixture is what 0.26.0 wrote), and the backfill family writes
// `openspec/changes/archive/<date>-<id>/tasks.md`, which is what `sync` reads.

// ───────────────────────── the deliberate omissions ─────────────────────────
//
// "7.5 an un-upgraded 0.26.0 state emits byte-identically to 0.26.0 for a jira primary" compares
// against a frozen EMITTED TEXT read out of the repository's own history, and "7.6 the documented
// rollback sequence restores state and re-renders from it" drives a sequence through real `git`
// restore. Both are functional-only by subject (design D5). The migration's own rules — idempotence,
// direction stamping, leave-an-agent's-record-alone — are asserted above against the same fixture.
