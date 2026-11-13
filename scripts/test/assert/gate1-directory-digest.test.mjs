// gh#252 — `record-gate-review --artifact <directory>` (what an OpenSpec Gate 1 reviews: the change
// DIRECTORY) recorded no digest, so every such verdict read `unverifiable` and could never go stale.
// The engine now digests a directory: recursive, sorted, deterministic. BYTES on disk, so the file rung.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { run, runCombined, tmpRepo, readState, projectMd } from "../fixtures/assert-harness.mjs";

const write = (cwd, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(cwd, rel)), { recursive: true });
  fs.writeFileSync(path.join(cwd, rel), text);
};
const gate1Row = (cwd) => { run(["render"], { cwd }); return projectMd(cwd).split("\n").find(l => l.includes("`e`") && /pass \(/.test(l)) || ""; };

function repoWithChange() {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "e", "--lane", "openspec"], { cwd });
  write(cwd, "openspec/changes/e/proposal.md", "# proposal\nv1\n");
  write(cwd, "openspec/changes/e/design.md", "# design\n");
  write(cwd, "openspec/changes/e/specs/a/spec.md", "# a\n");
  write(cwd, "openspec/changes/e/specs/b/spec.md", "# b\n");
  write(cwd, "openspec/changes/e/tasks.md", "- [ ] 1.1 a task\n");
  return cwd;
}
const REVIEW = (art = "openspec/changes/e") => ["record-gate-review", "e", "--gate", "1", "--verdict", "pass",
  "--reviewer", "r", "--artifact", art];

test("252.1 a directory artifact records ONE digest under its own path, with no unverifiable notice", () => {
  const cwd = repoWithChange();
  const out = runCombined(REVIEW(), { cwd });
  assert.doesNotMatch(out, /no content digest recorded/);
  const g1 = readState(cwd).epics[0].gateReview.gate1;
  assert.deepEqual(g1.artifacts, ["openspec/changes/e"]);
  assert.deepEqual(g1.artifactDigests.map(d => d.path), ["openspec/changes/e"]);
  assert.match(g1.artifactDigests[0].sha256, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(gate1Row(cwd), /⚠/, "fresh straight after the review");
});

test("252.2 editing any file under the directory, at any depth, reads STALE; adding or removing one does too", () => {
  for (const edit of [
    (cwd) => write(cwd, "openspec/changes/e/specs/b/spec.md", "# b amended\n"),
    (cwd) => write(cwd, "openspec/changes/e/specs/c/spec.md", "# new spec\n"),
    (cwd) => fs.rmSync(path.join(cwd, "openspec/changes/e/design.md")),
  ]) {
    const cwd = repoWithChange();
    run(REVIEW(), { cwd });
    edit(cwd);
    assert.match(gate1Row(cwd), /⚠ stale/);
  }
});

test("252.3 tasks.md inside the directory is the progress ledger: ticking it does NOT stale the verdict", () => {
  const cwd = repoWithChange();
  run(REVIEW(), { cwd });
  write(cwd, "openspec/changes/e/tasks.md", "- [x] 1.1 a task\n");
  assert.doesNotMatch(gate1Row(cwd), /⚠/);
  write(cwd, "openspec/changes/e/specs/a/tasks.md", "- not the ledger\n");
  assert.match(gate1Row(cwd), /⚠ stale/, "only the change's TOP-LEVEL tasks.md is exempt");
});

test("252.4 the digest is deterministic: independent of creation order, equal across two records", () => {
  const a = repoWithChange();
  const b = tmpRepo();
  run(["init"], { cwd: b });
  run(["add-epic", "--id", "e", "--lane", "openspec"], { cwd: b });
  // Same content, created in the opposite order.
  write(b, "openspec/changes/e/specs/b/spec.md", "# b\n");
  write(b, "openspec/changes/e/specs/a/spec.md", "# a\n");
  write(b, "openspec/changes/e/design.md", "# design\n");
  write(b, "openspec/changes/e/proposal.md", "# proposal\nv1\n");
  run(REVIEW(), { cwd: a });
  run(REVIEW(), { cwd: b });
  const sha = (cwd) => readState(cwd).epics[0].gateReview.gate1.artifactDigests[0].sha256;
  assert.equal(sha(a), sha(b));
  run(REVIEW("openspec/changes/e/"), { cwd: a });
  assert.equal(readState(a).epics[0].gateReview.gate1.artifactDigests[0].sha256, sha(b),
    "a trailing slash names the same directory and digests the same bytes");
});

test("252.5 a directory with no digestable file is unreadable (said so), never a digest of nothing", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "e", "--lane", "openspec"], { cwd });
  write(cwd, "openspec/changes/e/tasks.md", "- [ ] x\n");
  const out = runCombined(REVIEW(), { cwd });
  assert.match(out, /no content digest recorded for 1 of 1 artifact\(s\)/);
  assert.equal(readState(cwd).epics[0].gateReview.gate1.artifactDigests, undefined);
});

test("252.6 the ARCHIVE MOVE of a directory artifact is not staleness; an edit to the archived copy is", () => {
  const cwd = repoWithChange();
  run(REVIEW(), { cwd });
  fs.mkdirSync(path.join(cwd, "openspec/changes/archive"), { recursive: true });
  fs.renameSync(path.join(cwd, "openspec/changes/e"), path.join(cwd, "openspec/changes/archive/2026-01-02-e"));
  assert.doesNotMatch(gate1Row(cwd), /⚠/);
  write(cwd, "openspec/changes/archive/2026-01-02-e/proposal.md", "edited after the move\n");
  assert.match(gate1Row(cwd), /⚠ stale/);
});

test("252.7 file artifacts are unchanged: a file path still digests that one file", () => {
  const cwd = repoWithChange();
  run(REVIEW("openspec/changes/e/proposal.md"), { cwd });
  const g1 = readState(cwd).epics[0].gateReview.gate1;
  assert.deepEqual(g1.artifactDigests.map(d => d.path), ["openspec/changes/e/proposal.md"]);
});
