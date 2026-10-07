// scripts/test/assert/gate1-activation-guard.test.mjs
// openspec-gate1-guard-on-apply, the FILE rung: the guard asks whether the epic's change directory is on disk.
// The value-shaped half (the predicate over an injected directory list) is scripts/test/unit/gate1-guard.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { invokeEngine, run, tmpRepo } from "../fixtures/assert-harness.mjs";

const readState = (cwd) => JSON.parse(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"));
const epicOf = (cwd, id) => readState(cwd).epics.find(e => e.id === id);
const mkdirs = (cwd, ...rel) => { for (const r of rel) fs.mkdirSync(path.join(cwd, r), { recursive: true }); };
const repoWith = ({ change = true, lane = "openspec", status = "queued", id = "feat" } = {}) => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  if (change) mkdirs(cwd, `openspec/changes/${id}`);
  const r = invokeEngine(["add-epic", "--id", id, "--lane", lane, "--status", status], { cwd });
  assert.equal(r.status, 0, r.stderr);
  return cwd;
};
const recordGate1 = (cwd, id, verdict = "pass") => {
  fs.writeFileSync(path.join(cwd, "openspec", "changes", id, "proposal.md"), "# p\n");
  const r = invokeEngine(["record-gate-review", id, "--gate", "1", "--verdict", verdict, "--artifact", `openspec/changes/${id}/proposal.md`, "--reviewer", "t"], { cwd });
  assert.equal(r.status, 0, r.stderr);
};

test("set-active refuses an openspec epic whose change is on disk with no Gate 1, names both remedies, and writes nothing", () => {
  const cwd = repoWith();
  const before = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
  const r = invokeEngine(["set-active", "feat"], { cwd });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /cannot make openspec-lane epic 'feat' active/);
  assert.match(r.stderr, /it has no Gate 1 \(spec review\) verdict/);
  assert.match(r.stderr, /`record-gate-review feat --gate 1 --verdict pass --artifact <path>`/);
  assert.match(r.stderr, /`update-epic feat --status active --gate1-waived "<why Gate 1 does not apply>"`/);
  assert.equal(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"), before);
});

test("update-epic --status active is refused the same way, and a PASSING Gate 1 lets both doors through", () => {
  const cwd = repoWith();
  const r = invokeEngine(["update-epic", "feat", "--status", "active"], { cwd });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /cannot make openspec-lane epic 'feat' active/);
  assert.equal(epicOf(cwd, "feat").status, "queued");
  recordGate1(cwd, "feat");
  assert.equal(invokeEngine(["update-epic", "feat", "--status", "active"], { cwd }).status, 0);
  assert.equal(readState(cwd).active, "feat");
  assert.equal(invokeEngine(["set-active", "feat"], { cwd }).status, 0);
});

test("a FAILING Gate 1 and a WITHDRAWN Gate 1 are refused, each named as what it is", () => {
  const cwd = repoWith();
  recordGate1(cwd, "feat", "fail");
  let r = invokeEngine(["set-active", "feat"], { cwd });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Gate 1 \(spec review\) verdict is 'fail', not pass/);
  recordGate1(cwd, "feat", "pass");
  assert.equal(invokeEngine(["update-epic", "feat", "--withdraw-gate-review", "1", "--withdrawal-reason", "redo"], { cwd }).status, 0);
  r = invokeEngine(["set-active", "feat"], { cwd });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Gate 1 \(spec review\) verdict was withdrawn/);
});

test("PRE-PROPOSE (no change on disk), non-openspec lanes, and an already-active epic are never refused", () => {
  const pre = repoWith({ change: false });
  assert.equal(invokeEngine(["set-active", "feat"], { cwd: pre }).status, 0, "no change on disk: activating is how it gets written");
  const sp = repoWith({ lane: "superpowers" });
  assert.equal(invokeEngine(["set-active", "feat"], { cwd: sp }).status, 0);
  // Already active: a note on it is not a transition, even once the change appears and Gate 1 is absent.
  mkdirs(pre, "openspec/changes/feat");
  const r = invokeEngine(["update-epic", "feat", "--status", "active", "--notes", "still going"], { cwd: pre });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(invokeEngine(["set-active", "feat"], { cwd: pre }).status, 0);
});

test("the waiver: one call waives and activates; it is stored with its reason; --clear is the inverse and re-arms the guard", () => {
  const cwd = repoWith();
  const w = invokeEngine(["update-epic", "feat", "--status", "active", "--gate1-waived", "tiny doc-only change, no spec to review"], { cwd });
  assert.equal(w.status, 0, w.stderr);
  assert.equal(epicOf(cwd, "feat").gate1Waived, "tiny doc-only change, no spec to review");
  assert.equal(epicOf(cwd, "feat").status, "active");
  // park it, clear the waiver, and the guard is back
  assert.equal(invokeEngine(["update-epic", "feat", "--status", "queued"], { cwd }).status, 0);
  assert.equal(invokeEngine(["update-epic", "feat", "--clear", "gate1-waived"], { cwd }).status, 0);
  assert.equal(epicOf(cwd, "feat").gate1Waived, undefined);
  assert.equal(invokeEngine(["set-active", "feat"], { cwd }).status, 1);
  // clearing in the SAME call as the activation does not smuggle the stored waiver through
  assert.equal(invokeEngine(["update-epic", "feat", "--gate1-waived", "again"], { cwd }).status, 0);
  const both = invokeEngine(["update-epic", "feat", "--status", "active", "--clear", "gate1-waived"], { cwd });
  assert.equal(both.status, 1, both.stderr);
});

test("the waiver needs a reason and is refused on a non-openspec epic", () => {
  const cwd = repoWith();
  const blank = invokeEngine(["update-epic", "feat", "--gate1-waived", ""], { cwd });
  assert.equal(blank.status, 1);
  assert.equal(epicOf(cwd, "feat").gate1Waived, undefined);
  const sp = repoWith({ lane: "superpowers" });
  const r = invokeEngine(["update-epic", "feat", "--gate1-waived", "why"], { cwd: sp });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--gate1-waived applies only to an openspec-lane epic/);
});

test("add-epic and add-many creating AT active are refused when the change is on disk (add-many refuses the whole batch)", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  mkdirs(cwd, "openspec/changes/feat");
  const a = invokeEngine(["add-epic", "--id", "feat", "--lane", "openspec", "--status", "active"], { cwd });
  assert.equal(a.status, 1);
  assert.match(a.stderr, /cannot make openspec-lane epic 'feat' active/);
  assert.match(a.stderr, /Register it at another status/);
  assert.equal(epicOf(cwd, "feat"), undefined);
  const batch = path.join(cwd, "batch.json");
  fs.writeFileSync(batch, JSON.stringify({ epics: [{ id: "other", lane: "claude-code" }, { id: "feat", lane: "openspec", status: "active" }] }));
  const m = invokeEngine(["add-many", "--from", batch], { cwd });
  assert.equal(m.status, 1, m.stderr);
  assert.match(m.stderr, /cannot make openspec-lane epic 'feat' active/);
  assert.equal(epicOf(cwd, "other"), undefined, "the whole batch was refused");
});

test("push-detour WARNS about an unreviewed openspec detour instead of refusing (pop-detour shares the one notice helper)", () => {
  const cwd = repoWith({ status: "queued" });
  run(["add-epic", "--id", "fix", "--lane", "claude-code", "--status", "queued"], { cwd });
  run(["add-epic", "--id", "base", "--lane", "claude-code", "--status", "active"], { cwd });
  const push = invokeEngine(["push-detour", "base", "--detour", "feat", "--reason", "x", "--no-reconcile"], { cwd });
  assert.equal(push.status, 0, push.stderr);
  assert.match(push.stderr, /warning — 'feat' is now active but it has no Gate 1/);
});
