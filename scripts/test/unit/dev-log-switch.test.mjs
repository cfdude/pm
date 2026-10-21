// scripts/test/unit/dev-log-switch.test.mjs
// developer-session-log 1.2 -- the switch, its prerequisite, its refusals, idempotence and the OPT_INS row.
// UNIT rung: every observable is a refusal or a value in the in-memory record. `set-dev-log` writes no rules
// block, so nothing here reaches a file.

import assert from "node:assert/strict";
import { emptyRecord, expectFail, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";
import { OPT_INS, optInLines } from "../../lib/opt-ins.mjs";
import { devLogEnabled } from "../../lib/dev-log.mjs";
import { featureIds } from "../../lib/overhead.mjs";

const withTracking = () => ({ ...emptyRecord(), spendTracking: { enabled: true, enabledAt: "2026-10-09T00:00:00.000Z" } });

unitTest("1.2 a fresh record has the log off and upgrade names the row", () => {
  const engine = memoryEngine(emptyRecord());
  assert.equal(engine.store.record().devLog, undefined);
  assert.equal(devLogEnabled(engine.store.record()), false);
  const lines = optInLines(engine.store.record());
  assert.ok(lines.some((l) => l.includes("NOT SET: devLog")), JSON.stringify(lines));
  assert.ok(OPT_INS.some((o) => o.id === "devLog" && o.verb === "set-dev-log" && o.doc === "set-dev-log"));
});

unitTest("1.2 `on` without spend tracking is refused, names set-spend-tracking on, and writes nothing", () => {
  const engine = memoryEngine(emptyRecord());
  const before = JSON.stringify(engine.store.record());
  const err = expectFail(() => engine(["set-dev-log", "on"]));
  assert.match(err.stderr, /set-spend-tracking on/);
  assert.equal(JSON.stringify(engine.store.record()), before);
});

unitTest("1.2 `on` with tracking on stores {enabled, enabledAt}; `off` keeps the FIRST enabledAt", () => {
  const engine = memoryEngine(withTracking());
  engine(["set-dev-log", "on"]);
  const first = engine.store.record().devLog;
  assert.equal(first.enabled, true);
  assert.match(first.enabledAt, /^\d{4}-\d\d-\d\dT[\d:.]+Z$/);
  engine(["set-dev-log", "off"]);
  assert.deepEqual(engine.store.record().devLog, { enabled: false, enabledAt: first.enabledAt });
  engine(["set-dev-log", "on"]);
  assert.deepEqual(engine.store.record().devLog, { enabled: true, enabledAt: first.enabledAt });
});

unitTest("1.2 a repeated setting says so and writes nothing", () => {
  const engine = memoryEngine(withTracking());
  engine(["set-dev-log", "on"]);
  const before = JSON.stringify(engine.store.record());
  assert.match(engine.combined(["set-dev-log", "on"]), /developer log was already on/);
  assert.equal(JSON.stringify(engine.store.record()), before);
  const fresh = memoryEngine(emptyRecord());
  assert.match(fresh.combined(["set-dev-log", "off"]), /developer log was already off/);
});

unitTest("1.2 an unknown or missing argument is refused, naming on|off, and writes nothing", () => {
  const engine = memoryEngine(withTracking());
  const before = JSON.stringify(engine.store.record());
  assert.match(expectFail(() => engine(["set-dev-log", "maybe"])).stderr, /on\|off/);
  expectFail(() => engine(["set-dev-log"]));
  assert.equal(JSON.stringify(engine.store.record()), before);
});

unitTest("1.2 an adopted log moves to the summary line, and devLog is a feature `overhead` knows", () => {
  const lines = optInLines({ epics: [], devLog: { enabled: true, enabledAt: "2026-10-09T00:00:00.000Z" } });
  assert.match(lines[0], /devLog: on/);
  assert.ok(featureIds().includes("devLog"));
});
