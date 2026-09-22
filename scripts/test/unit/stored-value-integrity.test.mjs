// scripts/test/unit/stored-value-integrity.test.mjs
// 4.1's migration of `assert/stored-value-integrity.test.mjs` — ALL of it, moved from the file rung to
// the unit rung with every assertion unchanged. (The file-rung file is gone; nothing in it needed
// bytes on disk.)
//
// `gate-integrity` — the read-only surface reports three shapes of stored value that cannot be
// true: a reference naming itself, a reference naming nothing, and a grant naming nothing. Every
// test is one scenario of
// openspec/changes/operations-ship-their-inverses/specs/gate-integrity/spec.md.
//
// WHY A CHECK AS WELL AS THE WRITE-TIME REFUSALS. They are not redundant and neither substitutes
// for the other: a refusal binds a write that has not happened yet and does nothing for the records
// already on disk, which is where all three of these were found. Every fixture below is therefore
// hand-written — after `epic-disposition`'s refusals and `epic-autonomy`'s, the engine can no
// longer produce any of them.
//
// WHY IT MOVED ENTIRELY: every observable is `integrity`'s PRINTED report — its headers, its findings
// and their WORDING — and the fixture is a hand-edit of the record, which on this rung is a mutation
// of the record the store holds. No file is written by any test in it.
//
//   `tmpRepo()` + `run(["init"], { cwd })`  →  `memoryEngine(emptyRecord())`
//   `run(args, { cwd })`                    →  `engine(args)`
//   `runCombined(args, { cwd })`            →  `engine.combined(args)`
//   `readState(cwd)`                        →  `engine.store.record()`
//   `fs.writeFileSync(stateFile(cwd), …)`   →  GONE: the mutation IS the write

import assert from "node:assert/strict";
import { emptyRecord, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

const readState = (engine) => engine.store.record();

/** A conductor whose record is hand-edited into a shape the engine refuses to write.
 *
 *  THE `writeFileSync` LINE IS GONE RATHER THAN TRANSLATED: on the file rung this read the record,
 *  edited it and wrote it back; the memory store hands back the record it HOLDS, so the mutation IS
 *  the write. Written this way because the whole file's premise is hand-written records — "after the
 *  refusals, the engine can no longer produce any of these". */
function poisoned(mutate) {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "a", "--lane", "claude-code"]);
  engine(["add-epic", "--id", "other", "--lane", "claude-code"]);
  const s = readState(engine);
  mutate(s, s.epics.find(e => e.id === "a"));
  return engine;
}

/** The findings block for one check id, as `integrity` prints it. */
function block(out, id) {
  const lines = out.split("\n");
  const at = lines.findIndex(l => l.startsWith(`${id} — `));
  assert.notEqual(at, -1, `integrity declares a '${id}' check:\n${out}`);
  const found = [];
  for (let i = at + 1; i < lines.length && lines[i].startsWith("  • "); i++) found.push(lines[i]);
  return { header: lines[at], findings: found };
}

const integrity = (engine) => engine.combined(["integrity"]);
const archived = (e) => { e.status = "archived"; e.disposition = { outcome: "delivered", recordedAt: "2026-01-01T00:00:00.000Z" }; };

unitTest("Scenario: A self-referential handoff is reported", () => {
  const engine = poisoned((s, a) => { archived(a); a.disposition.carriedTo = "a"; });
  const { header, findings } = block(integrity(engine), "self-referential-epic-id");
  assert.match(header, /1 finding/);
  assert.match(findings[0], /`a`/, "names the epic that holds it");
  assert.match(findings[0], /disposition\.carriedTo/, "and the field");
  // Reported, never repaired.
  assert.equal(readState(engine).epics.find(e => e.id === "a").disposition.carriedTo, "a");
});

unitTest("Scenario: A self-referential deferral is reported", () => {
  // The SAME declared set, not `carriedTo` alone: a self-reference is no less false in a deferral.
  const engine = poisoned((s, a) => {
    archived(a);
    a.deferralAssertion = { deferrals: [{ epic: "a", section: "design.md" }], declined: [], recordedAt: "2026-01-01T00:00:00.000Z" };
  });
  const { findings } = block(integrity(engine), "self-referential-epic-id");
  assert.equal(findings.length, 1);
  assert.match(findings[0], /deferralAssertion\.deferrals/);
});

unitTest("Scenario: An empty deferral reference is reported", () => {
  const engine = poisoned((s, a) => {
    archived(a);
    a.deferralAssertion = { deferrals: [{ epic: "", section: "" }], declined: [], recordedAt: "2026-01-01T00:00:00.000Z" };
  });
  const out = integrity(engine);
  const { findings } = block(out, "empty-epic-id");
  assert.equal(findings.length, 1, "the shape `dangling-epic-reference` passes over by construction");
  assert.match(findings[0], /`a`/);
  assert.match(findings[0], /deferralAssertion\.deferrals/);
  assert.equal(block(out, "dangling-epic-reference").findings.length, 0,
    "and it is NOT also reported as dangling — one finding, exactly one check");
});

unitTest("Scenario: A grant naming nothing is reported", () => {
  const engine = poisoned((s, a) => {
    a.autonomy = { level: "off", context: [], notifications: [],
      preAuthorized: [{ action: "", grantedAt: "2026-01-01T00:00:00.000Z", reason: "no action" }] };
  });
  const { findings } = block(integrity(engine), "grant-names-nothing");
  assert.equal(findings.length, 1, "no revoke can reach it — a revoke names a STORED value");
  assert.match(findings[0], /`a`/);
});

unitTest("Scenario: An unknown id is reported once, as a dangling reference and not as an empty one", () => {
  const engine = poisoned((s, a) => { archived(a); a.disposition.carriedTo = "ghost-epic"; });
  const out = integrity(engine);
  assert.equal(block(out, "dangling-epic-reference").findings.length, 1);
  assert.equal(block(out, "empty-epic-id").findings.length, 0);
  assert.equal(block(out, "self-referential-epic-id").findings.length, 0);
});

unitTest("Scenario: A valid reference is not reported", () => {
  const engine = poisoned((s, a) => {
    archived(a);
    a.disposition.carriedTo = "other";
    a.deferralAssertion = { deferrals: [{ epic: "other", section: "" }], declined: [], recordedAt: "2026-01-01T00:00:00.000Z" };
    a.autonomy = { level: "autonomous", context: [], notifications: [], preAuthorized: [
      { action: "rm -rf build/", grantedAt: "2026-01-01T00:00:00.000Z" },
      { category: "filesystem", grantedAt: "2026-01-01T00:00:00.000Z" },
      // A REVOKED grant still names something, so it is not a finding: the check is about a grant
      // that names NOTHING, not about one that has been taken back.
      { action: "drop-table", grantedAt: "2026-01-01T00:00:00.000Z", revoked: { reason: "unsafe", revokedAt: "2026-01-02T00:00:00.000Z" } },
    ] };
  });
  const out = integrity(engine);
  for (const id of ["self-referential-epic-id", "empty-epic-id", "grant-names-nothing"]) {
    assert.equal(block(out, id).findings.length, 0, `${id} reports nothing:\n${out}`);
  }
});

// ───────── 2.7 REGRESSION GUARD — the value-agnostic enumeration changes no existing consumer ─────────

unitTest("REGRESSION GUARD: dangling-epic-reference still reports a non-empty unknown id exactly once", () => {
  const engine = poisoned((s, a) => {
    archived(a);
    a.disposition.carriedTo = "ghost-epic";
    a.deferralAssertion = { deferrals: [{ epic: "", section: "x" }], declined: [], recordedAt: "2026-01-01T00:00:00.000Z" };
  });
  const out = integrity(engine);
  const dangling = block(out, "dangling-epic-reference");
  assert.equal(dangling.findings.length, 1, "the empty holder does not leak into the dangling check");
  assert.match(dangling.findings[0], /ghost-epic/);
  assert.equal(block(out, "empty-epic-id").findings.length, 1, "and the empty one is reported by its own check");
});

unitTest("REGRESSION GUARD: remove-epic neither sweeps nor refuses on a holder whose value is empty", () => {
  const engine = poisoned((s, a) => {
    archived(a);
    a.deferralAssertion = { deferrals: [{ epic: "", section: "x" }], declined: [], recordedAt: "2026-01-01T00:00:00.000Z" };
  });
  // Removing an unrelated epic must behave exactly as before: the empty holder is invisible to the
  // sweep (no epic id is ever the empty string) and blocks nothing.
  engine(["remove-epic", "other"]);
  const s = readState(engine);
  assert.equal(s.epics.find(e => e.id === "other"), undefined);
  assert.deepEqual(s.epics.find(e => e.id === "a").deferralAssertion.deferrals, [{ epic: "", section: "x" }],
    "the empty holder is left exactly as it was");
});

unitTest("REGRESSION GUARD: remove-epic still refuses on a frame and on an owed reconcile", () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "p", "--lane", "claude-code", "--status", "active"]);
  engine(["add-epic", "--id", "d", "--lane", "claude-code"]);
  engine(["push-detour", "p", "--detour", "d", "--reason", "blocked", "--reconcile"]);
  const out = engine.combined(["remove-epic", "p"]);
  assert.match(out, /detour-stack frame|reconcile/i, "the frame and the owed reconcile still block a removal");
  assert.ok(readState(engine).epics.find(e => e.id === "p"), "and the epic is still there");
});

// ───────── Gate 2 I-I2 — the repair path, and what the report says about history ─────────

unitTest("Scenario: correcting a self-referential handoff repairs the LIVE field and keeps the history reported", () => {
  // The repair path the checks' remedy prescribes, run end to end. `--correct-disposition` moves the
  // prior record — the bad value and all — under `disposition.superseded`, which is immutable by this
  // release's own record-don't-delete rule. So the live finding CLEARS and the historical one does
  // NOT, and the historical one must not prescribe an action no verb can perform.
  const engine = poisoned((s, a) => { archived(a); a.disposition.carriedTo = "a"; });
  assert.equal(block(integrity(engine), "self-referential-epic-id").findings.length, 1, "fixture: the live field is a finding");

  engine(["update-epic", "a", "--status", "archived", "--outcome", "superseded", "--reason",
    "the work moved to 'other'", "--carried-to", "other", "--no-deferrals",
    "--correct-disposition", "carriedTo named the epic itself, which conveys nothing"]);

  const d = readState(engine).epics.find(e => e.id === "a").disposition;
  assert.equal(d.carriedTo, "other", "the live handoff now names the epic that holds the work");
  assert.equal(d.superseded.carriedTo, "a", "and the prior record keeps the value that was wrong, verbatim");

  const { header, findings } = block(integrity(engine), "self-referential-epic-id");
  assert.match(header, /1 finding/, "the historical copy is still reported — it is still a value that cannot be true");
  assert.match(findings[0], /disposition\.superseded\.carriedTo/, "and it is the superseded field, not the live one");
  assert.doesNotMatch(findings[0], /Point it at the epic that actually holds the work/,
    "but NOT with the live field's remedy: no verb can rewrite a superseded record, and prescribing it is a remedy that does nothing");
  assert.match(findings[0], /superseded|corrected|history/i,
    "the finding says instead that it persists by design on a corrected record");
});

unitTest("REGRESSION GUARD: the live field's remedy is unchanged for a reference that is not history", () => {
  const engine = poisoned((s, a) => { archived(a); a.disposition.carriedTo = "a"; });
  const { findings } = block(integrity(engine), "self-referential-epic-id");
  assert.match(findings[0], /Point it at the epic that actually holds the work, or remove the claim/,
    "a live self-reference still gets the actionable remedy");
});

unitTest("Scenario: an empty id in a superseded record is reported without the re-record remedy", () => {
  // The same ruling for `empty-epic-id`, which reads the same declared set. HAND-WRITTEN, and no
  // engine version wrote this shape: `agentDisposition()` copies `carriedTo` only when it is
  // non-empty, and the superseded half is a verbatim copy of a prior record built the same way. The
  // fixture exercises the WORDING branch over a record only a hand-edit can produce — which is the
  // population every check in this file exists for.
  const engine = poisoned((s, a) => {
    archived(a);
    a.disposition.superseded = { outcome: "delivered", recordedAt: "2026-01-01T00:00:00.000Z", carriedTo: "" };
  });
  const { findings } = block(integrity(engine), "empty-epic-id");
  assert.equal(findings.length, 1);
  assert.match(findings[0], /disposition\.superseded\.carriedTo/);
  assert.doesNotMatch(findings[0], /is repaired by re-recording the reference with the epic it meant/,
    "the live remedy is not offered against a record no verb can rewrite");
});
