// scripts/test/unit/sync-registration-ids.test.mjs
// sync-registers-ids-add-epic-refuses (0.50.0) — the UNIT-rung half. Its observable is a VALUE: what
// pushEpic() does to an in-memory record. The file-rung half (sync over real directories) is
// scripts/test/assert/sync-registration-ids.test.mjs.

import assert from "node:assert/strict";
import { unitTest } from "../fixtures/unit-harness.mjs";

const STATE = new URL("../../lib/state.mjs", import.meta.url).href;
const PROGRESS = new URL("../../lib/epic-progress.mjs", import.meta.url).href;

unitTest("pushEpic, the one creation sink, refuses every id add-epic refuses", async () => {
  const { pushEpic, InvalidEpicIdError } = await import(STATE);
  for (const id of ["x|y", ".hidden", "MASTER-ok", "has space", ""]) {
    const state = { epics: [] };
    assert.throws(() => pushEpic(state, { id, title: "t", lane: "claude-code", links: [] }), InvalidEpicIdError, `refuses ${JSON.stringify(id)}`);
    assert.equal(state.epics.length, 0);
  }
  const state = { epics: [] };
  pushEpic(state, { id: "master-ok", title: "t", lane: "claude-code", links: [] });
  assert.equal(state.epics.length, 1, "a well-formed id is stored");
});

// The date rule itself, as a pure predicate over (record, directory day) — no directory is read.
unitTest("the date rule: one day of slack, exactly — day-1 matches, day-2 is set aside", async () => {
  const { canBeArchiveOf } = await import(PROGRESS);
  const live = { id: "x", status: "queued", createdAt: "2026-09-26T10:00:00.000Z" };
  assert.equal(canBeArchiveOf(live, "2026-09-26"), true, "same day");
  assert.equal(canBeArchiveOf(live, "2026-09-25"), true, "day-1: the local-date slack");
  assert.equal(canBeArchiveOf(live, "2026-09-24"), false, "day-2: set aside");
  assert.equal(canBeArchiveOf(live, "2026-09-27"), true, "archived after registration");
});

unitTest("the backfill exemption stands on its own: a REOPENED backfilled epic still matches its older archive", async () => {
  const { canBeArchiveOf } = await import(PROGRESS);
  const reopened = { id: "old", status: "queued", registeredBy: "archive-backfill", createdAt: "2026-09-25T10:00:00.000Z" };
  assert.equal(canBeArchiveOf(reopened, "2020-01-01"), true, "registered FROM that archive — exempt while live");
  assert.equal(canBeArchiveOf({ ...reopened, registeredBy: undefined }, "2020-01-01"), false, "without the provenance, the same live record is set aside");
});

unitTest("an ended record and an undated directory resolve by name; a live undatable record matches no dated directory", async () => {
  const { canBeArchiveOf } = await import(PROGRESS);
  assert.equal(canBeArchiveOf({ id: "x", status: "archived", createdAt: "2026-09-25T10:00:00.000Z" }, "2020-01-01"), true);
  assert.equal(canBeArchiveOf({ id: "x", status: "queued", createdAt: "2026-09-25T10:00:00.000Z" }, ""), true);
  assert.equal(canBeArchiveOf({ id: "x", status: "queued" }, "2026-09-25"), false);
  assert.equal(canBeArchiveOf(null, "2020-01-01"), true, "a bare id has nothing to date");
});
