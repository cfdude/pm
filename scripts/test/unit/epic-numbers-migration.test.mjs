// scripts/test/unit/epic-numbers-migration.test.mjs
// project-boards 8.2: the 0.55.0 migration body (stampEpicNumbers) — tracker-linked epics first, keyed to their issue number,
// then the rest in createdAt-then-id order from the counter; additive, idempotent, absent-tolerant. UNIT rung, pure over a record.

import assert from "node:assert/strict";
import { unitTest } from "../fixtures/unit-harness.mjs";
import { stampEpicNumbers } from "../../lib/epic-number.mjs";

const epic = (id, over = {}) => ({ id, title: id, priority: "P2", status: "queued", role: "epic", lane: "claude-code", links: [], ...over });
const numbers = (s) => Object.fromEntries(s.epics.map(e => [e.id, e.number]));

unitTest("migration: tracker-linked epics take their issue number first, the rest follow in createdAt-then-id order from the floor", () => {
  const s = { epics: [
    epic("late", { createdAt: "2026-03-01T00:00:00Z" }),
    epic("early", { createdAt: "2026-01-01T00:00:00Z" }),
    epic("issue-9", { externalId: "9", createdAt: "2026-02-01T00:00:00Z" }),
    epic("no-date-b"), epic("no-date-a"),
    epic("same-day-b", { createdAt: "2026-02-01T00:00:00Z" }), epic("same-day-a", { createdAt: "2026-02-01T00:00:00Z" }),
  ] };
  assert.equal(stampEpicNumbers(s), 7);
  assert.deepEqual(numbers(s), {
    "issue-9": 9, early: 1000, "same-day-a": 1001, "same-day-b": 1002, late: 1003, "no-date-a": 1004, "no-date-b": 1005,
  });
  assert.equal(s.nextEpicNumber, 1006);
});

unitTest("migration: a duplicate externalId is deterministic (the earlier-created epic keeps the number), the other takes the counter", () => {
  const s = { epics: [
    epic("jira-5", { externalId: "5", createdAt: "2026-02-01T00:00:00Z" }),
    epic("gh-5", { externalId: "5", createdAt: "2026-01-01T00:00:00Z" }),
  ] };
  stampEpicNumbers(s);
  assert.deepEqual(numbers(s), { "gh-5": 5, "jira-5": 1000 });
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
  assert.equal(odd.epics[2].number, 1000);
  const behind = { epics: [epic("a", { number: 1050 })], nextEpicNumber: 3 };
  stampEpicNumbers(behind);
  assert.equal(behind.nextEpicNumber, 1051, "a counter behind a held number is moved past it");
  const low = { epics: [epic("a", { number: 50 })], nextEpicNumber: 3 };
  stampEpicNumbers(low);
  assert.equal(low.nextEpicNumber, 1000, "a counter below the floor is raised to it");
});

unitTest("migration: an invalid or duplicated stored number is replaced, never left to collide", () => {
  const s = { epics: [epic("a", { number: 2 }), epic("b", { number: 2 }), epic("c", { number: -1 }), epic("d", { number: 1.5 })] };
  stampEpicNumbers(s);
  const all = s.epics.map(e => e.number);
  assert.equal(new Set(all).size, 4);
  assert.ok(all.every(n => Number.isSafeInteger(n) && n > 0));
  assert.equal(s.epics[0].number, 2);
});

unitTest("migration: a tracker number at or above the floor takes the counter like any other epic", () => {
  const s = { epics: [
    epic("t999", { externalId: "999", createdAt: "2026-01-01T00:00:00Z" }),
    epic("t1500", { externalId: "1500", createdAt: "2026-01-02T00:00:00Z" }),
    epic("plain", { createdAt: "2026-01-03T00:00:00Z" }),
  ] };
  stampEpicNumbers(s);
  assert.deepEqual(numbers(s), { t999: 999, t1500: 1000, plain: 1001 });
  assert.equal(s.nextEpicNumber, 1002);
});

unitTest("migration: a duplicate stored number keeps the EARLIER holder in array order (not createdAt) and renumbers the later one from the floor", () => {
  const s = { epics: [
    epic("first", { number: 7, createdAt: "2026-03-01T00:00:00Z" }),
    epic("second", { number: 7, createdAt: "2026-01-01T00:00:00Z" }),
  ] };
  assert.equal(stampEpicNumbers(s), 1);
  assert.deepEqual(numbers(s), { first: 7, second: 1000 });
  assert.equal(s.nextEpicNumber, 1001);
});
