// scripts/test/assert/theme-b3.test.mjs
// Theme B batch B3 (pm 0.51.0), the FILE rung: each test here needs a directory on disk.
//
//   gh#167   `sync --dry-run` writes nothing; `sync --only <id>` registers only what it names
//   spec-sync-waive-for-skip-specs   a waiver takes a delivered epic out of the spec-deltas report; the clear puts it back
//
// The value-shaped half (the rules obligation, the earliest-introduction pick) is scripts/test/unit/theme-b3.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { invokeEngine, run, tmpRepo, withAssertInvocation, writeState } from "../fixtures/assert-harness.mjs";
import { specSyncFindings } from "../../lib/spec-sync.mjs";

const statePath = (cwd) => path.join(cwd, ".conductor", "state.json");
const readState = (cwd) => JSON.parse(fs.readFileSync(statePath(cwd), "utf8"));
const mkdirs = (cwd, ...rel) => { for (const r of rel) fs.mkdirSync(path.join(cwd, r), { recursive: true }); };
const put = (cwd, rel, text) => { fs.mkdirSync(path.dirname(path.join(cwd, rel)), { recursive: true }); fs.writeFileSync(path.join(cwd, rel), text); };
const initRepo = () => { const cwd = tmpRepo(); run(["init"], { cwd }); return cwd; };
/** Every byte sync could write: the state file, the rendered view, and the render stamp. */
const watched = (cwd) => ["PROJECT.md", ".conductor/state.json", ".conductor/render-stamp.json"].map((rel) => {
  const p = path.join(cwd, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
});
/** A repo with two archived changes, one live change and one plan, none of them registered yet. */
function backlogRepo() {
  const cwd = initRepo();
  // `init` runs a quiet sync, which stamps the one-time backfill marker; a repo that has never been
  // synced since an upgrade is the case the flags exist for, so take the marker back off.
  const s = readState(cwd);
  delete s.archiveBackfilledAt;
  writeState(cwd, s);
  mkdirs(cwd, "openspec/changes/archive/2026-01-02-old-a", "openspec/changes/archive/2026-01-03-old-b", "openspec/changes/live-c");
  put(cwd, "docs/superpowers/plans/plan-d.md", "# Plan D\n");
  return cwd;
}

// ─────────────────────────── gh#167: sync --dry-run / --only ───────────────────────────

test("167: sync --dry-run names everything a real run would register, exits 0, and writes nothing", () => {
  const cwd = backlogRepo();
  const before = watched(cwd);
  const r = invokeEngine(["sync", "--dry-run"], { cwd });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(watched(cwd), before, "state.json, PROJECT.md and the render stamp are byte-identical");
  assert.equal("archiveBackfilledAt" in readState(cwd), false, "the one-time backfill marker is NOT consumed by a preview");
  assert.match(r.stdout, /sync --dry-run — 4 epic\(s\) would be registered; nothing was written/);
  assert.match(r.stdout, /would register 1 change\(s\) as untriaged: live-c/);
  assert.match(r.stdout, /would register 1 plan\(s\) as untriaged: plan-d/);
  assert.match(r.stdout, /would register 2 archived change\(s\) as archived: old-a, old-b/);
  assert.match(r.stdout, /one-time archive BACKFILL: it alters the epic counts/, "the backfill is not quiet in a preview either");
  // And the preview told the truth: the real run registers exactly that set.
  const real = invokeEngine(["sync"], { cwd });
  assert.equal(real.status, 0, real.stderr);
  assert.deepEqual(readState(cwd).epics.map(e => e.id).sort(), ["live-c", "old-a", "old-b", "plan-d"]);
});

test("167: sync --dry-run on a repo with nothing to register says so and still writes nothing", () => {
  const cwd = initRepo();
  run(["sync"], { cwd });
  const before = watched(cwd);
  const r = invokeEngine(["sync", "--dry-run"], { cwd });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /0 epic\(s\) would be registered/);
  assert.match(r.stdout, /nothing to register/);
  assert.deepEqual(watched(cwd), before);
});

test("167: a planned epic whose change now exists is previewed as a FLIP, never also as archive drift", () => {
  const cwd = initRepo();
  run(["add-epic", "--id", "live-p", "--lane", "openspec", "--status", "planned"], { cwd });
  mkdirs(cwd, "openspec/changes/live-p");
  const before = watched(cwd);
  const r = invokeEngine(["sync", "--dry-run"], { cwd });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /would flip planned -> untriaged: live-p/);
  assert.doesNotMatch(r.stdout, /would heal/, r.stdout);
  assert.deepEqual(watched(cwd), before);
});

test("167: sync declares its dry-run flag in VERB_EFFECTS, so the detached-tree discarded-write warning skips it", async () => {
  const { VERB_EFFECTS } = await import("../../lib/verb-effects.mjs");
  assert.equal(VERB_EFFECTS.sync.dryRunFlag, "--dry-run");
});

test("167: sync --only registers exactly the named ids, repeatably, and leaves the backfill marker unstamped", () => {
  const cwd = backlogRepo();
  const r = invokeEngine(["sync", "--only", "old-a", "--only", "live-c"], { cwd });
  assert.equal(r.status, 0, r.stderr);
  const s = readState(cwd);
  assert.deepEqual(s.epics.map(e => e.id).sort(), ["live-c", "old-a"], "old-b and plan-d were not named, so not registered");
  assert.equal(s.epics.find(e => e.id === "old-a").status, "archived");
  assert.equal("archiveBackfilledAt" in s, false, "history has not been accounted for, so the next plain sync still announces the backfill");
  const rest = invokeEngine(["sync"], { cwd });
  assert.match(rest.stderr, /archive backfill — registered 1 historical archived change\(s\)[^\n]*old-b/, rest.stderr);
  assert.deepEqual(readState(cwd).epics.map(e => e.id).sort(), ["live-c", "old-a", "old-b", "plan-d"]);
});

test("167: sync --only an id that is neither a candidate nor an epic is refused, naming it, and writes nothing", () => {
  const cwd = backlogRepo();
  const before = watched(cwd);
  for (const extra of [[], ["--dry-run"]]) {
    const r = invokeEngine(["sync", "--only", "old-a", "--only", "typo-id", ...extra], { cwd });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /--only named 'typo-id'[^\n]*nothing was written/);
    assert.deepEqual(watched(cwd), before, `${extra.join(" ") || "real run"}: nothing written`);
  }
});

test("167: sync --only an id that is ALREADY an epic is accepted and registers nothing", () => {
  const cwd = backlogRepo();
  run(["sync", "--only", "live-c"], { cwd });
  const r = invokeEngine(["sync", "--only", "live-c"], { cwd });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readState(cwd).epics.map(e => e.id), ["live-c"]);
});

test("167: sync --only and --dry-run combine, and --only with no value is refused", () => {
  const cwd = backlogRepo();
  const before = watched(cwd);
  const r = invokeEngine(["sync", "--dry-run", "--only", "old-b"], { cwd });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /1 epic\(s\) would be registered/);
  assert.match(r.stdout, /old-b/);
  assert.doesNotMatch(r.stdout, /old-a/);
  assert.deepEqual(watched(cwd), before);
  assert.notEqual(invokeEngine(["sync", "--only"], { cwd }).status, 0, "a valueless --only is refused, never read as 'everything'");
  assert.deepEqual(watched(cwd), before);
});

// ──────────────── spec-sync-waive-for-skip-specs: the waiver and its inverse ────────────────

const req = (n) => `### Requirement: ${n}\nThe system SHALL ${n}.\n`;
const delivered = (id, extra = {}) => ({ id, title: id, priority: "P1", status: "archived", role: "epic", lane: "openspec", links: [],
  disposition: { outcome: "delivered", recordedAt: "2026-09-25T00:00:00.000Z" }, ...extra });
/** An index reader that says the main spec holds nothing, so any ADDED delta reads as absent. */
const emptyMain = (paths) => new Map(paths.map(p => [p, null]));
function skippedSpecsRepo() {
  const cwd = tmpRepo();
  put(cwd, "openspec/changes/archive/2026-09-20-skipped/specs/cap/spec.md", `## ADDED Requirements\n\n${req("Thing")}`);
  return cwd;
}

test("waiver: a delivered epic with an unapplied delta is reported; a recorded waiver takes it out; blank waives nothing", async () => {
  const cwd = skippedSpecsRepo();
  const find = (epic) => withAssertInvocation(cwd, () => specSyncFindings([epic], { readIndex: emptyMain }));
  assert.equal((await find(delivered("skipped"))).length, 1, "precondition: the delta is reported");
  assert.deepEqual(await find(delivered("skipped", { specDeltasWaived: "archived with --skip-specs: spec was folded by hand" })), []);
  assert.equal((await find(delivered("skipped", { specDeltasWaived: "   " }))).length, 1, "a blank waiver is not a reason");
  assert.equal((await find(delivered("skipped", { specDeltasWaived: 7 }))).length, 1, "a non-string value waives nothing");
});

test("waiver: update-epic records it with a REQUIRED reason, and --clear is the inverse (announced)", () => {
  const cwd = initRepo();
  run(["add-epic", "--id", "w1", "--lane", "claude-code"], { cwd });
  const noValue = invokeEngine(["update-epic", "w1", "--spec-deltas-waived"], { cwd });
  assert.notEqual(noValue.status, 0, "no reason, no waiver");
  assert.equal("specDeltasWaived" in readState(cwd).epics[0], false);
  const set = invokeEngine(["update-epic", "w1", "--spec-deltas-waived", "archived with --skip-specs"], { cwd });
  assert.equal(set.status, 0, set.stderr);
  assert.equal(readState(cwd).epics[0].specDeltasWaived, "archived with --skip-specs");
  const clear = invokeEngine(["update-epic", "w1", "--clear", "spec-deltas-waived"], { cwd });
  assert.equal(clear.status, 0, clear.stderr);
  assert.equal("specDeltasWaived" in readState(cwd).epics[0], false, "the field is removed, not nulled");
  assert.match(clear.stderr, /cleared `w1`'s spec-deltas-waived — `delivered-epic-spec-deltas-absent` reports this epic again/);
  const both = invokeEngine(["update-epic", "w1", "--spec-deltas-waived", "x", "--clear", "spec-deltas-waived"], { cwd });
  assert.notEqual(both.status, 0, "set and clear of one field in one call is contradictory");
});
