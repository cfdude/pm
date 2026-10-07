// scripts/test/assert/integrity-stale-gate-1.test.mjs
// integrity-reports-stale-gate-1, the FILE rung: staleness is a digest comparison over artifacts on disk, so the
// check cannot be observed over an in-memory store.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { invokeEngine, run, tmpRepo } from "../fixtures/assert-harness.mjs";

const CHECK = "gate-1-verdict-stale";
const ART = "openspec/changes/feat/proposal.md";
const put = (cwd, rel, text) => { fs.mkdirSync(path.dirname(path.join(cwd, rel)), { recursive: true }); fs.writeFileSync(path.join(cwd, rel), text); };

function reviewedRepo() {
  const cwd = tmpRepo(); run(["init"], { cwd });
  put(cwd, ART, "# the spec as reviewed\n");
  let r = invokeEngine(["add-epic", "--id", "feat", "--lane", "openspec", "--status", "queued"], { cwd });
  assert.equal(r.status, 0, r.stderr);
  r = invokeEngine(["record-gate-review", "feat", "--gate", "1", "--verdict", "pass", "--artifact", ART, "--reviewer", "t"], { cwd });
  assert.equal(r.status, 0, r.stderr);
  return cwd;
}
const block = (stdout) => {
  const lines = stdout.split("\n");
  const at = lines.findIndex(l => l.startsWith(`${CHECK} — `));
  assert.notEqual(at, -1, `integrity printed no block for ${CHECK}:\n${stdout}`);
  const bullets = [];
  for (let i = at + 1; i < lines.length && lines[i].startsWith("  "); i++) bullets.push(lines[i]);
  return { head: lines[at], bullets };
};

test("a fresh Gate 1 is not reported, and the check's count line prints even at zero", () => {
  const cwd = reviewedRepo();
  const r = invokeEngine(["integrity"], { cwd });
  assert.equal(r.status, 0, r.stderr);
  const b = block(r.stdout);
  assert.match(b.head, /^gate-1-verdict-stale — 0 finding\(s\):/);
  assert.deepEqual(b.bullets, []);
});

test("an amended reviewed artifact is reported by epic id, names the file and the re-record remedy; the table marking agrees", () => {
  const cwd = reviewedRepo();
  put(cwd, ART, "# the spec, amended after the review\n");
  const r = invokeEngine(["integrity"], { cwd });
  assert.equal(r.status, 0, r.stderr);
  const b = block(r.stdout);
  assert.match(b.head, /^gate-1-verdict-stale — 1 finding\(s\):/);
  assert.equal(b.bullets.length, 1, r.stdout);
  assert.match(b.bullets[0], /`feat`/);
  assert.match(b.bullets[0], /"openspec\/changes\/feat\/proposal\.md" changed since the review/);
  assert.match(b.bullets[0], /`record-gate-review feat --gate 1 --verdict pass --artifact <path>`/);
  // the SAME predicate drives the rendered marking (reuse, not a fork): PROJECT.md shows the epic's Gate 1 as stale
  invokeEngine(["render"], { cwd });
  assert.match(fs.readFileSync(path.join(cwd, "PROJECT.md"), "utf8"), /⚠ stale/);
});

test("a legacy verdict with no digests is UNVERIFIABLE, which is not this check's claim", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  put(cwd, ART, "# x\n");
  invokeEngine(["add-epic", "--id", "feat", "--lane", "openspec", "--status", "queued"], { cwd });
  const sp = path.join(cwd, ".conductor", "state.json");
  const st = JSON.parse(fs.readFileSync(sp, "utf8"));
  st.epics.find(e => e.id === "feat").gateReview = { gate1: { verdict: "pass", reviewer: "t", reviewedAt: "2026-09-01T00:00:00.000Z" } };
  fs.writeFileSync(sp, JSON.stringify(st, null, 2));
  const r = invokeEngine(["integrity"], { cwd });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(block(r.stdout).bullets, []);
});
