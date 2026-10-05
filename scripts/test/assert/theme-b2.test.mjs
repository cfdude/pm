// scripts/test/assert/theme-b2.test.mjs
// Theme B batch B2 (pm 0.51.0), the FILE rung: every test here needs a directory on disk (an archive
// directory, a live change copy) or the git double. The value-shaped half is scripts/test/unit/theme-b2.test.mjs.
//
//   gh#200  an epic names its change through --spec/--plan, and integrity and sync both honour it
//   gh#201  a FAILING verdict recorded after the merge is a late failing review, never bookkeeping
//   gh#215  a change present live AND archived with identical content is named, with its remedy
//   #8      integrity reports an archive directory the 0.50.0 date rule set aside
//   #6      update-epic --status that the heal undoes is reported, not "updated"

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fakeGit, loadCapture } from "../fixtures/fake-git.mjs";
import { setInvocation, installedInvocation } from "../../lib/invocation.mjs";
import { runIntegrity } from "../../lib/integrity.mjs";
import { archiveDay, invokeEngine, run, tmpRepo } from "../fixtures/assert-harness.mjs";
import { engineCode } from "../fixtures/source-code.mjs";

const readState = (cwd) => JSON.parse(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"));
const mkdirs = (cwd, ...rel) => { for (const r of rel) fs.mkdirSync(path.join(cwd, r), { recursive: true }); };
const put = (cwd, rel, text) => { fs.mkdirSync(path.dirname(path.join(cwd, rel)), { recursive: true }); fs.writeFileSync(path.join(cwd, rel), text); };
const initRepo = () => { const cwd = tmpRepo(); run(["init"], { cwd }); return cwd; };
/** The bullets under one check's heading in `integrity`'s report. */
function block(cwd, id) {
  const out = run(["integrity"], { cwd });
  const lines = out.split("\n");
  const start = lines.findIndex(l => l.startsWith(`${id} — `));
  assert.notEqual(start, -1, `integrity printed no block for ${id}:\n${out}`);
  const bullets = [];
  for (let i = start + 1; i < lines.length && lines[i].startsWith("  "); i++) bullets.push(lines[i]);
  return bullets;
}

// ─────────────── gh#200: the association an archived change needs when its epic is named differently ───────────────

const ARCHIVE_CHECK = "archive-directory-has-no-epic";

test("gh-200: --spec naming a file inside the archived change holds it; integrity and sync honour it, --clear spec is the inverse", () => {
  const cwd = initRepo();
  const dir = `${archiveDay()}-darkpool-finra-resource`;
  run(["add-epic", "--id", "darkpool-section-ignores-finra", "--lane", "openspec", "--title", "premise"], { cwd });
  mkdirs(cwd, `openspec/changes/archive/${dir}`);
  assert.equal(block(cwd, ARCHIVE_CHECK).length, 1, "before the association the directory is reported");
  run(["update-epic", "darkpool-section-ignores-finra", "--spec", `openspec/changes/archive/${dir}/proposal.md`], { cwd });
  assert.deepEqual(block(cwd, ARCHIVE_CHECK), [], "the recorded association is honoured");
  const before = readState(cwd).epics.length;
  const r = invokeEngine(["sync"], { cwd });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readState(cwd).epics.length, before, "sync's backfill must not register a SECOND epic for the same change");
  run(["update-epic", "darkpool-section-ignores-finra", "--clear", "spec"], { cwd });
  assert.equal(block(cwd, ARCHIVE_CHECK).length, 1, "the inverse restores the finding");
});

test("gh-200: --plan naming the change's tasks.md holds it as well, and a LIVE change path holds the live name", () => {
  const cwd = initRepo();
  const dir = `${archiveDay()}-renamed-change`;
  put(cwd, `openspec/changes/archive/${dir}/tasks.md`, "- [x] 1.1 done\n");
  run(["add-epic", "--id", "premise-epic", "--lane", "openspec", "--title", "p", "--plan", `openspec/changes/archive/${dir}/tasks.md`], { cwd });
  assert.deepEqual(block(cwd, ARCHIVE_CHECK), []);
  // A path that merely mentions openspec/changes elsewhere, or is not under a change directory, holds nothing.
  run(["update-epic", "premise-epic", "--plan", "docs/notes/renamed-change.md"], { cwd });
  assert.equal(block(cwd, ARCHIVE_CHECK).length, 1, "a name in some other path is not an association");
});

// ─────────────── gh#215: openspec archive COPIED instead of moving ───────────────

const ALSO_LIVE = "archived-change-also-live";

test("gh-215: a change live AND archived with identical content is named with the git rm remedy and the upstream cause", () => {
  const cwd = initRepo();
  for (const base of ["openspec/changes/dup-change", "openspec/changes/archive/2026-09-21-dup-change"]) {
    put(cwd, `${base}/proposal.md`, "# dup\n");
    put(cwd, `${base}/specs/cap/spec.md`, "## ADDED Requirements\n");
  }
  run(["add-epic", "--id", "dup-change", "--lane", "openspec", "--title", "dup"], { cwd });
  const found = block(cwd, ALSO_LIVE);
  assert.equal(found.length, 1, found.join("\n"));
  assert.match(found[0], /`dup-change` — /, "attributed to the epic holding the change");
  assert.match(found[0], /openspec\/changes\/dup-change` is present live AND as archive\/2026-09-21-dup-change/);
  assert.match(found[0], /`git rm -r 'openspec\/changes\/dup-change'`/);
  assert.match(found[0], /upstream/);
  assert.match(found[0], /cfdude\/pm#215/);
});

test("gh-215: a live change that DIFFERS from its archived namesake is a re-proposal and is not reported; an archive alone is silent", () => {
  const cwd = initRepo();
  put(cwd, "openspec/changes/redo/proposal.md", "# second attempt\n");
  put(cwd, "openspec/changes/archive/2026-09-01-redo/proposal.md", "# first attempt\n");
  put(cwd, "openspec/changes/archive/2026-09-02-only-archived/proposal.md", "# x\n");
  assert.deepEqual(block(cwd, ALSO_LIVE), []);
  // An extra file on one side is a difference too.
  put(cwd, "openspec/changes/redo/proposal.md", "# first attempt\n");
  assert.equal(block(cwd, ALSO_LIVE).length, 1, "now identical");
  put(cwd, "openspec/changes/redo/extra.md", "more\n");
  assert.deepEqual(block(cwd, ALSO_LIVE), [], "an extra file means the trees differ");
});

// ─────────────── #8: the directory the date rule set aside ───────────────

test("integrity reports an archive directory the date rule set aside, in sync's own wording, with the placeholder invocation", () => {
  const cwd = initRepo();
  run(["add-epic", "--id", "late-registered", "--lane", "claude-code", "--title", "late"], { cwd });
  mkdirs(cwd, "openspec/changes/archive/2025-01-01-late-registered");
  const found = block(cwd, ARCHIVE_CHECK);
  assert.equal(found.length, 1, found.join("\n"));
  assert.match(found[0], /`late-registered` — archive\/2025-01-01-late-registered matches this epic by name and the date rule set it aside/);
  assert.match(found[0], /rename the directory if it is unrelated work/);
  assert.match(found[0], /<--no-deferrals \| --deferral "<epicId>:<section>">/);
  // sync names the SAME condition with the SAME tail (one renderer), and still prefixes it as before.
  const r = invokeEngine(["sync"], { cwd });
  assert.equal(r.status, 0, r.stderr);
  const line = r.stderr.split("\n").find(l => l.includes("set aside archive directory '2025-01-01-late-registered'")) || "";
  assert.ok(line.startsWith("conductor: sync set aside archive directory '2025-01-01-late-registered' — it predates epic 'late-registered'"), line);
  assert.ok(found[0].endsWith(line.slice(line.indexOf("it predates"))), "integrity and sync word the condition identically");
});

// ─────────────── #6: --status the heal undoes ───────────────

test("update-epic --status on an epic whose change is archived on disk says the status was NOT kept", () => {
  const cwd = initRepo();
  run(["add-epic", "--id", "gone", "--lane", "claude-code", "--title", "g"], { cwd });
  mkdirs(cwd, `openspec/changes/archive/${archiveDay()}-gone`);
  const r = invokeEngine(["update-epic", "gone", "--status", "paused"], { cwd });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout + r.stderr, /--status paused was NOT kept: its change directory is archived on disk/);
  assert.doesNotMatch(r.stdout + r.stderr, /conductor: updated 'gone'(?! —)/, "a bare \"updated\" would claim a status that is not there");
  assert.equal(readState(cwd).epics.find(e => e.id === "gone").status, "archived");
});

test("update-epic --status that DID stick reports plain success", () => {
  const cwd = initRepo();
  run(["add-epic", "--id", "live", "--lane", "claude-code", "--title", "l"], { cwd });
  const r = invokeEngine(["update-epic", "live", "--status", "paused"], { cwd });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout + r.stderr, /conductor: updated 'live'/);
  assert.doesNotMatch(r.stdout + r.stderr, /NOT kept/);
});

// ─────────────── gh#201: a failing verdict after the merge ───────────────

const CAPTURE = loadCapture();
const A_COMMIT = CAPTURE.operations.committerDate.cases[0].args[0];

function findingsFor(id, state) {
  const cwd = tmpRepo();
  const before = installedInvocation();
  try {
    setInvocation({
      cwd, root: cwd, argv: ["node", "conductor.mjs"], env: { ...process.env, CLAUDE_PROJECT_DIR: cwd },
      stdin: { read: () => "", isTTY: false }, stdout: { write: () => true }, stderr: { write: () => true },
      git: fakeGit({ roots: [] }),
    });
    const c = runIntegrity(state).find(x => x.id === id);
    assert.ok(c, `no check registered as ${id}`);
    assert.ok(!c.unavailable, `${id} could not run: ${c.unavailable}`);
    return c.findings;
  } finally {
    setInvocation(before ?? { cwd, root: cwd, argv: [], env: process.env, stdin: { read: () => "", isTTY: false },
      stdout: { write: () => true }, stderr: { write: () => true } });
  }
}
const withVerdict = (gate, entry) => ({ version: 1, active: null, detourStack: [], epics: [{
  id: "audited", title: "t", priority: "P1", status: "queued", role: "epic", lane: "openspec", links: [],
  attributedCommits: [A_COMMIT], gateReview: { [gate]: entry } }] });
const LATER = () => new Date(Date.now() + 86400000).toISOString();

test("gh-201: a FAILING Gate 2 recorded after the merge is a late failing review, and no longer bookkeeping", () => {
  const st = withVerdict("gate2", { verdict: "fail", reviewedAt: LATER(), reviewer: "audit" });
  assert.deepEqual(findingsFor("gate-recorded-as-bookkeeping", st), [], "not accused of being bookkeeping");
  const late = findingsFor("late-failing-gate-review", st);
  assert.equal(late.length, 1);
  assert.match(late[0].detail, /FAILING review recorded/);
  assert.match(late[0].detail, /a late failing review/);
  assert.match(late[0].detail, /not bookkeeping/);
  assert.match(late[0].detail, /--verdict fail --base-sha <sha> --head-sha <sha>/, "names how to record the range it reviewed");
});

test("gh-201: a PASS after the merge is still bookkeeping, a fail carrying its range is never reported, a fail before the merge is silent", () => {
  const pass = withVerdict("gate2", { verdict: "pass", reviewedAt: LATER() });
  assert.equal(findingsFor("gate-recorded-as-bookkeeping", pass).length, 1, "the arm is not disarmed for a pass");
  assert.deepEqual(findingsFor("late-failing-gate-review", pass), []);
  const evidenced = withVerdict("gate2", { verdict: "fail", reviewedAt: LATER(), baseSha: A_COMMIT, headSha: A_COMMIT });
  assert.deepEqual(findingsFor("late-failing-gate-review", evidenced), [], "a verdict carrying a range is evidence, as it always was");
  const before = withVerdict("gate2", { verdict: "fail", reviewedAt: "2000-01-01T00:00:00.000Z" });
  assert.deepEqual(findingsFor("late-failing-gate-review", before), []);
});

test("gh-201: a failing Gate 1 is reported under the same label", () => {
  const st = withVerdict("gate1", { verdict: "fail", reviewedAt: LATER() });
  assert.equal(findingsFor("late-failing-gate-review", st).length, 1);
  assert.match(findingsFor("late-failing-gate-review", st)[0].detail, /--gate 1 --verdict fail --artifact <path>/);
});

// ─────────────── #7 call-site sweep: no printer asks for the bare flag ───────────────

test("no engine file asks dispositionInvocation() for a bare --no-deferrals", () => {
  for (const f of ["integrity.mjs", "subcommands.mjs", "update-epic.mjs", "archive-gate.mjs", "releases.mjs"]) {
    assert.doesNotMatch(engineCode(`scripts/lib/${f}`), /deferrals:\s*"bare"/, `${f} must not print a claim as a default`);
  }
});
