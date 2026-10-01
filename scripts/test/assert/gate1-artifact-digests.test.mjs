// scripts/test/assert/gate1-artifact-digests.test.mjs
// Theme B batch B1 (0.51.0), the BYTES half of two fixes:
//
//   gh#198  a Gate 1 verdict recorded with --artifact stored the PATHS only, so amending a reviewed
//           artifact never read stale. The engine now records a sha-256 per readable artifact and the
//           rendered Gate 1 cell reads `⚠ stale` when one differs. These tests need real files, which the
//           unit rung may not touch.
//   gh#232  `--plan` / `--spec` naming a directory that EXISTS on disk is refused (the trailing-slash
//           half is a unit test in scripts/test/unit/attribution-set-integrity.test.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { run, runCombined, tmpRepo, readState, projectMd, expectFail } from "../fixtures/assert-harness.mjs";

const write = (cwd, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(cwd, rel)), { recursive: true });
  fs.writeFileSync(path.join(cwd, rel), text);
};
const gate1Row = (cwd) => { run(["render"], { cwd }); return projectMd(cwd).split("\n").find(l => l.includes("`e`") && /pass \(/.test(l)) || ""; };

/** An initialised repo, an openspec epic `e`, and a proposal + tasks on disk. */
function repoWithChange() {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "e", "--lane", "openspec"], { cwd });
  write(cwd, "openspec/changes/e/proposal.md", "# proposal\nv1\n");
  write(cwd, "openspec/changes/e/tasks.md", "- [ ] 1.1 a task\n");
  return cwd;
}
const REVIEW = ["record-gate-review", "e", "--gate", "1", "--verdict", "pass", "--reviewer", "r",
  "--artifact", "openspec/changes/e/proposal.md", "--artifact", "openspec/changes/e/tasks.md"];

test("198.1 a Gate 1 verdict records a digest per artifact beside the unchanged path list", () => {
  const cwd = repoWithChange();
  run(REVIEW, { cwd });
  const g1 = readState(cwd).epics[0].gateReview.gate1;
  assert.deepEqual(g1.artifacts, ["openspec/changes/e/proposal.md", "openspec/changes/e/tasks.md"],
    "artifacts stays a list of paths: every reader of it filters strings");
  // tasks.md is the progress ledger: listed as read, never digested (198.8).
  assert.deepEqual(g1.artifactDigests.map(d => d.path), ["openspec/changes/e/proposal.md"]);
  for (const d of g1.artifactDigests) assert.match(d.sha256, /^[0-9a-f]{64}$/);
});

test("198.2 amending a reviewed artifact reads the Gate 1 verdict STALE; an untouched one stays fresh", () => {
  const cwd = repoWithChange();
  run(REVIEW, { cwd });
  assert.doesNotMatch(gate1Row(cwd), /⚠/, "fresh straight after the review");
  write(cwd, "openspec/changes/e/proposal.md", "# proposal\nv2 — amended after the review\n");
  assert.match(gate1Row(cwd), /pass \(2 artifacts\) · r ⚠ stale/);
});

test("198.3 the ARCHIVE MOVE is not staleness: the artifact is found under its change's archive directory", () => {
  const cwd = repoWithChange();
  run(REVIEW, { cwd });
  fs.mkdirSync(path.join(cwd, "openspec/changes/archive"), { recursive: true });
  fs.renameSync(path.join(cwd, "openspec/changes/e"), path.join(cwd, "openspec/changes/archive/2026-01-02-e"));
  assert.doesNotMatch(gate1Row(cwd), /⚠ stale/);
  write(cwd, "openspec/changes/archive/2026-01-02-e/proposal.md", "# proposal\nedited after the move\n");
  assert.match(gate1Row(cwd), /⚠ stale/, "an edit to the archived copy still reads stale");
});

test("198.4 an artifact unreadable at record time gets no digest, is said so, and reads unverifiable", () => {
  const cwd = repoWithChange();
  const out = runCombined([...REVIEW, "--artifact", "openspec/changes/e/design.md"], { cwd });
  assert.match(out, /no content digest recorded for 1 of 3 artifact\(s\)/);
  assert.doesNotMatch(out, /design\.md/, "a count, never the path (the governed-input sweep's rule)");
  const g1 = readState(cwd).epics[0].gateReview.gate1;
  assert.equal(g1.artifactDigests.length, 1, "proposal digested; tasks.md exempt; design.md unreadable");
  assert.equal(g1.artifacts.length, 3);
  assert.match(gate1Row(cwd), /⚠ unverifiable/);
  write(cwd, "openspec/changes/e/proposal.md", "changed\n");
  assert.match(gate1Row(cwd), /⚠ stale/, "stale outranks unverifiable");
});

test("198.5 a legacy Gate 1 verdict (paths only) reads unverifiable-or-silent as before, never stale", () => {
  const cwd = repoWithChange();
  run(REVIEW, { cwd });
  const s = readState(cwd);
  delete s.epics[0].gateReview.gate1.artifactDigests;
  fs.writeFileSync(path.join(cwd, ".conductor", "state.json"), JSON.stringify(s, null, 2) + "\n");
  write(cwd, "openspec/changes/e/proposal.md", "edited\n");
  assert.doesNotMatch(gate1Row(cwd), /⚠ stale/);
});

test("198.8 ticking a checkbox in the live change's tasks.md does NOT stale Gate 1; amending proposal.md does", () => {
  const cwd = repoWithChange();
  run(REVIEW, { cwd });
  write(cwd, "openspec/changes/e/tasks.md", "- [x] 1.1 a task\n");
  assert.doesNotMatch(gate1Row(cwd), /⚠/, "the progress ledger is exempt from the digest");
  write(cwd, "openspec/changes/e/proposal.md", "# proposal\namended\n");
  assert.match(gate1Row(cwd), /⚠ stale/);
});

test("198.6 a stale Gate 1 never blocks the archive: only Gate 2 is read by the archive gate", () => {
  const cwd = repoWithChange();
  run(REVIEW, { cwd });
  write(cwd, "openspec/changes/e/proposal.md", "amended\n");
  run(["update-epic", "e", "--status", "archived", "--outcome", "killed", "--reason", "not doing it", "--no-deferrals"], { cwd });
  assert.equal(readState(cwd).epics[0].status, "archived");
});

test("198.7 a Gate 2 verdict carrying --artifact records no digests (the commit range is its evidence)", () => {
  const cwd = repoWithChange();
  run(["record-gate-review", "e", "--gate", "2", "--verdict", "fail", "--artifact", "openspec/changes/e/proposal.md"], { cwd });
  assert.equal(readState(cwd).epics[0].gateReview.gate2.artifactDigests, undefined);
});

test("232.4 --plan and --spec naming a directory that exists are refused on both write paths; a file is accepted", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "p", "--lane", "superpowers"], { cwd });
  write(cwd, "docs/superpowers/plans/real.md", "# plan\n");
  for (const flag of ["--plan", "--spec"]) {
    const err = expectFail(() => run(["update-epic", "p", flag, "docs/superpowers/plans"], { cwd }));
    assert.ok(err, `update-epic ${flag} naming a directory must be refused`);
    assert.match(String(err.stderr), /not a regular file \(a directory\)/);
    const err2 = expectFail(() => run(["add-epic", "--id", "q", "--lane", "superpowers", flag, "docs"], { cwd }));
    assert.ok(err2, `add-epic ${flag} naming a directory must be refused`);
  }
  assert.equal(readState(cwd).epics.length, 1, "the refused add-epic registered nothing");
  run(["update-epic", "p", "--plan", "docs/superpowers/plans/real.md"], { cwd });
  assert.equal(readState(cwd).epics[0].planPath, "docs/superpowers/plans/real.md");
});
