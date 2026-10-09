// scripts/test/unit/opt-ins.test.mjs
// gh#210 — `upgrade` lists the opt-ins THIS repo has not adopted, read from the OPT_INS registry.
// The observable is a VALUE (the lines the pure reader returns from a state), so this is the unit rung.

import assert from "node:assert/strict";
import { unitTest } from "../fixtures/unit-harness.mjs";
import { OPT_INS, optInLines } from "../../lib/opt-ins.mjs";

unitTest("gh#210: an empty state lists every registry opt-in as NOT SET, each with its command", () => {
  const lines = optInLines({ epics: [] });
  assert.equal(lines[0], "conductor: opt-ins — none adopted");
  const notSet = lines.filter(l => l.includes("NOT SET:"));
  assert.equal(notSet.length, OPT_INS.length, "one NOT SET line per registry row, none hand-typed elsewhere");
  for (const o of OPT_INS) {
    assert.ok(notSet.some(l => l.includes(o.command)), `${o.id}: the line names the adopting command`);
  }
});

unitTest("gh#210: laneRouting with zero overrides reads as NOT SET and says what routing then returns", () => {
  const l = optInLines({ laneRouting: { overrides: [] }, epics: [] }).join("\n");
  assert.match(l, /NOT SET: laneRouting \(0 overrides\) — suggest-lane and triage return null/);
  assert.match(l, /set-lane-routing --add "<match>:<lane>"/);
});

unitTest("gh#210: adopted opt-ins move to the summary line and out of the NOT SET list", () => {
  const state = {
    reviewMode: "thorough", activityLog: { enabled: true }, spendTracking: { enabled: true },
    tracker: { system: "github-issues" },
    laneRouting: { overrides: [{ match: "migration", lane: "openspec" }] },
    epics: [{ id: "a", status: "active", claim: { session: "s", claimedAt: new Date().toISOString(), ttlMinutes: 60 } }],
  };
  const lines = optInLines(state);
  assert.equal(lines.length, 1, "everything adopted: the summary line alone, never silence");
  assert.match(lines[0], /reviewMode: thorough/);
  assert.match(lines[0], /activityLog: on/);
  assert.match(lines[0], /tracker: github-issues/);
  assert.match(lines[0], /laneRouting: 1 override/);
  assert.match(lines[0], /claim: held/);
});

unitTest("gh#210: an expired claim and a claim on an archived epic do not count as adopted", () => {
  const old = { session: "s", claimedAt: "2020-01-01T00:00:00.000Z", ttlMinutes: 60 };
  const live = { session: "s", claimedAt: new Date().toISOString(), ttlMinutes: 60 };
  assert.ok(optInLines({ epics: [{ id: "a", status: "active", claim: old }] }).some(l => l.includes("NOT SET: advisory claim")));
  assert.ok(optInLines({ epics: [{ id: "a", status: "archived", claim: live }] }).some(l => l.includes("NOT SET: advisory claim")));
});

unitTest("gh#210: a tracker name with control characters is escaped in the summary", () => {
  const l = optInLines({ tracker: { system: "gh\u001b[2Jx" }, epics: [] })[0];
  assert.doesNotMatch(l, /\u001b/);
});
