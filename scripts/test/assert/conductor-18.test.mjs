// scripts/test/assert/conductor-18.test.mjs
// 5.3's ASSERTION TWIN of scripts/test/functional/conductor-18.test.mjs — same id, same subject.
//
// THE FUNCTIONAL FILE'S SUBJECT is two integrity checks that nothing else can see: gh-137, an epic
// left non-terminal in a release whose parent delivered, and gh-112, an epic another epic supersedes
// that never ended. Both are decided entirely from state.json — no git, no spawn — which is why this
// twin can carry nearly all of it, and why it belongs on the per-commit path: these are exactly the
// findings that otherwise sit unnoticed until somebody reads a report.

import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpRepo, run, writeState } from "../fixtures/assert-harness.mjs";

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

// ─────────────────── gh-137: a delivered release with work still open ───────────────────

/** A member carrying a `delivered` disposition, which is what makes a release read as delivered:
 *  the release object holds no delivery marker, so the reading is MEMBER-DERIVED by design. */
const shipped = (id) => epic(id, { release: "1.0", status: "archived",
  disposition: { outcome: "delivered", recordedAt: "2026-01-01T00:00:00Z" } });

test("gh-137: an epic left non-terminal in a release whose parent delivered is reported", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  writeState(cwd, { version: 1, active: null, detourStack: [],
    releases: [{ id: "1.0", intent: "x", deferred: [] }],
    epics: [shipped("shipped"), epic("left-open", { release: "1.0", status: "queued" })] });
  const out = run(["integrity"], { cwd });
  assert.equal(countLine(out, DELIVERED), 1);
  assert.match(out, /left-open/);
});

test("gh-137: the release's own `deferred[]` excludes an epic cut on purpose", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  writeState(cwd, { version: 1, active: null, detourStack: [],
    releases: [{ id: "1.0", intent: "x",
      deferred: [{ epic: "cut", reason: "scope", recordedAt: "2026-01-01T00:00:00Z" }] }],
    epics: [shipped("shipped"), epic("cut", { release: "1.0", status: "queued" })] });
  assert.equal(countLine(run(["integrity"], { cwd }), DELIVERED), 0,
    "the record already distinguishes 'cut on purpose' from 'shipped' — consuming one half of it " +
    "and not the other is the whole shape of the bug");
});

test("gh-137: an epic in no release, and a release nothing delivered, are both silent", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  writeState(cwd, { version: 1, active: null, detourStack: [],
    releases: [{ id: "1.0", intent: "x", deferred: [] }],
    epics: [epic("free", { status: "queued" })] });
  assert.equal(countLine(run(["integrity"], { cwd }), DELIVERED), 0);
});

test("gh-137: a release with work still in flight is silent — a staged release is not a defect", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  writeState(cwd, { version: 1, active: null, detourStack: [],
    releases: [{ id: "1.0", intent: "x", deferred: [] }],
    epics: [shipped("shipped"), epic("in-flight", { release: "1.0", status: "active" })] });
  assert.equal(countLine(run(["integrity"], { cwd }), DELIVERED), 0,
    "an inflated count is how a true warning gets ignored");
});

test("gh-137: the check never reports an epic whose status is terminal (gh-138)", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  writeState(cwd, { version: 1, active: null, detourStack: [],
    releases: [{ id: "1.0", intent: "x", deferred: [] }],
    epics: [shipped("shipped"), epic("ended", { release: "1.0", status: "archived" })] });
  assert.equal(countLine(run(["integrity"], { cwd }), DELIVERED), 0);
});

// ─────────────────── gh-112: a superseded epic that never ended ───────────────────

test("gh-112: an epic another epic supersedes, still queued, is reported", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  writeState(cwd, { version: 1, active: null, detourStack: [],
    epics: [epic("old", { status: "queued" }),
            epic("new", { links: [{ type: "supersedes", epic: "old", reason: "replaced" }] })] });
  assert.equal(countLine(run(["integrity"], { cwd }), SUPERSEDED), 1);
});

test("gh-112: a superseded epic that ENDED is silent (gh-138)", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  writeState(cwd, { version: 1, active: null, detourStack: [],
    epics: [epic("old", { status: "archived", disposition: { outcome: "superseded", reason: "r" } }),
            epic("new", { links: [{ type: "supersedes", epic: "old", reason: "replaced" }] })] });
  assert.equal(countLine(run(["integrity"], { cwd }), SUPERSEDED), 0);
});

test("gh-112: another link type is not a supersession", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  writeState(cwd, { version: 1, active: null, detourStack: [],
    epics: [epic("old", {}), epic("new", { links: [{ type: "relates-to", epic: "old", reason: "r" }] })] });
  assert.equal(countLine(run(["integrity"], { cwd }), SUPERSEDED), 0);
});

test("gh-112: a supersedes link naming an epic the record does not hold is not this check's finding", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  writeState(cwd, { version: 1, active: null, detourStack: [],
    epics: [epic("new", { links: [{ type: "supersedes", epic: "ghost", reason: "r" }] })] });
  assert.equal(countLine(run(["integrity"], { cwd }), SUPERSEDED), 0,
    "a dangling reference is a different check's finding, so this one stays quiet");
});

test("gh-137/gh-112: both checks appear in the report even when they find nothing", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  const out = run(["integrity"], { cwd });
  countLine(out, DELIVERED);
  countLine(out, SUPERSEDED);
});

// ───────────────────────── the deliberate omissions ─────────────────────────
//
// "gh-137: replayed against the record as it stood when the issue was filed, the check names all
// twenty" and "gh-180: the replay is not contaminated by an open member of some OTHER delivered
// release" replay a FROZEN historical record out of the repository's own git history, and "both
// checks are quiet on this repository's real record" reads the working tree against that same
// history. The freeze is what makes them a repository-state test rather than a rule test, and it is
// functional-only (design D5). The rules themselves are asserted above, constructively.
