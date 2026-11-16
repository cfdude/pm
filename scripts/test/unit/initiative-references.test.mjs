// release-planning-taxonomy 2.4 (spec initiative-record): a dangling initiative reference is an integrity finding, and the export
// reads it as null. UNIT rung over runIntegrity() (pure over a record). The refusal of an unknown initiative id by every flag that
// names one is asserted where each flag lands (release in 4.1, the epic verbs in 5.1).

import assert from "node:assert/strict";
import { unitTest } from "../fixtures/unit-harness.mjs";
import { runIntegrity } from "../../lib/integrity.mjs";

const epic = (id, over = {}) => ({ id, title: id, priority: "P2", status: "queued", role: "epic", lane: "claude-code", links: [], ...over });
const record = (epics, over = {}) => ({ version: 1, revision: 1, active: null, detourStack: [], epics, ...over });
const initiative = (id) => ({ id, title: "t", capability: "c", status: "open", history: [], milestones: [], nextMilestone: 1, nonGoals: [], nextNonGoal: 1 });
const findings = (state) => runIntegrity(state).find(c => c.id === "dangling-initiative-reference").findings;

unitTest("integrity: a clean record has no dangling initiative reference", () => {
  const s = record([epic("e", { initiative: "boards", secondaryInitiatives: ["reporting"] })], {
    initiatives: [initiative("boards"), initiative("reporting")], releases: [{ id: "r1", intent: "i", deferred: [], initiative: "boards" }] });
  assert.deepEqual(findings(s), []);
});

unitTest("integrity: a hand-edited epic initiative, secondary and release initiative are each reported", () => {
  const s = record([epic("e", { initiative: "gone", secondaryInitiatives: ["gone2", "boards"] })], {
    initiatives: [initiative("boards")], releases: [{ id: "r1", intent: "i", deferred: [], initiative: "gone3" }] });
  const f = findings(s);
  assert.equal(f.length, 3);
  assert.ok(f.some(x => x.epic === "e" && /initiative `gone`/.test(x.detail)));
  assert.ok(f.some(x => x.epic === "e" && /secondary initiatives.*`gone2`/.test(x.detail)));
  assert.ok(f.some(x => /release `r1`'s initiative names initiative `gone3`/.test(x.detail)));
});

unitTest("integrity: a hand-edited initiative id that fails the id format is named", () => {
  const f = findings(record([], { initiatives: [initiative("Bad Id"), initiative("ok")] }));
  assert.equal(f.length, 1);
  assert.match(f[0].detail, /Bad Id/);
  assert.match(f[0].detail, /rejected/);
});

unitTest("integrity: a hostile id in a finding is escaped, never raw", () => {
  const f = findings(record([epic("e", { initiative: "x\nINJECTED" })]));
  assert.ok(!f[0].detail.includes("\nINJECTED"));
});
