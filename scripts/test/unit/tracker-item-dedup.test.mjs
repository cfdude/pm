// scripts/test/unit/tracker-item-dedup.test.mjs
// tracker-item-dedup-bypassed (code review 0.43.0, B2 + E1). One tracker item maps to ONE epic,
// on every path that writes the dedup key — not only `add-epic --external-id`. Re-verified at
// 0.49.0 before this file existed: three `add-epic --external-url U` calls plus an `update-epic
// --external-url U` produced four epics holding one URL, every command exit 0.
//
// Unit rung: every assertion here is a value the engine produced — a refusal, an exit, or what
// the record holds.

import assert from "node:assert/strict";
import { emptyRecord, expectFail, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

const U = "https://github.com/cfdude/pm/issues/7";
const ids = (engine) => engine.store.record().epics.map(e => e.id).sort();
const epic = (engine, id) => engine.store.record().epics.find(e => e.id === id);
const errText = (err) => {
  assert.ok(err, "expected a refusal, but the write was ACCEPTED");
  return String(err.stderr || err.message);
};

// ─────────────── add-epic ───────────────
unitTest("add-epic refuses a second epic claiming an external-url with NO external-id (the bypass)", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code", "--external-url", U]);
  const err = expectFail(() => engine(["add-epic", "--id", "b", "--lane", "claude-code", "--external-url", U]));
  assert.match(errText(err), /external-url/);
  assert.match(errText(err), /'a'/, "the refusal names the holder");
  assert.deepEqual(ids(engine), ["a"]);
});

unitTest("the refusal names the key that collided — the URL, not external-id (E1)", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code", "--external-id", "7", "--external-url", U]);
  const err = expectFail(() => engine(["add-epic", "--id", "b", "--lane", "claude-code",
    "--external-id", "7", "--external-url", U]));
  assert.match(errText(err), new RegExp(`external-url '${U.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}'`));
  assert.doesNotMatch(errText(err), /external-id '7'/);
});

unitTest("the emitted inward-sync registration line is refused when another epic already holds the item's URL", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "hand-made", "--lane", "superpowers", "--external-url", U]);
  const err = expectFail(() => engine(["add-epic", "--id", "gh-cfdude-pm-7", "--title=Some issue",
    "--status", "untriaged", "--external-id", "7", `--external-url=${U}`,
    "--external-updated-at", "2026-09-25T00:00:00Z", "--lane", "claude-code", "--priority", "P2"]));
  assert.match(errText(err), /'hand-made'/);
  assert.deepEqual(ids(engine), ["hand-made"]);
});

unitTest("an ARCHIVED holder still blocks, and the refusal names the clear that frees it", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "old", "--lane", "claude-code", "--status", "archived", "--external-url", U]);
  const err = expectFail(() => engine(["add-epic", "--id", "reopened", "--lane", "claude-code", "--external-url", U]));
  assert.match(errText(err), /'old'/);
  assert.match(errText(err), /update-epic old --clear external-url/);
  // The inverse: clearing the archived holder's URL frees it.
  engine(["update-epic", "old", "--clear", "external-url"]);
  engine(["add-epic", "--id", "reopened", "--lane", "claude-code", "--external-url", U]);
  assert.equal(epic(engine, "reopened").externalUrl, U);
});

// ─────────────── update-epic ───────────────
unitTest("update-epic --external-url refuses a URL another epic holds, naming it, and writes nothing", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code", "--external-url", U]);
  engine(["add-epic", "--id", "d", "--lane", "claude-code"]);
  const err = expectFail(() => engine(["update-epic", "d", "--external-url", U, "--priority", "P1"]));
  assert.match(errText(err), /'a'/);
  assert.equal(epic(engine, "d").externalUrl, undefined);
  assert.equal(epic(engine, "d").priority, "P?", "a refused invocation writes none of its fields");
});

unitTest("update-epic re-stating an epic's OWN url is not a collision", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code", "--external-url", U]);
  engine(["update-epic", "a", "--external-url", U, "--priority", "P1"]);
  assert.equal(epic(engine, "a").priority, "P1");
});

unitTest("update-epic --external-id enforces the URL-less fallback key", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code", "--external-id", "JOB-1"]);
  engine(["add-epic", "--id", "b", "--lane", "claude-code"]);
  const err = expectFail(() => engine(["update-epic", "b", "--external-id", "JOB-1"]));
  assert.match(errText(err), /external-id 'JOB-1'/);
  assert.match(errText(err), /'a'/);
});

unitTest("--clear external-url is never refused, even when it leaves an external-id fallback collision", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code", "--external-id", "7"]);
  engine(["add-epic", "--id", "b", "--lane", "claude-code", "--external-id", "7", "--external-url", U]);
  engine(["update-epic", "b", "--clear", "external-url"]);
  assert.equal(epic(engine, "b").externalUrl ?? undefined, undefined);
});

unitTest("update-epic judges the record AFTER its own --clear: clearing the URL while setting external-id meets the fallback key", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code", "--external-id", "JOB-9"]);
  engine(["add-epic", "--id", "b", "--lane", "claude-code", "--external-url", U]);
  const err = expectFail(() => engine(["update-epic", "b", "--clear", "external-url", "--external-id", "JOB-9"]));
  assert.match(errText(err), /external-id 'JOB-9' is already held by epic 'a'/);
  assert.equal(epic(engine, "b").externalUrl, U, "nothing was written");
});

// ─────────────── add-many — the third writer ───────────────
// The batch arrives on stdin (`--from -`), so it is a value handed to the verb rather than a file on
// disk, and these stay on the unit rung.
const addMany = (engine, doc) => engine(["add-many", "--from", "-"], { input: JSON.stringify(doc) });

unitTest("add-many refuses an entry whose externalUrl an existing epic holds, naming it, and creates nothing", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code", "--external-url", U]);
  const err = expectFail(() => addMany(engine, { epics: [
    { id: "ok", lane: "claude-code" },
    { id: "dup", lane: "claude-code", externalUrl: U },
  ] }));
  assert.match(errText(err), /external-url '.*' is already held by epic 'a'/);
  assert.deepEqual(ids(engine), ["a"], "the good entry was not created either");
});

unitTest("add-many refuses two entries of ONE batch claiming the same externalUrl, naming the first", () => {
  const engine = memoryEngine(emptyRecord());
  const err = expectFail(() => addMany(engine, { parent: { id: "p", lane: "claude-code", externalUrl: U },
    epics: [{ id: "c", lane: "claude-code", externalUrl: U }] }));
  assert.match(errText(err), /already claimed by batch entry 'p'/);
  assert.deepEqual(ids(engine), []);
});

unitTest("add-many applies the externalId fallback within the batch and against the record", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code", "--external-id", "JOB-3"]);
  const err = expectFail(() => addMany(engine, { epics: [{ id: "b", lane: "claude-code", externalId: "JOB-3" }] }));
  assert.match(errText(err), /external-id 'JOB-3' is already held by epic 'a'/);
  // Distinct URLs sharing a bare id are distinct items — accepted.
  addMany(engine, { epics: [
    { id: "x", lane: "claude-code", externalId: "5", externalUrl: "https://github.com/o/one/issues/5" },
    { id: "y", lane: "claude-code", externalId: "5", externalUrl: "https://github.com/o/two/issues/5" },
  ] });
  assert.deepEqual(ids(engine), ["a", "x", "y"]);
});

// ─────────────── surrounding whitespace is trimmed on every writer ───────────────
// A leading or trailing space was stored verbatim, so ` U` and `U` were two items to the dedup and
// the stored URL did not open. The comparison is otherwise EXACT (see README): only the whitespace
// a shell or a copy-paste adds is removed.
unitTest("add-epic, update-epic and add-many store the URL trimmed, and a padded copy collides with the bare one", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code", "--external-url", `  ${U} `]);
  assert.equal(epic(engine, "a").externalUrl, U);
  assert.match(errText(expectFail(() => engine(["add-epic", "--id", "b", "--lane", "claude-code", "--external-url", `${U}\t`]))), /'a'/);
  engine(["add-epic", "--id", "c", "--lane", "claude-code"]);
  engine(["update-epic", "c", "--external-url", " https://x.test/c "]);
  assert.equal(epic(engine, "c").externalUrl, "https://x.test/c");
  assert.match(errText(expectFail(() => engine(["update-epic", "c", "--external-url", ` ${U}`]))), /'a'/);
  addMany(engine, { epics: [{ id: "d", lane: "claude-code", externalUrl: " https://x.test/d\n" }] });
  assert.equal(epic(engine, "d").externalUrl, "https://x.test/d");
  assert.match(errText(expectFail(() => addMany(engine, { epics: [{ id: "e", lane: "claude-code", externalUrl: ` ${U} ` }] }))), /'a'/);
});

// ─────────────── a state file that ALREADY holds a duplicate ───────────────
function twoHolders() {
  const rec = emptyRecord();
  for (const id of ["a", "b"]) {
    rec.epics.push({ id, title: id, priority: "P2", status: "queued", role: "epic", lane: "claude-code",
      links: [], reconcileNeeded: false, externalUrl: U });
  }
  return memoryEngine(rec);
}

unitTest("an existing duplicate still loads, renders and briefs", () => {
  const engine = twoHolders();
  engine(["render"]);
  engine(["brief"]);
  assert.deepEqual(ids(engine), ["a", "b"]);
});

unitTest("an existing duplicate does not block an unrelated write to either holder", () => {
  const engine = twoHolders();
  engine(["update-epic", "b", "--priority", "P1"]);
  engine(["update-epic", "a", "--status", "active"]);
  assert.equal(epic(engine, "b").priority, "P1");
  assert.equal(epic(engine, "a").status, "active");
});

unitTest("an existing duplicate: re-setting the key refuses naming the other holder; clearing one frees it", () => {
  const engine = twoHolders();
  const err = expectFail(() => engine(["update-epic", "b", "--external-url", U]));
  assert.match(errText(err), /'a'/);
  engine(["update-epic", "a", "--clear", "external-url"]);
  engine(["update-epic", "b", "--external-url", U]);
  assert.equal(epic(engine, "b").externalUrl, U);
});
