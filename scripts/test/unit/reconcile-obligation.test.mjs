// scripts/test/unit/reconcile-obligation.test.mjs
// 4.1's migration of `assert/reconcile-obligation.test.mjs` — 42 of its 46 tests, the single
// largest move of the worklist (task 4.3 calls this file out by name), with every assertion
// unchanged.
//
// `gates-bind-to-verified-evidence` — the reconcile gate binds to the detour it was ARMED for.
//
// A verdict answers only a detour `push-detour --reconcile` armed on the paused epic's
// `may-invalidate` link; the obligation survives pointer moves, later detours and destroying writes
// until a verdict answers it; and the 0.44.0 stamp gives every such link an explicit arming record.
//
// ─────────────── THE ONE COMMIT, AND WHY NOT THREE ───────────────
//
// 4.3 asks the author to say whether this file splits into one commit or three. IT IS ONE, and the
// reason is that the file is not three populations: it is ONE fixture (`owingRepo()`) and one set of
// helpers (`refused`/`accepted`/`guard`/`owes`/`push`/`pop`/`verdict`) driving every section. Splitting
// the commit would have split nothing mechanically — the same helper rewrite lands three times, and
// the second and third commits would each be unable to run without the first.
//
// ─────────────── WHAT MOVED, AND WHAT DID NOT ───────────────
//
// Everything this file asserts is what the RECORD says or what a verb PRINTED: the link's arming
// record, the `reconcileNeeded` flag, gate-guard's exit status, a refusal's wording, the honcho
// memory line. So 42 of 46 moved. The mechanism that changed, and it is only the mechanism:
//
//   `tmpRepo()` + `run(["init"], { cwd })`  →  `memoryEngine(emptyRecord())`
//   `run(args, { cwd })`                    →  `engine(args)`
//   `invokeEngine(args, { cwd, input })`    →  `engine.result(args, { input })` — the options bag
//                                              now carries stdin, because gate-guard reads its
//                                              JSON payload off STDIN and that is a value
//   `readState(cwd)` / `stateBytes(cwd)`    →  `engine.store.record()` /
//                                              `engine.store.read("state.json").text`
//   the manufactured-record write-back          →  **no call at all** — see below
//   `fs.readFileSync(honcho-memories.log)`  →  `engine.store.read("honcho-memories.log").text`
//
// THE `fixtureOnce()` SNAPSHOT IS GONE ON THIS RUNG, deliberately and with its reason: it exists
// because building `owingRepo()` cost a tmpdir, five `add-epic`s, a push and a pop — 46 times. A
// memory-store build is five invocations of ~0.8 ms and needs no tmpdir, so the snapshot would have
// nothing to save and a copy to restore. The assertions are identical; only the build is.
//
// VARIABLE NAME: the file-rung tests hold a `cwd`; here the same value is the ENGINE (the thing the
// store hangs off), so `cwd` is spelled `engine` throughout. That rename is the whole of the
// textual difference in the moved bodies.//
// THE MANUFACTURED-RECORD WRITE-BACK IS GONE RATHER THAN TRANSLATED, and the reason is the seam's
// own shape: on disk `readState()` hands back a PARSED COPY, so a test that manufactures a record has
// to write it back. The memory store hands back THE RECORD IT HOLDS, so the mutations the test has
// just made ARE the write and the call would be a no-op. `writeRecord()` is NOT the equivalent — it
// refuses a revision the store did not expect, which is the guard these tests then observe. The one
// helper that still needs a name for it is `mutateRecord()`, used by `as043()`.
//
// FOUR STAY ON THE FILE RUNG, in `assert/reconcile-obligation.test.mjs`:
//
//   * three `upgradeAt()` tests, whose fixture is `fixturePluginRoot(version)` — a REAL plugin
//     directory built on disk, and `upgrade` back-fills `.gitignore` beside it;
//   * `g2-M26d`, whose `add-many` fixture is a BATCH FILE (`batch.json`) that the verb reads by
//     path.

import assert from "node:assert/strict";
import { emptyRecord, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

const readState = (engine) => engine.store.record();
const stateBytes = (engine) => engine.store.read("state.json").text;
const epicOf = (engine, id) => readState(engine).epics.find(e => e.id === id);
const linkOf = (engine, id, to) => (epicOf(engine, id).links || []).find(l => l.type === "may-invalidate" && l.epic === to);

/** The file rung's `fs.writeFileSync(stateFile(cwd), …)`: hand the record straight back to the
 *  store, with no verb in the chain. `writeRecord()` is NOT the equivalent — it refuses a revision
 *  the store did not expect, which is the guard, not the fixture. */
function mutateRecord(engine, edit) {
  edit(engine.store.record());
}

function attempt(engine, args, input) {
  return engine.result(args, { input });
}
function refused(engine, args) {
  const before = stateBytes(engine);
  const r = attempt(engine, args);
  assert.notEqual(r.status, 0, `expected a refusal, got exit 0.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  assert.equal(stateBytes(engine), before, "a refused invocation must leave state.json byte-identical");
  return r;
}
function accepted(engine, args) {
  const r = attempt(engine, args);
  assert.equal(r.status, 0, `expected exit 0.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  return r;
}
/** gate-guard's exit status for an Edit on the active epic: 2 blocks, 0 allows. */
const guard = (engine) => attempt(engine, ["gate-guard"], JSON.stringify({ tool_name: "Edit", tool_input: {} })).status;
const owes = (engine, id = "p") => epicOf(engine, id).reconcileNeeded === true;

/** p active, with d, d2, other and x registered beside it. */
function repo() {
  const engine = memoryEngine(emptyRecord());
  for (const id of ["p", "d", "d2", "other", "x"]) engine(["add-epic", "--id", id, "--lane", "claude-code"]);
  engine(["set-active", "p"]);
  return engine;
}
const push = (engine, detour, reconcile = true, paused = "p") =>
  accepted(engine, ["push-detour", paused, "--detour", detour, "--reason", "r", reconcile ? "--reconcile" : "--no-reconcile"]);
const pop = (engine, paused = "p") => accepted(engine, ["pop-detour", paused]);
/** p owes a reconcile against armed detour d: pushed with --reconcile and popped.
 *
 *  A PLAIN BUILD ON THIS RUNG, where it was a `fixtureOnce()` snapshot on the file rung (task 3.4):
 *  the snapshot existed because a tmpdir + five add-epic + a push + a pop was worth caching across
 *  46 tests. A memory-store build is a few sub-millisecond invocations and copies nothing, so the
 *  snapshot's subject — a directory tree to restore — does not exist here. The assertions are
 *  unchanged. */
const owingRepo = () => {
  const engine = repo();
  push(engine, "d"); pop(engine);
  return engine;
};
const verdict = (engine, detour, v = "valid", extra = []) => ["record-reconcile", "p", "--detour", detour, "--verdict", v, ...extra];

/** Strip every arming record from p's links — the shape a 0.43.0 engine wrote. */
function as043(engine) {
  mutateRecord(engine, s => {
    s.pmVersion = "0.43.0";
    for (const l of s.epics.find(e => e.id === "p").links) delete l.reconcileOnResume;
  });
}

const honchoLog = (engine) => { try { return engine.store.read("honcho-memories.log").text; } catch { return ""; } };


const namesPD = (text) => text.includes("'p'") && text.includes("'d'");

unitTest("6.1 a verdict against the paused epic itself is refused naming the owed detour", () => {
  const engine = owingRepo();
  const r = refused(engine, verdict(engine, "p"));
  assert.ok(r.stderr.includes("'d'"), `the refusal names d: ${r.stderr}`);
  assert.equal(guard(engine), 2, "gate-guard still blocks");
});
unitTest("6.2 a verdict against an unrelated epic is refused and writes no link", () => {
  const engine = owingRepo();
  refused(engine, verdict(engine, "other"));
  assert.equal((epicOf(engine, "p").links || []).some(l => l.epic === "other"), false, "no link to other");
});
unitTest("6.3 a detour pushed without reconcile does not answer an armed one", () => {
  const engine = owingRepo();
  push(engine, "d2", false); pop(engine);
  const r = refused(engine, verdict(engine, "d2"));
  assert.ok(r.stderr.includes("'d'"), `the refusal names d: ${r.stderr}`);
});
unitTest("6.4 a verdict while the detour's frame is still on the stack is refused", () => {
  const engine = repo();
  push(engine, "d");
  refused(engine, verdict(engine, "d"));
});
unitTest("6.5 REGRESSION GUARD: the armed detour's verdict clears the obligation", () => {
  const engine = owingRepo();
  accepted(engine, verdict(engine, "d"));
  assert.equal(linkOf(engine, "p", "d").reconciled.verdict, "valid");
  assert.equal(owes(engine), false);
  assert.equal(guard(engine), 0);
});
unitTest("6.6 two armed detours need two verdicts", () => {
  const engine = repo();
  push(engine, "d"); pop(engine);
  push(engine, "d2"); pop(engine);
  accepted(engine, verdict(engine, "d"));
  assert.equal(owes(engine), true, "d2 is still unanswered");
  assert.equal(guard(engine), 2);
  accepted(engine, verdict(engine, "d2"));
  assert.equal(owes(engine), false);
});
unitTest("6.7 re-pushing to an answered detour re-arms it, keeping the earlier verdict readable", () => {
  const engine = owingRepo();
  accepted(engine, verdict(engine, "d", "valid"));
  push(engine, "d"); pop(engine);
  assert.equal(owes(engine), true);
  accepted(engine, verdict(engine, "d", "invalidated"));
  const l = linkOf(engine, "p", "d");
  assert.equal(owes(engine), false);
  assert.equal(l.reconciled.verdict, "invalidated");
  assert.equal(l.superseded.verdict, "valid", "the earlier verdict is still readable");
});
unitTest("6.8 correcting a recorded verdict keeps the one it replaces and sets no obligation", () => {
  const engine = owingRepo();
  accepted(engine, verdict(engine, "d", "valid"));
  accepted(engine, verdict(engine, "d", "invalidated"));
  const l = linkOf(engine, "p", "d");
  assert.equal(l.reconciled.verdict, "invalidated");
  assert.equal(l.superseded.verdict, "valid");
  assert.equal(owes(engine), false);
});
unitTest("6.9a a hand-supplied may-invalidate link is never armed", () => {
  const engine = owingRepo();
  accepted(engine, ["update-epic", "p", "--link", "may-invalidate:x:why"]);
  assert.equal(linkOf(engine, "p", "x").reconcileOnResume, false, "the hand-supplied link carries a false arming record");
  const r = refused(engine, verdict(engine, "x"));
  assert.ok(r.stderr.includes("'d'"), `the refusal names d: ${r.stderr}`);
});

unitTest("6.9b an unmigrated link refuses every verdict naming /pm:upgrade, and render keeps the active epic owing", () => {
  const engine = owingRepo();
  as043(engine);
  const r = refused(engine, verdict(engine, "d"));
  assert.match(r.stderr, /\/pm:upgrade/);
  engine(["render"]);
  assert.equal(owes(engine), true);
});
unitTest("6.9f a verdict against a NEW detour cannot clear an unmigrated obligation", () => {
  const engine = owingRepo();
  as043(engine);
  push(engine, "d2"); pop(engine);
  const r = refused(engine, verdict(engine, "d2"));
  assert.match(r.stderr, /\/pm:upgrade/);
  assert.equal(owes(engine), true);
});

unitTest("6.9e REGRESSION GUARD: a 0.43.0 state file loads and the read-only verbs exit as before", () => {
  const engine = owingRepo();
  as043(engine);
  const before = stateBytes(engine);
  assert.equal(attempt(engine, ["brief"]).status, 0);
  assert.equal(attempt(engine, ["integrity"]).status, 0);
  assert.equal(guard(engine), 2, "the active owing epic still blocks");
  assert.equal(stateBytes(engine), before, "read-only verbs wrote nothing");
});

// ═══════════════ Requirement: A reconcile obligation survives until a verdict answers it ═══════════════

unitTest("7.1 clearing the active pointer does not erase the obligation, and says so", () => {
  const engine = owingRepo();
  const r = accepted(engine, ["clear-active"]);
  assert.ok(namesPD(r.stderr) && /reconcile/.test(r.stderr), `clear-active's stderr names p and d: ${r.stderr}`);
  engine(["render"]);
  assert.equal(owes(engine), true);
});
unitTest("7.2 activating another epic and returning restores the block", () => {
  const engine = owingRepo();
  accepted(engine, ["set-active", "other"]);
  accepted(engine, ["set-active", "p"]);
  assert.equal(owes(engine), true);
  assert.equal(guard(engine), 2);
});
unitTest("7.3 a status change on another epic, or creating one at active, warns and keeps the obligation", () => {
  const engine = owingRepo();
  const r = accepted(engine, ["update-epic", "other", "--status", "active"]);
  assert.ok(namesPD(r.stderr) && /reconcile/.test(r.stderr), `update-epic's stderr names p and d: ${r.stderr}`);
  engine(["render"]);
  assert.equal(owes(engine), true);
  accepted(engine, ["set-active", "p"]);
  const q = accepted(engine, ["add-epic", "--id", "q", "--title", "q", "--lane", "claude-code", "--status", "active"]);
  assert.ok(namesPD(q.stderr) && /reconcile/.test(q.stderr), `add-epic's stderr names p and d: ${q.stderr}`);
  engine(["render"]);
  assert.equal(owes(engine), true);
});
unitTest("7.4 archiving and un-archiving does not erase the obligation", () => {
  const engine = owingRepo();
  accepted(engine, ["update-epic", "p", "--status", "archived", "--outcome", "abandoned", "--reason", "r", "--no-deferrals"]);
  accepted(engine, ["update-epic", "p", "--status", "active"]);
  assert.equal(owes(engine), true);
  assert.equal(guard(engine), 2);
});
unitTest("7.4b REGRESSION GUARD: an archived owing epic does not make gate-guard block", () => {
  const engine = owingRepo();
  accepted(engine, ["update-epic", "p", "--status", "archived", "--outcome", "abandoned", "--reason", "r", "--no-deferrals"]);
  const s = readState(engine);
  s.active = "p";   // the pointer can legitimately name an archived epic for a stretch
  assert.equal(guard(engine), 0);
});
unitTest("7.4a an obligation with no link a verdict could answer is cleared by render, which says so; an armed one is not", () => {
  const engine = repo();
  const s = readState(engine);
  Object.assign(s.epics.find(e => e.id === "p"), { reconcileNeeded: true,
    links: [{ type: "may-invalidate", epic: "d", reason: "hand-added", reconcileOnResume: false }] });
  const r = attempt(engine, ["render"]);
  assert.equal(r.status, 0);
  assert.equal(owes(engine), false, "nothing could ever answer it, so it is cleared");
  assert.ok(r.stderr.includes("'p'"), `the heal names p: ${r.stderr}`);

  const armed = owingRepo();
  accepted(armed, ["clear-active"]);
  armed(["render"]);
  assert.equal(owes(armed), true, "an armed link keeps the obligation through clear-active + render");
});

// ═══════════════ Requirement: A later detour never overwrites an earlier reconcile obligation ═══════════════

unitTest("8.1 a no-reconcile push keeps the pending obligation and does not say none is owed", () => {
  const engine = owingRepo();
  const r = push(engine, "d2", false);
  assert.equal(owes(engine), true);
  assert.doesNotMatch(r.stdout + r.stderr, /NO reconcile on resume/);
});
unitTest("8.2 the pop does not claim a reconcile nobody recorded", () => {
  const engine = owingRepo();
  push(engine, "d2", false);
  const before = honchoLog(engine);
  const r = pop(engine);
  assert.doesNotMatch(r.stdout, /no reconcile was required/);
  assert.doesNotMatch(honchoLog(engine).slice(before.length), /resumed p/, "no POP line is logged for p");
  assert.ok(r.stderr.includes("'d'"), `stderr names d as owed: ${r.stderr}`);
  assert.equal(guard(engine), 2);
});
unitTest("8.2a a no-reconcile push to the same armed detour never lowers its arming", () => {
  const engine = owingRepo();
  push(engine, "d", false); pop(engine);
  engine(["render"]);
  assert.equal(owes(engine), true);
  accepted(engine, verdict(engine, "d"));
});
unitTest("8.3 REGRESSION GUARD: a pop that owes nothing still emits and logs its memory line", () => {
  const engine = repo();
  push(engine, "d", false);
  const r = pop(engine);
  assert.match(r.stdout, /resumed p, reconciled vs d; no reconcile was required/);
  assert.match(honchoLog(engine), /resumed p, reconciled vs d; no reconcile was required/);
});

// ═══════════════ Requirement: A write never destroys the record of an owed reconcile ═══════════════
unitTest("9.1 clearing links on an owing epic is refused naming record-reconcile", () => {
  const engine = owingRepo();
  const r = refused(engine, ["update-epic", "p", "--clear-links"]);
  assert.match(r.stderr, /record-reconcile/);
});
unitTest("9.2 removing an armed detour is refused naming record-reconcile, not a detour pop", () => {
  const engine = owingRepo();
  const r = refused(engine, ["remove-epic", "d"]);
  assert.match(r.stderr, /record-reconcile/);
  assert.doesNotMatch(r.stderr, /Resume or pop the detour/);
  assert.equal(owes(engine), true);
  assert.ok(linkOf(engine, "p", "d"), "the link to d is still there");
});
unitTest("9.3 correcting a link's reason keeps its verdict and arming", () => {
  const engine = owingRepo();
  accepted(engine, verdict(engine, "d"));
  accepted(engine, ["update-epic", "p", "--link", "may-invalidate:d:corrected reason"]);
  const l = linkOf(engine, "p", "d");
  assert.equal(l.reason, "corrected reason");
  assert.equal(l.reconciled.verdict, "valid");
  assert.equal(l.reconcileOnResume, true);
  assert.equal(owes(engine), false);
});
unitTest("9.3a an answered armed link is protected while another obligation stands", () => {
  const engine = repo();
  push(engine, "d"); pop(engine);
  push(engine, "d2"); pop(engine);
  accepted(engine, verdict(engine, "d"));
  refused(engine, ["update-epic", "p", "--clear-links"]);
  refused(engine, ["remove-epic", "d"]);
});
unitTest("9.3b on an owing epic the repair instructions name record-reconcile first, and the repair is refused", () => {
  const engine = owingRepo();
  const s = readState(engine);
  s.epics.find(e => e.id === "p").links.push({ type: "depends_on", epic: "x" });
  const integ = attempt(engine, ["integrity"]).stdout;
  const finding = integ.split("\n").find(l => l.includes("depends_on")) || "";
  assert.ok(finding.includes("record-reconcile"), `the finding names record-reconcile: ${finding}`);
  assert.ok(finding.indexOf("record-reconcile") < finding.indexOf("--clear-links"), "record-reconcile comes before the repair");
  const w = refused(engine, ["update-epic", "p", "--link", "depends_on:x"]);
  assert.ok(w.stderr.includes("record-reconcile") && w.stderr.indexOf("record-reconcile") < w.stderr.lastIndexOf("--clear-links"),
    `the write-time repair message names record-reconcile first: ${w.stderr}`);
  refused(engine, ["update-epic", "p", "--clear-links", "--link", "may-invalidate:d:kept"]);
});

// ═══════════════ Amendments ═══════════════
unitTest("10.1 --amendments none (any case) records no amendments", () => {
  for (const spelling of ["none", "None"]) {
    const engine = owingRepo();
    accepted(engine, verdict(engine, "d", "valid", ["--amendments", spelling]));
    assert.deepEqual(linkOf(engine, "p", "d").reconciled.amendments, []);
  }
});
unitTest("10.2 a repeated --amendment keeps each amendment whole, in order", () => {
  const engine = owingRepo();
  accepted(engine, verdict(engine, "d", "valid", ["--amendment", "rename x; keep y", "--amendment", "drop z"]));
  assert.deepEqual(linkOf(engine, "p", "d").reconciled.amendments, ["rename x; keep y", "drop z"]);
});
unitTest("10.3 --amendment and --amendments together are refused as a combination, not as an unknown flag", () => {
  const engine = owingRepo();
  const r = refused(engine, verdict(engine, "d", "valid", ["--amendment", "a", "--amendments", "b"]));
  assert.doesNotMatch(r.stderr, /unknown flag/);
  assert.match(r.stderr, /cannot be combined/);
});

// ═══════════════ Gate 2 follow-up (minors) ═══════════════
unitTest("g2-m1 the heal never clears an obligation while ANY frame still pauses the epic", () => {
  const engine = repo();
  push(engine, "d", false);                       // a --no-reconcile frame for p stays on the stack
  const s = readState(engine);
  s.epics.find(e => e.id === "p").reconcileNeeded = true;   // owed, with no armed link
  const r = attempt(engine, ["render"]);
  assert.equal(r.status, 0);
  assert.equal(owes(engine), true, "a live frame still pauses p, so the heal's 'no detour frame' claim would be false");
  assert.doesNotMatch(r.stderr, /cleared the reconcile obligation/);
});
unitTest("g2-m2 an unmigrated epic names /pm:upgrade even when --detour names no epic", () => {
  const engine = owingRepo();
  as043(engine);
  const r = refused(engine, verdict(engine, "ghost"));
  assert.match(r.stderr, /\/pm:upgrade/);
});
unitTest("g2-m3a integrity words an owed-reconcile link to a hand-removed detour as removed, with the add-epic recovery", () => {
  const engine = owingRepo();
  const s = readState(engine);
  s.epics = s.epics.filter(e => e.id !== "d");
  const line = attempt(engine, ["integrity"]).stdout.split("\n").find(l => l.includes("names `d`")) || "";
  assert.ok(line, "the dangling reference to d is reported");
  assert.doesNotMatch(line, /record-reconcile` answers it/, "record-reconcile refuses a detour that does not exist");
  assert.match(line, /add-epic --id d\b/, `the finding names the recovery: ${line}`);
});

// ═══════════════ Gate 2 follow-up: tests that kill the surviving mutants ═══════════════

const LINKS = new URL("../../lib/links.mjs", import.meta.url).href;
unitTest("g2-M01 a keyless may-invalidate link is never armed, and owes nothing", async () => {
  const { isArmed, ownedDetours } = await import(LINKS);
  const keyless = { type: "may-invalidate", epic: "d", reason: "written by 0.43.0" };
  assert.equal(isArmed(keyless), false);
  assert.deepEqual(ownedDetours({ id: "p", reconcileNeeded: true, links: [keyless] }), []);
});
unitTest("g2-M15 before upgrade, --clear-links on an owing epic holding a keyless link is refused", () => {
  const engine = owingRepo();
  as043(engine);
  const r = refused(engine, ["update-epic", "p", "--clear-links"]);
  assert.match(r.stderr, /record-reconcile/);
});
unitTest("g2-M15b the upgrade stamp never arms a link to a missing epic or to the epic itself", async () => {
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
unitTest("g2-M07 the heal counts an ANSWERED armed link as armed, and keeps the obligation", () => {
  const engine = owingRepo();
  accepted(engine, verdict(engine, "d"));
  const s = readState(engine);
  s.epics.find(e => e.id === "p").reconcileNeeded = true;   // owing, holding only an answered armed link
  const r = attempt(engine, ["render"]);
  assert.equal(r.status, 0);
  assert.equal(owes(engine), true, "an answered armed link is still a link a verdict can be recorded against");
});
unitTest("g2-M19 re-arming with --reconcile moves the link's old verdict to superseded and leaves it unanswered", () => {
  const engine = owingRepo();
  accepted(engine, verdict(engine, "d", "valid"));
  push(engine, "d"); pop(engine);
  const l = linkOf(engine, "p", "d");
  assert.equal(l.reconciled, undefined, "the re-armed link reads unanswered");
  assert.equal(l.superseded && l.superseded.verdict, "valid", "the earlier verdict moved to superseded");
  assert.equal(l.reconcileOnResume, true);
});
unitTest("g2-M23c a correction on an epic whose flag is already false does not raise it", () => {
  const engine = repo();
  const s = readState(engine);
  Object.assign(s.epics.find(e => e.id === "p"), { reconcileNeeded: false, links: [
    { type: "may-invalidate", epic: "d", reason: "r", reconcileOnResume: true,
      reconciled: { verdict: "valid", amendments: [], reconciledAt: "2026-09-01T00:00:00.000Z" } },
    { type: "may-invalidate", epic: "d2", reason: "r", reconcileOnResume: true },
  ] });
  accepted(engine, verdict(engine, "d", "invalidated"));
  assert.equal(owes(engine), false, "a correction never raises the flag");
});
unitTest("g2-M29 pop-detour warns when the pointer leaves a detour that itself owes a reconcile", () => {
  const engine = repo();
  push(engine, "d");                               // p paused for d; d active
  push(engine, "d2", true, "d");                   // d paused for d2; d2 active
  pop(engine, "d");                                // d resumes and owes d2
  const r = pop(engine, "p");                      // the pointer moves off d
  assert.ok(r.stderr.includes("'d' is no longer the active epic") && r.stderr.includes("'d2'"),
    `pop-detour names the owing detour and what it owes: ${r.stderr}`);
});
unitTest("g2-M26e set-active warns about the owing epic it moves off", () => {
  const engine = owingRepo();
  const r = accepted(engine, ["set-active", "other"]);
  assert.ok(r.stderr.includes("'p'") && r.stderr.includes("'d'") && /still owes a reconcile/.test(r.stderr),
    `set-active's stderr names p and d: ${r.stderr}`);
});
unitTest("g2-4 pop-detour reads the obligation AFTER the heal: no record-reconcile instruction when the saved flag is false", () => {
  const engine = repo();
  push(engine, "d", false);                                     // a --no-reconcile frame
  const s = readState(engine);
  s.epics.find(e => e.id === "p").reconcileNeeded = true;    // hand-edit: owed, with nothing armed
  const r = pop(engine);
  assert.equal(owes(engine), false, "precondition: the heal cleared the unanswerable obligation");
  assert.doesNotMatch(r.stderr, /RECONCILE GATE|record-reconcile p --detour/,
    `the pop must not instruct a verdict the engine would refuse: ${r.stderr}`);
});