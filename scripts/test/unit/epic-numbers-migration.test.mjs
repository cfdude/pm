// scripts/test/unit/epic-numbers-migration.test.mjs
// project-boards 8.2: the 0.55.0 migration body (stampEpicNumbers) — tracker-linked epics first, keyed to their issue number,
// then the rest in createdAt-then-id order from the counter; additive, idempotent, absent-tolerant. UNIT rung, pure over a record.

import assert from "node:assert/strict";
import { unitTest } from "../fixtures/unit-harness.mjs";
import { stampEpicNumbers } from "../../lib/epic-number.mjs";

const epic = (id, over = {}) => ({ id, title: id, priority: "P2", status: "queued", role: "epic", lane: "claude-code", links: [], ...over });
const numbers = (s) => Object.fromEntries(s.epics.map(e => [e.id, e.number]));

unitTest("migration: tracker-linked epics take their issue number first, the rest follow in createdAt-then-id order past the largest", () => {
  const s = { epics: [
    epic("late", { createdAt: "2026-03-01T00:00:00Z" }),
    epic("early", { createdAt: "2026-01-01T00:00:00Z" }),
    epic("issue-9", { externalId: "9", createdAt: "2026-02-01T00:00:00Z" }),
    epic("no-date-b"), epic("no-date-a"),
    epic("same-day-b", { createdAt: "2026-02-01T00:00:00Z" }), epic("same-day-a", { createdAt: "2026-02-01T00:00:00Z" }),
  ] };
  assert.equal(stampEpicNumbers(s), 7);
  assert.deepEqual(numbers(s), {
    "issue-9": 9, early: 10, "same-day-a": 11, "same-day-b": 12, late: 13, "no-date-a": 14, "no-date-b": 15,
  });
  assert.equal(s.nextEpicNumber, 16);
});

unitTest("migration: a duplicate externalId is deterministic (the earlier-created epic keeps the number), the other takes the counter", () => {
  const s = { epics: [
    epic("jira-5", { externalId: "5", createdAt: "2026-02-01T00:00:00Z" }),
    epic("gh-5", { externalId: "5", createdAt: "2026-01-01T00:00:00Z" }),
  ] };
  stampEpicNumbers(s);
  assert.deepEqual(numbers(s), { "gh-5": 5, "jira-5": 6 });
});

unitTest("migration: idempotent — a second run changes nothing, and numbers an epic already holds are never touched", () => {
  const s = { epics: [epic("a", { number: 40 }), epic("b", { externalId: "7" }), epic("c")] };
  stampEpicNumbers(s);
  const once = JSON.stringify(s);
  assert.equal(stampEpicNumbers(s), 0);
  assert.equal(JSON.stringify(s), once);
  assert.equal(s.epics[0].number, 40);
});

unitTest("migration: absent-tolerant — no epics, no array, junk entries and a damaged counter do not throw", () => {
  const none = {};
  assert.equal(stampEpicNumbers(none), 0);
  assert.equal("nextEpicNumber" in none, false, "nothing to number, nothing written");
  assert.equal(stampEpicNumbers({ epics: [] }), 0);
  const odd = { epics: [null, "x", epic("ok")], nextEpicNumber: "nope" };
  assert.equal(stampEpicNumbers(odd), 1);
  assert.equal(odd.epics[2].number, 1);
  const behind = { epics: [epic("a", { number: 50 })], nextEpicNumber: 3 };
  stampEpicNumbers(behind);
  assert.equal(behind.nextEpicNumber, 51, "a counter behind a held number is moved past it");
});

unitTest("migration: an invalid or duplicated stored number is replaced, never left to collide", () => {
  const s = { epics: [epic("a", { number: 2 }), epic("b", { number: 2 }), epic("c", { number: -1 }), epic("d", { number: 1.5 })] };
  stampEpicNumbers(s);
  const all = s.epics.map(e => e.number);
  assert.equal(new Set(all).size, 4);
  assert.ok(all.every(n => Number.isSafeInteger(n) && n > 0));
  assert.equal(s.epics[0].number, 2);
});
