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

const stateFile = (cwd) => path.join(cwd, ".conductor", "state.json");
const stateBytes = (cwd) => fs.readFileSync(stateFile(cwd));
const epicOf = (cwd, id) => readState(cwd).epics.find(e => e.id === id);
const linkOf = (cwd, id, to) => (epicOf(cwd, id).links || []).find(l => l.type === "may-invalidate" && l.epic === to);

function attempt(cwd, args, input) {
  return invokeEngine(args, { cwd, input });
}
function refused(cwd, args) {
  const before = stateBytes(cwd);
  const r = attempt(cwd, args);
  assert.notEqual(r.status, 0, `expected a refusal, got exit 0.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  assert.ok(stateBytes(cwd).equals(before), "a refused invocation must leave state.json byte-identical");
  return r;
}
function accepted(cwd, args) {
  const r = attempt(cwd, args);
  assert.equal(r.status, 0, `expected exit 0.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  return r;
}
/** gate-guard's exit status for an Edit on the active epic: 2 blocks, 0 allows. */
const guard = (cwd) => attempt(cwd, ["gate-guard"], JSON.stringify({ tool_name: "Edit", tool_input: {} })).status;
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
/** p owes a reconcile against armed detour d: pushed with --reconcile and popped. */
function owingRepo() {
  const cwd = repo();
  push(cwd, "d"); pop(cwd);
  return cwd;
}
const verdict = (cwd, detour, v = "valid", extra = []) => ["record-reconcile", "p", "--detour", detour, "--verdict", v, ...extra];

// ═══════════════ Requirement: A reconcile verdict answers only a detour the epic owes ═══════════════

test("6.1 a verdict against the paused epic itself is refused naming the owed detour", () => {
  const cwd = owingRepo();
  const r = refused(cwd, verdict(cwd, "p"));
  assert.ok(r.stderr.includes("'d'"), `the refusal names d: ${r.stderr}`);
  assert.equal(guard(cwd), 2, "gate-guard still blocks");
});

test("6.2 a verdict against an unrelated epic is refused and writes no link", () => {
  const cwd = owingRepo();
  refused(cwd, verdict(cwd, "other"));
  assert.equal((epicOf(cwd, "p").links || []).some(l => l.epic === "other"), false, "no link to other");
});

test("6.3 a detour pushed without reconcile does not answer an armed one", () => {
  const cwd = owingRepo();
  push(cwd, "d2", false); pop(cwd);
  const r = refused(cwd, verdict(cwd, "d2"));
  assert.ok(r.stderr.includes("'d'"), `the refusal names d: ${r.stderr}`);
});

test("6.4 a verdict while the detour's frame is still on the stack is refused", () => {
  const cwd = repo();
  push(cwd, "d");
  refused(cwd, verdict(cwd, "d"));
});

test("6.5 REGRESSION GUARD: the armed detour's verdict clears the obligation", () => {
  const cwd = owingRepo();
  accepted(cwd, verdict(cwd, "d"));
  assert.equal(linkOf(cwd, "p", "d").reconciled.verdict, "valid");
  assert.equal(owes(cwd), false);
  assert.equal(guard(cwd), 0);
});

test("6.6 two armed detours need two verdicts", () => {
  const cwd = repo();
  push(cwd, "d"); pop(cwd);
  push(cwd, "d2"); pop(cwd);
  accepted(cwd, verdict(cwd, "d"));
  assert.equal(owes(cwd), true, "d2 is still unanswered");
  assert.equal(guard(cwd), 2);
  accepted(cwd, verdict(cwd, "d2"));
  assert.equal(owes(cwd), false);
});

test("6.7 re-pushing to an answered detour re-arms it, keeping the earlier verdict readable", () => {
  const cwd = owingRepo();
  accepted(cwd, verdict(cwd, "d", "valid"));
  push(cwd, "d"); pop(cwd);
  assert.equal(owes(cwd), true);
  accepted(cwd, verdict(cwd, "d", "invalidated"));
  const l = linkOf(cwd, "p", "d");
  assert.equal(owes(cwd), false);
  assert.equal(l.reconciled.verdict, "invalidated");
  assert.equal(l.superseded.verdict, "valid", "the earlier verdict is still readable");
});

test("6.8 correcting a recorded verdict keeps the one it replaces and sets no obligation", () => {
  const cwd = owingRepo();
  accepted(cwd, verdict(cwd, "d", "valid"));
  accepted(cwd, verdict(cwd, "d", "invalidated"));
  const l = linkOf(cwd, "p", "d");
  assert.equal(l.reconciled.verdict, "invalidated");
  assert.equal(l.superseded.verdict, "valid");
  assert.equal(owes(cwd), false);
});

test("6.9a a hand-supplied may-invalidate link is never armed", () => {
  const cwd = owingRepo();
  accepted(cwd, ["update-epic", "p", "--link", "may-invalidate:x:why"]);
  assert.equal(linkOf(cwd, "p", "x").reconcileOnResume, false, "the hand-supplied link carries a false arming record");
  const r = refused(cwd, verdict(cwd, "x"));
  assert.ok(r.stderr.includes("'d'"), `the refusal names d: ${r.stderr}`);
});

/** Strip every arming record from p's links — the shape a 0.43.0 engine wrote. */
function as043(cwd) {
  const s = readState(cwd);
  s.pmVersion = "0.43.0";
  for (const l of s.epics.find(e => e.id === "p").links) delete l.reconcileOnResume;
  writeState(cwd, s);
}

test("6.9b an unmigrated link refuses every verdict naming /pm:upgrade, and render keeps the active epic owing", () => {
  const cwd = owingRepo();
  as043(cwd);
  const r = refused(cwd, verdict(cwd, "d"));
  assert.match(r.stderr, /\/pm:upgrade/);
  run(["render"], { cwd });
  assert.equal(owes(cwd), true);
});

test("6.9f a verdict against a NEW detour cannot clear an unmigrated obligation", () => {
  const cwd = owingRepo();
  as043(cwd);
  push(cwd, "d2"); pop(cwd);
  const r = refused(cwd, verdict(cwd, "d2"));
  assert.match(r.stderr, /\/pm:upgrade/);
  assert.equal(owes(cwd), true);
});

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

test("6.9e REGRESSION GUARD: a 0.43.0 state file loads and the read-only verbs exit as before", () => {
  const cwd = owingRepo();
  as043(cwd);
  const before = stateBytes(cwd);
  assert.equal(attempt(cwd, ["brief"]).status, 0);
  assert.equal(attempt(cwd, ["integrity"]).status, 0);
  assert.equal(guard(cwd), 2, "the active owing epic still blocks");
  assert.ok(stateBytes(cwd).equals(before), "read-only verbs wrote nothing");
});

// ═══════════════ Requirement: A reconcile obligation survives until a verdict answers it ═══════════════

const namesPD = (text) => text.includes("'p'") && text.includes("'d'");

test("7.1 clearing the active pointer does not erase the obligation, and says so", () => {
  const cwd = owingRepo();
  const r = accepted(cwd, ["clear-active"]);
  assert.ok(namesPD(r.stderr) && /reconcile/.test(r.stderr), `clear-active's stderr names p and d: ${r.stderr}`);
  run(["render"], { cwd });
  assert.equal(owes(cwd), true);
});

test("7.2 activating another epic and returning restores the block", () => {
  const cwd = owingRepo();
  accepted(cwd, ["set-active", "other"]);
  accepted(cwd, ["set-active", "p"]);
  assert.equal(owes(cwd), true);
  assert.equal(guard(cwd), 2);
});

test("7.3 a status change on another epic, or creating one at active, warns and keeps the obligation", () => {
  const cwd = owingRepo();
  const r = accepted(cwd, ["update-epic", "other", "--status", "active"]);
  assert.ok(namesPD(r.stderr) && /reconcile/.test(r.stderr), `update-epic's stderr names p and d: ${r.stderr}`);
  run(["render"], { cwd });
  assert.equal(owes(cwd), true);
  accepted(cwd, ["set-active", "p"]);
  const q = accepted(cwd, ["add-epic", "--id", "q", "--title", "q", "--lane", "claude-code", "--status", "active"]);
  assert.ok(namesPD(q.stderr) && /reconcile/.test(q.stderr), `add-epic's stderr names p and d: ${q.stderr}`);
  run(["render"], { cwd });
  assert.equal(owes(cwd), true);
});

test("7.4 archiving and un-archiving does not erase the obligation", () => {
  const cwd = owingRepo();
  accepted(cwd, ["update-epic", "p", "--status", "archived", "--outcome", "abandoned", "--reason", "r", "--no-deferrals"]);
  accepted(cwd, ["update-epic", "p", "--status", "active"]);
  assert.equal(owes(cwd), true);
  assert.equal(guard(cwd), 2);
});

test("7.4b REGRESSION GUARD: an archived owing epic does not make gate-guard block", () => {
  const cwd = owingRepo();
  accepted(cwd, ["update-epic", "p", "--status", "archived", "--outcome", "abandoned", "--reason", "r", "--no-deferrals"]);
  const s = readState(cwd);
  s.active = "p";   // the pointer can legitimately name an archived epic for a stretch
  writeState(cwd, s);
  assert.equal(guard(cwd), 0);
});

test("7.4a an obligation with no link a verdict could answer is cleared by render, which says so; an armed one is not", () => {
  const cwd = repo();
  const s = readState(cwd);
  Object.assign(s.epics.find(e => e.id === "p"), { reconcileNeeded: true,
    links: [{ type: "may-invalidate", epic: "d", reason: "hand-added", reconcileOnResume: false }] });
  writeState(cwd, s);
  const r = attempt(cwd, ["render"]);
  assert.equal(r.status, 0);
  assert.equal(owes(cwd), false, "nothing could ever answer it, so it is cleared");
  assert.ok(r.stderr.includes("'p'"), `the heal names p: ${r.stderr}`);

  const armed = owingRepo();
  accepted(armed, ["clear-active"]);
  run(["render"], { cwd: armed });
  assert.equal(owes(armed), true, "an armed link keeps the obligation through clear-active + render");
});

// ═══════════════ Requirement: A later detour never overwrites an earlier reconcile obligation ═══════════════

const honchoLog = (cwd) => { try { return fs.readFileSync(path.join(cwd, ".conductor", "honcho-memories.log"), "utf8"); } catch { return ""; } };

test("8.1 a no-reconcile push keeps the pending obligation and does not say none is owed", () => {
  const cwd = owingRepo();
  const r = push(cwd, "d2", false);
  assert.equal(owes(cwd), true);
  assert.doesNotMatch(r.stdout + r.stderr, /NO reconcile on resume/);
});

test("8.2 the pop does not claim a reconcile nobody recorded", () => {
  const cwd = owingRepo();
  push(cwd, "d2", false);
  const before = honchoLog(cwd);
  const r = pop(cwd);
  assert.doesNotMatch(r.stdout, /no reconcile was required/);
  assert.doesNotMatch(honchoLog(cwd).slice(before.length), /resumed p/, "no POP line is logged for p");
  assert.ok(r.stderr.includes("'d'"), `stderr names d as owed: ${r.stderr}`);
  assert.equal(guard(cwd), 2);
});

test("8.2a a no-reconcile push to the same armed detour never lowers its arming", () => {
  const cwd = owingRepo();
  push(cwd, "d", false); pop(cwd);
  run(["render"], { cwd });
  assert.equal(owes(cwd), true);
  accepted(cwd, verdict(cwd, "d"));
});

test("8.3 REGRESSION GUARD: a pop that owes nothing still emits and logs its memory line", () => {
  const cwd = repo();
  push(cwd, "d", false);
  const r = pop(cwd);
  assert.match(r.stdout, /resumed p, reconciled vs d; no reconcile was required/);
  assert.match(honchoLog(cwd), /resumed p, reconciled vs d; no reconcile was required/);
});

// ═══════════════ Requirement: A write never destroys the record of an owed reconcile ═══════════════

test("9.1 clearing links on an owing epic is refused naming record-reconcile", () => {
  const cwd = owingRepo();
  const r = refused(cwd, ["update-epic", "p", "--clear-links"]);
  assert.match(r.stderr, /record-reconcile/);
});

test("9.2 removing an armed detour is refused naming record-reconcile, not a detour pop", () => {
  const cwd = owingRepo();
  const r = refused(cwd, ["remove-epic", "d"]);
  assert.match(r.stderr, /record-reconcile/);
  assert.doesNotMatch(r.stderr, /Resume or pop the detour/);
  assert.equal(owes(cwd), true);
  assert.ok(linkOf(cwd, "p", "d"), "the link to d is still there");
});

test("9.3 correcting a link's reason keeps its verdict and arming", () => {
  const cwd = owingRepo();
  accepted(cwd, verdict(cwd, "d"));
  accepted(cwd, ["update-epic", "p", "--link", "may-invalidate:d:corrected reason"]);
  const l = linkOf(cwd, "p", "d");
  assert.equal(l.reason, "corrected reason");
  assert.equal(l.reconciled.verdict, "valid");
  assert.equal(l.reconcileOnResume, true);
  assert.equal(owes(cwd), false);
});

test("9.3a an answered armed link is protected while another obligation stands", () => {
  const cwd = repo();
  push(cwd, "d"); pop(cwd);
  push(cwd, "d2"); pop(cwd);
  accepted(cwd, verdict(cwd, "d"));
  refused(cwd, ["update-epic", "p", "--clear-links"]);
  refused(cwd, ["remove-epic", "d"]);
});

test("9.3b on an owing epic the repair instructions name record-reconcile first, and the repair is refused", () => {
  const cwd = owingRepo();
  const s = readState(cwd);
  s.epics.find(e => e.id === "p").links.push({ type: "depends_on", epic: "x" });
  writeState(cwd, s);
  const integ = attempt(cwd, ["integrity"]).stdout;
  const finding = integ.split("\n").find(l => l.includes("depends_on")) || "";
  assert.ok(finding.includes("record-reconcile"), `the finding names record-reconcile: ${finding}`);
  assert.ok(finding.indexOf("record-reconcile") < finding.indexOf("--clear-links"), "record-reconcile comes before the repair");
  const w = refused(cwd, ["update-epic", "p", "--link", "depends_on:x"]);
  assert.ok(w.stderr.includes("record-reconcile") && w.stderr.indexOf("record-reconcile") < w.stderr.lastIndexOf("--clear-links"),
    `the write-time repair message names record-reconcile first: ${w.stderr}`);
  refused(cwd, ["update-epic", "p", "--clear-links", "--link", "may-invalidate:d:kept"]);
});

// ═══════════════ Amendments ═══════════════

test("10.1 --amendments none (any case) records no amendments", () => {
  for (const spelling of ["none", "None"]) {
    const cwd = owingRepo();
    accepted(cwd, verdict(cwd, "d", "valid", ["--amendments", spelling]));
    assert.deepEqual(linkOf(cwd, "p", "d").reconciled.amendments, []);
  }
});

test("10.2 a repeated --amendment keeps each amendment whole, in order", () => {
  const cwd = owingRepo();
  accepted(cwd, verdict(cwd, "d", "valid", ["--amendment", "rename x; keep y", "--amendment", "drop z"]));
  assert.deepEqual(linkOf(cwd, "p", "d").reconciled.amendments, ["rename x; keep y", "drop z"]);
});

test("10.3 --amendment and --amendments together are refused as a combination, not as an unknown flag", () => {
  const cwd = owingRepo();
  const r = refused(cwd, verdict(cwd, "d", "valid", ["--amendment", "a", "--amendments", "b"]));
  assert.doesNotMatch(r.stderr, /unknown flag/);
  assert.match(r.stderr, /cannot be combined/);
});

// ═══════════════ Gate 2 follow-up (minors) ═══════════════

test("g2-m1 the heal never clears an obligation while ANY frame still pauses the epic", () => {
  const cwd = repo();
  push(cwd, "d", false);                       // a --no-reconcile frame for p stays on the stack
  const s = readState(cwd);
  s.epics.find(e => e.id === "p").reconcileNeeded = true;   // owed, with no armed link
  writeState(cwd, s);
  const r = attempt(cwd, ["render"]);
  assert.equal(r.status, 0);
  assert.equal(owes(cwd), true, "a live frame still pauses p, so the heal's 'no detour frame' claim would be false");
  assert.doesNotMatch(r.stderr, /cleared the reconcile obligation/);
});

test("g2-m2 an unmigrated epic names /pm:upgrade even when --detour names no epic", () => {
  const cwd = owingRepo();
  as043(cwd);
  const r = refused(cwd, verdict(cwd, "ghost"));
  assert.match(r.stderr, /\/pm:upgrade/);
});

test("g2-m3a integrity words an owed-reconcile link to a hand-removed detour as removed, with the add-epic recovery", () => {
  const cwd = owingRepo();
  const s = readState(cwd);
  s.epics = s.epics.filter(e => e.id !== "d");
  writeState(cwd, s);
  const line = attempt(cwd, ["integrity"]).stdout.split("\n").find(l => l.includes("names `d`")) || "";
  assert.ok(line, "the dangling reference to d is reported");
  assert.doesNotMatch(line, /record-reconcile` answers it/, "record-reconcile refuses a detour that does not exist");
  assert.match(line, /add-epic --id d\b/, `the finding names the recovery: ${line}`);
});

// ═══════════════ Gate 2 follow-up: tests that kill the surviving mutants ═══════════════

const LINKS = new URL("../../lib/links.mjs", import.meta.url).href;

test("g2-M01 a keyless may-invalidate link is never armed, and owes nothing", async () => {
  const { isArmed, ownedDetours } = await import(LINKS);
  const keyless = { type: "may-invalidate", epic: "d", reason: "written by 0.43.0" };
  assert.equal(isArmed(keyless), false);
  assert.deepEqual(ownedDetours({ id: "p", reconcileNeeded: true, links: [keyless] }), []);
});

test("g2-M15 before upgrade, --clear-links on an owing epic holding a keyless link is refused", () => {
  const cwd = owingRepo();
  as043(cwd);
  const r = refused(cwd, ["update-epic", "p", "--clear-links"]);
  assert.match(r.stderr, /record-reconcile/);
});

test("g2-M15b the upgrade stamp never arms a link to a missing epic or to the epic itself", async () => {
  const { stampReconcileKeys } = await import(LINKS);
  const state = { epics: [{ id: "p", reconcileNeeded: true, links: [
    { type: "may-invalidate", epic: "gone", reason: "detour removed by hand" },
    { type: "may-invalidate", epic: "p", reason: "self link" },
  ] }] };
  stampReconcileKeys(state);
  const [toMissing, toSelf] = state.epics[0].links;
  assert.equal(toMissing.reconcileOnResume, false, "a link to a missing epic is stamped false");
  assert.equal(toSelf.reconcileOnResume, false, "a self-link is stamped false");
});

test("g2-M07 the heal counts an ANSWERED armed link as armed, and keeps the obligation", () => {
  const cwd = owingRepo();
  accepted(cwd, verdict(cwd, "d"));
  const s = readState(cwd);
  s.epics.find(e => e.id === "p").reconcileNeeded = true;   // owing, holding only an answered armed link
  writeState(cwd, s);
  const r = attempt(cwd, ["render"]);
  assert.equal(r.status, 0);
  assert.equal(owes(cwd), true, "an answered armed link is still a link a verdict can be recorded against");
});

test("g2-M19 re-arming with --reconcile moves the link's old verdict to superseded and leaves it unanswered", () => {
  const cwd = owingRepo();
  accepted(cwd, verdict(cwd, "d", "valid"));
  push(cwd, "d"); pop(cwd);
  const l = linkOf(cwd, "p", "d");
  assert.equal(l.reconciled, undefined, "the re-armed link reads unanswered");
  assert.equal(l.superseded && l.superseded.verdict, "valid", "the earlier verdict moved to superseded");
  assert.equal(l.reconcileOnResume, true);
});

test("g2-M23c a correction on an epic whose flag is already false does not raise it", () => {
  const cwd = repo();
  const s = readState(cwd);
  Object.assign(s.epics.find(e => e.id === "p"), { reconcileNeeded: false, links: [
    { type: "may-invalidate", epic: "d", reason: "r", reconcileOnResume: true,
      reconciled: { verdict: "valid", amendments: [], reconciledAt: "2026-09-01T00:00:00.000Z" } },
    { type: "may-invalidate", epic: "d2", reason: "r", reconcileOnResume: true },
  ] });
  writeState(cwd, s);
  accepted(cwd, verdict(cwd, "d", "invalidated"));
  assert.equal(owes(cwd), false, "a correction never raises the flag");
});

test("g2-M29 pop-detour warns when the pointer leaves a detour that itself owes a reconcile", () => {
  const cwd = repo();
  push(cwd, "d");                               // p paused for d; d active
  push(cwd, "d2", true, "d");                   // d paused for d2; d2 active
  pop(cwd, "d");                                // d resumes and owes d2
  const r = pop(cwd, "p");                      // the pointer moves off d
  assert.ok(r.stderr.includes("'d' is no longer the active epic") && r.stderr.includes("'d2'"),
    `pop-detour names the owing detour and what it owes: ${r.stderr}`);
});

test("g2-M26d add-many creating an active epic warns about the owing epic it displaces", () => {
  const cwd = owingRepo();
  const batch = path.join(cwd, "batch.json");
  fs.writeFileSync(batch, JSON.stringify({ epics: [{ id: "q", title: "q", lane: "claude-code", priority: "P1", status: "active" }] }));
  const r = accepted(cwd, ["add-many", "--from", batch]);
  assert.ok(r.stderr.includes("'p'") && r.stderr.includes("'d'") && /still owes a reconcile/.test(r.stderr),
    `add-many's stderr names p and d: ${r.stderr}`);
});

test("g2-M26e set-active warns about the owing epic it moves off", () => {
  const cwd = owingRepo();
  const r = accepted(cwd, ["set-active", "other"]);
  assert.ok(r.stderr.includes("'p'") && r.stderr.includes("'d'") && /still owes a reconcile/.test(r.stderr),
    `set-active's stderr names p and d: ${r.stderr}`);
});

test("g2-4 pop-detour reads the obligation AFTER the heal: no record-reconcile instruction when the saved flag is false", () => {
  const cwd = repo();
  push(cwd, "d", false);                                     // a --no-reconcile frame
  const s = readState(cwd);
  s.epics.find(e => e.id === "p").reconcileNeeded = true;    // hand-edit: owed, with nothing armed
  writeState(cwd, s);
  const r = pop(cwd);
  assert.equal(owes(cwd), false, "precondition: the heal cleared the unanswerable obligation");
  assert.doesNotMatch(r.stderr, /RECONCILE GATE|record-reconcile p --detour/,
    `the pop must not instruct a verdict the engine would refuse: ${r.stderr}`);
});
