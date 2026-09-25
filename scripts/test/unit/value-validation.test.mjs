// scripts/test/unit/value-validation.test.mjs
// code-review-0-43-0-minors: two epic values every writer stored without looking at them.
//
//   * `--priority banana` was stored (add-epic, update-epic, add-many). A priority outside
//     P0-P3/P? ranks last everywhere and reads as a real band in PROJECT.md.
//   * a non-date `--external-updated-at` was stored (the same three, and record-tracker-refresh),
//     and record-tracker-refresh took a watermark OLDER than the recorded one. A watermark that is
//     not a time compares against nothing, so the "re-read it" drift check can never fire.
//
// UNIT RUNG: every observable is a refusal or a value the record holds. add-many's batch document is
// a file on disk, so its half is on the file rung (assert/value-validation.test.mjs).

import assert from "node:assert/strict";
import { emptyRecord, expectFail, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

const CONSTANTS = new URL("../../lib/constants.mjs", import.meta.url).href;
const epicOf = (engine, id) => engine.store.record().epics.find(e => e.id === id);

unitTest("add-epic and update-epic refuse a priority outside P0-P3 and P?, and store nothing", () => {
  const engine = memoryEngine(emptyRecord());
  const err = expectFail(() => engine(["add-epic", "--id", "a", "--lane", "claude-code", "--priority", "banana"]));
  assert.ok(err, "add-epic refuses");
  assert.match(err.stderr, /--priority must be one of P0\|P1\|P2\|P3\|P\?/);
  assert.equal(epicOf(engine, "a"), undefined, "and writes no epic");

  engine(["add-epic", "--id", "b", "--lane", "claude-code", "--priority", "P1"]);
  const err2 = expectFail(() => engine(["update-epic", "b", "--priority", "P9"]));
  assert.ok(err2, "update-epic refuses");
  assert.equal(epicOf(engine, "b").priority, "P1", "and the stored priority is unchanged");
  for (const p of ["P0", "P2", "P3", "P?"]) engine(["update-epic", "b", "--priority", p]);
  assert.equal(epicOf(engine, "b").priority, "P?", "every value in the vocabulary is accepted");
});

unitTest("add-epic and update-epic refuse a watermark that is not an ISO-8601 timestamp", () => {
  const engine = memoryEngine(emptyRecord());
  assert.ok(expectFail(() => engine(["add-epic", "--id", "a", "--lane", "claude-code", "--external-id", "1",
    "--external-updated-at", "notadate"])), "add-epic refuses");
  assert.equal(epicOf(engine, "a"), undefined);
  engine(["add-epic", "--id", "b", "--lane", "claude-code", "--external-id", "2",
    "--external-updated-at", "2026-09-25T12:00:00Z"]);
  const err = expectFail(() => engine(["update-epic", "b", "--external-updated-at", "2026-02-30T00:00:00Z"]));
  assert.match(err.stderr, /--external-updated-at must be an ISO-8601 timestamp/);
  assert.equal(epicOf(engine, "b").externalUpdatedAt, "2026-09-25T12:00:00Z");
});

unitTest("record-tracker-refresh refuses a non-date watermark and one OLDER than the recorded one", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "t", "--lane", "claude-code", "--external-id", "7",
    "--external-updated-at", "2026-09-25T12:00:00.000+0000"]);
  assert.ok(expectFail(() => engine(["record-tracker-refresh", "t", "--verdict", "unchanged",
    "--external-updated-at", "garbage"])), "a non-date is refused");
  const back = expectFail(() => engine(["record-tracker-refresh", "t", "--verdict", "unchanged",
    "--external-updated-at", "2020-01-01T00:00:00Z"]));
  assert.match(back.stderr, /OLDER than the watermark already recorded/);
  assert.match(back.stderr, /update-epic t --external-updated-at <iso>/, "and it names the correction path");
  assert.equal(epicOf(engine, "t").externalUpdatedAt, "2026-09-25T12:00:00.000+0000", "nothing was written");
  // The SAME instant in the other spelling is not older; a later one advances the watermark.
  engine(["record-tracker-refresh", "t", "--verdict", "unchanged", "--external-updated-at", "2026-09-25T12:00:00Z"]);
  engine(["record-tracker-refresh", "t", "--verdict", "unchanged", "--external-updated-at", "2026-09-26T08:00:00+02:00"]);
  assert.equal(epicOf(engine, "t").externalUpdatedAt, "2026-09-26T08:00:00+02:00");
});

unitTest("isIsoTimestamp accepts what GitHub, Linear and Jira emit and nothing Date.parse merely tolerates", async () => {
  const { isIsoTimestamp } = await import(CONSTANTS);
  for (const ok of ["2026-09-25T12:00:00Z", "2026-09-25T12:00:00.000Z", "2026-09-25T12:00:00.000+0000",
    "2026-09-25T12:00:00+00:00", "2026-09-25T12:00Z", "2024-02-29T00:00:00Z"]) {
    assert.equal(isIsoTimestamp(ok), true, ok);
  }
  for (const bad of ["notadate", "Sep 25 2026", "2026-09-25", "2026-09-25T12:00:00", "2026-02-30T00:00:00Z",
    "2025-02-29T00:00:00Z", "2026-13-01T00:00:00Z", "2026-09-25T24:00:00Z", "2026-09-25T12:00:00+2500", "", 20260925]) {
    assert.equal(isIsoTimestamp(bad), false, String(bad));
  }
});

unitTest("changelog --since refuses a value that is not a version instead of printing everything", () => {
  // cmpVer() read any non-number as 0, so `--since garbage` meant "since 0.0.0": 3,366 lines.
  const engine = memoryEngine(emptyRecord());
  for (const v of ["garbage", "0.43", "v0.43.0", "0.43.0-rc1"]) {
    const err = expectFail(() => engine(["changelog", "--since", v]));
    assert.ok(err, `--since ${v} is refused`);
    assert.match(err.stderr, /--since must be a pm version like 0\.43\.0/);
    assert.equal(err.stdout, "", "and nothing of the changelog is printed");
  }
});
