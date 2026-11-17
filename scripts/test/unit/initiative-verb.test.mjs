// release-planning-taxonomy 2.1 (spec initiative-record): the `initiative` verb. UNIT rung. A SUCCESSFUL `initiative` write may
// refresh CLAUDE.md's managed block, which the unit rung's counter refuses, so this file drives the PURE `applyInitiative()` for
// every rule, the verb for every REFUSAL and for the read form, and `board --json` for the read-back.

import assert from "node:assert/strict";
import { expectFail, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";
import { applyInitiative, initiativeShowLines } from "../../lib/initiative.mjs";
import { VERB_EFFECTS } from "../../lib/verb-effects.mjs";
import { EPIC_FLAGS, VERB_FLAGS } from "../../lib/constants.mjs";

const T = (n) => `2026-11-0${n}T00:00:00Z`;
const record = (over = {}) => ({ version: 1, revision: 1, active: null, detourStack: [], epics: [], ...over });
const board = (state) => JSON.parse(memoryEngine(state)(["board", "--json"]));
const apply = (state, id, f, now = T(1)) => applyInitiative(state, id, f, now);
const ok = (state, id, f, now) => { const r = apply(state, id, f, now); assert.equal(r.ok, true, r.message); return r; };
const refusedWith = (state, id, f, re) => {
  const before = JSON.stringify(state);
  const r = apply(state, id, f);
  assert.equal(r.ok, false, `expected a refusal for ${JSON.stringify(f)}`);
  assert.match(r.message, re);
  assert.match(r.message, /Nothing was written/);
  assert.equal(JSON.stringify(state), before, "a refusal leaves the record untouched");
};
const seeded = () => { const s = record(); ok(s, "boards", { title: "Live boards", capability: "See the plan" }); return s; };

unitTest("create: needs --title and --capability; amend replaces either; the record reads back through board --json", () => {
  const s = record();
  refusedWith(s, "boards", { title: "Live boards" }, /--capability/);
  refusedWith(s, "boards", { capability: "x" }, /--title/);
  const r = ok(s, "boards", { title: "Live boards", capability: "See the plan" }, T(1));
  assert.equal(r.created, true);
  assert.deepEqual(board(s).initiatives.map(i => [i.id, i.title, i.capability, i.status, i.outcome]), [["boards", "Live boards", "See the plan", "open", null]]);
  ok(s, "boards", { title: "Boards live", capability: "Everything visible" }, T(2));
  assert.deepEqual(board(s).initiatives.map(i => [i.title, i.capability]), [["Boards live", "Everything visible"]]);
  assert.equal(s.initiatives.length, 1, "an amendment is not a second initiative");
  assert.equal(apply(s, "boards", { title: "Boards live" }, T(3)).changed, false);
});

unitTest("create: one line within the limit, the escaped echo, reserved show and a malformed id", () => {
  refusedWith(record(), "boards", { title: "a\nb", capability: "c" }, /one line of at most 200 characters/);
  refusedWith(record(), "boards", { title: "t", capability: "c".repeat(401) }, /one line of at most 400 characters/);
  assert.equal(apply(record(), "boards", { title: "t".repeat(200), capability: "c".repeat(400) }).ok, true);
  const r = apply(record(), "boards", { title: "bad\u001b[31mred\nx", capability: "c" });
  assert.equal(r.ok, false);
  assert.ok(!/\u001b/.test(r.message), "a control character in the echoed value is escaped");
  refusedWith(record(), "show", { title: "x", capability: "y" }, /show.*reserved/);
  refusedWith(record(), "Bad Id", { title: "x", capability: "y" }, /must match/);
});

unitTest("source and off-mission reason: one line of at most 300, UNGROUNDED accepted, each cleared by --clear", () => {
  const s = seeded();
  ok(s, "boards", { source: "UNGROUNDED" });
  assert.equal(board(s).initiatives[0].source, "UNGROUNDED");
  ok(s, "boards", { clear: ["source"] });
  assert.equal(board(s).initiatives[0].source, null);
  ok(s, "boards", { "off-mission-reason": "supports the mission indirectly" });
  assert.equal(board(s).initiatives[0].offMissionReason, "supports the mission indirectly");
  ok(s, "boards", { clear: ["off-mission-reason"] });
  assert.equal(board(s).initiatives[0].offMissionReason, null);
  refusedWith(s, "boards", { source: "x".repeat(301) }, /300/);
  refusedWith(s, "boards", { "off-mission-reason": "a\nb" }, /one line/);
});

unitTest("--clear refuses any field but source and off-mission-reason, and a set beside its own clear", () => {
  const s = seeded();
  refusedWith(s, "boards", { clear: ["title"] }, /source and off-mission-reason/);
  refusedWith(s, "boards", { clear: ["source"], source: "x" }, /contradicts/);
  const noop = apply(s, "boards", { clear: ["source"] });
  assert.equal(noop.changed, false);
  assert.match(noop.notes.join(" "), /nothing to clear/);
});

unitTest("end then reopen: both events kept, the status and outcome follow, and the wrong state is refused", () => {
  const s = seeded();
  refusedWith(s, "boards", { end: true, reason: "x" }, /--outcome/);
  refusedWith(s, "boards", { end: true, outcome: "killed", reason: "x" }, /delivered\|abandoned\|superseded/);
  refusedWith(s, "boards", { end: true, outcome: "delivered" }, /--reason/);
  refusedWith(s, "boards", { end: true, outcome: "delivered", reason: " " }, /--reason|one line/);
  refusedWith(s, "boards", { reopen: true, reason: "x" }, /not ended/);
  ok(s, "boards", { end: true, outcome: "superseded", reason: "folded into reporting" }, T(2));
  assert.deepEqual(board(s).initiatives.map(i => [i.status, i.outcome, i.endedAt]), [["ended", "superseded", T(2)]]);
  refusedWith(s, "boards", { end: true, outcome: "delivered", reason: "again" }, /already ended/);
  ok(s, "boards", { reopen: true, reason: "split back out" }, T(3));
  assert.deepEqual(board(s).initiatives.map(i => [i.status, i.outcome, i.endedAt]), [["open", null, null]]);
  const shown = initiativeShowLines(s, "boards", { history: true }).lines.join("\n");
  assert.match(shown, /ended \(superseded\): folded into reporting/);
  assert.match(shown, /reopened: split back out/);
});

unitTest("--reason serves only --end and --reopen: alone or beside another flag it is refused, and a lifecycle call stands alone", () => {
  const s = seeded();
  refusedWith(s, "boards", { reason: "x" }, /serves only/);
  refusedWith(s, "boards", { title: "t", reason: "x" }, /serves only/);
  refusedWith(s, "boards", { end: true, reopen: true, outcome: "delivered", reason: "x" }, /contradict/);
  refusedWith(s, "boards", { end: true, outcome: "delivered", reason: "x", title: "t" }, /its own record/);
  refusedWith(s, "ghost", { end: true, outcome: "delivered", reason: "x" }, /does not exist/);
});

unitTest("ending keeps every reference: an epic and a release still name the ended initiative", () => {
  const s = record({ epics: [{ id: "e", title: "E", priority: "P2", status: "queued", role: "epic", lane: "claude-code", links: [], initiative: "boards" }],
    releases: [{ id: "r1", intent: "i", deferred: [], initiative: "boards" }] });
  ok(s, "boards", { title: "Live boards", capability: "c" });
  ok(s, "boards", { end: true, outcome: "delivered", reason: "done" });
  const b = board(s);
  assert.equal(b.epics[0].initiative, "boards");
  assert.equal(b.releases[0].initiative, "boards");
  assert.deepEqual(b.initiatives.map(i => [i.status, i.outcome]), [["ended", "delivered"]]);
});

unitTest("no verb deletes an initiative: no registered initiative flag is a delete or a bare remove", () => {
  const flags = [...EPIC_FLAGS, ...VERB_FLAGS].filter(r => r.commands.includes("initiative")).map(r => r.flag);
  assert.ok(flags.length > 8, "the initiative verb declares its flags");
  assert.deepEqual(flags.filter(f => /^(delete|remove|drop|purge)$/.test(f)), []);
  assert.deepEqual(flags.filter(f => f === "remove-initiative"), []);
});

unitTest("show: lists, reads one back, --history, `no initiatives`, and writes nothing", () => {
  const s = seeded();
  ok(s, "boards", { "add-milestone": "Live in every repo" });
  const engine = memoryEngine(s);
  const before = JSON.stringify(engine.store.record());
  assert.match(engine(["initiative", "show"]), /^boards — open — Live boards \(1 active initiative milestone, 0 epics as primary\)/);
  const one = engine(["initiative", "show", "boards"]);
  assert.match(one, /capability: See the plan/);
  assert.match(one, /m1 — Live in every repo/);
  assert.match(engine(["initiative", "show", "boards", "--history"]), /history:/);
  assert.equal(JSON.stringify(engine.store.record()), before, "show writes nothing");
  assert.match(memoryEngine(record())(["initiative", "show"]), /^no initiatives\n$/);
  const missing = expectFail(() => memoryEngine(record())(["initiative", "show", "nope"]));
  assert.match(missing.stderr, /nope/);
  assert.notEqual(missing.status, 0);
});

unitTest("the verb refuses on the command line: no id, an unknown flag, --history outside show, a reserved id", () => {
  const e = memoryEngine(seeded());
  assert.match(expectFail(() => e(["initiative", "--title", "x"])).stderr, /requires an initiative id|--title/);
  assert.match(expectFail(() => e(["initiative", "boards", "--zzz"])).stderr, /unknown flag/);
  assert.match(expectFail(() => e(["initiative", "boards", "--history"])).stderr, /initiative show --history/);
  assert.match(expectFail(() => e(["initiative", "boards"])).stderr, /needs an operation/);
  assert.match(expectFail(() => e(["initiative", "boards", "--title"])).stderr, /--title requires/);
  assert.match(expectFail(() => e(["initiative", "show", "--title", "x"])).stderr, /READ form/);
});

unitTest("VERB_EFFECTS declares initiative as mutating and the registry carries no delete spelling", () => {
  assert.equal(VERB_EFFECTS.initiative.effect, "mutates");
  assert.match(VERB_EFFECTS.initiative.writes, /initiatives/);
});
