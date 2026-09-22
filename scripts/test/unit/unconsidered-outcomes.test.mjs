// scripts/test/unit/unconsidered-outcomes.test.mjs
// 4.1's migration of `assert/unconsidered-outcomes.test.mjs` — 15 of its 16 tests, moved from the
// file rung to the unit rung with every assertion unchanged.
//
// The unconsidered-outcome walker, and the `unreconstructable` outcome it exists to make
// recordable.
//
// THE PREDICATE IS TWO HALVES AND BOTH ARE LOAD-BEARING: an ENGINE-WRITTEN stamp whose outcome
// value is `unknown`. An engine stamp alone is not enough — a stamp can be evidence-derived, and
// this repository holds three epics stamped `delivered` by migration from a passing Gate 2
// verdict, which an agent must not be asked to re-derive. An `unknown` value alone is not enough
// either: `outcomeOf()` answers `"unknown"` for an epic carrying NO disposition, and an absent
// disposition is deliberately outside the population — `gate-integrity` establishes that absence
// is not a state an archived epic reaches, and live data agrees at zero.
//
// The walker never asserts a live count.
//
// ─────────────── WHAT MOVED, AND WHAT DID NOT ───────────────
//
// FIFTEEN moved: the whole 4.1 predicate family, the two 4.2 invocation tests, the 4.3 triple and the
// `unreconstructable` write path, 4.6's both-direction invariant, and the 5.10 verb family (the
// dispatch, the round trip through the printed invocation, and the read-only proof, whose byte
// comparison is `store.read("state.json").text`).
//
// ONE STAYS: 4.4's second half, and its fixture is why — it writes 47 unticked-task PLAN FILES under
// `docs/superpowers/plans/`, which is what `epicProgress()` reads to reach the zero-ticked finding
// the test is about. The assertion is not about the file, but the file is what produces the number.

import assert from "node:assert/strict";
import { emptyRecord, expectFail, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";
import { AGENT_OUTCOMES, unconsideredOutcomes } from "../../lib/archive-gate.mjs";
import {
  KNOWN_OUTCOMES, agentDisposition, engineStamp, isEngineStamped, outcomeOf,
} from "../../lib/disposition.mjs";

const AT = "2026-08-01T00:00:00.000Z";
const readState = (engine) => engine.store.record();
const stateBytes = (engine) => engine.store.read("state.json").text;

const epic = (id, over = {}) => ({
  id, title: id, priority: "P2", status: "archived", role: "epic", lane: "claude-code",
  stories: [], links: [], ...over,
});

const ids = (epics) => unconsideredOutcomes(epics).map(r => r.epic.id).sort();

// ───────────────── 4.1: the predicate — engine-stamped AND `outcome: unknown` ─────────────────

unitTest("4.1: an engine stamp carrying `unknown` is the population", () => {
  assert.deepEqual(ids([
    epic("nobody-was-asked", { disposition: engineStamp("migration", { recordedAt: AT }) }),
    epic("healed", { disposition: engineStamp("archive-drift-heal", { recordedAt: AT }) }),
  ]), ["healed", "nobody-was-asked"]);
});

unitTest("4.1: an EVIDENCE-DERIVED engine stamp is excluded — `delivered` written by migration", () => {
  // The three epics this repository holds in exactly this shape: a migration derived `delivered`
  // from a passing Gate 2 verdict. Handing them to an agent to re-dispose would ask it to
  // re-derive what the record already derived correctly.
  assert.deepEqual(ids([
    epic("derived-from-a-passing-gate-2",
      { disposition: engineStamp("migration", { outcome: "delivered", recordedAt: AT }) }),
  ]), []);
});

unitTest("4.1: an AGENT-recorded outcome is excluded, whatever it is", () => {
  const epics = AGENT_OUTCOMES.map(o => epic(`agent-said-${o}`, {
    disposition: agentDisposition({ outcome: o, reason: "because", recordedAt: AT }),
  }));
  assert.deepEqual(ids(epics), [], "an agent's judgment is a considered outcome by definition");
});

unitTest("4.1: an ABSENT disposition is NOT the population, even though it reads `unknown`", () => {
  // `outcomeOf()` answers "unknown" for an epic with no disposition at all, so a predicate
  // written on the value alone would sweep in a state no archive path produces.
  const bare = epic("no-disposition-at-all");
  assert.equal(outcomeOf(bare), "unknown", "precondition: the READER says unknown");
  assert.equal(isEngineStamped(bare.disposition), false, "precondition: nothing stamped it");
  assert.deepEqual(ids([bare]), []);
});

unitTest("4.1: an unregistered `recordedBy` token is not an engine stamp", () => {
  // isEngineStamped() is THE discriminator: a token some later path invented without registering
  // it is not a stamp, and reading `.recordedBy` directly is how a second definition starts.
  assert.deepEqual(ids([
    epic("invented-token", { disposition: { outcome: "unknown", recordedAt: AT, recordedBy: "agent" } }),
  ]), []);
});

unitTest("4.1: an epic that has not been archived is outside the population", () => {
  assert.deepEqual(ids([
    epic("still-running", { status: "active", disposition: engineStamp("migration", { recordedAt: AT }) }),
  ]), [], "the requirement scopes to ARCHIVED epics — the archive is what is being asked about");
});

// ───────────────── 4.2: every returned epic carries the invocation that records one ────────────

unitTest("4.2: each returned epic carries a runnable invocation naming the epic and the vocabulary", () => {
  const [row] = unconsideredOutcomes([
    epic("nobody-was-asked", { disposition: engineStamp("migration", { recordedAt: AT }) }),
  ]);
  assert.ok(row, "the walker returned nothing to carry an invocation");
  assert.equal(row.epic.id, "nobody-was-asked");
  assert.match(row.invocation, /^update-epic nobody-was-asked --status archived --outcome /);
  assert.match(row.invocation, /--reason "<why>" --no-deferrals$/,
    "the archive gate refuses either half alone, so the remedy must carry both in one invocation");
});

unitTest("4.2: the invocation QUOTES the engine's vocabulary rather than a literal", () => {
  const [row] = unconsideredOutcomes([
    epic("nobody-was-asked", { disposition: engineStamp("migration", { recordedAt: AT }) }),
  ]);
  for (const o of AGENT_OUTCOMES) {
    assert.ok(row.invocation.includes(o),
      `the remedy omits '${o}' — a remedy naming a set the archive verb has outgrown is the ` +
      "drift class this walker exists to end");
  }
  assert.ok(!row.invocation.includes("unknown"),
    "`unknown` is never an agent's answer, so offering it would offer a refusal");
});

// ───────────── 4.3: `unreconstructable` is recordable, with its required reason ─────────────

unitTest("4.3: `unreconstructable` joins the closed outcome set as an AGENT answer", () => {
  assert.ok(KNOWN_OUTCOMES.includes("unreconstructable"));
  assert.ok(AGENT_OUTCOMES.includes("unreconstructable"),
    "it records that somebody LOOKED and the evidence is gone — that is a judgment, not a stamp");
});

unitTest("4.3: recording `unreconstructable` requires a reason, and then the epic leaves the set", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "evidence-is-gone", "--title", "e", "--lane", "claude-code",
    "--status", "archived"]);
  assert.deepEqual(ids(readState(engine).epics), ["evidence-is-gone"],
    "precondition: the creation path stamped `unknown` with its own token");

  const err = expectFail(() => engine(["update-epic", "evidence-is-gone", "--status", "archived",
    "--outcome", "unreconstructable", "--no-deferrals"]));
  assert.match(String(err), /requires a non-empty reason/,
    "a determination with no reason is indistinguishable from an epic nobody looked at");

  engine(["update-epic", "evidence-is-gone", "--status", "archived", "--outcome", "unreconstructable",
    "--reason", "the change directory and its commits were rewritten out of history",
    "--no-deferrals"]);
  const e = readState(engine).epics.find(x => x.id === "evidence-is-gone");
  assert.equal(e.disposition.outcome, "unreconstructable");
  assert.equal(e.disposition.recordedBy, undefined, "an agent's record carries no stamp");
  assert.deepEqual(ids(readState(engine).epics), [],
    "somebody looked — the epic is no longer one whose outcome nobody considered");
});

unitTest("4.3: the three states stay distinguishable in the record", () => {
  const nobodyLooked = engineStamp("migration", { recordedAt: AT });
  const lookedAndFound = agentDisposition({ outcome: "killed", reason: "cut at Gate 1", recordedAt: AT });
  const lookedAndFoundNothing = agentDisposition({
    outcome: "unreconstructable", reason: "no commits survive", recordedAt: AT });
  assert.equal(isEngineStamped(nobodyLooked), true);
  assert.equal(isEngineStamped(lookedAndFoundNothing), false);
  assert.notEqual(outcomeOf({ disposition: lookedAndFound }),
    outcomeOf({ disposition: lookedAndFoundNothing }));
  assert.notEqual(outcomeOf({ disposition: nobodyLooked }),
    outcomeOf({ disposition: lookedAndFoundNothing }),
    "a fabricated disposition is worse than an absent one — all three states must survive");
});

// ───────────────── 4.6: the INVARIANT, both directions, against a fixture ─────────────────

unitTest("4.6: every returned epic satisfies the predicate and no epic satisfying it is omitted", () => {
  // A constructed matrix rather than a live count: this release's own dispositions change the
  // live number, and a test naming one is a known failure mode in this repository.
  const fixture = [];
  for (const token of ["archive-drift-heal", "archive-backfill", "add-epic", "add-many", "migration"]) {
    fixture.push(epic(`stamped-${token}-unknown`, { disposition: engineStamp(token, { recordedAt: AT }) }));
    fixture.push(epic(`stamped-${token}-delivered`,
      { disposition: engineStamp(token, { outcome: "delivered", recordedAt: AT }) }));
    fixture.push(epic(`stamped-${token}-unknown-but-active`,
      { status: "queued", disposition: engineStamp(token, { recordedAt: AT }) }));
  }
  for (const o of AGENT_OUTCOMES) {
    fixture.push(epic(`agent-${o}`,
      { disposition: agentDisposition({ outcome: o, reason: "because", recordedAt: AT }) }));
  }
  fixture.push(epic("no-disposition"));
  fixture.push(epic("unregistered-token",
    { disposition: { outcome: "unknown", recordedAt: AT, recordedBy: "somebody" } }));

  // The predicate re-derived here, from the two readers the design names — never by calling the
  // walker, which would make this test assert that a function equals itself.
  const satisfies = (e) =>
    e.status === "archived" && isEngineStamped(e.disposition) && outcomeOf(e) === "unknown";
  const expected = fixture.filter(satisfies).map(e => e.id).sort();

  assert.ok(expected.length > 0 && expected.length < fixture.length,
    "the fixture must exercise BOTH answers, or the invariant below is vacuous");
  assert.deepEqual(ids(fixture), expected);
  for (const row of unconsideredOutcomes(fixture)) {
    assert.ok(satisfies(row.epic), `${row.epic.id} was returned but does not satisfy the predicate`);
  }
});

// ───────────────── 5.10: the walker is REACHABLE — a dispatched verb, not a library export ────
//
// `epic-disposition/spec.md` says an agent ASKS the engine. Group 4 landed the walker as an
// export with no consumer outside this file, so the release would otherwise ship an enumeration
// nobody can ask for. These tests exercise the ASK, through the real dispatcher, and they are
// what would fail if the verb were removed and the export left intact.

unitTest("5.10: `unconsidered-outcomes` is dispatched and returns the population as JSON", () => {
  const st = [
    epic("nobody-was-asked", { disposition: engineStamp("migration", { recordedAt: AT }) }),
    epic("evidence-derived",
      { disposition: engineStamp("migration", { outcome: "delivered", recordedAt: AT }) }),
    epic("somebody-decided",
      { disposition: agentDisposition({ outcome: "killed", reason: "no longer wanted", recordedAt: AT }) }),
    epic("still-open", { status: "queued" }),
  ];
  const engine = memoryEngine({ version: 1, active: null, detourStack: [], epics: st });

  const out = JSON.parse(engine(["unconsidered-outcomes"]));
  assert.equal(out.count, 1, "only the engine stamp carrying `unknown` is the population");
  assert.deepEqual(out.unconsidered.map(r => r.id), ["nobody-was-asked"]);
  const row = out.unconsidered[0];
  assert.equal(row.recordedBy, "migration",
    "WHO stamped it decides how much of the epic's story is recoverable, so it is carried through");
  // The invocation is the walker's, verbatim — a second rendering here would be the vocabulary
  // typed twice, which is what dispositionInvocation() exists to prevent.
  assert.equal(row.invocation, unconsideredOutcomes(st)[0].invocation);
});

unitTest("5.10: recording a disposition through the printed invocation empties the set", () => {
  const engine = memoryEngine({ version: 1, active: null, detourStack: [], epics: [
    epic("nobody-was-asked", { lane: "claude-code", disposition: engineStamp("migration", { recordedAt: AT }) })] });
  assert.equal(JSON.parse(engine(["unconsidered-outcomes"])).count, 1);

  engine(["update-epic", "nobody-was-asked", "--status", "archived",
       "--outcome", "unreconstructable",
       "--reason", "archived before dispositions existed; nothing left to reconstruct from",
       "--no-deferrals"]);
  const after = JSON.parse(engine(["unconsidered-outcomes"]));
  assert.equal(after.count, 0, "the set shrinks only by somebody deciding");
  assert.deepEqual(after.unconsidered, []);
});

unitTest("5.10: the verb is READ-ONLY — asking the question does not write the record", () => {
  const engine = memoryEngine({ version: 1, active: null, detourStack: [], epics: [
    epic("nobody-was-asked", { disposition: engineStamp("migration", { recordedAt: AT }) })] });
  const before = stateBytes(engine);
  engine(["unconsidered-outcomes"]);
  assert.equal(stateBytes(engine), before,
    "an orchestrator asks this of a repo it does not own — answering must not dirty it");
});
