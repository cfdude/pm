// The RELEASE-scope review gate (gh#126).
//
// pm's gate vocabulary is per CHANGE: Gate 1 reviews one change's artifacts, Gate 2 its
// implementation. A release is many changes, and nothing asked whether a release's specs AGREE
// WITH EACH OTHER. On 0.27.0 that question returned 5 Critical and 10 Important against six
// specs that had each passed `openspec validate --strict` and would each have passed Gate 1
// alone. These tests bind the engine half of closing that gap: the spec set is ENUMERATED from
// disk (never asserted by the agent), the verdict records a digest per spec, and a spec ADDED
// or CHANGED after the verdict makes it stale.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { run, runCombined, tmpRepo, readState, writeState, projectMd, parseBrief, expectFail } from "./helpers.mjs";
import { releaseSpecFiles, crossSpecStaleness, crossSpecRequired } from "../lib/cross-spec-review.mjs";

/** Write `openspec/changes/<changeId>/specs/<cap>/spec.md` for each capability. */
function withChange(cwd, changeId, caps, { archived = false, body = "# spec\n" } = {}) {
  const base = archived
    ? path.join(cwd, "openspec", "changes", "archive", `2026-08-25-${changeId}`)
    : path.join(cwd, "openspec", "changes", changeId);
  for (const cap of caps) {
    const dir = path.join(base, "specs", cap);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "spec.md"), body);
  }
  fs.writeFileSync(path.join(base, "tasks.md"), "- [x] one\n");
  return base;
}

/** A repo with one openspec change carrying `caps` specs, registered into release `rel`. */
function releaseRepo(caps, { changeId = "big-change", extra = () => {} } = {}) {
  const cwd = tmpRepo();
  withChange(cwd, changeId, caps);
  extra(cwd);
  run(["init"], { cwd });
  run(["release", "rel", "--intent", "the release under test", "--member", changeId], { cwd });
  return { cwd, changeId };
}

// ───────────────────────── enumeration: the engine derives the set ─────────────────────────

test("releaseSpecFiles enumerates every member change's specs, keyed change-relative", () => {
  const { cwd } = releaseRepo(["alpha", "beta", "gamma"]);
  const state = readState(cwd);
  const specs = releaseSpecFiles(state, state.epics, "rel", cwd);
  assert.deepEqual(specs.map(s => s.key), [
    "big-change/specs/alpha/spec.md",
    "big-change/specs/beta/spec.md",
    "big-change/specs/gamma/spec.md",
  ]);
  assert.ok(specs.every(s => fs.existsSync(s.abs)), "every enumerated spec must resolve to a real file");
});

test("releaseSpecFiles finds an ARCHIVED change's specs under its date-prefixed directory", () => {
  const cwd = tmpRepo();
  withChange(cwd, "shipped", ["alpha", "beta"], { archived: true });
  run(["init"], { cwd });   // sync registers the archived change as an epic on its own
  run(["release", "rel", "--intent", "x", "--member", "shipped"], { cwd });
  const state = readState(cwd);
  assert.deepEqual(releaseSpecFiles(state, state.epics, "rel", cwd).map(s => s.key), [
    "shipped/specs/alpha/spec.md",
    "shipped/specs/beta/spec.md",
  ]);
});

test("releaseSpecFiles ignores epics that are not members and counts a dual-lane pair once", () => {
  const cwd = tmpRepo();
  withChange(cwd, "in-release", ["alpha", "beta"]);
  withChange(cwd, "out-of-release", ["gamma"]);
  run(["init"], { cwd });
  run(["release", "rel", "--intent", "x", "--member", "in-release"], { cwd });
  // A dual-lane pair — the same change registered twice under different lanes — is a real shape
  // here: integrity reports 4 of them in this repository, and #64/#69 are why. add-epic refuses a
  // duplicate id, so the pair is written the way sync produced the live ones: straight into the
  // record. Its specs must be counted ONCE, or the flat count that decides whether the gate
  // applies is a function of a registration bug.
  const seeded = readState(cwd);
  seeded.epics.push({ ...seeded.epics.find(e => e.id === "in-release"), lane: "superpowers" });
  writeState(cwd, seeded);
  const state = readState(cwd);
  assert.equal(state.epics.filter(e => e.id === "in-release").length, 2, "the fixture must actually duplicate");
  const keys = releaseSpecFiles(state, state.epics, "rel", cwd).map(s => s.key);
  assert.deepEqual(keys, ["in-release/specs/alpha/spec.md", "in-release/specs/beta/spec.md"]);
});

test("crossSpecRequired is a FLAT SPEC COUNT, not a member count", () => {
  // One member change carrying six specs is exactly 0.27.0's shape, and it is the case a
  // member-count threshold silently drops.
  assert.equal(crossSpecRequired([{ key: "a" }]), false);
  assert.equal(crossSpecRequired([{ key: "a" }, { key: "b" }]), true);
});

// ───────────────────────── recording the verdict ─────────────────────────

test("record-cross-spec-review stores the verdict with an engine-computed digest per spec", () => {
  const { cwd } = releaseRepo(["alpha", "beta", "gamma"]);
  run(["record-cross-spec-review", "rel", "--verdict", "pass", "--reviewer", "two lenses"], { cwd });
  const rel = readState(cwd).releases.find(r => r.id === "rel");
  assert.equal(rel.crossSpecReview.verdict, "pass");
  assert.equal(rel.crossSpecReview.reviewer, "two lenses");
  assert.ok(rel.crossSpecReview.reviewedAt, "the verdict must carry when it was reached");
  assert.equal(rel.crossSpecReview.specs.length, 3);
  for (const s of rel.crossSpecReview.specs) {
    assert.match(s.sha256, /^[0-9a-f]{64}$/, "the engine hashes the file it read");
    assert.match(s.key, /^big-change\/specs\//);
  }
});

test("record-cross-spec-review refuses a release below the two-spec threshold", () => {
  const { cwd } = releaseRepo(["only"]);
  const err = expectFail(() => run(["record-cross-spec-review", "rel", "--verdict", "pass"], { cwd }));
  assert.ok(err, "a one-spec release must not be able to record a cross-spec verdict");
  assert.match(err.stderr, /1 spec file/);
  assert.equal(readState(cwd).releases.find(r => r.id === "rel").crossSpecReview, undefined);
});

test("record-cross-spec-review refuses an unknown release, an unknown flag and a bad verdict", () => {
  const { cwd } = releaseRepo(["alpha", "beta"]);
  assert.match(expectFail(() => run(["record-cross-spec-review", "nope", "--verdict", "pass"], { cwd })).stderr,
    /release 'nope'/);
  assert.match(expectFail(() => run(["record-cross-spec-review", "rel", "--verdict", "maybe"], { cwd })).stderr,
    /pass\|fail/);
  // The projected allowlist — the shared EPIC_FLAGS registry, never a second literal here.
  assert.match(expectFail(() => run(["record-cross-spec-review", "rel", "--verdict", "pass", "--reviewr", "x"], { cwd })).stderr,
    /unknown flag\(s\) --reviewr/);
});

test("re-recording supersedes the prior verdict once, never a growing chain", () => {
  const { cwd } = releaseRepo(["alpha", "beta"]);
  run(["record-cross-spec-review", "rel", "--verdict", "fail", "--reviewer", "round 1"], { cwd });
  run(["record-cross-spec-review", "rel", "--verdict", "fail", "--reviewer", "round 2"], { cwd });
  run(["record-cross-spec-review", "rel", "--verdict", "pass", "--reviewer", "round 3"], { cwd });
  const entry = readState(cwd).releases.find(r => r.id === "rel").crossSpecReview;
  assert.equal(entry.reviewer, "round 3");
  assert.equal(entry.superseded.reviewer, "round 2");
  assert.equal(entry.superseded.superseded, undefined, "one nested level only");
});

// ───────────────────────── staleness: what a RELEASE gate exists for ─────────────────────────

test("a spec ADDED to the release after the verdict makes it stale", () => {
  const { cwd } = releaseRepo(["alpha", "beta"]);
  run(["record-cross-spec-review", "rel", "--verdict", "pass"], { cwd });
  let state = readState(cwd);
  assert.equal(crossSpecStaleness(state.releases[0], releaseSpecFiles(state, state.epics, "rel", cwd)).state, "fresh");

  // A seventh capability lands after the review. Per-spec review would pass it; the SET was
  // never reviewed as a set again. This is the case a change-scoped gate structurally misses.
  withChange(cwd, "big-change", ["delta"]);
  state = readState(cwd);
  const st = crossSpecStaleness(state.releases[0], releaseSpecFiles(state, state.epics, "rel", cwd));
  assert.equal(st.state, "stale");
  assert.deepEqual(st.added, ["big-change/specs/delta/spec.md"]);
});

test("a spec whose CONTENT changed after the verdict makes it stale", () => {
  const { cwd } = releaseRepo(["alpha", "beta"]);
  run(["record-cross-spec-review", "rel", "--verdict", "pass"], { cwd });
  fs.writeFileSync(path.join(cwd, "openspec", "changes", "big-change", "specs", "beta", "spec.md"),
    "# spec\n\nAmended after the review.\n");
  const state = readState(cwd);
  const st = crossSpecStaleness(state.releases[0], releaseSpecFiles(state, state.epics, "rel", cwd));
  assert.equal(st.state, "stale");
  assert.deepEqual(st.changed, ["big-change/specs/beta/spec.md"]);
  assert.deepEqual(st.added, []);
});

test("the ARCHIVE MOVE does not make a verdict stale", () => {
  // `/opsx:archive` relocates openspec/changes/<id>/ under archive/<date>-<id>/. Keying the
  // record on the on-disk path would report every archived release stale forever — the same
  // trap gateStaleness() documents for the attributed-commit array.
  const { cwd } = releaseRepo(["alpha", "beta"]);
  run(["record-cross-spec-review", "rel", "--verdict", "pass"], { cwd });
  const from = path.join(cwd, "openspec", "changes", "big-change");
  const to = path.join(cwd, "openspec", "changes", "archive", "2026-08-26-big-change");
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.renameSync(from, to);
  const state = readState(cwd);
  const specs = releaseSpecFiles(state, state.epics, "rel", cwd);
  assert.equal(specs.length, 2, "the archived change's specs are still enumerated");
  assert.equal(crossSpecStaleness(state.releases[0], specs).state, "fresh");
});

test("no recorded verdict reads as 'none', and an unreadable spec as 'unverifiable'", () => {
  const { cwd } = releaseRepo(["alpha", "beta"]);
  let state = readState(cwd);
  assert.equal(crossSpecStaleness(state.releases[0], releaseSpecFiles(state, state.epics, "rel", cwd)).state, "none");
  run(["record-cross-spec-review", "rel", "--verdict", "pass"], { cwd });
  state = readState(cwd);
  const specs = releaseSpecFiles(state, state.epics, "rel", cwd);
  specs.push({ key: "big-change/specs/ghost/spec.md", abs: path.join(cwd, "nope", "spec.md") });
  assert.equal(crossSpecStaleness(state.releases[0], specs).state, "unverifiable");
});

// ───────────────────────── the surfaces report it ─────────────────────────

test("PROJECT.md and the brief warn when a multi-spec release has no cross-spec review", () => {
  const { cwd } = releaseRepo(["alpha", "beta"]);
  run(["render"], { cwd });
  assert.match(projectMd(cwd), /no cross-spec review/);
  assert.match(parseBrief(cwd), /no cross-spec review/);
});

test("PROJECT.md and the brief report a recorded verdict, and mark it stale when it goes stale", () => {
  const { cwd } = releaseRepo(["alpha", "beta"]);
  run(["record-cross-spec-review", "rel", "--verdict", "pass", "--reviewer", "two lenses"], { cwd });
  assert.match(projectMd(cwd), /cross-spec pass \(2 specs\) · two lenses/);
  assert.doesNotMatch(projectMd(cwd), /⚠ stale/);
  withChange(cwd, "big-change", ["delta"]);
  run(["render"], { cwd });
  assert.match(projectMd(cwd), /cross-spec pass \(2 specs\) · two lenses ⚠ stale/);
  assert.match(parseBrief(cwd), /⚠ stale/);
});

test("a single-spec release gets no cross-spec line at all", () => {
  const { cwd } = releaseRepo(["only"]);
  run(["render"], { cwd });
  assert.doesNotMatch(projectMd(cwd), /cross-spec/);
});

// ───────────────────────── the instruction surface ─────────────────────────

test("the rules block carries the release gate as a NUMBERED REQUIRED TASK ITEM", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const out = run(["rules"], { cwd });
  // Measured in this repo: a rule carried by a required task reached 14/14 subsequent changes,
  // the same rule as a prose bullet reached 3/15. Bind the numbering, not just the words.
  assert.match(out, /^\d+\. \*\*Review a release's specs against each other\.\*\*/m);
  assert.match(out, /record-cross-spec-review/);
});

test("the usage line and the command doc both name the new subcommand", () => {
  const cwd = tmpRepo();
  assert.match(runCombined(["--help"], { cwd }), /record-cross-spec-review/);
  const doc = fs.readFileSync(
    path.join(path.dirname(new URL(import.meta.url).pathname), "..", "..", "commands", "cross-spec-review.md"), "utf8");
  assert.match(doc, /record-cross-spec-review/);
});
