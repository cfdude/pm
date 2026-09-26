// scripts/test/unit/sync-registration-ids.test.mjs
// sync-registers-ids-add-epic-refuses (0.50.0) — the UNIT-rung half. Its observable is a VALUE: what
// pushEpic() does to an in-memory record. The file-rung half (sync over real directories) is
// scripts/test/assert/sync-registration-ids.test.mjs.

import assert from "node:assert/strict";
import { unitTest } from "../fixtures/unit-harness.mjs";

const STATE = new URL("../../lib/state.mjs", import.meta.url).href;

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
