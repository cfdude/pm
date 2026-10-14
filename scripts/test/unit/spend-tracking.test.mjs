// scripts/test/unit/spend-tracking.test.mjs
// token-spend-tracking-per-epic, group 1 — the vocabulary and the switch. UNIT rung: every
// observable here is a VALUE (a constant, a refusal, the `upgrade` opt-in lines), obtained over an
// in-memory store. What `state` holds AFTER a toggle is on the FILE rung (assert/spend-tracking.test.mjs):
// the toggle refreshes CLAUDE.md, a repository file, as `set-review-mode` does.

import assert from "node:assert/strict";
import { emptyRecord, expectFail, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";
import { KNOWN_SPEND_PHASES } from "../../lib/constants.mjs";
import { OPT_INS, optInLines } from "../../lib/opt-ins.mjs";

unitTest("1.1 KNOWN_SPEND_PHASES is exactly the spec's closed list", () => {
  assert.deepEqual(KNOWN_SPEND_PHASES, ["plan", "build", "review", "docs", "release"]);
});

unitTest("1.2 a fresh record has tracking off: the field is absent and upgrade names the verb", () => {
  const engine = memoryEngine(emptyRecord());
  assert.equal(engine.store.record().spendTracking, undefined);
  const lines = optInLines(engine.store.record());
  assert.ok(lines.includes(
    "conductor:   NOT SET: spendTracking — no record of which epic, phase, role or model spent tokens → set-spend-tracking on"),
  `the exact NOT SET line is emitted; got ${JSON.stringify(lines)}`);
  assert.ok(OPT_INS.some((o) => o.id === "spendTracking" && o.verb === "set-spend-tracking" && o.doc === "spend"));
});

unitTest("1.2 an unknown argument is refused, naming on|off, and the record is unchanged", () => {
  const engine = memoryEngine(emptyRecord());
  const before = JSON.stringify(engine.store.record());
  const err = expectFail(() => engine(["set-spend-tracking", "maybe"]));
  assert.match(err.stderr, /on\|off/);
  assert.equal(JSON.stringify(engine.store.record()), before);
  expectFail(() => engine(["set-spend-tracking"]));
});

unitTest("1.2 an adopted switch moves to the summary line", () => {
  const lines = optInLines({ epics: [], spendTracking: { enabled: true, enabledAt: "2026-10-09T00:00:00.000Z" } });
  assert.match(lines[0], /spendTracking: on/);
  assert.ok(!lines.some((l) => l.includes("NOT SET: spendTracking")));
});
