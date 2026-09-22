// gates-bind-to-verified-evidence — the reconcile gate binds to the detour it was ARMED for.
//
// A verdict answers only a detour `push-detour --reconcile` armed on the paused epic's
// `may-invalidate` link; the obligation survives pointer moves, later detours and destroying writes
// until a verdict answers it; and the 0.44.0 stamp gives every such link an explicit arming record.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, readState, writeState, fixturePluginRoot, invokeEngine } from "../fixtures/assert-harness.mjs";
import { fixtureOnce } from "../fixtures/fixture-snapshot.mjs";

const epicOf = (cwd, id) => readState(cwd).epics.find(e => e.id === id);
const linkOf = (cwd, id, to) => (epicOf(cwd, id).links || []).find(l => l.type === "may-invalidate" && l.epic === to);

function attempt(cwd, args, input) {
  return invokeEngine(args, { cwd, input });
}
function accepted(cwd, args) {
  const r = attempt(cwd, args);
  assert.equal(r.status, 0, `expected exit 0.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  return r;
}
const owes = (cwd, id = "p") => epicOf(cwd, id).reconcileNeeded === true;

/** p active, with d, d2, other and x registered beside it. */
function repo() {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  for (const id of ["p", "d", "d2", "other", "x"]) run(["add-epic", "--id", id, "--lane", "claude-code"], { cwd });
  run(["set-active", "p"], { cwd });
  return cwd;
}
const push = (cwd, detour, reconcile = true, paused = "p") =>
  accepted(cwd, ["push-detour", paused, "--detour", detour, "--reason", "r", reconcile ? "--reconcile" : "--no-reconcile"]);
const pop = (cwd, paused = "p") => accepted(cwd, ["pop-detour", paused]);
/** p owes a reconcile against armed detour d: pushed with --reconcile and popped.
 *
 *  A SNAPSHOT SINCE 0.48.0 (task 3.4). This is the file 4.3 calls out by name: 46 tests, and the
 *  highest per-test cost measured anywhere in the assertion half. Its build is `repo()` — init plus
 *  five add-epic — followed by a push and a pop, and it is called by nearly every test below.
 *  Restoring the built tree is a copy; the assertions are unchanged. */
const owingRepo = fixtureOnce(() => {
  const cwd = repo();
  push(cwd, "d"); pop(cwd);
  return cwd;
}, { name: "pm-owing-reconcile" });
const verdict = (cwd, detour, v = "valid", extra = []) => ["record-reconcile", "p", "--detour", detour, "--verdict", v, ...extra];

// ═══════════════ Requirement: A reconcile verdict answers only a detour the epic owes ═══════════════
// ─────────────── 4.1 SPLIT THIS FILE, AND THIS IS THE FILE-RUNG HALF ───────────────
//
// FORTY-TWO of its forty-six tests moved to `scripts/test/unit/reconcile-obligation.test.mjs` — the
// single largest move of the worklist, and task 4.3's call-out. What is LEFT is the four whose
// subject is a PATH the store does not own:
//
//   * three `upgradeAt()` tests, whose fixture is `fixturePluginRoot(version)` — a REAL plugin
//     directory built on disk — and whose verb back-fills `.gitignore` beside the repository;
//   * `g2-M26d`, whose `add-many` fixture is a BATCH FILE (`batch.json`) that the verb reads by path.
//
// The `fixtureOnce()` snapshot of `owingRepo()` stays here with them: it exists because a tmpdir
// build of that fixture cost 46 repetitions. On the unit rung the same build is a few sub-millisecond
// in-memory invocations, so the snapshot has no subject there.
//
// No assertion changed in either direction.

/** Strip every arming record from p's links — the shape a 0.43.0 engine wrote. */
function as043(cwd) {
  const s = readState(cwd);
  s.pmVersion = "0.43.0";
  for (const l of s.epics.find(e => e.id === "p").links) delete l.reconcileOnResume;
  writeState(cwd, s);
}

const upgradeAt = (cwd, version) => run(["upgrade"], { cwd, env: { CLAUDE_PLUGIN_ROOT: fixturePluginRoot(version) } });

test("6.9g upgrade stamps a keyless link written after the version was already stamped; a self-link is stamped false", () => {
  const cwd = owingRepo();
  accepted(cwd, ["update-epic", "d", "--status", "archived", "--outcome", "killed", "--reason", "r", "--no-deferrals"]);
  const s = readState(cwd);
  s.pmVersion = "0.44.0";
  const p = s.epics.find(e => e.id === "p");
  for (const l of p.links) delete l.reconcileOnResume;
  p.links.push({ type: "may-invalidate", epic: "p", reason: "hand-written self link" });
  writeState(cwd, s);
  upgradeAt(cwd, "0.44.0");
  assert.equal(linkOf(cwd, "p", "d").reconcileOnResume, true, "the keyless unanswered link on an owing epic is armed");
  assert.equal(linkOf(cwd, "p", "p").reconcileOnResume, false, "a self-link can never be answered, so it is stamped false");
  accepted(cwd, verdict(cwd, "d"));
  assert.equal(owes(cwd), false, "with d answered, p owes nothing");
});
test("6.9c the 0.44.0 migration arms only an owing epic's unanswered link", () => {
  const cwd = owingRepo();
  // q: owes nothing, with a keyless no-reconcile link; r: owes, with a keyless answered link.
  run(["add-epic", "--id", "q", "--lane", "claude-code"], { cwd });
  run(["add-epic", "--id", "r", "--lane", "claude-code"], { cwd });
  const s = readState(cwd);
  s.pmVersion = "0.43.0";
  for (const l of s.epics.find(e => e.id === "p").links) delete l.reconcileOnResume;
  s.epics.find(e => e.id === "q").links = [{ type: "may-invalidate", epic: "d2", reason: "no reconcile" }];
  Object.assign(s.epics.find(e => e.id === "r"), { reconcileNeeded: true, links: [
    { type: "may-invalidate", epic: "d", reason: "answered", reconciled: { verdict: "valid", amendments: [], reconciledAt: "2026-09-01T00:00:00.000Z" } }] });
  writeState(cwd, s);
  upgradeAt(cwd, "0.44.0");
  assert.equal(linkOf(cwd, "p", "d").reconcileOnResume, true);
  assert.equal(linkOf(cwd, "q", "d2").reconcileOnResume, false);
  assert.equal(linkOf(cwd, "r", "d").reconcileOnResume, false);
  accepted(cwd, verdict(cwd, "d"));
  assert.equal(owes(cwd), false);
});
test("6.9d REGRESSION GUARD: the stamp is idempotent and leaves a keyed link untouched", () => {
  const cwd = owingRepo();
  as043(cwd);
  const s = readState(cwd);
  s.epics.find(e => e.id === "p").links.push({ type: "may-invalidate", epic: "x", reason: "keyed", reconcileOnResume: false });
  writeState(cwd, s);
  upgradeAt(cwd, "0.44.0");
  const once = readState(cwd);
  assert.equal(linkOf(cwd, "p", "x").reconcileOnResume, false, "a keyed link is untouched");
  upgradeAt(cwd, "0.44.0");
  const twice = readState(cwd);
  delete once.revision; delete twice.revision;
  assert.deepEqual(twice, once, "a second application changes nothing");
});
test("g2-M26d add-many creating an active epic warns about the owing epic it displaces", () => {
  const cwd = owingRepo();
  const batch = path.join(cwd, "batch.json");
  fs.writeFileSync(batch, JSON.stringify({ epics: [{ id: "q", title: "q", lane: "claude-code", priority: "P1", status: "active" }] }));
  const r = accepted(cwd, ["add-many", "--from", batch]);
  assert.ok(r.stderr.includes("'p'") && r.stderr.includes("'d'") && /still owes a reconcile/.test(r.stderr),
    `add-many's stderr names p and d: ${r.stderr}`);
});
