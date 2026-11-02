// scripts/test/assert/rules-conditional-refresh.test.mjs
// gh-cfdude-pm-248, tasks 3.2 and 3.3 (FILE) — the managed block follows EVERY conditional section after any
// non-hook write (3.2), and a section that appears in an existing block is announced (3.3). The observable is
// CLAUDE.md's bytes and mtime, and stderr.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, invokeEngine, writeState, readState, archiveDay } from "../fixtures/assert-harness.mjs";

const AUTONOMY = "## Epic-level autonomy", RC = "## Release candidate", POINTER = "## Procedures emitted on use";
const TRACKER_PARAGRAPH = "Epic-level autonomy on tracker-linked epics";
const realRepo = () => fs.realpathSync(tmpRepo());
const mdPath = (cwd) => path.join(cwd, "CLAUDE.md");
const md = (cwd) => fs.readFileSync(mdPath(cwd), "utf8");
const stat = (cwd) => fs.statSync(mdPath(cwd));
const stateFile = (cwd) => path.join(cwd, ".conductor", "state.json");
const ARCHIVE = ["--status", "archived", "--outcome", "abandoned", "--reason", "x", "--no-deferrals"];
const APPEARS = /now carried by the managed block/;

function fresh() {
  const cwd = realRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "e1", "--title", "e1", "--lane", "claude-code"], { cwd });
  return cwd;
}
/** e1 holds the only autonomy record. */
function withRecord() {
  const cwd = fresh();
  run(["set-autonomy", "e1", "--context", "x"], { cwd });
  assert.ok(md(cwd).includes(AUTONOMY), "precondition: the section is present");
  return cwd;
}

// ───────────── epic-autonomy ─────────────
test("3.2 the first autonomy record adds the section", () => {
  const cwd = fresh();
  assert.ok(!md(cwd).includes(AUTONOMY));
  run(["set-autonomy", "e1", "--preauthorize", "drop-scratch:reviewed"], { cwd });
  assert.ok(md(cwd).includes(AUTONOMY));
});

test("3.2 level off keeps the section", () => {
  const cwd = withRecord();
  run(["set-autonomy", "e1", "--level", "off"], { cwd });
  assert.ok(md(cwd).includes(AUTONOMY));
});

test("3.2 archiving the last holder retires the section, and un-archiving restores it", () => {
  const cwd = withRecord();
  run(["update-epic", "e1", ...ARCHIVE], { cwd });
  assert.ok(!md(cwd).includes(AUTONOMY));
  assert.ok(md(cwd).includes(POINTER), "the pointer stands in");
  run(["update-epic", "e1", "--status", "untriaged"], { cwd });
  assert.ok(md(cwd).includes(AUTONOMY));
});

test("3.2 removing the last holder retires the section", () => {
  const cwd = withRecord();
  run(["remove-epic", "e1"], { cwd });
  assert.ok(!md(cwd).includes(AUTONOMY));
});

test("3.2 an archived holder alone does not emit it, even from write-rules", () => {
  const cwd = withRecord();
  run(["update-epic", "e1", ...ARCHIVE], { cwd });
  run(["write-rules"], { cwd });
  assert.ok(!md(cwd).includes(AUTONOMY));
});

test("3.2 an outward tracker's autonomy paragraph arrives with the first record", () => {
  const cwd = fresh();
  run(["set-tracker", "--system", "jira", "--project", "JOB", "--direction", "outward"], { cwd });
  assert.ok(!md(cwd).includes(TRACKER_PARAGRAPH));
  run(["set-autonomy", "e1", "--context", "x"], { cwd });
  assert.ok(md(cwd).includes(TRACKER_PARAGRAPH) && md(cwd).includes(AUTONOMY));
});

// ───────────── release-candidate-review ─────────────
test("3.2 the first release adds the Release candidate section; --deliver retires it; --undeliver restores it", () => {
  const cwd = fresh();
  assert.ok(!md(cwd).includes(RC));
  run(["release", "1.0.0", "--intent", "x"], { cwd });
  assert.ok(md(cwd).includes(RC));
  run(["release", "1.0.0", "--deliver"], { cwd });
  assert.ok(!md(cwd).includes(RC));
  assert.ok(md(cwd).includes(POINTER));
  run(["release", "1.0.0", "--undeliver"], { cwd });
  assert.ok(md(cwd).includes(RC));
});

// ───────────── the generalised comparison ─────────────
test("3.2 a write that changes no condition rewrites nothing: bytes and mtime", () => {
  const cwd = withRecord();
  const before = md(cwd), mtime = stat(cwd).mtimeMs;
  run(["update-epic", "e1", "--notes", "x"], { cwd });
  assert.equal(md(cwd), before);
  assert.equal(stat(cwd).mtimeMs, mtime);
});

test("3.2 a hand-edit of state is corrected by the NEXT engine write (disk against state, not before against after)", () => {
  const cwd = realRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "e1", "--title", "e1", "--lane", "claude-code"], { cwd });
  run(["add-epic", "--id", "f", "--title", "f", "--lane", "claude-code"], { cwd });
  const s = JSON.parse(fs.readFileSync(stateFile(cwd), "utf8"));
  s.epics.find((e) => e.id === "e1").autonomy = { level: "off" };
  writeState(cwd, s);
  assert.ok(!md(cwd).includes(AUTONOMY), "precondition: the hand-edit left the block alone");
  run(["update-epic", "f", "--notes", "x"], { cwd });
  assert.ok(md(cwd).includes(AUTONOMY));
});

test("3.2 a refused invocation refreshes nothing", () => {
  const cwd = withRecord();
  const before = md(cwd), mtime = stat(cwd).mtimeMs;
  const r = invokeEngine(["update-epic", "e1", "--status", "archived"], { cwd });
  assert.notEqual(r.status, 0);
  assert.equal(md(cwd), before);
  assert.equal(stat(cwd).mtimeMs, mtime);
});

test("3.2 a hook does no comparison (including a commit-nudge archive self-heal); the next non-hook write catches up", () => {
  const cwd = withRecord();
  const s = JSON.parse(fs.readFileSync(stateFile(cwd), "utf8"));
  s.epics.find((e) => e.id === "e1").status = "archived";
  writeState(cwd, s);
  const before = md(cwd), mtime = stat(cwd).mtimeMs;
  for (const hook of [["brief"], ["snapshot"], ["commit-nudge"]]) invokeEngine(hook, { cwd });
  assert.equal(md(cwd), before, "no hook touched the block");
  assert.equal(stat(cwd).mtimeMs, mtime);
  run(["update-epic", "e1", "--notes", "x"], { cwd });
  assert.ok(!md(cwd).includes(AUTONOMY), "the next non-hook write refreshed it");
});

test("3.2 a hook that WRITES state (snapshot's archive self-heal) does no comparison; the next non-hook write catches up", () => {
  const cwd = fresh();
  run(["update-epic", "e1", "--lane", "openspec"], { cwd });
  run(["set-autonomy", "e1", "--context", "x"], { cwd });
  const dir = path.join(cwd, "openspec", "changes", "archive", `${archiveDay()}-e1`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "proposal.md"), "# archived\n");
  const revision = readState(cwd).revision;
  const before = md(cwd), mtime = stat(cwd).mtimeMs;
  invokeEngine(["snapshot"], { cwd });
  const healed = readState(cwd);
  assert.equal(healed.epics.find((e) => e.id === "e1").status, "archived", "fixture: the hook's self-heal archived the last holder");
  assert.ok(healed.revision > revision, "fixture: the hook WROTE state");
  assert.equal(md(cwd), before, "the hook did no comparison: the block still carries the section");
  assert.equal(stat(cwd).mtimeMs, mtime);
  run(["add-epic", "--id", "g", "--title", "g", "--lane", "claude-code"], { cwd });
  assert.ok(!md(cwd).includes(AUTONOMY), "the next non-hook write retired it");
});

test("3.2 a repo with no managed block is not given one", () => {
  const cwd = withRecord();
  fs.unlinkSync(mdPath(cwd));
  run(["update-epic", "e1", ...ARCHIVE], { cwd });
  assert.equal(fs.existsSync(mdPath(cwd)), false);
});

test("3.2 a refresh failure does not fail the write; the warning names the section and write-rules, in non-spend wording", () => {
  const cwd = withRecord();
  fs.chmodSync(mdPath(cwd), 0o444);
  try {
    const r = invokeEngine(["update-epic", "e1", ...ARCHIVE], { cwd });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(fs.readFileSync(stateFile(cwd), "utf8")).epics.find((e) => e.id === "e1").status, "archived");
    assert.match(r.stderr, /warning .*Epic-level autonomy section could not be refreshed/);
    assert.match(r.stderr, /write-rules/);
    assert.doesNotMatch(r.stderr, /spend limit/i);
  } finally {
    fs.chmodSync(mdPath(cwd), 0o644);
  }
});

// ───────────── 3.3: the appearance notice ─────────────
test("3.3 the first autonomy grant announces the section: one line naming it and `rules`", () => {
  const cwd = fresh();
  const r = invokeEngine(["set-autonomy", "e1", "--context", "x"], { cwd });
  const lines = r.stderr.split("\n").filter((l) => APPEARS.test(l));
  assert.equal(lines.length, 1, r.stderr);
  assert.match(lines[0], /Epic-level autonomy/);
  assert.match(lines[0], /`rules`/);
});

test("3.3 a verb that writes the block itself announces too (set-spend-guard)", () => {
  const cwd = fresh();
  const r = invokeEngine(["set-spend-guard", "--max-failed-rounds", "2"], { cwd });
  const lines = r.stderr.split("\n").filter((l) => APPEARS.test(l));
  assert.equal(lines.length, 1, r.stderr);
  assert.match(lines[0], /Spend guard/);
  assert.match(lines[0], /`rules`/);
});

test("3.3 init's create and append announce nothing", () => {
  const created = realRepo();
  const r1 = invokeEngine(["init"], { cwd: created });
  assert.doesNotMatch(r1.stderr, APPEARS);
  const appended = realRepo();
  fs.writeFileSync(mdPath(appended), "# mine\n\nhand-written text\n");
  const r2 = invokeEngine(["init"], { cwd: appended });
  assert.match(r2.stderr, /appended/);
  assert.doesNotMatch(r2.stderr, APPEARS);
});

test("3.3 a retirement is silent, even when the pointer appears", () => {
  const cwd = withRecord();
  run(["release", "1.0.0", "--intent", "x"], { cwd });
  const r = invokeEngine(["update-epic", "e1", ...ARCHIVE], { cwd });
  assert.ok(!md(cwd).includes(AUTONOMY));
  assert.ok(md(cwd).includes("Procedures emitted on use"));
  assert.doesNotMatch(r.stderr, APPEARS);
});

test("3.3 a removal-only refresh prints no appearance line", () => {
  const cwd = withRecord();
  const r = invokeEngine(["remove-epic", "e1"], { cwd });
  assert.doesNotMatch(r.stderr, APPEARS);
});

test("3.3 a tracker heading is not announced", () => {
  const cwd = fresh();
  const r = invokeEngine(["set-tracker", "--system", "jira", "--project", "JOB", "--direction", "outward"], { cwd });
  assert.equal(r.status, 0, r.stderr);
  assert.match(md(cwd), /## External tracker sync/);
  assert.doesNotMatch(r.stderr, APPEARS);
});

test("3.3 two sections added by one write are two lines, and no other heading is announced", () => {
  const cwd = fresh();
  const s = JSON.parse(fs.readFileSync(stateFile(cwd), "utf8"));
  s.epics.find((e) => e.id === "e1").autonomy = { level: "off" };
  s.releases = [{ id: "1.0.0", intent: "x" }];
  writeState(cwd, s);
  const r = invokeEngine(["write-rules"], { cwd });
  const lines = r.stderr.split("\n").filter((l) => APPEARS.test(l));
  assert.equal(lines.length, 2, r.stderr);
  assert.ok(lines.some((l) => /Epic-level autonomy/.test(l)) && lines.some((l) => /Release candidate/.test(l)));
  assert.ok(!lines.some((l) => /Procedures emitted on use/.test(l)));
});
