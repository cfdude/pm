// scripts/test/unit/epic-session-trail.test.mjs
// epic-session-attribution, tasks 1.1-1.3 and 2.1 — `--session` on every epic-writing verb, and the
// `epic.sessions` trail the SAME save writes. UNIT rung: every observable is a value over the in-memory
// record, a refusal, or the record file's bytes as the memory store serialises them.

import assert from "node:assert/strict";
import { emptyRecord, expectFail, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";
import { EPIC_FLAGS, flagsFor, settableEpicFlags } from "../../lib/constants.mjs";
import { VERB_EFFECTS } from "../../lib/verb-effects.mjs";
import { checkSession, SESSION_MAX_LENGTH } from "../../lib/session-identity.mjs";

const epic = (id, extra = {}) => ({ id, title: id, priority: "P2", status: "queued", role: "epic", lane: "claude-code", links: [], reconcileNeeded: false, ...extra });
const seeded = (epics = [epic("e1")], state = {}) => memoryEngine({ ...emptyRecord(), epics, ...state });
const rec = (engine) => engine.store.record();
const e1 = (engine, id = "e1") => rec(engine).epics.find((e) => e.id === id);
const bytes = (engine) => engine.store.read("state.json").text;
const as = (session) => ({ env: { PM_SESSION: session } });

// ───────────── 1.1 / 1.3 the flag, declared once, on every epic-writing verb ─────────────

unitTest("1.3 the epic-writing verbs are DERIVED from the effects registry, and each accepts --session", () => {
  const derived = Object.entries(VERB_EFFECTS).filter(([, v]) => v.epicWriting === true).map(([k]) => k);
  assert.ok(derived.length >= 10, "the marker is in use");
  assert.deepEqual([...EPIC_FLAGS.find((f) => f.flag === "session").commands].sort(), [...derived].sort(), "the flag row is the marker's projection");
  for (const verb of derived) {
    assert.equal(VERB_EFFECTS[verb].effect, "mutates", `${verb} writes`);
    assert.notEqual(VERB_EFFECTS[verb].hook, true, `${verb} is not a hook verb`);
    assert.ok(flagsFor(verb).includes("session"), `${verb} accepts --session`);
  }
  for (const verb of ["claim", "unclaim"]) assert.ok(derived.includes(verb));
});

// Every non-hook verb that mutates is EITHER epicWriting (declares --session) OR named here with the reason
// its save never changes an epic. The partition is total and does not read the wording of `writes`: a verb
// added to the registry fails this test until someone classifies it, which is the call-site sweep made
// mechanical (R.1). `init` is NOT here: its sync(true) registers epics, so it declares --session.
const NO_EPIC_CHANGE = {
  render: "writes PROJECT.md and the render stamp; its only state save is the archived-epic self-heal a hook also runs",
  "log-detour": "append-only detours.log", "retract-detour": "detours.log and PROJECT.md", "honcho-memory": "append-only memories log",
  "set-tracker": "tracker config and the rules block", "set-lane-routing": "lane-routing overrides",
  "set-review-mode": "the review-mode dial", "set-profile": "project or lane profile layer",
  "set-gate-guard": "the gate-guard toggle", "record-cross-spec-review": "a release-scope verdict",
  "set-activity-log": "the activityLog switch", "dev-log": "the dev log under .conductor/spend/",
  "set-dev-log": "the devLog switch", "set-spend-tracking": "the spendTracking switch and rules block",
  spend: "the spend ledger", "spend-analysis": "reads the ledger", decisions: "reads the ledger",
  "spend-guard": "reads limits and the ledger", "purge-logs": "log files", "write-rules": "the rules block",
};

unitTest("1.3 every mutating non-hook verb is epicWriting or named with why it never changes an epic (no wording heuristic)", () => {
  const unclassified = [];
  for (const [verb, v] of Object.entries(VERB_EFFECTS)) {
    if (v.effect !== "mutates" || v.hook === true) continue;
    const exempt = verb in NO_EPIC_CHANGE;
    if (v.epicWriting === true && exempt) assert.fail(`${verb} is epicWriting and also listed as changing no epic`);
    if (v.epicWriting !== true && !exempt) unclassified.push(verb);
  }
  assert.deepEqual(unclassified, [], "each of these can change an epic (or must be named in NO_EPIC_CHANGE with a reason)");
  for (const verb of Object.keys(NO_EPIC_CHANGE)) assert.ok(VERB_EFFECTS[verb], `${verb} is a registered verb`);
  for (const verb of ["init", "clear-active"]) assert.equal(VERB_EFFECTS[verb].epicWriting, true, `${verb} changes an epic`);
});

unitTest("1.3 clear-active and init accept --session and stamp it on the epic they changed", () => {
  const engine = seeded([epic("e1", { status: "active" })], { active: "e1" });
  engine(["clear-active", "--session", "build-a"]);
  assert.equal(e1(engine).status, "queued");
  assert.deepEqual(e1(engine).sessions.map((s) => s.session), ["build-a"]);
});

unitTest("1.3 no hook verb declares --session, and epic.sessions is declared set-only with its reason", () => {
  for (const [verb, v] of Object.entries(VERB_EFFECTS)) if (v.hook === true) assert.equal(flagsFor(verb).includes("session"), false, verb);
  const row = EPIC_FLAGS.find((f) => f.key === "sessions");
  assert.ok(row && row.engineWritten === true, "an engine-written row");
  assert.match(row.setOnly, /APPEND-ONLY/);
  assert.equal(settableEpicFlags("update-epic").some((f) => f.flag === "sessions"), false, "not typeable");
  const err = expectFail(() => seeded()(["update-epic", "e1", "--clear", "sessions"]));
  assert.match(String(err.stderr), /sessions/);
});

unitTest("1.1 update-epic accepts --session and records the note; the flag wins over the environment", () => {
  const engine = seeded();
  engine(["update-epic", "e1", "--notes", "x", "--session", "flag-b"], as("env-a"));
  assert.equal(e1(engine).notes.at(-1).text, "x");
  assert.deepEqual(e1(engine).sessions.map((s) => s.session), ["flag-b"]);
});

// ───────────── 1.2 validation, before any write ─────────────

unitTest("1.2 checkSession: blank, control character and over-long are refused naming the rule; a plain name passes trimmed", () => {
  assert.match(checkSession("   ").message, /requires a session name — a blank one is refused/);
  assert.match(checkSession("bad\u001b[31m").message, /control character/);
  assert.match(checkSession("x".repeat(SESSION_MAX_LENGTH + 1)).message, /at most 128 characters/);
  assert.deepEqual(checkSession("  build-a  "), { ok: true, value: "build-a" });
  assert.equal(checkSession("x".repeat(SESSION_MAX_LENGTH)).ok, true);
});

unitTest("1.2 a blank --session, a control character in PM_SESSION and an over-long one are refused with nothing written", () => {
  const engine = seeded();
  const before = bytes(engine);
  for (const [args, opts, rule] of [
    [["--session", "   "], undefined, /--session requires a session name/],
    [[], as("bad\u001b"), /PM_SESSION must not contain a control character/],
    [["--session", "y".repeat(129)], undefined, /at most 128 characters/],
  ]) {
    const err = expectFail(() => engine(["update-epic", "e1", "--notes", "x", ...args], opts));
    assert.ok(err.status !== 0);
    assert.match(String(err.stderr), rule);
    assert.equal(bytes(engine), before, "nothing was written");
  }
});

unitTest("1.2 the same validation binds claim (same resolver): a control character is refused", () => {
  const engine = seeded();
  const before = bytes(engine);
  const err = expectFail(() => engine(["claim", "e1"], as("bad\u001b")));
  assert.match(String(err.stderr), /control character/);
  assert.equal(bytes(engine), before);
});

unitTest("1.2 a hook never refuses on the identity, never stamps it, and prints no identity text", () => {
  const engine = seeded();
  for (const hook of [["brief"], ["snapshot"], ["commit-nudge"]]) {
    const r = engine.result(hook, as("bad\u001b[31mevil"));
    assert.equal(r.status, 0, `${hook[0]}: ${r.stderr}`);
    assert.equal((r.stdout + r.stderr).includes("evil"), false, `${hook[0]} output carries no identity text`);
  }
  assert.equal("sessions" in e1(engine), false);
});

// ───────────── 2.1 the trail ─────────────

unitTest("2.1 a first write appends an entry; a later write by the same session moves only lastAt; a second session follows", () => {
  const engine = seeded();
  engine(["update-epic", "e1", "--notes", "one"], as("build-a"));
  const [first] = e1(engine).sessions;
  assert.deepEqual(Object.keys(first).sort(), ["firstAt", "lastAt", "session"]);
  assert.equal(first.session, "build-a");
  assert.equal(first.firstAt, first.lastAt, "written in the same save as the note");
  assert.equal(e1(engine).notes.at(-1).text, "one");

  engine(["update-epic", "e1", "--notes", "two"], as("build-a"));
  const again = e1(engine).sessions;
  assert.equal(again.length, 1, "one entry per identity");
  assert.equal(again[0].firstAt, first.firstAt, "firstAt never moves");
  assert.ok(again[0].lastAt >= first.lastAt);

  engine(["update-epic", "e1", "--notes", "three"], as("build-b"));
  assert.deepEqual(e1(engine).sessions.map((s) => s.session), ["build-a", "build-b"]);
});

unitTest("2.1 no identity writes no trail", () => {
  const engine = seeded();
  engine(["update-epic", "e1", "--notes", "x"]);
  assert.equal("sessions" in e1(engine), false);
});

unitTest("2.1 a no-op write records nothing and leaves the record byte-identical", () => {
  const engine = seeded();
  const before = bytes(engine);
  const out = engine.combined(["update-epic", "e1", "--priority", "P2", "--session", "build-a"]);
  assert.match(out, /unchanged|nothing changed|no change/i);
  assert.equal(bytes(engine), before);
});

unitTest("2.1 every epic the save changed is stamped, a side-effect change included", () => {
  const engine = seeded([epic("e1", { status: "active" }), epic("e2"), epic("e3")], { active: "e1" });
  const touched = () => Object.fromEntries(rec(engine).epics.map((e) => [e.id, JSON.stringify([e.status, e.touchedAt])]));
  const before = touched();
  engine(["set-active", "e2", "--session", "build-a"]);
  const after = touched();
  const changed = Object.keys(after).filter((id) => after[id] !== before[id]);
  assert.ok(changed.includes("e2"), "the newly active epic changed");
  for (const id of changed) assert.deepEqual(e1(engine, id).sessions.map((s) => s.session), ["build-a"], id);
  for (const id of Object.keys(after).filter((id) => !changed.includes(id))) assert.equal("sessions" in e1(engine, id), false, `${id} was not changed`);
});

unitTest("2.1 an older record loads with no sessions and is not rewritten by a read", () => {
  const engine = seeded([epic("e1"), epic("e2")]);
  const before = bytes(engine);
  engine(["list"], as("build-a"));
  engine(["integrity"], as("build-a"));
  assert.equal(bytes(engine), before);
  assert.equal(rec(engine).epics.some((e) => "sessions" in e), false);
});

unitTest("2.1 a trail already on the record survives a later write by a different identity untouched", () => {
  const prior = [{ session: "old", firstAt: "2026-01-01T00:00:00.000Z", lastAt: "2026-01-02T00:00:00.000Z" }];
  const engine = seeded([epic("e1", { sessions: prior })]);
  engine(["update-epic", "e1", "--notes", "x"], as("new"));
  assert.deepEqual(e1(engine).sessions[0], prior[0]);
  assert.equal(e1(engine).sessions[1].session, "new");
});
